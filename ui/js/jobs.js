// Quantum UI: Jobs, daily and weekly goals for every role at once (api_jobs.py, server jobs.py).
// One of several classic scripts sharing one global scope; index.html loads them in order.
//
// Every role (Cargo Hauler, Delivery Courier, Bounty Hunter, Mercenary, Salvager, Miner, Refueler, Trader) has 3 jobs a
// day and 5 a week: do any, all or none of them. New at 08:00 Pacific (weekly: Mondays); 3 swaps a day. Progress is
// counted from the aUEC balance changes Quantum sees through the game's telemetry: sent while this tab is open and
// every few minutes in the background. The list on the left only picks which role's jobs are shown.
"use strict";
S.jb=S.jb||{data:null,busy:false,at:0,view:"all"};
// The icons the rest of Quantum already uses for this work: the game's own (Components, Missions, place services)
function jbIc(k){
  const off=n=>typeof offIcon==="function"?offIcon(n):"", gi=n=>typeof gameIcon==="function"?gameIcon(n,"jb-gi"):"";
  // a picture used as a mask, so it takes the section's colour like the rest (as an <img> its shape drew black)
  const img=src=>src?`<i class="jb-img" style="-webkit-mask-image:url('${src}');mask-image:url('${src}')" aria-hidden="true"></i>`:"";
  const h={hauler:()=>off("hauler"),courier:()=>off("shipCapacity"),bounty:()=>img(typeof MI_KIND_ICON!=="undefined"&&MI_KIND_ICON.bounty),
    mercenary:()=>off("weapons"),salvager:()=>gi("salvageable"),miner:()=>off("miningLasers"),refueler:()=>gi("fuel_tanks"),
    trader:()=>typeof SVC_COMMODITY!=="undefined"?SVC_COMMODITY:""}[k];
  return `<span class="jb-ic">${(h&&h())||""}</span>`; }
const jbLeft=t=>{ const s=Math.max(0,t-Date.now()/1000), d=Math.floor(s/86400), h=Math.floor(s%86400/3600), m=Math.floor(s%3600/60); return d?`${d}d ${h}h`:h?`${h}h ${m}m`:`${m}m`; };
const jbAll=d=>(d?.roles||[]).flatMap(r=>[...r.daily,...r.weekly]);
async function jbLoad(sync){ if(S.jb.busy) return; S.jb.busy=true;
  let r; try{ r=await (sync?api().jobs_sync():api().jobs_state()); }catch(e){ r={ok:false,error:String(e)}; }
  S.jb.busy=false; S.jb.at=Date.now();
  const prev=S.jb.data; S.jb.data=r;
  if(prev?.ok&&r?.ok){ const was=new Set(jbAll(prev).filter(j=>j.done_at).map(j=>j.id));
    for(const j of jbAll(r)) if(j.done_at&&!was.has(j.id)) toast(`Job done: ${j.name} · ${j.title}`); }
  jbCount(); if(S.tab==="jobs") jbRender(); }
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
  return `<div class="jb-card ${j.done_at?"done":""}"><div class="jb-top"><span class="jb-kind">${j.kind==="daily"?"Daily":"Weekly"}</span><b class="jb-name">${esc(j.name||"")}</b>${j.done_at?`<span class="jb-ok">✓ Done</span>`:""}</div>
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
    <div class="muted" style="font-size:11.5px;line-height:1.5;margin-top:10px">All jobs for every role are calculated in total. Dailies are 1 point for each which is completed and weeklies are 3 points for each completed.</div>`;
  const head=(icon,title)=>`<div class="mkp-head" style="grid-template-columns:1fr"><div class="hd-main"><div class="hd-title"><div><h2 class="jb-h2">${icon}${esc(title)}</h2>
      <div class="sub">${d.swaps_left} of ${d.swaps_max} swaps left today · new dailies in ${jbLeft(d.daily_next)} · new weeklies in ${jbLeft(d.weekly_next)}${d.measured_at?` · progress from ${agoTs(d.measured_at)}`:""}</div></div>
      <button class="btn small ghost" data-jbsync="1" ${S.jb.busy?"disabled":""}>${S.jb.busy?"Updating…":"Update progress"}</button></div></div></div>`;
  const foot=`<div class="uex-credit" style="margin-top:18px">Progress counts the aUEC balance changes Quantum sees through the game's telemetry (Settings › Game telemetry), from 08:00 Pacific today or Monday. Each payout counts for one role at most. A contract counts by its kind of work in the game files (hauling, delivery, bounty, patrol…), never by its cargo, so hauling fuel isn't refuelling. A sale counts by the ship you sold from, landed or docked: a Prospector, MOLE or ROC is a Miner's, a Vulture or Reclaimer a Salvager's, a Starfarer a Refueler's (in flight too), anything else a Trader's. Money from a friend or a refund counts for nobody. Resets at ${esc(d.reset)}.</div>`;
  if(view==="all"){ P.innerHTML=head(typeof gameIcon==="function"?gameIcon("missions","jb-gi"):"","Jobs")+jbTelHtml()+`<div class="jb-rows">${d.roles.map(jbRow).join("")}</div>`+foot; return; }
  const r=d.roles.find(x=>x.id===view);
  P.innerHTML=head(jbIc(r.id),`${r.name} jobs`)+jbTelHtml()+`<div class="mk-h">Today</div><div class="jb-grid">${r.daily.map(j=>jbCard(j,d)).join("")}</div>
    <div class="mk-h" style="margin-top:18px">This week</div><div class="jb-grid">${r.weekly.map(j=>jbCard(j,d)).join("")}</div>`+foot; }
document.addEventListener("click",async e=>{ if(!e.target.closest("#jb-panel,#jb-side")) return;
  const v=e.target.closest("[data-jbview]"); if(v){ S.jb.view=v.dataset.jbview; return jbRender(); }
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
setTimeout(()=>jbLoad(false),6000);
