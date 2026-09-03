import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

import { creditCardRebuildFromImportHistoryService } from '../../../src/services/creditCardRebuildFromImportHistoryService.ts';
import {
  projectCardTwoLedger,
  valorAcionavelDaCompetencia,
} from '../../../src/domain/credit-card/twoLedgerProjection.ts';
import { CARD_DOMAIN_VERSION } from '../../../src/domain/credit-card/domainVersion.ts';
import { metadataContextToken } from '../../../src/domain/credit-card/metadataContext.ts';
import type { ReconciliationResolutionInput } from '../../../src/domain/credit-card/twoLedgerBalance.ts';
import { foiRevertida } from './reversalLink.ts';
import { lerColecaoCompleta } from './leituraCompleta.ts';

/** Linha crua do PostgREST, antes de o núcleo dar sentido a ela. */
type Linha = Record<string, unknown>;

/**
 * O ambiente confiável da reconciliação de cartão.
 *
 * O navegador não pode ser autoridade sobre a existência, a magnitude nem o
 * sinal de uma diferença: um cliente manipulado fabricaria crédito que nunca
 * existiu. Então o cálculo acontece aqui, com o MESMO núcleo puro que a tela
 * usa, sobre dados lidos do banco, e o resultado é gravado num snapshot que só
 * o servidor escreve.
 *
 * O que o cliente manda: qual conta, qual competência, e — na hora de resolver
 * — o que a diferença SIGNIFICA. Nunca quanto ela vale.
 *
 * Três garantias moram aqui:
 *
 *   1. IDENTIDADE. O `user_id` sai do JWT validado, e a posse da conta é
 *      conferida sob RLS com o token do próprio usuário. O corpo da requisição
 *      não carrega identidade nenhuma.
 *
 *   2. R0 == R1. Os contadores são lidos ANTES e DEPOIS da leitura dos dados.
 *      Se mudaram no meio, a leitura pode ter misturado dois estados do mundo e
 *      o cálculo é descartado. A RPC ainda confere uma terceira vez, no commit.
 *
 *   3. METADATA ATUAL. As palavras-chave de classificação vêm de `auth.users`
 *      lido agora, nunca do JWT — que prova apenas o que o usuário tinha quando
 *      entrou, e pode ter horas.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  });

/** Erro com código HTTP próprio, para não devolver 500 em recusa esperada. */
class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const toCents = (v: number | null | undefined): number =>
  Math.round((Number(v ?? 0) + Number.EPSILON) * 100);

/**
 * Uma leitura completa e coerente do estado do usuário, com os contadores que
 * dizem sobre qual estado ela foi feita.
 *
 * Devolve `null` quando os contadores mudaram durante a leitura. Quem chama
 * decide se tenta de novo — e desiste depois de poucas tentativas, porque
 * insistir sob escrita contínua seria um laço sem fim.
 */
