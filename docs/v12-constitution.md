# Clinic OS — V12 Constitution & Remediation Roadmap

**Status:** Draft for engineering execution  
**Supersedes:** V9 (2026-07-06), V10 (2026-07-17), V11 (2026-07-24), in part — see §1  
**Date:** 2026-07-24

---

## 0. Answer to the sequencing question

**Should the undo-timing fix move earlier than “step 3” — before `new_train → provisional` — because it is cheap and stops active contamination?**

Yes, with two conditions.

Move it earlier. There is no technical dependency between the undo-timing fix and the provisional-workflow schema. They touch disjoint code: one is a scheduling predicate in `undoListService`, the other is an additive schema change on the workflow entity plus a default read scope. The coupling between them is analytic, not structural — and analytically, timing-first is strictly better, because every day the bug runs, it manufactures human-path hard-links that will pollute the labelled data you intend to tune against.

**Condition 1 — instrumentation still comes first.** If you fix timing before you instrument, you lose the before/after baseline that proves the fix worked, and you cannot measure the hard-link share drop that is the fix’s primary success signal. Instrumentation is cheap, additive, and blocks nothing. It stays at position zero.

**Condition 2 — the timing fix must ship together with the `accepted_orphan` terminal state, not before it.** This is the important correction to the naive “cheap fix first” instinct. The timing fix increases undo queue depth: items that used to be cleared mid-shift now sit until cutoff. A deeper queue with no legitimate exit raises fabrication pressure — which is precisely the failure the timing fix exists to reduce. Shipping 2a without 2b would, for several weeks, make the problem worse in exactly the dimension you care about most. They are one phase.

Net sequence: **instrument → (timing + terminal state) → provisional creation → threshold tuning**, with laterality and audit-queue work running in parallel as specified in Part 3.

---

# Part 1 — Constitutional clauses

## §1. Supersession clause

### Article V12.1 — Supersession

**Status: enforced by publication of this document.**

V12 is the sole governing constitution of Clinic OS from its adoption date. Where V12 conflicts with V9, V10, or V11 on any point, V12 governs without exception. No prior version may be cited as authority in a design review, code review, or incident post-mortem except as incorporated below.

Articles of V9, V10, and V11 fall into exactly one of three dispositions:

1. **INCORPORATED** — carried into V12 unchanged and in force.
2. **AMENDED** — carried into V12 in the modified form set out in V12 §4–§7. The original text is void.
3. **VOID** — of no further force. Void articles are not deprecated-but-tolerated; code implementing them is a defect.

No article of any prior version has force by silence. An article not listed in the disposition table below is **VOID by default**. Any article discovered later that is not in the table must be added by amendment before it may be relied on.

### V9 — disposition table

| Article | Disposition | Note |
|---|---|---|
| V9.0 Core shift — no state change without a trigger anchor | **INCORPORATED** | Remains the backbone. |
| V9.A1 Cross-Verification Anchor | **AMENDED → V12 §4** | Lock semantics narrowed; interim/final routing split. |
| V9.A2 Patient Flow-Tracking Anchor (“process violation”) | **AMENDED → V12 §5** | Reclassified as non-evaluative sequence anomaly. |
| V9.A3 Systemic/Logic Trigger Anchor | **INCORPORATED** | Time/threshold/pattern triggers unchanged. |
| V9.L1 “No trigger, no action” | **INCORPORATED** | — |
| V9.L2 “No closed loop, no persistence” | **AMENDED → V12 §7** | Direct conflict with provisional workflows and quarantine. |
| V9.L3 “No evidence, no adjudication” | **INCORPORATED** | — |
| V9.L4 “No traceability, no case closure” | **INCORPORATED** | Extended to cover `accepted_orphan` closure. |
| V9.X “Floating data is unconstitutional, discarded with alert” | **VOID → replaced by V12 §6** | Discarding violates L3 and L4. |

**Note on V9.L2.** This law was not on the original contradiction list, but it is the one that would have blocked the provisional-workflow fix outright. As written, “no closed loop, no persistence” forbids exactly what V12 requires: durable records for open, unconfirmed, and unresolvable states. It must be amended before Phase 3 can ship, or an engineer will correctly object that Phase 3 is unconstitutional. See §7.

### V10 — disposition table

| Article | Disposition | Note |
|---|---|---|
| V10.1 AI never changes clinic state | **INCORPORATED** | Promoted to the authority axis in §2. |
| V10.2 Reasoning never touches raw evidence (Evidence Normalizer) | **INCORPORATED** | Extended in Phase 4 with per-field confidence. |
| V10.3 Surface only what deserves attention | **INCORPORATED** | Governs volume, not latency. Does not authorize delay — see §2. |
| V10.4 Every recommendation explainable (`evidence_ids + event_ids + reasoning_chain`) | **INCORPORATED** | Extended: provisional workflows carry `hypothesis_id` lineage. |
| V10.5 AI recommends, humans decide (three manager actions) | **INCORPORATED** | — |
| V10.6 `AttentionItem` entity | **INCORPORATED** | Extended with new `attention_type` values; no schema break. |
| V10.7 Terminal isolation (no agent-to-agent handshakes) | **INCORPORATED** | — |
| V10.8 Three-second awareness success criterion | **INCORPORATED, reframed** | Reclassified as a latency criterion under §2. It was never an authority claim, and the confusion between the two is the root of the V11 framing error. |

### V11 — disposition table

> **Source limitation:** The repository baseline `main@2ed9d4affc91db2db4f55495082eef19a9e2e766` does not contain a V11 original source document. This table is transcribed from the V12 source supplied for this publication. See [`CLINIC_OS_V11_STATUS_INDEX.md`](./CLINIC_OS_V11_STATUS_INDEX.md). The index is not a reconstruction of the missing original.

