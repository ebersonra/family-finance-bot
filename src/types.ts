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

export interface Member {
  id: string;
  name: string;
  phone: string;           // Ex: "5511999998888"
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
  | 'help'          // "/ajuda"
  | 'unknown';
