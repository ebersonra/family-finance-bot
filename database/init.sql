-- =============================================================
-- FamilyFinanceBot · Database Initialization
-- Supabase / PostgreSQL
--
-- Executar no SQL Editor do Supabase ou via psql.
-- Idempotente: usa IF NOT EXISTS / OR REPLACE.
--
-- AUTENTICAÇÃO:
-- Este script usa AUTENTICAÇÃO CUSTOMIZADA via tabela public.users
-- (phone + name), NÃO Supabase Auth (auth.uid()).
-- O user_id autenticado é propagado via variável de sessão PostgreSQL:
--   SET LOCAL app.current_user_id = 'user-uuid-here';
-- Use exec_with_user_context(user_id) antes de cada operação.
-- Referência: OWASP A01:2021 – Broken Access Control (CWE-284)
-- =============================================================


-- -------------------------------------------------------------
-- 0. Extensões necessárias
-- -------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid() (Postgres < 13)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";  -- uuid_generate_v4() (fallback)


-- =============================================================
-- 0-A. FUNÇÃO AUXILIAR: get_current_user_id()
--
--      ATENÇÃO — redefinição intencional e necessária:
--      A migração 202512090001/add_demo_user_fields.sql sobrescreve
--      esta função com uma versão simplificada que NÃO valida
--      is_active nem deleted_at, abrindo brecha para sessões com
--      IDs de usuários inativos ou deletados.
--      Esta migração (202603090145) restaura a versão completa,
--      garantindo o contrato de segurança do projeto.
--
--      Padrão de autenticação customizada do projeto:
--      lê o user_id de app.current_user_id e valida que o usuário
--      existe, está ativo e não foi deletado. Retorna NULL em caso
--      de contexto ausente ou inválido, bloqueando o acesso via RLS.
-- =============================================================

CREATE OR REPLACE FUNCTION get_current_user_id()
RETURNS UUID AS $$
DECLARE
    v_user_id   TEXT;
    v_user_uuid UUID;
BEGIN
    -- Lê o user_id injetado pela camada de aplicação
    -- OBRIGATÓRIO: SET LOCAL app.current_user_id = 'uuid'; antes de cada query
    v_user_id := current_setting('app.current_user_id', true);

    -- Contexto ausente → bloqueia acesso via RLS
    IF v_user_id IS NULL OR v_user_id = '' THEN
        RETURN NULL;
    END IF;

    -- Valida existência, status ativo e não deleção
    -- SEGURANÇA: impede reutilização de IDs de usuários inativos/deletados
    SELECT id INTO v_user_uuid
    FROM users
    WHERE id         = v_user_id::UUID
      AND is_active  = TRUE
      AND deleted_at IS NULL;

    RETURN v_user_uuid;
EXCEPTION
    WHEN OTHERS THEN
        -- UUID inválido ou qualquer outro erro → bloqueia acesso
        RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

COMMENT ON FUNCTION get_current_user_id() IS
    'Retorna o UUID do usuário autenticado atual via variável de sessão app.current_user_id. '
    'Valida que o usuário existe, está ativo (is_active=TRUE) e não foi deletado (deleted_at IS NULL). '
    'Retorna NULL se o contexto não estiver definido ou o usuário for inválido, bloqueando o acesso RLS.';


-- =============================================================
-- 0-B. FUNÇÃO RPC: exec_with_user_context()
--      Ponto de entrada seguro para definir o contexto de usuário.
--      Deve ser chamada pela aplicação ANTES de qualquer query
--      que dependa de RLS. Valida o usuário e define a sessão.
--      GRANT apenas para 'authenticated' — nunca para 'anon'.
-- =============================================================

CREATE OR REPLACE FUNCTION exec_with_user_context(
  p_user_id  UUID,
  p_operation TEXT DEFAULT 'query'
) RETURNS json AS $$
DECLARE
  v_user_exists BOOLEAN;
BEGIN
    -- Valida que o usuário existe, está ativo e não foi deletado
    -- SEGURANÇA: impede que user_ids deletados/inativos definam contexto
    SELECT EXISTS(
        SELECT 1 FROM users
        WHERE id         = p_user_id
          AND is_active  = TRUE
          AND deleted_at IS NULL
    ) INTO v_user_exists;

    IF NOT v_user_exists THEN
        RAISE EXCEPTION 'Usuário inválido ou inativo: %', p_user_id
            USING HINT = 'O usuário deve existir, estar ativo (is_active=TRUE) e não deletado (deleted_at IS NULL)';
    END IF;

    -- Define o contexto de usuário com escopo de transação (SET LOCAL)
    -- Será limpo automaticamente após COMMIT
    PERFORM set_config('app.current_user_id', p_user_id::text, true);

    RETURN json_build_object(
        'success',   true,
        'user_id',   p_user_id,
        'operation', p_operation,
        'timestamp', now()
    );

