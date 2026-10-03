import { MAX_TRACE_BYTES, validateTraceReport } from "./trace-report.mjs";
import { traceComparison } from "./trace-comparison.mjs";
import { validateObservedTrace } from "./observed-trace.mjs";
import {
  ACCOUNT_FIELDS,
  exactUnits,
  validatePositionReport,
} from "./position-report.mjs";

/** @param {string} id */
function element(id) {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing trace interface: ${id}`);
  return node;
}
let generation = 0;
function clear() {
  element("trace-results").hidden = true;
  for (const id of [
    "trace-pins",
    "trace-inputs",
    "trace-outcomes",
    "trace-receipts",
    "trace-assumptions",
    "trace-raw",
    "trace-hash",
    "trace-origin",
    "trace-comparison-summary",
    "trace-case",
    "trace-price-summary",
    "trace-price-rows",
    "trace-price-identities",
    "trace-account-summary",
    "trace-account-capacity-delta",
    "trace-account-health-delta",
    "trace-account-comparison",
    "trace-account-rows",
    "trace-account-identities",
  ])
    element(id).replaceChildren();
  element("trace-download").hidden = true;
  element("trace-download").removeAttribute("href");
  element("trace-price-results").hidden = true;
  element("trace-account-results").hidden = true;
}
function status(text, error = false) {
  element("trace-status").textContent = text;
  element("trace-status").classList.toggle("error", error);
}
function rows(id, values) {
  const target = element(id);
  for (const valuesRow of values) {
    const tr = document.createElement("tr");
    valuesRow.forEach((text, index) => {
      const cell = document.createElement(index ? "td" : "th");
      if (cell instanceof HTMLTableCellElement && index === 0)
        cell.scope = "row";
      cell.textContent = String(text);
      tr.append(cell);
    });
    target.append(tr);
  }
}
function gas(receipt) {
  return receipt ? BigInt(receipt.gasUsed).toString() : "—";
}
function logs(receipt) {
  return receipt ? String(receipt.logs.length) : "—";
}
function outcome(row) {
  return row.status === "nonce_conflict"
    ? `nonce_conflict · expected ${row.expected_nonce}, original ${row.original_nonce}`
    : row.status === "executed"
      ? `executed · ${row.receipt.status === "0x1" ? "success" : "revert"}`
      : row.status;
}
/** @param {string} text @param {number} seq @param {string | null} recorded */
async function render(text, seq, recorded) {
  const input = JSON.parse(text);
  const position =
    input &&
    typeof input === "object" &&
    Object.hasOwn(input, "position_version")
      ? await validatePositionReport(text)
      : null;
  const observed = position
    ? position.observed
    : input &&
        typeof input === "object" &&
        Object.hasOwn(input, "observation_version")
      ? await validateObservedTrace(text)
      : null;
  const view = observed ? observed.trace : await validateTraceReport(input);
  if (seq !== generation) return;
  const {
    report,
    pin,
    parent,
    header,
    inputs,
    baseline,
    candidate,
    assumptions,
  } = view;
  const comparisons = candidate.rows.map(traceComparison);
  element("trace-case").textContent =
    `Loaded prefix: ${inputs.length} original transactions · through_index ${inputs.length - 1} · ` +
    `skip_indices ${JSON.stringify(/** @type {Record<string, unknown>} */ (report.plan).skip_indices)}`;
  element("trace-comparison-summary").textContent =
    "Candidate vs original projected receipts: " +
    `${comparisons.filter((r) => r.kind === "omitted").length} omitted · ` +
    `${comparisons.filter((r) => r.kind === "structural").length} position / cumulative gas only · ` +
    `${comparisons.filter((r) => r.kind === "execution").length} execution receipt differences · ` +
    `${comparisons.filter((r) => r.kind === "identical").length} exact original receipt matches · ` +
    `${comparisons.filter((r) => r.kind === "unavailable").length} unavailable receipts.`;
  element("trace-origin").textContent = recorded
    ? position
      ? "Recorded read-only account case · exact Engine88c6 default-Docker13-of-181 / omission12 result. The page inspects recorded bytes; it runs no EVM or model."
      : observed
        ? "Recorded read-only price case · exact engine #35 native 32-of-181 / omission 12 result. The page inspects recorded bytes; it runs no EVM or model."
        : "Recorded technical case · exact engine #30 Docker report. Different native/Docker environments are not a speed comparison."
    : "Local import · author and execution provenance are not authenticated. This file remains in your browser.";
  element("trace-pins").textContent = JSON.stringify(
    {
      source: pin,
      parent,
      header,
      through_index: inputs.length - 1,
      skip_indices: /** @type {Record<string, unknown>} */ (report.plan)
        .skip_indices,
      baseline_verified: baseline.matches,
      candidate_matches_original_receipts: candidate.matches,
      runtime_seconds: report.runtime_seconds,
      baseline_anvil: baseline.anvil_version,
      candidate_anvil: candidate.anvil_version,
    },
    null,
    2,
  );
  rows(
    "trace-inputs",
    inputs.map((tx) => [
      tx.index,
      tx.hash,
      tx.sender,
      tx.nonce,
      tx.signed.type,
      tx.signed.to ?? "Contract creation",
    ]),
  );
  rows(
    "trace-outcomes",
    inputs.map((tx, i) => [
      tx.index,
      `${gas(tx.original_receipt)} / ${logs(tx.original_receipt)}`,
      outcome(baseline.rows[i]),
      `${gas(baseline.rows[i].receipt)} / ${logs(baseline.rows[i].receipt)}`,
      outcome(candidate.rows[i]),
      `${gas(candidate.rows[i].receipt)} / ${logs(candidate.rows[i].receipt)}`,
      comparisons[i].label,
      candidate.rows[i].differing_fields.join(", ") || "—",
    ]),
  );
  inputs.forEach((tx, i) => {
    const details = document.createElement("details"),
      summary = document.createElement("summary"),
      pre = document.createElement("pre");
    summary.textContent = `Transaction ${i}: exact original, baseline and candidate receipt fields`;
    pre.textContent = JSON.stringify(
      {
        original: tx.original_receipt,
        baseline: baseline.rows[i].receipt,
        baseline_differing_fields: baseline.rows[i].differing_fields,
        candidate: candidate.rows[i].receipt,
        candidate_differing_fields: candidate.rows[i].differing_fields,
      },
      null,
      2,
    );
    pre.tabIndex = 0;
    pre.setAttribute("role", "region");
    pre.setAttribute("aria-label", `Transaction ${i} exact receipt comparison`);
    details.append(summary, pre);
    element("trace-receipts").append(details);
  });
  for (const assumption of assumptions) {
    const li = document.createElement("li");
    li.textContent = assumption;
    element("trace-assumptions").append(li);
  }
  if (observed) {
    const result = observed.classification;
    const format = (value) => {
      const n = BigInt(value),
        negative = n < 0n;
      const digits = (negative ? -n : n).toString().padStart(9, "0");
      return (
        (negative ? "−" : "") + digits.slice(0, -8) + "." + digits.slice(-8)
      );
    };
    element("trace-price-summary").textContent = result.complete_price_views
      ? `Complete read-only price views · baseline after USD ${format(result.baseline_price)} · candidate after USD ${format(result.candidate_price)} · candidate − baseline USD ${format(result.price_difference)}. This is a price difference, not profit or a trading result.`
      : `UNPROVEN price comparison · ${result.unproven_reasons.join(", ")}. No validated price difference is available.`;
    rows(
      "trace-price-rows",
      observed.wrapper.observations.map((row, i) => [
        row.branch,
        row.phase,
        observed.phases[i].price ?? "Unavailable",
        typeof observed.phases[i].latest_round_data === "object"
          ? observed.phases[i].latest_round_data.answer
          : "Unavailable",
        row.head?.number ?? "Unavailable",
        row.head?.timestamp ?? "Unavailable",
        row.errors
          .map((error) => `${error.query}: ${error.category}`)
          .join(", ") || "None",
      ]),
    );
    rows(
      "trace-price-identities",
      observed.wrapper.observations.map((row, i) => [
        `${row.branch} / ${row.phase}`,
        observed.phases[i].source ?? "Unavailable",
        observed.phases[i].aggregator ?? "Unavailable",
        observed.phases[i].base_currency ?? "Unavailable",
        observed.phases[i].base_unit ?? "Unavailable",
        row.code.oracle_code?.sha256 ?? "Unavailable",
        row.code.source_code?.sha256 ?? "Unavailable",
      ]),
    );
    element("trace-price-results").hidden = false;
  }
  if (position) {
    const result = position.classification;
    const signed = (value, decimals) =>
      (value !== null && value > 0n ? "+" : "") + exactUnits(value, decimals);
    element("trace-account-capacity-delta").textContent = signed(
      result.differences.available_borrows_base,
      8,
    );
    element("trace-account-health-delta").textContent =
      result.complete_account_views &&
      result.differences.health_factor_wad === null
        ? "Not defined (no debt)"
        : signed(result.differences.health_factor_wad, 18);
    const healthLabel = (value) =>
      value === "at_or_above_one"
        ? "at or above 1"
        : value === "below_one"
          ? "below 1"
          : value === "no_debt"
            ? "no debt"
            : "unproven";
    element("trace-account-summary").textContent =
      `Account ${position.wrapper.plan.account} · ` +
      (result.complete_account_views
        ? `Complete read-only account views · baseline ${healthLabel(result.baseline_health_status)} · candidate ${healthLabel(result.candidate_health_status)}. Exact candidate − baseline deltas below; account changes include all prefix effects.`
        : `UNPROVEN account comparison · ${result.unproven_reasons.join(", ")}. No validated account difference is available.`);
    const labels = [
      "Collateral (USD)",
      "Debt (USD)",
      "Available borrowing capacity (USD)",
      "Liquidation threshold (%)",
      "Loan-to-value limit (%)",
      "Health factor (WAD / 10^18)",
    ];
    const show = (values, key) => {
      if (values === null) return "Unavailable";
      if (key === "health_factor_wad" && values.total_debt_base === 0n)
        return "No debt (uint256 sentinel)";
      const index = ACCOUNT_FIELDS.indexOf(key);
      return exactUnits(values[key], index < 3 ? 8 : index < 5 ? 2 : 18);
    };
    rows(
      "trace-account-comparison",
      ACCOUNT_FIELDS.map((key, i) => [
        labels[i],
        show(result.baseline, key),
        show(result.candidate, key),
        key === "health_factor_wad" &&
        result.complete_account_views &&
        result.differences[key] === null
          ? "Not defined (no debt)"
          : exactUnits(result.differences[key], i < 3 ? 8 : i < 5 ? 2 : 18),
      ]),
    );
    rows(
      "trace-account-rows",
      position.phases.map((row) => [
        `${row.branch} / ${row.phase}`,
        ...ACCOUNT_FIELDS.map((key) =>
          row.values === null ? "Unavailable" : row.values[key].toString(),
        ),
        row.errors
          .map((error) => `${error.query}: ${error.category}`)
          .join(", ") || "None",
      ]),
    );
    rows(
      "trace-account-identities",
      position.phases.map((row) => [
        `${row.branch} / ${row.phase}`,
        row.provider ?? "Unavailable",
        row.oracle ?? "Unavailable",
        row.pool_code?.sha256 ?? "Unavailable",
        row.head?.number ?? "Unavailable",
        row.head?.hash ?? "Unavailable",
      ]),
    );
    element("trace-account-results").hidden = false;
  }
  element("trace-raw").textContent = observed
    ? text
    : JSON.stringify(report, null, 2);
  element("trace-hash").textContent = String(
    position
      ? position.wrapper.artifact_id
      : observed
        ? observed.wrapper.artifact_id
        : report.artifact_id,
  );
  status(
    `Integrity and display consistency checked locally · baseline ${baseline.matches ? "matches all original projected receipts" : "UNVERIFIED: original projected receipts do not all match"}. This is not authenticity or EVM proof.`,
  );
  element("trace-results").hidden = false;
  if (recorded) {
    element("trace-download").setAttribute("href", recorded);
    element("trace-download").hidden = false;
  }
}
async function sample(path) {
  const seq = ++generation;
  clear();
  status("Loading the recorded signed-prefix case…");
  try {
    const response = await fetch(path);
    if (!response.ok)
      throw new Error("The signed-prefix example could not be loaded.");
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_TRACE_BYTES)
      throw new Error("Trace report limit is 8 MiB.");
    await render(text, seq, path);
  } catch (error) {
    if (seq === generation) {
      clear();
      status(
        error instanceof Error ? error.message : "Invalid trace report.",
        true,
      );
    }
  }
}
element("trace-sample").addEventListener("click", () =>
  sample("reports/trace-mainnet-prefix-four.json"),
);
element("trace-price-sample").addEventListener("click", () =>
  sample("reports/trace-observed-price32.json"),
);
element("trace-account-sample").addEventListener("click", () =>
  sample("reports/aave-account-impact13.json"),
);
element("trace-import").addEventListener("change", async (event) => {
  if (!(event.target instanceof HTMLInputElement)) return;
  const file = event.target.files?.[0];
  if (!file) return;
  const seq = ++generation;
  clear();
  status("Checking local replay, price or account report…");
  try {
    if (file.size > MAX_TRACE_BYTES)
      throw new Error("Local trace report limit is 8 MiB.");
    await render(await file.text(), seq, null);
  } catch (error) {
    if (seq === generation) {
      clear();
      status(
        error instanceof Error ? error.message : "Invalid trace report.",
        true,
      );
    }
  }
});
