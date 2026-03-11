# Changelog

Todas as mudanças notáveis neste projeto são documentadas aqui.  
Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/).

---

## [Não lançado]

---

## [1.4.0] — 2026-03-11

### Adicionado

#### Integração com novos endpoints `/family-finance-*`

**`src/types.ts`**
- `FamilyGroup` — representa um grupo familiar (`id`, `name`, `invite_code`, `role`, `members`).
- `FamilyGroupMember` — representa um membro dentro de um grupo (`id`, `name`, `role`, `joined_at`).
- `CommandType` expandido: `'group'` (`/grupo`) e `'members'` (`/membros`).
- `BotContext.activeGroup?: FamilyGroup` — grupo familiar ativo na sessão.

**`src/services/api.ts`**
- `getGroups(userId)` — `GET /family-finance-group`
- `getGroup(userId, familyId)` — `GET /family-finance-group?family_id=`
- `createGroup(userId, name)` — `POST /family-finance-group`
- `joinGroup(userId, inviteCode)` — `POST /family-finance-group` (via invite_code)
- `renameGroup(familyId, userId, name)` — `PUT /family-finance-group`
- `deleteGroup(userId, familyId)` — `DELETE /family-finance-group`
- `leaveGroup(userId, familyId)` — `DELETE /family-finance-group?action=leave`
- `getGroupMembers(userId, familyId)` — `GET /family-finance-group-member`
- `addGroupMember(userId, familyId, phone)` — `POST /family-finance-group-member`
- `promoteGroupMember(userId, familyId, memberId)` — `PUT /family-finance-group-member`
- `removeGroupMember(userId, familyId, memberId)` — `DELETE /family-finance-group-member`
- `getMemberTransactions(params)` — `GET /family-finance-member-transactions`
- `GetMemberTransactionsParams` — interface com `user_id`, `member_id`, `family_id?`, filtros
- `GetTransactionsParams.family_id?` — escopo de família adicionado
- `getMonthlySummary` — parâmetro `familyId?` adicionado (`/family-finance-summary`)

**`src/services/supabase.ts`**
- `getFamilyGroups`, `getFamilyGroup`, `createFamilyGroup`, `joinFamilyGroup`,
  `renameFamilyGroup`, `deleteFamilyGroup`, `leaveFamilyGroup` — wrappers de grupos
- `listGroupMembers`, `addMemberToGroup`, `removeMemberFromGroup` — wrappers de membros do grupo
- `getMemberTransactionHistory` — wrapper para `/family-finance-member-transactions`
- `getMonthlySummary` — aceita `familyId?` para filtrar resumo por grupo
- Re-exports: `FamilyGroup`, `FamilyGroupMember`, `GetMemberTransactionsParams`

**`src/utils/classifier.ts`**
- `/grupo` / `/group` → `'group'`
- `/membros` / `/members` → `'members'`

**`src/utils/formatters.ts`**
- `formatGroups(groups)` — lista grupos do usuário
- `formatGroup(group)` — detalha grupo com seus membros
- `formatGroupMembers(members, groupName?)` — lista membros de um grupo
- `HELP_MESSAGE` atualizado com `/grupo` e `/membros`

**`src/handlers/messageHandler.ts`**
- `handleGroup` — exibe grupos e define `ctx.activeGroup`
- `handleMembers` — lista membros do grupo ativo (auto-carrega se necessário)
- `handleSummary` — passa `ctx.activeGroup?.id` para filtrar por família

---

## [1.3.0] — 2026-03-09

### Adicionado — `database/init.sql` (revisão DBA)

#### Autenticação customizada via variável de sessão PostgreSQL

O projeto adota autenticação própria via `public.users` (phone + name), **sem uso de `auth.uid()`** do Supabase Auth. O `user_id` é propagado com escopo de transação via `SET LOCAL app.current_user_id`.

**Nova função `get_current_user_id()` — `SECURITY DEFINER STABLE`**
- Lê `app.current_user_id` da sessão PostgreSQL.
- Valida que o usuário existe em `public.users` com `is_active = TRUE` e `deleted_at IS NULL`.
- Retorna `NULL` em qualquer condição inválida (contexto ausente, UUID inválido, usuário inativo/deletado) — bloqueando o acesso via RLS automaticamente.
- **Nota de migração:** a migração `202512090001/add_demo_user_fields.sql` sobrescrevia esta função com versão simplificada sem essas validações. Esta versão (`202603090145`) é a canônica e deve ser restaurada após migrações que a sobrescrevam.

