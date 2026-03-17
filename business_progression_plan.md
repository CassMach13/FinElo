# Plano Estratégico e Visão de Produto: FinElo 🚀

Este documento consolida as decisões estratégicas recentes e define o roadmap de progressão do FinElo. Ele serve como bússola para os sócios entenderem onde estamos, o que estamos priorizando para gerar caixa imediato e o que deixamos para o futuro.

---

## 1. Nossa Estrutura de Monetização Atual (O Que Está no Ar)
Mudamos de um modelo de "assinatura genérica" para uma **Escada de Valor** clara. Nosso objetivo não é apenas ter usuários, mas aumentar o *Ticket Médio (LTV)* oferecendo módulos específicos para dores específicas.

*   **Degrau 1: Basic (Conta Grátis)**
    *   **Objetivo:** Aquisição de clientes ("Isca"). Deixar o usuário sentir o gostinho de ter as finanças organizadas.
    *   **O que entregamos:** 1 importação mensal e um Dashboard *Resumido* (apenas KPIs principais e transações).
    *   **A "Dor" Gerada:** Gráficos de categorias, regra 50-30-20 e análises visuais ficam bloqueados por um Paywall elegante, gerando forte desejo de Upgrade.
*   **Degrau 2: Anual Pro (R$ 9,99/mês)**
    *   **Objetivo:** Conversão base. O valor "irrisório" quebra objeções e garante recorrência previsível para manter os servidores.
    *   **O que entregamos:** Importações ilimitadas, IA, Dashboard completo. Destinado ao solteiro(a) que quer controle total.
*   **Degrau 3: Opcional Família (+ R$ 4,90/conta extra)**
    *   **A Grande Mudança:** Deixou de ser "liberado" (*all-inclusive*) e virou um **Add-on**. Se a pessoa casar ou quiser incluir filhos, ela paga por assento (Seat-based pricing). Isso previne a criação de contas gigantes que dariam prejuízo ao servidor sem contrapartida financeira.
*   **Degrau 4: Wealth / Gestão de Patrimônio (R$ 19,90/mês)**
    *   **Objetivo:** Capturar o público investidor (Alto Ticket). Eles já pagam taxas corretoras, então pagar para centralizar a visão é natural.
    *   **O que entregamos:** Tudo do Anual + Uma aba robusta de Importação Multi-Broker (XP, Inter, etc) para consolidar a carteira de ações e fundos em um só lugar.
*   **Acelerador de Caixa: Founder's Pack Vitalício (R$ 149,00)**
    *   **Objetivo:** Injeção rápida de capital inicial para marketing/tráfego, limitado a 50 vagas.

---

## 2. O Que Decidimos Priorizar AGORA (Curto Prazo)
Nossas horas de desenvolvimento e marketing estão alocadas em:
1. **Estabilidade nas Importações:** O core da plataforma (parseamento de OFX, arquivos CSV da XP, etc) precisa ser impecável. Se o usuário perder a confiança no saldo logo na importação, ele cancela.
2. **Gestão de Exclusões:** A funcionalidade de "Limpar Lote por Instituição" que implementamos recentemente para evitar dados duplicados foi crucial para a UX.
3. **Escada de Valor Blindada:** Garantir tecnicamente que usuários grátis não consigam "burlar" os relatórios e que o plano Vitalício seja travado *apenas ao e-mail comprador original* (cláusula recém-adicionada aos Termos de Uso).
4. **Módulo Wealth:** Aperfeiçoar a tela de investimentos. Foi uma decisão consciente separá-la do fluxo gratuito para embalar como "Produto Ouro" e aumentar a receita.

---

## 3. O Que NÃO é Prioridade Agora (Backlog)
Tivemos a maturidade de dizer "não" ou "depois" para algumas ideias para mantermos o foco:
*   ❌ **Aplicativo Nativo (Android/iOS):** Manteremos o foco 100% no Web/PWA responsivo (que já imita um app). Fazer apps nativos agora duplicaria a base de código, os custos de servidor e traria taxas de 30% da Apple/Google.
*   ❌ **Módulo de Investimento Freemium:** Decidimos *não* dar uma "amostra grátis" da aba de investimentos. O público investidor tem dinheiro; empacotamos isso como um serviço Premium exclusivo (Plano Wealth) desde o dia 1.
*   ❌ **Integração Open Finance (Open Banking Automático):** Conectar direto com a API dos bancos é caro (empresas como Belvo/Pluggy cobram alto) e exige muita burocracia de segurança. O modelo de *Importação de Arquivos* atual funciona muito bem, é seguro e custa 0.

---

## 4. Próximos Passos e KPIs (Roadmap de Tração)
Para a próxima etapa de crescimento com os novos sócios, as métricas que devemos acompanhar religiosamente são:
1. Custo de Aquisição de Cliente (CAC) rodando os roteiros do Instagram.
2. **Taxa de Conversão do Paywall:** Quantos usuários Grátis clicam no painel "embaçado" do Dashboard e convertem para o Anual de R$ 9,99.
3. **Upsell para o Wealth:** Do público que importou saldo, quantos convertem para a aba rica de Investimentos.

