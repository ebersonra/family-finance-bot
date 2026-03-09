# FamilyFinanceBot — Context & Architecture

> Documento vivo. Atualizar sempre que houver mudança de padrão, arquitetura ou regra crítica.

---

## 1. Visão Geral do Projeto

**FamilyFinanceBot** é um bot WhatsApp para registro de transações financeiras da família via linguagem natural.  
O usuário envia uma mensagem como _"gastei 45 no mercado"_ e o bot extrai, confirma e persiste a transação no banco.

### Stack Principal

| Camada          | Tecnologia                                |
|-----------------|-------------------------------------------|
| Protocolo       | WhatsApp (via `whatsapp-web.js`)          |
| Runtime         | Node.js 20+ / TypeScript                  |
| NLP             | Claude Haiku (`claude-haiku-4-5-20251001`)|
| Banco de dados  | Supabase (PostgreSQL)                     |
| Deploy          | Railway / Docker                          |

### Variáveis de Ambiente Obrigatórias

```env
ANTHROPIC_API_KEY=          # Chave da API Claude (Anthropic)
SUPABASE_URL=               # URL do projeto Supabase
SUPABASE_SERVICE_ROLE_KEY=  # Chave de serviço do Supabase (bypass de RLS)
ALLOWED_NUMBERS=            # Números autorizados separados por vírgula (ex: 5511999998888,5511977776666)
```

> 🔴 **O bot recusa qualquer número não listado em `ALLOWED_NUMBERS`.**

---

## 2. Arquitetura — Camadas (MVC-like)

```
src/
├── index.ts                    ← Entry Point & Bootstrap
├── types.ts                    ← Contratos TypeScript (interfaces/types globais)
├── handlers/
│   └── messageHandler.ts       ← Controller: orquestra toda lógica de mensagens
├── services/
│   ├── nlp.ts                  ← Service: Claude API (NLP / parsing)
│   └── supabase.ts             ← Service: Supabase (CRUD / queries)
└── utils/
    ├── classifier.ts           ← Utility: classifica o tipo de comando
    └── formatters.ts           ← Utility: formata respostas em texto para o WhatsApp
```

### Fluxo de uma Mensagem

```
[WhatsApp] → index.ts (evento 'message')
                 ↓
           messageHandler.ts
                 ↓
        classifyCommand() → CommandType
                 ↓
        ┌────────────────────────────────────┐
        │  'transaction'                     │
        │    → looksLikeTransaction() (guard)│
        │    → parseTransaction() [nlp.ts]   │
        │    → formatConfirmation()          │
        │    → session.awaitingConfirmation  │
        │                                    │
        │  'confirm'                         │
        │    → saveTransaction() [supabase]  │
        │    → formatSuccess()               │
        │                                    │
        │  'cancel' → limpa sessão           │
        │  'edit'   → deleteLastTransaction()│
        │  'summary'→ getMonthlySummary()    │
        │  'goals'  → getGoalsSummary()      │
        │  'help'   → HELP_MESSAGE           │
        └────────────────────────────────────┘
```

---

## 3. Gerenciamento de Estado (Sessões)

```typescript
// messageHandler.ts
const sessions = new Map<string, BotContext>();
```

- **In-memory Map** com chave = número de telefone (sem `@c.us`).
- Persiste entre mensagens do mesmo número enquanto o processo estiver ativo.
- 🔴 **Limitação:** estado perdido em restart. Para múltiplas instâncias, migrar para **Redis**.
- `BotContext` contém: `phone`, `member`, `lastTransaction?`, `awaitingConfirmation?`.

### Fluxo de Confirmação

1. Bot detecta transação → salva em `ctx.awaitingConfirmation` → pede confirmação.
2. Usuário responde "sim" → `handleConfirm()` → `saveTransaction()` → limpa `awaitingConfirmation`.
3. Usuário responde "não" → `handleCancel()` → limpa `awaitingConfirmation`.
4. Confiança < 0.7 ou `ambiguous: true` → **não entra no fluxo de confirmação** → pede reformulação.

---

## 4. Schema do Banco de Dados

> **Pré-requisito:** a tabela `public.users` já existe no Supabase (gerenciada pelo app principal).

### Diagrama de Relacionamentos

