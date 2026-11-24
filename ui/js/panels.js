// Quantum UI: Systems and layers, the detail card, the HUD (guidance and next stop) and the sidebar.
// One of several classic scripts sharing one global scope; index.html loads them in order.
"use strict";
// =================================================================== systems & layers
// Places in the shown system that aren't on the map yet (no position): gateways first, one click to their card.
function renderOffmap(){ const L=S.locs.filter(x=>x.system===S.system&&!x.pos).sort((a,b)=>(b.type==="jump")-(a.type==="jump")||a.name.localeCompare(b.name));
  const el=$("offmap"); el.classList.toggle("show",L.length>0);
  el.innerHTML=L.length?`<div class="t">Not on the map yet (${L.length})</div>${L.slice(0,8).map(x=>`<a class="${x.type==="jump"?"gw":""}" data-om="${esc(x.name)}">${x.type==="jump"?"◎ ":""}${esc(x.name)}${x.to?` <span class="muted">→ ${esc(x.to)}</span>`:""}</a>`).join("")}${L.length>8?`<div class="muted">+${L.length-8} more in search</div>`:""}`:""; }
$("offmap").onclick=e=>{ const a=e.target.closest("[data-om]"); if(a) select({kind:"loc",name:a.dataset.om}); };
function setSystem(sys,fit=true){ if(!S.systems.includes(sys)) return; const changed=sys!==S.system; S.system=sys; renderSysSeg(); renderOffmap(); if(changed&&S.preview) setTimeout(journeyChip);
  if(changed){ setLock(null); S.anim=null; buildSystem(); setSky(sys);
    // Start the new system from well outside it, then glide in. The view's centre jumps to the new star, and
    // keeping the old zoom (a few metres over a moon) put the camera inside the star: a white flash.
    S.focus={kind:"system"}; S.cam.target=systemCenter(); S.cam.dist=Math.max(S.cam.dist,systemExtent()*3.5); }
  if(fit){ S.cam.target=systemCenter(); fitSystem(); } renderResults(); renderWaypoints(true); }
function renderSysSeg(){ const here=S.live?.game_off?null:(S.live?.player?.system||S.live?.where?.system);
  $("sysSeg").innerHTML=S.systems.map(s=>{ const w=wikiSystem(s); const tip=w?`${w.affiliation} · ${w.star_type||""}`:"";
    return `<button data-s="${s}" aria-pressed="${s===S.system}" title="${esc(tip)}">${s}</button>`; }).join("");  const tb=$("tb-sys"); if(tb) tb.innerHTML=S.systems.map(s=>`<button data-s="${s}" aria-pressed="${s===S.system}">${s.toUpperCase()}</button>`).join(""); }
$("sysSeg").onclick=e=>{ const b=e.target.closest("button"); if(b){ S.autoSystem=false; setSystem(b.dataset.s); } };
$("tb-sys").onclick=e=>{ const b=e.target.closest("button"); if(b){ S.autoSystem=false; setSystem(b.dataset.s); } };   // the same, in the title bar
function buildLayers(){
  const el=$("layer-list"); el.innerHTML="";
  const mk=(lbl,checked,cls,on)=>{ const l=document.createElement("label"); l.innerHTML=`<input type="checkbox" ${checked?"checked":""}><span class="ty ${cls}"></span>${esc(lbl)}`;
    l.querySelector("input").onchange=e=>on(e.target.checked); el.appendChild(l); };
  mk("Contract objectives",S.show.missions,"mission",v=>S.show.missions=v);
  mk("My waypoints (pinned)",S.show.waypoints,"wp",v=>S.show.waypoints=v);
  for(const [k,v] of Object.entries(TYPES)){ mk(v.label,S.layers[k],k,val=>S.layers[k]=val);
    if(k==="station") mk("Wikelo emporiums",S.layers.wikelo!==false,"wikelo",val=>S.layers.wikelo=val); }
  el.appendChild(document.createElement("hr"));
  mk("Orbits",S.show.orbits,"",v=>S.show.orbits=v); mk("Lat/lon grid",S.show.grid,"",v=>{ S.show.grid=v; try{ localStorage.setItem("q-grid",v?"1":"0"); }catch{} });
  mk("Distance rings",S.show.rings,"",v=>{ S.show.rings=v; try{ localStorage.setItem("q-rings",v?"1":"0"); }catch{} });
  mk("Galaxy background",S.show.sky,"",v=>{ S.show.sky=v; try{ localStorage.setItem("q-sky",v?"1":"0"); }catch{} scene.background=v?sky.texture:null; });
  $("layers-hdr").onclick=()=>{ el.hidden=!el.hidden; $("layers-caret").textContent=el.hidden?"▸":"▾"; };
  el.hidden=true; $("layers-caret").textContent="▸";
}

// =================================================================== detail card
function select(sel){ S.selected=sel; renderDetail(); highlightResult(); }
// ---- location services (Star Citizen Wiki API)
const SVC_ICONS={
  pad:'<path d="M12 3l3 7h-6z"/><path d="M9 10l-4 4h14l-4-4"/><path d="M4 20h16"/>',
  hangar:'<path d="M3 20V10l9-6 9 6v10"/><path d="M7 20v-7h10v7"/><path d="M7 16h10"/>',
  wrench:'<path d="M14.5 5.5a4 4 0 0 0-5 5L4 16l4 4 5.5-5.5a4 4 0 0 0 5-5l-2.5 2.5-2.5-.5-.5-2.5z"/>',
  dock:'<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  cargo:'<path d="M4 9h7v11H4zM13 13h7v7h-7z"/><path d="M16.5 3v7M14 5.5l2.5-2.5 2.5 2.5"/>',
  refine:'<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3"/><path d="M7.5 15h9"/>',
  med:'<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"/>',
  shop:'<path d="M5 8h14l-1 12H6z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
  food:'<path d="M7 3v8M5 3v4a2 2 0 0 0 4 0V3M7 11v10"/><path d="M16 3c-2 2-2 6 0 8v10"/>',
  ship:'<path d="M12 1 14.7 4 14.7 4.6 16.1 4.8 15.9 5.4 14.6 5.6 14.5 6.2 14.7 10.4 15 11.2 17.9 14.2 20.6 13.4 20.8 12.7 21.3 12.7 21.3 16.8 20.8 16.8 20.6 15.6 17.9 19.6 17.9 20.3 15.1 22.8 14.1 22.8 13.9 20.1 12.6 20.1 12.5 21.3 11.5 21.3 11.4 20.1 10.1 20.1 9.9 22.8 8.9 22.8 6.1 20.3 6.1 19.6 3.4 15.6 3.2 16.8 2.7 16.8 2.7 12.7 3.2 12.7 3.4 13.4 6.1 14.2 9 11.2 9.3 10.4 9.5 6.2 9.4 5.6 8.1 5.4 7.9 4.8 9.3 4.6 9.3 4z"/>',                // the rail's Ships icon
  dot:'<circle cx="12" cy="12" r="4"/>',
  component:'<rect x="6" y="6" width="12" height="12" rx="1.5"/><rect x="9.5" y="9.5" width="5" height="5"/><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"/>'};
// solid game-style icons (the Star Citizen UI's own glyphs), drawn filled on their own grid
const SVC_SOLID={
  pistol:['0 0 50 50','M50 9.5v-.9l-1.7-1.1h-2.2c0 .2-.2.4-.4.4h-2.5c-.2 0-.4-.2-.4-.4H31.1l.1.5h-8.5l-.6-.5H4.5L1.7 9.1c-.3.2-.5.4-.7.7l-.7 1.5V14l.7.8v1.1l5 2.3s1.2 2.5-.8 6-3.4 4.6-5 12.5c0 0-.8 3 1 3.7 0 0-.1.5.3.8l-.3.9s0 .3 1.5.4 7.8 0 7.8 0 2.7-.1 2.7-2.1l.5-2.2s-.7-.5-.2-2.5c.5-2 1.4-4.8 1.4-4.8s.2-1.2 1.3-1.7.4-1.1.4-1.1-.4-1.5.6-3.6l.4-.8s2.1-1.5 4.2.1h6.6l4.4-4.8 2.3-.7h11.4l.3-.4h.2l.5-.5h.7s.8-.1.8-1.1l-.1-2.3h.2l.5-1.3-.2-.2V12l-.2-.3s.5-.6.5-1.4l.3-.8zm-22.3 6.4 2.5 2.1-.2 2.4-1.8 2.1h-3.6l.1-.4-.1-.4s-2.5-1.1-1.9-5.8h5z'],
  utility:['0 0 50 50','M24.8 16.2c-1.2.4-2.3 1-3.2 1.9-.8.8-1.4 1.7-1.8 2.7s-.5 2-.5 3.1c.1 1.2-.3 2.3-1.1 3.1L1 44.3c-.6.6-1 1.4-1 2.4 0 .9.3 1.7 1 2.3.6.6 1.4 1 2.4 1 .9 0 1.7-.3 2.3-1l16.6-16.6c1.2-1.2 2.3-1.6 3.4-1.5 1.2.2 2.4.1 3.5-.2 1.2-.4 2.2-1 3.1-1.9 1-1 1.6-2.1 2-3.5.3-1.3.3-2.6 0-3.9 0-.2-.1-.3-.2-.3-.1-.1-.3 0-.5.1L30.8 24c-.5.5-1.1.7-1.8.7s-1.3-.2-1.8-.7L26 23c-.5-.5-.7-1.1-.7-1.8s.2-1.3.7-1.8l2.7-2.7c.4-.4.3-.6-.3-.7-1.3-.2-2.5-.2-3.6.2m-4.5 12.3c.2-.2.5-.3.8-.3s.6.1.8.3c.2.2.3.5.3.8s-.1.6-.3.8L4.7 47.2c-.2.2-.5.3-.8.3s-.6-.1-.8-.3-.3-.5-.3-.8.1-.6.3-.8l17.2-17.1M45.4 9.2c0-.2-.1-.4-.2-.6l-3.8-3.8c-.1-.1-.3-.2-.5-.2s-.4.1-.6.2l-3 3c-2.1-1.4-4.4-2.3-6.9-2.8V.8c0-.2-.1-.4-.2-.5-.2-.2-.3-.2-.6-.2h-5.4c-.2 0-.4.1-.5.2-.2.1-.2.3-.2.5v4.3c-2.5.6-4.7 1.5-6.8 2.9l-3.1-3.1c-.1-.1-.3-.2-.5-.2s-.4.1-.6.2L8.7 8.7c-.1.1-.2.3-.2.5s.1.4.2.6l3.1 3.1C10.4 15 9.5 17.2 9 19.6H4.6c-.2 0-.4.1-.5.2-.1.2-.2.4-.2.6v5.4c0 .2.1.4.2.6.1.1.3.2.5.2h4.5c.3 1.5.8 3 1.4 4.3l3.9-3.9c-.7-2.3-.8-4.6-.2-7s1.7-4.5 3.5-6.2c2.6-2.6 5.7-3.8 9.3-3.8s6.7 1.3 9.3 3.8c2.6 2.6 3.9 5.7 3.9 9.3s-1.3 6.7-3.9 9.3c-1.8 1.8-3.9 2.9-6.3 3.5s-4.7.5-7-.3l-3.9 3.9c1.4.7 2.9 1.2 4.4 1.5v4.4c0 .2.1.4.2.6.2.1.3.2.5.2h5.4c.2 0 .4-.1.6-.2.1-.2.2-.3.2-.6V41c2.5-.5 4.8-1.4 6.8-2.8l3.1 3c.2.2.3.2.6.2s.4-.1.5-.2l3.8-3.8c.2-.2.2-.3.2-.6s-.1-.4-.2-.6l-3-3c1.4-2.1 2.4-4.3 2.9-6.9h4.2c.2 0 .4-.1.6-.2.2-.2.2-.3.2-.6v-5.4c0-.2-.1-.4-.2-.5-.2-.2-.3-.2-.6-.2H45c-.5-2.4-1.4-4.7-2.9-6.9l3-3c.2.1.3 0 .3-.3z'],
  turret:['0 0 16 16','M9.617 14.31h2.195v.44H2.891v-.66l2.994-.634-.715-2.234-2.059.523c-.658-.385-1.015-.607-1.674-.992L1 9.046 7.646 7.31l.22.882 6.647-1.737.331 1.267-6.646 1.737.22.882-1.784.523.826 2.62 1.868.248.3.58zM8.464 4.281l.22.882-5.299 1.379c-.658-.386-1.015-.607-1.674-.993l-.44-1.71 6.645-1.734.221.855 6.532-1.71L15 2.518 8.464 4.224z']};
// The game's own marker for a service, when it has one. Pads and hangars come in sizes (the number is part of
// the icon); without a size, or for an XL pad (the game has none), the drawn icon and its size badge stay.
function svcGameKey(name,size){ const n=name.toLowerCase(), z={S:"s",M:"m",L:"l",XL:"xl"}[String(size||"").toUpperCase()];
  if(/landing pad/.test(n)) return z?"pad_"+z:null;            // (XL: the game's own extra-large pad marker too)
  if(/hangar/.test(n)) return z?"hangar_"+z:null;
  if(/garage/.test(n)) return "garage";
  if(/freight elevator/.test(n)) return "freight_elevator";
  if(/refiner/.test(n)) return "refinery";
  if(/vehicle servic|ship servic|repair|refuel|restock/.test(n)) return "vehicle_servicing";
  if(/rent|rental/.test(n)&&/vehicle|ship|rent a|rental/.test(n)) return "rent_vehicle";
  if(/(ship|vehicle) weapon/.test(n)) return "shop_vehicle_items";          // ship guns, missiles and their mounts
  if(/(ship|vehicle) (component|item|part)s?/.test(n)) return "player_vehicle";
  if(/weapon|gun ?shop|firearm|ammo/.test(n)) return "shop_weapons";
  if(/armou?r/.test(n)) return "shop_armor";
  if(/cloth|apparel|fashion|outfit/.test(n)) return "shop_clothes";
  if(/food|restaurant|\bbar\b|caf[eé]|diner|noodle|burrito|pizza/.test(n)) return "shop_food_court";
  return null; }
