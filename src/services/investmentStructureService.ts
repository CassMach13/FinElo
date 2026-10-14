import { supabase } from '../supabaseClient';
import type { InvestmentHolding, InvestmentPortfolio } from '../types';

/**
 * Carteiras e holdings de investimentos (V2-B1A). Somente a camada de dados: nenhum componente a consome ainda.
 *
 * PROPRIETÁRIO × OPERADOR
 *  - `ownerUserId` é o dono dos dados (vai em `user_id`). Para uma operação familiar autorizada ele é diferente do
 *    operador.
 *  - O operador é SEMPRE o usuário da sessão (`supabase.auth.getUser()`); `created_by` e `updated_by` são definidos
 *    pelo banco e NUNCA enviados por aqui. A autorização final é da RLS (`has_family_access`) e das FKs compostas:
 *    este módulo não prova permissão nenhuma.
 */

const PORTFOLIO_COLUMNS = 'id,user_id,name,archived_at,created_by,created_at,updated_by,updated_at';
const HOLDING_COLUMNS = 'id,user_id,portfolio_id,display_name,institution_ref,product_type_ref,created_by,created_at,updated_by,updated_at';

export const PORTFOLIO_NAME_MAX = 80;
export const HOLDING_NAME_MAX = 120;

export type InvestmentStructureErrorCode =
  | 'unauthenticated'
  | 'invalid_name'
  | 'duplicate_name'
  | 'not_found_or_forbidden'
  | 'forbidden'
  | 'integrity'
  | 'unknown';

const MESSAGES: Record<InvestmentStructureErrorCode, string> = {
  unauthenticated: 'Entre na sua conta para continuar.',
  invalid_name: 'Informe um nome válido.',
  duplicate_name: 'Já existe uma carteira ativa com esse nome.',
  not_found_or_forbidden: 'Não encontramos esse item ou você não tem acesso a ele.',
  forbidden: 'Você não tem permissão para essa operação.',
  integrity: 'Não foi possível concluir: o item está em uso ou pertence a outro proprietário.',
  unknown: 'Não foi possível concluir a operação agora. Tente novamente.',
};

