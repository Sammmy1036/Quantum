// Quantum UI: The 3D map: three.js scene, sky, planets, stations, camera, projection, overlay drawing, the frame loop and input.
// One of several classic scripts sharing one global scope; index.html loads them in order.
"use strict";
// =================================================================== three.js scene
const glc=$("gl"), ovc=$("overlay"), ctx=ovc.getContext("2d");
const renderer=new THREE.WebGLRenderer({canvas:glc, antialias:true, logarithmicDepthBuffer:true});
renderer.setClearColor(0x02050b);
const scene=new THREE.Scene();
const camera=new THREE.PerspectiveCamera(50,1,0.5,1e14); camera.up.set(0,0,1);
scene.add(new THREE.AmbientLight(0x4a5a80,1.0));   // keep night sides readable
const sun=new THREE.DirectionalLight(0xfff0dc,2.4); scene.add(sun); scene.add(sun.target);
let W=0,H=0,DPR=1, O=[0,0,0];    // O = floating origin (world meters), everything is drawn relative to it
function resize(){ const r=$("mapwrap").getBoundingClientRect(); W=r.width; H=r.height; DPR=window.devicePixelRatio||1;
  renderer.setPixelRatio(DPR); renderer.setSize(W,H,false); camera.aspect=W/H; camera.updateProjectionMatrix();
  ovc.width=Math.round(W*DPR); ovc.height=Math.round(H*DPR); ctx.setTransform(DPR,0,0,DPR,0,0); }
window.addEventListener("resize",resize);

// =================================================================== sky
// What's behind the map, in the spirit of the in-game starmap: a galaxy backdrop (nebula clouds and the
// Milky Way band with its dust lanes) and a field of stars that crowd along that band, each with a star's
// own colour. The backdrop is noise worked out on the GPU once per system and kept in a cube map, so after
// that it costs nothing a frame. Each system has its own colours. Layers > Galaxy background turns it off.
const SKY_LOOK={
  Stanton:{a:[0.006,0.035,0.16], b:[0.09,0.012,0.15], c:[0.0,0.10,0.14], band:[0.50,0.58,0.80], tilt:[0.32,-0.18,0.93], seed:1.37},
  Pyro:   {a:[0.20,0.022,0.004], b:[0.22,0.075,0.006], c:[0.09,0.006,0.035], band:[0.80,0.52,0.36], tilt:[-0.25,0.40,0.88], seed:4.71},
  Nyx:    {a:[0.07,0.012,0.17], b:[0.012,0.05,0.17], c:[0.15,0.012,0.12], band:[0.60,0.50,0.85], tilt:[0.45,0.30,0.84], seed:8.09}};
const NOISE_GLSL=`
  vec3 h3(vec3 p){ p=vec3(dot(p,vec3(127.1,311.7,74.7)),dot(p,vec3(269.5,183.3,246.1)),dot(p,vec3(113.5,271.9,124.6))); return -1.0+2.0*fract(sin(p)*43758.5453123); }
  float noise(vec3 p){ vec3 i=floor(p), f=fract(p), u=f*f*(3.0-2.0*f);
    return mix(mix(mix(dot(h3(i),f),dot(h3(i+vec3(1,0,0)),f-vec3(1,0,0)),u.x),mix(dot(h3(i+vec3(0,1,0)),f-vec3(0,1,0)),dot(h3(i+vec3(1,1,0)),f-vec3(1,1,0)),u.x),u.y),
               mix(mix(dot(h3(i+vec3(0,0,1)),f-vec3(0,0,1)),dot(h3(i+vec3(1,0,1)),f-vec3(1,0,1)),u.x),mix(dot(h3(i+vec3(0,1,1)),f-vec3(0,1,1)),dot(h3(i+vec3(1,1,1)),f-vec3(1,1,1)),u.x),u.y),u.z); }
  float fbm(vec3 p){ float v=0.0, a=0.5; for(int i=0;i<6;i++){ v+=a*noise(p); p=p*2.03+vec3(1.7,9.2,3.1); a*=0.5; } return v; }`;
const sky=(()=>{
  const rt=new THREE.WebGLCubeRenderTarget(1536,{generateMipmaps:true,minFilter:THREE.LinearMipmapLinearFilter});
  const cam=new THREE.CubeCamera(0.1,100,rt), sc=new THREE.Scene();
  const mat=new THREE.ShaderMaterial({side:THREE.BackSide, depthTest:false, depthWrite:false,
    uniforms:{A:{value:new THREE.Vector3()},B:{value:new THREE.Vector3()},C:{value:new THREE.Vector3()},BAND:{value:new THREE.Vector3()},TILT:{value:new THREE.Vector3(0,0,1)},SEED:{value:0}},
    vertexShader:`varying vec3 vDir; void main(){ vDir=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader:`varying vec3 vDir; uniform vec3 A,B,C,BAND,TILT; uniform float SEED;${NOISE_GLSL}
      void main(){ vec3 d=normalize(vDir), s=vec3(SEED,SEED*1.7,SEED*0.6);
        float h=dot(d,normalize(TILT));                                   // distance from the galactic plane
        float warp=fbm(d*2.2+s)*0.35;
        float band=exp(-pow((h+warp*0.6)/0.20,2.0));                       // the Milky Way
        float core=exp(-pow((h+warp*0.5)/0.07,2.0));
        float dust=smoothstep(0.05,0.55,fbm(d*7.0+s*2.0+warp*2.0));        // dark lanes through the band
        float grain=pow(max(0.0,fbm(d*42.0+s)),1.5);                       // unresolved stars along it
        float n1=fbm(d*1.6+s+warp), n2=fbm(d*3.1-s*1.3), n3=fbm(d*5.4+s*0.4);
        float neb=pow(smoothstep(0.0,0.55,n1),1.8)*0.9+pow(smoothstep(0.12,0.6,n2),2.0)*0.45;  // nebula clouds, dark gaps between
        vec3 col=mix(A,B,smoothstep(-0.2,0.4,n2)); col=mix(col,C,smoothstep(0.1,0.5,n3));
        vec3 c=col*neb*(0.6+1.1*band);
        c+=BAND*(band*0.07+core*0.13)*(1.0-dust*0.9);
        c+=BAND*grain*band*0.22*(1.0-dust*0.75);
        c+=(fract(sin(dot(d.xy*917.0+d.z,vec2(12.9898,78.233)))*43758.5453)-0.5)/255.0;  // dither: no banding
        gl_FragColor=vec4(max(c,0.0),1.0); }`});
  sc.add(new THREE.Mesh(new THREE.SphereGeometry(10,64,32),mat));
  const v3=a=>new THREE.Vector3(...a);
  return { texture:rt.texture, bake(sys){ const L=SKY_LOOK[sys]||SKY_LOOK.Stanton, u=mat.uniforms;
      u.A.value=v3(L.a); u.B.value=v3(L.b); u.C.value=v3(L.c); u.BAND.value=v3(L.band); u.TILT.value=v3(L.tilt); u.SEED.value=L.seed;
      cam.update(renderer,sc); this.tilt=L.tilt; } };
})();

// The stars: a fixed sphere of points that travels with the camera. Most are faint pinpricks; they
// crowd toward the galactic band, take a real star's colour (blue-white to red), and the brightest
// few get a soft glow and twinkle a little.
const STAR_COLORS=[[0.66,0.76,1.0,0.10],[0.84,0.89,1.0,0.22],[1.0,0.98,0.95,0.30],[1.0,0.92,0.78,0.20],[1.0,0.78,0.58,0.12],[1.0,0.62,0.48,0.06]];
const starfield=(()=>{ const n=22000, R=1e12, pos=new Float32Array(n*3), col=new Float32Array(n*3), size=new Float32Array(n), ph=new Float32Array(n); let seed=7;
  const rnd=()=>{ seed=(seed*16807)%2147483647; return seed/2147483647; };
  for(let i=0;i<n;i++){
    let x,y,z; const u=rnd()*2-1, th=rnd()*Math.PI*2, r=Math.sqrt(1-u*u); x=r*Math.cos(th); y=r*Math.sin(th); z=u;
    if(rnd()<0.6){ z=(rnd()+rnd()+rnd()-1.5)*0.17; const l=Math.hypot(x,y,z); x/=l; y/=l; z/=l; }   // into the band (tilted later)
    pos.set([x*R,y*R,z*R],i*3);
    let pick=rnd(), c=STAR_COLORS[0]; for(const sc of STAR_COLORS){ if((pick-=sc[3])<=0){ c=sc; break; } }
    const m=Math.pow(rnd(),9), b=0.28+0.72*Math.pow(rnd(),2.2);                // most faint, a few bright
    col.set([c[0]*b,c[1]*b,c[2]*b],i*3); size[i]=1.15+m*7.0+b*1.0; ph[i]=rnd()*6.283; }
  const g=new THREE.BufferGeometry(); g.setAttribute("position",new THREE.BufferAttribute(pos,3)); g.setAttribute("color",new THREE.BufferAttribute(col,3));
  g.setAttribute("size",new THREE.BufferAttribute(size,1)); g.setAttribute("phase",new THREE.BufferAttribute(ph,1));
  const mat=new THREE.ShaderMaterial({transparent:true, depthWrite:false, blending:THREE.AdditiveBlending, uniforms:{T:{value:0},PR:{value:1}},
    vertexShader:`#include <common>
      #include <logdepthbuf_pars_vertex>
      attribute float size; attribute float phase; attribute vec3 color; uniform float T,PR; varying vec3 vC; varying float vS;
      void main(){ float tw=size>3.0?0.82+0.18*sin(T*(1.3+fract(phase)*1.7)+phase*7.0):1.0; vC=color*tw; vS=size;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); gl_PointSize=size*PR;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader:`#include <common>
      #include <logdepthbuf_pars_fragment>
      varying vec3 vC; varying float vS;
      void main(){
        #include <logdepthbuf_fragment>
        float d=length(gl_PointCoord-0.5)*2.0; if(d>1.0) discard;
        float core=exp(-d*d*(vS>3.0?14.0:5.0)), halo=vS>3.0?exp(-d*3.2)*0.35:0.0;
        gl_FragColor=vec4(vC*(core+halo),1.0); }`});
  const p=new THREE.Points(g,mat); p.frustumCulled=false; p.renderOrder=-5; scene.add(p); return p; })();
function setSky(sys){
  sky.bake(sys);
  // Lay the stars' band along the backdrop's Milky Way: their crowded plane (z) turned to its tilt
  const t=new THREE.Vector3(...sky.tilt).normalize(); starfield.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),t);
  scene.background=S.show.sky?sky.texture:null; }

// The sun: a moving surface (granulation, limb darkening) under a layered corona, and a glare that stays
// visible however far out you zoom, like the in-game starmap.
const SUN_GLSL_V=`#include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec3 vN, vV, vP;
  void main(){ vP=normalize(position); vec4 mv=modelViewMatrix*vec4(position,1.0); vN=normalize(normalMatrix*normal); vV=normalize(-mv.xyz);
    gl_Position=projectionMatrix*mv;
    #include <logdepthbuf_vertex>
  }`;
function sunMaterial(hue){
  const base=new THREE.Color(`hsl(${hue-10},100%,50%)`), hot=new THREE.Color(`hsl(${hue+14},100%,90%)`);
  return new THREE.ShaderMaterial({uniforms:{T:{value:0},BASE:{value:base},HOT:{value:hot}}, vertexShader:SUN_GLSL_V,
    fragmentShader:`#include <common>
      #include <logdepthbuf_pars_fragment>
      varying vec3 vN, vV, vP; uniform float T; uniform vec3 BASE, HOT;${NOISE_GLSL}
      void main(){
        #include <logdepthbuf_fragment>
        float mu=clamp(dot(normalize(vN),normalize(vV)),0.0,1.0);
        float g=fbm(vP*9.0+vec3(0.0,0.0,T*0.05))*0.5+0.5, cells=fbm(vP*26.0-vec3(T*0.08))*0.5+0.5;
        float spots=smoothstep(0.62,0.72,fbm(vP*3.5+vec3(T*0.01)));
        vec3 c=mix(BASE,HOT,pow(mu,0.9)*0.75+g*0.4)*(0.62+cells*0.7);
        c*=(0.42+0.58*pow(mu,0.45))*(1.0-spots*0.35);                      // darker toward the edge
        gl_FragColor=vec4(c*1.25,1.0); }`});
}
function coronaTexture(rgb){ const N=512, c=document.createElement("canvas"); c.width=c.height=N; const x=c.getContext("2d");
  const g=x.createRadialGradient(N/2,N/2,0,N/2,N/2,N/2);
  g.addColorStop(0,`rgba(${rgb},1)`); g.addColorStop(0.08,`rgba(${rgb},.85)`); g.addColorStop(0.2,`rgba(${rgb},.32)`); g.addColorStop(0.45,`rgba(${rgb},.08)`); g.addColorStop(1,"rgba(0,0,0,0)");
  x.fillStyle=g; x.fillRect(0,0,N,N);
  x.globalCompositeOperation="lighter"; const rnd=seededRand("corona"+rgb);           // faint streamers
  for(let i=0;i<70;i++){ const a=rnd()*Math.PI*2, len=N*(0.16+rnd()*0.3), w=0.6+rnd()*2;
    const lg=x.createLinearGradient(N/2,N/2,N/2+Math.cos(a)*len,N/2+Math.sin(a)*len); lg.addColorStop(0,`rgba(${rgb},${0.05+rnd()*0.08})`); lg.addColorStop(1,"rgba(0,0,0,0)");
    x.strokeStyle=lg; x.lineWidth=w; x.beginPath(); x.moveTo(N/2,N/2); x.lineTo(N/2+Math.cos(a)*len,N/2+Math.sin(a)*len); x.stroke(); }
  const t=new THREE.CanvasTexture(c); t.colorSpace=THREE.SRGBColorSpace; return t; }

// =================================================================== planets
// Planets with a look of their own, drawn on the GPU and matched to how they look from orbit in game
// (Alpha 4.3): the surface is worked out from noise in the planet's own frame, so it turns with the planet;
// it's lit from where the star really is, seen through the planet's own hazy atmosphere, with a glowing
// rim, puffy clouds that cast light and shade, and the lights of its real cities on the night side (placed
// at their real positions, so they're dark or lit exactly when they are in game). Planets not listed keep
// the simpler painted look.
//   haze: how much of the surface the atmosphere veils (0-1), hazeCol its colour; atmo: the rim's colour
const PLANET_LOOK={
  ArcCorp:   {type:1, atmo:[0.55,0.90,0.88], haze:0.36, hazeCol:[0.62,0.78,0.76], clouds:0.17, cloudCol:[0.84,0.93,0.91], cityR:0.07, seed:2.1},
  Hurston:   {type:2, atmo:[0.78,0.93,0.90], haze:0.52, hazeCol:[0.80,0.86,0.83], clouds:0.24, cloudCol:[0.92,0.90,0.83], cityR:0.08, seed:5.3},
  Crusader:  {type:3, atmo:[0.55,0.85,0.95], haze:0.18, hazeCol:[0.86,0.92,0.95], clouds:0.0,  cloudCol:[1,1,1],          cityR:0.012, seed:7.7},
  microTech: {type:4, atmo:[0.62,0.80,1.00], haze:0.14, hazeCol:[0.85,0.90,1.00], clouds:0.16, cloudCol:[0.97,0.98,1.00], cityR:0.06, seed:3.9},
  // terraformed (oxygen-nitrogen air, oceans, cloud cover in the game's files); its colours are the game's own
  // map (ui/planets/Nyx I.js), the type only shows until that has loaded
  "Nyx I":   {type:2, atmo:[0.52,0.76,1.00], haze:0.16, hazeCol:[0.80,0.88,0.96], clouds:0.20, cloudCol:[0.95,0.96,0.97], cityR:0.0, seed:6.4}};
