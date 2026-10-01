const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const parse=s=>new Date(s+'T12:00:00');
const iso=d=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
const add=(d,n)=>{const x=new Date(d);x.setDate(x.getDate()+n);return x;};
const monday=d=>add(d,-((d.getDay()+6)%7));
const md=d=>(d.getMonth()+1)+'.'+d.getDate();
let data=null,mode=window.matchMedia('(max-width:799px)').matches?'week':'year',term=0,week=monday(new Date()),request=0;
const token=location.hash.slice(1);
function lessonHTML(L){
  const color=/^#[0-9a-f]{6}$/i.test(L.color)?L.color:'#8a94a4';
  return '<div class="lesson'+(L.status!=='ok'?' off':'')+'" style="--place:'+color+'"><b>'+esc(L.cls)+'</b>'+
    '<small>'+esc(L.period)+'교시 · '+esc(L.place)+(L.ordinal?' · '+esc(L.ordinal)+'차시 · 수업 '+esc(L.number)+'번':'')+'</small>'+
    (L.status==='ok'?'<div class="activity">'+esc(L.content)+'</div>':'<small>수업 없음</small>')+'</div>';
}
function dayHTML(date,period){
  const cls=$('classFilter').value;
  const event=data.days.find(d=>d.date===date);
  return (event && !period?'<div class="event">'+esc(event.label)+'</div>':'')+
    data.lessons.filter(L=>L.date===date && (!cls||L.cls===cls) && (!period||L.period===period)).map(lessonHTML).join('');
}
function render(){
  if(!data)return;
  $('yearTab').setAttribute('aria-pressed',String(mode==='year'));$('weekTab').setAttribute('aria-pressed',String(mode==='week'));
  $('terms').hidden=mode!=='year';$('weekNav').hidden=mode!=='week';
  document.querySelectorAll('[data-term]').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.term)===term)));
  let html='';
  if(mode==='year'){
    const range=data.terms[term];
    $('range').textContent=range?.start&&range?.end?range.start+' ~ '+range.end:'기간 미설정';
    if(!range?.start||!range?.end){$('content').innerHTML='<p class="empty">아직 이 학기의 수업 기간이 설정되지 않았습니다.</p>';return;}
    const mobile=window.matchMedia('(max-width:799px)').matches;
    html=mobile?'<div class="yearcards">':'<table class="yeargrid"><thead><tr><th>기간</th>'+['월','화','수','목','금'].map(x=>'<th>'+x+'</th>').join('')+'</tr></thead><tbody>';
    const end=parse(range.end);
    for(let w=monday(parse(range.start));w<=end;w=add(w,7)){
      if(mobile){
        let days='';
        for(let d=0;d<5;d++){
          const day=add(w,d),date=iso(day),outside=date<range.start||date>range.end;
          if(outside)continue;
          const lessons=dayHTML(date);
          days+='<section class="daycard"><h2>'+md(day)+' ('+['월','화','수','목','금'][d]+')</h2>'+(
            data.days.find(e=>e.date===date)?.label?'<div class="event">'+esc(data.days.find(e=>e.date===date).label)+'</div>':'')+
            (lessons||'<span class="date">수업 없음</span>')+'</section>';
        }
        html+='<details class="yearweek"'+(iso(w)<=iso(new Date())&&iso(add(w,4))>=iso(new Date())?' open':'')+'><summary><span>'+md(w)+'–'+md(add(w,4))+'</span><span>주간 보기　⌄</span></summary><div class="yearweek-body">'+(days||'<p class="empty">수업 기간이 없습니다.</p>')+'</div></details>';
        continue;
      }
      html+='<tr><th>'+md(w)+'–'+md(add(w,4))+'</th>';
      for(let d=0;d<5;d++){
        const day=add(w,d),date=iso(day),outside=date<range.start||date>range.end;
        html+='<td'+(outside?' class="outside"':'')+'>'+(outside?'':'<div class="date">'+md(day)+'</div>'+dayHTML(date))+'</td>';
      }html+='</tr>';
    }html+=mobile?'</div>':'</tbody></table>';
  }else{
    const dates=Array.from({length:5},(_,i)=>iso(add(week,i)));
    $('range').textContent=dates[0]+' ~ '+dates[4];
    html='<table class="weekgrid"><thead><tr><th>교시</th>'+dates.map((d,i)=>'<th>'+['월','화','수','목','금'][i]+' '+md(parse(d))+
      '<div class="event">'+esc(data.days.find(e=>e.date===d)?.label||'')+'</div></th>').join('')+'</tr></thead><tbody>';
    for(let p=1;p<=data.periods;p++)html+='<tr><th>'+p+'교시</th>'+dates.map(d=>'<td>'+dayHTML(d,p)+'</td>').join('')+'</tr>';
    html+='</tbody></table><div class="weekcards">'+dates.map((d,i)=>'<section class="daycard"><h2>'+md(parse(d))+' ('+['월','화','수','목','금'][i]+')</h2>'+(dayHTML(d)||'수업 없음')+'</section>').join('')+'</div>';
  }
  $('content').innerHTML=html;
}
function clear(text){data=null;$('schedule').hidden=true;$('content').replaceChildren();$('classFilter').innerHTML='<option value="">전체 학급</option>';$('status').textContent=text;}
async function refresh(){
  const current=++request;
  if(!/^[a-f0-9]{64}$/.test(token)){clear('공유 링크가 올바르지 않습니다. 선생님께 링크를 다시 받아 주세요.');return;}
  try{
    const project=window.PE_FIREBASE_CONFIG?.projectId;
    const response=await fetch('https://firestore.googleapis.com/v1/projects/'+encodeURIComponent(project)+'/databases/(default)/documents/peShares/'+token,{cache:'no-store',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(15000)});
    if(current!==request)return;
    if(response.status===404||response.status===403){clear('공유가 중지되었거나 사용할 수 없는 링크입니다.');return;}
    if(!response.ok)throw Error('fetch-failed');
    const doc=await response.json();if(current!==request)return;
    const incoming=JSON.parse(doc.fields.payload.stringValue);
    if(incoming.version!==1||!Array.isArray(incoming.lessons))throw Error('invalid-data');
    const first=!data,selected=$('classFilter').value;data=incoming;
    $('classFilter').innerHTML='<option value="">전체 학급</option>'+data.classes.map(c=>'<option value="'+esc(c)+'">'+esc(c)+'</option>').join('');
    if(data.classes.includes(selected))$('classFilter').value=selected;
    if(first){
      const today=iso(new Date());term=data.terms.findIndex(t=>t.start&&today>=t.start&&today<=t.end);if(term<0)term=0;
      if(!data.terms.some(t=>t.start&&today>=t.start&&today<=t.end)&&data.terms[term]?.start)week=monday(parse(data.terms[term].start));
    }
    $('schedule').hidden=false;$('status').textContent='열람 전용 · 30초마다 최신 내용을 확인합니다.';render();
  }catch{if(current===request)clear('시간표를 불러오지 못했습니다. 인터넷 연결을 확인하고 새로고침해 주세요.');}
}
$('yearTab').onclick=()=>{mode='year';render();};$('weekTab').onclick=()=>{mode='week';render();};
$('classFilter').onchange=render;
$('terms').onclick=e=>{const b=e.target.closest('[data-term]');if(b){term=Number(b.dataset.term);render();}};
$('prev').onclick=()=>{week=add(week,-7);render();};$('next').onclick=()=>{week=add(week,7);render();};$('today').onclick=()=>{week=monday(new Date());render();};
$('refresh').onclick=refresh;
window.matchMedia('(max-width:799px)').addEventListener('change',()=>{if(data)render();});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
window.addEventListener('hashchange',()=>location.reload());
setInterval(()=>{if(!document.hidden)refresh();},30000);
refresh();
