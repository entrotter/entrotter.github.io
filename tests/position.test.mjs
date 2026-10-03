import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  parseObservationJSON,
  observationCanonical,
} from "../observed-trace.mjs";
import {
  validatePositionReport,
  decodeAccount,
  exactUnits,
} from "../position-report.mjs";

const source = readFileSync(
  new URL("../reports/aave-account-impact13.json", import.meta.url),
  "utf8",
);
const sample = () => parseObservationJSON(source);
function seal(row) {
  const { artifact_id, ...body } = row;
  row.artifact_id = createHash("sha256")
    .update(observationCanonical(body))
    .digest("hex");
  return observationCanonical(row);
}
function words(values) {
  return (
    "0x" +
    values.map((value) => BigInt(value).toString(16).padStart(64, "0")).join("")
  );
}
test("recorded13 account wrapper retains full original trace, four views and six exact deltas", async () => {
  assert.equal(
    createHash("sha256").update(source).digest("hex"),
    "cd96e04c837fa1dcc6b6cf009d58adffe3ffdaebc9fbd5b3b900d71cd2912978",
  );
  const view = await validatePositionReport(source);
  assert.equal(view.trace.baseline.matches, true);
  assert.equal(view.trace.inputs.length, 13);
  assert.equal(view.classification.complete_account_views, true);
  assert.equal(
    view.classification.differences.available_borrows_base,
    81628966124n,
  );
  assert.equal(
    view.classification.differences.health_factor_wad,
    3852169807877337n,
  );
  assert.deepEqual(view.classification.differences, {
    total_collateral_base: 126525897974n,
    total_debt_base: 20224381745n,
    available_borrows_base: 81628966124n,
    liquidation_threshold_bps: 0n,
    ltv_bps: 0n,
    health_factor_wad: 3852169807877337n,
  });
  assert.deepEqual(
    view.phases.map((row) => row.values),
    view.wrapper.observations.map((row) => decodeAccount(row.raw)),
  );
  assert.deepEqual(
    view.phases.map((row) => row.head),
    view.observed.wrapper.observations.map((row) => row.head),
  );
  assert.equal(view.observed.classification.price_difference, 789973126n);
  assert.equal(
    exactUnits(view.classification.differences.available_borrows_base, 8),
    "816.28966124",
  );
  assert.equal(
    exactUnits(view.classification.differences.health_factor_wad, 18),
    "0.003852169807877337",
  );
});

