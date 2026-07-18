import { describe, it, expect, vi } from "vitest";
import { deterministicCandidates, resolveSessionLink } from "../candidateFinder";

const baseSessions = [
  {
    id: "sess-1",
    patient_name: "张三",
    current_node: "验光开始",
    arrival_time: "2026-07-18T09:00:00Z",
    node_scan_timestamps: { seated: "2026-07-18T09:05:00Z", 验光叫号: "2026-07-18T09:20:00Z" },
  },
  {
    id: "sess-2",
    patient_name: "李四",
    current_node: "配镜跟进",
    arrival_time: "2026-07-18T10:30:00Z",
    node_scan_timestamps: {},
  },
];

describe("candidateFinder — 明确ID匹配", () => {
  it("artifact 带 source_session_id 命中 explicit_id 并终止", () => {
    const artifact = {
      id: "a1",
      clinic_id: "c1",
      file_url: "u",
      source_session_id: "sess-1",
      captured_at: "2026-07-18T08:00:00Z", // 远超窗口，但因明确ID应忽略
    };
    const cands = deterministicCandidates({ artifact, sessions: baseSessions });
    expect(cands).toHaveLength(1);
    expect(cands[0].method).toBe("explicit_id");
    expect(cands[0].score).toBe(1.0);
  });
  it("factCard session_id 命中 explicit_id", () => {
    const factCard = { id: "f1", artifact_id: "a1", session_id: "sess-2", extracted_at: "2026-07-18T10:00:00Z" };
    const cands = deterministicCandidates({ factCard, sessions: baseSessions });
    expect(cands[0]).toMatchObject({ session_id: "sess-2", method: "explicit_id" });
  });
});

describe("candidateFinder — 时空匹配", () => {
  it("captured_at 在窗口内命中 spatiotemporal", () => {
    const artifact = {
      id: "a2",
      clinic_id: "c1",
      file_url: "u",
      captured_at: "2026-07-18T09:25:00Z", // 验光叫号 09:20 ±5min
      source_region: "optometry",
    };
    const cands = deterministicCandidates({ artifact, sessions: baseSessions });
    expect(cands.some((c) => c.session_id === "sess-1" && c.method === "spatiotemporal")).toBe(true);
  });
  it("超出窗口无命中返回空", () => {
    const artifact = {
      id: "a3",
      clinic_id: "c1",
      file_url: "u",
      captured_at: "2026-07-18T13:00:00Z",
      source_region: "optometry",
    };
    const cands = deterministicCandidates({ artifact, sessions: baseSessions });
    expect(cands).toHaveLength(0);
  });
  it("仅 arrival_time 也可作为时空锚点", () => {
    const artifact = {
      id: "a4",
      clinic_id: "c1",
      file_url: "u",
      captured_at: "2026-07-18T10:35:00Z", // sess-2 arrival 10:30
    };
    const cands = deterministicCandidates({ artifact, sessions: baseSessions });
    expect(cands.some((c) => c.session_id === "sess-2")).toBe(true);
  });
});

describe("candidateFinder — resolveSessionLink 编排", () => {
  it("确定性命中不触发 LLM", async () => {
    const artifact = { id: "a5", clinic_id: "c1", file_url: "u", source_session_id: "sess-1" };
    const invokeLLM = vi.fn();
    const res = await resolveSessionLink({ artifact, sessions: baseSessions, invokeLLM });
    expect(res.linkedSessionId).toBe("sess-1");
    expect(res.method).toBe("explicit_id");
    expect(invokeLLM).not.toHaveBeenCalled();
  });
  it("无确定性命中且无 invokeLLM → unlinked + 需店长复核", async () => {
    const artifact = { id: "a6", clinic_id: "c1", file_url: "u", captured_at: "2026-07-18T23:00:00Z" };
    const res = await resolveSessionLink({ artifact, sessions: baseSessions });
    expect(res.linkedSessionId).toBeNull();
    expect(res.method).toBe("unlinked");
    expect(res.needsManagerReview).toBe(true);
  });
  it("LLM 命中高置信 → linked", async () => {
    const factCard = { id: "f2", artifact_id: "a7", fields: [{ field_name: "x", value: "y" }], extracted_at: "2026-07-18T23:00:00Z" };
    const invokeLLM = vi.fn(async () => ({ best_session_id: "sess-1", confidence: 0.8, reason_codes: ["姓名匹配"] }));
    const res = await resolveSessionLink({ factCard, sessions: baseSessions, invokeLLM });
    expect(res.linkedSessionId).toBe("sess-1");
    expect(res.method).toBe("llm");
    expect(res.needsManagerReview).toBe(false);
  });
  it("LLM 低置信 → unlinked + 复核", async () => {
    const factCard = { id: "f3", artifact_id: "a8", fields: [], extracted_at: "2026-07-18T23:00:00Z" };
    const invokeLLM = vi.fn(async () => ({ best_session_id: "sess-1", confidence: 0.3 }));
    const res = await resolveSessionLink({ factCard, sessions: baseSessions, invokeLLM });
    expect(res.method).toBe("unlinked");
    expect(res.needsManagerReview).toBe(true);
  });
});