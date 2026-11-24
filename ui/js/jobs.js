// Quantum UI: Jobs, daily and weekly goals for every role at once (api_jobs.py, server jobs.py).
// One of several classic scripts sharing one global scope; index.html loads them in order.
//
// Every role (Cargo Hauler, Delivery Courier, Bounty Hunter, Mercenary, Salvager, Miner, Refueler, Trader) has 3 jobs a
// day and 5 a week: do any, all or none of them. New at 08:00 Pacific (weekly: Mondays); 3 swaps a day. Progress is
// counted from the aUEC balance changes Quantum sees through the game's telemetry: sent while this tab is open and
// every few minutes in the background. The list on the left only picks which role's jobs are shown.
"use strict";
S.jb=S.jb||{data:null,busy:false,at:0,view:"all"};
// The game's own delivery mission icon (pu_mobiapp_icon_mission_delivery): filled, in the section's colour (the <g>'s
// own fill/stroke win over the outline style .jb-ic gives its other icons)
const JB_COURIER='<svg viewBox="0 0 64 64" aria-hidden="true"><g fill="currentColor" stroke="none"><path d="M54.9 8.8v22.9c0 1.3-1 2.4-2.4 2.4H29.6c-1.3 0-2.3-1.1-2.3-2.4V8.8c0-1.3 1-2.4 2.3-2.4h8.6v10.3c0 .7.5 1.2 1.2 1.2h3.3c.7 0 1.2-.5 1.2-1.2V6.4h8.6c1.4 0 2.4 1.1 2.4 2.4z"/><path d="M58.6 45.3h-32c-4.7 0-8.8-3.3-9.8-7.9l-5.7-26.2-5.5.1c-1.2 0-2.1-1-2.1-2.1S4.3 7 5.4 7H11c2 0 3.7 1.4 4.1 3.3l5.7 26.2c.6 2.6 3 4.5 5.6 4.5h32c1.2 0 2.1 1 2.1 2.1 0 1.3-1 2.2-2.1 2.2z"/><circle cx="27.3" cy="54.1" r="4.7"/><circle cx="52.1" cy="54.1" r="4.7"/></g></svg>';
// The icons the rest of Quantum already uses for this work: the game's own (Components, Missions, place services)
function jbIc(k){
  const off=n=>typeof offIcon==="function"?offIcon(n):"", gi=n=>typeof gameIcon==="function"?gameIcon(n,"jb-gi"):"";
  // a picture used as a mask, so it takes the section's colour like the rest (as an <img> its shape drew black)
  const img=src=>src?`<i class="jb-img" style="-webkit-mask-image:url('${src}');mask-image:url('${src}')" aria-hidden="true"></i>`:"";
  const h={hauler:()=>off("hauler"),courier:()=>JB_COURIER,bounty:()=>img(typeof MI_KIND_ICON!=="undefined"&&MI_KIND_ICON.bounty),
    mercenary:()=>off("weapons"),salvager:()=>gi("salvageable"),miner:()=>off("miningLasers"),refueler:()=>gi("fuel_tanks"),
    trader:()=>typeof SVC_COMMODITY!=="undefined"?SVC_COMMODITY:""}[k];
  return `<span class="jb-ic">${(h&&h())||""}</span>`; }
const jbLeft=t=>{ const s=Math.max(0,t-Date.now()/1000), d=Math.floor(s/86400), h=Math.floor(s%86400/3600), m=Math.floor(s%3600/60); return d?`${d}d ${h}h`:h?`${h}h ${m}m`:`${m}m`; };
const jbAll=d=>(d?.roles||[]).flatMap(r=>[...r.daily,...r.weekly]);
async function jbLoad(sync){ if(S.jb.busy){ if(sync) S.jb.again=true; return; } S.jb.busy=true;
  let r; try{ r=await (sync?api().jobs_sync():api().jobs_state()); }catch(e){ r={ok:false,error:String(e)}; }
  S.jb.busy=false; S.jb.at=Date.now();
  const prev=S.jb.data; S.jb.data=r;
  if(prev?.ok&&r?.ok){ const was=new Set(jbAll(prev).filter(j=>j.done_at).map(j=>j.id));
    for(const j of jbAll(r)) if(j.done_at&&!was.has(j.id)) toast(`Job done: ${j.name} · ${j.title}`); }
  jbCount(); if(S.tab==="jobs") jbRender(); jbPinsRender(); if(S.tab==="profile"&&typeof renderProfile==="function") renderProfile();
  if(S.jb.again){ S.jb.again=false; setTimeout(()=>jbLoad(true),500); } }
