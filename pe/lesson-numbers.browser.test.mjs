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
    const s=defState();s.start='2026-08-03';s.end='2026-09-30';
    s.classes=[{name:'3-1'},{name:'3-2'}];
    for(let day=1;day<=5;day++){
      s.base[day+'-1']={cls:'3-1',place:'p1'};
      s.base[day+'-2']={cls:'3-2',place:'p2'};
    }
    s.grades={'3':Array.from({length:100},(_,i)=>({act:'계획 '+(i+1),unit:'',note:''}))};
    s.gradeN={'3':100};window.PEJournal.replace(JSON.stringify(s));view='year';render();
  });
  const lesson=async n=>page.evaluate(n=>LESSONS.find(L=>L.cls==='3-1'&&L.ord===n).id,n);
  const id17=await lesson(17),id20=await lesson(20);
  const numbers=async()=>page.evaluate(()=>LESSONS.filter(L=>L.cls==='3-1'&&L.ord>=15&&L.ord<=21).map(L=>[L.ord,L.lessonNo]));
  assert.deepEqual(await numbers(),[15,16,17,18,19,20,21].map(n=>[n,n]));
  const edit=async(id,value)=>{
    await page.evaluate(()=>{view='year';render();});
    await page.locator('#ygrid [data-id="'+id+'"]').dblclick();
    assert.equal(await page.locator('#lOrdinal').getAttribute('readonly'),'');
    assert.equal(await page.locator('#lLessonNumber').getAttribute('readonly'),null);
    await page.locator('#lLessonNumber').fill(String(value));
    await page.locator('#lSave').click();
  };
  await edit(id17,19);
  assert.deepEqual(await numbers(),[[15,15],[16,16],[17,19],[18,20],[19,21],[20,22],[21,23]]);
  assert.equal(await page.evaluate(id=>lessonProgress(BYID[id]),id17),'계획 19');
  assert.equal(await page.evaluate(()=>LESSONS.find(L=>L.cls==='3-2'&&L.ord===17).lessonNo),17);
  await edit(id20,80);
  await edit(id17,16);
  assert.deepEqual(await numbers(),[[15,15],[16,16],[17,16],[18,17],[19,18],[20,19],[21,20]]);
  assert.equal(await page.evaluate(id=>state.rec[id]?.lessonNumber,id20),undefined);
  assert.equal(await page.evaluate(id=>lessonProgress(BYID[id]),id17),'계획 16');
  assert.equal(await page.evaluate(()=>gradeLessonPlaces('3',16).filter(p=>p.cls==='3-1'&&p.lesson).length),2);
  await page.evaluate(()=>{view='grade';render();});
  assert.equal(await page.locator('#gradeTable th').first().innerText(),'수업 번호');
  await page.locator('#gradeTable .grade-place-button').nth(15).click();
  assert.match(await page.locator('#modalRoot').innerText(),/16차시/);
  assert.match(await page.locator('#modalRoot').innerText(),/17차시/);
  await page.getByRole('button',{name:'닫기',exact:true}).click();
  await page.locator('#gradeTable .gac').nth(15).fill('공통 활동');
  await page.evaluate(id=>{logDate=BYID[id].date;view='log';render();},id17);
  assert.equal(await page.locator('#logTable tr[data-id="'+id17+'"] [data-f="prog"]').inputValue(),'공통 활동');
  await page.locator('#logTable [data-open="'+id17+'"]').click();
  assert.equal(await page.locator('#lLessonNumber').getAttribute('readonly'),'');
  assert.equal(await page.locator('#lLessonNumber').inputValue(),'16');
  await page.locator('#rSpecial').fill('기록 유지');await page.locator('#lSave').click();
  // Invalid values must not close the modal or modify the number.
  await page.evaluate(()=>{view='year';render();});
  await page.locator('#ygrid [data-id="'+id17+'"]').dblclick();
  await page.locator('#lLessonNumber').fill('0');await page.locator('#lSave').click();
  assert.equal(await page.locator('#lLessonNumber').count(),1);
  assert.equal(await page.evaluate(id=>BYID[id].lessonNo,id17),16);
  await page.locator('#lLessonNumber').fill('1.5');await page.locator('#lSave').click();
  assert.equal(await page.locator('#lLessonNumber').count(),1);
  await page.locator('#modalRoot .x').click();
  // Readonly is also enforced in the save handler outside the annual editor.
  await page.evaluate(id=>openLesson(id),id17);
  await page.locator('#lLessonNumber').evaluate(el=>el.value='90');
  await page.locator('#lSave').click();
  assert.equal(await page.evaluate(id=>BYID[id].lessonNo,id17),16);
  // Holiday changes actual ordinals, while the explicitly assigned number remains anchored.
  await page.evaluate(()=>{state.days['2026-08-03']={off:true,label:'휴업'};rebuild();flush();});
  assert.deepEqual(await page.evaluate(id=>[BYID[id].ord,BYID[id].lessonNo],id17),[16,16]);
  await page.reload();await page.waitForFunction(()=>!!window.PEJournal);
  assert.deepEqual(await page.evaluate(id=>[BYID[id].ord,BYID[id].lessonNo,BYID[id].rec.special],id17),[16,16,'기록 유지']);
  const payload=await page.evaluate(()=>window.PEJournal.get());
  await page.evaluate(()=>window.PEJournal.replace(null));
  await page.evaluate(p=>window.PEJournal.replace(p),payload);
  assert.equal(await page.evaluate(id=>BYID[id].lessonNo,id17),16);
  // Reordering plans still changes the contents associated with a number.
  await page.evaluate(()=>{view='grade';render();});
  const before=await page.evaluate(()=>state.grades['3'].map(r=>r.act));
  await page.locator('#gradeTable .grade-drag').first().dragTo(page.locator('#gradeTable tbody tr').nth(2),{targetPosition:{x:20,y:5}});
  assert.deepEqual(await page.evaluate(()=>state.grades['3'].map(r=>r.act)),[before[1],before[0],...before.slice(2)]);
  assert.equal(await page.locator('#gradeTable .grade-place-button b').first().innerText(),'1');
  if(process.env.PE_SCREENSHOT_DIR){
    await page.evaluate(id=>openLesson(id,{editNumber:true}),id17);
    await page.locator('#modalRoot .sheet').screenshot({path:process.env.PE_SCREENSHOT_DIR+'/pe-lesson-numbers.png'});
  }
  assert.deepEqual(errors,[]);
  console.log('PASS: automatic ordinals, forward/backward renumbering, suffix reset, duplicate/gap mapping, class isolation, annual-only editing, validation, plan linkage, holidays, persistence, drag reorder');
  await context.close();
}finally{await browser.close();await new Promise(r=>server.close(r));}
