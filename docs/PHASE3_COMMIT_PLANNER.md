# Phase 3 Commit Planner boundary

This batch adds a pure, non-deployed planner for manager-approved **attach** commits.

- It creates serializable descriptors for a WorkflowCommitIntent and immutable WorkflowSnapshot version + 1.
- It emits an exact Workflow pointer CAS filter. The persistence adapter must treat Base44 `updateMany.updated === 1` as success and every other count as stale.
- It never mutates the source snapshot and never performs Entity writes.
- It rejects cross-tenant objects, stale pointers, mismatched manager decisions, non-selected hypotheses, and auto/system managers before persistence.
- It explicitly rejects `new_train` until its separate Workflow-creation Saga is designed.
- Raw exception messages/stacks are never persisted in reconciliation.

The deployed `compositionOrchestrator` still does not expose a `commit` action in this batch.
