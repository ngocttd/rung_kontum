-- Chủ rừng và thông báo gửi chủ rừng: khi phát hiện nghi vấn mất rừng / cháy rừng, kiểm lâm báo cho chủ rừng của khu vực
-- (Ban quản lý rừng, công ty lâm nghiệp, UBND xã, cộng đồng, hộ gia đình…) kiểm tra hiện trường và phản hồi kết quả.
CREATE TABLE IF NOT EXISTS ops.forest_owners (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'other',
  contact_name text, phone text, email text,
  communes text,                              -- mã xã phụ trách, cách nhau dấu phẩy (rỗng = xác định theo lớp bản đồ chủ rừng)
  user_id uuid REFERENCES identity.users(id) ON DELETE SET NULL,  -- tài khoản nhận thông báo trong MobileGIS (nếu có)
  active boolean NOT NULL DEFAULT true,
  data jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS store_changed ON ops.forest_owners;
CREATE TRIGGER store_changed AFTER INSERT OR UPDATE OR DELETE ON ops.forest_owners FOR EACH STATEMENT EXECUTE FUNCTION ops.notify_store_change();

CREATE TABLE IF NOT EXISTS ops.owner_notices (
  id uuid PRIMARY KEY,
  code text UNIQUE NOT NULL,                  -- TB-<năm>-<số>
  owner_id uuid REFERENCES ops.forest_owners(id) ON DELETE SET NULL,
  owner_name text NOT NULL,
  kind text NOT NULL,                         -- hotspot | candidate | zone | other
  ref_id text,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'seen', 'acknowledged', 'responded', 'closed')),
  token text UNIQUE NOT NULL,                 -- liên kết riêng để chủ rừng xem và phản hồi không cần tài khoản
  commune_code text,
  sent_by text,
  data jsonb NOT NULL DEFAULT '{}',           -- nội dung, toạ độ, diện tích, phản hồi của chủ rừng, lịch sử
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS owner_notices_status_idx ON ops.owner_notices (status, created_at DESC);
DROP TRIGGER IF EXISTS store_changed ON ops.owner_notices;
CREATE TRIGGER store_changed AFTER INSERT OR UPDATE OR DELETE ON ops.owner_notices FOR EACH STATEMENT EXECUTE FUNCTION ops.notify_store_change();
