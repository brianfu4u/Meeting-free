import { createClientFromRequest } from "npm:@base44/sdk@0.8.38";

/**
 * Clinic OS V10 — LLM Smoke 服务（CI 专用 InvokeLLM 代理）
 *
 * 不调用 auth.me()：CI 无用户会话，依赖 asServiceRole（服务端凭证）直接调用 InvokeLLM，
 * 使 GitHub Actions LLM Smoke 可在无用户 token 的情况下运行真实 LLM schema 校验。
 *
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));

    const res = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: body.prompt,
      response_json_schema: body.response_json_schema,
      model: body.model || "automatic",
    });
    return Response.json(res);
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message || e) }, { status: 500 });
  }
});