const PLANET_MATS=[];          // their materials, for the sun's position and time each frame
const PLANET_V=`#include <common>
  #include <logdepthbuf_pars_vertex>
  uniform vec3 SUN; varying vec3 vP, vW, vN, vL;
  void main(){ vP=normalize(position); vec4 w=modelMatrix*vec4(position,1.0); vW=w.xyz; vN=normalize(mat3(modelMatrix)*normal);
    vL=normalize(transpose(mat3(modelMatrix))*(SUN-w.xyz));            // toward the sun, in the planet's own frame
    gl_Position=projectionMatrix*viewMatrix*w;
    #include <logdepthbuf_vertex>
  }`;
const PLANET_F=`#include <common>
  #include <logdepthbuf_pars_fragment>
  varying vec3 vP, vW, vN, vL; uniform vec3 SUN, ATMO, HAZEC; uniform float T, SEED, HAZE, CITYR; uniform int TYPE;
  uniform sampler2D CLT0, CLT1; uniform vec4 CLD[2]; uniform vec4 CLE[2]; uniform sampler2D MAP; uniform float HASMAP; uniform vec2 MAPOFF;${NOISE_GLSL}
  // The game's own colour map of the planet (ui/planets/<Body>.js): longitude 0 at the left, north at the
  // top. Read with the derivatives of whichever of two longitude ranges is smooth here, so the line where
  // the map's ends meet doesn't show.
  vec3 mapColor(vec3 p){
    float lon=atan(p.y,p.x)/6.28318531, v=asin(clamp(p.z,-1.0,1.0))/3.14159265+0.5+MAPOFF.y;
    float u1=fract(lon+MAPOFF.x), u2=fract(lon+MAPOFF.x+0.5)-0.5;
    vec2 a1=vec2(dFdx(u1),dFdy(u1)), a2=vec2(dFdx(u2),dFdy(u2)); bool b=dot(a2,a2)<dot(a1,a1);
    vec2 a=b?a2:a1; return textureGrad(MAP,vec2(b?u2:u1,v),vec2(a.x,dFdx(v)),vec2(a.y,dFdy(v))).rgb; }
  float h1(vec3 p){ return fract(sin(dot(p,vec3(12.9898,78.233,37.719)))*43758.5453); }
  float ridge(vec3 p){ return 1.0-abs(fbm(p)*2.0); }
  // Lights scattered like a city seen from orbit: many small points in clusters. Up close they're points;
  // once they're too small on screen they blend into their average glow (no flicker).
  float speckle(vec3 p, float k, float th){ float f=1.0-smoothstep(0.25,0.9,length(fwidth(p*k)));
    return mix(1.0-th, step(th,h1(floor(p*k))), f); }
  // Round points of light, one at a random spot in some of the cells; fade to their average glow when a
  // cell gets smaller than a couple of pixels
  float dots(vec3 p, float k, float th){ vec3 q=p*k, c=floor(q), f=fract(q); float h=h1(c);
    vec3 o=vec3(h1(c+1.3),h1(c+2.7),h1(c+5.1))*0.5+0.25; float pix=length(fwidth(q));
    float r=max(0.16,pix*0.9), d=step(th,h)*smoothstep(r,r*0.35,length(f-o))*(0.6+0.8*h1(c+9.7));
    return mix((1.0-th)*0.08,d,1.0-smoothstep(0.35,0.7,pix)); }
  // A city's night lights, from its real buildings (ui/citylights/<City>.js): t holds how much is built at
  // each spot (about 65 m a texel); d = the city's direction (planet-local), d.w = planet radius / the grid's
  // size; e = east there, e.w = planet radius / 45 m.
  // Like the game seen from above: crisp separate points, not lit blocks. Windows in clusters over the
  // buildings, rows of street lamps along the roads, and an even scatter of lamps over the ground between
  // the districts. Each point decides once (at its own spot) whether it's lit, so points never get cut by a
  // building's edge, and points stay about a pixel or two across: further out, the lattice gets coarser
  // (fewer, merged lights) instead of smearing into a glow. From orbit they become the city's soft glow.
  // -> the light's colour (linear)
  float hash12(vec2 p){ vec3 p3=fract(vec3(p.xyx)*0.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
  // One lattice of possible lights: spacing S metres, jitter j (0 = a perfect grid). kind 0 windows,
  // 1 road lamps, 2 lamps between districts. pm = metres per pixel. -> (brightness, colour pick)
  vec2 lampLattice(sampler2D t, vec2 x, float size, float S, float j, float pm, int kind, float salt){
    vec2 q=x/S, c=floor(q), f=fract(q);
    vec2 o=0.5+(vec2(hash12(c+salt),hash12(c+salt+17.13))-0.5)*j;
    vec2 puv=(c+o)*S/size+0.5;                                   // where this cell's light stands
    float Lp=textureLod(t,puv,0.0).r, p;
    if(kind==0){ vec2 bl=floor(puv*vec2(textureSize(t,0))/2.0);   // windows: busier buildings, more of them,
      p=smoothstep(0.035,0.30,Lp)*0.3*(0.2+1.3*hash12(bl+salt)); } // and some blocks lit up more than others
    else if(kind==1){ float Lr=textureLod(t,puv,1.0).r, L3=textureLod(t,puv,3.0).r, Lb=textureLod(t,puv,4.0).r;
      // A road: a line one texel wide. Blurring a line 4x thins it about 4x; a lone building (a blob)
      // thins far more, a district hardly at all. So lamps only where it thins like a line, near this
      // lamp's own spot, with not much built around.
      float k=Lr/max(L3,1e-4), line=smoothstep(1.4,2.2,k)*(1.0-smoothstep(9.0,13.0,k));
      p=smoothstep(0.006,0.02,Lr)*line*(1.0-smoothstep(0.022,0.045,Lb))*0.95; }
    else { float area=textureLod(t,puv,6.0).r;                   // inside the city, between the buildings
      p=0.32*smoothstep(0.02,0.08,area)*(1.0-smoothstep(0.015,0.06,Lp)); }
    float h=hash12(c+salt+5.71); if(h>=p) return vec2(0.0);
    float dpx=length((f-o)*S)/pm;                                  // distance from the light, in pixels
    float b=(0.55+0.9*hash12(c+salt+9.3))*(kind==0?0.5:1.0);
    return vec2(b*(exp(-dpx*dpx/1.1)+0.10*exp(-dpx*dpx/9.0)), hash12(c+salt+3.3)); }
  // The lattice at the right coarseness for this distance: cells at least ~4 pixels, the two nearest
  // coarseness levels crossfaded so nothing pops while you zoom.
  vec2 lampLevels(sampler2D t, vec2 x, float size, float s, float j, float pm, float minPx, int kind, float salt){
    float lv=max(0.0,log2(minPx*pm/s)), k=floor(lv), w=lv-k;
    vec2 a=lampLattice(t,x,size,s*exp2(k),j,pm,kind,salt+k*31.0), b=lampLattice(t,x,size,s*exp2(k+1.0),j,pm,kind,salt+(k+1.0)*31.0);
    return vec2(mix(a.x,b.x,smoothstep(0.0,1.0,w)), a.x>b.x?a.y:b.y); }
  vec3 cityLights(sampler2D t, vec4 d, vec4 e){
    if(d.w<=0.0) return vec3(0.0); float c=dot(vP,d.xyz); if(c<0.9) return vec3(0.0);
    vec3 n=cross(d.xyz,e.xyz); vec2 uv=vec2(0.5+dot(vP,e.xyz)/c*d.w, 0.5-dot(vP,n)/c*d.w);
    if(any(lessThan(uv,vec2(0.0)))||any(greaterThan(uv,vec2(1.0)))) return vec3(0.0);
    if(textureLod(t,uv,7.0).r<0.002) return vec3(0.0);            // nowhere near the city
    float size=45.0*e.w/d.w;                                         // the grid's size in metres
    vec2 x=(uv-0.5)*size; float pm=max(length(fwidth(x)),0.05);
    vec2 w=lampLevels(t,x,size,22.0,0.75,pm,2.6,0,0.0);                  // windows
    vec2 r=lampLevels(t,x,size,40.0,0.12,pm,8.0,1,101.0);               // road lamps, evenly spaced
    vec2 s=lampLevels(t,x,size,360.0,0.45,pm,11.0,2,211.0);              // lamps between the districts
    vec3 cream=vec3(1.0,0.86,0.64), white=vec3(0.92,0.95,1.0), cyan=vec3(0.35,0.85,1.0), red=vec3(1.0,0.28,0.2);
    vec3 wc=w.y<0.03?cyan:w.y<0.045?red:w.y<0.4?white:cream;         // the odd sign or beacon among the windows
    vec3 col=wc*w.x*1.5+cream*r.x*1.3+mix(cream,white,s.y)*s.x*1.2;
    // The buildings themselves, faintly lit: the districts' shapes show between their lights
    float Lf=textureLod(t,uv,max(0.0,log2(pm/65.0))).r;
    col+=vec3(0.75,0.70,0.62)*Lf*0.10;
    // From far off the points are too few to show the city: its soft glow takes over.
    float far=smoothstep(40.0,300.0,pm), g=textureLod(t,uv,clamp(log2(pm/65.0),0.0,8.0)).r;
    col+=cream*g*g*far*2.2;
    return col; }
  // ArcCorp: rose-grey city crust under a teal haze, the whole planet built up, lights everywhere at night
  vec3 arccorp(vec3 p, out float lights){ vec3 s=vec3(SEED);
    float big=fbm(p*1.8+s), mid=fbm(p*6.0-s), fine=fbm(p*40.0+s), grain=fbm(p*160.0);
    vec3 col=mix(vec3(0.60,0.48,0.51),vec3(0.70,0.57,0.57),smoothstep(-0.3,0.3,big));
    col=mix(col,vec3(0.48,0.40,0.45),smoothstep(0.05,0.4,mid)*0.55);
    col=mix(col,vec3(0.70,0.62,0.58),smoothstep(0.2,0.5,fbm(p*14.0+s*2.0))*0.4);
    col*=0.86+0.16*fine+0.14*grain;
    float cluster=0.3+0.7*smoothstep(-0.25,0.35,fbm(p*9.0+s*1.3))*(0.5+0.5*smoothstep(-0.2,0.3,fbm(p*3.0-s)));
    lights=cluster*(dots(p,95.0,0.72)*1.8+dots(p,230.0,0.70)*1.2);
    return col; }
  // Hurston: maroon, rose and ochre ground, dark patches, and a glowing molten industrial zone
  vec3 hurston(vec3 p, out vec3 em){ vec3 s=vec3(SEED);
    float w=fbm(p*1.6+s)*0.7, n=fbm(p*2.6+s+w), d=fbm(p*8.0-s+w*2.0), e=fbm(p*30.0+w*3.0);
    vec3 col=mix(vec3(0.46,0.28,0.30),vec3(0.60,0.42,0.33),smoothstep(-0.3,0.3,n));
    col=mix(col,vec3(0.66,0.50,0.34),smoothstep(0.15,0.45,d)*0.55);                           // ochre
    col=mix(col,vec3(0.26,0.17,0.19),smoothstep(0.25,0.5,fbm(p*4.5-s*1.7+w))*0.6);           // dark ground
    col*=0.85+0.25*(e*0.5+0.5);
    vec3 hot=normalize(vec3(0.35,-0.80,0.48));                                                   // the molten zone
    float r=acos(clamp(dot(p,hot),-1.0,1.0)), zone=1.0-smoothstep(0.12,0.30,r+fbm(p*6.0+s)*0.08);
    float lava=smoothstep(0.0,0.35,fbm(p*18.0+s*3.0+vec3(T*0.002)))*zone;
    col=mix(col,vec3(0.55,0.22,0.16),zone*0.6);
    em=(vec3(1.0,0.38,0.10)*lava+vec3(1.0,0.80,0.50)*pow(lava,2.5)*1.1)*1.25;
    float lake=1.0-smoothstep(0.035,0.05,acos(clamp(dot(p,normalize(hot+vec3(-0.14,0.06,0.1))),-1.0,1.0))+fbm(p*20.0)*0.01);
    col=mix(col,vec3(0.09,0.10,0.11),lake);                                                     // the dark crater lake
    return col; }
  // Crusader: cream gas giant with streaky rose-mauve patches along its bands
  vec3 crusader(vec3 p){ vec3 s=vec3(SEED);
    float warp=fbm(p*vec3(2.0,2.0,5.0)+s+vec3(T*0.003,0.0,0.0))*0.28;
    float lat=p.z+warp*0.5, band=sin(lat*10.0+fbm(p*2.4)*2.6)*0.5+0.5;
    float patchN=fbm(vec3(p.xy*6.0,p.z*30.0)+s+vec3(warp*6.0));                               // stretched along the bands
    float pink=smoothstep(-0.06,0.08,patchN)*smoothstep(0.15,0.55,band), deep=smoothstep(0.12,0.26,patchN)*pink;
    vec3 col=mix(vec3(0.95,0.93,0.86),vec3(0.83,0.81,0.88),smoothstep(-0.1,0.4,fbm(p*3.0-s+warp*2.0))*0.6);
    col=mix(col,vec3(0.86,0.60,0.66),pink*0.8);
    col=mix(col,vec3(0.76,0.46,0.56),deep*0.7);
    col*=0.95+0.08*fbm(p*36.0+vec3(warp*10.0));                                                 // fine swirls
    return col; }
  // microTech: snow with broad blue-lavender lowlands
  vec3 microtech(vec3 p){ vec3 s=vec3(SEED);
    float w=fbm(p*1.8+s)*0.55, n=fbm(p*2.6+s+w)+fbm(p*9.0-s+w)*0.25;
    float low=smoothstep(0.0,0.04,-n+0.05);
    float isl=smoothstep(0.16,0.24,fbm(p*14.0+s*2.0))*low;                                     // snow islands in the lowlands
    vec3 blue=mix(vec3(0.57,0.65,0.85),vec3(0.70,0.76,0.92),smoothstep(-0.2,0.3,fbm(p*6.0+s)));
    vec3 col=mix(vec3(0.95,0.94,0.95),blue,low*(1.0-isl*0.8));
    col*=0.95+0.07*fbm(p*40.0+w);
    return col; }
  void main(){
    #include <logdepthbuf_fragment>
    vec3 N=normalize(vN), L=normalize(SUN-vW), V=normalize(cameraPosition-vW);
    float lights=0.0; vec3 em=vec3(0.0), alb;
    if(TYPE==1) alb=arccorp(vP,lights); else if(TYPE==2) alb=hurston(vP,em); else if(TYPE==3) alb=crusader(vP); else alb=microtech(vP);
    if(HASMAP>0.5){ alb=mapColor(vP)*(0.95+0.10*fbm(vP*160.0)); em=vec3(0.0); }   // the real map (and no made-up lava)
    alb=pow(alb,vec3(2.2));
    float nl=dot(N,L), day=smoothstep(-0.12,0.18,nl), diff=max(nl,0.0), nv=max(dot(N,V),0.0);
    vec3 c=alb*(0.0025+1.0*diff);
    // the atmosphere: a veil over the whole disc, thicker toward the edge, lit by the sun
    float hz=HAZE*(0.35+0.65*pow(1.0-nv,1.4)), hl=smoothstep(-0.15,0.6,nl);
    c=mix(c,pow(HAZEC,vec3(2.2))*(0.02+0.95*hl),hz);
    c=mix(c,pow(ATMO,vec3(2.2))*(0.15+0.9*diff),pow(1.0-nv,3.5)*0.6*day);
    // the cities' night lights, where their real buildings are
    vec3 cityCol=cityLights(CLT0,CLD[0],CLE[0])+cityLights(CLT1,CLD[1],CLE[1]);   // each city's own lights, coloured
    c+=(vec3(1.0,0.56,0.22)*lights*0.6+cityCol)*(1.0-day)*(1.0-hz*0.4);
    c+=em*(1.0-hz*0.6);
    gl_FragColor=vec4(c,1.0);
    #include <colorspace_fragment>
  }`;
