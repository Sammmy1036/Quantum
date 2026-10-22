"use strict";
// =================================================================== New Babbage in 3D  (ui/city3d-NewBabbage.js)
// The hand-written half of New Babbage: what it looks like and how it's built. Its generated halves live
// elsewhere and aren't edited by hand: ui/cities/NewBabbage.js (the real building layout, from
// tools/build_city.py) and ui/citylights/NewBabbage.js (its night lights, from tools/city_lights.py).
// Downtown around the microTech HQ spire, the lakeside domes, the tram across the frozen lake, and New
// Babbage Interstellar Spaceport with its landing towers on a forested plateau, in snowy mountains.
//
// Just the city: its places, its weather and its build. Everything else (placing it on the planet,
// fading in from orbit, sky, haze, light, the panel and the slider) is in city3d-core.js, which must be
// loaded first. Optional: without this file New Babbage is simply flat on the map.
//
// Where things are comes from Quantum's own data: the spaceport's saved position and altitude place it
// (17 km south-east of the city, across the lake, ~1 km up). The mountains and valleys are microTech's
// real ones, from the game's elevation map (ui/terrain/microTech.js, made by tools/build_terrain.py; without
// it they're generated); that map has a point only every 3-4 km, so the finer detail is generated, and
// the ground is pinned to the altitude of every surveyed place within reach.
(()=>{
if(!window.City3D) return;
const CITY="New Babbage", PORT_NAME="New Babbage Interstellar Spaceport";

City3D.define({
  city:CITY, body:"microTech", alsoAt:[PORT_NAME], file:"city3d-NewBabbage.js",
  openView:{[PORT_NAME]:"port"},          // the spaceport's "3D city" button opens on the spaceport
  alt0:6,                                  // ground zero is the lake ice (Lakeside Chairs is at 9 m)
  extent:70000,
  note:"Placed from Quantum's data; mountains from the game's elevation map, fine detail generated.",
  weather:{                                // microTech: pale blue skies, snow
    sky:{day:0xc4d4e6, dusk:0x6f6f8c, night:0x0a1222},
    zenith:{day:0x7fa3cf, dusk:0x3b3f66, night:0x060b18},
    sunGlow:0xffdb9e, hemi:[0xcfe3ff,0x8a99ad],
    haze:{near:6000, far:46000},
    precip:{label:"Snowfall", color:0xffffff, size:1.2, opacity:0.9, fall:[9,15], drift:0.6, maxAlt:8000},
  },

  async build({F, inner, curve, parts, terrain, pinned, heights, layout, tick, fbm, sstep, hash, rnd, THREE, litWindows, litLamps, litCity}){
    const P=F.places[PORT_NAME]||{x:12510,z:12074,alt:1037};
    const PORT={x:P.x, z:P.z, plat:P.alt-6-40};
    // The city's frame: D points from the microTech HQ (the model's origin, New Babbage's position in
    // Quantum's data) to the spaceport, E across it. The tram runs straight down D, across the lake.
    const AX=Math.atan2(PORT.x,PORT.z), D=[Math.sin(AX),Math.cos(AX)], E=[D[1],-D[0]];
    PORT.rot=AX+Math.PI;
    const toW=(lx,lz)=>[lx*E[0]+lz*D[0], lx*E[1]+lz*D[1]], toL=(x,z)=>[x*E[0]+z*E[1], x*D[0]+z*D[1]];
    const portDist=Math.hypot(PORT.x,PORT.z);
    const portLocal=(x,z)=>{ const dx=x-PORT.x, dz=z-PORT.z, c=Math.cos(PORT.rot), s=Math.sin(PORT.rot); return [dx*c-dz*s, dx*s+dz*c]; };

    // ---------------- the layout, measured off a top-down screenshot from the game
    // Looking straight down with the spaceport at the bottom: the HQ at pixel (800,215), the spaceport
    // 615 px below it. IL(px,py) turns a pixel into metres in the city frame (across, along), scaled so
    // that distance matches Quantum's HQ-to-spaceport distance.
    const KPX=portDist/615, IL=(px,py)=>[(px-800)*KPX,(py-215)*KPX];
    // New Babbage is a set of districts along the lake's north shore, not one block: [px,py, rx,ry px, tallest m]
    const DISTRICTS=[
      [800,215,110,85,380,"core"],   [840,75,75,60,260],   [630,35,55,45,170],  [650,200,55,55,210],
      [565,300,55,50,170],           [340,150,90,75,230],  [965,150,70,60,280], [1075,282,60,55,210],
      [960,365,45,45,160],           [950,25,50,30,150],
    ].map(([px,py,rx,ry,peak,name])=>{ const [cx,cz]=IL(px,py); return {cx,cz,rx:rx*KPX,rz:ry*KPX,peak,name}; });
    const distE=(d,lx,lz)=>Math.hypot((lx-d.cx)/d.rx,(lz-d.cz)/d.rz);
    let cityMask=(x,z)=>{ const [lx,lz]=toL(x,z); let m=0; for(const d of DISTRICTS) m=Math.max(m,1-sstep(0.85,1.3,distE(d,lx,lz))); return m; };
    // how much the hills are held down near the city: they rise gradually away from each district,
    // instead of standing up right at its edge like a crater rim
    let calm=(x,z)=>{ const [lx,lz]=toL(x,z); let m=0; for(const d of DISTRICTS) m=Math.max(m,1-sstep(0.8,2.4,distE(d,lx,lz))); return m; };
    // the frozen lake: wide, running across the city-port line, between the districts and the spaceport
    const LAKE=(()=>{ const [cx,cz]=IL(700,470); return {cx,cz,rx:520*KPX,rz:190*KPX}; })();
    // its shore wanders (broad bays and points), so it isn't a clean oval
    const lakeD=(x,z)=>{ const [lx,lz]=toL(x,z); return Math.hypot((lx-LAKE.cx)/LAKE.rx,(lz-LAKE.cz)/LAKE.rz)*(1+0.42*(fbm(x/6000+11,z/6000+5)-0.5)+0.16*(fbm(x/1700+2,z/1700+8)-0.5)); };
    const shoreFrom=(lx,lz,dir)=>{ let z=lz; for(let i=0;i<4000&&lakeD(...toW(lx,z))<=1.0;i++) z+=dir*10; return z; };   // walk out of the lake
    const PEN=(()=>{ const [lx,lz]=IL(752,296), [x,z]=toW(lx,lz); return {x,z,lx,lz}; })();       // the domes, on the shore below the core
    const PEN2=(()=>{ const [lx,lz]=IL(940,288), [x,z]=toW(lx,lz); return {x,z,lx,lz}; })();

    // ---------------- the real city, if there is one (ui/cities/NewBabbage.js, made by tools/build_city.py
    // from the game's own layout and its low-detail models): every block, tower, plate, dome and the
    // spaceport, in its real place, shape and turn. With it, the generated districts, waterfront and domes
    // give way, and the ground round the city is smoothed.
    const LAY=layout?.v===2&&layout.inst?.length?layout:null, R0=F.B.radius;
    const lift=LAY?LAY.a0-6:0;                                     // the layout origin's height above our ground zero
    const NI=LAY?LAY.inst.length/13:0, IN=LAY?.inst;
    // a mesh's box, and each placement's footprint (centre, reach) in the model frame
    const MB=LAY?LAY.meshes.map(m=>({lo:m.lo, hi:m.hi, c:m.lo.map((v,i)=>(v+m.hi[i])/2), h:m.lo.map((v,i)=>(m.hi[i]-v)/2)})):[];
    const foot=i=>{ const o=i*13, b=MB[IN[o]], m=o+1, c=b.c;
      const x=IN[m]*c[0]+IN[m+1]*c[1]+IN[m+2]*c[2]+IN[m+3], z=IN[m+8]*c[0]+IN[m+9]*c[1]+IN[m+10]*c[2]+IN[m+11];
      const sx=Math.hypot(IN[m],IN[m+4],IN[m+8]), sy=Math.hypot(IN[m+1],IN[m+5],IN[m+9]);
      return [x,z,Math.hypot(b.h[0]*sx,b.h[1]*sy)*0.7]; };
    if(LAY){
      // where the city stands, on a 120 m grid, then for every cell the distance to the nearest built cell
      // (two sweeps, near enough)
      const cell=120, ext=40000, n=Math.ceil(2*ext/cell), dist=new Float32Array(n*n).fill(1e9);
      for(let i=0;i<NI;i++){ const [x,z,r]=foot(i); if(r<12||r>3000) continue;
        for(let gx=Math.max(0,Math.floor((x-r+ext)/cell)); gx<=Math.min(n-1,Math.floor((x+r+ext)/cell)); gx++)
          for(let gz=Math.max(0,Math.floor((z-r+ext)/cell)); gz<=Math.min(n-1,Math.floor((z+r+ext)/cell)); gz++) dist[gz*n+gx]=0; }
      const D1=cell, D2=cell*1.414, relax=(k,j,dd)=>{ if(dist[j]+dd<dist[k]) dist[k]=dist[j]+dd; };
      for(let gz=0;gz<n;gz++) for(let gx=0;gx<n;gx++){ const k=gz*n+gx; if(gx>0) relax(k,k-1,D1); if(gz>0){ relax(k,k-n,D1); if(gx>0) relax(k,k-n-1,D2); if(gx<n-1) relax(k,k-n+1,D2); } }
      for(let gz=n-1;gz>=0;gz--) for(let gx=n-1;gx>=0;gx--){ const k=gz*n+gx; if(gx<n-1) relax(k,k+1,D1); if(gz<n-1){ relax(k,k+n,D1); if(gx<n-1) relax(k,k+n+1,D2); if(gx>0) relax(k,k+n-1,D2); } }
      const look=(x,z)=>{ const gx=Math.floor((x+ext)/cell), gz=Math.floor((z+ext)/cell); return gx<0||gz<0||gx>=n||gz>=n?-1:gz*n+gx; };
      cityMask=(x,z)=>{ const k=look(x,z); return k<0?0:1-sstep(0,240,dist[k]); };
      calm=(x,z)=>{ const k=look(x,z); return k<0?0:1-sstep(150,1400,dist[k]); };
    }

    // ---------------- ground: microTech's real mountains and valleys, with generated detail on top; flat
    // ice on the lake and wherever the valleys drop below it (the frozen sea to the south-west); the
    // districts on level ground, and the spaceport's plateau
    const REAL=heights?heights():null, ICE=-3;   // microTech's real heights (ui/terrain/microTech.js), or none                // ICE: the frozen surface, 3 m up
    // each district's level: the downtown core at the city's surveyed altitude, the others higher where
    // the real ground rises from there (never below the lakefront's 12 m)
    if(REAL){ const core=DISTRICTS[0], c0=REAL(...toW(core.cx,core.cz)), cityAlt=(F.places[CITY]?.alt??21)-6;
      for(const d of DISTRICTS) d.level=Math.max(12,cityAlt+REAL(...toW(d.cx,d.cz))-c0); }
    const calmLevel=(x,z)=>{ const [lx,lz]=toL(x,z); let sw=0, sl=0; for(const d of DISTRICTS){ const w=(1-sstep(0.8,2.4,distE(d,lx,lz)))**4+1e-9; sw+=w; sl+=w*(d.level??12); } return sl/sw; };
    function base(x,z){
      const ld=lakeD(x,z), cm=calm(x,z);
      let land=sstep(1.0,1.1,ld);
      land=Math.max(land,1-sstep(0.75,1.0,Math.hypot(x-PEN.x,z-PEN.z)/360),1-sstep(0.75,1.0,Math.hypot(x-PEN2.x,z-PEN2.z)/260));
      let h;
      if(REAL){ const r=REAL(x,z), relief=Math.min(Math.max(r,0),2600), A=40+0.2*relief;
        // the map's points are 3-4 km apart, so add ridges and gullies at the scales it can't show,
        // stronger on the high ground; and the rugged hills between districts
        h=r+(1-cm)*((fbm(x/2600+7,z/2600+3)-0.48)*2*A+(fbm(x/700+1,z/700+6)-0.48)*0.5*A+sstep(1.0,1.6,ld)*(110*fbm(x/1500+3,z/1500+9)));
        if(!LAY) h=h*(1-cm)+(calmLevel(x,z)+7*fbm(x/900,z/900))*cm;    // the districts sit on level ground, at the real ground's height
        // (with the real layout the ground is left as it is, only smoother round the city: its plates and
        // podiums reach down to it)
        h=ICE+land*Math.max(h-ICE,0); }                         // and nothing dips below the ice
      else {                                                    // no map: the generated mountains
        h=-3+land*(12+7*fbm(x/900,z/900));
        h+=land*(1-cm)*sstep(1.0,1.6,ld)*(20+280*fbm(x/1500+3,z/1500+9));
        const [mx,mz]=toW(0,portDist*0.3), bd=Math.hypot((x-mx)/13500,(z-mz)/11000);
        h+=land*(1-cm)*sstep(1.0,1.9,ld)*sstep(0.6,1.15,bd)*(240+2300*fbm(x/3200+7,z/3200+3)); }
      const [plx,plz]=portLocal(x,z), pd=Math.hypot(Math.max(Math.abs(plx)-1060,0),Math.max(Math.abs(plz)-540,0)), sh=1-sstep(0,2600,pd);
      if(sh>0) h=h*(1-sh)+(PORT.plat-pd*0.42+90*fbm(x/500,z/500)*sstep(0,300,pd))*sh;
      return h; }
    const hgt=pinned(base,p=>{ if(lakeD(p.x,p.z)<1.15||cityMask(p.x,p.z)>0.2) return true;          // not in the lake or a district
      const [lx,lz]=portLocal(p.x,p.z); return Math.abs(lx)<1600&&Math.abs(lz)<1100; });            // ...or under the spaceport

    // ---------------- materials (the map draws without tone mapping, so albedos are kept a little lower)
    const [winTex,winLit]=windowTextures(rnd);
    const M={
      facade:new THREE.MeshStandardMaterial({map:winTex,emissiveMap:winLit,emissive:0xffffff,emissiveIntensity:0.03,roughness:0.42,metalness:0.4}),
      white:new THREE.MeshStandardMaterial({color:0xeef2f6,roughness:0.45,metalness:0.05}),            // the HQ and the white panel towers
      snow:new THREE.MeshStandardMaterial({color:0xdde5ee,roughness:0.9}),
      concrete:new THREE.MeshStandardMaterial({color:0xaeb8c3,roughness:0.72,metalness:0.12}),
      dark:new THREE.MeshStandardMaterial({color:0x353f4c,roughness:0.6,metalness:0.5}),
      hangar:new THREE.MeshStandardMaterial({color:0x0d131b,roughness:0.9}),
      strip:new THREE.MeshStandardMaterial({color:0x6d8aa8,emissive:0xbfe3ff,emissiveIntensity:0.2,roughness:0.3}),
      accent:new THREE.MeshStandardMaterial({color:0x2a6fd6,emissive:0x3a8dff,emissiveIntensity:0.5,roughness:0.3}),   // microTech blue trim
      hqglass:new THREE.MeshStandardMaterial({color:0x9fd2f5,emissive:0x8fd8ff,emissiveIntensity:0.45,roughness:0.15,metalness:0.3}),
      red:new THREE.MeshBasicMaterial({color:0xff3b3b}),
      blue:new THREE.MeshBasicMaterial({color:0x3aa0ff}),
      glass:new THREE.MeshStandardMaterial({color:0xcfe8ff,emissive:0xffd9a0,emissiveIntensity:0,roughness:0.08,metalness:0.6,transparent:true,opacity:0.55,depthWrite:false}),
      ground:new THREE.MeshStandardMaterial({vertexColors:true,roughness:0.93,metalness:0}),
      tree:new THREE.MeshStandardMaterial({color:0x2f4037,roughness:0.95}),
      beacon:new THREE.MeshBasicMaterial({color:0xff4040,transparent:true}),
    };

    // ---------------- terrain: snow, with rock on the steep and high ground
    await terrain(hgt,M.ground,(x,z,y,ny)=>{ const n=fbm(x/180,z/180), rock=Math.min(1,sstep(0.9,0.7,ny)+sstep(0.97,0.88,ny)*sstep(0.45,0.62,fbm(x/1400+5,z/1400+2))*sstep(700,1600,y))*sstep(60,220,y);   // steep faces, and broken rock on the high slopes
      const ice=Math.max(1-sstep(0.97,1.05,lakeD(x,z)),1-sstep(ICE+0.3,ICE+3,y)), drift=fbm(x/900+4,z/900+1);   // snow-covered ice: flat white, faint drifts
      const c=[0.86+0.05*n,0.89+0.04*n,0.94].map((v,i)=>v*(1-rock)+[0.33,0.36,0.41][i]*rock);
      return c.map((v,i)=>v*(1-ice)+[0.88+0.05*drift,0.91+0.04*drift,0.955][i]*ice); });
    await tick();

    // ---------------- buildings (snow settles on flat roofs)
    const {add,box,cyl,finish,at,ry,rx}=parts({roof:{facade:["snow",0.6], concrete:["snow",0.85], white:["snow",0.85]}});
    const sc=(x,y,z)=>new THREE.Matrix4().makeScale(x,y,z), SLAB=new THREE.CylinderGeometry(0.91,1,1,14);
    const blockers=[];
    // the real city: each of the game's models once, placed wherever the layout puts it (instanced),
    // shaded plain with snow on whatever faces up. The HQ and spaceport are drawn by hand when the city
    // doesn't have them.
    const inPort=(x,z)=>{ const [lx,lz]=portLocal(x,z); return Math.abs(lx)<1600&&Math.abs(lz)<1100; };
    const hasMesh=re=>!!LAY&&LAY.meshes.some(m=>re.test(m.name));
    const realHQ=hasMesh(/city_main_\d+_megalod|hab_tower/), realPort=hasMesh(/sp_ext_hull|sp_ext_side/);
    let cityMat=null, glassMat=null, LIT=null, nearReady=null;
    const LANDMARK={};                    // where the HQ spire and the spaceport's hall really are (the game's layout)
    const LOD={};                         // per model: its far and close-up instanced meshes, and every placement
    let lodDirty=true, lodAt=0; const lodCam=new THREE.Vector3(1e12,0,0), camL=new THREE.Vector3();
    // Which copies get their close-up version: the ones that look big on screen. A copy qualifies when its
    // size is more than 1/NEAR_K of its distance (a 1 km platform from ~48 km, a 300 m tower from ~14 km,
    // a railing within a couple of km), or it's within NEAR_MIN of the camera. If that comes to more than
    // NEAR_TRIS close-up triangles in all, the biggest-looking copies get them first.
    const NEAR_K=48, NEAR_MIN=2500, NEAR_TRIS=14e6;
    let lodS=null, lodE=null, lodI=null, lodOrd=null, lodPick=null;
    // every so often, move each placement to the close-up or the far version
    const updateLod=now=>{
      if(now-lodAt<300) return; lodAt=now;
      camera.getWorldPosition(camL); inner.worldToLocal(camL);
      if(!lodDirty&&lodCam.distanceToSquared(camL)<Math.max(40,0.02*camL.length())**2) return;   // moved enough to matter (more, the further out)
      lodCam.copy(camL); lodDirty=false;
      const ents=Object.values(LOD).filter(e=>e.near);
      if(!ents.length) return;
      const tot=ents.reduce((a,e)=>a+e.n,0);              // (more close-up models arrive as the file loads)
      if(!lodS||lodS.length!==tot){ lodS=new Float32Array(tot); lodE=new Int32Array(tot); lodI=new Int32Array(tot); lodPick=new Uint8Array(tot); }
      let c=0;
      ents.forEach((e,ei)=>{ e.nt=e.nt||e.near.geometry.attributes.position.count/3;
        for(let i=0;i<e.n;i++){ const dx=e.cen[i*3]-camL.x, dy=e.cen[i*3+1]-camL.y, dz=e.cen[i*3+2]-camL.z;
          const gap=Math.max(1,Math.sqrt(dx*dx+dy*dy+dz*dz)-e.rad[i]);
          lodS[c]=gap<NEAR_MIN?1e9-gap:e.rad[i]*2/gap; lodE[c]=ei; lodI[c]=i; c++; } });
      // the qualifying copies, biggest-looking first, while the triangle budget lasts
      lodOrd=lodOrd&&lodOrd.length===c?lodOrd:new Uint32Array(c); let m=0;
      for(let k=0;k<c;k++) if(lodS[k]>1/NEAR_K) lodOrd[m++]=k;
      const ord=Array.from(lodOrd.subarray(0,m)).sort((a,b)=>lodS[b]-lodS[a]);
      lodPick.fill(0); let tris=0;
      for(const k of ord){ const t=ents[lodE[k]].nt; if(tris+t>NEAR_TRIS) continue; tris+=t; lodPick[k]=1; }
      c=0;
      for(const e of ents){ const fa=e.far.instanceMatrix.array, na=e.near.instanceMatrix.array; let nf=0, nn=0;
        for(let i=0;i<e.n;i++,c++){ const mm=e.mats.subarray(i*16,i*16+16); if(lodPick[c]) na.set(mm,(nn++)*16); else fa.set(mm,(nf++)*16); }
        if(e.far.count!==nf||e.near.count!==nn||nn){ e.far.count=nf; e.near.count=nn; e.far.instanceMatrix.needsUpdate=true; e.near.instanceMatrix.needsUpdate=true; } } };
    if(LAY){
      // both sides drawn: some of the game's pieces are placed mirrored, which turns their faces inside out
      // At night each kind of model gives the light it really would (LIGHT_CLASS below; the same rules as
      // tools/city_lights.py, which bakes the city's lights for the planet): towers their windows, podiums a
      // few, plates, tram decks and pads street lamps, the domes a glow; tanks, antennas, struts, railings,
      // rock and the distant scenery stay dark. See litWindows / litLamps in city3d-core.js.
      const std=(o={})=>new THREE.MeshStandardMaterial({vertexColors:true,roughness:0.78,metalness:0.18,emissive:0xffffff,emissiveIntensity:0,side:THREE.DoubleSide,shadowSide:THREE.BackSide,...o});
      cityMat=std(); glassMat=std({roughness:0.2,metalness:0.55});
      LIT={none:cityMat, glass:glassMat, tower:std(), base:std(), plate:std(), port:std(), dome:std({emissive:0xffe2b8})};
      if(litWindows){ litWindows(LIT.tower,{floor:4.2,col:3.4,lit:0.3}); litWindows(LIT.base,{floor:5.0,col:4.0,lit:0.16});
        litWindows(glassMat,{floor:4.0,col:2.2,lit:0.5,glass:true}); }
      if(litLamps){ litLamps(LIT.plate,{spacing:36,warm:true}); litLamps(LIT.port,{spacing:24,warm:false,pool:0.5}); }
      // models coloured from the game's materials (build_city.py writes 'parts'): one material, each triangle
      // saying what it is (window, light strip, glass, street-lamp top) in a 'lite' attribute
      LIT.city=std(); if(litCity) litCity(LIT.city,{lit:0.3,spacing:36});
      const LINEAR=k=>{ const c=k/255; return c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4; };
      // Glass is drawn as dark, cool glass with the pale sky in it. Its material's colour is the tint light
      // takes on passing through (mint or teal in New Babbage), not paint: drawn as paint, it turned the
      // towers' glass walls and the domes green.
      // New Babbage's glass towers read sky blue in the game (the clear, bright sky and the snow in them),
      // not the dark glass of the other cities.
      const GLASS_C=[0.17,0.29,0.46];
      const KC=[[0.6,0.64,0.7],[0.52,0.56,0.6],[0.78,0.86,0.94],[0.58,0.62,0.68],[0.6,0.64,0.7],[0.36,0.45,0.56]], SNOW=[0.9,0.93,0.97];
      // A model's triangles, coloured: the game's own colours part by part ([first triangle, count, r, g, b,
      // look]) when the layout has them; shaded smooth across gentle bends (curved hulls, domes, tunnels) and
      // sharp at real edges, so a curve doesn't show every facet.
      const makeGeo=(m,b)=>{
        const bin=atob(m.v), q=new Int16Array(nbytes(bin).buffer);
        const iu=nbytes(atob(m.i)), idx=m.i32?new Uint32Array(iu.buffer):new Uint16Array(iu.buffer);
        const nt=Math.floor(idx.length/3), pos=new Float32Array(nt*9), col=new Float32Array(nt*9), kc=KC[m.kind]||KC[0];
        const P=k=>[b.c[0]+q[k*3]/32767*b.h[0], b.c[1]+q[k*3+1]/32767*b.h[1], b.c[2]+q[k*3+2]/32767*b.h[2]];
        const runs=m.parts||null, lite=runs?new Float32Array(nt*3):null, lampTop=/plate|port/.test(lightClass(m));
        const keys=new Float64Array(nt*3);                // each corner's exact stored position, as one number
        for(let v=0;v<nt*3;v++){ const w=idx[v]; keys[v]=(q[w*3]+32768)*4294967296+(q[w*3+1]+32768)*65536+(q[w*3+2]+32768); }
        let ri=0;
        for(let t=0;t<nt;t++){ const A=P(idx[t*3]), B_=P(idx[t*3+1]), C_=P(idx[t*3+2]);
          const ux=B_[0]-A[0], uy=B_[1]-A[1], uz=B_[2]-A[2], vx=C_[0]-A[0], vy=C_[1]-A[1], vz=C_[2]-A[2];
          const nx=uy*vz-uz*vy, ny=uz*vx-ux*vz, nz=ux*vy-uy*vx, nl=Math.hypot(nx,ny,nz)||1, up=Math.abs(nz/nl)>0.8;
          let c, L=0;
          if(runs){ while(ri<runs.length-1&&t>=runs[ri][0]+runs[ri][1]) ri++;
            const r=runs[ri], look=r[5]; c=look===3?GLASS_C:[LINEAR(r[2]),LINEAR(r[3]),LINEAR(r[4])];   // glass: see GLASS_C
            L=look===1||look===2||look===3?look:0;
            if(up&&look===0){ c=SNOW; if(lampTop) L=5; } }                       // flat tops: snow (and street lamps on plates)
          else c=m.kind!==5&&up?SNOW:kc;                                         // the game's models are z-up: roofs take snow
          [A,B_,C_].forEach((v,k)=>{ pos.set(v,t*9+k*3); col.set(c,t*9+k*3); if(lite) lite[t*3+k]=L; }); }
        const g=new THREE.BufferGeometry(); g.setAttribute("position",new THREE.BufferAttribute(pos,3)); g.setAttribute("color",new THREE.BufferAttribute(col,3));
        if(lite) g.setAttribute("lite",new THREE.BufferAttribute(lite,1));
        g.setAttribute("normal",new THREE.BufferAttribute(creaseNormals(pos,nt,keys),3)); return g; };
      const boxOf=m=>({c:m.lo.map((v,i)=>(v+m.hi[i])/2), h:m.lo.map((v,i)=>(m.hi[i]-v)/2)});
      const geos=LAY.meshes.map((m,mi)=>makeGeo(m,MB[mi]));
      const byMesh=new Map();
      for(let i=0;i<NI;i++){ const k=IN[i*13]; if(!byMesh.has(k)) byMesh.set(k,[]); byMesh.get(k).push(i); }
      const Mx=new THREE.Matrix4(), Q=new THREE.Quaternion(), Y=new THREE.Vector3(0,1,0), U=new THREE.Vector3(), Rq=new THREE.Matrix4(), Tm=new THREE.Matrix4(), Cv=new THREE.Vector3();
      let done=0;
      for(const [k,list] of byMesh){
        const mat=LAY.meshes[k].parts?LIT.city:LIT[lightClass(LAY.meshes[k])];
        const im=new THREE.InstancedMesh(geos[k],mat,list.length); let n=0;
        const mats=new Float32Array(list.length*16), cen=new Float32Array(list.length*3), rad=new Float32Array(list.length), bx=MB[k];
        for(const i of list){ const o=i*13+1;
          const x=IN[o+3], z=IN[o+11]; if(!realPort&&inPort(x,z)) continue;   // the hand-made port's spot
          const y=IN[o+7]+lift+(x*x+z*z)/(2*R0);                              // a flat layout rises off the curved planet
          const p=curve(x,y,z); U.set(p[0],p[1]+F.Rb,p[2]).normalize(); Q.setFromUnitVectors(Y,U);
          Mx.set(IN[o],IN[o+1],IN[o+2],0, IN[o+4],IN[o+5],IN[o+6],0, IN[o+8],IN[o+9],IN[o+10],0, 0,0,0,1);
          Tm.makeRotationFromQuaternion(Q).multiply(Mx).setPosition(p[0],p[1],p[2]);
          im.setMatrixAt(n,Tm); Tm.toArray(mats,n*16);
          Cv.set(bx.c[0],bx.c[1],bx.c[2]).applyMatrix4(Tm); cen.set([Cv.x,Cv.y,Cv.z],n*3);
          rad[n]=Math.hypot(bx.h[0],bx.h[1],bx.h[2])*Math.max(Math.hypot(IN[o],IN[o+4],IN[o+8]),Math.hypot(IN[o+1],IN[o+5],IN[o+9]),Math.hypot(IN[o+2],IN[o+6],IN[o+10]));
          n++;
          const top=MB[k].hi[2]*Math.hypot(IN[o+2],IN[o+6],IN[o+10]);
          if(LAY.meshes[k].kind===0&&top>250) blockers.push([x,z,y+top]); }
        { const nm=LAY.meshes[k].name;                                        // landmarks, for the camera views below
          if(/^newbab_hab_tower_a$|^sp_ext_hull$/.test(nm)&&list.length){ const o=list[0]*13+1, b=MB[k];
            const at=(a,bb,c)=>[IN[o]*a+IN[o+1]*bb+IN[o+2]*c+IN[o+3], IN[o+4]*a+IN[o+5]*bb+IN[o+6]*c+IN[o+7], IN[o+8]*a+IN[o+9]*bb+IN[o+10]*c+IN[o+11]];
            let lo=1e9, hi=-1e9; for(let c=0;c<8;c++){ const y=at(b.c[0]+(c&1?1:-1)*b.h[0], b.c[1]+(c&2?1:-1)*b.h[1], b.c[2]+(c&4?1:-1)*b.h[2])[1]; lo=Math.min(lo,y); hi=Math.max(hi,y); }
            const m=at(...b.c), up=lift+(m[0]**2+m[2]**2)/(2*R0);
            LANDMARK[nm.startsWith("sp_")?"port":"spire"]={t:[m[0],m[2]], y:m[1]+up, base:lo+up, top:hi+up}; } }
        im.count=n; im.castShadow=true; im.receiveShadow=true; im.frustumCulled=false; inner.add(im);
        LOD[k]={far:im, near:null, mat, n, mats, cen, rad};
        if(++done%40===0) await tick(); }
      // The close-up versions (ui/cities/NewBabbage.near.js, written by build_city.py): loaded once the city
      // is up, and drawn for the copies near the camera (see updateLod below).
      nearReady=(async()=>{
        if(!window.QCITYNEAR?.[CITY]) await window.qLoadAsset("cities/NewBabbage.near.js");
        const NM=window.QCITYNEAR?.[CITY]?.meshes; if(!NM) return;
        let c=0;
        for(const [ks,m] of Object.entries(NM)){ const e=LOD[+ks]; if(!e||!e.n) continue;
          try{ const near=new THREE.InstancedMesh(makeGeo(m,boxOf(m)),e.mat,e.n); near.count=0;
            near.castShadow=true; near.receiveShadow=true; near.frustumCulled=false; near.userData.closeUp=true; inner.add(near); e.near=near; }catch(err){ console.warn("near",m.name,err); }
          if(++c%12===0) await new Promise(r=>setTimeout(r,0)); }
        delete window.QCITYNEAR[CITY]; lodDirty=true; })(); }
    // without it: the districts, dense blocks on a street grid along the city's axis, tallest at each one's middle
    if(!LAY) for(const d of DISTRICTS){ const step=d.name==="core"?105:135;
      for(let lx=d.cx-d.rx; lx<=d.cx+d.rx; lx+=step){ for(let lz=d.cz-d.rz; lz<=d.cz+d.rz; lz+=step){
        const e=distE(d,lx,lz); if(e>1.05) continue;
        const ax=lx+(rnd()-0.5)*28, az=lz+(rnd()-0.5)*28, [x,z]=toW(ax,az);
        if(lakeD(x,z)<1.06) continue;
        if(Math.abs(((lx-d.cx)%(step*5)+step*5)%(step*5))<30||Math.abs(((lz-d.cz)%(step*6)+step*6)%(step*6))<30) continue;   // avenues
        if(d.name==="core"&&(Math.hypot(ax,az)<300||(Math.abs(ax)<170&&az>0))) continue;       // the HQ's plaza, and the boulevard from it to the shore
        if(rnd()>0.82*(1-sstep(0.75,1.08,e))) continue;
        const core=Math.exp(-((e/0.45)**2)), w=36+50*rnd(), dp=36+50*rnd(), y=hgt(x,z)-2, a=AX+(rnd()-0.5)*0.1, k=rnd();
        const tall=(16+40*rnd()+d.peak*core*(0.3+0.7*rnd()))*(0.85+0.3*rnd());
        const mat=tall>140&&rnd()<0.28?"white":"facade";
        if(k<0.42) box(w,tall,dp,x,y,z,a,mat);
        else if(k<0.62){ box(w,tall*0.55,dp,x,y,z,a,mat); box(w*0.75,tall*0.3,dp*0.75,x,y+tall*0.55,z,a,mat); box(w*0.5,tall*0.15,dp*0.5,x,y+tall*0.85,z,a,"dark"); }
        else if(k<0.8) add(SLAB,mat,at(x,y+tall/2,z).multiply(ry(a)).multiply(sc(w*0.55,tall,w*0.55*(0.55+0.4*rnd()))),{shared:true});   // rounded slab towers
        else if(k<0.9){ cyl(w*0.42,w*0.48,tall,16,x,y,z,mat,a); cyl(w*0.3,w*0.3,10,16,x,y+tall,z,"dark",a); }                 // round towers with a cap
        else { box(w*0.45,tall,dp,x-E[0]*w*0.3,y,z-E[1]*w*0.3,a,mat); box(w*0.45,tall*0.82,dp,x+E[0]*w*0.3,y,z+E[1]*w*0.3,a,mat); }
        if(tall>200){ cyl(1.2,2.4,tall*0.18,6,x,y+tall,z,"dark"); blockers.push([x,z,tall*1.18+y]); }
        box(w*1.06,4,dp*1.06,x,y,z,a,"concrete"); }
        await tick(); } }

    // the microTech HQ: a white slab tower, its vertical edges rounded, with a tall arched opening right
    // through the middle (glass lit from inside, framed in microTech blue), a crown with the microTech
    // mark, two antennas, and a broad ramp down to a plaza. Its face looks down the boulevard, over the
    // lake toward the spaceport.
    if(!realHQ){ const y=hgt(0,0)-2, H=600, Wd=190, Dp=110, R=ry(AX), HQ=(lx,ly,lz,m)=>at(0,y,0).multiply(R).multiply(at(lx,ly,lz)).multiply(m||new THREE.Matrix4());
      const v0=110, v1=470, ow=92, pw=(Wd-ow)/2;                            // the opening: between these heights, ow wide; pw: each side
      add(new THREE.BoxGeometry(Wd,v0,Dp),"white",HQ(0,v0/2,0));            // the base
      add(new THREE.BoxGeometry(Wd,H-v1,Dp),"white",HQ(0,v1+(H-v1)/2,0));   // the crown
      add(new THREE.CylinderGeometry(ow/2,ow/2,Dp,24,1,false,-Math.PI/2,Math.PI),"white",HQ(0,v1,0,rx(Math.PI/2).multiply(sc(1,1,0.55))));   // the arch at the opening's top
      for(const sx of [-1,1]){ const cx=sx*(ow/2+pw/2);
        add(new THREE.BoxGeometry(pw,v1-v0,Dp),"white",HQ(cx,(v0+v1)/2,0));                             // the two sides of the opening
        add(new THREE.CylinderGeometry(1,1,H,16,1,false,0,Math.PI),"white",HQ(sx*Wd/2,H/2,0,ry(sx>0?0:Math.PI).multiply(sc(18,1,Dp/2))));   // rounded outer edges
        add(new THREE.BoxGeometry(5,v1-v0+30,5),"accent",HQ(sx*(ow/2+2),(v0+v1)/2,Dp/2+1));              // blue trim round the opening
        add(new THREE.BoxGeometry(5,H*0.94,5),"accent",HQ(sx*(Wd/2-8),H*0.48,Dp/2+1)); }                // and down the front edges
      add(new THREE.BoxGeometry(ow-6,v1-v0,4),"hqglass",HQ(0,(v0+v1)/2,-Dp*0.25));                      // the lit glass wall inside the opening
      for(let i=1;i<10;i++) add(new THREE.BoxGeometry(ow-6,1.6,6),"white",HQ(0,v0+i*(v1-v0)/10,-Dp*0.25+3));   // its floors
      for(const fx of [-0.25,0.25]) add(new THREE.BoxGeometry(1.6,v1-v0,6),"white",HQ(fx*ow,(v0+v1)/2,-Dp*0.25+3));
      add(new THREE.BoxGeometry(ow+10,4,Dp),"white",HQ(0,v0+2,0));                                     // the opening's sill
      add(new THREE.CylinderGeometry(15,15,2,28),"blue",HQ(0,H-48,Dp/2+1,rx(Math.PI/2)));             // the microTech mark
      add(new THREE.CylinderGeometry(19,19,1.5,28),"accent",HQ(0,H-48,Dp/2+0.5,rx(Math.PI/2)));
      add(new THREE.BoxGeometry(Wd*0.82,10,Dp*0.8),"dark",HQ(0,H+5,0));                                 // roof deck
      add(new THREE.CylinderGeometry(1.4,3,140,6),"dark",HQ(-38,H+70,-15)); add(new THREE.CylinderGeometry(1.2,2.6,110,6),"dark",HQ(40,H+55,-10));   // the antennas
      add(new THREE.CylinderGeometry(10,10,24,12),"white",HQ(-60,H+12,12));                             // rooftop plant
      add(new THREE.BoxGeometry(120,6,340),"concrete",HQ(0,3,Dp/2+170));                               // the ramp to the plaza
      add(new THREE.BoxGeometry(340,8,340),"concrete",HQ(0,0,0));
      blockers.push([0,0,y+H+140]); }
    // waterfront terminals and piers along the core's shore
    if(!LAY) for(let lx=-2400;lx<=2400;lx+=170){ if(Math.abs(lx)<80) continue; const lz=shoreFrom(lx,LAKE.cz-LAKE.rz*0.5,-1)-60, [x,z]=toW(lx,lz), y=hgt(x,z)-1;
      if(cityMask(x,z)<0.3&&Math.abs(lx)>900) continue;
      if(rnd()<0.75){ const w=90+rnd()*70, d=50+rnd()*40; box(w,14+rnd()*16,d,x,y,z,AX,"concrete"); box(w*0.9,3,d*0.5,x,y+20,z,AX,"strip"); }
      if(rnd()<0.5){ const L=160+rnd()*120, [px,pz]=toW(lx+20,lz+60+L/2); box(14,4,L,px,0.2,pz,AX,"concrete"); } }
    // domes on the shore below the core, and a pair further east
    const dome=(x,z,r)=>{ const y=hgt(x,z)-1; cyl(r*1.06,r*1.1,9,48,x,y,z,"concrete");
      add(new THREE.SphereGeometry(r,48,18,0,Math.PI*2,0,Math.PI/2),"glass",at(x,y+9,z));
      add(new THREE.TorusGeometry(r,1.6,6,64),"dark",at(x,y+9,z).multiply(rx(Math.PI/2)));
      for(let k=0;k<6;k++) add(new THREE.TorusGeometry(r,0.8,4,48,Math.PI),"dark",at(x,y+9,z).multiply(ry(k*Math.PI/6))); };
    if(!LAY){ for(const [a,b,r] of [[-80,-40,115],[90,80,98],[175,-95,82],[-210,145,62]]) dome(...toW(PEN.lx+a,PEN.lz+b),r);
      for(const [a,b,r] of [[-40,0,80],[70,40,55]]) dome(...toW(PEN2.lx+a,PEN2.lz+b),r); }
    // trams: elevated tracks in short pieces (so the curved planet carries them), riding at least 14 m
    // above the ground on pylons. The main line runs from the core straight across the lake toward the
    // spaceport; others link the districts.
    const rail=(pts,{h=42}={})=>{ for(let s=0;s+1<pts.length;s++){ const [x0,z0]=toW(...pts[s]), [x1,z1]=toW(...pts[s+1]);
        const L=Math.hypot(x1-x0,z1-z0), a=Math.atan2(x1-x0,z1-z0), n=Math.max(1,Math.floor(L/140));
        for(let i=0;i<n;i++){ const f=(i+0.5)/n, mx=x0+(x1-x0)*f, mz=z0+(z1-z0)*f, deck=Math.max(h,hgt(mx,mz)+14);
          for(const off of [-11,11]) add(new THREE.BoxGeometry(6,3,L/n+0.6),"concrete",at(mx+Math.cos(a)*off,deck,mz-Math.sin(a)*off).multiply(ry(a)));
          const g=Math.max(0,hgt(mx,mz)); box(5,deck-g,26,mx,g,mz,a,"concrete"); } } };
    // the lines, traced off a marked-up map (pixels in the same frame as the districts)
    const TRAMS=[
      [[775,150],[790,240],[800,330],[800,780]],                                          // the main line: past the HQ, straight across the lake to the spaceport
      [[724,280],[729,348],[746,403],[779,451],[800,477]],                                // a branch from the shore south-west of the core, joining it on the ice
      [[405,163],[469,155],[535,135],[600,117],[665,103],[730,104],[794,121],[840,160]],  // west: from the west district along the north of the core
      [[951,63],[906,74],[870,102],[849,141],[849,192],[877,255],[914,300],[956,345],[997,409],[1041,462],[1087,533]],   // east: round the core and out across the lake
    ];
    const realTram=hasMesh(/transit_/);                                  // the game's own tracks are in the city
    if(!realTram) for(const line of TRAMS) rail(line.map(p=>IL(...p)),{h:30});
    if(!realTram){ const [sx,sz]=toW(...IL(800,790)); box(120,26,90,sx,hgt(sx,sz)-1,sz,AX,"concrete"); box(122,3,92,sx,hgt(sx,sz)+12,sz,AX,"strip");   // the station below the spaceport
      const [cx,cz]=toW(...IL(800,345)); box(150,30,80,cx,hgt(cx,cz)-1,cz,AX,"concrete"); box(152,3,82,cx,hgt(cx,cz)+14,cz,AX,"strip"); }   // and on the waterfront
    await tick();

    // ---------------- the spaceport
    let portE=hgt(PORT.x,PORT.z)+74;
    if(!realPort){ const y0=hgt(PORT.x,PORT.z)-3, e=y0+74, R=ry(PORT.rot), Pp=(x,z)=>new THREE.Vector3(x,0,z).applyMatrix4(R).add(new THREE.Vector3(PORT.x,0,PORT.z));
      const pbox=(w,h,d,x,y,z,mat)=>{ const p=Pp(x,z); box(w,h,d,p.x,y,p.z,PORT.rot,mat); };
      const pcyl=(rt,rb,h,seg,x,y,z,mat)=>{ const p=Pp(x,z); cyl(rt,rb,h,seg,p.x,y,p.z,mat,PORT.rot); };
      const s=new THREE.Shape([[-940,-60],[-560,-110],[-470,-200],[470,-200],[560,-110],[940,-60],[960,40],[940,95],[560,95],[480,175],[-480,175],[-560,95],[-940,95],[-960,40]].map(([x,z])=>new THREE.Vector2(x,-z)));
      add(new THREE.ExtrudeGeometry(s,{depth:30,bevelEnabled:true,bevelThickness:3,bevelSize:4,bevelSegments:1}),"concrete",at(PORT.x,e-30,PORT.z).multiply(R).multiply(rx(-Math.PI/2)));
      pbox(1700,e-y0-30,150,0,y0,30,"dark"); pbox(820,e-y0-30,300,0,y0,0,"dark");
      for(let k=0;k<3;k++) pbox(1702,2.2,152,0,y0+14+k*14,30,"strip");
      for(let i=-7;i<=7;i++) pbox(34,e-y0-30,34,i*125,y0,140,"concrete");
      for(let i=-40;i<=40;i++) pbox(5,e-y0-30,7,i*21,y0,106,"concrete");
      pbox(560,44,280,0,e,-10,"concrete"); pbox(564,3,284,0,e+18,-10,"strip");
      pbox(390,30,190,0,e+44,-20,"concrete"); pbox(394,2.5,194,0,e+58,-20,"strip");
      pbox(170,26,110,0,e+74,-30,"concrete"); pbox(60,14,60,0,e+100,-30,"dark");
      for(const sx of [-1,1]){ pbox(200,24,120,sx*360,e,40,"concrete"); pbox(204,2.5,124,sx*360,e+12,40,"strip"); }
      for(const sx of [-1,1]) for(let i=0;i<5;i++){ const x=sx*(520+i*80); pbox(58,0.6,40,x,e+0.3,-40,"hangar"); pbox(58,0.6,40,x,e+0.3,45,"hangar"); }
      // landing towers: square trunks with chamfered corners and ribbed faces, a flared underside and a
      // wide chamfered-square pad on top, rimmed with red lights
      const chamf=(h,c)=>new THREE.Shape([[-h+c,-h],[h-c,-h],[h,-h+c],[h,h-c],[h-c,h],[-h+c,h],[-h,h-c],[-h,-h+c]].map(([a,b])=>new THREE.Vector2(a,b)));
      const prism=(sh,h,x,y,z,mat)=>{ const p=Pp(x,z); add(new THREE.ExtrudeGeometry(sh,{depth:h,bevelEnabled:false}),mat,at(p.x,y,p.z).multiply(R).multiply(rx(-Math.PI/2))); };
      for(const [x,z,hh] of [[-760,-380,140],[-300,-490,165],[380,-420,150],[720,-270,120]]){ const top=e+hh, trunk=top-44-y0;
        prism(chamf(46,14),trunk,x,y0,z,"concrete");
        for(const o of [-26,0,26]){ pbox(7,trunk,8,x+o,y0,z+48,"concrete"); pbox(7,trunk,8,x+o,y0,z-48,"concrete"); pbox(8,trunk,7,x+48,y0,z+o,"concrete"); pbox(8,trunk,7,x-48,y0,z+o,"concrete"); }
        for(let k=0;k<3;k++) pbox(24,2.2,3,x+13,top-90-k*34,z+52,"strip");
        { const p=Pp(x,z); add(new THREE.CylinderGeometry(146,74,44,4),"concrete",at(p.x,top-22,p.z).multiply(R).multiply(ry(Math.PI/4))); }
        prism(chamf(104,30),20,x,top,z,"concrete"); prism(chamf(105.6,30.6),1.8,x,top+13,z,"red");
        prism(chamf(72,20),11,x,top+20,z,"concrete"); pbox(34,10,22,x+30,top+31,z-20,"dark");
        pcyl(1,2,40,6,x-40,top+31,z+30,"dark"); pcyl(1,2,26,6,x+52,top+31,z-48,"dark");
        const p=Pp(x,z); blockers.push([p.x,p.z,top+30]); }
      { const a=Pp(380,-420), b=Pp(720,-270), L=a.distanceTo(b), ang=Math.atan2(b.x-a.x,b.z-a.z);
        add(new THREE.BoxGeometry(70,16,L-200),"concrete",at((a.x+b.x)/2,e+122,(a.z+b.z)/2).multiply(ry(ang))); }
      portE=e; }
    await tick();
    await tick();
    finish(M,{noShadow:["glass","red","blue","strip"], order:{glass:2}});
    await tick();

    // ---------------- forest: dense on the plateau's slopes, around the city, scattered elsewhere
    { const N=24000, cone=new THREE.ConeGeometry(1,1,6); cone.translate(0,0.5,0);
      const trees=new THREE.InstancedMesh(cone,M.tree,N), caps=new THREE.InstancedMesh(cone.clone(),M.snow,N);
      const m=new THREE.Matrix4(), q=new THREE.Quaternion(), v=new THREE.Vector3(), s3=new THREE.Vector3(), Y=new THREE.Vector3(0,1,0); let n=0;
      for(let tries=0;tries<N*9&&n<N;tries++){
        const u=rnd(), a=rnd()*Math.PI*2; let x,z;
        if(u<0.5){ const r=500+rnd()*3600; x=PORT.x+Math.cos(a)*r; z=PORT.z+Math.sin(a)*r; }
        else if(u<0.8){ const r=1500+rnd()*14000; x=Math.cos(a)*r; z=Math.sin(a)*r; }
        else { x=-16000+rnd()*42000; z=-14000+rnd()*40000; }
        if(lakeD(x,z)<1.1) continue; const y=hgt(x,z); if(y>1500||y<ICE+4) continue;
        if(cityMask(x,z)>0.02) continue;
        { const [plx,plz]=portLocal(x,z); if(Math.abs(plx)<1010&&plz>-560&&plz<215) continue; }
        if(fbm(x/500,z/500)<(Math.hypot(x-PORT.x,z-PORT.z)<4500?0.3:0.37)) continue;
        const sz=5+rnd()*4, h=16+rnd()*16; q.setFromAxisAngle(Y,rnd()*6.28);
        trees.setMatrixAt(n,m.compose(v.set(...curve(x,y-1,z)),q,s3.set(sz,h,sz)));
        caps.setMatrixAt(n,m.compose(v.set(...curve(x,y-1+h*0.48,z)),q,s3.set(sz*0.62,h*0.54,sz*0.62))); n++;
        if(n%3000===0) await tick(); }
      trees.count=caps.count=n; trees.castShadow=true; trees.receiveShadow=caps.receiveShadow=true; trees.frustumCulled=caps.frustumCulled=false;
      inner.add(trees,caps); }

    // ---------------- beacons on the tallest roofs and the landing towers
    { const bc=new THREE.InstancedMesh(new THREE.SphereGeometry(3.5,8,6),M.beacon,blockers.length);
      blockers.forEach(([x,z,h],i)=>bc.setMatrixAt(i,new THREE.Matrix4().makeTranslation(...curve(x,h+8,z)))); bc.frustumCulled=false; inner.add(bc); }

    // ---------------- the tour: the HQ spire, the main tram line out of downtown and across the lake, and
    // the spaceport (the demo flies this; the views below use the same spots)
    const SPIRE=LANDMARK.spire||{t:[0,0], y:hgt(0,0)+420, base:hgt(0,0), top:hgt(0,0)+900};
    const HALL=LANDMARK.port||{t:[PORT.x,PORT.z], y:portE};
    // the game's main line, as laid out (model x, z, height of the track): from the hub under the HQ, down
    // past the waterfront, straight across the ice, and into the spaceport's station
    const REAL_LINE=[[-357,-411,377],[105,121,366],[522,600,264],[853,981,176],[1184,1362,90],[1604,1846,2],[2129,2450,2],
      [8884,9098,5],[9606,9683,39],[10302,10247,76],[11149,10933,76],[11735,11836,76]];
    const LINE=(LAY&&hasMesh(/^transit_tunnel_open_straight_512/)?REAL_LINE.map(([x,z,y])=>[x,z,y+lift+(x*x+z*z)/(2*R0)])
      :TRAMS[0].map(p=>{ const [x,z]=toW(...IL(...p)); return [x,z,Math.max(30,hgt(x,z)+14)]; }));
    return {
      hgt,                       // ground height, to keep the camera above it
      ready:nearReady||Promise.resolve(),          // the close-up versions are in
      tour:{AX, spire:SPIRE, port:HALL, line:LINE},
      // camera views: t = point looked at (model x,z), y = its height, d = distance, yaw/p = direction
      views:{
        overview:{label:"Overview",t:toW(0,portDist*0.45),y:300,d:42000,yaw:AX+Math.PI+0.5,p:0.62},
        above:{label:"From above",t:toW(-1500,portDist*0.42),y:0,d:34000,yaw:AX,p:0.74},         // high over the lake, the spaceport at the bottom (steeper and the map turns north up)
        lake:{label:"From the lake",t:[0,0],y:200,d:6500,yaw:AX,p:0.09},
        downtown:LANDMARK.spire?{label:"The HQ",t:SPIRE.t,y:SPIRE.base+(SPIRE.top-SPIRE.base)*0.45,d:3300,yaw:AX+0.08,p:0.1}   // the spire, from down the boulevard
                               :{label:"The HQ",t:[0,0],y:300,d:1350,yaw:AX+0.08,p:0.06},
        port:{label:"Spaceport",t:HALL.t,y:HALL.y,d:2900,yaw:AX-2.553,p:0.3},
        fromport:{label:"From the port",t:[0,0],y:260,d:portDist+300,yaw:AX,p:0.072}},
      // every frame: windows, light strips, domes, the HQ's trim and beacons light up after sunset
      onFrame({night,now}){
        updateLod(now);
        M.facade.emissiveIntensity=0.03+0.62*night; M.strip.emissiveIntensity=0.25+1.6*night; M.glass.emissiveIntensity=0.05+0.7*night;
        M.accent.emissiveIntensity=0.45+1.2*night; M.hqglass.emissiveIntensity=0.45+0.9*night;
        if(LIT){ LIT.tower.emissiveIntensity=1.4*night; LIT.base.emissiveIntensity=1.3*night; LIT.glass.emissiveIntensity=1.6*night;
          LIT.plate.emissiveIntensity=1.2*night; LIT.port.emissiveIntensity=1.5*night; LIT.dome.emissiveIntensity=0.14*night;
          LIT.city.emissiveIntensity=1.4*night; }
        M.beacon.opacity=(Math.sin(now*0.004)>0.2?1:0.15)*(night>0.4?1:0.55); },
    };
  },
});

// base64 -> bytes
function nbytes(bin){ const u=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) u[i]=bin.charCodeAt(i); return u; }
// Normals for unshared triangles (3 corners each): where corners meet, the faces whose directions are within
// about 40 degrees of each other are shaded as one smooth surface; sharper edges stay crisp.
function creaseNormals(pos,nt,keys,cosMax=0.766){
  const fn=new Float32Array(nt*3), fu=new Float32Array(nt*3);
  for(let t=0;t<nt;t++){ const o=t*9;
    const ux=pos[o+3]-pos[o], uy=pos[o+4]-pos[o+1], uz=pos[o+5]-pos[o+2], vx=pos[o+6]-pos[o], vy=pos[o+7]-pos[o+1], vz=pos[o+8]-pos[o+2];
    const x=uy*vz-uz*vy, y=uz*vx-ux*vz, z=ux*vy-uy*vx, l=Math.hypot(x,y,z)||1;
    fn[t*3]=x; fn[t*3+1]=y; fn[t*3+2]=z; fu[t*3]=x/l; fu[t*3+1]=y/l; fu[t*3+2]=z/l; }
  const at=new Map();                               // corner position -> the corners there
  for(let v=0;v<nt*3;v++){ const k=keys[v]; let L=at.get(k); if(!L) at.set(k,L=[]); L.push(v); }
  const out=new Float32Array(nt*9);
  for(const L of at.values()) for(const v of L){ const t=(v/3)|0; let x=0,y=0,z=0;
    for(const w of L){ const s=(w/3)|0; if(fu[s*3]*fu[t*3]+fu[s*3+1]*fu[t*3+1]+fu[s*3+2]*fu[t*3+2]>=cosMax){ x+=fn[s*3]; y+=fn[s*3+1]; z+=fn[s*3+2]; } }
    const l=Math.hypot(x,y,z)||1; out[v*3]=x/l; out[v*3+1]=y/l; out[v*3+2]=z/l; }
  return out; }

// What gives light at night, by the model's name (the same rules as RULES in tools/city_lights.py). First match wins.
const LIGHT_RULES=[["none",/addon_|dressing|pillar|support|antenna|tank|strut|fence|railing|rail_|barrier|pipe|vent|cable|angular_layered|_terrain|ht_rooftop_(floor|entrance|doorway)/],
  ["glass",null], ["tower",/^building_\d+m_|^building_cluster_|hab_tower|city_main_|city_cluster_|rooftop_megalod/],
  ["base",/^building_base|^plate_base/], ["port",/^sp_|hangar|landing|_pad/], ["dome",/dome/],
  ["plate",/plate|transit|walkway|bridge|street|plaza|platform|deck/]];
function lightClass(m){ const n=(m.name||"").toLowerCase();
  for(const [c,rx] of LIGHT_RULES){ if(c==="glass"){ if(m.kind===5) return c; } else if(rx.test(n)) return c; }
  return "none"; }

function windowTextures(rnd){ const W=256,Hh=384, a=document.createElement("canvas"), b=document.createElement("canvas"); a.width=b.width=W; a.height=b.height=Hh;
  const g=a.getContext("2d"), e=b.getContext("2d"); g.fillStyle="#c3ccd6"; g.fillRect(0,0,W,Hh); e.fillStyle="#000"; e.fillRect(0,0,W,Hh);
  const cw=W/4, ch=Hh/6;
  for(let i=0;i<4;i++) for(let j=0;j<6;j++){ const x=i*cw+5, y=j*ch+7, w=cw-10, h=ch-14;
    const gl=g.createLinearGradient(x,y,x+w,y+h); gl.addColorStop(0,"#6f87a0"); gl.addColorStop(1,"#435870"); g.fillStyle=gl; g.fillRect(x,y,w,h);
    if(rnd()<0.36){ e.fillStyle=rnd()<0.7?`rgb(255,${196+rnd()*40|0},${120+rnd()*60|0})`:"rgb(170,215,255)"; e.globalAlpha=0.35+rnd()*0.5; e.fillRect(x,y,w,h); e.globalAlpha=1; } }
  const t1=new THREE.CanvasTexture(a), t2=new THREE.CanvasTexture(b);
  for(const t of [t1,t2]){ t.wrapS=t.wrapT=THREE.RepeatWrapping; t.anisotropy=8; t.colorSpace=THREE.SRGBColorSpace; } return [t1,t2]; }

})();
