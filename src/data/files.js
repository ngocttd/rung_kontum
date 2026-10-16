// Cached readers for prepared datasets. Files are re-read when their mtime changes,
// so re-running the Python pipeline updates the site without a restart.
const fs = require('fs');

const cache = new Map();

function cached(file, parse) {
  let stat;
  try { stat = fs.statSync(file); } catch { return null; }
  const hit = cache.get(file);
  if (hit && hit.mtime === stat.mtimeMs) return hit.value;
  const value = parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  cache.set(file, { mtime: stat.mtimeMs, value });
  return value;
}

const readJson = (file) => cached(file, JSON.parse);

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const header = lines.shift().split(',');
  return lines.map((line) => {
    const cells = line.split(',');
    const row = {};
    header.forEach((h, i) => { row[h] = cells[i] === undefined || cells[i] === '' ? null : cells[i]; });
    return row;
  });
}

const readCsv = (file) => cached(file, parseCsv);

function mtime(file) {
  try { return fs.statSync(file).mtime; } catch { return null; }
}

module.exports = { readJson, readCsv, mtime };
