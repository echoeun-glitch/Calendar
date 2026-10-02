// Run with PE_PLAYWRIGHT_MODULE pointing at an installed Playwright package.
// 공유 열람 화면이 날짜별 수정까지 보여 주고, 자동으로 최신 내용을 반영하며, 열람한 기기의 일지를 건드리지 않는지 확인한다.
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PE_PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('./', import.meta.url));
const server = createServer(async (req,res) => {
  const path = decodeURIComponent(req.url.split('?')[0]);
  if (path.includes('..')) {res.writeHead(403); res.end(); return;}
  try {
    const data = await readFile(root + (path === '/' ? 'index.html' : path.slice(1)));
    res.setHeader('Content-Type', /\.(m?js)$/.test(path) ? 'text/javascript' : /\.png$/.test(path) ? 'image/png' : 'text/html; charset=utf-8');
    res.end(data);
  } catch {res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch(process.env.PE_BROWSER ? {channel:process.env.PE_BROWSER,headless:true} : {headless:true});
const errors = [];
const token = 'a'.repeat(64);
let published = null;
try {
  const context = await browser.newContext({serviceWorkers:'block',viewport:{width:1280,height:900}});
  await context.route('**/firebase-config.js', r=>r.fulfill({contentType:'text/javascript',body:'window.PE_FIREBASE_CONFIG={projectId:"test"};'}));
  await context.route('https://firestore.googleapis.com/**', r=>r.fulfill(published
    ? {status:200,contentType:'application/json',body:JSON.stringify({fields:{payload:{stringValue:published}}})}
    : {status:404,contentType:'application/json',body:'{}'}));

  // 교사 화면(게스트 모드)에서 공유 문서를 만든다.
  const owner = await context.newPage(); owner.on('pageerror',e=>errors.push(e.message));
  await owner.goto(url);
  const publish = () => owner.evaluate(()=>JSON.stringify(window.PEJournal.shareSnapshot(window.PEJournal.get())));
  await owner.evaluate(()=>{
    state.start='2026-10-05'; state.end='2026-10-16';
    state.semester2={start:'',end:'',base:{}};
    state.base={'1-1':{cls:'3-1',place:'p1'},'2-1':{cls:'3-2',place:'p1'}};
    state.classes=[{name:'3-1',plan:0,capOn:false,from:'',to:''},{name:'3-2',plan:0,capOn:false,from:'',to:''},{name:'3-3',plan:0,capOn:false,from:'',to:''}];
    state.logs={'2026-10-05':'PRIVATE_DIARY'};
    state.roster={'3-1':[{no:1,name:'PRIVATE_STUDENT'}]};
    state.grades={'3':[{unit:'',act:'티볼 기초',note:'PRIVATE_PLAN_NOTE'}]};
    state.rec={
      '2026-10-05#1':{cls:'3-3',prog:'날짜별 수정 진도',special:'PRIVATE_SPECIAL'},
      '2026-10-06#1':{del:1}
    };
    touch();
  });
  await owner.waitForTimeout(500);
  published = await publish();
  assert.doesNotMatch(published,/PRIVATE_/,'private fields stay out of the share document');
  assert.match(published,/날짜별 수정 진도/);

  // 열람 화면을 같은 브라우저에서 연다: 이 기기의 일지는 그대로 남아야 한다.
  const localBefore = await owner.evaluate(()=>localStorage.getItem('pe-annual-v1'));
  assert.match(localBefore,/PRIVATE_DIARY/);
  const viewer = await context.newPage(); viewer.on('pageerror',e=>errors.push(e.message));
  await viewer.goto(url+'share.html#'+token);
  await viewer.waitForURL(/\?share=/);
  await viewer.waitForFunction(()=>!document.documentElement.classList.contains('share-loading'));
  const year = await viewer.locator('#view-year').innerText();
  assert.match(year,/3-3/,'per-date class change is shown');
  assert.doesNotMatch(await viewer.locator('body').innerText(),/PRIVATE_/);
  assert.match(await viewer.locator('#shareReadOnly').innerText(),/열람 전용/);

  // 교사가 저장하면 열람 화면이 새로고침 없이 반영한다.
  await owner.evaluate(()=>{state.rec['2026-10-05#1'].cls='3-2';state.rec['2026-10-07#1']={};state.base['3-1']={cls:'3-1',place:'p1'};touch();});
  published = await publish();
  await viewer.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  await viewer.waitForFunction(()=>window.PEJournal.get().includes('"3-1":{"cls":"3-1"'));
  assert.equal(await viewer.locator('#shareReadOnly').count(),1,'read-only badge is not duplicated');

  await viewer.close();
  assert.equal(await owner.evaluate(()=>localStorage.getItem('pe-annual-v1')),localBefore,'viewer never overwrites local journal');

  // 공유가 중지되면 내용이 가려진다.
  const viewer2 = await context.newPage(); viewer2.on('pageerror',e=>errors.push(e.message));
  published = null;
  await viewer2.goto(url+'index.html?share='+token);
  await viewer2.waitForFunction(()=>/중지/.test(document.getElementById('cloudStatus').textContent));
  assert.equal(await viewer2.evaluate(()=>document.documentElement.classList.contains('share-loading')),true);
  await viewer2.close();
  assert.equal(await owner.evaluate(()=>localStorage.getItem('pe-annual-v1')),localBefore);

  assert.deepEqual(errors,[]);
  console.log('PASS: per-date edits shared, private fields hidden, live refresh, local journal untouched, revoked link hidden');
  await context.close();
} finally {await browser.close(); await new Promise(resolve=>server.close(resolve));}
