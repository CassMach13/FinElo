import { createClient } from '@supabase/supabase-js'
import { APPEARANCE_THEME_KEY, type AppearanceTheme } from './domain/appearance/theme'
import { createSessionFencedFetch } from './domain/session/sessionFence'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabasePublishableKey =
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabasePublishableKey) {
    throw new Error(
        'Missing Supabase environment variables: set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.'
    );
}

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
    auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
    },
    // REST/Storage/Functions: nenhuma requisição sai com credencial de outra identidade (ver sessionFence.ts).
    global: { fetch: createSessionFencedFetch(supabaseUrl) },
});

/** A captured bearer binds the write to its initiating account. The global SDK's updateUser
 * selects its session after awaiting its lock. AppearanceSessionSync refreshes the SDK and
 * validates the server preference separately, without restoring a captured session. */
export async function persistAppearanceTheme(accessToken: string, theme: AppearanceTheme): Promise<void> {
    const response = await fetch(new URL('auth/v1/user', supabaseUrl.replace(/\/?$/, '/')), {
        method: 'PUT',
        headers: {
            apikey: supabasePublishableKey,
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ data: { [APPEARANCE_THEME_KEY]: theme } }),
    });
    if (!response.ok) throw new Error('Não foi possível salvar a aparência.');
}

/** Captured account metadata write. Never saves or restores a global SDK session. */
export async function persistUserMetadata(accessToken: string, preferences: Record<string, unknown>): Promise<void> {
    const response = await fetch(new URL('auth/v1/user', supabaseUrl.replace(/\/?$/, '/')), {
        method: 'PUT',
        headers: {
            apikey: supabasePublishableKey,
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ data: preferences }),
    });
    if (!response.ok) throw new Error('Não foi possível salvar as preferências.');
}
