import type { AppView } from '../types';

export type HelpSectionId =
  | 'general'
  | 'dashboard'
  | 'transactions'
  | 'import'
  | 'investments'
  | 'settings'
  | 'account'
  | 'help';

export type HelpTopicAction = 'none' | 'guides' | 'navigate' | 'support';

/** Screenshot de um passo. O arquivo fica em `public/help/<assunto>/` e é servido pela raiz. */
export interface HelpImage {
  src: string;
  /** Descreve o que a tela mostra, para quem não vê a imagem. */
  alt: string;
  caption?: string;
  width: number;
  height: number;
}

export interface HelpStep {
  title: string;
  /** Aceita **negrito** para os nomes exatos da interface. */
  text?: string;
  image?: HelpImage;
}

/** Bloco curto de apoio, como "Antes de começar" ou "Se algo der errado". */
export interface HelpBlock {
  title: string;
  items: string[];
}

/**
 * Conteúdo guiado opcional. O `answer` do tópico continua sendo o resumo (e o que a busca lê);
 * tópicos sem `article` seguem como resposta curta.
 */
export interface HelpArticle {
  before?: HelpBlock[];
  steps?: HelpStep[];
  /** O que a pessoa deve ver ao terminar. */
  result?: string;
  resultImage?: HelpImage;
  after?: HelpBlock[];
}

export interface HelpTopic {
  id: string;
  section: HelpSectionId;
  title: string;
  answer: string;
  keywords: string[];
  action?: HelpTopicAction;
  navigateTo?: AppView;
  featured?: boolean;
  article?: HelpArticle;
}

/** Nome de cada tela como aparece no menu, para o botão "Ir para…" dizer o destino real. */
export const HELP_VIEW_LABELS: Record<AppView, string> = {
  dashboard: 'Dashboard',
  import: 'Importar',
  transactions: 'Transações',
  investments: 'Investimentos',
  settings: 'Configurações',
  help: 'Central de Ajuda',
  admin: 'Chamados (Admin)',
  pricing: 'Gerenciar Conta',
  success: 'Assinatura',
};

export function getNavigateLabel(view: AppView): string {
  return `Ir para ${HELP_VIEW_LABELS[view]}`;
}

export interface HelpSectionMeta {
  id: HelpSectionId;
  label: string;
  shortLabel: string;
  description: string;
  appView?: AppView;
}

export const HELP_SECTIONS: HelpSectionMeta[] = [
  {
    id: 'general',
    label: 'Geral',
    shortLabel: 'Geral',
    description: 'Primeiros passos, app no celular e visão geral.',
  },
  {
    id: 'dashboard',
    label: 'Dashboard',
    shortLabel: 'Dashboard',
    description: 'Resumos, gráficos e visão do mês.',
    appView: 'dashboard',
  },
  {
    id: 'transactions',
    label: 'Transações',
    shortLabel: 'Transações',
    description: 'Lançamentos, cartão de crédito, faturas e pagamentos.',
    appView: 'transactions',
  },
  {
    id: 'import',
    label: 'Importar',
    shortLabel: 'Importar',
    description: 'Extratos CSV, Excel, OFX e revisão de importação.',
    appView: 'import',
  },
  {
    id: 'investments',
    label: 'Investimentos',
    shortLabel: 'Investimentos',
    description: 'Carteira, rentabilidade e acompanhamento.',
    appView: 'investments',
  },
  {
    id: 'settings',
    label: 'Configurações',
    shortLabel: 'Configurações',
    description: 'Contas, categorias, orçamentos e histórico de importações.',
    appView: 'settings',
  },
  {
    id: 'account',
    label: 'Gerenciar conta',
    shortLabel: 'Conta',
    description: 'Plano Premium, família e assinatura.',
    appView: 'pricing',
  },
  {
    id: 'help',
    label: 'Central de Ajuda',
    shortLabel: 'Ajuda',
    description: 'Chamados, suporte e tutoriais.',
    appView: 'help',
  },
];

