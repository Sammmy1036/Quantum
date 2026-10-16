"use strict";
// =================================================================== 3D cities: the shared engine  (ui/city3d-core.js)
// Everything a 3D city needs that isn't the city itself. Each city is its own small file (city3d-NewBabbage.js,
// city3d-Lorville.js, later Area 18 and Orison) that calls City3D.define({...}) with its places, its
// weather and a build() that makes its terrain and buildings. This file does the rest:
//   - places the model on the planet's real curved surface from Quantum's data, turning with it
//   - fades it in as you descend from orbit, its edge dissolving into the planet in a circle
//   - the sky (a dome that fades in over the galaxy), haze, precipitation, the sun's light and shadows,
//     window lights after sunset, the planet's clouds thinning over the city, its atmosphere glow fading
//   - keeps the camera above the ground, and the panel on the map: local-time slider (it previews the
//     whole map at that time of day), weather toggles, camera views
//
// Optional: index.html loads it, then the city files, with <script> tags. Without this file the city
// files do nothing and the map works as before; without a city file that city is just flat.
// Loaded after index.html's main script, whose globals (THREE, scene, camera, sun, S, O...) it uses.
(()=>{
if(typeof THREE==="undefined"||typeof scene==="undefined"||typeof window.registerCity3D!=="function") return;

// ------------------------------------------------------------------ helpers shared with the city files
const hash=(x,y)=>{ let h=(Math.imul(x|0,374761393)+Math.imul(y|0,668265263))|0; h=Math.imul(h^(h>>>13),1274126177); return ((h^(h>>>16))>>>0)/4294967295; };
function vnoise(x,y){ const xi=Math.floor(x), yi=Math.floor(y), u0=x-xi, v0=y-yi, s=t=>t*t*(3-2*t), u=s(u0), v=s(v0);
  const a=hash(xi,yi), b=hash(xi+1,yi), c=hash(xi,yi+1), d=hash(xi+1,yi+1); return a+(b-a)*u+(c-a)*v+(a-b-c+d)*u*v; }
function fbm(x,y){ let s=0,a=0.5,f=1; for(let i=0;i<5;i++){ s+=a*vnoise(x*f,y*f); f*=2.03; a*=0.5; } return s; }
const sstep=(a,b,x)=>{ const t=Math.min(1,Math.max(0,(x-a)/(b-a))); return t*t*(3-2*t); };
const seeded=seed=>()=>{ seed^=seed<<13; seed^=seed>>>17; seed^=seed<<5; return ((seed>>>0)%100000)/100000; };
const dot3=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const nrm=a=>{ const l=Math.hypot(a[0],a[1],a[2])||1; return [a[0]/l,a[1]/l,a[2]/l]; };
const crs=(a,b)=>[a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const tick=()=>new Promise(r=>setTimeout(r,0));
const reportErr=(where,e)=>{ console.error(e); try{ api().js_error(where,String(e&&e.stack||e).slice(0,1500)); }catch(_){} };

// ------------------------------------------------------------------ real heights from the game's elevation maps
// ui/terrain/<Body>.js files are made by tools/build_terrain.py from each world's elevation map, and
// ui/terrain/index.js lists them. A body's file is only loaded when you come down to it; without the
// files (or for a body with none) the ground is generated instead, as before.
// A grid: cols x rows of metres, column c at longitude lon0+c*dLon, row r at latitude lat0-r*dLat.
function gridSampler(G){ const W=G.cols, H=G.rows, m=G.data, wrap=!!G.wrap;
  const at=(c,r)=>{ r=r<0?0:r>=H?H-1:r; if(wrap){ c%=W; if(c<0) c+=W; } else c=c<0?0:c>=W?W-1:c; return m[r*W+c]; };
  const cr=(a,b,c,d,t)=>b+0.5*t*(c-a+t*(2*a-5*b+4*c-d+t*(3*(b-c)+d-a)));        // Catmull-Rom, smooth between cells
  return (lat,lon)=>{ const dl=wrap?(((lon-G.lon0)%360)+360)%360:(((lon-G.lon0)%360+540)%360-180);
    const fc=dl/G.dLon, fr=(G.lat0-lat)/G.dLat, c0=Math.floor(fc), r0=Math.floor(fr), tc=fc-c0, tr=fr-r0;
    const row=r=>cr(at(c0-1,r),at(c0,r),at(c0+1,r),at(c0+2,r),tc);
    return cr(row(r0-1),row(r0),row(r0+1),row(r0+2),tr); }; }
const TERRAIN={};
let terrainIndex=null;                                       // bodies with a height file, once index.js has loaded
function loadScript(src){ return window.qLoadAsset(src); }   // server-hosted map data (see qLoadAsset in index.html)
loadScript("terrain/index.js").then(()=>{ terrainIndex=Array.isArray(window.QTERRAIN_INDEX)?window.QTERRAIN_INDEX:[]; });
const hasTerrain=body=>!!terrainIndex&&terrainIndex.includes(body);
// -> {state:"loading"|"ok"|"missing", sample:(lat,lon)=>metres, ready:Promise}
function loadTerrain(body){ let rec=TERRAIN[body]; if(rec) return rec; rec=TERRAIN[body]={state:"loading",sample:null};
  const take=()=>{ const T=window.QTERRAIN?.[body]; if(!T||!T.b64){ rec.state="missing"; return; }
    try{ const bin=atob(T.b64), u8=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) u8[i]=bin.charCodeAt(i);
      rec.sample=gridSampler({cols:T.w,rows:T.h,lat0:T.lat0,lon0:T.lon0,dLat:T.dLat,dLon:T.dLon,data:new Int16Array(u8.buffer),wrap:true});
      rec.info=T; delete T.b64; rec.state="ok"; }
    catch(e){ rec.state="missing"; reportErr("terrain/"+body+".js",e); } };
  if(window.QTERRAIN?.[body]){ take(); rec.ready=Promise.resolve(rec); }
  else if(terrainIndex&&!hasTerrain(body)){ rec.state="missing"; rec.ready=Promise.resolve(rec); }
  else rec.ready=loadScript(`terrain/${encodeURIComponent(body)}.js`).then(()=>{ take(); return rec; });
  return rec; }
// A city's real building layout: ui/cities/<City>.js, made by tools/build_city.py from the game's object
// containers, listed in ui/cities/index.js. -> {a0, boxes:Float32Array (8 per box)} or null.
let cityIndex=null;
const cityIndexReady=loadScript("cities/index.js").then(()=>{ cityIndex=Array.isArray(window.QCITY_INDEX)?window.QCITY_INDEX:[]; });
const LAYOUTS={};
async function loadLayout(city){ if(city in LAYOUTS) return LAYOUTS[city];
  const file=city.replace(/\W/g,""); await cityIndexReady;
  if(!cityIndex.includes(file)) return LAYOUTS[city]=null;
  if(!window.QCITY?.[city]) await loadScript(`cities/${file}.js`);
  const T=window.QCITY?.[city], raw=T?.inst||T?.b64; if(!raw) return LAYOUTS[city]=null;
  try{ const bin=atob(raw), u8=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) u8[i]=bin.charCodeAt(i);
    const f=new Float32Array(u8.buffer);
    LAYOUTS[city]=T.inst?{...T, inst:f}:{...T, b64:undefined, boxes:f}; }
  catch(e){ reportErr(`cities/${file}.js`,e); LAYOUTS[city]=null; }
  return LAYOUTS[city]; }
// 3D value noise, so detail added on top of the map is fixed to the planet (the same wherever a patch of
// ground is built from)
function vnoise3(x,y,z){ const xi=Math.floor(x), yi=Math.floor(y), zi=Math.floor(z), s=t=>t*t*(3-2*t), u=s(x-xi), v=s(y-yi), w=s(z-zi);
  const h=(a,b,c)=>hash(a+Math.imul(c|0,1013),b-Math.imul(c|0,7919));
  const l=(a,b,t)=>a+(b-a)*t, f=k=>l(l(h(xi,yi,zi+k),h(xi+1,yi,zi+k),u),l(h(xi,yi+1,zi+k),h(xi+1,yi+1,zi+k),u),v);
  return l(f(0),f(1),w); }
function fbm3(x,y,z,oct=5){ let s=0,a=0.5,f=1; for(let i=0;i<oct;i++){ s+=a*vnoise3(x*f,y*f,z*f); f*=2.03; a*=0.5; } return s; }

// ------------------------------------------------------------------ lit windows and street lamps
// litWindows(material, {floor, col, lit, glass}): the material's emissive light (its colour times
// emissiveIntensity, which the city turns up after dark) shows only in windows: floors 'floor' metres apart,
// panes 'col' metres wide, on walls (not roofs), from the second floor up. Each building has its own way of
// being lit, picked from where it stands: an office lit a block of windows at a time, a building lit whole
// floor by floor, or scattered flats; and its own light (warm, neutral or cool white). 'lit' is how much of
// a typical building is on. Once windows are smaller than a pixel they turn into their average glow, so a
// lit city doesn't shimmer from afar. For the game's models, which are z-up and placed by instancing; set
// the material's emissive colour to white.
const WIN_VERT=`
        { vec3 wsc=vec3(1.0); vWinSeed=0.37;
          #ifdef USE_INSTANCING
            wsc=vec3(length(instanceMatrix[0].xyz),length(instanceMatrix[1].xyz),length(instanceMatrix[2].xyz));
            vec3 it=instanceMatrix[3].xyz; vWinSeed=fract(sin(dot(floor(it*0.5),vec3(0.0123,0.0457,0.0789)))*43758.5453);
          #endif
          vec3 wp=transformed*wsc; vec3 on=normalize(objectNormal+1e-6);
          vec2 t=normalize(vec2(-on.y,on.x)+1e-6);
          vWin=vec3(dot(wp.xy,t), wp.z, abs(on.z)); vWinXY=wp.xy; }`;
function shaderHook(m,key,vert,frag){
  const prev=m.onBeforeCompile, prevKey=m.customProgramCacheKey.bind(m);
  m.customProgramCacheKey=()=>prevKey()+"|"+key;
  m.onBeforeCompile=(sh,r)=>{ prev.call(m,sh,r);
    const dec="\nvarying vec3 vWin; varying vec2 vWinXY; varying float vWinSeed;";
    sh.vertexShader=sh.vertexShader.replace("#include <common>","#include <common>"+dec).replace("#include <begin_vertex>","#include <begin_vertex>"+vert);
    sh.fragmentShader=sh.fragmentShader.replace("#include <common>","#include <common>"+dec+"\nfloat wHash(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453); }")
      .replace("#include <emissivemap_fragment>","#include <emissivemap_fragment>\n"+frag); };
  m.needsUpdate=true; return m; }
function litWindows(m,{floor=4.2,col=3.4,lit=0.3,glass=false}={}){
  const f=v=>(+v).toFixed(3);
  return shaderHook(m,`win${f(floor)},${f(col)},${f(lit)},${glass}`,WIN_VERT,`
        { vec2 q=vWin.xy/vec2(${f(col)},${f(floor)}), id=floor(q), w=fract(q);
          float sd=vWinSeed*311.0, style=fract(vWinSeed*13.7), tone=fract(vWinSeed*5.31);
          // the building's way of being lit: blocks of windows (offices), whole floors, or single windows (flats)
          vec2 gs=${glass?"vec2(3.0,2.0)":"style<0.45?vec2(4.0,3.0):style<0.75?vec2(64.0,1.0):vec2(1.0,1.0)"};
          vec2 gq=q/gs, gid=floor(gq);
          float hg=wHash(gid+vec2(sd,sd*0.57)), h=wHash(id+vec2(sd*1.31,sd*0.71));
          float busy=${f(lit)}*(0.2+1.6*vWinSeed*vWinSeed);                     // a few busy buildings, many quiet ones
          float onG=step(1.0-busy,hg);
          float onW=onG*step(0.12,h)+(1.0-onG)*step(0.965,h);                   // most of a lit group; a few strays elsewhere
          float pane=${glass?"step(0.06,w.x)*step(w.x,0.94)*step(0.12,w.y)*step(w.y,0.92)":"step(0.16,w.x)*step(w.x,0.84)*step(0.24,w.y)*step(w.y,0.84)"};
          float fill=${glass?"0.79":"0.46"};
          float pxW=length(fwidth(q)), pxG=length(fwidth(gq));
          float near=onW*pane, mid=(onG*0.88+(1.0-onG)*0.035)*fill, far=(busy*0.88+(1.0-busy)*0.035)*fill*0.28;
          far*=1.0+2.2*smoothstep(2.0,7.0,pxG);                                   // tens of km out: glow again
          float lvl=mix(mix(near,mid,smoothstep(0.5,1.1,pxW)),far,smoothstep(0.55,1.2,max(pxG,pxW*0.25)));
          lvl*=(1.0-smoothstep(0.35,0.6,vWin.z))*step(5.5,vWin.y);              // walls only, from the second floor
          vec3 wc=tone<0.55?vec3(1.0,0.73,0.45):tone<0.86?vec3(1.0,0.88,0.72):vec3(0.80,0.88,1.0);   // the building's own light
          totalEmissiveRadiance*=lvl*wc*(0.75+0.5*h); }`); }
// litLamps(material, {spacing, warm}): street lamps on whatever faces up (plates, decks, pads): a lamp in
// most cells of a 'spacing' metre grid, each a bright point with a pool of light round it on the ground.
function litLamps(m,{spacing=34,warm=true,pool=0.35}={}){
  const f=v=>(+v).toFixed(3);
  return shaderHook(m,`lamp${f(spacing)},${warm},${f(pool)}`,WIN_VERT,`
        { vec2 q=vWinXY/${f(spacing)}, id=floor(q), w=fract(q);
          float h=wHash(id+vWinSeed*91.0), on=step(0.3,h);
          vec2 o=vec2(wHash(id+1.7),wHash(id+3.1))*0.5+0.25; float d=length(w-o)*${f(spacing)};
          float pix=length(fwidth(q));
          float near=on*(smoothstep(1.6,0.0,d)*1.4+exp(-d*d/${f(spacing*spacing*0.04)})*${f(pool)});
          float avg=0.7*${f(pool)}*0.13;
          float lvl=mix(near,avg,smoothstep(0.35,0.8,pix))*smoothstep(0.75,0.9,vWin.z);
          vec3 lc=${warm?"vec3(1.0,0.68,0.36)":"vec3(0.92,0.95,1.0)"};
          totalEmissiveRadiance*=lvl*lc; }`); }

// litCity(material, {lit, spacing}): for models coloured from the game's materials (build_city.py), whose
// triangles carry a 'lite' attribute saying what each one is: 1 a window (the game's own window faces: lit
// floor by floor, block by block or flat by flat, as litWindows), 2 a light strip or lit sign (glows its own
// colour), 3 glass (a faint glow from inside), 5 the top of a plate, deck or pad (street lamps, as litLamps);
// anything else stays dark. The material's emissive colour should be white; the city scales
// emissiveIntensity with the night.
function litCity(m,{lit=0.3,spacing=36}={}){
  const f=v=>(+v).toFixed(3);
  const prev=m.onBeforeCompile, prevKey=m.customProgramCacheKey.bind(m);
  m.customProgramCacheKey=()=>prevKey()+`|city${f(lit)},${f(spacing)}`;
  m.onBeforeCompile=(sh,r)=>{ prev.call(m,sh,r);
    const dec="\nvarying vec3 vWin; varying vec2 vWinXY; varying float vWinSeed; varying float vLite;";
    sh.vertexShader=sh.vertexShader.replace("#include <common>","#include <common>"+dec+"\nattribute float lite;")
      .replace("#include <begin_vertex>","#include <begin_vertex>"+WIN_VERT+"\nvLite=lite;");
    sh.fragmentShader=sh.fragmentShader.replace("#include <common>","#include <common>"+dec+"\nfloat wHash(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453); }")
      .replace("#include <emissivemap_fragment>",`#include <emissivemap_fragment>
        { float L=floor(vLite+0.5); vec3 em=vec3(0.0);
          if(L==1.0){                                                        // a window face
            vec2 q=vWin.xy/vec2(3.4,4.2), id=floor(q), w=fract(q);
            float sd=vWinSeed*311.0, style=fract(vWinSeed*13.7), tone=fract(vWinSeed*5.31);
            vec2 gs=style<0.45?vec2(4.0,3.0):style<0.75?vec2(64.0,1.0):vec2(1.0,1.0), gq=q/gs, gid=floor(gq);
            float hg=wHash(gid+vec2(sd,sd*0.57)), h=wHash(id+vec2(sd*1.31,sd*0.71));
            float busy=${f(lit)}*(0.2+1.6*vWinSeed*vWinSeed), onG=step(1.0-busy,hg);
            float onW=onG*step(0.12,h)+(1.0-onG)*step(0.965,h);
            float pane=step(0.08,w.x)*step(w.x,0.92)*step(0.14,w.y)*step(w.y,0.9), fill=0.7;
            float pxW=length(fwidth(q)), pxG=length(fwidth(gq));
            float near=onW*pane, mid=(onG*0.88+(1.0-onG)*0.035)*fill, far=(busy*0.88+(1.0-busy)*0.035)*fill*0.3;
            far*=1.0+2.2*smoothstep(2.0,7.0,pxG);
            float lvl=mix(mix(near,mid,smoothstep(0.5,1.1,pxW)),far,smoothstep(0.55,1.2,max(pxG,pxW*0.25)));
            vec3 wc=tone<0.55?vec3(1.0,0.73,0.45):tone<0.86?vec3(1.0,0.88,0.72):vec3(0.80,0.88,1.0);
            em=lvl*wc*(0.75+0.5*h); }
          else if(L==2.0) em=(vColor.rgb*0.7+vec3(0.3))*0.9;                // light strips and signs: their own colour
          else if(L==3.0) em=vec3(1.0,0.86,0.66)*0.07;                      // glass: lit from inside
          else if(L==5.0){                                                  // street lamps on the tops of plates and decks
            vec2 q=vWinXY/${f(spacing)}, id=floor(q), w=fract(q);
            float h=wHash(id+vWinSeed*91.0), on=step(0.3,h);
            vec2 o=vec2(wHash(id+1.7),wHash(id+3.1))*0.5+0.25; float d=length(w-o)*${f(spacing)};
            float pix=length(fwidth(q));
            float near=on*(smoothstep(1.6,0.0,d)*1.4+exp(-d*d/${f(spacing*spacing*0.04)})*0.35);
            em=vec3(1.0,0.68,0.36)*mix(near,0.03,smoothstep(0.35,0.8,pix))*smoothstep(0.75,0.9,vWin.z); }
          totalEmissiveRadiance*=em; }`); };
  m.needsUpdate=true; return m; }

// ------------------------------------------------------------------ the fade every city material takes part in
// Its alpha is multiplied by FADE (0-1, from altitude) and by a circular edge set per city (by default 1
// out to 24 km, 0 by 66 km), so the square of terrain never shows. Materials stay "transparent" so the
// planet beneath shows through while they fade; at full strength they draw opaque as before.
function fadeable(m,FADE,edge,SUNLIT){ if(!m||m.userData.fade) return m; m.userData.fade=true; m.transparent=true; if(m.depthWrite!==false) m.depthWrite=true;
  const prev=m.onBeforeCompile, prevKey=m.customProgramCacheKey.bind(m);      // keep any shader changes the city made (lit windows)
  m.customProgramCacheKey=()=>prevKey()+"|fade"+edge.join(",");
  m.onBeforeCompile=(sh,r)=>{ prev.call(m,sh,r); sh.uniforms.FADE=FADE; sh.uniforms.SUNLIT=SUNLIT||{value:1};
    sh.vertexShader=sh.vertexShader.replace("#include <common>","#include <common>\nvarying float vEdge;")
      .replace("#include <begin_vertex>",`#include <begin_vertex>
        vec3 fp=transformed;
        #ifdef USE_INSTANCING
          fp=(instanceMatrix*vec4(fp,1.0)).xyz;
        #endif
        vEdge=1.0-smoothstep(${edge[0].toFixed(1)},${edge[1].toFixed(1)},length(fp.xz));`);
    // direct sunlight only while the sun is above the city's horizon: on the way down the scene's sun
    // is still part planet-lit, and it was lighting the city's walls from below the ground at night
    sh.fragmentShader=sh.fragmentShader.replace("#include <common>","#include <common>\nvarying float vEdge; uniform float FADE; uniform float SUNLIT;")
      .replace("#include <lights_fragment_end>","#include <lights_fragment_end>\nreflectedLight.directDiffuse*=SUNLIT; reflectedLight.directSpecular*=SUNLIT;")
      .replace("#include <dithering_fragment>","#include <dithering_fragment>\ngl_FragColor.a*=FADE*vEdge;"); };
  m.needsUpdate=true; return m; }

// ------------------------------------------------------------------ shared scene pieces (one set for all cities)
const ambient=scene.children.find(o=>o.isAmbientLight), AMB0=ambient?.intensity??1, SUN0=sun.intensity, SUNCOL0=sun.color.clone();
const hemi=new THREE.HemisphereLight(0xcfe3ff,0x8a99ad,0.6);
const fog=new THREE.Fog(0xc4d4e6,7000,52000);
// The sky: a dome around the camera, drawn first and fading in over the galaxy as you descend. Deeper
// overhead, paler at the horizon, a glow round the sun. Opaque pass with its own blending so everything
// else draws over it.
const dome=new THREE.Mesh(new THREE.SphereGeometry(1,48,24),new THREE.ShaderMaterial({
  uniforms:{A:{value:0},UP:{value:new THREE.Vector3(0,0,1)},SUN:{value:new THREE.Vector3(1,0,0)},ZEN:{value:new THREE.Color()},HOR:{value:new THREE.Color()},SUNK:{value:0},GLOW:{value:new THREE.Color(1,0.86,0.62)}},
  vertexShader:`varying vec3 vD; void main(){ vD=normalize(position); gl_Position=projectionMatrix*viewMatrix*vec4(position*1.0e5+cameraPosition,1.0); }`,
  fragmentShader:`varying vec3 vD; uniform float A, SUNK; uniform vec3 UP, SUN, ZEN, HOR, GLOW;
    void main(){ vec3 d=normalize(vD); float h=dot(d,UP);
      vec3 c=mix(HOR,ZEN,pow(clamp(h,0.0,1.0),0.55));
      float s=max(dot(d,normalize(SUN)),0.0); c+=GLOW*(pow(s,12.0)*0.25+pow(s,300.0)*0.6)*SUNK;
      gl_FragColor=vec4(c,A); }`,
  side:THREE.BackSide, depthTest:false, depthWrite:false, transparent:false,
  blending:THREE.CustomBlending, blendSrc:THREE.SrcAlphaFactor, blendDst:THREE.OneMinusSrcAlphaFactor}));
dome.renderOrder=-1000; dome.frustumCulled=false; dome.visible=false; scene.add(dome);
// The stars dim as the sky brightens (the map's starfield shader gets one extra uniform, once).
const STARK={value:1};
function patchShader(m,uniforms,find,repl){ if(!m||m.userData.c3d) return m?.userData.c3d; Object.assign(m.uniforms,uniforms);
  const f=Object.entries(uniforms).filter(([,u])=>typeof u.value==="number").map(([k])=>k), v=Object.entries(uniforms).filter(([,u])=>u.value?.isVector3).map(([k])=>k);
  m.fragmentShader=m.fragmentShader.replace(/void main\(\)\{/,`${f.length?`uniform float ${f.join(",")};`:""}${v.length?` uniform vec3 ${v.join(",")};`:""}\nvoid main(){`).replace(find,repl);
  m.userData.c3d=uniforms; m.needsUpdate=true; return uniforms; }
if(typeof starfield!=="undefined") patchShader(starfield.material,{STARK},"gl_FragColor=vec4(vC*(core+halo),1.0);","gl_FragColor=vec4(vC*(core+halo)*STARK,1.0);");
// Each planet's clouds thin out over the city as you come down (they'd cover it from above) and its
// atmosphere glow fades as you pass into it. Its own uniforms, so cities on different worlds don't mix.
function planetFx(o){ if(!o) return null; if(o.userData_c3d) return o.userData_c3d;
  const fx={CLOUDK:{value:0},CITYP:{value:new THREE.Vector3(0,0,1)},ATMOK:{value:1}};
  if(o.clouds) patchShader(o.clouds.material,{CLOUDK:fx.CLOUDK,CITYP:fx.CITYP},/gl_FragColor=vec4\(([^;]*),d\*0\.92\*mix\(0\.35,1\.0,day\)\);/,
    (m0,rgb)=>`gl_FragColor=vec4(${rgb},d*0.92*mix(0.35,1.0,day)*(1.0-CLOUDK*(1.0-smoothstep(0.045,0.09,distance(vP,CITYP)))));`);
  if(o.atmo) patchShader(o.atmo.material,{ATMOK:fx.ATMOK},"gl_FragColor=vec4(pow(ATMO,vec3(2.2))*a*lit*0.9*K,1.0);","gl_FragColor=vec4(pow(ATMO,vec3(2.2))*a*lit*0.9*K*ATMOK,1.0);");
  o.userData_c3d=fx; return fx; }
// Precipitation round the camera: soft round particles kept 40-300 m away (closer ones drew as big
// squares). Each city's weather sets colour, size and how they fall: snow, rain, dust...
const PRECIP_N=5000, pg=new THREE.BufferGeometry(), pp=new Float32Array(PRECIP_N*3);
for(let i=0;i<PRECIP_N;i++){ const a=Math.random()*Math.PI*2, r=40+Math.random()*260; pp[i*3]=Math.cos(a)*r; pp[i*3+1]=(Math.random()-0.5)*600; pp[i*3+2]=Math.sin(a)*r; }
pg.setAttribute("position",new THREE.BufferAttribute(pp,3));
const dot=(()=>{ const c=document.createElement("canvas"); c.width=c.height=32; const g=c.getContext("2d"), gr=g.createRadialGradient(16,16,0,16,16,16);
  gr.addColorStop(0,"rgba(255,255,255,1)"); gr.addColorStop(0.5,"rgba(255,255,255,.6)"); gr.addColorStop(1,"rgba(255,255,255,0)"); g.fillStyle=gr; g.fillRect(0,0,32,32); return new THREE.CanvasTexture(c); })();
const precip=new THREE.Points(pg,new THREE.PointsMaterial({color:0xffffff,map:dot,size:1.2,transparent:true,opacity:0.9,depthWrite:false,fog:false}));
precip.visible=false; precip.frustumCulled=false; scene.add(precip);
renderer.shadowMap.enabled=true; renderer.shadowMap.type=THREE.PCFSoftShadowMap;
sun.shadow.mapSize.set(2048,2048); sun.shadow.bias=-0.0006; sun.shadow.normalBias=1.5; sun.shadow.camera.near=100; sun.shadow.camera.far=70000;
const opt={precip:true,haze:true};
const reduceMotion=()=>matchMedia("(prefers-reduced-motion: reduce)").matches;

// Defaults a city can override in its define({...}).
// ------------------------------------------------------------------ a city drawn from the game's own layout
// gameLayout(ctx, opts): every model in ui/cities/<City>.js (made by tools/build_city.py) placed where the
// game places it, instanced, coloured from the game's materials, with close-up versions (<City>.near.js)
// swapped in near the camera. For the cities after New Babbage (whose own file still draws its layout its
// own way). opts:
//   lightClass(mesh) -> "none"|"tower"|"base"|"plate"|"port"|"dome"|"glass": what a model gives at night
//   lift   metres from the layout's origin to the model's ground zero (layout.a0 - C.alt0)
//   roofs  colour for faces that point up on plain models (snow, dust), or null for their own colour
//   nearFile  the close-up file to load, or null for none
//   landmarks {key: /model name/}: where the first copy of each stands (for camera views)
//   lampTops  which light classes get street lamps on their flat tops (default plate and port)
// -> {LIT, landmarks, footprint({reach}), update(now), onNight(night), ready}
function gameLayout(ctx,{lightClass,lift=0,roofs=null,nearFile=null,landmarks={},lampTops=/plate|port/}={}){
  const {layout:LAY, F, inner, curve}=ctx, R0=F.B.radius;
  const IN=LAY.inst, NI=IN.length/13;
  const bytes=s=>{ const b=atob(s), u=new Uint8Array(b.length); for(let i=0;i<b.length;i++) u[i]=b.charCodeAt(i); return u; };
  const boxOf=m=>({c:m.lo.map((v,i)=>(v+m.hi[i])/2), h:m.lo.map((v,i)=>(m.hi[i]-v)/2)});
  const MB=LAY.meshes.map(boxOf);
  const std=(o={})=>new THREE.MeshStandardMaterial({vertexColors:true,roughness:0.8,metalness:0.15,emissive:0xffffff,emissiveIntensity:0,side:THREE.DoubleSide,shadowSide:THREE.BackSide,...o});
  const LIT={none:std(), glass:std({roughness:0.2,metalness:0.55}), tower:std(), base:std(), plate:std(), port:std(), dome:std({emissive:0xffe2b8}), city:std()};
  litWindows(LIT.tower,{floor:4.2,col:3.4,lit:0.3}); litWindows(LIT.base,{floor:5.0,col:4.0,lit:0.16});
  litWindows(LIT.glass,{floor:4.0,col:2.2,lit:0.5,glass:true});
  litLamps(LIT.plate,{spacing:36,warm:true}); litLamps(LIT.port,{spacing:24,warm:false,pool:0.5});
  litCity(LIT.city,{lit:0.3,spacing:36});
  const LIN=k=>{ const c=k/255; return c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4; };
  const GLASS_C=[0.075,0.095,0.125], ROAD_C=[0.028,0.026,0.024], KC=[[0.5,0.48,0.45],[0.46,0.44,0.42],[0.62,0.6,0.56],[0.5,0.5,0.5],[0.5,0.48,0.45],[0.36,0.42,0.5]];
  // sharp at real edges, smooth across gentle bends (as New Babbage does)
  const crease=(pos,nt,keys,cosMax=0.766)=>{ const fn=new Float32Array(nt*3), out=new Float32Array(nt*9);
    for(let t=0;t<nt;t++){ const o=t*9, ux=pos[o+3]-pos[o], uy=pos[o+4]-pos[o+1], uz=pos[o+5]-pos[o+2], vx=pos[o+6]-pos[o], vy=pos[o+7]-pos[o+1], vz=pos[o+8]-pos[o+2];
      const x=uy*vz-uz*vy, y=uz*vx-ux*vz, z=ux*vy-uy*vx, l=Math.hypot(x,y,z)||1; fn[t*3]=x/l; fn[t*3+1]=y/l; fn[t*3+2]=z/l; }
    const at=new Map(); for(let v=0;v<nt*3;v++){ let L=at.get(keys[v]); if(!L) at.set(keys[v],L=[]); L.push(v); }
    for(const L of at.values()) for(const v of L){ const t=(v/3)|0; let x=0,y=0,z=0;
      for(const w of L){ const u=(w/3)|0; if(fn[t*3]*fn[u*3]+fn[t*3+1]*fn[u*3+1]+fn[t*3+2]*fn[u*3+2]>=cosMax){ x+=fn[u*3]; y+=fn[u*3+1]; z+=fn[u*3+2]; } }
      const l=Math.hypot(x,y,z)||1; out[v*3]=x/l; out[v*3+1]=y/l; out[v*3+2]=z/l; }
    return out; };
  const makeGeo=(m,b)=>{ const q=new Int16Array(bytes(m.v).buffer), iu=bytes(m.i), idx=m.i32?new Uint32Array(iu.buffer):new Uint16Array(iu.buffer);
    const nt=Math.floor(idx.length/3), pos=new Float32Array(nt*9), col=new Float32Array(nt*9), kc=KC[m.kind]||KC[0];
    const P=k=>[b.c[0]+q[k*3]/32767*b.h[0], b.c[1]+q[k*3+1]/32767*b.h[1], b.c[2]+q[k*3+2]/32767*b.h[2]];
    const runs=m.parts||null, lite=runs?new Float32Array(nt*3):null, lampTop=lampTops.test(lightClass(m)), keys=new Float64Array(nt*3);
    for(let v=0;v<nt*3;v++){ const w=idx[v]; keys[v]=(q[w*3]+32768)*4294967296+(q[w*3+1]+32768)*65536+(q[w*3+2]+32768); }
    let ri=0;
    for(let t=0;t<nt;t++){ const A=P(idx[t*3]), B_=P(idx[t*3+1]), C_=P(idx[t*3+2]);
      const ux=B_[0]-A[0], uy=B_[1]-A[1], uz=B_[2]-A[2], vx=C_[0]-A[0], vy=C_[1]-A[1], vz=C_[2]-A[2];
      const nx=uy*vz-uz*vy, ny=uz*vx-ux*vz, nz=ux*vy-uy*vx, up=Math.abs(nz/(Math.hypot(nx,ny,nz)||1))>0.8;
      let c, L=0;
      if(runs){ while(ri<runs.length-1&&t>=runs[ri][0]+runs[ri][1]) ri++;
        const r=runs[ri], look=r[5]; c=look===3?GLASS_C:look===4&&roofs?roofs:[LIN(r[2]),LIN(r[3]),LIN(r[4])];
        L=look===1||look===2||look===3?look:0; if(up&&look===0&&lampTop) L=5;
        // A glowing material laid flat is a road or deck with the game's scrolling traffic lights on it (Lorville's
        // streets and trench floors): its colour is the light's, near white, which in daylight read as white paint.
        // By day it's dark asphalt; at night its lights show as points along it.
        if(up&&look===2){ c=ROAD_C; L=5; } }
      else c=roofs&&m.kind!==5&&up?roofs:kc;                 // the game's models are z-up
      for(let k=0;k<3;k++){ const v=[A,B_,C_][k]; pos.set(v,t*9+k*3); col.set(c,t*9+k*3); if(lite) lite[t*3+k]=L; } }
    const g=new THREE.BufferGeometry(); g.setAttribute("position",new THREE.BufferAttribute(pos,3)); g.setAttribute("color",new THREE.BufferAttribute(col,3));
    if(lite) g.setAttribute("lite",new THREE.BufferAttribute(lite,1));
    g.setAttribute("normal",new THREE.BufferAttribute(crease(pos,nt,keys),3)); return g; };
  const LOD={}, LM={}, foot=[];
  const byMesh=new Map(); for(let i=0;i<NI;i++){ const k=IN[i*13]; if(!byMesh.has(k)) byMesh.set(k,[]); byMesh.get(k).push(i); }
  const Mx=new THREE.Matrix4(), Q=new THREE.Quaternion(), Y=new THREE.Vector3(0,1,0), U=new THREE.Vector3(), Tm=new THREE.Matrix4(), Cv=new THREE.Vector3();
  const place=o=>{ const x=IN[o+3], z=IN[o+11], y=IN[o+7]+lift+(x*x+z*z)/(2*R0); return [x,y,z]; };
  async function build(){ let done=0;
    for(const [k,list] of byMesh){ const m=LAY.meshes[k], cls=lightClass(m), mat=m.parts?LIT.city:LIT[cls]||LIT.none, b=MB[k];
      const im=new THREE.InstancedMesh(makeGeo(m,b),mat,list.length);
      const mats=new Float32Array(list.length*16), cen=new Float32Array(list.length*3), rad=new Float32Array(list.length); let n=0;
      for(const i of list){ const o=i*13+1, [x,y,z]=place(o);
        const p=curve(x,y,z); U.set(p[0],p[1]+F.Rb,p[2]).normalize(); Q.setFromUnitVectors(Y,U);
        Mx.set(IN[o],IN[o+1],IN[o+2],0, IN[o+4],IN[o+5],IN[o+6],0, IN[o+8],IN[o+9],IN[o+10],0, 0,0,0,1);
        Tm.makeRotationFromQuaternion(Q).multiply(Mx).setPosition(p[0],p[1],p[2]);
        im.setMatrixAt(n,Tm); Tm.toArray(mats,n*16);
        Cv.set(b.c[0],b.c[1],b.c[2]).applyMatrix4(Tm); cen.set([Cv.x,Cv.y,Cv.z],n*3);
        const s=Math.max(Math.hypot(IN[o],IN[o+4],IN[o+8]),Math.hypot(IN[o+1],IN[o+5],IN[o+9]),Math.hypot(IN[o+2],IN[o+6],IN[o+10]));
        rad[n]=Math.hypot(b.h[0],b.h[1],b.h[2])*s;
        // its footprint and the height its base sits at (for fitting the ground under the city)
        const at=(a,bb,c)=>[IN[o]*a+IN[o+1]*bb+IN[o+2]*c+IN[o+3], IN[o+4]*a+IN[o+5]*bb+IN[o+6]*c+IN[o+7], IN[o+8]*a+IN[o+9]*bb+IN[o+10]*c+IN[o+11]];
        let lo=1e9, hi=-1e9; for(let c=0;c<8;c++){ const yy=at(b.c[0]+(c&1?1:-1)*b.h[0], b.c[1]+(c&2?1:-1)*b.h[1], b.c[2]+(c&4?1:-1)*b.h[2])[1]; lo=Math.min(lo,yy); hi=Math.max(hi,yy); }
        const rise=y-IN[o+7];
        if(rad[n]>12&&rad[n]<1500) foot.push([x,z,Math.hypot(b.h[0],b.h[1])*s,lo+rise]);
        for(const [key,rx] of Object.entries(landmarks)) if(!LM[key]&&rx.test(m.name)){ const c=at(...b.c); LM[key]={t:[c[0],c[2]], y:c[1]+rise, base:lo+rise, top:hi+rise}; }
        n++; }
      im.count=n; im.castShadow=true; im.receiveShadow=true; im.frustumCulled=false; inner.add(im);
      LOD[k]={far:im, near:null, mat, n, mats, cen, rad, b};
      if(++done%40===0) await ctx.tick(); } }
  // close-up versions near the camera (the biggest-looking copies first, within a triangle budget)
  const NEAR_K=48, NEAR_MIN=2500, NEAR_TRIS=12e6; let dirty=true, at=0; const camAt=new THREE.Vector3(1e12,0,0), camL=new THREE.Vector3();
  function update(now){ if(now-at<300) return; at=now;
    camera.getWorldPosition(camL); inner.worldToLocal(camL);
    if(!dirty&&camAt.distanceToSquared(camL)<Math.max(40,0.02*camL.length())**2) return; camAt.copy(camL); dirty=false;
    const ents=Object.values(LOD).filter(e=>e.near); if(!ents.length) return;
    const all=[]; ents.forEach((e,ei)=>{ e.nt=e.nt||e.near.geometry.attributes.position.count/3;
      for(let i=0;i<e.n;i++){ const dx=e.cen[i*3]-camL.x, dy=e.cen[i*3+1]-camL.y, dz=e.cen[i*3+2]-camL.z, gap=Math.max(1,Math.sqrt(dx*dx+dy*dy+dz*dz)-e.rad[i]);
        const sc=gap<NEAR_MIN?1e9-gap:e.rad[i]*2/gap; if(sc>1/NEAR_K) all.push([sc,ei,i]); } });
    all.sort((a,b)=>b[0]-a[0]); const pick=ents.map(e=>new Uint8Array(e.n)); let tris=0;
    for(const [,ei,i] of all){ const t=ents[ei].nt; if(tris+t>NEAR_TRIS) continue; tris+=t; pick[ei][i]=1; }
    ents.forEach((e,ei)=>{ const fa=e.far.instanceMatrix.array, na=e.near.instanceMatrix.array; let nf=0, nn=0;
      for(let i=0;i<e.n;i++){ const mm=e.mats.subarray(i*16,i*16+16); if(pick[ei][i]) na.set(mm,(nn++)*16); else fa.set(mm,(nf++)*16); }
      e.far.count=nf; e.near.count=nn; e.far.instanceMatrix.needsUpdate=true; e.near.instanceMatrix.needsUpdate=true; }); }
  const loadNear=async()=>{ if(!nearFile) return; const city=LAY.city;
    if(!window.QCITYNEAR?.[city]) await loadScript(nearFile);
    const NM=window.QCITYNEAR?.[city]?.meshes; if(!NM) return; let c=0;
    for(const [ks,m] of Object.entries(NM)){ const e=LOD[+ks]; if(!e||!e.n) continue;
      try{ const near=new THREE.InstancedMesh(makeGeo(m,boxOf(m)),e.mat,e.n); near.count=0; near.castShadow=true; near.receiveShadow=true;
        near.frustumCulled=false; near.userData.closeUp=true; inner.add(near); e.near=near; }catch(err){ console.warn("near",m.name,err); }
      if(++c%12===0) await ctx.tick(); }
    delete window.QCITYNEAR[city]; dirty=true; };
  // The ground the city stands on: the lowest base of the pieces in each 150 m cell, filled out from the
  // cells around it and smoothed, so the ground can be fitted under the city's real floor. -> (x,z) =>
  // {floor, w} (w: 1 inside the city, falling to 0 a few hundred metres outside), or null far from it.
  function footprint({reach=3}={}){ const CELL=150, half=Math.ceil(Math.max(2000,...foot.map(f=>Math.max(Math.abs(f[0]),Math.abs(f[1]))+f[2]))/CELL)+4, N=half*2;
    const lo=new Float32Array(N*N).fill(Infinity);
    for(const [x,z,r,b] of foot){ const rr=Math.min(r,600);
      for(let gz=Math.floor((z-rr)/CELL)+half; gz<=Math.floor((z+rr)/CELL)+half; gz++) for(let gx=Math.floor((x-rr)/CELL)+half; gx<=Math.floor((x+rr)/CELL)+half; gx++){
        if(gx<0||gz<0||gx>=N||gz>=N) continue; const k=gz*N+gx; if(b<lo[k]) lo[k]=b; } }
    const w=new Float32Array(N*N), fl=new Float32Array(N*N);
    for(let gz=0;gz<N;gz++) for(let gx=0;gx<N;gx++){ let s=0, sw=0, m=0;            // fill and soften over ~3 cells
      const R2=reach*reach, sg=Math.max(4,R2/2.25);
      for(let dz=-reach;dz<=reach;dz++) for(let dx=-reach;dx<=reach;dx++){ if(dx*dx+dz*dz>R2) continue; const x=gx+dx, z=gz+dz; if(x<0||z<0||x>=N||z>=N) continue; const v=lo[z*N+x]; if(!isFinite(v)) continue;
        const ww=Math.exp(-(dx*dx+dz*dz)/sg); s+=v*ww; sw+=ww; if(dx*dx+dz*dz<=2) m=1; }
      fl[gz*N+gx]=sw?s/sw:0; w[gz*N+gx]=sw?Math.min(1,sw/3)*(m||reach>3?1:0.6):0; }
    return (x,z)=>{ const fx=x/CELL+half-0.5, fz=z/CELL+half-0.5, x0=Math.floor(fx), z0=Math.floor(fz), tx=fx-x0, tz=fz-z0;
      if(x0<0||z0<0||x0>=N-1||z0>=N-1) return null;
      const g=(a,k)=>a[k]; let W=0, Fl=0;
      for(const [dx,dz,ww] of [[0,0,(1-tx)*(1-tz)],[1,0,tx*(1-tz)],[0,1,(1-tx)*tz],[1,1,tx*tz]]){ const k=(z0+dz)*N+x0+dx; W+=g(w,k)*ww; Fl+=g(fl,k)*g(w,k)*ww; }
      return W>0.001?{floor:Fl/W, w:W}:null; }; }
  return {LIT, landmarks:LM, build, footprint, update, loadNear,
    onNight(night){ LIT.tower.emissiveIntensity=1.4*night; LIT.base.emissiveIntensity=1.3*night; LIT.glass.emissiveIntensity=1.6*night;
      LIT.plate.emissiveIntensity=1.2*night; LIT.port.emissiveIntensity=1.5*night; LIT.dome.emissiveIntensity=0.14*night; LIT.city.emissiveIntensity=1.4*night; } }; }

const DEFAULTS={
  alt0:0,                     // altitude (m) of the model's ground zero
  extent:70000,               // terrain reaches this far out from the city each way (m)
  edge:[24000,66000],         // the model's circular edge: solid out to the first, gone by the second (m)
  buildDist:900000,           // the model is built (once, in the background) within this distance (m)
  reveal:[300000,45000],      // it fades in between these altitudes
  revealDist:[300000,700000], // ...and within these distances of the city
  ground:[70000,15000],       // the ground's sky, haze and light blend in between these altitudes
  groundDist:[60000,140000],
  panelAlt:90000, panelDist:200000,   // the panel shows within these
  ownDist:45000,              // on a planet with real terrain, the city takes over when you look within this of it (m)
  weather:{
    sky:{day:0xc4d4e6, dusk:0x6f6f8c, night:0x0a1222},      // the horizon
    zenith:{day:0x7fa3cf, dusk:0x3b3f66, night:0x060b18},   // overhead
    sunGlow:0xffdb9e,
    haze:{near:6000, far:46000},                             // fog distances at ground level (m)
    hemi:[0xcfe3ff,0x8a99ad],                                // sky and ground light colours
    precip:{label:"Snowfall", color:0xffffff, size:1.2, opacity:0.9, fall:[9,15], drift:0.6, maxAlt:8000},
  },
};
const merge=(a,b)=>{ const o={...a}; for(const k in b||{}) o[k]=b[k]&&typeof b[k]==="object"&&!Array.isArray(b[k])&&a[k]&&typeof a[k]==="object"?merge(a[k],b[k]):b[k]; return o; };
const col=v=>new THREE.Color(v);

// ------------------------------------------------------------------ a city
const cities=[]; let owner=null;

function define(spec){
  const C=merge(DEFAULTS,spec); C.places=[C.city,...(C.alsoAt||[])];
  const W=C.weather;
  const SKY={day:col(W.sky.day),dusk:col(W.sky.dusk),night:col(W.sky.night)}, ZEN={day:col(W.zenith.day),dusk:col(W.zenith.dusk),night:col(W.zenith.night)};
  const st={C, F:null, FR:null, FRv:-1, built:false, building:false, root:null, inner:null, model:null, FADE:{value:0}, SUNLIT:{value:1}, r:0, g:0, frame:null};

  // Model coordinates: x east, z south, y up (metres), origin on the ground at the city. Read from
  // Quantum's data: the city's saved position, and every surveyed place within reach as a "pin" with
  // its real altitude (outposts, caves, viewpoints) for the terrain to honour. A planet's own terrain
  // (C.anchorAt) has no fixed place: its origin is wherever it was last built round.
  function frameFromData(){
    const B=S.bodyMap[C.body], L=C.anchorAt?C.anchorAt():S.locMap[C.city]; if(!B||!L?.pos) return null;
    const p=L.pos, r=Math.hypot(p[0],p[1],p[2]), up=[p[0]/r,p[1]/r,p[2]/r];
    let east=crs([0,0,1],up); east=Math.hypot(...east)<1e-6?[1,0,0]:nrm(east); const north=crs(up,east);
    const Rb=B.radius+C.alt0, A=up.map(v=>v*Rb);
    const enu=q=>{ const d=[q[0]-p[0],q[1]-p[1],q[2]-p[2]]; return {x:dot3(d,east), z:-dot3(d,north), alt:Math.hypot(q[0],q[1],q[2])-B.radius}; };
    const pins=[], places={};
    for(const o of S.locs){ if(o.body!==C.body||o.kind!=="surface"||!o.pos||o.source!=="db") continue;
      const q=enu(o.pos); if(Math.hypot(q.x,q.z)>C.extent*0.85||q.alt<-100||q.alt>6000) continue;     // orbital markers and the like are out
      places[o.name]=q; if(!C.places.includes(o.name)) pins.push({name:o.name,...q}); }
    return {B,L,up,east,north,Rb,A,pins,places};
  }

  async function build(){
    st.building=true;
    try{
      const F=frameFromData(); if(!F){ st.building=false; return; }
      const tr=loadTerrain(C.body); if(tr.state==="loading") await tr.ready;     // the real heights, if there are any
      const layout=C.world?null:await loadLayout(C.city);                       // the real buildings, if there are any
      const Rb=F.Rb, FADE=st.FADE;
      // the model follows the planet's curve: (x, height, z) on a flat map -> on the sphere
      const curve=(x,y,z)=>{ const s=Math.hypot(x,z); if(s<1e-3) return [x,y,z]; const th=s/Rb, r=Rb+y, k=r*Math.sin(th)/s; return [x*k, r*Math.cos(th)-Rb, z*k]; };
      const toFlat=(x,y,z)=>{ const yy=y+Rb, r=Math.hypot(x,yy,z), sH=Math.hypot(x,z); if(sH<1e-3) return [x,r-Rb,z];
        const s=Math.atan2(sH,yy)*Rb; return [x/sH*s, r-Rb, z/sH*s]; };
      const root=new THREE.Group(); root.visible=false; const inner=new THREE.Group(); root.add(inner);
      inner.matrixAutoUpdate=false;
      { const e=new THREE.Vector3(...F.east), u=new THREE.Vector3(...F.up), sth=new THREE.Vector3(...F.north).negate();
        inner.matrix.makeBasis(e,u,sth).setPosition(F.A[0],F.A[1],F.A[2]); }
      scene.add(root);
      const fade=m=>fadeable(m,FADE,C.edge,st.SUNLIT);

      // Merged geometry, one draw call per material (as Quantum does for its stations). add() takes any
      // geometry with a transform; roofs facing up can go to another material (snow on a roof, say).
      function parts({roof={}}={}){ const P={};
        const at=(x,y,z)=>new THREE.Matrix4().makeTranslation(x,y,z), ry=a=>new THREE.Matrix4().makeRotationY(a), rx=a=>new THREE.Matrix4().makeRotationX(a);
        // add(geo, material, matrix): the geometry's triangles, moved by the matrix, go into that material's
        // batch. Shapes used over and over (box(), cyl()) are made once and only their numbers are copied,
        // which keeps a city of thousands of buildings quick to build.
        const shape=geo=>geo.userData.c3dTri||(geo.userData.c3dTri=(geo.index?geo.toNonIndexed():geo).attributes.position.array.slice());
        function add(geo,mat,m,{shared=false}={}){ const src=shape(geo), e=m.elements;
          if(!shared) geo.dispose();
          const v=new Float32Array(9);
          for(let t=0;t<src.length;t+=9){
            for(let k=0;k<9;k+=3){ const x=src[t+k],y=src[t+k+1],z=src[t+k+2];
              v[k]=e[0]*x+e[4]*y+e[8]*z+e[12]; v[k+1]=e[1]*x+e[5]*y+e[9]*z+e[13]; v[k+2]=e[2]*x+e[6]*y+e[10]*z+e[14]; }
            // the face's normal, as computeVertexNormals would give it for unshared vertices
            const ax=v[3]-v[0], ay=v[4]-v[1], az=v[5]-v[2], bx=v[6]-v[0], by=v[7]-v[1], bz=v[8]-v[2];
            let nx=ay*bz-az*by, ny=az*bx-ax*bz, nz=ax*by-ay*bx; const l=Math.hypot(nx,ny,nz)||1; nx/=l; ny/=l; nz/=l;
            let into=mat; if(roof[mat]&&ny>roof[mat][1]) into=roof[mat][0];
            const o=P[into]||(P[into]={p:[],u:[]});
            for(let k=0;k<9;k+=3){ const x=v[k],y=v[k+1],z=v[k+2]; o.p.push(x,y,z);
              if(Math.abs(ny)>0.6) o.u.push(x/14,z/14); else if(Math.abs(nx)>Math.abs(nz)) o.u.push(z/14,y/21); else o.u.push(x/14,y/21); } } }
        const UNIT_BOX=new THREE.BoxGeometry(1,1,1), CYLS=new Map(), sc=(x,y,z)=>new THREE.Matrix4().makeScale(x,y,z);
        const unitCyl=(rt,rb,seg)=>{ const r=Math.max(rt,rb)||1, k=`${(rt/r).toFixed(2)}|${(rb/r).toFixed(2)}|${seg}`;
          if(!CYLS.has(k)) CYLS.set(k,new THREE.CylinderGeometry(+(rt/r).toFixed(2),+(rb/r).toFixed(2),1,seg)); return [CYLS.get(k),r]; };
        const box=(w,h,d,x,y,z,a=0,mat="facade")=>add(UNIT_BOX,mat,at(x,y+h/2,z).multiply(ry(a)).multiply(sc(w,h,d)),{shared:true});
        const cyl=(rt,rb,h,seg,x,y,z,mat="facade",a=0)=>{ const [g,r]=unitCyl(rt,rb,seg); add(g,mat,at(x,y+h/2,z).multiply(ry(a)).multiply(sc(r,h,r)),{shared:true}); };
        // curve everything onto the planet and add it to the model
        function finish(M,{noShadow=[],order={}}={}){ for(const [k,o] of Object.entries(P)){ const n=o.p.length/3, pos=new Float32Array(o.p.length);
            for(let v=0;v<n;v++){ const c=curve(o.p[v*3],o.p[v*3+1],o.p[v*3+2]); pos[v*3]=c[0]; pos[v*3+1]=c[1]; pos[v*3+2]=c[2]; }
            const g=new THREE.BufferGeometry(); g.setAttribute("position",new THREE.BufferAttribute(pos,3)); g.setAttribute("uv",new THREE.Float32BufferAttribute(o.u,2));
            g.computeVertexNormals(); g.computeBoundingSphere();
            const m=new THREE.Mesh(g,fade(M[k])); m.castShadow=!noShadow.includes(k); m.receiveShadow=M[k].depthWrite!==false; if(order[k]) m.renderOrder=order[k]; inner.add(m); } }
        return {add,box,cyl,finish,at,ry,rx}; }

      // Terrain: a grid that's dense near the city and coarser out to the extent, on the curved surface,
      // with a skirt under its edge. colour(x,z,y,normalY) -> [r,g,b] in 0-1.
      async function terrain(hgt,material,colour,{seg=420}={}){ const SEG=seg, N=SEG+1, EXT=C.extent, map=u=>{ const w=2*u-1, a=Math.abs(w); return Math.sign(w)*EXT*(0.29*a+0.71*a**2.2); };
        const pos=new Float32Array(N*N*3), cl=new Float32Array(N*N*3), idx=[], flat=new Float32Array(N*N*3);
        for(let j=0;j<N;j++){ const z=map(j/SEG); for(let i=0;i<N;i++){ const x=map(i/SEG), k=(j*N+i)*3;
            let y=hgt(x,z); if(i===0||j===0||i===SEG||j===SEG) y=-900;
            flat[k]=x; flat[k+1]=y; flat[k+2]=z; } if(j%40===0) await tick(); }
        for(let j=0;j<SEG;j++) for(let i=0;i<SEG;i++){ const a=j*N+i, b=a+1, c=a+N, d=c+1; idx.push(a,c,b, b,c,d); }
        const g=new THREE.BufferGeometry(); g.setIndex(idx); g.setAttribute("position",new THREE.BufferAttribute(flat,3)); g.computeVertexNormals();
        const nr=g.attributes.normal;
        for(let v=0;v<N*N;v++){ const k=v*3, c3=colour(flat[k],flat[k+2],flat[k+1],nr.getY(v)); cl[k]=c3[0]; cl[k+1]=c3[1]; cl[k+2]=c3[2];
          const c=curve(flat[k],flat[k+1],flat[k+2]); pos[k]=c[0]; pos[k+1]=c[1]; pos[k+2]=c[2]; }
        g.setAttribute("position",new THREE.BufferAttribute(pos,3)); g.setAttribute("color",new THREE.BufferAttribute(cl,3)); g.computeVertexNormals(); g.computeBoundingSphere();
        const m=new THREE.Mesh(g,fade(material)); m.receiveShadow=true; m.castShadow=true; inner.add(m); return m; }

      // Ground height with surveyed places honoured: each pin pulls the ground to its real altitude (a
      // smooth bump or dip round it), and the terrain sinks a little at its outer edge. skip(pin) leaves
      // a pin out (one inside the city footprint, say).
      function pinned(base,skip=()=>false){ const pins=[];
        for(const p of F.pins){ if(skip(p)) continue; const r=(p.alt-C.alt0)-base(p.x,p.z); pins.push({x:p.x,z:p.z,r,s2:Math.max(2200,Math.abs(r)*2.5)**2}); }
        return (x,z)=>{ let h=base(x,z); for(const p of pins){ const d2=(x-p.x)**2+(z-p.z)**2; if(d2<9*p.s2) h+=p.r*Math.exp(-d2/p.s2); }
          const m=Math.max(Math.abs(x),Math.abs(z)), e=1-sstep(0.8*C.extent,0.96*C.extent,m); return h*e-40*(1-e); }; }

      // Real ground heights from a cut-out of the planet's elevation map (equirectangular: column c is
      // longitude lon0+c*dLon, row r latitude lat0-r*dLat, at cell centres; m = heights in metres above
      // the planet's radius, row by row). -> (x,z) => metres above alt0 in the model's frame, smoothly
      // (bicubic) between the cells, or null without a grid. Outside the cut-out it holds the edge.
      function heights(G){
        const smp=G&&G.m?gridSampler({...G,data:typeof G.m==="string"?G.m.trim().split(/[\s,]+/).map(Number):G.m})
          :tr.state==="ok"?tr.sample:null;
        if(!smp) return null;
        const up=F.up, e=F.east, n=F.north, D=180/Math.PI;
        return (x,z)=>{ const d=dirAt(x,z); return smp(Math.asin(Math.max(-1,Math.min(1,d[2])))*D, Math.atan2(d[1],d[0])*D)-C.alt0; }; }
      // the direction from the planet's centre (planet-fixed) under a point of the model
      function dirAt(x,z){ const s=Math.hypot(x,z), up=F.up; if(s<1e-3) return up;
        const th=s/Rb, c=Math.cos(th), k=Math.sin(th)/s, e=F.east, n=F.north;
        return [up[0]*c+(e[0]*x-n[0]*z)*k, up[1]*c+(e[1]*x-n[1]*z)*k, up[2]*c+(e[2]*x-n[2]*z)*k]; }

      const ctx={F, C, inner, curve, fade, litWindows, litLamps, litCity, parts, terrain, pinned, heights, dirAt, layout, tick, fbm, fbm3, sstep, hash, rnd:seeded(C.seed||20251), THREE};
      ctx.gameLayout=opts=>gameLayout(ctx,opts);         // a city drawn from the game's own layout (see above)
      const model=await C.build(ctx);
      inner.traverse(o=>{ if(o.material) fade(o.material); });      // everything the city added fades with it
      // swap in the new model (a planet's terrain is rebuilt as you travel; the old one stays up meanwhile)
      const old=st.root; if(old){ scene.remove(old); old.traverse(o=>{ o.geometry?.dispose?.(); o.material?.dispose?.(); }); }
      root.visible=!!old?.visible; st.root=root; st.inner=inner; st.F=F;
      st.model=model; st.frame={curve,toFlat};
      st.built=true; st.building=false; if(owner===st) ui.views(st);
    } catch(e){ st.building=false; reportErr(C.file||C.city,e); }
  }

  // a point in model coordinates (x, z and its height y), as a place on the planet (planet-fixed)
  function spot(v){ const F=st.F; if(!F) return null;
    const [x,z]=v.t, s=Math.hypot(x,z), th=s/F.Rb, r=F.Rb+v.y, kk=s>1e-3?r*Math.sin(th)/s:1;
    const lx=x*kk, ly=s>1e-3?r*Math.cos(th)-F.Rb:v.y, lz=z*kk;
    return [0,1,2].map(i=>F.A[i]+F.east[i]*lx+F.up[i]*ly-F.north[i]*lz); }
  // fly to a view: {t:[x,z], y, d, yaw, p} in model terms (or the name of one of the city's views)
  function go(k,{dur=null}={}){ const v=typeof k==="string"?st.model?.views?.[k]:k, b=v&&spot(v); if(!b) return;
    if(S.follow) setFollow(false);
    flyTo({kind:"local",body:C.body,pos:b}, v.d, {pitch:v.p, yaw:v.yaw-Math.PI/2, dur, key:"city3d:"+C.city+":"+(typeof k==="string"?k:JSON.stringify(v))}); }
  // put the camera on a view at once, no glide (for moving it along a path frame by frame)
  function aim(v){ const b=spot(v); if(!b) return;
    S.anim=null; if(S.cam.lock) setLock(null);
    S.focus={kind:"local",body:C.body,pos:b}; S.cam.yaw=v.yaw-Math.PI/2; S.cam.pitch=v.p; S.cam.dist=v.d; S.cam.roll=0; }
  function open(place){ const B=S.bodyMap[C.body]; if(!B) return; const view=C.openView?.[place]||"overview";
    if(S.system!==B.system&&typeof setSystem==="function") setSystem(B.system,false);
    if(st.built){ go(view); return; }
    // not built yet: fly down first; the city builds on the way and the view is picked once it's ready
    focusLoc(C.city,true); if(!st.building) build();
    const wait=setInterval(()=>{ if(st.built){ clearInterval(wait); go(view); } else if(!st.building){ clearInterval(wait); } },400); }

  // where the camera is relative to this city, this frame: how much of it to show (r), how much of the
  // ground's sky (g); builds it when you come near
  function measure(t){ st.r=st.g=0; const B=S.bodyMap[C.body];
    if(!B||S.system!==B.system) return;
    const ang=bodyAngle(B,t), c=Math.cos(ang), s=Math.sin(ang), rot=v=>[v[0]*c-v[1]*s, v[0]*s+v[1]*c, v[2]];
    const cam=[O[0]+camera.position.x,O[1]+camera.position.y,O[2]+camera.position.z];
    const camAlt=d3(cam,B.center)-B.radius, look=lookPoint(B,cam);
    if(C.anchorAt){
      // the planet's own terrain: (re)built round the ground you're looking at once you're low enough
      // and have moved far enough from where it was last built
      if(camAlt>C.reveal[0]*1.15) return;
      const lb=[look[0]-B.center[0],look[1]-B.center[1],look[2]-B.center[2]], lr=Math.hypot(...lb);
      const ll=[lb[0]*c+lb[1]*s, -lb[0]*s+lb[1]*c, lb[2]].map(v=>v/lr*B.radius);       // planet-fixed
      const far=!st.F||d3(ll,st.F.up.map(v=>v*B.radius))>C.rebuildDist;
      if(far&&!st.building&&tr0().state!=="missing"){ st.want=ll; build(); }
    } else if(st.FRv!==S.staticVersion){ st.FRv=S.staticVersion; st.FR=st.F||frameFromData(); }   // read once per data load
    const fr=st.F||st.FR; if(!fr) return;
    const upG=rot(fr.up), Ag=rot(fr.A).map((v,i)=>v+B.center[i]);
    const dCity=C.anchorAt?0:d3(cam,Ag), dLook=d3(look,Ag);
    if(!st.built&&!st.building&&dCity<C.buildDist) build();
    st.r=(1-sstep(C.reveal[1],C.reveal[0],camAlt))*(1-sstep(C.revealDist[0],C.revealDist[1],dCity));
    st.g=(1-sstep(C.ground[1],C.ground[0],camAlt))*(1-sstep(C.groundDist[0],C.groundDist[1],dCity));
    Object.assign(st,{B,fr,ang,upG,Ag,camAlt,dCity,dLook}); }
  const tr0=()=>loadTerrain(C.body);
  // where the clock is read: the city, or (for a planet's terrain) the ground it was built round
  const loc=()=>C.anchorAt?(st.F?{kind:"surface",body:C.body,pos:st.F.up.map(v=>v*st.F.B.radius)}:null):S.locMap[C.city];

  Object.assign(st,{SKY,ZEN,W,measure,go,aim,spot,open,build,loc});
  cities.push(st); return st;
}

// What the camera is looking at on a body: the point it orbits when that's on the ground, otherwise the
// ground straight below the camera.
function lookPoint(B,cam){ const T=S.cam?.target;
  if(T&&T.every(Number.isFinite)){ const d=d3(T,B.center); if(d>B.radius*0.9&&d<B.radius+30000) return T; }
  const d=nrm([cam[0]-B.center[0],cam[1]-B.center[1],cam[2]-B.center[2]]); return d.map((v,i)=>B.center[i]+v*B.radius); }

// ------------------------------------------------------------------ a planet's own terrain, anywhere on it
// For a body with a height file: a patch of real ground about 200 km across, built round wherever you
// look once you're below ~160 km and rebuilt as you travel. Its looks (snow, dust, ice seas...) per body.
const WORLD_LOOKS={
  microTech:{ sea:5, weather:{                                       // frozen seas, snow, rock on the steep ground
      sky:{day:0xc4d4e6, dusk:0x6f6f8c, night:0x0a1222}, zenith:{day:0x7fa3cf, dusk:0x3b3f66, night:0x060b18},
      sunGlow:0xffdb9e, hemi:[0xcfe3ff,0x8a99ad], haze:{near:6000, far:46000},
      precip:{label:"Snowfall", color:0xffffff, size:1.2, opacity:0.9, fall:[9,15], drift:0.6, maxAlt:8000} },
    ground:{low:[0.8,0.85,0.92], high:[0.93,0.95,0.98], rock:[0.3,0.33,0.38], sea:[0.86,0.9,0.955]} },
  default:{ sea:null, weather:{
      sky:{day:0xcdbfa8, dusk:0x7a6658, night:0x0d0d14}, zenith:{day:0x8a9cb5, dusk:0x40384f, night:0x05060c},
      sunGlow:0xffd9a0, hemi:[0xe6dccb,0x6e6457], haze:{near:9000, far:70000}, precip:null },
    ground:{low:[0.55,0.5,0.44], high:[0.66,0.63,0.58], rock:[0.36,0.33,0.3], sea:[0.6,0.6,0.62]} },
};
const worlds={};
function worldFor(body){ if(worlds[body]) return worlds[body];
  const look=WORLD_LOOKS[body]||WORLD_LOOKS.default, G=look.ground; let wst=null;
  wst=worlds[body]=define({ city:body, body, file:`terrain/${body}.js`, world:true,
    anchorAt:()=>wst.want?{pos:wst.want}:null, alt0:0, extent:110000, edge:[45000,100000], rebuildDist:28000,
    reveal:[160000,40000], revealDist:[1e12,2e12], groundDist:[1e12,2e12], buildDist:1e12, panelDist:1e12,
    weather:look.weather, note:"Ground from the game's elevation map (a point every few km); finer detail generated.",
    async build({F, terrain, pinned, heights, dirAt, fbm3, sstep, THREE}){
      const REAL=heights(), R=F.B.radius, sea=look.sea; if(!REAL) return {hgt:()=>0};
      const det=(x,z,r)=>{ const d=dirAt(x,z), X=d[0]*R, Y=d[1]*R, Z=d[2]*R, A=40+0.2*Math.min(Math.abs(r-(sea??0)),2600);
        return (fbm3(X/2600+7,Y/2600+3,Z/2600+5)-0.48)*2*A+(fbm3(X/700+1,Y/700+6,Z/700+2,4)-0.48)*0.5*A; };
      const base=(x,z)=>{ const r=REAL(x,z); let h=r+det(x,z,r); if(sea!=null) h=Math.max(h,sea); return h; };
      const hgt=pinned(base);
      const mat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:0.93,metalness:0});
      await terrain(hgt,mat,(x,z,y,ny)=>{ const d=dirAt(x,z), n=fbm3(d[0]*R/900,d[1]*R/900,d[2]*R/900,3);
        const rock=Math.min(1,sstep(0.94,0.76,ny)+sstep(0.985,0.9,ny)*sstep(0.42,0.6,n)*sstep(500,1500,y)), up=sstep(300,2200,y);
        const ice=sea!=null?1-sstep(sea+0.3,sea+3,y):0;
        return [0,1,2].map(i=>{ const g=G.low[i]*(1-up)+G.high[i]*up+0.04*(n-0.5); return (g*(1-rock)+G.rock[i]*rock)*(1-ice)+G.sea[i]*ice; }); },{seg:320});
      return {hgt}; } });
  return wst; }

