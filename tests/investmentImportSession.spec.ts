import { describe, expect, it, vi } from 'vitest';
import {
    canConfirmImport,
    createInvestmentImportSession,
    ImportSessionDeps,
    ImportSessionFile,
    ImportSessionState,
    InvestmentImportSession,
    toReferenceMonth,
} from '../src/components/modals/investmentImportSession';
import type { XpParseResult } from '../src/services/parsers/xpInvestmentParser';

const AGOSTO = '2026-08-01';
const SETEMBRO = '2026-09-01';
const USUARIO = 'usuario-1';

const bytes = (nome: string) => new TextEncoder().encode(nome).buffer as ArrayBuffer;
const nomeDe = (buffer: ArrayBuffer) => new TextDecoder().decode(buffer);

const arquivo = (nome: string): ImportSessionFile => ({ name: nome, arrayBuffer: async () => bytes(nome) });

/** Leitura falsa: cada arquivo vira duas posições identificáveis pelo nome, no mês pedido. */
const resultado = (nome: string, referenceMonth: string): XpParseResult => ({
    investments: [1, 2].map(i => ({
        institution: 'XP',
        product_type: 'Renda Fixa',
        product_name: `${nome} #${i}`,
        balance: 100 * i,
        reference_month: referenceMonth,
    })),
    reconciliation: { brokerTotal: 300, availableCash: 0, positionsTotal: 300, unmatchedAmount: 0 },
});

const dependencias = () => ({
    parse: vi.fn<ImportSessionDeps['parse']>(async (_institution, buffer, referenceMonth) =>
        resultado(nomeDe(buffer), referenceMonth)
    ),
    isAlreadyImported: vi.fn<ImportSessionDeps['isAlreadyImported']>(async () => false),
    saveBatch: vi.fn<ImportSessionDeps['saveBatch']>(async () => undefined),
});

interface Adiado<T> {
    promise: Promise<T>;
    resolver(value: T): void;
}

const adiado = <T>(): Adiado<T> => {
    let resolver!: (value: T) => void;
    const promise = new Promise<T>(resolve => {
        resolver = resolve;
    });
    return { promise, resolver };
};

const sessaoLimpa = (referenceMonth: string): Partial<ImportSessionState> => ({
    referenceMonth,
    institution: 'XP',
    fileName: null,
    parsedInvestments: null,
    reconciliation: null,
    status: 'idle',
    error: null,
});

const sessaoComArquivoLido = async () => {
    const deps = dependencias();
    const sessao = createInvestmentImportSession(deps, AGOSTO);
    sessao.open(AGOSTO);
    await sessao.selectFile(arquivo('A.xlsx'));
    expect(sessao.getState()).toMatchObject({ status: 'ready', fileName: 'A.xlsx' });
    expect(canConfirmImport(sessao.getState(), AGOSTO)).toBe(true);
    return { sessao, deps };
};

describe('toReferenceMonth', () => {
    it('usa o primeiro dia do mês local', () => {
        expect(toReferenceMonth(new Date(2026, 7, 31, 23, 59))).toBe(AGOSTO);
    });
});

describe('sessão de importação de investimentos: modal persistente', () => {
    it('arquivo A lido em agosto não fica disponível depois de fechar, reabrir e selecionar setembro', async () => {
        const { sessao, deps } = await sessaoComArquivoLido();

        sessao.close();
        sessao.open(AGOSTO);
        expect(sessao.getState()).toMatchObject(sessaoLimpa(AGOSTO));

        sessao.changeMonth(SETEMBRO);
        expect(sessao.getState()).toMatchObject(sessaoLimpa(SETEMBRO));
        expect(canConfirmImport(sessao.getState(), SETEMBRO)).toBe(false);

        expect(await sessao.confirm(USUARIO, SETEMBRO)).toBe('rejected');
        expect(deps.saveBatch).not.toHaveBeenCalled();
    });

    it('mesmo sem reset, linhas lidas para agosto nunca são confirmadas com setembro visível', async () => {
        const { sessao, deps } = await sessaoComArquivoLido();

        // Reproduz o modal antigo: a leitura continua pronta, mas a tela já mostra setembro.
        expect(canConfirmImport(sessao.getState(), SETEMBRO)).toBe(false);
        expect(await sessao.confirm(USUARIO, SETEMBRO)).toBe('rejected');

        expect(deps.saveBatch).not.toHaveBeenCalled();
        expect(sessao.getState()).toMatchObject({
            ...sessaoLimpa(SETEMBRO),
            error: expect.stringContaining('Selecione o arquivo novamente'),
        });
    });

    it('linhas com mês diferente do da sessão não habilitam a confirmação', async () => {
        const deps = dependencias();
        deps.parse.mockImplementation(async (_institution, buffer) => resultado(nomeDe(buffer), '2026-07-01'));
        const sessao = createInvestmentImportSession(deps, AGOSTO);

        await sessao.selectFile(arquivo('A.xlsx'));

        expect(sessao.getState().status).toBe('ready');
        expect(canConfirmImport(sessao.getState(), AGOSTO)).toBe(false);
        expect(await sessao.confirm(USUARIO, AGOSTO)).toBe('rejected');
        expect(deps.saveBatch).not.toHaveBeenCalled();
    });
});

