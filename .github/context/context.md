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

| Regra                                           | Implementação                                     |
|-------------------------------------------------|---------------------------------------------------|
| Autorização por número de telefone              | `ALLOWED_NUMBERS` comparado em `Set`              |
| Mensagens de grupos ignoradas                   | `msg.from.endsWith('@g.us')` → return             |
| Mensagens do próprio bot ignoradas              | `msg.fromMe` → return                             |
| Credenciais nunca no código                     | Somente via variáveis de ambiente                 |
| Sessão WhatsApp local                           | `.wwebjs_auth/` (no `.gitignore`)                 |
| Supabase com `service_role` key                 | Bypass de RLS — usar somente no backend (bot)     |
| Validação mínima do JSON retornado pelo Claude  | Verifica `amount`, `category`, `name`             |
| RLS `members`: cada usuário vê apenas o próprio | `user_id = auth.uid()`                            |
| RLS `transactions`: isolado por usuário          | Subquery `member_id IN (SELECT id FROM members WHERE user_id = auth.uid())` |
| RLS `goals`: compartilhado — família toda        | `auth.uid() IS NOT NULL`                          |
| Sync automático `users → members`               | Trigger `trg_sync_member_from_user` (name, phone) |

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

| Item                                  | Status     | Solução Sugerida                          |
|---------------------------------------|------------|-------------------------------------------|
| Sessões em memória (Map)              | ⚠️ Débito  | Migrar para Redis                         |
| Sem testes automatizados              | ⚠️ Débito  | Adicionar Jest + mocks                    |
| `source` em `deleteLastTransaction`  | ℹ️ Nota    | Só apaga lançamentos via WhatsApp         |
| Sem rate limiting por número          | ⚠️ Débito  | Implementar throttle para evitar abuso    |
| Deadline de metas como `text`         | ℹ️ Nota    | Considerar migrar para `date` no futuro   |
| `members.phone` requer dígitos puros  | ℹ️ Nota    | Trigger converte automaticamente ao sync  |

---

## 12. Funções e Triggers do Banco

| Nome                                    | Tipo      | Descrição                                                     |
|-----------------------------------------|-----------|---------------------------------------------------------------|
| `fn_sync_member_from_user()`            | Trigger   | Sincroniza `members.name` e `members.phone` após UPDATE em `users` |
| `trg_sync_member_from_user`             | Trigger   | Dispara `AFTER UPDATE OF name, phone ON public.users`        |
| `fn_delete_last_whatsapp_transaction()` | Function  | Remove último lançamento WhatsApp de um membro (server-side) |
| `fn_monthly_summary(p_month)`           | Function  | Resumo financeiro mensal com totais e breakdown por categoria |

### Views disponíveis

| View                        | Descrição                                              |
|-----------------------------|--------------------------------------------------------|
| `v_monthly_summary`         | Agregado mensal por categoria, `member_id` e `user_id` |
| `v_current_month_summary`   | Mesmo que acima, filtrado para o mês corrente          |
