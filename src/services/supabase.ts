// ─────────────────────────────────────────────
// FamilyFinanceBot · Data Service (API Layer)
// Substituição do cliente Supabase direto pelo
// consumo dos endpoints REST da Bargainly API.
// ─────────────────────────────────────────────

import type { Member, ParsedTransaction, FamilyGoal, FamilyGroup, FamilyGroupMember, ApiMonthlySummary } from '../types';
import {
  findUserByPhone,
  getMemberProfile,
  createTransaction,
  deleteLastWhatsAppTransaction,
  getMonthlySummary as apiGetMonthlySummary,
  getGoals,
  getGroups,
  getGroup,
  createGroup,
  joinGroup,
  renameGroup,
  deleteGroup,
  leaveGroup,
  getGroupMembers,
  addGroupMember,
  removeGroupMember,
  getMemberTransactions,
  type GetMemberTransactionsParams,
} from './api';

// Aliases de tipo exportados para compatibilidade com formatters
export type { ApiMonthlySummary as MonthlySummary };
export type { FamilyGoal as GoalSummary };
export type { FamilyGroup, FamilyGroupMember };
export type { GetMemberTransactionsParams };

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
 * @param userId   UUID do usuário autenticado
 * @param month    Mês no formato YYYY-MM (padrão: mês atual)
 * @param familyId UUID do grupo familiar (opcional — filtra pelo grupo)
 */
export async function getMonthlySummary(
  userId: string,
  month?: string,
  familyId?: string,
): Promise<ApiMonthlySummary> {
  const currentMonth = month ?? new Date().toISOString().slice(0, 7);
  return apiGetMonthlySummary(userId, currentMonth, familyId);
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

// ── Grupos Familiares ─────────────────────────────

/**
 * Lista grupos familiares do usuário via GET /family-finance-group.
 */
export async function getFamilyGroups(userId: string): Promise<FamilyGroup[]> {
  try {
    return await getGroups(userId);
  } catch (err) {
    console.error('[API] Erro ao listar grupos:', (err as Error).message);
    return [];
  }
}

/**
 * Retorna um grupo familiar com membros via GET /family-finance-group?family_id=.
 */
export async function getFamilyGroup(
  userId: string,
  familyId: string,
): Promise<FamilyGroup | null> {
  try {
    return await getGroup(userId, familyId);
  } catch (err) {
    console.error('[API] Erro ao buscar grupo:', (err as Error).message);
    return null;
  }
}

/**
 * Cria um novo grupo familiar via POST /family-finance-group.
 */
export async function createFamilyGroup(
  userId: string,
  name: string,
): Promise<FamilyGroup | null> {
  try {
    return await createGroup(userId, name);
  } catch (err) {
    console.error('[API] Erro ao criar grupo:', (err as Error).message);
    return null;
  }
}

/**
 * Entra em um grupo via código de convite (POST /family-finance-group).
 */
export async function joinFamilyGroup(
  userId: string,
  inviteCode: string,
): Promise<FamilyGroup | null> {
  try {
    return await joinGroup(userId, inviteCode);
  } catch (err) {
    console.error('[API] Erro ao entrar no grupo:', (err as Error).message);
    return null;
  }
}

/**
 * Renomeia um grupo via PUT /family-finance-group (somente owner).
 */
export async function renameFamilyGroup(
  familyId: string,
  userId: string,
  name: string,
): Promise<FamilyGroup | null> {
  try {
    return await renameGroup(familyId, userId, name);
  } catch (err) {
    console.error('[API] Erro ao renomear grupo:', (err as Error).message);
    return null;
  }
}

/**
 * Deleta um grupo via DELETE /family-finance-group (somente owner).
 */
export async function deleteFamilyGroup(
  userId: string,
  familyId: string,
): Promise<boolean> {
  try {
    const result = await deleteGroup(userId, familyId);
    return result.deleted;
  } catch (err) {
    console.error('[API] Erro ao deletar grupo:', (err as Error).message);
    return false;
  }
}

/**
 * Sai de um grupo via DELETE /family-finance-group?action=leave.
 */
export async function leaveFamilyGroup(
  userId: string,
  familyId: string,
): Promise<boolean> {
  try {
    const result = await leaveGroup(userId, familyId);
    return result.left;
  } catch (err) {
    console.error('[API] Erro ao sair do grupo:', (err as Error).message);
    return false;
  }
}

// ── Membros do Grupo ──────────────────────────────

/**
 * Lista membros de um grupo via GET /family-finance-group-member.
 */
export async function listGroupMembers(
  userId: string,
  familyId: string,
): Promise<FamilyGroupMember[]> {
  try {
    return await getGroupMembers(userId, familyId);
  } catch (err) {
    console.error('[API] Erro ao listar membros:', (err as Error).message);
    return [];
  }
}

/**
 * Adiciona membro ao grupo por telefone via POST /family-finance-group-member.
 */
export async function addMemberToGroup(
  userId: string,
  familyId: string,
  phone: string,
): Promise<FamilyGroupMember | null> {
  try {
    return await addGroupMember(userId, familyId, phone);
  } catch (err) {
    console.error('[API] Erro ao adicionar membro:', (err as Error).message);
    return null;
  }
}

/**
 * Remove membro do grupo via DELETE /family-finance-group-member.
 */
export async function removeMemberFromGroup(
  userId: string,
  familyId: string,
  memberId: string,
): Promise<boolean> {
  try {
    const result = await removeGroupMember(userId, familyId, memberId);
    return result.removed;
  } catch (err) {
    console.error('[API] Erro ao remover membro:', (err as Error).message);
    return false;
  }
}

// ── Transações por Membro ─────────────────────────

/**
 * Retorna transações de um membro via GET /family-finance-member-transactions.
 * Quando `familyId` é passado, a API valida que o membro pertence ao grupo.
 */
export async function getMemberTransactionHistory(
  params: GetMemberTransactionsParams,
): Promise<import('../types').FamilyTransaction[]> {
  try {
    return await getMemberTransactions(params);
  } catch (err) {
    console.error('[API] Erro ao buscar transações do membro:', (err as Error).message);
    return [];
  }
}
