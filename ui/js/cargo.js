// Quantum UI: the cargo load planner (Trade › Planned Routes › Load plan): how your cargo fits your ship's
// grids, as an animated 3D preview that loads the boxes in the order to put them in.
// One of several classic scripts sharing one global scope; index.html loads them in order.
"use strict";
// The packing is Python's (cargo.py, api_cargo.py): grid sizes come from the Star Citizen Wiki's vehicle data
// (the game files), box shapes are the game's fixed container sizes. This file only shows the result.
S.cr=S.cr||{open:false,ship:null,runs:[],ships:null,data:null,busy:false,speed:1,boxLimit:"hold"};
const CR_COLORS=["#f2c14e","#4b8dff","#ff5fa8","#57e39b","#c99bff","#ffb454","#7fe7ff","#ff9b8a"];
const crColor=i=>CR_COLORS[i%CR_COLORS.length];
const CR_LIVE=["bought","loading","transit"];          // runs whose cargo is (about to be) aboard: in the plan by default

// ---- opening and the controls
async function openCargo(runId){
  S.cr.open=true; $("cr-panel").classList.add("show");
  const open=(S.runs||[]).filter(x=>x.stage!=="sold");
  S.cr.runs=[...new Set([runId,...open.filter(x=>CR_LIVE.includes(x.stage)).map(x=>x.id)].filter(Boolean))];
  if(!S.cr.ships){ try{ S.cr.ships=await api().cargo_ships(); }catch(_){ S.cr.ships={ok:false}; } }
  const sh=S.cr.ships; if(!S.cr.ship) S.cr.ship=sh?.mine?.[0]?.vehicle_id??null;
  renderCargo(); if(S.cr.ship!=null) crPlan(); }
function closeCargo(){ S.cr.open=false; $("cr-panel").classList.remove("show"); crStop(); }
async function crPlan(){ if(S.cr.ship==null) return; S.cr.busy=true; renderCargo();
  let r; try{ r=await api().cargo_plan(S.cr.ship,S.cr.runs,[],false,S.cr.boxLimit); }catch(e){ r={ok:false,error:"Couldn't work out the plan"}; }
  S.cr.busy=false; S.cr.data=r; if(!r?.ok) crClear(); renderCargo(); if(r?.ok) crScene(r.plan,true); }
// Nothing to show (no grid for this ship, or no ship): an empty view, not the last ship's boxes
function crClear(){ crStop(); S.cr.anim=null; const T=S.cr.three; if(T){ T.scene=new THREE.Scene(); T.meshes=[]; } }
function crShipOptions(){ const s=S.cr.ships; if(!s?.ok) return `<option value="">No ships</option>`;
  const o=x=>`<option value="${x.vehicle_id}" ${String(x.vehicle_id)===String(S.cr.ship)?"selected":""}>${x.main?"★ ":""}${esc(x.name)} · ${x.scu} SCU</option>`;
  return `${S.cr.ship==null?`<option value="">Pick a ship</option>`:""}${s.mine.length?`<optgroup label="My Fleet">${s.mine.map(o).join("")}</optgroup>`:""}<optgroup label="All ships with cargo">${s.others.map(o).join("")}</optgroup>`; }
