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
  const context=await browser.newContext({serviceWorkers:'block'});
  await context.route('**/firebase-config.js',r=>r.fulfill({contentType:'text/javascript',body:'window.PE_FIREBASE_CONFIG={apiKey:"test",authDomain:"test",projectId:"test",appId:"test"};'}));
  await context.route('https://www.gstatic.com/firebasejs/**',r=>r.fulfill({contentType:'text/javascript',body:mock}));
  await context.addInitScript(()=>{window.__backend={docs:{},listeners:{},next:'A',offline:false};});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url);await page.locator('#cloudLogin:not([disabled])').waitFor();
  await page.locator('#cloudLogin').click();
  await page.waitForFunction(()=>!document.querySelector('main').inert);
  await page.evaluate(()=>{
    state.start='2026-10-01';state.end='2026-10-09';
    state.base={'4-1':{cls:'3-1',place:'p1'}};
    state.classes=[{name:'3-1'}];state.grades={'3':[{act:'티볼 수업',note:'PRIVATE_PLAN_NOTE'}]};
    state.logs={'2026-10-01':'PRIVATE_DIARY'};
    state.roster={'3-1':[{name:'PRIVATE_STUDENT',no:1,note:'PRIVATE_STUDENT_NOTE'}]};
    state.rec={'2026-10-01#1':{special:'PRIVATE_SPECIAL'}};
    touch();view='setup';render();
  });
  await page.waitForFunction(()=>window.__backend.docs.A?.payload.includes('PRIVATE_DIARY'));
  await page.locator('#shareCreate:not([disabled])').click();
  await page.locator('#shareUrl:not([hidden])').waitFor();
  const shareUrl=await page.locator('#shareUrl').inputValue(),token=new URL(shareUrl).hash.slice(1);
  assert.match(token,/^[a-f0-9]{64}$/);
  const published=await page.evaluate(t=>window.__backend.docs['peShares/'+t],token);
  assert.doesNotMatch(published.payload,/PRIVATE_/);
  assert.match(published.payload,/티볼 수업/);
  const before=await page.evaluate(()=>window.PEJournal.get());
  await page.evaluate(()=>window.PEJournal.shareSnapshot(window.PEJournal.get()));
  assert.equal(await page.evaluate(()=>window.PEJournal.get()),before);
  // Anonymous page receives only the allowlisted public document.
  const viewerContext=await browser.newContext({serviceWorkers:'block',viewport:{width:390,height:844}});
  await viewerContext.route('**/firebase-config.js',r=>r.fulfill({contentType:'text/javascript',body:'window.PE_FIREBASE_CONFIG={projectId:"test"};'}));
  await viewerContext.route('https://firestore.googleapis.com/**',async r=>{
    const requested=r.request().url().split('/').pop();
    const doc=await page.evaluate(t=>window.__backend.docs['peShares/'+t],requested);
    await r.fulfill({status:doc?200:404,contentType:'application/json',body:doc?JSON.stringify({fields:{payload:{stringValue:doc.payload}}}):'{}'});
  });
  const viewer=await viewerContext.newPage();viewer.on('pageerror',e=>errors.push(e.message));
  const requests=[];viewer.on('request',r=>requests.push(r.url()));
  await viewer.goto(shareUrl);await viewer.locator('#schedule:not([hidden])').waitFor();
  assert.match(await viewer.locator('#content').innerText(),/티볼 수업/);
  assert.doesNotMatch(await viewer.locator('body').innerText(),/PRIVATE_/);
  assert.equal(await viewer.locator('input,textarea,[contenteditable=true]').count(),0);
  assert.deepEqual(await viewer.locator('nav button').allTextContents(),['연간','주간']);
  assert.equal(requests.some(u=>/peJournals|cloud\.js|firebase-auth/.test(u)),false);
  await viewer.locator('#weekTab').click();
  await viewer.locator('#classFilter').selectOption('3-1');
  assert.equal(await viewer.locator('#weekNav').isVisible(),true);
  await page.evaluate(()=>{state.grades['3'][0].act='수정한 수업';touch();});
  await page.waitForFunction(t=>window.__backend.docs['peShares/'+t]?.payload.includes('수정한 수업'),token);
  await viewer.locator('#refresh').click();await viewer.locator('#yearTab').click();
  await viewer.waitForFunction(()=>document.getElementById('content').textContent.includes('수정한 수업'));
  if(process.env.PE_SCREENSHOT_DIR)await viewer.screenshot({path:process.env.PE_SCREENSHOT_DIR+'/pe-sharing-mobile.png',fullPage:true});
  await page.locator('#shareRevoke').click();await page.locator('#shareCreate:not([hidden])').waitFor();
  await viewer.locator('#refresh').click();
  await viewer.waitForFunction(()=>document.getElementById('schedule').hidden);
  assert.equal(await viewer.locator('#content').innerText(),'');
  assert.match(await viewer.locator('#status').innerText(),/중지/);
  await page.evaluate(()=>{state.grades['3'][0].act='중지 후 편집';touch();});
  await page.waitForFunction(()=>window.__backend.docs.A?.payload.includes('중지 후 편집'));
  assert.equal(await page.evaluate(t=>window.__backend.docs['peShares/'+t],token),undefined);
  await page.locator('#shareCreate').click();await page.locator('#shareUrl:not([hidden])').waitFor();
  assert.notEqual(await page.locator('#shareUrl').inputValue(),shareUrl);
  await page.locator('#cloudLogout').click();
  await page.waitForFunction(()=>document.getElementById('shareUrl').hidden);
  assert.equal(await page.locator('#shareUrl').inputValue(),'');
  assert.deepEqual(errors,[]);
  console.log('PASS: private projection, owner create/revoke/rotate, auto publication on save, anonymous read-only year/week, no private requests, mobile, revoked content cleared, logout cleanup');
  await viewerContext.close();await context.close();
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
