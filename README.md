# Entrotter documentation and report explorer

A zero-build static OSS website for GitHub Pages. HTML, CSS and plain JavaScript.
No framework, npm install, third-party script, tracking, wallet connection or
public backend is required. User-provided report files stay in the browser.

```bash
python3 -m http.server 8000 --bind 127.0.0.1
# Open http://127.0.0.1:8000, not file:// (sample JSON uses fetch).
python3 -m unittest discover -s tests -v
# Node 20+; no npm install is required
npm test
```

The examples include synthetic offline fixtures and a real archived-state Uniswap
intervention. Neither establishes historical trading performance. The explorer verifies
SHA-256 hashes and renders synthetic fixtures and EVM reports. The pinned Uniswap example includes
source hashes, receipt statuses, gas and exact native/token units. The example
re-executes supplied actions against archived state; it is not historical replay.

The browser converts decimal strings to JavaScript numbers for visualization
only. The original exact strings remain in the JSON. Do not treat chart labels
as an exact financial ledger. No imported file is uploaded or saved remotely.

## Deployment

Repository name: `entrotter/entrotter.github.io` (public).
Intended address: https://entrotter.github.io/ . No custom domain or CNAME.
Configure Settings > Pages > Source as GitHub Actions, or use the parent
workspace's reviewed `scripts/publish.py --apply`. Push to main triggers
`.github/workflows/pages.yml`. A workflow file alone is not proof of a live site.

The deploy artifact contains only index.html, 404.html, style.css, app.js, comparison.mjs, report-validation.mjs, public
assets, schemas and public example reports. It never uploads the repository root,
private logs or a local .env. Pull requests run checks; only main deploys.

This site is for OSS documentation and public example inspection, not payment
processing or a commercial SaaS. The local engine is a separate executable.

## Assets and tests

The purple mascot derives from the owner's supplied Entrotter artwork; no
third-party brand assets or font files are bundled. UI fonts use system fallbacks.
A Content Security Policy limits script/network use to same origin.
All imported strings are inserted with textContent, never as HTML.

Run the parent workspace's `scripts/browser_check.py` for an optional Playwright
smoke test, hash verification, malformed import handling and screenshots.

## The experiment console

The home page combines the four-action Uniswap comparison and the existing v0.1
report explorer. There is no event-specific subpage. The purple UFO and orbital
visuals reuse existing project artwork. The interface identifies recorded results,
local imports and reproducible execution distinctly; the website never runs swaps.

`comparison.mjs` renders the console; `report-validation.mjs` checks its data.
The immutable measured example is in `assets/examples/action-comparison.json`.
Its original wire format and provenance are preserved for compatibility. The
original v0.1 reports remain in `reports/` and use the unchanged `app.js` validator.
The reproduction link pins the existing runner commit while that code awaits review.

Run `npm test` for both report formats, and the Python tests above for the home
page contract and deployment allowlist. Browser verification covers desktop/mobile,
local imports, malformed input, command generation and the earlier report explorer.

Publication remains protected-main-only. An open PR is not a deployed result.
