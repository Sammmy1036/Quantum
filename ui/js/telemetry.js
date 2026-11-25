// Quantum UI: Star Citizen's local game telemetry (game/telemetry.py, api_telemetry.py). On by default.
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
// Quantum fuel: the game sends 0 all the time at the moment (a game bug), so it's left out while it reads 0
const TL_VTYPE={ground:"Ground vehicle",gravlev:"Grav-lev vehicle",boat:"Boat"};
const tlSpd=v=>v.flight_data===false?(TL_VTYPE[v.type]||"No speed data"):`${Math.round(v.speed||0).toLocaleString()} m/s`;
const tlQt=v=>v&&v.q_fuel?tlPct(v.q_fuel):null;

// ---- Settings: three stages. Before the game's side is switched on: "Set up the game for me". Set up but no data yet:
// a "done" note with what's left (restart the launcher and the game, spawn in). Once data has come in once: "Enabled".
function tlCfgLoad(force){ const now=Date.now(); if(S.tl.cfgBusy||(!force&&S.tl.cfg&&now-(S.tl.cfgAt||0)<3000)) return;
  S.tl.cfgBusy=true; S.tl.cfgAt=now;
  api().telemetry_status().then(x=>{ S.tl.cfgBusy=false; const k=JSON.stringify(x); if(k===S.tl.cfgKey) return; S.tl.cfgKey=k; S.tl.cfg=x;
    // (its fps and age change every few seconds: the redraw keeps the Bar items list where you scrolled it)
    if(S.selected?.kind==="settings") keepScroll($("detail"),renderDetail); }).catch(()=>{ S.tl.cfgBusy=false; }); }
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
    body=`<div class="tl-ready"><div class="tl-badge">${ok}Enabled</div><div><b>Game telemetry connected</b><div class="muted">${esc(bad?"":now)}</div></div><span class="dot ${st==="connected"?"on":st==="error"||st==="no_grpc"?"warn":""}" style="margin-left:auto"></span></div>
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
      <div class="muted" style="font-size:12px;margin-top:6px;line-height:1.5">Star Citizen can share your ship's and your character's state. With this on, Quantum shows a live data (speed, fuel, shields, hull, warning lights, NAV/SCM, your health, oxygen, satiety and hydration), also ship stats, your aUEC balance, and being downed or killed the moment it happens.
        Quantum only reads data and never sends anything to the game.</div>
      ${on?`<div style="margin-top:10px">${body}</div>
        ${(live?.error||t.state?.error)&&st==="error"?`<div class="tl-small" style="color:#ffb3b3;margin-top:6px">${esc(live?.error||t.state.error)}</div>`:""}
        <details class="tl-adv" ${S.tl.advOpen?"open":""} ontoggle="S.tl.advOpen=this.open"><summary>Advanced</summary><div class="row" style="gap:8px;margin-top:8px;align-items:center"><span class="muted tl-small">Port</span><input class="field" id="s-tlport" inputmode="numeric" value="${esc(String(t.port||2942))}" style="width:90px"><span class="muted tl-small">2942 is default port</span></div></details>${tlStylePicker()}`:""}
    </div>`; }
function tlSettingsWire(d){ const cb=d.querySelector("#s-tlon"); if(!cb) return;
  for(const b of d.querySelectorAll("[data-tlsty]")) b.onclick=e=>{ e.preventDefault(); const [k,v]=b.dataset.tlsty.split(":"); if(tlStyle()[k]===v) return;
    tlSetStyle(k,v); renderDetail(); toast(k==="pos"?`Player stats: ${TL_POS.find(x=>x[0]===v)[1]}`:`Player stats look: ${TL_LOOKS.find(x=>x[0]===v)[1]}`); };
  const sc=d.querySelector("#s-tlshipcard"); if(sc) sc.onchange=()=>{ tlLS("q-tl-shipcard",sc.checked?"1":"0"); tlSave({shipcard:sc.checked}); tlRerender(); };
  tlItemsWire(d);
  const mo=d.querySelector("#s-tlmaponly"); if(mo) mo.onchange=()=>{ tlLS("q-tl-maponly",mo.checked?"1":"0"); tlSave({maponly:mo.checked}); tlRerender(); };
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
  // ship gauges: hydrogen (an H2 tank), quantum fuel, boost, shields, hull, speed
  h2:'<svg class="tl-ic sh" viewBox="0 0 24 24" aria-hidden="true"><rect class="l" x="5" y="5" width="14" height="16.5" rx="4"/><path class="l" d="M9 5V2.5h6V5"/><text x="12" y="16.6" class="t">H2</text></svg>',
  qt:'<svg class="tl-ic sh" viewBox="0 0 24 24" aria-hidden="true"><circle class="l" cx="12" cy="12" r="8.5"/><path class="l" d="M12 3.5v4M12 16.5v4M3.5 12h4M16.5 12h4"/><circle class="f" cx="12" cy="12" r="2.2"/></svg>',
  boost:'<svg class="tl-ic sh" viewBox="0 0 24 24" aria-hidden="true"><path class="l" d="M4 7l6 5-6 5M12 7l6 5-6 5"/></svg>',
  shield:'<svg class="tl-ic sh" viewBox="0 0 24 24" aria-hidden="true"><path class="l" d="M12 2.8l7.5 3v5.6c0 4.8-3.2 8.3-7.5 9.9-4.3-1.6-7.5-5.1-7.5-9.9V5.8z"/></svg>',
  hull:'<svg class="tl-ic sh" viewBox="0 0 24 24" aria-hidden="true"><path class="l" d="M12 2.5l3 7 6.5 4.2-6.5.8-3 7-3-7-6.5-.8L9 9.5z"/></svg>',
  speed:'<svg class="tl-ic sh" viewBox="0 0 24 24" aria-hidden="true"><path class="l" d="M3.5 17a8.5 8.5 0 1 1 17 0"/><path class="l" d="M12 17l4.5-6"/><circle class="f" cx="12" cy="17" r="1.6"/></svg>',
  food:'<svg class="tl-ic" viewBox="0 0 24 24" aria-hidden="true"><path class="l" d="M6 1.8l3.6 2.1v4.2L6 10.2 2.4 8.1V3.9z"/><path class="l" d="M6 12.8l3.6 2.1v4.2L6 21.2l-3.6-2.1v-4.2z"/><circle class="f" cx="6" cy="6" r="1.2"/><circle class="f" cx="6" cy="17" r="1.2"/><path class="f" d="M21.5 3.5C14 3.5 11.5 8.6 11.5 13c0 3.6 2.4 6.5 5.6 6.5 4.6 0 5.6-7.4 4.4-16z"/><path class="k" d="M13.2 21c1.3-5.2 3.5-9.6 6.6-13.6"/></svg>'
};
function tlBar(label,pct,cls,txt,ic){ return pct==null?"":`<div class="tl-bar ${cls||""}"><span>${ic?TL_IC[ic]:""}${label}</span><div><i style="width:${pct}%"></i></div><b>${txt??pct+"%"}</b></div>`; }
const TL_WARN_CLS={nominal:"ok",minor:"minor",minor_flashing:"minor blink",major:"major",major_flashing:"major blink"};
function tlCardHtml(t){ const v=t.vehicle, a=t.actor||{}, w=t.weapons;
  const head=`<div class="tl-h"><span class="dot on"></span><b>${tlStyle().pos==="float"&&tlStyle().look!=="compact"?"Player Stats":"Ship"}</b><span class="muted">${t.fps?`${t.fps}/s`:""}</span><span class="spacer"></span>
    <button class="iconbtn" data-tl="collapse" aria-label="${S.tl.collapsed?"Show the live card":"Hide the live card"}" title="${S.tl.collapsed?"Show":"Hide"}">${S.tl.collapsed?"▸":"▾"}</button></div>`;
  if(S.tl.collapsed) return head.replace('<span class="spacer"></span>',`<span class="tl-mini">${v?`${esc(tlShipName(v))} · ${tlSpd(v)}`:a.locomotion==="eva"?"EVA":"On foot"}</span><span class="spacer"></span>`);
  let h=head;
  if(v){ const warn=Object.entries(v.warnings||{}).filter(([,s])=>s!=="off");
    h+=`<div class="tl-sec"><div class="tl-ship"><b>${esc(tlShipName(v))}</b>${v.mode?`<span class="tl-chip ${v.mode}">${v.mode.toUpperCase()}${v.spooled?" · spooled":""}</span>`:""}${v.flight_data===false?"":`<span class="tl-chip">${v.landed?"Landed":v.gear==="deployed"?"Gear down":"Flying"}</span>`}</div>
      ${v.flight_data===false?`<div class="muted tl-small" style="margin:2px 0 6px">${TL_VTYPE[v.type]||"This vehicle"}: the game sends no speed, heading or altitude for it (only ships with a flight computer do)</div>`:""}
      ${v.flight_data===false?"":`<div class="tl-big"><div><b>${Math.round(v.speed||0).toLocaleString()}</b><span>m/s</span></div>${v.heading!=null?`<div><b>${Math.round(v.heading)}°</b><span>heading</span></div>`:""}${v.altitude!=null?`<div><b>${v.altitude>=10000?(v.altitude/1000).toFixed(1)+" km":Math.round(v.altitude)+" m"}</b><span>altitude</span></div>`:""}</div>`}
      ${tlBar("Quantum fuel",tlQt(v),"q",null,"qt")}${tlBar("Hydrogen",tlPct(v.h_fuel),"h",null,"h2")}${v.boost?tlBar("Boost",tlPct(v.boost.reserve),v.boost.critical?"bad":"b",null,"boost"):""}${v.shields?tlBar("Shields",tlPct(v.shields.level),"s",null,"shield"):""}${v.health!=null?tlBar("Hull",tlPct(v.health),tlPct(v.health)<35?"bad":"hp",null,"hull"):""}
      ${warn.length?`<div class="tl-warn">${warn.map(([k,s])=>`<span class="${TL_WARN_CLS[s]||""}" title="${esc(k)}: ${esc(s.replace("_"," "))}">${k}</span>`).join("")}</div>`:""}
      ${tlLandHtml(v,"card")}
      ${w?.countermeasures?.length?`<div class="tl-row">${w.countermeasures.map(c=>`<span>${c.n} ${c.type==="decoy"?"decoys":"noise"}</span>`).join("")}${w.preset?`<span class="muted">${esc(w.preset)}</span>`:""}</div>`:""}</div>`; }
  const y=tlYou(a), {pos,look}=tlStyle(), mine=pos==="float"&&look!=="compact";
  if(mine&&(y.any||a.auec!=null))
    h+=`<div class="tl-sec"><div class="tl-ship"><b>You</b><span class="tl-chip">${tlLoco(a)}</span></div>
      ${tlLookHtml(y,look,"card")}${look==="rings"?tlLowHtml(y):""}
      ${tlMetaHtml(a)?`<div class="tl-row">${tlMetaHtml(a)}</div>`:""}
      ${a.auec!=null?tlCardBal(a):""}</div>`;
  else if(pos==="float"&&a.auec!=null&&v) h+=`<div class="tl-sec">${tlCardBal(a)}</div>`;
  return h; }
