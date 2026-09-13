import type { SupabaseClient } from '@supabase/supabase-js';

export const SUPPORT_ATTACHMENT_BUCKET = 'support-attachments';
export const SUPPORT_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export const SUPPORT_ATTACHMENT_SIGNED_URL_TTL_SECONDS = 5 * 60;

export const SUPPORT_ATTACHMENT_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const;

export const SUPPORT_ATTACHMENT_ACCEPT = [
  ...SUPPORT_ATTACHMENT_MIME_TYPES,
  '.jpg',
  '.jpeg',
  '.png',
  '.pdf',
  '.doc',
  '.docx',
].join(',');

export type SupportAttachmentMimeType = (typeof SUPPORT_ATTACHMENT_MIME_TYPES)[number];
export type SupportAttachmentTargetKind = 'ticket' | 'message';

export type SupportAttachmentState =
  | { status: 'not-selected' }
  | { status: 'uploaded'; path: string };

export type SupportAttachmentReference = {
  attachment_path?: string | null;
  attachment_url?: string | null;
};

export type SupportAttachmentAccess =
  | { status: 'none' }
  | { status: 'legacy-url'; url: string }
  | { status: 'signed-url'; url: string; expiresInSeconds: number };

export type SupportAttachmentErrorCode =
  | 'unauthenticated'
  | 'unsupported-type'
  | 'file-too-large'
  | 'invalid-target'
  | 'upload-failed'
  | 'ticket-insert-failed'
  | 'message-insert-failed'
  | 'signed-url-failed'
  | 'invalid-legacy-url';

export class SupportAttachmentError extends Error {
  readonly code: SupportAttachmentErrorCode;
  readonly stage: 'validation' | 'upload' | 'persistence' | 'access';

  constructor(
    code: SupportAttachmentErrorCode,
    stage: SupportAttachmentError['stage'],
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = 'SupportAttachmentError';
    this.code = code;
    this.stage = stage;
  }
}

export interface NewSupportTicketInput {
  type: 'bug' | 'feature' | 'question';
  subject: string;
  description: string;
}

export interface SupportWriteResult {
  id: string;
  attachment: SupportAttachmentState;
}

export interface SupportAttachmentTarget {
  kind: SupportAttachmentTargetKind;
  recordId: string;
}

export interface SupportAttachmentSafeLog {
  event: 'support-attachment-cleanup-failed';
  stage: 'cleanup';
  providerCode?: string;
}

export type SupportAttachmentLogger = (entry: SupportAttachmentSafeLog) => void;
export type SupportAttachmentIdFactory = () => string;
export type SupportAttachmentUploader = (
  file: File,
  target: SupportAttachmentTarget
) => Promise<Extract<SupportAttachmentState, { status: 'uploaded' }>>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MIME_EXTENSION: Record<SupportAttachmentMimeType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};

const isSupportedMimeType = (value: string): value is SupportAttachmentMimeType =>
  SUPPORT_ATTACHMENT_MIME_TYPES.includes(value as SupportAttachmentMimeType);

const defaultIdFactory: SupportAttachmentIdFactory = () => crypto.randomUUID();

const providerCode = (error: unknown): string | undefined => {
  if (!error || typeof error !== 'object') return undefined;
  const value = (error as { code?: unknown }).code;
  return typeof value === 'string' && value.length <= 80 ? value : undefined;
};

export const supportAttachmentUserMessage = (error: unknown): string => {
  if (!(error instanceof SupportAttachmentError)) {
    return 'Não foi possível concluir o envio. Seus dados foram mantidos para uma nova tentativa.';
  }

  switch (error.code) {
    case 'unsupported-type':
      return 'Tipo de arquivo não permitido. Use JPEG, PNG, PDF, DOC ou DOCX.';
    case 'file-too-large':
      return 'O arquivo excede o limite de 10 MiB.';
    case 'unauthenticated':
      return 'Sua sessão expirou. Entre novamente antes de enviar o chamado.';
    case 'upload-failed':
      return 'O anexo não pôde ser enviado. O chamado não foi criado e seus dados foram mantidos.';
    case 'ticket-insert-failed':
      return 'O chamado não pôde ser criado. Seus dados foram mantidos para uma nova tentativa.';
    case 'message-insert-failed':
      return 'A resposta não pôde ser enviada. O texto e o anexo foram mantidos.';
    case 'signed-url-failed':
    case 'invalid-legacy-url':
      return 'O anexo não pôde ser aberto. Tente novamente ou contate o suporte.';
    default:
      return 'Não foi possível concluir o envio. Seus dados foram mantidos para uma nova tentativa.';
  }
};

