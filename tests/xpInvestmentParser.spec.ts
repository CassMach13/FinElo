import { existsSync, readdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import * as xlsx from 'xlsx';
import { xpInvestmentParser } from '../src/services/parsers/xpInvestmentParser';

const __dirname = dirname(fileURLToPath(import.meta.url));

const cents = (value: number) => Math.round(value * 100);

/** Monta um .xlsx em memória no layout da "Posição Detalhada" da XP (aba "Sua carteira"). */
const planilha = (secoes: unknown[][]): ArrayBuffer => {
    const linhas = [
        [' ', null, null, null, null, 'Conta: 0000000 | Data da Posição Histórica: 31/08/2026'],
        [' ', ' ', ' '],
        ['Fulano, este é o seu patrimônio', 'Total investido histórico', 'Saldo Disponível histórico'],
        ['R$ 0,00', 'R$ 0,00', 'R$ 0,00'],
        [' ', ' ', ' '],
        ...secoes,
    ];
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet(linhas), 'Sua carteira');
    return xlsx.write(wb, { type: 'array', bookType: 'xlsx' });
};

const vazia = [' ', ' ', ' '];

describe('xpInvestmentParser — layout com coluna "Saldo" (a partir de ago/2026)', () => {
    const agosto = () =>
        planilha([
            ['Fundos de Investimentos', null, null, null, null, null, 'R$ 10.000,10'],
            vazia,
            ['61,7% | Pós-Fixado', null, null, 'Saldo', '% Alocação', 'Valor aplicado', 'Saldo líquido'],
            ['Fundo Alfa RF CP RL', '', '', 'R$ 10.000,10', '58%', 'R$ 9.800,00', 'R$ 9.950,00'],
            vazia,
            ['Renda Fixa', null, null, null, null, null, 'R$ 2.135,87'],
            vazia,
            ['13,3% | Pós-Fixado', 'Saldo a mercado', '% Alocação', 'Valor aplicado', 'Valor aplicado original', 'Rentabilidade a mercado', 'Data aplicação', 'Data vencimento', 'Saldo líquido'],
            ['LCA Banco Exemplo - FEV/2028', 'R$ 2.135,87', '12%', 'R$ 2.127,01', 'R$ 0,00', '80,50% CDI', '17/08/2026', '11/02/2028', 'R$ 2.135,87'],
            vazia,
            ['Previdência Privada', null, null, null, null, null, 'R$ 5.000,00'],
            vazia,
            ['30% | Multimercados', null, null, 'Saldo', '% Alocação', 'Rendimento bruto', 'Valor aplicado'],
            ['Prev Exemplo FIC FIM', '', '', 'R$ 5.000,00', '30%', 'R$ 500,00', 'R$ 4.500,00'],
        ]);

    it('lê as três seções e fecha em centavos com os subtotais da XP', async () => {
        const { investments } = await xpInvestmentParser.parseExcel(agosto(), '2026-08-01');

        expect(investments.map((i) => [i.product_type, i.product_name, cents(i.balance)])).toEqual([
            ['Fundos de Investimentos', 'Fundo Alfa RF CP RL', 1000010],
            ['Renda Fixa', 'LCA Banco Exemplo - FEV/2028', 213587],
            ['Previdência Privada', 'Prev Exemplo FIC FIM', 500000],
        ]);
        // 1.000.010 + 213.587 + 500.000 = 1.713.597 centavos
        expect(investments.reduce((s, i) => s + cents(i.balance), 0)).toBe(1713597);
    });

    it('mantém os metadados das colunas renomeadas', async () => {
        const { investments } = await xpInvestmentParser.parseExcel(agosto(), '2026-08-01');
        const [fundo, lca, prev] = investments;

        expect(fundo.invested_principal).toBe(9800);
        expect(lca).toMatchObject({
            yield_rate: '80,50% CDI',
            application_date: '2026-08-17',
            maturity_date: '2028-02-11',
            invested_principal: 2127.01,
            reference_month: '2026-08-01',
        });
        expect(lca.original_applied_amount).toBeUndefined();
        expect(prev).toMatchObject({ gross_return_amount: 500, invested_principal: 4500 });
    });
});

describe('xpInvestmentParser — linhas de total', () => {
    it('importa produto com "Total" no nome e ainda ignora a linha de total da seção', async () => {
        const buffer = planilha([
            ['Fundos de Investimentos', null, null, null, null, null, 'R$ 1.250,50'],
            vazia,
            ['100% | Pós-Fixado', 'Posição', '% Alocação', 'Rentabilidade Líquida', 'Rentabilidade Bruta', 'Valor aplicado', 'Valor líquido'],
            ['Fundo Premium DI', 'R$ 1.000,00', '80%', '0%', '0%', 'R$ 950,00', 'R$ 990,00'],
            ['Gestora Exemplo Total Credit Advisory FIC FIF RF CP', 'R$ 250,50', '20%', '0%', '0%', 'R$ 240,00', 'R$ 248,00'],
            ['Total', 'R$ 1.250,50'],
        ]);

        const { investments } = await xpInvestmentParser.parseExcel(buffer, '2026-07-01');

        expect(investments.map((i) => [i.product_name, cents(i.balance)])).toEqual([
            ['Fundo Premium DI', 100000],
            ['Gestora Exemplo Total Credit Advisory FIC FIF RF CP', 25050],
        ]);
    });
});