// ---- your stats: where they go (floating on the map, or a bar along an edge of the window, seen on every page)
// and how they look (bars, tiles, rings, compact). Settings › Game telemetry › Player stats.
const TL_POS=[["float","On the map","A card over the map"],["top","Top bar","Along the top of the window"],["bottom","Bottom bar","Along the bottom of the window"],["left","Left bar","Beside the side panel"],["right","Right bar","Down the right edge"]];
const TL_LOOKS=[["bars","Bars","Icon, name and a bar"],["tiles","Tiles","Like the in-game HUD"],["rings","Rings","Round gauges"],["compact","Compact","Icon and number only"]];
function tlLS(k,v){ try{ if(v===undefined) return localStorage.getItem(k); localStorage.setItem(k,v); }catch(_){ return null; } }
// The choice is kept in settings.json (and the page's own storage, so it's there before settings.json is read)
function tlStyle(){ if(S.tl.pos&&S.tl.look) return {pos:S.tl.pos,look:S.tl.look};
  let pos=tlLS("q-tl-pos"), look=tlLS("q-tl-look");
  if(!pos||!look){ const old=tlLS("q-tl-style");            // update 8 kept one setting for both
    const m={strip:{pos:"bottom",look:"bars"},rail:{pos:"float",look:"compact"},tiles:{pos:"float",look:"tiles"},rings:{pos:"float",look:"rings"},bars:{pos:"float",look:"bars"}}[old];
    pos=pos||m?.pos||"top"; look=look||m?.look||"bars"; }
  S.tl.pos=TL_POS.some(x=>x[0]===pos)?pos:"top"; S.tl.look=TL_LOOKS.some(x=>x[0]===look)?look:"bars";
  return {pos:S.tl.pos,look:S.tl.look}; }
function tlSave(prefs){ try{ api().telemetry_ui_set(prefs); }catch(_){} }
function tlSetStyle(k,v){ tlStyle(); S.tl[k]=v; tlLS(k==="pos"?"q-tl-pos":"q-tl-look",v); tlSave({[k]:v}); tlRerender(); }
function tlRerender(){ for(const id of ["tl-card","tl-rail","tl-dock"]){ const e=$(id); if(e) e.dataset.k=""; } tlRender(); }
const tlShipCardOn=()=>tlLS("q-tl-shipcard")==="1";       // off unless ticked: the bar already shows the ship
const tlMapOnly=()=>tlLS("q-tl-maponly")==="1";
// settings.json wins over the page's storage (that can be lost with the webview cache)
async function tlUiLoad(){ let u; try{ u=await api().telemetry_ui_get(); }catch(_){ return; } if(!u||!Object.keys(u).length){
    const {pos,look}=tlStyle(); tlSave({pos,look,shipcard:tlShipCardOn(),maponly:tlMapOnly(),v:2}); return; }
  if(u.v!==2){ u.shipcard=false; tlSave({shipcard:false,v:2}); }     // update 12 saved the ship card as on for everyone
  if(u.pos){ S.tl.pos=u.pos; tlLS("q-tl-pos",u.pos); } if(u.look){ S.tl.look=u.look; tlLS("q-tl-look",u.look); }
  if(u.items){ S.tl.items=tlItemsFix(u.items); tlLS("q-tl-items",JSON.stringify(S.tl.items)); }
  if(u.shipcard!=null) tlLS("q-tl-shipcard",u.shipcard?"1":"0"); if(u.maponly!=null) tlLS("q-tl-maponly",u.maponly?"1":"0");
  tlRerender(); }
setTimeout(tlUiLoad,800);
const tlLoco=a=>({on_foot:"On foot",eva:"EVA",seated:a.role?`Seated · ${a.role}`:"Seated"}[a.locomotion]||"–");
function tlYou(a){ const gp=g=>g&&g.max?Math.max(0,Math.min(100,Math.round(g.cur/g.max*100))):null;
  // satiety and hydration change colour like the game's: blue when you're fine, orange around half, red when low
  const rows=[["hp","Health",gp(a.health),35],["o2","Oxygen",gp(a.oxygen),25],["food","Satiety",gp(a.hunger),30,60],["drink","Hydration",gp(a.thirst),30,60]]
    .filter(r=>r[2]!=null).map(([k,label,v,low,mid])=>({k,label,v,low:v<low,mid:!!mid&&v>=low&&v<mid}));
  return {rows,any:rows.length>0}; }
function tlMetaHtml(a){ const bt=a.body_temp&&a.body_temp.cur;
  return `${bt?`<span class="tl-mi">${tlTempIc(bt)}Body ${bt.toFixed(1)}°C</span>`:""}${a.outside_temp!=null?`<span>Outside ${Math.round(a.outside_temp)}°C</span>`:""}${a.breathable===false&&a.locomotion!=="seated"?`<span class="bad">Not breathable</span>`:""}${a.radiation?`<span class="tl-mi ${a.radiation>0.5?"bad":""}">${tlIc("rad")}Radiation ${a.radiation}</span>`:""}${a.heart_rate!=null&&(a.heart_rate||a.health?.cur===0)?`<span class="tl-mi bpm">${tlIc("bpm",a.heart_rate)}${a.heart_rate} bpm</span>`:""}`; }
