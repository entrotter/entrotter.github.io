import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash, webcrypto } from "node:crypto";
import { traceCanonical, validateTraceReport } from "../trace-report.mjs";
import { traceComparison } from "../trace-comparison.mjs";

const sample = () =>
  JSON.parse(
    readFileSync(
      new URL("../reports/trace-mainnet-prefix-four.json", import.meta.url),
      "utf8",
    ),
  );
const oraclePrefix = () =>
  JSON.parse(
    readFileSync(
      new URL("data/trace-oracle-prefix-32.json", import.meta.url),
      "utf8",
    ),
  );

test("original native32 report distinguishes omission and structural receipt shifts", async () => {
  const view = await validateTraceReport(oraclePrefix());
  const comparisons = view.candidate.rows.map(traceComparison);
  assert.equal(comparisons.filter((r) => r.kind === "identical").length, 12);
  assert.equal(comparisons.filter((r) => r.kind === "omitted").length, 1);
  assert.equal(comparisons.filter((r) => r.kind === "structural").length, 19);
  assert.equal(comparisons.filter((r) => r.kind === "execution").length, 0);
  assert.deepEqual(comparisons[12].structuralFields, []);
  assert.deepEqual(comparisons[13].structuralFields.sort(), [
    "cumulativeGasUsed",
    "transactionIndex",
  ]);
  assert.equal(comparisons[13].label, "Position / cumulative gas only");
});

test("a coherently resealed gas change remains an execution difference beside shifts", async () => {
  const r = oraclePrefix();
  for (const o of r.candidate.outcomes.slice(13)) {
    o.receipt.cumulativeGasUsed = `0x${(BigInt(o.receipt.cumulativeGasUsed) + 1n).toString(16)}`;
  }
  const changed = r.candidate.outcomes[13];
  changed.receipt.gasUsed = `0x${(BigInt(changed.receipt.gasUsed) + 1n).toString(16)}`;
  changed.differing_fields.push("gasUsed");
  const view = await validateTraceReport(reseal(r));
  const comparison = traceComparison(view.candidate.rows[13]);
  assert.equal(comparison.kind, "execution");
  assert.deepEqual(comparison.executionFields, ["gasUsed"]);
  assert.deepEqual(comparison.structuralFields.sort(), [
    "cumulativeGasUsed",
    "transactionIndex",
  ]);
  assert.equal(traceComparison(view.candidate.rows[14]).kind, "structural");
});

