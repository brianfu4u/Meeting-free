export function normalizeExamText(rawText: unknown): string {
  return String(rawText || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\u00A0]+/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function textLines(rawText: unknown): string[] {
  return normalizeExamText(rawText)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function firstMeaningfulLine(rawText: unknown): string | null {
  return textLines(rawText).find((line) => line.length >= 3) || null;
}

function pad2(value: string | number) {
  return String(value).padStart(2, "0");
}

export function extractMeasuredAt(rawText: unknown, hint?: unknown): string | null {
  const text = normalizeExamText(rawText);
  const patterns = [
    /(20\d{2})[\/.\-年](\d{1,2})[\/.\-月](\d{1,2})日?(?:\s+|T)?(\d{1,2})?(?::|時)?(\d{1,2})?(?::|分)?(\d{1,2})?/,
    /(\d{1,2})[\/.\-](\d{1,2})[\/.\-](20\d{2})(?:\s+|T)?(\d{1,2})?(?::)?(\d{1,2})?(?::)?(\d{1,2})?/,
  ];
  for (let i = 0; i < patterns.length; i += 1) {
    const match = text.match(patterns[i]);
    if (!match) continue;
    let year: string;
    let month: string;
    let day: string;
    let hour: string | undefined;
    let minute: string | undefined;
    let second: string | undefined;
    if (i === 0) {
      [, year, month, day, hour, minute, second] = match;
    } else {
      const [, m, d, y, h, min, sec] = match;
      year = y; month = m; day = d; hour = h; minute = min; second = sec;
    }
    const date = `${year}-${pad2(month)}-${pad2(day)}`;
    if (!hour) return `${date}T00:00:00`;
    return `${date}T${pad2(hour)}:${pad2(minute || 0)}:${pad2(second || 0)}`;
  }
  if (typeof hint === "string" && hint.trim()) return hint.trim().slice(0, 64);
  return null;
}

export function detectVendorModel(rawText: unknown, vendorHint?: unknown, modelHint?: unknown) {
  const text = normalizeExamText(rawText);
  const upper = text.toUpperCase();
  let vendor = typeof vendorHint === "string" && vendorHint.trim() ? vendorHint.trim() : null;
  if (!vendor) {
    if (/\bTOPCON\b/.test(upper)) vendor = "TOPCON";
    else if (/\bZEISS\b|CARL ZEISS/.test(upper)) vendor = "ZEISS";
    else if (/\bNIDEK\b/.test(upper)) vendor = "NIDEK";
    else if (/\bTOMEY\b/.test(upper)) vendor = "TOMEY";
    else if (/\bHEIDELBERG\b/.test(upper)) vendor = "HEIDELBERG ENGINEERING";
    else if (/\bCANON\b/.test(upper)) vendor = "CANON";
    else if (/\bKOWA\b/.test(upper)) vendor = "KOWA";
  }

  let model = typeof modelHint === "string" && modelHint.trim() ? modelHint.trim() : null;
  if (!model) {
    const candidates = [
      /\b(CIRRUS(?:\s+HD[- ]?OCT)?\s*\d{0,4})\b/i,
      /\b(KR[- ]?\d{3,4})\b/i,
      /\b(TRK[- ]?\d{1,4}P?)\b/i,
      /\b(CT[- ]?\d{2,4}P?)\b/i,
      /\b(SP[- ]?\d{3,4})\b/i,
      /\b(RS[- ]?\d{3,4})\b/i,
      /\b(3D OCT[- ]?\d{3,4})\b/i,
    ];
    for (const pattern of candidates) {
      const match = text.match(pattern);
      if (match) { model = match[1].replace(/\s+/g, " ").trim(); break; }
    }
  }
  return { device_vendor: vendor, device_model: model };
}

export function splitEyeSections(rawText: unknown) {
  const lines = textLines(rawText);
  const right: string[] = [];
  const left: string[] = [];
  let current: "right" | "left" | null = null;
  for (const line of lines) {
    const isRight = /^(?:OD|R|RIGHT|右眼|右)\b[\s:：-]*/i.test(line) || /\b(?:OD|RIGHT EYE|右眼)\b/i.test(line);
    const isLeft = /^(?:OS|L|LEFT|左眼|左)\b[\s:：-]*/i.test(line) || /\b(?:OS|LEFT EYE|左眼)\b/i.test(line);
    if (isRight && !isLeft) current = "right";
    else if (isLeft && !isRight) current = "left";
    else if (isRight && isLeft) current = null;

    if (current === "right") right.push(line);
    if (current === "left") left.push(line);
  }

  if (right.length === 0 || left.length === 0) {
    const text = normalizeExamText(rawText);
    const inlineRight = text.match(/(?:^|\s)(?:OD|R|RIGHT|右眼)\s*[:：-]?\s*([^\n]+?)(?=(?:\s+(?:OS|L|LEFT|左眼)\s*[:：-])|$)/i);
    const inlineLeft = text.match(/(?:^|\s)(?:OS|L|LEFT|左眼)\s*[:：-]?\s*([^\n]+?)(?=(?:\s+(?:OD|R|RIGHT|右眼)\s*[:：-])|$)/i);
    if (right.length === 0 && inlineRight) right.push(inlineRight[0].trim());
    if (left.length === 0 && inlineLeft) left.push(inlineLeft[0].trim());
  }

  return { right: right.join("\n"), left: left.join("\n") };
}

export function numbersWithUnit(rawText: unknown, unitPattern: RegExp): number[] {
  const text = normalizeExamText(rawText);
  const flags = unitPattern.flags.includes("g") ? unitPattern.flags : `${unitPattern.flags}g`;
  const pattern = new RegExp(unitPattern.source, flags);
  const values: number[] = [];
  for (const match of text.matchAll(pattern)) {
    const value = Number(match[1]);
    if (Number.isFinite(value)) values.push(value);
  }
  return values;
}

export function firstLabeledNumber(rawText: unknown, labels: string[], suffix = "") {
  const text = normalizeExamText(rawText);
  for (const label of labels) {
    const pattern = new RegExp(`(?:${label})\\s*[:=：]?\\s*([+-]?\\d+(?:\\.\\d+)?)\\s*${suffix}`, "i");
    const match = text.match(pattern);
    if (match) {
      const value = Number(match[1]);
      if (Number.isFinite(value)) return value;
    }
  }
  return null;
}

export function parseRefractionValues(rawText: unknown) {
  const text = normalizeExamText(rawText);
  const sphere = firstLabeledNumber(text, ["SPH", "SPHERE", "S"]);
  const cylinder = firstLabeledNumber(text, ["CYL", "CYLINDER", "C"]);
  const axis = firstLabeledNumber(text, ["AX", "AXIS", "A"], "(?:DEG|°)?");
  const sphericalEquivalent = firstLabeledNumber(text, ["SE", "S\.E\."]);
  return {
    ...(sphere != null ? { sphere_d: sphere } : {}),
    ...(cylinder != null ? { cylinder_d: cylinder } : {}),
    ...(axis != null ? { axis_deg: axis } : {}),
    ...(sphericalEquivalent != null ? { spherical_equivalent_d: sphericalEquivalent } : {}),
  };
}

export function countKeys(value: unknown): number {
  return value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value).length : 0;
}

export function isLikelyEyeExamReport(rawText: unknown, context: Record<string, unknown> = {}) {
  const text = normalizeExamText(rawText);
  const category = String(context.category_label || context.exam_hint || context.source_filename || "");
  const eyeSignal = /(眼科|眼压|验光|屈光|眼底|视网膜|角膜|内皮|超声|OCT|CIRRUS|TOPCON|NIDEK|ZEISS|TONO|FUNDUS|RETINA|CORNEA|OPHTHAL|OPTOM|\bIOP\b|MMHG)/i.test(`${text}\n${category}`);
  const reportSignal = /(报告|检查|DATA|REPORT|SCAN|PHOTO|REF|KERATO|MACULAR|RNFL|B[- ]?SCAN|A\/B|OD\b|OS\b|右眼|左眼)/i.test(`${text}\n${category}`);
  return eyeSignal && reportSignal;
}
