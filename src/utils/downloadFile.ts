/**
 * Baixa um `Blob` como arquivo. Depende do DOM, por isso vive em `utils/` e não
 * no domínio de exportação, que precisa continuar testável sem navegador.
 */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Liberar na hora pode cancelar o download em alguns navegadores; o adiamento
  // devolve a memória sem correr esse risco.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
