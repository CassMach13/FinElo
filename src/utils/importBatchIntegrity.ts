import type { Transaction } from '../types';

const encoder = new TextEncoder();

const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

async function sha256Hex(parts: Array<ArrayBuffer | Uint8Array | string>): Promise<string> {
  const encoded = parts.map((part) => {
    if (typeof part === 'string') return encoder.encode(part);
    if (part instanceof Uint8Array) return part;
    return new Uint8Array(part);
  });
  const totalLength = encoded.reduce((total, part) => total + part.byteLength, 0);
  const input = new Uint8Array(totalLength);
  let offset = 0;
  encoded.forEach((part) => {
    input.set(part, offset);
    offset += part.byteLength;
  });

  const digest = await globalThis.crypto.subtle.digest('SHA-256', input);
  return bytesToHex(new Uint8Array(digest));
}

/**
 * Fingerprint do conteúdo bruto + conta de destino. O nome do arquivo não entra
 * no cálculo, portanto renomear o mesmo extrato não contorna a idempotência.
 */
export async function buildFileImportFingerprint(
  file: Pick<Blob, 'arrayBuffer'>,
  accountId?: string | null
): Promise<string> {
  return sha256Hex([
    'finelo-import-file-v1\0',
    accountId || 'unassigned',
    '\0',
    await file.arrayBuffer(),
  ]);
}

const normalizeDateValue = (value: unknown): string | null => {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
};

/** Fallback determinístico para fluxos sem File (ex.: dados de demonstração). */
export async function buildStructuredImportFingerprint(
  transactions: Array<Omit<Transaction, 'ID_Transacao' | 'user_id'>>,
  accountId?: string | null
): Promise<string> {
  const canonicalRows = transactions.map((tx) => ({
    Data: normalizeDateValue(tx.Data),
    Data_Pagamento: normalizeDateValue(tx.Data_Pagamento),
    Nome_Fantasia: tx.Nome_Fantasia || '',
    Descricao_Original: tx.Descricao_Original || '',
    Categoria: tx.Categoria || '',
    Tipo: tx.Tipo || '',
    Valor: Number(tx.Valor),
    Parcela_Atual: tx.Parcela_Atual ?? null,
    Total_Parcelas: tx.Total_Parcelas ?? null,
    Portador: tx.Portador || null,
    Fonte: tx.Fonte || '',
    linked_asset_id: tx.linked_asset_id || null,
  }));

  return sha256Hex([
    'finelo-import-structured-v1\0',
    accountId || 'unassigned',
    '\0',
    JSON.stringify(canonicalRows),
  ]);
}

export function isSha256Fingerprint(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}
