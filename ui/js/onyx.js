// Quantum UI: Onyx Facility floor plans. Every Onyx Facility (all 120) shares one interior, and
// tools/build_onyx_plan.py draws it from the game's own layout and models: each wing's storeys with their walls,
// walkable floor, doors, rooms, lifts, hangar lifts and enemy spawn closets (ui/onyx/Onyx.js on the
// asset server, window.QONYX). A /showlocation inside a facility puts you on the right wing and storey and
// draws the way out along the corridors; without one, click where you are.
"use strict";
(()=>{
const OX={data:null, loading:null, site:null, wing:null, floor:0, you:null, auto:null, view:null, cache:{}, raf:0,
  mode:(()=>{ try{ return localStorage.getItem("onyxMode")||"3d"; }catch(e){ return "3d"; } })()};
const WING_ORDER=["Lobby","Research","Engineering","Site-B"];
const WING_NOTE={Lobby:"Hangar lifts and the lifts down to each wing",Research:"Sector B · 9 sub-levels",
  Engineering:"Sector A · power core and condensers",["Site-B"]:"Jorrit's lab and the Yormandi caves"};
// A lift route that takes you out of a wing (toward the lobby): its stops are where the way out starts
const isExit=r=>/(^|_)exit(_lobby)?$/.test(r)&&!/entrance/.test(r);

function load(){ if(OX.data) return Promise.resolve(OX.data);
  return OX.loading=OX.loading||window.qLoadAsset("onyx/Onyx.js").then(()=>{ OX.data=window.QONYX||null; OX.loading=null; return OX.data; }); }
const sites=()=>S.onyxSites||{};
window.isOnyxPlace=n=>/^Onyx Facility\b/.test(n||"");

// ---- where you are in a facility: your /showlocation, in the facility's own frame
function toFacility(site,p){ const R=site.rot, d=[p[0]-site.pos[0],p[1]-site.pos[1],p[2]-site.pos[2]];
  return [R[0]*d[0]+R[3]*d[1]+R[6]*d[2], R[1]*d[0]+R[4]*d[1]+R[7]*d[2], R[2]*d[0]+R[5]*d[1]+R[8]*d[2]]; }
// The facility you're in (within 1.5 km of its marker on the same moon and below its surface), or null
function siteAt(pl){ if(!pl?.local||!pl.body) return null; let best=null;
  for(const [name,s] of Object.entries(sites())){ if(s.body!==pl.body) continue;
    const f=toFacility(s,pl.local), h=Math.hypot(f[0],f[1]);
    if(h<1500&&f[2]>-800&&f[2]<300&&(!best||h<best.h)) best={name,s,f,h}; }
  return best; }
// Which wing and storey a point in the facility frame is on
function placeIn(f){ const D=OX.data; if(!D) return null; let best=null;
  for(const [w,W] of Object.entries(D.wings)){ const b=W.box; if(f[0]<b[0]||f[0]>b[2]||f[1]<b[1]||f[1]>b[3]) continue;
    W.floors.forEach((F,i)=>{ const dz=f[2]-F.z; if(dz<-1.5||dz>7) return; const sc=Math.abs(dz-1.6);
      if(!best||sc<best.sc) best={wing:w,floor:i,sc}; }); }
  return best; }

// ---- the floor's pictures (1-bit PNGs) -> tinted canvases, and the walkable grid for the route
function img(png){ return new Promise(r=>{ const i=new Image(); i.onload=()=>r(i); i.onerror=()=>r(null); i.src="data:image/png;base64,"+png; }); }
function tint(im,rgba){ const c=document.createElement("canvas"); c.width=im.width; c.height=im.height; const x=c.getContext("2d");
  x.drawImage(im,0,0); const d=x.getImageData(0,0,c.width,c.height), a=d.data;
  for(let k=0;k<a.length;k+=4){ const on=a[k]>127; a[k]=rgba[0]; a[k+1]=rgba[1]; a[k+2]=rgba[2]; a[k+3]=on?rgba[3]:0; }
  x.putImageData(d,0,0); return {c,d:a,w:c.width,h:c.height}; }
async function floorArt(w,i){ const k=w+"|"+i; if(OX.cache[k]) return OX.cache[k];
  const F=OX.data.wings[w].floors[i], [fi,wi]=await Promise.all([img(F.fill.png),img(F.walls.png)]);
  if(!fi||!wi) return null;
  // the game's hologram map: translucent blue floor, bright cyan walls with a soft glow (drawn once here)
  const fill=tint(fi,[38,120,210,70]), walls=tint(wi,[150,225,255,255]);
  const glow=document.createElement("canvas"); glow.width=walls.w; glow.height=walls.h;
  { const g=glow.getContext("2d"); g.filter="blur(6px)"; g.drawImage(walls.c,0,0); g.filter="blur(2px)"; g.drawImage(walls.c,0,0); }
  // What each 0.5 m cell costs to walk through: floor with no wall 1; no floor in the plan (a gap in the game's floor
  // surfaces) 6; a wall 250 (counted as 2 km a cell when routing: only where the plans leave no other way); a door
  // the game keeps locked (sealed) 255: never.
  const fc=F.fill.cell, wc=F.walls.cell, n=fill.w*fill.h, ok=new Uint8Array(n), cost=new Uint8Array(n);
  for(let j=0;j<fill.h;j++) for(let i2=0;i2<fill.w;i2++){ const floor=fill.d[(j*fill.w+i2)*4+3]!==0;
    let wall=false; const x0=Math.floor(i2*fc/wc), y0=Math.floor(j*fc/wc), x1=Math.ceil((i2+1)*fc/wc), y1=Math.ceil((j+1)*fc/wc);
    for(let y=y0;y<y1&&!wall;y++) for(let x=x0;x<x1;x++){ if(x<walls.w&&y<walls.h&&walls.d[(y*walls.w+x)*4+3]) { wall=true; break; } }
    const c=wall?250:floor?1:6; cost[j*fill.w+i2]=c; if(c===1) ok[j*fill.w+i2]=1; }
  // Doorways: the game's doors and room openings (RoomConnector). The model slice often leaves a door frame or a
  // sliding door's panels across a doorway, closing a room off; open the plan up at each one (sealed doors stay shut)
  for(const p of [...(F.doors||[]),...(F.openings||[])]){ const [ci,cj]=toCell(F,p[0],p[1]), r=Math.ceil(1.4/fc);
    for(let y=cj-r;y<=cj+r;y++) for(let x=ci-r;x<=ci+r;x++) if(x>=0&&y>=0&&x<fill.w&&y<fill.h&&Math.hypot(x-ci,y-cj)*fc<=1.4){
      const q=y*fill.w+x; if(cost[q]>=250){ cost[q]=2; } } }
  for(const p of F.sealed||[]){ const [ci,cj]=toCell(F,p[0],p[1]), r=Math.ceil(1.8/fc);
    for(let y=cj-r;y<=cj+r;y++) for(let x=ci-r;x<=ci+r;x++) if(x>=0&&y>=0&&x<fill.w&&y<fill.h&&Math.hypot(x-ci,y-cj)*fc<=1.8){ cost[y*fill.w+x]=255; ok[y*fill.w+x]=0; } }
  return OX.cache[k]={fill,walls,glow:{c:glow,w:glow.width,h:glow.height},ok,cost,F}; }
// world (facility metres) <-> a floor's grid cell
const toCell=(F,x,y)=>[Math.floor((x-F.fill.x0)/F.fill.cell),Math.floor((F.fill.y1-y)/F.fill.cell)];
const toWorld=(F,i,j)=>[F.fill.x0+(i+0.5)*F.fill.cell,F.fill.y1-(j+0.5)*F.fill.cell];
function nearestOk(art,i,j,r=24){ const w=art.fill.w,h=art.fill.h;
  for(let d=0;d<=r;d++) for(let y=j-d;y<=j+d;y++) for(let x=i-d;x<=i+d;x++){
    if((Math.abs(y-j)===d||Math.abs(x-i)===d)&&x>=0&&y>=0&&x<w&&y<h&&art.ok[y*w+x]) return [x,y]; }
  return null; }

// ---- what to do from here: the way out of this wing, from this storey
function targets(w,F){ if(w==="Lobby") return (F.hangar_lifts||[]).map(p=>({at:p,label:"Hangar lift"}));
  return (F.stops||[]).filter(s=>s.routes.some(isExit)).map(s=>({at:s.at,label:stopLabel(w,F,s)})); }
// What a lift is, by the routes the game names at its stop (labs_entrance, power_to_labs, science_exit...):
// where it takes you from here, or where it brings people from. Research's lower exit stop is the lift up the
// atrium to SL1; every other exit stop is the lift back up to the lobby.
const WK={labs:"Research",power:"Engineering",science:"Site-B",yormandi:"the Yormandi caves"};
function stopLabel(w,F,s){
  if(w!=="Lobby"&&s.routes.some(isExit)) return w==="Research"&&F.sl&&F.sl>1?"Exit lift up to SL1":"Exit lift to the lobby";
  const to=new Set(), from=new Set();
  for(const r of s.routes){ let m;
    if((m=r.match(/^([a-z]+)_to_([a-z]+)$/))){ if(WK[m[2]]===w) from.add(WK[m[1]]); else to.add(WK[m[2]]); }
    else if((m=r.match(/^([a-z]+)_entrance$/))){ if(WK[m[1]]===w) from.add("the lobby"); else to.add(WK[m[1]]); }
    else if((m=r.match(/^([a-z]+)_exit(_lobby)?$/))&&w==="Lobby") from.add(WK[m[1]]); }
  return to.size?"Lift to "+[...to].join(" / "):from.size?"Lift from "+[...from].join(" / "):"Lift"; }
function floorName(w,F,i){ return F.sl?`SL${F.sl}`:`Level ${i+1}`; }

// ---- the whole way out: walking on each storey (Dijkstra over its walkable cells) and the lifts, stairs and exit
// lift between storeys (the wing's "links", from build_onyx_plan.py), to the wing's exit (or a hangar lift).
// A spot's cell: inside the floor's picture (clamped), on walkable floor nearby if there is some within 6 m
function cellAt(a,x,y){ const [i,j]=toCell(a.F,x,y), w=a.fill.w, h=a.fill.h, ci=Math.min(w-1,Math.max(0,i)), cj=Math.min(h-1,Math.max(0,j));
  const c=nearestOk(a,ci,cj,12)||[ci,cj]; return c[1]*w+c[0]; }
const LINK_COST={lift:15,stairs:8,exitlift:20,climb:10,gap:2000};   // gap: only to get off a floor the plans leave stranded
// Floors the plans don't join to the rest of their wing (stairs or a ramp the tool didn't recognise): each gets a
// way to the nearest floor (by height) it can't otherwise reach, at the spots where the two floors line up
// (or come closest), until every floor reaches an exit. The route calls these out as not shown in the plans.
async function bridges(w){ const W=OX.data.wings[w]; if(W._bridged) return W._bridged;
  const n=W.floors.length, arts=[]; for(let i=0;i<n;i++) arts.push(await floorArt(w,i));
  const links=(W.links||[]).filter(L=>!L.dropped), goal=new Set(goals(w,W).map(g=>g.f)), out=[];
  const comp=()=>{ const adj=[...Array(n)].map(()=>new Set()); for(const L of links) for(const a of L.ends) for(const b of L.ends) if(a[0]!==b[0]) adj[a[0]].add(b[0]);
    return [...Array(n).keys()].map(i=>{ const seen=new Set([i]),q=[i]; while(q.length){ const x=q.pop(); for(const y of adj[x]) if(!seen.has(y)){ seen.add(y); q.push(y); } } return seen; }); };
  const cells=a=>{ const r=[], st=Math.max(1,Math.round(Math.sqrt(a.fill.w*a.fill.h/40000))); for(let j=0;j<a.fill.h;j+=st) for(let i=0;i<a.fill.w;i+=st) if(a.ok[j*a.fill.w+i]) r.push(toWorld(a.F,i,j)); return r; };
  for(let guard=0;guard<n;guard++){ const C=comp(), stuck=[...Array(n).keys()].find(i=>arts[i]&&![...C[i]].some(j=>goal.has(j)));
    if(stuck===undefined) break;
    const others=[...Array(n).keys()].filter(j=>!C[stuck].has(j)&&arts[j]).sort((a,b)=>Math.abs(W.floors[a].z-W.floors[stuck].z)-Math.abs(W.floors[b].z-W.floors[stuck].z));
    const j=others[0]; if(j===undefined) break;
    const A=arts[stuck], B=arts[j], pa=cells(A), lined=[];
    for(const p of pa){ const [i2,j2]=toCell(B.F,p[0],p[1]); if(i2>=0&&j2>=0&&i2<B.fill.w&&j2<B.fill.h&&B.ok[j2*B.fill.w+i2]) lined.push(p); }
    let pts=[];
    if(lined.length){ pts.push(lined[0]); while(pts.length<5){ let far=null,fd=0;
        for(const p of lined){ const d=Math.min(...pts.map(q=>Math.hypot(p[0]-q[0],p[1]-q[1]))); if(d>fd){ fd=d; far=p; } }
        if(!far||fd<15) break; pts.push(far); }
      pts=pts.map(p=>[p,p]); }
    else { const pb=cells(B), sa=pa.filter((_,k)=>k%Math.ceil(pa.length/2500)===0), sb=pb.filter((_,k)=>k%Math.ceil(pb.length/2500)===0); let best=null;
      for(const p of sa) for(const q of sb){ const d=(p[0]-q[0])**2+(p[1]-q[1])**2; if(!best||d<best.d) best={d,p,q}; }
      if(best) pts=[[best.p,best.q]]; }
    if(!pts.length) break;
    for(const [p,q] of pts){ const L={kind:"gap",ends:[[stuck,p[0],p[1]],[j,q[0],q[1]]]}; links.push(L); out.push(L); } }
  return W._bridged=out; }
// The wing's goals: its exit-lift stops (in Research only the SL1 one: the SL8 exit lift rides up to SL1 first),
// or in the lobby, its hangar lifts
function goals(w,W){ const g=[];
  if(w==="Lobby") W.floors.forEach((F,i)=>(F.hangar_lifts||[]).forEach(p=>g.push({f:i,x:p[0],y:p[1],label:"Hangar lift"})));
  else { const lower=new Set();
    if(w==="Research") for(const L of W.links||[]) if(L.kind==="exitlift") L.ends.slice(1).forEach(e=>lower.add(e[0]+"|"+Math.round(e[1])+"|"+Math.round(e[2])));
    W.floors.forEach((F,i)=>(F.stops||[]).filter(s=>s.routes.some(isExit)).forEach(s=>{
      if(!lower.has(i+"|"+Math.round(s.at[0])+"|"+Math.round(s.at[1]))) g.push({f:i,x:s.at[0],y:s.at[1],label:"Exit lift to the lobby"}); })); }
  return g; }
// A binary heap of (cost, cell) in typed arrays: the route searches visit millions of cells
function Heap(){ let k=new Float64Array(1<<16), v=new Int32Array(1<<16), n=0;
  return { get size(){ return n; },
    push(c,x){ if(n===k.length){ const k2=new Float64Array(n*2), v2=new Int32Array(n*2); k2.set(k); v2.set(v); k=k2; v=v2; }
      let i=n++; while(i){ const p=(i-1)>>1; if(k[p]<=c) break; k[i]=k[p]; v[i]=v[p]; i=p; } k[i]=c; v[i]=x; },
    pop(){ const top=v[0], c=k[--n], x=v[n]; let i=0;
      for(;;){ let m=2*i+1; if(m>=n) break; if(m+1<n&&k[m+1]<k[m]) m++; if(k[m]>=c) break; k[i]=k[m]; v[i]=v[m]; i=m; }
      k[i]=c; v[i]=x; return top; } }; }
// One search over all the wing's floors at once: walking cells on each floor (cost-weighted metres), and the stairs,
// lifts and exit lift between floors as jumps, out to the first exit it reaches -> {cost, steps} or null
async function solve(){ const w=OX.wing, W=OX.data.wings[w], Y=OX.you; if(!Y||Y.wing!==w) return null;
  const n=W.floors.length, arts=[]; for(let i=0;i<n;i++) arts.push(await floorArt(w,i));
  const extra=await bridges(w); if(!arts[Y.floor]) return null;
  const off=[], at=[]; let N=0; for(let i=0;i<n;i++){ off.push(N); N+=arts[i]?arts[i].ok.length:0; }
  const floorOf=g=>{ let f=n-1; while(f>0&&off[f]>g) f--; return f; };
  const jumps=new Map(), ends=new Map(), goalAt=new Map();
  for(const L of [...(W.links||[]).filter(L=>!L.dropped),...extra]){ const cs=L.ends.map(e=>arts[e[0]]?off[e[0]]+cellAt(arts[e[0]],e[1],e[2]):-1);
    L.ends.forEach((e,i)=>{ if(cs[i]<0) return; ends.set(cs[i],L.kind);
      L.ends.forEach((e2,j)=>{ if(i===j||cs[j]<0||e2[0]===e[0]) return;
        (jumps.get(cs[i])||jumps.set(cs[i],[]).get(cs[i])).push([cs[j],(LINK_COST[L.kind]+(L.kind==="stairs"&&!L.check?40:0))*Math.max(1,Math.abs(e2[0]-e[0])),L.kind]); }); }); }
  // (stairs the game's rooms confirm, check:"rooms", come first; ones they can't vouch for only when nothing else goes)
  for(const g of goals(w,W)) if(arts[g.f]) goalAt.set(off[g.f]+cellAt(arts[g.f],g.x,g.y),g);
  if(!goalAt.size) return null;
  const d=new Float32Array(N).fill(Infinity), from=new Int32Array(N).fill(-1), ride=new Uint8Array(N), shut=new Uint8Array(N), H=Heap();
  const src=off[Y.floor]+cellAt(arts[Y.floor],Y.x,Y.y); d[src]=0; H.push(0,src);
  const KIND=["","stairs","lift","exitlift","gap","climb"]; let hit=-1;
  while(H.size){ const g=H.pop(); if(shut[g]) continue; shut[g]=1; if(goalAt.has(g)){ hit=g; break; }
    const f=floorOf(g), a=arts[f], k=g-off[f], wd=a.fill.w, x=k%wd, y=k/wd|0, cs=a.F.fill.cell;
    for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++){ if(!dx&&!dy) continue; const nx=x+dx, ny=y+dy;
      if(nx<0||ny<0||nx>=wd||ny>=a.fill.h) continue; const q=off[f]+ny*wd+nx; if(shut[q]||a.cost[ny*wd+nx]===255) continue;
      const cc=a.cost[ny*wd+nx], c=d[g]+(cc===250?4000:cc)*cs*(dx&&dy?1.4142:1); if(c<d[q]){ d[q]=c; from[q]=g; ride[q]=0; H.push(c,q); } }
    for(const [q,c0,kind] of jumps.get(g)||[]){ if(shut[q]) continue; const c=d[g]+c0;
      if(c<d[q]){ d[q]=c; from[q]=g; ride[q]=KIND.indexOf(kind); H.push(c,q); } } }
  if(hit<0) return null;
  // back from the exit to you, cut into walks (one per floor) and the rides between them
  const chain=[]; for(let g=hit;g>=0;g=from[g]) chain.push(g); chain.reverse();
  const steps=[]; let leg=[chain[0]];
  const node=g=>{ const f=floorOf(g), a=arts[f], k=g-off[f], p=toWorld(a.F,k%a.fill.w,k/a.fill.w|0);
    return goalAt.has(g)?{...goalAt.get(g),goal:true}:{f,x:p[0],y:p[1],kind:ends.get(g)}; };
  const close=(end,kind)=>{ const f=floorOf(leg[0]), a=arts[f]; let rough=0;
    for(const g of leg) if(a.cost[g-off[f]]>1) rough++;
    steps.push({walk:true,f,to:kind?{...node(end),kind}:node(end),path:leg.map(g=>{ const k=g-off[f]; return toWorld(a.F,k%a.fill.w,k/a.fill.w|0); }),rough:rough/leg.length}); };
  for(let i=1;i<chain.length;i++){ const g=chain[i];
    if(ride[g]){ close(chain[i-1],KIND[ride[g]]); steps.push({ride:KIND[ride[g]],from:floorOf(chain[i-1]),f:floorOf(g),to:node(g)}); leg=[g]; }
    else leg.push(g); }
  close(hit);
  return {cost:d[hit],steps:steps.filter(l=>!l.walk||l.path.length>1||l.to.goal)}; }
function plan(){ const D=OX.data, W=D.wings[OX.wing], F=W.floors[OX.floor], here=targets(OX.wing,F);
  const exitFloors=W.floors.map((G,i)=>targets(OX.wing,G).length?floorName(OX.wing,G,i):null).filter(Boolean);
  const steps=[];
  if(OX.wing==="Research"){
    if(F.sl===1) steps.push("Take the exit lift here up to the lobby");
    else if(F.sl===8) steps.push("Get to the exit lift on this floor","Ride it up to SL1","Take the exit lift there up to the lobby");
    else steps.push(F.sl<8?"Head down to SL8: the wing's exit lift starts there, at the bottom of the atrium":"Go up one floor to SL8 and its exit lift","Ride the exit lift up to SL1","Take the exit lift there up to the lobby");
  } else if(OX.wing==="Lobby"){ steps.push(here.length?"Take a hangar lift up to your ship":"Go to Level 2: the hangar lifts are there"); }
  else steps.push(here.length?"Get to the exit lift on this floor":`No exit lift on this floor: they're on ${exitFloors.join(", ")||"another floor"}`,"Ride it up to the lobby");
  if(OX.wing!=="Lobby") steps.push("Hangar lift up to your ship");
  return {here,steps}; }

// ---- the view
function el(){ let v=document.getElementById("onyx-view"); if(v) return v;
  const st=document.createElement("style"); st.textContent=`
  #onyx-view{position:fixed;inset:0;z-index:60;background:rgba(3,6,12,.82);display:none;align-items:center;justify-content:center}
  #onyx-view.show{display:flex}
  #onyx-view .ox{width:min(1280px,96vw);height:min(860px,94vh);background:#070b14;border:1px solid var(--line);border-radius:14px;display:grid;grid-template-rows:auto auto 1fr;overflow:hidden}
  #onyx-view .hd{display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid var(--line)}
  #onyx-view .hd h2{margin:0;font-size:17px}#onyx-view .hd .muted{font-size:12.5px}
  #onyx-view .tabs{display:flex;gap:6px;flex-wrap:wrap;align-items:center;padding:8px 16px;border-bottom:1px solid var(--line)}
  #onyx-view .tabs button{border:1px solid var(--line-2);background:var(--panel);color:var(--ink-2);border-radius:7px;padding:5px 10px;font-size:12.5px;cursor:pointer}
  #onyx-view .tabs button.on{background:#1b3a63;border-color:#4b8dff;color:#eef3fb}
  #onyx-view .tabs .sep{width:1px;height:20px;background:var(--line);margin:0 6px}
  #onyx-view .bd{display:grid;grid-template-columns:minmax(0,1fr) 290px;min-height:0}
  #onyx-view canvas{width:100%;height:100%;display:block;cursor:crosshair;background:radial-gradient(ellipse at 50% 45%,#0b1c33 0%,#060c18 70%,#04070e 100%)}
  #onyx-view .side{border-left:1px solid var(--line);padding:14px;overflow:auto;font-size:13px;line-height:1.55}
  #onyx-view .side h3{margin:0 0 6px;font-size:14px}
  #onyx-view .side ol{margin:6px 0 12px 18px;padding:0}#onyx-view .side li{margin:3px 0}
  #onyx-view .lg{display:grid;grid-template-columns:16px 1fr;gap:5px 8px;align-items:center;font-size:12.5px;color:var(--ink-2)}
  #onyx-view .lg i{width:12px;height:12px;border-radius:3px;display:block}`;
  document.head.appendChild(st);
  v=document.createElement("div"); v.id="onyx-view";
  v.innerHTML=`<div class="ox"><div class="hd"><div><h2 id="ox-title">Onyx Facility</h2><div class="muted" id="ox-sub"></div></div>
      <button class="btn small ghost" id="ox-mode" style="margin-left:auto" title="Switch between the 3D hologram and the flat plan"></button>
      <button class="btn small ghost" id="ox-locate" title="Use your last /showlocation">Use my /showlocation</button>
      <button class="btn small ghost" id="ox-close" aria-label="Close">Close</button></div>
    <div class="tabs" id="ox-tabs"></div>
    <div class="bd"><div style="position:relative;min-width:0;min-height:0"><canvas id="ox-cv" style="position:absolute;inset:0"></canvas><canvas id="ox-gl" style="position:absolute;inset:0"></canvas>
      <div id="ox-hint" style="position:absolute;left:12px;bottom:10px;font-size:11.5px;color:#7fa9cc;pointer-events:none"></div></div><div class="side" id="ox-side"></div></div></div>`;
  document.body.appendChild(v);
  v.querySelector("#ox-close").onclick=close; v.addEventListener("mousedown",e=>{ if(e.target===v) close(); });
  v.querySelector("#ox-locate").onclick=()=>locate(true);
  v.querySelector("#ox-mode").onclick=()=>{ OX.mode=OX.mode==="3d"?"plan":"3d"; try{ localStorage.setItem("onyxMode",OX.mode); }catch(e){} modeUI(); draw(); };
  holoInput(v.querySelector("#ox-gl"));
  modeUI();
  const cv=v.querySelector("#ox-cv"); let drag=null;
  cv.addEventListener("wheel",e=>{ e.preventDefault(); const k=e.deltaY<0?1.2:1/1.2, r=cv.getBoundingClientRect(), V=OX.view;
    const wx=V.cx+(e.clientX-r.left-r.width/2)/V.s, wy=V.cy-(e.clientY-r.top-r.height/2)/V.s; V.s=Math.max(0.5,Math.min(40,V.s*k));
    V.cx=wx-(e.clientX-r.left-r.width/2)/V.s; V.cy=wy+(e.clientY-r.top-r.height/2)/V.s; draw(); },{passive:false});
  cv.addEventListener("mousedown",e=>{ drag={x:e.clientX,y:e.clientY,cx:OX.view.cx,cy:OX.view.cy,moved:false}; });
  cv.addEventListener("mousemove",e=>{ if(drag||!OX.view||!OX.data) return; const r=cv.getBoundingClientRect(), V=OX.view, F=OX.data.wings[OX.wing].floors[OX.floor];
    const mx=e.clientX-r.left, my=e.clientY-r.top, sx=p=>(p[0]-V.cx)*V.s+r.width/2, sy=p=>(V.cy-p[1])*V.s+r.height/2;
    let best=null;
    for(const [L,c] of [[F.spawns,"#ff8a8a"],[F.hazards,"#ffb46b"],[F.loot,"#9fe0b4"],[F.objectives,"#ffec78"],[F.supplies,"#78c8ff"],[F.locked,"#c878ff"]]) for(const p of L||[]){ const d=Math.hypot(sx(p)-mx,sy(p)-my);
      if(d<12&&(!best||d<best.d)) best={d,p,t:p[3]||"Enemy spawn",c}; }
    OX.hover=best; cv.style.cursor=best?"help":"crosshair"; });
  window.addEventListener("mousemove",e=>{ if(!drag) return; const dx=e.clientX-drag.x, dy=e.clientY-drag.y; if(Math.hypot(dx,dy)>4) drag.moved=true;
    OX.view.cx=drag.cx-dx/OX.view.s; OX.view.cy=drag.cy+dy/OX.view.s; draw(); });
  window.addEventListener("mouseup",e=>{ if(!drag) return; const d=drag; drag=null; if(d.moved) return;
    const r=cv.getBoundingClientRect(), V=OX.view;
    if(e.target!==cv) return;
    OX.msg=null; OX.you={x:V.cx+(e.clientX-r.left-r.width/2)/V.s, y:V.cy-(e.clientY-r.top-r.height/2)/V.s, wing:OX.wing, floor:OX.floor, manual:true, site:OX.site};
    route(); });
  window.addEventListener("resize",()=>{ if(v.classList.contains("show")) draw(); });
  document.addEventListener("keydown",e=>{ if(e.key==="Escape"&&v.classList.contains("show")) close(); });
  return v; }
function close(){ document.getElementById("onyx-view")?.classList.remove("show"); cancelAnimationFrame(OX.raf); OX.raf=0; }

function fit(){ const W=OX.data.wings[OX.wing], b=W.box, cv=document.getElementById("ox-cv");
  const s=Math.min(cv.clientWidth/(b[2]-b[0]),cv.clientHeight/(b[3]-b[1]))*0.92;
  OX.view={cx:(b[0]+b[2])/2, cy:(b[1]+b[3])/2, s:Math.max(0.5,s)}; }
function tabs(){ const D=OX.data, W=D.wings[OX.wing], t=document.getElementById("ox-tabs");
  t.innerHTML=WING_ORDER.filter(w=>D.wings[w]).map(w=>`<button data-w="${w}" class="${w===OX.wing?"on":""}">${w}</button>`).join("")+
    `<span class="sep"></span>`+W.floors.map((F,i)=>`<button data-f="${i}" class="${i===OX.floor?"on":""}" title="${F.z.toFixed(0)} m">${floorName(OX.wing,F,i)}${OX.you&&OX.you.wing===OX.wing&&OX.you.floor===i?" ●":OX.sol?.r?.steps.some(l=>l.walk&&l.f===i)?` <span style="color:#7fe7ff">›</span>`:""}${(F.spawns?.length||0)?` <span style="color:#ff6b6b">●${(F.spawns?.length||0)}</span>`:""}</button>`).join("");
  t.onclick=e=>{ const b=e.target.closest("button"); if(!b) return;
    if(b.dataset.w){ OX.wing=b.dataset.w; OX.floor=OX.you?.wing===OX.wing?OX.you.floor:0; fit(); }
    else OX.floor=+b.dataset.f;
    show(); }; }

async function show(){ const D=OX.data, W=D.wings[OX.wing], F=W.floors[OX.floor];
  document.getElementById("ox-title").textContent=OX.site||"Onyx Facility";
  document.getElementById("ox-sub").textContent=`${OX.wing} · ${floorName(OX.wing,F,OX.floor)} · ${WING_NOTE[OX.wing]||""}`;
  tabs(); OX.art=await floorArt(OX.wing,OX.floor); route(); }

async function route(){ const P=plan(), tok=OX.routeTok=(OX.routeTok||0)+1;
  if(OX.you&&OX.you.wing===OX.wing){ if(!OX.sol||OX.sol.key!==youKey()){ side(P,true); draw();
      const r=await solve(); if(tok!==OX.routeTok) return; OX.sol={key:youKey(),r}; } }
  else OX.sol=null;
  tabs(); side(P); draw(); if(!OX.raf) anim(); }
const youKey=()=>OX.you?[OX.you.wing,OX.you.floor,Math.round(OX.you.x),Math.round(OX.you.y)].join("|"):"";
// The route's steps, in words
function routeSteps(r){ const W=OX.data.wings[OX.wing], out=[];
  r.steps.forEach((l,ix)=>{ const nx=r.steps[ix+1]; if(l.walk){ let m=0; for(let i=1;i<l.path.length;i++) m+=Math.hypot(l.path[i][0]-l.path[i-1][0],l.path[i][1]-l.path[i-1][1]);
      const t=l.to, what=t.goal?t.label.replace(/^Exit lift/,"the exit lift").replace(/^Hangar lift/,"a hangar lift"):t.kind==="stairs"?"the stairs":t.kind==="exitlift"?"the exit lift":t.kind==="gap"?`the way ${nx&&nx.f<l.f?"up":"down"}`:t.kind==="climb"?(nx&&nx.f<l.f?"the climb up":"the drop down"):"the lift";
      out.push(`${floorName(OX.wing,W.floors[l.f],l.f)}: walk about ${Math.max(5,Math.round(m/5)*5)} m to ${what}`); }
    else { const up=l.f<l.from, to=floorName(OX.wing,W.floors[l.f],l.f);
      out.push(l.ride==="climb"?(up?`Climb up to ${to}`:`Drop down to ${to}`):l.ride==="gap"?`Find the way ${up?"up":"down"} to ${to} around here: the plans don't show it`:l.ride==="stairs"?`Take the stairs ${up?"up":"down"} to ${to}`:l.ride==="exitlift"?`Ride the exit lift up to ${to}`:`Take the lift ${up?"up":"down"} to ${to}`); } });
  out.push(OX.wing==="Lobby"?"Take the hangar lift up to your ship":"Take the exit lift up to the lobby");
  if(OX.wing!=="Lobby") out.push("Hangar lift up to your ship");
  return out; }

function side(P,busy){ const W=OX.data.wings[OX.wing], F=W.floors[OX.floor], Y=OX.you, s=document.getElementById("ox-side");
  const sol=OX.sol?.r, steps=sol?routeSteps(sol):P.steps, legHere=sol?sol.steps.filter(l=>l.walk&&l.f===OX.floor):[];
  const onThis=Y&&Y.wing===OX.wing&&Y.floor===OX.floor, near=onThis?(F.spawns||[]).filter(p=>Math.hypot(p[0]-Y.x,p[1]-Y.y)<45).length:0;
  s.innerHTML=`<h3>${Y?(onThis?"You're on this floor":`You're in ${esc(Y.wing)}, ${esc(floorName(Y.wing,OX.data.wings[Y.wing].floors[Y.floor],Y.floor))}`):"Where are you?"}</h3>
    ${OX.msg?`<div class="warnbox" style="font-size:12.5px;margin:4px 0 8px">${esc(OX.msg)}</div>`:""}
    ${Y?"":`<div class="muted">Type <b>/showlocation</b> in game and press <b>Use my /showlocation</b>, or click where you are on the plan.</div>`}
    ${onThis&&Y.manual?`<div class="muted" style="font-size:12px">Set by clicking. Click again to move it.</div>`:""}
    ${onThis&&Y.manual&&OX.reading&&OX.reading.site===OX.site&&OX.reading.t===S.live?.player?.t?`<button class="btn small" id="ox-lineup" style="margin:8px 0 2px">Line up here</button>
      <div class="muted" style="font-size:11.5px">Only if this is exactly where you took your last /showlocation: it corrects the moon's rotation so your next /showlocation lands on the plan.</div>`:""}
    <h3 style="margin-top:12px">Way out</h3>${busy?`<div class="muted">Working out the way…</div>`:""}<ol>${steps.map(t=>`<li>${esc(t)}</li>`).join("")}</ol>
    ${Y&&Y.wing===OX.wing&&!busy&&!sol?`<div class="warnbox" style="font-size:12px">Couldn't find a way out from that spot along the floor plans. The steps above are the general way; try clicking a little nearer a corridor.</div>`:""}
    ${sol&&!legHere.length&&Y.wing===OX.wing?`<div class="muted" style="font-size:12px">The route doesn't cross this floor.</div>`:""}
    ${sol?.steps.some(l=>l.ride==="gap")?`<div class="muted" style="font-size:12px">The plans don't show stairs between some of these floors, so part of the route is a best guess where the floors line up.</div>`:""}
    ${legHere.some(l=>l.rough>0.15)?`<div class="muted" style="font-size:12px">Part of the route on this floor crosses a gap in the plan (a doorway, a lift shaft or missing floor). Follow it loosely there.</div>`:""}
    ${F.objectives?.length?`<div style="color:#ffec78;margin-top:6px">${F.objectives.length} mission terminal${F.objectives.length>1?"s":""} on this floor.</div>`:""}
    ${F.supplies?.length?`<div style="color:#78c8ff;margin-top:6px">Supplies here: ${[...new Set(F.supplies.map(h=>h[3]))].join(", ")}.</div>`:""}
    ${F.locked?.length?`<div style="color:#c878ff;margin-top:6px">${F.locked.length} locked door${F.locked.length>1?"s":""}: needs an access chip.</div>`:""}
    ${F.sealed?.length?`<div style="color:#ff8a8a;margin-top:6px">${F.sealed.length} sealed door${F.sealed.length>1?"s":""}: no way through.</div>`:""}
    ${F.hazards?.length?`<div style="color:#ffb46b;margin-top:6px">${F.hazards.length} hazard${F.hazards.length>1?"s":""} on this floor (${[...new Set(F.hazards.map(h=>h[3]))].join(", ").toLowerCase()}).</div>`:""}
    ${F.loot?.length?`<div style="color:#9fe0b4;margin-top:6px">${F.loot.length} loot spawn${F.loot.length>1?"s":""} on this floor.</div>`:""}
    ${near?`<div style="color:#ff6b6b;margin-top:6px">${near} enemy spawn point${near>1?"s":""} within 45 m of you.</div>`:""}
    ${(F.spawns?.length||0)?`<div style="color:#ff8a8a;margin-top:6px">${(F.spawns?.length||0)} enemy spawn point${(F.spawns?.length||0)>1?"s":""} on this floor.</div>`:""}
    <h3 style="margin-top:14px">Key</h3><div class="lg">
      <i style="background:#7fe7ff;border-radius:50%"></i>You · the way out
      <i style="background:#57e39b"></i>Exit lift · hangar lift
      <i style="background:#4b8dff"></i>Other lifts
      <i style="background:#ff5a5a;border-radius:50%"></i>Enemy spawn
      <i style="background:#ffa03c;clip-path:polygon(50% 0,100% 100%,0 100%)"></i>Hazard: trip mine, electrical, explosive
      <i style="background:#7fe7a0;clip-path:polygon(50% 0,100% 50%,50% 100%,0 50%)"></i>Loot: medical, tools, hard drives
      <i style="background:#ffec78;clip-path:polygon(50% 0,61% 35%,98% 35%,68% 57%,79% 91%,50% 70%,21% 91%,32% 57%,2% 35%,39% 35%)"></i>Mission terminal
      <i style="background:#78c8ff;clip-path:polygon(35% 0,65% 0,65% 35%,100% 35%,100% 65%,65% 65%,65% 100%,35% 100%,35% 65%,0 65%,0 35%,35% 35%)"></i>Supplies: med bed, MedPens, lockers
      <i style="background:#c878ff"></i>Locked door: needs an access chip
      <i style="background:none;color:#ff5a5a;font-style:normal;font-weight:700;line-height:12px;text-align:center">✕</i>Sealed door: no way through
      <i style="background:#2ee6c8;clip-path:polygon(0 0,100% 0,50% 100%)"></i>Climb or drop between floors
      <i style="background:#b9a7ff;border-radius:2px"></i>Stairs
      <i style="background:#f2c14e;border-radius:50%"></i>Door
      <i style="background:rgba(38,120,210,.35);border:1px solid #96e1ff;box-shadow:0 0 6px #6fd0ff"></i>Floor and walls</div>
    <div class="muted" style="font-size:11.5px;margin-top:12px">From the game's own layout and models. Every Onyx Facility shares this interior. Drag to move, scroll to zoom.</div>`; }

async function lineUp(){ const Y=OX.you, R=OX.reading; if(!Y||!R) return;
  const r=await api().onyx_line_up(R.site,Y.x,Y.y,R.f[2]);
  if(!r.ok){ OX.msg=r.error||"Couldn't line up"; side(plan()); return; }
  await (window.poll?window.poll():null);
  OX.msg=null; toast(`${r.body} lined up: it was ${Math.round(r.metres)} m out here. Take a /showlocation to check`);
  if(!locate(true)) side(plan()); }
document.addEventListener("click",e=>{ if(e.target?.id==="ox-lineup") lineUp(); });

function modeUI(){ const d3=OX.mode==="3d", b=document.getElementById("ox-mode"), cv=document.getElementById("ox-cv"), gl=document.getElementById("ox-gl"), h=document.getElementById("ox-hint");
  if(b) b.textContent=d3?"Flat plan":"3D hologram"; if(cv) cv.style.display=d3?"none":"block"; if(gl) gl.style.display=d3?"block":"none";
  if(h) h.textContent=d3?"Drag to turn · right-drag to move · scroll to zoom · click your spot on the lit floor":""; }
function draw(){ if(OX.mode==="3d"&&window.THREE){ holoDraw(); return; }
  const cv=document.getElementById("ox-cv"); if(!cv||!OX.view||!OX.data) return;
  const dpr=window.devicePixelRatio||1, Wd=cv.clientWidth, Hd=cv.clientHeight; if(cv.width!==Wd*dpr||cv.height!==Hd*dpr){ cv.width=Wd*dpr; cv.height=Hd*dpr; }
  const x=cv.getContext("2d"); x.setTransform(dpr,0,0,dpr,0,0); x.clearRect(0,0,Wd,Hd);
  const V=OX.view, X=wx=>(wx-V.cx)*V.s+Wd/2, Y=wy=>(V.cy-wy)*V.s+Hd/2, art=OX.art, D=OX.data, W=D.wings[OX.wing], F=W.floors[OX.floor];
  // a faint 10 m grid, like the game's map table
  { const st=10*V.s; if(st>=8){ x.strokeStyle="rgba(90,170,255,.07)"; x.lineWidth=1; x.beginPath();
      for(let gx=((X(0)%st)+st)%st;gx<Wd;gx+=st){ x.moveTo(gx,0); x.lineTo(gx,Hd); }
      for(let gy=((Y(0)%st)+st)%st;gy<Hd;gy+=st){ x.moveTo(0,gy); x.lineTo(Wd,gy); } x.stroke(); } }
  if(art){ x.imageSmoothingEnabled=V.s<4;
    const dr=(c,G)=>x.drawImage(c.c,X(G.x0),Y(G.y1),c.w*G.cell*V.s,c.h*G.cell*V.s);
    dr(art.fill,F.fill);
    x.save(); x.globalCompositeOperation="lighter"; x.globalAlpha=.9; x.imageSmoothingEnabled=true; dr(art.glow,F.walls); x.restore();
    dr(art.walls,F.walls); }
  const dot=(p,r,c,stroke)=>{ x.beginPath(); x.arc(X(p[0]),Y(p[1]),r,0,7); x.fillStyle=c; x.fill(); if(stroke){ x.lineWidth=2; x.strokeStyle="#05080f"; x.stroke(); } };
  const lbl=(t,p,c,dy=-10)=>{ x.font="600 12px 'Inter',sans-serif"; x.fillStyle="rgba(5,8,15,.85)"; x.fillText(t,X(p[0])+9,Y(p[1])+dy+1); x.fillStyle=c; x.fillText(t,X(p[0])+8,Y(p[1])+dy); };
  for(const p of F.doors||[]) dot(p,Math.max(2,Math.min(4,V.s*0.5)),"#f2c14e");
  for(const r of F.rooms||[]) if(V.s>1.2){ const t=r.name.toUpperCase(); x.font="600 11px 'Inter',sans-serif"; x.save(); x.shadowColor="rgba(120,210,255,.9)"; x.shadowBlur=8;
    x.fillStyle="#cfefff"; x.fillText(t,X(r.at[0])-x.measureText(t).width/2,Y(r.at[1])); x.restore(); }
  for(const s of F.stops||[]){ const ex=OX.wing!=="Lobby"&&s.routes.some(isExit); x.fillStyle=ex?"#57e39b":"#4b8dff"; x.fillRect(X(s.at[0])-7,Y(s.at[1])-7,14,14);
    lbl(stopLabel(OX.wing,F,s),s.at,ex?"#57e39b":"#8cc4ff"); }
  for(const p of F.hangar_lifts||[]){ x.fillStyle="#57e39b"; x.fillRect(X(p[0])-7,Y(p[1])-7,14,14); lbl("Hangar lift",p,"#57e39b"); }
  // hazards (trip mines, electrical, explosive canisters): orange triangles; loot: green diamonds; enemy spawns: red
  for(const p of F.hazards||[]){ const a=X(p[0]),b=Y(p[1]); x.beginPath(); x.moveTo(a,b-6); x.lineTo(a+6,b+5); x.lineTo(a-6,b+5); x.closePath();
    x.fillStyle="#ffa03c"; x.fill(); x.lineWidth=1.5; x.strokeStyle="#05080f"; x.stroke(); }
  for(const p of F.loot||[]){ const a=X(p[0]),b=Y(p[1]); x.beginPath(); x.moveTo(a,b-6); x.lineTo(a+6,b); x.lineTo(a,b+6); x.lineTo(a-6,b); x.closePath();
    x.fillStyle="#7fe7a0"; x.fill(); x.lineWidth=1.5; x.strokeStyle="#05080f"; x.stroke(); }
  for(const p of F.spawns||[]){ dot(p,6,"#ff5a5a",true); }
  const hv=OX.hover; if(hv) lbl(hv.t,hv.p,hv.c,4);
  for(const L of W.links||[]) for(const e of L.ends) if(e[0]===OX.floor&&L.kind!=="exitlift"&&!L.dropped){
    if(L.kind==="stairs"){ x.fillStyle="#b9a7ff"; for(let k=0;k<3;k++) x.fillRect(X(e[1])-6,Y(e[2])-6+k*4.5,12,2.5); }
    else if(L.kind==="climb"){ const a=X(e[1]),b=Y(e[2]); x.beginPath(); x.moveTo(a-7,b-5); x.lineTo(a+7,b-5); x.lineTo(a,b+7); x.closePath(); x.fillStyle="#2ee6c8"; x.fill(); x.lineWidth=1.5; x.strokeStyle="#05080f"; x.stroke(); }
    else { x.fillStyle="#4b8dff"; x.fillRect(X(e[1])-5,Y(e[2])-5,10,10); } }
  const star=(p,r,c)=>{ const a=X(p[0]),b=Y(p[1]); x.beginPath(); for(let k=0;k<10;k++){ const rr=k%2?r*0.45:r, t=-Math.PI/2+k*Math.PI/5; x.lineTo(a+rr*Math.cos(t),b+rr*Math.sin(t)); } x.closePath(); x.fillStyle=c; x.fill(); x.lineWidth=1.5; x.strokeStyle="#05080f"; x.stroke(); };
  for(const p of F.objectives||[]) star(p,8,"#ffec78");
  for(const p of F.supplies||[]){ const a=X(p[0]),b=Y(p[1]); x.fillStyle="#78c8ff"; x.fillRect(a-2,b-6,4,12); x.fillRect(a-6,b-2,12,4); }
  for(const p of F.locked||[]){ x.fillStyle="#c878ff"; x.fillRect(X(p[0])-5,Y(p[1])-5,10,10); }
  for(const p of F.sealed||[]){ const a=X(p[0]),b=Y(p[1]); x.strokeStyle="#ff5a5a"; x.lineWidth=3; x.beginPath(); x.moveTo(a-6,b-6); x.lineTo(a+6,b+6); x.moveTo(a+6,b-6); x.lineTo(a-6,b+6); x.stroke(); }
  const sol=OX.sol?.r;
  if(sol) for(const l of sol.steps) if(l.walk&&l.f===OX.floor&&l.path.length>1){ x.save(); x.strokeStyle="#7fe7ff"; x.lineWidth=3.5; x.lineJoin=x.lineCap="round"; x.setLineDash([10,8]); x.lineDashOffset=-(performance.now()/40)%18;
    x.beginPath(); l.path.forEach((p,i)=>i?x.lineTo(X(p[0]),Y(p[1])):x.moveTo(X(p[0]),Y(p[1]))); x.stroke(); x.restore();
    const e=l.path[l.path.length-1]; if(!l.to.goal) lbl(l.to.kind==="stairs"?"Stairs":l.to.kind==="exitlift"?"Exit lift":l.to.kind==="gap"?"Way between floors (not in the plans)":l.to.kind==="climb"?"Climb / drop":"Lift",e,"#7fe7ff",14); }
  const Yu=OX.you; if(Yu&&Yu.wing===OX.wing&&Yu.floor===OX.floor){ const ph=(performance.now()/1400)%1;
    x.strokeStyle=`rgba(127,231,255,${.6*(1-ph)})`; x.lineWidth=2; x.beginPath(); x.arc(X(Yu.x),Y(Yu.y),8+ph*20,0,7); x.stroke();
    dot([Yu.x,Yu.y],7,"#7fe7ff",true); lbl("You",[Yu.x,Yu.y],"#7fe7ff"); } }
function anim(){ const v=document.getElementById("onyx-view"); if(!v?.classList.contains("show")){ OX.raf=0; return; } draw(); OX.raf=requestAnimationFrame(anim); }

// ---- the 3D hologram, after the game's own facility map: every storey of the wing stacked at its real height
// (stretched a little so they separate), walls standing up as glowing see-through curtains, the floor you're on lit
// and the others faint, room names on cards, and the route drawn through the storeys.
const HV=1;                       // heights at true scale (stretching them turned stairs into ladders)
const H={};                       // renderer, scene, camera state, per-wing scenes
function holoInit(){ if(H.r||!window.THREE) return !!H.r; const T=THREE, cv=document.getElementById("ox-gl");
  H.r=new T.WebGLRenderer({canvas:cv,antialias:true}); H.r.setClearColor(0x050b16,1);     // added light needs a solid backdrop
  H.scene=new T.Scene(); H.cam=new T.PerspectiveCamera(42,1,0.5,6000);
  H.orbit={yaw:-0.55,pitch:0.78,dist:260,tx:0,ty:0,tz:0,goal:null}; H.wings={}; H.dots={}; return true; }
const hY=(W,z)=>(z-W.floors[0].z)*HV;           // a height in the facility -> up in the scene
function texOf(c){ const t=new THREE.CanvasTexture(c); t.anisotropy=4; t.needsUpdate=true; return t; }
function plane(G,c,mat){ const T=THREE, w=c.w*G.cell, h=c.h*G.cell, m=new T.Mesh(new T.PlaneGeometry(w,h),mat);
  m.rotation.x=-Math.PI/2; m.position.set(G.x0+w/2,0,-(G.y1-h/2)); return m; }
async function holoWing(w){ if(H.wings[w]) return H.wings[w]; const T=THREE, W=OX.data.wings[w], g=new T.Group(), floors=[];
  for(let i=0;i<W.floors.length;i++){ const a=await floorArt(w,i), F=W.floors[i]; if(!a){ floors.push(null); continue; }
    const fg=new T.Group(); fg.position.y=hY(W,F.z);
    const add=(o,base)=>{ o.userData.base=base; o.material.transparent=true; o.material.depthWrite=false; o.material.blending=T.AdditiveBlending; o.material.side=T.DoubleSide; fg.add(o); return o; };
    const ft=texOf(a.fill.c), wt=texOf(a.walls.c), gt=texOf(a.glow.c);
    add(plane(F.fill,a.fill,new T.MeshBasicMaterial({map:ft,color:0x6fb8ff})),0.55);
    add(plane(F.walls,a.glow,new T.MeshBasicMaterial({map:gt,color:0x3aa8ff})),0.35);
    // the walls: the same outline repeated up to about 3 m, fading as it rises
    const L=7; for(let k=1;k<=L;k++){ const m=add(plane(F.walls,a.walls,new T.MeshBasicMaterial({map:wt,color:0x8fdcff})),0.75*(1-k/(L+1.5))); m.position.y=k*0.42*HV; }
    g.add(fg); floors.push(fg); }
  // climbs and drops (a broken lift shaft): a line straight down through the floors it joins
  for(const Lk of W.links||[]) if(Lk.kind==="climb"){ const [a,b]=Lk.ends, fa=floors[Math.min(a[0],b[0])]; if(!fa) continue;
    const top=W.floors[Math.min(a[0],b[0])].z, bot=W.floors[Math.max(a[0],b[0])].z, e=a[0]<b[0]?a:b;
    const geo=new T.BufferGeometry().setFromPoints([new T.Vector3(e[1],0.2,-e[2]),new T.Vector3(e[1],(bot-top)*HV+0.2,-e[2])]);
    const m=new T.Line(geo,new T.LineBasicMaterial({color:0x2ee6c8,transparent:true,depthWrite:false,blending:T.AdditiveBlending})); m.userData.base=0.8; fa.add(m); }
  return H.wings[w]={g,floors}; }
function dotTex(col,shape){ const k=col+shape; if(H.dots[k]) return H.dots[k]; const c=document.createElement("canvas"); c.width=c.height=64; const x=c.getContext("2d");
  x.shadowColor=col; x.shadowBlur=14; x.fillStyle=col; x.strokeStyle="rgba(4,8,16,.9)"; x.lineWidth=5; x.beginPath();
  if(shape==="sq") x.rect(18,18,28,28); else if(shape==="tri"){ x.moveTo(32,14); x.lineTo(52,48); x.lineTo(12,48); x.closePath(); }
  else if(shape==="dia"){ x.moveTo(32,12); x.lineTo(52,32); x.lineTo(32,52); x.lineTo(12,32); x.closePath(); } else if(shape==="x"){ x.lineWidth=8; x.strokeStyle=col; x.moveTo(16,16); x.lineTo(48,48); x.moveTo(48,16); x.lineTo(16,48); x.stroke(); return H.dots[k]=texOf(c); }
  else x.arc(32,32,14,0,7); x.stroke(); x.fill(); return H.dots[k]=texOf(c); }
function cardTex(text,col){ const c=document.createElement("canvas"), x=c.getContext("2d"), f="600 26px 'Inter',sans-serif"; x.font=f;
  const w=Math.ceil(x.measureText(text).width)+28; c.width=w; c.height=44; x.font=f;
  x.fillStyle="rgba(10,40,70,.55)"; x.strokeStyle=col; x.lineWidth=2; x.fillRect(1,1,w-2,42); x.strokeRect(1,1,w-2,42);
  x.shadowColor=col; x.shadowBlur=8; x.fillStyle="#e8f7ff"; x.textBaseline="middle"; x.fillText(text,14,23); return {t:texOf(c),w,h:44}; }
function sprite(tex,px,at,y){ const T=THREE, m=new T.Sprite(new T.SpriteMaterial({map:tex,depthTest:false,transparent:true,sizeAttenuation:false}));
  m.scale.set(px/900,px/900,1); m.position.set(at[0],y,-at[1]); m.renderOrder=5; return m; }
function card(text,at,y,col,row=0){ const c=cardTex(text,col), m=sprite(c.t,0,at,y); m.scale.set(c.w/1500,c.h/1500,1); m.center.set(0,-0.3-row*1.15); return m; }
// what's drawn on top: markers and names on the lit floor, the route through every floor
function holoMarks(){ const T=THREE, W=OX.data.wings[OX.wing], F=W.floors[OX.floor], g=new T.Group(), y0=hY(W,F.z)+0.3;
  const put=(L,col,shape,px=22)=>{ for(const p of L||[]) g.add(sprite(dotTex(col,shape),px,p,y0)); };
  put(F.doors,"#f2c14e","c",12); put(F.spawns,"#ff5a5a","c"); put(F.hazards,"#ffa03c","tri"); put(F.loot,"#7fe7a0","dia");
  put(F.objectives,"#ffec78","dia",26); put(F.supplies,"#78c8ff","sq",18); put(F.locked,"#c878ff","sq",18); put(F.sealed,"#ff5a5a","x",22);
  for(const L of W.links||[]) for(const e of L.ends) if(e[0]===OX.floor&&L.kind!=="exitlift"&&!L.dropped) g.add(sprite(dotTex(L.kind==="stairs"?"#b9a7ff":L.kind==="climb"?"#2ee6c8":"#4b8dff",L.kind==="climb"?"tri":"sq"),16,[e[1],e[2]],y0));
  for(const r of F.rooms||[]) g.add(card(r.name.toUpperCase(),r.at,y0+0.5,"#7fd0ff"));
  // lift cards stacked where lifts stand side by side (and above "YOU" if you're beside them)
  const placed=[]; const lift=(t,at,col)=>{ const k=placed.filter(p=>Math.hypot(p[0]-at[0],p[1]-at[1])<14).length; placed.push(at); g.add(card(t,at,y0+0.5,col,k)); };
  const Yy=OX.you; if(Yy&&Yy.wing===OX.wing&&Yy.floor===OX.floor) placed.push([Yy.x,Yy.y]);
  for(const s of F.stops||[]){ const ex=OX.wing!=="Lobby"&&s.routes.some(isExit); g.add(sprite(dotTex(ex?"#57e39b":"#4b8dff","sq"),24,s.at,y0)); lift(stopLabel(OX.wing,F,s),s.at,ex?"#57e39b":"#4b8dff"); }
  for(const p of F.hangar_lifts||[]){ g.add(sprite(dotTex("#57e39b","sq"),24,p,y0)); lift("HANGAR LIFT",p,"#57e39b"); }
  // the route: a line for each walk on its floor, and a straight drop or climb where it changes floors
  const sol=OX.sol?.r; if(sol){ const line=(pts,col,op)=>{ if(pts.length<2) return; const ln=new T.Line(new T.BufferGeometry().setFromPoints(pts),
        new T.LineBasicMaterial({color:col,transparent:true,opacity:op,depthTest:false})); ln.renderOrder=6; g.add(ln); };
    let last=null, above=false;
    for(let i=0;i<sol.steps.length;i++){ const l=sol.steps[i];
      if(!l.walk){ if(l.f<OX.floor&&last&&!above){ above=true;          // up to a floor above this one: a stub and a note
          line([last,new T.Vector3(last.x,last.y+4*HV,last.z)],0x57e39b,1);
          g.add(card((l.ride==="exitlift"?"EXIT LIFT UP TO ":l.ride==="climb"?"CLIMB UP TO ":"UP TO ")+floorName(OX.wing,W.floors[l.f],l.f),[last.x,-last.z],last.y+4*HV,"#57e39b")); }
        continue; }
      if(above||l.f<OX.floor) continue;                                  // floors above the lit one stay out of the way
      const y=hY(W,W.floors[l.f].z)+0.5, pts=l.path.map(p=>new T.Vector3(p[0],y,-p[1]));
      if(last&&pts.length) line([last,new T.Vector3(last.x,y,last.z),pts[0]],0x2ee6c8,0.9);
      line(pts,l.f===OX.floor?0xd8fbff:0x8fd8ff,l.f===OX.floor?1:0.55); last=pts[pts.length-1]||last; } }
  const Y=OX.you; if(Y&&Y.wing===OX.wing){ H.you=sprite(dotTex("#7fe7ff","c"),30,[Y.x,Y.y],hY(W,W.floors[Y.floor].z)+0.6); g.add(H.you); g.add(card("YOU",[Y.x,Y.y],hY(W,W.floors[Y.floor].z)+0.4*HV,"#7fe7ff")); }
  else H.you=null;
  return g; }
async function holoDraw(){ if(!OX.data||!holoInit()) return; const T=THREE, cv=document.getElementById("ox-gl"), W=OX.data.wings[OX.wing];
  const Wd=cv.clientWidth, Hd=cv.clientHeight; if(!Wd||!Hd) return;
  if(H.size!==Wd+"x"+Hd){ H.size=Wd+"x"+Hd; H.r.setPixelRatio(window.devicePixelRatio||1); H.r.setSize(Wd,Hd,false); H.cam.aspect=Wd/Hd; H.cam.updateProjectionMatrix(); }
  if(H.wing!==OX.wing){ if(H.busy) return; const w=OX.wing; H.busy=true; let hw;
    try{ hw=await holoWing(w); } finally{ H.busy=false; }
    if(w!==OX.wing) return;                      // switched wings while this one was being built: next frame
    if(H.g) H.scene.remove(H.g); H.g=hw.g; H.scene.add(H.g); H.wing=w; H.key=null;
    const b=W.box; H.orbit.tx=(b[0]+b[2])/2; H.orbit.tz=-(b[1]+b[3])/2; H.orbit.dist=Math.max(b[2]-b[0],b[3]-b[1])*1.15;
    if(H.focus){ H.orbit.tx=H.focus[0]; H.orbit.tz=-H.focus[1]; H.orbit.dist=Math.min(H.orbit.dist,140); H.focus=null; } }
  const hw=H.wings[OX.wing]; if(!hw) return;
  // the lit floor full strength, the ones above it nearly gone (so they don't hide it), the ones below faint
  hw.floors.forEach((fg,i)=>{ if(!fg) return; const k=i===OX.floor?1:i<OX.floor?0.05:0.16; fg.children.forEach(o=>o.material.opacity=o.userData.base*k); });
  const key=[OX.wing,OX.floor,youKey(),OX.sol?.key||"",!!OX.sol?.r].join("|");
  if(H.key!==key){ H.key=key; if(H.m) H.scene.remove(H.m); H.m=holoMarks(); H.scene.add(H.m); H.orbit.goal=hY(W,W.floors[OX.floor].z); }
  const o=H.orbit; if(o.goal!=null){ o.ty+=(o.goal-o.ty)*0.15; if(Math.abs(o.goal-o.ty)<0.05){ o.ty=o.goal; o.goal=null; } }
  const cp=Math.cos(o.pitch); H.cam.position.set(o.tx+o.dist*cp*Math.sin(o.yaw),o.ty+o.dist*Math.sin(o.pitch),o.tz+o.dist*cp*Math.cos(o.yaw)); H.cam.lookAt(o.tx,o.ty,o.tz);
  if(H.you){ const s=(30+10*Math.sin(performance.now()/300))/900; H.you.scale.set(s,s,1); }
  H.r.render(H.scene,H.cam); }
function holoInput(cv){ let d=null;
  cv.addEventListener("contextmenu",e=>e.preventDefault());
  cv.addEventListener("mousedown",e=>{ d={x:e.clientX,y:e.clientY,b:e.button,moved:false}; });
  window.addEventListener("mousemove",e=>{ if(!d||!H.orbit) return; const dx=e.clientX-d.x, dy=e.clientY-d.y; if(Math.hypot(dx,dy)>4) d.moved=true; d.x=e.clientX; d.y=e.clientY; const o=H.orbit;
    if(d.b===2||e.shiftKey){ const k=o.dist/700, s=Math.sin(o.yaw), c=Math.cos(o.yaw);   // move the view over the floor
      o.tx+=(-dx*c-dy*s)*k; o.tz+=(dx*s-dy*c)*k; }
    else { o.yaw-=dx*0.006; o.pitch=Math.max(0.12,Math.min(1.5,o.pitch+dy*0.005)); } });
  window.addEventListener("mouseup",e=>{ if(!d) return; const was=d; d=null; if(was.moved||was.b!==0||e.target!==cv||!H.cam) return;
    // a click: where it meets the lit floor is your spot
    const r=cv.getBoundingClientRect(), T=THREE, ray=new T.Raycaster(), W=OX.data.wings[OX.wing];
    ray.setFromCamera(new T.Vector2(((e.clientX-r.left)/r.width)*2-1,-((e.clientY-r.top)/r.height)*2+1),H.cam);
    const hit=new T.Vector3(); if(!ray.ray.intersectPlane(new T.Plane(new T.Vector3(0,1,0),-hY(W,W.floors[OX.floor].z)),hit)) return;
    OX.msg=null; OX.you={x:hit.x,y:-hit.z,wing:OX.wing,floor:OX.floor,manual:true,site:OX.site}; route(); });
  cv.addEventListener("wheel",e=>{ e.preventDefault(); if(H.orbit) H.orbit.dist=Math.max(20,Math.min(2500,H.orbit.dist*(e.deltaY<0?1/1.15:1.15))); },{passive:false}); }

// Your last /showlocation, if it's inside a facility: wing, storey and spot
function locate(say){ const pl=S.live?.player, hit=siteAt(pl);
  const tell=m=>{ if(say){ OX.msg=m; side(plan()); } return false; };
  if(!pl?.local) return tell("Quantum doesn't have a /showlocation yet. Press your /showlocation key (F10) or type /showlocation in game chat, then press this again.");
  if(!Object.keys(sites()).length) return tell("This copy of Quantum doesn't have the facilities' positions on their moons yet (game_bodies.json from build_game_planet.py --onyx), so it can't place you. Click where you are on the plan instead.");
  if(!hit){ let near=null; for(const [n,s] of Object.entries(sites())){ if(s.body!==pl.body) continue; const f=toFacility(s,pl.local), h=Math.hypot(f[0],f[1]); if(!near||h<near.h) near={n,h}; }
    return tell(near?`Your last /showlocation is ${(near.h/1000).toFixed(1)} km from the nearest Onyx Facility (${near.n}), so it's not inside one.`:`Your last /showlocation is on ${pl.body}, which has no Onyx Facilities.`); }
  OX.reading={site:hit.name,f:hit.f,t:pl.t};
  const at=placeIn(hit.f);
  if(!at) return tell(hit.f[2]>-150?`You're at ${hit.name}, up at the surface (hangar or outside). The plans start at the lobby.`
    :`You're inside ${hit.name}, ${Math.round(-hit.f[2])} m down, but your /showlocation lands off the plans: ${pl.body}'s rotation in Quantum is probably a little off. Pick your wing and floor, click exactly where you're standing, then press "Line up here".`);
  OX.msg=null; OX.site=hit.name; OX.you={x:hit.f[0],y:hit.f[1],wing:at.wing,floor:at.floor,t:pl.t,site:hit.name};
  OX.wing=at.wing; OX.floor=at.floor; fit(); OX.view.cx=hit.f[0]; OX.view.cy=hit.f[1]; OX.view.s=Math.max(OX.view.s,3);
  if(H.orbit){ H.wing=null; H.focus=[hit.f[0],hit.f[1]]; } show(); return true; }

// Open the plans: for a facility (from its map entry), or wherever your /showlocation puts you
window.openOnyx=async function(name){ const v=el();
  const D=await load(); if(!D){ toast("Couldn't load the Onyx floor plans. Check your connection and try again"); return; }
  v.classList.add("show"); OX.site=name||S.live?.onyx_here||OX.site; OX.msg=null;
  if(!locate(false)){ if(OX.you&&OX.you.site!==OX.site) OX.you=null;
    OX.wing=OX.wing||"Lobby"; OX.floor=OX.floor||0; fit(); show(); } };
// Every poll: a new /showlocation inside a facility opens its plans (once per reading), and moves you on it
window.onyxTick=function(){ const pl=S.live?.player; if(!pl||!pl.t||pl.t===OX.auto) return;
  const hit=siteAt(pl); if(!hit||hit.f[2]>-150) return; OX.auto=pl.t;
  const open=document.getElementById("onyx-view")?.classList.contains("show");
  if(open) locate(false); else if(S.onyxAutoOpen!==false) window.openOnyx(hit.name); };
})();
