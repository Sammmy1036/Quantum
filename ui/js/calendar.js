// Quantum UI: your own calendar, on the Org page's mini calendar with your orgs' events (api_calendar.py;
// kept with your Quantum account by the server's mycalendar.py, so it's the same on every PC).
// One of several classic scripts sharing one global scope; index.html loads them in order.
//
// Add anything you plan: a mining run, a cargo haul, a meet-up with friends, a reminder. Each entry can have a
// place on the map (one click puts it on your route), a reminder (a note in Quantum and a Windows notification)
// and can repeat daily, weekly or monthly. If you can manage an org's events, the same form can put it on that
// org's calendar instead, for everyone in the org.
"use strict";
S.cal=S.cal||{items:null,ver:null,form:null,fired:null};
const CAL_KIND={personal:["Personal","#9dff7a"],mission:["Mission","#ff7ab6"],trade:["Trade run","#57e39b"],mining:["Mining","#ffb454"],
  salvage:["Salvage","#c99bff"],combat:["Combat / bounty","#ff8a7a"],social:["With friends","#7fe7ff"],reminder:["Reminder","#f2c14e"],other:["Other","#8cc4ff"]};
const CAL_ORGKIND={mission:"Operation",trade:"Trading",mining:"Mining",salvage:"Salvage",combat:"Bounty hunting",social:"Social",personal:"Other",reminder:"Meeting",other:"Other"};
const CAL_COLORS=["#9dff7a","#7fe7ff","#4b8dff","#c99bff","#ff7ab6","#ff8a7a","#ffb454","#f2c14e"];
const CAL_REMIND=[["","No reminder"],["0","When it starts"],["5","5 minutes before"],["15","15 minutes before"],["30","30 minutes before"],["60","1 hour before"],["1440","1 day before"]];
const CAL_LEN=[[15,"15 min"],[30,"30 min"],[60,"1 hour"],[90,"1½ hours"],[120,"2 hours"],[180,"3 hours"],[240,"4 hours"],[360,"6 hours"]];

async function calLoad(){ let r; try{ r=await api().calendar_list(); }catch(_){ r=null; } if(!r?.ok) return S.cal.items||[];
  const changed=r.ver!==S.cal.ver; S.cal.items=r.items; S.cal.ver=r.ver; S.cal.sync=r.sync;
  // a sync with the account is on its way: look again shortly, so another PC's changes show up by themselves
  if(r.sync?.busy&&!S.cal.again) S.cal.again=setTimeout(()=>{ S.cal.again=null; calLoad().then(()=>{ if(typeof ogMiniLoad==="function") ogMiniLoad(true); }); },2000);
  return changed; }
// Every time an entry happens between a and b (unix s): repeats unrolled
function calOccurrences(e,a,b){ const out=[], len=(e.minutes||60)*60, step={daily:86400,weekly:7*86400}[e.repeat];
  if(!e.repeat){ if(e.starts+len>=a&&e.starts<=b) out.push(e.starts); return out; }
  const end=Math.min(b,e.until||Infinity);
  if(e.repeat==="monthly"){ const d0=new Date(e.starts*1000);
    for(let i=0;i<240;i++){ const d=new Date(d0); d.setMonth(d0.getMonth()+i); const t=d.getTime()/1000; if(t>end) break; if(t+len>=a) out.push(t); } return out; }
  let t=e.starts; if(t+len<a) t+=Math.ceil((a-len-t)/step)*step;
  for(;t<=end&&out.length<400;t+=step) out.push(t);
  return out; }
// Your entries as the mini calendar's events (one per time it happens), for the months around the one shown
function calAsEvents(){ const m=S.og.miniMonth||new Date(), a=new Date(m.getFullYear(),m.getMonth()-1,1).getTime()/1000, b=new Date(m.getFullYear(),m.getMonth()+2,1).getTime()/1000;
  const out=[], now=Date.now()/1000;
  for(const e of S.cal.items||[]) for(const t of calOccurrences(e,Math.min(a,now-86400),Math.max(b,now+60*86400)))
    out.push({id:`c:${e.id}:${t}`,cal:e,title:e.title,starts:t,minutes:e.minutes||60,location:e.place||"",org:{id:"me",name:"My calendar",tag:"Mine",dot:e.color||CAL_KIND[e.kind]?.[1]||"#9dff7a"}});
  return out; }

// ---- the form: in a dialog over everything, so it fits however small the sidebar is
function calOpen(e,day){ const at=e?new Date(e.starts*1000):new Date(day||Date.now());
  if(!e){ if(day) at.setHours(20,0,0,0); else { at.setMinutes(0,0,0); at.setHours(at.getHours()+1); } }   // a day picked: that evening; else the next hour
  S.cal.form={...(e||{kind:"personal",minutes:60,remind:15,repeat:"none"}),at,org:"",colorSet:!!e?.color}; calRender(); }
