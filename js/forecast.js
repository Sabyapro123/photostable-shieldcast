// Live UV, humidity and temperature from Open-Meteo (free for non-commercial use, no key, CC BY 4.0).
// Production would use Open-Meteo's commercial API or IMD data under licence.
import { CITIES } from "./data.js";

const API = "https://api.open-meteo.com/v1/forecast";
const TTL = 30 * 60 * 1000;

function cacheGet(k) { try { const v = JSON.parse(sessionStorage.getItem(k)); if (v && Date.now() - v.at < TTL) return v.data; } catch (e) {} return null; }
function cacheSet(k, data) { try { sessionStorage.setItem(k, JSON.stringify({ at: Date.now(), data })); } catch (e) {} }

function shape(json) {
  const H = json.hourly, days = {};
  H.time.forEach((iso, i) => {
    const d = iso.slice(0, 10), h = Number(iso.slice(11, 13));
    (days[d] = days[d] || []).push({ h, uv: H.uv_index[i] ?? 0, rh: H.relative_humidity_2m[i] ?? 60, t: H.temperature_2m[i] ?? 28 });
  });
  return withWeek(Object.keys(days).sort().map((date, i) => {
    const hours = days[date];
    const mid = hours.find((x) => x.h === 13) || hours[Math.floor(hours.length / 2)];
    const uvMax = json.daily && json.daily.uv_index_max ? (json.daily.uv_index_max[i] ?? Math.max(...hours.map((x) => x.uv))) : Math.max(...hours.map((x) => x.uv));
    return { date, hours, uvMax, rhMidday: mid.rh, tMax: Math.max(...hours.map((x) => x.t)) };
  }));
}

// Season Switch reads the week as a whole. Every day carries the week's average midday humidity and peak UV.
export function withWeek(days) {
  const n = days.length || 1;
  const rhWeek = days.reduce((s, d) => s + d.rhMidday, 0) / n, uvWeek = days.reduce((s, d) => s + d.uvMax, 0) / n;
  return days.map((d) => ({ ...d, rhWeek, uvWeek }));
}

// A clearly labelled stand-in, used only when the live forecast cannot be reached.
export function sampleForecast(city, startISO) {
  const peakBase = { pune: 10, mumbai: 9, delhi: 7, bengaluru: 11, chennai: 10, hyderabad: 10, kolkata: 8, ahmedabad: 9 }[city] ?? 9;
  const rhBase = { pune: 55, mumbai: 74, delhi: 45, bengaluru: 60, chennai: 72, hyderabad: 50, kolkata: 70, ahmedabad: 40 }[city] ?? 60;
  const out = [];
  for (let d = 0; d < 7; d++) {
    const date = new Date(Date.parse(startISO) + d * 864e5).toISOString().slice(0, 10);
    const peak = Math.max(2, peakBase + ((d * 37) % 5) - 2);
    const rh = rhBase + ((d * 13) % 17) - 8;
    const hours = [];
    for (let h = 0; h < 24; h++) {
      const x = (h - 12.5) / 3.6;
      hours.push({ h, uv: h < 6 || h > 18 ? 0 : Math.max(0, +(peak * Math.exp(-x * x)).toFixed(1)), rh: rh + (h < 9 ? 15 : h > 17 ? 10 : 0), t: 22 + 9 * Math.exp(-x * x) });
    }
    out.push({ date, hours, uvMax: Math.max(...hours.map((x) => x.uv)), rhMidday: hours[13].rh, tMax: Math.max(...hours.map((x) => x.t)) });
  }
  return withWeek(out);
}

export async function cityForecast(cityId) {
  const c = CITIES[cityId] || CITIES.pune;
  const key = "sc-fc-" + c.id;
  const hit = cacheGet(key); if (hit) return { days: hit, live: true };
  const url = `${API}?latitude=${c.lat}&longitude=${c.lon}&hourly=uv_index,relative_humidity_2m,temperature_2m&daily=uv_index_max&timezone=Asia%2FKolkata&forecast_days=7`;
  try {
    const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 8000);
    const r = await fetch(url, { signal: ctl.signal }); clearTimeout(tm);
    if (!r.ok) throw new Error("HTTP " + r.status);
    const days = shape(await r.json());
    cacheSet(key, days);
    return { days, live: true };
  } catch (e) {
    return { days: sampleForecast(c.id, todayISO()), live: false };
  }
}

export async function metroOutlook(ids) {
  const cs = ids.map((id) => CITIES[id]);
  const key = "sc-metro-" + ids.join(",");
  const hit = cacheGet(key); if (hit) return { cities: hit, live: true };
  const url = `${API}?latitude=${cs.map((c) => c.lat).join(",")}&longitude=${cs.map((c) => c.lon).join(",")}&hourly=uv_index,relative_humidity_2m,temperature_2m&daily=uv_index_max&timezone=Asia%2FKolkata&forecast_days=7`;
  try {
    const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 9000);
    const r = await fetch(url, { signal: ctl.signal }); clearTimeout(tm);
    if (!r.ok) throw new Error("HTTP " + r.status);
    let j = await r.json(); if (!Array.isArray(j)) j = [j];
    const cities = j.map((x, i) => ({ id: ids[i], days: shape(x) }));
    cacheSet(key, cities);
    return { cities, live: true };
  } catch (e) {
    return { cities: ids.map((id) => ({ id, days: sampleForecast(id, todayISO()) })), live: false };
  }
}

export function todayISO() {
  const d = new Date(Date.now() + 5.5 * 3600e3); // India Standard Time
  return d.toISOString().slice(0, 10);
}
