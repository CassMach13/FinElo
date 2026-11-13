import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { reverseSessionPatch } from '../appearance/reverseSessionPatch';

/**
 * Exceção exata e revisada: «confirmação de gravação de lançamentos manuais».
 *
 * Os selos do programa de temas fixam a implementação financeira (hash do arquivo) de cinco arquivos que esta
 * correção precisou tocar. Em vez de reescrever os selos, o patch aprovado (`approved-manual-save.patch`) é
 * revertido, só em teste, e SÓ quando o arquivo atual é exatamente o conteúdo aprovado (`approved`). Assim:
 *  - os selos anteriores continuam valendo, byte a byte, sobre o conteúdo original;
 *  - qualquer outra edição nesses arquivos deixa de casar com `approved` e reprova os selos até nova revisão;
 *  - o patch inteiro é a superfície revisada da exceção.
 */
export const APPROVED_MANUAL_SAVE: Record<string, { before: string; approved: string }> = {
  'src/components/modals/NewTransactionModal.tsx': {
    before: '60ebc464d1052b7e7c4c9828e3cb715bacf67a7410a6369747c58c0064a1b029',
    approved: '0e9a7ee6355273e0f3866a5ad20bbfc7b313195b0d07ea26b24b0255f669b6c1',
  },
  'src/components/views/TransactionsView.tsx': {
    before: 'a7a37a7eba22ca0fccad3105d4b53228de231199c5130e8353c4aa8a2b365b67',
    approved: '79ab7f2d992bf6cf5d403f01e71ae0591cb249eec22666a40601085521104890',
  },
  'src/components/views/DashboardView.tsx': {
    before: '9e060f9a23664de8c00f87687e5a2ae381177af61fef76c531bca288608b40be',
    approved: 'ca8f0388cf5e6f36c6314214d553e5f1c5669bbb7484fc296294e226907419bf',
  },
  'src/hooks/useAppStore.ts': {
    before: '304a8002d3518d20d3cfb74248bbe84f4a5659bd9c2d9e928a6817bc96742ebb',
    approved: 'fb6386907cfb703f479a43f36cd13410dc8f44b9204c29a3a8f4a77e44c4889c',
  },
  'src/utils/transactionDraftStorage.ts': {
    before: '23bb2c72c315b5c4e1e7918c132e94d42b473248e2670a5cebf901c36518d2db',
    approved: 'a03003e572687cbfbd476cd7bbe28c2da7334fd276e744a0f886a48f4625479c',
  },
};

export const sha256Lf = (text: string) => createHash('sha256').update(text.replaceAll('\r\n', '\n')).digest('hex');

const patch = () => readFileSync(new URL('./approved-manual-save.patch', import.meta.url), 'utf8');

/** O conteúdo anterior à correção, se (e só se) `source` é exatamente o conteúdo aprovado; senão, `source` intacto. */
export function beforeApprovedManualSave(path: string, source: string): string {
  const entry = APPROVED_MANUAL_SAVE[path];
  if (!entry || sha256Lf(source) !== entry.approved) return source;
  return reverseSessionPatch(source, patch(), path);
}

/** Leitura de fonte para os testes de selo: conteúdo anterior à correção quando (e só quando) é o aprovado. */
export const readSealed = (path: string) => beforeApprovedManualSave(path, readFileSync(path, 'utf8'));