export class InvestmentStructureError extends Error {
  readonly code: InvestmentStructureErrorCode;
  constructor(code: InvestmentStructureErrorCode, cause?: unknown) {
    super(MESSAGES[code]);
    this.name = 'InvestmentStructureError';
    this.code = code;
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

/** Mapeia o erro do PostgREST/PostgreSQL para um código estável, sem vazar detalhes do banco na mensagem. */
export function mapStructureError(error: unknown): InvestmentStructureError {
  if (error instanceof InvestmentStructureError) return error;
  const e = (error ?? {}) as { code?: string };
  switch (e.code) {
    case '23505':
      return new InvestmentStructureError('duplicate_name', error);
    case '23503':
      return new InvestmentStructureError('integrity', error);
    case '23514':
      return new InvestmentStructureError('invalid_name', error);
    case '42501':
      return new InvestmentStructureError('forbidden', error);
    case 'PGRST116':
      return new InvestmentStructureError('not_found_or_forbidden', error);
    default:
      return new InvestmentStructureError('unknown', error);
  }
}

/** Operador autenticado (da sessão). Nunca aceito do chamador. */
export async function getActorUserId(): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new InvestmentStructureError('unauthenticated');
  return user.id;
}

export function normalizePortfolioName(raw: string): string {
  const name = String(raw ?? '').trim();
  if (name.length < 1 || name.length > PORTFOLIO_NAME_MAX) throw new InvestmentStructureError('invalid_name');
  return name;
}

export function normalizeHoldingName(raw: string): string {
  const name = String(raw ?? '').trim();
  if (name.length < 1 || name.length > HOLDING_NAME_MAX) throw new InvestmentStructureError('invalid_name');
  return name;
}

const optionalRef = (raw: string | null | undefined): string | null => {
  const value = String(raw ?? '').trim();
  if (value.length > HOLDING_NAME_MAX) throw new InvestmentStructureError('invalid_name');
  return value === '' ? null : value;
};

// ---------------------------------------------------------------------------------------------------------------
// Carteiras
// ---------------------------------------------------------------------------------------------------------------

/** Carteiras acessíveis pela RLS (próprias e de familiares autorizados). `ownerUserId` apenas filtra o resultado. */
export async function listPortfolios(options: { ownerUserId?: string; includeArchived?: boolean } = {}): Promise<InvestmentPortfolio[]> {
  let query = supabase.from('investment_portfolios').select(PORTFOLIO_COLUMNS);
  if (options.ownerUserId) query = query.eq('user_id', options.ownerUserId);
  if (!options.includeArchived) query = query.is('archived_at', null);
  const { data, error } = await query.order('name', { ascending: true }).order('id', { ascending: true });
  if (error) throw mapStructureError(error);
  return (data ?? []) as InvestmentPortfolio[];
}

export async function getPortfolio(id: string): Promise<InvestmentPortfolio> {
  const { data, error } = await supabase.from('investment_portfolios').select(PORTFOLIO_COLUMNS).eq('id', id).single();
  if (error) throw mapStructureError(error);
  return data as InvestmentPortfolio;
}

/** Cria uma carteira PARA o proprietário informado. O autor (`created_by`) é a sessão, atribuído pelo banco. */
export async function createPortfolio(input: { ownerUserId: string; name: string }): Promise<InvestmentPortfolio> {
  const name = normalizePortfolioName(input.name);
  await getActorUserId();
  const { data, error } = await supabase
    .from('investment_portfolios')
    .insert({ user_id: input.ownerUserId, name })
    .select(PORTFOLIO_COLUMNS)
    .single();
  if (error) throw mapStructureError(error);
  return data as InvestmentPortfolio;
}

export async function renamePortfolio(id: string, name: string): Promise<InvestmentPortfolio> {
  const next = normalizePortfolioName(name);
  await getActorUserId();
  const { data, error } = await supabase.from('investment_portfolios').update({ name: next }).eq('id', id).select(PORTFOLIO_COLUMNS).single();
  if (error) throw mapStructureError(error);
  return data as InvestmentPortfolio;
}

/** Arquiva (não exclui). A data é carimbada pelo banco. */
export async function archivePortfolio(id: string): Promise<InvestmentPortfolio> {
  await getActorUserId();
  const { data, error } = await supabase
    .from('investment_portfolios')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', id)
    .select(PORTFOLIO_COLUMNS)
    .single();
  if (error) throw mapStructureError(error);
  return data as InvestmentPortfolio;
}

export async function unarchivePortfolio(id: string): Promise<InvestmentPortfolio> {
  await getActorUserId();
  const { data, error } = await supabase.from('investment_portfolios').update({ archived_at: null }).eq('id', id).select(PORTFOLIO_COLUMNS).single();
  if (error) throw mapStructureError(error);
  return data as InvestmentPortfolio;
}

// ---------------------------------------------------------------------------------------------------------------
// Holdings
// ---------------------------------------------------------------------------------------------------------------

export async function listHoldings(options: { portfolioId?: string; ownerUserId?: string } = {}): Promise<InvestmentHolding[]> {
  let query = supabase.from('investment_holdings').select(HOLDING_COLUMNS);
  if (options.ownerUserId) query = query.eq('user_id', options.ownerUserId);
  if (options.portfolioId) query = query.eq('portfolio_id', options.portfolioId);
  const { data, error } = await query.order('display_name', { ascending: true }).order('id', { ascending: true });
  if (error) throw mapStructureError(error);
  return (data ?? []) as InvestmentHolding[];
}

export async function getHolding(id: string): Promise<InvestmentHolding> {
  const { data, error } = await supabase.from('investment_holdings').select(HOLDING_COLUMNS).eq('id', id).single();
  if (error) throw mapStructureError(error);
  return data as InvestmentHolding;
}

/** Cria a identidade de um investimento numa carteira do MESMO proprietário (o banco rejeita qualquer outra). */
export async function createHolding(input: {
  ownerUserId: string;
  portfolioId: string;
  displayName: string;
  institutionRef?: string | null;
  productTypeRef?: string | null;
}): Promise<InvestmentHolding> {
  const displayName = normalizeHoldingName(input.displayName);
  const institutionRef = optionalRef(input.institutionRef);
  const productTypeRef = optionalRef(input.productTypeRef);
  await getActorUserId();
  const { data, error } = await supabase
    .from('investment_holdings')
    .insert({
      user_id: input.ownerUserId,
      portfolio_id: input.portfolioId,
      display_name: displayName,
      institution_ref: institutionRef,
      product_type_ref: productTypeRef,
    })
    .select(HOLDING_COLUMNS)
    .single();
  if (error) throw mapStructureError(error);
  return data as InvestmentHolding;
}

/** Edita só os campos permitidos (nome e referências de exibição). Propriedade e carteira não passam por aqui. */
export async function updateHolding(
  id: string,
  changes: { displayName?: string; institutionRef?: string | null; productTypeRef?: string | null }
): Promise<InvestmentHolding> {
  const patch: Record<string, string | null> = {};
  if (changes.displayName !== undefined) patch.display_name = normalizeHoldingName(changes.displayName);
  if (changes.institutionRef !== undefined) patch.institution_ref = optionalRef(changes.institutionRef);
  if (changes.productTypeRef !== undefined) patch.product_type_ref = optionalRef(changes.productTypeRef);
  if (Object.keys(patch).length === 0) throw new InvestmentStructureError('invalid_name');
  await getActorUserId();
  const { data, error } = await supabase.from('investment_holdings').update(patch).eq('id', id).select(HOLDING_COLUMNS).single();
  if (error) throw mapStructureError(error);
  return data as InvestmentHolding;
}
