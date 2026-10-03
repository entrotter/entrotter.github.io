// Fixed read-only account profile; imported bytes never select code or RPCs.
import { MAX_TRACE_BYTES } from "./trace-report.mjs";
import {
  parseObservationJSON,
  observationCanonical,
  validateObservedTrace,
} from "./observed-trace.mjs";

export const POSITION_SCOPE =
  "Owned-node read-only Aave account views. Differences compare the submitted transaction-prefix branches; they do not isolate price as the sole cause. No signed consumer action, loan/liquidation execution, profit, provider or proxy-implementation authentication, full-block/state-root proof. All-account base-currency values, not token balances; WAD health factor, basis-point thresholds. Native execution has no whole-process sandbox.";
export const ACCOUNT_FIELDS = [
  "total_collateral_base",
  "total_debt_base",
  "available_borrows_base",
  "liquidation_threshold_bps",
  "ltv_bps",
  "health_factor_wad",
];
const PROVIDER = "0x2f39d218133afab8f2b819b1066c7e434ad94e9e";
const ORACLE = "0x54586be62e3c3580375ae3723c145253060ca0c2";
const QUERIES = ["pool_code", "account_data", "provider", "oracle"];
const RPC_CODES = [
  "unknown",
  "invalid_request",
  "timeout",
  "http_error",
  "connection_error",
  "tls_error",
  "invalid_response",
  "response_too_large",
  "rejected",
  "transport_error",
];
/** @returns {never} */
function fail(detail) {
  throw new Error(`Invalid account-position report: ${detail}.`);
}
/** @param {unknown} value @returns {Record<string, any>} */
function exact(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("object");
  const row = /** @type {Record<string, any>} */ (value);
  if (
    Object.keys(row).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(row, key))
  )
    fail("unexpected or missing fields");
  return row;
}
function equal(a, b) {
  return observationCanonical(a) === observationCanonical(b);
}
function hex(value, size) {
  if (
    typeof value !== "string" ||
    !/^0x(?:[0-9a-fA-F]{2})*$/.test(value) ||
    value.length !== 2 + size * 2
  )
    fail("ABI bytes");
  return value;
}
function address(value) {
  const raw = hex(value, 32);
  if (raw.slice(2, 26) !== "0".repeat(24)) fail("ABI address padding");
  return "0x" + raw.slice(26).toLowerCase();
}
export function decodeAccount(value) {
  const raw = hex(value, 192);
  const words = Array.from({ length: 6 }, (_, i) =>
    BigInt("0x" + raw.slice(2 + i * 64, 66 + i * 64)),
  );
  if (words[3] > 10000n || words[4] > 10000n) fail("basis-point thresholds");
  if (words[1] === 0n && words[5] !== 2n ** 256n - 1n)
    fail("zero-debt health sentinel");
  return Object.fromEntries(ACCOUNT_FIELDS.map((key, i) => [key, words[i]]));
}
function health(value) {
  if (value === null) return "unproven";
  if (value.total_debt_base === 0n) return "no_debt";
  return value.health_factor_wad < 10n ** 18n ? "below_one" : "at_or_above_one";
}
function classification(rows, phases, observed) {
  const reasons = new Set();
  if (!observed.classification.complete_price_views)
    reasons.add("price_views_unproven");
  if (!observed.trace.report.baseline_verified)
    reasons.add("baseline_receipts_unverified");
  if (
    rows.some(
      (row) => row.errors.length || row.raw === null || row.code === null,
    )
  )
    reasons.add("incomplete_account_views");
  if (rows.some((row) => row.code === null || row.code.bytes === 0))
    reasons.add("pool_code_unavailable");
  if (rows.slice(1).some((row) => !equal(row.code, rows[0].code)))
    reasons.add("pool_code_identity_changed");
  if (!equal(phases[0].values, phases[2].values))
    reasons.add("initial_account_views_differ");
  if (phases.some((row) => row.provider !== PROVIDER || row.oracle !== ORACLE))
    reasons.add("pool_oracle_binding_unproven");
  const complete = reasons.size === 0;
  const baseline = complete ? phases[1].values : null;
  const candidate = complete ? phases[3].values : null;
  const differences = Object.fromEntries(
    ACCOUNT_FIELDS.map((key) => [
      key,
      baseline !== null && candidate !== null
        ? candidate[key] - baseline[key]
        : null,
    ]),
  );
  if (
    baseline !== null &&
    candidate !== null &&
    (baseline.total_debt_base === 0n || candidate.total_debt_base === 0n)
  )
    differences.health_factor_wad = null;
  return {
    complete_account_views: complete,
    unproven_reasons: [...reasons].sort(),
    baseline,
    candidate,
    differences,
    baseline_health_status: health(baseline),
    candidate_health_status: health(candidate),
    base_unit: complete ? 100000000n : null,
    health_factor_unit: 10n ** 18n,
  };
}
function validateRows(rows, account, observed) {
  if (
    !Array.isArray(rows) ||
    rows.length !== 4 ||
    new TextEncoder().encode(observationCanonical(rows)).byteLength > 65536
  )
    fail("four phases / 64 KiB limit");
  return rows.map((input, i) => {
    const row = exact(input, [
      "branch",
      "phase",
      "raw",
      "provider",
      "oracle",
      "code",
      "errors",
      "account",
      "head",
    ]);
    if (
      row.branch !== (i < 2 ? "baseline" : "candidate") ||
      row.phase !== (i % 2 ? "after" : "before")
    )
      fail("phase binding");
    if (
      row.account !== account ||
      !equal(row.head, observed.wrapper.observations[i].head)
    )
      fail("account/head binding");
    const values = row.raw === null ? null : decodeAccount(row.raw);
    const provider = row.provider === null ? null : address(row.provider);
    const oracle = row.oracle === null ? null : address(row.oracle);
    if (row.code !== null) {
      const code = exact(row.code, ["bytes", "sha256"]);
      if (
        typeof code.bytes !== "number" ||
        !Number.isSafeInteger(code.bytes) ||
        code.bytes < 0 ||
        code.bytes > 65536 ||
        typeof code.sha256 !== "string" ||
        !/^[0-9a-f]{64}$/.test(code.sha256)
      )
        fail("Pool code identity");
    }
    if (!Array.isArray(row.errors) || row.errors.length > 4)
      fail("account diagnostic bound");
    const failed = new Set();
    for (const input of row.errors) {
      const error = exact(
        input,
        input?.category === "rpc_error"
          ? ["query", "category", "diagnostics"]
          : ["query", "category"],
      );
      if (
        !QUERIES.includes(error.query) ||
        failed.has(error.query) ||
        !["rpc_error", "invalid_response"].includes(error.category)
      )
        fail("account diagnostic");
      failed.add(error.query);
      if (error.category === "rpc_error") {
        const diag = exact(error.diagnostics, ["code", "method"]);
        const method = error.query === "pool_code" ? "eth_getCode" : "eth_call";
        if (
          !RPC_CODES.includes(diag.code) ||
          (diag.method !== null && diag.method !== method)
        )
          fail("account RPC metadata");
      }
    }
    const available = new Set([
      ...(row.code !== null ? ["pool_code"] : []),
      ...(values !== null ? ["account_data"] : []),
      ...(provider !== null ? ["provider"] : []),
      ...(oracle !== null ? ["oracle"] : []),
    ]);
    if (
      [...available].some((query) => failed.has(query)) ||
      QUERIES.some((query) => !available.has(query) && !failed.has(query))
    )
      fail("account query coverage");
    return {
      branch: row.branch,
      phase: row.phase,
      account,
      head: row.head,
      values,
      provider,
      oracle,
      pool_code: row.code,
      errors: row.errors,
    };
  });
}
/** @param {string} text */
export async function validatePositionReport(text) {
  const wrapper = exact(parseObservationJSON(text), [
    "position_version",
    "profile",
    "plan",
    "price_report",
    "observations",
    "classification",
    "scope",
    "artifact_id",
  ]);
  if (
    wrapper.position_version !== "0.1.0" ||
    wrapper.profile !== "aave-v3-ethereum-account" ||
    wrapper.scope !== POSITION_SCOPE
  )
    fail("version/profile/scope");
  const plan = exact(wrapper.plan, ["position_version", "trace", "account"]);
  if (
    plan.position_version !== "0.1.0" ||
    typeof plan.account !== "string" ||
    !/^0x[0-9a-f]{40}$/.test(plan.account) ||
    plan.account === "0x" + "00".repeat(20)
  )
    fail("closed account plan");
  const observed = await validateObservedTrace(
    observationCanonical(wrapper.price_report),
  );
  if (!equal(plan.trace, observed.trace.report.plan))
    fail("nested admitted plan");
  const phases = validateRows(wrapper.observations, plan.account, observed);
  const result = classification(wrapper.observations, phases, observed);
  if (!equal(wrapper.classification, result))
    fail("declared account classification");
  if (
    typeof wrapper.artifact_id !== "string" ||
    !/^[0-9a-f]{64}$/.test(wrapper.artifact_id)
  )
    fail("artifact identity");
  const { artifact_id, ...body } = wrapper;
  async function digest(runtimeFloat) {
    const encoded = new TextEncoder().encode(
      observationCanonical(body, runtimeFloat),
    );
    if (encoded.byteLength > MAX_TRACE_BYTES) fail("8 MiB canonical bound");
    return Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", encoded)),
      (b) => b.toString(16).padStart(2, "0"),
    ).join("");
  }
  if (
    (await digest(true)) !== artifact_id &&
    (await digest(false)) !== artifact_id
  )
    fail("wrapper content hash mismatch");
  return {
    wrapper,
    observed,
    trace: observed.trace,
    phases,
    classification: result,
  };
}

/** Format exact units without Number conversion or rounding. */
export function exactUnits(value, decimals) {
  if (value === null) return "Unavailable";
  const integer = typeof value === "bigint" ? value : BigInt(value);
  const sign = integer < 0n ? "−" : "";
  const magnitude = integer < 0n ? -integer : integer;
  const unit = 10n ** BigInt(decimals);
  const fraction = (magnitude % unit)
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  return (
    sign + (magnitude / unit).toString() + (fraction ? "." + fraction : "")
  );
}
