// Fixed read-only Aave/WETH profile. Imported values never select executable code.
import {
  MAX_TRACE_BYTES,
  traceCanonical,
  validateTraceReport,
} from "./trace-report.mjs";

export const OBSERVATION_SCOPE =
  "Owned-node read-only price views only; no signed consumer action, strategy, loan/liquidation/trade, benefit/profit, deployed-code/provider authentication, full-block/opcode/state-root proof or whole-process native sandbox.";
const ZERO = "0x" + "00".repeat(20);
const FIELDS = [
  "source",
  "price",
  "base_currency",
  "base_unit",
  "aggregator",
  "latest_round_data",
];
const QUERIES = [...FIELDS, "head", "oracle_code", "source_code"];
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
  throw new Error(`Invalid observed-price report: ${detail}.`);
}
/** @param {unknown} value @returns {Record<string, any>} */
function object(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("object");
  return /** @type {Record<string, any>} */ (value);
}
function exact(value, keys) {
  const row = object(value);
  if (
    Object.keys(row).length !== keys.length ||
    keys.some((k) => !Object.hasOwn(row, k))
  )
    fail("unexpected or missing fields");
  return row;
}
/** Preserve arbitrary ABI-derived integers before JSON.parse can round them. @param {string} text */
export function parseObservationJSON(text) {
  if (new TextEncoder().encode(text).byteLength > MAX_TRACE_BYTES)
    fail("8 MiB limit");
  let offset = 0;
  const space = () => {
    while (/[ \t\n\r]/.test(text[offset] ?? "") && offset < text.length)
      offset++;
  };
  const string = () => {
    const start = offset++;
    while (offset < text.length) {
      const c = text[offset++];
      if (c === "\\") offset++;
      else if (c === '"') return JSON.parse(text.slice(start, offset));
    }
    return fail("unterminated string");
  };
  function value(depth, key = "") {
    if (depth > 32) fail("nesting limit");
    space();
    const c = text[offset];
    if (c === '"') return string();
    if (c === "{" || c === "[") {
      offset++;
      space();
      const end = c === "{" ? "}" : "]";
      const result = c === "{" ? Object.create(null) : [];
      if (text[offset] === end) {
        offset++;
        return result;
      }
      while (offset < text.length) {
        space();
        let name = "";
        if (c === "{") {
          if (text[offset] !== '"') fail("object key");
          name = string();
          space();
          if (Object.hasOwn(result, name)) fail("duplicate key");
          if (text[offset++] !== ":") fail("object delimiter");
        }
        const item = value(depth + 1, name);
        if (c === "{") result[name] = item;
        else result.push(item);
        space();
        if (text[offset] === end) {
          offset++;
          return result;
        }
        if (text[offset++] !== ",") fail("array/object delimiter");
      }
      return fail("unterminated container");
    }
    for (const [literal, result] of [
      ["true", true],
      ["false", false],
      ["null", null],
    ]) {
      if (text.startsWith(String(literal), offset)) {
        offset += String(literal).length;
        return result;
      }
    }
    const token = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(
      text.slice(offset),
    )?.[0];
    if (!token || token.length > 512) fail("number grammar/limit");
    offset += token.length;
    if (/[.eE]/.test(token)) {
      if (key !== "runtime_seconds" || !Number.isFinite(Number(token)))
        fail("non-runtime fractional number");
      return Number(token);
    }
    const integer = BigInt(token);
    return integer > BigInt(Number.MAX_SAFE_INTEGER) ||
      integer < BigInt(Number.MIN_SAFE_INTEGER)
      ? integer
      : Number(token);
  }
  const result = value(0);
  space();
  if (offset !== text.length) fail("trailing JSON");
  return result;
}
/** Python-compatible canonical JSON, including integers beyond Number precision. @param {unknown} value */
export function observationCanonical(value, runtimeFloat = true) {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value))
    return (
      "[" +
      value.map((v) => observationCanonical(v, runtimeFloat)).join(",") +
      "]"
    );
  if (value !== null && typeof value === "object") {
    const row = object(value);
    return (
      "{" +
      Object.keys(row)
        .sort()
        .map((key) => {
          const item = row[key];
          const encoded =
            key === "runtime_seconds" && typeof item === "number"
              ? traceCanonical({ runtime_seconds: item }, runtimeFloat).slice(
                  '{"runtime_seconds":'.length,
                  -1,
                )
              : observationCanonical(item, runtimeFloat);
          return traceCanonical(key) + ":" + encoded;
        })
        .join(",") +
      "}"
    );
  }
  return traceCanonical(value);
}
function equal(a, b) {
  return observationCanonical(a) === observationCanonical(b);
}
function integer(value) {
  if (typeof value === "bigint") return value;
  if (typeof value !== "number" || !Number.isSafeInteger(value))
    fail("exact integer");
  return BigInt(value);
}
function hex(value, size) {
  if (
    typeof value !== "string" ||
    !/^0x(?:[0-9a-fA-F]{2})*$/.test(value) ||
    value.length !== size * 2 + 2
  )
    fail("ABI bytes");
  return value;
}
function decode(name, value) {
  const raw = hex(value, name === "latest_round_data" ? 160 : 32);
  if (["source", "base_currency", "aggregator"].includes(name)) {
    if (raw.slice(2, 26) !== "0".repeat(24)) fail("address ABI padding");
    return "0x" + raw.slice(26).toLowerCase();
  }
  if (name !== "latest_round_data") return BigInt(raw);
  const words = Array.from({ length: 5 }, (_, i) =>
    BigInt("0x" + raw.slice(2 + i * 64, 66 + i * 64)),
  );
  if (words[0] >= 2n ** 80n || words[4] >= 2n ** 80n || words[2] > words[3])
    fail("round ABI");
  return {
    round_id: words[0],
    answer: words[1] >= 2n ** 255n ? words[1] - 2n ** 256n : words[1],
    started_at: words[2],
    updated_at: words[3],
    answered_in_round: words[4],
  };
}
function validateRows(rows, report) {
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
      "head",
      "raw",
      "code",
      "errors",
    ]);
    if (
      row.branch !== (i < 2 ? "baseline" : "candidate") ||
      row.phase !== (i % 2 ? "after" : "before")
    )
      fail("phase binding");
    const raw = object(row.raw),
      code = object(row.code);
    if (
      Object.keys(raw).some((k) => !FIELDS.includes(k)) ||
      Object.keys(code).some((k) => !["oracle_code", "source_code"].includes(k))
    )
      fail("query shape");
    const decoded = Object.fromEntries(
      Object.entries(raw).map(([name, value]) => [name, decode(name, value)]),
    );
    for (const input of Object.values(code)) {
      const identity = exact(input, ["bytes", "sha256"]);
      if (
        typeof identity.bytes !== "number" ||
        !Number.isSafeInteger(identity.bytes) ||
        identity.bytes < 0 ||
        identity.bytes > 65536 ||
        typeof identity.sha256 !== "string" ||
        !/^[0-9a-f]{64}$/.test(identity.sha256)
      )
        fail("code identity");
    }
    if (!Array.isArray(row.errors) || row.errors.length > 9)
      fail("error limit");
    const failed = new Set();
    for (const input of row.errors) {
      const error = object(input);
      exact(
        error,
        error.category === "rpc_error"
          ? ["query", "category", "diagnostics"]
          : ["query", "category"],
      );
      if (
        !QUERIES.includes(error.query) ||
        failed.has(error.query) ||
        !["rpc_error", "invalid_response", "unavailable"].includes(
          error.category,
        )
      )
        fail("diagnostic");
      failed.add(error.query);
      if (error.category === "rpc_error") {
        const diag = exact(error.diagnostics, ["code", "method"]);
        const method =
          error.query === "head"
            ? "eth_getBlockByNumber"
            : error.query.endsWith("_code")
              ? "eth_getCode"
              : "eth_call";
        if (
          !RPC_CODES.includes(diag.code) ||
          (diag.method !== null && diag.method !== method)
        )
          fail("RPC metadata");
      }
    }
    const available = new Set([...Object.keys(raw), ...Object.keys(code)]);
    if (row.head !== null) {
      const head = exact(row.head, ["number", "hash", "timestamp"]);
      const timestamp = integer(head.timestamp);
      hex(head.hash, 32);
      if (
        timestamp < 0n ||
        timestamp >= 2n ** 64n ||
        integer(head.number) !==
          BigInt(report.source.parent.block_number + (i % 2)) ||
        (i % 2 === 0 && head.hash !== report.source.parent.block_hash) ||
        (i % 2 === 1 && timestamp !== BigInt(report.source.header.timestamp))
      )
        fail("parent/head/timestamp binding");
      available.add("head");
    }
    if (QUERIES.some((q) => available.has(q) === failed.has(q)))
      fail("query coverage");
    return decoded;
  });
}
function classification(rows, decoded, report) {
  const reasons = new Set();
  for (let i = 0; i < 4; i++) {
    const row = rows[i],
      values = decoded[i],
      feed = values.latest_round_data ?? {};
    if (
      row.errors.length ||
      Object.keys(values).length !== FIELDS.length ||
      row.head === null
    )
      reasons.add("incomplete_views");
    if ((values.source ?? ZERO) === ZERO) reasons.add("source_unavailable");
    if (values.base_currency !== ZERO || values.base_unit !== 100000000n)
      reasons.add("unsupported_currency_or_unit");
    if (
      (feed.answer ?? 0n) <= 0n ||
      (feed.round_id ?? 0n) <= 0n ||
      (feed.updated_at ?? 0n) <= 0n ||
      (feed.answered_in_round ?? 0n) < (feed.round_id ?? 0n) ||
      values.price !== feed.answer
    )
      reasons.add("feed_price_unproven");
    if (
      row.head === null ||
      ["started_at", "updated_at"].some(
        (k) => (feed[k] ?? 0n) > integer(row.head.timestamp),
      )
    )
      reasons.add("feed_timestamp_unproven");
    if ((values.aggregator ?? ZERO) === ZERO)
      reasons.add("aggregator_unavailable");
    if (
      Object.keys(row.code).length !== 2 ||
      Object.values(row.code).some((v) => object(v).bytes === 0)
    )
      reasons.add("code_unavailable");
  }
  if (rows.slice(1).some((row) => !equal(row.code, rows[0].code)))
    reasons.add("code_identity_changed");
  if (decoded.slice(1).some((v) => v.aggregator !== decoded[0].aggregator))
    reasons.add("aggregator_changed");
  if (decoded.slice(1).some((v) => v.source !== decoded[0].source))
    reasons.add("source_changed");
  if (!equal(decoded[0], decoded[2])) reasons.add("initial_views_differ");
  if (!equal(rows[0].head, rows[2].head)) reasons.add("initial_heads_differ");
  const complete = reasons.size === 0;
  return {
    complete_price_views: complete,
    baseline_receipts_verified: report.baseline_verified,
    unproven_reasons: [...reasons].sort(),
    baseline_price: complete ? decoded[1].price : null,
    candidate_price: complete ? decoded[3].price : null,
    price_difference: complete ? decoded[3].price - decoded[1].price : null,
  };
}
/** @param {string} text */
export async function validateObservedTrace(text) {
  const wrapper = exact(parseObservationJSON(text), [
    "observation_version",
    "profile",
    "trace_report",
    "trace_artifact_id",
    "observations",
    "classification",
    "scope",
    "artifact_id",
  ]);
  if (
    wrapper.observation_version !== "0.1.0" ||
    wrapper.profile !== "aave-v3-ethereum-weth-price" ||
    wrapper.scope !== OBSERVATION_SCOPE
  )
    fail("version/profile/scope");
  const trace = await validateTraceReport(wrapper.trace_report);
  if (wrapper.trace_artifact_id !== trace.report.artifact_id)
    fail("nested trace identity");
  const phases = validateRows(wrapper.observations, wrapper.trace_report);
  const result = classification(
    wrapper.observations,
    phases,
    wrapper.trace_report,
  );
  if (!equal(wrapper.classification, result)) fail("declared classification");
  if (
    typeof wrapper.artifact_id !== "string" ||
    !/^[0-9a-f]{64}$/.test(wrapper.artifact_id)
  )
    fail("artifact identity");
  const { artifact_id, ...body } = wrapper;
  const digest = async (runtimeFloat) => {
    const canonical = observationCanonical(body, runtimeFloat);
    if (new TextEncoder().encode(canonical).byteLength > MAX_TRACE_BYTES)
      fail("8 MiB canonical limit");
    return Array.from(
      new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(canonical),
        ),
      ),
      (b) => b.toString(16).padStart(2, "0"),
    ).join("");
  };
  if (
    (await digest(true)) !== artifact_id &&
    (await digest(false)) !== artifact_id
  )
    fail("wrapper content hash mismatch");
  return { wrapper, trace, phases, classification: result };
}
