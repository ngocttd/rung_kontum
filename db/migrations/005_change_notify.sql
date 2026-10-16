-- Đồng bộ web ↔ mobile ↔ tiến trình nền: mỗi lệnh ghi vào các bảng nghiệp vụ phát NOTIFY 'store_changed'
-- (tên bảng + pid phiên ghi). Máy chủ ứng dụng LISTEN và nạp lại bộ nhớ đệm tương ứng (src/data/store.js),
-- nên dữ liệu ghi từ tiến trình khác (script, máy chủ thứ hai) hiện ngay trên web và MobileGIS.
CREATE OR REPLACE FUNCTION ops.notify_store_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('store_changed', TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME || ':' || pg_backend_pid());
  RETURN NULL;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['identity.users','ops.reports','ops.decisions','ops.articles','ops.documents','ops.jobs','spatial.map_layers','ops.counters'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS store_changed ON %s', t);
    EXECUTE format('CREATE TRIGGER store_changed AFTER INSERT OR UPDATE OR DELETE ON %s FOR EACH STATEMENT EXECUTE FUNCTION ops.notify_store_change()', t);
  END LOOP;
END $$;
