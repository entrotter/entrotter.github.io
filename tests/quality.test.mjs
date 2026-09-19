import test from "node:test";
import assert from "node:assert/strict";
import { verifyReview, findings } from "../scripts/quality_policy.mjs";

const sources = { "app.js": "a".repeat(64) };
/** @type {ReturnType<typeof findings>[number]} */
const finding = {
  file: "app.js",
  ruleId: "security/detect-object-injection",
  severity: 1,
  message: "Computed property",
  line: 1,
  column: 1,
};
const review = {
  sources,
  findings: [
    { finding, reason: "Test-specific rationale for a source-bound finding." },
  ],
};
test("security policy retains explicitly reviewed findings", () =>
  verifyReview([finding], sources, review));
test("source drift, new/missing findings and absent rationale fail review", () => {
  assert.throws(() =>
    verifyReview([finding], { "app.js": "b".repeat(64) }, review),
  );
  assert.throws(() =>
    verifyReview([finding, { ...finding, line: 2 }], sources, review),
  );
  assert.throws(() => verifyReview([], sources, review));
  assert.throws(() =>
    verifyReview([finding], sources, {
      ...review,
      findings: [{ finding, reason: "" }],
    }),
  );
});
test("empty source scope fails review", () =>
  assert.throws(() => verifyReview([], {}, { sources: {}, findings: [] })));
test("parser and suppressed diagnostics cannot be accepted as a clean scan", () => {
  /** @type {import('eslint').ESLint.LintResult} */
  const report = {
    filePath: "/repo/app.js",
    messages: [],
    suppressedMessages: [],
    fatalErrorCount: 1,
    errorCount: 1,
    warningCount: 0,
    fixableErrorCount: 0,
    fixableWarningCount: 0,
    usedDeprecatedRules: [],
  };
  assert.throws(() => findings([report], "/repo"));
  /** @type {import('eslint').ESLint.LintResult} */
  const suppressed = {
    ...report,
    fatalErrorCount: 0,
    suppressedMessages: [
      {
        ruleId: "security/detect-object-injection",
        message: "hidden",
        line: 1,
        column: 1,
        severity: 1,
        suppressions: [{ kind: "directive", justification: "ignored" }],
      },
    ],
  };
  assert.throws(() => findings([suppressed], "/repo"));
});
