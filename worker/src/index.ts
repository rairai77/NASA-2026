import { validateToolArgs } from "./validate.ts";
import { systemPrompt, SET_QUERY_TOOL } from "./prompt.ts";

export interface Env {
  ASSETS: Fetcher;
  PARSE_MODEL: string;
  PARSE_MOCK?: string;
  OPENROUTER_API_KEY?: string;
  PARSE_LIMITER?: RateLimit;
}

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const UPSTREAM_TIMEOUT_MS = 15_000;

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "cross-origin-resource-policy": "same-origin",
      ...extra,
    },
  });
}

const err = (status: number, message: string, extra?: Record<string, string>) =>
  json({ error: message }, status, extra);

const MOCK_ARGS = {
  window: { start: "2028-06-01", end: "2028-07-01" },
  region: { type: "polar", min_lat: -90, max_lat: -85 },
  height_m: 2,
  filters: [
    { metric: "longest_both_h", op: ">=", value: 144 },
    { metric: "warp_factor", op: ">", value: 9 },
  ],
  objectives: [{ metric: "slope_deg", dir: "min" }],
  k: 50,
  min_separation_km: 2,
  unparsed: ["with a nice view"],
};

async function handleParse(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return err(405, "use POST", { allow: "POST" });

  if (env.PARSE_LIMITER) {
    const key = request.headers.get("CF-Connecting-IP") ?? "unknown";
    try {
      const { success } = await env.PARSE_LIMITER.limit({ key });
      if (!success) return err(429, "rate limit exceeded, try again in a minute", { "retry-after": "60" });
    } catch {
      // limiter failure must not take the endpoint down
    }
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return err(400, "body must be JSON");
  }
  const b = body as { text?: unknown; today?: unknown };
  if (typeof b?.text !== "string" || b.text.trim() === "") return err(400, "text is required");
  if (b.text.length > 500) return err(400, "text must be at most 500 characters");
  if (typeof b.today !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(b.today) || Number.isNaN(Date.parse(b.today))) {
    return err(400, "today must be YYYY-MM-DD");
  }

  let rawArgs: unknown;
  if (env.PARSE_MOCK === "1") {
    rawArgs = MOCK_ARGS;
  } else {
    if (!env.OPENROUTER_API_KEY) return err(502, "parser is not configured (missing API key)");
    let res: Response;
    try {
      res = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
          "http-referer": new URL(request.url).origin,
          "x-title": "Lunar Landing Site Navigator",
        },
        body: JSON.stringify({
          model: env.PARSE_MODEL,
          temperature: 0,
          max_tokens: 800,
          messages: [
            { role: "system", content: systemPrompt(b.today) },
            { role: "user", content: b.text },
          ],
          tools: [SET_QUERY_TOOL],
          tool_choice: { type: "function", function: { name: "set_query" } },
        }),
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
    } catch (e) {
      const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
      return err(502, timeout ? "parser timed out" : "parser unreachable");
    }
    if (!res.ok) return err(502, `parser upstream error (${res.status})`);
    try {
      const data = (await res.json()) as {
        choices?: { message?: { tool_calls?: { function?: { name?: string; arguments?: string } }[] } }[];
      };
      const call = data.choices?.[0]?.message?.tool_calls?.find((c) => c.function?.name === "set_query");
      if (!call?.function?.arguments) return err(502, "parser returned no tool call");
      rawArgs = JSON.parse(call.function.arguments);
    } catch {
      return err(502, "parser returned malformed output");
    }
  }

  const { query, unparsed, warnings } = validateToolArgs(rawArgs);
  return json({ query, unparsed, warnings });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") {
      return json({ ok: true, model: env.PARSE_MODEL, hasKey: Boolean(env.OPENROUTER_API_KEY) });
    }
    if (url.pathname === "/api/parse") return handleParse(request, env);
    if (url.pathname.startsWith("/api/")) return err(404, "not found");
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
