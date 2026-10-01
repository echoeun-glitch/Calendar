import { JournalSync } from './cloud-sync.mjs';
import { createSharing, resetSharing } from './sharing.mjs';

const journal = window.PEJournal;
const el = id => document.getElementById(id);
const config = window.PE_FIREBASE_CONFIG;
let engine = null, currentUser = null, unsubscribe = null, timer = null;
let epoch = 0, ready = false, sdk, auth, db, reference, deferred = null;
let draftKey = null, persistenceFailed = false, backedUp = false;
let recoveredDraft = null;
const prefix = 'pe-cloud-draft-v1:';
// Separate drafts preserve unsent work when two tabs edit at the same time.
let tabId;
try {
  tabId = sessionStorage.getItem('pe-cloud-tab') || crypto.randomUUID();
  sessionStorage.setItem('pe-cloud-tab', tabId);
} catch { tabId = crypto.randomUUID(); }

function lock(value) {
  document.querySelector('main').inert = value;
  el('tabs').inert = value;
  el('modalRoot').inert = value;
}
function notice(text) {
  el('cloudHelp').textContent=text;
  el('cloudHelp').hidden=false;
  el('cloudPanel').hidden=false;
}
function clearNotice() {
  el('cloudHelp').textContent='';
  el('cloudHelp').hidden=true;
  el('cloudPanel').hidden=true;
}
function message(text, bad = false) {
  el('cloudStatus').textContent = text;
  journal.status(text, bad);
}
function errorText(error) {
  const code = error?.code || '';
  if (code.includes('popup-blocked')) return '로그인 창이 차단되었습니다. 브라우저에서 팝업을 허용하고 다시 눌러 주세요.';
  if (code.includes('popup-closed') || code.includes('cancelled-popup')) return '로그인이 취소되었습니다. 다시 로그인할 수 있습니다.';
  if (code.includes('unauthorized-domain')) return 'Firebase Authentication의 승인된 도메인에 현재 사이트 주소를 추가해 주세요.';
  if (code.includes('operation-not-allowed')) return 'Firebase Authentication에서 Google 로그인을 사용 설정해 주세요.';
  if (code.includes('permission-denied')) return '저장소 접근이 거부되었습니다. Firebase의 보안 규칙과 로그인 계정을 확인해 주세요.';
  if (code.includes('resource-exhausted')) return '온라인 저장 한도에 도달했습니다. 현재 입력을 백업하고 잠시 후 다시 시도해 주세요.';
  if (code === 'too-large') return '일지 용량이 온라인 저장 한도를 넘었습니다. 백업 후 지난 학기 기록을 정리해 주세요.';
  return '온라인 연결을 확인해 주세요. 이 기기에 남아 있는 입력은 연결이 복구되면 다시 저장합니다.';
}
function report(kind, error) {
  const labels = {saved:'온라인 저장 완료', pending:'이 기기에 보관 · 동기화 대기', saving:'온라인 저장 중…', conflict:'다른 기기의 수정 확인 필요', error:'온라인 저장 실패 · 입력 보관 중'};
  message(persistenceFailed ? '기기 백업 실패 · 온라인 저장 상태 확인 필요' : labels[kind], persistenceFailed || kind === 'error' || kind === 'conflict');
  if (kind === 'saved' && !persistenceFailed) clearNotice();
  if (kind === 'conflict') { el('cloudPanel').hidden=false; el('cloudHelp').hidden=true; }
  el('cloudConflict').hidden = kind !== 'conflict';
  el('cloudRetry').hidden = !['pending','error'].includes(kind);
  lock(kind === 'conflict');
  if (error) notice(errorText(error));
  if (kind === 'pending' && navigator.onLine) schedule();
}
function schedule() {
  clearTimeout(timer);
  timer = setTimeout(() => engine?.flush(), 1000);
}
function save(payload) {
  if (!ready || !engine || payload === engine.payload) return;
  backedUp = false;
  engine.edit(payload);
  schedule();
}
window.PECloud = {active:false, save};

