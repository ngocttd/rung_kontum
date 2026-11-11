-- Phân tích biến động rừng theo thời gian tuỳ chọn (Quản trị → Phân tích Python). Mỗi lần chạy là một "kỳ phân tích":
-- tham số (kỳ, đối chứng, ngưỡng), người chạy, kết quả (số vùng, diện tích, độ phủ ảnh), trạng thái công bố.
-- Kết quả chỉ hiện ra bản đồ công khai khi người có quyền (cán bộ chuyên môn/lãnh đạo) công bố.
CREATE TABLE IF NOT EXISTS imagery.change_runs (
  id uuid PRIMARY KEY,
  code text UNIQUE NOT NULL,                       -- PT-<năm>-<số>
  title text,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  params jsonb NOT NULL DEFAULT '{}',
  summary jsonb,
  published boolean NOT NULL DEFAULT false,
  published_by text, published_at timestamptz,
  created_by text,
  data jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS change_runs_published_idx ON imagery.change_runs (published, created_at DESC);

DROP TRIGGER IF EXISTS store_changed ON imagery.change_runs;
CREATE TRIGGER store_changed AFTER INSERT OR UPDATE OR DELETE ON imagery.change_runs
  FOR EACH STATEMENT EXECUTE FUNCTION ops.notify_store_change();
