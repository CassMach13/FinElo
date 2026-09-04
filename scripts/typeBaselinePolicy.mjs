/**
 * A decisão do baseline de tipos, separada da execução do `tsc`.
 *
 * ===========================================================================
 * POR QUE ISTO EXISTE COMO MÓDULO
 * ===========================================================================
 *
 * `check-type-baseline.mjs` roda o `tsc` no topo do arquivo, então importá-lo
 * num teste dispararia uma compilação inteira. A política em si é pura — dois
 * conjuntos de strings entram, um veredito sai — e é isso que fica aqui, para
 * poder ser testada de verdade.
 *
 * ===========================================================================
 * A REGRA NOVA, E O ACIDENTE QUE A MOTIVOU
 * ===========================================================================
 *
 * O baseline aceita dívida técnica de tipagem: erros legados ficam
 * registrados e o check só reclama quando o conjunto muda. Isso é útil, mas
 * era cego à CLASSE do erro — tratava um `TS2322` (tipos incompatíveis, o
 * código roda) igual a um `TS2304` (o símbolo não existe).
 *
 * Essas duas coisas não são comparáveis. Um símbolo que não existe é
 * `ReferenceError` garantido em qualquer caminho que execute aquela linha.
 * Não é dívida: é código quebrado.
 *
 * Aconteceu. O parser do Bradesco ficou ~3,5 meses lançando
 * `ReferenceError: installInfo is not defined` na primeira linha válida de
 * qualquer fatura, e os dois `TS2304` correspondentes estavam registrados no
 * baseline — sedimentados em lote quando a rede de segurança foi criada, sem
 * triagem item a item. A rede não barrou o erro: registrou-o.
 *
 * Por isso estes códigos falham SEMPRE, mesmo já registrados. A lista é curta
 * de propósito e não deve crescer por conveniência: só entram códigos que
 * signifiquem "este símbolo não existe", nunca desconforto de tipagem.
 */

/** Códigos que nunca podem ser aceitos como dívida técnica. */
export const CODIGOS_PROIBIDOS = Object.freeze([
  'TS2304', // Cannot find name 'x'.
  'TS2552', // Cannot find name 'x'. Did you mean 'y'?
]);

/**
 * O código do diagnóstico já normalizado (`<arquivo> TS####: <mensagem>`).
 *
 * Pega a PRIMEIRA ocorrência: a mensagem pode citar outro código, e o que
 * vale é o do diagnóstico em si.
 */
export const codigoDoDiagnostico = (diagnostico) => {
  const match = /\s(TS\d+):\s/.exec(diagnostico);
  return match ? match[1] : null;
};

const contar = (diagnosticos) => {
  const contagem = new Map();
  for (const diagnostico of diagnosticos) {
    contagem.set(diagnostico, (contagem.get(diagnostico) || 0) + 1);
  }
  return contagem;
};

/**
 * Compara o que o `tsc` reporta agora com o que o baseline registra.
 *
 * @returns `added` — diagnósticos novos; `removed` — registrados que sumiram
 *          (bom sinal, mas exige atualizar o baseline conscientemente);
 *          `forbidden` — de classe proibida, estejam ou não no baseline.
 */
export function avaliarBaseline(diagnosticosAtuais, diagnosticosEsperados) {
  const atuais = contar(diagnosticosAtuais);
  const esperados = contar(diagnosticosEsperados);

  const added = [];
  const removed = [];

  for (const diagnostico of new Set([...atuais.keys(), ...esperados.keys()])) {
    const qtdAtual = atuais.get(diagnostico) || 0;
    const qtdEsperada = esperados.get(diagnostico) || 0;

    for (let i = qtdEsperada; i < qtdAtual; i += 1) added.push(diagnostico);
    for (let i = qtdAtual; i < qtdEsperada; i += 1) removed.push(diagnostico);
  }

  // Independente de estar no baseline: símbolo inexistente nunca passa.
  const forbidden = diagnosticosAtuais.filter((diagnostico) =>
    CODIGOS_PROIBIDOS.includes(codigoDoDiagnostico(diagnostico))
  );

  return { added, removed, forbidden };
}

/** Há motivo para reprovar? */
export const reprovado = ({ added, removed, forbidden }) =>
  added.length > 0 || removed.length > 0 || forbidden.length > 0;
