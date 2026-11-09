// Run with: node --test tests/agents.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { sampleForecast } from "../js/forecast.js";
import { planCode } from "../js/plan.js";
import { memoryStore, parseNote, runCopilot, runCompanion, runRestock, runOrchestrator, companionIntent, guardReply, claudeTools, cohort } from "../js/agents.js";

const TODAY = "2026-11-09";
const ctxFor = (patient) => ({ today: TODAY, store: memoryStore(), forecast: async (c) => ({ days: sampleForecast(c, TODAY), live: false }), patient, now: () => Date.parse(TODAY + "T06:00:00Z") });
const ananya = () => { const plan = { v: 1, n: "Ananya", a: "29", need: "mel", skin: "combo", city: "pune", routine: "commute", sw: "none", doc: "Dr Meera Iyer", clinic: "Kothrud", d: TODAY }; return { plan, code: planCode(plan), opened: "2026-10-26", consent: { wa: true, share: true } }; };

test("the copilot reads a one-line note", () => {
  const { found } = parseNote("Ananya 29F, melasma, combination skin, rides a two-wheeler to work in Pune");
  assert.equal(found.name, "Ananya"); assert.equal(found.age, "29"); assert.equal(found.need, "mel");
  assert.equal(found.skin, "combo"); assert.equal(found.city, "pune"); assert.equal(found.routine, "commute");
});

test("the copilot drafts Pro+ for melasma and never adds a humid or dry rule", async () => {
  const out = await runCopilot(ctxFor(), "Kavya 34F melasma oily skin Mumbai office");
  assert.equal(out.result.variant, "Photostable Pro+");
  assert.equal(out.result.plan.sw, "none");
  assert.ok(out.steps.some((s) => s.kind === "guard" && /approve/.test(s.text)));
});

test("isotretinoin adds the Emulgel dry-day rule", async () => {
  const out = await runCopilot(ctxFor(), "Rohit 22M acne on isotretinoin, oily skin, Delhi, office");
  assert.equal(out.result.plan.sw, "dry");
});

test("a post-laser patient gets no prescription and a gap is logged", async () => {
  const ctx = ctxFor();
  const out = await runCopilot(ctx, "Neha 30F after a laser session, Pune");
  assert.equal(out.result.fit, false);
  assert.equal(ctx.store.get("sc-gaplog", []).length, 1);
});

test("a rash goes to the care desk and gets no product advice", async () => {
  const ctx = ctxFor(ananya());
  const out = await runCompanion(ctx, "I got a rash and burning after applying it");
  assert.equal(ctx.store.get("sc-desk", []).length, 1);
  assert.ok(out.steps.some((s) => s.kind === "handoff"));
});

test("a beach day changes only that day's routine", async () => {
  const ctx = ctxFor(ananya());
  const out = await runCompanion(ctx, "Going to the beach tomorrow");
  const ans = out.steps.find((s) => s.kind === "answer").text;
  assert.match(ans, /changed that day only/);
  assert.equal(ctx.store.get("sc-routine-" + ananya().code, null), null);
});

test("the companion refuses to talk about other brands", () => {
  assert.equal(companionIntent("can I use Suncros instead"), "otherbrand");
  assert.ok(guardReply("Try Suncros tint").blocked);
});

test("a refill request proposes a hold but does not make one", async () => {
  const out = await runCompanion(ctxFor(ananya()), "my tube is running out, where can I get one");
  assert.equal(out.actions[0].type, "reserve");
});

test("the restock agent drafts orders for approval only", async () => {
  const ctx = ctxFor();
  const out = await runRestock(ctx, "pune");
  assert.ok(out.pos.every((p) => p.status === "awaiting approval"));
  const again = await runRestock(ctx, "pune");
  assert.equal(ctx.store.get("sc-po", []).length, again.pos.length);
});

test("the orchestrator only messages patients who opted in", async () => {
  const ctx = ctxFor();
  const out = await runOrchestrator(ctx);
  const optedIn = cohort(TODAY).filter((x) => x.consent.wa).length;
  assert.equal(ctx.store.get("sc-outbox", []).length, optedIn);
  assert.equal(out.digest.messages, optedIn);
});

test("tool schemas are ready for Claude", () => {
  const t = claudeTools("companion");
  assert.ok(t.every((x) => x.name && x.description && x.input_schema.type === "object"));
});
