const US='52111A';
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const ls=(k,v)=>{try{if(v===undefined)return localStorage.getItem(k)||'';localStorage.setItem(k,v)}catch(e){return''}};
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,6);
const norm=s=>String(s||'').trim().toUpperCase().replace(/\s+/g,'');
const NAMES=['Charlie','Oscar','Aidin','Seb','J-Pup'];
const slug=x=>String(x||'').toLowerCase().replace(/[^a-z0-9]/g,'');
const C={};let S={events:[],teams:[],matches:[],notes:[],live:[]};
let ev=ls('ev'),tab=ls('tab')||'event',name=ls('name'),mTeam=null,scMatch='',scTeam='',draft=null,open={},dirty=false,saveT;
const evObj=()=>S.events.find(e=>e.id===ev);
const teams=()=>S.teams.filter(t=>t.eventId===ev).sort((a,b)=>a.number.localeCompare(b.number,undefined,{numeric:true}));
const matches=()=>S.matches.filter(m=>m.eventId===ev).sort((a,b)=>(a.order||0)-(b.order||0));
const notes=(k,ref,sec)=>S.notes.filter(n=>n.eventId===ev&&n.kind===k&&(ref===undefined||n.ref===ref)&&(sec===undefined||n.sec===sec)).sort((a,b)=>b.ts-a.ts);
const tName=n=>{const t=teams().find(t=>t.number===n);return t?t.name:''};
const side=(m,n)=>{const us=m.red.includes(US)?'red':m.blue.includes(US)?'blue':null;if(!us)return'';if(!n)return us;const mine=m[us];return mine.includes(n)?'ally':(m.red.includes(n)||m.blue.includes(n))?'opp':''};
const cls=(m,n)=>{if(n===US)return'';const s=side(m,n);return s==='ally'?'gn':s==='opp'?'rd':''};

const NOTE_MS=1000,RE_MS=5000; // how often to check for teammates' notes / VEX Events (milliseconds)
const API='/api';let code=ls('code'),live=true,pollT,impT,lastV=-1,pend=0,loginErr=false;
const skuOf=e=>(e&&e.sku)||((e&&e.link||'').match(/RE-[A-Z0-9]+-\d+-\d+/)||[])[0]||'';
async function api(path,body){
  const r=await fetch(API+path,{method:body?'POST':'GET',headers:{'content-type':'application/json','x-code':code},body:body?JSON.stringify(body):undefined});
  if(r.status===401){code='';ls('code','');loginErr=true;render();throw new Error('Wrong code')}
  const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||('Error '+r.status));return j}
async function pull(){if(pend)return;try{const d=await api('/state');lastV=d.v;for(const k of['events','teams','matches','notes'])S[k]=d[k]||[];if(!ev&&S.events.length)ev=S.events[0].id;$('#sync').textContent='Synced '+new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});render()}catch(e){$('#sync').textContent='offline'}}
let polling=false,syncing=false;
async function poll(){if(polling||document.hidden)return;polling=true;try{const d=await api('/version');if(d.v!==lastV)pull()}catch(e){$('#sync').textContent='offline'}polling=false}
function syncRE(){const s=skuOf(evObj());if(!s||syncing||document.hidden)return;syncing=true;api('/import',{sku:s,light:true}).catch(()=>{}).finally(()=>{syncing=false})}
function schedule(){clearInterval(pollT);clearInterval(impT);if(live&&code){pollT=setInterval(poll,NOTE_MS);impT=setInterval(syncRE,RE_MS)}}
const send=b=>{pend++;return api('/doc',b).catch(e=>alert('Save failed: '+e.message)).finally(()=>{pend--})};
const put=(k,id,d)=>{S[k]=S[k].filter(x=>x.id!==id);S[k].push({id,...d});send({col:k,id,data:d,mode:'set'});setTimeout(render,0)};
const upd=(k,id,d)=>{S[k]=S[k].map(x=>x.id===id?{...x,...d}:x);send({col:k,id,data:d,mode:'update'});setTimeout(render,0)};
const del=(k,id)=>{S[k]=S[k].filter(x=>x.id!==id);send({col:k,id,mode:'delete'});setTimeout(render,0)};
const loginHTML=()=>`<div class="card"><h2>Team code</h2><p class="mut">Enter the team code to open Invictus scouting.</p><input id="codein" type="password" autocomplete="current-password" placeholder="Team code">${loginErr?'<p style="color:var(--rd)">That code didn’t work.</p>':''}<button data-act="login">Open</button></div>`;
async function init(){if(code){await pull();schedule();syncRE()}render()}

