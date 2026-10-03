# Candidate receipt comparison

A validated current-case caption shows the loaded prefix count, through_index and
skip_indices. Static four-transaction text explicitly identifies the recorded
sample. Invalid imports clear both caption and overview. The overview groups each candidate against its **original projected receipt**:
omitted, position/cumulative gas only, other execution receipt differences,
exact original receipt match, or unavailable receipt. The two structural fields
are transactionIndex and cumulativeGasUsed. Every differing field remains visible,
and expanded rows retain full original, baseline and candidate receipts. Baseline
verification remains separate. Receipt equality establishes neither unchanged
contract state/consumer behavior nor benefit/profit from omitted gas.

The fixed [test fixture](../../tests/data/trace-oracle-prefix-32.json) preserves the
exact [engine198 native005 report](https://github.com/entrotter/engine/blob/198139ff0b3bf37781b4232b27d8eeb0a5da5365/evidence/trace-parent-cache/native-005/report.json):
SHA-25672b9765731a77c06df1200a2dcf46f74cb7f512758ab35029ae9cef2c6ef2120.
It yields12 exact matches,1 omission and19 structural-only receipt differences.
No chain/model run or new dependent-consumer evidence is produced by this UI work.
The recorded four-transaction sample, v0.1 explorer, validators and hash codec
remain byte-identical to b7. The new pure display module uses a distinct URL so
a cached previous validator cannot lack a newly requested export.

## Local author checks

[Summary](summary.json), [full findings](author/security-full.json),
[source hashes](author/source-sha256.json), [individual review mapping](author/security-review-mapping.json)
and [test log](author/unit.log) retain66 Node/11 Python passes and complete
lint/format/checkJs/Ruff/mypy results. Full15-JS/16-type scanning retains all97
previous rationales and reviews2 new indexed-read/fixed-fixture findings,
with no suppression. The one Python source has zero full Bandit findings.
[Node](author/npm-audit.json)109 locked packages and
[Python](author/python-dependencies.json)42 report zero advisories.
The expected stale-source review refusal was preserved privately before refresh.

[Browser results](browser/accessibility.json) bind the final sources and runner:
36 groups/28 axe scans/zero violations across1280/390/320px, including current32/
skip12, recorded4/skip0 and invalid-caption clearing, as well as exact32
local import, omission/structural counts, exact field retention, keyboard receipt
expansion/scrolling and stale-value clearing on failed imports. Imports make zero
requests; the harness permits only same-origin GETs. [Raw axe archive](browser/axe-raw.zip)
contains all28 exact JSON results (including incomplete contrast items).
[Provenance](provenance.json) records every original byte hash and archive entry;
ZIP metadata is normalized, result contents are unchanged. Desktop and320px
summary screenshots were visually inspected; small-screen tables use native
horizontal scrolling. The owned local browser/pages/server closed in finally;
this is darwin Chromium proof, not Linux CI, Pages or manual assistive-tech/WCAG
certification.

[Earlier inspection](before/inspection.json) imported the same32 report and shows
the old overview absent. The first test attempt imported a helper that did not yet
exist: that retained private failure is a setup gap, not a behavioral before-test
claim. The initial14-JS prototype checks are separate from this final15-JS run.
The first browser proof exposed misleading static four/skip0 text on a32/skip12
import; [prior results](prior/accessibility-before-caption-fix.json) remain
historical and the original source snapshots/private raw outputs remain retained.
A preparation text-anchor mismatch was corrected before final browser launch; no
product failure or prior proof is reconstructed. The original report and runtime/test/policy bytes were held throughout final
browser execution. Exact-head CI, independent source review and protected-main
human approval remain separate gates. No deployment, merge or submission occurred.


## Independent review addendum

[Root final review](independent-review.json) passes with no remaining actionable
findings, SHA-2561c80b323805bd48c24b82261c0c7eef4f4122ca0dfb12a5dfad00d47de60bb35.
It binds24 sources and the prior31-file package, independently checks12/1/19/0
actual receipt counts, all99 findings/rationales,27 exact copies and28 raw axe
entries. This exact review JSON and these README/summary references are an
addendum after that review; original provenance copies and runtime/test/policy/
lock bytes are unchanged. Exact-head CI, main human approval and Pages remain
separate; no deployment or protected merge is authorized by a software review.
