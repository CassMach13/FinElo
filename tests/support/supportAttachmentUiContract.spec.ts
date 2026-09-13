import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(path), 'utf8');
const store = read('src/hooks/useAppStore.ts');
const help = read('src/components/views/HelpView.tsx');
const admin = read('src/components/views/AdminTicketsView.tsx');
const link = read('src/components/support/SupportAttachmentLink.tsx');

describe('support attachment UI contract', () => {
  it('routes ticket creation, user replies, and admin replies through the shared fail-closed service', () => {
    expect(store).toContain('createSupportTicketRecord(supabase');
    expect(store).toContain('createSupportMessageRecord(supabase');
    expect(help).toContain('runSupportSubmission');
    expect(admin).toContain('runSupportSubmission');
  });

  it('does not clear controlled reply inputs via DOM mutation before success', () => {
    expect(help).not.toContain("querySelector('input[type=\"file\"]')");
    expect(help).not.toContain("querySelector('.file-label')");
    expect(admin).not.toContain("querySelector('input[type=\"file\"]')");
    expect(admin).not.toContain("querySelector('.file-label')");
  });

  it('applies the same MIME accept contract in every file picker', () => {
    expect(help.match(/accept=\{SUPPORT_ATTACHMENT_ACCEPT\}/g)).toHaveLength(2);
    expect(admin.match(/accept=\{SUPPORT_ATTACHMENT_ACCEPT\}/g)).toHaveLength(1);
  });

  it('uses signed access for paths and keeps the legacy URL fallback', () => {
    expect(help.match(/<SupportAttachmentLink/g)).toHaveLength(2);
    expect(admin.match(/<SupportAttachmentLink/g)).toHaveLength(2);
    expect(link).toContain('getSupportAttachmentAccess({ attachment_path, attachment_url })');
    expect(link).toContain("window.open('about:blank', '_blank')");
    expect(link).toContain('rel="noopener noreferrer"');
  });

  it('never uploads support attachments to the legacy images bucket or calls getPublicUrl', () => {
    const supportSources = [store, help, admin, link].join('\n');
    expect(supportSources).not.toContain("from('images')");
    expect(supportSources).not.toContain('getPublicUrl');
    expect(supportSources).not.toContain('ticket-attachments/');
  });
});