/** @type {Array<[string, (row: any) => void]>} */
const contradictions = [
  [
    "profile",
    (r) => {
      r.profile = "arbitrary-callback";
    },
  ],
  [
    "scope",
    (r) => {
      r.scope = "Verified profit";
    },
  ],
  [
    "extra plan selector",
    (r) => {
      r.plan.selector = "0x12345678";
    },
  ],
  [
    "zero account",
    (r) => {
      r.plan.account = "0x" + "00".repeat(20);
    },
  ],
  [
    "foreign trace plan",
    (r) => {
      r.plan.trace.skip_indices = [0];
    },
  ],
  [
    "row account",
    (r) => {
      r.observations[0].account = "0x" + "11".repeat(20);
    },
  ],
  [
    "phase order",
    (r) => {
      r.observations.reverse();
    },
  ],
  [
    "head binding",
    (r) => {
      r.observations[1].head.number += 1;
    },
  ],
  [
    "short account ABI",
    (r) => {
      r.observations[1].raw = "0x1234";
    },
  ],
  [
    "threshold",
    (r) => {
      r.observations[1].raw = words([1, 1, 1, 10001, 1, 1]);
    },
  ],
  [
    "bad padded address",
    (r) => {
      r.observations[1].provider = "0x01" + "00".repeat(31);
    },
  ],
  [
    "missing diagnostic",
    (r) => {
      r.observations[1].raw = null;
    },
  ],
  [
    "available plus failed",
    (r) => {
      r.observations[1].errors = [
        { query: "account_data", category: "invalid_response" },
      ];
    },
  ],
  [
    "diagnostic category",
    (r) => {
      r.observations[1].raw = null;
      r.observations[1].errors = [
        { query: "account_data", category: "unavailable" },
      ];
    },
  ],
  [
    "wrong RPC method",
    (r) => {
      r.observations[1].raw = null;
      r.observations[1].errors = [
        {
          query: "account_data",
          category: "rpc_error",
          diagnostics: { code: "timeout", method: "eth_sendRawTransaction" },
        },
      ];
    },
  ],
  [
    "class delta",
    (r) => {
      r.classification.differences.available_borrows_base += 1;
    },
  ],
  [
    "zero debt false health",
    (r) => {
      r.observations[1].raw = words([1, 0, 1, 1, 1, 0]);
    },
  ],
  [
    "nested price seal",
    (r) => {
      r.price_report.artifact_id = "0".repeat(64);
    },
  ],
  [
    "nested trace seal",
    (r) => {
      r.price_report.trace_report.artifact_id = "0".repeat(64);
    },
  ],
];
for (const [name, mutate] of contradictions) {
  test(`resealed account contradiction rejected: ${name}`, async () => {
    const row = sample();
    mutate(row);
    await assert.rejects(validatePositionReport(seal(row)));
  });
}
test("exact values beyond Number precision and zero-debt sentinels decode without rounding", () => {
  const value = decodeAccount(
    words([2n ** 200n, 0, 2n ** 199n, 8300, 8050, 2n ** 256n - 1n]),
  );
  assert.equal(value.total_collateral_base, 2n ** 200n);
  assert.equal(value.health_factor_wad, 2n ** 256n - 1n);
  assert.equal(
    exactUnits(-(2n ** 200n), 8),
    "−16069380442589902755419620923411626025222029937827928.35301376",
  );
  assert.equal(exactUnits(null, 8), "Unavailable");
});
test("duplicate keys, non-integer account values, oversize input and invalid outer hashes reject", async () => {
  await assert.rejects(
    validatePositionReport(
      source.replace(
        '"position_version": "0.1.0"',
        '"position_version": "0.1.0", "position_version": "0.1.0"',
      ),
    ),
  );
  await assert.rejects(
    validatePositionReport(
      source.replace(
        '"total_collateral_base": 41049031017510',
        '"total_collateral_base": 1.5',
      ),
    ),
  );
  await assert.rejects(validatePositionReport(" ".repeat(8 * 1024 * 1024 + 1)));
  const row = sample();
  row.artifact_id = "0".repeat(64);
  await assert.rejects(validatePositionReport(observationCanonical(row)));
});
test("account controls and sample button are wired into the historical panel", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /id="trace-account-sample"/);
  assert.match(html, /id="trace-account-results"/);
});

const controls = parseObservationJSON(
  readFileSync(new URL("data/position-controls.json", import.meta.url), "utf8"),
);
for (const control of controls) {
  test(`standalone SDK-sealed synthetic account control: ${control.name}`, async () => {
    const row = sample();
    Object.assign(row, control);
    delete row.name;
    const view = await validatePositionReport(observationCanonical(row));
    assert.equal(
      observationCanonical(view.classification),
      observationCanonical(control.classification),
    );
    if (control.name === "large_integer") {
      assert.equal(
        view.classification.candidate.total_collateral_base,
        2n ** 200n + 1n,
      );
      assert.equal(view.classification.differences.total_collateral_base, 1n);
    } else if (
      control.name === "no_debt" ||
      control.name === "debt_transition"
    ) {
      assert.equal(view.classification.baseline_health_status, "no_debt");
      assert.equal(view.classification.differences.health_factor_wad, null);
    } else if (control.name === "health_boundary") {
      assert.equal(view.classification.baseline_health_status, "below_one");
      assert.equal(
        view.classification.candidate_health_status,
        "at_or_above_one",
      );
    } else {
      assert.equal(view.classification.complete_account_views, false);
      assert.ok(view.classification.unproven_reasons.length > 0);
      assert.ok(
        Object.values(view.classification.differences).every(
          (value) => value === null,
        ),
      );
    }
  });
}
