const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

process.env.SESSION_SECRET = 'road-graph-test-only';
const { paths } = require('../src/config');
const geotoolsPath = require.resolve('../src/services/geotools');

const start = [108, 14.6];
const turn = [108.01, 14.603];
const end = [108.02, 14.6];

for (const edgeCount of [1, 2]) {
  test(`Chỉ đường qua đồ thị OSM có ${edgeCount} cạnh`, (t) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kontum-road-test-'));
    const previousProcessed = paths.processed;
    t.after(() => {
      paths.processed = previousProcessed;
      delete require.cache[geotoolsPath];
      fs.rmSync(tmp, { recursive: true, force: true });
    });

    paths.processed = path.join(tmp, 'data', 'processed');
    const osmDir = path.join(paths.processed, 'osm');
    fs.mkdirSync(osmDir, { recursive: true });
    const roads = edgeCount === 1 ? [[start, turn, end]] : [[start, turn], [turn, end]];
    fs.writeFileSync(path.join(osmDir, 'road-network.geojson'), JSON.stringify({
      type: 'FeatureCollection',
      features: roads.map((coordinates) => ({
        type: 'Feature',
        properties: { highway: 'primary' },
        geometry: { type: 'LineString', coordinates },
      })),
    }));

    const builder = path.join(tmp, 'scripts', 'build_road_graph.cjs');
    fs.mkdirSync(path.dirname(builder));
    fs.copyFileSync(path.join(__dirname, 'build_road_graph.cjs'), builder);
    execFileSync(process.execPath, [builder]);

    const { dist, graph, route } = require(geotoolsPath);
    assert.equal(graph().meta.nE, edgeCount);
    const result = route(start, end);
    assert.deepEqual(result.features.find((feature) => feature.properties.kind === 'road')?.geometry.coordinates, [start, turn, end]);
    assert.equal(result.summary.distance_m, Math.round(dist(start, turn) + dist(turn, end)));
  });
}
