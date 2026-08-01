import { normalizeExamText, textLines } from "./common.ts";

export const OCR_QUALITY_POOR_THRESHOLD = 45;
export const OCR_QUALITY_GOOD_THRESHOLD = 70;
export const LOW_QUALITY_REUPLOAD_CODE = "eye_exam_upload_needs_reupload_due_to_low_quality";

const RECOGNIZABLE_CHAR = /[A-Za-z0-9\u3400-\u9FFF\u3040-\u30FF\uAC00-\uD7AF.,:;()\[\]{}<>+\-_=/%°μµ]/;
const GARBLE_CHAR = /[\uFFFD�□■◆◇��������]/;
const TOKEN_PATTERN = /[A-Za-z]{2,}|[\u3400-\u9FFF]{1,}|[\u3040-\u30FF]{2,}|\d+(?:\.\d+)?/g;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function normalizedConfidence(value: unknown): number | null {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const normalized = number > 1 ? number / 100 : number;
  return clamp(normalized, 0, 1);
}

function ratio(count: number, total: number) {
  return total > 0 ? count / total : 0;
}

export type OcrQualityFlag = "good" | "borderline" | "poor";

export type OcrQualityAssessment = {
  score: number;
  flag: OcrQualityFlag;
  reasons: string[];
  metrics: {
    extracted_character_count: number;
    non_empty_line_count: number;
    informative_line_count: number;
    recognizable_character_ratio: number;
    garble_character_ratio: number;
    unique_token_count: number;
    provider_confidence: number | null;
  };
};

/**
 * Deterministic OCR quality gate for eye-exam uploads.
 *
 * The score combines text coverage, line structure, recognizable-character
 * ratio, token diversity and optional OCR-provider confidence. A score below
 * 45 is considered poor. The 45 threshold is intentionally conservative:
 * short but valid receipts such as a five-line Tono slip normally score above
 * 70, while one-line crops, mostly garbled text, or very low OCR confidence are
 * blocked before detailed eye-exam parsing.
 */
export function assessEyeExamOcrQuality(rawText: unknown, options: Record<string, unknown> = {}): OcrQualityAssessment {
  const text = normalizeExamText(rawText);
  const lines = textLines(text);
  const compactChars = [...text.replace(/\s/g, "")];
  const recognizableCount = compactChars.filter((char) => RECOGNIZABLE_CHAR.test(char)).length;
  const garbleCount = compactChars.filter((char) => GARBLE_CHAR.test(char)).length;
  const informativeLines = lines.filter((line) => {
    const chars = [...line.replace(/\s/g, "")];
    return chars.filter((char) => RECOGNIZABLE_CHAR.test(char)).length >= 3;
  });
  const tokens = text.match(TOKEN_PATTERN) || [];
  const uniqueTokens = new Set(tokens.map((token) => token.toUpperCase()));
  const providerConfidence = normalizedConfidence(
    options.provider_confidence
      ?? options.ocr_confidence
      ?? options.average_confidence
      ?? options.confidence,
  );

  const recognizableRatio = ratio(recognizableCount, compactChars.length);
  const garbleRatio = ratio(garbleCount, compactChars.length);
  const repeatedRuns = text.match(/(.)\1{5,}/g) || [];
  const punctuationCount = compactChars.filter((char) => /[^A-Za-z0-9\u3400-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/.test(char)).length;
  const punctuationRatio = ratio(punctuationCount, compactChars.length);

  let score = 0;
  score += Math.min(20, (compactChars.length / 80) * 20);
  score += Math.min(20, (informativeLines.length / 5) * 20);
  score += clamp((recognizableRatio - 0.3) / 0.65, 0, 1) * 25;
  score += Math.min(15, (uniqueTokens.size / 10) * 15);
  score += providerConfidence == null ? 14 : providerConfidence * 20;

  if (repeatedRuns.length > 0) score -= Math.min(20, repeatedRuns.length * 10);
  if (garbleRatio > 0.05) score -= Math.min(25, garbleRatio * 100);
  if (punctuationRatio > 0.55) score -= 10;

  const reasons: string[] = [];
  if (compactChars.length < 16) reasons.push("ocr_text_too_short");
  if (informativeLines.length < 2) reasons.push("ocr_too_few_informative_lines");
  if (recognizableRatio < 0.45) reasons.push("ocr_low_recognizable_character_ratio");
  if (garbleRatio > 0.18) reasons.push("ocr_excessive_garbled_characters");
  if (repeatedRuns.length >= 2) reasons.push("ocr_excessive_repeated_characters");
  if (providerConfidence != null && providerConfidence < 0.35) reasons.push("ocr_provider_confidence_too_low");
  if (punctuationRatio > 0.7) reasons.push("ocr_punctuation_dominates_text");

  const roundedScore = Math.round(clamp(score, 0, 100));
  const hardPoor = reasons.length > 0;
  const flag: OcrQualityFlag = hardPoor || roundedScore < OCR_QUALITY_POOR_THRESHOLD
    ? "poor"
    : roundedScore < OCR_QUALITY_GOOD_THRESHOLD
      ? "borderline"
      : "good";

  if (flag === "borderline" && reasons.length === 0) reasons.push("ocr_quality_borderline");

  return {
    score: roundedScore,
    flag,
    reasons,
    metrics: {
      extracted_character_count: compactChars.length,
      non_empty_line_count: lines.length,
      informative_line_count: informativeLines.length,
      recognizable_character_ratio: Math.round(recognizableRatio * 1000) / 1000,
      garble_character_ratio: Math.round(garbleRatio * 1000) / 1000,
      unique_token_count: uniqueTokens.size,
      provider_confidence: providerConfidence,
    },
  };
}