function calClose(){ S.cal.form=null; $("cal-modal")?.remove(); }
function calRender(){ const f=S.cal.form; if(!f) return calClose();
  let d=$("cal-modal"); if(!d){ d=Object.assign(document.createElement("div"),{id:"cal-modal",className:"pf-modal"}); document.body.appendChild(d);
    d.addEventListener("mousedown",e=>{ if(e.target===d) calClose(); }); }
  const pad=n=>String(n).padStart(2,"0"), at=f.at, local=`${at.getFullYear()}-${pad(at.getMonth()+1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
  const until=f.until?new Date(f.until*1000):null, untilV=until?`${until.getFullYear()}-${pad(until.getMonth()+1)}-${pad(until.getDate())}`:"";
  const opt=(v,t,cur)=>`<option value="${esc(String(v))}" ${String(cur??"")===String(v)?"selected":""}>${esc(t)}</option>`;
  const orgs=(S.og.mine?.orgs||[]);
  const places=(S.locs||[]).filter(L=>L.pos||L.source==="user").map(L=>L.name).sort((a,b)=>a.localeCompare(b)).slice(0,4000);
  const len=CAL_LEN.some(([m])=>m===f.minutes)?CAL_LEN:[...CAL_LEN,[f.minutes,`${f.minutes} min`]].sort((a,b)=>a[0]-b[0]);
  d.innerHTML=`<div class="pf-box cal-box" role="dialog" aria-modal="true" aria-labelledby="cal-t">
    <div class="pf-head"><b id="cal-t">${f.id?"Edit":"Add to your calendar"}</b><button class="btn small ghost" data-calx="1" aria-label="Close">✕</button></div>
    <div class="cal-form">
      <label class="wide">Title<input class="field" data-cf="title" maxlength="80" value="${esc(f.title||"")}" placeholder="e.g. Quantanium run with Kade"></label>
      <label>Starts<input class="field" type="datetime-local" data-cf="at" value="${local}"></label>
      <label>How long<select class="field" data-cf="minutes">${len.map(([m,t])=>opt(m,t,f.minutes)).join("")}</select></label>
      <label>What kind<select class="field" data-cf="kind">${Object.entries(CAL_KIND).map(([k,[t]])=>opt(k,t,f.kind)).join("")}</select></label>
      <label>Reminder<select class="field" data-cf="remind">${CAL_REMIND.map(([v,t])=>opt(v,t,f.remind??"")).join("")}</select></label>
      <label class="wide">Where <span class="muted" style="font-weight:400">optional · a place on the map can go on your route</span><input class="field" data-cf="place" list="cal-places" maxlength="80" value="${esc(f.place||"")}" placeholder="e.g. Everus Harbor, or anything"></label>
      <datalist id="cal-places">${places.map(n=>`<option value="${esc(n)}">`).join("")}</datalist>
      <label>Repeats<select class="field" data-cf="repeat">${[["none","Doesn't repeat"],["daily","Every day"],["weekly","Every week"],["monthly","Every month"]].map(([v,t])=>opt(v,t,f.repeat||"none")).join("")}</select></label>
      <label ${!f.repeat||f.repeat==="none"?"hidden":""} data-calrep="1">Until <span class="muted" style="font-weight:400">optional</span><input class="field" type="date" data-cf="until" value="${untilV}"></label>
      <div class="wide"><span class="cal-k">Colour</span><div class="cal-sw" role="radiogroup" aria-label="Colour">${CAL_COLORS.map(c=>`<button type="button" role="radio" aria-checked="${(f.color||CAL_KIND[f.kind]?.[1])===c}" aria-label="Colour ${c}" data-calc="${c}" style="background:${c}"></button>`).join("")}</div></div>
      <label class="wide">Notes<textarea class="field" data-cf="notes" maxlength="1000" rows="3" placeholder="Ship, crew, what to bring, the contract…">${esc(f.notes||"")}</textarea></label>
      ${!f.id&&orgs.length?`<label class="wide">Put it on<select class="field" data-cf="org">${opt("","My calendar (only you see it)",f.org)}${orgs.map(o=>opt(o.id,`${o.name}'s calendar (everyone in the org)`,f.org)).join("")}</select></label>`:""}
    </div>
    <div class="cal-acts">${f.id?`<button class="btn danger" data-caldel="1">Delete</button>`:""}${f.id&&S.locMap?.[f.place]?`<button class="btn ghost" data-calroute="1">Add place to route</button>`:""}<span class="spacer"></span>
      <button class="btn ghost" data-calx="1">Cancel</button><button class="btn primary" data-calsave="1">${f.id?"Save":"Add"}</button></div>
    <div class="muted cal-sync">${S.cal.sync?.signed_in?(S.cal.sync.error?esc(S.cal.sync.error):"Kept with your Quantum account: the same on every PC."):"On this PC only. Sign in to your Quantum account to keep it on every PC."}</div></div>`;
  calWire(d); setTimeout(()=>d.querySelector('[data-cf="title"]')?.focus(),20); }
function calRead(d){ const f=S.cal.form, v=k=>d.querySelector(`[data-cf="${k}"]`)?.value??"";
  const at=v("at")?new Date(v("at")):f.at; const u=v("until");
  Object.assign(f,{title:v("title").trim(),at,minutes:+v("minutes")||60,kind:v("kind"),remind:v("remind")===""?null:+v("remind"),place:v("place").trim(),repeat:v("repeat"),
    until:u?new Date(u+"T23:59").getTime()/1000:null,notes:v("notes"),org:v("org")}); return f; }
function calWire(d){
  d.onclick=async e=>{ const t=e.target;
    if(t.closest("[data-calx]")) return calClose();
    const sw=t.closest("[data-calc]"); if(sw){ calRead(d); S.cal.form.color=sw.dataset.calc; S.cal.form.colorSet=true; return calRender(); }
    if(t.closest("[data-calroute]")){ const n=S.cal.form.place; const r=await api().add_stops([n],true); await poll(); toast(r?.added?.length?`Added ${n} to your route`:`${n} is already the last stop`); return; }
    if(t.closest("[data-caldel]")){ const f=S.cal.form;
      if(!await qConfirm({title:`Delete ${f.title}?`,text:f.repeat&&f.repeat!=="none"?"Every time it repeats is deleted too.":"",ok:"Delete",danger:true})) return;
      const r=await api().calendar_delete(f.id); if(!r.ok) return toast(r.error); calClose(); toast("Deleted from your calendar"); await calLoad(); return ogMiniRefresh(); }
    if(t.closest("[data-calsave]")){ const f=calRead(d);
      if(!f.title) return toast("Give it a title");
      const starts=Math.round(f.at.getTime()/1000);
      if(f.org){   // on an org's calendar instead: the org's own event (everyone in the org sees it)
        const r=await ogCall("event/save",{org:+f.org,title:f.title,description:f.notes||"",kind:CAL_ORGKIND[f.kind]||"Other",starts,minutes:f.minutes,location:f.place||"",max:0});
        if(!r.ok) return toast(r.error); calClose(); toast("Added to the org's calendar"); S.og.allEvAt=0; return ogMiniLoad(true); }
      const r=await api().calendar_save({id:f.id,title:f.title,starts,minutes:f.minutes,kind:f.kind,place:f.place,system:S.locMap?.[f.place]?.system||null,
        notes:f.notes,color:f.color||CAL_KIND[f.kind]?.[1],remind:f.remind,repeat:f.repeat,until:f.until});
      if(!r.ok) return toast(r.error); calClose(); toast(f.id?"Saved":`Added to your calendar${f.remind!=null?": you'll get a reminder":""}`); await calLoad(); return ogMiniRefresh(); } };
  d.onchange=e=>{ if(e.target.matches('[data-cf="repeat"]')){ calRead(d); calRender(); }
    if(e.target.matches('[data-cf="kind"]')&&!S.cal.form.colorSet){ calRead(d); S.cal.form.color=CAL_KIND[S.cal.form.kind]?.[1]; calRender(); } };
  d.onkeydown=e=>{ if(e.key==="Escape"){ e.stopPropagation(); calClose(); } }; }
function ogMiniRefresh(){ S.og.allEvAt=0; if(typeof ogMiniLoad==="function") ogMiniLoad(true); const M=$("og-mini"); if(M&&typeof ogMiniHtml==="function"){ M.innerHTML=ogMiniHtml(); ogMiniWire(); } }

// ---- reminders: checked every 30 s while Quantum is open; each time an entry happens reminds once
function calFired(){ if(!S.cal.fired){ try{ S.cal.fired=JSON.parse(localStorage.getItem("q-cal-fired")||"{}"); }catch(_){ S.cal.fired={}; } } return S.cal.fired; }
async function calTick(){ if(!S.cal.items) await calLoad(); const now=Date.now()/1000, fired=calFired(); let n=0;
  for(const e of S.cal.items||[]){ if(e.remind==null) continue;
    for(const t of calOccurrences(e,now-3600,now+(e.remind+1)*60)){ const due=t-e.remind*60, k=`${e.id}:${t}`;
      if(fired[k]||now<due||now>t+15*60) continue;
      fired[k]=now; n++;
      const when=new Date(t*1000).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"});
      const text=`${e.title} ${t-now>60?`at ${when}`:"now"}${e.place?` · ${e.place}`:""}`;
      toastLong(`Reminder: ${text}`); api().calendar_notify("Quantum reminder",text).catch(()=>{}); } }
  if(n){ for(const [k,v] of Object.entries(fired)) if(v<now-14*86400) delete fired[k]; try{ localStorage.setItem("q-cal-fired",JSON.stringify(fired)); }catch(_){} } }
setTimeout(()=>{ calTick(); setInterval(calTick,30000); },8000);
