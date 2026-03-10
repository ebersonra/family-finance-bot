// ─────────────────────────────────────────────
// FamilyFinanceBot · Entry Point
// ─────────────────────────────────────────────

import 'dotenv/config';
import http from 'http';
import qrcode from 'qrcode-terminal';
import QRCode from 'qrcode';
import { Client, LocalAuth } from 'whatsapp-web.js';
import { handleMessage } from './handlers/messageHandler';

// ── Validação de variáveis de ambiente ────────────

const required = ['ANTHROPIC_API_KEY', 'API_BASE_URL', 'ALLOWED_NUMBERS'];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`❌ Variável de ambiente ausente: ${key}`);
    process.exit(1);
  }
}

// ── Cliente WhatsApp ──────────────────────────────

const client = new Client({
  authStrategy: new LocalAuth({
    // A sessão é salva localmente em .wwebjs_auth/
    // Isso evita ter que escanear o QR code toda vez que reiniciar
    dataPath: '.wwebjs_auth',
  }),
  // Fixa uma versão estável do WhatsApp Web para evitar erros de
  // "Execution context was destroyed" causados por navegação durante
  // a injeção do script (o WA Web recarrega ao detectar nova versão).
  // Fixa versão estável do WA Web — evita reload por atualização durante a injeção.
  // Compatível com Node.js v24: o HTML é baixado uma vez e cacheado em .wwebjs_cache/
  webVersionCache: {
    type: 'remote',
    remotePath:
      'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.3000.1015901760-alpha.html',
  },
  puppeteer: {
    headless: true,
    executablePath: process.env.CHROME_PATH || undefined,
    // bypassCSP: evita que políticas de segurança bloqueiem a injeção do script
    // (necessário com Node.js v24 + puppeteer-core — contextos são mais restritivos)
    bypassCSP: true,
    // Tempo máximo para o Chromium iniciar (padrão 30s insuficiente em VMs 1GB)
    timeout: 120000,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--disable-gpu',
      // Roda tudo num único processo — essencial em VMs com pouca RAM (≤ 1GB)
      '--single-process',
      // Reduz uso de memória
      '--renderer-process-limit=1',
      '--js-flags=--max-old-space-size=256',
      // Evita isolamento de contexto entre frames que pode destruir o
      // execution context durante a navegação inicial do WhatsApp Web
      '--disable-features=IsolateOrigins,site-per-process',
    ],
  },
});

// ── Servidor HTTP temporário para QR code ────────

const QR_PORT = process.env.QR_PORT ? parseInt(process.env.QR_PORT) : 3000;
let qrServer: http.Server | null = null;
let latestQrDataUrl = '';

function startQrServer() {
  if (qrServer) return;
  qrServer = http.createServer((_req, res) => {
    if (!latestQrDataUrl) {
      res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<p>QR code ainda não gerado. Aguarde e recarregue a página.</p>');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>FamilyFinanceBot — QR Code</title>
  <meta http-equiv="refresh" content="30">
  <style>
    body { display:flex; flex-direction:column; align-items:center;
           justify-content:center; min-height:100vh; margin:0;
           background:#f5f5f5; font-family:sans-serif; text-align:center; }
    img  { width:280px; height:280px; border:8px solid white;
           border-radius:12px; box-shadow:0 4px 20px rgba(0,0,0,.15); }
    p    { color:#555; margin-top:16px; font-size:14px; }
  </style>
</head>
<body>
  <h2>📱 Escaneie com o WhatsApp</h2>
  <img src="${latestQrDataUrl}" alt="QR Code WhatsApp">
  <p>Abra o WhatsApp → Dispositivos conectados → Conectar um dispositivo</p>
  <p><small>Esta página recarrega automaticamente a cada 30 s.</small></p>
</body>
</html>`);
  });
  qrServer.listen(QR_PORT, '0.0.0.0', () => {
    console.log(`\n🌐 QR code disponível em: http://IP_DA_VM:${QR_PORT}`);
    console.log('   Abra esse endereço no browser do celular para escanear.\n');
  });
}

function stopQrServer() {
  if (qrServer) {
    qrServer.close();
    qrServer = null;
  }
}

// ── Eventos ───────────────────────────────────────

client.on('qr', async (qr) => {
  console.log('\n📱 Escaneie o QR code abaixo com o WhatsApp do chip dedicado:\n');
  qrcode.generate(qr, { small: true });
  console.log('\nAguardando autenticação...\n');

  // Gera QR como imagem e serve via HTTP (mais confiável que o terminal)
  try {
    latestQrDataUrl = await QRCode.toDataURL(qr, { width: 280, margin: 2 });
    startQrServer();
  } catch (err) {
    console.warn('⚠️  Não foi possível iniciar o servidor de QR:', err);
  }
});

client.on('authenticated', () => {
  console.log('✅ WhatsApp autenticado com sucesso!');
  stopQrServer();
});

client.on('auth_failure', (msg) => {
  console.error('❌ Falha na autenticação:', msg);
  process.exit(1);
});

client.on('ready', () => {
  console.log('🤖 FamilyFinance Bot está online e pronto para receber mensagens!');
  console.log(`📋 Números autorizados: ${process.env.ALLOWED_NUMBERS}`);
});

client.on('disconnected', (reason) => {
  console.warn('⚠️ Bot desconectado:', reason);
  stopQrServer();

  if (reason === 'LOGOUT') {
    // Sessão invalidada — não adianta reconectar sem novo QR code.
    // PM2 vai reiniciar o processo e apresentar um novo QR.
    console.error('❌ Sessão encerrada por LOGOUT. Reiniciando processo para novo QR...');
    process.exit(1);
  }

  // Para outros motivos (ex: perda de rede), tenta reconectar
  setTimeout(() => {
    console.log('🔄 Tentando reconectar...');
    client.initialize();
  }, 10000);
});

client.on('message', async (msg) => {
  // Ignorar mensagens de grupos
  if (msg.from.endsWith('@g.us')) return;

  // Ignorar mensagens do próprio bot
  if (msg.fromMe) return;

  try {
    await handleMessage(msg);
  } catch (err) {
    console.error('[Bot] Erro não tratado ao processar mensagem:', err);
  }
});

// ── Inicialização ─────────────────────────────────

console.log('🚀 Iniciando FamilyFinance Bot...');
client.initialize();

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Encerrando bot...');
  await client.destroy();
  process.exit(0);
});
