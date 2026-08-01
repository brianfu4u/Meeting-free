import { describe, expect, it } from "vitest";
import { getCoreRoutingContext } from "../../composition/candidateFinder.js";

describe("routing projection precedence", () => {
  it("uses the latest specialized core projection on a shared FactCard", () => {
    const factCard = {
      clinic_id: "clinic-001",
      fields: [
        { field_name: "routing.metadata_domain", value: "ops_event" },
        { field_name: "routing.event_type", value: "other" },
        { field_name: "routing.item_tag", value: "other" },
        { field_name: "routing.basic_summary", value: "员工上传了一份附件" },
        { field_name: "routing.metadata_domain", value: "eye_exam" },
        { field_name: "routing.exam_type", value: "OCT" },
        { field_name: "routing.exam_item_name", value: "Macular Cube 512x128" },
        { field_name: "routing.item_tag", value: "macular_oct" },
        { field_name: "routing.basic_summary", value: "OCT：Macular Cube 512x128" },
      ],
    };

    expect(getCoreRoutingContext(factCard)).toMatchObject({
      metadata_domain: "eye_exam",
      exam_type: "OCT",
      exam_item_name: "Macular Cube 512x128",
      item_tag: "macular_oct",
      basic_summary: "OCT：Macular Cube 512x128",
    });
  });
});
