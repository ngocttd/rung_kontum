// Read-only regression checks against the configured PostgreSQL database.
// Usage: node scripts/test_maps_search.cjs
const assert = require('node:assert/strict');
const maps = require('../src/services/maps');
const db = require('../src/db/pool');

(async () => {
  try {
    const all = await maps.list();
    assert.ok(all.length, 'A configured database with map datasets is required');
    const sample = all.find((d) => d.map_year) || all[0];
    const cases = [
      ['empty search', {}],
      ['Vietnamese search', { q: 'Bản đồ' }],
      ['case-insensitive search', { q: 'bẢN ĐỒ' }],
      ['no matching maps', { q: 'no-matching-map-9c63aa70' }],
      ['quoted search', { q: "' OR 1=1 --" }],
      ['search with format', { q: 'Bản đồ', format: sample.format }],
      ['search with status', { q: 'Bản đồ', status: sample.status }],
      ['search with category', { q: 'Bản đồ', category: sample.category }],
      ['search with all filters', {
        q: 'Bản đồ', format: sample.format, status: sample.status,
        category: sample.category, year: sample.map_year,
      }],
    ];
    // Also exercise a phrase drawn from a real description when available.
    const described = all.find((d) => d.description && /[\p{L}\p{N}]{4,}/u.test(d.description));
    if (described) cases.push(['description search', { q: described.description.match(/[\p{L}\p{N}]{4,}/u)[0] }]);
    const ids = (rows) => rows.map((d) => d.id).sort();
    for (const [label, filter] of cases) {
      const needle = (filter.q || '').toLocaleLowerCase('vi');
      const expected = all.filter((d) =>
        (!filter.format || d.format === filter.format)
        && (!filter.status || d.status === filter.status)
        && (!filter.category || d.category === filter.category)
        && (!filter.year || d.map_year === Number(filter.year))
        && (!needle || [d.title, d.description].some((s) => (s || '').toLocaleLowerCase('vi').includes(needle))));
      const actual = await maps.list(filter);
      assert.deepEqual(ids(actual), ids(expected), label);
      console.log(`PASS ${label}: ${actual.length} maps`);
    }
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    const pool = db.getPool();
    if (pool) await pool.end();
  }
})();