export const HELP_TOPICS: HelpTopic[] = [
  // —— Geral ——
  {
    id: 'general-install-pwa',
    section: 'general',
    title: 'Como instalar o FinElo no celular?',
    answer:
      'iPhone: Safari → compartilhar → Adicionar à Tela de Início. Android: Chrome → menu (⋮) → Instalar aplicativo. Assim o FinElo abre em tela cheia, como um app.',
    keywords: ['instalar', 'celular', 'pwa', 'app', 'iphone', 'android', 'atalho'],
  },
  {
    id: 'general-start',
    section: 'general',
    title: 'Por onde começo no FinElo?',
    answer:
      'Comece trazendo seus dados: com o extrato do banco importado, o FinElo monta o seu mês em poucos minutos. São três passos.',
    keywords: ['começar', 'início', 'primeiros passos', 'configurar', 'novo usuário'],
    action: 'navigate',
    navigateTo: 'dashboard',
    article: {
      steps: [
        {
          title: 'Traga seus dados',
          text: 'Na **Dashboard**, o bloco **Primeiros passos** mostra o caminho. Clique em **Importar meu extrato** e siga as etapas. Se ainda não tiver uma conta cadastrada, você cria durante a importação.',
          image: {
            src: '/help/getting-started/01-primeiros-passos.webp',
            alt: 'Bloco Primeiros passos na Dashboard, com os passos Traga seus dados, Confira o que entrou e Veja seu mês e o botão Importar meu extrato',
            width: 1105,
            height: 301,
          },
        },
        {
          title: 'Confira o que entrou',
          text: 'Abra **Transações** e dê uma olhada nas categorias. Isso deixa os números certos.',
        },
        {
          title: 'Veja seu mês',
          text: 'Volte à **Dashboard** para ver entradas, saídas e onde você mais gastou.',
        },
      ],
      after: [
        {
          title: 'Outras formas de começar',
          items: [
            'Prefere digitar? Clique em **Prefiro lançar manualmente** e registre despesas e receitas uma a uma.',
            'Se a **Conexão Automática (Open Finance)** aparecer na tela **Importar**, ela conecta o seu banco direto. É um recurso dos planos PRO e Wealth.',
            'Fechou o bloco com **Agora não**? Use **Retomar primeiros passos** na Dashboard.',
          ],
        },
      ],
    },
  },

  // —— Dashboard ——
  {
    id: 'dashboard-summary',
    section: 'dashboard',
    title: 'O que o Dashboard mostra?',
    answer:
      'Visão do período: entradas, saídas, saldo e gráficos por categoria. Use o seletor de período para mudar mês ou intervalo. Os valores vêm das transações lançadas ou importadas.',
    keywords: ['dashboard', 'resumo', 'gráfico', 'mês', 'visão geral'],
    action: 'navigate',
    navigateTo: 'dashboard',
  },
  {
    id: 'dashboard-period',
    section: 'dashboard',
    title: 'Como mudar o mês ou período exibido?',
    answer:
      'No topo do Dashboard, altere o modo de visualização (mês atual, anterior, personalizado). Todos os cartões e gráficos se atualizam conforme o período escolhido.',
    keywords: ['período', 'mês', 'filtro', 'data', 'intervalo'],
  },

  // —— Transações ——
  {
    id: 'tx-add-manual',
    section: 'transactions',
    title: 'Como lanço uma despesa ou receita manualmente?',
    answer:
      'Para registrar uma despesa ou receita sem importar arquivo, abra Adicionar Lançamento em Transações, preencha os campos e salve.',
    keywords: ['lançar', 'manual', 'adicionar', 'despesa', 'receita', 'criar', 'lançamento', 'sem importar'],
    action: 'navigate',
    navigateTo: 'transactions',
    article: {
      before: [
        {
          title: 'Antes de começar',
          items: [
            'Você precisa de pelo menos uma **Conta** e uma **Categoria**. Ainda não tem? Crie na hora, pelos botões **+ Conta** e **+ Categoria** do próprio formulário.',
          ],
        },
      ],
      steps: [
        {
          title: 'Abra o formulário',
          text: 'No menu, clique em **Transações** e depois em **Adicionar Lançamento**, no canto superior direito.',
          image: {
            src: '/help/manual-entry/01-botao-adicionar-lancamento.webp',
            alt: 'Canto superior direito da tela Transações com o botão Adicionar Lançamento ao lado de Exportar',
            width: 393,
            height: 68,
          },
        },
        {
          title: 'Preencha os campos',
          text: 'Informe **Data da Compra**, **Conta**, **Descrição**, **Tipo** (**Despesa (Saída)** ou **Renda (Entrada)**), **Categoria** e **Valor (R$)**. Todos são obrigatórios. Digite o valor sem sinal: o **Tipo** define se é saída ou entrada.',
          image: {
            src: '/help/manual-entry/02-formulario-preenchido.webp',
            alt: 'Janela Adicionar Lançamento preenchida com data, conta, descrição, tipo Despesa, categoria e valor',
            width: 448,
            height: 984,
          },
        },
        {
          title: 'Salve',
          text: 'Clique em **Salvar**.',
        },
      ],
      result:
        'O lançamento aparece no topo da lista em **Transações**, com a categoria que você escolheu, e entra nos totais da **Dashboard**. Para corrigir depois, use o ícone de lápis na linha do lançamento.',
      resultImage: {
        src: '/help/manual-entry/03-lancamento-na-lista.webp',
        alt: 'Lista de Transações com o novo lançamento no topo, com a categoria escolhida e o ícone de lápis para editar',
        width: 1105,
        height: 217,
      },
      after: [
        {
          title: 'Outras opções do formulário',
          items: [
            '**Repetir este lançamento?** gera várias linhas de uma vez: **Parcelado (Compra 10x)** ou **Fixo Mensal (Recorrente)**.',
            'Em conta de cartão de crédito, escolha também o **Tipo de lançamento no cartão**: compra, estorno ou pagamento de fatura. Para pagar a fatura, use o botão **Pagar** no card do cartão.',
          ],
        },
      ],
    },
  },
  {
    id: 'tx-filter',
    section: 'transactions',
    title: 'Como filtrar transações por conta ou mês?',
    answer:
      'Use os filtros acima da lista: conta, categoria, período e busca por texto. Isso ajuda a conferir faturas e encontrar lançamentos específicos.',
    keywords: ['filtrar', 'buscar', 'conta', 'mês', 'pesquisar', 'lista'],
  },
  {
    id: 'tx-credit-card-guide',
    section: 'transactions',
    title: 'Como gerencio meu cartão de crédito?',
    answer:
      'No card do cartão em Transações você vê Fatura atual, limite e botões HISTÓRICO e PAGAR. O guia completo cobre quem importa extrato, lança na mão ou usa os dois.',
    keywords: ['cartão', 'crédito', 'fatura', 'limite', 'histórico', 'competência'],
    action: 'guides',
    featured: true,
  },
  {
    id: 'tx-fatura-atual',
    section: 'transactions',
    title: 'O que é "Fatura atual" no card do cartão?',
    answer:
      'É o total de compras do ciclo vigente (despesas menos estornos do período). Não confunda com limite disponível nem com o valor já pago no banco.',
    keywords: ['fatura atual', 'valor', 'ciclo', 'compras', 'total'],
  },
  {
    id: 'tx-pay-invoice',
    section: 'transactions',
    title: 'Como pago a fatura do meu cartão no FinElo?',
    answer:
      'No FinElo, pagar a fatura é um registro: você escolhe a fatura, a conta de onde o dinheiro saiu e o valor, e o FinElo abate a fatura. O app não movimenta dinheiro no banco.',
    keywords: ['pagar', 'pagamento', 'quitar', 'fatura', 'cartão', 'boleto', 'registrar pagamento'],
    action: 'navigate',
    navigateTo: 'transactions',
    article: {
      before: [
        {
          title: 'Antes de começar',
          items: [
            'Você precisa de um cartão de crédito com fatura em aberto: o botão **Pagar** só aparece quando a **Fatura atual** é maior que zero.',
            'Uma conta corrente ou poupança, para indicar de onde saiu o pagamento.',
            'Uma categoria de **Renda** para o pagamento, como "Pagamento de Fatura". Ainda não tem? Crie em **Configurações**, em **Gerenciar Categorias**, escolhendo o tipo **Entrada (Renda)**.',
          ],
        },
      ],
      steps: [
        {
          title: 'Localize o cartão',
          text: 'Abra **Transações**. Na seção **Cartões de crédito**, confira a **Fatura atual** do cartão e clique em **Pagar**.',
          image: {
            src: '/help/card-payment/01-card-com-botao-pagar.webp',
            alt: 'Card do cartão de crédito em Transações com a Fatura atual e os botões Histórico e Pagar',
            width: 465,
            height: 168,
          },
        },
        {
          title: 'Escolha a fatura e a conta',
          text: 'Em **Fatura a pagar**, escolha a competência que você está quitando. A mais antiga em aberto já vem marcada. Em **Conta de origem do pagamento**, escolha a conta de onde o dinheiro saiu.',
        },
        {
          title: 'Confirme categoria, data e valor',
          text: 'Escolha a **Categoria do pagamento** e confira a **Data do pagamento** e o **Valor pago (R$)**. O valor já vem com o total em aberto: altere se pagou menos ou mais. Se pagar mais, o excedente vira crédito nas faturas seguintes.',
          image: {
            src: '/help/card-payment/02-modal-pagar-fatura.webp',
            alt: 'Janela Pagar fatura do cartão com a fatura 09/2026 em aberto, conta de origem, categoria, data e valor pago preenchidos',
            width: 512,
            height: 846,
          },
        },
        {
          title: 'Registre o pagamento',
          text: 'Clique em **Registrar pagamento**. Aparece **Pagamento registrado com sucesso.** e a **Fatura atual** do cartão diminui pelo valor pago. Se você pagou tudo, ela zera e o botão **Pagar** some.',
        },
      ],
      result:
        'O FinElo cria dois lançamentos em **Transações**: uma entrada **Pagamento de Fatura** no cartão, que abate a fatura, e uma saída **Pagamento Fatura — nome do cartão** na conta de origem.',
      resultImage: {
        src: '/help/card-payment/03-lancamentos-do-pagamento.webp',
        alt: 'Dois lançamentos do pagamento na lista de Transações: a entrada no cartão e a saída na conta de origem, com o mesmo valor',
        width: 1105,
        height: 118,
      },
      after: [
        {
          title: 'O que o FinElo não faz',
          items: [
            'Ele não paga o boleto nem move dinheiro no banco. Faça o pagamento no banco e registre aqui.',
          ],
        },
        {
          title: 'Para desfazer um pagamento',
          items: [
            'Em **Transações**, exclua as duas linhas do pagamento: a do cartão e a da conta de origem. Excluir só uma deixa a outra no lugar.',
          ],
        },
        {
          title: 'Não lance como Renda',
          items: [
            'Não registre o pagamento como **Renda** em **Adicionar Lançamento**. Ao tentar, o FinElo sugere usar o fluxo **Pagar**, onde você escolhe qual fatura está quitando.',
          ],
        },
      ],
    },
  },
  {
    id: 'tx-history',
    section: 'transactions',
    title: 'Para que serve o botão HISTÓRICO no cartão?',
    answer:
      'Abre o histórico por competência (mês da fatura): total, pagamentos e saldo em aberto. Ideal para quem importa extrato. Quem só lança na mão pode conferir pela lista filtrada e Fatura atual.',
    keywords: ['histórico', 'competência', 'mês', 'aberto', 'paga'],
  },
  {
    id: 'tx-confirm-paid',
    section: 'transactions',
    title: 'O que é "Sim, está pago" no histórico?',
    answer:
      'Quando sobram centavos em aberto que você já quitou no banco (arredondamento ou ajuste), confirme na competência. A informação fica salva na nuvem e aparece em todos os seus dispositivos.',
    keywords: ['sim está pago', 'centavos', 'residual', 'confirmar', 'sincronizar'],
  },
  {
    id: 'tx-refund',
    section: 'transactions',
    title: 'Como lanço estorno ou reembolso no cartão?',
    answer:
      'Cadastre como Renda na mesma conta do cartão, com a data do crédito no banco. Isso reduz a fatura do período, como um estorno real.',
    keywords: ['estorno', 'reembolso', 'crédito', 'renda', 'devolução'],
  },
  {
    id: 'tx-closing-due',
    section: 'transactions',
    title: 'Por que configurar dia de fechamento e vencimento?',
    answer:
      'Esses dias alinham o ciclo da fatura ao seu banco. Edite a conta do cartão em Configurações → Contas: informe fechamento, vencimento e limite.',
    keywords: ['fechamento', 'vencimento', 'dia', 'ciclo', 'configurar cartão'],
    action: 'navigate',
    navigateTo: 'settings',
  },

  // —— Importar ——
  {
    id: 'import-how',
    section: 'import',
    title: 'Como importar meu extrato?',
    answer:
      'Traga as movimentações do seu banco para o FinElo sem digitar uma por uma. Você só precisa do arquivo do extrato (conta) ou da fatura (cartão), baixado no app ou no site do banco.',
    keywords: ['importar', 'extrato', 'fatura', 'csv', 'excel', 'ofx', 'upload', 'arquivo', 'baixar', 'banco'],
    action: 'navigate',
    navigateTo: 'import',
    article: {
      before: [
        {
          title: 'Antes de começar',
          items: [
            'Tenha o arquivo do banco salvo no celular ou no computador.',
            'Os formatos dependem da forma de importação: os bancos da lista aceitam **.csv**, **.xlsx** e **.xls**; a opção **Mapeamento** também aceita **.ofx**.',
            'No plano **Basic** (grátis), você pode fazer **1 importação por mês**. Nos planos **PRO** e **Wealth**, as importações são ilimitadas.',
          ],
        },
        {
          title: 'Como consigo o arquivo no meu banco?',
          items: [
            'Abra o app ou o site do seu banco.',
            'Procure por **Extrato** (conta) ou **Fatura** (cartão de crédito).',
            'Escolha o período e use a opção de exportar ou baixar, de preferência em CSV ou Excel.',
            'Salve o arquivo e volte ao FinElo.',
          ],
        },
      ],
      steps: [
        {
          title: 'Escolha o banco ou cartão',
          text: 'No menu, clique em **Importar**. Em **Selecione o Banco ou Cartão**, clique no banco de onde veio o arquivo. Se ele não estiver na lista, use **Mapeamento** ou clique em **Pedir meu banco**.',
          image: {
            src: '/help/import/01-selecionar-banco.webp',
            alt: 'Tela Importar Extrato com o uso mensal gratuito e a lista de bancos em Selecione o Banco ou Cartão',
            width: 1168,
            height: 565,
          },
        },
        {
          title: 'Escolha a conta de destino',
          text: 'Em **Conta de Destino**, escolha a conta que vai receber as transações. Ainda não tem uma? Clique em **+ Nova Conta**, dê um nome e salve. Para fatura de cartão, informe também o **Vencimento da Fatura**.',
          image: {
            src: '/help/import/02-conta-de-destino.webp',
            alt: 'Janela Importação Automática com o campo Conta de Destino, o link + Nova Conta e a área para enviar o arquivo',
            width: 576,
            height: 561,
          },
        },
        {
          title: 'Envie o arquivo',
          text: 'Clique em **Clique para enviar o extrato** e selecione o arquivo baixado do banco.',
        },
        {
          title: 'Confirme a importação',
          text: 'O FinElo mostra o arquivo, a conta e quantas linhas vão entrar. Confira e clique em **Confirmar e Importar**.',
          image: {
            src: '/help/import/03-confirmar-importacao.webp',
            alt: 'Janela Confirmar Importação com o nome do arquivo, a conta escolhida e o número de linhas novas',
            width: 672,
            height: 352,
          },
        },
      ],
      result:
        'As transações entram na conta escolhida e aparecem em **Transações**, prontas para você conferir as categorias. A tela mostra **Importação concluída** com atalhos para **Conferir transações** e **Ver minha Dashboard**. No plano Basic, ela também avisa que a importação gratuita do mês foi usada; a partir daí, ao abrir **Importar** de novo, aparece **Limite Gratuito Atingido** até o mês seguinte.',
      resultImage: {
        src: '/help/import/04-transacoes-importadas.webp',
        alt: 'Lista de Transações com os lançamentos importados do extrato, ainda sem categoria',
        width: 1105,
        height: 478,
      },
      after: [
        {
          title: 'Se algo der errado',
          items: [
            '**Limite Gratuito Atingido** antes de importar: no plano Basic, a próxima importação fica disponível no mês seguinte.',
            '**Arquivo já importado**: o FinElo não grava o mesmo arquivo duas vezes e avisa quando isso acontece.',
            '**Nenhuma transação encontrada**: confira se escolheu o banco certo e se o arquivo é o extrato baixado do banco.',
          ],
        },
      ],
    },
  },
  {
    id: 'import-competence',
    section: 'import',
    title: 'O que é competência da fatura do cartão?',
    answer:
      'Competência é o mês a que uma fatura de cartão pertence. É por ela que o FinElo junta as compras de uma mesma fatura no histórico do cartão.',
    keywords: ['competência', 'mês', 'fatura', 'cartão', 'vencimento', 'histórico', 'aaaa-mm'],
    article: {
      steps: [
        {
          title: 'O que ela significa',
          text: 'Cada fatura tem uma competência. Exemplo: um arquivo com compras de 29/08 a 20/09 e vencimento em 10/10/2026 tem a competência **2026-09** (**09/2026** no histórico). Todas essas compras ficam juntas nessa fatura, mesmo a de agosto.',
        },
        {
          title: 'Na importação do cartão',
          text: 'Informe o **Vencimento da Fatura**. Em **Competência da fatura**, deixe **Automática**: com o vencimento informado, o FinElo usa o mês anterior a ele (vencimento em 10/10, competência 2026-09). Ou escolha **Definir manualmente** e preencha **Competência (AAAA-MM)**, indicado para arquivos antigos.',
          image: {
            src: '/help/competence/01-vencimento-e-competencia.webp',
            alt: 'Janela de importação de cartão com o campo Vencimento da Fatura e as opções de Competência da fatura, Automática e Definir manualmente',
            width: 576,
            height: 763,
          },
        },
        {
          title: 'No histórico do cartão',
          text: 'Em **Transações**, no card do cartão, clique em **Histórico**. Cada fatura aparece com a **Competência**, o vencimento e o total.',
          image: {
            src: '/help/competence/02-competencia-no-historico.webp',
            alt: 'Janela Histórico de faturas com a competência 09/2026, o vencimento em 10/10/2026 e o total da fatura',
            width: 672,
            height: 789,
          },
        },
      ],
      after: [
        {
          title: 'Quando conferir',
          items: [
            'Confira a **Competência da fatura** na janela **Confirmar Importação**, antes de gravar.',
            'Se o arquivo tiver compras de mais de um mês, o FinElo avisa em **Confirmar Competência Automática**. Isso é comum quando a fatura fecha no começo do mês.',
            'Competência errada fica no mês errado do histórico. Para corrigir, abra o **Histórico** do cartão e use **Ajustar competências por arquivo**.',
          ],
        },
      ],
    },
  },
  {
    id: 'import-duplicate',
    section: 'import',
    title: 'O FinElo pode importar a mesma transação duas vezes?',
    answer:
      'O FinElo bloqueia a repetição do mesmo arquivo. Se o mesmo extrato for salvo com outro nome, ele pode ser importado novamente e gerar lançamentos repetidos.',
    keywords: ['duplicata', 'duplicado', 'repetido', 'já importado', 'importar de novo', 'excluir importação'],
    action: 'navigate',
    navigateTo: 'settings',
    article: {
      steps: [
        {
          title: 'Se você repetir o arquivo',
          text: 'Importar de novo um arquivo com o mesmo nome é recusado com o aviso **Arquivo já importado anteriormente**, e nada é gravado. A mensagem sugere renomear o arquivo: só faça isso se ele for realmente outro, como o extrato de outro período.',
          image: {
            src: '/help/duplicates/01-arquivo-ja-importado.webp',
            alt: 'Janela de importação com a mensagem Arquivo já importado anteriormente ao tentar enviar o mesmo arquivo',
            width: 576,
            height: 647,
          },
        },
        {
          title: 'Se o mesmo extrato voltar com outro nome',
          text: 'No fluxo validado aqui, o mesmo extrato com outro nome foi aceito e os lançamentos entraram novamente, aparecendo em dobro em **Transações**. Por isso, não renomeie um arquivo apenas para contornar o aviso: faça isso somente quando ele for realmente outro, como um extrato de período diferente.',
          image: {
            src: '/help/duplicates/02-lancamentos-repetidos.webp',
            alt: 'Lista de Transações com lançamentos repetidos, como Assinatura Exemplo e Farmacia Exemplo aparecendo duas vezes',
            width: 1105,
            height: 379,
          },
        },
        {
          title: 'Para desfazer a importação repetida',
          text: 'Abra **Configurações** e, em **Histórico de Importações**, clique em **Excluir** na linha do arquivo repetido. Confirme em **Excluir Tudo**: isso apaga o registro dessa importação e todas as transações dela. O arquivo original continua como estava.',
        },
      ],
      result: 'Só o lote repetido some. Confira em **Transações** se cada lançamento aparece uma única vez.',
      after: [
        {
          title: 'Linhas ignoradas não são duplicatas',
          items: [
            'Em **Linhas ignoradas**, o FinElo conta as linhas do arquivo que não viram lançamento, como totais, saldos ou linhas sem data ou valor.',
          ],
        },
      ],
    },
  },
  {
    id: 'import-rules',
    section: 'import',
    title: 'Como funcionam as regras de categorização?',
    answer:
      'Em Configurações → Regras de mapeamento, defina padrões na descrição (ex.: "UBER" → Transporte). Na importação ou em Re-aplicar regras, o FinElo sugere categorias automaticamente.',
    keywords: ['regra', 'mapeamento', 'categoria automática', 'uber', 'padrão'],
    action: 'navigate',
    navigateTo: 'settings',
  },

  // —— Investimentos ——
  {
    id: 'inv-overview',
    section: 'investments',
    title: 'Como acompanho meus investimentos?',
    answer:
      'Importe a planilha XP (lê data da aplicação, vencimento e rentabilidade) ou use + Adicionar para lançar manualmente com saldo, valor aplicado, datas e rendimento mensal esperado. A tabela exibe aplicação, vencimento e rentabilidade por ativo.',
    keywords: ['investimento', 'carteira', 'ações', 'fundo', 'rentabilidade', 'aplicação', 'planilha', 'xp'],
    action: 'navigate',
    navigateTo: 'investments',
  },

  // —— Configurações ——
  {
    id: 'set-accounts',
    section: 'settings',
    title: 'Como criar ou editar uma conta?',
    answer:
      'Configurações → Contas → Adicionar ou editar. Para cartão de crédito, informe limite, dia de fechamento e vencimento.',
    keywords: ['conta', 'banco', 'cartão', 'criar conta', 'editar'],
  },
  {
    id: 'set-categories',
    section: 'settings',
    title: 'Como criar categorias personalizadas?',
    answer:
      'Configurações → Gerenciar Categorias → Adicionar. Defina nome, tipo (Despesa, Renda ou Ambos) e se é essencial ou investimento.',
    keywords: ['categoria', 'personalizar', 'essencial', 'tipo'],
  },
  {
    id: 'set-budget',
    section: 'settings',
    title: 'Como definir orçamento por categoria?',
    answer:
      'Configurações → Gerenciar Orçamentos → escolha o ano e adicione limites por categoria de despesa. O Dashboard pode comparar gasto real vs orçado.',
    keywords: ['orçamento', 'limite', 'meta', 'gasto'],
  },
  {
    id: 'set-import-history',
    section: 'settings',
    title: 'Histórico de importações — o que posso fazer?',
    answer:
      'Veja cada arquivo importado, alertas e ações: Corrigir Conta (se associou ao banco errado), Reidratar histórico (alinha metadados) e Sincronizar histórico antigo (recupera logs antigos).',
    keywords: ['histórico importação', 'reidratar', 'corrigir conta', 'alerta', 'arquivo'],
  },
  {
    id: 'set-reassign',
    section: 'settings',
    title: 'Importei na conta errada — como corrigir?',
    answer:
      'Configurações → Histórico de importações → Corrigir Conta na linha do arquivo. Todas as transações daquele arquivo passam para a conta escolhida.',
    keywords: ['conta errada', 'mover', 'corrigir', 'reatribuir'],
  },
  {
    id: 'set-family',
    section: 'settings',
    title: 'Plano família — compartilhar finanças',
    answer:
      'Com plano que inclui família, convide em Configurações. A pessoa convidada vê e edita as mesmas contas e transações (conforme o plano).',
    keywords: ['família', 'cônjuge', 'compartilhar', 'convite', 'plano'],
  },

  // —— Conta / Premium ——
  {
    id: 'account-premium',
    section: 'account',
    title: 'O que inclui o plano Premium?',
    answer:
      'Recursos avançados conforme seu plano ativo (importações, família, etc.). Em Gerenciar Conta você vê status da assinatura e opções de upgrade.',
    keywords: ['premium', 'assinatura', 'plano', 'pagar', 'upgrade'],
    action: 'navigate',
    navigateTo: 'pricing',
  },

  // —— Central de Ajuda ——
  {
    id: 'help-ticket',
    section: 'help',
    title: 'Como falo com o suporte?',
    answer:
      'Central de Ajuda → Novo Chamado. Descreva o problema, anexe print se precisar e acompanhe respostas em Meus Chamados.',
    keywords: ['suporte', 'chamado', 'ticket', 'ajuda', 'bug', 'problema'],
    action: 'support',
  },
  {
    id: 'help-guides-tab',
    section: 'help',
    title: 'Onde está o guia completo de cartão?',
    answer:
      'Na aba Tópicos, seção Transações: expanda o bloco "Cartão de crédito no FinElo". Escolha seu perfil (importação, manual ou misto) e siga o passo a passo.',
    keywords: ['guia', 'tutorial', 'cartão', 'passo a passo'],
    action: 'guides',
  },
  {
    id: 'help-search',
    section: 'help',
    title: 'Como buscar um assunto rapidamente?',
    answer:
      'Na aba Tópicos, use a barra de busca no topo. Digite palavras como fatura, importar ou categoria — aparecem os tópicos relacionados. Filtre também por aba do sistema (Transações, Importar, etc.).',
    keywords: ['buscar', 'pesquisa', 'palavra-chave', 'encontrar', 'tópicos'],
  },
];