export const supportAttachmentDiagnostic = (error: unknown): {
  code: SupportAttachmentErrorCode | 'unknown';
  stage: SupportAttachmentError['stage'] | 'unknown';
} => error instanceof SupportAttachmentError
  ? { code: error.code, stage: error.stage }
  : { code: 'unknown', stage: 'unknown' };

export const validateSupportAttachmentFile = (
  file: Pick<File, 'type' | 'size'>
): { mimeType: SupportAttachmentMimeType; extension: string } => {
  const mimeType = file.type.trim().toLowerCase();
  if (!isSupportedMimeType(mimeType)) {
    throw new SupportAttachmentError(
      'unsupported-type',
      'validation',
      'Unsupported support attachment MIME type.'
    );
  }
  if (file.size > SUPPORT_ATTACHMENT_MAX_BYTES) {
    throw new SupportAttachmentError(
      'file-too-large',
      'validation',
      'Support attachment exceeds the configured size limit.'
    );
  }
  return { mimeType, extension: MIME_EXTENSION[mimeType] };
};

export const buildSupportAttachmentPath = (
  userId: string,
  target: SupportAttachmentTarget,
  extension: string,
  objectId: string
): string => {
  if (
    !UUID_RE.test(userId)
    || !UUID_RE.test(target.recordId)
    || !UUID_RE.test(objectId)
    || (target.kind !== 'ticket' && target.kind !== 'message')
  ) {
    throw new SupportAttachmentError(
      'invalid-target',
      'validation',
      'Support attachment target must use UUID identifiers.'
    );
  }
  const namespace = target.kind === 'ticket' ? 'tickets' : 'messages';
  return `${userId}/${namespace}/${target.recordId}/${objectId}.${extension}`;
};

export const uploadTicketAttachment = async (
  client: SupabaseClient,
  userId: string,
  target: SupportAttachmentTarget,
  file: File,
  idFactory: SupportAttachmentIdFactory = defaultIdFactory
): Promise<Extract<SupportAttachmentState, { status: 'uploaded' }>> => {
  const { mimeType, extension } = validateSupportAttachmentFile(file);
  const path = buildSupportAttachmentPath(userId, target, extension, idFactory());
  try {
    const { error } = await client.storage.from(SUPPORT_ATTACHMENT_BUCKET).upload(path, file, {
      cacheControl: '3600',
      contentType: mimeType,
      upsert: false,
    });
    if (!error) return { status: 'uploaded', path };
    throw new SupportAttachmentError(
      'upload-failed',
      'upload',
      'Supabase Storage rejected the support attachment.',
      { cause: error }
    );
  } catch (error) {
    if (error instanceof SupportAttachmentError) throw error;
    throw new SupportAttachmentError(
      'upload-failed',
      'upload',
      'Support attachment upload did not complete.',
      { cause: error }
    );
  }
};

export const cleanupUploadedSupportAttachment = async (
  client: SupabaseClient,
  path: string,
  logger: SupportAttachmentLogger = (entry) => console.error('[SupportAttachment]', entry)
): Promise<boolean> => {
  try {
    const { error } = await client.storage.from(SUPPORT_ATTACHMENT_BUCKET).remove([path]);
    if (!error) return true;
    try {
      logger({
        event: 'support-attachment-cleanup-failed',
        stage: 'cleanup',
        providerCode: providerCode(error),
      });
    } catch {
      // Telemetria nunca substitui o erro original da persistência.
    }
    return false;
  } catch (error) {
    try {
      logger({
        event: 'support-attachment-cleanup-failed',
        stage: 'cleanup',
        providerCode: providerCode(error),
      });
    } catch {
      // Telemetria nunca substitui o erro original da persistência.
    }
    return false;
  }
};