function svcIcon(name){ const n=name.toLowerCase();
  if(/ship component|ship items?\b(?! and)/.test(n)) return `<svg viewBox="0 0 24 24" aria-hidden="true">${SVC_ICONS.component}</svg>`;
  const s=n.includes("weapon")&&(n.includes("ship")||n.includes("vehicle"))?"turret":n.includes("weapon")?"pistol":n.includes("vehicle services")?"utility":null;
  if(s) return `<svg class="solid" viewBox="${SVC_SOLID[s][0]}" aria-hidden="true"><path d="${SVC_SOLID[s][1]}"/></svg>`;
  const k=n.includes("landing pad")?"pad":n.includes("hangar")||n.includes("garage")?"hangar":n.includes("vehicle services")||n.includes("repair")?"wrench":n.includes("docking")?"dock"
    :n.includes("loading dock")||n.includes("freight elevator")||n.includes("commodity")||n.includes("cargo")?"cargo":n.includes("refinery")?"refine":n.includes("clinic")||n.includes("hospital")||n.includes("medical")?"med"
    :n.includes("food")?"food":n.includes("vehicle")||n.includes("ship")&&n.includes("rent")?"ship":n.includes("buy")||n.includes("rent")||n.includes("shop")?"shop":"dot";
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${SVC_ICONS[k]}</svg>`; }
const SVC_ORDER=["landing pad","hangar","docking","loading dock","freight elevator","vehicle services","commodity","refinery","clinic","hospital","rent","buy","food"];
function svcRank(n){ n=n.toLowerCase(); const i=SVC_ORDER.findIndex(k=>n.includes(k)); return i<0?99:i; }
// A crate with a price tag: the Commodities tile (opens what the place's terminals buy and sell)
const SVC_COMMODITY='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8.5 11 4.5l8 4v9l-8 4-8-4z"/><path d="M3 8.5l8 4 8-4M11 12.5v9"/><path d="M15.5 13.5l5-2.5v3.2l-5 2.5z"/></svg>';
// The largest pad at a place as the tile shows it (S/M/L/XL): your report, then Quantum users', then the game's data
const padSize=place=>{ const L=place&&S.locMap[place]; if(!L) return null;
  const p=L.pad&&L.pad!=="unknown"?L.pad:L.pad_shared||L.pad_auto; return {small:"S",medium:"M",large:"L",xl:"XL"}[String(p||"").toLowerCase()]||null; };
// ---- Fuel prices on a place's card, drawn like a gas station's price sign. Nine looks to pick from in
// Settings > Placards (stored in localStorage "q-fuel-style"); "7b", the pylon sign in glass, is the default.
const FUEL_ICON={q:'<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M1.926 4.506c.53-.923 1.707-1.2 3.575-.83.254-.808.6-1.454 1.015-1.915C6.954 1.254 7.44 1 7.992 1c1.084 0 1.915.9 2.514 2.675 1.845-.369 3.045-.092 3.575.83.53.923.162 2.1-1.084 3.507.577.645.969 1.268 1.153 1.845.208.622.185 1.176-.069 1.637-.392.646-1.107.992-2.19.992a6.2 6.2 0 0 1-1.362-.162C9.93 14.102 9.1 15 8.015 15c-.53 0-1.038-.254-1.476-.761-.415-.461-.76-1.107-1.015-1.937-.507.092-.968.16-1.383.16-1.084 0-1.822-.322-2.168-.99-.277-.462-.323-1.016-.093-1.638.185-.577.577-1.2 1.154-1.846-1.292-1.406-1.638-2.56-1.108-3.482m10.38 6.804c.391-.07.645-.185.76-.392q.174-.278-.069-.83c-.161-.393-.438-.808-.83-1.27-.277.278-.669.577-1.13.946-.046.508-.139.992-.23 1.454.576.115 1.083.138 1.498.092m-5.698.738c.185.576.416 1.015.67 1.36.253.3.484.462.691.462.23 0 .462-.162.715-.461.254-.323.485-.785.67-1.361l-1.385-.53zm-.392-1.43.07.3.3-.093zm3.46.3.07-.3-.185.115-.185.092zM6.424 5.29l.184-.115-.3-.093-.069.3zm2.952-.115.37.207-.07-.3zm.554 3.967v-2.26l-.946-.577c-.07-.046-.415-.208-.992-.53-.53.3-.876.484-.991.53l-.946.576a9 9 0 0 0-.07 1.13q0 .59.07 1.108c.438.3.761.484.946.6l.991.53zm1.2-1.338v.415l.253-.207zm1.867-1.868c.162-.37.185-.646.07-.854-.093-.184-.347-.323-.762-.369-.415-.069-.922-.046-1.499.07.092.46.162.945.23 1.476.439.3.808.622 1.131.922q.588-.657.83-1.245M8.684 2.638c-.253-.323-.484-.485-.715-.485-.207 0-.461.162-.692.485-.253.322-.484.76-.669 1.337l1.361.53 1.384-.53C9.17 3.4 8.938 2.96 8.684 2.638M3.68 11.31c.415.046.923.023 1.5-.093a9 9 0 0 1-.231-1.453c-.461-.346-.83-.668-1.153-.945-.392.461-.646.876-.808 1.268q-.242.554-.069.83c.116.208.37.324.761.393m.923-3.298.254.207-.023-.207.023-.208zm.576-3.206a6.4 6.4 0 0 0-1.06-.116c-.646 0-1.061.139-1.2.415-.115.185-.092.485.07.854.16.392.415.807.807 1.245.369-.323.76-.622 1.153-.922.023-.392.115-.877.23-1.476"/></svg>',
  h:'<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M12.899 1H6.765L4.94 2.825h-.403l-.149-.133V2.47l-.568-.572h-.209L2 3.51v.226l.572.552h.234l.132.132v.403l-.306.306v8.793L3.712 15h9.187L14 13.906V2.156zM8.305 13.38a2.988 2.988 0 0 1-2.303-4.9c1.284-1.475 1.361-3.094 2.71-4.028-.403 1.57.842 2.819 1.865 4.027a2.989 2.989 0 0 1-2.288 4.906zM13.25 2.854H5.995L7.127 1.72h5.567l.556.532zM8.14 7.356A5.9 5.9 0 0 0 9.232 8.89c.117.133.233.262.346.403a1.667 1.667 0 1 1-2.55 0 6.5 6.5 0 0 0 1.056-1.809zm.165-1.12c-.56.656-.696 1.776-1.582 2.795a2.066 2.066 0 1 0 3.166 0c-.71-.842-1.584-1.587-1.584-2.795"/></svg>'};
const FUEL_STYLES=[["7","Pylon sign"],["8","Digit board"],["9","Pump grades"],["7a","Pylon · Tonal"],["7b","Pylon · Glass"],["7c","Pylon · Raised"],
  ["8a","Digit board · Tonal"],["8b","Digit board · Glass"],["8c","Digit board · Raised"]];
const FUEL_DEFAULT="7b";
S.fuelStyle=(()=>{ try{ const v=localStorage.getItem("q-fuel-style"); return FUEL_STYLES.some(([k])=>k===v)?v:FUEL_DEFAULT; }catch{ return FUEL_DEFAULT; } })();
function setFuelStyle(k){ if(!FUEL_STYLES.some(([x])=>x===k)) return; S.fuelStyle=k; try{ localStorage.setItem("q-fuel-style",k); }catch{}
  for(const b of document.querySelectorAll("[data-fuelstyle]")) { b.classList.toggle("on",b.dataset.fuelstyle===k); b.setAttribute("aria-pressed",b.dataset.fuelstyle===k); } }
function fuelHtml(fuel,style=S.fuelStyle){
  const rows=[...fuel].map(f=>{ const q=/quantum/i.test(f.what); return {k:q?"q":"h",name:q?"QUANTUM":"HYDROGEN",price:Number(f.price).toLocaleString("en-US")}; })
    .sort((a,b)=>(a.k==="q"?0:1)-(b.k==="q"?0:1));
  const kind=style[0], pal=style[1]||"k", unit=`<span class="fu-u">aUEC<br>/SCU</span>`;
  if(kind==="9") return `<div class="fu fu-9"><div class="fu-grades">${rows.map(r=>`<div class="fu-g fu-${r.k}"><div class="fu-band">${FUEL_ICON[r.k]}${r.name}</div><div class="fu-p">${r.price}</div><div class="fu-cap">aUEC PER SCU</div></div>`).join("")}</div><div class="fu-src">FUEL PRICES · UEX</div></div>`;
  if(kind==="8") return `<div class="fu fu-8 pal-${pal}"><div class="fu-title">· FUEL ·</div>${rows.map(r=>`<div class="fu-row fu-${r.k}"><span class="fu-n">${FUEL_ICON[r.k]}<b>${r.name}</b></span>
      <span class="fu-digits">${[...r.price.padStart(5," ")].map(c=>c===","?`<i class="c">,</i>`:`<i>${c===" "?"":c}</i>`).join("")}</span>${unit}</div>`).join("")}<div class="fu-src">PRICES FROM UEX</div></div>`;
  return `<div class="fu fu-7 pal-${pal}"><div class="fu-head"><b>REFUEL</b><span>PRICES · UEX</span></div>${rows.map(r=>`<div class="fu-row fu-${r.k}"><span class="fu-i">${FUEL_ICON[r.k]}</span><b class="fu-n">${r.name}</b><span class="fu-pp"><b>${r.price}</b>${unit}</span></div>`).join("")}</div>`; }
const commodityTile=on=>`<div class="svc-tile click ${on?"on":""}" data-stock="1" title="What the commodity terminals here buy and sell, with prices and how recent they are">${SVC_COMMODITY}<div class="bar"></div><div class="l">Commodities</div></div>`;
// Still being fetched for this place: its services (wiki/UEX), which places have commodity terminals, or which
// have shops. The card waits for all of them and then shows every tile at once (before, Commodities showed up
// alone first and the rest popped in after it).
function servicesLoading(place){ const L=place&&S.locMap[place]; if(!L) return false;
  return S.tradePlaces===null||S.shopPlaces===null||!!(L.amen&&!(place in S.svcCache)); }
const SVC_LOADING=`<div class="svc"><div class="none svc-loading"><span class="svc-spin"></span>Loading services offered…</div></div>`;
function servicesHtml(r,place){
  if(servicesLoading(place)) return SVC_LOADING;
  const trade=place&&S.tradePlaces?.has(place), on=trade&&S.stock?.place===place&&S.stock.kind==="commodity";
  // no services (yet, or none listed for the place): a place with a commodity terminal still gets its Commodities
  // tile, so that's where it always is; the card has no Commodities button of its own
  if(!r) return trade?`<div class="svc"><div class="svc-grid">${commodityTile(on)}</div></div>`:"";
  // A terminal amenity the wiki lists ("Commodity Terminal", "Trade") becomes the Commodities tile itself
  const isTrade=a=>/commodit|trade|trading/i.test(a)&&!/loading dock|freight/i.test(a);
  const tiles=placeAmenities(r.amenities,place).filter(a=>!(trade&&isTrade(a))).sort((a,b)=>svcRank(a)-svcRank(b)||a.localeCompare(b)).map(a=>{
    const m=a.match(/^(Landing Pad|Hangar) *[(]?(XL|S|M|L)?[)]?$/i); const label=m?m[1]:a;
    if(m&&/^landing/i.test(m[1])){ const pz=padSize(place); if(pz) m[2]=pz; }
    const g=place&&shopGroupFor(a,place), gon=g&&S.stock?.kind==="shop"&&S.stock.place===place&&S.stock.group===g;
    const gk=svcGameKey(a,m?.[2]), sized=!!gk&&/^(pad|hangar)_/.test(gk);   // the game's pad / hangar icons carry their size
    // Hospital / Clinic: always opens its own window (the hospital itself, your check-ins there, the pharmacy)
    if(place&&HOSP_RX.test(a)){ const hon=S.stock?.kind==="hospital"&&S.stock.place===place;
      return `<div class="svc-tile click${hon?" on":""}" data-hosp="1" title="${esc(a)}: the ${/clinic/i.test(a)?"clinic":"hospital"} here, your check-ins and what its pharmacy sells">${gk?gameIcon(gk):svcIcon(a)}<div class="bar"></div><div class="l">${esc(label)}</div></div>`; }
    return `<div class="svc-tile${g?" click":""}${gon?" on":""}" ${g?`data-shop="${g}" title="${esc(a)}: see what's sold here"`:`title="${esc(a)}"`}>${m?.[2]&&!sized?`<span class="sz">${esc(m[2].toUpperCase())}</span>`:""}${gk?gameIcon(gk):svcIcon(a)}<div class="bar"></div><div class="l">${esc(label)}</div></div>`; }).join("")
    +(trade?commodityTile(on):"");
  // A long description is cut short with "More" to read it all ("Less" folds it again); which places you've
  // opened is kept, so the card can redraw every tick without folding it back up
  const full=r.description||"", long=full.length>260, open=long&&(S.descOpen?.has(place)||S.descFit===place&&!S.descShut?.has(place));
  const desc=!full?"":!long||open?esc(full)+(long?` <a class="desc-more" data-desc="less">Less</a>`:"")
    :esc(full.slice(0,full.lastIndexOf(" ",250)>180?full.lastIndexOf(" ",250):250).replace(/[\s,;:.]+$/,""))+`… <a class="desc-more" data-desc="more">More</a>`;
  return `<div class="svc">${r.jurisdiction?`<div class="jur">Jurisdiction <b>${esc(r.jurisdiction)}</b></div>`:""}
    ${tiles?`<div class="svc-grid">${tiles}</div>`:`<div class="none">No services listed for this location.</div>`}
    ${desc?`<div class="desc">${desc}</div>`:""}
    ${r.fuel?fuelHtml(r.fuel):""}
    ${r.uex?`<div class="credit">Services: UEX (community data)</div>`:""}
    ${r.url||r.reported?`<div class="credit">Services: ${r.reported?"reported by players (the game data lists none here)":wikiLink(r.url,"Star Citizen Wiki API")}${r.version?` · game ${esc(r.version.split("-")[0])}`:""}</div>`:""}</div>`; }
S.svcCache={};
// A photo of the place from its Star Citizen Wiki page, across the top of its card. Asked for once per
// place (S.picCache), so the card can be redrawn every tick without the picture flickering.
S.picCache={};
const PIC_TYPES=new Set(["city","station","outpost","jump","lpoint"]);
function placePicKey(sel){ if(sel.kind==="body"){ const w=wikiFor(sel.name); return w?.url?"body:"+sel.name:null; }
  const L=S.locMap[sel.name]; if(!L||L.source==="user"||L.source==="mission"||!PIC_TYPES.has(L.type)) return null; return "loc:"+L.name; }
function placePicHtml(key){ const p=key&&S.picCache[key]; if(!p?.url) return "";
  return `<div class="dpic"><img src="${esc(p.url)}" alt="" referrerpolicy="no-referrer" class="in">${p.page?`<a class="dpic-cr" data-url="${esc(p.page)}" title="Photo from the Star Citizen Wiki (CC BY-SA 4.0)">Star Citizen Wiki</a>`:""}</div>`; }
async function fillPlacePic(sel){ const key=placePicKey(sel); if(!key||key in S.picCache) return;
  S.picCache[key]=null;                                              // asked: don't ask again while it loads
  let r=null; try{ r=sel.kind==="body"?await api().place_image(sel.name,wikiFor(sel.name).url):await api().place_image(sel.name,null); }catch(_){}
  if(!r?.ok){ delete S.picCache[key]; return; }                     // offline: try again next time it's opened
  S.picCache[key]=r.url?{url:r.url,page:r.page}:{url:null}; if(!r.url) return;
  const d=$("detail"); if(!d||placePicKey(S.selected||{})!==key||d.querySelector(".dpic")) return;
  d.insertAdjacentHTML("afterbegin",placePicHtml(key)); const img=d.querySelector(".dpic img"); img.classList.remove("in");
  if(S.descFit===sel.name&&d.scrollHeight>d.clientHeight+1){ S.descFit=null; const el=$("d-svc"); if(el) el.innerHTML=servicesHtml(S.svcCache[sel.name],sel.name); }   // the picture took the room
  const show=()=>img.classList.add("in"); img.complete?show():(img.onload=show); img.onerror=()=>img.closest(".dpic")?.remove(); }
async function fillServices(name){
  if(!(name in S.svcCache)){ let r=null; try{ r=await api().get_services(name); }catch(_){}     // failed: no services, not "loading" forever
    S.svcCache[name]=r; }
  const el=$("d-svc"); if(el&&S.selected?.name===name){ el.innerHTML=servicesHtml(S.svcCache[name],name); fitDesc(name); } }
// Show the whole description when the card still fits the map without scrolling; keep "More" when it wouldn't.
// (Less still folds it, and it then stays folded for that place.)
function fitDesc(name){ const d=$("detail"), el=$("d-svc"); if(!d||!el||!el.querySelector('[data-desc="more"]')||S.descShut?.has(name)) return;
  const was=S.descFit; S.descFit=name; el.innerHTML=servicesHtml(S.svcCache[name],name);
  if(d.scrollHeight>d.clientHeight+1){ S.descFit=was===name?null:was; el.innerHTML=servicesHtml(S.svcCache[name],name); } }
// Your own pick, else what Quantum users agree on, else what the game data suggests.
function padOf(L){ return L.pad&&L.pad!=="unknown"?L.pad:(L.pad_shared||L.pad_auto||"unknown"); }
const PAD_LABEL={unknown:"Unknown",none:"None",vehicle:"Vehicle",small:"Small",medium:"Medium",large:"Large",xl:"XL",hangar:"Hangar"};
const padLabel=p=>PAD_LABEL[String(p||"unknown").toLowerCase()]||String(p).replace(/^./,c=>c.toUpperCase());
function wikiFor(name){ return S.wiki?.bodies?.[name]||null; }
function wikiSystem(name){ return S.wiki?.systems?.[name]||null; }
function wikiLink(url,label="Star Citizen Wiki"){ return url?`<a data-url="${esc(url)}">${esc(label)}</a>`:""; }
const CREDIT=url=>`<div class="credit">Info: ${wikiLink(url)} (CC BY-SA 4.0)</div>`;
function systemBlurb(sw){ if(!sw) return "";
  return `${sw.affiliation?`<span class="k">Affiliation</span><span>${esc(sw.affiliation)}</span>`:""}
    ${sw.star_type?`<span class="k">Star</span><span>${esc(sw.star||"")} · ${esc(sw.star_type)}</span>`:""}
    <span class="k">Bodies</span><span>${sw.planets.length} planet${sw.planets.length===1?"":"s"}${sw.moons?`, ${sw.moons} moon${sw.moons===1?"":"s"}`:""}${sw.belts.length?`, ${sw.belts.length} belt${sw.belts.length===1?"":"s"}`:""}${sw.asteroids?.length?`, ${sw.asteroids.length} large asteroid${sw.asteroids.length===1?"":"s"} (${sw.asteroids.map(esc).join(", ")})`:""}</span>`; }
function distFromYou(g,sys){ const p=S.live?.player; return g&&p&&p.system===sys?d3(g,playerG(now())):null; }
// The actions behind Settings' and the Profile page's buttons (account, UEX keys, backup, bug report, updates…)
async function settingsAction(a,e){
    if(a==="openalign"){ await openAlign(); return; }
    if(a==="logchange"){ const r=await api().browse_log(); if(r.ok){ toast("Now reading the selected Game.log"); await poll(); renderDetail(); } return; }
    if(a==="bugopen"){ S.bugOpen=true; S.bugSent=false; renderDetail(); $("s-bugmsg")?.focus(); return; }
    if(a==="bugcancel"){ S.bugOpen=false; renderDetail(); return; }
    if(a==="bugsend"){ const msg=($("s-bugmsg")?.value||"").trim(), contact=($("s-bugcontact")?.value||"").trim();
      if(msg.length<5) return toast("Describe the bug first");
      S.bugMsg=msg; S.bugContact=contact; S.bugBusy=true; renderDetail();
      const r=await api().send_bug_report(msg, contact); S.bugBusy=false;
      if(r.ok){ S.bugOpen=false; S.bugSent=true; S.bugMsg=""; S.bugContact=""; toast("Bug report sent. Thank you!"); } else toast(r.error);
      renderDetail(); return; }
    if(a==="uexsave"){ const v=$("s-uex").value.trim(); if(!v) return toast("Paste the token first"); toast("Checking the token…");
      const r=await api().set_uex_token(v); if(!r.ok){ toast(r.error); return; } S.bk=undefined;
      S.uexDraft=""; S.mk=null; S.veh=null; S.cpCats=null; S.cpItems=null; toast("UEX connected"); await poll(); await loadStatic(); renderDetail(); fillUexStatus(true); return; }
    if(a==="acctsignin"){ S.acctErr=""; S.acct=await api().account_sign_in(); renderDetail(); acctWatch(); return; }
    if(a==="acctlogin"){ const em=($("acct-email")?.value||"").trim(), pw=$("acct-pw")?.value||"";
      if(!em||!pw){ S.acctErr="Enter your email and password."; renderDetail(); (em?$("acct-pw"):$("acct-email"))?.focus(); return; }
      // Pressing Enter leaves the focus in the password box, and the profile doesn't redraw under typing:
      // let go of the box first so "Signing in…" shows the same as clicking the button
      if(document.activeElement?.closest?.("input,textarea")) document.activeElement.blur();
      S.acctEmail=em; S.acctBusy=true; S.acctErr=""; renderDetail();
      const r=await api().account_sign_in_password(em,pw); S.acctBusy=false; S.acct=r;
      if(r.ok){ S.acctErr=""; S.acctUnconfirmed=false; S.og.mine=null; S.pm.mine=null; toast(`Signed in as ${r.email}`); await acctKeysArrived(r); }
      else { S.acctErr=r.error; S.acctUnconfirmed=!!r.unconfirmed; }
      renderDetail(); if(!r.ok) $("acct-pw")?.focus(); return; }
    if(a==="acctkeys"){ const on=e.target.checked; S.acctKeysBusy=true; renderDetail();
      const r=await api().account_set_key_sync(on); S.acctKeysBusy=false; S.acct=r;
      if(r.ok){ toast(on?"Your UEX keys are kept in your Quantum account":"Removed from your Quantum account. They stay on this PC"); if(on) await acctKeysArrived(r); }
      else toast(r.error||"Couldn't change it. Try again");
      renderDetail(); return; }
    if(a==="acctfleetweb"){ const on=e.target.checked; S.acctFleetBusy=true; renderDetail();
      const r=await api().account_set_fleet_web(on); S.acctFleetBusy=false; S.acct=r;
      if(r.ok) toast(on?"Your fleet and gear loadouts are on the website":"Removed from the website. They stay on this PC");
      else toast(r.error||"Couldn't change it. Try again");
      renderDetail(); return; }
    if(a==="acctopen"){ S.acct=await api().account_open_page(); return; }
    if(a==="acctcancel"){ S.acct=await api().account_cancel(); renderDetail(); return; }
    if(a==="acctlink"){ toast("Linking your UEX name…"); S.acct=await api().account_link_now(); renderDetail();
      toast(S.acct.uex?`Linked to ${S.acct.uex}`:"Couldn't link it: check your UEX Secret Key above"); return; }
    if(a==="acctsignout"){ S.acct=await api().account_sign_out(); renderDetail(); toast("Signed out of your Quantum account on this PC"); return; }
    if(a==="commask"){ S.commAsk=true; renderDetail(); return; }
    if(a==="commcancel"){ S.commAsk=false; renderDetail(); return; }
    if(a==="commoff"||a==="common"){ S.commAsk=false; S.communityStatus=null; renderDetail();
      const r=await api().set_community_enabled(a==="common"); S.communityStatus=r; S.bk=undefined; S.ownerAsked=false;
      toast(a==="commoff"?"Community features are off. Quantum uses UEX's data alone":r.ok?"Community features are on and connected":"Community features are on, but the server didn't answer yet");
      renderDetail(); if(a==="common") setTimeout(()=>ownerCheck().catch(()=>{}),3000); return; }
    if(a==="communitysave"){ const r=await api().set_community_url($("s-community").value); S.communityStatus=r; S.communityDraft=undefined;
      toast(!r.url?"Community prices off":r.ok?"Community prices connected":"Saved, but the server didn't answer"); renderDetail(); return; }
    if(a==="updcheck"){ if(S.updChecking) return; S.updChecking=true; S.updNote=""; renderDetail();
      const [st]=await Promise.all([api().update_status(true), new Promise(r=>setTimeout(r,700))]);   // long enough to see
      S.updChecking=false; S.qVersion=st.current;
      if(st.latest?.available){ S.updNote=`Quantum ${st.latest.version} is available`; await api().update_skip(""); renderUpdateBar(true); toast(S.updNote); }
      else { S.updNote=st.latest?.error?"Couldn't reach GitHub just now":`Up to date · checked ${new Date().toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}`;
        toast(st.latest?.error?"Couldn't reach GitHub just now":`You have the latest version (${st.current})`); }
      renderDetail(); return; }
    if(a==="drsecret"){ if(!S.live?.log?.uex_token){ toast("Enter your UEX Bearer Token first, then your Secret Key"); $("s-uex")?.focus(); return; }
      const v=$("s-drsecret").value.trim(); if(!v) return toast("Paste the secret key first");
      const r=await api().dr_set_secret(v); if(r.ok===false){ toast(r.error); if(r.need==="token") $("s-uex")?.focus(); return; } S.drHasSecret=r.has_secret; S.drSecretDraft=""; S.bk=undefined; S.keyStat=undefined; S.ownerAsked=false; setTimeout(()=>ownerCheck().catch(()=>{}),3000); toast("Datarunner secret key saved"); renderDetail(); drRefreshAfterKey(); return; }
    if(a==="bkdel"){ if(!S.bkDelAsk){ S.bkDelAsk=true; renderDetail(); setTimeout(()=>{ S.bkDelAsk=false; renderDetail(); },4000); return; }
      S.bkDelAsk=false; S.bkBusy="del"; renderDetail(); const r=await api().backup_delete(); S.bkBusy=null;
      toast(r.ok?"Backup deleted from the server. Backups are off for this PC":r.error); S.bk=await api().backup_status(); renderDetail(); return; }
    if(a==="bkon"){ S.bk=await api().backup_enable(); toast("Backups are on again"); renderDetail(); return; }
    if(a==="bknow"||a==="bkrestore"){ S.bkBusy=a==="bknow"?"save":"restore"; renderDetail();
      const r=a==="bknow"?await api().backup_now(true):await api().backup_restore(); S.bkBusy=null;
      if(a==="bknow") toast(r.ok?"Backed up":"Backup failed: "+(r.error||r.status));
      else { toast(r.ok?(r.added?`Restored ${r.summary}`:"Nothing was missing: you're up to date"):r.error); if(r.ok&&r.added) await afterRestore(); }
      S.bk=await api().backup_status(); renderDetail(); return; }
    if(a==="drsecretclear"){ const r=await api().dr_set_secret(""); S.drHasSecret=r.has_secret; S.drSecretDraft=""; toast("Datarunner secret key removed"); renderDetail(); drRefreshAfterKey(); return; }
    if(a==="uexclear"){ await api().set_uex_token(""); S.bk=undefined; S.uexDraft=""; S.uexStat=null; toast("UEX token removed"); await poll(); renderDetail(); return; }
    if(a==="ccpreview"){ const r=await api().preview_city_clock(S.live?.city_clock?.in_city||"New Babbage"); toast(r.ok?"Click into Star Citizen now: the clock shows for 15 seconds":r.error); return; }
    if(a==="testkey"){ await api().test_autoloc(5); toast("Click into Star Citizen now. Sending in 5 seconds"); setTimeout(()=>{ poll().then(renderDetail); },7000); }
}
// ---- A place's commodity stock: the Commodities button on the card of a place with a commodity terminal shows
// what each terminal there buys and sells, with stock and how long ago each price was reported (UEX, with newer
// Quantum datarunner reports laid over it)
async function loadTradePlaces(){ if(S.tradePlaces!==undefined||!S.live?.log?.uex_token||Date.now()-(S.tradePlacesTry||0)<60000) return;
  S.tradePlaces=null; S.tradePlacesTry=Date.now();
  let r; try{ r=await api().uex_trade_places(); }catch(e){ r=null; }
  if(!r?.ok){ S.tradePlaces=undefined; if(S.selected?.kind==="loc") renderDetail(); return; }   // tried again next time a card opens
  S.tradePlaces=new Set(r.places); if(rsMode()==="search") rsRender(); if(S.selected?.kind==="loc") renderDetail(); }   // (any card: it may be showing "Loading services")
async function toggleStock(place){ if(S.stock?.place===place&&S.stock.kind==="commodity"){ closeStock(); return renderDetail(); }
  S.stock={kind:"commodity",place,data:null,side:S.stockSide||"all",q:"",sort:S.stockSort||"name"}; renderDetail(); stockRender();
  const [r]=await Promise.all([api().uex_place_stock(place).catch(e=>({ok:false,error:String(e)})),stockCommodities()]);
  if(S.stock?.place!==place) return; S.stock.data=r; stockRender(); }
function closeStock(){ S.stock=null; const P=$("stk-panel"); if(P){ P.classList.remove("show"); P.innerHTML=""; } }
// UEX's commodity list (kind and picture name for each), as the Commodities tab has it
async function stockCommodities(){ if(S.mk) return; try{ const c=await api().uex_commodities(); if(c.ok&&!S.mk){ S.mk=c.items; S.mkByName=Object.fromEntries(c.items.map(x=>[x.name.toLowerCase(),x])); } }catch(e){} }
function stockPrice(x,side){ if(!x) return `<div><span class="lab">${side==="buy"?"You buy":"You sell"}</span><span class="none">—</span></div>`; const a=drAge(x.at);
  return `<div class="${side}" title="${esc([x.status_name&&`Stock: ${x.status_name}`,x.community?"Reported by a Quantum datarunner, newer than UEX's":"",x.at?`Reported ${agoTs(x.at)}`:"No report time"].filter(Boolean).join(" · "))}">
    <span class="lab">${side==="buy"?"You buy":"You sell"}</span><b>${Math.round(x.price).toLocaleString()}<small>aUEC</small></b>
    <i>${x.scu!=null?`${Number(x.scu).toLocaleString()} SCU`:esc(x.status_name||"")}</i><i class="${a.c}">${x.community?"⚡ ":""}${x.at?agoTs(x.at):"age unknown"}</i></div>`; }
function stockRender(){ const P=$("stk-panel"), st=S.stock; if(!P) return; if(!st){ return closeStock(); }
  if(st.kind==="shop") return shopRender();
  if(st.kind==="hospital") return hospitalRender();
  P.classList.add("show"); const L=S.locMap[st.place], r=st.data;
  const head=`<div class="stk-top"><div><h2>Commodities at ${esc(st.place)}</h2><div class="sub">${esc(L?`${TYPES[L.type]?.one||"Place"}${L.body?" on "+L.body:" in "+L.system}`:"")}${r?.ok&&r.terminals.length>1?` · ${r.terminals.length} terminals`:""}</div></div>
    <button class="btn small ghost close" data-stkclose="1" aria-label="Close">✕ Close</button></div>`;
  if(!r){ P.innerHTML=head+qLoader("Loading prices…"); return stockWire(P); }
  if(!r.ok){ P.innerHTML=head+`<div class="note">${esc(r.error||"Couldn't load the prices")}</div>`; return stockWire(P); }
  if(!r.terminals.length){ P.innerHTML=head+`<div class="empty">UEX has no commodity terminal here.</div>`; return stockWire(P); }
  const all=r.terminals.flatMap(t=>t.rows), nBuy=all.filter(i=>i.buy).length, nSell=all.filter(i=>i.sell).length;
  const newest=Math.max(0,...r.terminals.map(t=>t.updated||0))||null, oldest=Math.min(...r.terminals.map(t=>t.oldest||Infinity));
  const q=st.q.trim().toLowerCase(), info=i=>S.mk?.find(c=>c.id===i.id_commodity)||S.mkByName?.[i.name.toLowerCase()]||null;
  const keep=i=>(st.side==="all"||(st.side==="buy"?i.buy:i.sell))&&(!q||`${i.name} ${info(i)?.kind||""}`.toLowerCase().includes(q));
  const at=i=>Math.max(i.buy?.at||0,i.sell?.at||0);
  const by={name:(a,b)=>a.name.localeCompare(b.name),buy:(a,b)=>(a.buy?.price??9e12)-(b.buy?.price??9e12)||a.name.localeCompare(b.name),
    sell:(a,b)=>(b.sell?.price??-1)-(a.sell?.price??-1)||a.name.localeCompare(b.name),fresh:(a,b)=>at(b)-at(a)||a.name.localeCompare(b.name)}[st.sort]||((a,b)=>a.name.localeCompare(b.name));
  const card=i=>{ const c=info(i);
    return `<div class="stk-card" data-mkopen="${esc(i.name)}" title="Open ${esc(i.name)} in Commodities: every place that trades it"><div class="ph" data-pic="${esc(c?.wiki||i.name)}">${phCard("commodity")}</div>
      <div class="bd"><div class="nm"><b>${esc(i.name)}</b>${c?.kind?`<span>${esc(c.kind)}</span>`:""}${c?.illegal?`<span style="color:#ffb454">illegal</span>`:""}</div>
        <div class="stk-px">${stockPrice(i.buy,"buy")}${stockPrice(i.sell,"sell")}</div></div></div>`; };
  P.innerHTML=head+statBlock([{label:"For sale here",value:String(nBuy)},{label:"Bought here",value:String(nSell)},{label:"Newest report",value:newest?agoTs(newest):"None"}],
      oldest<Infinity&&newest&&newest-oldest>86400?[{label:"Oldest price here",value:agoTs(oldest)}]:[])
    +`<div class="stk-tools"><input class="search" data-stkq="1" placeholder="Search commodities here" value="${esc(st.q)}" autocomplete="off" spellcheck="false">
      <div class="stk-seg">${[["all","All"],["buy","You can buy"],["sell","You can sell"]].map(([k,t])=>`<button data-stkside="${k}" class="${st.side===k?"on":""}">${t}</button>`).join("")}</div>
      <select class="field" data-stksort="1">${[["name","A–Z"],["buy","Cheapest to buy"],["sell","Best to sell"],["fresh","Most recently reported"]].map(([v,t])=>`<option value="${v}" ${st.sort===v?"selected":""}>${t}</option>`).join("")}</select></div>`
    +r.terminals.map(t=>{ const rows=t.rows.filter(keep).sort(by), a=drAge(t.updated);
      return `<div class="stk-th"><b>${esc(t.name)}</b>${t.updated?`<span class="${a.c}" style="${a.c==="a0"?"color:#57e39b":a.c==="a2"?"color:#f2c14e":a.c==="a3"?"color:#ff8a5c":""}">updated ${esc(agoTs(t.updated))}</span>`:`<span>no reports yet</span>`}
          ${t.autoload?`<span>auto-load</span>`:""}${t.max_box?`<span>boxes up to ${t.max_box} SCU</span>`:""}<span>${rows.length} ${rows.length===1?"commodity":"commodities"}</span></div>
        ${rows.length?`<div class="stk-grid">${rows.map(card).join("")}</div>`:`<div class="muted" style="font-size:13px;padding:2px">${q?"Nothing here matches.":st.side==="buy"?"Nothing for sale at this terminal.":st.side==="sell"?"This terminal doesn't buy anything.":"No prices on UEX for this terminal yet."}</div>`}`; }).join("")
    +`<div class="uex-credit" style="margin-top:18px">Prices are reported by players at <a data-ext="https://uexcorp.space">UEX</a>${all.some(i=>i.buy?.community||i.sell?.community)?" (⚡ newer reports from Quantum datarunners)":""} and can be off; check the terminal before you buy. Age colours: green under a day, yellow up to 3 days, orange older. Click a commodity for every place that trades it.</div>`;
  stockWire(P); fillPictures(P); }
function stockWire(P){
  P.onclick=e=>{ const x=e.target.closest("[data-ext]"); if(x) api().open_url(x.dataset.ext); };
  P.querySelector("[data-stkclose]")?.addEventListener("click",()=>{ closeStock(); renderDetail(); });
  for(const b of P.querySelectorAll("[data-stkside]")) b.onclick=()=>{ S.stock.side=S.stockSide=b.dataset.stkside; stockRender(); };
  const so=P.querySelector("[data-stksort]"); if(so) so.onchange=()=>{ S.stock.sort=S.stockSort=so.value; stockRender(); };
  const q=P.querySelector("[data-stkq]"); if(q){ let t; q.oninput=()=>{ S.stock.q=q.value; clearTimeout(t); t=setTimeout(()=>{ const pos=q.selectionStart; stockRender(); const n=$("stk-panel").querySelector("[data-stkq]"); if(n){ n.focus(); n.setSelectionRange(pos,pos); } },220); }; } }
// ---- A place's shops: the service tiles (Buy Armor, Buy Clothing, Buy Weapons, ship weapons, Food Court,
// Clinic, Vehicle Services…) open the same kind of window as Commodities, with what the shops there sell
// (UEX's item prices: app.uex_place_shop), on the group that tile is about. The other groups are a click away.
// A service's tile -> the groups of things it's about (the first one the place has opens)
// Ship components and ship weapons come before the vehicle dealers: "Buy Ship Components" and "Buy Ship Weapons" start
// with "Buy Ship" too, and were taken for dealers (their tiles lit up with Buy Vehicles, and opened the vehicles)
const SVC_SHOP=[[/rent|rental/i,["rentals"]],[/ship component/i,["components"]],[/ship weapon|vehicle weapon/i,["shipweapons"]],[/(buy|purchase|sell)\w* (ships?|vehicles?)\b(?! *(components?|weapons?|items?|parts?))|vehicle (sales|dealer)|ship (sales|dealer|showroom)|showroom/i,["vehicles"]],[/armou?r/i,["armor"]],[/cloth|apparel|fashion/i,["clothing"]],
  [/weapon|gun ?shop|armory/i,["weapons"]],[/food|restaurant|bar\b|drink|cafe|diner/i,["food"]],[/clinic|hospital|medical|pharmacy/i,["medical"]],
  [/gadget|tool|mining equipment/i,["gadgets"]]];
// The wiki's one "Buy Ship Items and Weapons" is shown as two tiles, ship weapons and ship components (only the
// ones UEX lists there, once that's known). A shop UEX lists that no amenity covers gets its tile too.
const SHOP_TILE={armor:"Buy Armor",clothing:"Buy Clothing",weapons:"Buy Weapons",shipweapons:"Buy Ship Weapons",components:"Buy Ship Components",vehicles:"Buy Vehicles",rentals:"Rent Vehicles"};
function placeAmenities(list,place){ const have=place&&S.shopPlaces?.[place], out=[];
  for(const a of list){
    if(/ship items and weapons/i.test(a)){ const both=["shipweapons","components"], keep=have&&both.some(g=>have.includes(g))?both.filter(g=>have.includes(g)):both;
      for(const g of keep) out.push(SHOP_TILE[g]); }
    // "Buy and Rent Vehicles" (Area18, Lorville, Orison, Levski…) is two counters: a Rent Vehicles tile and a
    // Buy Vehicles tile, each with its own icon and window (before, it showed as one tile next to a Buy Vehicles)
    else if(/\b(buy|purchase)\b.*\brent|\brent\b.*\b(buy|purchase)\b/i.test(a)&&/vehicle|ship/i.test(a)) out.push(SHOP_TILE.rentals,SHOP_TILE.vehicles);
    else out.push(a); }
  if(have){ const covered=new Set(out.flatMap(a=>{ const h=SVC_SHOP.find(([rx])=>rx.test(a)); return h?h[1]:[]; }));
    for(const g of Object.keys(SHOP_TILE)) if(have.includes(g)&&!covered.has(g)) out.push(SHOP_TILE[g]); }
  return [...new Set(out)]; }
function shopGroupFor(service,place){ const have=S.shopPlaces?.[place];
  const hit=SVC_SHOP.find(([rx])=>rx.test(service));
  // Buy Vehicles opens its window even when UEX hasn't matched a dealer to this place yet (Ashland): it then says
  // what UEX does or doesn't list, rather than the tile doing nothing
  if(hit?.[1][0]==="vehicles"&&S.shopPlaces) return "vehicles";
  if(!have) return null; return hit?hit[1].find(g=>have.includes(g))||null:null; }
async function loadShopPlaces(){ if(S.shopPlaces!==undefined||!S.live?.log?.uex_token||Date.now()-(S.shopPlacesTry||0)<60000) return;
  S.shopPlaces=null; S.shopPlacesTry=Date.now();
  let r; try{ r=await api().uex_shop_places(); }catch(e){ r=null; }
  if(!r?.ok){ S.shopPlaces=undefined; if(S.selected?.kind==="loc") renderDetail(); return; }
  S.shopPlaces=r.places; S.shopGroups=r.groups; S.fuelPlaces=r.fuel||{}; if(rsMode()==="search") rsRender(); if(S.selected?.kind==="loc") renderDetail(); }
async function toggleShop(place,group){ const st=S.stock;
  if(st?.kind==="shop"&&st.place===place){ if(st.group===group){ closeStock(); return renderDetail(); } st.group=group; st.q=""; renderDetail(); return shopRender(); }
  S.stock={kind:"shop",place,group,data:null,q:"",sort:S.shopSort||"name"}; renderDetail(); shopRender();
  let r; try{ r=await api().uex_place_shop(place); }catch(e){ r={ok:false,error:String(e)}; }
  if(S.stock?.place!==place||S.stock.kind!=="shop") return; S.stock.data=r; shopRender();
  // The Gear tabs these shops' things are in, for their stats and a link to their page (loaded quietly)
  const tabs=[...new Set((r.shops||[]).flatMap(s=>s.items.map(i=>SHOP_GEAR_TAB[i.group])).filter(Boolean))];
  await Promise.all(tabs.map(t=>glData(t).catch(()=>[]))); if(S.stock?.data===r) shopRender(); }
// A group's Gear tab (stats and the item's page), when it has one
const SHOP_GEAR_TAB={armor:"armor",clothing:"clothing",weapons:"weapons",gadgets:"gadgets",food:"consumables",medical:"consumables"};
const SHOP_GEAR_KIND=new Set(["armor","clothing","weapons","gadgets","food","medical"]);
function shopGear(i){ const tab=SHOP_GEAR_TAB[i.group]; if(!tab) return null; const L=grState(tab).data?.items; if(!L) return null;
  const n=i.name.toLowerCase(); const g=L.find(x=>(i.uuid&&x.uuid===i.uuid))||L.find(x=>x.name.toLowerCase()===n); return g?{tab,g}:null; }
function shopRender(){ const P=$("stk-panel"), st=S.stock; if(!P||st?.kind!=="shop") return;
  P.classList.add("show"); const L=S.locMap[st.place], r=st.data, gname=Object.fromEntries(S.shopGroups||r?.groups||[]);
  const head=`<div class="stk-top"><div><h2>${esc(gname[st.group]||"Shops")} at ${esc(st.place)}</h2><div class="sub">${esc(L?`${TYPES[L.type]?.one||"Place"}${L.body?" on "+L.body:" in "+L.system}`:"")}${r?.ok&&r.shops.length?` · ${r.shops.length} shop${r.shops.length===1?"":"s"}`:""}</div></div>
    <button class="btn small ghost close" data-stkclose="1" aria-label="Close">✕ Close</button></div>`;
  if(!r){ P.innerHTML=head+qLoader("Loading what's sold here…"); return shopWire(P); }
  if(!r.ok){ P.innerHTML=head+`<div class="note">${esc(r.error||"Couldn't load the shops")}</div>`; return shopWire(P); }
  const all=r.shops.flatMap(s=>s.items), count={}; for(const i of all) count[i.group]=(count[i.group]||0)+1;
  const groups=(r.groups||[]).filter(([k])=>count[k]);
  const q=st.q.trim().toLowerCase(), keep=i=>(st.group==="all"||i.group===st.group)&&(!q||`${i.name} ${i.category} ${i.section}`.toLowerCase().includes(q));
  const shown=all.filter(keep), dates=shown.map(i=>i.at).filter(Boolean), newest=dates.length?Math.max(...dates):null, oldest=dates.length?Math.min(...dates):null;
  const prices=shown.map(i=>i.price);
  const by={name:(a,b)=>a.name.localeCompare(b.name),cheap:(a,b)=>a.price-b.price||a.name.localeCompare(b.name),dear:(a,b)=>b.price-a.price||a.name.localeCompare(b.name),
    fresh:(a,b)=>(b.at||0)-(a.at||0)||a.name.localeCompare(b.name)}[st.sort]||((a,b)=>a.name.localeCompare(b.name));
  // A vehicle for rent: its picture, maker, cargo and crew, the price per day, and its page in Vehicles
  const rentCard=i=>{ const a=drAge(i.at), facts=[i.scu?`${Number(i.scu).toLocaleString()} SCU`:"",i.crew?`crew ${i.crew}`:"",i.pad?`${padLabel(i.pad)} pad`:""].filter(Boolean).join(" · ");
    return `<div class="stk-card shop rent" data-vhopen="${esc(i.vid)}" title="Open the ${esc(i.name)} in Vehicles"><div class="ph">${i.photo?`<img src="${esc(i.photo)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">`:phCard("vehicle")}</div>
      <div class="bd"><div class="nm"><b>${esc(i.name)}</b></div><div class="cat">${esc([i.maker,i.category].filter(Boolean).join(" · "))}</div>${facts?`<div class="key">${esc(facts)}</div>`:""}
        <div class="pr"><b>${Math.round(i.price).toLocaleString()}<small>${i.per==="day"?"aUEC / day":"aUEC"}</small></b><i class="${a.c}" title="${i.at?`Price reported ${agoTs(i.at)}`:"No report time"}">${i.at?agoTs(i.at):"age unknown"}</i></div></div></div>`; };
  const card=i=>{ if(i.group==="rentals"||i.group==="vehicles") return rentCard(i); const m=shopGear(i), G=m&&GEAR[m.tab], a=drAge(i.at), ship=i.group==="components"||i.group==="shipweapons";
    const link=m?`data-shopgear="${esc(m.tab)}|${esc(m.g.uuid||m.g.name)}" title="Open ${esc(i.name)} in Gear"`:ship&&i.cat?`data-shopcp="${esc(i.cat)}|${esc(i.id)}" title="Open ${esc(i.name)} in Components"`:"";
    const img=m?.g?.image;
    return `<div class="stk-card shop${link?"":" nolink"}" ${link}><div class="ph" ${img?"":SHOP_GEAR_KIND.has(i.group)?`data-gpic="${esc(i.name)}"`:`data-pic="${esc(i.name)}"`}>${img?`<img src="${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer">`:phCard(ship?"component":"commodity")}</div>
      <div class="bd"><div class="nm"><b>${esc(i.name)}</b></div><div class="cat">${esc([m?.g?.maker,i.category||gname[i.group]].filter(Boolean).join(" · "))}</div>
        ${G&&G.key(m.g)?`<div class="key">${esc(G.key(m.g))}</div>`:""}
        <div class="pr"><b>${Math.round(i.price).toLocaleString()}<small>aUEC</small></b><i class="${a.c}" title="${i.at?`Price reported ${agoTs(i.at)}`:"No report time"}">${i.at?agoTs(i.at):"age unknown"}</i></div></div></div>`; };
  P.innerHTML=head+statBlock([{label:st.group==="rentals"?"For rent":"For sale",value:String(shown.length)},{label:"Prices",value:prices.length?(Math.min(...prices)===Math.max(...prices)?`${Math.round(prices[0]).toLocaleString()} aUEC`:`${shortMoney(Math.min(...prices))} to ${shortMoney(Math.max(...prices))}`):"—"},{label:"Newest report",value:newest?agoTs(newest):"None"}],
      oldest&&newest&&newest-oldest>86400?[{label:"Oldest price here",value:agoTs(oldest)}]:[])
    +(groups.length>1||st.group==="all"?`<div class="stk-chips">${[["all","Everything"],...groups].map(([k,t])=>`<button data-shopg="${k}" class="${st.group===k?"on":""}">${esc(t)}<b>${k==="all"?all.length:count[k]}</b></button>`).join("")}</div>`:"")
    +`<div class="stk-tools"><input class="search" data-stkq="1" placeholder="${st.group==="rentals"?"Search vehicles for rent here":st.group==="vehicles"?"Search vehicles for sale here":"Search what's sold here"}" value="${esc(st.q)}" autocomplete="off" spellcheck="false">
      <select class="field" data-stksort="1">${[["name","A–Z"],["cheap","Price: low to high"],["dear","Price: high to low"],["fresh","Most recently reported"]].map(([v,t])=>`<option value="${v}" ${st.sort===v?"selected":""}>${t}</option>`).join("")}</select></div>`
    +(!all.length?`<div class="empty">${st.group==="vehicles"?`UEX has no vehicle sales listed at ${esc(st.place)} yet. The Vehicles tab shows where each ship is sold.`:"UEX has nothing listed for sale here yet."}</div>`
      :r.shops.map(s=>{ const rows=s.items.filter(keep).sort(by); if(!rows.length) return ""; const a=drAge(s.updated);
        return `<div class="stk-th"><b>${esc(s.name)}</b>${s.updated?`<span style="${a.c==="a0"?"color:#57e39b":a.c==="a2"?"color:#f2c14e":a.c==="a3"?"color:#ff8a5c":""}">updated ${esc(agoTs(s.updated))}</span>`:""}<span>${rows.length} ${st.group==="rentals"||st.group==="vehicles"?"vehicle":"item"}${rows.length===1?"":"s"}</span></div>
          <div class="stk-grid">${rows.map(card).join("")}</div>`; }).join("")||`<div class="muted" style="font-size:13px;padding:6px 2px">${q?"Nothing here matches.":`No ${esc((gname[st.group]||"items").toLowerCase())} for sale here on UEX.`}</div>`)
    +`<div class="uex-credit" style="margin-top:18px">Prices are reported by players at <a data-ext="https://uexcorp.space">UEX</a> and can be off; check the shop before you buy. Age colours: green under a day, yellow up to 3 days, orange older. ${st.group==="rentals"?" Rental prices are for one day.":""} Click an item for its full page.</div>`;
  shopWire(P); fillGearPictures(P); fillPictures(P); }
function shopWire(P){
  P.onclick=e=>{ const x=e.target.closest("[data-ext]"); if(x) return api().open_url(x.dataset.ext);
    const gg=e.target.closest("[data-shopgear]"); if(gg){ const [tab,id]=gg.dataset.shopgear.split("|"); const t=document.querySelector(`.tab[data-tab="${tab}"]`); if(!t) return; t.click();
      setTimeout(()=>{ const st=grState(tab); if(tab==="armor") st.view="items"; if(st.data) grOpenItem(tab,id,null); },250); return; }
    const cp=e.target.closest("[data-shopcp]"); if(cp){ const ref=cp.dataset.shopcp; document.querySelector('.tab[data-tab="components"]')?.click();
      (async()=>{ for(let k=0;k<40&&!S.cpCats;k++) await new Promise(r=>setTimeout(r,250)); if(S.cpCats) openCpPart(ref); })(); return; } };
  P.querySelector("[data-stkclose]")?.addEventListener("click",()=>{ closeStock(); renderDetail(); });
  for(const b of P.querySelectorAll("[data-shopg]")) b.onclick=()=>{ S.stock.group=b.dataset.shopg; shopRender(); renderDetail(); };
  const so=P.querySelector("[data-stksort]"); if(so) so.onchange=()=>{ S.stock.sort=S.shopSort=so.value; shopRender(); };
  const q=P.querySelector("[data-stkq]"); if(q){ let t; q.oninput=()=>{ S.stock.q=q.value; clearTimeout(t); t=setTimeout(()=>{ const pos=q.selectionStart; shopRender(); const n=$("stk-panel").querySelector("[data-stkq]"); if(n){ n.focus(); n.setSelectionRange(pos,pos); } },220); }; } }
// ---- A place's Hospital / Clinic tile: the hospital itself (its name, picture and description from the Star Citizen
// Wiki data: Empire Health Services at Area18, Orison General, Maria Pure of Heart…), what your Game.log said while
// you were there (checking in at the Patient Check-In console, the room or bed you were given, an imprint set) and
// what its pharmacy sells (UEX's Medical items at the place). Same window as Commodities and the shops.
const HOSP_RX=/hospital|clinic|medical cent|medbay/i;
async function toggleHospital(place){ if(S.stock?.kind==="hospital"&&S.stock.place===place){ closeStock(); return renderDetail(); }
  S.stock={kind:"hospital",place,info:null,shop:null}; renderDetail(); hospitalRender();
  const st=S.stock, hasUex=!!S.live?.log?.uex_token;
  const [info,shop]=await Promise.all([api().hospital_info(place).catch(e=>({ok:false,error:String(e)})),
    hasUex?api().uex_place_shop(place).catch(e=>({ok:false,error:String(e)})):Promise.resolve({ok:false,nouex:true})]);
  if(S.stock!==st) return; st.info=info; st.shop=shop; hospitalRender();
  if(shop?.ok&&(shop.shops||[]).some(s=>s.items.some(i=>i.group==="medical"))){ await glData("consumables").catch(()=>[]); if(S.stock===st) hospitalRender(); } }
function hospitalRender(){ const P=$("stk-panel"), st=S.stock; if(!P||st?.kind!=="hospital") return;
  P.classList.add("show"); const L=S.locMap[st.place], info=st.info, f=info?.facilities?.[0];
  const amen=(S.svcCache[st.place]?.amenities||[]).find(a=>HOSP_RX.test(a))||"Hospital", what=/clinic/i.test(amen)?"Clinic":"Hospital";
  const head=`<div class="stk-top"><div><h2>${esc(f?.name||`${what} at ${st.place}`)}</h2><div class="sub">${esc(what)} · ${esc(st.place)}${L?esc(L.body?" on "+L.body:" in "+L.system):""}</div></div>
    <button class="btn small ghost close" data-stkclose="1" aria-label="Close">✕ Close</button></div>`;
  if(!info){ P.innerHTML=head+qLoader(`Loading the ${what.toLowerCase()}…`); return shopWire(P); }
  // the hospital: picture, description, its page on the wiki (a second one at the place, if there is, below it)
  const fac=(info.facilities||[]).map((x,k)=>`<div class="hosp-hero${x.image?"":" noimg"}">${x.image?`<div class="hosp-ph"><img src="${esc(x.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode.remove()"></div>`:""}
      <div class="hosp-bd">${k?`<b class="hosp-nm">${esc(x.name)}</b>`:""}${x.description?`<p>${esc(x.description.replace(/^(?:LOCATION:)?[^\n]*(?:Stanton|Pyro|Nyx) System\s*\n+/,"")).replace(/\n+/g,"<br>")}</p>`:""}
        <div class="hosp-svc">${["Patient check-in","Medical beds and treatment","Regeneration (set your imprint here)","Pharmacy"].map(t=>`<span>${t}</span>`).join("")}</div>
        ${x.url?`<div class="credit">Info: <a data-ext="${esc(x.url)}">Star Citizen Wiki API</a> (CC BY-SA 4.0)</div>`:""}</div></div>`).join("")
    ||`<div class="muted" style="font-size:13px;padding:2px">The game data doesn't name the ${what.toLowerCase()} here.</div>`;
  // your check-ins here, from Game.log
  const V=info.visits||[];
  const visits=`<div class="stk-th"><b>Your visits here</b><span>from your Game.log</span></div>`+(V.length?`<div class="hosp-log">${V.map(v=>`<div class="hosp-v">${v.room?`<span class="hosp-room">${esc(v.room)}</span>`:""}<span class="hosp-t">${esc(v.text)}</span><i>${esc(agoTs(v.at))}</i></div>`).join("")}</div>`
    :`<div class="muted" style="font-size:13px;padding:2px 2px 4px">Nothing logged here yet. Check in at the Patient Check-In console and what the game writes to Game.log about it (your room or bed, an imprint set) shows up here.</div>`);
  // the pharmacy
  const sh=st.shop, meds=sh?.ok?(sh.shops||[]).map(s=>({...s,items:s.items.filter(i=>i.group==="medical")})).filter(s=>s.items.length):[];
  const medCard=i=>{ const m=shopGear(i), a=drAge(i.at), img=m?.g?.image, link=m?`data-shopgear="${esc(m.tab)}|${esc(m.g.uuid||m.g.name)}" title="Open ${esc(i.name)} in Consumables"`:"";
    return `<div class="stk-card shop${link?"":" nolink"}" ${link}><div class="ph" ${img?"":`data-gpic="${esc(i.name)}"`}>${img?`<img src="${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer">`:phCard("commodity")}</div>
      <div class="bd"><div class="nm"><b>${esc(i.name)}</b></div><div class="cat">${esc([m?.g?.maker,i.category||"Medical"].filter(Boolean).join(" · "))}</div>
        <div class="pr"><b>${Math.round(i.price).toLocaleString()}<small>aUEC</small></b><i class="${a.c}" title="${i.at?`Price reported ${agoTs(i.at)}`:"No report time"}">${i.at?agoTs(i.at):"age unknown"}</i></div></div></div>`; };
  const n=meds.reduce((k,s)=>k+s.items.length,0);
  const pharm=`<div class="stk-th"><b>Pharmacy</b><span>${sh?.ok?`${n} item${n===1?"":"s"} · prices from UEX`:"prices from UEX"}</span></div>`
    +(!sh?qLoader("Loading the pharmacy…"):sh.nouex?`<div class="note">Connect UEX in Settings to see what the pharmacy here sells and for how much.</div>`
      :!sh.ok?`<div class="note">${esc(sh.error||"Couldn't load the pharmacy")}</div>`
      :!meds.length?`<div class="muted" style="font-size:13px;padding:2px">UEX has no medical items listed for sale at ${esc(st.place)} yet.</div>`
      :meds.map(s=>`<div class="hosp-shop"><span>${esc(s.name)}</span></div><div class="stk-grid">${[...s.items].sort((a,b)=>a.name.localeCompare(b.name)).map(medCard).join("")}</div>`).join(""));
  P.innerHTML=head+fac+visits+pharm+(meds.length?`<div class="uex-credit" style="margin-top:18px">Prices are reported by players at <a data-ext="https://uexcorp.space">UEX</a> and can be off; check the shop before you buy. Click an item for its page in Consumables.</div>`:"");
  shopWire(P); fillGearPictures(P); }
