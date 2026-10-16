// PostGIS backend for src/data/store.js: maps the store's collections to tables and applies
// writes in order (write-through). Reads stay in memory for speed; load() fills the cache.
const { query } = require('./pool');

const J = (v) => (v === undefined ? null : JSON.stringify(v));

// cols: columns stored natively; everything else goes to the `data` jsonb column.
const MAP = {
  users: { table: 'identity.users', cols: ['id', 'username', 'name', 'email', 'role', 'scope', 'active', 'password_hash', 'last_login', 'created_at', 'updated_at'] },
  audit: { table: 'identity.audit_logs', cols: ['id', 'username', 'role', 'action', 'target', 'detail', 'created_at', 'updated_at'], json: ['detail'], appendOnly: true, noData: true,
    to: (r) => ({ ...r, username: r.user }), from: (r) => ({ ...r, user: r.username }) },
  reports: { table: 'ops.reports', cols: ['id', 'code', 'type', 'status', 'description', 'location_text', 'observed_at', 'commune_code', 'commune_name', 'reporter', 'photos', 'public', 'public_photos', 'assigned_to', 'response', 'timeline', 'created_at', 'updated_at'],
    json: ['reporter', 'timeline'], geom: true },
  decisions: { table: 'ops.decisions', cols: ['id', 'kind', 'ref_id', 'status', 'note', 'assignee', 'history', 'created_at', 'updated_at'], json: ['history'] },
  articles: { table: 'ops.articles', cols: ['id', 'slug', 'title', 'category', 'status', 'summary', 'body', 'image', 'source_url', 'author', 'views', 'published_at', 'created_at', 'updated_at'] },
  documents: { table: 'ops.documents', cols: ['id', 'title', 'category', 'issuer', 'number', 'issued', 'description', 'type', 'bytes', 'sha256', 'original_name', 'stored_name', 'status', 'uploaded_by', 'created_at', 'updated_at'] },
  jobs: { table: 'ops.jobs', cols: ['id', 'key', 'title', 'status', 'started_at', 'finished_at', 'by', 'log', 'created_at', 'updated_at'], json: ['log'] },
  layers: { table: 'spatial.map_layers', cols: ['id', 'title', 'source', 'description', 'status', 'style', 'validation', 'original_name', 'uploaded_by', 'reviewed_by', 'created_at', 'updated_at'], json: ['style', 'validation'], features: true },
  counters: { table: 'ops.counters', cols: ['key', 'value'], pk: 'key', noData: true, from: (r) => ({ id: r.key, ...r }) },
};

function rowOf(name, rec) {
  const m = MAP[name];
  const r = m.to ? m.to(rec) : rec;
  const row = {};
  // fields absent from the record are left out so column defaults apply (e.g. NOT NULL booleans), not forced to NULL
  for (const c of m.cols) { if (r[c] === undefined) continue; row[c] = m.json && m.json.includes(c) ? J(r[c]) : r[c]; }
  if (!m.noData) {
    const skip = new Set([...m.cols, 'lat', 'lon', 'geojson', 'user']);
    row.data = J(Object.fromEntries(Object.entries(rec).filter(([k]) => !skip.has(k))));
  }
  return row;
}

async function upsert(name, rec) {
  const m = MAP[name];
  const row = rowOf(name, rec);
  const cols = Object.keys(row);
  const vals = cols.map((c) => row[c]);
  let geomSql = '';
  if (m.geom) {
    cols.push('geom');
    const ok = Number.isFinite(rec.lat) && Number.isFinite(rec.lon);
    vals.push(ok ? rec.lon : null, ok ? rec.lat : null);
    geomSql = 'geom';
  }
  const ph = cols.map((c, i) => (c === geomSql ? `CASE WHEN $${i + 1}::float8 IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($${i + 1}, $${i + 2}), 4326) END` : `$${i + 1}`));
  const pk = m.pk || 'id';
  const set = cols.filter((c) => c !== pk && c !== 'created_at').map((c) => `${c} = EXCLUDED.${c}`).join(', ');
  const sql = `INSERT INTO ${m.table} (${cols.join(', ')}) VALUES (${ph.join(', ')}) ON CONFLICT (${pk}) ${m.appendOnly ? 'DO NOTHING' : `DO UPDATE SET ${set}`}`;
  await query(sql, vals);
  if (m.features) {
    await query('DELETE FROM spatial.layer_features WHERE layer_id = $1', [rec.id]);
    const feats = rec.geojson && rec.geojson.features ? rec.geojson.features : [];
    for (let i = 0; i < feats.length; i += 500) {
      const chunk = feats.slice(i, i + 500);
      await query(`INSERT INTO spatial.layer_features (layer_id, fid, geom, props)
        SELECT $1, (f->>'i')::int, ST_SetSRID(ST_GeomFromGeoJSON(f->>'g'), 4326), (f->'p') FROM jsonb_array_elements($2::jsonb) f`,
      [rec.id, JSON.stringify(chunk.map((f, k) => ({ i: i + k, g: JSON.stringify(f.geometry), p: f.properties || {} })))]);
    }
  }
}

async function remove(name, id) {
  const m = MAP[name];
  if (m.appendOnly) return;
  await query(`DELETE FROM ${m.table} WHERE ${m.pk || 'id'} = $1`, [id]);
}

async function loadCollection(name) {
  const m = MAP[name];
  const extra = m.geom ? ', ST_Y(geom) AS lat, ST_X(geom) AS lon' : '';
  const r = await query(`SELECT * ${extra} FROM ${m.table} ORDER BY ${m.pk === 'key' ? 'key' : 'created_at'}`);
  const rows = [];
  for (const row of r.rows) {
    const { data, geom, ...rest } = row; // eslint-disable-line no-unused-vars
    let rec = { ...(data || {}), ...rest };
    if (m.from) rec = m.from(rec);
    if (m.features) {
      const f = await query('SELECT ST_AsGeoJSON(geom)::json AS g, props FROM spatial.layer_features WHERE layer_id = $1 ORDER BY fid', [rec.id]);
      rec.geojson = f.rowCount ? { type: 'FeatureCollection', features: f.rows.map((x) => ({ type: 'Feature', geometry: x.g, properties: x.props })) } : null;
    }
    rows.push(rec);
  }
  return rows;
}

module.exports = { MAP, upsert, remove, loadCollection };