function planetMaterial(look){
  const m=new THREE.ShaderMaterial({uniforms:{SUN:{value:new THREE.Vector3()},T:{value:0},SEED:{value:look.seed},TYPE:{value:look.type},
    ATMO:{value:new THREE.Vector3(...look.atmo)},HAZE:{value:look.haze},HAZEC:{value:new THREE.Vector3(...look.hazeCol)},CITYR:{value:look.cityR},
    CLT0:{value:null},CLT1:{value:null},CLD:{value:[new THREE.Vector4(),new THREE.Vector4()]},CLE:{value:[new THREE.Vector4(1,0,0,0),new THREE.Vector4(1,0,0,0)]},
    MAP:{value:null},HASMAP:{value:0},MAPOFF:{value:new THREE.Vector2()}},
    vertexShader:PLANET_V, fragmentShader:PLANET_F});
  PLANET_MATS.push(m); return m; }
// The glow around the planet: a bright rim along the lit edge fading out into space
function atmosphereMaterial(look){
  const m=new THREE.ShaderMaterial({transparent:true, depthWrite:false, side:THREE.BackSide, blending:THREE.AdditiveBlending,
    uniforms:{SUN:{value:new THREE.Vector3()},ATMO:{value:new THREE.Vector3(...look.atmo)},K:{value:0.55+look.haze}}, vertexShader:PLANET_V,
    fragmentShader:`#include <common>
      #include <logdepthbuf_pars_fragment>
      varying vec3 vP, vW, vN, vL; uniform vec3 SUN, ATMO; uniform float K;
      void main(){
        #include <logdepthbuf_fragment>
        vec3 N=normalize(vN), L=normalize(SUN-vW), V=normalize(cameraPosition-vW);
        float lit=smoothstep(-0.35,0.45,dot(N,L));
        float t=clamp(-dot(N,V)/0.29,0.0,1.0), a=pow(t,2.4);
        gl_FragColor=vec4(pow(ATMO,vec3(2.2))*a*lit*0.9*K,1.0);
        #include <colorspace_fragment>
      }`});
  PLANET_MATS.push(m); return m; }
// Clouds: puffy patches with a lit top and a shaded side away from the sun
function cloudMaterial(look){
  const m=new THREE.ShaderMaterial({transparent:true, depthWrite:false,
    uniforms:{SUN:{value:new THREE.Vector3()},T:{value:0},SEED:{value:look.seed+11.0},COV:{value:look.clouds},COL:{value:new THREE.Vector3(...look.cloudCol)}},
    vertexShader:PLANET_V, fragmentShader:`#include <common>
      #include <logdepthbuf_pars_fragment>
      varying vec3 vP, vW, vN, vL; uniform vec3 SUN, COL; uniform float T, SEED, COV;${NOISE_GLSL}
      float dens(vec3 p){ float w=fbm(p*2.6+vec3(SEED))*0.55;
        float n=fbm(p*9.0+vec3(SEED)+w)*0.9+fbm(p*3.0-vec3(SEED))*0.35+((1.0-abs(fbm(p*30.0+w*3.0)))-0.75)*0.38+fbm(p*80.0)*0.08;
        float th=0.60-COV*0.22; return smoothstep(th-0.02,th+0.05,n*0.5+0.5); }
      void main(){
        #include <logdepthbuf_fragment>
        float a=T*0.0003; vec3 p=vec3(vP.x*cos(a)-vP.y*sin(a), vP.x*sin(a)+vP.y*cos(a), vP.z);    // they drift slowly
        vec3 l=vec3(vL.x*cos(a)-vL.y*sin(a), vL.x*sin(a)+vL.y*cos(a), vL.z);
        float d=dens(p); if(d<0.01) discard;
        float shade=clamp(1.0-(dens(p+l*0.008)-d)*2.2,0.3,1.0);                                   // denser toward the sun: in shadow
        shade*=0.66+0.34*(1.0-abs(fbm(p*55.0)))*(0.8+0.2*fbm(p*140.0));                             // puffy texture
        vec3 N=normalize(vN), L=normalize(SUN-vW); float diff=max(dot(N,L),0.0);
        float day=smoothstep(-0.15,0.2,dot(N,L));
        gl_FragColor=vec4(pow(COL,vec3(2.2))*vec3(0.92,0.96,1.0)*(0.004+diff*mix(0.55,1.0,shade)),d*0.92*mix(0.35,1.0,day));
        #include <colorspace_fragment>
      }`});
  PLANET_MATS.push(m); return m; }
// Night lights: only where a city's real buildings are (ui/citylights/<City>.js, baked by tools/city_lights.py
// from ui/cities), up to two per planet. A city without a 3D layout yet shows none.
const CITYLIGHT={};
const cityLightIndex=addScript("citylights/index.js").then(()=>Array.isArray(window.QCITYLIGHTS_INDEX)?window.QCITYLIGHTS_INDEX:[]);
async function applyCityLights(b,mat){ if(!mat?.uniforms?.CLD) return;
  const list=(await cityLightIndex); let slot=0;
  for(const {city,file} of list){ if(slot>1) break;
    if(!window.QCITYLIGHTS?.[city]) await addScript(`citylights/${encodeURIComponent(file)}.js`);
    const G=window.QCITYLIGHTS?.[city], L=S.locMap?.[city]; if(!G||G.body!==b.name||!L?.pos) continue;
    let tex=CITYLIGHT[city];
    if(!tex){
      if(G.png){ const img=new Image(); img.src="data:image/png;base64,"+G.png;              // the grid, as a greyscale PNG
        try{ await img.decode(); }catch(e){ console.warn(`citylights/${file}.js`,e); continue; }
        tex=new THREE.Texture(img); tex.flipY=false; }
      else { const bin=atob(G.b64), u8=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) u8[i]=bin.charCodeAt(i);
        tex=new THREE.DataTexture(u8,G.n,G.n,THREE.RedFormat,THREE.UnsignedByteType); }
      tex.minFilter=THREE.LinearMipmapLinearFilter; tex.magFilter=THREE.LinearFilter; tex.generateMipmaps=true; tex.anisotropy=8; tex.needsUpdate=true;
      CITYLIGHT[city]=tex; }
    const up=new THREE.Vector3(...L.pos).normalize(), east=new THREE.Vector3(0,0,1).cross(up).normalize();   // as tools/build_city.py lines the city up
    mat.uniforms["CLT"+slot].value=tex; mat.uniforms.CLD.value[slot].set(up.x,up.y,up.z,b.radius/G.size); mat.uniforms.CLE.value[slot].set(east.x,east.y,east.z,b.radius/45); slot++; } }

// The game's own colour maps (ui/planets/<Body>.js, made by tools/build_planet_textures.py), listed in
// ui/planets/index.js. A body without one keeps the look drawn here.
const PLANET_IMG={};
function addScript(src){ return window.qLoadAsset(src); }   // server-hosted map data (see qLoadAsset)
const planetIndex=addScript("planets/index.js").then(()=>Array.isArray(window.QPLANET_INDEX)?window.QPLANET_INDEX:[]);
function planetImage(name){
  return PLANET_IMG[name]||(PLANET_IMG[name]=(async()=>{
    if(!(await planetIndex).includes(name)) return null;
    if(!window.QPLANET?.[name]) await addScript(`planets/${encodeURIComponent(name)}.js`);
    const P=window.QPLANET?.[name]; if(!P?.jpg) return null;
    const img=new Image(); img.src="data:image/jpeg;base64,"+P.jpg;
    try{ await img.decode(); }catch(e){ console.warn(`planets/${name}.js`,e); return null; }
    delete P.jpg; return {img,du:P.du||0,dv:P.dv||0}; })()); }
async function applyPlanetMap(b,mat){
  const m=await planetImage(b.name); if(!m||!mat) return;
  const tex=new THREE.Texture(m.img); tex.wrapS=THREE.RepeatWrapping; tex.anisotropy=8; tex.needsUpdate=true;
  if(mat.uniforms?.MAP){ mat.uniforms.MAP.value=tex; mat.uniforms.HASMAP.value=1; mat.uniforms.MAPOFF.value.set(m.du,m.dv); return; }
  // a plain sphere (rotated so its own u=0 is at longitude 180): turn the map half-way round
  tex.colorSpace=THREE.SRGBColorSpace; tex.offset.set(0.5+m.du,m.dv);
  mat.map?.dispose?.(); mat.map=tex; mat.color?.set(0xffffff); mat.needsUpdate=true; }
function seededRand(name){ let h=2166136261; for(const c of name){ h^=c.charCodeAt(0); h=Math.imul(h,16777619); } return ()=>{ h^=h<<13; h^=h>>>17; h^=h<<5; return ((h>>>0)%100000)/100000; }; }
const KIND_LABEL={star:"Star",planet:"Planet",moon:"Moon",asteroid:"Asteroid"};
function kindLabel(b){ return KIND_LABEL[b.kind]||"Planet"; }
// Asteroids (Delamar) aren't round: a lumpy, cratered rock, the same shape every time (seeded by name).
// Faceted on purpose. Scaled so its average radius matches the data's radius.
function asteroidGeometry(name){
  const rnd=seededRand(name+"#rock"), dir=()=>new THREE.Vector3(rnd()-.5,rnd()-.5,rnd()-.5).normalize();
  const lobes=[...Array(10)].map(()=>[dir(),(rnd()-.4)*0.5]);                 // big bulges and dents
  const craters=[...Array(22)].map(()=>[dir(),0.10+Math.pow(rnd(),2)*0.32,0.025+rnd()*0.05]); // [centre, size (rad), depth]
  const g=new THREE.IcosahedronGeometry(1,20), p=g.attributes.position, v=new THREE.Vector3(); let sum=0;
  for(let i=0;i<p.count;i++){ v.fromBufferAttribute(p,i).normalize(); let r=1;
    for(const [d,a] of lobes) r+=a*Math.pow(Math.max(0,v.dot(d)),2.2);
    for(const [d,sz,dp] of craters){ const u=Math.acos(Math.min(1,v.dot(d)))/sz;  // bowl, then a low rim
      if(u<1) r-=dp*(1-u*u); else if(u<1.3) r+=dp*0.35*Math.sin((u-1)/0.3*Math.PI); }
    r+=0.012*Math.sin(v.x*37)*Math.sin(v.y*41)*Math.sin(v.z*43);                 // grit (from position, so faces stay joined)
    v.multiplyScalar(r); v.x*=1.3; v.y*=0.88; v.z*=0.74; p.setXYZ(i,v.x,v.y,v.z); sum+=v.length(); }
  const k=p.count/sum; for(let i=0;i<p.count;i++) p.setXYZ(i,p.getX(i)*k,p.getY(i)*k,p.getZ(i)*k);
  g.computeVertexNormals(); return g; }
function bodyTexture(b){
  const [h,s,l]=BODY_HSL[b.name]||[(b.name.length*47)%360,18,50]; const c=document.createElement("canvas"); c.width=512; c.height=256; const x=c.getContext("2d");
  const rnd=seededRand(b.name);
  if(GAS.has(b.name)){ for(let y=0;y<256;y+=2){ const v=Math.sin(y*0.11+rnd()*0.6)*8+Math.sin(y*0.031)*10; x.fillStyle=`hsl(${h+v*0.4} ${s}% ${l+v}%)`; x.fillRect(0,y,512,2); } }
  else { x.fillStyle=`hsl(${h} ${s}% ${l}%)`; x.fillRect(0,0,512,256);
    for(let i=0;i<900;i++){ const r=2+Math.pow(rnd(),3)*38, px=rnd()*512, py=rnd()*256, dl=(rnd()-.5)*22;
      x.fillStyle=`hsla(${h+(rnd()-.5)*14} ${s}% ${l+dl}% / ${0.10+rnd()*0.16})`; x.beginPath(); x.arc(px,py,r,0,7); x.fill(); if(px<r) { x.beginPath(); x.arc(px+512,py,r,0,7); x.fill(); } }
    if(ICY.has(b.name)||b.name==="microTech"){ const g=x.createLinearGradient(0,0,0,256); g.addColorStop(0,"rgba(245,250,255,.85)"); g.addColorStop(.13,"rgba(245,250,255,0)"); g.addColorStop(.87,"rgba(245,250,255,0)"); g.addColorStop(1,"rgba(245,250,255,.85)"); x.fillStyle=g; x.fillRect(0,0,512,256); } }
  const t=new THREE.CanvasTexture(c); t.colorSpace=THREE.SRGBColorSpace; t.anisotropy=4; return t;
}
function gratGeometry(){ // lat/lon grid on a unit sphere, z = north
  const v=[]; const seg=96;
  for(let lat=-75;lat<=75;lat+=15){ const z=Math.sin(lat*Math.PI/180), r=Math.cos(lat*Math.PI/180);
    for(let i=0;i<seg;i++){ const a1=i/seg*Math.PI*2, a2=(i+1)/seg*Math.PI*2; v.push(r*Math.cos(a1),r*Math.sin(a1),z, r*Math.cos(a2),r*Math.sin(a2),z); } }
  for(let lon=0;lon<360;lon+=15){ const a=lon*Math.PI/180;
    for(let i=0;i<seg/2;i++){ const p1=-Math.PI/2+i/(seg/2)*Math.PI, p2=-Math.PI/2+(i+1)/(seg/2)*Math.PI;
      v.push(Math.cos(p1)*Math.cos(a),Math.cos(p1)*Math.sin(a),Math.sin(p1), Math.cos(p2)*Math.cos(a),Math.cos(p2)*Math.sin(a),Math.sin(p2)); } }
  const g=new THREE.BufferGeometry(); g.setAttribute("position",new THREE.Float32BufferAttribute(v,3)); return g; }
const GRAT=gratGeometry();
function glowTexture(color){ const c=document.createElement("canvas"); c.width=c.height=128; const x=c.getContext("2d"); const g=x.createRadialGradient(64,64,0,64,64,64);
  g.addColorStop(0,color); g.addColorStop(0.25,color.replace(/[\d.]+\)$/,"0.35)")); g.addColorStop(1,"rgba(0,0,0,0)"); x.fillStyle=g; x.fillRect(0,0,128,128); return new THREE.CanvasTexture(c); }