const SUN='<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/></svg>',MOON='<svg viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>';
function applyTheme(){const t=ls('theme')||'light';document.documentElement.dataset.theme=t;$('#theme').innerHTML=t==='dark'?SUN:MOON}
if(!NAMES.includes(name)){name='';ls('name','')}
let dragging=false;
function render(){
  if(dragging){dirty=true;return}
  if(!code){$('#nav').innerHTML='';$('#app').innerHTML=loginHTML();$('#evname').textContent='Team login';return}
  if(/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)){dirty=true;return}
  dirty=false;$('#evname').textContent=evObj()?evObj().name:'Choose an event to start';
  const tabs=[['event','<svg viewBox="0 0 24 24"><path d="M5 21V4M5 4h11l-2 4 2 4H5"/></svg>','Event'],['teams','<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.5 2.7-6 6-6s6 2.5 6 6"/><circle cx="17" cy="9" r="2.5"/><path d="M17 14c2.5 0 4 2 4 5"/></svg>','Teams'],['matches','<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12" rx="3"/><path d="M12 6v12M8 12h.01M16 12h.01"/></svg>','Matches'],['scout','<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l5 5"/></svg>','Scout'],['pick','<svg viewBox="0 0 24 24"><path d="M7 4h10v4a5 5 0 0 1-10 0zM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3M12 13v4M8 21h8M10 17h4"/></svg>','Picklist']];
  $('#nav').innerHTML=tabs.map(t=>`<button class="${tab===t[0]?'on':''}" data-act="tab" data-v="${t[0]}">${t[1]}<span>${t[2]}</span></button>`).join('');
  const y=scrollY;
  $('#app').innerHTML=({event:vEvent,teams:vTeams,matches:vMatches,scout:vScout,pick:vPick})[tab]();
  scrollTo(0,y);
  $('#mbody').innerHTML=mTeam?vTeam(mTeam):'';$('#modal').style.display=mTeam?'block':'none';
}
function noteBox(kind,ref,sec,ph){
  const id='n'+uid();
  return `<textarea id="${id}" placeholder="${esc(ph||'Write a note…')}"></textarea><button data-act="addnote" data-kind="${kind}" data-ref="${esc(ref||'')}" data-sec="${sec||''}" data-in="${id}">Add note</button>`+
  notes(kind,ref||'',sec||'').map(noteRow).join('');
}
const noteRow=n=>`<div class="note">${esc(n.text)}<small>${esc(n.by||'?')} · ${new Date(n.ts).toLocaleString([], {dateStyle:'short',timeStyle:'short'})} <button class="d" data-act="delnote" data-id="${n.id}">delete</button></small></div>`;

