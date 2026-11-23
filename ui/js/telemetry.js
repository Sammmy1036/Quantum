// Quantum UI: Star Citizen's local game telemetry (game/telemetry.py, api_telemetry.py). Off by default.
// One of several classic scripts sharing one global scope; index.html loads them in order.
//
// Turned on in Settings > Game telemetry, it adds detail the log can't give: a live card on the map with your
// ship (speed, fuel, shields, hull, warning lights, NAV/SCM) and you (health, oxygen, temperature), your ship and
// speed in the status line, your aUEC balance in the Cart, and a note the moment you're downed, killed or respawn.
// Off, or with the game not serving it, nothing here shows and Quantum works as before.
"use strict";
S.tl=S.tl||{status:null,collapsed:false,noteSeen:null};
try{ S.tl.collapsed=localStorage.getItem("q-tl-collapsed")==="1"; }catch(_){}
const tlLive=()=>{ const t=S.live?.telemetry; return t&&t.status==="connected"?t:null; };
// "DRAK_Cutlass_Red" -> the Vehicles name ("Drake Cutlass Red") when Quantum knows it, else tidied up
function tlShipName(v){ if(!v) return ""; const raw=v.name||v.class||"", words=raw.split("_").slice(1).join(" ").toLowerCase();
  const k=squash(words); const hit=k&&(S.veh||[]).find(x=>squash(x.full).endsWith(k)||squash(x.name||"")===k);
  return hit?.full||[v.maker,raw.split("_").slice(1).join(" ")].filter(Boolean).join(" ")||raw; }
const tlPct=x=>x==null?null:Math.max(0,Math.min(100,Math.round(x*100)));

// ---- Settings: three stages. Before the game's side is switched on: "Set up the game for me". Set up but no data yet:
// a "done" note with what's left (restart the launcher and the game, spawn in). Once data has come in once: "Enabled".
function tlCfgLoad(force){ const now=Date.now(); if(S.tl.cfgBusy||(!force&&S.tl.cfg&&now-(S.tl.cfgAt||0)<3000)) return;
  S.tl.cfgBusy=true; S.tl.cfgAt=now;
  api().telemetry_status().then(x=>{ S.tl.cfgBusy=false; const k=JSON.stringify(x); if(k===S.tl.cfgKey) return; S.tl.cfgKey=k; S.tl.cfg=x;
    if(S.selected?.kind==="settings") renderDetail(); }).catch(()=>{ S.tl.cfgBusy=false; }); }
// Why there's no data yet, from what Quantum can see: the reader's own state and this game session's Game.log
// (the game writes a line when it starts its telemetry server). -> {cls: ok|warn|bad|"", text, restart}
const TL_GRACE=60;   // s after spawning before "it isn't working" is said
function tlDiag(t,st){ const port=t.port||2942, L=t.state?.listen;
  if(st==="connected") return {cls:"ok",text:"Connected: receiving live data"};
  if(st==="paused") return {cls:"ok",text:"Connected: paused while you're in a menu or loading"};
  if(st==="no_grpc") return {cls:"bad",text:"This copy of Quantum can't read it: it was built without the grpcio package. Build it again with the new build_exe.bat (running from source: pip install grpcio)."};
  if(st==="error") return {cls:"bad",text:`Couldn't read it: ${t.state?.error||S.live?.telemetry?.error||"unknown error"}`};
  if(!t.game_running) return {cls:"",text:"Waiting for the game. Start Star Citizen from the RSI Launcher and spawn in."};
  // The game only starts serving once you've spawned, so nothing is a problem until you've been in for a minute
  if(!t.in_game||t.spawned_ago==null) return {cls:"",text:"Star Citizen is running. Waiting for you to spawn in…"};
  if(t.spawned_ago<TL_GRACE) return {cls:"",text:"Connecting…"};
  // What Quantum saw the game listening on (Windows): nothing at all means the game started without the setting
  if(L?.game&&!L.ports?.length) return {cls:"bad",fix:true,text:"Star Citizen is running without its telemetry: it isn't listening for Quantum at all. The RSI Launcher it was started from didn't have the setting yet, so the game didn't either."};
  if(L?.ports?.length&&!L.ports.includes(port)) return {cls:"warn",text:`Found Star Citizen serving on port ${L.ports[0]}: switching to it…`};
  if(!t.in_game) return {cls:"",text:"Star Citizen is starting. Waiting for you to spawn in…"};
  if(!L&&t.windows) return {cls:"",text:"Checking what the game is serving…"};
  return {cls:"warn",fix:!!t.windows,text:`Quantum can't connect on port ${port}${t.state?.detail?` (${t.state.detail.split(";")[0]})`:""}. The game probably started without the setting.`}; }