function renderCargo(){ const P=$("cr-panel"); if(!P||!S.cr.open) return; const d=S.cr.data, p=d?.ok?d.plan:null;
  const open=(S.runs||[]).filter(x=>x.stage!=="sold");
  const runRow=x=>`<label class="cr-run"><input type="checkbox" data-crrun="${esc(x.id)}" ${S.cr.runs.includes(x.id)?"checked":""}>
      <span><b>${esc(x.commodity)}</b>${x.units?` · ${x.units} SCU`:` · <span style="color:#ffb454">no SCU set</span>`}<br><span class="muted">→ ${esc(x.to_place||"?")} · ${esc((STAGES.find(s=>s[0]===x.stage)||[])[1]||x.stage)}</span></span></label>`;
  const itemIdx=k=>p?.items.findIndex(i=>i.key===k);
  const items=p?p.items.map((it,i)=>`<div class="cr-item"><i style="background:${crColor(i)}"></i><div><b>${esc(it.name)}</b> <span class="muted">${it.scu} SCU${it.to?` → ${esc(it.to)}`:""}</span>
      <div style="font-size:12.5px">${Object.entries(it.boxes).map(([s,n])=>`${n} × ${s} SCU`).join(" + ")||"Nothing fits"}${it.max_box&&it.max_box<32?` <span class="muted">(boxes up to ${it.max_box} SCU here)</span>`:""}</div>
      ${it.left?`<div style="color:#ff9b8a;font-size:12.5px">${it.left} SCU doesn't fit</div>`:""}</div></div>`).join(""):"";
  const pct=p&&p.capacity?Math.round(p.used/p.capacity*100):0;
  P.innerHTML=`<div class="cr-wrap">
    <div class="cr-side">
      <div class="row" style="align-items:center"><h2 style="margin:0;font:600 22px var(--display)">Load plan</h2><span class="spacer"></span><button class="btn small ghost" data-cr="close">Close</button></div>
      <div class="muted" style="font-size:12.5px;margin:4px 0 12px">How your cargo fits, box by box, in the order to load it.</div>
      <label class="fm-k" for="cr-ship">Ship</label><select class="field" id="cr-ship" style="width:100%">${crShipOptions()}</select>
      ${d?.ok&&d.wiki_max_box<32?`<label class="fm-k" for="cr-box" style="margin-top:12px">Biggest box</label><select class="field" id="cr-box" style="width:100%">
        <option value="hold" ${S.cr.boxLimit!=="wiki"?"selected":""}>Whatever fits the hold</option><option value="wiki" ${S.cr.boxLimit==="wiki"?"selected":""}>The wiki's limit (${d.wiki_max_box} SCU)</option></select>`:""}
      <div class="fm-k" style="margin-top:14px">Cargo</div>
      ${open.length?open.map(runRow).join(""):`<div class="muted" style="font-size:12.5px">No Planned Routes yet.</div>`}
      ${S.cr.busy?`<div class="muted" style="margin-top:12px">Working it out…</div>`
      :d&&!d.ok?`<div class="note" style="margin-top:12px;color:#ffb454">${esc(d.error||"Couldn't plan this")}</div>`
      :p?`<div class="cr-sum"><div class="row"><b style="font:600 20px var(--display)">${p.used} <span class="muted" style="font-size:14px">/ ${p.capacity} SCU</span></b><span class="spacer"></span>
            ${p.left?`<b style="color:#ff9b8a">${p.left} SCU won't fit</b>`:`<b style="color:#57e39b">Everything fits</b>`}</div>
          <div class="cr-bar"><i style="width:${pct}%"></i></div>
          <div class="muted" style="font-size:12px">${d.ship.name} · ${plural(p.grids.length,"cargo grid")}${p.grids.some(g=>g.external)?" (some outside the hull)":""}</div></div>
        ${items}
        ${p.notes.map(n=>`<div class="muted" style="font-size:12px;margin-top:6px">${esc(n)}</div>`).join("")}
        ${d.skipped?.length?`<div class="muted" style="font-size:12px;margin-top:6px">Left out (no SCU on the route): ${d.skipped.map(esc).join(", ")}</div>`:""}
        <div class="muted" style="font-size:11.5px;margin-top:12px;line-height:1.5">Grid sizes: ${esc(d.source)}. Boxes stay upright and sit flat on the deck or other boxes. Cargo you unload last goes in first. A hauling contract may hand you smaller boxes than planned.</div>`:""}
    </div>
    <div class="cr-view">
      <canvas id="cr-canvas" aria-label="3D preview of the cargo layout"></canvas>
      <div class="cr-ctl">
        <button class="btn small primary" data-cr="play" ${p?"":"disabled"}>${S.cr.anim?.playing?"Pause":S.cr.anim&&S.cr.anim.step>=S.cr.anim.n?"Replay":"Play"}</button>
        <input type="range" id="cr-step" min="0" max="${p?S.cr.anim?.n||0:0}" value="${S.cr.anim?.step||0}" aria-label="Boxes loaded" style="flex:1;min-width:120px">
        <select class="field" id="cr-speed" aria-label="Speed" style="width:auto;padding:4px 6px">${[[0.5,"½×"],[1,"1×"],[2,"2×"],[4,"4×"]].map(([v,t])=>`<option value="${v}" ${S.cr.speed==v?"selected":""}>${t}</option>`).join("")}</select>
        <button class="btn small ghost" data-cr="view" title="Back to the starting view">Reset view</button>
      </div>
      <div class="cr-cap" id="cr-cap">${p?"":S.cr.busy?"Working it out…":d&&!d.ok?"No layout for this ship":"Pick a ship to see the layout"}</div>
      <div class="cr-hint">Arrow: the loading end · drag to turn · scroll to zoom</div>
    </div></div>`;
  $("cr-ship").onchange=e=>{ S.cr.ship=e.target.value?+e.target.value:null; crPlan(); };
  $("cr-speed").onchange=e=>{ S.cr.speed=+e.target.value; };
  const bx=$("cr-box"); if(bx) bx.onchange=e=>{ S.cr.boxLimit=e.target.value; crPlan(); };
  $("cr-step").oninput=e=>{ const A=S.cr.anim; if(!A) return; A.playing=false; A.step=+e.target.value; A.t0=null; crPaint(true); crCtl(); };
  if(S.cr.three?.scene) crAttach(); }
$("cr-panel").addEventListener("change",e=>{ const id=e.target.dataset?.crrun; if(!id) return;
  S.cr.runs=e.target.checked?[...new Set([...S.cr.runs,id])]:S.cr.runs.filter(x=>x!==id); crPlan(); });
$("cr-panel").addEventListener("click",e=>{ const a=e.target.closest("[data-cr]")?.dataset.cr; if(!a) return;
  if(a==="close") return closeCargo();
  if(a==="view"){ if(S.cr.three) S.cr.three.userMoved=false; return crResetView(); }
  if(a==="play"){ const A=S.cr.anim; if(!A) return; if(A.playing){ A.playing=false; } else { if(A.step>=A.n) A.step=0; A.playing=true; A.t0=null; } crCtl(); } });
function crCtl(){ const A=S.cr.anim, b=$("cr-panel").querySelector('[data-cr="play"]'), r=$("cr-step");
  if(b&&A) b.textContent=A.playing?"Pause":A.step>=A.n?"Replay":"Play";
  if(r&&A){ r.max=A.n; r.value=Math.floor(A.step); }
  const c=$("cr-cap"), p=S.cr.data?.plan; if(!c||!A||!p) return; const k=Math.min(A.n,Math.floor(A.step));
  if(k<=0){ c.textContent=`${A.n} boxes to load. Press Play.`; return; }
  const b2=A.boxes[k-1], it=p.items[b2.item];
  c.textContent=k>=A.n?`All ${A.n} boxes loaded · ${p.used} SCU`:`Box ${k} of ${A.n}: ${it.name}, ${b2.size} SCU${p.grids.length>1?` · grid ${b2.grid+1}`:""}`; }

// ---- the 3D view (its own small three.js renderer, apart from the map's)
function crScene(plan,autoplay){ crStop();
  const T=S.cr.three||(S.cr.three={}); const scene=new THREE.Scene(); T.scene=scene;
  scene.add(new THREE.AmbientLight(0xffffff,0.55)); const sun=new THREE.DirectionalLight(0xffffff,0.9); sun.position.set(0.6,1,0.4); scene.add(sun);
  const back=new THREE.DirectionalLight(0x8cc4ff,0.35); back.position.set(-0.5,0.3,-1); scene.add(back);
  // grids side by side across x, 2 cells apart; each grid is X wide, Y high, Z long (cells: 1 SCU = 1 unit)
  let off=0; const boxes=[]; T.meshes=[];
  plan.grids.forEach((g,gi)=>{ const ox=off; off+=g.X+2;
    const floor=new THREE.Mesh(new THREE.PlaneGeometry(g.X,g.Z),new THREE.MeshBasicMaterial({color:0x0c1629}));
    floor.rotation.x=-Math.PI/2; floor.position.set(ox+g.X/2,0,g.Z/2); scene.add(floor);
    const lines=[]; for(let x=0;x<=g.X;x++) lines.push(ox+x,0.002,0, ox+x,0.002,g.Z); for(let z=0;z<=g.Z;z++) lines.push(ox,0.002,z, ox+g.X,0.002,z);
    const lg=new THREE.BufferGeometry(); lg.setAttribute("position",new THREE.Float32BufferAttribute(lines,3));
    scene.add(new THREE.LineSegments(lg,new THREE.LineBasicMaterial({color:0x1b2b47})));
    const frame=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(g.X,g.Y,g.Z)),new THREE.LineBasicMaterial({color:g.external?0xffb454:0x4b8dff,transparent:true,opacity:.55}));
    frame.position.set(ox+g.X/2,g.Y/2,g.Z/2); scene.add(frame);
    // where loading starts: the far end (z 0) fills first, so the loading end (z = Z) stays clear
    const arrow=new THREE.ArrowHelper(new THREE.Vector3(0,0,-1),new THREE.Vector3(ox+g.X/2,0.05,g.Z+2.2),1.8,0x7fe7ff,0.6,0.5); scene.add(arrow);
    for(const b of g.boxes) boxes.push({...b,grid:gi,ox}); });
  boxes.sort((a,b)=>a.seq-b.seq);
  const geo=new THREE.BoxGeometry(1,1,1), edge=new THREE.EdgesGeometry(geo);
  for(const b of boxes){ const col=new THREE.Color(crColor(b.item));
    const m=new THREE.Mesh(geo,new THREE.MeshLambertMaterial({color:col}));
    m.scale.set(b.dx-0.08,b.dy-0.08,b.dz-0.08); m.position.set(b.ox+b.x+b.dx/2,b.y+b.dy/2,b.z+b.dz/2);
    const e=new THREE.LineSegments(edge,new THREE.LineBasicMaterial({color:col.clone().multiplyScalar(0.45)})); m.add(e);
    m.visible=false; m.userData={b,y:m.position.y}; scene.add(m); T.meshes.push(m); }
  const maxY=Math.max(...plan.grids.map(g=>g.Y)), maxZ=Math.max(...plan.grids.map(g=>g.Z));
  T.center=new THREE.Vector3(Math.max(off-2,1)/2,maxY*0.35,maxZ/2+1); T.size=Math.hypot(Math.max(off-2,1),maxZ+3,maxY);   // the whole layout's diagonal
  T.cam=T.cam||new THREE.PerspectiveCamera(40,1,0.1,5000); T.userMoved=false; crResetView(true);
  S.cr.anim={n:boxes.length,boxes,step:autoplay?0:boxes.length,playing:!!autoplay,t0:null,last:null};
  crAttach(); crCtl(); crLoop(); }
