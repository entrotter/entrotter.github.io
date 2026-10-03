# Website status

## 2026-09-27 — Evergreen experiment console (review branch)

The existing website now presents the four-action Uniswap comparison at `/`,
with purple UFO artwork, orbital motion, a local command builder and a collapsible
v0.1 report explorer. Visible copy does not name a hackathon. The event subdirectory
has been removed from this source tree and the deployment allowlist.

The measured example and comparison validator were moved without changing their
bytes. Original wire-format names and pinned engine provenance remain intact.
No new execution, profitability result or live swap is claimed. Only this website
repository's code was changed; historical and unrelated PRs are preserved.

Validation performed on this change:

- Python site checks: 11 passed. The new root-integration regression initially
  failed before implementation, then passed.
- Node report checks: 29 passed across the original and comparison formats.
- Playwright Chromium at 1440×1000 and 390×844: four actions, recorded-result
  label, constraint decision, JSON download, command generation/input rejection,
  valid import, invalid import clearing results/download, legacy EVM and synthetic
  reports, no horizontal overflow, reduced motion and keyboard skip link passed.
- Local `/tokyo2026/` returns 404. Browser error/warning console is empty.
- Desktop, console and mobile screenshots were visually inspected; local images
  are in ignored `output/playwright/`. `git diff --check` passed.

The obsolete separate repository's Pages site was disabled through the GitHub API
under the owner's explicit removal authorization. Its Pages API and public
`https://entrotter.github.io/tokyo2026/` both returned 404 afterwards. The root
`https://entrotter.github.io/` still returned 200. This disables the temporary
publication; it does not delete the separate repository or its history.

The redesigned root is not yet live. PR #13 requires independent approval before
protected-main merge and Pages deployment. The local preview is not deployment
proof. No protection settings were changed and no unrelated PR was merged.

## 2026-10-01 — Integrating the current home into quality PR #11

The September entry above is historical: PR #13 is now merged. GitHub Pages
workflow 36259682938 succeeded for main d44af5d01f692e177af055338202695e5930c95f,
and the Pages API reports built. The quality candidate merges that main commit
while preserving the UFO home, console, measured example and collapsible archive.
The candidate itself still requires independent approval and later live checks.

The comparison importer now validates accessed object/scalar shapes from unknown
JSON, checks the displayed WETH/USDC pool and encoded fee, clears stale evidence
before loading and prevents a slower previous load from overwriting a newer one.
Opaque text surfaces preserve measurable contrast; the portal artwork retains
its glow. Keyboard chart alternatives, forced colors and scrollable regions
remain available in the archive. Both report wire formats remain compatible.

Fresh local validation on the combined working tree:

- 40 Node report/security-policy tests and 11 Python site tests passed.
- ESLint, Prettier, TypeScript checkJs, Ruff, mypy and full Bandit passed.
- All 14 security rules ran over 11 JavaScript sources; 12 type inputs were
  covered. All 51 findings retain individual source-bound author rationales.
  This is not independent approval or proof of security.
- Chromium 153.0.8010.12 and axe 4.13.0: 24 browser groups and 18 scans passed,
  with zero violations. Raw incomplete items and supplemental opaque-color
  calculations remain explicit. Console/import/race and all archive samples
  were checked at 1280, 390 and 320 CSS pixels. No uploads or third-party
  requests occurred. The 320px console screenshot was visually inspected.
- npm audit and the strict hash-locked Python dependency audit reported no
  known vulnerabilities. Lychee checked 31 links with zero errors/timeouts.

Local raw evidence remains in ignored output/playwright/ and .quality/; its
source hashes match the final runtime bytes. These are display checks using
existing evidence, not a new chain or model run. Manual assistive-technology
review and complete WCAG conformance remain unverified. PR builds do not deploy;
the independent main-branch approval and required jobs remain mandatory.

## 2026-10-01 — Inspectable recorded agent decisions