| Article | Disposition | Note |
|---|---|---|
| V11 title & self-definition: “Operational Monitoring & Command Center”, “real-time-data-driven management” | **VOID → replaced by V12 §2** | The word *command* is the defect. |
| V11.1 Fluid Operations | **INCORPORATED** | Original text missing; unable to verify against repository source. |
| V11.2 Evidence-based (`Artifact + EvidenceFactCard` traceability) | **INCORPORATED** | Original text missing; unable to verify against repository source. |
| V11.3 Arbitration Architecture (AI detects, manager decides; AI never triggers scheduling) | **INCORPORATED** | Original text missing; unable to verify against repository source. |
| V11.4 Two-stage async protocol (`Ingestion ⟂ Composition`) | **INCORPORATED** | Original text missing; unable to verify against repository source. |
| V11.5 `needs_manager_dispatch = false` pre-review gate | **AMENDED → V12 §4** | Suspended in the interim state. Reinstated on Phase 5 exit. |
| V11.6 Data reflow — `linked_undo_artifact_id` hard link | **INCORPORATED, extended** | Soft-link handoff path added; omission from V11 was a documentation defect, not a design one. |
| V11.7 `undoListService` daily cutoff | **INCORPORATED as declared-not-enforced** | Behaviour described does not match code. Flips to enforced on Phase 2 exit. |
| V11.8 Version-comparison table listing reflow service and audit queue as “V11 (stable period)” | **VOID** | Factually false as published. Do not carry forward. |

---

## §2. Single-position clause — the latency/authority split

### Article V12.2 — What this system is

**Status: enforced as a constitutional authority boundary; latency assertions remain declared-not-enforced until Phase 6.**

Clinic OS is a **real-time witness with no operational authority**.

Two properties that prior versions conflated are hereby declared independent, and every design decision must state which of the two it concerns:

### Axis A — Authority

Who is permitted to change the state of the clinic. On this axis the system’s position is absolute and unchanging: **zero**. The system composes, ranks, proposes, blocks, and records. It does not schedule, dispatch, instruct, close, approve, or escalate. Every state change with operational consequence requires an affirmative human act. The default on this axis is deny; any proposal to widen machine authority requires an explicit constitutional amendment, not a design decision.

### Axis B — Latency

How quickly a human is able to learn something the system already knows. On this axis the system’s position is: **as fast as is useful, and no slower than the evidence permits**. Latency is a service property, not a safety control. Delay is never a substitute for restraint. The default on this axis is faster; any proposal to add delay must state the specific harm the delay prevents.

### Consequences of the split

The V9–V11 framing conflict (“quiet recorder” vs. “command center”) is dissolved, not compromised: both prior positions were correct about different axes. The system may be as real-time as V11 wished and as powerless as V9 and the design brief wished, simultaneously.

- “Quiet” describes Axis A, not Axis B. The system is quiet because it does not command, not because it withholds.
- V10.3 (“surface only what deserves attention”) governs volume, not speed. It authorizes filtering. It does not authorize sitting on a known conflict.
- An open or incomplete workflow remains a normal state, not an anomaly. Elapsed time is never an input to any judgement about a person.

### The one carve-out

A closed, enumerated list of safety-critical open loops carries a clinically-defined expected-closure window. Membership is by clinical rule and must remain small; the list is amended only by named clinical sign-off, never by engineering discretion. The window attaches to the event type, never to the staff member, and its expiry produces visibility, never evaluation and never automatic action.

Initial list at V12 adoption:

- OD/OS laterality conflict between same-day exam and prescription or procedure;
- post-intravitreal-injection follow-up;
- post-operative day-1 non-attendance;
- critical imaging or lab result unacknowledged;
- pharmacologic adverse event during or after mydriasis.

---

## §3. Status-marker taxonomy

### Article V12.3 — Article status

**Status: enforced by the publication and review requirements of this document.**

Every article of this constitution and of every future version carries exactly one status marker. An article published without a status marker is invalid and must not be relied on.

### `enforced`

The described behaviour is implemented in code and is protected by a named test, invariant, or assertion. The article must cite that artifact by name. If the artifact is deleted, disabled, or begins failing, the article automatically reverts to `declared-not-enforced` and does not silently remain enforced.

### `declared-not-enforced`

The described behaviour is intended and agreed, but is not implemented, or is implemented without protection. The article must name:

1. the enforcing artifact that will flip it to `enforced`; and
2. the phase in which that artifact lands.

An article may sit here indefinitely; that is legitimate and is the point. What is not legitimate is being here silently.

### `deprecated`

The described behaviour was in force and is being removed. Code implementing it is tolerated until the stated removal date and is a defect thereafter.

### Two binding rules

1. **No external citation of unenforced controls.** An article marked `declared-not-enforced` may not be presented as a control in any external context — regulatory submission, audit response, customer or partner documentation, investor material, or clinical governance review. A documented control that provably never executed is a materially worse liability than an undocumented gap.
2. **Resist a fourth status.** Do not add `partially-enforced`, `enforced-in-staging`, or similar. Graduated ambiguity about which controls are real is the exact defect V12 exists to close.

### Worked application — current status of every article

#### V9

