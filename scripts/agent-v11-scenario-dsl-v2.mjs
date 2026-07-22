import { readFile } from "node:fs/promises";

const REQUIRED_COLUMNS = [
  "scenario_id", "department", "business_family", "description", "candidates_count",
  "has_guardrail_dispatch", "has_validation_block", "expected_eligible", "notes",
];

function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell.replace(/\r$/, "")); rows.push(row); }
  const headers = rows.shift() || [];
  for (const required of REQUIRED_COLUMNS) {
    if (!headers.includes(required)) throw new Error(`scenario_csv_column_missing:${required}`);
  }
  return rows.filter((values) => values.some(Boolean)).map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

function bool(value, field, id) {
  if (/^true$/i.test(value)) return true;
  if (/^false$/i.test(value)) return false;
  throw new Error(`scenario_boolean_invalid:${id}:${field}`);
}

const patient = (name = "PATIENT-A") => ({ type: "patient", fingerprint: { name, patient_no: `${name}-NO` } });
const primary = (overrides = {}) => ({
  key: "primary", clinic_scope: "scenario", status: "active", workflow_family: "patient_care",
  subject: patient(), open_loops: [], current_stage: "active", device_serial: null, ...overrides,
});
const fragment = (overrides = {}) => ({
  key: "fragment-1", artifact_type: "document", source_department: "OUTPATIENT",
  source_role: "DOCTOR", category_id: "clinical_consultation", occurred_at_offset_seconds: 0,
  captured_at_offset_seconds: 30, subject: patient(), document_numbers: {}, device_serial: null,
  is_proxy: false, proxy_for_role: null, targeting: { mode: "explicit", workflow_key: "primary" },
  missing_segments: [], finance_expected_missing: [], ...overrides,
});

// Fixtures encode observable facts only. They never read expected_eligible or gate columns.
const BLUEPRINTS = {
  S001: () => ({ workflows: [primary()], fragments: [
    fragment({ key: "registration", source_department: "FRONT_DESK", source_role: "RECEPTION", category_id: "patient_registration", occurred_at_offset_seconds: -2100 }),
    fragment({ key: "refraction", source_department: "OPTOMETRY", source_role: "OPTOMETRIST", category_id: "refraction_optometry", occurred_at_offset_seconds: -900 }),
    fragment({ key: "prescription", document_numbers: { prescription_no: "RX-S001" } }),
  ] }),
  S002: () => ({ workflows: [primary()], fragments: [fragment({ source_department: "OPTOMETRY", source_role: "OPTOMETRIST", category_id: "refraction_optometry", occurred_at_offset_seconds: -10800, captured_at_offset_seconds: 0, time_uncertain: true })] }),
  S003: () => ({ workflows: [primary()], fragments: [fragment({ source_department: "LOGISTICS", source_role: "INVENTORY_STAFF", category_id: "prescription_order", document_numbers: { prescription_no: "RX-S003" } })] }),
  S004: () => ({ workflows: [primary({ workflow_family: "procurement", subject: { type: "vendor", fingerprint: { name: "VENDOR-A" } } })], fragments: [fragment({ source_department: "OPTOMETRY", source_role: "OPTOMETRIST", category_id: "supply_purchase", subject: { type: "vendor", fingerprint: { name: "VENDOR-A" } }, targeting: { mode: "explicit", workflow_key: "primary" } })] }),
  S005: () => ({ workflows: [primary({ key: "candidate-a", subject: patient("PATIENT-A") }), primary({ key: "candidate-b", subject: patient("PATIENT-B") })], fragments: [fragment({ subject: { type: "patient", fingerprint: { name: null, age_band: "adult", sex: "F" } }, targeting: { mode: "none" } })] }),
  S006: () => ({ workflows: [primary({ key: "candidate-a", device_serial: "DEVICE-A" }), primary({ key: "candidate-b", subject: patient("PATIENT-B"), device_serial: "DEVICE-B" })], fragments: [fragment({ device_serial: "DEVICE-C", subject: { type: "patient", fingerprint: { name: "PATIENT", patient_no: null } }, targeting: { mode: "none" } })] }),
  S007: () => ({ workflows: [primary({ open_loops: ["registration_missing"] })], fragments: [fragment({ source_department: "OPTOMETRY", source_role: "OPTOMETRIST", category_id: "refraction_optometry", missing_segments: ["patient_registration"] }), fragment({ key: "prescription", missing_segments: ["patient_registration"] })] }),
  S008: () => ({ workflows: [primary({ open_loops: ["prescription_missing", "financial_settlement_missing"] })], fragments: [fragment({ source_department: "FRONT_DESK", source_role: "RECEPTION", category_id: "patient_registration", missing_segments: ["prescription_order", "financial_settlement"] }), fragment({ key: "refraction", source_department: "OPTOMETRY", source_role: "OPTOMETRIST", category_id: "refraction_optometry", missing_segments: ["prescription_order", "financial_settlement"] })] }),
  S009: () => ({ workflows: [primary({ open_loops: ["ophthalmic_imaging_missing"] })], fragments: [fragment({ source_department: "FINANCE_INSURANCE", source_role: "CASHIER", category_id: "financial_settlement", finance_expected_missing: ["ophthalmic_imaging"], document_numbers: { payment_no: "PAY-S009", payment_category: "OCT_EXAM_FEE" } })] }),
  S010: () => ({ workflows: [primary({ clinic_scope: "foreign", subject: patient() })], fragments: [fragment({ targeting: { mode: "foreign_workflow", workflow_key: "primary" } })] }),
  S011: () => ({ workflows: [primary()], fragments: [fragment({ key: "prescription", occurred_at_offset_seconds: -3600, document_numbers: { prescription_no: "RX-S011" } }), fragment({ key: "refraction", source_department: "OPTOMETRY", source_role: "OPTOMETRIST", category_id: "refraction_optometry", occurred_at_offset_seconds: 0 })], constraints: [{ type: "causal_order", before: "refraction", after: "prescription" }] }),
  S012: () => ({ workflows: [primary({ status: "closed_archived" })], fragments: [fragment()] }),
  S013: () => ({ workflows: [primary({ workflow_family: "marketing", subject: { type: "campaign", fingerprint: { name: "CAMPAIGN-A" } }, open_loops: ["campaign_in_progress"] })], fragments: [fragment({ source_department: "MARKETING", source_role: "MARKETING", category_id: "mkt_event", subject: { type: "campaign", fingerprint: { name: "CAMPAIGN-A" } }, targeting: { mode: "explicit", workflow_key: "primary" }, missing_segments: ["execution_feedback"] })] }),
  S014: () => ({ workflows: [primary({ workflow_family: "inventory", subject: { type: "device", fingerprint: { name: "DEVICE-A", device_serial: "DEVICE-A" } }, device_serial: "DEVICE-A" })], fragments: [fragment({ source_department: "LOGISTICS", source_role: "EQUIPMENT_ADMIN", category_id: "facility_repair", subject: { type: "device", fingerprint: { name: "DEVICE-B", device_serial: "DEVICE-B" } }, device_serial: "DEVICE-B" })] }),
  S015: () => ({ workflows: [primary()], fragments: [fragment({ source_department: "FRONT_DESK", source_role: "RECEPTION", category_id: "prescription_order", is_proxy: true, proxy_for_role: "DOCTOR", exception_class: "manager_approved_exception", normal_rule_learning_eligible: false })] }),
};