The candidate based on8671ab2 adds decision-time preflight/gas/execute-hold/reasons
beside candidate outcomes in the v0.1 archive. The existing local model report is
copied byte-identically; original requested alias, nondeterminism, unavailable
seed/cost and no measured model advantage remain disclosed. No model/archive
call, Docker startup, schema change or original recording rewrite occurred.

Independent source review found three P2 internal-consistency gaps: array choices
coerced to strings, proposals not tied to scenario actions and held outcomes
claiming success/nonzero gas. All are fixed and independently re-reviewed. Four
fully resealed contradictions fail before the fix and pass refusal afterwards.
All47 Node/11 Python tests, lint/format/types and full source scans pass. All55
static findings remain visible with reasons, retaining51 previous rationales and
reviewing4 new indexed-read/fixed-fixture filesystem findings; no rule is skipped.

Chromium153.0.8010.12/axe4.13.0 on Node22.23.1 pass28 groups and21 scans with zero
violations, including three viewports, hostile local imports, resealed failure/
clear/recovery, exact reasons/provenance and mobile keyboard horizontal scroll.
The320px screenshot was visually inspected and its table adjusted for readable
rows. All12 original agent reports still display with exact original hashes.
Raw incomplete axe items, source hashes and failures are preserved in
evidence/agent-decisions/. Initial unsupported Node20.2 and an EVM-test historical
source assumption were corrected before final verification.

Selected consistency checks do not authenticate imported data or reproduce full
engine/financial validation. Browser proof is not manual assistive-tech or full
WCAG certification. Current-head CI is separately required; independent GitHub
approval/protected integration/Pages live verification and submission remain open.

## October 2 — Separate signed-prefix report viewer candidate

Branch feat/trace-report-viewer builds from tested49914a2. New trace-report.mjs
and trace-viewer.mjs add a browser-only pane for the immutable engine817 actual
Docker four-prefix report, with exact source/parent/header, original signed
identities/nonces and original/baseline/candidate receipt comparisons. Existing
v0.1 app.js and original model/fixture reports remain byte-identical. The older
engine0d native one-prefix case is a separate test-only compatibility fixture.

Exact shape/integrity, RLP metadata, skip/index/receipt identity and type/target,
shared baseline-derived parent nonce anchors, cumulative gas, exact unique
receipt-difference sets and verification flags are checked before display.
Malformed resealed imports clear values/downloads and stale sample replies cannot
replace newer imports. Safe-integer numeric limits and unverified branches are
explicit; no authenticity, signature/Keccak, parent-state or EVM proof is claimed.

Author checks:63Node/11Python units, full lint/format/checkJs/Python checks pass.
All97 findings across14JS sources/15type inputs remain visible (all55 prior plus
42 individual explanations), no rule suppression;1Python source has zero full
Bandit findings. Node109/Python42 dependency audits report zero advisories.
Final-source local Chromium desktop/390/320px checks pass33groups and25axe scans, including
keyboard/import/reflow, exact receipt rows, inert hostile text, contradictory and
oversized imports, Python float/integer/Unicode imports, unverified recovery and
delayed-sample races. This proof includes the final codepoint-length fix and actual Tab navigation to
the native chooser. The first Linux attempt timed out in apt setup; retry reached
the harness and exposed one1280px programmatic-focus chooser timeout. Sequential
Tab navigation retains all chooser/import assertions; independent review and
focused padded-control screenshots confirm visible parent-label focus at all
three widths. A second setup attempt again exhausted the deadline in slow Azure HTTP package
transfers before harness execution. The reviewed workflow now selects the official
HTTPS Ubuntu archive without changing signed-APT validation, dependencies, tests
or timeout; YAML/extracted-script mock checks pass. Final exact-head Linux CI
remains required. Imports emit
zero requests; only same-origin GETs occur. Manual assistive-tech/full WCAG remain
open. See evidence/trace-viewer for raw proof/source hashes and retained limits.

Independent root source followup resolves six compatibility/mutation findings with
zero remaining actionable findings within scope; public proof is retained. Mandatory
GitHub approval, exact-head CI and publication remain separate. No archive/model
call, new chain execution, local Docker/VM startup, deployment, protected merge,
media/holdout change or competition submission occurred. Discord is excluded.


