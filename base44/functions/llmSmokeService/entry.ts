import { createClientFromRequest } from "npm:@base44/sdk@0.8.38";
import { runAssemblySmoke } from "../../../src/lib/composition/assemblySmoke.mjs";

/**
 * Clinic OS V10 — LLM Smoke 服务（CI 专用，已加固）
 *
 * 安全约束（R4）：
 * - 密钥校验：必须携带 X-CI-Smoke-Key 头且等于 Deno.env.LLM_SMOKE_KEY，否则 401/503；
 * - 限流：进程内每分钟 6 次（best-effort）；
 * - 固定 smoke：服务端导入 runAssemblySmoke（内含真实 ASSEMBLY_JSON_SCHEMA），
 *   不接受客户端任意 prompt / response_json_schema 直接转发；
 * - 固定模型：runAssemblySmoke 内部使用 "automatic"；
 * - 仅 POST，非 405。
 *
 * CI 调用方只需携带密钥头 + 网关 Bearer token，POST 空 body 即可。
 */
const SMOKE_KEY = Deno.env.get("LLM_SMOKE_KEY");
const MAX_CALLS_PER_MIN = 6;
let _windowStart = Date.now();
let _count = 0;
function allowRate(): boolean {
  const now = Date.now();
  if (now - _windowStart > 60_000) {
    _windowStart = now;
    _count = 0;
  }
  _count++;
  return _count <= MAX_CALLS_PER_MIN;
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return Response.json({ error: "method not allowed" }, { status: 405 });
    }
    if (!SMOKE_KEY) {
      return Response.json({ error: "smoke key not configured (LLM_SMOKE_KEY)" }, { status: 503 });
    }
    const provided = req.headers.get("x-ci-smoke-key");
    if (!provided || provided !== SMOKE_KEY) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    if (!allowRate()) {
      return Response.json({ error: "rate limited" }, { status: 429 });
    }

    const base44 = createClientFromRequest(req);
    const invokeLLM = (args: any) => base44.asServiceRole.integrations.Core.InvokeLLM(args);
    const result = await runAssemblySmoke({ invokeLLM });
    return Response.json(result, { status: result.ok ? 200 : 500 });
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message || e) }, { status: 500 });
  }
});