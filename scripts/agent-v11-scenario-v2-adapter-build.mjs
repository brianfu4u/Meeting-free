import { readFile } from "node:fs/promises";

const [inputPath] = process.argv.slice(2);
if (!inputPath) throw new Error("usage: node agent-v11-scenario-v2-adapter-build.mjs <dsl-v2.json>");
const input = JSON.parse(await readFile(inputPath, "utf8"));
if (input?.schema_version !== "agent-v11-scenario-dsl-v2") throw new Error("dsl_v2_required");
if (input?.runner_compatibility !== "requires_v2_fixture_adapter") throw new Error("runner_compatibility_invalid");
if (!Array.isArray(input.scenarios) || input.scenarios.length < 1 || input.scenarios.length > 50) throw new Error("scenario_count_invalid");

const supported = [], approximate = [], unsupported = [];
for (const scenario of input.scenarios) {
  const level = scenario?.execution_support?.level;
  const reason = scenario?.execution_support?.reason || null;
  if (level === "supported") supported.push({
    scenario_id: scenario.scenario_id,
    scenario_type: scenario.scenario_type,
    fixture: scenario.fixture,
    oracle: scenario.oracle,
  });
  else if (level === "approximate") approximate.push({ scenario_id: scenario.scenario_id, reason });
  else if (level === "unsupported") unsupported.push({ scenario_id: scenario.scenario_id, reason });
  else throw new Error(`execution_support_invalid:${scenario?.scenario_id || "unknown"}`);
}
if (supported.length !== 11) throw new Error(`supported_scenario_count_expected_11_received_${supported.length}`);
const template = await readFile(new URL("./agent-v11-scenario-v2-adapter.template.mjs", import.meta.url), "utf8");
const marker = "__AGENT_V11_SCENARIO_V2_EXECUTION_PLAN__";
if (!template.includes(marker)) throw new Error("adapter_template_marker_missing");
process.stdout.write(template.replace(marker, JSON.stringify({
  schema_version: "agent-v11-scenario-v2-execution-plan",
  supported, approximate, unsupported,
})));
