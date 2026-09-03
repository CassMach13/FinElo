import { describe, expect, it } from 'vitest';
import { extractInstallments } from '../../src/domain/installments/installmentMarker';
import { NATIVE_BANK_CONFIGS, parseNativeBankCSV } from '../../src/services/parsers/nativeBankParsers';

/**
 * A parcela lida do TEXTO da descrição, por emissor.
 *
 * O critério para ligar um emissor não é opinião: é ter conferido o formato
 * real dele na base. Os formatos abaixo vieram de descrições reais, com os
 * comerciantes trocados por nomes fictícios.
 */

const config = (id: string) => NATIVE_BANK_CONFIGS.find((c) => c.id === id)!;

describe('a função é a mesma de antes, só mudou de endereço', () => {
  it('lê o marcador no fim da descrição', () => {
    expect(extractInstallments('LOJA ALFA - Parcela 2/6')).toMatchObject({ current: 2, total: 6 });
    expect(extractInstallments('LOJA ALFA (3/12)')).toMatchObject({ current: 3, total: 12 });
    expect(extractInstallments('LOJA ALFA 2 de 4')).toMatchObject({ current: 2, total: 4 });
  });

  it('ancora no FIM — marcador no meio do texto não conta', () => {
    // Casar em qualquer posição é o que multiplica falso positivo.
    expect(extractInstallments('PARCELA 2/6 LOJA ALFA').current).toBeUndefined();
  });

  it('"15/07" é data, não parcela: 15 não pode ser a 15ª de 7', () => {
    expect(extractInstallments('PIX FULANO 15/07').current).toBeUndefined();
  });

  it('marcador que repete o dia/mês da própria transação é descartado', () => {
    // Conservador de propósito: perde uma parcela real comprada em 02/06
    // para não inventar parcela onde havia data.
    expect(extractInstallments('LOJA ALFA 2/6', new Date(2026, 5, 2)).current).toBeUndefined();
  });

  it('devolve a descrição sem o marcador, como sempre devolveu', () => {
    expect(extractInstallments('LOJA ALFA (3/12)').cleanedDescription).toBe('LOJA ALFA');
  });
});

describe('Nubank — fatura escreve a parcela no título', () => {
  // Formato real conferido na base: "<compra> - Parcela X/Y", sem parênteses.
  const nubank = config('nubank-cartao');

  const fatura = (linhas: string) => `date,title,amount\n${linhas}\n`;

  it('preenche Parcela_Atual e Total_Parcelas a partir do título', () => {
    const r = parseNativeBankCSV(
      fatura('2026-02-15,Loja Alfa - Parcela 2/6,"100,00"'),
      nubank, [], [], undefined, 'nubank.csv'
    );

    expect(r.newTransactions[0]).toMatchObject({ Parcela_Atual: 2, Total_Parcelas: 6 });
  });

  it('reconhece parcela de dois dígitos', () => {
    // Caso real: um plano de 12x na competência 07.
    const r = parseNativeBankCSV(
      fatura('2026-07-11,Loja Beta - Parcela 10/12,"103,64"'),
      nubank, [], [], undefined, 'nubank.csv'
    );

    expect(r.newTransactions[0]).toMatchObject({ Parcela_Atual: 10, Total_Parcelas: 12 });
  });

  it('reconhece mesmo sem a palavra "Parcela"', () => {
    // Caso real: descrições que terminam só no marcador, e que se provaram
    // planos verdadeiros (mesmo valor, meses consecutivos).
    const r = parseNativeBankCSV(
      fatura('2026-06-27,Loja Gama 1/2,"106,88"'),
      nubank, [], [], undefined, 'nubank.csv'
    );

    expect(r.newTransactions[0]).toMatchObject({ Parcela_Atual: 1, Total_Parcelas: 2 });
  });

  it('compra à vista continua sem parcela', () => {
    const r = parseNativeBankCSV(
      fatura('2026-02-15,Padaria do Bairro,"77,00"'),
      nubank, [], [], undefined, 'nubank.csv'
    );

    expect(r.newTransactions[0].Parcela_Atual).toBeUndefined();
    expect(r.newTransactions[0].Total_Parcelas).toBeUndefined();
  });

  it('descrição terminando em data não vira parcela', () => {
    const r = parseNativeBankCSV(
      fatura('2026-02-15,Assinatura Delta 15/07,"39,90"'),
      nubank, [], [], undefined, 'nubank.csv'
    );

    expect(r.newTransactions[0].Parcela_Atual).toBeUndefined();
  });

  it('a data da própria transação é levada em conta na leitura', () => {
    // Compra em 02/06 cuja descrição termina em "2/6": é a data repetida no
    // texto. O parser precisa passar a data adiante para essa guarda existir.
    const r = parseNativeBankCSV(
      fatura('2026-06-02,Loja Zeta 2/6,"80,00"'),
      nubank, [], [], undefined, 'nubank.csv'
    );

    expect(r.newTransactions[0].Parcela_Atual).toBeUndefined();
  });

  it('nunca inventa: em dúvida, fica sem parcela', () => {
    const r = parseNativeBankCSV(
      fatura('2026-02-15,Loja Epsilon 7/3,"50,00"'),
      nubank, [], [], undefined, 'nubank.csv'
    );

    expect(r.newTransactions[0].Parcela_Atual).toBeUndefined();
  });
});

