// ─────────────────────────────────────────────
// FamilyFinanceBot · NLP Service (Claude API)
// ─────────────────────────────────────────────

import Anthropic from '@anthropic-ai/sdk';
import type { ParsedTransaction } from '../types';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `Você é um parser financeiro para um app de finanças familiares brasileiro.
Sua única função é extrair dados estruturados de mensagens em português e retornar JSON válido.

REGRAS:
- amount: número decimal. Negativo para gastos/saídas, positivo para entradas/receitas.
- category: uma das opções: food, restaurant, market, butcher, fishmonger, greengrocery, pet, delivery, personal, home, transport, health, leisure, education, income, other
- name: nome legível do gasto/entrada (capitalizado, máx 40 chars)
- date: data no formato YYYY-MM-DD. Use a data de hoje se não informada.
- confidence: 0.0 a 1.0. Use < 0.7 se a mensagem for ambígua.
- ambiguous: true se não souber o valor ou a categoria com certeza
- ambiguityReason: motivo da ambiguidade (apenas se ambiguous=true)

MAPEAMENTO DE CATEGORIAS (exemplos):
- food: alimentação genérica, lanchonete, padaria, salgado, doce, sorvete
- restaurant: restaurante, ifood, rappi, uber eats, delivery de comida, almoço fora, jantar fora, lanche fora, fast food, hamburger, pizza, sushi
- market: mercado, supermercado, feira, hortifruti, quitanda, compras do mês, compras da semana
- butcher: açougue, frigorífico, carne, frango, proteína animal
- fishmonger: peixaria, peixe, frutos do mar, camarão, salmão, atum, bacalhau, mariscos, ostras
- greengrocery: hortifruti, verduras, legumes, frutas, quitanda, feira de verduras, orgânicos, salada, cenoura, tomate, banana, maçã, uva
- pet: pet shop, ração, veterinário, banho e tosa, tosa, vacina animal, remédio animal, acessórios pet, coleira, aquário, gato, cachorro, pássaro
- delivery: delivery, ifood iFood almoço em casa, jantar em casa, pedido pelo app, motoboy, taxa de entrega, entrega em domicílio
- personal: salão, cabeleireiro, manicure, pedicure, maquiagem, barbeiro, barbearia, academia, roupas, sapatos, tênis, joias, acessórios, perfume, futebol, esporte pessoal, streaming individual, assinatura pessoal, café pessoal, almoço pessoal, gasto individual
- home: aluguel, condomínio, energia, luz, água, gás, internet, limpeza, reforma
- transport: uber, 99, gasolina, combustível, estacionamento, ônibus, metrô, pedágio, manutenção carro
- health: farmácia, remédio, médico, dentista, academia, plano de saúde, exame
- leisure: netflix, spotify, cinema, teatro, barzinho, viagem, hotel, show, jogo
- education: escola, faculdade, curso, livro, material escolar
- income: salário, freelance, transferência recebida, pix recebido, dividendo

RETORNE APENAS JSON. Sem texto antes ou depois. Sem markdown.

Exemplo de entrada: "gastei 45,90 no uber"
Exemplo de saída:
{"amount":-45.90,"category":"transport","name":"Uber","date":"2025-03-08","confidence":0.98}

Exemplo de entrada: "recebi 1200 de freela"
Exemplo de saída:
{"amount":1200.00,"category":"income","name":"Freelance","date":"2025-03-08","confidence":0.95}

Exemplo de entrada: "45 ontem"
Exemplo de saída:
{"amount":-45.00,"category":"other","name":"Gasto","date":"2025-03-07","confidence":0.4,"ambiguous":true,"ambiguityReason":"Categoria não identificada"}`;

/**
 * Interpreta uma mensagem em linguagem natural e extrai
 * os dados da transação financeira.
 */
export async function parseTransaction(
  message: string,
  todayISO: string,
): Promise<ParsedTransaction | null> {
  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 256,
      system: SYSTEM_PROMPT.replace(/hoje/g, todayISO),
      messages: [{ role: 'user', content: message }],
    });

    const raw = (response.content[0] as Anthropic.TextBlock).text
      .trim()
      .replace(/^```(?:json)?\s*/i, '')   // remove abertura de bloco markdown
      .replace(/\s*```$/,         '')     // remove fechamento de bloco markdown
      .trim();
    const parsed = JSON.parse(raw) as ParsedTransaction;

    // Validação mínima
    if (typeof parsed.amount !== 'number' || !parsed.category || !parsed.name) {
      return null;
    }

    return parsed;
  } catch (err) {
    console.error('[NLP] Erro ao parsear mensagem:', err);
    return null;
  }
}

/**
 * Verifica se a mensagem parece ser uma transação financeira
 * (filtro rápido antes de chamar a API).
 */
export function looksLikeTransaction(text: string): boolean {
  const financial = [
    /\d/,                                                          // tem algum número
    /gastei|paguei|comprei|recebi|entrou|saiu/i,                   // verbos comuns
    /r\$|reais/i,                                                  // menciona moeda
    /salário|freela|aluguel|conta|mercado|restaurante|açougue|hortifruti|petshop|delivery/i,   // palavras-chave
  ];
  return financial.some((re) => re.test(text));
}