let sysObjs=[];  // three objects of the current system
function buildSystem(){
  for(const o of sysObjs){ scene.remove(o.group); o.group.traverse(n=>{ n.geometry?.dispose?.(); n.material?.map?.dispose?.(); n.material?.dispose?.(); });
    if(o.orbit){ scene.remove(o.orbit); o.orbit.geometry.dispose(); o.orbit.material.dispose(); } }   // leftover rings = "ghost" orbits
  sysObjs=[]; PLANET_MATS.length=0;
  for(const b of S.bodies.filter(b=>b.system===S.system)){
    const group=new THREE.Group(); const spin=new THREE.Group(); group.add(spin);
    const isStar=b.kind==="star", isRock=b.kind==="asteroid";
    let geo; if(isRock) geo=asteroidGeometry(b.name); else { geo=new THREE.SphereGeometry(1,96,64); geo.rotateX(Math.PI/2); }
    const look=!isStar&&PLANET_LOOK[b.name];
    const mat= isStar ? sunMaterial(BODY_HSL[b.name]?.[0]??45) : look ? planetMaterial(look)
                      : new THREE.MeshStandardMaterial({map:bodyTexture(b), roughness:isRock?1:0.95, metalness:0, flatShading:isRock});
    const mesh=new THREE.Mesh(geo,mat); mesh.scale.setScalar(b.radius); spin.add(mesh);
    if(!isStar&&!isRock){ applyPlanetMap(b,mat); applyCityLights(b,mat); }
    let grid=null, atmo=null, clouds=null;
    if(isRock){ /* no lat/lon grid or atmosphere on a rock */ }
    else if(!isStar){
      grid=new THREE.LineSegments(GRAT,new THREE.LineBasicMaterial({color:0xa9c3ff,transparent:true,opacity:0.16,depthWrite:false}));
      grid.scale.setScalar(b.radius*1.002); spin.add(grid);
      const [h]=BODY_HSL[b.name]||[210];
      if(look){
        atmo=new THREE.Mesh(new THREE.SphereGeometry(1,96,64), atmosphereMaterial(look)); atmo.scale.setScalar(b.radius*1.05); group.add(atmo);
        if(look.clouds>0){ const cl=new THREE.Mesh(geo, cloudMaterial(look)); cl.scale.setScalar(b.radius*1.008); spin.add(cl); clouds=cl; }
      } else {
      atmo=new THREE.Mesh(new THREE.SphereGeometry(1,48,32), new THREE.MeshBasicMaterial({color:new THREE.Color(`hsl(${h},60%,70%)`),transparent:true,opacity:0.08,side:THREE.BackSide,depthWrite:false}));
      atmo.scale.setScalar(b.radius*1.035); group.add(atmo); }
    } else {
      const rgb=b.name==="Pyrostar"?"255,138,72":b.system==="Nyx"?"255,214,170":"255,218,150";
      const add=(map,opts)=>new THREE.Sprite(new THREE.SpriteMaterial({map,depthWrite:false,transparent:true,blending:THREE.AdditiveBlending,fog:false,...opts}));
      const corona=add(coronaTexture(rgb)); corona.scale.setScalar(b.radius*7.5); group.add(corona);
      const halo=add(glowTexture(`rgba(${rgb},0.55)`),{opacity:0.32}); halo.scale.setScalar(b.radius*15); group.add(halo);
      // glare: a fixed share of the screen, so the sun still shines when the whole system is in view
      const glare=add(coronaTexture(rgb),{sizeAttenuation:false,opacity:0.55}); glare.scale.setScalar(0.16); group.add(glare);
    }
    scene.add(group);
    // orbit ring around the parent (drawn in the parent's plane)
    let orbit=null; const par=b.parent&&S.bodyMap[b.parent];
    if(par){ const r=Math.hypot(b.center[0]-par.center[0], b.center[1]-par.center[1]); const pts=[];
      for(let i=0;i<=256;i++){ const a=i/256*Math.PI*2; pts.push(new THREE.Vector3(Math.cos(a)*r,Math.sin(a)*r,0)); }
      orbit=new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({color:S.orbitColor,transparent:true,opacity:par.kind==="star"?0.42:0.24,depthWrite:false}));
      scene.add(orbit); }
    sysObjs.push({b,group,spin,mesh,grid,atmo,clouds,orbit,par,orbitZ:b.center[2],orbitR:par?Math.hypot(b.center[0]-par.center[0],b.center[1]-par.center[1]):0});
  }
  sysObjs.group=null;
  buildStations();
}
// =================================================================== space stations
// Each station gets a 3D model in the style of the game's stations: a long spine with big spoked rings
// around it, habitat blocks with lit windows, a cluster of tanks, a small ring and an antenna. Four designs,
// made once; each station picks one by its name and is turned its own way. Real stations are only a km or
// two long, so a model keeps a readable size on screen as you zoom out, and is hidden in the whole-system
// view (its marker and name still show). Follows the Stations layer.
const STATION_MATS=[new THREE.MeshStandardMaterial({color:0x9aa4b0,metalness:0.65,roughness:0.42}),
  new THREE.MeshStandardMaterial({color:0xc6a04e,metalness:0.4,roughness:0.5}),
  new THREE.MeshBasicMaterial({color:0xffe2a8}),
  new THREE.MeshStandardMaterial({color:0x5f6873,metalness:0.7,roughness:0.5})];
function mergeParts(parts){ const out=STATION_MATS.map(()=>({pos:[],nor:[]}));
  for(const [geo,mat,m] of parts){ const g=(geo.index?geo.toNonIndexed():geo.clone()).applyMatrix4(m); g.computeVertexNormals?.();
    const P=g.attributes.position.array, N=g.attributes.normal.array; for(let i=0;i<P.length;i++){ out[mat].pos.push(P[i]); out[mat].nor.push(N[i]); } g.dispose(); }
  return out.map(o=>{ const g=new THREE.BufferGeometry(); g.setAttribute("position",new THREE.Float32BufferAttribute(o.pos,3)); g.setAttribute("normal",new THREE.Float32BufferAttribute(o.nor,3)); g.computeBoundingSphere(); return g; }); }
const STATION_DESIGNS=[0,1,2,3].map(v=>{ const rnd=seededRand("station-design-"+v), parts=[], M=()=>new THREE.Matrix4();
  const at=(x,y=0,z=0)=>M().makeTranslation(x,y,z), rotX=a=>M().makeRotationX(a), rotY=a=>M().makeRotationY(a), rotZ=a=>M().makeRotationZ(a);
  const L=950+rnd()*350, nRing=2+Math.floor(rnd()*2.6), R0=250+rnd()*110;
  parts.push([new THREE.CylinderGeometry(26,26,L,16),0,rotZ(Math.PI/2)]);                                     // spine along x
  for(let k=0;k<4;k++){ const a=k*Math.PI/2+Math.PI/4;                                                         // truss round it
    parts.push([new THREE.BoxGeometry(L*0.92,7,7),3,rotX(a).multiply(at(0,44,0))]);
    for(let j=0;j<14;j++) parts.push([new THREE.BoxGeometry(5,62,5),3,at(-L*0.46+j*L*0.92/13).multiply(rotX(a))]); }
  parts.push([new THREE.CylinderGeometry(6,3,L*0.32,6),3,at(L*0.5+L*0.16,0,0).multiply(rotZ(Math.PI/2))]);   // antenna mast
  for(let i=0;i<nRing;i++){ const x=-L*0.42+i*(L*0.62/Math.max(1,nRing-1)), R=R0*(0.9+rnd()*0.2), tube=20+rnd()*8, spokes=3+Math.floor(rnd()*4);
    const ringM=at(x).multiply(rotY(Math.PI/2));
    parts.push([new THREE.TorusGeometry(R,tube,12,96),i%2?1:0,ringM]);                                       // the ring
    parts.push([new THREE.TorusGeometry(R+tube*0.9,tube*0.35,6,96),3,ringM.clone()]);                          // its outer rim
    for(let k=0;k<24;k++){ const a=k/24*Math.PI*2;                                                             // habitat segments with windows
      const seg=at(x).multiply(rotX(a)).multiply(at(0,R,0));
      parts.push([new THREE.BoxGeometry(tube*2.4,tube*1.4,R*0.2),k%6===0?1:0,seg]);
      parts.push([new THREE.BoxGeometry(tube*2.45,tube*0.25,R*0.16),2,seg.clone().multiply(at(0,tube*0.2,0))]); }
    parts.push([new THREE.CylinderGeometry(62,62,70,20),0,at(x).multiply(rotZ(Math.PI/2))]);                // hub
    for(let k=0;k<spokes;k++){ const a=k/spokes*Math.PI*2+rnd();
      parts.push([new THREE.CylinderGeometry(7,7,R,8),3,at(x).multiply(rotX(a)).multiply(at(0,R/2,0))]); } }
  const hx=L*0.30;                                                                                            // the main module cluster
  parts.push([new THREE.BoxGeometry(230,120,150),0,at(hx)]);
  parts.push([new THREE.BoxGeometry(236,14,152),2,at(hx,30,0)]);
  for(let k=0;k<9+Math.floor(rnd()*5);k++){ const a=rnd()*Math.PI*2, w=60+rnd()*90, h=40+rnd()*60, len=90+rnd()*150;
    const m=at(hx+(rnd()-0.5)*260).multiply(rotX(a)).multiply(at(0,70+h/2+rnd()*40,0));
    parts.push([new THREE.BoxGeometry(len,h,w),k%3===0?1:0,m]);
    for(let j=0;j<3;j++) parts.push([new THREE.BoxGeometry(len*1.01,h*0.12,w*0.7),2,m.clone().multiply(at(0,(j-1)*h*0.28,0))]); }
  const tx=L*0.04+rnd()*L*0.06;                                                                                // tanks
  for(let k=0;k<8;k++){ const a=k/8*Math.PI*2; parts.push([new THREE.SphereGeometry(40,16,10),0,at(tx+(k%2)*60).multiply(rotX(a)).multiply(at(0,70,0))]); }
  const sx=L*0.5;                                                                                              // the small ring at the end
  parts.push([new THREE.TorusGeometry(140,11,8,64),0,at(sx).multiply(rotY(Math.PI/2))]);
  for(let k=0;k<4;k++) parts.push([new THREE.CylinderGeometry(4,4,140,6),3,at(sx).multiply(rotX(k*Math.PI/2)).multiply(at(0,70,0))]);
  return {geos:mergeParts(parts), length:L*1.2}; });
let stationObjs=[], stationGen=0;
function buildStations(){
  for(const o of stationObjs){ if(o.group) scene.remove(o.group); window.Stations3D?.hide(o); } stationObjs=[]; const gen=++stationGen;
  for(const L of S.locs||[]){
    if(L.type!=="station"||L.system!==S.system||!L.pos) continue;
    if(L.kind==="surface"){ const b=S.bodyMap[L.body]; if(!b||Math.hypot(...L.pos)<b.radius*1.02) continue; }   // ground stations: no model
    const rnd=seededRand(L.name), d=STATION_DESIGNS[Math.floor(rnd()*STATION_DESIGNS.length)], group=new THREE.Group();
    d.geos.forEach((g,i)=>{ if(g.attributes.position.count) group.add(new THREE.Mesh(g,STATION_MATS[i])); });
    group.quaternion.setFromEuler(new THREE.Euler(rnd()*6.28,rnd()*6.28,rnd()*6.28)); group.visible=false; scene.add(group);
    stationObjs.push({L,group,len:d.length,spin:(rnd()-0.5)*0.06}); }
  // Ground sites and anything else the server has the game's model for (Wikelo's emporiums, PAFs,
  // distribution centres, outposts): no stand-in, just the real model once it's close enough.
  window.Stations3D?.ready?.().then(()=>{ if(gen!==stationGen) return; const have=new Set(stationObjs.map(o=>o.L.name));
    for(const L of S.locs||[]) if(L.pos&&L.system===S.system&&!have.has(L.name)&&window.Stations3D.has(L)) stationObjs.push({L,group:null,ground:true}); }); }
function updateStations(t){ const f=H/2/Math.tan(camera.fov*Math.PI/360), on=S.layers?.station!==false, v=new THREE.Vector3();
  for(const o of stationObjs){ const g=on?globalPos(o.L,t):null; if(!g){ if(o.group) o.group.visible=false; window.Stations3D?.hide(o); continue; }
    v.set(g[0]-O[0],g[1]-O[1],g[2]-O[2]); const d=camera.position.distanceTo(v);
    if(d>(o.ground?2e6:1.6e7)){ if(o.group) o.group.visible=false; window.Stations3D?.hide(o); continue; }       // whole-system view: just the marker
    // The game's own model (stations3d.js), once it's downloaded, takes the stand-in's place
    let real=false; try{ real=!!window.Stations3D?.show(o,v,d,t,f); }catch(e){ console.warn(e); }
    if(!o.group) continue;
    if(real){ o.group.visible=false; continue; }
    o.group.visible=true; o.group.position.copy(v); o.group.scale.setScalar(Math.max(1,48*d/(o.len*f)));
    o.group.rotateX(o.spin*0.016); } }

function place(obj,p){ obj.position.set(p[0]-O[0],p[1]-O[1],p[2]-O[2]); }

// =================================================================== camera
function lockBodyOf(f){ return f.kind==="body" ? f.name : null; }   // orbit a planet in its rotating frame
// A place stored on a planet or moon but well above it (Grim HEX, orbital markers, comm arrays, ship
// graveyards): it turns with the body, but it isn't on the ground, so the map treats it like a station.
// A station counts as soon as it's clear of the ground (Port Tressler is only ~130 km over microTech).
function isOrbital(L){ const b=L&&L.kind==="surface"&&L.pos&&S.bodyMap[L.body]; if(!b) return false;
  const alt=Math.hypot(L.pos[0],L.pos[1],L.pos[2])-b.radius;
  return alt > Math.max(50000,b.radius*0.15) || (L.type==="station" && alt > b.radius*0.02); }
function surfaceBodyOf(f){ if(f.kind==="loc"){ const L=S.locMap[f.name]; return L&&L.kind==="surface"&&!isOrbital(L)?L.body:null; }
  if(f.kind==="local") return f.body; if(f.kind==="player") return S.live?.player?.body||null; return null; }
function focusPos(f,t){
  // What the camera looks at can disappear while you look at it: a contract's stop is removed when the
  // contract is done, a waypoint deleted, a system switched. Then the view stays where it is.
  const gone=()=>{ const p=S.cam?.target&&S.cam.target.every(Number.isFinite)?[...S.cam.target]:systemCenter();
    if(f===S.focus) S.focus={kind:"point",pos:p}; return p; };
  if(f.kind==="body") return S.bodyMap[f.name]?.center||gone();
  if(f.kind==="loc"){ const L=S.locMap[f.name]; return (L&&globalPos(L,t))||gone(); }
  if(f.kind==="local") return S.bodyMap[f.body]?toGlobal(S.bodyMap[f.body],f.pos,t):gone();
  if(f.kind==="point") return f.pos;
  if(f.kind==="player") return playerG(t) || S.cam.target;
  return systemCenter();
}
// Systems are framed around their star: the orbit rings are centred on it, so the view is balanced
// (averaging the planets pulled Pyro off to one side, because Terminus is so far out).
function systemCenter(){ const star=S.bodies.find(b=>b.system===S.system&&b.kind==="star"); if(star) return star.center;
  const bs=S.bodies.filter(b=>b.system===S.system&&b.kind==="planet"); if(!bs.length) return [0,0,0];
  return [0,1,2].map(i=>bs.reduce((s,b)=>s+b.center[i],0)/bs.length); }
