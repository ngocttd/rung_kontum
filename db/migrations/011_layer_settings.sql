-- Cấu hình hiển thị lớp bản đồ do quản trị chỉnh (Quản trị › Dữ liệu không gian): ẩn/hiện trên bản đồ công khai,
-- đổi tên, nhóm, thứ tự, bật sẵn khi mở bản đồ, hiện trong trang Tài nguyên rừng. Lớp không có dòng ở đây dùng mặc định
-- của danh mục (src/services/layerCatalog.js). id = mã lớp (vd 'lc-2023', 'm-<uuid bản đồ chuyên đề>', 'c-<uuid lớp vector>').
CREATE TABLE IF NOT EXISTS spatial.layer_settings (
  id text PRIMARY KEY,
  hidden boolean,
  title text,
  grp text,
  sort integer,
  default_on boolean,
  on_forest boolean,
  updated_by text,
  data jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS store_changed ON spatial.layer_settings;
CREATE TRIGGER store_changed AFTER INSERT OR UPDATE OR DELETE ON spatial.layer_settings
  FOR EACH STATEMENT EXECUTE FUNCTION ops.notify_store_change();