function vEvent(){
  const e=evObj();
  let h=`<div class="card"><h2>Import from VEX Events</h2><p class="mut">Pulls the event, teams and matches. Press it again any time to update.</p><input id="sku" value="${esc(skuOf(e)||'RE-V5RC-26-5068')}" placeholder="Event code e.g. RE-V5RC-26-5068"><button data-act="import">Import / update now</button> <span class="mut" id="impmsg"></span></div><div class="card"><h2>Who are you?</h2><p class="mut">Your name goes on your notes and scouting.</p>${NAMES.map(n=>`<button class="chip ${name===n?'me':''}" data-act="setname" data-v="${n}">${n}</button>`).join('')}</div>
  <div class="card"><h2>Event</h2>
  <select id="evsel"><option value="">— choose event —</option>${S.events.map(x=>`<option value="${x.id}" ${x.id===ev?'selected':''}>${esc(x.name)}</option>`).join('')}</select>
  <div class="row"><input id="newev" placeholder="New event name"><button data-act="addev">Add event</button></div></div>`;
  if(!e)return h+'<p class="mut">Create or pick an event to start.</p>';
  h+=`<div class="card"><h2>${esc(e.name)}</h2><h3>RobotEvents link</h3>
  <input data-f="link" data-keep="1" id="evlink" value="${esc(e.link||'')}" placeholder="Paste the VEX event link here">
  ${e.link?`<p><a href="${esc(e.link)}" target="_blank" rel="noopener"><button type="button">Open event page ↗</button></a></p>`:''}
  <button class="d" data-act="delev">Delete event</button></div>
  <div class="card"><h2>Alliance requests</h2><p class="mut">Teams that asked to ally with us & what they told us they’re good at.</p>
  <div class="row"><input id="rq_t" list="tl" placeholder="Team #"><input id="rq_x" placeholder="Their strengths"><button data-act="addreq">Add</button></div>
  ${notes('req').map(n=>`<div class="note"><b>${esc(n.ref)}</b> ${esc(tName(n.ref))} — ${esc(n.text)}<small>${esc(n.by||'')} <button class="d" data-act="delnote" data-id="${n.id}">delete</button></small></div>`).join('')}</div>
  <div class="card"><h2>Event notes</h2>${noteBox('event','','','Anything about this event…')}</div>`;
  return h+tlist();
}
const tlist=()=>`<datalist id="tl">${teams().map(t=>`<option value="${t.number}">${esc(t.name)}</option>`).join('')}</datalist>`;

function vTeams(){
  if(!evObj())return'<p class="mut">Pick an event first.</p>';
  return `<div class="card"><h2>Add team</h2><div class="row"><input id="t_n" placeholder="Number e.g. 52111A"><input id="t_name" placeholder="Team name"><input id="t_s" placeholder="School"><button data-act="addteam">Add</button></div></div>
  <input id="tsearch" placeholder="Search teams…" oninput="filt(this.value)">
  <div id="tl2">${teams().map(t=>`<div class="card ${t.number===US?'us':''}" data-q="${esc((t.number+t.name+t.school).toLowerCase())}"><div class="row" style="flex-wrap:nowrap"><div style="flex:1;cursor:pointer" data-act="team" data-t="${t.number}"><span class="num">${t.number}</span>${esc(t.name)}<div class="mut">${esc(t.school)} · ${notes('scout',t.number).length+notes('team',t.number).length} notes</div></div><button class="d" data-act="delteam" data-id="${t.id}">✕</button></div></div>`).join('')||'<p class="mut">No teams yet.</p>'}</div>`;
}
function filt(q){q=q.toLowerCase();document.querySelectorAll('#tl2 .card').forEach(c=>c.style.display=c.dataset.q.includes(q)?'':'none')}

