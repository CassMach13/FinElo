import { supabase } from '../supabaseClient';
import { Investment } from '../types';
import { normalizeMonthKey, type PortfolioRow } from '../domain/investments/portfolioOverview';
import { resolveCopiedClassifications, type CopiedClassification, type CopyContext } from '../domain/investments/classificationCopy';
import type { OwnerLatestPosition } from '../domain/investments/ownerInvestmentTotals';

/**
 * Campos de classificação (V2-B1B): só o serviço de estrutura os grava (`classifyInvestment`) e a cópia mensal (D1).
 * As escritas genéricas abaixo não os aceitam, nem por tipo.
 */
type ClassificationKey = 'portfolio_id' | 'holding_id' | 'classified_by' | 'classified_at';

/** Resultado da cópia mensal. `classified`/`leftUnclassified` só contam quando a cópia preserva classificação (D1). */
export interface CopyFromPreviousMonthResult {
    copied: number;
    classified: number;
    leftUnclassified: number;
}

/** Contexto da D1: carteiras e ativos do proprietário e os ativos já usados no mês de destino. Somente leitura. */
async function loadCopyContext(userId: string, targetReferenceMonth: string): Promise<CopyContext> {
    const [portfolios, holdings, target] = await Promise.all([
        supabase.from('investment_portfolios').select('id,user_id,archived_at').eq('user_id', userId),
        supabase.from('investment_holdings').select('id,user_id,portfolio_id').eq('user_id', userId),
        supabase.from('investments').select('holding_id').eq('user_id', userId).eq('reference_month', targetReferenceMonth),
    ]);
    const error = portfolios.error || holdings.error || target.error;
    if (error) throw error;
    return {
        ownerUserId: userId,
        portfolios: (portfolios.data ?? []) as CopyContext['portfolios'],
        holdings: (holdings.data ?? []) as CopyContext['holdings'],
        holdingsUsedInTarget: new Set(((target.data ?? []) as Array<{ holding_id: string | null }>).map((r) => r.holding_id).filter((id): id is string => !!id)),
    };
}

