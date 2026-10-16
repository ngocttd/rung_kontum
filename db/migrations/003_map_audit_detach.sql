-- Nhật ký bản đồ chỉ ghi thêm, nhưng cho phép gỡ liên kết dataset_id khi bộ dữ liệu bị xoá (ON DELETE SET NULL);
-- mọi cột khác giữ nguyên để truy vết.
CREATE OR REPLACE FUNCTION maps.audit_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.dataset_id IS NULL AND OLD.dataset_id IS NOT NULL
     AND NEW.actor_id IS NOT DISTINCT FROM OLD.actor_id AND NEW.action = OLD.action
     AND NEW.details IS NOT DISTINCT FROM OLD.details AND NEW.created_at = OLD.created_at THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'map_audit_logs is append-only';
END $$;