describe('XP — o campo explícito do arquivo é a autoridade', () => {
  const xp = config('cartao-xp');

  const fatura = (linhas: string) =>
    `Data;Estabelecimento;Portador;Valor;Parcela\n${linhas}\n`;

  it('usa a coluna de parcela, como sempre usou', () => {
    const r = parseNativeBankCSV(
      fatura('15/02/2026;LOJA ALFA;TITULAR;100,00;2/6'),
      xp, [], [], undefined, 'xp.csv'
    );

    expect(r.newTransactions[0]).toMatchObject({ Parcela_Atual: 2, Total_Parcelas: 6 });
  });

  it('o texto NÃO sobrescreve a coluna quando as duas discordam', () => {
    // Informação explícita do arquivo vence texto solto, sempre.
    const r = parseNativeBankCSV(
      fatura('15/02/2026;LOJA ALFA (9/9);TITULAR;100,00;2/6'),
      xp, [], [], undefined, 'xp.csv'
    );

    expect(r.newTransactions[0]).toMatchObject({ Parcela_Atual: 2, Total_Parcelas: 6 });
  });

  it('sem opt-in, coluna vazia continua sem parcela mesmo com marcador no texto', () => {
    // XP não declara `installmentsFromDescription`: nada muda para ele.
    const r = parseNativeBankCSV(
      fatura('15/02/2026;LOJA ALFA (3/12);TITULAR;100,00;'),
      xp, [], [], undefined, 'xp.csv'
    );

    expect(r.newTransactions[0].Parcela_Atual).toBeUndefined();
  });
});

describe('coluna explícita vence o texto, quando existem as duas', () => {
  /**
   * Nenhum emissor real tem, hoje, coluna de parcela E opt-in de texto ao
   * mesmo tempo — então a precedência só é observável com uma config que
   * junte os dois. Sem este caso, a regra "campo do arquivo vence texto"
   * ficaria escrita no código e não provada por teste nenhum.
   */
  const hibrido = {
    ...config('cartao-xp'),
    id: 'teste-hibrido',
    installmentsFromDescription: true,
  };

  const fatura = (linhas: string) =>
    `Data;Estabelecimento;Portador;Valor;Parcela\n${linhas}\n`;

  it('quando as duas discordam, a coluna manda', () => {
    const r = parseNativeBankCSV(
      fatura('15/02/2026;LOJA ALFA (9/9);TITULAR;100,00;2/6'),
      hibrido, [], [], undefined, 'hibrido.csv'
    );

    expect(r.newTransactions[0]).toMatchObject({ Parcela_Atual: 2, Total_Parcelas: 6 });
  });

  it('só quando a coluna está vazia o texto é consultado', () => {
    const r = parseNativeBankCSV(
      fatura('15/02/2026;LOJA ALFA (3/12);TITULAR;100,00;'),
      hibrido, [], [], undefined, 'hibrido.csv'
    );

    expect(r.newTransactions[0]).toMatchObject({ Parcela_Atual: 3, Total_Parcelas: 12 });
  });
});

describe('conta corrente fica de fora — lá X/Y costuma ser data', () => {
  it('extrato de conta não ganha parcela vinda do texto', () => {
    // Medido na base: em conta corrente 39 descrições passariam pelas
    // guardas e 34 têm cara de data. Por isso o opt-in é por emissor.
    const nubankConta = config('nubank-conta');
    expect(nubankConta.installmentsFromDescription).toBeFalsy();

    const r = parseNativeBankCSV(
      'Data,Valor,Identificador,Descrição\n15/02/2026,-100.00,abc,Assinatura Spotify 10/12\n',
      nubankConta, [], [], undefined, 'nubank-conta.csv'
    );

    expect(r.newTransactions[0]?.Parcela_Atual).toBeUndefined();
  });
});
