import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]


class HTML(HTMLParser):
    def __init__(self):
        super().__init__()
        self.scripts = []
        self.ids = []
        self.links = []
        self.meta = []
        self.text = []

    def handle_data(self, data):
        self.text.append(data)

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "script":
            self.scripts.append(a.get("src"))
        if tag == "a":
            self.links.append(a.get("href", ""))
        if tag == "meta":
            self.meta.append(a)
        if "id" in a:
            self.ids.append(a["id"])


class SiteTests(unittest.TestCase):
    def setUp(self):
        self.html = HTML()
        self.html.feed((ROOT / "index.html").read_text())

    def test_no_remote_scripts(self):
        self.assertEqual(
            self.html.scripts,
            [
                "app.js?v="
                + hashlib.sha256((ROOT / "app.js").read_bytes()).hexdigest()[:12],
                "comparison.mjs?v="
                + hashlib.sha256((ROOT / "comparison.mjs").read_bytes()).hexdigest()[
                    :12
                ],
                "trace-viewer.mjs?v="
                + hashlib.sha256((ROOT / "trace-viewer.mjs").read_bytes()).hexdigest()[
                    :12
                ],
            ],
        )

    def test_entrypoint_cache_identity_matches_source(self):
        html = (ROOT / "index.html").read_text()
        for path, attribute in [("style.css", "href"), ("trace-viewer.mjs", "src")]:
            with self.subTest(path=path):
                digest = hashlib.sha256((ROOT / path).read_bytes()).hexdigest()[:12]
                self.assertIn(attribute + '="' + path + "?v=" + digest + '"', html)

    def test_no_duplicate_ids(self):
        self.assertEqual(len(self.html.ids), len(set(self.html.ids)))

    def test_internal_anchors(self):
        for link in self.html.links:
            if link.startswith("#") and link != "#":
                self.assertIn(link[1:], self.html.ids)

    def test_csp(self):
        self.assertTrue(
            any(
                m.get("http-equiv") == "Content-Security-Policy" for m in self.html.meta
            )
        )

    def test_no_inner_html(self):
        self.assertNotIn(".innerHTML", (ROOT / "app.js").read_text())

    def test_no_custom_domain(self):
        self.assertFalse((ROOT / "CNAME").exists())

    def test_public_reports_valid_hashes(self):
        for p in (ROOT / "reports").glob("*.json"):
            d = json.loads(p.read_text())
            supplied = d.pop("artifact_id")
            data = json.dumps(
                d, sort_keys=True, separators=(",", ":"), ensure_ascii=True
            ).encode()
            self.assertEqual(hashlib.sha256(data).hexdigest(), supplied)
            if d.get("position_version") == "0.1.0":
                self.assertEqual(d["profile"], "aave-v3-ethereum-account")
                price = d["price_report"].copy()
                price_id = price.pop("artifact_id")
                encoded = json.dumps(
                    price, sort_keys=True, separators=(",", ":"), ensure_ascii=True
                ).encode()
                self.assertEqual(hashlib.sha256(encoded).hexdigest(), price_id)
                trace = price["trace_report"].copy()
                trace_id = trace.pop("artifact_id")
                self.assertEqual(price["trace_artifact_id"], trace_id)
                encoded = json.dumps(
                    trace, sort_keys=True, separators=(",", ":"), ensure_ascii=True
                ).encode()
                self.assertEqual(hashlib.sha256(encoded).hexdigest(), trace_id)
                self.assertEqual(trace["plan"], d["plan"]["trace"])
                self.assertEqual(len(trace["source"]["inputs"]), 13)
                self.assertEqual(len(d["observations"]), 4)
                continue
            if d.get("observation_version") == "0.1.0":
                self.assertEqual(d["profile"], "aave-v3-ethereum-weth-price")
                nested = d["trace_report"].copy()
                nested_id = nested.pop("artifact_id")
                self.assertEqual(d["trace_artifact_id"], nested_id)
                nested_data = json.dumps(
                    nested, sort_keys=True, separators=(",", ":"), ensure_ascii=True
                ).encode()
                self.assertEqual(hashlib.sha256(nested_data).hexdigest(), nested_id)
                self.assertEqual(nested["trace_version"], "0.1.0")
                self.assertEqual(len(d["observations"]), 4)
                self.assertEqual(len(nested["source"]["inputs"]), 32)
                continue
            if d.get("trace_version") == "0.1.0":
                self.assertEqual(
                    d["execution_kind"], "canonical_transaction_prefix_replay"
                )
                self.assertEqual(d["plan"]["source"]["chain_id"], 1)
                continue
            self.assertEqual(
                d["scenario"]["provenance"]["kind"],
                {
                    "evm-fork": "historical-fork",
                    "evm-local": "local-evm",
                    "fixture": "synthetic",
                }[d["mode"]],
            )
            if d["mode"] == "evm-fork":
                self.assertEqual(
                    d["source"]["block_hash"], d["scenario"]["source"]["block_hash"]
                )

    def test_not_business_saas(self):
        text = (ROOT / "index.html").read_text().lower()
        self.assertEqual(text.count("<form"), 1)
        self.assertIn('id="c-command-form"', text)
        self.assertNotIn("connect wallet", text)
        self.assertNotIn("stripe", text)

    def test_workflow_stages_allowlisted_files(self):
        text = (ROOT / ".github/workflows/pages.yml").read_text()
        self.assertIn("path: _site", text)
        self.assertIn("cp index.html", text)
        self.assertNotIn("path: .\n", text)

    def test_comparison_is_part_of_home(self):
        self.assertIn("compare", self.html.ids)
        self.assertIn("c-report-file", self.html.ids)
        self.assertFalse((ROOT / "tokyo2026").exists())
        self.assertNotIn("TOKYO", " ".join(self.html.text).upper())
        self.assertNotIn("2026", " ".join(self.html.text))

    def test_mascot_asset(self):
        self.assertTrue((ROOT / "assets/icon.png").is_file())


if __name__ == "__main__":
    unittest.main()
