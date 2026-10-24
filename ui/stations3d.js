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
const R={};                                    // station name -> {state, group, meta, span}
let index=null, indexP=null;
const getIndex=()=>indexP||(indexP=addScript("stations/index.js").then(()=>{
  index=new Map((Array.isArray(window.QSTATION_INDEX)?window.QSTATION_INDEX:[]).map(e=>[e.station,e.file])); }).catch(()=>{ index=new Map(); }));
const bytes=s=>{ const b=atob(s), u=new Uint8Array(b.length); for(let i=0;i<b.length;i++) u[i]=b.charCodeAt(i); return u; };
const LIN=k=>{ const c=k/255; return c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4; };
const GLASS_C=[0.075,0.095,0.125], WIN_C=[1.0,0.82,0.6];
// (barely metallic: there's nothing round a station for metal to reflect, so a metallic finish just reads as dark grey)
const MAT={solid:new THREE.MeshStandardMaterial({vertexColors:true,roughness:0.7,metalness:0.08,side:THREE.DoubleSide}),
  glow:new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.DoubleSide,toneMapped:false})};
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

// Built a few pieces per frame (about 6 ms at a time), so a big station arriving mid-flight doesn't stall it
const yieldFrame=()=>new Promise(r=>requestAnimationFrame(()=>r()));
async function build(name){
  const T=window.QSTATION?.[name]; if(!T?.inst) return null;
  const IN=new Float32Array(bytes(T.inst).buffer), NI=IN.length/13, group=new THREE.Group(), byMesh=new Map();
  for(let i=0;i<NI;i++){ const k=IN[i*13]; if(!byMesh.has(k)) byMesh.set(k,[]); byMesh.get(k).push(i); }
  const M=new THREE.Matrix4(); let lo=[1e9,1e9,1e9], hi=[-1e9,-1e9,-1e9], t0=performance.now();
  for(const [k,list] of byMesh){ const m=T.meshes[k]; if(!m) continue;
    if(performance.now()-t0>6){ await yieldFrame(); t0=performance.now(); }
    const im=new THREE.InstancedMesh(geometry(m),[MAT.solid,MAT.glow],list.length); let n=0;
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
  group.visible=false; scene.add(group);
  delete window.QSTATION[name];                      // the geometry is on the GPU now
  return {group, meta:T, span:Math.max(50,...hi.map((v,a)=>v-lo[a]))}; }

const Rm=new THREE.Matrix4(), Rz=new THREE.Matrix4(), Off=new THREE.Vector3();
function show(o,v,d,t,f){
  const name=o.L.name;
  if(!index){ getIndex(); return false; }
  const file=index.get(name); if(!file) return false;
  let e=R[name];
  // a download that didn't come through (a dropped connection) is tried again a minute later, up to 4 times
  if(e?.state==="failed"&&Date.now()>=e.again&&e.tries<4){ e.state="idle"; }
  if(!e||e.state==="idle"){ const picked=typeof S!=="undefined"&&(S.selected?.name===name||S.focus?.name===name);
    if(d>LOAD_KM*1000&&!picked) return false;
    // not while the camera glides past on its way somewhere else, nor from down in a 3D city (a station
    // overhead is a dot from there): it's fetched once the camera settles nearby instead
    if(!picked&&((typeof S!=="undefined"&&S.anim)||(typeof city3dDown==="function"&&city3dDown()))) return false;
    e=R[name]=Object.assign(e||{tries:0},{state:"loading"}); e.tries++;
    const failed=()=>{ e.state="failed"; e.again=Date.now()+60000; };
    addScript(`stations/${encodeURIComponent(file)}.js`).then(ok=>{
        if(ok===false) return failed();
        return build(name).then(b=>{ if(b) Object.assign(e,b,{state:"ready"}); else e.state="none"; }); })
      .catch(failed);
    return false; }
  if(e.state!=="ready") return false;
  const k=Math.max(1,MIN_PX*d/(e.span*f));                         // scaled up when it would be smaller than MIN_PX
  // the game's turn for the station, in its planet's frame (which turns with the planet) or the system's
  const r=e.meta.R; Rm.set(r[0],r[1],r[2],0, r[3],r[4],r[5],0, r[6],r[7],r[8],0, 0,0,0,1);
  const b=e.meta.frame==="planet"?S.bodyMap[e.meta.body]:null;
  if(b) Rz.makeRotationZ(bodyAngle(b,t)); else Rz.identity();
  Off.set(...e.meta.off).applyMatrix4(Rz);
  e.group.position.copy(v).add(Off.multiplyScalar(k)); e.group.quaternion.setFromRotationMatrix(Rz.multiply(Rm));
  e.group.scale.setScalar(k); e.group.visible=true;
  return true; }
function hide(o){ const e=R[o.L.name]; if(e?.group) e.group.visible=false; }
window.Stations3D={show, hide};
})();
