-- =============================================================================
-- Chat 防護：active 對話室 Partial Unique Index（防高頻重複 INSERT）
-- 在 Supabase SQL Editor 執行（可重複執行，具備冪等保護）。
-- =============================================================================

-- 若先前高頻點擊已產生重複 active 房間，先封存較舊者（保留 updated_at 最新）
WITH ranked_property AS (
  SELECT
    room_id,
    ROW_NUMBER() OVER (
      PARTITION BY tenant_id, property_id
      ORDER BY updated_at DESC, created_at DESC
    ) AS rn
  FROM public.chat_rooms
  WHERE status = 'active'
    AND property_id IS NOT NULL
),
ranked_general AS (
  SELECT
    room_id,
    ROW_NUMBER() OVER (
      PARTITION BY tenant_id
      ORDER BY updated_at DESC, created_at DESC
    ) AS rn
  FROM public.chat_rooms
  WHERE status = 'active'
    AND property_id IS NULL
)
UPDATE public.chat_rooms cr
SET status = 'closed',
    updated_at = now()
WHERE cr.room_id IN (
  SELECT room_id FROM ranked_property WHERE rn > 1
  UNION
  SELECT room_id FROM ranked_general WHERE rn > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_property_chat
  ON public.chat_rooms (tenant_id, property_id)
  WHERE status = 'active' AND property_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_general_chat
  ON public.chat_rooms (tenant_id)
  WHERE status = 'active' AND property_id IS NULL;

COMMENT ON INDEX public.idx_unique_active_property_chat IS
  '每位 tenant 對同一 property 僅能有一個 active 對話室';

COMMENT ON INDEX public.idx_unique_active_general_chat IS
  '每位 tenant 僅能有一個 active 通用客服對話室（property_id IS NULL）';

-- 驗證
SELECT
  'chat_unique_active_indexes' AS deployment,
  indexname
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN (
    'idx_unique_active_property_chat',
    'idx_unique_active_general_chat'
  )
ORDER BY indexname;
