/**
 * Clinic OS V10 — LLM Smoke CI 运行器（加固版）
 *
 * 真实 ASSEMBLY_JSON_SCHEMA 与 prompt 由 src/lib/composition 单一来源持有（runAssemblySmoke
 * 内部导入，禁止手工复制）。本运行器仅作为已鉴权触发器：通过 llmSmokeService 加固代理
 * 调用 InvokeLLM，携带 X-CI-Smoke-Key + 网关 Bearer token。
 *
 * 环境变量（GitHub Secrets，不得作 workflow input）：
 * - LLM_SMOKE_ENDPOINT：llmSmokeService 函数 URL
 * - BASE44_TOKEN：Base44 网关鉴权 token
 * - LLM_SMOKE_KEY：与函数 Deno.env.LLM_SMOKE_KEY 一致的专用密钥
 */
import { runAssemblySmoke } from "./assemblySmoke.mjs";

const endpoint = process.env.LLM_SMOKE_ENDPOINT;
const token = process.env.BASE44_TOKEN;
const smokeKey = process.env.LLM_SMOKE_KEY;

if (!endpoint || !token || !smokeKey) {
  console.error("llmSmokeCi: LLM_SMOKE_ENDPOINT / BASE44_TOKEN / LLM_SMOKE_KEY 必填（GitHub Secrets）");
  process.exit(2);
}

const invokeLLM = async ({ prompt, response_json_schema, model }) => {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-CI-Smoke-Key": smokeKey,
    },
    body: JSON.stringify({ prompt, response_json_schema, model }),
  });
  if (!res.ok) {
    throw new Error(`llmSmokeCi: LLM 端点返回 ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return res.json();
};

const r = await runAssemblySmoke({ invokeLLM });
console.log(JSON.stringify(r, null, 2));
if (!r.ok) process.exit(1);