const tlCls=r=>`tls-${r.k}${r.low?" bad":r.mid?" mid":""}`;
// Star Citizen's own HUD icons (from the game's UI files), drawn in the stat's colour: their pale blue is currentColor
const HUD_SVG={
  "Lungs":{vb:"-4 -8.7 57.7 57.7",body:`<path fill="currentColor" d="M24.6,2c0.5,0,0.9,0.1,1.4,0.2c0.3,0.1,0.5,0.8,0.5,1.3c0,3.6,0.1,7.3,0,10.9c0,1,0.3,1.7,1.2,2.2 c0.5,0.3,1,0.6,1.7,1.1c0-0.9,0-1.7,0-2.5c0-0.8,0-1.6,0.1-2.4c0.3-1.9,1.4-3.1,3.2-3.7c0.7-0.2,1.4-0.4,2.1-0.4 c1.2,0,2.3,0.4,3.1,1.5c1.7,2.3,3.3,4.7,4.7,7.2c2.3,4.1,4,8.5,5,13.1c0,0.1,0.5,2-0.5,3.8c-1.1,2.4-3.7,3.9-6.3,3.9 c-0.5,0-0.9,0-1.4-0.1c-1.7-0.4-3.4-0.8-5.1-1.4c-2.8-0.9-4.6-2.9-4.8-5.9c-0.1-2.1,0-6.4,0-6.4l0-2.8c-1.6-1.1-3-2-4.6-3 c-1.5,1-3,2-4.6,3l0,2.9c0,0,0.1,4.8-0.2,7.2c-0.3,2.7-2.2,4.3-4.8,5.1c-1.6,0.5-3.2,0.9-4.8,1.3c-0.5,0.1-1,0.1-1.5,0.1 c-4.2,0-8.1-3.5-6.7-8.7C4,23,6.9,17,10.7,11.4c1.3-1.9,2.9-2.7,4.5-2.7c0.9,0,1.7,0.2,2.5,0.6c1.8,0.9,2.5,2.5,2.6,4.4 c0,1.2,0,2.4,0,3.9c0.9-0.7,1.8-1.2,2.5-1.8c0.3-0.2,0.3-0.8,0.3-1.2c0-3.7,0-7.4,0-11.1c0-0.6,0-1.3,0.6-1.4C24,2,24.3,2,24.6,2 M24.6,0c-0.5,0-0.9,0-1.3,0.1c-1,0.2-2.2,1-2.2,3.3l0,0.1l0,1.6c0,1.5,0,3.1,0,4.6c-0.6-0.9-1.4-1.6-2.5-2.2 c-1.1-0.6-2.3-0.9-3.4-0.9c-2.4,0-4.6,1.3-6.1,3.6C4.9,16.4,2.1,22.6,0.4,29c-0.8,2.8-0.3,5.6,1.4,7.7c1.7,2.2,4.4,3.5,7.3,3.5 c0.6,0,1.3-0.1,1.9-0.2c1.5-0.3,3.1-0.7,5-1.3c3.6-1.1,5.8-3.5,6.2-6.8c0.3-2.5,0.2-7.2,0.2-7.4l0-1.8l0.7-0.4l1.9-1.3l1.6,1.1 l0.9,0.6l0,1.7c0,0.4-0.1,4.5,0,6.6c0.2,3.7,2.4,6.4,6.1,7.7c1.9,0.6,3.7,1.1,5.4,1.4c0.6,0.1,1.2,0.2,1.8,0.2c3.5,0,6.7-2,8.1-5 c1.2-2.2,0.8-4.5,0.7-5.2c-1.2-5-2.9-9.6-5.2-13.6c-1.6-2.9-3.2-5.3-4.8-7.5c-1.1-1.5-2.8-2.3-4.7-2.3c-0.9,0-1.8,0.2-2.7,0.5 c-1.5,0.5-2.7,1.4-3.5,2.5c0-1.9,0-3.9,0-6.3c0-0.1,0-2.7-2-3.2C25.9,0.1,25.3,0,24.6,0L24.6,0z"/>`},
  "HealthIcon":{vb:"0 0 128 128",body:`<polygon transform="translate(64 64) scale(.74) translate(-64 -64)" fill="currentColor" points="122.2,52 76,52 76,5.8 52,5.8 52,52 5.8,52 5.8,76 52,76 52,122.2 76,122.2 76,76 122.2,76 "/>`},
  "pulse":{vb:"0 0 128 128",body:`<polygon fill="currentColor" points="84.4,120.3 64.2,28.7 46.2,100.6 34.1,68.1 25.4,74.6 0,74.6 0,70.6 24,70.6 35.9,61.7 45.4,87.2 64.4,11.3 84.6,102.7 94.7,62.2 100,70.6 128,70.6 128,74.6 97.8,74.6 96.3,72.2 "/>`},
  "flatline":{vb:"0 0 128 128",body:`<polygon fill="currentColor" points="1,71.6 1,68.6 127,68.6 127,71.6 "/>`},
  "StarvationSmall":{vb:"0 0 64 64",body:`<path fill="currentColor" d="M24.4,36.4c-0.1-0.1-0.3-0.3-0.5-0.4h0h-1.5c-0.1,0-0.4,0.2-0.5,0.4V37h2.5V36.4L24.4,36.4z M25.6,15.6h-2.1 v1.5h2.1c0,0,0.3-0.2,0.3-0.3v-0.9C25.9,15.8,25.7,15.6,25.6,15.6z M25.7,18.5h-2.1V20h2.1c0,0,0.3-0.1,0.3-0.3c0,0,0,0,0,0v-0.8 C25.9,18.7,25.7,18.6,25.7,18.5z M25.7,18.5h-2.1V20h2.1c0,0,0.3-0.1,0.3-0.3c0,0,0,0,0,0v-0.8C25.9,18.7,25.7,18.6,25.7,18.5z M25.6,15.6h-2.1v1.5h2.1c0,0,0.3-0.2,0.3-0.3v-0.9C25.9,15.8,25.7,15.6,25.6,15.6z M24.4,36.4c-0.1-0.1-0.3-0.3-0.5-0.4h0h-1.5 c-0.1,0-0.4,0.2-0.5,0.4V37h2.5V36.4L24.4,36.4z M24.4,36.4c-0.1-0.1-0.3-0.3-0.5-0.4h0h-1.5c-0.1,0-0.4,0.2-0.5,0.4V37h2.5V36.4 L24.4,36.4z M25.6,15.6h-2.1v1.5h2.1c0,0,0.3-0.2,0.3-0.3v-0.9C25.9,15.8,25.7,15.6,25.6,15.6z M25.7,18.5h-2.1V20h2.1 c0,0,0.3-0.1,0.3-0.3c0,0,0,0,0,0v-0.8C25.9,18.7,25.7,18.6,25.7,18.5z M25.7,18.5h-2.1V20h2.1c0,0,0.3-0.1,0.3-0.3c0,0,0,0,0,0 v-0.8C25.9,18.7,25.7,18.6,25.7,18.5z M25.6,15.6h-2.1v1.5h2.1c0,0,0.3-0.2,0.3-0.3v-0.9C25.9,15.8,25.7,15.6,25.6,15.6z M24.4,36.4 c-0.1-0.1-0.3-0.3-0.5-0.4h0h-1.5c-0.1,0-0.4,0.2-0.5,0.4V37h2.5V36.4L24.4,36.4z M26.8,26.8l7.8-4.5v-9l-7.8-4.5L19,13.3v9l3.8,2.2 l-1.3,2.6l-2.2-1.3l-9.5,5.5v11l9.5,5.5l5.5-3.2l2.1,2.3l-1.1,0.7v5l4.4,2.5l4.4-2.5v-5l-4.4-2.5l-1.7,1L26.3,44l2.6-1.5v-11l-6-3.4 l1.3-2.6L26.8,26.8z M28.4,14.2h3.1v7.3h-1.6v-5.8h-1.5V14.2z M19.3,33.7H15v2h4.1v1.7H15v3.7h-2v-9.3h6.4L19.3,33.7L19.3,33.7z M23.9,34.3c0.4,0,0.9,0.1,1.3,0.4c0.3,0.2,0.7,0.6,0.8,0.8c0.2,0.3,0.3,0.6,0.3,1v2.2h-4.4v0.5c0.1,0.2,0.4,0.4,0.5,0.4H24 c0.1,0,0.4-0.2,0.5-0.4c0,0,0,0,0,0l0-0.1l0.1,0l1.7,0.5l-0.1,0.1c-0.2,0.4-0.8,1-1.1,1.2c-0.4,0.2-0.8,0.4-1.2,0.4h-1.5 c-0.5,0-0.9-0.1-1.3-0.3c-0.3-0.2-0.7-0.6-0.8-0.8c-0.2-0.3-0.3-0.7-0.3-1v-2.7c0-0.4,0.1-0.7,0.3-1c0.1-0.2,0.5-0.6,0.8-0.8 c0.3-0.2,0.8-0.4,1.3-0.4L23.9,34.3L23.9,34.3z M22,21.5v-7.3h3.7c0.3,0,0.7,0.1,1,0.3c0.2,0.1,0.6,0.5,0.7,0.7 c0.2,0.3,0.3,0.6,0.3,0.8v0.9c0,0.5-0.2,0.8-0.4,1c0.3,0.3,0.4,0.5,0.4,1v0.9c0,0.3-0.1,0.6-0.3,0.8l0,0c-0.1,0.1-0.5,0.5-0.7,0.7 c-0.3,0.2-0.7,0.3-1,0.3C25.7,21.5,22,21.5,22,21.5z M26,19.7L26,19.7v-0.9c-0.1-0.1-0.3-0.3-0.4-0.3h-2.1V20h2.1 C25.7,20,25.9,19.9,26,19.7z M26,16.8V16c-0.1-0.2-0.3-0.3-0.4-0.3h-2.1v1.5h2.1C25.7,17.1,25.9,17,26,16.8z M21.9,36.4V37h2.5v-0.6 v0c-0.1-0.1-0.3-0.3-0.5-0.4h0h-1.5C22.3,36,22.1,36.2,21.9,36.4z M24.4,36.4c-0.1-0.1-0.3-0.3-0.5-0.4h0h-1.5 c-0.1,0-0.4,0.2-0.5,0.4V37h2.5V36.4L24.4,36.4z M25.6,15.6h-2.1v1.5h2.1c0,0,0.3-0.2,0.3-0.3v-0.9C25.9,15.8,25.7,15.6,25.6,15.6z M25.7,18.5h-2.1V20h2.1c0,0,0.3-0.1,0.3-0.3c0,0,0,0,0,0v-0.8C25.9,18.7,25.7,18.6,25.7,18.5z M25.7,18.5h-2.1V20h2.1 c0,0,0.3-0.1,0.3-0.3c0,0,0,0,0,0v-0.8C25.9,18.7,25.7,18.6,25.7,18.5z M25.6,15.6h-2.1v1.5h2.1c0,0,0.3-0.2,0.3-0.3v-0.9 C25.9,15.8,25.7,15.6,25.6,15.6z M24.4,36.4c-0.1-0.1-0.3-0.3-0.5-0.4h0h-1.5c-0.1,0-0.4,0.2-0.5,0.4V37h2.5V36.4L24.4,36.4z M24.4,36.4c-0.1-0.1-0.3-0.3-0.5-0.4h0h-1.5c-0.1,0-0.4,0.2-0.5,0.4V37h2.5V36.4L24.4,36.4z M24.4,36.4c-0.1-0.1-0.3-0.3-0.5-0.4h0 h-1.5c-0.1,0-0.4,0.2-0.5,0.4V37h2.5V36.4L24.4,36.4z M42.3,52.5C42.3,52.5,42.2,52.5,42.3,52.5c1.1-1.3,2.9-3.6,4.4-6.7 c1.7-1.2,6.4-5.1,7.1-10.7c-1.1,4.3-4.6,7.5-6.3,8.8c1.1-2.8,1.9-6,1.8-9.4c0.5-0.9,2.6-4.7,1.5-8.4c0.6,3.2-1.1,6-1.6,6.8 c-0.5-4.1-2.5-8.6-6.8-13c3.4,4.6,4.9,8.9,5.3,12.8c-3.3-6.2-9.3-7.5-9.6-7.5c0.2,0.1,7.8,2.9,9.7,10.2c-0.1,3.1-0.9,5.9-2.1,8.3 c-1.6-9.8-10.2-12-10.2-12s9.1,4.4,9.1,14.2c-1.2,2.2-2.6,4-3.8,5.3c-2.3-2.1-6.3-6.9-6.3-13.6c0-10.8,4.9-13.7,2.4-22.3 c1.5,0.9,14.9,5,17.1,18.9C56.2,48.2,42.3,52.5,42.3,52.5z"/>`},
  "Dehydration":{vb:"0 0 128 128",body:`<path fill="currentColor" d="M48.9,43.6c-3.7,5.4-7.5,10.5-11,15.4c-0.8,0.1-1.5,0.2-2.3,0.2c-7.5,0-13.5-5.6-13.5-13.9 c0-8.4,11-15.2,13.5-26.7C37.9,29.3,47.6,36,48.9,43.6z M67.9,17.2C61.1,48.5,31,67.3,31,90.1c0,22.8,16.5,38,36.9,38 c20.4,0,36.9-15.2,36.9-38C104.8,67.3,74.7,48.5,67.9,17.2z M88.4,0c-1.6,7.5-8.9,12-8.9,17.5c0,5.5,4,9.1,8.9,9.1 c4.9,0,8.9-3.7,8.9-9.1C97.3,12,90,7.5,88.4,0z"/>`},
  "TempBodyBulb":{vb:"0 0 128 128",body:`<path fill="currentColor" d="M68.8,107.6V0h-9.6v107.6c-3.5,1.8-5.9,5.4-5.9,9.6c0,5.9,4.8,10.7,10.7,10.7s10.7-4.8,10.7-10.7 C74.7,113,72.3,109.4,68.8,107.6z"/>`},
  "TempBodyRange":{vb:"0 0 128 128",body:`<rect x="65.8" y="62.2" fill="currentColor" width="6.3" height="4"/><rect x="58.7" y="54.6" fill="currentColor" width="4" height="21.4"/>`},
  "TempBodyRange-Hot":{vb:"0 0 128 128",body:`<g><path fill="#FF2800" d="M62.7,50.8h-4V7.9c0-4.1,3.4-7.5,7.5-7.5H69v4h-2.9c-1.9,0-3.5,1.6-3.5,3.5v42.9H62.7z"/></g><rect x="65.8" y="30.7" fill="#FF2800" width="6.3" height="4"/>`},
  "TempBodyRange-Cold":{vb:"0 0 128 128",body:`<g><path fill="#2572EB" d="M69,128.3h-2.9c-4.1,0-7.5-3.4-7.5-7.5V79.6h4v41.3c0,1.9,1.6,3.5,3.5,3.5H69V128.3z"/></g><rect x="65.8" y="93.7" fill="#2572EB" width="6.3" height="4"/>`},
  "Radiation":{vb:"0 0 63.37 59.13",body:`<g><g><g><path fill="currentColor" d="M31.69,20.3c2.07,0,4.01,0.56,5.68,1.52L47.51,4.24C42.85,1.55,37.45,0,31.69,0 c-5.78,0-11.19,1.56-15.86,4.26l10.16,17.58C27.66,20.86,29.61,20.3,31.69,20.3z"/><path fill="currentColor" d="M63.37,31.67l-20.3,0.01c0,0,0,0,0,0.01c0,4.21-2.29,7.88-5.69,9.85l10.16,17.58 C57,53.63,63.37,43.41,63.37,31.69C63.37,31.68,63.37,31.67,63.37,31.67z"/><path fill="currentColor" d="M20.3,31.69L0,31.71c0.01,11.73,6.39,21.95,15.86,27.43L26,41.54C22.6,39.58,20.31,35.9,20.3,31.69z"/></g><circle fill="currentColor" cx="31.67" cy="31.19" r="7.62"/></g></g>`},
};
// The heartbeat (next to bpm) goes flat at 0.
function tlSvg(name,extra){ const g=HUD_SVG[name]; if(!g) return "";
  return `<svg class="tl-ic gic" viewBox="${g.vb}" aria-hidden="true">${g.body}${extra||""}</svg>`; }
