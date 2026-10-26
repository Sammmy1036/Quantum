"use strict";
// =================================================================== real stations  (ui/stations3d.js)
// The game's own station models, from ui/stations/<Station>.js (tools/build_stations.py): every exterior
// piece where the game places it, coloured from the game's materials, its windows and lit signs glowing,
// and a point of light at each of the game's own light fixtures. They're downloaded (from the Quantum
// server, like the cities) as you get close, and take over from the map's stand-in model once the station
// is big enough on screen to show its shape. A station without a file keeps its stand-in.
//
// The map calls Stations3D.show(o, v, d, t, f) for each station every frame (o: the map's station object,
// v: its position relative to the floating origin, d: the camera's distance, t: the time, f: the focal
// length in pixels). It returns true when the real model is drawn instead of the stand-in.
(()=>{
if(typeof THREE==="undefined") return;
const LOAD_KM=20000, MIN_PX=48;                // start downloading within this (or when the station is selected); at least
                                               // this many pixels across: further off, the model is drawn scaled up (as
                                               // the map's stand-in is), so the real station shows from any distance
const R={};
// Why a station's model didn't show (once per station, into Settings > Log): no file listed for it on the
// server, a download that failed, or a file with nothing to draw
const told=new Set();
function note(name,msg){ if(told.has(name+msg)) return; told.add(name+msg); try{ api().js_error("stations3d",`${name}: ${msg}`); }catch(_){} }                                    // station name -> {state, group, meta, span}
let index=null, indexP=null;
// The index is keyed by the game's own names, which aren't always Quantum's: "Checkmate" is Checkmate Station,
// "Stanton Gateway" (in Pyro) is Stanton Gateway Station (Pyro). Every name is also filed under a plain key
// (no case, spaces, punctuation or trailing "Station"), and a lookup tries Quantum's name, then that key.
const plain=n=>String(n||"").toLowerCase().replace(/\s*\((stanton|pyro|nyx)\)\s*$/,"").replace(/\bstation\b/g,"").replace(/[^a-z0-9]+/g,"");
const getIndex=()=>indexP||(indexP=addScript("stations/index.js").then(()=>{
  const L=Array.isArray(window.QSTATION_INDEX)?window.QSTATION_INDEX:[];
  index=new Map(L.map(e=>[e.station,e]));
  for(const e of L){ const k=`${(e.system||"").toLowerCase()}|${plain(e.station)}`; if(!index.has(k)) index.set(k,e);
    const k2=`|${plain(e.station)}`; if(!index.has(k2)) index.set(k2,e); } }).catch(()=>{ index=new Map(); }));
// Pyro's game files are turned 85.23° from the game's own frame (gateways.py has the measurement): a station
// placed in Pyro's system frame is turned the same way unless its file says it already is (ingame:true).
const SYS_TURN={pyro:-85.22993*Math.PI/180};
function entry(L){ if(!index) return null;
  return index.get(L.name)||index.get(`${(L.system||"").toLowerCase()}|${plain(L.name)}`)
    ||(!L.system?index.get(`|${plain(L.name)}`):null)||null; }
const bytes=s=>{ const b=atob(s), u=new Uint8Array(b.length); for(let i=0;i<b.length;i++) u[i]=b.charCodeAt(i); return u; };
const LIN=k=>{ const c=k/255; return c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4; };
const GLASS_C=[0.075,0.095,0.125], WIN_C=[1.0,0.82,0.6];
// The map's ambient light is blue (it keeps planets' night sides readable). A station's shaded side, lit by
// that alone, came out blue: all of Grim HEX, which sits in the shadow of its own asteroid. Station models
// take the same amount of ambient light, but grey.
const greyAmbient=sh=>{ sh.fragmentShader=sh.fragmentShader.replace("#include <lights_fragment_begin>",
  THREE.ShaderChunk.lights_fragment_begin.replace("getAmbientLightIrradiance( ambientLightColor )",
    "getAmbientLightIrradiance( vec3( dot( ambientLightColor, vec3( 0.2126, 0.7152, 0.0722 ) ) ) )")); };
// Parts that lie on one another (trim on a wall, a panel on a hull: the game draws one over the other) fight over
// which shows, and flicker as the camera moves (Grim HEX). Smaller models are drawn a hair nearer the camera
// than bigger ones (0.006% of the distance per size step: 2.4 cm at 400 m), so the smaller one, the trim, always
// wins; lit strips, signs and windows a bit more again (0.05%). Moved straight towards the camera, nothing
// shifts on screen.
const nudge=(f,key)=>sh=>{ sh.vertexShader=sh.vertexShader.replace("#include <project_vertex>",
  `#include <project_vertex>\n gl_Position = projectionMatrix * vec4(mvPosition.xyz * ${f.toFixed(6)}, 1.0);`); };
const STEP=0.00006, MATS=[];
// (barely metallic: there's nothing round a station for metal to reflect, so a metallic finish just reads as dark grey)
function mats(b){ if(MATS[b]) return MATS[b];
  const solid=new THREE.MeshStandardMaterial({vertexColors:true,roughness:0.7,metalness:0.08,side:THREE.DoubleSide}),
    glow=new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.DoubleSide,toneMapped:false}), fs=1-b*STEP, fg=fs*0.9995;
  solid.onBeforeCompile=sh=>{ greyAmbient(sh); if(b) nudge(fs)(sh); }; solid.customProgramCacheKey=()=>`station-solid-${b}`;
  glow.onBeforeCompile=nudge(fg); glow.customProgramCacheKey=()=>`station-glow-${b}`;
  return MATS[b]=[solid,glow]; }
