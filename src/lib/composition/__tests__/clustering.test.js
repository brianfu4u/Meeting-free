import { describe, it, expect } from "vitest";
import { clusterFactCards, clusterByBusinessLine } from "../clustering";

const cards = [
  { id: "f1", artifact_id: "a1", _resolvedSessionId: "sess-1", _linkMethod: "explicit_id" },
  { id: "f2", artifact_id: "a2", _resolvedSessionId: "sess-1", _linkMethod: "spatiotemporal" },
  { id: "f3", artifact_id: "a3", _resolvedSessionId: "sess-2", _linkMethod: "llm" },
  { id: "f4", artifact_id: "a4" }, // unlinked
];

describe("clustering — clusterFactCards", () => {
  it("同 session 归为同一列车", () => {
    const { trains } = clusterFactCards(cards);
    const t1 = trains.find((t) => t.session_id === "sess-1");
    expect(t1.fact_card_ids).toEqual(["f1", "f2"]);
    expect(t1.artifact_ids).toEqual(["a1", "a2"]);
    expect(t1.methods).toEqual(expect.arrayContaining(["explicit_id", "spatiotemporal"]));
  });
  it("未匹配车厢进入 unlinked", () => {
    const { unlinked } = clusterFactCards(cards);
    expect(unlinked).toHaveLength(1);
    expect(unlinked[0]).toMatchObject({ fact_card_id: "f4", artifact_id: "a4" });
  });
  it("空输入返回空结构", () => {
    expect(clusterFactCards([])).toEqual({ trains: [], unlinked: [] });
    expect(clusterFactCards(null)).toEqual({ trains: [], unlinked: [] });
  });
});

describe("clustering — clusterByBusinessLine", () => {
  it("按业务线分桶", () => {
    const sessions = [
      { id: "sess-1", business_line: "optometry" },
      { id: "sess-2", business_line: "medical" },
    ];
    const { trainsByLine, unlinked } = clusterByBusinessLine(cards, sessions);
    const opto = trainsByLine.find((b) => b.business_line === "optometry");
    const med = trainsByLine.find((b) => b.business_line === "medical");
    expect(opto.trains).toHaveLength(1);
    expect(med.trains).toHaveLength(1);
    expect(unlinked).toHaveLength(1);
  });
});