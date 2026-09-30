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
    const s=defState(); delete s.semester2;
    s.start='2026-03-02'; s.end='2026-03-06';
    s.classes=[{name:'3-1'},{name:'3-2'}];
    s.base={'1-1':{cls:'3-1',place:'p1'}};
    s.rec={'2026-03-02#1':{special:'기존 기록'}};
    s.grades={'3':[{act:'달리기'},{act:'티볼'}]};
    window.PEJournal.replace(JSON.stringify(s));
    view='setup'; render();
  });
  assert.equal(await page.locator('#timeSetup').count(),0);
  assert.equal(await page.locator('#startD').inputValue(),'2026-03-02');
  assert.equal(await page.locator('#startD2').inputValue(),'');
  assert.equal(await page.evaluate(()=>BYID['2026-03-02#1'].rec.special),'기존 기록');
  const date=async(id,value)=>{await page.locator(id).fill(value);await page.locator(id).dispatchEvent('change');};
  await date('#startD2','2026-09-07');
  await date('#endD2','2026-09-11');
  await page.locator('#baseTerms [data-term="2"]').click();
  assert.equal(await page.locator('#btTable [data-b="1-1"][data-k="cls"]').inputValue(),'');
  await page.locator('#btTable [data-b="1-2"][data-k="cls"]').selectOption('3-1');
  await page.locator('#btTable [data-b="1-2"][data-k="place"]').selectOption('p2');
  await page.locator('#baseTerms [data-term="1"]').click();
  assert.equal(await page.locator('#btTable [data-b="1-1"][data-k="cls"]').inputValue(),'3-1');
  assert.equal(await page.locator('#btTable [data-b="1-2"][data-k="cls"]').inputValue(),'');
  assert.deepEqual(await page.evaluate(()=>LESSONS.map(L=>[L.date,L.period,L.place,L.ord])),[
    ['2026-03-02',1,'p1',1],['2026-09-07',2,'p2',2]
  ]);
  // Reject reversed or overlapping dates without modifying either semester.
  const dialogs=[];page.on('dialog',async d=>{dialogs.push(d.message());await d.accept();});
  await date('#startD2','2026-03-02');
  assert.match(dialogs.pop(),/겹칩니다/);
  assert.equal(await page.locator('#startD2').inputValue(),'2026-09-07');
  await date('#endD2','2026-09-01');
  assert.match(dialogs.pop(),/종료일/);
  assert.equal(await page.locator('#endD2').inputValue(),'2026-09-11');
  await page.getByRole('button',{name:'연간',exact:true}).click();
  await page.locator('#yearTerms [data-term="1"]').click();
  assert.equal(await page.locator('#ygrid [data-id="2026-03-02#1"]').count(),1);
  assert.equal(await page.locator('#ygrid [data-id="2026-09-07#2"]').count(),0);
  await page.locator('#yearTerms [data-term="2"]').click();
  assert.equal(await page.locator('#ygrid [data-id="2026-03-02#1"]').count(),0);
  assert.equal(await page.locator('#ygrid [data-id="2026-09-07#2"]').count(),1);
  assert.deepEqual(await page.evaluate(()=>usedPeriods()),[2]);
  await page.evaluate(()=>{window.exported=null;csvDL=(name,rows)=>window.exported={name,rows};});
  await page.locator('#yCsv').click();
  assert.match(await page.evaluate(()=>window.exported.name),/term2/);
  assert.match(await page.evaluate(()=>JSON.stringify(window.exported.rows)),/9\.7/);
  assert.doesNotMatch(await page.evaluate(()=>JSON.stringify(window.exported.rows)),/3\.2/);
  // A modal must compare against semester 2's base, avoiding redundant overrides.
  await page.locator('#ygrid [data-id="2026-09-07#2"]').dblclick();
  assert.equal(await page.locator('#lPlace').inputValue(),'p2');
  await page.locator('#rSpecial').fill('2학기 기록');
  await page.locator('#lSave').click();
  assert.deepEqual(await page.evaluate(()=>state.rec['2026-09-07#2']),{special:'2학기 기록'});
  await page.evaluate(()=>{weekCur=parseD('2026-09-07');view='week';render();});
  assert.match(await page.locator('#wgrid').innerText(),/티볼/);
  await page.evaluate(()=>{logDate='2026-09-07';view='log';render();});
  assert.equal(await page.locator('#logTable [data-f="prog"]').inputValue(),'티볼');
  assert.match(await page.locator('#logTable').innerText(),/운동장/);
  await page.evaluate(()=>{logDate='2026-07-06';renderLog();});
  assert.match(await page.locator('#logTable').innerText(),/수업이 없습니다/);
  // Blank semester dates pause its schedule while preserving its timetable and records.
  await page.evaluate(()=>{view='setup';render();});
  await date('#endD2','');
  assert.equal(await page.evaluate(()=>LESSONS.length),1);
  assert.equal(await page.evaluate(()=>state.rec['2026-09-07#2'].special),'2학기 기록');
  await date('#endD2','2026-09-11');
  await page.evaluate(()=>{flush();});
  await page.reload();await page.waitForFunction(()=>!!window.PEJournal);
  assert.equal(await page.evaluate(()=>BYID['2026-09-07#2'].rec.special),'2학기 기록');
  assert.equal(await page.evaluate(()=>BYID['2026-03-02#1'].rec.special),'기존 기록');
  // A holiday in semester 1 must not shift semester 2's weekly plan.
  await page.evaluate(()=>{state.days['2026-03-02']={off:true,label:'휴업'};rebuild();});
  assert.equal(await page.evaluate(()=>lessonProgress(BYID['2026-09-07#2'])),'티볼');
  const payload=await page.evaluate(()=>window.PEJournal.get());
  await page.evaluate(()=>window.PEJournal.replace(null));
  assert.equal(await page.evaluate(()=>LESSONS.length),0);
  await page.evaluate(p=>window.PEJournal.replace(p),payload);
  assert.equal(await page.evaluate(()=>BYID['2026-09-07#2'].place),'p2');
  // Both semester controls remain usable at phone width.
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>{view='setup';render();});
  await page.locator('#baseTerms [data-term="2"]').click();
  assert.equal(await page.locator('#btTable [data-b="1-2"][data-k="cls"]').inputValue(),'3-1');
  assert.equal(await page.locator('#endD2').inputValue(),'2026-09-11');
  await page.evaluate(()=>{view='year';render();});
  await page.locator('#yearTerms [data-term="2"]').click();
  assert.equal(await page.locator('#ygrid [data-id="2026-09-07#2"]').count(),1);
  if(process.env.PE_SCREENSHOT_DIR){
    await page.evaluate(()=>{view='setup';render();});
    await page.locator('#view-setup .card').filter({has:page.locator('#startD')}).screenshot({path:process.env.PE_SCREENSHOT_DIR+'/pe-semesters-mobile.png'});
    await page.setViewportSize({width:1280,height:900});
    await page.locator('#view-setup .card').filter({has:page.locator('#startD')}).screenshot({path:process.env.PE_SCREENSHOT_DIR+'/pe-semesters-desktop.png'});
    await page.evaluate(()=>{view='year';render();});
    await page.locator('#view-year').screenshot({path:process.env.PE_SCREENSHOT_DIR+'/pe-semesters-year.png'});
  }
  assert.deepEqual(errors,[]);
  console.log('PASS: legacy migration, independent semester schedules, date validation, annual tabs/CSV, weekly/log plans, modal edits, vacation gap, reload/account restore, holidays, mobile controls');
  await context.close();
}finally{await browser.close();await new Promise(r=>server.close(r));}
