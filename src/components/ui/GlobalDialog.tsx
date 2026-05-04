import React, { useEffect, useCallback } from 'react';
import { useDialogStore } from '../../hooks/useDialogStore';
import Button from './Button';
import { AlertCircleIcon, InformationCircleIcon, CheckIcon } from './icons';

export const GlobalDialog: React.FC = () => {
  const { isOpen, options, closeDialog } = useDialogStore();

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isOpen || !options) return;
      if (e.key === 'Escape' && !options.hideCancel) {
        closeDialog(false);
      } else if (e.key === 'Enter') {
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
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm transition-opacity duration-200">
      {/* Clique fora para fechar se não for obrigatório */}
      <div 
        className="absolute inset-0" 
        onClick={() => !hideCancel && closeDialog(false)}
      />
      
      <div className="relative w-full max-w-md bg-secondary border border-slate-700/60 rounded-2xl shadow-2xl overflow-hidden flex flex-col transform scale-100 transition-transform duration-200">
        
        {/* Header Decorativo */}
        <div className={`p-4 flex items-center gap-3 border-b border-slate-700/50 ${bgMap[variant || 'info']}`}>
          {iconMap[variant || 'info']}
          <h3 className="text-lg font-bold text-white tracking-wide">
            {title || 'Atenção'}
          </h3>
        </div>

        {/* Corpo */}
        <div className="p-6">
          <p className="text-gray-300 whitespace-pre-line leading-relaxed text-[15px]">
            {message}
          </p>
        </div>

        {/* Footer (Ações) */}
        <div className="px-6 py-4 bg-slate-800/30 border-t border-slate-700/50 flex justify-end gap-3 rounded-b-2xl">
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
            className="px-5 py-2 font-bold shadow-lg"
          >
            {confirmText || 'OK'}
          </Button>
        </div>
      </div>
    </div>
  );
};