```
public.users  ──────────── (1:1, user_id UNIQUE) ──────────── members
                                                                  │
                                              (1:N, member_id FK)├──── transactions
                                                                  │
                                    (1:N, created_by_member_id FK)└──── goals  ← visível para toda a família
```

### Tabela: `public.users` (existente — referência)

| Coluna    | Tipo   | Notas relevantes para integração        |
|-----------|--------|-----------------------------------------|
| `id`      | `uuid` | Chave primária — referenciada em members |
| `name`    | `text` | Sincronizado em `members.name` via trigger |
| `phone`   | `text` | Sincronizado em `members.phone` via trigger |

### Tabela: `members`

| Coluna       | Tipo          | Notas                                      |
|--------------|---------------|--------------------------------------------|
| `id`         | `uuid` PK     | `gen_random_uuid()`                        |
| `user_id`    | `uuid` FK UNIQUE | 🔑 FK 1:1 para `public.users.id` (CASCADE) |
| `name`       | `text`        | Denormalizado de `users.name` — sync via trigger |
| `phone`      | `text` UNIQUE | Formato numérico puro: `"5511999998888"`   |
| `created_at` | `timestamptz` | `now()`                                    |

> **Regra:** não é possível criar um `member` sem um `users.id` válido.
> Para cadastrar: criar o usuário no Supabase Auth/app → depois inserir em `members`.

### Tabela: `transactions`

| Coluna       | Tipo          | Notas                                     |
|--------------|---------------|-------------------------------------------|
| `id`         | `uuid` PK     | `gen_random_uuid()`                       |
| `name`       | `text`        | Descrição legível (ex: "Uber", "Mercado") |
| `amount`     | `numeric`     | **Negativo = gasto · Positivo = entrada** |
| `category`   | `text`        | Ver enum de categorias abaixo             |
| `member_id`  | `uuid` FK     | Referência a `members.id` (CASCADE)       |
| `date`       | `date`        | Data da transação (YYYY-MM-DD)            |
| `source`     | `text`        | `'app'` ou `'whatsapp'`                   |
| `created_at` | `timestamptz` | `now()`                                   |

### Tabela: `goals`

| Coluna                | Tipo          | Notas                                       |
|-----------------------|---------------|---------------------------------------------|
| `id`                  | `uuid` PK     | `gen_random_uuid()`                         |
| `label`               | `text`        | Nome da meta                                |
| `emoji`               | `text`        | Emoji opcional                              |
| `target`              | `numeric`     | Valor alvo (> 0)                            |
| `saved`               | `numeric`     | Valor já acumulado (default 0, >= 0)        |
| `deadline`            | `text`        | Formato `'YYYY-MM'`                         |
| `color`               | `text`        | Cor hex opcional (`#RRGGBB`)                |
| `created_by_member_id`| `uuid` FK NULL| Membro criador — `SET NULL` se deletado     |
| `created_at`          | `timestamptz` | `now()`                                     |

> **Regra:** metas são **compartilhadas** pela família — todos os membros autenticados leem e editam.

---

## 5. Enum de Categorias

| ID           | Label exibido     | Exemplos de uso                                     |
|--------------|-------------------|-----------------------------------------------------|
| `food`       | 🛒 Alimentação    | mercado, ifood, restaurante, padaria, almoço        |
| `home`       | 🏠 Casa           | aluguel, condomínio, energia, internet, reforma     |
| `transport`  | 🚗 Transporte     | uber, gasolina, estacionamento, metrô, pedágio      |
| `health`     | 💊 Saúde          | farmácia, médico, academia, plano de saúde, exame   |
| `leisure`    | 🎬 Lazer          | netflix, cinema, viagem, barzinho, jogo             |
| `education`  | 📚 Educação       | escola, faculdade, curso, livro                     |
| `income`     | 💰 Renda          | salário, freelance, pix recebido, dividendo         |
| `other`      | 📦 Outros         | fallback para itens não classificados               |

---

## 6. NLP — Contrato com Claude API

**Modelo:** `claude-haiku-4-5-20251001`  
**Max tokens:** 256  
**Retorno esperado:** JSON puro, sem markdown.

```typescript
interface ParsedTransaction {
  amount: number;          // negativo = gasto, positivo = entrada
  category: CategoryId;   // enum acima
  name: string;            // máx 40 chars, capitalizado
  date: string;            // YYYY-MM-DD
  confidence: number;      // 0.0 – 1.0
  ambiguous?: boolean;     // true → não salvar, pedir reformulação
  ambiguityReason?: string;
}
```