// "Is something inaccurate?" at the foot of a place's card: the position (sent with a /showlocation), its
// services (which listed ones aren't there, what's missing) or anything else. Services and the rest go to the
// team as a report (the same inbox as Report a bug), tagged with the place. Kept in S.fix so the card can redraw.
function fixHtml(L,readingHere){
  const F=S.fix?.name===L.name?S.fix:(S.fix={name:L.name,open:false,tab:L.fixable?"pos":"svc",not:new Set(),text:"",sent:null});
  const tabs=[L.fixable?["pos","Position"]:null,["svc","Services"],["else","Something else"]].filter(Boolean);
  const svc=placeAmenities(S.svcCache[L.name]?.amenities||[],L.name).map(a=>a.replace(/ *[(]?(XL|S|M|L)[)]?$/i,""));
  if(S.tradePlaces?.has(L.name)) svc.push("Commodities");
  const body=F.sent===F.tab?`<div class="fix-ok">Thanks, it's with the team. They check reports and fix the data for everyone.</div>`
    :F.tab==="pos"?`<div class="muted fix-p">Go to ${esc(L.name)} (${L.kind==="surface"?"land or stand right at it":"dock there"}), type <b>/showlocation</b> in game chat and press <b>Send the right position</b>.
        It moves on your map straight away, and for every Quantum user once another datarunner's reading agrees. Trusted datarunners' corrections count at once.</div>
      <button class="btn small primary" data-a="fixpos" ${readingHere?"":`disabled title="Needs a /showlocation taken here in the last 15 minutes"`}>Send the right position</button>`
    :F.tab==="svc"?`${svc.length?`<div class="muted fix-p">Tap any listed here that this place doesn't have:</div>
        <div class="fix-chips">${[...new Set(svc)].map(a=>`<button type="button" class="fix-chip${F.not.has(a)?" on":""}" data-fixnot="${esc(a)}" aria-pressed="${F.not.has(a)}">${esc(a)}</button>`).join("")}</div>`:""}
      <textarea class="field" id="fix-text" rows="2" maxlength="1000" placeholder="${svc.length?"Anything missing or wrong? (optional)":"What services does it have, or what's wrong?"}">${esc(F.text)}</textarea>
      <button class="btn small primary" data-a="fixsend" ${F.not.size||F.text.trim().length>=5?"":"disabled"}>Send report</button>`
    :`<textarea class="field" id="fix-text" rows="3" maxlength="1000" placeholder="What's wrong? The name, the description, the picture, prices…">${esc(F.text)}</textarea>
      <button class="btn small primary" data-a="fixsend" ${F.text.trim().length>=5?"":"disabled"}>Send report</button>`;
  return `<details class="fixpos" ${F.open?"open":""}><summary>${L.fixed?`<span style="color:#9fe0b4">Position corrected by ${L.fixed==="mine"?"you":"Quantum datarunners"}</span> · `:""}Is something inaccurate?</summary>
    <div class="seg-mini fix-tabs" role="tablist">${tabs.map(([k,t])=>`<button type="button" role="tab" class="${F.tab===k?"on":""}" aria-selected="${F.tab===k}" data-fixtab="${k}">${t}</button>`).join("")}</div>
    <div class="fix-body">${body}</div></details>`; }
