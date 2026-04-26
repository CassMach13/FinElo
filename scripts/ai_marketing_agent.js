import fs from 'fs';
import path from 'path';
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from 'dotenv';

// Carregar variáveis de ambiente
dotenv.config({ path: '.env.local' });

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

/**
 * Script: FinElo Social Media Agent
 * Objetivo: Transformar a estratégia em Markdown em posts prontos para uso.
 */

async function generatePostForToday() {
  try {
    const strategyPath = path.resolve('instagram_strategy/estrategia_abril_consolidada.md');
    
    if (!fs.existsSync(strategyPath)) {
      console.error('Estratégia não encontrada!');
      return;
    }

    const strategy = fs.readFileSync(strategyPath, 'utf8');
    
    const prompt = `
      Você é o Gerente de Marketing e Copywriter da FinElo.
      Seu estilo é o "Mentor Sábio": Sofisticado, calmo, autoritário, mas acolhedor.
      
      BASE DE ESTRATÉGIA:
      ${strategy}
      
      TAREFA:
      Identifique o post planejado para HOJE (ou o próximo disponível na lista) e gere:
      1. Legenda de alta conversão para o Instagram.
      2. Prompt fotorrealista para o DALL-E 3 (Inglês) para gerar a imagem, seguindo o padrão "Dark Premium" (Preto, Verde Esmeralda, Luxo).
      3. Call to Action (CTA) focada no ManyChat (palavra-chave: FINELO).
      
      SAÍDA:
      Formate a resposta em Markdown claro.
    `;

    console.log('--- Gerando conteúdo com IA... ---');
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    console.log('\n--- CONTEÚDO GERADO ---');
    console.log(text);
    
    // Opcional: Salvar em um arquivo temporário
    const outputPath = path.resolve('instagram_strategy/Postagens/post_gerado_ia.md');
    fs.writeFileSync(outputPath, text);
    console.log(`\n✅ Post salvo em: ${outputPath}`);

  } catch (error) {
    console.error('Erro ao gerar post:', error);
  }
}

// Executar
generatePostForToday();