| Article | Status | Enforcing artifact / gap |
|---|---|---|
| V9.0 Trigger-anchor requirement | `enforced` | Existing trigger validation in core decision engine. |
| V9.A1 Cross-verification conflict detection | `enforced` (detection) / `declared-not-enforced` (adjudication) | Detection works; blocked cards reach no consumer. Enforcing artifact: interim conflict routing. Phase 1b. |
| V9.A2 Sequence tracking | `enforced` (capture) / `deprecated` (violation semantics) | QR capture works; “violation” classification removed by §5 and Phase 6. |
| V9.A3 Systemic/logic triggers | `enforced` | Scheduled sweeps operational. |
| V9.L1 No trigger, no action | `enforced` | Existing trigger validation. |
| V9.L2 No closed loop, no persistence | `deprecated` | Removed on Phase 3 landing. See §7. |
| V9.L3 No evidence, no adjudication | `enforced` | Existing evidence lineage controls. |
| V9.L4 No traceability, no closure | `declared-not-enforced` | No terminal-state closure exists to be traced yet. Enforcing artifact: `accepted_orphan` terminal-state traceability. Phase 2b. |

#### V10

| Article | Status | Enforcing artifact / gap |
|---|---|---|
| V10.1 AI never changes clinic state | `enforced` | Manager-confirmation path. |
| V10.2 Evidence Normalizer before reasoning | `enforced` | Normalizer in ingestion layer. |
| V10.3 Attention Queue only | `enforced` | Existing Attention Queue path. |
| V10.4 Recommendation lineage | `enforced` (recommendations) / `declared-not-enforced` (workflow creation) | `new_train` hypotheses carry lineage but produce no durable record to attach it to. Enforcing artifact: provisional workflow persistence. Phase 3. |
| V10.5 Three manager actions | `enforced` | Existing manager action path. |
| V10.6 `AttentionItem` | `enforced` | Existing entity and manager surface. |
| V10.7 Terminal isolation | `enforced` | Existing terminal isolation boundary. |
| V10.8 Three-second awareness | `declared-not-enforced` | No measurement exists. Enforcing artifact: three-second Attention Queue latency assertion. Phase 6. |

#### V11

| Article | Status | Enforcing artifact / gap |
|---|---|---|
| V11.1 Fluid Operations | `enforced` | Repository source missing; status taken from the V12 disposition source. |
| V11.2 Evidence-based traceability | `enforced` | Existing `Artifact` and `EvidenceFactCard` lineage. |
| V11.3 Arbitration Architecture | `enforced` | Existing human decision boundary. |
| V11.4 Two-stage async protocol | `enforced` | Ingestion/composition decoupling in production. |
| V11.5 `needs_manager_dispatch = false` gate | `declared-not-enforced` and suspended | No queue entity, consumer, or state machine. Suspended by §4 interim rule. Enforcing artifact: unconsumed-tag invariant and three-outcome audit state machine. Phase 5. |
| V11.6 Hard-link reflow (`linked_undo_artifact_id`) | `enforced` | Existing hard-link reflow path. |
| V11.6b Soft-link handoff reflow | `enforced` in code, undocumented in V11 | Documentation defect only; written into V12. |
| V11.7 Daily-cutoff undo trigger | `declared-not-enforced` | Fires on any failed run, including mid-shift. Enforcing artifact: post-cutoff creation invariant. Phase 2a. |
| `new_train` authoritative creation | `declared-not-enforced` | Hypothesis only, no workflow record. Enforcing artifact: durable provisional workflow invariant. Phase 3. |
| OD/OS laterality conflict detection | `declared-not-enforced` | Not present. Enforcing artifact: explicit 16-cell compatibility matrix and laterality conflict tests. Phase 4. |
| Undo terminal state | `declared-not-enforced` | Not present. Enforcing artifact: `accepted_orphan` terminal state. Phase 2b. |
| Aggregate reporting layer | `declared-not-enforced` | Not present. Enforcing artifact: nightly rollup table and schema assertions. Phase 6. |

---

# Part 2 — Corrected articles

## §4. A1 — Cross-verification conflict routing (interim and final)

### Article V12.4 — Conflict routing

**Status: §4.1 enforced; §4.2 declared-not-enforced pending Phase 3 export boundaries; §4.3 declared-not-enforced pending Phase 1b; §4.4 declared-not-enforced pending Phase 5; §4.5 declared-not-enforced pending Phase 4.**

Amends V9.A1 and V11.5.

### 4.1 — Detection

A fact card that fails hard-conflict validation against a candidate workflow — role/category mismatch, subject conflict, device-identity mismatch, or laterality conflict (§4.5) — is blocked from auto-attach. This is unchanged and remains enforced.

### 4.2 — Lock semantics (narrowed)

V9.A1’s entity lock is narrowed. A conflict blocks confirmation and external export only. It does not block further evidence capture, does not block clinical activity, and does not block the patient’s progression through the clinic. A system that can freeze a patient mid-flow has crossed onto Axis A.

Concretely: a conflicted entity may not be promoted to `confirmed`, may not be referenced in any outbound claim, journal entry, or inventory movement, and may continue to accumulate fact cards normally.

### 4.3 — INTERIM RULE

In force from V12 adoption until the Phase 5 exit condition is met. **Status: declared-not-enforced; enforcing artifact: interim `pre_attach_conflict` routing and its consumption invariant, Phase 1b.**

`needs_manager_dispatch = false` is suspended. Every blocked fact card is immediately materialised as an `AttentionItem` with:

- `attention_type = 'pre_attach_conflict'`;
- `status = 'open'`;
- urgency red for safety-critical conflicts (§2 carve-out), or yellow otherwise; and
- `evidence_ids`, `event_ids`, and `reasoning_chain` per V10.4.

**Rationale, recorded so it is not relitigated:** an unbuilt gate is not a gate. Between V9.A1 (surface immediately to a human) and V11.5 (hold for pre-review), only V9.A1 is currently implementable, because V11.5’s pre-reviewer does not exist. The present code executes V11.5’s blocking without V11.5’s consumer, which is the only genuinely unsafe combination of the two — conflicts are neither adjudicated nor seen.