async function fixSend(){ const F=S.fix, L=S.locMap[F.name]; if(!F||!L) return;
  const where=`${L.name} (${L.type||L.kind}${L.body?", "+L.body:""}, ${L.system||S.system})`;
  const msg=F.tab==="svc"?`[Place report: services] ${where}\n${F.not.size?`Not there: ${[...F.not].join(", ")}\n`:""}${F.text.trim()?`Note: ${F.text.trim()}`:""}`
    :`[Place report] ${where}\n${F.text.trim()}`;
  const r=await api().send_bug_report(msg.trim()); if(!r.ok) return toast(r.error);
  F.sent=F.tab; F.not=new Set(); F.text=""; renderDetail(); }
function renderDetail(){
  const d=$("detail"), sel=S.selected;
  if(S.stock&&(sel?.kind!=="loc"||sel.name!==S.stock.place)) closeStock();
  if(sel?.kind!=="settings"){ S.bugSent=false; S.bugOpen=false; }      // Settings closed: back to "Report a bug" next time
  if(!sel){ d.classList.remove("show"); return; }
  const live=S.live, t=now();
  d.classList.toggle("set-view",sel.kind==="settings");
  if(sel.kind==="settings"){ const a=S.live?.autoloc||{};
    const keys=["","F5","F6","F7","F8","F9","F10","F11","F12"];
    const when=a.last_sent?new Date(a.last_sent*1000).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit",second:"2-digit"}):"never";
    const lg=S.live?.log||{}, cl=lg.cleared;
    const inSys=S.bodies.filter(b=>b.system===S.system&&b.alignable), done=inSys.filter(b=>b.aligned_now??b.calibrated).length;
    const keyOpts=(cur,other)=>keys.map(k=>`<option value="${k}" ${k===cur?"selected":""} ${k&&k===other?"disabled":""}>${k||"Off"}${k&&k===other?" (used)":""}</option>`).join("");
    d.innerHTML=`<button class="close" aria-label="Close">×</button><h2>Settings</h2>
      <div class="set-ver"><div class="v"><b title="${S.qBuild?`Build ${esc(S.qBuild)}`:""}">Quantum ${esc(S.qVersion||"")}</b><span class="muted">${esc(S.updNote||"")}</span></div>
        <button class="btn small ghost upd-btn" data-a="updcheck" ${S.updChecking?"disabled":""}>${S.updChecking?`<span class="spin-sm"></span>Checking…`:"Check for updates"}</button></div>
      <div class="sub" style="margin-top:6px">Help</div>
      <div class="note" style="margin:4px 0 12px">${S.bugSent?`<span style="color:#9fe0b4">Thanks! Your bug report was sent.</span> <a data-a="bugopen" style="cursor:pointer;text-decoration:underline">Send another</a>`
        :!S.bugOpen?`<div class="row"><span>Something to report?</span><span class="spacer"></span><button class="btn small" data-a="bugopen">Send a report</button></div>`
        :`<label class="k" for="s-bugmsg" style="display:block;font-weight:600;font-size:12.5px;margin:0 2px 5px">What happened?</label>
          <textarea class="field" id="s-bugmsg" rows="5" maxlength="5000" style="width:100%;resize:vertical" placeholder="What you did, what you expected, and what happened instead" oninput="S.bugMsg=this.value">${esc(S.bugMsg||"")}</textarea>
          <label class="k" for="s-bugcontact" style="display:block;font-weight:600;font-size:12.5px;margin:10px 2px 5px">How can we reach you? <span class="muted" style="font-weight:400">(optional: Discord, email…)</span></label>
          <input class="field" id="s-bugcontact" maxlength="200" style="width:100%" value="${esc(S.bugContact||"")}" oninput="S.bugContact=this.value" autocomplete="off">
          <div class="row" style="gap:6px;margin-top:8px"><button class="btn small primary" data-a="bugsend" ${S.bugBusy?"disabled":""}>${S.bugBusy?"Sending…":"Send"}</button><button class="btn small ghost" data-a="bugcancel">Cancel</button></div>`}</div>
      <div class="sub">Game.log</div>
      <div class="note" style="margin:4px 0 12px"><div class="row"><span class="dot ${lg.status==="watching"?"on":"warn"}"></span><b>${lg.status==="watching"?"Reading Game.log":"Looking for Game.log (found automatically when the game starts)"}</b><span class="spacer"></span><button class="btn small ghost" data-a="logchange">Change</button></div>
        <div class="path" style="word-break:break-all;color:var(--dim);font-size:12px;margin-top:4px">${esc(lg.path||"Browse to …\\StarCitizen\\LIVE\\Game.log")}</div>
        <label class="row" style="gap:8px;margin-top:8px;cursor:pointer"><input type="checkbox" id="s-clearlog" ${lg.clear_on_start?"checked":""}> Clear Game.log when Quantum starts</label>
        ${cl?`<div class="muted" style="font-size:12px;margin-top:4px">${cl.ok?`Cleared at startup (${(cl.bytes/1048576).toFixed(1)} MB).`:`Not cleared at startup: ${esc(cl.reason)}.`}</div>`:""}</div>
      ${typeof tlSettingsHtml==="function"?tlSettingsHtml():""}
      ${inSys.length?`<div class="sub">Alignment</div>
      <div class="note row" style="margin:4px 0 12px"><span class="dot ${done?"on":""}"></span><span><b>${done}</b> of ${inSys.length} aligned in ${esc(S.system)}${done<inSys.length&&inSys.some(b=>b.calibrated&&b.aligned_now===false)?` <span class="muted">· the rest are from before the last game update</span>`:""}</span><span class="spacer"></span><button class="btn small ghost" data-a="openalign">Open</button></div>`:""}
      <div class="sub">Quantum API</div>
      <div class="note" style="margin:4px 0 12px">
        ${(()=>{ if(S.communityStatus&&S.live?.server&&S.live.server.ok!==S.communityStatus.ok) S.communityStatus={...S.communityStatus,ok:!!S.live.server.ok,error:S.live.server.error};
          const c=S.communityStatus; if(c===undefined){ S.communityStatus=null; api().community_status().then(x=>{ S.communityStatus=x; renderDetail(); }); }
          const on=c?c.enabled!==false&&!!c.url:true, st=!c?"checking":!on?"off":c.ok?"ok":"offline";
          return `<div class="st-label"><b>Quantum server</b>${connPill(st,st==="offline"?"Offline":null,c?.error)}</div>
          <div class="muted" style="font-size:12px;margin-top:6px;line-height:1.5">Community prices, photos, backups, planet alignment, station location alignment.
            ${on?`Community pricing updates will reflect within seconds when submitted from verified users, marked with ${IC_BOLT}.${st==="offline"?" The server can't be reached right now, so UEX's data is used alone until it's back.":""}`
              :"Community features are off: Quantum uses UEX's data alone."}</div>
          ${S.commAsk?`<div class="comm-warn"><b>Turn off community features?</b>
              <div>Quantum will use UEX's data alone. Without them you won't have:</div>
              <ul><li><b>Backups</b> of your fleet, loadouts, waypoints, planned routes and mapped stations</li>
                <li>The <b>most up-to-date prices</b>: reports from verified Quantum datarunners show within seconds, long before UEX's review</li>
                <li><b>Community pictures</b> of ships, components and commodities, and sending your own</li>
                <li><b>Datarunning through Quantum</b>: your reports still go to UEX, but they won't reach other Quantum users, count toward your profile, rank or leaderboard spot, or unlock Quantum's datarunner jobs</li>
                <li><b>Shared planet alignments</b> and <b>station positions</b> other datarunners found</li></ul>
              <div class="row" style="gap:6px;justify-content:flex-end;flex-wrap:wrap"><button class="btn small" data-a="commcancel">Keep them on</button><button class="btn small danger" data-a="commoff">Turn off community features</button></div></div>`
            :`<div class="row" style="gap:6px;margin-top:8px">${on?`<button class="btn small ghost" data-a="commask">Disable community features</button>`
              :`<button class="btn small primary" data-a="common">Enable community features</button>`}</div>`}`; })()}</div>
      <div class="sub">Map look</div>
      <div class="note" style="margin:4px 0 12px"><div class="row" style="gap:8px;flex-wrap:wrap"><span>Orbit line colour</span><span class="spacer"></span>
        <span class="orbit-sw">${ORBIT_PRESETS.map(([c,n])=>`<button type="button" data-orbitc="${c}" class="${c===S.orbitColor?"on":""}" title="${n}" style="background:${c}" onclick="setOrbitColor('${c}')"></button>`).join("")}</span>
        <input type="color" id="s-orbitc" value="${S.orbitColor}" title="Any colour" oninput="setOrbitColor(this.value,false)" onchange="setOrbitColor(this.value)">
        ${S.orbitColor!==ORBIT_DEFAULT?`<button class="btn small ghost" type="button" onclick="setOrbitColor(ORBIT_DEFAULT);renderDetail()">Reset</button>`:""}</div>
        ${WX_KEYS.map(([k,l])=>`<label class="row" style="gap:8px;margin-top:8px;cursor:pointer"><input type="checkbox" ${wxDefault(k)?"checked":""} onchange="setWxDefault('${k}',this.checked)"> ${l} in 3D cities</label>`).join("")}
        <div class="muted" style="font-size:12px;margin-top:4px">Off by default. Turn one on to have it showing every time you fly down to a city; the 3D city panel can still switch it for that visit.</div></div>
      <div class="sub">Placards</div>
      <div class="note" style="margin:4px 0 12px"><div style="margin-bottom:8px">Fuel prices look</div>
        <div class="fu-pick">${FUEL_STYLES.map(([k,n])=>`<button type="button" data-fuelstyle="${k}" class="${k===S.fuelStyle?"on":""}" aria-pressed="${k===S.fuelStyle}" onclick="setFuelStyle('${k}')">
          <div class="fu-prev">${fuelHtml([{what:"Quantum Fuel",price:1800},{what:"Hydrogen Fuel",price:800}],k)}</div><span>${n}${k===FUEL_DEFAULT?` <span class="muted">(default)</span>`:""}</span></button>`).join("")}</div></div>
      <div class="sub">Map performance</div>
      <div class="note" style="margin:4px 0 12px"><div class="row" style="gap:8px"><span>Map frame rate</span><span class="spacer"></span>
        <select class="field" id="s-fps" onchange="setMapFps(this.value)" style="width:auto">${[[30,"30 fps"],[60,"60 fps"],[0,"Monitor refresh rate"]].map(([v,l])=>`<option value="${v}" ${S.fpsMax===v?"selected":""}>${l}</option>`).join("")}</select></div>
        <div class="muted" style="font-size:12px;margin-top:6px">When there is no movement on the map frames are 30 fps, 10 fps when Quantum isn't in focus, and 0 fps when hidden under the game or under a full-page tab. This is to reduce load on your system.</div></div>
      ${(()=>{ const cc=S.live?.city_clock; if(!cc) return "";
        return `<div class="sub">Location Clock Overlay</div>
      <div class="note" style="margin:4px 0 12px">
        <div class="setgrid">
          <span class="k">Show local time</span><select class="field" id="s-ccmode">${[["off","Off"],["5","On arrival, 5 seconds"],["10","On arrival, 10 seconds"],["15","On arrival, 15 seconds"],["city","On, while at location"]].map(([v,l])=>`<option value="${v}" ${cc.mode===v?"selected":""}>${l}</option>`).join("")}</select>
          <span class="k">Position</span><select class="field" id="s-ccpos">${[["top","Top"],["upper","Upper third"],["center","Center"],["bottom","Lower third"],["top-right","Upper right"],["bottom-right","Lower right"],["custom","Custom (drag to place)"]].map(([v,l])=>`<option value="${v}" ${cc.position===v?"selected":""}>${l}</option>`).join("")}</select>
          <span class="k">Size</span><select class="field" id="s-ccsize">${[["large","Large"],["medium","Medium (3/4)"],["small","Small (1/2)"]].map(([v,l])=>`<option value="${v}" ${(cc.size||"large")===v?"selected":""}>${l}</option>`).join("")}</select>
          <span class="k">Show again</span><select class="field" id="s-ccagain" title="The city is known as you fly in. Show the clock again when you get there">${[["seat","When I leave the pilot seat"],["hangar","When my hangar is assigned"],["both","Both"],["none","Never"]].map(([v,l])=>`<option value="${v}" ${(cc.again||"seat")===v?"selected":""}>${l}</option>`).join("")}</select>
          <span class="k">Clock</span><select class="field" id="s-cch24"><option value="1" ${cc.h24?"selected":""}>24-hour</option><option value="0" ${cc.h24?"":"selected"}>12-hour</option></select>
          <span class="k">Show at</span><select class="field" id="s-ccwhere" data-cclook="where">${[["cities","Lorville, Area 18, New Babbage, Orison"],["all","Those and every other known location (outposts, settlements, Levski…)"]].map(([v,l])=>`<option value="${v}" ${(cc.where||"cities")===v?"selected":""}>${l}</option>`).join("")}</select>
          <span class="k">Layout</span><select class="field" id="s-ccstyle" data-cclook="style">${[["full","Name, time and planet line"],["compact","Name and time"],["time","Time only"]].map(([v,l])=>`<option value="${v}" ${(cc.style||"full")===v?"selected":""}>${l}</option>`).join("")}</select>
          <span class="k">Opacity</span><select class="field" id="s-ccop" data-cclook="opacity">${[100,85,70,55].map(v=>`<option value="${v}" ${(cc.opacity||100)===v?"selected":""}>${v}%</option>`).join("")}</select>
        </div>
        <div class="cc-colors" role="radiogroup" aria-label="Clock colour">${[["blue","#50b4ff"],["amber","#ff9628"],["green","#28d278"],["white","#e6ebf2"],["red","#f03c3c"],["purple","#965aff"]].map(([k,c])=>`<button type="button" class="cc-sw${(cc.color||"blue")===k?" on":""}" data-cccolor="${k}" style="--sw:${c}" role="radio" aria-checked="${(cc.color||"blue")===k}" title="${k[0].toUpperCase()+k.slice(1)}"></button>`).join("")}<span class="muted" style="font-size:12px;margin-left:6px">Colour</span></div>
        <div class="cc-place"><div class="muted" style="font-size:12px;margin:2px 0 6px">${cc.position==="custom"?"Drag the clock to where you want it on your screen.":"Where it shows on your screen. Drag it to place it yourself."}</div>
          <div class="cc-scr" id="cc-scr"><img id="cc-drag" alt="Location clock" draggable="false" hidden></div></div>
        <div class="row" style="gap:6px;margin-top:8px"><span class="spacer"></span><button class="btn small ghost" data-a="ccpreview" ${cc.available?"":"disabled"}>Preview in game</button></div>
        <div class="muted" style="font-size:12px;margin-top:6px">${cc.available?"The location clock overlay displays the name of the location and local time at the location when you land or spawn at certain locations.":"The location clock overlay only works on Windows."}</div></div>`; })()}
      <div class="sub">Hotkeys</div>
      <div class="note set-box" style="margin:4px 0 12px">
      ${a.available===false?`<div class="muted" style="margin-bottom:8px">Hotkeys only work on Windows.</div>`:""}
      <div class="setgrid">
        <span class="k">Show / hide Quantum</span><select class="field" id="s-hotkey">${keyOpts(a.hotkey,a.loc_hotkey)}</select>
        <span class="k">Type /showlocation</span><select class="field" id="s-lochotkey">${keyOpts(a.loc_hotkey,a.hotkey)}</select>
        <span class="k">Terminal screenshot</span><select class="field" id="s-shothotkey">${keys.map(k=>`<option value="${k}" ${k===(a.shot_hotkey||"")?"selected":""} ${k&&(k===a.hotkey||k===a.loc_hotkey)?"disabled":""}>${k||"Off"}${k&&(k===a.hotkey||k===a.loc_hotkey)?" (used)":""}</option>`).join("")}</select>
        <span class="k">Open chat with</span><select class="field" id="s-chat"><option value="enter" ${a.open_chat!=="none"?"selected":""}>Enter (default)</option><option value="none" ${a.open_chat==="none"?"selected":""}>Nothing, chat is already open</option></select>
        <span class="k" title="Your game key that shows / hides the chat window. Quantum won't type /showlocation while you've hidden chat">Game's chat show/hide key</span><select class="field" id="s-chatkey">${keys.map(k=>`<option value="${k}" ${k===(a.chat_key??"F12")?"selected":""} ${k&&(k===a.hotkey||k===a.loc_hotkey||k===a.shot_hotkey)?"disabled":""}>${k?k+(k==="F12"?" (game default)":""):"Off, don't check"}${k&&(k===a.hotkey||k===a.loc_hotkey||k===a.shot_hotkey)?" (used)":""}</option>`).join("")}</select>
      </div>
      ${a.loc_hotkey&&a.chat_key?`<div class="muted" style="font-size:12px;margin-top:6px">Chat in game: <b>${a.chat_hidden?"hidden":"showing"}</b>. While it's hidden, ${esc(a.loc_hotkey)} won't type (your letters would trigger key bindings). Out of step? Press ${esc(a.loc_hotkey)} twice to send anyway.</div>`:""}
      <div class="muted" style="font-size:12px;margin-top:8px">The game still sees your hotkeys, so pick keys that aren't bound in game.</div>
      ${afkHtml(a)}</div>
      <div class="sub">Window</div>
      <div class="note set-box" style="margin:4px 0 12px"><div class="muted" style="font-size:12px;margin-bottom:8px">Title bar</div>
        <div class="win-pick">${[["quantum","Quantum Theme",`<div class="wp-bar wp-q"><span class="wp-logo"></span><b>QUANTUM</b><span class="wp-sp"></span><i></i><i></i><i class="x"></i></div>`],
          ["windows","Windows",`<div class="wp-bar wp-w"><span class="wp-ico"></span><b>Quantum</b><span class="wp-sp"></span><i>&#8211;</i><i>&#9633;</i><i>&#10005;</i></div>`]]
          .map(([k,label,bar])=>`<button type="button" class="wp-opt${(S.winStyle?.style||"quantum")===k?" on":""}" data-winstyle="${k}" ${S.winStyle?.available===false?"disabled":""} aria-pressed="${(S.winStyle?.style||"quantum")===k}">
            <div class="wp-prev">${bar}<div class="wp-body"><span class="wp-rail"></span><span class="wp-side"></span><span class="wp-map"></span></div></div><span class="wp-l">${label}</span></button>`).join("")}</div>
        ${S.winStyle&&(S.winStyle.style==="quantum")!==S.winStyle.active?`<div class="wp-note">Please restart Quantum for the changes to take effect.</div>`:""}</div>
      ${S.launcher?.available===false?"":`<div class="note set-box" style="margin:4px 0 12px"><label class="row" style="gap:8px;cursor:pointer"><input type="checkbox" id="s-launchbtn" ${launcherBtnOn()?"checked":""} onchange="setLauncherBtn(this.checked)"> Show the RSI Launcher button</label>
        <div class="muted" style="font-size:12px;margin-top:6px">Beside Settings at the foot of the sidebar: <b>Start Launcher</b> opens the RSI Launcher, and it shows <b>Launcher Running</b> while it's open.</div></div>`}
      <div class="sub">Sidebar</div>
      <div class="note set-box" style="margin:4px 0 12px"><div class="row" style="gap:8px;align-items:center">
        <div class="muted" style="font-size:12px;flex:1">Drag the sections in the left-hand bar up or down to put them in the order you like (or focus one and press Alt+↑ / Alt+↓). Your order is saved on its own.</div>
        <button class="btn small ghost" data-a="railreset" ${S.railCustom?"":"disabled"}>Reset order</button></div></div>
      <div class="sub">Log</div>
      <div class="note set-box" style="margin:4px 0 12px"><div class="align-list" style="max-height:150px">${(a.events||[]).slice().reverse().map(e=>`<div class="a" style="grid-template-columns:62px 1fr"><span class="s">${new Date(e.t*1000).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit",second:"2-digit"})}</span><span>${esc(e.text)}</span></div>`).join("")||'<div class="muted">Nothing yet. Press a hotkey in game, then look here.</div>'}</div></div>`;
    const save=async()=>{
      await api().set_autoloc($("s-hotkey").value, 0, $("s-chat").value, $("s-lochotkey").value, $("s-chatkey").value);
      await poll(); renderStatus(); renderDetail(); toast("Saved"); };
    for(const id of ["s-hotkey","s-lochotkey","s-chat","s-chatkey"]) $(id).onchange=save;
    const afkSave=async(on)=>{ const st=await api().set_antiafk($("s-afkkey").value,$("s-afkact").value,$("s-afkfocus").checked,on); await poll(); renderDetail();
      if(on!==undefined) toast(st.afk.on?"Anti-AFK on: a harmless input every 1 to 4 minutes while Star Citizen is open":"Anti-AFK off"); };
    for(const id of ["s-afkkey","s-afkact","s-afkfocus"]) if($(id)) $(id).onchange=()=>afkSave();
    if($("s-afktoggle")) $("s-afktoggle").onclick=()=>afkSave(!(S.live?.autoloc?.afk?.on));
    $("s-shothotkey").onchange=async e=>{ const r=await api().dr_set_hotkey(e.target.value); await poll(); renderDetail();
      toast(r.shot_hotkey?`${r.shot_hotkey} takes a terminal screenshot for your UEX report`:"Screenshot key off"); };
    const ccSave=async()=>{ if(!$("s-ccmode")) return; S.ccImg=null; S.ccPos=null; await api().set_city_clock($("s-ccmode").value,$("s-ccpos").value,$("s-cch24").value==="1",$("s-ccsize").value,$("s-ccagain").value); await poll(); renderDetail(); toast("Saved"); };
    for(const id of ["s-ccmode","s-ccpos","s-cch24","s-ccsize","s-ccagain"]) if($(id)) $(id).onchange=ccSave;
    const ccLook=async prefs=>{ S.ccImg=null; await api().set_city_clock_look(prefs); await poll(); renderDetail(); toast("Saved"); };
    for(const el of d.querySelectorAll("[data-cclook]")) el.onchange=()=>ccLook({[el.dataset.cclook]:el.dataset.cclook==="opacity"?+el.value:el.value});
    for(const b of d.querySelectorAll("[data-cccolor]")) b.onclick=()=>ccLook({color:b.dataset.cccolor});
    ccPlacer();
    for(const b of d.querySelectorAll("[data-winstyle]")) b.onclick=async()=>{ if(S.winStyle?.style===b.dataset.winstyle) return;
      S.winStyle=await api().set_window_style(b.dataset.winstyle); renderDetail();
      toast(S.winStyle.style===(S.winStyle.active?"quantum":"windows")?"Saved":"Please restart Quantum for the changes to take effect"); };
    const rr=d.querySelector('[data-a="railreset"]'); if(rr) rr.onclick=async()=>{ await railSave(null); railApply(railDefault); renderDetail(); toast("Sidebar back to its default order"); };
    if(typeof tlSettingsWire==="function") tlSettingsWire(d);
    $("s-clearlog").onchange=async e=>{ await api().set_option("clear_log_on_start", e.target.checked); await poll();
      toast(e.target.checked?"Game.log will be cleared when Quantum starts (unless the game is running)":"Game.log will be left as is"); };
  } else if(sel.kind==="align"){ const st=S.alignStatus; if(!st) return d.classList.remove("show");
    const day=x=>x?new Date(x*1000).toLocaleDateString([], {day:"numeric",month:"short"}):"";
    const rows=st.bodies.filter(b=>b.system===S.system).map(b=>{
      let mark="no", text="Community values";
      const q={hangar:"from a hangar, within a few km",station:"from the station, within ~1 km",place:"exact",estimate:"estimated, will be replaced by your first reading",community:"agreed by Quantum datarunners for this game version"}[b.quality]||"older calibration, accuracy unknown";
      if(b.calibrated&&b.aligned_now===false){ mark="warn"; text=`Aligned before the last game update${b.at?" ("+day(b.at)+")":""}: line it up again for this version`; }
      else if(b.calibrated){ mark=b.quality?"ok":"warn"; text=`Aligned at ${esc(b.place||"a known place")} (${q})${b.at?" · "+day(b.at):""}`;
        if(b.checks){ const drift=b.worst_check; mark=drift<0.2?"ok":"warn";
          text+=` · ${b.checks} check${b.checks>1?"s":""} over ${b.sessions} session${b.sessions>1?"s":""}, ${drift<0.2?"stable":"drift up to "+drift.toFixed(2)+"°"}`; } }
      return `<div class="a"><span class="${mark}">${mark==="ok"?"✓":mark==="warn"?"!":"○"}</span><div><b>${esc(b.name)}</b> <span class="s">${b.kind}</span><div class="s">${text}</div></div>
        ${b.calibrated?`<button class="btn small ghost" data-a="resetcal" data-body="${esc(b.name)}" title="Go back to the community value">Reset</button>`:"<span></span>"}</div>`; }).join("");
    d.innerHTML=`<button class="close" aria-label="Close">×</button><h2>Alignment</h2>
      <div class="sub">${esc(S.system)}${st.build?` · ${gameVerTxt(st)}`:""}</div>
      <div class="hint" style="font-size:13px;color:var(--ink-2)">Each planet is lined up once, from a /showlocation at a known place. Later readings at known places are logged as checks: if they stay near 0°, the alignment holds across sessions and can be shared.</div>

      <div class="align-list">${rows||`<div class="muted">${S.system==="Nyx"?"Nothing to line up in Nyx yet: its planets can't be landed on in this version of the game, and Delamar is an asteroid (Levski is a station built into it), so there's no planet surface to take a /showlocation on.":"No landable planets or moons in this system."}</div>`}</div>
      <div class="acts"><button class="btn primary" data-a="export">Export alignments</button><button class="btn" data-a="import">Import</button></div>
      <div class="muted" style="font-size:12px;margin-top:8px">Saved automatically to ${esc(st.file)}. A calibrations.json placed in the app folder is applied on start.</div>`;
  } else if(sel.kind==="body"){ const b=S.bodyMap[sel.name]; if(!b) return d.classList.remove("show");
    const n=S.locs.filter(L=>L.body===b.name).length;
    d.innerHTML=`${placePicHtml(placePicKey(sel))}<button class="close" aria-label="Close">×</button><h2>${esc(b.name)}</h2>
      <div class="sub">${wikiFor(b.name)?.designation?esc(wikiFor(b.name).designation)+" · ":""}${kindLabel(b)} in ${esc(b.system)}${b.parent&&b.kind==="moon"?", orbiting "+esc(b.parent):""}</div>
      <div class="kv">${wikiFor(b.name)?.type?`<span class="k">Type</span><span>${esc(wikiFor(b.name).type)}</span>`:""}
      ${b.kind==="star"?systemBlurb(wikiSystem(b.system)):""}
      ${wikiFor(b.name)?.moons?.length?`<span class="k">Moons</span><span>${wikiFor(b.name).moons.map(esc).join(", ")}</span>`:""}
      <span class="k">Radius</span><span>${fmtDist(b.radius)}</span>
      ${b.period?`<span class="k">Day length</span><span>${b.period.toFixed(2)} h</span>`:""}
      <span class="k">POI</span><span>${n}</span>
      ${b.alignable?`<span class="k">Rotation</span><span>${b.calibrated?"Calibrated by you":"Community offset"}</span>`:""}
      ${b.kind==="asteroid"?`<span class="k">Landing</span><span>${S.locs.some(L=>L.body===b.name&&L.type==="station")?`At ${S.locs.filter(L=>L.body===b.name&&L.type==="station").map(L=>esc(L.name)).join(", ")} (station)`:"No landing zones"}</span>`:""}
      ${b.align_note?`<span class="k">Rotation</span><span>${esc(b.align_note)}</span>`:b.kind==="planet"&&!b.alignable?`<span class="k">Landing</span><span>Not accessible in game yet</span>`:""}
      ${distFromYou(b.center,b.system)!=null?`<span class="k">From you</span><span>${fmtDist(distFromYou(b.center,b.system)-b.radius)} to surface</span>`:""}</div>
      <div class="acts"><button class="btn primary" data-a="zoom">Fly to</button></div>${wikiFor(b.name)?CREDIT(wikiFor(b.name).url):""}`;
  } else if(sel.kind==="mission"){ const m=sel.m;
    d.innerHTML=`<button class="close" aria-label="Close">×</button><h2>${esc(m.o.label)}</h2><div class="sub"><span class="ty mission"></span>${esc(m.c.subtitle||"")} contract on ${esc(m.body||"")}</div>
      <div class="kv"><span class="k">Contract</span><span>${esc(m.c.name)}</span>${distFromYou(m.g,S.system)!=null?`<span class="k">From you</span><span>${fmtDist(distFromYou(m.g,S.system))}</span>`:""}</div>
      <div class="acts"><button class="btn go" data-a="mguide">Guide me</button><button class="btn" data-a="mroute">Add to route</button></div>`;
  } else { const L=S.locMap[sel.name]; if(!L) return d.classList.remove("show");
    loadTradePlaces(); loadShopPlaces();          // started before the card is drawn, so it can say it's loading
    const g=globalPos(L,t), from=distFromYou(g,L.system), inRoute=live?.route.includes(L.name), guiding=live?.guide?.name===L.name;
    let ll=""; if(L.kind==="surface"){ const q=latLon(L.pos); ll=`${q.lat.toFixed(3)}°, ${q.lon.toFixed(3)}°`; }
    const user=L.source==="user"||L.source==="mission";
    const canCal = L.kind==="surface" && L.source==="db" && S.bodyMap[L.body]?.alignable && live?.player?.body===L.body && live.player.age<600;
    const pl=live?.player, readingHere = pl && !pl.approx && pl.age<900 && pl.system===L.system && (L.kind==="surface" ? pl.body===L.body : (L.type!=="jump" || !pl.body));
    const unplacedBox = L.unplaced ? `<div class="unknown" style="margin:8px 0">Quantum doesn't know where this station is yet: no published data has its position${L.near?` (it's near ${esc(L.near)})`:""}.
      Dock here, type /showlocation in game chat, then press <b>I'm here: set position</b>. It goes on the map and into your routes from then on.</div>` : "";
    d.innerHTML=`${placePicHtml(placePicKey(sel))}<button class="close" aria-label="Close">×</button><h2>${esc(L.name)}</h2>
      <div class="sub"><span class="ty ${tyClass(L)}"></span>${L.source==="user"?"Your waypoint":L.source==="mission"?"Contract stop":esc(TYPES[L.type]?.one||"Place")}${L.body?" on "+esc(L.body):" in "+esc(L.system)}${(()=>{ const lt=localTime(L,t); return lt?`<span class="lt-chip" data-lt-chip title="Local time there">${ltChip(lt)}</span>`:""; })()}</div>
      ${unplacedBox}<div id="d-svc">${L.amen||S.tradePlaces?.has(L.name)||servicesLoading(L.name)?servicesHtml(L.amen?S.svcCache[L.name]||null:null,L.name):""}</div>
      ${jumpTarget(L)?(()=>{ const to=jumpTarget(L), sw=wikiSystem(to), mapped=S.systems.includes(to);
        return `<div class="kv"><span class="k">Leads to</span><span><b>${esc(to)}</b>${mapped?"":" (not charted yet)"}</span>${systemBlurb(sw)}</div>
          <div class="acts" style="margin-bottom:10px">${mapped?`<button class="btn primary" data-a="jump">Jump to ${esc(to)} ▸</button>`:""}${sw?`<button class="btn ghost" data-url="${esc(sw.url)}">${esc(to)} on the wiki</button>`:""}</div>`; })():""}
      ${L.gate_to||L.station?(()=>{ const other=L.jump_point||L.station, O=S.locMap[other], dk=O?.pos&&L.pos?fmtDist(d3(globalPos(O,t),g)):null;
        return `<div class="kv">${L.gate_to?`<span class="k">For the jump to</span><span><b>${esc(L.gate_to)}</b></span>`:""}
          ${other?`<span class="k">${L.station?"Station":"Gateway"}</span><span><a class="lnk" data-golink="${esc(other)}">${esc(other)}</a>${dk?` <span class="muted">· ${dk} away</span>`:""}</span>`:""}</div>`; })():""}
      <div class="kv">${from!=null?`<span class="k">From you</span><span>${fmtDist(from)}</span>`:""}
        ${L.atLpoint?`<span class="k">Lagrange point</span><span>${esc(L.atLpoint)} <span class="muted">· the QT marker for this L-point</span></span>`:""}
        ${(()=>{ const lt=localTime(L,t); if(!lt) return "";
          return `<span class="k">Local time</span><span title="Worked out from ${esc(L.body)}'s rotation (one day = ${lt.period.toFixed(2)} real hours)${lt.calibrated?"":", using the community alignment"}"><span data-lt-row>${ltRow(lt)}</span></span>`; })()}
        ${ll?`<span class="k">Lat, lon</span><span>${ll}</span>`:""}
        ${L.verify?`<span class="k">Position</span><span style="color:#f2c14e">Not confirmed in game yet${L.placeable?`: ${L.type==="jump"?"stop at the jump point":"dock here"}, type /showlocation and press <b>I'm here: set position</b>, or take the job in Datarunner &gt; Jobs`:""}</span>`:""}
        ${L.source==="user"?`<span class="k">Notes</span><textarea id="d-notes" rows="1" placeholder="Add a note">${esc(L.notes)}</textarea>`:""}</div>
      ${L.unplaced?`<div class="acts"><button class="btn primary" data-a="placehere" ${readingHere?"":`disabled title="Needs a /showlocation taken at this station in the last 15 minutes"`}>I'm here: set position</button></div>`:
      `<div class="acts">${guiding?`<button class="btn" data-a="unguide">Stop guiding</button>`:`<button class="btn go" data-a="guide">Guide me</button>`}
        ${inRoute?`<button class="btn" data-a="route" title="Visit it again later in the trip">Add again</button><button class="btn" data-a="unroute">Remove from route</button>`:`<button class="btn primary" data-a="route">Add to route</button>`}
        <button class="btn" data-a="focus">Fly to</button>
        
        ${isOnyxPlace(L.name)?`<button class="btn" data-a="onyx" title="The facility's floor plans: every wing and storey, the way out, and where enemies spawn">Floor plans</button>`:""}
        ${city3dFor(L.name)?`<button class="btn" data-a="city3d" title="Fly down into ${esc(city3dFor(L.name).titleFor?.(L.name)||L.name)} in 3D">3D city</button>`:""}
        ${canCal?`<button class="btn ghost" data-a="calibrate" title="Use this if the map puts you in the wrong spot while you're standing here">I'm here: calibrate</button>`:""}
        ${L.placeable&&readingHere?`<button class="btn ghost" data-a="placehere" title="Use your last /showlocation as this station's position">I'm here: set position</button>`:""}
        ${user?`<button class="btn ghost" data-a="delete" style="color:var(--danger)">Delete</button>`:""}</div>`}
      ${!user&&!L.unplaced?fixHtml(L,readingHere):""}`;
    if(L.amen&&!(L.name in S.svcCache)) fillServices(L.name);
    loadTradePlaces(); loadShopPlaces();
    if(!L.unplaced){
      if($("d-pad")) $("d-pad").onchange=e=>{ api().update_location(L.name,e.target.value,null); L.pad=e.target.value;
        toast(e.target.value==="unknown"?`Pad size for ${L.name} cleared`:`Pad size ${padLabel(e.target.value)} saved. It shows for everyone once another datarunner agrees`); };
      if($("d-notes")) $("d-notes").onchange=e=>{ api().update_location(L.name,null,e.target.value); L.notes=e.target.value; }; }
  }
  // A place's buttons (Guide me, Add to route, Fly to, 3D city…) go last and stick to the bottom of the card,
  // so they're always in view; the rest scrolls behind them when the card is taller than the window
  if(sel.kind==="body"||sel.kind==="loc"||sel.kind==="mission"){ const A=[...d.children].filter(x=>x.classList.contains("acts"));
    if(A.length===1){ d.appendChild(A[0]); A[0].classList.add("stick"); } }
  d.classList.add("show");
  const fx=d.querySelector("details.fixpos");
  if(fx&&S.fix){ fx.ontoggle=()=>{ S.fix.open=fx.open; };
    const ta=$("fix-text"); if(ta) ta.oninput=()=>{ S.fix.text=ta.value; S.fix.sent=null;
      const b=d.querySelector('[data-a="fixsend"]'); if(b) b.disabled=!(S.fix.not.size&&S.fix.tab==="svc"||ta.value.trim().length>=5); }; }
  if(sel.kind==="loc"&&S.svcCache[sel.name]) fitDesc(sel.name);
  if(sel.kind==="body"||sel.kind==="loc") fillPlacePic(sel);
  if(sel.kind==="settings") fillUexStatus(false);
  d.onclick=async e=>{ const u=e.target.closest("[data-url]"); if(u){ api().open_url(u.dataset.url); return; }
    const ft=e.target.closest("[data-fixtab]"); if(ft&&S.fix){ S.fix.tab=ft.dataset.fixtab; return renderDetail(); }
    const fn=e.target.closest("[data-fixnot]"); if(fn&&S.fix){ const k=fn.dataset.fixnot; S.fix.not.has(k)?S.fix.not.delete(k):S.fix.not.add(k); S.fix.sent=null; return renderDetail(); }
    const dm=e.target.closest("[data-desc]"); if(dm){ S.descOpen=S.descOpen||new Set();
      S.descShut=S.descShut||new Set();
      if(dm.dataset.desc==="more"){ S.descOpen.add(sel.name); S.descShut.delete(sel.name); } else { S.descOpen.delete(sel.name); S.descShut.add(sel.name); if(S.descFit===sel.name) S.descFit=null; }
      const el=$("d-svc"); if(el) el.innerHTML=servicesHtml(S.svcCache[sel.name],sel.name); return; }
    if(e.target.closest("[data-stock]")) return toggleStock(sel.name);
    if(e.target.closest("[data-hosp]")) return toggleHospital(sel.name);
    const sh=e.target.closest("[data-shop]"); if(sh) return toggleShop(sel.name,sh.dataset.shop);
    const gl=e.target.closest("[data-golink]"); if(gl){ const n=gl.dataset.golink; select({kind:"loc",name:n}); if(S.locMap[n]?.pos) focusLoc(n,true); return; }
    const a=e.target.dataset?.a; if(e.target.classList.contains("close")) return select(null); if(!a) return;
    if(a==="zoom") focusBody(sel.name);
    if(a==="openprofile"){ select(null); return openProfileView("accounts"); }
    await settingsAction(a,e);
    if(a==="jump") jumpThrough(sel.name);
    if(a==="resetcal"){ const n=e.target.dataset.body; const r=await api().reset_calibration(n); if(!r.ok) return toast(r.error);
      await poll(); await openAlign(); toast(`${n} is back on community values`); return; }
    if(a==="export"){ const r=await api().export_calibrations(); if(r.ok) toast(`Exported ${r.count} planet alignment${r.count>1?"s":""}`); else if(r.error!=="cancelled") toast(r.error); }
    if(a==="import"){ const r=await api().import_calibrations(null); if(!r.ok){ if(r.error!=="cancelled") toast(r.error); return; }
      await poll(); await openAlign(); toast(r.applied.length?`Applied: ${r.applied.join(", ")}`:`Nothing new${r.skipped.length?": "+r.skipped.join(", "):""}`); }
    if(a==="route"){ await addStops([sel.name]); showRoute(); }
    if(a==="unroute"){ await api().remove_place(sel.name); await poll(); renderDetail(); }
    if(a==="focus") focusLoc(sel.name,true);
    if(a==="padfix"){ S.padFix=sel.name; renderDetail(); $("d-pad")?.focus(); }
    if(a==="city3d") city3dFor(sel.name)?.open(sel.name);
    if(a==="onyx") return openOnyx(sel.name);
    if(a==="stock") return toggleStock(sel.name);
    if(a==="guide"){ await api().set_guide(sel.name); await poll(); renderDetail(); showRoute(); setFollow(true); followNow(); toast(`Guiding you to ${sel.name}`); }
    if(a==="unguide"){ await api().set_guide(null); await poll(); renderDetail(); }
    if(a==="placehere"){ const r=await api().set_place_here(sel.name); if(!r.ok) return toast(r.error); await loadStatic(); await poll();
      select({kind:"loc",name:sel.name}); focusLoc(sel.name,true); toast(`${sel.name} is on the map now`); return; }
    if(a==="fixsend"){ e.target.disabled=true; e.target.textContent="Sending…"; return fixSend(); }
    if(a==="fixpos"){ e.target.disabled=true; e.target.textContent="Sending…"; const n=sel.name, r=await api().report_position(n);
      if(!r.ok){ e.target.disabled=false; e.target.textContent="Send the right position"; return toast(r.error); }
      await loadStatic(); await poll(); select({kind:"loc",name:n}); focusLoc(n,true);
      toast(`${n} moved ${r.moved_km<1?Math.round(r.moved_km*1000)+" m":r.moved_km.toFixed(1)+" km"} on your map. Sending it to Quantum…`);
      for(let k=0;k<40;k++){ await new Promise(res=>setTimeout(res,750)); const pr=await api().place_result(n);
        if(pr.state==="done"){ toast(pr.shared?`${n}: live for every Quantum user now`:`${n}: sent. It goes live for everyone once another datarunner's reading agrees`); break; }
        if(pr.state==="queued"||pr.state==="error"){ toast(`${n}: the Quantum server couldn't take it yet. Quantum sends it again later`); break; } }
      return; }
    if(a==="calibrate"){ const r=await api().calibrate_at(sel.name); if(!r.ok) return toast(r.error); await poll(); toast(`${S.locMap[sel.name].body} calibrated (${r.correction.toFixed(2)}° correction)`); }
    if(a==="delete"){ const n=sel.name, L=S.locMap?.[n];
      if(!await qConfirm({title:`Delete ${n}?`,text:`This removes the waypoint${L?.body?` on ${L.body}`:""} from your map${S.live?.route?.includes(n)?" and from your route":""}. This can't be undone.`,ok:"Delete",danger:true})) return;
      await api().delete_location(n); select(null); await poll(); toast(`${n} deleted`); }
    if(a==="mguide"){ const r=await api().guide_objective(sel.m.c.id,sel.m.o.id); if(!r.ok) return toast(r.error); await poll(); select({kind:"loc",name:r.name}); showRoute(); toast(`Guiding you to ${r.name}`); }
    if(a==="mroute"){ const r=await api().add_contract_stops(sel.m.c.id,sel.m.o.id); if(!r.ok) return toast(r.error); await poll(); showRoute(); toast("Added to route"); fitRoute(false); } };
}

