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
  const gcalHits = [];
  await context.route('https://calendar.google.com/**',route=>{gcalHits.push(route.request().url());route.fulfill({contentType:'text/html',body:'<p>Google Calendar</p>'});});
  await context.route('**/firebase-config.js',route=>route.fulfill({contentType:'text/javascript',body:'window.HR_FIREBASE_CONFIG=null;'}));
  const page = await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  page.on('dialog',d=>d.accept());
  await page.goto(url);
  await page.waitForFunction(()=>!!window.HRCloud);

  const tab = name => page.getByRole('button',{name,exact:true}).click();
  // 왼쪽 탭 메뉴
  assert.deepEqual(await page.locator('#tabs button').allInnerTexts(),['일지','출결','명렬표','평가','누가기록','예산사용','메모','달력','설정']);
  // 기본 화면은 일지, 날짜는 하나로 크게, 날씨·행사 칸 없음, 출결 칸 없음
  assert.equal(await page.locator('#view-log').isVisible(),true);
  assert.match(await page.locator('.dh-date').innerText(),/^\d+월 \d+일 \([일월화수목금토]\)$/);
  assert.match(await page.locator('.yearpill').innerText(),/^\d{4}년$/);
  assert.equal(await page.locator('#view-log [data-f=weather], #view-log [data-f=event], #view-log [data-f=holiday]').count(),0);
  assert.equal(await page.locator('#view-log iframe, #view-log [data-gcalset], #view-log a[href*="calendar.google"]').count(),0);
  assert.equal(await page.getByRole('button',{name:'인쇄'}).filter({visible:true}).count(),0);
  // 시간표 왼쪽, 직접 만든 달력 오른쪽, 같은 크기
  const tt = await page.locator('#logTT').boundingBox(), gc = await page.locator('#logCal').boundingBox();
  assert.ok(tt.x < gc.x && Math.abs(tt.width-gc.width) < 2 && Math.abs(tt.height-gc.height) < 2, 'timetable left, calendar right, same size');
  assert.equal(await page.locator('#logTT tbody tr').first().innerText().then(t=>t.includes('아침')),true);
  assert.ok(true);
  const nav = await page.locator('#tabs').boundingBox();
  assert.ok(nav.x < 20 && nav.height > 400, 'tabs are a left sidebar on desktop');
  // 설정: 학급 정보 · 기초 시간표
  await tab('설정');
  await page.locator('[data-i=grade]').fill('3');
  await page.locator('[data-i=cls]').fill('2');
  assert.equal(await page.locator('#classLabel').innerText(),'3학년 2반');
  const dow = await page.evaluate(()=>new Date().getDay());
  const w = dow>=1&&dow<=5 ? dow : 1;
  await page.locator('#newSubj').fill('안전한 생활'); await page.locator('#newSubj').press('Enter');
  assert.match(await page.locator('.chips').innerText(),/안전한 생활/);
  await page.locator('[data-i=teacher]').fill('eun cho');
  await page.locator(`[data-tw="${w}"][data-tp="0"]`).selectOption('국어');
  await page.locator(`[data-tw="${w}"][data-tp="1"]`).selectOption('안전한 생활');
  // 명렬표 붙여넣기
  await tab('명렬표');
  await page.locator('#pasteRoster').fill('1\t김하준\t남\n2\t이서윤\t여\n3\t박도윤\t남');
  await page.locator('#applyRoster').click();
  assert.equal(await page.locator('table.roster tbody tr').count(),3);
  // 명렬표: 1열 번호, 2열 이름, 3열부터 체크 항목
  assert.deepEqual((await page.locator('table.chk-t thead th').allInnerTexts()).slice(0,2),['번호','이름']);
  assert.equal(await page.locator('table.chk-t [data-colt]').count(),5);
  await page.locator('table.chk-t [data-colt]').first().fill('가정통신문');
  await page.locator('table.chk-t tbody tr').nth(0).locator('input[type=checkbox]').first().check();
  await page.locator('table.chk-t tbody tr').nth(2).locator('input[type=checkbox]').first().check();
  assert.equal(await page.locator('table.chk-t tfoot td.ck').first().innerText(),'2/3');
  await page.locator('#addCol').click();
  assert.equal(await page.locator('table.chk-t [data-colt]').count(),6);
  await page.locator('table.chk-t [data-delcol]').last().click();
  // 전체 선택 / 해제
  const all0 = page.locator('table.chk-t [data-ckall]').first();
  assert.equal(await all0.evaluate(e=>e.indeterminate),true);
  await all0.check();
  assert.equal(await page.locator('table.chk-t tfoot td.ck').first().innerText(),'3/3');
  assert.equal(await page.locator('table.chk-t tbody tr').nth(1).locator('[data-ck]').first().isChecked(),true);
  await all0.uncheck();
  assert.equal(await page.locator('table.chk-t tfoot td.ck').first().innerText(),'0/3');
  await page.locator('table.chk-t tbody tr').nth(0).locator('[data-ck]').first().check();
  await page.locator('table.chk-t tbody tr').nth(2).locator('[data-ck]').first().check();
  // 두 번 누르면 비고
  await page.locator('table.chk-t tbody tr').nth(1).locator('td.ck').first().dblclick();
  await page.locator('#ckNote').fill('내일 가져오기로 함');
  await page.locator('#ckNoteSave').click();
  assert.match(await page.locator('table.chk-t tbody tr').nth(1).locator('td.ck').first().innerText(),/내일 가져오기로 함/);
  assert.equal(await page.locator('table.chk-t tbody tr').nth(1).locator('[data-ck]').first().isChecked(),false);
  await page.locator('table.chk-t thead th.ck').first().dblclick();
  await page.locator('#ckNote').fill('11월 7일까지');
  await page.locator('#ckNoteSave').click();
  assert.match(await page.locator('table.chk-t thead th.ck').first().innerText(),/11월 7일까지/);
  // 항목을 모두 지워도 번호·이름 칸 너비가 그대로
  const nmW = (await page.locator('table.chk-t thead th.nm').boundingBox()).width;
  await page.evaluate(()=>{window.__cols=JSON.stringify(state.checks);state.checks.cols=[];renderRoster();});
  assert.ok(Math.abs((await page.locator('table.chk-t thead th.nm').boundingBox()).width-nmW) < 2,'name column width stays');
  assert.ok((await page.locator('table.chk-t').boundingBox()).width < 260,'table does not stretch');
  await page.evaluate(()=>{state.checks=JSON.parse(window.__cols);renderRoster();});
  assert.equal(await page.locator('table.chk-t [data-colt]').count(),5);
  await page.locator('#stuInfo summary').click();
  await page.locator('table.roster tbody tr').first().locator('[data-s=phone]').fill('010-1234-5678');
  if(process.env.HR_SCREENSHOT_DIR) await page.screenshot({path:process.env.HR_SCREENSHOT_DIR+'/8-roster.png',fullPage:true});

  // 출결 (첫 탭)
  await tab('출결');
  if(!(dow>=1&&dow<=5)) await page.evaluate(()=>{ while(parseD(attDate).getDay()!==1) attDate=addDays(attDate,1); attMonth=attDate.slice(0,7); renderAtt(); });
  const logDay = await page.evaluate(()=>attDate);
  await page.locator('.stu').nth(1).click();
  await page.locator('#mType [data-t=결석]').click();
  await page.locator('#mReason [data-r=질병]').click();
  await page.locator('#mNote').fill('감기');
  await page.locator('#mSave').click();
  assert.match(await page.locator('.stu').nth(1).innerText(),/질병결석 · 감기/);
  assert.match(await page.locator('#view-att .attsum').innerText(),/출석 2/);
  assert.equal(await page.locator(`td[data-d="${logDay}"] b`).innerText(),'질결');

  // 일지
  await page.evaluate(d=>{logDate=d;},logDay);
  await tab('일지');
  assert.equal(await page.locator('#view-log .dh-sub, #view-log [data-help], #view-log .dh-main svg').count(),0);
  assert.doesNotMatch(await page.locator('#logHead').innerText(),/환영합니다/);
  assert.equal(await page.locator('[data-p="0"][data-k=subj]').inputValue(),'국어');
  await page.locator('[data-p="0"][data-k=content]').fill('문단의 중심 문장 찾기');
  assert.equal(await page.locator('[data-p="1"][data-k=subj]').inputValue(),'안전한 생활');
  await page.locator('[data-p="2"][data-k=subj]').selectOption('체육');
  await page.locator('[data-f=morning]').fill('아침 독서');
  await page.locator('[data-f=notice]').fill('내일 리코더 준비');
  // 할일: 체크박스 + 여러 줄
  await page.locator('#todoList [data-tt="0"]').fill('가정통신문 회수');
  await page.locator('#todoList [data-tt="0"]').press('Enter');
  await page.keyboard.type('우유 신청서 정리');
  assert.equal(await page.locator('#todoList [data-tt="1"]').inputValue(),'우유 신청서 정리');
  await page.locator('#todoList [data-td="0"]').check();
  assert.equal(await page.locator('#todoList li').first().getAttribute('class'),'done');
  assert.equal(await page.evaluate(d=>JSON.stringify(state.days[d].todos),await page.evaluate(()=>logDate)),JSON.stringify([{text:'가정통신문 회수',done:true},{text:'우유 신청서 정리',done:false}]));
  assert.equal(await page.locator('#todoList [data-tt="1"]').inputValue(),'우유 신청서 정리');
  // 달력: 일지 칸에서 바로 추가·수정·삭제
  const today = await page.evaluate(()=>logDate);
  const next = await page.evaluate(d=>addDays(d,2),today);
  await page.locator(`#logCal [data-sel="${next}"]`).click();
  await page.locator('#evTitle').fill('학부모 상담');
  await page.locator('#evTime').fill('15:30');
  await page.locator('#evTitle').press('Enter');
  assert.match(await page.locator(`#logCal [data-sel="${next}"]`).innerText(),/학부모 상담/);
  await page.locator('#evTitle').fill('현장체험학습 안내');
  await page.locator('#evAdd').click();
  assert.equal(await page.locator('#logCal .mc-list li').count(),2);
  assert.equal(await page.locator('#logCal .mc-list li').first().locator('[data-en]').inputValue(),'학부모 상담');
  await page.locator('#logCal .mc-list [data-en]').nth(0).fill('학부모 상담 (2명)');
  await page.locator('#logCal .mc-list [data-en]').nth(0).press('Enter');
  assert.match(await page.locator(`#logCal [data-sel="${next}"]`).innerText(),/학부모 상담 \(2명\)/);
  await page.locator('#logCal [data-edel]').nth(1).click();
  assert.equal(await page.evaluate(d=>eventsOn(d).map(e=>e.time+' '+e.title).join('|'),next),'15:30 학부모 상담 (2명)');
  assert.equal(await page.evaluate(()=>logDate),today,'selecting a calendar date does not move the journal');
  await page.locator('[data-gotolog]').click();
  assert.equal(await page.evaluate(()=>logDate),next);
  await page.locator('[data-go="0"]').click();
  if(await page.evaluate(()=>logDate)!==today) await page.evaluate(d=>setLogDate(d),today);
  // 메모: 저장하면 메모 탭에 새 메모로
  await page.locator('#logMemoIn').fill('교실 환경 정리 아이디어');
  await page.locator('#logMemoSave').click();
  assert.equal(await page.locator('#logMemoIn').inputValue(),'');
  assert.match(await page.locator('#memoSavedNote').innerText(),/메모 탭에 저장/);
  await page.locator('#logMemoIn').fill('두 번째 메모');
  await page.locator('#logMemoIn').press('Control+Enter');
  assert.equal(await page.locator('#logMemo [data-openmemo]').count(),2);
  assert.equal(await page.evaluate(d=>state.memos.filter(m=>m.date===d).map(m=>m.text).join('|'),today),'교실 환경 정리 아이디어|두 번째 메모');
  await page.locator('#logMemo [data-openmemo]').first().click();
  assert.equal(await page.locator('#view-memo').isVisible(),true);
  assert.equal(await page.locator('#view-memo .memo').count(),2);
  await tab('일지');
  await page.locator('#logRecs [data-rf=sid]').selectOption({label:'1. 김하준'});
  await page.locator('#logRecs [data-rf=text]').fill('발표를 적극적으로 함');
  await page.locator('#logRecs [data-rf=text]').press('Enter');
  assert.match(await page.locator('#logRecs .reclist').innerText(),/발표를 적극적으로 함/);

  // 누가기록
  await tab('누가기록');
  assert.match(await page.locator('#stuRecs').innerText(),/김하준[\s\S]*발표를 적극적으로 함/);
  await page.locator('[data-stu]').nth(2).click();
  assert.match(await page.locator('#view-rec').innerText(),/질병결석/);

  // 평가
  await tab('평가');
  await page.locator('#newEval').click();
  await page.locator('#eSubj').fill('수학');
  await page.locator('#eTitle').fill('분수의 덧셈');
  await page.locator('#eSave').click();
  await page.locator('[data-lv=잘함]').first().click();
  await page.locator('[data-enote]').first().fill('통분 과정을 정확히 설명함');
  assert.match(await page.locator('#evDist').innerText(),/잘함 1/);

  // 예산사용
  await tab('예산사용');
  await page.locator('#budTotal').fill('300000'); await page.locator('#budTotal').press('Tab');
  await page.locator('#bItem').fill('학급 문구');
  await page.locator('#bAmt').fill('45000');
  await page.locator('#bAdd').click();
  assert.match(await page.locator('#view-budget .budsum').innerText(),/45,000원[\s\S]*255,000원/);

  // 메모
  await tab('메모');
  await page.locator('#newMemo').click();
  await page.keyboard.type('학부모 상담 준비');
  await page.locator('.memo:focus-within textarea').fill('상담 일정표 출력');

  // 달력
  await page.evaluate(d=>{calMonth=d.slice(0,7);},logDay);
  await tab('달력');
  assert.match(await page.locator(`[data-day="${logDay}"]`).innerText(),/결1/);
  await page.waitForTimeout(400);
  const local = await page.evaluate(()=>localStorage.getItem('homeroom-journal-v1'));
  for(const t of ['리코더','통분','학급 문구','상담 일정표','010-1234-5678','가정통신문','아침 독서','우유 신청서 정리','안전한 생활','학부모 상담 (2명)','교실 환경 정리 아이디어','내일 가져오기로 함','11월 7일까지']) assert.ok(local.includes(t), t);
  if(process.env.HR_SCREENSHOT_DIR){
    const D=process.env.HR_SCREENSHOT_DIR;
    await tab('출결'); await page.screenshot({path:D+'/1-att.png',fullPage:true});
    await tab('설정'); await page.screenshot({path:D+'/9-setup.png',fullPage:true});
    await tab('일지'); await page.screenshot({path:D+'/2-log.png',fullPage:true});
    await tab('평가'); await page.screenshot({path:D+'/3-eval.png'});
    await tab('예산사용'); await page.screenshot({path:D+'/4-budget.png'});
    await tab('메모'); await page.screenshot({path:D+'/5-memo.png'});
    await page.setViewportSize({width:390,height:844});
    await tab('출결'); await page.screenshot({path:D+'/6-mobile.png'});
    await page.setViewportSize({width:820,height:1100});
    await page.screenshot({path:D+'/7-tablet.png'});
    await page.setViewportSize({width:1280,height:900});
  }

  // 휴대폰에서도 탭은 왼쪽
  await page.setViewportSize({width:390,height:844});
  const rail = await page.locator('#tabs').boundingBox();
  assert.ok(rail.x < 10 && rail.width < 70 && rail.height > 500, 'tabs are a left rail on phones');
  await page.setViewportSize({width:1280,height:900});

  // 로그인: 계정별 저장, 기존 일지 가져오기, 계정 분리
  await context.route('**/firebase-config.js',route=>route.fulfill({contentType:'text/javascript',body:'window.HR_FIREBASE_CONFIG={apiKey:"t",authDomain:"t",projectId:"t",appId:"t"};'}));
  await context.route('https://www.gstatic.com/firebasejs/**',route=>route.fulfill({contentType:'text/javascript',body:mock}));
  await context.addInitScript(()=>{window.__backend={docs:{},listeners:{},next:'A',offline:false};});
  await page.reload();
  await page.locator('#welcomeLogin:not([disabled])').waitFor();
  await page.locator('#welcomeLogin').click();
  await page.waitForFunction(()=>document.getElementById('cloudStatus').textContent==='온라인 저장 완료');
  assert.equal(await page.evaluate(()=>window.__backend.collection),'homeroomJournals');
  // 로그인 후 일지는 메모 칸까지 한 화면(1280×900)에 들어옴
  assert.ok((await page.locator('#logMemo').boundingBox()).y + (await page.locator('#logMemo').boundingBox()).height <= 900, 'memo fits in one screen');
  assert.equal(await page.evaluate(()=>state.students.length),0);
  assert.equal(await page.locator('#loginWelcome').isVisible(),false);
  await page.getByRole('button',{name:'설정',exact:true}).click();
  await page.locator('#cloudMigrate').click();
  await page.waitForFunction(()=>window.__backend.docs.A?.payload.includes('리코더'));
  assert.equal(await page.evaluate(()=>state.students.length),3);
  await page.locator('#cloudLogout').click();
  await page.waitForFunction(()=>!window.HRCloud.active);
  await page.evaluate(()=>{window.__backend.next='B';});
  await page.locator('#cloudLogin').click();
  await page.waitForFunction(()=>document.getElementById('cloudAccount').textContent==='B@example.test'&&!document.querySelector('main').inert);
  assert.equal(await page.evaluate(()=>state.students.length),0);
  assert.deepEqual(errors,[]);
  console.log('PASS: left tabs, roster, attendance, journal, records, evaluation, budget, memo, calendar, local save, login sync, migration, account isolation');
  await context.close();
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
