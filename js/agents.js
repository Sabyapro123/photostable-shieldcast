// ShieldCast agents. Four agents share one set of tools and one set of guardrails.
// By default every agent runs on transparent rules, so the demo is free and repeatable.
// With a Claude API key (kept only in this browser) the Prescribing Copilot and the Patient
// Companion plan their own tool calls, while the same tools and guardrails stay in charge.
// This file has no DOM code, so the tests in tests/agents.test.mjs can run it in Node.
import { SKUS, SKU_ORDER, NEEDS, SWITCHES, ROUTINES, CITIES, STORES, storesFor, DOSE_TEXT, TUBE_G } from "./data.js";
import { encodePlan, planCode, resolvePlan, uvBand, todaysTube, daySchedule, averageDailyGrams, tubeStatus, restockSignal, fmtTime, skuName } from "./plan.js";

/* ---------------- small helpers ---------------- */
const DAYNAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const addDays = (iso, n) => new Date(Date.parse(iso) + n * 864e5).toISOString().slice(0, 10);
const weekday = (iso) => DAYNAMES[new Date(iso + "T00:00:00Z").getUTCDay()];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
export const joinList = (arr) => arr.length <= 1 ? (arr[0] || "") : arr.slice(0, -1).join(", ") + " and " + arr[arr.length - 1];
const times = (sch) => joinList(sch.apps.map((a) => fmtTime(a.t)));
const lower1 = (s) => s.charAt(0).toLowerCase() + s.slice(1);

// Brands the agents must never recommend. The list is used only to filter replies.
export const OTHER_BRANDS = ["suncros", "la shield", "lashield", "uv doux", "acne-uv", "sunban", "photoban", "dot & key", "dot and key", "derma co", "aqualogica", "minimalist", "neutrogena", "lakme", "cetaphil", "re'equil", "fixderma", "mamaearth"];
// Words that mean a person needs a pharmacist or a doctor, not an automated answer.
const RED_FLAGS = /\b(rash|sunburn\w*|burn(ing|t)?|blister\w*|swell\w*|itch\w*|allerg\w*|hives|eye[s]?|sting\w*|bleed\w*|pregnan\w*|breastfeed\w*|baby|infant|child|kid|pus|fever|worse|reaction)\b/i;

/* ---------------- shared state ---------------- */
// ctx.store is a tiny key-value store: localStorage in the browser, a Map in tests.
export function memoryStore() {
  const m = new Map();
  return { get: (k, d) => (m.has(k) ? JSON.parse(m.get(k)) : d), set: (k, v) => m.set(k, JSON.stringify(v)) };
}
export function stockOf(ctx, store) { return ctx.store.get("sc-stock-" + store.id, null) || { ...store.stock }; }
function push(ctx, key, item, max = 60) { const l = ctx.store.get(key, []); l.unshift({ at: ctx.now ? ctx.now() : Date.now(), ...item }); ctx.store.set(key, l.slice(0, max)); return l[0]; }

/* ---------------- the synthetic cohort for the Orchestrator ---------------- */
// Ten made-up patients across five cities. They exist only to show the morning run.
export function cohort(today) {
  const P = (n, a, need, skin, city, routine, sw, openedAgo, consent) => {
    const plan = { v: 1, n, a, need, skin, city, routine, sw, doc: city === "pune" ? "Dr Meera Iyer" : "Dr R. Menon", clinic: city === "pune" ? "Skin clinic, Kothrud, Pune" : "Skin clinic", d: addDays(today, -openedAgo) };
    return { plan, code: planCode(plan), opened: addDays(today, -openedAgo), consent };
  };
  return [
    P("Ananya", "29", "mel", "combo", "pune", "commute", "none", 15, { wa: true, check: true, share: true }),
    P("Kavya", "34", "mel", "oily", "pune", "office", "none", 9, { wa: true, check: false, share: true }),
    P("Rohit", "22", "acne", "oily", "mumbai", "office", "dry", 12, { wa: true, check: true, share: false }),
    P("Sana", "27", "pih", "combo", "mumbai", "commute", "humid", 14, { wa: false, check: false, share: false }),
    P("Farah", "41", "pih", "combo", "chennai", "field", "peak", 8, { wa: true, check: false, share: true }),
    P("Vikram", "38", "drug", "normal", "chennai", "field", "none", 3, { wa: true, check: true, share: true }),
    P("Meenal", "45", "mel", "dry", "delhi", "home", "none", 10, { wa: true, check: false, share: false }),
    P("Arjun", "19", "acne", "oily", "delhi", "commute", "none", 5, { wa: true, check: true, share: true }),
    P("Lakshmi", "52", "daily", "dry", "bengaluru", "home", "peak", 29, { wa: true, check: false, share: true }),
    P("Imran", "31", "pih", "oily", "bengaluru", "field", "none", 4, { wa: false, check: false, share: false }),
  ];
}