async function lerEstadoCoerente(
  userClient: ReturnType<typeof createClient>,
  admin: ReturnType<typeof createClient>,
  accountId: string
) {
  // Os DADOS vêm pelo cliente do usuário, sob RLS: uma conta que não é dele
  // simplesmente não aparece, e a posse não depende de nós conferirmos.
  //
  // Os CONTADORES vêm pelo ambiente confiável. Eles são invariante do servidor,
  // não dado do usuário, e o EXECUTE está concedido só a `service_role`.
  const contexto = async () => {
    const { data, error } = await admin.rpc('finelo_reconciliation_context_v1', {
      p_account_id: accountId,
    });
    if (error) throw new HttpError(500, `contexto: ${error.message}`);
    return data as { account_revision: number; user_context_revision: number };
  };

  const r0 = await contexto();

  // TODA coleção é lida por páginas, com contagem exata conferida no fim.
  // `.select('*')` cru devolve 200 truncado em `max-rows`, e foi assim que o
  // servidor calculou uma competência inteira sobre 1.000 de 3.768 transações.
  // A ordem por coluna única não é enfeite: sem ela as páginas se sobrepõem.
  let contas: Linha[];
  let transactions: Linha[];
  let importLogs: Linha[];
  let confirmacoes: Linha[];
  let resolucoes: Linha[];

  try {
    [contas, transactions, importLogs, confirmacoes, resolucoes] = await Promise.all([
      lerColecaoCompleta<Linha>('contas', (de, ate) =>
        userClient.from('contas').select('*', { count: 'exact' }).order('id').range(de, ate)
      ),
      lerColecaoCompleta<Linha>('transactions', (de, ate) =>
        userClient
          .from('transactions')
          .select('*', { count: 'exact' })
          .order('ID_Transacao')
          .range(de, ate)
      ),
      lerColecaoCompleta<Linha>('import_logs', (de, ate) =>
        userClient.from('import_logs').select('*', { count: 'exact' }).order('id').range(de, ate)
      ),
      lerColecaoCompleta<Linha>('confirmacoes', (de, ate) =>
        userClient
          .from('credit_card_competence_payment_confirmations')
          .select('*', { count: 'exact' })
          .eq('account_id', accountId)
          .order('id')
          .range(de, ate)
      ),
      lerColecaoCompleta<Linha>('resolucoes', (de, ate) =>
        userClient
          .from('credit_card_reconciliation_resolutions')
          .select('*, credit_card_reconciliation_resolution_reversals(id)', { count: 'exact' })
          .eq('account_id', accountId)
          .order('id')
          .range(de, ate)
      ),
    ]);
  } catch (e) {
    // Leitura incompleta não vira snapshot. 500 é a resposta certa: o pedido
    // não pôde ser atendido, e nada foi materializado.
    throw new HttpError(500, `leitura: ${(e as Error).message}`);
  }

  const r1 = await contexto();
  if (
    r0.account_revision !== r1.account_revision ||
    r0.user_context_revision !== r1.user_context_revision
  ) {
    return null;
  }

  return {
    revisions: r0,
    contas,
    transactions,
    importLogs,
    confirmacoes,
    resolucoes,
  };
}

/**
 * Roda o núcleo puro sobre o estado lido e devolve a projeção dos dois livros.
 *
 * Resoluções já revertidas não entram: a reversão é uma linha nova, e uma
 * resolução revertida deixa de valer sem que a original seja apagada.
 */
function projetar(estado: NonNullable<Awaited<ReturnType<typeof lerEstadoCoerente>>>, accountId: string) {
  const account = estado.contas.find((c: Record<string, unknown>) => c.id === accountId);
  if (!account) throw new HttpError(404, 'conta não encontrada');

  const cards = creditCardRebuildFromImportHistoryService.competenceHistoryCardsForAccount({
    accountId,
    account: account as never,
    accounts: estado.contas as never,
    transactions: estado.transactions as never,
    importLogs: estado.importLogs as never,
    userPaymentConfirmations: estado.confirmacoes.map((c: Record<string, unknown>) => ({
      referenceMonth: String(c.reference_month),
      settledAmount: Number(c.settled_amount ?? 0),
      confirmedAt: String(c.confirmed_at ?? ''),
    })),
  });

  const resolutionsByMonth: Record<string, ReconciliationResolutionInput[]> = {};
  for (const r of estado.resolucoes as Array<Record<string, unknown>>) {
    if (foiRevertida(r.credit_card_reconciliation_resolution_reversals)) continue;

    const mes = String(r.reference_month);
    (resolutionsByMonth[mes] ??= []).push({
      kind: r.resolution as ReconciliationResolutionInput['kind'],
      resolvedAmountCents: toCents(r.resolved_amount as number | null),
      authoritativeStatementTotalCents:
        r.authoritative_total == null ? undefined : toCents(r.authoritative_total as number),
      // Sem a PROCEDENCIA o nucleo descarta a resolucao autoritativa inteira.
      authoritativeSource: (r.authoritative_source ?? null) as never,
    });
  }

  return projectCardTwoLedger(cards, {
    asOf: new Date().toISOString().slice(0, 10),
    resolutionsByMonth,
  });
}

/**
 * Calcula e grava o snapshot da competência pedida.
 *
 * O token de metadata é derivado do estado ATUAL de `auth.users`, lido com a
 * chave de serviço. O JWT não serve: ele descreve o login, não o agora.
 */
