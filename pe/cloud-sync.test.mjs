import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JournalSync} from './cloud-sync.mjs';

function setup(write = async (_, revision) => ({revision:revision+1})) {
  const events = [], applied = [], drafts = [];
  const sync = new JournalSync({write, report:kind=>events.push(kind), apply:p=>applied.push(p), persist:d=>drafts.push({...d})});
  return {sync, events, applied, drafts};
}
test('new account starts empty, without importing another local journal', () => {
  const {sync,applied} = setup(); sync.start(null,null);
  assert.equal(applied.at(-1), null); assert.equal(sync.dirty,false);
});
test('offline failure retains draft and retries the same revision', async () => {
  let online = false;
  const {sync,drafts} = setup(async (_,revision) => {if(!online) throw new Error('offline'); return {revision:revision+1};});
  sync.start({revision:2,payload:'old'},null); sync.edit('new'); await sync.flush();
  assert.equal(sync.dirty,true); assert.equal(sync.revision,2); assert.equal(drafts.at(-1).payload,'new');
  online=true; await sync.flush(); assert.equal(sync.dirty,false); assert.equal(sync.revision,3);
});
test('edits made while a save is in flight stay pending', async () => {
  let finish;
  const {sync} = setup(() => new Promise(resolve=>{finish=resolve;}));
  sync.start(null,null); sync.edit('one'); const saving=sync.flush(); sync.edit('two'); finish({revision:1}); await saving;
  assert.equal(sync.payload,'two'); assert.equal(sync.dirty,true); assert.equal(sync.revision,1);
});
test('two devices cannot silently overwrite one another', async () => {
  let remote={revision:1,payload:'original'};
  const writer=async (payload,revision)=>{
    if(remote.revision!==revision) throw Object.assign(new Error('conflict'),{code:'revision-conflict'});
    remote={payload,revision:revision+1}; return remote;
  };
  const a=setup(writer).sync, b=setup(writer).sync;
  a.start(remote,null); b.start(remote,null); a.edit('A'); b.edit('B'); await a.flush(); await b.flush();
  assert.equal(remote.payload,'A'); assert.equal(b.payload,'B'); assert.equal(b.conflict,true);
  b.useRemote(remote); assert.equal(b.payload,'A'); assert.equal(b.dirty,false);
});
test('remote update with pending edits requires conflict resolution', () => {
  const {sync,applied}=setup(); sync.start({revision:1,payload:'a'},null); sync.edit('mine'); sync.receive({revision:2,payload:'theirs'});
  assert.equal(sync.conflict,true); assert.equal(sync.payload,'mine'); assert.equal(applied.at(-1),'a');
});
test('clean device receives newer journal automatically', () => {
  const {sync,applied}=setup(); sync.start({revision:1,payload:'a'},null); sync.receive({revision:2,payload:'b'});
  assert.equal(applied.at(-1),'b'); assert.equal(sync.revision,2);
});
test('draft recovery detects changes made on another device', () => {
  const {sync}=setup(); sync.start({revision:3,payload:'cloud'},{revision:1,payload:'draft',dirty:true});
  assert.equal(sync.conflict,true); assert.equal(sync.payload,'draft');
});
test('recovery recognizes a commit completed before the tab closed', () => {
  const {sync}=setup(); sync.start({revision:3,payload:'same'},{revision:2,payload:'same',dirty:true});
  assert.equal(sync.dirty,false); assert.equal(sync.revision,3);
});
test('late write result after logout cannot update the next account', async () => {
  let finish; const {sync,events}=setup(()=>new Promise(resolve=>{finish=resolve;}));
  sync.start(null,null); sync.edit('private'); const saving=sync.flush(); sync.close(); const count=events.length;
  finish({revision:1}); await saving; assert.equal(events.length,count);
});
test('snapshot arriving during own transaction does not cause a false conflict', async () => {
  let finish; const {sync}=setup(()=>new Promise(resolve=>{finish=resolve;}));
  sync.start(null,null); sync.edit('first'); const saving=sync.flush(); sync.edit('second');
  sync.receive({revision:1,payload:'first'}); finish({revision:1}); await saving;
  assert.equal(sync.conflict,false); assert.equal(sync.dirty,true); assert.equal(sync.payload,'second');
});