export const createSupportTicketRecord = async (
  client: SupabaseClient,
  userId: string,
  ticket: NewSupportTicketInput,
  file?: File,
  options: {
    idFactory?: SupportAttachmentIdFactory;
    logger?: SupportAttachmentLogger;
    upload?: SupportAttachmentUploader;
  } = {}
): Promise<SupportWriteResult> => {
  const idFactory = options.idFactory ?? defaultIdFactory;
  const ticketId = idFactory();
  const target: SupportAttachmentTarget = { kind: 'ticket', recordId: ticketId };
  const attachment: SupportAttachmentState = file
    ? await (options.upload
        ? options.upload(file, target)
        : uploadTicketAttachment(client, userId, target, file, idFactory))
    : { status: 'not-selected' };

  let persistenceError: unknown = null;
  try {
    const { error } = await client.from('support_tickets').insert([{
      id: ticketId,
      ...ticket,
      user_id: userId,
      attachment_path: attachment.status === 'uploaded' ? attachment.path : null,
      status: 'open',
    }]);
    persistenceError = error;
  } catch (error) {
    persistenceError = error;
  }

  if (persistenceError) {
    if (attachment.status === 'uploaded') {
      await cleanupUploadedSupportAttachment(client, attachment.path, options.logger);
    }
    throw new SupportAttachmentError(
      'ticket-insert-failed',
      'persistence',
      'Supabase rejected the support ticket insert.',
      { cause: persistenceError }
    );
  }

  return { id: ticketId, attachment };
};

export const createSupportMessageRecord = async (
  client: SupabaseClient,
  userId: string,
  ticketId: string,
  message: string,
  file?: File,
  options: {
    idFactory?: SupportAttachmentIdFactory;
    logger?: SupportAttachmentLogger;
    upload?: SupportAttachmentUploader;
  } = {}
): Promise<SupportWriteResult> => {
  const idFactory = options.idFactory ?? defaultIdFactory;
  const messageId = idFactory();
  const target: SupportAttachmentTarget = { kind: 'message', recordId: messageId };
  const attachment: SupportAttachmentState = file
    ? await (options.upload
        ? options.upload(file, target)
        : uploadTicketAttachment(client, userId, target, file, idFactory))
    : { status: 'not-selected' };

  let persistenceError: unknown = null;
  try {
    const { error } = await client.from('support_messages').insert([{
      id: messageId,
      ticket_id: ticketId,
      sender_id: userId,
      attachment_path: attachment.status === 'uploaded' ? attachment.path : null,
      message,
    }]);
    persistenceError = error;
  } catch (error) {
    persistenceError = error;
  }

  if (persistenceError) {
    if (attachment.status === 'uploaded') {
      await cleanupUploadedSupportAttachment(client, attachment.path, options.logger);
    }
    throw new SupportAttachmentError(
      'message-insert-failed',
      'persistence',
      'Supabase rejected the support message insert.',
      { cause: persistenceError }
    );
  }

  return { id: messageId, attachment };
};

const validLegacyUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
};

export const getSupportAttachmentAccess = async (
  client: SupabaseClient,
  reference: SupportAttachmentReference
): Promise<SupportAttachmentAccess> => {
  const path = reference.attachment_path?.trim();
  if (path) {
    try {
      const { data, error } = await client.storage
        .from(SUPPORT_ATTACHMENT_BUCKET)
        .createSignedUrl(path, SUPPORT_ATTACHMENT_SIGNED_URL_TTL_SECONDS);
      if (!error && data?.signedUrl) {
        return {
          status: 'signed-url',
          url: data.signedUrl,
          expiresInSeconds: SUPPORT_ATTACHMENT_SIGNED_URL_TTL_SECONDS,
        };
      }
      throw new SupportAttachmentError(
        'signed-url-failed',
        'access',
        'Supabase Storage could not create a signed support attachment URL.',
        { cause: error }
      );
    } catch (error) {
      if (error instanceof SupportAttachmentError) throw error;
      throw new SupportAttachmentError(
        'signed-url-failed',
        'access',
        'Signed support attachment access did not complete.',
        { cause: error }
      );
    }
  }

  const legacyUrl = reference.attachment_url?.trim();
  if (!legacyUrl) return { status: 'none' };
  if (!validLegacyUrl(legacyUrl)) {
    throw new SupportAttachmentError(
      'invalid-legacy-url',
      'access',
      'Legacy support attachment URL is not an HTTP(S) URL.'
    );
  }
  return { status: 'legacy-url', url: legacyUrl };
};

export const runSupportSubmission = async <T>(
  submit: () => Promise<T>,
  clearAfterSuccess: () => void
): Promise<T> => {
  const result = await submit();
  clearAfterSuccess();
  return result;
};