const chips=(m,arr)=>arr.map(n=>`<button class="chip ${n===US?'me':cls(m,n)}" data-act="team" data-t="${n}">${n}</button>`).join('');
function vMatches(){
  if(!evObj())return'<p class="mut">Pick an event first.</p>';
  let h=`<div class="card"><h2>Add match</h2><div class="row"><input id="m_l" placeholder="Label e.g. Q12"><input id="m_o" type="number" inputmode="numeric" placeholder="Match number (for sorting)"></div>
  <h3>Red alliance</h3><div class="row"><input id="m_r1" list="tl" placeholder="Team"><input id="m_r2" list="tl" placeholder="Team"></div>
  <h3>Blue alliance</h3><div class="row"><input id="m_b1" list="tl" placeholder="Team"><input id="m_b2" list="tl" placeholder="Team"></div>
  <p><button data-act="addmatch">Add match</button></p>${tlist()}</div>`;
  return h+matches().filter(m=>side(m)).map(m=>{const s=side(m);const o=open[m.id];
  return `<div class="card ${s?'us':''}"><div class="row" style="flex-wrap:nowrap;cursor:pointer" data-act="mopen" data-id="${m.id}"><span class="num" style="flex:1">${esc(m.label)} ${m.rs!=null&&(m.rs||m.bs)?`<span class="mut" style="font:600 14px Figtree">${m.rs}–${m.bs}</span>`:''}</span>${s?`<span class="tag ${s==='red'?'rd':'gn'}" style="background:${s==='red'?'var(--rd)':'var(--ac)'}">We’re ${s}</span>`:''}<span>${o?'▲':'▼'}</span></div>
  <div class="vs"><div class="side r"><span>Red alliance</span>${chips(m,m.red)}</div><div class="side b"><span>Blue alliance</span>${chips(m,m.blue)}</div></div>
  ${o?`<h3>Strategy</h3>${noteBox('match',m.id,'strat','Our strategy for this match…')}<h3>Our alliance</h3>${noteBox('match',m.id,'ally','What our partner said / their plan…')}<h3>Opposition</h3>${noteBox('match',m.id,'opp','Weaknesses, tendencies…')}<button class="d" data-act="clearmatch" data-id="${m.id}">Clear all notes for this match</button> <button class="d" data-act="delmatch" data-id="${m.id}">Delete match</button>`:''}</div>`}).join('')||'<p class="mut">No matches with us yet.</p>';
}

