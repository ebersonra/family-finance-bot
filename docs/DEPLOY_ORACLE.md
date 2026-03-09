# 🚀 Deploy do FamilyFinanceBot — Oracle Cloud Free Tier

> Guia completo para hospedar o bot gratuitamente para sempre.  
> Tempo estimado: 30–45 minutos na primeira vez.

---

## Por que Oracle Free Tier?

- ✅ **Gratuito para sempre** (not "free trial") — sem cartão bloqueado depois
- ✅ VM com 1 OCPU + 1 GB RAM — suficiente para o bot + Chromium
- ✅ 10 GB de armazenamento incluso (sessão WhatsApp persiste entre reinícios)
- ✅ IP fixo público incluso
- ⚠️ Requer cadastro com cartão de crédito (apenas para verificação — não cobra)

---

## Visão geral da arquitetura

```
Seu celular (chip dedicado)
        ↕ WhatsApp Web
    VM Oracle (Ubuntu 22.04)
        ├── Node.js 20
        ├── whatsapp-web.js (Chromium headless)
        ├── .wwebjs_auth/  ← sessão salva no disco
        └── PM2            ← mantém o bot vivo 24h

    Bot chama:
        ├── Claude API (Anthropic) — NLP
        └── Supabase — banco de dados compartilhado com o app
```

---

## Passo 1 — Criar conta na Oracle Cloud

1. Acesse [cloud.oracle.com](https://cloud.oracle.com) → **Start for free**
2. Preencha nome, e-mail, país **(selecione Brasil)**
3. Informe cartão de crédito (apenas verificação, **não será cobrado**)
4. Escolha a **Home Region** → selecione **Brazil East (São Paulo)**
   > ⚠️ A home region **não pode ser alterada depois**. Escolha São Paulo para menor latência.
5. Aguarde o e-mail de ativação (pode levar até 15 minutos)

---

## Passo 2 — Criar a VM (Compute Instance)

1. No painel Oracle, vá em **Compute → Instances → Create Instance**

2. Configure:

   | Campo | Valor |
   |---|---|
   | Nome | `family-finance-bot` |
   | Imagem | **Canonical Ubuntu 22.04** |
   | Shape | **VM.Standard.E2.1.Micro** ← este é o gratuito |
   | OCPU | 1 |
   | RAM | 1 GB |

3. **SSH Key** — gere ou use uma chave existente:
   ```bash
   # No seu computador (Mac/Linux):
   ssh-keygen -t ed25519 -C "oracle-bot" -f ~/.ssh/oracle_bot
   # Copie o conteúdo de ~/.ssh/oracle_bot.pub e cole na Oracle
   ```
   No Windows, use o Git Bash ou WSL para rodar o comando acima.

4. Clique em **Create** e aguarde a VM ficar com status **Running** (~2 minutos)

5. Anote o **IP Público** da VM (ex: `150.230.xx.xx`)

---

## Passo 3 — Liberar porta no firewall da Oracle

A Oracle tem um firewall próprio além do Ubuntu. Você precisa liberar a porta SSH.

1. Na VM criada, clique em **Subnet → Security List → Add Ingress Rule**
2. Adicione:

   | Campo | Valor |
   |---|---|
   | Source CIDR | `0.0.0.0/0` |
   | IP Protocol | TCP |
   | Destination Port | `22` |

> O bot não precisa de porta web pública — ele só faz conexões de saída para o WhatsApp.

---

## Passo 4 — Conectar na VM via SSH

```bash
# Substitua pelo IP público da sua VM
ssh -i ~/.ssh/oracle_bot ubuntu@150.230.xx.xx
```

Se pedir confirmação `(yes/no)`, digite `yes`.

---

## Passo 5 — Preparar o servidor

Cole os comandos abaixo **um bloco de cada vez** no terminal SSH:

### 5.1 — Atualizar o sistema
```bash
sudo apt update && sudo apt upgrade -y
```

### 5.2 — Instalar Node.js 20
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node --version   # deve mostrar v20.x.x
```

### 5.3 — Instalar dependências do Chromium (necessário para o whatsapp-web.js)
```bash
sudo apt install -y \
  chromium-browser \
  libatk1.0-0 \
  libatk-bridge2.0-0 \
  libcups2 \
  libdrm2 \
  libxkbcommon0 \
  libxcomposite1 \
  libxdamage1 \
  libxfixes3 \
  libxrandr2 \
  libgbm1 \
  libasound2 \
  fonts-liberation \
  xdg-utils
```

### 5.4 — Instalar PM2 (mantém o bot rodando 24h)
```bash
sudo npm install -g pm2
```

### 5.5 — Ajustar firewall do Ubuntu
```bash
sudo ufw allow ssh
sudo ufw enable
# Confirme com "y" se perguntar
```

---

## Passo 6 — Enviar o código do bot para a VM

**No seu computador local** (não no SSH), rode:

```bash
# Descompacte o FamilyFinanceBot.zip primeiro, depois envie a pasta:
scp -i ~/.ssh/oracle_bot -r ./FamilyFinanceBot ubuntu@150.230.xx.xx:~/
```

**De volta no SSH da VM:**

```bash
cd ~/FamilyFinanceBot
npm install
```

---

## Passo 7 — Configurar as variáveis de ambiente

```bash
cp .env.example .env
nano .env
```

Preencha o arquivo com suas credenciais:

```env
ANTHROPIC_API_KEY=sk-ant-...        # console.anthropic.com
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...    # supabase.com → Settings → API
ALLOWED_NUMBERS=5511999998888,5511988887777
NODE_ENV=production
```

Salve: `Ctrl+X` → `Y` → `Enter`

---

## Passo 8 — Informar o caminho do Chromium

O `whatsapp-web.js` precisa saber onde está o Chromium instalado no Ubuntu:

```bash
which chromium-browser   # vai retornar algo como /usr/bin/chromium-browser
```

Abra o arquivo `src/index.ts` e localize o bloco `puppeteer:` e adicione `executablePath`:

```bash
nano src/index.ts
```

```typescript
puppeteer: {
  headless: true,
  executablePath: '/usr/bin/chromium-browser',  // ← adicione esta linha
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--no-first-run',
    '--disable-gpu',
  ],
},
```

Salve: `Ctrl+X` → `Y` → `Enter`

---

## Passo 9 — Compilar o TypeScript

```bash
npm run build
# Gera a pasta dist/ com o JavaScript compilado
```

---

## Passo 10 — Primeira execução: escanear o QR code

```bash
node dist/index.js
```

Um QR code vai aparecer no terminal. Para escanear:

1. No celular com o **chip dedicado**, abra o WhatsApp
2. Toque nos **3 pontinhos** (canto superior direito)
3. Selecione **Dispositivos conectados**
4. Toque em **Conectar um dispositivo**
5. Escaneie o QR code

Você vai ver no terminal:
```
✅ WhatsApp autenticado com sucesso!
🤖 FamilyFinanceBot está online e pronto para receber mensagens!
```

Pressione `Ctrl+C` para parar. A sessão foi salva em `.wwebjs_auth/` — **não precisa escanear de novo**.

---

## Passo 11 — Rodar com PM2 (modo permanente)

```bash
# Iniciar o bot com PM2
pm2 start dist/index.js --name "family-finance-bot"

