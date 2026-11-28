// Search accepts GPS (latitude, longitude), GeoJSON (longitude, latitude), and WKT points.
function parseWgs84(value) {
  const text = String(value || '').trim().replace(/^(?:WGS\s*84|EPSG\s*:\s*4326)\s*:?\s*/i, '');
  const point = text.match(/^POINT\s*\(\s*([+-]?\d+(?:\.\d+)?)\s+([+-]?\d+(?:\.\d+)?)\s*\)$/i);
  const pair = point || text.match(/^([+-]?\d+(?:\.\d+)?)\s*[,;\s]\s*([+-]?\d+(?:\.\d+)?)$/);
  if (!pair) return null;
  let lon = Number(pair[1]); let lat = Number(pair[2]);
  // A latitude cannot exceed 90 degrees; this also recognises GPS order in Vietnam.
  if (!point && Math.abs(lon) <= 90 && Math.abs(lat) > 90) [lon, lat] = [lat, lon];
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 90) return null;
  return [lon, lat];
}

module.exports = { parseWgs84 };
