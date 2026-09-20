// Full findings are retained before the exact source-bound review gate is applied.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { ESLint } from "eslint";
import security from "eslint-plugin-security";
import { findings, verifyReview } from "./quality_policy.mjs";

const root = process.cwd();
const paths = execFileSync(
  "git",
  ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
  { encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean);
const jsFiles = [...new Set(paths.filter((p) => /\.(js|mjs)$/.test(p)))].sort();
assert.ok(jsFiles.length > 0, "No tracked JavaScript sources");
await mkdir(".quality", { recursive: true });
// TypeScript 7 exposes the compiler through its CLI, not the former compiler API.
const listed = execFileSync(
  process.execPath,
  [
    resolve("node_modules/typescript/bin/tsc"),
    "--listFilesOnly",
    "--pretty",
    "false",
  ],
  { encoding: "utf8" },
);
const typeInputs = listed
  .trim()
  .split("\n")
  .map((name) => relative(root, name.trim()))
  .filter(
    (name) => !name.startsWith("node_modules/") && !name.startsWith("../"),
  )
  .sort();
assert.deepEqual(
  typeInputs.filter((name) => /\.(js|mjs)$/.test(name)),
  jsFiles,
  "Type checking omits source files",
);
/** @type {Record<string, string>} */
const sources = {};
const configurationInputs = [
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "pyproject.toml",
  "requirements-quality.in",
  "requirements-quality.txt",
];
for (const path of [
  ...new Set([...jsFiles, ...typeInputs, ...configurationInputs]),
].sort()) {
  sources[path] = createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}
await writeFile(
  ".quality/source-sha256.json",
  JSON.stringify(sources, null, 2) + "\n",
);
const checker = new ESLint({
  overrideConfigFile: "eslint.security.config.mjs",
  allowInlineConfig: false,
});
for (const path of jsFiles) {
  const config = await checker.calculateConfigForFile(path);
  for (const rule of Object.keys(security.rules)) {
    assert.ok(
      config.rules["security/" + rule]?.[0] > 0,
      "Missing security rule: " + rule,
    );
  }
}
const reports = await checker.lintFiles(jsFiles);
await writeFile(
  ".quality/security.json",
  JSON.stringify(
    reports.map((report) => ({
      ...report,
      filePath: relative(root, report.filePath),
    })),
    null,
    2,
  ) + "\n",
);
assert.deepEqual(
  reports.map((report) => relative(root, report.filePath)).sort(),
  jsFiles,
  "Incomplete security scan",
);
const rows = findings(reports, root);
const review = JSON.parse(await readFile("security-reviewed.json", "utf8"));
verifyReview(rows, sources, review);
await writeFile(
  ".quality/scope.json",
  JSON.stringify(
    {
      status: "passed",
      js_files: jsFiles,
      type_inputs: typeInputs,
      security_rules: Object.keys(security.rules),
      retained_security_findings: rows.length,
      limitations: [
        "Source-bound author review, not independent approval or proof of security",
        "Normal checkJs with strict null checks and unknown report inputs; noImplicitAny is disabled for JS tooling",
      ],
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify({
    sources: jsFiles.length,
    type_inputs: typeInputs.length,
    security_findings: rows.length,
  }),
);
