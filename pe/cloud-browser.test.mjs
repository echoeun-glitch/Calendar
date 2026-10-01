// Run with PE_PLAYWRIGHT_MODULE pointing at an installed Playwright package.
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
const browser = await chromium.launch({channel:process.env.PE_BROWSER || 'msedge',headless:true});
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
export const doc=(db,collection,uid)=>({uid:collection==='peJournals'?uid:collection+'/'+uid});
export const getDocFromServer=async ref=>{if(b.offline)throw Error('offline');return snap(ref);};
export const serverTimestamp=()=>123;
export const runTransaction=async(db,fn)=>{
  if(b.offline)throw Error('offline');
  return fn({get:async ref=>snap(ref),delete:ref=>{delete b.docs[ref.uid];},set:(ref,data)=>{b.docs[ref.uid]=data;queueMicrotask(()=>b.listeners[ref.uid]?.(snap(ref)));}});
};
export const onSnapshot=(ref,opts,cb)=>{b.listeners[ref.uid]=cb;queueMicrotask(()=>cb(snap(ref)));return()=>delete b.listeners[ref.uid];};
`;
try {
  const context = await browser.newContext({serviceWorkers:'block',viewport:{width:390,height:844}});
  await context.route('**/firebase-config.js',route=>route.fulfill({contentType:'text/javascript',body:'window.PE_FIREBASE_CONFIG=null;'}));
  const page = await context.newPage(); page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url);
  await page.waitForFunction(()=>!!window.PECloud);
  assert.equal(await page.locator('#cloudLogin').isDisabled(),true);
  assert.equal(await page.locator('main').evaluate(e=>e.inert),false);
  await page.evaluate(()=>{state.logs['2026-09-27']='기존 브라우저 일지';touch();});
  await page.waitForTimeout(300);
  assert.match(await page.evaluate(()=>localStorage.getItem('pe-annual-v1')),/기존 브라우저 일지/);
  await context.route('**/firebase-config.js',route=>route.fulfill({contentType:'text/javascript',body:'window.PE_FIREBASE_CONFIG={apiKey:"test",authDomain:"test",projectId:"test",appId:"test"};'}));
  await context.route('https://www.gstatic.com/firebasejs/**',route=>route.fulfill({contentType:'text/javascript',body:mock}));
  await context.addInitScript(()=>{window.__backend={docs:{},listeners:{},next:'A',offline:false};});
  page.on('dialog',dialog=>dialog.accept());
  await page.reload();
  await page.locator('#cloudLogin:not([disabled])').waitFor();
  await page.locator('#cloudLogin').click();
  await page.waitForFunction(()=>document.getElementById('cloudStatus').textContent==='온라인 저장 완료');
  assert.equal(await page.evaluate(()=>state.logs['2026-09-27']),undefined);
  assert.equal(await page.locator('#cloudPanel').isVisible(),false);
  assert.equal(await page.locator('.account-controls #cloudLogout').isVisible(),true);
  await page.setViewportSize({width:1280,height:800});
  await page.getByRole('button',{name:'설정',exact:true}).click();
  await page.locator('#cloudMigrate').click();
  await page.waitForFunction(()=>window.__backend.docs.A?.payload.includes('기존 브라우저 일지'));
  await page.evaluate(()=>{state.logs['2026-09-28']='계정 A 기록';touch();});
  await page.waitForFunction(()=>window.__backend.docs.A?.payload.includes('계정 A 기록'));
  assert.doesNotMatch(await page.evaluate(()=>localStorage.getItem('pe-annual-v1')),/계정 A 기록/);
  await page.locator('#cloudLogout').click();
  await page.waitForFunction(()=>!window.PECloud.active);
  await page.evaluate(()=>{window.__backend.next='B';});
  await page.locator('#cloudLogin').click();
  await page.waitForFunction(()=>document.getElementById('cloudAccount').textContent==='B@example.test'&&!document.querySelector('main').inert);
  assert.equal(await page.evaluate(()=>state.logs['2026-09-28']),undefined);
  await page.evaluate(()=>{window.__backend.offline=true;state.logs['2026-09-29']='오프라인 초안';touch();});
  await page.waitForFunction(()=>document.getElementById('cloudStatus').textContent.includes('온라인 저장 실패'));
  assert.ok(await page.evaluate(()=>Object.keys(localStorage).some(k=>k.startsWith('pe-cloud-draft-v1:B:'))));
  await page.evaluate(()=>{window.__backend.offline=false;window.dispatchEvent(new Event('online'));});
  await page.waitForFunction(()=>window.__backend.docs.B?.payload.includes('오프라인 초안'));
  await page.evaluate(()=>{state.logs['2026-09-30']='충돌 전 입력';touch();window.__backend.docs.B={revision:2,payload:window.PEJournal.empty()};});
  await page.waitForFunction(()=>!document.getElementById('cloudConflict').hidden);
  assert.equal(await page.locator('#cloudPanel').isVisible(),true);
  assert.equal(await page.locator('main').evaluate(e=>e.inert),true);
  assert.equal(await page.evaluate(()=>state.logs['2026-09-30']),'충돌 전 입력');
  await page.locator('#cloudReload').click();
  await page.waitForFunction(()=>document.getElementById('cloudConflict').hidden);
  assert.equal(await page.evaluate(()=>state.logs['2026-09-30']),undefined);
  assert.deepEqual(errors,[]);
  console.log('PASS: local preservation, mobile account panel, opt-in migration, account isolation, offline retry, conflict backup/reload, no browser errors');
  await context.close();
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
