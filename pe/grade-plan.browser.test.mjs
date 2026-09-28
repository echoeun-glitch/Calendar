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
    const s=defState();s.start='2026-09-01';s.end='2026-09-30';
    s.classes=[{name:'3-1'},{name:'3-2'},{name:'5-1'}];
    s.base={'2-1':{cls:'3-1',place:'p1'},'3-1':{cls:'3-2',place:'p1'},'4-1':{cls:'5-1',place:'p1'}};
    s.grades={'3':[{unit:'2. 스포츠',act:'티볼',note:'공 준비'},{unit:'1. 운동',act:'달리기',note:''}]};
    s.gradeN={'3':2};window.PEJournal.replace(JSON.stringify(s));
    weekCur=parseD('2026-09-01');logDate='2026-09-01';view='week';render();
  });
  assert.match(await page.locator('#wgrid').innerText(),/티볼/);
  assert.match(await page.locator('#wgrid').innerText(),/계획 비고: 공 준비/);
  const plan1='2. 스포츠 · 티볼';
  assert.deepEqual(await page.evaluate(()=>['2026-09-01#1','2026-09-02#1','2026-09-03#1'].map(id=>lessonProgress(BYID[id]))),[plan1,plan1,'']);
  await page.getByRole('button',{name:'일지',exact:true}).click();
  const progress=page.locator('#logTable input[data-f="prog"]').first();
  assert.equal(await progress.inputValue(),plan1);
  await progress.fill('학급별 별도 진도');await progress.press('Tab');
  await page.getByRole('button',{name:'학년별',exact:true}).click();
  const placeButton=page.locator('#gradeTable .grade-place-button').first();
  for(const [id,name] of [['p1','체육관'],['p3','예지관'],['p2','운동장']]){
    await placeButton.click();
    await page.locator('[data-grade-place="'+id+'"]').click();
    assert.match(await placeButton.innerText(),new RegExp(name));
    assert.equal(await page.evaluate(()=>state.grades['3'][0].place),id);
    assert.equal(await page.locator('#gradeTable .grade-place').first().evaluate(e=>e.style.getPropertyValue('--place-color')),
      await page.evaluate(id=>state.places.find(p=>p.id===id).color,id));
  }
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('pe-annual-v1'))?.grades?.['3']?.[0]?.place==='p2');
  await page.evaluate(()=>window.PEJournal.replace(window.PEJournal.get()));
  assert.match(await placeButton.innerText(),/운동장/);
  await placeButton.press('Enter');
  await page.locator('[data-grade-place=""]').click();
  assert.match(await placeButton.innerText(),/장소 선택/);
  await page.locator('#gradeTable .gac').first().fill('농구');
  await page.getByRole('button',{name:'일지',exact:true}).click();
  assert.equal(await progress.inputValue(),'학급별 별도 진도');
  await progress.fill('');await progress.press('Tab');
  assert.equal(await progress.inputValue(),'2. 스포츠 · 농구');
  assert.equal(await page.evaluate(()=>state.rec['2026-09-01#1']?.prog),undefined);
  await page.getByRole('button',{name:'학급별',exact:true}).click();
  await page.locator('#clsStats [data-f="all"]').click();
  assert.equal(await page.locator('#clsTable input[data-f="prog"]').first().inputValue(),'2. 스포츠 · 농구');
  await page.evaluate(()=>openLesson('2026-09-01#1'));
  await page.locator('#rSpecial').fill('개별 특이사항');await page.locator('#lSave').click();
  assert.equal(await page.evaluate(()=>state.rec['2026-09-01#1'].prog),undefined);
  assert.equal(await page.evaluate(()=>state.rec['2026-09-01#1'].special),'개별 특이사항');
  await page.evaluate(()=>{state.days['2026-09-01']={off:true,label:'휴업'};rebuild();});
  assert.equal(await page.evaluate(()=>lessonProgress(BYID['2026-09-08#1'])),'2. 스포츠 · 농구');
  assert.equal(await page.evaluate(()=>lessonProgress(BYID['2026-09-15#1'])),'1. 운동 · 달리기');
  assert.equal(await page.evaluate(()=>lessonProgress(BYID['2026-09-22#1'])),'');
  await page.evaluate(()=>{state.grades['3']=[{hours:2,unit:'표현',act:'춤',note:''}];});
  assert.equal(await page.evaluate(()=>lessonProgress(BYID['2026-09-15#1'])),'표현 · 춤');
  assert.deepEqual(errors,[]);
  console.log('PASS: grade/ordinal mapping, weekly/log/class UI, live plan edits, manual override/reset, modal inheritance, holidays, missing plans, legacy plans');
  await context.close();
}finally{await browser.close();await new Promise(r=>server.close(r));}
