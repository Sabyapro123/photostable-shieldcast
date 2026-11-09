// ShieldCast Claude proxy for the pilot, as a Cloudflare Worker.
// The site calls this Worker instead of api.anthropic.com, so no API key sits in any browser.
// Deploy:  npx wrangler deploy   then   npx wrangler secret put ANTHROPIC_API_KEY
// Then paste the Worker URL into "Proxy URL" in the site's Claude settings.

const ALLOWED_ORIGINS = ["https://sabyapro123.github.io", "http://localhost:8000"];
const ALLOWED_MODELS = ["claude-sonnet-5-5", "claude-haiku-5-5"];
const MAX_TOKENS = 900;
const ALLOWED_TOOLS = new Set(["get_uv_forecast", "build_shield_plan", "todays_protection", "set_day_routine", "tube_status", "find_stock", "reserve_refill", "log_feedback_for_doctor", "escalate_to_care_desk"]);

function cors(origin) {
  return { "access-control-allow-origin": origin, "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type, anthropic-version", "access-control-max-age": "86400", vary: "origin" };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("origin") || "";
    if (!ALLOWED_ORIGINS.includes(origin)) return new Response("Origin not allowed", { status: 403 });
    if (request.method === "OPTIONS") return new Response(null, { headers: cors(origin) });
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/v1/messages") return new Response("Not found", { status: 404, headers: cors(origin) });

    // A simple per-IP limit using the optional KV namespace RATE (60 calls an hour).
    if (env.RATE) {
      const ip = request.headers.get("cf-connecting-ip") || "anon", key = `r:${ip}:${new Date().toISOString().slice(0, 13)}`;
      const n = Number((await env.RATE.get(key)) || 0);
      if (n >= 60) return new Response("Too many requests", { status: 429, headers: cors(origin) });
      await env.RATE.put(key, String(n + 1), { expirationTtl: 3700 });
    }

    let body;
    try { body = await request.json(); } catch (e) { return new Response("Bad JSON", { status: 400, headers: cors(origin) }); }
    // Only the ShieldCast agents can use this proxy: fixed models, a token cap and the known tool names.
    if (!ALLOWED_MODELS.includes(body.model)) body.model = ALLOWED_MODELS[0];
    body.max_tokens = Math.min(Number(body.max_tokens) || MAX_TOKENS, MAX_TOKENS);
    if (!Array.isArray(body.tools) || body.tools.some((t) => !ALLOWED_TOOLS.has(t.name))) return new Response("Unknown tools", { status: 400, headers: cors(origin) });
    delete body.stream;

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(body),
    });
    return new Response(r.body, { status: r.status, headers: { ...cors(origin), "content-type": "application/json" } });
  },
};
