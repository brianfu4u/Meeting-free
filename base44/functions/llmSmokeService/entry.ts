import { createClientFromRequest } from "npm:@base44/sdk@0.8.38";

/**
 * Clinic OS V10 — LLM Smoke 服务（CI 专用 InvokeLLM 加固代理）
 *
 * 函数运行时不允许 import 函数目录外的文件（打包限制），因此本函数不直接运行
 * smoke 逻辑；真实 ASSEMBLY_JSON_SCHEMA 与 prompt 构造仍由 src/lib/composition
 * 单一来源持有，CI runner（llmSmokeCi.mjs）导入后通过本函数转发 InvokeLLM。
 *
 * 加固约束（R4）：
 * - 密钥校验：X-CI-Smoke-Key === Deno.env.LLM_SMOKE_KEY，否则 401/503；
 * - 限流：进程内每分钟 6 次（best-effort）；
 * - prompt 必填且 ≤ 20000 字符，否则 400/413；
 * - response_json_schema 必须为对象且 type==="object"（拒绝任意非结构化输入）；
 * - 固定 model="automatic"（忽略客户端传入的 model）；
 * - 仅 POST。
 */
const SMOKE_KEY = Deno.env.get("LLM_SMOKE_KEY");
const MAX_PROMPT_CHARS = 20000;
const MAX_CALLS_PER_MIN = 6;
let _windowStart = Date.now();
let _count = 0;
function allowRate(): boolean {
  const n = Date.now();
  if (n - _windowStart > 60_000) { _windowStart = n; _count = 0; }
  _count++;
  return _count <= MAX_CALLS_PER_MIN;
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") return Response.json({ error: "method not allowed" }, { status: 405 });
    if (!SMOKE_KEY) return Response.json({ error: "smoke key not configured (LLM_SMOKE_KEY)" }, { status: 503 });
    const provided = req.headers.get("x-ci-smoke-key");
    if (!provided || provided !== SMOKE_KEY) return Response.json({ error: "unauthorized" }, { status: 401 });
    if (!allowRate()) return Response.json({ error: "rate limited" }, { status: 429 });

    const body = await req.json().catch(() => ({}));
    const prompt = typeof body.prompt === "string" ? body.prompt : "";
    if (!prompt) return Response.json({ error: "prompt required" }, { status: 400 });
    if (prompt.length > MAX_PROMPT_CHARS) return Response.json({ error: "prompt too large" }, { status: 413 });
    const schema = body.response_json_schema;
    if (!schema || typeof schema !== "object" || schema.type !== "object") {
      return Response.json({ error: "response_json_schema must be object" }, { status: 400 });
    }

    const base44 = createClientFromRequest(req);
    const res = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt,
      response_json_schema: schema,
      model: "automatic",
    });
    return Response.json(res, { status: 200 });
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message || e) }, { status: 500 });
  }
});