EXCEPTION
    WHEN OTHERS THEN
        RAISE EXCEPTION 'Erro ao definir contexto de usuário: %', SQLERRM
            USING HINT = 'Verifique se user_id é um UUID válido e o usuário existe no banco';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION exec_with_user_context(UUID, TEXT) IS
    'Define o contexto de usuário autenticado para políticas RLS. '
    'Valida usuário ativo e não deletado. Deve ser chamada antes de queries que dependam de RLS. '
    'Escopo de transação: limpo automaticamente após COMMIT.';

-- SEGURANÇA: Nunca conceder a 'anon' — isso permitiria que usuários não
-- autenticados definissem contexto para qualquer user_id, bypassando a autenticação.
GRANT EXECUTE ON FUNCTION exec_with_user_context(UUID, TEXT) TO authenticated;


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
--
-- AUTENTICAÇÃO CUSTOMIZADA (padrão do projeto):
--   • NÃO usa auth.uid() do Supabase Auth.
--   • Usa get_current_user_id() que lê de app.current_user_id.
--   • O bot usa service_role key → bypassa RLS automaticamente.
--   • Clientes web/mobile devem chamar exec_with_user_context()
--     antes de qualquer operação que dependa de RLS.
--
-- Referência: CWE-284 / OWASP A01:2021 – Broken Access Control
-- =============================================================

-- Habilitar RLS nas tabelas
ALTER TABLE members      ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE goals        ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE members      IS 'Perfil de bot WhatsApp (1:1 com public.users). RLS habilitado — cada usuário acessa apenas seu próprio registro.';
COMMENT ON TABLE transactions IS 'Transações financeiras da família. RLS habilitado — acesso filtrado via member_id → user_id.';
COMMENT ON TABLE goals        IS 'Metas financeiras da família. RLS habilitado — visíveis a qualquer membro autenticado.';

-- ── members ──────────────────────────────────────────────────
-- Cada usuário acessa apenas seu próprio perfil de membro.
-- Comparação direta user_id = get_current_user_id() (mesmo padrão
-- de shopping_lists, onde o dono é identificado por user_id na tabela).
DROP POLICY IF EXISTS members_select_own ON members;
CREATE POLICY members_select_own ON members
    FOR SELECT
    USING (user_id = get_current_user_id());

COMMENT ON POLICY members_select_own ON members IS
    'SELECT: usuário só visualiza seu próprio perfil (user_id = get_current_user_id())';

DROP POLICY IF EXISTS members_insert_own ON members;
CREATE POLICY members_insert_own ON members
    FOR INSERT
    WITH CHECK (user_id = get_current_user_id());

COMMENT ON POLICY members_insert_own ON members IS
    'INSERT: usuário só cria perfil com seu próprio user_id';

DROP POLICY IF EXISTS members_update_own ON members;
CREATE POLICY members_update_own ON members
    FOR UPDATE
    USING     (user_id = get_current_user_id())
    WITH CHECK(user_id = get_current_user_id());   -- impede transferência de ownership

COMMENT ON POLICY members_update_own ON members IS
    'UPDATE: usuário só edita seu próprio perfil e não pode transferir ownership';

DROP POLICY IF EXISTS members_delete_own ON members;
CREATE POLICY members_delete_own ON members
    FOR DELETE
    USING (user_id = get_current_user_id());

COMMENT ON POLICY members_delete_own ON members IS
    'DELETE: usuário só remove seu próprio perfil';

-- ── transactions ─────────────────────────────────────────────
-- Transações são vinculadas ao usuário via member_id → members.user_id.
-- Padrão EXISTS (mesmo padrão de shopping_list_items, que verifica
-- ownership via tabela pai com subquery EXISTS).
DROP POLICY IF EXISTS transactions_select_own ON transactions;
CREATE POLICY transactions_select_own ON transactions
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM members
            WHERE members.id      = transactions.member_id
              AND members.user_id = get_current_user_id()
        )
    );

COMMENT ON POLICY transactions_select_own ON transactions IS
    'SELECT: usuário só visualiza transações de membros que lhe pertencem (EXISTS via members)';