const R=(f,v)=>`<div class="rate">${[1,2,3,4,5].map(i=>`<button data-act="rate" data-f="${f}" data-v="${i}" class="${v===i?'on':''}">${i}</button>`).join('')}</div>`;
function vScout(){
  if(!evObj())return'<p class="mut">Pick an event first.</p>';
  if(!name)return `<div class="card"><h2>Who’s scouting?</h2><p class="mut">Pick your name. You can scout each team once, and you can come back to edit it.</p>${NAMES.map(n=>`<button class="chip" data-act="setname" data-v="${n}">${n}</button>`).join('')}</div>`;
  const ms=matches();let h='';
  const rel=n=>{const a=[],o=[];ms.forEach(x=>{const s=side(x,n);if(n===US||!s)return;(s==='ally'?a:o).push(x.label.replace(/^Mock /,''))});return{a,o}};
  h+=`<div class="card"><h2>Pick a team to scout</h2><p class="mut">Scouting as <b>${esc(name)}</b> <button class="d" data-act="setname" data-v="">change</button></p><p class="mut">Green = we play with them · Red = we play against them · Half and half = both</p>${teams().filter(t=>t.number!==US).map(t=>{const r=rel(t.number);const c=t.number===US?'me':r.a.length&&!r.o.length?'gn':r.o.length&&!r.a.length?'rd':r.a.length&&r.o.length?'both':'';return `<div class="trow ${scTeam===t.number?'sel':''}" data-act="startscout" data-t="${t.number}"><span class="chip ${c}">${t.number}</span><div style="flex:1"><div>${esc(t.name)}</div>${S.notes.some(n=>n.id==='s_'+ev+'_'+t.number+'_'+slug(name))?'<div class="lab" style="color:var(--ac)">✓ You’ve scouted this</div>':''}${t.number===US?'<span class="mut">That’s us</span>':`${r.a.length?`<div class="lab g">With us: ${r.a.join(', ')}</div>`:''}${r.o.length?`<div class="lab r">Against us: ${r.o.join(', ')}</div>`:''}${!r.a.length&&!r.o.length?'<span class="mut">Not in a match with us</span>':''}`}</div></div>`}).join('')||'<span class="mut">Add teams first.</span>'}</div>`;
  if(scTeam&&draft){const d=draft;
  h='<p><button class="g" data-act="donescout">‹ Back to teams</button></p>';
  h+=`<div class="card" style="border:2px solid var(--ac)"><h2><span class="num">${scTeam}</span> ${esc(tName(scTeam))}</h2>
  <div class="rem">Remember to note: autonomous points & consistency · driver skill & consistency · robot type & design · speed · scoring · consistency · durability · overall.</div>
  <h3>Autonomous</h3><input data-f="autoPts" data-keep="1" value="${esc(d.autoPts)}" placeholder="Auto points they score"><div class="mut">Auto consistency</div>${R('autoCons',d.autoCons)}<textarea data-f="autoNotes" data-keep="1" placeholder="What does their auto do?">${esc(d.autoNotes)}</textarea>
  <h3>Driver</h3><div class="mut">Driver skill</div>${R('driver',d.driver)}<div class="mut">Driver consistency</div>${R('driverCons',d.driverCons)}<textarea data-f="driveNotes" data-keep="1" placeholder="Driving notes (how they drive, strategy, mistakes, how well they play defence, etc.)">${esc(d.driveNotes)}</textarea>
  <h3>Robot</h3><input data-f="robotType" data-keep="1" value="${esc(d.robotType)}" placeholder="Robot type & design (drivetrain, intake, scorer…)">
  <div class="mut">Speed</div>${R('speed',d.speed)}<div class="mut">Durability</div>${R('durability',d.durability)}
  <h3>Scoring</h3><div class="mut">Scoring ability</div>${R('scoring',d.scoring)}<div class="mut">Can they score reliably?</div>
  <select data-f="reliable"><option value="">—</option>${['Yes, reliable','Sometimes','No, bad at scoring'].map(o=>`<option ${d.reliable===o?'selected':''}>${o}</option>`).join('')}</select>
  <div class="mut">Scoring consistency</div>${R('scoreCons',d.scoreCons)}
  <h3>Toggle</h3><div class="mut">How well can they hold a toggle?</div>
  <select data-f="toggle"><option value="">—</option>${['Very well','Well','Decent','Not well','Not at all'].map(o=>`<option ${d.toggle===o?'selected':''}>${o}</option>`).join('')}</select>
  <div class="mut">How good is their toggle mechanism?</div>${R('toggleQ',d.toggleQ)}
  <h3>Overall</h3><div class="mut">Overall rating</div>${R('overall',d.overall)}
  <select data-f="good"><option value="">Are they good?</option>${['Yes','Decent','No'].map(o=>`<option ${d.good===o?'selected':''}>${o}</option>`).join('')}</select>
  <textarea data-f="comments" data-keep="1" placeholder="Other comments, weaknesses…">${esc(d.comments)}</textarea>
  <p class="mut">✔ Autosaves as you go.</p><div class="row"><button data-act="resetdraft" class="g">Reset</button><button data-act="donescout">Done – back to teams</button></div></div>`}
  return h;
}
const FIELDS=['autoPts','autoCons','autoNotes','driver','driverCons','robotType','speed','durability','scoring','reliable','scoreCons','toggle','toggleQ','overall','good','comments'];
function newDraft(t){return{id:uid(),eventId:ev,kind:'scout',ref:t,by:name,ts:Date.now(),text:''}}
const sum=n=>`<div class="note"><b>Scout entry</b> <small>${esc(n.by||'')} · ${new Date(n.ts).toLocaleString([], {dateStyle:'short',timeStyle:'short'})}</small>
 Auto: ${esc(n.autoPts||'-')} pts, consistency ${n.autoCons||'-'}/5 ${esc(n.autoNotes||'')}
 Driver ${n.driver||'-'}/5 (consistency ${n.driverCons||'-'}/5) ${esc(n.driveNotes||'')}
 Speed ${n.speed||'-'}/5 · Durability ${n.durability||'-'}/5
 Robot: ${esc(n.robotType||'-')}
 Scoring ${n.scoring||'-'}/5 (consistency ${n.scoreCons||'-'}/5) · ${esc(n.reliable||'-')}
 Toggle: ${esc(n.toggle||'-')} (mech ${n.toggleQ||'-'}/5)
 Overall ${n.overall||'-'}/5 · ${esc(n.good||'-')}
 ${esc(n.comments||'')}</div>`;

