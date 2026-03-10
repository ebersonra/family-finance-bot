# 🤖 GitHub Actions — Deploy Automático para Oracle VM

> Após este guia, cada `git push` para `main` vai **compilar, validar e publicar**  
> o bot na Oracle VM automaticamente — sem SCP manual, sem SSH no dia a dia.

---

## Como funciona o pipeline

```
git push → GitHub Actions
               │
               ▼
         ┌─────────────┐
         │  Job: build │  ← Instala dependências e compila TypeScript no runner
         └──────┬──────┘
                │ sucesso
                ▼
         ┌──────────────────┐
         │  Job: deploy     │  ← SSH na Oracle VM
         │  1. git pull     │
         │  2. npm ci       │
         │  3. npm run build│
         │  4. pm2 restart  │
         └──────────────────┘
```

- Se a compilação **falhar** no GitHub, o deploy é **bloqueado automaticamente**.
- O deploy também pode ser disparado manualmente pela aba **Actions → Run workflow**.

---

## Pré-requisito: Clonar o repositório na VM (apenas uma vez)

Antes de ativar o pipeline, o código precisa estar na VM. Execute via SSH:

```bash
ssh -i ~/.ssh/oracle_bot ubuntu@<IP_DA_VM>

# Instalar git (se não tiver)
sudo apt install -y git

# Clonar o repositório
git clone https://github.com/<seu-usuario>/family-finance-bot.git ~/family-finance-bot

# Entrar na pasta e instalar dependências
cd ~/family-finance-bot
npm ci --omit=dev

# Compilar
npm run build

# Configurar variáveis de ambiente
cp .env.example .env
nano .env   # preencha ANTHROPIC_API_KEY, SUPABASE_URL, etc.
```

> O arquivo `.env` **nunca é enviado pelo pipeline**. Ele deve existir previamente na VM  
> e nunca ser commitado no repositório (já está no `.gitignore`).

---

## Passo 1 — Gerar um par de chaves SSH dedicado para o CI

> Crie uma chave separada da chave pessoal. Isso permite revogar o acesso do CI  
> sem afetar o seu acesso SSH pessoal.

No seu computador:

```bash
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/oracle_bot_ci
# Não defina senha (deixe em branco) — o CI precisa logar sem interação
```

Dois arquivos serão gerados:
- `~/.ssh/oracle_bot_ci` — **chave privada** (vai para o GitHub Secrets)
- `~/.ssh/oracle_bot_ci.pub` — **chave pública** (vai para a VM)

---

## Passo 2 — Autorizar a chave pública na VM

```bash
# Copie a chave pública para a VM (substitua pelo IP real)
ssh-copy-id -i ~/.ssh/oracle_bot_ci.pub ubuntu@<IP_DA_VM>

# Ou manualmente:
cat ~/.ssh/oracle_bot_ci.pub
# Copie a saída e cole na VM em:
# echo "CONTEUDO_DA_CHAVE" >> ~/.ssh/authorized_keys
```

Teste a conexão:

```bash
ssh -i ~/.ssh/oracle_bot_ci ubuntu@<IP_DA_VM> echo "Conexão OK"
```

---

## Passo 3 — Configurar os Secrets no GitHub

Acesse: **GitHub → Repositório → Settings → Secrets and variables → Actions → New repository secret**

| Secret | Valor | Obrigatório |
|---|---|---|
| `ORACLE_HOST` | IP público da VM (ex: `150.230.xx.xx`) | ✅ |
| `ORACLE_USER` | Usuário SSH da VM (normalmente `ubuntu`) | ✅ |
| `ORACLE_SSH_KEY` | Conteúdo completo do arquivo `~/.ssh/oracle_bot_ci` | ✅ |
| `ORACLE_SSH_PORT` | Porta SSH (padrão: `22`). Omita se não alterou. | ⬜ opcional |

### Como copiar o conteúdo da chave privada

```bash
cat ~/.ssh/oracle_bot_ci
```

Copie **tudo**, incluindo as linhas:
```
-----BEGIN OPENSSH PRIVATE KEY-----
...
-----END OPENSSH PRIVATE KEY-----
```