const EXECUTION_SUPPORT = {
  S001: { level: "supported", reason: null },
  S002: { level: "supported", reason: null },
  S003: { level: "supported", reason: null },
  S004: { level: "supported", reason: null },
  S005: { level: "supported", reason: null },
  S006: { level: "supported", reason: null },
  S007: { level: "supported", reason: null },
  S008: { level: "supported", reason: null },
  S009: { level: "supported", reason: null },
  S010: { level: "approximate", reason: "runner_uses_isolated_foreign_fixture_not_a_real_second_tenant_authority_context" },
  S011: { level: "approximate", reason: "causal_order_is_descriptive_until_runtime_rule_code_is_wired" },
  S012: { level: "supported", reason: null },
  S013: { level: "supported", reason: null },
  S014: { level: "supported", reason: null },
  S015: { level: "supported", reason: null },
};

function convert(row) {
  const id = row.scenario_id.trim().toUpperCase();
  const blueprint = BLUEPRINTS[id];
  if (!blueprint) throw new Error(`scenario_blueprint_missing:${id}`);
  const fixture = blueprint();
  return {
    scenario_id: id.toLowerCase(),
    scenario_type: row.business_family.trim().toLowerCase(),
    source_spec: { department: row.department, description: row.description, notes: row.notes },
    fixture,
    execution_support: EXECUTION_SUPPORT[id],
    oracle: {
      expected_eligible: bool(row.expected_eligible, "expected_eligible", id),
      expected_guardrail_dispatch: bool(row.has_guardrail_dispatch, "has_guardrail_dispatch", id),
      expected_validation_block: bool(row.has_validation_block, "has_validation_block", id),
    },
  };
}

const [inputPath] = process.argv.slice(2);
if (!inputPath) throw new Error("usage: node agent-v11-scenario-dsl-v2.mjs <scenarios.csv>");
const rows = parseCsv(await readFile(inputPath, "utf8"));
if (rows.length < 1 || rows.length > 50) throw new Error("scenario_count_must_be_between_1_and_50");
const ids = new Set();
const scenarios = rows.map((row) => {
  if (ids.has(row.scenario_id)) throw new Error(`scenario_id_duplicate:${row.scenario_id}`);
  ids.add(row.scenario_id);
  return convert(row);
});
process.stdout.write(`${JSON.stringify({
  schema_version: "agent-v11-scenario-dsl-v2",
  runner_compatibility: "requires_v2_fixture_adapter",
  scenarios,
}, null, 2)}\n`);
