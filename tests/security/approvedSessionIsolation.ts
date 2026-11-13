import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { reverseSessionPatch } from '../appearance/reverseSessionPatch';

const sha256Lf = (text: string) => createHash('sha256').update(text.replaceAll('\r\n', '\n')).digest('hex');

/**
 * Exceção exata e revisada: «Alternância de contas — Etapa 1: fundação de segurança e isolamento de sessões».
 *
 * Os selos do programa de temas fixam (por hash) a implementação de quatro arquivos que esta etapa precisou tocar:
 * o store (limpeza central, epoch de sessão, cerca de commit), o App (instância da sessão), o cliente Supabase
 * (barreira de rede) e a persistência de filtros (chave por usuário). Mesmo contrato da exceção de gravação manual:
 *  - o patch aprovado (`approved-session-isolation.patch`) é revertido, só em teste, e SÓ quando o arquivo atual é
 *    exatamente o conteúdo aprovado (`approved`);
 *  - revertido, o arquivo volta byte a byte ao conteúdo da `main` anterior (`before`), sobre o qual todos os selos e
 *    exceções anteriores continuam valendo sem nenhuma alteração;
 *  - qualquer outra edição nesses arquivos deixa de casar com `approved` e reprova os selos até nova revisão.
 *
 * Esta camada vem ANTES da exceção de gravação manual: o `before` do store é o `approved` daquela exceção.
 */
export const APPROVED_SESSION_ISOLATION: Record<string, { before: string; approved: string }> = {
  'src/hooks/useAppStore.ts': { before: 'fb6386907cfb703f479a43f36cd13410dc8f44b9204c29a3a8f4a77e44c4889c', approved: 'cb41f3a9d1fa56e3876c3cbbc79f21f6e076237f4235bb2e2d4eba8506d5de9a' },
  'src/App.tsx': { before: '48291d43a86a642642cd92324b80b4b170dffac8b13373a753f81ff71b122376', approved: '469a731aa34a3395ccebdd1194fc17d0f9b9bc40ea9ab41354f553d6a0a9b754' },
  'src/supabaseClient.ts': { before: '369e80058a518c10d233d784027e62af726c942638a667518fd66c6ec0e0a167', approved: '5d5968c339b51ce32dec8049100bd79f762e2e11dda3adae0111ef022dae929c' },
  'src/utils/transactionPeriodFilters.ts': { before: 'afa96c94391b1c0524dbd634ed5928b160f3d285dd735cf9aafb994f1524a792', approved: '46e9b91758eb1b8b0070e322c33f6818f3ab902cb3f2ceb060eb04f7932fe68b' },
};

const patch = () => readFileSync(new URL('./approved-session-isolation.patch', import.meta.url), 'utf8');

/** O conteúdo anterior a esta etapa, se (e só se) `source` é exatamente o conteúdo aprovado; senão, `source` intacto. */
export function beforeApprovedSessionIsolation(path: string, source: string): string {
  const entry = APPROVED_SESSION_ISOLATION[path];
  if (!entry || sha256Lf(source) !== entry.approved) return source;
  return reverseSessionPatch(source, patch(), path);
}
