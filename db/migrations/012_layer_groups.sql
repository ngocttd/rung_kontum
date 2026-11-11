-- Danh mục nhóm lớp bản đồ (Quản trị › Dữ liệu không gian › Danh mục nhóm lớp): tên nhóm, mục lớn (section), thẻ
-- Chuyên đề/Dữ liệu nền, thứ tự, ẩn. Nhóm mặc định định nghĩa trong src/services/layerCatalog.js; dòng ở đây đè lên nhóm
-- mặc định cùng key hoặc tạo nhóm mới do quản trị thêm.
CREATE TABLE IF NOT EXISTS spatial.layer_groups (
  key text PRIMARY KEY,
  title text,
  section text,
  tab text CHECK (tab IS NULL OR tab IN ('theme', 'base')),
  sort integer,
  hidden boolean,
  deleted boolean,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS store_changed ON spatial.layer_groups;
CREATE TRIGGER store_changed AFTER INSERT OR UPDATE OR DELETE ON spatial.layer_groups
  FOR EACH STATEMENT EXECUTE FUNCTION ops.notify_store_change();