function vTeam(num){
  if(num===US)return `<div class="row" style="flex-wrap:nowrap"><h2 style="flex:1"><span class="num" style="font-size:34px">${esc(num)}</span> Invictus</h2><button class="g" data-act="close">Close</button></div><div class="card">That’s us. Scouting and team notes are turned off for our own team.</div>`;
  const t=teams().find(x=>x.number===num)||{number:num,name:'',school:''};
  const ms=matches().filter(m=>m.red.includes(num)||m.blue.includes(num));
  const sc=notes('scout',num);
  const avg=f=>{const v=sc.map(s=>+s[f]).filter(Boolean);return v.length?(v.reduce((a,b)=>a+b,0)/v.length).toFixed(1):'-'};
  return `<div class="row" style="flex-wrap:nowrap"><h2 style="flex:1">${esc(num)} ${esc(t.name)}</h2><button class="g" data-act="close">Close</button></div><div class="mut">${esc(t.school)}</div>
  <div class="card"><b>Averages</b> (${sc.length} entries)<div class="mut">Driver ${avg('driver')} · Speed ${avg('speed')} · Scoring ${avg('scoring')} · Durability ${avg('durability')} · Overall ${avg('overall')}</div></div>
  <div class="card"><h2>Matches</h2>${ms.map(m=>`<span class="chip ${side(m,num)==='ally'?'gn':side(m,num)==='opp'?'rd':''}">${esc(m.label)}</span>`).join('')||'<span class="mut">None</span>'}</div>
  <div class="card"><h2>Notes on this team</h2>${noteBox('team',num,'','Add a note about '+num+'…')}${notes('team',num).length?`<button class="d" data-act="clearnotes" data-t="${num}">Clear all notes on this team</button>`:''}</div>
  <div class="card"><h2>Scouting entries</h2>${sc.map(s=>sum(s)).join('')||'<span class="mut">None yet</span>'}${sc.length?`<button class="d" data-act="clearscout" data-t="${num}">Clear all scouting entries</button>`:''}</div>
  <div class="card"><h2>Alliance requests</h2>${notes('req',num).map(n=>`<div class="note">${esc(n.text)}</div>`).join('')||'<span class="mut">None</span>'}</div>`;
}

function vPick(){
  const e=evObj();if(!e)return'<p class="mut">Pick an event first.</p>';
  const p=e.picks||[],avail=teams().filter(t=>t.number!==US&&!p.includes(t.number));
  return `<div class="card"><h2>Finals picklist</h2><p class="mut">Hold the ≡ handle and drag to reorder. #1 is who we want most.</p><div id="pklist">${p.map((n,i)=>`<div class="pk" data-i="${i}"><span class="grip" title="Drag to reorder">≡</span><span class="num" style="width:34px;color:var(--ac)">${i+1}</span><div style="flex:1;cursor:pointer" data-act="team" data-t="${n}"><span class="num">${n}</span>${esc(tName(n))}<div class="mut">${notes('req',n).length?'Asked to ally · ':''}${notes('scout',n).length} scouting entries</div></div><button class="d" data-act="prm" data-i="${i}">Remove</button></div>`).join('')||'<p class="mut">Nothing yet. Tap a team below to add it.</p>'}</div></div>
  <div class="card"><h2>Still to pick</h2><p class="mut">Tap a team to add it to the list.</p>${avail.map(t=>`<button class="chip" data-act="addpick" data-t="${t.number}">${t.number}</button>`).join('')||'<span class="mut">Every team is on the list.</span>'}</div>`;
}
const setPicks=p=>upd('events',ev,{picks:p});