function jbCount(){ const d=S.jb.data, c=$("c-jobs"); if(!c) return; if(!d?.ok){ c.textContent=""; return; }
  const n=jbAll(d).filter(j=>j.done_at).length; c.textContent=n?`${n}/${jbAll(d).length}`:""; }
function openJobs(){ jbRender(); jbLoad(true); jbTelLoad(); }
// ---- Game telemetry isn't working yet: Jobs can't see any earnings without it, so say what's left to do, with the
// same one-click fixes as Settings › Game telemetry. Gone for good once data has come in once (telemetry_status.seen).
async function jbTelLoad(){ let t; try{ t=await api().telemetry_status(); }catch(_){ return; }
  const k=JSON.stringify([t?.on,t?.seen,t?.ready?.configured,t?.ready?.known,t?.game_running]); S.jb.tel=t;
  if(k!==S.jb.telKey){ S.jb.telKey=k; if(S.tab==="jobs") jbRender(); } }
function jbTelStep(t){ if(!t?.ok) return null; const rd=t.ready||{};
  if(!t.on) return {title:"Game telemetry is off",text:"Jobs counts the aUEC you earn from the game's telemetry, so with it off nothing counts.",btn:["on","Turn it on"]};
  if(!t.seen&&t.windows&&!rd.configured) return {title:"Set up game telemetry to start counting jobs",
    text:"Jobs counts the aUEC you earn from the game's telemetry, which is off in Star Citizen until it's set up. Quantum can do it for you; it takes effect the next time the RSI Launcher and the game start.",btn:["setup","Set up the game for me"]};
  if(!t.seen) return {title:"Almost there: restart the RSI Launcher and the game",
    text:t.game_running?"Telemetry is set up, but this game session started without it. Close Star Citizen, restart the RSI Launcher, start the game from it and spawn in.":"Telemetry is set up. Restart the RSI Launcher, start Star Citizen from it and spawn in: jobs start counting then.",
    btn:t.windows&&!t.game_running?["launcher","Restart the RSI Launcher for me"]:null};
  if(rd.known===false) return {title:"Quantum hasn't found Game.log",warn:true,
    text:"Earnings still count, but without Game.log contracts can't be told apart from sales, so hauling, delivery, bounty and mercenary jobs may not count.",btn:null};
  return null; }
function jbTelHtml(){ const x=jbTelStep(S.jb.tel); if(!x) return "";
  return `<div class="jb-tel ${x.warn?"warn":""}" role="status"><div class="jb-tel-t"><b>${esc(x.title)}</b><span>${esc(x.text)}</span></div>
    <div class="jb-tel-a">${x.btn?`<button class="btn small primary" data-jbtel="${x.btn[0]}" ${S.jb.telBusy?"disabled":""}>${S.jb.telBusy?"Working…":esc(x.btn[1])}</button>`:""}
      <button class="btn small ghost" data-jbtel="settings">Settings</button></div></div>`; }
const jbMoney=j=>["earn","big","bestday"].includes(j.metric);
const jbVal=(j,n)=>jbMoney(j)?Math.round(n).toLocaleString():String(Math.round(n));
function jbCard(j,d){ const pct=Math.min(100,Math.round((j.progress||0)/j.target*100));
  const pin=jbIsPinned(j), full=!pin&&jbPins().length>=JB_PIN_MAX;
  return `<div class="jb-card ${j.done_at?"done":""}"><div class="jb-top"><span class="jb-kind">${j.kind==="daily"?"Daily":"Weekly"}</span><b class="jb-name">${esc(j.name||"")}</b>${j.done_at?`<span class="jb-ok">✓ Done</span>`:""}
      <button type="button" class="jb-pin ${pin?"on":""}" data-jbpin="${esc(jbPinKey(j))}" aria-pressed="${pin}" title="${pin?"Unpin it from the map":full?`You can pin ${JB_PIN_MAX} jobs: unpin one first`:"Pin it to the map (Home)"}">${JB_PIN_IC}</button></div>
    <div class="jb-t">${esc(j.title)}</div>
    <div class="jb-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${j.target}" aria-valuenow="${j.progress||0}" aria-label="${esc(j.title)}"><i style="width:${pct}%"></i></div>
    <div class="jb-foot"><span>${j.metric==="big"?"Best so far ":j.metric==="streak"?"Best stretch ":j.metric==="bestday"?"Best day ":""}<b>${jbVal(j,j.progress||0)}</b> / ${jbVal(j,j.target)}${jbMoney(j)?" aUEC":""}</span><span class="spacer"></span>
      ${j.done_at?"":`<button class="btn small ghost" data-jbswap="${esc(j.id)}" ${d.swaps_left?"":"disabled"} title="${d.swaps_left?`Swap it for another job (${d.swaps_left} left today)`:"No swaps left today"}">Swap</button>`}</div></div>`; }