### Regra de Confiança

| Condição                             | Ação                                     |
|--------------------------------------|------------------------------------------|
| `confidence >= 0.7` e `!ambiguous`  | Entra no fluxo de confirmação            |
| `confidence < 0.7` ou `ambiguous`   | Responde com `formatAmbiguity()` e para  |
| Falha no parse / JSON inválido       | `parseTransaction()` retorna `null`      |

---

## 7. Padrões de Código

### Nomenclatura

| Contexto           | Padrão           | Exemplo                        |
|--------------------|------------------|--------------------------------|
| Variáveis/funções  | `camelCase`      | `handleMessage`, `totalIncome` |
| Tipos/Interfaces   | `PascalCase`     | `ParsedTransaction`, `Member`  |
| Constantes         | `SCREAMING_SNAKE`| `ALLOWED_NUMBERS`, `HELP_MESSAGE`|
| Arquivos           | `camelCase.ts`   | `messageHandler.ts`, `nlp.ts`  |

### Organização de Imports

```typescript
// 1. Bibliotecas externas
import { Client } from 'whatsapp-web.js';
// 2. Tipos locais
import type { BotContext } from '../types';
// 3. Services
import { saveTransaction } from '../services/supabase';
// 4. Utils
import { classifyCommand } from '../utils/classifier';
```

### Tratamento de Erros

- Erros de banco são logados com `[Supabase]` prefix: `console.error('[Supabase] ...')`.
- Erros de NLP logados com `[NLP]` prefix: `console.error('[NLP] ...')`.
- Erros genéricos do handler logados com `[Bot]` prefix.
- **Nunca** expor stack traces ao usuário final — responder com mensagem amigável.

### Respostas ao Usuário (WhatsApp Markdown)

- Usar `*texto*` para negrito.
- Usar `_texto_` para itálico.
- Emojis como prefixo visual de contexto (✅ = sucesso, ❌ = erro, ⚠️ = aviso, 🤔 = dúvida).
- Listas com `•` ou numeração simples.

---

## 8. Segurança

### Modelo de Autenticação

> 🔴 **Este projeto usa AUTENTICAÇÃO CUSTOMIZADA** via `public.users` (phone + name).
> **NÃO** usa `auth.uid()` do Supabase Auth.
> Referência: OWASP A01:2021 – Broken Access Control (CWE-284)

O `user_id` autenticado é propagado para as políticas RLS via variável de sessão PostgreSQL:

```sql
-- Chamada obrigatória antes de qualquer operação que dependa de RLS
SELECT exec_with_user_context('<user-uuid>');
-- Internamente executa: SET LOCAL app.current_user_id = 'user-uuid';
```

### Funções de Autenticação (definidas no banco)

| Função                                 | Tipo               | Descrição                                                     |
|--------------------------------------|--------------------|---------------------------------------------------------------|
| `get_current_user_id()`              | `SECURITY DEFINER` | Lê `app.current_user_id`, valida `is_active=TRUE` e `deleted_at IS NULL`, retorna UUID ou NULL |
| `exec_with_user_context(UUID, TEXT)` | `SECURITY DEFINER` | Valida o usuário e executa `SET LOCAL app.current_user_id`. GRANT só para `authenticated` |

**Regra crítica:** `get_current_user_id()` retorna `NULL` se:
- Contexto não definido (`app.current_user_id` vazio)
- UUID inválido
- Usuário com `is_active = FALSE`
- Usuário com `deleted_at IS NOT NULL`

Retornar NULL bloqueia automaticamente o acesso via RLS.

### Regras de Segurança Aplicadas

