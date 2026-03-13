// ─────────────────────────────────────────────
// FamilyFinanceBot · REST API Client
// Todos os endpoints roteiam via Bargainly API
// ─────────────────────────────────────────────
// Security: CWE-522 – credenciais nunca expostas no cliente
// OWASP A05:2021 – CORS gerido pelo wrapHandler server-side
// ─────────────────────────────────────────────

import type {
  AuthUser,
  FamilyMember,
  FamilyTransaction,
  FamilyGoal,
  FamilyGroup,
  FamilyGroupMember,
  ApiMonthlySummary,
} from '../types';

const BASE_URL = (process.env.API_BASE_URL ?? '').replace(/\/$/, '');

// ── Helpers internos ──────────────────────────────

/**
 * Executa uma requisição HTTP e garante resposta tipada.
 * Lança ApiError com status e mensagem em caso de falha.
 */
async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const url = `${BASE_URL}${path}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };

  const res = await fetch(url, { ...options, headers });

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = await res.json() as { message?: string; error?: string };
      message = body.message ?? body.error ?? message;
    } catch {
      // payload não é JSON — mantém mensagem padrão
    }
    throw new ApiError(res.status, message, path);
  }

  return res.json() as Promise<T>;
}

/** Serializa parâmetros de query, omitindo undefined/null */
function toQS(params: object): string {
  const qs = Object.entries(params as Record<string, unknown>)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  return qs ? `?${qs}` : '';
}

// ── Erro customizado ──────────────────────────────

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly endpoint: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// ═══════════════════════════════════════════════
// 1. GET USER BY PHONE  ·  GET /get-user-by-phone
// ─────────────────────────────────────────────
// Endpoint dedicado ao WhatsApp bot (tag: WhatsAppBot).
// Retorna apenas campos não-sensíveis: id, phone, email, name.
// - CWE-200: projeção mínima, nenhum dado crítico exposto
// - CWE-20:  telefone normalizado server-side (dígitos, 10-15 chars)
// - CWE-89:  RPC parametrizada no backend
// ═══════════════════════════════════════════════

/**
 * Busca o usuário pelo número de telefone via GET /get-user-by-phone.
 * Retorna null se o número não estiver cadastrado (HTTP 404).
 *
 * Aceita os formatos enviados pelo WhatsApp:
 * - `5541999999999`  (13 dígitos, BR internacional)
 * - `+5541999999999` (com prefixo `+`)
 * - `554199999 9999` (com espaços)
 *
 * @security Endpoint somente-leitura — nunca cria nem altera registros.
 */
export async function findUserByPhone(phone: string): Promise<AuthUser | null> {
  try {
    return await request<AuthUser>(`/get-user-by-phone${toQS({ phone })}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

// ═══════════════════════════════════════════════
// 2. MEMBER  ·  /family-finance-member
// ═══════════════════════════════════════════════

/**
 * GET /family-finance-member?user_id=<uuid>
 * Retorna o perfil do membro ou null se não cadastrado.
 */