// one role on the overview: its icon, how many are done, a pip per job, and the job closest to done
function jbRow(r){ const all=[...r.daily,...r.weekly], open=all.filter(j=>!j.done_at).sort((a,b)=>(b.progress/b.target)-(a.progress/a.target)), next=open[0];
  const pip=j=>`<i class="${j.done_at?"on":j.progress?"part":""} ${j.kind}" title="${esc(`${j.kind==="daily"?"Daily":"Weekly"}: ${j.title}`)}"></i>`;
  return `<button type="button" class="jb-row" data-jbview="${r.id}">${jbIc(r.id)}<span class="jb-row-n"><b>${esc(r.name)}</b><span class="muted">${next?esc(`Closest: ${next.title}`):"Everything done this week"}</span></span>
    <span class="jb-pips" aria-label="${r.done} of ${r.total} done">${r.daily.map(pip).join("")}<span class="sep"></span>${r.weekly.map(pip).join("")}</span><b class="jb-row-c">${r.done}/${r.total}</b></button>`; }
function jbRender(){ const P=$("jb-panel"), side=$("jb-side"), d=S.jb.data; if(!P) return;
  if(!d){ P.innerHTML=qLoader("Getting your jobs…"); if(side) side.innerHTML=""; return; }
  if(!d.ok){ const out=d.status==="signed_out";
    P.innerHTML=jbTelHtml()+`<div class="empty" style="margin-top:60px"><strong>${out?"Sign in for jobs":"Jobs aren't available"}</strong>${esc(d.error||"")}${out?`<div style="margin-top:12px"><button class="btn primary" data-jbacct="1">Sign in</button></div>`:""}</div>`;
    if(side) side.innerHTML=""; return; }
  const view=d.roles.some(r=>r.id===S.jb.view)?S.jb.view:"all", done=jbAll(d).filter(j=>j.done_at).length;
  if(side) side.innerHTML=`<div class="jb-side-h">Jobs</div><div class="jb-roles">
      <button type="button" class="jb-role ${view==="all"?"on":""}" data-jbview="all" aria-pressed="${view==="all"}"><span class="jb-ic">${typeof gameIcon==="function"?gameIcon("missions","jb-gi"):""}</span><span>Every role</span><b>${done}/${jbAll(d).length}</b></button>
      ${d.roles.map(r=>`<button type="button" class="jb-role ${view===r.id?"on":""}" data-jbview="${r.id}" aria-pressed="${view===r.id}">${jbIc(r.id)}<span>${esc(r.name)}</span><b>${r.done}/${r.total}</b></button>`).join("")}</div>
    <div class="jb-stats"><div><b>${d.points||0}</b><span>Job points</span></div><div><b>${d.done?.daily||0}</b><span>Dailies done</span></div><div><b>${d.done?.weekly||0}</b><span>Weeklies done</span></div></div>
    <div class="muted" style="font-size:11.5px;line-height:1.5;margin-top:10px">Every role's jobs count at the same time: do whichever you like. Dailies are 1 point, weeklies 3.</div>`;
  const head=(icon,title)=>`<div class="mkp-head" style="grid-template-columns:1fr"><div class="hd-main"><div class="hd-title"><div><h2 class="jb-h2">${icon}${esc(title)}</h2>
      <div class="sub">${d.swaps_left} of ${d.swaps_max} swaps left today · new dailies in ${jbLeft(d.daily_next)} · new weeklies in ${jbLeft(d.weekly_next)}${d.measured_at?` · progress from ${agoTs(d.measured_at)}`:""}</div></div>
      <button class="btn small ghost" data-jbsync="1" ${S.jb.busy?"disabled":""}>${S.jb.busy?"Updating…":"Update progress"}</button></div></div></div>`;
  const foot=`<div class="uex-credit" style="margin-top:18px">Progress counts the aUEC balance changes Quantum sees through the game's telemetry (Settings › Game telemetry), from 08:00 Pacific today or Monday. Each payout counts for one role at most. A contract counts by its kind of work in the game files (hauling, delivery, bounty, patrol…), never by its cargo, so hauling fuel isn't refuelling. A sale counts by the ship you sold from, landed or docked: a Prospector, MOLE or ROC is a Miner's, a Vulture or Reclaimer a Salvager's, a Starfarer a Refueler's (in flight too), anything else a Trader's. Money from a friend or a refund counts for nobody. Resets at ${esc(d.reset)}.</div>`;
  if(view==="all"){ P.innerHTML=head(typeof gameIcon==="function"?gameIcon("missions","jb-gi"):"","Jobs")+jbTelHtml()+`<div class="jb-rows">${d.roles.map(jbRow).join("")}</div>`+jbBadgesHtml(d)+foot; return; }
  const r=d.roles.find(x=>x.id===view);
  const rb=(d.badges||[]).find(b=>b.role===r.id);
  P.innerHTML=head(jbIc(r.id),`${r.name} jobs`)+jbTelHtml()+(rb?`<div class="jb-rbadge">${jbMedal(rb)}<div><b>${rb.tier?`${esc(rb.tier_name)} ${esc(r.name)}`:`No ${esc(r.name)} badge yet`}</b><span class="muted">${jbBadgeLine(rb)}</span></div></div>`:"")+`<div class="mk-h">Today</div><div class="jb-grid">${r.daily.map(j=>jbCard(j,d)).join("")}</div>
    <div class="mk-h" style="margin-top:18px">This week</div><div class="jb-grid">${r.weekly.map(j=>jbCard(j,d)).join("")}</div>`+foot; }
