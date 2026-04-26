import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('ERROR: Supabase credentials not found in .env.local');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    const { data: accounts, error: errAcc } = await supabase
        .from('contas')
        .select('*')
        .ilike('Nome_Conta', '%XP%');

    if (errAcc || !accounts || accounts.length === 0) {
        console.error('Account not found:', errAcc);
        return;
    }

    const xp = accounts[0];
    console.log(`Account: ${xp.Nome_Conta}`);
    console.log(`Initial Balance: R$ ${xp.Saldo_Inicial}`);
    console.log(`Initial Date: ${xp.Data_Saldo_Inicial}`);

    const { count, error: errTx } = await supabase
        .from('transactions')
        .select('*', { count: 'exact', head: true })
        .eq('ID_Conta', xp.id);

    console.log(`Existing Transactions: ${count}`);
}

run();
