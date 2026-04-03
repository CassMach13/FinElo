import { supabase } from '../supabaseClient';
import { Investment } from '../types';

export const investmentService = {
    async getInvestments(month: Date): Promise<Investment[]> {
        // Determine the reference_month string (YYYY-MM-01)
        const year = month.getFullYear();
        const monthNum = String(month.getMonth() + 1).padStart(2, '0');
        const referenceMonth = `${year}-${monthNum}-01`;

        const { data, error } = await supabase
            .from('investments')
            .select('*')
            .eq('reference_month', referenceMonth)
            .order('institution', { ascending: true });

        if (error) {
            console.error('Error fetching investments:', error);
            throw error;
        }

        return data as Investment[];
    },

    async addInvestment(investment: Omit<Investment, 'id' | 'created_at' | 'updated_at'>): Promise<Investment> {
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

    async updateInvestment(id: string, updates: Partial<Omit<Investment, 'id' | 'user_id' | 'created_at' | 'updated_at'>>): Promise<Investment> {
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

    async importInvestmentsBatch(investments: Omit<Investment, 'id' | 'created_at' | 'updated_at'>[]): Promise<void> {
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
    async copyFromPreviousMonth(userId: string, targetMonth: Date): Promise<void> {
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
            .eq('reference_month', prevReferenceMonth);

        if (fetchError) {
            console.error('Error fetching previous investments:', fetchError);
            throw fetchError;
        }

        if (!previousInvestments || previousInvestments.length === 0) {
            return; // Nothing to copy
        }

        // 3. Insert them into the new month
        const newInvestments = previousInvestments.map(inv => ({
            user_id: userId,
            institution: inv.institution,
            product_type: inv.product_type,
            balance: inv.balance,
            reference_month: targetReferenceMonth,
        }));

        const { error: insertError } = await supabase
            .from('investments')
            .insert(newInvestments);

        if (insertError) {
            console.error('Error copying investments:', insertError);
            throw insertError;
        }
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