# Salvar para reiniciar automaticamente após reboot da VM
pm2 save
pm2 startup
# Copie e execute o comando que o PM2 mostrar (começa com "sudo env PATH=...")

# Ver status
pm2 status

# Ver logs em tempo real
pm2 logs family-finance-bot
```

---

## Passo 12 — Testar o bot

Mande uma mensagem do seu número (cadastrado em `ALLOWED_NUMBERS`) para o chip dedicado:

```
gastei 45 no uber
```

O bot deve responder em segundos com a confirmação da transação. ✅

---

## Comandos úteis do dia a dia

```bash
# Conectar na VM
ssh -i ~/.ssh/oracle_bot ubuntu@150.230.xx.xx

# Ver logs do bot
pm2 logs family-finance-bot

# Reiniciar o bot
pm2 restart family-finance-bot

# Parar o bot
pm2 stop family-finance-bot

# Atualizar o código (após mudanças)
cd ~/FamilyFinanceBot
# (envie os arquivos novos com scp)
npm run build
pm2 restart family-finance-bot
```

---

## Criar alias SSH para facilitar (opcional)

No seu computador, edite `~/.ssh/config`:

```
Host oracle-bot
  HostName 150.230.xx.xx
  User ubuntu
  IdentityFile ~/.ssh/oracle_bot
```

Depois é só rodar:
```bash
ssh oracle-bot
```

---

## Tabelas necessárias no Supabase

Se ainda não criou, rode este SQL no **Supabase → SQL Editor**:

```sql
-- Membros da família
create table if not exists members (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text unique not null,
  created_at timestamptz default now()
);

-- Transações
create table if not exists transactions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  amount numeric not null,
  category text not null,
  member_id uuid references members(id),
  date date not null,
  source text default 'app',
  created_at timestamptz default now()
);

-- Metas
create table if not exists goals (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  emoji text,
  target numeric not null,
  saved numeric not null default 0,
  deadline text not null,
  color text,
  created_at timestamptz default now()
);

-- Cadastrar os membros (substitua os números)
insert into members (name, phone) values
  ('Ana',   '5511999998888'),
  ('Pedro', '5511988887777');
```

---

## Resolução de problemas comuns

**Bot não responde:**
```bash
pm2 logs family-finance-bot --lines 50
# Procure por erros de autenticação ou timeout
```

**QR code expirou antes de escanear:**
```bash
pm2 stop family-finance-bot
rm -rf .wwebjs_auth/   # apaga a sessão antiga
node dist/index.js      # gera novo QR
# Escaneie e depois: pm2 start dist/index.js --name family-finance-bot
```

**Chromium não encontrado:**
```bash
which chromium-browser
which chromium
# Use o caminho retornado no executablePath do src/index.ts
```

**VM sem memória (1 GB pode ser justo com Chromium):**
```bash
# Criar swap de 1 GB para ajudar
sudo fallocate -l 1G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

---

## Custo total

| Serviço | Custo |
|---|---|
| Oracle VM | **Gratuito para sempre** |
| Supabase (Free tier) | **Gratuito** (500 MB, 50k linhas) |
| Claude API Haiku | ~$0,001/mensagem ≈ **< R$ 2/mês** para uso familiar |
| Netlify (que você já paga) | Sem alteração |
| **Total novo** | **~R$ 2/mês** |

---

*Guia gerado em Março 2025 · FamilyFinanceBot v1.0*
