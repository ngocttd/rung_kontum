-- Điểm cháy nhập thủ công (kiểm lâm, tổ chống cháy, người dân báo tin, từ phản ánh hiện trường).
-- Đi chung luồng với điểm nóng FIRMS: cùng danh sách, bản đồ, quy trình xác minh (ops.decisions kind='hotspot',
-- ref_id = 'man-<code>') và thông báo MobileGIS. Nguồn được ghi rõ để không lẫn với phát hiện vệ tinh.
CREATE TABLE IF NOT EXISTS fire.manual_points (
  id uuid PRIMARY KEY,
  code text UNIQUE NOT NULL,                       -- CH-<năm>-<số>
  observed_at timestamptz NOT NULL,                -- thời điểm phát hiện
  source_kind text NOT NULL,                       -- kiem-lam | chong-chay | nguoi-dan | phan-anh | khac
  description text,
  area_ha numeric,                                 -- diện tích ước tính (nếu có)
  commune_code text, commune_name text,
  report_code text,                                -- phản ánh hiện trường gốc (nếu tạo từ phản ánh)
  created_by text,
  geom geometry(Point, 4326) NOT NULL,
  data jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS manual_points_geom_idx ON fire.manual_points USING gist (geom);
CREATE INDEX IF NOT EXISTS manual_points_time_idx ON fire.manual_points (observed_at DESC);

DROP TRIGGER IF EXISTS store_changed ON fire.manual_points;
CREATE TRIGGER store_changed AFTER INSERT OR UPDATE OR DELETE ON fire.manual_points
  FOR EACH STATEMENT EXECUTE FUNCTION ops.notify_store_change();
