const token=new URLSearchParams(location.search).get('share')||'';
const valid=/^[a-f0-9]{64}$/.test(token);
const message=text=>{
  const panel=document.getElementById('cloudPanel');
  document.getElementById('cloudStatus').textContent=text;
  document.getElementById('cloudHelp').hidden=true;
  panel.hidden=false;
};
const readonly=()=>{
  document.title='체육 연간 시간표 · 열람 전용';
  document.querySelector('.topbar').insertAdjacentHTML('beforeend','<span class="muted" id="shareReadOnly">열람 전용</span>');
  document.getElementById('cloudLogin').hidden=true;
  document.getElementById('cloudLogout').hidden=true;
  document.getElementById('cloudPanel').hidden=false;
  message('열람 전용 · 원본 연간 시간표와 학급별 차시를 볼 수 있습니다.');
  document.querySelectorAll('#tabs button').forEach(b=>{if(b.dataset.view!=='year')b.hidden=true;});
  document.querySelectorAll('#view-year button:not([data-term]), #view-year input').forEach(el=>el.disabled=true);
  document.addEventListener('click',event=>{
    if(event.target.closest('#yearTerms [data-term]'))return;
    event.stopImmediatePropagation(); event.preventDefault();
  },true);
  new MutationObserver(()=>document.querySelectorAll('#progWrap input').forEach(el=>el.disabled=true))
    .observe(document.getElementById('progWrap'),{childList:true,subtree:true});
};
async function load(){
  if(!valid){message('공유 링크가 올바르지 않습니다. 링크를 다시 받아 주세요.');return;}
  try{
    const project=window.PE_FIREBASE_CONFIG?.projectId;
    const response=await fetch('https://firestore.googleapis.com/v1/projects/'+encodeURIComponent(project)+'/databases/(default)/documents/peShares/'+token,{cache:'no-store',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(15000)});
    if(response.status===404||response.status===403){message('공유가 중지되었거나 사용할 수 없는 링크입니다.');return;}
    if(!response.ok)throw Error('fetch');
    const incoming=JSON.parse((await response.json()).fields.payload.stringValue);
    if(incoming.version!==2||!incoming.state)throw Error('old-share');
    window.PEJournal.replace(JSON.stringify(incoming.state));
    readonly();
  }catch{message('시간표를 불러오지 못했습니다. 잠시 후 새로고침해 주세요.');}
}
load();
