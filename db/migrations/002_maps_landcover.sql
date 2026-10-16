-- Phân hệ nhập và quản lý bản đồ PDF/GeoTIFF (theo "Báo cáo chuyên đề nhập bản đồ PDF, GeoTIFF", mục 5)
-- + lớp phủ nhiều năm và mẫu thực địa 2025 từ dữ liệu thực tế dự án.
CREATE SCHEMA IF NOT EXISTS maps;

CREATE TABLE IF NOT EXISTS maps.map_datasets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  category text,                    -- nhóm chủ đề: tai-nguyen-rung, quy-hoach, bien-dong, khi-hau, dia-hinh, hanh-chinh, khac
  source_org text,
  acquisition_date date,
  map_year int,
  map_scale text,                   -- tỷ lệ bản đồ (nếu biết), ví dụ 1:25.000
  license text,
  format text NOT NULL CHECK (format IN ('geotiff','pdf','raster_image','package')),
  access text NOT NULL DEFAULT 'public' CHECK (access IN ('public','internal')),
  status text NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded','processing','needs_georef','ready','pending_review','published','rejected','revoked','failed')),
  georeferenced boolean NOT NULL DEFAULT false,
  display jsonb NOT NULL DEFAULT '{}',   -- cấu hình hiển thị: mode (rgb/single), band, palette, min, max, opacity, clip
  tech jsonb NOT NULL DEFAULT '{}',      -- thông tin kỹ thuật đọc từ tệp
  overlay_url text,                      -- ảnh EPSG:3857 phục vụ Mapbox (sinh bởi worker)
  overlay_bounds jsonb,                  -- [[w,n],[e,n],[e,s],[w,s]]
  preview_url text,
  current_version int NOT NULL DEFAULT 0,
  created_by text, updated_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS map_datasets_status_idx ON maps.map_datasets (status, updated_at DESC);
CREATE INDEX IF NOT EXISTS map_datasets_format_idx ON maps.map_datasets (format, map_year);

CREATE TABLE IF NOT EXISTS maps.map_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id uuid NOT NULL REFERENCES maps.map_datasets(id) ON DELETE CASCADE,
  file_role text NOT NULL CHECK (file_role IN ('original','preview','page_preview','cog','overlay','georef_raster','thumbnail')),
  version_no int NOT NULL DEFAULT 1,
  storage_key text NOT NULL,         -- 'storage:maps/<id>/...' hoặc 'data:Data_thuc_te/...' (tệp bàn giao, không sao chép)
  original_filename text,
  mime_type text,
  size_bytes bigint,
  sha256 text,
  page_no int,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS map_files_dataset_idx ON maps.map_files (dataset_id, file_role);

CREATE TABLE IF NOT EXISTS maps.map_spatial_refs (
  dataset_id uuid PRIMARY KEY REFERENCES maps.map_datasets(id) ON DELETE CASCADE,
  srid int,
  original_wkt text,
  footprint geometry(MultiPolygon, 4326),
  bbox_json jsonb,
  georef_method text,                -- embedded | gcp_affine | gcp_poly2
  gcps jsonb,                        -- [{px,py,lon,lat,residual_m}]
  residual_error numeric,            -- RMSE (m)
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS map_spatial_refs_fp_idx ON maps.map_spatial_refs USING gist (footprint);

CREATE TABLE IF NOT EXISTS maps.map_processing_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id uuid NOT NULL REFERENCES maps.map_datasets(id) ON DELETE CASCADE,
  job_type text NOT NULL CHECK (job_type IN ('inspect','process','georef')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','failed')),
  progress int NOT NULL DEFAULT 0,
  attempts int NOT NULL DEFAULT 0,
  error_code text, error_message text,
  log jsonb NOT NULL DEFAULT '[]',
  started_at timestamptz, completed_at timestamptz,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS map_jobs_queue_idx ON maps.map_processing_jobs (status, created_at);

CREATE TABLE IF NOT EXISTS maps.map_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id uuid NOT NULL REFERENCES maps.map_datasets(id) ON DELETE CASCADE,
  version_no int NOT NULL,
  approved_by text,
  approved_at timestamptz,
  release_note text,
  published_file_id uuid REFERENCES maps.map_files(id),
  snapshot jsonb,
  UNIQUE (dataset_id, version_no)
);

CREATE TABLE IF NOT EXISTS maps.map_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id uuid REFERENCES maps.map_datasets(id) ON DELETE SET NULL,
  actor_id text, action text NOT NULL, details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS map_audit_dataset_idx ON maps.map_audit_logs (dataset_id, created_at DESC);
CREATE OR REPLACE FUNCTION maps.audit_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'map_audit_logs is append-only'; END $$;
DROP TRIGGER IF EXISTS map_audit_no_change ON maps.map_audit_logs;
CREATE TRIGGER map_audit_no_change BEFORE UPDATE OR DELETE ON maps.map_audit_logs FOR EACH ROW EXECUTE FUNCTION maps.audit_append_only();

-- ---------- lớp phủ nhiều năm (dữ liệu thực tế dự án) ----------
CREATE TABLE IF NOT EXISTS imagery.landcover_classes (
  code int PRIMARY KEY, label text NOT NULL, color text
);
CREATE TABLE IF NOT EXISTS imagery.landcover_stats (
  commune_code text NOT NULL, year int NOT NULL, class_code int NOT NULL REFERENCES imagery.landcover_classes(code), area_ha numeric NOT NULL,
  source text NOT NULL DEFAULT 'Data_thuc_te/Lop_phu',
  PRIMARY KEY (commune_code, year, class_code, source)
);
CREATE TABLE IF NOT EXISTS imagery.landcover_transitions (
  period text NOT NULL, from_class int NOT NULL, to_class int NOT NULL, area_ha numeric NOT NULL,
  PRIMARY KEY (period, from_class, to_class)
);

-- ---------- mẫu thực địa ----------
CREATE TABLE IF NOT EXISTS spatial.field_samples (
  id serial PRIMARY KEY,
  campaign text NOT NULL,
  name_raw text, name_vi text, label_code text, label text, is_forest boolean,
  landcover_2023 text, worldcover_2021 int,
  geom geometry(Point, 4326) NOT NULL,
  x_utm numeric, y_utm numeric,
  commune_code text,
  UNIQUE (campaign, x_utm, y_utm, name_raw)
);
CREATE INDEX IF NOT EXISTS field_samples_geom_idx ON spatial.field_samples USING gist (geom);
