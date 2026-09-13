import React, { useMemo, useState } from 'react';
import { useAppStore } from '../../hooks/useAppStore';
import { appAlert } from '../../hooks/useDialogStore';
import {
  supportAttachmentUserMessage,
  type SupportAttachmentReference,
} from '../../services/supportAttachmentService';

interface SupportAttachmentLinkProps extends SupportAttachmentReference {
  className?: string;
  label?: string;
}

const isValidLegacyUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
};

const SupportAttachmentLink: React.FC<SupportAttachmentLinkProps> = ({
  attachment_path,
  attachment_url,
  className = 'text-cyan-400 hover:text-cyan-300',
  label = 'Abrir anexo',
}) => {
  const getSupportAttachmentAccess = useAppStore((state) => state.getSupportAttachmentAccess);
  const [isOpening, setIsOpening] = useState(false);

  const legacyUrl = useMemo(() => {
    const value = attachment_url?.trim();
    return value && isValidLegacyUrl(value) ? value : null;
  }, [attachment_url]);

  if (!attachment_path && !legacyUrl) return null;

  if (!attachment_path && legacyUrl) {
    return (
      <a
        href={legacyUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={`inline-flex items-center gap-2 text-xs underline ${className}`}
      >
        <span aria-hidden="true">📎</span>
        <span>{label}</span>
      </a>
    );
  }

  const handleOpen = async () => {
    if (isOpening) return;
    setIsOpening(true);
    const targetWindow = window.open('about:blank', '_blank');
    if (targetWindow) targetWindow.opener = null;

    try {
      const access = await getSupportAttachmentAccess({ attachment_path, attachment_url });
      if (access.status === 'none') {
        targetWindow?.close();
        return;
      }
      if (targetWindow) {
        targetWindow.location.replace(access.url);
      } else {
        await appAlert(
          'O navegador bloqueou a nova aba. Permita pop-ups para abrir o anexo.',
          'Anexo bloqueado',
          'warning'
        );
      }
    } catch (error) {
      targetWindow?.close();
      await appAlert(supportAttachmentUserMessage(error), 'Erro ao abrir anexo', 'danger');
    } finally {
      setIsOpening(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleOpen}
      disabled={isOpening}
      className={`inline-flex items-center gap-2 text-xs underline disabled:cursor-wait disabled:opacity-60 ${className}`}
    >
      <span aria-hidden="true">📎</span>
      <span>{isOpening ? 'Gerando acesso seguro...' : label}</span>
    </button>
  );
};

export default SupportAttachmentLink;