### 4.4 — FINAL RULE

In force from Phase 5 exit. **Status: declared-not-enforced; enforcing artifact: the unconsumed-tag invariant and full audit state machine, Phase 5.**

`needs_manager_dispatch = false` resumes. Blocked fact cards enter the pre-attach audit queue and must reach one of three terminal outcomes:

- `resolved_attach`;
- `resolved_separate`;
- `escalate_human`.

Only `escalate_human` materialises an `AttentionItem`.

### 4.5 — Permanent carve-out

**Status: declared-not-enforced; enforcing artifact: OD/OS laterality conflict detector and immediate red-Attention latency test, Phase 4.**

An OD/OS laterality conflict between a same-day exam card and a prescription or procedure card for the same patient bypasses the queue in both the interim and final states and materialises an `AttentionItem` with urgency red immediately. This carve-out is not subject to batching, throttling, or pre-review under any future amendment short of clinical sign-off.

---

## §5. A2 — Sequence anomaly (replaces “process violation”)

### Article V12.5 — Flow sequence observation

**Status: sequence capture enforced; former violation semantics deprecated and to be removed by Phase 6 aggregate routing.**

Amends V9.A2.

### 5.1

Out-of-sequence QR scans are recorded as `sequence_anomaly`. The term “process violation” is void, along with every behaviour attached to it.

### 5.2

A sequence anomaly does not:

- lock an entity;
- escalate to A1;
- generate an `AttentionItem`;
- appear on any individual’s record; or
- attach to a named staff member in any surface visible to a manager.

### 5.3

A sequence anomaly feeds the aggregate layer (Phase 6) only, as a count against `(date × branch × domain × sequence-pair)`. Its purpose is to locate broken capture steps, never to characterise a person or a shift.

### 5.4 — Rationale, recorded

Out-of-sequence scans are predominantly legitimate clinical variation: repeat measurements, urgent cases advanced ahead of queue, walk-ins, patients returned to a prior station. Classifying these as violations produces high-volume false positives concentrated at the busiest moments, implicitly names the person present, and directly contradicts the principle that elapsed time and sequence are evidence, not evaluation.

### 5.5 — Boundary

A scan sequence that additionally implies a patient-identity or laterality conflict is not a sequence anomaly. It is a hard conflict and routes to §4.

---

## §6. Quarantine (replaces “discard floating data”)

### Article V12.6 — Quarantine, never discard

**Status: declared-not-enforced; enforcing artifact: quarantine partition, re-admission path, and ingestion-to-quarantine reconciliation invariant.**

Voids V9.X.

### 6.1

No artifact, fact card, or event is ever discarded. Data arriving without a governing trigger anchor is written to a quarantine partition and retained indefinitely.

### 6.2

Quarantined records:

- are excluded from composition and from all operational reporting;
- retain full lineage and ingestion provenance;
- are re-admissible to composition without loss if a governing trigger later appears; and
- are counted in the aggregate layer as a data-quality signal.

### 6.3 — Rationale, recorded

V9.L3 (“no evidence, no adjudication”) and V9.L4 (“no traceability, no closure”) both require that evidence persist. An article mandating destruction of evidence cannot coexist with them. In an inspected clinical and billing environment, destruction is additionally the one action that cannot be remediated after the fact.

---

## §7. Persistence law

### Article V12.7 — Persistence

**Status: declared-not-enforced; enforcing artifact: provisional workflow schema, default confirmed-only read scope, export guards, and durable `new_train` invariant, Phase 3.**

Amends V9.L2.

“No closed loop, no persistence” is replaced by:

> **No closed loop, no confirmation.**

Persistence is permitted, and required, at every non-confirmed status:

- `provisional`;
- `quarantined`;
- `orphan`;
- `accepted_orphan`.

Only promotion to `confirmed` — and, per §4.2, only export beyond the system boundary — requires a closed, traceable loop.

**Rationale, recorded:** The original law is the reason the `new_train` gap looks defensible in code review. It is not defensible: it forces the system to forget everything it has not yet finished understanding, which biases the record toward continuations and against novelty. Persistence and confirmation are different guarantees and must not share a rule.

---

# Part 3 — Sequenced execution plan

## Dependency map

```text
PHASE 0 — Constitution (docs only)
  │
  ▼
PHASE 1 — Instrumentation + interim A1 (1b)
  ├──────────────┬──────────────────┐
  ▼              ▼                  ▼
PHASE 2       PHASE 4            TRACK G
Undo timing   Laterality         Gold set
+ terminal    (parallel)         (background)
state
  │              │                  │
  ▼              │                  │
PHASE 3          │                  │
Provisional      │                  │
workflows        │                  │
  │              │                  │
  └──────────────▼──────────┐       │
                 PHASE 5    │       │
          Audit queue full SM       │
                    │               │
                    ▼               │
                 PHASE 6            │
             Aggregate layer        │
                    │               │
                    └───────────────▼
                         PHASE 7
             Threshold tuning (last, data-gated)
```

### Explicit parallel/sequential answers

- **Laterality (Phase 4) does not depend on provisional workflows (Phase 3).** They touch disjoint code: Phase 4 changes the subject-fingerprint key and the hard-conflict set; Phase 3 changes the workflow entity and read scope. Run them in parallel with separate owners. Phase 4 depends only on Phase 1b, because it needs a consumer for the conflicts it will start generating.
- **The audit queue MVP is partly dependent on provisional workflows.** Its interim form (Phase 1b) is fully independent and ships immediately. Its full three-outcome state machine (Phase 5) needs Phase 3, because `resolved_separate` means “this belongs to a different workflow” and there is nothing to create that workflow with until provisional creation exists. Split it in two rather than blocking it.