describe('xpInvestmentParser — falha fechada quando a seção não fecha', () => {
    it('bloqueia quando a coluna de saldo vem com um rótulo desconhecido', async () => {
        const buffer = planilha([
            ['Fundos de Investimentos', null, null, null, null, null, 'R$ 10.000,10'],
            vazia,
            ['100% | Pós-Fixado', null, null, 'Valor atual', '% Alocação', 'Valor aplicado'],
            ['Fundo Alfa RF CP RL', '', '', 'R$ 10.000,10', '100%', 'R$ 9.800,00'],
        ]);

        await expect(xpInvestmentParser.parseExcel(buffer, '2026-09-01')).rejects.toThrow(
            /Fundos de Investimentos: a XP informa R\$\s10\.000,10, foram lidos R\$\s0,00/
        );
    });

    it('bloqueia quando falta uma posição dentro da seção', async () => {
        const buffer = planilha([
            ['Fundos de Investimentos', null, null, null, null, null, 'R$ 1.250,50'],
            vazia,
            ['100% | Pós-Fixado', 'Posição', '% Alocação', 'Valor aplicado'],
            ['Fundo Premium DI', 'R$ 1.000,00', '80%', 'R$ 950,00'],
            ['Fundo Sem Saldo Legível', 'indisponível', '20%', 'R$ 240,00'],
        ]);

        await expect(xpInvestmentParser.parseExcel(buffer, '2026-07-01')).rejects.toThrow(
            /a XP informa R\$\s1\.250,50, foram lidos R\$\s1\.000,00/
        );
    });

    it('aceita o arredondamento de centavo da XP, limitado a (linhas + 1) / 2', async () => {
        // 5 linhas somam R$ 6.606,01; a XP imprime R$ 6.606,02 (cada valor exibido é arredondado).
        const rendaFixa = (subtotal: string) =>
            planilha([
                ['Renda Fixa', null, null, null, null, null, subtotal],
                vazia,
                ['30,7% | Pós-Fixado', 'Posição a mercado', '% Alocação'],
                ['LCA A', 'R$ 2.212,05', '10%'],
                ['LCA B', 'R$ 1.105,59', '5%'],
                ['LCA C', 'R$ 1.105,19', '5%'],
                ['LCA D', 'R$ 1.091,86', '5%'],
                ['LCA E', 'R$ 1.091,32', '5%'],
            ]);

        const { investments } = await xpInvestmentParser.parseExcel(rendaFixa('R$ 6.606,02'), '2026-01-01');
        expect(investments.reduce((s, i) => s + cents(i.balance), 0)).toBe(660601);

        // Limite para 5 linhas: 3 centavos. 4 centavos já não é arredondamento.
        await expect(xpInvestmentParser.parseExcel(rendaFixa('R$ 6.606,04'), '2026-01-01')).resolves.toBeDefined();
        await expect(xpInvestmentParser.parseExcel(rendaFixa('R$ 6.606,05'), '2026-01-01')).rejects.toThrow(/Renda Fixa/);
    });
});

/**
 * Extratos reais em `modelos de fatura/` são ignorados pelo git (dados pessoais), então
 * este bloco só roda na máquina de quem tem os arquivos. Nenhum valor é fixado aqui: o
 * gabarito é o próprio cabeçalho da XP ("Total investido histórico").
 */
const pastaReal = join(__dirname, '../modelos de fatura/Investimentos XP');
const arquivosReais = existsSync(pastaReal) ? readdirSync(pastaReal).filter((f) => f.endsWith('.xlsx')) : [];

describe.skipIf(arquivosReais.length === 0)('xpInvestmentParser — extratos reais da XP', () => {
    it.each(arquivosReais)('%s fecha com o "Total investido histórico" da XP', async (arquivo) => {
        const bytes = readFileSync(join(pastaReal, arquivo));
        const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

        const { investments } = await xpInvestmentParser.parseExcel(buffer, '2026-01-01');

        const linhas = xlsx.utils.sheet_to_json<unknown[]>(xlsx.read(buffer, { type: 'array' }).Sheets['Sua carteira'], { header: 1 });
        const totalInvestido = cents(xpInvestmentParser.parseCurrency(String(linhas[3][1])));
        const lido = investments.reduce((s, i) => s + cents(i.balance), 0);

        expect(investments.length).toBeGreaterThan(0);
        expect(Math.abs(totalInvestido - lido)).toBeLessThanOrEqual(Math.floor((investments.length + 1) / 2));
    });
});