// size step: 0 for the biggest pieces (hulls, rock), up to 3 for the small ones (trim, fittings)
const sizeStep=m=>{ const s=Math.max(...m.hi.map((v,i)=>v-m.lo[i])); return s>=150?0:s>=30?1:s>=5?2:3; };
const dotTex=(()=>{ const c=document.createElement("canvas"); c.width=c.height=32; const g=c.getContext("2d"), gr=g.createRadialGradient(16,16,0,16,16,16);
  gr.addColorStop(0,"rgba(255,255,255,1)"); gr.addColorStop(0.25,"rgba(255,255,255,0.6)"); gr.addColorStop(1,"rgba(255,255,255,0)");
  g.fillStyle=gr; g.fillRect(0,0,32,32); const t=new THREE.CanvasTexture(c); return t; })();

// One of the game's models: solid faces first, then the faces its materials make glow (windows, signs,
// light strips), as two groups drawn with the two materials.
function geometry(m){
  const q=new Int16Array(bytes(m.v).buffer), iu=bytes(m.i), idx=m.i32?new Uint32Array(iu.buffer):new Uint16Array(iu.buffer);
  const c=m.lo.map((v,i)=>(v+m.hi[i])/2), h=m.lo.map((v,i)=>(m.hi[i]-v)/2), nt=Math.floor(idx.length/3);
  const look=new Uint8Array(nt), col=new Array(nt), runs=m.parts||[[0,nt,150,155,160,0]];
  for(const [a,n,r,g,b,lk] of runs) for(let t=a;t<Math.min(nt,a+n);t++){ look[t]=lk;
    col[t]=lk===3?GLASS_C:lk===1?WIN_C.map((w,i)=>w*0.55+[LIN(r),LIN(g),LIN(b)][i]*0.45):[LIN(r),LIN(g),LIN(b)]; }
  const order=[...Array(nt).keys()].sort((x,y)=>(look[x]===1||look[x]===2)-(look[y]===1||look[y]===2));
  const nSolid=order.findIndex(t=>look[t]===1||look[t]===2), ns=nSolid<0?nt:nSolid;
  const pos=new Float32Array(nt*9), cc=new Float32Array(nt*9);
  order.forEach((t,j)=>{ for(let k=0;k<3;k++){ const w=idx[t*3+k];
    pos.set([c[0]+q[w*3]/32767*h[0], c[1]+q[w*3+1]/32767*h[1], c[2]+q[w*3+2]/32767*h[2]],j*9+k*3); cc.set(col[t],j*9+k*3); } });
  const g=new THREE.BufferGeometry(); g.setAttribute("position",new THREE.BufferAttribute(pos,3)); g.setAttribute("color",new THREE.BufferAttribute(cc,3));
  g.computeVertexNormals(); g.addGroup(0,ns*3,0); if(ns<nt) g.addGroup(ns*3,(nt-ns)*3,1); return g; }

