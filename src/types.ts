
export interface Transaction {
  ID_Transacao?: string;
  user_id?: string;
  ID_Conta?: string; // <-- NOVO CAMPO: Chave estrangeira para a tabela de contas
  Data: Date;
  Data_Pagamento?: Date;
  Descricao_Original: string;
  Nome_Fantasia: string;
  Portador?: string;
  Parcela_Atual?: number;
  Total_Parcelas?: number;
  Valor: number;
  Tipo: 'Renda' | 'Despesa';
  Categoria: string;
  Origem: 'manual' | string; // 'manual' ou o nome do arquivo de importação
  Fonte: string;
  Tags?: string[];
  Observacoes?: string;
  linked_asset_id?: string;
}

export interface Account {
  id: string;
  user_id: string;
  Nome_Conta: string;
  Tipo_Conta: 'Conta Corrente' | 'Poupança' | 'Investimento' | 'Cartão de Crédito' | 'Cartão Alimentação' | 'Dinheiro em Espécie' | 'Outro';
  Saldo_Inicial: number;
  Data_Saldo_Inicial: Date;
  Cor?: string;
  Icone?: string;
  bank_id?: string; // ID from NATIVE_BANK_CONFIGS
  Saldo_Atual_Calculado?: number; // <-- NOVO CAMPO: Para armazenar o saldo calculado na UI
  is_archived?: boolean;

  // Campos exclusivos de Cartão de Crédito
  limite_credito?: number;   // Limite total do cartão (ex: 10000)
  dia_vencimento?: number;   // Dia do vencimento da fatura (ex: 10)
  dia_fechamento?: number;   // Dia de fechamento da fatura (ex: 5)
}

export interface Category {
  id: string;
  Nome_Categoria: string;
  Tipo: 'Renda' | 'Despesa' | 'Ambos';
  is_investment?: boolean;
  is_essential?: boolean;
}

export interface Budget {
  id?: string;
  Categoria: string;
  Valor_Limite_Mensal: number;
  ano: number;
}

export interface Investment {
  id: string;
  user_id: string;
  institution: string;
  product_type: string;
  product_name?: string;
  yield_rate?: string;
  /** Rendimento ou juros mensais esperados (manual ou planilha). */
  monthly_yield_rate?: string;
  application_date?: string;
  maturity_date?: string;
  invested_principal?: number;
  /** Rendimento bruto informado no extrato XP (ex.: coluna Rendimento bruto). */
  gross_return_amount?: number;
  /** Valor aplicado original do extrato, quando a seção traz essa coluna. */
  original_applied_amount?: number;
  balance: number;
  reference_month: string; // ISO date string matching the first of the month
  source_file?: string;
  created_at?: string;
  updated_at?: string;
}

export interface MappingRule {
  id: string;
  Texto_Contido_Descricao: string;
  Nome_Fantasia_Sugerido: string;
  Categoria_Sugerida: string;
  linked_asset_id?: string;
}

export interface ImportConfig {
  id: string;
  Nome_Fonte: string;
  ID_Conta_Associada?: string | null; // <-- NOSSA NOVA PONTE
  Tipo_Fonte: 'Conta' | 'Cartao' | 'Cartão Alimentação' | 'Conta Corrente' | 'Poupança' | 'Investimento' | 'Cartão de Crédito' | 'Outro';
  Fonte_Manual?: boolean; // Nova propriedade para fontes sem arquivo
  Coluna_Data?: string;
  Coluna_Descricao_1?: string;
  Coluna_Descricao_2?: string;
  Coluna_Parcelas?: string; // Stored as string to match others
  Coluna_Valor?: string;
  Coluna_Portador?: string;
  Ignorar_Indices?: any[]; // JSONB array in DB
  Tem_Cabecalho: boolean;
  Linhas_Ignorar_Inicio: number;
  Texto_Ignorar_Linha_Contendo?: string[];
  Texto_Parar_Leitura_Contendo?: string; // Nova regra para parar a leitura
}

export interface ImportLog {
  id: string;
  user_id: string;
  file_name: string;
  import_date: string;
  total_transactions: number;
  imported_count: number;
  ignored_count: number;
  ignored_details: any;
  imported_details?: any;
}

export interface CardImportCycleInput {
  mode?: 'auto' | 'manual';
  referenceLabel?: string | null; // YYYY-MM
  dueDate?: string | null; // YYYY-MM-DD
}

