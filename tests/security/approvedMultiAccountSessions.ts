import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { reverseSessionPatch } from '../appearance/reverseSessionPatch';

const sha256Lf = (text: string) => createHash('sha256').update(text.replaceAll('\r\n', '\n')).digest('hex');

/**
 * Exceção exata e revisada: «Alternância de contas — Etapa 2: gerenciador de múltiplas sessões autenticadas».
 *
 * PENDENTE DE APROVAÇÃO EXPLÍCITA DO RESPONSÁVEL. Mesmo contrato das exceções anteriores:
 *  - o patch (`approved-multi-account-sessions.patch`) é revertido, só em teste, e SÓ quando o arquivo atual é
 *    exatamente o conteúdo submetido (`approved`);
 *  - revertido, o arquivo volta byte a byte ao conteúdo aprovado da Etapa 1 (`before`), sobre o qual a exceção da
 *    Etapa 1, a de gravação manual e todos os selos continuam valendo sem alteração;
 *  - qualquer outra edição deixa de casar com `approved` e reprova os selos até nova revisão.
 *
 * Esta camada vem ANTES da Etapa 1: o `before` de cada arquivo é o `approved` da Etapa 1 (revisão 2).
 *
 * O que muda nos três arquivos selados (nada mais):
 *  - `src/supabaseClient.ts`: com a trava de build E o opt-in do navegador, o cliente exportado é a fachada do
 *    gerenciador; senão, o MESMO `createClient` de antes, com as mesmas opções.
 *  - `src/App.tsx`: durante a troca de conta (passos 3–9) mostra a tela de carregamento de Auth já existente.
 *  - `src/hooks/useAppStore.ts`: o criador do store guarda o cliente da conta que iniciou cada chamada de ação
 *    (`operationClient`); nenhuma regra financeira muda.
 */
export const APPROVED_MULTI_ACCOUNT_SESSIONS: Record<string, { before: string; approved: string }> = {
  'src/hooks/useAppStore.ts': { before: '42f097f77723b7dfa7125d0151590ba33d8f212247a4e6d0b995039d296f2d64', approved: '718e62842e81951279dbddb7760d2ab99dd82e68b5823d1a3b7d7eea5bf46d06' },
  'src/App.tsx': { before: '469a731aa34a3395ccebdd1194fc17d0f9b9bc40ea9ab41354f553d6a0a9b754', approved: 'd2edded6341f99a895a7a6f29b3cfd56c86cb89b0f5ff59ef0da429be76a2434' },
  'src/supabaseClient.ts': { before: '5d5968c339b51ce32dec8049100bd79f762e2e11dda3adae0111ef022dae929c', approved: 'c870b1aa0a5e005e3b9e75f2faae133006af10302e3ee8370a276164593582f4' },
};

const patch = () => readFileSync(new URL('./approved-multi-account-sessions.patch', import.meta.url), 'utf8');

/** O conteúdo anterior a esta etapa, se (e só se) `source` é exatamente o conteúdo submetido; senão, `source` intacto. */
export function beforeApprovedMultiAccountSessions(path: string, source: string): string {
  const entry = APPROVED_MULTI_ACCOUNT_SESSIONS[path];
  if (!entry || sha256Lf(source) !== entry.approved) return source;
  return reverseSessionPatch(source, patch(), path);
}
