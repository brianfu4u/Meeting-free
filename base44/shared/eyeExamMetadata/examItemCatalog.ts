export const EYE_EXAM_ITEM_CANDIDATES = Object.freeze([
  {
    id: "tono",
    label: "眼压检查（Tono）",
    exam_type: "眼压检查",
    aliases: ["TONO", "IOP", "眼压", "MMHG"],
  },
  {
    id: "refraction",
    label: "屈光/验光",
    exam_type: "屈光验光",
    aliases: ["REF", "REFRACTION", "SPH", "CYL", "验光", "屈光"],
  },
  {
    id: "macular_oct",
    label: "黄斑 OCT",
    exam_type: "OCT",
    aliases: ["MACULAR", "MACULA", "黄斑", "CENTRAL SUBFIELD"],
  },
  {
    id: "optic_nerve_oct",
    label: "视神经 OCT",
    exam_type: "OCT",
    aliases: ["OPTIC DISC", "OPTIC NERVE", "RNFL", "视神经", "神经纤维层"],
  },
  {
    id: "fundus_photo",
    label: "眼底照相",
    exam_type: "眼底照相",
    aliases: ["FUNDUS", "RETINA PHOTO", "眼底照相", "眼底摄影"],
  },
  {
    id: "corneal_endothelium",
    label: "角膜内皮细胞检查",
    exam_type: "角膜内皮细胞检查",
    aliases: ["ENDOTHEL", "CELL DENSITY", "CCT", "HEX", "角膜内皮"],
  },
  {
    id: "ocular_ultrasound",
    label: "眼科 A/B 超声",
    exam_type: "眼科超声",
    aliases: ["A/B SCAN", "A-SCAN", "B-SCAN", "ULTRASOUND", "眼科超声"],
  },
  {
    id: "other_eye_exam",
    label: "其他眼科检查",
    exam_type: "其他眼科检查",
    aliases: [],
    requires_note: true,
  },
]);

export function getEyeExamItemCandidates() {
  return EYE_EXAM_ITEM_CANDIDATES.map(({ id, label, exam_type, requires_note = false }) => ({
    id,
    label,
    exam_type,
    requires_note,
  }));
}

export function getEyeExamItemCandidate(tag: unknown) {
  const normalized = String(tag || "").trim();
  return EYE_EXAM_ITEM_CANDIDATES.find((candidate) => candidate.id === normalized) || null;
}

export function inferEyeExamItemTag(metadata: Record<string, any> = {}) {
  const haystack = [
    metadata.exam_type,
    metadata.exam_item_name,
    metadata.template_id,
    metadata.parser_id,
  ].filter(Boolean).join(" ").toUpperCase();

  if (/OCT/.test(haystack)) {
    if (/(OPTIC DISC|OPTIC NERVE|RNFL|视神经|神经纤维层)/i.test(haystack)) return "optic_nerve_oct";
    if (/(MACULAR|MACULA|黄斑|CENTRAL SUBFIELD)/i.test(haystack)) return "macular_oct";
  }

  for (const candidate of EYE_EXAM_ITEM_CANDIDATES) {
    if (candidate.id === "other_eye_exam") continue;
    if (candidate.aliases.some((alias) => haystack.includes(alias.toUpperCase()))) return candidate.id;
    if (candidate.exam_type && haystack.includes(candidate.exam_type.toUpperCase())) return candidate.id;
  }
  return "other_eye_exam";
}

export function validateEyeExamItemConfirmation(tag: unknown, note?: unknown) {
  const candidate = getEyeExamItemCandidate(tag);
  if (!candidate) return { ok: false, error_code: "eye_exam_item_tag_invalid" };
  const cleanNote = typeof note === "string" ? note.trim().slice(0, 240) : "";
  if (candidate.requires_note && cleanNote.length < 2) {
    return { ok: false, error_code: "eye_exam_item_other_note_required" };
  }
  return {
    ok: true,
    candidate,
    note: cleanNote || null,
  };
}
