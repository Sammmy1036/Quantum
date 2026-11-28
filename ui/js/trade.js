// Quantum UI: UEX trade data: commodities, price alerts, trade routes, ships and components.
// One of several classic scripts sharing one global scope; index.html loads them in order.
"use strict";
// =================================================================== trade data (UEX)
const money=n=>n==null?"–":`${Math.round(n).toLocaleString()} aUEC`;
const shortMoney=n=>Math.abs(n)>=1e6?`${(n/1e6).toFixed(2)}M`:Math.abs(n)>=1e4?`${Math.round(n/1e3)}k`:Math.round(n).toLocaleString();
// A report time as seconds since 1970; some feeds give milliseconds or a date string instead (that was "NaN d ago").
const tsSec=ts=>{ if(ts==null||ts==="") return null; let n=typeof ts==="number"?ts:Number(ts); if(!Number.isFinite(n)){ n=Date.parse(ts)/1000; }
  if(!Number.isFinite(n)||n<=0) return null; return n>1e12?n/1000:n; };
const agoTs=ts=>{ ts=tsSec(ts); if(!ts) return ""; const a=Math.max(0,Date.now()/1000-ts); return a<3600?`${Math.max(1,Math.round(a/60))} min ago`:a<172800?`${Math.round(a/3600)} h ago`:`${Math.round(a/86400)} d ago`; };
const uexCredit=at=>`<div class="uex-credit">Prices are reported by players at <a data-ext="https://uexcorp.space">UEX</a> and can be off; check the terminal before you buy.${at?` Fetched ${agoTs(at)}.`:""}</div>`;
const needToken=`<div class="empty"><strong>Connect UEX first</strong>Add your free UEX access token in your profile to see prices and trade runs.<br><br><button class="btn small" data-act="opensettings">Open your profile</button></div>`;
// Status is fetched when Settings opens or the token changes, not on every refresh of the panel.
async function fillUexStatus(refresh){ const el=$("uex-status"); if(!el) return;
  if(refresh||!S.uexStat){ if(S.uexBusy) return; S.uexBusy=true;
    try{ S.uexStat=await api().uex_status(); } finally{ S.uexBusy=false; } }
  const r=S.uexStat; if(!$("uex-status")||!r) return;
  { const pill=document.querySelector('label[for="s-uex"] .conn');                // the Connected beside the label, once it's known
    if(r.token&&pill&&!pill.classList.contains(r.ok?"ok":"bad")) return renderDetail(); }
  $("uex-status").innerHTML=!r.token?"":!r.ok?`<span class="st-bad">${esc(r.error)}</span>`:`${r.unmatched.length?`<details style="margin-top:4px" ${S.uexListOpen?"open":""} ontoggle="S.uexListOpen=this.open"><summary style="cursor:pointer">Not on the map (${r.unmatched.length})</summary>${r.unmatched.map(esc).join(", ")}<div style="margin-top:4px">UEX lists trade terminals here, but Quantum can't match them to a place. If one isn't in the game, mark it "Doesn't exist" in Jobs.</div></details>`:""}`; }
// A place just added to the route: every + for it turns into a tick, and the Route tab's count pulses
function markAdded(name){ for(const b of document.querySelectorAll("[data-add]")) if(b.dataset.add===name){ b.classList.add("added"); b.textContent="✓"; b.title="In your route"; }
  const c=$("c-route"); if(c){ c.classList.remove("pulse"); void c.offsetWidth; c.classList.add("pulse"); } }
// Shared clicks in both tabs: open a place, add it to the route, open UEX, open Settings.
async function tradeClick(e){
  const op=e.target.closest("[data-open]"); if(op){ select({kind:"loc",name:op.dataset.open}); focusLoc(op.dataset.open,false); return true; }
  const ad=e.target.closest("[data-add]"); if(ad){ const name=ad.dataset.add, had=S.live?.route?.includes(name);
    const r=await api().add_stops([name],true); await poll(); markAdded(name); const n=S.live?.route?.length||1;
    toast(!r?.added?.length?`${name} is already the last stop`:`Added ${name} to your route${had?" again":""} (stop ${n} of ${n})`); return true; }
  const ex=e.target.closest("[data-ext]"); if(ex){ api().open_url(ex.dataset.ext); return true; }
  if(e.target.closest("[data-act=opensettings]")){ openProfileView("accounts"); return true; }
  return false; }
// ---- Commodities: where to buy and sell one commodity
async function openMarket(){
  if(!S.live?.log?.uex_token){ $("mk-out").innerHTML=needToken; $("mk-watch").innerHTML=""; return; }
  paLoad().then(syncWatchCount).catch(()=>{});
  if(!S.mk){ const r=await api().uex_commodities(); if(!r.ok){ $("mk-out").innerHTML=`<div class="empty">${esc(r.error)}</div>`; return; }
    S.mk=r.items; S.mkByName=Object.fromEntries(r.items.map(c=>[c.name.toLowerCase(),c]));
    $("mk-dl").innerHTML=r.items.map(c=>`<option value="${esc(c.name)}">${esc(c.kind||"")}${c.illegal?" · illegal":""}</option>`).join(""); }
  if(!S.mkSel){ $("mk-out").innerHTML=`<div class="empty"><strong>Pick a commodity</strong>Click one in the grid or search above to see where it's cheapest to buy and where it sells best.</div>`; renderMarketGrid(); }
  else renderMarket(); }
// All commodities as pictures in place of the map; the search box narrows them.
async function renderMarketGrid(){
  const q=$("mk-search").value.trim().toLowerCase(), L=(S.mk||[]).filter(c=>!q||`${c.name} ${c.kind||""}`.toLowerCase().includes(q));
  // Raw resources (ores, gems, harvestables) are commodities to UEX (their prices are reported like any
  // other), but they're gathered rather than bought, so they get their own section below the rest.
  const tile=c=>`<div class="vg" data-mkc="${c.id}"><div class="ph ph-g" data-pic="${esc(c.wiki||c.name)}">${phCard("commodity")}</div>
      <div class="tx"><b>${esc(c.name)}</b><span>${esc(c.kind||"")}${c.illegal?' · <span style="color:#ffb454">illegal</span>':""}${c.sell?` · sells ~${shortMoney(c.sell)}/SCU`:""}</span></div></div>`;
  const raw=L.filter(c=>c.raw), traded=L.filter(c=>!c.raw);
  $("mk-panel").innerHTML=`<div class="gh"><b>Commodities</b>${traded.length} · click one for prices and where to trade it</div>
    <div class="grid">${traded.map(tile).join("")}</div>
    ${raw.length?`<div class="gh" style="margin-top:22px"><b>Raw resources</b>${raw.length} · ores, gems and harvestables: where to find them and how to gather them</div><div class="grid">${raw.map(tile).join("")}</div>`:""}`;
  S.mkData=null; syncMarketPanel(); fillPictures($("mk-panel"));
  // Back from a commodity: the grid where you left it (same search), like the Vehicles tab
  if(S.mkBack){ if(S.mkBack.q===q) $("mk-panel").scrollTop=S.mkBack.top; S.mkBack=null; } }
// A picture was approved on the Quantum server: put it in wherever "No picture yet" is showing, and
// reload the vehicle list (its pictures come with it), so nothing needs a restart.
async function refreshPictures(){
  if(S.pics) for(const k in S.pics) if(!S.pics[k]) delete S.pics[k];
  S.veh=null; S.vehGalKey=null; S.cpGalKey=null; S.drPhotoJobs=null; S.drExtra=null;
  fillPictures(document.body);
  for(const b of document.querySelectorAll(".pic-none [data-photosend]")){ const box=b.closest(".pic-none");
    const u=await api().wiki_image(b.dataset.photoname).catch(()=>null);
    if(u&&box.isConnected) box.replaceWith(Object.assign(document.createElement("img"),{src:u,alt:"",referrerPolicy:"no-referrer"})); }
  if(S.tab==="vehicles") openVehicles(); else if(S.tab==="fleet") renderFleet();
  else if(S.tab==="datarunner"&&S.dr?.view==="jobs") renderDrJobs(); }
// Pictures from the Star Citizen Wiki, many per request, filled in when they arrive.
async function fillPictures(root){ const els=[...root.querySelectorAll("[data-pic]")]; if(!els.length) return;
  S.pics=S.pics||{}; const need=[...new Set(els.map(e=>e.dataset.pic))].filter(r=>!(r in S.pics));
  for(let i=0;i<need.length;i+=50){ const got=await api().wiki_images(need.slice(i,i+50)); Object.assign(S.pics,got); paint(); }
  function paint(){ for(const e of els){ const u=S.pics[e.dataset.pic]; if(u&&!e.querySelector("img")) e.innerHTML=`<img src="${esc(u)}" alt="" loading="lazy" referrerpolicy="no-referrer">`; } }
  paint(); }
async function renderMarket(){
  const c=S.mkSel, sys=$("mk-sys").value; if(S.mkData?.c!==c){ S.mkMap=false; S.mapMarks=null; $("mk-out").innerHTML=`<div class="muted" style="margin-top:10px">Loading ${esc(c.name)}…</div>`; }
  const r=await api().uex_market(c.id); if(S.mkSel!==c) return;
  if(!r.ok){ $("mk-out").innerHTML=`<div class="empty">${esc(r.error)}</div>`; return; }
  const rows=(list,kind)=>{ const L=list.filter(x=>!sys||x.system===sys);
    if(!L.length) return `<div class="muted" style="font-size:13px;margin:0 2px 8px">${kind==="buy"?"Nowhere sells it":"Nowhere buys it"}${sys?` in ${esc(sys)}`:""}.</div>`;
    return L.slice(0,25).map((x,i)=>`<div class="mk-row"><div class="w">${x.place?`<a data-open="${esc(x.place)}">${esc(x.where)}</a>`:esc(x.where)}</div>
      <div class="p ${i===0?"best":""}">${money(x.price)}</div>
      ${x.place?(S.live?.route?.includes(x.place)?`<button class="iconbtn added" data-add="${esc(x.place)}" title="In your route">✓</button>`:`<button class="iconbtn" data-add="${esc(x.place)}" title="Add to route">+</button>`):`<span></span>`}
      <div class="m">${shopTag(x,kind==="buy"?"The terminal that sells it here":"The terminal that buys it here")}${esc(x.system||"")}${x.scu?` · ${kind==="buy"?"stock":"demand"} ${x.scu.toLocaleString()} SCU`:""}${x.dist!=null?` · ${fmtDist(x.dist)} away`:""}${x.max_box?` · boxes up to ${x.max_box} SCU`:""}${x.community?` · <span class="cm-pill" title="Reported by a Quantum datarunner and checked against UEX's copy of the report. UEX hasn't finished reviewing it yet.">⚡ ${agoTs(x.community.at)}, awaiting UEX review</span>`:x.updated?` · ${agoTs(x.updated)}`:""}</div></div>`).join(""); };
  const spread=r.buy.length&&r.sell.length?r.sell[0].price-r.buy[0].price:null;
  if(!mkOnMap(r,sys)&&S.mkMap&&S.mkMap!=="src"){ S.mkMap=false; S.mapMarks=null; }     // nothing left to mark (another system picked)
  $("mk-out").innerHTML=`<div class="muted" style="font-size:12px;margin:10px 2px 0">${esc(c.kind||"")}${c.illegal?' · <span style="color:#ffb454">illegal</span>':""}${spread!=null?` · best spread ${money(spread)}/SCU`:""}</div>
    ${mkOnMap(r,sys)||S.mkMap==="src"?`<div class="row" style="gap:6px;margin:10px 0 2px"><button class="btn small" data-act="mkmap">${S.mkMap?"Back to details":"Terminals on map"}</button></div>`:""}
    <div class="mk-h">Buy at <span class="muted" style="text-transform:none;letter-spacing:0">cheapest first, per SCU</span></div>${rows(r.buy,"buy")}
    <div class="mk-h">Sell at <span class="muted" style="text-transform:none;letter-spacing:0">best price first, per SCU</span></div>${rows(r.sell,"sell")}${uexCredit(r.at)}`;
  S.mkData={c,r,rows}; renderMarketPanel(); }
// The commodity in place of the map: its picture, prices at a glance, and where to buy and sell it.
// "Terminals on map" swaps back to the map with every place that trades it marked; "Deposits on map", in Where
// to find it below the prices, marks where it's mined or harvested instead.
async function renderMarketPanel(){
  const d=S.mkData; if(!d) return syncMarketPanel(); const {c,r,rows}=d;
  const avg=(L,k)=>L.length?L.reduce((a,x)=>a+(x[k]||x.price),0)/L.length:null;
  // A raw resource (an ore, a gem, something harvested) is about where to find it and how to gather it:
  // that comes first. A processed commodity is about trading: buy and sell first, where it comes from after.
  const rawFirst=!!(c.raw||(c.harvestable&&!r.buy.length)||(c.mineral&&!r.buy.length&&!r.sell.length));
  $("mk-panel").innerHTML=`<div class="row" style="gap:8px;margin-bottom:14px">${typeof bpBackBtn==="function"?bpBackBtn("market"):""}<button class="btn" data-act="mkall">← All commodities</button></div>
    <div class="mkp-head"><div class="mkp-img" id="mkp-img">${qPic()}</div>
    <div class="hd-main"><div class="hd-title"><div><h2>${esc(c.name)}</h2><div class="sub">${esc(c.kind||"Commodity")}${c.raw?" · raw":""}${c.mineral?" · mineral":""}${c.harvestable?" · harvestable":""}${c.illegal?' · <span style="color:#ffb454">illegal</span>':""}${c.volatile?" · volatile in quantum":""}</div></div></div>
      ${(()=>{ const sp=r.buy[0]&&r.sell[0]?r.sell[0].price-r.buy[0].price:null, ab=avg(r.buy,"price"), av=avg(r.sell,"price");
        return statBlock([{label:"Cheapest buy",value:r.buy[0]?money(r.buy[0].price):"Not sold"},{label:"Best sell",value:r.sell[0]?money(r.sell[0].price):"Not bought"},
            {label:"Best spread",value:sp!=null?`${sp>0?"+":""}${money(sp)}`:"–",tone:sp>0?"good":sp<0?"bad":""}],
          [{label:"Sold at",value:plural(r.buy.length,"terminal")},{label:"Bought at",value:plural(r.sell.length,"terminal")},
           {label:"Average buy",value:ab!=null?money(ab):null},{label:"Average sell",value:av!=null?money(av):null}]); })()}
      <div class="desc" id="mkp-desc" style="margin-top:12px"></div>
      <div class="row" style="gap:8px">${mkOnMap(r,$("mk-sys").value)?`<button class="btn primary" data-act="mkmap" title="Every terminal that buys or sells it, marked on the map">Terminals on map</button>`:""}${r.buy.length||r.sell.length?`<button class="btn ghost" data-act="mkwatch" title="Get told when a terminal's price for it gets low or high enough">🔔 Price alert</button>`:""}${c.wiki?`<button class="btn ghost" data-ext="${esc(c.wiki)}">Wiki</button>`:""}</div>
      <div id="mkp-alert"></div></div></div>
    ${rawFirst?`<section id="mkp-src" class="src-sec raw" hidden></section>`:""}
    ${rawFirst&&!r.buy.length&&!r.sell.length?`<div class="muted" style="font-size:12.5px;margin:14px 2px 0">No terminal buys or sells it as it is: ${c.raw?"refine it first, or sell the refined commodity":"it isn't traded at terminals"}.</div>`
    :`<div class="mkp-cols vd-flat"${rawFirst?' style="margin-top:22px"':""}><div class="vd-sec"><div class="mk-h">Buy at <span class="mk-note">cheapest first, per SCU</span></div>${rows(r.buy,"buy")}</div>
      <div class="vd-sec"><div class="mk-h">Sell at <span class="mk-note">best price first, per SCU</span></div>${rows(r.sell,"sell")}</div></div>`}${uexCredit(r.at)}
    ${rawFirst?"":`<section id="mkp-src" class="src-sec" hidden></section>`}`;
  syncMarketPanel(); mkAlertRender(); paLoad().then(()=>{ syncWatchCount(); if(S.mkData?.c===c) mkAlertRender(); }).catch(()=>{});
  api().known_sources(c.name).then(k=>{ if(!k?.notes?.length||S.mkData?.c!==c) return; const el=$("mkp-desc"); if(!el) return;
    el.insertAdjacentHTML("afterend",`<div class="known-src" style="margin:10px 0 4px">${knownSourcesHtml(k.notes)}</div>`); }).catch(()=>{});
  api().wiki_text(c.wiki||c.name).then(t=>{ const el=$("mkp-desc"); if(el&&S.mkData?.c===c&&t) el.innerHTML=wikiDesc(t,c.wiki); });
  mkSources(c);
  const img=await api().wiki_image(c.wiki||c.name); if(S.mkData?.c!==c) return;
  const box=$("mkp-img"); if(box) box.innerHTML=picShown(img,"commodity",c.wiki||c.name); }
// Where a mined or harvested commodity comes from (the Star Citizen Wiki's resource data), under its
// description: each place with how it's gathered and how likely, one click to add it to the route (a moon
// or planet by its orbital marker), and "Show on map" to mark them all.
const MK_METHOD_COLOR={"Ship mining":"#7fd3ff","ROC mining":"#ffb454","Hand mining":"#57e39b","Harvesting":"#c99bff","Salvage":"#ff9b8a"};
// What each way of gathering takes. "role"/"ground": which vehicles do it (UEX's roles), listed from the
// vehicles Quantum knows; kinds: the planets' wiki lists that say what's found that way.
const GATHER={
  "Ship mining":{kinds:["ship"],role:"Mining",ground:false,
    how:"A mining ship: its mining laser fractures the rock and extracts the ore into its ore hold. Refine it at a refinery station before you sell most ores."},
  "ROC mining":{kinds:["roc","hand"],role:"Mining",ground:true,
    how:"A Greycat ROC or ROC-DS: drive up to gem deposits on the ground and mine them with its arm. It takes the same small deposits you can mine by hand, more of them at a time."},
  "Hand mining":{kinds:["hand"],
    how:"On foot with a multi-tool and its OreBit mining attachment (or the Greycat Pyro RYT). Gems go in your backpack or a container; mining gadgets help with tough rocks."},
  "Harvesting":{kinds:["harvest"],
    how:"By hand: walk up to it and pick it up. Nothing is needed but space in your backpack. Some only grow in caves."},
  "Salvage":{role:"Salvage",ground:false,
    how:"A salvage ship: scraper heads strip hull plating into Recycled Material Composite (RMC), and structural salvage breaks wrecks into Construction Materials. The Cambio SRT does small amounts on foot."}};
// The wiki's body names -> Quantum's ("Pyro IV" is Pyro4 on the map)
function wikiBodyName(n){ if(S.bodyMap[n]) return n; const R={I:1,II:2,III:3,IV:4,V:5,VI:6}, m=String(n).match(/^(.+?)\s+([IV]+)$/);
  if(m&&R[m[2]]&&S.bodyMap[m[1]+R[m[2]]]) return m[1]+R[m[2]]; return Object.keys(S.bodyMap).find(k=>squash(k)===squash(n))||n; }
async function resCatalog(){ if(S.resCat) return S.resCat; try{ const r=await api().resource_catalog(); if(r.ok) S.resCat=r.kinds; }catch(_){} return S.resCat||{}; }
const resKey=n=>squash(String(n||"").replace(/\s*\((ore|raw|gem|refined)\)\s*$/i,""));
// Which ways a resource is gathered, from the planets' lists (when the wiki's resource data has none)
function gatherOf(cat,name){ const k=resKey(name), out=[];
  for(const [m,g] of Object.entries(GATHER)) if((g.kinds||[]).some(kd=>Object.keys(cat[kd]||{}).some(n=>squash(n)===k))) out.push(m);
  return out; }
function gatherVehicles(m){ const g=GATHER[m]; if(!g?.role) return [];
  return (S.veh||[]).filter(v=>v.roles?.includes(g.role)&&!!v.ground===!!g.ground&&!v.concept&&!v.addon); }
function gatherHtml(methods){ if(!methods.length) return "";
  return `<div class="gather">${methods.map(m=>{ const g=GATHER[m], vs=gatherVehicles(m);
    return `<div class="gather-card" style="--c:${MK_METHOD_COLOR[m]||"var(--route-2)"}"><div class="gather-h"><i></i>${esc(m)}</div>
      <div class="gather-t">${esc(g?.how||"")}</div>
      ${vs.length?`<div class="gather-v">${vs.slice(0,10).map(v=>`<a data-vhopen="${esc(String(v.id))}" title="Open ${esc(v.full)}">${esc(v.full)}</a>`).join("")}</div>`:""}</div>`; }).join("")}</div>`; }
// Open a vehicle's page from anywhere
document.addEventListener("click",e=>{ const a=e.target.closest("[data-vhopen]"); if(!a) return; const id=a.dataset.vhopen;
  document.querySelector('.tab[data-tab="vehicles"]')?.click();
  setTimeout(async()=>{ for(let k=0;k<40&&!S.veh;k++) await new Promise(r=>setTimeout(r,250)); if(!S.veh) return; S.vehDetail=String(id); renderVehicles(); },80); });
// Open a commodity's page from anywhere (a resource a ship can mine, say)
document.addEventListener("click",e=>{ const a=e.target.closest("[data-mkopen]"); if(a) mkOpen(a.dataset.mkopen); });
// Opens Trade › Commodities on a commodity by name ("Agricium", "Quantanium (Raw)"): true when UEX lists it
async function mkOpen(name){ const k=resKey(name);
  document.querySelector('.tab[data-tab="market"]')?.click();
  for(let i=0;i<40&&!S.mk;i++) await new Promise(r=>setTimeout(r,250)); if(!S.mk) return false;
  const c=S.mk.find(x=>resKey(x.name)===k)||S.mk.find(x=>squash(x.name).startsWith(k)); if(!c){ toast(`${name} isn't in UEX's commodity list`); return false; }
  $("mk-search").value=c.name; S.mkSel=c; $("mk-panel").scrollTop=0; renderMarket(); return true; }
async function mkSources(c){
  const box=()=>S.mkData?.c===c?$("mkp-src"):null;
  if(!S.mkSrc) S.mkSrc={};
  let r=S.mkSrc[c.name];
  const minable=c.raw||c.mineral||c.harvestable;
  if(!r){
    if(box()&&minable){ box().hidden=false; box().innerHTML=`<div class="src-head"><div><div class="mk-h" style="margin:0">Where to find it</div><div class="src-sub">Looking it up on the Star Citizen Wiki…</div></div></div>`; }
    try{ r=await api().commodity_sources(c.name); }catch(e){ r={ok:false}; }
    if(r.ok) S.mkSrc[c.name]=r; }
  const el=box(); if(!el) return;
  if(!r.ok||!r.found){ const cat=await resCatalog(), how=gatherOf(cat,c.name); if(how.length) await trLoadVehicles(); if(!box()) return;
    const bodies=[...new Map(Object.values(cat).flatMap(o=>Object.entries(o).filter(([n])=>squash(n)===resKey(c.name)).flatMap(([,L])=>L)).map(b=>[b.body,b])).values()];
    el.hidden=!(how.length||(minable&&!r.ok));
    el.innerHTML=el.hidden?"":`${how.length?`<div class="mk-h" style="margin:0 0 8px">How to get it</div>${gatherHtml(how)}`:""}
      <div class="src-head" style="${how.length?"margin-top:18px":""}"><div><div class="mk-h" style="margin:0">Where to find it</div><div class="src-sub">${r.ok?"From the planets' and moons' pages on the Star Citizen Wiki.":"Couldn't reach the Star Citizen Wiki just now."}</div></div></div>
      ${bodies.length?`<div class="mk-h" style="margin:8px 0 8px">Where</div><div class="src-grid">${bodies.map(b=>{ const bn=wikiBodyName(b.body), om=`OM-1 (${bn})`; return `<div class="src-card"><div class="src-top"><div class="src-nm">${S.bodyMap[bn]?`<a data-showbody="${esc(bn)}">${esc(b.body)}</a>`:esc(b.body)}</div>
        ${S.locMap[om]?`<button class="iconbtn ${S.live?.route?.includes(om)?"added":""}" data-add="${esc(om)}" title="Add ${esc(b.body)} to your route">+</button>`:""}</div>
        <div class="src-meta">${esc(b.system)}${b.caves?" · in caves":""}</div></div>`; }).join("")}</div>`:""}`; return; }
  const t=now()+(S.timeShift||0);
  // how far each place is from you (its own spot, or the planet's surface), so the list can go nearest first
  // A Lagrange point is folded into the station built there (no QT marker of its own): the card's name opens the
  // L-point (the field itself, on the map), while + and the distance use the station you quantum to
  for(const x of r.sources){ const m=x.place&&!x.via&&S.locMap[x.place]?.mergedInto; if(m&&S.locMap[m]){ x.lp=x.place; x.via=m; x.place=m; } }
  for(const x of r.sources){ const Lc=x.place&&S.locMap[x.place], B=x.body&&S.bodyMap[x.body];
    let d=null; try{ d=Lc?.pos?distFromYou(globalPos(Lc,t),Lc.system):B?((v=>v==null?null:Math.max(0,v-B.radius))(distFromYou(B.center,B.system))):null; }catch(_){ d=null; }
    x.dist=d; }
  const canNear=r.sources.some(x=>x.dist!=null), sort=canNear?(S.mkSrcSort||"near"):"odds";
  const all=[...r.sources].sort(sort==="near"?(a,b)=>(a.dist??9e15)-(b.dist??9e15)||(b.chance||0)-(a.chance||0):(a,b)=>(b.chance||0)-(a.chance||0)||a.name.localeCompare(b.name));
  const methods=[...new Set(all.flatMap(x=>x.methods||[]))], systems=[...new Set(all.map(x=>x.system).filter(Boolean))];
  const L=all.slice(0,S.mkSrcAll?300:12), top=Math.max(...all.map(x=>x.chance||0),0.0001);
  const qs=all.filter(x=>x.quality), qlo=qs.length?Math.min(...qs.map(x=>x.quality[0])):null, qhi=qs.length?Math.max(...qs.map(x=>x.quality[1])):null;
  const pct=x=>x.chance!=null&&x.chance>0?`${x.chance<0.01?"<1":Math.round(x.chance*100)}%`:"";
  const col=m=>MK_METHOD_COLOR[m]||"var(--route-2)";
  const card=x=>{ const m=(x.methods||[])[0], inRoute=x.place&&S.live?.route?.includes(x.place);
    return `<div class="src-card" style="--c:${col(m)}">
      <div class="src-top"><div class="src-nm">${x.place?`<a data-open="${esc(x.lp||x.place)}">${esc(x.display||x.name)}</a>`:esc(x.display||x.name)}</div>
        <b class="src-pct" title="How likely a deposit here is this">${pct(x)}</b>
        ${x.place?`<button class="iconbtn ${inRoute?"added":""}" data-add="${esc(x.place)}" title="${inRoute?"In your route":`Add ${esc(x.place)} to your route`}">${inRoute?"✓":"+"}</button>`:""}</div>
      <div class="src-bar" aria-hidden="true"><i style="width:${Math.max(3,Math.round((x.chance||0)/top*100))}%"></i></div>
      <div class="src-meta">${esc([x.type,x.parent&&x.parent!==x.system?`near ${x.parent}`:"",x.via?`QT to ${x.via}`:""].filter(Boolean).join(" · "))}${x.dist!=null?` · ${fmtDist(x.dist)} away`:""}
        ${x.body||x.place?`<a class="src-map" data-showbody="${esc(x.body||x.lp||x.place)}" title="Show it on the map">Map</a>`:""}</div>
      <div class="src-tags">${(x.methods||[]).map(mm=>`<span><i style="background:${col(mm)}"></i>${esc(mm)}</span>`).join("")}${x.quality?`<span>Quality ${x.quality[0]}–${x.quality[1]}</span>`:""}</div></div>`; };
  // grouped by system (yours first), nearest or most likely first inside each
  const groups=[]; for(const x of L){ const k=x.system||"Elsewhere"; let g=groups.find(g=>g.k===k); if(!g) groups.push(g={k,L:[]}); g.L.push(x); }
  groups.sort((a,b)=>(b.k===S.system)-(a.k===S.system));
  const cat=await resCatalog(), how=[...new Set([...methods,...gatherOf(cat,c.name)])]; await trLoadVehicles(); if(!box()) return;
  const counts=Object.fromEntries(systems.map(k=>[k,all.filter(x=>x.system===k).length]));
  el.hidden=false;
  // How to get it comes first (what to fly, how to gather it), then where: the list of places, its sort, the map
  // button and "All N places" sit together right above the places they act on, and a second "All N places"
  // follows the list, so the rest of the places are one click away wherever you've scrolled to.
  const more=all.length>12?`<button class="btn small ghost" data-act="mksrcall">${S.mkSrcAll?"Show fewer":`All ${all.length} places`}</button>`:"";
  el.innerHTML=`${how.length?`<div class="mk-h" style="margin:0 0 8px">How to get it</div>${gatherHtml(how)}`:""}
    <div class="src-head" style="${how.length?"margin-top:18px":""}"><div><div class="mk-h" style="margin:0">Where to find it</div>
      <div class="src-sub">${r.from?`Mined as <b>${esc(r.from)}</b> and refined into ${esc(c.name)}. `:""}From the Star Citizen Wiki's resource data.${canNear?"":" Press your /showlocation hotkey to see how far each place is from you."}</div></div>
      <div class="row" style="gap:8px">${canNear?`<div class="seg-mini"><button data-act="mksrcsort" data-v="near" class="${sort==="near"?"on":""}">Nearest</button><button data-act="mksrcsort" data-v="odds" class="${sort==="odds"?"on":""}">Best odds</button></div>`:""}
        ${all.some(x=>x.place||x.body)?`<button class="btn small primary" data-act="mksrcmap" title="Every place it's found, marked on the map">Deposits on map</button>`:""}
        ${more}</div></div>
    ${statBlock([{label:"Places",value:String(all.length)},{label:"Best odds",value:pct(all.reduce((a,x)=>(x.chance||0)>(a.chance||0)?x:a,all[0]))||"–"},
      {label:"Quality",value:qlo!=null?`${qlo}–${qhi}`:"–"}],[])}
    ${methods.length?`<div class="src-legend">${methods.map(m=>`<span><i style="background:${col(m)}"></i>${esc(m)}</span>`).join("")}</div>`:""}
    ${groups.map(g=>`<div class="src-sys">${esc(g.k)}<span>${S.mkSrcAll||all.length<=12?plural(counts[g.k]||g.L.length,"place"):`${g.L.length} of ${counts[g.k]||g.L.length} places`}</span></div><div class="src-grid">${g.L.map(card).join("")}</div>`).join("")}
    ${more?`<div class="row" style="justify-content:center;margin-top:12px">${more}</div>`:""}`; }
function mkSourceMap(){ const d=S.mkData, r=d&&S.mkSrc?.[d.c.name]; if(!r?.sources) return;
  const marks={}; for(const x of r.sources){ const n=x.body||x.lp||x.place; if(!n||marks[n]) continue;
    if(!S.locMap[n]&&!S.bodyMap[n]) continue;
    marks[n]={name:n,label:`${(x.methods||[]).join(", ")||"Found here"}${x.chance?` · ${Math.round(x.chance*100)}%`:""}`,color:MK_METHOD_COLOR[(x.methods||[])[0]]||"#7fd3ff"}; }
  const list=Object.values(marks); if(!list.length) return toast("None of these places are on Quantum's map yet");
  const sysOf=n=>S.locMap[n]?.system||S.bodyMap[n]?.system, here=list.some(m=>sysOf(m.name)===S.system)?S.system:sysOf(list[0].name);
  if(here&&here!==S.system) setSystem(here,false);
  S.mkMap="src"; S.mapMarks=list;
  fitRoute(true,list.filter(m=>sysOf(m.name)===here).map(m=>m.name));
  renderMarket(); }
function syncMarketPanel(){ const on=S.tab==="market";
  $("mk-panel").classList.toggle("show",on&&!S.mkMap&&!!S.mk); $("map-back").classList.toggle("show",on&&!!S.mkMap); }
// ---- Price alerts (Market › Price alerts): watch a commodity's price at every terminal and get told when one
// gets low or high enough. The app checks every few minutes (api_watch.py); alerts show here, as a note, and as a
// Windows notification. Its own names (S.pa, pa…): it used to share S.wl and wlLoad with the wish list, whose
// wlLoad (wishlist.js loads later) replaced this one, so the alerts box showed your wish list (ships and all) and
// its buttons acted on wish list entries: names that went nowhere, Resume and Check now doing nothing.
const PA_AGES=[[24,"1 day"],[72,"3 days"],[168,"7 days"],[0,"Any age"]];
function paLoad(force){ return qFetch("watch",()=>api().watch_list(),{ttl:30000,force}).then(x=>{ if(x?.ok) S.pa=x; return x; }); }
const paIsItem=w=>w?.kind==="item";
// Gear you can watch (UEX's item prices at shop terminals): loaded once when needed, for the search and the Gear pages
function paItemsLoad(){ if(S.paItems) return Promise.resolve(S.paItems); if(!S.live?.log?.uex_token) return Promise.resolve([]);
  return S.paItemsP||(S.paItemsP=api().watch_items().then(r=>{ S.paItemsP=null; if(!r?.ok) return []; S.paItems=r.items;
    S.paItemByName=Object.fromEntries(r.items.map(i=>[squash(i.name),i]));
    const dl=$("pa-items-dl"); if(dl) dl.innerHTML=r.items.map(i=>`<option value="${esc(i.name)}">${esc(PA_GROUP[i.group]||"Gear")}${i.sell?" · sellable":""}</option>`).join("");
    return r.items; }).catch(()=>{ S.paItemsP=null; return []; })); }
const PA_GROUP={weapons:"Weapon",armor:"Armor",clothing:"Clothing",gadgets:"Gadget",medical:"Medical",food:"Food and drink",other:"Gear"};
// The UEX item for a piece of gear, by name ("P4-AR Rifle"), or null
function paItemFor(name){ const m=S.paItemByName; if(!m||!name) return null; return m[squash(name)]||null; }
function paRule(w){ const what=w.side==="buy"?"Buy price":"Sell price", m=[];
  if(w.low) m.push(`≤ ${money(w.low)}`); if(w.high) m.push(`≥ ${money(w.high)}`);
  return `${what} ${m.join(" or ")}${w.system?` · ${esc(w.system)}`:" · any system"}`; }
// Market › Price alerts is for gear (weapons, armor, clothing, items); commodity alerts live on each commodity's
// page in Trade › Commodities (and the list at the top of Commodities). Both are the same watch list underneath.
const paGear=()=>(S.pa?.items||[]).filter(paIsItem), paCommod=()=>(S.pa?.items||[]).filter(w=>!paIsItem(w));
const paHitCount=(L=paGear())=>L.reduce((a,w)=>a+(w.on?w.hits.length:0),0);
// how far today's best price is from your mark: "12% above your mark"
function paGap(w){ const b=w.best?.price; if(!b) return "";
  const g=[]; if(w.low) g.push(b<=w.low?0:(b-w.low)/w.low); if(w.high) g.push(b>=w.high?0:(w.high-b)/w.high); if(!g.length) return "";
  const d=Math.min(...g); if(d<=0) return `<span class="pa-gap at">at your mark</span>`;
  const pct=d<0.01?"<1":Math.round(d*100); const above=w.low&&(!w.high||(b-w.low)/w.low<=(w.high-b)/w.high);
  return `<span class="pa-gap">${pct}% ${above?"above":"below"} your mark</span>`; }
function paCard(w){ const b=w.best, h=w.on?w.hits:[], f=S.paForm, st=!w.on?["Paused","off"]:h.length?["At your mark","hit"]:["Watching",""];
  return `<div class="pa-card ${st[1]}" data-paid="${esc(w.id)}">
    <div class="pa-top"><a class="pa-name" data-pa="open" title="Open ${esc(w.name)} in ${paIsItem(w)?"Gear":"Commodities"}">${esc(w.name)}</a><span class="pa-kind">${paIsItem(w)?esc(PA_GROUP[w.group]||"Gear"):"Commodity"}</span><span class="pa-chip ${st[1]}">${st[0]}</span><span class="spacer"></span>
      <button class="btn small ghost" data-pa="edit" title="Change the marks">Edit</button><button class="btn small ghost" data-pa="toggle" title="${w.on?"Stop alerting for now":"Start alerting again"}">${w.on?"Pause":"Resume"}</button><button class="btn small ghost" data-pa="del" title="Remove this alert" aria-label="Remove">✕</button></div>
    <div class="pa-rule">${paRule(w)} · prices from ${w.max_age_h?`the last ${(PA_AGES.find(a=>a[0]===w.max_age_h)||[,""])[1]}`:"any time"}</div>
    <div class="pa-now">${!w.on?"Paused: not checked until you resume it"
      :b?`${w.side==="buy"?"Cheapest now":"Best now"} <b>${money(b.price)}</b> at ${b.place?`<a data-open="${esc(b.place)}" style="cursor:pointer">${esc(b.where)}</a>`:esc(b.where)}${b.updated?` <span class="muted">· ${agoTs(b.updated)}</span>`:""} ${paGap(w)}`
      :S.pa?.checked?"No terminal has a recent price for it":"Not checked yet"}</div>
    ${h.length?`<div class="pa-hits"><div class="pa-sub">At your mark now · ${plural(h.length,"terminal")}</div>${h.slice(0,6).map(x=>`<div class="pa-hit"><span>${x.place?`<a data-open="${esc(x.place)}" style="cursor:pointer">${esc(x.where)}</a>`:esc(x.where)}</span><span class="muted">${esc(x.system||"")}${x.updated?` · ${agoTs(x.updated)}`:""}</span><b>${money(x.price)}</b>${x.place?(S.live?.route?.includes(x.place)?`<button class="iconbtn added" data-add="${esc(x.place)}" title="In your route">✓</button>`:`<button class="iconbtn" data-add="${esc(x.place)}" title="Add to route">+</button>`):"<span></span>"}</div>`).join("")}${h.length>6?`<div class="muted" style="font-size:12px">and ${h.length-6} more</div>`:""}</div>`:""}
    ${f&&f.id===w.id?paFormHtml(f):""}</div>`; }
// ---- On a commodity's own page (Trade › Commodities): its price alerts and a short form to add one, so you don't
// have to leave the page. The same alerts as Market › Price alerts.
function mkAlertDefaults(c,r,side){ const buy=r?.buy?.[0]?.price, sell=r?.sell?.[0]?.price; side=side||(buy?"buy":"sell");
  const round=n=>n>=1000?Math.round(n/10)*10:Math.round(n*100)/100;
  return {cid:c.id,side,low:side==="buy"&&buy?round(buy*0.95):"",high:side==="sell"&&sell?round(sell*1.05):""}; }
function mkAlertRender(){ const box=$("mkp-alert"), d=S.mkData; if(!box||!d) return; const {c,r}=d;
  if(!r.buy.length&&!r.sell.length){ box.innerHTML=""; return; }
  if(S.mka?.cid!==c.id) S.mka=mkAlertDefaults(c,r);
  const f=S.mka, mine=(S.pa?.items||[]).filter(w=>!paIsItem(w)&&String(w.id_commodity)===String(c.id));
  const opt=(v,t)=>`<option value="${v}" ${f.side===v?"selected":""}>${t}</option>`;
  box.innerHTML=`<div class="mka"><div class="mka-h"><svg viewBox="0 0 24 24"><path d="M6 8a6 6 0 0112 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 003.4 0"/></svg><b>Price alert</b>
      <span class="muted">Told when any terminal reaches your price</span><span class="spacer"></span></div>
    ${mine.map(w=>{ const h=w.on?w.hits.length:0; return `<div class="mka-row"><span class="pa-chip ${!w.on?"off":h?"hit":""}">${!w.on?"Paused":h?`${plural(h,"terminal")} at your mark`:"Watching"}</span>
      <span class="mka-rule">${paRule(w)}</span>${w.on&&w.best?`<span class="muted">${w.side==="buy"?"cheapest":"best"} now ${money(w.best.price)}</span>`:""}
      <span class="spacer"></span><button class="btn small ghost" data-mka="toggle" data-id="${esc(w.id)}">${w.on?"Pause":"Resume"}</button><button class="btn small ghost" data-mka="del" data-id="${esc(w.id)}" aria-label="Remove this alert" title="Remove this alert">✕</button></div>`; }).join("")}
    <div class="mka-form"><select class="field" id="mka-side" title="Which price to watch">${opt("buy","Buy price (terminals sell it)")}${opt("sell","Sell price (terminals pay)")}</select>
      <label><span>Low ≤</span><input class="field" id="mka-low" inputmode="numeric" placeholder="aUEC / SCU" value="${esc(f.low??"")}"></label>
      <label><span>High ≥</span><input class="field" id="mka-high" inputmode="numeric" placeholder="aUEC / SCU" value="${esc(f.high??"")}"></label>
      <button class="btn small primary" data-mka="save" ${S.mkaBusy?"disabled":""}>${S.mkaBusy?"Saving…":mine.length?"Add another":"Add alert"}</button></div>
    <div class="muted mka-hint">Today: cheapest buy ${r.buy[0]?money(r.buy[0].price):"–"} · best sell ${r.sell[0]?money(r.sell[0].price):"–"}. ${$("mk-sys").value?`Only ${esc($("mk-sys").value)}, like the list below.`:"Any system."} Leave one empty to watch only the other.</div></div>`;
  $("mka-side").onchange=e=>{ S.mka=mkAlertDefaults(c,r,e.target.value); mkAlertRender(); };
  for(const id of ["mka-low","mka-high"]) $(id).oninput=e=>{ S.mka[id==="mka-low"?"low":"high"]=e.target.value; };
  for(const id of ["mka-low","mka-high"]) $(id).onkeydown=e=>{ if(e.key==="Enter") mkAlertClick("save"); }; }
async function mkAlertClick(a,id){ const d=S.mkData; if(!d) return; const c=d.c;
  if(a==="save"){ const f=S.mka, num=v=>String(v??"").replace(/[^\d.]/g,"");
    if(!num(f.low)&&!num(f.high)) return toast("Set a low price, a high price, or both");
    S.mkaBusy=true; mkAlertRender();
    let r; try{ r=await api().watch_save({kind:"commodity",id_commodity:c.id,name:c.name,side:f.side,low:num(f.low),high:num(f.high),system:$("mk-sys").value||"",max_age_h:72}); }catch(_){ r={ok:false,error:"Couldn't save it"}; }
    S.mkaBusy=false; if(r?.ok===false){ mkAlertRender(); return toast(r.error); }
    S.pa=r; qForget("watch"); syncWatchCount(); S.mka=mkAlertDefaults(c,d.r,f.side); mkAlertRender();
    return toast(`Watching ${c.name}: you'll be told when a terminal reaches your price`); }
  const w=(S.pa?.items||[]).find(x=>x.id===id); if(!w) return;
  if(a==="toggle"){ S.pa=await api().watch_toggle(w.id,!w.on); qForget("watch"); syncWatchCount(); mkAlertRender(); return toast(w.on?`${w.name} alert paused`:`${w.name} alert back on`); }
  if(a==="del"){ S.pa=await api().watch_delete(w.id); qForget("watch"); syncWatchCount(); mkAlertRender(); return toast(`Price alert for ${w.name} removed`); } }
// The page: a new alert's form first (when you're making one), then every alert; the edit form opens inside its card
async function renderAlerts(force){ const P=$("pa-panel"); syncWatchCount(); renderAlertsPane(); if(!P||S.tab!=="alerts") return;
  if(!S.live?.log?.uex_token){ P.innerHTML=`<div class="pa-wrap">${needToken}</div>`; return; }
  await paLoad(force).catch(()=>{}); const d=S.pa, f=S.paForm, items=paGear();
  P.innerHTML=`<div class="pa-wrap${!items.length&&!f?" empty":""}"><div class="pm-top"><h2>Price alerts</h2><span class="muted">${items.length?`${items.length} watched${paHitCount()?` · <span style="color:#57e39b">${paHitCount()} at your mark</span>`:""}`:""}</span></div>
    ${f&&!f.id?`<div class="pa-card new">${paFormHtml(f)}</div>`:""}
    ${items.length?`<div class="pa-grid">${items.map(paCard).join("")}</div>`
      :!f?`<div class="so-land"><svg viewBox="0 0 24 24"><path d="M6 8a6 6 0 0112 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 003.4 0"/></svg><h2>No price alerts yet</h2><div>Pick a weapon, armor, clothing or other item on the left, or set one from its page in Gear. You're told when any shop sells it cheap enough, or a terminal pays enough for it.</div><div class="muted" style="font-size:12px;margin-top:10px">Commodity price alerts are on each commodity's page in Trade › Commodities.</div></div>`:""}
    ${d?.error?`<div class="muted" style="font-size:12px;margin-top:10px;color:#ffb454">${esc(d.error)}</div>`:""}</div>`;
  if(S.paScroll){ const id=S.paScroll; S.paScroll=null; P.querySelector(id==="new"?".pa-card.new":`[data-paid="${CSS.escape(id)}"] .wl-form`)?.scrollIntoView({block:"nearest",behavior:"smooth"}); } }
// The left side: start an alert by commodity, and when it was last checked
function renderAlertsPane(){ const P=$("pane-alerts"); if(!P) return; const d=S.pa;
  if(!P.dataset.built){ P.dataset.built="1";
    P.innerHTML=`<div class="fm-k" style="margin-bottom:6px">Watch gear, weapons or items</div>
      <input class="search" id="pa-gq" list="pa-items-dl" placeholder="Weapon, armor, clothing, like “P4-AR”" autocomplete="off">
      <datalist id="pa-items-dl"></datalist>
      <div class="muted" style="font-size:12px;margin:8px 2px 14px;line-height:1.5">You're told when any shop sells it for less than your mark, or a terminal pays more than it. Priced per item: what shops sell it for, and what a terminal pays if you can sell it there. One alert per terminal: it alerts again only after the price has gone back past your mark. Commodity alerts are on each commodity's page in Trade › Commodities.</div>
      <div id="pa-status"></div>`;
    const g=$("pa-gq"), gogo=()=>{ const i=paItemFor(g.value.trim()); if(i){ g.value=""; paNewItem(i); } else if(g.value.trim()&&S.paItems) toast("No terminal has a price for that one yet"); };
    g.addEventListener("focus",()=>paItemsLoad(),{once:true}); g.addEventListener("change",gogo); g.addEventListener("keydown",e=>{ if(e.key==="Enter") gogo(); });
    paItemsLoad(); }
  const st=$("pa-status"); if(!st) return;
  st.innerHTML=paGear().length?`<div class="row" style="gap:8px;align-items:center"><button class="btn small" data-pa="check" ${S.paBusy?"disabled":""}>${S.paBusy?"Checking…":"Check now"}</button>
      <span class="muted" style="font-size:12px">${d?.checked?`Checked ${agoTs(d.checked)}`:"Not checked yet"} · every ${Math.round((d?.every||300)/60)} min while Quantum is open</span></div>`:""; }
function syncWatchCount(){ const n=paHitCount(); for(const id of ["c-watch"]){ const el=$(id); if(!el) continue;
  el.hidden=!n; el.textContent=n||""; el.title=n?`${plural(n,"terminal")} at a price alert's mark`:""; }
  // In Trade › Commodities: your commodity alerts, each a click from its page (where they're changed)
  const box=$("mk-watch"); if(box){ const L=paCommod(), cn=paHitCount(L);
    box.innerHTML=L.length?`<div class="pa-chead">🔔 ${plural(L.length,"commodity price alert")}${cn?` · <b style="color:#57e39b">${cn} at your mark</b>`:""}</div>
      <div class="pa-cl">${L.map(w=>{ const h=w.on?w.hits.length:0; return `<a data-pacom="${esc(w.id_commodity)}" title="Open ${esc(w.name)}: its alert is on its page">${esc(w.name)}<span class="pa-chip ${!w.on?"off":h?"hit":""}">${!w.on?"Paused":h?"At your mark":"Watching"}</span></a>`; }).join("")}</div>`:""; } }
function paFormHtml(f){ const opt=(v,t,cur)=>`<option value="${v}" ${String(cur)===String(v)?"selected":""}>${t}</option>`;
  return `<div class="wl-form" id="wl-form">
    <div class="full"><b>${f.id?"Change alert":"New alert"}: ${esc(f.name)}</b></div>
    <span class="k">Watch</span><select class="field" id="wl-side">${opt("buy","What terminals sell it for (buy price)",f.side)}${opt("sell","What terminals pay for it (sell price)",f.side)}</select>
    <span class="k">Low mark</span><input class="field" id="wl-low" inputmode="numeric" placeholder="Alert at or below (aUEC ${paIsItem(f)?"each":"per SCU"})" value="${f.low??""}">
    <span class="k">High mark</span><input class="field" id="wl-high" inputmode="numeric" placeholder="Alert at or above (aUEC ${paIsItem(f)?"each":"per SCU"})" value="${f.high??""}">
    <span class="k">System</span><select class="field" id="wl-sys">${opt("","Any system",f.system)}${["Stanton","Pyro","Nyx"].map(x=>opt(x,x,f.system)).join("")}</select>
    <span class="k">Prices from</span><select class="field" id="wl-age">${PA_AGES.map(([v,t])=>opt(v,v?`Reported in the last ${t}`:"Any age",f.max_age_h??72)).join("")}</select>
    ${f.hint?`<div class="hint">${f.hint}</div>`:""}
    <div class="full row" style="gap:6px"><button class="btn small primary" data-pa="save">${f.id?"Save":"Add alert"}</button><button class="btn small ghost" data-pa="cancel">Cancel</button></div></div>`; }
// A new alert for a piece of gear. One terminals buy is watched for its sell price (the usual reason: "tell me when
// it pays"), else what shops sell it for.
function paNewItem(i){ const round=n=>n>=1000?Math.round(n/10)*10:Math.round(n*100)/100, side=i.sell?"sell":"buy";
  S.paForm={kind:"item",id_item:i.id,group:i.group,name:i.name,side,low:side==="buy"&&i.buy?round(i.buy*0.95):"",high:side==="sell"&&i.sell?round(i.sell*1.05):"",system:"",max_age_h:72,
    hint:`Today: cheapest in shops ${i.buy?money(i.buy):"–"}, best a terminal pays ${i.sell?money(i.sell):"– (no terminal buys it)"}. Per item.`};
  S.paScroll="new"; if(S.tab!=="alerts") document.querySelector('.tab[data-tab="alerts"]')?.click(); else renderAlerts(); }
// An alert's gear in the Gear tabs (by name)
async function paOpenItem(w){ await Promise.all(PM_GEAR_TABS.map(t=>glData(t).catch(()=>[])));
  const k=squash(w.name); for(const tab of PM_GEAR_TABS){ const i=(grState(tab).data?.items||[]).find(x=>squash(x.name)===k); if(!i) continue;
    document.querySelector(`.tab[data-tab="${tab}"]`)?.click(); const st=grState(tab); if(tab==="armor") st.view="items";
    setTimeout(()=>{ if(st.data) grOpenItem(tab,i.uuid||i.name,null); },150); return; }
  toast(`Couldn't find ${w.name} in Gear`); }
function paFormRead(){ const f=S.paForm; if(!f) return null;
  return {...f,side:$("wl-side").value,low:$("wl-low").value.replace(/[^\d.]/g,""),high:$("wl-high").value.replace(/[^\d.]/g,""),system:$("wl-sys").value,max_age_h:+$("wl-age").value}; }
async function openAlerts(){ renderAlertsPane();
  if(!S.mk&&S.live?.log?.uex_token){ const r=await api().uex_commodities().catch(()=>null); if(r?.ok){ S.mk=r.items; S.mkByName=Object.fromEntries(r.items.map(c=>[c.name.toLowerCase(),c]));
    $("mk-dl").innerHTML=r.items.map(c=>`<option value="${esc(c.name)}">${esc(c.kind||"")}${c.illegal?" · illegal":""}</option>`).join(""); } }
  renderAlerts(); }
async function paClick(e){ if(await tradeClick(e)) return; const a=e.target.closest("[data-pa]")?.dataset.pa; if(!a) return;
  const id=e.target.closest("[data-paid]")?.dataset.paid, w=(S.pa?.items||[]).find(x=>x.id===id);
  if(a==="check"){ S.paBusy=true; renderAlertsPane(); try{ const x=await api().watch_check_now(); if(x?.ok){ S.pa=x; qForget("watch"); } }catch(_){} S.paBusy=false;
    toast(paHitCount()?`${plural(paHitCount(),"terminal")} at your marks`:"Checked: nothing at your marks right now"); return renderAlerts(true); }
  if(a==="cancel"){ S.paForm=null; return renderAlerts(); }
  if(a==="save"){ const v=paFormRead(), r=await api().watch_save(v); if(r?.ok===false) return toast(r.error);
    toast(v.id?"Price alert saved":`Watching ${v.name}: you'll be told when a terminal reaches your mark`); S.paForm=null; qForget("watch"); S.pa=r; return renderAlerts(); }
  if(!w) return;
  if(a==="open"&&paIsItem(w)) return paOpenItem(w);
  if(a==="open"){ const c=S.mk?.find(x=>String(x.id)===String(w.id_commodity));
    if(c){ S.mkSel=c; S.mkData=null; $("mk-search").value=c.name; document.querySelector('.tab[data-tab="market"]')?.click(); } else toast("Couldn't find it in Commodities"); return; }
  if(a==="edit"){ S.paForm=S.paForm?.id===w.id?null:{...w,hint:""}; S.paScroll=w.id; return renderAlerts(); }
  if(a==="toggle"){ S.pa=await api().watch_toggle(w.id,!w.on); qForget("watch"); toast(w.on?`${w.name} alert paused`:`${w.name} alert back on`); return renderAlerts(); }
  if(a==="del"){ S.pa=await api().watch_delete(w.id); qForget("watch"); if(S.paForm?.id===w.id) S.paForm=null; toast(`Price alert for ${w.name} removed`); return renderAlerts(); } }
for(const id of ["pa-panel","pane-alerts"]){ const el=$(id); if(!el) continue; el.addEventListener("click",paClick);
  el.addEventListener("change",e=>{ if(e.target.id==="wl-side"&&S.paForm){ const f=paFormRead(); S.paForm={...f,low:f.high,high:f.low}; renderAlerts(); } }); }
$("mk-watch").onclick=e=>{ const a=e.target.closest("[data-pacom]"); if(!a) return; const c=S.mk?.find(x=>String(x.id)===a.dataset.pacom);
  if(!c) return toast("Couldn't find it in Commodities"); S.mkSel=c; S.mkData=null; $("mk-search").value=c.name; renderMarket(); };
// counts on the tabs from the start (and after alerts go off: main.js)
setTimeout(()=>{ if(S.live?.log?.uex_token) paLoad().then(syncWatchCount).catch(()=>{}); },4000);
// Does anywhere that buys or sells it have a place on the map (in the system picked)? No: no "See on map".
const mkOnMap=(r,sys)=>[...(r?.buy||[]),...(r?.sell||[])].some(x=>x.place&&S.locMap?.[x.place]&&(!sys||x.system===sys));
function toggleMarketMap(){ const d=S.mkData; if(!d) return; if(!S.mkMap&&!mkOnMap(d.r,$("mk-sys").value)) return;
  if(S.mkMap==="src"){ S.mkMap=false; S.mapMarks=null; return renderMarket(); }      // back from the mining spots
  S.mkMap=!S.mkMap;
  if(S.mkMap){ const sys=$("mk-sys").value, keep=L=>L.filter(x=>x.place&&(!sys||x.system===sys)).slice(0,10);
    const marks=[...keep(d.r.buy).map(x=>({name:x.place,label:`Buy ${shortMoney(x.price)}`,color:"#57e39b"})),
                 ...keep(d.r.sell).map(x=>({name:x.place,label:`Sell ${shortMoney(x.price)}`,color:"#ffb454"}))];
    const by={}; for(const m of marks) by[m.name]=by[m.name]?{...by[m.name],label:by[m.name].label+" · "+m.label}:m;
    S.mapMarks=Object.values(by); const names=S.mapMarks.map(m=>m.name);
    const first=S.locMap[names[0]]; if(first&&first.system!==S.system) setSystem(first.system,false);
    if(names.length) fitRoute(true,names.filter(n=>S.locMap[n]?.system===(first?.system||S.system)));
  } else S.mapMarks=null;
  renderMarket(); }
$("mk-panel").onclick=async e=>{ if(e.target.closest("[data-act=mkmap]")) return toggleMarketMap();
  if(e.target.closest("[data-act=mkwatch]")&&S.mkData){ const el=$("mkp-alert"); el?.scrollIntoView({block:"center",behavior:"smooth"}); $("mka-low")?.focus(); return; }
  const mk=e.target.closest("[data-mka]"); if(mk) return mkAlertClick(mk.dataset.mka,mk.dataset.id);
  if(e.target.closest("[data-act=mksrcmap]")) return mkSourceMap();
  if(e.target.closest("[data-act=mksrcall]")){ S.mkSrcAll=!S.mkSrcAll; return S.mkData&&mkSources(S.mkData.c); }
  const ss=e.target.closest("[data-act=mksrcsort]"); if(ss){ S.mkSrcSort=ss.dataset.v; return S.mkData&&mkSources(S.mkData.c); }
  const sb=e.target.closest("[data-showbody]"); if(sb){ const b=sb.dataset.showbody;
    if(S.bodyMap[b]){ if(S.bodyMap[b].system!==S.system) setSystem(S.bodyMap[b].system,false); S.mkMap="src"; S.mapMarks=[{name:b,label:"Found here",color:"#7fd3ff"}]; renderMarket(); select({kind:"body",name:b}); focusBody(b); }
    else if(S.locMap[b]?.pos){ S.mkMap="src"; S.mapMarks=[{name:b,label:"Found here",color:"#7fd3ff"}]; renderMarket(); select({kind:"loc",name:b}); focusLoc(b,true); }
    return; }
  if(e.target.closest("[data-act=mkall]")){ S.mkSel=null; S.mkData=null; $("mk-search").value=""; return openMarket(); }
  const c=e.target.closest("[data-mkc]"); if(c){ S.mkBack={q:$("mk-search").value.trim().toLowerCase(),top:$("mk-panel").scrollTop};      // where Back returns to
    S.mkSel=S.mk.find(x=>String(x.id)===c.dataset.mkc); $("mk-search").value=S.mkSel.name; $("mk-panel").scrollTop=0; return renderMarket(); }
  await tradeClick(e); };
$("mk-search").addEventListener("input",()=>{ if(!S.mkSel||$("mk-search").value.trim().toLowerCase()!==S.mkSel.name.toLowerCase()){ if(S.mkSel&&!S.mkByName?.[$("mk-search").value.trim().toLowerCase()]){ S.mkSel=null; S.mkData=null; openMarket(); } else if(!S.mkSel) renderMarketGrid(); } });
$("map-back").onclick=()=>{ if(S.mkMap) toggleMarketMap(); };
$("pv-next").onclick=()=>journeyNext($("pv-next").dataset.sys);
$("mk-search").addEventListener("change",()=>{ const c=S.mkByName?.[$("mk-search").value.trim().toLowerCase()]; if(c){ S.mkSel=c; renderMarket(); } });
$("mk-search").addEventListener("keydown",e=>{ if(e.key==="Enter"){ const v=$("mk-search").value.trim().toLowerCase(); const c=S.mkByName?.[v]||S.mk?.find(x=>x.name.toLowerCase().includes(v)); if(c){ $("mk-search").value=c.name; S.mkSel=c; renderMarket(); } } });
$("mk-sys").onchange=()=>{ if(S.mkSel) renderMarket(); };
$("mk-out").onclick=e=>{ if(e.target.closest("[data-act=mkmap]")) return toggleMarketMap(); tradeClick(e); };
// ---- Trade routes: best runs from a starting point for your cargo space and budget
// Runs under this profit for one trip are hidden unless you change it (Min profit; 0 shows everything)
const TR_MIN_PROFIT=10000;
const trPref=(k,v)=>{ try{ if(v===undefined) return localStorage.getItem("q-"+k)||""; localStorage.setItem("q-"+k,v); }catch{ return ""; } };
async function openTrade(){
  if(!S.live?.log?.uex_token){ $("tr-out").innerHTML=needToken; $("tr-from").innerHTML=""; trFromSync(); return; }
  const r=await api().uex_origins(); if(!r.ok){ $("tr-out").innerHTML=`<div class="empty">${esc(r.error)}</div>`; return; }
  const cur=$("tr-from").value||trPref("from"); let html=r.here?`<option value="${r.here.kind}:${r.here.id}" data-name="${esc(r.here.name)}">Near me (${esc(r.here.name)})</option>`:"";
  // Wider searches: the most profitable runs in the whole game, or anywhere in one system
  const sysHave=["Stanton","Pyro","Nyx"].filter(sys=>r.items.some(o=>o.system===sys));
  html+=`<optgroup label="Everywhere"><option value="all:all" data-name="">Anywhere (all systems)</option>${sysHave.map(sys=>`<option value="system:${sys}" data-name="">All of ${sys}</option>`).join("")}</optgroup>`;
  for(const sys of ["Stanton","Pyro","Nyx"]){ const g=r.items.filter(o=>o.system===sys); if(g.length) html+=`<optgroup label="${sys}">${g.map(o=>`<option value="${o.kind}:${o.id}" data-name="${esc(o.name)}">${esc(o.name)}</option>`).join("")}</optgroup>`; }
  S.trOrigins=r.items;
  $("tr-from").innerHTML=html; if(cur&&[...$("tr-from").options].some(o=>o.value===cur)) $("tr-from").value=cur; trFromSync();
  trFillAt(trPref("at"));
  if(!$("tr-sys").dataset.init){ $("tr-sys").value=trPref("sys")||""; $("tr-auto").value=trPref("auto")||""; $("tr-sort").value=trPref("sort")||"best"; $("tr-age").value=trPref("age")||"24"; $("tr-sys").dataset.init=1; }
  trSysFit();
  if(!$("tr-scu").value) $("tr-scu").value=trPref("scu"); if(!$("tr-budget").value) $("tr-budget").value=trPref("budget");
  if(!$("tr-minp").value) $("tr-minp").value=trPref("minp")===""?String(TR_MIN_PROFIT):trPref("minp");
  const fl=await api().fleet_list(), keep=S.trShip?.key||trPref("ship"); S.trFleet=fl.ships;
  if(/^v:/.test(keep)&&!S.veh) await trLoadVehicles();
  const pick=trShipFind(keep)||(fl.main?trShipFind(`f:${fl.main}`):null);
  if(pick){ trShipSet(pick); $("tr-scu").value=pick.scu; } else if(!keep) trShipSet(null);
  if(!S.trDone) $("tr-out").innerHTML=`<div class="empty"><strong>Find a profitable route</strong>Pick where you'll start, enter your cargo space and budget, and Quantum ranks what to haul where by total profit.</div>`; }
// Location: one place on the planet picked under From (a station, city or outpost with a terminal), or anywhere there
function trFillAt(keep){ const o=(S.trOrigins||[]).find(o=>`${o.kind}:${o.id}`===$("tr-from").value), L=o?.terminals||[];
  $("tr-at").innerHTML=`<option value="">Any</option>`+L.map(t=>`<option value="${t.id}" data-name="${esc(t.name)}" data-place="${esc(t.place||"")}">${esc(t.name)}</option>`).join("");
  $("tr-at").value=keep&&L.some(t=>String(t.id)===String(keep))?String(keep):""; $("tr-at").disabled=!L.length; }
$("tr-from").addEventListener("change",()=>{ trFillAt(""); trPref("at",""); trSysFit(); trFromSync(); });
// From: type where you'll start (a planet, a moon, a station, a city or one terminal) or pick from the list. The hidden
// select still holds the choice, so everything that reads it works as before. Picking a terminal also sets Location.
function trFromSync(){ const q=$("tr-from-q"); if(!q||document.activeElement===q) return;
  q.value=$("tr-from").selectedOptions[0]?.textContent||""; q.dataset.label=q.value; }
function trFromOptions(qs){ const q=qs.trim().toLowerCase(), out=[], seen=new Set();
  for(const o of $("tr-from").options){ const g=o.parentElement?.tagName==="OPTGROUP"?o.parentElement.label:"Near you";
    if(!q||`${o.textContent} ${g}`.toLowerCase().includes(q)) out.push({value:o.value, label:o.textContent, group:g}); }
  if(q.length>=2) for(const o of S.trOrigins||[]) for(const t of o.terminals||[]){
    const label=t.place&&!t.name.toLowerCase().includes(t.place.toLowerCase())?`${t.place} · ${t.name}`:t.name;
    if(!`${t.name} ${t.place||""}`.toLowerCase().includes(q)||seen.has(t.id)) continue; seen.add(t.id);
    out.push({value:`${o.kind}:${o.id}`, at:String(t.id), label, group:`Terminals at ${o.name}`}); }
  return out.slice(0,150); }
function trFromList(){ const box=$("tr-from-list"), inp=$("tr-from-q");
  const opts=trFromOptions(inp.value===(inp.dataset.label||"")?"":inp.value); S.trFromOpts=opts;
  if((S.trFromAct??-1)>=opts.length) S.trFromAct=opts.length-1;
  let html="", g=null; opts.forEach((o,i)=>{ if(o.group!==g){ g=o.group; html+=`<div class="h">${esc(g)}</div>`; }
    html+=`<div class="opt ${i===S.trFromAct?"act":""}" role="option" data-trfrom="${i}">${esc(o.label)}</div>`; });
  box.innerHTML=html||`<div class="muted" style="font-size:12px;padding:6px 8px">${$("tr-from").options.length?"No place or terminal matches":"Loading places…"}</div>`;
  box.hidden=false; inp.setAttribute("aria-expanded","true"); }
function trFromClose(){ $("tr-from-list").hidden=true; $("tr-from-q").setAttribute("aria-expanded","false"); S.trFromAct=-1; }
function trFromPick(o){ if(!o) return; const sel=$("tr-from"), changed=sel.value!==o.value; sel.value=o.value;
  if(changed) sel.dispatchEvent(new Event("change"));
  if(o.at&&[...$("tr-at").options].some(x=>x.value===o.at)){ $("tr-at").value=o.at; $("tr-at").dispatchEvent(new Event("change")); }
  trFromClose(); $("tr-from-q").blur(); trFromSync(); }
$("tr-from-q").addEventListener("focus",()=>{ S.trFromAct=-1; $("tr-from-q").select(); trFromList(); });
$("tr-from-q").addEventListener("input",()=>{ S.trFromAct=0; trFromList(); });
$("tr-from-q").addEventListener("blur",()=>{ trFromClose(); trFromSync(); });
$("tr-from-q").addEventListener("keydown",e=>{ const n=(S.trFromOpts||[]).length;
  if(e.key==="ArrowDown"||e.key==="ArrowUp"){ e.preventDefault(); if(!n) return; S.trFromAct=((S.trFromAct??-1)+(e.key==="ArrowDown"?1:-1)+n)%n; trFromList();
    $("tr-from-list").querySelector(".opt.act")?.scrollIntoView({block:"nearest"}); }
  else if(e.key==="Enter"){ e.preventDefault(); trFromPick(S.trFromOpts?.[Math.max(0,S.trFromAct??0)]); }
  else if(e.key==="Escape"){ trFromClose(); $("tr-from-q").blur(); } });
// mousedown, so the pick happens before the box loses focus
$("tr-from-list").addEventListener("mousedown",e=>{ e.preventDefault(); const o=e.target.closest("[data-trfrom]"); if(o) trFromPick(S.trFromOpts?.[+o.dataset.trfrom]); });
// Systems: only what can apply to where you start. Starting in Pyro, "Stay in Stanton" can't find
// anything and "Avoid Pyro" rules out every run, so they're hidden (and a hidden choice goes back to Any).
function trStartSystem(){ const [kind,id]=($("tr-from").value||"").split(":"); if(kind==="all") return null; if(kind==="system") return id;
  const o=(S.trOrigins||[]).find(o=>`${o.kind}:${o.id}`===`${kind}:${id}`); return o?.system||null; }
function trSysFit(){ const sel=$("tr-sys"), from=trStartSystem();
  for(const o of sel.options){ const [k,n]=o.value.split(":"); o.hidden=o.disabled=!!from&&((k==="stay"&&n!==from)||(k==="avoid"&&n===from)); }
  if(sel.selectedOptions[0]?.disabled){ sel.value=""; trPref("sys",""); } }
$("tr-at").addEventListener("change",()=>trPref("at",$("tr-at").value));
async function runTrade(){
  let [kind,id]=($("tr-from").value||"").split(":"); if(!id) return toast("Pick where you'll start");
  if($("tr-at").value){ kind="terminal"; id=$("tr-at").value; }
  const wide=kind==="all"||kind==="system";
  setPreview(null);
  const scu=+$("tr-scu").value||0, budget=+$("tr-budget").value||0;
  trPref("from",$("tr-from").value); trPref("scu",$("tr-scu").value); trPref("budget",$("tr-budget").value); trPref("minp",$("tr-minp").value===""?"0":$("tr-minp").value);
  $("tr-out").innerHTML=`<div class="muted" style="margin-top:6px">${wide?`Comparing every terminal${kind==="system"?` in ${esc(id)}`:""}…`:"Finding routes…"}</div>`;
  const sv=$("tr-sys").value, [sk,sn]=sv.split(":"), au=$("tr-auto").value, so=$("tr-sort").value||"best"; trPref("sys",sv); trPref("auto",au); trPref("sort",so); trPref("ship",S.trShip?.key||"");
  const minp=S.trShowSmall?0:Math.max(0,+$("tr-minp").value||0); S.trShowSmall=false;
  const age=+$("tr-age").value||24; trPref("age",String(age));
  const r=await api().uex_routes(kind,wide?id:+id,scu,budget,sk==="stay"?sn:"",sk==="avoid"?[sn]:[],sk==="one",au,so,minp,age); S.trDone=true;
  if(!r.ok){ $("tr-out").innerHTML=`<div class="empty">${esc(r.error)}</div>`; return; }
  // Runs whose prices are over a day old aren't used (app.ROUTE_MAX_AGE_H): say so, so an empty list makes sense
  // Runs too small to be worth it (under Min profit): say how many, with a way to see them this once
  const smallNote=r.small_left_out?`${r.small_left_out} run${r.small_left_out===1?"":"s"} under ${money(r.min_profit)} profit hidden · <a data-act="trsmall" style="cursor:pointer;text-decoration:underline;color:var(--route-2)">Show them</a>`:"";
  const ageTxt=h=>h>=24?"a day":h===1?"an hour":`${h} hours`, ageLast=h=>h>=24?"day":h===1?"hour":`${h} hours`;
  const oldNote=r.old_left_out?`${r.old_left_out} run${r.old_left_out===1?"":"s"} left out: their prices are over ${ageTxt(r.max_age_h||24)} old`:"";
  if(!r.routes.length){ $("tr-out").innerHTML=`<div class="empty"><strong>No ${r.min_profit?"worthwhile":"profitable"} routes</strong>${wide?"Nothing":"Nothing from here"} makes ${r.min_profit?`at least ${money(r.min_profit)} a trip`:"a profit"} with that cargo space and budget${au?` at ${au==="both"?"terminals that auto-load at both ends":"a terminal that auto-loads"}`:""}, using prices reported in the last ${ageLast(r.max_age_h||24)}.${(r.max_age_h||24)<24?" Try a longer Price age.":""}${smallNote?`<br><br>${smallNote}`:""}${oldNote?`<br><br>${esc(oldNote)}. Updating prices in Datarunner brings them back.`:""}</div>${uexCredit(r.at)}<div id="tr-shared"></div>`; renderSharedRoutes(); return; }
  const end=(pl,name)=>pl?`<a data-open="${esc(pl)}" style="cursor:pointer;text-decoration:underline">${esc(name)}</a>`:esc(name);
  $("tr-out").innerHTML=TRADE_DISCLAIMER+`<div class="muted" style="font-size:12px;margin:2px 2px 8px">${r.total} route${r.total===1?"":"s"}${r.wide?` · best ${r.routes.length} shown, a few per commodity`:""} · prices from the last ${ageLast(r.max_age_h||24)} only${oldNote?` (${esc(oldNote.replace(" left out:"," left out,"))})`:""} · click one for details${!scu?" · enter your cargo space for real totals":""}${smallNote?` · ${smallNote}`:""}</div>`+r.routes.map((x,i)=>
    `<div class="tr-card ${S.previewIdx===i?"hl":""} ${S.trOpen===i?"open":""}" data-tri="${i}"><div class="top"><b>${esc(x.commodity)}</b><span class="muted">${x.units.toLocaleString()} SCU</span><span class="profit">+${shortMoney(x.profit)}</span></div>
      <div class="leg">Buy at ${end(x.from_place,x.from)} <span class="muted">${esc(x.from_where)} · ${money(x.buy)}/SCU</span><br>
        Sell at ${end(x.to_place,x.to)} <span class="muted">${esc(x.to_where)} · ${money(x.sell)}/SCU</span></div>
      ${x.per_hour!=null?`<div class="facts" style="margin-top:2px"><span title="Rough time for the run: quantum travel${x.start_dist?" from where you are":""}, landing or docking, loading and unloading">~${Math.round(x.minutes)} min</span><span style="color:var(--ok)">≈ ${shortMoney(x.per_hour)}/h</span>${x.updated?(()=>{ const h=(Date.now()/1000-x.updated)/3600; return `<span style="color:${h<3?"#57e39b":h<12?"var(--ink-2)":"#ffb454"}" title="${x.updated_from&&x.updated_to?`Buy price ${agoTs(x.updated_from)}, sell price ${agoTs(x.updated_to)}`:"When these prices were reported"}">Prices ${agoTs(x.updated)}</span>`; })():""}${x.trust<0.8?`<span style="color:#ffb454" title="These prices are most of a day old or have few reports: check before you buy">Prices may be stale</span>`:""}${x.then?`<span title="The best run that starts where this one sells, so you don't fly back empty">Then: ${esc(x.then.commodity)} to ${esc(x.then.to)} +${shortMoney(x.then.profit)}</span>`:""}</div>`:""}
      <div class="facts"><span>Cost ${shortMoney(x.cost)}</span><span>+${money(x.sell-x.buy)}/SCU</span>${x.roi!=null?`<span>ROI ${Math.round(x.roi)}%</span>`:""}${x.dist?`<span>${fmtDist(x.dist)}</span>`:""}${x.cross_system?`<span style="color:#ffb454">Crosses systems</span>`:""}${x.autoload_from||x.autoload_to?`<span style="color:var(--ok)" title="The terminal loads and unloads your ship for you">Auto-load ${x.autoload_from&&x.autoload_to?"both ends":x.autoload_from?"at buy":"at sell"}</span>`:""}${x.boxes_from?`<span>Boxes up to ${esc(x.boxes_from.split(",").slice(-1)[0])} SCU</span>`:""}</div>
      <div class="row" style="margin-top:8px;gap:6px">${x.from_place&&x.to_place?`<button class="btn small" data-prev="${i}">Preview</button>${runGoing(x)?`<button class="btn small" data-run="${i}" title="It's on your route and the map card">✓ Started</button>`:`<button class="btn small primary" data-run="${i}" title="Saves it to Planned Routes and puts its buy and sell stops on your route">Start run</button>`}`:`<span class="muted" style="font-size:12px">${esc(!x.from_place?x.from:x.to)} isn't on the map yet</span>`}
        <span class="spacer"></span>${x.url?`<button class="btn small ghost" data-ext="${esc(x.url)}">UEX</button>`:""}</div></div>`).join("")+uexCredit(r.at)+`<div id="tr-shared"></div>`;
  S.trRoutes=r.routes; S.trAt=r.at; S.trTotal=r.total; renderSharedRoutes(); }
$("tr-go").onclick=runTrade;
// ---- The ship for a trade run: type any ship. The ships in your fleet are listed first, then every
// other ship with cargo space. Picking one fills in its cargo space.
async function trLoadVehicles(){ if(S.veh) return; try{ const r=await api().uex_vehicles(); if(r.ok){ S.veh=r.vehicles; S.vehAt=r.at; S.vehOpen=S.vehOpen||{}; } }catch(_){} }
// A modular ship (the Galaxy) is offered once per module that changes its cargo space: "RSI Galaxy · Cargo module ·
// 720 SCU" and "RSI Galaxy · Base · 64 SCU". The key carries the module: f:<uid>:<module> or v:<id>:<module>.
function trShipEntries(x,fleet){ const mods=x.cargo_modules||[], base=fleet?`f:${x.uid}`:`v:${x.id}`, star=fleet&&x.main?" ★":"";
  if(!mods.length) return x.scu>0?[{key:base,label:`${x.full} · ${x.scu} SCU${star}`,scu:x.scu}]:[];
  const cur=fleet?x.module_id:null;
  const seen=new Set();               // one entry per cargo space: the Med Bay's 64 SCU is the same as no module
  return mods.slice().sort((a,b)=>(b.id===cur)-(a.id===cur)||(b.id==="base")-(a.id==="base")).filter(m=>m.scu>0&&!seen.has(m.scu)&&seen.add(m.scu))
    .sort((a,b)=>(b.id===cur)-(a.id===cur)||b.scu-a.scu).map(m=>({key:`${base}:${m.id}`,scu:m.scu,
    label:`${x.full} · ${m.id==="base"?"no module":`${m.name} module`} · ${m.scu.toLocaleString()} SCU${star}${fleet&&m.id!==cur?" (if you fit it)":""}`})); }
function trShipFind(key){ if(!key) return null; if(!key.includes(":")) key=`f:${key}`;          // older saves: a fleet uid
  const [k,id,mod]=key.split(":");
  const x=k==="f"?(S.trFleet||[]).find(x=>String(x.uid)===id):(S.veh||[]).find(v=>String(v.id)===id); if(!x) return null;
  const L=trShipEntries(x,k==="f"); return L.find(o=>o.key===key)||(mod?null:L[0])||null; }
function trShipSet(p){ S.trShip=p||null; $("tr-ship").value=p?p.label:""; trPref("ship",p?p.key:""); }
function trShipOptions(q){ q=q.trim().toLowerCase(); const qw=q.split(/[^a-z0-9]+/).filter(Boolean);
  // every word typed, in any order: "mk v", "centaurus mk v" and "rsi const" all find the Constellation Mk V
  const has=t=>{ if(!q) return true; t=t.toLowerCase(); const tw=t.split(/[^a-z0-9]+/);
    return t.includes(q)||qw.every(w=>tw.some(x=>x.startsWith(w))); }, own=new Set(), mine=[], rest=[];
  for(const x of S.trFleet||[]){ own.add(x.vehicle_id); if(has(`${x.full} ${x.maker||""} ${(x.cargo_modules||[]).map(m=>m.name).join(" ")}`)) mine.push(...trShipEntries(x,true)); }
  for(const v of S.veh||[]) if(!v.concept&&!own.has(v.id)&&has(`${v.full} ${v.maker||""} ${v.aka||""} ${(v.cargo_modules||[]).map(m=>m.name).join(" ")}`)) rest.push(...trShipEntries(v,false));
  rest.sort((a,b)=>a.label.localeCompare(b.label)); return {mine, rest:rest.slice(0,80), more:Math.max(0,rest.length-80)}; }
function trShipList(){ const box=$("tr-ship-list"), inp=$("tr-ship");
  const q=S.trShip&&inp.value===S.trShip.label?"":inp.value, {mine,rest,more}=trShipOptions(q); S.trShipOpts=[...mine,...rest];
  const row=(o,i)=>`<div class="opt ${i===S.trShipAct?"act":""}" role="option" data-trship="${esc(o.key)}">${esc(o.label)}</div>`;
  box.innerHTML=(mine.length?`<div class="h">My fleet</div>${mine.map(row).join("")}`:"")
    +(rest.length?`<div class="h">${mine.length?"Other ships":"Ships"}</div>${rest.map((o,i)=>row(o,i+mine.length)).join("")}`:"")
    +(more?`<div class="muted" style="font-size:12px;padding:6px 8px">${more} more: keep typing to narrow</div>`:"")
    +(!mine.length&&!rest.length?`<div class="muted" style="font-size:12px;padding:6px 8px">${S.veh?"No ship with cargo space matches":"Loading ships…"}</div>`:"");
  box.hidden=false; inp.setAttribute("aria-expanded","true"); }
function trShipClose(){ $("tr-ship-list").hidden=true; $("tr-ship").setAttribute("aria-expanded","false"); S.trShipAct=-1; }
function trShipPick(key){ const p=trShipFind(key); if(!p) return; trShipSet(p); $("tr-scu").value=p.scu; trShipClose(); }
$("tr-ship").addEventListener("focus",async()=>{ S.trShipAct=-1; $("tr-ship").select(); trShipList(); if(!S.veh){ await trLoadVehicles(); if(document.activeElement?.id==="tr-ship") trShipList(); } });
$("tr-ship").addEventListener("input",()=>{ S.trShipAct=0; trShipList(); });
$("tr-ship").addEventListener("mousedown",()=>{ if(document.activeElement?.id==="tr-ship"&&$("tr-ship-list").hidden){ S.trShipAct=-1; trShipList(); } });
$("tr-ship").addEventListener("keydown",e=>{ const n=(S.trShipOpts||[]).length;
  if(e.key==="ArrowDown"||e.key==="ArrowUp"){ e.preventDefault(); if(!n) return; S.trShipAct=((S.trShipAct??-1)+(e.key==="ArrowDown"?1:-1)+n)%n; trShipList();
    $("tr-ship-list").querySelector(".opt.act")?.scrollIntoView({block:"nearest"}); }
  else if(e.key==="Enter"){ const o=S.trShipOpts?.[S.trShipAct]; if(o){ e.preventDefault(); trShipPick(o.key); $("tr-ship").blur(); } }
  else if(e.key==="Escape"){ trShipClose(); $("tr-ship").blur(); } });
// mousedown, so the pick happens before the box loses focus
$("tr-ship-list").addEventListener("mousedown",e=>{ const o=e.target.closest("[data-trship]"); e.preventDefault(); if(o) trShipPick(o.dataset.trship); });
$("tr-ship").addEventListener("blur",()=>{ trShipClose(); const v=$("tr-ship").value.trim();
  if(!v) trShipSet(null); else if(S.trShip) $("tr-ship").value=S.trShip.label;       // typed but not picked: back to the ship picked before
  else $("tr-ship").value=""; });
$("tr-scu").addEventListener("input",()=>{ if(S.trShip&&$("tr-scu").value!==String(S.trShip.scu)) trShipSet(null); });
// Preview: draw the run (you → buy → sell) on the map without touching your route.
// A run's places, through the gateways when it crosses systems: buy, (jump out, arrive)…, sell
async function journeyOf(from,to,what){ let P=[from,to]; try{ const r=await api().journey(from,to); if(r?.places?.length) P=r.places; }catch(_){}
  const lab={[from]:`Buy ${what}`,[to]:`Sell ${what}`}, sys=n=>S.locMap[n]?.system;
  for(let i=1;i<P.length-1;i++) lab[P[i]]=sys(P[i+1])!==sys(P[i])?`Jump to ${sys(P[i+1])}`:`Arrive from ${sys(P[i-1])}`;
  return {places:P, labels:lab}; }
async function previewPlaces(from,to,what){ setPreview(null); if(!from||!to) return; const j=await journeyOf(from,to,what);
  S.preview=j.places; S.previewIdx=null; S.previewLabels=j.labels; const L=S.locMap[from]; if(L&&L.system!==S.system) setSystem(L.system,false);
  journeyChip(); if(tradePanelOpen()) return framePreview(); fitRoute(true,S.preview.filter(n=>S.locMap[n]?.system===S.system)); }
// A run that crosses systems: a chip on the map to see its part in the next system (the map shows one at a time)
// With the route page open, the chip sits inside its map window (the page covers the rest of the map).
function journeyChip(){ const P=S.preview||[], order=[...new Set(P.map(n=>S.locMap[n]?.system).filter(Boolean))], inWin=tradePanelOpen()&&$("trd-next");
  for(const el of [$("pv-next"),$("trd-next")]){ if(!el) continue;
    if(order.length<2||(el.id==="pv-next")===!!inWin){ el.classList.remove("show"); continue; }
    const i=order.indexOf(S.system), next=order[(i+1)%order.length], last=i===order.length-1;
    el.innerHTML=last?`↺ Back to the start in <b>${esc(next)}</b>`:`This run continues in <b>${esc(next)}</b> · Show →`; el.dataset.sys=next; el.classList.add("show"); } }
function journeyNext(sys){ if(!sys||!S.preview) return; S.autoSystem=false; setSystem(sys,false);
  const here=S.preview.filter(n=>S.locMap[n]?.system===sys), t=now(), a=nodeOf(here[0],t), b=nodeOf(here[here.length-1],t);
  if(tradePanelOpen()&&a&&b&&here.length>1){ const mid=[0,1,2].map(i=>(a.g[i]+b.g[i])/2), r=Math.max(d3(a.g,b.g)/2,2e5); flyTo({kind:"point",pos:mid}, r*1.45/fitHalf(), {pitch:1.25}); }
  else fitRoute(true,here); journeyChip(); }
document.addEventListener("click",e=>{ const b=e.target.closest("[data-pvnext]"); if(b) journeyNext(b.dataset.sys); });
// Inside the route page: centre on the middle of the run and size it to the map window, seen more from
// above so both ends and their labels sit inside it (your own position isn't part of this framing).
function framePreview(){ const t=now(), a=nodeOf(S.preview[0],t), b=nodeOf(S.preview[1],t); if(!a||!b) return fitRoute(true,S.preview.filter(n=>S.locMap[n]?.system===S.system));
  const mid=[0,1,2].map(i=>(a.g[i]+b.g[i])/2), r=Math.max(d3(a.g,b.g)/2,2e5), h=fitHalf();
  flyTo({kind:"point",pos:mid}, r*1.45/h, {pitch:1.25}); }
function setPreview(i){ if(i==null){ if(S.preview){ S.preview=null; S.previewIdx=null; document.querySelectorAll(".tr-card.hl").forEach(c=>c.classList.remove("hl")); } journeyChip(); return; }
  const x=S.trRoutes[i]; S.preview=[x.from_place,x.to_place]; S.previewIdx=i; S.previewLabels={[x.from_place]:`Buy ${x.commodity}`,[x.to_place]:`Sell ${x.commodity}`};
  fitRoute(true,S.preview);
  journeyOf(x.from_place,x.to_place,x.commodity).then(j=>{ if(S.previewIdx!==i) return; S.preview=j.places; S.previewLabels=j.labels; journeyChip(); }); }
// Routes other Quantum users shared, under the UEX results (only those starting where you picked).
async function renderSharedRoutes(){ const box=$("tr-shared"); if(!box) return;
  const at=$("tr-at").selectedOptions[0], from=at?.value?(at.dataset.place||at.dataset.name):$("tr-from").selectedOptions[0]?.dataset.name;
  const r=await api().shared_routes(from||null); if(!$("tr-shared")) return; S.trShared=r.routes||[];
  if(!S.trShared.length){ box.innerHTML=""; return; }
  box.innerHTML=`<div class="mk-h" style="margin-top:16px">Shared by Quantum users <span class="muted" style="text-transform:none;letter-spacing:0">their own routes from ${esc(from||"anywhere")}, last 7 days</span></div>`
    +S.trShared.map((x,i)=>`<div class="tr-card shared"><div class="top"><b>${esc(x.commodity)}</b>${x.units?`<span class="muted">${x.units.toLocaleString()} SCU</span>`:""}<span class="profit">+${money(x.per_scu)}/SCU</span></div>
      <div class="leg">Buy at <a data-open="${esc(x.from_place)}" style="cursor:pointer;text-decoration:underline">${esc(x.from_terminal||x.from_place)}</a> <span class="muted">${esc(x.from_place)} · ${money(x.buy)}/SCU</span><br>
        Sell at <a data-open="${esc(x.to_place)}" style="cursor:pointer;text-decoration:underline">${esc(x.to_terminal||x.to_place)}</a> <span class="muted">${esc(x.to_place)} · ${money(x.sell)}/SCU</span></div>
      <div class="facts"><span>by ${esc(x.username)}</span><span>${esc(agoTs(x.at))}</span>${x.notes?`<span>${esc(x.notes)}</span>`:""}</div>
      <div class="row" style="margin-top:8px;gap:6px"><button class="btn small primary" data-sharedrun="${i}">Add to Planned Routes</button></div></div>`).join(""); }
$("tr-out").onclick=async e=>{ if(e.target.closest("[data-act=trsmall]")){ S.trShowSmall=true; return runTrade(); } const sh=e.target.closest("[data-sharedrun]"); if(sh){ const x=S.trShared[+sh.dataset.sharedrun];
    const r=await api().trade_run_save({commodity:x.commodity,units:x.units,from_place:x.from_place,to_place:x.to_place,from_terminal:x.from_terminal,to_terminal:x.to_terminal,plan_buy:x.buy,plan_sell:x.sell,notes:`Shared by ${x.username}`});
    toast(r.ok?"Added to Planned Routes":(r.error||"Couldn't add it")); return; }
  if(await tradeClick(e)) return;
  if(!e.target.closest("button,a")){ const c=e.target.closest("[data-tri]"); if(c){ openRunDetail(+c.dataset.tri); return; } }
  const pv=e.target.closest("[data-prev]"); if(pv){ openRunDetail(+pv.dataset.prev); return; }
  const b=e.target.closest("[data-run]"); if(!b) return; const x=S.trRoutes[+b.dataset.run];
  setPreview(null); await startRun(x); };
function redrawTradeButtons(){ document.querySelectorAll("#tr-out [data-prev]").forEach(b=>{ const on=+b.dataset.prev===S.previewIdx;
  b.textContent=on?"Previewing":"Preview"; b.classList.toggle("primary",on); b.closest(".tr-card").classList.toggle("hl",on); });
  document.querySelectorAll("#tr-out [data-run]").forEach(b=>{ const x=S.trRoutes?.[+b.dataset.run]; if(!x) return; const go=runGoing(x);
    b.textContent=go?"✓ Started":"Start run"; b.classList.toggle("primary",!go); }); }

// ---- Your runs on the map's home card (beside the next stop): each open run on your route, how far along it
// is, and the one thing to do next. Quantum watches the log: setting the buy place as your destination in game
// shows you're on your way; landing there makes "Mark purchased" the obvious next step (it doesn't tick it for
// you: landing somewhere doesn't mean you bought anything). Several runs: drag stops in the route, or Plan best
// order (shortest trip that still buys each cargo before selling it).
async function runsSync(quiet){ let r; try{ r=await api().trade_runs(); }catch(_){ return; } if(!r?.ok) return;
  const before=new Map((S.runs||[]).map(x=>[x.id,x]));
  S.runs=r.runs||[];
  if(!quiet) for(const x of S.runs){ const o=before.get(x.id); if(!o) continue;
    if(x.heading==="buy"&&o.heading!=="buy") toast(`On your way to buy ${x.commodity} at ${x.from_place}: you set it as your destination in game`);
    else if(x.stage==="transit"&&o.stage!=="transit"&&x.transit_how==="route") toast(`${x.commodity} is in transit: you set your route to ${x.to_place} in game`); }
  if($("tr-mine-out")) renderRuns(); redrawTradeButtons(); if(typeof renderHud==="function"&&S.live) renderHud(); }
const RUN_BAR=["planned","bought","loading","transit","unloading"];
function runAt(x){ const lv=S.live||{}, tv=lv.travel, here=n=>!!n&&((tv?.state==="landed"&&tv.place===n)||(lv.arrived?.place===n)||(lv.at_place?.name===n));
  return {buy:here(x.from_place), sell:here(x.to_place)}; }
function runHint(x){ const at=runAt(x), st=x.stage||"planned";
  if(st==="planned") return at.buy?[`You're at ${x.from_place}: buy ${x.units?x.units.toLocaleString()+" SCU of ":""}${x.commodity}`,true]
    :x.heading==="buy"?[`On your way to ${x.from_place} to buy`,false]:[`Next: buy at ${x.from_place}`,false];
  if(st==="bought"||st==="loading") return [at.buy&&st==="bought"?"Load it, then head out":`Next: fly to ${x.to_place} to sell`,false];
  if(st==="transit") return at.sell?[`You're at ${x.to_place}: off load and sell`,true]:[`On the way to ${x.to_place}`,false];
  if(st==="unloading") return [`Selling at ${x.to_place}`,true];
  return ["",false]; }
function runsHudHtml(){ const open=(S.runs||[]).filter(x=>x.routed&&x.stage!=="sold"); if(!open.length) return "";
  const many=open.length>1, shown=open.slice(0,3);
  const row=x=>{ const st=x.stage||"planned", k=RUN_BAR.indexOf(st), nx=RUN_NEXT[st], [hint,now]=runHint(x);
    const profit=x.plan_buy!=null&&x.plan_sell!=null&&x.units?(x.plan_sell-x.plan_buy)*x.units:null;
    return `<div class="tr-hud-run"><div class="row" style="gap:6px;align-items:baseline"><b>${esc(x.commodity)}</b>${x.units?`<span class="muted">${x.units.toLocaleString()} SCU</span>`:""}
        <span class="spacer"></span>${profit!=null?`<span style="color:var(--ok);font-size:12.5px">+${shortMoney(profit)}</span>`:""}</div>
      <div class="tr-hud-leg"><span class="${k<=0?"on":"done"}">Buy</span> ${esc(x.from_place)} <span class="muted">→</span> <span class="${k>=3?"on":""}">Sell</span> ${esc(x.to_place)}</div>
      <div class="tr-hud-bar">${RUN_BAR.map((_,i)=>`<i class="${i<k?"done":i===k?"cur":""}"></i>`).join("")}</div>
      <div class="row" style="gap:6px;align-items:center"><span class="tr-hud-hint ${now?"now":""}">${esc(hint)}</span><span class="spacer"></span>
        ${nx?`<button class="btn small ${now?"go":""}" data-hudrun="${esc(x.id)}" data-stage="${nx[0]}">${esc(nx[1])}</button>`:""}</div></div>`; };
  return `<div class="card trade-runs"><div class="lbl">Trade run${many?`s · ${open.length}`:""}<span class="spacer"></span>
      ${many?`<button class="btn small" id="hud-runs-plan" title="Shortest trip that still buys each cargo before selling it (contract stops too)">Plan best order</button>`:""}
      <a id="hud-runs-all" style="cursor:pointer;font-size:12px;margin-left:8px">Details</a></div>
    ${shown.map(row).join("")}${open.length>3?`<div class="hint" style="margin-top:6px">+${open.length-3} more in Trade › Planned Routes</div>`:""}
    ${many?`<div class="hint" style="margin-top:6px">Drag stops in the route list to change the order yourself.</div>`:""}</div>`; }
function runsHudWire(H){
  for(const b of H.querySelectorAll("[data-hudrun]")) b.onclick=async()=>{ b.disabled=true; const x=(S.runs||[]).find(r=>r.id===b.dataset.hudrun);
    const r=await api().trade_run_stage(b.dataset.hudrun,b.dataset.stage); if(r&&r.ok===false) toast(r.error);
    await runsSync(true); await poll();
    if(x&&b.dataset.stage==="sold") toast(`${x.commodity} sold. Prices and fees can be filled in under Planned Routes`); };
  const pl=$("hud-runs-plan"); if(pl) pl.onclick=async()=>{ pl.disabled=true; const r=await api().optimize_route(); await poll();
    toast(!r?.ok?(r?.error||"Couldn't plan it"):r.saved>1000?`Route reordered: ${fmtDist(r.saved)} shorter, buying each cargo before you sell it`:"That's already the best order"); };
  const all=$("hud-runs-all"); if(all) all.onclick=()=>{ document.querySelector('.tab[data-tab="trade"]')?.click(); if(typeof showTradeView==="function") showTradeView("mine"); }; }

// ---- Vehicles: every ship and ground vehicle, where to buy or rent it and for how much
async function openVehicles(){
  if(!S.live?.log?.uex_token){ $("vh-nav").innerHTML=needToken; $("vh-gallery").innerHTML=""; return; }
  if(!S.veh){ $("vh-nav").innerHTML=`<div class="muted" style="margin-top:10px">Loading vehicles…</div>`; if($("vh-gallery").classList.contains("show")) $("vh-gallery").innerHTML=qLoader("Loading vehicles…");
    const r=await api().uex_vehicles(); if(!r.ok){ $("vh-nav").innerHTML=`<div class="empty">${esc(r.error)}</div>`; $("vh-gallery").innerHTML=""; return; }
    S.veh=r.vehicles; S.vehAt=r.at; S.vehOpen=S.vehOpen||{}; S.vehGalKey=null; }
  loadBrands(()=>{ if(S.tab==="vehicles") renderVehicles(); });          // manufacturer logos, fetched once in the background
  renderVehicles(); }
// Where to buy: cheapest first, or closest to you (from your last /showlocation or where the log puts you;
// other systems last). The choice is kept for every list on this PC.
function spotDist(x){ if(x.dist!=null) return x.dist; const L=x.place&&S.locMap?.[x.place], p=S.live?.player;
  if(!L?.pos||!p||p.system!==L.system) return null; const t=now(), a=playerG(t), b=globalPos(L,t); return a&&b?d3(a,b):null; }
function spotSortPref(){ if(S.spotSort===undefined){ try{ S.spotSort=localStorage.getItem("spotSort")||"price"; }catch(_){ S.spotSort="price"; } } return S.spotSort; }
// The shop or terminal to look for at a place, first on a "where to buy / sell" row and brighter than the rest of
// the line: "Centermass", "New Deal", "TDD - Trade and Development Division", "Admin". Left out when it's just the
// place's own name again.
const SHOP_IC='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9l1.5-5h13L20 9M4 9h16v11H4zM9.5 20v-6h5v6"/></svg>';
const shopTag=(x,what)=>{ const s=String(x?.shop||x?.terminal||"").trim(), w=String(x?.where||"");
  if(!s||s===w||s===w.split(",")[0].trim()) return "";
  return `<span class="shop-tag" title="${esc(what||"The shop that sells it here")}">${SHOP_IC}${esc(s)}</span> · `; };
function vehSpots(list,kind){
  if(!list.length) return `<div class="muted" style="font-size:12.5px;margin:4px 0 8px">${kind==="buy"?"Not sold in game":"Not for rent"}.</div>`;
  const rows=list.map(x=>({x,d:spotDist(x)})), cheap=Math.min(...list.map(x=>x.price??Infinity));
  const near=spotSortPref()==="near"&&rows.length>1;
  if(near) rows.sort((a,b)=>(a.d==null)-(b.d==null)||(a.d??0)-(b.d??0)||(a.x.price??0)-(b.x.price??0));
  const toggle=rows.length>1?`<div class="seg-mini spot-sort" style="margin:2px 0 6px"><button data-spotsort="price" class="${near?"":"on"}">Cheapest first</button><button data-spotsort="near" class="${near?"on":""}" title="${S.live?.player?"From where you are":"Needs your position: type /showlocation in game"}">Closest to me</button></div>`:"";
  return toggle+rows.map(({x,d})=>`<div class="mk-row"><div class="w">${x.place?`<a data-open="${esc(x.place)}">${esc(x.where)}</a>`:esc(x.where)}</div>
    <div class="p ${x.price===cheap?"best":""}">${money(x.price)}${kind==="rent"?`<small class="muted" style="font-weight:500"> /day</small>`:""}</div>
    ${x.place?`<button class="iconbtn" data-add="${esc(x.place)}" title="Add to route">+</button>`:`<span></span>`}
    <div class="m">${shopTag(x,kind==="rent"?"The rental desk here":"The shop that sells it here")}${esc(x.system||"")}${d!=null?` · ${fmtDist(d)} away`:""}${agoTs(x.updated)?` · ${agoTs(x.updated)}`:""}</div></div>`).join(""); }
// The toggle re-draws whichever page is open (each one rebuilds its lists from the same data)
document.addEventListener("click",e=>{ const b=e.target.closest("[data-spotsort]"); if(!b) return; e.preventDefault(); e.stopPropagation();
  S.spotSort=b.dataset.spotsort; try{ localStorage.setItem("spotSort",S.spotSort); }catch(_){}
  if(S.spotSort==="near"&&!S.live?.player) toast("Type /showlocation in game so Quantum knows where you are");
  const kind=S.tab; if(GEAR[kind]&&grState(kind).sel) return grDetail(kind);
  if(kind==="components"&&S.cpDetail) return renderComponents();
  if(kind==="vehicles"&&typeof renderVehicles==="function") return renderVehicles();
  if(typeof renderDetail==="function") renderDetail(); },true);
// ---- Vehicles: every vehicle's picture in place of the map; the sidebar lists categories (by role, ground
// vehicles, pad size, maker) that filter the pictures down. "All vehicles" takes the filter off again.
const VH_ICON={ship:'<path d="M12 2.5l3 7 6.5 3-6.5 2-3 7-3-7-6.5-2 6.5-3z"/>',
  Cargo:'<path d="M3.5 7.5L12 3l8.5 4.5v9L12 21l-8.5-4.5z"/><path d="M3.5 7.5L12 12l8.5-4.5M12 12v9"/>',
  Combat:'<circle cx="12" cy="12" r="7.5"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/>',
  Bomber:'<path d="M12 2.5c3 0 4.2 3.2 4.2 7.3S14.1 16.9 12 18c-2.1-1.1-4.2-4.1-4.2-8.2S9 2.5 12 2.5z"/><path d="M9.6 16.7L8 21.5h8l-1.6-4.8"/>',
  Mining:'<path d="M3 21l7-7"/><path d="M10 14l4-10 6 6-10 4z"/>',Salvage:'<path d="M4 20l6-6M14 4l6 6-4 1-3 3-3-3 3-3z"/><path d="M8 12l4 4"/>',
  Exploration:'<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',Science:'<path d="M9 3h6M10 3v6l-5 9a2 2 0 002 3h10a2 2 0 002-3l-5-9V3"/>',
  Medical:'<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"/>',Refuel:'<path d="M12 3s6 6.5 6 11a6 6 0 01-12 0c0-4.5 6-11 6-11z"/>',
  Repair:'<path d="M14.5 5.5a4 4 0 00-5 5L3 17l4 4 6.5-6.5a4 4 0 005-5l-2.5 2.5-2.5-.5-.5-2.5z"/>',
  Passenger:'<circle cx="12" cy="7" r="3.5"/><path d="M5 21c0-4 3-7 7-7s7 3 7 7"/>',Racing:'<path d="M4 21V4l8 3 8-3v11l-8 3-8-3"/>',
  Starter:'<path d="M12 2l2.9 6.3 6.6.6-5 4.5 1.5 6.6L12 16.6 6 20l1.5-6.6-5-4.5 6.6-.6z"/>',
  Industrial:'<path d="M3 21V10l6 4V10l6 4V5h6v16z"/>',Ground:'<rect x="3" y="9" width="18" height="7" rx="2"/><circle cx="7.5" cy="17.5" r="2"/><circle cx="16.5" cy="17.5" r="2"/><path d="M6 9l2-4h8l2 4"/>',
  pad:'<rect x="3.5" y="3.5" width="17" height="17" rx="2"/><path d="M9 16V8h3.5a2.5 2.5 0 010 5H9"/>',maker:'<path d="M4 21V8l8-5 8 5v13"/><path d="M9 21v-6h6v6"/>',
  all:'<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>'};
const VH_OFF={Cargo:"hauler",Exploration:"exploration",Ground:"ground",ship:"hangar",
  Industrial:"utilityItems"};   // (Mining and Salvage have their own, below and in VH_ICON)
// aUEC: the game's credit mark, for "Sold in game"
const VH_UEC='<path fill="currentColor" fill-rule="evenodd" d="M4.325 14.205c.034-.162.065-.325.103-.486.046-.19.052-.374.017-.57a7 7 0 0 1-.092-1.81c.01-.124.012-.25.018-.375-.153.17-.274.343-.39.52a.3.3 0 0 0-.03.131c-.034.886.084 1.75.374 2.59m15.383.011c.016-.05.035-.099.049-.15.2-.708.276-1.43.313-2.165.02-.41-.223-.65-.421-.937a1 1 0 0 0-.004.255c.059.613.05 1.227-.074 1.829-.085.413.047.782.137 1.168M5.733 16.9c-.036-.197-.071-.352-.09-.51a1.6 1.6 0 0 0-.214-.591 14 14 0 0 1-.552-1.124c-.122-.278-.206-.572-.32-.896l-.162.744c.308.87.87 1.88 1.338 2.377m12.578-.03q.028-.027.052-.057c.479-.619.847-1.3 1.157-2.018.156-.362-.036-.658-.08-.984-.191.653-.422 1.285-.787 1.85-.243.377-.295.787-.341 1.21ZM16.922 5.926l-.014.027.072.062a7.2 7.2 0 0 1 1.416 1.614c.197.314.519.447.802.644a7.4 7.4 0 0 0-1.569-2.192zM4.792 8.263l.03.03c.132-.093.261-.194.4-.279.174-.107.299-.253.41-.423a7.4 7.4 0 0 1 1.367-1.554l.133-.12-.756.162A7.9 7.9 0 0 0 4.79 8.263Zm-1.253 2.392c-.016.013-.031.018-.035.029q-.01.027-.012.057c-.093.857-.094 1.712.054 2.564.045.26.328.654.569.798 0-.013.005-.027.002-.038A8.2 8.2 0 0 1 3.82 11.5a.4.4 0 0 0-.018-.135q-.128-.354-.263-.71M4.581 7.59a8 8 0 0 0-1.02 2.716l.265.72c.112-.8.289-1.57.616-2.293.171-.376.134-.756.14-1.143Zm14.835.002c0 .151.004.302 0 .453-.008.23.058.439.135.655q.255.714.452 1.444c.078.286.107.585.166.916l.274-.755a7.9 7.9 0 0 0-1.027-2.713M5.05 12.79c.35 3.305 3.188 5.778 6.029 6.023v-.268c-3.205-.647-5.113-2.555-5.75-5.754zm7.766-7.486c3.207.639 5.12 2.55 5.758 5.752h.278c-.36-3.411-3.355-5.84-6.036-6.01zm-1.734-.277c-3.26.347-5.777 3.144-6.023 6.03h.268c.646-3.204 2.555-5.112 5.755-5.752zm7.493 7.769c-.65 3.208-2.56 5.112-5.755 5.748v.277c3.044-.306 5.7-2.886 6.032-6.025zm-6.62 5.397a6.27 6.27 0 0 0 6.263-6.276 6.265 6.265 0 0 0-6.26-6.258 6.27 6.27 0 0 0-6.276 6.264c-.001 3.457 2.816 6.274 6.272 6.27Zm-4.015.185-.08-.039.054.065c.08.139.166.273.235.416a.57.57 0 0 0 .328.3l1.475.554q.107.041.215.085l-.012.06c-.078-.007-.162.001-.233-.025-.494-.178-.984-.368-1.478-.545a2.7 2.7 0 0 0-.495-.128c-.175-.028-.355-.03-.533-.042.537.436 1.939 1.04 2.588 1.145.026.004.054.01.078.005.459-.101.816.148 1.227.341l-.782.467.014.041c.256.011.525.075.767.02.248-.057.47-.23.742-.37.39.42.885.462 1.44.313l-.805-.477c.252-.111.457-.22.675-.293.141-.047.3-.043.45-.058.118-.013.24-.003.352-.032a8.5 8.5 0 0 0 2.307-.983q.07-.047.14-.096c-.163-.015-.314.01-.465.01-.239-.001-.449.077-.668.167-.46.191-.933.351-1.403.518-.068.024-.148.013-.223.018l-.008-.058q.099-.041.198-.08c.468-.172.933-.355 1.405-.513.378-.126.46-.475.659-.76-.043-.005-.056-.01-.065-.007a3 3 0 0 0-.14.079 8.2 8.2 0 0 1-1.827.793c-.148.044-.293.12-.423.207a5.2 5.2 0 0 1-1.377.67.93.93 0 0 1-.568-.01 5 5 0 0 1-1.404-.705.8.8 0 0 0-.243-.131 8 8 0 0 1-2.117-.922m9.406-13.244L17.3 5.1l-.018.018.035.047c.045.117.094.233.135.352.082.243.226.439.41.622.53.528.964 1.131 1.326 1.786.02.036.046.067.081.119v-.758a8.6 8.6 0 0 0-1.922-2.15Zm2.587 8.958c.121-.133.251-.259.359-.401a.8.8 0 0 0 .15-.312c.147-.744.164-1.495.111-2.25-.01-.157-.037-.313-.056-.47a5 5 0 0 0-.285.674.5.5 0 0 0-.027.175 8.4 8.4 0 0 1-.291 2.55l-.013.092zm-1.02 2.78c-.114.053-.227.11-.343.158-.244.1-.44.255-.62.452a7.7 7.7 0 0 1-1.662 1.364l-.145.092c.173.019.336-.009.498-.008.206.002.365-.082.524-.204a8.8 8.8 0 0 0 1.814-1.87l-.018-.017zM6.66 5.135a8.5 8.5 0 0 0-1.924 2.156v.776c.047-.078.08-.132.111-.187.338-.616.736-1.192 1.242-1.677.309-.296.462-.655.6-1.035l.045-.08zM5.497 16.908l.045.014.03-.034-.05-.01c-.49-.666-.912-1.372-1.188-2.153-.124-.35-.417-.545-.638-.808a.2.2 0 0 0 .002.105c.177.678.445 1.318.761 1.943.207.407.466.734.913.881.044.015.084.041.125.062m-.409-.036-.065-.042c.02.041.026.056.034.07a8.6 8.6 0 0 0 1.746 1.795c.276.21.69.308 1.063.245l-.07-.047a8.2 8.2 0 0 1-1.924-1.602.4.4 0 0 0-.12-.102c-.22-.109-.442-.212-.664-.317m15.237-2.95c-.164.166-.331.328-.49.5a.6.6 0 0 0-.12.201 8.4 8.4 0 0 1-1.262 2.284l.019.019.056-.038c.443-.153.799-.402.98-.859.066-.165.168-.316.243-.48.242-.524.46-1.058.568-1.63l.004-.005zm-1.57-5.72-.001-.01c-.007-.007 0 0 .006.008.033.072.062.146.097.216a7 7 0 0 1 .651 1.878c.07.375.336.618.512.922a7.6 7.6 0 0 0-.655-2.643c-.12-.079-.222-.152-.33-.217-.09-.056-.186-.103-.28-.153ZM5.227 8.189l-.586.382a7.5 7.5 0 0 0-.654 2.65c.173-.314.447-.561.517-.944.069-.37.187-.733.314-1.089.12-.336.282-.657.425-.984l.028-.025-.01-.013zm2.711 10.64.08.041-.053-.074q-.088-.155-.176-.312a1.8 1.8 0 0 0-.506-.578 7 7 0 0 1-1.375-1.387q-.045-.056-.093-.109.007.294.07.563a.66.66 0 0 0 .13.28 7.8 7.8 0 0 0 1.923 1.576m10.25-2.445-.002.038c-.014.338-.02.67-.288.946-.559.575-1.17 1.08-1.88 1.47.2-.285.304-.629.603-.851a7 7 0 0 0 1.569-1.605zM11.99 6.275c3.104.01 5.628 2.558 5.617 5.674a5.655 5.655 0 0 1-5.663 5.628c-3.124-.006-5.66-2.548-5.651-5.664.009-3.126 2.557-5.647 5.697-5.638M12.68 2c.037.011.073.03.11.033 1.583.123 3.06.583 4.405 1.425 2.607 1.631 4.175 3.97 4.69 7.007l.115.655v1.8c-.015.032-.037.062-.043.096-.107.555-.174 1.12-.322 1.664-1.052 3.879-4.445 6.79-8.419 7.25-.113.013-.48.046-.591.07h-1c-.033-.014-.569-.037-.602-.042-.231-.033-.464-.055-.693-.095-2.17-.38-4.026-1.357-5.55-2.947-1.457-1.52-2.343-3.329-2.665-5.411-.042-.275-.077-.55-.115-.825v-1.36c.012-.043.028-.086.034-.13.063-.427.1-.86.19-1.282a9.77 9.77 0 0 1 2.693-4.96c1.554-1.556 3.424-2.502 5.6-2.835.267-.04.535-.075.803-.113zm-.712 4.097c-3.21-.012-5.84 2.608-5.848 5.827-.008 3.188 2.613 5.82 5.805 5.83a5.84 5.84 0 0 0 5.855-5.817c.008-3.206-2.6-5.828-5.812-5.84m1.38.856v3.782h-.973V7.734h-.777v3.66h1.74v.967h-1.741v3.752h.767v-2.88h.981v3.665c-.904.278-1.812.228-2.73.01v-9.97a5.2 5.2 0 0 1 2.732.015Zm-3.246.136v9.633c-.834-.333-1.532-.824-2.08-1.506a6 6 0 0 1-.455-.67l-.14-.23-.072-.116a.53.53 0 0 1-.063-.264 777 777 0 0 1 0-4.04.6.6 0 0 1 .052-.248 5.2 5.2 0 0 1 .844-1.231c.016-.018.037-.031.08-.067v.218q-.002 2.61.005 5.22c0 .118.041.25.102.352.192.326.431.617.75.896V7.604zm3.763.052c1.36.452 2.804 1.882 3.12 3.596q-.048.008-.096.011h-.79c-.252-.747-.638-1.405-1.25-1.953v2.61h2.271v.956h-2.274v2.65a4.6 4.6 0 0 0 1.176-1.775h.923c-.048 1.177-1.72 3.066-3.08 3.47z" clip-rule="evenodd"/>';
// Pad sizes: the size letters in a square (XS, S, M, L, XL)
const vhPadIcon=p=>{ const g=GAME_ICONS.landingzone;    // the game's landing zone mark, the size beside it (as the hangar icons have)
  return `<svg class="ofc vh-pad" viewBox="0 0 64 64" aria-hidden="true"><g transform="translate(-10,5)">${g[1]}</g><text x="64" y="25" text-anchor="end" font-size="${p.length>1?23:30}">${esc(p)}</text></svg>`; };
const vhIcon=k=>{ if(k==="uec") return `<svg class="ofc" viewBox="0 0 24 24" aria-hidden="true">${VH_UEC}</svg>`;
  const gk={rent:"rent_vehicle",Mining:"mining",Salvage:"salvageable",Refuel:"fuel_tanks",Starter:"vehicle_small"}[k];
  if(gk) return gameIcon(gk);                                                                      // the game's own marks
  if(String(k).startsWith("pad:")) return vhPadIcon(k.slice(4));
  if(VH_OFF[k]) return offIcon(VH_OFF[k]); if(String(k).startsWith("brand:")){ const u=S.brands?.[k.slice(6)];      // a maker's own logo, from the wiki
    if(u) return `<i class="brand-ic" style="-webkit-mask-image:url('${u}');mask-image:url('${u}')" aria-hidden="true"></i>`; k="maker"; }
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${VH_ICON[k]||VH_ICON.ship}</svg>`; };
// My Fleet: a small logo tile for each ship in the list, and the large maker panel on the ship's page
function brandTile(maker){ const c=brandOf(maker), u=c&&S.brands?.[c];
  return `<span class="fl-logo" title="${esc(maker||"")}">${u?`<i class="brand-ic" style="-webkit-mask-image:url('${u}');mask-image:url('${u}')" aria-hidden="true"></i>`:`<b>${esc((maker||"?").trim().charAt(0).toUpperCase())}</b>`}</span>`; }
// The maker's logo in the upper right of a ship's title area (Vehicles and My Fleet). Clickable on the
// Vehicles page, where it opens every vehicle by that maker.
const makerLogo=m=>{ const c=brandOf(m); return (c&&S.brands?.[c])||S.brands?.["cmp:"+String(m||"").toLowerCase().replace(/[^a-z0-9]/g,"")]||null; };
// Fetch every maker logo once, in the background, then redraw whichever page wanted them
// Logos that ship with Quantum, used before the wiki's: makers whose wiki logo is missing or wrong. Embedded
// as data, since a CSS mask won't load a separate local file (the page's own folder counts as another site).
const LOCAL_BRANDS={"cmp:gnp":"data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIGRhdGEtbmFtZT0iTGF5ZXIgMSIgdmlld0JveD0iMCAwIDgwMCA2MDAiPjxwYXRoIGQ9Ik0yMjguNSAzMzIuMWMtNTAuNSAwLTc4LjUtMjcuNy03OC41LTc5LjdzMjkuNi03OS41IDg0LjUtNzkuNWg2NC44djM0LjRoLTYwLjdjLTI5LjUgMC0zOC45IDE0LjItMzguOSA0NS4xIDAgMzEuNiA4IDQ2LjYgMzYuMyA0Ni42aDI3Ljd2LTI5aC0zMC4zdi0yOWg3Ni4ydjEzN2gtNDUuOXYtNDUuOGgtMzUuMnpNNTYzLjIgMjk3LjljMjcgMCAzNi41LTggMzYuNS00NHMtOC41LTQ2LjktMzYuNS00Ni45aC0yMS44djkwLjl6bS03MS4zLTEyNS4xaDc2LjJjNTIuMSAwIDgxLjkgMjQuMSA4MS45IDc5LjIgMCA1My42LTI5LjYgODAtODIuMiA4MGgtMjYuNHY0NS44aC00OS41ek00MzIuNSAxNzIuOHY5OS43bC01Ni05OS43aC01MS4zdjE1OS4zaDQyLjNWMjMxLjNsNTYuNyAxMDAuOGg1MC42VjE3Mi44aC00Mi4zek0yNjkuNyA0MTIuMUgyNjhWNDA5aDQuOHYxMy4yYTQuOCA0LjggMCAxMS05LjYgMHYtMjIuNWE0Ljc1NiA0Ljc1NiAwIDExOS41IDB2NS45aC0zLjJ2LTYuMWExLjU1IDEuNTUgMCAwMC0xLjYtMS43IDEuNTI2IDEuNTI2IDAgMDAtMS41IDEuN3YyMi44YTEuNTg2IDEuNTg2IDAgMDAxLjUgMS43IDEuNTUgMS41NSAwIDAwMS42LTEuN3YtMTAuMnpNMjc5LjQgNDEwLjdoLjhjMS40IDAgMi0uNyAyLTIuNXYtNy40YzAtMS44LS42LTIuNi0yLTIuNmgtLjh6bTEgM2gtMXYxM2gtMy4ydi0zMS42aDQuM2MyLjcgMCA0LjggMS41IDQuOCA1LjN2Ny45YzAgMi41LS45IDQtMi4zIDQuN2wyLjUgMTMuNmgtMy4yek0yOTQuMSAzOTkuNWExLjU1IDEuNTUgMCAwMC0xLjYtMS43IDEuNTI2IDEuNTI2IDAgMDAtMS41IDEuN3YyMi44YTEuNTg2IDEuNTg2IDAgMDAxLjUgMS43IDEuNTUgMS41NSAwIDAwMS42LTEuN3ptLTYuNCAyMi43di0yMi41YTQuNjUzIDQuNjUzIDAgMDE0LjctNSA0Ljc1MSA0Ljc1MSAwIDAxNC45IDV2MjIuNWE0Ljc1MyA0Ljc1MyAwIDAxLTQuOSA1IDQuNjUzIDQuNjUzIDAgMDEtNC43LTVNMzA3LjEgMzk1LjFoMy4ydjI3LjFhNC43ODggNC43ODggMCAwMS00LjggNSA0LjY1MyA0LjY1MyAwIDAxLTQuNy01di0yNy4xaDMuMnYyNy4yYTEuNiAxLjYgMCAwMDEuNiAxLjcgMS41NSAxLjU1IDAgMDAxLjYtMS43di0yNy4yek0zMTcuMSA0MTAuOWguN2MxLjQgMCAyLS44IDItMi41di03LjZjMC0xLjgtLjYtMi42LTItMi42aC0uN3ptMCAzdjEyLjloLTMuMnYtMzEuNmg0LjNjMi43IDAgNC44IDEuNSA0LjggNS4zdjguMWMwIDMuOC0yLjEgNS4zLTQuOCA1LjN6TTMyNS42IDM5NS4xaDcuNnYzLjFoLTQuNFY0MDloNC4zdjMuMWgtNC4zdjExLjZoNC40djMuMWgtNy42di0zMS43ek0zNDguOCA0MjYuOGMtMS4zLTkuNS0yLjEtMTguMi0zLjItMjcuNy4xIDkuNS40IDE4LjIuNSAyNy43SDM0M3YtMzEuNmg0LjdjMS4zIDkuNSAyLjEgMTguMiAzLjIgMjcuNy0uNC05LjUtLjQtMTguMi0uNi0yNy43aDMuMXYzMS42ek0zNjMuMiAzOTkuNWExLjU1IDEuNTUgMCAwMC0xLjYtMS43IDEuNiAxLjYgMCAwMC0xLjYgMS43djIyLjhhMS42IDEuNiAwIDAwMS42IDEuNyAxLjU1IDEuNTUgMCAwMDEuNi0xLjd6bS02LjMgMjIuN3YtMjIuNWE0Ljc1NiA0Ljc1NiAwIDExOS41IDB2MjIuNWE0LjczIDQuNzMgMCAwMS00LjggNSA0LjY1MyA0LjY1MyAwIDAxLTQuNy01TTM3Ni4zIDM5NS4xaDMuMnYyNy4xYTQuNzg4IDQuNzg4IDAgMDEtNC44IDUgNC42NTMgNC42NTMgMCAwMS00LjctNXYtMjcuMWgzLjJ2MjcuMmExLjU4NiAxLjU4NiAwIDAwMS41IDEuNyAxLjU1IDEuNTUgMCAwMDEuNi0xLjd2LTI3LjJ6TTM4OS4zIDQyNi45aC00LjVsLTMuMy0zMS44aDMuNWMuNSA2LjMgMS41IDIxLjYgMi4xIDI3LjguNi02LjIgMS42LTIxLjYgMi4xLTI3LjhoMy41ek0zOTQuNiAzOTUuMWg3LjZ2My4xaC00LjRWNDA5aDQuM3YzLjFoLTQuM3YxMS42aDQuNHYzLjFoLTcuNnYtMzEuN3pNNDA3LjggNDE2LjFoMi44Yy0uNS01LjItMS4xLTEwLjctMS40LTE0LjJ6bTcuMiAxMC43aC0zLjVsLS43LTcuNmgtMy40bC0uNyA3LjZoLTMuNGw0LjItMzEuN2gzLjJ6TTQyMyAzOTUuMWgzLjJ2MjcuMWE0Ljc4OCA0Ljc4OCAwIDAxLTQuOCA1IDQuNjUzIDQuNjUzIDAgMDEtNC43LTV2LTI3LjFoMy4ydjI3LjJhMS41ODYgMS41ODYgMCAwMDEuNSAxLjcgMS41NSAxLjU1IDAgMDAxLjYtMS43ek00NDAuMSA0MTAuOWguN2MxLjQgMCAyLS44IDItMi41di03LjZjMC0xLjgtLjYtMi42LTItMi42aC0uN3ptMCAzdjEyLjloLTMuMnYtMzEuNmg0LjNjMi43IDAgNC44IDEuNSA0LjggNS4zdjguMWMwIDMuOC0yLjEgNS4zLTQuOCA1LjN6TTQ1MC42IDQxNi4xaDIuOGMtLjUtNS4yLTEuMS0xMC43LTEuNC0xNC4yem03LjIgMTAuN2gtMy41bC0uNy03LjZoLTMuNGwtLjcgNy42aC0zLjRsNC4yLTMxLjdoMy4yek00NjMgNDEwLjdoLjdjMS40IDAgMi0uNyAyLTIuNXYtNy40YzAtMS44LS42LTIuNi0yLTIuNmgtLjd6bTEgM2gtMXYxM2gtMy4ydi0zMS42aDQuM2MyLjcgMCA0LjggMS41IDQuOCA1LjN2Ny45YzAgMi41LS45IDQtMi4zIDQuN2wyLjUgMTMuNmgtMy4yek00NzQuNCA0MTYuMWgyLjhjLS41LTUuMi0xLjEtMTAuNy0xLjQtMTQuMnptNy4yIDEwLjdoLTMuNWwtLjctNy42SDQ3NGwtLjcgNy42aC0zLjRsNC4yLTMxLjdoMy4yek00ODYuOCA0MjMuN2gxYzEuNCAwIDItLjcgMi0yLjV2LTIwLjVjMC0xLjgtLjYtMi42LTItMi42aC0xem02LjEtMi4zYzAgMy44LTIuMSA1LjMtNC44IDUuM2gtNC41di0zMS42aDQuNWMyLjcgMCA0LjggMS41IDQuOCA1LjN6TTQ5Ni4zIDM5NS4xaDMuMnYzMS42aC0zLjJ6TTUwOS4xIDQxMi4xaC0xLjdWNDA5aDQuOHYxMy4yYTQuNjUzIDQuNjUzIDAgMDEtNC43IDUgNC43MyA0LjczIDAgMDEtNC44LTV2LTIyLjVhNC43NTYgNC43NTYgMCAxMTkuNSAwdjUuOUg1MDl2LTYuMWExLjU1IDEuNTUgMCAwMC0xLjYtMS43IDEuNiAxLjYgMCAwMC0xLjYgMS43djIyLjhhMS42IDEuNiAwIDAwMS42IDEuNyAxLjU1IDEuNTUgMCAwMDEuNi0xLjd2LTEwLjJ6TTUxOC4zIDM5OC4xYzAgOS41LjMgMTkuMi40IDI4LjdoLTMuMXYtMzEuNmg1LjRjLjggOS41IDEuMiAxNS43IDEuOCAyNS4yLjUtOS41LjktMTUuNyAxLjctMjUuMmg1LjV2MzEuNmgtMy4xYy4xLTkuNS40LTE5LjIuNC0yOC43LTEuMiA5LjUtMS44IDE5LjItMi42IDI4LjdINTIxYy0uOS05LjUtMS41LTE5LjItMi43LTI4LjdNNTMzLjYgMzk1LjFoNy41djMuMWgtNC4zVjQwOWg0LjJ2My4xaC00LjJ2MTEuNmg0LjN2My4xaC03LjV2LTMxLjd6TTMyNS4yIDM0OC45aDE0OS42djI5SDMyNS4yeiIvPjwvc3ZnPg=="};
// Manufacturer logos: asked for once (at startup, so they're in before any tab opens). Every tab that wants
// them registers a redraw; when they arrive the galleries are drawn again (their cached key is cleared, or the
// logos wouldn't show until something else changed, like clicking a vehicle).
S.brandWaiters=S.brandWaiters||[];
function brandsArrived(){ S.vehGalKey=null; S.cpGalKey=null; const w=S.brandWaiters.splice(0); for(const f of w){ try{ f(); }catch(e){ console.warn(e); } } }
function loadBrands(redraw){ if(S.brands&&Object.keys(S.brands).length>Object.keys(LOCAL_BRANDS).length){ return; }
  if(redraw){ S.brandWaiters.push(redraw); if(S.brandWaiters.length>8) S.brandWaiters.shift(); }
  if(S.brandsAsked) return; S.brandsAsked=true;
  api().brand_logos().then(b=>{ const got=b?.logos||{}; S.brands={...got,...LOCAL_BRANDS}; if(!Object.keys(got).length){ S.brandsAsked=false; setTimeout(()=>loadBrands(),20000); } brandsArrived(); })
    .catch(()=>{ S.brandsAsked=false; S.brands={...LOCAL_BRANDS}; brandsArrived(); setTimeout(()=>loadBrands(),20000); }); }
// First start with nothing cached: pull logos and vehicle pictures in the background right away, so the
// Vehicles, My Fleet and Components tabs have them when they're opened.
async function prefetchAssets(){
  loadBrands(()=>{ if(S.tab==="vehicles") renderVehicles(); else if(S.tab==="fleet") renderFleet(); else if(S.tab==="components"&&S.cpDetail) renderComponents(); });
  for(let i=0;i<20;i++){ await new Promise(r=>setTimeout(r,i?6000:8000));
    let urls=[]; try{ urls=await api().prefetch_photos(); }catch(_){ return; }
    if(urls.length){ S.prefetchImgs=[]; let k=0;
      const next=()=>{ if(k>=urls.length) return; const im=new Image(); im.referrerPolicy="no-referrer"; im.onload=im.onerror=next; im.src=urls[k++]; S.prefetchImgs.push(im); };
      for(let n=0;n<4;n++) next(); return; }
    if(!S.live?.log?.uex_token) return; } }
function titleLogo(maker,link,wide){ const u=makerLogo(maker); if(!u) return "";
  const ic=`<i class="brand-ic" style="-webkit-mask-image:url('${u}');mask-image:url('${u}')" aria-hidden="true"></i>`;
  if(wide) return `<span class="hd-logo wide" title="${esc(maker)}">${ic}</span>`;     // component makers: wide wordmarks
  return link?`<button class="hd-logo" data-vhcat="maker:${esc(maker)}" title="Every ${esc(maker)} vehicle">${ic}</button>`
    :`<span class="hd-logo" title="${esc(maker)}">${ic}</span>`; }
// Headline + readout: up to three numbers large, the rest in a quiet two-column list.
// Each stat is {label, value, delta (html, optional), changed (bool)}; empty values are left out.
function statBlock(hero,rest){ const has=x=>x&&x.value!=null&&x.value!=="";
  hero=hero.filter(has); rest=rest.filter(has); if(!hero.length&&!rest.length) return "";
  // Numbers never split across lines ("1,149,12 / 0"): they stay whole, and long ones get a smaller size to fit their box
  const big=v=>{ const m=String(v).match(/^([−\-+]?[\d.,]+)\s*([A-Za-z].*)$/); return m?`<span class="num">${esc(m[1])}</span><small>${esc(m[2])}</small>`:esc(v); };
  const fit=v=>{ const m=String(v).match(/^[−\-+]?[\d.,]+/), n=m?m[0].length:0; return n>=11?"fit3":n>=9?"fit2":n>=7?"fit1":""; };
  // One size for the whole row: the longest number decides it, so price, rent, crew and SCU all match
  const rowFit=["","fit1","fit2","fit3"][Math.max(0,...hero.map(x=>["","fit1","fit2","fit3"].indexOf(fit(x.value))))];
  return `<div class="hd-hero n${hero.length}">${hero.map(x=>`<div class="${x.changed?"chg":""} ${x.tone||""}"><span class="lab">${esc(x.label)}</span><b class="${rowFit}">${big(x.value)}</b>${x.delta?`<span class="dl">${x.delta}<small> from stock</small></span>`:""}</div>`).join("")}</div>`
    +(rest.length?`<div class="hd-read">${rest.map(x=>`<div class="r ${x.changed?"chg":""}"><span>${esc(x.label)}</span><b>${esc(x.value)}${x.delta?` ${x.delta}`:""}</b></div>`).join("")}</div>`:""); }
// The headline numbers keep to their box: when a value (a long price, "Not in shops", a long class name) is
// wider than its column at the CSS size, it steps down a pixel at a time until it fits (never below 10px).
// Every headline row is watched, so it refits when the window or the panel next to it changes size.
const heroFit=root=>{ for(const b of root.querySelectorAll("b")){ b.style.fontSize="";
    let px=parseFloat(getComputedStyle(b).fontSize)||16;
    while(b.scrollWidth>b.clientWidth+1&&px>10){ px-=1; b.style.fontSize=px+"px"; } } };
const heroRO=typeof ResizeObserver==="function"?new ResizeObserver(es=>{ for(const e of es) heroFit(e.target); }):null;
if(heroRO) new MutationObserver(()=>{ for(const h of document.querySelectorAll(".hd-hero:not([data-fit])")){ h.dataset.fit="1"; heroRO.observe(h); } })
  .observe(document.body,{childList:true,subtree:true});
// Which wiki brand icon a UEX manufacturer name goes with (Sc-icon-brand-<code>.svg)
const BRAND_CODE=[[/aegis/i,"aegs"],[/anvil/i,"anvl"],[/aopoa|xi.?an/i,"xnaa"],[/\bargo\b/i,"argo"],[/banu/i,"banu"],[/consolidated/i,"cnou"],
  [/crusader/i,"crus"],[/drake/i,"drak"],[/esperia/i,"espr"],[/gatac/i,"gama"],[/gallenson/i,"glsn"],[/kruger/i,"krig"],[/musashi|\bmisc\b/i,"misc"],
  [/origin/i,"orig"],[/roberts space|\brsi\b/i,"rsi"],[/grey'?s market/i,"greys"],[/greycat/i,"grey"],[/mirai/i,"mirai"],
  [/tumbril/i,"tmbl"],[/vanduul/i,"vanduul"]];
const brandOf=m=>(BRAND_CODE.find(([re])=>re.test(m||""))||[])[1];
const VH_ROLE_ORDER=["Starter","Cargo","Combat","Bomber","Mining","Salvage","Exploration","Medical","Refuel","Passenger","Racing","Industrial"];
const VH_PADS=["XS","S","M","L","XL"], VH_PAD_NAME={XS:"Extra small pad",S:"Small pad",M:"Medium pad",L:"Large pad",XL:"Extra large pad"};
// Every category with what it holds: [section, [{id, name, icon, test}]], empty ones left out.
function vehCategories(){ const V=S.veh||[], ships=V.filter(v=>!v.ground);
  const roles=VH_ROLE_ORDER.filter(r=>r!=="Ground").map(r=>({id:"role:"+r,name:r,icon:r,test:v=>!v.ground&&v.roles.includes(r)}));
  const pads=[...new Set(ships.map(v=>String(v.pad||"").toUpperCase()).filter(Boolean))]
    .sort((a,b)=>(VH_PADS.indexOf(a)+1||99)-(VH_PADS.indexOf(b)+1||99)||a.localeCompare(b))
    .map(p=>({id:"pad:"+p,name:VH_PAD_NAME[p]||`${p} pad`,icon:"pad:"+p,test:v=>!v.ground&&String(v.pad||"").toUpperCase()===p}));
  const makers=[...new Set(V.map(v=>v.maker).filter(Boolean))].sort().map(m=>({id:"maker:"+m,name:m,icon:brandOf(m)?"brand:"+brandOf(m):"maker",test:v=>v.maker===m}));
  const G=[["Everything",[{id:"all",name:"All vehicles",icon:"all",test:()=>true},{id:"buyable",name:"Sold in game",icon:"uec",test:v=>v.buy.length>0},
      {id:"rentable",name:"Rentable",icon:"rent",test:v=>v.rent.length>0}]],
    ["By manufacturer",makers],["Ships by role",roles],["Ground vehicles",[{id:"ground",name:"Ground vehicles",icon:"Ground",test:v=>v.ground}]],
    ["Ships by landing pad",pads]];
  return G.map(([sec,L])=>[sec,L.map(c=>({...c,count:V.filter(c.test).length})).filter(c=>c.count)]).filter(([,L])=>L.length); }
function vehCat(){ const id=S.vehCat?.id||"all";
  return vehCategories().flatMap(([,L])=>L).find(c=>c.id===id)||{id:"all",name:"All vehicles",test:()=>true}; }
// Vehicle search also understands names spelled out: some vehicles go by vowel-less codes (the ARGO ATLS, the
// ATLS GEO), so a typed word matches a name word with the same consonants in the same order ("atlas" → ATLS).
// Only for words of 4+ letters, so short searches stay exact.
const vhSkel=w=>w[0]+w.slice(1).replace(/[aeiouy]/g,"");
function vhMatch(hay,q){ hay=hay.toLowerCase().replace(/\bmk\s*/g,"mk "); q=q.replace(/\bmk\s*/g,"mk ");
  if(hay.includes(q)) return true;
  { const z=squash(q); if(z.length>=4&&squash(hay).includes(z)) return true; }
  const toks=hay.split(/[^a-z0-9]+/).filter(Boolean);
  return q.split(/\s+/).filter(Boolean).every(w=>hay.includes(w)||(w.length>=4&&/^[a-z]+$/.test(w)&&toks.some(t=>t.length>=3&&vhSkel(t)===vhSkel(w)))); }
function vehList(){
  const q=$("vh-search").value.trim().toLowerCase(), av=S.vehAvail||"", sort=S.vehSort||"price", cat=vehCat().test;
  const L=S.veh.filter(v=>cat(v)&&(!q||vhMatch(`${v.full} ${v.aka||""} ${v.maker} ${v.roles.join(" ")} ${v.concept?"concept":""}`,q))&&(!av||v[av].length));
  const cheapest=v=>v.buy[0]?.price??v.rent[0]?.price??9e12, dearest=v=>v.buy[0]?.price??v.rent[0]?.price??-1;
  return [...L].sort(sort==="scu"?(a,b)=>b.scu-a.scu||cheapest(a)-cheapest(b):sort==="name"?(a,b)=>a.full.localeCompare(b.full)
    :sort==="price_desc"?(a,b)=>dearest(b)-dearest(a):(a,b)=>cheapest(a)-cheapest(b)); }
// The sidebar: categories, the one shown highlighted. The big panel: that category's pictures.
function renderVehicles(){
  if(!S.veh) return;
  const cur=vehCat().id;
  $("vh-nav").innerHTML=vehCategories().map(([sec,L])=>`<div class="mk-h">${esc(sec)}</div>${L.map(c=>`<button class="cp-nav ${c.id===cur?"on":""}" data-vhcat="${esc(c.id)}"><span class="ic">${vhIcon(c.icon)}</span><span class="t">${esc(c.name)}</span><small title="Vehicles in this category">${c.count}</small><i>›</i></button>`).join("")}`).join("");
  if(S.vehDetail) return renderVehicleDetail(S.vehDetail);
  const L=vehList(), key=[cur,S.vehAvail,S.vehSort,$("vh-search").value,L.length].join("|");
  if(key!==S.vehGalKey){ S.vehGalKey=key; $("vh-gallery").dataset.detail=""; renderGallery(L); } }
// Pictures of the vehicles in the category, in place of the map while the Vehicles tab is open.
function renderGallery(L){
  const g=$("vh-gallery"), q=$("vh-search").value.trim(), c=vehCat(), all=c.id==="all";
  const sel=(id,opts,cur)=>`<select class="field" data-vhset="${id}">${opts.map(([v,t])=>`<option value="${v}" ${v===cur?"selected":""}>${t}</option>`).join("")}</select>`;
  g.innerHTML=`<div class="gh vh-head">${S.vehFrom?`<button class="btn small primary" data-act="vhfrom">← Back to ${esc(S.vehFrom.label||"Patch Hub")}</button>`:""}${all?"":`<button class="btn small" data-vhcat="all" title="Take the filter off: every vehicle">← All vehicles</button>`}<b>${q?`“${esc(q)}”${all?"":` in ${esc(c.name)}`}`:esc(c.name)}</b><span>${L.length} shown · click one for prices and where to get it</span>
      <span class="spacer"></span>${sel("avail",[["","Any"],["buy","Sold in game"],["rent","Rentable"]],S.vehAvail||"")}${sel("sort",[["price","Price: low to high"],["price_desc","Price: high to low"],["scu","Most cargo"],["name","A–Z"]],S.vehSort||"price")}</div>
    ${L.length?`<div class="grid">${L.map(v=>{ const b=v.buy[0], r=v.rent[0];
    return `<div class="vg" data-vg="${v.id}">${wishBtn({kind:"ship",name:v.full,uex_id:v.id,maker:v.maker||null,photo:typeof v.photo==="string"&&v.photo.startsWith("https://")?v.photo:null})}<div class="ph ph-g">${v.photo?`<img src="${esc(v.photo)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.outerHTML=phCard('vehicle')">`:phCard("vehicle")}</div>
      <div class="tx"><b>${esc(v.full)}</b>${v.aka?`<span class="muted" style="font-size:11.5px">${esc(v.aka)}</span>`:""}<span>${v.concept?`<span style="color:#f2c14e">Concept · not in game yet</span>`:b?money(b.price):r?`${gameIcon("rent_vehicle","mk-gi")}Rent ${shortMoney(r.price)}/day`:"Not sold in game"}${v.scu?` · ${v.scu} SCU`:""}</span></div></div>`; }).join("")}</div>`
      :`<div class="empty" style="margin-top:30px">Nothing here${q?` matches “${esc(q)}”`:""}.${all?"":` <a data-vhcat="all" style="cursor:pointer;text-decoration:underline">Show all vehicles</a>`}</div>`}
    ${uexCredit(S.vehAt)}`; }
function openVehCat(id){ S.vehCat={id}; S.vehDetail=null; S.vehGalKey=null; $("vh-gallery").scrollTop=0; renderVehicles(); }
$("vh-nav").onclick=e=>{ const c=e.target.closest("[data-vhcat]"); if(c) openVehCat(c.dataset.vhcat); };
$("vh-gallery").onchange=e=>{ const s=e.target.closest("[data-vhset]"); if(!s) return;
  if(s.dataset.vhset==="avail") S.vehAvail=s.value; else S.vehSort=s.value; S.vehGalKey=null; renderVehicles(); };
$("vh-gallery").onclick=async e=>{ if(e.target.closest("[data-act=vhfrom]")) return phBackFromVehicles();   // opened from the Patch Hub
  if(await tradeClick(e)) return;
  if(e.target.closest("[data-act=vhback]")){ const back=S.vehBack; S.vehDetail=null; S.vehGalKey=null; renderVehicles();
    // Back where you were in the list. Same list (filter, sort, search): the same scroll position; if it changed
    // meanwhile, the vehicle you opened is brought into view instead. Kept only while Quantum is open.
    const g=$("vh-gallery");
    if(back&&back.key===S.vehGalKey) g.scrollTop=back.top;
    else if(back) g.querySelector(`[data-vg="${CSS.escape(String(back.id))}"]`)?.scrollIntoView({block:"center"});
    return; }
  if(e.target.closest("[data-act=vhall]")){ return openVehCat("all"); }
  const vm=e.target.closest("[data-vdmod]"); if(vm&&S.vehDetail){ S.vdMod=S.vdMod||{}; S.vdMod[S.vehDetail]=vm.dataset.vdmod; return renderVehicleDetail(S.vehDetail); }
  const cat=e.target.closest("[data-vhcat]"); if(cat) return openVehCat(cat.dataset.vhcat);
  const c=e.target.closest("[data-vg]"); if(!c) return;
  S.vehBack={key:S.vehGalKey, top:$("vh-gallery").scrollTop, id:c.dataset.vg};      // where Back returns to
  S.vehDetail=c.dataset.vg; renderVehicles(); };
// ---- Modular ships (the RSI Galaxy): a module picker, and the ship's numbers with a module fitted.
// The picker is a row of buttons (attr: the data attribute its buttons carry); a concept module is marked.
const modPicker=(M,cur,attr)=>`<span class="lo-lab">Module</span><div class="seg-mini mod-seg">${M.modules.map(m=>
  `<button ${attr}="${esc(m.id)}" class="${m.id===cur?"on":""}" title="${esc(`${m.full||m.name}${m.concept?" (concept, not in the game yet)":""}${m.notes?`: ${m.notes}`:""}`)}">${esc(m.name)}${m.concept?`<small class="mod-c">concept</small>`:""}</button>`).join("")}</div>`;
const modTiers=m=>m?.medical_tiers?Object.entries(m.medical_tiers).sort((a,b)=>a[0]-b[0]).map(([t,n])=>`${n} × T${t}`).join(", "):"";
// How far away you can die and still regenerate in a ship's medical bed, by the bed's tier (Star Citizen Wiki,
// MedBed / Clinic pages, player-owned beds since 4.3.1). Tier 1's 750,000,000 km reaches across any system.
const MED_RESPAWN_KM={1:750000000,2:8000,3:50};
const medRespawn=t=>{ const km=MED_RESPAWN_KM[t]; return km==null?null:t===1?"Anywhere in the system":`Up to ${km.toLocaleString()} km`; };
const modBeds=m=>m?.medical_beds?`${m.medical_beds}${modTiers(m)?` (${modTiers(m)})`:""}`:null;
// A vehicle's specs (description, then crew, cargo, size, flight, quantum, defence, weapons, insurance): its
// page in Vehicles, and My Fleet for vehicles with no parts to change (the ATLS, rovers), so theirs isn't empty
// Crew always reads smallest first (2–4, 22–28): the sources sometimes hand the two numbers over swapped,
// or as one "4,2" string, so every number in them is gathered and sorted
const crewText=(...v)=>{ const n=v.flatMap(x=>String(x??"").match(/\d+/g)||[]).map(Number).filter(x=>x>0);
  if(!n.length) return null; const a=Math.min(...n), b=Math.max(...n); return a===b?String(a):`${a}–${b}`; };
const vehCrew=d=>crewText(d.crew_min,d.crew_max);
function vehSpecHtml(d,mod){
  const n=x=>x==null||x===""?null:Math.round(x).toLocaleString();
  const sec=(title,rows)=>{ rows=rows.filter(r=>r[1]!=null&&r[1]!==""&&r[1]!==0&&r[1]!=="0"); return rows.length?`<div class="vd-sec"><div class="mk-h">${title}</div>${rows.map(r=>`<div class="vd-row"><span>${r[0]}</span><b>${r[1]}</b></div>`).join("")}</div>`:""; };
  const crew=vehCrew(d);
  return `${d.description?`<div class="desc" style="margin:0 0 14px;max-width:none">${wikiDesc(d.description)}</div>`:""}
    <div class="vd-grid vd-flat gr-fill">
      ${sec("Crew & living",[["Crew",crew],["Seats",d.seats],["Jump seats",d.jump_seats],["Beds",d.beds],["Medical beds",mod?modBeds(mod):d.medical_beds],["Medical tier",d.medical_tier?`Tier ${d.medical_tier}`:null],["Respawn range",d.medical_tier?medRespawn(d.medical_tier):null],["Ejection seats",d.ejection],["Escape pods",d.escape_pods]])}
      ${sec("Cargo & storage",[["Cargo grid",d.scu?`${Number(d.scu).toLocaleString()} SCU`:null],["Refinery",d.refinery?`${d.refinery} refining reactors`:null],["Ore",d.ore?`${d.ore} SCU`:null],["Personal storage",d.storage_scu?`${d.storage_scu} SCU`:null],["Weapon lockers",d.lockers?`${d.lockers} slots`:null],["Landing pad",d.pad]])}
      ${sec("Size",[["Length",d.length&&`${d.length} m`],["Beam",d.beam&&`${d.beam} m`],["Height",d.height&&`${d.height} m`],["Mass",d.mass&&`${n(d.mass)} kg`],["Size class",d.size_class]])}
      ${sec("Flight",[["SCM",d.scm&&`${d.scm} m/s`],["Boost",d.boost&&`${d.boost} m/s`],["Max",d.max&&`${d.max} m/s`],["Pitch / yaw / roll",d.pitch&&`${d.pitch} / ${d.yaw} / ${d.roll} °/s`],["Hydrogen fuel",d.h_fuel&&`${d.h_fuel} SCU`]])}
      ${sec("Quantum",[["Speed",d.qt_speed&&`${fmtBig(d.qt_speed)}/s`],["Range",d.qt_range&&fmtBig(d.qt_range)],["Spool",d.qt_spool&&`${d.qt_spool} s`],["Quantum fuel",d.q_fuel&&`${d.q_fuel} SCU`]])}
      ${sec("Defence",[["Shield HP",n(d.shield)],["Shield type",d.shield_face],["Hull HP",n(d.hull)],["Armor HP",n(d.armor)],["Countermeasures",d.countermeasures],["IR / EM",d.ir&&`${fmtBig(d.ir)} / ${fmtBig(d.em)}`],["Cross-section",n(d.cs)]])}
      ${sec("Weapons",[["Pilot DPS",n(d.dps)],["Missiles",d.missiles],["Missile damage",n(d.missile_dmg)],["Turrets",d.turrets||null]])}
      ${sec("Insurance",[["Claim",d.claim&&`${d.claim} min`],["Expedite",d.expedite&&`${d.expedite} min`]])}
    </div>`; }
// A vehicle's own page: picture, roles, crew and beds, cargo, size, flight, quantum, defences, weapons.
async function renderVehicleDetail(id){
  const g=$("vh-gallery"), v=S.veh.find(x=>String(x.id)===String(id)); if(!v) return;
  if(g.dataset.detail!==String(id)) g.innerHTML=qLoader(`Loading ${v.full}…`); g.dataset.detail=String(id); g.scrollTop=0;
  S.vdCache=S.vdCache||{}; const d0=S.vdCache[id]||(S.vdCache[id]=await api().vehicle_detail(v.id)); if(S.vehDetail!==String(id)) return;
  // A modular ship: the numbers below are the picked module's (Base by default); the table compares them all
  const M=d0.modules, mod=M?(M.modules.find(x=>x.id===(S.vdMod?.[id]||M.current))||M.modules[0]):null;
  const d=mod?{...d0,scu:mod.scu??d0.scu,medical_beds:mod.medical_beds||null,medical_tier:mod.medical_tier||null,refinery:mod.refinery||null}:d0;
  const scu=mod?d.scu:v.scu;
  const crew=vehCrew(d);
  const cat=vehCat(), isAll=cat.id==="all";
  g.innerHTML=`<div class="row" style="gap:8px;margin-bottom:14px">${wlBackBtn("vehicles")}${S.vehFrom?`<button class="btn primary" data-act="vhfrom">← Back to ${esc(S.vehFrom.label||"Patch Hub")}</button>`:""}<button class="btn" data-act="vhback">← ${esc(cat.name)}</button>${isAll?"":`<button class="btn ghost" data-act="vhall">All vehicles</button>`}</div>
    <div class="mkp-head"><div class="mkp-img">${picShown(v.photo,"vehicle",v.full)}</div>
      <div class="hd-main"><div class="hd-title"><div><h2>${esc(v.full)}</h2><div class="sub">${esc(v.maker)}${d.career?` · ${esc(d.career)}`:""}</div></div>${titleLogo(v.maker,true)}</div>
        ${v.roles.length?`<div class="tags vd-tags">${v.roles.map(x=>`<span>${esc(x)}</span>`).join("")}</div>`:""}
        ${statBlock([{label:"Buy price",value:v.buy[0]?money(v.buy[0].price):"Not sold"},{label:"Rent price",value:v.rent[0]?`${money(v.rent[0].price)}/day`:"None"},
            {label:"Crew size",value:crew||"–"},{label:"SCU capacity",value:scu?`${Number(scu).toLocaleString()} SCU`:"None"}],
          [{label:"Beds",value:d.beds||null},{label:"Medical beds",value:d.medical_beds||null},{label:"Landing pad",value:d.pad||null}])}
        ${M?`<div class="lv-row" style="margin-top:12px">${modPicker(M,mod.id,"data-vdmod")}<span class="muted" style="font-size:12px">${mod.concept?`<span style="color:#f2c14e">Concept · not in game yet.</span> `:""}${esc(mod.notes||"")}</span></div>`:""}
        <div class="row gr-acts" style="gap:8px;margin-top:12px">${wishBtn({kind:"ship",name:v.full,uex_id:v.id,maker:v.maker||null,photo:typeof v.photo==="string"&&v.photo.startsWith("https://")?v.photo:null},"Add to wish list")}${v.store?`<button class="btn ghost" data-ext="${esc(v.store)}">RSI page</button>`:""}</div></div></div>
    ${M?`<div class="vd-sec vd-mods"><div class="mk-h">Modules</div><table class="mod-t"><thead><tr><th>Module</th><th class="num">Cargo</th><th class="num">Medical beds</th><th class="num">Refinery</th><th>Status</th></tr></thead><tbody>
      ${M.modules.map(m=>`<tr class="${m.id===mod.id?"on":""}" data-vdmod="${esc(m.id)}" title="Show ${esc(v.full)} with this module"><td><b>${esc(m.name)}</b><small>${esc(m.full||"")}</small></td>
        <td class="num">${m.scu?`${Number(m.scu).toLocaleString()} SCU`:"–"}${m.module_scu?`<small>${m.module_scu} in the module</small>`:""}</td>
        <td class="num">${m.medical_beds||"–"}${modTiers(m)?`<small>${esc(modTiers(m))}</small>`:""}</td>
        <td class="num">${m.refinery?`${m.refinery} reactors`:"–"}</td>
        <td>${m.concept?`<span style="color:#f2c14e">Concept</span>`:"In game"}</td></tr>`).join("")}</tbody></table>
      <div class="muted" style="font-size:11.5px;margin-top:8px">Click a module to see the ship with it. Modules are swapped at a port; in My Fleet each loadout can have its own.</div></div>`:""}
    ${vehSpecHtml(d,mod)}
    <div id="vd-extra"></div>
    <div class="vd-grid vd-shop vd-flat gr-fill"><div class="vd-sec"><div class="mk-h">Buy</div>${vehSpots(v.buy,"buy")}</div><div class="vd-sec"><div class="mk-h">${gameIcon("rent_vehicle","mk-gi")}Rent</div>${vehSpots(v.rent,"rent")}</div></div>
    <div class="uex-credit">${d.wiki?"Specs from the Star Citizen Wiki (api.star-citizen.wiki); ":"The Star Citizen Wiki has no record for this vehicle. "}roles and prices from UEX.</div>
    <div id="vd-compare"></div>`;
  vehExtras(v); if(typeof cmpVeh==="function") cmpVeh(v); }
// Under a vehicle's specs: what it can mine, harvest or salvage (and where), and what rides in it or what it
// rides in (snubs and rovers that dock on a ship).
const carryKey=n=>squash(n).replace(/^(rsi|origin|anvil|kruger|drake|misc|aegis|crusader|greycat|tumbril|argo|consolidatedoutland|cnou)/,"");
async function vehExtras(v){ const box=()=>S.vehDetail===String(v.id)?$("vd-extra"):null; if(!box()) return;
  const out=[], roles=v.roles||[];
  if(roles.includes("Mining")||roles.includes("Salvage")){ const cat=await resCatalog(); if(!box()) return;
    const kinds=roles.includes("Mining")?(v.ground?["roc","hand"]:["ship"]):[];
    const res=[...new Set(kinds.flatMap(k=>Object.keys(cat[k]||{})))].sort((a,b)=>a.localeCompare(b));
    const where=n=>[...new Set(kinds.flatMap(k=>(cat[k]?.[n]||[]).map(b=>b.body)))];
    const m=roles.includes("Mining")?(v.ground?"ROC mining":"Ship mining"):"Salvage";
    out.push(`<div class="vd-sec vd-wide"><div class="mk-h">${roles.includes("Mining")?"What it can mine":"What it salvages"}</div>
      <div class="gather-t" style="margin:2px 0 10px">${esc(GATHER[m].how)}</div>
      ${res.length?`<div class="res-chips">${res.map(n=>{ const w=where(n); return `<a data-mkopen="${esc(n)}" title="${esc(w.length?`Found on ${w.slice(0,8).join(", ")}${w.length>8?"…":""}`:"")}">${esc(n)}<span>${w.length}</span></a>`; }).join("")}</div>
        <div class="muted" style="font-size:11.5px;margin-top:8px">The number is how many planets, moons and belts list it (the Star Citizen Wiki). Click one for where to find it and its prices.</div>`
      :roles.includes("Salvage")?`<div class="res-chips"><a data-mkopen="Recycled Material Composite">Recycled Material Composite</a><a data-mkopen="Construction Materials">Construction Materials</a></div>`:""}</div>`); }
  let carry={}; try{ carry=(await api().vehicle_carry()).carries||{}; }catch(_){} if(!box()) return;
  const me=carryKey(v.full), byKey=k=>(S.veh||[]).find(x=>carryKey(x.full)===k);
  const carries=Object.entries(carry).filter(([c])=>carryKey(c)===me).flatMap(([,L])=>L);
  const rides=Object.entries(carry).filter(([,L])=>L.some(x=>carryKey(x)===me)).map(([c])=>c);
  const link=n=>{ const x=byKey(carryKey(n)); return x?`<a data-vhopen="${esc(String(x.id))}">${esc(x.full)}</a>`:`<span>${esc(n)}</span>`; };
  if(carries.length||rides.length) out.push(`<div class="vd-sec vd-wide"><div class="mk-h">${carries.length?"Carries":"Rides in"}</div>
      <div class="res-chips">${(carries.length?carries:rides).map(link).join("")}</div>
      ${carries.length&&rides.length?`<div class="mk-h" style="margin-top:12px">Rides in</div><div class="res-chips">${rides.map(link).join("")}</div>`:""}
      <div class="muted" style="font-size:11.5px;margin-top:8px">${carries.length?"Docks on it or rides in its garage, as the ship comes.":"Docks on or rides in these ships, as they come."}</div></div>`);
  const fh=await vehFitsHtml(v); if(!box()) return; if(fh) out.push(fh);
  const b=box(); if(b) b.innerHTML=out.length?`<div class="vd-grid vd-flat gr-fill">${out.join("")}</div>`:"";
  b?.querySelectorAll("[data-vfmore]").forEach(x=>x.onclick=()=>{ S.vfMore=(S.vfMore||new Set()); S.vfMore.add(x.dataset.vfmore); vehExtras(v); }); }
// ---- What fits inside (vehicle_fits.json, from citizen-starter-guide.com: worked out from real dimensions) and,
// for a small ship or vehicle, the ships it fits inside. Ship names are matched word by word (maker left out), the
// vehicles in each list by name keys ("cyclone" is every Cyclone).
const VF_MAKERS=new Set(["rsi","origin","anvil","kruger","drake","misc","aegis","crusader","greycat","tumbril","argo","consolidated","outland","cnou","esperia","gatac","aopoa","mirai","banu","grey","greys","market","vanduul","roberts","space","industries"]);
const vfTok=n=>String(n||"").toLowerCase().replace(/[’']/g,"").split(/[^a-z0-9]+/).filter(w=>w&&!VF_MAKERS.has(w));
const vfKey=n=>vfTok(n).join("");
async function vehFitsData(){ if(S.vehFits) return S.vehFits; try{ S.vehFits=await api().vehicle_fits(); }catch(_){ S.vehFits={ships:{},keys:{}}; } return S.vehFits; }
// the ship list entry for this vehicle: every word of the entry is in its name, the most specific one wins
function vfShipFor(full,ships){ const t=new Set(vfTok(full)); let best=null, bn=0;
  for(const n of Object.keys(ships)){ const w=vfTok(n); if(w.length&&w.every(x=>t.has(x))&&w.length>bn){ best=n; bn=w.length; } } return best; }
// a list entry -> the vehicle in Vehicles it opens (the shortest name with the most specific key)
function vfVehicle(label,keys){ const ks=keys[label]||[vfKey(label)];
  const hits=(S.veh||[]).filter(x=>{ const k=vfKey(x.full); return ks.some(q=>k.includes(q)); }).sort((a,b)=>a.full.length-b.full.length);
  return hits[0]||null; }
async function vehFitsHtml(v){ const d=await vehFitsData(), ships=d.ships||{}, keys=d.keys||{}; if(!Object.keys(ships).length) return "";
  const chip=(label,tight)=>{ const x=vfVehicle(label,keys); return x?`<a data-vhopen="${esc(String(x.id))}" class="${tight?"vf-tight":""}" title="${tight?"Tight fit: only just, or only some ways round":"Fits"}">${esc(label)}</a>`:`<span class="${tight?"vf-tight":""}">${esc(label)}</span>`; };
  const more=(id,list,mk,n=24)=>{ const all=S.vfMore?.has(id); return list.slice(0,all?list.length:n).map(mk).join("")+(list.length>n&&!all?`<a data-vfmore="${id}" class="vf-more">+${list.length-n} more</a>`:""); };
  const me=vfShipFor(v.full,ships), mine=me?ships[me]:null, k=vfKey(v.full);
  // the ships this one fits inside (it's in their lists)
  const inside=[], tightIn=[];
  for(const [ship,L] of Object.entries(ships)){ if(ship===me) continue;
    const hit=lbl=>(keys[lbl]||[vfKey(lbl)]).some(q=>k.includes(q));
    if((L.fits||[]).some(hit)) inside.push(ship); else if((L.tight||[]).some(hit)) tightIn.push(ship); }
  const shipChip=(n,tight)=>{ const t=vfTok(n), x=(S.veh||[]).filter(y=>{ const yt=new Set(vfTok(y.full)); return t.every(w=>yt.has(w)); }).sort((a,b)=>a.full.length-b.full.length)[0];
    return x?`<a data-vhopen="${esc(String(x.id))}" class="${tight?"vf-tight":""}">${esc(n)}</a>`:`<span class="${tight?"vf-tight":""}">${esc(n)}</span>`; };
  let h="";
  if(mine&&((mine.fits||[]).length||(mine.tight||[]).length)) h+=`<div class="mk-h">What fits inside <span class="muted" style="font-weight:400">${(mine.fits||[]).length} fit${(mine.tight||[]).length?` · ${(mine.tight||[]).length} tight`:""}</span></div>
    <div class="res-chips">${more("in",mine.fits||[],l=>chip(l,false))}${more("int",mine.tight||[],l=>chip(l,true),12)}</div>`;
  if(inside.length||tightIn.length) h+=`<div class="mk-h" style="${h?"margin-top:12px":""}">Fits inside <span class="muted" style="font-weight:400">${inside.length} ship${inside.length===1?"":"s"}${tightIn.length?` · ${tightIn.length} tight`:""}</span></div>
    <div class="res-chips">${more("out",inside,n=>shipChip(n,false))}${more("outt",tightIn,n=>shipChip(n,true),12)}</div>`;
  if(!h) return "";
  return `<div class="vd-sec vd-wide">${h}<div class="muted" style="font-size:11.5px;margin-top:8px">Worked out from each ship's and vehicle's real size, so treat it as a guide: <span class="vf-tight" style="padding:0 6px">dashed</span> ones are a tight fit (only just, or only some ways round). From <a data-ext="${esc(d.source||"https://citizen-starter-guide.com/what-fits-in-star-citizen-ships/")}" style="cursor:pointer;text-decoration:underline">Citizen Starter Guide</a>.</div></div>`; }
$("vh-search").addEventListener("input",()=>{ S.vehDetail=null; renderVehicles(); });

// ---- Components: a landing page of every category first; pick one to browse it with filters, open a
// part for its numbers and shops, and fit it to a ship in My Fleet.
const CP_KEY={Radar:["aim_range","Aim assist"],MissileLauncher:["missiles","Missiles"],WeaponGun:["dps","DPS"],Missile:["missile","Damage"],Shield:["shield_hp","Shield HP"],QuantumDrive:["qt_speed","Quantum speed"],
  Cooler:["coolant_make","Cooling"],PowerPlant:["power","Power output"]};
const CP_ICONS=[   // first match wins, so the specific ones ("Missile Racks") come before the general ("Missiles")
  [/\bemp\b/i,'<circle cx="12" cy="12" r="2.5"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/><path d="M6.3 6.3a8 8 0 000 11.4M17.7 6.3a8 8 0 010 11.4"/>'],
  [/interdiction|\bqed\b|enforcement/i,'<circle cx="12" cy="12" r="8"/><path d="M6.3 6.3l11.4 11.4"/><circle cx="12" cy="12" r="3"/>'],
  [/rocket\s*pod/i,'<rect x="3" y="7" width="13" height="10" rx="2"/><circle cx="7" cy="10.5" r="1.3"/><circle cx="12" cy="10.5" r="1.3"/><circle cx="7" cy="14" r="1.3"/><circle cx="12" cy="14" r="1.3"/><path d="M16 12h5"/>'],
  [/life\s*support/i,'<path d="M12 21s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.5-7 10-7 10z"/><path d="M8 12h2l1-2 2 4 1-2h2"/>'],
  [/towing/i,'<path d="M3 12h4M17 12h4"/><circle cx="9.5" cy="12" r="2.5"/><circle cx="14.5" cy="12" r="2.5"/>'],
  [/nozzle/i,'<path d="M3 9h9l3 3-3 3H3z"/><path d="M15 12h4M19 9.5v5M7 9V6"/>'],
  [/scraper/i,'<path d="M4 18l6-6M10 12l4-8 6 6-8 4z"/><path d="M3 21h8"/>'],
  [/bomb\s*rack/i,'<path d="M3 5h18M7 5v2.5M17 5v2.5"/><path d="M7 7.5c1.6 0 2.3 1.7 2.3 4s-1.2 3.9-2.3 4.6c-1.1-.7-2.3-2.3-2.3-4.6S5.4 7.5 7 7.5zM17 7.5c1.6 0 2.3 1.7 2.3 4s-1.2 3.9-2.3 4.6c-1.1-.7-2.3-2.3-2.3-4.6s.7-4 2.3-4z"/><path d="M5.8 16.1L5 19h4l-.8-2.9M15.8 16.1L15 19h4l-.8-2.9"/>'],
  [/missile\s*rack|rack/i,'<rect x="3" y="3.5" width="18" height="17" rx="2"/><path d="M8.5 17V9.5L10 6.5l1.5 3V17M12.5 17V9.5L14 6.5l1.5 3V17"/><path d="M3 17h18"/>'],
  [/torpedo\s*tube|tube/i,'<rect x="2.5" y="5" width="19" height="6" rx="3"/><rect x="2.5" y="13" width="19" height="6" rx="3"/><path d="M7 8h8l2 0M7 16h8"/>'],
  [/point\s*defen|pdc/i,'<path d="M5 20h14M7 20v-3a5 5 0 0110 0v3"/><path d="M12 11V8M12 5.5V3M15.8 12.2l2-2M8.2 12.2l-2-2M18 14.5h2.5M3.5 14.5H6"/>'],
  [/turret/i,'<path d="M4 20h16M6 20v-3.5a6 6 0 0112 0V20"/><path d="M13.5 12l7-5.5M14.6 13.4l7-5.5"/><circle cx="12" cy="16" r="1.4"/>'],
  [/bomb/i,'<path d="M12 2.5c3 0 4.2 3.2 4.2 7.3S14.1 16.9 12 18c-2.1-1.1-4.2-4.1-4.2-8.2S9 2.5 12 2.5z"/><path d="M9.6 16.7L8 21.5h8l-1.6-4.8M12 18v3.5"/>'],
  [/torpedo/i,'<path d="M2.5 12c0-1.8 1.4-2.8 3.6-2.8H17l4.5 2.8L17 14.8H6.1c-2.2 0-3.6-1-3.6-2.8z"/><path d="M5.5 9.2L4 6M5.5 14.8L4 18M17 9.2v5.6"/>'],
  [/missile/i,'<path d="M5 19l1.8-4.6 9.4-9.4c1.6-1.6 4-1.6 4-1.6s0 2.4-1.6 4l-9.4 9.4z"/><path d="M6.8 14.4L3.5 13.5l2.7-2.7M9.6 17.2l.9 3.3 2.7-2.7M14 7l3 3"/>'],
  [/flight\s*blade|blade/i,'<path d="M3 15c5-1 9-4 12-9l1.5 1.5C14 13 9 17 3 17z"/><path d="M13 18l8-2M16 9l5 1"/>'],
  [/cooler/i,'<path d="M12 2v20M4.5 6.5l15 11M19.5 6.5l-15 11"/><path d="M9 3.5l3 2.5 3-2.5M9 20.5l3-2.5 3 2.5"/>'],
  [/power/i,'<path d="M13 2L5 13.5h6L10 22l9-12h-6z"/>'],[/shield/i,'<path d="M12 2.5l8 3v6c0 5-3.5 8.8-8 10-4.5-1.2-8-5-8-10v-6z"/>'],
  [/quantum|jump/i,'<circle cx="12" cy="12" r="8"/><path d="M15.5 15.5L20 20"/><circle cx="12" cy="12" r="3"/>'],
  [/radar|scanner/i,'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="M12 12l6-6"/>'],
  [/mining|salvage|tractor/i,'<path d="M3 21l7-7"/><path d="M10 14l4-10 6 6-10 4z"/>'],
  [/gun|cannon|repeater|weapon/i,'<rect x="2.5" y="9.5" width="8.5" height="6.5" rx="1.2"/><path d="M11 11.3h9.5M11 14.2h9.5M20.5 10v5.5"/><path d="M5 16v3.5h4"/><path d="M5 9.5V7.5h3"/>']];
// Star Citizen's own UI icons (16 × 16, filled shapes): used in place of drawn ones where the game has one
const OFF_ICONS={"quantumFuelTanks":"<path d=\"M1.926 4.506c.53-.923 1.707-1.2 3.575-.83.254-.808.6-1.454 1.015-1.915C6.954 1.254 7.44 1 7.992 1c1.084 0 1.915.9 2.514 2.675 1.845-.369 3.045-.092 3.575.83.53.923.162 2.1-1.084 3.507.577.645.969 1.268 1.153 1.845.208.622.185 1.176-.069 1.637-.392.646-1.107.992-2.19.992a6.2 6.2 0 0 1-1.362-.162C9.93 14.102 9.1 15 8.015 15c-.53 0-1.038-.254-1.476-.761-.415-.461-.76-1.107-1.015-1.937-.507.092-.968.16-1.383.16-1.084 0-1.822-.322-2.168-.99-.277-.462-.323-1.016-.093-1.638.185-.577.577-1.2 1.154-1.846-1.292-1.406-1.638-2.56-1.108-3.482m10.38 6.804c.391-.07.645-.185.76-.392q.174-.278-.069-.83c-.161-.393-.438-.808-.83-1.27-.277.278-.669.577-1.13.946-.046.508-.139.992-.23 1.454.576.115 1.083.138 1.498.092m-5.698.738c.185.576.416 1.015.67 1.36.253.3.484.462.691.462.23 0 .462-.162.715-.461.254-.323.485-.785.67-1.361l-1.385-.53zm-.392-1.43.07.3.3-.093zm3.46.3.07-.3-.185.115-.185.092zM6.424 5.29l.184-.115-.3-.093-.069.3zm2.952-.115.37.207-.07-.3zm.554 3.967v-2.26l-.946-.577c-.07-.046-.415-.208-.992-.53-.53.3-.876.484-.991.53l-.946.576a9 9 0 0 0-.07 1.13q0 .59.07 1.108c.438.3.761.484.946.6l.991.53zm1.2-1.338v.415l.253-.207zm1.867-1.868c.162-.37.185-.646.07-.854-.093-.184-.347-.323-.762-.369-.415-.069-.922-.046-1.499.07.092.46.162.945.23 1.476.439.3.808.622 1.131.922q.588-.657.83-1.245M8.684 2.638c-.253-.323-.484-.485-.715-.485-.207 0-.461.162-.692.485-.253.322-.484.76-.669 1.337l1.361.53 1.384-.53C9.17 3.4 8.938 2.96 8.684 2.638M3.68 11.31c.415.046.923.023 1.5-.093a9 9 0 0 1-.231-1.453c-.461-.346-.83-.668-1.153-.945-.392.461-.646.876-.808 1.268q-.242.554-.069.83c.116.208.37.324.761.393m.923-3.298.254.207-.023-.207.023-.208zm.576-3.206a6.4 6.4 0 0 0-1.06-.116c-.646 0-1.061.139-1.2.415-.115.185-.092.485.07.854.16.392.415.807.807 1.245.369-.323.76-.622 1.153-.922.023-.392.115-.877.23-1.476\"/>","weapons":"<path d=\"M4.46 11.602H1.625V4.26a4.1 4.1 0 0 1 .766-2.42l.504-.748c.08-.107.215-.107.29 0l.53.748c.504.72.767 1.57.767 2.42l-.027 7.347zm4.936 0H6.561V4.26a4.1 4.1 0 0 1 .766-2.42l.531-.748c.08-.107.214-.107.29 0l.53.748c.504.72.766 1.57.766 2.42l-.053 7.347zm4.931 0h-2.835V4.26a4.1 4.1 0 0 1 .766-2.42l.53-.748c.081-.107.215-.107.29 0l.53.748c.504.72.767 1.57.767 2.42l-.054 7.347zm-9.84 1.731H1.625v1.678h2.862zm4.931 0H6.556v1.678h2.862zm4.93 0h-2.862v1.678h2.862z\"/>","jumpModules":"<path d=\"M2.139 11.725h.126V4.267h-.126C1.51 4.267 1 4.773 1 5.398v.31c0 .046.027.09.068.112l.454.237a.13.13 0 0 1 .067.112v3.565a.13.13 0 0 1-.073.114l-.444.206a.13.13 0 0 0-.073.114v.427c.001.624.51 1.13 1.139 1.13m11.723 0h-.126V4.267h.126c.628 0 1.138.506 1.138 1.131v.31a.13.13 0 0 1-.068.112l-.454.237a.13.13 0 0 0-.067.112v3.565c0 .049.028.094.072.114l.445.206c.045.02.073.065.073.114v.427a1.136 1.136 0 0 1-1.139 1.13m-6.88-3.698a5.5 5.5 0 0 0 .993.988 5.8 5.8 0 0 0 1.047-1.042 5.5 5.5 0 0 0-.993-.988 5.7 5.7 0 0 0-1.046 1.042m1.02-.35c.18 0 .325.145.325.324a.325.325 0 0 1-.65 0c0-.179.144-.324.325-.324m1.243-.022q.15-.234.248-.455c.154-.352.18-.64.067-.752q-.071-.07-.223-.07c-.14 0-.325.046-.533.137a3.4 3.4 0 0 0-.457.247 6 6 0 0 1 .898.893M6.688 6.368q-.167 0-.248.08c-.122.121-.104.41.05.771q.103.24.265.49.205-.256.452-.5a6 6 0 0 1 .503-.45 3.3 3.3 0 0 0-.493-.264 1.5 1.5 0 0 0-.529-.127m.068 1.978q-.15.233-.249.455c-.154.351-.18.639-.067.752.151.15.623.064 1.214-.314a6 6 0 0 1-.474-.425 6 6 0 0 1-.424-.468m2.039.444q-.241.24-.505.448.254.163.495.264c.363.154.653.172.775.05s.104-.41-.05-.771a3 3 0 0 0-.265-.49 6 6 0 0 1-.45.5\"/><path d=\"M11.884 3.125H4.116l-1.015 1.01v7.73l1.015 1.01h7.768l1.015-1.01v-7.73zm.464 5.033-4.17 4.15a.24.24 0 0 1-.337 0l-4.17-4.15a.237.237 0 0 1 0-.335l4.17-4.148a.24.24 0 0 1 .336 0l4.171 4.15a.235.235 0 0 1 0 .333\"/><path d=\"m4.175 7.99 3.834 3.816 3.834-3.815L8.01 4.176zm4.48-1.817c.52-.228.936-.224 1.172.01s.24.648.011 1.167a4 4 0 0 1-.355.624q.235.339.373.663c.222.522.212.942-.03 1.182-.125.125-.3.188-.514.188q-.295 0-.673-.157a4 4 0 0 1-.669-.373c-.464.315-.937.523-1.31.523a.66.66 0 0 1-.485-.18c-.236-.234-.24-.647-.011-1.166.088-.201.209-.412.355-.624a4 4 0 0 1-.374-.663c-.221-.522-.211-.942.03-1.182s.663-.251 1.188-.03q.326.139.666.372a3.6 3.6 0 0 1 .625-.354\"/>","ground":"<path fill-rule=\"evenodd\" d=\"M2.168 4.517a.244.244 0 0 0-.301.107 7 7 0 0 0-.605 1.474.244.244 0 0 0 .137.288l.259.116a.25.25 0 0 1 .14.274.25.25 0 0 1-.236.205l-.28.008a.244.244 0 0 0-.237.214 7 7 0 0 0 0 1.593.244.244 0 0 0 .237.215l.295.008c.115.003.21.087.233.2a.246.246 0 0 1-.139.273l-.272.121a.244.244 0 0 0-.138.288q.22.78.605 1.475a.244.244 0 0 0 .302.107l.276-.106c.108-.041.23 0 .294.098a.25.25 0 0 1-.024.307L2.507 12a.244.244 0 0 0-.017.318c.328.419.703.8 1.118 1.134a.244.244 0 0 0 .32-.016l.208-.196a.254.254 0 0 1 .317-.023c.097.066.138.19.096.3l-.105.275c-.044.113 0 .24.105.3.458.26.949.47 1.464.623a.244.244 0 0 0 .291-.137l.114-.254a.26.26 0 0 1 .295-.143.26.26 0 0 1 .206.242l.008.288a.244.244 0 0 0 .212.238 7 7 0 0 0 1.59.015.244.244 0 0 0 .216-.238l.008-.277a.26.26 0 0 1 .228-.247.26.26 0 0 1 .284.145l.118.264c.049.11.17.17.287.138a7 7 0 0 0 1.473-.595.244.244 0 0 0 .108-.303l-.1-.264a.26.26 0 0 1 .1-.306l.022-.014a.26.26 0 0 1 .319.025l.21.2a.244.244 0 0 0 .32.017 7 7 0 0 0 1.129-1.114.244.244 0 0 0-.015-.321l-.198-.208a.26.26 0 0 1-.023-.322l.018-.026a.26.26 0 0 1 .304-.099l.274.105c.113.044.242 0 .301-.106q.388-.69.613-1.464a.244.244 0 0 0-.137-.29l-.262-.116a.26.26 0 0 1-.144-.288l.007-.037a.26.26 0 0 1 .243-.208l.287-.008a.244.244 0 0 0 .238-.214 7 7 0 0 0 0-1.586.244.244 0 0 0-.238-.215l-.274-.007a.26.26 0 0 1-.244-.211l-.008-.042a.26.26 0 0 1 .145-.285l.25-.112a.244.244 0 0 0 .137-.29 7 7 0 0 0-.614-1.463.244.244 0 0 0-.3-.106l-.241.092a.26.26 0 0 1-.306-.1l-.025-.04a.26.26 0 0 1 .024-.32l.172-.181a.244.244 0 0 0 .015-.321 7 7 0 0 0-1.13-1.115.244.244 0 0 0-.318.017l-.172.163a.26.26 0 0 1-.32.024l-.04-.027a.26.26 0 0 1-.1-.305l.081-.213a.244.244 0 0 0-.109-.303 7 7 0 0 0-1.473-.595.244.244 0 0 0-.287.138l-.091.205a.26.26 0 0 1-.285.146l-.043-.009a.26.26 0 0 1-.212-.244l-.006-.213a.244.244 0 0 0-.217-.238 7 7 0 0 0-1.589.016.244.244 0 0 0-.212.237l-.006.224a.26.26 0 0 1-.207.243l-.032.006a.26.26 0 0 1-.29-.144l-.087-.196a.244.244 0 0 0-.291-.137 7 7 0 0 0-1.465.623.244.244 0 0 0-.105.3l.085.223a.26.26 0 0 1-.096.302l-.014.01a.26.26 0 0 1-.323-.022l-.166-.158a.244.244 0 0 0-.321-.015q-.624.503-1.119 1.133a.244.244 0 0 0 .018.319l.177.186a.26.26 0 0 1 .026.317.26.26 0 0 1-.307.103zm1.283 3.452c0 2.525 2.036 4.572 4.549 4.572 2.512 0 4.55-2.047 4.55-4.572S10.511 3.397 8 3.397 3.45 5.444 3.45 7.969\" clip-rule=\"evenodd\"/><path fill-rule=\"evenodd\" d=\"M6.742 5.143a.625.625 0 0 0-1.011.735l.746 1.028c-.2.28-.327.616-.349.982l-1.175.382a.625.625 0 0 0 .387 1.19l1.135-.37c.221.31.534.549.9.678v1.17a.625.625 0 0 0 1.25 0v-1.17a1.9 1.9 0 0 0 .9-.677l1.135.368a.625.625 0 0 0 .387-1.189l-1.175-.382a1.87 1.87 0 0 0-.35-.982l.747-1.028a.625.625 0 0 0-1.011-.735L8.495 6.19a1.9 1.9 0 0 0-.99 0zm2.091 1.646q.003.002 0 0\" clip-rule=\"evenodd\"/>","fuelTanks":"<path d=\"M12.899 1H6.765L4.94 2.825h-.403l-.149-.133V2.47l-.568-.572h-.209L2 3.51v.226l.572.552h.234l.132.132v.403l-.306.306v8.793L3.712 15h9.187L14 13.906V2.156zM8.305 13.38a2.988 2.988 0 0 1-2.303-4.9c1.284-1.475 1.361-3.094 2.71-4.028-.403 1.57.842 2.819 1.865 4.027a2.989 2.989 0 0 1-2.288 4.906zM13.25 2.854H5.995L7.127 1.72h5.567l.556.532zM8.14 7.356A5.9 5.9 0 0 0 9.232 8.89c.117.133.233.262.346.403a1.667 1.667 0 1 1-2.55 0 6.5 6.5 0 0 0 1.056-1.809zm.165-1.12c-.56.656-.696 1.776-1.582 2.795a2.066 2.066 0 1 0 3.166 0c-.71-.842-1.584-1.587-1.584-2.795\"/>","utilityItems":"<path d=\"M10.397 1.66h3.936L15 1H1l.66.66h4.054v.629l.47.484H2.769l.65.646h3.155l-.003 3.79-.446.443v2.64l.446.455h.691c.038.767.121 1.185.715 1.728a1.1 1.1 0 0 1 .45.767.874.874 0 0 1-1.746.024.166.166 0 0 0-.169-.155.19.19 0 0 0-.176.172v.045a1.655 1.655 0 1 0 2.682-1.281 1.6 1.6 0 0 1-.505-1.286h.93l.446-.456V9.072l-.294-.301.003-5.352h2.959l.67-.66H9.906l.49-.49zM8.9 8.083l-.864-.874h-.764l.004-3.79h1.628z\"/>","coolers":"<path d=\"M13.081 7.784a5.5 5.5 0 0 0-.405-1.649c-.081-.162-.325-.189-.433-.027a4.7 4.7 0 0 1-1.81 1.622c-.27.135-.541.216-.784.297l-.352-.865c.379-.432.757-1.027.892-1.784a3.9 3.9 0 0 0-.027-1.486c-.054-.27-.243-.46-.486-.568-.514-.189-1.081-.27-1.676-.27-.19 0-.378 0-.568.027s-.27.243-.162.378c.46.541.892 1.27 1.027 2.27.027.244.054.46.054.676l-1.054.081C7 6.027 6.541 5.595 5.946 5.27a3.9 3.9 0 0 0-1.46-.405c-.243 0-.486.08-.648.297a4.9 4.9 0 0 0-.892 2.108c-.027.19.162.352.324.27a4.6 4.6 0 0 1 2.46-.35c.297.053.567.107.81.215l-.216.865a3.37 3.37 0 0 0-1.756.92c-.406.378-.676.81-.838 1.188a.76.76 0 0 0 .08.757 5.3 5.3 0 0 0 1.622 1.487c.163.108.379-.027.352-.217-.027-.675.054-1.54.513-2.378.19-.351.406-.649.622-.892l.757.46a3.7 3.7 0 0 0 .46 2.162c.27.486.62.838.945 1.108.19.135.46.19.676.108a5 5 0 0 0 1.892-1.243c.135-.135.054-.379-.135-.406-.676-.135-1.46-.405-2.19-1.054a5 5 0 0 1-.73-.838L9.109 9c.568.297 1.324.54 2.216.432.568-.08 1.027-.243 1.379-.459.216-.135.378-.351.378-.622zm-4.351 1A.74.74 0 0 1 8.324 9 .6.6 0 0 1 8 9.081c-.108 0-.19 0-.297-.054a1.1 1.1 0 0 1-.514-.297 1.04 1.04 0 0 1-.297-.622c0-.054-.027-.108-.027-.162 0-.135.027-.297.08-.405.109-.27.325-.487.569-.595.135-.054.297-.108.459-.108.108 0 .216 0 .297.054.298.081.568.27.676.567.081.163.135.325.135.514 0 .054 0 .108-.027.19 0 .242-.135.459-.324.62\"/><path d=\"M8 1.622c3.514 0 6.378 2.864 6.378 6.378S11.514 14.378 8 14.378 1.622 11.514 1.622 8 4.486 1.622 8 1.622M8 1C4.135 1 1 4.135 1 8s3.135 7 7 7 7-3.135 7-7-3.135-7-7-7\"/>","exploration":"<path d=\"M8.416 3.97V1c.37.058.777.256 1.132.555.567.478 1.016 1.111 1.414 1.996.053.116.1.233.151.359l.025.06zm4.254 3.633-.034-.387c-.03-.354-.058-.69-.107-1.028-.05-.345-.124-.692-.196-1.028-.027-.12-.048-.224-.074-.346h1.972c.018 0 .05.023.06.044.456.916.688 1.799.709 2.699q0 .037-.002.046l-.037.003c-.428-.003-2.29-.003-2.29-.003zm-.34 3.233c.073-.336.147-.683.197-1.027.051-.34.08-.674.107-1.028l.034-.387s1.862 0 2.286-.004q.033-.001.04.004c0 .007.004.019.002.046-.02.9-.252 1.783-.709 2.699a.14.14 0 0 1-.063.053c-.593.007-1.972.009-1.972.009q.036-.183.077-.363zm-1.192 1.192-.025.06q-.073.185-.15.36c-.4.884-.848 1.517-1.415 1.995-.355.299-.762.497-1.132.555v-2.97zm.317-.9c-.02.074-.12.073-.12.073-.789-.006-2.888 0-2.917 0-.007-.023-.007-2.792-.007-2.792h3.422c-.051 1.083-.169 1.948-.378 2.72m-3.034-6.31s2.127.004 2.917 0c.08 0 .096.011.117.088.21.77.327 1.604.377 2.686h-3.42l.007-2.768zm3.654-.843c-.076 0-.091-.01-.113-.085-.187-.64-.508-1.264-.982-1.912-.134-.182-.278-.36-.416-.534 1.288.506 2.346 1.335 3.22 2.528zm-1.511 10.581c.138-.173.282-.352.416-.534.473-.648.795-1.272.982-1.912.021-.073.036-.08.113-.08h1.709c-.874 1.192-1.932 2.022-3.22 2.526m-2.98-2.526V15c-.37-.058-.777-.257-1.132-.555-.567-.478-1.016-1.111-1.414-1.996a10 10 0 0 1-.151-.359l-.025-.06zM4.862 3.972l.025-.06q.074-.185.15-.36c.4-.884.848-1.517 1.415-1.995.355-.299.762-.497 1.132-.555v2.97zm-.317.934c.02-.075.037-.089.114-.089h2.92s.009 0 .009.007v2.768H4.166c.05-1.082.168-1.915.377-2.686zm.12 6.295c-.078 0-.096-.013-.115-.089-.209-.771-.332-1.62-.383-2.704H7.59v2.775s-.003.018-.017.018zm.354-9.223c-.474.648-.795 1.272-.983 1.912-.021.073-.037.085-.112.085h-.006l-1.704-.003c.874-1.193 1.932-2.022 3.22-2.528-.138.173-.282.352-.415.534m-1.1 10.047h.005c.075 0 .09.01.112.083.188.64.509 1.265.983 1.912.133.182.277.36.415.534-1.288-.506-2.346-1.335-3.22-2.527l1.704-.004zM1.004 7.59q-.001.001-.003-.004c0-.007-.002-.004 0-.028.02-.9.252-1.783.709-2.7.01-.02.026-.044.063-.044h1.969l-.074.347c-.072.336-.146.683-.196 1.028-.051.34-.08.674-.107 1.027-.011.128-.023.24-.036.37l-2.323.004zm-.001.804s.017-.003.036-.003l2.29.003c.006.255.092 1.076.14 1.415.052.343.125.692.197 1.028l.078.363-1.975-.01c-.022 0-.05-.031-.061-.052-.456-.916-.688-1.8-.709-2.7q0-.035.002-.045z\"/>","shipCapacity":"<path d=\"m8.168 4.354 2.194-1.28c.164-.11.164-.388 0-.5L8.168 1.295a.35.35 0 0 0-.33 0l-2.193 1.28c-.165.11-.165.389 0 .5l2.194 1.279q.165.082.329 0M4.923 6.932l2.229 1.287c.18.09.422-.05.434-.25L7.58 5.405a.36.36 0 0 0-.167-.29L5.185 3.829c-.18-.089-.422.05-.435.25l.006 2.565q.01.186.167.289m6.321-.29.006-2.565c-.013-.2-.254-.339-.435-.25L8.587 5.116a.36.36 0 0 0-.167.289l-.006 2.564c.012.2.254.34.434.25l2.228-1.287a.36.36 0 0 0 .168-.29m-6.826 4.212 2.194-1.28c.164-.11.164-.389 0-.5L4.418 7.795a.35.35 0 0 0-.33 0l-2.193 1.28c-.165.11-.165.389 0 .5l2.194 1.279q.165.083.329 0m-3.245 2.578 2.229 1.287c.18.09.422-.05.434-.25l-.006-2.564a.35.35 0 0 0-.167-.29l-2.228-1.287c-.18-.089-.422.05-.435.25l.006 2.565q.01.186.167.289m6.321-.289.006-2.565c-.013-.2-.254-.339-.435-.25l-2.228 1.288a.35.35 0 0 0-.167.289l-.006 2.564c.012.2.254.34.434.25l2.229-1.287a.35.35 0 0 0 .167-.29m4.424-2.288 2.194-1.28c.164-.11.164-.389 0-.5l-2.194-1.279a.35.35 0 0 0-.33 0l-2.193 1.28c-.165.11-.165.388 0 .5l2.194 1.279q.165.082.329 0m-3.245 2.578 2.229 1.287c.18.09.422-.05.434-.25l-.006-2.564a.36.36 0 0 0-.167-.29l-2.228-1.287c-.18-.089-.422.05-.435.25l.006 2.565q.01.186.167.289m6.321-.289L15 10.578c-.013-.2-.254-.339-.435-.25l-2.228 1.288a.36.36 0 0 0-.167.289l-.006 2.564c.013.2.254.34.434.25l2.228-1.287a.36.36 0 0 0 .168-.29\"/>","hauler":"<path d=\"M1 10.495c0-.28.195-.393.436-.253l1.823 1.061c.24.14.436.48.436.76v2.123c0 .28-.195.394-.436.254l-1.823-1.061A.97.97 0 0 1 1 12.618zm6-.253c.241-.14.436-.027.436.253v2.123c0 .28-.195.62-.435.76L5.177 14.44c-.24.14-.435.027-.435-.254v-2.122c0-.28.195-.62.435-.76zm1.564.253c0-.28.195-.393.435-.253l1.824 1.061c.24.14.435.48.435.76v2.123c0 .28-.195.394-.435.254l-1.824-1.061a.97.97 0 0 1-.436-.761zm6-.253c.24-.14.436-.027.436.253v2.123a.97.97 0 0 1-.436.76l-1.823 1.062c-.24.14-.436.027-.436-.254v-2.122c0-.28.195-.62.436-.76zm-10.788-2.3a1.05 1.05 0 0 1 .889 0l1.859.997c.245.131.245.344 0 .476l-1.86.996a1.05 1.05 0 0 1-.888 0l-1.859-.996c-.245-.132-.245-.345 0-.476zm7.564 0a1.05 1.05 0 0 1 .888 0l1.86.997c.245.131.245.344 0 .476l-1.86.996a1.05 1.05 0 0 1-.888 0l-1.86-.996c-.245-.132-.245-.345 0-.476zm-6.513-3.79c0-.28.195-.394.435-.254L7.086 4.96c.24.14.436.481.436.761v2.123c0 .28-.195.393-.436.253L5.262 7.035a.97.97 0 0 1-.435-.76zm6.001-.254c.24-.14.435-.026.435.254v2.122c0 .28-.195.621-.435.761L9.004 8.096c-.24.14-.436.027-.436-.253V5.72c0-.28.195-.62.436-.76zM7.603 1.599a1.05 1.05 0 0 1 .888 0l1.86.996c.245.132.245.345 0 .476l-1.86.997a1.05 1.05 0 0 1-.888 0l-1.86-.997c-.245-.131-.245-.344 0-.476z\"/>","shieldGenerator":"<path d=\"M13.474 12.062a.3.3 0 0 1-.205-.077c-.18-.128-.23-.357-.103-.537a6.2 6.2 0 0 0 1.047-3.475 6.2 6.2 0 0 0-1.047-3.475c-.127-.18-.077-.41.103-.537s.41-.078.537.102a6.94 6.94 0 0 1 1.177 3.885c0 1.406-.41 2.76-1.177 3.884-.102.18-.205.23-.332.23m-10.993 0a.37.37 0 0 1-.307-.152A6.9 6.9 0 0 1 1 8.023c0-1.407.41-2.761 1.177-3.885.127-.18.357-.205.537-.103.18.128.23.358.102.538-.714.996-1.074 2.173-1.074 3.45 0 1.276.357 2.453 1.047 3.474.127.18.077.41-.103.538-.05 0-.127.024-.205.024zm9.176-9.176a.3.3 0 0 1-.205-.077c-2.018-1.38-4.906-1.38-6.927 0-.18.127-.41.077-.537-.103s-.078-.41.102-.537C6.366.61 9.586.61 11.86 2.17c.18.128.23.357.102.537a.34.34 0 0 1-.307.18zM7.978 15a6.9 6.9 0 0 1-3.885-1.177c-.18-.127-.23-.357-.103-.537.128-.18.358-.23.538-.102 2.018 1.379 4.906 1.379 6.927 0 .18-.128.41-.078.537.102s.078.41-.102.537A7.03 7.03 0 0 1 7.98 15zm2.735-9.508L8.26 4.47l-.282-.127-.283.127-2.453 1.022-.46.18v2.326c0 1.251.615 2.403 1.637 3.092l1.149.767.41.283.41-.283 1.123-.767a3.72 3.72 0 0 0 1.637-3.092V5.672zm-.282 2.506c0 .996-.485 1.916-1.33 2.478l-1.124.767V5.135l2.454 1.021z\"/>","turrets":"<path d=\"M9.617 14.31h2.195v.44H2.891v-.66l2.994-.634-.715-2.234-2.059.523c-.658-.385-1.015-.607-1.674-.992L1 9.046 7.646 7.31l.22.882 6.647-1.737.331 1.267-6.646 1.737.22.882-1.784.523.826 2.62 1.868.248.3.58zM8.464 4.281l.22.882-5.299 1.379c-.658-.386-1.015-.607-1.674-.993l-.44-1.71 6.645-1.734.221.855 6.532-1.71L15 2.518 8.464 4.224z\"/>","radar":"<path d=\"M6.602 2.68q.015-.11.015-.222c0-.472-.202-.898-.523-1.195A7 7 0 0 1 8 1c1.442 0 2.783.436 3.897 1.184L10.81 3.27a5.5 5.5 0 0 0-4.208-.592M4.297 3.933a1.63 1.63 0 0 1-.913-1.195 7 7 0 1 0 10.452 1.396l-1.088 1.088a5.5 5.5 0 1 1-8.45-1.289\"/><path d=\"M6.065 10.12a1.63 1.63 0 0 1-1.01.582 3.937 3.937 0 0 0 6.488-4.275l-.88.879a2.816 2.816 0 0 1-2.718 3.534 2.8 2.8 0 0 1-1.88-.72m-.884-2.61a2.82 2.82 0 0 1 1.548-2.018 1.62 1.62 0 0 1-.05-1.193A3.94 3.94 0 0 0 4.026 7.66a1.62 1.62 0 0 1 1.156-.152\"/><path d=\"M13.36 3.498a7 7 0 0 0-.79-.8L8.498 6.77a1.374 1.374 0 1 0 .755.836zm-8.372-.162a.878.878 0 1 0 0-1.756.878.878 0 0 0 0 1.756m-.186 6.635a.878.878 0 1 0 0-1.756.878.878 0 0 0 0 1.756\"/><path d=\"M8.218 5.712a.878.878 0 1 0 0-1.757.878.878 0 0 0 0 1.757\"/>","hangar":"<path fill-rule=\"evenodd\" d=\"M7.52 1a.324.324 0 0 0-.322.27l-.264 1.598a.32.32 0 0 1-.199.246l-.927.372a.32.32 0 0 0-.197.354l.208 1.147a.31.31 0 0 1-.161.333l-3.99 2.178a.318.318 0 0 0-.058.521l1.312 1.14a.33.33 0 0 0 .288.073l1.796-.406a.325.325 0 0 1 .397.345l-.56 5.475c-.038.368.48.497.624.155l.505-1.2c.05-.12.17-.198.3-.198h3.455c.132 0 .25.078.3.198l.506 1.2c.144.342.662.213.625-.155l-.56-5.475a.324.324 0 0 1 .396-.345l1.796.406a.33.33 0 0 0 .288-.072l1.312-1.14a.318.318 0 0 0-.058-.522l-3.99-2.178a.32.32 0 0 1-.16-.333l.207-1.147a.32.32 0 0 0-.197-.354l-.927-.372a.32.32 0 0 1-.199-.246L8.802 1.27A.324.324 0 0 0 8.481 1zM8.8 9.889c.155 0 .29.109.32.26l.34 1.735a.322.322 0 0 1-.32.382H6.86a.322.322 0 0 1-.32-.382l.34-1.735a.326.326 0 0 1 .32-.26z\" clip-rule=\"evenodd\"/>","quantumDrives":"<path d=\"m11.476 7.39.025 1.17c1.46 1.338 1.875 2.337 1.68 2.678-.146.243-.804.34-1.948.073-.317-.098-.633-.17-.974-.293.146-.95.22-1.996.22-3.019 0-1.022-.098-2.07-.22-2.994.316-.098.657-.22.974-.293 1.169-.292 1.826-.17 1.948.073.146.268-.098.974-.974 1.973l.608.584c1.17-1.266 1.535-2.289 1.096-3.02-.292-.462-1.022-.924-2.897-.437-.292.097-.584.146-.925.292C9.723 2.327 8.993 1.01 7.97 1.01c-.876 0-1.607.999-2.045 2.727-.122.463-.243.974-.316 1.559l.973-.585c.366-1.947.999-2.848 1.388-2.848.439 0 .974.974 1.34 2.605-.853.34-1.778.828-2.679 1.388a23 23 0 0 0-2.24 1.607 10 10 0 0 1-.852-.877c-.755-.9-.974-1.534-.803-1.777.146-.292.95-.365 2.288.024.049-.243.098-.584.146-.852-1.631-.487-2.727-.365-3.165.34-.292.463-.34 1.316.901 2.776.243.293.536.585.877.901-.317.317-.61.585-.877.901-1.242 1.461-1.193 2.313-.9 2.776.267.438.754.633 1.509.633.438 0 .974-.098 1.534-.244-.05-.267-.098-.633-.147-.827-1.266.34-1.996.243-2.166 0-.147-.244.048-.877.803-1.802a10 10 0 0 1 .852-.877 21 21 0 0 0 2.24 1.607 23.5 23.5 0 0 0 2.678 1.388c-.365 1.631-.9 2.605-1.339 2.605-.39 0-1.022-.925-1.412-2.946l-.974-.608c.365 2.75 1.266 4.406 2.386 4.406 1.023 0 1.753-1.314 2.143-3.165.317.098.633.195.925.292.536.122.998.195 1.388.195.9 0 1.315-.316 1.51-.633.584-.974-.341-2.556-2.46-4.31m-2.02 3.288a19 19 0 0 1-2.387-1.242c-.73-.463-1.412-.95-2.02-1.437.584-.511 1.29-.974 2.02-1.436.804-.487 1.632-.925 2.387-1.218.097.78.17 1.68.17 2.679.024.95-.049 1.85-.17 2.654M7.97 7.268c.39 0 .73.317.73.731s-.316.73-.73.73A.717.717 0 0 1 7.24 8c0-.414.34-.73.73-.73\"/>","missiles":"<path d=\"M8.348 1h-.683L6.61 3.7h2.732zm.994 3.477H6.61v2.359l.373.745h1.986l.373-.745zM6.983 8.326h1.986v5.712H6.983zm-.745 5.712v-2.701l-1.863 1.738v1.894zm3.476.031v-2.7l1.863 1.737V15z\"/>","powerPlants":"<path d=\"M13.473 12.062a.3.3 0 0 1-.205-.077c-.18-.128-.23-.357-.103-.537a6.2 6.2 0 0 0 1.047-3.475 6.2 6.2 0 0 0-1.047-3.475c-.127-.18-.077-.41.103-.537s.41-.078.537.102a6.94 6.94 0 0 1 1.177 3.885c0 1.406-.41 2.76-1.177 3.884-.103.18-.205.23-.332.23m-10.993 0a.37.37 0 0 1-.307-.152A6.9 6.9 0 0 1 .999 8.023c0-1.407.41-2.761 1.177-3.885.127-.18.357-.205.537-.103.18.128.23.358.102.538-.714.996-1.074 2.173-1.074 3.45a6.1 6.1 0 0 0 1.046 3.474c.128.18.078.41-.102.538-.05 0-.127.024-.205.024zm9.176-9.176a.3.3 0 0 1-.205-.077c-2.018-1.38-4.906-1.38-6.927 0-.18.127-.41.077-.538-.103-.127-.18-.077-.41.103-.537C6.365.61 9.585.61 11.859 2.17c.18.128.229.357.102.537a.34.34 0 0 1-.308.18zM7.976 15c-1.406 0-2.76-.41-3.884-1.177-.18-.127-.23-.357-.103-.537.128-.18.357-.23.537-.102 2.019 1.379 4.907 1.379 6.928 0 .18-.128.41-.078.537.102s.078.41-.102.537A7.03 7.03 0 0 1 7.979 15zM9.53 3.898H6.741l-.766 4.457h1.559l-.93 3.829h.383l3.063-4.922H8.218z\"/>"};
OFF_ICONS.miningLasers='<path d="M6.238 9.783a.26.26 0 0 1 .313-.093l3.436 1.436c.059.024.106.07.133.127l1.357 2.885a.255.255 0 0 1-.233.362H3.522a.254.254 0 0 1-.213-.396zm8.641-2.28a.253.253 0 0 1 .06.38l-1.568 1.846a.25.25 0 0 0-.018.304l1.178 1.773a.254.254 0 0 1-.144.384l-2.392.68-.44-.934 1.204-.342a.254.254 0 0 0 .144-.385l-.831-1.25a.25.25 0 0 1 .018-.304l1.298-1.527a.253.253 0 0 0-.062-.38l-1.192-.734.605-.826zM8.828 1.59a.26.26 0 0 1 .412.027l1.144 1.756-.64.898-.62-.952a.26.26 0 0 0-.411-.028L7.569 4.618a.26.26 0 0 1-.32.058l-1.421-.78a.258.258 0 0 0-.38.193l-.184 1.568a.256.256 0 0 1-.218.223l-1.572.233a.254.254 0 0 0-.19.37l.736 1.379c.053.1.033.224-.05.302L2.869 9.215a.253.253 0 0 0 .068.414l1.635.762-.574.858-2.85-1.329a.253.253 0 0 1-.068-.414L2.7 7.962a.25.25 0 0 0 .05-.302L1.698 5.689a.254.254 0 0 1 .189-.37l2.228-.331a.256.256 0 0 0 .218-.222l.27-2.304a.257.257 0 0 1 .38-.193l2.03 1.113a.26.26 0 0 0 .32-.058zm3.166 1.256a.26.26 0 0 1 .359-.06l.837.592a.255.255 0 0 1 .06.356l-2.66 3.684.53.374a.253.253 0 0 1-.044.439L8.353 9.457a.257.257 0 0 1-.363-.256l.289-2.948a.258.258 0 0 1 .405-.183l.651.46z"/>';     // mining lasers (the game's miner icon)
// The game's own mobiGlas mission and common icons (64 × 64, filled): mining modules, salvage heads and scraper
// modules, EMP generators
const OFF_ICONS64={
  mining:'<polygon points="60.1,63.8 27.3,63.8 35.3,53 48.6,47.8"/><path d="M58.4,43L42.7,20.9l-2.4,2.5l-5-5l2.5-2.5L15.6,0.2l24.1,7.2c5.6,1.7,9.9,6,11.6,11.6L58.4,43z"/><rect x="15.9" y="20.7" transform="matrix(0.7071 0.7071 -0.7071 0.7071 33.3857 -2.2822)" width="7.1" height="36.8"/>',
  salvage:'<polygon points="37.3,3.9 37.3,13.8 44.3,20.8 39.7,20.8 36.4,24.1 27.5,24.1 24.2,20.8 19.7,20.8 26.7,13.8 26.7,3.9 19.7,3.9 19.7,0 44.3,0 44.3,3.9"/><path d="M16,26.7h5l3.4,3.4L14,40.5v14.2h-2.6L8.5,42.4c-0.7-2.9,0-6,1.8-8.4L16,26.7z"/><path d="M48,26.7h-5l-3.4,3.4L50,40.5v14.2h2.6l2.9-12.2c0.7-2.9,0-6-1.8-8.4L48,26.7z"/><rect x="23.2" y="46.4" width="17.6" height="17.6"/>',
  emp:'<path d="M16.8,43.5c-0.5,0-0.9-0.2-1.3-0.5c-5.6-5.6-5.6-14.7,0-20.3c0.7-0.7,1.8-0.7,2.6,0c0.7,0.7,0.7,1.8,0,2.6c-4.2,4.2-4.2,11,0,15.2c0.7,0.7,0.7,1.8,0,2.6C17.7,43.3,17.2,43.5,16.8,43.5z"/><path d="M9.6,48.3c-0.5,0-0.9-0.2-1.3-0.5c-8.3-8.3-8.3-21.7,0-29.9c0.7-0.7,1.8-0.7,2.6,0c0.7,0.7,0.7,1.8,0,2.6c-6.8,6.8-6.8,18,0,24.8c0.7,0.7,0.7,1.8,0,2.6C10.5,48.1,10.1,48.3,9.6,48.3z"/><path d="M47.2,43.5c-0.5,0-0.9-0.2-1.3-0.5c-0.7-0.7-0.7-1.8,0-2.6c2-2,3.1-4.7,3.1-7.6c0-2.9-1.1-5.6-3.1-7.6c-0.7-0.7-0.7-1.8,0-2.6c0.7-0.7,1.8-0.7,2.6,0c2.7,2.7,4.2,6.3,4.2,10.1c0,3.8-1.5,7.4-4.2,10.1C48.2,43.3,47.7,43.5,47.2,43.5z"/><path d="M54.4,48.3c-0.5,0-0.9-0.2-1.3-0.5c-0.7-0.7-0.7-1.8,0-2.6c6.8-6.8,6.8-18,0-24.8c-0.7-0.7-0.7-1.8,0-2.6c0.7-0.7,1.8-0.7,2.6,0c8.3,8.3,8.3,21.7,0,29.9C55.3,48.1,54.8,48.3,54.4,48.3z"/><polygon points="41,28.5 27.9,50.1 26.7,50.1 30.8,33.4 23.8,33.4 27.2,13.9 39.2,13.9 33.3,28.5"/>'};
// More of the game's own icons, one per component category (Sam's picks from Data.p4k): [viewBox, shapes], drawn
// in the app's colour (currentColor). Kept as inline code like every other icon in the app.
const CP_GI={
  gatling:["440 280 1040 520", "<path fill-rule=\"evenodd\" d=\"M992 665C991 662 992 661 997 652C1000 647 1002 642 1002 642C1002 641 1001 641 1000 641C998 641 997 640 997 637C997 635 997 634 998 634C999 634 1000 634 1001 635C1001 636 1003 636 1007 636C1017 635 1035 631 1036 630C1037 629 1039 629 1042 629C1044 629 1046 629 1046 628C1046 628 1041 628 1035 628C1029 628 1019 628 1013 628L1002 628L1001 631C1000 633 1000 633 1001 630C1001 627 1001 627 1000 628C999 629 999 629 999 626C999 624 998 623 997 622C996 622 996 622 998 621C1002 620 1002 618 997 618L993 618L993 622L993 626L987 626C982 626 982 626 986 625C994 625 992 621 982 621L976 620L984 620C992 620 994 618 985 618C982 618 981 618 983 617C991 617 991 616 991 612L991 608L992 612C992 616 993 616 997 617C1001 617 1002 616 1002 610C1002 608 1003 606 1005 605C1010 600 1010 599 1001 599L993 599L993 602C993 604 993 604 992 602C991 601 991 600 991 600C990 600 979 606 978 607C977 607 973 607 970 607C962 607 963 607 967 613C969 615 970 616 973 616C975 616 976 616 975 617C973 617 973 617 975 618C976 620 976 620 974 620C972 621 970 620 969 619C967 617 965 617 955 617L944 617L954 616C961 616 966 616 966 615C967 615 966 613 964 612C961 610 956 609 943 608C933 607 924 606 922 605C920 604 920 604 924 604C926 604 935 605 944 606C953 607 960 608 961 608C962 607 960 605 958 605C957 606 939 604 924 602C920 602 919 602 919 603C920 603 919 604 917 604C914 605 910 605 910 604C910 604 905 603 892 603L879 602L879 608L879 614L883 614C889 614 901 614 901 615C901 615 895 615 890 615C880 615 879 616 879 617C879 618 880 619 880 619C881 620 881 620 880 621C879 621 877 621 877 620C876 619 876 619 877 618C877 618 878 617 878 616C878 615 877 615 872 615C869 615 866 615 865 614C864 613 866 613 871 614L878 614L878 608L878 602L869 601C864 601 858 601 855 601C849 600 849 600 848 602C848 604 848 604 845 602C844 602 840 601 837 600C834 600 831 599 831 599C831 598 830 598 829 598C828 598 828 598 829 599C830 600 827 600 820 599C811 599 809 599 809 600C809 603 811 609 813 611C814 612 815 614 814 615C813 617 813 616 810 610C806 601 805 600 796 601L792 602L792 609C792 615 791 616 791 614C790 612 790 612 789 613C787 615 787 614 785 609C783 606 782 603 781 602C780 602 777 601 773 601C766 600 766 600 766 609C766 612 766 614 766 615C765 615 765 614 765 613C765 612 765 611 764 611C763 612 763 612 763 613C763 616 761 614 758 607L754 599L748 599C742 598 741 599 740 602C739 604 739 604 739 602C739 599 736 597 730 596C727 595 727 595 730 595C733 595 734 593 731 593C727 593 723 593 722 593C722 594 723 594 724 595C726 596 726 596 725 596C724 596 723 597 722 597C722 598 720 599 716 598C709 598 706 598 706 602C706 604 706 604 705 601C704 599 703 597 701 597C700 597 689 596 676 596C663 595 636 594 616 594C532 590 497 589 475 591C461 591 458 590 462 587C463 586 464 585 463 585C463 584 460 584 456 584L449 584L449 576L450 568L456 567C460 567 463 567 463 567C463 566 463 565 462 564C461 564 460 562 460 562C460 560 480 559 486 561C488 562 499 562 525 561C595 559 649 557 662 556C700 555 722 554 729 554L736 554L730 555C723 555 723 556 722 558C722 560 721 562 721 563C720 565 727 568 729 567C730 566 737 566 743 566C754 566 756 566 756 564C757 563 757 563 758 564C759 565 760 566 762 566C765 566 765 566 764 564L764 562L767 564C769 566 773 567 773 565C773 565 771 563 769 560C766 556 765 556 761 556C757 557 755 556 753 555L751 553L756 553C774 551 786 550 834 550L888 550L894 555L899 560L909 560C917 560 918 560 912 561C907 561 906 562 906 564C906 566 906 568 906 570C906 571 905 572 904 572C903 572 902 573 902 574C902 575 903 575 904 574C905 574 906 574 906 575C906 576 905 577 904 577C903 577 902 578 902 578C902 579 903 580 904 580C905 580 906 580 906 581C906 582 910 582 916 582L925 582L925 572L925 562L922 561C919 560 919 560 922 560C925 560 926 559 927 558C928 555 931 554 933 557C934 558 934 558 935 557C937 555 940 555 940 557C941 558 941 558 942 557C944 556 947 555 953 555L963 555L963 559C963 564 964 567 966 566C968 564 967 541 966 539C964 538 964 538 964 540L963 542L963 540C963 538 963 538 953 538C947 538 943 538 942 537C941 536 941 536 940 537C940 538 936 538 935 536C934 535 934 535 933 536C931 539 928 538 926 535C925 533 925 529 925 525L925 518L913 518C905 518 902 519 902 520C902 520 903 521 904 521C906 521 907 524 906 530C906 533 905 533 903 533C900 533 898 534 894 538L888 543L832 543C782 543 765 542 756 540C754 540 753 539 754 538C754 537 755 537 759 537L764 538L769 533C774 528 774 528 771 527C770 527 768 528 766 529C765 530 764 531 765 530C765 529 766 528 765 528C764 527 758 527 758 528C758 529 758 529 757 528C755 527 722 527 720 528C720 529 720 531 721 533L723 538L734 538C743 539 744 539 737 539C733 539 717 539 701 538C685 537 641 536 604 535C568 534 530 533 520 532C511 532 500 532 495 532C490 532 481 532 474 532C460 533 458 532 462 528L464 526L457 526L449 526L449 518L449 509L457 509L464 509L462 507C458 503 460 502 474 503C499 503 508 503 542 502C560 501 589 501 608 500C626 499 661 498 685 497C710 497 734 496 739 496C747 496 747 496 735 497L723 498L721 502C721 504 720 506 721 507C722 508 755 508 757 507C758 506 758 506 758 507C758 507 761 508 766 508L774 508L770 503C765 498 765 498 760 498C757 498 755 498 754 497C753 495 753 495 755 495C762 493 767 493 846 492L888 492L894 497C898 501 900 502 903 502C906 502 906 502 906 506C906 509 906 510 904 509C903 509 902 509 902 510C902 512 903 512 904 512C905 511 906 512 906 513C906 513 905 514 904 514C903 514 902 514 902 515C902 516 903 517 913 517L925 517L925 510C925 500 929 494 933 498C934 499 934 499 935 498C935 497 940 497 940 498C940 499 941 499 943 498C944 498 948 497 953 497C958 497 962 497 962 496C963 495 965 495 967 495C970 495 971 495 970 497C970 498 971 498 978 498C984 498 986 497 986 496C986 494 987 495 993 498C995 499 998 500 999 500C1000 500 1000 500 998 502C997 503 996 504 997 504C998 505 998 506 997 506C997 507 997 508 998 508C999 510 999 515 998 515C997 515 997 514 997 513C997 512 997 511 996 510C995 510 995 510 995 509C996 508 991 503 990 503C988 504 988 508 990 514C991 517 993 520 993 521C994 521 994 529 993 539C993 557 993 563 995 563C998 563 999 548 996 527C996 522 997 515 999 516C999 517 999 575 998 578C998 581 998 581 1002 581C1007 581 1007 581 1007 579C1007 577 1006 575 1005 575C1004 573 1004 573 1005 573C1008 573 1007 568 1005 564C1003 561 1003 559 1003 547C1003 534 1003 532 1005 529C1007 526 1007 524 1007 514C1007 503 1006 503 1004 502C1002 500 1002 500 1006 500C1009 500 1010 500 1010 501C1010 503 1010 503 1012 503C1013 503 1013 503 1011 504C1009 506 1009 506 1009 528C1009 542 1009 549 1010 548C1011 548 1011 547 1011 546C1011 542 1019 512 1020 510C1021 509 1022 507 1023 506C1024 503 1024 503 1036 503L1048 502L1044 501C1040 499 1029 499 1020 502C1015 503 1011 503 1014 501C1015 500 1016 499 1015 499C1015 498 1016 497 1019 496C1022 495 1025 494 1026 494C1028 493 1033 493 1038 493C1046 493 1046 493 1046 495C1045 496 1046 498 1049 500C1053 503 1054 503 1062 503L1072 503L1066 500C1062 498 1058 496 1057 495L1054 494L1057 491C1058 489 1059 488 1059 488C1059 487 1055 485 1050 483C1042 479 1041 479 1033 479C1025 479 1022 478 1022 475C1022 474 1023 473 1023 472C1024 471 1043 471 1083 471C1115 470 1147 470 1154 469L1166 468L1167 456C1168 443 1168 441 1173 441C1174 441 1176 442 1177 444C1179 447 1180 448 1183 448C1186 448 1186 448 1185 446C1184 445 1184 445 1185 445C1186 445 1186 445 1185 444C1184 443 1184 442 1185 442C1185 442 1187 443 1188 444C1189 446 1190 447 1190 447C1191 447 1190 446 1190 444C1188 442 1188 442 1190 442C1190 442 1192 443 1192 444C1194 448 1197 448 1197 445C1196 442 1197 439 1199 439C1200 440 1201 439 1202 438C1203 437 1203 437 1204 438C1205 439 1212 439 1223 439L1240 440L1222 440C1204 440 1203 440 1202 442C1202 443 1202 445 1203 445C1203 446 1215 446 1230 446L1256 446L1256 443C1256 441 1256 440 1254 440L1252 440L1254 438C1258 437 1269 436 1268 438C1268 439 1268 439 1270 439C1271 438 1275 438 1279 437C1294 436 1280 435 1242 435C1220 435 1202 435 1202 435C1202 434 1220 434 1242 434L1282 434L1287 431C1290 429 1292 428 1292 427C1290 425 1294 425 1296 427C1297 429 1299 428 1299 425C1299 424 1299 423 1300 423C1300 423 1301 424 1300 424C1300 425 1300 426 1301 426C1302 426 1305 422 1304 422C1304 422 1305 421 1305 421C1307 421 1306 425 1303 426C1302 427 1300 428 1299 429C1298 430 1296 431 1296 431C1295 431 1295 432 1295 433C1294 434 1294 435 1293 435C1293 435 1288 438 1282 441C1273 447 1271 448 1266 448C1263 448 1261 448 1260 449C1260 450 1260 450 1260 450C1260 450 1263 450 1265 451C1268 451 1270 452 1273 455C1275 457 1278 458 1279 458C1282 458 1284 458 1284 459C1284 461 1288 465 1301 475C1303 477 1303 478 1302 484L1302 491L1306 491C1308 492 1316 491 1324 491C1344 490 1345 491 1352 506C1355 512 1359 521 1361 525C1364 531 1364 532 1366 531C1367 531 1369 531 1370 533C1372 534 1374 536 1376 536C1378 537 1379 539 1378 539C1378 540 1378 540 1377 539C1377 539 1376 538 1375 538C1375 538 1373 537 1371 536C1370 534 1368 533 1368 533C1366 533 1367 536 1370 539C1371 540 1372 541 1371 541C1369 539 1370 544 1372 547C1374 549 1375 551 1375 552C1375 553 1376 556 1377 559C1379 562 1379 564 1379 564C1379 564 1377 562 1376 560C1375 558 1374 556 1374 557C1374 557 1373 556 1372 554C1371 549 1371 548 1370 551C1369 552 1369 552 1369 550C1369 548 1369 545 1368 544C1368 542 1367 542 1367 546L1366 550L1366 545C1366 542 1366 539 1365 538C1364 535 1364 535 1362 536C1359 538 1358 539 1360 541C1362 542 1361 544 1358 544C1356 545 1356 545 1357 544C1359 542 1358 540 1356 540C1355 540 1353 541 1353 542C1350 544 1348 543 1346 540C1345 538 1345 538 1347 539C1349 542 1351 541 1353 539C1355 537 1355 537 1354 533C1353 530 1350 524 1347 518C1342 509 1341 507 1338 505C1332 502 1329 503 1327 506C1325 511 1325 511 1328 517C1331 524 1332 527 1331 527C1331 527 1330 525 1329 522C1322 509 1321 508 1320 511C1320 512 1319 513 1319 512C1318 510 1316 512 1315 515L1313 518L1312 515C1310 512 1310 512 1312 510C1313 509 1314 508 1313 508C1313 507 1314 507 1315 507C1317 507 1318 506 1316 504C1315 504 1315 504 1315 505C1315 506 1314 505 1313 504C1311 503 1309 502 1308 502C1305 502 1299 506 1295 510C1294 512 1292 514 1291 514C1289 515 1286 518 1282 521L1276 526L1266 527L1256 527L1242 537C1225 549 1222 552 1222 554C1222 556 1222 556 1221 555C1221 554 1221 553 1220 553C1219 553 1216 556 1216 557C1216 558 1216 560 1215 561C1214 563 1214 563 1217 563C1219 563 1220 562 1220 560L1221 558L1221 560C1221 562 1222 562 1231 563L1241 563L1248 570C1252 573 1256 577 1256 578C1257 579 1262 579 1275 579C1286 579 1292 579 1292 580C1291 581 1292 581 1294 581C1296 581 1296 581 1294 580C1293 579 1293 579 1297 579C1299 579 1301 579 1301 580C1301 581 1302 581 1303 581C1304 581 1305 581 1304 580C1304 579 1305 579 1321 579C1329 579 1330 579 1331 581C1331 582 1332 584 1332 584C1331 584 1332 585 1333 586C1334 587 1334 587 1334 586C1333 585 1335 587 1338 591C1344 597 1347 598 1346 593C1345 591 1345 591 1346 592C1347 593 1350 594 1353 595C1356 595 1358 596 1358 596C1358 597 1361 597 1364 597C1368 597 1371 597 1371 596C1371 595 1372 595 1373 595C1374 595 1377 594 1378 593C1381 590 1381 590 1380 588C1378 587 1376 586 1368 586C1360 586 1359 586 1357 584C1354 581 1351 579 1347 579C1340 579 1340 579 1340 569L1340 560L1352 560C1359 559 1365 559 1365 558C1366 558 1365 555 1363 552C1362 549 1361 547 1361 546C1362 546 1363 548 1364 550C1365 552 1366 554 1366 553C1366 552 1367 553 1367 555C1368 557 1369 559 1370 559C1372 560 1382 580 1381 581C1379 583 1380 586 1382 588C1384 589 1384 589 1386 588C1388 587 1388 583 1383 573C1381 569 1379 565 1380 565C1380 564 1382 568 1385 573C1388 579 1391 583 1391 584C1392 584 1395 582 1399 580C1404 577 1405 577 1404 575C1402 572 1403 571 1405 574C1407 576 1412 578 1411 576C1410 576 1412 574 1415 573C1418 572 1420 570 1420 570C1419 570 1420 569 1421 569C1423 569 1423 570 1422 570C1416 574 1408 579 1408 580C1408 580 1407 581 1406 581C1404 581 1404 580 1405 579C1406 578 1406 578 1403 579C1401 580 1400 582 1401 582C1401 583 1400 583 1400 582C1398 582 1398 582 1398 584C1398 586 1398 586 1396 586C1396 585 1395 586 1395 587C1395 587 1394 588 1393 588C1393 588 1392 588 1393 587C1393 586 1392 587 1390 587C1388 588 1387 590 1388 591C1388 591 1388 592 1387 592C1387 592 1384 593 1382 594C1378 597 1376 598 1378 596C1378 595 1378 595 1377 595C1376 596 1376 596 1376 597C1377 597 1376 598 1376 599C1374 601 1380 600 1383 598C1384 597 1387 596 1388 596C1390 595 1390 595 1388 596C1387 597 1386 598 1385 598C1385 598 1384 599 1383 600C1382 601 1382 601 1385 601C1387 600 1389 599 1391 598C1393 597 1394 595 1392 595C1391 595 1391 594 1391 594C1391 593 1392 592 1392 592C1393 592 1394 593 1394 594C1394 595 1394 595 1398 594C1403 593 1401 595 1392 601C1388 603 1384 606 1384 606C1383 607 1383 606 1383 605C1383 604 1382 603 1382 603C1381 603 1380 603 1378 602C1376 602 1373 602 1359 602C1346 602 1346 602 1344 608C1343 610 1343 610 1343 606C1344 600 1343 599 1332 599C1327 599 1323 599 1322 600C1322 601 1317 601 1317 600C1317 599 1316 598 1314 597C1312 595 1311 592 1313 594C1314 594 1314 594 1314 593C1313 592 1313 592 1301 592L1292 592L1301 591C1308 591 1304 590 1290 590C1274 590 1271 591 1278 591L1288 592L1277 592C1267 592 1266 592 1264 590C1263 589 1262 587 1263 587C1263 586 1262 586 1262 587C1261 587 1260 586 1259 585C1257 583 1252 582 1252 584C1252 584 1259 591 1267 599L1282 614L1290 614C1295 614 1297 614 1299 612C1300 611 1303 610 1304 609C1306 608 1306 608 1303 611C1301 612 1300 614 1301 614C1301 615 1306 615 1312 615C1318 615 1322 615 1322 616C1322 617 1326 617 1331 617C1337 617 1339 617 1338 616C1337 615 1337 615 1339 615C1340 615 1341 614 1342 613C1342 611 1343 611 1343 614C1343 617 1344 618 1349 618C1352 618 1355 618 1356 617C1357 616 1357 616 1357 617C1357 618 1366 618 1382 617C1391 617 1393 616 1393 615C1393 614 1392 613 1391 613C1390 613 1390 613 1390 612C1391 612 1393 612 1395 612C1399 612 1399 612 1399 610C1399 608 1399 608 1402 611C1404 613 1405 615 1405 616C1405 617 1420 618 1446 618C1453 618 1434 619 1398 620C1396 620 1392 620 1388 619C1382 619 1377 619 1373 620C1368 621 1359 622 1349 622C1337 622 1332 622 1332 623C1331 624 1331 624 1330 623C1330 622 1324 622 1324 623C1324 625 1328 627 1330 626C1332 626 1336 629 1336 631C1336 632 1334 632 1332 632C1329 632 1327 632 1326 632C1326 633 1327 633 1329 633C1333 633 1333 633 1333 635C1333 637 1332 638 1330 638C1329 638 1328 639 1328 640C1328 642 1262 642 1262 640C1261 638 1260 638 1254 638C1252 638 1251 637 1251 637C1251 635 1244 636 1244 638C1243 638 1242 639 1239 639C1236 639 1235 639 1235 638C1235 636 1234 636 1232 636C1230 636 1228 637 1227 638C1225 639 1220 639 1218 637C1215 636 1213 636 1211 638C1210 639 1208 639 1201 639C1195 639 1191 639 1189 640C1187 641 1189 641 1210 642L1217 642L1221 651C1224 655 1226 660 1225 660C1225 661 1225 661 1226 661C1227 660 1227 662 1226 665C1225 667 1224 667 1214 667L1203 667L1193 658L1184 649L1173 649C1162 649 1161 649 1154 652C1145 656 1136 657 1109 657L1089 657L1089 653L1089 649L1083 649C1077 650 1076 650 1069 654C1066 657 1060 660 1057 662C1054 664 1051 666 1050 666C1050 667 1037 667 1022 667L993 667L992 665ZM1063 656C1069 652 1074 648 1074 648C1074 647 1069 646 1057 645C1048 645 1044 645 1044 646C1043 647 1044 650 1046 653C1048 657 1049 660 1049 662C1048 665 1049 665 1063 656ZM1014 662C1017 661 1016 659 1012 652C1010 648 1008 646 1007 646C1005 646 1003 648 1001 653C996 662 996 663 1006 663C1010 663 1014 663 1014 662ZM1045 662C1046 662 1047 661 1047 660C1047 657 1040 645 1038 645C1037 645 1035 648 1033 652C1029 659 1028 662 1030 662C1032 663 1042 663 1045 662ZM1207 650L1211 643L1208 643C1206 643 1204 643 1204 644C1203 645 1200 645 1197 645C1193 645 1189 646 1188 646C1186 647 1186 647 1194 655C1202 663 1202 663 1203 661C1203 659 1205 655 1207 650ZM1221 662C1224 661 1223 659 1219 652C1214 643 1213 643 1208 653C1204 660 1204 661 1205 662C1207 663 1219 663 1221 662ZM1028 655C1030 651 1032 648 1032 647C1032 645 1024 643 1016 645C1013 645 1012 647 1015 651C1018 659 1021 662 1023 662C1024 662 1026 659 1028 655ZM1000 650C1003 646 1003 645 1001 647C999 650 994 658 994 660C994 661 997 657 1000 650ZM1138 654C1138 651 1136 650 1129 650C1122 650 1121 650 1121 652C1121 654 1122 654 1130 654C1134 654 1138 654 1138 654ZM1058 639C1059 638 1052 638 1038 638C1026 638 1016 638 1016 639C1016 640 1056 640 1058 639ZM1068 635C1079 635 1081 635 1081 634C1081 633 1081 632 1082 632C1082 632 1083 633 1082 634C1082 635 1084 635 1102 635C1121 635 1125 634 1122 632C1121 632 1121 631 1122 630C1123 629 1124 629 1124 630C1125 630 1128 631 1131 631L1136 632L1130 632C1125 632 1124 632 1124 634C1124 635 1126 635 1133 635C1143 635 1151 633 1144 633C1143 633 1145 632 1150 632C1154 631 1159 631 1160 630C1161 629 1159 628 1149 628C1125 627 1084 627 1083 629C1082 629 1081 630 1079 629C1073 627 1058 628 1045 630C1038 632 1030 633 1028 633C1019 635 1024 636 1039 635C1048 635 1060 635 1068 635ZM1297 631C1303 631 1305 630 1305 629C1305 629 1305 628 1304 628C1303 627 1303 627 1303 628C1303 628 1301 629 1298 629C1294 629 1292 628 1292 628C1292 627 1289 627 1289 628C1288 629 1288 629 1287 628C1286 627 1286 627 1286 628C1285 630 1284 630 1283 629C1280 628 1268 629 1270 630C1273 631 1275 632 1282 631C1285 631 1292 631 1297 631ZM1461 628C1461 627 1462 626 1464 624C1466 622 1467 621 1467 620C1467 620 1464 619 1461 619L1456 618L1462 618C1469 618 1469 618 1468 620C1468 621 1467 623 1466 624C1465 626 1461 628 1461 628ZM1123 625C1123 624 1114 624 1103 624C1091 624 1084 625 1086 625C1089 626 1122 626 1123 625ZM1312 625C1317 625 1320 625 1319 624C1317 624 1316 623 1317 623C1317 622 1305 622 1287 622C1270 622 1258 623 1260 623C1263 623 1253 624 1238 624L1212 624L1244 625C1275 625 1293 625 1312 625ZM1078 614C1078 613 1078 611 1078 611C1078 610 1063 616 1062 617C1061 618 1064 618 1069 618L1078 618L1078 614ZM1177 617C1179 617 1180 616 1179 616C1179 615 1144 615 1144 616C1143 616 1144 617 1146 617C1150 618 1174 618 1177 617ZM1247 617C1280 617 1297 616 1291 616C1275 615 1189 615 1189 616C1188 617 1191 618 1192 617C1193 617 1217 617 1247 617ZM1016 616C1019 615 1019 615 1018 616C1016 617 1023 617 1038 617L1060 616L1069 612C1076 609 1078 608 1078 606C1078 604 1078 604 1074 604C1063 606 1062 606 1070 604C1074 603 1078 601 1078 601C1078 600 1014 600 1012 601C1012 602 1011 602 1011 601C1011 601 1010 602 1008 604C1006 605 1005 607 1005 608C1005 609 1005 610 1004 610C1003 610 1003 612 1004 614C1004 617 1004 617 1008 617C1010 616 1013 616 1016 616ZM1142 616C1142 614 1139 613 1132 613C1125 613 1124 613 1124 615C1124 617 1124 617 1133 617C1138 617 1142 617 1142 616ZM832 614C826 614 821 613 821 613C820 613 826 612 834 613C842 613 849 613 849 613C850 614 843 614 832 614ZM1429 614C1429 613 1436 606 1436 607C1437 608 1436 610 1434 610C1433 610 1432 612 1432 613C1432 615 1429 616 1429 614ZM1280 614C1280 613 1273 606 1264 598L1248 582L1240 582L1230 582L1230 590C1230 595 1229 598 1228 598C1223 600 1212 605 1211 605C1209 605 1210 607 1213 608C1214 609 1215 610 1215 610C1216 612 1208 612 1206 611C1205 610 1205 610 1207 610C1208 610 1209 610 1209 609C1209 608 1203 608 1201 609C1198 610 1196 613 1196 613C1196 614 1215 614 1238 614C1261 614 1280 614 1280 614ZM791 606C791 602 791 601 788 600C786 599 785 599 784 599C783 600 785 607 787 609C790 612 791 611 791 606ZM765 606C765 602 765 601 762 601C761 600 759 600 759 601C757 602 762 610 764 610C765 610 765 608 765 606ZM1307 608C1307 607 1315 601 1316 601C1316 602 1315 605 1313 605C1313 605 1311 606 1309 607C1308 608 1307 608 1307 608ZM973 601C973 600 972 599 971 599C970 598 969 599 969 599C969 600 969 600 968 600C967 600 967 599 967 598C967 597 967 596 966 596C965 595 965 589 966 589C967 589 967 588 967 587C967 586 967 586 965 587C964 588 963 591 963 594C963 601 963 601 962 599C961 598 960 595 960 591L960 584L952 584L943 584L943 590C943 594 943 595 941 595C940 595 939 595 938 594C937 593 937 593 937 594C937 596 936 596 933 595C931 594 929 594 929 595C927 596 925 592 925 588C925 585 922 583 921 585C920 586 920 586 920 585C920 584 918 584 913 584C903 584 902 585 902 588C903 590 903 591 902 591C901 592 900 593 900 594C900 596 904 598 907 598C909 597 913 598 916 598C930 600 960 603 964 603C966 603 968 603 969 603C969 604 973 603 973 601ZM978 598C978 597 978 594 979 593C980 592 980 592 980 596C980 599 980 601 981 601C983 601 984 598 984 595C984 592 984 591 985 592C986 593 986 593 987 592C987 590 987 590 989 592C990 593 990 593 990 589L990 584L984 584C980 584 977 585 976 585C975 586 975 592 976 592C977 593 977 595 977 597C977 598 977 600 976 600C975 600 975 601 975 602C975 603 975 603 977 602C978 601 979 600 978 598ZM1217 599C1220 599 1222 598 1223 598C1223 598 1222 597 1221 597C1218 596 1209 599 1208 601C1208 602 1208 602 1210 602C1211 601 1214 600 1217 599ZM1213 595C1215 594 1217 585 1216 583C1215 582 1212 582 1208 582L1201 582L1201 590L1201 599L1206 597C1209 596 1212 595 1213 595ZM1337 595C1336 593 1334 590 1331 588L1327 583L1321 583L1314 584L1315 588C1315 591 1316 593 1317 595C1319 597 1320 597 1329 597L1338 597L1337 595ZM1338 592C1336 589 1334 589 1336 590C1339 595 1341 597 1342 596C1342 596 1340 594 1338 592ZM894 595C896 594 897 594 897 595C898 596 898 596 899 596C899 595 899 595 898 594C897 594 897 592 898 589C899 587 899 585 899 584C897 583 890 586 890 588C891 590 890 589 888 587C886 586 884 585 883 585C880 585 879 586 879 589C879 595 880 596 884 593C887 591 887 591 886 593C886 594 886 595 889 595C890 596 892 596 892 596C892 596 893 596 894 595ZM878 590L878 585L869 585C863 585 859 585 858 586C857 587 857 587 857 586C857 585 855 585 852 585C850 585 848 585 848 586C848 587 847 587 846 586C845 585 843 585 840 586C838 586 836 586 836 586C836 585 830 585 823 585L810 585L810 588C810 590 810 591 811 591C811 592 821 592 834 592C846 593 859 594 864 594C879 595 878 596 878 590ZM1006 592C1007 592 1007 589 1007 587C1007 584 1007 584 1003 584C997 584 995 585 996 587C997 587 997 588 996 588C995 589 995 593 996 593C999 595 1006 594 1006 592ZM1228 590C1228 584 1227 582 1223 582L1219 582L1219 587C1219 593 1220 594 1225 594C1227 594 1228 593 1228 590ZM701 588L701 583L599 583C511 583 497 583 495 585C493 585 492 586 492 586C492 587 501 587 512 587C523 587 535 587 540 587C553 588 569 589 612 590C633 591 651 592 652 592C652 593 663 593 677 593L701 593L701 588ZM1025 591C1026 591 1026 590 1026 588C1026 585 1025 584 1019 584C1016 584 1016 584 1016 589L1016 593L1020 592C1023 592 1025 592 1025 591ZM756 590C759 589 759 586 756 585C755 584 750 584 744 584C737 584 735 585 734 586C733 589 735 590 740 591C743 591 745 591 746 591C746 592 753 591 756 590ZM809 590C809 588 809 587 809 586C808 585 803 585 796 585L785 585L785 588C785 590 786 591 793 591C798 591 803 592 805 592C807 592 808 592 809 590ZM1045 591C1047 591 1048 590 1048 589C1048 589 1048 588 1049 588C1050 589 1050 588 1049 588C1049 587 1048 586 1047 587C1047 587 1046 587 1046 586C1046 586 1045 585 1044 585C1043 585 1042 585 1042 586C1042 586 1041 587 1040 586C1039 586 1039 588 1040 590C1040 592 1041 592 1045 591ZM733 587L733 584L728 584C719 585 719 585 720 587C721 590 723 591 728 591C732 591 733 590 733 587ZM784 588C784 586 783 585 781 585C779 585 777 585 776 586C774 587 774 587 774 586C774 585 772 584 767 585C760 585 760 585 760 587C760 589 760 590 766 590C770 590 773 590 774 590C774 591 776 591 779 591C783 591 784 590 784 588ZM1086 589C1087 588 1087 585 1087 582C1087 579 1088 577 1088 576C1090 575 1089 574 1088 575C1087 575 1086 575 1086 574C1086 573 1086 572 1087 572C1088 572 1088 572 1088 571C1088 570 1088 570 1087 570C1086 571 1086 571 1086 570C1086 570 1086 568 1086 567C1085 566 1086 565 1086 564C1087 564 1087 563 1086 563C1085 562 1085 561 1085 560C1086 558 1085 556 1084 556C1083 557 1082 556 1081 556C1080 555 1078 556 1057 571L1044 580L1057 581L1070 581L1075 586C1080 592 1084 593 1086 589ZM1406 590C1409 588 1428 576 1429 576C1430 576 1432 579 1432 581C1432 581 1431 581 1430 580C1428 578 1428 578 1423 581C1420 583 1418 584 1417 584C1417 584 1416 585 1415 586C1414 586 1412 588 1410 589C1407 590 1406 591 1406 590ZM709 589C710 588 710 588 710 589C710 590 712 590 714 590C717 590 718 590 718 589C718 586 713 584 708 584C703 584 703 584 703 586C703 588 703 589 704 589C705 590 707 590 709 589ZM1312 586L1312 584L1287 583C1274 583 1263 583 1263 584C1263 585 1266 588 1268 588C1269 589 1279 589 1291 589L1312 589L1312 586ZM1374 581C1376 581 1376 580 1375 579C1374 574 1369 564 1367 563C1365 562 1354 562 1347 563L1342 563L1342 569C1342 575 1343 576 1348 576C1350 576 1353 577 1356 580C1362 583 1364 583 1374 581ZM463 579C465 576 463 570 461 569C458 569 455 573 455 575C455 578 458 582 460 582C461 582 463 581 463 579ZM475 581C477 580 476 571 474 570C472 569 471 569 469 571C467 575 466 576 469 580C470 582 472 583 475 581ZM960 574C960 570 960 566 960 565C960 564 959 564 955 564C952 564 950 565 950 566C950 568 950 568 951 568C952 567 952 568 952 568C952 569 952 570 951 570C950 570 950 571 950 572C950 574 950 575 951 575C952 575 951 576 950 577C949 580 949 580 951 581C952 581 954 582 957 582L961 582L960 574ZM971 578C972 576 972 574 971 573C969 572 968 572 968 574C968 574 968 575 967 574C966 574 966 574 966 573C967 573 966 572 965 571C964 570 964 570 964 571C964 572 964 574 963 574C963 575 963 576 964 576C965 576 966 577 966 578C966 579 966 580 964 579C963 579 963 579 964 580C965 582 967 580 967 578C967 576 967 576 968 579C969 583 970 582 971 578ZM996 581C997 580 996 564 995 564C994 564 993 580 994 581C994 582 995 582 995 582C995 582 996 582 996 581ZM1028 579C1030 578 1032 576 1032 576C1032 575 1011 561 1010 562C1009 562 1009 580 1010 581C1010 582 1013 582 1017 582C1023 582 1025 582 1028 579ZM1043 578C1046 575 1051 572 1054 570C1056 568 1059 566 1060 565C1060 564 1061 564 1062 564C1062 565 1064 564 1065 563C1066 561 1070 559 1072 557C1074 556 1078 553 1080 552C1081 550 1084 548 1086 547L1088 544L1084 544C1081 544 1080 544 1079 546C1078 549 1075 550 1074 549C1073 549 1069 552 1065 555C1060 559 1054 563 1051 566C1048 568 1045 571 1044 572C1043 575 1041 577 1039 577C1038 576 1030 580 1030 582C1030 582 1032 582 1034 582C1037 582 1039 581 1043 578ZM992 553C992 538 992 525 991 524C991 523 991 522 991 521C991 520 990 517 989 515C988 513 987 509 987 506L986 500L981 500C973 500 970 501 970 503C970 504 970 505 969 505C967 505 968 509 972 514C977 520 979 522 980 522C982 522 982 523 981 526L980 528L980 526C980 524 980 524 979 526C978 530 979 533 981 533C982 534 981 534 979 535C976 535 976 537 980 537C984 538 982 540 978 539L974 539L974 552C974 559 974 565 975 565C975 566 976 566 977 565C979 564 983 565 983 567C982 568 982 568 985 567C987 566 987 565 987 553C987 538 987 536 984 536C983 536 983 536 984 535C985 534 986 534 988 534C990 534 990 534 990 552L990 570L985 570C983 570 981 571 981 571C981 572 980 572 980 572C979 572 978 573 978 574C978 576 979 577 980 577C980 578 981 579 981 580C981 581 982 581 986 581L992 580L992 553ZM1252 579C1252 578 1250 576 1248 574C1244 571 1244 571 1239 572C1234 573 1230 576 1230 578C1231 579 1234 580 1241 580C1246 580 1251 580 1251 581C1252 582 1253 581 1252 579ZM900 576C900 573 899 572 898 572C897 572 896 572 896 573C896 573 864 573 827 573L758 573L758 575L758 578L828 578C865 578 897 579 898 579C899 579 900 578 900 576ZM1376 573C1375 570 1374 568 1373 568C1373 568 1373 568 1373 569C1373 569 1375 572 1376 574C1377 577 1378 579 1379 579C1379 578 1378 576 1376 573ZM725 576C725 576 726 575 726 575C727 575 727 576 727 576C726 578 727 578 731 578C735 578 735 578 735 576C735 573 735 573 726 573C717 573 717 573 717 576C716 578 717 578 721 578C724 578 725 578 725 576ZM778 576C774 576 800 575 834 575C884 575 896 575 896 576C896 577 885 577 840 577C810 577 782 576 778 576ZM1031 569C1030 565 1025 560 1022 560C1020 560 1019 560 1018 561C1017 562 1017 562 1018 563C1019 565 1031 572 1032 572C1032 572 1031 571 1031 569ZM900 568C900 565 898 563 895 563C893 563 892 564 894 566C895 567 896 567 896 568C895 571 899 571 900 568ZM1311 567C1312 565 1315 563 1316 562L1318 561L1316 564C1314 567 1310 570 1308 570C1308 570 1309 569 1311 567ZM714 566C717 564 719 563 719 561L719 558L688 559C672 559 657 559 657 560C656 560 637 560 615 561C593 562 563 563 550 564C520 565 508 565 506 565C505 564 504 564 504 565C503 565 501 566 498 565C493 565 493 565 495 566C497 568 520 568 644 568L710 568L714 566ZM1398 563C1396 560 1395 557 1395 557C1396 557 1397 560 1399 563C1401 566 1402 569 1402 569C1401 569 1400 566 1398 563ZM1436 566C1437 565 1439 564 1439 564C1440 564 1440 563 1440 562C1440 560 1440 560 1438 561C1437 562 1436 562 1435 562C1435 561 1435 561 1436 561C1437 561 1437 561 1436 560C1436 559 1436 559 1437 559C1438 559 1438 558 1438 557C1438 556 1439 555 1440 555C1441 555 1441 556 1441 560C1441 564 1441 564 1437 566L1434 568L1436 566ZM854 565C873 565 887 564 886 564C884 564 884 563 885 563C886 563 886 561 883 558C881 556 880 556 827 556C797 556 772 557 771 557C770 558 770 559 774 562L778 566L800 566C812 565 836 565 854 565ZM1047 564C1050 562 1056 553 1055 552C1054 551 1049 553 1044 557C1038 561 1038 561 1040 564C1042 566 1042 567 1047 564ZM1309 562C1314 557 1316 555 1316 557C1316 558 1315 560 1309 564L1306 566L1309 562ZM898 561C899 561 896 558 893 556C891 556 889 555 887 555C885 555 885 555 886 558C889 562 891 563 894 562C896 562 898 562 898 561ZM971 552C971 546 970 542 970 542C969 542 968 546 968 552C968 561 968 563 970 563C971 563 971 561 971 552ZM1038 558C1067 537 1086 523 1085 523C1085 522 1081 520 1077 518L1070 514L1053 514L1037 514L1036 518C1035 519 1034 521 1034 521C1032 521 1026 544 1027 546C1029 547 1027 552 1025 554L1022 556L1026 560C1028 561 1030 563 1031 563C1031 563 1034 561 1038 558ZM1205 558C1205 552 1205 552 1208 552C1211 551 1222 544 1220 543C1219 543 1216 544 1206 548L1199 551L1199 557C1199 563 1199 563 1202 563C1205 563 1205 563 1205 558ZM1452 555C1451 553 1446 553 1444 554C1444 555 1444 555 1446 555C1447 554 1447 554 1446 555C1445 556 1445 556 1444 555C1443 554 1443 554 1445 553C1447 552 1448 551 1448 550C1448 549 1448 549 1449 550C1450 551 1451 551 1453 549C1455 548 1455 548 1457 552C1459 555 1458 556 1456 553C1453 550 1452 551 1453 555C1454 557 1454 558 1452 555ZM1229 545C1231 543 1238 538 1243 534C1251 528 1253 527 1251 527C1249 527 1244 530 1236 536C1225 544 1223 546 1223 547C1223 549 1224 548 1229 545ZM1202 540L1202 536L1203 539C1203 542 1204 543 1204 544C1205 544 1209 542 1214 541C1221 538 1222 537 1222 534L1222 532L1213 531C1207 531 1203 531 1202 532C1202 533 1201 533 1200 532C1200 531 1194 531 1177 531L1154 532L1151 529C1148 527 1141 525 1137 526C1134 527 1134 527 1134 535L1134 544L1146 544C1152 544 1167 545 1179 545L1202 545L1202 540ZM1027 532C1030 523 1030 521 1029 520C1027 519 1027 520 1025 528C1024 531 1022 535 1022 537C1021 539 1021 542 1021 543C1023 546 1025 543 1027 532ZM1019 531C1020 526 1021 521 1021 521C1020 521 1016 534 1015 538C1014 545 1016 540 1019 531ZM1238 527C1234 527 1232 527 1230 529C1228 531 1226 532 1226 532C1225 532 1225 534 1225 536L1225 541L1234 534L1243 528L1238 527ZM895 535C896 534 898 532 898 531C898 531 898 530 899 530C900 530 900 524 899 523C898 523 897 524 896 525C894 527 892 530 889 533C887 535 885 537 885 538C885 540 891 538 895 535ZM1126 534C1125 532 1123 530 1123 529C1121 528 1122 532 1124 533C1124 534 1125 535 1125 536C1125 538 1126 539 1127 538C1128 538 1127 536 1126 534ZM883 534C885 533 886 531 886 530C885 530 886 529 886 529C887 528 879 528 870 528C860 528 835 528 815 528L778 527L774 531C772 533 770 535 770 536C770 537 784 537 819 537C846 537 871 538 875 538C881 538 881 538 883 534ZM960 534C960 532 960 531 960 530C959 529 959 529 960 529C960 529 961 527 961 523L961 518L955 518C950 518 950 519 950 520C950 522 951 523 951 523C952 524 952 524 951 525C951 525 950 526 950 527C950 529 951 529 954 529L958 529L955 530C950 531 948 533 953 534C956 534 957 535 954 535C953 535 952 535 952 536C952 537 954 537 956 537C959 537 960 537 960 534ZM1336 536C1336 535 1334 533 1334 531L1332 528L1335 531C1337 534 1338 534 1339 533C1341 532 1344 532 1344 534C1344 535 1343 536 1342 535C1341 535 1339 535 1339 536C1338 537 1337 537 1336 536ZM719 534C719 531 717 528 712 526C709 525 694 525 602 525C537 525 496 525 496 526C496 526 495 527 494 527C493 528 495 528 500 528C505 527 507 527 506 528C505 528 510 529 518 529C526 529 548 530 568 530C634 533 647 534 678 535C694 535 708 535 708 536C708 536 711 536 714 536C719 536 719 536 719 534ZM1361 534C1362 532 1361 530 1356 518C1350 506 1347 501 1345 503C1344 503 1344 504 1344 506C1344 509 1357 536 1358 536C1359 536 1360 535 1361 534ZM967 531C967 530 968 530 968 531C970 533 970 533 971 531C971 530 972 528 971 526C970 521 965 515 964 516C963 516 963 526 965 526C965 525 966 526 966 527C966 527 965 528 964 528C964 529 964 530 964 532C964 534 964 535 966 534C966 533 967 532 967 531ZM462 523C464 522 464 515 463 513C462 512 460 511 460 511C456 511 454 520 458 522C460 524 460 524 462 523ZM474 523C477 521 476 513 474 512C472 511 471 511 469 513C466 517 466 518 469 521C471 524 472 524 474 523ZM1252 521L1256 518L1242 518C1234 518 1228 518 1227 518C1227 519 1228 520 1229 521C1231 524 1232 524 1240 524C1248 524 1249 524 1252 521ZM1262 521C1265 519 1265 518 1264 518C1262 518 1254 522 1254 524C1254 525 1258 524 1262 521ZM1275 521C1275 518 1275 518 1272 518C1269 518 1261 522 1261 524C1261 524 1264 524 1268 524L1275 524L1275 521ZM1216 522C1216 522 1215 520 1213 518C1210 516 1209 515 1205 515C1202 515 1201 515 1201 517L1201 520L1200 517C1200 515 1200 515 1185 515C1171 515 1170 515 1167 517C1165 518 1164 520 1164 521C1164 523 1165 523 1190 523C1204 523 1216 523 1216 522ZM1285 515C1286 514 1288 512 1291 511C1293 509 1297 506 1299 504C1303 499 1303 499 1301 499C1298 499 1287 507 1284 512C1283 513 1281 514 1280 515C1278 516 1277 518 1277 520L1277 522L1281 519C1283 518 1285 516 1285 515ZM900 519C900 518 884 518 829 518C766 518 754 518 759 520C760 520 792 520 830 520C885 520 900 520 900 519ZM1093 518C1095 516 1095 516 1094 515C1092 514 1080 513 1077 514C1075 515 1075 515 1076 515C1077 515 1078 515 1078 516C1077 517 1078 517 1078 516C1079 516 1082 517 1084 518C1090 522 1090 522 1093 518ZM972 518C972 518 970 516 968 514C966 511 965 509 965 508C966 507 966 505 965 504C964 502 964 502 964 507C964 511 964 512 967 516C970 519 972 520 972 518ZM1154 516C1155 515 1151 515 1145 515C1135 515 1133 516 1134 517C1135 518 1154 517 1154 516ZM900 516C900 515 885 515 830 515C748 515 758 515 758 516C758 517 782 517 829 517C884 517 900 517 900 516ZM961 509C961 503 960 501 959 501C959 501 958 500 959 500C959 498 958 498 955 498C952 498 950 498 950 499C950 500 950 500 951 500C952 499 952 500 952 500C952 501 952 502 951 502C950 501 950 503 951 505C952 506 952 506 951 506C950 506 950 510 951 510C952 511 952 511 951 512C950 513 949 514 950 515C950 517 951 517 956 517L961 517L961 509ZM1130 501L1130 490L1122 490L1114 490L1115 497C1115 502 1115 503 1117 505C1119 508 1128 513 1129 513C1130 513 1130 508 1130 501ZM1265 510C1266 510 1266 507 1266 505C1266 502 1266 502 1267 503C1268 504 1268 506 1268 508C1267 511 1269 511 1273 507C1275 505 1276 503 1276 501C1276 498 1276 498 1272 498C1270 498 1268 499 1267 499C1267 500 1266 499 1265 498C1262 496 1260 497 1260 503C1260 510 1261 512 1263 512C1264 512 1265 511 1265 510ZM900 509C900 506 897 501 894 499C892 497 886 495 885 496C884 497 889 504 891 504C892 505 893 506 894 508C896 511 900 512 900 509ZM1060 510C1060 508 1052 506 1041 505C1035 505 1030 505 1030 506C1030 506 1031 507 1032 509C1034 511 1035 511 1047 511C1054 511 1060 511 1060 510ZM1142 509C1142 507 1145 505 1152 501C1157 498 1165 494 1168 492C1173 489 1177 488 1179 488C1183 488 1185 486 1186 483C1187 482 1186 481 1182 481C1177 480 1161 481 1155 482C1153 482 1152 482 1153 481C1153 480 1150 482 1145 484C1141 486 1136 489 1135 489C1134 490 1133 491 1133 491C1133 492 1138 489 1147 484C1149 483 1151 482 1152 482C1152 482 1148 485 1144 487C1133 493 1133 493 1133 502C1133 506 1133 510 1134 510C1134 511 1136 511 1138 511C1140 511 1141 511 1142 509ZM1252 510L1258 510L1258 504L1258 498L1238 498C1227 498 1218 498 1218 499C1218 499 1220 502 1223 505C1228 510 1229 510 1234 510C1238 511 1242 511 1243 510C1245 510 1249 510 1252 510ZM1286 504C1289 502 1292 500 1293 498C1295 496 1295 496 1293 496C1290 498 1282 503 1277 507L1272 511L1278 509C1280 508 1284 505 1286 504ZM714 508C718 506 719 505 719 502L719 499L708 499C702 500 687 500 675 501C645 501 584 504 545 506C528 507 509 507 502 507C492 507 492 507 494 508C495 510 508 510 602 510L710 510L714 508ZM1170 501C1180 493 1181 491 1178 491C1176 491 1154 503 1150 507C1147 509 1149 510 1156 510C1161 510 1161 510 1170 501ZM1192 504C1192 499 1192 499 1189 499C1187 499 1186 500 1184 503C1183 505 1182 508 1183 508C1183 509 1185 509 1188 509L1192 509L1192 504ZM860 507C861 506 864 506 870 507C875 507 881 507 884 507C886 507 887 506 886 506C886 506 885 505 886 505C886 504 885 502 883 500L881 497L867 497C860 498 835 498 812 498C782 498 770 498 770 499C770 500 772 502 774 504L778 508L819 508C842 508 860 507 860 507ZM1180 500C1188 493 1191 489 1190 488C1189 488 1185 492 1179 498C1172 505 1169 508 1170 508C1171 508 1176 505 1180 500ZM1205 503C1205 500 1199 494 1197 494C1195 494 1196 497 1200 501C1204 506 1205 506 1205 503ZM1082 502C1081 500 1070 495 1067 495C1064 496 1064 496 1071 499C1078 503 1084 504 1082 502ZM1112 499C1112 497 1111 496 1111 495C1110 495 1106 495 1101 495L1094 496L1100 499C1104 501 1109 503 1110 503C1112 503 1112 502 1112 499ZM1214 487L1214 478L1211 478L1208 478L1208 489C1208 495 1208 500 1209 500C1209 501 1211 500 1212 499C1214 496 1214 495 1214 487ZM1334 496L1338 493L1329 493C1324 493 1320 493 1320 494C1320 494 1321 496 1322 497C1324 500 1330 500 1334 496ZM1311 496C1312 495 1314 494 1314 495C1315 495 1315 495 1315 494C1315 493 1313 493 1311 493C1307 493 1306 493 1306 495C1305 499 1307 499 1311 496ZM1206 484C1206 472 1206 471 1208 468C1209 467 1211 466 1213 466C1215 466 1216 465 1216 465C1217 464 1217 464 1218 465C1218 466 1221 466 1230 466L1241 466L1243 463L1245 460L1232 460C1223 460 1218 460 1217 461C1217 462 1216 462 1216 461C1215 460 1212 460 1209 460L1203 460L1199 466C1194 473 1194 476 1197 477C1201 478 1204 487 1202 491C1201 492 1202 493 1203 495C1204 496 1206 497 1206 497C1206 497 1206 491 1206 484ZM1259 495C1260 493 1260 488 1259 487C1258 487 1258 483 1258 479C1258 474 1258 470 1258 469C1257 468 1254 468 1250 468C1243 468 1242 468 1240 470C1235 475 1218 495 1219 495C1220 497 1258 496 1259 495ZM1290 494C1292 493 1292 492 1290 490C1289 489 1286 486 1283 484C1280 482 1277 479 1277 479C1275 477 1266 470 1266 470C1265 470 1264 472 1264 474L1263 478L1263 473C1263 471 1263 469 1262 469C1261 469 1261 474 1261 482C1261 492 1261 494 1262 494C1263 493 1264 494 1265 494C1267 495 1288 495 1290 494ZM1229 480L1238 468L1229 468C1225 468 1220 468 1219 468C1218 469 1218 472 1218 480C1218 486 1218 491 1218 491C1219 491 1223 486 1229 480ZM1140 484C1144 481 1145 480 1143 480C1140 480 1134 482 1133 485C1133 488 1133 488 1140 484ZM1296 485C1296 484 1297 483 1297 484C1297 485 1297 485 1298 484C1301 482 1300 481 1296 477C1294 475 1292 473 1292 472C1293 472 1294 473 1296 475C1298 477 1300 478 1300 478C1301 478 1300 477 1298 475C1296 473 1293 470 1291 469C1288 465 1287 466 1290 470C1293 473 1291 473 1288 470C1285 468 1284 467 1281 468C1277 468 1277 468 1278 466C1278 462 1277 461 1271 461C1267 461 1266 461 1266 463C1266 466 1272 472 1278 477C1281 478 1284 481 1285 483C1289 486 1290 487 1290 484C1290 483 1290 483 1291 485C1292 486 1293 487 1294 487C1294 487 1295 486 1296 485ZM1061 484C1062 484 1062 483 1061 482C1060 481 1050 480 1050 481C1050 482 1058 486 1059 486C1059 486 1060 485 1061 484ZM1068 477C1069 477 1069 476 1069 474L1069 472L1049 472L1029 472L1029 475L1029 478L1042 478C1057 479 1067 478 1068 477ZM1130 477C1131 477 1131 475 1131 474L1132 472L1120 472C1113 472 1107 472 1107 473C1105 475 1107 477 1111 477C1117 478 1130 478 1130 477ZM1181 477C1180 476 1176 475 1173 474C1169 473 1168 473 1166 475C1163 477 1165 478 1174 478C1182 478 1182 478 1181 477ZM1144 475L1150 472L1143 472C1137 472 1136 472 1135 474C1134 475 1134 476 1134 476C1134 478 1139 477 1144 475ZM1216 473C1216 470 1215 468 1214 468C1211 468 1208 472 1208 475C1208 477 1208 477 1212 477C1215 477 1216 476 1216 473ZM1181 469C1183 469 1183 468 1183 465L1183 462L1177 465C1171 468 1171 469 1174 469C1178 470 1178 470 1181 469ZM1176 463C1183 459 1183 459 1183 454C1183 450 1183 450 1181 450C1179 450 1178 449 1177 449C1177 448 1176 448 1176 450C1175 453 1171 453 1169 450C1168 448 1168 449 1168 457C1168 463 1168 467 1169 467C1169 467 1172 465 1176 463ZM1193 461C1193 458 1191 458 1189 460C1186 461 1185 464 1188 466C1189 467 1190 466 1191 465C1192 464 1193 462 1193 461ZM1257 464C1258 461 1257 460 1252 460C1249 460 1247 461 1245 464C1244 466 1244 466 1250 466C1255 466 1256 466 1257 464ZM1202 454L1205 450L1200 450C1198 449 1196 449 1195 450C1194 450 1194 453 1194 457L1194 464L1197 460C1198 459 1200 456 1202 454ZM1249 456C1250 456 1250 455 1250 455C1250 455 1249 455 1248 454C1243 453 1220 454 1218 455C1217 456 1216 456 1215 455C1215 454 1207 454 1205 456C1202 457 1209 458 1228 458C1242 457 1248 457 1249 456ZM1252 451C1253 451 1254 450 1254 450C1254 448 1209 449 1208 450C1207 452 1211 452 1229 452C1241 452 1251 452 1252 451ZM1270 444C1270 443 1269 442 1268 442C1266 442 1266 442 1268 441C1271 440 1270 440 1264 440C1259 440 1258 440 1261 441C1264 442 1264 442 1262 442C1260 442 1259 443 1259 444C1259 446 1260 446 1264 446C1268 446 1270 445 1270 444ZM1172 424C1171 424 1171 422 1171 421C1171 420 1171 420 1172 421C1172 423 1174 422 1174 420C1174 418 1174 418 1175 418C1176 418 1177 417 1177 416C1177 416 1175 416 1174 416C1172 416 1171 415 1171 415C1172 414 1175 413 1182 414L1184 414L1182 415C1179 416 1179 417 1182 418C1185 418 1185 420 1182 419C1179 419 1179 419 1180 423C1181 425 1181 425 1180 424C1178 423 1178 423 1177 424C1176 425 1175 425 1175 424C1174 422 1172 423 1173 424C1173 425 1173 426 1173 426C1172 426 1172 425 1172 424Z\"/>"],
  salvage:["0 0 40 40", "<g><path d=\"M40,18.4v3.3H19.2c-0.5,1-1.6,1.7-2.9,1.7c-1.9,0-3.4-1.5-3.4-3.4c0-1.8,1.5-3.3,3.4-3.3 c1.3,0,2.4,0.7,2.9,1.7L40,18.4L40,18.4z\"/><path d=\"M8.3,20c0,4.4,3.6,8,8,8h1.3v8.4h-2.7v-5.7c-2-0.3-3.7-1.1-5.2-2.2l-4,4l-1.9-1.9l4-4 c-1.2-1.5-1.9-3.3-2.2-5.2H0v-2.7h5.7c0.3-2,1.1-3.7,2.2-5.2l-4-4l1.9-1.9l4,4c1.4-1.2,3.2-1.9,5.2-2.2V3.6h2.7V12h-1.3 C11.9,12,8.3,15.6,8.3,20L8.3,20z\"/><rect x=\"21.9\" y=\"9.6\" transform=\"matrix(0.7065 -0.7078 0.7078 0.7065 -0.2892 21.1554)\" width=\"6.9\" height=\"2.7\"/><rect x=\"24\" y=\"25.6\" transform=\"matrix(0.7072 -0.707 0.707 0.7072 -13.1281 26.4391)\" width=\"2.7\" height=\"6.9\"/></g>"],
  life_support:["0 0 64 64", "<path d=\"M56,31.2h-9.2l-5-6.3l-4.6,8.6l-6.5-13.7l-6.3,11.9l-4.3-6.1l-5.4,5.6H8C3.3,26,3.5,17.8,8.5,12.8 c2.6-2.6,6-3.9,9.5-3.9c3.4,0,6.8,1.3,9.5,3.9l4.6,4.6l4.6-4.6c5.3-5.2,13.7-5.2,18.9,0C60.5,17.8,60.7,26,56,31.2z\"/><polygon points=\"44.8,35.3 51.9,35.3 32,55.2 12.1,35.3 16.6,35.3 19.8,31.9 25,39.4 30.6,28.8 37.1,42.5 42.5,32.3\"/>"],
  qed:["0 0 64 64", "<path d=\"M46.8,41.2c-0.5,0.8-1.5,1.6-3.8,1.6c-1,0-2.1-0.2-3.5-0.5c-0.7-0.2-1.5-0.5-2.3-0.7c-1,4.6-2.8,7.9-5.3,7.9 c-2.3,0-4.2-2.8-5.3-7.5l1.8-1.9c1,5,2.5,7.3,3.5,7.3c1.1,0,2.4-2.4,3.3-6.5c-1.6-0.7-3.4-1.6-5.2-2.6l1.6-1.7 c1.3,0.7,2.6,1.4,3.9,1.9c0.3-1.9,0.5-4.1,0.4-6.4l2.2-2.3c0,0.7,0.1,1.4,0.1,2.2c0,2.5-0.2,5.1-0.5,7.5c0.8,0.3,1.6,0.5,2.4,0.7 c2.8,0.7,4.5,0.4,4.8-0.2c0.5-0.8-0.5-3.3-4.2-6.7l-0.1-2.9C46,34.9,48.3,38.8,46.8,41.2z M19,40.1c-0.4-0.6,0.1-2.2,2-4.5 c0.6-0.7,1.3-1.5,2.1-2.2c0.6,0.5,1.3,1,2,1.5l1.5-1.6c-0.6-0.4-1.2-0.9-1.7-1.3c1.4-1.2,3.1-2.4,4.9-3.5c1-0.6,1.9-1.1,2.9-1.6 l4.5-4.7c-0.9-4.4-2.7-7.5-5.2-7.5c-2.2,0-4,2.5-5.1,6.8c-0.3,1.2-0.6,2.4-0.8,3.9l2.4-1.5c0.9-4.8,2.5-7.1,3.5-7.1 c1.1,0,2.4,2.4,3.3,6.5c-2.1,0.8-4.4,2.1-6.7,3.5c-2,1.3-3.9,2.6-5.6,4c-0.8-0.7-1.5-1.5-2.1-2.2c-1.9-2.2-2.4-3.8-2-4.4 c0.4-0.7,2.4-0.9,5.7,0.1c0.1-0.6,0.2-1.5,0.4-2.1c-4.1-1.2-6.8-0.9-7.9,0.8c-0.7,1.2-0.8,3.3,2.2,6.9c0.6,0.7,1.3,1.5,2.2,2.2 c-0.8,0.8-1.5,1.5-2.2,2.2c-3.1,3.6-3,5.8-2.2,6.9c0.3,0.4,0.6,0.7,1,1l1.6-1.7C19.4,40.4,19.1,40.3,19,40.1z M45,24 c0.4,0.7-0.2,2.4-2.4,4.9l1.5,1.5c2.9-3.1,3.8-5.7,2.7-7.5c-0.2-0.4-0.5-0.7-1-1l-1.6,1.7C44.6,23.7,44.9,23.8,45,24z M54.5,10.5 l-2.2-2.1L8.1,54.9l2.2,2.1L54.5,10.5z M63,32L32,1L1,32l31,31L63,32z M32,5.2L58.8,32L32,58.8L5.2,32L32,5.2z\"/>"],
  missile_rack:["0 0 64 64", "<polygon points=\"43.7,27.2 53.5,33.3 53.5,27.1 59.3,27.2 59.3,23 59.3,18.9 53.5,18.9 53.5,12.7 43.6,18.9 26.6,18.9 24.3,18.9 24.2,12.7 19.5,18.8 13.3,18.9 4.7,23 13.4,27.2 19.5,27.2 24.3,33.3 24.2,27.2\"/><g><path d=\"M56,39.1v0.5c0,4.5-3.7,8.2-8.2,8.2h-3.6v3.5h-4.3v-3.5H26.2v3.5h-4.3v-3.5h-3.6c-4.6,0-8.2-3.7-8.2-8.2 v-1.8h4.3v1.8c0,2.1,1.8,3.9,3.9,3.9h29.4c2.1,0,3.9-1.7,3.9-3.9v-0.5H56z\"/></g>"],
  bomb:["0 0 40 40", "<g><g><rect x=\"13.8\" y=\"24\" transform=\"matrix(6.123234e-17 -1 1 6.123234e-17 -6.5292 45.7345)\" width=\"11.6\" height=\"4.2\"/><polygon points=\"22.4,12.4 22.4,17.1 21.7,18.8 17.5,18.8 16.9,17.1 16.9,12.4\"/><polygon points=\"16.8,10.9 18.9,5.5 20.3,5.5 22.4,10.9\"/><polygon points=\"12.2,30 12.2,33.9 16,32 16,26.5\"/><polygon points=\"27.3,30 27.3,33.9 23.4,32 23.4,26.5\"/></g></g>"],
  tractor:["0 0 40 40", "<g><circle cx=\"20\" cy=\"20\" r=\"3.2\"/><path d=\"M26.6,4.3L30,7.7l-4.1,4.2C24.2,10.6,22.1,10,20,10c-2.7,0-5.3,1.1-7.2,3c-3.5,3.6-3.7,9.2-0.8,13.1L8,30.3 l-3.7-3.7v9.1h9.1L10,32.3l4.1-4.2c1.7,1.2,3.7,1.9,5.9,1.9c2.7,0,5.3-1.1,7.2-3.1c3.5-3.6,3.7-9.2,0.8-13.1L32,9.7l3.7,3.7V4.3 H26.6z M25.1,25c-1.4,1.4-3.3,2.2-5.1,2.2c-1.8,0-3.6-0.7-5-2c-2.8-2.8-2.9-7.3-0.1-10.1c1.4-1.4,3.3-2.2,5.1-2.2 c1.8,0,3.6,0.7,5,2C27.8,17.6,27.9,22.2,25.1,25L25.1,25z\"/></g>"],
  turret:["0 0 64 64", "<path d=\"M37.9,54.8h8v1.6H13.4V54l10.9-2.3l-2.6-8.1l-7.5,1.9c-2.4-1.4-3.7-2.2-6.1-3.6l-1.6-6.2l24.2-6.3l0.8,3.2 l24.2-6.3l1.2,4.6l-24.2,6.3l0.8,3.2L27,42.3l3,9.5l6.8,0.9L37.9,54.8z\"/><path d=\"M33.7,18.4l0.8,3.2l-19.3,5c-2.4-1.4-3.7-2.2-6.1-3.6l-1.6-6.2l24.2-6.3l0.8,3.1l23.8-6.2l1.2,4.6l-23.8,6.2 L33.7,18.4z\"/>"],
  thrust:["0 0 160 153.6", "<g><polygon points=\"71.2,76.8 35.7,153.6 113.2,76.8 35.7,0\"/><polygon points=\"54.8,76.8 0,36.8 22.1,76.8 0,116.8\"/><polygon points=\"160,76.8 114.3,29.9 131.6,76.8 114.3,123.7\"/></g>"],
  fuel_tank:["0 0 1204.7 1204.7", "<g><path d=\"M602.3,163.2c-84.2,0-162.9,12-221.7,33.8c-57.7,21.4-78.2,45.9-78.2,60.5s20.5,39.1,78.2,60.5 c58.8,21.8,137.5,33.8,221.7,33.8s162.9-12,221.7-33.8c57.7-21.4,78.2-45.9,78.2-60.5S881.8,218.4,824,197 C765.2,175.2,686.5,163.2,602.3,163.2z\"/><path d=\"M842.6,368.1C778,392,692.7,405.2,602.3,405.2S426.7,392,362.1,368.1c-23.3-8.6-43.3-18.4-59.6-29.3v608.4 c0,14.5,20.5,39.1,78.2,60.5c58.8,21.8,137.5,33.8,221.7,33.8s162.9-12,221.7-33.8c57.7-21.4,78.2-45.9,78.2-60.5V338.8 C885.9,349.7,865.9,359.5,842.6,368.1z M434.2,909.9c0,17-13.8,30.8-30.8,30.8h0c-17,0-30.8-13.8-30.8-30.8V481.6 c0-17,13.8-30.8,30.8-30.8h0c17,0,30.8,13.8,30.8,30.8V909.9z\"/></g>"],
  rack:["0 0 1204.7 1204.7", "<rect x=\"396.9\" y=\"388.6\" width=\"76.1\" height=\"58\"/><rect x=\"908.8\" y=\"388.6\" width=\"76.1\" height=\"58\"/><rect x=\"396.9\" y=\"618.3\" width=\"76.1\" height=\"58\"/><rect x=\"908.8\" y=\"618.3\" width=\"76.1\" height=\"58\"/><path d=\"M1012.5,441.6v29.8H881.2v-29.8H500.6v29.8H369.3v-29.8H67.8v43.3c39.4,39.4,61.5,61.5,100.9,100.9h935.6l28.8-28.8V441.6 L1012.5,441.6L1012.5,441.6z\"/><path d=\"M1012.5,701.1H881.2v-29.8H500.6v29.8H369.3v-29.8H67.8v43.3c39.4,39.4,61.5,61.5,100.9,100.9h935.6l28.8-28.8V671.3h-120.6 V701.1L1012.5,701.1z\"/>"],
  mining_laser:["0 0 64 64", "<g><g><path d=\"M32,21.25c2.82,0,5.11,2.28,5.11,5.11c0,1.9-1.04,3.57-2.58,4.44v31.7h-5.03v-31.7 c-1.55-0.87-2.6-2.52-2.6-4.44C26.89,23.53,29.18,21.25,32,21.25z\"/></g><g><path d=\"M34.07,10.15c2.95,0.37,5.66,1.54,7.9,3.29l6.13-6.12l2.92,2.92l-6.12,6.13c1.75,2.24,2.92,4.95,3.29,7.9 h8.74v4.14H44.19v-2.07c0-6.72-5.48-12.19-12.19-12.19c-6.72,0-12.18,5.48-12.18,12.19v2.07H7.06v-4.14h8.76 c0.37-2.95,1.54-5.68,3.28-7.91l-6.12-6.12l2.92-2.92l6.13,6.12c2.24-1.75,4.95-2.92,7.9-3.29V1.51h4.14V10.15z\"/></g><g><rect x=\"43.75\" y=\"34.88\" transform=\"matrix(0.7071 -0.7071 0.7071 0.7071 -14.9847 44.1679)\" width=\"4.14\" height=\"10.58\"/></g><g><rect x=\"12.89\" y=\"38.1\" transform=\"matrix(0.7071 -0.7071 0.7071 0.7071 -23.0811 24.6216)\" width=\"10.58\" height=\"4.14\"/></g></g>"],
  guns:["0 0 32 32", "<path d=\"M0,11.4h4.6v0c0-1.6-0.3-3.1-0.7-4.6L2.7,3.3C2.6,2.9,2,2.9,1.9,3.3L0.7,6.7C0.3,8.2,0,9.8,0,11.4L0,11.4z\"/><polygon points=\"3.8,25.5 3.8,27.5 4.6,27.5 4.6,29 0,29 0,27.5 0.8,27.5 0.8,25.5 0,25.5 0,13.3 4.6,13.3 4.6,25.5\"/><path d=\"M9.1,11.4h4.6v0c0-1.6-0.3-3.1-0.7-4.6l-1.1-3.4c-0.1-0.4-0.7-0.4-0.8,0L9.9,6.7C9.4,8.2,9.1,9.8,9.1,11.4 L9.1,11.4z\"/><polygon points=\"13,25.5 13,27.5 13.7,27.5 13.7,29 9.1,29 9.1,27.5 9.9,27.5 9.9,25.5 9.1,25.5 9.1,13.3 13.7,13.3 13.7,25.5\"/><path d=\"M18.3,11.4h4.6v0c0-1.6-0.3-3.1-0.7-4.6L21,3.3c-0.1-0.4-0.7-0.4-0.8,0L19,6.7C18.5,8.2,18.3,9.8,18.3,11.4 L18.3,11.4z\"/><polygon points=\"22.1,25.5 22.1,27.5 22.9,27.5 22.9,29 18.3,29 18.3,27.5 19,27.5 19,25.5 18.3,25.5 18.3,13.3 22.9,13.3 22.9,25.5\"/><path d=\"M27.4,11.4H32v0c0-1.6-0.3-3.1-0.7-4.6l-1.1-3.4c-0.1-0.4-0.7-0.4-0.8,0l-1.1,3.4 C27.7,8.2,27.4,9.8,27.4,11.4L27.4,11.4z\"/><polygon points=\"31.2,25.5 31.2,27.5 32,27.5 32,29 27.4,29 27.4,27.5 28.2,27.5 28.2,25.5 27.4,25.5 27.4,13.3 32,13.3 32,25.5\"/>"],
  scatter:["0 0 64 64", "<g><g><g><path d=\"M48.36,34.06l-6.28-0.24c-1.11-0.04-1.97-0.97-1.93-2.08c0.04-1.05,0.89-1.88,1.93-1.92l6.28-0.24 c1.24-0.05,2.28,0.92,2.33,2.16c0.05,1.24-0.92,2.28-2.16,2.33C48.47,34.07,48.41,34.06,48.36,34.06z\"/><path d=\"M34.32,33.53l-6.28-0.24c-0.81-0.03-1.45-0.72-1.42-1.53c0.03-0.77,0.66-1.38,1.42-1.42l6.28-0.24 c0.95-0.04,1.74,0.7,1.78,1.65c0.04,0.95-0.7,1.74-1.65,1.78C34.41,33.53,34.37,33.53,34.32,33.53z\"/><path d=\"M21.35,33l-6.28-0.24c-0.52-0.02-0.93-0.46-0.91-0.98c0.02-0.49,0.42-0.89,0.91-0.91l6.28-0.24 c0.65-0.03,1.2,0.48,1.23,1.14c0.02,0.65-0.48,1.2-1.14,1.23C21.41,33,21.38,33,21.35,33z\"/></g><g><path d=\"M46.63,18.41l-6.06,1.66c-1.07,0.29-2.17-0.33-2.46-1.4c-0.28-1.01,0.28-2.06,1.26-2.42l5.92-2.12 c1.17-0.42,2.45,0.19,2.87,1.35c0.42,1.17-0.19,2.45-1.35,2.87C46.74,18.38,46.69,18.4,46.63,18.41z\"/><path d=\"M33.09,22.14l-6.06,1.66c-0.78,0.22-1.59-0.25-1.81-1.03c-0.2-0.75,0.21-1.52,0.92-1.78l5.92-2.12 c0.89-0.32,1.87,0.14,2.19,1.03c0.32,0.89-0.14,1.87-1.03,2.19C33.18,22.11,33.13,22.12,33.09,22.14z\"/><path d=\"M20.57,25.54l-6.06,1.66c-0.5,0.14-1.02-0.16-1.16-0.66c-0.13-0.48,0.13-0.97,0.59-1.14l5.92-2.12 c0.62-0.22,1.29,0.1,1.51,0.71c0.22,0.62-0.1,1.29-0.71,1.51C20.63,25.52,20.6,25.53,20.57,25.54z\"/></g><g><path d=\"M46.63,45.59l-6.06-1.66c-1.07-0.29-2.17,0.33-2.46,1.4c-0.28,1.01,0.28,2.06,1.26,2.42l5.92,2.12 c1.17,0.42,2.45-0.19,2.87-1.35c0.42-1.17-0.19-2.45-1.35-2.87C46.74,45.62,46.69,45.6,46.63,45.59z\"/><path d=\"M33.09,41.86l-6.06-1.66c-0.78-0.22-1.59,0.25-1.81,1.03c-0.2,0.75,0.21,1.52,0.92,1.78l5.92,2.12 c0.89,0.32,1.87-0.14,2.19-1.03c0.32-0.89-0.14-1.87-1.03-2.19C33.18,41.89,33.13,41.88,33.09,41.86z\"/><path d=\"M20.57,38.46l-6.06-1.66c-0.5-0.14-1.02,0.16-1.16,0.66c-0.13,0.48,0.13,0.97,0.59,1.14l5.92,2.12 c0.62,0.22,1.29-0.1,1.51-0.71c0.22-0.62-0.1-1.29-0.71-1.51C20.63,38.48,20.6,38.47,20.57,38.46z\"/></g></g></g>"],
  distortion:["0 0 264 264", "<g><path d=\"M47.1,127.9c1.1,0.3,2.2,0.5,3.3,0.5c5,0,9.7-3.3,11.1-8.4c0.3-1.2,0.7-2.4,1.1-3.6c2.1-6.1-1.1-12.7-7.1-14.8 c-6.1-2.1-12.7,1.1-14.8,7.1c-0.6,1.6-1.1,3.2-1.5,4.8C37.4,119.7,40.9,126.1,47.1,127.9z\"/><path d=\"M61.6,159.2c-0.4-1.2-0.7-2.4-1-3.6c-1.5-6.2-7.7-10.1-14-8.6c-6.2,1.5-10.1,7.7-8.6,14c0.4,1.6,0.8,3.2,1.3,4.8 c1.5,5.1,6.1,8.3,11.1,8.3c1.1,0,2.2-0.2,3.3-0.5C59.8,171.8,63.4,165.3,61.6,159.2z\"/><path d=\"M188.6,105c2.1,3.7,6.1,5.8,10.1,5.8c2,0,3.9-0.5,5.8-1.5c5.6-3.2,7.5-10.3,4.3-15.9c-0.8-1.4-1.7-2.9-2.6-4.3 c-3.5-5.4-10.7-6.9-16.1-3.4c-5.4,3.5-6.9,10.7-3.4,16.1C187.3,102.9,188,103.9,188.6,105z\"/><path d=\"M75,89.9c2.7,0,5.4-0.9,7.6-2.9c0.9-0.8,1.9-1.6,2.9-2.4c2-1.6,3.4-3.7,4-5.9c-1-3.2-1.8-6.7-2.1-10.5 c-4-5-11.2-5.8-16.2-1.9c-1.3,1-2.6,2.1-3.8,3.2c-4.8,4.2-5.3,11.5-1.1,16.4C68.6,88.6,71.8,89.9,75,89.9z\"/><path d=\"M82.8,192.1c-0.9-0.8-1.9-1.7-2.8-2.5c-4.6-4.5-12-4.3-16.4,0.3c-4.5,4.6-4.3,12,0.3,16.4c1.2,1.1,2.4,2.3,3.7,3.4 c2.2,1.9,4.9,2.8,7.6,2.8c3.3,0,6.5-1.4,8.8-4C88.2,203.6,87.6,196.3,82.8,192.1z\"/><path d=\"M202.8,173.6c-5.4-3.5-12.6-1.9-16,3.5c-0.7,1-1.4,2.1-2.1,3.1c-3.8,5.2-2.6,12.5,2.6,16.2c2.1,1.5,4.4,2.2,6.8,2.2 c3.6,0,7.1-1.7,9.4-4.8c1-1.3,1.9-2.7,2.8-4.1C209.7,184.3,208.2,177.1,202.8,173.6z\"/><path d=\"M157.1,202.8C157.1,202.8,157.1,202.8,157.1,202.8c4.5,5,8.8,11.7,10.8,20.5c5-3,7-9.3,4.6-14.8 C169.9,202.6,163,200.1,157.1,202.8z\"/><path d=\"M221,139.3c0-6.4-5.2-11.6-11.6-11.6s-11.6,5.2-11.6,11.6l0,0.2c0,1.2,0,2.5-0.1,3.8c-0.3,6.4,4.6,11.9,11,12.2 c0.2,0,0.4,0,0.6,0c6.1,0,11.3-4.8,11.6-11c0.1-1.7,0.1-3.3,0.1-5L221,139.3z\"/><path d=\"M171.1,57.3c-1.5-0.8-3-1.5-4.5-2.2c-1.3-0.6-2.6-0.9-3.9-1c-2.5,4.1-5.4,7.5-8.2,10.3c3.7,3.7,7.7,8.6,10.6,14.8 c0.2,0,0.4,0,0.6,0c4.2,0,8.2-2.3,10.3-6.2C179,67.3,176.8,60.2,171.1,57.3z\"/></g><path d=\"M149.6,235.3H129c0-3.1-1.4-4.6-7.1-9c-6-4.6-15.1-11.7-15.1-25.3c0-13.6,9.1-20.7,15.1-25.3c5.7-4.4,7.1-5.9,7.1-9 c0-3.1-1.4-4.6-7.1-9c-6-4.6-15.1-11.7-15.1-25.3c0-13.6,9.1-20.7,15.1-25.3c5.7-4.4,7.1-5.9,7.1-9s-1.4-4.6-7.1-9 c-6-4.6-15.1-11.7-15.1-25.3c0-13.6,9.1-20.7,15.1-25.3c5.7-4.4,7.1-5.9,7.1-9h20.6c0,13.6-9.1,20.7-15.1,25.3 c-5.7,4.4-7.1,5.9-7.1,9c0,3.1,1.4,4.6,7.1,9c6,4.6,15.1,11.7,15.1,25.3s-9.1,20.7-15.1,25.3c-5.7,4.4-7.1,5.9-7.1,9 c0,3.1,1.4,4.6,7.1,9c6,4.6,15.1,11.7,15.1,25.3c0,13.6-9.1,20.7-15.1,25.3c-5.7,4.4-7.1,5.9-7.1,9c0,3.1,1.4,4.6,7.1,9 C140.5,214.7,149.6,221.7,149.6,235.3z\"/>"],
  combat:["0 0 16 16", "<path d=\"m12.682 12.29-.943-.928-1.008.116-1.673-1.645.416-.8-2.192-2.159-1.327-.092-1.21-1.19a3 3 0 0 0-.335-.286L2.417 3.937c-.29-.19-1.14-.753-1.365-.53-.225.22.347 1.05.54 1.335l1.383 1.954q.146.193.319.363L4.48 8.225l.092 1.308 2.192 2.158.824-.41 1.666 1.64-.065.943.944.928.697-.321.537.529 1.474-1.443-.54-.53.38-.733zm2.068-3.453-.387-.38.298-.572-.725-.713-.788.09-1.302-1.28.325-.627-1.684-1.657-1.037-.073-.92-.906a2.4 2.4 0 0 0-.258-.22l-1.53-1.052c-.222-.146-.876-.578-1.05-.408s.268.807.415 1.025L7.17 3.566q.113.146.245.278l.904.89.071 1.017 1.684 1.658.641-.32-.008-.008 1.307 1.286-.05.734.725.714.543-.251.386.378 1.132-1.11z\"/>"],
  beam:["0 0 40 40", "<polygon points=\"39.9,10.4 39.2,18.3 36.7,4.9 37.7,18 29.8,11.3 37,19 1.9,19 1.9,21 37,21 29.8,28.7 37.7,22 36.7,35.1 39.2,21.7 39.9,29.6 39.9,20\"/>"]};
const cpGI=k=>CP_GI[k]?`<svg class="ofc" viewBox="${CP_GI[k][0]}" aria-hidden="true">${CP_GI[k][1]}</svg>`:"";
const offIcon64=k=>OFF_ICONS64[k]?`<svg class="ofc" viewBox="0 0 64 64" aria-hidden="true">${OFF_ICONS64[k]}</svg>`:"";
const CP_OFF64=[[/mining\s*module/i,"mining"],[/salvage\s*head|scraper/i,"salvage"],[/\bemp\b/i,"emp"]];
const offIcon=k=>OFF_ICONS[k]?`<svg class="ofc" viewBox="0 0 16 16" aria-hidden="true">${OFF_ICONS[k]}</svg>`:"";
// Component categories with a game icon (first match wins, so racks and turrets come before missiles and guns)
const CP_OFF=[[/mining\s*(laser|head)/i,"miningLasers"],[/\bemp\b|interdiction|\bqed\b|enforcement|rocket\s*pod|life\s*support|towing|nozzle|scraper/i,null],[/missile\s*rack|bomb|rack|tube|point\s*defen|pdc|mining|salvage/i,null],[/turret/i,"turrets"],[/quantum\s*fuel/i,"quantumFuelTanks"],[/fuel/i,"fuelTanks"],[/jump/i,"jumpModules"],
  [/quantum/i,"quantumDrives"],[/missile|torpedo/i,"missiles"],[/cooler/i,"coolers"],[/power/i,"powerPlants"],[/shield/i,"shieldGenerator"],
  [/radar|scanner/i,"radar"],[/cargo|container|grid/i,"shipCapacity"],[/utility|tractor/i,"utilityItems"],[/gun|cannon|repeater|weapon/i,"weapons"]];
// Which game icon each component category gets, by its name in the Components tab (first match wins)
const CP_GAME=[[/^radar/i,()=>offIcon("radar")],[/^jump/i,()=>offIcon("jumpModules")],[/^coolers?$/i,()=>offIcon("coolers")],
  [/^flight\s*blade/i,()=>cpGI("thrust")],[/^life\s*support/i,()=>cpGI("life_support")],[/^power\s*plant/i,()=>offIcon("powerPlants")],
  [/^quantum\s*drive/i,()=>offIcon("quantumDrives")],[/^shield/i,()=>offIcon("shieldGenerator")],[/^docking/i,()=>gameIcon("docking_refuel")],
  [/^fuel\s*pod/i,()=>cpGI("fuel_tank")],[/^mining\s*laser/i,()=>cpGI("mining_laser")],[/^mining\s*module/i,()=>offIcon64("mining")],
  [/\bqed\b|quantum\s*enforcement|interdiction/i,()=>cpGI("qed")],[/^salvage\s*head/i,()=>offIcon64("salvage")],
  [/^scraper/i,()=>cpGI("salvage")],[/^towing/i,()=>offIcon("utilityItems")],[/^tractor/i,()=>cpGI("tractor")],
  [/^bomb\s*rack/i,()=>cpGI("rack")],[/^bombs?$/i,()=>cpGI("bomb")],[/\bemp\b/i,()=>offIcon64("emp")],[/^guns?$/i,()=>cpGI("guns")],
  [/^missile\s*rack/i,()=>cpGI("missile_rack")],[/^missiles?$/i,()=>offIcon("missiles")],[/point\s*defen/i,()=>cpGI("combat")],
  [/^rocket\s*pod/i,()=>cpGI("combat")],[/^torpedo\s*tube/i,()=>gameIcon("torpedo")],[/^turrets?$/i,()=>cpGI("turret")],[/^ore\s*pod/i,()=>cpGI("fuel_tank")]];
const cpIcon=c=>{ const t=`${c.name} ${c.section}`;
  const gm=CP_GAME.find(([re])=>re.test(String(c.name||"").trim())); if(gm){ const h=gm[1](); if(h) return h; }
  const g64=CP_OFF64.find(([re])=>re.test(c.name||"")); if(g64) return offIcon64(g64[1]);
  if(/torpedo/i.test(t)&&!/rack|launcher/i.test(t)) return gameIcon("torpedo");   // the game's own torpedo icon (torpedoes and their tubes)
  const hit=CP_OFF.find(([re])=>re.test(t)); if(hit&&hit[1]) return offIcon(hit[1]); return cpIconDrawn(c); };
const cpIconDrawn=c=>`<svg viewBox="0 0 24 24" aria-hidden="true">${(CP_ICONS.find(([re])=>re.test(`${c.name} ${c.section}`))||[0,'<rect x="5" y="5" width="14" height="14" rx="2"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>'])[1]}</svg>`;
// Ship guns by how they fire (the server works the kind out from each gun's name and game-file numbers)
const WT_ICONS={
  repeater:'<path d="M2.5 7.5h10M2.5 12h10M2.5 16.5h10"/><path d="M15 7.5h2.2M19.5 7.5h2M15 12h2.2M19.5 12h2M15 16.5h2.2M19.5 16.5h2"/>',
  cannon:'<rect x="2.5" y="9" width="10.5" height="6" rx="1.5"/><path d="M13 10.3h2.8v3.4H13"/><circle cx="19.3" cy="12" r="2.6"/>',
  gatling:'<circle cx="7.5" cy="12" r="5"/><circle cx="7.5" cy="9.2" r="1.1"/><circle cx="9.9" cy="13.4" r="1.1"/><circle cx="5.1" cy="13.4" r="1.1"/><path d="M12.5 9.3h9M12.5 12h9M12.5 14.7h9"/>',
  scattergun:'<rect x="2.5" y="10" width="7.5" height="4" rx="1"/><path d="M11.5 12l9.5-6.5M11.5 12H21M11.5 12l9.5 6.5"/><circle cx="16.5" cy="8.6" r=".9"/><circle cx="17" cy="15.4" r=".9"/>',
  distortion:'<path d="M2 12h3l2.2-6 3.3 12 3.3-12 3.3 12 2.2-6H22"/>',
  beam:'<rect x="2.5" y="9.5" width="7" height="5" rx="1"/><path d="M9.5 12H22" stroke-width="2.6"/><path d="M12 9h9.5M12 15h9.5" opacity=".45"/>',
  massdriver:'<path d="M2.5 8.5h17M2.5 15.5h17M5 12h16"/><path d="M19.5 6.5v11"/>',
  other:'<rect x="2.5" y="9.5" width="8.5" height="6.5" rx="1.2"/><path d="M11 11.3h9.5M11 14.2h9.5M20.5 10v5.5"/><path d="M5 16v3.5h4"/>'};
// Ship guns by kind: the game's own icons (other guns: its ammo mark). Mass drivers keep the drawn one until the
// game's is picked.
const WT_GAME={distortion:"distortion",scattergun:"scatter",gatling:"gatling",repeater:"combat",cannon:"combat",beam:"beam"};
const wtIcon=k=>k==="other"?gameIcon("ammo"):WT_GAME[k]?cpGI(WT_GAME[k]):`<svg viewBox="0 0 24 24" aria-hidden="true">${WT_ICONS[k]||WT_ICONS.other}</svg>`;
const WT_DEFAULT=[["distortion","Distortion"],["scattergun","Scatterguns"],["gatling","Gatlings"],["repeater","Repeaters"],["cannon","Cannons"],["beam","Beams"],["massdriver","Mass drivers"],["other","Other guns"]];
const wtTypes=()=>S.cpIndex?.types||S.cpTypes||WT_DEFAULT;
const wtLabel=k=>(wtTypes().find(t=>t[0]===k)||[k,"Guns"])[1];
// How many guns of each kind a category has, once the index of every part is in (else null)
const wtCounts=catId=>{ if(!S.cpIndex) return null; const n={}; for(const i of S.cpIndex.items) if(String(i.cat)===String(catId)&&i.wtype) n[i.wtype]=(n[i.wtype]||0)+1; return n; };
// The index of every part in every category, for the search on the Components home. Loaded once, in the background.
async function cpLoadIndex(){ if(S.cpIndex||S.cpIndexP) return S.cpIndexP;
  S.cpIndexP=api().uex_component_index().then(r=>{ if(r?.ok){ S.cpIndex=r;
      // categories with nothing listed in them (Fuel Nozzles, for now) are taken off the list until parts show up
      const E=new Set((r.empty||[]).map(String)); S.cpEmpty=S.cpEmpty||new Set();
      for(const c of S.cpCats||[]) if(E.has(String(c.id))) S.cpEmpty.add(c.id); }
    S.cpIndexP=null; return S.cpIndex; }).catch(()=>{ S.cpIndexP=null; return null; });
  return S.cpIndexP; }
// Short names players use for makers, added to what a search looks through: "RSI" finds Roberts Space
// Industries' parts. Makers with three or more words also get their initials (Gorgon Defender Industries: "GDI").
const MAKER_ALIAS=[[/roberts space/i,"rsi"],[/amon & reese/i,"a&r ar"],[/klaus & werner/i,"k&w kw"],[/wen\/cassel/i,"wcp wen cassel"],
  [/lightning power/i,"lpl"],[/juno starwerk/i,"juno"],[/hurston dynamics/i,"hd"],[/aegis/i,"aegs"],[/anvil/i,"anvl"],
  [/gallenson/i,"gts"],[/tyler design/i,"tdt"],[/sakura sun/i,"ss"],[/kruger/i,"krig"],[/origin jumpworks/i,"origin"],
  [/musashi/i,"misc"],[/consolidated outland/i,"cnou"],[/crusader/i,"crus"],[/grey'?s market/i,"greys"]];
const MAKER_SKIP=/^(&|and|of|the|co\.?|ltd\.?|inc\.?|corp\.?|corporation)$/i;
const makerAliasMemo={};
function makerAlias(m){ m=String(m||""); if(!m) return ""; if(m in makerAliasMemo) return makerAliasMemo[m];
  const out=MAKER_ALIAS.filter(([re])=>re.test(m)).map(([,a])=>a), words=m.split(/[\s\/-]+/).filter(w=>w&&!MAKER_SKIP.test(w));
  if(words.length>=3) out.push(words.map(w=>w[0]).join(""));
  return makerAliasMemo[m]=out.join(" ").toLowerCase(); }
// A search word matches a whole word of the text, or the start of one, so "rsi" doesn't hit the middle of
// another word, while "atl" still finds "Atlas". Longer words (4+ letters) may match anywhere, as before.
// Spaces don't count either: "all stop" finds the AllStop and "allstop" finds "All Stop" (4+ letters typed).
const squash=t=>String(t||"").toLowerCase().replace(/[^a-z0-9]+/g,"");
const cpQueryHit=(t,q)=>{ const w=q.split(/\s+/).filter(Boolean); if(w.every(x=>cpWordHit(t,x))) return true; const z=squash(q); return z.length>=4&&squash(t).includes(z); };
const cpWordHit=(t,w)=>w.length>=4?t.includes(w):new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}`).test(t);
// Parts anywhere that match a search: name, maker, category, or a gun's kind ("repeater")
function cpSearchAll(q){ if(!S.cpIndex||q.length<2) return [];
  const words=q.split(/\s+/).filter(Boolean);
  return S.cpIndex.items.filter(i=>{ const t=`${i.name} ${i.aka||""} ${i.maker} ${makerAlias(i.maker)} ${i.cat_name} ${i.wtype?wtLabel(i.wtype):""} ${i.size?`s${i.size}`:""}`.toLowerCase(); return words.length&&cpQueryHit(t,q); })
    .sort((a,b)=>((b.name||"").toLowerCase().startsWith(q))-((a.name||"").toLowerCase().startsWith(q))||(a.name||"").localeCompare(b.name||"")); }
const cpSize=i=>{ const v=i.game?.size??i.size; return v==null||v===""?"":String(v); };
const cpGrade=i=>String(i.game?.grade||i.grade||"");
async function openComponents(){
  loadBrands(()=>{ if(S.tab==="components"&&S.cpDetail) renderComponents(); });
  if(!S.live?.log?.uex_token){ cpShowBrowse(false); $("cp-home").innerHTML=needToken; $("cp-panel").innerHTML=""; return; }
  if(!S.cpCats){ $("cp-home").innerHTML=`<div class="muted" style="margin-top:10px">Loading…</div>`; $("cp-panel").innerHTML=qLoader("Loading components…");
    const r=await api().uex_component_categories(); if(!r.ok){ $("cp-home").innerHTML=`<div class="empty">${esc(r.error)}</div>`; $("cp-panel").innerHTML=""; return; }
    S.cpCats=r.items; S.cpEmpty=S.cpEmpty||new Set(); }
  if(!S.cpCat) return renderCpHome();
  cpShowBrowse(true); if(!S.cpItems) await loadComponents(); else { S.cpGalKey=null; renderComponents(); } }
function cpShowBrowse(on){ $("cp-home").hidden=on; $("cp-browse").hidden=!on; }
function cpGroups(q){ const cats=(S.cpCats||[]).filter(c=>!S.cpEmpty.has(c.id)&&(!q||`${c.section} ${c.name}`.toLowerCase().includes(q)));
  return [...new Set(cats.map(c=>c.section))].map(sec=>[sec,cats.filter(c=>c.section===sec)]); }
// The landing page: the sidebar lists every category by section; the big panel shows them as tiles.
async function renderCpHome(){ S.cpCat=null; S.cpItems=null; S.cpDetail=null; S.cpSel=null; cpShowBrowse(false);
  if(!$("cp-home-q")) $("cp-home").innerHTML=`<input class="search" id="cp-home-q" placeholder="Find any part or category, like “Prophet” or “Coolers”" autocomplete="off"><div id="cp-home-list"></div>`;
  const q=$("cp-home-q").value.trim().toLowerCase(), G=cpGroups(q);
  if(!S.cpIndex) cpLoadIndex().then(ix=>{ if(ix&&!S.cpCat&&S.tab==="components") renderCpHome(); });
  const parts=cpSearchAll(q), searching=q.length>=2, ship=searching?cpShipFor(q,()=>{ if(!S.cpCat&&S.tab==="components"&&$("cp-home-q")?.value.trim().toLowerCase()===q) renderCpHome(); }):null;
  // a gun category is shown with its kinds under it: Repeaters, Cannons, Distortion…
  const kinds=c=>{ if(c.slot!=="WeaponGun") return []; const n=wtCounts(c.id); return wtTypes().filter(([k])=>!n||n[k]); };
  const partBtn=i=>`<button class="cp-nav part" data-cppart="${esc(i.cat)}|${esc(i.id)}"><span class="ic">${i.wtype?wtIcon(i.wtype):cpIcon({name:i.cat_name||"",section:""})}</span><span class="t">${esc(i.name)}<small>${esc(i.cat_name||"")}${i.size?` · S${esc(i.size)}`:""}${i.maker?` · ${esc(i.maker)}`:""}</small></span><i>›</i></button>`;
  $("cp-home-list").innerHTML=(ship?cpShipSide(ship,partBtn):"")+(searching?`<div class="mk-h">Parts ${S.cpIndex?`<span class="muted" style="text-transform:none;letter-spacing:0">${parts.length}</span>`:""}</div>`
      +(S.cpIndex?(parts.length?parts.slice(0,40).map(partBtn).join("")+(parts.length>40?`<div class="muted" style="font-size:12px;margin:4px 2px 8px">${parts.length-40} more on the right</div>`:"")
        :`<div class="muted" style="font-size:12.5px;margin:2px 2px 10px">No part matches “${esc(q)}”</div>`)
        :`<div class="muted" style="font-size:12.5px;margin:2px 2px 10px">Searching every category…</div>`):"")
    +(G.length?G.map(([sec,L])=>`<div class="mk-h">${esc(sec)}</div>${L.map(c=>`<button class="cp-nav" data-cpcat="${c.id}"><span class="ic">${cpIcon(c)}</span><span class="t">${esc(c.name)}</span><i>›</i></button>`
        +kinds(c).map(([k,lab])=>`<button class="cp-nav sub" data-cpcat="${c.id}" data-wtype="${k}"><span class="ic">${wtIcon(k)}</span><span class="t">${esc(lab)}</span><i>›</i></button>`).join("")).join("")}`).join("")
      :searching?"":`<div class="empty">No category matches “${esc(q)}”</div>`);
  const fl=await api().fleet_list(); if(S.cpCat) return; const main=fl.ships.find(x=>x.main);
  const tile=c=>`<button class="cp-tile" data-cpcat="${c.id}"><span class="ic">${cpIcon(c)}</span><span><b>${esc(c.name)}</b><small>${c.slot?"Browse, buy and fit to My Fleet":"Browse and buy"}</small></span></button>`;
  const ktile=(c,k,lab)=>{ const n=wtCounts(c.id)?.[k]; return `<button class="cp-tile wt" data-cpcat="${c.id}" data-wtype="${k}"><span class="ic">${wtIcon(k)}</span><span><b>${esc(lab)}</b><small>${n?`${n} gun${n===1?"":"s"}`:"Ship guns"}</small></span></button>`; };
  if(ship?.fit?.ok&&S.cpIndex){ $("cp-panel").innerHTML=cpShipPanel(ship); fillPictures($("cp-panel")); return; }
  if(searching&&S.cpIndex&&parts.length){
    const P=parts.slice(0,120);
    $("cp-panel").innerHTML=`<div class="gh"><b>Parts matching “${esc(q)}”</b>${parts.length} in every category${parts.length>120?" · showing 120":""} · click one for its page</div>
      <div class="grid">${P.map(i=>`<div class="vg" data-cppart="${esc(i.cat)}|${esc(i.id)}"><div class="ph ph-g" data-pic="${esc(i.wiki||i.name)}">${phCard("component")}</div>
        <div class="tx"><b>${esc(i.name)}</b><span>${i.size?`S${esc(i.size)} · `:""}${i.grade?`${esc(i.grade)} · `:""}${esc(i.maker)}</span><span class="kt">${i.wtype?`${wtIcon(i.wtype)} ${esc(wtLabel(i.wtype))}`:esc(i.cat_name||"")}</span></div></div>`).join("")}</div>`;
    fillPictures($("cp-panel")); return; }
  $("cp-panel").innerHTML=`<div class="cp-land"><div class="cp-hero"><h2>Components</h2><p>Pick a category to browse, or search for any part by name in the box on the left. Each one has filters, numbers from the game files, the shops that sell it, and a button to fit a part to any ship in your fleet.</p></div>
    ${main?`<div class="main-ship">${main.photo?`<img src="${esc(main.photo)}" alt="" referrerpolicy="no-referrer">`:""}<div style="flex:1"><div class="muted" style="font-size:12px">Primary ship</div><b>${esc(main.full)}</b></div><button class="btn small" data-act="openfleet">Open My Fleet</button></div>`
      :`<div class="main-ship"><div style="flex:1"><b>No ships in My Fleet yet</b><div class="muted" style="font-size:12.5px">Add the ships you own there, then fit parts to them from any component page.</div></div><button class="btn small" data-act="openfleet">Open My Fleet</button></div>`}
    ${G.map(([sec,L])=>`<section class="cp-sec"><h3>${esc(sec)}</h3><div class="cp-tiles">${L.map(c=>tile(c)+kinds(c).map(([k,lab])=>ktile(c,k,lab)).join("")).join("")}</div></section>`).join("")
      ||`<div class="empty">No category matches “${esc(q)}”</div>`}</div>`; }
// A part found by the search on the home page: open its category, then its page.
async function openCpPart(ref){ const [cat,id]=String(ref).split("|"); await openCpCat(cat); if(!S.cpItems||String(S.cpCat?.id)!==String(cat)) return;
  S.cpSel=id; S.cpDetail=id; renderComponents(); $("pane-components").scrollTop=0; }
async function openCpCat(id,wtype){ const c=(S.cpCats||[]).find(x=>String(x.id)===String(id)); if(!c) return;
  S.cpCat=c; S.cpItems=null; S.cpFit=null; S.cpDetail=null; S.cpSel=null; S.cpGalKey=null; S.cpWtype=wtype||"";
  for(const k of ["cp-search","cp-size","cp-grade","cp-maker","cp-avail","cp-ship","cp-wtype"]) $(k).value="";
  $("cp-title").textContent=c.name; cpShowBrowse(true); $("pane-components").scrollTop=0; await loadComponents(); }
async function loadComponents(){ const c=S.cpCat; if(!c) return;
  $("cp-out").innerHTML=`<div class="muted" style="margin-top:10px">Loading…</div>`; $("cp-count").textContent=""; $("cp-panel").innerHTML=qLoader(`Loading ${c.name}…`);
  const [r,fl]=await Promise.all([api().uex_components(String(c.id).startsWith("wiki:")?c.id:+c.id),api().fleet_list()]); if(S.cpCat!==c) return;
  if(!r.ok){ $("cp-out").innerHTML=`<div class="empty">${esc(r.error)}</div>`; $("cp-panel").innerHTML=""; return; }
  if(!r.items.length){ S.cpEmpty.add(c.id); toast(`Nothing is listed under ${c.name}, so it's been taken off the list`); return renderCpHome(); }
  S.cpItems=r.items; S.cpAt=r.at;
  const opts=(vals,label)=>`<option value="">Any</option>`+vals.map(v=>`<option value="${esc(v)}">${esc(label(v))}</option>`).join("");
  const num=(a,b)=>String(a).localeCompare(String(b),undefined,{numeric:true});
  $("cp-size").innerHTML=opts([...new Set(r.items.map(cpSize).filter(Boolean))].sort(num),v=>`Size ${v}`);
  $("cp-grade").innerHTML=opts([...new Set(r.items.map(cpGrade).filter(Boolean))].sort(),v=>`Grade ${v}`);
  $("cp-maker").innerHTML=opts([...new Set(r.items.map(i=>i.game?.maker||i.maker).filter(Boolean))].sort(),v=>v);
  if(r.types) S.cpTypes=r.types;
  const wts=r.types?r.types.filter(([k])=>r.items.some(i=>i.wtype===k)):[];
  $("cp-wtype-wrap").hidden=!wts.length;
  $("cp-wtype").innerHTML=`<option value="">Any kind</option>`+wts.map(([k,lab])=>`<option value="${k}">${esc(lab)}</option>`).join("");
  $("cp-wtype").value=wts.some(([k])=>k===S.cpWtype)?S.cpWtype:"";
  const key=CP_KEY[c.slot];
  $("cp-sort").innerHTML=`${key?`<option value="key">${esc(key[1])}: best first</option>`:""}<option value="price">Price: low to high</option><option value="price_desc">Price: high to low</option><option value="size">Size</option><option value="name">A–Z</option>`;
  $("cp-ship-wrap").hidden=!c.slot||!fl.ships.length;
  $("cp-ship").innerHTML=`<option value="">Any ship</option>`+fl.ships.map(s=>`<option value="${esc(s.uid)}">${esc(s.full)}${s.main?" (primary)":""}</option>`).join("");
  renderComponents();
  if(c.slot&&fl.ships.length) cpFitData().then(f=>{ if(f&&S.cpCat===c&&S.cpItems){ S.cpGalKey=null; if(!S.cpDetail) renderComponents(); } }); }
// The size filter "fits a ship" needs that ship's slots: fetched once per category, for every ship.
async function cpFitData(){ const c=S.cpCat; if(!c?.slot) return null;
  if(!S.cpFit||S.cpFit.cat!==c.id){ const r=await api().component_fit_targets(c.name); if(S.cpCat!==c) return null; S.cpFit={...r,cat:c.id}; }
  return S.cpFit; }
function cpFiltered(){ const q=$("cp-search").value.trim().toLowerCase(), size=$("cp-size").value, grade=$("cp-grade").value, maker=$("cp-maker").value,
    avail=$("cp-avail").value, ship=$("cp-ship").value, sort=$("cp-sort").value;
  let fits=null; if(ship&&S.cpFit?.ok){ const sh=S.cpFit.ships.find(s=>s.uid===ship); fits=new Set((sh?.slots||[]).map(s=>String(s.size))); }
  const wt=$("cp-wtype").value;
  // A ship's name typed here (and no part by that name): the parts in this category that fit that ship
  const txt=i=>`${i.name} ${i.aka||""} ${i.maker} ${i.game?.maker||""} ${makerAlias(i.game?.maker||i.maker)} ${i.wtype?wtLabel(i.wtype):""}`.toLowerCase();
  let shipQ=null;
  if(q.length>=3&&S.cpCat?.slot&&!S.cpItems.some(i=>cpQueryHit(txt(i),q))){
    const sh=cpShipFor(q,()=>{ if(S.cpItems&&$("cp-search").value.trim().toLowerCase()===q) renderComponents(); });
    if(sh) shipQ={sh,slot:sh.fit?.ok?(sh.fit.slots[S.cpCat.slot]||{sizes:[],count:0,none:true}):null}; }
  const shipFit=i=>{ const sl=shipQ.slot; if(!sl||sl.none) return false; return !sl.sizes.length||i.size==null||i.size===""||sl.sizes.includes(Number(cpSize(i))); };
  const L=S.cpItems.filter(i=>(!wt||i.wtype===wt)&&(shipQ?shipFit(i):!q||(t=>cpQueryHit(t,q))(`${i.name} ${i.aka||""} ${i.maker} ${i.game?.maker||""} ${makerAlias(i.game?.maker||i.maker)} ${i.wtype?wtLabel(i.wtype):""}`.toLowerCase()))&&(!size||cpSize(i)===size)&&(!grade||cpGrade(i)===grade)
    &&(!maker||(i.game?.maker||i.maker)===maker)&&(avail!=="buy"||i.buy.length)&&(avail!=="noshop"||!i.buy.length)&&(!fits||fits.has(cpSize(i))));
  const price=i=>i.buy[0]?.price??null, key=CP_KEY[S.cpCat?.slot]?.[0], kv=i=>+(i.game?.stats?.[key])||null;
  const by={price:(a,b)=>(price(a)==null)-(price(b)==null)||(price(a)??0)-(price(b)??0),
    price_desc:(a,b)=>(price(a)==null)-(price(b)==null)||(price(b)??0)-(price(a)??0),
    size:(a,b)=>cpSize(a).localeCompare(cpSize(b),undefined,{numeric:true})||(a.name||"").localeCompare(b.name||""),
    name:(a,b)=>(a.name||"").localeCompare(b.name||""), key:(a,b)=>(kv(a)==null)-(kv(b)==null)||(kv(b)??0)-(kv(a)??0)}[sort];
  if(by) L.sort(by); return {L, fits, ship, shipQ}; }
// Which of your ships have a slot this part fits (same kind and size). Null until the fleet's slots are known.
function cpFitsShips(i){ const f=S.cpFit; if(!f?.ok||f.cat!==S.cpCat?.id||!f.ships?.length) return null; const sz=cpSize(i);
  return f.ships.filter(s=>s.slots.some(x=>!sz||String(x.size)===sz)); }
// Only your primary ship is called out; the component page's "Fit to a ship" section covers the rest.
function cpFitsLine(i){ const main=cpFitsShips(i)?.find(s=>s.main); return main?`<span class="fits" title="Has a slot this fits (in its primary loadout)">✓ Fits your ${esc(main.name)}</span>`:""; }
function cpKeyText(i){ const k=CP_KEY[S.cpCat?.slot], v=k&&i.game?.stats?.[k[0]]; if(!v) return "";
  const f=CP_STATS.find(x=>x[0]===k[0]), st=i.game?.stats||{};
  if(k[0]==="missiles") return `${v} × S${st.missile_size||"?"} missiles`;
  return `${f?f[2](v):v}${k[0]==="dps"?" DPS":k[0]==="shield_hp"?" HP":k[0]==="missile"?" dmg":""}${k[0]==="qt_speed"?qdTimes(st):""}${k[0]==="shield_hp"?shRegen(st):""}`; }
function cpCard(i,pinned){ const b=i.buy[0], kt=cpKeyText(i);
  return `<div class="vh ${pinned?"hl":""}"><div class="hd" data-cp="${i.id}" ${pinned?'data-pinned="1"':""}><div>${pinned?`<div class="mk" style="color:var(--route-2);margin-bottom:2px">Selected</div>`:""}<div class="nm">${esc(i.name)}</div>
      <div class="mk">${esc(i.game?.maker||i.maker)}${cpSize(i)?` · size ${esc(cpSize(i))}`:""}${cpGrade(i)?` · grade ${esc(cpGrade(i))}`:""}${kt?` · ${esc(kt)}`:""}</div>${cpFitsLine(i)}</div>
    <div class="pr">${b?money(b.price):`<span class="noshop">Not in shops</span>`}${i.buy.length>1?`<small>${i.buy.length} shops</small>`:""}</div>${b?cartBtn({name:i.name,kind:"component",uuid:i.uuid||null,uex_id:typeof i.id==="number"?i.id:null}):""}</div>
    ${pinned?`<div class="bd"><div class="row" style="gap:6px">${i.wiki?`<button class="btn small ghost" data-ext="${esc(i.wiki)}">Wiki</button>`:""}${i.store?`<button class="btn small ghost" data-ext="${esc(i.store)}">RSI page</button>`:""}<span class="spacer"></span><button class="btn small ghost" data-unpin="1">Close</button></div></div>`:""}</div>`; }
async function renderComponents(){
  if(!S.cpItems) return;
  if($("cp-ship").value&&(!S.cpFit||S.cpFit.cat!==S.cpCat.id)){ $("cp-out").innerHTML=`<div class="muted" style="margin-top:10px">Checking that ship's slots…</div>`; await cpFitData(); if(!S.cpItems) return; }
  const {L,fits,ship,shipQ}=cpFiltered(), any=["cp-search","cp-size","cp-grade","cp-maker","cp-avail","cp-ship","cp-wtype"].some(k=>$(k).value);
  const sel=S.cpItems.find(i=>String(i.id)===String(S.cpSel));
  $("cp-reset").hidden=!any;
  const q=$("cp-search").value.trim().toLowerCase(), elsewhere=q.length>=2?cpSearchAll(q).filter(i=>String(i.cat)!==String(S.cpCat.id)).length:0;
  if(q.length>=2&&!S.cpIndex) cpLoadIndex().then(ix=>{ if(ix&&S.cpItems&&$("cp-search").value.trim().toLowerCase()===q) renderComponents(); });
  $("cp-count").innerHTML=`${L.length} of ${S.cpItems.length} · click one for its page${elsewhere?` · <a data-cpall="1" style="cursor:pointer;text-decoration:underline">${elsewhere} more in other categories</a>`:""}`;
  const shipNote=shipQ?`<div class="note" style="margin:8px 0;font-size:12.5px">${!shipQ.slot?`Checking the ${esc(shipQ.sh.v.full)}'s slots…`
      :shipQ.slot.none?`The ${esc(shipQ.sh.v.full)} has no ${esc(S.cpCat.name.toLowerCase())} slots${shipQ.sh.fit?.ok?"":` (${esc(shipQ.sh.fit?.error||"")})`}.`
      :`Showing what fits the <b>${esc(shipQ.sh.v.full)}</b>: ${shipQ.slot.count} slot${shipQ.slot.count===1?"":"s"}${shipQ.slot.sizes.length?`, ${cpSizesTxt(shipQ.slot.sizes)}`:""}.`}</div>`:"";
  const why=ship&&fits&&!fits.size?`<div class="unknown" style="margin:8px 0">${esc(S.cpFit.ships.find(s=>s.uid===ship)?.error||`That ship has no ${S.cpFit.label?.toLowerCase()||""} slots.`)}</div>`:"";
  $("cp-out").innerHTML=(sel?cpCard(sel,true):"")+shipNote+why+(L.length?L.slice(0,200).map(i=>cpCard(i,false)).join(""):`<div class="empty">Nothing matches these filters.<br><br><button class="btn small" data-cpreset="1">Clear filters</button></div>`)+uexCredit(S.cpAt);
  const gk=JSON.stringify([S.cpCat.id,L.map(i=>i.id)]);
  if(S.cpDetail) renderComponentDetail(S.cpDetail);
  else if(gk!==S.cpGalKey){ S.cpGalKey=gk; renderComponentGrid(L); } else markComponentGrid(); }
function renderComponentGrid(L){ const c=S.cpCat;
  const wts=(S.cpTypes||[]).filter(([k])=>S.cpItems.some(i=>i.wtype===k)), wt=$("cp-wtype").value;
  $("cp-panel").innerHTML=`<div class="gh"><button class="btn small ghost" data-act="cphome">← All categories</button><b>${esc(wt?wtLabel(wt):c.name)}</b>${L.length} shown · click one for its page</div>
    ${c.slot==="WeaponGun"&&wts.length?`<div class="wt-bar"><button class="wt-chip ${!wt?"on":""}" data-wtchip="">${offIcon("weapons")}All guns</button>${wts.map(([k,lab])=>`<button class="wt-chip ${wt===k?"on":""}" data-wtchip="${k}" title="${esc(lab)}">${wtIcon(k)}${esc(lab)}</button>`).join("")}</div>`:""}
    ${L.length?`<div class="grid">${L.slice(0,200).map(i=>{ const kt=cpKeyText(i); return `<div class="vg" data-cpc="${i.id}">${i.buy[0]?cartBtn({name:i.name,kind:"component",uuid:i.uuid||null,uex_id:typeof i.id==="number"?i.id:null}):""}<div class="ph ph-g" data-pic="${esc(i.wiki||i.name)}">${phCard("component")}</div>
      <div class="tx"><b>${esc(i.name)}</b><span>${cpSize(i)?`S${esc(cpSize(i))} · `:""}${cpGrade(i)?`${esc(cpGrade(i))} · `:""}${esc(i.game?.maker||i.maker)}${i.buy[0]?` · ${money(i.buy[0].price)}`:" · not in shops"}</span>${kt||i.wtype?`<span class="kt">${i.wtype?`${wtIcon(i.wtype)} ${esc(wtLabel(i.wtype).replace(/s$/,""))}${kt?" · ":""}`:""}${esc(kt)}</span>`:""}${cpFitsLine(i)}</div></div>`; }).join("")}</div>`
      :`<div class="empty">Nothing matches these filters.<br><br><button class="btn small" data-cpreset="1">Clear filters</button></div>`}`;
  markComponentGrid(); fillPictures($("cp-panel"));
  if(S.cpBack){ if(S.cpBack.key===S.cpGalKey) $("cp-panel").scrollTop=S.cpBack.top; S.cpBack=null; } }
function markComponentGrid(){ for(const c of $("cp-panel").querySelectorAll("[data-cpc]")) c.classList.toggle("hl",c.dataset.cpc===String(S.cpSel)); }
function cpReset(){ for(const k of ["cp-search","cp-size","cp-grade","cp-maker","cp-avail","cp-ship","cp-wtype"]) $(k).value=""; S.cpDetail=null; renderComponents(); }
$("cp-panel").onclick=async e=>{ if(await tradeClick(e)) return;
  if(e.target.closest("[data-act=openfleet]")) return document.querySelector('.tab[data-tab="fleet"]').click();
  if(e.target.closest("[data-act=cphome]")) return renderCpHome();
  if(e.target.closest("[data-cpreset]")) return cpReset();
  const cat=e.target.closest("[data-cpcat]"); if(cat) return openCpCat(cat.dataset.cpcat,cat.dataset.wtype);
  const pt=e.target.closest("[data-cppart]"); if(pt) return openCpPart(pt.dataset.cppart);
  const wc=e.target.closest("[data-wtchip]"); if(wc){ $("cp-wtype").value=wc.dataset.wtchip; S.cpDetail=null; return renderComponents(); }
  const fit=e.target.closest("[data-cpfit]"); if(fit) return cpFitTo(fit);
  if(e.target.closest("[data-cpshop]")){ const i=S.cpItems?.find(x=>String(x.id)===String(S.cpDetail)); if(!i) return;
    const r=await api().shop_add([{name:i.name,kind:"component",uuid:i.uuid||null,uex_id:typeof i.id==="number"?i.id:null}]); toast(r.ok?`${i.name} added to your shopping list`:r.error); return; }
  if(e.target.closest("[data-act=cpback]")){ S.cpDetail=null; S.cpGalKey=null; return renderComponents(); }
  const c=e.target.closest("[data-cpc]"); if(!c) return; S.cpBack={key:S.cpGalKey,top:$("cp-panel").scrollTop};
  S.cpSel=c.dataset.cpc; S.cpDetail=c.dataset.cpc; renderComponents(); $("pane-components").scrollTop=0; };
// Numbers from the game files are floats, and subtracting two (a comparison's change) leaves tails like
// 0.40000000000000036: show at most two decimals, and none when they're zeros (12.4, 12.39, 7).
const nf=n=>typeof n==="number"&&isFinite(n)&&!Number.isInteger(n)?String(+n.toFixed(2)):n;
// A component's own page in place of the grid: picture, what it is, its numbers, where to buy it, and fitting.
const CP_STATS=[["dps","DPS",n=>Math.round(n).toLocaleString()],["alpha","Damage per shot",n=>Math.round(n*10)/10],["rpm","Fire rate",n=>`${Math.round(n)} rpm`],
  ["damage_type","Damage type",x=>x],["range","Range",n=>`${Math.round(n).toLocaleString()} m`],["speed","Projectile speed",n=>`${Math.round(n).toLocaleString()} m/s`],["ammo","Ammo",n=>nf(n)],
  ["missile","Missile damage",n=>Math.round(n).toLocaleString()],["missiles","Missiles held",n=>nf(n)],["aim_range","Aim assist range",n=>`${Math.round(n).toLocaleString()} m`],
  ["radar_ir","IR sensitivity",n=>nf(n)],["radar_em","EM sensitivity",n=>nf(n)],["radar_cs","Cross section sensitivity",n=>nf(n)],["missile_size","Missile size",n=>`S${n}`],["shield_hp","Shield HP",n=>Math.round(n).toLocaleString()],["shield_regen","Shield regen",n=>`${Math.round(n)}/s`],
  ["regen_delay","Regen delay after hit",n=>`${nf(n)} s`],["down_delay","Regen delay when down",n=>`${nf(n)} s`],["qt_speed","Quantum speed",n=>`${fmtBig(n)}/s`],
  ["qt_spool","Spool time",n=>`${nf(n)} s`],["qt_cooldown","Cooldown",n=>`${nf(n)} s`],["qt_fuel","Quantum fuel use",n=>nf(n)],["power","Power output",n=>`${nf(n)} pips`],
  ["coolant_make","Cooling",n=>`${nf(n)}/s`],["power_use","Power use",n=>`${nf(n)} pips`],["em","EM signature",n=>Math.round(n).toLocaleString()],["ir","IR signature",n=>Math.round(n).toLocaleString()],
  ["jump_align","Jump alignment rate",n=>nf(n)],["jump_tune","Jump tuning rate",n=>nf(n)],["jump_fuel","Jump fuel use",n=>`${nf(n)}×`],
  ["health","Health",n=>Math.round(n).toLocaleString()]];
const rows0=st=>CP_STATS.some(([k])=>st[k]!=null&&st[k]!==0&&st[k]!=="");
async function renderComponentDetail(id){
  const i=S.cpItems.find(x=>String(x.id)===String(id)), g=$("cp-panel"); if(!i) return;
  const gm=i.game||{}, st=gm.stats||{};
  const rows=CP_STATS.filter(([k])=>st[k]!=null&&st[k]!==0&&st[k]!=="").map(([k,lab,f])=>`<div class="vd-row"><span>${lab}</span><b>${esc(f(st[k]))}</b></div>`).join("")
    // parts only the Star Citizen Wiki has: its own numbers (mining power and range, flight speeds…)
    +(!rows0(st)&&i.extra?.length?i.extra.map(([lab,v])=>`<div class="vd-row"><span>${esc(lab)}</span><b>${esc(typeof v==="number"?(Math.abs(v)>=1000?Math.round(v).toLocaleString():String(v)):v)}</b></div>`).join(""):"");
  g.innerHTML=`<div class="row" style="gap:8px;margin-bottom:14px">${wlBackBtn("components")}<button class="btn" data-act="cpback">← All ${esc(S.cpCat?.name||"components")}</button></div>
    <div class="mkp-head"><div class="mkp-img" id="cpd-img">${qPic()}</div>
      <div class="hd-main"><div class="hd-title"><div><h2>${esc(i.name)}</h2><div class="sub">${esc(gm.maker||i.maker)}${i.vehicle?` · for ${esc(i.vehicle)}`:""}</div></div>${titleLogo(gm.maker||i.maker,false,true)}</div>
        <div class="cp-fits" id="cpd-fits">${cpFitsBadges(i)}</div>
        ${statBlock([{label:"Size",value:cpSize(i)?`S${cpSize(i)}`:"–"},{label:"Grade",value:cpGrade(i)||"–"},{label:"Class",value:gm.class||"–"},
            {label:"Price",value:i.buy[0]?money(i.buy[0].price):"Not in shops"}],
          [{label:"Sold at",value:i.buy.length?plural(i.buy.length,"shop"):null},...(()=>{ const k=(CP_KEY[S.cpCat?.slot]||[])[0], f=CP_STATS.find(x=>x[0]===k);
            return f&&st[k]!=null?[{label:f[1],value:f[2](st[k])}]:[]; })()])}
        <div class="row gr-acts" style="gap:8px;margin-top:12px">${i.buy.length?cartBtn({name:i.name,kind:"component",uuid:i.uuid||null,uex_id:typeof i.id==="number"?i.id:null},"Add to cart"):""}${wishBtn({kind:"component",name:i.name,uuid:i.uuid||null,uex_id:typeof i.id==="number"?i.id:null,maker:gm.maker||i.maker||null})}${i.wiki?`<button class="btn ghost" data-ext="${esc(i.wiki)}">Wiki</button>`:""}${i.store?`<button class="btn ghost" data-ext="${esc(i.store)}">RSI page</button>`:""}</div></div></div>
    ${typeof i.note==="string"&&i.note?`<div class="unknown" style="margin-bottom:12px">${esc(i.note)}</div>`:""}
    <div class="vd-grid vd-flat gr-fill">${rows?`<div class="vd-sec"><div class="mk-h">Stats</div>${rows}</div>`:`<div class="vd-sec"><div class="mk-h">Stats</div><div class="muted" style="font-size:13px;padding:6px 0">No game-file numbers for this one.</div></div>`}
      <div class="vd-sec"><div class="mk-h">${i.buy.length?"Where to buy":"How to get it"}</div>${i.buy.length?vehSpots(i.buy,"buy"):`<div id="cpd-get"><div class="muted" style="font-size:13px;padding:6px 0">Looking up how to get it…</div></div>`}</div></div>
    <div class="vd-flat"><div class="vd-sec cp-fit" id="cpd-fit"><div class="mk-h">Fit to a ship in My Fleet</div><div class="muted" style="font-size:13px">Checking your ships…</div></div></div>
    <div class="uex-credit">${i.game?"Numbers from the game files; ":""}prices from UEX; picture from the Star Citizen Wiki; ship slots from the Star Citizen Wiki.</div>`;
  g.scrollTop=0; renderCpFit(i); if(!i.buy.length) cpObtain(i,gm,id);
  const img=await api().wiki_image(i.wiki||i.name); if(String(S.cpDetail)!==String(id)) return;
  const box=$("cpd-img"); if(box) box.innerHTML=picShown(img||i.image||null,"component",i.wiki||i.name); }
// How to get a ship part no shop sells: the ships that come with it fitted (strip it from a wreck, a derelict or a
// ship you've disabled), the blueprint that makes it and the missions that unlock that, whether it can be loot,
// what the game files say it is, and any RSI store pack. Each ship opens its page in Vehicles.
async function cpObtain(i,gm,id){ let r; try{ r=await api().gear_obtain(i.uuid||null,i.name,gm.maker||i.maker||null,"component"); }catch(e){ r=null; }
  if(String(S.cpDetail)!==String(id)) return; const box=$("cpd-get"); if(!box) return;
  const out=[], top=()=>out.join("")?12:4, ships=r?.ships||[], bp=r?.blueprint, hints=(r?.hints||[]).filter(h=>h.kind!=="loot"), store=r?.store||[];
  if(ships.length){ const shown=ships.slice(0,8);
    out.push(`<div class="mk-h" style="margin-top:${top()}px">Comes fitted on<span class="mk-note">${plural(ships.length,"ship")}</span></div>
      <div class="muted" style="font-size:12px;line-height:1.5;padding:2px 0 6px">Take it off one of these: a wreck or derelict, a ship you've disabled in a bounty or a fight, or one of your own.</div>
      ${shown.map(s=>`<div class="mk-row"><div class="w">${s.id!=null?`<a data-cpveh="${s.id}" title="Open the ${esc(s.name)} in Vehicles">${esc(s.name)}</a>`:esc(s.name)}<div class="m">${s.buy?`Sold in game from ${money(s.buy.price)}`:s.rent?`Rent from ${money(s.rent.price)}/day`:"Not sold in game"}</div></div><div class="p"></div><span></span></div>`).join("")}
      ${ships.length>shown.length?`<div class="muted" style="font-size:12px;padding:4px 0">+${ships.length-shown.length} more ships</div>`:""}`); }
  if(bp) out.push(`<div class="mk-h" style="margin-top:${top()}px">Craft it</div>
      <div class="mk-row"><div class="w"><a data-cpbp="${esc(bp.uuid)}" title="Open the blueprint">${esc(bp.name)} blueprint</a><div class="m">${bp.default?"Every player knows it from the start":bp.unlocks?.length?`Unlocked by ${plural(bp.unlocks.length,"mission")}`:bp.missions?`${plural(bp.missions,"mission")} unlock it`:"How to unlock it isn't on the wiki yet"}${bp.time_label?` · ${esc(bp.time_label)} to craft`:""}</div></div><div class="p"></div><span></span></div>
      ${(bp.unlocks||[]).slice(0,6).map(m=>`<div class="mk-row"><div class="w">${esc(m.title)}<div class="m">${esc(m.scope||"Mission")}${(m.places||[]).length?` · ${esc(m.places.slice(0,3).map(p=>p.name).join(", "))}${m.places.length>3||m.places_more?"…":""}`:""}</div></div><div class="p">${m.chance!=null&&m.chance<1?`${Math.round(m.chance*100)}% chance`:""}</div><span></span></div>`).join("")}`);
  if(r?.lootable||(r?.loot||[]).length&&r?.lootable!==false&&!hints.some(h=>h.kind==="noloot")) out.push(`<div class="mk-h" style="margin-top:${top()}px">Loot</div>
      <div class="muted" style="font-size:13px;line-height:1.5;padding:4px 0">${r?.lootable?"The game files let it spawn as loot. ":""}Ship parts turn up in wrecks and derelicts${(r?.loot||[])[0]?.places?.length?`: the nearest are ${esc(r.loot[0].places.map(p=>p.name).join(", "))}`:""}.
      ${(r?.loot||[])[0]?`<button class="btn small ghost" data-mapsearch="${esc(r.loot[0].search)}" style="margin-left:4px">Map · ${r.loot[0].count}</button>`:""}</div>`);
  if(store.length) out.push(`<div class="mk-h" style="margin-top:${top()}px">RSI pledge store<span class="mk-note">real money, not aUEC</span></div>${store.map(grStoreRow).join("")}`);
  if(hints.length) out.push(`<div class="mk-h" style="margin-top:${top()}px">From the game files</div><div class="gr-hints">${hints.map(h=>`<div class="gr-hint k-${esc(h.kind)}"><b>${esc(h.label)}</b><span>${esc(h.text)}</span></div>`).join("")}</div>`);
  box.innerHTML=out.join("")||`<div class="muted" style="font-size:13px;padding:6px 0;line-height:1.5">No shop sells this as far as UEX knows, and the wiki doesn't list a ship that carries it, a blueprint or loot for it. It may be new this patch, or only given as a reward.</div>`; }
// A ship that carries the part: its page in Vehicles
document.addEventListener("click",e=>{ const v=e.target.closest("[data-cpveh]"); if(!v) return;
  S.vehDetail=String(v.dataset.cpveh); S.vehGalKey=null; document.querySelector('.tab[data-tab="vehicles"]')?.click(); });
// "Open the blueprint" from a part's page: the Blueprints tab, on that blueprint
document.addEventListener("click",async e=>{ const b=e.target.closest("[data-cpbp]"); if(!b) return; const id=b.dataset.cpbp;
  document.querySelector('.tab[data-tab="blueprints"]')?.click();
  for(let k=0;k<40&&!grState("blueprints").data?.items;k++) await new Promise(r=>setTimeout(r,250));
  const bs=grState("blueprints"); bs.mission=null; bs.sel=id; grRender("blueprints"); $("gr-panel").scrollTop=0; });
function cpFitsBadges(i){ const L=cpFitsShips(i), main=S.cpFit?.ships?.find(s=>s.main); if(!L||!main) return "";
  return L.some(s=>s.main)?`<span class="fit-yes">✓ Fits your ${esc(main.name)}</span>`:`<span class="fit-no">Doesn't fit your ${esc(main.name)}</span>`; }
// Each ship in the fleet with the slots this part fits (same kind, same size), what's in them now, and Fit here.
async function renderCpFit(i){ const c=S.cpCat, head=`<div class="mk-h">Fit to a ship in My Fleet</div>`, set=h=>{ const b=$("cpd-fit"); if(b&&String(S.cpDetail)===String(i.id)) b.innerHTML=head+h; };
  if(!c?.slot) return set(`<div class="muted" style="font-size:13px;line-height:1.5">My Fleet loadouts don't have ${esc(c?.name?.toLowerCase()||"these")} slots, so they can't be fitted there yet.</div>`);
  const f=await cpFitData(); if(String(S.cpDetail)!==String(i.id)) return;
  if($("cpd-fits")) $("cpd-fits").innerHTML=cpFitsBadges(i);
  if(!f?.ok) return set(`<div class="warnbox">${esc(f?.error||"Couldn't read your fleet's slots")}</div>`);
  if(!f.ships.length) return set(`<div class="muted" style="font-size:13px;line-height:1.5;margin-bottom:8px">No ships in My Fleet yet. Add the ships you own, then come back to fit this.</div><button class="btn small" data-act="openfleet">Open My Fleet</button>`);
  const sz=cpSize(i), nm=i.name.toLowerCase();
  set(f.ships.slice().sort((a,b)=>b.main-a.main).map(sh=>{ const ok=sh.slots.filter(s=>!sz||String(s.size)===sz), free=ok.filter(s=>(s.fitted||s.stock||"").toLowerCase()!==nm);
    const sizes=[...new Set(sh.slots.map(s=>`S${s.size}`))].join(", ");
    return `<div class="cp-fitship"><div class="hd">${sh.photo?`<img src="${esc(sh.photo)}" alt="" referrerpolicy="no-referrer">`:""}<b>${esc(sh.name)}</b>${sh.main?`<span class="chip">Primary</span>`:""}
        ${free.length>1?`<button class="btn small" data-cpfit="${esc(sh.uid)}" data-all="1">Fit all ${free.length}</button>`:""}</div>
      ${sh.error?`<div class="muted" style="font-size:12.5px">${esc(sh.error)}</div>`:ok.length?ok.map(s=>{ const cur=s.fitted||s.stock, here=(cur||"").toLowerCase()===nm;
        return `<div class="cp-slot"><span><b>${esc(s.label)} S${esc(s.size)}</b>${s.where?` <span class="muted">${esc(s.where)}</span>`:""}<small>${cur?`Now: ${esc(cur)}${s.fitted?" (your swap)":" (stock)"}`:"Empty"}</small></span>
          ${here?`<span class="cp-on">✓ Fitted</span>`:`<button class="btn small primary" data-cpfit="${esc(sh.uid)}" data-port="${esc(s.port)}">Fit here</button>`}</div>`; }).join("")
        :`<div class="muted" style="font-size:12.5px">${sh.slots.length?`No size ${esc(sz)} ${esc(f.label.toLowerCase())} slot. This ship's are ${esc(sizes)}.`:`No ${esc(f.label.toLowerCase())} slots.`}</div>`}</div>`; }).join("")); }
async function cpFitTo(btn){ const i=S.cpItems?.find(x=>String(x.id)===String(S.cpDetail)), f=S.cpFit; if(!i||!f) return;
  const sh=f.ships.find(s=>s.uid===btn.dataset.cpfit); if(!sh) return; const nm=i.name.toLowerCase(), sz=cpSize(i);
  const ports=btn.dataset.all?sh.slots.filter(s=>(!sz||String(s.size)===sz)&&(s.fitted||s.stock||"").toLowerCase()!==nm):sh.slots.filter(s=>s.port===btn.dataset.port);
  btn.disabled=true; btn.textContent="Fitting…";
  for(const s of ports){ const r=await api().fleet_set_slot(sh.uid,s.port,i.name,i.uuid||null,"primary"); if(!r.ok){ toast(r.error); break; } s.fitted=i.name; }
  toast(`${i.name} fitted to ${sh.name}'s primary loadout${ports.length>1?` (${ports.length} slots)`:""}. My Fleet shows the new numbers`); renderCpFit(i); }
$("cp-home").addEventListener("input",e=>{ if(e.target.id==="cp-home-q") renderCpHome(); });
$("cp-home").onclick=async e=>{ if(await tradeClick(e)) return; const sp=e.target.closest("[data-cpship]"); if(sp){ S.cpShipPick=sp.dataset.cpship; return renderCpHome(); } const pt=e.target.closest("[data-cppart]"); if(pt) return openCpPart(pt.dataset.cppart);
  const cat=e.target.closest("[data-cpcat]"); if(cat) openCpCat(cat.dataset.cpcat,cat.dataset.wtype); };
$("cp-count").onclick=e=>{ if(!e.target.closest("[data-cpall]")) return; const q=$("cp-search").value; renderCpHome(); $("cp-home-q").value=q; renderCpHome(); $("cp-home-q").focus(); };
$("cp-back").onclick=()=>renderCpHome();
$("cp-reset").onclick=cpReset;
for(const k of ["cp-size","cp-grade","cp-maker","cp-avail","cp-ship","cp-sort","cp-wtype"]) $(k).addEventListener("change",()=>{ S.cpDetail=null; renderComponents(); });
$("cp-search").addEventListener("input",()=>{ S.cpDetail=null; renderComponents(); });
$("cp-out").onclick=async e=>{ if(await tradeClick(e)) return;
  if(e.target.closest("[data-cpreset]")) return cpReset();
  if(e.target.closest("[data-unpin]")){ S.cpSel=null; S.cpDetail=null; S.cpGalKey=null; renderComponents(); return; }
  const h=e.target.closest("[data-cp]"); if(!h||h.dataset.pinned) return; S.cpSel=h.dataset.cp; S.cpDetail=h.dataset.cp; renderComponents(); $("pane-components").scrollTop=0; };

// ---- My Fleet: ships you own, your primary one, its loadouts, and what's fitted in each slot
const fmtBig=n=>n==null?"–":n>=1e9?`${(n/1e9).toFixed(1)} Gm`:n>=1e6?`${(n/1e6).toFixed(1)} Mm`:Math.round(n).toLocaleString();
async function openFleet(){
  if(!S.live?.log?.uex_token){ $("fl-out").innerHTML=needToken; $("fl-panel").innerHTML=""; return; }
  if(!S.veh){ const r=await api().uex_vehicles(); if(r.ok){ S.veh=r.vehicles; S.vehAt=r.at; S.vehOpen=S.vehOpen||{}; } }
  loadBrands(()=>{ if(S.tab==="fleet") renderFleet(); });               // manufacturer logos, shared with the Vehicles tab
  $("fl-dl").innerHTML=(S.veh||[]).map(v=>`<option value="${esc(v.full)}">${esc(v.maker)}${v.scu?` · ${v.scu} SCU`:""}</option>`).join("");
  await renderFleet(); }
// After a backup restore: drop what the open tabs cached and draw them again, so restored ships, loadouts and
// trade runs show straight away instead of after clicking to another tab and back.
async function afterRestore(){
  S.flLoad=null; S.flSlot=null; S.flOpts=null; S.flCmp=null; S.cpFit=null; S.flLiv={}; S.slData=null;
  try{ await loadStatic(); await poll(); }catch(e){}
  if(S.tab==="fleet") await renderFleet();
  else if(S.tab==="trade"&&S.trView==="mine") await renderRuns();
  else if(S.tab==="shopping") await renderShopping?.();
  else if(S.tab==="components"&&S.cpDetail) renderComponents(); }
async function renderFleet(){
  const fl=await api().fleet_list(); S.fleet=fl.ships;
  // your profile's fleet is the same list: a ship added, removed, moved or made primary shows there (and on the
  // profile others see, republished when it changed) straight away, not after a restart
  if(fl.ok!==false&&Array.isArray(fl.ships)){ S.pfFleet=fl.ships; if(typeof pfPublish==="function") pfPublish().catch?.(()=>{}); }
  if(!S.flSel||!fl.ships.some(x=>x.uid===S.flSel)) S.flSel=fl.main||fl.ships[0]?.uid||null;
  $("fl-out").innerHTML=fl.ships.length?`<div class="muted" style="font-size:12px;margin:10px 2px 8px">${fl.ships.length} ship${fl.ships.length===1?"":"s"} · ★ marks your primary ship (used for fitting components, determining trade routes, etc.)${fl.ships.length>1?" · Drag a ship to change the order":""}</div>`
    +fl.ships.map(x=>`<div class="vh ${x.uid===S.flSel?"hl":""}" ${fl.ships.length>1?`draggable="true" data-fldrag="${x.uid}" title="Drag to move ${esc(x.full)} in your fleet"`:""}><div class="hd" data-fl="${x.uid}">${brandTile(x.maker)}<div class="fl-name"><div class="nm">${x.main?"★ ":""}${esc(x.full)}</div>
      <div class="mk">${esc(x.maker)}${x.module?` · ${esc(x.module)} module`:""}${x.scu?` · ${x.scu} SCU`:""}${x.loadouts>1?` · ${x.loadouts} loadouts`:x.swaps?` · ${x.swaps} upgrade${x.swaps===1?"":"s"}`:" · stock"}</div></div>
      <div class="row" style="gap:4px">${x.main?"":`<button class="btn small ghost" data-flmain="${x.uid}" title="Make this your primary ship">★</button>`}<button class="btn small ghost" data-fldel="${x.uid}" title="Remove from your fleet">✕</button></div></div>
      ${S.flDel===x.uid?`<div class="fl-confirm"><div><b>Remove ${esc(x.full)} from your fleet?</b>
        <div>${x.total_swaps?`Its ${x.loadouts>1?`${x.loadouts} loadouts and `:""}${x.total_swaps} component swap${x.total_swaps===1?"":"s"} will be deleted too. `:"It has no component swaps saved. "}${x.main?"It's your primary ship, so trade runs and the Components tab will use another ship. ":""}This can't be undone.</div></div>
        <div class="row" style="gap:6px;justify-content:flex-end"><button class="btn small" data-fldelno="1">Cancel</button><button class="btn small danger" data-fldelyes="${x.uid}">Remove ship</button></div></div>`:""}</div>`).join("")
    :`<div class="empty"><strong>No ships yet</strong>Add the ships you own. Your primary ship fills in cargo space for trade runs, and each ship gets slots for its components.</div>`;
  if(S.flSel) renderShip(S.flSel); else $("fl-panel").innerHTML=`<div class="empty" style="margin-top:60px"><strong>My Fleet</strong>Add a ship on the left to see its components here.</div>`; }
// Stat labels: [key, label, format, lower-is-better]
const SHIP_STATS=[["dps","DPS (pilot)",n=>Math.round(n).toLocaleString()],["missile_dmg","Missile dmg",n=>Math.round(n).toLocaleString()],
  ["shield","Shield HP",n=>Math.round(n).toLocaleString()],["shield_regen","Shield regen",n=>`${Math.round(n).toLocaleString()}/s`],["hull","Hull HP",n=>Math.round(n).toLocaleString()],
  ["scm","SCM",n=>`${nf(n)} m/s`],["max","Max speed",n=>`${nf(n)} m/s`],["qt_speed","Quantum",n=>`${fmtBig(n)}/s`],["qt_range","QT range",n=>fmtBig(n)],
  ["em","EM",n=>fmtBig(n),true],["ir","IR",n=>fmtBig(n),true],
  ["medical_beds","Medical beds",n=>String(n)],["refinery","Refinery",n=>`${n} reactors`]];
const ITEM_STAT={dps:["DPS",n=>Math.round(n).toLocaleString()],missile:["Damage",n=>Math.round(n).toLocaleString()],shield_hp:["Shield HP",n=>Math.round(n).toLocaleString()],
  aim_range:["Aim assist",n=>`${Math.round(n).toLocaleString()} m`],
  missiles:["Missiles",(n,st)=>st?.missile_size?`${n} × S${st.missile_size}`:String(n)],
  qt_speed:["Speed",n=>`${fmtBig(n)}/s`],cooling:["Cooling",n=>`${nf(n)} seg`],power:["Power",n=>`${nf(n)} seg`],scm:["SCM speed",n=>`${Math.round(n)} m/s`]};
// A quantum drive's spool-up and cooldown times (from the game files), for its slot and its options
// A shield's regeneration rate, on its slot and in its options (shield HP is the slot's key number)
const shRegen=st=>st?.shield_regen!=null?` · regen ${Math.round(st.shield_regen).toLocaleString()}/s`:"";
const qdTimes=st=>(st?.qt_spool!=null?` · spool ${nf(st.qt_spool)} s`:"")+(st?.qt_cooldown!=null?` · cooldown ${nf(st.qt_cooldown)} s`:"");
const KEY_FOR={Radar:"aim_range",WeaponGun:"dps",Missile:"missile",MissileLauncher:"missiles",Shield:"shield_hp",QuantumDrive:"qt_speed",Cooler:"cooling",PowerPlant:"power",FlightController:"scm"};
const deltaTxt=(d,fmt,lowerBetter)=>{ if(!d) return ""; const good=lowerBetter?d<0:d>0; return `<em class="${good?"up":"down"}">${d>0?"+":"−"}${fmt(Math.abs(d))}</em>`; };
// Simple line symbols for each power system, in the spirit of the in-game power screen.
const PWR_ICONS={
  weapons:'<circle cx="12" cy="12" r="6"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/>',
  FlightController:'<path d="M8 3h8l-1 7H9z"/><path d="M9 10c0 4 3 7 3 11 0-4 3-7 3-11"/>',
  Shield:'<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
  Radar:'<circle cx="12" cy="13" r="1.5"/><path d="M8.5 9.5a5 5 0 0 0 0 7M15.5 9.5a5 5 0 0 1 0 7M5.5 6.5a9 9 0 0 0 0 13M18.5 6.5a9 9 0 0 1 0 13"/>',
  QuantumDrive:'<ellipse cx="12" cy="12" rx="9" ry="4"/><ellipse cx="12" cy="12" rx="9" ry="4" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="9" ry="4" transform="rotate(120 12 12)"/>',
  LifeSupportGenerator:'<path d="M12 21s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.5-7 10-7 10z"/><path d="M8 12h2l1-2 2 4 1-2h2"/>',
  Cooler:'<path d="M12 2v20M4 7l16 10M20 7L4 17"/><path d="M9.5 3.5L12 6l2.5-2.5M9.5 20.5L12 18l2.5 2.5"/>'};
// My Fleet's slot groups: the game's icon for each kind of part
const SLOT_OFF={MissileLauncher:"missiles",PowerPlant:"powerPlants",Cooler:"coolers",Shield:"shieldGenerator",QuantumDrive:"quantumDrives",JumpDrive:"jumpModules",Radar:"radar",WeaponGun:"weapons",Missile:"missiles",WeaponMining:"miningLasers"};
const slotIcon=t=>t==="FlightController"?`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 15c5-1 9-4 12-9l1.5 1.5C14 13 9 17 3 17z"/><path d="M13 18l8-2M16 9l5 1"/></svg>`:SLOT_OFF[t]?offIcon(SLOT_OFF[t]):t==="WeaponMining"?`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 21l7-7"/><path d="M10 14l4-10 6 6-10 4z"/></svg>`:"";
const PWR_OFF={weapons:"weapons",Shield:"shieldGenerator",Radar:"radar",QuantumDrive:"quantumDrives",Cooler:"coolers"};
const pwrIcon=t=>PWR_OFF[t]?`<svg class="pwr-ic ofc" viewBox="0 0 16 16" aria-hidden="true">${OFF_ICONS[PWR_OFF[t]]}</svg>`
  :`<svg class="pwr-ic" viewBox="0 0 24 24" aria-hidden="true">${PWR_ICONS[t]||'<circle cx="12" cy="12" r="7"/>'}</svg>`;
// One compact power panel (collapsed by default): a bar per system, cooling, reset.
function powerPanel(r){
  const P=r.power, users=[...(r.fixed||[]).map(x=>({...x,name:x.label})),
    ...r.slots.filter(x=>x.power&&x.type!=="WeaponGun").map(x=>({...x,name:{Cooler:"Cooler",Shield:"Shield",Radar:"Radar",QuantumDrive:"Quantum"}[x.type]||x.label}))];
  const order={weapons:0,FlightController:1,Shield:2,Radar:3,QuantumDrive:4,LifeSupportGenerator:5,Cooler:6};
  users.sort((a,b)=>(order[a.type]??9)-(order[b.type]??9));
  const label=u=>({weapons:"Weapons",FlightController:"Thrusters",LifeSupportGenerator:"Life support"}[u.type]||u.name);
  const nav=r.power.mode==="nav", off=u=>nav?(u.type==="weapons"||u.type==="Shield"):u.type==="QuantumDrive";
  return `<div class="pwr-panel">
    <div class="pwr-head"><b>Power</b><span class="muted">${P.pips_used} of ${P.pips_gen} pips in use · cooling ${P.cooling}%${P.cooling_auto?"":" (set by you)"}</span><span class="spacer"></span>
      <button class="btn small ghost" data-pauto="1">Reset to auto</button></div>
    <div class="pwr-cols">${users.map(u=>`<div class="pc ${off(u)?"off":""}" title="${esc(off(u)?(u.type==="QuantumDrive"?"The quantum drive only takes power in Travel · NAV mode":"Weapons and shields take no power in Travel · NAV mode"):u.stock?.name||"")}">
      <div class="bars">${Array.from({length:u.power.max},(_,i)=>`<i data-ppip="${esc(u.port)}" data-n="${u.power.max-i}" ${off(u)?`data-poff="${u.type==="QuantumDrive"?"q":"w"}"`:""} class="${u.power.max-i<=u.power.pips?"on":""}"></i>`).join("")}</div>
      ${pwrIcon(u.type)}<b>${u.power.pips}</b><span>${esc(label(u))}</span></div>`).join("")}</div>
    <div class="pwr-foot muted">Click a bar to change a system's power; click its top lit block to lower it. Cooling
      <input class="field" id="fl-cool" type="number" min="0" max="100" value="${P.cooling}" style="width:58px;padding:2px 6px;margin:0 4px">%
      ${P.cooling_auto?"(worked out)":`<a data-coolauto="1" style="cursor:pointer;text-decoration:underline">work it out</a>`}</div></div>`; }
// The ship's parts by category (power plants, coolers, shields, quantum drive, ...), each in its own semi-transparent
// box with cut corners like the Launcher button: up to 3 columns of boxes about 440-650 px wide, 16 px apart. Identical
// parts (same part, size and grade, e.g. 16 Arrester IIIs) share one row with a count: Change on it swaps them all
// at once, and the count opens them one by one.
function slotGroupsHtml(r,groups,card){ S.flExp=S.flExp||{};
  // a fixed reading order, so like parts sit together whatever the number of columns
  const ORD=["PowerPlant","Cooler","Shield","QuantumDrive","JumpDrive","Radar","FlightController","WeaponGun","WeaponMining","Missile"], ix=t=>{ const i=ORD.indexOf(t); return i<0?ORD.length:i; };
  const ents=Object.entries(groups).map((e,i)=>[e,i]).sort((a,b)=>ix(a[0][1][0].type)-ix(b[0][1][0].type)||a[1]-b[1]).map(x=>x[0]);
  return `<div class="slot-groups">${ents.map(([label,list])=>{ const t=list[0].type;
    const open=list.some(sl=>sl.port===S.flSlot);
    const ms=t==="Missile"&&r.missiles, msTxt=ms?` · ${Object.entries(ms.by_size).sort((a,b)=>b[0]-a[0]).map(([z,n])=>`${n} × S${z}`).join(", ")}${ms.loaded<ms.slots?` · ${ms.slots-ms.loaded} empty`:""}`:"";
    // identical parts share a row (unless opened one by one, or one of them is being changed on its own)
    const runs=[]; for(const sl of list){ const key=[label,sl.size,sl.fitted?sl.fitted_grade:sl.stock?.grade,sl.fitted||sl.stock?.name||"",!!sl.fitted].join("|");
      const run=runs.find(x=>x.key===key); if(run) run.push(sl); else { const n=[sl]; n.key=key; runs.push(n); } }
    const rows=runs.map(run=>{ const solo=S.flSlot&&run.some(sl=>sl.port===S.flSlot)&&!(S.flGroup&&S.flGroup[0]===run[0].port);
      if(run.length>1&&!S.flExp[run.key]&&!solo) return card(run[0],run);
      return run.map((sl,i)=>card(sl,run.length>1&&i===0?{key:run.key,split:true}:null)).join(""); }).join("");
    return `<div class="sg ${open?"open":""}"><div class="sg-in"><div class="mk-h sg-h">${slotIcon(t)}${esc(label)}s <span class="sg-n">${list.length}${esc(msTxt)}</span></div><div class="slot-grid">${rows}</div></div></div>`; }).join("")}</div>`; }
async function renderShip(uid){
  if(!S.flLoad||S.flLoad.uid!==uid) $("fl-panel").innerHTML=qLoader("Loading the ship's components…");
  const r=await api().fleet_loadout(uid); if(S.flSel!==uid) return;
  const ship=(S.fleet||[]).find(x=>x.uid===uid);
  if(!r.ok){ $("fl-panel").innerHTML=`<div class="mkp-head"><div class="mkp-img">${ship?.photo?`<img src="${esc(ship.photo)}" alt="" referrerpolicy="no-referrer">`:picMissing("vehicle",ship?.full||"")}</div><div><h2>${esc(ship?.full||"")}</h2><div class="unknown" style="margin-top:10px">${esc(r.error)}</div></div></div>`; return; }
  S.flLoad=r; const st=r.stats, dl=r.delta||{};
  if(S.flLiv?.[uid]?.ok){ const al=r.loadouts?.loadouts?.find(x=>x.id===r.loadouts.active); S.flLiv[uid].current=al?.livery?{...(S.flLiv[uid].items.find(x=>x.name===al.livery)||{name:al.livery})}:null; }
  const statOf=([k,lab,fmt,lb])=>({label:lab,value:st[k]!=null&&st[k]!==""?fmt(st[k]):null,changed:!!dl[k],
      delta:dl[k]?deltaTxt(dl[k],fmt,lb):""});
  const HERO=["dps","shield","qt_speed"], heroKeys=HERO.filter(k=>st[k]!=null&&st[k]!=="");
  for(const k of ["hull","scm","max"]) if(heroKeys.length<3&&!heroKeys.includes(k)&&st[k]!=null) heroKeys.push(k);   // ground vehicles, unarmed ships
  // Cargo sits in the top row with DPS, shield and quantum, when the ship carries any
  const cargo={label:"Cargo",value:r.ship.scu?`${Number(r.ship.scu).toLocaleString()} SCU`:null};
  const stats=statBlock([...heroKeys.map(k=>statOf(SHIP_STATS.find(x=>x[0]===k))),cargo],
    SHIP_STATS.filter(([k])=>!heroKeys.includes(k)).map(statOf));
  const changed=r.slots.filter(sl=>sl.fitted).length;
  // Nothing to change out (the ATLS, rovers and other ground vehicles): the page shows the vehicle's own
  // specs instead, as its page in Vehicles has them (without the buy and rent prices)
  const bare=!r.slots.length; let vv=null, vd=null;
  if(bare){ vv=(S.veh||[]).find(x=>String(x.id)===String(ship?.vehicle_id))||(S.veh||[]).find(x=>x.full===r.ship.full);
    if(vv){ S.vdCache=S.vdCache||{}; try{ vd=S.vdCache[vv.id]||(S.vdCache[vv.id]=await api().vehicle_detail(vv.id)); }catch(_){ vd=null; }
      if(S.flSel!==uid) return; if(vd?.ok===false) vd=null; } }
  const bareStats=vd?statBlock([{label:"Crew size",value:vehCrew(vd)||null},{label:"SCU capacity",value:r.ship.scu||vd.scu?`${Number(r.ship.scu||vd.scu).toLocaleString()} SCU`:"None"},
      {label:"Landing pad",value:vd.pad||vv.pad||null},{label:"Size class",value:vd.size_class||null}],
    [{label:"Beds",value:vd.beds||null},{label:"Medical beds",value:vd.medical_beds||null},
     ...SHIP_STATS.filter(([k])=>st[k]!=null&&st[k]!==""&&st[k]!==0).map(statOf)]):"";
  const groups={}; for(const sl of r.slots) (groups[sl.label]=groups[sl.label]||[]).push(sl);
  const card=(sl,grp)=>{ const k=KEY_FOR[sl.type], stats=sl.fitted?(sl.fitted_stats||{}):(sl.stock?.stats||{}), grade=sl.fitted?sl.fitted_grade:sl.stock?.grade,
      maker=sl.fitted?sl.fitted_maker:sl.stock?.maker, val=k&&stats[k], stockVal=k&&sl.stock?.stats?.[k], open=S.flSlot===sl.port;
    // One row per slot: size and grade, the part and its maker, its key number, and Change
    const many=grp&&grp.length>1, ports=many?esc(JSON.stringify(grp.map(x=>x.port))):"";
    return `<div class="slot ${sl.fitted?"fit":""} ${open?"open":""}">
      <div class="top"><span class="sz" title="Size ${esc(sl.size??"?")}">S${esc(sl.size??"?")}</span><span class="gr" title="${grade?`Grade ${esc(grade)}`:"No grade"}">${esc(grade||"–")}</span>
        <div class="nm"><b title="${esc(sl.fitted||sl.stock?.name||"")}">${esc(sl.fitted||sl.stock?.name||"Empty")}</b><span>${esc(maker||"")}${many?"":sl.rack_name?` · on ${esc(sl.rack_name)}`:sl.where?` · ${esc(sl.where)}`:""}${stats.em!=null?` · EM ${fmtBig(stats.em)}`:""}${qdTimes(stats)}${sl.type==="Shield"?shRegen(stats):""}${sl.fitted?` · <em class="swap">swapped from ${esc(sl.stock?.name||"none")}</em>`:""}</span></div>
        ${val?`<div class="val"><b>${ITEM_STAT[k][1](val,stats)}${sl.fitted&&stockVal&&k!=="missiles"?deltaTxt(val-stockVal,ITEM_STAT[k][1]):""}</b><span>${ITEM_STAT[k][0]}</span></div>`:`<div class="val"></div>`}
        ${many?`<button class="sg-qty" data-flexp="${esc(grp.key)}" title="${grp.length} identical ${esc(sl.label||"part")}s: show them one by one">×${grp.length}</button>`:grp?.split?`<button class="sg-qty less" data-flexp="${esc(grp.key)}" title="Show these as one row again">▴</button>`:`<span></span>`}
        <div class="acts">${sl.fitted&&!String(sl.fitted).endsWith(" (stock)")?cartBtn({name:sl.fitted,kind:"component",source:r.ship.full}):""}${sl.fitted?`<button class="btn small ghost" data-flreset="${esc(sl.port)}"${many?` data-flports="${ports}"`:""} title="Put the stock part back${many?` in all ${grp.length}`:""}">Stock</button>`:""}<button class="btn small ${open?"primary":"ghost"}" data-flswap="${esc(sl.port)}"${many?` data-flports="${ports}"`:""} data-type="${esc(sl.type)}" data-size="${esc(sl.size??"")}" title="${many?`Change all ${grp.length} at once (or press ×${grp.length} to change them one by one)`:""}">${open?"Close":"Change"}</button></div></div>
      ${open?`<div class="opts" id="fl-opts">Loading components…</div>`:""}</div>`; };
  // The loadout picker, paint and module sit under the picture (they change what it shows); the ship's
  // name, numbers and power stay on the right
  $("fl-panel").innerHTML=`<div class="mkp-head fl-head"><div class="fl-side"><div class="mkp-img">${r.ship.photo?`<img src="${esc(r.ship.photo)}" alt="" referrerpolicy="no-referrer">`:picMissing("vehicle",r.ship.full||"")}</div>
        ${loadoutBar(r.loadouts)}
        <div id="fl-livery" class="lv-row">${liveryHtml(uid)}</div>
        ${r.modules?(()=>{ const m=r.modules.modules.find(x=>x.id===r.modules.current)||{};
          return `<div class="lv-row">${modPicker(r.modules,r.modules.current,"data-flmod")}<span class="muted" style="font-size:12px">${m.concept?`<span style="color:#f2c14e">Concept · not in game yet.</span> `:""}${esc(m.notes||"")}</span></div>`; })():""}
        ${changed?`<div class="row" style="gap:8px;margin:2px 0 8px"><button class="btn small ghost cart-all" data-flshop="1" title="Put every part you've swapped into this loadout in your cart">${CART_SVG}Add this loadout's ${plural(changed,"swapped part")} to cart</button></div>`:""}</div>
      <div class="hd-main"><div class="hd-title"><div><h2>${r.ship.main?"★ ":""}${flVeh(uid,r)?`<a class="fl-vlink" data-flveh="${esc(String(flVeh(uid,r).id))}" title="Open the ${esc(r.ship.full)} in Vehicles: prices, where to buy or rent it, specs">${esc(r.ship.full)}</a>`:esc(r.ship.full)}</h2><div class="sub">${bare&&vv?esc([vv.maker,vd?.career].filter(Boolean).join(" · ")):changed?`${changed} component${changed===1?"":"s"} changed from stock in this loadout · stats include your changes`:"Stock parts in this loadout"}</div></div>${flMakerLogo(r.ship.maker||ship?.maker)}</div>
        ${bare&&vv?.roles?.length?`<div class="tags vd-tags">${vv.roles.map(x=>`<span>${esc(x)}</span>`).join("")}</div>`:""}
        ${bare&&vd?bareStats:stats}
        ${bare&&vv?`<div class="row" style="gap:8px;margin-top:12px"><button class="btn ghost" data-vhopen="${esc(String(vv.id))}" title="Open the ${esc(vv.full)} in Vehicles: prices and where to buy or rent it">Vehicle page</button>${vv.store?`<button class="btn ghost" data-ext="${esc(vv.store)}">RSI page</button>`:""}</div>`:""}
        ${r.power?.pips_gen?`<div class="pwr-row">
          <div class="seg-mini" title="What's powered: Combat = weapons and shields on, quantum drive off. Travel = quantum drive on, weapons and shields off."><button data-pmode="scm" class="${r.power.mode!=="nav"?"on":""}">Combat · SCM</button><button data-pmode="nav" class="${r.power.mode==="nav"?"on":""}">Travel · NAV</button></div>
          <button class="btn small ghost" data-ptoggle="1">${S.flPowerOpen?"Hide power ▴":"Power ▾"}</button>
          ${r.power.custom?`<span class="muted" style="font-size:12px">custom power</span>`:""}<span class="spacer"></span>
          <button class="btn small ${S.flRec?.uid===uid?"primary":"ghost"}" data-flrec="${S.flRec?.uid===uid?"close":"open"}" title="The best parts for a role (Combat, Stealth, Long range, Balanced), shown before you change anything">✦ Recommended</button></div>`:""}</div></div>
    ${r.power?.pips_gen&&S.flPowerOpen?powerPanel(r):""}
    ${S.flRec?.uid===uid?recPanel(r):""}
    ${slotGroupsHtml(r,groups,card)}
    ${bare&&vd?`<div class="fl-spec">${vehSpecHtml(vd,null)}</div><div class="muted" style="font-size:12px;margin:4px 2px 10px">This vehicle has no components to change out.</div>`:""}
    <div class="uex-credit">${bare&&vd?`${vd.wiki?"Specs from the Star Citizen Wiki (api.star-citizen.wiki)":"The Star Citizen Wiki has no record for this vehicle"}; roles from UEX.`:`EM and IR are Quantum's estimates from each part's signature and how much power it gets. Data: game files${r.game_data?` (${esc(String(r.game_data).slice(0,10))})`:""}, Star Citizen Wiki, UEX.`}</div>`;
  if(S.flSlot){ const b=$("fl-panel").querySelector(`[data-flswap="${CSS.escape(S.flSlot)}"]`); if(b) loadSlotOptions(b.dataset.type,b.dataset.size);
    // Just opened with Change: bring the slot and its options/comparison into view instead of leaving them below the fold
    if(S.flScroll&&b){ S.flScroll=false; S.flScrollUntil=Date.now()+4000; flScrollToSlot(); } }
  watchPic($("fl-panel").querySelector(".mkp-img"));
  loadLiveries(uid); }
// ---- Recommended loadout (api fleet_recommend): pick a role, see the part it'd put in each slot and what that
// does to the ship's numbers, then save it as a new loadout. Nothing changes until you save.
const REC_ROLES=[["balanced","Balanced","Best grade in every slot"],["combat","Combat","Shields, power and cooling first; military parts"],["stealth","Stealth","Lowest EM and IR without giving up much"],["travel","Long range","Fastest, most frugal quantum drive"]];
function recPanel(r){ const R=S.flRec, d=R.data;
  const pills=`<div class="seg-mini rec-roles">${REC_ROLES.map(([k,t,sub])=>`<button data-flrecrole="${k}" class="${R.role===k?"on":""}" title="${esc(sub)}">${t}</button>`).join("")}</div>`;
  if(!d) return `<div class="rec-card">${pills}${qLoader("Working out the best parts…")}</div>`;
  if(!d.ok) return `<div class="rec-card">${pills}<div class="unknown">${esc(d.error||"Couldn't work it out")}</div></div>`;
  const KEYS=[["shield","Shield HP"],["shield_regen","Shield regen"],["qt_speed","Quantum"],["em","EM",true],["ir","IR",true]];
  const fmt=(k,n)=>{ const f=SHIP_STATS.find(x=>x[0]===k); return f?f[2](n):String(Math.round(n)); };
  const chg=KEYS.filter(([k])=>d.stats?.[k]!=null).map(([k,lab,low])=>{ const dv=d.delta?.[k]||0, good=low?dv<0:dv>0;
    return `<div class="rec-st ${dv?(good?"up":"down"):""}"><span>${lab}</span><b>${fmt(k,d.stats[k])}</b>${dv?`<em>${dv>0?"+":"−"}${fmt(k,Math.abs(dv))}</em>`:""}</div>`; }).join("");
  const swaps=d.picks.filter(p=>!p.keep);
  return `<div class="rec-card"><div class="rec-h"><b>Recommended: ${esc(REC_ROLES.find(x=>x[0]===R.role)?.[1]||"")}</b>${pills}</div>
    <div class="rec-stats">${chg}${d.power?.cooling!=null?`<div class="rec-st"><span>Cooling</span><b>${d.power.cooling}%</b></div>`:""}</div>
    <div class="rec-list">${d.picks.map(p=>`<div class="rec-r ${p.keep?"keep":""}"><span class="sz">S${esc(p.size)}</span><span class="t">${esc(p.label)}</span>
      <span class="was">${esc(p.current||p.stock||"Empty")}</span><span class="ar" aria-hidden="true">${p.keep?"✓":"→"}</span>
      <b>${esc(p.pick)}</b><span class="muted">${esc([p.grade&&`Grade ${p.grade}`,p.class,p.maker].filter(Boolean).join(" · "))}</span></div>`).join("")}</div>
    <div class="row" style="gap:8px;margin-top:10px"><span class="muted" style="font-size:12px">${swaps.length?`${plural(swaps.length,"part")} would change. Weapons and missiles stay as they are.`:"The stock parts are already the best for this."}</span><span class="spacer"></span>
      ${swaps.length?`<button class="btn small primary" data-flrecapply="1">Save as new loadout</button>`:""}</div></div>`; }
async function recLoad(uid,role){ S.flRec={uid,role,data:null}; renderShip(uid);
  let d; try{ d=await api().fleet_recommend(uid,role,false); }catch(e){ d={ok:false,error:String(e)}; }
  if(S.flRec?.uid===uid&&S.flRec.role===role){ S.flRec.data=d; renderShip(uid); } }
// ---- Livery: any paint there is for the ship, per loadout ("Stock paint" when none is picked).
S.flLiv=S.flLiv||{};
function liveryHtml(uid){ const L=S.flLiv[uid];
  if(!L) return `<span class="lo-lab">Livery</span><span class="muted" style="font-size:12px">Looking up paints…</span>`;
  if(!L.ok) return `<span class="lo-lab">Livery</span><span class="muted" style="font-size:12px">${esc(L.error||"Couldn't look up paints")}</span>`;
  const cur=L.current?.name||"", it=L.items.find(x=>x.name===cur), buy=it?.buy?.[0];
  return `<span class="lo-lab">Livery</span>
    <select class="field lv-sel" id="fl-liv">${[`<option value="">Stock paint</option>`,
      ...L.items.map(x=>`<option value="${esc(x.name)}" ${x.name===cur?"selected":""}>${esc(x.name)}${x.buy?.length?` · ${money(x.buy[0].price)}`:""}</option>`),
      ...(cur&&!it?[`<option value="${esc(cur)}" selected>${esc(cur)}</option>`]:[])].join("")}</select>
    ${cur?`<span class="muted" style="font-size:12px">${buy?`From ${money(buy.price)} at ${esc(buy.where)}`:it?.source==="wiki"?"Not sold in shops as far as UEX knows (pledge, event or reward paint)":""}${S.flLoad?.ship&&!S.flLoad.ship.livery_photo?`${buy||it?.source==="wiki"?" · ":""}No photo of selected livery. Displaying stock image.`:""}</span>`
      :`<span class="muted" style="font-size:12px">${L.items.length?`${L.items.length} paint${L.items.length===1?"":"s"} for this ship`:esc(L.note||"No paints listed for this ship yet")}</span>`}`; }
async function loadLiveries(uid){ if(!S.flLiv[uid]){ try{ S.flLiv[uid]=await api().fleet_liveries(uid); }catch(e){ S.flLiv[uid]={ok:false}; } }
  const box=$("fl-livery"); if(box&&S.flSel===uid) box.innerHTML=liveryHtml(uid); }
document.addEventListener("change",async e=>{ if(e.target.id!=="fl-liv") return; const uid=S.flSel, L=S.flLiv[uid]; if(!L) return;
  const it=L.items.find(x=>x.name===e.target.value)||(e.target.value?{name:e.target.value}:null);
  const box=document.querySelector("#fl-panel .mkp-img"), img=box?.querySelector("img"); picLoading(box,"Loading livery…");
  const r=await api().fleet_set_livery(uid,it); if(!r.ok){ picLoaded(box); return toast(r.error); }
  L.current=r.current;
  if(img&&r.photo&&img.src!==r.photo){ img.addEventListener("load",()=>picLoaded(box),{once:true}); img.addEventListener("error",()=>picLoaded(box),{once:true}); img.src=r.photo; }
  else picLoaded(box);
  const fs=(S.fleet||[]).find(x=>x.uid===uid); if(fs&&r.photo&&fs.primary_name&&S.flLoad?.loadouts?.active===S.flLoad?.loadouts?.primary) fs.photo=r.photo;   // the fleet card shows the primary loadout's paint
  toast(it?(r.photo&&r.photo!==r.stock_photo?`${it.name} on this loadout`:`${it.name} on this loadout · No photo of selected livery. Displaying stock image.`):"Back to the stock paint");
  S.flLoad=null; renderShip(uid); });
// If the call fails or takes over a minute, say so with a Try again button instead of loading forever
async function loadSlotOptions(type,size){
  const box=$("fl-opts"); if(!box) return; box.innerHTML=`<div class="muted" style="font-size:12px">Loading components…</div>`;
  const slot=S.flSlot; let r;
  try{ r=await Promise.race([api().fleet_options(type,size?+size:0,S.flSel),
         new Promise(res=>setTimeout(()=>res({ok:false,error:"This is taking too long (UEX or the Star Citizen Wiki may be slow)."}),60000))]); }
  catch(e){ r={ok:false,error:`Couldn't load the components: ${e?.message||e||"unknown error"}`}; }
  if(!$("fl-opts")||S.flSlot!==slot) return;
  if(!r?.ok){ $("fl-opts").innerHTML=`<div class="unknown">${esc(r?.error||"Couldn't load the components")}
      <button class="btn small ghost" data-flretry data-type="${esc(type)}" data-size="${esc(size||"")}" style="margin-left:8px">Try again</button></div>`; return; }
  S.flOpts=r;
  try{ renderSlotOptions(); }
  catch(e){ console.error(e); $("fl-opts").innerHTML=`<div class="unknown">Couldn't show the components: ${esc(e?.message||String(e))}</div>`; return; }
  flScrollToSlot(); }
// Just opened with Change: bring the slot and its table of options into view. The page keeps moving under it
// for a moment after the click (the ship picture loads and pushes everything down, the options table fills
// in), so it's placed again each time, for a few seconds, rather than once straight away.
function flScrollToSlot(){ if(!S.flSlot||Date.now()>(S.flScrollUntil||0)) return;
  const go=()=>{ const panel=$("fl-panel"), b=panel?.querySelector(`[data-flswap="${CSS.escape(S.flSlot||"")}"]`), slot=b?.closest(".slot"); if(!slot) return;
    const top=slot.getBoundingClientRect().top-panel.getBoundingClientRect().top+panel.scrollTop-12;
    // Already showing the slot with as much of its table as fits: leave it (the user may be scrolling)
    const r=slot.getBoundingClientRect(), pr=panel.getBoundingClientRect();
    if(r.top>=pr.top&&(r.bottom<=pr.bottom||r.top<=pr.top+pr.height*0.25)) return;
    panel.scrollTo({top:Math.max(0,top)}); };
  requestAnimationFrame(go); for(const ms of [350,900,1800]) setTimeout(()=>{ if(Date.now()<=(S.flScrollUntil||0)) go(); },ms);
  const img=$("fl-panel")?.querySelector(".mkp-img img"); if(img&&!img.complete) img.addEventListener("load",()=>requestAnimationFrame(go),{once:true}); }
// Scrolling yourself stops the slot from being pulled back into view
$("fl-panel").addEventListener("wheel",()=>{ S.flScrollUntil=0; },{passive:true});
// ---- Loadouts: up to 5 named sets of parts per ship. The one shown is edited; the primary one (★) is the one
// the rest of Quantum uses for this ship, like the Components tab's "Fit to a ship".
function loadoutBar(L){ if(!L?.ok) return ""; const act=L.loadouts.find(x=>x.id===L.active), mode=S.flLoMode;
  if(S.flRename&&!L.loadouts.some(x=>x.id===S.flRename)) S.flRename=null;
  const chip=x=>x.id===S.flRename?`<input class="lo-chip lo-rn" id="lo-rn" data-rnid="${esc(x.id)}" maxlength="40" value="${esc(x.name)}" aria-label="New name for ${esc(x.name)}" autocomplete="off">`
    :`<button class="lo-chip ${x.id===L.active?"on":""}" data-flload="${esc(x.id)}" title="${x.id===L.primary?"Primary loadout: used across Quantum for this ship":"Show this loadout"} · double-click to rename, right-click for more${x.module?` · Module: ${esc(x.module)}`:""}${x.livery?` · Livery: ${esc(x.livery)}`:""}">${x.id===L.primary?`<span class="lo-star" aria-label="Primary">★</span>`:""}${esc(x.name)}${x.swaps?`<small>${x.swaps}</small>`:""}</button>`;
  let form="";
  if(mode==="new") form=`<div class="lo-form"><input class="field" id="lo-name" maxlength="40" placeholder="Name it, like “PvP” or “Stealth”" autocomplete="off">
      <select class="field" id="lo-from" style="width:auto"><option value="copy">Copy of ${esc(act?.name||"this one")}</option><option value="stock">Stock parts</option></select>
      <button class="btn small primary" data-lo="create">Create</button><button class="btn small ghost" data-lo="cancel">Cancel</button></div>`;
  else if(mode==="rename") form=`<div class="lo-form"><input class="field" id="lo-name" maxlength="40" value="${esc(act?.name||"")}" autocomplete="off">
      <button class="btn small primary" data-lo="rename-save">Rename</button><button class="btn small ghost" data-lo="cancel">Cancel</button></div>`;
  else if(mode==="delete") form=`<div class="lo-form warn"><span>Delete the <b>${esc(act?.name||"")}</b> loadout${act?.swaps?` and its ${act.swaps} swap${act.swaps===1?"":"s"}`:""}? This can't be undone.</span>
      <button class="btn small danger" data-lo="delete-yes">Delete loadout</button><button class="btn small ghost" data-lo="cancel">Cancel</button></div>`;
  return `<div class="lo-bar"><span class="lo-lab">Loadout</span>${L.loadouts.map(chip).join("")}
      ${L.loadouts.length<L.max?`<button class="lo-chip add" data-lo="new" title="Add a loadout (up to ${L.max})">+ New</button>`:""}
      ${act&&act.id!==L.primary?`<span class="lo-acts"><button class="btn small ghost" data-lo="primary" title="Use this loadout across Quantum for this ship">★ Make primary</button></span>`:""}</div>${form}`; }
// Loadout chips: double-click one to rename it in place (Enter or clicking away saves, Esc cancels); right-click
// for Rename, Make primary and Delete
async function flRenameSave(inp,keep){ const id=inp.dataset.rnid, uid=S.flSel, v=inp.value.trim(), old=S.flLoad?.loadouts?.loadouts?.find(x=>x.id===id);
  S.flRename=null; if(!keep||!v||v===old?.name) return renderShip(uid);
  const r=await api().fleet_loadout_rename(uid,id,v); if(!r.ok){ toast(r.error); return renderShip(uid); }
  toast("Loadout renamed"); return renderFleet(); }
function flRenameStart(id){ S.flRename=id; renderShip(S.flSel).then(()=>{ const i=$("lo-rn"); if(i){ i.focus(); i.select(); } }); }
document.addEventListener("dblclick",e=>{ const c=e.target.closest("#fl-panel [data-flload]"); if(!c) return; e.preventDefault(); flRenameStart(c.dataset.flload); });
document.addEventListener("keydown",e=>{ if(e.target.id!=="lo-rn") return;
  if(e.key==="Enter"){ e.preventDefault(); e.target.dataset.done="1"; flRenameSave(e.target,true); }
  if(e.key==="Escape"){ e.preventDefault(); e.target.dataset.done="1"; flRenameSave(e.target,false); } });
document.addEventListener("focusout",e=>{ if(e.target.id==="lo-rn"&&!e.target.dataset.done){ e.target.dataset.done="1"; flRenameSave(e.target,true); } });
document.addEventListener("contextmenu",e=>{ const c=e.target.closest("#fl-panel [data-flload]"); if(!c) return; e.preventDefault();
  const L=S.flLoad?.loadouts, id=c.dataset.flload, lo=L?.loadouts?.find(x=>x.id===id); if(!lo) return;
  document.querySelector(".wp-ctx")?.remove();
  const m=document.createElement("div"); m.className="wp-ctx"; m.setAttribute("role","menu");
  m.innerHTML=`<div class="h">${esc(lo.name)}${id===L.primary?" · ★ primary":""}</div><button data-m="rename">Rename</button>
    ${id!==L.primary?`<button data-m="primary">★ Make primary</button>`:""}${L.loadouts.length>1?`<button data-m="delete" class="danger">Delete loadout</button>`:""}`;
  document.body.appendChild(m); const r=m.getBoundingClientRect();
  m.style.left=Math.min(e.clientX,innerWidth-r.width-6)+"px"; m.style.top=Math.min(e.clientY,innerHeight-r.height-6)+"px";
  const close=()=>{ m.remove(); removeEventListener("mousedown",away,true); removeEventListener("keydown",esc_,true); };
  const away=ev=>{ if(!m.contains(ev.target)) close(); }, esc_=ev=>{ if(ev.key==="Escape") close(); };
  setTimeout(()=>{ addEventListener("mousedown",away,true); addEventListener("keydown",esc_,true); },0);
  m.onclick=async ev=>{ const b=ev.target.closest("button"); if(!b) return; const k=b.dataset.m, uid=S.flSel;
    if(k==="rename"){ close(); return flRenameStart(id); }
    if(k==="primary"){ close(); const r=await api().fleet_loadout_primary(uid,id); if(!r.ok) return toast(r.error); toast(`${lo.name} is the primary loadout: Quantum uses it for this ship`); return renderFleet(); }
    if(k==="delete"){ if(b.dataset.arm!=="1"){ b.dataset.arm="1"; b.textContent=`Sure? Deletes ${lo.swaps?`it and its ${plural(lo.swaps,"swap")}`:"it"}. Click again`; return; }
      close(); const r=await api().fleet_loadout_delete(uid,id); if(!r.ok) return toast(r.error);
      toast(`${lo.name} deleted`); S.flSlot=null; S.flOpts=null; S.cpFit=null; return renderFleet(); } }; });
async function loadoutAct(btn){ const a=btn.dataset.lo, uid=S.flSel, L=S.flLoad?.loadouts; if(!L) return;
  if(a==="new"||a==="rename"||a==="delete"){ S.flLoMode=S.flLoMode===a?null:a; await renderShip(uid); $("lo-name")?.focus(); if(a==="rename") $("lo-name")?.select(); return; }
  if(a==="cancel"){ S.flLoMode=null; return renderShip(uid); }
  let r;
  if(a==="create") r=await api().fleet_loadout_new(uid,$("lo-name").value,$("lo-from").value==="copy");
  else if(a==="rename-save") r=await api().fleet_loadout_rename(uid,L.active,$("lo-name").value);
  else if(a==="delete-yes") r=await api().fleet_loadout_delete(uid,L.active);
  else if(a==="primary") r=await api().fleet_loadout_primary(uid,L.active);
  if(r&&!r.ok) return toast(r.error);
  toast({create:"Loadout created",["rename-save"]:"Loadout renamed",["delete-yes"]:"Loadout deleted",primary:"Primary loadout set: Quantum uses it for this ship"}[a]||"Done");
  S.flLoMode=null; S.flSlot=null; S.flOpts=null; S.cpFit=null; return renderFleet(); }
// ---- Changing a part: what's in the slot now, then everything that fits as a table with labelled columns, and
// a side-by-side comparison of the part in the slot and any option you click.
const CMP_STATS=[...CP_STATS.filter(([k])=>k!=="damage_type"&&k!=="coolant_make"),["coolant_make","Cooling",n=>`${nf(n)}/s`],["cooling","Cooling",n=>`${nf(n)} seg`],
  ["power_make","Power output",n=>`${nf(n)} pips`],["power_draw","Power draw",n=>`${nf(n)} pips`],["power_min","Minimum power",n=>`${nf(n)} pips`]];
const LOWER_BETTER=new Set(["jump_fuel","em","ir","qt_spool","qt_cooldown","qt_fuel","regen_delay","down_delay","power_use","power_draw","power_min"]);
const slotNow=sl=>sl?(sl.fitted?{name:sl.fitted,maker:sl.fitted_maker,grade:sl.fitted_grade,stats:sl.fitted_stats||{},yours:true}
  :{name:sl.stock?.name||"Empty",maker:sl.stock?.maker,grade:sl.stock?.grade,stats:sl.stock?.stats||{},yours:false}):null;
// (Not called cmpDelta: compare.js has its own, loads later and replaced this one, which broke the Change list)
function flDelta(k,a,b){ if(typeof a!=="number"||typeof b!=="number"||a===b) return ""; const d=b-a, good=LOWER_BETTER.has(k)?d<0:d>0, f=(CMP_STATS.find(x=>x[0]===k)||[0,0,n=>Math.round(n*10)/10])[2];
  const pct=a?Math.abs(d)/Math.abs(a)*100:null, pctTxt=pct==null?"":Number.isInteger(+pct.toFixed(2))?String(Math.round(pct)):pct.toFixed(2);   // 12.40%, 5%
  return `<span class="cmp-d ${good?"up":"down"}">${d>0?"▲":"▼"} ${esc(String(f(Math.abs(d))))}${pct&&pct<1000?` <small>${pctTxt}%</small>`:""}</span>`; }
function compareHtml(now,opt,k){
  // A power plant carries its output as both "power" and "power_make" (the same number from two places in the
  // game files), which listed Power output twice: fold them into one "power" row on both sides.
  // Likewise a part's power draw comes as "power_use" (its power data) and "power_draw" (its stats), and some
  // parts only have one of them, which listed Power use and Power draw both, one with gaps: fold them into "power_draw".
  const one=o=>{ const st={...o.stats}; if(st.power==null&&st.power_make!=null) st.power=st.power_make; delete st.power_make;
    if(st.power_draw==null&&st.power_use!=null) st.power_draw=st.power_use; delete st.power_use; return {...o,stats:st}; };
  now=one(now); opt=one(opt);
  const keys=CMP_STATS.filter(([x])=>now.stats[x]!=null||opt.stats[x]!=null);
  const val=(st,x,f)=>st[x]==null||st[x]===""?`<span class="muted">–</span>`:esc(String(f(st[x])));
  const head=(o,lab)=>`<div class="cmp-col"><div class="cmp-tag">${lab}</div><b>${esc(o.name)}</b><span>${esc(o.maker||"")}${o.grade?` · grade ${esc(o.grade)}`:""}${o.class?` · ${esc(o.class)}`:""}</span>
      ${lab==="Option"?`<span>${o.price?money(o.price):"Not in shops"}${o.buy?.[0]?` · ${o.buy[0].place?`<a data-open="${esc(o.buy[0].place)}">${esc(o.buy[0].where)}</a>`:esc(o.buy[0].where)}`:""}</span>`:`<span>${o.yours?"Your swap":"Stock part"}</span>`}</div>`;
  return `<div class="cmp"><div class="cmp-top">${head(now,"In this slot now")}<div class="cmp-vs">vs</div>${head(opt,"Option")}</div>
    <table class="cmp-t"><thead><tr><th>Stat</th><th>Now</th><th>${esc(opt.name)}</th><th>Change</th></tr></thead><tbody>
    ${keys.map(([x,lab,f])=>`<tr class="${x===k?"key":""}"><td>${esc(lab)}${LOWER_BETTER.has(x)?' <small class="muted">lower is better</small>':""}</td><td>${val(now.stats,x,f)}</td><td>${val(opt.stats,x,f)}</td><td>${flDelta(x,now.stats[x],opt.stats[x])}</td></tr>`).join("")
      ||`<tr><td colspan="4" class="muted">No numbers to compare for these parts.</td></tr>`}</tbody></table>
    <div class="row" style="gap:6px;justify-content:flex-end"><button class="btn small ghost" data-flcmpclose="1">Close comparison</button><button class="btn small primary" data-flfit="${esc(opt.name)}" data-uuid="${esc(opt.uuid||"")}">Fit ${esc(opt.name)}</button></div></div>`; }
function renderSlotOptions(){ const r=S.flOpts, box=$("fl-opts"); if(!r||!box) return;
  if(!r.items.length){ box.innerHTML=`<div class="muted" style="font-size:12.5px">UEX lists nothing else of this kind at this size.</div>`; return; }
  const sl=S.flLoad?.slots.find(x=>x.port===S.flSlot), now=slotNow(sl);
  // Radars rank by aim assist range; with an older component_stats.json that lacks it, by grade (A first),
  // then the lowest EM, then the most health
  const byGrade=sl?.type==="Radar"&&!r.items.some(i=>i.stats?.aim_range), k=byGrade?null:r.key, cur=k&&now?.stats?.[k];
  const ranked=k||byGrade, sort=S.flSort||(ranked?"best":"price");
  const gradeN=g=>({A:0,B:1,C:2,D:3}[String(g||"").toUpperCase()]??9);
  const q=(S.flQuery||"").trim().toLowerCase(), lab=k?ITEM_STAT[k][0]:null, fmt=k?ITEM_STAT[k][1]:null, sh=sl?.type==="Shield", rackN=sl?.type==="Missile"&&sl.rack?S.flLoad.slots.filter(x=>x.rack===sl.rack).length:0,
    // Every missile slot of this size on the ship (all its racks), for fitting the same missile everywhere
    shipN=sl?.type==="Missile"?S.flLoad.slots.filter(x=>x.type==="Missile"&&String(x.size??"")===String(sl.size??"")).length:0;
  const L=r.items.filter(i=>!q||`${i.name} ${i.maker} ${i.class||""} ${i.grade||""}`.toLowerCase().includes(q)).sort(sort==="best"&&byGrade?(a,b)=>gradeN(a.grade)-gradeN(b.grade)||(a.stats.em??9e9)-(b.stats.em??9e9)||(b.stats.health||0)-(a.stats.health||0)
    :sort==="best"&&k==="missiles"?(a,b)=>((b.stats.missiles||0)*(b.stats.missile_size||1)**2)-((a.stats.missiles||0)*(a.stats.missile_size||1)**2)||(b.stats.missile_size||0)-(a.stats.missile_size||0)
    :sort==="best"&&k?(a,b)=>(b.stats[k]||0)-(a.stats[k]||0)
    :sort==="stealth"?(a,b)=>((a.stats.em??9e9)+(a.stats.ir??0))-((b.stats.em??9e9)+(b.stats.ir??0))
    :sort==="price_desc"?(a,b)=>(a.price==null)-(b.price==null)||(b.price||0)-(a.price||0)
    :(a,b)=>(a.price==null)-(b.price==null)||(a.price||0)-(b.price||0));
  const top=k?Math.max(1,...r.items.map(i=>+i.stats[k]||0),+cur||0):1;
  const hadFocus=document.activeElement?.id==="fl-q", sel=S.flCmp&&r.items.find(i=>(i.uuid||i.name)===S.flCmp);
  const isNow=i=>(i.name||"").toLowerCase()===(now?.name||"").toLowerCase(), qd=k==="qt_speed";
  box.innerHTML=`<div class="sw-now"><span class="sw-tag">In this slot now</span><b>${esc(now?.name||"Empty")}</b><span class="muted">${esc(now?.maker||"")}${now?.grade?` · grade ${esc(now.grade)}`:""} · ${now?.yours?"your swap":"stock"}</span>
      ${k&&cur!=null?`<span class="sw-key">${esc(lab)} <b>${esc(String(fmt(cur,now.stats)))}</b></span>`:""}${sh&&now?.stats?.shield_regen!=null?`<span class="sw-key">Regen <b>${Math.round(now.stats.shield_regen).toLocaleString()}/s</b></span>`:""}${now?.stats?.em!=null?`<span class="sw-key">EM <b>${fmtBig(now.stats.em)}</b></span>`:""}${qd&&now?.stats?.qt_spool!=null?`<span class="sw-key">Spool <b>${nf(now.stats.qt_spool)} s</b></span>`:""}${qd&&now?.stats?.qt_cooldown!=null?`<span class="sw-key">Cooldown <b>${nf(now.stats.qt_cooldown)} s</b></span>`:""}</div>
    <div class="row" style="gap:6px;margin:8px 0"><input class="field" id="fl-q" placeholder="Search by name, maker or class" value="${esc(S.flQuery||"")}" style="flex:1;min-width:160px;padding:4px 8px" autocomplete="off">
      <span class="muted" style="font-size:12px">${L.length} that fit</span>
      <select class="field" id="fl-sort" style="width:auto;padding:3px 8px">${byGrade?`<option value="best" ${sort==="best"?"selected":""}>Best (grade, then lowest EM)</option><option value="stealth" ${sort==="stealth"?"selected":""}>Stealthiest (lowest EM/IR)</option>`:""}${k?`<option value="best" ${sort==="best"?"selected":""}>${k==="missiles"?"Most missile capacity":`Most ${esc(lab)}`}</option><option value="stealth" ${sort==="stealth"?"selected":""}>Stealthiest (lowest EM/IR)</option>`:""}<option value="price" ${sort==="price"?"selected":""}>Price: Low to High</option><option value="price_desc" ${sort==="price_desc"?"selected":""}>Price: High to Low</option></select></div>
    ${sl?.type==="MissileLauncher"?`<div class="muted" style="font-size:12px;margin:0 2px 8px;line-height:1.5">The rack decides the missiles: more, smaller ones or fewer, bigger ones. A new rack's missile slots start empty; fit missiles to them in the Missiles group below.</div>`:""}
    ${sel&&now?compareHtml(now,sel,k):""}
    <div class="sw-wrap"><table class="sw-t"><thead><tr><th>Component</th><th>Grade</th>${k?`<th class="num" title="${esc(lab)} of each option">${esc(lab)}</th><th class="num" title="Compared with what's in the slot now">vs now</th>`:""}${sh?`<th class="num" title="Shield regeneration per second: higher is better">Regen</th>`:""}${qd?`<th class="num" title="Spool-up time before a jump: lower is better">Spool</th><th class="num" title="Cooldown after a jump: lower is better">Cooldown</th>`:""}<th class="num" title="Electromagnetic signature: lower is stealthier">EM</th><th class="num">Price</th><th></th></tr></thead><tbody>
    ${L.map((i,n)=>{ const v=k?i.stats[k]:null, here=isNow(i), on=sel===i;
      return `<tr class="${on?"on":""} ${here?"here":""}" data-flcmp="${esc(i.uuid||i.name)}" title="Click to compare with what's in the slot now">
        <td><b>${esc(i.name)}</b>${n===0&&sort==="best"&&(v||byGrade)?' <span class="best-tag">best</span>':""}${here?' <span class="now-tag">in slot</span>':""}<div class="sub">${esc(i.maker)}${i.class?` · ${esc(i.class)}`:""}${i.buy[0]?` · ${i.buy[0].place?`<a data-open="${esc(i.buy[0].place)}">${esc(i.buy[0].where)}</a>`:esc(i.buy[0].where)}`:" · not in shops"}</div></td>
        <td>${i.grade?`<span class="gr-b">${esc(i.grade)}</span>`:"–"}</td>
        ${k?`<td class="num">${v!=null?`<b>${esc(String(fmt(v,i.stats)))}</b><div class="bar"><i style="width:${Math.max(3,Math.round((+v||0)/top*100))}%"></i></div>`:"–"}</td><td class="num">${v!=null&&cur!=null&&!here?flDelta(k,+cur,+v)||'<span class="muted">same</span>':""}</td>`:""}
        ${sh?`<td class="num">${i.stats.shield_regen!=null?`${Math.round(i.stats.shield_regen).toLocaleString()}/s${now?.stats?.shield_regen!=null&&!here?`<div>${flDelta("shield_regen",+now.stats.shield_regen,+i.stats.shield_regen)}</div>`:""}`:"–"}</td>`:""}
        ${qd?`<td class="num">${i.stats.qt_spool!=null?`${nf(i.stats.qt_spool)} s${now?.stats?.qt_spool!=null&&!here?`<div>${flDelta("qt_spool",+now.stats.qt_spool,+i.stats.qt_spool)}</div>`:""}`:"–"}</td>
          <td class="num">${i.stats.qt_cooldown!=null?`${nf(i.stats.qt_cooldown)} s${now?.stats?.qt_cooldown!=null&&!here?`<div>${flDelta("qt_cooldown",+now.stats.qt_cooldown,+i.stats.qt_cooldown)}</div>`:""}`:"–"}</td>`:""}
        <td class="num">${i.stats.em!=null?fmtBig(i.stats.em):"–"}</td>
        <td class="num">${i.price?money(i.price):'<span class="muted">–</span>'}</td>
        <td class="act">${i.buy?.length?cartBtn({name:i.name,kind:"component",uuid:i.uuid||null,uex_id:typeof i.id==="number"?i.id:null}):""}<button class="btn small ghost" data-flcmp="${esc(i.uuid||i.name)}">Compare</button>${here?"":`<button class="btn small primary" data-flfit="${esc(i.name)}" data-uuid="${esc(i.uuid||"")}">Fit</button>`}${rackN>1&&rackN<shipN?`<button class="btn small ghost" data-flfill="${esc(i.name)}" data-uuid="${esc(i.uuid||"")}" title="Fit this missile to all ${rackN} slots on ${esc(sl.rack_name||"this rack")}">This rack (${rackN})</button>`:""}${shipN>1?`<button class="btn small primary" data-flfillall="${esc(i.name)}" data-uuid="${esc(i.uuid||"")}" title="Fit this missile to every size ${esc(String(sl.size??""))} missile slot on the ship: all ${shipN}, on every rack">All ${shipN} slots</button>`:""}</td></tr>`; }).join("")}
    </tbody></table></div>`;
  const so=$("fl-sort"); if(so) so.onchange=()=>{ S.flSort=so.value; renderSlotOptions(); };
  const qi=$("fl-q"); if(qi){ qi.oninput=()=>{ S.flQuery=qi.value; const pos=qi.selectionStart; renderSlotOptions(); const n=$("fl-q"); n.focus(); n.setSelectionRange(pos,pos); };
    if(hadFocus){ qi.focus(); } }
  if(sel) box.querySelector(".cmp")?.scrollIntoView({block:"nearest",behavior:"smooth"}); }
$("fl-panel").addEventListener("keydown",e=>{ if(e.key==="Enter"&&e.target.id==="lo-name"){ const b=$("fl-panel").querySelector('[data-lo="create"],[data-lo="rename-save"]'); if(b) b.click(); } });
$("fl-panel").addEventListener("change",async e=>{ if(e.target.id!=="fl-cool") return;
  await api().fleet_set_power(S.flSel,null,null,e.target.value===""?"auto":(+e.target.value||0)); renderShip(S.flSel); });
$("fl-add-btn").onclick=async()=>{ const v=(S.veh||[]).find(x=>x.full.toLowerCase()===$("fl-add").value.trim().toLowerCase());
  if(!v) return toast("Pick a ship from the suggestions"); const r=await api().fleet_add(v.id); if(!r.ok) return toast(r.error);
  $("fl-add").value=""; S.flSel=r.uid; S.flSlot=null; toast(`${v.full} added to your fleet`); renderFleet(); };
$("fl-add").addEventListener("keydown",e=>{ if(e.key==="Enter") $("fl-add-btn").click(); });
$("fl-out").onclick=async e=>{
  const m=e.target.closest("[data-flmain]"); if(m){ await api().fleet_set_main(m.dataset.flmain); S.cpGalKey=null; return renderFleet(); }
  // Removing a ship asks first: its component swaps go with it.
  const d=e.target.closest("[data-fldel]"); if(d){ S.flDel=S.flDel===d.dataset.fldel?null:d.dataset.fldel; await renderFleet();
    // Bring the question into view (a long fleet can leave it below the fold) and put the keyboard on Cancel
    const q=S.flDel&&$("fl-out").querySelector(".fl-confirm"); if(q){ q.scrollIntoView({behavior:"smooth",block:"nearest"}); q.querySelector("[data-fldelno]")?.focus({preventScroll:true}); } return; }
  if(e.target.closest("[data-fldelno]")){ S.flDel=null; return renderFleet(); }
  const y=e.target.closest("[data-fldelyes]"); if(y){ const nm=S.fleet?.find(x=>x.uid===y.dataset.fldelyes)?.full;
    S.flDel=null; await api().fleet_remove(y.dataset.fldelyes); S.cpFit=null; toast(`${nm||"Ship"} removed from your fleet`); return renderFleet(); }
  const h=e.target.closest("[data-fl]"); if(h){ S.flSel=h.dataset.fl; S.flSlot=null; renderFleet(); } };
// Drag a ship to its new place in My Fleet; the order is saved with your fleet
{ const fo=$("fl-out"), clear=()=>{ for(const x of fo.querySelectorAll(".vh.fl-over-top,.vh.fl-over-bot")) x.classList.remove("fl-over-top","fl-over-bot"); },
    spot=(e,c)=>{ const r=c.getBoundingClientRect(); return e.clientY>r.top+r.height/2; };
  fo.addEventListener("dragstart",e=>{ const c=e.target.closest?.("[data-fldrag]"); if(!c) return; S.flDrag=c.dataset.fldrag;
    e.dataTransfer.effectAllowed="move"; e.dataTransfer.setData("text/plain",S.flDrag); c.classList.add("fl-dragging"); });
  fo.addEventListener("dragend",e=>{ e.target.closest?.("[data-fldrag]")?.classList.remove("fl-dragging"); clear(); S.flDrag=null; });
  fo.addEventListener("dragover",e=>{ const c=e.target.closest?.("[data-fldrag]"); if(!c||!S.flDrag) return; e.preventDefault(); e.dataTransfer.dropEffect="move";
    clear(); if(c.dataset.fldrag!==S.flDrag) c.classList.add(spot(e,c)?"fl-over-bot":"fl-over-top"); });
  fo.addEventListener("dragleave",e=>{ if(!fo.contains(e.relatedTarget)) clear(); });
  fo.addEventListener("drop",async e=>{ const c=e.target.closest?.("[data-fldrag]"), from=S.flDrag; if(!c||!from) return; e.preventDefault(); clear(); S.flDrag=null;
    const to=c.dataset.fldrag; if(to===from) return;
    const r=await api().fleet_move(from,to,spot(e,c)); if(r&&r.ok===false) toast(r.error);
    renderFleet(); }); }
$("fl-panel").onclick=async e=>{ if(await tradeClick(e)) return;
  const rc=e.target.closest("[data-flrec]"); if(rc){ if(rc.dataset.flrec==="close"){ S.flRec=null; return renderShip(S.flSel); } return recLoad(S.flSel,S.flRec?.role||"balanced"); }
  const rr=e.target.closest("[data-flrecrole]"); if(rr){ return recLoad(S.flSel,rr.dataset.flrecrole); }
  if(e.target.closest("[data-flrecapply]")){ const R=S.flRec; const x=await api().fleet_recommend(S.flSel,R.role,true); if(!x.ok) return toast(x.error);
    toast(`Saved as "${x.name}" and showing it`); S.flRec=null; S.flLoad=null; return renderShip(S.flSel); }
  const rt=e.target.closest("[data-flretry]"); if(rt) return loadSlotOptions(rt.dataset.type,rt.dataset.size);
  const ex=e.target.closest("[data-flexp]"); if(ex){ S.flExp=S.flExp||{}; S.flExp[ex.dataset.flexp]=!S.flExp[ex.dataset.flexp]; return renderShip(S.flSel); }
  const sw=e.target.closest("[data-flswap]"); if(sw){ S.flSlot=S.flSlot===sw.dataset.flswap?null:sw.dataset.flswap; S.flGroup=S.flSlot&&sw.dataset.flports?JSON.parse(sw.dataset.flports):null;
    S.flOpts=null; S.flQuery=""; S.flCmp=null; S.flScroll=!!S.flSlot; return renderShip(S.flSel); }
  const lo=e.target.closest("[data-lo]"); if(lo) return loadoutAct(lo);
  const ll=e.target.closest("[data-flload]"); if(ll){ if(ll.dataset.flload===S.flLoad?.loadouts?.active) return;
    const r=await api().fleet_loadout_switch(S.flSel,ll.dataset.flload); if(!r.ok) return toast(r.error); S.flSlot=null; S.flOpts=null; S.flLoMode=null; return renderShip(S.flSel); }
  if(e.target.closest("[data-flcmpclose]")){ S.flCmp=null; return renderSlotOptions(); }
  const fa=e.target.closest("[data-flfillall]"); if(fa){ const sl=S.flLoad?.slots.find(x=>x.port===S.flSlot); if(!sl) return;
    const r=await api().fleet_fill_missiles(S.flSel,sl.size,fa.dataset.flfillall,fa.dataset.uuid||null); if(!r.ok) return toast(r.error);
    toast(`Fitted ${fa.dataset.flfillall} to all ${r.count} missile slots`); S.flSlot=null; S.flOpts=null; S.flCmp=null; return renderFleet(); }
  const fill=e.target.closest("[data-flfill]"); if(fill){ const sl=S.flLoad?.slots.find(x=>x.port===S.flSlot); if(!sl?.rack) return;
    const r=await api().fleet_fill_rack(S.flSel,sl.rack,fill.dataset.flfill,fill.dataset.uuid||null); if(!r.ok) return toast(r.error);
    toast(`Fitted ${fill.dataset.flfill} × ${r.count}`); S.flSlot=null; S.flOpts=null; S.flCmp=null; return renderFleet(); }
  const fit=e.target.closest("[data-flfit]"); if(fit){ const ports=S.flGroup&&S.flGroup[0]===S.flSlot?S.flGroup:[S.flSlot];
    for(const p of ports){ const x=await api().fleet_set_slot(S.flSel,p,fit.dataset.flfit,fit.dataset.uuid||null); if(x&&x.ok===false){ toast(x.error); break; } }
    toast(ports.length>1?`Fitted ${fit.dataset.flfit} × ${ports.length}`:`Fitted ${fit.dataset.flfit}`); S.flSlot=null; S.flGroup=null; S.flOpts=null; S.flCmp=null; return renderFleet(); }
  const cm=e.target.closest("[data-flcmp]"); if(cm&&!e.target.closest("a,[data-open]")){ S.flCmp=S.flCmp===cm.dataset.flcmp&&!e.target.closest("button")?null:cm.dataset.flcmp; return renderSlotOptions(); }
  const po=e.target.closest("[data-poff]"); if(po) return toast(po.dataset.poff==="q"?"The quantum drive only takes power in NAV mode. Switch to Travel · NAV first.":"Weapons and shields take no power in NAV mode. Switch to Combat · SCM first.");
  const pip=e.target.closest("[data-ppip]"); if(pip){ const sl=[...S.flLoad.slots,...(S.flLoad.fixed||[])].find(x=>x.port===pip.dataset.ppip), n=+pip.dataset.n;
    await api().fleet_set_part_power(S.flSel,pip.dataset.ppip,sl?.power?.pips===n?n-1:n); return renderShip(S.flSel); }
  if(e.target.closest("[data-pauto]")){ await api().fleet_set_power(S.flSel,null,null,null,true); return renderShip(S.flSel); }
  const md=e.target.closest("[data-flmod]"); if(md){ const r=await api().fleet_set_module(S.flSel,md.dataset.flmod); if(!r.ok) return toast(r.error);
    toast(`${r.module.full||r.module.name} on this loadout${r.module.concept?" · a concept, not in the game yet":""}${r.module.scu!=null?` · ${Number(r.module.scu).toLocaleString()} SCU`:""}`);
    S.flLoad=null; return renderFleet(); }
  const pm=e.target.closest("[data-pmode]"); if(pm){ await api().fleet_set_power(S.flSel,null,pm.dataset.pmode,null); return renderShip(S.flSel); }
  if(e.target.closest("[data-ptoggle]")){ S.flPowerOpen=!S.flPowerOpen; return renderShip(S.flSel); }
  if(e.target.closest("[data-coolauto]")){ await api().fleet_set_power(S.flSel,null,null,"auto"); return renderShip(S.flSel); }
  if(e.target.closest("[data-flshop]")){ const r=await api().shop_add_loadout(S.flSel); if(!r.ok) return toast(r.error); setCartCount(r.left);
    toast(`${plural(r.added,"part")} added to your cart · ${plural(r.left,"item")} in it. Open Cart to see the route`); return; }
  const rs=e.target.closest("[data-flreset]"); if(rs){ for(const p of rs.dataset.flports?JSON.parse(rs.dataset.flports):[rs.dataset.flreset]) await api().fleet_set_slot(S.flSel,p,null); return renderFleet(); } };

// ---- Trade routes: details panel, and your own runs tracked start to finish
const TRADE_DISCLAIMER=`<div class="disclaim"><b>Estimates only.</b> Profits and ROI come from prices other players reported to UEX; prices and stock change all the time. Check the terminal before you buy.</div>`;
const sumCell=(lab,val,cls="")=>val==null||val===""?"":`<div class="${cls}"><span>${lab}</span><b>${val}</b></div>`;
function closeRunDetail(){ S.trOpen=null; $("tr-panel")?.classList.remove("show"); document.body.classList.remove("trd-open"); document.querySelectorAll(".tr-card.open").forEach(c=>c.classList.remove("open")); }
// Details of a found run beside the map: the commodity, both ends, the numbers, when prices were reported.
async function openRunDetail(i){
  const x=S.trRoutes?.[i]; if(!x) return; S.trOpen=i;
  document.querySelectorAll(".tr-card").forEach(c=>c.classList.toggle("open",+c.dataset.tri===i));
  const end=(pl,name)=>pl?`<a data-open="${esc(pl)}" style="cursor:pointer;text-decoration:underline">${esc(name)}</a>`:esc(name);
  const yes=b=>b?"Yes":"No";
  const c=S.mkByName?.[x.commodity.toLowerCase()], box=(x.boxes_from||"").split(",").map(Number).filter(Boolean).pop();
  const facts=[c?.kind, c?.illegal?'<span style="color:#ffb454">Illegal</span>':null, c?.raw?"Raw":null, c?.volatile?"Volatile in quantum":null,
    box?`Biggest box here: ${box} SCU · ${Math.ceil(x.units/box)} box${Math.ceil(x.units/box)===1?"":"es"} for your load`:null,
    x.scu_from&&x.scu_from<x.units?`<span style="color:#ffb454">Only ${x.scu_from} SCU in stock</span>`:null,
    x.cross_system?"Needs a jump between systems":null].filter(Boolean);
  // one end of the run: where it is, the price, what you'd trade there, and what the place has
  const endBox=(title,place,term,where,price,qtyLab,qty,boxes,elev,dock,refuel,station,ground,monitored,faction,youLab,units,moneyLab)=>`<div class="vd-sec ${title==="Buy at"?"buy":"sell"}"><div class="mk-h">${title}</div>
      <div class="vd-row"><span>Terminal</span><b>${end(place,term)}</b></div>
      <div class="vd-row"><span>Where</span><b>${esc(where)}${station?" · space station":ground?" · on the ground":""}</b></div>
      <div class="vd-row"><span>Price</span><b>${money(price)}/SCU</b></div>
      <div class="vd-row"><span>${youLab}</span><b>${units.toLocaleString()} SCU</b></div>
      <div class="vd-row"><span>${moneyLab}</span><b class="${moneyLab==="Revenue"?"good":""}">${money(units*price)}</b></div>
      ${qty?`<div class="vd-row"><span>${qtyLab}</span><b class="${qty<units?"warn":""}">${qty.toLocaleString()} SCU</b></div>`:""}
      ${boxes?`<div class="vd-row"><span>Box sizes</span><b>${esc(boxes)} SCU</b></div>`:""}
      <div class="vd-row"><span>Freight elevator / dock</span><b>${yes(elev||dock)}</b></div>
      <div class="vd-row"><span>Refuel</span><b>${yes(refuel)}</b></div>
      ${monitored!=null?`<div class="vd-row"><span>Security</span><b>${monitored?"Monitored":'<span class="warn">Unmonitored</span>'}</b></div>`:""}
      ${faction?`<div class="vd-row"><span>Faction</span><b>${esc(faction)}</b></div>`:""}</div>`;
  const p=$("tr-panel"); p.classList.add("show"); document.body.classList.add("trd-open");
  p.innerHTML=`<div class="trd-grid">
      <div class="trd-info"><button class="iconbtn trd-x" data-act="trclose" title="Close">✕</button>
        <h2 style="margin:0">${esc(x.commodity)}</h2>
        <div class="sub muted" style="margin:2px 0 8px">${x.units.toLocaleString()} SCU · ${esc(x.from_where)} → ${esc(x.to_where)}${x.cross_system?' · <span style="color:#ffb454">crosses systems</span>':""}</div>
        <div class="trd-pic" id="trd-img"></div>
        <div class="mkp-stats">${sumCell("Profit",`+${money(x.profit)}`)}${sumCell("Cost",money(x.cost))}${sumCell("Revenue",money(x.units*x.sell))}
          ${sumCell("Per SCU",`+${money(x.sell-x.buy)}`)}${sumCell("ROI",x.roi!=null?`${Math.round(x.roi)}%`:null)}${sumCell("Distance",x.dist?fmtDist(x.dist):null)}</div>
        <div class="row" style="gap:6px;flex-wrap:wrap">${x.from_place&&x.to_place?`${runGoing(x)?`<button class="btn" data-act="trstart" title="It's on your route and the map card">✓ Run started</button>`:`<button class="btn primary" data-act="trstart" title="Saves it to Planned Routes and puts its buy and sell stops on your route">Start run</button>`}<a class="muted" data-act="tradd" style="cursor:pointer;font-size:12.5px;align-self:center;text-decoration:underline" title="Its two stops on your route, without tracking it as a run">Only add the stops</a>`:`<span class="muted" style="font-size:12px">${esc(!x.from_place?x.from:x.to)} isn't on the map yet</span>`}
          ${x.url?`<button class="btn ghost" data-ext="${esc(x.url)}">UEX</button>`:""}</div>
        <div class="trd-facts">${facts.map(f=>`<span>${f}</span>`).join("")}</div></div>
      <div class="trd-map" id="trd-map"><span class="lbl">Route preview</span><button class="pv-next in-win" id="trd-next" type="button" data-pvnext="1"></button></div>
    ${endBox("Buy at",x.from_place,x.from,x.from_where,x.buy,"In stock",x.scu_from,x.boxes_from,x.elevator_from,x.dock_from,x.refuel_from,x.from_station,x.from_ground,x.from_monitored,x.faction_from,"You buy",x.units,"Cost")}
    ${endBox("Sell at",x.to_place,x.to,x.to_where,x.sell,"Demand",x.scu_to,x.boxes_to,x.elevator_to,x.dock_to,x.refuel_to,x.to_station,x.to_ground,x.to_monitored,x.faction_to,"You sell",x.units,"Revenue")}</div>
    <div class="trd-footer">${x.quantum_from||x.quantum_to?`<span class="chip y" title="A Quantum datarunner reported this newer than UEX has it, so the run is planned with their numbers">Quantum report: ${[x.quantum_from&&`buy side ${agoTs(x.quantum_from.at)}`,x.quantum_to&&`sell side ${agoTs(x.quantum_to.at)}`].filter(Boolean).join(", ")}</span> · `:""}${x.updated_from&&x.updated_to?`Buy price reported ${agoTs(x.updated_from)}, sell price ${agoTs(x.updated_to)}`:x.updated?`Prices last reported ${agoTs(x.updated)}`:"Report time unknown"}${x.reports_from||x.reports_to?` · based on ${(x.reports_from||0)+(x.reports_to||0)} player reports`:""}${TRADE_DISCLAIMER}</div>`;
  fitTradePanel();
  if(x.from_place&&x.to_place) requestAnimationFrame(()=>previewPlaces(x.from_place,x.to_place,x.commodity));   // after layout, so the map window is measured
  const img=await api().wiki_image(x.commodity); if(S.trOpen!==i) return;
  const b=$("trd-img"); if(b) b.innerHTML=img?`<img src="${esc(img)}" alt="" referrerpolicy="no-referrer" onload="fitTradePanel()">`:`<div class="ph-art ph-grid-bg">${phSvg("commodity")}</div>`; }
// The route page scales as a whole (text, picture, map window, figures) so all four quadrants and the
// footer fit the window without scrolling; bigger windows get it a little larger, small ones smaller.
// CSS zoom re-lays it out at the new size, so nothing overflows sideways.
function fitTradePanel(){ const p=$("tr-panel"); if(!p||!p.classList.contains("show")) return;
  let w=p.querySelector(":scope > .trd-fit");
  if(!w){ w=document.createElement("div"); w.className="trd-fit"; while(p.firstChild) w.appendChild(p.firstChild); p.appendChild(w); }
  const cs=getComputedStyle(p), avail=p.clientHeight-parseFloat(cs.paddingTop)-parseFloat(cs.paddingBottom);
  let z=1; w.style.zoom=1;
  for(let k=0;k<3;k++){ const h=w.getBoundingClientRect().height; if(!h) break;   // height changes with width, so settle in a few steps
    z=Math.max(0.55,Math.min(1.3,z*avail/h)); w.style.zoom=z; } }
addEventListener("resize",()=>{ clearTimeout(S.trFitT); S.trFitT=setTimeout(fitTradePanel,80); });
// A found route as a run to save, and whether you already have that run going
const runOf=x=>({commodity:x.commodity,units:x.units,from_place:x.from_place,to_place:x.to_place,from_terminal:x.from,to_terminal:x.to,plan_buy:x.buy,plan_sell:x.sell,url:x.url,boxes_from:x.boxes_from||null});
const runGoing=x=>(S.runs||[]).some(r=>r.stage!=="sold"&&r.commodity===x.commodity&&r.from_place===x.from_place&&r.to_place===x.to_place);
// Start run: saved to Planned Routes and its buy and sell stops put on your route (the planner keeps buying
// before selling). It then shows on the map's home card; "Plan best order" there sorts several runs out.
async function startRun(x){ if(runGoing(x)) return toast(`You already have this ${x.commodity} run going. It's on your route`);
  const r=await api().trade_run_start(runOf(x)); if(!r.ok) return toast(r.error);
  await runsSync(true); await poll(); redrawTradeButtons();
  toast(r.runs>1?`${x.commodity} run started. You have ${r.runs} runs on your route: Plan best order on the map card sorts them out`
    :`${x.commodity} run started: buy at ${x.from_place}, sell at ${x.to_place}. Follow it on the map card`); }
$("tr-panel").onclick=async e=>{ if(await tradeClick(e)) return; const x=S.trRoutes?.[S.trOpen];
  if(e.target.closest("[data-act=trclose]")){ closeRunDetail(); setPreview(null); return; }
  if(e.target.closest("[data-act=tradd]")&&x){ await api().add_stops([x.from_place,x.to_place]); await poll(); return toast(`Added ${x.from_place} and ${x.to_place} to the route (not tracked as a run)`); }
  if(e.target.closest("[data-act=trstart]")&&x){ await startRun(x); if(runGoing(x)) openRunDetail(S.trOpen); } };
// ---- My runs
// A run's steps ("bought" is the saved key for Purchased, so older runs still work; app.TRADE_STAGES)
const STAGES=[["planned","Planned"],["bought","Pur\u00adchased"],   // soft hyphen: "Pur-chased" only when the column is too narrow
  ["loading","Loading"],["transit","In transit"],["unloading","Off loading"],["sold","Sold"]];
const RUN_NEXT={planned:["bought","Mark purchased"],bought:["loading","Start loading"],loading:["transit","Departed"],transit:["unloading","Arrived · off loading"],unloading:["sold","Mark sold"]};
function showTradeView(v){ S.trView=v; for(const b of document.querySelectorAll("[data-trv]")) b.classList.toggle("on",b.dataset.trv===v);
  $("tr-find").hidden=v!=="find"; $("tr-mine").hidden=v!=="mine"; if(v==="mine"){ closeRunDetail(); renderRuns(); } }
document.querySelector(".tr-tabs").onclick=e=>{ const b=e.target.closest("[data-trv]"); if(b) showTradeView(b.dataset.trv); };
function runProfit(r){ const buy=r.buy_price??r.plan_buy, sell=r.sell_price??r.plan_sell;
  if(!r.units||buy==null||sell==null) return null;
  return {v:r.units*(sell-buy)-runFees(r), actual:r.buy_price!=null&&r.sell_price!=null}; }
// What's typed in a run's price and fee boxes but not saved yet (kept across redraws until the step is marked)
S.runDraft=S.runDraft||{};
// The run as it would be with what's typed: buying sets the price paid and loading fee, selling the price
// sold for and unloading fee. So Est. profit follows a sell price that isn't the one expected.
function runWithDraft(x){ const d=S.runDraft[x.id], nx=RUN_NEXT[x.stage]?.[0]; if(!d||!["bought","sold"].includes(nx)) return x;
  const num=v=>v===""||v==null||isNaN(+v)?null:+v, y={...x};
  if(nx==="bought"){ if(num(d.price)!=null) y.buy_price=num(d.price); if(num(d.fee)!=null) y.load_fee=num(d.fee); }
  else { if(num(d.price)!=null) y.sell_price=num(d.price); if(num(d.fee)!=null) y.unload_fee=num(d.fee); }
  return y; }
const runPaid=x=>x.units&&x.buy_price!=null?x.units*x.buy_price+(+x.load_fee||0):null;
// The money line of a run: total paid, what selling brings in, profit (estimated until sold) and how far a sell
// price is off what was expected
function runMoneyHtml(x0){ const x=runWithDraft(x0), pr=runProfit(x), paid=runPaid(x), u=x.units||0;
  const sell=x.sell_price??x.plan_sell, off=x.sell_price!=null&&x.plan_sell!=null&&Math.round(x.sell_price)!==Math.round(x.plan_sell)?x.sell_price-x.plan_sell:null;
  const out=[];
  if(paid!=null) out.push(`<span title="${u} SCU × ${money(x.buy_price)}${+x.load_fee?` + ${money(+x.load_fee)} loading fee`:""}">Total paid <b>${money(paid)}</b></span>`);
  else if(u&&x.plan_buy!=null) out.push(`<span>Est. cost ${money(u*x.plan_buy)}</span>`);
  if(u&&sell!=null) out.push(`<span>${x.sell_price!=null?(x0.stage==="sold"?"Sold for":"Selling for"):"Est. sale"} ${money(u*sell)}</span>`);
  if(pr) out.push(`<span style="color:${pr.v>=0?"#57e39b":"#ff8f8f"};font-weight:600">${pr.actual&&x0.stage==="sold"?"Profit":"Est. profit"} ${pr.v>=0?"+":"−"}${money(Math.abs(pr.v))}</span>`);
  if(off!=null) out.push(`<span style="color:${off<0?"#ffb454":"#57e39b"}" title="Expected ${money(x.plan_sell)}/SCU when you planned it">${off<0?"−":"+"}${money(Math.abs(off))}/SCU vs expected${u?` (${off<0?"−":"+"}${money(Math.abs(off*u))})`:""}</span>`);
  return out.join(""); }
const runFees=r=>(+r.load_fee||0)+(+r.unload_fee||0)+(+r.handling||0);
function runForm(r){ r=r||{}; const v=k=>esc(r[k]??"");
  return `<div class="run-form" data-runform="${esc(r.id||"")}">
    <span class="k">Commodity</span><input class="field" data-f="commodity" list="mk-dl" value="${v("commodity")}" placeholder="Like “Laranite”">
    <span class="k">Amount</span><div class="row" style="gap:6px"><input class="field" data-f="units" type="number" min="0" value="${v("units")}" style="flex:1"><span class="muted">SCU</span></div>
    <span class="k">Buy at</span><input class="field" data-f="from_place" list="places-dl" value="${v("from_place")}" placeholder="Station, city or outpost">
    <span class="k">Paid</span><div class="row" style="gap:6px"><input class="field" data-f="buy_price" type="number" min="0" value="${esc(r.buy_price??r.plan_buy??"")}" style="flex:1"><span class="muted">aUEC/SCU</span></div>
    <span class="k">Sell at</span><input class="field" data-f="to_place" list="places-dl" value="${v("to_place")}" placeholder="Station, city or outpost">
    <span class="k">Sold for</span><div class="row" style="gap:6px"><input class="field" data-f="sell_price" type="number" min="0" value="${esc(r.sell_price??"")}" placeholder="${r.plan_sell?`expected ${Math.round(r.plan_sell)}`:"when you've sold"}" style="flex:1"><span class="muted">aUEC/SCU</span></div>
    <span class="k" title="What auto loading cost you when buying. Taken off the profit.">Auto loading fee</span><div class="row" style="gap:6px"><input class="field" data-f="load_fee" type="number" min="0" value="${esc(r.load_fee??(r.handling??0))}" style="flex:1"><span class="muted">aUEC</span></div>
    <span class="k" title="What auto unloading cost you when selling. Taken off the profit.">Auto unloading fee</span><div class="row" style="gap:6px"><input class="field" data-f="unload_fee" type="number" min="0" value="${esc(r.unload_fee??0)}" style="flex:1"><span class="muted">aUEC</span></div>
    <span class="k">Notes</span><input class="field" data-f="notes" value="${v("notes")}" placeholder="Optional">
    <span></span><div class="row" style="gap:6px"><button class="btn primary small" data-act="runsave">${r.id?"Save":"Create route"}</button><button class="btn ghost small" data-act="runcancel">Cancel</button></div></div>`; }
async function renderRuns(){
  const r=await api().trade_runs(); S.runs=r.runs||[]; const n=S.runs.filter(x=>x.stage!=="sold").length;
  $("tr-mine-n").textContent=n?`(${n})`:"";
  if(!S.mk&&S.live?.log?.uex_token){ const c=await api().uex_commodities(); if(c.ok){ S.mk=c.items; S.mkByName=Object.fromEntries(c.items.map(x=>[x.name.toLowerCase(),x]));
    $("mk-dl").innerHTML=c.items.map(x=>`<option value="${esc(x.name)}"></option>`).join(""); } }
  const card=x=>{ const st=STAGES.findIndex(s=>s[0]===x.stage), t=x.times||{}, dr=S.runDraft[x.id]||{};
    const next=RUN_NEXT[x.stage], pay=next?.[0]==="bought";
    return `<div class="contract ${x.stage==="sold"?"done":""}" data-run="${x.id}"><h3>${esc(x.commodity)}${x.units?` <span class="muted" style="font-weight:500">· ${x.units} SCU</span>`:""}</h3>
      <div class="trackno" title="Click to copy">Job ID # <b>${esc(x.tracking_no||"")}</b></div>
      <div class="sub">${esc(x.from_place||"?")} → ${esc(x.to_place||"?")}</div>
      <div class="track"><div class="runbar">${STAGES.map((s,k)=>`<i class="${k<=st?"on":""}"></i>`).join("")}</div>
        <div class="runlabels">${STAGES.map(([key,lab],k)=>`<div class="${k<=st?"done":""}">${lab}${t[key]?`<br><span class="muted">${new Date(t[key]*1000).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</span>`:""}</div>`).join("")}</div></div>
      <div class="facts" style="display:flex;flex-wrap:wrap;gap:4px 12px;font-size:12px;color:var(--ink-2);margin:6px 0">
        ${x.buy_price!=null?`<span>Paid ${money(x.buy_price)}/SCU</span>`:x.plan_buy!=null?`<span>Expected buy ${money(x.plan_buy)}/SCU</span>`:""}
        ${x.sell_price!=null?`<span>${x.stage==="sold"?"Sold":"Selling at"} ${money(x.sell_price)}/SCU</span>`:x.plan_sell!=null?`<span>Expected sell ${money(x.plan_sell)}/SCU</span>`:""}
        ${+x.load_fee?`<span>Loading fee −${money(+x.load_fee)}</span>`:""}${+x.unload_fee?`<span>Unloading fee −${money(+x.unload_fee)}</span>`:""}${+x.handling?`<span>Load/unload −${money(+x.handling)}</span>`:""}
        ${x.notes?`<span>${esc(x.notes)}</span>`:""}</div>
      <div class="facts run-money" data-runmoney="${x.id}" style="display:flex;flex-wrap:wrap;gap:4px 12px;font-size:12.5px;color:var(--ink-2);margin:0 0 6px">${runMoneyHtml(x)}</div>
      ${S.runEdit===x.id?runForm(x):`${next&&(pay||next[0]==="sold")?`<div class="stepbox">
          <label><span>${pay?"Paid":"Sold for"} per SCU</span><input class="field" data-price="${x.id}" type="number" min="0" value="${esc(dr.price??(pay?(x.buy_price??x.plan_buy??""):(x.sell_price??x.plan_sell??"")))}"></label>
          <label title="If you used auto ${pay?"loading":"unloading"}, what it cost. It comes off the profit."><span>Auto ${pay?"loading":"unloading"} fee</span><input class="field" data-fee="${x.id}" type="number" min="0" value="${esc(dr.fee??(pay?(x.load_fee??0):(x.unload_fee??0)))}"></label></div>
          ${next[0]==="sold"?`<div class="muted" style="font-size:11.5px;margin:-2px 0 6px">Selling for a different price than expected? Type what the terminal pays: the totals above update as you type.</div>`:""}`:""}
        <div class="run-acts">${next?`<button class="btn small primary" data-runstage="${next[0]}">${next[1]}</button>`:""}
        ${st>0?`<button class="btn small ghost icon" data-runstage="${STAGES[st-1][0]}" title="Back a step (undo)" aria-label="Back a step">↶</button>`:""}
        <button class="btn small ghost" data-runcargo="1" title="How this cargo fits your ship, box by box">Load plan</button>${x.from_place&&x.to_place?`<button class="btn small ghost" data-runprev="1" title="Show the route on the map">Map</button><button class="btn small ghost" data-runroute="1" title="Add both stops to your route">+ Route</button>`:""}
        <span class="spacer"></span>${x.from_place&&x.to_place&&(x.buy_price||x.plan_buy)&&(x.sell_price||x.plan_sell)?`<button class="btn small ghost" data-runshare="1" title="Show this route to other Quantum users in Find Routes for a week">Share</button>`:""}<button class="btn small ghost" data-runedit="1">Edit</button><button class="btn small ghost" data-rundel="1" style="color:var(--danger)">Delete</button></div>`}</div>`; };
  const open=S.runs.filter(x=>x.stage!=="sold"), done=S.runs.filter(x=>x.stage==="sold");
  const total=done.reduce((a,x)=>a+((runProfit(x)||{}).v||0),0);
  $("tr-mine-out").innerHTML=(S.runEdit==="new"?runForm(null):`<button class="btn primary" data-act="runnew" style="width:100%;margin-bottom:10px">+ Create my own trade route</button>`)
    +(open.length?open.map(card).join(""):S.runEdit==="new"?"":`<div class="empty"><strong>No Planned Routes</strong>Start one from the Find Routes tab, or create your own above.</div>`)
    +(done.length?`<details class="finished" ${S.runsDoneOpen?"open":""}><summary>Finished (${done.length}) · ${total>=0?"+":"−"}${money(Math.abs(total))}</summary>${done.map(card).join("")}</details>`:""); }
// Typing a price or fee: the run's totals and Est. profit follow straight away (saved when the step is marked)
$("tr-mine-out").addEventListener("input",e=>{ const el=e.target.closest("[data-price],[data-fee]"); if(!el) return;
  const id=el.dataset.price||el.dataset.fee, x=(S.runs||[]).find(r=>r.id===id); if(!x) return;
  (S.runDraft[id]=S.runDraft[id]||{})[el.dataset.price?"price":"fee"]=el.value;
  const box=$("tr-mine-out").querySelector(`[data-runmoney="${CSS.escape(id)}"]`); if(box) box.innerHTML=runMoneyHtml(x); });
$("tr-mine-out").onclick=async e=>{ if(await tradeClick(e)) return;
  if(e.target.closest("summary")){ setTimeout(()=>{ S.runsDoneOpen=!!$("tr-mine-out").querySelector("details.finished")?.open; },0); return; }
  const tn=e.target.closest(".trackno"); if(tn){ const n=tn.querySelector("b").textContent; try{ await navigator.clipboard.writeText(n); toast(`Copied ${n}`); }catch{ toast(n); } return; }
  if(e.target.closest("[data-act=runnew]")){ S.runEdit="new"; return renderRuns(); }
  if(e.target.closest("[data-act=runcancel]")){ S.runEdit=null; return renderRuns(); }
  if(e.target.closest("[data-act=runsave]")){ const f=e.target.closest("[data-runform]"), data={id:f.dataset.runform||undefined};
    for(const i of f.querySelectorAll("[data-f]")) data[i.dataset.f]=i.value.trim();
    for(const k of ["from_place","to_place"]) if(data[k]&&!S.locMap[data[k]]) return toast(`Pick “${data[k]}” from the suggestions so it can go on the map`);
    data.handling=0;                                    // the two fee fields replace the old combined one
    const r=await api().trade_run_save(data); if(!r.ok) return toast(r.error); S.runEdit=null; toast("Route saved"); return renderRuns(); }
  const c=e.target.closest("[data-run]"); if(!c) return; const x=S.runs.find(r=>r.id===c.dataset.run);
  const sg=e.target.closest("[data-runstage]"); if(sg){ const fwd=sg.dataset.runstage===RUN_NEXT[x.stage]?.[0];   // the price boxes go with a step forward, not an undo
    const price=fwd?c.querySelector(`[data-price="${x.id}"]`)?.value:null, fee=fwd?c.querySelector(`[data-fee="${x.id}"]`)?.value:null;
    await api().trade_run_stage(x.id,sg.dataset.runstage,price||null,fee===""||fee==null?null:fee); delete S.runDraft[x.id]; return renderRuns(); }
  if(e.target.closest("[data-runedit]")){ S.runEdit=x.id; return renderRuns(); }
  if(e.target.closest("[data-runshare]")){ const r=await api().share_route(x.id); toast(r.ok?"Shared: other Quantum users will see it in Find Routes for a week":(r.error||"Couldn't share it")); return; }
  if(e.target.closest("[data-rundel]")){ await api().trade_run_delete(x.id); toast("Route deleted"); return renderRuns(); }
  if(e.target.closest("[data-runcargo]")) return openCargo(x.id);
  if(e.target.closest("[data-runprev]")) return previewPlaces(x.from_place,x.to_place,x.commodity);
  if(e.target.closest("[data-runroute]")){ const r=await api().trade_run_route(x.id); if(!r.ok) return toast(r.error); await runsSync(true); await poll();
    return toast(`${x.commodity}: buy at ${x.from_place}, sell at ${x.to_place} are on your route`); } };


// ---- Updates: a newer release on GitHub is offered here; Quantum downloads it, checks its signature
// and restarts into it.
// Star Citizen was updated (a new build in Game.log): say so once. Planet alignment starts over for the new
// version, and ships, parts and paints are fetched fresh, so what the update added shows up.
function renderGameUpdate(){ const b=$("game-update-bar"), g=S.live?.game_update; if(!b) return;
  if(!g){ b.hidden=true; return; }
  b.hidden=false;
  b.innerHTML=`<div class="row"><b>Star Citizen was updated${g.version?` to ${esc(g.version)}`:""}</b><span class="muted">build ${esc(g.build)}</span><span class="spacer"></span>
      <button class="btn small primary" data-gup="align">Alignment</button><button class="btn small ghost" data-gup="ok">OK</button></div>
    <div class="muted" style="font-size:12px;margin-top:4px">Planets and moons need lining up again for this version, so they're back in the alignment jobs. Ships, components and paints are being refreshed for anything new.</div>`; }
document.addEventListener("click",async e=>{ const a=e.target.closest("[data-gup]")?.dataset.gup; if(!a) return;
  await api().game_update_ack(); $("game-update-bar").hidden=true; S.gameUpdSeen=null; if(S.live) S.live.game_update=null;
  S.veh=null; S.vehGalKey=null; S.cpCats=null; S.cpItems=null; S.cpGalKey=null; S.flLiv={};
  if(a==="align"&&typeof openAlign==="function") await openAlign(); });
async function renderUpdateBar(force){ const b=$("update-bar"), u=S.live?.update;
  if(!u&&!force){ b.hidden=true; return; }
  const st=await api().update_status(), L=st.latest, pr=st.progress||{};
  if(!L?.available||(st.skipped===L.version&&!force)){ b.hidden=true; return; }
  const pct=pr.total?Math.round(pr.done/pr.total*100):null;
  b.hidden=false;
  b.innerHTML=`<div class="row"><b>Quantum ${esc(L.version)} is available</b><span class="muted">you have ${esc(st.current)}</span><span class="spacer"></span>
      ${pr.stage==="downloading"?`<span class="muted">Downloading${pct!=null?` ${pct}%`:"…"}</span>`
       :pr.stage==="verifying"?`<span class="muted">Checking the signature…</span>`
       :pr.stage==="ready"?`<button class="btn small primary" data-up="install">Restart to update</button>`
       :L.can_install?`<button class="btn small primary" data-up="get">Update now</button>`:`<button class="btn small primary" data-ext="${esc(L.url)}">Get it on GitHub</button>`}
      ${pr.stage==="downloading"||pr.stage==="verifying"?"":`<button class="btn small ghost" data-up="later">Later</button>`}</div>
    ${pr.stage==="downloading"?`<div class="bar"><i style="width:${pct??30}%"></i></div>`:""}
    ${pr.stage==="error"?`<div class="warnbox" style="margin:8px 0 0">${esc(pr.error)}</div>`:""}
    ${!L.can_install&&L.why_not?`<div class="muted" style="font-size:12px;margin-top:6px">${esc(L.why_not)}</div>`:""}
    ${L.notes||L.notes_html?`<details style="margin-top:6px" ${S.notesOpen?"open":""}><summary style="cursor:pointer;color:var(--route-2)">What's new</summary>${L.notes_html?`<div class="notes rel-notes">${L.notes_html}</div>`:`<div class="notes">${esc(L.notes)}</div>`}</details>`:""}`;
  const nd=b.querySelector("details"); if(nd) nd.ontoggle=()=>{ S.notesOpen=nd.open; };
  if(pr.stage==="downloading"||pr.stage==="verifying") setTimeout(()=>renderUpdateBar(true),500); }
$("update-bar").onclick=async e=>{ const ex=e.target.closest("[data-ext]"); if(ex){ api().open_url(ex.dataset.ext); return; }
  const a=e.target.closest("[data-up]")?.dataset.up; if(!a) return;
  if(a==="get"){ const r=await api().update_download(); if(!r.ok) return toast(r.error); return renderUpdateBar(true); }
  if(a==="install"){ $("update-bar").innerHTML=`<b>Restarting into the new version…</b>`; const r=await api().update_install(); if(!r.ok){ toast(r.error); renderUpdateBar(true); } return; }
  if(a==="later"){ const st=await api().update_status(); await api().update_skip(st.latest?.version); $("update-bar").hidden=true; } };

// A centred loading screen: the Quantum mark, an indeterminate bar, and what's happening.
// Line icons used in place of emoji: a camera (take a screenshot) and a picture (view one), drawn like the rest of Quantum's icons
const IC_CAM='<svg class="ic-line" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7.5h3.2l1.6-2.2h6.4l1.6 2.2H20a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8.5a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.4"/></svg>';
const IC_PIC='<svg class="ic-line" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4.5" width="18" height="15" rx="2"/><circle cx="8.8" cy="9.8" r="1.7"/><path d="M3.6 17.2l5.2-4.6 3.9 3.3 2.9-2.4 4.8 4"/></svg>';
// A status beside a Settings heading: Connected in green, Offline or an error in red, Off in grey.
// ---- Quantum account (Settings): sign in with email and password, or through the browser (the code here must
// match the one on the page). Signed in, "Keep my UEX keys in my Quantum account" keeps the keys in step.
function acctHtml(){
  const a=S.acct;
  // Asked when Settings opens, and again every 30 s while it's hidden (the server may open accounts, or the
  // connection may not have been ready the first time)
  if(a===undefined||(a&&!a.available&&Date.now()-(S.acctAt||0)>30000)){ const first=a===undefined; S.acct=a||null; S.acctAt=Date.now();
    api().account_status().then(x=>{ const was=!!(S.acct&&S.acct.available); S.acct=x; S.acctAt=Date.now();
      if(first||x.available!==was) renderDetail(); if(x.flow?.state==="waiting") acctWatch(); }); if(first) return ""; }
  if(!a) return "";
  if(!a.on||!a.available) return "";                 // community features off, or accounts not open on the server yet
  const f=a.flow||{};
  if(f.state==="waiting") return `<div><b>Approve the sign-in in your browser</b></div>
      <div class="muted" style="font-size:12px;margin:4px 0 8px">Quantum opened quantumsc.org. Sign in there (or create an account), and check the page shows this code:</div>
      <div class="acct-code">${esc(f.user_code||"")}</div>
      <div class="row" style="gap:6px;margin-top:8px"><span class="spin-sm"></span><span class="muted" style="font-size:12px">Waiting for you to approve…</span><span class="spacer"></span>
        <button class="btn small ghost" data-a="acctopen">Open the page again</button><button class="btn small ghost" data-a="acctcancel">Cancel</button></div>`;
  if(a.signed_in){
    const link=a.uex?`<div style="margin-top:4px">UEX datarunner: <b>${esc(a.uex)}</b></div>`
      :a.has_secret?`<div class="muted" style="font-size:12px;margin-top:4px">Your UEX name isn't linked yet${a.link_error?` (${esc(String(a.link_error).replace(/_/g," "))})`:""}.
          <button class="btn small ghost" data-a="acctlink">Link it now</button></div>`
      :`<div class="muted" style="font-size:12px;margin-top:4px">Save your UEX Secret Key below and your UEX datarunner name links to this account by itself.</div>`;
    const k=a.keys||{}, site=a.site||"https://quantumsc.org";
    const keys=`<label class="row" style="gap:8px;margin-top:10px;cursor:pointer"><input type="checkbox" data-a="acctkeys" ${k.stored?"checked":""} ${S.acctKeysBusy?"disabled":""}>
        Keep my UEX keys in my Quantum account${S.acctKeysBusy?` <span class="spin-sm"></span>`:""}</label>
      <div class="muted" style="font-size:12px;margin-top:2px">${k.stored
        ?"On: your UEX Bearer Token and Secret Key are kept (encrypted) in your account only. They're never saved on this PC: Quantum gets them from your account each time it starts, on any PC you sign in on."
        :"Off: your UEX keys are saved on this PC only. Turn it on to keep them in your account instead, so nothing is saved here and they fill in on any PC you sign in on."}</div>
      ${k.error?`<div style="color:#ffd38a;font-size:12px;margin-top:4px">${esc(k.error)}</div>`:""}`;
    const fw=a.fleet_web||{};
    const fleetWeb=`<label class="row" style="gap:8px;margin-top:10px;cursor:pointer"><input type="checkbox" data-a="acctfleetweb" ${fw.on?"checked":""} ${S.acctFleetBusy?"disabled":""}>
        Show my fleet and gear loadouts on the website${S.acctFleetBusy?` <span class="spin-sm"></span>`:""}</label>
      <div class="muted" style="font-size:12px;margin-top:2px">${fw.on
        ?`On: a copy of My Fleet (every ship and loadout) and your gear loadouts is kept in your account, so you can see them at ${esc(site.replace(/^https?:\/\//,""))}/fleet when you're signed in. Only you can see it there.${fw.at?` Last sent ${new Date(fw.at*1000).toLocaleString()}.`:""}`
        :"Off: your fleet and gear loadouts stay on this PC only, and the website's copy is removed."}</div>
      ${fw.error?`<div style="color:#ffd38a;font-size:12px;margin-top:4px">${esc(fw.error)}</div>`:""}`;
    return `<div class="row"><span class="dot on"></span><span>Signed in as <b>${esc(a.email||"")}</b></span><span class="spacer"></span>
        <button class="btn small ghost" data-a="acctsignout">Sign out</button></div>${link}${keys}${fleetWeb}
      <div class="muted" style="font-size:12px;margin-top:8px">Manage it at <a data-url="${esc(site)}/account" style="cursor:pointer;text-decoration:underline">${esc(site.replace(/^https?:\/\//,""))}/account</a>.</div>`;
  }
  const err=f.state==="error"?`<div style="color:#ffd38a;font-size:12px;margin-bottom:6px">${esc(f.error||"")}</div>`:"";
  const note=a.note?`<div style="color:#ffd38a;font-size:12px;margin-bottom:6px">${esc(a.note)}</div>`:"";
  const site=a.site||"https://quantumsc.org", lerr=S.acctErr?`<div style="color:#ffd38a;font-size:12px;margin:6px 0 0">${esc(S.acctErr)}${S.acctUnconfirmed
      ?` <a data-url="${esc(site)}/account/login" style="cursor:pointer;text-decoration:underline">Send the link again</a>`:""}</div>`:"";
  const enter=`onkeydown="if(event.key==='Enter'){event.preventDefault();document.querySelector('[data-a=acctlogin]')?.click();}"`;
  return `${note}${err}<div class="muted" style="font-size:12px;margin-bottom:8px">One account for Quantum and quantumsc.org. ${UEX_NEEDS_ACCOUNT?"Sign in to add your UEX keys (trade data, fleet, vehicles, components and datarunning). The map, routes and waypoints work without one.":"Optional: everything in Quantum works without one."}</div>
    <input class="field" id="acct-email" type="email" placeholder="Email" autocomplete="username" value="${esc(S.acctEmail||"")}" oninput="S.acctEmail=this.value" ${enter} style="width:100%;margin-bottom:6px" ${S.acctBusy?"disabled":""}>
    <input class="field" id="acct-pw" type="password" placeholder="Password" autocomplete="current-password" ${enter} style="width:100%" ${S.acctBusy?"disabled":""}>${lerr}
    <div class="row" style="gap:8px;margin-top:8px"><button class="btn small primary" data-a="acctlogin" ${S.acctBusy?"disabled":""}>${S.acctBusy?"Signing in…":"Sign in"}</button>
      <a data-url="${esc(site)}/account/forgot" style="cursor:pointer;font-size:12px;text-decoration:underline">Forgot your password?</a></div>
    <div class="muted" style="font-size:12px;margin-top:10px">New here? <a data-url="${esc(site)}/account/signup" style="cursor:pointer;text-decoration:underline">Create an account</a> on the website (you'll confirm your email), then sign in here.</div>
    <div class="muted" style="font-size:12px;margin-top:6px">Or <a data-a="acctsignin" style="cursor:pointer;text-decoration:underline">sign in with your browser</a> instead, so Quantum never sees your password.</div>`;
}
// ---- What used to be Settings' Trade data (UEX) and Backup sections, now on the Profile page (same ids, same
// actions: settingsAction handles their buttons wherever they are).
function uexSectionInner(){ const lg=S.live?.log||{}; const g=uexGate(); if(g) return g;
  return `        <label class="k st-label" for="s-uex"><span>UEX Bearer Token <span class="muted" style="font-weight:400">(your app's access token)</span></span>${connPill(!lg.uex_token?"none":!S.uexStat?"checking":S.uexStat.ok?"ok":"bad")}</label>
        <div class="row" style="gap:6px"><input class="field" id="s-uex" type="password" value="${esc(S.uexDraft||"")}" oninput="S.uexDraft=this.value" placeholder="${lg.uex_token?"Bearer token saved.":"Paste your UEX Bearer Token"}" title="${lg.uex_token?"Paste a new token to replace the saved one":""}" style="flex:1" autocomplete="off">
          <button class="btn small" data-a="uexsave">Save</button>${lg.uex_token?`<button class="btn small ghost" data-a="uexclear">Remove</button>`:""}</div>
        <div class="muted" style="font-size:12px;margin-top:6px">Prices, stock and trade runs for the Commodities and Trade routes tabs, crowdsourced at UEX.
          Get a token by creating an app at <a data-url="https://uexcorp.space/api/apps" style="cursor:pointer;text-decoration:underline">uexcorp.space/api/apps</a>. ${S.acct?.keys?.stored?"It's also kept in your Quantum account (above).":"It stays on this PC."}</div>
        <div id="uex-status" class="muted" style="font-size:12px;margin-top:6px"></div>
        <label class="k st-label" for="s-drsecret" style="margin-top:14px"><span>UEX Secret Key <span class="muted" style="font-weight:400">(your datarunner key)</span></span>${(()=>{ const k=S.keyStat;
          if(!S.drHasSecret) return connPill("none");
          if(k===undefined){ S.keyStat=null; api().uex_key_status().then(x=>{ S.keyStat=x; renderDetail(); }).catch(()=>{}); }
          return !k?connPill("checking"):k.ok?connPill("ok",`Connected · ${k.username}`):connPill("bad",k.error?"Not accepted":"Not connected",k.error); })()}</label>
        ${!lg.uex_token&&!S.drHasSecret?`<div class="muted" style="font-size:12px;margin:2px 0 6px;color:#ffd38a">Add and save your UEX Bearer Token above first. The Secret Key can't be saved until the token is in.</div>`:""}
        <div class="row" style="gap:6px"><input class="field" id="s-drsecret" type="password" value="${esc(S.drSecretDraft||"")}" oninput="S.drSecretDraft=this.value" placeholder="${S.drHasSecret?"Secret key saved.":!lg.uex_token?"Enter your Bearer Token first":"Paste your UEX Secret Key"}" title="${S.drHasSecret?"Paste a new key to replace the saved one":!lg.uex_token?"Save your UEX Bearer Token first":""}" style="flex:1" autocomplete="off" ${!lg.uex_token&&!S.drHasSecret?"disabled":""}>
          <button class="btn small" data-a="drsecret" ${!lg.uex_token&&!S.drHasSecret?"disabled":""}>Save</button>${S.drHasSecret?`<button class="btn small ghost" data-a="drsecretclear">Remove</button>`:""}</div>
        <div class="muted" style="font-size:12px;margin-top:6px">Required for commodity prices, trade routes, components, vehicles, fleet management, backup, and sign in. Find it in your <a data-url="https://uexcorp.space/account" style="cursor:pointer;text-decoration:underline">UEX profile</a>.</div>
`; }
function backupInner(){ const b=S.bk; if(b===undefined){ S.bk=null; api().backup_status().then(x=>{ S.bk=x; renderDetail(); }); return "Checking…"; }
        if(!b) return "";
        const ago=b.at?fmtAgo(b.at):null;
        const state=!b.on?"Off: community features are turned off."
          :!b.has_key?`<span style="color:#ffd38a">Add your UEX Bearer Token above to turn on backups.</span>`
          :b.off?`Backups are off for this PC.`
          :b.status==="too_large"?`<span style="color:#ffd38a">Your data is larger than a backup can hold.</span>`
          :b.status==="requests_limit_reached"?`<span style="color:#ffd38a">The server is busy with this connection; it'll try again.</span>`
          :b.status==="unreachable"?`<span style="color:#ffd38a">Couldn't reach the Quantum server; it'll try again.</span>`
          :ago?`<span style="color:#9fe0b4">Backed up ${ago}.</span>`:"Not backed up yet; it'll happen within a minute.";
        return `<p style="margin:0 0 8px">Quantum automatically saves a copy of your fleet, component swaps, waypoints, planned trade routes and mapped stations, so you don't lose them if you reinstall or move to a new PC.</p>
          <p style="margin:0 0 8px"><b>It's private.</b> Your backup is locked with your UEX Bearer Token before it leaves this PC. Nobody else can open it, not even the Quantum server, and your token is never sent to it.</p>
          <p style="margin:0"><b>Getting it back:</b> on a new PC or a fresh install, enter the same UEX Bearer Token and everything comes back. <b>Getting a new token?</b> Enter it here on a PC that still has your data first, so your backup moves over to the new token. If you delete your old token at UEX before doing that, the old backup can't be opened.</p>
          <div style="margin-top:8px">${state}</div>
          ${b.on&&b.has_key?(b.off?`<div class="row" style="gap:6px;margin-top:8px"><button class="btn small" data-a="bkon">Turn backups back on</button></div>`
            :`<div class="row" style="gap:6px;margin-top:8px;flex-wrap:wrap"><button class="btn small" data-a="bknow" ${S.bkBusy?"disabled":""}>${S.bkBusy==="save"?"Backing up…":"Back up now"}</button>
            <button class="btn small ghost" data-a="bkrestore" ${S.bkBusy?"disabled":""} title="Adds back anything missing here. Never removes or overwrites anything">${S.bkBusy==="restore"?"Restoring…":"Restore missing items"}</button>
            <button class="btn small ghost" data-a="bkdel" ${S.bkBusy?"disabled":""} style="color:#ffb4b4" title="Removes your backup from the Quantum server and stops backing up">${S.bkDelAsk?"Click again to delete":"Delete my backup"}</button></div>`):""}`;  }
// UEX keys need a Quantum account: the Trade data (UEX) section stays hidden until you're signed in on this PC.
// Set to false to let anyone enter keys without an account again.
const UEX_NEEDS_ACCOUNT=true;
// Returns what to show instead of the UEX section, or "" to show it. Never locks anyone out:
//  - keys already saved on this PC stay visible (so they can be replaced or removed);
//  - with community features off, or accounts not open / the server unreachable, the section shows as before,
//    so Quantum still works when the Quantum server is down.
function uexGate(){ if(!UEX_NEEDS_ACCOUNT) return "";
  const a=S.acct, lg=S.live?.log||{};
  if(lg.uex_token||S.drHasSecret) return "";
  // Still asking the server: wait a few seconds, then show the section rather than hide it behind a check that never answers
  if(a===undefined||a===null) return Date.now()-(S.acctAt||0)<8000?`<span class="muted" style="font-size:12px"><span class="spin-sm"></span> Checking your Quantum account…</span>`:"";
  if(!a.on||!a.available||a.signed_in) return "";
  return `<div class="row" style="gap:8px"><span class="dot"></span><b>Sign in to your Quantum account first</b></div>
    <div class="muted" style="font-size:12px;margin-top:6px">Your UEX Bearer Token and Secret Key are added once you're signed in above. If they're already kept in your account, they fill in by themselves.</div>`; }
// UEX keys filled in from the account (after signing in, or turning the switch on): refresh what uses them
async function acctKeysArrived(x){
  if(x?.keys?.note) toast(x.keys.note);
  if(!x?.keys?.note&&!(x?.has_token&&!S.live?.log?.uex_token)) return;
  S.bk=undefined; S.mk=null; S.veh=null; S.cpCats=null; S.cpItems=null; S.keyStat=undefined; S.drHasSecret=!!x.has_secret; S.uexDraft=""; S.drSecretDraft="";
  await poll(); try{ await loadStatic(); }catch(e){} fillUexStatus(true); drRefreshAfterKey(); }
function acctWatch(){
  clearTimeout(S.acctT);
  S.acctT=setTimeout(async()=>{ const x=await api().account_status(); const was=S.acct?.flow?.state; S.acct=x;
    if(x.flow?.state==="waiting") acctWatch();
    if(x.flow?.state!==was||x.signed_in){ if(x.flow?.state==="done"){ S.og.mine=null; S.pm.mine=null; toast(`Signed in as ${x.email}`); acctKeysArrived(x).then(()=>{ renderDetail(); pfPrime(true); }); }
      renderDetail(); } },2000);
}
function connPill(st,label,why){ const t={ok:["ok","Connected"],bad:["bad","Not connected"],offline:["bad","Offline"],off:["off","Disabled"],none:["off","Not set"],checking:["wait","Checking…"]}[st]||["off",st];
  return `<span class="conn ${t[0]}" ${why?`title="${esc(why)}"`:""}><i></i>${esc(label||t[1])}</span>`; }
const IC_BOLT='<svg class="ic-line bolt" viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2.5L5 13.5h6l-1 8 8-11h-6z"/></svg>';
// No picture anywhere: anyone with a UEX token can send one in; it shows for everyone once approved.
// A drawn set of plans for blueprints with no picture: still clearly "no picture yet", but it reads as a blueprint
const BP_PLACEHOLDER=`<svg class="bp-ph" viewBox="20 12 112 66" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
  <g fill="none" stroke="currentColor" stroke-width="1.1" stroke-opacity=".75"><path d="M44 18h58l14 14v40H44z"/><path d="M102 18v14h14"/>
  <rect x="54" y="30" width="34" height="22" rx="2"/><circle cx="71" cy="41" r="6"/><path d="M71 30v-4M71 52v4M54 41h-4M88 41h4"/>
  <path d="M54 60h52M54 65h36" stroke-dasharray="3 2"/><path d="M96 46l10 0M101 41v10" stroke-opacity=".5"/></g>
  <g fill="none" stroke="currentColor" stroke-opacity=".35" stroke-width=".8"><path d="M30 26l-6 0 0 40 6 0"/><path d="M122 26l6 0 0 40-6 0"/></g></svg>`;
// Drawn stand-ins for things with no picture yet (commodities, gear, food, ships...), one line drawing per kind on
// a faint grid, like the blueprints: the app looks finished, and "Send a picture" still shows where it can.
const PH_ART={
  commodity:'<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/><path d="M8 5.3l8 4.5"/>',
  weapon:'<path d="M2.5 10.5h13l2-1.5h4v3h-3l-1 1h-2.5l-1.5 4h-3l1-4H8l-1.5 2H4.5l.5-2.5h-2.5z"/><path d="M11 12.5v-2"/>',
  armor:'<path d="M12 3c-4 0-7 2.6-7 7v4l2 3h3l1-3h2l1 3h3l2-3v-4c0-4.4-3-7-7-7z"/><path d="M7 10.5h10M9 10.5v2.5M15 10.5v2.5"/>',
  clothing:'<path d="M8.5 3.5L4 6l1.5 4.5L7.5 10V20.5h9V10l2 .5L20 6l-4.5-2.5c-.6 1.6-1.9 2.5-3.5 2.5s-2.9-.9-3.5-2.5z"/>',
  food:'<g transform="rotate(-28 12 12)"><path d="M3.88 8.6A5 5 0 0 1 8.5 5.5H15.5A5 5 0 0 1 20.12 8.6M3.88 15.4A5 5 0 0 0 8.5 18.5H15.5A5 5 0 0 0 20.12 15.4"/><rect x="1.3" y="8.6" width="21.4" height="3.2" rx="1.6"/><rect x="1.3" y="12.2" width="21.4" height="3.2" rx="1.6"/><path d="M6.8 10.2q.525-.8 1.05 0t1.05 0 t1.05 0 t1.05 0 t1.05 0 t1.05 0 t1.05 0 t1.05 0 t1.05 0M6.8 13.8q.525-.8 1.05 0t1.05 0 t1.05 0 t1.05 0 t1.05 0 t1.05 0 t1.05 0 t1.05 0 t1.05 0"/></g>',   // the double dog: two weenies, one bun, mustard
  drink:'<path d="M9.5 3h5v3l1.5 2.5V20a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V8.5L9.5 6z"/><path d="M8 11h8M8 16h8"/>',
  medical:'<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"/>',
  gadget:'<path d="M14.5 5.5a4 4 0 0 0-5 5L3.5 16.5l3 3 6-6a4 4 0 0 0 5-5l-2.5 2.5-2.5-.5-.5-2.5z"/>',
  key:'<rect x="1.5" y="5" width="21" height="14" rx="2" transform="rotate(-14 12 12)" fill="currentColor" fill-opacity=".3"/>',
  component:'<rect x="6" y="6" width="12" height="12" rx="1.5"/><rect x="9.5" y="9.5" width="5" height="5"/><path d="M9 3v3M12 3v3M15 3v3M9 18v3M12 18v3M15 18v3M3 9h3M3 12h3M3 15h3M18 9h3M18 12h3M18 15h3"/>',
  vehicle:'<path d="M12 1 14.7 4 14.7 4.6 16.1 4.8 15.9 5.4 14.6 5.6 14.5 6.2 14.7 10.4 15 11.2 17.9 14.2 20.6 13.4 20.8 12.7 21.3 12.7 21.3 16.8 20.8 16.8 20.6 15.6 17.9 19.6 17.9 20.3 15.1 22.8 14.1 22.8 13.9 20.1 12.6 20.1 12.5 21.3 11.5 21.3 11.4 20.1 10.1 20.1 9.9 22.8 8.9 22.8 6.1 20.3 6.1 19.6 3.4 15.6 3.2 16.8 2.7 16.8 2.7 12.7 3.2 12.7 3.4 13.4 6.1 14.2 9 11.2 9.3 10.4 9.5 6.2 9.4 5.6 8.1 5.4 7.9 4.8 9.3 4.6 9.3 4z"/>',
  box:'<rect x="4" y="6" width="16" height="13" rx="1.5"/><path d="M4 10h16M10 13.5h4"/>'};
const PH_ART_OF={commodity:"commodity",vehicle:"vehicle",component:"component"};
const PH_LABEL={commodity:"Commodity",weapon:"Weapon",armor:"Armor",clothing:"Clothing",food:"Food",drink:"Drink",medical:"Medical",gadget:"Gadget",key:"Key",pen:"Medical",component:"Component",vehicle:"Ship",box:"Item"};
// CIG's own icons (from the Star Citizen Wiki) for weapons, armor and gadgets: filled, 50×50, in the theme's colour
const PH_CIG={pen:{vb:"0 0 40 40",inner:"<polygon points=\"19.2,16.5 21.4,17.4 21.4,22 19.2,22.8\"/><polygon points=\"21.4,23.5 19.2,24.4 19.2,28.2 21.4,27.3\"/><polygon points=\"24.8,12.1 24.8,26 23.1,26.6 23.1,16 17.4,13.6 17.4,28.8 15.2,29.6 15.2,8.5\"/><polygon points=\"25.2,5.7 25.2,9.7 24.9,10 14.8,6.2 14.8,3.7 16.2,2.4 16.2,0 23.7,0 23.7,4.6\"/><polygon points=\"25.2,28.3 25.2,34.3 23.2,36.3 23.2,38.1 22.1,40 18.2,40 17.1,38.1 17.1,36.3 14.8,34.3 14.8,31.9 24.9,28.1\"/>"},food:{vb:"0 0 256 256",inner:"<path fill-rule=\"evenodd\" d=\"M31.382 216.871C30.354 216.299 29.389 215.438 29.236 214.957C29.084 214.475 29.185 206.132 29.462 196.416C29.738 186.7 30.022 168.73 30.093 156.482L30.221 134.215L29.025 132.482C28.366 131.53 26.44 129.287 24.743 127.5C23.047 125.713 21.262 123.35 20.778 122.25C20.294 121.15 19.662 119.751 19.374 119.142C19.044 118.446 18.98 116.492 19.201 113.892C19.394 111.614 19.758 106.938 20.009 103.5C20.26 100.062 20.702 94.1 20.992 90.25C21.283 86.4 21.754 80.1 22.04 76.25C22.326 72.4 22.715 67.225 22.905 64.75L23.25 60.25L24.875 60.093C26.441 59.942 26.503 60.005 26.571 61.843C26.611 62.892 26.779 73.425 26.946 85.25L27.25 106.75L28.939 106.911C29.867 107 30.846 106.854 31.113 106.587C31.379 106.321 31.796 101.073 32.038 94.926C32.549 81.977 33.445 60.308 33.478 60.125C33.49 60.056 34.251 60 35.168 60L36.836 60L37.425 71.875C37.749 78.406 38.257 88.7 38.553 94.75C39.189 107.765 39.022 107 41.225 107C43.551 107 43.402 108.437 43.787 82.375L44.118 60L45.505 60C47.267 60 47.383 60.452 48.032 69.888C48.31 73.937 48.746 80.062 49 83.5C49.255 86.938 49.705 93.013 50 97C51.618 118.838 51.618 118.843 49.856 122C48.432 124.551 48.079 125.001 44.472 128.876C39.513 134.203 39.732 132.405 40.424 162.143C40.752 176.227 41.016 194.065 41.01 201.782L41 215.814L38.953 216.907C36.433 218.252 33.84 218.24 31.382 216.871ZM231.75 217.159C231.2 217.007 230.098 216.421 229.301 215.855L227.853 214.827L228.18 200.289C228.36 192.292 228.652 176.297 228.827 164.742C229.196 140.529 229.609 142.886 223.896 136.653C221.891 134.465 219.999 132.13 219.692 131.463C219.385 130.796 218.847 129.643 218.496 128.9C217.836 127.504 217.963 122.811 218.986 110.75C219.243 107.725 219.698 102.325 219.997 98.75C220.297 95.175 220.751 89.775 221.005 86.75C221.26 83.725 221.618 79.225 221.802 76.75C222.2 71.402 223.236 68.878 226.155 66.146C228.631 63.828 233.282 61.18 235.657 60.734C239.152 60.079 238.873 54.906 239.21 126.614C239.377 162.164 239.641 196.566 239.796 203.063L240.079 214.876L238.582 215.941C237.054 217.03 233.549 217.654 231.75 217.159ZM124 213.253C121.662 212.921 119.075 212.49 118.25 212.296C117.425 212.102 115.737 211.71 114.5 211.424C108.564 210.053 94.781 203.944 94.083 202.375C93.992 202.169 93.64 202 93.303 202C92.965 202 92.252 201.6 91.719 201.111C91.186 200.623 89.963 199.673 89 199.001C87.366 197.859 86.128 196.808 82.164 193.196C71.428 183.411 63.85 168.875 60.427 151.5C59.592 147.263 59.59 132.253 60.423 128C61.41 122.963 63.331 115.965 64.471 113.25C66.807 107.689 71.446 98.898 72.518 98C72.682 97.862 73.544 96.68 74.435 95.371C76.021 93.039 83.741 84.948 86.798 82.413C96.479 74.385 109.885 68.57 123.384 66.545C138.589 64.264 158.961 68.576 170.84 76.59C171.99 77.365 173.152 78 173.423 78C173.695 78 173.992 78.182 174.083 78.404C174.175 78.626 175.375 79.573 176.75 80.508C178.125 81.442 181.409 84.298 184.047 86.854C186.686 89.409 189.008 91.5 189.207 91.5C189.407 91.5 191.238 90.488 193.276 89.25C195.315 88.013 197.212 87 197.491 87C197.826 87 198 92.488 198 103C198 119.242 197.897 120.142 196.225 118.547C195.964 118.298 194.906 117.623 193.875 117.047C192.121 116.067 190.915 115.382 186.875 113.07C185.981 112.558 184.059 111.433 182.603 110.57C181.147 109.706 179.87 109 179.765 109C179.659 109 177.74 107.875 175.5 106.5C173.26 105.125 171.202 104 170.927 104C170.652 104 170.499 103.64 170.588 103.2C170.737 102.462 173.378 100.69 177.375 98.646C178.269 98.189 179 97.436 179 96.972C179 96.069 173.45 90.694 170.404 88.646C168.318 87.245 167.845 87.374 166.762 89.646C165.277 92.76 163.726 94.298 162.903 93.474C162.502 93.074 161.238 92.297 160.093 91.748C157.443 90.477 157.384 91.015 160.809 85.145C161.953 83.184 161.626 82.848 156.848 81.073C155.144 80.44 153.3 79.74 152.75 79.518C150.168 78.474 144.022 77.126 140.146 76.754L137.043 76.455L136.896 80.353L136.75 84.25L133.125 84.397L129.5 84.544L129.492 81.147C129.482 76.63 129.275 76.373 125.953 76.758C120.283 77.414 109.549 80.32 108.275 81.544C108.014 81.795 107.419 82 106.953 82C105.733 82 105.355 83.454 106.229 84.789C109.044 89.085 109.373 90.971 107.314 91.011C107.004 91.017 106.188 91.462 105.5 92C103.842 93.297 102.377 93.248 101.69 91.871C98.914 86.308 98.802 86.26 95.167 89.064C87.848 94.711 79.028 105 81.508 105C81.787 105 83.24 105.813 84.737 106.807L87.458 108.614L86.104 111.287C85.359 112.758 84.454 114.081 84.091 114.228C83.5 114.467 79.683 112.655 78.147 111.405C77.815 111.135 77.31 111.059 77.024 111.235C76.386 111.629 74 116.759 74 117.735C74 118.123 73.801 118.564 73.558 118.714C73.314 118.865 73.001 119.609 72.86 120.369C72.72 121.128 72.267 123.1 71.854 124.75C70.64 129.595 70 132.974 70 134.538L70 136L74.022 136L78.044 136L77.897 139.625L77.75 143.25L73.875 143.396C70.029 143.541 70 143.552 70.009 144.896C70.048 150.631 74.98 167.5 76.618 167.5C77.036 167.5 80.105 165.88 82.392 164.452C82.976 164.087 83.529 163.892 83.62 164.019C85.029 165.984 87 169.779 86.835 170.209C86.716 170.518 85.336 171.442 83.768 172.261C82.201 173.08 80.722 173.985 80.483 174.272C79.137 175.888 95.596 192.646 97.727 191.828C98.134 191.672 99.17 190.297 100.031 188.772C101.729 185.763 102.518 185.45 104.5 187C105.188 187.538 106.004 187.983 106.314 187.989C107.54 188.013 108.234 189.51 107.537 190.626C106.346 192.534 104.5 195.938 104.5 196.228C104.5 196.478 108.382 198.36 111.25 199.501C116.269 201.498 123.882 203.149 127 202.917L129.25 202.75L129.311 199L129.373 195.25L133.061 195.25L136.75 195.25L136.896 199.125L137.042 203L139.396 203C143.757 203 153.317 200.49 158.875 197.886C161.072 196.856 161.322 196.533 160.541 195.725C160.289 195.464 159.391 193.981 158.545 192.43L157.008 189.61L158.236 188.805C158.912 188.362 159.607 188 159.78 188C159.954 188 160.766 187.522 161.586 186.939C163.314 185.708 163.384 185.758 165.533 189.75C166.421 191.4 167.217 192.833 167.301 192.935C168.056 193.849 178.988 183.988 182.97 178.803C185.546 175.447 185.47 175.087 181.74 172.996C178.858 171.381 178.531 170.563 179.964 168.551C180.534 167.75 181 166.877 181 166.609C181 165.457 182.54 164.784 183.626 165.463C185.474 166.617 188.934 168.5 189.207 168.5C189.945 168.5 193.504 159.149 194.44 154.75C194.732 153.375 195.203 151.194 195.486 149.904C195.769 148.613 196 146.654 196 145.55L196 143.542L192.125 143.396L188.25 143.25L188.103 139.625L187.956 136L192.024 136L196.092 136L195.921 133.125L195.75 130.25L200.827 130.108L205.904 129.966L206.264 134.768C206.654 139.967 206.224 149.386 205.432 153C203.472 161.938 202.579 164.625 199.075 172.121C190.193 191.119 172.544 205.771 151.75 211.408C142.955 213.793 132.626 214.48 124 213.253ZM130.758 148.32C126.169 147.045 123.239 141.761 124.565 137.152C125.977 132.243 128.908 130.599 137.75 129.758C139.4 129.601 142.775 129.247 145.25 128.971C147.725 128.696 151.831 128.252 154.375 127.985C156.919 127.718 161.137 127.275 163.75 127C166.363 126.725 170.581 126.294 173.125 126.042C175.669 125.79 178.706 125.423 179.875 125.228C181.044 125.032 181.992 125.07 181.981 125.311C181.962 125.77 142.123 145.739 137.127 147.793C133.958 149.096 133.644 149.122 130.758 148.32ZM121.201 59.803C121.054 59.419 121.005 58.238 121.092 57.178L121.25 55.25L133 55.25L144.75 55.25L144.901 57.875L145.052 60.5L133.26 60.5C123.635 60.5 121.419 60.372 121.201 59.803ZM116.9 44.192C116.805 39.252 116.936 36.3 117.255 36.178C117.532 36.072 124.845 36.045 133.505 36.118L149.25 36.25L149.25 44L149.25 51.75L133.15 51.882L117.049 52.014L116.9 44.192Z\"/>"},drink:{vb:"0 0 64 64",inner:"<path d=\"M43.8,21.6v1.2H20.2v-1.2c0-3.2,1.5-6.2,4.1-8.1l3.8-2.8V9.1h-2.8V3.3c0-0.4,0.4-0.8,0.8-0.8h11.8 c0.4,0,0.8,0.4,0.8,0.8v5.8h-2.8v1.6l3.8,2.8C42.3,15.4,43.8,18.4,43.8,21.6z\"/><path d=\"M20.2,27.1v24.6h23.6V27.1H20.2z M35.2,44.5c-0.9,1-2,1.5-3.2,1.5c-1.2,0-2.4-0.5-3.2-1.5 c-0.7-0.8-1.1-1.8-1.1-2.9c0-0.7,0.2-1.5,0.6-2.1l3.8-6.6l3.7,6.6C36.7,41.1,36.4,43.1,35.2,44.5z\"/><path d=\"M43.8,56.1v2.7c0,1.5-1.2,2.7-2.7,2.7H22.9c-1.5,0-2.7-1.2-2.7-2.7v-2.7H43.8z\"/>"},key:{vb:"-132 -27 548 548",inner:'<g transform="rotate(-14 142 247)"><g><path d="M276.3,0.2H8.4C4,0.2,0.5,3.7,0.5,8.1v478c0,4.4,3.5,7.9,7.9,7.9h230.8c2.1,0,4.2-0.9,5.6-2.4l37.1-38 c1.4-1.5,2.3-3.5,2.3-5.5V8.1C284.2,3.7,280.6,0.2,276.3,0.2z M9.2,17.5c0-3.7,3.1-7.6,7-7.6h250.9c3.9,0,8,4,8,7.6v27.6 c0,3.7-4.1,7.6-8,7.6H16.2c-3.9,0-7-4-7-7.6V17.5z M275.2,443.2c0,2.9-1.1,5.7-3.2,7.8l-30.1,30.7c-2.1,2.1-4.9,3.3-7.9,3.3H13.5 c-2.3,0-4.1-1.8-4.1-4.1V88.7c0-4.5,3.7-8.2,8.2-8.1l26.6,0.1c1.7,0,3.4,0.7,4.6,1.9l15.3,14.9c4,4,9.4,6.2,15.1,6.2H266 c5.1,0,9.2,4.1,9.2,9.2V443.2z"/></g></g>'},weapon:{vb:"0 0 50 50",inner:'<path d="M50 9.5v-.9l-1.7-1.1h-2.2c0 .2-.2.4-.4.4h-2.5c-.2 0-.4-.2-.4-.4H31.1l.1.5h-8.5l-.6-.5H4.5L1.7 9.1c-.3.2-.5.4-.7.7l-.7 1.5V14l.7.8v1.1l5 2.3s1.2 2.5-.8 6-3.4 4.6-5 12.5c0 0-.8 3 1 3.7 0 0-.1.5.3.8l-.3.9s0 .3 1.5.4 7.8 0 7.8 0 2.7-.1 2.7-2.1l.5-2.2s-.7-.5-.2-2.5c.5-2 1.4-4.8 1.4-4.8s.2-1.2 1.3-1.7.4-1.1.4-1.1-.4-1.5.6-3.6l.4-.8s2.1-1.5 4.2.1h6.6l4.4-4.8 2.3-.7h11.4l.3-.4h.2l.5-.5h.7s.8-.1.8-1.1l-.1-2.3h.2l.5-1.3-.2-.2V12l-.2-.3s.5-.6.5-1.4l.3-.8zm-22.3 6.4 2.5 2.1-.2 2.4-1.8 2.1h-3.6l.1-.4-.1-.4s-2.5-1.1-1.9-5.8h5z"/>'},armor:{vb:"0 0 20 26",inner:"<polygon points=\"4.4,20.3 2.3,18.6 3.2,24 4.9,24.9\"/><polygon points=\"16.3,2.7 17.6,4 19.6,1.5 18.3,0.2\"/><g><polygon points=\"14.3,18.5 18.2,15.7 18.7,13.8 17.1,15.2 10.7,13.8 9.5,13.8 3.1,15.3 1.6,14 2,15.8 5.8,18.5 6.5,25.5 7.5,26 12.7,26 13.6,25.6\"/><polygon points=\"15.8,20.2 15.4,24.8 17,24 17.9,18.7\"/></g><g><polygon points=\"2.6,4.2 4.1,2.7 2.9,1.2 2.9,1.2 1.9,0 0.4,1.5 1.6,2.9 1.6,2.9\"/></g><path d=\"M19.1,4.1L17.4,6l-3-3L16.1,1h-3.3H7.4H4.2l1.6,2L2.7,6.1L1.1,4.2l-1,5.8l1,1.3l0,0.1l2.1,1.8l6.1-1.4h1.6 l6.1,1.4l2.1-1.8l0-0.1l1-1.3L19.1,4.1z M12,3.9H8.2L6.9,2.2l6.3,0L12,3.9z\"/>"},
  gadget:{vb:"0 0 50 50",inner:'<path d="M24.8 16.2c-1.2.4-2.3 1-3.2 1.9-.8.8-1.4 1.7-1.8 2.7s-.5 2-.5 3.1c.1 1.2-.3 2.3-1.1 3.1L1 44.3c-.6.6-1 1.4-1 2.4 0 .9.3 1.7 1 2.3.6.6 1.4 1 2.4 1 .9 0 1.7-.3 2.3-1l16.6-16.6c1.2-1.2 2.3-1.6 3.4-1.5 1.2.2 2.4.1 3.5-.2 1.2-.4 2.2-1 3.1-1.9 1-1 1.6-2.1 2-3.5.3-1.3.3-2.6 0-3.9 0-.2-.1-.3-.2-.3-.1-.1-.3 0-.5.1L30.8 24c-.5.5-1.1.7-1.8.7s-1.3-.2-1.8-.7L26 23c-.5-.5-.7-1.1-.7-1.8s.2-1.3.7-1.8l2.7-2.7c.4-.4.3-.6-.3-.7-1.3-.2-2.5-.2-3.6.2m-4.5 12.3c.2-.2.5-.3.8-.3s.6.1.8.3c.2.2.3.5.3.8s-.1.6-.3.8L4.7 47.2c-.2.2-.5.3-.8.3s-.6-.1-.8-.3-.3-.5-.3-.8.1-.6.3-.8l17.2-17.1M45.4 9.2c0-.2-.1-.4-.2-.6l-3.8-3.8c-.1-.1-.3-.2-.5-.2s-.4.1-.6.2l-3 3c-2.1-1.4-4.4-2.3-6.9-2.8V.8c0-.2-.1-.4-.2-.5-.2-.2-.3-.2-.6-.2h-5.4c-.2 0-.4.1-.5.2-.2.1-.2.3-.2.5v4.3c-2.5.6-4.7 1.5-6.8 2.9l-3.1-3.1c-.1-.1-.3-.2-.5-.2s-.4.1-.6.2L8.7 8.7c-.1.1-.2.3-.2.5s.1.4.2.6l3.1 3.1C10.4 15 9.5 17.2 9 19.6H4.6c-.2 0-.4.1-.5.2-.1.2-.2.4-.2.6v5.4c0 .2.1.4.2.6.1.1.3.2.5.2h4.5c.3 1.5.8 3 1.4 4.3l3.9-3.9c-.7-2.3-.8-4.6-.2-7s1.7-4.5 3.5-6.2c2.6-2.6 5.7-3.8 9.3-3.8s6.7 1.3 9.3 3.8c2.6 2.6 3.9 5.7 3.9 9.3s-1.3 6.7-3.9 9.3c-1.8 1.8-3.9 2.9-6.3 3.5s-4.7.5-7-.3l-3.9 3.9c1.4.7 2.9 1.2 4.4 1.5v4.4c0 .2.1.4.2.6.2.1.3.2.5.2h5.4c.2 0 .4-.1.6-.2.1-.2.2-.3.2-.6V41c2.5-.5 4.8-1.4 6.8-2.8l3.1 3c.2.2.3.2.6.2s.4-.1.5-.2l3.8-3.8c.2-.2.2-.3.2-.6s-.1-.4-.2-.6l-3-3c1.4-2.1 2.4-4.3 2.9-6.9h4.2c.2 0 .4-.1.6-.2.2-.2.2-.3.2-.6v-5.4c0-.2-.1-.4-.2-.5-.2-.2-.3-.2-.6-.2H45c-.5-2.4-1.4-4.7-2.9-6.9l3-3c.2.1.3 0 .3-.3z"/>'}};
function phSvg(art){ const c=PH_CIG[art];
  if(c) return `<svg class="ph-art-ic ph-cig" viewBox="${esc(c.vb)}" aria-hidden="true">${c.inner}</svg>`;
  return `<svg class="ph-art-ic" viewBox="0 0 24 24" aria-hidden="true">${PH_ART[art]||PH_ART.box}</svg>`; }
// For a grid card: the drawing alone (the card says what it is)
function phCard(art){ return `<span class="ph-art">${phSvg(art)}</span>`; }
// The kind of drawing for a piece of gear, by its tab and what it is
// medical pens and injectors (MedPen, AdrenaPen, BoostPen, OxyPen, the Drema Injector…) get the game's consumable icon;
// other medical items (med guns, devices) the cross
function grArt(kind,i){ if(kind==="consumables") return i?.kind==="Drink"?"drink":i?.kind==="Medical"?(/pens?\b|inject|stim\b|syringe/i.test(i?.name||"")?"pen":"medical"):"food";
  return {weapons:"weapon",attachments:"weapon",armor:"armor",clothing:"clothing",gadgets:"gadget",utility:"key"}[kind]||"box"; }
function picMissing(kind,name,bp){ const can=!!S.live?.log?.uex_token;
  if(bp===true) return `<div class="pic-none bp bp-grid-bg">${BP_PLACEHOLDER}<span>Blueprint · no picture yet</span>${can?`<button class="btn small" data-photosend="${esc(kind)}" data-photoname="${esc(name)}">Send a picture</button>`:""}</div>`;
  const art=bp||PH_ART_OF[kind]||"box";
  return `<div class="pic-none art ph-grid-bg">${phSvg(art)}<span>${esc(PH_LABEL[art]||"Item")} · no picture yet</span>${can?`<button class="btn small" data-photosend="${esc(kind)}" data-photoname="${esc(name)}">Send a picture</button>`:""}</div>`; }
// A picture that's shown, or "No picture yet". The Quantum server's owner also gets a Replace button on it,
// for a wrong or poor picture (the wiki's included): the new one is live for everyone at once.
function picShown(url,kind,name,bp){ if(!url) return picMissing(kind,name,bp);
  return `<img src="${esc(url)}" alt="" referrerpolicy="no-referrer">${S.owner?`<button class="btn small pic-replace" data-photosend="${esc(kind)}" data-photoname="${esc(name)}" data-replace="1" title="Put your own picture in place of this one, for everyone">Replace picture</button>`:""}`; }
// Asked once: are you the server's owner (signed in)? Pictures already on screen get their Replace button.
async function ownerCheck(){ if(S.ownerAsked) return; S.ownerAsked=true;
  try{ const r=await api().photo_owner(); S.owner=!!r?.owner; }catch(_){ S.owner=false; } }
// ---- Sending a picture, from a picture job or any item with none: what makes a good one, then the
// screenshot with a 16:9 crop box to frame just the ship or part, then "I accept" before it goes. The same
// form is used inline (jobs) and in a dialog.
const PF_MIN_W=1920, PF_MIN_H=1080, PF_CROP_MIN=1280, PF_WHAT={vehicle:"ship or vehicle",component:"component",commodity:"commodity"};
function pfTitle(name){ let t=String(name||"").replace(/\/$/,"").split("/").pop(); try{ t=decodeURIComponent(t); }catch(_){} return t.replace(/_/g," ").trim(); }
function photoFormHtml(kind,name,job,replace){ const what=PF_WHAT[kind]||"item";
  return `<div class="pf" data-pfkind="${esc(kind)}" data-pfname="${esc(name)}" data-pfjob="${esc(job||"")}" data-pfreplace="${replace?1:""}">
    ${replace?`<div class="pf-own">You're replacing the picture everyone sees for <b>${esc(pfTitle(name))}</b>. Yours goes live at once, in place of the wiki's, UEX's or an earlier one; you can undo it from the admin page.</div>`:""}
    <ul class="pf-rules"><li>Take a <b>clear in-game screenshot of the ${what}</b> (${esc(pfTitle(name))}). Then drag the <b>crop box</b> so it frames just the ${what}.</li>
      <li>The screenshot must be at least <b>${PF_MIN_W} × ${PF_MIN_H}</b> (any shape, ultrawide too). The crop is always <b>16:9</b> and at least ${PF_CROP_MIN} × ${PF_CROP_MIN*9/16}.</li>
      ${replace?"":`<li>Every picture is reviewed, and may be declined if other things are visible in it or it isn't clear.</li>`}</ul>
    <div class="pf-shot"><button class="btn small" data-pfpick="1">Choose screenshot</button><span class="pf-msg muted">No screenshot chosen yet</span></div>
    <div class="pf-prev" hidden><div class="pf-stage"><img alt="Your screenshot" draggable="false"><div class="pf-cbox" tabindex="0" aria-label="Crop box: drag to move, arrow keys to nudge">
        <i data-h="nw"></i><i data-h="ne"></i><i data-h="sw"></i><i data-h="se"></i><span class="pf-grid"></span></div></div>
      <div class="pf-ctl"><span class="pf-csize muted"></span><span class="spacer"></span>
        <button class="btn small ghost" data-pfcrop="fit" title="The biggest 16:9 box that fits the screenshot">Largest</button>
        <button class="btn small ghost" data-pfcrop="center" title="Move the box to the middle">Center</button></div>
      <div class="muted" style="font-size:12px">Drag the box to move it, drag a corner to resize it, or scroll over it to zoom. This is exactly what will be sent.</div></div>
    <label class="pf-ok off"><input type="checkbox" data-pfagree disabled> ${replace?"I've checked the crop: use this picture for everyone":"I accept these requirements and have reviewed my crop"}</label>
    <div class="row" style="gap:6px"><button class="btn small primary" data-pfsend="1" disabled>${replace?"Replace picture":"Submit picture"}</button>${job?`<button class="btn small ghost" data-phrelease="1">Let it go</button>`:""}</div></div>`; }
function pfCheck(w,h){ if(w<PF_MIN_W||h<PF_MIN_H) return `It's ${w} × ${h}, smaller than ${PF_MIN_W} × ${PF_MIN_H}`; return ""; }
// The crop, in the screenshot's own pixels: {x, y, w}; its height is always w × 9/16.
function pfCropClamp(f,c){ const W=f._im.naturalWidth, H=f._im.naturalHeight, maxW=Math.min(W,H*16/9);
  const w=Math.max(Math.min(PF_CROP_MIN,maxW),Math.min(maxW,c.w)), h=w*9/16;
  return {w, x:Math.max(0,Math.min(W-w,c.x)), y:Math.max(0,Math.min(H-h,c.y))}; }
function pfCropFit(f){ const W=f._im.naturalWidth, H=f._im.naturalHeight, w=Math.min(W,H*16/9); return {w, x:(W-w)/2, y:(H-w*9/16)/2}; }
function pfDrawCrop(f){ const c=f._crop, im=f._im, box=f.querySelector(".pf-cbox"); if(!c||!im||!box) return;
  const W=im.naturalWidth, H=im.naturalHeight;
  Object.assign(box.style,{left:`${c.x/W*100}%`,top:`${c.y/H*100}%`,width:`${c.w/W*100}%`,height:`${c.w*9/16/H*100}%`});
  const out=Math.min(Math.round(c.w),PF_MIN_W), cs=f.querySelector(".pf-csize");
  cs.innerHTML=`Crop ${Math.round(c.w)} × ${Math.round(c.w*9/16)} · sent at <b>${out} × ${Math.round(out*9/16)}</b>${c.w<PF_MIN_W?` <span style="color:#ffd38a">(a bigger box looks sharper)</span>`:""}`; }
function pfSetCrop(f,c){ f._crop=pfCropClamp(f,c); pfDrawCrop(f); }
// Sent as a JPEG of just the crop, at most 1920 × 1080, so it fits the server's size limit
function pfEncode(im,c){ c=c||{x:0,y:0,w:Math.min(im.naturalWidth,im.naturalHeight*16/9)};
  const ow=Math.round(Math.min(c.w,PF_MIN_W)), oh=Math.round(ow*9/16), cv=document.createElement("canvas");
  cv.width=ow; cv.height=oh; const g=cv.getContext("2d"); g.imageSmoothingQuality="high";
  g.drawImage(im,c.x,c.y,c.w,c.w*9/16,0,0,ow,oh); return cv.toDataURL("image/jpeg",0.9); }
function pfAgreeOff(f){ const cb=f.querySelector("[data-pfagree]"); cb.checked=false; cb.disabled=true; cb.closest("label").classList.add("off"); f.querySelector("[data-pfsend]").disabled=true; }
async function pfPicked(f,file){ const msg=f.querySelector(".pf-msg"), prev=f.querySelector(".pf-prev"), img=prev.querySelector("img");
  f._im=null; f._crop=null; pfAgreeOff(f); if(f._url) URL.revokeObjectURL(f._url); f._url=URL.createObjectURL(file);
  const im=new Image(); im.src=f._url;
  try{ await im.decode(); }catch(_){ msg.className="pf-msg bad"; msg.textContent="That file isn't a picture"; prev.hidden=true; return; }
  const bad=pfCheck(im.naturalWidth,im.naturalHeight);
  msg.className=`pf-msg ${bad?"bad":"good"}`;
  msg.textContent=bad?`${bad}. Choose another screenshot.`:`${im.naturalWidth} × ${im.naturalHeight}. Frame it with the crop box, then tick the box below.`;
  if(bad){ prev.hidden=true; return; }
  img.src=f._url; prev.hidden=false; f._im=im;
  Object.assign(f.querySelector(".pf-stage").style,{aspectRatio:`${im.naturalWidth} / ${im.naturalHeight}`,width:`min(100%, ${Math.round(360*im.naturalWidth/im.naturalHeight)}px)`});
  pfSetCrop(f,pfCropFit(f));
  const cb=f.querySelector("[data-pfagree]"); cb.disabled=false; cb.closest("label").classList.remove("off"); }
// Moving and resizing the crop box with the mouse (or a pen or finger): a corner keeps the opposite one still.
document.addEventListener("pointerdown",e=>{ const box=e.target.closest(".pf-cbox"); if(!box) return; const f=box.closest(".pf"); if(!f?._crop) return;
  e.preventDefault(); const stage=f.querySelector(".pf-stage"), k=f._im.naturalWidth/stage.clientWidth, h=e.target.dataset?.h, c0={...f._crop}, x0=e.clientX, y0=e.clientY;
  box.setPointerCapture?.(e.pointerId); box.classList.add("drag");
  const move=ev=>{ const dx=(ev.clientX-x0)*k, dy=(ev.clientY-y0)*k;
    if(!h) return pfSetCrop(f,{...c0,x:c0.x+dx,y:c0.y+dy});
    const sx=h.includes("e")?1:-1, sy=h.includes("s")?1:-1, dw1=sx*dx, dw2=sy*dy*16/9, d=Math.abs(dw1)>=Math.abs(dw2)?dw1:dw2;   // follow the bigger move
    const W=f._im.naturalWidth, H=f._im.naturalHeight, ax=sx>0?c0.x:c0.x+c0.w, ay=sy>0?c0.y:c0.y+c0.w*9/16;          // the corner that stays put
    const room=Math.min(sx>0?W-ax:ax,(sy>0?H-ay:ay)*16/9), w=Math.max(Math.min(PF_CROP_MIN,room),Math.min(room,c0.w+d));
    f._crop={w, x:sx>0?ax:ax-w, y:sy>0?ay:ay-w*9/16}; pfDrawCrop(f); };
  const up=()=>{ box.classList.remove("drag"); document.removeEventListener("pointermove",move); document.removeEventListener("pointerup",up); };
  document.addEventListener("pointermove",move); document.addEventListener("pointerup",up); });
document.addEventListener("wheel",e=>{ const box=e.target.closest(".pf-cbox"); if(!box) return; const f=box.closest(".pf"); if(!f?._crop) return;
  e.preventDefault(); const c=f._crop, w=c.w*(e.deltaY>0?1.06:1/1.06);
  pfSetCrop(f,{w, x:c.x+(c.w-w)/2, y:c.y+(c.w-w)*9/32}); },{passive:false});
document.addEventListener("keydown",e=>{ const box=e.target.closest?.(".pf-cbox"); if(!box) return; const f=box.closest(".pf"); if(!f?._crop) return;
  const step=e.shiftKey?40:8, d={ArrowLeft:[-step,0],ArrowRight:[step,0],ArrowUp:[0,-step],ArrowDown:[0,step]}[e.key]; if(!d) return;
  e.preventDefault(); pfSetCrop(f,{...f._crop,x:f._crop.x+d[0],y:f._crop.y+d[1]}); });
async function pfSend(f,btn){ const kind=f.dataset.pfkind, name=f.dataset.pfname, replace=!!f.dataset.pfreplace, label=btn.textContent;
  if(!f._im||!f._crop||!f.querySelector("[data-pfagree]").checked) return;
  const data=pfEncode(f._im,f._crop);
  btn.disabled=true; btn.textContent="Sending…";
  try{ const r=await api().photo_submit(kind,name,data,replace);
    if(!r.ok){ toast(r.error||"Couldn't send it"); btn.disabled=false; btn.textContent=label; return; }
    const modal=f.closest(".pf-modal"), origin=modal?._origin; if(modal) closePhotoDialog();
    if(origin?.isConnected){ if(r.approved){ const box=origin.closest(".pic-none, .mkp-img"); const img=Object.assign(document.createElement("img"),{src:data,alt:""});
        if(box?.classList.contains("mkp-img")){ box.querySelector("img")?.remove(); box.prepend(img); } else (box||origin).replaceWith(img); }
      else origin.replaceWith(Object.assign(document.createElement("em"),{textContent:"Thanks! Sent for review",className:"pic-sent"})); }
    toast(replace?"Picture replaced for everyone":r.approved?"Picture live on Quantum for everyone":"Thanks! Your picture was sent for review");
    if(replace){ S.pics=null; S.vehGalKey=null; S.cpGalKey=null; }
    document.dispatchEvent(new CustomEvent("quantum:photosent",{detail:{kind,name}})); }
  catch(err){ toast(err.message); btn.disabled=false; btn.textContent=label; } }
function openPhotoDialog(kind,name,origin,replace){ closePhotoDialog();
  const d=Object.assign(document.createElement("div"),{className:"pf-modal",id:"pf-modal"}); d._origin=origin;
  d.innerHTML=`<div class="pf-box" role="dialog" aria-modal="true" aria-label="${replace?"Replace a picture":"Send a picture"}"><div class="pf-head"><b>${replace?"Replace the picture of":"Send a picture of"} ${esc(pfTitle(name))}</b>
    <button class="btn small ghost" data-pfclose="1" aria-label="Close">✕</button></div>${photoFormHtml(kind,name,"",replace)}</div>`;
  document.body.appendChild(d); d.querySelector("[data-pfpick]").focus(); }
function closePhotoDialog(){ const d=$("pf-modal"); if(!d) return; const f=d.querySelector(".pf"); if(f?._url) URL.revokeObjectURL(f._url); d.remove(); }
// Caught early (capture), so the card or panel the button sits in doesn't also react to the click
document.addEventListener("click",e=>{
  const ps=e.target.closest("[data-photosend]"); if(ps){ e.stopPropagation(); return openPhotoDialog(ps.dataset.photosend,ps.dataset.photoname,ps,!!ps.dataset.replace); }
  if(e.target.id==="pf-modal"||e.target.closest("[data-pfclose]")){ e.stopPropagation(); return closePhotoDialog(); }
  const pk=e.target.closest("[data-pfpick]"); if(pk){ e.stopPropagation(); const f=pk.closest(".pf"), inp=document.createElement("input");
    inp.type="file"; inp.accept="image/png,image/jpeg,image/webp"; inp.onchange=()=>{ if(inp.files[0]) pfPicked(f,inp.files[0]); }; inp.click(); return; }
  const pc=e.target.closest("[data-pfcrop]"); if(pc){ e.stopPropagation(); const f=pc.closest(".pf"); if(!f?._crop) return;
    if(pc.dataset.pfcrop==="fit") return pfSetCrop(f,pfCropFit(f));
    const W=f._im.naturalWidth, H=f._im.naturalHeight, c=f._crop; return pfSetCrop(f,{...c,x:(W-c.w)/2,y:(H-c.w*9/16)/2}); }
  const sd=e.target.closest("[data-pfsend]"); if(sd){ e.stopPropagation(); pfSend(sd.closest(".pf"),sd); } },true);
document.addEventListener("change",e=>{ const cb=e.target.closest?.("[data-pfagree]"); if(!cb) return; const f=cb.closest(".pf");
  f.querySelector("[data-pfsend]").disabled=!(cb.checked&&f._crop); });
document.addEventListener("keydown",e=>{ if(e.key==="Escape"&&$("pf-modal")) closePhotoDialog(); });
// A wiki description: the first paragraph, with the rest behind "More".
function wikiDesc(t,url){ const ps=String(t).split(/\n\s*\n/).map(x=>x.trim()).filter(Boolean); if(!ps.length) return "";
  const first=`<p>${esc(ps[0])}</p>`, rest=ps.slice(1).map(p=>`<p>${esc(p)}</p>`).join("");
  return `${first}${rest?`<details><summary>More</summary>${rest}</details>`:""}<div class="src">From the Star Citizen Wiki</div>`; }
function qPic(){ return `<div class="q-loader small" role="status" aria-label="Loading picture"><div class="bar"><i></i></div></div>`; }
// A ship picture that's loading: the Quantum mark and a bar over it until it's in (no grey half-drawn image).
function picLoading(box,text){ if(!box) return; box.classList.add("pic-wait");
  if(!box.querySelector(".pic-load")) box.insertAdjacentHTML("beforeend",`<div class="pic-load">${qLoader(text||"Loading picture…")}</div>`); }
function picLoaded(box){ if(!box) return; box.classList.remove("pic-wait"); box.querySelector(".pic-load")?.remove(); }
function watchPic(box){ const img=box?.querySelector("img"); if(!img) return;
  if(img.complete&&img.naturalWidth){ picLoaded(box); return; }
  picLoading(box); img.addEventListener("load",()=>picLoaded(box),{once:true}); img.addEventListener("error",()=>picLoaded(box),{once:true}); }
function qLoader(text){ return `<div class="q-loader" role="status" aria-live="polite"><svg viewBox="0 0 64 64" aria-hidden="true"><path d="M46.5 49.5A24 24 0 1 1 55.2 34" fill="none" stroke="url(#qg)" stroke-width="8.5" stroke-linecap="round"/><path d="M33 45l18.5 13.5H40.5z" fill="url(#qg)"/><path d="M6 51C24 45 42 34 62 17c-11 15-27 29-45 36z" fill="#eaf5ff"/></svg>
  <div class="bar"><i></i></div><div class="txt">${esc(text)}</div></div>`; }

// =================================================================== My Fleet → Vehicles and back
// The ship's name opens its page in Vehicles, and the maker's logo opens Vehicles on that maker's ships. Both
// get a "← Back to My Fleet" button that brings you back to the same ship.
function flVeh(uid,r){ const ship=(S.fleet||[]).find(x=>x.uid===uid);
  return (S.veh||[]).find(x=>String(x.id)===String(ship?.vehicle_id))||(S.veh||[]).find(x=>x.full===r?.ship?.full)||null; }
function flMakerLogo(maker){ if(!maker||!makerLogo(maker)) return titleLogo(maker,false);
  return titleLogo(maker,false).replace(/^<span class="hd-logo"/,`<button class="hd-logo" data-flmaker="${esc(maker)}" title="Every ${esc(maker)} vehicle"`).replace(/<\/span>$/,"</button>"); }
async function flToVehicles(vid,maker){ const tab=document.querySelector('.tab[data-tab="vehicles"]');
  if(!tab||tab.hidden) return toast("Vehicles needs your UEX keys: add them in your profile");
  const from={tab:"fleet",label:"My Fleet",uid:S.flSel,top:$("fl-panel").scrollTop,cat:S.vehCat||null,detail:S.vehDetail||null};
  tab.click(); S.vehFrom=from;
  for(let k=0;k<40&&!S.veh;k++) await new Promise(r=>setTimeout(r,250)); if(!S.veh||S.tab!=="vehicles") return;
  S.vehFrom=from; S.vehGalKey=null;
  if(vid){ S.vehDetail=String(vid); }
  else { S.vehDetail=null; S.vehCat={id:"maker:"+maker}; $("vh-gallery").scrollTop=0; }
  renderVehicles(); }
document.addEventListener("click",e=>{ const n=e.target.closest("#fl-panel [data-flveh]"); if(n){ e.preventDefault(); e.stopPropagation(); return flToVehicles(n.dataset.flveh,null); }
  const m=e.target.closest("#fl-panel [data-flmaker]"); if(m){ e.preventDefault(); e.stopPropagation(); return flToVehicles(null,m.dataset.flmaker); } },true);

// =================================================================== Components: search by ship
// Typing a ship's name in the Components search ("cutlass black", "Prospector") lists every part that fits it:
// its slots come from its stock loadout (any ship, not only yours), and a part fits a slot of its kind and size.
// When several ships match ("cutlass"), the closest is shown with the others as chips to switch to.
S.vfit=S.vfit||{};
function cpShipFor(q,redraw){ if(q.length<3) return null;
  if(!S.veh){ if(!S.cpVehP) S.cpVehP=trLoadVehicles().then(()=>{ S.cpVehP=null; redraw(); }); return null; }
  const ql=q.toLowerCase(), words=ql.split(/\s+/).filter(Boolean);
  const L=S.veh.filter(v=>{ if(v.concept) return false; const mk=(v.maker||"").toLowerCase();
    if(words.every(w=>mk.includes(w)||makerAlias(v.maker).toLowerCase().split(/\s+/).includes(w))) return false;   // just a maker ("drake", "RSI"): that's the parts search
    return vhMatch(`${v.full} ${v.aka||""}`,ql); });
  if(!L.length) return null;
  const nm=v=>v.full.toLowerCase(), base=v=>(v.name||"").toLowerCase();
  const rank=v=>nm(v)===ql||base(v)===ql?0:base(v).startsWith(ql)||nm(v).startsWith(ql)?1:2;
  L.sort((a,b)=>rank(a)-rank(b)||a.full.length-b.full.length||a.full.localeCompare(b.full));
  const v=L.find(x=>String(x.id)===String(S.cpShipPick))||L[0];
  let fit=S.vfit[v.id];
  if(fit===undefined){ S.vfit[v.id]=null; api().vehicle_fit_slots(v.id).then(r=>{ S.vfit[v.id]=r||{ok:false}; redraw(); }).catch(()=>{ S.vfit[v.id]={ok:false}; redraw(); }); fit=null; }
  return {v,fit,others:L.filter(x=>x!==v).slice(0,6)}; }
// The parts in the index that fit the ship, grouped by kind of slot: [[label, sizes, count, parts]]
function cpShipParts(sh){ const slots=sh.fit?.slots||{}, slotOf=Object.fromEntries((S.cpCats||[]).map(c=>[String(c.id),c.slot]));
  const G={};
  for(const i of S.cpIndex?.items||[]){ const t=slotOf[String(i.cat)], sl=t&&slots[t]; if(!sl) continue;
    const z=Number(i.size); if(sl.sizes.length&&i.size!=null&&i.size!==""&&!sl.sizes.includes(z)) continue;
    (G[t]=G[t]||{label:sl.label,sizes:sl.sizes,count:sl.count,parts:[]}).parts.push(i); }
  const order=["PowerPlant","Cooler","Shield","QuantumDrive","JumpDrive","WeaponGun","MissileLauncher","Missile","WeaponMining","Radar"];
  return Object.entries(G).sort((a,b)=>(order.indexOf(a[0])+1||99)-(order.indexOf(b[0])+1||99))
    .map(([,g])=>{ g.parts.sort((a,b)=>String(a.size).localeCompare(String(b.size),undefined,{numeric:true})||a.name.localeCompare(b.name)); return g; }); }
const cpSizesTxt=z=>z.length?z.map(x=>`S${x}`).join(", "):"";
function cpShipSide(sh,partBtn){ const chips=sh.others.length?`<div class="cp-ship-chips">${sh.others.map(o=>`<button data-cpship="${esc(String(o.id))}">${esc(o.full)}</button>`).join("")}</div>`:"";
  if(!sh.fit) return `<div class="mk-h">Fits the ${esc(sh.v.full)}</div>${chips}<div class="muted" style="font-size:12.5px;margin:2px 2px 10px">Checking its slots…</div>`;
  if(!sh.fit.ok) return `<div class="mk-h">Fits the ${esc(sh.v.full)}</div>${chips}<div class="muted" style="font-size:12.5px;margin:2px 2px 10px">${esc(sh.fit.error||"Couldn't look up its slots")}</div>`;
  if(!S.cpIndex) return `<div class="mk-h">Fits the ${esc(sh.v.full)}</div>${chips}<div class="muted" style="font-size:12.5px;margin:2px 2px 10px">Searching every category…</div>`;
  const G=cpShipParts(sh), n=G.reduce((t,g)=>t+g.parts.length,0);
  return `<div class="mk-h">Fits the ${esc(sh.v.full)} <span class="muted" style="text-transform:none;letter-spacing:0">${n}</span></div>${chips}
    ${G.map(g=>`<div class="cp-ship-g">${esc(g.label)}s <span>${g.count} slot${g.count===1?"":"s"}${g.sizes.length?` · ${cpSizesTxt(g.sizes)}`:""} · ${g.parts.length}</span></div>${g.parts.slice(0,8).map(partBtn).join("")}${g.parts.length>8?`<div class="muted" style="font-size:12px;margin:2px 2px 6px">${g.parts.length-8} more on the right</div>`:""}`).join("")}`; }
function cpShipPanel(sh){ const G=cpShipParts(sh), n=G.reduce((t,g)=>t+g.parts.length,0);
  const card=i=>`<div class="vg" data-cppart="${esc(i.cat)}|${esc(i.id)}"><div class="ph ph-g" data-pic="${esc(i.wiki||i.name)}">${phCard("component")}</div>
    <div class="tx"><b>${esc(i.name)}</b><span>${i.size?`S${esc(i.size)} · `:""}${i.grade?`${esc(i.grade)} · `:""}${esc(i.maker)}</span><span class="kt">${i.wtype?`${wtIcon(i.wtype)} ${esc(wtLabel(i.wtype))}`:esc(i.cat_name||"")}</span></div></div>`;
  return `<div class="gh"><b>Parts that fit the ${esc(sh.v.full)}</b>${n.toLocaleString()} parts in ${plural(G.length,"kind")} · from its stock slots · click one for its page</div>
    ${G.length?G.map(g=>`<div class="mk-h cp-ship-h">${esc(g.label)}s<span class="muted">${g.count} slot${g.count===1?"":"s"}${g.sizes.length?` · ${cpSizesTxt(g.sizes)}`:""} · ${g.parts.length} part${g.parts.length===1?"":"s"}</span></div>
      <div class="grid">${g.parts.slice(0,60).map(card).join("")}</div>${g.parts.length>60?`<div class="muted" style="font-size:12px;margin:4px 2px 14px">${g.parts.length-60} more: open the category to see them all</div>`:""}`).join("")
      :`<div class="empty">No parts in Quantum's lists fit its slots.</div>`}`; }