function tlIc(k,v){ if(k==="hp") return tlSvg("HealthIcon")||TL_IC.hp;
  if(k==="bpm") return tlSvg(v===0?"flatline":"pulse");
  if(k==="o2") return tlSvg("Lungs")||TL_IC.o2;
  if(k==="food") return tlSvg("StarvationSmall")||TL_IC.food;
  if(k==="drink") return tlSvg("Dehydration")||TL_IC.drink;
  if(k==="temp") return tlSvg("TempBodyBulb");
  if(k==="rad") return tlSvg("Radiation");
  return TL_IC[k]||""; }
// thermometer: the plain mark, or the game's red (too hot) / blue (too cold) one. The lines are a guess at
// where the game starts warning; the body temperature it sends is around 36-37 °C when you're fine.
function tlTempIc(c){ const r=c>=38.5?"TempBodyRange-Hot":c<=35?"TempBodyRange-Cold":"TempBodyRange", g=HUD_SVG;
  return g&&g.TempBodyBulb?`<svg class="tl-ic gic t" viewBox="0 0 128 128" aria-hidden="true">${g.TempBodyBulb.body}${g[r]?g[r].body:""}</svg>`:""; }
function tlBarsHtml(y){ return y.rows.map(r=>`<div class="tl-bar ${r.k} ${r.low?"bad":""} ${tlCls(r)}" data-it="${r.k}"><span>${tlIc(r.k,r.v)}${r.label}</span><div><i style="width:${r.v}%"></i></div><b>${r.v}%</b></div>`).join(""); }
function tlChipsHtml(y){ return y.rows.map(r=>`<div class="tl-chipstat ${tlCls(r)}" data-it="${r.k}" title="${r.label} ${r.v}%">${tlIc(r.k,r.v)}<div><div class="tl-cs-t"><span>${r.label}</span><b>${r.v}%</b></div><div class="tl-cs-b"><i style="width:${r.v}%"></i></div></div></div>`).join(""); }
function tlTilesHtml(y){ return `<div class="tl-tiles">${y.rows.map(r=>`<div class="tl-tile ${tlCls(r)}" data-it="${r.k}" title="${r.label} ${r.v}%"><div class="tl-tile-top">${tlIc(r.k,r.v)}<div class="tl-vm"><i style="height:${r.v}%"></i></div></div><b>${r.v}%</b><span>${r.label}</span></div>`).join("")}</div>`; }
function tlRingsHtml(y){ const C=2*Math.PI*22;
  return `<div class="tl-rings">${y.rows.map(r=>`<div class="tl-ring ${tlCls(r)}" data-it="${r.k}" title="${r.label} ${r.v}%"><div class="tl-ring-g"><svg viewBox="0 0 54 54" aria-hidden="true"><circle cx="27" cy="27" r="22"/><circle class="v" cx="27" cy="27" r="22" stroke-dasharray="${(C*r.v/100).toFixed(1)} ${C.toFixed(1)}"/></svg>${tlIc(r.k,r.v)}</div><b>${r.v}%</b><span>${r.label}</span></div>`).join("")}</div>`; }
function tlCompactHtml(y,fly){ return `<div class="tl-compact">${y.rows.map(r=>`<div class="tl-railit ${tlCls(r)}" data-it="${r.k}" tabindex="0" aria-label="${r.label} ${r.v}%">${tlIc(r.k,r.v)}<b>${r.v}</b><div class="tl-rb"><i style="width:${r.v}%"></i></div>
    ${fly?`<div class="tl-fly"><div class="tl-fly-h">${tlIc(r.k,r.v)}<b>${r.label}</b><b class="tl-fly-v">${r.v}%</b></div><div class="tl-rb"><i style="width:${r.v}%"></i></div>${r.low?`<div class="tl-fly-d">${TL_LOW[r.k][1]}.</div>`:""}</div>`:""}</div>`).join("")}</div>`; }
const TL_LOW={hp:["Hurt","Use a MedPen or get to a med bed"],o2:["Low oxygen","Get somewhere breathable or swap your tank"],food:["Hungry","Eat something soon"],drink:["Thirsty","Drink something soon"]};
function tlLowHtml(y){ const r=y.rows.find(x=>x.low); if(!r) return ""; const [t,d]=TL_LOW[r.k];
  return `<div class="tl-low tls-${r.k} bad">${tlIc(r.k,r.v)}<span><b>${t}</b> · ${r.label} ${r.v}%. ${d}.</span></div>`; }
// a look, for the card (wide), a bar along the top or bottom (h) or one down a side (v)
function tlLookHtml(y,look,where){
  if(look==="tiles") return tlTilesHtml(y);
  if(look==="rings") return tlRingsHtml(y);
  if(look==="compact") return tlCompactHtml(y,where!=="h");
  return where==="card"?tlBarsHtml(y):`<div class="tl-chips">${tlChipsHtml(y)}</div>`; }
const tlShort=n=>n>=1e6?(n/1e6).toFixed(n>=1e7?0:1)+"M":n>=1e4?Math.round(n/1e3)+"k":Math.round(n).toLocaleString();
// ---- the bar's items: each one can be switched off and moved (Settings › Game telemetry › Bar items).
// Neighbouring vitals share one group, as do neighbouring ship gauges, so the bar keeps its look.
// kind: v = a vital (your stats, in the chosen look), g = a ship gauge, s = its own spot
const TL_ITEMS=[
  ["head","s","Status Label",true],["hp","v","Health",true],["o2","v","Oxygen",true],["food","v","Satiety",true],["drink","v","Hydration",true],
  ["meta","s","Temperature, radiation, heart rate",true],["steer","s","Live Guidance",true],["land","s","Landing aids",true],
  ["auec","s","aUEC balance",true],["ship","s","Ship name",true],["speed","s","Speed (m/s)",true],["heading","s","Heading",true],
  ["alt","s","Altitude",false],["mode","s","NAV / SCM mode",false],
  ["q","g","Quantum fuel",true],["h","g","Hydrogen",true],["b","g","Boost",true],["s","g","Shields",true],["hull","g","Hull",true]];
const TL_ITEM=Object.fromEntries(TL_ITEMS.map(x=>[x[0],x]));
// {order:[ids], off:{id:true}}: new items (from a later update) are added in their default place, on by default
function tlItems(){ if(S.tl.items) return S.tl.items; let st=null; try{ st=JSON.parse(tlLS("q-tl-items")||"null"); }catch(_){}
  return S.tl.items=tlItemsFix(st); }
function tlItemsFix(st){ const order=(st?.order||[]).filter(id=>TL_ITEM[id]), off={...(st?.off||{})};
  if(!st) for(const [id,,,on] of TL_ITEMS) if(!on) off[id]=true;
  const hi=order.indexOf("head"); if(hi>0){ order.splice(hi,1); order.unshift("head"); }      // the LIVE label stays first
  TL_ITEMS.forEach(([id,,,on],i)=>{ if(order.includes(id)) return;
    if(st&&!on) off[id]=true;
    const prev=TL_ITEMS.slice(0,i).reverse().find(x=>order.includes(x[0]));          // keep it near its default neighbour
    order.splice(prev?order.indexOf(prev[0])+1:0,0,id); });
  return {order,off}; }
function tlItemsSave(st){ S.tl.items=tlItemsFix(st); tlLS("q-tl-items",JSON.stringify(S.tl.items)); tlSave({items:S.tl.items}); tlRerender(); }
const tlOn=id=>!tlItems().off[id];
const tlHdg=h=>`${String(Math.round(((h%360)+360)%360)).padStart(3,"0")}°`;
function tlGauge(v,id){ if(!v) return null;
  if(id==="q") return {l:"QT fuel",p:tlQt(v)}; if(id==="h") return {l:"Hydrogen",p:tlPct(v.h_fuel)};
  if(id==="b") return v.boost?{l:"Boost",p:tlPct(v.boost.reserve),bad:v.boost.critical,on:v.boost.on}:null;
  if(id==="s") return v.shields?{l:"Shields",p:tlPct(v.shields.level)}:null;
  if(id==="hull") return v.health!=null?{l:"Hull",p:tlPct(v.health),bad:tlPct(v.health)<35}:null; return null; }
const TL_GIC={q:"qt",h:"h2",b:"boost",s:"shield",hull:"hull"};
function tlGaugeHtml(id,g,small){ const c=id==="hull"?"hp":id;
  if(small) return `<div class="tl-railit ship tls-${c}${g.bad?" bad":""}" data-it="${id}" title="${g.l} ${g.p}%">${TL_IC[TL_GIC[id]]||""}<b>${g.p}</b><div class="tl-rb"><i style="width:${g.p}%"></i></div></div>`;
  return `<div class="tl-chipstat ship tls-${c}${g.bad?" bad":""}${g.on?" boosting":""}" data-it="${id}" title="${g.l} ${g.p}%">${TL_IC[TL_GIC[id]]||""}<div><div class="tl-cs-t"><span>${g.l}</span><b>${g.p}%</b></div><div class="tl-cs-b"><i style="width:${g.p}%"></i></div></div></div>`; }
