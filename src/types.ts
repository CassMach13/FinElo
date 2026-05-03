
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
  Tipo_Conta: 'Conta Corrente' | 'Poupança' | 'Investimento' | 'Cartão de Crédito' | 'Cartão Alimentação' | 'Outro';
  Saldo_Inicial: number;
  Data_Saldo_Inicial: Date;
  Cor?: string;
  Icone?: string;
  bank_id?: string; // ID from NATIVE_BANK_CONFIGS
  Saldo_Atual_Calculado?: number; // <-- NOVO CAMPO: Para armazenar o saldo calculado na UI
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
  maturity_date?: string;
  invested_principal?: number;
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
  yearly_users: number;
  monthly_users: number;
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

export type AppView = 'dashboard' | 'import' | 'transactions' | 'investments' | 'settings' | 'help' | 'admin' | 'pricing' | 'success';

