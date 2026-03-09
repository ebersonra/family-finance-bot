-- =============================================================
-- FamilyFinanceBot · Database Initialization
-- Supabase / PostgreSQL
--
-- Executar no SQL Editor do Supabase ou via psql.
-- Idempotente: usa IF NOT EXISTS / OR REPLACE.
-- =============================================================


-- -------------------------------------------------------------
-- 0. Extensões necessárias
-- -------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid() (Postgres < 13)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";  -- uuid_generate_v4() (fallback)


-- =============================================================
-- 1. TABELA: members
--    Perfil de membro do bot para cada usuário da família.
--    Relação 1:1 com public.users (já existente no Supabase).
--    • user_id  → FK 1:1 para users.id (UNIQUE enforced)
--    • name/phone → denormalizados de users para performance do bot
--      (manter sincronizados via trigger fn_sync_member_from_user)
-- =============================================================

CREATE TABLE IF NOT EXISTS members (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  name       TEXT        NOT NULL,          -- espelho de users.name
  phone      TEXT        NOT NULL,          -- formato numérico WhatsApp: "5511999998888"
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- 1:1 com users
  CONSTRAINT members_user_id_unique  UNIQUE (user_id),
  -- Unicidade do número no bot
  CONSTRAINT members_phone_unique    UNIQUE (phone),
  CONSTRAINT members_name_not_empty  CHECK (char_length(TRIM(name)) > 0),
  -- Aceita somente dígitos, 10-15 chars (formato WhatsApp)
  CONSTRAINT members_phone_numeric   CHECK (phone ~ '^[0-9]{10,15}$')
);

COMMENT ON TABLE  members          IS 'Perfil de bot WhatsApp para cada usuário (1:1 com public.users)';
COMMENT ON COLUMN members.user_id  IS 'FK 1:1 para public.users.id';
COMMENT ON COLUMN members.name     IS 'Denormalizado de users.name — manter sincronizado';
COMMENT ON COLUMN members.phone    IS 'Número numérico puro para WhatsApp (ex: 5511999998888)';


-- Índices
CREATE INDEX IF NOT EXISTS idx_members_user_id ON members (user_id);
CREATE INDEX IF NOT EXISTS idx_members_phone   ON members (phone);


-- =============================================================
-- 2. TABELA: transactions
--    Lançamentos financeiros (gastos e entradas).
-- =============================================================

CREATE TABLE IF NOT EXISTS transactions (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT        NOT NULL,          -- descrição legível (ex: "Uber", "Mercado")
  amount     NUMERIC     NOT NULL,          -- NEGATIVO = gasto · POSITIVO = entrada
  category   TEXT        NOT NULL,          -- enum: ver CHECK abaixo
  member_id  UUID        NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  date       DATE        NOT NULL,          -- data da transação (YYYY-MM-DD)
  source     TEXT        NOT NULL DEFAULT 'app',  -- 'app' | 'whatsapp'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT transactions_category_valid CHECK (
    category IN ('food', 'home', 'transport', 'health', 'leisure', 'education', 'income', 'other')
  ),
  CONSTRAINT transactions_source_valid CHECK (
    source IN ('app', 'whatsapp')
  ),
  CONSTRAINT transactions_amount_not_zero CHECK (amount <> 0),
  CONSTRAINT transactions_name_not_empty  CHECK (char_length(name) > 0)
);

COMMENT ON TABLE  transactions            IS 'Todas as transações financeiras da família';
COMMENT ON COLUMN transactions.amount     IS 'Valor: negativo para gastos, positivo para entradas';
COMMENT ON COLUMN transactions.category   IS 'food | home | transport | health | leisure | education | income | other';
COMMENT ON COLUMN transactions.source     IS 'Origem do lançamento: app (mobile/web) ou whatsapp (bot)';


