// ─────────────────────────────────────────────
// FamilyFinanceBot · Command Classifier
// ─────────────────────────────────────────────

import type { CommandType } from '../types';

const CONFIRM_PATTERNS = /^(sim|s|yes|confirmar|confirma|ok|isso|correto|certo)$/i;
const CANCEL_PATTERNS  = /^(não|nao|n|no|cancelar|cancela|errado|errada)$/i;

export function classifyCommand(text: string): CommandType {
  const clean = text.trim().toLowerCase();

  if (clean === '/ajuda' || clean === '/help')     return 'help';
  if (clean === '/resumo' || clean === '/summary') return 'summary';
  if (clean === '/metas' || clean === '/goals')    return 'goals';
  if (clean === '/editar' || clean === '/edit')    return 'edit';
  if (clean === '/grupo' || clean === '/group')    return 'group';
  if (clean === '/membros' || clean === '/members')return 'members';

  if (CONFIRM_PATTERNS.test(clean)) return 'confirm';
  if (CANCEL_PATTERNS.test(clean))  return 'cancel';

  // Qualquer outra coisa pode ser uma transação
  return 'transaction';
}
