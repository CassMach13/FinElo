import React from 'react';
import { createRoot } from 'react-dom/client';
import AppearanceReference from '../../src/components/appearance/AppearanceReference';
import { isAppearanceTheme } from '../../src/domain/appearance/theme';
import '../../src/index.css';

const params = new URLSearchParams(location.search);
const theme = params.get('theme');
const baseline = params.get('baseline');
const Reference = baseline && /^theme-baseline-[a-z0-9_]+$/.test(baseline)
  ? (await import(/* @vite-ignore */ './' + baseline + '/AppearanceReference.tsx')).default
  : AppearanceReference;

createRoot(document.getElementById('root')!).render(
  <main className="mx-auto max-w-3xl p-4">
    <Reference preference={isAppearanceTheme(theme) ? theme : 'dark'} />
  </main>
);
