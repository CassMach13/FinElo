
import React, { ReactNode, useEffect, useRef } from 'react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode; // Rodapé opcional para ações
  className?: string; // Permite passar classes customizadas (ex: max-w-4xl)
  hideCloseButton?: boolean;
  /** Camada acima de outros modais (ex.: z-[60]). */
  overlayClassName?: string;
  dialogLabel?: string;
  manageFocus?: boolean;
}

const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  children,
  footer,
  className = 'max-w-md',
  hideCloseButton = false,
  overlayClassName = 'z-50',
  dialogLabel,
  manageFocus = false,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!isOpen || !manageFocus) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    const focusable = () => [...(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]') ?? [])].filter(el => el.getClientRects().length > 0);
    const firstControl = dialog?.querySelector<HTMLElement>('input:not(:disabled),select:not(:disabled),textarea:not(:disabled)');
    const checkedRadio = firstControl?.matches('input[type="radio"]')
      ? [...(dialog?.querySelectorAll<HTMLInputElement>('input[type="radio"]:checked') ?? [])].find(el => el.name === firstControl.getAttribute('name'))
      : undefined;
    (checkedRadio ?? firstControl ?? focusable()[0])?.focus({preventScroll:true});
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeRef.current(); }
      if (event.key !== 'Tab') return;
      const nodes = focusable(), first = nodes[0], last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); event.stopPropagation(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); event.stopPropagation(); first?.focus(); }
    };
    dialog?.addEventListener('keydown',onKeyDown);
    return () => { dialog?.removeEventListener('keydown',onKeyDown); if(previous?.isConnected) previous.focus({preventScroll:true}); };
  },[isOpen,manageFocus]);
  if (!isOpen) return null;

  return (
    <div data-appearance-part="scrim"
      className={`fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center p-4 sm:p-4 ${overlayClassName}`}
    >
      {/* O container do modal agora é um flex container vertical com altura máxima */}
      <div ref={dialogRef} data-appearance-part="modal" role={dialogLabel || manageFocus ? 'dialog' : undefined} aria-modal={dialogLabel || manageFocus ? true : undefined} aria-label={dialogLabel || (manageFocus ? title : undefined)} className={`bg-secondary rounded-lg shadow-xl w-full ${className} mx-auto flex flex-col max-h-[90vh]`}>

        {/* 1. Cabeçalho Fixo */}
        <div data-appearance-part="divider" className="flex justify-between items-center p-4 border-b border-slate-600">
          <h3 data-appearance-part="title" className="text-xl font-bold text-light">{title}</h3>
          {!hideCloseButton && (
            <button data-appearance-part="icon-button" aria-label="Fechar modal" onClick={onClose} className="text-gray-400 hover:text-white transition-colors">&times;</button>
          )}
        </div>

        {/* 2. Corpo Rolável */}
        <div className="p-4 sm:p-6 overflow-y-auto flex-grow">
          {children}
        </div>

        {/* 3. Rodapé Fixo (Opcional) */}
        {footer && (
          <div data-appearance-part="divider" className="p-4 border-t border-slate-600 flex-shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};

export default Modal;
