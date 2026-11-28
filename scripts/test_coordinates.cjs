const assert = require('node:assert/strict');
const { test } = require('node:test');
const { parseWgs84 } = require('../src/lib/coordinates');

test('GPS latitude, longitude in the map search example', () => {
  assert.deepEqual(parseWgs84('14.35, 108.0'), [108, 14.35]);
});
test('longitude, latitude and signed coordinates', () => {
  assert.deepEqual(parseWgs84('108,14.35'), [108, 14.35]);
  assert.deepEqual(parseWgs84('-14.35, -108'), [-108, -14.35]);
});
test('spaces and semicolons between coordinates', () => {
  assert.deepEqual(parseWgs84('  14.35  108.0  '), [108, 14.35]);
  assert.deepEqual(parseWgs84('14.35; 108.0'), [108, 14.35]);
});
test('WKT and explicit WGS84 prefixes', () => {
  assert.deepEqual(parseWgs84('POINT(108 14.35)'), [108, 14.35]);
  assert.deepEqual(parseWgs84('WGS84: 14.35, 108'), [108, 14.35]);
  assert.deepEqual(parseWgs84('EPSG:4326 108 14.35'), [108, 14.35]);
});
test('invalid, incomplete or out-of-range coordinates', () => {
  for (const input of ['', 'Kon Tum', '14.35', '14.35,', '181, 14', '108, 91', 'Infinity, 14', 'POINT(14 108)', '14,108,3', '14.35,108 hello']) {
    assert.equal(parseWgs84(input), null, input);
  }
});