document.addEventListener("click",async e=>{ if(!e.target.closest("#jb-panel,#jb-side")) return;
  const v=e.target.closest("[data-jbview]"); if(v){ S.jb.view=v.dataset.jbview; return jbRender(); }
  const pn=e.target.closest("[data-jbpin]"); if(pn) return jbTogglePin(pn.dataset.jbpin);
  const bd=e.target.closest("[data-jbbadge]"); if(bd) return jbBadgeOpen(bd.dataset.jbbadge);
  const bs=e.target.closest("[data-jbbshow]"); if(bs){ bs.disabled=true; const x=await api().jobs_badges_show(bs.checked).catch(()=>null);
    if(!x?.ok){ bs.checked=!bs.checked; bs.disabled=false; return toast(x?.error||"Couldn't change that. Try again"); }
    S.jb.data=x; jbRender(); if(typeof renderProfile==="function") renderProfile(true); return toast(x.badges_shown?"Your badges show on your profile":"Your badges are hidden from your profile"); }
  const sw=e.target.closest("[data-jbswap]"); if(sw){ sw.disabled=true; const x=await api().jobs_reroll(sw.dataset.jbswap); if(!x.ok){ sw.disabled=false; return toast(x.error); }
    S.jb.data=x; jbRender(); jbLoad(true); return toast(`New job. ${x.swaps_left} swap${x.swaps_left===1?"":"s"} left today`); }
  const tb=e.target.closest("[data-jbtel]"); if(tb){ const a=tb.dataset.jbtel;
    if(a==="settings"){ select({kind:"settings"}); return setTimeout(()=>document.querySelector('[data-a="tlsetup"],[data-a="tlfix"],#s-tl,.tl-items')?.scrollIntoView({block:"center",behavior:"smooth"}),300); }
    S.jb.telBusy=true; jbRender(); let r;
    try{ r=a==="on"?await api().telemetry_set(true):a==="setup"?await api().telemetry_setup_game():await api().telemetry_restart_launcher(); }
    catch(_){ r={ok:false,error:"Couldn't do that"}; }
    S.jb.telBusy=false;
    if(r?.ok===false||(a==="setup"&&!r?.ready?.configured)) toast(r?.error||"Setup didn't finish: try it from Settings › Game telemetry");
    else toast(a==="on"?"Game telemetry on":a==="setup"?"Set up. Now restart the RSI Launcher and the game":"RSI Launcher restarted with the setting. Start Star Citizen from it");
    if(typeof S.tl==="object") S.tl.cfgAt=0;
    return jbTelLoad().then(jbRender); }
  if(e.target.closest("[data-jbsync]")){ jbRender(); return jbLoad(true); }
  if(e.target.closest("[data-jbacct]")&&typeof openProfileView==="function") openProfileView("accounts"); });
