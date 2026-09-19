# Entrotter documentation and report explorer

[Workspace setup](https://github.com/entrotter/entrotter#quick-start-without-dependencies-or-an-api-key) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [MIT license](LICENSE)

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
only. The original exact strings remain in the JSON and the expandable observation table. Do not treat chart labels
as an exact financial ledger. No imported file is uploaded or saved remotely.

## Deployment

Repository name: `entrotter/entrotter.github.io` (public).
Intended address: https://entrotter.github.io/ . No custom domain or CNAME.
Configure Settings > Pages > Source as GitHub Actions, or use the parent
workspace's reviewed `scripts/publish.py --apply`. Push to main triggers
`.github/workflows/pages.yml`. A workflow file alone is not proof of a live site.

The deploy artifact contains only index.html, 404.html, style.css, app.js, public
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

## Browser accessibility checks

Serving the site and running the unit tests require no npm packages. The optional
browser development tools are exact-version locked in package-lock.json:

```bash
npm ci --ignore-scripts
npx --no-install playwright install chromium
npm audit
npm run test:accessibility
```

The standalone runner starts and closes its own loopback server and Chromium.
It checks all four public samples at 1280, 390 and 320 CSS pixels, skip-link
focus, keyboard sample selection/local-file import, exact chart data, scrollable
tables/JSON, error clearing, reduced motion, forced colors and the 404 page.
Hostile imported text remains inert; requests must be same-origin GETs.
Playwright and axe are development tools and are never deployed to Pages.

Full axe results, screenshots and a summary with source/tool hashes are written
to output/playwright/ (ignored by Git). All axe violations fail the job. Unknown
incomplete rules fail too; incomplete color-contrast results remain in the raw
report, with a separate strict calculation for opaque solid CSS colors. That
calculation is not an axe pass. Manual assistive-technology review and complete
WCAG conformance are not asserted. The 320px viewport check is not a hardware
zoom measurement. No real RPC or model execution is needed for this display test.

The Pages workflow runs these checks and a strict dependency advisory audit on
pull requests; both the unit and browser jobs must pass before main can build a
Pages artifact. Main still requires independent PR approval. To compare another
local checkout with exactly the same runner and browser, set SITE_DIR and a
separate A11Y_OUTPUT directory when invoking the script.
