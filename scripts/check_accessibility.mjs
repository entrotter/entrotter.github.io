// Real Chromium, keyboard and axe checks; no Playwright test runner or app mocks.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { createRequire } from "node:module";
import { chromium } from "playwright";
import {
  parseObservationJSON,
  observationCanonical,
} from "../observed-trace.mjs";

const require = createRequire(import.meta.url);
const runnerHash = createHash("sha256")
  .update(await readFile(new URL(import.meta.url)))
  .digest("hex");
const root = resolve(process.env.SITE_DIR || ".");
const output = resolve(process.env.A11Y_OUTPUT || "output/playwright");
await mkdir(output, { recursive: true });
const axeSource = await readFile(
  require.resolve("axe-core/axe.min.js"),
  "utf8",
);
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".webp": "image/webp",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
};
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url || "/", "http://127.0.0.1").pathname;
    const name = pathname === "/" ? "index.html" : pathname.slice(1);
    if (
      !/^(index\.html|404\.html|style\.css|app\.js|comparison\.mjs|report-validation\.mjs|trace-report\.mjs|trace-comparison\.mjs|trace-viewer\.mjs|observed-trace\.mjs|position-report\.mjs|(?:assets|reports|schemas)\/(?:examples\/)?[a-zA-Z0-9_.-]+)$/.test(
        name,
      )
    ) {
      response.writeHead(404).end();
      return;
    }
    const bytes = await readFile(resolve(root, name));
    response
      .writeHead(200, {
        "Content-Type": types[extname(name)] || "application/octet-stream",
        "Cache-Control": "no-store",
      })
      .end(bytes);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((resolve) =>
  server.listen(0, "127.0.0.1", () => resolve(undefined)),
);
const address = server.address();
if (address === null || typeof address === "string")
  throw new Error("Missing server address");
const origin = `http://127.0.0.1:${address.port}`;
const checks = [],
  scans = [],
  errors = [],
  requests = [];
