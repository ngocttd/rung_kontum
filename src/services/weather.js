// Periodic server-side refresh of current weather at the 40 commune points (OpenWeather).
// The key never reaches the browser; pages read the cached file, so page views cost no API calls.
const fs = require('fs');
const path = require('path');
const { openWeatherKey, paths } = require('../config');
const { readJson } = require('../data/files');

const OUT = path.join(paths.storage, 'weather-live.json');
const MINUTES = Number(process.env.WEATHER_REFRESH_MINUTES ?? 30);
let running = false;
let lastError = null;

async function refresh() {
  if (!openWeatherKey || running) return;
  running = true;
  try {
    const snap = readJson(path.join(paths.collected, 'weather', 'communes.json')) || [];
    const communes = [];
    for (const c of snap) {
      const url = `https://api.openweathermap.org/data/2.5/weather?lat=${c.location.lat}&lon=${c.location.lon}&units=metric&lang=vi&appid=${openWeatherKey}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`OpenWeather HTTP ${res.status}`);
      communes.push({ code: c.commune.code, weather: await res.json() });
    }
    const tmp = `${OUT}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ source: 'OpenWeather Current Weather', fetched_at: new Date().toISOString(), communes }));
    fs.renameSync(tmp, OUT);
    lastError = null;
  } catch (e) {
    lastError = { at: new Date().toISOString(), message: e.message };
    console.warn('[weather] refresh failed:', e.message);
  } finally {
    running = false;
  }
}

function start() {
  if (!openWeatherKey || !MINUTES) return;
  refresh();
  setInterval(refresh, MINUTES * 60000).unref();
}

function status() {
  const live = readJson(OUT);
  return { enabled: Boolean(openWeatherKey && MINUTES), interval_minutes: MINUTES, fetched_at: live ? live.fetched_at : null, lastError };
}

module.exports = { start, refresh, status };
