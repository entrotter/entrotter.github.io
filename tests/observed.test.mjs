import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  parseObservationJSON,
  observationCanonical,
  validateObservedTrace,
} from "../observed-trace.mjs";

const source = readFileSync(
  new URL("../reports/trace-observed-price32.json", import.meta.url),
  "utf8",
);
const sample = () => parseObservationJSON(source);
const controls = parseObservationJSON(
  readFileSync(new URL("data/observed-controls.json", import.meta.url), "utf8"),
);
function seal(row) {
  const { artifact_id, ...body } = row;
  row.artifact_id = createHash("sha256")
    .update(observationCanonical(body))
    .digest("hex");
  return observationCanonical(row);
}

test("published supported native32 wrapper preserves all receipts and four exact prices", async () => {
  assert.equal(
    createHash("sha256").update(source).digest("hex"),
    "7010848300c353310fb78dab7f377daea4226633e49af3c1a384bcb3a579ba9d",
  );
  const view = await validateObservedTrace(source);
  assert.equal(view.trace.inputs.length, 32);
  assert.equal(view.trace.baseline.matches, true);
  assert.equal(view.classification.price_difference, 789973126n);
  assert.equal(view.classification.baseline_price, 256292441874n);
  assert.deepEqual(
    view.phases.map((v) => v.price),
    [257082415000n, 256292441874n, 257082415000n, 257082415000n],
  );
});

for (const control of controls) {
  test(`Python-engine-sealed synthetic ${control.name} control remains compatible`, async () => {
    const row = sample();
    Object.assign(row, {
      observations: control.observations,
      classification: control.classification,
      artifact_id: control.artifact_id,
    });
    const view = await validateObservedTrace(observationCanonical(row));
    assert.equal(
      observationCanonical(view.classification),
      observationCanonical(control.classification),
    );
    if (control.name === "large_integer") {
      assert.equal(view.classification.candidate_price, 2n ** 200n);
      assert.equal(view.classification.price_difference, 10n);
    } else {
      assert.equal(view.classification.complete_price_views, false);
      assert.equal(view.classification.price_difference, null);
      assert.ok(view.classification.unproven_reasons.length > 0);
    }
  });
}

/** @type {Array<[string, (row: any) => void]>} */
const contradictions = [
  [
    "wrong profile",
    (r) => {
      r.profile = "custom-code";
    },
  ],
  [
    "wrong version",
    (r) => {
      r.observation_version = "0.2.0";
    },
  ],
  [
    "wrong scope",
    (r) => {
      r.scope = "Profit proven";
    },
  ],
  [
    "nested identity",
    (r) => {
      r.trace_artifact_id = "0".repeat(64);
    },
  ],
  [
    "phase order",
    (r) => {
      r.observations.reverse();
    },
  ],
  [
    "unexpected selector",
    (r) => {
      r.observations[0].raw.custom = "0x00";
    },
  ],
  [
    "missing query coverage",
    (r) => {
      delete r.observations[0].raw.price;
    },
  ],
  [
    "available and failed query",
    (r) => {
      r.observations[0].errors.push({
        query: "price",
        category: "unavailable",
      });
    },
  ],
  [
    "ABI address padding",
    (r) => {
      r.observations[0].raw.source = "0x01" + "00".repeat(31);
    },
  ],
  [
    "round width",
    (r) => {
      r.observations[0].raw.latest_round_data = "0x" + "00".repeat(159);
    },
  ],
  [
    "round id overflow",
    (r) => {
      r.observations[0].raw.latest_round_data =
        "0x" +
        "ff".repeat(32) +
        r.observations[0].raw.latest_round_data.slice(66);
    },
  ],
  [
    "parent hash",
    (r) => {
      r.observations[0].head.hash = "0x" + "00".repeat(32);
    },
  ],
  [
    "post timestamp",
    (r) => {
      r.observations[1].head.timestamp++;
    },
  ],
  [
    "code bounds",
    (r) => {
      r.observations[0].code.oracle_code.bytes = 65537;
    },
  ],
  [
    "code digest grammar",
    (r) => {
      r.observations[0].code.oracle_code.sha256 =
        "<img src=x onerror=alert(1)>";
    },
  ],
  [
    "false price difference",
    (r) => {
      r.classification.price_difference++;
    },
  ],
  [
    "false completeness",
    (r) => {
      r.classification.complete_price_views = false;
    },
  ],
  [
    "extra classifier field",
    (r) => {
      r.classification.profit = 1;
    },
  ],
  [
    "nested receipt contradiction",
    (r) => {
      r.trace_report.baseline_verified = false;
    },
  ],
];
for (const [name, mutate] of contradictions) {
  test(`hash-resealed ${name} is rejected`, async () => {
    const row = sample();
    mutate(row);
    await assert.rejects(validateObservedTrace(seal(row)));
  });
}

test("checksum tampering, wrong RPC metadata and duplicate failures are rejected", async () => {
  const row = sample();
  row.artifact_id = "0".repeat(64);
  await assert.rejects(
    validateObservedTrace(observationCanonical(row)),
    /hash/,
  );
  const missing = controls.find((v) => v.name === "rpc_missing_head");
  for (const variant of ["method", "message", "duplicate"]) {
    const row = sample();
    Object.assign(row, structuredClone(missing));
    delete row.name;
    const error = row.observations[0].errors[0];
    if (variant === "method") error.diagnostics.method = "eth_sendTransaction";
    if (variant === "message") error.diagnostics.message = "secret";
    if (variant === "duplicate") row.observations[0].errors.push(error);
    await assert.rejects(validateObservedTrace(seal(row)));
  }
});

test("lossless JSON rejects malformed, ambiguous and unbounded input", () => {
  assert.equal(parseObservationJSON("9007199254740993"), 9007199254740993n);
  assert.equal(parseObservationJSON("-9007199254740993"), -9007199254740993n);
  for (const text of [
    '{"a":1,"a":2}',
    "[1,]",
    '{"a":}',
    "01",
    "1 trailing",
    "1.0",
    "1e0",
    "\u00a0null",
    '"unterminated',
    '{"runtime_seconds":1e999}',
    "[".repeat(34) + "0" + "]".repeat(34),
    "9".repeat(513),
  ])
    assert.throws(() => parseObservationJSON(text));
  assert.throws(
    () => parseObservationJSON(" ".repeat(8 * 1024 * 1024 + 1)),
    /limit/,
  );
  assert.equal(
    parseObservationJSON(JSON.stringify({ runtime_seconds: 1.5, text: '"\\' }))
      .text,
    '"\\',
  );
});