// =================================================================== HUD (guidance + next stop)
function compass(deg){ return `<svg class="compass" viewBox="-22 -22 44 44" aria-label="heading ${Math.round(deg)} degrees"><circle r="20" fill="none" stroke="#2c3f63" stroke-width="1.5"/>
  <text y="-12" text-anchor="middle" font-size="7" fill="#7684a0" font-family="Exo 2">N</text>
  <g transform="rotate(${deg})"><path d="M0,-15 L6,6 L0,2 L-6,6 Z" fill="#7fe7ff"/></g></svg>`; }
// ---- Contract objectives over the map while you fly a route (Deliver 0/4, Collect 1/2…), like the game's own
// tracker. Only contracts with a stop in your route; hidden with Contracts › Options › "Objectives on the map".
function objTrackerHtml(live){ if(typeof cOpt==="function"&&!cOpt("hudobj")) return "";
  const route=live.route||[]; if(!route.length) return "";
  const cs=(live.contracts||[]).filter(c=>c.status==="active"&&(c.objectives||[]).some(o=>o.in_route)); if(!cs.length) return "";
  const row=(txt,a,b,done)=>`<div class="ot-r ${done?"done":""}"><span class="ot-d" aria-hidden="true"></span><span class="ot-t">${txt}</span>${a!=null?`<b>${a}/${b}</b>`:""}</div>`;
  const body=c=>{ const tr=c.tracking, out=[];
    if(tr&&!tr.collection){
      if(tr.pickups) out.push(row(tr.pickups>1?"Collect cargo":"Collect the cargo",Math.min(tr.picked||(tr.stage>=1?tr.pickups:0),tr.pickups),tr.pickups,tr.stage>=1));
      const cg=tr.cargo||[];
      if(cg.length) for(const g of cg) out.push(row(`Deliver ${esc(g.what)}${tr.dest&&!(tr.dropoffs>1)?` to ${esc(tr.dest)}`:""} <span class="u">SCU</span>`,g.done||0,g.total,(g.done||0)>=g.total));
      if(tr.dropoffs>1||!cg.length) out.push(row(tr.dropoffs>1?"Drop-offs":`Deliver${tr.dest?` to ${esc(tr.dest)}`:""}`,tr.delivered||0,tr.dropoffs||1,(tr.delivered||0)>=(tr.dropoffs||1)));
      return out.join(""); }
    const obs=c.objectives||[], done=obs.filter(o=>o.status==="complete").length;
    return obs.filter(o=>o.status!=="failed").slice(0,5).map(o=>row(esc(o.label),null,null,o.status==="complete")).join("")+(obs.length>1?`<div class="ot-n">${done}/${obs.length} done</div>`:""); };
  const open=!S.otShut;
  return `<div class="card objtrk"><button class="ot-h" id="ot-toggle" aria-expanded="${open}"><span>Objectives</span><b>${cs.length}</b><span class="spacer"></span><span class="ot-c">${open?"▾":"▸"}</span></button>
    ${open?cs.slice(0,3).map(c=>`<div class="ot-c1"><div class="ot-nm">${esc(c.subtitle?c.subtitle+": ":"")}${esc(c.name)}</div>${body(c)}</div>`).join("")+(cs.length>3?`<div class="ot-n">+${cs.length-3} more in Contracts</div>`:""):""}</div>`; }