function systemExtent(){ const c=systemCenter(); let m=1e9; for(const b of S.bodies) if(b.system===S.system&&b.kind!=="star") m=Math.max(m,d3(b.center,c)); for(const L of S.locs) if(L.system===S.system&&L.pos&&L.kind==="space"&&(L.type==="lpoint"||L.type==="jump")) m=Math.max(m,d3(L.pos,c)); return m; }
const norm3=v=>{ const l=Math.hypot(v[0],v[1],v[2])||1; return [v[0]/l,v[1]/l,v[2]/l]; };
const cross3=(a,b)=>[a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
// Camera direction and up vector for the current focus. Near a surface the view uses the local
// horizon (east/north/up) so you look down at the ground with north at the top of the screen.
function viewFrame(t,goal){
  const c=S.cam, sb=surfaceBodyOf(S.focus);
  if(sb && S.bodyMap[sb]) return groundFrame(S.bodyMap[sb],goal,c.pitch,c.yaw,c.roll||0);
  const yaw=c.yaw+(c.lock&&S.bodyMap[c.lock]?bodyAngle(S.bodyMap[c.lock],t):0);
  return {dir:[Math.cos(c.pitch)*Math.cos(yaw),Math.cos(c.pitch)*Math.sin(yaw),Math.sin(c.pitch)], up:[0,0,1]};
}
// The ground camera at G over B. An orbit camera: "up" on screen is the way you're facing over the ground
// (tilted toward the sky as you look at the horizon), so right-drag turns the view round. Holding north at
// the top made it stick and wobble instead. The default top-down heading still has north at the top.
// roll turns the picture about the view direction: it is what keeps the screen exactly as it was when the
// view moves onto a planet's ground (scroll-zooming in), instead of the planet visibly turning.
function groundAxes(B,G){ const up=norm3([G[0]-B.center[0],G[1]-B.center[1],G[2]-B.center[2]]);
  let east=cross3([0,0,1],up); if(Math.hypot(...east)<1e-6) east=[1,0,0]; east=norm3(east); return {up,east,north:cross3(up,east)}; }
function groundFrame(B,G,pitch,yaw,roll){ const {up,east,north}=groundAxes(B,G);
  const h=[0,1,2].map(i=>Math.cos(yaw)*east[i]+Math.sin(yaw)*north[i]);
  const dir=[0,1,2].map(i=>Math.cos(pitch)*h[i]+Math.sin(pitch)*up[i]);
  let u=[0,1,2].map(i=>Math.cos(pitch)*up[i]-Math.sin(pitch)*h[i]);
  if(roll){ const x=cross3(dir,u), cr=Math.cos(roll), sr=Math.sin(roll); u=[0,1,2].map(i=>u[i]*cr+x[i]*sr); }
  return {dir,up:norm3(u)}; }
function setLock(name){ const t=viewT(); const old=S.cam.lock&&S.bodyMap[S.cam.lock];
  if(old) S.cam.yaw+=bodyAngle(old,t); const nb=name&&S.bodyMap[name]; if(nb) S.cam.yaw-=bodyAngle(nb,t); S.cam.lock=nb?name:null; }
// Zoom-and-pan along the path from van Wijk & Nuij ("Smooth and efficient zooming and panning"):
// it zooms out just enough to keep both ends in view and moves at an even perceived speed, so a long
// fly-in reads as one gliding motion instead of a zoom, a pause and a slide.
function zoomPath(d, w0, w1){ const rho=Math.SQRT2;
  if(d<1e-9*Math.max(w0,w1)){ const S=Math.log(w1/w0)/rho; return {S, at:s=>[s/(S||1), w0*Math.exp(rho*s)], flat:true}; }
  const b0=(w1*w1-w0*w0+4*d*d)/(2*w0*2*d), b1=(w1*w1-w0*w0-4*d*d)/(2*w1*2*d);
  const r0=-Math.asinh(b0), r1=-Math.asinh(b1), S=(r1-r0)/rho, c0=Math.cosh(r0);
  return {S, at:s=>[w0/(2*d)*(c0*Math.tanh(rho*s+r0)-Math.sinh(r0)), w0*c0/Math.cosh(rho*s+r0)]}; }
function flyTo(focus,dist,{pitch=null,yaw=null,dur=null,key=null}={}){
  // Already gliding to the same thing? Keep going, just aim at where it is now. The follow camera
  // asks again on every position update with slightly different coordinates; restarting the glide
  // each time is what made the fly-in go zoom, pause, zoom, pause.
  key=key||JSON.stringify(focus);
  if(S.anim&&S.anim.key===key&&Math.abs(Math.log(dist/S.anim.toDist))<0.6){ S.focus=focus; return; }
  const fromDir=norm3([camera.position.x,camera.position.y,camera.position.z]), fromUp=[camera.up.x,camera.up.y,camera.up.z];
  setLock(lockBodyOf(focus)); if(yaw!=null) S.cam.yaw=yaw;
  const from=[...S.cam.target], goal=focusPos(focus,viewT()), k=2*Math.tan(camera.fov*Math.PI/360);
  const path=zoomPath(d3(from,goal), S.cam.dist*k, dist*k);
  const reduce=matchMedia("(prefers-reduced-motion: reduce)").matches;
  S.anim={key, from, fromDist:S.cam.dist, toDist:dist, k, path, fromPitch:S.cam.pitch, toPitch:pitch??S.cam.pitch, fromDir, fromUp,
          t0:performance.now(), dur:reduce?1:(dur??Math.max(900,Math.min(2600,Math.abs(path.S)*620)))};
  S.focus=focus; S.cam.roll=0;
}
function updateCamera(t){
  S.camT=t;                                            // the moment the camera was last placed for (see the wheel)
  const c=S.cam, goal=focusPos(S.focus,t); let e=1;
  if(S.anim){ const a=S.anim, u=Math.min(1,(performance.now()-a.t0)/a.dur);
    e=(1-Math.cos(Math.PI*u))/2;                       // gentle start and finish, no plateaus
    let [p,w]=a.path.at(a.path.S*e); if(a.path.flat) p=e;
    if(u>=1){ p=1; w=a.toDist*a.k; }
    c.target=[0,1,2].map(i=>a.from[i]+(goal[i]-a.from[i])*Math.max(0,Math.min(1,p))); c.dist=w/a.k; c.pitch=a.fromPitch+(a.toPitch-a.fromPitch)*e;
  } else c.target=goal;
  O=c.target;
  let {dir,up}=viewFrame(t,c.target);
  if(S.anim){ const a=S.anim; dir=norm3(dir.map((v,i)=>a.fromDir[i]+(v-a.fromDir[i])*e)); up=norm3(up.map((v,i)=>a.fromUp[i]+(v-a.fromUp[i])*e)); if(e>=1) S.anim=null; }
  camera.position.set(dir[0]*c.dist,dir[1]*c.dist,dir[2]*c.dist); camera.up.set(up[0],up[1],up[2]);
  // Keep what you're looking at clear of the cards on the left: shift the view's centre right.
  const fr=mapWindow(), ease=fr?1:0.12;                // the route page's map follows its scrolling exactly
  const want=viewShift(); S.shift=(S.shift||0)+(want-(S.shift||0))*ease;
  const wantV=fr?(H/2-(fr.y+fr.h/2)):0; S.vshift=(S.vshift||0)+(wantV-(S.vshift||0))*ease;
  if(Math.abs(S.shift)>0.5||Math.abs(S.vshift)>0.5) camera.setViewOffset(W,H,-S.shift,S.vshift,W,H); else camera.clearViewOffset();
  camera.near=Math.max(0.5,c.dist*1e-4); camera.far=1e14; camera.updateProjectionMatrix(); camera.lookAt(0,0,0); camera.updateMatrixWorld();
}
// A system with just one body we know frames that body instead of empty space around it.
function fitSystem(){ const bs=S.bodies.filter(b=>b.system===S.system&&b.kind!=="star");
  const far=S.locs.some(L=>L.system===S.system&&L.pos&&L.kind==="space"&&(L.type==="lpoint"||L.type==="jump"));
  if(bs.length===1&&!far) return flyTo({kind:"body",name:bs[0].name}, bs[0].radius*5, {pitch:0.9});
  flyTo({kind:"system"}, systemExtent()*2.4, {pitch:1.0}); }
function focusBody(name){ const b=S.bodyMap[name]; if(!b) return; if(S.follow) setFollow(false); if(b.system!==S.system) setSystem(b.system,false); flyTo({kind:"body",name}, b.radius*(b.kind==="star"?12:3.2)); }
const TOPDOWN={pitch:1.25,yaw:-Math.PI/2};
const STATION_VIEW=45000, STATION_MIN=10;     // open a station 45 km out; the wheel can close in to 10 m
const isStation=L=>!!L&&L.type==="station"&&!(L.kind==="surface"&&!isOrbital(L));
function stationFocus(){ const f=S.focus; return f&&f.kind==="loc"&&isStation(S.locMap[f.name])?S.locMap[f.name]:null; }  // looking down, slightly from the south: north is up
function focusLoc(name,close=false){ const L=S.locMap[name]; if(!L) return; if(S.follow) setFollow(false); if(L.system!==S.system) setSystem(L.system,false); if(!L.pos) return;
  if(L.kind==="surface"&&!isOrbital(L)){ const b=S.bodyMap[L.body]; flyTo({kind:"loc",name}, close?Math.max(15000,b.radius*0.06):b.radius*1.4, TOPDOWN); }
  else flyTo({kind:"loc",name}, isStation(L)?STATION_VIEW:(close?60000:4e6)); }
// Follow: when your position changes (a /showlocation, a landing, a jump, a stop ticked off), the view
// moves with you: you and your next stop if there's a route, otherwise just you. Dragging or zooming the
// map yourself pauses it; ◎ (or Y) turns it back on.
function setFollow(on){ S.follow=on; $("z-you").classList.toggle("on",on); $("z-you").title=on?"Following you (drag the map to stop)":"Follow me (Y)"; }
function followNow(){ const live=S.live, p=live?.player; if(!p) return;
  if(live.route?.length && S.locMap[live.route[0]]?.system===p.system) fitRoute(false,[live.route[0]]);
  else if(live.guide?.name && S.locMap[live.guide.name]?.system===p.system) fitRoute(false,[live.guide.name]);   // guiding to a waypoint: you and it
  else focusPlayer(true); }
function focusPlayer(quiet){ const p=S.live?.player; if(!p) return quiet?null:toast("Type /showlocation in game chat first");
  if(p.system!==S.system) setSystem(p.system,false);
  // {kind:"player"} is looked up every frame (focusPos), so once the camera is on you it stays on you as your
  // position moves: a new /showlocation, or Quantum tracking you from the log as you travel.
  if(p.body&&S.bodyMap[p.body]) flyTo({kind:"player"}, Math.max(30000,S.bodyMap[p.body].radius*0.08), {...TOPDOWN,key:"player:"+p.body});
  else flyTo({kind:"player"}, 5e6, {key:"player:space"}); }

// =================================================================== projection & occlusion
const V3=new THREE.Vector3();
function proj(p){ V3.set(p[0]-O[0],p[1]-O[1],p[2]-O[2]).applyMatrix4(camera.matrixWorldInverse); if(V3.z>-camera.near) return null;
  const depth=-V3.z; V3.applyMatrix4(camera.projectionMatrix); return [(V3.x+1)/2*W,(1-V3.y)/2*H,depth]; }
let occluders=[], camW=[0,0,0];
function prepOcclusion(){ camW=[camera.position.x+O[0],camera.position.y+O[1],camera.position.z+O[2]]; occluders=[];
  const f=H/2/Math.tan(camera.fov*Math.PI/360);
  for(const o of sysObjs){ const b=o.b; const d=d3(camW,b.center); const pr=b.radius/Math.max(d,1)*f; o.pr=pr; if(pr>1.5) occluders.push(b); } }
function visible(p, ownBody){ // is world point p hidden behind a planet?
  for(const b of occluders){ const c=b.center;
    if(b.name===ownBody){ const n=[p[0]-c[0],p[1]-c[1],p[2]-c[2]], v=[camW[0]-p[0],camW[1]-p[1],camW[2]-p[2]];
      const ln=Math.hypot(...n)||1, lv=Math.hypot(...v)||1;
      // On the ground: hidden once it's past the horizon. High above it (an orbital marker sits at about
      // 1.5x the radius) it can be seen well past that, beside the planet, so it gets the line-of-sight
      // test below instead; the horizon test used to hide most OMs.
      if(ln<b.radius*1.05){ if((n[0]*v[0]+n[1]*v[1]+n[2]*v[2])/(ln*lv) < -0.03) return false; continue; } }
    const dx=p[0]-camW[0],dy=p[1]-camW[1],dz=p[2]-camW[2], L=Math.hypot(dx,dy,dz)||1, ux=dx/L,uy=dy/L,uz=dz/L;
    const ox=c[0]-camW[0],oy=c[1]-camW[1],oz=c[2]-camW[2], tc=ox*ux+oy*uy+oz*uz; if(tc<0||tc>L) continue;
    const d2=ox*ox+oy*oy+oz*oz-tc*tc, r=b.radius*0.998; if(d2<r*r && tc-Math.sqrt(r*r-d2)<L) return false; }
  return true; }

// =================================================================== overlay drawing
let labelBoxes=[];
function labelFree(x,y,w,h){ for(const b of labelBoxes) if(x<b[2]&&x+w>b[0]&&y<b[3]&&y+h>b[1]) return false; labelBoxes.push([x,y,x+w,y+h]); return true; }
// A commodity's terminals on the map. Places close together (the stations and outposts round one planet)
// would print their prices on top of each other, so each label that would overlap one already placed moves
// down a row, and a thin line runs back from it to its place: a little list beside the cluster.
function drawMarkLabels(t){
  const font="600 12px 'Inter',sans-serif", rowH=17, pts=[];
  for(const m of S.mapMarks){ const nd=nodeOf(m.name,t), q=nd&&proj(nd.g); if(!q) continue;
    ctx.beginPath(); ctx.arc(q[0],q[1],8,0,Math.PI*2); ctx.strokeStyle=m.color; ctx.lineWidth=2; ctx.stroke(); pts.push({m,q}); }
  pts.sort((a,b)=>a.q[1]-b.q[1]||a.q[0]-b.q[0]);
  const placed=[]; ctx.font=font;
  const hits=(x0,y0,x1,y1)=>placed.some(b=>x0<b[2]&&x1>b[0]&&y0<b[3]&&y1>b[1]);
  for(const {m,q} of pts){ const text=`${m.name} · ${m.label}`, w=ctx.measureText(text).width;
    // first choice right of the ring; when that's taken, the first free row below it
    let x=q[0]+13, y=q[1]+16, n=0; while(hits(x-2,y-13,x+w+2,y+5)&&n<60){ y+=rowH; n++; }
    // a long way down: try the left side too, and keep whichever is nearer its place
    if(n>3){ const xl=q[0]-13-w; let yl=q[1]+16, k=0; while(hits(xl-2,yl-13,xl+w+2,yl+5)&&k<60){ yl+=rowH; k++; } if(k<n){ x=xl; y=yl; n=k; } }
    placed.push([x-2,y-13,x+w+2,y+5]);
    if(n){ const toLeft=x<q[0], ex=toLeft?x+w+4:x-4;
      ctx.save(); ctx.globalAlpha=.55; ctx.strokeStyle=m.color; ctx.lineWidth=1; ctx.beginPath();
      ctx.moveTo(q[0]+(toLeft?-6:6),q[1]+6); ctx.lineTo(ex,y-4); ctx.stroke(); ctx.restore(); }
    label(text,x,y,{color:m.color,font,force:true}); } }
function label(text,x,y,{color="#c3cee0",font="500 12px 'Inter',Segoe UI,sans-serif",force=false,align="left"}={}){
  ctx.font=font; const w=ctx.measureText(text).width, h=14, lx=align==="center"?x-w/2:x;
  if(!force && !labelFree(lx-2,y-h+3,w+4,h+2)) return false; if(force) labelBoxes.push([lx-2,y-h+3,lx+w+2,y+5]);
  ctx.fillStyle="rgba(5,8,15,.85)"; ctx.fillText(text,lx+1,y+1); ctx.fillStyle=color; ctx.fillText(text,lx,y); return true; }
function glyph(type,x,y,r,color){
  ctx.save(); ctx.strokeStyle=color; ctx.fillStyle=color; ctx.lineWidth=1.6;
  switch(type){
    case "city": ctx.fillRect(x-r,y-r,2*r,2*r); break;
    case "station": ctx.beginPath(); ctx.moveTo(x,y-r-1.5); ctx.lineTo(x+r+1.5,y); ctx.lineTo(x,y+r+1.5); ctx.lineTo(x-r-1.5,y); ctx.closePath(); ctx.stroke(); break;
    case "cave": ctx.beginPath(); ctx.moveTo(x,y-r); ctx.lineTo(x+r,y+r*.8); ctx.lineTo(x-r,y+r*.8); ctx.closePath(); ctx.fill(); break;
    case "wreck": ctx.beginPath(); ctx.moveTo(x-r,y-r); ctx.lineTo(x+r,y+r); ctx.moveTo(x+r,y-r); ctx.lineTo(x-r,y+r); ctx.stroke(); break;
    case "field": ctx.setLineDash([2,2]); ctx.beginPath(); ctx.arc(x,y,r,0,7); ctx.stroke(); break;
    case "comm": ctx.strokeRect(x-r*.8,y-r*.8,1.6*r,1.6*r); break;
    case "jump": ctx.lineWidth=2; ctx.beginPath(); ctx.arc(x,y,r+1.5,0,7); ctx.stroke(); ctx.beginPath(); ctx.arc(x,y,r-1.5,0,7); ctx.stroke(); break;
    case "om": case "lpoint": ctx.beginPath(); ctx.arc(x,y,r*.9,0,7); ctx.moveTo(x-r-2,y); ctx.lineTo(x+r+2,y); ctx.moveTo(x,y-r-2); ctx.lineTo(x,y+r+2); ctx.stroke(); break;
    default: ctx.beginPath(); ctx.arc(x,y,r*.8,0,7); ctx.fill();
  } ctx.restore(); }
function flag(x,y,color,big){ const s=big?1.25:1; ctx.save(); ctx.strokeStyle="#05080f"; ctx.lineWidth=1.5; ctx.fillStyle=color;
  ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(x,y-18*s); ctx.lineTo(x+11*s,y-14*s); ctx.lineTo(x,y-10*s); ctx.closePath(); ctx.stroke(); ctx.fill();
  ctx.strokeStyle=color; ctx.lineWidth=1.6; ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(x,y-18*s); ctx.stroke(); ctx.restore(); }
function diamond(x,y,color){ ctx.save(); ctx.translate(x,y-15); ctx.fillStyle=color; ctx.strokeStyle="#05080f"; ctx.lineWidth=1.5;
  ctx.beginPath(); ctx.moveTo(0,9); ctx.lineTo(-7,0); ctx.lineTo(0,-8); ctx.lineTo(7,0); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
  ctx.strokeStyle="rgba(255,95,168,.7)"; ctx.beginPath(); ctx.moveTo(x,y-6); ctx.lineTo(x,y); ctx.stroke(); }

// Active contract objectives with a map position in the current system.
function missionMarks(t){
  const out=[]; if(!S.live||!S.show.missions) return out;
  for(const c of S.live.contracts) if(c.status==="active") for(const o of c.objectives){ if(o.status!=="active") continue;
    let g=null, body=null;
    if(o.marker && o.marker.system===S.system && !o.marker.body){ g=o.marker.pos; }          // rest stop at a Lagrange point
    else if(o.marker && o.marker.system===S.system && S.bodyMap[o.marker.body]){ body=o.marker.body; g=toGlobal(S.bodyMap[body],o.marker.pos,t); }
    else if(o.location && S.locMap[o.location]?.system===S.system){ const L=S.locMap[o.location]; g=globalPos(L,t); body=L.body; }
    if(g) out.push({c,o,g,body}); }
  return out; }

// A path through the route, sampled so surface legs follow the planet's curve.
function legSamples(a,b,t){ // a,b: {g, body, local}
  if(a.body && a.body===b.body && a.local && b.local && S.bodyMap[a.body]){ const B=S.bodyMap[a.body], ra=Math.hypot(...a.local), rb=Math.hypot(...b.local), chord=d3(a.local,b.local);
    const hump=Math.min(B.radius*0.004, chord*0.03)+30;   // keep the arc just above the ground
    const n=Math.min(120,Math.max(12,Math.round(chord/B.radius*80))); const pts=[];
    for(let i=0;i<=n;i++){ const f=i/n; const R=ra+(rb-ra)*f+hump*Math.sin(Math.PI*f); pts.push({g:toGlobal(B,slerpLocal(a.local,b.local,f,R),t),body:a.body}); } return pts; }
  const pts=[]; for(let i=0;i<=24;i++){ const f=i/24; pts.push({g:[0,1,2].map(k=>a.g[k]+(b.g[k]-a.g[k])*f), body:null}); } return pts; }
function nodeOf(name,t){ const L=S.locMap[name];
  if(!L){ const b=S.bodyMap?.[name]; return b&&b.center&&b.system===S.system?{g:b.center,body:null,local:null}:null; }      // a planet or moon (map marks)
  if(!L.pos||L.system!==S.system) return null; return {g:globalPos(L,t), body:L.kind==="surface"?L.body:null, local:L.kind==="surface"?L.pos:null}; }
// On a planet you turn with it, so place the last reading by its ground position, not its old space position.
function playerG(t){ const p=S.live?.player; if(!p) return null; return p.body&&p.local&&S.bodyMap[p.body] ? toGlobal(S.bodyMap[p.body],p.local,t) : p.pos; }
function playerNode(){ const p=S.live?.player;
  if(p&&p.system===S.system){ S.lastPN={sys:p.system, body:p.body, local:p.local, pos:p.pos, at:Date.now()}; return {g:playerG(now()), body:p.body, local:p.local}; }
  // Your position dropped out for a moment (or the log briefly named another system): keep the route and guide
  // lines drawn from where you were last seen, for up to 10 minutes, instead of losing them until the next reading.
  const L=S.lastPN; if(!L||L.sys!==S.system||S.live?.game_off||Date.now()-L.at>600000) return null;
  const B=L.body&&L.local&&S.bodyMap[L.body]; return {g:B?toGlobal(B,L.local,now()):L.pos, body:L.body, local:L.local, stale:true}; }
function strokePath(samples,{color,width,glow,dash=null,offset=0,alpha=1}){
  let prev=null; const segs=[]; let cur=[];
  for(const s of samples){ const q=proj(s.g); const vis=q&&visible(s.g,s.body); if(vis){ cur.push(q); } else { if(cur.length>1) segs.push(cur); cur=[]; } }
  if(cur.length>1) segs.push(cur);
  ctx.save(); ctx.lineCap="round"; ctx.lineJoin="round"; ctx.globalAlpha=alpha;
  for(const seg of segs){ if(glow){ ctx.strokeStyle=glow; ctx.lineWidth=width+6; ctx.beginPath(); seg.forEach((q,i)=>i?ctx.lineTo(q[0],q[1]):ctx.moveTo(q[0],q[1])); ctx.stroke(); }
    ctx.strokeStyle=color; ctx.lineWidth=width; if(dash){ ctx.setLineDash(dash); ctx.lineDashOffset=offset; }
    ctx.beginPath(); seg.forEach((q,i)=>i?ctx.lineTo(q[0],q[1]):ctx.moveTo(q[0],q[1])); ctx.stroke(); ctx.setLineDash([]); }
  ctx.restore(); }

// Distance rings on the ground around the view point (only when close to a surface).
function drawRangeRings(t){
  if(!S.show.rings) return;                                                    // Layers > Distance rings
  if(city3dInCity()) return;                  // hidden while you're in a 3D city (they cut across the buildings); back when you leave
  const sb=surfaceBodyOf(S.focus); if(!sb) return; const B=S.bodyMap[sb]; if(S.cam.dist>B.radius*0.4) return;
  const c=toLocal(B,S.cam.target,t), R=Math.hypot(...c), up=norm3(c); let east=cross3([0,0,1],up); if(Math.hypot(...east)<1e-6) east=[1,0,0]; east=norm3(east); const north=cross3(up,east);
  const target=S.cam.dist*0.35, p10=Math.pow(10,Math.floor(Math.log10(target))); let step=p10; for(const m of [1,2,5]) if(m*p10<=target) step=m*p10;
  ctx.save(); ctx.font="600 11px 'Exo 2',sans-serif";
  for(let k=1;k<=3;k++){ const rr=step*k, ang=rr/R; let first=null, prev=null; ctx.strokeStyle="rgba(200,220,255,.22)"; ctx.lineWidth=1; ctx.setLineDash([3,5]); ctx.beginPath();
    for(let i=0;i<=96;i++){ const a=i/96*Math.PI*2, dir=[0,1,2].map(j=>Math.cos(a)*east[j]+Math.sin(a)*north[j]);
      const pl=[0,1,2].map(j=>(up[j]*Math.cos(ang)+dir[j]*Math.sin(ang))*R); const q=proj(toGlobal(B,pl,t)); if(!q){ prev=null; continue; }
      if(prev) ctx.lineTo(q[0],q[1]); else ctx.moveTo(q[0],q[1]); prev=q; }
    ctx.stroke(); ctx.setLineDash([]);
    const lp=[0,1,2].map(j=>(up[j]*Math.cos(ang)-east[j]*Math.sin(ang))*R); const q=proj(toGlobal(B,lp,t)); if(q){ ctx.fillStyle="rgba(200,220,255,.55)"; ctx.fillText(fmtDist(rr),q[0]+4,q[1]-4); } }
  // north tick
  const np=[0,1,2].map(j=>(up[j]*Math.cos(step*3.4/R)+north[j]*Math.sin(step*3.4/R))*R); const qn=proj(toGlobal(B,np,t));
  if(qn){ ctx.fillStyle="rgba(127,231,255,.8)"; ctx.font="700 13px 'Exo 2',sans-serif"; ctx.textAlign="center"; ctx.fillText("N",qn[0],qn[1]+4); ctx.textAlign="left"; }
  ctx.restore(); }
// Arrow at the screen edge pointing to an off-screen target.
function edgeArrow(g,color,text){
  V3.set(g[0]-O[0],g[1]-O[1],g[2]-O[2]).applyMatrix4(camera.matrixWorldInverse); const behind=V3.z>0;
  const q=proj(g); if(q && q[0]>30 && q[0]<W-30 && q[1]>30 && q[1]<H-30) return;
  let dx,dy; if(q&&!behind){ dx=q[0]-W/2; dy=q[1]-H/2; } else { dx=V3.x*(behind?-1:1); dy=-V3.y*(behind?-1:1); if(behind){ dx=-dx; dy=-dy; } }
  const L=Math.hypot(dx,dy)||1; dx/=L; dy/=L; const m=40, k=Math.min((W/2-m)/Math.abs(dx||1e-9),(H/2-m)/Math.abs(dy||1e-9)); const x=W/2+dx*k, y=H/2+dy*k;
  ctx.save(); ctx.translate(x,y); ctx.rotate(Math.atan2(dy,dx)); ctx.fillStyle=color; ctx.beginPath(); ctx.moveTo(12,0); ctx.lineTo(-7,-8); ctx.lineTo(-3,0); ctx.lineTo(-7,8); ctx.closePath(); ctx.fill(); ctx.restore();
  ctx.font="600 12px 'Exo 2',sans-serif"; const w=ctx.measureText(text).width;
  const lx=Math.min(Math.max(x-dx*22-(dx>0?w:dx<0?0:w/2),8),W-w-8), ly=Math.min(Math.max(y-dy*22+4,18),H-8);
  label(text,lx,ly,{color,font:"600 12px 'Exo 2',sans-serif",force:true}); }
function drawOverlay(t){
  ctx.clearRect(0,0,W,H); labelBoxes=[]; S.picks=[];
  if(!S.bodies.length){ ctx.fillStyle="#7684a0"; ctx.font="500 15px 'Inter',sans-serif"; ctx.textAlign="center";
    ctx.fillText("No map data yet. Run  python import_data.py  and restart the app.",W/2,H/2); ctx.textAlign="left"; return; }
  prepOcclusion();
  // While a trade run is previewed, the map shows only that run: your Route and the guide line come back when it closes.
  // A trade preview or a commodity's terminals on the map show just that: your own route stays hidden meanwhile
  const solo=!!(S.preview||S.mapMarks), live=S.live, route=solo?[]:(live?.route||[]), stopIdx=Object.fromEntries(route.map((n,i)=>[n,i+1]));
  const f=H/2/Math.tan(camera.fov*Math.PI/360);
  drawRangeRings(t);
  // ---- route & guide paths (under the markers)
  const dash=(performance.now()/60)%20;
  // After "Plan route" the path draws itself stop by stop.
  const rv=S.reveal?Math.min(1,Math.max(0,(performance.now()-S.reveal-700)/(700+route.length*260))):1; if(rv>=1) S.reveal=null;
  const P=rv*route.length; S.revealP=P;
  if(route.length){ let prev=playerNode(); route.forEach((n,i)=>{ const nd=nodeOf(n,t); const f=Math.min(1,Math.max(0,P-i));
      if(prev&&nd&&f>0){ let smp=legSamples(prev,nd,t); if(f<1) smp=smp.slice(0,Math.max(2,Math.ceil(smp.length*f)));
        strokePath(smp,{color:"#4b8dff",width:i===0?2.8:2,glow:"rgba(75,141,255,.24)",dash:i===0?[10,9]:[6,6],offset:i===0?-dash:0}); }
    prev=nd||prev; }); }
  const guide=solo?null:live?.guide; let gnode=null;
  if(guide && S.locMap[guide.name]){ gnode=nodeOf(guide.name,t); const pn=playerNode(); if(gnode&&pn) strokePath(legSamples(pn,gnode,t),{color:"#7fe7ff",width:2.4,glow:"rgba(127,231,255,.18)",dash:[4,7],offset:-dash}); }
  if(S.preview){ let prev=nodeOf(S.preview[0],t)?playerNode():null; for(const n of S.preview){ const nd=nodeOf(n,t);
      if(prev&&nd) strokePath(legSamples(prev,nd,t),{color:"#57e39b",width:2.6,glow:"rgba(87,227,155,.22)",dash:[9,8],offset:-dash}); prev=nd||prev; } }
  // ---- bodies: dots and labels when small, labels always
  const bodyLabels=[];
  for(const o of sysObjs){ const b=o.b, q=proj(b.center); if(!q) continue; const pr=o.pr;
    if(city3dDown()&&!visible(b.center,null)) continue;   // below the city's horizon
    if(pr<3){ ctx.fillStyle=b.kind==="star"?"#ffd98a":"#8fa9d0"; ctx.beginPath(); ctx.arc(q[0],q[1],b.kind==="planet"?3.2:b.kind==="star"?4:2.2,0,7); ctx.fill(); }
    S.picks.push({kind:"body",name:b.name,x:q[0],y:q[1],r:Math.max(pr,8),pr,depth:q[2]});
    bodyLabels.push([b,q,pr]); }
  // ---- locations
  const drawn=[];
  const selName=S.selected?.kind==="loc"?S.selected.name:null;
  for(const L of S.locs){ if(L.system!==S.system||!L.pos) continue;
    const special = stopIdx[L.name] || L.name===selName || L.name===guide?.name || S.preview?.includes(L.name) || S.mapMarks?.some(m=>m.name===L.name);
    const isWp = L.source==="user" || L.source==="mission";
    if(!special){ if(isWp){ if(!S.show.waypoints || (L.source==="user"&&!L.pinned)) continue; } else if(!S.layers[L.type]) continue;
      if(L.mergedInto && S.layers[S.locMap[L.mergedInto]?.type]) continue; }   // shown as its station
    // Orbital markers float well clear of the planet, so they show from further out than ground places.
    let bodyPx=Infinity; if(L.kind==="surface"){ const o=sysObjs.find(o=>o.b.name===L.body); bodyPx=o?o.pr:0; if(bodyPx < (isWp?6:L.type==="om"?14:70) && !special) continue; }
    const g=globalPos(L,t), q=proj(g); if(!q||q[0]<-40||q[0]>W+40||q[1]<-40||q[1]>H+40) continue;
    if(city3dDown() && !special && L.kind==="space" && q[2]>5e5) continue;   // in the 3D city, far stations don't fill its sky
    if(!visible(g, L.kind==="surface"?L.body:null)) continue;
    drawn.push({L,q,bodyPx,isWp}); }
  for(const d of drawn){ const {L,q,isWp}=d; if(isWp) continue; glyph(L.type,q[0],q[1],L.type==="city"?4.5:3.6,TYPES[L.type]?.color||"#aab"); S.picks.push({kind:"loc",name:L.name,x:q[0],y:q[1],r:9,depth:q[2]}); }
  // ---- mission markers
  const marks=missionMarks(t);
  for(const m of marks){ const q=proj(m.g); if(!q||!visible(m.g,m.body)) continue; diamond(q[0],q[1],"#ff5fa8");
    S.picks.push({kind:"mission",name:m.o.location||m.o.label,x:q[0],y:q[1]-15,r:10,mission:m,depth:q[2]}); labelBoxes.push([q[0]-8,q[1]-25,q[0]+8,q[1]]); }
  // ---- waypoints (flags)
  for(const d of drawn){ if(!d.isWp) continue; const {L,q}=d; flag(q[0],q[1],L.source==="mission"?"#ff5fa8":"#9dff7a",L.name===guide?.name);
    S.picks.push({kind:"loc",name:L.name,x:q[0]+4,y:q[1]-12,r:12,depth:q[2]}); labelBoxes.push([q[0]-2,q[1]-20,q[0]+14,q[1]]); }
  // ---- route waypoint numbers
  const seen=new Set();
  route.forEach((n,i)=>{ if(P<i+0.999||seen.has(n)) return; const nd=nodeOf(n,t); if(!nd) return; const q=proj(nd.g); if(!q||!visible(nd.g,nd.body)) return;
    seen.add(n); const nums=route.map((m,k)=>m===n&&P>=k+0.999?k+1:0).filter(Boolean).join(" · ");
    ctx.font="700 11px 'Exo 2',sans-serif"; const bw=Math.max(20,ctx.measureText(nums).width+12);
    ctx.beginPath(); if(ctx.roundRect) ctx.roundRect(q[0]-bw/2,q[1]-10,bw,20,10); else ctx.arc(q[0],q[1],10,0,7);
    ctx.fillStyle=i===0?"#4b8dff":"#05080f"; ctx.fill(); ctx.lineWidth=2; ctx.strokeStyle="#4b8dff"; ctx.stroke();
    ctx.fillStyle=i===0?"#ffffff":"#4b8dff"; ctx.textAlign="center"; ctx.fillText(nums,q[0],q[1]+4); ctx.textAlign="left";
    S.picks.push({kind:"loc",name:n,x:q[0],y:q[1],r:11,depth:q[2]}); labelBoxes.push([q[0]-bw/2,q[1]-11,q[0]+bw/2,q[1]+11]);
    label(n,q[0]+bw/2+4,q[1]+4,{color:"#bcd9ff",font:"600 12.5px 'Inter',sans-serif",force:i===0}); });
  // ---- player
  const pn=playerNode();
  if(pn){ const q=proj(pn.g); if(q&&visible(pn.g,pn.body)){ const ph=(performance.now()/1400)%1;
    ctx.strokeStyle=`rgba(127,231,255,${.55*(1-ph)})`; ctx.lineWidth=2; ctx.beginPath(); ctx.arc(q[0],q[1],7+ph*18,0,7); ctx.stroke();
    if(S.live.player?.approx||pn.stale){ ctx.save(); ctx.setLineDash([3,3]); ctx.strokeStyle="#7fe7ff"; ctx.lineWidth=1.5; ctx.beginPath(); ctx.arc(q[0],q[1],12,0,7); ctx.stroke(); ctx.restore(); }
    ctx.fillStyle="#7fe7ff"; ctx.beginPath(); ctx.arc(q[0],q[1],5.5,0,7); ctx.fill(); ctx.strokeStyle="#05080f"; ctx.lineWidth=2; ctx.stroke();
    labelBoxes.push([q[0]-10,q[1]-10,q[0]+10,q[1]+10]); label(pn.stale?"You (last seen)":"You",q[0]+10,q[1]-8,{color:"#7fe7ff",font:"700 12px 'Exo 2',sans-serif",force:true});
    // The place you're at sits under the "You" marker: name it just below "You" so both show.
    const under=drawn.filter(d=>!d.isWp).map(d=>[d,Math.hypot(d.q[0]-q[0],d.q[1]-q[1])]).filter(x=>x[1]<24).sort((a,b)=>a[1]-b[1])[0]?.[0];
    S.youAt=under?.L.name||null;
    if(under) label(under.L.name,q[0]+10,q[1]+8,{color:under.L.type==="city"?"#ffffff":"#c3cee0",font:"600 12px 'Inter',sans-serif",force:true}); }
    else S.youAt=null; } else S.youAt=null;
  // ---- friends sharing their location (friendmap.js)
  drawFriends(t);
  // ---- selection ring
  if(selName){ const p=S.picks.find(p=>p.kind==="loc"&&p.name===selName); if(p){ ctx.strokeStyle="#7fe7ff"; ctx.lineWidth=2; ctx.beginPath(); ctx.arc(p.x,p.y,14,0,7); ctx.stroke();
    labelBoxes.push([p.x-14,p.y-14,p.x+14,p.y+14]); if(!stopIdx[selName]) label(selName,p.x+17,p.y+4,{color:"#7fe7ff",font:"600 13px 'Inter',sans-serif",force:true}); } }
  // ---- labels, by priority
  if(S.mapMarks) drawMarkLabels(t);
  if(S.preview) for(const n of S.preview){ const nd=nodeOf(n,t), q=nd&&proj(nd.g); if(!q) continue;
    ctx.beginPath(); ctx.arc(q[0],q[1],9,0,Math.PI*2); ctx.strokeStyle="#57e39b"; ctx.lineWidth=2; ctx.stroke();
    label(`${S.previewLabels?.[n]||""} · ${n}`,q[0]+14,q[1]+18,{color:"#8ff0bd",font:"600 12.5px 'Inter',sans-serif",force:true}); }
  for(const d of drawn){ if(!d.isWp||stopIdx[d.L.name]||d.L.name===selName) continue; label(d.L.name,d.q[0]+14,d.q[1]-8,{color:d.L.source==="mission"?"#ffb3d6":"#c9ffb3",font:"600 12px 'Inter',sans-serif"}); }
  bodyLabels.sort((a,b)=>b[0].radius-a[0].radius);
  for(const [b,q,pr] of bodyLabels){ if(b.kind==="moon"&&pr<1.2&&S.cam.dist>2e10) continue;
    if(city3dDown()) continue;               // down in a 3D city: other worlds' names don't float over the ground
    label(b.name,q[0],q[1]-Math.max(pr,4)-8,{color:b.kind==="star"?"#ffd98a":"#9fb8dd",font:"600 13px 'Exo 2',Bahnschrift,sans-serif",align:"center",force:b.kind!=="moon"}); }
  for(const d of drawn){ if(d.isWp||stopIdx[d.L.name]||d.L.name===selName||d.L.name===S.youAt) continue;
    if(d.L.type==="om"){ if(d.bodyPx>=40) label(d.L.name.replace(/\s*\(.*\)$/,""),d.q[0]+8,d.q[1]+4,{color:TYPES.om.color}); continue; }
    if(d.L.kind==="surface"&&d.bodyPx<220&&d.L.type!=="city"&&!(d.L.type==="station"&&S.bodyMap[d.L.body]?.kind==="asteroid")) continue;
    label(d.L.name,d.q[0]+8,d.q[1]+4,{color:d.L.type==="city"?"#ffffff":"#b7c3d8",font:d.L.type==="city"?"600 12.5px 'Inter',sans-serif":undefined}); }
  // ---- off-screen pointers for the guide target and next stop
  if(gnode) edgeArrow(gnode.g,"#7fe7ff",`${guide.name}${guide.ground!=null?" · "+fmtDist(guide.ground):guide.distance!=null?" · "+fmtDist(guide.distance):""}`);
  // camera readout
  const lk=S.cam.lock?` · locked to ${S.cam.lock}`:""; $("camtxt").textContent=`view distance ${fmtDist(S.cam.dist)}${lk}`;
}

// =================================================================== frame
let frame=function(){
  const t=now()+(S.timeShift||0); S.frameT=t; updateCamera(t);     // timeShift: the 3D city's time-of-day preview
  for(const o of sysObjs){ place(o.group,o.b.center); o.spin.rotation.z=bodyAngle(o.b,t);
    if(o.grid) o.grid.visible=S.show.grid && o.pr>40;
    if(o.orbit){ o.orbit.visible=S.show.orbits && S.cam.dist>o.orbitR*0.04; o.orbit.position.set(o.par.center[0]-O[0],o.par.center[1]-O[1],o.orbitZ-O[2]); } }
  const star=sysObjs.find(o=>o.b.kind==="star"); const sp=star?star.b.center:[0,0,0];
  sun.position.set(sp[0]-O[0],sp[1]-O[1],sp[2]-O[2]); sun.target.position.set(0,0,0); sun.target.updateMatrixWorld();
  updateStations(t);
  starfield.position.copy(camera.position); starfield.material.uniforms.T.value=performance.now()/1000; starfield.material.uniforms.PR.value=DPR;
  if(star) star.mesh.material.uniforms.T.value=performance.now()/1000;
  for(const m of PLANET_MATS){ m.uniforms.SUN.value.set(sp[0]-O[0],sp[1]-O[1],sp[2]-O[2]); if(m.uniforms.T) m.uniforms.T.value=performance.now()/1000; }
  for(const c of CITIES3D){ try{ c.update(t); }catch(e){ reportFrameError(e); } }   // 3D cities (city3d-NewBabbage.js, ...)
  renderer.render(scene,camera);
  drawOverlay(t);
}
// The render loop asks for its next frame before drawing this one, and a drawing error is caught and
// reported, so one bad value (a contract marker, a reading) can't stop the map for good: it would
// freeze on the last frame while the rest of the app kept working.
// The map draws only as often as it needs to. Star Citizen caps its own frame rate; a browser canvas
// otherwise redraws at the monitor's full refresh rate (60, 144, 240 times a second) whether anything
// moved or not, and that's what had Quantum's map at 100% GPU. So: full speed while you drag, zoom or fly
// (capped at Settings > Map frame rate), a gentle 30 a second when the map just sits there, 10 when
// Quantum isn't the focused window (the game on another monitor, say), and nothing at all when the map
// can't be seen: behind the game, minimised, in the tray, or under a full-page tab (Fleet, Components…).
// The picture itself is drawn exactly as before, so there's no loss of quality.
const _frame=frame;
const GOV={last:0, active:0, covered:false};
S.fpsMax=(()=>{ try{ const v=+localStorage.getItem("q-fps"); return [30,60,0].includes(v)&&localStorage.getItem("q-fps")!==null?v:60; }catch{ return 60; } })();
// Orbit line colour (Settings > Map look). Kept on this PC; changes the rings already drawn straight away.
const ORBIT_DEFAULT="#4fb6e0";
const ORBIT_PRESETS=[["#4fb6e0","Quantum blue"],["#8cc4ff","Pale blue"],["#7fe7c4","Teal"],["#f2c14e","Amber"],["#ff8a5c","Orange"],["#c79bff","Violet"],["#e6edf7","White"]];
S.orbitColor=(()=>{ try{ const v=localStorage.getItem("q-orbit-color"); return /^#[0-9a-f]{6}$/i.test(v||"")?v:ORBIT_DEFAULT; }catch{ return ORBIT_DEFAULT; } })();
function setOrbitColor(v,save=true){ if(!/^#[0-9a-f]{6}$/i.test(v||"")) return; S.orbitColor=v.toLowerCase();
  for(const o of sysObjs) if(o.orbit) o.orbit.material.color.set(S.orbitColor);
  if(save){ try{ localStorage.setItem("q-orbit-color",S.orbitColor); }catch{} }
  for(const b of document.querySelectorAll("[data-orbitc]")) b.classList.toggle("on",b.dataset.orbitc===S.orbitColor);
  mapBusy(); }
function setMapFps(v){ S.fpsMax=+v; try{ localStorage.setItem("q-fps",String(S.fpsMax)); }catch{} mapBusy(); }
function mapBusy(){ GOV.active=performance.now(); }
for(const ev of ["pointerdown","pointermove","wheel","keydown","input"]) window.addEventListener(ev,mapBusy,{capture:true,passive:true});
window.addEventListener("resize",mapBusy);
window.addEventListener("focus",()=>{ GOV.covered=false; mapBusy(); });
document.addEventListener("visibilitychange",mapBusy);
setInterval(async()=>{ if(document.hasFocus()){ GOV.covered=false; return; }
  try{ GOV.covered=!!(await api().map_covered()); }catch(_){ GOV.covered=false; } },1000);
function mapHidden(){ return S.splashUp || document.hidden || GOV.covered
  || !!document.querySelector("#mapwrap > .pic-panel.show, #vh-gallery.show"); }
function mapFps(){ if(mapHidden()) return 0;
  const max=S.fpsMax||1000;                                             // 0 = the monitor's refresh rate
  if(drag||S.anim||performance.now()-GOV.active<1500) return max;      // you're moving the map, or it's flying
  return Math.min(max, document.hasFocus()?30:10); }
frame=function(ts){ requestAnimationFrame(frame);
  const fps=mapFps(); if(!fps) return;
  const iv=1000/fps, el=ts-GOV.last; if(el<iv-1) return;
  GOV.last=el>iv*4?ts:ts-(el%iv);                                       // keeps an even pace on 144 Hz screens
  try{ _frame(); }
  catch(e){ reportFrameError(e); try{ ctx.restore(); }catch(_){} } };
function reportFrameError(e){ const msg=String(e&&e.stack||e).slice(0,1500), k=msg.slice(0,200);
  S.frameErrs=S.frameErrs||{}; if(S.frameErrs[k]) return; S.frameErrs[k]=1; console.error(e);
  try{ api().js_error("map", msg); }catch(_){} }

// =================================================================== input
let drag=null, moved=false;
const ov=$("overlay");
ov.addEventListener("contextmenu",e=>e.preventDefault());
// The view's centre is a free point in space (after panning, say) but sits on or just above a planet:
// make it a place on that planet instead, so the view turns with the planet (a fixed point in space has
// the planet rotating away under it, and the view drifts) and dragging works the ground's way. The
// camera keeps looking the same way.
// Put the camera on B's ground at G without the picture moving at all: same view direction d (centre to
// camera) and same screen up u. Pitch and heading come from d (from u when looking straight down, where d
// has no heading); the roll takes up whatever is left, so the planet doesn't turn as you scroll in.
function enterGround(B,G,d,u){ const {up,east,north}=groundAxes(B,G);
  const du=d[0]*up[0]+d[1]*up[1]+d[2]*up[2], uu=u[0]*up[0]+u[1]*up[1]+u[2]*up[2];
  let h=[0,1,2].map(i=>d[i]-du*up[i]); if(Math.hypot(...h)<1e-4) h=[0,1,2].map(i=>-(u[i]-uu*up[i]));
  const he=h[0]*east[0]+h[1]*east[1]+h[2]*east[2], hn=h[0]*north[0]+h[1]*north[1]+h[2]*north[2];
  S.cam.lock=null; S.cam.pitch=Math.max(-1.5707,Math.min(1.5707,Math.asin(Math.max(-1,Math.min(1,du)))));
  if(Math.hypot(he,hn)>1e-12) S.cam.yaw=Math.atan2(hn,he);
  const f=groundFrame(B,G,S.cam.pitch,S.cam.yaw,0), x=cross3(f.up,u);
  S.cam.roll=Math.atan2(x[0]*f.dir[0]+x[1]*f.dir[1]+x[2]*f.dir[2], f.up[0]*u[0]+f.up[1]*u[1]+f.up[2]*u[2]); }
// Scrolling onto the ground keeps the picture still with a roll, but right-drag turns and tilts about the
// ground's own heading: with a roll left in, dragging down tilted the view sideways (it looked stuck and
// wobbly). So a right-drag first hands the roll over to the heading, over a few moves: the screen's up
// stays where it is and the turning follows the mouse again.
function unroll(){ const sb=surfaceBodyOf(S.focus), B=S.bodyMap[sb], r=S.cam.roll||0; if(!B||!r) return;
  const G=S.cam.target, f=groundFrame(B,G,S.cam.pitch,S.cam.yaw,r), {up,east,north}=groundAxes(B,G);
  const uu=f.up[0]*up[0]+f.up[1]*up[1]+f.up[2]*up[2], h=[0,1,2].map(i=>-(f.up[i]-uu*up[i]));   // the heading that has this screen up
  const he=h[0]*east[0]+h[1]*east[1]+h[2]*east[2], hn=h[0]*north[0]+h[1]*north[1]+h[2]*north[2];
  if(Math.hypot(he,hn)<1e-9||Math.abs(r)<0.01){ S.cam.roll=0; return; }
  const want=Math.atan2(hn,he), dy=Math.atan2(Math.sin(want-S.cam.yaw),Math.cos(want-S.cam.yaw));
  const k=Math.abs(r)<0.05?1:0.35; S.cam.yaw+=dy*k; S.cam.roll=r*(1-k); }
function screenUp(){ const v=new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,1); return norm3([v.x,v.y,v.z]); }
function attachToGround(){ if(S.focus.kind!=="point") return; const t=viewT(); let G=S.cam.target;
  const B=S.bodies.find(b=>b.system===S.system&&b.kind!=="star"&&b.kind!=="asteroid"&&d3(G,b.center)<b.radius*1.15); if(!B) return;
  const d=norm3([camera.position.x,camera.position.y,camera.position.z]);
  // Grabbed during the last part of a fly-in to a planet, the view's centre is still inside it (the glide
  // heads for the planet's middle). A point in the core turns with the planet and swung the whole view
  // round (Bloom spinning wildly). Slide it back along the line of sight to where that meets the ground:
  // the picture doesn't move, and dragging then rolls the ground as it should.
  if(d3(G,B.center)<B.radius*0.999){ const P=[0,1,2].map(i=>G[i]+d[i]*S.cam.dist), oc=[0,1,2].map(i=>P[i]-B.center[i]);
    const bq=oc[0]*d[0]+oc[1]*d[1]+oc[2]*d[2], disc=bq*bq-(oc[0]*oc[0]+oc[1]*oc[1]+oc[2]*oc[2]-B.radius*B.radius);
    if(disc>=0&&bq-Math.sqrt(disc)>20){ const s=bq-Math.sqrt(disc); G=[0,1,2].map(i=>P[i]-d[i]*s); S.cam.dist=s; }
    else { G=[0,1,2].map(i=>B.center[i]+d[i]*B.radius); S.cam.dist=Math.max(20,d3(P,G)); }   // looking past its edge: the near side
    S.cam.target=G; }                                // the drag that follows in this same event reads it
  enterGround(B,G,d,screenUp());
  S.anim=null; S.focus={kind:"local",body:B.name,pos:toLocal(B,G,t)}; }
// Drag the planet under the cursor: the point you look at slides across the globe, so you can
// roam freely instead of circling one fixed spot. Works from ground level up to orbit.
function grabGlobe(dx,dy){
  const sb=surfaceBodyOf(S.focus), B=S.bodyMap[sb]; if(!B) return; const t=viewT();
  const G=S.cam.target, C=B.center, R0=Math.max(d3(G,C),B.radius*0.5);
  const k=Math.min(S.cam.dist,B.radius*3)*2*Math.tan(camera.fov*Math.PI/360)/H;   // metres per pixel at the ground
  const rt=new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,0), up=new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,1);
  let mv=[-(rt.x*dx-up.x*dy)*k, -(rt.y*dx-up.y*dy)*k, -(rt.z*dx-up.z*dy)*k];
  const L=Math.hypot(...mv), cap=R0*0.3; if(L>cap) mv=mv.map(v=>v*cap/L);           // no wild jumps
  const dir=norm3([G[0]+mv[0]-C[0],G[1]+mv[1]-C[1],G[2]+mv[2]-C[2]]);
  S.anim=null; S.focus={kind:"local",body:sb,pos:toLocal(B,[C[0]+dir[0]*R0,C[1]+dir[1]*R0,C[2]+dir[2]*R0],t)};
}
// Grabbing the map always wins: an unfinished fly-in stops where it is.
function stopAnim(){ if(!S.anim) return;
  const sb=surfaceBodyOf(S.focus);
  if(sb&&S.bodyMap[sb]){ S.anim=null; S.focus={kind:"local",body:sb,pos:toLocal(S.bodyMap[sb],S.cam.target,viewT())}; return; }  // stay on the globe
  const d=norm3([camera.position.x,camera.position.y,camera.position.z]);
  S.anim=null; S.focus={kind:"point",pos:[...S.cam.target]}; setLock(null); S.cam.yaw=Math.atan2(d[1],d[0]); S.cam.pitch=Math.asin(d[2]); }
ov.addEventListener("pointerdown",e=>{ stopAnim(); if(S.follow) setFollow(false); drag={x:e.clientX,y:e.clientY,pan:e.button===1||e.shiftKey,turn:e.button===2}; if(e.button===1) e.preventDefault(); moved=false; ov.classList.add("dragging");
  try{ ov.setPointerCapture(e.pointerId); }catch(_){} $("help").style.display="none"; });
const endDrag=()=>{ drag=null; ov.classList.remove("dragging"); };
window.addEventListener("pointerup",endDrag); window.addEventListener("pointercancel",endDrag);
window.addEventListener("pointermove",e=>{
  const r=ov.getBoundingClientRect(), mx=e.clientX-r.left, my=e.clientY-r.top;
  if(drag){ const dx=e.clientX-drag.x, dy=e.clientY-drag.y; if(Math.abs(dx)+Math.abs(dy)>2) moved=true; drag.x=e.clientX; drag.y=e.clientY;
    if(!surfaceBodyOf(S.focus)) attachToGround();                    // a free point just above a planet: back onto its ground
    const surf=!!surfaceBodyOf(S.focus);
    if(surf && !drag.turn){ grabGlobe(dx,dy); }                       // near a planet: drag (or middle-drag) the ground itself
    else if(surf && drag.turn){ unroll(); S.cam.yaw+=dx*0.006; S.cam.pitch=Math.max(0.12,Math.min(1.55,S.cam.pitch+dy*0.006)); } // tilt & turn
    else if(drag.turn){ S.cam.yaw-=dx*0.006; S.cam.pitch=Math.max(-1.5,Math.min(1.5,S.cam.pitch+dy*0.006)); } // right-drag: turn the view, never move the system
    else if(drag.pan){ // move the view point in the camera plane
      const k=S.cam.dist*2*Math.tan(camera.fov*Math.PI/360)/H; const rt=new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,0), up=new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,1);
      const tg=[...S.cam.target]; S.anim=null;
      if(S.cam.lock){ const d=norm3([camera.position.x,camera.position.y,camera.position.z]); S.cam.lock=null; S.cam.yaw=Math.atan2(d[1],d[0]); S.cam.pitch=Math.asin(d[2]); }
      S.focus={kind:"point",pos:[tg[0]-(rt.x*dx-up.x*dy)*k, tg[1]-(rt.y*dx-up.y*dy)*k, tg[2]-(rt.z*dx-up.z*dy)*k]};
    } else { S.cam.yaw-=dx*0.006; S.cam.pitch=Math.max(-1.5,Math.min(1.5,S.cam.pitch+dy*0.006)); }
    hideTip(); return; }
  if(e.target!==ov){ hideTip(); return; }
  const hit=pick(mx,my); if(hit) showTip(hit,mx,my); else hideTip(); });
