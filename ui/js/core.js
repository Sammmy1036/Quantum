// Quantum UI: Constants, the shared state S, small helpers (api(), qFetch) and math.
// One of several classic scripts sharing one global scope; index.html loads them in order.
"use strict";
// =================================================================== constants
const TYPES = {
  city:{label:"Cities",one:"City",color:"#eef3fb",def:true}, station:{label:"Stations",one:"Station",color:"#f2c14e",def:true},
  outpost:{label:"Outposts",one:"Outpost",color:"#7fd18b",def:true}, cave:{label:"Caves",one:"Cave",color:"#c9a27a",def:false},
  wreck:{label:"Wrecks",one:"Wreck",color:"#b98cf0",def:false}, field:{label:"Mining & clouds",one:"Mining area",color:"#8fb3d9",def:false},
  comm:{label:"Comm arrays",one:"Comm array",color:"#7fc6d9",def:false}, jump:{label:"Gateways",one:"Gateway (jump point)",color:"#c9a7ff",def:true},
  poi:{label:"Other",one:"Point of interest",color:"#a9b6cc",def:false}, om:{label:"Orbital markers",one:"Orbital marker",color:"#9db3dc",def:false},
  lpoint:{label:"Lagrange points",one:"Lagrange point",color:"#7684a0",def:true},
};
const PADS = ["unknown","none","vehicle","small","medium","large","xl","hangar"];
const BODY_HSL = { Hurston:[32,38,46], ArcCorp:[14,52,48], microTech:[200,30,72], Crusader:[205,32,62], Arial:[20,45,45],
  Aberdeen:[45,40,48], Magda:[195,12,58], Ita:[40,18,52], Cellin:[48,12,55], Daymar:[30,40,52], Yela:[200,20,78], Calliope:[210,15,70],
  Clio:[190,22,76], Euterpe:[205,18,80], Lyria:[215,20,68], Wala:[25,25,50], Delamar:[25,12,42], Pyro1:[18,40,42], Monox:[35,12,52],
  Bloom:[95,22,44], Pyro4:[12,38,40], Pyro5:[24,45,55], Terminus:[205,14,62], Ignis:[12,55,45], Vatra:[28,25,50], Adir:[200,10,62],
  Fairo:[40,30,55], Fuego:[8,55,45], Vuur:[4,45,40], Stanton:[45,100,70], Pyrostar:[18,100,62] };
const GAS = new Set(["Crusader","Pyro5"]);
const ICY = new Set(["microTech","Yela","Clio","Euterpe","Calliope","Lyria","Terminus","Adir"]);

// =================================================================== state
const S = {
  bodies:[], bodyMap:{}, locs:[], locMap:{}, systems:["Stanton","Pyro","Nyx"], staticVersion:0, live:null,
  system:"Stanton", routeKey:"", contractsVersion:-1, wpKey:"",
  layers:Object.fromEntries(Object.entries(TYPES).map(([k,v])=>[k,v.def])),
  show:{missions:true, waypoints:true, orbits:true, grid:(()=>{ try{ return localStorage.getItem("q-grid")==="1"; }catch{ return false; } })(), rings:(()=>{ try{ return localStorage.getItem("q-rings")!=="0"; }catch{ return true; } })(), sky:(()=>{ try{ return localStorage.getItem("q-sky")!=="0"; }catch{ return true; } })()},
  cam:{target:[0,0,0], dist:1e11, yaw:-1.2, pitch:0.9, lock:null}, focus:{kind:"system"}, anim:null,
  selected:null, picks:[], search:"", typeFilter:null, tab:"route", editing:null, autoSystem:true,
};
const $ = id => document.getElementById(id);
const api = () => window.pywebview.api;
// A mouse button held (or just pressed): the timed redraws wait, so the button you're clicking isn't replaced mid-click
addEventListener("pointerdown",()=>{ S.ptrDown=true; S.ptrAt=Date.now(); },true);
addEventListener("pointerup",()=>{ S.ptrDown=false; S.ptrAt=Date.now(); },true);
addEventListener("pointercancel",()=>{ S.ptrDown=false; },true);
// ---- Asking the app for something and keeping the answer a while (qFetch)
// Only a good answer is kept: one that failed ({ok:false}, null, or an error) is asked for again next time instead
// of standing in for the real thing. The same question already on its way is shared rather than asked twice.
// force: ask again now. ttl: how long a good answer is kept (ms). ok: what counts as a good answer.
const QC={val:{},busy:{}};
function qFetch(key,fn,{ttl=60000,force=false,ok=v=>v!=null&&v.ok!==false}={}){
  const c=QC.val[key];
  if(!force&&c&&Date.now()-c.at<ttl) return Promise.resolve(c.v);
  if(QC.busy[key]&&!force) return QC.busy[key];
  const p=Promise.resolve().then(fn).then(v=>{ if(ok(v)) QC.val[key]={v,at:Date.now()}; else delete QC.val[key]; return v; })
    .finally(()=>{ if(QC.busy[key]===p) delete QC.busy[key]; });
  return QC.busy[key]=p; }
