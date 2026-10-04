import { HELP_TOPICS } from './helpCenterContent';
import type { HelpImage, HelpTopic } from './helpCenterContent';

export type CardUsageProfileId = 'import' | 'manual' | 'mixed';

export interface CardUsageProfile {
  id: CardUsageProfileId;
  label: string;
  title: string;
  choice: string;
  forWhom: string;
  how: string;
  routine: string[];
  attention: string;
  topicIds: string[];
  imageTopicId: string;
  imageStepIndex: number;
}

export const CARD_USAGE_PROFILES: CardUsageProfile[] = [
  {
    id: 'import',
    label: 'Importação',
    title: 'Minha rotina começa pelo extrato',
    choice: 'Você reúne as compras no arquivo da fatura enviado pelo banco.',
    forWhom: 'Para quem prefere importar o extrato do cartão em vez de cadastrar cada compra.',
    how: 'Na aba **Importar**, envie o extrato da fatura em um formato aceito pelo importador e escolha a conta do cartão. Confira competência e vencimento antes de confirmar.',
    routine: [
      'Depois de importar, abra **Transações → Histórico** no cartão e compare a mesma competência com a fatura do banco.',
      'Confira compras, estornos/créditos, pagamentos e saldo em aberto. A presença de uma linha de pagamento no arquivo não dispensa essa conferência.',
      'Se o mês do arquivo estiver errado, use **Ajustar competências por arquivo** no Histórico e revise o vencimento.',
      'Antes de usar **Pagar**, confira se o pagamento já veio no extrato. Use Pagar para registrar no FinElo um pagamento ainda não registrado, escolhendo a fatura e a conta de origem.',
    ],
    attention: 'Não cadastre de novo uma compra ou um pagamento já importado. **Sim, está pago** só faz sentido se o saldo mostrado já foi efetivamente quitado fora do FinElo; não use para esconder uma diferença que ainda não conferiu.',
    topicIds: ['import-how', 'import-competence', 'tx-history', 'tx-pay-invoice'],
    imageTopicId: 'import-competence',
    imageStepIndex: 1,
  },
  {
    id: 'manual',
    label: 'Manual',
    title: 'Registro minhas compras no dia a dia',
    choice: 'Você cadastra as compras, sem importar o extrato do cartão.',
    forWhom: 'Para quem quer registrar cada compra manualmente e acompanhar a fatura ao longo do mês.',
    how: 'Em **Transações → Adicionar Lançamento**, escolha a conta do cartão e **Compra / despesa no cartão**. Informe a data real da compra e, em **Fatura desta compra**, o vencimento da fatura em que ela será cobrada.',
    routine: [
      'Confira no **Histórico** a competência que recebeu a compra. Uma compra e a fatura que a cobra podem estar em meses diferentes.',
      'Compare o total e o saldo em aberto com a fatura do banco, inclusive quando todos os lançamentos forem manuais.',
      'Depois de pagar no banco, use **Pagar** para registrar a fatura, a data, o valor e a conta de onde saiu o dinheiro.',
      'Para uma devolução, escolha **Estorno ou crédito na fatura** e a **Competência da fatura (estorno)** que recebe o crédito.',
    ],
    attention: '**Fatura desta compra** pede o vencimento, não a data em que você pagou no banco. Não registre o pagamento como uma renda genérica. Se não quiser registrar a conta de origem e o saldo inteiro já estiver pago fora do FinElo, confira o valor antes de usar **Sim, está pago**.',
    topicIds: ['tx-pay-invoice', 'tx-refund', 'tx-history', 'tx-closing-due'],
    imageTopicId: 'tx-pay-invoice',
    imageStepIndex: 2,
  },
  {
    id: 'mixed',
    label: 'Misto',
    title: 'Combino extrato e lançamentos manuais',
    choice: 'Você importa parte dos dados e cadastra o que ainda não veio no arquivo.',
    forWhom: 'Para quem usa o extrato e também registra compras ou créditos avulsos no mesmo cartão.',
    how: 'Importe na conta do cartão e lance manualmente apenas o que não está no extrato. Use a competência correta para reunir tudo na mesma fatura.',
    routine: [
      'Antes de cadastrar uma compra, confira se ela já aparece entre os lançamentos importados.',
      'Abra **Histórico → Auditoria da fatura** para conferir juntos os lançamentos importados e manuais daquela competência.',
      'Revise o mês do arquivo em **Ajustar competências por arquivo**; nas compras manuais, confira **Fatura desta compra**. Para estornos, escolha a competência que recebe o crédito.',
      'Confira se o pagamento já está registrado antes de usar **Pagar**. Se precisar registrá-lo, escolha a fatura e a conta de origem.',
    ],
    attention: 'Não conte com deduplicação automática entre uma compra manual e a mesma compra importada. Conferir a sobreposição é parte desta rotina. **Sim, está pago** não corrige uma compra duplicada: use apenas quando o saldo mostrado já estiver efetivamente pago fora do FinElo.',
    topicIds: ['import-duplicate', 'tx-history', 'import-competence', 'tx-refund'],
    imageTopicId: 'tx-history',
    imageStepIndex: 2,
  },
];

export const CARD_SHARED_CONCEPTS = [
  {
    title: 'Competência não é vencimento',
    text: 'Competência é o mês da fatura. Por exemplo, **09/2026** pode vencer em **10/10/2026**. Fechamento e vencimento configuram o ciclo do cartão; confira ambos em Configurações → Contas.',
  },
  {
    title: 'Histórico: total e saldo são diferentes',
    text: 'O total considera compras e estornos/créditos. O saldo em aberto mostra o que ainda falta quitar depois dos pagamentos e confirmações. O Histórico serve para os três perfis.',
  },
  {
    title: 'Pagar registra o pagamento',
    text: 'Use **Pagar** se quiser registrar de qual conta saiu o dinheiro. O FinElo registra a saída nessa conta e o abatimento na fatura escolhida; não executa um pagamento no banco.',
  },
  {
    title: 'Sim, está pago confirma uma quitação',
    text: "É uma ferramenta auxiliar, não um quarto perfil. Confirma o **saldo em aberto inteiro** exibido, já pago fora do FinElo: zera esse saldo e pode liberar limite. Não cria transação e não movimenta conta. Confira o valor; Cancelar e Desfazer permanecem disponíveis. Para os detalhes, leia “Para que serve o 'Sim, está pago'?” nos Tópicos.",
  },
];

/** Reutiliza os títulos e os assets publicados, sem cópias ou uma nova navegação. */
export function getProfileHelpReferences(profile: CardUsageProfile): HelpTopic[] {
  return profile.topicIds.map((id) => {
    const topic = HELP_TOPICS.find((item) => item.id === id);
    if (!topic) throw new Error(`Artigo de ajuda não encontrado: ${id}`);
    return topic;
  });
}

export function getProfileHelpImage(profile: CardUsageProfile): HelpImage {
  const image = HELP_TOPICS.find((item) => item.id === profile.imageTopicId)?.article?.steps?.[profile.imageStepIndex]?.image;
  if (!image) throw new Error(`Imagem publicada não encontrada: ${profile.imageTopicId}`);
  return image;
}