// Zooming in goes toward what's under the mouse: if that's a planet or moon, the view slides toward that
// spot as it closes in (the spot stays under the cursor) and then belongs to that ground, so you can
// scroll from a station in orbit straight down into a city below. Over empty space, and zooming out,
// it zooms on the view's centre as before.
const _ray=new THREE.Raycaster();
function groundUnderMouse(e){ const r=ov.getBoundingClientRect();
  _ray.setFromCamera(new THREE.Vector2((e.clientX-r.left)/r.width*2-1, -((e.clientY-r.top)/r.height*2-1)), camera);
  const o=_ray.ray.origin, dv=_ray.ray.direction; let best=null;
  for(const b of S.bodies){ if(b.system!==S.system||b.kind==="star") continue;
    const c=[b.center[0]-O[0],b.center[1]-O[1],b.center[2]-O[2]], oc=[o.x-c[0],o.y-c[1],o.z-c[2]];
    const bq=oc[0]*dv.x+oc[1]*dv.y+oc[2]*dv.z, cq=oc[0]*oc[0]+oc[1]*oc[1]+oc[2]*oc[2]-b.radius*b.radius, disc=bq*bq-cq;
    if(disc<0) continue; const tt=-bq-Math.sqrt(disc); if(tt<=0) continue;
    if(!best||tt<best.t) best={b,t:tt,g:[O[0]+o.x+dv.x*tt, O[1]+o.y+dv.y*tt, O[2]+o.z+dv.z*tt]}; }
  return best; }