export const investmentService = {
    /**
     * Posições do mês, TODAS (paginado: o PostgREST limita 1000 linhas por resposta). Ordem estável (instituição, id)
     * para não repetir/perder linhas entre páginas; uma página com erro falha a chamada inteira (nunca lista parcial).
     * `userId` opcional: quando informado, filtra explicitamente o mesmo escopo owner-only do histórico.
     */
    async getInvestments(month: Date, userId?: string): Promise<Investment[]> {
        // Determine the reference_month string (YYYY-MM-01)
        const year = month.getFullYear();
        const monthNum = String(month.getMonth() + 1).padStart(2, '0');
        const referenceMonth = `${year}-${monthNum}-01`;

        const PAGE = 1000;
        const rows: Investment[] = [];
        for (let from = 0; ; from += PAGE) {
            let query = supabase.from('investments').select('*');
            if (userId) query = query.eq('user_id', userId);
            const { data, error } = await query
                .eq('reference_month', referenceMonth)
                .order('institution', { ascending: true })
                .order('id', { ascending: true })
                .range(from, from + PAGE - 1);

            if (error) {
                console.error('Error fetching investments:', error);
                throw error;
            }
            const page = (data ?? []) as Investment[];
            rows.push(...page);
            if (page.length < PAGE) break;
        }

        return rows;
    },

    async addInvestment(investment: Omit<Investment, 'id' | 'created_at' | 'updated_at' | ClassificationKey>): Promise<Investment> {
        const { data, error } = await supabase
            .from('investments')
            .insert([investment])
            .select()
            .single();

        if (error) {
            console.error('Error adding investment:', error);
            throw error;
        }

        return data as Investment;
    },

    async updateInvestment(id: string, updates: Partial<Omit<Investment, 'id' | 'user_id' | 'created_at' | 'updated_at' | ClassificationKey>>): Promise<Investment> {
        const { data, error } = await supabase
            .from('investments')
            .update(updates)
            .eq('id', id)
            .select()
            .single();

        if (error) {
            console.error('Error updating investment:', error);
            throw error;
        }

        return data as Investment;
    },

    async deleteInvestment(id: string): Promise<void> {
        const { error } = await supabase
            .from('investments')
            .delete()
            .eq('id', id);

        if (error) {
            console.error('Error deleting investment:', error);
            throw error;
        }
    },

    async deleteInvestmentsByInstitutionAndMonth(userId: string, institution: string, referenceMonth: string): Promise<void> {
        const cleanInstitution = institution.trim();
        const cleanMonth = referenceMonth.trim();

        if (!cleanInstitution) {
            throw new Error('Nome da instituição não pode ser vazio para exclusão.');
        }

        const { error } = await supabase
            .from('investments')
            .delete()
            .eq('user_id', userId)
            .eq('institution', cleanInstitution)
            .eq('reference_month', cleanMonth);

        if (error) {
            console.error('Error deleting institution investments:', error);
            throw error;
        }
    },

    async importInvestmentsBatch(investments: Omit<Investment, 'id' | 'created_at' | 'updated_at' | ClassificationKey>[]): Promise<void> {
        if (investments.length === 0) return;

        const { error } = await supabase
            .from('investments')
            .insert(investments);

        if (error) {
            console.error('Error in batch insert:', error);
            throw error;
        }
    },

    async checkIfFileAlreadyImported(userId: string, institution: string, referenceMonth: string, fileName: string): Promise<boolean> {
        const { data, error } = await supabase
            .from('investments')
            .select('id')
            .eq('user_id', userId)
            .eq('institution', institution)
            .eq('reference_month', referenceMonth)
            .eq('source_file', fileName)
            .limit(1);

        if (error) {
            console.error('Error checking for duplicate file:', error);
            throw error;
        }

        return data && data.length > 0;
    },

    // Helper to copy investments from previous month
    /**
     * `preserveClassification` (D1, só com a interface de carteiras ligada): a nova posição mantém carteira e ativo
     * quando continuam válidos (ver `resolveCopiedClassifications`). Desligado = comportamento de sempre, sem nenhuma
     * consulta às tabelas de carteiras. Nunca sobrescreve posições existentes: só insere.
     */
    async copyFromPreviousMonth(userId: string, targetMonth: Date, options: { preserveClassification?: boolean } = {}): Promise<CopyFromPreviousMonthResult> {
        // 1. Get the previous month's string
        const targetDate = new Date(targetMonth);
        const year = targetDate.getFullYear();
        const monthNum = String(targetDate.getMonth() + 1).padStart(2, '0');
        const targetReferenceMonth = `${year}-${monthNum}-01`;

        const prevDate = new Date(targetMonth);
        prevDate.setMonth(prevDate.getMonth() - 1);
        const prevYear = prevDate.getFullYear();
        const prevMonthNum = String(prevDate.getMonth() + 1).padStart(2, '0');
        const prevReferenceMonth = `${prevYear}-${prevMonthNum}-01`;

        // 2. Fetch previous month's investments
        const { data: previousInvestments, error: fetchError } = await supabase
            .from('investments')
            .select('*')
            .eq('user_id', userId)
            .eq('reference_month', prevReferenceMonth);

        if (fetchError) {
            console.error('Error fetching previous investments:', fetchError);
            throw fetchError;
        }

        if (!previousInvestments || previousInvestments.length === 0) {
            return { copied: 0, classified: 0, leftUnclassified: 0 }; // Nothing to copy
        }

        // 3. Insert them into the new month
        const newInvestments = previousInvestments.map((inv) => ({
            user_id: userId,
            institution: inv.institution,
            product_type: inv.product_type,
            product_name: inv.product_name,
            yield_rate: inv.yield_rate,
            monthly_yield_rate: inv.monthly_yield_rate,
            application_date: inv.application_date,
            maturity_date: inv.maturity_date,
            invested_principal: inv.invested_principal,
            gross_return_amount: inv.gross_return_amount,
            original_applied_amount: inv.original_applied_amount,
            balance: inv.balance,
            reference_month: targetReferenceMonth,
        }));

        // D1: classificação só quando pedida e quando a origem tinha alguma; contexto ilegível = cópia sem carteira.
        const sourceClassified = previousInvestments.filter((inv) => inv.portfolio_id).length;
        let classifications: CopiedClassification[] | null = null;
        if (options.preserveClassification && sourceClassified > 0) {
            try {
                classifications = resolveCopiedClassifications(previousInvestments, await loadCopyContext(userId, targetReferenceMonth));
            } catch (contextError) {
                console.error('Error loading portfolios for copy; copying without classification:', contextError);
            }
        }
        const withClassification = classifications
            ? newInvestments.map((row, i) => {
                const c = classifications![i];
                return c.portfolio_id ? { ...row, portfolio_id: c.portfolio_id, holding_id: c.holding_id } : row;
            })
            : newInvestments;
        const classified = classifications ? classifications.filter((c) => c.portfolio_id).length : 0;

        const { error: insertError } = await supabase
            .from('investments')
            .insert(withClassification);

        if (insertError) {
            // Associação invalidada entre a leitura e a gravação (ativo usado no mês, carteira removida): o INSERT é
            // atômico e nada foi gravado; copia uma única vez sem classificação, como antes da D1.
            const code = (insertError as { code?: string }).code;
            if (classified > 0 && (code === '23505' || code === '23503')) {
                const { error: retryError } = await supabase.from('investments').insert(newInvestments);
                if (retryError) {
                    console.error('Error copying investments:', retryError);
                    throw retryError;
                }
                return { copied: newInvestments.length, classified: 0, leftUnclassified: sourceClassified };
            }
            console.error('Error copying investments:', insertError);
            throw insertError;
        }

        return {
            copied: newInvestments.length,
            classified,
            leftUnclassified: options.preserveClassification ? sourceClassified - classified : 0,
        };
    },

    /**
     * Histórico read-only: só as colunas necessárias, intervalo [startKey, endKey] por reference_month (date-only),
     * paginado (o PostgREST limita 1000 linhas por resposta) e com ordenação estável para não repetir/perder linhas.
     */
    async getInvestmentHistory(userId: string, startKey: string, endKey: string): Promise<PortfolioRow[]> {
        const PAGE = 1000;
        const rows: PortfolioRow[] = [];
        for (let from = 0; ; from += PAGE) {
            const { data, error } = await supabase
                .from('investments')
                .select('id, institution, balance, reference_month')
                .eq('user_id', userId)
                .gte('reference_month', startKey)
                .lte('reference_month', endKey)
                .order('reference_month', { ascending: true })
                .order('id', { ascending: true })
                .range(from, from + PAGE - 1);

            if (error) {
                console.error('Error fetching investment history:', error);
                throw error;
            }
            const page = (data ?? []) as PortfolioRow[];
            rows.push(...page);
            if (page.length < PAGE) break;
        }
        return rows;
    },

    /** Maior reference_month (YYYY-MM-01) <= todayKey que tenha posições do usuário; null se não houver. */
    async getLatestReferenceMonthKey(userId: string, todayKey: string): Promise<string | null> {
        const { data, error } = await supabase
            .from('investments')
            .select('reference_month')
            .eq('user_id', userId)
            .lte('reference_month', todayKey)
            .order('reference_month', { ascending: false })
            .limit(1);

        if (error) {
            console.error('Error finding latest investment month:', error);
            throw error;
        }
        return data && data.length > 0 ? normalizeMonthKey(data[0].reference_month) : null;
    },

    /**
     * Dashboard por proprietário: a ÚLTIMA posição de CADA proprietário até a data de corte, consultada com o filtro
     * explícito de dono (a RLS continua autorizando). Meses podem diferir entre proprietários; quem não tem posição
     * volta com `monthKey: null`. Uma falha em qualquer proprietário falha a chamada inteira (nunca total parcial).
     */
    async getLatestPositionsByOwner(endDate: Date, ownerUserIds: readonly string[]): Promise<OwnerLatestPosition[]> {
        const endKey = endDate.toISOString().split('T')[0];
        const owners = [...new Set(ownerUserIds.filter(Boolean))];
        return Promise.all(owners.map(async (ownerUserId) => {
            const monthKey = await this.getLatestReferenceMonthKey(ownerUserId, endKey);
            if (!monthKey) return { ownerUserId, monthKey: null, balances: [] };
            const rows = await this.getInvestments(new Date(`${monthKey}T12:00:00`), ownerUserId);
            return { ownerUserId, monthKey, balances: rows.map((r) => r.balance) };
        }));
    },

    async getLatestInvestments(endDate: Date): Promise<Investment[]> {
        // 1. Find the latest reference_month <= endDate that has records
        const { data: latestDate, error: dateError } = await supabase
            .from('investments')
            .select('reference_month')
            .lte('reference_month', endDate.toISOString().split('T')[0])
            .order('reference_month', { ascending: false })
            .limit(1);

        if (dateError) {
            console.error('Error finding latest investment month:', dateError);
            throw dateError;
        }

        if (!latestDate || latestDate.length === 0) return [];

        // 2. Fetch all records for that specific month
        return this.getInvestments(new Date(latestDate[0].reference_month + 'T12:00:00'));
    }
};
