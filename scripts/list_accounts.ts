
import { createClient } from '@supabase/supabase-js';

console.log('--- LISTING ALL ACCOUNTS ---');

const supabaseUrl = 'https://xotxxxohcmivyzswyjtm.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhvdHh4eG9oY21pdnl6c3d5anRtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM5MDA5ODEsImV4cCI6MjA3OTQ3Njk4MX0.U6RYQEsN-j8ALpM4jP1NcGYJPRYzXRJDFPaa_8LogLE';

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    const { data: accounts, error: errAcc } = await supabase
        .from('contas')
        .select('id, Nome_Conta, Saldo_Inicial, Data_Saldo_Inicial');

    if (errAcc) {
        console.error('Error fetching accounts:', errAcc);
        return;
    }

    console.log(`Found ${accounts.length} accounts:`);
    accounts.forEach(acc => {
        console.log(`[${acc.Nome_Conta}] (ID: ${acc.id})`);
        console.log(`   Initial: R$ ${acc.Saldo_Inicial} on ${acc.Data_Saldo_Inicial}`);
    });
}

run();
