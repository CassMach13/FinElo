/**
 * Compara nome de arquivo/origem entre `import_logs.file_name` e `transactions.Origem`
 * ignorando caminho, maiúsculas, acentos, extensão e também **espaços vs underscores**.
 * Ex.: "Fatura Cartão XP Cassio Abr 2024.csv" equivale a "Fatura_Cartao_XP_Cassio_Abr_2024.csv".
 */
export function comparableImportOriginKey(value?: string | null): string {
  let raw = (value || '').trim().replace(/^"+|"+$/g, '');
  const base = raw.split(/[/\\]/g).pop() || raw;
  let n = base
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
  n = n.replace(/\.(csv|xlsx|xls|txt|ofc|ofx)$/i, '');
  /** Colapsa separadores para casar UX "Fatura Cartão …" ↔ nome salvo em Origem com _ */
  return n.replace(/[_\-\s.]+/g, '');
}