DROP POLICY IF EXISTS transactions_insert_own ON transactions;
CREATE POLICY transactions_insert_own ON transactions
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM members
            WHERE members.id      = transactions.member_id
              AND members.user_id = get_current_user_id()
        )
    );

COMMENT ON POLICY transactions_insert_own ON transactions IS
    'INSERT: usuário só lança transações em membros que lhe pertencem';

DROP POLICY IF EXISTS transactions_update_own ON transactions;
CREATE POLICY transactions_update_own ON transactions
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM members
            WHERE members.id      = transactions.member_id
              AND members.user_id = get_current_user_id()
        )
    )
    WITH CHECK (
        -- Após update, member_id deve continuar pertencendo ao mesmo usuário
        EXISTS (
            SELECT 1 FROM members
            WHERE members.id      = transactions.member_id
              AND members.user_id = get_current_user_id()
        )
    );

COMMENT ON POLICY transactions_update_own ON transactions IS
    'UPDATE: usuário só edita suas transações; member_id não pode ser alterado para outro usuário';

DROP POLICY IF EXISTS transactions_delete_own ON transactions;
CREATE POLICY transactions_delete_own ON transactions
    FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM members
            WHERE members.id      = transactions.member_id
              AND members.user_id = get_current_user_id()
        )
    );

COMMENT ON POLICY transactions_delete_own ON transactions IS
    'DELETE: usuário só remove suas próprias transações';

-- ── goals (compartilhado pela família) ───────────────────────
-- Metas são visíveis e gerenciáveis por qualquer membro autenticado.
-- get_current_user_id() IS NOT NULL garante que o contexto foi definido
-- (padrão do projeto para recursos compartilhados).
DROP POLICY IF EXISTS goals_select_authenticated ON goals;
CREATE POLICY goals_select_authenticated ON goals
    FOR SELECT
    USING (get_current_user_id() IS NOT NULL);

COMMENT ON POLICY goals_select_authenticated ON goals IS
    'SELECT: qualquer membro com contexto autenticado pode visualizar metas da família';

DROP POLICY IF EXISTS goals_insert_authenticated ON goals;
CREATE POLICY goals_insert_authenticated ON goals
    FOR INSERT
    WITH CHECK (get_current_user_id() IS NOT NULL);

COMMENT ON POLICY goals_insert_authenticated ON goals IS
    'INSERT: qualquer membro autenticado pode criar metas';

DROP POLICY IF EXISTS goals_update_authenticated ON goals;
CREATE POLICY goals_update_authenticated ON goals
    FOR UPDATE
    USING     (get_current_user_id() IS NOT NULL)
    WITH CHECK(get_current_user_id() IS NOT NULL);

COMMENT ON POLICY goals_update_authenticated ON goals IS
    'UPDATE: qualquer membro autenticado pode atualizar metas';

DROP POLICY IF EXISTS goals_delete_authenticated ON goals;
CREATE POLICY goals_delete_authenticated ON goals
    FOR DELETE
    USING (get_current_user_id() IS NOT NULL);

COMMENT ON POLICY goals_delete_authenticated ON goals IS
    'DELETE: qualquer membro autenticado pode remover metas';


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
  v_id           UUID;
  v_caller_id    UUID;
  v_member_owner UUID;
BEGIN
  -- SEGURANÇA: função é SECURITY DEFINER (bypassa RLS).
  -- Validamos manualmente se o chamador é dono do membro informado.
  v_caller_id := get_current_user_id();

  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Contexto de usuário não definido. Chame exec_with_user_context() antes.'
        USING HINT = 'SET LOCAL app.current_user_id deve ser definido na transação corrente';
  END IF;

  -- Verifica que p_member_id pertence ao usuário autenticado
  SELECT user_id INTO v_member_owner
  FROM members
  WHERE id = p_member_id;

  IF v_member_owner IS DISTINCT FROM v_caller_id THEN
    RAISE EXCEPTION 'Acesso negado: o membro % não pertence ao usuário autenticado', p_member_id
        USING HINT = 'CWE-284: verifique se o member_id corresponde ao usuário da sessão';
  END IF;

  -- Busca e remove o último lançamento WhatsApp do membro
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
  'Remove o último lançamento via WhatsApp de um membro. '
  'SECURITY DEFINER: valida manualmente ownership via get_current_user_id(). '
  'Requer exec_with_user_context() antes da chamada. Retorna TRUE se removeu.';

-- Apenas usuários autenticados podem chamar esta função
GRANT EXECUTE ON FUNCTION fn_delete_last_whatsapp_transaction(UUID) TO authenticated;


