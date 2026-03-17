# Guia: Automação de Conteúdo com IA (Google Sheets + Gemini)

Este guia mostra como criar um "robô" gratuito usando **Google Planilhas** e **Google Gemini** para gerar legendas e ideias de post automaticamente.

## Pré-requisitos
*   Uma conta Google (@gmail.com).
*   Acesso ao [Google AI Studio](https://aistudio.google.com/).

---

## Passo 1: Pegar sua Chave de API (Cérebro do Robô)
1.  Acesse [aistudio.google.com](https://aistudio.google.com/).
2.  Clique no botão azul **"Get API key"** (canto superior esquerdo).
3.  Clique em **"Create API key"**.
4.  Selecione seu projeto (ou crie um novo padrão).
5.  **Copie a chave** gerada (começa com `AIza...`).
    *   *Guarde essa chave, ela é a senha do seu robô.*

---

## Passo 2: Preparar a Planilha
1.  Crie uma nova planilha no [sheets.google.com](https://sheets.google.com).
2.  Nomeie como **"Fábrica de Posts FinElo"**.
3.  Crie as seguintes colunas na primeira linha (A1 até D1):
    *   **A:** Ideia / Tema
    *   **B:** Tipo (Carrossel, Tweet, Reels)
    *   **C:** Legenda Gerada (IA)
    *   **D:** Status

---

## Passo 3: Criar o Script (O Código)
1.  Na planilha, clique no menu **Extensões** > **Apps Script**.
2.  Uma nova aba abrirá com um editor de código.
3.  Apague qualquer código que estiver lá e **cole o código abaixo**:

```javascript
// CONFIGURAÇÃO
const API_KEY = 'AIzaSyBGUpAPJc9FnMMDtFlvbeM8WQFBHJy2ziw'; // SUA CHAVE ESTÁ AQUI

function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('🤖 FinElo AI')
      .addItem('Gerar TUDO (Legendas + Imagem)', 'gerarTudo')
      .addItem('Diagnóstico (Testar Modelos)', 'diagnosticoCompleto')
      .addToUi();
}

function gerarTudo() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const row = sheet.getActiveCell().getRow();
  
  // Pega os dados da linha selecionada
  const tema = sheet.getRange(row, 1).getValue(); // A
  const tipo = sheet.getRange(row, 2).getValue(); // B
  
  if (tema === "") {
    SpreadsheetApp.getUi().alert("Por favor, escreva uma ideia na coluna A.");
    return;
  }
  
  // Atualiza Status (Coluna E)
  sheet.getRange(row, 5).setValue("⏳ Gerando Instagram..."); 
  
  try {
    // 1. GERA INSTAGRAM
    const promptInsta = `
      Aja como um especialista em Marketing Digital focado no nicho 'Dark Finance'.
      Crie uma legenda para o INSTRAGRAM baseada neste tema: "${tema}".
      Formato: ${tipo}.
      Regras:
      - Comece com um Hook (Gancho) visual e curto.
      - Use quebra de linhas.
      - Termine com CTA para comentar ou clicar no link da bio.
      - Adicione 5 hashtags focadas.
      - Tom: Autoritário, Sóbrio.
    `;
    const legendaInsta = chamarGemini(promptInsta);
    sheet.getRange(row, 3).setValue(legendaInsta);

    sheet.getRange(row, 5).setValue("⏳ Gerando Facebook...");

    // 2. GERA FACEBOOK
    const promptFace = `
      Aja como um especialista em Copywriting para FACEBOOK focado em viralização e discussão.
      Crie um texto para o FACEBOOK baseado neste tema: "${tema}".
      Contexto: O mesmo conteúdo do Instagram, mas adaptado para leitura em feed de notícias.
      Regras:
      - Foco em Storytelling e perguntas para gerar debate nos comentários.
      - Textos mais longos e explicativos funcionam bem.
      - Sem muitas hashtags (máximo 2).
      - CTA para compartilhar ou marcar alguém.
      - Tom: Conversa séria, "conselho de amigo".
    `;
    const legendaFace = chamarGemini(promptFace);
    sheet.getRange(row, 4).setValue(legendaFace);
    
    sheet.getRange(row, 5).setValue("⏳ Gerando Prompt Imagem...");

    const promptImagem = `
      Crie um prompt detalhado em INGLÊS para gerar uma imagem de alta qualidade sobre: "${tema}".
      Estilo: "Dark Finance", Cyberpunk, Neon (Verde e Vermelho), Fundo Preto, Minimalista.
      Formato do prompt:
      [SUBJECT DESCRIPTION], dark finance aesthetic, neon green and red accents, black background, cinematic lighting, 8k resolution, photorealistic, --ar 4:5
      
      Regra CRÍTICA para textos na imagem: Se você sugerir algum texto escrito na imagem (typography/text), ele DEVE estar em Português do Brasil perfeito e sem erros de digitação. Adicione no final do prompt em inglês restrições como: "perfect typography, no spelling errors, correctly spelled Portuguese text".
      
      Apenas o prompt, sem enrolação.
    `;
    const imgPrompt = chamarGemini(promptImagem);
    sheet.getRange(row, 6).setValue(imgPrompt); // Escreve na Coluna F (6)

    // Finaliza
    sheet.getRange(row, 5).setValue("✅ Concluído");
    
  } catch (e) {
    sheet.getRange(row, 3).setValue("Erro: " + e.toString());
    sheet.getRange(row, 5).setValue("❌ Erro");
  }
}

function chamarGemini(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${API_KEY}`;
  
  const payload = {
    "contents": [{
      "parts": [{
        "text": prompt
      }]
    }]
  };
  
  const options = {
    "method": "post",
    "contentType": "application/json",
    "payload": JSON.stringify(payload)
  };
  
  const response = UrlFetchApp.fetch(url, options);
  const json = JSON.parse(response.getContentText());
  
  if (json.candidates && json.candidates.length > 0) {
     return json.candidates[0].content.parts[0].text;
  } else {
     return "A IA não retornou nada. Verifique sua chave.";
  }
}

// DIAGNÓSTICO: Captura o erro completo se algo der errado
function diagnosticoCompleto() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`;
  
  sheet.getRange(1, 7).setValue("🔍 DIAGNÓSTICO (Coluna G)");
  
  try {
    const response = UrlFetchApp.fetch(url);
    const json = JSON.parse(response.getContentText());
    
    let row = 2;
    if (json.models) {
      json.models.forEach(model => {
        if (model.supportedGenerationMethods.includes("generateContent")) {
          sheet.getRange(row, 7).setValue(model.name); 
          row++;
        }
      });
      SpreadsheetApp.getUi().alert("✅ Modelos listados na Coluna G!");
    } else {
      SpreadsheetApp.getUi().alert("⚠️ NENHUM modelo encontrado. Erro na chave?");
    }
  } catch (e) {
    sheet.getRange(2, 7).setValue("ERRO: " + e.toString());
    SpreadsheetApp.getUi().alert("❌ Erro ao listar: " + e.toString());
  }
}
```

4.  **IMPORTANTE:** Substitua `'COLE_SUA_CHAVE_AQUI'` pela chave que você pegou no Passo 1 (mantenha as aspas simples).
5.  Clique no ícone de **Disquete (Salvar)**. Dê um nome ao projeto (ex: "Robô FinElo").

---

## Passo 4: Testar
1.  Volte para a planilha e **atualize a página (F5)**.
2.  Você verá um **novo menu** no topo chamado **"🤖 FinElo AI"** (pode demorar uns segundos para aparecer).
3.  Escreva na linha 2:
    *   **Ideia:** "Por que guardar dinheiro na poupança é perder dinheiro"
    *   **Tipo:** "Dark Tweet"
4.  Clique na célula da Ideia (A2).
5.  No menu, clique em **"🤖 FinElo AI"** > **"Gerar TUDO (Legendas + Imagem)"**.
6.  Na primeira vez, o Google pedirá permissão. Clique em **Continuar**, escolha sua conta, clique em **Avançado** (link pequeno) e depois em **Acessar Robô FinElo (inseguro)** (é seguro, é seu script).
7.  Aguarde uns segundos... e veja a mágica nas colunas C, D e F! ✨

---

### Próximos Passos (Avançado)
Se isso funcionar para você, podemos evoluir para:
1.  Gerar 10 ideias de uma vez.
2.  Gerar Prompts para Imagem (Nano Banana).
3.  Conectar com o Google Drive para salvar imagens automaticamente.
