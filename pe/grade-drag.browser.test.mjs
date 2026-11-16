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
const url=`http://127.0.0.1:${server.address().port}/`;
async function open(options={}){
  const context=await browser.newContext({serviceWorkers:'block',...options});
  await context.route('**/firebase-config.js',r=>r.fulfill({contentType:'text/javascript',body:'window.PE_FIREBASE_CONFIG=null;'}));
  const page=await context.newPage(), errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  /* 2026-09-02(수) 10:00 — 3-1은 화 2교시, 3-2는 수 3교시 */
  await page.clock.install({time:new Date('2026-09-02T10:00:00')});
  await page.goto(url);
  await page.waitForFunction(()=>!!window.PEJournal);
  await page.evaluate(()=>{
    const s=defState();s.start='2026-09-01';s.end='2026-09-30';
    s.classes=[{name:'3-1'},{name:'3-2'}];
    s.base={'2-2':{cls:'3-1',place:'p1'},'3-3':{cls:'3-2',place:'p1'}};
    s.grades={'3':['가','나','다','라'].map(a=>({unit:'',act:a,note:''}))};
    s.gradeN={'3':4};window.PEJournal.replace(JSON.stringify(s));
    view='grade';render();
  });
  return {context,page,errors};
}
const acts=page=>page.evaluate(()=>state.grades['3'].map(r=>r.act));
const shaded=page=>page.locator('#gradeTable tr.current-grade-lesson b').allTextContents();
try {
  /* 교시 시간 */
  {
    const {context,page,errors}=await open();
    assert.deepEqual(await page.evaluate(()=>state.times.slice(0,6).map(t=>t.s+'-'+t.e)),
      ['09:00-09:40','09:50-10:30','10:40-11:20','11:30-12:10','13:00-13:40','13:50-14:30']);
    /* 예전 기본 시간은 새 시간으로, 직접 바꾼 시간은 그대로 */
    await page.evaluate(()=>{const s=JSON.parse(JSON.stringify(state));
      s.times=[{s:'09:00',e:'09:40'},{s:'09:50',e:'10:30'},{s:'10:50',e:'11:30'},{s:'08:00',e:'08:45'}];
      window.PEJournal.replace(JSON.stringify(s));});
    assert.deepEqual(await page.evaluate(()=>state.times.map(t=>t.e)),['09:40','10:30','11:20','08:45']);
    await page.evaluate(()=>{const s=JSON.parse(JSON.stringify(state));s.times=defState().times;
      window.PEJournal.replace(JSON.stringify(s));view='grade';render();});

    /* 음영: 다가올 수업. 3-1은 9/1 1번 끝 → 9/8의 2번, 3-2는 오늘 3교시 1번 */
    assert.deepEqual(await shaded(page),['1','2']);
    await page.clock.runFor('01:21:00');           /* 11:21 — 3-2 3교시(11:20) 끝 */
    assert.deepEqual(await shaded(page),['2']);
    assert.equal(await page.locator('#gradeTable tr.current-grade-lesson').count(),1);

    /* 마우스 드래그: 1번 행을 3번 행 아래로 */
    const handle=i=>page.locator('#gradeTable tbody tr').nth(i).locator('.grade-drag');
    const box=async i=>(await page.locator('#gradeTable tbody tr').nth(i).boundingBox());
    const h0=await handle(0).boundingBox(), r2=await box(2);
    await page.mouse.move(h0.x+h0.width/2,h0.y+h0.height/2);
    await page.mouse.down();
    await page.mouse.move(h0.x+5,r2.y+r2.height*0.8,{steps:8});
    assert.equal(await page.locator('#gradeTable tr.grade-drop-after').count(),1);
    await page.mouse.up();
    assert.deepEqual(await acts(page),['나','다','가','라']);
    assert.deepEqual(await page.locator('#gradeTable tbody .gac').evaluateAll(x=>x.map(i=>i.value)),['나','다','가','라']);
    /* 마지막 행을 맨 위로 */
    const h3=await handle(3).boundingBox(), r0=await box(0);
    await page.mouse.move(h3.x+h3.width/2,h3.y+h3.height/2);
    await page.mouse.down();
    await page.mouse.move(h3.x+5,r0.y+3,{steps:8});
    await page.mouse.up();
    assert.deepEqual(await acts(page),['라','나','다','가']);
    /* 그냥 누르기만 하면 바뀌지 않는다 */
    const h1=await handle(1).boundingBox();
    await page.mouse.click(h1.x+h1.width/2,h1.y+h1.height/2);
    assert.deepEqual(await acts(page),['라','나','다','가']);
    assert.deepEqual(errors,[]);
    await context.close();
  }
  /* 터치 드래그 (태블릿·휴대폰) */
  {
    const {context,page,errors}=await open({hasTouch:true,isMobile:true,viewport:{width:820,height:1180}});
    const rows=page.locator('#gradeTable tbody tr');
    const h=await rows.nth(0).locator('.grade-drag').boundingBox(), r=await rows.nth(1).boundingBox();
    const cdp=await context.newCDPSession(page);
    const pt=(x,y)=>[{x,y,id:1}];
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:pt(h.x+h.width/2,h.y+h.height/2)});
    for(let k=1;k<=8;k++)
      await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:pt(h.x+h.width/2,h.y+h.height/2+(r.y+r.height*0.8-h.y-h.height/2)*k/8)});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    assert.deepEqual(await acts(page),['나','가','다','라']);
    assert.deepEqual(errors,[]);
    await context.close();
  }
  console.log('PASS: period times + legacy migration, upcoming-lesson shading moves with time, mouse/touch drag reorders lesson numbers');
}finally{await browser.close();await new Promise(r=>server.close(r));}