export type CreditCardEntryDirection = 'debit' | 'credit';
export type CreditCardEntryType =
  | 'purchase'
  | 'installment_purchase'
  | 'refund'
  | 'invoice_payment'
  | 'fee'
  | 'interest'
  | 'adjustment'
  | 'ignored'
  | 'needs_review';
export type CreditCardClassificationSource = 'import_rule' | 'user' | 'system' | 'reprocess';

export interface CreditCard {
  id: string;
  user_id: string;
  account_id: string;
  name: string;
  holder_name?: string | null;
  issuer?: string | null;
  limit_amount: number;
  closing_day: number;
  due_day: number;
  linked_payment_account_id?: string | null;
  archived: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface CreditCardImportLot {
  id: string;
  user_id: string;
  card_id: string;
  account_id: string;
  source_file_name: string;
  source_file_path?: string | null;
  imported_at: string;
  statement_due_year: number;
  statement_due_month: number;
  statement_due_date?: string | null;
  purchase_reference_label?: string | null;
  status: 'pending_review' | 'confirmed' | 'reprocessed' | 'error';
  raw_row_count: number;
  imported_row_count: number;
  ignored_row_count: number;
  checksum?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface CreditCardEntry {
  id: string;
  user_id: string;
  card_id: string;
  account_id: string;
  import_lot_id: string;
  source_file_name: string;
  source_row_index: number;
  source_row_hash: string;
  transaction_id?: string | null;
  posted_date?: string | null;
  description_raw: string;
  description_normalized?: string;
  merchant_name?: string | null;
  holder_name?: string | null;
  amount: number;
  abs_amount: number;
  direction: CreditCardEntryDirection;
  entry_type: CreditCardEntryType;
  installment_current?: number | null;
  installment_total?: number | null;
  category_id?: string | null;
  classification_source: CreditCardClassificationSource;
  classification_confidence?: number;
  statement_id?: string | null;
  created_at?: string;
  updated_at?: string;
}

export type CreditCardStatementStatus = 'open' | 'closed' | 'paid' | 'partial';

export interface CreditCardStatement {
  id: string;
  user_id: string;
  account_id: string;
  reference_label: string;
  close_date?: string | null;
  due_date?: string | null;
  total_charges: number;
  total_credits: number;
  total_payments: number;
  open_amount: number;
  source_origin?: string | null;
  status: CreditCardStatementStatus;
  created_at?: string;
  updated_at?: string;
}

export type CreditCardStatementItemType = 'charge' | 'refund' | 'payment';

export interface CreditCardStatementItem {
  id: string;
  user_id: string;
  account_id: string;
  statement_id: string;
  transaction_id?: string | null;
  item_type: CreditCardStatementItemType;
  amount: number;
  posted_date?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface CreditCardStatementV2 {
  id: string;
  user_id: string;
  card_id: string;
  account_id: string;
  purchase_reference_label: string;
  due_year: number;
  due_month: number;
  due_date?: string | null;
  closing_date?: string | null;
  status: 'open' | 'closed' | 'paid' | 'partial' | 'overdue';
  source_import_lot_ids?: string[];
  total_purchases: number;
  total_fees: number;
  total_interest: number;
  total_refunds: number;
  statement_total: number;
  total_payments: number;
  open_balance: number;
  created_at?: string;
  updated_at?: string;
  /** Total oficial da competência (extrato / reconstrução por histórico). */
  statement_total_from_file?: number | null;
  /** Pagamentos oficiais na competência do arquivo. */
  total_payments_from_file?: number | null;
  /** Indicações manuais do usuário para total/pago desta competência (sobrescreve o motor no recálculo). */
  manual_totals?: ManualStatementTotalsPayload | null;
}

/** Totais conferidos pelo usuário na fatura física/digital. */
export interface ManualStatementTotalsPayload {
  use_manual: boolean;
  /** Se omitido/null com use_manual, mantém valor calculado pelo motor. */
  statement_total?: number | null;
  total_payments?: number | null;
  user_note?: string | null;
  /** 'credit': pagamento a mais; 'bank_adjustment': arredondamento/ajuste; 'offset_prior_credit': abateu déficit com crédito declarado em meses anteriores. */
  micro_divergence_feedback?: 'credit' | 'bank_adjustment' | 'offset_prior_credit' | null;
  /** Valor (R$) somado ao total pago para zerar micro-déficit usando crédito de meses anteriores. */
  prior_credit_abatement?: number | null;
}

export interface CreditCardPayment {
  id: string;
  user_id: string;
  card_id: string;
  statement_id: string;
  payment_account_id?: string | null;
  payment_transaction_id?: string | null;
  payment_date: string;
  amount: number;
  source: 'manual' | 'imported_statement' | 'bank_account_import';
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface CreditCardStatementAudit {
  statementId: string;
  sourceCsvRows: number;
  importedEntries: number;
  statementItems: number;
  ignoredRows: number;
  needsReviewRows: number;
  purchasesTotal: number;
  refundsTotal: number;
  feesTotal: number;
  interestTotal: number;
  paymentsFromNextInvoice: number;
  statementTotal: number;
  openBalance: number;
  unclassifiedPositiveEntries: number;
  rowsInImportNotInStatement: number;
  rowsInStatementNotInImport: number;
  duplicateSourceHashes: number;
  crossCardContaminationRisk: boolean;
}

export type CreditCardReprocessJobStatus = 'running' | 'success' | 'failed';

export interface CreditCardReprocessJob {
  id: string;
  user_id: string;
  account_id: string;
  started_at: string;
  finished_at?: string | null;
  status: CreditCardReprocessJobStatus;
  summary_json?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

export interface SupportMessage {
  id: string;
  ticket_id: string;
  sender_id: string;
  message: string;
  attachment_url?: string;
  created_at: string;
  is_admin_reply?: boolean; // Helper to distinguish in UI easily
}

export interface SupportTicket {
  id: string;
  user_id: string;
  protocol?: string; // New field
  type: 'bug' | 'feature' | 'question';
  subject: string;
  description: string;
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  attachment_url?: string;
  created_at: string;
  updated_at: string;
  admin_response?: string; // Legacy/Deprecated
  messages?: SupportMessage[];
}

export interface Subscription {
  status: 'active' | 'canceled' | 'past_due' | 'trialing' | 'lifetime' | null;
  plan_type: 'monthly' | 'annual' | 'lifetime' | 'free' | null;
  plan?: string | null;
  current_period_end: string | null;
  family_slots?: number;
  tier?: 'pro' | 'wealth' | string;
  unlimited_sync?: boolean;
}

export interface Asset {
  id: string;
  user_id: string;
  name: string;
  type: 'car' | 'property' | 'other';
  value: number;
  description?: string;
  acquisition_date?: string;
  
  // Financing fields
  is_financed?: boolean;
  financing_type?: 'financing' | 'consortium'; // More specific than is_financed
  financed_amount?: number;
  remaining_balance?: number;
  installment_value?: number;
  total_installments?: number;
  paid_installments?: number;
  monthly_interest_rate?: number; // In % e.g. 0.89 = 0.89% p.m.
  consortium_admin_rate?: number;  // In % e.g. 20 = 20% total
  
  updated_at: string;
}

export interface AdminCrmUser {
  id: string;
  email: string;
  full_name: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  plan_type: string | null;
  tier: string | null;
  plan_status: string | null;
}

export interface AdminMetrics {
  total_users: number;
  new_users_30_days: number;
  free_users: number;
  pro_users: number;
  wealth_users: number;
  founders_users: number;
  crm_users?: AdminCrmUser[];
}

// --- Open Finance ---

export type PluggyConfidence = 'alta' | 'media' | 'nova';

export interface PluggyTransactionDraft {
  pluggy_id: string;
  data: string;           // YYYY-MM-DD
  descricao: string;
  valor: number;          // always positive
  tipo: 'Despesa' | 'Renda';
  categoria: string;      // suggested by motor
  confianca: PluggyConfidence;
  selecionada: boolean;
  id_match_manual?: string; // ID of matching manual transaction for merge
}

export interface PluggyConnection {
  id: string;
  item_id: string;
  bank_name: string;
  status: string;
  created_at: string;
  ID_Conta_Associada?: string | null;
}

export interface FamilyMember {
  id: string;
  owner_id: string;
  owner_email: string;
  member_email: string;
  status: 'pending' | 'accepted' | 'declined';
  created_at: string;
}

export type AppView =
  | 'dashboard'
  | 'import'
  | 'transactions'
  | 'investments'
  | 'settings'
  | 'help'
  | 'admin'
  | 'pricing'
  | 'success';

