
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://xotxxxohcmivyzswyjtm.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhvdHh4eG9oY21pdnl6c3d5anRtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM5MDA5ODEsImV4cCI6MjA3OTQ3Njk4MX0.U6RYQEsN-j8ALpM4jP1NcGYJPRYzXRJDFPaa_8LogLE';

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    console.log('--- Attempting Fix with Specific Columns ---');

    // 1. Fetch with specific columns to avoid RLS/Type issues with '*'
    const { data: accounts, error } = await supabase
        .from('contas')
        .select('id, Nome_Conta, Saldo_Inicial');

    if (error) {
        console.error('Error:', error);
        return;
    }

    console.log(`Accounts found: ${accounts?.length}`);

    const xpAccount = accounts?.find(a => a.Nome_Conta === 'Cartão XP' || a.Nome_Conta.includes('Cartão XP'));

    if (!xpAccount) {
        console.error('Cartão XP not found.');
        return;
    }

    console.log(`Found: ${xpAccount.Nome_Conta} (Current: ${xpAccount.Saldo_Inicial})`);

    const newBalance = xpAccount.Saldo_Inicial - 1083.50;

    const { error: updateError } = await supabase
        .from('contas')
        .update({ Saldo_Inicial: newBalance })
        .eq('id', xpAccount.id);

    if (updateError) {
        console.error('Update failed:', updateError);
    } else {
        console.log(`SUCCESS. Updated balance to: ${newBalance.toFixed(2)}`);
    }
}

run();
