import { SKUS, SKU_ORDER, NEEDS, SWITCHES, ROUTINES, CITIES, STORES, storesFor, TUBE_G, DOSE_G, DOSE_TEXT, SITE_URL } from "./data.js";
import { encodePlan, decodePlan, planCode, resolvePlan, uvBand, todaysTube, daySchedule, averageDailyGrams, tubeStatus, restockSignal, fmtTime, skuName, icsFor } from "./plan.js";
import { cityForecast, metroOutlook, todayISO } from "./forecast.js";

/* ---------------- helpers ---------------- */
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
};
function toast(t) { const el = $("#toast"); el.textContent = t; el.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => { el.hidden = true; }, 3000); }
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayLabel = (iso) => { const d = new Date(iso + "T00:00:00"); return `${DAYS[d.getDay()]} ${d.getDate()}`; };
const dateLong = (iso) => { const d = new Date(iso + "T00:00:00"); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; };
const uvChip = (uv) => `<span class="uvchip uv-${uvBand(uv).key}">${Math.round(uv)}</span>`;
const baseUrl = () => (location.protocol.startsWith("http") ? location.origin + location.pathname : SITE_URL);
const planUrl = (token) => `${baseUrl()}?rx=${token}#today`;
function qrInto(el, text, size = 300) {
  if (!el) return;
  if (el.dataset.text === text) return;
  el.dataset.text = text; el.innerHTML = "";
  const draw = () => { if (window.QRCode) new window.QRCode(el, { text, width: size, height: size, colorDark: "#1F1A3A", colorLight: "#FFFFFF", correctLevel: window.QRCode.CorrectLevel.M }); else el.textContent = "QR code unavailable"; };
  if (window.QRCode) draw(); else window.addEventListener("load", draw, { once: true });
}
function chips(el, items, name, current, onChange, disabled = () => false) {
  el.innerHTML = items.map((o) => `<label class="chip"><input type="radio" name="${name}" value="${o.id}" ${o.id === current ? "checked" : ""} ${disabled(o) ? "disabled" : ""}><span>${esc(o.label)}</span></label>`).join("");
  el.onchange = (e) => onChange(e.target.value);
}

/* ---------------- sample plans ---------------- */
const TODAY = todayISO();
const SAMPLES = [
  { v: 1, n: "Ananya", a: "29", need: "mel", skin: "combo", city: "pune", routine: "commute", sw: "none", doc: "Dr Meera Iyer", clinic: "Skin clinic, Kothrud, Pune", d: TODAY },
  { v: 1, n: "Rohit", a: "22", need: "acne", skin: "oily", city: "mumbai", routine: "office", sw: "dry", doc: "Dr Meera Iyer", clinic: "Skin clinic, Kothrud, Pune", d: TODAY },
  { v: 1, n: "Farah", a: "41", need: "pih", skin: "combo", city: "chennai", routine: "field", sw: "peak", doc: "Dr Meera Iyer", clinic: "Skin clinic, Kothrud, Pune", d: TODAY },
];
const sampleToken = (i) => encodePlan(SAMPLES[i]);