/** @type {import("playwright").Browser | undefined} */
let browser;
/** @param {string} name @param {() => Promise<void>} work */
async function check(name, work) {
  try {
    await work();
    checks.push({ name, status: "passed" });
  } catch (error) {
    checks.push({
      name,
      status: "failed",
      error: error instanceof Error ? error.stack : String(error),
    });
  }
}
async function pageAt(width = 1280, path = "/") {
  if (!browser) throw new Error("Browser is not running");
  const page = await browser.newPage({
    viewport: { width, height: 900 },
    reducedMotion: "reduce",
  });
  page.setDefaultTimeout(5000);
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("request", (request) =>
    requests.push({ url: request.url(), method: request.method() }),
  );
  await page.goto(origin + path);
  if (path === "/") {
    await page.waitForFunction(() =>
      document
        .querySelector("#report-status")
        ?.textContent?.includes("Integrity verified locally"),
    );
    await page.waitForFunction(
      () =>
        document.querySelector("#c-results") instanceof HTMLElement &&
        !document.getElementById("c-results")?.hidden,
    );
    await page
      .locator("details.archive")
      .evaluate((node) => node.setAttribute("open", ""));
  }
  return page;
}
/** @param {number} width @param {(page: import("playwright").Page) => Promise<void>} work @param {string} [path] */
async function withPage(width, work, path = "/") {
  const page = await pageAt(width, path);
  try {
    await work(page);
  } finally {
    await page.close();
  }
}
/** @param {import("playwright").Page} page */
async function noOverflow(page) {
  const size = await page.evaluate(() => ({
    width: innerWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  assert.ok(size.scroll <= size.width, JSON.stringify(size));
}
/** @param {import("playwright").Page} page @param {string} id */
async function focusIs(page, id) {
  assert.equal(await page.evaluate(() => document.activeElement?.id), id);
}
/** @param {import("playwright").Page} page */
async function visibleFocus(page) {
  assert.ok(
    await page.evaluate(() => {
      const active = document.activeElement;
      if (!active) return false;
      const style = getComputedStyle(active);
      return (
        style.outlineStyle !== "none" && parseFloat(style.outlineWidth) >= 2
      );
    }),
    "Focused control has no visible outline",
  );
}
/** @param {import("playwright").Page} page @param {string} name */
async function scan(page, name) {
  // Diagnostic injection through DevTools only. The website ships no axe script,
  // retains its production CSP, and makes no analyzer/network request.
  await page.evaluate(axeSource);
  const result = await page.evaluate(() =>
    axe.run(document, {
      runOnly: {
        type: "tag",
        values: [
          "wcag2a",
          "wcag2aa",
          "wcag21a",
          "wcag21aa",
          "wcag22aa",
          "best-practice",
        ],
      },
    }),
  );
  await writeFile(
    resolve(output, `axe-${name}.json`),
    JSON.stringify(result, null, 2) + "\n",
  );
  const supplemental = [];
  scans.push({
    name,
    violations: result.violations.map((x) => ({
      id: x.id,
      targets: x.nodes.map((n) => n.target),
    })),
    incomplete: result.incomplete.map((x) => x.id),
    supplemental,
  });
  for (const item of result.incomplete) {
    assert.equal(
      item.id,
      "color-contrast",
      `Unreviewed incomplete rule: ${item.id}`,
    );
    for (const node of item.nodes) {
      assert.equal(node.target.length, 1, "Unexpected shadow/frame target");
      const target = node.target[0];
      assert.equal(typeof target, "string", "Unexpected frame/shadow selector");
      if (typeof target !== "string")
        throw new Error("Selector must be a string");
      const colors = await page.locator(target).evaluate((element) => {
        const foreground = getComputedStyle(element).color;
        let background;
        /** @type {Element | null} */
        let parent = element;
        for (; parent; parent = parent.parentElement) {
          const style = getComputedStyle(parent);
          if (
            style.backgroundImage !== "none" ||
            style.opacity !== "1" ||
            style.filter !== "none"
          )
            throw new Error("Contrast requires visual review of effects");
          if (style.backgroundColor !== "rgba(0, 0, 0, 0)") {
            background = style.backgroundColor;
            break;
          }
        }
        return { foreground, background };
      });
      function luminance(css) {
        const match = /^rgb\((\d+), (\d+), (\d+)\)$/.exec(css);
        assert.ok(match, `Non-opaque/non-RGB color needs review: ${css}`);
        const values = match
          .slice(1)
          .map((x) => Number(x) / 255)
          .map((x) =>
            x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4,
          );
        return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
      }
      const a = luminance(colors.foreground),
        b = luminance(colors.background);
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      supplemental.push({
        target: node.target,
        colors,
        ratio,
        scope:
          "Opaque CSS contrast for clipped/decorative nodes; not an axe pass or screen-reader certification",
      });
      assert.ok(ratio >= 4.5, `Insufficient supplemental contrast: ${ratio}`);
    }
  }
  assert.equal(
    result.violations.length,
    0,
    JSON.stringify(scans.at(-1).violations),
  );
}
function canonical(x) {
  if (Array.isArray(x)) return "[" + x.map(canonical).join(",") + "]";
  if (x !== null && typeof x === "object")
    return (
      "{" +
      Object.keys(x)
        .sort()
        .map((k) => canonical(k) + ":" + canonical(x[k]))
        .join(",") +
      "}"
    );
  return JSON.stringify(x).replace(
    /[\u0080-\uffff]/g,
    (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"),
  );
}

try {
  browser = await chromium.launch();
  for (const width of [1280, 390, 320]) {
    await check(`${width}px console: recorded cards, command and axe`, () =>
      withPage(width, async (page) => {
        await page
          .locator("details.archive")
          .evaluate((node) => node.removeAttribute("open"));
        assert.equal(await page.locator("#c-cards .card").count(), 4);
        assert.equal(await page.locator("#c-cards .recommended").count(), 1);
        await page.locator("#c-amount").fill("0.3");
        await page.getByRole("button", { name: "Build local command" }).click();
        assert.match(
          await page.locator("#c-command").innerText(),
          /--amount 0\.3 /,
        );
        await page.locator("#c-amount").fill("1; curl attacker");
        await page.getByRole("button", { name: "Build local command" }).click();
        assert.match(
          await page.locator("#c-command").innerText(),
          /positive decimal/,
        );
        await noOverflow(page);
        await scan(page, `${width}-console`);
        await page.screenshot({
          path: resolve(output, `${width}-console.png`),
          fullPage: true,
        });
      }),
    );
  }
  await check(
    "Console imports stay local, reject invalid evidence and recover",
    () =>
      withPage(390, async (page) => {
        const original = JSON.parse(
          await readFile(
            resolve(root, "assets/examples/action-comparison.json"),
            "utf8",
          ),
        );
        const hostile = structuredClone(original);
        hostile.report.trials[0].reason = "<img src=x onerror=alert(1)>";
        // This format uses UTF-8 canonical JSON, unlike the older ASCII v0.1 format.
        const { canonical: canonicalComparison } =
          await import("../report-validation.mjs");
        hostile.sha256 = createHash("sha256")
          .update(canonicalComparison(hostile.report))
          .digest("hex");
        const count = requests.length;
        await page.locator("#c-report-file").setInputFiles({
          name: "local.json",
          mimeType: "application/json",
          buffer: Buffer.from(JSON.stringify(hostile)),
        });
        await page.waitForFunction(() =>
          document
            .querySelector("#c-mode")
            ?.textContent?.includes("Imported local"),
        );
        assert.equal(await page.locator("#c-cards img").count(), 0);
        assert.match(await page.locator("#c-cards").innerText(), /<img/);
        assert.equal(requests.length, count);
        for (const bytes of [
          "{",
          JSON.stringify({ ...original, sha256: "0".repeat(64) }),
          " ".repeat(2_000_001),
        ]) {
          await page.locator("#c-report-file").setInputFiles({
            name: "invalid.json",
            mimeType: "application/json",
            buffer: Buffer.from(bytes),
          });
          await page.waitForFunction(
            () =>
              document.querySelector("#c-mode")?.textContent ===
              "Report rejected",
          );
          assert.equal(await page.locator("#c-results").isVisible(), false);
          assert.equal(await page.locator("#c-download").isDisabled(), true);
          assert.equal(await page.locator("#c-cards").innerHTML(), "");
          assert.equal(requests.length, count);
        }
        await page.locator("#c-report-file").setInputFiles({
          name: "valid.json",
          mimeType: "application/json",
          buffer: Buffer.from(JSON.stringify(original)),
        });
        await page.waitForFunction(() =>
          document
            .querySelector("#c-mode")
            ?.textContent?.includes("Imported local"),
        );
        assert.equal(await page.locator("#c-results").isVisible(), true);
        await scan(page, "console-import");
      }),
  );
  await check(
    "A slow recorded load cannot replace a newer rejected import",
    () =>
      withPage(390, async (page) => {
        let release;
        const held = new Promise((resolve) => {
          release = resolve;
        });
        let started;
        const intercepted = new Promise((resolve) => {
          started = resolve;
        });
        await page.route(
          "**/assets/examples/action-comparison.json",
          async (route) => {
            started();
            await held;
            await route.fulfill({
              contentType: "application/json",
              body: await readFile(
                resolve(root, "assets/examples/action-comparison.json"),
                "utf8",
              ),
            });
          },
        );
        await page.locator("#c-sample").click();
        await intercepted;
        await page.locator("#c-report-file").setInputFiles({
          name: "invalid.json",
          mimeType: "application/json",
          buffer: Buffer.from("{"),
        });
        await page.waitForFunction(
          () =>
            document.querySelector("#c-mode")?.textContent ===
            "Report rejected",
        );
        const response = page.waitForResponse(
          "**/assets/examples/action-comparison.json",
        );
        release();
        await (await response).finished();
        // Wait for the stale response's validation digests to drain, with no sleep.
        await page.evaluate(async () => {
          for (let i = 0; i < 8; i++)
            await crypto.subtle.digest("SHA-256", new Uint8Array());
        });
        assert.equal(
          await page.locator("#c-mode").innerText(),
          "Report rejected",
        );
        assert.equal(await page.locator("#c-results").isVisible(), false);
      }),
  );
  await check(
    "Keyboard skip link moves focus into main and skips navigation",
    () =>
      withPage(1280, async (page) => {
        await page.keyboard.press("Tab");
        assert.equal(
          await page.locator(":focus").innerText(),
          "Skip to content",
        );
        await visibleFocus(page);
        await page.keyboard.press("Enter");
        await focusIs(page, "main");
        await page.keyboard.press("Tab");
        assert.match(
          await page.locator(":focus").innerText(),
          /Enter the console/,
        );
      }),
  );
  await check(
    "Keyboard sample selection, native local-file chooser, live status and inert import",
    () =>
      withPage(1280, async (page) => {
        await page.locator("#scenario").focus();
        await visibleFocus(page);
        await page.keyboard.press("r");
        await page.keyboard.press("Tab");
        await page.waitForFunction(() =>
          document
            .querySelector("#report-status")
            ?.textContent?.includes("recovery trap"),
        );
        assert.ok(
          (await page.locator("#delta-value").innerText()).startsWith("-"),
        );
        assert.equal(
          await page.locator("#report-status").getAttribute("aria-atomic"),
          "true",
        );
        assert.equal(
          await page.locator(".metrics").getAttribute("aria-live"),
          null,
        );
        await focusIs(page, "import");
        const chooser = page.waitForEvent("filechooser");
        await page.keyboard.press("Enter");
        const report = JSON.parse(
          await readFile(resolve(root, "reports/liquidity-shock.json"), "utf8"),
        );
        delete report.artifact_id;
        report.scenario.title = "<img src=x onerror=alert(1)> 🛸";
        report.artifact_id = createHash("sha256")
          .update(canonical(report))
          .digest("hex");
        const count = requests.length;
        await (
          await chooser
        ).setFiles({
          name: "local-report.json",
          mimeType: "application/json",
          buffer: Buffer.from(JSON.stringify(report)),
        });
        await page.waitForFunction(() =>
          document
            .querySelector("#report-status")
            ?.textContent?.includes("<img"),
        );
        assert.equal(
          await page.locator("#scenario").inputValue(),
          "local-report",
        );
        assert.equal(await page.locator("#report-status img").count(), 0);
        assert.equal(requests.length, count);
        assert.equal(await page.locator("#download").isVisible(), false);
      }),
  );
  await check(
    "Local report source survives stale samples and restores the same example",
    () =>
      withPage(390, async (page) => {
        for (const outcome of ["valid", "invalid", "stale-error"]) {
          let release;
          let started;
          const held = new Promise((resolve) => {
            release = resolve;
          });
          const intercepted = new Promise((resolve) => {
            started = resolve;
          });
          await page.route("**/reports/recovery-trap.json", async (route) => {
            started();
            await held;
            await route.fulfill({
              status: outcome === "stale-error" ? 500 : 200,
              contentType: "application/json",
              body: await readFile(
                resolve(root, "reports/recovery-trap.json"),
                "utf8",
              ),
            });
          });
          try {
            // Capture the actual handler promise so stale completion is observed,
            // rather than inferred from a delay or unrelated digest scheduling.
            await page.evaluate(() => {
              const selection = document.querySelector("#scenario");
              if (!(selection instanceof HTMLSelectElement))
                throw new Error("Missing selector");
              selection.value = "recovery-trap";
              Object.defineProperty(window, "sampleLoadCompletion", {
                value: Reflect.get(window, "loadSample")(),
                configurable: true,
              });
            });
            await intercepted;
            assert.equal(
              await page.locator("#scenario").inputValue(),
              "loading",
            );
            assert.equal(
              await page.locator("#metric-table").isVisible(),
              false,
            );
            assert.equal(await page.locator("#raw-report").textContent(), "");
            const count = requests.length;
            await page.locator("#import").setInputFiles({
              name: "local-report.json",
              mimeType: "application/json",
              buffer:
                outcome === "invalid"
                  ? Buffer.from("{")
                  : await readFile(
                      resolve(root, "reports/liquidity-shock.json"),
                    ),
            });
            const expected =
              outcome === "invalid" ? "no-report" : "local-report";
            await page.waitForFunction((value) => {
              const node = document.querySelector("#scenario");
              return node instanceof HTMLSelectElement && node.value === value;
            }, expected);
            assert.equal(requests.length, count);
            const response = page.waitForResponse(
              "**/reports/recovery-trap.json",
            );
            release();
            await (await response).finished();
            await page.evaluate(() =>
              Reflect.get(window, "sampleLoadCompletion"),
            );
            assert.equal(
              await page.locator("#scenario").inputValue(),
              expected,
            );
            assert.equal(await page.locator("#download").isVisible(), false);
            assert.equal(
              await page.locator("#metric-table").isVisible(),
              outcome !== "invalid",
            );
            await noOverflow(page);
            if (outcome === "valid")
              await page.locator("#reports").screenshot({
                path: resolve(output, "local-report-source-390.png"),
              });
            await page.locator("#import").setInputFiles([]);
            assert.equal(
              await page.locator("#scenario").inputValue(),
              expected,
            );
          } finally {
            release();
            await page.unroute("**/reports/recovery-trap.json");
          }
          await page.selectOption("#scenario", "liquidity-shock");
          await page.waitForFunction(() =>
            document
              .querySelector("#report-status")
              ?.textContent?.includes("Integrity verified locally"),
          );
          assert.equal(
            await page.locator("#scenario").inputValue(),
            "liquidity-shock",
          );
          assert.equal(
            await page.locator("#download").getAttribute("href"),
            "reports/liquidity-shock.json",
          );
          assert.equal(await page.locator("#download").isVisible(), true);
        }
      }),
  );
  await check(
    "Recorded agent imports preserve reasons, reject resealed mismatches, clear and recover",
    () =>
      withPage(1280, async (page) => {
        const original = JSON.parse(
          await readFile(
            resolve(root, "reports/agent-local-codex.json"),
            "utf8",
          ),
        );
        const upload = async (report) => {
          delete report.artifact_id;
          report.artifact_id = createHash("sha256")
            .update(canonical(report))
            .digest("hex");
          await page.locator("#import").setInputFiles({
            name: "agent.json",
            mimeType: "application/json",
            buffer: Buffer.from(JSON.stringify(report)),
          });
        };
        const hostile = structuredClone(original);
        hostile.agent.exchanges[0].response.reason =
          "<img src=x onerror=alert(1)> 🛸";
        hostile.candidate.trace[0].agent_decision.reason =
          hostile.agent.exchanges[0].response.reason;
        const count = requests.length;
        await upload(hostile);
        await page.waitForFunction(() =>
          document.querySelector("#agent-rows")?.textContent?.includes("<img"),
        );
        assert.equal(await page.locator("#agent-rows img").count(), 0);
        assert.equal(requests.length, count);
        for (const mutate of [
          (r) => {
            r.agent.exchanges[0].response.step = 31;
          },
          (r) => {
            r.candidate.trace[0].agent_decision.reason = "unrelated";
          },
          (r) => {
            r.agent.exchanges[0].request.observation.step = 31;
          },
          (r) => {
            r.agent.exchanges[0].response.choice = ["hold"];
            r.candidate.trace[0].agent_decision.choice = ["hold"];
          },
          (r) => {
            r.candidate.trace[1].status = "success";
            r.candidate.trace[1].gas_used = "21000";
          },
          (r) => {
            r.agent.exchanges[0].request.proposed_action.to =
              "0x" + "f".repeat(40);
            r.candidate.trace[0].action.to = "0x" + "f".repeat(40);
          },
          (r) => {
            r.candidate.trace[0].receipt.status = "0x0";
          },
        ]) {
          const report = structuredClone(original);
          mutate(report);
          for (const exchange of report.agent.exchanges) {
            const { request_id, ...request } = exchange.request;
            const id = createHash("sha256")
              .update(canonical(request))
              .digest("hex");
            exchange.request.request_id = id;
            exchange.response.request_id = id;
            if (request.observation.step < report.candidate.trace.length)
              report.candidate.trace[
                request.observation.step
              ].agent_decision.request_id = id;
          }
          await upload(report);
          await page.waitForFunction(() =>
            document
              .querySelector("#report-status")
              ?.classList.contains("error"),
          );
          assert.equal(await page.locator("#agent-details").isVisible(), false);
          assert.equal(await page.locator("#agent-rows tr").count(), 0);
          assert.equal(await page.locator("#agent-provenance").innerText(), "");
          assert.equal(await page.locator("#download").isVisible(), false);
          assert.equal(requests.length, count);
          await upload(structuredClone(original));
          await page.waitForFunction(
            () =>
              !document
                .querySelector("#report-status")
                ?.classList.contains("error"),
          );
          assert.equal(await page.locator("#agent-rows tr").count(), 2);
        }
        await page.selectOption("#scenario", "liquidity-shock");
        await page.waitForFunction(
          () =>
            document.querySelector("#fixture-chart") instanceof HTMLElement &&
            !document.getElementById("fixture-chart")?.hidden,
        );
        assert.equal(await page.locator("#agent-details").isVisible(), false);
        assert.equal(await page.locator("#agent-rows tr").count(), 0);
      }),
  );
  for (const width of [1280, 390, 320]) {
    for (const sample of [
      "liquidity-shock",
      "recovery-trap",
      "depeg-stress",
      "ethereum-uniswap-slippage",
      "agent-local-codex",
    ]) {
      await check(
        `${width}px ${sample}: reflow, exact accessible data and axe`,
        () =>
          withPage(width, async (page) => {
            const report = JSON.parse(
              await readFile(resolve(root, `reports/${sample}.json`), "utf8"),
            );
            await page.selectOption("#scenario", sample);
            await page.waitForFunction(
              (id) => document.querySelector("#hash")?.textContent === id,
              report.artifact_id,
            );
            await noOverflow(page);
            if (report.agent) {
              assert.equal(
                await page.locator("#agent-rows tr").count(),
                report.agent.exchanges.length,
              );
              const text = await page.locator("#agent-provenance").innerText();
              assert.match(text, /requested alias/);
              assert.match(text, /Nondeterministic/);
              assert.match(text, /Original generation cost.*Unavailable/);
              for (const exchange of report.agent.exchanges)
                assert.ok(
                  (await page.locator("#agent-rows").innerText()).includes(
                    exchange.response.reason,
                  ),
                );
              await page.locator("#agent-details .table-wrap").focus();
              await visibleFocus(page);
              if (width === 320) {
                await page.keyboard.press("ArrowRight");
                await page.waitForFunction(
                  () =>
                    (document.querySelector("#agent-details .table-wrap")
                      ?.scrollLeft ?? 0) > 0,
                );
              }
              await page.locator("#agent-details").screenshot({
                path: resolve(output, `${width}-agent-evidence.png`),
              });
            } else
              assert.equal(
                await page.locator("#agent-details").isVisible(),
                false,
              );
            if (report.mode === "fixture") {
              const summary = page.getByText("Equity values by observation", {
                exact: true,
              });
              await summary.focus();
              await page.keyboard.press("Enter");
              const rows = await page
                .locator("#equity-rows tr")
                .allTextContents();
              assert.equal(rows.length, report.baseline.trace.length);
              const actual = await page
                .locator("#equity-rows tr")
                .evaluateAll((rows) =>
                  rows.map((row) => {
                    if (!(row instanceof HTMLTableRowElement))
                      throw new Error("Expected table row");
                    return [...row.cells].map((cell) => cell.textContent);
                  }),
                );
              assert.deepEqual(
                actual,
                report.baseline.trace.map((point, i) => [
                  String(i + 1),
                  point.equity,
                  report.candidate.trace[i].equity,
                ]),
              );
              assert.equal(
                await page.locator('#equity-rows th[scope="row"]').count(),
                rows.length,
              );
            } else {
              assert.equal(
                await page.locator("#fixture-chart").isVisible(),
                false,
              );
              assert.match(
                await page.locator("#source-pin").innerText(),
                report.mode === "evm-fork"
                  ? /19000000/
                  : /Local disposable chain/,
              );
              const region = page.getByRole("region", {
                name: "Supplied actions on isolated local forks",
              });
              if (width === 320) {
                await region.focus();
                await visibleFocus(page);
                await page.keyboard.press("ArrowRight");
                await page.waitForFunction(
                  () =>
                    (document.querySelector("#evm-details .table-wrap")
                      ?.scrollLeft ?? 0) > 0,
                );
              }
            }
            assert.ok(
              (await page.locator('#metric-rows th[scope="row"]').count()) > 0,
            );
            await page.getByText("Full result JSON", { exact: true }).focus();
            await page.keyboard.press("Enter");
            await page.keyboard.press("Tab");
            await focusIs(page, "raw-report");
            await visibleFocus(page);
            await page.keyboard.press("PageDown");
            await page.waitForFunction(
              () => (document.querySelector("#raw-report")?.scrollTop ?? 0) > 0,
            );
            await scan(page, `${width}-${sample}`);
            if (
              sample === "ethereum-uniswap-slippage" ||
              (sample === "liquidity-shock" && width === 1280)
            ) {
              await page.screenshot({
                path: resolve(output, `${width}-${sample}.png`),
                fullPage: true,
              });
              await page
                .locator("#reports .section-head")
                .scrollIntoViewIfNeeded();
              await page.screenshot({
                path: resolve(output, `${width}-${sample}-viewport.png`),
              });
            }
          }),
      );
    }
  }
  await check(
    "Tampered import clears data, reports an accessible error and recovers",
    () =>
      withPage(390, async (page) => {
        const report = JSON.parse(
          await readFile(resolve(root, "reports/liquidity-shock.json"), "utf8"),
        );
        report.candidate.metrics.final_equity = "999999";
        await page.locator("#import").setInputFiles({
          name: "tampered.json",
          mimeType: "application/json",
          buffer: Buffer.from(JSON.stringify(report)),
        });
        await page.waitForFunction(() =>
          document
            .querySelector("#report-status")
            ?.textContent?.includes("mismatch"),
        );
        assert.equal(await page.locator("#scenario").inputValue(), "no-report");
        assert.equal(await page.locator("#candidate-value").innerText(), "—");
        assert.equal(await page.locator("#equity-rows tr").count(), 0);
        assert.equal(await page.locator("#fixture-chart").isVisible(), false);
        await scan(page, "error");
        await page.selectOption("#scenario", "recovery-trap");
        await page.waitForFunction(() =>
          document
            .querySelector("#report-status")
            ?.textContent?.includes("Synthetic recovery trap"),
        );
        assert.equal(
          await page.locator("#scenario").inputValue(),
          "recovery-trap",
        );
        assert.equal(await page.locator("#metric-table").isVisible(), true);
        assert.equal(await page.locator("#fixture-chart").isVisible(), true);
        assert.ok((await page.locator("#equity-rows tr").count()) > 0);
      }),
  );
  await check(
    "Correctly hashed non-decimal metrics fail, clear data and recover without uploads",
    () =>
      withPage(390, async (page) => {
        for (const value of ["", " ", "\t", "0x10", "0b11", "0o10"]) {
          const report = JSON.parse(
            await readFile(
              resolve(root, "reports/liquidity-shock.json"),
              "utf8",
            ),
          );
          delete report.artifact_id;
          report.candidate.metrics.final_equity = value;
          report.artifact_id = createHash("sha256")
            .update(canonical(report))
            .digest("hex");
          const count = requests.length;
          await page.locator("#import").setInputFiles({
            name: "invalid-metric.json",
            mimeType: "application/json",
            buffer: Buffer.from(JSON.stringify(report)),
          });
          await page.waitForFunction(() =>
            document
              .querySelector("#report-status")
              ?.textContent?.includes("Invalid metric"),
          );
          assert.equal(await page.locator("#candidate-value").innerText(), "—");
          assert.equal(await page.locator("#equity-rows tr").count(), 0);
          assert.equal(await page.locator("#raw-report").innerText(), "");
          assert.equal(await page.locator("#metric-table").isVisible(), false);
          assert.equal(await page.locator("#download").isVisible(), false);
          assert.equal(requests.length, count);
          // Force a different selection after every invalid local import.
          await page.selectOption("#scenario", "liquidity-shock");
          await page.selectOption("#scenario", "recovery-trap");
          await page.waitForFunction(() =>
            document
              .querySelector("#report-status")
              ?.textContent?.includes("Synthetic recovery trap"),
          );
          assert.equal(await page.locator("#metric-table").isVisible(), true);
        }
      }),
  );
  await check(
    "Forced colors, reduced motion and keyboard focus remain usable",
    () =>
      withPage(320, async (page) => {
        await page.emulateMedia({
          forcedColors: "active",
          reducedMotion: "reduce",
        });
        assert.equal(
          await page.evaluate(
            () => getComputedStyle(document.documentElement).scrollBehavior,
          ),
          "auto",
        );
        await page.locator("#scenario").focus();
        await visibleFocus(page);
        await noOverflow(page);
        const strokes = await page
          .locator("#chart .line")
          .evaluateAll((lines) =>
            lines.map((x) => ({
              color: getComputedStyle(x).stroke,
              dash: getComputedStyle(x).strokeDasharray,
            })),
          );
        assert.equal(strokes[0].color, strokes[1].color);
        assert.notEqual(strokes[0].dash, strokes[1].dash);
        await page.screenshot({
          path: resolve(output, "forced-colors.png"),
          fullPage: true,
        });
      }),
  );
  await check(
    "404 page at 320px: keyboard home link, no overflow and axe",
    () =>
      withPage(
        320,
        async (page) => {
          await noOverflow(page);
          await page.keyboard.press("Tab");
          assert.match(
            await page.locator(":focus").innerText(),
            /Back to Entrotter/,
          );
          await scan(page, "404");
          await page.keyboard.press("Enter");
          await page.waitForFunction(() =>
            document
              .querySelector("#report-status")
              ?.textContent?.includes("Integrity verified locally"),
          );
        },
        "/404.html",
      ),
  );
  for (const width of [1280, 390, 320]) {
    await check(
      `${width}px signed prefix: exact evidence, keyboard, reflow and axe`,
      () =>
        withPage(width, async (page) => {
          await page.locator(".trace-archive > summary").focus();
          await visibleFocus(page);
          await page.keyboard.press("Enter");
          await page.locator("#trace-sample").focus();
          await page.keyboard.press("Enter");
          await page.waitForFunction(() =>
            document
              .querySelector("#trace-status")
              ?.textContent?.includes("matches all original"),
          );
          assert.equal(
            await page.locator("#trace-case").innerText(),
            "Loaded prefix: 4 original transactions · through_index 3 · skip_indices [0]",
          );
          assert.equal(await page.locator("#trace-inputs tr").count(), 4);
          const table = await page.locator("#trace-outcomes").innerText();
          for (const value of [
            "208144",
            "245136",
            "185721",
            "nonce_conflict",
            "expected 5522, original 5523",
            "gasUsed, cumulativeGasUsed, transactionIndex, logs",
          ])
            assert.ok(table.includes(value), value);
          assert.equal(
            await page.locator("#trace-download").getAttribute("href"),
            "reports/trace-mainnet-prefix-four.json",
          );
          await page
            .locator("#trace-receipts details")
            .nth(1)
            .locator("summary")
            .focus();
          await page.keyboard.press("Enter");
          assert.ok(
            (
              await page.locator("#trace-receipts pre").nth(1).innerText()
            ).includes('"logs"'),
          );
          await page
            .locator("#trace-outcomes")
            .locator("..")
            .locator("..")
            .focus();
          await page.keyboard.press("ArrowRight");
          if (width < 700)
            await page.waitForFunction(() => {
              const wrapper =
                document.querySelector("#trace-outcomes")?.parentElement
                  ?.parentElement;
              return (
                wrapper !== null &&
                wrapper !== undefined &&
                wrapper.scrollLeft > 0
              );
            });
          await noOverflow(page);
          await scan(page, `signed-prefix-${width}`);
          await page.locator("#transaction-replay").screenshot({
            path: resolve(output, `${width}-signed-prefix.png`),
          });
          // Import through the actual keyboard file chooser; no upload or fetch.
          const original = JSON.parse(
            await readFile(
              resolve(root, "reports/trace-mainnet-prefix-four.json"),
              "utf8",
            ),
          );
          original.assumptions[0] = "<img src=x onerror=alert(1)> 🛸";
          delete original.artifact_id;
          original.artifact_id = createHash("sha256")
            .update(canonical(original))
            .digest("hex");
          const count = requests.length;
          // Enter the native file control through sequential keyboard focus,
          // as in the existing console chooser check, after leaving the table.
          await page.locator("#trace-sample").focus();
          await page.keyboard.press("Tab");
          await focusIs(page, "trace-price-sample");
          await page.keyboard.press("Tab");
          await focusIs(page, "trace-account-sample");
          await page.keyboard.press("Tab");
          await focusIs(page, "trace-import");
          await visibleFocus(page);
          const chooser = page.waitForEvent("filechooser");
          await page.keyboard.press("Enter");
          await (
            await chooser
          ).setFiles({
            name: "local-trace.json",
            mimeType: "application/json",
            buffer: Buffer.from(JSON.stringify(original)),
          });
          await page.waitForFunction(() =>
            document
              .querySelector("#trace-origin")
              ?.textContent?.includes("Local import"),
          );
          assert.equal(requests.length, count);
          assert.equal(
            await page.locator("#trace-download").isVisible(),
            false,
          );
          assert.equal(await page.locator("#trace-assumptions img").count(), 0);
          assert.ok(
            (
              (await page.locator("#trace-assumptions").textContent()) || ""
            ).includes("<img"),
          );
          // Existing v0.1 pane retains its selected report and original rows.
          assert.ok(
            (await page.locator("#report-status").innerText()).includes(
              "Integrity verified locally",
            ),
          );
        }),
    );
  }
  for (const width of [1280, 390, 320]) {
    await check(
      `${width}px original32 local import: omission, structural shifts and exact fields`,
      () =>
        withPage(width, async (page) => {
          await page.locator(".trace-archive > summary").click();
          const before = requests.length;
          await page
            .locator("#trace-import")
            .setInputFiles(
              resolve(root, "tests/data/trace-oracle-prefix-32.json"),
            );
          await page.waitForFunction(() =>
            document
              .querySelector("#trace-comparison-summary")
              ?.textContent?.includes("19 position / cumulative gas only"),
          );
          const summary = await page
            .locator("#trace-comparison-summary")
            .innerText();
          for (const value of [
            "1 omitted",
            "0 execution receipt differences",
            "12 exact original receipt matches",
            "0 unavailable receipts",
          ])
            assert.ok(summary.includes(value), value);
          assert.equal(requests.length, before);
          assert.equal(
            await page.locator("#trace-case").innerText(),
            "Loaded prefix: 32 original transactions · through_index 31 · skip_indices [12]",
          );
          assert.equal(await page.locator("#trace-outcomes tr").count(), 32);
          const omitted = page.locator("#trace-outcomes tr").nth(12);
          assert.ok(
            (await omitted.innerText()).includes("Omitted · no receipt"),
          );
          const shifted = page.locator("#trace-outcomes tr").nth(13);
          assert.ok(
            (await shifted.innerText()).includes(
              "Position / cumulative gas only",
            ),
          );
          assert.equal(
            await shifted.locator("td").last().innerText(),
            "cumulativeGasUsed, transactionIndex",
          );
          await page
            .locator("#trace-receipts details")
            .nth(13)
            .locator("summary")
            .focus();
          await page.keyboard.press("Enter");
          const exact = JSON.parse(
            await page.locator("#trace-receipts pre").nth(13).innerText(),
          );
          assert.equal(exact.original.gasUsed, exact.candidate.gasUsed);
          assert.deepEqual(exact.original.logs, exact.candidate.logs);
          assert.notEqual(
            exact.original.transactionIndex,
            exact.candidate.transactionIndex,
          );
          assert.equal(
            await page.locator("#trace-download").isVisible(),
            false,
          );
          await page
            .locator("#trace-outcomes")
            .locator("..")
            .locator("..")
            .focus();
          await visibleFocus(page);
          await page.keyboard.press("ArrowRight");
          if (width < 700)
            await page.waitForFunction(() => {
              const wrapper =
                document.querySelector("#trace-outcomes")?.parentElement
                  ?.parentElement;
              return (
                wrapper !== null &&
                wrapper !== undefined &&
                wrapper.scrollLeft > 0
              );
            });
          await noOverflow(page);
          await scan(page, `original32-${width}`);
          await page
            .locator("#trace-comparison-summary")
            .scrollIntoViewIfNeeded();
          await page.screenshot({
            path: resolve(output, `${width}-original32-summary.png`),
          });
          await shifted.scrollIntoViewIfNeeded();
          await page.screenshot({
            path: resolve(output, `${width}-original32-shift.png`),
          });
        }),
    );
  }
  for (const width of [1280, 390, 320]) {
    await check(
      `Observed prices: exact values, unproven views, rejection and clearing ${width}px`,
      () =>
        withPage(width, async (page) => {
          await page.locator(".trace-archive > summary").click();
          await page.locator("#trace-price-sample").focus();
          await page.keyboard.press("Enter");
          await page.waitForFunction(() =>
            document
              .querySelector("#trace-price-summary")
              ?.textContent?.includes("7.89973126"),
          );
          assert.equal(await page.locator("#trace-price-rows tr").count(), 4);
          assert.equal(await page.locator("#trace-outcomes tr").count(), 32);
          assert.ok(
            (await page.locator("#trace-price-summary").innerText()).includes(
              "not profit",
            ),
          );
          assert.ok(
            (await page.locator("#trace-price-rows").innerText()).includes(
              "256292441874",
            ),
          );
          assert.equal(
            await page.locator("#trace-download").getAttribute("href"),
            "reports/trace-observed-price32.json",
          );
          await page
            .locator("#trace-price-rows")
            .locator("..")
            .locator("..")
            .focus();
          await visibleFocus(page);
          await noOverflow(page);
          await scan(page, `observed-price-${width}`);
          await page.locator("#trace-price-heading").scrollIntoViewIfNeeded();
          await page.screenshot({
            path: resolve(output, `${width}-observed-price.png`),
          });
          const template = parseObservationJSON(
            await readFile(
              resolve(root, "reports/trace-observed-price32.json"),
              "utf8",
            ),
          );
          const controls = parseObservationJSON(
            await readFile(
              resolve(root, "tests/data/observed-controls.json"),
              "utf8",
            ),
          );
          const importRow = async (row) => {
            const text = observationCanonical(row);
            const before = requests.length;
            await page.locator("#trace-import").setInputFiles({
              name: "local-price.json",
              mimeType: "application/json",
              buffer: Buffer.from(text),
            });
            await page.waitForFunction(
              (id) => document.querySelector("#trace-hash")?.textContent === id,
              row.artifact_id,
            );
            assert.equal(requests.length, before);
          };
          const large = controls.find((row) => row.name === "large_integer");
          const big = {
            ...template,
            observations: large.observations,
            classification: large.classification,
            artifact_id: large.artifact_id,
          };
          await importRow(big);
          assert.ok(
            (await page.locator("#trace-price-rows").innerText()).includes(
              (2n ** 200n).toString(),
            ),
          );
          assert.ok(
            (await page.locator("#trace-price-summary").innerText()).includes(
              "USD 0.00000010",
            ),
          );
          assert.equal(
            await page.locator("#trace-raw").textContent(),
            observationCanonical(big),
          );
          const missing = controls.find(
            (row) => row.name === "rpc_missing_head",
          );
          await importRow({
            ...template,
            observations: missing.observations,
            classification: missing.classification,
            artifact_id: missing.artifact_id,
          });
          assert.ok(
            (await page.locator("#trace-price-summary").innerText()).startsWith(
              "UNPROVEN",
            ),
          );
          assert.ok(
            (await page.locator("#trace-price-rows").innerText()).includes(
              "head: rpc_error",
            ),
          );
          await scan(page, `observed-unproven-${width}`);
          const bad = structuredClone(template);
          bad.classification.price_difference++;
          const { artifact_id, ...body } = bad;
          bad.artifact_id = createHash("sha256")
            .update(observationCanonical(body))
            .digest("hex");
          await page.locator("#trace-import").setInputFiles({
            name: "invalid-price.json",
            mimeType: "application/json",
            buffer: Buffer.from(observationCanonical(bad)),
          });
          await page.waitForFunction(() =>
            document
              .querySelector("#trace-status")
              ?.classList.contains("error"),
          );
          assert.equal(
            await page.locator("#trace-price-results").isVisible(),
            false,
          );
          for (const id of [
            "trace-price-summary",
            "trace-price-rows",
            "trace-price-identities",
            "trace-raw",
            "trace-hash",
          ])
            assert.equal(await page.locator(`#${id}`).textContent(), "");
          assert.equal(
            await page.locator("#trace-download").getAttribute("href"),
            null,
          );
          await page.locator("#trace-sample").click();
          await page.waitForFunction(
            () => document.querySelectorAll("#trace-outcomes tr").length === 4,
          );
          assert.equal(
            await page.locator("#trace-price-results").isVisible(),
            false,
          );
          assert.equal(await page.locator("#trace-price-rows tr").count(), 0);
        }),
    );
  }
  for (const width of [1280, 390, 320]) {
    await check(
      `Account impact: exact units, missing views, sentinel, recovery and keyboard ${width}px`,
      () =>
        withPage(width, async (page) => {
          await page.locator(".trace-archive > summary").click();
          await page.locator("#trace-price-sample").focus();
          await page.keyboard.press("Tab");
          await focusIs(page, "trace-account-sample");
          await visibleFocus(page);
          await page.keyboard.press("Enter");
          await page.waitForFunction(
            () => document.querySelectorAll("#trace-outcomes tr").length === 13,
          );
          assert.equal(
            await page.locator("#trace-account-results").isVisible(),
            true,
          );
          assert.ok(
            (await page.locator("#trace-origin").innerText()).includes(
              "default-Docker13",
            ),
          );
          assert.ok(
            (
              await page.locator("#trace-account-comparison").innerText()
            ).includes("816.28966124"),
          );
          assert.ok(
            (
              await page.locator("#trace-account-comparison").innerText()
            ).includes("0.003852169807877337"),
          );
          assert.equal(
            await page.locator("#trace-account-comparison tr").count(),
            6,
          );
          assert.equal(
            await page.locator("#trace-account-capacity-delta").innerText(),
            "+816.28966124",
          );
          assert.equal(
            await page.locator("#trace-account-health-delta").innerText(),
            "+0.003852169807877337",
          );
          const summaryTree = await page
            .locator(".account-impact-summary")
            .ariaSnapshot();
          assert.ok(summaryTree.includes("Borrowing capacity change (USD)"));
          assert.ok(summaryTree.includes("Health factor change"));
          const summaryBox = await page
            .locator(".account-impact-summary")
            .boundingBox();
          const tableBox = await page
            .locator("#trace-account-comparison")
            .boundingBox();
          assert.ok(
            summaryBox &&
              tableBox &&
              summaryBox.y + summaryBox.height <= tableBox.y,
          );
          if (width <= 680) {
            const capacityBox = await page
              .locator("#trace-account-capacity-delta")
              .boundingBox();
            const healthBox = await page
              .locator("#trace-account-health-delta")
              .boundingBox();
            assert.ok(
              capacityBox &&
                healthBox &&
                capacityBox.y + capacityBox.height < healthBox.y,
            );
          }
          assert.equal(await page.locator("#trace-account-rows tr").count(), 4);
          assert.equal(await page.locator("#trace-price-rows tr").count(), 4);
          assert.equal(
            await page.locator("#trace-download").getAttribute("href"),
            "reports/aave-account-impact13.json",
          );
          await page
            .locator("#trace-account-comparison")
            .locator("..")
            .locator("..")
            .focus();
          await visibleFocus(page);
          await noOverflow(page);
          await scan(page, `account-impact-${width}`);
          await page.locator("#trace-account-heading").scrollIntoViewIfNeeded();
          await page.screenshot({
            path: resolve(output, `${width}-account-impact.png`),
          });
          const template = parseObservationJSON(
            await readFile(
              resolve(root, "reports/aave-account-impact13.json"),
              "utf8",
            ),
          );
          const controls = parseObservationJSON(
            await readFile(
              resolve(root, "tests/data/position-controls.json"),
              "utf8",
            ),
          );
          // Explicit synthetic display controls: reverse both after-values or
          // make them equal. Provider/price/trace records remain unchanged.
          for (const name of ["negative_change", "zero_change"]) {
            const synthetic = structuredClone(template);
            const before = structuredClone(template.classification.baseline);
            const after = structuredClone(template.classification.candidate);
            if (name === "negative_change") {
              synthetic.observations[1].raw = template.observations[3].raw;
              synthetic.observations[3].raw = template.observations[1].raw;
              synthetic.classification.baseline = after;
              synthetic.classification.candidate = before;
            } else {
              synthetic.observations[3].raw = template.observations[1].raw;
              synthetic.classification.candidate = before;
            }
            synthetic.classification.differences = Object.fromEntries(
              Object.entries(template.classification.differences).map(
                ([key, value]) => [key, name === "zero_change" ? 0n : -value],
              ),
            );
            const { artifact_id, ...body } = synthetic;
            synthetic.artifact_id = createHash("sha256")
              .update(observationCanonical(body))
              .digest("hex");
            controls.push({ name, ...synthetic });
          }
          const importsStart = requests.length;
          for (const name of [
            "missing_account",
            "large_integer",
            "no_debt",
            "debt_transition",
            "health_boundary",
            "negative_change",
            "zero_change",
          ]) {
            const control = controls.find((row) => row.name === name);
            assert.ok(control);
            const imported = structuredClone(template);
            Object.assign(imported, {
              observations: control.observations,
              classification: control.classification,
              artifact_id: control.artifact_id,
            });
            await page.locator("#trace-import").setInputFiles({
              name: `${name}.json`,
              mimeType: "application/json",
              buffer: Buffer.from(observationCanonical(imported)),
            });
            await page.waitForFunction(
              (id) => document.querySelector("#trace-hash")?.textContent === id,
              control.artifact_id,
            );
            const expectedCapacity =
              name === "missing_account"
                ? "Unavailable"
                : name === "large_integer"
                  ? "+0.0000001"
                  : name === "negative_change"
                    ? "−816.28966124"
                    : name === "zero_change"
                      ? "0"
                      : "+0.00000001";
            const expectedHealth =
              name === "missing_account"
                ? "Unavailable"
                : name === "no_debt" || name === "debt_transition"
                  ? "Not defined (no debt)"
                  : name === "negative_change"
                    ? "−0.003852169807877337"
                    : name === "zero_change"
                      ? "0"
                      : "+0.000000000000000001";
            assert.equal(
              await page.locator("#trace-account-capacity-delta").innerText(),
              expectedCapacity,
            );
            assert.equal(
              await page.locator("#trace-account-health-delta").innerText(),
              expectedHealth,
            );
            if (name === "missing_account") {
              assert.ok(
                (
                  await page.locator("#trace-account-summary").innerText()
                ).includes("UNPROVEN"),
              );
              assert.ok(
                (
                  await page.locator("#trace-account-comparison").innerText()
                ).includes("Unavailable"),
              );
              assert.ok(
                !(
                  await page.locator("#trace-account-comparison").innerText()
                ).includes("816.28966124"),
              );
            } else if (name === "large_integer") {
              await page
                .locator("#trace-account-rows")
                .locator("..")
                .locator("..")
                .locator("..")
                .evaluate((node) => node.setAttribute("open", ""));
              assert.ok(
                (
                  (await page.locator("#trace-account-rows").textContent()) ??
                  ""
                ).includes((2n ** 200n + 1n).toString()),
              );
              assert.ok(
                (
                  await page.locator("#trace-account-comparison").innerText()
                ).includes("0.00000001"),
              );
            } else if (name === "no_debt" || name === "debt_transition") {
              assert.ok(
                (
                  await page.locator("#trace-account-comparison").innerText()
                ).includes("No debt (uint256 sentinel)"),
              );
              assert.ok(
                (
                  await page.locator("#trace-account-comparison").innerText()
                ).includes("Not defined (no debt)"),
              );
            } else if (name === "health_boundary") {
              assert.ok(
                (
                  await page.locator("#trace-account-summary").innerText()
                ).includes("baseline below 1"),
              );
            }
            assert.equal(
              await page.locator("#trace-download").getAttribute("href"),
              null,
            );
            await noOverflow(page);
            await scan(page, `account-${name}-${width}`);
          }
          const bad = structuredClone(template);
          bad.classification.differences.available_borrows_base++;
          const { artifact_id, ...body } = bad;
          bad.artifact_id = createHash("sha256")
            .update(observationCanonical(body))
            .digest("hex");
          await page.locator("#trace-import").setInputFiles({
            name: "resealed-account-contradiction.json",
            mimeType: "application/json",
            buffer: Buffer.from(observationCanonical(bad)),
          });
          await page.waitForFunction(() =>
            document
              .querySelector("#trace-status")
              ?.classList.contains("error"),
          );
          assert.equal(
            await page.locator("#trace-account-results").isVisible(),
            false,
          );
          for (const id of [
            "trace-account-summary",
            "trace-account-capacity-delta",
            "trace-account-health-delta",
            "trace-account-comparison",
            "trace-account-rows",
            "trace-account-identities",
            "trace-price-rows",
            "trace-raw",
            "trace-hash",
          ])
            assert.equal(await page.locator(`#${id}`).textContent(), "");
          assert.equal(
            await page.locator("#trace-download").getAttribute("href"),
            null,
          );
          assert.equal(
            requests.length,
            importsStart,
            "Local account imports made a request",
          );
          await page.locator("#trace-account-sample").click();
          await page.waitForFunction(
            () =>
              document.querySelectorAll("#trace-account-comparison tr")
                .length === 6,
          );
          await page.locator("#trace-sample").click();
          await page.waitForFunction(
            () => document.querySelectorAll("#trace-outcomes tr").length === 4,
          );
          assert.equal(
            await page.locator("#trace-account-results").isVisible(),
            false,
          );
          assert.equal(
            await page.locator("#trace-account-comparison tr").count(),
            0,
          );
          assert.equal(
            await page.locator("#trace-account-capacity-delta").textContent(),
            "",
          );
          assert.equal(
            await page.locator("#trace-account-health-delta").textContent(),
            "",
          );
        }),
    );
  }
  await check(
    "Signed prefix: resealed contradictions, oversized import and honest unverified recovery",
    () =>
      withPage(390, async (page) => {
        await page.locator(".trace-archive > summary").click();
        const template = JSON.parse(
          await readFile(
            resolve(root, "reports/trace-mainnet-prefix-four.json"),
            "utf8",
          ),
        );
        const bad = [];
        for (const change of [
          (r) => {
            r.candidate.outcomes[3].expected_nonce++;
          },
          (r) => {
            r.candidate.outcomes[1].differing_fields = [];
          },
          (r) => {
            r.baseline_verified = false;
          },
        ]) {
          const r = structuredClone(template);
          change(r);
          delete r.artifact_id;
          r.artifact_id = createHash("sha256")
            .update(canonical(r))
            .digest("hex");
          bad.push(Buffer.from(JSON.stringify(r)));
        }
        bad.push(Buffer.alloc(8 * 1024 * 1024 + 1, 32));
        for (const [i, buffer] of bad.entries()) {
          const count = requests.length;
          await page.locator("#trace-import").setInputFiles({
            name: `bad-${i}.json`,
            mimeType: "application/json",
            buffer,
          });
          await page.waitForFunction(() =>
            document
              .querySelector("#trace-status")
              ?.classList.contains("error"),
          );
          assert.equal(await page.locator("#trace-results").isVisible(), false);
          assert.equal(await page.locator("#trace-outcomes tr").count(), 0);
          assert.equal(await page.locator("#trace-raw").textContent(), "");
          assert.equal(
            await page.locator("#trace-comparison-summary").textContent(),
            "",
          );
          assert.equal(await page.locator("#trace-case").textContent(), "");
          assert.equal(
            await page.locator("#trace-download").getAttribute("href"),
            null,
          );
          assert.equal(requests.length, count);
        }
        const r = structuredClone(template),
          o = r.baseline.outcomes[3];
        r.baseline.outcomes[3] = {
          index: o.index,
          hash: o.hash,
          status: "rejected",
        };
        r.baseline.matches_original_receipts = false;
        r.baseline_verified = false;
        delete r.artifact_id;
        r.artifact_id = createHash("sha256").update(canonical(r)).digest("hex");
        await page.locator("#trace-import").setInputFiles({
          name: "unverified.json",
          mimeType: "application/json",
          buffer: Buffer.from(JSON.stringify(r)),
        });
        await page.waitForFunction(() =>
          document
            .querySelector("#trace-status")
            ?.textContent?.includes("UNVERIFIED"),
        );
        assert.equal(await page.locator("#trace-outcomes tr").count(), 4);
        await scan(page, "signed-prefix-unverified");
        const numeric = JSON.parse(
          await readFile(
            resolve(root, "tests/data/trace-mainnet-prefix-one.json"),
            "utf8",
          ),
        );
        const codecs = JSON.parse(
          await readFile(
            resolve(root, "tests/data/trace-runtime-codecs.json"),
            "utf8",
          ),
        );
        const count = requests.length;
        codecs.push(
          ...JSON.parse(
            await readFile(
              resolve(root, "tests/data/trace-unicode-codecs.unit.json"),
              "utf8",
            ),
          ),
        );
        for (const testCase of codecs) {
          numeric.runtime_seconds = testCase.runtime_seconds;
          numeric.artifact_id = testCase.artifact_id;
          if (testCase.assumption !== undefined)
            numeric.assumptions[0] = testCase.assumption;
          await page.locator("#trace-import").setInputFiles({
            name: "python-runtime.json",
            mimeType: "application/json",
            buffer: Buffer.from(JSON.stringify(numeric)),
          });
          await page.waitForFunction(
            (id) => document.querySelector("#trace-hash")?.textContent === id,
            testCase.artifact_id,
          );
          assert.equal(await page.locator("#trace-outcomes tr").count(), 1);
          assert.equal(
            await page
              .locator("#trace-status")
              .evaluate((el) => el.classList.contains("error")),
            false,
          );
        }
        assert.equal(requests.length, count);
      }),
  );
  await check(
    "Signed prefix: delayed sample cannot replace a newer local import",
    () =>
      withPage(390, async (page) => {
        await page.locator(".trace-archive > summary").click();
        const original = await readFile(
          resolve(root, "reports/trace-mainnet-prefix-four.json"),
          "utf8",
        );
        let release;
        const blocked = new Promise((resolve) => {
          release = resolve;
        });
        let arrived;
        const intercepted = new Promise((resolve) => {
          arrived = resolve;
        });
        await page.route(
          "**/reports/trace-mainnet-prefix-four.json",
          async (route) => {
            arrived();
            await blocked;
            await route.fulfill({
              status: 200,
              contentType: "application/json",
              body: original,
            });
          },
        );
        try {
          await page.locator("#trace-sample").click();
          await intercepted;
          await page.locator("#trace-import").setInputFiles({
            name: "newer.json",
            mimeType: "application/json",
            buffer: Buffer.from(original),
          });
          await page.waitForFunction(() =>
            document
              .querySelector("#trace-origin")
              ?.textContent?.includes("Local import"),
          );
          const response = page.waitForResponse(
            "**/reports/trace-mainnet-prefix-four.json",
          );
          release();
          await response;
          await page.waitForTimeout(100);
          assert.ok(
            (await page.locator("#trace-origin").innerText()).includes(
              "Local import",
            ),
          );
          assert.equal(
            await page.locator("#trace-download").isVisible(),
            false,
          );
        } finally {
          release();
        }
      }),
  );
  await check(
    "No JavaScript exceptions, uploads or unexpected third-party requests",
    async () => {
      assert.deepEqual(errors, []);
      assert.ok(requests.length > 0);
      assert.ok(
        requests.every(
          (x) => x.url.startsWith(origin + "/") && x.method === "GET",
        ),
        JSON.stringify(requests),
      );
    },
  );
} finally {
  const version = browser?.version();
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
  const source = {};
  for (const name of [
    "index.html",
    "app.js",
    "comparison.mjs",
    "report-validation.mjs",
    "trace-report.mjs",
    "trace-comparison.mjs",
    "trace-viewer.mjs",
    "observed-trace.mjs",
    "position-report.mjs",
    "reports/aave-account-impact13.json",
    "tests/data/position-controls.json",
    "reports/trace-observed-price32.json",
    "tests/data/observed-controls.json",
    "reports/trace-mainnet-prefix-four.json",
    "tests/data/trace-oracle-prefix-32.json",
    "assets/examples/action-comparison.json",
    "reports/agent-local-codex.json",
    "style.css",
    "404.html",
    "package.json",
    "package-lock.json",
  ]) {
    try {
      source[name] = createHash("sha256")
        .update(await readFile(resolve(root, name)))
        .digest("hex");
    } catch {
      source[name] = null;
    }
  }
  const report = {
    checked_at: new Date().toISOString(),
    node: process.version,
    platform: process.platform,
    runner_sha256: runnerHash,
    status:
      checks.length > 0 && checks.every((x) => x.status === "passed")
        ? "passed"
        : "failed",
    browser: version,
    axe: require("axe-core/package.json").version,
    playwright: require("playwright/package.json").version,
    source_sha256: source,
    checks,
    scans,
    request_count: requests.length,
    errors,
    limitations: [
      "Automated Chromium and accessibility-tree/keyboard evidence; no claim of manual screen-reader certification or complete WCAG conformance.",
      "320 CSS-pixel viewport checks reflow; it is not a hardware/browser zoom measurement.",
      "Axe incomplete contrast items remain explicit; supplemental checks apply only to opaque solid CSS colors.",
      "Local fixture/archived report display; no new chain/model execution.",
    ],
  };
  await writeFile(
    resolve(output, "accessibility.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    JSON.stringify(
      { status: report.status, browser: version, checks, scans: scans.length },
      null,
      2,
    ),
  );
  if (report.status !== "passed") process.exitCode = 1;
}
