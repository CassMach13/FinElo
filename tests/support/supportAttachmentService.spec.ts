import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  SUPPORT_ATTACHMENT_BUCKET,
  SUPPORT_ATTACHMENT_MAX_BYTES,
  SUPPORT_ATTACHMENT_SIGNED_URL_TTL_SECONDS,
  SupportAttachmentError,
  buildSupportAttachmentPath,
  cleanupUploadedSupportAttachment,
  createSupportMessageRecord,
  createSupportTicketRecord,
  getSupportAttachmentAccess,
  runSupportSubmission,
  supportAttachmentDiagnostic,
  validateSupportAttachmentFile,
} from '../../src/services/supportAttachmentService';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ADMIN_ID = '22222222-2222-4222-8222-222222222222';
const TICKET_ID = '33333333-3333-4333-8333-333333333333';
const MESSAGE_ID = '44444444-4444-4444-8444-444444444444';
const OBJECT_ID = '55555555-5555-4555-8555-555555555555';

const file = (name: string, type: string, size = 512): File => ({
  name,
  type,
  size,
} as File);

const idFactory = (...ids: string[]) => {
  const factory = vi.fn<() => string>();
  ids.forEach((id) => factory.mockReturnValueOnce(id));
  return factory;
};

const makeClient = (options: {
  uploadError?: unknown;
  insertError?: unknown;
  removeError?: unknown;
  signedUrl?: string | null;
  signedUrlError?: unknown;
} = {}) => {
  const upload = vi.fn().mockResolvedValue({
    data: options.uploadError ? null : { path: 'uploaded' },
    error: options.uploadError ?? null,
  });
  const remove = vi.fn().mockResolvedValue({ data: null, error: options.removeError ?? null });
  const createSignedUrl = vi.fn().mockResolvedValue({
    data: options.signedUrl === null
      ? null
      : { signedUrl: options.signedUrl ?? 'https://signed.example.test/file' },
    error: options.signedUrlError ?? null,
  });
  const insert = vi.fn().mockResolvedValue({ data: null, error: options.insertError ?? null });
  const storageFrom = vi.fn(() => ({ upload, remove, createSignedUrl }));
  const from = vi.fn(() => ({ insert }));
  const client = {
    storage: { from: storageFrom },
    from,
  } as unknown as SupabaseClient;

  return { client, upload, remove, createSignedUrl, insert, storageFrom, from };
};

describe('support attachment validation and naming', () => {
  it.each([
    ['photo.jpg', 'image/jpeg', 'jpg'],
    ['screen.png', 'image/png', 'png'],
    ['report.pdf', 'application/pdf', 'pdf'],
    ['legacy.doc', 'application/msword', 'doc'],
    ['modern.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx'],
  ])('accepts %s using its MIME-derived extension', (_name, mimeType, extension) => {
    expect(validateSupportAttachmentFile(file(_name, mimeType))).toEqual({ mimeType, extension });
  });

  it('rejects an unsupported MIME type', () => {
    expect(() => validateSupportAttachmentFile(file('payload.svg', 'image/svg+xml')))
      .toThrowError(expect.objectContaining({ code: 'unsupported-type', stage: 'validation' }));
  });

  it('rejects a file above the shared 10 MiB contract', () => {
    expect(() => validateSupportAttachmentFile(
      file('too-big.pdf', 'application/pdf', SUPPORT_ATTACHMENT_MAX_BYTES + 1)
    )).toThrowError(expect.objectContaining({ code: 'file-too-large', stage: 'validation' }));
  });

  it('allows a file exactly at the shared limit', () => {
    expect(validateSupportAttachmentFile(
      file('limit.pdf', 'application/pdf', SUPPORT_ATTACHMENT_MAX_BYTES)
    ).extension).toBe('pdf');
  });

  it('creates a non-guessable internal path without the original filename', () => {
    const path = buildSupportAttachmentPath(
      USER_ID,
      { kind: 'ticket', recordId: TICKET_ID },
      'pdf',
      OBJECT_ID
    );
    expect(path).toBe(`${USER_ID}/tickets/${TICKET_ID}/${OBJECT_ID}.pdf`);
    expect(path).not.toContain('bank-statement');
  });

  it('fails before upload when an identifier is not a UUID', () => {
    expect(() => buildSupportAttachmentPath(
      USER_ID,
      { kind: 'message', recordId: 'not-a-uuid' },
      'png',
      OBJECT_ID
    )).toThrowError(expect.objectContaining({ code: 'invalid-target' }));
  });
});

