// Minimal planar geometry helpers for lon/lat lookups (no external GIS dependency).

function ringContains(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function polygonContains(rings, x, y) {
  if (!ringContains(rings[0], x, y)) return false;
  for (let k = 1; k < rings.length; k++) if (ringContains(rings[k], x, y)) return false;
  return true;
}

function geometryContains(geom, x, y) {
  if (!geom) return false;
  if (geom.type === 'Polygon') return polygonContains(geom.coordinates, x, y);
  if (geom.type === 'MultiPolygon') return geom.coordinates.some((p) => polygonContains(p, x, y));
  return false;
}

function bbox(geom) {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  for (const p of polys) for (const [x, y] of p[0]) {
    if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

// Builds a lookup function over a FeatureCollection with bbox pre-filtering.
function indexFeatures(fc, idProp) {
  const items = fc.features.map((f) => ({ id: f.properties[idProp], geom: f.geometry, box: bbox(f.geometry), f }));
  return (lon, lat) => {
    for (const it of items) {
      const [a, b, c, d] = it.box;
      if (lon < a || lon > c || lat < b || lat > d) continue;
      if (geometryContains(it.geom, lon, lat)) return it.f;
    }
    return null;
  };
}

function centroid(geom) {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  let best = null; let bestArea = -1;
  for (const p of polys) {
    const ring = p[0]; let a = 0; let cx = 0; let cy = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
      a += f; cx += (ring[j][0] + ring[i][0]) * f; cy += (ring[j][1] + ring[i][1]) * f;
    }
    if (Math.abs(a) > bestArea) { bestArea = Math.abs(a); best = [cx / (3 * a), cy / (3 * a)]; }
  }
  return best;
}

module.exports = { geometryContains, indexFeatures, bbox, centroid };