// "Restart the RSI Launcher for me": the automatic fix. Needs the game closed (it only reads the setting at start).
function tlFixHtml(t,big){ if(!t.windows) return "";
  if(S.tl.launcherDone) return `<div class="tl-fixed"><svg class="tl-ok" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg><span><b>RSI Launcher restarted with the setting.</b> Start Star Citizen from it and spawn in: this changes to Enabled.</span></div>`;
  return `<div class="tl-fix ${big?"big":""}"><button class="btn small ${t.game_running?"":"primary"}" data-a="tlfix" ${t.game_running||S.tl.fixBusy?"disabled":""}>${S.tl.fixBusy?"Restarting the launcher…":"Restart the RSI Launcher for me"}</button>
    <span class="muted tl-small">${t.game_running?"Close Star Citizen first, then click this. Quantum never closes the game for you.":"Quantum closes the RSI Launcher and starts it again with the setting. Then start the game from it."}</span></div>`; }
function tlSettingsHtml(){ tlCfgLoad(); if(S.tl.launcherDone&&S.tl.cfg?.game_running) S.tl.launcherDone=false; const t=S.tl.cfg||{}, on=!!t.on, rd=t.ready||{}, seen=!!t.seen;
  const live=S.live?.telemetry, st=(live||t.state)?.status||(on?"waiting":"off"), fps=live?.fps||t.state?.fps;
  const ok='<svg class="tl-ok" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>', todo='<span class="tl-todo" aria-hidden="true"></span>';
  let body="";
  if(on&&seen){
    // working before: no setup any more, just how it's doing right now
    const now=st==="connected"?`Receiving live data${fps?` · ${fps} a second`:""}`:st==="paused"?"Paused while you're in a menu or loading"
      :st==="no_grpc"?"This copy of Quantum can't read it (grpcio is missing)":st==="error"?"Couldn't read it: see below"
      :t.game_running?(t.in_game&&t.spawned_ago!=null?"Connecting…":"Waiting for you to spawn in"):"Connects by itself when you start the game and spawn in";
    const dg=tlDiag(t,st), bad=dg.cls==="bad"||dg.cls==="warn";
    body=`<div class="tl-ready"><div class="tl-badge">${ok}Enabled</div><div><b>Game telemetry is set up and working</b><div class="muted">${esc(bad?"":now)}</div></div><span class="dot ${st==="connected"?"on":st==="error"||st==="no_grpc"?"warn":""}" style="margin-left:auto"></span></div>
      ${bad?`<div class="tl-diag ${dg.cls}">${esc(dg.text)}</div>${dg.fix?tlFixHtml(t,true):""}`:""}
      ${st==="waiting"&&!t.game_running?"":st==="waiting"?`<div class="muted tl-small">Not getting anything after a game patch? <a data-a="tlsetup" style="cursor:pointer;text-decoration:underline">Set up the game again</a></div>`:""}`;
  } else if(on&&rd.configured){
    // set up, but no data yet: what's left to do
    const ch=rd.channels||[];
    body=`<div class="tl-done"><div class="tl-done-h">${ok}<b>${S.tl.justSetUp?"Setup complete":"The game is set up"}</b></div>
        <ul class="tl-list">${rd.env!==null?`<li>${rd.env?ok:todo}Windows setting for 4.10 (GRPC_CLIENT_SERVER_ENABLED)</li>`:""}${ch.map(c=>`<li>${c.cfg?ok:todo}${esc(c.name)}\\USER.cfg (5.0)</li>`).join("")}</ul>
        ${(()=>{ const dg=tlDiag(t,st); return t.game_running?`<div class="tl-diag ${dg.cls}">${esc(dg.text)}</div>${dg.fix?tlFixHtml(t,true):""}`:""; })()}
        ${t.game_running?"":`<div class="tl-next"><b>What's next</b><ol>
          <li><b>Restart the RSI Launcher</b> so it has the new setting.${t.windows?tlFixHtml(t):` Fully quit it: right-click its icon by the clock and choose Quit (closing its window isn't enough), then start it again.`}</li>
          <li><b>Start Star Citizen</b> from the launcher.</li>
          <li><b>Spawn in.</b> Quantum connects by itself, and this changes to <b>Enabled</b>.</li></ol></div>`}
        <div class="row tl-wait"><span class="dot ${st==="connected"?"on":""}"></span><span class="muted">${st==="connected"?"Connected":st==="paused"?"Connected, paused":t.game_running?"Not connected yet":"Waiting for the game…"}</span><span class="spacer"></span><a class="muted tl-small" data-a="tlsetup" style="cursor:pointer;text-decoration:underline">Run setup again</a></div></div>`;
  } else if(on){
    // not set up yet
    body=`<div class="tl-setup-box"><div><b>One more step: switch it on in the game</b><div class="muted tl-small">Star Citizen only shares this data once it's allowed to. Quantum can do that for you: a Windows setting for 4.10 and a line in USER.cfg for 5.0. You'll restart the launcher afterwards.</div></div>
        ${rd.known?`<button class="btn small primary" data-a="tlsetup" ${S.tl.busy?"disabled":""}>${S.tl.busy?"Setting up…":"Set up the game for me"}</button>`
          :`<div class="muted tl-small" style="color:#ffcf8a">Start Star Citizen once first, so Quantum finds your game folder (it's found from Game.log).</div>`}</div>
      ${S.tl.setupErr?`<div class="tl-small" style="color:#ffb3b3;margin-top:6px">${esc(S.tl.setupErr)}</div>`:""}`;
  }
  return `<div class="sub">Game telemetry <span class="tl-beta">Beta</span></div>
    <div class="note" style="margin:4px 0 12px">
      <label class="row" style="gap:8px;cursor:pointer"><input type="checkbox" id="s-tlon" ${on?"checked":""}> <b>Read live data from the game</b></label>
      <div class="muted" style="font-size:12px;margin-top:6px;line-height:1.5">Star Citizen can share your ship's and your character's state with programs on this PC. With this on, Quantum shows more:
        a live card on the map (speed, fuel, shields, hull, warning lights, NAV/SCM, your health, oxygen, satiety and hydration), your ship in the status line, your aUEC balance in the Cart, and being downed or killed the moment it happens.
        Quantum only listens; it never sends anything to the game. CIG hasn't documented this yet, so it can change with a patch. Off, everything works as before.</div>
      ${on?`<div style="margin-top:10px">${body}</div>
        ${(live?.error||t.state?.error)&&st==="error"?`<div class="tl-small" style="color:#ffb3b3;margin-top:6px">${esc(live?.error||t.state.error)}</div>`:""}
        <details class="tl-adv" ${S.tl.advOpen?"open":""} ontoggle="S.tl.advOpen=this.open"><summary>Advanced</summary><div class="row" style="gap:8px;margin-top:8px;align-items:center"><span class="muted tl-small">Port</span><input class="field" id="s-tlport" inputmode="numeric" value="${esc(String(t.port||2942))}" style="width:90px"><span class="muted tl-small">2942 unless you changed it in the game</span></div></details>${tlStylePicker()}`:""}
    </div>`; }
function tlSettingsWire(d){ const cb=d.querySelector("#s-tlon"); if(!cb) return;
  for(const b of d.querySelectorAll("[data-tlsty]")) b.onclick=e=>{ e.preventDefault(); const v=b.dataset.tlsty; if(v===tlStyle()) return; tlSetStyle(v);
    for(const o of d.querySelectorAll("[data-tlsty]")){ const on=o.dataset.tlsty===v; o.classList.toggle("on",on); o.setAttribute("aria-checked",on); const n=o.querySelector(".tl-sty-n"); n.querySelector(".tl-sty-ck")?.remove(); if(on) n.insertAdjacentHTML("beforeend",'<span class="tl-sty-ck">Using</span>'); }
    toast(`Player stats: ${TL_STYLES.find(x=>x[0]===v)[1]}`); };
  cb.onchange=async e=>{ const r=await api().telemetry_set(e.target.checked); if(!r?.ok) return toast(r?.error||"Couldn't change it");
    S.tl.justSetUp=false; tlCfgLoad(true); toast(r.on?"Game telemetry on":"Game telemetry off"); await poll(); };
  const pt=d.querySelector("#s-tlport"); if(pt) pt.onchange=async()=>{ const r=await api().telemetry_set(true,pt.value); if(!r?.ok) return toast(r?.error); tlCfgLoad(true); toast(`Listening on port ${pt.value}`); };
  for(const fx of d.querySelectorAll('[data-a="tlfix"]')) fx.onclick=async e=>{ e.stopPropagation(); e.preventDefault(); S.tl.fixBusy=true; renderDetail();
    let r; try{ r=await api().telemetry_restart_launcher(); }catch(_){ r={ok:false,error:"Couldn't restart it"}; }
    S.tl.fixBusy=false; if(r?.ok){ S.tl.launcherDone=true; toast("RSI Launcher restarted with the setting. Start Star Citizen from it"); } else toast(r?.error||"Couldn't restart it");
    tlCfgLoad(true); renderDetail(); };
  for(const su of d.querySelectorAll('[data-a="tlsetup"]')) su.onclick=async e=>{ e.stopPropagation(); e.preventDefault(); S.tl.busy=true; S.tl.setupErr=null; renderDetail();
    let r; try{ r=await api().telemetry_setup_game(); }catch(_){ r={ok:false,error:"Couldn't run the setup"}; }
    S.tl.busy=false;
    if(r?.ready){ S.tl.cfg=r; S.tl.cfgKey=null; S.tl.cfgAt=Date.now(); }
    if(r?.ready?.configured){ S.tl.justSetUp=true; toast("Setup complete. Now restart the RSI Launcher and the game"); }
    else S.tl.setupErr=r?.error||"Setup didn't finish";
    renderDetail(); }; }

// ---- the live card on the map
const TL_IC={
  hp:'<svg class="tl-ic" viewBox="0 0 24 24" aria-hidden="true"><path class="f" d="M12 21s-8-5.1-8-11a4.6 4.6 0 0 1 8-3.1A4.6 4.6 0 0 1 20 10c0 5.9-8 11-8 11z"/><path class="k" d="M12 9.5v5M9.5 12h5"/></svg>',
  o2:'<svg class="tl-ic" viewBox="0 0 24 24" aria-hidden="true"><circle class="l" cx="10" cy="13" r="7"/><circle class="l" cx="19" cy="5.5" r="2.5"/><text x="10" y="15.6" class="t">O2</text></svg>',
  drink:'<svg class="tl-ic" viewBox="0 0 24 24" aria-hidden="true"><path class="f" d="M15 6.5c2.6 3.4 5 6.6 5 9.3a5 5 0 0 1-10 0c0-2.7 2.4-5.9 5-9.3z"/><path class="f" d="M7 2.5c1.5 2 2.9 3.8 2.9 5.4a2.9 2.9 0 0 1-5.8 0C4.1 6.3 5.5 4.5 7 2.5z"/></svg>',
  food:'<svg class="tl-ic" viewBox="0 0 24 24" aria-hidden="true"><path class="l" d="M6 1.8l3.6 2.1v4.2L6 10.2 2.4 8.1V3.9z"/><path class="l" d="M6 12.8l3.6 2.1v4.2L6 21.2l-3.6-2.1v-4.2z"/><circle class="f" cx="6" cy="6" r="1.2"/><circle class="f" cx="6" cy="17" r="1.2"/><path class="f" d="M21.5 3.5C14 3.5 11.5 8.6 11.5 13c0 3.6 2.4 6.5 5.6 6.5 4.6 0 5.6-7.4 4.4-16z"/><path class="k" d="M13.2 21c1.3-5.2 3.5-9.6 6.6-13.6"/></svg>'
};
function tlBar(label,pct,cls,txt,ic){ return pct==null?"":`<div class="tl-bar ${cls||""}"><span>${ic?TL_IC[ic]:""}${label}</span><div><i style="width:${pct}%"></i></div><b>${txt??pct+"%"}</b></div>`; }
const TL_WARN_CLS={nominal:"ok",minor:"minor",minor_flashing:"minor blink",major:"major",major_flashing:"major blink"};
function tlCardHtml(t){ const v=t.vehicle, a=t.actor||{}, w=t.weapons;
  const head=`<div class="tl-h"><span class="dot on"></span><b>Player Stats</b><span class="muted">${t.fps?`${t.fps}/s`:""}</span><span class="spacer"></span>
    <button class="iconbtn" data-tl="collapse" aria-label="${S.tl.collapsed?"Show the live card":"Hide the live card"}" title="${S.tl.collapsed?"Show":"Hide"}">${S.tl.collapsed?"▸":"▾"}</button></div>`;
  if(S.tl.collapsed) return head.replace('<span class="spacer"></span>',`<span class="tl-mini">${v?`${esc(tlShipName(v))} · ${Math.round(v.speed||0)} m/s`:a.locomotion==="eva"?"EVA":"On foot"}</span><span class="spacer"></span>`);
  let h=head;
  if(v){ const warn=Object.entries(v.warnings||{}).filter(([,s])=>s!=="off");
    h+=`<div class="tl-sec"><div class="tl-ship"><b>${esc(tlShipName(v))}</b>${v.mode?`<span class="tl-chip ${v.mode}">${v.mode.toUpperCase()}${v.spooled?" · spooled":""}</span>`:""}<span class="tl-chip">${v.landed?"Landed":v.gear==="deployed"?"Gear down":"Flying"}</span></div>
      <div class="tl-big"><div><b>${Math.round(v.speed||0).toLocaleString()}</b><span>m/s</span></div>${v.heading!=null?`<div><b>${Math.round(v.heading)}°</b><span>heading</span></div>`:""}${v.altitude!=null?`<div><b>${v.altitude>=10000?(v.altitude/1000).toFixed(1)+" km":Math.round(v.altitude)+" m"}</b><span>altitude</span></div>`:""}</div>
      ${tlBar("Quantum fuel",tlPct(v.q_fuel),"q")}${tlBar("Hydrogen",tlPct(v.h_fuel),"h")}${v.shields?tlBar("Shields",tlPct(v.shields.level),"s"):""}${v.health!=null?tlBar("Hull",tlPct(v.health),tlPct(v.health)<35?"bad":"hp"):""}
      ${v.boost?tlBar("Boost",tlPct(v.boost.reserve),v.boost.critical?"bad":"b"):""}
      ${warn.length?`<div class="tl-warn">${warn.map(([k,s])=>`<span class="${TL_WARN_CLS[s]||""}" title="${esc(k)}: ${esc(s.replace("_"," "))}">${k}</span>`).join("")}</div>`:""}
      ${w?.countermeasures?.length?`<div class="tl-row">${w.countermeasures.map(c=>`<span>${c.n} ${c.type==="decoy"?"decoys":"noise"}</span>`).join("")}${w.preset?`<span class="muted">${esc(w.preset)}</span>`:""}</div>`:""}</div>`; }
  const y=tlYou(a), st=tlStyle();
  if(y.any||a.auec!=null){
    const docked=st==="strip"||st==="rail";
    if(!docked) h+=`<div class="tl-sec"><div class="tl-ship"><b>You</b><span class="tl-chip">${tlLoco(a)}</span></div>
      ${st==="tiles"?tlTilesHtml(y):st==="rings"?tlRingsHtml(y)+tlLowHtml(y):tlBarsHtml(y)}
      ${tlMetaHtml(a)?`<div class="tl-row">${tlMetaHtml(a)}</div>`:""}
      ${a.auec!=null?`<div class="tl-auec"><span>Balance</span><b>${Math.round(a.auec).toLocaleString()} <small>aUEC</small></b></div>`:""}</div>`;
    else if(a.auec!=null&&v) h+=`<div class="tl-sec"><div class="tl-auec"><span>Balance</span><b>${Math.round(a.auec).toLocaleString()} <small>aUEC</small></b></div></div>`; }
  return h; }
// ---- your stats: one set of numbers, five ways to show them (Settings › Game telemetry › Player stats style)
const TL_STYLES=[["bars","Bars","The list you have now"],["tiles","Tiles","Like the in-game HUD"],["rings","Rings","Compact gauges"],["strip","Bottom strip","Slim bar along the map's bottom"],["rail","Edge rail","Smallest: icon and number"]];
function tlStyle(){ if(S.tl.style) return S.tl.style; let v=null; try{ v=localStorage.getItem("q-tl-style"); }catch(_){} return S.tl.style=TL_STYLES.some(x=>x[0]===v)?v:"bars"; }
function tlSetStyle(v){ S.tl.style=v; try{ localStorage.setItem("q-tl-style",v); }catch(_){} for(const id of ["tl-card","tl-strip","tl-rail"]){ const e=$(id); if(e) e.dataset.k=""; } tlRender(); }
const tlLoco=a=>({on_foot:"On foot",eva:"EVA",seated:a.role?`Seated · ${a.role}`:"Seated"}[a.locomotion]||"–");
function tlYou(a){ const gp=g=>g&&g.max?Math.max(0,Math.min(100,Math.round(g.cur/g.max*100))):null;
  const rows=[["hp","Health",gp(a.health),35],["o2","Oxygen",gp(a.oxygen),25],["food","Satiety",gp(a.hunger),20],["drink","Hydration",gp(a.thirst),20]]
    .filter(r=>r[2]!=null).map(([k,label,v,low])=>({k,label,v,low:v<low}));
  return {rows,any:rows.length>0}; }
function tlMetaHtml(a){ return `${a.body_temp&&a.body_temp.cur?`<span>Body ${a.body_temp.cur.toFixed(1)}°C</span>`:""}${a.outside_temp!=null?`<span>Outside ${Math.round(a.outside_temp)}°C</span>`:""}${a.breathable===false&&a.locomotion!=="seated"?`<span class="bad">Not breathable</span>`:""}${a.radiation?`<span class="${a.radiation>0.5?"bad":""}">Radiation ${a.radiation}</span>`:""}${a.heart_rate?`<span>${a.heart_rate} bpm</span>`:""}`; }
const tlCls=r=>`tls-${r.k}${r.low?" bad":""}`;
function tlBarsHtml(y){ return y.rows.map(r=>tlBar(r.label,r.v,`${r.k} ${r.low?"bad":""}`,null,r.k)).join(""); }
function tlTilesHtml(y){ return `<div class="tl-tiles">${y.rows.map(r=>`<div class="tl-tile ${tlCls(r)}" title="${r.label} ${r.v}%"><div class="tl-tile-top">${TL_IC[r.k]}<div class="tl-vm"><i style="height:${r.v}%"></i></div></div><b>${r.v}%</b><span>${r.label}</span></div>`).join("")}</div>`; }
function tlRingsHtml(y){ const C=2*Math.PI*22;
  return `<div class="tl-rings">${y.rows.map(r=>`<div class="tl-ring ${tlCls(r)}" title="${r.label} ${r.v}%"><div class="tl-ring-g"><svg viewBox="0 0 54 54" aria-hidden="true"><circle cx="27" cy="27" r="22"/><circle class="v" cx="27" cy="27" r="22" stroke-dasharray="${(C*r.v/100).toFixed(1)} ${C.toFixed(1)}"/></svg>${TL_IC[r.k]}</div><b>${r.v}%</b><span>${r.label}</span></div>`).join("")}</div>`; }
const TL_LOW={hp:["Hurt","Use a MedPen or get to a med bed"],o2:["Low oxygen","Get somewhere breathable or swap your tank"],food:["Hungry","Eat something soon"],drink:["Thirsty","Drink something soon"]};
function tlLowHtml(y){ const r=y.rows.find(x=>x.low); if(!r) return ""; const [t,d]=TL_LOW[r.k];
  return `<div class="tl-low tls-${r.k} bad">${TL_IC[r.k]}<span><b>${t}</b> · ${r.label} ${r.v}%. ${d}.</span></div>`; }
function tlStripHtml(y,a){ return `<div class="tl-strip-h"><span class="dot on"></span><b>Player Stats</b></div>${y.rows.map(r=>`<div class="tl-chipstat ${tlCls(r)}" title="${r.label} ${r.v}%">${TL_IC[r.k]}<div><div class="tl-cs-t"><span>${r.label}</span><b>${r.v}%</b></div><div class="tl-cs-b"><i style="width:${r.v}%"></i></div></div></div>`).join("")}${tlMetaHtml(a)?`<div class="tl-strip-m">${tlMetaHtml(a)}</div>`:""}${a.auec!=null?`<div class="tl-strip-m"><b>${Math.round(a.auec).toLocaleString()}</b> aUEC</div>`:""}`; }
function tlRailHtml(y,a){ return y.rows.map(r=>`<div class="tl-railit ${tlCls(r)}" tabindex="0" aria-label="${r.label} ${r.v}%">${TL_IC[r.k]}<b>${r.v}</b><div class="tl-rb"><i style="width:${r.v}%"></i></div>
    <div class="tl-fly"><div class="tl-fly-h">${TL_IC[r.k]}<b>${r.label}</b><b class="tl-fly-v">${r.v}%</b></div><div class="tl-rb"><i style="width:${r.v}%"></i></div>${r.low?`<div class="tl-fly-d">${TL_LOW[r.k][1]}.</div>`:""}</div></div>`).join("")
    +(a.auec!=null?`<div class="tl-railit auec" title="Balance">aUEC<b>${tlShort(a.auec)}</b></div>`:""); }
const tlShort=n=>n>=1e6?(n/1e6).toFixed(n>=1e7?0:1)+"M":n>=1e4?Math.round(n/1e3)+"k":Math.round(n).toLocaleString();
// Settings: pick a style, with a preview of each using example numbers
const TL_SAMPLE={rows:[{k:"hp",label:"Health",v:80},{k:"o2",label:"Oxygen",v:95},{k:"food",label:"Satiety",v:64},{k:"drink",label:"Hydration",v:15,low:true}],any:true};
function tlStylePreview(id){ const y=TL_SAMPLE, a={};
  if(id==="bars") return `<div class="tl-pv-card">${tlBarsHtml(y)}</div>`;
  if(id==="tiles") return `<div class="tl-pv-card">${tlTilesHtml(y)}</div>`;
  if(id==="rings") return `<div class="tl-pv-card">${tlRingsHtml(y)}${tlLowHtml(y)}</div>`;
  if(id==="strip") return `<div class="tl-pv-map"><div class="tl-strip pv">${tlStripHtml(y,a)}</div></div>`;
  return `<div class="tl-pv-map rail"><div class="tl-rail pv">${tlRailHtml(y,a)}</div></div>`; }
function tlStylePicker(){ const cur=tlStyle();
  return `<div class="tl-sty"><div class="tl-sty-h"><b>Player stats style</b><span class="muted tl-small">How health, oxygen, satiety and hydration show on the map. Previews use example numbers.</span></div>
    <div class="tl-sty-grid" role="radiogroup" aria-label="Player stats style">${TL_STYLES.map(([id,name,sub])=>`<button type="button" class="tl-sty-o ${id===cur?"on":""}" role="radio" aria-checked="${id===cur}" data-tlsty="${id}">
      <div class="tl-sty-pv" aria-hidden="true">${tlStylePreview(id)}</div><div class="tl-sty-n"><b>${name}</b>${id===cur?'<span class="tl-sty-ck">Using</span>':""}</div><span class="muted tl-small">${sub}</span></button>`).join("")}</div></div>`; }
function tlRender(){ let c=$("tl-card"); const t=tlLive(), st=tlStyle();
  const show=t&&(t.vehicle||t.actor)&&!document.querySelector("#mapwrap .pic-panel.show");
  const docked=st==="strip"||st==="rail", y=show?tlYou(t.actor||{}):null;
  tlDock("tl-strip",show&&st==="strip"&&y.any?tlStripHtml(y,t.actor||{}):"");
  tlDock("tl-rail",show&&st==="rail"&&y.any?tlRailHtml(y,t.actor||{}):"");
  // docked styles: the card is only for your ship (it still shows on foot when there are no stats to dock)
  if(!show||(docked&&!t.vehicle&&y.any)){ if(c) c.hidden=true; return; }
  if(!c){ c=Object.assign(document.createElement("div"),{id:"tl-card",className:"tl-card"}); $("mapwrap").appendChild(c);
    c.addEventListener("click",e=>{ if(e.target.closest('[data-tl="collapse"]')){ S.tl.collapsed=!S.tl.collapsed; try{ localStorage.setItem("q-tl-collapsed",S.tl.collapsed?"1":"0"); }catch(_){} c.dataset.k=""; tlRender(); } }); }
  c.classList.toggle("with-rail",st==="rail"&&y.any);
  c.hidden=false; const html=tlCardHtml(t); if(c.dataset.k!==html){ c.dataset.k=html; c.innerHTML=html; } }
function tlDock(id,html){ let e=$(id);
  if(!html){ if(e) e.hidden=true; return; }
  if(!e){ e=Object.assign(document.createElement("div"),{id,className:id}); $("mapwrap").appendChild(e); }
  e.hidden=false; if(e.dataset.k!==html){ e.dataset.k=html; e.innerHTML=html; } }
// Downed, killed, respawned: said the moment the game says it
function tlNotes(){ const n=S.live?.telemetry?.note; if(!n||n.n===S.tl.noteSeen) return; const first=S.tl.noteSeen===null; S.tl.noteSeen=n.n; if(first) return;
  const msg={downed:"You're downed. Get help or use a MedPen",dead:"You died",respawn:"Respawned",spawn:"Spawned in"}[n.type]; if(msg) toast(msg); }
// The status line: your ship and speed, when the game's data has them
function tlStatusExtra(){ const t=tlLive(), v=t?.vehicle; if(!v) return "";
  return `<div class="tl-status">In <b>${esc(tlShipName(v))}</b> · ${Math.round(v.speed||0).toLocaleString()} m/s${v.q_fuel!=null?` · QT fuel ${tlPct(v.q_fuel)}%`:""}</div>`; }
// The Cart: what you have against what it costs (balance kept from the last time the game sent it)
function tlBalanceHtml(total){ const b=S.live?.telemetry?.balance; if(!b||b.auec==null||!total) return "";
  const short=total-b.auec;
  return `<div class="tl-cart ${short>0?"short":"ok"}"><span>You have ${Math.round(b.auec).toLocaleString()} aUEC</span><b>${short>0?`${Math.round(short).toLocaleString()} short`:"Enough"}</b></div>`; }
setInterval(()=>{ try{ tlRender(); tlNotes(); }catch(e){ console.warn("telemetry",e); } },500);
