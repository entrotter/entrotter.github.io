import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import unittest
ROOT=Path(__file__).resolve().parents[1]
class HTML(HTMLParser):
    def __init__(self):super().__init__();self.scripts=[];self.ids=[];self.links=[];self.meta=[];self.text=[]
    def handle_data(self,data):self.text.append(data)
    def handle_starttag(self,tag,attrs):
        a=dict(attrs)
        if tag=='script':self.scripts.append(a.get('src'))
        if tag=='a':self.links.append(a.get('href',''))
        if tag=='meta':self.meta.append(a)
        if 'id' in a:self.ids.append(a['id'])
class SiteTests(unittest.TestCase):
    def setUp(self):
        self.html=HTML();self.html.feed((ROOT/'index.html').read_text())
    def test_no_remote_scripts(self):self.assertEqual(self.html.scripts,['app.js?v='+hashlib.sha256((ROOT/'app.js').read_bytes()).hexdigest()[:12], 'comparison.mjs?v='+hashlib.sha256((ROOT/'comparison.mjs').read_bytes()).hexdigest()[:12]])
    def test_no_duplicate_ids(self):self.assertEqual(len(self.html.ids),len(set(self.html.ids)))
    def test_internal_anchors(self):
        for link in self.html.links:
            if link.startswith('#') and link!='#':self.assertIn(link[1:],self.html.ids)
    def test_csp(self):self.assertTrue(any(m.get('http-equiv')=='Content-Security-Policy' for m in self.html.meta))
    def test_no_inner_html(self):self.assertNotIn('.innerHTML',(ROOT/'app.js').read_text())
    def test_no_custom_domain(self):self.assertFalse((ROOT/'CNAME').exists())
    def test_public_reports_valid_hashes(self):
        for p in (ROOT/'reports').glob('*.json'):
            d=json.loads(p.read_text());supplied=d.pop('artifact_id')
            data=json.dumps(d,sort_keys=True,separators=(',',':'),ensure_ascii=True).encode()
            self.assertEqual(hashlib.sha256(data).hexdigest(),supplied)
            self.assertEqual(d['scenario']['provenance']['kind'], 'historical-fork' if d['mode']=='evm-fork' else 'synthetic')
            if d['mode']=='evm-fork': self.assertEqual(d['source']['block_hash'],d['scenario']['source']['block_hash'])
    def test_not_business_saas(self):
        text=(ROOT/'index.html').read_text().lower()
        self.assertEqual(text.count('<form'),1);self.assertIn('id="c-command-form"',text);self.assertNotIn('connect wallet',text);self.assertNotIn('stripe',text)
    def test_workflow_stages_allowlisted_files(self):
        text=(ROOT/'.github/workflows/pages.yml').read_text()
        self.assertIn('path: _site',text);self.assertIn('cp index.html',text)
        self.assertNotIn('path: .\n',text)
    def test_comparison_is_part_of_home(self):
        text=(ROOT/'index.html').read_text()
        self.assertIn('id="compare"',text)
        self.assertIn('id="c-report-file"',text)
        self.assertFalse((ROOT/'tokyo2026').exists())
        self.assertNotIn('TOKYO',' '.join(self.html.text).upper())
        self.assertNotIn('2026',' '.join(self.html.text))

    def test_mascot_asset(self):self.assertTrue((ROOT/'assets/icon.png').is_file())

if __name__=='__main__':unittest.main()
