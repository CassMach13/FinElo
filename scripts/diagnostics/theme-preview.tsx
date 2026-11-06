import React from 'react';
import { createRoot } from 'react-dom/client';
import AppearanceReference from '../../src/components/appearance/AppearanceReference';
import { isAppearanceTheme } from '../../src/domain/appearance/theme';
import '../../src/index.css';
import { useAppStore } from '../../src/hooks/useAppStore';
import type { User } from '@supabase/supabase-js';

// Local visual fixture only. No Auth session, financial records or network access.
useAppStore.getState().setUser({ id:'visual-reference', email:'qa@example.invalid', user_metadata:{full_name:'QA FinElo'}, app_metadata:{} } as User);

const params = new URLSearchParams(location.search);
const theme = params.get('theme');
const baseline = params.get('baseline');
const Reference = baseline && /^theme-baseline-[a-z0-9_]+$/.test(baseline)
  ? (await import(/* @vite-ignore */ './' + baseline + '/AppearanceReference.tsx')).default
  : AppearanceReference;

createRoot(document.getElementById('root')!).render(
  <div>
    <Reference preference={isAppearanceTheme(theme) ? theme : 'dark'} />
  </div>
);