/* ---------------- routing ---------------- */
const VIEWS = ["home", "doctor", "today", "pharmacy", "supply", "how"];
const params = new URLSearchParams(location.search);
let rxToken = params.get("rx");
function route() {
  let v = location.hash.slice(1) || (rxToken ? "today" : "home");
  if (!VIEWS.includes(v)) v = "home";
  VIEWS.forEach((n) => { $("#v-" + n).hidden = n !== v; });
  document.querySelectorAll(".tabs a").forEach((a) => { if (a.dataset.v === v) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
  ({ home: renderHome, doctor: renderDoctor, today: renderPatient, pharmacy: renderPharmacy, supply: renderSupply, how: renderHow })[v]();
  window.scrollTo(0, 0);
}
window.addEventListener("hashchange", route);

/* ================= HOME ================= */
let homeDone = false;
async function renderHome() {
  $("#sampleLink").href = `?rx=${sampleToken(0)}#today`;
  const steps = [
    ["Doctor", "Writes a Shield Plan", "One variant, a backup and an optional weather rule.", "#doctor"],
    ["QR card", "Carries the plan", "The prescription lives in the link, with a check code.", "#doctor"],
    ["Forecast", "Reads today's sky", "Live hourly UV and humidity for the patient's city.", `?rx=${sampleToken(0)}#today`],
    ["Patient", "Gets exact times", "Which tube today, when to apply and when to reapply.", `?rx=${sampleToken(0)}#today`],
    ["Reminders", "Nudges by weather", "A calendar file now, WhatsApp with consent in the pilot.", `?rx=${sampleToken(0)}#today`],
    ["Pharmacy", "Verifies and dispenses", "Scan the card and hand over the exact tube or the backup.", "#pharmacy"],
    ["Supply", "Restocks ahead of UV", "The week's UV load flags which cities need more tubes.", "#supply"],
  ];
  $("#loop").innerHTML = steps.map((s, i) => `<li><a href="${s[3]}"><span class="n">${String(i + 1).padStart(2, "0")} · ${esc(s[0])}</span><b>${esc(s[1])}</b><span class="d">${esc(s[2])}</span></a></li>`).join("");
  if (homeDone) return; homeDone = true;
  const ids = Object.keys(CITIES);
  const { cities, live } = await metroOutlook(ids);
  $("#skyLive").textContent = live ? "Live forecast" : "Sample forecast";
  $("#skyLive").className = "pill " + (live ? "ok" : "warn");
  $("#sky").innerHTML = cities.map((c) => { const d = c.days[0]; return `<div class="skycity"><span>${esc(CITIES[c.id].name)}</span><span class="row" style="gap:6px"><span class="tiny muted-light">${uvBand(d.uvMax).label}</span>${uvChip(d.uvMax)}</span></div>`; }).join("");
}

/* ================= DOCTOR ================= */
const SKINS = [{ id: "oily", label: "Oily" }, { id: "combo", label: "Combination" }, { id: "normal", label: "Normal" }, { id: "dry", label: "Dry" }];
const F = { n: "Ananya", a: "29", need: "mel", skin: "combo", city: "pune", routine: "commute", sw: "none" };
let issued = null, docInit = false;
function formPlan() { return { v: 1, n: F.n, a: F.a, need: F.need, skin: F.skin, city: F.city, routine: F.routine, sw: F.sw, doc: "Dr Meera Iyer", clinic: "Skin clinic, Kothrud, Pune", d: TODAY }; }
function swDisabled(o) {
  if (o.id === "none") return false;
  const r = resolvePlan(formPlan());
  if (!r.base) return true;
  if (F.need === "mel" && (o.id === "humid" || o.id === "dry")) return true;
  return SWITCHES[o.id].sku === r.base;
}
function renderDoctor() {
  if (!docInit) {
    docInit = true;
    $("#fCity").innerHTML = Object.values(CITIES).map((c) => `<option value="${c.id}" ${c.id === F.city ? "selected" : ""}>${esc(c.name)}</option>`).join("");
    $("#fName").oninput = (e) => { F.n = e.target.value.replace(/[^\p{L} .'-]/gu, "").slice(0, 20); };
    $("#fAge").oninput = (e) => { F.a = e.target.value.replace(/\D/g, "").slice(0, 3); };
    $("#fCity").onchange = (e) => { F.city = e.target.value; preview(); };
    $("#issueBtn").onclick = issue;
  }
  chips($("#cNeed"), Object.values(NEEDS), "need", F.need, (v) => { F.need = v; if (swDisabled(SWITCHES[F.sw])) F.sw = "none"; renderDoctor(); });
  chips($("#cSkin"), SKINS, "skin", F.skin, (v) => { F.skin = v; if (swDisabled(SWITCHES[F.sw])) F.sw = "none"; renderDoctor(); });
  chips($("#cRoutine"), Object.values(ROUTINES), "routine", F.routine, (v) => { F.routine = v; preview(); });
  chips($("#cSwitch"), Object.values(SWITCHES), "sw", F.sw, (v) => { F.sw = v; preview(); }, swDisabled);
  $("#swNote").textContent = F.need === "mel" ? "For melasma, Pro+ stays on every day because of its visible-light cover, so only the very-high-UV rule could apply, and Pro+ is already the base." : "A second tube is written only when a weather rule gives a clinical reason, for example Emulgel on dry days for a patient on isotretinoin.";
  preview(); renderIssued();
}
async function preview() {
  const plan = formPlan(), r = resolvePlan(plan), el = $("#planPreview");
  if (!r.base) {
    const n = ls.get("sc-gaps", 0);
    el.innerHTML = `<span class="eyebrow">Shield Plan</span><div class="gapbox"><b>No Photostable fit.</b> ${esc(r.need.note)} <div class="row" style="margin-top:8px"><button class="btn small" id="gapBtn" type="button">Log this patient as a gap</button><span class="small">${n} case${n === 1 ? "" : "s"} logged on this device.</span></div></div>`;
    $("#issueBtn").disabled = true;
    $("#gapBtn").onclick = () => { ls.set("sc-gaps", n + 1); toast("Logged for the brand team's mineral-variant sizing"); preview(); };
    return;
  }
  $("#issueBtn").disabled = false;
  const S = SKUS[r.base];
  el.innerHTML = `<span class="eyebrow">Shield Plan preview</span>
    <div class="sku"><img src="${S.img}" alt=""><div><div class="nm">${esc(S.name)}</div><div class="small muted">${esc(S.label)} · ${esc(S.texture)}</div></div></div>
    <dl class="kv"><dt>Why</dt><dd>${esc(S.role)}</dd><dt>Backup</dt><dd>${esc(skuName(r.backup))}, only if ${esc(S.short)} is out of stock</dd>
    <dt>Second tube</dt><dd>${r.second ? `${esc(skuName(r.second))} when ${esc(r.sw.when.charAt(0).toLowerCase() + r.sw.when.slice(1))}` : "None"}</dd>
    <dt>Dose</dt><dd>${esc(DOSE_TEXT)}</dd><dt>Reapply</dt><dd>Every ${r.need.reapplyH} hours while the UV index is 3 or more and the patient is outdoors</dd></dl>
    <div id="pvDay" class="small muted">Reading today's forecast for ${esc(CITIES[plan.city].name)}.</div>
    <p class="tiny muted">${esc(r.need.note)}</p>`;
  const { days, live } = await cityForecast(plan.city);
  const d = days[0], sch = daySchedule(plan, d.hours), tube = todaysTube(plan, d);
  const pv = $("#pvDay"); if (!pv) return;
  pv.className = "small";
  pv.innerHTML = `<b>Today in ${esc(CITIES[plan.city].name)}:</b> peak UV ${uvChip(d.uvMax)} so the patient would use <b>${esc(skuName(tube.sku))}</b> at ${sch.apps.map((a) => fmtTime(a.t)).join(", ")}. <span class="pill ${live ? "ok" : "warn"}">${live ? "Live forecast" : "Sample forecast"}</span>`;
}
function issue() {
  const plan = formPlan(); if (!resolvePlan(plan).base) return;
  const token = encodePlan(plan), code = planCode(plan), url = planUrl(token);
  issued = { code, token, url, plan };
  const list = ls.get("sc-issued", []).filter((x) => x.code !== code);
  list.unshift({ code, token, n: plan.n, need: plan.need, city: plan.city, at: Date.now() });
  ls.set("sc-issued", list.slice(0, 30));
  const r = resolvePlan(plan), S = SKUS[r.base];
  $("#cardSlot").innerHTML = `<div class="rxcard fade">
     <div class="view tight" style="gap:10px">
       <div class="row between"><span class="eyebrow">Dr Meera Iyer · Kothrud, Pune</span><span class="mono small">${code}</span></div>
       <div><div class="small muted">For ${esc(plan.n)}${plan.a ? ", " + esc(plan.a) : ""} · ${esc(NEEDS[plan.need].label)}</div><div class="nm">${esc(S.name)} 50 g</div></div>
       <dl class="kv"><dt>How much</dt><dd>${esc(DOSE_TEXT)}</dd><dt>Reapply</dt><dd>Every ${r.need.reapplyH} hours outdoors while UV is 3 or more. Your phone tells you the exact times each day.</dd><dt>Backup</dt><dd>${esc(skuName(r.backup))} only</dd>${r.second ? `<dt>Second tube</dt><dd>${esc(skuName(r.second))} when ${esc(r.sw.when.charAt(0).toLowerCase() + r.sw.when.slice(1))}</dd>` : ""}</dl>
     </div>
     <div class="view tight" style="gap:6px;align-items:center"><div class="qr" id="cardQr"></div><span class="qrcap">Scan for today's UV plan, your tube clock and stock nearby</span></div>
   </div>
   <div class="row noprint"><button class="btn small" id="printBtn" type="button">Print the card</button><a class="btn small ghost" href="${esc(url)}">Open as the patient</a><button class="btn small ghost" id="copyBtn" type="button">Copy the link</button><a class="btn small ghost" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent("Your Photostable ShieldCast plan from Dr Meera Iyer: " + url)}">Share on WhatsApp</a></div>`;
  qrInto($("#cardQr"), url);
  $("#printBtn").onclick = () => window.print();
  $("#copyBtn").onclick = async () => { try { await navigator.clipboard.writeText(url); toast("Link copied"); } catch (e) { prompt("Copy this link", url); } };
  renderIssued(); toast("Card issued. Scan the QR code with your phone.");
}
function renderIssued() {
  const list = ls.get("sc-issued", []);
  $("#issuedCount").textContent = list.length + " card" + (list.length === 1 ? "" : "s");
  $("#issuedTable").innerHTML = `<tr><th>Code</th><th>Patient</th><th>Need</th><th>City</th><th>Issued</th><th></th></tr>` + (list.length ? list.map((x) => `<tr><td class="mono">${esc(x.code)}</td><td>${esc(x.n)}</td><td>${esc(NEEDS[x.need]?.label)}</td><td>${esc(CITIES[x.city]?.name)}</td><td>${dateLong(new Date(x.at).toISOString().slice(0, 10))}</td><td><a href="?rx=${esc(x.token)}#today">Open plan</a></td></tr>`).join("") : `<tr><td colspan="6" class="muted">No cards yet. Issue one above.</td></tr>`);
}

/* ================= PATIENT ================= */
function hourlyChart(hours, windows, apps) {
  const H0 = 6, H1 = 20, W = 640, Hh = 190, L = 34, B = 30, T = 18, max = Math.max(12, ...hours.map((x) => x.uv));
  const x = (h) => L + ((h - H0) / (H1 - H0)) * (W - L - 10), y = (v) => Hh - B - (v / max) * (Hh - B - T);
  const bw = (W - L - 10) / (H1 - H0) - 4;
  const col = (uv) => ({ low: "var(--uv-low)", moderate: "var(--uv-mod)", high: "var(--uv-high)", veryhigh: "var(--uv-vh)", extreme: "var(--uv-ex)" }[uvBand(uv).key]);
  const win = windows.map(([a, b]) => `<rect x="${x(Math.max(a, H0))}" y="${T - 6}" width="${Math.max(2, x(Math.min(b, H1)) - x(Math.max(a, H0)))}" height="${Hh - B - T + 6}" fill="var(--violet)" opacity="0.12" rx="4"/>`).join("");
  const bars = hours.filter((p) => p.h >= H0 && p.h < H1).map((p) => `<rect x="${x(p.h) + 2}" y="${y(p.uv)}" width="${bw}" height="${Math.max(0, Hh - B - y(p.uv))}" rx="3" fill="${col(p.uv)}"><title>${fmtTime(p.h)}: UV ${p.uv.toFixed(1)}</title></rect>`).join("");
  const three = `<line x1="${L}" x2="${W - 10}" y1="${y(3)}" y2="${y(3)}" stroke="var(--muted)" stroke-dasharray="4 4"/><text x="${W - 12}" y="${y(3) - 5}" text-anchor="end" font-size="11" fill="var(--muted)">UV 3, protection needed</text>`;
  const marks = apps.map((a) => `<g><path d="M${x(a.t)} ${Hh - B + 4} l6 10 h-12 z" fill="${a.kind === "apply" ? "var(--orange)" : "var(--ink)"}"/></g>`).join("");
  const ticks = [6, 8, 10, 12, 14, 16, 18].map((h) => `<text x="${x(h)}" y="${Hh - 2}" text-anchor="middle" font-size="11" fill="var(--muted)">${h === 12 ? "12 pm" : h > 12 ? h - 12 + " pm" : h + " am"}</text>`).join("");
  const yt = [0, 4, 8, 12].map((v) => `<text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${v}</text>`).join("");
  return `<svg class="chart" viewBox="0 0 ${W} ${Hh}" role="img" aria-label="Hourly UV index today with outdoor times and sunscreen times">${win}${bars}${three}${marks}${ticks}${yt}</svg>`;
}
async function renderPatient() {
  const plan0 = rxToken ? decodePlan(rxToken) : null;
  $("#noPlan").hidden = !!plan0; $("#planView").hidden = !plan0;
  if (!plan0) {
    $("#examples").innerHTML = SAMPLES.map((s, i) => `<a class="btn ${i ? "ghost" : ""}" href="?rx=${sampleToken(i)}#today">${esc(s.n)}: ${esc(NEEDS[s.need].label)}, ${esc(CITIES[s.city].name)}</a>`).join("");
    return;
  }
  const code = planCode(plan0);
  const routine = ls.get("sc-routine-" + code, plan0.routine);
  const plan = { ...plan0, routine };
  const r = resolvePlan(plan), city = CITIES[plan.city] || CITIES.pune;
  $("#ptHead").innerHTML = `<div class="view tight" style="gap:4px"><span class="eyebrow light">Your Shield Plan · ${esc(code)}</span><h2>Hi ${esc(plan.n)}. Here is today's protection plan for ${esc(city.name)}.</h2><span class="small muted-light">Prescribed by ${esc(plan.doc)}, ${esc(plan.clinic)}, for ${esc(NEEDS[plan.need].label.toLowerCase())}.</span></div><span class="pill ${plan0._valid ? "ok" : "bad"}">${plan0._valid ? "Check code verified" : "Check code does not match. Ask your clinic."}</span>`;
  if (!r.base) { $("#todayPanel").innerHTML = `<div class="gapbox">${esc(r.need.note)}</div>`; return; }
  $("#todayPanel").innerHTML = `<p class="muted">Reading the forecast for ${esc(city.name)}.</p>`;
  const { days, live } = await cityForecast(plan.city);
  const d = days.find((x) => x.date === TODAY) || days[0];
  const tube = todaysTube(plan, d), sch = daySchedule(plan, d.hours), band = uvBand(d.uvMax), S = SKUS[tube.sku];
  const doneKey = `sc-done-${code}-${d.date}`, done = ls.get(doneKey, []);
  $("#todayPanel").innerHTML = `
    <div class="row between"><h3>Today, ${dateLong(d.date)}</h3><span class="pill ${live ? "ok" : "warn"}">${live ? "Live forecast" : "Sample forecast, live data unavailable"}</span></div>
    <div class="bigtube"><img src="${S.img}" alt=""><div class="view tight" style="gap:4px"><span class="eyebrow">Use today</span><b style="font-family:var(--f-display);font-size:1.4rem">${esc(S.name)}</b><span class="small">${esc(tube.reason)}</span></div></div>
    <div class="row"><span>Peak UV</span>${uvChip(d.uvMax)}<b>${band.label}</b><span class="small muted">around ${fmtTime(sch.peak.h)}. ${esc(band.advice)}</span></div>
    ${hourlyChart(d.hours, r.routine.windows, sch.apps)}
    <p class="tiny muted">Bars show the hourly UV index. Shaded bands are the times you are usually outdoors. Orange marks are when to apply and dark marks are when to reapply.</p>
    <ul class="sched">${sch.apps.map((a, i) => `<li class="${done.includes(i) ? "done" : ""}"><span class="t">${fmtTime(a.t)}</span><span>${a.kind === "apply" ? "Apply" : "Reapply"} ${esc(S.short)}: two finger-lengths for face and neck${a.kind === "apply" ? ", 15 minutes before you step out" : ""}.</span><label><input type="checkbox" data-i="${i}" ${done.includes(i) ? "checked" : ""}> Done</label></li>`).join("")}</ul>
    ${sch.pw ? "" : `<p class="small">UV stays below 3 all day, so one morning application is enough.</p>`}`;
  $("#todayPanel").querySelectorAll("input[data-i]").forEach((cb) => cb.addEventListener("change", () => {
    const cur = new Set(ls.get(doneKey, [])); const i = +cb.dataset.i; cb.checked ? cur.add(i) : cur.delete(i); ls.set(doneKey, [...cur]);
    cb.closest("li").classList.toggle("done", cb.checked); renderTube(plan, code, days);
  }));
  $("#weekPanel").innerHTML = `<div class="row between"><h3>Your next 7 days</h3><button class="btn small" id="icsBtn" type="button">Add all reminders to my calendar</button></div>
    <div class="week">${days.slice(0, 7).map((x) => { const t = todaysTube(plan, x), s = daySchedule(plan, x.hours); return `<div class="wday ${t.switched ? "sw" : ""}"><b>${dayLabel(x.date)}</b>${uvChip(x.uvMax)}<span>${esc(SKUS[t.sku].short)}</span><span class="muted">${s.apps.length} time${s.apps.length === 1 ? "" : "s"}</span></div>`; }).join("")}</div>
    ${r.second ? `<p class="small">Highlighted days follow your doctor's rule: ${esc(skuName(r.second))} when ${esc(r.sw.when.charAt(0).toLowerCase() + r.sw.when.slice(1))}.</p>` : ""}
    <p class="tiny muted">The calendar file works with Google Calendar, Apple Calendar and Outlook, and needs no account with us.</p>`;
  $("#icsBtn").onclick = () => {
    const blob = new Blob([icsFor(plan, days.slice(0, 7), code)], { type: "text/calendar" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `shieldcast-${code}.ics`; document.body.appendChild(a); a.click(); a.remove();
    toast("Calendar file downloaded. Open it to add the reminders.");
  };
  renderTube(plan, code, days);
  renderRemind(plan, code, days);
  $("#routinePanel").innerHTML = `<h3>Is your day different from the plan?</h3><p class="small muted">Change your usual routine and the times update. This stays on your phone.</p><div class="chips" id="cRoutineP"></div>`;
  chips($("#cRoutineP"), Object.values(ROUTINES), "routineP", routine, (v) => { ls.set("sc-routine-" + code, v); renderPatient(); });
}
function renderTube(plan, code, days) {
  const opened = ls.get("sc-opened-" + code, null);
  const avg = averageDailyGrams(plan, days.slice(0, 7));
  const r = resolvePlan(plan);
  const el = $("#tubePanel");
  if (!opened) {
    el.innerHTML = `<h3>Your tube clock</h3><p class="small">A 50 g tube lasts about ${Math.round(TUBE_G / avg)} days at your forecast use of ${avg.toFixed(1)} g a day. Start the clock when you open the tube.</p><div class="row"><button class="btn" id="openBtn" type="button">I opened a new tube today</button></div>`;
    $("#openBtn").onclick = () => { ls.set("sc-opened-" + code, TODAY); renderTube(plan, code, days); toast("Tube clock started"); };
    return;
  }
  const st = tubeStatus(opened, avg, TODAY);
  const C = 2 * Math.PI * 44, off = C * (1 - st.pctLeft);
  const res = ls.get("sc-reserve-" + code, null);
  el.innerHTML = `<h3>Your tube clock</h3>
    <div class="ring"><svg width="110" height="110" viewBox="0 0 110 110" aria-hidden="true"><circle cx="55" cy="55" r="44" stroke="var(--sunk)" stroke-width="12" fill="none"/><circle cx="55" cy="55" r="44" stroke="${st.dueSoon ? "var(--rust)" : "var(--teal)"}" stroke-width="12" fill="none" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${off}" transform="rotate(-90 55 55)"/><text x="55" y="52" text-anchor="middle" font-size="22" font-weight="700" fill="var(--ink)">${st.daysLeft}</text><text x="55" y="70" text-anchor="middle" font-size="11" fill="var(--muted)">days left</text></svg>
    <div class="view tight" style="gap:4px"><span>Opened on ${dateLong(opened)}. About ${Math.round(st.left)} g of ${TUBE_G} g is left at ${avg.toFixed(1)} g a day.</span><span class="small ${st.dueSoon ? "" : "muted"}">${st.dueSoon ? "Your tube is running low. Reserve the refill now." : `We will remind you to refill around ${dateLong(st.refillBy)}.`}</span><button class="btn ghost small" id="resetTube" type="button" style="align-self:flex-start">I opened a new tube</button></div></div>
    <div><span class="eyebrow">Refill near you</span></div>
    <div class="view tight" style="gap:8px">${storesFor(plan.city).map((s) => { const stock = stockFor(s); const q = stock[r.base] || 0, qb = stock[r.backup] || 0; const mine = res && res.store === s.id; return `<div class="store"><div><b>${esc(s.name)}</b> <span class="small muted">${esc(s.dist)}</span></div><div class="row">${mine ? `<span class="pill vi">Held for you: show ${esc(res.pin)}</span>` : q > 0 ? `<span class="pill ok">${q} ${esc(SKUS[r.base].short)} in stock</span><button class="btn small" data-res="${s.id}" data-sku="${r.base}" type="button">Reserve</button>` : qb > 0 ? `<span class="pill warn">${esc(SKUS[r.base].short)} out, ${esc(SKUS[r.backup].short)} in stock</span><button class="btn small ghost" data-res="${s.id}" data-sku="${r.backup}" type="button">Reserve backup</button>` : `<span class="pill bad">Out of stock</span>`}</div></div>`; }).join("")}</div>`;
  $("#resetTube").onclick = () => { ls.set("sc-opened-" + code, TODAY); ls.set("sc-reserve-" + code, null); renderTube(plan, code, days); };
  el.querySelectorAll("[data-res]").forEach((b) => b.addEventListener("click", () => { const pin = String(Math.floor(1000 + Math.random() * 9000)); ls.set("sc-reserve-" + code, { store: b.dataset.res, sku: b.dataset.sku, pin, at: Date.now() }); renderTube(plan, code, days); toast(`Held for 24 hours. Show pickup code ${pin}.`); }));
}
function renderRemind(plan, code, days) {
  const c = ls.get("sc-consent-" + code, { wa: false, check: false, share: false });
  const t = days[1] || days[0], tube = todaysTube(plan, t), sch = daySchedule(plan, t.hours);
  const msg = `Tomorrow in ${CITIES[plan.city].name}: peak UV ${Math.round(t.uvMax)}. Use ${SKUS[tube.sku].short} at ${sch.apps.map((a) => fmtTime(a.t)).join(", ")}. Reply STOP to end reminders.`;
  $("#remindPanel").innerHTML = `<h3>Reminders, only if you say yes</h3>
    <label class="toggle"><input type="checkbox" id="cWa" ${c.wa ? "checked" : ""}> Send me a WhatsApp message each evening with tomorrow's UV and times.</label>
    <label class="toggle"><input type="checkbox" id="cCheck" ${c.check ? "checked" : ""}> Ask me after one week how the sunscreen feels on my skin.</label>
    <label class="toggle"><input type="checkbox" id="cShare" ${c.share ? "checked" : ""}> Tell my clinic how often I applied it, and nothing else.</label>
    ${c.wa ? `<div class="msg">${esc(msg)}<small>Preview of tomorrow's message</small></div>` : ""}
    <p class="tiny muted">Each choice is separate and you can withdraw it at any time, as the DPDP Rules 2025 require. In the pilot these messages come from Sun's verified WhatsApp Business number, at about ₹0.12 for each utility message.</p>`;
  ["Wa", "Check", "Share"].forEach((k) => { $("#c" + k).onchange = (e) => { c[k.toLowerCase()] = e.target.checked; ls.set("sc-consent-" + code, c); renderRemind(plan, code, days); }; });
}

/* ================= PHARMACY ================= */
const HOME_STORE = STORES.pune[0];
function stockFor(store) { const o = ls.get("sc-stock-" + store.id, null); return o || { ...store.stock }; }
function setStock(store, s) { ls.set("sc-stock-" + store.id, s); }
let scanning = null;
function tokenFrom(text) {
  const t = String(text || "").trim();
  const m = t.match(/[?&]rx=([A-Za-z0-9_\-.]+)/); if (m) return m[1];
  if (/^[A-Za-z0-9_\-]+\.[A-Z0-9]{6}$/.test(t)) return t;
  return null;
}
function renderPharmacy() {
  $("#scanBtn").onclick = startScan;
  $("#pasteForm").onsubmit = (e) => { e.preventDefault(); verify($("#pasteIn").value); };
  $("#clearLog").onclick = () => { ls.set("sc-log", []); renderPharmacy(); };
  renderShelf(); renderLog();
  if (!$("#verifyOut").innerHTML) $("#verifyOut").innerHTML = `<p class="small muted">Try it: issue a card in the Doctor view, then scan its QR code here with a second device, or paste its link. You can also use <a href="#" id="tryAnanya">Ananya's sample card</a>.</p>`;
  const ta = $("#tryAnanya"); if (ta) ta.onclick = (e) => { e.preventDefault(); verify(planUrl(sampleToken(0))); };
}
async function startScan() {
  const v = $("#scanVideo"), st = $("#scanState");
  if (scanning) { stopScan(); return; }
  if (!navigator.mediaDevices?.getUserMedia) { st.textContent = "This browser cannot use the camera. Paste the link instead."; return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    v.srcObject = stream; v.hidden = false; await v.play();
    $("#scanBtn").textContent = "Stop scanning"; st.textContent = "Point the camera at the QR code on the card.";
    let detector = null;
    if ("BarcodeDetector" in window) { try { detector = new window.BarcodeDetector({ formats: ["qr_code"] }); } catch (e) { detector = null; } }
    if (!detector && !window.jsQR) await new Promise((res, rej) => { const s = document.createElement("script"); s.src = "vendor/jsQR.js"; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
    const cv = $("#scanCanvas"), ctx = cv.getContext("2d", { willReadFrequently: true });
    scanning = { stream };
    const tick = async () => {
      if (!scanning) return;
      let text = null;
      try {
        if (detector) { const codes = await detector.detect(v); if (codes.length) text = codes[0].rawValue; }
        else if (v.videoWidth) { cv.width = v.videoWidth; cv.height = v.videoHeight; ctx.drawImage(v, 0, 0); const img = ctx.getImageData(0, 0, cv.width, cv.height); const q = window.jsQR(img.data, img.width, img.height); if (q) text = q.data; }
      } catch (e) {}
      if (text && tokenFrom(text)) { stopScan(); verify(text); return; }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  } catch (e) { st.textContent = "The camera was not allowed. Paste the link from the card instead."; }
}
function stopScan() { if (scanning) { scanning.stream.getTracks().forEach((t) => t.stop()); scanning = null; } $("#scanVideo").hidden = true; $("#scanBtn").textContent = "Scan with camera"; $("#scanState").textContent = ""; }
function verify(text) {
  const out = $("#verifyOut"), tok = tokenFrom(text), plan = tok ? decodePlan(tok) : null;
  if (!plan) { out.innerHTML = `<p class="small">That does not look like a ShieldCast card. Check the link and try again.</p>`; return; }
  const r = resolvePlan(plan), code = planCode(plan), stock = stockFor(HOME_STORE);
  const opt = (sku, label) => (stock[sku] || 0) > 0 ? `<button class="btn small" data-d="${sku}" type="button">${label}</button>` : `<span class="pill bad">${esc(SKUS[sku].short)} out of stock</span>`;
  out.innerHTML = `<div class="verify fade ${plan._valid ? "" : "badsig"}">
    <div class="row between"><span class="mono">${esc(code)}</span><span class="pill ${plan._valid ? "ok" : "bad"}">${plan._valid ? "Check code verified" : "Check code does not match"}</span></div>
    <div class="sku"><img src="${SKUS[r.base].img}" alt=""><div><div class="nm" style="font-size:1.2rem">${esc(SKUS[r.base].name)} 50 g</div><div class="small muted">For ${esc(plan.n)}, ${esc(NEEDS[plan.need].label.toLowerCase())}, from ${esc(plan.doc)}</div></div></div>
    <dl class="kv"><dt>Backup</dt><dd>${esc(skuName(r.backup))} only, if ${esc(SKUS[r.base].short)} is out</dd>${r.second ? `<dt>Second tube</dt><dd>${esc(skuName(r.second))} for days when ${esc(r.sw.when.charAt(0).toLowerCase() + r.sw.when.slice(1))}</dd>` : ""}</dl>
    <div class="row">${opt(r.base, "Dispense " + SKUS[r.base].short)}${(stock[r.base] || 0) <= 0 ? opt(r.backup, "Dispense the backup, " + SKUS[r.backup].short) : ""}${r.second ? opt(r.second, "Also dispense " + SKUS[r.second].short) : ""}</div>
    ${plan._valid ? "" : `<p class="small">Do not dispense on this card. Call the clinic to confirm the prescription.</p>`}
  </div>`;
  if (!plan._valid) out.querySelectorAll("[data-d]").forEach((b) => { b.disabled = true; });
  out.querySelectorAll("[data-d]").forEach((b) => b.addEventListener("click", () => {
    const s = stockFor(HOME_STORE), k = b.dataset.d; if ((s[k] || 0) <= 0) return;
    s[k] -= 1; setStock(HOME_STORE, s);
    const log = ls.get("sc-log", []); log.unshift({ at: Date.now(), code, n: plan.n, sku: k, kind: k === r.base ? "Prescribed" : k === r.backup ? "Backup" : "Second tube" }); ls.set("sc-log", log.slice(0, 50));
    toast(`Dispensed ${skuName(k)} and logged it`); renderShelf(); renderLog(); verify(text);
  }));
}
async function renderShelf() {
  const s = stockFor(HOME_STORE);
  $("#shelf").innerHTML = `<tr><th>Variant</th><th>In stock</th><th>Level</th></tr>` + SKU_ORDER.map((k) => `<tr><td>${esc(SKUS[k].name)}</td><td class="num">${s[k] || 0}</td><td><div class="meter"><i class="${(s[k] || 0) <= 1 ? "low" : ""}" style="width:${Math.min(100, ((s[k] || 0) / 8) * 100)}%"></i></div></td></tr>`).join("");
  const low = SKU_ORDER.filter((k) => (s[k] || 0) <= 1);
  const { days, live } = await cityForecast("pune");
  const sig = restockSignal(days.slice(0, 7));
  $("#reorder").innerHTML = `<div class="callout panel" style="padding:12px;gap:8px"><b>This week in Pune: UV load ${sig.load}, ${sig.level} restock signal.</b><span class="small">${sig.lift ? `Hold about ${sig.lift}% more tubes than usual. ${esc(sig.mix)}` : "Normal stock is enough this week."} ${live ? "" : "(Sample forecast.)"}</span>
    ${low.length ? `<div class="row"><button class="btn small" id="approve" type="button">Approve a reorder of 6 each: ${low.map((k) => SKUS[k].short).join(", ")}</button><span class="tiny muted">The system suggests; the pharmacist approves.</span></div>` : ""}</div>`;
  const a = $("#approve"); if (a) a.onclick = () => { const n = stockFor(HOME_STORE); low.forEach((k) => { n[k] = (n[k] || 0) + 6; }); setStock(HOME_STORE, n); toast("Reorder approved and sent to the stockist"); renderShelf(); };
}
function renderLog() {
  const log = ls.get("sc-log", []);
  $("#dispLog").innerHTML = `<tr><th>Time</th><th>Card</th><th>Patient</th><th>Tube</th><th>Type</th></tr>` + (log.length ? log.map((x) => `<tr><td>${new Date(x.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</td><td class="mono">${esc(x.code)}</td><td>${esc(x.n)}</td><td>${esc(skuName(x.sku))}</td><td>${esc(x.kind)}</td></tr>`).join("") : `<tr><td colspan="5" class="muted">Nothing dispensed yet on this device.</td></tr>`);
}

/* ================= SUPPLY ================= */
let supplyDone = false;
function spark(days) {
  const W = 260, H = 64, n = days.length, max = 13, lo = Math.max(0, Math.min(...days.map((d) => d.uvMax)) - 3), x = (i) => 8 + (i * (W - 16)) / (n - 1), y = (v) => H - 8 - ((Math.max(v, lo) - lo) / (max - lo)) * (H - 16);
  const pts = days.map((d, i) => `${x(i)},${y(d.uvMax)}`).join(" ");
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" role="img" aria-label="Peak UV for the next 7 days"><line x1="8" x2="${W - 8}" y1="${y(8)}" y2="${y(8)}" stroke="var(--uv-vh)" stroke-dasharray="3 3" opacity=".6"/><polyline points="${pts}" fill="none" stroke="var(--violet)" stroke-width="2.5"/>${days.map((d, i) => `<circle cx="${x(i)}" cy="${y(d.uvMax)}" r="3.5" fill="var(--violet)"><title>${dayLabel(d.date)}: UV ${d.uvMax.toFixed(1)}</title></circle>`).join("")}</svg>`;
}
async function renderSupply() {
  if (supplyDone) return; supplyDone = true;
  const { cities, live } = await metroOutlook(Object.keys(CITIES));
  $("#supplyLive").textContent = live ? "Live 7-day outlook" : "Sample outlook, live data unavailable";
  $("#supplyLive").className = "pill " + (live ? "ok" : "warn");
  const rows = cities.map((c) => ({ c, s: restockSignal(c.days.slice(0, 7)), peak: Math.max(...c.days.slice(0, 7).map((d) => d.uvMax)) })).sort((a, b) => b.s.load - a.s.load);
  $("#metro").innerHTML = rows.map(({ c, s, peak }) => `<div class="panel mcard ${s.level === "high" ? "high" : ""}">
     <div class="row between"><h3>${esc(CITIES[c.id].name)}</h3><span class="pill ${s.level === "high" ? "or" : s.level === "medium" ? "warn" : ""}">${s.level === "high" ? "Restock now" : s.level === "medium" ? "Watch" : "Normal"}</span></div>
     ${spark(c.days.slice(0, 7))}
     <dl class="kv small"><dt>Peak this week</dt><dd>${uvChip(peak)}</dd><dt>UV load</dt><dd>${s.load}</dd><dt>Humid days</dt><dd>${s.humidDays} of 7</dd></dl>
     <p class="small">${s.lift ? `Top up partner pharmacies by about ${s.lift}%. ${esc(s.mix)}` : "Hold normal stock."}</p>
   </div>`).join("");
}

/* ================= HOW ================= */
let howDone = false;
function renderHow() {
  if (howDone) return; howDone = true;
  const nodes = [
    ["Shield Map", "The doctor picks the need, skin, city, routine and an optional weather rule.", false],
    ["Signed link and QR", "The plan is written into the link with a check code. In production Sun signs it with a private key.", true],
    ["Patient's phone", "The page reads the link and the live forecast and works out the day on the device.", false],
    ["Reminders", "A calendar file today. WhatsApp utility messages from Sun's verified number in the pilot, only with consent.", false],
    ["Partner pharmacy", "The pharmacist scans the card, checks the code and dispenses the exact tube or the backup.", false],
    ["Supply signal", "The 7-day UV load per city tells stockists where to move tubes before demand arrives.", true],
    ["Insight", "Anonymised events only: card scanned, tube dispensed, consent given, tube refilled.", false],
    ["Rep Copilot and doctor report", "Each doctor sees how many of her patients bought, applied and refilled, by variant.", false],
  ];
  $("#arch").innerHTML = nodes.map((n, i) => `<div class="node ${n[2] ? "key" : ""}"><span class="tiny mono">${String(i + 1).padStart(2, "0")}</span><b>${esc(n[0])}</b><span class="small">${esc(n[1])}</span></div>`).join("");
  const li = (arr) => arr.map((t) => `<li>${t}</li>`).join("");
  $("#realList").innerHTML = li([
    "It runs as a static website, so a pilot needs no app store approval and no new hardware in clinics or pharmacies.",
    "The UV data is public. Open-Meteo is free for non-commercial use, and a commercial licence or IMD data covers the pilot.",
    "The QR code works with any phone camera, and the scanner works in any modern mobile browser.",
    "Every rule is plain, testable code. The repository includes automated tests for the plan engine.",
    "It uses Sun's existing field force, stockists and partner pharmacies, so the operating change is small.",
  ]);
  $("#costTable").innerHTML = `<tr><th>Item</th><th>Cost</th></tr>` + [
    ["Rx card with QR code", "About ₹2 a card"],
    ["WhatsApp utility message", "About ₹0.12 each, roughly ₹6 a patient a year at one message a week"],
    ["Website hosting", "Close to zero on a static host or CDN"],
    ["Forecast data", "Free for this prototype; a flat commercial licence for the pilot"],
    ["Care desk pharmacist", "Part of the programme opex in the financial model"],
  ].map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td></tr>`).join("");
  $("#privList").innerHTML = li([
    "No account and no login. The prescription lives in the link, and the patient's ticks and tube date stay in her own browser.",
    "Each reminder needs its own consent, and STOP withdraws it, in line with the DPDP Act 2023 and Rules 2025.",
    "Only anonymised events reach Sun. Names and phone numbers never leave the WhatsApp provider.",
    "The card and desk guide are informational and cost far below the ₹1,000 UCPMP 2024 limit.",
    "The system never suggests another brand. A pharmacy can only offer the backup the doctor wrote.",
    "SPF claims on evidence passports come only from in vivo tests under BIS IS 17494.",
  ]);
  $("#phaseList").innerHTML = li([
    "<b>Prepare.</b> A dermatologist panel signs off the rules, four variants are retested, and the link signing is built. Gate: the rules are approved and the security review passes.",
    "<b>Prove.</b> A 28-week pilot runs in 120 clinic clusters in three arms. Gate: at least 6.1 extra packs per doctor a month over business as usual.",
    "<b>Scale.</b> It extends to the eight metros shown in Supply. Gate: 80% of the pilot gain holds and the UV restock rule beats normal stocking.",
    "<b>National.</b> About 6,000 dermatologists join, along with companion specialists, and the carton gets its own QR code.",
  ]);
  $("#srcList").innerHTML = li([
    `Armstrong A.W. et al., Text-message reminders to improve sunscreen use, Archives of Dermatology, 2009. <a href="https://www.sciencedaily.com/releases/2009/11/091116163220.htm" target="_blank" rel="noopener">Summary</a>.`,
    `World Health Organization, <a href="https://www.who.int/news-room/q-a-detail/radiation-the-ultraviolet-(uv)-index" target="_blank" rel="noopener">The ultraviolet (UV) index</a>.`,
    `Castanedo-Cazares J.P. et al., Near-visible light and UV photoprotection in the treatment of melasma, Photodermatology, Photoimmunology and Photomedicine, 2014.`,
    `KrupaShankar D.S.R. et al., <a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC4065278" target="_blank" rel="noopener">A multicentric clinico-epidemiological study of melasma in India</a>, Dermatology and Therapy, 2014.`,
    `Kohli M. et al., <a href="https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12439021/" target="_blank" rel="noopener">PRISM-ISF Delphi consensus on sunscreen use in Indians</a>, Journal of Cosmetic Dermatology, 2025.`,
    `Euromonitor International, Sun Care in India, May 2026. Source: © Euromonitor International.`,
    `<a href="https://open-meteo.com/en/docs" target="_blank" rel="noopener">Open-Meteo forecast API</a>, hourly uv_index and relative_humidity_2m, CC BY 4.0.`,
    `<a href="https://hmpi.org/2026/07/09/from-infrastructure-to-impact-operationalizing-indias-ayushman-bharat-digital-mission/" target="_blank" rel="noopener">From infrastructure to impact: operationalizing India's Ayushman Bharat Digital Mission</a>, HMPI, July 2026.`,
  ]);
}

/* ---------------- start ---------------- */
route();
