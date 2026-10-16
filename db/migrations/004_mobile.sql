-- MobileGIS (Đặc tả MobileGIS v1.0, mục 7): tài khoản người dân, phiên di động, nhiệm vụ hiện trường,
-- khảo sát, xác minh (bất biến), đồng bộ ngoại tuyến (idempotency, xung đột), thông báo.

-- Người dân có tài khoản (gửi/theo dõi phản ánh của mình)
ALTER TABLE identity.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE identity.users ADD CONSTRAINT users_role_check CHECK (role IN ('admin','leader','specialist','citizen'));

CREATE SCHEMA IF NOT EXISTS mobile;

-- refresh token chỉ lưu dạng băm; thu hồi khi đăng xuất / đổi mật khẩu (TC12)
CREATE TABLE IF NOT EXISTS mobile.refresh_tokens (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  token_hash text UNIQUE NOT NULL,
  device_id uuid,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
CREATE INDEX IF NOT EXISTS refresh_tokens_user ON mobile.refresh_tokens(user_id);

-- không lưu định danh phần cứng; id do ứng dụng sinh ngẫu nhiên khi cài
CREATE TABLE IF NOT EXISTS mobile.mobile_devices (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES identity.users(id) ON DELETE SET NULL,
  platform text, app_version text,
  push_token text,
  subscribed_communes text[] NOT NULL DEFAULT '{}',
  last_sync_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- nhiệm vụ hiện trường giao theo địa bàn (scope_id = mã xã)
CREATE TABLE IF NOT EXISTS mobile.field_assignments (
  id uuid PRIMARY KEY,
  code text UNIQUE NOT NULL,
  kind text NOT NULL CHECK (kind IN ('hotspot','candidate','report','survey')),
  ref_id text,
  title text NOT NULL,
  instructions text,
  scope_id text,
  geom geometry(Point, 4326),
  assignee_id uuid REFERENCES identity.users(id) ON DELETE SET NULL,
  created_by text,
  due_at timestamptz,
  status text NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned','accepted','in_progress','submitted','approved','returned','cancelled')),
  version int NOT NULL DEFAULT 1,
  history jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS field_assignments_assignee ON mobile.field_assignments(assignee_id, status);
CREATE INDEX IF NOT EXISTS field_assignments_scope ON mobile.field_assignments(scope_id);

-- khảo sát / cập nhật hiện trạng (điểm, đường, vùng); rừng khộp ghi mùa và trạng thái rụng lá (6.3)
CREATE TABLE IF NOT EXISTS mobile.field_surveys (
  id uuid PRIMARY KEY,
  code text UNIQUE NOT NULL,
  client_uuid uuid UNIQUE,
  assignment_id uuid REFERENCES mobile.field_assignments(id) ON DELETE SET NULL,
  surveyor_id uuid REFERENCES identity.users(id) ON DELETE SET NULL,
  surveyor text NOT NULL,
  commune_code text,
  geom geometry(Geometry, 4326) NOT NULL,
  geom_type text NOT NULL CHECK (geom_type IN ('point','line','polygon')),
  area_ha numeric, length_m numeric,
  forest_type text,
  is_dipterocarp boolean NOT NULL DEFAULT false,
  season text CHECK (season IN ('dry','wet')),
  leaf_state text CHECK (leaf_state IN ('full','partial','leafless','unknown')),
  canopy_cover numeric CHECK (canopy_cover BETWEEN 0 AND 100),
  change_cause text,
  notes text,
  observed_at timestamptz NOT NULL,
  gps_accuracy numeric,
  location_source text NOT NULL DEFAULT 'gps' CHECK (location_source IN ('gps','manual','map')),
  status text NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review','approved','rejected')),
  reviewer text, reviewed_at timestamptz, review_note text,
  version int NOT NULL DEFAULT 1,
  history jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS field_surveys_geom ON mobile.field_surveys USING gist(geom);

-- tệp đính kèm (ảnh/video) – lưu trên kho tệp, DB chỉ giữ khoá đối tượng
CREATE TABLE IF NOT EXISTS mobile.field_attachments (
  id uuid PRIMARY KEY,
  owner_kind text NOT NULL CHECK (owner_kind IN ('report','survey','verification')),
  owner_id text,
  object_key text UNIQUE NOT NULL,
  mime text NOT NULL,
  bytes bigint,
  captured_at timestamptz,
  lat double precision, lon double precision, gps_accuracy numeric,
  uploaded_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- kết quả xác minh: lịch sử bất biến (chỉ thêm), duyệt bằng bản ghi mới
CREATE TABLE IF NOT EXISTS mobile.incident_verifications (
  id uuid PRIMARY KEY,
  code text UNIQUE NOT NULL,
  client_uuid uuid UNIQUE,
  alert_kind text NOT NULL CHECK (alert_kind IN ('hotspot','candidate','report')),
  alert_id text NOT NULL,
  assignment_id uuid REFERENCES mobile.field_assignments(id) ON DELETE SET NULL,
  verdict text NOT NULL,
  severity text,
  forest_type text,
  burned_area_ha numeric,
  recommendation text,
  evidence jsonb NOT NULL DEFAULT '{}',
  geom geometry(Point, 4326),
  gps_accuracy numeric,
  verifier_id uuid REFERENCES identity.users(id) ON DELETE SET NULL,
  verifier text NOT NULL,
  verified_at timestamptz NOT NULL,
  review_status text NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending','approved','rejected')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS mobile.verification_reviews (
  id uuid PRIMARY KEY,
  verification_id uuid NOT NULL REFERENCES mobile.incident_verifications(id),
  decision text NOT NULL CHECK (decision IN ('approved','rejected')),
  note text,
  reviewer text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION mobile.verification_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- chỉ cho phép đổi review_status (do bản ghi duyệt kéo theo); nội dung xác minh không sửa, không xoá
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'incident_verifications là lịch sử bất biến'; END IF;
  IF (to_jsonb(NEW) - 'review_status') IS DISTINCT FROM (to_jsonb(OLD) - 'review_status') THEN
    RAISE EXCEPTION 'incident_verifications là lịch sử bất biến';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS verification_immutable ON mobile.incident_verifications;
CREATE TRIGGER verification_immutable BEFORE UPDATE OR DELETE ON mobile.incident_verifications
  FOR EACH ROW EXECUTE FUNCTION mobile.verification_guard();

-- đồng bộ ngoại tuyến: client_uuid là khoá idempotency; xung đột lưu lại để xử lý, không ghi đè
CREATE TABLE IF NOT EXISTS mobile.mobile_sync_events (
  id uuid PRIMARY KEY,
  client_uuid uuid NOT NULL,
  user_id uuid REFERENCES identity.users(id) ON DELETE SET NULL,
  device_id uuid,
  entity text NOT NULL,
  operation text NOT NULL,
  base_version int,
  server_version int,
  result text NOT NULL CHECK (result IN ('applied','duplicate','conflict','rejected')),
  server_id text,
  message text,
  payload jsonb,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_uuid, entity)
);

CREATE TABLE IF NOT EXISTS mobile.notification_receipts (
  id uuid PRIMARY KEY,
  alert_id text NOT NULL,
  kind text NOT NULL,
  title text NOT NULL,
  body text,
  link text,
  user_id uuid REFERENCES identity.users(id) ON DELETE CASCADE,
  sent_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  UNIQUE (alert_id, user_id)
);
