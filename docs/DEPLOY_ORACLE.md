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
        ├── Node.js 24 LTS
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
   > ⚠️ Se aparecer apenas o IP privado `10.0.0.*`, o IP público não foi atribuído automaticamente.
   > Veja a seção **"IP público não aparece (só IP privado 10.0.0.*)"** em *Resolução de problemas* abaixo.

---

## Passo 3 — Liberar portas no firewall da Oracle

A Oracle tem um firewall próprio além do Ubuntu. Libere as seguintes portas:

1. Na VM criada, clique em **Subnet → Security List → Add Ingress Rule**
2. Adicione as regras abaixo (uma por vez):

   **Porta SSH (obrigatória):**
   | Campo | Valor |
   |---|---|
   | Source CIDR | `0.0.0.0/0` |
   | IP Protocol | TCP |
   | Destination Port | `22` |

   **Porta QR code — temporária** (apenas para o primeiro login):
   | Campo | Valor |
   |---|---|
   | Source CIDR | `0.0.0.0/0` |
   | IP Protocol | TCP |
   | Destination Port | `3000` |

> ⚠️ Após escanear o QR code e autenticar o WhatsApp (Passo 10), volte aqui e **remova a regra da porta 3000** por segurança.

---

## Passo 4 — Conectar na VM via SSH

```bash
# Substitua pelo IP público da sua VM
ssh -i ssh -i ~/.ssh/oracle_bot ubuntu@64.181.179.77
```

Se pedir confirmação `(yes/no)`, digite `yes`.

---

## Passo 5 — Preparar o servidor

Cole os comandos abaixo **um bloco de cada vez** no terminal SSH:

### 5.1 — Atualizar o sistema
```bash
sudo apt update && sudo apt upgrade -y
```

### 5.2 — Instalar Node.js 24
```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs
node --version   # deve mostrar v24.x.x
npm --version
```

### 5.3 — Instalar dependências do Chromium (necessário para o whatsapp-web.js)

> ⚠️ O nome do pacote de áudio varia conforme a versão do Ubuntu:
> - **Ubuntu 22.04** → `libasound2`
> - **Ubuntu 24.04+** → `libasound2t64` (foi renomeado)
>
> Verifique sua versão com `lsb_release -rs` e use o comando correspondente abaixo.

**Ubuntu 22.04:**
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

**Ubuntu 24.04+:**
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
  libasound2t64 \
  fonts-liberation \
  xdg-utils
```

### 5.4 — Instalar PM2 (mantém o bot rodando 24h)
```bash
sudo npm install -g pm2
```

### 5.5 — Ajustar firewall do Ubuntu
```bash
# Instalar o ufw (não vem pré-instalado em algumas imagens Oracle)
sudo apt install -y ufw
sudo ufw allow ssh
sudo ufw allow 3000/tcp   # temporário: servidor de QR code
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
CHROME_PATH=/usr/bin/chromium-browser  # ajuste com o retorno de: which chromium chromium-browser
```

Salve: `Ctrl+X` → `Y` → `Enter`

---

## Passo 8 — Informar o caminho do Chromium

Descubra onde o Chromium está instalado:

```bash
which chromium chromium-browser google-chrome google-chrome-stable 2>/dev/null
# Exemplo de retorno: /usr/bin/chromium-browser
```

Abra o `.env` e adicione a variável `CHROME_PATH` com o caminho retornado acima:

```bash
nano .env
```

```env
CHROME_PATH=/usr/bin/chromium-browser   # ajuste conforme o retorno do which
```

Salve: `Ctrl+X` → `Y` → `Enter`

> O bot lê `CHROME_PATH` automaticamente. Não é necessário editar nenhum arquivo de código.

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

O bot inicia dois métodos de QR code em paralelo:

**Método 1 — Browser (recomendado):**
1. No terminal aparecerá: `🌐 QR code disponível em: http://IP_DA_VM:3000`
2. No celular (qualquer browser), acesse `http://IP_DA_VM:3000`
   > Substitua `IP_DA_VM` pelo IP público da Oracle (ex: `150.230.xx.xx`)
3. Uma página com a imagem do QR aparecerá — escaneie normalmente pelo WhatsApp
4. A página recarrega automaticamente a cada 30s se o QR renovar

**Método 2 — Terminal (alternativo):**
1. O QR também aparece no terminal em texto
2. Maximize a janela SSH e reduza o zoom do terminal até o QR ficar legível

**Para escanear (ambos os métodos):**
1. No celular com o **chip dedicado**, abra o WhatsApp
2. Toque nos **3 pontinhos** (canto superior direito)
3. Selecione **Dispositivos conectados**
4. Toque em **Conectar um dispositivo**
5. Escaneie o QR code

Você verá no terminal:
```
✅ WhatsApp autenticado com sucesso!
🤖 FamilyFinanceBot está online e pronto para receber mensagens!
```

Pressione `Ctrl+C` para parar. A sessão foi salva em `.wwebjs_auth/` — **não precisa escanear de novo**.

> 🔒 **Após autenticar:** feche a porta 3000 no firewall da Oracle (Passo 3) e no Ubuntu:
> ```bash
> sudo ufw delete allow 3000/tcp
> ```

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

**IP público não aparece (só IP privado 10.0.0.*):**

A Oracle não atribui IP público automaticamente em algumas configurações. Para atribuir manualmente:

