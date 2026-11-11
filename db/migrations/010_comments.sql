-- Bình luận tin bài (trang Tin tức): người đọc gửi bình luận (khách nhập tên, hoặc tài khoản người dân đăng nhập web),
-- bình luận chỉ hiện công khai sau khi biên tập viên duyệt (Quản trị › Tin bài › Bình luận).
CREATE TABLE IF NOT EXISTS ops.article_comments (
  id uuid PRIMARY KEY,
  article_id uuid NOT NULL REFERENCES ops.articles(id) ON DELETE CASCADE,
  name text NOT NULL,
  user_id uuid REFERENCES identity.users(id) ON DELETE SET NULL,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'hidden')),
  reviewed_by text,
  data jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS article_comments_article_idx ON ops.article_comments (article_id, status, created_at);

DROP TRIGGER IF EXISTS store_changed ON ops.article_comments;
CREATE TRIGGER store_changed AFTER INSERT OR UPDATE OR DELETE ON ops.article_comments
  FOR EACH STATEMENT EXECUTE FUNCTION ops.notify_store_change();
