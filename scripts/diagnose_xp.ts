
import { createClient } from '@supabase/supabase-js';

console.log('--- DIAGNOSIS: XP ACCOUNT BALANCE v2 ---');

// CREDENTIALS EXTRACTED FROM SRC/SUPABASECLIENT.TS
const supabaseUrl = 'https://xotxxxohcmivyzswyjtm.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhvdHh4eG9oY21pdnl6c3d5anRtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM5MDA5ODEsImV4cCI6MjA3OTQ3Njk4MX0.U6RYQEsN-j8ALpM4jP1NcGYJPRYzXRJDFPaa_8LogLE';

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    // 1. Find 'Conta XP'
    const { data: accounts, error: errAcc } = await supabase
        .from('contas')
        .select('*')
        .ilike('Nome_Conta', '%XP%');

    if (errAcc || !accounts || accounts.length === 0) {
        console.error('Account not found or error:', errAcc);
        return;
    }

    const xpAccount = accounts[0];
    console.log('Account Found:', xpAccount.Nome_Conta);
    console.log('Initial Balance:', xpAccount.Saldo_Inicial);
    console.log('Initial Date:', xpAccount.Data_Saldo_Inicial);

    // Ensure we parse as UTC midnight if that's how it's stored, or Local.
    // The store uses `new Date(string)`, which interprets "YYYY-MM-DD" as UTC8am usually? No, `new Date("2025-11-27")` is UTC. 
    // `new Date(2025, 10, 27)` is Local.
    // Let's see how string looks.

    const initialDateStr = xpAccount.Data_Saldo_Inicial;
    const initialDateObj = new Date(initialDateStr);
    // NOTE: If string is "2025-11-27", new Date() makes it UTC midnight.
    // If transaction dates are ISO strings from parser (created via new Date(Y, M, D) -> Local -> toISOString -> UTC), then comparisons might be tricky.

    const initialDateTs = initialDateObj.getTime();
    console.log(`Initial TS: ${initialDateTs} (${initialDateObj.toISOString()})`);

    // 2. Fetch Transactions
    const { data: transactions, error: errTx } = await supabase
        .from('transactions')
        .select('*')
        .eq('ID_Conta', xpAccount.id);

    if (errTx) {
        console.error('Error fetching transactions:', errTx);
        return;
    }

    console.log(`Found ${transactions.length} transactions linked to this account.`);

    let sum = 0;
    let includedCount = 0;
    let excludedCount = 0;

    // Simulate Store Logic exactly
    // return t.ID_Conta === account.id && transactionDate > initialBalanceDate;

    transactions.forEach((t: any) => {
        const tDate = new Date(t.Data).getTime();

        // Logic from useAppStore
        if (tDate > initialDateTs) {
            sum += t.Valor;
            includedCount++;
        } else {
            excludedCount++;
            // console.log(`[EXCLUDED] ${t.Data} (${new Date(t.Data).toISOString()}) - ${t.Descricao_Original}`);
        }
    });

    const finalBalance = xpAccount.Saldo_Inicial + sum;

    console.log('--- CALCULATION ---');
    console.log(`Included Transactions: ${includedCount}`);
    console.log(`Excluded Transactions: ${excludedCount}`);
    console.log(`Sum of Included: R$ ${sum.toFixed(2)}`);
    console.log(`Calculated Final: R$ ${finalBalance.toFixed(2)}`);
    console.log('-------------------');

    // Debug Exclusions significantly
    if (excludedCount > 0) {
        console.log('--- EXCLUDED ITEMS SAMPLE ---');
        transactions.filter((t: any) => new Date(t.Data).getTime() <= initialDateTs).slice(0, 5).forEach((t: any) => {
            console.log(`${t.Data} | ${t.Descricao_Original} | ${t.Valor}`);
        });
    }
}

run();
