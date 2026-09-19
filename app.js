"use strict";
/** @param {string} id */
function $(id) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing interface element: ${id}`);
  return element;
}
/** @param {unknown} value @returns {Record<string, unknown>} */
function record(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid report object.");
  return /** @type {Record<string, unknown>} */ (value);
}
const allowedSamples = new Set([
  "liquidity-shock",
  "recovery-trap",
  "depeg-stress",
  "ethereum-uniswap-slippage",
]);
let generation = 0;
// The backend canonicalizes JSON with sorted keys and ensure_ascii=True.
/** @param {unknown} value @returns {string} */
function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value !== null && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map((k) => canonical(k) + ":" + canonical(record(value)[k]))
        .join(",") +
      "}"
    );
  if (typeof value === "number" && !Number.isFinite(value))
    throw new Error("Invalid JSON number.");
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error("Invalid JSON value.");
  return serialized.replace(
    /[\u0080-\uffff]/g,
    (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"),
  );
}
/** @param {unknown} input */
async function checkHash(input) {
  const report = record(input);
  if (
    report.schema_version !== "0.1.0" ||
    typeof report.artifact_id !== "string" ||
    !/^[a-f0-9]{64}$/.test(report.artifact_id)
  )
    throw new Error("Unsupported schema or missing hash.");
  const { artifact_id, ...body } = report;
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical(body)),
  );
  const actual = Array.from(new Uint8Array(hash), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  if (actual !== artifact_id)
    throw new Error(
      "Content hash mismatch. The result was changed or damaged.",
    );
}
/** @param {unknown} value */
function finite(value) {
  if (
    typeof value !== "string" ||
    value.length > 100 ||
    value.trim() !== value ||
    !/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(value) ||
    !Number.isFinite(Number(value))
  )
    throw new Error("Invalid metric.");
  return Number(value);
}
/** @param {unknown} value @param {number} [digits] */
function fmt(value, digits = 2) {
  return finite(value).toLocaleString("en-US", {
    maximumFractionDigits: digits,
  });
}
/** @param {unknown} value */
function rawInteger(value) {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    !/^-?(0|[1-9][0-9]{0,79})$/.test(value)
  )
    throw new Error("Invalid raw integer.");
  return value;
}
/** @param {unknown} input @param {unknown} decimals */
function tokenUnits(input, decimals) {
  const value = rawInteger(input);
  if (
    typeof decimals !== "number" ||
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 36
  )
    throw new Error("Invalid token decimals.");
  const negative = value.startsWith("-"),
    digits = (negative ? value.slice(1) : value).padStart(decimals + 1, "0");
  return (
    (negative ? "-" : "") +
    (decimals
      ? digits.slice(0, -decimals) + "." + digits.slice(-decimals)
      : digits)
  );
}
/** @param {unknown} input */
function evmViewModel(input) {
  const report = record(input);
  if (report.mode !== "evm-local" && report.mode !== "evm-fork")
    throw new Error("Unsupported EVM report.");
  if (
    record(record(report.scenario).provenance).kind !==
    (report.mode === "evm-fork" ? "historical-fork" : "local-evm")
  )
    throw new Error("Invalid EVM provenance.");
  const source = report.source === undefined ? null : record(report.source);
  const baseline = record(report.baseline),
    candidate = record(report.candidate);
  const bm = record(baseline.metrics),
    cm = record(candidate.metrics);
  if (
    report.mode === "evm-fork" &&
    (source === null ||
      typeof source.chain_id !== "number" ||
      !Number.isSafeInteger(source.chain_id) ||
      source.chain_id < 1 ||
      typeof source.block_number !== "number" ||
      !Number.isSafeInteger(source.block_number) ||
      source.block_number < 1 ||
      typeof source.block_hash !== "string" ||
      !/^0x[0-9a-fA-F]{64}$/.test(source.block_hash))
  )
    throw new Error("Missing historical source pin.");
  const rows = [],
    traces = [];
  for (const key of [
    "initial_balance_wei",
    "final_balance_wei",
    "balance_delta_wei",
    "gas_used",
  ]) {
    rows.push([
      key.replaceAll("_", " "),
      rawInteger(bm[key]),
      rawInteger(cm[key]),
    ]);
  }
  if (bm.gas_cost_wei !== undefined || cm.gas_cost_wei !== undefined)
    rows.push([
      "Gas cost (wei)",
      rawInteger(bm.gas_cost_wei),
      rawInteger(cm.gas_cost_wei),
    ]);
  for (const { name, branch } of [
    { name: "Baseline", branch: baseline },
    { name: "Candidate", branch: candidate },
  ]) {
    if (
      !Array.isArray(branch.trace) ||
      branch.trace.length < 1 ||
      branch.trace.length > 32
    )
      throw new Error("Invalid EVM trace.");
    for (const inputStep of branch.trace) {
      const step = record(inputStep);
      if (
        typeof step.step !== "number" ||
        !Number.isInteger(step.step) ||
        step.step < 0 ||
        step.step > 31 ||
        typeof step.status !== "string" ||
        !["noop", "success", "reverted", "rejected"].includes(step.status)
      )
        throw new Error("Invalid EVM step.");
      traces.push([
        name,
        String(step.step),
        step.status,
        rawInteger(step.gas_used),
        rawInteger(step.actor_balance_wei),
      ]);
    }
  }
  const bt = baseline.tokens ?? [],
    ct = candidate.tokens ?? [];
  if (
    !Array.isArray(bt) ||
    !Array.isArray(ct) ||
    bt.length !== ct.length ||
    bt.length > 8
  )
    throw new Error("Invalid token observations.");
  const seen = new Set();
  for (let i = 0; i < bt.length; i++) {
    const b = record(bt[i]),
      c = record(ct[i]);
    if (
      typeof b.address !== "string" ||
      typeof c.address !== "string" ||
      !/^0x[0-9a-fA-F]{40}$/.test(b.address) ||
      b.address.toLowerCase() !== c.address.toLowerCase() ||
      seen.has(b.address.toLowerCase()) ||
      b.decimals !== c.decimals ||
      typeof b.symbol !== "string" ||
      !/^[A-Z0-9_-]{1,12}$/.test(b.symbol) ||
      b.symbol !== c.symbol
    )
      throw new Error("Mismatched token metadata.");
    seen.add(b.address.toLowerCase());
    rows.push([
      b.symbol + " final token units",
      tokenUnits(b.final_balance_raw, b.decimals),
      tokenUnits(c.final_balance_raw, c.decimals),
    ]);
    rows.push([
      b.symbol + " change in raw units",
      rawInteger(b.balance_delta_raw),
      rawInteger(c.balance_delta_raw),
    ]);
  }
  return {
    rows,
    traces,
    source: source
      ? `Chain ${source.chain_id} · Block ${source.block_number}\n${source.block_hash}`
      : "Local disposable chain; no historical source",
  };
}
/** @param {string} id @param {string[][]} rows @param {boolean} [rowHeaders] */
function tableRows(id, rows, rowHeaders = false) {
  $(id).replaceChildren();
  for (const row of rows) {
    const tr = document.createElement("tr");
    row.forEach((value, index) => {
      const cell = document.createElement(
        rowHeaders && index === 0 ? "th" : "td",
      );
      if (rowHeaders && index === 0) cell.scope = "row";
      cell.textContent = value;
      tr.appendChild(cell);
    });
    $(id).appendChild(tr);
  }
}
/** @param {string} message */
function setError(message) {
  $("report-status").textContent = message;
  $("report-status").classList.add("error");
  ["baseline-value", "candidate-value", "delta-value", "hash"].forEach(
    (id) => ($(id).textContent = "—"),
  );
  $("baseline-line").setAttribute("points", "");
  $("candidate-line").setAttribute("points", "");
  $("metric-table").hidden = true;
  $("metric-rows").replaceChildren();
  $("assumptions").replaceChildren();
  $("raw-report").textContent = "";
  $("download").hidden = true;
  $("evm-details").hidden = true;
  $("evm-traces").replaceChildren();
  $("source-pin").textContent = "";
  $("fixture-chart").hidden = true;
  $("equity-rows").replaceChildren();
  $("chart-description").textContent = "";
}
/** @param {unknown} input @param {number} seq */
async function render(input, seq) {
  const report = record(input);
  await checkHash(report);
  if (seq !== generation) return;
  const baseline = record(report.baseline),
    candidate = record(report.candidate);
  const bm = record(baseline.metrics),
    cm = record(candidate.metrics);
  const comparison = record(report.comparison);
  const scenario = record(report.scenario);
  const evm = report.mode !== "fixture";
  $("fixture-chart").hidden = evm;
  $("evm-details").hidden = !evm;
  $("baseline-label").textContent = evm ? "Baseline actions" : "Hold baseline";
  $("candidate-label").textContent = evm
    ? "Changed actions"
    : "Circuit-breaker policy";
  $("baseline-unit").textContent = $("candidate-unit").textContent = evm
    ? "Approximate native balance (ETH)"
    : "Final model equity";
  $("delta-unit").textContent = evm
    ? "Approximate ETH; not profit"
    : "Model quote units, not USD";
  if (evm) {
    const view = evmViewModel(report);
    $("baseline-value").textContent = Number(
      tokenUnits(bm.final_balance_wei, 18),
    ).toFixed(6);
    $("candidate-value").textContent = Number(
      tokenUnits(cm.final_balance_wei, 18),
    ).toFixed(6);
    $("delta-value").textContent = Number(
      tokenUnits(comparison.final_balance_delta_wei, 18),
    ).toFixed(6);
    tableRows("metric-rows", view.rows, true);
    tableRows("evm-traces", view.traces);
    $("equity-rows").replaceChildren();
    $("chart-description").textContent = "";
    $("source-pin").textContent = view.source;
  } else {
    if (record(record(report.scenario).provenance).kind !== "synthetic")
      throw new Error("A fixture must be labelled synthetic.");
    const b = baseline,
      c = candidate;
    if (
      !Array.isArray(b?.trace) ||
      !Array.isArray(c?.trace) ||
      b.trace.length !== c.trace.length ||
      b.trace.length < 2 ||
      b.trace.length > 4096
    )
      throw new Error("Invalid trace.");
    const bt = b.trace.map(record),
      ct = c.trace.map(record);
    const yb = bt.map((x) => finite(x.equity)),
      yc = ct.map((x) => finite(x.equity));
    const values = [...yb, ...yc],
      min = Math.min(...values),
      max = Math.max(...values),
      spread = max - min || 1;
    /** @param {number[]} ys */
    function line(ys) {
      return ys
        .map(
          (y, i) =>
            `${45 + (i / (ys.length - 1)) * 925},${210 - ((y - min) / spread) * 165}`,
        )
        .join(" ");
    }
    $("baseline-line").setAttribute("points", line(yb));
    $("candidate-line").setAttribute("points", line(yc));
    $("chart-description").textContent =
      `${yb.length} observations, in recorded order. Dashed line: baseline. Solid line: candidate. Open Equity values by observation for every exact value.`;
    tableRows(
      "equity-rows",
      bt.map((point, i) => [
        String(i + 1),
        String(point.equity),
        String(ct[i].equity),
      ]),
      true,
    );
    $("baseline-value").textContent = fmt(bm.final_equity);
    $("candidate-value").textContent = fmt(cm.final_equity);
    const delta = finite(comparison.final_equity_delta);
    $("delta-value").textContent =
      (delta > 0 ? "+" : "") + fmt(comparison.final_equity_delta);
    $("metric-rows").replaceChildren();
    for (const [label, key, suffix] of [
      ["Model return", "return_pct", "%"],
      ["Maximum drawdown", "max_drawdown_pct", "%"],
      ["Fees (quote units)", "fees", ""],
      ["Number of trades", "trades", ""],
    ]) {
      const tr = document.createElement("tr");
      [
        label,
        key === "trades" ? String(bm[key]) : fmt(bm[key]) + suffix,
        key === "trades" ? String(cm[key]) : fmt(cm[key]) + suffix,
      ].forEach((text, index) => {
        const cell = document.createElement(index === 0 ? "th" : "td");
        if (index === 0) cell.scope = "row";
        cell.textContent = text;
        tr.appendChild(cell);
      });
      $("metric-rows").appendChild(tr);
    }
  }
  if (!Array.isArray(report.assumptions) || report.assumptions.length > 32)
    throw new Error("Invalid assumptions.");
  $("assumptions").replaceChildren();
  for (const text of report.assumptions) {
    if (typeof text !== "string" || text.length > 4000)
      throw new Error("Invalid assumption.");
    const li = document.createElement("li");
    li.textContent = text;
    $("assumptions").appendChild(li);
  }
  $("hash").textContent = String(report.artifact_id);
  $("raw-report").textContent = JSON.stringify(report, null, 2);
  $("report-status").classList.remove("error");
  $("report-status").textContent =
    "Integrity verified locally · " +
    (evm
      ? report.mode === "evm-fork"
        ? "Archived-state actions; not historical replay"
        : "Local EVM actions"
      : "Synthetic fixture") +
    " · " +
    String(scenario.title).slice(0, 120);
  $("metric-table").hidden = false;
  $("download").hidden = false;
}
async function loadSample() {
  const seq = ++generation;
  const selection = $("scenario");
  if (!("value" in selection) || typeof selection.value !== "string")
    throw new Error("Missing scenario selector.");
  const name = selection.value;
  if (!allowedSamples.has(name)) return;
  try {
    const response = await fetch("reports/" + name + ".json");
    if (!response.ok)
      throw new Error("The recorded sample could not be loaded.");
    const text = await response.text();
    if (text.length > 4 * 1024 * 1024) throw new Error("Report too large.");
    await render(JSON.parse(text), seq);
    if (seq === generation)
      $("download").setAttribute("href", "reports/" + name + ".json");
  } catch (error) {
    if (seq === generation)
      setError(
        error instanceof Error ? error.message : "Could not load this report.",
      );
  }
}
$("scenario").addEventListener("change", loadSample);
$("import").addEventListener("change", async (event) => {
  if (!(event.target instanceof HTMLInputElement)) return;
  const file = event.target.files?.[0];
  if (!file) return;
  const seq = ++generation;
  try {
    if (file.size > 4 * 1024 * 1024)
      throw new Error("Local report limit is 4 MiB.");
    await render(JSON.parse(await file.text()), seq);
    // No blob links or network upload are needed for an already-local file.
    if (seq === generation) $("download").hidden = true;
  } catch (error) {
    if (seq === generation)
      setError(error instanceof Error ? error.message : "Invalid report file.");
  }
});
loadSample();
