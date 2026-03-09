# ─────────────────────────────────────────────
# FamilyFinanceBot · Dockerfile
# Otimizado para Railway e Render
# ─────────────────────────────────────────────

FROM node:20-slim

# Dependências do Chromium (necessárias para o whatsapp-web.js)
RUN apt-get update && apt-get install -y \
    chromium \
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
    --no-install-recommends \
  && rm -rf /var/lib/apt/lists/*

# Informar ao Puppeteer para usar o Chromium do sistema
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npm run build

# Volume para persistir a sessão do WhatsApp entre deploys
VOLUME ["/app/.wwebjs_auth"]

EXPOSE 3000

CMD ["node", "dist/index.js"]