// in the background: every 3 minutes while the game sends data (or the tab is open), so a finished job is noticed
setInterval(()=>{ if(S.tab==="jobs"&&!S.jb.tel?.seen) jbTelLoad(); },15000);
setInterval(()=>{ const live=S.live?.telemetry?.status==="connected"; if((S.tab==="jobs"||live)&&Date.now()-S.jb.at>170000&&S.jb.data?.ok!==false) jbLoad(true); },20000);
// Progress moves when you earn: every 4 s the app is asked (locally, no server call) whether the earnings log has a new
// entry, and if so Jobs and the pinned jobs on Home sync a few seconds later (once the payout has settled). Before, the
// pins only refreshed with the 3-minute sync, or by opening Jobs.
S.jb.mark=null;
setInterval(async()=>{ if(!window.pywebview?.api||S.jb.data?.ok===false) return;
  if(!(S.tab==="jobs"||jbPins().length)) return;
  let m; try{ m=await api().jobs_log_mark(); }catch(_){ return; } if(!m?.ok) return;
  const k=`${m.n}|${m.t}`; if(S.jb.mark===null){ S.jb.mark=k; return; }
  if(k!==S.jb.mark){ S.jb.mark=k; clearTimeout(S.jb.markT); S.jb.markT=setTimeout(()=>jbLoad(true),3000); } },4000);
setTimeout(()=>jbLoad(false),6000);

// =================================================================== badges
// Every finished job counts toward its role's badge, for good: Bronze, Silver, Gold, Diamond (the server counts them,
// /v1/jobs/mine "badges"). Drawn as a hexagon medal in the tier's metal with the role's own icon.
const JB_TIER={bronze:"Bronze",silver:"Silver",gold:"Gold",diamond:"Diamond"};
function jbMedal(b,size){ const t=b.tier||"none";
  return `<span class="jbb t-${t}${size?" "+size:""}" title="${esc(b.tier?`${b.tier_name} ${b.name} · ${b.done} jobs done`:`${b.name}: ${b.done} job${b.done===1?"":"s"} done`)}"><span class="jbb-in">${jbIc(b.role)}</span></span>`; }
function jbBadgeLine(b){ return `${b.done} job${b.done===1?"":"s"} done${b.next_at?` · ${b.next_at-b.done} more for ${JB_TIER[jbNextTier(b)]||"the next"}`:" · the top tier"}`; }
function jbNextTier(b){ const T=S.jb.data?.badge_tiers||[]; return (T.find(x=>x.at===b.next_at)||{}).tier; }
function jbBadgesHtml(d){ const B=d.badges; if(!B?.length) return "";     // (a server from before badges: nothing)
  const T=d.badge_tiers||[], got=B.filter(b=>b.tier).length;
  return `<div class="mk-h" style="margin-top:22px;display:flex;align-items:center;gap:10px">Badges<span class="mk-note">${got} of ${B.length} roles</span><span class="spacer"></span>
      <label class="jb-bshow" title="Others see your badges when they open your profile"><input type="checkbox" data-jbbshow="1" ${d.badges_shown?"checked":""}> Show on my profile</label></div>
    <div class="jb-badges">${B.map(b=>{ const pct=b.next_at?Math.min(100,Math.round(b.done/b.next_at*100)):100;
      return `<div class="jb-bcard ${b.tier?"":"locked"}" data-jbbadge="${b.role}" role="button" tabindex="0" title="See this badge and how to earn it">${jbMedal(b)}
        <b>${esc(b.name)}</b><span class="jb-btier t-${b.tier||"none"}">${b.tier?esc(b.tier_name):"Not earned yet"}</span>
        <div class="jb-bar sm"><i style="width:${pct}%"></i></div><span class="muted">${b.next_at?`${b.done} / ${b.next_at}`:`${b.done} · top tier`}</span></div>`; }).join("")}</div>
    <div class="muted" style="font-size:11.5px;margin-top:8px">${T.map(t=>`${t.name} at ${t.at}`).join(" · ")} finished jobs of a role, dailies and weeklies alike. They never reset.</div>`; }