// A rough rock: a sphere pushed in and out by a fixed noise, flat-shaded (made once, shared by every rock)
const ROCK_MAT=new THREE.MeshStandardMaterial({color:0x3b3733,roughness:0.95,metalness:0,flatShading:true});
ROCK_MAT.onBeforeCompile=greyAmbient; ROCK_MAT.customProgramCacheKey=()=>"station-rock";
let ROCK_GEO=null;
function rockGeo(){ if(ROCK_GEO) return ROCK_GEO;
  const g=new THREE.IcosahedronGeometry(1,4), p=g.attributes.position, v=new THREE.Vector3();
  const n=(x,y,z)=>Math.sin(x*3.1+y*1.7)*0.5+Math.sin(y*4.3+z*2.9)*0.3+Math.sin(z*7.7+x*5.3)*0.2;
  for(let i=0;i<p.count;i++){ v.fromBufferAttribute(p,i); const k=1+0.18*n(v.x,v.y,v.z)+0.06*n(v.x*3,v.y*3,v.z*3); v.multiplyScalar(k); p.setXYZ(i,v.x,v.y,v.z); }
  g.computeVertexNormals(); return ROCK_GEO=g; }

// Built a few pieces per frame (about 6 ms at a time), so a big station arriving mid-flight doesn't stall it
const yieldFrame=()=>new Promise(r=>requestAnimationFrame(()=>r()));
async function build(name){
  const T=window.QSTATION?.[name]; if(!T?.inst) return null;
  const IN=new Float32Array(bytes(T.inst).buffer), NI=IN.length/13, group=new THREE.Group(), byMesh=new Map();
  for(let i=0;i<NI;i++){ const k=IN[i*13]; if(!byMesh.has(k)) byMesh.set(k,[]); byMesh.get(k).push(i); }
  const M=new THREE.Matrix4(); let lo=[1e9,1e9,1e9], hi=[-1e9,-1e9,-1e9], t0=performance.now();
  for(const [k,list] of byMesh){ const m=T.meshes[k]; if(!m) continue;
    if(performance.now()-t0>6){ await yieldFrame(); t0=performance.now(); }
    const im=new THREE.InstancedMesh(geometry(m),mats(sizeStep(m)),list.length); let n=0;
    for(const i of list){ const o=i*13+1;
      M.set(IN[o],IN[o+1],IN[o+2],IN[o+3], IN[o+4],IN[o+5],IN[o+6],IN[o+7], IN[o+8],IN[o+9],IN[o+10],IN[o+11], 0,0,0,1);
      im.setMatrixAt(n++,M); for(let a=0;a<3;a++){ lo[a]=Math.min(lo[a],IN[o+3+a*4]); hi[a]=Math.max(hi[a],IN[o+3+a*4]); } }
    im.frustumCulled=false; group.add(im); }
  if(T.lights){ const f=new Float32Array(bytes(T.lights).buffer), n=Math.floor(f.length/8), p=new Float32Array(n*3), c=new Float32Array(n*3);
    for(let i=0;i<n;i++){ const o=i*8, k=Math.min(1.6,Math.sqrt(Math.max(0,f[o+6])*Math.min(Math.max(f[o+7],1),60))/30);
      p.set([f[o],f[o+1],f[o+2]],i*3); c.set([f[o+3]*k,f[o+4]*k,f[o+5]*k],i*3); }
    const g=new THREE.BufferGeometry(); g.setAttribute("position",new THREE.BufferAttribute(p,3)); g.setAttribute("color",new THREE.BufferAttribute(c,3));
    const mat=new THREE.PointsMaterial({size:4,sizeAttenuation:true,map:dotTex,vertexColors:true,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending});
    mat.onBeforeCompile=sh=>{ sh.vertexShader=sh.vertexShader.replace("#include <logdepthbuf_vertex>","gl_PointSize=max(gl_PointSize,1.6);\n#include <logdepthbuf_vertex>"); };
    const pts=new THREE.Points(g,mat); pts.frustumCulled=false; group.add(pts); }
  // Asteroid rock the game file can't give us (Wikelo's emporiums sit in a big asteroid whose rock models only
  // read as fragments): the builder lists each rock's spot and size instead, drawn here as a rough rock.
  if(Array.isArray(T.rocks)) for(const [x,y,z,d] of T.rocks){ const m=new THREE.Mesh(rockGeo(),ROCK_MAT);
    m.position.set(x,y,z); m.scale.setScalar(Math.max(1,d/2)); m.rotation.set(x*0.001,y*0.001,z*0.001);
    m.frustumCulled=false; group.add(m); for(let a=0;a<3;a++){ lo[a]=Math.min(lo[a],[x,y,z][a]-d/2); hi[a]=Math.max(hi[a],[x,y,z][a]+d/2); } }
  group.visible=false; scene.add(group);
  delete window.QSTATION[name];                      // the geometry is on the GPU now
  return {group, meta:T, span:Math.max(50,...hi.map((v,a)=>v-lo[a]))}; }