// Throw away kept answers (all of them with no keys): after signing out, a new key, a withdrawn report...
function qForget(...keys){ if(!keys.length){ QC.val={}; return; } keys.forEach(k=>{ delete QC.val[k]; }); }
// Your datarunner profile and trust status, kept in S for drawing
function drProfLoad(force){ return qFetch("drProf",()=>api().dr_profile(false),{ttl:60000,force})
  .then(p=>{ if(p?.ok){ S.drProf=p; S.drProfAt=Date.now(); } return p; }); }
function drTrustLoad(force){ return qFetch("drTrust",()=>api().trust_status(),{ttl:120000,force})
  .then(x=>{ if(x&&(x.ok||!S.drTrust?.ok)) S.drTrust=x; return x; }); }
// 3D cities: each one is its own optional file in ui/ (city3d-NewBabbage.js, ...) that registers itself here.
// A missing file just means no 3D for that city; nothing else depends on them.
const CITIES3D=[];
window.registerCity3D=c=>{ if(c&&!CITIES3D.includes(c)) CITIES3D.push(c); };
const city3dDown=()=>CITIES3D.some(c=>c.active);                    // down in one of them, at ground level
const city3dInCity=()=>CITIES3D.some(c=>c.inCity);                  // in a 3D city itself (not just a planet's terrain)
const city3dFor=name=>CITIES3D.find(c=>c.has(name))||null;
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const now = () => Date.now()/1000;
// The time the view was last drawn for: the clock plus the 3D city's time-of-day preview. Anything that turns
// the camera's target (where it was drawn) back into a spot on a planet must use this same time: with the live
// clock instead, a preview hours away turned the spot half-way round the planet (a click in Lorville while
// previewing the morning flew to the far side of Hurston), and even a slow frame moved it a few km.
const viewT = () => S.frameT ?? (now()+(S.timeShift||0));

// =================================================================== math
function fmtDist(m){
  if(m==null||!isFinite(m)) return "–"; const a=Math.abs(m);
  if(a<1e3) return `${m.toFixed(0)} m`; if(a<1e6) return `${(m/1e3).toFixed(a<1e4?2:1)} km`;
  if(a<1e9) return `${(m/1e6).toFixed(2)} Mm`; return `${(m/1e9).toFixed(3)} Gm`;
}
function bodyAngle(b,t){ let d=b.offset; if(b.period>0) d+=360*((t-b.epoch)/3600)/b.period; return ((d%360)+360)%360*Math.PI/180; }
function toGlobal(b,p,t){ const a=bodyAngle(b,t),c=Math.cos(a),s=Math.sin(a); return [b.center[0]+p[0]*c-p[1]*s, b.center[1]+p[0]*s+p[1]*c, b.center[2]+p[2]]; }
function toLocal(b,g,t){ const a=-bodyAngle(b,t),c=Math.cos(a),s=Math.sin(a),x=g[0]-b.center[0],y=g[1]-b.center[1]; return [x*c-y*s,x*s+y*c,g[2]-b.center[2]]; }
function globalPos(L,t){ if(!L.pos) return null; if(L.kind==="surface"){ const b=S.bodyMap[L.body]; if(b) return toGlobal(b,L.pos,t); } return L.pos; }
// Local solar time at a place on a planet or moon, from the same rotation the map uses: noon when the
// system's star is due overhead, a 24-hour clock per rotation (so "2 PM" means the same sun angle on
// every planet; the real minutes differ with each one's day length). Bodies spin about their z axis;
// Stanton's star sits ~12° off that plane, so sunrise and sunset shift with latitude like on Earth.
// Only as good as the planet's rotation alignment (community offset, or yours once calibrated).
function localTime(L,t){
  if(!L||L.kind!=="surface"||!L.pos) return null; const b=S.bodyMap[L.body]; if(!b||!(b.period>0)) return null;
  const star=S.bodies.find(x=>x.system===b.system&&x.kind==="star"); if(!star) return null;
  const g=globalPos(L,t), n=[g[0]-b.center[0],g[1]-b.center[1],g[2]-b.center[2]], s=[star.center[0]-b.center[0],star.center[1]-b.center[1],star.center[2]-b.center[2]];
  if(Math.hypot(n[0],n[1])<Math.hypot(...n)*0.02) return null;                // at a pole the clock means nothing
  let h=12+(Math.atan2(n[1],n[0])-Math.atan2(s[1],s[0]))/(2*Math.PI)*24; h=((h%24)+24)%24;
  const lat=Math.asin(n[2]/Math.hypot(...n)), dec=Math.asin(s[2]/Math.hypot(...s));
  const c=-Math.tan(lat)*Math.tan(dec), half=c>=1?0:c<=-1?12:Math.acos(c)*12/Math.PI;   // hours from noon to sunset
  const rise=12-half, set=12+half, day=half>=12||(h>=rise&&h<set);
  const next=half<=0||half>=12?null:day?set-h:(h<rise?rise-h:24-h+rise);       // local hours to sunset / sunrise
  return {h, day, polar:half<=0?"night":half>=12?"day":null, mins:next==null?null:next/24*b.period*60,
    period:b.period, calibrated:!!b.calibrated}; }