describe('sessão de importação de investimentos: reset completo', () => {
    it.each<[string, (sessao: InvestmentImportSession) => void]>([
        ['Cancelar (close)', sessao => sessao.close()],
        ['fechar pelo X (close)', sessao => sessao.close()],
        ['Voltar e escolher outro arquivo (back)', sessao => sessao.back()],
        ['trocar a corretora (selectInstitution)', sessao => sessao.selectInstitution('XP')],
    ])('%s limpa arquivo, leitura, totais, mensagens e confirmação', async (_acao, agir) => {
        const { sessao } = await sessaoComArquivoLido();

        agir(sessao);

        expect(sessao.getState()).toMatchObject(sessaoLimpa(AGOSTO));
        expect(canConfirmImport(sessao.getState(), AGOSTO)).toBe(false);
    });

    it('Voltar e fechar também limpam a mensagem de uma leitura recusada', async () => {
        const deps = dependencias();
        deps.parse.mockRejectedValue(new Error('A planilha não fecha com os totais da XP (Renda Fixa: ...)'));
        const sessao = createInvestmentImportSession(deps, AGOSTO);

        await sessao.selectFile(arquivo('ruim.xlsx'));
        expect(sessao.getState()).toMatchObject({ ...sessaoLimpa(AGOSTO), error: expect.stringContaining('Renda Fixa') });
        expect(canConfirmImport(sessao.getState(), AGOSTO)).toBe(false);

        sessao.back();
        expect(sessao.getState()).toMatchObject(sessaoLimpa(AGOSTO));

        await sessao.selectFile(arquivo('ruim.xlsx'));
        sessao.close();
        expect(sessao.getState()).toMatchObject(sessaoLimpa(AGOSTO));
    });

    it('planilha sem posições vira erro e nada fica para confirmar', async () => {
        const deps = dependencias();
        deps.parse.mockResolvedValue({ investments: [], reconciliation: null });
        const sessao = createInvestmentImportSession(deps, AGOSTO);

        await sessao.selectFile(arquivo('vazia.xlsx'));

        expect(sessao.getState()).toMatchObject({
            ...sessaoLimpa(AGOSTO),
            error: expect.stringContaining('Nenhum investimento encontrado'),
        });
    });

    it('confirmação bem-sucedida grava uma vez e limpa a sessão antes de devolver o controle ao modal', async () => {
        const { sessao, deps } = await sessaoComArquivoLido();
        const estados: ImportSessionState['status'][] = [];
        sessao.subscribe(() => estados.push(sessao.getState().status));

        expect(await sessao.confirm(USUARIO, AGOSTO)).toBe('imported');

        expect(deps.saveBatch).toHaveBeenCalledTimes(1);
        expect(deps.saveBatch.mock.calls[0][0]).toEqual([
            expect.objectContaining({ product_name: 'A.xlsx #1', user_id: USUARIO, source_file: 'A.xlsx', reference_month: AGOSTO }),
            expect.objectContaining({ product_name: 'A.xlsx #2', user_id: USUARIO, source_file: 'A.xlsx', reference_month: AGOSTO }),
        ]);
        expect(estados).toEqual(['importing', 'idle']);
        expect(sessao.getState()).toMatchObject(sessaoLimpa(AGOSTO));
    });

    it('trocar o mês descarta a leitura, e voltar ao mês original não a recupera', async () => {
        const { sessao, deps } = await sessaoComArquivoLido();

        sessao.changeMonth(SETEMBRO);
        expect(sessao.getState()).toMatchObject(sessaoLimpa(SETEMBRO));

        sessao.changeMonth(AGOSTO);
        expect(sessao.getState()).toMatchObject(sessaoLimpa(AGOSTO));
        expect(await sessao.confirm(USUARIO, AGOSTO)).toBe('rejected');
        expect(deps.saveBatch).not.toHaveBeenCalled();
    });

    it('trocar de arquivo descarta a leitura anterior na hora, e uma leitura antiga que termina depois é ignorada', async () => {
        const deps = dependencias();
        const leituras: Record<string, Adiado<XpParseResult>> = { 'A.xlsx': adiado(), 'B.xlsx': adiado() };
        deps.parse.mockImplementation((_institution, buffer) => leituras[nomeDe(buffer)].promise);
        const sessao = createInvestmentImportSession(deps, AGOSTO);

        const selecaoA = sessao.selectFile(arquivo('A.xlsx'));
        const selecaoB = sessao.selectFile(arquivo('B.xlsx'));
        expect(sessao.getState()).toMatchObject({ status: 'parsing', fileName: 'B.xlsx', parsedInvestments: null });
        expect(canConfirmImport(sessao.getState(), AGOSTO)).toBe(false);

        leituras['B.xlsx'].resolver(resultado('B.xlsx', AGOSTO));
        await selecaoB;
        leituras['A.xlsx'].resolver(resultado('A.xlsx', AGOSTO));
        await selecaoA;

        expect(sessao.getState().fileName).toBe('B.xlsx');
        expect(sessao.getState().parsedInvestments?.map(p => p.product_name)).toEqual(['B.xlsx #1', 'B.xlsx #2']);
    });

    it('escolher outro arquivo com uma leitura pronta tira as linhas anteriores antes de ler o novo', async () => {
        const { sessao, deps } = await sessaoComArquivoLido();
        const leituraB = adiado<XpParseResult>();
        deps.parse.mockImplementation(() => leituraB.promise);

        const selecaoB = sessao.selectFile(arquivo('B.xlsx'));

        expect(sessao.getState()).toMatchObject({
            status: 'parsing',
            fileName: 'B.xlsx',
            parsedInvestments: null,
            reconciliation: null,
        });
        expect(canConfirmImport(sessao.getState(), AGOSTO)).toBe(false);

        leituraB.resolver(resultado('B.xlsx', AGOSTO));
        await selecaoB;
        expect(sessao.getState().parsedInvestments?.map(p => p.product_name)).toEqual(['B.xlsx #1', 'B.xlsx #2']);
    });

    it('fechar durante a leitura descarta o resultado que chega depois', async () => {
        const deps = dependencias();
        const leitura = adiado<XpParseResult>();
        deps.parse.mockImplementation(() => leitura.promise);
        const sessao = createInvestmentImportSession(deps, AGOSTO);

        const selecao = sessao.selectFile(arquivo('A.xlsx'));
        sessao.close();
        leitura.resolver(resultado('A.xlsx', AGOSTO));
        await selecao;

        expect(sessao.getState()).toMatchObject(sessaoLimpa(AGOSTO));
        sessao.open(AGOSTO);
        expect(sessao.getState()).toMatchObject(sessaoLimpa(AGOSTO));
        expect(canConfirmImport(sessao.getState(), AGOSTO)).toBe(false);
    });

    it('reabrir o modal nunca mostra um arquivo lido antes, mesmo se o fechamento não passou pela sessão', async () => {
        const { sessao } = await sessaoComArquivoLido();

        // O pai pode esconder o modal sem chamar close(); a próxima abertura precisa começar do zero.
        sessao.open(AGOSTO);

        expect(sessao.getState()).toMatchObject(sessaoLimpa(AGOSTO));
    });

    it('arquivo já importado não grava e mantém a leitura para o usuário decidir', async () => {
        const { sessao, deps } = await sessaoComArquivoLido();
        deps.isAlreadyImported.mockResolvedValue(true);

        expect(await sessao.confirm(USUARIO, AGOSTO)).toBe('failed');

        expect(deps.saveBatch).not.toHaveBeenCalled();
        expect(sessao.getState()).toMatchObject({ status: 'ready', error: expect.stringContaining('já foi importado') });
    });

    it('clique duplo em Confirmar grava uma única vez', async () => {
        const { sessao, deps } = await sessaoComArquivoLido();

        const primeira = sessao.confirm(USUARIO, AGOSTO);
        expect(await sessao.confirm(USUARIO, AGOSTO)).toBe('busy');
        expect(await primeira).toBe('imported');

        expect(deps.saveBatch).toHaveBeenCalledTimes(1);
    });
});