| Regra                                              | Implementação                                                |
|----------------------------------------------------|-----------------------------------------------------------|
| Autorização por número de telefone (bot)          | `ALLOWED_NUMBERS` comparado em `Set`                      |
| Mensagens de grupos ignoradas                      | `msg.from.endsWith('@g.us')` → return                     |
| Mensagens do próprio bot ignoradas                 | `msg.fromMe` → return                                     |
| Credenciais nunca no código                        | Somente via variáveis de ambiente                         |
| Sessão WhatsApp local                              | `.wwebjs_auth/` (no `.gitignore`)                         |
| Supabase com `service_role` key (bot)              | Bypassa RLS — nunca expor ao cliente                      |
| Validação mínima do JSON retornado pelo Claude     | Verifica `amount`, `category`, `name`                     |
| RLS `members`: isolado por usuário                 | `user_id = get_current_user_id()`                         |
| RLS `members` UPDATE: impede transferência de ownership | `WITH CHECK(user_id = get_current_user_id())`         |
| RLS `transactions`: isolado por usuário            | `EXISTS (SELECT 1 FROM members WHERE id = member_id AND user_id = get_current_user_id())` |
| RLS `transactions` UPDATE: impede reatribuição de `member_id` | `WITH CHECK` no USING e no novo valor        |
| RLS `goals`: compartilhado — família toda          | `get_current_user_id() IS NOT NULL`                       |
| Sync automático `users → members`                 | Trigger `trg_sync_member_from_user` (name, phone)         |
| Funções SECURITY DEFINER com ownership manual     | `fn_delete_last_whatsapp_transaction` verifica `get_current_user_id()` antes de deletar |
| GRANT de funções explícito                        | `authenticated` para funções expostas; nunca para `anon`  |
| Validação de usuários inativos/deletados           | `exec_with_user_context` e `get_current_user_id()` rejeitam `is_active=FALSE` ou `deleted_at IS NOT NULL` |

---

## 9. Comandos Disponíveis

| Input do usuário                 | Comando classificado | Handler          |
|----------------------------------|----------------------|------------------|
| `"gastei 45 no uber"`            | `transaction`        | `handleTransaction` |
| `sim` / `ok` / `confirmar`       | `confirm`            | `handleConfirm`  |
| `não` / `cancelar` / `errado`    | `cancel`             | `handleCancel`   |
| `/editar` / `/edit`              | `edit`               | `handleEdit`     |
| `/resumo` / `/summary`           | `summary`            | `handleSummary`  |
| `/metas` / `/goals`              | `goals`              | `handleGoals`    |
| `/ajuda` / `/help`               | `help`               | `HELP_MESSAGE`   |

---

## 10. Deploy

### Docker / Railway

```dockerfile
# Dockerfile presente na raiz do projeto
# Porta: sem servidor HTTP — processo persistente (long-running)
# Volume obrigatório: /app/.wwebjs_auth (sessão WhatsApp)
```

### Graceful Shutdown

```typescript
process.on('SIGINT', async () => {
  await client.destroy();
  process.exit(0);
});
```

### Reconexão Automática

```typescript
client.on('disconnected', (reason) => {
  setTimeout(() => client.initialize(), 5000);
});
```

---

## 11. Limitações Conhecidas e Débitos Técnicos

| Item                                    | Status     | Solução Sugerida                               |
|-----------------------------------------|------------|----------------------------------------------|
| Sessões em memória (Map)                | ⚠️ Débito  | Migrar para Redis                            |
| Sem testes automatizados                | ⚠️ Débito  | Adicionar Jest + mocks                       |
| `source` em `deleteLastTransaction`    | ℹ️ Nota    | Só apaga lançamentos via WhatsApp             |
| Sem rate limiting por número            | ⚠️ Débito  | Implementar throttle para evitar abuso       |
| Deadline de metas como `text`           | ℹ️ Nota    | Considerar migrar para `date` no futuro      |
| `members.phone` requer dígitos puros    | ℹ️ Nota    | Trigger converte automaticamente ao sync     |
| `app.current_user_id` limpo após COMMIT | ℹ️ Nota    | `SET LOCAL` garante escopo por transação     |

---

## 12. Funções e Triggers do Banco

