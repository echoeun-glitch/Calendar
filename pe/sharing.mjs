const el=id=>document.getElementById(id);
const validToken=token=>typeof token==='string' && /^[a-f0-9]{64}$/.test(token);

export function resetSharing(){
  el('shareCreate').disabled=true;el('shareCreate').hidden=false;
  for(const id of ['shareUrl','shareCopy','shareOpen','shareRevoke']) el(id).hidden=true;
  el('shareUrl').value='';el('shareOpen').removeAttribute('href');
  el('shareStatus').textContent='로그인 후 공유 링크를 만들 수 있습니다.';
}

export function createSharing({sdk,db,user,journal,isCurrent,canManage}){
  const owner=sdk.doc(db,'peShareOwners',user.uid);
  let token=null,busy=false;
  const message=text=>{if(isCurrent())el('shareStatus').textContent=text;};
  const paint=()=>{
    if(!isCurrent())return;
    el('shareCreate').hidden=!!token;el('shareCreate').disabled=busy;
    for(const id of ['shareUrl','shareCopy','shareOpen','shareRevoke'])el(id).hidden=!token;
    el('shareRevoke').disabled=busy;
    const url=new URL('share.html',location.href);url.hash=token||'';
    el('shareUrl').value=token?url.href:'';
    if(token)el('shareOpen').href=url.href;else el('shareOpen').removeAttribute('href');
  };
  const assertCurrent=()=>{if(!isCurrent())throw Error('account-changed');};
  const shareData=(payload,revision)=>{
    const published=JSON.stringify(journal.shareSnapshot(payload));
    if(new TextEncoder().encode(published).length>750000)throw Error('share-too-large');
    return {ownerId:user.uid,payload:published,revision,updatedAt:sdk.serverTimestamp()};
  };
  const manage=async action=>{
    if(!isCurrent()||busy)return;
    if(!canManage()){message('온라인 저장 완료 후 다시 눌러 주세요.');return;}
    busy=true;paint();
    try{await action();}
    catch{message('공유 설정에 실패했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.');}
    finally{busy=false;paint();}
  };
  el('shareCreate').onclick=()=>manage(async()=>{
    const fresh=crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');
    const result=await sdk.runTransaction(db,async tx=>{
      const existing=await tx.get(owner);
      const source=await tx.get(sdk.doc(db,'peJournals',user.uid));
      assertCurrent();
      if(!source.exists())throw Error('journal-not-saved');
      const selected=validToken(existing.data()?.token)?existing.data().token:fresh;
      tx.set(owner,{token:selected});
      tx.set(sdk.doc(db,'peShares',selected),shareData(source.data().payload,source.data().revision));
      return selected;
    });
    assertCurrent();token=result;message('공유 중 · 링크를 가진 사람은 연간·주간을 볼 수 있습니다. 저장한 변경도 자동 반영됩니다.');
  });
  el('shareRevoke').onclick=()=>manage(async()=>{
    await sdk.runTransaction(db,async tx=>{
      const existing=await tx.get(owner);assertCurrent();
      if(validToken(existing.data()?.token))tx.delete(sdk.doc(db,'peShares',existing.data().token));
      tx.delete(owner);
    });
    assertCurrent();token=null;message('공유를 중지했습니다. 이전 링크로는 더 이상 불러올 수 없습니다.');
  });
  el('shareCopy').onclick=async()=>{
    if(!isCurrent()||!token)return;
    try{await navigator.clipboard.writeText(el('shareUrl').value);message('공유 링크를 복사했습니다.');}
    catch{el('shareUrl').select();message('링크를 선택했습니다. 복사해서 전달해 주세요.');}
  };
  return {
    async refresh(){
      try{
        const snapshot=await sdk.getDocFromServer(owner);assertCurrent();
        token=validToken(snapshot.data()?.token)?snapshot.data().token:null;paint();
        /* 이전 축약 공유 문서를, 로그인할 때 현재 원본 연간표용 문서로 한 번 갱신한다. */
        if(token && canManage()){
          await sdk.runTransaction(db,async tx=>{
            const source=await tx.get(sdk.doc(db,'peJournals',user.uid));assertCurrent();
            if(source.exists())tx.set(sdk.doc(db,'peShares',token),shareData(source.data().payload,source.data().revision));
          });
        }
        message(token?'공유 중 · 저장한 변경이 자동 반영됩니다.':'연간·주간만 공개하는 링크를 만들 수 있습니다.');
      }catch{message('공유 상태를 불러오지 못했습니다. 다시 로그인해 주세요.');}
    },
    async sync(tx,payload,revision){
      const snapshot=await tx.get(owner);assertCurrent();
      const selected=snapshot.data()?.token;
      if(validToken(selected))tx.set(sdk.doc(db,'peShares',selected),shareData(payload,revision));
    }
  };
}
