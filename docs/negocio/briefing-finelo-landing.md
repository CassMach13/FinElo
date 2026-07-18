# Briefing de melhoria — Landing FinElo

**Produto:** FinElo (`https://www.finelo.app.br/`)  
**Contexto:** produto principal do fundador; em breve empresa própria. Também será o **projeto em destaque** na página institucional DevClub (concurso).  
**Objetivo deste briefing:** elevar o acabamento da landing de “SaaS funcional/amador” para **produto premium, contemporâneo e confiável**, sem copiar a identidade visual do DevClub — transferindo **qualidade de pensamento**, não a paleta verde/neon.

**Idioma:** português-BR (UTF-8).  
**Data:** 18/07/2026.

---

## 1. Resultado desejado

Uma landing que, em 10 segundos, comunique:

1. **O que é:** controle financeiro descomplicado (fim da planilha caótica).
2. **Para quem:** indivíduo e família que querem clareza, metas e patrimônio real.
3. **Por que agora:** importação rápida, visão clara, diagnóstico, plano família, planos acessíveis.
4. **Confiança:** produto sério o suficiente para abrir empresa em cima — não “projeto de curso”.

A página deve parecer **produto de 2026**, não template Bootstrap/Tailwind genérico com glow no botão.

### Critério de sucesso (subjetivo + objetivo)

- Visitante sente “isso é um produto de verdade” antes de ler o pricing.
- Hero + prova do produto (UI real) formam **uma composição**, não texto + screenshot solto.
- Nenhum bloco parece card de feature genérico com ícone + 3 linhas idênticas.
- CTAs claros, hierarquia de planos legível, garantia séria (sem emoji de urgência barata).
- Mobile impecável; teclado e contraste ok; motion com `prefers-reduced-motion`.
- Prints desta landing possam entrar no card **Projeto em destaque** do DevClub sem vergonha.

---

## 2. Posicionamento (rascunho para validar)

| Dimensão | Direção proposta |
| --- | --- |
| Promessa | Clareza financeira sem planilha complexa |
| Diferencial | Importação + categorização + visão (50-30-20) + patrimônio + família |
| Tom | Calmo, competente, adulto — “paz e controle”, não hype de infoproduto |
| Antagonista | Planilha bagunçada, extratos em 3 apps, discussão de casal no fim do mês |
| Não é | Banco, corretora, “fique rico”, app de criptomoeda |

**Hipótese de marca:** FinElo = elo entre dinheiro e vida (pessoa/família). Visual deve sugerir **clareza, estabilidade e progresso**, não adrenalina.

---

## 3. Diagnóstico da landing atual (com base em `finelo.app.br`, jul/2026)

### O que já funciona

- Promessa clara no H1: *“O Fim das Planilhas Complexas”*.
- Estrutura comercial completa: benefícios → objetivos → família → depoimentos → garantia → pricing.
- Paleta escura + teal tem potencial (não precisa jogar fora).
- Oferta com planos Basic / PRO / Wealth / Founder e garantia de 7 dias.
- CTA de conta no hero (e-mail + Criar Conta).

### O que parece amador / desalinhado com o nível DevClub

1. **Hero fraco como composição**  
   Texto centralizado + formulário + glow no botão + screenshot “solto” abaixo. Falta um plano visual dominante (produto full-bleed ou composição integrada). O primeiro viewport não “pertence” só à FinElo — poderia ser qualquer SaaS financeiro.

2. **Prova de produto pouco curada**  
   A UI exposta precisa mostrar o **momento mágico** (dashboard de clareza, importação, patrimônio, família) — não telas operacionais/genéricas (ex.: configurações) se forem as primeiras impressões.

3. **Seções em grade de cards genéricos**  
   “Por que escolher” / “Maiores objetivos” repetem o mesmo molde: ícone + título + parágrafo. Sem ritmo, sem âncora visual, sem progressão narrativa.

4. **Tipografia sem assinatura**  
   Sans genérica, hierarquia ok mas sem personalidade. No DevClub, a tipografia *é* parte da marca. FinElo precisa de display próprio (não Inter/Roboto/Arial default).

5. **Acabamento de UI marketing**  
   Glow intenso em CTA, bordas/radii previsíveis, pouco uso de atmosfera (gradientes sutis, profundidade, grid/texture com função). Glass/neon residual de “SaaS dark mode 2023”.

6. **Prova social frágil se não verificada**  
   Depoimentos nomeados (“João Silva”, “Maria Costa”…) com claim *“histórias reais”*. Se forem fictícios/demo, **não** diga “reais”. Se forem reais, precisa autorização. Mesma disciplina do DevClub (`real_verified` / `fictional_demo`).