ov.addEventListener("wheel",e=>{ e.preventDefault(); const k=e.deltaY<0?1/1.25:1.25; if(S.follow) setFollow(false);
  // Looking at a station: the wheel zooms on the station only (never on the planet behind it) and stops
  // short of flying through it. Pan or pick something else to let go.
  let st=stationFocus();
  // A station picked on the map (clicked, not flown to yet): scrolling in zooms onto it, wherever the mouse is.
  const sel=S.selected?.kind==="loc"&&S.locMap[S.selected.name];
  if(!st && k<1 && isStation(sel) && sel.system===S.system && sel.pos){
    stopAnim(); const d=norm3([camera.position.x,camera.position.y,camera.position.z]);
    flyTo({kind:"loc",name:sel.name}, Math.max(STATION_MIN,Math.min(S.cam.dist*k, STATION_VIEW*4)),
          {yaw:Math.atan2(d[1],d[0]), pitch:Math.asin(Math.max(-1,Math.min(1,d[2]))), dur:650});
    return; }
  if(st){ if(S.anim){ const to=Math.min(4e12,Math.max(STATION_MIN,S.anim.toDist*k));             // mid fly-in: carry on to the new distance
      S.anim=null; flyTo(S.focus,to,{dur:700,key:"wheel:"+st.name+":"+to}); return; }
    S.cam.dist=Math.min(4e12,Math.max(STATION_MIN,S.cam.dist*k)); return; }
  stopAnim();
  const hit=k<1?groundUnderMouse(e):null;
  if(hit){ const t=now()+(S.timeShift||0), B=hit.b;
    // The mouse ray used the camera as last drawn; the planet has turned a little since. Carry the spot
    // and the view's centre forward with it, so the aim is exact even when frames are slow.
    const t0=S.camT??t, da=bodyAngle(B,t)-bodyAngle(B,t0), ca=Math.cos(da), sa=Math.sin(da);
    hit.g=toGlobal(B,toLocal(B,hit.g,t0),t); const T=focusPos(S.focus,t);
    const rotz=v=>[v[0]*ca-v[1]*sa, v[0]*sa+v[1]*ca, v[2]];
    const d=norm3(rotz([camera.position.x,camera.position.y,camera.position.z])), u=norm3(rotz(screenUp()));
    // The camera keeps exactly the way it faces and moves straight in. Far out it heads for the middle of
    // the view, so the planet just grows where it is; closer in it heads more and more for the spot under
    // the mouse (all the way from 0.4 radii up), so you can still scroll down into a city. Heading for a
    // spot near the planet's edge from far away is what swung the camera round the planet with every
    // notch, so the planet looked like it was turning.
    const P=[0,1,2].map(i=>T[i]+d[i]*S.cam.dist), alt=d3(P,B.center)-B.radius;
    const w=Math.max(0,Math.min(1,(1.6*B.radius-alt)/(1.2*B.radius)));
    const A=[0,1,2].map(i=>T[i]+(hit.g[i]-T[i])*w);                 // the point the zoom closes in on
    const P2=[0,1,2].map(i=>A[i]+(P[i]-A[i])*k);                    // where the camera goes
    // The view's centre goes where the line of sight meets the ground, so the camera then belongs to that
    // ground (a point in the planet's core made it jump as soon as you dragged or scrolled again).
    const oc=[0,1,2].map(i=>P2[i]-B.center[i]), bq=oc[0]*d[0]+oc[1]*d[1]+oc[2]*d[2], disc=bq*bq-(oc[0]*oc[0]+oc[1]*oc[1]+oc[2]*oc[2]-B.radius*B.radius);
    let T2, dist;
    if(disc>=0&&bq-Math.sqrt(disc)>20){ dist=bq-Math.sqrt(disc); T2=[0,1,2].map(i=>P2[i]-d[i]*dist); }
    else { T2=[0,1,2].map(i=>A[i]+(T[i]-A[i])*k); dist=Math.max(20,d3(P2,T2)); }
    // the view turns with that planet from now on (a fixed point in space has it rotate away underneath)
    enterGround(B,T2,d,u);
    S.focus={kind:"local",body:B.name,pos:toLocal(B,T2,t)}; S.cam.dist=dist;
    return; }
  let min=20; if(S.focus.kind==="body"&&S.bodyMap[S.focus.name]){ min=S.bodyMap[S.focus.name].radius*1.05; }
  S.cam.dist=Math.min(4e12,Math.max(min,S.cam.dist*k)); },{passive:false});
