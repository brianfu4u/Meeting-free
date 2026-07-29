# Direction A Bridge Test Plan

Automated coverage added in `src/lib/bridge/__tests__`:

1. Repeated `EvidenceItem` conversion is idempotent: exactly one Artifact, one FragmentProcessingResult and one EvidenceFactCard.
2. First failure: sanitized AuditLog only; no AttentionItem.
3. Second failure: sanitized AuditLog only; no AttentionItem.
4. Third failure: one deduplicated `evidence_missing` AttentionItem.
5. Generated aligned FactCard satisfies the existing scheduled scan pickup contract.
6. Critical composition runtime blobs are pinned to the `main@c183c2b7` baseline, proving this PR does not alter seven-track reasoning, candidate ranking, Guardrail or Workflow Assembly runtime files.

Validation commands used by repository CI:

```bash
npm ci
npx vitest run
npm run build
```