-- =============================================================
-- 10. FUNÇÃO: fn_monthly_summary
--    Retorna resumo financeiro de um mês específico para um usuário específico.
--    Parâmetros:
--      p_user_id UUID  — OBRIGATÓRIO; isola dados por usuário explicitamente,
--                        independente de RLS. Nunca NULL.
--      p_month   DATE  — qualquer dia do mês desejado (default: mês atual).
--
--    ISOLAMENTO EXPLÍCITO (Defense-in-Depth):
--      Filtra via JOIN transactions → members → user_id = p_user_id.
--      Garante isolamento cross-tenant mesmo quando chamada com service_role
--      key (que bypassa RLS), como ocorre nos bots WhatsApp do projeto.
--      NÃO depende de RLS como único mecanismo de controle de acesso.
--      Referência: OWASP A01:2021 – Broken Access Control (CWE-284)
-- =============================================================

-- Remove a assinatura anterior (sem p_user_id) para evitar sobrecarga vulnerável:
-- a versão antiga agregava transações de todos os usuários quando chamada via
-- service_role key (que bypassa RLS), violando o isolamento cross-tenant.
DROP FUNCTION IF EXISTS fn_monthly_summary(DATE);

CREATE OR REPLACE FUNCTION fn_monthly_summary(
  p_user_id UUID,
  p_month   DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  total_income    NUMERIC,
  total_expenses  NUMERIC,
  balance         NUMERIC,
  category        TEXT,
  category_total  NUMERIC
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  -- SEGURANÇA: p_user_id é obrigatório e jamais pode ser NULL.
  -- Sem este parâmetro, chamadas via service_role key (bots WhatsApp)
  -- retornariam totais de TODOS os usuários — vazamento cross-tenant.
  -- Referência: OWASP A01:2021 / CWE-284
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id é obrigatório para fn_monthly_summary'
      USING HINT = 'Passe o UUID do usuário autenticado para garantir isolamento por tenant';
  END IF;

  RETURN QUERY
  WITH base AS (
    -- Restringe ao usuário via JOIN members.user_id = p_user_id.
    -- Este filtro é o mecanismo primário de isolamento — não RLS.
    SELECT
      t.category,
      t.amount
    FROM transactions t
    JOIN members m ON m.id = t.member_id
    WHERE DATE_TRUNC('month', t.date) = DATE_TRUNC('month', p_month)
      AND m.user_id = p_user_id
  ),
  -- totals: agrega sobre as linhas reais do usuário;
  -- duas despesas de -10 → total_expenses = 20 (sem colapso por amount)
  totals AS (
    SELECT
      SUM(CASE WHEN amount > 0 THEN amount      ELSE 0 END) AS total_income,
      SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END) AS total_expenses,
      SUM(amount)                                            AS balance
    FROM base
  ),
  -- by_category: uma linha por categoria, sem vazar amount no GROUP BY
  by_category AS (
    SELECT
      category,
      SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END) AS category_total
    FROM base
    GROUP BY category
  )
  SELECT
    t.total_income,
    t.total_expenses,
    t.balance,
    c.category,
    c.category_total
  FROM by_category c
  CROSS JOIN totals t
  ORDER BY c.category_total DESC;
END;
$$;

COMMENT ON FUNCTION fn_monthly_summary(UUID, DATE) IS
  'Resumo financeiro mensal com totais globais e breakdown por categoria para um usuário. '
  'ISOLAMENTO EXPLÍCITO: filtra via JOIN transactions→members.user_id=p_user_id, garantindo '
  'isolamento cross-tenant mesmo com service_role key (que bypassa RLS). '
  'p_user_id é obrigatório — RAISE EXCEPTION se NULL. '
  'Usa CTEs para calcular totais sobre linhas reais (sem colapso por amount) '
  'e exibir exatamente uma linha por categoria. '
  'Referência: OWASP A01:2021 – Broken Access Control (CWE-284)';

-- Apenas usuários autenticados podem chamar esta função
GRANT EXECUTE ON FUNCTION fn_monthly_summary(UUID, DATE) TO authenticated;


-- =============================================================
-- 11. VERIFICAÇÃO PÓS-DEPLOY
--     Valida que RLS foi habilitado e políticas foram criadas.
--     Executar após aplicar o script para confirmar a configuração.
-- =============================================================

