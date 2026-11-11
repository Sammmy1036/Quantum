// Quantum UI: poll() (the app's live state, several times a second) and start-up. Loads last.
// One of several classic scripts sharing one global scope; index.html loads them in order.
"use strict";
async function poll(){
  const live=await api().get_live(); syncUexTabs(!!live.log?.uex_token); const prevSys=S.live?.player?.system||S.live?.where?.system; S.live=live; S.liveAt=performance.now();
  // What re-frames the follow view: a new reading, a change of system, body or travel state, the next stop, and
  // (with a route, which is framed as you + the next stop) moving a fair way, so the frame keeps up as you fly.
  const pl=live.player, step=pl?.body?Math.max(5000,(S.bodyMap?.[pl.body]?.radius||1e6)*0.15):2e7;
  const moved=pl?(pl.local||pl.pos||[]).map(v=>Math.round(v/step)).join(","):"";
  const fk=JSON.stringify([pl?.fix_t, pl?.approx, pl?.system, pl?.body, live.travel?.state, live.travel?.place, live.route?.[0], live.guide?.name, (live.route?.length||live.guide)?moved:""]);
  if(fk!==S.followKey){ const first=S.followKey===undefined; S.followKey=fk; if(!first && S.follow && live.player) setTimeout(followNow,50); }
  // A fresh /showlocation while the Contracts tab is open recentres the map on you (and your next stop, if
  // there's a route), even when follow is off: it's how you check where you are against your objectives.
  { const fx=live.player?.fix_t||null; if(fx!==S.fixSeen){ const first=S.fixSeen===undefined; S.fixSeen=fx;
      // Guiding you to a waypoint: a fresh /showlocation turns following back on, so the map tracks you along the way
      // Any fresh /showlocation is you asking where you are: centre on it, and keep following from there
      if(!first&&fx&&!live.player?.approx){ if(!S.follow) setFollow(true); S.anim=null; setTimeout(followNow,60); } } }
  watchNewObjectives(live);
  // settings.json couldn't be read at start: say so once, long enough to read
  if(live.settings_note&&!S.settingsNoted){ S.settingsNoted=true; toast(live.settings_note); clearTimeout(toastT);
    toastT=setTimeout(()=>$("toast").classList.remove("show"),15000); }
  if(live.static_version!==S.staticVersion){ await loadStatic(); if(S.tab==="datarunner"&&S.dr?.view==="jobs") renderDrJobs(); }
  if(live.photos_version!==S.photosVersion){ const first=S.photosVersion===undefined; S.photosVersion=live.photos_version; if(!first) refreshPictures(); }
  if(live.trade_ver!==S.tradeVer){ const first=S.tradeVer===undefined; S.tradeVer=live.trade_ver;
    if(!first){ toast("Trade run in transit: you set your route to its sell point"); if($("tr-mine-out")) renderRuns(); } }
  const here=live.player?.system||live.where?.system;
  // You changed system (went through a jump point): the map goes with you, even if you'd been looking at
  // another system (a cross-system contract's drop-off, a route preview). Following picks up from there.
  if(here && here!==prevSys){ renderSysSeg();
    if(prevSys){ S.autoSystem=true; if(here!==S.system) setSystem(here, !S.follow); if(S.follow&&live.player) setTimeout(followNow,80); }
    else if(S.autoSystem && here!==S.system) setSystem(here); }
  const rk=JSON.stringify([live.route,live.legs.map(x=>x&&Math.round(x/1000)),live.stop_roles,live.route_warning]); if(rk!==S.routeKey){ S.routeKey=rk; renderRoute(); renderResults(); }
  const ck=JSON.stringify([live.contracts_version,live.route,live.contracts.map(c=>c.tracking&&[c.tracking.stage,Math.round((c.tracking.to_go||0)/100)])]);
  if(ck!==S.contractsKey||Math.round(live.now)%30===0){ S.contractsKey=ck; renderContracts(); }
  const ar=live.arrived; if(ar&&ar.at!==S.arrSeen){ if(S.arrSeen!==undefined) toast(ar.advanced?`Arrived at ${ar.place}${live.route.length?". Next: "+live.route[0]:". Route complete"}`:`Arrived at ${ar.place}`); S.arrSeen=ar.at; }
  renderHud(); renderStatus(); renderCapture(); renderWaypoints(false);
  if(S.qVersion===undefined){ S.qVersion=""; api().update_status().then(st=>{ S.qVersion=st.current; S.qBuild=st.build||""; if(st.just_updated) toast(`Quantum updated to ${st.current}`); }); }
  if((live.update?.version||null)!==(S.updSeen||null)){ S.updSeen=live.update?.version||null; renderUpdateBar(); }
  if((live.game_update?.build||null)!==(S.gameUpdSeen||null)){ S.gameUpdSeen=live.game_update?.build||null; renderGameUpdate(); }
  S.drHasSecret=!!live.datarunner?.has_secret;
  if(S.pfSec!==S.drHasSecret){ const first=S.pfSec===undefined; S.pfSec=S.drHasSecret; if(!first){ S.drProf=null; qForget("drProf","drTrust"); setTimeout(()=>pfPrime(true).catch(()=>{}),300); } }   // key added or removed: the rail's picture
  { const dj=live.datarunner?.job, js=live.datarunner?.job_state;      // a screenshot from the hotkey
    if(dj&&dj!==S.drJobSeen&&!S.drWaiting&&(js==="done"||js==="error")){ S.drJobSeen=dj;
      if(js==="error") api().dr_job().then(j=>toast(j.error||"The screenshot failed")); } }
  fmSync(live);                                                         // Friend Map: its count, and the list while open
  // A price alert went off (api_watch.py): a note, and the watchlist and the tab's count catch up
  if(live.watch){ const wn=live.watch.note; if(wn&&wn.n!==S.wlNoteN){ if(S.wlNoteN!==undefined) toastLong(wn.text); S.wlNoteN=wn.n; qForget("watch"); if(S.tab==="market") renderWatch(); else wlLoad().then(syncWatchCount).catch(()=>{}); }
    else if(S.wlNoteN===undefined) S.wlNoteN=wn?.n??null;
    if(live.watch.n&&!S.wl) wlLoad().then(syncWatchCount).catch(()=>{}); }
  // The shopping list changed in the background (a purchase in game ticked an item off)
  if(live.shopping) setCartCount(live.shopping.count);
  if(live.shopping&&live.shopping.ver!==S.shVer){ const first=S.shVer===undefined; S.shVer=live.shopping.ver;
    if(!first&&live.shopping.note&&live.shopping.note.n!==S.shNoteN){ S.shNoteN=live.shopping.note.n; toast(live.shopping.note.text); }
    if(first&&live.shopping.note) S.shNoteN=live.shopping.note.n;
    if(!first&&S.tab==="shopping") renderShopping(); }
  // The Quantum server going down or coming back (checked in the background, more often while it's down):
  // Settings shows the new state without being reopened, and a note says when it's back.
  if(live.server){ const ok=!!live.server.ok;
    if(S.srvOk!==undefined&&ok!==S.srvOk){
      if(ok) toast("Quantum server is back online");
      if(S.communityStatus) S.communityStatus={...S.communityStatus,ok,error:live.server.error};
      if(S.selected?.kind==="settings") renderDetail();
      if(ok&&S.tab==="market") openMarket?.(); }
    S.srvOk=ok; }
  if(!S.bkNext||Date.now()>S.bkNext){ S.bkNext=Date.now()+15000;      // a background restore finished?
    api().backup_status().then(b=>{ if(b?.note){ toast(b.note); afterRestore(); } if(S.bk) S.bk=b; }); }
  if(S.drMapJob&&S.tab==="datarunner"&&S.dr?.view==="jobs"&&S.drMapJob.state==="go"&&S.drMapJob.arrived) drMapJobPaint();
  if(S.drAlignJob&&S.tab==="datarunner"&&S.dr?.view==="jobs"&&S.drAlignJob.arrived&&S.drAlignJob.state!=="sent") drAlignCheck();
  if(S.drPriceJob&&S.tab==="datarunner"&&S.dr?.view==="jobs"&&Date.now()-(S.drPjPaint||0)>20000){ S.drPjPaint=Date.now(); drPriceJobPaint(); }
  if(S.tab==="datarunner"&&S.dr&&(!!live.game_off)!==S.drGameOff){ S.drGameOff=!!live.game_off; drSyncInputs(); }
  const dq=live.datarunner?.seq; if(dq!==undefined&&dq!==S.drSeq){ const grew=S.drSeq!==undefined&&live.datarunner.shots>(S.drShotN||0);
    S.drSeq=dq; S.drShotN=live.datarunner.shots; if(grew) toast(`Terminal screenshot ${live.datarunner.shots} saved for your UEX report`); if(S.tab==="datarunner") renderDrShots(); }
}
// Startup runs behind the splash in short steps, with a frame painted between them, so the loading bar
// keeps moving: one long block of work (reading the map, building the system, compiling the planets'
// shaders) is what made it stutter. The 3D map doesn't draw until the splash is gone (frame() checks
// S.splashUp), and the planet shaders are compiled off the main thread first where the GPU allows it.
const breathe=()=>new Promise(r=>requestAnimationFrame(()=>setTimeout(r,0)));
async function init(){
  resize(); buildLayers(); buildFilters(); await breathe(); await loadStatic(); await breathe();
  const live=await api().get_live(); S.live=live; const here=live.player?.system||live.where?.system; if(here&&S.systems.includes(here)) S.system=here;
  buildSystem(); setSky(S.system); renderSysSeg(); S.cam.target=systemCenter(); S.cam.dist=systemExtent()*2.4; S.cam.pitch=1.0; S.focus={kind:"system"};
  setFollow(true); await breathe();
  try{ updateCamera(now()); if(renderer.compileAsync) await renderer.compileAsync(scene,camera); }catch(e){ console.warn(e); }
  await breathe();
  await poll(); renderContracts(); requestAnimationFrame(frame);
  setTimeout(()=>ownerCheck().catch(()=>{}),4000);                 // the server owner gets Replace buttons on pictures
  setTimeout(()=>prefetchAssets().catch(()=>{}),1500);            // logos and pictures into the cache from the first start
  pfPrime(false).catch(()=>{});                                     // your picture and name on the rail
  setInterval(()=>poll().catch(console.error),700); setTimeout(()=>$("help").style.display="none",12000);
  setInterval(()=>{ const a=document.activeElement; if(S.selected?.kind==="align") return;
  if(S.selected?.kind==="settings"){ if(!S.ccDrag&&!S.ptrDown&&Date.now()-(S.ptrAt||0)>700&&!(a&&$("detail").contains(a)&&/^(SELECT|INPUT|TEXTAREA)$/.test(a.tagName))) renderDetail(); return; } if(S.selected&&!(a&&$("detail").contains(a))) renderDetail(); },2000);
}
S.splashUp=true;
window.addEventListener("pywebviewready",async()=>{ const t0=performance.now(); try{ await init(); } finally {
  setTimeout(()=>{ S.splashUp=false; $("splash").classList.add("hide"); }, Math.max(0,1400-(performance.now()-t0))); } });
