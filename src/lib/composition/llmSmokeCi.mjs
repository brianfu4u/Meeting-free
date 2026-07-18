/**
 * Clinic OS V10 — LLM Smoke CI 运行器（workflow_dispatch 手动触发）
 *
 * 必须继续导入实际 ASSEMBLY_JSON_SCHEMA（由 runAssemblySmoke 内部导入，禁止手工复制）。
 * invokeLLM 通过 BASE44_ENDPOINT + BASE44_TOKEN 调用真实 LLM；无有效凭证时失败。
 *
 * 运行：node src/lib/composition/llmSmokeCi.mjs
 */
import { runAssemblySmoke } from "./assemblySmoke.mjs";

const invokeLLM = async ({ prompt, response_json_schema, model }) => {
  const endpoint = process.env.BASE44_ENDPOINT;
  const token = process.env.BASE44_TOKEN;
  if (!endpoint || !token) {
    throw new Error("llmSmokeCi: BASE44_ENDPOINT 与 BASE44_TOKEN 必填（指向可执行 InvokeLLM 的 Base44 运行时）");
  }
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ prompt, response_json_schema, model }),
  });
  if (!res.ok) {
    throw new Error(`llmSmokeCi: LLM 端点返回 ${res.status}: ${await res.text()}`);
  }
  return res.json();
};

const r = await runAssemblySmoke({ invokeLLM });
console.log(JSON.stringify(r, null, 2));
if (!r.ok) process.exit(1);