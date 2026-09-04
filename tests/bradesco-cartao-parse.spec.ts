import { describe, expect, it } from 'vitest';
import {
  NATIVE_BANK_CONFIGS,
  detectBankFromContent,
  parseNativeBankCSV,
} from '../src/services/parsers/nativeBankParsers';

/**
 * Bradesco: o parser derrubava a importação inteira.
 *
 * ===========================================================================
 * O QUE ACONTECIA
 * ===========================================================================
 *
 * O ramo dedicado do Bradesco lia `installInfo` sem que ela fosse declarada
 * em lugar nenhum que o alcançasse. A declaração existia, e foi apagada sem
 * querer em 2867e00 (2026-05-15), junto com a guarda de validação logo acima:
 * o hunk trocou três linhas por um bloco de diagnóstico e engoliu a definição.
 *
 * Resultado: `ReferenceError: installInfo is not defined` na PRIMEIRA linha
 * válida de qualquer fatura. Não era um erro de borda — a assinatura do
 * arquivo é reconhecida, então o usuário era roteado para este parser e só
 * então batia no crash. Ficou assim por ~3,5 meses, sem nenhum teste de
 * Bradesco para pegar (Nubank e XP têm; este emissor não tinha nenhum).
 *
 * ===========================================================================
 * A FIXTURE
 * ===========================================================================
 *
 * Montada SOMENTE com o que a própria config do emissor declara: delimitador
 * `;`, layout `Data | Histórico | Valor(US$) | Valor(R$)`, valores no formato
 * brasileiro, positivo = despesa, e as strings de assinatura e de exclusão que
 * já estão no código. Nada aqui foi inventado sobre a fatura real.
 *
 * Por isso estes testes provam que o crash morreu para o layout que o sistema
 * declara hoje — e não que "Bradesco está suportado". Validar o formato real
 * com um export de verdade é assunto separado.
 */

const bradesco = NATIVE_BANK_CONFIGS.find((c) => c.id === 'bradesco-cartao')!;

const FATURA = `Bradesco Internet Banking
Situação da Fatura;;;
FULANO DE TAL;1234;;
Data;Histórico;Valor(US$);Valor(R$)
15/01/2026;SUPERMERCADO XYZ;0,00;100,00
20/01/2026;POSTO DA ESQUINA;0,00;250,50
`;

const parse = (conteudo: string) =>
  parseNativeBankCSV(conteudo, bradesco, [], [], undefined, 'bradesco.csv');

describe('Bradesco — o arquivo chega até este parser', () => {
  it('1. a assinatura da fatura é reconhecida', () => {
    // Se não fosse, o crash seria inalcançável e o bug, teórico.
    expect(detectBankFromContent(FATURA)?.id).toBe('bradesco-cartao');
  });
});

describe('Bradesco — o crash do issue #31', () => {
  it('2. uma linha válida não lança ReferenceError', () => {
    expect(() => parse(FATURA)).not.toThrow();
  });

  it('3. os dados da linha são lidos', () => {
    const r = parse(FATURA);
    const mercado = r.newTransactions.find((t) =>
      t.Descricao_Original.includes('SUPERMERCADO')
    )!;

    expect(mercado).toBeDefined();
    expect(mercado.Valor).toBe(-100); // invertValues: positivo na fatura = despesa
    expect(mercado.Tipo).toBe('Despesa');
    expect(mercado.Data.getFullYear()).toBe(2026);
    expect(mercado.Data.getMonth()).toBe(0);
    expect(mercado.Data.getDate()).toBe(15);
  });

  it('lê o valor decimal no formato brasileiro', () => {
    const posto = parse(FATURA).newTransactions.find((t) =>
      t.Descricao_Original.includes('POSTO')
    )!;

    expect(posto.Valor).toBe(-250.5);
  });
});

describe('Bradesco — nenhuma parcela é inventada', () => {
  it('4. Parcela_Atual fica sem valor', () => {
    for (const t of parse(FATURA).newTransactions) {
      expect(t.Parcela_Atual).toBeUndefined();
    }
  });

  it('5. Total_Parcelas fica sem valor', () => {
    for (const t of parse(FATURA).newTransactions) {
      expect(t.Total_Parcelas).toBeUndefined();
    }
  });

  it('8. nem mesmo um marcador no Histórico gera parcelamento', () => {
    // O arquivo não traz coluna de parcela, e ler o texto do Histórico não
    // está provado para este emissor. Enquanto não estiver, o certo é não
    // saber — nunca adivinhar.
    const comMarcador = `Bradesco Internet Banking
Situação da Fatura;;;
Data;Histórico;Valor(US$);Valor(R$)
15/01/2026;LOJA ALFA PARC 02/06;0,00;100,00
20/01/2026;LOJA BETA (3/12);0,00;80,00
25/01/2026;LOJA GAMA 2 de 4;0,00;60,00
`;

    const r = parse(comMarcador);
    expect(r.newTransactions).toHaveLength(3);

    for (const t of r.newTransactions) {
      expect(t.Parcela_Atual).toBeUndefined();
      expect(t.Total_Parcelas).toBeUndefined();
      // e a descrição chega inteira, sem marcador removido
      expect(t.Descricao_Original).toMatch(/LOJA (ALFA|BETA|GAMA)/);
    }
  });
});

describe('Bradesco — o resto do parser segue funcionando', () => {
  it('6. linha na lista de exclusão continua ignorada', () => {
    const comRuido = `Bradesco Internet Banking
Situação da Fatura;;;
Data;Histórico;Valor(US$);Valor(R$)
15/01/2026;SUPERMERCADO XYZ;0,00;100,00
;SALDO ANTERIOR;0,00;500,00
`;

    const r = parse(comRuido);
    expect(r.newTransactions).toHaveLength(1);
    expect(r.ignoredCount).toBeGreaterThanOrEqual(1);
    expect(
      r.newTransactions.some((t) => t.Descricao_Original.includes('SALDO ANTERIOR'))
    ).toBe(false);
  });

  it('7. arquivo só com cabeçalho é válido e não produz lançamento', () => {
    const soCabecalho = `Bradesco Internet Banking
Situação da Fatura;;;
Data;Histórico;Valor(US$);Valor(R$)
`;

    const r = parse(soCabecalho);
    expect(r.newTransactions).toHaveLength(0);
    expect(r.successCount).toBe(0);
  });

  it('o portador do bloco é atribuído às compras dele', () => {
    // O parser é multi-portador: cada bloco tem seu cabeçalho e suas linhas.
    const t = parse(FATURA).newTransactions[0];
    expect(t.Portador).toContain('FULANO DE TAL');
  });
});