function apply(payload) {
  deferred = null;
  journal.replace(payload);
}
function persist(draft) {
  try {
    if (draft.dirty) localStorage.setItem(draftKey, JSON.stringify({...draft, savedAt:Date.now()}));
    else {
      localStorage.removeItem(draftKey);
      if (recoveredDraft) {
        const original = localStorage.getItem(recoveredDraft.key);
        if (original === recoveredDraft.raw) localStorage.removeItem(recoveredDraft.key);
        recoveredDraft = null;
      }
    }
    persistenceFailed = false;
  } catch {
    persistenceFailed = true;
    notice('브라우저에 임시 저장할 수 없습니다. 온라인 저장 완료를 확인하고, 실패하면 현재 입력을 백업해 주세요.');
  }
}
function recoverDraft(uid) {
  const keys = Object.keys(localStorage).filter(k => k.startsWith(prefix + uid + ':'));
  const drafts = keys.map(key => {
    try { return {key, ...JSON.parse(localStorage.getItem(key))}; } catch { return null; }
  }).filter(d => d?.dirty && typeof d.payload === 'string').sort((a,b) => b.savedAt-a.savedAt);
  if (!drafts.length) return null;
  const own = drafts.find(d => d.key === draftKey);
  if (own) return own;
  if (confirm('이 계정으로 다른 탭이나 이전 방문에서 저장하지 못한 입력이 있습니다. 이 기기의 입력을 복구할까요?')) {
    recoveredDraft = {key:drafts[0].key, raw:localStorage.getItem(drafts[0].key)};
    return drafts[0];
  }
  return null;
}
function timeout(promise) {
  let t;
  return Promise.race([promise, new Promise((_,reject) => {
    t = setTimeout(() => reject(new Error('connection-timeout')), 15000);
  })]).finally(() => clearTimeout(t));
}
async function readRemote() {
  const snap = await timeout(sdk.getDocFromServer(reference));
  return snap.exists() ? snap.data() : null;
}
async function openUser(user) {
  const generation = ++epoch;
  resetSharing();
  unsubscribe?.(); unsubscribe = null;
  clearTimeout(timer);
  engine?.close(); engine = null;
  ready = false;
  recoveredDraft = null;
  deferred = null;
  backedUp = false;
  currentUser = user;
  el('cloudConflict').hidden = true;
  el('cloudRetry').hidden = true;
  el('cloudMigrate').hidden = true;
  el('cloudLogout').hidden = !user;
  el('cloudLogin').hidden = !!user;
  el('modalRoot').innerHTML = '';
  if (!user) {
    window.PECloud.active = false;
    journal.showLocal();
    el('cloudAccount').textContent = '게스트';
    clearNotice();
    message('이 기기에만 저장 중');
    lock(false);
    return;
  }
  window.PECloud.active = true;
  apply(null); lock(true);
  el('cloudAccount').textContent = user.email || '내 계정';
  message('내 일지 불러오는 중…');
  reference = sdk.doc(db, 'peJournals', user.uid);
  const userReference = reference;
  const sharing=createSharing({sdk,db,user,journal,isCurrent:()=>generation===epoch,
    canManage:()=>ready && engine && !engine.dirty && !engine.busy && !engine.conflict});
  draftKey = prefix + user.uid + ':' + tabId;
  try {
    const remote = await readRemote();
    if (generation !== epoch) return;
    let draft = null;
    try { draft = recoverDraft(user.uid); } catch { persistenceFailed = true; }
    engine = new JournalSync({
      apply, persist, report,
      write: async (payload, revision) => {
        if (new TextEncoder().encode(payload).length > 750000) throw Object.assign(new Error('too-large'), {code:'too-large'});
        return sdk.runTransaction(db, async transaction => {
          const snapshot = await transaction.get(userReference);
          if (generation !== epoch) throw new Error('account-changed');
          const actual = snapshot.exists() ? snapshot.data().revision : 0;
          if (actual !== revision) throw Object.assign(new Error('revision-conflict'), {code:'revision-conflict'});
          await sharing.sync(transaction,payload,revision+1);
          transaction.set(userReference, {payload, revision:revision+1, updatedAt:sdk.serverTimestamp()});
          return {revision:revision+1};
        });
      }
    });
    ready = true;
    clearNotice();
    engine.start(remote, draft);
    sharing.refresh();
    let legacy = null;
    try { legacy = localStorage.getItem(journal.localKey); } catch {}
    el('cloudMigrate').hidden = !legacy;
    unsubscribe = sdk.onSnapshot(userReference, {includeMetadataChanges:true}, snapshot => {
      if (generation !== epoch || snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return;
      if (!snapshot.exists()) return;
      const incoming = snapshot.data();
      // Repainting a focused form would discard an in-progress keystroke or dialog.
      if (!engine.dirty && !engine.busy && (document.querySelector('main').contains(document.activeElement) || el('modalRoot').children.length)) {
        deferred = incoming;
        message('다른 기기에서 변경됨 · 입력을 마치면 반영');
      } else engine.receive(incoming);
    }, error => {
      if (generation === epoch) report('error', error);
    });
    if (engine.dirty && !engine.conflict) schedule();
  } catch (error) {
    if (generation !== epoch) return;
    message('온라인 일지를 불러오지 못했습니다', true);
    notice(errorText(error));
    el('cloudRetry').hidden = false;
    lock(true);
  }
}

el('cloudBackup').onclick = () => { journal.backup(); backedUp = true; };
el('cloudReload').onclick = async () => {
  if (!backedUp && !confirm('현재 입력을 백업하지 않았습니다. 온라인 내용으로 바꾸기 전에 백업 파일을 다운로드할까요?')) return;
  if (!backedUp) { journal.backup(); backedUp = true; }
  try {
    const generation = epoch, remote = await readRemote();
    if (generation !== epoch) return;
    engine.useRemote(remote);
  } catch (error) { notice(errorText(error)); }
};
el('cloudRetry').onclick = () => ready ? engine?.flush() : currentUser && openUser(currentUser);
el('cloudMigrate').onclick = () => {
  if (!ready || engine.busy || engine.conflict) return;
  if (!confirm('이 브라우저에서 쓰던 기존 일지를 현재 계정으로 복사합니다. 현재 계정의 일지는 백업한 뒤 교체합니다. 계속할까요?')) return;
  try {
    const legacy = localStorage.getItem(journal.localKey);
    if (!legacy) return;
    JSON.parse(legacy);
    journal.backup();
    apply(legacy); save(journal.get());
    // The guest copy stays intact so migration can always be undone locally.
  } catch { notice('기존 자료를 읽지 못했습니다. 설정의 백업 불러오기를 사용해 주세요.'); }
};
el('cloudLogout').onclick = async () => {
  if (engine?.busy) { notice('온라인 저장을 마친 후 로그아웃해 주세요.'); return; }
  if (engine?.dirty) { notice('아직 온라인에 저장되지 않은 입력이 있습니다. 동기화를 완료하거나 현재 입력을 백업하고 온라인 일지를 불러온 뒤 로그아웃해 주세요.'); el('cloudConflict').hidden = false; return; }
  try { await sdk.signOut(auth); } catch (error) { notice(errorText(error)); }
};
window.addEventListener('online', () => {
  if (ready) engine?.flush();
  else if (currentUser) openUser(currentUser);
});
window.addEventListener('offline', () => { if (currentUser) { message('오프라인 · 이 기기에 임시 저장'); notice('오프라인입니다. 연결되면 다시 저장합니다.'); } });
window.addEventListener('beforeunload', event => {
  if (engine?.dirty || engine?.busy) { event.preventDefault(); event.returnValue = ''; }
});
setInterval(() => {
  if (deferred && !document.querySelector('main').contains(document.activeElement) && !el('modalRoot').children.length) {
    const remote = deferred; deferred = null; engine?.receive(remote);
  }
  if (ready && engine?.dirty && !engine.conflict && navigator.onLine) engine.flush();
}, 15000);
document.addEventListener('focusout', () => setTimeout(() => {
  if (deferred && !el('modalRoot').children.length) {
    const remote = deferred; deferred = null; engine?.receive(remote);
  }
}, 0));

async function boot() {
  if (!config?.apiKey || !config?.authDomain || !config?.projectId || !config?.appId) {
    notice('온라인 저장 연결 전입니다. 관리자가 Firebase 설정을 완료하면 Google 로그인을 사용할 수 있습니다. 지금 작성하는 내용은 이 브라우저에 저장됩니다.');
    return;
  }
  journal.flushLocal();
  window.PECloud.active = true;
  lock(true);
  message('로그인 상태 확인 중…');
  try {
    const version = '12.19.0';
    const modules = await timeout(Promise.all([
      import(`https://www.gstatic.com/firebasejs/${version}/firebase-app.js`),
      import(`https://www.gstatic.com/firebasejs/${version}/firebase-auth.js`),
      import(`https://www.gstatic.com/firebasejs/${version}/firebase-firestore.js`)
    ]));
    sdk = Object.assign({}, ...modules);
    const app = sdk.initializeApp(config);
    auth = sdk.getAuth(app);
    // Session persistence avoids reopening a teacher's account after the browser closes.
    await sdk.setPersistence(auth, sdk.browserSessionPersistence);
    db = sdk.getFirestore(app);
    el('cloudLogin').disabled = false;
    el('cloudLogin').onclick = async () => {
      journal.flushLocal();
      const provider = new sdk.GoogleAuthProvider();
      provider.setCustomParameters({prompt:'select_account'});
      el('cloudLogin').disabled = true;
      try { await sdk.signInWithPopup(auth, provider); }
      catch (error) { notice(errorText(error)); }
      finally { el('cloudLogin').disabled = false; }
    };
    let first = true;
    sdk.onAuthStateChanged(auth, user => {
      if (first || user?.uid !== currentUser?.uid) { first = false; openUser(user); }
    });
  } catch (error) {
    window.PECloud.active = false;
    lock(false);
    message('이 기기에만 저장 중');
    notice('로그인 연결에 실패했습니다. 인터넷 연결과 Firebase 설정을 확인한 후 페이지를 새로고침해 주세요. 기존 일지는 이 브라우저에서 계속 쓸 수 있습니다.');
  }
}
boot();