function sure(b){if(b.dataset.armed)return true;const t=b.textContent;b.dataset.armed=1;b.textContent='Tap again to confirm';b.style.fontWeight=700;setTimeout(()=>{if(b.isConnected){delete b.dataset.armed;b.textContent=t;b.style.fontWeight=''}},3000);return false}
document.addEventListener('click',e=>{
  const b=e.target.closest('[data-act]');if(!b)return;const a=b.dataset.act,v=id=>$('#'+id)?.value?.trim()||'';
  const me=name||'Someone';
  if(a==='tab'){tab=b.dataset.v;ls('tab',tab);render()}
  else if(a==='live'){live=!live;ls('live',live?'1':'0');applyTheme();schedule();if(live){pull();syncRE()}}
  else if(a==='login'){code=$('#codein').value.trim();loginErr=false;api('/login',{}).then(()=>{ls('code',code);return pull()}).then(schedule).catch(()=>{})}
  else if(a==='import'){const m=$('#impmsg');m.textContent='Importing…';api('/import',{sku:norm(v('sku'))}).then(d=>{ev=d.eventId;ls('ev',ev);return pull()}).catch(e=>{m.textContent='Failed: '+String(e.message||e).slice(0,140)})}
  else if(a==='team'){mTeam=b.dataset.t;render()}
  else if(a==='close'){mTeam=null;render()}
  else if(a==='addev'){const n=v('newev');if(n){const id=uid();put('events',id,{name:n,link:'',picks:[]});ev=id;ls('ev',id)}}
  else if(a==='delev'){if(sure(b)){del('events',ev);ev=''}}
  else if(a==='addteam'){const n=norm(v('t_n'));if(n)put('teams',ev+'_'+n,{eventId:ev,number:n,name:v('t_name'),school:v('t_s')})}
  else if(a==='delteam'){if(sure(b))del('teams',b.dataset.id)}
  else if(a==='addmatch'){const r=['m_r1','m_r2'].map(i=>norm(v(i))).filter(Boolean),bl=['m_b1','m_b2'].map(i=>norm(v(i))).filter(Boolean);
    if(v('m_l')&&(r.length||bl.length))put('matches',uid(),{eventId:ev,label:v('m_l'),order:+v('m_o')||matches().length+1,red:r,blue:bl})}
  else if(a==='delmatch'){if(sure(b))del('matches',b.dataset.id)}
  else if(a==='mopen'){open[b.dataset.id]=!open[b.dataset.id];render()}
  else if(a==='addnote'){const t=$('#'+b.dataset.in).value.trim();if(t&&!(b.dataset.kind==='team'&&b.dataset.ref===US))put('notes',uid(),{eventId:ev,kind:b.dataset.kind,ref:b.dataset.ref,sec:b.dataset.sec,text:t,by:me,ts:Date.now()});$('#'+b.dataset.in).value=''}
  else if(a==='delnote'){if(sure(b))del('notes',b.dataset.id)}
  else if(a==='addreq'){const t=norm(v('rq_t'));if(t&&t!==US&&v('rq_x')){put('notes',uid(),{eventId:ev,kind:'req',ref:t,text:v('rq_x'),by:me,ts:Date.now()})}}
  else if(a==='clearnotes'){if(sure(b))notes('team',b.dataset.t).forEach(n=>del('notes',n.id))}
  else if(a==='clearscout'){if(sure(b)){notes('scout',b.dataset.t).forEach(n=>del('notes',n.id));if(scTeam===b.dataset.t){draft=null;scTeam=''}}}
  else if(a==='clearmatch'){if(sure(b))notes('match',b.dataset.id).forEach(n=>del('notes',n.id))}
  else if(a==='startscout'){if(!name||b.dataset.t===US)return;scTeam=b.dataset.t;const id='s_'+ev+'_'+scTeam+'_'+slug(name);const ex=S.notes.find(n=>n.id===id);draft=ex?{...ex}:{...newDraft(scTeam),id};render();scrollTo(0,0)}
  else if(a==='donescout'){scTeam='';draft=null;render();scrollTo(0,0)}
  else if(a==='resetdraft'){if(sure(b)){const id=draft.id;draft={...newDraft(scTeam),id};saveDraft(0);render()}}
  else if(a==='setname'){name=b.dataset.v;ls('name',name);render()}
  else if(a==='theme'){ls('theme',(ls('theme')||'light')==='dark'?'light':'dark');applyTheme()}
  else if(a==='rate'){draft[b.dataset.f]=draft[b.dataset.f]==+b.dataset.v?0:+b.dataset.v;saveDraft(0);render()}
  else if(a==='addpick'){const n=b.dataset.t;const p=evObj().picks||[];if(n&&!p.includes(n))setPicks([...p,n])}
  else if(a==='pup'||a==='pdn'){const p=[...evObj().picks],i=+b.dataset.i,j=a==='pup'?i-1:i+1;if(j>=0&&j<p.length){[p[i],p[j]]=[p[j],p[i]];setPicks(p)}}
  else if(a==='prm'){const p=[...evObj().picks];p.splice(+b.dataset.i,1);setPicks(p)}
});
let myLive=ls('lid')||(ls('lid',uid()),ls('lid'));const uid2=()=>myLive;
function saveDraft(ms=600){clearTimeout(saveT);saveT=setTimeout(()=>{if(draft){draft.ts=draft.ts||Date.now();draft.by=name;put('notes',draft.id,draft)}},ms)}
document.addEventListener('input',e=>{const t=e.target;
  if(t.dataset.f&&draft&&tab==='scout'){draft[t.dataset.f]=t.value;saveDraft()}
  else if(t.id==='evlink')upd('events',ev,{link:t.value.trim()});
  else if(t.id==='myname'){name=t.value;ls('name',name)}});