Cole o conteúdo completo como valor do secret `ORACLE_SSH_KEY`.

---

## Passo 4 — Configurar o `.env` na VM (apenas uma vez)

O pipeline **não sobrescreve** o `.env` da VM. Configure-o manualmente na primeira vez:

```bash
ssh -i ~/.ssh/oracle_bot ubuntu@<IP_DA_VM>
cd ~/family-finance-bot
nano .env
```

Conteúdo mínimo:

```env
# API de NLP
ANTHROPIC_API_KEY=sk-ant-...

# Supabase
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# Números autorizados (formato numérico puro, separados por vírgula)
ALLOWED_NUMBERS=5511999998888,5511988887777

# Caminho do Chromium na VM
CHROME_PATH=/usr/bin/chromium-browser

# Ambiente
NODE_ENV=production
```

> Para descobrir o `CHROME_PATH` correto na VM:
> ```bash
> which chromium chromium-browser google-chrome 2>/dev/null
> ```

---

## Estrutura dos Secrets no GitHub

```
Settings
└── Secrets and variables
    └── Actions
        ├── ORACLE_HOST          ← "150.230.xx.xx"
        ├── ORACLE_USER          ← "ubuntu"
        ├── ORACLE_SSH_KEY       ← conteúdo de ~/.ssh/oracle_bot_ci
        └── ORACLE_SSH_PORT      ← "22" (opcional)
```

---

## Verificar o deploy

Após um `git push`, acesse:

```
GitHub → Repositório → Actions → Deploy to Oracle VM
```

Cada execução mostra o log completo dos dois jobs (`Build & Validate` e `Deploy to Oracle VM`).

Para confirmar na VM:

```bash
ssh -i ~/.ssh/oracle_bot ubuntu@<IP_DA_VM>
pm2 status family-finance-bot
pm2 logs family-finance-bot --lines 20
```

---

## Comandos úteis pós-deploy

```bash
# Ver status do bot
pm2 status family-finance-bot

# Acompanhar logs em tempo real
pm2 logs family-finance-bot

# Forçar restart manual
pm2 restart family-finance-bot

# Ver a versão do código no ar
cd ~/family-finance-bot && git log --oneline -5
```

---

## Segurança

| Boa prática | Status |
|---|---|
| Chave SSH dedicada para CI (separada da pessoal) | ✅ Recomendado acima |
| `.env` nunca commitado no repositório | ✅ Já está no `.gitignore` |
| Deploy bloqueado se build falhar | ✅ `needs: build` no workflow |
| Chave privada armazenada como Secret criptografado | ✅ GitHub Secrets |
| `.env` configurado diretamente na VM (não via CI) | ✅ Sem segredos em trânsito |

---

## Resolução de problemas

**Deploy falha com `Host key verification failed`:**
```bash
# Adicione a VM às known_hosts da VM temporariamente durante o primeiro acesso
# O action appleboy/ssh-action desabilita a verificação por padrão (StrictHostKeyChecking=no)
# Se ainda falhar, verifique o IP no secret ORACLE_HOST
```

**Deploy falha com `Permission denied (publickey)`:**
```bash
# Na VM, confirme que a chave CI está nas authorized_keys:
cat ~/.ssh/authorized_keys | grep "github-actions-deploy"

# Se não estiver, adicione novamente:
echo "<CONTEUDO_DE_oracle_bot_ci.pub>" >> ~/.ssh/authorized_keys
```

**`git pull` falha com conflito:**
```bash
# Na VM, descarte mudanças locais (dist/ gerada no deploy anterior):
cd ~/family-finance-bot
git fetch origin
git reset --hard origin/main
```

**PM2 não encontrado na VM:**
```bash
# Instale globalmente:
sudo npm install -g pm2

# Adicione ao PATH da sessão não-interativa (SSH do CI):
echo 'export PATH="$PATH:/usr/local/bin"' >> ~/.bashrc
```

---

*Guia gerado em Março 2026 · FamilyFinanceBot CI/CD*