export const HELP_SEARCH_SUGGESTIONS = [
  'fatura',
  'cartão',
  'importar',
  'categoria',
  'pagamento',
  'duplicata',
  'orçamento',
  'competência',
];

export function getSectionMeta(sectionId: HelpSectionId): HelpSectionMeta {
  return HELP_SECTIONS.find((s) => s.id === sectionId) ?? HELP_SECTIONS[0];
}

/** Remove acentos e normaliza para busca. */
export function normalizeHelpText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function topicMatchesQuery(topic: HelpTopic, query: string): boolean {
  const q = normalizeHelpText(query);
  if (!q) return true;
  const blob = normalizeHelpText(
    [topic.title, topic.answer, ...topic.keywords, getSectionMeta(topic.section).label].join(' ')
  );
  const tokens = q.split(/\s+/).filter(Boolean);
  return tokens.every((token) => blob.includes(token));
}

export function filterHelpTopics(
  topics: HelpTopic[],
  query: string,
  sectionFilter: HelpSectionId | 'all'
): HelpTopic[] {
  return topics.filter((topic) => {
    if (sectionFilter !== 'all' && topic.section !== sectionFilter) return false;
    return topicMatchesQuery(topic, query);
  });
}

export function groupTopicsBySection(
  topics: HelpTopic[]
): { section: HelpSectionMeta; topics: HelpTopic[] }[] {
  const order = HELP_SECTIONS.map((s) => s.id);
  const grouped = new Map<HelpSectionId, HelpTopic[]>();
  topics.forEach((t) => {
    const list = grouped.get(t.section) ?? [];
    list.push(t);
    grouped.set(t.section, list);
  });
  return order
    .map((id) => ({
      section: getSectionMeta(id),
      topics: grouped.get(id) ?? [],
    }))
    .filter((g) => g.topics.length > 0);
}
