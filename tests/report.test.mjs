import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash, webcrypto } from "node:crypto";
import vm from "node:vm";

// No browser/network needed: exercise the exact production hash/number functions.
const context = vm.createContext({
  document: {
    getElementById: () => ({
      value: "not-an-allowed-sample",
      addEventListener: () => {},
    }),
  },
  crypto: webcrypto,
  TextEncoder,
  fetch: () => {
    throw new Error("Unit tests must not contact the network");
  },
});
vm.runInContext(
  readFileSync(new URL("../app.js", import.meta.url), "utf8"),
  context,
);
const sample = () =>
  JSON.parse(
    readFileSync(
      new URL("../reports/liquidity-shock.json", import.meta.url),
      "utf8",
    ),
  );
for (const name of ["liquidity-shock", "recovery-trap", "depeg-stress"]) {
  test(`production JS verifies Python artifact: ${name}`, async () => {
    await context.checkHash(
      JSON.parse(
        readFileSync(
          new URL(`../reports/${name}.json`, import.meta.url),
          "utf8",
        ),
      ),
    );
  });
}
test("tampered metric fails integrity validation", async () => {
  const r = sample();
  r.candidate.metrics.final_equity = "999999";
  await assert.rejects(context.checkHash(r), /mismatch/);
});
test("unknown schema is not accepted", async () => {
  const r = sample();
  r.schema_version = "9";
  await assert.rejects(context.checkHash(r), /Unsupported/);
});
test("canonical ASCII escaping includes supplementary Unicode", () => {
  assert.equal(
    context.canonical({ x: "🛸", a: "é" }),
    '\x7b"a":"\\u00e9","x":"\\ud83d\\udef8"\x7d',
  );
});
test("finite numerical display validation", () => {
  assert.equal(context.finite("8557.0516"), 8557.0516);
  assert.throws(() => context.finite("Infinity"), /Invalid metric/);
  assert.throws(() => context.finite(2), /Invalid metric/);
});
test("JS re-canonicalization matches exported content hash", () => {
  const { artifact_id, ...r } = sample();
  assert.equal(
    createHash("sha256").update(context.canonical(r)).digest("hex"),
    artifact_id,
  );
});
const evm = () =>
  JSON.parse(
    readFileSync(
      new URL("../reports/ethereum-uniswap-slippage.json", import.meta.url),
      "utf8",
    ),
  );
test("real archived-state artifact passes hash and receipt view validation", async () => {
  const r = evm();
  await context.checkHash(r);
  const view = context.evmViewModel(r);
  assert.equal(view.traces.length, 6);
  assert.equal(view.traces.at(-1)[2], "reverted");
  assert.match(view.source, /19000000/);
  assert.equal(
    view.rows.find((r) => r[0] === "USDC final token units")[1],
    "2556.134769",
  );
});
test("token units preserve integers beyond Number safe precision", () => {
  assert.equal(
    context.tokenUnits("123456789012345678901", 18),
    "123.456789012345678901",
  );
  assert.equal(context.tokenUnits("-1", 6), "-0.000001");
  assert.equal(context.tokenUnits("42", 0), "42");
  assert.throws(() => context.tokenUnits("1e18", 18), /Invalid/);
  assert.throws(() => context.tokenUnits("1", 1000), /Invalid/);
});
test("missing source hash cannot appear as a historical report", () => {
  const r = evm();
  delete r.source.block_hash;
  assert.throws(() => context.evmViewModel(r), /source pin/);
});
test("mismatched token addresses cannot share a comparison row", () => {
  const r = evm();
  r.candidate.tokens[0].address = "0x" + "f".repeat(40);
  assert.throws(() => context.evmViewModel(r), /metadata/);
});
test("malformed receipt state and oversized traces fail closed", () => {
  const r = evm();
  r.candidate.trace[0].status = "<img>";
  assert.throws(() => context.evmViewModel(r), /step/);
  const many = evm();
  many.baseline.trace = Array(33).fill(many.baseline.trace[0]);
  assert.throws(() => context.evmViewModel(many), /trace/);
});

test("display metrics reject coercible non-decimal strings", () => {
  for (const value of ["", " ", "\t", "0x10", "0b11", "0o10"]) {
    assert.throws(() => context.finite(value), /Invalid metric/);
  }
});

test("decimal metrics preserve supported signed/exponent values and reject overflow", () => {
  assert.equal(context.finite("-1.25"), -1.25);
  assert.equal(context.finite("1e2"), 100);
  for (const value of ["1e999", "1\n", "1 ", "NaN", "1".repeat(101)])
    assert.throws(() => context.finite(value), /Invalid metric/);
  assert.throws(() => context.rawInteger("1\n"), /Invalid raw integer/);
});
test("hash verification rejects non-object or non-finite parsed JSON", async () => {
  for (const value of [null, [], true, 42, "report"])
    await assert.rejects(context.checkHash(value), /Invalid report object/);
  assert.throws(() => context.canonical(Infinity), /Invalid JSON number/);
});
