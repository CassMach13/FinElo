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

async function debug() {
    console.log('--- Subscriptions Debug ---');
    const { data, error } = await supabase
        .from('subscriptions')
        .select('*')
        .limit(10);

    if (error) {
        console.error('Error:', error);
        return;
    }

    console.log(`Found ${data.length} records.`);
    console.table(data);

    // Also check public.users if it exists
    const { data: users, error: errUsers } = await supabase
        .from('users')
        .select('*')
        .limit(10);
    
    if (!errUsers && users) {
        console.log('\n--- Public Users Debug ---');
        console.table(users);
    }
}

debug();