1. Vá em **Compute → Instances** → clique na VM criada
2. Role até **"Instance information"** → clique em **"Primary VNIC"**
3. Na tela do VNIC, clique na aba **"IPv4 addresses"**
4. Clique nos **3 pontos (⋮)** ao lado do IP privado `10.0.0.*`
5. Selecione **"Edit"**
6. Em **"Public IP type"**, selecione **"Ephemeral public IP"**
7. Clique em **"Update"** — o IP público será atribuído imediatamente

Anote o IP gerado e use nos próximos passos.

---

**Erro no `apt update/upgrade` — Permission denied (13) ou lock do dpkg:**

Causa mais comum: o comando foi rodado **sem `sudo`**, ou um processo automático de atualização ainda está em execução.

```bash
# 1. Certifique-se de usar sudo:
sudo apt update && sudo apt upgrade -y

# 2. Se o erro persistir, verifique se há outro processo apt rodando:
ps aux | grep -E 'apt|dpkg'

# 3. Aguarde o processo terminar OU encerre-o (substitua <PID>):
sudo kill -9 <PID>

# 4. Último recurso — remover locks manualmente:
sudo rm -f /var/lib/dpkg/lock-frontend
sudo rm -f /var/lib/dpkg/lock
sudo dpkg --configure -a

# 5. Tentar novamente:
sudo apt update && sudo apt upgrade -y
```

---

**Erro `Execution context was destroyed` ao inicializar:**

Causas conhecidas: WA Web navega para nova versão durante a injeção, ou incompatibilidade de contexto com Node.js v24+. O código já inclui três correções permanentes: `webVersionCache` (versão fixa do WA Web), `bypassCSP: true` e `--disable-features=IsolateOrigins,site-per-process`.

Se o erro ocorreu com código desatualizado na VM:

```bash
# 1. Garantir Node.js 24 instalado
node --version   # deve mostrar v24.x.x
# Se não: curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash - && sudo apt install -y nodejs

# 2. Atualizar o código (envie os arquivos com scp ou git pull)

# 3. Limpar cache stale e reinstalar
rm -rf .wwebjs_cache/ node_modules
npm install
npm run build

# 4. Rodar
node --no-deprecation dist/index.js
```

Se ainda falhar, apague a sessão completa e reautentique:
```bash
rm -rf .wwebjs_auth/ .wwebjs_cache/
node --no-deprecation dist/index.js   # escaneie o QR novamente
```

---

**Bot não responde:**
```bash
pm2 logs family-finance-bot --lines 50
# Procure por erros de autenticação ou timeout
```

**Erro `The browser is already running` ao iniciar o bot:**

Uma instância anterior do Chromium/Node ainda está rodando e segura o lock da sessão. Encerre os processos e reinicie:

```bash
# 1. Matar processos node e chromium em execução
pkill -f "node dist/index.js" ; pkill -f chromium ; pkill -f chrome

# 2. Confirmar que não há mais processos pendentes
sleep 2 && ps aux | grep -E 'node|chrom' | grep -v grep

# 3. Iniciar novamente
node dist/index.js
```

Se o erro persistir (lock file órfão após crash), remova apenas o lock — **sem apagar a sessão**:
```bash
find .wwebjs_auth -name 'SingletonLock' -delete
find .wwebjs_auth -name 'SingletonSocket' -delete
node dist/index.js
```

---

**QR code difícil de escanear pelo terminal:**

O bot agora serve o QR code como imagem em `http://IP_DA_VM:3000`. Acesse esse endereço no browser do celular para escanear com facilidade. Certifique-se de que a porta 3000 está liberada no firewall da Oracle (Passo 3) e no Ubuntu (`sudo ufw allow 3000/tcp`).

**QR code expirou antes de escanear:**
```bash
pm2 stop family-finance-bot
rm -rf .wwebjs_auth/   # apaga a sessão antiga
node dist/index.js      # gera novo QR
# Escaneie e depois: pm2 start dist/index.js --name family-finance-bot
```

**Erro no passo 5.5 — `ufw: command not found`:**

Algumas imagens Ubuntu da Oracle Cloud não incluem o `ufw` por padrão. Instale-o antes de usar:
```bash
sudo apt install -y ufw
sudo ufw allow ssh
sudo ufw enable
```

---

**Erro no passo 5.3 — `Package 'libasound2' has no installation candidate`:**

O pacote foi renomeado no Ubuntu 24.04+. Verifique sua versão:
```bash
lsb_release -rs
```
Se retornar `24.04` ou superior, substitua `libasound2` por `libasound2t64` no comando de instalação.

---

**Erro `Browser was not found at the configured executablePath`:**

O caminho do Chromium definido em `CHROME_PATH` não existe. Descubra o caminho correto e atualize o `.env`:

```bash
# 1. Encontrar o Chromium instalado
which chromium chromium-browser google-chrome google-chrome-stable 2>/dev/null

# 2. Atualizar o .env com o caminho retornado
nano .env
# Adicione ou edite a linha:
# CHROME_PATH=/usr/bin/chromium   ← substitua pelo caminho encontrado
```

**Chromium não encontrado (nenhum `which` retornou resultado):**
```bash
which chromium-browser
which chromium
# Se nenhum retornar, instale conforme o Passo 5.3
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

## Automatizar o deploy com GitHub Actions

Cansado de rodar SCP e SSH manualmente a cada mudança? Configure o pipeline de CI/CD:

> 📄 **[docs/DEPLOY_ACTIONS.md](./DEPLOY_ACTIONS.md)** — Deploy automático via GitHub Actions  
> Cada `git push` para `main` compila, valida e publica o bot na VM automaticamente.

---

*Guia gerado em Março 2025 · FamilyFinanceBot v1.0*
