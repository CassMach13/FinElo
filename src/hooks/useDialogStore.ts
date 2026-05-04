import { create } from 'zustand';

export type DialogVariant = 'info' | 'warning' | 'danger' | 'success';

interface DialogOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: DialogVariant;
  hideCancel?: boolean;
}

interface DialogState {
  isOpen: boolean;
  options: DialogOptions | null;
  resolvePromise: ((value: boolean) => void) | null;
  openDialog: (options: DialogOptions) => Promise<boolean>;
  closeDialog: (result: boolean) => void;
}

export const useDialogStore = create<DialogState>((set, get) => ({
  isOpen: false,
  options: null,
  resolvePromise: null,

  openDialog: (options) => {
    // Retorna uma Promise que ficará pendente até o usuário clicar em uma opção (que aciona closeDialog)
    return new Promise<boolean>((resolve) => {
      set({ 
        isOpen: true, 
        options: {
          variant: 'info',
          confirmText: 'OK',
          cancelText: 'Cancelar',
          ...options
        },
        resolvePromise: resolve 
      });
    });
  },

  closeDialog: (result: boolean) => {
    const { resolvePromise } = get();
    if (resolvePromise) {
      resolvePromise(result);
    }
    // Para animações, apenas esconde primeiro
    set({ isOpen: false, resolvePromise: null });
    // setTimeout(() => set({ options: null }), 300); // Limpa as opções depois da animação (opcional)
  }
}));

/**
 * Utilitário global para substituir o `window.confirm`
 * @param message Mensagem de confirmação
 * @param title Título opcional
 * @param confirmText Texto do botão afirmativo (Ex: Sim, Excluir)
 * @param variant Variante visual do modal (padrão: warning)
 */
export const appConfirm = (
  message: string, 
  title: string = 'Atenção', 
  confirmText: string = 'OK', 
  variant: DialogVariant = 'warning',
  cancelText: string = 'Cancelar'
): Promise<boolean> => {
  return useDialogStore.getState().openDialog({
    message,
    title,
    confirmText,
    cancelText,
    variant,
    hideCancel: false
  });
};

/**
 * Utilitário global para substituir o `window.alert`
 * @param message Mensagem do aviso
 * @param title Título opcional
 * @param variant Variante visual do modal (padrão: info)
 */
export const appAlert = (
  message: string, 
  title: string = 'Aviso', 
  variant: DialogVariant = 'info'
): Promise<void> => {
  return useDialogStore.getState().openDialog({
    message,
    title,
    confirmText: 'Entendi',
    variant,
    hideCancel: true
  }).then(() => {}); // Descarta o boolean
};