const Rm=new THREE.Matrix4(), Rz=new THREE.Matrix4(), Off=new THREE.Vector3();
function show(o,v,d,t,f){
  const name=o.L.name;
  if(!index){ getIndex(); return false; }
  const ent=entry(o.L);
  if(!ent){ if(typeof S!=="undefined"&&S.selected?.name===name&&d<LOAD_KM*1000)
      note(name,`no 3D model listed for it in stations/index.js (${Math.floor(index.size/3)} stations listed; is the server's index.js the latest, and Quantum restarted since?)`);
    return false; }
  const file=ent.file;
  let e=R[name];
  // a download that didn't come through (a dropped connection) is tried again a minute later, up to 4 times
  if(e?.state==="failed"&&Date.now()>=e.again&&e.tries<4){ e.state="idle"; }
  if(!e||e.state==="idle"){ const picked=typeof S!=="undefined"&&(S.selected?.name===name||S.focus?.name===name);
    if(d>LOAD_KM*1000&&!picked) return false;
    // not while the camera glides past on its way somewhere else, nor from down in a 3D city (a station
    // overhead is a dot from there): it's fetched once the camera settles nearby instead
    if(!picked&&((typeof S!=="undefined"&&S.anim)||(typeof city3dDown==="function"&&city3dDown()))) return false;
    e=R[name]=Object.assign(e||{tries:0},{state:"loading"}); e.tries++;
    const failed=()=>{ e.state="failed"; e.again=Date.now()+60000; note(name,`stations/${file}.js didn't load (try ${e.tries} of 4): not in manifest.json, or the download failed - see the asset lines in this log`); };
    addScript(`stations/${encodeURIComponent(file)}.js`).then(ok=>{
        if(ok===false) return failed();
        return build(name).then(b=>{ if(b) Object.assign(e,b,{state:"ready"}); else { e.state="none"; note(name,`stations/${file}.js loaded but has no models to draw (it may not have registered under this name)`); } }); })
      .catch(failed);
    return false; }
  if(e.state!=="ready") return false;
  const k=o.ground?1:Math.max(1,MIN_PX*d/(e.span*f));              // scaled up when it would be smaller than MIN_PX (not on the ground)
  // the game's turn for the station, in its planet's frame (which turns with the planet) or the system's
  const r=e.meta.R; Rm.set(r[0],r[1],r[2],0, r[3],r[4],r[5],0, r[6],r[7],r[8],0, 0,0,0,1);
  const b=e.meta.frame==="planet"?S.bodyMap[e.meta.body||o.L.body]:null;
  const turn=!b&&!e.meta.ingame?SYS_TURN[String(e.meta.system||o.L.system||"").toLowerCase()]||0:0;
  if(b) Rz.makeRotationZ(bodyAngle(b,t)); else Rz.makeRotationZ(turn);
  Off.set(...e.meta.off).applyMatrix4(Rz);
  e.group.position.copy(v).add(Off.multiplyScalar(k)); e.group.quaternion.setFromRotationMatrix(Rz.multiply(Rm));
  e.group.scale.setScalar(k); e.group.visible=true;
  return true; }
function hide(o){ const e=R[o.L.name]; if(e?.group) e.group.visible=false; }
// Ground sites (outposts, PAFs, distribution centres...) get the game's model too when the server has one.
// The map asks once the index is in which of its places have a file, so it only tracks those.
const has=L=>!!entry(L);
const ready=()=>getIndex();
window.Stations3D={show, hide, has, ready};
})();