---

## Phase 0 — Constitution

### Scope

Documentation only. Merge Part 1 and Part 2 of this document into V12. Publish. Apply status markers to every article per §3. Zero code, zero schema, zero config.

### Dependencies

None. Start today.

### Done when

- [ ] V12 published containing §1–§7 verbatim.
- [ ] Every V9/V10/V11 article carries exactly one status marker.
- [ ] Every `declared-not-enforced` article names its enforcing artifact and its phase.
- [ ] V9.X and V11.8 marked VOID in the source documents themselves, not just in V12.
- [ ] A grep across the repo for `needs_manager_dispatch` and `process violation` returns a list of every code site that will need to change, attached to the relevant phase.

### Do NOT yet

Do not change any code in this phase. The temptation will be to “just fix the flag while we’re in there.” The interim A1 rule needs its instrumentation (Phase 1a) to land alongside it or you will not be able to tell what it did.

### False regression to expect

Someone will read the `declared-not-enforced` markers as an admission of negligence and push to hide them. It is the opposite: the marker is the control. Pre-empt this by circulating rule §3.1 with the document.

---

## Phase 1 — Instrumentation and interim safety routing

### Scope

#### 1a — Instrumentation

New files, additive tables, no behaviour change.

- **Attach-decision log:** one row per composition decision, recording per-track scores, aggregate score, threshold, margin-to-threshold, outcome (`attach / new_train / orphan / blocked`), domain, branch, and timestamp.
- **Correction capture:** every manager un-attach writes a labelled mis-attach record. This is the ground-truth set and it starts accumulating from day one.
- **Negative-constraint table:** an un-attached `(card, workflow)` pair is recorded as forbidden and is never re-proposed by the engine.
- **Hard-link share counter:** self-supplement links vs. total links, by branch and domain.

#### 1b — Interim A1 activation (§4.3)

- Route every `llm_audit_required = true` fact card to an `AttentionItem` with `attention_type = 'pre_attach_conflict'`.
- Check first: grep `phase3Contract.js` to determine whether authorization is keyed on entity type + action or on the `attention_type` enum. If entity+action, this is a new-value addition and touches nothing under parity lock. If the enum is inside the locked schema, implement 1b as a standalone sweeper process that reads the tag and writes existing-shape `AttentionItem`s — new files, no schema change, no parity-test exposure.

### Dependencies

Phase 0, so the interim rule has constitutional cover.

### Done when

- [ ] `count(llm_audit_required = true AND no corresponding AttentionItem AND age > 1 hour) == 0` — asserted in CI against production-shaped data.
- [ ] Every composition decision in the last 24 hours has a decision-log row; assert count parity between engine runs and log rows.
- [ ] Un-attach stickiness test: un-attach a pair, re-run composition, assert the pair is not re-proposed.
- [ ] Hard-link share is computable for the trailing 7 days. Record this baseline number. Phase 2 is measured against it.

### Do NOT yet

Do not touch thresholds. Do not touch the workflow schema. Do not build the three-outcome state machine — 1b deliberately has one outcome (`escalate_human`) and that is correct for now. Do not add urgency ranking or SLA tiers to the Attention Queue.

### False regression to expect

Attention Queue volume will spike sharply, possibly by an order of magnitude, on the day 1b ships. This is not a new problem appearing. It is the existing backlog of blocked conflicts becoming visible for the first time — items that have been silently accumulating since the gate was written. Expect a one-time spike followed by decay toward a steady state over roughly two weeks as the backlog drains. Do not respond by raising the conflict threshold or by re-suppressing the routing. If the steady state is still unmanageable after the backlog drains, that is a real finding and belongs in Phase 7, not a rollback of Phase 1.

---

## Phase 2 — Undo queue: timing and terminal state

These ship together. See §0.

### Scope

#### 2a — Timing

Modified file: `undoListService`.

- `UndoListItem` creation moves behind a scheduling predicate: post-daily-cutoff sweep only.
- No composition run at any other time may create one.

#### 2b — Terminal state

Schema + UI.

- New status `accepted_orphan` on `UndoListItem`, with required reason code from a closed list:
  - `duplicate`;
  - `test_or_training_entry`;
  - `patient_did_not_proceed`;
  - `counterpart_not_in_system`;
  - `cannot_recall_insufficient_context`.
- Optional free-text supplement only.
- UI: `accepted_orphan` presented with equal visual weight to link and handoff. Not in an overflow menu.
- Closure does not delete the fact card. The card persists, queryable, and remains a live candidate for future composition runs.
- Auto-aging: `accepted_orphan` with reason `aged_out` after 45 days.
- Departure/leave handling: on staff departure, leave, or transfer, open items age out or transfer to the department, never to a named individual.
- Document the soft-link handoff path in V12 (V11.6b), closing that documentation defect.

### Dependencies

Phase 1a — the hard-link baseline is needed to prove the fix. Nothing else.

### Done when

- [ ] Invariant: `count(UndoListItem created outside the post-cutoff window) == 0`, asserted continuously.
- [ ] `accepted_orphan` reachable in no more than 2 taps from the undo list, with reason code required.
- [ ] Reversibility test: close an item as `accepted_orphan`, ingest a matching fragment, assert the closed card is still returned as a candidate.
- [ ] Departure test: mark a staff account inactive, assert zero open `UndoListItem`s remain assigned to it.
- [ ] V11.7 status flipped to `enforced`, citing the timing invariant. V9.L4 flipped to `enforced`, citing terminal-state traceability.

