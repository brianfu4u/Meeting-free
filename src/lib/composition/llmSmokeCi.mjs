/**
 * Clinic OS V10 — LLM Smoke CI 运行器（加固版）
 *
 * 职责：仅作为已鉴权触发器——携带 X-CI-Smoke-Key + 网关 Bearer token，
 * POST 空体到 llmSmokeService。真实 smoke 逻辑（ASSEMBLY_JSON_SCHEMA、prompt 构造）
 * 全部由服务端 runAssemblySmoke 执行，CI 不再构造/转发 prompt。
 *
 * 环境变量（GitHub Secrets，不得作 workflow input）：
 * - LLM_SMOKE_ENDPOINT：llmSmokeService 函数 URL
 * - BASE44_TOKEN：Base44 网关鉴权 token
 * - LLM_SMOKE_KEY：与函数 Deno.env.LLM_SMOKE_KEY 一致的专用密钥
 */
const endpoint = process.env.LLM_SMOKE_ENDPOINT;
const token = process.env.BASE44_TOKEN;
const smokeKey = process.env.LLM_SMOKE_KEY;

if (!endpoint || !token || !smokeKey) {
  console.error("llmSmokeCi: LLM_SMOKE_ENDPOINT / BASE44_TOKEN / LLM_SMOKE_KEY 必填（GitHub Secrets）");
  process.exit(2);
}

const res = await fetch(endpoint, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
    "X-CI-Smoke-Key": smokeKey,
  },
  body: "{}",
});

const text = await res.text();
let body;
try { body = JSON.parse(text); } catch { body = { raw: text }; }
console.log("HTTP", res.status);
console.log(JSON.stringify(body, null, 2));

if (!res.ok || !body?.ok) process.exit(1);