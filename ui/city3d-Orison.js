"use strict";
// =================================================================== Orison in 3D  (ui/city3d-Orison.js)
// The hand-written half of Orison: its sky, its cloud sea and its camera views. Orison itself is the game's own
// layout, from ui/cities/Orison.js (tools/build_city.py, "Orison"): its platforms, placed exactly where Crusader's
// own container puts them, with close-up versions in ui/cities/Orison.near.js and the game's own lights.
// Without the layout file Orison is just a marker on Crusader, as before.
//
// Crusader is a gas giant: no ground. Below the platforms is Crusader's own cloudy globe, ~79 km down.
(()=>{
if(!window.City3D) return;
const CITY="Orison", PORT_NAME="August Dunlow Spaceport";

City3D.define({
  city:CITY, body:"Crusader", alsoAt:[PORT_NAME], file:"city3d-Orison.js",
  openView:{[PORT_NAME]:"port"},
  alt0:0,
  extent:60000,
  ground:[150000,82000],                   // its sky and haze blend in by 82 km: the platforms float ~79 km up
  panelAlt:180000,
  note:"The game's own platforms, floating ~79 km above Crusader's clouds.",
  weather:{                                // Crusader: a clear blue sky over cream and pink clouds, pink at dusk
    sky:{day:0xbcd6ee, dusk:0xd9a3b4, night:0x0b1020},
    zenith:{day:0x5f8fd0, dusk:0x584a78, night:0x05070f},
    sunGlow:0xffe6cc, hemi:[0xe8eef8,0xd9c4c8],
    haze:{near:8000, far:60000},
    precip:null,
  },

  async build(ctx){
    const {F, C, layout}=ctx;
    if(!(layout?.v===2&&layout.inst?.length)) return {hgt:()=>0, views:{}};
    const G=ctx.gameLayout({lightClass, lift:layout.a0-C.alt0, roofs:null, nearFile:"cities/Orison.near.js", lampTops:/$^/,
      landmarks:{port:/orison_sp|dunlow|landingpad|hangar/, tower:/hab|hotel|tower|building|platform/}});
    await G.build();
    const FOOT=G.footprint();
    // the cloud sea: 2.5 km under the lowest platform floor found round the city
    let low=Infinity;
    for(let x=-12000;x<=12000;x+=400) for(let z=-12000;z<=12000;z+=400){ const f=FOOT(x,z); if(f&&f.w>0.5) low=Math.min(low,f.floor); }
    const deck=(isFinite(low)?low:0)-2500;
    // No ground of its own: Crusader's own cloud-covered globe is already ~79 km below, as in the game. An
    // opaque cloud deck here read as a flat slab hanging in the air and got in the camera's way. hgt is only
    // the camera's floor (it can't sink below the platforms by more than a couple of km).
    const hgt=()=>deck+500;
    // the spaceport where the game has it (the middle of its own container's pieces, from the city file);
    // Quantum's pin is only the fallback
    const PT=G.landmarks.port, TW=G.landmarks.tower, GP=G.port, SK=G.skyline();
    const PIN=F.places[PORT_NAME], AIM=ctx.aimAt(PIN,GP);
    const portT=AIM?.t||PT?.t||[2000,2000];
    const portY=AIM?AIM.y+(AIM.pin?20:0):(PT?.y??deck+2600), toPort=Math.atan2(portT[0],-portT[1]);
    const portD=GP?Math.min(5000,Math.max(1200,GP.r*2.8)):2500;
    // "The platforms": straight at Orison's own label (the city's point, where the map writes its name)
    const HOME=F.places[CITY];
    const towerT=HOME?[HOME.x,HOME.z]:SK?.t||TW?.t||[0,0], towerY=HOME?HOME.alt-C.alt0:SK?SK.ground+(SK.top-SK.ground)*0.4:TW?(TW.base+(TW.top-TW.base)*0.5):deck+2600;
    const towerD=SK?Math.min(7000,Math.max(2200,SK.spread*2.4)):3000;
    return {
      hgt, ready:G.loadNear(),
      floorAlt:HOME?HOME.alt:SK?SK.ground:deck+2500,   // (Orison's own point: the main platforms' level)       // the platforms' level: the map's zoom and drag work about it, not Crusader's clouds
      views:{
        overview:{label:"Overview",t:[portT[0]*0.4,portT[1]*0.4],y:towerY,d:18000,yaw:toPort+Math.PI+0.5,p:0.35},
        city:{label:"The platforms",t:towerT,y:towerY,d:towerD,yaw:toPort+0.3,p:0.35},
        port:{label:"August Dunlow Spaceport",t:portT,y:portY,d:portD,yaw:toPort-0.6,p:0.4}},
      onFrame({night,now}){ G.update(now); G.onNight(night); },
    };
  },
});
// Light only from what the game has: its own fixtures and the glowing faces of its own materials.
function lightClass(m){ return m.kind===5?"glass":"none"; }
})();
