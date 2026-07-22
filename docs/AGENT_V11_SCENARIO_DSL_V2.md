# Agent v1.1 Scenario DSL v2

Scenario DSL v2 converts the product scenario matrix into two deliberately
separate structures:

- `fixture`: facts that a test runner must physically create.
- `oracle`: expected observations checked only after the run.

The oracle must never select a candidate, create a guardrail, add a validation
block, or otherwise configure the fixture. This prevents expected answers from
being injected into Agent inputs.

## Runner compatibility

The output declares `runner_compatibility: requires_v2_fixture_adapter`. It is
not accepted by the v1 observe-batch runner. Generating 15 DSL records therefore
does **not** mean that 15 production scenarios have run.

Current production capability review:

| Scenario | Fixture execution support | Limitation |
| --- | --- | --- |
| S003 | unsupported | role/source conflict fixture not wired |
| S004 | unsupported | business-family conflict fixture not wired |
| S009 | unsupported | finance `expected_missing` projection not wired |
| S014 | unsupported | device identity veto fixture not wired |
| S015 | unsupported | manager-approved exception archive path not wired |
| S010 | approximate | isolated foreign fixture is not a real second-tenant authority context |
| S011 | approximate | causal order remains descriptive until its runtime rule code is wired |

Unsupported scenarios may be parsed and reviewed, but a runner must refuse to
report them as executed. Approximate scenarios must be labelled approximate in
all reports and cannot count toward a production eligibility-rate claim.

## Safety

The converter does not call Base44, mutate secrets, request commit authority,
or name a production clinic fixture. It only transforms a local CSV export.
