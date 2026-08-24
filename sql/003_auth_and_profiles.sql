-- SRC 中文成长平台 - 家长账户 & 孩子档案 & 游客测试
-- 执行顺序：1) 创建表  2) 创建索引  3) 启用RLS

-- ============================================================
-- 1. parents_profiles - 家长扩展资料（auth.users 的扩展表）
-- ============================================================
CREATE TABLE IF NOT EXISTS public.parents_profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text UNIQUE NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz,
  subscription_status text NOT NULL DEFAULT 'free',
  plan_type text NOT NULL DEFAULT 'free',
  subscription_id text,
  status text NOT NULL DEFAULT 'active'
);

COMMENT ON TABLE parents_profiles IS '家长账户扩展资料，与 auth.users 1:1 对应';

-- ============================================================
-- 2. children - 孩子档案（增加 parent_id 外键）
-- ============================================================
-- 先检查是否已有 parent_id 列（如果已有 children 表）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'children' AND column_name = 'parent_id'
  ) THEN
    ALTER TABLE public.children ADD COLUMN parent_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 如果 children 表不存在，创建它
CREATE TABLE IF NOT EXISTS public.children (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  nickname text NOT NULL,
  age integer NOT NULL,
  grade text NOT NULL,
  country text NOT NULL,
  home_language text,
  home_language_other text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz,
  status text NOT NULL DEFAULT 'active'
);

-- 兼容旧字段（name 改 nickname 保留兼容）
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'children' AND column_name = 'name'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'children' AND column_name = 'nickname'
  ) THEN
    ALTER TABLE public.children RENAME COLUMN name TO nickname;
  END IF;
END $$;

-- language_env 重命名兼容
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'children' AND column_name = 'language_env'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'children' AND column_name = 'home_language'
  ) THEN
    ALTER TABLE public.children RENAME COLUMN language_env TO home_language;
  END IF;
END $$;

-- ============================================================
-- 3. guest_test_sessions - 游客测试会话
-- ============================================================
CREATE TABLE IF NOT EXISTS public.guest_test_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id text,
  test_status text NOT NULL DEFAULT 'in_progress', -- in_progress, completed, abandoned
  result_status text, -- estimated_level, etc.
  result_data jsonb,
  claimed boolean NOT NULL DEFAULT false,
  child_id uuid REFERENCES public.children(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

COMMENT ON TABLE guest_test_sessions IS '游客快速测试会话，注册后可绑定到 child_id';

-- ============================================================
-- 4. quick_assessment_results - 快速测评结果（直接测试结果）
-- ============================================================
CREATE TABLE IF NOT EXISTS public.quick_assessment_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id uuid REFERENCES public.children(id) ON DELETE CASCADE,
  guest_session_id uuid REFERENCES public.guest_test_sessions(id) ON DELETE SET NULL,
  character_level_lower integer,
  character_level_upper integer,
  word_level_lower integer,
  word_level_upper integer,
  reading_base_level integer,
  recommended_reading text,
  confidence text, -- high, medium, low
  total_questions integer,
  character_count integer,
  word_count integer,
  level_results jsonb,
  quality_flags jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE quick_assessment_results IS '直接测试（快速测评）结果';

-- ============================================================
-- 5. otp_rate_limit - 验证码发送频率限制
-- ============================================================
CREATE TABLE IF NOT EXISTS public.otp_rate_limit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier text NOT NULL, -- email or ip
  type text NOT NULL, -- email, ip
  action text NOT NULL DEFAULT 'send_otp',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- 索引
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_children_parent_id ON public.children(parent_id);
CREATE INDEX IF NOT EXISTS idx_children_status ON public.children(status);
CREATE INDEX IF NOT EXISTS idx_guest_sessions_device_id ON public.guest_test_sessions(device_id);
CREATE INDEX IF NOT EXISTS idx_guest_sessions_claimed ON public.guest_test_sessions(claimed);
CREATE INDEX IF NOT EXISTS idx_quick_results_child_id ON public.quick_assessment_results(child_id);
CREATE INDEX IF NOT EXISTS idx_quick_results_guest_session_id ON public.quick_assessment_results(guest_session_id);
CREATE INDEX IF NOT EXISTS idx_quick_results_created_at ON public.quick_assessment_results(created_at);
CREATE INDEX IF NOT EXISTS idx_otp_rate_limit_identifier ON public.otp_rate_limit(identifier, created_at);

-- ============================================================
-- RLS（行级安全）
-- ============================================================
ALTER TABLE public.parents_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.children ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guest_test_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quick_assessment_results ENABLE ROW LEVEL SECURITY;

-- parents_profiles：只能看自己的
DROP POLICY IF EXISTS "parent_view_own_profile" ON public.parents_profiles;
CREATE POLICY "parent_view_own_profile" ON public.parents_profiles
  FOR SELECT USING (auth.uid() = id);

DROP POLICY IF EXISTS "parent_update_own_profile" ON public.parents_profiles;
CREATE POLICY "parent_update_own_profile" ON public.parents_profiles
  FOR UPDATE USING (auth.uid() = id);

-- children：家长只能看自己的孩子
DROP POLICY IF EXISTS "parent_view_own_children" ON public.children;
CREATE POLICY "parent_view_own_children" ON public.children
  FOR SELECT USING (auth.uid() = parent_id);

DROP POLICY IF EXISTS "parent_update_own_children" ON public.children;
CREATE POLICY "parent_update_own_children" ON public.children
  FOR UPDATE USING (auth.uid() = parent_id);

DROP POLICY IF EXISTS "parent_insert_own_children" ON public.children;
CREATE POLICY "parent_insert_own_children" ON public.children
  FOR INSERT WITH CHECK (auth.uid() = parent_id);

-- quick_assessment_results：家长只能看自己孩子的
DROP POLICY IF EXISTS "parent_view_child_results" ON public.quick_assessment_results;
CREATE POLICY "parent_view_child_results" ON public.quick_assessment_results
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.children c
      WHERE c.id = child_id AND c.parent_id = auth.uid()
    )
  );

-- guest_test_sessions：匿名插入可读自己的（通过 device_id，后端用 service role 管理）
DROP POLICY IF EXISTS "guest_insert_session" ON public.guest_test_sessions;
CREATE POLICY "guest_insert_session" ON public.guest_test_sessions
  FOR INSERT WITH CHECK (true);