### Do NOT yet

Do not build the aggregate reporting layer — reason-code data needs to accumulate first. Do not redesign the handoff/soft-link UX. Do not touch thresholds. Do not add per-person queue depth anywhere visible to a manager.

### False regressions to expect

1. **Orphan counts will rise.** Items that were being cleared mid-shift now sit until cutoff. This is the system becoming more correct, and it will look exactly like a regression on any dashboard. Pre-commit to this expectation in writing, signed off by whoever owns the metric, before 2a ships. This is the single most likely phase to be wrongly reverted.
2. **Hard-link share should fall against the Phase 1a baseline.** If it does not fall within two weeks, that is a genuine signal — fabrication pressure is coming from a source other than mid-shift timing, and it needs investigation before Phase 7. Do not revert; investigate.

---

## Phase 3 — Provisional workflow states

### Scope

#### Schema

Additive only, no new table. On the workflow entity:

- `status` enum: `provisional | confirmed | merged | rejected`;
- `provenance`: `engine_new_train | human_created`;
- `hypothesis_id` foreign key;
- `confirmed_at`;
- `confirmed_by`;
- `merged_into_workflow_id` (nullable).

#### Read scope

One place, not N call sites. Default every workflow query to `status = 'confirmed'` unless `include_provisional = true` is passed. Implement in the repository/query helper.

#### Migration

Backfill all existing workflows to `confirmed`.

#### Engine

`new_train` now writes a durable provisional workflow record every time. A new fact card may attach to a provisional workflow; the attach inherits provisionality and the whole cluster remains provisional until human confirmation.

#### Export boundary

A hard guard: no provisional workflow ID may cross into claims/レセプト submission, accounting journals, or inventory movements. Enforced at the boundary, not by convention.

#### Attention Queue

New `attention_type = 'confirm_or_merge'`.

### Dependencies

Phase 1a for instrumentation. Phase 2 is recommended first so contamination has already stopped, but is not technically required. Phase 0 §7 is required — V9.L2 as originally written forbids this work.

### Done when

- [ ] Invariant: `count(new_train hypotheses without a corresponding workflow row) == 0`.
- [ ] Every pre-migration workflow has `status = 'confirmed'`.
- [ ] Parity test: default queries return byte-identical results to a pre-migration snapshot.
- [ ] Export-boundary test: attempt to reference a provisional ID in each external path; assert rejection at all of them.
- [ ] Merge path exercised: two provisionals merged, `merged_into_workflow_id` set, neither record deleted, lineage intact from both.
- [ ] V10.4 and the `new_train` article flipped to `enforced`. V9.L2 removed.

### Do NOT yet

Do not auto-confirm anything, ever, on any confidence threshold. Do not expose provisionals to finance or KPI dashboards — that is Phase 6 with explicit separation. Do not tune thresholds. Do not build a bulk-confirm UI; one-at-a-time confirmation is correct until you have seen the real volume.

### False regressions to expect

1. **Total workflow count will jump**, possibly several-fold, depending on the `new_train` rate. This is the previously-invisible population becoming visible for the first time. Snapshot every workflow-count-derived metric before migration and mark the migration date in the data, or a month from now nobody will be able to explain the discontinuity.
2. **Orphan rate will fall**, because cards now have provisional workflows available to attach to. This is real, but do not credit it to matching quality — the denominator changed. It is not evidence that thresholds are correct.

---

## Phase 4 — OD/OS laterality (parallel with Phase 3)

### Scope

#### Subject key

`subject_key = (patient_id, laterality)`, with:

`laterality ∈ {OD, OS, OU, UNKNOWN, N_A}`.

Non-clinical domains use `N_A` and behave exactly as today.

#### Compatibility matrix

Implement exactly this, with no inference:

|  | OD | OS | OU | UNKNOWN |
|---|---|---|---|---|
| **OD** | compatible | **hard conflict** | compatible | insufficient |
| **OS** | **hard conflict** | compatible | compatible | insufficient |
| **OU** | compatible | compatible | compatible | insufficient |
| **UNKNOWN** | insufficient | insufficient | insufficient | insufficient |

`UNKNOWN` is **insufficient evidence, not neutral** — it reduces attach eligibility for clinical cards. Scoring it neutral is the null-evidence trap: it would make the least-informative cards the most attachable.

#### Conflict code

New `laterality_conflict`, distinct from `subject_conflict`. Two reasons:

1. remediation differs — usually a data-entry error to correct, not a cluster to separate; and
2. it must be counted independently as a clinical safety KPI rather than a data-quality KPI.

#### Normalizer

Per-field extraction confidence on laterality. Low confidence maps to `UNKNOWN`, never to a guess. A confidently-wrong laterality is worse than a missing one.

#### Safety carve-out (§4.5)

Same-day exam ↔ prescription/procedure OD/OS conflict surfaces immediately as red, bypassing any queue.

### Dependencies

Phase 1b only. Not Phase 3. Assign a separate owner and run concurrently.

### Done when

- [ ] All 16 cells of the compatibility matrix covered by explicit unit tests.
- [ ] Test: a clinical card with `UNKNOWN` laterality has strictly lower attach eligibility than the same card with a concrete value.
- [ ] Zero clinical fact cards with a missing laterality field (`UNKNOWN` is a value; absence is not).
- [ ] Latency test: same-day exam-vs-prescription OD/OS conflict produces a red `AttentionItem` within the stated window.
- [ ] `laterality_conflict` counts are split by extraction confidence (`high / low`) from day one.

### Do NOT yet

