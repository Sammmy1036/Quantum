"use strict";
// =================================================================== Lorville in 3D  (ui/city3d-Lorville.js)
// The hand-written half of Lorville: its sky and weather, its ground and its camera views. The city itself
// is the game's own layout, from ui/cities/Lorville.js (tools/build_city.py) with its close-up versions in
// ui/cities/Lorville.near.js and its night lights in ui/citylights/Lorville.js; nothing here is hand-made.
// Without the layout file Lorville is just flat on the map, as before.
//
// The ground is Hurston's real elevation map (ui/terrain/Hurston.js), fitted under the city: where the
// layout has buildings, the ground is brought to the lowest floor of the pieces standing there, so nothing
// floats or sinks; outside the city it blends back into the real terrain.
(()=>{
if(!window.City3D) return;
const CITY="Lorville", PORT_NAME="Teasa Spaceport";

City3D.define({
  city:CITY, body:"Hurston", alsoAt:[PORT_NAME], file:"city3d-Lorville.js",
  openView:{[PORT_NAME]:"port"},
  alt0:0,
  extent:60000,
  note:"The game's own city layout; ground from Hurston's elevation map, fitted under the city.",
  weather:{                                // Hurston: a brown-orange haze, smog over the city, dust
    sky:{day:0xc9a983, dusk:0x7d5640, night:0x120c0a},
    zenith:{day:0x9b8a78, dusk:0x4a3530, night:0x07060a},
    sunGlow:0xffc488, hemi:[0xe8cfb0,0x5e4a3a],
    haze:{near:3500, far:30000},
    precip:{label:"Dust", color:0xc8a47c, size:0.9, opacity:0.45, fall:[1.5,3], drift:2.2, maxAlt:3000},
  },

  async build(ctx){
    const {F, C, terrain, pinned, heights, layout, fbm, sstep, THREE}=ctx;
    if(!(layout?.v===2&&layout.inst?.length)) return {hgt:()=>0, views:{}};
    // the city, drawn from the game's layout
    const G=ctx.gameLayout({lightClass, lift:layout.a0-C.alt0, roofs:null, nearFile:"cities/Lorville.near.js", lampTops:/port/,     // its streets are 500 m plates: lamps on them read as solid bands from afar
     
      landmarks:{port:/teasa/, tower:/bldg_uniq_med|ctybloc_comm_lge|bldg_slim_med|tower/}});
    await G.build();
    const FOOT=G.footprint(), WIDE=G.footprint({reach:8});   // the floor right here, and over ~1.2 km round it

    // ---------------- the ground: Hurston's real heights, fitted under the city's floor
    const REAL=heights();
    const base0=REAL?((x,z)=>REAL(x,z)+(fbm(x/1800+3,z/1800+7)-0.5)*60+(fbm(x/420,z/420)-0.5)*12)
                    :((x,z)=>(fbm(x/9000+1,z/9000+2)-0.5)*600+(fbm(x/1500,z/1500)-0.5)*80);
    // The game levels the ground under its cities; the elevation map (a point every 3-4 km) doesn't know
    // that, and pokes up through the city. So near the city the ground is kept below its floor, and right
    // under its pieces it's brought to just under their lowest floor.
    const base=(x,z)=>{ let h=base0(x,z); const W=WIDE(x,z), f=FOOT(x,z);
      if(W){ const k=sstep(0,1,W.w); h=h*(1-k)+Math.min(h,W.floor-3)*k; }
      if(f){ const w=sstep(0,1,f.w); h=h*(1-w)+(f.floor-1.5)*w; }
      return h; };
    const hgt=pinned(base,p=>!!FOOT(p.x,p.z));                            // places inside the city don't pull at it
    const mat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:0.95,metalness:0});
    await terrain(hgt,mat,(x,z,y,ny)=>{ const n=fbm(x/700,z/700), rock=sstep(0.93,0.75,ny), city=FOOT(x,z)?.w||0;
      const sand=[0.56+0.06*n,0.45+0.05*n,0.34+0.04*n], dark=[0.33,0.27,0.22], slab=[0.34,0.32,0.3];    // ochre dust, dark rock, concrete
      return [0,1,2].map(i=>(sand[i]*(1-rock)+dark[i]*rock)*(1-city*0.7)+slab[i]*city*0.7); },{seg:400});

    // ---------------- views
    const PT=G.landmarks.port, TW=G.landmarks.tower;
    // Teasa's own pin (the game's spot for it) comes first: the first pad-like model in the layout was often some
    // other landing pad across town, which left the camera looking at the wrong place
    const PIN=F.places[PORT_NAME];
    const portT=PIN?[PIN.x,PIN.z]:(PT?.t||[3000,3000]);
    const portY=PIN?hgt(...portT)+60:(PT?.y??hgt(...portT)+40), toPort=Math.atan2(portT[0],-portT[1]);
    const towerT=TW?.t||[0,0], towerY=TW?(TW.base+(TW.top-TW.base)*0.45):hgt(0,0)+200;
    return {
      hgt, ready:G.loadNear(),
      views:{
        overview:{label:"Overview",t:[portT[0]*0.4,portT[1]*0.4],y:hgt(0,0)+200,d:26000,yaw:toPort+Math.PI+0.5,p:0.6},
        city:{label:"The city",t:towerT,y:towerY,d:3600,yaw:toPort+0.3,p:0.12},
        port:{label:"Teasa Spaceport",t:portT,y:portY,d:3000,yaw:toPort-0.6,p:0.32}},
      onFrame({night,now}){ G.update(now); G.onNight(night); },
    };
  },
});

// What gives light at night, by the model's name: the same as city_lights.py's RULES with Lorville's
// CITY_RULES (first match wins; anything none of them name stays dark). The models coloured from the game's
// materials light their own windows and signs; this decides lamp tops on streets and pads, and the rest.
const LIGHT_RULES=[["none",/hangar_door|addon_|dressing|pillar|support|antenna|tank|strut|fence|railing|rail_|barrier|pipe|vent|cable|angular_layered|_terrain|ht_rooftop_(floor|entrance|doorway)/],
  ["none",/silo|smokestack|crane|pipeline|pipe|antenna|straddle|_frame|pillar|tank|chimney|border_addon|indu_addon|_addon_|rib$|_rib_/],
  ["tower",/ctybloc_comm|ctybloc_tile|ctybloc_lge|bldg_(slim|wide|bloc|uniq)|crntn_wall_(apt|fpanel)|crntn_wall|trench_bldg|ind_building|hab_|apartment|cbd|l19/],
  ["plate",/plating_strt|street|transit|trench_floor|walkway|bridge|plaza|platform|trst_/],
  ["port",/landingpad|lpad|_sp_|teasa|hangar|landing/],
  ["dome",/advert|billboard/],
  ["glass",null], ["tower",/^building_\d+m_|^building_cluster_|hab_tower|city_main_|city_cluster_|rooftop_megalod/],
  ["base",/^building_base|^plate_base/], ["port",/^sp_|hangar|landing|_pad/], ["dome",/dome/],
  ["plate",/plate|transit|walkway|bridge|street|plaza|platform|deck/]];
function lightClass(m){ const n=(m.name||"").toLowerCase();
  for(const [c,rx] of LIGHT_RULES){ if(c==="glass"){ if(m.kind===5) return c; } else if(rx.test(n)) return c; }
  return "none"; }
})();
