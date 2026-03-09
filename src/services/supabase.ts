// ─────────────────────────────────────────────
// FamilyFinanceBot · Data Service (API Layer)
// Substituição do cliente Supabase direto pelo
// consumo dos endpoints REST da Bargainly API.
// ─────────────────────────────────────────────

import type { Member, ParsedTransaction, FamilyGoal, ApiMonthlySummary } from '../types';
import {
  findUserByPhone,
  getMemberProfile,
  createTransaction,
  deleteLastWhatsAppTransaction,
  getMonthlySummary as apiGetMonthlySummary,
  getGoals,
} from './api';

// Aliases de tipo exportados para compatibilidade com formatters
export type { ApiMonthlySummary as MonthlySummary };
export type { FamilyGoal as GoalSummary };

// ── Membros ───────────────────────────────────────

/**
 * Busca o membro pelo número de telefone consultando:
 *  1. POST /user-auth (action: getOrCreate) → obtém o user_id
 *  2. GET  /family-finance-member?user_id=  → obtém o perfil do membro
 *
 * Retorna null se o usuário não existir ou não tiver perfil de finanças.
 *
 * @security Nunca cria usuário sem intenção explícita do app principal.
 *           O bot trabalha apenas com usuários já registrados.
 */
export async function getMemberByPhone(phone: string): Promise<Member | null> {
  // Passo 1: Buscar usuário autenticado pelo telefone
  const user = await findUserByPhone(phone);
  if (!user) return null;

  // Passo 2: Buscar perfil de finanças familiares
  const profile = await getMemberProfile(user.id);
  if (!profile) return null;

  return {
    id: profile.id,         // ID do perfil family-finance-member
    userId: user.id,        // UUID do usuário autenticado
    name: profile.name,
    phone: profile.phone,
  };
}

// ── Transações ────────────────────────────────────

/**
 * Salva uma transação via POST /family-finance-transactions.
 *
 * @param tx       Transação parseada pelo NLP
 * @param memberId ID do perfil family-finance-member
 * @param userId   UUID do usuário autenticado
 */
export async function saveTransaction(
  tx: ParsedTransaction,
  memberId: string,
  userId: string,
): Promise<{ id: string } | null> {
  try {
    const result = await createTransaction({
      user_id: userId,
      member_id: memberId,
      name: tx.name,
      amount: tx.amount,
      category: tx.category,
      date: tx.date,
      source: 'whatsapp',
    });
    return { id: result.id };
  } catch (err) {
    console.error('[API] Erro ao salvar transação:', (err as Error).message);
    return null;
  }
}

/**
 * Remove o último lançamento WhatsApp via
 * DELETE /family-finance-delete-last-transaction.
 *
 * @param memberId ID do perfil family-finance-member
 * @param userId   UUID do usuário autenticado
 */
export async function deleteLastTransaction(
  memberId: string,
  userId: string,
): Promise<boolean> {
  try {
    const result = await deleteLastWhatsAppTransaction(userId, memberId);
    return result.deleted;
  } catch (err) {
    console.error('[API] Erro ao deletar última transação:', (err as Error).message);
    return false;
  }
}

// ── Resumo mensal ─────────────────────────────────

/**
 * Retorna o resumo financeiro mensal via GET /family-finance-summary.
 *
 * @param userId UUID do usuário autenticado
 * @param month  Mês no formato YYYY-MM (padrão: mês atual)
 */
export async function getMonthlySummary(
  userId: string,
  month?: string,
): Promise<ApiMonthlySummary> {
  const currentMonth = month ?? new Date().toISOString().slice(0, 7);
  return apiGetMonthlySummary(userId, currentMonth);
}

// ── Metas ─────────────────────────────────────────

/**
 * Retorna todas as metas da família via GET /family-finance-goals.
 *
 * @param userId UUID do usuário autenticado
 */
export async function getGoalsSummary(userId: string): Promise<FamilyGoal[]> {
  return getGoals(userId);
}
