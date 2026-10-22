"use strict";
// =================================================================== Area 18 in 3D  (ui/city3d-Area18.js)
// The hand-written half of Area 18: its sky and weather, its ground and its camera views. The city itself
// is the game's own layout, from ui/cities/Area18.js (tools/build_city.py, "Area 18") with its close-up
// versions in ui/cities/Area18.near.js and its night lights in ui/citylights/Area18.js; nothing here is
// hand-made. Its lights at night come only from the game's own light fixtures and glowing materials.
// Without the layout file Area 18 is just flat on the map, as before.
//
// The ground is ArcCorp's real elevation map (ui/terrain/ArcCorp.js) where there is one, fitted under the
// city as Lorville's is: where the layout has buildings, the ground is brought to the lowest floor of the
// pieces standing there, so nothing floats or sinks.
(()=>{
if(!window.City3D) return;
const CITY="Area 18", PORT_NAME="Area 18's spaceport", RIKER="Riker Memorial Spaceport";

City3D.define({
  city:CITY, body:"ArcCorp", alsoAt:[PORT_NAME,RIKER], file:"city3d-Area18.js",
  openView:{[PORT_NAME]:"port",[RIKER]:"port"},
  alt0:0,
  extent:60000,
  note:"The game's own city layout; ground from ArcCorp's elevation map, fitted under the city.",
  weather:{                                // ArcCorp: a teal haze over a rose-grey city, no weather to speak of
    sky:{day:0xa9c6c2, dusk:0x6a5a66, night:0x0b0d12},
    zenith:{day:0x7da3a6, dusk:0x3c3448, night:0x05070b},
    sunGlow:0xffd2a8, hemi:[0xd6e4e2,0x5a4c50],
    haze:{near:5000, far:40000},
    precip:null,                           // no snow or dust (the default is New Babbage's snowfall)
  },

  async build(ctx){
    const {F, C, terrain, pinned, heights, layout, fbm, sstep, THREE}=ctx;
    if(!(layout?.v===2&&layout.inst?.length)) return {hgt:()=>0, views:{}};
    // the city, drawn from the game's layout
    const G=ctx.gameLayout({lightClass, lift:layout.a0-C.alt0, roofs:null, nearFile:"cities/Area18.near.js", lampTops:/$^/,
      landmarks:{port:/riker|spaceport|_sp_|landingpad/, tower:/tower|skyscraper|highrise|high_rise|bldg|building/}});
    await G.build();
    // the floor right here, and over ~2.4 km round it (Area 18's blocks are tall and spread out, with its outer
    // districts up to 25 km off: the ground must stay under all of them, not just the centre)
    const FOOT=G.footprint(), WIDE=G.footprint({reach:16});

    // ---------------- the ground: ArcCorp's real heights where there are any, fitted under the city's floor
    const REAL=heights();
    const base0=REAL?((x,z)=>REAL(x,z)+(fbm(x/1800+3,z/1800+7)-0.5)*30)
                    :((x,z)=>(fbm(x/9000+1,z/9000+2)-0.5)*200+(fbm(x/1500,z/1500)-0.5)*30);
    // The spaceport is a wide sunken deck with open pads and hangar pits between its pieces, where the
    // footprint above has gaps and the elevation map poked up through it: round the spaceport (where the game
    // has it) the ground is kept well below its deck.
    const SP=G.port, spD=SP?(x,z)=>Math.hypot(x-SP.t[0],z-SP.t[1]):null;
    const base=(x,z)=>{ let h=base0(x,z); const W=WIDE(x,z), f=FOOT(x,z);
      if(W){ const k=sstep(0,0.5,W.w); h=h*(1-k)+Math.min(h,W.floor-4)*k; }
      if(f){ const w=sstep(0,1,f.w); h=h*(1-w)+(f.floor-1.5)*w; }
      if(SP){ const k=1-sstep(SP.r*1.3,SP.r*2.2+400,spD(x,z)); if(k>0) h=h*(1-k)+Math.min(h,SP.base-30)*k; }
      return h; };
    const hgt=pinned(base,p=>!!FOOT(p.x,p.z)||(SP&&spD(p.x,p.z)<SP.r*2.2+400));   // (Quantum's pins there don't pull the ground up)
    const mat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:0.95,metalness:0});
    await terrain(hgt,mat,(x,z,y,ny)=>{ const n=fbm(x/700,z/700), city=FOOT(x,z)?.w||0;
      const crust=[0.52+0.05*n,0.44+0.04*n,0.45+0.04*n], slab=[0.36,0.34,0.35];   // ArcCorp's rose-grey built crust, concrete
      return [0,1,2].map(i=>crust[i]*(1-city*0.7)+slab[i]*city*0.7); },{seg:400});

    // ---------------- views
    // The spaceport where the game has it (the middle of its own container's pieces, from the city file);
    // Quantum's own point for it is only good to a km or two. The city view looks down on the skyline from
    // above and outside it, instead of from between two towers.
    const PT=G.landmarks.port, GP=G.port, SK=G.skyline();
    const PIN=F.places[RIKER]||F.places[PORT_NAME], AIM=ctx.aimAt(PIN,GP);     // straight at its label
    const portT=AIM?.t||PT?.t||[3000,3000];
    const portY=AIM?(AIM.pin?Math.max(AIM.y,hgt(...portT))+20:AIM.y):(PT?.y??hgt(...portT)+40), toPort=Math.atan2(portT[0],-portT[1]);
    const portD=GP?Math.min(6000,Math.max(1400,GP.r*2.8)):3000;
    const cityT=SK?.t||[0,0], cityY=SK?SK.ground+(SK.top-SK.ground)*0.3:hgt(0,0)+200, cityD=SK?Math.min(9000,Math.max(2800,SK.spread*2.6)):5000;
    return {
      hgt, ready:G.loadNear(),
      views:{
        overview:{label:"Overview",t:[portT[0]*0.4,portT[1]*0.4],y:hgt(0,0)+200,d:22000,yaw:toPort+Math.PI+0.5,p:0.6},
        city:{label:"The city",t:cityT,y:cityY,d:cityD,yaw:toPort+0.3,p:0.5},
        port:{label:"Riker Memorial Spaceport",t:portT,y:portY,d:portD,yaw:toPort-0.6,p:0.5}},
      onFrame({night,now}){ G.update(now); G.onNight(night); },
    };
  },
});

// What gives light at night: only what the game has. The pieces coloured from the game's materials light
// their own windows, signs and light strips, and the city file's light fixtures are drawn where the game
// places them. Nothing is lit by its model's name, and no lamps are added to streets or pads.
function lightClass(m){ return m.kind===5?"glass":"none"; }
})();
