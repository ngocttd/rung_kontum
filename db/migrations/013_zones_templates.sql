-- Vùng khoanh vẽ trên web (cán bộ khoanh vùng nghi vấn khi giải đoán ảnh vệ tinh rồi giao kiểm tra hiện trường) và
-- mẫu báo cáo do đơn vị tải lên (hệ thống nhận dạng cột/ô của mẫu để xuất báo cáo theo đúng mẫu mới).
CREATE TABLE IF NOT EXISTS ops.zones (
  id uuid PRIMARY KEY,
  code text UNIQUE NOT NULL,                 -- KV-<năm>-<số>
  title text NOT NULL,
  kind text NOT NULL DEFAULT 'forest_loss',
  status text NOT NULL DEFAULT 'new',        -- new | assigned | verified | rejected | closed
  note text,
  commune_code text, commune_name text,
  area_ha numeric,
  created_by text,
  data jsonb NOT NULL DEFAULT '{}',          -- geometry (GeoJSON WGS84), nguồn ảnh, nhiệm vụ đã giao…
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS zones_status_idx ON ops.zones (status, created_at DESC);
DROP TRIGGER IF EXISTS store_changed ON ops.zones;
CREATE TRIGGER store_changed AFTER INSERT OR UPDATE OR DELETE ON ops.zones
  FOR EACH STATEMENT EXECUTE FUNCTION ops.notify_store_change();

CREATE TABLE IF NOT EXISTS ops.report_templates (
  id uuid PRIMARY KEY,
  report_key text NOT NULL,                  -- loại báo cáo: forest_status | change_suspects | reports | field_records …
  title text NOT NULL,
  original_name text, stored_name text,
  active boolean NOT NULL DEFAULT true,
  uploaded_by text,
  data jsonb NOT NULL DEFAULT '{}',          -- mapping: sheet, dòng tiêu đề, cột ↔ trường dữ liệu, ô thông tin chung
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS report_templates_key_idx ON ops.report_templates (report_key, active);
DROP TRIGGER IF EXISTS store_changed ON ops.report_templates;
CREATE TRIGGER store_changed AFTER INSERT OR UPDATE OR DELETE ON ops.report_templates
  FOR EACH STATEMENT EXECUTE FUNCTION ops.notify_store_change();
