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
    const s=defState();s.start='2026-08-03';s.end='2026-10-08';
    s.classes=[{name:'3-1'},{name:'3-2'}];
    for(let day=1;day<=5;day++){
      s.base[day+'-1']={cls:'3-1',place:'p1'};
      s.base[day+'-2']={cls:'3-2',place:'p2'};
    }
    s.grades={'3':Array.from({length:49},(_,i)=>({act:'계획 '+(i+1),unit:'',note:''}))};
    s.gradeN={'3':49};window.PEJournal.replace(JSON.stringify(s));view='year';render();
  });
  const ids=await page.evaluate(()=>LESSONS.filter(L=>L.cls==='3-1').map(L=>L.id));
  const numbers=()=>page.evaluate(()=>LESSONS.filter(L=>L.cls==='3-1'&&L.ord).map(L=>L.lessonNo));
  const natural=Array.from({length:49},(_,i)=>i+1);
  assert.equal(ids.length,49);
  assert.deepEqual(await numbers(),natural);
  const edit=async(id,value)=>{
    await page.evaluate(()=>{view='year';render();});
    await page.locator('#ygrid [data-id="'+id+'"]').dblclick();
    assert.equal(await page.locator('#lOrdinal').getAttribute('readonly'),'');
    assert.equal(await page.locator('#lLessonNumber').evaluate(el=>el.tagName),'SELECT');
    assert.equal(await page.locator('#lLessonNumber option').count(),49);
    await page.locator('#lLessonNumber').selectOption(String(value));
    await page.locator('#lSave').click();
  };
  await edit(ids[2],49);
  const moved=[1,2,49,...Array.from({length:46},(_,i)=>i+3)];
  assert.deepEqual(await numbers(),moved);
  assert.deepEqual(await page.evaluate(()=>LESSONS.filter(L=>L.cls==='3-1').map(L=>L.ord)),natural);
  assert.deepEqual(await page.evaluate(()=>LESSONS.filter(L=>L.cls==='3-2').map(L=>L.lessonNo)),natural);
  assert.equal(await page.evaluate(id=>lessonProgress(BYID[id]),ids[2]),'계획 49');
  assert.equal(await page.evaluate(id=>lessonProgress(BYID[id]),ids[3]),'계획 3');
  // Moving back to the front shifts only the intervening numbers up.
  await edit(ids[2],3);
  assert.deepEqual(await numbers(),natural);
  await edit(ids[48],3);
  assert.deepEqual(await numbers(),[1,2,...Array.from({length:46},(_,i)=>i+4),3]);
  await edit(ids[48],49);
  assert.deepEqual(await numbers(),natural);
  await edit(ids[2],49);
  await page.evaluate(()=>{view='grade';render();});
  assert.equal(await page.locator('#gradeTable th').first().innerText(),'수업 번호');
  assert.equal(await page.evaluate(()=>gradeLessonPlaces('3',49).filter(p=>p.cls==='3-1'&&p.lesson).length),1);
  await page.locator('#gradeTable .gac').nth(48).fill('옮긴 수업');
  await page.evaluate(id=>{logDate=BYID[id].date;view='log';render();},ids[2]);
  assert.equal(await page.locator('#logTable tr[data-id="'+ids[2]+'"] [data-f="prog"]').inputValue(),'옮긴 수업');
  await page.locator('#logTable [data-open="'+ids[2]+'"]:visible').click();
  assert.equal(await page.locator('#lLessonNumber').getAttribute('readonly'),'');
  await page.locator('#rSpecial').fill('기록 유지');await page.locator('#lSave').click();
  // Invalid calls must leave all numbers untouched.
  assert.equal(await page.evaluate(id=>renumberLesson(id,50),ids[2]),false);
  assert.equal(await page.evaluate(id=>renumberLesson(id,0),ids[2]),false);
  assert.equal(await page.evaluate(id=>renumberLesson(id,1.5),ids[2]),false);
  assert.deepEqual(await numbers(),moved);
  await page.evaluate(()=>flush());
  await page.reload();await page.waitForFunction(()=>!!window.PEJournal);
  assert.deepEqual(await numbers(),moved);
  assert.equal(await page.evaluate(id=>BYID[id].rec.special,ids[2]),'기록 유지');
  const payload=await page.evaluate(()=>window.PEJournal.get());
  await page.evaluate(()=>window.PEJournal.replace(null));
  await page.evaluate(p=>window.PEJournal.replace(p),payload);
  assert.deepEqual(await numbers(),moved);
  // Deleting or adding lessons still produces a complete, unique 1..N sequence.
  await page.evaluate(()=>{state.days['2026-08-03']={off:true,label:'휴업'};rebuild();});
  assert.deepEqual((await numbers()).sort((a,b)=>a-b),natural.slice(0,48));
  await page.evaluate(()=>{delete state.days['2026-08-03'];rebuild();});
  assert.deepEqual(await numbers(),moved);
  await page.evaluate(()=>{state.extras.push({id:'test-extra',date:'2026-08-04',period:3,cls:'3-1',place:'p1'});rebuild();});
  assert.deepEqual((await numbers()).sort((a,b)=>a-b),Array.from({length:50},(_,i)=>i+1));
  await page.evaluate(()=>{state.extras=[];rebuild();});
  // Legacy duplicate/out-of-range preferences are normalized without losing notes.
  await page.evaluate(()=>{
    state.rec['2026-08-03#1']={lessonNumber:100,special:'이전 기록'};
    state.rec['2026-08-04#1']={lessonNumber:100};rebuild();
  });
  assert.deepEqual((await numbers()).sort((a,b)=>a-b),natural);
  assert.equal(await page.evaluate(()=>state.rec['2026-08-03#1'].special),'이전 기록');
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(id=>openLesson(id,{editNumber:true}),ids[2]);
  assert.equal(await page.locator('#lLessonNumber option').count(),49);
  if(process.env.PE_SCREENSHOT_DIR)await page.locator('#modalRoot .sheet').screenshot({path:process.env.PE_SCREENSHOT_DIR+'/pe-number-select.png'});
  assert.deepEqual(errors,[]);
  console.log('PASS: 49-choice dropdown, move 3 to 49 and back, no duplicate/gap, immutable ordinals, class isolation, plan mapping, persistence, schedule changes, legacy normalization, mobile');
  await context.close();
}finally{await browser.close();await new Promise(r=>server.close(r));}
