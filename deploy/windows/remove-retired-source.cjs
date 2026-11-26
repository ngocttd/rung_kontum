const fs = require('node:fs');
const path = require('node:path');

const workspace = path.resolve(__dirname, '../../..');
const expectedWorkspace = 'C:\\Users\\Administrator\\Documents\\KonTum';
if (workspace.toLowerCase() !== expectedWorkspace.toLowerCase()) {
  throw new Error('Unexpected workspace; no files deleted.');
}
const archive = path.join(workspace, 'kontum_web', 'storage', 'retired-source');
if (!fs.existsSync(archive)) {
  console.log('Retired source has already been removed.');
  process.exit(0);
}
if (fs.lstatSync(archive).isSymbolicLink() ||
    fs.realpathSync.native(archive).toLowerCase() !== archive.toLowerCase()) {
  throw new Error('Cleanup target is a link or resolves elsewhere.');
}
for (const relative of [
  'kontum_web/server.js', 'kontum_web/.env', 'kontum_web/.secrets',
  'kontum_web/data', 'kontum_web/storage/legacy-api',
  'reports/ssl/reload-nginx.ps1',
]) {
  if (!fs.existsSync(path.join(workspace, relative))) {
    throw new Error(`Missing retained runtime: ${relative}`);
  }
}

// Node handles Windows long paths and unlinks dependency symlinks without
// descending into their targets. Only this exact retired directory is removed.
console.log(`Removing retired source: ${archive}`);
fs.rmSync(archive, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
if (fs.existsSync(archive)) throw new Error('Retired source still exists.');
console.log('Retired source removed. Live runtime and HTTPS renewal hook retained.');