Do not backfill historical laterality by inference. Mark all historical clinical cards `UNKNOWN`. An inferred backfill manufactures fake safety signal and, worse, fake safety reassurance — you would be unable to distinguish a genuinely clean history from a confidently-guessed one. Also: do not extend the composite key to non-clinical domains, and do not add a laterality field to finance/HR/procurement cards.

### False regression to expect

Conflict volume will spike, and a substantial share will be OCR and handwriting errors rather than clinical errors — R/L, 右/左, and handwritten 右 vs. 左 are among the least reliable fields you extract. This is the normalizer correctly telling you where capture is weak. Do not loosen the matrix in response. The confidence split in the exit criteria exists precisely so you can separate the two populations and route extraction problems to ingestion improvements rather than to matching thresholds.

---

## Phase 5 — Audit queue: full state machine

### Scope

Upgrade Phase 1b’s single-outcome routing to three outcomes:

- `resolved_attach` — commits, records adjudicator and rationale;
- `resolved_separate` — creates or retains a distinct provisional workflow; this is what requires Phase 3;
- `escalate_human` — materialises an `AttentionItem`.

Reinstate `needs_manager_dispatch = false` per §4.4. Retire the interim rule.

### Dependencies

Phase 1b and Phase 3.

### Done when

- [ ] Invariant: `count(llm_audit_required = true AND audit_outcome IS NULL AND age > N hours) == 0`, with N stated in V12.
- [ ] Every outcome record carries adjudicator identity (`llm / human`), rationale, and full V10.4 lineage.
- [ ] “Could not decide” is a recorded outcome, not an absence of one.
- [ ] §4.5 carve-out verified still bypassing the queue.
- [ ] V11.5 flipped to `enforced`, citing the invariant. §4.3 interim rule marked `deprecated` with its removal date.

### Do NOT yet

Do not add priority ranking, SLA tiers, auto-resolution confidence gates, or batch-approve UI. Three outcomes, one window, nothing else. Every one of those additions is a way to quietly reintroduce machine authority.

### False regression to expect

Manager-facing Attention Queue volume will drop sharply as the LLM pre-review absorbs items that were previously all escalating. This will look like the queue broke, or like items are being lost. Verify with the invariant test, not by eyeballing volume. The correct check is that every tagged item has an outcome — not that managers still see the same number of things.

---

## Phase 6 — Aggregate reporting layer

### Scope

Nightly rollup table. One row per `(date × branch × domain × metric)`, with value and denominator. Not a live query.

V1 metrics, four only:

- orphan rate: orphans created / eligible fact cards;
- `accepted_orphan` rate, split by reason code;
- mis-attach proxy: manager un-attaches / total attaches;
- hard-link share: self-supplement / total links.

Plus `sequence_anomaly` counts per §5.3, and quarantine volume per §6.2.

### Three structural controls

1. **No staff identifier column exists in the schema.** Not access-controlled — absent. Access controls leak; absence does not. This converts “we do not evaluate individuals with this” from a policy promise into a property of the system.
2. **Minimum cell size.** Suppress any cell with denominator below 20. At a small branch, “Tuesday morning × pharmacy” is one person regardless of whether an identifier is stored. Roll up to week or branch until the denominator clears.
3. **No drill-down from aggregate to item.** Investigation goes through the Attention Queue — governed, item-level, already authorized. The disconnection between the two surfaces is the control.

Add the V10.8 latency assertion here — three-second Attention Queue load — flipping that article to `enforced`.

### Dependencies

Phase 1a because metrics must exist; Phase 2b because reason codes must exist.

### Done when

- [ ] Schema assertion: a test fails if any staff-identifying column is added to the rollup table. Assert on schema, not on data.
- [ ] Suppression test: a cell with denominator below 20 is not returned by any API path.
- [ ] No API route exists from a rollup cell to an item list. Assert by route enumeration.
- [ ] V10.8 latency assertion passing.
- [ ] V12 states the intended use as a limit: these metrics identify broken process steps, not people.

### Do NOT yet

Do not add drill-down. Do not add per-shift or per-hour granularity. Do not add anything per-individual, in any form, under any access control. Do not add a fifth metric — four is enough to steer with, and each additional one is a new opportunity to reconstruct an individual by intersection.

### False regression to expect

The first month’s numbers will look bad, and they will not be comparable to anything. You are establishing baselines, not observing degradation. The window also contains the Phase 3 count discontinuity — mark that date in the data so it is visible in every chart. Expect at least one person to conclude that quality is falling; it is measurement beginning.

The organisational risk in this phase is not technical. The first time these numbers appear in an HR conversation, capture behaviour changes at the terminal and evidence quality degrades at the source — which destroys the value of every phase above it. State the boundary in V12 and defend it. The data-integrity argument generally persuades stakeholders faster than the ethical one, and both are true.

---

## Track G — Gold set (background; starts at Phase 1, feeds Phase 7)

### Scope

Manually reconstruct 200–400 complete workflows across all domains — patient, finance, pharmacy/logistics, HR, procurement — as labelled ground truth. Deliberately over-sample the cross-domain joins (`patient ↔ claim`, `procurement ↔ lot ↔ fitting`) because those are where a wrong link is most costly.

### Dependencies

None. Start at Phase 1 and run continuously. This is calendar-time work, not engineering work, and it is the long pole for Phase 7 — starting it late is the most likely cause of Phase 7 slipping.

### Done when

- [ ] At least 200 labelled workflows, with per-domain minimums met; no domain below 25.
- [ ] Inter-labeller agreement measured on a 10% overlap sample.
- [ ] The set is versioned and frozen; later additions become a separate holdout.

---

## Phase 7 — Threshold tuning

### Scope

