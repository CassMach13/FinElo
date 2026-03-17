
import { createClient } from '@supabase/supabase-js';

// Hardcoded creds for diagnosis script (Client Side key is safe for this)
const supabaseUrl = 'https://xotxxxohcmivyzswyjtm.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhvdHh4eG9oY21pdnl6c3d5anRtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM5MDA5ODEsImV4cCI6MjA3OTQ3Njk4MX0.U6RYQEsN-j8ALpM4jP1NcGYJPRYzXRJDFPaa_8LogLE';

const supabase = createClient(supabaseUrl, supabaseKey);

console.log('--- CHECKING FOR DUPLICATES (STRICT) ---');

async function run() {
    // Fetch ALL transactions for 'Conta XP'
    // First get Account ID
    const { data: accounts } = await supabase.from('contas').select('id').ilike('Nome_Conta', '%XP%');
    if (!accounts?.length) { console.error('Account XP not found'); return; }

    const xpId = accounts[0].id;

    const { data: transactions, error } = await supabase
        .from('transactions')
        .select('ID_Transacao, Data, Valor, Descricao_Original, Tipo, Fonte')
        .eq('ID_Conta', xpId);

    if (error) { console.error('Error:', error); return; }

    console.log(`Analyzing ${transactions.length} transactions...`);

    // Map to find duplicates
    const map = new Map<string, any[]>();
    let duplicateCount = 0;
    let duplicateSum = 0;

    transactions.forEach(t => {
        // Create a unique key based on business logic
        // Date + Value + Description (normalized)
        const dateKey = new Date(t.Data).toISOString().split('T')[0];
        const descKey = t.Descricao_Original.trim().toUpperCase();
        const key = `${dateKey}|${t.Valor}|${descKey}`;

        if (map.has(key)) {
            map.get(key)?.push(t);
        } else {
            map.set(key, [t]);
        }
    });

    map.forEach((group, key) => {
        if (group.length > 1) {
            duplicateCount += (group.length - 1);
            const val = Math.abs(group[0].Valor);
            duplicateSum += (val * (group.length - 1));

            console.log(`\nDUPLICATE SET (Count: ${group.length})`);
            console.log(`Key: ${key}`);
            group.forEach(t => console.log(` - ID: ${t.ID_Transacao} | Src: ${t.Fonte}`));
        }
    });

    console.log('-----------------------------------');
    console.log(`Total Duplicate Transactions: ${duplicateCount}`);
    console.log(`Total Value Involved (Abs): R$ ${duplicateSum.toFixed(2)}`);

    // Calculate if this explains the 851.04 discrepancy

    // Also check specifically for the sum of 851.04
    const exactMatch = transactions.find(t => Math.abs(t.Valor) === 851.04);
    if (exactMatch) {
        console.log(`\n[!] FOUND EXACT TRANSACTION MATCHING DISCREPANCY: R$ ${exactMatch.Valor}`);
        console.log(exactMatch);
    }
}

run();