## October 2 — Separate structural and execution receipt differences

Candidate branch feat/trace-execution-differences starts from tested b7c20ce. A
pure display module groups candidate receipts against the original projected
receipts: omission, transactionIndex/cumulativeGasUsed only, other execution
receipt fields, exact match, or unavailable. All exact differing fields and full
original/baseline/candidate receipts remain visible; baseline verification stays
separate. Receipt matches establish no contract-state/consumer equivalence or
profit/benefit. Validators/hash codecs and existing v0.1 app remain byte-identical.

The test-only32 fixture is the exact existing engine198 native005 report (SHA
72b9765731a77c06df1200a2dcf46f74cb7f512758ab35029ae9cef2c6ef2120):
12 exact matches,1 omission,19 structural-only differences. No new historical
replay, model evaluation or consumer validation ran. Source review found old
recorded-four/skip0 text misleading on local32/skip12 imports. Static text is now
explicitly sample-only; the current-case caption displays validated count/through/
skips and clears on malformed imports. Prior frozen browser proof remains retained.

Final66 Node/11 Python tests, full lint/format/checkJs and Python static checks pass.
Full15-JS/16-type scans retain all97 old rationales and review2 new findings (99
visible, zero suppressions); one Python source has zero Bandit findings. Unchanged
109-node/42-Python locks audit with zero advisories. Final local darwin Chromium
153.0.8010.12/Playwright1.63.0/axe4.13.0 on Node22.23.1 passes36 groups and28 scans
with zero violations:1280/390/320px import, exact counts/fields, current-case/default
case/invalid-clear assertions, keyboard expansion/scroll and original safety gates.
Desktop/320px screenshots were visually inspected. Axe incomplete contrast remains
explicit; no complete WCAG/manual assistive-tech certification. Imports emit zero
requests, only same-originGETs occur, and owned pages/browser/server close in finally.

See evidence/trace-differences for source-bound logs, full findings, compressed
byte-identical raw axe outputs and immutable report provenance. Before-test helper
import failure and a later preparation anchor mismatch are retained as setup gaps,
not behavioral failures. Final exact-head CI, independent review, protected-main
human approval and Pages publication remain separate; no merge/deployment/submission.


## October 3 — exact recorded Aave account impact viewer

The proposed account wrapper viewer validates a closed fixed plan, three seals,
full four-phase account/config/code/head/query records and recomputed exact
classification. Six after-state metrics/deltas use BigInt without rounding.
Missing data remains UNPROVEN/null; zero debt shows No debt with no HF delta;
loaded health statuses are human-readable. Invalid imports clear all account and
price values, and switches to old families remove the account view. Old codecs,
v0.1 UI, locks and frozen report bytes remain exact. The deploy allowlist adds
position-report.mjs, excluding private/evidence files. No new EVM/model/user run.

The bundled original Engine88c6 Docker13 report SHAcd96 is byte-identical, with
all13 baseline receipts/candidate12+skip12 and complete four account/price views.
Capacity differs816.28966124 USD; health factor0.003852169807877337. These are
aggregate prefix-state dependencies, not profit, signed execution, sole-price
causality, provider/proxy authentication or full-block/root proof. Nine synthetic
controls are separately sealed/SDKba4 accepted, with unchanged nested evidence.

Local126 Node/12 Python tests and lint/format/checkJs/Python static checks pass.
Full19JS/20type coverage retains137 visible security findings, no suppressions;
all122 original reasons preserved exactly plus15 new contexts. Initial metadata
mapping collisions were independently found and fixed before final review.
Node109/Python42 dependency audits report0 advisories. Final-source local macOS
Chromium153/Playwright1.63/axe4.13 passes42 groups/49 scans/0 violations/0JS errors
at1280/390/320px. Desktop/320 screenshots visually checked; keyboard/local import,
exact large integers, missing/null/no-debt/boundary, invalid-clear and recovery
are exercised. Imports issue0 requests; only same-originGETs allowed. Incomplete
contrast remains recorded; supplemental CSS checks are not axe/full WCAG proof.
The preceding same-source run timed out in the existing320 native filechooser;
cause unknown. Unchanged rerun passes all groups; no assertions were relaxed.

