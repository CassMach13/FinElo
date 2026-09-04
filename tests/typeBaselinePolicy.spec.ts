import { describe, expect, it } from 'vitest';
import {
  CODIGOS_PROIBIDOS,
  avaliarBaseline,
  codigoDoDiagnostico,
  reprovado,
} from '../scripts/typeBaselinePolicy.mjs';

/**
 * A política do baseline de tipos.
 *
 * O baseline aceita dívida técnica: erros legados ficam registrados e o check
 * só reclama quando o conjunto muda. Isso é útil — e era cego à CLASSE do
 * erro, tratando um `TS2322` (tipos incompatíveis, o código roda) igual a um
 * `TS2304` (o símbolo não existe).
 *
 * O acidente que motivou isto: o parser do Bradesco ficou ~3,5 meses lançando
 * `ReferenceError: installInfo is not defined` na primeira linha válida de
 * qualquer fatura, com os dois `TS2304` correspondentes tranquilamente
 * registrados no baseline. A rede de segurança não barrou o erro — registrou.
 */

const LEGADO = "src/components/views/TransactionsView.tsx TS2322: Type 'string' is not assignable to type 'Date'.";
const LEGADO_2 = "src/hooks/useAppStore.ts TS2367: This comparison appears to be unintentional.";
const NOVO_NORMAL = "src/services/algo.ts TS2339: Property 'x' does not exist on type 'unknown'.";
const PROIBIDO_2304 = "src/services/parsers/nativeBankParsers.ts TS2304: Cannot find name 'installInfo'.";
const PROIBIDO_2552 = "src/services/outro.ts TS2552: Cannot find name 'fooo'. Did you mean 'foo'?";

describe('a lista de códigos proibidos é curta de propósito', () => {
  it('bloqueia apenas falhas de resolução de símbolo', () => {
    // Não ampliar por conveniência: só entra código que signifique
    // "este símbolo não existe", nunca desconforto de tipagem.
    expect([...CODIGOS_PROIBIDOS].sort()).toEqual(['TS2304', 'TS2552']);
  });

  it('extrai o código do diagnóstico normalizado', () => {
    expect(codigoDoDiagnostico(LEGADO)).toBe('TS2322');
    expect(codigoDoDiagnostico(PROIBIDO_2304)).toBe('TS2304');
  });

  it('pega o código do diagnóstico, não um citado na mensagem', () => {
    const comCodigoNaMensagem = "src/a.ts TS2322: algo sobre TS2304: dentro do texto.";
    expect(codigoDoDiagnostico(comCodigoNaMensagem)).toBe('TS2322');
  });
});

describe('1. diagnóstico legado permitido e já registrado → PASSA', () => {
  it('conjunto idêntico ao baseline não reprova', () => {
    const veredito = avaliarBaseline([LEGADO, LEGADO_2], [LEGADO, LEGADO_2]);

    expect(veredito.added).toEqual([]);
    expect(veredito.removed).toEqual([]);
    expect(veredito.forbidden).toEqual([]);
    expect(reprovado(veredito)).toBe(false);
  });

  it('a contagem importa: duas ocorrências registradas continuam passando', () => {
    const veredito = avaliarBaseline([LEGADO, LEGADO], [LEGADO, LEGADO]);
    expect(reprovado(veredito)).toBe(false);
  });
});

describe('2. diagnóstico novo normal → FALHA, como já falhava', () => {
  it('erro novo fora do baseline reprova', () => {
    const veredito = avaliarBaseline([LEGADO, NOVO_NORMAL], [LEGADO]);

    expect(veredito.added).toEqual([NOVO_NORMAL]);
    expect(reprovado(veredito)).toBe(true);
  });

  it('diagnóstico que sumiu também reprova — o baseline se atualiza conscientemente', () => {
    const veredito = avaliarBaseline([LEGADO], [LEGADO, LEGADO_2]);

    expect(veredito.removed).toEqual([LEGADO_2]);
    expect(reprovado(veredito)).toBe(true);
  });

  it('uma ocorrência a mais do MESMO erro legado conta como nova', () => {
    const veredito = avaliarBaseline([LEGADO, LEGADO], [LEGADO]);
    expect(veredito.added).toEqual([LEGADO]);
    expect(reprovado(veredito)).toBe(true);
  });
});

describe('3 e 4. já registrado no baseline NÃO salva um símbolo inexistente', () => {
  it('3. TS2304 registrado no baseline mesmo assim reprova', () => {
    // Exatamente o caso do Bradesco: estava no baseline, e passava.
    const veredito = avaliarBaseline([LEGADO, PROIBIDO_2304], [LEGADO, PROIBIDO_2304]);

    expect(veredito.added).toEqual([]);
    expect(veredito.removed).toEqual([]);
    expect(veredito.forbidden).toEqual([PROIBIDO_2304]);
    expect(reprovado(veredito)).toBe(true);
  });

  it('4. TS2552 registrado no baseline mesmo assim reprova', () => {
    const veredito = avaliarBaseline([PROIBIDO_2552], [PROIBIDO_2552]);

    expect(veredito.added).toEqual([]);
    expect(veredito.forbidden).toEqual([PROIBIDO_2552]);
    expect(reprovado(veredito)).toBe(true);
  });
});

describe('5 e 6. novos símbolos inexistentes também reprovam', () => {
  it('5. TS2304 novo reprova', () => {
    const veredito = avaliarBaseline([LEGADO, PROIBIDO_2304], [LEGADO]);

    expect(veredito.added).toEqual([PROIBIDO_2304]);
    expect(veredito.forbidden).toEqual([PROIBIDO_2304]);
    expect(reprovado(veredito)).toBe(true);
  });

  it('6. TS2552 novo reprova', () => {
    const veredito = avaliarBaseline([LEGADO, PROIBIDO_2552], [LEGADO]);
    expect(veredito.forbidden).toEqual([PROIBIDO_2552]);
    expect(reprovado(veredito)).toBe(true);
  });
});

describe('7. sem códigos proibidos, o comportamento de antes é preservado', () => {
  it('a política dos demais códigos não muda', () => {
    // Legados passam, novos falham — exatamente como antes desta regra.
    expect(reprovado(avaliarBaseline([LEGADO, LEGADO_2], [LEGADO, LEGADO_2]))).toBe(false);
    expect(reprovado(avaliarBaseline([LEGADO, NOVO_NORMAL], [LEGADO]))).toBe(true);
  });

  it('baseline vazio e nada reportado continua verde', () => {
    const veredito = avaliarBaseline([], []);
    expect(reprovado(veredito)).toBe(false);
  });

  it('um TS2304 no baseline não contamina o veredito dos outros', () => {
    // O erro proibido reprova, mas não é contado como "novo" nem "removido".
    const veredito = avaliarBaseline([LEGADO, PROIBIDO_2304], [LEGADO, PROIBIDO_2304]);
    expect(veredito.added).toEqual([]);
    expect(veredito.removed).toEqual([]);
  });
});
