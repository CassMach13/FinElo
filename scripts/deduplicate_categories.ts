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

async function deduplicateCategories() {
    console.log('--- Checking for Duplicate Categories ---');

    // 1. Fetch all categories
    const { data: categories, error } = await supabase
        .from('categories')
        .select('*');

    if (error) {
        console.error('Error fetching categories:', error);
        return;
    }

    // 2. Group by Name (normalized)
    const map = new Map<string, any[]>();

    categories?.forEach(c => {
        const key = c.Nome_Categoria.trim().toLowerCase();
        if (!map.has(key)) map.set(key, []);
        map.get(key)?.push(c);
    });

    // 3. Identify Duplicates
    for (const [key, list] of map.entries()) {
        if (list.length > 1) {
            console.log(`Duplicate Group Found: "${key}" (${list.length} items)`);

            // Assume list[0] is the "Master" (Keep)
            // Assume others are "Duplicates" (Delete)
            // Prefer keeping the one with 'Ambos' if any, or the oldest/newest?
            // Let's sort: Prioritize 'Ambos', then ID/created_at

            list.sort((a, b) => {
                if (a.Tipo === 'Ambos' && b.Tipo !== 'Ambos') return -1; // Keep Ambos
                if (b.Tipo === 'Ambos' && a.Tipo !== 'Ambos') return 1;
                // If same type, maybe keep the one with lowest ID (older)?
                return a.id.localeCompare(b.id);
            });

            const master = list[0];
            const duplicates = list.slice(1);

            console.log(`  Master: [${master.id}] ${master.Nome_Categoria} (${master.Tipo})`);

            for (const dup of duplicates) {
                console.log(`  Duplicate to Remove: [${dup.id}] ${dup.Nome_Categoria} (${dup.Tipo})`);

                // 4. Migrate Transactions from Duplicate to Master
                const { error: updateError, count } = await supabase
                    .from('transactions')
                    .update({ Categoria: master.Nome_Categoria }) // Update by Name or ID? logic uses Name usually in this app?
                    // Wait, transactions table stores 'Categoria' as STRING (Name)? 
                    // Let's check a sample transaction. `Categoria` field is string.
                    // BUT if they have same name, transactions are already linked to the "Name".
                    // So deleting the duplicate row in `categories` table MIGHT NOT affect transactions if they link by Name string.
                    // However, if the app uses ID relationships (unlikely based on types.ts), we need to check.
                    // types.ts: `Categoria: string;` -> It is by Name.

                    // If stored by Name, deleting the duplicate `categories` row is safe provided the Master has the same Name.
                    // Just need to ensure case sensitivity matches?
                    // If master name is "Estornos/Reembolsos", dup is "estornos/reembolsos", transactions might be using "estornos...".
                    // So we should normalize transaction strings to Master Name.

                    .eq('Categoria', dup.Nome_Categoria);

                // Actually, let's just update all transactions that match the duplicate's name EXACTLY to the Master's name EXACTLY.
                if (dup.Nome_Categoria !== master.Nome_Categoria) {
                    const { error: txError } = await supabase
                        .from('transactions')
                        .update({ Categoria: master.Nome_Categoria })
                        .eq('Categoria', dup.Nome_Categoria);

                    if (txError) console.error('Error migrating transactions:', txError);
                    else console.log('  Migrated transactions to Master Name.');
                }

                // 5. Delete Duplicate Category
                const { error: delError } = await supabase
                    .from('categories')
                    .delete()
                    .eq('id', dup.id);

                if (delError) console.error('Error deleting duplicate:', delError);
                else console.log('  Deleted Duplicate Category.');
            }
        }
    }

    if (map.size === categories?.length) {
        console.log('No duplicates found by standard normalization.');
        console.log('Listing ALL categories for inspection:');
        categories?.forEach(c => {
            console.log(`[${c.id}] "${c.Nome_Categoria}" (Len: ${c.Nome_Categoria.length})`);
            // Print char codes if suspicious
            const codes = c.Nome_Categoria.split('').map(char => char.charCodeAt(0));
            console.log(`      Codes: ${codes.join(', ')}`);
        });
    } else {
        console.log('Deduplication logic finished.');
    }
}

deduplicateCategories();
