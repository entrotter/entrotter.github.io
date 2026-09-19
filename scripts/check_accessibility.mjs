// Real Chromium, keyboard and axe checks; no Playwright test runner or app mocks.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {resolve, extname} from 'node:path';
import {createRequire} from 'node:module';
import {chromium} from 'playwright';

const require = createRequire(import.meta.url);
const runnerHash = createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex');
const root = resolve(process.env.SITE_DIR || '.');
const output = resolve(process.env.A11Y_OUTPUT || 'output/playwright');
await mkdir(output, {recursive:true});
const axeSource = await readFile(require.resolve('axe-core/axe.min.js'), 'utf8');
const types = {'.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.png':'image/png'};
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    const name = pathname === '/' ? 'index.html' : pathname.slice(1);
    if (!/^(index\.html|404\.html|style\.css|app\.js|(?:assets|reports|schemas)\/[a-zA-Z0-9_.-]+)$/.test(name)) {
      response.writeHead(404).end(); return;
    }
    const bytes = await readFile(resolve(root,name));
    response.writeHead(200, {'Content-Type':types[extname(name)] || 'application/octet-stream', 'Cache-Control':'no-store'}).end(bytes);
  } catch {response.writeHead(404).end();}
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const checks = [], scans = [], errors = [], requests = [];
let browser;
async function check(name, work) {
  try { await work(); checks.push({name,status:'passed'}); }
  catch (error) { checks.push({name,status:'failed',error:String(error.message)}); }
}
async function pageAt(width=1280, path='/') {
  const page = await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});
  page.setDefaultTimeout(5000);
  page.on('pageerror', error=>errors.push(String(error)));
  page.on('request', request=>requests.push({url:request.url(),method:request.method()}));
  await page.goto(origin+path);
  if(path==='/') await page.waitForFunction(()=>document.querySelector('#report-status').textContent.includes('Integrity verified locally'));
  return page;
}
async function withPage(width, work, path='/') {
  const page = await pageAt(width,path);
  try {await work(page);} finally {await page.close();}
}
async function noOverflow(page) {
  const size=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));
  assert.ok(size.scroll<=size.width,JSON.stringify(size));
}
async function focusIs(page,id) {assert.equal(await page.evaluate(()=>document.activeElement.id),id);}
async function visibleFocus(page) {
  assert.ok(await page.evaluate(()=>{
    const style=getComputedStyle(document.activeElement);
    return style.outlineStyle!=='none' && parseFloat(style.outlineWidth)>=2;
  }),'Focused control has no visible outline');
}
async function scan(page,name) {
  // Diagnostic injection through DevTools only. The website ships no axe script,
  // retains its production CSP, and makes no analyzer/network request.
  await page.evaluate(axeSource);
  const result = await page.evaluate(()=>axe.run(document, {
    runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa','best-practice']}
  }));
  await writeFile(resolve(output,`axe-${name}.json`),JSON.stringify(result,null,2)+'\n');
  const supplemental=[];
  scans.push({name,violations:result.violations.map(x=>({id:x.id,targets:x.nodes.map(n=>n.target)})),incomplete:result.incomplete.map(x=>x.id),supplemental});
  for(const item of result.incomplete) {
    assert.equal(item.id,'color-contrast',`Unreviewed incomplete rule: ${item.id}`);
    for(const node of item.nodes) {
      assert.equal(node.target.length,1,'Unexpected shadow/frame target');
      const colors=await page.locator(node.target[0]).evaluate(element=>{
        const foreground=getComputedStyle(element).color;
        let background;
        for(let parent=element;parent;parent=parent.parentElement) {
          const style=getComputedStyle(parent);
          if(style.backgroundImage!=='none' || style.opacity!=='1' || style.filter!=='none') throw new Error('Contrast requires visual review of effects');
          if(style.backgroundColor!=='rgba(0, 0, 0, 0)') {background=style.backgroundColor;break;}
        }
        return {foreground,background};
      });
      function luminance(css) {
        const match=/^rgb\((\d+), (\d+), (\d+)\)$/.exec(css);
        assert.ok(match,`Non-opaque/non-RGB color needs review: ${css}`);
        const values=match.slice(1).map(x=>Number(x)/255).map(x=>x<=0.04045?x/12.92:((x+0.055)/1.055)**2.4);
        return values[0]*0.2126+values[1]*0.7152+values[2]*0.0722;
      }
      const a=luminance(colors.foreground),b=luminance(colors.background);
      const ratio=(Math.max(a,b)+0.05)/(Math.min(a,b)+0.05);
      supplemental.push({target:node.target,colors,ratio,scope:'Opaque CSS contrast for clipped/decorative nodes; not an axe pass or screen-reader certification'});
      assert.ok(ratio>=4.5,`Insufficient supplemental contrast: ${ratio}`);
    }
  }
  assert.equal(result.violations.length,0,JSON.stringify(scans.at(-1).violations));
}
try {
  browser=await chromium.launch();
  await check('Keyboard skip link moves focus into main and skips navigation',()=>withPage(1280,async page=>{
    await page.keyboard.press('Tab');assert.equal(await page.locator(':focus').innerText(),'Skip to content');
    await visibleFocus(page);await page.keyboard.press('Enter');await focusIs(page,'main');
    await page.keyboard.press('Tab');assert.match(await page.locator(':focus').innerText(),/Run it locally/);
  }));
  await check('Keyboard sample selection, native local-file chooser, live status and inert import',()=>withPage(1280,async page=>{
    await page.locator('#scenario').focus();await visibleFocus(page);
    await page.keyboard.press('r');await page.keyboard.press('Tab');
    await page.waitForFunction(()=>document.querySelector('#report-status').textContent.includes('recovery trap'));
    assert.ok((await page.locator('#delta-value').innerText()).startsWith('-'));
    assert.equal(await page.locator('#report-status').getAttribute('aria-atomic'),'true');
    assert.equal(await page.locator('.metrics').getAttribute('aria-live'),null);
    await focusIs(page,'import');
    const chooser=page.waitForEvent('filechooser');await page.keyboard.press('Enter');
    const report=JSON.parse(await readFile(resolve(root,'reports/liquidity-shock.json'),'utf8'));
    delete report.artifact_id;report.scenario.title='<img src=x onerror=alert(1)> 🛸';
    function canonical(x) {
      if(Array.isArray(x))return '['+x.map(canonical).join(',')+']';
      if(x!==null&&typeof x==='object')return '{'+Object.keys(x).sort().map(k=>canonical(k)+':'+canonical(x[k])).join(',')+'}';
      return JSON.stringify(x).replace(/[\u0080-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
    }
    report.artifact_id=createHash('sha256').update(canonical(report)).digest('hex');
    const count=requests.length;
    await (await chooser).setFiles({name:'local-report.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(report))});
    await page.waitForFunction(()=>document.querySelector('#report-status').textContent.includes('<img'));
    assert.equal(await page.locator('#report-status img').count(),0);assert.equal(requests.length,count);
    assert.equal(await page.locator('#download').isVisible(),false);
  }));
  for(const width of [1280,390,320]) {
    for(const sample of ['liquidity-shock','recovery-trap','depeg-stress','ethereum-uniswap-slippage']) {
      await check(`${width}px ${sample}: reflow, exact accessible data and axe`,()=>withPage(width,async page=>{
        const report=JSON.parse(await readFile(resolve(root,`reports/${sample}.json`),'utf8'));
        await page.selectOption('#scenario',sample);
        await page.waitForFunction(id=>document.querySelector('#hash').textContent===id,report.artifact_id);
        await noOverflow(page);
        if(report.mode==='fixture') {
          const summary=page.getByText('Equity values by observation',{exact:true});await summary.focus();await page.keyboard.press('Enter');
          const rows=await page.locator('#equity-rows tr').allTextContents();assert.equal(rows.length,report.baseline.trace.length);
          const actual=await page.locator('#equity-rows tr').evaluateAll(rows=>rows.map(row=>[...row.cells].map(cell=>cell.textContent)));
          assert.deepEqual(actual,report.baseline.trace.map((point,i)=>[String(i+1),point.equity,report.candidate.trace[i].equity]));
          assert.equal(await page.locator('#equity-rows th[scope="row"]').count(),rows.length);
        } else {
          assert.equal(await page.locator('#fixture-chart').isVisible(),false);
          assert.match(await page.locator('#source-pin').innerText(),/19000000/);
          const region=page.getByRole('region',{name:'Supplied actions on isolated local forks'});
          if(width===320) {
            await region.focus();await visibleFocus(page);await page.keyboard.press('ArrowRight');
            await page.waitForFunction(()=>document.querySelector('#evm-details .table-wrap').scrollLeft>0);
          }
        }
        assert.ok(await page.locator('#metric-rows th[scope="row"]').count()>0);
        await page.getByText('Full result JSON',{exact:true}).focus();await page.keyboard.press('Enter');
        await page.keyboard.press('Tab');await focusIs(page,'raw-report');await visibleFocus(page);
        await page.keyboard.press('PageDown');await page.waitForFunction(()=>document.querySelector('#raw-report').scrollTop>0);
        await scan(page,`${width}-${sample}`);
        if(sample==='ethereum-uniswap-slippage'||(sample==='liquidity-shock'&&width===1280)) {
          await page.screenshot({path:resolve(output,`${width}-${sample}.png`),fullPage:true});
          await page.locator('#reports .section-head').scrollIntoViewIfNeeded();
          await page.screenshot({path:resolve(output,`${width}-${sample}-viewport.png`)});
        }
      }));
    }
  }
  await check('Tampered import clears data, reports an accessible error and recovers',()=>withPage(390,async page=>{
    const report=JSON.parse(await readFile(resolve(root,'reports/liquidity-shock.json'),'utf8'));
    report.candidate.metrics.final_equity='999999';
    await page.locator('#import').setInputFiles({name:'tampered.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(report))});
    await page.waitForFunction(()=>document.querySelector('#report-status').textContent.includes('mismatch'));
    assert.equal(await page.locator('#candidate-value').innerText(),'—');assert.equal(await page.locator('#equity-rows tr').count(),0);
    assert.equal(await page.locator('#fixture-chart').isVisible(),false);await scan(page,'error');
    await page.selectOption('#scenario','recovery-trap');
    await page.waitForFunction(()=>document.querySelector('#report-status').textContent.includes('Synthetic recovery trap'));
    assert.equal(await page.locator('#metric-table').isVisible(),true);
    assert.equal(await page.locator('#fixture-chart').isVisible(),true);
    assert.ok(await page.locator('#equity-rows tr').count()>0);
  }));
  await check('Forced colors, reduced motion and keyboard focus remain usable',()=>withPage(320,async page=>{
    await page.emulateMedia({forcedColors:'active',reducedMotion:'reduce'});
    assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).scrollBehavior),'auto');
    await page.locator('#scenario').focus();await visibleFocus(page);await noOverflow(page);
    const strokes=await page.locator('#chart .line').evaluateAll(lines=>lines.map(x=>({color:getComputedStyle(x).stroke,dash:getComputedStyle(x).strokeDasharray})));
    assert.equal(strokes[0].color,strokes[1].color);assert.notEqual(strokes[0].dash,strokes[1].dash);
    await page.screenshot({path:resolve(output,'forced-colors.png'),fullPage:true});
  }));
  await check('404 page at 320px: keyboard home link, no overflow and axe',()=>withPage(320,async page=>{
    await noOverflow(page);await page.keyboard.press('Tab');assert.match(await page.locator(':focus').innerText(),/Back to Entrotter/);
    await scan(page,'404');await page.keyboard.press('Enter');await page.waitForFunction(()=>document.querySelector('#report-status')?.textContent.includes('Integrity verified locally'));
  },'/404.html'));
  await check('No JavaScript exceptions, uploads or unexpected third-party requests',async()=>{
    assert.deepEqual(errors,[]);assert.ok(requests.length>0);
    assert.ok(requests.every(x=>x.url.startsWith(origin+'/')&&x.method==='GET'),JSON.stringify(requests));
  });
} finally {
  const version=browser?.version();if(browser)await browser.close();
  await new Promise(resolve=>server.close(resolve));
  const source={};for(const name of ['index.html','app.js','style.css','404.html','package.json','package-lock.json']) {
    try {source[name]=createHash('sha256').update(await readFile(resolve(root,name))).digest('hex');}catch {source[name]=null;}
  }
  const report={checked_at:new Date().toISOString(),node:process.version,platform:process.platform,runner_sha256:runnerHash,status:checks.length>0&&checks.every(x=>x.status==='passed')?'passed':'failed',browser:version,axe:require('axe-core/package.json').version,playwright:require('playwright/package.json').version,source_sha256:source,checks,scans,request_count:requests.length,errors,limitations:['Automated Chromium and accessibility-tree/keyboard evidence; no claim of manual screen-reader certification or complete WCAG conformance.','320 CSS-pixel viewport checks reflow; it is not a hardware/browser zoom measurement.','Axe incomplete contrast items remain explicit; supplemental checks apply only to opaque solid CSS colors.','Local fixture/archived report display; no new chain/model execution.']};
  await writeFile(resolve(output,'accessibility.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({status:report.status,browser:version,checks,scans:scans.length},null,2));
  if(report.status!=='passed')process.exitCode=1;
}