**Nova função RPC `exec_with_user_context(UUID, TEXT)` — `SECURITY DEFINER`**
- Ponto de entrada seguro para definir o contexto antes de queries com RLS.
- Valida o usuário (`is_active`, `deleted_at`) antes de executar `set_config('app.current_user_id', ..., true)` (escopo de transação).
- Retorna JSON com `success`, `user_id`, `operation` e `timestamp`.
- `GRANT EXECUTE TO authenticated` — **nunca** conceder a `anon`.

#### RLS completamente reescrito — autenticação customizada

| Tabela         | Padrão anterior (`auth.uid()`) | Padrão novo (`get_current_user_id()`)                            |
|----------------|-------------------------------|------------------------------------------------------------------|
| `members`      | `user_id = auth.uid()`        | `user_id = get_current_user_id()`                               |
| `members` UPDATE | sem `WITH CHECK`            | `USING` + `WITH CHECK` idênticos (impede transferência de ownership) |
| `transactions` | `member_id IN (SELECT ...)`   | `EXISTS (SELECT 1 FROM members WHERE id = member_id AND user_id = get_current_user_id())` |
| `transactions` UPDATE | sem `WITH CHECK`       | `USING` + `WITH CHECK` (impede reatribuição de `member_id`)     |
| `goals`        | `auth.uid() IS NOT NULL`      | `get_current_user_id() IS NOT NULL`                             |

- Adicionado `COMMENT ON POLICY` em todas as 12 políticas.
- Adicionado `COMMENT ON TABLE` com contexto de RLS nas tabelas `members`, `transactions` e `goals`.

#### Hardening de funções SECURITY DEFINER

**`fn_delete_last_whatsapp_transaction(UUID)`** — antes apagava sem validar quem chamava. Agora:
1. Chama `get_current_user_id()` — exception se contexto ausente.
2. Verifica que `members.user_id = v_caller_id` — exception com hint `CWE-284` se não pertencer.
3. `GRANT EXECUTE TO authenticated` adicionado.

**`fn_monthly_summary(DATE)`** — sem SECURITY DEFINER; por ser `STABLE` sem bypass, respeita RLS naturalmente. `GRANT EXECUTE TO authenticated` adicionado.

#### Bloco de verificação pós-deploy (Seção 11 do SQL)

Novo bloco `DO $$` que valida após cada execução:
- RLS habilitado nas 3 tabelas.
- Mínimo de 4 políticas por tabela.
- Funções `get_current_user_id()` e `exec_with_user_context()` presentes no schema `public`.
- Exibe `✅ SUCESSO` ou `⚠️ ATENÇÃO` no log do SQL Editor.

#### Diagrama de relacionamentos atualizado

Diagrama ao final do script expandido com fluxo completo de autenticação customizada e lista de funções `SECURITY DEFINER`.

### Adicionado — `.github/context/context.md`

- **Seção 8** completamente reescrita: modelo de autenticação customizada, funções do banco, regra de retorno NULL, tabela de regras expandida com 9 novas entradas de segurança.
- **Seção 11** (Débitos Técnicos): nova linha sobre escopo de `app.current_user_id`.
- **Seção 12** (Funções e Triggers): tabela expandida com colunas `GRANT` e detalhes de tipo (`SECURITY DEFINER`, `STABLE`).
- **Nova Seção 13** — Padrões de Banco de Dados (DBA): fluxo de autenticação, 4 padrões de RLS tabelados, regras de GRANT, padrão obrigatório para SECURITY DEFINER com ownership manual, e instruções do bloco de verificação pós-deploy.

### Corrigido

- Políticas RLS de `transactions` que no commit anterior tinham `SELECT 1 FROM members` sem cláusula `WHERE` (placeholder incompleto). Corrigido para `WHERE members.id = transactions.member_id AND members.user_id = get_current_user_id()`.

---

## [1.1.0] — 2026-03-09

### Adicionado

- **`database/init.sql`** — script SQL idempotente para inicialização completa do banco no Supabase.
  - Tabelas: `members`, `transactions`, `goals` com constraints, checks e comentários.
  - Views: `v_monthly_summary`, `v_current_month_summary`.
  - RLS (Row Level Security) habilitado em todas as tabelas.
  - Funções: `fn_delete_last_whatsapp_transaction`, `fn_monthly_summary`.
  - Seed inicial de meta financeira (condicional — só insere se banco estiver vazio).

