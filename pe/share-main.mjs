const token=new URLSearchParams(location.search).get('share')||'';
const valid=/^[a-f0-9]{64}$/.test(token);
const message=text=>{
  const panel=document.getElementById('cloudPanel');
  document.getElementById('cloudStatus').textContent=text;
  document.getElementById('cloudHelp').hidden=true;
  panel.hidden=false;
};
let locked=false;
const readonly=()=>{
  if(locked)return; locked=true;
  document.title='체육 연간 시간표 · 열람 전용';
  document.querySelector('.topbar').insertAdjacentHTML('beforeend','<span class="muted" id="shareReadOnly">열람 전용</span>');
  document.getElementById('cloudLogin').hidden=true;
  document.getElementById('cloudLogout').hidden=true;
  document.querySelectorAll('#tabs button').forEach(b=>{if(b.dataset.view!=='year'&&b.dataset.view!=='week')b.hidden=true;});
  /* 연간·주간 탭, 학기 전환, 주 이동만 허용하고 나머지 클릭(칸 편집 등)은 막는다. */
  const allowed='#tabs [data-view="year"], #tabs [data-view="week"], #yearTerms [data-term], #wPrev, #wNext, #wToday, #mobileYearList summary';
  for(const type of ['click','dblclick'])
    document.addEventListener(type,event=>{
      if(type==='click'&&event.target.closest(allowed))return;
      event.stopImmediatePropagation(); event.preventDefault();
    },true);
  new MutationObserver(()=>lockInputs())
    .observe(document.querySelector('main'),{childList:true,subtree:true});
};
function lockInputs(){
  document.querySelectorAll('#view-year button:not([data-term]), #view-year input, #view-year select:not(#yOrd), #progWrap input')
    .forEach(el=>{if(!el.disabled)el.disabled=true;});
}
function legacyState(data){
  const state=JSON.parse(window.PEJournal.empty());
  const terms=data.terms||[];
  Object.assign(state,{start:terms[0]?.start||'',end:terms[0]?.end||'',periods:Number(data.periods)||state.periods,
    semester2:{start:terms[1]?.start||'',end:terms[1]?.end||'',base:{}}});
  const places=[], placeId=new Map();
  for(const lesson of data.lessons||[]){
    const name=String(lesson.place||'체육관');
    if(!placeId.has(name)){const id='sharep'+(places.length+1);placeId.set(name,id);places.push({id,name,color:lesson.color||'#8a94a4'});}
  }
  if(places.length)state.places=places;
  state.classes=(data.classes||[]).map(name=>({name,plan:0,capOn:false,from:'',to:''}));
  state.days=Object.fromEntries((data.days||[]).map(d=>[d.date,{label:String(d.label||''),off:!!d.off}]));
  state.extras=(data.lessons||[]).map((lesson,index)=>{
    const id='share-'+index;
    state.rec[id]={prog:lesson.content||'',lessonNumber:Number(lesson.number)||undefined};
    return {id,date:lesson.date,period:Number(lesson.period),cls:lesson.cls,place:placeId.get(String(lesson.place||'체육관'))||''};
  });
  return state;
}
let lastPayload='',busy=false;
async function load(){
  if(!valid){message('공유 링크가 올바르지 않습니다. 링크를 다시 받아 주세요.');return;}
  if(busy)return; busy=true;
  try{
    const project=window.PE_FIREBASE_CONFIG?.projectId;
    const response=await fetch('https://firestore.googleapis.com/v1/projects/'+encodeURIComponent(project)+'/databases/(default)/documents/peShares/'+token,{cache:'no-store',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(15000)});
    if(response.status===404||response.status===403){
      lastPayload='';window.PEJournal.replace(null);
      document.documentElement.classList.add('share-loading');
      message('공유가 중지되었거나 사용할 수 없는 링크입니다.');return;
    }
    if(!response.ok)throw Error('fetch');
    const payload=(await response.json()).fields.payload.stringValue;
    if(payload!==lastPayload){
      const incoming=JSON.parse(payload);
      const shared=incoming.version===2&&incoming.state ? incoming.state
        : incoming.version===1&&Array.isArray(incoming.lessons) ? legacyState(incoming) : null;
      if(!shared)throw Error('invalid-share');
      /* 다시 그려도 보고 있던 학기와 스크롤 위치는 그대로 둔다. */
      const term=document.querySelector('#yearTerms [aria-pressed="true"]')?.dataset.term;
      const y=window.scrollY;
      window.PEJournal.replace(JSON.stringify(shared));
      lastPayload=payload;
      readonly(); lockInputs();
      if(term&&!document.documentElement.classList.contains('share-loading'))
        document.querySelector('#yearTerms [data-term="'+term+'"]')?.click();
      window.scrollTo(0,y);
    }
    document.documentElement.classList.remove('share-loading');
    document.getElementById('cloudPanel').hidden=true;
  }catch{
    /* 이미 보고 있는 시간표가 있으면 조용히 다음 확인을 기다린다. */
    if(!lastPayload)message('시간표를 불러오지 못했습니다. 잠시 후 새로고침해 주세요.');
  }finally{busy=false;}
}
load();
setInterval(()=>{if(!document.hidden)load();},30000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)load();});