// one item on its own -> html, or "" when there's nothing to show for it right now
function tlSoloHtml(id,t,look,o,small){ const a=t.actor||{}, v=t.vehicle, fl=v&&v.flight_data!==false;
  switch(id){
    case "head":{ const fresh=t.fps==null||t.fps>0, tip=fresh?`Live from the game${t.fps?` (${t.fps} updates a second)`:""}`:"No new data from the game right now";
      return `<div class="tl-dk-h" title="${tip}"><span class="tl-live ${fresh?"on":""}"></span>${small?"<b class=\"tl-live-t\">LIVE</b>":"<b>Player Stats</b>"}</div>`; }
    case "meta":{ const m=tlMetaHtml(a); return m&&!small?`<div class="tl-dk-g tl-dk-meta" data-it="meta">${m}</div>`:""; }
    case "steer": return small?"":tlSteerDock(tlSteer(),o);
    case "land": return v&&tlLanding(v)?(small?`<div class="tl-dk-g tl-dk-ship" data-it="land">${tlLandHtml(v,"tiny")}</div>`:`<div class="tl-dk-g tl-dk-land" data-it="land">${tlLandHtml(v,o)}</div>`):"";
    case "auec":{ if(a.auec==null) return ""; const se=tlSessNet();
      return `<button type="button" class="tl-dk-g tl-dk-auec" data-it="auec" data-tlsess title="Balance · click for this session's earnings and stats"><b>${small?tlShort(a.auec):Math.round(a.auec).toLocaleString()}</b><span>aUEC</span>${se?`<em class="${se>0?"up":"down"}">${se>0?"+":"−"}${small?tlShort(Math.abs(se)):Math.abs(se).toLocaleString()}</em>`:""}</button>`; }
    case "ship": return v&&!small?`<div class="tl-dk-g tl-dk-ship" data-it="ship" title="${esc(tlShipName(v))}"><div class="tl-dk-sn"><b>${esc(tlShipName(v))}</b>${fl?"":`<span>${tlSpd(v)}</span>`}</div></div>`:"";
    case "speed": return fl?`<div class="tl-dk-g tl-dk-num" data-it="speed" title="Speed">${TL_IC.speed}<b>${Math.round(v.speed||0).toLocaleString()}</b><span>m/s</span></div>`:"";
    case "heading": return fl&&v.heading!=null?`<div class="tl-dk-g tl-dk-num" data-it="heading" title="Heading">${tlCompass(v.heading)}<b>${tlHdg(v.heading)}</b><span>HDG</span></div>`:"";
    case "alt": return fl&&v.altitude!=null?`<div class="tl-dk-g tl-dk-num" data-it="alt" title="Altitude"><b>${v.altitude>=10000?(v.altitude/1000).toFixed(1):Math.round(v.altitude).toLocaleString()}</b><span>${v.altitude>=10000?"km":"m"} ALT</span></div>`:"";
    case "mode": return v&&v.mode?`<div class="tl-dk-g tl-dk-num" data-it="mode"><span class="tl-chip ${v.mode}">${v.mode.toUpperCase()}${v.spooled?" · spooled":""}</span></div>`:"";
  } return ""; }
// the compass rose for the heading: a needle turned to it (0° up)
const tlCompass=h=>`<svg class="tl-ic tl-cmp" viewBox="-12 -12 24 24" aria-hidden="true"><circle r="10.5" class="ring"/><g transform="rotate(${Math.round(h||0)})"><path d="M0,-9 L3.2,1.5 L0,-.5 L-3.2,1.5Z" class="n"/></g></svg>`;
// the bar along an edge: the items in your order
function tlDockHtml(t,look,o){ const a=t.actor||{}, v=t.vehicle, y=tlYou(a), small=look==="compact"&&o==="v", rows=Object.fromEntries(y.rows.map(r=>[r.k,r]));
  const {order,off}=tlItems(); let h="", run=null;
  const flush=()=>{ if(!run) return;
    if(run.k==="v") h+=`<div class="tl-dk-g tl-dk-you">${tlLookHtml({rows:run.items,any:true},look,o)}</div>`;
    else h+=`<div class="tl-dk-g tl-dk-ship tl-dk-gauges">${run.items.map(([id,g])=>tlGaugeHtml(id,g,small)).join("")}</div>`;
    run=null; };
  for(const id of order){ if(off[id]) continue; const kind=TL_ITEM[id][1];
    if(kind==="v"){ const r=rows[id]; if(!r) continue; if(run?.k!=="v"){ flush(); run={k:"v",items:[]}; } run.items.push(r); continue; }
    if(kind==="g"){ const g=tlGauge(v,id); if(!g||g.p==null) continue; if(run?.k!=="g"){ flush(); run={k:"g",items:[]}; } run.items.push([id,g]); continue; }
    flush(); h+=tlSoloHtml(id,t,look,o,small); }
  flush(); return h; }
// ---- shrink the bar's contents to fit rather than scroll (a window that isn't full screen)
function tlFit(d){ if(!d||d.hidden) return; const h=d.classList.contains("h");
  d.style.setProperty("--tlz","1");
  const need=h?d.scrollWidth:d.scrollHeight, have=h?d.clientWidth:d.clientHeight;
  if(!have||need<=have+1) return;
  let z=Math.max(.5,have/need); d.style.setProperty("--tlz",z.toFixed(3));
  // a second pass: borders and gaps don't scale exactly
  const n2=h?d.scrollWidth:d.scrollHeight; if(n2>have+1) d.style.setProperty("--tlz",Math.max(.5,z*have/n2).toFixed(3)); }
if(window.ResizeObserver){ const ro=new ResizeObserver(es=>es.forEach(e=>tlFit(e.target)));
  const hook=()=>{ const d=$("tl-dock"); if(d&&!d._fit){ d._fit=1; ro.observe(d); } }; setInterval(hook,1000); }
window.addEventListener("resize",()=>tlFit($("tl-dock")));
// Settings: where and how, each with a preview (example numbers)
const TL_SAMPLE={rows:[{k:"hp",label:"Health",v:80},{k:"o2",label:"Oxygen",v:95},{k:"food",label:"Satiety",v:48,mid:true},{k:"drink",label:"Hydration",v:15,low:true}],any:true};
const TL_SAMPLE_T={actor:{health:{cur:80,max:100},oxygen:{cur:95,max:100},hunger:{cur:64,max:100},thirst:{cur:15,max:100},body_temp:{cur:36.8},heart_rate:72,auec:1234567}};
function tlPosPreview(id){ return `<div class="tl-pp pos-${id}" aria-hidden="true"><i class="r"></i><i class="sd"></i><i class="m">${id==="float"?"<i class=\"fc\"></i>":""}</i>${id==="float"?"":"<i class=\"dk\"></i>"}</div>`; }
function tlLookPreview(look,pos){ const o=pos==="float"?"card":pos==="top"||pos==="bottom"?"h":"v";
  if(o==="card") return look==="compact"?`<div class="tl-pv-map rail"><div class="tl-rail pv">${tlCompactHtml(TL_SAMPLE,false)}</div></div>`
    :`<div class="tl-pv-card">${tlLookHtml(TL_SAMPLE,look,"card")}${look==="rings"?tlLowHtml(TL_SAMPLE):""}</div>`;
  return `<div class="tl-pv-dock ${o}"><div class="tl-dock ${o} look-${look} pv">${o==="h"?"":`<div class="tl-dk-h"><span class="dot on"></span>${look==="compact"?"":"<b>Player Stats</b>"}</div>`}<div class="tl-dk-g tl-dk-you">${tlLookHtml(TL_SAMPLE,look,o)}</div></div></div>`; }
function tlStylePicker(){ const {pos,look}=tlStyle(), docked=pos!=="float";
  const opt=(k,id,name,sub,pv,on)=>`<button type="button" class="tl-sty-o ${on?"on":""}" role="radio" aria-checked="${on}" data-tlsty="${k}:${id}">
      <div class="tl-sty-pv ${k}" aria-hidden="true">${pv}</div><div class="tl-sty-n"><b>${name}</b>${on?'<span class="tl-sty-ck">Using</span>':""}</div><span class="muted tl-small">${sub}</span></button>`;
  return `<div class="tl-sty"><div class="tl-sty-h"><b>Player stats</b><span class="muted tl-small">Where your health, oxygen, satiety and hydration show, and how they look. Previews use example numbers.</span></div>
    <div class="tl-sty-l">Where</div><div class="tl-sty-grid pos" role="radiogroup" aria-label="Where player stats show">${TL_POS.map(([id,n,sub])=>opt("pos",id,n,sub,tlPosPreview(id),id===pos)).join("")}</div>
    <div class="tl-sty-l">Look</div><div class="tl-sty-grid look" role="radiogroup" aria-label="How player stats look">${TL_LOOKS.map(([id,n,sub])=>opt("look",id,n,sub,tlLookPreview(id,pos),id===look)).join("")}</div>
    ${docked?`<label class="row tl-small" style="gap:8px;margin-top:10px;cursor:pointer"><input type="checkbox" id="s-tlmaponly" ${tlMapOnly()?"checked":""}> Only on the map (hide the bar while another page is open)</label>`:""}
    ${docked?`<label class="row tl-small" style="gap:8px;margin-top:6px;cursor:pointer"><input type="checkbox" id="s-tlshipcard" ${tlShipCardOn()?"checked":""}> Keep the full ship card on the map too (warning lights, countermeasures, altitude)</label>`:""}
    ${docked?tlItemsHtml():""}</div>`; }
