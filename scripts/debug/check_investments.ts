import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.VITE_SUPABASE_ANON_KEY!
);

async function checkInvestments() {
    const { data, error } = await supabase
        .from('investments')
        .select('id, user_id, product_name, balance, reference_month, source_file');

    if (error) {
        console.error('Error:', error);
        return;
    }

    console.log('--- INVESTMENTS ---');
    data.forEach(inv => {
        console.log(`[${inv.source_file === null ? 'NULL' : inv.source_file}] ${inv.product_name} - ${inv.balance}`);
    });
}

checkInvestments();