Tune composition thresholds and per-track weights against labelled data, with an explicit asymmetric loss function.

#### Per-domain profiles

One weighting, one threshold, and one time-decay function across all domains is wrong in both directions. In finance and procurement, document lineage and business IDs are near-deterministic while temporal continuity is nearly worthless — an invoice may lag delivery by 60 days. In patient flow it is the reverse. Tune per domain.

#### Track correlation

Before tuning weights, measure the correlation between staff/device/location consistency, department handoff plausibility, and temporal continuity. These covary heavily — same person, same lane, same ten minutes — and if they combine additively you are triple-counting one underlying signal. This is the failure mode that worsens with throughput, which is the growth direction.

#### Cross-domain hard rule

This is not a tuned parameter. Any cross-domain attach requires at least one deterministic identifier. Never soft-track inference alone. This ships as a rule regardless of tuning outcomes.

#### Loss function

Write down the mis-attach : orphan weighting explicitly — start at **5:1** and justify any change. An orphan is visible, recoverable, and routes to a human. A mis-attach is invisible, silently corrupts the record, and becomes harder to detect as more cards pile onto the wrong workflow. The two errors are not symmetric and must not be traded off symmetrically.

### Dependencies

All phases above, plus a data gate. Do not start until:

- at least 200 labelled mis-attaches from Phase 1a correction capture;
- at least 4 weeks of clean post-Phase-2 data; and
- Track G frozen.

### Done when

- [ ] Precision and recall reported per domain, and separately for auto-committed vs. audit-flagged decisions.
- [ ] Track correlation matrix published; any track pair above a stated correlation threshold is either merged or explicitly justified.
- [ ] Asymmetric loss function documented in V12 with its numeric weighting.
- [ ] Cross-domain deterministic-identifier rule enforced with a test.
- [ ] A standing process: every future threshold change is evaluated against the frozen gold set before merge.

### Do NOT

Do not tune per branch — you will fit local staffing patterns and get a system that cannot be operated centrally across 100+ locations. Do not tune more than one domain at a time. Do not tune during any other phase’s rollout. Do not tune before the data gate, no matter how obvious a change looks.

### False regression to expect

Orphan rate will rise as you tune toward safety. That is the intended direction of travel, not a regression. If tuning makes orphan rate fall and nothing else changes, you have almost certainly tuned toward mis-attachment.

---

# Part 4 — Definition of “V12 done”

V12 is complete when every box below is checked. Partial completion is not a version; it is the current transition state.

## Constitutional

- [ ] V12 published with §1–§7 verbatim.
- [ ] Every article in V9, V10, V11, and V12 carries exactly one status marker.
- [ ] Zero articles remain `declared-not-enforced` without a named enforcing artifact and a named phase.
- [ ] V9.X (discard) and V11.8 (false stability table) marked VOID in source.
- [ ] V9.L2 removed; §7 in force.
- [ ] §4.3 interim rule marked `deprecated` with a removal date; §4.4 final rule `enforced`.
- [ ] The safety-critical open-loop list (§2) has named clinical sign-off.

## Code–constitution agreement

- [ ] Every `enforced` article cites a test or invariant that is currently passing in CI.
- [ ] A single CI job runs every constitutional invariant and fails the build on any breach. This job is the actual deliverable of V12 — it is what makes “the constitution and the code are provably in agreement” a mechanical fact rather than a claim.
- [ ] Grep for `needs_manager_dispatch`, `process violation`, and any discard path returns zero live sites inconsistent with V12.

## Invariants, all asserted and passing

- [ ] No unconsumed audit tag beyond N hours. Phase 5.
- [ ] No `UndoListItem` created outside the post-cutoff window. Phase 2a.
- [ ] No `new_train` hypothesis without a durable workflow record. Phase 3.
- [ ] No provisional workflow ID crossing an export boundary. Phase 3.
- [ ] No staff-identifying column in the aggregate rollup schema. Phase 6.
- [ ] No aggregate cell returned below minimum denominator. Phase 6.
- [ ] No re-proposal of an un-attached pair. Phase 1a.
- [ ] No clinical fact card with a missing — as opposed to `UNKNOWN` — laterality field. Phase 4.
- [ ] No discarded artifact — quarantine volume reconciles against ingestion volume. §6.

## Workstreams shipped

- [ ] Instrumentation and correction capture. Phase 1a.
- [ ] Interim conflict routing, then full three-outcome audit queue. Phases 1b and 5.
- [ ] Undo timing fix + `accepted_orphan` terminal state. Phase 2.
- [ ] Provisional workflow states. Phase 3.
- [ ] OD/OS laterality. Phase 4.
- [ ] Aggregate reporting layer. Phase 6.
- [ ] Gold set frozen; thresholds tuned per domain with documented asymmetric loss. Track G and Phase 7.

## Documentation defects closed

- [ ] Soft-link handoff path documented. V11.6b.
- [ ] Every false-regression note in Part 3 circulated to whoever owns the affected dashboard before that phase ships.
- [ ] The Phase 3 migration date marked in every workflow-count-derived time series.

---

## Closing note

The plan above is deliberately conservative about one thing: it never lets machine authority widen as a side effect of a convenience feature. Bulk-confirm, auto-resolution gates, SLA tiers, drill-down from aggregates — each is individually reasonable and each is a route back to Axis A. They are listed in the “Do NOT yet” sections not because they are wrong forever, but because every one of them should require someone to argue for it explicitly, on the record, under §2.

The single highest-value artifact in this entire plan is the CI job in the Part 4 checklist. Everything else is a fix to a specific defect. That job is the thing that prevents the class of defect — a constitution that says one thing while the code does another — from recurring in V13.
