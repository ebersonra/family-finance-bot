# Changelog

Todas as mudanças notáveis neste projeto são documentadas aqui.  
Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/).

---

## [Não lançado]

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
