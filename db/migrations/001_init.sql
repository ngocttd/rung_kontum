-- WebGIS rừng Kon Tum – schema khởi tạo (PostgreSQL 16+/PostGIS 3.4+)
-- Nhóm bảng theo đặc tả v1.1: identity, spatial, imagery, fire, ops.
-- Trao đổi EPSG:4326; diện tích tính bằng EPSG:32648 (UTM 48N). Thời gian lưu timestamptz (UTC).

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS identity;
CREATE SCHEMA IF NOT EXISTS spatial;
CREATE SCHEMA IF NOT EXISTS imagery;
CREATE SCHEMA IF NOT EXISTS fire;
CREATE SCHEMA IF NOT EXISTS ops;

-- ---------- identity ----------
CREATE TABLE IF NOT EXISTS identity.users (
  id uuid PRIMARY KEY,
  username text UNIQUE NOT NULL,
  name text, email text,
  role text NOT NULL CHECK (role IN ('admin','leader','specialist')),
  scope text,                                   -- mã xã giới hạn phạm vi (null = toàn vùng)
  active boolean NOT NULL DEFAULT true,
  password_hash text NOT NULL,
  last_login timestamptz,
  data jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS identity.audit_logs (
  id uuid PRIMARY KEY,
  username text, role text, action text NOT NULL, target text, detail jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_logs_time_idx ON identity.audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_action_idx ON identity.audit_logs (action);

-- ---------- spatial ----------
CREATE TABLE IF NOT EXISTS spatial.boundary_versions (
  id text PRIMARY KEY,                          -- ví dụ 'kontum-2020-hdx', 'communes-v5.2.0'
  title text NOT NULL, source text, valid_from date, valid_to date, note text,
  imported_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS spatial.admin_units (
  code text NOT NULL,
  version_id text NOT NULL REFERENCES spatial.boundary_versions(id),
  level text NOT NULL CHECK (level IN ('province','commune')),
  name text NOT NULL, full_name text,
  area_km2 numeric, overlap_fraction numeric,
  clipped boolean NOT NULL DEFAULT false,       -- true: bản cắt theo ranh Kon Tum cũ
  geom geometry(MultiPolygon, 4326) NOT NULL,
  props jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (code, version_id, clipped)
);
CREATE INDEX IF NOT EXISTS admin_units_geom_idx ON spatial.admin_units USING gist (geom);

CREATE TABLE IF NOT EXISTS spatial.forest_statistics (
  commune_code text NOT NULL,
  as_of date NOT NULL,
  decision text NOT NULL,
  natural_area_ha numeric, established_forest_ha numeric, natural_forest_ha numeric,
  established_plantation_ha numeric, immature_plantation_ha numeric,
  special_use_ha numeric, protection_ha numeric, production_ha numeric, planning_ha numeric,
  cover_percent numeric,
  source_url text, source_sheet text, source_row int, match_method text, scope text,
  PRIMARY KEY (commune_code, as_of)
);

CREATE TABLE IF NOT EXISTS spatial.map_layers (
  id uuid PRIMARY KEY,
  title text NOT NULL, source text, description text,
  status text NOT NULL CHECK (status IN ('staging','published','invalid')),
  style jsonb, validation jsonb, original_name text, uploaded_by text, reviewed_by text,
  data jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS spatial.layer_features (
  layer_id uuid NOT NULL REFERENCES spatial.map_layers(id) ON DELETE CASCADE,
  fid int NOT NULL,
  geom geometry(Geometry, 4326) NOT NULL,
  props jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (layer_id, fid)
);
CREATE INDEX IF NOT EXISTS layer_features_geom_idx ON spatial.layer_features USING gist (geom);

-- ---------- imagery / forest change ----------
CREATE TABLE IF NOT EXISTS imagery.forest_loss_annual (
  commune_code text NOT NULL, year int NOT NULL, loss_ha numeric NOT NULL,
  source text NOT NULL DEFAULT 'Hansen GFC v1.12',
  PRIMARY KEY (commune_code, year, source)
);

CREATE TABLE IF NOT EXISTS imagery.model_runs (
  id text PRIMARY KEY,                          -- product + generated_at
  product text NOT NULL, generated_at timestamptz NOT NULL,
  horizon text, model text, validation jsonb, status text, meta jsonb
);

CREATE TABLE IF NOT EXISTS imagery.loss_risk_commune (
  run_id text NOT NULL REFERENCES imagery.model_runs(id) ON DELETE CASCADE,
  commune_code text NOT NULL,
  mean_probability numeric, expected_loss_ha numeric, high_risk_ha numeric, forest_cells int, class_cells jsonb,
  PRIMARY KEY (run_id, commune_code)
);

CREATE TABLE IF NOT EXISTS imagery.change_candidates (
  id text PRIMARY KEY,
  run_id text REFERENCES imagery.model_runs(id) ON DELETE SET NULL,
  window_label text, area_ha numeric, mean_dndvi numeric, mean_dnbr numeric,
  commune_code text, seasonal_leaf_fall_possible boolean, evidence text,
  geom geometry(MultiPolygon, 4326) NOT NULL,
  centroid geometry(Point, 4326),
  detected_at timestamptz NOT NULL DEFAULT now(),
  active boolean NOT NULL DEFAULT true          -- false khi lượt tính mới không còn phát hiện
);
CREATE INDEX IF NOT EXISTS change_candidates_geom_idx ON imagery.change_candidates USING gist (geom);

-- ---------- fire ----------
CREATE TABLE IF NOT EXISTS fire.hotspots (
  id text PRIMARY KEY,                          -- sensor-date-time-lat-lon
  sensor text NOT NULL, satellite text, acq_utc timestamptz NOT NULL,
  confidence text, frp numeric, brightness numeric, daynight text, version text,
  commune_code text, in_forest boolean, landcover text,
  geom geometry(Point, 4326) NOT NULL,
  raw jsonb NOT NULL,
  source text NOT NULL DEFAULT 'FIRMS NRT',
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hotspots_geom_idx ON fire.hotspots USING gist (geom);
CREATE INDEX IF NOT EXISTS hotspots_time_idx ON fire.hotspots (acq_utc DESC);

CREATE TABLE IF NOT EXISTS fire.hotspot_history (   -- GEE FIRMS 1 km pixels, dùng kiểm định
  date date NOT NULL, geom geometry(Point, 4326) NOT NULL, t21_k numeric, confidence numeric,
  commune_code text, source text NOT NULL,
  PRIMARY KEY (date, geom, source)
);

CREATE TABLE IF NOT EXISTS fire.danger_daily (
  commune_code text NOT NULL, date_local date NOT NULL,
  run_id text NOT NULL,
  input_source text, temperature_c numeric, rh_percent numeric, wind_kmh numeric, rain24h_mm numeric,
  nesterov_p numeric, nesterov_class int CHECK (nesterov_class BETWEEN 1 AND 5),
  ffmc numeric, dmc numeric, dc numeric, isi numeric, bui numeric, fwi numeric,
  PRIMARY KEY (commune_code, date_local)
);
CREATE INDEX IF NOT EXISTS danger_daily_date_idx ON fire.danger_daily (date_local);

-- ---------- ops (vận hành) ----------
CREATE TABLE IF NOT EXISTS ops.reports (
  id uuid PRIMARY KEY,
  code text UNIQUE NOT NULL,
  type text NOT NULL, status text NOT NULL,
  description text, location_text text, observed_at text,
  commune_code text, commune_name text,
  geom geometry(Point, 4326),
  reporter jsonb NOT NULL DEFAULT '{}',          -- thông tin người gửi: chỉ cán bộ đọc
  photos text[] NOT NULL DEFAULT '{}',
  public boolean NOT NULL DEFAULT false, public_photos boolean NOT NULL DEFAULT false,
  assigned_to text, response text,
  timeline jsonb NOT NULL DEFAULT '[]',
  data jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reports_geom_idx ON ops.reports USING gist (geom);
CREATE INDEX IF NOT EXISTS reports_status_idx ON ops.reports (status, created_at DESC);

CREATE TABLE IF NOT EXISTS ops.decisions (            -- xác minh điểm nóng, biến động, phê duyệt cảnh báo
  id uuid PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('hotspot','candidate','fire_danger')),
  ref_id text NOT NULL,
  status text NOT NULL, note text, assignee text,
  history jsonb NOT NULL DEFAULT '[]',
  data jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, ref_id)
);

CREATE TABLE IF NOT EXISTS ops.articles (
  id uuid PRIMARY KEY,
  slug text UNIQUE NOT NULL, title text NOT NULL, category text, status text NOT NULL,
  summary text, body text, image text, source_url text, author text,
  views int NOT NULL DEFAULT 0, published_at timestamptz,
  data jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS articles_status_idx ON ops.articles (status, published_at DESC);

CREATE TABLE IF NOT EXISTS ops.documents (
  id uuid PRIMARY KEY,
  title text NOT NULL, category text, issuer text, number text, issued date,
  description text, type text, bytes bigint, sha256 text, original_name text, stored_name text,
  status text NOT NULL, uploaded_by text,
  data jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ops.jobs (
  id uuid PRIMARY KEY,
  key text NOT NULL, title text, status text NOT NULL, started_at timestamptz, finished_at timestamptz,
  by text, log jsonb NOT NULL DEFAULT '[]',
  data jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ops.counters (
  key text PRIMARY KEY, value int NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ops.schema_migrations (
  name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()
);

-- Nhật ký chỉ ghi thêm: chặn UPDATE/DELETE kể cả với tài khoản ứng dụng.
CREATE OR REPLACE FUNCTION identity.audit_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'audit_logs is append-only'; END $$;
DROP TRIGGER IF EXISTS audit_no_change ON identity.audit_logs;
CREATE TRIGGER audit_no_change BEFORE UPDATE OR DELETE ON identity.audit_logs
  FOR EACH ROW EXECUTE FUNCTION identity.audit_append_only();