-- Índices para queries comuns
CREATE INDEX IF NOT EXISTS idx_transactions_member_id  ON transactions (member_id);
CREATE INDEX IF NOT EXISTS idx_transactions_date        ON transactions (date DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_category    ON transactions (category);
CREATE INDEX IF NOT EXISTS idx_transactions_source      ON transactions (source);

-- Índice composto para o resumo mensal (filtra por mês, agrega por categoria)
CREATE INDEX IF NOT EXISTS idx_transactions_date_category
  ON transactions (date DESC, category);

-- Índice composto para deleteLastTransaction (busca último por membro + source)
CREATE INDEX IF NOT EXISTS idx_transactions_member_source_created
  ON transactions (member_id, source, created_at DESC);


-- =============================================================
-- 3. TABELA: goals
--    Metas financeiras da família (compartilhadas entre membros).
--    created_by_member_id → rastreia quem criou, mas a meta é
--    visível para toda a família (sem filtro por membro na query).
-- =============================================================

CREATE TABLE IF NOT EXISTS goals (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  label                TEXT        NOT NULL,          -- nome da meta (ex: "Viagem Europa")
  emoji                TEXT,                          -- emoji opcional (ex: "✈️")
  target               NUMERIC     NOT NULL,          -- valor objetivo
  saved                NUMERIC     NOT NULL DEFAULT 0, -- valor já acumulado
  deadline             TEXT        NOT NULL,          -- período alvo no formato 'YYYY-MM'
  color                TEXT,                          -- cor hex opcional (ex: "#3B82F6")
  created_by_member_id UUID        NULL
                         REFERENCES members (id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT goals_target_positive    CHECK (target > 0),
  CONSTRAINT goals_saved_non_negative CHECK (saved >= 0),
  CONSTRAINT goals_label_not_empty    CHECK (char_length(TRIM(label)) > 0),
  CONSTRAINT goals_deadline_format    CHECK (deadline ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT goals_color_format       CHECK (color IS NULL OR color ~ '^#[0-9A-Fa-f]{6}$')
);

COMMENT ON TABLE  goals                      IS 'Metas financeiras compartilhadas da família';
COMMENT ON COLUMN goals.target               IS 'Valor total a ser atingido';
COMMENT ON COLUMN goals.saved                IS 'Valor já acumulado (atualizado manualmente ou via app)';
COMMENT ON COLUMN goals.deadline             IS 'Prazo no formato YYYY-MM (ex: 2025-12)';
COMMENT ON COLUMN goals.created_by_member_id IS 'Membro que criou a meta (NULL se removido)';


-- Índices
CREATE INDEX IF NOT EXISTS idx_goals_created_at        ON goals (created_at ASC);
CREATE INDEX IF NOT EXISTS idx_goals_created_by_member ON goals (created_by_member_id);


-- =============================================================
-- 4. VIEW: v_monthly_summary
--    Resumo mensal agregado com user_id exposto via JOIN members.
--    Espelha a lógica de getMonthlySummary() em supabase.ts.
-- =============================================================

CREATE OR REPLACE VIEW v_monthly_summary AS
SELECT
  DATE_TRUNC('month', t.date)::DATE                                      AS month,
  t.category,
  t.member_id,
  m.user_id,
  SUM(CASE WHEN t.amount > 0 THEN t.amount  ELSE 0 END)                  AS income,
  SUM(CASE WHEN t.amount < 0 THEN ABS(t.amount) ELSE 0 END)              AS expenses,
  SUM(t.amount)                                                           AS balance,
  COUNT(*)                                                                AS transaction_count
FROM transactions t
JOIN members m ON m.id = t.member_id
GROUP BY DATE_TRUNC('month', t.date), t.category, t.member_id, m.user_id;

COMMENT ON VIEW v_monthly_summary IS
  'Agregado mensal por categoria, membro e user_id. Útil para dashboards e relatórios.';


-- =============================================================
-- 5. VIEW: v_current_month_summary
--    Resumo do mês corrente com user_id (atalho para /resumo do bot).
-- =============================================================

CREATE OR REPLACE VIEW v_current_month_summary AS
SELECT
  t.category,
  t.member_id,
  m.user_id,
  SUM(CASE WHEN t.amount > 0 THEN t.amount  ELSE 0 END) AS income,
  SUM(CASE WHEN t.amount < 0 THEN ABS(t.amount) ELSE 0 END) AS expenses,
  COUNT(*) AS transaction_count
FROM transactions t
JOIN members m ON m.id = t.member_id
WHERE DATE_TRUNC('month', t.date) = DATE_TRUNC('month', CURRENT_DATE)
GROUP BY t.category, t.member_id, m.user_id;

COMMENT ON VIEW v_current_month_summary IS
  'Resumo do mês atual com user_id. Usar no bot para /resumo rápido.';


-- =============================================================
-- 6. ROW LEVEL SECURITY (RLS)
--    O bot usa service_role key → bypassa RLS automaticamente.
--    Policies abaixo protegem acesso via JWT do app mobile/web.
--    Premissa: auth.uid() == users.id == members.user_id
-- =============================================================

-- Habilitar RLS nas tabelas
ALTER TABLE members      ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE goals        ENABLE ROW LEVEL SECURITY;

-- ── members ──────────────────────────────────────────────────
-- Cada usuário vê apenas seu próprio perfil de membro.
DROP POLICY IF EXISTS members_select_own ON members;
CREATE POLICY members_select_own ON members
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS members_insert_own ON members;
CREATE POLICY members_insert_own ON members
  FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS members_update_own ON members;
CREATE POLICY members_update_own ON members
  FOR UPDATE USING (user_id = auth.uid());

DROP POLICY IF EXISTS members_delete_own ON members;
CREATE POLICY members_delete_own ON members
  FOR DELETE USING (user_id = auth.uid());

-- ── transactions ─────────────────────────────────────────────
-- Usuário vê/gerencia somente suas próprias transações
-- (via member_id → members.user_id = auth.uid()).
DROP POLICY IF EXISTS transactions_select_own ON transactions;
CREATE POLICY transactions_select_own ON transactions
  FOR SELECT USING (
    member_id IN (
      SELECT id FROM members WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS transactions_insert_own ON transactions;
CREATE POLICY transactions_insert_own ON transactions
  FOR INSERT WITH CHECK (
    member_id IN (
      SELECT id FROM members WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS transactions_update_own ON transactions;
CREATE POLICY transactions_update_own ON transactions
  FOR UPDATE USING (
    member_id IN (
      SELECT id FROM members WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS transactions_delete_own ON transactions;
CREATE POLICY transactions_delete_own ON transactions
  FOR DELETE USING (
    member_id IN (
      SELECT id FROM members WHERE user_id = auth.uid()
    )
  );

-- ── goals (compartilhado pela família) ───────────────────────
-- Todos os membros autenticados veem e gerenciam as metas.
DROP POLICY IF EXISTS goals_select_authenticated ON goals;
CREATE POLICY goals_select_authenticated ON goals
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS goals_insert_authenticated ON goals;
CREATE POLICY goals_insert_authenticated ON goals
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS goals_update_authenticated ON goals;
CREATE POLICY goals_update_authenticated ON goals
  FOR UPDATE USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS goals_delete_authenticated ON goals;
CREATE POLICY goals_delete_authenticated ON goals
  FOR DELETE USING (auth.uid() IS NOT NULL);


-- =============================================================
-- 7. DADOS INICIAIS (seed)
--    Insere apenas se não existirem registros.
--    NOTA: members requer um users.id válido — não é possível
--    inserir um member sem um user correspondente.
--    Para cadastrar o primeiro membro, crie o user no Supabase
--    Auth/app e depois execute:
--
--      INSERT INTO members (user_id, name, phone)
--      VALUES ('<user-uuid>', 'Nome', '5511999998888');
-- =============================================================

-- Exemplo de meta inicial (independe de usuário)
INSERT INTO goals (label, emoji, target, saved, deadline, color)
SELECT 'Reserva de Emergência', '🏦', 10000.00, 0.00,
       TO_CHAR(CURRENT_DATE + INTERVAL '9 months', 'YYYY-MM'),
       '#10B981'
WHERE NOT EXISTS (SELECT 1 FROM goals LIMIT 1);


-- =============================================================
-- 8. TRIGGER: fn_sync_member_from_user
--    Mantém members.name e members.phone sincronizados quando
--    o usuário atualiza seu perfil em public.users.
-- =============================================================

CREATE OR REPLACE FUNCTION fn_sync_member_from_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Só atualiza se name ou phone mudaram
  IF (NEW.name IS DISTINCT FROM OLD.name) OR (NEW.phone IS DISTINCT FROM OLD.phone) THEN
    UPDATE members
    SET
      name  = NEW.name,
      -- Extrair apenas dígitos do phone para manter formato WhatsApp
      phone = REGEXP_REPLACE(COALESCE(NEW.phone, phone), '\D', '', 'g')
    WHERE user_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fn_sync_member_from_user IS
  'Sincroniza name e phone de members quando public.users é atualizado';

DROP TRIGGER IF EXISTS trg_sync_member_from_user ON public.users;
CREATE TRIGGER trg_sync_member_from_user
  AFTER UPDATE OF name, phone ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION fn_sync_member_from_user();


-- =============================================================
-- 9. FUNÇÃO: fn_delete_last_whatsapp_transaction
--    Equivalente server-side ao deleteLastTransaction() do bot.
--    Evita round-trip duplo (SELECT + DELETE).
-- =============================================================

CREATE OR REPLACE FUNCTION fn_delete_last_whatsapp_transaction(p_member_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id UUID;
BEGIN
  SELECT id INTO v_id
  FROM transactions
  WHERE member_id = p_member_id
    AND source = 'whatsapp'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_id IS NULL THEN
    RETURN FALSE;
  END IF;

  DELETE FROM transactions WHERE id = v_id;
  RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION fn_delete_last_whatsapp_transaction IS
  'Remove o último lançamento via WhatsApp de um membro. Retorna TRUE se removeu.';


-- =============================================================
-- 10. FUNÇÃO: fn_monthly_summary
--    Retorna resumo financeiro de um mês específico.
--    Parâmetro: p_month DATE (qualquer dia do mês desejado).
-- =============================================================

CREATE OR REPLACE FUNCTION fn_monthly_summary(p_month DATE DEFAULT CURRENT_DATE)
RETURNS TABLE (
  total_income    NUMERIC,
  total_expenses  NUMERIC,
  balance         NUMERIC,
  category        TEXT,
  category_total  NUMERIC
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    SUM(CASE WHEN amount > 0 THEN amount  ELSE 0 END) OVER () AS total_income,
    SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END) OVER () AS total_expenses,
    SUM(amount) OVER () AS balance,
    category,
    SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END) AS category_total
  FROM transactions
  WHERE DATE_TRUNC('month', date) = DATE_TRUNC('month', p_month)
  GROUP BY category, amount
  ORDER BY category_total DESC;
$$;

COMMENT ON FUNCTION fn_monthly_summary IS
  'Resumo financeiro mensal com totais e breakdown por categoria.';


-- =============================================================
-- DIAGRAMA DE RELACIONAMENTOS
-- =============================================================
--
--  public.users (existente no Supabase)
--       │
--       │ 1:1  (user_id UNIQUE)
--       ▼
--    members
--       │
--       │ 1:N  (member_id FK)
--       ▼
--  transactions
--
--    members
--       │
--       │ 1:N  (created_by_member_id FK, nullable)
--       ▼
--     goals  ← compartilhado por todos os membros da família
--
-- =============================================================
-- FIM DO SCRIPT
-- =============================================================