// Settings: what's in the bar and in what order. Drag a row (or use the arrows), untick to hide it. The LIVE label
// stays first. You can also drag the items about on the bar itself, and right-click one there to hide it.
const TL_KIND={v:"",g:"",s:""};          // (no "You" / "Ship gauge" tags in the list)
function tlItemsHtml(){ const {order,off}=tlItems(), mov=order.filter(id=>id!=="head");
  return `<div class="tl-items"><div class="row" style="align-items:baseline;gap:8px;flex-wrap:wrap"><b>Live Stats Bar</b><span class="muted tl-small">Drag to reorder (here or on the bar itself), untick to hide. Ship items show while you're in a ship.</span><span class="spacer"></span><a class="muted tl-small" data-tlit="reset" style="cursor:pointer;text-decoration:underline">Reset</a></div>
    <div class="tl-items-l" id="tl-items-l">
      <div class="tl-it pinned ${off.head?"off":""}" data-pin="head"><span class="grip" aria-hidden="true">⌖</span><input type="checkbox" data-ithide="head" ${off.head?"":"checked"} aria-label="Show the Status Label"><span class="nm">Status Label</span></div>
      ${mov.map((id,i)=>{ const [,k,name]=TL_ITEM[id];
      return `<div class="tl-it ${off[id]?"off":""}" data-it="${id}"><span class="grip" aria-hidden="true">⋮⋮</span><input type="checkbox" data-ithide="${id}" ${off[id]?"":"checked"} aria-label="Show ${esc(name)}"><span class="nm">${esc(name)}</span>${TL_KIND[k]?`<span class="kd">${TL_KIND[k]}</span>`:""}
        <button class="iconbtn" data-tlit="up" ${i?"":"disabled"} aria-label="Move ${esc(name)} up">▲</button><button class="iconbtn" data-tlit="down" ${i<mov.length-1?"":"disabled"} aria-label="Move ${esc(name)} down">▼</button></div>`; }).join("")}</div></div>`; }
// move item `from` before or after `to` in the saved order
function tlItemsMove(from,to,after){ const st={order:[...tlItems().order],off:{...tlItems().off}};
  if(from===to||from==="head"||!st.order.includes(from)) return false;
  st.order.splice(st.order.indexOf(from),1);
  let j=to==="head"?1:st.order.indexOf(to)+(after?1:0); if(j<1) j=1;
  st.order.splice(j,0,from); tlItemsSave(st); return true; }
function tlItemsWire(d){ const L=d.querySelector("#tl-items-l"); if(!L) return;
  const cur=()=>({order:[...tlItems().order],off:{...tlItems().off}});
  const save=st=>{ tlItemsSave(st); renderDetail(); };
  d.querySelector('[data-tlit="reset"]')?.addEventListener("click",e=>{ e.preventDefault(); save(null); toast("Live Stats Bar reset"); });
  for(const cb of L.querySelectorAll("[data-ithide]")) cb.onchange=()=>{ const st=cur(), id=cb.dataset.ithide; if(cb.checked) delete st.off[id]; else st.off[id]=true; save(st); };
  for(const row of L.querySelectorAll(".tl-it[data-it]")){ const id=row.dataset.it;
    for(const b of row.querySelectorAll("[data-tlit]")) b.onclick=e=>{ e.preventDefault(); const st=cur(), i=st.order.indexOf(id), j=b.dataset.tlit==="up"?i-1:i+1;
      if(j<1||j>=st.order.length) return; [st.order[i],st.order[j]]=[st.order[j],st.order[i]]; save(st); }; }
  tlSortable(L,{axis:"y",drop:(f,t,after)=>{ if(tlItemsMove(f,t,after)) renderDetail(); }}); }
// ---- dragging to reorder, by pointer (Settings' list and the bar itself). The dragged item follows the pointer
// and a glowing line shows where it'll go; nothing moves until you let go, and Settings doesn't redraw meanwhile
// (that redraw every 2 s is what made the old drag jump about).
function tlSortable(root,{axis:axisOf,drop}){ if(root._sortable) return; root._sortable=1;
  root.addEventListener("pointerdown",e=>{ if(e.button!==0) return; const it=e.target.closest("[data-it]"); if(!it||!root.contains(it)) return;
    if(e.target.closest("input,select,.iconbtn")) return;
    const x0=e.clientX, y0=e.clientY, axis=typeof axisOf==="function"?axisOf():axisOf; let on=false, mark=null, tgt=null, aft=false;
    const move=ev=>{ const dx=ev.clientX-x0, dy=ev.clientY-y0;
      if(!on){ if(Math.hypot(dx,dy)<6) return; on=true; S.tlDrag=true; it.classList.add("tl-dragging");
        mark=Object.assign(document.createElement("div"),{className:"tl-drop-mark "+axis}); document.body.appendChild(mark); }
      it.style.transform=`translate(${dx}px,${dy}px)`;
      it.style.pointerEvents="none"; const under=document.elementFromPoint(ev.clientX,ev.clientY); it.style.pointerEvents="";
      tgt=under?.closest?.("[data-it],[data-pin]"); if(tgt&&(!root.contains(tgt)||tgt===it)) tgt=null;
      if(!tgt){ mark.hidden=true; return; }
      const r=tgt.getBoundingClientRect(); aft=tgt.dataset.pin?true:axis==="x"?ev.clientX>r.left+r.width/2:ev.clientY>r.top+r.height/2;
      mark.hidden=false;
      Object.assign(mark.style,axis==="x"?{left:(aft?r.right:r.left)-1+"px",top:r.top+"px",height:r.height+"px",width:"3px"}
        :{top:(aft?r.bottom:r.top)-1+"px",left:r.left+"px",width:r.width+"px",height:"3px"}); };
    const up=()=>{ window.removeEventListener("pointermove",move); window.removeEventListener("pointerup",up); window.removeEventListener("pointercancel",up);
      if(!on) return;
      it.style.transform=""; it.classList.remove("tl-dragging"); mark?.remove(); S.tlDrag=false;
      // the click after a drag isn't a click (the balance would open its window)
      const eat=ev=>{ ev.stopPropagation(); ev.preventDefault(); };
      window.addEventListener("click",eat,{capture:true,once:true}); setTimeout(()=>window.removeEventListener("click",eat,true),350);
      if(tgt) drop(it.dataset.it,tgt.dataset.it||tgt.dataset.pin,aft); };
    window.addEventListener("pointermove",move); window.addEventListener("pointerup",up); window.addEventListener("pointercancel",up); }); }
// the bar: drag items about, right-click one to hide it or open the settings
function tlDockWire(d){ if(d._wired) return; d._wired=1;
  tlSortable(d,{axis:()=>d.classList.contains("h")?"x":"y",drop:(f,t,after)=>{ if(tlItemsMove(f,t,after)) toast(`Moved ${TL_ITEM[f]?.[2]||"it"}`); }});
  d.addEventListener("contextmenu",e=>{ const it=e.target.closest("[data-it]"); e.preventDefault(); tlDockMenu(e.clientX,e.clientY,it?.dataset.it); }); }
function tlDockMenu(x,y,id){ $("tl-dmenu")?.remove(); const m=Object.assign(document.createElement("div"),{id:"tl-dmenu",className:"tl-dmenu"});
  m.innerHTML=`${id?`<button type="button" data-dm="hide">Hide ${esc(TL_ITEM[id]?.[2]||"this")}</button>`:""}<button type="button" data-dm="set">Customize the bar…</button>${Object.keys(tlItems().off).length?`<button type="button" data-dm="all">Show everything</button>`:""}`;
  document.body.appendChild(m); m.style.left=Math.min(x,innerWidth-m.offsetWidth-8)+"px"; m.style.top=Math.min(y,innerHeight-m.offsetHeight-8)+"px";
  const close=()=>{ m.remove(); document.removeEventListener("pointerdown",away,true); }, away=e=>{ if(!m.contains(e.target)) close(); };
  setTimeout(()=>document.addEventListener("pointerdown",away,true),0);
  m.onclick=e=>{ const a=e.target.closest("[data-dm]")?.dataset.dm; if(!a) return; close();
    if(a==="hide"){ const st={order:[...tlItems().order],off:{...tlItems().off,[id]:true}}; tlItemsSave(st); toast(`${TL_ITEM[id][2]} hidden. Right-click the bar to show it again`); }
    if(a==="all"){ tlItemsSave({order:[...tlItems().order],off:{}}); toast("Everything's back on the bar"); }
    if(a==="set"){ S.tl.advOpen=false; select({kind:"settings"}); setTimeout(()=>document.querySelector(".tl-items")?.scrollIntoView({block:"center",behavior:"smooth"}),300); } }; }
// the card and the rail sit on the right, under the system tabs and Layers, clear of the route and place cards
function tlPlace(el){ const tr=document.querySelector("#mapwrap .topright"); const top=tr?tr.offsetTop+tr.offsetHeight+12:16;
  el.style.top=top+"px"; el.style.maxHeight=`calc(100% - ${top+110}px)`; }
function tlRender(){ let c=$("tl-card"); const t=tlLive(), {pos,look}=tlStyle();
  const live=!!(t&&(t.vehicle||t.actor)), onMap=live&&!document.querySelector("#mapwrap .pic-panel.show");
  const y=live?tlYou(t.actor||{}):{any:false}, docked=pos!=="float";
  // the bar along an edge: on every page, the map makes room for it
  let d=$("tl-dock"), app=document.querySelector(".app");
  const dockOn=live&&docked&&(y.any||t.vehicle||t.actor?.auec!=null)&&(!tlMapOnly()||!document.querySelector("#mapwrap .pic-panel.show"));
  for(const p of ["top","bottom","left","right"]) app.classList.toggle("dock-"+p,dockOn&&pos===p);
  if(d){ d.hidden=!dockOn; if(dockOn){ const o=pos==="top"||pos==="bottom"?"h":"v"; d.className=`tl-dock ${o} look-${look} at-${pos}`;
    tlDockWire(d); d.title="Drag items to move them · right-click to hide one";
    const html=tlDockHtml(t,look,o); if(d.dataset.k!==html&&!S.tlDrag){ d.dataset.k=html; d.innerHTML=html; tlFit(d); } } }
  // floating, compact: a narrow column on the map's edge
  const railHtml=onMap&&!docked&&look==="compact"&&y.any?tlCompactHtml(y,true)+(t.actor?.auec!=null?`<div class="tl-railit auec" title="Balance">aUEC<b>${tlShort(t.actor.auec)}</b></div>`:""):"";
  let r=$("tl-rail");
  if(!railHtml){ if(r) r.hidden=true; } else { if(!r){ r=Object.assign(document.createElement("div"),{id:"tl-rail",className:"tl-rail"}); $("mapwrap").appendChild(r); }
    r.hidden=false; if(r.dataset.k!==railHtml){ r.dataset.k=railHtml; r.innerHTML=railHtml; } tlPlace(r); }
  // the card: everything when floating; only the ship when your stats are elsewhere
  const card=onMap&&(!docked&&look!=="compact"||(t.vehicle&&(!docked||tlShipCardOn()))||(!docked&&!y.any));
  if(!card){ if(c) c.hidden=true; return; }
  if(!c){ c=Object.assign(document.createElement("div"),{id:"tl-card",className:"tl-card"}); $("mapwrap").appendChild(c);
    c.addEventListener("click",e=>{ if(e.target.closest('[data-tl="collapse"]')){ S.tl.collapsed=!S.tl.collapsed; try{ localStorage.setItem("q-tl-collapsed",S.tl.collapsed?"1":"0"); }catch(_){} c.dataset.k=""; tlRender(); } }); }
  c.classList.toggle("with-rail",!!railHtml); tlPlace(c);
  c.hidden=false; const html=tlCardHtml(t); if(c.dataset.k!==html){ c.dataset.k=html; c.innerHTML=html; } }