// earned ones, highest first (Profile)
function jbEarned(d){ const r={diamond:0,gold:1,silver:2,bronze:3}; return (d?.badges||[]).filter(b=>b.tier).sort((a,b)=>r[a.tier]-r[b.tier]||b.done-a.done); }

// =================================================================== pins on the map
// Up to 3 jobs pinned to Home's map, in a small card you can drag anywhere on it. A pin is a role's daily or weekly
// slot for that day or week: swapping the job keeps it pinned (same slot), the reset drops it. Kept on this PC.
const JB_PIN_MAX=3;
const JB_PIN_IC='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6l-1 6 4 4H6l4-4zM12 13v8"/></svg>';
const jbLS=(k,v)=>{ try{ if(v===undefined) return JSON.parse(localStorage.getItem(k)||"null"); localStorage.setItem(k,JSON.stringify(v)); }catch(_){ return null; } };
const jbPinKey=j=>`${j.role}|${j.kind}|${j.slot}`;
function jbPins(){ const P=jbLS("q-jb-pins"); return Array.isArray(P)?P:[]; }
const jbIsPinned=j=>jbPins().some(p=>p.k===jbPinKey(j));
function jbPinFrom(d,kind){ return kind==="daily"?d.daily_from:d.weekly_from; }
function jbTogglePin(k){ const d=S.jb.data; if(!d?.ok) return; let P=jbPins(); const [role,kind]=k.split("|");
  if(P.some(p=>p.k===k)) P=P.filter(p=>p.k!==k);
  else{ if(P.length>=JB_PIN_MAX) return toast(`You can pin ${JB_PIN_MAX} jobs. Unpin one first`); P.push({k,from:jbPinFrom(d,kind)}); toast("Pinned to the map on Home"); }
  jbLS("q-jb-pins",P); jbRender(); jbPinsRender(); }
// the jobs pinned now (gone ones dropped: a new day or week)
function jbPinned(){ const d=S.jb.data; if(!d?.ok) return [];
  const P=jbPins(), out=[], keep=[];
  for(const p of P){ const [role,kind,slot]=p.k.split("|"), r=d.roles.find(x=>x.id===role);
    const j=r&&(r[kind]||[]).find(x=>String(x.slot)===slot);
    if(j&&p.from===jbPinFrom(d,kind)){ keep.push(p); out.push({j,r}); } }
  if(keep.length!==P.length) jbLS("q-jb-pins",keep);
  return out; }
function jbOpenRole(role){ S.jb.view=role; document.querySelector('.tab[data-tab="jobs"]')?.click(); }
function jbPinsRender(){ const wrap=$("mapwrap"); if(!wrap) return; let W=$("jb-pins");
  const L=jbPinned(), show=L.length&&typeof groupOf==="function"&&groupOf(S.tab||"route")==="navigate";
  if(!show){ if(W) W.hidden=true; return; }
  if(!W){ W=document.createElement("div"); W.id="jb-pins"; W.className="card jb-pins"; wrap.appendChild(W); jbPinsWire(W); }
  W.hidden=false; const min=!!jbLS("q-jb-pins-min");
  W.innerHTML=`<div class="jbp-h" title="Drag to move"><span class="jbp-grip" aria-hidden="true">⋮⋮</span>${JB_PIN_IC}<b>Pinned jobs</b><span class="muted">${L.length}/${JB_PIN_MAX}</span><span class="spacer"></span>
      <button type="button" class="jbp-b" data-jbpmin="1" aria-label="${min?"Show":"Hide"} the jobs" title="${min?"Show":"Hide"} the jobs">${min?"▸":"▾"}</button></div>
    ${min?"":L.map(({j,r})=>{ const pct=Math.min(100,Math.round((j.progress||0)/j.target*100));
      return `<div class="jbp-row ${j.done_at?"done":""}" data-jbpopen="${r.id}" role="button" tabindex="0" title="Open ${esc(r.name)} jobs">${jbIc(r.id)}<div class="jbp-t">
          <div class="jbp-k"><span>${esc(r.name)} · ${j.kind==="daily"?"Daily":"Weekly"}</span>${j.done_at?`<b class="jb-ok">✓ Done</b>`:`<b>${jbVal(j,j.progress||0)} / ${jbVal(j,j.target)}</b>`}</div>
          <div class="jbp-ti">${esc(j.title)}</div><div class="jb-bar sm"><i style="width:${pct}%"></i></div></div>
        <button type="button" class="jbp-x" data-jbunpin="${esc(jbPinKey(j))}" aria-label="Unpin" title="Unpin">×</button></div>`; }).join("")}`;
  jbPinsPlace(W); }
