import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const [inputPath] = process.argv.slice(2);
if (!inputPath) {
  throw new Error("usage: node agent-v11-observe-batch-build.mjs <private-scenarios.json>");
}

const payload = JSON.parse(await readFile(resolve(inputPath), "utf8"));
if (payload?.schema_version !== "agent-v11-observe-batch-v1") {
  throw new Error("scenario_schema_version_invalid");
}
if (!Array.isArray(payload.scenarios) || payload.scenarios.length < 1 || payload.scenarios.length > 50) {
  throw new Error("scenario_count_must_be_between_1_and_50");
}

const ids = new Set();
for (const scenario of payload.scenarios) {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(scenario?.scenario_id || "")) {
    throw new Error("scenario_id_invalid");
  }
  if (ids.has(scenario.scenario_id)) throw new Error("scenario_id_duplicate");
  ids.add(scenario.scenario_id);
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(scenario?.scenario_type || "")) {
    throw new Error("scenario_type_invalid");
  }
  if (!Array.isArray(scenario.fragments) || scenario.fragments.length < 1 || scenario.fragments.length > 20) {
    throw new Error(`fragment_count_invalid:${scenario.scenario_id}`);
  }
  if ("clinic_id" in scenario || "test_clinic_id" in scenario) {
    throw new Error(`scenario_must_not_supply_clinic_id:${scenario.scenario_id}`);
  }
}

const templatePath = new URL("./agent-v11-observe-batch.template.mjs", import.meta.url);
const template = await readFile(templatePath, "utf8");
const marker = "__AGENT_V11_PRIVATE_SCENARIOS_JSON__";
if (!template.includes(marker)) throw new Error("batch_template_marker_missing");
process.stdout.write(template.replace(marker, JSON.stringify(payload)));
