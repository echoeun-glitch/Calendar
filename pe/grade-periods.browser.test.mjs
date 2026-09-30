import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PE_PLAYWRIGHT_MODULE || 'playwright');
const server=createServer(async(req,res)=>{
  try {
    const path=req.url==='/'?'index.html':req.url.slice(1);
    if(path.includes('..')) throw Error('invalid path');
    const data=await readFile(new URL(path,import.meta.url));
    res.setHeader('Content-Type',/\.m?js$/.test(path)?'text/javascript':'text/html; charset=utf-8');res.end(data);
  }catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:process.env.PE_BROWSER||'msedge',headless:true});
try {
  const context=await browser.newContext({serviceWorkers:'block'});
  await context.route('**/firebase-config.js',r=>r.fulfill({contentType:'text/javascript',body:'window.PE_FIREBASE_CONFIG=null;'}));
  const page=await context.newPage(), errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(()=>!!window.PEJournal);
  await page.evaluate(()=>{
    const s=defState();s.start='2026-08-10';s.end='2026-08-28';
    s.classes=[{name:'3-1'},{name:'3-2'}];
    s.base={'1-1':{cls:'3-1',place:'p1'},'3-1':{cls:'3-1',place:'p2'},
      '2-1':{cls:'3-2',place:'p3'},'4-1':{cls:'3-2',place:'p1'}};
    s.days={'2026-08-10':{off:true,label:'휴업'}};
    s.grades={'3':Array.from({length:6},(_,i)=>({act:'수업계획 '+(i+1),unit:'',note:''}))};
    s.gradeN={'3':6};window.PEJournal.replace(JSON.stringify(s));view='grade';render();
  });
  assert.equal(await page.locator('#gradeViewMode').inputValue(),'period');
  assert.equal(await page.locator('#gradeTable th').first().innerText(),'기간');
  const fifth=page.locator('#gradeTable tbody tr').nth(4).locator('.grade-place-button');
  const sixth=page.locator('#gradeTable tbody tr').nth(5).locator('.grade-place-button');
  assert.match(await fifth.innerText(),/8월 4주 \(8\.24–8\.28\)/);
  assert.match(await fifth.innerText(),/첫 번째 수업/);
  assert.match(await sixth.innerText(),/두 번째 수업/);
  assert.doesNotMatch(await fifth.innerText(),/차시/);
  assert.doesNotMatch(await sixth.innerText(),/차시/);
  assert.deepEqual(await page.evaluate(()=>['2026-08-24#1','2026-08-25#1'].map(id=>[BYID[id].ord,lessonProgress(BYID[id])])),[
    [4,'수업계획 5'],[5,'수업계획 5']
  ]);
  // A midweek cancelled slot must not turn the next lesson into the wrong weekly session.
  await page.evaluate(()=>{state.rec['2026-08-24#1']={del:1};rebuild();renderGrade();});
  assert.deepEqual(await page.evaluate(()=>['2026-08-26#1','2026-08-27#1'].map(id=>lessonProgress(BYID[id]))),['수업계획 6','수업계획 6']);
  await sixth.click();
  assert.match(await page.locator('#modalRoot').innerText(),/2026-08-26/);
  assert.match(await page.locator('#modalRoot').innerText(),/2026-08-27/);
  assert.doesNotMatch(await page.locator('#modalRoot').innerText(),/2026-08-25/);
  await page.getByRole('button',{name:'닫기',exact:true}).click();
  const plansBefore=await page.evaluate(()=>JSON.stringify(state.grades));
  await page.locator('#gradeViewMode').selectOption('ordinal');
  assert.equal(await page.locator('#gradeTable th').first().innerText(),'차시');
  assert.equal(await sixth.locator('b').innerText(),'6');
  assert.equal(await page.evaluate(()=>JSON.stringify(state.grades)),plansBefore);
  assert.equal(await page.evaluate(()=>lessonProgress(BYID['2026-08-26#1'])),'수업계획 6');
  await page.locator('#gradeViewMode').selectOption('period');
  await page.locator('#gradeTable .gac').nth(5).fill('티볼 경기');
  await page.evaluate(()=>{weekCur=parseD('2026-08-24');view='week';render();});
  assert.equal(await page.locator('#wgrid .content').filter({hasText:'티볼 경기'}).count(),2);
  await page.evaluate(()=>{logDate='2026-08-26';view='log';render();});
  const progress=page.locator('#logTable [data-f="prog"]');
  assert.equal(await progress.inputValue(),'티볼 경기');
  await progress.fill('개별 활동');await progress.press('Tab');
  assert.equal(await page.evaluate(()=>lessonProgress(BYID['2026-08-26#1'])),'개별 활동');
  await progress.fill('');await progress.press('Tab');
  assert.equal(await progress.inputValue(),'티볼 경기');
  await page.evaluate(()=>{view='class';curCls='3-2';clsFilter='all';render();});
  assert.equal(await page.locator('#clsTable tr[data-id="2026-08-27#1"] [data-f="prog"]').inputValue(),'티볼 경기');
  // Full-week holidays retain the later week's plan positions.
  await page.evaluate(()=>{
    for(const date of ['2026-08-17','2026-08-18','2026-08-19','2026-08-20'])state.days[date]={off:true,label:'휴업'};
    rebuild();flush();
  });
  assert.equal(await page.evaluate(()=>lessonProgress(BYID['2026-08-25#1'])),'수업계획 5');
  await page.reload();await page.waitForFunction(()=>!!window.PEJournal);
  await page.evaluate(()=>{view='grade';render();});
  assert.equal(await page.locator('#gradeViewMode').inputValue(),'period');
  assert.equal(await page.locator('#gradeTable .gac').nth(5).inputValue(),'티볼 경기');
  await page.locator('#gradeViewMode').selectOption('ordinal');
  const snapshot=await page.evaluate(()=>window.PEJournal.get());
  await page.evaluate(()=>window.PEJournal.replace(null));
  await page.evaluate(s=>window.PEJournal.replace(s),snapshot);
  assert.equal(await page.locator('#gradeViewMode').inputValue(),'ordinal');
  await page.locator('#gradeViewMode').selectOption('period');
  if(process.env.PE_SCREENSHOT_DIR)await page.locator('#view-grade').screenshot({path:process.env.PE_SCREENSHOT_DIR+'/pe-grade-periods.png'});
  await page.setViewportSize({width:390,height:844});
  await page.locator('#gradeViewMode').selectOption('ordinal');
  assert.equal(await page.locator('#gradeTable th').first().innerText(),'차시');
  await page.locator('#gradeViewMode').selectOption('period');
  assert.match(await fifth.innerText(),/8월 4주/);
  assert.deepEqual(errors,[]);
  console.log('PASS: period labels, weekly alignment across classes, cancelled/deleted slots, place details, display mode persistence, weekly/log/class linkage, overrides, full-week holidays, mobile');
  await context.close();
}finally{await browser.close();await new Promise(r=>server.close(r));}
