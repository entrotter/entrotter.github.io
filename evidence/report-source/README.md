# Identify the current v0.1 report source

A verified local report previously left the last example selected. The actual
Chromium regression imported the existing agent report into source `8aa0e58`:
the result correctly said Local EVM, but the selector still said liquidity-shock.
[Before](before-regression.json) fails the origin assertion; [after](after-regression.json)
passes with local-report and no import request. The original report bytes and
validation contracts are unchanged.

The **Report source** selector now identifies local files, loading and rejected
reports separately from the five examples. Loading clears previous values,
receipts and downloads. No-file cancellation preserves the current result;
choosing the same previous example restores the recorded report and its download.
Labels never use an imported filename or infer origin from scenario metadata.
All post-validation selection and download updates retain the generation guard.

## Verification

Run `npm test`, `python3 -m unittest discover -s tests -v`, the quality commands
in the [repository guide](../../README.md#code-quality-and-input-validation),
and `npm run test:accessibility` with Node 20.19+ and the locked Chromium tool.
[Validation](validation.json) binds the final inputs and logs.
[Documentation link results](docs-links.json) retain every tracked-document result. The final browser
runner passes 43 groups and retains all 58 existing raw axe scans at 1280, 390
and 320 CSS pixels. [Full browser output](browser.json.gz) and [raw axe](axe-raw.zip)
retain incomplete contrast results and separate supplemental CSS calculations.
This is not manual screen-reader certification or complete WCAG conformance.

The new 390px control covers successful/rejected imports while a sample response
is held, a stale sample HTTP error, clearing while loading, no import requests,
no-file cancellation and recovery to the same example. It explicitly awaits the
actual sample handler promise after release, rather than guessing completion
from a sleep or unrelated digest. Existing native chooser/keyboard tests remain.
The [390px local report capture](local-report-source-390.png) shows the selected
source with matching fixture data; other report modes remain covered separately.

An initial unchanged old-source full browser run had one existing 5000ms native
filechooser timeout in the 1280px signed-prefix case; its cause is unknown. It
is distinct from the demonstrated source-label regression and is retained locally.
The first updated 43/58 browser run passed; the final run repeats after strengthening
only the completion observation and adding the local capture/reflow assertion.
Timeouts and previous assertions were not weakened. An initial authoring patch
used the wrong working directory and made no edit; the old-source run proceeded.

[Security mapping](security-mapping.json) preserves all 137 preceding individual
reasons (113 identical fingerprints, 24 location changes with complete context
agreement). Two additional fixed-fixture reads have separate reviewed reasons.
All 14 scanner rules remain enabled with no suppressed diagnostics; the final
139-finding source gate passes. Reviewer-only parser setup errors remain local,
distinct from production or scanner failures.

No new model call, EVM run, upstream request, user evaluation or performance
measurement is claimed. This is a source-label improvement on a review branch;
protected main approval and a fresh live Pages verification remain separate.