// ------------------------------------------------------------------ every frame: the nearest city owns the sky
let lastNow=performance.now(), panelT=0, panel=false;
function release(){ if(!owner) return; const st=owner; owner=null;
  if(st.root) st.root.visible=false; st.FADE.value=0;
  precip.visible=false; dome.visible=false; scene.remove(hemi);
  sun.intensity=SUN0; sun.castShadow=false; sun.color.copy(SUNCOL0); if(ambient) ambient.intensity=AMB0;
  scene.fog=null; STARK.value=1; const fx=st.fx; if(fx){ fx.CLOUDK.value=0; fx.ATMOK.value=1; }
  setPanel(false); }
function setPanel(on){ if(panel===on) return; panel=on; ui.show(on?owner:null); if(!on&&S.timeShift) S.timeShift=0; }

function update(t){
  // a planet with real terrain under you: its terrain, built round where you look
  if(terrainIndex) for(const name of terrainIndex){ const B=S.bodyMap[name]; if(!B||B.system!==S.system||worlds[name]) continue;
    if(d3([O[0]+camera.position.x,O[1]+camera.position.y,O[2]+camera.position.z],B.center)-B.radius<400000) worldFor(name); }
  let best=null, world=null;
  for(const st of cities){ try{ st.measure(t); }catch(e){ reportErr(st.C.city,e); } if(!(st.built&&st.r>=0.003)) continue;
    if(st.C.world){ if(!world||st.r>world.r) world=st; } else if(!best||st.r>best.r) best=st; }
  // a city owns the view while you look at it; look away across the planet and its terrain takes over
  if(best&&world&&world.C.body===best.C.body&&best.dLook>best.C.ownDist) best=null;
  if(!best) best=world;
  for(const st of cities) if(st!==best&&st.root) st.root.visible=false;
  if(best!==owner){ release(); if(best){ owner=best; scene.add(hemi); ui.views(best); } }
  if(!owner) return;
  const st=owner, C=st.C, W=st.W, {B,fr,ang,upG,Ag,camAlt,r,g}=st, M=st.model||{};
  st.root.visible=true; st.FADE.value=r;
  setPanel(camAlt<C.panelAlt&&st.dCity<C.panelDist);
  st.root.position.set(B.center[0]-O[0],B.center[1]-O[1],B.center[2]-O[2]); st.root.rotation.set(0,0,ang); st.root.updateMatrixWorld(true);

  // the sun as seen from the city
  const star=sysObjs.find(o=>o.b.kind==="star"); const stp=star?star.b.center:[0,0,0];
  const sunDir=nrm([stp[0]-Ag[0],stp[1]-Ag[1],stp[2]-Ag[2]]), sinEl=dot3(sunDir,upG);
  const day=sstep(-0.06,0.12,sinEl), night=1-day, low=1-sstep(0.05,0.35,sinEl); st.SUNLIT.value=sstep(-0.03,0.06,sinEl);
  // the map's lights blend to the city's as you come down (from orbit the planet keeps its own lighting)
  sun.intensity=SUN0*(1-r+r*day); sun.color.copy(SUNCOL0).lerp(new THREE.Color(1,0.94-0.3*low,0.86-0.5*low),r);
  if(ambient) ambient.intensity=AMB0*(1-r)+(0.12+0.25*day)*r;
  hemi.color.set(W.hemi[0]); hemi.groundColor.set(W.hemi[1]); hemi.intensity=(0.15+0.55*day)*r; hemi.position.set(...upG);
  try{ M.onFrame?.({night, day, sinEl, now:performance.now(), r, g}); }catch(e){ reportErr(C.city,e); }   // window lights, beacons...

  // sky and haze: they thicken smoothly as you come down through the atmosphere
  const skyCol=st.SKY.night.clone().lerp(st.SKY.dusk,sstep(-0.18,0,sinEl)).lerp(st.SKY.day,sstep(0,0.3,sinEl));
  const zenCol=st.ZEN.night.clone().lerp(st.ZEN.dusk,sstep(-0.18,0,sinEl)).lerp(st.ZEN.day,sstep(0,0.3,sinEl));
  const pl=sysObjs.find(o=>o.b.name===C.body);
  if(pl){ st.fx=planetFx(pl); if(pl.grid&&r>0.5) pl.grid.visible=false;
    if(st.fx){ st.fx.CITYP.value.set(...fr.up); st.fx.CLOUDK.value=sstep(0,0.6,r); st.fx.ATMOK.value=1-g; } }
  const bright=sstep(-0.12,0.15,sinEl), du=dome.material.uniforms;
  dome.visible=g>0.002; du.A.value=g*(0.35+0.65*bright);
  du.UP.value.set(...upG); du.SUN.value.set(...sunDir); du.ZEN.value.copy(zenCol); du.HOR.value.copy(skyCol); du.SUNK.value=bright; du.GLOW.value.set(W.sunGlow);
  STARK.value=1-g*(0.25+0.75*bright);
  if(opt.haze&&g>0.002){ fog.color.copy(skyCol); fog.near=W.haze.near+camAlt*0.4; fog.far=fog.near+(W.haze.far+camAlt)/Math.max(g,1e-3); scene.fog=fog; } else scene.fog=null;

  // shadows over what you're looking at
  const sd=nrm([stp[0]-O[0],stp[1]-O[1],stp[2]-O[2]]);
  sun.castShadow=day>0.05&&r>0.95&&S.cam.dist<30000;
  if(sun.castShadow){ sun.position.set(sd[0]*30000,sd[1]*30000,sd[2]*30000); sun.target.position.set(0,0,0); sun.target.updateMatrixWorld();
    const half=Math.min(9000,Math.max(900,S.cam.dist*0.8)), sc=sun.shadow.camera;
    if(sc.right!==half){ sc.left=-half; sc.right=half; sc.top=half; sc.bottom=-half; sc.updateProjectionMatrix(); } }

  // keep the camera above the ground
  if(M.hgt&&r>0.9){ const lp=st.inner.worldToLocal(camera.position.clone()), [fx,fy,fz]=st.frame.toFlat(lp.x,lp.y,lp.z), gh=M.hgt(fx,fz)+12;
    if(fy<gh){ camera.position.addScaledVector(new THREE.Vector3(...upG),gh-fy); camera.lookAt(0,0,0); camera.updateMatrixWorld();
      // and tilt the view up a little, so the next frame starts above the ground too (moving the camera back
      // every frame on its own made it jitter while you turned)
      if(surfaceBodyOf(S.focus)) S.cam.pitch=Math.min(1.55,S.cam.pitch+Math.min(0.04,(gh-fy)/Math.max(S.cam.dist,50))); } }

  // precipitation round the camera, near the ground
  const P=W.precip, now_=performance.now(), dt=Math.min(0.1,(now_-lastNow)/1000); lastNow=now_;
  precip.visible=!!P&&opt.precip&&camAlt<P.maxAlt&&g>0.5&&!reduceMotion();
  if(precip.visible){ const pm=precip.material; pm.color.set(P.color); pm.size=P.size; pm.opacity=P.opacity;
    precip.position.copy(camera.position); precip.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),new THREE.Vector3(...upG));
    const p=pg.attributes.position.array, f0=P.fall[0], f1=P.fall[1]-P.fall[0];
    for(let i=0;i<PRECIP_N;i++){ p[i*3+1]-=dt*(f0+f1*(i%7)/6); p[i*3]+=dt*Math.sin(now_*0.0004+i)*P.drift; if(p[i*3+1]<-300) p[i*3+1]+=600; }
    pg.attributes.position.needsUpdate=true; }

  if(panel&&now_-panelT>200){ panelT=now_; ui.tick(sinEl); }
}