// where it sits: kept as a fraction of the map, so it stays put through window resizes (and always fully on the map)
function jbPinsPlace(W){ const wrap=$("mapwrap"), pos=jbLS("q-jb-pins-pos"), mw=wrap.clientWidth, mh=wrap.clientHeight, w=W.offsetWidth, h=W.offsetHeight;
  let x=pos?pos.x*mw:mw-w-16, y=pos?pos.y*mh:150;
  x=Math.max(8,Math.min(mw-w-8,x)); y=Math.max(8,Math.min(mh-h-8,y));
  W.style.left=x+"px"; W.style.top=y+"px"; }
function jbPinsWire(W){
  W.addEventListener("click",e=>{ const x=e.target.closest("[data-jbunpin]"); if(x){ e.stopPropagation(); return jbTogglePin(x.dataset.jbunpin); }
    if(e.target.closest("[data-jbpmin]")){ jbLS("q-jb-pins-min",!jbLS("q-jb-pins-min")); return jbPinsRender(); }
    const o=e.target.closest("[data-jbpopen]"); if(o&&!W.dataset.moved) jbOpenRole(o.dataset.jbpopen); });
  W.addEventListener("keydown",e=>{ const o=e.target.closest("[data-jbpopen]"); if(o&&(e.key==="Enter"||e.key===" ")){ e.preventDefault(); jbOpenRole(o.dataset.jbpopen); } });
  // drag by its title
  W.addEventListener("pointerdown",e=>{ const h=e.target.closest(".jbp-h"); if(!h||e.button!==0||e.target.closest("button")) return;
    e.preventDefault(); const wrap=$("mapwrap"), r0=W.getBoundingClientRect(), wr=wrap.getBoundingClientRect(), dx=e.clientX-r0.left, dy=e.clientY-r0.top;
    W.setPointerCapture(e.pointerId); W.classList.add("dragging"); delete W.dataset.moved;
    const mv=ev=>{ W.dataset.moved="1"; const x=Math.max(8,Math.min(wr.width-W.offsetWidth-8,ev.clientX-wr.left-dx)), y=Math.max(8,Math.min(wr.height-W.offsetHeight-8,ev.clientY-wr.top-dy));
      W.style.left=x+"px"; W.style.top=y+"px"; };
    const up=()=>{ W.removeEventListener("pointermove",mv); W.removeEventListener("pointerup",up); W.removeEventListener("pointercancel",up); W.classList.remove("dragging");
      jbLS("q-jb-pins-pos",{x:parseFloat(W.style.left)/wrap.clientWidth,y:parseFloat(W.style.top)/wrap.clientHeight});
      setTimeout(()=>delete W.dataset.moved,0); };
    W.addEventListener("pointermove",mv); W.addEventListener("pointerup",up); W.addEventListener("pointercancel",up); }); }
for(const t of document.querySelectorAll(".tab")) t.addEventListener("click",()=>setTimeout(()=>{ jbPinsRender();
  if(jbPins().length&&groupOf(S.tab||"route")==="navigate"&&Date.now()-(S.jb.at||0)>60000&&S.jb.data?.ok!==false) jbLoad(true); },0));
window.addEventListener("resize",()=>{ const W=$("jb-pins"); if(W&&!W.hidden) jbPinsPlace(W); });

