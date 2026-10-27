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
    const s=defState();s.start='2026-09-07';s.end='2026-09-11';
    s.classes=[{name:'3-1'}];
    for(let d=1;d<=5;d++)s.base[d+'-1']={cls:'3-1',place:'p1'};
    s.grades={'3':['준비','공','달리기','균형','스트레칭'].map(act=>({act}))};
    s.rec={'2026-09-07#1':{special:'기존 기록',prog:'직접 기록'}};
    window.PEJournal.replace(JSON.stringify(s));view='year';render();flush();
  });
  const original=await page.evaluate(()=>window.PEJournal.get());
  const stored=await page.evaluate(()=>localStorage.getItem(LSKEY));
  await page.locator('#view-year [data-number-guide]').click();
  assert.equal(await page.locator('#guideHeading').innerText(),'결강·보강 뒤에는 수업번호를 확인하세요');
  await page.locator('#guideNext').click();
  await page.locator('#guideNumber').selectOption('5');
  assert.deepEqual(await page.locator('.guide-demo tbody td:nth-child(2)').allTextContents(),['1번','2번','5번','3번','4번']);
  assert.match(await page.locator('.guide-selected').innerText(),/실내 스트레칭/);
  await page.locator('#guideNext').click();
  assert.match(await page.locator('.number-guide').innerText(),/결·보강|빈칸/);
  await page.locator('#guideBack').click();
  assert.equal(await page.locator('#guideNumber').inputValue(),'5');
  await page.locator('#guideNext').click();
  assert.match(await page.locator('.number-guide').innerText(),/3 \/ 3/);
  assert.equal(await page.locator('.guide-steps li b').nth(1).innerText(),'연간시간표에서 수정할 수업을 더블클릭해요.');
  assert.equal(await page.locator('#guideNext').innerText(),'연간 시간표로 가기');
  await page.locator('#guideNext').click();
  assert.equal(await page.locator('.number-guide').count(),0);
  assert.equal(await page.evaluate(()=>window.PEJournal.get()),original);
  assert.equal(await page.evaluate(()=>localStorage.getItem(LSKEY)),stored);
  // Match the practice example against actual lesson-number behavior.
  await page.evaluate(()=>renumberLesson('2026-09-09#1',5));
  assert.deepEqual(await page.evaluate(()=>LESSONS.map(L=>L.lessonNo)),[1,2,5,3,4]);
  // Discoverable in grade plans too; navigation and practice fit a phone.
  await page.evaluate(()=>{view='grade';render();});
  await page.locator('#view-grade [data-number-guide]').click();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.number-guide').count(),0);
  for(const width of [390,1280]){
    await page.setViewportSize({width,height:900});
    await page.locator('#view-grade [data-number-guide]').click();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    const introBox=await page.locator('.number-guide').boundingBox();
    assert.ok(introBox.x>=0 && introBox.x+introBox.width<=width);
    if(process.env.PE_SCREENSHOT_DIR)await page.locator('.sheet').screenshot({path:process.env.PE_SCREENSHOT_DIR+'/number-guide-intro-'+width+'.png'});
    await page.locator('#guideNext').click();
    await page.locator('#guideNumber').selectOption('5');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    const box=await page.locator('.number-guide').boundingBox();
    assert.ok(box.x>=0 && box.x+box.width<=width);
    if(process.env.PE_SCREENSHOT_DIR)await page.locator('.sheet').screenshot({path:process.env.PE_SCREENSHOT_DIR+'/number-guide-'+width+'.png'});
    await page.keyboard.press('Escape');
  }
  await page.evaluate(()=>document.documentElement.classList.add('share-mode'));
  assert.equal(await page.locator('#view-grade [data-number-guide]').isVisible(),false);
  assert.deepEqual(errors,[]);
  console.log('PASS: tutorial entry points, practice matches real numbering, backward navigation, record/storage preservation, desktop/mobile layout, Escape, hidden in shared view');
  await context.close();
}finally{await browser.close();await new Promise(r=>server.close(r));}