// ------------------------------------------------------------------ the panel on the map
const ui=(()=>{
  const css=document.createElement("style"); css.textContent=`
  .c3d{position:absolute;right:16px;bottom:64px;width:min(300px,calc(100% - 32px));padding:12px 14px;display:flex;flex-direction:column;gap:10px;z-index:6;pointer-events:auto}
  .c3d[hidden]{display:none}
  .c3d .h{display:flex;align-items:baseline;gap:8px}.c3d .h b{font:600 15px var(--display)}.c3d .h .muted{font-size:12px}
  .c3d .h .x{margin-left:auto;background:none;border:0;color:var(--ink-2);font-size:18px;line-height:1;cursor:pointer}
  .c3d .lbl{font:600 10.5px var(--display);letter-spacing:.14em;text-transform:uppercase;color:var(--ink-2)}
  .c3d .clock{display:flex;align-items:baseline;gap:8px}.c3d .clock span.v{font:600 19px var(--display);font-variant-numeric:tabular-nums}
  .c3d .chip{padding:1px 8px;border-radius:10px;border:1px solid rgba(127,231,255,.35);color:#cfe9ff;font-size:11.5px}
  .c3d .chip.pv{border-color:rgba(242,193,78,.6);color:#f2d38a}
  .c3d .sunl{font-size:12px;color:var(--ink-2)}
  .c3d input[type=range]{width:100%;accent-color:var(--route)}
  .c3d .row{display:flex;gap:12px;align-items:center;flex-wrap:wrap;font-size:13px}.c3d .row label{display:flex;gap:6px;align-items:center;cursor:pointer}
  .c3d .views{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px}
  .c3d .views button{font:500 12px var(--text,inherit);color:var(--ink);background:rgba(75,141,255,.08);border:1px solid var(--line-2);border-radius:7px;padding:6px 2px;cursor:pointer}
  .c3d .views button:hover{border-color:rgba(127,231,255,.5)}
  .c3d .note{font-size:11.5px;color:var(--dim)}`;
  document.head.appendChild(css);
  const el=document.createElement("div"); el.className="card c3d"; el.id="city3d"; el.hidden=true;
  el.innerHTML=`<div class="h"><b id="c3d-name">City</b><span class="muted" id="c3d-kind">3D city</span><button class="x" id="c3d-x" title="Fly back up" aria-label="Fly back up">×</button></div>
    <div><div class="lbl">Local time</div><div class="clock"><span class="v" id="c3d-clock">–</span><span class="chip" id="c3d-mode">Live</span></div></div>
    <input type="range" id="c3d-t" min="0" max="24" step="0.05" aria-label="Preview another time of day">
    <div class="sunl" id="c3d-sun"></div>
    <div class="row"><label id="c3d-precip-l"><input type="checkbox" id="c3d-precip" checked> <span>Snowfall</span></label><label><input type="checkbox" id="c3d-haze" checked> Haze</label>
      <button class="btn small" id="c3d-live" hidden>Back to live</button></div>
    <div class="views" id="c3d-views"></div>
    <div class="note" id="c3d-note"></div>`;
  ($("mapwrap")||document.body).appendChild(el);
  const q=s=>el.querySelector(s);
  let cur=null, dragging=false, lastSin=0;
  const slider=q("#c3d-t");
  slider.addEventListener("pointerdown",()=>dragging=true); window.addEventListener("pointerup",()=>dragging=false);
  slider.addEventListener("input",()=>{ if(!cur) return; const L=cur.loc(), B=S.bodyMap[cur.C.body]; if(!L||!B) return;
    const live=localTime(L,now()); if(!live) return;
    const dh=((+slider.value-live.h)%24+36)%24-12;                                    // shortest way round the clock
    S.timeShift=dh/24*B.period*3600; tick(); });
  q("#c3d-live").onclick=()=>{ S.timeShift=0; tick(); };
  q("#c3d-precip").onchange=e=>opt.precip=e.target.checked;
  q("#c3d-haze").onchange=e=>opt.haze=e.target.checked;
  q("#c3d-x").onclick=()=>{ if(!cur) return; if(cur.C.world) focusBody(cur.C.body); else focusLoc(cur.C.city,false); };
  q("#c3d-views").onclick=e=>{ const b=e.target.closest("[data-v]"); if(b&&cur) cur.go(b.dataset.v); };
  function tick(sinEl){ if(sinEl!=null) lastSin=sinEl; if(!cur) return; const L=cur.loc(); if(!L) return;
    const shift=S.timeShift||0, lt=localTime(L,now()+shift); if(!lt) return;
    q("#c3d-clock").textContent=`${lt.day?"☀":"☾"} ${fmtClock(lt.h)}`;
    const m=q("#c3d-mode"); m.textContent=shift?"Preview":"Live"; m.classList.toggle("pv",!!shift);
    q("#c3d-live").hidden=!shift;
    if(!dragging) slider.value=lt.h.toFixed(2);
    const e=Math.round(Math.asin(Math.max(-1,Math.min(1,lastSin)))*180/Math.PI);
    q("#c3d-sun").textContent=`Sun ${Math.abs(e)}° ${e>=0?"up":"below the horizon"}${lt.polar?"":` · ${lt.day?"sunset":"sunrise"} in ~${fmtMins(lt.mins)}`}${shift?` · live: ${fmtClock(localTime(L,now()).h)}`:""}`; }
  function views(st){ if(st!==cur&&st!==owner) return; const v=st?.model?.views;
    q("#c3d-views").innerHTML=v?Object.entries(v).map(([k,x])=>`<button data-v="${k}">${esc(x.label)}</button>`).join(""):""; }
  function show(st){ cur=st; el.hidden=!st; if(!st) return;
    q("#c3d-name").textContent=st.C.city; q("#c3d-kind").textContent=st.C.world?"3D terrain":"3D city"; q("#c3d-note").textContent=st.C.note||"";
    const P=st.W.precip; q("#c3d-precip-l").hidden=!P; if(P) q("#c3d-precip-l span").textContent=P.label;
    views(st); tick(); }
  return {show,tick,views};
})();