// ---- steering to the place you're being guided to ("Guide me"): your live heading against the bearing to it.
// Between /showlocations Quantum carries your position on along your heading at your speed (an estimate: no
// climb, wind or sideways drift), so the bearing and distance keep up as you fly. Each /showlocation resets it.
// Only near the planet or moon the place is on, in a ship that sends its heading.
const tlRad=Math.PI/180;
function tlGc(lat1,lon1,lat2,lon2,R){ const p1=lat1*tlRad,p2=lat2*tlRad,dl=(lon2-lon1)*tlRad;
  const h=Math.sin((p2-p1)/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2, d=2*R*Math.asin(Math.sqrt(Math.min(1,h)));
  const y=Math.sin(dl)*Math.cos(p2), x=Math.cos(p1)*Math.sin(p2)-Math.sin(p1)*Math.cos(p2)*Math.cos(dl);
  return {d,brg:(Math.atan2(y,x)/tlRad+360)%360}; }
function tlStep(lat,lon,brg,d,R){ const p1=lat*tlRad,l1=lon*tlRad,b=brg*tlRad,a=d/R;
  const p2=Math.asin(Math.sin(p1)*Math.cos(a)+Math.cos(p1)*Math.sin(a)*Math.cos(b));
  const l2=l1+Math.atan2(Math.sin(b)*Math.sin(a)*Math.cos(p1),Math.cos(a)-Math.sin(p1)*Math.sin(p2));
  return [p2/tlRad,((l2/tlRad+540)%360)-180]; }
function tlDrTick(){ const pl=S.live?.player, v=tlLive()?.vehicle, now=performance.now();
  if(!pl||pl.approx||pl.lat==null||!pl.local){ S.tl.dr=null; return; }
  const R=Math.hypot(...pl.local)-(pl.alt||0); if(!(R>1000)) { S.tl.dr=null; return; }
  let d=S.tl.dr;
  if(!d||d.fix!==pl.fix_t||d.body!==pl.body){ d=S.tl.dr={fix:pl.fix_t,body:pl.body,lat:pl.lat,lon:pl.lon,R,at:now,moved:0,since:Date.now()}; return; }
  // The server's estimate (the same one the map shows) wins when there's a newer one: it integrates every
  // telemetry frame and the game's altitude; this only carries it on between polls.
  const e=S.live?.player_est; if(e&&e.how==="dr"&&e.body===d.body&&e.lat!=null&&e.moved_m!==d.srvMoved){ d.srvMoved=e.moved_m; d.lat=e.lat; d.lon=e.lon; d.moved=e.moved_m; }
  const dt=Math.min((now-d.at)/1000,2); d.at=now;
  if(v&&v.flight_data!==false&&!v.landed&&v.heading!=null&&(v.speed||0)>0.5){ const step=v.speed*dt;
    [d.lat,d.lon]=tlStep(d.lat,d.lon,v.heading,step,R); d.moved+=step; } }
function tlSteer(){ const g=S.live?.guide, pl=S.live?.player, d=S.tl.dr, v=tlLive()?.vehicle;
  if(!g||g.lat==null||!pl||!d||pl.body!==g.body||g.other_system||!v||v.heading==null||v.flight_data===false) return null;
  const {d:dist,brg}=tlGc(d.lat,d.lon,g.lat,g.lon,d.R);
  const turn=((brg-v.heading+540)%360)-180, sp=v.speed||0;
  const dAlt=v.altitude!=null&&g.alt!=null?g.alt-v.altitude:null;
  return {name:g.name,dist,brg,turn,heading:v.heading,eta:sp>5&&!v.landed?dist/sp:null,dAlt,est:d.moved>50,
    there:dist<150, age:(Date.now()-d.since)/1000}; }
function tlTurnTxt(s){ const a=Math.abs(s.turn); return s.there?"You're there":a<5?"On course":`Turn ${s.turn<0?"left":"right"} ${Math.round(a)}°`; }
function tlTurnCls(s){ const a=Math.abs(s.turn); return s.there||a<5?"ok":a<25?"near":"far"; }
const tlArrowSvg=t=>`<svg class="tl-steer-ar" viewBox="-20 -20 40 40" aria-hidden="true"><circle r="18" class="ring"/><g transform="rotate(${t.toFixed(0)})"><path d="M0,-14 L8,6 L0,1 L-8,6 Z"/></g></svg>`;
function tlSteerCard(s){ if(!s) return "";
  return `<div class="tl-steer ${tlTurnCls(s)}">${s.there?"":tlArrowSvg(s.turn)}
    <div class="tl-steer-t"><b>${tlTurnTxt(s)}</b><span>${s.there?"Within about 150 m":`Head ${Math.round(s.brg)}° · you're on ${Math.round(s.heading)}°`}</span></div>
    <div class="tl-steer-n"><div><b>${s.est?"≈ ":""}${fmtDist(s.dist)}</b><span>to go</span></div>${s.eta!=null&&!s.there?`<div><b>${tlDur(s.eta)}</b><span>at this speed</span></div>`:""}${s.dAlt!=null&&Math.abs(s.dAlt)>50?`<div><b>${fmtDist(Math.abs(s.dAlt))}</b><span>${s.dAlt<0?"below you":"above you"}</span></div>`:""}</div>
    ${s.est?`<div class="tl-steer-note">Estimated from your heading and speed since your last /showlocation${s.age>600?" (a while ago: a fresh /showlocation will sharpen it)":""}</div>`:""}</div>`; }
function tlSteerDock(s,o){ if(!s) return "";
  return `<div class="tl-dk-g tl-dk-steer ${tlTurnCls(s)}" data-it="steer" title="Guiding to ${esc(s.name)}">${s.there?"":tlArrowSvg(s.turn)}<div class="tl-dk-sn"><b>${tlTurnTxt(s)}</b><span>${esc(s.name)} · ${s.est?"≈ ":""}${fmtDist(s.dist)}</span></div></div>`; }
// ---- landing aids: height above the ground, how fast you're coming down, gear and VTOL. Shown from 1.5 km
// above the ground (the game's radar altitude) or with the gear down, until you're landed. Vertical speed is
// taken as positive going up.
function tlLanding(v){ if(!v||v.landed) return null; const agl=v.radar_alt;
  const near=agl!=null&&agl>0&&agl<1500; if(!near&&v.gear!=="deployed") return null;
  const vs=v.vspeed??null, down=vs!=null&&vs<0?-vs:0, gearUp=v.gear&&v.gear!=="deployed";
  let lvl="", tip="";
  if(near&&agl<40&&gearUp&&down>0.3){ lvl="bad"; tip="Gear is up"; }
  else if(near&&((agl<100&&down>8)||(agl<30&&down>4))){ lvl="bad"; tip="Slow your descent"; }
  else if(near&&((agl<300&&down>15)||(agl<60&&down>2.5))){ lvl="warn"; tip="Coming down fast"; }
  return {agl:near?agl:null,vs,down,lvl,tip,gear:v.gear,vtol:v.vtol}; }
const tlM=m=>m==null?"–":m>=1000?(m/1000).toFixed(2)+" km":Math.round(m)+" m";
const tlVs=L=>L.vs==null?"–":`${L.vs<0?"↓":L.vs>0?"↑":""} ${Math.abs(L.vs).toFixed(1)} m/s`;
function tlLandHtml(v,where){ const L=tlLanding(v); if(!L) return "";
  const gear=L.gear?`<span class="tl-chip ${L.gear!=="deployed"&&L.agl!=null&&L.agl<100?"bad":""}">Gear ${L.gear==="deployed"?"down":L.gear==="retracted"?"up":L.gear}</span>`:"";
  const vtol=L.vtol&&L.vtol!=="retracted"?`<span class="tl-chip">VTOL ${L.vtol==="deployed"?"on":L.vtol}</span>`:"";
  if(where==="tiny") return `<div class="tl-land-tiny ${L.lvl}" title="Height above ground · vertical speed"><span>AGL</span><b>${L.agl==null?"–":L.agl>=1000?(L.agl/1000).toFixed(1)+"k":Math.round(L.agl)}</b><span>${L.vs==null?"":(L.vs<0?"↓":"↑")+Math.abs(L.vs).toFixed(0)}</span></div>`;
  if(where==="h") return `<div class="tl-land-h ${L.lvl}" title="${L.tip||"Landing"}"><span class="k">AGL</span><b>${tlM(L.agl)}</b><span class="k">V/S</span><b>${tlVs(L)}</b>${gear}${L.tip?`<em>${L.tip}</em>`:""}</div>`;
  const tape=L.agl==null?0:Math.max(2,Math.min(100,Math.log10(1+L.agl)/Math.log10(1501)*100));
  return `<div class="tl-land ${L.lvl}"><div class="tl-land-top"><b>Landing</b>${gear}${vtol}</div>
    <div class="tl-land-body"><div class="tl-land-tape" title="Height above ground (log scale, 1.5 km at the top)"><i style="height:${tape.toFixed(0)}%"></i></div>
      <div class="tl-big"><div><b>${tlM(L.agl)}</b><span>above ground</span></div><div><b>${tlVs(L)}</b><span>vertical</span></div></div></div>
    ${L.tip?`<div class="tl-land-tip">${L.tip}</div>`:""}</div>`; }
// ---- session stats and earnings (game/session_stats.py): the Session window, opened from the balance
function tlSessNet(){ const s=S.tl.sess?.session; return s&&s.active?(s.earned||0)-(s.spent||0):0; }
function tlCardBal(a){ const se=tlSessNet();
  return `<button type="button" class="tl-auec tl-auec-btn" data-tlsess title="This session's earnings and stats"><span>Balance</span><b>${Math.round(a.auec).toLocaleString()} <small>aUEC</small>${se?` <em class="${se>0?"up":"down"}">${se>0?"+":"−"}${Math.abs(se).toLocaleString()}</em>`:""}</b></button>`; }
async function tlSessLoad(){ try{ const r=await api().session_stats(); if(r?.ok){ S.tl.sess=r; if($("tl-sess")) tlSessRender(); } }catch(_){ } }
setInterval(()=>{ if(tlLive()||$("tl-sess")) tlSessLoad(); },4000);
const tlDur=s=>{ s=Math.round(s||0); const h=Math.floor(s/3600), m=Math.floor(s%3600/60); return h?`${h}h ${m}m`:m?`${m}m`:`${s}s`; };
const tlDist=m=>!m?"0 km":m>=1e6?(m/1e6).toFixed(2)+" Mm":m>=1000?(m/1000).toFixed(1)+" km":Math.round(m)+" m";
const tlA=n=>`${n<0?"−":""}${Math.abs(Math.round(n||0)).toLocaleString()}`;
function tlSessHtml(r){ const s=r?.session||{}, e=r?.entries||[];
  const stat=(k,v,sub)=>`<div class="tl-ss"><span>${k}</span><b>${v}</b>${sub?`<i>${sub}</i>`:""}</div>`;
  const when=t=>new Date(t*1000).toLocaleTimeString([],{hour:"numeric",minute:"2-digit"});
  const day=t=>{ const d=new Date(t*1000), n=new Date(); return d.toDateString()===n.toDateString()?when(t):d.toLocaleDateString([],{month:"short",day:"numeric"})+" "+when(t); };
  return `<div class="tl-sess-card" role="dialog" aria-modal="true" aria-label="Session">
    <div class="tl-sess-h"><div><b>This session</b><span class="muted">${s.started?`Since ${when(s.started)} · ${tlDur(s.in_game_s)} in game`:"Starts when the game sends its first data"}</span></div><button class="iconbtn" data-tlsessx aria-label="Close">✕</button></div>
    <div class="tl-sess-earn">
      <div class="big ${(s.net||0)>=0?"up":"down"}"><span>Net this session</span><b>${(s.net||0)>0?"+":""}${tlA(s.net)} <small>aUEC</small></b></div>
      ${stat("Earned",`+${tlA(s.earned)}`)}${stat("Spent",`−${tlA(s.spent)}`)}${stat("Earned today",`+${tlA(r?.today)}`)}${stat("Last 7 days",`+${tlA(r?.week)}`)}
    </div>
    <div class="tl-sess-grid">
      ${stat("Flying",tlDur(s.flying_s))}${stat("Distance flown",tlDist(s.distance_m))}${stat("Top speed",`${Math.round(s.top_speed||0).toLocaleString()} m/s`)}
      ${stat("Hydrogen used",`${Math.round((s.h2_used||0)*100)}%`,"of a tank")}${stat("Contracts paid",s.contracts||0)}${stat("Downed / died",`${s.downs||0} / ${s.deaths||0}`)}
    </div>
    ${s.ships?.length?`<div class="tl-sess-ships muted">Flew: ${s.ships.map(n=>esc(tlShipName({name:n})||n)).join(", ")}</div>`:""}
    ${tlSessHist(r)}
    <div class="tl-sess-sync"><span class="dot ${r?.synced_at?"on":""}"></span><span class="muted">${r?.signed_in?(r.synced_at?`Kept with your Quantum account · synced ${agoTs(r.synced_at)}`:"Kept with your Quantum account · not synced yet"):"On this PC only. Sign in to your Quantum account to keep it with you across updates and PCs"}</span><span class="spacer"></span>${r?.signed_in?`<button class="btn ghost sm" data-tlsesssync ${S.tl.sessSync?"disabled":""}>${S.tl.sessSync?"Syncing…":"Sync now"}</button>`:""}</div>
    <div class="tl-sess-lh"><b>Balance changes</b><span class="spacer"></span>${e.length?`<button class="btn ghost sm" data-tlsessclear>Clear</button>`:""}</div>
    <div class="tl-sess-list">${e.length?e.slice(0,80).map(x=>`<div class="tl-sl k-${x.kind}"><span class="t">${day(x.t)}</span><span class="l">${x.kind==="contract"?`<b>Contract</b> ${esc(x.label)}`:esc(x.label)}</span><b class="d ${x.delta>0?"up":"down"}">${x.delta>0?"+":"−"}${Math.abs(x.delta).toLocaleString()}</b><span class="b">${x.balance.toLocaleString()}</span></div>`).join("")
      :`<div class="muted tl-small" style="padding:10px 0">Nothing yet. Every change to your aUEC balance shows here; a payout right after the game says a contract is complete is put down to that contract.</div>`}</div>
  </div>`; }
// every session you've played (kept across updates, and with your account), and the totals
function tlSessHist(r){ const h=r?.history||[], L=r?.lifetime; if(!h.length&&!L) return "";
  const when=t=>new Date(t*1000).toLocaleDateString([],{month:"short",day:"numeric"})+" "+new Date(t*1000).toLocaleTimeString([],{hour:"numeric",minute:"2-digit"});
  return `<details class="tl-sess-hist" ${S.tl.histOpen?"open":""} ontoggle="S.tl.histOpen=this.open"><summary><b>All sessions</b> <span class="muted">${r.sessions_n||h.length} · ${tlDur(L?.in_game_s)} in game · +${tlA(L?.earned)} aUEC earned · ${tlDist(L?.distance_m)} flown</span></summary>
    <div class="tl-sess-list">${h.map(x=>`<div class="tl-sl"><span class="t">${when(x.started)}</span><span class="l">${tlDur(x.in_game_s)} in game · ${tlDist(x.distance_m)}${x.contracts?` · ${x.contracts} contract${x.contracts===1?"":"s"}`:""}</span><b class="d ${(x.earned||0)-(x.spent||0)>=0?"up":"down"}">${(x.earned||0)-(x.spent||0)>=0?"+":"−"}${Math.abs((x.earned||0)-(x.spent||0)).toLocaleString()}</b><span class="b"></span></div>`).join("")||`<div class="muted tl-small" style="padding:8px 0">Finished sessions show here.</div>`}</div></details>`; }
function tlSessRender(){ const m=$("tl-sess"); if(m) m.innerHTML=tlSessHtml(S.tl.sess); }
function tlSessOpen(){ let m=$("tl-sess"); if(!m){ m=Object.assign(document.createElement("div"),{id:"tl-sess",className:"tl-sess"}); document.body.appendChild(m);
    m.addEventListener("click",async e=>{ if(e.target===m||e.target.closest("[data-tlsessx]")) return tlSessClose();
      if(e.target.closest("[data-tlsesssync]")){ S.tl.sessSync=true; tlSessRender(); let x; try{ x=await api().stats_sync(); }catch(_){ x={ok:false,error:"Couldn't sync"}; }
        S.tl.sessSync=false; if(!x?.ok) toast(x?.error||"Couldn't sync"); else toast("Session stats synced with your account"); await tlSessLoad(); tlSessRender(); return; }
      if(e.target.closest("[data-tlsessclear]")&&await qConfirm({title:"Clear the earnings log?",text:"Every balance change Quantum has written down goes, on this PC and in your Quantum account. This session's totals and your session history stay.",ok:"Clear",danger:true})){ try{ S.tl.sess=await api().earnings_clear(); }catch(_){} tlSessRender(); } }); }
  tlSessRender(); tlSessLoad(); }
function tlSessClose(){ $("tl-sess")?.remove(); }
document.addEventListener("click",e=>{ if(e.target.closest("[data-tlsess]")){ e.preventDefault(); tlSessOpen(); } });
document.addEventListener("keydown",e=>{ if(e.key==="Escape"&&$("tl-sess")) tlSessClose(); });
// "Only on the map": hide the bar the moment another page opens, not on the next half-second tick
(function(){ let q=false; const go=()=>{ q=false; try{ tlRender(); }catch(_){} };
  const mw=document.getElementById("mapwrap"); if(!mw) return;
  new MutationObserver(ms=>{ if(!q&&ms.some(m=>m.target.classList?.contains("pic-panel"))){ q=true; requestAnimationFrame(go); } })
    .observe(mw,{attributes:true,attributeFilter:["class"],subtree:true}); })();
// Downed, killed, respawned: said the moment the game says it
function tlNotes(){ const n=S.live?.telemetry?.note; if(!n||n.n===S.tl.noteSeen) return; const first=S.tl.noteSeen===null; S.tl.noteSeen=n.n; if(first) return;
  const msg={downed:"You're downed. Get help or use a MedPen",dead:"You died",respawn:"Respawned",spawn:"Spawned in"}[n.type]; if(msg) toast(msg); }
// The status line: your ship and speed, when the game's data has them
function tlStatusExtra(){ const t=tlLive(), v=t?.vehicle; if(!v) return "";
  return `<div class="tl-status">In <b>${esc(tlShipName(v))}</b> · ${tlSpd(v)}${tlQt(v)!=null?` · QT fuel ${tlQt(v)}%`:""}</div>`; }
// The Cart: what you have against what it costs (balance kept from the last time the game sent it)
function tlBalanceHtml(total){ const b=S.live?.telemetry?.balance; if(!b||b.auec==null||!total) return "";
  const short=total-b.auec;
  return `<div class="tl-cart ${short>0?"short":"ok"}"><span>You have ${Math.round(b.auec).toLocaleString()} aUEC</span><b>${short>0?`${Math.round(short).toLocaleString()} short`:"Enough"}</b></div>`; }
function tlHudSteer(){ const el=$("hud-steer"); if(!el) return; const h=tlSteerCard(tlSteer()); if(el.dataset.k!==h){ el.dataset.k=h; el.innerHTML=h; } }
setInterval(()=>{ try{ tlDrTick(); tlRender(); tlHudSteer(); tlNotes(); }catch(e){ console.warn("telemetry",e); } },500);
