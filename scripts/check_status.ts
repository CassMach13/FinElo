
import { createClient } from '@supabase/supabase-js';

console.log('--- CHECKING ACCOUNT STATUS ---');

const supabaseUrl = 'https://xotxxxohcmivyzswyjtm.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhvdHh4eG9oY21pdnl6c3d5anRtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM5MDA5ODEsImV4cCI6MjA3OTQ3Njk4MX0.U6RYQEsN-j8ALpM4jP1NcGYJPRYzXRJDFPaa_8LogLE';

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
