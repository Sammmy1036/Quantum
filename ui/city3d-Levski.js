"use strict";
// =================================================================== Levski in 3D  (ui/city3d-Levski.js)
// The hand-written half of Levski: its sky, its ground and its camera views. Levski itself is the game's own
// layout, from ui/cities/Levski.js (tools/build_city.py, "Levski"): everything Delamar's own container places
// within a few km of it (the hangars, landing areas, walkways, lamps and the rock built round them, including
// the game's merged rock meshes), with its close-up versions in ui/cities/Levski.near.js. Its lights are the
// game's own fixtures. Without the layout file Levski is just a marker on Delamar, as before.
//
// The ground is Delamar's real height map (ui/terrain/Delamar.js), fitted under Levski's pieces. Delamar has
// no air: a black sky, hard light, no weather.
(()=>{
if(!window.City3D) return;
const CITY="Levski";

City3D.define({
  city:CITY, body:"Delamar", alsoAt:[], file:"city3d-Levski.js",
  alt0:0,
  extent:30000,
  edge:[12000,28000],                      // its ground: solid to 12 km, gone by 28 km (Delamar is a hole there)
  note:"The game's own layout round Levski; ground from Delamar's height map, fitted under it.",
  weather:{                                // airless: black sky, a faint dusty glow on the horizon by day
    sky:{day:0x2a2622, dusk:0x16120f, night:0x050506},
    zenith:{day:0x050506, dusk:0x030304, night:0x020203},
    sunGlow:0xfff1dc, hemi:[0x8a8070,0x2a2420],
    haze:null,                             // no air: no haze
    precip:null,
  },

  async build(ctx){
    const {F, C, terrain, pinned, heights, layout, fbm, sstep, THREE}=ctx;
    if(!(layout?.v===2&&layout.inst?.length)) return {hgt:()=>0, views:{}};
    const G=ctx.gameLayout({lightClass, lift:layout.a0-C.alt0, roofs:null, nearFile:"cities/Levski.near.js", lampTops:/$^/,
      landmarks:{port:/hangar|landing|pad/, tower:/compoundrendernode|rock|cliff|tower/}});
    await G.build();
    const FOOT=G.footprint(), WIDE=G.footprint({reach:6});
    const REAL=heights();
    const base0=REAL?((x,z)=>REAL(x,z)+(fbm(x/900+3,z/900+7)-0.5)*40+(fbm(x/180,z/180)-0.5)*8)
                    :((x,z)=>(fbm(x/4000+1,z/4000+2)-0.5)*300+(fbm(x/600,z/600)-0.5)*40);
    const base=(x,z)=>{ let h=base0(x,z); const W=WIDE(x,z), f=FOOT(x,z);
      if(W){ const k=sstep(0,1,W.w); h=h*(1-k)+Math.min(h,W.floor-2)*k; }
      if(f){ const w=sstep(0,1,f.w); h=h*(1-w)+(f.floor-1)*w; }
      return h; };
    const hgt=pinned(base,p=>!!FOOT(p.x,p.z));
    const mat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:1,metalness:0});
    await terrain(hgt,mat,(x,z,y,ny)=>{ const n=fbm(x/500,z/500), rock=sstep(0.92,0.7,ny);
      const dust=[0.30+0.04*n,0.27+0.035*n,0.24+0.03*n], dark=[0.16,0.145,0.13];          // grey-brown regolith, darker rock
      return [0,1,2].map(i=>dust[i]*(1-rock)+dark[i]*rock); },{seg:360});
    const PT=G.landmarks.port, TW=G.landmarks.tower;
    const portT=PT?.t||[0,0], portY=PT?.y??hgt(0,0)+40, toPort=Math.atan2(portT[0],-portT[1]);
    const rockT=TW?.t||[0,0], rockY=TW?(TW.base+(TW.top-TW.base)*0.5):hgt(0,0)+150;
    return {
      hgt, ready:G.loadNear(),
      views:{
        overview:{label:"Overview",t:[0,0],y:hgt(0,0)+200,d:9000,yaw:toPort+Math.PI+0.5,p:0.55},
        city:{label:"Levski",t:rockT,y:rockY,d:2200,yaw:toPort+0.3,p:0.2},
        port:{label:"The hangars",t:portT,y:portY,d:1400,yaw:toPort-0.6,p:0.3}},
      onFrame({night,now}){ G.update(now); G.onNight(night); },
    };
  },
});
// Light only from what the game has: its own fixtures and the glowing faces of its own materials.
function lightClass(m){ return m.kind===5?"glass":"none"; }
})();
