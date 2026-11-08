// ShieldCast plan engine. Pure functions only, so the same logic can run in the browser,
// in a WhatsApp reminder service, or in tests (see tests/plan.test.mjs).
import { SKUS, NEEDS, SWITCHES, ROUTINES, TUBE_G, DOSE_G } from "./data.js";

/* ---------- prescription link ---------- */
const keyOrder = ["v", "n", "a", "need", "skin", "city", "routine", "sw", "doc", "clinic", "d"];
export function canonical(plan) {
  const o = {};
  keyOrder.forEach((k) => { if (plan[k] !== undefined && plan[k] !== "") o[k] = plan[k]; });
  return JSON.stringify(o);
}
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
const B32 = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
export function planCode(plan) {
  let h = fnv1a(canonical(plan)), out = "";
  for (let i = 0; i < 6; i++) { out += B32[h % B32.length]; h = Math.floor(h / B32.length) || fnv1a(out + i); }
  return "SC-" + out;
}
function b64urlEncode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = ""; bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(s) {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(pad); const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
export function encodePlan(plan) {
  const body = canonical(plan);
  return b64urlEncode(body) + "." + planCode(plan).slice(3);
}
export function decodePlan(token) {
  try {
    const [body, sig] = String(token).split(".");
    const plan = JSON.parse(b64urlDecode(body));
    if (!plan || plan.v !== 1 || !NEEDS[plan.need]) return null;
    plan._valid = planCode(plan).slice(3) === sig;
    return plan;
  } catch (e) { return null; }
}
export function resolvePlan(plan) {
  const need = NEEDS[plan.need];
  let base = need.base, backup = need.backup;
  if (base && plan.skin === "oily" && base === "emulgel") { base = "gold"; backup = "emulgel"; }
  if (base && plan.skin === "dry" && base === "gold") { base = "emulgel"; backup = "gold"; }
  const sw = SWITCHES[plan.sw] || SWITCHES.none;
  const second = sw.sku && sw.sku !== base ? sw.sku : null;
  return { need, base, backup, sw: second ? sw : SWITCHES.none, second, routine: ROUTINES[plan.routine] || ROUTINES.commute };
}

/* ---------- UV ---------- */
export function uvBand(uvRaw) {
  const uv = Math.round(uvRaw);
  if (uv < 3) return { key: "low", label: "Low", advice: "Little protection is needed outdoors." };
  if (uv < 6) return { key: "moderate", label: "Moderate", advice: "WHO advises shade at midday, a shirt, sunscreen and a hat." };
  if (uv < 8) return { key: "high", label: "High", advice: "WHO advises shade at midday, a shirt, sunscreen and a hat." };
  if (uv < 11) return { key: "veryhigh", label: "Very high", advice: "WHO advises staying out of the midday sun. Shirt, sunscreen and hat are a must." };
  return { key: "extreme", label: "Extreme", advice: "WHO advises staying out of the midday sun. Shirt, sunscreen and hat are a must." };
}

/* ---------- which tube today ---------- */
export function todaysTube(plan, day) {
  const r = resolvePlan(plan);
  if (!r.base) return { sku: null, reason: "There is no Photostable fit for this need, so follow your doctor's instructions." };
  if (r.second) {
    const sw = r.sw;
    if (sw.id === "humid" && day.rhMidday >= 75) return { sku: r.second, switched: true, reason: `Humidity is about ${Math.round(day.rhMidday)}% at midday, so your doctor's rule says use the matte gel today.` };
    if (sw.id === "dry" && day.rhMidday < 40) return { sku: r.second, switched: true, reason: `The air is dry today (about ${Math.round(day.rhMidday)}% humidity), so your doctor's rule says use Emulgel.` };
    if (sw.id === "peak" && day.uvMax >= 8) return { sku: r.second, switched: true, reason: `Peak UV is ${day.uvMax.toFixed(0)} today, so your doctor's rule says use Pro+.` };
  }
  return { sku: r.base, switched: false, reason: "This is the variant your doctor prescribed." };
}

/* ---------- the day's schedule ---------- */
export function protectionWindow(hours) {
  const hot = hours.filter((x) => x.uv >= 3);
  if (!hot.length) return null;
  return [hot[0].h, hot[hot.length - 1].h + 1];
}
export function daySchedule(plan, hours) {
  const r = resolvePlan(plan);
  const I = r.need.reapplyH;
  const pw = protectionWindow(hours);
  const peak = hours.reduce((m, x) => (x.uv > m.uv ? x : m), { uv: -1, h: 12 });
  const windows = r.routine.windows.slice().sort((a, b) => a[0] - b[0]);
  const apps = [];
  if (!pw) {
    apps.push({ t: Math.max(7.5, windows.length ? windows[0][0] - 0.25 : 8), kind: "apply", outdoor: false });
    return { pw: null, peak, apps, grams: DOSE_G, interval: I };
  }
  const overlap = windows.map(([a, b]) => [Math.max(a, pw[0]), Math.min(b, pw[1])]).filter(([a, b]) => b > a);
  let last;
  if (overlap.length) { last = Math.max(6, overlap[0][0] - 0.25); }
  else { last = Math.max(7.5, (windows[0] ? windows[0][0] : 8) - 0.25); }
  apps.push({ t: last, kind: "apply", outdoor: overlap.length > 0 });
  overlap.forEach(([s, e]) => {
    if (last + I < s) { last = s - 0.25; apps.push({ t: last, kind: "reapply", outdoor: true }); }
    while (last + I < e) { last = last + I; apps.push({ t: last, kind: "reapply", outdoor: true }); }
  });
  // Melasma reacts to visible light through windows too, so one midday top-up is added if none falls between noon and 3 pm.
  if (plan.need === "mel" && !apps.some((a) => a.t >= 12 && a.t <= 15) && pw[1] > 13) apps.push({ t: 13, kind: "reapply", outdoor: false });
  apps.sort((a, b) => a.t - b.t);
  return { pw, peak, apps, grams: apps.length * DOSE_G, interval: I };
}

/* ---------- the tube clock ---------- */
export function averageDailyGrams(plan, days) {
  if (!days.length) return DOSE_G;
  const total = days.reduce((s, d) => s + daySchedule(plan, d.hours).grams, 0);
  return total / days.length;
}
export function tubeStatus(openedISO, gramsPerDay, todayISO, loggedGrams) {
  if (!openedISO) return null;
  const days = Math.max(0, Math.round((Date.parse(todayISO) - Date.parse(openedISO)) / 864e5));
  const used = loggedGrams != null ? loggedGrams : days * gramsPerDay;
  const left = Math.max(0, TUBE_G - used);
  const daysLeft = gramsPerDay > 0 ? Math.floor(left / gramsPerDay) : 0;
  const refill = new Date(Date.parse(todayISO) + Math.max(0, daysLeft - 7) * 864e5).toISOString().slice(0, 10);
  return { daysOpen: days, used, left, pctLeft: left / TUBE_G, daysLeft, refillBy: refill, dueSoon: daysLeft <= 8 };
}

/* ---------- demand sensing for Sun's supply team ---------- */
// Hypothesis to calibrate with pilot sell-out data: tubes run out faster when more days need
// reapplication, so stock should move to cities with a heavier UV load in the coming week.
export function restockSignal(daily) {
  const load = daily.reduce((s, d) => s + Math.max(0, d.uvMax - 5), 0);
  const humid = daily.filter((d) => d.rhMidday >= 75).length;
  const level = load >= 30 ? "high" : load >= 15 ? "medium" : "low";
  const lift = level === "high" ? 20 : level === "medium" ? 10 : 0;
  const mix = humid >= 4 ? "Weight the extra stock towards Gold and Acne gels for humid days." : "Weight the extra stock towards Pro+ for melasma patients.";
  return { load: Math.round(load), humidDays: humid, level, lift, mix };
}

/* ---------- helpers ---------- */
export function fmtTime(h) {
  const hh = Math.floor(h), mm = Math.round((h - hh) * 60);
  const H = hh % 12 === 0 ? 12 : hh % 12;
  return `${H}:${String(mm).padStart(2, "0")} ${hh < 12 ? "am" : "pm"}`;
}
export function skuName(id) { return SKUS[id] ? SKUS[id].name : id; }

export function icsFor(plan, days, code) {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//ChampsGrid//ShieldCast//EN", "CALSCALE:GREGORIAN"];
  const pad = (n) => String(n).padStart(2, "0");
  days.forEach((d) => {
    const sched = daySchedule(plan, d.hours);
    const tube = todaysTube(plan, d);
    sched.apps.forEach((a, i) => {
      const hh = Math.floor(a.t), mm = Math.round((a.t - hh) * 60);
      const dt = d.date.replace(/-/g, "") + "T" + pad(hh) + pad(mm) + "00";
      const end = d.date.replace(/-/g, "") + "T" + pad(hh) + pad(Math.min(59, mm + 5)) + "00";
      lines.push("BEGIN:VEVENT", `UID:${code}-${d.date}-${i}@shieldcast`, `DTSTAMP:${dt}`, `DTSTART;TZID=Asia/Kolkata:${dt}`, `DTEND;TZID=Asia/Kolkata:${end}`,
        `SUMMARY:${a.kind === "apply" ? "Apply" : "Reapply"} ${tube.sku ? skuName(tube.sku) : "sunscreen"}`,
        `DESCRIPTION:Two finger-lengths for face and neck. Peak UV today ${d.uvMax.toFixed(0)}. From your ShieldCast plan ${code}.`,
        "BEGIN:VALARM", "TRIGGER:PT0M", "ACTION:DISPLAY", "DESCRIPTION:Sunscreen reminder", "END:VALARM", "END:VEVENT");
    });
  });
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}
