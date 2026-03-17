import { createClient } from '@supabase/supabase-js'

// ATENÇÃO: Substitua pelos seus próprios valores do Supabase!
// Você encontra isso no seu projeto Supabase em: Project Settings > API
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing Supabase environment variables! Check your .env file.');
}

// Cria e exporta o cliente Supabase para ser usado em toda a aplicação
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