// ------------------------------------------------------------------ getting a city ready ahead of time
// Everything that would otherwise happen on the way down (and make the glide stutter): the city's model
// and its close-up versions, the planet's ground round it, the shaders for the city's light and haze,
// and its geometry sent to the graphics card. Used by the demo, behind its title card.
const until=(ok,ms=90000)=>new Promise(r=>{ const t0=performance.now(), f=()=>ok()||performance.now()-t0>ms?r():setTimeout(f,150); f(); });
const prepared={};
function prepare(name){
  return prepared[name]||(prepared[name]=(async()=>{
    const st=cities.find(c=>!c.C.world&&c.C.city===name); if(!st) return null;
    const B=S.bodyMap[st.C.body], L=S.locMap[st.C.city];
    if(!st.built){ if(!st.building) st.build(); await until(()=>st.built||!st.building); }
    if(!st.built) return null;
    if(st.model?.ready) await Promise.race([st.model.ready, new Promise(r=>setTimeout(r,60000))]);
    // the planet's own ground, built round the city (as it would be once you're looking at it)
    if(B&&L?.pos&&terrainIndex?.includes(B.name)){ const w=worldFor(B.name);
      if(!w.built&&!w.building){ const r=Math.hypot(...L.pos); w.want=L.pos.map(v=>v/r*B.radius); w.build(); }
      await until(()=>w.built||!w.building); }
    warm(); return st; })());
}
// Compile every city's shaders for how they'll be drawn (sky light, haze, sun shadows on and off) and
// upload their geometry, by drawing them once now. The screen is covered (the demo's title card) while
// this runs; the next frame draws over it.
function warm(){
  const shown=[], culled=[], fog0=scene.fog, hadHemi=!!hemi.parent, sh=sun.castShadow;
  for(const st of cities) if(st.root){ shown.push([st.root,st.root.visible]); st.root.visible=true;
    st.root.traverse(o=>{ if(o.isMesh&&o.frustumCulled){ o.frustumCulled=false; culled.push(o); } }); }
  try{ scene.fog=fog; if(!hadHemi) scene.add(hemi);
    for(const s of [false,true]){ sun.castShadow=s; renderer.compile(scene,camera); renderer.render(scene,camera); } }
  catch(e){ console.warn("3D city warm-up",e); }
  finally{ scene.fog=fog0; if(!hadHemi) scene.remove(hemi); sun.castShadow=sh;
    for(const [r,v] of shown) r.visible=v; for(const o of culled) o.frustumCulled=true; }
}

// ------------------------------------------------------------------ hook up with the map
// One entry in index.html's 3D-city registry stands for all of them.
const cityNamed=name=>cities.find(c=>!c.C.world&&c.C.city===name);
window.City3D={define, get cities(){ return cities.map(c=>c.C.city); }, prepare,
  model:name=>cityNamed(name)?.model||null,                  // what the city's file returned (views, tour...)
  go:(name,v,o)=>cityNamed(name)?.go(v,o), aim:(name,v)=>cityNamed(name)?.aim(v)};
const forPlace=name=>cities.find(st=>!st.C.world&&st.C.places.includes(name));
window.registerCity3D({name:"3D cities", update,
  has:name=>!!forPlace(name), titleFor:name=>forPlace(name)?.C.city, open:name=>forPlace(name)?.open(name),
  get active(){ return panel; }});
})();