*"Feito é melhor que perfeito. O FinElo já tem um motor de receita inteligente, agora precisamos colocar gasolina (tráfego)."*

---

## 5. Plano de Ação e Metas de Tração (Visão 3 a 10 Meses)

Baseado na nossa estrutura de custo vs. potencial de venda, estas são as nossas metas estabelecidas e como chegaremos lá. A resposta central para esta fase é: **O momento agora é 100% Marketing e Vendas. A Infraestrutura atual dá conta das primeiras centenas de clientes com sobras.**

### Meta 1: Vender as 50 cotas do Founder's Pack (Até 3 Meses) 🏆
- **Faturamento Primário:** R$ 7.450,00 (Caixa Imediato)
- **Onde Focar:** **MARKETING E ANÚNCIOS (TRÁFEGO PAGO).**
- **Orçamento de Marketing Recomendado (Bootstrapping):**
    - A regra de ouro é a Validação Progressiva. Em vez de queimar R$ 5.000 no primeiro dia, a estratégia de baixo risco consiste nas seguintes fases:
    - **Fase 0 (Inteligência Competitiva - R$ 0,00):** Antes de gastar o primeiro real, mapear as estratégias de aquisição da concorrência direta e indireta (Organizze, Mobills, Gorila, Trademap). Acessar a "Biblioteca de Anúncios do Meta (Facebook Ads Library)" para ver exatamente quais vídeos e *copys* os concorrentes estão rodando hoje. Analisar os funis deles (clicar nos anúncios, ver a Landing Page, os preços e e-mails que enviam).
    - **Fase 1 (O Laboratório):** R$ 1.000 a R$ 1.500 distribuídos em campanhas de R$ 30 a R$ 50/dia utilizando os formatos de peças validados na Fase 0. O objetivo aqui NÃO é ter ROI imediato, é comprar os nossos próprios dados (descobrir o Custo de Aquisição - CAC real do FinElo).
    - **Fase 2 (Tração / Escada Segura):** Apenas após atestar que "colocar R$ X traz 1 usuário pagante" na Fase 1, a verba é escalada com segurança para fechar as 50 vagas de R$ 149.
- **Produção de Conteúdo e Equipe (Agência vs. Independente):**
    - **Cenário Atual (0 Clientes Pagantes):** A recomendação é operar de forma 100% **Independente (In-house)** nos primeiros 3 meses. Contratar uma agência de marketing ou social media agora adiciona um overhead de R$ 2.000 a R$ 4.000 mensal fixo que consome todo o oxigênio financeiro antes do produto provar que vende sozinho ("Product-Market Fit").
    - **Estratégia Anti-Agência (Fase 1):** Usar os sócios para gerar Reels orgânicos e anúncios gravados no celular ("UGC" - Conteúdos Gerados pelo Usuário, que convertem infinitamente melhor do que posts polidos de agências). Usar a automação de IA (que já temos estruturada via Google Sheets/Gemini) para gerar as postagens diárias de forma autônoma a custo zero.
    - **Quando Contratar?** Apenas após vendermos os 50 Founders e obtermos os primeiros 50 recorrentes, usaremos essa recorrência faturada (ARR) para pagar um profissional focado em Escala, não em tentativa e erro inicial.
- **O Plano:**
    - Destinar parte do capital já em caixa especificamente para Ads no Instagram e no Facebook, utilizando vídeos caseiros com problemas reais ("Sua planilha quebra todo mês?", "Brigas por finanças no casamento?").
    - Nós temos uma grade de conteúdo rica ("Dark Finance"). Criaremos campanhas de conversão enviando as pessoas para a Landing Page focando na escassez (apenas 50 vagas, 149 reais, acesso vitalício).
    - **Infraestrutura?** A Supabase e a Vercel aguentam 50 a 100 usuários pesados dormindo. Não gastamos um real com upgrade de servidor agora.

### Meta 2: 50 Assinantes Anuais ou Wealth (Em 6 a 10 Meses) 📈
- **Receita Recorrente Anual (ARR):** R$ 5.995,00 a R$ 11.940,00 previsíveis por ano.
- **Onde Focar:** **OTIMIZAÇÃO DE PRODUTO E TRÁFEGO ORGÂNICO/PAGO.**
- **O Plano:**
    - Com o caixa dos Founders garantido, começamos a investir no Módulo Wealth (melhorar gráficos, colocar rentabilidade no tempo).
    - **SEO e Conteúdo:** Produzir vídeos no Instagram e TikTok focados em "Como organizar as contas" - cada visualização leva direto para o cadastro *Basic (Grátis)*.
    - **Infraestrutura:** Com 100 usuários totais (+50 Founders, +50 Recorrentes), continuaremos na faixa gratuita da Vercel para hospedagem. Podemos precisar apenas subir o limite do banco de dados na Supabase ($25/mês) se o volume de transações guardadas for imenso, o que as 50 assinaturas cobririam com extrema folga.

