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
  if(changed){ setLock(null); S.anim=null; buildSystem(); setSky(sys); } if(fit){ S.cam.target=systemCenter(); fitSystem(); } renderResults(); renderWaypoints(true); }
function renderSysSeg(){ const here=S.live?.game_off?null:(S.live?.player?.system||S.live?.where?.system);
  $("sysSeg").innerHTML=S.systems.map(s=>{ const w=wikiSystem(s); const tip=w?`${w.affiliation} · ${w.star_type||""}`:"";
    return `<button data-s="${s}" aria-pressed="${s===S.system}" title="${esc(tip)}">${s}</button>`; }).join(""); }
$("sysSeg").onclick=e=>{ const b=e.target.closest("button"); if(b){ S.autoSystem=false; setSystem(b.dataset.s); } };
function buildLayers(){
  const el=$("layer-list"); el.innerHTML="";
  const mk=(lbl,checked,cls,on)=>{ const l=document.createElement("label"); l.innerHTML=`<input type="checkbox" ${checked?"checked":""}><span class="ty ${cls}"></span>${esc(lbl)}`;
    l.querySelector("input").onchange=e=>on(e.target.checked); el.appendChild(l); };
  mk("Contract objectives",S.show.missions,"mission",v=>S.show.missions=v);
  mk("My waypoints (pinned)",S.show.waypoints,"wp",v=>S.show.waypoints=v);
  for(const [k,v] of Object.entries(TYPES)) mk(v.label,S.layers[k],k,val=>S.layers[k]=val);
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
function servicesHtml(r,place){
  if(!r) return "";
  const trade=place&&S.tradePlaces?.has(place), on=trade&&S.stock?.place===place&&S.stock.kind!=="shop";
  // A terminal amenity the wiki lists ("Commodity Terminal", "Trade") becomes the Commodities tile itself
  const isTrade=a=>/commodit|trade|trading/i.test(a)&&!/loading dock|freight/i.test(a);
  const tiles=placeAmenities(r.amenities,place).filter(a=>!(trade&&isTrade(a))).sort((a,b)=>svcRank(a)-svcRank(b)||a.localeCompare(b)).map(a=>{
    const m=a.match(/^(Landing Pad|Hangar) *[(]?(XL|S|M|L)[)]?$/i); const label=m?m[1]:a;
    const g=place&&shopGroupFor(a,place), gon=g&&S.stock?.kind==="shop"&&S.stock.place===place&&S.stock.group===g;
    return `<div class="svc-tile${g?" click":""}${gon?" on":""}" ${g?`data-shop="${g}" title="${esc(a)}: see what's sold here"`:`title="${esc(a)}"`}>${m?`<span class="sz">${esc(m[2].toUpperCase())}</span>`:""}${svcIcon(a)}<div class="bar"></div><div class="l">${esc(label)}</div></div>`; }).join("")
    +(trade?`<div class="svc-tile click ${on?"on":""}" data-stock="1" title="What the commodity terminals here buy and sell, with prices and how recent they are">${SVC_COMMODITY}<div class="bar"></div><div class="l">Commodities</div></div>`:"");
  // A long description is cut short with "More" to read it all ("Less" folds it again); which places you've
  // opened is kept, so the card can redraw every tick without folding it back up
  const full=r.description||"", long=full.length>260, open=long&&S.descOpen?.has(place);
  const desc=!full?"":!long||open?esc(full)+(long?` <a class="desc-more" data-desc="less">Less</a>`:"")
    :esc(full.slice(0,full.lastIndexOf(" ",250)>180?full.lastIndexOf(" ",250):250).replace(/[\s,;:.]+$/,""))+`… <a class="desc-more" data-desc="more">More</a>`;
  return `<div class="svc">${r.jurisdiction?`<div class="jur">Jurisdiction <b>${esc(r.jurisdiction)}</b></div>`:""}
    ${tiles?`<div class="svc-grid">${tiles}</div>`:`<div class="none">No services listed for this location.</div>`}
    ${desc?`<div class="desc">${desc}</div>`:""}
    ${r.fuel?`<div class="jur" style="margin-top:8px">Fuel ${r.fuel.map(f=>`<b>${esc(f.what.replace(" Fuel",""))}</b> ${money(f.price)}/SCU`).join(" · ")} <span class="muted">(UEX)</span></div>`:""}
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
  const show=()=>img.classList.add("in"); img.complete?show():(img.onload=show); img.onerror=()=>img.closest(".dpic")?.remove(); }
async function fillServices(name){
  if(!(name in S.svcCache)) S.svcCache[name]=await api().get_services(name);
  const el=$("d-svc"); if(el&&S.selected?.name===name) el.innerHTML=servicesHtml(S.svcCache[name],name); }
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
  if(!r?.ok){ S.tradePlaces=undefined; return; }          // tried again next time a card opens
  S.tradePlaces=new Set(r.places); if(rsMode()==="search") rsRender(); if(S.selected?.kind==="loc"&&S.tradePlaces.has(S.selected.name)) renderDetail(); }
async function toggleStock(place){ if(S.stock?.place===place&&S.stock.kind!=="shop"){ closeStock(); return renderDetail(); }
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
const SVC_SHOP=[[/rent|rental/i,["rentals"]],[/ship component/i,["components"]],[/ship weapon|vehicle weapon/i,["shipweapons"]],[/armou?r/i,["armor"]],[/cloth|apparel|fashion/i,["clothing"]],
  [/weapon|gun ?shop|armory/i,["weapons"]],[/food|restaurant|bar\b|drink|cafe|diner/i,["food"]],[/clinic|hospital|medical|pharmacy/i,["medical"]],
  [/gadget|tool|mining equipment/i,["gadgets"]]];
// The wiki's one "Buy Ship Items and Weapons" is shown as two tiles, ship weapons and ship components (only the
// ones UEX lists there, once that's known). A shop UEX lists that no amenity covers gets its tile too.
const SHOP_TILE={armor:"Buy Armor",clothing:"Buy Clothing",weapons:"Buy Weapons",shipweapons:"Buy Ship Weapons",components:"Buy Ship Components",rentals:"Rent Vehicles"};
function placeAmenities(list,place){ const have=place&&S.shopPlaces?.[place], out=[];
  for(const a of list){
    if(/ship items and weapons/i.test(a)){ const both=["shipweapons","components"], keep=have&&both.some(g=>have.includes(g))?both.filter(g=>have.includes(g)):both;
      for(const g of keep) out.push(SHOP_TILE[g]); }
    else out.push(a); }
  if(have){ const covered=new Set(out.flatMap(a=>{ const h=SVC_SHOP.find(([rx])=>rx.test(a)); return h?h[1]:[]; }));
    for(const g of Object.keys(SHOP_TILE)) if(have.includes(g)&&!covered.has(g)) out.push(SHOP_TILE[g]); }
  return [...new Set(out)]; }
function shopGroupFor(service,place){ const have=S.shopPlaces?.[place]; if(!have) return null;
  const hit=SVC_SHOP.find(([rx])=>rx.test(service)); return hit?hit[1].find(g=>have.includes(g))||null:null; }
async function loadShopPlaces(){ if(S.shopPlaces!==undefined||!S.live?.log?.uex_token||Date.now()-(S.shopPlacesTry||0)<60000) return;
  S.shopPlaces=null; S.shopPlacesTry=Date.now();
  let r; try{ r=await api().uex_shop_places(); }catch(e){ r=null; }
  if(!r?.ok){ S.shopPlaces=undefined; return; }
  S.shopPlaces=r.places; S.shopGroups=r.groups; S.fuelPlaces=r.fuel||{}; if(rsMode()==="search") rsRender(); if(S.selected?.kind==="loc"&&r.places[S.selected.name]) renderDetail(); }
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
        <div class="pr"><b>${Math.round(i.price).toLocaleString()}<small>aUEC / day</small></b><i class="${a.c}" title="${i.at?`Price reported ${agoTs(i.at)}`:"No report time"}">${i.at?agoTs(i.at):"age unknown"}</i></div></div></div>`; };
  const card=i=>{ if(i.group==="rentals") return rentCard(i); const m=shopGear(i), G=m&&GEAR[m.tab], a=drAge(i.at), ship=i.group==="components"||i.group==="shipweapons";
    const link=m?`data-shopgear="${esc(m.tab)}|${esc(m.g.uuid||m.g.name)}" title="Open ${esc(i.name)} in Gear"`:ship&&i.cat?`data-shopcp="${esc(i.cat)}|${esc(i.id)}" title="Open ${esc(i.name)} in Components"`:"";
    const img=m?.g?.image;
    return `<div class="stk-card shop${link?"":" nolink"}" ${link}><div class="ph" ${img?"":SHOP_GEAR_KIND.has(i.group)?`data-gpic="${esc(i.name)}"`:`data-pic="${esc(i.name)}"`}>${img?`<img src="${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer">`:phCard(ship?"component":"commodity")}</div>
      <div class="bd"><div class="nm"><b>${esc(i.name)}</b></div><div class="cat">${esc([m?.g?.maker,i.category||gname[i.group]].filter(Boolean).join(" · "))}</div>
        ${G&&G.key(m.g)?`<div class="key">${esc(G.key(m.g))}</div>`:""}
        <div class="pr"><b>${Math.round(i.price).toLocaleString()}<small>aUEC</small></b><i class="${a.c}" title="${i.at?`Price reported ${agoTs(i.at)}`:"No report time"}">${i.at?agoTs(i.at):"age unknown"}</i></div></div></div>`; };
  P.innerHTML=head+statBlock([{label:st.group==="rentals"?"For rent":"For sale",value:String(shown.length)},{label:"Prices",value:prices.length?(Math.min(...prices)===Math.max(...prices)?`${Math.round(prices[0]).toLocaleString()} aUEC`:`${shortMoney(Math.min(...prices))} to ${shortMoney(Math.max(...prices))}`):"—"},{label:"Newest report",value:newest?agoTs(newest):"None"}],
      oldest&&newest&&newest-oldest>86400?[{label:"Oldest price here",value:agoTs(oldest)}]:[])
    +(groups.length>1||st.group==="all"?`<div class="stk-chips">${[["all","Everything"],...groups].map(([k,t])=>`<button data-shopg="${k}" class="${st.group===k?"on":""}">${esc(t)}<b>${k==="all"?all.length:count[k]}</b></button>`).join("")}</div>`:"")
    +`<div class="stk-tools"><input class="search" data-stkq="1" placeholder="${st.group==="rentals"?"Search vehicles for rent here":"Search what's sold here"}" value="${esc(st.q)}" autocomplete="off" spellcheck="false">
      <select class="field" data-stksort="1">${[["name","A–Z"],["cheap","Price: low to high"],["dear","Price: high to low"],["fresh","Most recently reported"]].map(([v,t])=>`<option value="${v}" ${st.sort===v?"selected":""}>${t}</option>`).join("")}</select></div>`
    +(!all.length?`<div class="empty">UEX has nothing listed for sale here yet.</div>`
      :r.shops.map(s=>{ const rows=s.items.filter(keep).sort(by); if(!rows.length) return ""; const a=drAge(s.updated);
        return `<div class="stk-th"><b>${esc(s.name)}</b>${s.updated?`<span style="${a.c==="a0"?"color:#57e39b":a.c==="a2"?"color:#f2c14e":a.c==="a3"?"color:#ff8a5c":""}">updated ${esc(agoTs(s.updated))}</span>`:""}<span>${rows.length} ${st.group==="rentals"?"vehicle":"item"}${rows.length===1?"":"s"}</span></div>
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
function renderDetail(){
  const d=$("detail"), sel=S.selected;
  if(S.stock&&(sel?.kind!=="loc"||sel.name!==S.stock.place)) closeStock();
  if(sel?.kind!=="settings"){ S.bugSent=false; S.bugOpen=false; }      // Settings closed: back to "Report a bug" next time
  if(!sel){ d.classList.remove("show"); return; }
  const live=S.live, t=now();
  if(sel.kind==="settings"){ const a=S.live?.autoloc||{};
    const keys=["","F5","F6","F7","F8","F9","F10","F11","F12"];
    const when=a.last_sent?new Date(a.last_sent*1000).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit",second:"2-digit"}):"never";
    const lg=S.live?.log||{}, cl=lg.cleared;
    const inSys=S.bodies.filter(b=>b.system===S.system&&b.alignable), done=inSys.filter(b=>b.calibrated).length;
    const keyOpts=(cur,other)=>keys.map(k=>`<option value="${k}" ${k===cur?"selected":""} ${k&&k===other?"disabled":""}>${k||"Off"}${k&&k===other?" (used)":""}</option>`).join("");
    d.innerHTML=`<button class="close" aria-label="Close">×</button><h2>Settings</h2>
      <div class="set-ver"><div class="v"><b title="${S.qBuild?`Build ${esc(S.qBuild)}`:""}">Quantum ${esc(S.qVersion||"")}</b><span class="muted">${esc(S.updNote||"")}</span></div>
        <button class="btn small ghost upd-btn" data-a="updcheck" ${S.updChecking?"disabled":""}>${S.updChecking?`<span class="spin-sm"></span>Checking…`:"Check for updates"}</button></div>
      <div class="sub" style="margin-top:6px">Game.log</div>
      <div class="note" style="margin:4px 0 12px"><div class="row"><span class="dot ${lg.status==="watching"?"on":"warn"}"></span><b>${lg.status==="watching"?"Reading Game.log":"Looking for Game.log (found automatically when the game starts)"}</b><span class="spacer"></span><button class="btn small ghost" data-a="logchange">Change</button></div>
        <div class="path" style="word-break:break-all;color:var(--dim);font-size:12px;margin-top:4px">${esc(lg.path||"Browse to …\\StarCitizen\\LIVE\\Game.log")}</div>
        <label class="row" style="gap:8px;margin-top:8px;cursor:pointer"><input type="checkbox" id="s-clearlog" ${lg.clear_on_start?"checked":""}> Clear Game.log when Quantum starts</label>
        ${cl?`<div class="muted" style="font-size:12px;margin-top:4px">${cl.ok?`Cleared at startup (${(cl.bytes/1048576).toFixed(1)} MB).`:`Not cleared at startup: ${esc(cl.reason)}.`}</div>`:""}</div>
      <div class="sub">Alignment</div>
      <div class="note row" style="margin:4px 0 12px"><span class="dot ${done?"on":""}"></span><span>${inSys.length?`<b>${done}</b> of ${inSys.length} aligned in ${esc(S.system)}`:`Nothing to align in ${esc(S.system)}`}</span><span class="spacer"></span><button class="btn small ghost" data-a="openalign">Open</button></div>
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
      <div class="sub">Account, UEX keys and backup</div>
      <div class="note row" style="margin:4px 0 12px;gap:8px"><span>Your Quantum account, UEX keys and backups are in your profile now: click your picture at the top left.</span><span class="spacer"></span><button class="btn small" data-a="openprofile">Open profile</button></div>
      <div class="sub">Map look</div>
      <div class="note" style="margin:4px 0 12px"><div class="row" style="gap:8px;flex-wrap:wrap"><span>Orbit line colour</span><span class="spacer"></span>
        <span class="orbit-sw">${ORBIT_PRESETS.map(([c,n])=>`<button type="button" data-orbitc="${c}" class="${c===S.orbitColor?"on":""}" title="${n}" style="background:${c}" onclick="setOrbitColor('${c}')"></button>`).join("")}</span>
        <input type="color" id="s-orbitc" value="${S.orbitColor}" title="Any colour" oninput="setOrbitColor(this.value,false)" onchange="setOrbitColor(this.value)">
        ${S.orbitColor!==ORBIT_DEFAULT?`<button class="btn small ghost" type="button" onclick="setOrbitColor(ORBIT_DEFAULT);renderDetail()">Reset</button>`:""}</div></div>
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
        </div>
        <div class="cc-place"><div class="muted" style="font-size:12px;margin:2px 0 6px">${cc.position==="custom"?"Drag the clock to where you want it on your screen.":"Where it shows on your screen. Drag it to place it yourself."}</div>
          <div class="cc-scr" id="cc-scr"><img id="cc-drag" alt="Location clock" draggable="false" hidden></div></div>
        <div class="row" style="gap:6px;margin-top:8px"><span class="spacer"></span><button class="btn small ghost" data-a="ccpreview" ${cc.available?"":"disabled"}>Preview in game</button></div>
        <div class="muted" style="font-size:12px;margin-top:6px">${cc.available?"The location clock overlay displays the name of the location and local time at the location when you land or spawn at certain locations.":"The location clock overlay only works on Windows."}</div></div>`; })()}
      <div class="sub">Help</div>
      <div class="note" style="margin:4px 0 12px">${S.bugSent?`<span style="color:#9fe0b4">Thanks! Your bug report was sent.</span> <a data-a="bugopen" style="cursor:pointer;text-decoration:underline">Send another</a>`
        :!S.bugOpen?`<div class="row"><span>Something to report?</span><span class="spacer"></span><button class="btn small" data-a="bugopen">Send a report</button></div>`
        :`<label class="k" for="s-bugmsg" style="display:block;font-weight:600;font-size:12.5px;margin:0 2px 5px">What happened?</label>
          <textarea class="field" id="s-bugmsg" rows="5" maxlength="5000" style="width:100%;resize:vertical" placeholder="What you did, what you expected, and what happened instead" oninput="S.bugMsg=this.value">${esc(S.bugMsg||"")}</textarea>
          <label class="k" for="s-bugcontact" style="display:block;font-weight:600;font-size:12.5px;margin:10px 2px 5px">How can we reach you? <span class="muted" style="font-weight:400">(optional: Discord, email…)</span></label>
          <input class="field" id="s-bugcontact" maxlength="200" style="width:100%" value="${esc(S.bugContact||"")}" oninput="S.bugContact=this.value" autocomplete="off">
          <div class="muted" style="font-size:12px;margin-top:6px">Sent with your UEX name (if you've added your Secret Key), this Quantum version and your game version. Only the Quantum developer sees it.</div>
          <div class="row" style="gap:6px;margin-top:8px"><button class="btn small primary" data-a="bugsend" ${S.bugBusy?"disabled":""}>${S.bugBusy?"Sending…":"Send bug report"}</button><button class="btn small ghost" data-a="bugcancel">Cancel</button></div>`}</div>
      <div class="sub">Hotkeys</div>
      ${a.available===false?`<div class="note">Hotkeys only work on Windows.</div>`:""}
      <div class="setgrid">
        <span class="k">Show / hide Quantum</span><select class="field" id="s-hotkey">${keyOpts(a.hotkey,a.loc_hotkey)}</select>
        <span class="k">Type /showlocation</span><select class="field" id="s-lochotkey">${keyOpts(a.loc_hotkey,a.hotkey)}</select>
        <span class="k">Terminal screenshot</span><select class="field" id="s-shothotkey">${keys.map(k=>`<option value="${k}" ${k===(a.shot_hotkey||"")?"selected":""} ${k&&(k===a.hotkey||k===a.loc_hotkey)?"disabled":""}>${k||"Off"}${k&&(k===a.hotkey||k===a.loc_hotkey)?" (used)":""}</option>`).join("")}</select>
        <span class="k">Open chat with</span><select class="field" id="s-chat"><option value="enter" ${a.open_chat!=="none"?"selected":""}>Enter (default)</option><option value="none" ${a.open_chat==="none"?"selected":""}>Nothing, chat is already open</option></select>
        <span class="k" title="Your game key that shows / hides the chat window. Quantum won't type /showlocation while you've hidden chat">Game's chat show/hide key</span><select class="field" id="s-chatkey">${keys.map(k=>`<option value="${k}" ${k===(a.chat_key??"F12")?"selected":""} ${k&&(k===a.hotkey||k===a.loc_hotkey||k===a.shot_hotkey)?"disabled":""}>${k?k+(k==="F12"?" (game default)":""):"Off, don't check"}${k&&(k===a.hotkey||k===a.loc_hotkey||k===a.shot_hotkey)?" (used)":""}</option>`).join("")}</select>
      </div>
      ${a.loc_hotkey&&a.chat_key?`<div class="muted" style="font-size:12px;margin-top:6px">Chat in game: <b>${a.chat_hidden?"hidden":"showing"}</b>. While it's hidden, ${esc(a.loc_hotkey)} won't type (your letters would trigger key bindings). Out of step? Press ${esc(a.loc_hotkey)} twice to send anyway.</div>`:""}
      <div class="muted" style="font-size:12px;margin-top:8px">The game still sees your hotkeys, so pick keys that aren't bound in game.</div>
      ${afkHtml(a)}
      <div class="sub" style="margin-top:12px">Log</div>
      <div class="align-list" style="max-height:150px">${(a.events||[]).slice().reverse().map(e=>`<div class="a" style="grid-template-columns:62px 1fr"><span class="s">${new Date(e.t*1000).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit",second:"2-digit"})}</span><span>${esc(e.text)}</span></div>`).join("")||'<div class="muted">Nothing yet. Press a hotkey in game, then look here.</div>'}</div>`;
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
    ccPlacer();
    $("s-clearlog").onchange=async e=>{ await api().set_option("clear_log_on_start", e.target.checked); await poll();
      toast(e.target.checked?"Game.log will be cleared when Quantum starts (unless the game is running)":"Game.log will be left as is"); };
  } else if(sel.kind==="align"){ const st=S.alignStatus; if(!st) return d.classList.remove("show");
    const day=x=>x?new Date(x*1000).toLocaleDateString([], {day:"numeric",month:"short"}):"";
    const rows=st.bodies.filter(b=>b.system===S.system).map(b=>{
      let mark="no", text="Community values";
      const q={hangar:"from a hangar, within a few km",station:"from the station, within ~1 km",place:"exact",estimate:"estimated, will be replaced by your first reading",community:"agreed by Quantum datarunners for this game version"}[b.quality]||"older calibration, accuracy unknown";
      if(b.calibrated){ mark=b.quality?"ok":"warn"; text=`Aligned at ${esc(b.place||"a known place")} (${q})${b.at?" · "+day(b.at):""}`;
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
      ${b.kind==="planet"&&!b.alignable?`<span class="k">Landing</span><span>Not accessible in game yet</span>`:""}
      ${distFromYou(b.center,b.system)!=null?`<span class="k">From you</span><span>${fmtDist(distFromYou(b.center,b.system)-b.radius)} to surface</span>`:""}</div>
      <div class="acts"><button class="btn primary" data-a="zoom">Fly to</button></div>${wikiFor(b.name)?CREDIT(wikiFor(b.name).url):""}`;
  } else if(sel.kind==="mission"){ const m=sel.m;
    d.innerHTML=`<button class="close" aria-label="Close">×</button><h2>${esc(m.o.label)}</h2><div class="sub"><span class="ty mission"></span>${esc(m.c.subtitle||"")} contract on ${esc(m.body||"")}</div>
      <div class="kv"><span class="k">Contract</span><span>${esc(m.c.name)}</span>${distFromYou(m.g,S.system)!=null?`<span class="k">From you</span><span>${fmtDist(distFromYou(m.g,S.system))}</span>`:""}</div>
      <div class="acts"><button class="btn go" data-a="mguide">Guide me</button><button class="btn" data-a="mroute">Add to route</button></div>`;
  } else { const L=S.locMap[sel.name]; if(!L) return d.classList.remove("show");
    const g=globalPos(L,t), from=distFromYou(g,L.system), inRoute=live?.route.includes(L.name), guiding=live?.guide?.name===L.name;
    let ll=""; if(L.kind==="surface"){ const q=latLon(L.pos); ll=`${q.lat.toFixed(3)}°, ${q.lon.toFixed(3)}°`; }
    const user=L.source==="user"||L.source==="mission";
    const canCal = L.kind==="surface" && L.source==="db" && S.bodyMap[L.body]?.alignable && live?.player?.body===L.body && live.player.age<600;
    const pl=live?.player, readingHere = pl && !pl.approx && pl.age<900 && pl.system===L.system && (L.kind==="surface" ? pl.body===L.body : (L.type!=="jump" || !pl.body));
    const unplacedBox = L.unplaced ? `<div class="unknown" style="margin:8px 0">Quantum doesn't know where this station is yet: no published data has its position${L.near?` (it's near ${esc(L.near)})`:""}.
      Dock here, type /showlocation in game chat, then press <b>I'm here: set position</b>. It goes on the map and into your routes from then on.</div>` : "";
    d.innerHTML=`${placePicHtml(placePicKey(sel))}<button class="close" aria-label="Close">×</button><h2>${esc(L.name)}</h2>
      <div class="sub"><span class="ty ${L.source==="user"?"wp":L.source==="mission"?"mission":L.type}"></span>${L.source==="user"?"Your waypoint":L.source==="mission"?"Contract stop":esc(TYPES[L.type]?.one||"Place")}${L.body?" on "+esc(L.body):" in "+esc(L.system)}${(()=>{ const lt=localTime(L,t); return lt?`<span class="lt-chip" data-lt-chip title="Local time there">${ltChip(lt)}</span>`:""; })()}</div>
      ${unplacedBox}<div id="d-svc">${L.amen?servicesHtml(S.svcCache[L.name]||null,L.name):""}</div>
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
        ${ll?`<span class="k">Lat, lon</span><span>${ll}</span>`:""}${L.qt?`<span class="k">Quantum</span><span>Has a QT marker</span>`:""}
        ${L.verify?`<span class="k">Position</span><span style="color:#f2c14e">Not confirmed in game yet${L.placeable?`: ${L.type==="jump"?"stop at the jump point":"dock here"}, type /showlocation and press <b>I'm here: set position</b>, or take the job in Datarunner &gt; Jobs`:""}</span>`:""}
        ${L.unplaced||L.type==="jump"?(L.type==="jump"?`<span class="k">Notes</span><textarea id="d-notes" rows="1" placeholder="Add a note">${esc(L.notes)}</textarea>`:""):`<span class="k">Landing pad</span><span>${(()=>{
            // Already known (your own pick, Quantum users agreeing, or the game's data): just say it, with a way
            // to report it if it's wrong. The picker only shows when nothing's known, or once you ask to correct it.
            const known=L.pad!=="unknown"?[L.pad,"your report"]:L.pad_shared?[L.pad_shared,"agreed by Quantum users"]:L.pad_auto?[L.pad_auto,"from the game's data"]:null;
            if(!known||L.source==="user"||S.padFix===L.name) return "";
            return `<b>${esc(padLabel(known[0]))}</b> <span class="muted" style="font-size:12px">(${known[1]})</span>
              <div style="font-size:12px;margin-top:3px"><a data-a="padfix" style="cursor:pointer;color:var(--route-2)">Wrong size? Report it</a></div></span><span hidden>`; })()}<select class="field" id="d-pad" title="The largest pad here">${PADS.map(p=>`<option value="${p}" ${p===L.pad?"selected":""}>${p==="unknown"?(L.pad_shared?`Unknown (Quantum users: ${padLabel(L.pad_shared)})`:L.pad_auto?`Unknown (game data: ${padLabel(L.pad_auto)})`:"Unknown"):padLabel(p)}</option>`).join("")}</select>
          <div class="muted" style="font-size:11.5px;margin-top:4px">${L.pad_shared?`Quantum users agree: <b>${esc(padLabel(L.pad_shared))}</b>.`:""}${L.source!=="user"?" Your pick is shared; it shows for everyone once another datarunner agrees.":""}</div></span>
        <span class="k">Notes</span><textarea id="d-notes" rows="1" placeholder="Add a note">${esc(L.notes)}</textarea>`}</div>
      ${L.unplaced?`<div class="acts"><button class="btn primary" data-a="placehere" ${readingHere?"":`disabled title="Needs a /showlocation taken at this station in the last 15 minutes"`}>I'm here: set position</button></div>`:
      `<div class="acts">${guiding?`<button class="btn" data-a="unguide">Stop guiding</button>`:`<button class="btn go" data-a="guide">Guide me</button>`}
        ${inRoute?`<button class="btn" data-a="route" title="Visit it again later in the trip">Add again</button><button class="btn" data-a="unroute">Remove from route</button>`:`<button class="btn primary" data-a="route">Add to route</button>`}
        <button class="btn" data-a="focus">Fly to</button>
        ${S.tradePlaces?.has(L.name)&&!(L.amen&&S.svcCache[L.name]?.amenities)?`<button class="btn${S.stock?.place===L.name?" primary":""}" data-a="stock" title="What the commodity terminals here buy and sell, and how recent the prices are">Commodities</button>`:""}
        ${city3dFor(L.name)?`<button class="btn" data-a="city3d" title="Fly down into ${esc(city3dFor(L.name).titleFor?.(L.name)||L.name)} in 3D">3D city</button>`:""}
        ${canCal?`<button class="btn ghost" data-a="calibrate" title="Use this if the map puts you in the wrong spot while you're standing here">I'm here: calibrate</button>`:""}
        ${L.placeable&&readingHere?`<button class="btn ghost" data-a="placehere" title="Use your last /showlocation as this station's position">I'm here: set position</button>`:""}
        ${user?`<button class="btn ghost" data-a="delete" style="color:var(--danger)">Delete</button>`:""}</div>`}
      ${L.fixable&&!user&&!L.unplaced?`<details class="fixpos"><summary>${L.fixed?`<span style="color:#9fe0b4">Position corrected by ${L.fixed==="mine"?"you":"Quantum datarunners"}</span> · `:""}Wrong spot on the map?</summary>
        <div class="muted" style="font-size:12.5px;line-height:1.5;margin:6px 0 8px">Go to ${esc(L.name)} (${L.kind==="surface"?"land or stand right at it":"dock there"}), type <b>/showlocation</b> in game chat and press <b>Send the right position</b>.
          It moves on your map straight away, and for every Quantum user once another datarunner's reading agrees. Trusted datarunners' corrections count at once.</div>
        <button class="btn small primary" data-a="fixpos" ${readingHere?"":`disabled title="Needs a /showlocation taken here in the last 15 minutes"`}>Send the right position</button></details>`:""}`;
    if(L.amen&&!(L.name in S.svcCache)) fillServices(L.name);
    loadTradePlaces(); loadShopPlaces();
    if(!L.unplaced){
      if($("d-pad")) $("d-pad").onchange=e=>{ api().update_location(L.name,e.target.value,null); L.pad=e.target.value;
        toast(e.target.value==="unknown"?`Pad size for ${L.name} cleared`:`Pad size ${padLabel(e.target.value)} saved. It shows for everyone once another datarunner agrees`); };
      $("d-notes").onchange=e=>{ api().update_location(L.name,null,e.target.value); L.notes=e.target.value; }; }
  }
  d.classList.add("show");
  if(sel.kind==="body"||sel.kind==="loc") fillPlacePic(sel);
  if(sel.kind==="settings") fillUexStatus(false);
  d.onclick=async e=>{ const u=e.target.closest("[data-url]"); if(u){ api().open_url(u.dataset.url); return; }
    const dm=e.target.closest("[data-desc]"); if(dm){ S.descOpen=S.descOpen||new Set();
      if(dm.dataset.desc==="more") S.descOpen.add(sel.name); else S.descOpen.delete(sel.name);
      const el=$("d-svc"); if(el) el.innerHTML=servicesHtml(S.svcCache[sel.name],sel.name); return; }
    if(e.target.closest("[data-stock]")) return toggleStock(sel.name);
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
    if(a==="stock") return toggleStock(sel.name);
    if(a==="guide"){ await api().set_guide(sel.name); await poll(); renderDetail(); showRoute(); setFollow(true); followNow(); toast(`Guiding you to ${sel.name}`); }
    if(a==="unguide"){ await api().set_guide(null); await poll(); renderDetail(); }
    if(a==="placehere"){ const r=await api().set_place_here(sel.name); if(!r.ok) return toast(r.error); await loadStatic(); await poll();
      select({kind:"loc",name:sel.name}); focusLoc(sel.name,true); toast(`${sel.name} is on the map now`); return; }
    if(a==="fixpos"){ e.target.disabled=true; e.target.textContent="Sending…"; const n=sel.name, r=await api().report_position(n);
      if(!r.ok){ e.target.disabled=false; e.target.textContent="Send the right position"; return toast(r.error); }
      await loadStatic(); await poll(); select({kind:"loc",name:n}); focusLoc(n,true);
      toast(`${n} moved ${r.moved_km<1?Math.round(r.moved_km*1000)+" m":r.moved_km.toFixed(1)+" km"} on your map. Sending it to Quantum…`);
      for(let k=0;k<40;k++){ await new Promise(res=>setTimeout(res,750)); const pr=await api().place_result(n);
        if(pr.state==="done"){ toast(pr.shared?`${n}: live for every Quantum user now`:`${n}: sent. It goes live for everyone once another datarunner's reading agrees`); break; }
        if(pr.state==="queued"||pr.state==="error"){ toast(`${n}: the Quantum server couldn't take it yet. Quantum sends it again later`); break; } }
      return; }
    if(a==="calibrate"){ const r=await api().calibrate_at(sel.name); if(!r.ok) return toast(r.error); await poll(); toast(`${S.locMap[sel.name].body} calibrated (${r.correction.toFixed(2)}° correction)`); }
    if(a==="delete"){ if(confirm(`Delete ${sel.name}?`)){ await api().delete_location(sel.name); select(null); await poll(); } }
    if(a==="mguide"){ const r=await api().guide_objective(sel.m.c.id,sel.m.o.id); if(!r.ok) return toast(r.error); await poll(); select({kind:"loc",name:r.name}); showRoute(); toast(`Guiding you to ${r.name}`); }
    if(a==="mroute"){ const r=await api().add_contract_stops(sel.m.c.id,sel.m.o.id); if(!r.ok) return toast(r.error); await poll(); showRoute(); toast("Added to route"); fitRoute(false); } };
}

// =================================================================== HUD (guidance + next stop)
function compass(deg){ return `<svg class="compass" viewBox="-22 -22 44 44" aria-label="heading ${Math.round(deg)} degrees"><circle r="20" fill="none" stroke="#2c3f63" stroke-width="1.5"/>
  <text y="-12" text-anchor="middle" font-size="7" fill="#7684a0" font-family="Exo 2">N</text>
  <g transform="rotate(${deg})"><path d="M0,-15 L6,6 L0,2 L-6,6 Z" fill="#7fe7ff"/></g></svg>`; }
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
      <div class="nm">${esc(g.name)}</div>${nums}${(ap||direct)?`<div class="approach"><div class="muted" style="font-size:12px">Fastest way there</div>${faster||direct}${ap}</div>`:""}</div>`; }
  const here=live.travel?.state==="landed"&&live.travel?.place===n?.name;
  const gate=(live.stop_roles?.[0]||[]).find(r=>r.kind==="gate");
  if(n){ html+=`<div class="card next"><div class="lbl">Next stop${live.route.length>1?` · 1 of ${live.route.length}`:""}${here?' <span style="color:var(--ok);font-weight:600">· You\'re here</span>':""}</div><div class="nm">${esc(n.name)}</div>
    ${gate?`<div class="hint">Quantum to the gateway, then fly into the jump point to reach ${esc(gate.to||"the next system")}.</div>`:""}
    ${n.other_system?`<div class="hint">It's in ${esc(n.system)}. Jump there first.</div>`:n.distance!=null?`<div class="nums"><div><div class="v">${fmtDist(n.distance)}</div><div class="k">straight line</div></div>
      ${n.pad&&n.pad!=="unknown"?`<div><div class="v" style="color:var(--ink)">${esc(padLabel(n.pad))}</div><div class="k">pad</div></div>`:""}</div>`
      :`<div class="hint">Type /showlocation in game chat to see the distance.</div>`}</div>`; }
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
  $("hud").innerHTML=html; const st=$("hud-stop"); if(st) st.onclick=async()=>{ await api().set_guide(null); await poll(); };
  const oc=$("hud-ov-close"); if(oc) oc.onclick=()=>{ S.overview=null; renderHud(); };
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
  $("so-panel").classList.toggle("show",S.tab==="friends"); if(S.tab==="friends") openSocial();
  if(S.tab==="friendmap") openFriendMap();                     // no panel over the map: the map is the Friend Map
  $("pm-panel").classList.toggle("show",S.tab.startsWith("pm-")); if(S.tab.startsWith("pm-")) openPm(S.tab);
  $("og-panel").classList.toggle("show",S.tab==="orgs"); if(S.tab==="orgs") openOrg();
  $("ph-panel").classList.toggle("show",S.tab==="patchhub"); if(S.tab==="patchhub") openPatchHub();
  $("dr-panel").classList.toggle("show",S.tab==="datarunner"); $("dr-view").classList.remove("show"); if(S.tab==="datarunner") openDatarunner();
  if(S.tab==="market") openMarket(); if(S.tab==="trade"){ openTrade(); if(S.trView==="mine") renderRuns(); } if(S.tab==="vehicles") openVehicles(); };

// ---- the rail: one button per section; each section's own tabs show as pills under its title
const GROUPS={navigate:{t:"Home",tabs:["route","waypoints","contracts"]},trade:{t:"Trade",tabs:["market","trade"]},data:{t:"Datarunner",tabs:["datarunner"]},
  ships:{t:"Ships",tabs:["fleet","components","vehicles","ccu"]},gear:{t:"Gear",tabs:["weapons","armor","clothing","gadgets","gearlo"]},
  consumables:{t:"Consumables",tabs:["consumables","utility"]},crafting:{t:"Blueprints",tabs:["blueprints"]},cart:{t:"Cart",tabs:["shopping"]},exchange:{t:"Market",tabs:["pm-items","pm-services","pm-mine","pm-standing"]},org:{t:"Org",tabs:["orgs"]},social:{t:"Social",tabs:["friends","friendmap"]},patch:{t:"Patch Hub",tabs:["patchhub"]},profile:{t:"Profile",tabs:["profile"]}};
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