7. **Alegações sem fonte**  
   Ex.: *“casais… 2x mais rápido”* — marcar como **Hipótese** ou remover até ter fonte. Evita risco de marca.

8. **Pricing com cheiro de escassez forçada**  
   “🔥 RESTAM APENAS 50 VAGAS” compete com o tom premium. Urgência pode existir, mas de forma sóbria (ou com estoque real auditável).

9. **Movimento quase ausente ou genérico**  
   DevClub usa movimento com função (narrativa, feedback, continuidade). FinElo pode ser mais contida, mas precisa de 2–3 motions intencionais (não fade em tudo).

10. **Espaçamento / respiro**  
    Blocos longos sem contraste de ritmo; visitante cansa antes do pricing.

---

## 4. O que transferir do DevClub (princípios — não o look)

Copiar verde elétrico / órbita / “clube” **não**. Transferir isto:

| Princípio DevClub | Aplicação FinElo |
| --- | --- |
| Uma composição no primeiro viewport | Hero = marca + 1 frase + 1 CTA + produto dominante |
| Marca como sinal hero-level | “FinElo” visível e memorável, não só logo no canto |
| Tipografia expressiva e própria | Display + corpo; evitar stack default |
| Atmosfera (não fundo chapado) | Gradientes/textura sutis alinhados a “clareza financeira” |
| Uma função por seção | Cada bloco: um job, um H2, um apoio curto |
| Cards só quando ajudam interação | Evitar cardite; preferir layout editorial + UI real |
| Movimento com função | Ex.: revelar fluxo Extrato → Categoria → Clareza |
| Prova no momento certo | UI / número / depoimento onde sustenta a alegação |
| Conteúdo com procedência | Nunca inventar “história real” |
| Acessibilidade e reduced-motion | Obrigatório |
| Acabamento “premium, não elitista” | Confiança adulta, linguagem acolhedora |

### Direção visual sugerida para FinElo (própria)

- Base escura atual pode permanecer (continuidade de marca).
- Teal/ciano como **clareza / confiança** (refinar saturação; menos glow).
- Um segundo sotaque sóbrio (ex.: âmbar suave para “meta/conquista” **ou** azul-noite para profundidade) — escolher 1, não arco-íris.
- Evitar: purple-to-indigo genérico de IA; cream+serif terracotta; glow multilayers; pills demais; emojis de urgência.
- Fotografia: preferir **produto real** (UI) como âncora; pessoas só com autorização e propósito.

---

## 5. Arquitetura de conteúdo proposta

Ordem sugerida (ajustar nomes, manter função):

1. **Hero** — promessa + CTA + UI dominante (full-bleed ou stage integrado).  
2. **Momento mágico** — 3 passos: Importar → Entender → Decidir (com UI, não ícones vazios).  
3. **Clareza** — dashboard / 50-30-20 / onde o dinheiro vai (prova visual).  
4. **Patrimônio & metas** — “quanto você realmente vale” + objetivos.  
5. **Família** — plano compartilhado sem senha compartilhada (bloco editorial, não card genérico).  
6. **Prova social** — só depoimentos autorizados; senão, remover ou marcar demo.  
7. **Garantia** — 7 dias / CDC: layout sóbrio e institucional (referência de tom: card de garantias DevClub, **não** as cores).  
8. **Planos** — hierarquia clara; Founder como exceção editorial, não banner de scarcity.  
9. **FAQ curto** + suporte.  
10. **Rodapé** institucional (empresa em formação: cuidado com claims legais).

### Textos (direção)

- Hero: manter espírito do H1 atual, mas testar variantes mais humanas (“Veja para onde vai o seu dinheiro — sem planilha”).  
- Evitar jargão vazio (“império”, “desbravar”) se soar exagerado para o público.  
- CTAs: “Criar conta grátis” / “Começar no Basic” / “Assinar PRO” — verbos concretos.

---

## 6. Diretrizes de UI / acabamento

### Hero

- Uma composição; sem dashboard de marketing no hero (stats, chips, badges).  
- Produto: frame de app com tela **curada** (home/dashboard de valor), `object-fit` honesto, sem corte feio.  
- Formulário de e-mail: elegante, contraste alto, erro acessível; glow no botão no máximo sutil ou ausente.  
- Marca FinElo em escala hero ou wordmark forte.

### Seções

- Sem grade 3×N de cards idênticos. Alternar: texto+UI, UI full-width, lista editorial, quote.  
- Separadores refinados (não “traços amadores”); preferir espaço tipográfico e blocos.  
- Pricing: 3 colunas limpas; destacar 1 plano recomendado por tipografia/posição, não por fogo.

