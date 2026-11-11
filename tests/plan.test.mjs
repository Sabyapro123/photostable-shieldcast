// Run with: node --test tests/
import test from "node:test";
import assert from "node:assert/strict";
import { encodePlan, decodePlan, planCode, resolvePlan, todaysTube, daySchedule, tubeStatus, restockSignal, uvBand, icsFor, courseTubes, courseWeeks, protectedDays, sunDot } from "../js/plan.js";

const plan = { v: 1, n: "Ananya", a: "29", need: "mel", skin: "combo", city: "pune", routine: "commute", sw: "none", doc: "Dr Meera Iyer", clinic: "Kothrud", d: "2026-11-08" };
const day = (peak, rh = 60) => {
  const hours = [];
  for (let h = 0; h < 24; h++) { const x = (h - 12.5) / 3.6; hours.push({ h, uv: h < 6 || h > 18 ? 0 : +(peak * Math.exp(-x * x)).toFixed(1), rh, t: 30 }); }
  return { date: "2026-11-08", hours, uvMax: Math.max(...hours.map((x) => x.uv)), rhMidday: rh };
};

test("a plan survives the round trip through the QR link", () => {
  const back = decodePlan(encodePlan(plan));
  assert.equal(back.n, "Ananya");
  assert.equal(back._valid, true);
});

test("a tampered link fails the check code", () => {
  const tok = encodePlan(plan);
  const [body, sig] = tok.split(".");
  const forged = JSON.parse(Buffer.from(body.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
  forged.need = "acne";
  const fb = Buffer.from(JSON.stringify(forged)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  assert.equal(decodePlan(fb + "." + sig)._valid, false);
});

test("melasma gets Pro+ with Gold as the backup", () => {
  const r = resolvePlan(plan);
  assert.equal(r.base, "pro");
  assert.equal(r.backup, "gold");
});

test("oily skin moves an Emulgel plan to Gold", () => {
  assert.equal(resolvePlan({ ...plan, need: "daily", skin: "oily" }).base, "gold");
});

test("the dry-day rule switches an acne patient to Emulgel only on dry days", () => {
  const p = { ...plan, need: "acne", skin: "oily", sw: "dry" };
  assert.equal(todaysTube(p, day(9, 30)).sku, "emulgel");
  assert.equal(todaysTube(p, day(9, 70)).sku, "acne");
});

test("a commuter with melasma applies before the morning ride and reapplies before lunch", () => {
  const s = daySchedule(plan, day(11).hours);
  assert.equal(s.apps[0].kind, "apply");
  assert.ok(s.apps[0].t <= 8.75);
  assert.ok(s.apps.some((a) => a.kind === "reapply" && a.t >= 12 && a.t <= 13));
});

test("an evening ride after sunset needs no reapplication", () => {
  const s = daySchedule(plan, day(11).hours);
  assert.ok(s.apps.every((a) => a.t < 17));
});

test("a field worker reapplies through the day every 2 to 3 hours", () => {
  const s = daySchedule({ ...plan, need: "pih", routine: "field" }, day(10).hours);
  for (let i = 1; i < s.apps.length; i++) assert.ok(s.apps[i].t - s.apps[i - 1].t <= 3 + 1e-9);
});

test("a low-UV day needs one application", () => {
  assert.equal(daySchedule(plan, day(2).hours).apps.length, 1);
});

test("the tube clock counts down and flags a refill", () => {
  const st = tubeStatus("2026-10-10", 1.25, "2026-11-08");
  assert.equal(st.daysOpen, 29);
  assert.equal(st.daysLeft, 11);
  assert.equal(tubeStatus("2026-10-05", 1.25, "2026-11-08").dueSoon, true);
});

test("a heavy UV week raises the restock signal", () => {
  const week = Array.from({ length: 7 }, () => ({ uvMax: 11, rhMidday: 50 }));
  assert.equal(restockSignal(week).level, "high");
  assert.equal(restockSignal(week.map(() => ({ uvMax: 4, rhMidday: 50 }))).level, "low");
});

test("WHO UV bands", () => {
  assert.equal(uvBand(2).label, "Low");
  assert.equal(uvBand(8).label, "Very high");
  assert.equal(uvBand(11).label, "Extreme");
});

test("the calendar file has one event per application", () => {
  const ics = icsFor(plan, [day(10)], planCode(plan));
  const n = (ics.match(/BEGIN:VEVENT/g) || []).length;
  assert.equal(n, daySchedule(plan, day(10).hours).apps.length);
});

/* ---------- v2: Season Switch, Course Rx, Protected Days, SunDot ---------- */
test("Season Switch reads the week's average, so one odd day does not flip the tube", () => {
  const p = { ...plan, need: "acne", skin: "oily", sw: "dry" };
  const humidDayInDryWeek = { ...day(9, 70), rhWeek: 30, uvWeek: 9 };
  const dryDayInHumidWeek = { ...day(9, 30), rhWeek: 70, uvWeek: 9 };
  assert.equal(todaysTube(p, humidDayInDryWeek).sku, "emulgel");
  assert.equal(todaysTube(p, dryDayInHumidWeek).sku, "acne");
});

test("a melasma patient never leaves Pro+ whatever the season", () => {
  const p = { ...plan, sw: "humid" };
  assert.equal(todaysTube(p, { ...day(9, 90), rhWeek: 90, uvWeek: 9 }).sku, "pro");
});

test("Course Rx turns weeks and grams a day into tubes", () => {
  assert.equal(courseTubes(12, 2.5), 5);
  assert.equal(courseTubes(8, 1.25), 2);
  assert.equal(courseWeeks({ c: 24 }), 24);
  assert.equal(courseWeeks({}), 12);
});

test("the default course is left out of the link, so older cards keep their check code", () => {
  assert.equal(planCode({ ...plan }), planCode({ ...plan, c: undefined }));
  assert.notEqual(planCode({ ...plan }), planCode({ ...plan, c: 24 }));
});

test("a protected day needs every planned application ticked", () => {
  const s = protectedDays([{ need: 2, done: 2 }, { need: 3, done: 2 }, { need: 1, done: 1 }, null]);
  assert.equal(s.days, 3);
  assert.equal(s.protectedDays, 2);
  assert.equal(s.pct, 67);
});

test("SunDot turns violet once UV reaches 3", () => {
  assert.equal(sunDot(0).key, "clear");
  assert.equal(sunDot(2).key, "pale");
  assert.equal(sunDot(3).key, "violet");
  assert.equal(sunDot(8).key, "deep");
});