---

## 6. Análise Competitiva e Posicionamento (O Nosso Diferencial)
Para nos posicionarmos contra as maiores referências atuais, deixamos claro que **não queremos ser a ferramenta mais complexa do mercado, queremos ser a mais elegante e eficiente.**

### Os "Gestores de Despesas" (Ex: Mobills, Organizze)
- **O que são:** Aplicativos massivos de controle de gastos via cartão e conta.
- **O Exemplo (Mobills):** Apostou forte no Open Finance Automático. Como consequência, virou um aplicativo absurdamente complexo, poluído, com bugs diários de deslogamento de banco.
- **O Nosso Diferencial (Ataque Básico/Pro):** A  **Simplicidade e Estabilidade**. O método de "Importação Mensal/Semanal" do FinElo garante 100% de estabilidade e obriga o usuário a ter um momento de reflexão com os próprios números (com a IA mastigando o resumo para ele). Menos é mais.

### Os "Agregadores de Investimento" (Ex: TradeMap, Gorila)
- **O que são:** Plataformas para consolidar rendimentos de diferentes corretoras (XP, BTG, Inter).
- **O Exemplo (TradeMap):** Focado no *Day Trader*. Milhões de gráficos, cotações ao vivo. Acaba assustando o pai de família que só quer investir a longo prazo.
- **O Nosso Diferencial (Ataque Wealth):** **Tudo em um só lugar (All-in-One).** Nos concorrentes, o cliente vê as ações no TradeMap, mas tem que usar o Organizze para ver o saldo da conta de luz. No FinElo, o módulo Wealth centraliza a evolução patrimonial na mesma plataforma amigável do dia a dia.

---

## 7. Estratégia de Parceiros Comerciais e Canais de Distribuição (Canal B2B2C)

A grande vantagem de não depender exclusivamente de tráfego pago é a força do Canal de Distribuição, utilizando parceiros estratégicos que já possuem a confiança do nosso público-alvo, como Corretores de Seguros, Consultores da Ademicon, Assessores Financeiros e Consultoras Pessoais.

### Por que Parceiros Comerciais?
Um corretor da Ademicon (Consórcio) precisa mostrar para um cliente que a parcela de R$ 2.000,00 mensais cabe no orçamento dele. Ter a esposa como Consultora Financeira complementa perfeitamente o ciclo: **Eles podem usar o FinElo como a "ferramenta oficial" de diagnóstico financeiro que eles entregam para seus clientes.** 

### Política Sugerida de Comissionamento (Revenda/Parceria):
Em SaaS (Software as a Service), a matemática de comissão visa não sacrificar a margem da sua empresa e, ao mesmo tempo, ser extremamente agressiva (boa) para o parceiro no curto prazo. 

#### Opção A: Comissão Agressiva de Captação (Front-end) *👉 Estratégia Recomendada*
O parceiro ganha muito pela primeira venda, estimulando ele a vender alto volume, sem pesar na nossa recorrência futura.
*   **Comissão Mínima/Justa:** 40% a 50% **Apenas na 1ª Mensalidade ou 1ª Anuidade**.
*   **A Matemática:** Se ele vende um plano Anual (R$ 119), ele ganha um comissionamento imediato de ~R$ 50,00. A partir da renovação (Ano 2 diante), 100% do lucro é do FinElo. A empresa cresce com o "Bônus Perfil", e o parceiro ganha por conversão rápida.
*   **Vantagem no Founder's Pack (Vitalício):** Se aplicarmos 30% a 40% (R$ 44 a R$ 59 de comissão) em um produto Vitálicio (Cash-in Imediato), eles têm forte apelo para vender rápido.

#### Opção B: Comissão Recorrente de Carteira (Longo Prazo)
O parceiro vira praticamente um acionista da carteira dele. Mais lento, mas vira "salário" para ele.
*   **Comissão Recomendada:** 15% a 20% **Recorrente (Lifetime Value)**. 
*   **A Matemática:** Toda vez que a mensalidade de R$ 19,90 do cliente cair, ele ganha ~R$ 3,90. E ganha todo mês e todo ano que o cliente renovar o plano.

#### Vantagem Competitiva da Parceria Pronta:
Podemos permitir que a "Conta Consultor" crie contas "Gratuitas/Basic" (Iscas) customizadas para seus clientes. Assim que o cliente estiver dentro da plataforma e enxergar os painéis bloqueados do "Wealth" e "Pro", o Upsell acontece quase que automaticamente na própria plataforma, atrelando a venda ao link do afiliado (Consultor).
