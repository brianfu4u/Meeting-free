/**
 * Clinic OS V10 — LLM Smoke CI 运行器（后端内部 smoke，GitHub 仅触发+查询结果）
 *
 * Base44 不提供适用于 GitHub Actions 的官方服务凭证/PAT（工作区 API Key 仅限监控/审计，
 * 不能用于函数调用）。后端函数为公开 HTTP 端点，内部用 asServiceRole 调用 InvokeLLM，
 * 唯一鉴权为函数内自定义共享密钥（X-CI-Smoke-Key === Deno.env.LLM_SMOKE_KEY）。
 *
 * 因此 GitHub Actions 仅作为触发器：用 LLM_SMOKE_KEY 调用 llmSmokeService 并读取结果，
 * 不再需要任何 Bearer token。函数 endpoint 为公开 URL，内置默认值，可经 secret 覆盖。
 *
 * 环境变量（GitHub Secrets）：
 * - LLM_SMOKE_KEY：与函数 Deno.env.LLM_SMOKE_KEY 一致的共享密钥（必填）
 * - LLM_SMOKE_ENDPOINT（可选）：覆盖默认函数 endpoint URL
 */
import { runAssemblySmoke } from "./assemblySmoke.mjs";

const DEFAULT_ENDPOINT = "https://base44.app/api/apps/6a40a384e32bc30acde13c1d/functions/llmSmokeService";
const endpoint = process.env.LLM_SMOKE_ENDPOINT || DEFAULT_ENDPOINT;
const smokeKey = process.env.LLM_SMOKE_KEY;

if (!smokeKey) {
  console.error("llmSmokeCi: LLM_SMOKE_KEY 必填（GitHub Secret）");
  process.exit(2);
}

const invokeLLM = async ({ prompt, response_json_schema }) => {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CI-Smoke-Key": smokeKey,
    },
    body: JSON.stringify({ prompt, response_json_schema }),
  });
  if (!res.ok) {
    throw new Error(`llmSmokeCi: 函数返回 ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return res.json();
};

const r = await runAssemblySmoke({ invokeLLM });
console.log(JSON.stringify(r, null, 2));
if (!r.ok) process.exit(1);