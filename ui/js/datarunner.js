// Quantum UI: The datarunner program: price reports to UEX, jobs, reports and the FAQ.
// One of several classic scripts sharing one global scope; index.html loads them in order.
"use strict";
// =================================================================== datarunner (report prices to UEX)
// Manual entry, made quick: every row starts from UEX's numbers. Most prices haven't moved, so the
// main action is one tap (or Space) on "Same"; only what changed gets typed. Keyboard: ↑↓ move,
// Space same, Enter edit, 1–7 inventory, G gone. The send bar keeps the checklist in sight.
const DR_SIZES=[1,2,4,8,16,24,32];
const plural=(n,w)=>`${n} ${w}${n===1?"":"s"}`;
const daysTxt=d=>plural(Math.round(d),"day");                      // 11 -> "11 days", 1 -> "1 day"
// long: "11 days" / "5 hours" instead of "11d" / "5h" (the Jobs list has room for it)
const drAge=(ts,long)=>{ if(!ts) return {t:"new",c:"a1",tip:"Not on UEX yet"}; const d=(Date.now()/1000-ts)/86400;
  const mins=d*1440; return {t:mins<1?"now":mins<60?(long?plural(Math.round(mins),"minute"):`${Math.round(mins)}m`):d<1?(long?plural(Math.round(d*24),"hour"):`${Math.round(d*24)}h`):(long?daysTxt(d):`${Math.round(d)}d`), c:d<1?"a0":d<3?"a1":d<7?"a2":"a3", tip:`UEX last updated ${agoTs(ts)}`}; };
const drNum=v=>{ if(v==null||v==="") return null; const m=String(v).trim().toLowerCase().replace(/,/g,"").match(/^(\d+(?:\.\d+)?)\s*([km])?$/);
  return m?Math.round(parseFloat(m[1])*({k:1e3,m:1e6}[m[2]]||1)*100)/100:NaN; };
const drFmt=v=>v==null||isNaN(v)?"":Number(v).toLocaleString();
function drShowVer(r){
  const k=`${r.game_running}|${r.game_version}|${r.env}`; if(S.drVerKey===k) return; S.drVerKey=k;
  if(S.dr?.pf) Object.assign(S.dr.pf,{game_running:r.game_running,game_version:r.game_version,env:r.env});
  $("dr-ver").className="dr-ver"+(r.game_running&&r.game_version?"":" bad");
  $("dr-ver").textContent=!r.game_running?"Star Citizen Not Running":r.game_version?`${r.game_version} ${r.env}`:"Couldn't read it from Game.log"; }
// while the Datarunner tab is open, re-check the game version every few seconds, so starting (or closing)
// Star Citizen shows up without leaving the tab and coming back
setInterval(()=>{ if(S.tab!=="datarunner"||document.hidden||S.drVerBusy) return; S.drVerBusy=true;
  api().dr_game_status().then(r=>{ if(r?.ok) drShowVer(r); }).catch(()=>{}).finally(()=>{ S.drVerBusy=false; }); },5000);
async function openDatarunner(id){
  if(!S.dr){ $("dr-panel").innerHTML=qLoader("Loading the terminal…"); drSyncInputs(); }
  const r=await api().dr_prefill(id||null);
  if(!r.ok){ $("dr-panel").innerHTML=`<div class="empty"><strong>Couldn't load UEX data</strong>${esc(r.error)}</div>`; return; }
  S.drHasSecret=r.has_secret;
  const nextView=S.drNextView; S.drNextView=null;              // opened from the profile (My Reports)
  const same=!!S.dr&&S.dr.pf?.id_terminal===r.id_terminal;
  const keepSizes=same?[...S.dr.sizes]:[];
  S.dr={pf:r, view:nextView||S.dr?.view||"enter", tab:same?S.dr.tab:(r.rows.some(x=>x.side==="buy")||!r.rows.length?"buy":"sell"),
        rows:r.rows.map(x=>({...x, state:"", orig:{price:x.price,scu:x.scu,status:x.status}})), sizes:new Set(keepSizes), focus:0};
  $("dr-mode").className="dr-mode"+(r.live?" live":""); $("dr-mode").hidden=r.live&&r.has_secret;
  $("dr-mode").innerHTML=r.live?`Add your UEX Secret Key in your profile (Linked accounts) to send reports.`
    :`<b>Test mode.</b> Reports are checked against UEX's rules and saved to a folder. Nothing is sent to UEX.
      <div class="row"><button class="btn small ghost" id="dr-folder">Open test folder</button></div>`;
  if($("dr-folder")) $("dr-folder").onclick=()=>api().dr_open_folder();
  S.drTerms=r.terminals; const cur=r.terminals.find(t=>t.id===r.id_terminal);
  $("dr-term-q").value=cur?`${cur.where} · ${cur.name}`:""; $("dr-term-q").dataset.label=$("dr-term-q").value;
  $("dr-here").textContent=r.you_are_at?(r.terminals.some(t=>t.here)?`You're at ${r.you_are_at} (from the game log).`:`You're at ${r.you_are_at}, which has no commodity terminal on UEX.`)
    :"Land or dock somewhere and the terminal there is picked for you.";
  drShowVer(r);
  renderDrStats(r.stats); renderDrPanel(); renderDrShots(); drSyncInputs();
  if(!S.drProf||Date.now()-(S.drProfAt||0)>60000) drProfLoad(false).then(p=>{ if(p?.ok&&S.dr) renderDrStats(S.dr.pf.stats); }).catch(()=>{}); }

// ---- the main panel: header with progress, kiosk-style tabs, rows, send bar
function drRowsOf(side){ return S.dr.rows.map((x,i)=>[x,i]).filter(([x])=>x.side===side); }
function renderDrPanel(){ const d=S.dr, r=d.pf, P=$("dr-panel");
  if(d.view==="mine") return renderDrMine();
  if(d.view==="jobs") return renderDrJobs();
  if(d.view==="faq") return renderDrFaq();
  if(d.view==="top") return renderDrTop();
  if(!r.id_terminal){ P.innerHTML=drViews()+drGuide(); fitDrGuide(); return; }
  const n=s=>drRowsOf(s).length;
  P.innerHTML=`${drViews()}<div class="dr-top"><div><h2>${esc(r.terminal||"")}</h2><div class="where">${esc(r.where||"")}</div></div>
      <div class="dr-meter" id="dr-meter"></div></div>
    <div class="dr-tabs"><button data-drtab="buy" class="${d.tab==="buy"?"on":""}">BUY<span>${n("buy")}</span></button><button data-drtab="sell" class="${d.tab==="sell"?"on":""}">LOCAL MARKET VALUE<span>${n("sell")}</span></button>
      <div class="dr-keys"><kbd>↑</kbd><kbd>↓</kbd> move · <kbd>Space</kbd> no changes · <kbd>Enter</kbd> edit · <kbd>1</kbd>–<kbd>7</kbd> inventory · <kbd>G</kbd> not sold here</div></div>
    <div class="dr-list" id="dr-list"></div>
    <div class="dr-send" id="dr-send"></div>`;
  renderDrList(); renderDrSend(); drAckGate(); }
function drViews(){ const d=S.dr;
  return `<div class="seg-mini dr-views"><button data-drview="enter" class="${!d.view||d.view==="enter"?"on":""}">Report Prices</button><button data-drview="jobs" class="${d.view==="jobs"?"on":""}">Jobs</button><button data-drview="mine" class="${d.view==="mine"?"on":""}">My Reports</button><button data-drview="top" class="${d.view==="top"?"on":""}">Leaderboard</button><button data-drview="faq" class="${d.view==="faq"?"on":""}">FAQ</button></div>`; }
// Shown once, before the first report: reports carry the user's UEX name, and bad ones cost them.
function drAckGate(){ if(S.dr.pf.ack) return;
  const el=drSheet(`<h3>Before you report</h3>
    <p style="margin:8px 0;line-height:1.55">Every report is sent under <b>your UEX account</b>. Only report what the kiosk shows right now, and check each price, SCU and inventory level before you send.</p>
    <p style="margin:8px 0;line-height:1.55;color:#ffb4b4">UEX reviews every report. Wrong, guessed or made-up data gets reports declined, and repeated bad reports can get your datarunner access <b>suspended</b> or your UEX account <b>terminated</b>.</p>
    <label class="row" style="gap:8px;margin:12px 0;cursor:pointer"><input type="checkbox" id="dr-ack-c"> I understand: I'll only report prices I've checked on the kiosk.</label>
    <button class="btn primary" id="dr-ack-b" disabled style="width:100%">Start reporting</button>`);
  el.classList.add("ack");
  el.querySelector("#dr-ack-c").onchange=e=>{ el.querySelector("#dr-ack-b").disabled=!e.target.checked; };
  el.querySelector("#dr-ack-b").onclick=async()=>{ await api().dr_ack(); S.dr.pf.ack=true; drSheet(null); }; }
function drStatus(x){ const e=k=>{ const a=k==="price"?drNum(x[k]):x[k]==null||x[k]===""?null:+x[k], b=x.orig[k]==null?null:+x.orig[k]; return a!==b; };
  return e("price")||e("scu")||e("status"); }
// Changed from UEX -> "edit"; typed back to exactly UEX's values -> "same" (confirmed); nothing yet -> "".
function drState(x){ if(drStatus(x)) return "edit"; return x.orig.price!=null&&x.price!=null&&x.price!==""?"same":""; }
function drRowHtml(x,i){ const d=S.dr, st=d.pf.status_names, age=drAge(x.updated), cool=d.pf.cooldown?.[`${x.id_commodity}:${x.side}`], lock=drLocked();
  const lvl=+x.status||0, p=drNum(x.price), was=x.orig.price, pv=d.pf.params?.price_variation;
  let diff=""; if(x.state==="edit"&&was!=null&&p!=null&&!isNaN(p)&&p!==was){ const pct=Math.round((p-was)/was*1000)/10, far=pv&&Math.abs(pct)>pv;
    diff=` · <s>${drFmt(was)}</s> <span class="${far?"warn":pct>0?"up":"down"}">${pct>0?"+":""}${pct}%${far?" check it":""}</span>`; }
  else if(p!=null&&isNaN(p)) diff=` · <span class="warn">not a number</span>`;
  const ro=cool?"disabled":lock?"readonly":"";
  return `<div class="dr-row ${x.state} ${cool?"cool":""} ${lock?"locked":""}" tabindex="0" data-i="${i}">
    <div class="age ${age.c}" title="${esc(x.community?"Reported by a Quantum datarunner "+agoTs(x.updated)+", awaiting UEX review":age.tip)}">${age.t}</div>
    <div class="nm"><b>${esc(x.name||"#"+x.id_commodity)}</b><div>${cool?`Sent ${Math.max(1,Math.round((300-cool)/60))} min ago, again in ${Math.ceil(cool/60)} min`:x.orig.price==null?"Not on UEX here yet":(x.community?`<span class="cm-pill">⚡ Quantum datarunner</span> `:"UEX ")+drFmt(x.orig.scu)+" SCU · "+drFmt(x.orig.price)+(x.updated?` · <span class="upd ${age.c}">updated ${agoTs(x.updated)}</span>`:"")}</div></div>
    <div class="val"><input class="field" data-k="scu" inputmode="decimal" ${ro} value="${esc(x.scu??"")}" placeholder="SCU" aria-label="${x.side==="buy"?"Stock":"Demand"} in SCU"><div class="was">${x.side==="buy"?"Stock":"Demand"}</div></div>
    <div class="val"><input class="field" data-k="price" inputmode="decimal" ${ro} value="${esc(x.price??"")}" placeholder="aUEC" aria-label="Price per SCU"><div class="was">Price per SCU${diff}</div></div>
    <div class="inv"><div class="segs l${lvl}">${[1,2,3,4,5,6,7].map(n=>`<button data-lvl="${n}" class="${n<=lvl?"f":""}" title="${n} · ${esc(st[n])}" aria-label="${esc(st[n])}"></button>`).join("")}</div><span>${lvl?esc(st[lvl]):"Inventory?"}</span></div>
    <div class="acts"><button class="ok ${x.state==="same"?"on":""}" data-act="same" title="Price, stock and inventory all match the kiosk (Space)">${x.state==="same"?"✓ No Changes":"No Changes"}</button><button class="gn ${x.state==="gone"?"on":""}" data-act="gone" title="The kiosk doesn't list this commodity any more (G). For no stock, set the inventory bar to Out of stock instead.">Not Sold Here</button></div></div>`; }
// Data can only be entered once there's a screenshot: UEX checks every report against it.
// Locked until there's a screenshot, unless UEX no longer needs one from you (or you've chosen to try
// without one after the 90-day evaluation; UEX's answer then settles it).
function drLocked(){ return !(S.drShotCount>0) && !S.drShotPol?.optional && !S.drNoShot; }
function drLockHtml(){ const k=S.drShotKey, pol=S.drShotPol||{};
  if(!drLocked()) return S.drNoShot&&!(S.drShotCount>0)&&!pol.optional?`<div class="dr-lock" style="border-style:solid">${IC_CAM} <span>Sending <b>without a screenshot</b>. If UEX still needs one from you, it'll say so and nothing is sent. <a data-drnoshot="0" style="cursor:pointer;text-decoration:underline">Take one instead</a></span></div>`:"";
  return `<div class="dr-lock" id="dr-lock">${IC_CAM} <span><b>Screenshot required before entering data.</b> Open the kiosk in game and ${k?`press <b>${esc(k)}</b>`:"use <b>Take screenshot</b> on the left"}. UEX checks every report against it.
    ${pol.can_try?`<br><span class="muted">UEX only needs screenshots during a new datarunner's first 90 days, and it's been that long since your first report.</span>
      <button class="btn small" data-drnoshot="1" style="margin-top:6px">Send without a screenshot</button>`
      :pol.refused_at?`<br><span class="muted">UEX still needed one when you last tried without. Quantum will offer to skip it again in a week.</span>`
      :pol.days_left!=null?`<br><span class="muted">New datarunners need one for their first 90 days; about ${pol.days_left} day${pol.days_left===1?"":"s"} to go.</span>`:""}</span></div>`; }