| Nome                                         | Tipo                        | GRANT           | Descrição                                                            |
|----------------------------------------------|-----------------------------|-----------------|----------------------------------------------------------------------|
| `get_current_user_id()`                      | `SECURITY DEFINER STABLE`   | _(público)_     | Lê sessão, valida `is_active` e `deleted_at`, retorna UUID ou NULL     |
| `exec_with_user_context(UUID, TEXT)`         | `SECURITY DEFINER`          | `authenticated` | Define `app.current_user_id`; valida usuário ativo                    |
| `fn_sync_member_from_user()`                 | `SECURITY DEFINER` (trigger)| _(interno)_     | Sincroniza `name`/`phone` de `members` ao atualizar `users`          |
| `trg_sync_member_from_user`                  | Trigger                     | —               | `AFTER UPDATE OF name, phone ON public.users`                        |
| `fn_delete_last_whatsapp_transaction(UUID)`  | `SECURITY DEFINER`          | `authenticated` | Valida ownership manualmente; remove último lançamento WhatsApp        |
| `fn_monthly_summary(DATE)`                   | `STABLE` (sem SECURITY DEFINER) | `authenticated` | Resumo mensal; respeita RLS via contexto de sessão           |

### Views disponíveis

| View                       | Descrição                                              |
|----------------------------|---------------------------------------------------------|
| `v_monthly_summary`        | Agregado mensal por categoria, `member_id` e `user_id`  |
| `v_current_month_summary`  | Mesmo que acima, filtrado para o mês corrente           |

---

## 13. Padrões de Banco de Dados (DBA)

### Autenticação Customizada via Variável de Sessão

O projeto **não usa `auth.uid()`** do Supabase Auth. O padrão adotado propaga o `user_id` via variável de sessão PostgreSQL com escopo de transação:

```sql
-- 1. Aplicativo define contexto antes de qualquer query
SELECT exec_with_user_context('<user-uuid>', 'operacao');

-- 2. Internamente: SET LOCAL app.current_user_id = '<user-uuid>'
-- 3. get_current_user_id() lê e valida o contexto em cada policy
-- 4. Após COMMIT, contexto é limpo automaticamente (SET LOCAL)
```

> **Atenção:** a migração `202512090001/add_demo_user_fields.sql` sobreescreveu
> `get_current_user_id()` com uma versão simplificada que não valida `is_active` nem `deleted_at`.
> O script `init.sql` (migração `202603090145`) restaura a versão completa.
> **Sempre garantir que a versão completa esteja ativa após qualquer migração.**

### Padrões de RLS

| Cenário                   | Padrão usado                          | Expresssão de exemplo                                          |
|---------------------------|---------------------------------------|---------------------------------------------------------------|
| Recurso próprio           | Comparação direta                    | `user_id = get_current_user_id()`                             |
| Recurso via tabela pai    | Subquery `EXISTS`                     | `EXISTS (SELECT 1 FROM members WHERE id = member_id AND user_id = get_current_user_id())` |
| Recurso compartilhado     | Verifica contexto presente            | `get_current_user_id() IS NOT NULL`                           |
| UPDATE sem transferência  | `USING` + `WITH CHECK` idênticos     | impede mudar `user_id` ou `member_id` para outro dono         |

### Regras de GRANT

- Funções RPC expostas ao cliente → `GRANT EXECUTE ... TO authenticated` (**nunca** `TO anon`)
- Funções internas / triggers → sem GRANT explícito
- `exec_with_user_context` e `fn_delete_last_whatsapp_transaction` só para `authenticated`
- `exec_with_user_context` **nunca** deve ser concedida a `anon` (permitiria impersonar qualquer usuário)

### SECURITY DEFINER com Validação Manual de Ownership

Funções `SECURITY DEFINER` bypassam RLS. Padrão obrigatório:

```sql
-- 1. Verificar contexto definido
v_caller_id := get_current_user_id();
IF v_caller_id IS NULL THEN
    RAISE EXCEPTION '...' USING HINT = 'Chame exec_with_user_context() antes';
END IF;

-- 2. Verificar que o recurso pertence ao chamador
SELECT user_id INTO v_owner FROM members WHERE id = p_member_id;
IF v_owner IS DISTINCT FROM v_caller_id THEN
    RAISE EXCEPTION 'Acesso negado'
        USING HINT = 'CWE-284: verifique se o recurso pertence ao usuário da sessão';
END IF;
```

### Bloco de Verificação Pós-Deploy

A seção 11 do `init.sql` contém um bloco `DO $$` que valida automaticamente:

- RLS habilitado em `members`, `transactions`, `goals`
- Mínimo de 4 políticas por tabela
- Existem `get_current_user_id()` e `exec_with_user_context()` no schema `public`

Após executar o script, verificar no log do Supabase SQL Editor:
```
✅ SUCESSO: RLS configurado corretamente com autenticação customizada
```
