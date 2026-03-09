// ─────────────────────────────────────────────
// FamilyFinanceBot · Supabase Service
// ─────────────────────────────────────────────

import { createClient } from '@supabase/supabase-js';
import type { ParsedTransaction, Member } from '../types';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// ── Membros ───────────────────────────────────────

/**
 * Busca o membro pelo número de telefone.
 * Retorna null se o número não estiver cadastrado.
 */
export async function getMemberByPhone(phone: string): Promise<Member | null> {
  const { data, error } = await supabase
    .from('members')
    .select('id, name, phone')
    .eq('phone', phone)
    .single();

  if (error || !data) return null;
  return data as Member;
}

// ── Transações ────────────────────────────────────

/**
 * Salva uma transação no banco de dados.
 */
export async function saveTransaction(
  tx: ParsedTransaction,
  memberId: string,
): Promise<{ id: string } | null> {
  const { data, error } = await supabase
    .from('transactions')
    .insert({
      name: tx.name,
      amount: tx.amount,
      category: tx.category,
      member_id: memberId,
      date: tx.date,
      source: 'whatsapp',       // identifica a origem do lançamento
    })
    .select('id')
    .single();

  if (error) {
    console.error('[Supabase] Erro ao salvar transação:', error.message);
    return null;
  }

  return data;
}

/**
 * Remove o último lançamento feito via WhatsApp por um membro.
 * Usado no comando /editar.
 */
export async function deleteLastTransaction(memberId: string): Promise<boolean> {
  const { data } = await supabase
    .from('transactions')
    .select('id')
    .eq('member_id', memberId)
    .eq('source', 'whatsapp')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!data) return false;

  const { error } = await supabase
    .from('transactions')
    .delete()
    .eq('id', data.id);

  return !error;
}

// ── Resumo mensal ─────────────────────────────────

export interface MonthlySummary {
  totalIncome: number;
  totalExpenses: number;
  balance: number;
  topCategories: { category: string; total: number }[];
}

/**
 * Retorna o resumo financeiro do mês atual da família.
 */
export async function getMonthlySummary(): Promise<MonthlySummary> {
  const now = new Date();
  const startOfMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

  const { data } = await supabase
    .from('transactions')
    .select('amount, category')
    .gte('date', startOfMonth);

  const transactions = data ?? [];

  const totalIncome = transactions
    .filter((t) => t.amount > 0)
    .reduce((a, t) => a + t.amount, 0);

  const totalExpenses = transactions
    .filter((t) => t.amount < 0)
    .reduce((a, t) => a + Math.abs(t.amount), 0);

  // Agrupa despesas por categoria
  const categoryMap: Record<string, number> = {};
  for (const t of transactions.filter((t) => t.amount < 0)) {
    categoryMap[t.category] = (categoryMap[t.category] ?? 0) + Math.abs(t.amount);
  }

  const topCategories = Object.entries(categoryMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([category, total]) => ({ category, total }));

  return {
    totalIncome,
    totalExpenses,
    balance: totalIncome - totalExpenses,
    topCategories,
  };
}

// ── Metas ─────────────────────────────────────────

export interface GoalSummary {
  label: string;
  emoji?: string;
  saved: number;
  target: number;
  pct: number;
}

/**
 * Retorna todas as metas da família com percentual de progresso.
 */
export async function getGoalsSummary(): Promise<GoalSummary[]> {
  const { data } = await supabase
    .from('goals')
    .select('label, emoji, saved, target')
    .order('created_at', { ascending: true });

  return (data ?? []).map((g) => ({
    ...g,
    pct: Math.min(100, Math.round((g.saved / g.target) * 100)),
  }));
}
