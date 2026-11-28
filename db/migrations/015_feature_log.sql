-- Nhật ký biến động từng đối tượng của lớp vector (lô rừng trong bản đồ kiểm kê/hiện trạng…): thêm mới, sửa thuộc tính,
-- sửa ranh, xoá – ghi người thực hiện, thời điểm, lý do, giá trị trước và sau để truy vết diễn biến rừng.
CREATE TABLE IF NOT EXISTS spatial.layer_feature_log (
  id bigserial PRIMARY KEY,
  layer_id uuid NOT NULL REFERENCES spatial.map_layers(id) ON DELETE CASCADE,
  fid int NOT NULL,
  action text NOT NULL CHECK (action IN ('add', 'update', 'geometry', 'delete')),
  before jsonb, after jsonb,
  geom_before geometry(Geometry, 4326),
  reason text,
  username text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS layer_feature_log_layer_idx ON spatial.layer_feature_log (layer_id, created_at DESC);