### Microinterações (orçamento mínimo)

1. Hover/foco em CTAs e planos (feedback claro).  
2. Transição suave entre Mensal/Anual.  
3. Uma assinatura de scroll: ex. painel de UI que “monta” clareza (com pause / reduced-motion = estático).

### O que cortar

- Emoji de urgência no Founder.  
- Claims “2x” sem fonte.  
- Depoimentos “reais” sem autorização.  
- Glow agressivo, partículas, glassmorphism decorativo.  
- Screenshot de telas administrativas como primeira prova.

---

## 7. Requisitos técnicos e qualidade

- Semântica HTML, foco visível, contraste AA+, labels em formulários.  
- `prefers-reduced-motion: reduce` sem perda de conteúdo.  
- Performance: LCP do hero (imagem/UI otimizada); fontes com subset; sem JS pesado sem motivo.  
- Responsivo desde o conceito (mobile não é afterthought).  
- Conteúdo/dados separados da apresentação (planos, FAQ, depoimentos em dados tipados).  
- Classificar procedência de depoimentos e números (mesma disciplina do DevClub).  
- Stack: **não decidir neste briefing** — primeiro conceito visual e conteúdo; depois stack com ADR curto.

---

## 8. Relação com a página DevClub (projeto destaque)

Na página do concurso, o bloco **Projeto em destaque** deve apontar para FinElo com:

- Nome e uma linha de posicionamento honestos.  
- Prints **da landing e/ou do app** no estado pós-melhoria (não do estado atual amador).  
- Link para `https://www.finelo.app.br/` (ou rota oficial).  
- Se a empresa ainda não existir juridicamente, evitar claims de CNPJ/razão social até existir.

**Sequência sugerida:** melhorar FinElo → capturar 3–4 frames curados → atualizar card no DevClub.

---

## 9. Backlog priorizado

### P0 — impacto imediato de “não-amador”

1. Redesign do **hero** (composição + UI curada + tipografia).  
2. Substituir grades genéricas por **2–3 seções editoriais** com prova de produto.  
3. Refinar **CTA/glow**, espaçamento, hierarquia tipográfica.  
4. Auditar **depoimentos e claims** (remover/corrigir procedência).  
5. Pricing sóbrio (remover scarcity falsa se não for real).

### P1 — confiança e conversão

6. Bloco família com narrativa + UI.  
7. Garantia institucional (layout sério).  
8. FAQ + suporte.  
9. Motion mínimo intencional + reduced-motion.

### P2 — polish

10. Microcopy legal fino (empresa em formação).  
11. Open Graph / SEO / meta.  
12. Prints finais para DevClub.

---

## 10. Lacunas / decisões em aberto (responder na conversa da FinElo)

- [ ] Depoimentos atuais são reais autorizados ou demo?  
- [ ] Claim “2x mais rápido” tem fonte? Se não, remove.  
- [ ] Founder Pack: 50 vagas são reais e atualizadas?  
- [ ] Qual tela do app é o “momento mágico” oficial para o hero?  
- [ ] Nome jurídico / tom de “empresa em formação” no rodapé?  
- [ ] Manter teal atual ou recalibrar tokens?  
- [ ] Fontes candidatas (display + body) — decidir após 2 exploratórias.  
- [ ] A landing atual é o melhor canal de captura ou há app PWA misturando marketing e produto na mesma URL?

---

## 11. Prompt pronto para colar na outra conversa (FinElo)

> Melhore a landing da FinElo (`https://www.finelo.app.br/`) seguindo o briefing em `briefing-finelo-landing.md` (ou o texto completo desta mensagem).  
> Não copie a estética do DevClub; transfira a **qualidade**: composição de hero, tipografia própria, prova de produto curada, seções com uma função, acabamento premium, claims honestos, a11y e reduced-motion.  
> Comece por diagnóstico visual + plano de seções; só depois implemente. Priorize P0. Marque hipóteses e não invente depoimentos reais.

---

## 12. Referência rápida do estado atual (inventário)

**URL:** https://www.finelo.app.br/  
**Título:** FinElo | Controle Financeiro Descomplicado  

**Seções observadas:** Hero (e-mail + Criar Conta) → Por que escolher (3) → Objetivos (3) → Plano Família → Depoimentos (3) → Garantia 7 dias → Planos (Basic / PRO / Wealth / Founder) → Rodapé / WhatsApp.

**CTAs:** Entrar, Começar Grátis, Criar Conta, Conhecer Plano Família, Assinar PRO/Wealth, Garantir Acesso Vitalício, Fale com suporte/WhatsApp.
