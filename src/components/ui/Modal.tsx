
import React, { ReactNode } from 'react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode; // Rodapé opcional para ações
  className?: string; // Permite passar classes customizadas (ex: max-w-4xl)
  hideCloseButton?: boolean;
}

const Modal: React.FC<ModalProps> = ({ isOpen, onClose, title, children, footer, className = 'max-w-md', hideCloseButton = false }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 p-4">
      {/* O container do modal agora é um flex container vertical com altura máxima */}
      <div className={`bg-secondary rounded-lg shadow-xl w-full ${className} mx-auto flex flex-col max-h-[90vh]`}>

        {/* 1. Cabeçalho Fixo */}
        <div className="flex justify-between items-center p-4 border-b border-slate-600">
          <h3 className="text-xl font-bold text-light">{title}</h3>
          {!hideCloseButton && (
            <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">&times;</button>
          )}
        </div>

        {/* 2. Corpo Rolável */}
        <div className="p-4 sm:p-6 overflow-y-auto flex-grow">
          {children}
        </div>

        {/* 3. Rodapé Fixo (Opcional) */}
        {footer && (
          <div className="p-4 border-t border-slate-600 flex-shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};

export default Modal;