- **`.github/context/context.md`** — documentação de arquitetura, padrões e regras do projeto.
  - Stack, variáveis de ambiente, fluxo de mensagens, schema do banco, enum de categorias,
    contrato NLP, padrões de código, segurança, comandos disponíveis, deploy e débitos técnicos.

---

## [1.2.0] — 2026-03-09

### Alterado

#### `database/init.sql` — Integração com `public.users`

**Tabela `members` — reestruturada (breaking change de schema)**

| Campo        | Antes                     | Depois                                                  |
|--------------|---------------------------|---------------------------------------------------------|
| Colunas      | `id`, `name`, `phone`, `created_at` | `id`, **`user_id`**, `name`, `phone`, `created_at` |
| `user_id`    | _(não existia)_           | `UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE` |
| `UNIQUE`     | `phone`                   | `phone` + **`user_id`** (garante 1:1 com `users`)       |
| Índices      | `idx_members_phone`       | `idx_members_phone` + **`idx_members_user_id`**          |

- Cardinalidade `users ↔ members` é agora **1:1** via `UNIQUE (user_id)`.
- `name` e `phone` em `members` passam a ser **campos denormalizados** de `users`, mantidos em sync via trigger.
- `ON DELETE CASCADE`: deletar o `user` remove automaticamente o `member` e todas as suas `transactions`.

**Tabela `goals` — adicionado rastreio de origem**

- Nova coluna `created_by_member_id UUID NULL REFERENCES members(id) ON DELETE SET NULL`.
- Metas continuam **compartilhadas** pela família (sem filtro por membro nas queries públicas).
- Novo índice: `idx_goals_created_by_member`.

**Views atualizadas**

- `v_monthly_summary` e `v_current_month_summary`: passam a expor `user_id` via `JOIN members m`.

**RLS reescrito — de `TRUE` para user-scoped**

| Tabela         | Política anterior              | Política nova                                                        |
|----------------|-------------------------------|----------------------------------------------------------------------|
| `members`      | `SELECT USING (TRUE)`         | SELECT / INSERT / UPDATE / DELETE com `user_id = auth.uid()`        |
| `transactions` | `SELECT/INSERT USING (TRUE)`  | Todas as operações filtradas por `member_id IN (SELECT id FROM members WHERE user_id = auth.uid())` |
| `goals`        | `SELECT/INSERT USING (TRUE)`  | Todas as operações com `auth.uid() IS NOT NULL` (família compartilha) |

**Seed corrigido**

- Removido `INSERT INTO members` órfão (incompatível com FK obrigatória `user_id`).
- Instrução de onboarding documentada em comentário no script.
- Meta inicial de seed agora calcula o deadline dinamicamente: `CURRENT_DATE + 9 meses`.

### Adicionado

#### `database/init.sql`

- **Trigger `trg_sync_member_from_user`** + função `fn_sync_member_from_user()`:
  - Dispara `AFTER UPDATE OF name, phone ON public.users`.
  - Mantém `members.name` e `members.phone` sincronizados automaticamente quando o usuário edita seu perfil.
  - Usa `REGEXP_REPLACE(phone, '\D', '', 'g')` para normalizar o telefone para o formato numérico exigido pelo bot.

- **Seção de diagrama de relacionamentos** ao final do script:
  ```
  public.users ──(1:1)── members ──(1:N)── transactions
                          members ──(1:N)── goals
  ```

#### `.github/context/context.md`

- Seção **4** atualizada com diagrama de relacionamentos, tabela `users` como referência, novo campo `user_id` em `members` e novo campo `created_by_member_id` em `goals`.
- Seção **8** (Segurança) atualizada com as novas políticas de RLS user-scoped e o trigger de sincronização.
- Seção **11** (Débitos Técnicos) atualizada com nota sobre conversão automática do phone.
- Nova seção **12** — Funções e Triggers do Banco com tabela de referência completa.

---

## Convenções deste arquivo

- `[Não lançado]` — mudanças em desenvolvimento, ainda não em produção.
- Versões seguem [SemVer](https://semver.org/lang/pt-BR/): `MAJOR.MINOR.PATCH`.
  - `MAJOR`: breaking change de API ou schema.
  - `MINOR`: nova funcionalidade retrocompatível.
  - `PATCH`: correção de bug ou ajuste sem impacto funcional.
- Categorias usadas: **Adicionado**, **Alterado**, **Removido**, **Corrigido**, **Segurança**.
