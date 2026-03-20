// ─────────────────────────────────────────────
// FamilyFinanceBot · Formatters
// ─────────────────────────────────────────────

import type { ParsedTransaction, FamilyGoal, FamilyGroup, FamilyGroupMember, ApiMonthlySummary } from '../types';

// ── Categorias dinâmicas ──────────────────────────
// Aceita qualquer slug da API (bot ou mobile).
// A normalização remove acentos e separadores antes da lookup,
// resolvendo divergências de nomenclatura entre plataformas.
// Ex: credit_card (bot) === creditcard (mobile) → 💳 Cartão de Crédito
//     greengrocery (bot) === hortifruti (mobile) → 🥦 Hortifruti

interface CategoryMeta { emoji: string; label: string }

const CATEGORY_MAP: Record<string, CategoryMeta> = {
  // Alimentação genérica
  food:          { emoji: '🍕', label: 'Alimentação' },
  alimentacao:   { emoji: '🍕', label: 'Alimentação' },
  // Restaurante
  restaurant:    { emoji: '🍽️', label: 'Restaurante' },
  restaurante:   { emoji: '🍽️', label: 'Restaurante' },
  // Mercado / supermercado
  market:        { emoji: '🛒', label: 'Mercado' },
  mercado:       { emoji: '🛒', label: 'Mercado' },
  supermercado:  { emoji: '🛒', label: 'Mercado' },
  // Açougue
  butcher:       { emoji: '🥩', label: 'Açougue' },
  acougue:       { emoji: '🥩', label: 'Açougue' },
  // Peixaria
  fishmonger:    { emoji: '🐟', label: 'Peixaria' },
  peixaria:      { emoji: '🐟', label: 'Peixaria' },
  // Hortifruti  (bot: greengrocery · mobile: hortifruti)
  greengrocery:  { emoji: '🥦', label: 'Hortifruti' },
  hortifruti:    { emoji: '🥦', label: 'Hortifruti' },
  // Pet
  pet:           { emoji: '🐾', label: 'Pet' },
  petshop:       { emoji: '🐾', label: 'Pet' },
  // Delivery
  delivery:      { emoji: '🛵', label: 'Delivery' },
  // Pessoal / individual
  personal:      { emoji: '🪞', label: 'Pessoal' },
  pessoal:       { emoji: '🪞', label: 'Pessoal' },
  individual:    { emoji: '🪞', label: 'Pessoal' },
  // Casa
  home:          { emoji: '🏠', label: 'Casa' },
  casa:          { emoji: '🏠', label: 'Casa' },
  // Transporte
  transport:     { emoji: '🚗', label: 'Transporte' },
  transporte:    { emoji: '🚗', label: 'Transporte' },
  // Saúde
  health:        { emoji: '💊', label: 'Saúde' },
  saude:         { emoji: '💊', label: 'Saúde' },
  // Lazer
  leisure:       { emoji: '🎬', label: 'Lazer' },
  lazer:         { emoji: '🎬', label: 'Lazer' },
  // Educação
  education:     { emoji: '📚', label: 'Educação' },
  educacao:      { emoji: '📚', label: 'Educação' },
  // Renda / entrada
  income:        { emoji: '💰', label: 'Renda' },
  renda:         { emoji: '💰', label: 'Renda' },
  salario:       { emoji: '💰', label: 'Renda' },
  // Empréstimo / financiamento
  loan:          { emoji: '🏦', label: 'Empréstimo' },
  emprestimo:    { emoji: '🏦', label: 'Empréstimo' },
  financiamento: { emoji: '🏦', label: 'Financiamento' },
  // Cartão de crédito  (bot: credit_card · mobile: creditcard)
  creditcard:    { emoji: '💳', label: 'Cartão de Crédito' },
  cartao:        { emoji: '💳', label: 'Cartão de Crédito' },
  // Streaming
  streaming:     { emoji: '📺', label: 'Streaming' },
  // Outros
  other:         { emoji: '📦', label: 'Outros' },
  outros:        { emoji: '📦', label: 'Outros' },
};

/** Remove acentos, separadores e coloca em minúsculo para lookup uniforme. */
function normalizeCategory(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove diacríticos
    .replace(/[^a-z0-9]/g, '');      // remove separadores (_  -  espaço etc)
}

