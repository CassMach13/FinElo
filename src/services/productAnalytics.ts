/**
 * Eventos de produto do funil de ativação (tabela `product_events`).
 *
 * ===========================================================================
 * O QUE É E O QUE NÃO É
 * ===========================================================================
 *
 * Um log append-only de COMPORTAMENTO de produto: "o usuário começou uma importação",
 * "viu os Primeiros passos". Nunca de conteúdo: nenhum valor, descrição, banco, nome de
 * arquivo, e-mail, conta, ID de transação ou mensagem de erro entra aqui.
 *
 * Isso é garantido por construção, em duas camadas:
 *
 * 1. TIPOS: `ProductEventContract` fecha, por evento, as únicas propriedades possíveis e os
 *    valores possíveis. Os componentes não passam objetos livres.
 * 2. EXECUÇÃO: `sanitizeProperties` só deixa passar as chaves e os valores da lista de
 *    permitidos de cada evento; o resto é descartado antes de sair do navegador.
 *
 * `occurred_at` NÃO é enviado: vem do relógio do banco (e o privilégio de INSERT por coluna
 * impede o cliente de enviá-lo). `user_id` é a coluna, nunca uma propriedade.
 *
 * ===========================================================================
 * CONTRATO DE FALHA
 * ===========================================================================
 *
 * Analytics nunca atrapalha o produto: as funções NÃO lançam e NÃO rejeitam. Sem sessão, é
 * no-op. Conflito de milestone (já registrado) conta como sucesso.
 */
import { supabase } from '../supabaseClient';

export type ImportFailureStage = 'file' | 'parse' | 'mapping' | 'persist' | 'quota' | 'unknown';

/** Evento sem propriedades. `keyof` vazio faz o helper não aceitar argumento. */
type NoProps = Record<never, never>;

/** Propriedades permitidas por evento. `NoProps` = nenhuma. */
export interface ProductEventContract {
  app_session_started: NoProps;
  onboarding_viewed: { version: 1 };
  onboarding_dismissed: { version: 1 };
  onboarding_resumed: { version: 1 };
  account_created: NoProps;
  import_started: NoProps;
  import_completed: NoProps;
  import_failed: { stage: ImportFailureStage };
  manual_transaction_created: NoProps;
  open_finance_started: NoProps;
  first_dashboard_with_real_data: NoProps;
}

export type ProductEventName = keyof ProductEventContract;

/** Eventos que acontecem no máximo uma vez por usuário, com a chave que os torna idempotentes. */
export const PRODUCT_MILESTONES = {
  onboarding_viewed: 'onboarding-v1-first-view',
  first_dashboard_with_real_data: 'first-dashboard-with-real-data',
} as const satisfies Partial<Record<ProductEventName, string>>;

export type ProductMilestoneName = keyof typeof PRODUCT_MILESTONES;

const IMPORT_FAILURE_STAGES: readonly ImportFailureStage[] = [
  'file',
  'parse',
  'mapping',
  'persist',
  'quota',
  'unknown',
];

/** Lista de permitidos em execução: chave → valores aceitos. Evento sem entrada não leva propriedades. */
const ALLOWED_PROPERTIES: Partial<Record<ProductEventName, Record<string, readonly unknown[]>>> = {
  onboarding_viewed: { version: [1] },
  onboarding_dismissed: { version: [1] },
  onboarding_resumed: { version: [1] },
  import_failed: { stage: IMPORT_FAILURE_STAGES },
};

/** Descarta qualquer chave ou valor fora da lista de permitidos do evento. Exportada para teste. */
export function sanitizeProperties(name: ProductEventName, properties: unknown): Record<string, unknown> {
  const allowed = ALLOWED_PROPERTIES[name];
  if (!allowed || typeof properties !== 'object' || properties === null) return {};
  const source = properties as Record<string, unknown>;
  const clean: Record<string, unknown> = {};
  for (const [key, accepted] of Object.entries(allowed)) {
    if (Object.prototype.hasOwnProperty.call(source, key) && accepted.includes(source[key])) {
      clean[key] = source[key];
    }
  }
  return clean;
}

/** Código do Postgres para violação de unicidade: milestone que já existe. */
const UNIQUE_VIOLATION = '23505';

async function currentUserId(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session?.user?.id ?? null;
  } catch {
    return null;
  }
}

async function insertEvent(
  name: ProductEventName,
  properties: unknown,
  dedupeKey: string | null
): Promise<void> {
  try {
    const userId = await currentUserId();
    if (!userId) return;
    const { error } = await supabase.from('product_events').insert({
      user_id: userId,
      event_name: name,
      dedupe_key: dedupeKey,
      properties: sanitizeProperties(name, properties),
    });
    if (error && error.code !== UNIQUE_VIOLATION) {
      // Sem console.error: não é problema do usuário e não exige ação dele.
      console.debug('[Eventos de produto] não registrado:', name, error.code ?? '');
    }
  } catch (error) {
    console.debug('[Eventos de produto] falha ao registrar:', name, error instanceof Error ? error.name : '');
  }
}

/** Evento repetível (`dedupe_key` nulo). Nunca lança. */
export function trackProductEvent<E extends Exclude<ProductEventName, ProductMilestoneName>>(
  name: E,
  ...args: keyof ProductEventContract[E] extends never ? [] : [properties: ProductEventContract[E]]
): Promise<void> {
  return insertEvent(name, args[0], null);
}

/** Milestones já enviados nesta aba: poupa a ida ao banco quando um efeito roda de novo. */
const sentMilestones = new Set<string>();

/** Milestone idempotente por usuário (`dedupe_key` fixo). Nunca lança; conflito é sucesso. */
export function trackProductMilestone<E extends ProductMilestoneName>(
  name: E,
  ...args: keyof ProductEventContract[E] extends never ? [] : [properties: ProductEventContract[E]]
): Promise<void> {
  const key = PRODUCT_MILESTONES[name];
  if (sentMilestones.has(key)) return Promise.resolve();
  sentMilestones.add(key);
  return insertEvent(name, args[0], key);
}

/** Só para teste: esquece o que esta aba já enviou. */
export function resetProductAnalyticsForTests(): void {
  sentMilestones.clear();
}

const SESSION_FLAG = 'finelo_product_session_started';

function sessionAlreadyMarked(): boolean {
  try {
    return sessionStorage.getItem(SESSION_FLAG) !== null;
  } catch {
    return false;
  }
}

function markSession(): void {
  try {
    sessionStorage.setItem(SESSION_FLAG, '1');
  } catch {
    // Sem sessionStorage (modo restrito): registra uma vez por carga.
  }
}

let sessionStartInFlight = false;

/**
 * Um `app_session_started` por sessão do navegador (aba). O `sessionStorage` só evita repetir a
 * chamada nesta aba; a fonte analítica continua sendo o banco. A marca só é gravada quando há
 * usuário autenticado: sem sessão nada é consumido e a próxima tentativa conta.
 */
export async function trackAppSessionStarted(): Promise<void> {
  if (sessionStartInFlight || sessionAlreadyMarked()) return;
  sessionStartInFlight = true;
  try {
    if (!(await currentUserId())) return;
    markSession();
    await insertEvent('app_session_started', undefined, null);
  } finally {
    sessionStartInFlight = false;
  }
}