describe('support ticket and message persistence', () => {
  it('creates a ticket without an attachment and records not-selected explicitly', async () => {
    const { client, insert, upload } = makeClient();
    const result = await createSupportTicketRecord(
      client,
      USER_ID,
      { type: 'question', subject: 'Subject', description: 'Description' },
      undefined,
      { idFactory: idFactory(TICKET_ID) }
    );

    expect(result).toEqual({ id: TICKET_ID, attachment: { status: 'not-selected' } });
    expect(upload).not.toHaveBeenCalled();
    expect(insert).toHaveBeenCalledWith([expect.objectContaining({
      id: TICKET_ID,
      attachment_path: null,
    })]);
  });

  it('uploads a new-ticket attachment privately before persisting only its path', async () => {
    const { client, upload, insert, storageFrom } = makeClient();
    const result = await createSupportTicketRecord(
      client,
      USER_ID,
      { type: 'bug', subject: 'Attachment', description: 'Test' },
      file('private-name.pdf', 'application/pdf'),
      { idFactory: idFactory(TICKET_ID, OBJECT_ID) }
    );

    const expectedPath = `${USER_ID}/tickets/${TICKET_ID}/${OBJECT_ID}.pdf`;
    expect(storageFrom).toHaveBeenCalledWith(SUPPORT_ATTACHMENT_BUCKET);
    expect(upload).toHaveBeenCalledWith(expectedPath, expect.anything(), expect.objectContaining({
      contentType: 'application/pdf',
      upsert: false,
    }));
    expect(insert).toHaveBeenCalledWith([expect.objectContaining({
      attachment_path: expectedPath,
    })]);
    expect(insert.mock.calls[0][0][0]).not.toHaveProperty('attachment_url');
    expect(result.attachment).toEqual({ status: 'uploaded', path: expectedPath });
  });

  it('persists a user reply attachment using the message namespace', async () => {
    const { client, insert } = makeClient();
    const result = await createSupportMessageRecord(
      client,
      USER_ID,
      TICKET_ID,
      'User reply',
      file('screen.png', 'image/png'),
      { idFactory: idFactory(MESSAGE_ID, OBJECT_ID) }
    );

    const expectedPath = `${USER_ID}/messages/${MESSAGE_ID}/${OBJECT_ID}.png`;
    expect(insert).toHaveBeenCalledWith([expect.objectContaining({
      id: MESSAGE_ID,
      ticket_id: TICKET_ID,
      sender_id: USER_ID,
      attachment_path: expectedPath,
    })]);
    expect(result.attachment).toEqual({ status: 'uploaded', path: expectedPath });
  });

  it('uses the authenticated admin namespace for an admin reply', async () => {
    const { client, insert } = makeClient();
    await createSupportMessageRecord(
      client,
      ADMIN_ID,
      TICKET_ID,
      'Admin reply',
      file('answer.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
      { idFactory: idFactory(MESSAGE_ID, OBJECT_ID) }
    );

    expect(insert).toHaveBeenCalledWith([expect.objectContaining({
      sender_id: ADMIN_ID,
      attachment_path: `${ADMIN_ID}/messages/${MESSAGE_ID}/${OBJECT_ID}.docx`,
    })]);
  });

  it('does not insert a ticket after upload failure', async () => {
    const { client, insert } = makeClient({ uploadError: { code: 'storage-denied' } });
    await expect(createSupportTicketRecord(
      client,
      USER_ID,
      { type: 'bug', subject: 'Failure', description: 'Keep my form' },
      file('screen.png', 'image/png'),
      { idFactory: idFactory(TICKET_ID, OBJECT_ID) }
    )).rejects.toMatchObject({ code: 'upload-failed', stage: 'upload' });
    expect(insert).not.toHaveBeenCalled();
  });

  it('wraps a rejected network upload as a structured failure and does not insert', async () => {
    const { client, insert, upload } = makeClient();
    upload.mockRejectedValueOnce(new Error('network detail'));
    await expect(createSupportTicketRecord(
      client,
      USER_ID,
      { type: 'bug', subject: 'Failure', description: 'Keep my form' },
      file('screen.png', 'image/png'),
      { idFactory: idFactory(TICKET_ID, OBJECT_ID) }
    )).rejects.toMatchObject({ code: 'upload-failed', stage: 'upload' });
    expect(insert).not.toHaveBeenCalled();
  });

  it('does not insert a message after upload failure', async () => {
    const { client, insert } = makeClient({ uploadError: { code: 'storage-denied' } });
    await expect(createSupportMessageRecord(
      client,
      USER_ID,
      TICKET_ID,
      'Keep this reply',
      file('screen.png', 'image/png'),
      { idFactory: idFactory(MESSAGE_ID, OBJECT_ID) }
    )).rejects.toMatchObject({ code: 'upload-failed' });
    expect(insert).not.toHaveBeenCalled();
  });

  it('removes an uploaded object best-effort when ticket persistence fails', async () => {
    const { client, remove } = makeClient({ insertError: { code: 'db-failed' } });
    const expectedPath = `${USER_ID}/tickets/${TICKET_ID}/${OBJECT_ID}.pdf`;
    await expect(createSupportTicketRecord(
      client,
      USER_ID,
      { type: 'bug', subject: 'Failure', description: 'Keep my form' },
      file('doc.pdf', 'application/pdf'),
      { idFactory: idFactory(TICKET_ID, OBJECT_ID) }
    )).rejects.toMatchObject({ code: 'ticket-insert-failed', stage: 'persistence' });
    expect(remove).toHaveBeenCalledWith([expectedPath]);
  });

  it('removes an uploaded object best-effort when message persistence fails', async () => {
    const { client, remove } = makeClient({ insertError: { code: 'db-failed' } });
    const expectedPath = `${USER_ID}/messages/${MESSAGE_ID}/${OBJECT_ID}.doc`;
    await expect(createSupportMessageRecord(
      client,
      USER_ID,
      TICKET_ID,
      'Keep reply',
      file('doc.doc', 'application/msword'),
      { idFactory: idFactory(MESSAGE_ID, OBJECT_ID) }
    )).rejects.toMatchObject({ code: 'message-insert-failed' });
    expect(remove).toHaveBeenCalledWith([expectedPath]);
  });

  it('preserves the original persistence error and logs cleanup failure separately', async () => {
    const logger = vi.fn();
    const { client } = makeClient({
      insertError: { code: 'db-failed', message: 'sensitive database detail' },
      removeError: { code: 'cleanup-denied', message: 'sensitive storage detail' },
    });
    await expect(createSupportTicketRecord(
      client,
      USER_ID,
      { type: 'bug', subject: 'Failure', description: 'Keep my form' },
      file('doc.pdf', 'application/pdf'),
      { idFactory: idFactory(TICKET_ID, OBJECT_ID), logger }
    )).rejects.toMatchObject({ code: 'ticket-insert-failed' });
    expect(logger).toHaveBeenCalledWith({
      event: 'support-attachment-cleanup-failed',
      stage: 'cleanup',
      providerCode: 'cleanup-denied',
    });
    expect(JSON.stringify(logger.mock.calls)).not.toContain('sensitive');
  });

  it('preserves the original persistence error when cleanup rejects', async () => {
    const logger = vi.fn();
    const { client, remove } = makeClient({ insertError: { code: 'db-failed' } });
    remove.mockRejectedValueOnce({ code: 'cleanup-network-failed', message: 'sensitive path' });
    await expect(createSupportMessageRecord(
      client,
      USER_ID,
      TICKET_ID,
      'Keep reply',
      file('doc.pdf', 'application/pdf'),
      { idFactory: idFactory(MESSAGE_ID, OBJECT_ID), logger }
    )).rejects.toMatchObject({ code: 'message-insert-failed' });
    expect(logger).toHaveBeenCalledWith({
      event: 'support-attachment-cleanup-failed',
      stage: 'cleanup',
      providerCode: 'cleanup-network-failed',
    });
  });

  it('reports cleanup success without logging', async () => {
    const logger = vi.fn();
    const { client } = makeClient();
    await expect(cleanupUploadedSupportAttachment(client, 'safe/path.pdf', logger)).resolves.toBe(true);
    expect(logger).not.toHaveBeenCalled();
  });
});

describe('support attachment access and UI state preservation', () => {
  it('generates a five-minute signed URL when an internal path exists', async () => {
    const { client, createSignedUrl } = makeClient();
    await expect(getSupportAttachmentAccess(client, {
      attachment_path: `${USER_ID}/tickets/${TICKET_ID}/${OBJECT_ID}.pdf`,
      attachment_url: null,
    })).resolves.toEqual({
      status: 'signed-url',
      url: 'https://signed.example.test/file',
      expiresInSeconds: SUPPORT_ATTACHMENT_SIGNED_URL_TTL_SECONDS,
    });
    expect(createSignedUrl).toHaveBeenCalledWith(
      `${USER_ID}/tickets/${TICKET_ID}/${OBJECT_ID}.pdf`,
      SUPPORT_ATTACHMENT_SIGNED_URL_TTL_SECONDS
    );
  });

  it('prioritizes the internal path over a legacy URL', async () => {
    const { client, createSignedUrl } = makeClient();
    const result = await getSupportAttachmentAccess(client, {
      attachment_path: 'internal/path.pdf',
      attachment_url: 'https://legacy.example.test/file.pdf',
    });
    expect(result.status).toBe('signed-url');
    expect(createSignedUrl).toHaveBeenCalled();
  });

  it('keeps valid historical attachment_url values as a read-only fallback', async () => {
    const { client, createSignedUrl } = makeClient();
    await expect(getSupportAttachmentAccess(client, {
      attachment_path: null,
      attachment_url: 'https://legacy.example.test/file.pdf',
    })).resolves.toEqual({ status: 'legacy-url', url: 'https://legacy.example.test/file.pdf' });
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it('returns none for historical records without either reference', async () => {
    const { client } = makeClient();
    await expect(getSupportAttachmentAccess(client, {
      attachment_path: null,
      attachment_url: null,
    })).resolves.toEqual({ status: 'none' });
  });

  it('rejects unsafe legacy URL schemes', async () => {
    const { client } = makeClient();
    await expect(getSupportAttachmentAccess(client, {
      attachment_url: 'javascript:alert(1)',
    })).rejects.toMatchObject({ code: 'invalid-legacy-url', stage: 'access' });
  });

  it('reports signed URL failure without exposing provider details', async () => {
    const providerError = { code: 'not-found', message: 'private object path' };
    const { client } = makeClient({ signedUrlError: providerError, signedUrl: null });
    const error = await getSupportAttachmentAccess(client, { attachment_path: 'internal/path.pdf' })
      .catch((caught) => caught);
    expect(error).toBeInstanceOf(SupportAttachmentError);
    expect(supportAttachmentDiagnostic(error)).toEqual({ code: 'signed-url-failed', stage: 'access' });
    expect(supportAttachmentDiagnostic(error)).not.toHaveProperty('message');
  });

  it('clears a form only after a successful submission', async () => {
    const clear = vi.fn();
    await expect(runSupportSubmission(async () => 'ok', clear)).resolves.toBe('ok');
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it('preserves a form after a failed submission', async () => {
    const clear = vi.fn();
    await expect(runSupportSubmission(async () => {
      throw new Error('failed');
    }, clear)).rejects.toThrow('failed');
    expect(clear).not.toHaveBeenCalled();
  });
});
