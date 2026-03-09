// ─────────────────────────────────────────────
// FamilyFinanceBot · Entry Point
// ─────────────────────────────────────────────

import 'dotenv/config';
import qrcode from 'qrcode-terminal';
import { Client, LocalAuth } from 'whatsapp-web.js';
import { handleMessage } from './handlers/messageHandler';

// ── Validação de variáveis de ambiente ────────────

const required = ['ANTHROPIC_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ALLOWED_NUMBERS'];
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
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',   // necessário em Railway/Docker
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--disable-gpu',
    ],
  },
});

// ── Eventos ───────────────────────────────────────

client.on('qr', (qr) => {
  console.log('\n📱 Escaneie o QR code abaixo com o WhatsApp do chip dedicado:\n');
  qrcode.generate(qr, { small: true });
  console.log('\nAguardando autenticação...\n');
});

client.on('authenticated', () => {
  console.log('✅ WhatsApp autenticado com sucesso!');
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
  // Tenta reconectar automaticamente
  setTimeout(() => {
    console.log('🔄 Tentando reconectar...');
    client.initialize();
  }, 5000);
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