function renderHud(){
  const live=S.live, g=live.guide, n=live.next; let html="";
  if(g){ const pl=live.player, approxPos=pl?.approx, ageMin=pl&&!approxPos?Math.round(pl.age/60):0;
    const arrived=g.heading!=null&&!approxPos&&g.ground<150&&Math.abs(g.climb||0)<150;
    const nums = approxPos
      ? `<div class="hint">Your position is only known from the game log (at ${esc(approxPos)}), so there's no exact distance yet. Press your /showlocation hotkey or type /showlocation for one.</div>`
      : arrived ? `<div class="hint" style="color:var(--ok)">You're there.</div>`
      : g.distance!=null ? (ageMin>=2?`<div class="muted" style="font-size:12px;margin:2px 0 -4px">From your /showlocation ${ageMin} min ago</div>`:"")+`<div class="nums"><div><div class="v">${fmtDist(g.distance)}</div><div class="k">straight line</div></div></div>`
      : g.other_system ? `<div class="hint">It's in ${esc(g.system)}. Jump there first.</div>` : `<div class="hint">Type /showlocation in game chat to see the distance.</div>`;
    const ap=(g.approach||[]).slice(0,2).map((a,i)=>`<div class="a"><span class="i">${i+1}</span><span>Quantum to <b>${esc(a.name)}</b>${a.ground!=null?`, then ${a.orbit?"descend and ":""}fly <b>${fmtDist(a.ground)}</b>`:`, then fly <b>${fmtDist(a.straight)}</b>`}</span></div>`).join("");
    const direct = g.target_is_qt ? `<div class="a"><span class="i">★</span><span>It has its own quantum marker. Pick it in your starmap.</span></div>` : "";
    const faster = !approxPos && g.ground!=null && g.approach?.[0] && g.ground < g.approach[0].ground ? `<div class="a"><span class="i">★</span><span>You're closer than any QT marker: fly there directly.</span></div>` : "";
    html+=`<div class="card guide"><div class="lbl">Guiding to<span class="spacer"></span><button class="btn small ghost" id="hud-stop">Stop</button></div>
      <div class="nm">${esc(g.name)}</div>${nums}<div id="hud-steer"></div>${(ap||direct)?`<div class="approach"><div class="muted" style="font-size:12px">Fastest way there</div>${faster||direct}${ap}</div>`:""}</div>`; }
  const here=live.travel?.state==="landed"&&live.travel?.place===n?.name;
  const gate=(live.stop_roles?.[0]||[]).find(r=>r.kind==="gate");
  if(n){ html+=`<div class="card next"><div class="lbl">Next stop${live.route.length>1?` · 1 of ${live.route.length}`:""}${here?' <span style="color:var(--ok);font-weight:600">· You\'re here</span>':""}</div><div class="nm">${esc(n.name)}</div>
    ${gate?`<div class="hint">Quantum to the gateway, then fly into the jump point to reach ${esc(gate.to||"the next system")}.</div>`:""}
    ${n.other_system?`<div class="hint">It's in ${esc(n.system)}. Jump there first.</div>`:n.distance!=null?`<div class="nums"><div><div class="v">${fmtDist(n.distance)}</div><div class="k">straight line</div></div>
      ${n.pad&&n.pad!=="unknown"?`<div><div class="v" style="color:var(--ink)">${esc(padLabel(n.pad))}</div><div class="k">pad</div></div>`:""}</div>`
      :`<div class="hint">Type /showlocation in game chat to see the distance.</div>`}
    ${(live.stop_roles?.[0]||[]).some(r=>r.kind==="buy"||r.kind==="sell")?`<div style="margin-top:6px">${roleTags((live.stop_roles[0]||[]).filter(r=>r.kind==="buy"||r.kind==="sell"))}</div>`:""}</div>`; }
  html+=objTrackerHtml(live);                                       // contract objectives, like the game's tracker
  if(typeof runsHudHtml==="function") html+=runsHudHtml();         // your trade runs (trade.js)
  // Offer to line the planet up when your reading clearly matches a place the map has elsewhere.
  const cs=live.calib_suggest;
  if(cs && S.calDismissed!==cs.reading_t){ const top=cs.places[0];
    html=`<div class="card calib"><div class="lbl">Map out of line with ${esc(cs.body)}<span class="spacer"></span><button class="btn small ghost" id="cal-x">Not now</button></div>
      ${cs.city?`<div class="note" style="margin:6px 0">In a city? Only confirm if you're standing <b>at</b> this place. From a hangar, open your inventory and type /showlocation instead: Quantum lines the planet up to the city's spaceport by itself.</div>`:""}
      <div class="hint" style="margin:4px 0 8px">Your /showlocation matches <b>${esc(top.name)}</b>${cs.log_area&&top.near_log?` (near ${esc(cs.log_area)}, where the log last placed you)`:""}, but the map has you ${fmtDist(top.off)} away. Are you there?</div>
      <div class="row" style="flex-wrap:wrap;gap:6px">${cs.places.map((p,i)=>`<button class="btn small ${i?"":"go"}" data-cal="${esc(p.name)}">${i?"":"Yes, "}I'm at ${esc(p.name)}</button>`).join("")}</div></div>`+html; }
  // The route the card describes is gone (finished, cleared, or the game closed and its contract stops went
  // with it): close the card instead of leaving "0 stops" with the old path showing.
  if(S.overview&&!live.route.length) S.overview=null;
  const ov=S.overview;
  if(ov){ const route=live.route; const roleTxt=(n,i)=>roleTags(live.stop_roles?.[i]);
    html=`<div class="card overview"><div class="lbl">Route planned<span class="spacer"></span><button class="btn small ghost" id="hud-ov-close">Close</button></div>
      <div class="nums" style="margin-top:4px"><div><div class="v">${route.length}</div><div class="k">stops</div></div><div><div class="v">${fmtDist(live.total)}</div><div class="k">${ov.from_ship?"from your position":"total"}</div></div>
      ${ov.jumps?`<div><div class="v">${ov.jumps}</div><div class="k">jumps</div></div>`:""}</div>
      <div class="hint" style="margin-top:8px">${ov.bodies.map(esc).join(" → ")}${ov.added?` · ${ov.added} contract task${ov.added>1?"s":""} added`:""}${ov.revisits?` · ${ov.revisits} return visit${ov.revisits>1?"s":""}`:""}</div>
      <div class="ovlist">${route.map((n,i)=>`<div class="i"><span class="n">${i+1}</span><span>${roleTxt(n,i)}${esc(n)}</span></div>`).join("")}</div></div>`+html; }
  $("hud").innerHTML=html; if(typeof tlHudSteer==="function") tlHudSteer(); const st=$("hud-stop"); if(st) st.onclick=async()=>{ await api().set_guide(null); await poll(); };
  const oc=$("hud-ov-close"); if(oc) oc.onclick=()=>{ S.overview=null; renderHud(); };
  const ot=$("ot-toggle"); if(ot) ot.onclick=()=>{ S.otShut=!S.otShut; renderHud(); };
  if(typeof runsHudWire==="function") runsHudWire($("hud"));
  const cx=$("cal-x"); if(cx) cx.onclick=()=>{ S.calDismissed=cs.reading_t; renderHud(); };
  for(const b of $("hud").querySelectorAll("[data-cal]")) b.onclick=async()=>{ const r=await api().calibrate_at(b.dataset.cal);
    if(!r.ok) return toast(r.error); await poll(); toast(`${cs.body} lined up at ${b.dataset.cal} (${r.correction>0?"+":""}${r.correction.toFixed(1)}°)`); };
}

// =================================================================== sidebar
for(const t of document.querySelectorAll(".tab")) t.onclick=()=>{ S.tab=t.dataset.tab;
  if(S.selected){ S.selected=null; renderDetail(); }      // the card for what you clicked on the map belongs to that view
  for(const x of document.querySelectorAll(".tab")) x.setAttribute("aria-selected",String(x===t));
  for(const p of document.querySelectorAll(".pane")) p.classList.toggle("active",p.id==="pane-"+S.tab);
  if(S.tab==="waypoints") renderWaypoints(true);
  $("vh-gallery").classList.toggle("show",S.tab==="vehicles"); if(S.tab!=="trade"){ setPreview(null); closeRunDetail(); }
  if(S.tab!=="market"){ S.mkMap=false; S.mapMarks=null; } syncMarketPanel();
  if(S.tab!=="trade"&&S.cr?.open) closeCargo();                 // the load plan belongs to Planned Routes
  $("cp-panel").classList.toggle("show",S.tab==="components"); $("fl-panel").classList.toggle("show",S.tab==="fleet");
  $("cc-panel").classList.toggle("show",S.tab==="ccu"); if(S.tab==="ccu") openCcu();
  if(S.tab==="components") openComponents(); if(S.tab==="fleet") openFleet();
  $("gr-panel").classList.toggle("show",!!GEAR[S.tab]); if(GEAR[S.tab]) openGear(S.tab);
  $("sh-panel").classList.toggle("show",S.tab==="shopping"); if(S.tab==="shopping") openShopping();
  $("pf-panel").classList.toggle("show",S.tab==="profile"); if(S.tab==="profile") openProfile();
  $("gl-panel").classList.toggle("show",S.tab==="gearlo"); if(S.tab==="gearlo") openGearLoadouts();
  $("wi-panel").classList.toggle("show",S.tab==="wishlist"); if(S.tab==="wishlist") openWishlist();
  $("so-panel").classList.toggle("show",S.tab==="friends"); if(S.tab==="friends") openSocial();
  if(S.tab==="friendmap") openFriendMap();                     // no panel over the map: the map is the Friend Map
  $("pm-panel").classList.toggle("show",S.tab.startsWith("pm-")); if(S.tab.startsWith("pm-")) openPm(S.tab);
  $("pa-panel").classList.toggle("show",S.tab==="alerts"); if(S.tab==="alerts") openAlerts();
  $("og-panel").classList.toggle("show",S.tab==="orgs"); if(S.tab==="orgs") openOrg();
  $("ph-panel").classList.toggle("show",S.tab==="patchhub"); if(S.tab==="patchhub") openPatchHub();
  $("mi-panel").classList.toggle("show",S.tab==="missions"); if(S.tab==="missions") openMissions();
  $("jb-panel").classList.toggle("show",S.tab==="jobs"); if(S.tab==="jobs") openJobs();
  $("dr-panel").classList.toggle("show",S.tab==="datarunner"); $("dr-view").classList.remove("show"); if(S.tab==="datarunner") openDatarunner();
  if(S.tab==="market") openMarket(); if(S.tab==="trade"){ openTrade(); if(S.trView==="mine") renderRuns(); } if(S.tab==="vehicles") openVehicles(); };

// ---- the rail: one button per section; each section's own tabs show as pills under its title
const GROUPS={navigate:{t:"Home",tabs:["route","waypoints","contracts"]},trade:{t:"Trade",tabs:["market","trade"]},data:{t:"Datarunner",tabs:["datarunner"]},
  ships:{t:"Ships",tabs:["fleet","components","vehicles","ccu"]},gear:{t:"Gear",tabs:["weapons","attachments","armor","clothing","gadgets","gearlo"]},
  consumables:{t:"Consumables",tabs:["consumables","utility"]},crafting:{t:"Blueprints",tabs:["blueprints"]},cart:{t:"Cart",tabs:["shopping","wishlist"]},exchange:{t:"Market",tabs:["pm-items","pm-services","pm-mine","pm-standing","alerts"]},org:{t:"Org",tabs:["orgs"]},social:{t:"Social",tabs:["friends","friendmap"]},patch:{t:"Patch Hub",tabs:["patchhub"]},missions:{t:"Missions",tabs:["missions","jobs"]},profile:{t:"Profile",tabs:["profile"]}};
const groupOf=tab=>Object.keys(GROUPS).find(g=>GROUPS[g].tabs.includes(tab))||"navigate";
S.lastTab=S.lastTab||{};
function syncRail(){ const g=groupOf(S.tab||"route"); S.lastTab[g]=S.tab||"route";
  for(const b of document.querySelectorAll("#rail [data-group]")){ if(b.dataset.group===g) b.setAttribute("aria-current","page"); else b.removeAttribute("aria-current"); }
  let n=0; for(const t of document.querySelectorAll("#tabs .tab")){ const on=t.dataset.group===g; t.classList.toggle("off-group",!on); if(on&&!t.hidden) n++; }
  $("tabs").classList.toggle("solo",n<=1); $("sec-title").textContent=GROUPS[g].t; }
for(const b of document.querySelectorAll("#rail [data-group]")) b.onclick=()=>{ const g=b.dataset.group, G=GROUPS[g];
  const ok=n=>{ const t=document.querySelector(`.tab[data-tab="${n}"]`); return t&&!t.hidden?t:null; };
  const t=ok(S.lastTab[g])||G.tabs.map(ok).find(Boolean);
  if(!t){ toast(`${G.t} needs your UEX Bearer Token: add it under Linked accounts`); return openProfileView("accounts"); }
  t.click(); };
$("rail-settings").onclick=()=>{ if(S.selected?.kind==="settings") return select(null); select({kind:"settings"}); };
for(const t of document.querySelectorAll(".tab")) t.addEventListener("click",syncRail);
// The Consumables tabs are one list, filtered by kind
for(const t of document.querySelectorAll(".tab[data-ckind]")) t.addEventListener("click",()=>{ const st=grState("consumables");
  if(st.ckind===t.dataset.ckind&&!st.sel) return; st.ckind=t.dataset.ckind; st.sel=null; st.mission=null; st.gridKey=null;
  for(const id of ["cat","mk"]){ const sel=$(`gr-${id}-consumables`); if(sel) sel.value=""; }
  grCkFilters(); if(st.data){ grFillFilters("consumables"); grRender("consumables"); } });
syncRail();

// ---- rearranging the rail: drag a section up or down (or Alt+↑/↓ on a focused one). The order is saved in
// Quantum's settings and put back at every start. The profile button stays at the top, Cart and Settings at
// the foot; everything between can go in any order.
const railMovable=b=>!!b&&b.matches?.("#rail .rail-btn[data-group]")&&!b.closest(".rail-gap~*")&&b.dataset.group!=="cart";
const railItems=()=>[...document.querySelectorAll("#rail .rail-btn[data-group]")].filter(railMovable);
const railDefault=railItems().map(b=>b.dataset.group);
const railOrder=()=>railItems().map(b=>b.dataset.group);
function railApply(order){ if(!Array.isArray(order)) return;
  const items=railItems(), by=Object.fromEntries(items.map(b=>[b.dataset.group,b])), gap=$("rail").querySelector(".rail-gap");
  const want=order.filter((g,i)=>by[g]&&order.indexOf(g)===i);
  // a section added in an update (not in the saved order) goes in at its usual place
  railDefault.forEach((g,i)=>{ if(by[g]&&!want.includes(g)) want.splice(Math.min(i,want.length),0,g); });
  for(const g of want) gap.parentNode.insertBefore(by[g],gap);
  S.railCustom=want.join()!==railDefault.join(); }
async function railSave(order){ S.railCustom=!!order&&order.join()!==railDefault.join();
  try{ await api().rail_order_set(S.railCustom?order:[]); }catch(_){ toast("Couldn't save the sidebar order"); } }
const railLoad=()=>api().rail_order?.().then(r=>{ if(r?.order?.length) railApply(r.order); }).catch(()=>{});
if(window.pywebview?.api?.rail_order) railLoad(); else window.addEventListener("pywebviewready",railLoad,{once:true});
(()=>{ const rail=$("rail"); let rd=null, eat=false;
  const mid=el=>{ const r=el.getBoundingClientRect(); return r.top+r.height/2; };
  const end=()=>{ if(!rd) return; const {b,on,from}=rd; rd=null; if(!on) return;
    b.style.transform=""; b.classList.remove("rail-drag"); rail.classList.remove("rail-sorting");
    eat=true; setTimeout(()=>{ eat=false; },0);                  // the click that ends a drag doesn't open the section
    const o=railOrder(); if(o.join()!==from) railSave(o); };
  rail.addEventListener("pointerdown",e=>{ const b=e.target.closest(".rail-btn"); if(e.button!==0||!railMovable(b)) return;
    rd={b,id:e.pointerId,y0:e.clientY,on:false,from:railOrder().join()}; });
  window.addEventListener("pointermove",e=>{ if(!rd||e.pointerId!==rd.id) return; const b=rd.b;
    if(!rd.on){ if(Math.abs(e.clientY-rd.y0)<6) return;          // a plain click stays a click
      rd.on=true; try{ b.setPointerCapture(e.pointerId); }catch(_){}
      b.classList.add("rail-drag"); rail.classList.add("rail-sorting"); rd.grab=e.clientY-b.getBoundingClientRect().top; }
    const rr=rail.getBoundingClientRect();                       // near the top or foot of a short window: scroll the rail
    if(e.clientY<rr.top+28) rail.scrollTop-=10; else if(e.clientY>rr.bottom-28) rail.scrollTop+=10;
    b.style.transform=""; const h=b.offsetHeight, c=e.clientY-rd.grab+h/2;
    for(let k=0;k<40;k++){ const p=b.previousElementSibling, n=b.nextElementSibling;
      if(railMovable(p)&&c<mid(p)) b.parentNode.insertBefore(b,p);
      else if(railMovable(n)&&c>mid(n)) b.parentNode.insertBefore(n,b);
      else break; }
    const items=railItems(), first=items[0].getBoundingClientRect().top, last=items[items.length-1].getBoundingClientRect().top;
    const y=Math.max(first,Math.min(last,e.clientY-rd.grab));      // the button stays within the movable sections
    b.style.transform=`translateY(${y-b.getBoundingClientRect().top}px)`; });
  window.addEventListener("pointerup",end); window.addEventListener("pointercancel",end);
  rail.addEventListener("click",e=>{ if(eat){ e.stopPropagation(); e.preventDefault(); eat=false; } },true);
  rail.addEventListener("keydown",e=>{ const b=e.target.closest(".rail-btn"); if(!e.altKey||!railMovable(b)||(e.key!=="ArrowUp"&&e.key!=="ArrowDown")) return;
    e.preventDefault(); const p=b.previousElementSibling, n=b.nextElementSibling;
    if(e.key==="ArrowUp"&&railMovable(p)) b.parentNode.insertBefore(b,p);
    else if(e.key==="ArrowDown"&&railMovable(n)) b.parentNode.insertBefore(n,b);
    else return;
    b.focus(); railSave(railOrder()); }); })();

// =================================================================== styled suggestions for every list box
// Text boxes with a list of suggestions (Add a ship in My Fleet, the commodity search, places, org ships,
// loadout kinds…) used the browser's own plain dropdown. They now show Quantum's suggestion box instead:
// the same options, best matches first, with ↑/↓, Enter and Esc. Picking one fills the box and tells the page
// as typing would (input and change), so each box's own handling is unchanged.
const DL_MAX=8;
const DL={inp:null,box:null,items:[],i:-1};
function dlBox(){ if(DL.box) return DL.box; const b=document.createElement("div"); b.className="gr-sugg dl-sugg"; b.hidden=true;
  b.addEventListener("mousedown",e=>e.preventDefault());                    // keep the text box's focus
  b.addEventListener("click",e=>{ const o=e.target.closest("[data-dli]"); if(o) dlPick(+o.dataset.dli); });
  document.body.appendChild(b); return DL.box=b; }
function dlHide(){ if(DL.box) DL.box.hidden=true; DL.items=[]; DL.i=-1; }
function dlOptions(inp){ const dl=document.getElementById(inp.dataset.dl||""); if(!dl) return [];
  return [...dl.options].map(o=>({v:o.value,l:(o.label&&o.label!==o.value?o.label:o.textContent||"").trim()})).filter(o=>o.v); }
function dlShow(inp){ const q=inp.value.trim().toLowerCase(), words=q.split(/\s+/).filter(Boolean);
  if(!words.length||document.activeElement!==inp) return dlHide();
  const hits=[];
  for(const o of dlOptions(inp)){ const v=o.v.toLowerCase(), t=`${v} ${o.l.toLowerCase()}`;
    if(!words.every(w=>t.includes(w))) continue;
    const sc=v.startsWith(q)?4:new RegExp(`(^|[^a-z0-9])${q.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}`).test(v)?3:v.includes(q)?2:1;
    hits.push({...o,sc}); }
  hits.sort((a,b)=>b.sc-a.sc||a.v.length-b.v.length||a.v.localeCompare(b.v));
  if(!hits.length||(hits.length===1&&hits[0].v.toLowerCase()===q)) return dlHide();   // nothing, or it's already picked
  DL.inp=inp; DL.items=hits.slice(0,DL_MAX); DL.i=Math.min(DL.i,DL.items.length-1);
  const b=dlBox(), r=inp.getBoundingClientRect(), more=hits.length-DL.items.length;
  b.innerHTML=DL.items.map((o,k)=>`<button type="button" class="gr-sg ${k===DL.i?"on":""}" data-dli="${k}"><span class="nm">${esc(o.v)}</span>${o.l?`<small>${esc(o.l)}</small>`:""}</button>`).join("")
    +(more>0?`<div class="gr-sg-h" style="text-transform:none;letter-spacing:0;font-weight:500">${more} more: keep typing</div>`:"");
  b.style.left=`${Math.round(r.left)}px`; b.style.width=`${Math.max(240,Math.round(r.width))}px`;
  const below=innerHeight-r.bottom;
  b.hidden=false;
  if(below<b.offsetHeight+12&&r.top>below){ b.style.top=""; b.style.bottom=`${Math.round(innerHeight-r.top+4)}px`; }
  else { b.style.bottom=""; b.style.top=`${Math.round(r.bottom+4)}px`; } }
function dlPick(k){ const o=DL.items[k], inp=DL.inp; if(!o||!inp) return; dlHide();
  inp.value=o.v; inp.dispatchEvent(new Event("input",{bubbles:true})); inp.dispatchEvent(new Event("change",{bubbles:true}));
  inp.focus(); try{ inp.setSelectionRange(o.v.length,o.v.length); }catch(_){} dlHide(); }
// Take over any box with a list as soon as it's used: the browser's dropdown is turned off for it
document.addEventListener("focusin",e=>{ const t=e.target; if(t?.tagName!=="INPUT") return;
  if(t.hasAttribute("list")){ t.dataset.dl=t.getAttribute("list"); t.removeAttribute("list"); }
  if(t.dataset.dl&&t.value.trim()) dlShow(t); });
document.addEventListener("input",e=>{ const t=e.target; if(t?.dataset?.dl&&e.isTrusted){ DL.i=-1; dlShow(t); } });
document.addEventListener("focusout",e=>{ if(e.target===DL.inp) setTimeout(()=>{ if(document.activeElement!==DL.inp) dlHide(); },120); });
// Before the box's own keys (Enter adds the ship, runs the search…): ↑/↓ move, Enter on a highlighted one picks it
document.addEventListener("keydown",e=>{ if(!DL.box||DL.box.hidden||e.target!==DL.inp) return;
  if(e.key==="Escape"){ e.stopImmediatePropagation(); return dlHide(); }
  if(e.key==="ArrowDown"||e.key==="ArrowUp"){ e.preventDefault(); e.stopImmediatePropagation();
    DL.i=Math.max(-1,Math.min(DL.items.length-1,DL.i+(e.key==="ArrowDown"?1:-1)));
    DL.box.querySelectorAll(".gr-sg").forEach((b,k)=>{ b.classList.toggle("on",k===DL.i); if(k===DL.i) b.scrollIntoView({block:"nearest"}); }); return; }
  if(e.key==="Enter"&&DL.i>=0){ e.preventDefault(); e.stopImmediatePropagation(); dlPick(DL.i); } },true);
// The box floats over the page: it closes when what's under it moves
addEventListener("scroll",e=>{ if(DL.box&&!DL.box.hidden&&!DL.box.contains(e.target)) dlHide(); },true);
addEventListener("resize",dlHide);