See [source-bound account viewer evidence](evidence/position-viewer/README.md).
Independent staged review and exact-head CI are pending separately from human
protected-main approval, live Pages and formal submission. Goal remains active
through the official October13 15:59JST deadline. Discord remains excluded.


## October 3 — key account changes before the full table

Viewer4c6e subsequently passed all4 mandatory checks and full independent raw
review665b429d; the preceding account-viewer section records its preparation-time
state. This next proposed UI change puts exact borrowing-capacity and health-
factor differences before the account address and full six-metric table. A
semantic definition list stacks on mobile and preserves positive/negative/zero,
missing/null and no-debt semantics using the unchanged exact BigInt formatter.
All original metric/raw/config/price/receipt views and closed validators remain.

Original immutable4c6e Chromium320 fails the new summary-presence regression.
Final-source local42 browser groups/58 full axe outputs pass at1280/390/320,
with0violations/0JSerrors. All prior42 groups/49 scans are retained; nine additional
scans cover debt transition and explicit synthetic reversed/equal after-values.
No new chain/model/transaction/user evaluation ran. Final desktop/320 screenshots
retain all digits; long exact values wrap. Local126 Node/12 Python checks pass.
Lint19JS/checkJs20/format and Python Ruff/mypy/full Bandit0 pass; Python formatting
repair preserves AST, successful earlier checks reused. All137 prior individual
security explanations remain exact (85 unchanged/52 moved whole-expression
occurrences), with0new findings and no rule/suppression changes. Full final
scanner/source gate pass. Locks unchanged; local advisory evidence reuses4c6e
Node109/Python42 zero-advisory proof, new mandatoryCI still queries afresh.

First new negative expectations used ASCII hyphen instead of the existing Unicode
minus; test-only glyph correction preserves the formatter. A subsequent existing
keyboard/native-filechooser5000ms timeout retains unknown cause; full unchanged-
source replay then passes42/58. Original raw failures stay private, no assertions
or time budgets weakened. Axe incomplete contrast and supplemental calculations
remain distinct from manual assistive-tech or full WCAG certification. See
[source-bound summary evidence](evidence/account-summary/README.md). Independent
final staged review/current-head CI, human main approval, live Pages and formal
submission remain separate. Goal active through the official deadline; Discord
excluded.


## October 4 — identify local v0.1 report sources

The actual Chromium baseline on 8aa0e58 imports the existing Local EVM agent
report but leaves liquidity-shock selected. The new source selector shows local
reports explicitly, clears previous values while loading, shows no verified
report after rejection, and permits returning to the same example. Latest
selection/download writes remain generation-guarded; no-file cancellation keeps
the current report. Validators, report/schema bytes and all locks are unchanged.

Final local 126 Node/12 Python tests, lint/format/checkJs, and the full 19 JS/20
type-input/139-finding security gate pass. All preceding 137 security reasons
remain exact; two fixed fixture reads have separate reviewed reasons. Chromium
43 groups and all 58 raw axe scans pass, with zero violations/JS errors. The new
390px race control awaits actual stale sample-handler completion, verifies local
import/request behavior, same-example recovery and reflow. All earlier groups,
scans, timeouts and assertions remain. The original old-source full run had one
existing native chooser timeout of unknown cause; original raw output is retained.
The first updated full run passed; final run followed a stronger completion
observation and screenshot/reflow assertion. See [source evidence](evidence/report-source/README.md).

Independent staged review, exact-head mandatory CI, protected human main approval
and live Pages verification remain separate. No fresh EVM/model/upstream/user
execution or performance claim; existing videos keep their original source pins.
Goal remains active through the official deadline, Discord excluded.