// The whole layout in view, with room for the controls: far enough back for the view's width as well as its height
function crFitDist(T){ const aspect=(T.w&&T.h)?T.w/T.h:1.5, vf=40*Math.PI/180, hf=2*Math.atan(Math.tan(vf/2)*aspect);
  return T.size*0.52/Math.tan(Math.min(vf,hf)/2); }
function crResetView(quiet){ const T=S.cr.three; if(!T) return; T.yaw=-0.75; T.pitch=0.7; T.dist=crFitDist(T); T.fitted=!quiet||T.fitted; if(!quiet) crPaint(true); }
function crAttach(){ const T=S.cr.three, cv=$("cr-canvas"); if(!T||!cv) return;
  if(T.canvas!==cv){ try{ T.renderer?.dispose(); }catch(_){}
    T.renderer=new THREE.WebGLRenderer({canvas:cv,antialias:true,alpha:true}); T.renderer.setPixelRatio(Math.min(2,window.devicePixelRatio||1)); T.canvas=cv;
    T.w=T.h=0; T.dpr=0;                                // a new canvas starts at 300x150: size it on the next paint
    let drag=null;
    cv.onpointerdown=e=>{ drag={x:e.clientX,y:e.clientY}; cv.setPointerCapture(e.pointerId); };
    cv.onpointermove=e=>{ if(!drag) return; T.userMoved=true; T.yaw-= (e.clientX-drag.x)*0.008; T.pitch=Math.max(0.08,Math.min(1.45,T.pitch+(e.clientY-drag.y)*0.006)); drag={x:e.clientX,y:e.clientY}; crPaint(true); };
    cv.onpointerup=()=>{ drag=null; };
    cv.onwheel=e=>{ e.preventDefault(); T.userMoved=true; T.dist=Math.max(T.size*0.3,Math.min(T.size*4,T.dist*(e.deltaY>0?1.12:0.89))); crPaint(true); }; }
  crPaint(true); }