/* ---------------- tools ---------------- */
// Each tool has a description and a JSON schema, so the same list can be handed to Claude.
// Every tool runs locally in the browser and enforces its own guardrails.
export const TOOLS = {
  get_uv_forecast: {
    description: "Get the hourly UV and humidity forecast for an Indian city for the next 7 days. Use it before giving any times.",
    input_schema: { type: "object", properties: { city: { type: "string", enum: Object.keys(CITIES) } }, required: ["city"] },
    async run(ctx, { city }) {
      if (!CITIES[city]) return { error: `Unknown city. Use one of: ${Object.keys(CITIES).join(", ")}.` };
      const { days, live } = await ctx.forecast(city);
      const d = days[0], hot = d.hours.filter((x) => x.uv >= 3);
      return { city: CITIES[city].name, live, today: { date: d.date, peak_uv: Math.round(d.uvMax), band: uvBand(d.uvMax).label, midday_humidity: Math.round(d.rhMidday), uv3_from: hot.length ? fmtTime(hot[0].h) : null, uv3_to: hot.length ? fmtTime(hot[hot.length - 1].h + 1) : null }, next_7_days: days.slice(0, 7).map((x) => ({ date: x.date, day: cap(weekday(x.date)), peak_uv: Math.round(x.uvMax), midday_humidity: Math.round(x.rhMidday) })) };
    },
  },
  build_shield_plan: {
    description: "Draft a Shield Plan from patient facts. It picks the Photostable variant, the backup and checks any weather rule against the Delphi-based rules. The doctor must approve it before a card is issued.",
    input_schema: { type: "object", properties: {
      name: { type: "string", description: "First name only" }, age: { type: "string" },
      need: { type: "string", enum: Object.keys(NEEDS), description: "mel melasma, acne acne or retinoids, pih tanning or post-acne marks, daily daily use with dry skin, drug sun-sensitising medicine, proc after laser or peel" },
      skin: { type: "string", enum: ["oily", "combo", "normal", "dry"] }, city: { type: "string", enum: Object.keys(CITIES) },
      routine: { type: "string", enum: Object.keys(ROUTINES) }, weather_rule: { type: "string", enum: Object.keys(SWITCHES) },
    }, required: ["need", "skin", "city", "routine"] },
    async run(ctx, a) {
      const flags = [];
      const plan = { v: 1, n: String(a.name || "Patient").replace(/[^\p{L} .'-]/gu, "").split(" ")[0].slice(0, 20) || "Patient", a: String(a.age || "").replace(/\D/g, "").slice(0, 3), need: a.need, skin: a.skin || "normal", city: a.city, routine: a.routine || "commute", sw: a.weather_rule || "none", doc: ctx.doctor || "Dr Meera Iyer", clinic: ctx.clinic || "Skin clinic, Kothrud, Pune", d: ctx.today };
      if (!NEEDS[plan.need]) return { error: "Unknown need." };
      if (!CITIES[plan.city]) return { error: "Unknown city." };
      if (!ROUTINES[plan.routine]) plan.routine = "commute";
      if (!SWITCHES[plan.sw]) plan.sw = "none";
      let r = resolvePlan(plan);
      if (!r.base) {
        push(ctx, "sc-gaplog", { need: plan.need, city: plan.city });
        return { fit: false, guardrail: "No Photostable variant fits this need. Nothing is prescribed and the case is logged as a portfolio gap.", note: r.need.note };
      }
      if (plan.need === "mel" && (plan.sw === "humid" || plan.sw === "dry")) { flags.push("A humid or dry-day rule would take a melasma patient off Pro+, so the rule was removed."); plan.sw = "none"; }
      if (SWITCHES[plan.sw].sku && SWITCHES[plan.sw].sku === r.base) { flags.push("The weather rule pointed to the same variant as the base, so it was removed."); plan.sw = "none"; }
      r = resolvePlan(plan);
      const { days, live } = await ctx.forecast(plan.city);
      const d = days[0], tube = todaysTube(plan, d), sch = daySchedule(plan, d.hours);
      const switchDays = r.second ? days.slice(0, 7).filter((x) => todaysTube(plan, x).switched).length : 0;
      return { fit: true, plan, code: planCode(plan), token: encodePlan(plan), variant: skuName(r.base), backup: skuName(r.backup), second_tube: r.second ? `${skuName(r.second)} when ${lower1(r.sw.when)}` : null, switch_days_this_week: switchDays, reapply_every_hours: r.need.reapplyH, dose: DOSE_TEXT, today: { live, peak_uv: Math.round(d.uvMax), tube: skuName(tube.sku), times: times(sch) }, guardrail_notes: flags, status: "Draft. The doctor must approve it before the card is issued." };
    },
  },
  todays_protection: {
    description: "Get the patient's tube, apply and reapply times for a date, using the live forecast and any routine change for that date.",
    input_schema: { type: "object", properties: { day: { type: "string", description: "today, tomorrow or a weekday name such as saturday" } }, required: [] },
    async run(ctx, { day = "today" } = {}) {
      const p = ctx.patient; if (!p) return { error: "No patient plan is open." };
      const { days, live } = await ctx.forecast(p.plan.city);
      const d = pickDay(days, day); if (!d) return { error: "That day is outside the 7-day forecast." };
      const routine = ctx.store.get(`sc-dayroutine-${p.code}-${d.date}`, null) || ctx.store.get("sc-routine-" + p.code, p.plan.routine);
      const plan = { ...p.plan, routine }, t = todaysTube(plan, d), sch = daySchedule(plan, d.hours);
      return { date: d.date, day: cap(weekday(d.date)), live, peak_uv: Math.round(d.uvMax), band: uvBand(d.uvMax).label, routine: ROUTINES[routine].label, tube: skuName(t.sku), why: t.reason, times: sch.apps.map((a) => ({ time: fmtTime(a.t), action: a.kind })), dose: DOSE_TEXT };
    },
  },
  set_day_routine: {
    description: "Change the patient's outdoor routine for one date only, for example a beach day or a trek, and return the new times. It never changes the prescribed variant.",
    input_schema: { type: "object", properties: { day: { type: "string" }, routine: { type: "string", enum: Object.keys(ROUTINES) } }, required: ["day", "routine"] },
    async run(ctx, { day, routine }) {
      const p = ctx.patient; if (!p) return { error: "No patient plan is open." };
      if (!ROUTINES[routine]) return { error: "Unknown routine." };
      const { days } = await ctx.forecast(p.plan.city);
      const d = pickDay(days, day); if (!d) return { error: "That day is outside the 7-day forecast." };
      ctx.store.set(`sc-dayroutine-${p.code}-${d.date}`, routine);
      return TOOLS.todays_protection.run(ctx, { day: d.date });
    },
  },
  tube_status: {
    description: "Get how many days are left in the patient's tube and when to refill, from the date it was opened and the forecast use.",
    input_schema: { type: "object", properties: {}, required: [] },
    async run(ctx) {
      const p = ctx.patient; if (!p) return { error: "No patient plan is open." };
      const opened = ctx.store.get("sc-opened-" + p.code, p.opened || null);
      const { days } = await ctx.forecast(p.plan.city);
      const avg = averageDailyGrams(p.plan, days.slice(0, 7));
      if (!opened) return { opened: null, grams_per_day: +avg.toFixed(2), tube_lasts_days: Math.round(TUBE_G / avg), note: "The tube clock has not been started." };
      const st = tubeStatus(opened, avg, ctx.today);
      return { opened, grams_per_day: +avg.toFixed(2), grams_left: Math.round(st.left), days_left: st.daysLeft, refill_by: st.refillBy, due_soon: st.dueSoon };
    },
  },
  find_stock: {
    description: "Find partner pharmacies near the patient's clinic that hold the prescribed variant or the doctor's backup. It never returns other brands.",
    input_schema: { type: "object", properties: {}, required: [] },
    async run(ctx) {
      const p = ctx.patient; if (!p) return { error: "No patient plan is open." };
      const r = resolvePlan(p.plan);
      return { prescribed: skuName(r.base), backup: skuName(r.backup), stores: storesFor(p.plan.city).map((s) => { const st = stockOf(ctx, s); return { store_id: s.id, name: s.name, distance: s.dist, prescribed_in_stock: st[r.base] || 0, backup_in_stock: st[r.backup] || 0 }; }) };
    },
  },
  reserve_refill: {
    description: "Propose holding a tube at a partner pharmacy for 24 hours. The patient must confirm before it is held.",
    input_schema: { type: "object", properties: { store_id: { type: "string" } }, required: ["store_id"] },
    async run(ctx, { store_id }) {
      const p = ctx.patient; if (!p) return { error: "No patient plan is open." };
      const r = resolvePlan(p.plan), s = storesFor(p.plan.city).find((x) => x.id === store_id);
      if (!s) return { error: "Unknown store." };
      const st = stockOf(ctx, s), sku = (st[r.base] || 0) > 0 ? r.base : (st[r.backup] || 0) > 0 ? r.backup : null;
      if (!sku) return { error: "Neither the prescribed variant nor the backup is in stock there." };
      return { proposal: { store_id, store: s.name, sku, tube: skuName(sku), is_backup: sku !== r.base }, status: "Waiting for the patient to confirm." };
    },
  },
  log_feedback_for_doctor: {
    description: "Record how the sunscreen feels for the doctor's next review, for example too oily. The agent cannot switch the variant itself.",
    input_schema: { type: "object", properties: { feedback: { type: "string" } }, required: ["feedback"] },
    async run(ctx, { feedback }) {
      const p = ctx.patient; if (!p) return { error: "No patient plan is open." };
      const c = ctx.store.get("sc-consent-" + p.code, p.consent || {});
      push(ctx, "sc-feedback", { code: p.code, n: p.plan.n, feedback: String(feedback).slice(0, 160), shared: !!c.share });
      return { logged: true, shared_with_clinic: !!c.share, note: c.share ? "The clinic will see this at the next review." : "It stays on this phone because the patient has not agreed to share with the clinic." };
    },
  },
  escalate_to_care_desk: {
    description: "Send the case to a human pharmacist at the care desk. Use it for any skin reaction, eye contact, pregnancy, children or anything clinical.",
    input_schema: { type: "object", properties: { reason: { type: "string" }, severity: { type: "string", enum: ["routine", "urgent"] } }, required: ["reason", "severity"] },
    async run(ctx, { reason, severity }) {
      const p = ctx.patient;
      const t = push(ctx, "sc-desk", { code: p ? p.code : "none", n: p ? p.plan.n : "Unknown", reason: String(reason).slice(0, 200), severity: severity === "urgent" ? "urgent" : "routine", status: "open" });
      return { ticket: "CD-" + String(t.at).slice(-5), severity: t.severity, eta: t.severity === "urgent" ? "A pharmacist calls back within 30 minutes during clinic hours." : "A pharmacist replies today." };
    },
  },
  restock_signal: {
    description: "Score the coming week's UV load for a city and suggest a stock lift and product mix.",
    input_schema: { type: "object", properties: { city: { type: "string", enum: Object.keys(CITIES) } }, required: ["city"] },
    async run(ctx, { city }) { const { days, live } = await ctx.forecast(city); return { city: CITIES[city].name, live, ...restockSignal(days.slice(0, 7)) }; },
  },
  queue_whatsapp: {
    description: "Queue a WhatsApp utility message to a patient. It is refused unless the patient opted in to reminders.",
    input_schema: { type: "object", properties: { code: { type: "string" }, text: { type: "string" } }, required: ["code", "text"] },
    async run(ctx, { code, text, consent }) {
      if (!consent || !consent.wa) return { sent: false, guardrail: "No reminder consent on record, so no message was queued." };
      push(ctx, "sc-outbox", { code, text: String(text).slice(0, 300) }, 80);
      return { sent: true, cost_inr: 0.12 };
    },
  },
};
// The tools that each agent may use. Nothing outside the list can be called.
export const AGENT_TOOLS = {
  copilot: ["get_uv_forecast", "build_shield_plan"],
  companion: ["todays_protection", "set_day_routine", "tube_status", "find_stock", "reserve_refill", "log_feedback_for_doctor", "escalate_to_care_desk", "get_uv_forecast"],
  restock: ["restock_signal"],
  orchestrator: ["get_uv_forecast", "queue_whatsapp", "restock_signal"],
};
export function claudeTools(agentId) { return AGENT_TOOLS[agentId].map((n) => ({ name: n, description: TOOLS[n].description, input_schema: TOOLS[n].input_schema })); }

function pickDay(days, word) {
  const w = String(word || "today").toLowerCase().trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(w)) return days.find((d) => d.date === w) || null;
  if (w === "today") return days[0];
  if (w === "tomorrow") return days[1] || null;
  const i = DAYNAMES.findIndex((n) => w.startsWith(n.slice(0, 3)));
  if (i < 0) return days[0];
  return days.slice(0, 7).find((d) => weekday(d.date) === DAYNAMES[i]) || null;
}

/* ---------------- guardrails applied to every reply ---------------- */
export function guardReply(text) {
  const low = String(text).toLowerCase();
  const hit = OTHER_BRANDS.find((b) => low.includes(b));
  if (hit) return { text: "I can only help with the Photostable plan your doctor wrote. For any other product, please ask your doctor or pharmacist.", blocked: `Reply mentioned another brand (${hit}) and was replaced.` };
  return { text, blocked: null };
}
export function redFlag(text) { const m = String(text).match(RED_FLAGS); return m ? m[0].toLowerCase() : null; }

/* ---------------- a tracer that records every step ---------------- */
function tracer(onStep) {
  const steps = [];
  const add = async (s) => { steps.push(s); if (onStep) await onStep(s); };
  const tool = async (ctx, agentId, name, args, extra) => {
    if (!AGENT_TOOLS[agentId].includes(name)) { await add({ kind: "guard", text: `The ${name} tool is not allowed for this agent, so the call was refused.` }); return { error: "Tool not allowed." }; }
    await add({ kind: "tool", name, args });
    const out = await TOOLS[name].run(ctx, { ...args, ...(extra || {}) });
    await add({ kind: "result", name, out });
    return out;
  };
  return { steps, add, tool };
}

/* =====================================================================
   Agent 1. Prescribing Copilot (for the dermatologist)
   ===================================================================== */
export function parseNote(text) {
  const t = " " + String(text).toLowerCase() + " ";
  const found = {}, assumed = [];
  const nm = String(text).match(/^\s*([A-Z][a-z]{1,19})\b/);
  if (nm && !/^(pt|patient|female|male|mrs?|ms|dr|melasma|acne|tanning|on|after|post|daily|oily|dry|combination|young|lady|woman|man|boy|girl)$/i.test(nm[1]) && !Object.values(CITIES).some((c) => c.name === nm[1])) found.name = nm[1];
  const ag = t.match(/\b(\d{1,2})\s*(?:y|yr|yrs|years?|\/?f\b|\/?m\b|f\b|m\b)/) || t.match(/\bage[d]?\s*(\d{1,2})\b/); if (ag) found.age = ag[1];
  const needRules = [["proc", /laser|peel|procedure|microneedl|resurfac/], ["mel", /melasma|chloasma|pigment(ation)? patch|mask of pregnancy/], ["drug", /doxy|hydrochlorothiazide|hctz|amiodarone|photosensiti|sun.?sensiti|methotrexate|voriconazole/], ["acne", /acne|isotretinoin|isotroin|retino|tretinoin|adapalene|pimple/], ["pih", /\btan(ning|ned)?\b|\bpih\b|post.?acne marks?|dark spots|hyperpigment|\bmarks\b/], ["daily", /dry skin|daily (use|protection)|routine protection/]];
  const nr = needRules.find(([, re]) => re.test(t)); if (nr) found.need = nr[0];
  const skinRules = [["oily", /oily|greasy/], ["combo", /combination|combo|t.?zone/], ["dry", /\bdry\b(?! days)|xerosis/], ["normal", /normal skin/]];
  const sr = skinRules.find(([, re]) => re.test(t)); if (sr) found.skin = sr[0];
  const city = Object.values(CITIES).find((c) => t.includes(c.name.toLowerCase()) || (c.id === "bengaluru" && t.includes("bangalore")) || (c.id === "mumbai" && t.includes("bombay"))); if (city) found.city = city.id;
  const routineRules = [["field", /field|sales|outdoor work|delivery|construction|farm|traffic|police|site visits?|cricket|athlete/], ["commute", /two.?wheeler|scooter|\bbike|commut|\brides?\b/], ["office", /office|desk|it job|work from office|window/], ["home", /home|homemaker|wfh|retired|indoors/]];
  const rr = routineRules.find(([, re]) => re.test(t)); if (rr) found.routine = rr[0];
  found.isotretinoin = /isotretinoin|isotroin/.test(t);
  if (!found.need) { found.need = "pih"; assumed.push("No condition was named, so I assumed tanning or post-acne marks."); }
  if (!found.skin) { found.skin = found.need === "acne" ? "oily" : "combo"; assumed.push(`No skin type was named, so I assumed ${found.skin === "combo" ? "combination" : found.skin} skin.`); }
  if (!found.city) { found.city = "pune"; assumed.push("No city was named, so I used the clinic's city, Pune."); }
  if (!found.routine) { found.routine = "commute"; assumed.push("No routine was named, so I assumed a commute with lunch outdoors."); }
  return { found, assumed };
}

export async function runCopilot(ctx, note, onStep) {
  const T = tracer(onStep);
  await T.add({ kind: "think", text: "I read the note for the condition, skin type, city, daily routine and any medicine that changes the choice." });
  const { found, assumed } = parseNote(note);
  await T.add({ kind: "think", text: `I found: ${[found.name && "name " + found.name, found.age && "age " + found.age, "need " + NEEDS[found.need].label.toLowerCase(), "skin " + found.skin, "city " + CITIES[found.city].name, "routine " + ROUTINES[found.routine].label.toLowerCase()].filter(Boolean).join(", ")}.` });
  for (const a of assumed) await T.add({ kind: "guard", text: a });
  const fc = await T.tool(ctx, "copilot", "get_uv_forecast", { city: found.city });
  // Pick a weather rule only when there is a clinical reason and this week's weather makes it matter.
  let rule = "none", why = "No weather rule is needed, because one variant covers this week.";
  const base = resolvePlan({ need: found.need, skin: found.skin, sw: "none", routine: found.routine }).base;
  const humidDays = fc.next_7_days.filter((d) => d.midday_humidity >= 75).length, dryDays = fc.next_7_days.filter((d) => d.midday_humidity < 40).length, peakDays = fc.next_7_days.filter((d) => d.peak_uv >= 8).length;
  if (found.need === "mel") why = "Melasma stays on Pro+ every day for its visible-light cover, so no switch rule is added.";
  else if (found.isotretinoin && base !== "emulgel") { rule = "dry"; why = `The patient is on isotretinoin, which dries the skin, so I added Emulgel for dry days. ${dryDays} of the next 7 days are dry in ${fc.city}.`; }
  else if (found.routine === "field" && base !== "pro" && peakDays >= 2) { rule = "peak"; why = `Field work and ${peakDays} days with UV of 8 or more this week, so I added Pro+ for very high UV days.`; }
  else if ((base === "emulgel" || base === "acne") && humidDays >= 3) { rule = "humid"; why = `${humidDays} of the next 7 days are humid in ${fc.city}, so I added the matte gel for humid days.`; }
  await T.add({ kind: "think", text: why });
  const out = await T.tool(ctx, "copilot", "build_shield_plan", { name: found.name || "Patient", age: found.age || "", need: found.need, skin: found.skin, city: found.city, routine: found.routine, weather_rule: rule });
  if (out.fit === false) {
    await T.add({ kind: "guard", text: out.guardrail });
    await T.add({ kind: "answer", text: `${out.guardrail} ${out.note}` });
    return { steps: T.steps, result: out };
  }
  for (const g of out.guardrail_notes) await T.add({ kind: "guard", text: g });
  await T.add({ kind: "guard", text: "This is a draft. Nothing reaches the patient until you approve it." });
  await T.add({ kind: "answer", text: `I suggest ${out.variant}, with ${out.backup} as the backup${out.second_tube ? ` and ${out.second_tube}` : ""}. Today in ${fc.city} the peak UV is ${out.today.peak_uv}, so ${out.plan.n} would apply ${out.today.tube} at ${out.today.times}. Reapply every ${out.reapply_every_hours} hours outdoors.` });
  return { steps: T.steps, result: out };
}

/* =====================================================================
   Agent 2. Patient Companion (on the patient's phone)
   ===================================================================== */
const DAYWORD = /\b(today|tomorrow|sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|wed|thu|fri|sat)\b/i;
export function companionIntent(q) {
  const t = String(q).toLowerCase();
  if (redFlag(t)) return "escalate";
  if (OTHER_BRANDS.some((b) => t.includes(b)) || /switch (to|brand)|cheaper|another (brand|sunscreen)|instead of photostable/.test(t)) return "otherbrand";
  if (/beach|trek|hike|picnic|wedding|trip|travel|outing|match|cricket|sightseeing|outdoor|out all day|whole day out|festival|garba|holi/.test(t)) return "dayout";
  if (/finish|empty|run(ning)? out|refill|buy|stock|reserve|another tube|new tube|where (can|do) i get/.test(t)) return "refill";
  if (/oily|sticky|greasy|heavy|white cast|feels|texture|too thick|pilling/.test(t)) return "feel";
  if (/cloud|rain|overcast|monsoon|indoors|inside|at home|winter|cold/.test(t)) return "cloudy";
  if (/forgot|missed|skip|late/.test(t)) return "missed";
  if (/how much|quantity|amount|finger|dose/.test(t)) return "dose";
  return "plan";
}

export async function runCompanion(ctx, question, onStep) {
  const T = tracer(onStep), p = ctx.patient;
  const q = String(question || "").slice(0, 400);
  const flag = redFlag(q);
  if (flag) {
    await T.add({ kind: "guard", text: `The message mentions "${flag}", which is a clinical question. The agent does not give advice on it and hands over to a pharmacist.` });
    const urgent = /swell|blister|eye|breath|bleed|fever|hives/.test(q.toLowerCase());
    const tk = await T.tool(ctx, "companion", "escalate_to_care_desk", { reason: q, severity: urgent ? "urgent" : "routine" });
    await T.add({ kind: "handoff", to: "Care desk pharmacist", text: `Ticket ${tk.ticket} is open. ${tk.eta}` });
    await T.add({ kind: "answer", text: `I have passed this to a pharmacist on the ShieldCast care desk, ticket ${tk.ticket}. ${tk.eta} If the skin is red, swollen or blistering, wash the sunscreen off with plain water and do not reapply until you have spoken to them or your doctor. If it is severe, see a doctor now.` });
    return { steps: T.steps, actions: [] };
  }
  const intent = companionIntent(q);
  await T.add({ kind: "think", text: { otherbrand: "The patient asked about another product. I can only help with the plan the doctor wrote.", dayout: "The patient will be outdoors longer than usual on one day. I will change the routine for that day only and recalculate the times.", refill: "The patient needs a refill. I will check the tube clock and the stock at partner pharmacies.", feel: "The patient has feedback on texture. I cannot switch the variant, but I can record it for the doctor and check if a weather rule already covers it.", cloudy: "The patient thinks protection may not be needed. I will check the actual UV forecast, because UV passes through clouds.", missed: "The patient missed an application. I will find the next time and whether to apply now.", dose: "The patient wants to know how much to use.", plan: "The patient wants today's plan." }[intent] });
  const actions = [];
  let answer = "";
  if (intent === "otherbrand") {
    await T.add({ kind: "guard", text: "The agent never recommends or compares other brands, and the pharmacy can only offer the doctor's backup." });
    const fs = await T.tool(ctx, "companion", "find_stock", {});
    answer = `I can only help with the plan Dr ${p.plan.doc.replace(/^Dr\.?\s*/, "")} wrote, which is ${fs.prescribed} with ${fs.backup} as the backup. If cost or feel is the problem, I can note it for your doctor so they can review it at your next visit.`;
  } else if (intent === "dayout") {
    const dm = q.match(DAYWORD), day = dm ? dm[1] : "today";
    const r = await T.tool(ctx, "companion", "set_day_routine", { day, routine: "field" });
    if (r.error) answer = r.error;
    else {
      answer = `On ${r.day} the peak UV in ${CITIES[p.plan.city].name} is ${r.peak_uv} (${r.band.toLowerCase()}). Because you will be out most of the day, I changed that day only. Use ${r.tube} at ${joinList(r.times.map((x) => x.time))}. Each time use two finger-lengths for face and neck, and add a hat and shade at midday.`;
      if (r.peak_uv >= 8 && /beach|sea|pool|swim/.test(q.toLowerCase())) answer += " Sand and water reflect UV, so do not skip the midday reapplication.";
    }
  } else if (intent === "refill") {
    const ts = await T.tool(ctx, "companion", "tube_status", {});
    const fs = await T.tool(ctx, "companion", "find_stock", {});
    const best = fs.stores.find((s) => s.prescribed_in_stock > 0) || fs.stores.find((s) => s.backup_in_stock > 0);
    if (best) {
      const pr = await T.tool(ctx, "companion", "reserve_refill", { store_id: best.store_id });
      if (pr.proposal) actions.push({ type: "reserve", label: `Hold ${pr.proposal.tube} at ${pr.proposal.store}`, proposal: pr.proposal });
      await T.add({ kind: "guard", text: "The tube is held only after you tap to confirm." });
      answer = `${ts.days_left != null ? `Your tube has about ${ts.days_left} days left at ${ts.grams_per_day} g a day.` : `A tube lasts about ${ts.tube_lasts_days} days at your forecast use.`} ${best.name} (${best.distance}) has ${best.prescribed_in_stock > 0 ? fs.prescribed : `the backup, ${fs.backup}`} in stock. Tap below and I will hold it for 24 hours.`;
    } else answer = "Neither your tube nor the backup is in stock at the partner pharmacies right now. I have told the pharmacy agent, and the shelf usually refills within two days.";
  } else if (intent === "feel") {
    const fb = await T.tool(ctx, "companion", "log_feedback_for_doctor", { feedback: q });
    const r = resolvePlan(p.plan);
    answer = `Thank you, I have noted this for your doctor. ${fb.note} ${r.second ? `Your plan already switches to ${skuName(r.second)} when ${lower1(r.sw.when)}.` : "I cannot change the variant myself, because that is your doctor's decision."} Meanwhile, apply on clean, dry skin and let it settle for two minutes before makeup.`;
  } else if (intent === "cloudy") {
    const dm = q.match(DAYWORD);
    const r = await T.tool(ctx, "companion", "todays_protection", { day: dm ? dm[1] : "today" });
    const when = dm && dm[1].toLowerCase() !== "today" ? r.day : "today";
    answer = r.peak_uv >= 3 ? `The forecast for ${when} still shows a peak UV of ${r.peak_uv}, which is ${r.band.toLowerCase()}. Most UV passes through light cloud, so keep to your times: ${joinList(r.times.map((x) => x.time))}.${p.plan.need === "mel" ? " Visible light through windows also darkens melasma, so keep the midday top-up even indoors." : ""}` : `The UV forecast for ${when} stays low, with a peak of ${r.peak_uv}. One morning application at ${r.times[0].time} is enough.`;
  } else if (intent === "missed") {
    const r = await T.tool(ctx, "companion", "todays_protection", { day: "today" });
    answer = `No problem. If you are outdoors now and the UV is 3 or more, apply two finger-lengths now and carry on with the next time on your list. Today's times are ${joinList(r.times.map((x) => x.time))}.`;
  } else if (intent === "dose") {
    answer = `${DOSE_TEXT}. That is about 1.25 g each time, so a 50 g tube lasts about 40 applications.`;
  } else {
    const dm = q.match(DAYWORD);
    const r = await T.tool(ctx, "companion", "todays_protection", { day: dm ? dm[1] : "today" });
    answer = `${dm && dm[1].toLowerCase() !== "today" ? "On " + r.day : "Today"} the peak UV is ${r.peak_uv} (${r.band.toLowerCase()}). Use ${r.tube} at ${joinList(r.times.map((x) => x.time))}. ${r.why}`;
  }
  const g = guardReply(answer);
  if (g.blocked) await T.add({ kind: "guard", text: g.blocked });
  await T.add({ kind: "answer", text: g.text });
  return { steps: T.steps, actions };
}

/* =====================================================================
   Agent 3. Pharmacy Restock agent (for a partner pharmacy)
   ===================================================================== */
export const WEEKLY_BASE = { pro: 2, gold: 3, acne: 2, emulgel: 2 }; // tubes a week at a partner pharmacy; to be calibrated in the pilot
export async function runRestock(ctx, city, onStep, dueByCity) {
  const T = tracer(onStep);
  const stores = STORES[city] || storesFor(city);
  await T.add({ kind: "think", text: `I check the shelf at ${stores.length} partner pharmacies in ${CITIES[city].name}, the UV load for the coming week and the refills that fall due.` });
  const sig = await T.tool(ctx, "restock", "restock_signal", { city });
  const due = (dueByCity && dueByCity[city]) || {};
  if (Object.keys(due).length) await T.add({ kind: "think", text: `ShieldCast patients with a refill due this week: ${Object.entries(due).map(([k, v]) => `${v} on ${SKUS[k].short}`).join(", ")}.` });
  const pos = [];
  for (const s of stores) {
    const st = stockOf(ctx, s), lines = [];
    for (const k of SKU_ORDER) {
      let need = WEEKLY_BASE[k] * (1 + sig.lift / 100);
      if (sig.humidDays >= 4 && (k === "gold" || k === "acne")) need += 1;
      if (sig.humidDays < 4 && sig.lift && k === "pro") need += 1;
      need += Math.ceil((due[k] || 0) / stores.length);
      const order = Math.max(0, Math.ceil(need) - (st[k] || 0));
      if (order > 0) lines.push({ sku: k, have: st[k] || 0, target: Math.ceil(need), order: Math.min(order, 12) });
    }
    if (lines.length) {
      ctx.store.set("sc-po", ctx.store.get("sc-po", []).filter((x) => !(x.store === s.id && x.status === "awaiting approval")));
      const po = push(ctx, "sc-po", { store: s.id, storeName: s.name, city, lines, status: "awaiting approval" }, 30);
      pos.push(po);
      await T.add({ kind: "think", text: `${s.name}: order ${lines.map((l) => `${l.order} ${SKUS[l.sku].short}`).join(", ")} to reach a week's cover.` });
    } else await T.add({ kind: "think", text: `${s.name} already holds a week's cover.` });
  }
  await T.add({ kind: "guard", text: "Each order is a draft. The pharmacist approves it, and no other brand can be added." });
  await T.add({ kind: "answer", text: `UV load ${sig.load} in ${CITIES[city].name} gives a ${sig.level} signal${sig.lift ? `, so I planned about ${sig.lift}% more cover. ${sig.mix}` : ". Normal cover is enough."} ${pos.length ? `${pos.length} draft order${pos.length === 1 ? " is" : "s are"} waiting for approval.` : "No order is needed."}` });
  return { steps: T.steps, pos, signal: sig };
}

/* =====================================================================
   Agent 4. Orchestrator (the 6 am morning run)
   ===================================================================== */
export async function runOrchestrator(ctx, onStep) {
  const T = tracer(onStep);
  const people = cohort(ctx.today);
  const cities = [...new Set(people.map((x) => x.plan.city))];
  await T.add({ kind: "think", text: `It is the 6 am run. There are ${people.length} active plans in ${cities.length} cities, so I fetch ${cities.length} forecasts, not ${people.length}.` });
  const fc = {};
  for (const c of cities) { const out = await T.tool(ctx, "orchestrator", "get_uv_forecast", { city: c }); fc[c] = (await ctx.forecast(c)).days; void out; }
  let sent = 0, held = 0, cost = 0; const dueByCity = {}; const nudges = []; const variants = {};
  for (const x of people) {
    const d = fc[x.plan.city][0], t = todaysTube(x.plan, d), sch = daySchedule(x.plan, d.hours);
    variants[t.sku] = (variants[t.sku] || 0) + 1;
    const avg = averageDailyGrams(x.plan, fc[x.plan.city].slice(0, 7)), st = tubeStatus(x.opened, avg, ctx.today);
    let text = `Good morning ${x.plan.n}. Peak UV in ${CITIES[x.plan.city].name} today is ${Math.round(d.uvMax)}. Use ${SKUS[t.sku].short} at ${times(sch)}.`;
    if (t.switched) text += " Your doctor's weather rule applies today.";
    if (st.daysLeft <= 7) { text += ` Your tube has about ${st.daysLeft} days left. Reply REFILL to hold one nearby.`; const r = resolvePlan(x.plan); (dueByCity[x.plan.city] = dueByCity[x.plan.city] || {})[r.base] = (dueByCity[x.plan.city][r.base] || 0) + 1; nudges.push(x.plan.n); }
    text += " Reply STOP to end reminders.";
    const out = await TOOLS.queue_whatsapp.run(ctx, { code: x.code, text, consent: x.consent });
    if (out.sent) { sent++; cost += out.cost_inr; } else held++;
  }
  await T.add({ kind: "tool", name: "queue_whatsapp", args: { patients: people.length } });
  await T.add({ kind: "result", name: "queue_whatsapp", out: { queued: sent, refused_no_consent: held, cost_inr: +cost.toFixed(2) } });
  await T.add({ kind: "guard", text: `${held} patient${held === 1 ? " has" : "s have"} not opted in, so the consent check refused their messages.` });
  if (nudges.length) await T.add({ kind: "think", text: `Refills fall due this week for ${nudges.join(", ")}. I add them to the pharmacy demand.` });
  const hot = [];
  for (const c of cities) { const s = restockSignal(fc[c].slice(0, 7)); if (s.level !== "low" || dueByCity[c]) hot.push(c); }
  for (const c of hot) {
    await T.add({ kind: "handoff", to: "Pharmacy Restock agent", text: `Hand-off for ${CITIES[c].name}.` });
    await runRestock(ctx, c, async (s) => { if (s.kind === "answer") await T.add({ kind: "result", name: "restock agent", out: { city: CITIES[c].name, summary: s.text } }); }, dueByCity);
  }
  const desk = ctx.store.get("sc-desk", []).filter((t) => t.status === "open");
  const fb = ctx.store.get("sc-feedback", []).filter((f) => f.shared);
  const digest = { patients: people.length, messages: sent, cost_inr: +cost.toFixed(2), variants, refills_due: nudges.length, open_tickets: desk.length, feedback_for_doctor: fb.length };
  await T.add({ kind: "handoff", to: "Rep Copilot brief", text: `Doctor digest: ${people.length} patients, tubes in use today ${Object.entries(variants).map(([k, v]) => `${v} ${SKUS[k].short}`).join(", ")}, ${nudges.length} refills due, ${desk.length} open care-desk tickets and ${fb.length} texture note${fb.length === 1 ? "" : "s"} shared with the clinic.` });
  await T.add({ kind: "answer", text: `Morning run done. ${sent} reminders queued at about ₹${cost.toFixed(2)} in total, ${held} held back for lack of consent, ${hot.length} cit${hot.length === 1 ? "y" : "ies"} passed to the Restock agent and one digest prepared for the doctor and the medical rep.` });
  return { steps: T.steps, digest };
}

/* =====================================================================
   Optional: Claude plans the tool calls (Copilot and Companion only)
   ===================================================================== */
export const SYSTEMS = {
  copilot: `You are the ShieldCast Prescribing Copilot for an Indian dermatologist. Turn the doctor's short note into a draft Shield Plan for Sun Pharma's Photostable range (Gold, Acne, Emulgel, Pro+). Always call get_uv_forecast for the patient's city first and then build_shield_plan. Choose a weather_rule only with a clinical reason: dry for isotretinoin, peak for long outdoor work with UV 8 or more this week, humid for gel-preferring skin on a humid week. Never add a humid or dry rule for melasma. Never mention any other brand. End with two or three plain sentences for the doctor and say the plan is a draft for their approval.`,
  companion: `You are the ShieldCast Patient Companion, inside a patient's Photostable plan written by their dermatologist. Use the tools to answer with exact times from the live UV forecast. You may change the routine for one day, check the tube clock, find stock and propose a refill hold. You must never change the prescribed variant, never give a diagnosis, never discuss other brands and never advise on a skin reaction, eyes, pregnancy or children; for those, call escalate_to_care_desk. Reply in two to four short, plain sentences.`,
};
export async function runWithClaude(ctx, agentId, userText, onStep, cfg) {
  const T = tracer(onStep);
  if (agentId === "companion" && redFlag(userText)) return runCompanion(ctx, userText, onStep); // the hard guardrail runs before any model call
  const url = (cfg.proxy ? cfg.proxy.replace(/\/$/, "") : "https://api.anthropic.com") + "/v1/messages";
  const headers = { "content-type": "application/json", "anthropic-version": "2023-06-01" };
  if (!cfg.proxy) { headers["x-api-key"] = cfg.key; headers["anthropic-dangerous-direct-browser-access"] = "true"; }
  const ctxNote = agentId === "companion" && ctx.patient ? `\n\nPatient: ${ctx.patient.plan.n}, ${NEEDS[ctx.patient.plan.need].label}, ${CITIES[ctx.patient.plan.city].name}, routine ${ROUTINES[ctx.patient.plan.routine].label}. Today is ${ctx.today}.` : `\n\nToday is ${ctx.today}. The clinic is in Pune.`;
  const messages = [{ role: "user", content: userText }];
  const actions = []; let result = null;
  await T.add({ kind: "think", text: `Claude (${cfg.model}) is planning which tools to call. The tools and guardrails are the same as in rules mode.` });
  for (let turn = 0; turn < 6; turn++) {
    const r = await fetch(url, { method: "POST", headers, body: JSON.stringify({ model: cfg.model, max_tokens: 900, system: SYSTEMS[agentId] + ctxNote, tools: claudeTools(agentId), messages }) });
    if (!r.ok) { const e = await r.text(); throw new Error(`Claude API ${r.status}: ${e.slice(0, 200)}`); }
    const j = await r.json();
    messages.push({ role: "assistant", content: j.content });
    const uses = j.content.filter((c) => c.type === "tool_use");
    const texts = j.content.filter((c) => c.type === "text").map((c) => c.text).join("\n").trim();
    if (!uses.length) {
      const g = guardReply(texts || "Done.");
      if (g.blocked) await T.add({ kind: "guard", text: g.blocked });
      await T.add({ kind: "answer", text: g.text });
      return { steps: T.steps, actions, result };
    }
    if (texts) await T.add({ kind: "think", text: texts });
    const results = [];
    for (const u of uses) {
      const out = await T.tool(ctx, agentId, u.name, u.input || {});
      if (u.name === "build_shield_plan" && out.fit) result = out;
      if (u.name === "reserve_refill" && out.proposal) actions.push({ type: "reserve", label: `Hold ${out.proposal.tube} at ${out.proposal.store}`, proposal: out.proposal });
      if (u.name === "escalate_to_care_desk" && out.ticket) await T.add({ kind: "handoff", to: "Care desk pharmacist", text: `Ticket ${out.ticket} is open.` });
      results.push({ type: "tool_result", tool_use_id: u.id, content: JSON.stringify(out) });
    }
    messages.push({ role: "user", content: results });
  }
  await T.add({ kind: "guard", text: "The agent stopped after six steps, which is the limit." });
  return { steps: T.steps, actions, result };
}