export async function getMemberProfile(userId: string): Promise<FamilyMember | null> {
  try {
    return await request<FamilyMember>(
      `/family-finance-member${toQS({ user_id: userId })}`,
    );
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

/**
 * POST /family-finance-member
 * Cria ou atualiza (upsert) o perfil do membro.
 */
export async function upsertMemberProfile(data: {
  user_id: string;
  name: string;
  phone: string;
}): Promise<FamilyMember> {
  return request<FamilyMember>('/family-finance-member', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// ═══════════════════════════════════════════════
// 3. TRANSACTIONS  ·  /family-finance-transactions
// ═══════════════════════════════════════════════

export interface GetTransactionsParams {
  user_id: string;
  /** Filtra por grupo familiar */
  family_id?: string;
  category?: string;
  source?: 'whatsapp' | 'app';
  month?: string;     // YYYY-MM
  limit?: number;
  offset?: number;
}

/**
 * GET /family-finance-transactions
 * Lista transações com filtros opcionais.
 */
export async function getTransactions(
  params: GetTransactionsParams,
): Promise<FamilyTransaction[]> {
  return request<FamilyTransaction[]>(
    `/family-finance-transactions${toQS(params)}`,
  );
}

export interface CreateTransactionPayload {
  user_id: string;
  member_id: string;
  /** UUID do grupo familiar — obrigatório pelo novo fluxo */
  family_id: string;
  name: string;
  amount: number;       // negativo = despesa, positivo = receita
  category: string;
  date: string;         // YYYY-MM-DD
  notes?: string;
  source?: 'whatsapp' | 'app';
}

/**
 * POST /family-finance-transactions
 * Registra uma nova transação financeira.
 */
export async function createTransaction(
  payload: CreateTransactionPayload,
): Promise<FamilyTransaction> {
  return request<FamilyTransaction>('/family-finance-transactions', {
    method: 'POST',
    body: JSON.stringify({ source: 'whatsapp', ...payload }),
  });
}

// ═══════════════════════════════════════════════
// 4. DELETE LAST TRANSACTION
//    DELETE /family-finance-delete-last-transaction
// ═══════════════════════════════════════════════

export interface DeleteLastTransactionResult {
  deleted: boolean;
  message?: string;
}

/**
 * DELETE /family-finance-delete-last-transaction
 * Remove a transação WhatsApp mais recente do membro.
 * Retorna false se nenhuma transação for encontrada.
 */
export async function deleteLastWhatsAppTransaction(
  userId: string,
  memberId: string,
  familyId: string,
): Promise<DeleteLastTransactionResult> {
  try {
    return await request<DeleteLastTransactionResult>(
      `/family-finance-delete-last-transaction${toQS({ user_id: userId, member_id: memberId, family_id: familyId })}`,
      { method: 'DELETE' },
    );
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      return { deleted: false, message: 'Nenhuma transação WhatsApp encontrada.' };
    }
    throw err;
  }
}

// ═══════════════════════════════════════════════
// 5. GOALS  ·  /family-finance-goals
// ═══════════════════════════════════════════════

/**
 * GET /family-finance-goals?user_id=<uuid>&family_id=<uuid>
 * Lista metas compartilhadas da família com progress_percent e remaining.
 */
export async function getGoals(userId: string, familyId: string): Promise<FamilyGoal[]> {
  return request<FamilyGoal[]>(
    `/family-finance-goals${toQS({ user_id: userId, family_id: familyId })}`,
  );
}

export interface CreateGoalPayload {
  user_id: string;
  /** UUID do grupo familiar — obrigatório pelo novo fluxo */
  family_id: string;
  label: string;
  target: number;
  deadline: string;   // ex: "2026-12"
  saved?: number;
  color?: string;
}

/**
 * POST /family-finance-goals
 * Cria uma nova meta financeira.
 */
export async function createGoal(payload: CreateGoalPayload): Promise<FamilyGoal> {
  return request<FamilyGoal>('/family-finance-goals', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export interface UpdateGoalPayload {
  user_id: string;
  /** UUID do grupo familiar — obrigatório pelo novo fluxo */
  family_id: string;
  label?: string;
  target?: number;
  saved?: number;
  deadline?: string;
  color?: string;
}

/**
 * PUT /family-finance-goals?goal_id=<uuid>
 * Atualiza campos permitidos de uma meta existente.
 * Campos imutáveis: id, created_at, created_by_member_id.
 */
export async function updateGoal(
  goalId: string,
  payload: UpdateGoalPayload,
): Promise<FamilyGoal> {
  return request<FamilyGoal>(
    `/family-finance-goals${toQS({ goal_id: goalId })}`,
    {
      method: 'PUT',
      body: JSON.stringify(payload),
    },
  );
}

/**
 * DELETE /family-finance-goals?user_id=<uuid>&goal_id=<uuid>&family_id=<uuid>
 * Remove uma meta da família.
 */
export async function deleteGoal(
  userId: string,
  goalId: string,
  familyId: string,
): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>(
    `/family-finance-goals${toQS({ user_id: userId, goal_id: goalId, family_id: familyId })}`,
    { method: 'DELETE' },
  );
}

// ═══════════════════════════════════════════════
// 6. SUMMARY  ·  GET /family-finance-summary
// ═══════════════════════════════════════════════

/**
 * GET /family-finance-summary?user_id=<uuid>&month=<YYYY-MM>&family_id=<uuid>
 * Retorna totais de receita/despesas/saldo e breakdown por categoria.
 *
 * @param userId   UUID do usuário autenticado
 * @param month    Mês no formato YYYY-MM (padrão: mês atual)
 * @param familyId UUID do grupo familiar (opcional)
 */
export async function getMonthlySummary(
  userId: string,
  month?: string,
  familyId?: string,
): Promise<ApiMonthlySummary> {
  return request<ApiMonthlySummary>(
    `/family-finance-summary${toQS({ user_id: userId, month, family_id: familyId })}`,
  );
}

// ═══════════════════════════════════════════════
// 7. FAMILY GROUPS  ·  /family-finance-group
// ─────────────────────────────────────────────
// GET  ?user_id              → lista todos os grupos do usuário
// GET  ?user_id&family_id    → detalha um grupo com membros
// POST { user_id, name }     → cria novo grupo
// POST { user_id, invite_code } → entrar via código de convite
// PUT  ?family_id body { user_id, name } → renomear (owner only)
// DELETE ?user_id&family_id  → deletar grupo (owner only)
// DELETE ?user_id&family_id&action=leave → sair do grupo
// ═══════════════════════════════════════════════

/**
 * GET /family-finance-group?user_id=<uuid>
 * Lista todos os grupos familiares que o usuário pertence.
 */
export async function getGroups(userId: string): Promise<FamilyGroup[]> {
  return request<FamilyGroup[]>(
    `/family-finance-group${toQS({ user_id: userId })}`,
  );
}

/**
 * GET /family-finance-group?user_id=<uuid>&family_id=<uuid>
 * Retorna um grupo específico com a lista completa de membros.
 * Normaliza o array `members` caso venha com relação PostgREST aninhada.
 */
export async function getGroup(
  userId: string,
  familyId: string,
): Promise<FamilyGroup> {
  const group = await request<FamilyGroup & { members?: RawGroupMember[] }>(
    `/family-finance-group${toQS({ user_id: userId, family_id: familyId })}`,
  );
  if (Array.isArray(group.members)) {
    return { ...group, members: group.members.map(normalizeGroupMember) };
  }
  return group;
}

/**
 * POST /family-finance-group  body: { user_id, name }
 * Cria um novo grupo familiar. O criador torna-se owner e primeiro membro.
 */
export async function createGroup(
  userId: string,
  name: string,
): Promise<FamilyGroup> {
  return request<FamilyGroup>('/family-finance-group', {
    method: 'POST',
    body: JSON.stringify({ user_id: userId, name }),
  });
}

/**
 * POST /family-finance-group  body: { user_id, invite_code }
 * Entra em um grupo existente via código de convite.
 */
export async function joinGroup(
  userId: string,
  inviteCode: string,
): Promise<FamilyGroup> {
  return request<FamilyGroup>('/family-finance-group', {
    method: 'POST',
    body: JSON.stringify({ user_id: userId, invite_code: inviteCode }),
  });
}

/**
 * PUT /family-finance-group?family_id=<uuid>  body: { user_id, name }
 * Renomeia o grupo (somente owner).
 */
export async function renameGroup(
  familyId: string,
  userId: string,
  name: string,
): Promise<FamilyGroup> {
  return request<FamilyGroup>(
    `/family-finance-group${toQS({ family_id: familyId })}`,
    {
      method: 'PUT',
      body: JSON.stringify({ user_id: userId, name }),
    },
  );
}

/**
 * DELETE /family-finance-group?user_id=<uuid>&family_id=<uuid>
 * Deleta o grupo (somente owner). Remove todos os membros via CASCADE.
 */
export async function deleteGroup(
  userId: string,
  familyId: string,
): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>(
    `/family-finance-group${toQS({ user_id: userId, family_id: familyId })}`,
    { method: 'DELETE' },
  );
}

/**
 * DELETE /family-finance-group?user_id=<uuid>&family_id=<uuid>&action=leave
 * Sai de um grupo (qualquer membro; owner deve transferir ownership antes).
 */
export async function leaveGroup(
  userId: string,
  familyId: string,
): Promise<{ left: boolean }> {
  return request<{ left: boolean }>(
    `/family-finance-group${toQS({ user_id: userId, family_id: familyId, action: 'leave' })}`,
    { method: 'DELETE' },
  );
}

// ═══════════════════════════════════════════════
// 8. GROUP MEMBERS  ·  /family-finance-group-member
// ─────────────────────────────────────────────
// GET    ?user_id&family_id              → lista membros
// POST   { user_id, family_id, phone }   → adiciona membro por WhatsApp (owner)
// PUT    { user_id, family_id, member_id } → promove a owner (owner)
// DELETE ?user_id&family_id&member_id     → remove membro (owner)
// ═══════════════════════════════════════════════

/**
 * Shape bruta retornada pelo endpoint Supabase/PostgREST.
 * O join pode ser flat (campos no nível raiz) ou aninhado
 * (relação `members` embutida como objeto).
 *
 * Exemplos observados:
 *  - Flat:    { id, member_id, role, joined_at, name, phone }
 *  - Nested:  { id, role, joined_at, members: { id, name, phone } }
 */
interface RawGroupMember {
  id: string;
  member_id?: string;
  role: 'owner' | 'member';
  joined_at?: string;
  // campos presentes na resposta flat
  name?: string;
  phone?: string;
  // relação embutida pelo PostgREST (Supabase join)
  members?: {
    id?: string;
    name?: string;
    phone?: string;
  } | null;
}

/**
 * Normaliza um item bruto da API para FamilyGroupMember,
 * suportando tanto respostas flat quanto relações aninhadas.
 */
function normalizeGroupMember(raw: RawGroupMember): FamilyGroupMember {
  return {
    id:        raw.member_id ?? raw.members?.id ?? raw.id,
    name:      raw.name ?? raw.members?.name ?? '',
    phone:     raw.phone ?? raw.members?.phone,
    role:      raw.role,
    joined_at: raw.joined_at,
  };
}

/**
 * GET /family-finance-group-member?user_id=<uuid>&family_id=<uuid>
 * Lista todos os membros de um grupo (requer que o chamador seja membro).
 * Normaliza automaticamente respostas flat e aninhadas (PostgREST).
 */
export async function getGroupMembers(
  userId: string,
  familyId: string,
): Promise<FamilyGroupMember[]> {
  const raw = await request<RawGroupMember[]>(
    `/family-finance-group-member${toQS({ user_id: userId, family_id: familyId })}`,
  );
  return raw.map(normalizeGroupMember);
}

/**
 * POST /family-finance-group-member  body: { user_id, family_id, phone }
 * Adiciona um membro ao grupo pelo número de WhatsApp (somente owner).
 */
export async function addGroupMember(
  userId: string,
  familyId: string,
  phone: string,
): Promise<FamilyGroupMember> {
  return request<FamilyGroupMember>('/family-finance-group-member', {
    method: 'POST',
    body: JSON.stringify({ user_id: userId, family_id: familyId, phone }),
  });
}

/**
 * PUT /family-finance-group-member  body: { user_id, family_id, member_id }
 * Promove um membro a owner (somente owner atual).
 */
export async function promoteGroupMember(
  userId: string,
  familyId: string,
  memberId: string,
): Promise<FamilyGroupMember> {
  return request<FamilyGroupMember>('/family-finance-group-member', {
    method: 'PUT',
    body: JSON.stringify({ user_id: userId, family_id: familyId, member_id: memberId }),
  });
}

/**
 * DELETE /family-finance-group-member?user_id=<uuid>&family_id=<uuid>&member_id=<uuid>
 * Remove um membro do grupo (somente owner).
 */
export async function removeGroupMember(
  userId: string,
  familyId: string,
  memberId: string,
): Promise<{ removed: boolean }> {
  return request<{ removed: boolean }>(
    `/family-finance-group-member${toQS({ user_id: userId, family_id: familyId, member_id: memberId })}`,
    { method: 'DELETE' },
  );
}

// ═══════════════════════════════════════════════
// 9. MEMBER TRANSACTIONS  ·  /family-finance-member-transactions
// ─────────────────────────────────────────────
// GET ?user_id&member_id[&family_id][&category][&source][&month][&limit][&offset]
// Retorna transações de um membro específico, com filtragem opcional por família.
// ═══════════════════════════════════════════════

export interface GetMemberTransactionsParams {
  user_id: string;
  member_id: string;
  /** Escopo de família — restringe às transações dentro do grupo */
  family_id?: string;
  category?: string;
  source?: 'whatsapp' | 'app';
  month?: string;    // YYYY-MM
  limit?: number;
  offset?: number;
}

/**
 * GET /family-finance-member-transactions
 * Retorna transações de um membro específico com filtros opcionais.
 * Quando `family_id` é informado, verifica que ambos (caller + member)
 * pertencem ao grupo antes de retornar os dados (CWE-284).
 */
export async function getMemberTransactions(
  params: GetMemberTransactionsParams,
): Promise<FamilyTransaction[]> {
  return request<FamilyTransaction[]>(
    `/family-finance-member-transactions${toQS(params)}`,
  );
}
