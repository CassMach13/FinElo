import type { Investment } from '../../types';
import type { XpParseResult, XpReconciliation } from '../../services/parsers/xpInvestmentParser';

export type ParsedInvestment = Omit<Investment, 'id' | 'user_id' | 'created_at' | 'updated_at'>;

export type ImportSessionStatus = 'idle' | 'parsing' | 'ready' | 'importing';

export interface ImportSessionState {
    /** Muda a cada reset ou novo arquivo; resultados assíncronos de uma sessão anterior são descartados. */
    sessionId: number;
    /** Mês (YYYY-MM-01) ao qual a sessão pertence. */
    referenceMonth: string;
    institution: string;
    fileName: string | null;
    parsedInvestments: ParsedInvestment[] | null;
    reconciliation: XpReconciliation | null;
    status: ImportSessionStatus;
    error: string | null;
}

export interface ImportSessionFile {
    name: string;
    arrayBuffer(): Promise<ArrayBuffer>;
}

export interface ImportSessionDeps {
    parse(institution: string, buffer: ArrayBuffer, referenceMonth: string): Promise<XpParseResult>;
    isAlreadyImported(userId: string, institution: string, referenceMonth: string, fileName: string): Promise<boolean>;
    saveBatch(rows: Array<ParsedInvestment & { user_id: string }>): Promise<void>;
}

export type ConfirmOutcome = 'imported' | 'rejected' | 'busy' | 'failed';

export const DEFAULT_IMPORT_INSTITUTION = 'XP';

export const toReferenceMonth = (date: Date): string =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`;

const emptySession = (sessionId: number, referenceMonth: string): ImportSessionState => ({
    sessionId,
    referenceMonth,
    institution: DEFAULT_IMPORT_INSTITUTION,
    fileName: null,
    parsedInvestments: null,
    reconciliation: null,
    status: 'idle',
    error: null,
});

const errorMessage = (err: unknown, fallback: string): string =>
    err instanceof Error && err.message ? err.message : fallback;

/**
 * Só há o que confirmar quando arquivo, leitura e mês visível pertencem à mesma sessão:
 * a sessão precisa ser do mês exibido e cada linha precisa carregar o mês e o arquivo dela.
 */
export const canConfirmImport = (state: ImportSessionState, visibleReferenceMonth: string): boolean => {
    const rows = state.parsedInvestments;
    return (
        state.status === 'ready' &&
        state.fileName !== null &&
        rows !== null &&
        rows.length > 0 &&
        state.referenceMonth === visibleReferenceMonth &&
        rows.every(row => row.reference_month === state.referenceMonth && row.source_file === state.fileName)
    );
};

export type InvestmentImportSession = ReturnType<typeof createInvestmentImportSession>;

/**
 * Estado da importação de uma planilha, isolado do React para que as regras de reset possam ser testadas.
 * Toda saída do fluxo (fechar, cancelar, voltar, trocar mês ou corretora, concluir) começa uma sessão vazia.
 */
export function createInvestmentImportSession(deps: ImportSessionDeps, referenceMonth: string) {
    let state = emptySession(0, referenceMonth);
    const listeners = new Set<() => void>();

    const set = (next: ImportSessionState) => {
        state = next;
        listeners.forEach(listener => listener());
    };

    const reset = (month: string, overrides: Partial<ImportSessionState> = {}) =>
        set({ ...emptySession(state.sessionId + 1, month), ...overrides });

    return {
        getState: () => state,

        subscribe(listener: () => void) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },

        /** Abrir sempre começa do zero, mesmo que o modal tenha sido escondido sem passar por close(). */
        open(month: string) {
            reset(month);
        },

        /** X e Cancelar. */
        close() {
            reset(state.referenceMonth);
        },

        /** "Voltar e escolher outro arquivo". */
        back() {
            reset(state.referenceMonth);
        },

        changeMonth(month: string) {
            if (month !== state.referenceMonth) reset(month);
        },

        selectInstitution(institution: string) {
            reset(state.referenceMonth, { institution });
        },

        async selectFile(file: ImportSessionFile): Promise<void> {
            const { referenceMonth: month, institution } = state;
            reset(month, { institution, fileName: file.name, status: 'parsing' });
            const sessionId = state.sessionId;

            try {
                const result = await deps.parse(institution, await file.arrayBuffer(), month);
                if (state.sessionId !== sessionId) return;
                if (result.investments.length === 0) {
                    throw new Error('Nenhum investimento encontrado. Verifique se a planilha está no formato correto da corretora.');
                }
                set({
                    ...state,
                    status: 'ready',
                    parsedInvestments: result.investments.map(inv => ({ ...inv, source_file: file.name })),
                    reconciliation: result.reconciliation,
                });
            } catch (err) {
                if (state.sessionId !== sessionId) return;
                reset(month, { institution, error: errorMessage(err, 'Erro ao processar o arquivo.') });
            }
        },

        async confirm(userId: string, visibleReferenceMonth: string): Promise<ConfirmOutcome> {
            if (state.status === 'importing') return 'busy';

            if (!canConfirmImport(state, visibleReferenceMonth)) {
                reset(visibleReferenceMonth, {
                    error: 'A planilha lida não pertence a esta importação. Selecione o arquivo novamente.',
                });
                return 'rejected';
            }

            const session = state;
            set({ ...session, status: 'importing', error: null });

            try {
                if (await deps.isAlreadyImported(userId, session.institution, session.referenceMonth, session.fileName!)) {
                    throw new Error(`O arquivo "${session.fileName}" já foi importado para ${session.institution} neste mês.`);
                }
                await deps.saveBatch(session.parsedInvestments!.map(inv => ({ ...inv, user_id: userId })));
                reset(session.referenceMonth);
                return 'imported';
            } catch (err) {
                if (state.sessionId === session.sessionId) {
                    set({ ...session, error: errorMessage(err, 'Erro ao salvar os investimentos no banco de dados.') });
                }
                return 'failed';
            }
        },
    };
}