async function calcularEGravar(
  userClient: ReturnType<typeof createClient>,
  admin: ReturnType<typeof createClient>,
  userId: string,
  accountId: string,
  referenceMonth: string
) {
  let estado = await lerEstadoCoerente(userClient, admin, accountId);
  for (let tentativa = 0; estado === null && tentativa < 2; tentativa++) {
    estado = await lerEstadoCoerente(userClient, admin, accountId);
  }
  if (estado === null) {
    throw new HttpError(409, 'os dados mudaram durante o cálculo; tente de novo');
  }

  const { data: usuario, error: erroUsuario } = await admin.auth.admin.getUserById(userId);
  if (erroUsuario || !usuario?.user) {
    throw new HttpError(500, `metadata: ${erroUsuario?.message ?? 'usuário não encontrado'}`);
  }
  const metadataContext = await metadataContextToken(usuario.user.user_metadata);

  const projecao = projetar(estado, accountId);
  const competencia = projecao.competences.find((c) => c.referenceMonth === referenceMonth);
  if (!competencia) throw new HttpError(404, `competência ${referenceMonth} não existe nesta conta`);

  /**
   * O que o usuário pode de fato resolver — não o delta bruto da competência.
   *
   * A convenção de pagamento faz uma diferença nascer num mês e a seguinte
   * devolvê-la. Oferecer o bruto convidava a classificar dinheiro que a cadeia
   * já tinha devolvido: na conta piloto, R$ 77,80 no lugar dos R$ 0,94 que
   * sobreviveram.
   *
   * Este é o MESMO valor que acende «A CONCILIAR» e que o diagnóstico mostra, e
   * é também o que a RPC grava no snapshot — então o número exibido e o número
   * resolvido são um só.
   */
  const deltaAcionavelCents = valorAcionavelDaCompetencia(projecao.competences, referenceMonth);

  const { error } = await admin.rpc('finelo_write_reconciliation_snapshot_v1', {
    p_account_id: accountId,
    p_reference_month: referenceMonth,
    p_delta_cents: deltaAcionavelCents,
    p_observed_account_revision: estado.revisions.account_revision,
    p_observed_user_context_revision: estado.revisions.user_context_revision,
    p_metadata_context: metadataContext,
    p_domain_version: CARD_DOMAIN_VERSION,
  });
  if (error) {
    // 40001 é o servidor dizendo que o mundo andou entre a leitura e o commit.
    throw new HttpError(error.code === '40001' ? 409 : 500, `snapshot: ${error.message}`);
  }

  return { projecao, competencia, deltaAcionavelCents, metadataContext };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authorization = req.headers.get('Authorization');
    if (!authorization) throw new HttpError(401, 'sem credencial');

    const url = Deno.env.get('SUPABASE_URL');
    const anon = Deno.env.get('SUPABASE_ANON_KEY');
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !anon || !service) throw new HttpError(500, 'ambiente incompleto');

    // Lê como o usuário: a RLS continua valendo, e a posse da conta é
    // conferida pelo banco, não por nós.
    const userClient = createClient(url, anon, {
      global: { headers: { Authorization: authorization } },
    });
    const admin = createClient(url, service, { auth: { persistSession: false } });

    const { data: auth, error: erroAuth } = await userClient.auth.getUser();
    if (erroAuth || !auth?.user) throw new HttpError(401, 'credencial inválida');
    const userId = auth.user.id;

    /**
     * A PORTA DO PILOTO, do lado do servidor.
     *
     * O gating do frontend impede que a superfície apareça. Ele não impede que
     * alguém chame esta função direto com o próprio JWT — e um fluxo que move
     * dinheiro não pode depender de o navegador ter escondido um botão.
     *
     * A fonte é `app_metadata` lido AGORA pelo Auth Admin, não o JWT: um token
     * emitido antes de a flag ser revogada continuaria afirmando o contrário.
     * `user_metadata` também é aceito porque é onde a flag já vive para parte
     * dos usuários, e o gate existente lê os dois.
     */
    const { data: perfil, error: erroPerfil } = await admin.auth.admin.getUserById(userId);
    if (erroPerfil || !perfil?.user) {
      throw new HttpError(500, `perfil: ${erroPerfil?.message ?? 'usuário não encontrado'}`);
    }
    const habilitado =
      perfil.user.app_metadata?.credit_card_engine_enabled === true ||
      perfil.user.user_metadata?.credit_card_engine_enabled === true;
    const desabilitado =
      perfil.user.app_metadata?.credit_card_engine_disabled === true ||
      perfil.user.user_metadata?.credit_card_engine_disabled === true;

    if (!habilitado || desabilitado) {
      throw new HttpError(403, 'reconciliação de cartão não habilitada para esta conta');
    }

    const body = await req.json().catch(() => ({}));
    const { action, accountId, referenceMonth } = body as Record<string, string>;

    if (!action) throw new HttpError(400, 'ação obrigatória');

    if (action === 'reverse') {
      const { resolutionId, idempotencyKey, reason } = body as Record<string, string>;
      if (!resolutionId || !idempotencyKey) {
        throw new HttpError(400, 'reversão exige resolutionId e idempotencyKey');
      }

      // A posse é conferida sob RLS: se a resolução não é do usuário, ele não a
      // enxerga, e a reversão nem chega a ser tentada.
      const { data: dona, error: erroDona } = await userClient
        .from('credit_card_reconciliation_resolutions')
        .select('id')
        .eq('id', resolutionId)
        .maybeSingle();
      if (erroDona) throw new HttpError(500, erroDona.message);
      if (!dona) throw new HttpError(404, 'resolução não encontrada');

      const { data, error } = await admin.rpc('finelo_reverse_reconciliation_v1', {
        p_resolution_id: resolutionId,
        p_idempotency_key: idempotencyKey,
        p_reason: reason ?? null,
      });
      if (error) throw new HttpError(error.code === '22004' ? 409 : 500, error.message);
      return json(data);
    }

    if (!accountId || !referenceMonth) {
      throw new HttpError(400, 'accountId e referenceMonth são obrigatórios');
    }

    // A conta tem de ser do usuário. Sob RLS, uma conta de outro simplesmente
    // não aparece.
    const { data: conta, error: erroConta } = await userClient
      .from('contas')
      .select('id')
      .eq('id', accountId)
      .maybeSingle();
    if (erroConta) throw new HttpError(500, erroConta.message);
    if (!conta) throw new HttpError(404, 'conta não encontrada');

    const { projecao, competencia, deltaAcionavelCents, metadataContext } = await calcularEGravar(
      userClient,
      admin,
      userId,
      accountId,
      referenceMonth
    );

    if (action === 'compute') {
      return json({
        referenceMonth,
        deltaCents: deltaAcionavelCents,
        economicOpenBalanceCents: competencia.economicOpenBalanceCents,
        economicStatus: competencia.economicStatus,
        reconciliationStatus: competencia.reconciliationStatus,
        economicUsedCents: projecao.economicUsedCents,
        economicCarryCents: projecao.economicCarryCents,
      });
    }

    if (action === 'resolve') {
      const { resolution, idempotencyKey, portionCents, authoritativeTotalCents, authoritativeSource, note } =
        body as Record<string, unknown>;
      if (!resolution || !idempotencyKey) {
        throw new HttpError(400, 'resolução exige resolution e idempotencyKey');
      }

      const { data, error } = await admin.rpc('finelo_resolve_reconciliation_v1', {
        p_account_id: accountId,
        p_reference_month: referenceMonth,
        p_resolution: resolution,
        p_idempotency_key: idempotencyKey,
        p_metadata_context: metadataContext,
        p_domain_version: CARD_DOMAIN_VERSION,
        // Valor ABSOLUTO da porção, quando parcial. O sinal é do servidor.
        p_portion_cents: portionCents == null ? null : Math.abs(Number(portionCents)),
        p_authoritative_total_cents:
          authoritativeTotalCents == null ? null : Math.round(Number(authoritativeTotalCents)),
        p_authoritative_source: authoritativeSource ?? null,
        p_note: note ?? null,
      });
      if (error) {
        const status = error.code === '40001' ? 409 : error.code === '22003' ? 422 : 400;
        throw new HttpError(status, error.message);
      }
      return json(data);
    }

    throw new HttpError(400, `ação desconhecida: ${action}`);
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    console.error('card-reconciliation:', err);
    return json({ error: 'erro interno' }, 500);
  }
});