document.addEventListener('change',e=>{const t=e.target;
  if(t.id==='evsel'){ev=t.value;ls('ev',ev);render()}
  else if(t.id==='scm'){scMatch=t.value;window.scNone=!t.value;render()}
  else if(t.dataset.f&&draft&&tab==='scout'){draft[t.dataset.f]=t.value;saveDraft(0)}});
document.addEventListener('focusout',()=>setTimeout(()=>{if(dirty)render()},150));

document.addEventListener('pointerdown',e=>{const g=e.target.closest('.grip');if(!g)return;e.preventDefault();
  const row=g.closest('.pk'),rows=[...document.querySelectorAll('#pklist .pk')],from=+row.dataset.i,y0=e.clientY;
  const mids=rows.map(r=>{const b=r.getBoundingClientRect();return b.top+b.height/2});
  dragging=true;row.classList.add('drag');try{g.setPointerCapture(e.pointerId)}catch(_){}
  const mv=m=>{row.style.transform='translateY('+(m.clientY-y0)+'px)'};
  const up=u=>{g.removeEventListener('pointermove',mv);g.removeEventListener('pointerup',up);g.removeEventListener('pointercancel',up);
    dragging=false;row.classList.remove('drag');row.style.transform='';
    const y=mids[from]+(u.clientY-y0);let to=0;mids.forEach((m,i)=>{if(i!==from&&m<y)to++});
    if(u.type!=='pointercancel'&&to!==from){const p=[...evObj().picks];p.splice(to,0,p.splice(from,1)[0]);setPicks(p)}
    if(dirty)render()};
  g.addEventListener('pointermove',mv);g.addEventListener('pointerup',up);g.addEventListener('pointercancel',up)});
document.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.id==='codein')document.querySelector('[data-act=login]').click()});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&code)pull()});
applyTheme();init();
