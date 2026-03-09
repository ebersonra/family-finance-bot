# 🤖 FamilyFinanceBot

> Bot WhatsApp para registrar gastos e entradas da família via mensagem de texto.  
> Usa **whatsapp-web.js** + **Claude API (Haiku)** + **Supabase**.

---

## Como funciona

```
Você manda no WhatsApp:       Bot responde:
─────────────────────────     ──────────────────────────────────────────
"gastei 45 no uber"      →    📤 Saída detectada:
                              💸 Valor: -R$ 45,00
                              📂 Categoria: 🚗 Transporte
                              📝 Descrição: Uber
                              📅 Data: 08/03/2025
                              Confirmar? Responda sim ou não

"sim"                    →    ✅ Registrado! 🚗 Transporte · -R$ 45,00 · 08/03/2025

"recebi 6800 de salário" →    ✅ Registrado! 💰 Renda · +R$ 6.800,00 · 08/03/2025

"/resumo"                →    📊 Resumo de março 2025
                              📥 Entradas: R$ 12.400,00
                              📤 Saídas: R$ 4.792,00
                              💰 Saldo: +R$ 7.608,00
```

---

## Pré-requisitos

- Node.js 20+
- Chip/número de WhatsApp **dedicado** ao bot
- Conta no [Supabase](https://supabase.com) (banco de dados)
- Chave da [Claude API](https://console.anthropic.com) (Anthropic)

---

## Instalação

```bash
# 1. Instalar dependências
npm install

# 2. Configurar variáveis de ambiente
cp .env.example .env
# Preencha ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY e ALLOWED_NUMBERS

# 3. Rodar em modo desenvolvimento
npm run dev
```

Na primeira execução, um **QR code aparecerá no terminal**.  
Abra o WhatsApp do chip dedicado → toque nos 3 pontinhos → *Dispositivos conectados* → *Conectar dispositivo* → escaneie o QR.

A sessão é salva em `.wwebjs_auth/` — nas próximas execuções, o login é automático.

---

## Estrutura

```
FamilyFinanceBot/
├── src/
│   ├── index.ts                   # Entry point — inicializa o cliente WhatsApp
│   ├── types.ts                   # Interfaces TypeScript
│   ├── handlers/
│   │   └── messageHandler.ts      # Orquestra toda a lógica de mensagens
│   ├── services/
│   │   ├── nlp.ts                 # Claude API — interpreta linguagem natural
│   │   └── supabase.ts            # CRUD no banco de dados
│   └── utils/
│       ├── classifier.ts          # Classifica o tipo do comando
│       └── formatters.ts          # Formata as respostas do bot
├── Dockerfile                     # Deploy em Railway/Render
├── .env.example                   # Template de variáveis de ambiente
└── package.json
```

---

## Comandos disponíveis

| Comando | O que faz |
|---|---|
| `"gastei X em Y"` | Registra uma saída |
| `"recebi X de Y"` | Registra uma entrada |
| `sim` | Confirma lançamento pendente |
| `não` | Cancela lançamento pendente |
| `/resumo` | Saldo e top gastos do mês |
| `/metas` | Progresso das metas da família |
| `/editar` | Remove o último lançamento |
| `/ajuda` | Lista todos os comandos |

---

## Tabelas necessárias no Supabase

```sql
-- Membros da família
create table members (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text unique not null,   -- ex: "5511999998888"
  created_at timestamptz default now()
);

-- Transações
create table transactions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  amount numeric not null,      -- negativo = gasto, positivo = entrada
  category text not null,
  member_id uuid references members(id),
  date date not null,
  source text default 'app',    -- 'app' | 'whatsapp'
  created_at timestamptz default now()
);

-- Metas financeiras
create table goals (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  emoji text,
  target numeric not null,
  saved numeric not null default 0,
  deadline text not null,       -- 'YYYY-MM'
  color text,
  created_at timestamptz default now()
);
```

---

## Deploy no Railway

1. Faça push do projeto para um repositório GitHub
2. Acesse [railway.app](https://railway.app) → *New Project* → *Deploy from GitHub repo*
3. Adicione as variáveis de ambiente em *Variables*
4. **Importante:** Adicione um Volume persistente em `/app/.wwebjs_auth`  
   (sem isso, o QR code precisará ser reescaneado a cada deploy)
5. No primeiro deploy, veja os logs para escanear o QR code

```bash
# Ou via CLI do Railway
npm install -g @railway/cli
railway login
railway init
railway up
```

### Custo estimado no Railway
- Plano Hobby: ~$5/mês (suficiente para uso familiar)
- A Claude API (Haiku) custa ~$0,001 por mensagem processada

---

## Segurança

- ✅ Somente números listados em `ALLOWED_NUMBERS` são aceitos
- ✅ Mensagens de grupos são ignoradas
- ✅ A sessão do WhatsApp é armazenada localmente, nunca no código
- ✅ Credenciais apenas via variáveis de ambiente (nunca no repositório)
- ⚠️ Adicione `.wwebjs_auth/` ao `.gitignore` (já incluído)