function drNeedShot(){ const el=$("dr-lock"); toast(`Take a screenshot of the kiosk first${S.drShotKey?` (press ${S.drShotKey} in game)`:""}`);
  if(el){ el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash"); el.scrollIntoView({block:"nearest"}); } }
function renderDrList(){ const d=S.dr, L=drRowsOf(d.tab), el=$("dr-list"); if(!el) return;
  el.innerHTML=drLockHtml()+(L.length?L.map(([x,i])=>drRowHtml(x,i)).join(""):`<div class="dr-empty">UEX lists nothing on this tab here. If the kiosk shows something, add it below.</div>`)
    +`<div class="dr-add"><select class="field" id="dr-add-c"><option value="">Add a commodity the kiosk shows…</option>${d.pf.commodities.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select><button class="btn" id="dr-add-b">Add</button></div>
    ${uexCredit(d.pf.at)}`;
  renderDrMeter(); }
function drRedrawRow(i,pop){ const el=$("dr-list")?.querySelector(`.dr-row[data-i="${i}"]`); if(!el||!el.isConnected) return renderDrList();
  const tmp=document.createElement("div"); tmp.innerHTML=drRowHtml(S.dr.rows[i],i); const nw=tmp.firstElementChild;
  const f=document.activeElement, k=el.contains(f)&&f.dataset?.k, pos=k?f.selectionStart:null;
  try{ el.replaceWith(nw); }catch(e){ return; }    // already replaced by a redraw from the same blur
  if(pop) nw.classList.add("pop");
  if(k){ const inp=nw.querySelector(`[data-k="${k}"]`); inp.focus(); try{ inp.setSelectionRange(pos,pos); }catch(e){} } else if(f===el) nw.focus();
  renderDrMeter(); renderDrSend(); }
function renderDrMeter(){ const L=drRowsOf(S.dr.tab), done=L.filter(([x])=>x.state).length, m=$("dr-meter"); if(!m) return;
  m.innerHTML=`<div class="lbl"><span>${S.dr.tab==="buy"?"BUY":"LOCAL MARKET VALUE"} checked</span><b>${done} of ${L.length}</b></div><div class="bar"><i style="width:${L.length?done/L.length*100:0}%"></i></div>`; }
function drReady(){ const d=S.dr; return d.rows.filter(x=>x.state); }
function renderDrSend(){ const el=$("dr-send"); if(!el||!S.dr) return; const rdy=drReady(), n=rdy.length, shots=S.drShotCount||0, d=S.dr;
  // Only "Not sold here" rows: UEX still wants a screenshot, of the kiosk's list. It's the proof the item isn't on it.
  const goneOnly=n>0&&rdy.every(x=>x.state==="gone");
  el.innerHTML=`<span class="chip y">✓ ${esc(d.pf.terminal||"Terminal")}</span>
    <span class="chip ${shots?"y":"n"}" ${shots?"":`data-act="shoot"`} title="${shots?"":goneOnly?"UEX still needs a screenshot for a Not sold here report: take one of this kiosk's list, which shows the item isn't on it":"UEX needs a screenshot of the kiosk"}">${shots?`✓ ${shots} screenshot${shots>1?"s":""}`:`${IC_CAM} Screenshot Required`}</span>
    ${n?`<span class="chip y">✓ ${n} row${n===1?"":"s"} ready</span><button class="btn primary go" id="dr-go">Submit Report</button>`:""}`; }

// ---- editing
function drCooling(i){ const x=S.dr.rows[i], c=S.dr.pf.cooldown?.[`${x.id_commodity}:${x.side}`];
  if(c) toast(`You reported ${x.name} here less than 5 minutes ago. UEX takes it again in ${Math.ceil(c/60)} min`); return !!c; }
function drSet(i,patch,pop){ if(drLocked()) return drNeedShot(); if(drCooling(i)) return; const x=S.dr.rows[i]; Object.assign(x,patch);
  if(!("state" in patch)) x.state=x.state==="gone"?"gone":drState(x);
  drRedrawRow(i,pop); }
function drToggleSame(i){ if(drLocked()) return drNeedShot(); if(drCooling(i)) return; const x=S.dr.rows[i];
  if(x.state==="same") return drSet(i,{state:""});
  if(x.orig.price==null) return toast("Nothing on UEX to match here: type what the kiosk shows");
  drSet(i,{state:"same",price:x.orig.price,scu:x.orig.scu,status:x.orig.status},true); }
function drMove(i,dir){ const rows=[...$("dr-list").querySelectorAll(".dr-row")], at=rows.findIndex(r=>+r.dataset.i===i);
  const nx=rows[Math.max(0,Math.min(rows.length-1,at+dir))]; nx?.focus(); nx?.scrollIntoView({block:"nearest"}); }
$("dr-panel").addEventListener("click",async e=>{ const d=S.dr; if(!d) return;
  const ns=e.target.closest("[data-drnoshot]"); if(ns){ S.drNoShot=ns.dataset.drnoshot==="1"; return renderDrPanel(); }
  const tab=e.target.closest("[data-drtab]"); if(tab){ d.tab=tab.dataset.drtab; return renderDrPanel(); }
  const vw=e.target.closest("[data-drview]"); if(vw){ d.view=vw.dataset.drview; return renderDrPanel(); }
  // Withdraw a station position sent by mistake (second click confirms)
  const wd=e.target.closest("[data-cbwd]"); if(wd){ const nm=wd.dataset.cbwd;
    if(S.drWd!==nm){ S.drWd=nm; renderDrPanel(); clearTimeout(S.drWdT); S.drWdT=setTimeout(()=>{ S.drWd=null; if(S.dr?.view==="mine") renderDrPanel(); },4000); return; }
    S.drWd=null; wd.disabled=true; wd.textContent="Withdrawing…"; const r=await api().withdraw_place(nm);
    if(!r.ok){ toast(r.error); return renderDrPanel(); }
    toast(`Your ${nm} reading was withdrawn and taken off your map`); S.drProf=null; S.drProfAt=0; qForget("drProf"); await loadStatic(); return renderDrPanel(); }
  const tr=e.target.closest("[data-top=refresh]"); if(tr){ tr.disabled=true; tr.textContent="Refreshing…"; return renderDrTop(true); }
  const rf=e.target.closest("[data-mine=refresh]"); if(rf){ rf.disabled=true; rf.textContent="Refreshing…"; return renderDrMine(true,true); }
  const ju=e.target.closest("[data-url]"); if(ju){ api().open_url(ju.dataset.url); return; }
  const sy=e.target.closest("[data-mysys]"); if(sy){ const r=await api().set_my_system(sy.dataset.mysys); if(!r.ok) return toast(r.error);
    await poll(); toast(`Got it: you're in ${sy.dataset.mysys}`); return renderDrJobs(); }
  const jk=e.target.closest("[data-jobkind]"); if(jk){ S.drJobKind=jk.dataset.jobkind; return renderDrJobs(); }
  if(await drMyJobClick(e)) return;
  if(await drSpecialJobClick(e)) return;
  const js=e.target.closest("[data-jobsort]"); if(js){ S.drJobSort=js.dataset.jobsort; return renderDrJobs(); }
  const jr=e.target.closest("[data-jobreport]"); if(jr){ const id=+jr.dataset.jobreport; S.dr.view="enter"; const v=S.dr.view; S.dr=null;
    await openDatarunner(id); S.dr.view=v; return renderDrPanel(); }
  const mi=e.target.closest("[data-mapinfo]"); if(mi){ S.drMapInfo=S.drMapInfo===mi.dataset.mapinfo?null:mi.dataset.mapinfo; return renderDrJobs(); }
  const sb=e.target.closest("[data-showbody]"); if(sb){ const b=sb.dataset.showbody; document.querySelector('.tab[data-tab="route"]')?.click();
    if(S.bodyMap[b]){ select({kind:"body",name:b}); focusBody(b); } else if(S.locMap[b]?.pos){ select({kind:"loc",name:b}); focusLoc(b,true); } return; }
  const mj=e.target.closest("[data-mapjob],[data-cbmap]"); if(mj){ const nm=mj.dataset.mapjob||mj.dataset.cbmap;
    // A place with no position has no card on the map: show what's known about it right here instead.
    if(!S.locMap[nm]?.pos){ S.drMapInfo=nm; return renderDrJobs(); }
    document.querySelector('.tab[data-tab="route"]').click(); focusLoc(nm,false); select({kind:"loc",name:nm}); return; }
  if(await drMapJobClick(e)) return;
  // "Doesn't exist": a second click confirms. Hidden here now; hidden for everyone once a second
  // datarunner agrees (or a trusted contributor says so).
  const nx=e.target.closest("[data-nx]"); if(nx){ const nm=nx.dataset.nx;
    if(S.drNx!==nm){ S.drNx=nm; renderDrJobs(); clearTimeout(S.drNxT); S.drNxT=setTimeout(()=>{ S.drNx=null; if(S.dr?.view==="jobs") renderDrJobs(); },4000); return; }
    S.drNx=null; if(S.drMapJob?.name===nm) S.drMapJob=null;
    await api().report_missing(nm); await loadStatic(); toast(`${nm} hidden. It's hidden for everyone once another datarunner agrees`); return renderDrJobs(); }
  if(e.target.closest("[data-unhide]")){ await api().unhide_places(); await loadStatic(); toast("Places you hid are listed again"); return renderDrJobs(); }
  if(await drPriceJobClick(e)) return;
  const pa=e.target.closest("[data-pjaccept]"); if(pa){ pa.disabled=true; pa.textContent="Accepting…";
    const jb=(S.drJobsList||[]).find(x=>String(x.id)===pa.dataset.pjaccept); const u=await drAccept(`t:${pa.dataset.pjaccept}`);
    if(u&&jb){ S.drPriceJob={id:jb.id, name:jb.name, where:jb.where, system:jb.system, place:jb.place, until:u};
      drHold(`t:${jb.id}`,{label:jb.name,sub:"Update prices",until:u,data:{...S.drPriceJob}}); toast(`Job accepted: ${jb.name} is yours for ${CLAIM_MIN} minutes`); }
    await drLoadClaims(); renderDrJobs(); $("dr-panel").querySelector(".dr-jobs")?.scrollTo({top:0,behavior:"smooth"}); return; }
  const ms=e.target.closest("[data-mjstart]"); if(ms){ const u=await drAccept(`p:${ms.dataset.mjstart}`); if(!u){ renderDrJobs(); return; }
    drMapJobStart(ms.dataset.mjstart); drHold(`p:${ms.dataset.mjstart}`,{label:ms.dataset.mjstart,sub:"Map a station",until:u}); await drLoadClaims(); renderDrJobs(); $("dr-panel").querySelector(".dr-jobs")?.scrollTo({top:0,behavior:"smooth"}); return; }
  const mh=e.target.closest("[data-maphere]"); if(mh){ mh.disabled=true; mh.textContent="Mapping…"; const r=await api().set_place_here(mh.dataset.maphere);
    if(!r.ok){ mh.disabled=false; mh.textContent="I'm here: map it"; return toast(r.error); }
    await loadStatic(); await poll(); toast(`${mh.dataset.maphere} is on your map. It goes live for everyone once a second datarunner agrees`); return renderDrJobs(); }
  const jt=e.target.closest("[data-jobroute]"); if(jt){ await api().add_stops([jt.dataset.jobroute]); await poll(); toast(`Added ${jt.dataset.jobroute} to the route`); return; }
  const rs=e.target.closest("[data-repshot]"); if(rs){ const r=await api().dr_report_shot(rs.dataset.repshot); if(!r.ok) return toast(r.error); return drShotViewer(r.src); }
  const card=e.target.closest(".dr-rep[data-k]"); if(card&&!e.target.closest("button,a")){ card.classList.toggle("open"); return; }
  if(e.target.closest('[data-act="shoot"]')) return $("dr-shoot").click();
  if(e.target.id==="dr-go") return drReview();
  if(e.target.id==="dr-add-b"){ const c=$("dr-add-c").value; if(!c) return toast("Pick a commodity to add");
    const com=d.pf.commodities.find(x=>String(x.id)===c); if(d.rows.some(x=>String(x.id_commodity)===c&&x.side===d.tab)) return toast(`${com.name} is already on this tab`);
    d.rows.push({id_commodity:com.id,name:com.name,side:d.tab,price:null,scu:null,status:null,state:"",orig:{},updated:null}); renderDrPanel();
    $("dr-list").querySelector(`.dr-row[data-i="${d.rows.length-1}"] [data-k="scu"]`)?.focus(); return; }
  if(e.target.closest(".dr-sheet")) return;
  const rowEl=e.target.closest(".dr-row[data-i]"); if(!rowEl) return; const i=+rowEl.dataset.i;
  if(drLocked()&&(e.target.closest("[data-lvl],[data-act],[data-k]"))) return drNeedShot();
  const lv=e.target.closest("[data-lvl]"); if(lv) return drSet(i,{status:+lv.dataset.lvl});
  const act=e.target.closest("[data-act]")?.dataset.act;
  if(act==="same") return drToggleSame(i);
  if(act==="gone") return drSet(i,{state:d.rows[i].state==="gone"?"":"gone"}); });
$("dr-panel").addEventListener("input",e=>{ if(e.target.id==="dr-ph-q"){ S.drPhotoQ=e.target.value; return drPhotoList(); } const k=e.target.dataset?.k, rowEl=e.target.closest(".dr-row[data-i]"); if(!k||!rowEl) return;
  const i=+rowEl.dataset.i, x=S.dr.rows[i]; x[k]=e.target.value; x.state=drState(x);
  rowEl.className=`dr-row ${x.state}`; renderDrMeter(); renderDrSend(); });
$("dr-panel").addEventListener("change",e=>{ if(e.target.id==="dr-jobs-sys"){ S.drJobSys=e.target.value; return renderDrJobs(); } const k=e.target.dataset?.k, rowEl=e.target.closest(".dr-row[data-i]"); if(!k||!rowEl) return;
  const i=+rowEl.dataset.i, v=drNum(e.target.value); if(v!=null&&!isNaN(v)) S.dr.rows[i][k]=v;   // "12k" -> 12000
  drSet(i,{}); });
$("dr-panel").addEventListener("keydown",e=>{ if(!S.dr||e.target.closest(".dr-sheet")) return; const rowEl=e.target.closest(".dr-row[data-i]"); if(!rowEl) return;
  const i=+rowEl.dataset.i, inInput=!!e.target.dataset?.k;
  if(inInput){
    if(e.key==="Enter"){ e.preventDefault(); e.target.dispatchEvent(new Event("change",{bubbles:true}));
      const row=$("dr-list").querySelector(`.dr-row[data-i="${i}"]`);
      if(e.target.dataset.k==="scu"){ const pr=row.querySelector('[data-k="price"]'); pr.focus(); pr.select(); } else { row.focus(); drMove(i,1); } }
    else if(e.key==="Escape"){ e.target.dispatchEvent(new Event("change",{bubbles:true})); $("dr-list").querySelector(`.dr-row[data-i="${i}"]`)?.focus(); }
    return; }
  const k=e.key.toLowerCase();
  if(k==="arrowdown"||k==="j"){ e.preventDefault(); drMove(i,1); }
  else if(k==="arrowup"||k==="k"){ e.preventDefault(); drMove(i,-1); }
  else if(k===" "||k==="s"){ e.preventDefault(); drToggleSame(i); const nowSame=S.dr.rows[i].state==="same"; if(nowSame) setTimeout(()=>drMove(i,1),60); }
  else if(k==="enter"||k==="e"){ e.preventDefault(); if(drLocked()) return drNeedShot(); const inp=rowEl.querySelector('[data-k="scu"]'); inp.focus(); inp.select(); }
  else if(k==="g"){ e.preventDefault(); drSet(i,{state:S.dr.rows[i].state==="gone"?"":"gone"}); }
  else if(/^[1-7]$/.test(k)){ e.preventDefault(); drSet(i,{status:+k}); } });
$("dr-panel").addEventListener("keydown",e=>{ if(drLocked()&&e.target.dataset?.k&&e.key.length===1){ e.preventDefault(); drNeedShot(); } },true);
$("dr-panel").addEventListener("focusin",e=>{ if(e.target.dataset?.k&&!drLocked()) setTimeout(()=>{ try{ e.target.select(); }catch(x){} },0); });   // typing replaces the old value

// ---- review and send (step 6 of the UEX guide: look it over once more)
function drForm(){ const d=S.dr;
  return {id_terminal:d.pf.id_terminal, details:"", container_sizes:[...d.sizes], no_screenshot:!(S.drShotCount>0),
    rows:drReady().map(x=>({id_commodity:x.id_commodity, side:x.side, price:x.state==="gone"?null:drNum(x.price), scu:x.state==="gone"?null:drNum(x.scu), status:x.status, missing:x.state==="gone", include:true}))}; }
const drName=id=>S.dr?.pf.commodities.find(c=>c.id===id)?.name||"#"+id;
function drSheet(html){ $("dr-panel").querySelector(".dr-sheet")?.remove(); if(!html) return; const el=document.createElement("div"); el.className="dr-sheet"; el.innerHTML=html; $("dr-panel").appendChild(el); return el; }
async function drReview(){ const d=S.dr, form=drForm(); if(!form.rows.length) return;
  const r=await api().dr_check(form); if(!r.ok) return toast(r.error);
  const st=d.pf.status_names, line=p=>{ const side="price_buy" in p||"scu_buy" in p||"status_buy" in p?"buy":"sell";
    return p.is_missing?`<li><b>${esc(drName(p.id_commodity))}</b>: not sold here any more</li>`
      :`<li><b>${esc(drName(p.id_commodity))}</b> · ${side==="buy"?"BUY":"LMV"} · ${p["scu_"+side]!=null?drFmt(p["scu_"+side])+" SCU":"<b style='color:#ffb4b4'>no stock</b>"} · ${p["price_"+side]!=null?money(p["price_"+side]):"<b style='color:#ffb4b4'>no price</b>"} · ${p["status_"+side]?esc(st[p["status_"+side]]):"<b style='color:#ffb4b4'>no inventory</b>"}</li>`; };
  // More than UEX's tolerance from its average: each needs its own "yes, really" before sending.
  const warns=r.warnings?.length?`<div class="warnbox" style="margin:10px 0 0;border-color:rgba(242,193,78,.6);background:rgba(242,193,78,.08);color:#f3d68c">
      <b>${r.warnings.length===1?"This price is":"These prices are"} more than ${d.pf.params?.price_variation||25}% away from UEX's average.</b> UEX flags reports like this for manual review, and a typo here is the most common reason reports get declined. Check each one on the kiosk:
      ${r.warnings.map((w,j)=>`<label class="dr-check"><input type="checkbox" class="dr-confirm"> <span>${esc(drName(w.id_commodity))}: the kiosk really shows <b>${money(w.price)}</b> (${w.off_pct>0?"+":""}${w.off_pct}% vs ${money(w.avg)})</span></label>`).join("")}</div>`:"";
  const errs=r.errors.length?`<div class="warnbox" style="margin:10px 0 0">${r.live?"Can't send this yet":"UEX would refuse this"}:<ul>${r.errors.map(e=>`<li>${esc(e.text)}</li>`).join("")}</ul></div>`:"";
  const can=!r.errors.length||!r.live;
  const el=drSheet(`<h3>Does this match the kiosk and your screenshot?</h3><div class="muted" style="font-size:12.5px">${esc(r.where||"")} · ${esc(r.terminal||"")} · ${r.shots?`${r.shots} screenshot${r.shots>1?"s":""}`:"no screenshot"} · game ${esc(r.game_version||"unknown")}</div>
    <ul>${r.prices.map(line).join("")}</ul>
    <div style="font-size:12.5px;margin-top:8px;line-height:1.5">${IC_CAM} UEX verifies every report against your screenshot. It must show <b>every item you're reporting</b>, with its stock, price and inventory. If part of the list was scrolled out of view, scroll and take another screenshot; each one goes to UEX as its own report with the items it shows.</div>
    ${r.shots?`<div class="dr-attrow"><button class="btn" id="dr-match-open">${IC_CAM} ${r.shots>1?"Match items to screenshots":"Review screenshot"}</button><span class="st" id="dr-match-state"></span></div>`:""}
    ${warns}${errs}
    ${can&&r.shots?`<label class="dr-check off" style="margin-top:12px" title="${r.shots>1?"Match your items to your screenshots first":"Open Review screenshot first"}"><input type="checkbox" class="dr-confirm" id="dr-att-ok" disabled> <span>${r.shots>1?`Each screenshot shows the items I matched to it, readable at 1920×1080. They go to UEX as <b>${r.shots} separate reports</b>.`:"I've reviewed the screenshot UEX will get, and it looks correct."}</span></label>`:""}
    ${can?`<label class="dr-check" style="margin-top:8px"><input type="checkbox" class="dr-confirm"> <span>I confirm the screenshot lists all items I've reported updates on, and that this data is correct.</span></label>`:""}
    <div class="muted" style="font-size:12px;margin-top:8px">${r.live?"This goes out under your UEX account. Wrong reports get declined, and repeated ones can get your datarunner access suspended.":"Test mode: this is saved to a folder, not sent."}</div>
    <div class="row" style="gap:8px;margin-top:12px">${can?`<button class="btn primary" id="dr-send-now" style="flex:1" disabled>${r.errors.length?"Save anyway to inspect":"Submit Report"}</button>`:""}<button class="btn ghost" id="dr-back">Back to editing</button></div>`);
  el.querySelector("#dr-back").onclick=()=>drSheet(null);
  const go=el.querySelector("#dr-send-now"), boxes=[...el.querySelectorAll(".dr-confirm")];
  boxes.forEach(b=>b.addEventListener("change",()=>{ if(go) go.disabled=!boxes.every(x=>x.checked); }));
  const att=el.querySelector("#dr-att-ok"); if(att){ att.addEventListener("change",e=>{ if(e.isTrusted) S.drMatchOk=att.checked; });
    el.querySelector("#dr-match-open").onclick=()=>drMatchView(0); drMatchSync(); }
  go?.addEventListener("click",()=>{ if(att&&!(drMatchState().done&&S.drMatchOk)){ toast(S.drShots?.length>1?"Match your items to your screenshots first":"Review the screenshot first"); return drMatchSync(); } drSave(); }); }
// Send: one report per screenshot (UEX's rule), one after another. If one fails, the ones before it
// are already at UEX: their rows are marked done and their screenshots dropped, so trying again only
// sends what's left.
async function drSave(){ const d=S.dr, b=$("dr-send-now"); b.disabled=true;
  const base=drForm(), m=drMatchState();
  const groups=m.shots.length ? m.per.map(p=>({shot_id:p.shot.id, keys:new Set(p.items.map(drKey))})) : [{shot_id:null, keys:null}];
  const done=[]; let fail=null, rows=0; S.drSending=true;
  try{ for(let i=0;i<groups.length;i++){ const g=groups[i];
      b.textContent=groups.length>1?`Sending report ${i+1} of ${groups.length}…`:"Submitting…";
      const part=g.keys?base.rows.filter(x=>g.keys.has(drKey(x))):base.rows;
      const r=await api().dr_submit({...base, rows:part, ...(g.shot_id!=null?{shot_id:g.shot_id}:{})});
      if(!r.ok){ fail={r, n:i+1}; break; }
      done.push(r); rows+=r.rows||part.length; drMarkSent(part);
      if(i<groups.length-1) await new Promise(res=>setTimeout(res,700)); }
    if(done.length){ const last=done[done.length-1];     // still "sending": sent shots leaving isn't a change to review
      d.pf.cooldown=(await api().dr_prefill(d.pf.id_terminal)).cooldown||{};
      d.pf.reports_count=(d.pf.reports_count||0)+done.length;
      if(!fail&&S.drPriceJob&&S.drPriceJob.id===d.pf.id_terminal&&!last.test){ toast(`Job done: ${S.drPriceJob.name}. Thanks, datarunner`);
        drRelease(`t:${S.drPriceJob.id}`); S.drPriceJob=null; }      // let go of the hold too, or it showed as taken for its full time
      else if(!fail&&!last.test&&S.drHeld?.[`t:${d.pf.id_terminal}`]){ toast(`Job done: ${S.drHeld[`t:${d.pf.id_terminal}`].label}. Thanks, datarunner`); drRelease(`t:${d.pf.id_terminal}`); }
      renderDrStats(last.stats); renderDrList(); renderDrSend(); await renderDrShots(); } }
  finally{ S.drSending=false; }
  if(!fail){ const r=done[done.length-1], days=done.reduce((a,x)=>a+(x.refreshed_days||0),0), n=done.length;
    drSheet(`<div class="done"><div class="tick">✓</div><div><h3>${r.test?(n>1?`${n} test reports saved`:"Test report saved"):(n>1?`${n} reports sent to UEX for review`:"Sent to UEX for review")}</h3>
      <div>${rows} row${rows===1?"":"s"} from ${esc(d.pf.terminal||"")}${n>1?`, one report per screenshot`:""}${days>=1?` · replaced <b>${Math.round(days)} days</b> of old data`:""}. Thanks, datarunner.</div>
      ${r.community?(r.community.ok?`<div style="font-size:12.5px;margin-top:4px;color:#7fe7ff">⚡ ${r.community.states?.verified?"Shared with Quantum users now":r.community.states?.test?"Shared with Quantum users in test mode":"Sent to the community server, waiting for UEX to list it"}.</div>`
        :`<div style="font-size:12.5px;margin-top:4px;color:#ffd38a">Couldn't share it with Quantum users: ${esc(r.community.error||"")}${r.community.detail?` (${esc(r.community.detail)})`:""}</div>`):""}
      ${r.test?`<div class="row" style="margin-top:8px"><button class="btn small ghost" id="dr-folder2">Open test folder</button></div>`:""}</div>
      <button class="btn ghost" id="dr-back" style="margin-left:auto">Done</button></div>`);
    $("dr-back").onclick=()=>drSheet(null); if($("dr-folder2")) $("dr-folder2").onclick=()=>api().dr_open_folder(); return; }
  const r=fail.r; b.disabled=false; b.textContent="Try again";
  if(r.status==="screenshot_required"){ S.drNoShot=false; renderDrShots().then(()=>renderDrList()); }   // UEX still wants one
  const head = done.length ? `Sent ${done.length} of ${groups.length} reports; report ${fail.n} wasn't sent`
    : r.test?"Saved for inspection, but UEX would refuse it":r.already_sent?"Already at UEX":"Not sent";
  drSheet(`<h3>${head}</h3><ul>${(r.errors||[{text:r.error||r.status}]).map(e=>`<li>${esc(e.text)}</li>`).join("")}</ul>
    ${done.length?`<div class="muted" style="font-size:12.5px">The ${done.length} sent ${done.length>1?"are":"is"} done and off your list. Fix the problem, then review and submit again to send the rest.</div>`:""}
    <div class="row" style="gap:8px;margin-top:10px"><button class="btn ghost" id="dr-back">Back to editing</button></div>`); $("dr-back").onclick=()=>drSheet(null); }
// Rows UEX has now: they become the new "UEX" values, and leave the report.
function drMarkSent(formRows){ const d=S.dr, keys=new Set(formRows.map(drKey)), now=Date.now()/1000;
  for(const x of d.rows) if(x.state&&keys.has(drKey(x))){ if(x.state!=="gone"){ x.orig={price:drNum(x.price),scu:drNum(x.scu),status:+x.status}; x.updated=now; } x.state=""; delete S.drAssign?.[drKey(x)]; } }

// ---- "My reports": everything sent, and how UEX's review is going for each
const DR_ST={pending:["Waiting for review","#8cc4ff"],under_review:["In Review","#f2c14e"],queued:["Waiting for the PTU build to go live","#a8bbd4"],
  approved:["Approved","#57e39b"],consolidated:["Live on UEX","#3ccf6e"],declined:["Rejected","#ff6b6b"],expired:["Expired before review","#6f82a0"]};
const DR_SUM={pending:"waiting for review",under_review:"in review",queued:"waiting for PTU",approved:"approved",consolidated:"live on UEX",declined:"rejected",expired:"expired"};
function drOverall(e){ if(e.test) return ["Test: not sent","#c3a6ff"]; const s=e.states||[];
  if(e.no_decision) return ["No decision from UEX","#6f82a0"];
  if(!s.length) return ["Sent, waiting for UEX","#8cc4ff"];
  for(const k of ["declined","under_review","pending","queued","expired","approved","consolidated"]) if(s.includes(k)) return DR_ST[k]; return ["Sent","#a8bbd4"]; }
// ---- A "map a station" job, step by step. The app ties your /showlocation to the job: only a reading
// taken after you press "I've arrived", in the right system (and on the right moon or planet, or out
// in space for a gateway), can be submitted, and only for that station. A /showlocation typed on the
// way there is ignored.
// What Quantum knows about a place that isn't on the map yet (it has no card there to show).
function unplacedInfoHtml(name){ const L=S.locMap?.[name]; if(!L) return `<div class="mj-info muted">Quantum only knows this place's name so far (UEX lists it).</div>`;
  const svc=L.amen?.length?`<div style="margin-top:6px"><b style="font-size:12px">Services</b><div class="muted" style="font-size:12px">${L.amen.map(esc).join(" · ")}</div></div>`:"";
  return `<div class="mj-info"><div class="kv" style="margin:0"><span class="k">System</span><span>${esc(L.system||"?")}</span>
      ${L.near||L.body?`<span class="k">Near</span><span>${esc(L.near||L.body)} <a class="lnk" data-showbody="${esc(L.near||L.body)}">show on map</a></span>`:""}
      ${L.notes?`<span class="k">Notes</span><span>${esc(L.notes)}</span>`:""}</div>${svc}
    <div style="margin-top:6px"><a class="lnk" data-url="https://starcitizen.tools/index.php?search=${encodeURIComponent(L.name)}">Look it up on the Star Citizen Wiki</a></div></div>`; }
function drMapJobStart(name){ S.drMapJob={name, at:Date.now(), state:"go"}; }
function drMapReading(L){ const pl=S.live?.player; if(!pl||pl.approx||!L) return {ok:false, why:"none"};
  const takenAt=Date.now()-pl.age*1000;
  if(!S.drMapJob.arrived||takenAt<S.drMapJob.arrived-2000) return {ok:false, why:"old"};
  if(pl.age>900) return {ok:false, why:"old"};
  if(pl.system!==L.system) return {ok:false, why:`Quantum thinks that reading is in ${pl.system}, not ${L.system}.`, sys:L.system};
  if(L.kind==="surface"&&pl.body!==L.body) return {ok:false, why:`That reading isn't on ${L.body}. Take it while you're at ${L.name}.`};
  if(L.type==="jump"&&pl.body) return {ok:false, why:`That reading is near ${pl.body}, not at the Gateway. Take it stopped right at the jump point.`};
  if(L.type==="station"&&L.kind==="space"&&L.gate_to&&pl.body) return {ok:false, why:`That reading is near ${pl.body}, not at the station. Take it while docked there.`};
  return {ok:true, age:pl.age, body:pl.body}; }
function drMapJobHtml(){ const j=S.drMapJob; if(!j) return ""; const L=S.locMap?.[j.name];
  const key=S.live?.autoloc?.loc_hotkey, game=!S.live?.game_off; let dock=L?.kind==="surface"?"land":"dock";
  if(j.state!=="sent"&&L?.pos&&!L.verify) j.state="already";
  const rd=drMapReading(L), fin=j.state==="sent"||j.state==="already";
  const stepN=fin?5:!j.arrived?2:rd.ok?4:3;
  const st=(n,title,body)=>`<li class="${stepN>n?"done":stepN===n?"now":""}"><div class="mjn">${stepN>n?"✓":n}</div><div><b>${title}</b>${stepN>=n&&body?`<div class="d">${body}</div>`:""}</div></li>`;
  const res=j.result, live=res?.shared;
  const sent=j.state==="already"?`<b style="color:#9fe0b4">${esc(j.name)} is on the map now.</b> Nothing more to do.`
    :!res||res.state==="sending"?`<span class="wait" style="display:inline-flex"><span class="spin"></span>Sending it to the Quantum server${res?.retry?` (the server is slow; try ${res.retry+1} of 3)`:""}…</span>`
    :res.state==="queued"?`<b style="color:#9fe0b4">It's on your map.</b> <span style="color:#ffd38a">The Quantum server couldn't be reached just now, so Quantum keeps it and sends it again automatically (every 10 minutes, and when Quantum starts) until it gets through.</span> No need to do it again.`
    :res.state==="error"?`<span style="color:#ffd38a">It's on your map, but the server didn't accept it (${esc(res.error||"no reason given")}).</span>`
    :live?`<b style="color:#7fe7ff">⚡ Live on Quantum.</b> ${esc(j.name)} is on every Quantum user's map${res.reporters>1?`: your reading agreed with ${res.reporters-1} other datarunner${res.reporters>2?"s":""}`:": you're a trusted contributor, so one reading is enough"}.`
    :`<b style="color:#9fe0b4">Submitted.</b> It's on your map now. It goes live for everyone once a second datarunner's reading agrees with yours (a trusted contributor's reading counts on its own). Follow it in My Reports.`;
  const jp=L?.type==="jump", what=L?.verify?"Check a position":jp?"Map a Gateway":"Map a station";
  if(jp) dock="stop";
  return `<div class="mapjob" id="dr-mapjob"><div class="hd"><div><div class="lbl">Job started · ${what}</div><h3>${esc(j.name)}</h3>
      <div class="muted" style="font-size:12.5px">${esc(TYPES[L?.type]?.one||"Station")}${L?.body?` on ${esc(L.body)}`:""} · ${esc(L?.system||"")}${L?.near?` · near ${esc(L.near)}`:""}</div></div>
      <div class="acts">${fin?`<button class="btn small" data-mj="done">Done</button>`:`${L?.pos?`<button class="btn small ghost" data-mapjob="${esc(j.name)}">Show its card</button>`:`<button class="btn small ghost" data-mapinfo="${esc(j.name)}">${S.drMapInfo===j.name?"Hide details":"Details"}</button>`}<button class="btn small ghost nx-btn" data-nx="${esc(j.name)}" title="UEX lists it, but it isn't in the game">${S.drNx===j.name?"Sure? Click again":"Doesn't exist"}</button><button class="btn small ghost" data-mj="cancel">Cancel job</button>`}</div></div>
    ${S.drMapInfo===j.name&&!L?.pos?unplacedInfoHtml(j.name):""}
    <ol class="mj-steps">
      ${st(1,"Job accepted","")}
      ${st(2,jp?`Fly to ${esc(j.name)} and stop right at the jump point`:`Go to ${esc(j.name)} and ${dock} there`,stepN===2?`${jp?"Quantum to it and stop next to the wormhole (don't fly in). ":""}Press <b>I've arrived</b> once you've ${dock==="land"?"landed":dock==="stop"?"stopped":"docked"}. Any /showlocation before that is ignored, so one typed on the way can't be used by mistake.
        <div style="margin-top:8px"><button class="btn small primary" data-mj="arrived">I've arrived</button></div>`:"")}
      ${st(3,"Type /showlocation",stepN===3?`Press <b>${esc(key||"your /showlocation key")}</b>${key?"":" (set one in Settings)"} or type <b>/showlocation</b> in game chat. Quantum is listening.
        ${!game?`<div class="warn">Star Citizen isn't running: Quantum reads the position from the game.</div>`
          :rd.ok?"":rd.why==="none"||rd.why==="old"?`<div class="wait"><span class="spin"></span>Waiting for your /showlocation…</div>`
          :`<div class="warn">${esc(rd.why)}${rd.sys?` <button class="btn small" data-mysys="${esc(rd.sys)}" title="Game.log doesn't say when you go through a wormhole. Use this if you really are in ${esc(rd.sys)}">I'm in ${esc(rd.sys)}</button>`:""}</div>`}
        <div style="margin-top:8px"><button class="btn small ghost" data-mj="notyet">I'm not there yet</button></div>`:"")}
      ${st(4,"Submit the position",stepN===4?`Got your reading${rd.body?` near ${esc(rd.body)}`:""}, ${Math.round(rd.age)} s ago. It becomes ${esc(j.name)}'s position.
        <div style="margin-top:8px"><button class="btn small primary" data-mj="submit">Submit position for ${esc(j.name)}</button></div>`:"")}
      ${st(5,"Submitted",stepN===5?sent:"")}
    </ol></div>`; }
function drMapJobPaint(){ const b=$("dr-mapjob"); if(b) b.outerHTML=drMapJobHtml(); }
async function drMapJobClick(e){ const a=e.target.closest("[data-mj]"); if(!a) return false; const j=S.drMapJob, w=a.dataset.mj;
  if(w==="cancel"||w==="done"){ if(w==="cancel"&&j) drRelease(`p:${j.name}`); S.drMapJob=null; renderDrJobs(); return true; }
  if(w==="arrived"&&j){ j.arrived=Date.now(); drMapJobPaint(); return true; }
  if(w==="notyet"&&j){ j.arrived=null; drMapJobPaint(); return true; }
  if(w==="submit"&&j){ a.disabled=true; a.textContent="Submitting…";
    const r=await api().set_place_here(j.name);
    if(!r.ok){ toast(r.error); a.disabled=false; a.textContent=`Submit position for ${j.name}`; return true; }
    j.state="sent"; j.result={state:"sending"}; drMapJobPaint(); S.drProfAt=0;
    // Up to ~90 s: the app tries the server 3 times before queueing it for later.
    for(let k=0;k<120&&S.drMapJob===j;k++){ await new Promise(r=>setTimeout(r,750)); const pr=await api().place_result(j.name);
      j.result=pr.state==="none"?j.result:pr; drMapJobPaint(); if(pr.state!=="sending"&&pr.state!=="none") break; }
    await loadStatic(); if(S.drMapJob===j) drMapJobPaint();
    drProfLoad(true).then(p=>{ if(p?.ok&&S.dr) renderDrStats(S.dr.pf.stats); }).catch(()=>{});
    return true; }
  return false; }
// ---- Accepting a price job: it's held for you for 30 minutes and other datarunners see it's in progress.
// Steps: accepted (held until…) → go there (+ Route) → "I've arrived" loads the terminal into Report
// Prices → sending the report finishes the job (the server frees it). Map-a-station jobs are held the same way.
const CLAIM_MIN=30;
function drClaimOf(job){ const c=S.drClaims?.[job]; return c&&c.until*1000>Date.now()?c:null; }
function drClaimChip(job){ const c=drClaimOf(job); if(!c||c.mine) return "";
  return `<span class="chip claim" title="Another datarunner accepted this job. It's free again if they don't finish within ${CLAIM_MIN} minutes">⏳ In progress · ${esc(c.by)} · ${Math.max(1,Math.round((c.until*1000-Date.now())/60000))} min left</span>`; }
async function drLoadClaims(){ try{ const r=await api().dr_claims(); S.drClaims=r.ok?r.claims:{}; }catch(e){ S.drClaims={}; } }
async function drAccept(job){
  const mine=drMyJobIds(); if(!mine.includes(job)&&mine.length>=DR_MAX_JOBS){ toast(`You have ${DR_MAX_JOBS} jobs on the go. Finish or let go of one first`); return null; }
  const r=await api().dr_claim(job); if(!r.ok){ toast(r.error); await drLoadClaims(); return null; }
  const u=r.until?r.until*1000:Date.now()+CLAIM_MIN*60000; if(S.drHeld?.[job]) S.drHeld[job].until=u; return u; }
function drRelease(job){ if(S.drHeld) delete S.drHeld[job]; api().dr_claim(job,true).catch(()=>{}); }
// Up to DR_MAX_JOBS jobs can be held at once. One of each kind is "open" (its steps shown); the rest wait in
// "Your jobs" until you switch to them. S.drHeld keeps what each needs to be opened again.
const DR_MAX_JOBS=5;
function drHold(id,info){ (S.drHeld=S.drHeld||{})[id]={id,...(S.drHeld?.[id]||{}),...info}; }
function drMyJobIds(){ const ids=new Set(Object.keys(S.drHeld||{}));
  for(const [k,c] of Object.entries(S.drClaims||{})) if(c.mine&&c.until*1000>Date.now()) ids.add(k);
  return [...ids]; }
// The server is the record: a job it no longer holds for you (done, or timed out) leaves the list; one it holds
// that this window doesn't know of (Quantum restarted) is added.
function drSyncHeld(){ if(!S.drClaims) return; S.drHeld=S.drHeld||{};
  const mine=Object.entries(S.drClaims).filter(([,c])=>c.mine);
  if(Object.keys(S.drClaims).length||!Object.keys(S.drHeld).length){
    for(const id of Object.keys(S.drHeld)) if(!S.drClaims[id]?.mine&&S.drHeld[id].until<Date.now()+CLAIM_MIN*60000-90000) delete S.drHeld[id]; }
  for(const [id,c] of mine){ const h=S.drHeld[id]; if(h){ h.until=c.until*1000; continue; }
    const [k,...rest]=id.split(":"), nm=k==="ph"?rest.slice(1).join(":"):rest.join(":");
    S.drHeld[id]={id,until:c.until*1000,label:k==="t"?((S.drJobsList||[]).find(x=>String(x.id)===nm)?.name||`Terminal ${nm}`):nm,
      sub:{t:"Update prices",p:"Map a station",a:"Planet alignment",ph:"Picture"}[k]||"Job"}; } }
function drIsOpen(id){ const [k,...r]=id.split(":"), v=r.join(":");
  return k==="t"?String(S.drPriceJob?.id)===v:k==="p"?S.drMapJob?.name===v:k==="a"?S.drAlignJob?.body===v:k==="ph"?S.drPhotoJob?.id===id:false; }
function drMyJobsHtml(){ drSyncHeld(); const L=Object.values(S.drHeld||{}).sort((a,b)=>a.until-b.until); if(!L.length) return "";
  if(L.length===1&&drIsOpen(L[0].id)) return "";
  return `<div class="mk-h" style="margin-top:2px">Your jobs <span class="muted" style="text-transform:none;letter-spacing:0">${L.length} of ${DR_MAX_JOBS} held</span></div>
    ${L.map(h=>{ const left=Math.max(0,Math.round((h.until-Date.now())/60000)), open=drIsOpen(h.id);
      return `<div class="dr-job ${open?"here":""}"><div class="n">${h.id.startsWith("a:")?"🪐":h.id.startsWith("ph:")?IC_PIC:h.id.startsWith("p:")?"📍":"⛁"}</div>
        <div class="age ${left>10?"a0":left>3?"a2":"a3"}" style="font-size:12px">${left} min</div>
        <div class="info"><b>${esc(h.label)}</b><div class="muted" style="font-size:12.5px;margin-top:2px">${esc(h.sub||"")}${open?" · open below":""}</div></div>
        <div class="go">${open?"":`<button class="btn small primary" data-myjob="${esc(h.id)}">Work on it</button>`}<button class="btn small ghost" data-myjobdrop="${esc(h.id)}">Let go</button></div></div>`; }).join("")}`; }
async function drMyJobClick(e){ const o=e.target.closest("[data-myjob]"), d=e.target.closest("[data-myjobdrop]"); if(!o&&!d) return false;
  const id=(o||d).dataset.myjob||(o||d).dataset.myjobdrop, h=S.drHeld?.[id], [k,...r]=id.split(":"), v=r.join(":");
  if(d){ drRelease(id); if(drIsOpen(id)){ if(k==="t") S.drPriceJob=null; else if(k==="p") S.drMapJob=null; else if(k==="a") S.drAlignJob=null; else S.drPhotoJob=null; }
    toast(`Let go of ${h?.label||"the job"}`); await drLoadClaims(); renderDrJobs(); return true; }
  const until=h?.until||Date.now()+CLAIM_MIN*60000;
  if(k==="t"){ const jb=h?.data||(S.drJobsList||[]).find(x=>String(x.id)===v); S.drPriceJob={...(jb||{id:+v,name:h?.label}),id:jb?.id??+v,until,arrived:false}; S.drJobKind="all"; }
  else if(k==="p"){ drMapJobStart(v); S.drJobKind="all"; }
  else if(k==="a"){ S.drAlignJob={body:v,until}; S.drJobKind="align"; }
  else if(k==="ph"){ S.drPhotoJob=h?.data?{...h.data,until}:{id,until,kind:r[0],name:r.slice(1).join(":"),label:h?.label||r.slice(1).join(":")}; S.drJobKind="photos"; }
  await renderDrJobs(); $("dr-panel").querySelector(".dr-jobs")?.scrollTo({top:0,behavior:"smooth"}); return true; }
function drPriceJobHtml(){ const j=S.drPriceJob; if(!j) return "";
  const left=Math.round((j.until-Date.now())/60000), over=left<=0;
  const stepN=j.arrived?3:2;
  const st=(n,title,body)=>`<li class="${stepN>n?"done":stepN===n?"now":""}"><div class="mjn">${stepN>n?"✓":n}</div><div><b>${title}</b>${stepN>=n&&body?`<div class="d">${body}</div>`:""}</div></li>`;
  return `<div class="mapjob" id="dr-pricejob"><div class="hd"><div><div class="lbl">Job accepted · Update prices</div><h3>${esc(j.name)}</h3>
      <div class="muted" style="font-size:12.5px">${esc(j.where||"")}${j.system?` · ${esc(j.system)}`:""}</div></div>
      <div class="acts"><button class="btn small ghost" data-pj="cancel">Cancel job</button></div></div>
    <ol class="mj-steps">
      ${st(1,"Job accepted",over?`<span style="color:#ffd38a">Your ${CLAIM_MIN} minutes ran out, so others can take it now.</span> <button class="btn small" data-pj="renew">Take it again</button>`
        :`Held for you until ${new Date(j.until).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})} (${left} min). Other datarunners see it's in progress. <button class="btn small ghost" data-pj="renew">Need more time</button>`)}
      ${st(2,`Go to ${esc(j.name)}`,`${j.place?`<button class="btn small" data-jobroute="${esc(j.place)}">+ Route</button> `:""}When you're at the kiosk, press <b>I've arrived</b> and Quantum opens it in Report Prices.
        <div style="margin-top:8px"><button class="btn small primary" data-pj="arrived">I've arrived</button></div>`)}
      ${st(3,"Report its prices",`Take a screenshot, check each row and submit in <b>Report Prices</b>. Sending the report finishes the job. <button class="btn small" data-pj="open">Open Report Prices</button>`)}
    </ol></div>`; }
function drPriceJobPaint(){ const b=$("dr-pricejob"); if(b) b.outerHTML=drPriceJobHtml(); }
async function drPriceJobClick(e){ const a=e.target.closest("[data-pj]"); if(!a) return false; const j=S.drPriceJob, w=a.dataset.pj; if(!j) return true;
  if(w==="cancel"){ drRelease(`t:${j.id}`); S.drPriceJob=null; await drLoadClaims(); renderDrJobs(); return true; }
  if(w==="renew"){ const u=await drAccept(`t:${j.id}`); if(u){ j.until=u; toast(`Held for you for another ${CLAIM_MIN} minutes`); } drPriceJobPaint(); return true; }
  if(w==="arrived"||w==="open"){ j.arrived=true; S.dr.view="enter"; await openDatarunner(j.id); return true; }
  return false; }
// ---- Leaderboard (top 10): the best Quantum datarunners, from the community server. Ranked like the ranks are:
// most approved reports, then star rating.
function drAv(x,cls){ const ini=esc((x.username||"?")[0].toUpperCase()), pic=x.avatar||x.avatar_url;
  return `<div class="${cls}">${pic?`<img src="${esc(pic)}" alt="" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('span'),{textContent:'${ini}'}))">`:`<span>${ini}</span>`}</div>`; }
const drRankBadge=name=>`<span class="rank-badge r${Math.max(0,DR_RANKS.findIndex(r=>r[1]===name))}">${esc(name)}</span>`;
async function renderDrTop(force){ const d=S.dr, P=$("dr-panel");
  if(!P.querySelector(".dr-top10")) P.innerHTML=`${drViews()}${qLoader("Loading the top datarunners…")}`;
  if(force||!S.drTop||Date.now()-S.drTopAt>120000){ const r=await api().dr_leaderboard(); if(r.ok){ S.drTop=r; S.drTopAt=Date.now(); } else if(!S.drTop){
    if(d.view!=="top") return; P.innerHTML=`${drViews()}<div class="warnbox" style="margin:10px 2px">${esc(r.error)}<div class="row" style="margin-top:8px"><button class="btn small" data-top="refresh">Try again</button></div></div>`; return; } }
  if(d.view!=="top") return;
  const r=S.drTop, top=r.top||[], me=r.me, you=x=>r.you&&x.username.toLowerCase()===r.you;
  const since=ts=>ts?new Date(ts*1000).toLocaleDateString([], {month:"short",year:"numeric"}):null;
  const one=top[0];
  const hero=one?`<div class="top-hero ${you(one)?"you":""}">
      <div class="crown">#1</div>${drAv(one,"av")}
      <div class="who"><div class="lbl">Top datarunner</div><h2>${one.profile?`<span class="up-name" data-upid="${esc(one.profile)}" title="View profile">${esc(one.username)}</span>`:esc(one.username)}${you(one)?` <span class="you-tag">You</span>`:""}</h2>
        <div class="rk">${drRankBadge(one.rank)} ${drStarBar(one.rated?one.stars:0,20)} <b>${one.rated?one.stars.toFixed(1):"–"}</b>${since(one.since)?`<span class="muted">Datarunner since ${since(one.since)}</span>`:""}</div></div>
      <div class="big">${[[one.approved,"Approved reports"],[one.prices,"Prices approved"],[one.terminals,"Terminals"],[one.stations,"Stations mapped"],[one.week,"This week"]]
        .map(([n,l])=>`<div><b>${(n||0).toLocaleString()}</b><span>${l}</span></div>`).join("")}</div></div>`:"";
  const row=x=>`<div class="top-row ${you(x)?"you":""} p${x.place}${x.profile?" has-prof":""}"${x.profile?` data-upid="${esc(x.profile)}" title="View ${esc(x.username)}'s profile"`:""}><div class="pl">${x.place}</div>${drAv(x,"av")}
      <div class="nm"><b${x.profile?` class="up-name" data-upid="${esc(x.profile)}" title="View ${esc(x.username)}'s profile"`:` title="${esc(x.username)} hasn't linked a Quantum account, so there's no profile to open"`}>${esc(x.username)}</b>${you(x)?` <span class="you-tag">You</span>`:""}<div>${drRankBadge(x.rank)}</div></div>
      <div class="st">${drStarBar(x.rated?x.stars:0,14)} <b>${x.rated?x.stars.toFixed(1):"–"}</b></div>
      <div class="n"><b>${x.approved.toLocaleString()}</b><span>approved</span></div><div class="n"><b>${x.sent.toLocaleString()}</b><span>sent</span></div>
      <div class="n"><b>${x.prices}</b><span>prices</span></div><div class="n"><b>${x.terminals}</b><span>terminals</span></div>
      <div class="n"><b>${x.stations}</b><span>stations</span></div><div class="n"><b>${x.week}</b><span>this week</span></div></div>`;
  P.innerHTML=`${drViews()}<div class="dr-list dr-top10"><div class="dr-top" style="margin-top:4px"><div><h2>Leaderboard</h2>
      <div class="where">Ranked by approved reports, then star rating. ${r.total?`${r.total} Quantum datarunner${r.total===1?" has":"s have"} an approved report.`:""}</div></div>
      <div style="margin-left:auto"><button class="btn small" data-top="refresh">Refresh</button></div></div>
    ${top.length?`${hero}<div class="top-list">${top.slice(1).map(row).join("")}</div>
      ${me&&me.place>10?`<div class="mk-h">Where you stand</div><div class="top-list">${row(me)}</div>`
        :!me&&r.you?`<div class="top-note">You're not on the board yet: your first approved report puts you on it. <a data-drview="jobs">Find a job</a></div>`:""}`
      :`<div class="dr-empty">No approved reports yet. The first datarunner with one takes #1. <a data-drview="jobs" style="cursor:pointer;text-decoration:underline">Find a job</a></div>`}
    <div class="uex-credit">From the Quantum server: one approved report for each price UEX approved and each approved picture, station position and planet alignment. Updated every couple of minutes.</div></div>`; }
// A new or removed secret key changes the Datarunner tab (test mode, your profile): reload it now
// rather than on the next visit.
async function drRefreshAfterKey(){ S.drProf=null; S.drTop=null; S.drTrust=null; qForget("drProf","drTrust");
  if(!S.dr) return;                                   // not opened yet: it loads fresh when you visit
  try{ await api().dr_profile(true); }catch(e){}      // read your UEX profile again with the new key
  openDatarunner(S.dr?.pf?.id_terminal||null); }
function fmtAgo(ts){ const m=Math.round((Date.now()/1000-ts)/60);
  return m<1?"just now":m<60?`${m} min ago`:m<1440?`${Math.round(m/60)} h ago`:new Date(ts*1000).toLocaleDateString([], {month:"short",day:"numeric"}); }
// ---- FAQ: how stars, ranks and jobs work (the same rules the Quantum server uses)
const DR_RANKS=[[0,"Unranked"],[1,"Trainee"],[50,"Runner"],[250,"Field Analyst"],[750,"Trade Analyst"],[2000,"Quantum Analyst"]];
// What counts as one approved report toward your rank (the server sends your own counts with your profile)
const DR_KINDS={price:"Price UEX approved (each item on a kiosk report has its own UEX #)",place:"Station position that's live on Quantum",
  alignment:"Planet, moon or station alignment that another datarunner's agrees with",photo:"Approved picture"};
async function renderDrFaq(){ const d=S.dr, P=$("dr-panel");
  if(!P.querySelector(".dr-faq")) P.innerHTML=`${drViews()}${qLoader("Loading your rating…")}`;
  let p=S.drProf; if(!p){ try{ p=await drProfLoad(false); }catch(e){ p=null; } }
  try{ await drTrustLoad(false); }catch(e){}
  if(d.view!=="faq") return;
  const ranks=p?.ranks||DR_RANKS, dec=p?.ok?drDecided(p):null, nx=p?.rank?.next;
  const you=p?.ok&&p.username?`<div class="faq-you">${drStarBar(p.rated?p.stars:0,22)}<div><b>${p.rated?p.stars.toFixed(1):"Unrated"}</b> <span class="muted">${esc(p.rank.name)}</span>
      <div class="muted" style="font-size:.9em">${p.rated?`${dec.approved} Approved, ${dec.rejected} Rejected`:"No approved reports yet"} · ${plural(p.accepted,"approved report")}${nx?` · ${nx.at-p.rank.count} more to ${esc(nx.name)}`:""}</div></div></div>`:"";
  const ladder=`<div class="faq-ranks">${ranks.slice(1).map((r,i)=>`<div class="${p?.rank?.name===r[1]?"on":""}"><b>${esc(r[1])}</b><span>${r[0]}${i===ranks.length-2?"+":"–"+(ranks[i+2][0]-1)} approved</span></div>`).join("")}</div>`;
  const qa=[
    ["What is datarunning?",`<p>Datarunners keep trade data fresh for everyone. You go to a kiosk in game, report what it shows, and once UEX approves it every trader on UEX and Quantum sees the new prices. Quantum also lets you fill in what the map and the item pages are missing: station positions, planet alignments and pictures.</p>
      <p>You need a free UEX account with datarunner turned on, your UEX Bearer Token and your UEX Secret Key (both in your profile, under Linked accounts).</p>`],
    ["How do ranks work?",`<p>Your rank goes by how many reports have been approved. Each of these counts as <b>one</b>:</p>
      <ul>${Object.entries(DR_KINDS).map(([k,t])=>`<li>${t}${p?.approved_by?.[k]?` <span class="muted">(you: ${p.approved_by[k]})</span>`:""}</li>`).join("")}</ul>
      <p>So a kiosk report with 14 items that UEX approves is 14 approved reports, even though Quantum shows it as one card in My Reports. A rejected item doesn't count, and it lowers your stars.</p>${ladder}`],
    ["How is my star rating worked out?",`<p>Every price row, picture, station position and planet alignment you send counts once it's decided:</p>
      <ul><li><b>Approved</b> (or Live on UEX, or Live on Quantum) counts as <b>5 stars</b>.</li><li><b>Rejected</b> counts as <b>1 star</b>.</li></ul>
      <p>Your rating is the average of all of them. For example, 9 approved and 1 rejected: (9 × 5 + 1 × 1) ÷ 10 = <b>4.6 stars</b>.</p>`],
    ["What doesn't count toward my stars?",`<p>Anything that hasn't been decided yet: rows waiting for review or in review, rows that expired before anyone reviewed them, reports with no decision after 14 days (Quantum stops asking about those), and stations or alignments still waiting for a second datarunner.</p>`],
    ["Why does it say Unrated?",`<p>You start unrated. Your first approved report sets you to 5.0 stars, and from then on approved ones keep it up and rejected ones bring it down.</p>`],
    ["What are Jobs?",`<p>Jobs are the things that help every trader most right now. Accept one and it's held for you for ${CLAIM_MIN} minutes, so other datarunners don't go to the same place.</p>
      <ul><li><b>Update prices:</b> terminals whose prices are the oldest. Go there, screenshot the kiosk and send what it shows. Every item UEX approves counts.</li>
      <li><b>Map stations:</b> stations UEX lists that aren't on the map yet. Fly there, type /showlocation in game chat and press <b>I'm here: set position</b>. It counts once a second datarunner's reading agrees.</li>
      <li><b>Alignment:</b> planets and moons that haven't been lined up for this game version: land at any known place on it (a city, outpost or landing zone) and type /showlocation; Quantum lines it up and sends it. Gateways and stations nobody has confirmed in game are listed here too: dock there and send a /showlocation. Each counts once another datarunner's reading matches yours.</li>
      <li><b>Pictures:</b> ships, vehicles, components and commodities that have no picture. Accept the job and send a clear in-game screenshot of it. It counts once it's approved.</li></ul>`],
    ["Why line planets up again after a game update?",`<p>Each game update can shift where a planet's surface is turned, so the map puts you and every outpost slightly off. Alignments are kept per game build: the first two datarunners whose alignments of a planet agree after an update fix it for every Quantum user, and both get the approved report.</p>`],
    ["What makes a good picture?",`<ul><li>Your own in-game screenshot of the item itself, clear and well lit, with no HUD, chat or other players' names in the way.</li><li>One item per picture, filling most of the frame.</li><li>No pictures from other websites, renders or edited images.</li></ul><p>Pictures are reviewed before they go live (trusted contributors' go live straight away for items with no picture yet).</p>`],
    ["What's the difference between Approval and stars?",`<p><b>Approval</b> is the share of your decided price rows that UEX approved, worked out from this PC's report log. <b>Stars</b> also include your pictures, station positions and alignments, and are kept on the Quantum server.</p>`],
    ["How do I become a trusted contributor?",drTrustHtml(drTrustNow())],
    ["What do Live on UEX and Live on Quantum mean?",`<p><b>Live on UEX:</b> UEX has merged your prices into its own data. <b>Live on Quantum:</b> every Quantum user sees it now: your picture is the one shown for that item, your station is on everyone's map, or your alignment is used for that planet. Price reports also show for Quantum users within seconds of UEX listing them, for up to 72 hours or until UEX's own data is newer.</p>`],
    ["Why would a report get rejected?",`<p>When UEX or the Quantum reviewer gives a reason, it's shown under the rejected item in My Reports.</p><ul><li>A price, SCU or inventory level that doesn't match the kiosk.</li><li>A screenshot that doesn't show every item you reported.</li>
      <li>A typo: prices more than 25% from UEX's average are held for a person to check.</li><li>Guessed or copied data, or a picture that isn't your own screenshot.</li><li>A station position or alignment taken somewhere other than where it says.</li></ul><p>Repeated rejections can get your UEX datarunner access suspended, and Quantum can stop sharing your reports.</p>`],
    ["I sent a station position by mistake. Can I take it back?",`<p>Yes, while it's still waiting for a second reading: press <b>Withdraw</b> on it in My Reports. A withdrawn reading doesn't count as a rejection.</p>`],
    ["A place in the list doesn't exist in the game. What do I do?",`<p>Press <b>Doesn't exist</b> on its job. It's hidden for you straight away, and for everyone once another datarunner agrees.</p>`],
    ["Can I report the same thing again?",`<p>Yes, once the kiosk changes. The same item at the same terminal can be reported once every 5 minutes.</p>`],
    ["Where is my profile kept?",`<p>On the Quantum server, under your UEX username, so it survives reinstalling Quantum or moving to a new PC. A price report only counts after UEX's own record shows your username sent it, so nobody can add to or take from your profile.</p>`]];
  P.innerHTML=`${drViews()}<div class="dr-list dr-faq"><div class="dr-top" style="margin-top:4px"><div><h2>FAQ</h2><div class="where">How star ratings, ranks and jobs work.</div></div></div>${you}
    ${qa.map(([q,a])=>`<details><summary>${q}</summary><div class="a">${a}</div></details>`).join("")}</div>`;
  fitDrGuide(); }
// Your trust status: the /v1/trust answer when it came back, else the same checklist the server already sent
// with your profile (/v1/profile carries trust_info too), so one slow request never blanks the progress box.
function drTrustNow(){ const T=S.drTrust, pt=S.drProf?.trust;
  if(T?.ok&&T.info) return T;
  if(pt?.checks) return {ok:true,trusted:!!pt.trusted,signed_in:T?.ok?T.signed_in:null,has_secret:S.drHasSecret,
    sign_in_status:T?.sign_in_status,info:pt,from:"profile"};
  return T; }
// Trusted contributors: what it gives, the criteria (the server's), and this datarunner's progress.
function drTrustHtml(t){ const i=t?.info, c=i?.checks;
  const line=(ok,txt)=>`<li class="${ok?"ok":""}"><span>${ok?"✓":"○"}</span> ${txt}</li>`;
  const prog=c?`<ul class="trust-checks">
      ${line(c.reports.ok,`<b>${c.reports.need} approved price reports</b> (you have ${c.reports.have})`)}
      ${line(c.days.ok,`<b>${c.days.need} days</b> since your first approved report (${c.days.have} so far)`)}
      ${line(c.clean.ok,`<b>No rejections</b> in the last ${c.clean.days} days${c.clean.have?` (you have ${c.clean.have})`:""}`)}
      ${line(c.approval.ok,`<b>${c.approval.need}% approval</b> or better on price rows${c.approval.have!=null?` (yours: ${c.approval.have}%)`:""}`)}</ul>`:"";
  const state=!t?"":!t.ok?`<p class="muted">Couldn't check your progress with the Quantum server just now.</p>`
    :i?.revoked?`<p><b>Trust was turned off for your account</b> by the server owner.</p>`
    :t.trusted?`<p style="color:#9fe0b4"><b>✓ You're a trusted contributor</b>${i?.owner?" (server owner)":""}.</p>`
    :i?.trusted&&t.signed_in===false?`<p style="color:#ffd38a"><b>Your account is trusted, but this PC isn't signed in to the Quantum server.</b> ${t.has_secret?(t.sign_in_status==="invalid_secret_key"?"UEX didn't accept your secret key: copy it again from your UEX profile into Settings.":"Quantum signs in with your UEX secret key; check your connection and try again in a minute."):"Add your UEX secret key in Settings and Quantum signs in by itself."}</p>`
    :`<p>You're not a trusted contributor yet. Your progress:</p>`;
  return `<p>Trusted contributors' pictures go live straight away (for things with no picture yet, up to 10 a day), and the stations they map go on everyone's map from their reading alone, without waiting for a second datarunner.</p>
    ${state}${t?.trusted?"":prog}
    <p>It's automatic: meet all of these and you're trusted, and it's checked continuously, so a rejection takes it away until you're clean again. Replacing a picture that's already live always goes to review.</p>
    <p class="muted" style="font-size:.95em">Only you count as you: Quantum signs in to the Quantum server with your UEX secret key, and the server asks UEX whose key it is, then forgets it. Every PC with your secret key in Settings signs in by itself, so a new PC or a reinstall just works.</p>`; }
// The step-by-step guide fits the panel instead of scrolling: its text is scaled down until it fits.
// Fitted again whenever the panel or anything in the guide changes size, so the app's fonts loading
// after the first fit (they're bigger than the fallback) can't push it into a scroll bar.
function fitDrGuide(){ fitDrPanel(".dr-guide"); fitDrPanel(".dr-faq"); }
function fitDrPanel(sel){ const g=$("dr-panel").querySelector(sel); if(!g) return;
  if(!g._fitObs&&window.ResizeObserver){ g._fitObs=new ResizeObserver(()=>{ cancelAnimationFrame(S.drFitRaf); S.drFitRaf=requestAnimationFrame(fitDrGuide); });
    g._fitObs.observe(g); for(const c of g.children) g._fitObs.observe(c); }
  if(!g.clientHeight) return;
  const fits=()=>g.scrollHeight<=g.clientHeight+1;
  g.style.fontSize=""; g.classList.remove("tight"); const max=parseFloat(getComputedStyle(g).fontSize);
  if(fits()) return;
  let lo=8, hi=max;
  for(let k=0;k<10;k++){ const mid=(lo+hi)/2; g.style.fontSize=mid+"px"; if(fits()) lo=mid; else hi=mid; }
  g.style.fontSize=lo+"px"; if(!fits()) g.classList.add("tight"); }        // a very small window: scroll after all
window.addEventListener("resize",()=>{ clearTimeout(S.drFitT); S.drFitT=setTimeout(fitDrGuide,60); });
document.fonts?.ready?.then(()=>fitDrGuide());
// Terminal and screenshot come first: no screenshot without the game and a terminal.
function drSyncInputs(){ const term=!!S.dr?.pf?.id_terminal, game=!S.live?.game_off, b=$("dr-shoot");
  if(!S.drWaiting){ b.disabled=!term||!game;
    b.title=!game?"Start Star Citizen first: the screenshot is taken from the game window":!term?"Pick the terminal first, above":""; }
  const h=$("dr-shot-hint"); if(h&&(!term||!game)) h.textContent=!game?"Start Star Citizen and open the kiosk to take a screenshot.":"Pick the terminal above, then take a screenshot of its kiosk."; }
// ---- With no terminal picked: how reporting works, step by step
function drGuide(){ const k=S.drShotKey||S.dr?.pf?.shot_hotkey||S.live?.autoloc?.shot_hotkey;
  const steps=[
    ["Go to a commodity kiosk","Any terminal that buys or sells cargo. Not sure where? <a data-drview=\"jobs\" style=\"cursor:pointer;text-decoration:underline\">Jobs</a> lists the ones with the oldest prices."],
    ["Pick the terminal","Land or dock and Quantum picks it from the game log. Or type it in the Terminal Search Bar. For example: “New Babbage”. Its commodities load with UEX and Quantum data."],
    ["Take a screenshot",`Open the kiosk's list in game and press ${k?`<b>${esc(k)}</b>`:"your screenshot key (set it in Settings)"}, or use Take screenshot on the left. It must clearly show a direct view of the item(s) you report; for a long list, scroll the list down and take another screenshot. Quantum will automatically have all pictures viewable for you to assign which item each screenshot contains.`],
    ["Data entry","At the kiosk verify and/or update the data in the list."],
    ["Submit Report","Confirm all data entered is correct and that the screenshot is clear and shows any and all items being reported on. Once confirmed, select that you have reviewed and confirm and submit the report. It goes to UEX under your account and shows up for Quantum users straight away."],
    ["Follow it in My Reports",`See when UEX approves it, climb the ranks and keep your star rating up. <a data-drview="faq" style="cursor:pointer;text-decoration:underline">How ratings work</a>`]];
  return `<div class="dr-guide">
    <h2>Report Prices, step by step</h2>
    <div class="muted" style="margin:-4px 0 14px;font-size:13px">Every report keeps trade data fresh for everyone on UEX and Quantum.</div>
    <ol>${steps.map(([t,d],i)=>`<li><span class="n">${i+1}</span><div><b>${t}</b><div>${d}</div></div></li>`).join("")}</ol>
    <div class="tips"><b>Please note</b>
      <ul><li>Only report what the kiosk shows right now: never guess.</li>
        <li>Double-check prices! If there is more than a 25% variance from existing values from UEX's average; they may be held for manual review by both Quantum and UEX.</li>
        <li>False and innaccurate reports can result in losing your trusted status, suspensions, or permanent bans.</li>
        <li>You can report the same item at the same terminal once every 5 minutes.</li></ul></div>
    <div class="row" style="gap:8px;margin-top:16px"><button class="btn primary" data-drview="jobs">Find a terminal to update</button><button class="btn" data-drview="mine">My Reports</button></div></div>`; }

// One line on how old a terminal's prices are: reported prices by their real age, never-reported ones apart
function jobAgeTxt(j){ const k=j.rows-j.never, sk=j.stale-j.never, out=[];
  if(k===1) out.push(`1 price, ${daysTxt(j.avg)} old`);
  else if(k>1){ out.push(`${sk} of ${k} prices over 3 days old`); if(j.oldest!=null) out.push(`oldest ${daysTxt(j.oldest)}`);
    out.push(`<span style="color:#9fe0b4" title="The average age of this terminal's reported prices on UEX">average ${daysTxt(j.avg)}</span>`); }
  if(j.never) out.push(`<span style="color:#ffd38a">${k?`${j.never} never reported`:`${plural(j.never,"price")}, none ever reported`}</span>`);
  return out.join(" · "); }
function drFreshReading(L){ const pl=S.live?.player; return L.placeable&&pl&&!pl.approx&&pl.age<900&&pl.system===L.system&&(L.kind==="surface"?pl.body===L.body:(L.type!=="jump"||!pl.body)); }
function drMapCard(L){ const reading=drFreshReading;
  if(L.fix_pending&&!L.placeable) return `<div class="dr-job map ${reading(L)?"here":""}"><div class="n">📍</div><div class="age a2" title="Reported in the wrong spot">!</div>
      <div class="info"><b>${esc(L.name)}</b>${reading(L)?` <span class="chip y" style="margin-left:6px">● Fresh /showlocation</span>`:""}
        <div class="muted" style="font-size:12.5px;margin-top:2px">${esc(TYPES[L.type]?.one||"Place")}${L.body?` on ${esc(L.body)}`:""} · ${esc(L.system)}</div>
        <div style="font-size:12.5px;margin-top:4px;color:var(--ink-2)">${plural(L.fix_pending,"datarunner")} reported it's in the wrong spot on the map. Go there, type /showlocation, open it on the map and use <b>Wrong spot on the map?</b> to send yours. <span style="color:#7fe7ff">The new spot goes live once your reading agrees.</span></div></div>
      <div class="go"><button class="btn small ghost" data-jobroute="${esc(L.name)}" title="Add it to your route">+ Route</button></div></div>`;
  return `<div class="dr-job map ${reading(L)?"here":""}"><div class="n">📍</div><div class="age a3" title="${L.pos?"Position not confirmed in game yet":"No position for this station yet"}">?</div>
      <div class="info"><b>${esc(L.name)}</b>${reading(L)?` <span class="chip y" style="margin-left:6px">● Fresh /showlocation</span>`:""}${drClaimChip(`p:${L.name}`)}
        <div class="muted" style="font-size:12.5px;margin-top:2px">${esc(TYPES[L.type]?.one||"Station")}${L.body?` on ${esc(L.body)}`:""} · ${esc(L.system)}${L.near?` · near ${esc(L.near)}`:""}</div>
        <div style="font-size:12.5px;margin-top:4px;color:var(--ink-2)">${L.pos?`On the map from ${L.type==="jump"?"game-file":"older"} data, but nobody has confirmed it in game. ${L.type==="jump"?"Stop at the jump point":"Dock there"} and send a /showlocation.`:"Not on the map yet."} Accept the job and Quantum walks you through it. <span style="color:#7fe7ff">Goes live on Quantum once a second datarunner agrees.</span></div></div>
      <div class="go"><button class="btn small ghost" data-url="https://starcitizen.tools/index.php?search=${encodeURIComponent(L.name)}" title="Look it up on the Star Citizen Wiki">Info</button>
        <button class="btn small ghost nx-btn" data-nx="${esc(L.name)}" title="UEX lists it, but it isn't in the game">${S.drNx===L.name?"Sure? Click again":"Doesn't exist"}</button>${
        S.drMapJob?.name===L.name?`<span class="chip y">Your job</span>`
        :drClaimOf(`p:${L.name}`)?`<span class="chip" title="Another datarunner accepted it">Taken</span>`
        :L.placeable?`<button class="btn small primary" data-mjstart="${esc(L.name)}" title="Hold it for ${CLAIM_MIN} minutes; Quantum walks you through it">Accept job</button>`
        :`<button class="btn small" data-mapinfo="${esc(L.name)}" title="What Quantum knows about it so far">${S.drMapInfo===L.name?"Hide details":"Details"}</button>`}</div>
      ${S.drMapInfo===L.name?`<div style="grid-column:1/-1">${unplacedInfoHtml(L.name)}</div>`:""}</div>`; }
// ---- Jobs: terminals with the most out-of-date prices, as things to go and do
async function renderDrJobs(){ const d=S.dr, P=$("dr-panel");
  if(S.drJobKind==="align") return renderDrAlignJobs();
  if(S.drJobKind==="photos") return renderDrPhotoJobs();
  if(!P.querySelector(".dr-jobs")||P.querySelector(".dr-jobs.special")) P.innerHTML=`${drViews()}${qLoader("Finding the stalest terminals…")}`;
  const sort=S.drJobSort||"oldest";
  const [r]=await Promise.all([api().dr_jobs(S.drJobSys===undefined?null:S.drJobSys||null, sort), drLoadClaims()]); if(d.view!=="jobs") return;
  if(!r.ok){ P.innerHTML=`${drViews()}<div class="warnbox" style="margin:10px 2px">${esc(r.error)}</div>`; return; }
  if(S.drJobSys===undefined&&r.you_in){ S.drJobSys=r.you_in; return renderDrJobs(); }      // start with the system you're in
  S.drJobsList=r.jobs;
  const card=(j,i)=>{ const a=j.median!=null?drAge(Date.now()/1000-j.median*86400,true):{t:"never",c:"a3"};
    return `<div class="dr-job ${j.here?"here":""}">
      <div class="n">${i+1}</div>
      <div class="age ${a.c}" title="Half this terminal's prices are older than this">${a.t}</div>
      <div class="info"><b>${esc(j.name)}</b>${j.here?` <span class="chip y" style="margin-left:6px">● You're here</span>`:""}${drClaimChip(`t:${j.id}`)}${j.mine?` <span class="chip" style="margin-left:6px">You reported it ${esc(agoTs(j.mine))}</span>`:""}
        <div class="muted" style="font-size:12.5px;margin-top:2px">${esc(j.where||"")}${j.system?` · ${esc(j.system)}`:""}${j.dist!=null?` · ${fmtDist(j.dist)} away`:""}</div>
        <div style="font-size:12.5px;margin-top:4px;color:var(--ink-2)">${jobAgeTxt(j)}</div></div>
      <div class="go">${j.place&&S.locMap[j.place]?.unplaced?`<button class="btn small ghost" data-mapjob="${esc(j.place)}" title="${esc(j.place)} isn't on the map yet: map it while you're there">Map it too</button>`
        :j.place?`<button class="btn small ghost" data-jobroute="${esc(j.place)}" title="Add it to your route">+ Route</button>`:""}${
        S.drPriceJob?.id===j.id?`<span class="chip y">Your job</span>`
        :drClaimOf(`t:${j.id}`)?`<button class="btn small ghost" data-jobreport="${j.id}" title="Someone accepted it, but you can still report it if you're there">Report anyway</button>`
        :`<button class="btn small ghost" data-jobreport="${j.id}" title="Already there? Report it straight away">Report it</button><button class="btn small primary" data-pjaccept="${j.id}" title="Hold it for ${CLAIM_MIN} minutes so others know you're on it">Accept job</button>`}</div></div>`; };
  // Stations Quantum can't place yet: go there, /showlocation, and they go on everyone's map.
  // Jobs come in two kinds: mapping stations and updating prices. Once every station is mapped the
  // selector and the "Map a station" list go away and only price jobs are left.
  const unmapped=drUnmappedN(), kind=!unmapped&&S.drJobKind==="map"?"all":(S.drJobKind||"all");
  const checkJobs=drCheckJobs(S.drJobSys);
  const mapJobs=(S.locs||[]).filter(L=>!L.pos&&(!S.drJobSys||L.system===S.drJobSys))
    .sort((a,b)=>(a.system!==S.system)-(b.system!==S.system)||(b.type==="jump")-(a.type==="jump")||a.name.localeCompare(b.name));
  const mapCard=drMapCard;
  P.innerHTML=`${drViews()}<div class="dr-top"><div><h2>Jobs</h2><div class="where">Stations missing from the map and terminals with the oldest prices. Each one you do helps every trader on UEX and Quantum.</div></div>
      <div style="margin-left:auto;display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end">
        ${drJobTabs(kind,unmapped)}
        <select class="field" id="dr-jobs-sys"><option value="">All systems</option>${r.systems.map(x=>`<option ${x===S.drJobSys?"selected":""}>${esc(x)}</option>`).join("")}</select>
        <div class="seg-mini"><button data-jobsort="oldest" class="${sort==="oldest"?"on":""}">Oldest data</button><button data-jobsort="nearest" class="${sort==="nearest"?"on":""}">Nearest</button></div></div></div>
    <div class="dr-list dr-jobs">${drMyJobsHtml()}${drPriceJobHtml()}${drMapJobHtml()}${kind==="all"?drAlignGuide()+drPhotoBanner():""}${kind!=="prices"?(mapJobs.length?`<div class="mk-h" style="margin-top:2px">Map a station <span class="muted" style="text-transform:none;letter-spacing:0">${mapJobs.length} not on the map yet</span></div>${mapJobs.map(mapCard).join("")}`+(checkJobs.length?`<div class="mk-h" style="margin-top:10px">Check a position <span class="muted" style="text-transform:none;letter-spacing:0">${checkJobs.length} Gateway${checkJobs.length===1?"":"s"} and stations nobody has confirmed in game</span></div>${checkJobs.map(mapCard).join("")}`:"")
        :checkJobs.length?`<div class="mk-h" style="margin-top:2px">Check a position <span class="muted" style="text-transform:none;letter-spacing:0">${checkJobs.length} Gateway${checkJobs.length===1?"":"s"} and stations nobody has confirmed in game</span></div>${checkJobs.map(mapCard).join("")}`
        :kind==="map"?`<div class="dr-empty">Every station${S.drJobSys?` in ${esc(S.drJobSys)}`:""} is on the map.</div>`:""):""}
      ${kind==="all"?`<div id="dr-all-extra"></div>`:""}
      ${kind!=="map"?`${kind==="all"?`<div class="mk-h">Update prices <span class="muted" style="text-transform:none;letter-spacing:0">stalest terminals first</span></div>`:""}
      ${r.jobs.length?r.jobs.map(card).join(""):`<div class="dr-empty">No commodity terminals here.</div>`}
      ${r.reported?`<div class="muted" style="font-size:12px;margin:4px 2px 8px">✓ ${plural(r.reported,"terminal")} you reported in the last day ${r.reported===1?"is":"are"} left out of your list while UEX reviews ${r.reported===1?"it":"them"}.</div>`:""}`:""}${uexCredit(r.at)}
      <div class="muted" style="font-size:12px;margin:6px 2px 10px">Hid a place by mistake? <a data-unhide="1" style="cursor:pointer;text-decoration:underline">Show the places you hid again</a></div></div>`;
  if(kind==="all") drAllExtras(); }

// All jobs: a few of the planet alignments and pictures still to do (their own tabs list them all).
// Fetched at most once a minute (the list re-renders often); a job taken or done clears it.
async function drAllExtras(){ if(!S.drExtra||Date.now()-S.drExtra.at>60000)
    S.drExtra={at:Date.now(), p:Promise.all([api().dr_align_jobs().catch(()=>null), api().dr_photo_jobs(false).catch(()=>null)])};
  const [a,p]=await S.drExtra.p;
  drJobCounts(a,p); const box=$("dr-all-extra"); if(!box||S.dr?.view!=="jobs") return;
  if(p?.ok) S.drPhotoJobs=p.jobs;
  const sys=S.drJobSys||"", rank={waiting:0,open:1}, SHOW=3, h=t=>`<span class="muted" style="text-transform:none;letter-spacing:0">${t}</span>`;
  const al=a?.ok?a.jobs.filter(j=>(j.status==="open"||j.status==="waiting")&&(!sys||j.system===sys))
    .sort((x,y)=>(x.system!==S.system)-(y.system!==S.system)||rank[x.status]-rank[y.status]||x.body.localeCompare(y.body)):[];
  const mine=drPhotoMine(), ph=(p?.ok?p.jobs:[]).filter(j=>!drPhotoYou(j,mine));
  const more=(k,n)=>n>SHOW?`<button class="btn small ghost" data-jobkind="${k}" style="margin:0 2px 12px">See all ${n}</button>`:"";
  box.innerHTML=(al.length?`<div class="mk-h">Alignment ${h(`${al.length} to line up for ${gameVerTxt(a)}`)}</div>${al.slice(0,SHOW).map(ajCard).join("")}${more("align",al.length)}`:"")
    +(ph.length?`<div class="mk-h">Pictures ${h(`${plural(ph.length,"thing")} with no picture yet`)}</div>${ph.slice(0,SHOW).map(j=>pjCard(j,mine)).join("")}${more("photos",ph.length)}`:""); }

// How many jobs of each kind there are, so a tab with none hides itself (and comes back when there are).
function drJobCounts(a,p){ const n=S.drJobN=S.drJobN||{};
  if(a?.ok) n.align=a.jobs.filter(j=>j.status==="open"||j.status==="waiting").length;
  if(p?.ok){ n.photos=p.jobs.length; n.photoKinds=p.counts||{}; }
  const t=$("dr-job-tabs"); if(t) t.outerHTML=drJobTabs(t.dataset.kind,drUnmappedN()); }

// Stations with no position, or a position nobody has confirmed in game: the Map stations tab lists both,
// so every place that redraws the tabs has to count them the same way (it used to drop the tab when only
// unconfirmed ones were left, the moment All jobs redrew the tabs).
function drUnmappedN(){ return (S.locs||[]).filter(L=>!L.pos||(L.verify&&L.placeable)).length; }
// Gateways and stations on the map from game files or older data that nobody has confirmed in game.
// They're alignment jobs too (lining a station up, like a planet), so the Alignment tab lists them.
function drCheckJobs(sys){ return (S.locs||[]).filter(L=>L.pos&&((L.verify&&L.placeable)||L.fix_pending)&&(!sys||L.system===sys))
  .sort((a,b)=>(a.system!==S.system)-(b.system!==S.system)||(b.type==="jump")-(a.type==="jump")||a.name.localeCompare(b.name)); }
// "4.10.2 LIVE" rather than the raw build number from Game.log (kept in the tooltip).
function gameVerTxt(r,cap){ const v=r?.version, b=r?.build;
  return v?`<span title="Game build ${esc(b||"")}">${cap?"Game version ":"game version "}${esc(v)}</span>`:`${cap?"Game build ":"game build "}${esc(b||"?")}`; }
// Which jobs to list: map stations and price updates (together under All jobs), planet alignments, pictures.
function drJobTabs(kind,unmapped){
  const n=S.drJobN||{}, has=k=>n[k]!==0||kind===k;       // unknown yet: shown
  const t=[["all","All jobs"],...(unmapped?[["map","Map stations"]]:[]),["prices","Update prices"],
    ...(has("align")||drCheckJobs().length?[["align","Alignment"]]:[]),...(has("photos")?[["photos","Pictures"]]:[])];
  return `<div class="seg-mini" id="dr-job-tabs" data-kind="${esc(kind)}" title="Which jobs to list">${t.map(([k,n])=>`<button data-jobkind="${k}" class="${kind===k?"on":""}">${n}</button>`).join("")}</div>`; }
function drJobsHead(kind,extra,where){
  return `<div class="dr-top"><div><h2>Jobs</h2><div class="where">${where}</div></div>
    <div style="margin-left:auto;display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end">${drJobTabs(kind,drUnmappedN())}${extra||""}</div></div>`; }

// ---- Planet alignment jobs: every planet and moon for this game version. Land at a known place on it and
// type /showlocation: Quantum lines it up and sends it. Live for everyone once a second alignment agrees.
const AJ_ST={live:["⚡ Live on Quantum","#7fe7ff"],mine:["You aligned it","#57e39b"],waiting:["Needs a second alignment","#f2c14e"],open:["Not aligned yet","#8cc4ff"]};
function ajCard(j){ const [label,col]=AJ_ST[j.status], mine=S.drAlignJob?.body===j.body;
  const sub=j.status==="live"?`Agreed by ${plural(j.reporters||2,"datarunner")}: every Quantum user's map uses it`
    :j.status==="mine"?`Waiting for another datarunner's alignment to agree with yours`
    :j.status==="waiting"?`${plural(Math.max(1,j.others),"datarunner")} lined it up already: yours confirms it, and you both get the approved report`
    :`Nobody has lined it up for this game version yet`;
  return `<div class="dr-job ${j.you_here?"here":""}"><div class="n">🪐</div><div class="age ${j.status==="live"?"a0":j.status==="mine"?"a1":j.status==="waiting"?"a2":"a3"}" style="font-size:12px">${j.kind==="moon"?"Moon":"Planet"}</div>
    <div class="info"><b>${esc(j.body)}</b>${j.you_here?` <span class="chip y" style="margin-left:6px">● You're here</span>`:""}${drClaimChip(`a:${j.body}`)}
      <span class="badge" style="margin-left:8px;color:${col};border-color:${col}66;background:${col}14">${label}</span>
      <div class="muted" style="font-size:12.5px;margin-top:2px">${esc(j.system)}${j.place_count?` · land at any of ${j.place_count} known places, like ${j.places.slice(0,3).map(esc).join(", ")}`:""}</div>
      <div style="font-size:12.5px;margin-top:4px;color:var(--ink-2)">${sub}</div></div>
    <div class="go"><button class="btn small ghost" data-ajmap="${esc(j.body)}" title="Show it on the map">Map</button>${j.status==="live"||j.status==="mine"?""
      :mine?`<span class="chip y">Your job</span>`:drClaimOf(`a:${j.body}`)?`<span class="chip" title="Another datarunner accepted it">Taken</span>`
      :`<button class="btn small primary" data-ajaccept="${esc(j.body)}" title="Hold it for ${CLAIM_MIN} minutes so others know you're on it">Accept job</button>`}</div></div>`; }
// ---- A planet alignment job, step by step, like mapping a station: accepted → land anywhere on it that's
// on the map → "I've arrived" → /showlocation → submit → submitted. Only a reading taken after "I've
// arrived", on that planet or moon and at a place Quantum knows, can be submitted.
function drAlignGuide(){ const aj=S.drAlignJob; if(!aj) return "";
  if(aj.until<=Date.now()&&aj.state!=="sent"){ S.drAlignJob=null; return ""; }
  const key=S.live?.autoloc?.loc_hotkey, game=!S.live?.game_off, rd=aj.reading||{}, fin=aj.state==="sent";
  const stepN=fin?5:!aj.arrived?2:rd.ok?4:3;
  const st=(n,title,body)=>`<li class="${stepN>n?"done":stepN===n?"now":""}"><div class="mjn">${stepN>n?"✓":n}</div><div><b>${title}</b>${stepN>=n&&body?`<div class="d">${body}</div>`:""}</div></li>`;
  const b=S.bodyMap?.[aj.body], left=Math.max(1,Math.round((aj.until-Date.now())/60000)), r=aj.result;
  const sent=!r?"":r.ok?`<b style="color:#9fe0b4">${esc(aj.body)} is lined up on your map</b> from ${esc(r.place)} (${Math.abs(r.correction).toFixed(2)}° correction). ${r.shared
      ?`<span style="color:#7fe7ff">Sent to Quantum: it goes live for everyone once another datarunner's alignment agrees.</span>`:esc(r.note||"")}`
    :`<span style="color:#ffd38a">${esc(r.error||"Couldn't line it up")}</span>`;
  return `<div class="mapjob" id="dr-alignjob"><div class="hd"><div><div class="lbl">Job started · Alignment</div><h3>${esc(aj.body)}</h3>
      <div class="muted" style="font-size:12.5px">${b?.kind==="moon"?"Moon":"Planet"} · ${esc(b?.system||"")}${fin?"":` · held for ${left} more min`}</div></div>
      <div class="acts">${fin?`<button class="btn small" data-aj="done">Done</button>`:`<button class="btn small ghost" data-ajmap="${esc(aj.body)}">Show on map</button><button class="btn small ghost" data-ajrelease="1">Cancel job</button>`}</div></div>
    <ol class="mj-steps">
      ${st(1,"Job accepted","")}
      ${st(2,`Go to ${esc(aj.body)} and land`,stepN===2?`Land anywhere on ${esc(aj.body)} that's on Quantum's map: an outpost, city or landing zone. Press <b>I've arrived</b> once you're down. Any /showlocation before that is ignored.
        <div style="margin-top:8px"><button class="btn small primary" data-aj="arrived">I've arrived</button></div>`:"")}
      ${st(3,"Type /showlocation",stepN===3?`Press <b>${esc(key||"your /showlocation key")}</b>${key?"":" (set one in Settings)"} or type <b>/showlocation</b> in game chat. Quantum is listening.
        ${!game?`<div class="warn">Star Citizen isn't running: Quantum reads the position from the game.</div>`
          :rd.why&&rd.why!=="none"&&rd.why!=="old"?`<div class="warn">${esc(rd.why)}</div>`:`<div class="wait"><span class="spin"></span>Waiting for your /showlocation…</div>`}
        <div style="margin-top:8px"><button class="btn small ghost" data-aj="notyet">I'm not there yet</button></div>`:"")}
      ${st(4,"Submit the position",stepN===4?`Got your reading at <b>${esc(rd.place)}</b>, ${Math.round(rd.age)} s ago. It lines ${esc(aj.body)} up for this game version.
        <div style="margin-top:8px"><button class="btn small primary" data-aj="submit">Submit alignment for ${esc(aj.body)}</button></div>`:"")}
      ${st(5,"Submitted",stepN===5?sent:"")}
    </ol></div>`; }
function drAlignPaint(){ const el=$("dr-alignjob"); if(el) el.outerHTML=drAlignGuide(); }
// While waiting for the /showlocation: ask the app whether the latest reading counts (and where it is).
async function drAlignCheck(){ const aj=S.drAlignJob; if(!aj||!aj.arrived||aj.state==="sent"||aj.checking) return; aj.checking=true;
  try{ aj.reading=await api().dr_align_reading(aj.body, aj.arrived); }catch(e){} aj.checking=false; drAlignPaint(); }
async function drAlignClick(e){ const a=e.target.closest("[data-aj]"); if(!a) return false; const aj=S.drAlignJob, w=a.dataset.aj; if(!aj) return true;
  if(w==="arrived"){ aj.arrived=Date.now(); aj.reading=null; drAlignPaint(); drAlignCheck(); return true; }
  if(w==="notyet"){ aj.arrived=null; aj.reading=null; drAlignPaint(); return true; }
  if(w==="done"){ S.drAlignJob=null; S.drExtra=null; renderDrJobs(); return true; }
  if(w==="submit"){ a.disabled=true; a.textContent="Submitting…"; const r=await api().dr_align_submit(aj.body, aj.arrived);
    if(!r.ok){ toast(r.error); a.disabled=false; a.textContent=`Submit alignment for ${aj.body}`; aj.reading=null; drAlignCheck(); return true; }
    aj.state="sent"; aj.result=r; drRelease(`a:${aj.body}`); S.drExtra=null; await poll(); drAlignPaint(); toast(`${aj.body} lined up`); return true; }
  return true; }
// The held alignment job is done once the server lists it as yours (or live)
function drAlignDone(r){ const aj=S.drAlignJob; if(!aj||aj.state==="sent") return; const j=r.jobs.find(x=>x.body===aj.body&&(x.status==="mine"||x.status==="live")); if(!j) return;
  S.drAlignJob=null; toast(j.status==="live"?`${aj.body} lined up and live for everyone`:`${aj.body} lined up and sent. It counts once another datarunner's alignment agrees`); }

// Why alignment is a job at all: shown at the top of the tab, folded away once read (remembered per PC).
function ajWhyHtml(){ if(S.ajWhyOpen===undefined){ try{ S.ajWhyOpen=localStorage.getItem("ajWhyOpen")!=="0"; }catch(_){ S.ajWhyOpen=true; } }
  return `<div class="note aj-why" style="margin:0 2px 12px"><div style="display:flex;align-items:center;gap:8px"><b>Why line up planets?</b><a data-ajwhy="1" style="margin-left:auto;cursor:pointer;font-size:12px;text-decoration:underline">${S.ajWhyOpen?"Hide":"What's this for?"}</a></div>
    ${S.ajWhyOpen?`<div style="font-size:12.5px;line-height:1.55;margin-top:6px;color:var(--ink-2)">Planets and moons spin, and every place on them (cities, outposts, landing zones) turns with them. Quantum works out where a place is right now from two numbers: how fast its planet turns and which way it was facing at a known moment. Game updates can change that starting angle, so after each patch the planets need lining up again.
      <ul style="margin:6px 0 0 18px;padding:0"><li><b>Accurate times</b>: arrival times, the local time and day or night at cities and outposts, and the city clock depend on it.</li>
      <li><b>Accurate navigation</b>: where an outpost sits on the map, which side of the planet it's on, and the route and distances to it.</li>
      <li><b>Accurate tracking</b>: reading your position from /showlocation and spotting which place you're at.</li></ul>
      <div style="margin-top:6px">One /showlocation at any known place on a planet lines it up. Once a second datarunner's alignment agrees, it's live for every Quantum user, and it stays right until the next patch.</div></div>`:""}</div>`; }
// ---- Planet alignment jobs: every planet and moon for this game version. Land at a known place on it and
// type /showlocation: Quantum lines it up and sends it. Live for everyone once a second alignment agrees.
async function renderDrAlignJobs(){ const d=S.dr, P=$("dr-panel");
  if(!P.querySelector(".dr-jobs.align")) P.innerHTML=`${drViews()}${qLoader("Checking which planets are lined up…")}`;
  const [r]=await Promise.all([api().dr_align_jobs(), drLoadClaims()]); if(d.view!=="jobs"||S.drJobKind!=="align") return;
  if(!r.ok){ P.innerHTML=`${drViews()}${drJobsHead("align","","Planets and moons to line up for this game version.")}<div class="dr-list dr-jobs special align"><div class="warnbox" style="margin:10px 2px">${esc(r.error)}</div></div>`; return; }
  drJobCounts(r,null); drAlignDone(r);
  const sys=S.drJobSys&&r.systems.includes(S.drJobSys)?S.drJobSys:"", rank={waiting:0,open:1,mine:2,live:3}, chk=drCheckJobs(sys);
  if(!S.drJobN.align&&!chk.length&&!drAlignGuide()&&!S.drMapJob){ S.drJobKind="all"; return renderDrJobs(); }      // nothing left to line up: the tab hides itself
  // Planets already lined up (live for everyone, or yours waiting for a second) aren't jobs any more: they're
  // kept out of the list unless you ask to see them (to check one on the map, say).
  const all=r.jobs.filter(j=>!sys||j.system===sys), doneN=all.filter(j=>j.status==="live"||j.status==="mine").length;
  const L=all.filter(j=>S.ajShowDone||(j.status!=="live"&&j.status!=="mine")).sort((a,b)=>(a.system!==S.system)-(b.system!==S.system)||rank[a.status]-rank[b.status]||a.body.localeCompare(b.body));
  const todo=S.drJobN.align;
  P.innerHTML=`${drViews()}${drJobsHead("align",`<select class="field" id="dr-jobs-sys"><option value="">All systems</option>${r.systems.map(x=>`<option ${x===sys?"selected":""}>${esc(x)}</option>`).join("")}</select>`,
      `${gameVerTxt(r,true)} · ${todo?`${todo} ${todo===1?"planet or moon":"planets and moons"} still to line up`:"every planet and moon is lined up"}${chk.length?`, plus ${chk.length} ${chk.length===1?"Gateway or station":"Gateways and stations"} to confirm`:""}. Each update can shift where a planet's surface is turned, so they're lined up again per version.`)}
    <div class="dr-list dr-jobs special align">${ajWhyHtml()}${r.offline?`<div class="warnbox" style="margin:0 2px 10px">The Quantum server couldn't be reached, so what other datarunners have done isn't shown.</div>`:""}${drMyJobsHtml()}${drAlignGuide()}${drMapJobHtml()}
      ${L.length?`<div class="mk-h" style="margin-top:2px">Planets and moons</div>${L.map(ajCard).join("")}`:doneN?`<div class="dr-empty">Every planet and moon${sys?` in ${esc(sys)}`:""} is lined up for this version.</div>`:""}
      ${doneN?`<div class="muted" style="font-size:12px;margin:6px 2px 10px"><a data-ajshowdone="1" style="cursor:pointer;text-decoration:underline">${S.ajShowDone?`Hide the ${doneN} already lined up`:`Show the ${doneN} already lined up`}</a></div>`:""}
      ${chk.length?`<div class="mk-h" style="margin-top:10px">Gateways and stations <span class="muted" style="text-transform:none;letter-spacing:0">${chk.length} on the map that nobody has confirmed in game</span></div>${chk.map(drMapCard).join("")}`:""}
      ${!L.length&&!chk.length?`<div class="dr-empty">Nothing to line up here.</div>`:""}</div>`; }

// ---- Picture jobs: ships, vehicles, components and commodities with no picture anywhere yet.
// Accept one and the job shows what's needed; the screenshot is checked and looked over before it's sent.
const PJ_KIND={vehicle:"Ships & vehicles",component:"Components",commodity:"Commodities"};
function drPhotoHeld(){ const h=S.drPhotoJob; if(h&&h.until>Date.now()) return h; S.drPhotoJob=null; return null; }
function drPhotoMine(){ return new Set((S.drProf?.contrib||[]).filter(c=>c.type==="photo"&&["submitted","in_review"].includes(c.status)).map(c=>`${c.kind}:${String(c.name).toLowerCase()}`)); }
function drPhotoYou(j,mine){ const key=`${j.kind}:${j.title.toLowerCase()}`; return !!((S.drPhotoSent||{})[key]||mine.has(key)); }
function pjCard(j,mine){ const id=`ph:${j.kind}:${j.title}`, you=drPhotoYou(j,mine), isMine=drPhotoHeld()?.id===id;
  return `<div class="dr-job ${isMine?"here":""}"><div class="n">${IC_PIC}</div><div class="age a3" style="font-size:12px">${j.kind==="vehicle"?"Ship":j.kind==="component"?"Part":"Cargo"}</div>
    <div class="info"><b>${esc(j.label)}</b>${drClaimChip(id)}${you?` <span class="chip" style="margin-left:6px;color:#f2c14e">You sent one · in review</span>`:""}
      <div class="muted" style="font-size:12.5px;margin-top:2px">${esc(j.group)} · ${esc(PJ_KIND[j.kind])}</div></div>
    <div class="go">${you?"":isMine?`<span class="chip y">Your job</span>`:drClaimOf(id)?`<span class="chip" title="Another datarunner accepted it">Taken</span>`
      :`<button class="btn small primary" data-phaccept="${esc(id)}" title="Hold it for ${CLAIM_MIN} minutes; Quantum shows you what's needed">Accept job</button>`}</div></div>`; }
function drPhotoGuide(){ const h=drPhotoHeld(); if(!h) return "";
  return `<div class="dr-job here" style="display:block;padding:14px"><b>Your job: a picture of ${esc(h.label)}</b> <span class="muted">· held for ${Math.max(1,Math.round((h.until-Date.now())/60000))} more min</span>
    ${photoFormHtml(h.kind,h.name,h.id)}</div>`; }
// On All jobs: a short note that opens the Pictures tab, where the form is
function drPhotoBanner(){ const h=drPhotoHeld(); if(!h) return "";
  return `<div class="dr-job here" style="display:block;padding:12px 14px"><b>Your job: a picture of ${esc(h.label)}</b> <span class="muted">· held for ${Math.max(1,Math.round((h.until-Date.now())/60000))} more min</span>
    <button class="btn small primary" data-jobkind="photos" style="margin-left:8px">Send it</button></div>`; }
async function renderDrPhotoJobs(refresh){ const d=S.dr, P=$("dr-panel");
  if(!P.querySelector(".dr-jobs.photos")) P.innerHTML=`${drViews()}${qLoader("Finding things with no picture…")}`;
  const [r]=await Promise.all([api().dr_photo_jobs(!!refresh), drLoadClaims()]); if(d.view!=="jobs"||S.drJobKind!=="photos") return;
  if(!r.ok){ P.innerHTML=`${drViews()}${drJobsHead("photos","","Things with no picture yet.")}<div class="dr-list dr-jobs special photos"><div class="warnbox" style="margin:10px 2px">${esc(r.error)}</div></div>`; return; }
  S.drPhotoJobs=r.jobs; drJobCounts(null,r);
  if(!r.jobs.length&&!drPhotoHeld()){ S.drJobKind="all"; return renderDrJobs(); }      // everything has a picture: the tab hides itself
  const kinds=Object.entries(PJ_KIND).filter(([x])=>r.counts[x]);                      // kinds with no jobs aren't shown
  if(S.drPhotoKind&&!r.counts[S.drPhotoKind]) S.drPhotoKind="";
  const k=S.drPhotoKind||"";
  P.innerHTML=`${drViews()}${drJobsHead("photos",kinds.length>1?`<div class="seg-mini"><button data-phkind="" class="${!k?"on":""}">All</button>${kinds.map(([x,n])=>`<button data-phkind="${x}" class="${k===x?"on":""}">${n} <small class="muted">${r.counts[x]}</small></button>`).join("")}</div>`:"",
      `${plural(r.jobs.length,"thing")} with no picture anywhere yet. Accept a job to see what's needed; it goes live for every Quantum user once it's approved.`)}
    <input class="search" id="dr-ph-q" placeholder="Find one, like “Atlas” or “Gold”" value="${esc(S.drPhotoQ||"")}" autocomplete="off" style="margin:0 2px 10px;width:calc(100% - 4px)">
    <div class="dr-list dr-jobs special photos" id="dr-ph-list">${drMyJobsHtml()}<div id="dr-ph-guide">${drPhotoGuide()}</div><div id="dr-ph-cards"></div></div>`;
  drPhotoList(); }
function drPhotoList(){ const box=$("dr-ph-cards"); if(!box) return;
  const k=S.drPhotoKind||"", q=(S.drPhotoQ||"").trim().toLowerCase(), mine=drPhotoMine();
  const L=(S.drPhotoJobs||[]).filter(j=>(!k||j.kind===k)&&(!q||`${j.label} ${j.group}`.toLowerCase().includes(q)));
  box.innerHTML=L.length?L.slice(0,150).map(j=>pjCard(j,mine)).join("")+(L.length>150?`<div class="muted" style="font-size:12px;margin:6px 2px">Showing 150 of ${L.length}: search to narrow.</div>`:"")
    :`<div class="dr-empty">${q||k?"Nothing matches.":"Everything has a picture. Thank you, datarunners!"}</div>`; }
// A picture went out from anywhere in Quantum: that job is done (the server frees its hold).
document.addEventListener("quantum:photosent",e=>{ const title=pfTitle(e.detail.name);
  (S.drPhotoSent=S.drPhotoSent||{})[`${e.detail.kind}:${title.toLowerCase()}`]=true;
  if(S.drPhotoJob?.id===`ph:${e.detail.kind}:${title}`) S.drPhotoJob=null;
  S.drProf=null; S.drExtra=null; qForget("drProf"); if(S.tab==="datarunner"&&S.dr?.view==="jobs") renderDrJobs(); });
async function drSpecialJobClick(e){
  if(e.target.closest("[data-phaccept],[data-ajaccept],[data-phrelease],[data-ajrelease]")) S.drExtra=null;
  const pk=e.target.closest("[data-phkind]"); if(pk){ S.drPhotoKind=pk.dataset.phkind; for(const b of $("dr-panel").querySelectorAll("[data-phkind]")) b.classList.toggle("on",b===pk); drPhotoList(); return true; }
  // Accepting a picture job opens the Pictures tab with what's needed and the form at the top
  const pa=e.target.closest("[data-phaccept]"); if(pa){ pa.disabled=true; pa.textContent="Accepting…"; const id=pa.dataset.phaccept;
    const j=(S.drPhotoJobs||[]).find(x=>`ph:${x.kind}:${x.title}`===id), u=await drAccept(id);
    if(u&&j){ S.drPhotoJob={id, until:u, kind:j.kind, name:j.name, label:j.label}; drHold(id,{label:j.label,sub:"Picture",until:u,data:{...S.drPhotoJob}}); toast(`Job accepted: it's yours for ${CLAIM_MIN} minutes`); }
    S.drJobKind="photos"; await renderDrJobs(); $("dr-panel").querySelector(".dr-jobs")?.scrollTo({top:0,behavior:"smooth"}); return true; }
  if(e.target.closest("[data-phrelease]")){ if(S.drPhotoJob) drRelease(S.drPhotoJob.id); S.drPhotoJob=null; renderDrJobs(); return true; }
  const aa=e.target.closest("[data-ajaccept]"); if(aa){ aa.disabled=true; const u=await drAccept(`a:${aa.dataset.ajaccept}`);
    if(u){ S.drAlignJob={body:aa.dataset.ajaccept, until:u}; drHold(`a:${aa.dataset.ajaccept}`,{label:aa.dataset.ajaccept,sub:"Planet alignment",until:u}); toast(`Job accepted: line up ${aa.dataset.ajaccept} within ${CLAIM_MIN} minutes`); }
    S.drJobKind="align"; await renderDrJobs(); $("dr-panel").querySelector(".dr-jobs")?.scrollTo({top:0,behavior:"smooth"}); return true; }
  if(await drAlignClick(e)) return true;
  if(e.target.closest("[data-ajrelease]")){ if(S.drAlignJob) drRelease(`a:${S.drAlignJob.body}`); S.drAlignJob=null; renderDrJobs(); return true; }
  if(e.target.closest("[data-ajshowdone]")){ S.ajShowDone=!S.ajShowDone; renderDrJobs(); return true; }
  if(e.target.closest("[data-ajwhy]")){ S.ajWhyOpen=!S.ajWhyOpen; try{ localStorage.setItem("ajWhyOpen",S.ajWhyOpen?"1":"0"); }catch(_){} renderDrJobs(); return true; }
  const am=e.target.closest("[data-ajmap]"); if(am){ document.querySelector('.tab[data-tab="route"]')?.click(); select({kind:"body",name:am.dataset.ajmap}); focusBody(am.dataset.ajmap); return true; }
  return false; }

// Pictures and station positions sent through Quantum, reviewed on the Quantum server rather than UEX.
// "Live on Quantum": every Quantum user sees it now (the picture shown for that item, or the station on the map).
const CB_ST={submitted:["Submitted","#8cc4ff"],in_review:["In Review","#f2c14e"],approved:["Approved","#57e39b"],live:["⚡ Live on Quantum","#7fe7ff"],
  shared:["⚡ Live on Quantum","#7fe7ff"],rejected:["Rejected","#ff6b6b"]};
function drContribCard(c){ const [label,col]=CB_ST[c.status]||[c.status,"#a8bbd4"], live=c.status==="live"||c.status==="shared";
  const PADN={none:"No pad",vehicle:"Vehicle",small:"Small",medium:"Medium",large:"Large",xl:"XL",hangar:"Hangar"};
  const what={photo:`Picture · ${esc(c.name)}`,alignment:`Alignment · ${esc(c.name)}`,pad:`Landing pad · ${esc(c.name)}`,
    missing:`Doesn't exist · ${esc(c.name)}`}[c.type]||`Station position · ${esc(c.name)}`;
  const sub=c.type==="photo"?(live?`${esc(c.kind||"item")} picture, shown to every Quantum user`:c.status==="approved"?`${esc(c.kind||"item")} picture, approved; a newer one is shown now`:`${esc(c.kind||"item")} picture, reviewed by Quantum`)
    :c.type==="alignment"?`${c.system?esc(c.system)+" · ":""}game build ${esc(c.build||"?")}${c.place?` · at ${esc(c.place)}`:""} · ${live?"agreed by another datarunner":c.status==="rejected"?"rejected":"waiting for another datarunner's alignment to agree"}`
    :c.type==="pad"?`${esc(PADN[c.pad]||c.pad||"")} · ${live?"shown to every Quantum user":"waiting for another datarunner to agree"}`
    :c.type==="missing"?(live?"hidden for every Quantum user":"waiting for another datarunner to agree")
    :(live?`${esc(c.system||"")} · on every Quantum user's map`:`${esc(c.system||"")} · waiting for a second datarunner's reading to agree (a trusted contributor's counts on its own)`);
  // Withdraw only while it's still waiting: once it's live (or rejected) it's been decided.
  const wd=c.type==="place"&&(c.status==="submitted"||!c.status)?`<button class="btn small ghost nx-btn" data-cbwd="${esc(c.name)}" title="Sent it by mistake? Takes your reading back. It doesn't count as a rejection">${S.drWd===c.name?"Sure? Click again":"Withdraw"}</button>`:"";
  const view=live?(c.type==="photo"&&c.url?`<img class="cb-pic" src="${esc(c.url)}" alt="${esc(c.name)}" referrerpolicy="no-referrer" onerror="this.remove()">`
    :c.type==="place"&&S.locMap?.[c.name]?.pos?`<button class="btn small ghost" data-cbmap="${esc(c.name)}">Show on map</button>`:""):"";
  const why=c.status==="rejected"?`<div class="reject-why">${c.reason?`Reason: ${esc(c.reason)}`:"No reason was given."}</div>`:"";
  return `<div class="dr-rep contrib ${live?"live":""}"><div class="hd">${view&&c.type==="photo"?view:""}<div><b>${what}</b><div class="muted" style="font-size:12px">${sub} · ${new Date(c.at*1000).toLocaleString([], {month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"})}</div>${why}</div>
    <span style="margin-left:auto;display:flex;gap:6px;align-items:center">${view&&c.type==="place"?view:""}${wd}</span><span class="badge" style="margin-left:0;color:${col};border-color:${col}66;background:${col}14">${esc(label)}</span></div></div>`; }

// Approved and rejected: what the stars are worked out from (price rows, pictures, station positions).
// From the server when it sends them; worked out here for an older server.
function drDecided(p){ if(p?.decided) return p.decided; const c=p?.contrib||[];
  return {approved:(p?.rows?.approved||0)+c.filter(x=>["approved","shared","live"].includes(x.status)).length,
          rejected:(p?.rows?.declined||0)+c.filter(x=>x.status==="rejected").length}; }
// The datarunner's card: UEX name and avatar, rank, stars, and how far to the next rank.
function drProfileCard(p,nm){ if(!p?.ok) return "";
  if(!p.username) return `<div class="dr-prof"><div class="av">?</div><div><b>Your datarunner profile</b><div class="muted" style="font-size:12.5px;margin-top:3px">Add your UEX Secret Key in your profile to see your UEX name, rank and star rating.</div></div></div>`;
  const nx=p.rank.next, prev=[...p.ranks].reverse().find(x=>p.rank.count>=x[0])?.[0]||0;
  const pct=nx?Math.min(100,(p.rank.count-prev)/(nx.at-prev)*100):100, left=nx?nx.at-p.rank.count:0;
  const pic=p.avatar||p.avatar_url;   // downloaded by Quantum, or else straight from UEX
  const dec=drDecided(p);
  const av=pic?`<img src="${esc(pic)}" alt="" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('span'),{textContent:'${esc((p.username||'?')[0].toUpperCase())}'}))">`:esc((p.username||"?")[0].toUpperCase());
  return `<div class="dr-prof">
    <div class="av" title="${esc(p.avatar_raw?"UEX avatar: "+p.avatar_raw:"No avatar set at UEX")}">${av}</div>
    <div class="who"><b>${esc(nm||p.username)}</b>${!nm&&p.name&&p.name!==p.username?`<span class="muted"> · ${esc(p.name)}</span>`:""}
      <div class="rk"><span class="rank-badge r${p.ranks.findIndex(x=>x[1]===p.rank.name)}">${esc(p.rank.name)}</span>${p.trust?.trusted?`<span class="trust-badge" title="Your pictures and station positions go live without waiting for review">✓ Trusted contributor</span>`:""}
        ${drStarBar(p.rated?p.stars:0,20)} <b>${p.rated?p.stars.toFixed(1):"0.0"}</b><span class="muted" title="What your star rating is worked out from: every price row, picture and station position that's been decided">${p.rated?` · ${dec.approved} Approved, ${dec.rejected} Rejected`:" · your first approved report sets 5 stars"}</span></div>
      <div class="nx">${nx?`<div class="bar"><i style="width:${pct}%"></i></div><span>${plural(left,"more approved report")} to <b>${esc(nx.name)}</b></span>`:`<span>Highest rank reached. Thank you, datarunner.</span>`}</div></div>
    <div class="nums"><div title="${esc(Object.entries(p.approved_by||{}).map(([k,v])=>`${DR_KINDS[k]||k}: ${v}`).join("\n")||"Approved prices, pictures, station positions and alignments")}"><b>${p.accepted.toLocaleString()}</b><span>Approved</span></div><div><b>${(p.reports||0).toLocaleString()}</b><span>Sent</span></div></div>
    ${p.uex_banned?`<div class="warnbox" style="grid-column:1/-1;margin:6px 0 0">UEX has suspended your datarunner access, so new reports won't be accepted.</div>`:p.uex_datarunner===0?`<div class="warnbox" style="grid-column:1/-1;margin:6px 0 0">Your UEX account isn't a datarunner yet. Turn it on in your UEX profile to send reports.</div>`:""}
    ${p.banned?`<div class="warnbox" style="grid-column:1/-1;margin:6px 0 0">Your reports are no longer shared with Quantum users${p.ban_reason?`: ${esc(p.ban_reason)}`:""}.</div>`:""}
    <div class="ladder">${p.ranks.slice(1).map((x,i)=>`<span class="${x[1]===p.rank.name?"on":p.rank.count>=x[0]?"done":""}">${esc(x[1])}<small>${x[0]}${i===p.ranks.length-2?"+":"–"+(p.ranks[i+2][0]-1)}</small></span>`).join("")}</div>
    ${p.source==="local"?`<div class="muted" style="grid-column:1/-1;font-size:11.5px">Worked out on this PC: the Quantum server couldn't be reached.</div>`:p.test?`<div class="muted" style="grid-column:1/-1;font-size:11.5px">Test mode: test reports don't count toward rank or stars.</div>`:""}
  </div>`; }
// A row's status opens that item's report on UEX ({id}: UEX's report number). Without a number yet,
// it opens UEX's page for that commodity at that terminal instead.
const UEX_REPORT_URL="https://uexcorp.space/data/info/id/{id}/";
// Reports sent from the same terminal within 15 minutes of each other are one visit (newest first)
function drGroupReports(list){ const out=[];
  for(const e of [...list].sort((a,b)=>(b.at||0)-(a.at||0))){ const g=out.find(g=>g.id_terminal===e.id_terminal&&g.last-(e.at||0)<=900);
    if(g&&g.test===!!e.test&&g.id_terminal===e.id_terminal&&g.last-(e.at||0)<=900){ g.items.push(e); g.last=e.at||0; }
    else out.push({id_terminal:e.id_terminal, at:e.at||0, last:e.at||0, test:!!e.test, items:[e]}); }
  return out; }
function drShotViewer(src){ closePhotoDialog(); const d=Object.assign(document.createElement("div"),{className:"pf-modal",id:"pf-modal"});
  d.innerHTML=`<div class="pf-box" style="width:min(1100px,100%)" role="dialog" aria-modal="true" aria-label="Screenshot sent with the report"><div class="pf-head"><b>The screenshot this report was sent with</b>
    <button class="btn small ghost" data-pfclose="1" aria-label="Close">✕</button></div><img src="${esc(src)}" alt="" style="display:block;width:100%;margin-top:10px;border-radius:8px;border:1px solid var(--line-2)"></div>`;
  document.body.appendChild(d); }
async function renderDrMine(refresh,announce){ const d=S.dr, P=$("dr-panel");
  if(!refresh) P.innerHTML=`${drViews()}${qLoader("Loading your reports…")}`;
  let r, pr;
  try{ [r,pr]=await Promise.all([api().dr_reports(!!refresh), api().dr_profile(!!refresh)]); }
  catch(e){ r={ok:false,error:String(e?.message||e)}; }
  if(d.view!=="mine") return;
  if(!r?.ok){ P.innerHTML=`${drViews()}<div class="warnbox" style="margin:10px 2px">Couldn't load your reports: ${esc(r?.error||"unknown error")}.
      <div class="row" style="margin-top:8px"><button class="btn small" data-mine="refresh">Try again</button></div></div>`; return; }
  if(pr?.ok){ d.pf.stats.rating={stars:pr.stars, rated:pr.rated, rank:pr.rank.name}; S.drProf=pr; }
  S.drApproval=r.approval; renderDrStats(d.pf.stats);
  if(announce) toast(!r.waiting?"All your reports are decided: nothing to ask UEX"
    :r.asked?`Updated from UEX: ${r.waiting} report${r.waiting===1?"":"s"} still waiting`
    :`Checked UEX ${Math.max(1,Math.round(r.checked_ago||0))} s ago. Refresh can ask again in ${Math.max(1,60-Math.round(r.checked_ago||0))} s`);
  const sum=Object.entries(r.summary||{}).map(([k,n])=>`<span class="chip" style="border-color:${DR_ST[k][1]}55;color:${DR_ST[k][1]}">${n} ${esc(DR_SUM[k])}</span>`).join("");
  const st=d.pf.status_names;
  // One card per terminal visit: the reports sent from it in one go (one per screenshot, as UEX wants)
  // together, every item with its own status, and the screenshot each item went with while it's kept.
  const fin=["approved","consolidated","declined","expired"];
  const line=x=>{ const e=x._e, nd=e.no_decision&&!(x.uex&&fin.includes(x.uex)), s2=x.uex&&DR_ST[x.uex];
    const txt=nd?"No decision":s2?s2[0]:e.test?"":"–", c=nd?"#6f82a0":s2?s2[1]:"var(--dim)";
    const link=x.uex_id&&UEX_REPORT_URL?UEX_REPORT_URL.replace("{id}",encodeURIComponent(x.uex_id)):x.uex_url||"";
    return `<div class="ln"><span>${esc(x.name||"#"+x.id_commodity)} <span class="muted">${x.side==="buy"?"BUY":"LMV"}</span></span>
      <span>${x.missing?"no longer traded":`${x.price!=null?money(x.price):"?"} · ${drFmt(x.scu)} SCU · ${esc(st[x.status]||"?")}`}</span>
      <span>${e.shot?`<button class="btn small ghost dr-shotbtn" data-repshot="${esc(e.shot)}" title="See the screenshot this was sent with">${IC_PIC}</button> `:""}${link
        ?`<a data-url="${esc(link)}" style="color:${c};cursor:pointer;text-decoration:underline" title="${x.uex_id?`Open UEX report #${esc(x.uex_id)}`:"Open this price on UEX"}">${esc(txt)}</a>`
        :`<span style="color:${c}">${esc(txt)}</span>`}${x.uex_id?` <span class="muted" style="font-size:11px">#${esc(x.uex_id)}</span>`:""}</span>${x.reason?`<div class="reject-why">UEX: ${esc(x.reason)}</div>`:""}</div>`; };
  const card=(g,i)=>{ const all=g.items, e0=all[0], rows=all.flatMap(e=>(e.rows||[]).map(x=>({...x,_e:e})));
    const [label,col]=drOverall({test:g.test, states:all.flatMap(e=>e.states||[]), no_decision:all.every(e=>e.no_decision)});
    return `<div class="dr-rep" data-k="${i}"><div class="hd"><div><b>${esc(e0.terminal||"Terminal")}</b><div class="muted" style="font-size:12px">${esc(e0.where||"")} · ${new Date(g.at*1000).toLocaleString([], {month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"})} · ${plural(rows.length,"item")}${all.length>1?` in ${all.length} reports, one per screenshot`:""}</div></div>
      <span class="badge" style="color:${col};border-color:${col}66;background:${col}14">${esc(label)}</span></div>
      <div class="bd">${rows.map(line).join("")}
        ${all.some(e=>e.no_decision)?`<div class="muted" style="font-size:11.5px;margin-top:6px">UEX didn't decide on ${all.length>1?"some of these":"this"} within 14 days, so Quantum stopped asking. It doesn't count toward your rating.</div>`:""}
        ${all.some(e=>e.shot)?`<div class="muted" style="font-size:11.5px;margin-top:6px">${IC_PIC} shows the screenshot an item was sent with. They're kept on this PC for 14 days.</div>`:""}</div></div>`; };
  P.innerHTML=`${drViews()}${drProfileCard(pr)}<div class="dr-top"><div><h2>My Reports</h2><div class="where">${r.live?"Their review status comes from UEX.":"Test mode: these were saved to a folder, not sent, so UEX has no status for them."}</div></div>
      <div style="margin-left:auto;display:flex;gap:8px;align-items:center">${r.approval!=null?`<span class="chip" style="border-color:#57e39b66;color:#9fe0b4">${r.approval}% Approval</span>`:""}<button class="btn small" data-mine="refresh">Refresh</button></div></div>
    ${sum?`<div class="row" style="gap:6px;flex-wrap:wrap;margin:-4px 2px 10px">${sum}</div>`:""}
    ${r.error?`<div class="warnbox">Couldn't get the review status from UEX: ${esc(r.error)}</div>`:""}
    ${!r.can_check&&r.reports.some(e=>!e.test)?`<div class="warnbox">Add your datarunner secret key in your profile to see what UEX did with your reports.</div>`:""}
    <div class="dr-list">${(()=>{ const items=[...drGroupReports(r.reports).map((g,k)=>({at:g.at,h:card(g,k)})),...(pr?.contrib||[]).map(c=>({at:c.at||0,h:drContribCard(c)}))].sort((a,b)=>b.at-a.at);
      return items.length?items.map(x=>x.h).join(""):`<div class="dr-empty">No reports yet. Your price reports, pictures and station positions show up here with their status.</div>`; })()}</div>`; }

// ---- sidebar: stats, screenshots, details
function drStarBar(stars,size){ return `<span class="stars" style="${size?`font-size:${size}px`:""}">★★★★★<i style="width:${(stars||0)/5*100}%">★★★★★</i></span>`; }
function drStars(r){ if(!r) return "";
  return `<div class="dr-rating" title="Your first approved report sets 5 stars. Approved ones keep it up, rejected ones bring it down. See FAQ on the Datarunner page.">${drStarBar(r.rated?r.stars:0)}<b>${r.rated?r.stars.toFixed(1):"–"}</b><span class="muted" style="font-size:12px">${r.rated?esc(r.rank||"datarunner rating"):"Unrated: no reports approved yet"}</span></div>`; }
// The card's "All time" and rating come from your profile on the Quantum server (every PC you've used),
// fetched when the Datarunner tab opens; this PC's own log is the fallback when the server's away.
// Station positions and pictures you sent count as reports too, like they do for your rank: all time from
// the server, and "this session" for the ones sent since Quantum started.
const APP_START=Date.now();
function drMergeProfile(st,p){ if(!st||!p?.ok) return st;
  st.rating={stars:p.stars, rated:p.rated, rank:p.rank?.name};
  if(st.test) return st;
  st._base=st._base||{all:{...st.all}, session:{...st.session}};          // this PC's own numbers, kept once
  const c=(p.contrib||[]).filter(x=>x.status!=="rejected");
  const stations=c.filter(x=>x.type==="place").length, pictures=c.filter(x=>x.type==="photo").length;
  const now=c.filter(x=>x.at*1000>=APP_START).length;
  const t=p.totals||{reports:st._base.all.reports, prices:st._base.all.prices, terminals:st._base.all.terminals};
  st.all={...st._base.all, reports:t.reports+stations+pictures, prices:t.prices, terminals:t.terminals, stations, pictures};
  st.session={...st._base.session, reports:st._base.session.reports+now};
  return st; }
function renderDrStats(st){ if(!st) return; drMergeProfile(st,S.drProf); const s=st.session, a=st.all; $("dr-stats").hidden=false;
  $("dr-stats").innerHTML=`${drStars(st.rating)}<b style="font-size:13px">This session</b>
    <div class="big"><div><b>${s.reports}</b><span>reports</span></div><div><b>${s.prices}</b><span>prices</span></div><div><b>${Math.round(s.days)}</b><span>days of old data replaced</span></div></div>
    <div class="all">All time${st.test?" (test reports)":""}: ${a.reports} report${a.reports===1?"":"s"} · ${a.prices} prices · ${a.terminals} terminal${a.terminals===1?"":"s"}${a.stations?` · ${a.stations} station${a.stations===1?"":"s"} mapped`:""}${a.pictures?` · ${a.pictures} picture${a.pictures===1?"":"s"}`:""}${S.drApproval!=null?` · <b style="color:#9fe0b4">${S.drApproval}% Approval</b>`:""}</div>`; }
async function renderDrShots(){ const r=await api().dr_shots(), st=await api().dr_status(); const was=drLocked();
  if(S.drShotSeq!=null&&S.drShotSeq!==r.seq&&!S.drSending){ S.drMatchOk=false;   // different screenshots now
    if($("dr-att-ok")){ drSheet(null); toast("Your screenshots changed: review the report again"); } }
  S.drShotSeq=r.seq; S.drShots=r.shots;
  S.drShotCount=r.shots.length; S.drShotKey=st.shot_hotkey||""; S.drShotPol=st.shot_policy||null; if(S.drShotPol?.optional||!S.drShotPol?.can_try) S.drNoShot=false;
  if(S.dr&&S.dr.view!=="mine"&&was!==drLocked()) renderDrList();
  else if($("dr-lock")) $("dr-lock").outerHTML=drLockHtml();
  $("dr-shots").innerHTML=r.shots.map((s,i)=>`<div class="dr-shot"><img src="${s.thumb}" alt="Screenshot ${i+1}"><span>${i+1} · ${s.w}×${s.h}</span><button data-drx="${i}" aria-label="Remove screenshot ${i+1}">×</button></div>`).join("");
  $("dr-shots-clear").hidden=!r.shots.length;
  $("dr-shot-hint").textContent=(st.shot_hotkey?`Press ${st.shot_hotkey} in game with the kiosk on screen. `:"Set a screenshot key in Settings to take them from the game. ")
    +(r.shots.length?`Long list? Scroll and take another: each screenshot goes to UEX as its own report, with the items it shows.`:"The whole kiosk must be in it, showing the prices you report.");
  renderDrSend(); drSyncInputs(); }
// Terminal: type any part of the place or terminal name ("new bab", "tressler admin"); where you are comes first.
{ const q=$("dr-term-q"), list=$("dr-term-list"); let hi=0, shown=[];
  const draw=()=>{ const words=q.value.toLowerCase().split(/\s+/).filter(Boolean), cur=S.dr?.pf?.id_terminal;
    const all=S.drTerms||[], match=t=>{ const h=`${t.where} ${t.name} ${t.system||""}`.toLowerCase(); return words.every(w=>h.includes(w)); };
    shown=(q.value===q.dataset.label?all:all.filter(match)).slice(0,60); hi=Math.max(0,Math.min(hi,shown.length-1));
    list.innerHTML=shown.length?shown.map((t,j)=>`<div data-j="${j}" class="${j===hi?"hi":""}" role="option" aria-selected="${t.id===cur}">${t.here?"● ":""}${esc(t.name)}<small>${esc(t.where)}${t.system?` · ${esc(t.system)}`:""}</small></div>`).join("")
      :`<div class="none">No terminal matches “${esc(q.value)}”</div>`;
    list.classList.add("open"); q.setAttribute("aria-expanded","true"); list.querySelector(".hi")?.scrollIntoView({block:"nearest"}); };
  const close=()=>{ list.classList.remove("open"); q.setAttribute("aria-expanded","false"); };
  const pick=t=>{ if(!t) return; close(); q.value=`${t.where} · ${t.name}`; q.dataset.label=q.value; q.blur(); S.dr=null; openDatarunner(t.id); };
  q.addEventListener("focus",()=>{ q.select(); hi=0; draw(); });
  q.addEventListener("input",()=>{ hi=0; draw(); });
  q.addEventListener("keydown",e=>{ if(e.key==="ArrowDown"){ e.preventDefault(); hi=Math.min(hi+1,shown.length-1); draw(); }
    else if(e.key==="ArrowUp"){ e.preventDefault(); hi=Math.max(hi-1,0); draw(); }
    else if(e.key==="Enter"){ e.preventDefault(); pick(shown[hi]); }
    else if(e.key==="Escape"){ q.value=q.dataset.label||""; close(); q.blur(); } });
  q.addEventListener("blur",()=>setTimeout(()=>{ if(document.activeElement!==q){ close(); q.value=q.dataset.label||""; } },150));
  list.addEventListener("mousedown",e=>{ const o=e.target.closest("[data-j]"); if(o){ e.preventDefault(); pick(shown[+o.dataset.j]); } }); }
// Counts down on the button, then Quantum steps out of the way, the game is shot, and Quantum comes back.
$("dr-shoot").onclick=async()=>{ const b=$("dr-shoot"); if(b.disabled) return; b.disabled=true; S.drWaiting=true;
  try{
    for(const n of [3,2,1]){ b.textContent=`Screenshot in ${n}…`; await new Promise(r=>setTimeout(r,1000)); }
    b.textContent="Taking screenshot…"; const st=await api().dr_capture(0);
    if(!st.ok) return toast(st.error||"Couldn't start the screenshot");
    if(/busy/.test(st.text||"")) return toast("Still working on the last screenshot. Try again in a few seconds");
    const t0=Date.now(); let job;
    while(Date.now()-t0<30000){ await new Promise(r=>setTimeout(r,300)); job=await api().dr_job(); if(job.state==="done"||job.state==="error") break; }
    S.drJobSeen=job?.n;
    if(job?.state!=="done") return toast(job?.error||"The screenshot didn't finish. Settings > Log shows where it stopped");
    await renderDrShots(); drPreview(job.index);
  } finally { S.drWaiting=false; b.textContent="Take screenshot"; drSyncInputs(); } };
$("dr-shots-clear").onclick=async()=>{ await api().dr_clear_shots(null); renderDrShots(); };
$("dr-shots").onclick=async e=>{ const x=e.target.closest("[data-drx]"); if(x){ await api().dr_clear_shots(+x.dataset.drx); $("dr-view").classList.remove("show"); return renderDrShots(); }
  const im=e.target.closest(".dr-shot img"); if(im) drPreview([...$("dr-shots").querySelectorAll(".dr-shot img")].indexOf(im)); };
// A screenshot at readable size over the report, to check the whole kiosk and its prices are in it.
async function drPreview(i){ const r=await api().dr_shot_image(i); if(!r.ok) return; const v=$("dr-view");
  v.innerHTML=`<div class="gh"><b>Screenshot ${i+1}</b>${r.w}×${r.h} · check the whole kiosk and the prices you report are readable
    <span class="spacer" style="flex:1"></span><button class="btn" data-dv="close">Back to the report</button><button class="btn ghost" data-dv="del">Remove it</button></div>
    <img class="dv-img" src="${r.src}" alt="Screenshot ${i+1} of the terminal">`;
  v.className="pic-panel"; v.dataset.i=i; v.classList.add("show"); v.scrollTop=0; }
// ---- One report per screenshot (UEX's rule): each shot goes to UEX resized to 1920×1080, with only
// the items it shows. S.drAssign: item key -> shot id; S.drMatchSeen: shots looked at in the matcher.
const drKey=x=>`${x.id_commodity}:${x.side}`;
function drMatchState(){ S.drAssign??={}; S.drMatchSeen??=new Set();
  const shots=S.drShots||[], items=S.dr?drReady():[], ids=new Set(shots.map(s=>s.id));
  if(shots.length===1) for(const x of items) S.drAssign[drKey(x)]=shots[0].id;     // one shot: everything's in it
  for(const k in S.drAssign) if(!ids.has(S.drAssign[k])) delete S.drAssign[k];
  // "Not sold here" items can't appear in any screenshot (that's the point: the kiosk doesn't list them),
  // so they never need matching. One that isn't ticked to a shot goes with the first report; the kiosk's
  // list in that screenshot is the proof it's gone.
  const shotOf=x=>ids.has(S.drAssign[drKey(x)])?S.drAssign[drKey(x)]:(x.state==="gone"&&shots.length?shots[0].id:null);
  const per=shots.map((sh,i)=>({shot:sh, n:i+1, items:items.filter(x=>shotOf(x)===sh.id)}));
  const loose=items.filter(x=>shotOf(x)==null), empty=per.filter(p=>!p.items.length), unseen=shots.filter(sh=>!S.drMatchSeen.has(sh.id));
  return {shots, items, per, loose, empty, unseen, done:shots.length>0&&items.length>0&&!loose.length&&!empty.length&&!unseen.length}; }
function drItemLine(x){ const st=S.dr?.pf.status_names||{};
  return x.state==="gone"?"not sold here any more · the kiosk's list not showing it is the proof":`${x.side==="buy"?"BUY":"LMV"} · ${x.scu!==""&&x.scu!=null?drFmt(drNum(x.scu))+" SCU":"no stock"} · ${x.price!==""&&x.price!=null?money(drNum(x.price)):"no price"}${x.status?" · "+esc(st[x.status]||""):""}`; }
// One page per screenshot: the exact 1920×1080 image UEX gets, and the items to tick that it shows.
async function drMatchView(page=0){ let m=drMatchState(); if(!m.shots.length) return;
  page=Math.max(0,Math.min(page,m.shots.length-1)); const sh=m.shots[page], v=$("dr-view"), many=m.shots.length>1;
  S.drMatchSeen.add(sh.id); S.drMatchOk=false;
  v.className="pic-panel att show"; v.dataset.i="";
  v.innerHTML=`<div class="gh"><b>Screenshot ${page+1} of ${m.shots.length}</b><span>${many?`Report ${page+1}: goes to UEX with only the items you tick here`:"Goes to UEX with all your items"}</span>
      <span class="spacer" style="flex:1"></span><span class="att-modes"><button data-m="fit" class="on">Fit</button><button data-m="uex" title="One image pixel per screen pixel: exactly as sharp as a reviewer sees it">1920×1080, as UEX sees it</button></span>
      <button class="btn" data-dv="close">Back</button></div>
    <div class="match"><div class="att-stage fit"><span class="muted"><span class="spin-sm"></span> Loading…</span></div>
      <div class="match-side"><div class="mh">${many?"Tick the items you can see in this screenshot":"Your items: check each one is in the screenshot"}</div><div class="match-list"></div></div></div>
    <div class="att-foot"><div class="match-dots"></div><span class="match-note"></span><span class="spacer" style="flex:1"></span>
      <button class="btn" data-p="prev" ${page?"":"disabled"}>Previous</button><button class="btn primary" data-p="next">${page<m.shots.length-1?"Next screenshot":"Done"}</button></div>`;
  const list=v.querySelector(".match-list"), stage=v.querySelector(".att-stage");
  const paint=()=>{ m=drMatchState();
    list.innerHTML=m.items.map(x=>{ const k=drKey(x), on=S.drAssign[k]===sh.id, other=!on&&m.per.find(p=>p.shot.id===S.drAssign[k]);
      return `<label class="mi ${on?"on":""}"><input type="checkbox" data-k="${esc(k)}" ${on?"checked":""} ${many?"":"disabled"}><span><b>${esc(x.name||"#"+x.id_commodity)}</b><small>${drItemLine(x)}</small></span>${other?`<em>in shot ${other.n}</em>`:""}</label>`; }).join("");
    v.querySelector(".match-dots").innerHTML=m.per.map(p=>`<button class="md ${p.shot.id===sh.id?"cur":""} ${p.items.length?"has":""}" data-go="${p.n-1}" title="Screenshot ${p.n}: ${p.items.length} item${p.items.length===1?"":"s"}">${p.n}<small>${p.items.length}</small></button>`).join("");
    // Only complain about screenshots already looked at; before that, just say what's left.
    const note=v.querySelector(".match-note"), empty=m.empty.filter(p=>S.drMatchSeen.has(p.shot.id)), probs=[];
    if(empty.length) probs.push(`screenshot ${empty.map(p=>p.n).join(", ")} ${empty.length>1?"have":"has"} no items: tick its items, or remove it`);
    if(m.loose.length&&!m.unseen.length) probs.push(`${m.loose.length} item${m.loose.length>1?"s":""} not in any screenshot: tick ${m.loose.length>1?"them":"it"} where ${m.loose.length>1?"they appear":"it appears"}, or take another screenshot`);
    note.className="match-note "+(probs.length?"bad":m.done?"ok":"");
    note.textContent=probs.length?probs.join(" · "):m.done?"✓ Every item is in a screenshot":`${m.loose.length} item${m.loose.length===1?"":"s"} left to match`; };
  paint();
  list.onchange=e=>{ const k=e.target.dataset.k; if(!k) return; if(e.target.checked) S.drAssign[k]=sh.id; else delete S.drAssign[k]; S.drMatchOk=false; paint(); };
  v.querySelector(".att-foot").onclick=e=>{ const go=e.target.closest("[data-go]")?.dataset.go, p=e.target.closest("[data-p]")?.dataset.p;
    if(go!=null) return drMatchView(+go);
    if(p==="prev") return drMatchView(page-1);
    if(p==="next"){ if(page<m.shots.length-1) return drMatchView(page+1); v.classList.remove("show"); v.className="pic-panel"; drMatchSync(); } };
  const r=await api().dr_shot_view(sh.id); if(!r.ok){ stage.innerHTML=`<span class="muted">${esc(r.error||"Couldn't load it")}</span>`; return; }
  const dpr=window.devicePixelRatio||1;
  const mode=(md,fx,fy)=>{ v.querySelectorAll(".att-modes button").forEach(b=>b.classList.toggle("on",b.dataset.m===md));
    if(md==="fit"){ stage.className="att-stage fit"; stage.innerHTML=`<div class="att-uex" title="Click to see it at 1920×1080 there"><img src="${r.src}" alt="Screenshot ${page+1}"></div><div class="att-cap">${r.w}×${r.h} ${r.format.toUpperCase()}, ${(r.bytes/1048576).toFixed(1)} MB · click to see it as UEX does</div>`; return; }
    stage.className="att-stage actual"; stage.innerHTML=`<img src="${r.src}" alt="" draggable="false" style="width:${r.w/dpr}px;height:${r.h/dpr}px">`;
    requestAnimationFrame(()=>{ stage.scrollLeft=(fx??0.5)*r.w/dpr-stage.clientWidth/2; stage.scrollTop=(fy??0.5)*r.h/dpr-stage.clientHeight/2; }); };
  mode("fit");
  v.querySelector(".att-modes").onclick=e=>{ const md=e.target.closest("[data-m]")?.dataset.m; if(md) mode(md); };
  stage.onclick=e=>{ const im=e.target.closest(".att-uex img"); if(!im) return; const b=im.getBoundingClientRect();
    const sc=Math.min(b.width/r.w,b.height/r.h), ox=(b.width-r.w*sc)/2, oy=(b.height-r.h*sc)/2;   // object-fit: contain
    mode("uex",Math.min(1,Math.max(0,(e.clientX-b.left-ox)/(r.w*sc))),Math.min(1,Math.max(0,(e.clientY-b.top-oy)/(r.h*sc)))); };
  let drag=null;                                       // drag to look around
  stage.onpointerdown=e=>{ if(!stage.classList.contains("actual")) return; drag={x:e.clientX,y:e.clientY,l:stage.scrollLeft,t:stage.scrollTop}; stage.classList.add("drag"); stage.setPointerCapture(e.pointerId); };
  stage.onpointermove=e=>{ if(!drag) return; stage.scrollLeft=drag.l-(e.clientX-drag.x); stage.scrollTop=drag.t-(e.clientY-drag.y); };
  stage.onpointerup=stage.onpointercancel=()=>{ drag=null; stage.classList.remove("drag"); }; }
// The review's checkbox and status follow the matching: ticking is only possible once every item is
// in a screenshot, every screenshot has items, and each one has been looked at.
function drMatchSync(){ const box=$("dr-att-ok"); if(!box) return; const m=drMatchState();
  box.disabled=!m.done; box.closest(".dr-check").classList.toggle("off",!m.done);
  box.checked=m.done&&!!S.drMatchOk; box.dispatchEvent(new Event("change"));
  const st=$("dr-match-state"); if(!st) return;
  st.className="st"+(m.done?" ok":"");
  st.textContent = m.done ? (m.shots.length>1?`✓ ${m.shots.length} reports: ${m.per.map(p=>`#${p.n} ${p.items.length} item${p.items.length===1?"":"s"}`).join(" · ")}`:"✓ Reviewed")
    : m.unseen.length===m.shots.length ? (m.shots.length>1?"Not matched yet":"Not reviewed yet: open it first")
    : [m.loose.length?`${m.loose.length} item${m.loose.length>1?"s":""} unmatched`:"", m.empty.length?`screenshot ${m.empty.map(p=>p.n).join(", ")} empty`:"", m.unseen.length?`${m.unseen.length} screenshot${m.unseen.length>1?"s":""} not looked at`:""].filter(Boolean).join(" · "); }
$("dr-view").onclick=async e=>{ const a=e.target.closest("[data-dv]")?.dataset.dv; if(!a) return;
  if(a==="del"){ await api().dr_clear_shots(+$("dr-view").dataset.i); renderDrShots(); }
  $("dr-view").classList.remove("show"); $("dr-view").className="pic-panel"; };
