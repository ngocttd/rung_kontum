-- Thông báo không dùng Firebase: PostgreSQL là nguồn sự thật, Socket.IO giao tức thời khi ứng dụng đang mở,
-- dịch vụ push theo nền tảng (APNs cho iOS, Web Push/UnifiedPush cho Android và trình duyệt) khi ứng dụng ở nền.

-- kênh push của thiết bị
ALTER TABLE mobile.mobile_devices
  ADD COLUMN IF NOT EXISTS push_provider text CHECK (push_provider IN ('apns','webpush')),
  ADD COLUMN IF NOT EXISTS push_endpoint text,           -- APNs: device token; Web Push/UnifiedPush: endpoint URL
  ADD COLUMN IF NOT EXISTS push_keys jsonb,              -- Web Push: { p256dh, auth }
  ADD COLUMN IF NOT EXISTS push_env text,                -- APNs: production | sandbox
  ADD COLUMN IF NOT EXISTS push_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS push_failed_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

-- thông báo (một bản ghi cho mỗi sự kiện; source_ref chống phát trùng giữa nhiều tiến trình)
CREATE TABLE IF NOT EXISTS mobile.notifications (
  id uuid PRIMARY KEY,
  source_ref text UNIQUE NOT NULL,
  kind text NOT NULL CHECK (kind IN ('fire_danger','fire_confirmed','report','assignment','verification','system')),
  title text NOT NULL,
  body text,
  data jsonb NOT NULL DEFAULT '{}',        -- { screen, code, id, commune }
  -- người nhận: user cụ thể | vai trò (+ địa bàn) | công khai theo xã đăng ký
  target_user uuid REFERENCES identity.users(id) ON DELETE CASCADE,
  target_roles text[],
  target_communes text[],
  is_public boolean NOT NULL DEFAULT false,
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal','high')),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user ON mobile.notifications(target_user, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_created ON mobile.notifications(created_at DESC);

-- giao tới từng thiết bị theo kênh; hàng đợi gửi lại có backoff (SKIP LOCKED: nhiều tiến trình cùng xử lý an toàn)
CREATE TABLE IF NOT EXISTS mobile.notification_deliveries (
  id uuid PRIMARY KEY,
  notification_id uuid NOT NULL REFERENCES mobile.notifications(id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES mobile.mobile_devices(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('socket','apns','webpush')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','skipped','failed','gone')),
  attempts int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (notification_id, device_id, channel)
);
CREATE INDEX IF NOT EXISTS deliveries_due ON mobile.notification_deliveries(status, next_attempt_at) WHERE status = 'pending';

-- phát sự kiện cho mọi tiến trình máy chủ: thông báo mới → Socket.IO; bảng hiện trường đổi → làm mới ứng dụng
CREATE OR REPLACE FUNCTION mobile.notify_new_notification() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('mobile_notification', NEW.id::text);
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS notification_created ON mobile.notifications;
CREATE TRIGGER notification_created AFTER INSERT ON mobile.notifications FOR EACH ROW EXECUTE FUNCTION mobile.notify_new_notification();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['mobile.field_assignments','mobile.field_surveys','mobile.incident_verifications','mobile.verification_reviews'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS store_changed ON %s', t);
    EXECUTE format('CREATE TRIGGER store_changed AFTER INSERT OR UPDATE OR DELETE ON %s FOR EACH STATEMENT EXECUTE FUNCTION ops.notify_store_change()', t);
  END LOOP;
END $$;