function fmtClock(h){ let m=Math.floor(h*60)%1440; const hh=Math.floor(m/60), mm=m%60;      // to the minute
  return `${(hh%12)||12}:${String(mm).padStart(2,"0")} ${hh<12?"AM":"PM"}`; }
const ltChip=lt=>`${lt.day?"☀":"☾"} ${fmtClock(lt.h)}`;
const ltRow=lt=>`≈ <b>${fmtClock(lt.h)}</b> <span class="muted">· ${lt.polar?(lt.polar==="day"?"sun never sets here":"sun never rises here"):`${lt.day?"sunset":"sunrise"} in ~${fmtMins(lt.mins)}`}</span>`;
// The card's clock ticks on its own, every second, whatever has focus. (The whole card is only redrawn
// every 2 s, and not while you're using something in it, so the time used to freeze after a click there.)
setInterval(()=>{ const sel=S.selected; if(sel?.kind!=="loc") return; const L=S.locMap[sel.name];
  const c=document.querySelector("#detail [data-lt-chip]"), r=document.querySelector("#detail [data-lt-row]"); if(!L||(!c&&!r)) return;
  const lt=localTime(L,now()); if(!lt) return;
  if(c){ const v=ltChip(lt); if(c.textContent!==v) c.textContent=v; }
  if(r){ const v=ltRow(lt); if(r.innerHTML!==v) r.innerHTML=v; } },1000);
function fmtMins(m){ m=Math.max(1,Math.round(m)); return m<60?`${m} min`:`${Math.floor(m/60)} h ${String(m%60).padStart(2,"0")} min`; }
function latLon(p){ const r=Math.hypot(p[0],p[1],p[2])||1e-9; return {lat:Math.asin(Math.max(-1,Math.min(1,p[2]/r)))*180/Math.PI, lon:-Math.atan2(p[0],p[1])*180/Math.PI}; }
const d3 = (a,b) => Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
function slerpLocal(a,b,f,R){ // great-circle point between two body-local vectors, at radius R
  const la=Math.hypot(...a), lb=Math.hypot(...b); const ua=a.map(v=>v/la), ub=b.map(v=>v/lb);
  const dot=Math.max(-1,Math.min(1,ua[0]*ub[0]+ua[1]*ub[1]+ua[2]*ub[2])), om=Math.acos(dot);
  let p; if(om<1e-6) p=ua; else { const s=Math.sin(om), k1=Math.sin((1-f)*om)/s, k2=Math.sin(f*om)/s; p=[ua[0]*k1+ub[0]*k2, ua[1]*k1+ub[1]*k2, ua[2]*k1+ub[2]*k2]; }
  return p.map(v=>v*R);
}
