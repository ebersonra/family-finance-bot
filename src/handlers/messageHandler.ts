// ─────────────────────────────────────────────
// FamilyFinanceBot · Message Handler
// ─────────────────────────────────────────────

import type { Message } from 'whatsapp-web.js';
import type { BotContext } from '../types';
import { classifyCommand } from '../utils/classifier';
import { parseTransaction, looksLikeTransaction } from '../services/nlp';
import {
  getMemberByPhone,
  saveTransaction,
  deleteLastTransaction,
  getMonthlySummary,
  getGoalsSummary,
} from '../services/supabase';
import {
  formatConfirmation,
  formatSuccess,
  formatAmbiguity,
  formatSummary,
  formatGoals,
  HELP_MESSAGE,
} from '../utils/formatters';

// Mapa em memória para estado temporário por número de telefone
// Em produção, migrar para Redis para suportar múltiplas instâncias
const sessions = new Map<string, BotContext>();

// Números autorizados (carregados do .env)
const ALLOWED_NUMBERS = new Set(
  (process.env.ALLOWED_NUMBERS ?? '').split(',').map((n) => n.trim()),
);

/**
 * Ponto de entrada para cada mensagem recebida.
 */
export async function handleMessage(msg: Message): Promise<void> {
  const phone = msg.from.replace('@c.us', '');

  // 1. Verificar se o número está autorizado
  if (!ALLOWED_NUMBERS.has(phone)) {
    console.log(`[Bot] Número não autorizado: ${phone}`);
    return;
  }

  const text = msg.body.trim();
  if (!text) return;

  console.log(`[Bot] Mensagem de ${phone}: "${text}"`);

  // 2. Buscar ou criar contexto da sessão
  let ctx = sessions.get(phone);
  if (!ctx) {
    const member = await getMemberByPhone(phone);
    if (!member) {
      await msg.reply(
        '⚠️ Seu número não está cadastrado no app.\nAbra o FamilyFinance e adicione seu telefone no perfil.',
      );
      return;
    }
    ctx = { phone, member };
    sessions.set(phone, ctx);
  }

  const command = classifyCommand(text);

  // 3. Roteamento de comandos
  switch (command) {
    case 'help':
      await msg.reply(HELP_MESSAGE);
      break;

    case 'summary':
      await handleSummary(msg);
      break;

    case 'goals':
      await handleGoals(msg);
      break;

    case 'edit':
      await handleEdit(msg, ctx);
      break;

    case 'confirm':
      await handleConfirm(msg, ctx);
      break;

    case 'cancel':
      await handleCancel(msg, ctx);
      break;

    case 'transaction':
      await handleTransaction(msg, ctx, text);
      break;

    default:
      await msg.reply(
        '🤔 Não entendi. Manda /ajuda para ver o que consigo fazer!',
      );
  }
}

// ── Handlers específicos ──────────────────────────

async function handleTransaction(
  msg: Message,
  ctx: BotContext,
  text: string,
): Promise<void> {
  // Filtro rápido antes de chamar a API
  if (!looksLikeTransaction(text)) {
    await msg.reply(
      '🤔 Não reconheci isso como uma transação.\n\nTente algo como:\n_"gastei 45 no uber"_ ou _"recebi 1200 de salário"_\n\nOu manda /ajuda.',
    );
    return;
  }

  await msg.reply('⏳ Analisando...');

  const today = new Date().toISOString().split('T')[0];
  const parsed = await parseTransaction(text, today);

  if (!parsed) {
    await msg.reply(
      '❌ Não consegui interpretar essa mensagem.\nTente ser mais específico, como: _"gastei 89,90 no mercado"_',
    );
    return;
  }

  // Confiança baixa ou ambíguo → pede esclarecimento
  if (parsed.ambiguous || parsed.confidence < 0.7) {
    await msg.reply(formatAmbiguity(parsed));
    return;
  }

  // Guarda para confirmação
  ctx.awaitingConfirmation = parsed;
  sessions.set(ctx.phone, ctx);

  await msg.reply(formatConfirmation(parsed, ctx.member.name));
}

async function handleConfirm(msg: Message, ctx: BotContext): Promise<void> {
  if (!ctx.awaitingConfirmation) {
    await msg.reply('🤔 Não há nenhum lançamento aguardando confirmação.');
    return;
  }

  const tx = ctx.awaitingConfirmation;
  const result = await saveTransaction(tx, ctx.member.id);

  if (!result) {
    await msg.reply('❌ Erro ao salvar. Tente novamente ou abra o app.');
    return;
  }

  ctx.lastTransaction = tx;
  ctx.awaitingConfirmation = undefined;
  sessions.set(ctx.phone, ctx);

  await msg.reply(formatSuccess(tx));
}

async function handleCancel(msg: Message, ctx: BotContext): Promise<void> {
  if (ctx.awaitingConfirmation) {
    ctx.awaitingConfirmation = undefined;
    sessions.set(ctx.phone, ctx);
    await msg.reply('🚫 Lançamento cancelado.');
  } else {
    await msg.reply('🤔 Não há nada para cancelar.');
  }
}

async function handleEdit(msg: Message, ctx: BotContext): Promise<void> {
  const deleted = await deleteLastTransaction(ctx.member.id);
  if (deleted) {
    ctx.lastTransaction = undefined;
    sessions.set(ctx.phone, ctx);
    await msg.reply('🗑️ Último lançamento removido com sucesso.');
  } else {
    await msg.reply('🤔 Não encontrei nenhum lançamento recente para remover.');
  }
}

async function handleSummary(msg: Message): Promise<void> {
  const summary = await getMonthlySummary();
  await msg.reply(formatSummary(summary));
}

async function handleGoals(msg: Message): Promise<void> {
  const goals = await getGoalsSummary();
  await msg.reply(formatGoals(goals));
}