function crPaint(now){ const T=S.cr.three, A=S.cr.anim; if(!T?.renderer||!T.canvas.isConnected) return;
  const w=T.canvas.clientWidth||600, h=T.canvas.clientHeight||400;
  const dpr=Math.min(2,window.devicePixelRatio||1);
  if(T.w!==w||T.h!==h||T.dpr!==dpr){ T.renderer.setPixelRatio(dpr); T.renderer.setSize(w,h,false); T.cam.aspect=w/h; T.cam.updateProjectionMatrix(); T.w=w; T.h=h; T.dpr=dpr;
    if(!T.userMoved) T.dist=crFitDist(T); }                    // the panel changed shape: refit, unless you've moved the view
  const c=T.center; T.cam.position.set(c.x+T.dist*Math.cos(T.pitch)*Math.sin(T.yaw), c.y+T.dist*Math.sin(T.pitch), c.z+T.dist*Math.cos(T.pitch)*Math.cos(T.yaw)); T.cam.lookAt(c);
  if(A){ const k=A.step; T.meshes.forEach((m,i)=>{ const f=k-i; m.visible=f>0;
      if(f>0){ const e=Math.min(1,f*1.0), drop=(1-e)*(1-e)*3; m.position.y=m.userData.y+drop; } }); }
  T.renderer.render(T.scene,T.cam); }
// Boxes go in one after another: the whole load takes about 6 s at 1×, never less than a beat per box
function crLoop(){ const T=S.cr.three; if(!T) return;
  const tick=ts=>{ if(!S.cr.open){ T.raf=null; return; } const A=S.cr.anim;
    if(A&&A.playing){ const per=Math.max(45,Math.min(420,6000/Math.max(1,A.n)))/S.cr.speed;
      if(A.last!=null) A.step=Math.min(A.n,A.step+(ts-A.last)/per); A.last=ts;
      if(A.step>=A.n){ A.playing=false; A.last=null; } crCtl(); }
    else if(A) A.last=null;
    crPaint(); T.raf=requestAnimationFrame(tick); };
  if(!T.raf) T.raf=requestAnimationFrame(tick); }
function crStop(){ const T=S.cr.three; if(T?.raf){ cancelAnimationFrame(T.raf); T.raf=null; }
  if(T?.scene){ T.scene.traverse(o=>{ o.geometry?.dispose?.(); o.material?.dispose?.(); }); } }
