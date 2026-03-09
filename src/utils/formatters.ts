// ─────────────────────────────────────────────
// FamilyFinanceBot · Formatters
// ─────────────────────────────────────────────

import type { ParsedTransaction, GoalSummary } from '../types';
import type { MonthlySummary } from '../services/supabase';

const CATEGORY_LABELS: Record<string, string> = {
  food: '🛒 Alimentação',
  home: '🏠 Casa',
  transport: '🚗 Transporte',
  health: '💊 Saúde',
  leisure: '🎬 Lazer',
  education: '📚 Educação',
  income: '💰 Renda',
  other: '📦 Outros',
};

export function fmt(value: number): string {
  return Math.abs(value).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

// ── Confirmação de transação ──────────────────────

export function formatConfirmation(tx: ParsedTransaction, memberName: string): string {
  const type = tx.amount > 0 ? '📥 *Entrada*' : '📤 *Saída*';
  const value = tx.amount > 0
    ? `+${fmt(tx.amount)}`
    : `-${fmt(tx.amount)}`;

  return [
    `${type} detectada:`,
    ``,
    `💸 *Valor:* ${value}`,
    `📂 *Categoria:* ${CATEGORY_LABELS[tx.category] ?? tx.category}`,
    `📝 *Descrição:* ${tx.name}`,
    `📅 *Data:* ${formatDate(tx.date)}`,
    `👤 *Membro:* ${memberName}`,
    ``,
    `Confirmar? Responda *sim* ou *não*`,
  ].join('\n');
}

// ── Sucesso ao salvar ─────────────────────────────

export function formatSuccess(tx: ParsedTransaction): string {
  const emoji = tx.amount > 0 ? '✅' : '✅';
  const value = tx.amount > 0 ? `+${fmt(tx.amount)}` : `-${fmt(tx.amount)}`;
  return `${emoji} Registrado! ${CATEGORY_LABELS[tx.category]} · *${value}* · ${formatDate(tx.date)}`;
}

// ── Ambiguidade ───────────────────────────────────

export function formatAmbiguity(tx: ParsedTransaction): string {
  return [
    `🤔 Não entendi completamente:`,
    `_"${tx.ambiguityReason}"_`,
    ``,
    `Tente ser mais específico, por exemplo:`,
    `• _"gastei 45 no uber"_`,
    `• _"recebi 1200 de salário"_`,
    `• _"paguei 89,90 no mercado"_`,
  ].join('\n');
}

// ── Resumo mensal ─────────────────────────────────

export function formatSummary(summary: MonthlySummary): string {
  const { totalIncome, totalExpenses, balance, topCategories } = summary;
  const now = new Date();
  const monthName = now.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

  const topLines = topCategories.map(
    (c, i) => `  ${i + 1}. ${CATEGORY_LABELS[c.category] ?? c.category}: *${fmt(c.total)}*`,
  );

  return [
    `📊 *Resumo de ${monthName}*`,
    ``,
    `📥 Entradas: *${fmt(totalIncome)}*`,
    `📤 Saídas:   *${fmt(totalExpenses)}*`,
    `💰 Saldo:    *${balance >= 0 ? '+' : ''}${fmt(balance)}*`,
    ``,
    topCategories.length > 0 ? `🏆 *Top categorias:*` : '',
    ...topLines,
    ``,
    `_Abra o app para ver o detalhamento completo_`,
  ]
    .filter(Boolean)
    .join('\n');
}

// ── Metas ─────────────────────────────────────────

export function formatGoals(goals: GoalSummary[]): string {
  if (goals.length === 0) {
    return '🎯 Nenhuma meta cadastrada ainda. Abra o app para criar!';
  }

  const lines = goals.map((g) => {
    const bar = progressBar(g.pct);
    return `${g.emoji ?? '🎯'} *${g.label}*\n  ${bar} ${g.pct}% · ${fmt(g.saved)} de ${fmt(g.target)}`;
  });

  return [`🎯 *Metas da família*`, ``, ...lines].join('\n\n');
}

// ── Ajuda ─────────────────────────────────────────

export const HELP_MESSAGE = [
  `🤖 *FamilyFinance Bot*`,
  ``,
  `Manda uma mensagem como:`,
  `  _"gastei 45 no uber"_`,
  `  _"recebi 6800 de salário"_`,
  `  _"comprei 189 no mercado"_`,
  ``,
  `*Comandos disponíveis:*`,
  `  /resumo — saldo e gastos do mês`,
  `  /metas  — progresso das metas`,
  `  /editar — apagar último lançamento`,
  `  /ajuda  — esta mensagem`,
].join('\n');

// ── Helpers ───────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR');
}

function progressBar(pct: number, length = 10): string {
  const filled = Math.round((pct / 100) * length);
  return '▓'.repeat(filled) + '░'.repeat(length - filled);
}
