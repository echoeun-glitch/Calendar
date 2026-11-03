// node homeroom/homeroom.browser.test.mjs  (Playwright 필요)
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
const browser = await chromium.launch(process.env.PE_BROWSER ? {channel:process.env.PE_BROWSER} : {});
const errors = [];
const mock = `
const b = window.__backend;
const snap = ref => ({exists:()=>!!b.docs[ref.uid], data:()=>b.docs[ref.uid], metadata:{fromCache:false,hasPendingWrites:false}});
export const initializeApp=()=>({}), getAuth=()=>({}), getFirestore=()=>({}), browserSessionPersistence={};
export const setPersistence=async()=>{};
export class GoogleAuthProvider {setCustomParameters(){}}
export const onAuthStateChanged=(auth,cb)=>{b.auth=cb; queueMicrotask(()=>cb(null));};
export const signInWithPopup=async()=>{b.auth({uid:b.next,email:b.next+'@example.test'});};
export const signOut=async()=>{b.auth(null);};
export const doc=(db,collection,uid)=>{b.collection=collection;return {uid};};
export const getDocFromServer=async ref=>{if(b.offline)throw Error('offline');return snap(ref);};
export const serverTimestamp=()=>123;
export const runTransaction=async(db,fn)=>{
  if(b.offline)throw Error('offline');
  return fn({get:async ref=>snap(ref),set:(ref,data)=>{b.docs[ref.uid]=data;queueMicrotask(()=>b.listeners[ref.uid]?.(snap(ref)));}});
};
export const onSnapshot=(ref,opts,cb)=>{b.listeners[ref.uid]=cb;queueMicrotask(()=>cb(snap(ref)));return()=>delete b.listeners[ref.uid];};
`;
try {
  const context = await browser.newContext({serviceWorkers:'block',viewport:{width:1280,height:900}});
  await context.route('**/firebase-config.js',route=>route.fulfill({contentType:'text/javascript',body:'window.HR_FIREBASE_CONFIG=null;'}));
  const page = await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  page.on('dialog',d=>d.accept());
  await page.goto(url);
  await page.waitForFunction(()=>!!window.HRCloud);

  // 게스트: 명렬표 붙여넣기
  await page.getByRole('button',{name:'설정',exact:true}).click();
  await page.locator('[data-i=grade]').fill('3');
  await page.locator('[data-i=cls]').fill('2');
  await page.locator('summary').click();
  await page.locator('#pasteRoster').fill('1\t김하준\t남\n2\t이서윤\t여\n3\t박도윤\t남');
  await page.locator('#applyRoster').click();
  assert.equal(await page.locator('table.roster tbody tr').count(),3);
  assert.equal(await page.locator('#classLabel').innerText(),'3학년 2반');
  // 기초 시간표 → 일지 과목 자동
  const dow = await page.evaluate(()=>new Date().getDay());
  const w = dow>=1&&dow<=5 ? dow : 1;
  await page.locator(`[data-tw="${w}"][data-tp="0"]`).fill('국어');

  // 일지: 출결 입력
  await page.getByRole('button',{name:'일지',exact:true}).click();
  if(!(dow>=1&&dow<=5)) await page.evaluate(()=>{ /* 주말이면 다음 월요일로 */ while(new Date(logDate).getDay()!==1) logDate=addDays(logDate,1); renderLog(); });
  assert.equal(await page.locator('[data-p="0"][data-k=subj]').inputValue(),'국어');
  await page.locator('[data-p="0"][data-k=content]').fill('문단의 중심 문장 찾기');
  await page.locator('.stu').nth(1).click();
  await page.locator('#mType [data-t=결석]').click();
  await page.locator('#mReason [data-r=질병]').click();
  await page.locator('#mNote').fill('감기');
  await page.locator('#mSave').click();
  assert.match(await page.locator('.stu').nth(1).innerText(),/질병결석 · 감기/);
  assert.match(await page.locator('.attsum').innerText(),/출석 2/);
  await page.locator('[data-f=notice]').fill('내일 리코더 준비');
  // 오늘의 학생 기록
  await page.locator('#logRecs [data-rf=sid]').selectOption({label:'1. 김하준'});
  await page.locator('#logRecs [data-rf=text]').fill('발표를 적극적으로 함');
  await page.locator('#logRecs [data-rf=text]').press('Enter');
  assert.match(await page.locator('#logRecs .reclist').innerText(),/발표를 적극적으로 함/);
  const logDay = await page.evaluate(()=>logDate);

  // 출결부
  await page.evaluate(d=>{attMonth=d.slice(0,7);},logDay);
  await page.getByRole('button',{name:'출결부',exact:true}).click();
  assert.equal(await page.locator(`td[data-d="${logDay}"] b`).innerText(),'질결');
  // 학생 누가기록
  await page.getByRole('button',{name:'학생',exact:true}).click();
  assert.match(await page.locator('#stuRecs').innerText(),/발표를 적극적으로 함/);
  // 달력
  await page.evaluate(d=>{calMonth=d.slice(0,7);},logDay);
  await page.getByRole('button',{name:'달력',exact:true}).click();
  assert.match(await page.locator(`[data-day="${logDay}"]`).innerText(),/결1/);
  await page.waitForTimeout(400);
  const local = await page.evaluate(()=>localStorage.getItem('homeroom-journal-v1'));
  assert.match(local,/리코더/);
  if(process.env.HR_SCREENSHOT_DIR){
    await page.locator(`[data-day="${logDay}"]`).click();
    await page.screenshot({path:process.env.HR_SCREENSHOT_DIR+'/log-desktop.png',fullPage:true});
    await page.getByRole('button',{name:'출결부',exact:true}).click();
    await page.screenshot({path:process.env.HR_SCREENSHOT_DIR+'/att-desktop.png'});
    await page.setViewportSize({width:390,height:844});
    await page.getByRole('button',{name:'일지',exact:true}).click();
    await page.screenshot({path:process.env.HR_SCREENSHOT_DIR+'/log-mobile.png',fullPage:true});
    await page.setViewportSize({width:1280,height:900});
  }

  // 로그인: 계정별 저장, 기존 일지 가져오기, 계정 분리
  await context.route('**/firebase-config.js',route=>route.fulfill({contentType:'text/javascript',body:'window.HR_FIREBASE_CONFIG={apiKey:"t",authDomain:"t",projectId:"t",appId:"t"};'}));
  await context.route('https://www.gstatic.com/firebasejs/**',route=>route.fulfill({contentType:'text/javascript',body:mock}));
  await context.addInitScript(()=>{window.__backend={docs:{},listeners:{},next:'A',offline:false};});
  await page.reload();
  await page.locator('#welcomeLogin:not([disabled])').waitFor();
  await page.locator('#welcomeLogin').click();
  await page.waitForFunction(()=>document.getElementById('cloudStatus').textContent==='온라인 저장 완료');
  assert.equal(await page.evaluate(()=>window.__backend.collection),'homeroomJournals');
  assert.equal(await page.evaluate(()=>state.students.length),0);
  assert.equal(await page.locator('#loginWelcome').isVisible(),false);
  await page.getByRole('button',{name:'설정',exact:true}).click();
  await page.locator('#cloudMigrate').click();
  await page.waitForFunction(()=>window.__backend.docs.A?.payload.includes('리코더'));
  assert.equal(await page.locator('table.roster tbody tr').count(),3);
  await page.locator('#cloudLogout').click();
  await page.waitForFunction(()=>!window.HRCloud.active);
  await page.evaluate(()=>{window.__backend.next='B';});
  await page.locator('#cloudLogin').click();
  await page.waitForFunction(()=>document.getElementById('cloudAccount').textContent==='B@example.test'&&!document.querySelector('main').inert);
  assert.equal(await page.evaluate(()=>state.students.length),0);
  assert.deepEqual(errors,[]);
  console.log('PASS: roster paste, timetable autofill, attendance, records, attendance sheet, calendar, local save, login sync, migration, account isolation');
  await context.close();
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
