# Clinic OS V11 — V12 Status Index

> **Document status:** Source-gap index; not an original-text reconstruction.  
> **Repository baseline examined:** `main@2ed9d4affc91db2db4f55495082eef19a9e2e766`  
> **Governing document:** [`v12-constitution.md`](./v12-constitution.md)  
> **Source limitation:** No V11 constitutional source file exists in the examined repository baseline. The entries below are derived only from the V11 disposition table supplied in V12 §1. Where the V11 original wording cannot be checked, the entry is explicitly marked **“原文缺失，无法核实”**.

This index exists so that the V12 disposition of the named V11 articles is visible in the repository without pretending that the missing V11 source has been recovered. It does not recreate, paraphrase, or replace the missing original.

| V11 article named by V12 | V12 disposition | V12 article status / enforcement note | Source verification |
|---|---|---|---|
| Title and self-definition: “Operational Monitoring & Command Center”, “real-time-data-driven management” | **VOID — replaced by V12 §2** | The “command” framing has no force under the V12 authority/latency split. | 原文缺失，无法核实 |
| V11.1 Fluid Operations | **INCORPORATED** | `enforced`, as declared by V12 §3. | 原文缺失，无法核实 |
| V11.2 Evidence-based (`Artifact + EvidenceFactCard` traceability) | **INCORPORATED** | `enforced`; existing evidence traceability is the cited artifact. | 原文缺失，无法核实 |
| V11.3 Arbitration Architecture (AI detects, manager decides; AI never triggers scheduling) | **INCORPORATED** | `enforced`; existing human-decision boundary is the cited artifact. | 原文缺失，无法核实 |
| V11.4 Two-stage async protocol (`Ingestion ⟂ Composition`) | **INCORPORATED** | `enforced`; production ingestion/composition decoupling is the cited artifact. | 原文缺失，无法核实 |
| V11.5 `needs_manager_dispatch = false` pre-review gate | **AMENDED — see V12 §4** | `declared-not-enforced` and suspended during the V12 §4.3 interim period. Enforcing artifact: unconsumed-tag invariant and full three-outcome audit state machine, Phase 5. | 原文缺失，无法核实 |
| V11.6 Data reflow — `linked_undo_artifact_id` hard link | **INCORPORATED, extended** | Hard-link reflow is `enforced`; V12 additionally documents the soft-link handoff path as V11.6b. | 原文缺失，无法核实 |
| V11.7 `undoListService` daily cutoff | **INCORPORATED as `declared-not-enforced`** | Behaviour described by V12 does not match code. Enforcing artifact: post-cutoff creation invariant, Phase 2a. | 原文缺失，无法核实 |
| V11.8 version-comparison table listing reflow service and audit queue as “V11 (stable period)” | **VOID** | Factually false as described by V12; must not be carried forward or cited as an enforced control. | 原文缺失，无法核实 |

## Source-gap finding

The repository baseline contains:

- `docs/CLINIC_OS_V9.md`;
- `docs/CLINIC_OS_V10.md`;
- no V11 constitutional source document.

Repository file search and the available pull-request and issue history returned no V11 constitutional source matching the article names above. If an authoritative V11 original is recovered later, it must be added without rewriting its historical text, and the V12 disposition annotations must be placed beside the corresponding original clauses.