function jumpTarget(L){ if(L?.to) return L.to; const m=L&&L.type==="jump"&&L.name.match(/^(.+?)\s+(?:Gateway|Jump\s*Point)(?:\s*\([^)]*\))?$/i); return m?m[1]:null; }
function jumpThrough(name){ const L=S.locMap[name], to=jumpTarget(L); if(!to) return;
  if(S.systems.includes(to)){ S.autoSystem=false; setSystem(to);
    const back=S.locs.find(o=>o.system===to&&(o.type==="jump"||o.to)&&jumpTarget(o)===L.system);
    if(back){ select({kind:"loc",name:back.name}); if(back.pos) focusLoc(back.name,false); } else select(null);
    toast(`Jumped to ${to}`); }
  else { select({kind:"loc",name}); toast(`${to} isn't charted in Quantum yet`); } }
ov.addEventListener("click",e=>{ if(moved) return; const r=ov.getBoundingClientRect(); const hit=pick(e.clientX-r.left,e.clientY-r.top);
  if(e.detail===3 && hit?.kind==="loc" && jumpTarget(S.locMap[hit.name])) return jumpThrough(hit.name);
  if(!hit) return select(null); if(hit.kind==="friend") return fmPickFriend(hit.id); if(hit.kind==="mission"){ const L=hit.mission.o.location; select(L?{kind:"loc",name:L}:{kind:"mission",m:hit.mission}); return; }
  select({kind:hit.kind,name:hit.name}); });
ov.addEventListener("dblclick",e=>{ const r=ov.getBoundingClientRect(); const hit=pick(e.clientX-r.left,e.clientY-r.top); if(!hit) return;
  if(hit.kind==="body") focusBody(hit.name);
  else if(hit.kind==="friend") fmFlyTo(hit.id);
  else if(hit.kind==="mission"){ const m=hit.mission; if(m.o.marker){ if(!m.o.marker.body) flyTo({kind:"point",pos:m.o.marker.pos},60000);
      else flyTo({kind:"local",body:m.o.marker.body,pos:m.o.marker.pos}, Math.max(15000,S.bodyMap[m.o.marker.body].radius*0.06), TOPDOWN); } }
  else focusLoc(hit.name,true); });
function pick(x,y){ let best=null,bs=1e9; for(const p of S.picks){ const d=Math.hypot(p.x-x,p.y-y); if(d>p.r) continue;
  const score=(p.kind==="body"?d+30:d); if(score<bs){ bs=score; best=p; } }
  // Zoomed out, a planet's moons sit a few pixels from it and a click on the planet kept landing on one. While
  // the moon is only a dot and sits close to its planet on screen, the click goes to the planet: to reach a
  // moon, zoom in (or search for it).
  if(best?.kind==="body"){ const b=S.bodyMap[best.name], par=b?.kind==="moon"&&b.parent?S.picks.find(p=>p.kind==="body"&&p.name===b.parent):null;
    if(par&&(best.pr??0)<6&&Math.hypot(par.x-best.x,par.y-best.y)<Math.max(36,par.r*2.5)&&Math.hypot(par.x-x,par.y-y)<Math.max(36,par.r*2.5)) best=par; }
  return best; }
const tip=$("tooltip");
function showTip(hit,x,y){ let t="",s="";
  if(hit.kind==="body"){ const b=S.bodyMap[hit.name]; t=b.name; s=b.kind==="star"?"Star":`${kindLabel(b)}, ${fmtDist(b.radius)} ${b.kind==="asteroid"?"average radius":"radius"}. Double-click to fly there`; }
  else if(hit.kind==="friend"){ const f=fmTip(hit); if(!f) return; t=f.t; s=f.s; }
  else if(hit.kind==="mission"){ const m=hit.mission; t=m.o.label; s=`${m.c.subtitle?m.c.subtitle+" · ":""}${m.c.name}`; }
  else { const L=S.locMap[hit.name]; if(!L) return; t=L.name; s=[L.source==="user"?"Your waypoint":TYPES[L.type]?.one, L.body, padOf(L)!=="unknown"?`pad: ${padLabel(padOf(L))}`:null, L.qt?"QT marker":null].filter(Boolean).join(", "); }
  tip.innerHTML=`<div class="t">${esc(t)}</div><div class="s">${esc(s)}</div>`; tip.style.display="block";
  const r=tip.getBoundingClientRect(); tip.style.left=Math.min(x+14,W-r.width-8)+"px"; tip.style.top=Math.max(y-r.height-10,8)+"px"; }
function hideTip(){ tip.style.display="none"; }
window.addEventListener("keydown",e=>{ if(e.target.matches("input,textarea,select")) return;
  if(e.key==="Escape") select(null); if(e.key==="r"||e.key==="R") fitRoute(false); if(e.key==="f"||e.key==="F") fitSystem(); if(e.key==="y"||e.key==="Y"){ setFollow(true); followNow(); }
  if(e.key==="+"||e.key==="=") S.cam.dist/=1.5; if(e.key==="-") S.cam.dist*=1.5; });
$("z-in").onclick=()=>{ stopAnim(); S.cam.dist/=1.6; }; $("z-out").onclick=()=>{ stopAnim(); S.cam.dist*=1.6; }; $("z-fit").onclick=fitSystem; $("z-you").onclick=()=>{ setFollow(true); followNow(); }; $("z-route").onclick=()=>fitRoute(false);
