# Acceptance Checklist

- [x] Direction A real-time bridge only
- [x] No historical EvidenceItem backfill
- [x] `origin_evidence_item_id` propagated to Artifact, FragmentProcessingResult and EvidenceFactCard
- [x] `bridge_status`, `attempt_count`, `last_error_code` stored on EvidenceItem
- [x] Bridge failure isolated from staff report success
- [x] First two failures audit-only
- [x] Third failure creates deduplicated AttentionItem
- [x] Composition scan-pool eligibility asserted
- [x] compositionOrchestrator critical runtime files pinned unchanged
- [ ] GitHub CI full Vitest suite green
- [ ] GitHub CI production build green