test("unavailable receipts stay separate from omitted and unchanged receipts", async () => {
  const view = await validateTraceReport(sample());
  assert.equal(traceComparison(view.candidate.rows[0]).kind, "omitted");
  assert.equal(traceComparison(view.candidate.rows[3]).kind, "unavailable");
  assert.equal(
    traceComparison(view.candidate.rows[3]).label,
    "No candidate receipt",
  );
});
function reseal(r) {
  const { artifact_id, ...body } = r;
  r.artifact_id = createHash("sha256")
    .update(traceCanonical(body))
    .digest("hex");
  return r;
}
async function refuse(change) {
  const r = sample();
  change(r);
  await assert.rejects(
    validateTraceReport(reseal(r)),
    /Invalid transaction-prefix/,
  );
}
test("exact original Docker four-prefix and separate native one-prefix reports pass", async () => {
  const view = await validateTraceReport(sample());
  assert.equal(view.baseline.matches, true);
  assert.deepEqual(
    view.candidate.rows.map((o) => o.status),
    ["skipped", "executed", "executed", "nonce_conflict"],
  );
  assert.equal(
    BigInt(String(view.candidate.rows[1].receipt?.gasUsed)),
    245136n,
  );
  const one = JSON.parse(
    readFileSync(
      new URL("data/trace-mainnet-prefix-one.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal((await validateTraceReport(one)).inputs.length, 1);
});
test("unverified rejected and unmined baselines are honestly displayable", async () => {
  for (const status of ["rejected", "not_mined"]) {
    const r = sample(),
      old = r.baseline.outcomes[3];
    r.baseline.outcomes[3] = { index: old.index, hash: old.hash, status };
    r.baseline.matches_original_receipts = false;
    r.baseline_verified = false;
    assert.equal(
      (await validateTraceReport(reseal(r))).baseline.matches,
      false,
    );
  }
});
test("first baseline conflict shares its parent nonce anchor with candidate", async () => {
  const r = sample();
  for (const i of [0, 3])
    r.baseline.outcomes[i] = {
      index: i,
      hash: r.source.inputs[i].hash,
      status: "nonce_conflict",
      expected_nonce: 5521,
      original_nonce: r.source.inputs[i].nonce,
    };
  // Other senders mine at the candidate's indices and cumulative gas; their receipts may differ.
  for (const i of [1, 2])
    r.baseline.outcomes[i] = structuredClone(r.candidate.outcomes[i]);
  r.baseline.matches_original_receipts = false;
  r.baseline_verified = false;
  r.candidate.outcomes[3].expected_nonce = 5521;
  assert.equal((await validateTraceReport(reseal(r))).baseline.matches, false);
  r.candidate.outcomes[3].expected_nonce = 5522;
  await assert.rejects(validateTraceReport(reseal(r)), /nonce conflict/);
});
test("reordered JSON keys and differing-field set order remain compatible", async () => {
  const r = sample();
  for (const b of [r.baseline, r.candidate])
    for (const o of b.outcomes)
      if (o.receipt)
        o.receipt = Object.fromEntries(Object.entries(o.receipt).reverse());
  // Object order does not change the hash. Difference fields are a unique set.
  await validateTraceReport(r);
  r.candidate.outcomes[1].differing_fields.reverse();
  await validateTraceReport(reseal(r));
});
test("resealed source, prefix and intervention contradictions fail", async () => {
  for (const change of [
    (r) => {
      r.source.parent.block_number++;
    },
    (r) => {
      r.source.parent.chain_id = 2;
    },
    (r) => {
      r.plan.through_index = 2;
    },
    (r) => {
      r.source.inputs[1].index = 0;
    },
    (r) => {
      r.source.block_transaction_count = 3;
    },
    (r) => {
      r.plan.skip_indices = [1, 0];
    },
    (r) => {
      r.plan.skip_indices = [0, 0];
    },
    (r) => {
      r.plan.skip_indices = [];
    },
    (r) => {
      r.candidate.outcomes[3].index = 2;
    },
  ])
    await refuse(change);
});
test("resealed hashes, receipt senders, targets and signed types/nonces fail", async () => {
  for (const change of [
    (r) => {
      r.source.inputs[0].hash = "0x" + "00".repeat(32);
    },
    (r) => {
      r.source.inputs[0].nonce++;
    },
    (r) => {
      r.source.inputs[0].original_receipt.from = "0x" + "00".repeat(20);
    },
    (r) => {
      r.candidate.outcomes[1].receipt.to = null;
    },
    (r) => {
      r.candidate.outcomes[1].receipt.type = "0x1";
    },
    (r) => {
      r.candidate.outcomes[1].receipt.transactionHash = "0x" + "00".repeat(32);
    },
    (r) => {
      r.candidate.outcomes[1].receipt.from = "0x" + "00".repeat(20);
    },
    (r) => {
      r.source.inputs[0].raw = "0x00";
    },
    (r) => {
      r.source.inputs[0].raw += "00";
    },
  ])
    await refuse(change);
});
test("resealed receipt difference and verification claims fail", async () => {
  for (const change of [
    (r) => {
      r.candidate.outcomes[1].differing_fields = [];
    },
    (r) => {
      r.candidate.outcomes[1].differing_fields.push("gasUsed");
    },
    (r) => {
      r.candidate.outcomes[1].differing_fields.push("status");
    },
    (r) => {
      r.baseline_verified = false;
    },
    (r) => {
      r.candidate.matches_original_receipts = true;
    },
    (r) => {
      r.baseline.matches_original_receipts = false;
    },
    (r) => {
      r.baseline.outcomes[1].receipt.cumulativeGasUsed = "0x1";
    },
    (r) => {
      r.candidate.outcomes[1].receipt.transactionIndex = "0x1";
    },
    (r) => {
      r.candidate.outcomes[1].receipt.status = "0x0";
    },
    (r) => {
      r.candidate.outcomes[0].receipt = r.baseline.outcomes[0].receipt;
    },
  ])
    await refuse(change);
});
test("resealed nonce repair or hidden conflict fails", async () => {
  for (const change of [
    (r) => {
      r.candidate.outcomes[3].expected_nonce++;
    },
    (r) => {
      r.candidate.outcomes[3].original_nonce--;
    },
    (r) => {
      r.candidate.outcomes[3] = structuredClone(r.baseline.outcomes[3]);
    },
    (r) => {
      r.candidate.outcomes[3].status = "not_mined";
      delete r.candidate.outcomes[3].expected_nonce;
      delete r.candidate.outcomes[3].original_nonce;
    },
  ])
    await refuse(change);
});
test("shape, unsafe integers, log/calldata and serialized quotas fail closed", async () => {
  for (const change of [
    (r) => {
      r.rpc_url = "https://example.com";
    },
    (r) => {
      r.schema_version = "0.1.0";
    },
    (r) => {
      r.plan.command = "anything";
    },
    (r) => {
      r.source.header.base_fee = Number.MAX_SAFE_INTEGER + 1;
    },
    (r) => {
      r.source.inputs[0].nonce = true;
    },
    (r) => {
      r.baseline.outcomes[0].receipt.logs[0].removed = false;
    },
    (r) => {
      r.baseline.outcomes[0].receipt.logs = Array(513).fill(
        r.baseline.outcomes[0].receipt.logs[0],
      );
    },
    (r) => {
      r.source.inputs[0].original_receipt.logs[0].topics = Array(5).fill(
        "0x" + "00".repeat(32),
      );
    },
    (r) => {
      r.source.inputs[0].original_receipt.logs[0].data =
        "0x" + "00".repeat(65537);
    },
    (r) => {
      r.source.inputs[0].raw = "0x" + "00".repeat(65537);
    },
    (r) => {
      r.source.inputs = Array(33).fill(r.source.inputs[0]);
    },
    (r) => {
      r.assumptions = ["<img src=x onerror=alert(1)>".repeat(400000)];
    },
  ])
    await refuse(change);
});
test("changed unsigned checksum fails and hostile Unicode stays data", async () => {
  const r = sample();
  r.assumptions[0] = "<img src=x onerror=alert(1)> 🛸 é";
  await assert.rejects(validateTraceReport(r), /hash mismatch/);
  assert.equal(
    (await validateTraceReport(reseal(r))).assumptions[0],
    r.assumptions[0],
  );
});

test("Python-sealed integer-valued float and exponent runtime codecs verify", async () => {
  const cases = JSON.parse(
    readFileSync(
      new URL("data/trace-runtime-codecs.json", import.meta.url),
      "utf8",
    ),
  );
  for (const testCase of cases) {
    const r = JSON.parse(
      readFileSync(
        new URL("data/trace-mainnet-prefix-one.json", import.meta.url),
        "utf8",
      ),
    );
    r.runtime_seconds = testCase.runtime_seconds;
    r.artifact_id = testCase.artifact_id;
    await validateTraceReport(r);
  }
});
test("64 KiB calldata envelope fits the engine's larger raw-wire bound", async () => {
  // Resealed unit metadata only, not a new valid signature or executed report.
  const r = JSON.parse(
    readFileSync(
      new URL("data/trace-wide-envelope.unit.json", import.meta.url),
      "utf8",
    ),
  );
  assert.ok((r.source.inputs[0].raw.length - 2) / 2 > 65536);
  await validateTraceReport(r);
  r.baseline.anvil_version = "a".repeat(1001);
  await assert.rejects(
    validateTraceReport(reseal(r)),
    /Invalid transaction-prefix/,
  );
});
test("Python ASCII escaping includes DEL and astral Unicode", async () => {
  const cases = JSON.parse(
    readFileSync(
      new URL("data/trace-unicode-codecs.unit.json", import.meta.url),
      "utf8",
    ),
  );
  for (const testCase of cases) {
    const r = JSON.parse(
      readFileSync(
        new URL("data/trace-mainnet-prefix-one.json", import.meta.url),
        "utf8",
      ),
    );
    r.assumptions[0] = testCase.assumption;
    r.artifact_id = testCase.artifact_id;
    await validateTraceReport(r);
  }
});
test("pending digest cannot expose later caller mutations in displayed data", async () => {
  const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  assert.ok(originalCrypto);
  let finish;
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: {
      subtle: {
        digest: (algorithm, data) =>
          new Promise((resolve) => {
            finish = () => resolve(webcrypto.subtle.digest(algorithm, data));
          }),
      },
    },
  });
  try {
    const r = sample(),
      before = structuredClone(r);
    const pending = validateTraceReport(r);
    r.baseline_verified = false;
    r.baseline.outcomes[0].receipt.gasUsed = "0x0";
    r.assumptions[0] = "changed after validation";
    finish();
    const view = await pending;
    assert.deepEqual(view.report, before);
    assert.equal(
      view.baseline.rows[0].receipt?.gasUsed,
      before.baseline.outcomes[0].receipt.gasUsed,
    );
    assert.equal(view.assumptions[0], before.assumptions[0]);
  } finally {
    Object.defineProperty(globalThis, "crypto", originalCrypto);
  }
});
test("Unicode text limits count codepoints for assumptions and Anvil versions", async () => {
  const cases = JSON.parse(
    readFileSync(
      new URL("data/trace-text-length.unit.json", import.meta.url),
      "utf8",
    ),
  );
  for (const testCase of cases) {
    const r = JSON.parse(
      readFileSync(
        new URL("data/trace-mainnet-prefix-one.json", import.meta.url),
        "utf8",
      ),
    );
    if (testCase.field === "assumption")
      r.assumptions[0] = "🛸".repeat(testCase.count);
    else r.baseline.anvil_version = "🛸".repeat(testCase.count);
    r.artifact_id = testCase.artifact_id;
    if (testCase.valid) await validateTraceReport(r);
    else
      await assert.rejects(
        validateTraceReport(r),
        /Invalid transaction-prefix/,
      );
  }
});
test("resealed zero gas and reverted nonzero bloom cannot claim matching receipts", async () => {
  for (const kind of ["zero-gas", "revert-bloom"]) {
    const r = JSON.parse(
      readFileSync(
        new URL("data/trace-mainnet-prefix-one.json", import.meta.url),
        "utf8",
      ),
    );
    for (const receipt of [
      r.source.inputs[0].original_receipt,
      r.baseline.outcomes[0].receipt,
    ]) {
      if (kind === "zero-gas") {
        receipt.gasUsed = "0x0";
        receipt.cumulativeGasUsed = "0x0";
      } else {
        receipt.status = "0x0";
        receipt.logs = [];
      }
    }
    await assert.rejects(
      validateTraceReport(reseal(r)),
      /Invalid transaction-prefix/,
    );
  }
});
