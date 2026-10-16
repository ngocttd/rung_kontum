// Import pipeline outputs and existing storage/*.json records into PostGIS.
// Usage: npm run db:import [-- boundaries statistics change hotspots history danger storage]
const sync = require('../src/db/sync');
const parts = process.argv.slice(2);
sync.run(parts.length ? parts : undefined)
  .then((r) => { console.log(JSON.stringify(r, null, 1)); return sync.close(); })
  .catch((e) => { console.error('Lỗi:', e.message); process.exit(1); });
