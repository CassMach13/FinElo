import React, { useEffect, useCallback, useRef } from 'react';
import { useDialogStore } from '../../hooks/useDialogStore';
import Button from './Button';
import { AlertCircleIcon, InformationCircleIcon, CheckIcon } from './icons';

export const GlobalDialog: React.FC<{ dialogStore?: typeof useDialogStore }> = ({ dialogStore = useDialogStore }) => {
  const { isOpen, options, closeDialog } = dialogStore();
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    dialog?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
    const containFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const buttons = dialog?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
      if (!buttons?.length) return;
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', containFocus);
    return () => { window.removeEventListener('keydown', containFocus); previous?.focus({ preventScroll: true }); };
  }, [isOpen]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isOpen || !options) return;
      if (e.key === 'Escape') {
        closeDialog(options.hideCancel ? true : false);
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        closeDialog(true);
      }
    },
    [isOpen, options, closeDialog]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  if (!isOpen || !options) return null;

  const { title, message, confirmText, cancelText, variant, hideCancel } = options;

  // Variantes visuais
  const iconMap = {
    info: <InformationCircleIcon className="w-8 h-8 text-highlight" />,
    warning: <AlertCircleIcon className="w-8 h-8 text-orange-400" />,
    danger: <AlertCircleIcon className="w-8 h-8 text-danger" />,
    success: <CheckIcon className="w-8 h-8 text-accent" color="currentColor" />
  };

  const bgMap = {
    info: 'bg-highlight/10 border-highlight/20',
    warning: 'bg-orange-500/10 border-orange-500/20',
    danger: 'bg-danger/10 border-danger/20',
    success: 'bg-accent/10 border-accent/20'
  };

  const buttonVariantMap = {
    info: 'accent',
    warning: 'primary',
    danger: 'danger',
    success: 'accent'
  } as const;

  return (
    <div data-appearance-part="scrim" className="fixed inset-0 z-[9999] overflow-y-auto flex items-center justify-center p-4 sm:p-6 bg-black/60 backdrop-blur-sm">
      {/* Clique fora: cancela confirmações; alertas de uma tecla não fecham pelo fundo para evitar clique acidental */}
      <div
        className="fixed inset-0"
        onClick={() => !hideCancel && closeDialog(false)}
        aria-hidden="true"
      />

      <div
        ref={dialogRef}
        data-appearance-part="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="global-dialog-title"
        className="relative z-10 w-full max-w-2xl max-h-[min(88vh,calc(100dvh-2rem))] bg-secondary border border-slate-700/60 rounded-2xl shadow-2xl flex flex-col min-h-0 my-6 sm:my-10"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          data-appearance-part="dialog-header"
          data-appearance-tone={variant || 'info'}
          className={`flex-shrink-0 p-4 flex items-center gap-3 border-b border-slate-700/50 ${bgMap[variant || 'info']}`}
        >
          <span data-appearance-part="state-icon" className="flex-shrink-0">{iconMap[variant || 'info']}</span>
          <h3 data-appearance-part="title" id="global-dialog-title" className="text-lg font-bold text-white tracking-wide flex-1 min-w-0 pr-2 truncate">
            {title || 'Atenção'}
          </h3>
          <button
            data-appearance-part="icon-button"
            type="button"
            aria-label={hideCancel ? 'Fechar' : 'Cancelar'}
            className="flex-shrink-0 rounded-lg p-1.5 text-gray-300 hover:bg-white/10 hover:text-white transition-colors text-2xl leading-none w-9 h-9 flex items-center justify-center"
            onClick={() => closeDialog(hideCancel ? true : false)}
          >
            ×
          </button>
        </div>

        {/* Corpo rolável (mensagens longas) */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-6">
          <p data-appearance-part="muted" className="text-gray-300 whitespace-pre-line leading-relaxed text-[15px] break-words">{message}</p>
        </div>

        {/* Footer fixo */}
        <div data-appearance-part="dialog-footer" className="flex-shrink-0 px-6 py-4 bg-slate-800/30 border-t border-slate-700/50 flex flex-wrap justify-end gap-3 rounded-b-2xl">
          {!hideCancel && (
            <Button
              variant="secondary"
              onClick={() => closeDialog(false)}
              className="px-5 py-2 font-medium"
            >
              {cancelText || 'Cancelar'}
            </Button>
          )}
          <Button
            variant={buttonVariantMap[variant || 'info']}
            onClick={() => closeDialog(true)}
            className="min-w-0 max-w-full break-words px-5 py-2 font-bold shadow-lg"
          >
            {confirmText || 'OK'}
          </Button>
        </div>
      </div>
    </div>
  );
};
