// ─────────────────────────────────────────────
// FamilyFinanceBot · Types
// ─────────────────────────────────────────────

export type CategoryId =
  | 'food'
  | 'home'
  | 'transport'
  | 'health'
  | 'leisure'
  | 'education'
  | 'income'
  | 'other';

export interface ParsedTransaction {
  amount: number;          // negativo = gasto, positivo = entrada
  category: CategoryId;
  name: string;
  date: string;            // ISO 8601 (YYYY-MM-DD)
  confidence: number;      // 0–1
  ambiguous?: boolean;     // true se precisar de confirmação
  ambiguityReason?: string;
}

/** Membro da família vinculado a um user_id do sistema */
export interface Member {
  id: string;        // ID do perfil family-finance-member
  userId: string;    // UUID do usuário autenticado (user-auth)
  name: string;
  phone: string;     // Ex: "5511999998888"
  /**
   * UUID do grupo familiar principal — resolvido no passo 3 do boot:
   * findUserByPhone → getMemberProfile → getGroups → family_id
   * Obrigatório para todas as chamadas /family-finance-*.
   */
  familyId: string;
}

export interface BotContext {
  phone: string;
  member: Member;
  lastTransaction?: ParsedTransaction;
  awaitingConfirmation?: ParsedTransaction;
}

export type CommandType =
  | 'transaction'   // mensagem financeira normal
  | 'confirm'       // "sim", "confirmar"
  | 'cancel'        // "não", "cancelar"
  | 'edit'          // "/editar"
  | 'summary'       // "/resumo"
  | 'goals'         // "/metas"
  | 'group'         // "/grupo" — gerenciar grupos familiares
  | 'members'       // "/membros" — listar membros do grupo
  | 'help'          // "/ajuda"
  | 'unknown';

// ── Modelos da API FamilyFinance ──────────────────

/** Perfil do membro retornado por /family-finance-member */
export interface FamilyMember {
  id: string;
  user_id: string;
  name: string;
  phone: string;
  created_at?: string;
}

/** Transação retornada por /family-finance-transactions */
export interface FamilyTransaction {
  id: string;
  member_id: string;
  user_id: string;
  name: string;
  amount: number;
  category: string;
  date: string;
  notes?: string;
  source: 'whatsapp' | 'app';
  created_at?: string;
}

/** Meta financeira retornada por /family-finance-goals */
export interface FamilyGoal {
  id: string;
  user_id?: string;
  label: string;
  target: number;
  saved: number;
  deadline: string;
  color?: string;
  progress_percent: number;
  remaining: number;
  created_at?: string;
}

/** Resumo mensal retornado por /family-finance-summary */
export interface ApiMonthlySummary {
  month: string;
  totals: {
    total_income: number;
    total_expenses: number;
    balance: number;
  };
  by_category: Array<{
    category: string;
    category_total: number;
  }>;
}

/** Usuário retornado por /user-auth */
export interface AuthUser {
  id: string;          // UUID do usuário
  name: string;
  phone: string;
  email?: string;
}

// ── Grupos Familiares ─────────────────────────────

/** Grupo familiar retornado por /family-finance-group */
export interface FamilyGroup {
  id: string;
  name: string;
  invite_code?: string;
  owner_member_id?: string;
  created_at?: string;
  /** Papel do usuário autenticado no grupo (owner | member) */
  role?: 'owner' | 'member';
  /** Lista de membros — presente apenas em GET com family_id */
  members?: FamilyGroupMember[];
}

/** Membro de um grupo familiar retornado por /family-finance-group-member */
export interface FamilyGroupMember {
  id: string;          // member_id
  name: string;
  phone?: string;
  role: 'owner' | 'member';
  joined_at?: string;
}