// ---- A badge, opened from Jobs: the medal big, every tier with what it takes, how far along you are, and what counts
const JB_EARN={
  hauler:"Finish Cargo Hauler jobs. Hauling, cargo, freight and supply-run contracts count toward them.",
  courier:"Finish Delivery Courier jobs. Delivery, courier and package contracts count toward them.",
  bounty:"Finish Bounty Hunter jobs. Bounty contracts (wanted criminals, Bounty Hunters Guild work) count toward them.",
  mercenary:"Finish Mercenary jobs. Combat contracts (patrol, escort, defend, assault, security) count toward them.",
  salvager:"Finish Salvager jobs. Selling salvage while in a salvage ship (Vulture, Reclaimer, Fortune, Salvation, MOTH), landed or docked, counts toward them.",
  miner:"Finish Miner jobs. Selling ore while in a mining ship (Prospector, MOLE, ROC, Golem, Arrastra…), landed or docked, counts toward them.",
  refueler:"Finish Refueler jobs. Selling fuel from a Starfarer, Vulcan or MPUV Tractor counts toward them (in flight too).",
  trader:"Finish Trader jobs. Selling cargo at a terminal in any other ship, landed or docked, counts toward them."};
function jbBadgeOpen(role){ const d=S.jb.data, b=(d?.badges||[]).find(x=>x.role===role); if(!b) return;
  const T=d.badge_tiers||[], i=T.findIndex(t=>t.tier===b.tier), nx=T[i+1];
  let V=$("jbb-view"); if(!V){ V=document.createElement("div"); V.id="jbb-view"; V.className="up-back"; document.body.appendChild(V);
    V.onclick=e=>{ if(e.target===V||e.target.closest("[data-jbbx]")) V.remove();
      const go=e.target.closest("[data-jbbgo]"); if(go){ V.remove(); jbOpenRole(go.dataset.jbbgo); } }; }
  const pct=nx?Math.min(100,Math.round(b.done/nx.at*100)):100;
  V.innerHTML=`<div class="up-card jbb-card" role="dialog" aria-modal="true" aria-label="${esc(b.name)} badge"><button class="up-x" data-jbbx="1" aria-label="Close">×</button>
    <div class="jbb-hero">${jbMedal(b,"xl")}<div><div class="jb-btier t-${b.tier||"none"}">${b.tier?esc(b.tier_name):"Not earned yet"}</div><h2>${esc(b.name)}</h2>
      <div class="muted">${b.done} ${esc(b.name)} job${b.done===1?"":"s"} finished${nx?` · ${nx.at-b.done} more for ${esc(nx.name)}`:" · every tier earned"}</div>
      <div class="jb-bar" style="margin-top:10px"><i style="width:${pct}%"></i></div><div class="muted" style="font-size:12px;margin-top:4px">${nx?`${b.done} / ${nx.at} toward ${esc(nx.name)}`:`${b.done} · Diamond`}</div></div></div>
    <div class="mk-h" style="margin-top:18px">Tiers</div>
    <div class="jbb-tiers">${T.map((t,k)=>{ const got=b.done>=t.at, cur=k===i+1;
      return `<div class="jbb-tier ${got?"got":cur?"next":""}">${jbMedal({...b,tier:got?t.tier:"none",tier_name:t.name},"md")}<b class="jb-btier t-${t.tier}">${esc(t.name)}</b>
        <span>${t.at} jobs</span><small>${got?"✓ Earned":cur?`${t.at-b.done} to go`:"Locked"}</small></div>`; }).join("")}</div>
    <div class="mk-h" style="margin-top:18px">How to earn it</div>
    <div class="jbb-how"><p>${esc(JB_EARN[role]||"Finish this role's jobs.")}</p>
      <ul><li>Every finished job counts once: a daily or a weekly, whichever you finish.</li>
        <li>Each role has 3 dailies (new at 08:00 Pacific) and 5 weeklies (new Mondays), so up to 22 a week.</li>
        <li>Badges never reset, and the next tier keeps counting from the jobs you've already finished.</li>
        <li>${d.badges_shown?"Your badges show on your profile.":"Your badges are hidden from your profile right now (Show on my profile, in Jobs)."}</li></ul></div>
    <div class="row" style="gap:8px;margin-top:16px;justify-content:flex-end"><button class="btn ghost" data-jbbx="1">Close</button><button class="btn primary" data-jbbgo="${esc(role)}">See ${esc(b.name)} jobs</button></div></div>`;
  V.querySelector(".up-x").focus(); }
document.addEventListener("keydown",e=>{ if(e.key==="Escape") $("jbb-view")?.remove();
  const bd=e.target.closest?.("[data-jbbadge]"); if(bd&&(e.key==="Enter"||e.key===" ")){ e.preventDefault(); jbBadgeOpen(bd.dataset.jbbadge); } });
