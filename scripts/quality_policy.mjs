import assert from "node:assert/strict";

/** @param {import('eslint').ESLint.LintResult[]} reports @param {string} root */
export function findings(reports, root) {
  return reports.flatMap((report) => {
    assert.equal(
      report.fatalErrorCount,
      0,
      "Security scan failed to parse source",
    );
    assert.equal(
      report.suppressedMessages.length,
      0,
      "Suppressed security findings",
    );
    return report.messages.map((message) => {
      assert.ok(
        message.ruleId?.startsWith("security/"),
        "Unexpected scanner diagnostic",
      );
      return { file: report.filePath.slice(root.length + 1), ...message };
    });
  });
}

/**
 * @param {ReturnType<typeof findings>} actual
 * @param {Record<string, string>} sources
 * @param {{sources: Record<string,string>, findings: Array<{finding: object, reason: string}>}} review
 */
export function verifyReview(actual, sources, review) {
  assert.ok(Object.keys(sources).length > 0, "Empty source scope");
  assert.deepEqual(review.sources, sources, "Reviewed source bytes changed");
  assert.ok(
    review.findings.every(
      (row) => typeof row.reason === "string" && row.reason.trim().length >= 30,
    ),
    "Missing individual finding rationale",
  );
  assert.deepEqual(
    review.findings.map((row) => row.finding),
    actual,
    "New, changed or removed security findings need review",
  );
}