DO $$
DECLARE
    v_members_rls      BOOLEAN;
    v_transactions_rls BOOLEAN;
    v_goals_rls        BOOLEAN;
    v_count_members    INTEGER;
    v_count_trans      INTEGER;
    v_count_goals      INTEGER;
    v_fn_current_user  INTEGER;
    v_fn_exec_context  INTEGER;
BEGIN
    -- Verifica RLS habilitado
    SELECT relrowsecurity INTO v_members_rls      FROM pg_class WHERE relname = 'members';
    SELECT relrowsecurity INTO v_transactions_rls FROM pg_class WHERE relname = 'transactions';
    SELECT relrowsecurity INTO v_goals_rls        FROM pg_class WHERE relname = 'goals';

    -- Conta políticas criadas
    SELECT COUNT(*) INTO v_count_members FROM pg_policies WHERE tablename = 'members';
    SELECT COUNT(*) INTO v_count_trans   FROM pg_policies WHERE tablename = 'transactions';
    SELECT COUNT(*) INTO v_count_goals   FROM pg_policies WHERE tablename = 'goals';

    -- Verifica funções auxiliares
    SELECT COUNT(*) INTO v_fn_current_user
    FROM information_schema.routines
    WHERE routine_schema = 'public' AND routine_name = 'get_current_user_id';

    SELECT COUNT(*) INTO v_fn_exec_context
    FROM information_schema.routines
    WHERE routine_schema = 'public' AND routine_name = 'exec_with_user_context';

    RAISE NOTICE '============================================================';
    RAISE NOTICE 'FamilyFinanceBot · Verificação de RLS';
    RAISE NOTICE '------------------------------------------------------------';
    RAISE NOTICE 'RLS members:      % | políticas: %', v_members_rls,      v_count_members;
    RAISE NOTICE 'RLS transactions: % | políticas: %', v_transactions_rls, v_count_trans;
    RAISE NOTICE 'RLS goals:        % | políticas: %', v_goals_rls,        v_count_goals;
    RAISE NOTICE 'fn get_current_user_id:    %', CASE WHEN v_fn_current_user  > 0 THEN '✅ OK' ELSE '❌ MISSING' END;
    RAISE NOTICE 'fn exec_with_user_context: %', CASE WHEN v_fn_exec_context  > 0 THEN '✅ OK' ELSE '❌ MISSING' END;
    RAISE NOTICE '------------------------------------------------------------';

    IF v_members_rls AND v_transactions_rls AND v_goals_rls
       AND v_count_members >= 4 AND v_count_trans >= 4 AND v_count_goals >= 4
       AND v_fn_current_user > 0 AND v_fn_exec_context > 0
    THEN
        RAISE NOTICE '✅ SUCESSO: RLS configurado corretamente com autenticação customizada';
    ELSE
        RAISE WARNING '⚠️  ATENÇÃO: Configuração de RLS pode estar incompleta — revise o log acima';
    END IF;

    RAISE NOTICE '============================================================';
END $$;


-- =============================================================
-- DIAGRAMA DE RELACIONAMENTOS
-- =============================================================
--
--  public.users  (existente no projeto — autenticação customizada)
--       │
--       │ 1:1  (user_id UNIQUE, is_active, deleted_at)
--       ▼
--    members  ◄── RLS: user_id = get_current_user_id()
--       │
--       │ 1:N  (member_id FK → CASCADE)
--       ▼
--  transactions  ◄── RLS: EXISTS(members WHERE user_id = get_current_user_id())
--
--    members
--       │
--       │ 1:N  (created_by_member_id FK, nullable → SET NULL)
--       ▼
--     goals  ◄── RLS: get_current_user_id() IS NOT NULL (compartilhado)
--
-- FLUXO DE AUTENTICAÇÃO CUSTOMIZADA:
--   1. Aplicação autentica usuário via tabela public.users
--   2. Chama exec_with_user_context(user_id) → SET LOCAL app.current_user_id
--   3. get_current_user_id() valida e retorna o UUID (ou NULL se inválido)
--   4. Políticas RLS usam get_current_user_id() em vez de auth.uid()
--   5. Bot WhatsApp usa service_role key → bypassa RLS automaticamente
--
-- FUNÇÕES SEGURAS (SECURITY DEFINER):
--   • get_current_user_id()                   → validação de sessão
--   • exec_with_user_context(UUID, TEXT)       → definição de contexto
--   • fn_sync_member_from_user()              → trigger de sincronização
--   • fn_delete_last_whatsapp_transaction(UUID)→ valida ownership manualmente
--
-- =============================================================
-- FIM DO SCRIPT
-- =============================================================