/** Retorna "{emoji} {Label legível}" para qualquer string de categoria da API. */
export function formatCategory(raw: string): string {
  const meta = CATEGORY_MAP[normalizeCategory(raw)];
  if (meta) return `${meta.emoji} ${meta.label}`;
  // Fallback: capitaliza o slug bruto sem quebrar a UI
  return '📋 ' + raw.replace(/[_-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

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
    `📂 *Categoria:* ${formatCategory(tx.category)}`,
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
  return `${emoji} Registrado! ${formatCategory(tx.category)} · *${value}* · ${formatDate(tx.date)}`;
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

export function formatSummary(summary: ApiMonthlySummary): string {
  const { totals, by_category, month } = summary;
  const { total_income, total_expenses, balance } = totals;

  // Mês formatado: "2026-03" → "março de 2026"
  const [year, monthNum] = month.split('-');
  const monthName = new Date(Number(year), Number(monthNum) - 1, 1)
    .toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

  // Todas as categorias com valor > 0, ordenadas do maior para o menor
  const topCategories = [...by_category]
    .filter((c) => c.category_total > 0)
    .sort((a, b) => b.category_total - a.category_total);

  const topLines = topCategories.map(
    (c, i) => `  ${i + 1}. ${formatCategory(c.category)}: *${fmt(c.category_total)}*`,
  );

  return [
    `📊 *Resumo de ${monthName}*`,
    ``,
    `📥 Entradas: *${fmt(total_income)}*`,
    `📤 Saídas:   *${fmt(total_expenses)}*`,
    `💰 Saldo:    *${balance >= 0 ? '+' : '-'}${fmt(balance)}*`,
    ``,
    topCategories.length > 0 ? `🏆 *Gastos por categoria:*` : '',
    ...topLines,
    ``,
    `_Abra o app para ver o detalhamento completo_`,
  ]
    .filter(Boolean)
    .join('\n');
}

// ── Metas ─────────────────────────────────────────

export function formatGoals(goals: FamilyGoal[]): string {
  if (goals.length === 0) {
    return '🎯 Nenhuma meta cadastrada ainda. Abra o app para criar!';
  }

  const lines = goals.map((g) => {
    const pct = g.progress_percent ?? Math.min(100, Math.round((g.saved / g.target) * 100));
    const bar = progressBar(pct);
    return `🎯 *${g.label}*\n  ${bar} ${pct}% · ${fmt(g.saved)} de ${fmt(g.target)} · prazo ${g.deadline}`;
  });

  return [`🎯 *Metas da família*`, ``, ...lines].join('\n\n');
}

// ── Grupos Familiares ─────────────────────────────

/** Lista todos os grupos familiares (resposta de /grupo sem family_id). */
export function formatGroups(groups: FamilyGroup[]): string {
  if (groups.length === 0) {
    return [
      '👨‍👩‍👧‍👦 Você ainda não pertence a nenhum grupo.',
      '',
      'Para criar um grupo, acesse o app FamilyFinance.',
    ].join('\n');
  }

  const lines = groups.map((g) => {
    const role = g.role === 'owner' ? '👑 dono' : '👤 membro';
    return `• *${g.name}* — ${role}`;
  });

  return [
    `👨‍👩‍👧‍👦 *Seus grupos (${groups.length}):*`,
    '',
    ...lines,
    '',
    '_Para ver os membros de um grupo, use /membros_',
  ].join('\n');
}

/** Detalha um grupo com lista de membros. */
export function formatGroup(group: FamilyGroup): string {
  const role = group.role === 'owner' ? ' 👑' : '';
  const header = [`👨‍👩‍👧‍👦 *${group.name}*${role}`];

  if (group.invite_code) {
    header.push(`🔑 Código de convite: \`${group.invite_code}\``);
  }

  const memberLines: string[] = [];
  if (group.members && group.members.length > 0) {
    memberLines.push('', '*Membros:*');
    group.members.forEach((m) => {
      const roleIcon = m.role === 'owner' ? '👑' : '👤';
      const displayName = m.name || `#${m.id.slice(0, 8)}`;
      memberLines.push(`  ${roleIcon} ${displayName}`);
    });
  }

  return [...header, ...memberLines].join('\n');
}

/** Lista membros de um grupo (resposta de /membros). */
export function formatGroupMembers(
  members: FamilyGroupMember[],
  groupName?: string,
): string {
  if (members.length === 0) {
    return '👤 Nenhum membro encontrado no grupo.';
  }

  const title = groupName
    ? `👥 *Membros de ${groupName} (${members.length}):*`
    : `👥 *Membros do grupo (${members.length}):*`;

  const lines = members.map((m) => {
    const roleIcon = m.role === 'owner' ? '👑' : '👤';
    const displayName = m.name || `#${m.id.slice(0, 8)}`;
    return `  ${roleIcon} *${displayName}*`;
  });

  return [title, '', ...lines].join('\n');
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
  `  /resumo   — saldo e gastos do mês`,
  `  /metas    — progresso das metas`,
  `  /grupo    — seus grupos familiares`,
  `  /membros  — membros do grupo ativo`,
  `  /editar   — apagar último lançamento`,
  `  /ajuda    — esta mensagem`,
].join('\n');

// ── Helpers ───────────────────────────────────────

function formatDate(iso: string): string {
  // Força o timezone de Brasília para evitar desvio de dia em servidores UTC
  return new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function progressBar(pct: number, length = 10): string {
  const filled = Math.round((pct / 100) * length);
  return '▓'.repeat(filled) + '░'.repeat(length - filled);
}
