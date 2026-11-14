// Quantum UI: UEX trade data: commodities, price alerts, trade routes, ships and components.
// One of several classic scripts sharing one global scope; index.html loads them in order.
"use strict";
// =================================================================== trade data (UEX)
const money=n=>n==null?"–":`${Math.round(n).toLocaleString()} aUEC`;
const shortMoney=n=>Math.abs(n)>=1e6?`${(n/1e6).toFixed(2)}M`:Math.abs(n)>=1e4?`${Math.round(n/1e3)}k`:Math.round(n).toLocaleString();
const agoTs=ts=>{ if(!ts) return ""; const a=Math.max(0,Date.now()/1000-ts); return a<3600?`${Math.max(1,Math.round(a/60))} min ago`:a<172800?`${Math.round(a/3600)} h ago`:`${Math.round(a/86400)} d ago`; };
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
  renderWatch();
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
      <div class="m">${esc(x.system||"")}${x.scu?` · ${kind==="buy"?"stock":"demand"} ${x.scu.toLocaleString()} SCU`:""}${x.dist!=null?` · ${fmtDist(x.dist)} away`:""}${x.max_box?` · boxes up to ${x.max_box} SCU`:""}${x.community?` · <span class="cm-pill" title="Reported by a Quantum datarunner and checked against UEX's copy of the report. UEX hasn't finished reviewing it yet.">⚡ ${agoTs(x.community.at)}, awaiting UEX review</span>`:x.updated?` · ${agoTs(x.updated)}`:""}</div></div>`).join(""); };
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
  $("mk-panel").innerHTML=`<button class="btn" data-act="mkall" style="margin-bottom:14px">← All commodities</button>
    <div class="mkp-head"><div class="mkp-img" id="mkp-img">${qPic()}</div>
    <div class="hd-main"><div class="hd-title"><div><h2>${esc(c.name)}</h2><div class="sub">${esc(c.kind||"Commodity")}${c.raw?" · raw":""}${c.mineral?" · mineral":""}${c.harvestable?" · harvestable":""}${c.illegal?' · <span style="color:#ffb454">illegal</span>':""}${c.volatile?" · volatile in quantum":""}</div></div></div>
      ${(()=>{ const sp=r.buy[0]&&r.sell[0]?r.sell[0].price-r.buy[0].price:null, ab=avg(r.buy,"price"), av=avg(r.sell,"price");
        return statBlock([{label:"Cheapest buy",value:r.buy[0]?money(r.buy[0].price):"Not sold"},{label:"Best sell",value:r.sell[0]?money(r.sell[0].price):"Not bought"},
            {label:"Best spread",value:sp!=null?`${sp>0?"+":""}${money(sp)}`:"–",tone:sp>0?"good":sp<0?"bad":""}],
          [{label:"Sold at",value:plural(r.buy.length,"terminal")},{label:"Bought at",value:plural(r.sell.length,"terminal")},
           {label:"Average buy",value:ab!=null?money(ab):null},{label:"Average sell",value:av!=null?money(av):null}]); })()}
      <div class="desc" id="mkp-desc" style="margin-top:12px"></div>
      <div class="row" style="gap:8px">${mkOnMap(r,$("mk-sys").value)?`<button class="btn primary" data-act="mkmap" title="Every terminal that buys or sells it, marked on the map">Terminals on map</button>`:""}${r.buy.length||r.sell.length?`<button class="btn ghost" data-act="mkwatch" title="Get told when a terminal's price for it gets low or high enough">🔔 Price alert</button>`:""}${c.wiki?`<button class="btn ghost" data-ext="${esc(c.wiki)}">Wiki</button>`:""}</div></div></div>
    ${rawFirst?`<section id="mkp-src" class="src-sec raw" hidden></section>`:""}
    ${rawFirst&&!r.buy.length&&!r.sell.length?`<div class="muted" style="font-size:12.5px;margin:14px 2px 0">No terminal buys or sells it as it is: ${c.raw?"refine it first, or sell the refined commodity":"it isn't traded at terminals"}.</div>`
    :`<div class="mkp-cols vd-flat"${rawFirst?' style="margin-top:22px"':""}><div class="vd-sec"><div class="mk-h">Buy at <span class="mk-note">cheapest first, per SCU</span></div>${rows(r.buy,"buy")}</div>
      <div class="vd-sec"><div class="mk-h">Sell at <span class="mk-note">best price first, per SCU</span></div>${rows(r.sell,"sell")}</div></div>`}${uexCredit(r.at)}
    ${rawFirst?"":`<section id="mkp-src" class="src-sec" hidden></section>`}`;
  syncMarketPanel();
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
document.addEventListener("click",async e=>{ const a=e.target.closest("[data-mkopen]"); if(!a) return; const k=resKey(a.dataset.mkopen);
  document.querySelector('.tab[data-tab="market"]')?.click();
  for(let i=0;i<40&&!S.mk;i++) await new Promise(r=>setTimeout(r,250)); if(!S.mk) return;
  const c=S.mk.find(x=>resKey(x.name)===k)||S.mk.find(x=>squash(x.name).startsWith(k)); if(!c) return toast(`${a.dataset.mkopen} isn't in UEX's commodity list`);
  $("mk-search").value=c.name; S.mkSel=c; renderMarket(); });
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
    el.innerHTML=el.hidden?"":`<div class="src-head"><div><div class="mk-h" style="margin:0">Where to find it</div><div class="src-sub">${r.ok?"From the planets' and moons' pages on the Star Citizen Wiki.":"Couldn't reach the Star Citizen Wiki just now."}</div></div></div>
      ${how.length?`<div class="mk-h" style="margin:4px 0 8px">How to get it</div>${gatherHtml(how)}`:""}
      ${bodies.length?`<div class="mk-h" style="margin:16px 0 8px">Where</div><div class="src-grid">${bodies.map(b=>{ const bn=wikiBodyName(b.body), om=`OM-1 (${bn})`; return `<div class="src-card"><div class="src-top"><div class="src-nm">${S.bodyMap[bn]?`<a data-showbody="${esc(bn)}">${esc(b.body)}</a>`:esc(b.body)}</div>
        ${S.locMap[om]?`<button class="iconbtn ${S.live?.route?.includes(om)?"added":""}" data-add="${esc(om)}" title="Add ${esc(b.body)} to your route">+</button>`:""}</div>
        <div class="src-meta">${esc(b.system)}${b.caves?" · in caves":""}</div></div>`; }).join("")}</div>`:""}`; return; }
  const t=now()+(S.timeShift||0);
  // how far each place is from you (its own spot, or the planet's surface), so the list can go nearest first
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
      <div class="src-top"><div class="src-nm">${x.place?`<a data-open="${esc(x.place)}">${esc(x.display||x.name)}</a>`:esc(x.display||x.name)}</div>
        <b class="src-pct" title="How likely a deposit here is this">${pct(x)}</b>
        ${x.place?`<button class="iconbtn ${inRoute?"added":""}" data-add="${esc(x.place)}" title="${inRoute?"In your route":`Add ${esc(x.place)} to your route`}">${inRoute?"✓":"+"}</button>`:""}</div>
      <div class="src-bar" aria-hidden="true"><i style="width:${Math.max(3,Math.round((x.chance||0)/top*100))}%"></i></div>
      <div class="src-meta">${esc([x.type,x.parent&&x.parent!==x.system?`near ${x.parent}`:""].filter(Boolean).join(" · "))}${x.dist!=null?` · ${fmtDist(x.dist)} away`:""}
        ${x.body||x.place?`<a class="src-map" data-showbody="${esc(x.body||x.place)}" title="Show it on the map">Map</a>`:""}</div>
      <div class="src-tags">${(x.methods||[]).map(mm=>`<span><i style="background:${col(mm)}"></i>${esc(mm)}</span>`).join("")}${x.quality?`<span>Quality ${x.quality[0]}–${x.quality[1]}</span>`:""}</div></div>`; };
  // grouped by system (yours first), nearest or most likely first inside each
  const groups=[]; for(const x of L){ const k=x.system||"Elsewhere"; let g=groups.find(g=>g.k===k); if(!g) groups.push(g={k,L:[]}); g.L.push(x); }
  groups.sort((a,b)=>(b.k===S.system)-(a.k===S.system));
  const cat=await resCatalog(), how=[...new Set([...methods,...gatherOf(cat,c.name)])]; await trLoadVehicles(); if(!box()) return;
  const counts=Object.fromEntries(systems.map(k=>[k,all.filter(x=>x.system===k).length]));
  el.hidden=false;
  el.innerHTML=`<div class="src-head"><div><div class="mk-h" style="margin:0">Where to find it</div>
      <div class="src-sub">${r.from?`Mined as <b>${esc(r.from)}</b> and refined into ${esc(c.name)}. `:""}From the Star Citizen Wiki's resource data.</div></div>
      <div class="row" style="gap:8px">${canNear?`<div class="seg-mini"><button data-act="mksrcsort" data-v="near" class="${sort==="near"?"on":""}">Nearest</button><button data-act="mksrcsort" data-v="odds" class="${sort==="odds"?"on":""}">Best odds</button></div>`:""}
        ${all.some(x=>x.place||x.body)?`<button class="btn small primary" data-act="mksrcmap" title="Every place it's found, marked on the map">Deposits on map</button>`:""}
        ${all.length>12?`<button class="btn small ghost" data-act="mksrcall">${S.mkSrcAll?"Show fewer":`All ${all.length} places`}</button>`:""}</div></div>
    ${how.length?`<div class="mk-h" style="margin:4px 0 8px">How to get it</div>${gatherHtml(how)}<div class="mk-h" style="margin:16px 0 8px">Where</div>`:""}
    ${statBlock([{label:"Places",value:String(all.length)},{label:"Best odds",value:pct(all.reduce((a,x)=>(x.chance||0)>(a.chance||0)?x:a,all[0]))||"–"},
      {label:"Quality",value:qlo!=null?`${qlo}–${qhi}`:"–"}],[])}
    ${methods.length?`<div class="src-legend">${methods.map(m=>`<span><i style="background:${col(m)}"></i>${esc(m)}</span>`).join("")}</div>`:""}
    ${groups.map(g=>`<div class="src-sys">${esc(g.k)}<span>${plural(counts[g.k]||g.L.length,"place")}</span></div><div class="src-grid">${g.L.map(card).join("")}</div>`).join("")}`; }
function mkSourceMap(){ const d=S.mkData, r=d&&S.mkSrc?.[d.c.name]; if(!r?.sources) return;
  const marks={}; for(const x of r.sources){ const n=x.body||x.place; if(!n||marks[n]) continue;
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
// ---- Price alerts: watch a commodity's price at every terminal and get told when one gets low or high enough.
// The app checks every few minutes (api_watch.py); alerts show here, as a note, and as a Windows notification.
const WL_AGES=[[24,"1 day"],[72,"3 days"],[168,"7 days"],[0,"Any age"]];
function wlLoad(force){ return qFetch("watch",()=>api().watch_list(),{ttl:30000,force}).then(x=>{ if(x?.ok) S.wl=x; return x; }); }
function wlRule(w){ const what=w.side==="buy"?"Buy price":"Sell price", m=[];
  if(w.low) m.push(`≤ ${money(w.low)}`); if(w.high) m.push(`≥ ${money(w.high)}`);
  return `${what} ${m.join(" or ")}${w.system?` · ${esc(w.system)}`:""}`; }
async function renderWatch(force){ const box=$("mk-watch"); if(!box) return;
  await wlLoad(force).catch(()=>{}); const d=S.wl, f=S.wlForm;
  const items=d?.items||[]; if(!items.length&&!f){ box.innerHTML=""; return syncWatchCount(); }
  const hits=items.reduce((a,w)=>a+(w.on?w.hits.length:0),0), open=S.wlOpen!==false||!!f;
  const row=w=>{ const b=w.best, h=w.on?w.hits:[];
    return `<div class="wl-row ${w.on?"":"off"} ${h.length?"hit":""}" data-wlid="${esc(w.id)}">
      <div><b data-wl="open">${esc(w.name)}</b></div>
      <div class="wl-acts"><button class="btn small ghost" data-wl="edit" title="Change the marks">Edit</button><button class="btn small ghost" data-wl="toggle" title="${w.on?"Pause this alert":"Turn this alert back on"}">${w.on?"Pause":"Resume"}</button><button class="btn small ghost" data-wl="del" title="Remove this alert">✕</button></div>
      <div class="m">${wlRule(w)}<br>${!w.on?"Paused":h.length?`<span class="now">At your mark now at ${plural(h.length,"terminal")}</span>`:b?`Best now ${money(b.price)} at ${esc(b.where)}${b.updated?` · ${agoTs(b.updated)}`:""}`:d?.checked?"No terminal has a recent price for it":"Not checked yet"}</div>
      ${h.length?`<ul class="wl-hits">${h.slice(0,4).map(x=>`<li><span>${x.place?`<a data-open="${esc(x.place)}" style="cursor:pointer">${esc(x.where)}</a>`:esc(x.where)}</span><span class="muted">${esc(x.system||"")}${x.updated?` · ${agoTs(x.updated)}`:""}</span><span>${money(x.price)}</span></li>`).join("")}${h.length>4?`<li class="muted">and ${h.length-4} more</li>`:""}</ul>`:""}</div>`; };
  box.innerHTML=`<div class="wl-box"><div class="wl-h" data-wl="fold"><span>${open?"▾":"▸"} Price alerts</span><span class="n ${hits?"hot":""}">${items.length?`${items.length} watched${hits?` · ${hits} at your mark`:""}`:""}</span><span class="sp"></span>
      ${items.length?`<button class="btn small ghost" data-wl="check" title="Check every alert against the latest prices now" ${S.wlBusy?"disabled":""}>${S.wlBusy?"Checking…":"Check now"}</button>`:""}</div>
    ${open?`${items.map(row).join("")}${f?wlFormHtml(f):""}
      ${d?.error?`<div class="muted" style="font-size:12px;margin-top:6px;color:#ffb454">${esc(d.error)}</div>`:d?.checked?`<div class="muted" style="font-size:11.5px;margin-top:6px">Checked ${agoTs(d.checked)}. Checked again every ${Math.round((d.every||300)/60)} minutes while Quantum is open.</div>`:""}`:""}</div>`;
  syncWatchCount(); }
function syncWatchCount(){ const el=$("c-watch"); if(!el) return; const n=(S.wl?.items||[]).reduce((a,w)=>a+(w.on?w.hits.length:0),0);
  el.hidden=!n; el.textContent=n||""; el.title=n?`${plural(n,"terminal")} at a price alert's mark`:""; }
function wlFormHtml(f){ const opt=(v,t,cur)=>`<option value="${v}" ${String(cur)===String(v)?"selected":""}>${t}</option>`;
  return `<div class="wl-form" id="wl-form">
    <div class="full"><b>${f.id?"Change":"New"} alert: ${esc(f.name)}</b></div>
    <span class="k">Watch</span><select class="field" id="wl-side">${opt("buy","What terminals sell it for (buy price)",f.side)}${opt("sell","What terminals pay for it (sell price)",f.side)}</select>
    <span class="k">Low mark</span><input class="field" id="wl-low" inputmode="numeric" placeholder="Alert at or below (aUEC per SCU)" value="${f.low??""}">
    <span class="k">High mark</span><input class="field" id="wl-high" inputmode="numeric" placeholder="Alert at or above (aUEC per SCU)" value="${f.high??""}">
    <span class="k">System</span><select class="field" id="wl-sys">${opt("","Any system",f.system)}${["Stanton","Pyro","Nyx"].map(x=>opt(x,x,f.system)).join("")}</select>
    <span class="k">Prices from</span><select class="field" id="wl-age">${WL_AGES.map(([v,t])=>opt(v,v?`Reported in the last ${t}`:"Any age",f.max_age_h??72)).join("")}</select>
    <div class="hint">${f.hint||""}One alert per terminal when it reaches a mark; it alerts again only after the price has gone back past it.</div>
    <div class="full row" style="gap:6px"><button class="btn small primary" data-wl="save">${f.id?"Save":"Add alert"}</button><button class="btn small ghost" data-wl="cancel">Cancel</button></div></div>`; }
// A new alert for the commodity you're looking at, with marks a little better than today's best prices
function wlNew(c,r){ const buy=r?.buy?.[0]?.price, sell=r?.sell?.[0]?.price, side=buy?"buy":"sell";
  const round=n=>n>=1000?Math.round(n/10)*10:Math.round(n*100)/100;
  S.wlForm={id_commodity:c.id,name:c.name,side,low:side==="buy"&&buy?round(buy*0.95):"",high:side==="sell"&&sell?round(sell*1.05):"",system:$("mk-sys").value||"",max_age_h:72,
    hint:`Today: cheapest to buy ${buy?money(buy):"–"}, best sell ${sell?money(sell):"–"}. `};
  S.wlOpen=true; renderWatch(); $("mk-watch").scrollIntoView({block:"nearest",behavior:"smooth"}); }
function wlFormRead(){ const f=S.wlForm; if(!f) return null;
  return {...f,side:$("wl-side").value,low:$("wl-low").value.replace(/[^\d.]/g,""),high:$("wl-high").value.replace(/[^\d.]/g,""),system:$("wl-sys").value,max_age_h:+$("wl-age").value}; }
$("mk-watch").addEventListener("change",e=>{ if(e.target.id==="wl-side"&&S.wlForm){ const f=wlFormRead(); S.wlForm={...f,low:f.high,high:f.low}; renderWatch(); } });
$("mk-watch").onclick=async e=>{ if(await tradeClick(e)) return; const a=e.target.closest("[data-wl]")?.dataset.wl; if(!a) return;
  const id=e.target.closest("[data-wlid]")?.dataset.wlid, w=(S.wl?.items||[]).find(x=>x.id===id);
  if(a==="fold"&&!e.target.closest("button")){ S.wlOpen=!(S.wlOpen!==false); return renderWatch(); }
  if(a==="check"){ S.wlBusy=true; renderWatch(); try{ const x=await api().watch_check_now(); if(x?.ok){ S.wl=x; qForget("watch"); } }catch(_){} S.wlBusy=false; return renderWatch(true); }
  if(a==="cancel"){ S.wlForm=null; return renderWatch(); }
  if(a==="save"){ const r=await api().watch_save(wlFormRead()); if(r?.ok===false) return toast(r.error);
    toast(S.wlForm?.id?"Price alert saved":`Watching ${S.wlForm?.name}: you'll be told when a terminal reaches your mark`); S.wlForm=null; qForget("watch"); S.wl=r; return renderWatch(); }
  if(!w) return;
  if(a==="open"){ const c=S.mk?.find(x=>x.id===w.id_commodity); if(c){ S.mkSel=c; $("mk-search").value=c.name; renderMarket(); } return; }
  if(a==="edit"){ S.wlForm={...w,hint:""}; return renderWatch(); }
  if(a==="toggle"){ S.wl=await api().watch_toggle(w.id,!w.on); qForget("watch"); return renderWatch(); }
  if(a==="del"){ S.wl=await api().watch_delete(w.id); qForget("watch"); if(S.wlForm?.id===w.id) S.wlForm=null; toast(`Price alert for ${w.name} removed`); return renderWatch(); } };
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
  if(e.target.closest("[data-act=mkwatch]")&&S.mkData) return wlNew(S.mkData.c,S.mkData.r);
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
      <div class="row" style="margin-top:8px;gap:6px">${x.from_place&&x.to_place?`<button class="btn small" data-prev="${i}">Preview</button><button class="btn small primary" data-run="${i}">Add to route</button>`:`<span class="muted" style="font-size:12px">${esc(!x.from_place?x.from:x.to)} isn't on the map yet</span>`}
        <span class="spacer"></span>${x.url?`<button class="btn small ghost" data-ext="${esc(x.url)}">UEX</button>`:""}</div></div>`).join("")+uexCredit(r.at)+`<div id="tr-shared"></div>`;
  S.trRoutes=r.routes; S.trAt=r.at; S.trTotal=r.total; renderSharedRoutes(); }
$("tr-go").onclick=runTrade;
// ---- The ship for a trade run: type any ship. The ships in your fleet are listed first, then every
// other ship with cargo space. Picking one fills in its cargo space.
async function trLoadVehicles(){ if(S.veh) return; try{ const r=await api().uex_vehicles(); if(r.ok){ S.veh=r.vehicles; S.vehAt=r.at; S.vehOpen=S.vehOpen||{}; } }catch(_){} }
function trShipFind(key){ if(!key) return null; if(!key.includes(":")) key=`f:${key}`;          // older saves: a fleet uid
  const id=key.slice(2);
  if(key[0]==="f"){ const x=(S.trFleet||[]).find(x=>String(x.uid)===id); return x&&x.scu>0?{key,label:`${x.full} · ${x.scu} SCU${x.main?" ★":""}`,scu:x.scu}:null; }
  const v=(S.veh||[]).find(v=>String(v.id)===id); return v&&v.scu>0?{key,label:`${v.full} · ${v.scu} SCU`,scu:v.scu}:null; }
function trShipSet(p){ S.trShip=p||null; $("tr-ship").value=p?p.label:""; trPref("ship",p?p.key:""); }
function trShipOptions(q){ q=q.trim().toLowerCase(); const qw=q.split(/[^a-z0-9]+/).filter(Boolean);
  // every word typed, in any order: "mk v", "centaurus mk v" and "rsi const" all find the Constellation Mk V
  const has=t=>{ if(!q) return true; t=t.toLowerCase(); const tw=t.split(/[^a-z0-9]+/);
    return t.includes(q)||qw.every(w=>tw.some(x=>x.startsWith(w))); }, own=new Set(), mine=[], rest=[];
  for(const x of S.trFleet||[]){ own.add(x.vehicle_id); if(x.scu>0&&has(`${x.full} ${x.maker||""}`)) mine.push({key:`f:${x.uid}`,label:`${x.full} · ${x.scu} SCU${x.main?" ★":""}`,scu:x.scu}); }
  for(const v of S.veh||[]) if(v.scu>0&&!v.concept&&!own.has(v.id)&&has(`${v.full} ${v.maker||""} ${v.aka||""}`)) rest.push({key:`v:${v.id}`,label:`${v.full} · ${v.scu} SCU`,scu:v.scu});
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
  await api().add_stops([x.from_place,x.to_place]); setPreview(null); redrawTradeButtons(); await poll();
  toast(`Run added: buy ${x.commodity} at ${x.from_place}, sell at ${x.to_place}`); };
function redrawTradeButtons(){ document.querySelectorAll("#tr-out [data-prev]").forEach(b=>{ const on=+b.dataset.prev===S.previewIdx;
  b.textContent=on?"Previewing":"Preview"; b.classList.toggle("primary",on); b.closest(".tr-card").classList.toggle("hl",on); }); }

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
function vehSpots(list,kind){
  if(!list.length) return `<div class="muted" style="font-size:12.5px;margin:4px 0 8px">${kind==="buy"?"Not sold in game":"Not for rent"}.</div>`;
  const rows=list.map(x=>({x,d:spotDist(x)})), cheap=Math.min(...list.map(x=>x.price??Infinity));
  const near=spotSortPref()==="near"&&rows.length>1;
  if(near) rows.sort((a,b)=>(a.d==null)-(b.d==null)||(a.d??0)-(b.d??0)||(a.x.price??0)-(b.x.price??0));
  const toggle=rows.length>1?`<div class="seg-mini spot-sort" style="margin:2px 0 6px"><button data-spotsort="price" class="${near?"":"on"}">Cheapest first</button><button data-spotsort="near" class="${near?"on":""}" title="${S.live?.player?"From where you are":"Needs your position: type /showlocation in game"}">Closest to me</button></div>`:"";
  return toggle+rows.map(({x,d})=>`<div class="mk-row"><div class="w">${x.place?`<a data-open="${esc(x.place)}">${esc(x.where)}</a>`:esc(x.where)}</div>
    <div class="p ${x.price===cheap?"best":""}">${money(x.price)}${kind==="rent"?`<small class="muted" style="font-weight:500"> /day</small>`:""}</div>
    ${x.place?`<button class="iconbtn" data-add="${esc(x.place)}" title="Add to route">+</button>`:`<span></span>`}
    <div class="m">${x.shop&&x.shop!==x.where?`${esc(x.shop)} · `:""}${esc(x.system||"")}${d!=null?` · ${fmtDist(d)} away`:""}${x.updated?` · ${agoTs(x.updated)}`:""}</div></div>`).join(""); }
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
const VH_OFF={Cargo:"hauler",Exploration:"exploration",Ground:"ground",ship:"hangar"};
const vhIcon=k=>{ if(VH_OFF[k]) return offIcon(VH_OFF[k]); if(String(k).startsWith("brand:")){ const u=S.brands?.[k.slice(6)];      // a maker's own logo, from the wiki
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
    .map(p=>({id:"pad:"+p,name:VH_PAD_NAME[p]||`${p} pad`,icon:"pad",test:v=>!v.ground&&String(v.pad||"").toUpperCase()===p}));
  const makers=[...new Set(V.map(v=>v.maker).filter(Boolean))].sort().map(m=>({id:"maker:"+m,name:m,icon:brandOf(m)?"brand:"+brandOf(m):"maker",test:v=>v.maker===m}));
  const G=[["Everything",[{id:"all",name:"All vehicles",icon:"all",test:()=>true},{id:"buyable",name:"Sold in game",icon:"Cargo",test:v=>v.buy.length>0},
      {id:"rentable",name:"Rentable",icon:"Passenger",test:v=>v.rent.length>0}]],
    ["Ships by role",roles],["Ground vehicles",[{id:"ground",name:"Ground vehicles",icon:"Ground",test:v=>v.ground}]],
    ["Ships by landing pad",pads],["By manufacturer",makers]];
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
  g.innerHTML=`<div class="gh vh-head">${S.vehFrom?`<button class="btn small primary" data-act="vhfrom">← Back to Patch Hub</button>`:""}${all?"":`<button class="btn small" data-vhcat="all" title="Take the filter off: every vehicle">← All vehicles</button>`}<b>${q?`“${esc(q)}”${all?"":` in ${esc(c.name)}`}`:esc(c.name)}</b><span>${L.length} shown · click one for prices and where to get it</span>
      <span class="spacer"></span>${sel("avail",[["","Any"],["buy","Sold in game"],["rent","Rentable"]],S.vehAvail||"")}${sel("sort",[["price","Price: low to high"],["price_desc","Price: high to low"],["scu","Most cargo"],["name","A–Z"]],S.vehSort||"price")}</div>
    ${L.length?`<div class="grid">${L.map(v=>{ const b=v.buy[0], r=v.rent[0];
    return `<div class="vg" data-vg="${v.id}"><div class="ph ph-g">${v.photo?`<img src="${esc(v.photo)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.outerHTML=phCard('vehicle')">`:phCard("vehicle")}</div>
      <div class="tx"><b>${esc(v.full)}</b>${v.aka?`<span class="muted" style="font-size:11.5px">${esc(v.aka)}</span>`:""}<span>${v.concept?`<span style="color:#f2c14e">Concept · not in game yet</span>`:b?money(b.price):r?`Rent ${shortMoney(r.price)}/day`:"Not sold in game"}${v.scu?` · ${v.scu} SCU`:""}</span></div></div>`; }).join("")}</div>`
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
const modBeds=m=>m?.medical_beds?`${m.medical_beds}${modTiers(m)?` (${modTiers(m)})`:""}`:null;
// A vehicle's own page: picture, roles, crew and beds, cargo, size, flight, quantum, defences, weapons.
async function renderVehicleDetail(id){
  const g=$("vh-gallery"), v=S.veh.find(x=>String(x.id)===String(id)); if(!v) return;
  if(g.dataset.detail!==String(id)) g.innerHTML=qLoader(`Loading ${v.full}…`); g.dataset.detail=String(id); g.scrollTop=0;
  S.vdCache=S.vdCache||{}; const d0=S.vdCache[id]||(S.vdCache[id]=await api().vehicle_detail(v.id)); if(S.vehDetail!==String(id)) return;
  // A modular ship: the numbers below are the picked module's (Base by default); the table compares them all
  const M=d0.modules, mod=M?(M.modules.find(x=>x.id===(S.vdMod?.[id]||M.current))||M.modules[0]):null;
  const d=mod?{...d0,scu:mod.scu??d0.scu,medical_beds:mod.medical_beds||null,medical_tier:mod.medical_tier||null,refinery:mod.refinery||null}:d0;
  const scu=mod?d.scu:v.scu;
  const n=x=>x==null||x===""?null:Math.round(x).toLocaleString(), dash=x=>x??"–";
  const sec=(title,rows)=>{ rows=rows.filter(r=>r[1]!=null&&r[1]!==""&&r[1]!==0&&r[1]!=="0"); return rows.length?`<div class="vd-sec"><div class="mk-h">${title}</div>${rows.map(r=>`<div class="vd-row"><span>${r[0]}</span><b>${r[1]}</b></div>`).join("")}</div>`:""; };
  const crew=d.crew_max&&d.crew_max!==d.crew_min?`${d.crew_min}–${d.crew_max}`:d.crew_min;
  const cat=vehCat(), isAll=cat.id==="all";
  g.innerHTML=`<div class="row" style="gap:8px;margin-bottom:14px">${S.vehFrom?`<button class="btn primary" data-act="vhfrom">← Back to Patch Hub</button>`:""}<button class="btn" data-act="vhback">← ${esc(cat.name)}</button>${isAll?"":`<button class="btn ghost" data-act="vhall">All vehicles</button>`}</div>
    <div class="mkp-head"><div class="mkp-img">${picShown(v.photo,"vehicle",v.full)}</div>
      <div class="hd-main"><div class="hd-title"><div><h2>${esc(v.full)}</h2><div class="sub">${esc(v.maker)}${d.career?` · ${esc(d.career)}`:""}</div></div>${titleLogo(v.maker,true)}</div>
        ${v.roles.length?`<div class="tags vd-tags">${v.roles.map(x=>`<span>${esc(x)}</span>`).join("")}</div>`:""}
        ${statBlock([{label:"Buy price",value:v.buy[0]?money(v.buy[0].price):"Not sold"},{label:"Rent price",value:v.rent[0]?`${money(v.rent[0].price)}/day`:"None"},
            {label:"Crew size",value:crew||"–"},{label:"SCU capacity",value:scu?`${Number(scu).toLocaleString()} SCU`:"None"}],
          [{label:"Beds",value:d.beds||null},{label:"Medical beds",value:d.medical_beds||null},{label:"Landing pad",value:d.pad||null}])}
        ${M?`<div class="lv-row" style="margin-top:12px">${modPicker(M,mod.id,"data-vdmod")}<span class="muted" style="font-size:12px">${mod.concept?`<span style="color:#f2c14e">Concept · not in game yet.</span> `:""}${esc(mod.notes||"")}</span></div>`:""}
        <div class="row" style="gap:8px;margin-top:12px">${v.store?`<button class="btn ghost" data-ext="${esc(v.store)}">RSI page</button>`:""}</div></div></div>
    ${M?`<div class="vd-sec vd-mods"><div class="mk-h">Modules</div><table class="mod-t"><thead><tr><th>Module</th><th class="num">Cargo</th><th class="num">Medical beds</th><th class="num">Refinery</th><th>Status</th></tr></thead><tbody>
      ${M.modules.map(m=>`<tr class="${m.id===mod.id?"on":""}" data-vdmod="${esc(m.id)}" title="Show ${esc(v.full)} with this module"><td><b>${esc(m.name)}</b><small>${esc(m.full||"")}</small></td>
        <td class="num">${m.scu?`${Number(m.scu).toLocaleString()} SCU`:"–"}${m.module_scu?`<small>${m.module_scu} in the module</small>`:""}</td>
        <td class="num">${m.medical_beds||"–"}${modTiers(m)?`<small>${esc(modTiers(m))}</small>`:""}</td>
        <td class="num">${m.refinery?`${m.refinery} reactors`:"–"}</td>
        <td>${m.concept?`<span style="color:#f2c14e">Concept</span>`:"In game"}</td></tr>`).join("")}</tbody></table>
      <div class="muted" style="font-size:11.5px;margin-top:8px">Click a module to see the ship with it. Modules are swapped at a port; in My Fleet each loadout can have its own.</div></div>`:""}
    ${d.description?`<div class="desc" style="margin:0 0 14px">${wikiDesc(d.description)}</div>`:""}
    <div class="vd-grid vd-flat">
      ${sec("Crew & living",[["Crew",crew],["Seats",d.seats],["Jump seats",d.jump_seats],["Beds",d.beds],["Medical beds",mod?modBeds(mod):d.medical_beds],["Medical tier",d.medical_tier?`Tier ${d.medical_tier}`:null],["Ejection seats",d.ejection],["Escape pods",d.escape_pods]])}
      ${sec("Cargo & storage",[["Cargo grid",d.scu?`${Number(d.scu).toLocaleString()} SCU`:null],["Refinery",d.refinery?`${d.refinery} refining reactors`:null],["Ore",d.ore?`${d.ore} SCU`:null],["Personal storage",d.storage_scu?`${d.storage_scu} SCU`:null],["Weapon lockers",d.lockers?`${d.lockers} slots`:null],["Landing pad",d.pad]])}
      ${sec("Size",[["Length",d.length&&`${d.length} m`],["Beam",d.beam&&`${d.beam} m`],["Height",d.height&&`${d.height} m`],["Mass",d.mass&&`${n(d.mass)} kg`],["Size class",d.size_class]])}
      ${sec("Flight",[["SCM",d.scm&&`${d.scm} m/s`],["Boost",d.boost&&`${d.boost} m/s`],["Max",d.max&&`${d.max} m/s`],["Pitch / yaw / roll",d.pitch&&`${d.pitch} / ${d.yaw} / ${d.roll} °/s`],["Hydrogen fuel",d.h_fuel&&`${d.h_fuel} SCU`]])}
      ${sec("Quantum",[["Speed",d.qt_speed&&`${fmtBig(d.qt_speed)}/s`],["Range",d.qt_range&&fmtBig(d.qt_range)],["Spool",d.qt_spool&&`${d.qt_spool} s`],["Quantum fuel",d.q_fuel&&`${d.q_fuel} SCU`]])}
      ${sec("Defence",[["Shield HP",n(d.shield)],["Shield type",d.shield_face],["Hull HP",n(d.hull)],["Armor HP",n(d.armor)],["Countermeasures",d.countermeasures],["IR / EM",d.ir&&`${fmtBig(d.ir)} / ${fmtBig(d.em)}`],["Cross-section",n(d.cs)]])}
      ${sec("Weapons",[["Pilot DPS",n(d.dps)],["Missiles",d.missiles],["Missile damage",n(d.missile_dmg)],["Turrets",d.turrets||null]])}
      ${sec("Insurance",[["Claim",d.claim&&`${d.claim} min`],["Expedite",d.expedite&&`${d.expedite} min`]])}
    </div>
    <div id="vd-extra"></div>
    <div class="vd-grid vd-shop vd-flat"><div class="vd-sec"><div class="mk-h">Buy</div>${vehSpots(v.buy,"buy")}</div><div class="vd-sec"><div class="mk-h">Rent</div>${vehSpots(v.rent,"rent")}</div></div>
    <div class="uex-credit">${d.wiki?"Specs from the Star Citizen Wiki (api.star-citizen.wiki); ":"The Star Citizen Wiki has no record for this vehicle. "}roles and prices from UEX.</div>`;
  vehExtras(v); }
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
  const b=box(); if(b) b.innerHTML=out.length?`<div class="vd-grid vd-flat">${out.join("")}</div>`:""; }
$("vh-search").addEventListener("input",()=>{ S.vehDetail=null; renderVehicles(); });

// ---- Components: a landing page of every category first; pick one to browse it with filters, open a
// part for its numbers and shops, and fit it to a ship in My Fleet.
const CP_KEY={Radar:["aim_range","Aim assist"],MissileLauncher:["missiles","Missiles"],WeaponGun:["dps","DPS"],Missile:["missile","Damage"],Shield:["shield_hp","Shield HP"],QuantumDrive:["qt_speed","Quantum speed"],
  Cooler:["coolant_make","Cooling"],PowerPlant:["power","Power output"]};
const CP_ICONS=[   // first match wins, so the specific ones ("Missile Racks") come before the general ("Missiles")
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
const offIcon=k=>OFF_ICONS[k]?`<svg class="ofc" viewBox="0 0 16 16" aria-hidden="true">${OFF_ICONS[k]}</svg>`:"";
// Component categories with a game icon (first match wins, so racks and turrets come before missiles and guns)
const CP_OFF=[[/missile\s*rack|bomb|rack|tube|point\s*defen|pdc|mining|salvage/i,null],[/turret/i,"turrets"],[/quantum\s*fuel/i,"quantumFuelTanks"],[/fuel/i,"fuelTanks"],[/jump/i,"jumpModules"],
  [/quantum/i,"quantumDrives"],[/missile|torpedo/i,"missiles"],[/cooler/i,"coolers"],[/power/i,"powerPlants"],[/shield/i,"shieldGenerator"],
  [/radar|scanner/i,"radar"],[/cargo|container|grid/i,"shipCapacity"],[/utility|tractor/i,"utilityItems"],[/gun|cannon|repeater|weapon/i,"weapons"]];
const cpIcon=c=>{ const t=`${c.name} ${c.section}`, hit=CP_OFF.find(([re])=>re.test(t)); if(hit&&hit[1]) return offIcon(hit[1]); return cpIconDrawn(c); };
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
const wtIcon=k=>`<svg viewBox="0 0 24 24" aria-hidden="true">${WT_ICONS[k]||WT_ICONS.other}</svg>`;
const WT_DEFAULT=[["distortion","Distortion"],["scattergun","Scatterguns"],["gatling","Gatlings"],["repeater","Repeaters"],["cannon","Cannons"],["beam","Beams"],["massdriver","Mass drivers"],["other","Other guns"]];
const wtTypes=()=>S.cpIndex?.types||S.cpTypes||WT_DEFAULT;
const wtLabel=k=>(wtTypes().find(t=>t[0]===k)||[k,"Guns"])[1];
// How many guns of each kind a category has, once the index of every part is in (else null)
const wtCounts=catId=>{ if(!S.cpIndex) return null; const n={}; for(const i of S.cpIndex.items) if(String(i.cat)===String(catId)&&i.wtype) n[i.wtype]=(n[i.wtype]||0)+1; return n; };
// The index of every part in every category, for the search on the Components home. Loaded once, in the background.
async function cpLoadIndex(){ if(S.cpIndex||S.cpIndexP) return S.cpIndexP;
  S.cpIndexP=api().uex_component_index().then(r=>{ if(r?.ok) S.cpIndex=r; S.cpIndexP=null; return S.cpIndex; }).catch(()=>{ S.cpIndexP=null; return null; });
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
  const parts=cpSearchAll(q), searching=q.length>=2;
  // a gun category is shown with its kinds under it: Repeaters, Cannons, Distortion…
  const kinds=c=>{ if(c.slot!=="WeaponGun") return []; const n=wtCounts(c.id); return wtTypes().filter(([k])=>!n||n[k]); };
  const partBtn=i=>`<button class="cp-nav part" data-cppart="${esc(i.cat)}|${esc(i.id)}"><span class="ic">${i.wtype?wtIcon(i.wtype):cpIcon({name:i.cat_name||"",section:""})}</span><span class="t">${esc(i.name)}<small>${esc(i.cat_name||"")}${i.size?` · S${esc(i.size)}`:""}${i.maker?` · ${esc(i.maker)}`:""}</small></span><i>›</i></button>`;
  $("cp-home-list").innerHTML=(searching?`<div class="mk-h">Parts ${S.cpIndex?`<span class="muted" style="text-transform:none;letter-spacing:0">${parts.length}</span>`:""}</div>`
      +(S.cpIndex?(parts.length?parts.slice(0,40).map(partBtn).join("")+(parts.length>40?`<div class="muted" style="font-size:12px;margin:4px 2px 8px">${parts.length-40} more on the right</div>`:"")
        :`<div class="muted" style="font-size:12.5px;margin:2px 2px 10px">No part matches “${esc(q)}”</div>`)
        :`<div class="muted" style="font-size:12.5px;margin:2px 2px 10px">Searching every category…</div>`):"")
    +(G.length?G.map(([sec,L])=>`<div class="mk-h">${esc(sec)}</div>${L.map(c=>`<button class="cp-nav" data-cpcat="${c.id}"><span class="ic">${cpIcon(c)}</span><span class="t">${esc(c.name)}</span><i>›</i></button>`
        +kinds(c).map(([k,lab])=>`<button class="cp-nav sub" data-cpcat="${c.id}" data-wtype="${k}"><span class="ic">${wtIcon(k)}</span><span class="t">${esc(lab)}</span><i>›</i></button>`).join("")).join("")}`).join("")
      :searching?"":`<div class="empty">No category matches “${esc(q)}”</div>`);
  const fl=await api().fleet_list(); if(S.cpCat) return; const main=fl.ships.find(x=>x.main);
  const tile=c=>`<button class="cp-tile" data-cpcat="${c.id}"><span class="ic">${cpIcon(c)}</span><span><b>${esc(c.name)}</b><small>${c.slot?"Browse, buy and fit to My Fleet":"Browse and buy"}</small></span></button>`;
  const ktile=(c,k,lab)=>{ const n=wtCounts(c.id)?.[k]; return `<button class="cp-tile wt" data-cpcat="${c.id}" data-wtype="${k}"><span class="ic">${wtIcon(k)}</span><span><b>${esc(lab)}</b><small>${n?`${n} gun${n===1?"":"s"}`:"Ship guns"}</small></span></button>`; };
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
  const L=S.cpItems.filter(i=>(!wt||i.wtype===wt)&&(!q||(t=>cpQueryHit(t,q))(`${i.name} ${i.aka||""} ${i.maker} ${i.game?.maker||""} ${makerAlias(i.game?.maker||i.maker)} ${i.wtype?wtLabel(i.wtype):""}`.toLowerCase()))&&(!size||cpSize(i)===size)&&(!grade||cpGrade(i)===grade)
    &&(!maker||(i.game?.maker||i.maker)===maker)&&(avail!=="buy"||i.buy.length)&&(avail!=="noshop"||!i.buy.length)&&(!fits||fits.has(cpSize(i))));
  const price=i=>i.buy[0]?.price??null, key=CP_KEY[S.cpCat?.slot]?.[0], kv=i=>+(i.game?.stats?.[key])||null;
  const by={price:(a,b)=>(price(a)==null)-(price(b)==null)||(price(a)??0)-(price(b)??0),
    price_desc:(a,b)=>(price(a)==null)-(price(b)==null)||(price(b)??0)-(price(a)??0),
    size:(a,b)=>cpSize(a).localeCompare(cpSize(b),undefined,{numeric:true})||(a.name||"").localeCompare(b.name||""),
    name:(a,b)=>(a.name||"").localeCompare(b.name||""), key:(a,b)=>(kv(a)==null)-(kv(b)==null)||(kv(b)??0)-(kv(a)??0)}[sort];
  if(by) L.sort(by); return {L, fits, ship}; }
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
  const {L,fits,ship}=cpFiltered(), any=["cp-search","cp-size","cp-grade","cp-maker","cp-avail","cp-ship","cp-wtype"].some(k=>$(k).value);
  const sel=S.cpItems.find(i=>String(i.id)===String(S.cpSel));
  $("cp-reset").hidden=!any;
  const q=$("cp-search").value.trim().toLowerCase(), elsewhere=q.length>=2?cpSearchAll(q).filter(i=>String(i.cat)!==String(S.cpCat.id)).length:0;
  if(q.length>=2&&!S.cpIndex) cpLoadIndex().then(ix=>{ if(ix&&S.cpItems&&$("cp-search").value.trim().toLowerCase()===q) renderComponents(); });
  $("cp-count").innerHTML=`${L.length} of ${S.cpItems.length} · click one for its page${elsewhere?` · <a data-cpall="1" style="cursor:pointer;text-decoration:underline">${elsewhere} more in other categories</a>`:""}`;
  const why=ship&&fits&&!fits.size?`<div class="unknown" style="margin:8px 0">${esc(S.cpFit.ships.find(s=>s.uid===ship)?.error||`That ship has no ${S.cpFit.label?.toLowerCase()||""} slots.`)}</div>`:"";
  $("cp-out").innerHTML=(sel?cpCard(sel,true):"")+why+(L.length?L.slice(0,200).map(i=>cpCard(i,false)).join(""):`<div class="empty">Nothing matches these filters.<br><br><button class="btn small" data-cpreset="1">Clear filters</button></div>`)+uexCredit(S.cpAt);
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
  g.innerHTML=`<button class="btn" data-act="cpback" style="margin-bottom:14px">← All ${esc(S.cpCat?.name||"components")}</button>
    <div class="mkp-head"><div class="mkp-img" id="cpd-img">${qPic()}</div>
      <div class="hd-main"><div class="hd-title"><div><h2>${esc(i.name)}</h2><div class="sub">${esc(gm.maker||i.maker)}${i.vehicle?` · for ${esc(i.vehicle)}`:""}</div></div>${titleLogo(gm.maker||i.maker,false,true)}</div>
        <div class="cp-fits" id="cpd-fits">${cpFitsBadges(i)}</div>
        ${statBlock([{label:"Size",value:cpSize(i)?`S${cpSize(i)}`:"–"},{label:"Grade",value:cpGrade(i)||"–"},{label:"Class",value:gm.class||"–"},
            {label:"Price",value:i.buy[0]?money(i.buy[0].price):"Not in shops"}],
          [{label:"Sold at",value:i.buy.length?plural(i.buy.length,"shop"):null},...(()=>{ const k=(CP_KEY[S.cpCat?.slot]||[])[0], f=CP_STATS.find(x=>x[0]===k);
            return f&&st[k]!=null?[{label:f[1],value:f[2](st[k])}]:[]; })()])}
        <div class="row" style="gap:8px;margin-top:12px">${i.buy.length?cartBtn({name:i.name,kind:"component",uuid:i.uuid||null,uex_id:typeof i.id==="number"?i.id:null},"Add to cart"):""}${i.wiki?`<button class="btn ghost" data-ext="${esc(i.wiki)}">Wiki</button>`:""}${i.store?`<button class="btn ghost" data-ext="${esc(i.store)}">RSI page</button>`:""}</div></div></div>
    ${typeof i.note==="string"&&i.note?`<div class="unknown" style="margin-bottom:12px">${esc(i.note)}</div>`:""}
    <div class="vd-grid vd-flat">${rows?`<div class="vd-sec"><div class="mk-h">Stats</div>${rows}</div>`:`<div class="vd-sec"><div class="mk-h">Stats</div><div class="muted" style="font-size:13px;padding:6px 0">No game-file numbers for this one.</div></div>`}
      <div class="vd-sec"><div class="mk-h">Where to buy</div>${i.buy.length?vehSpots(i.buy,"buy"):`<div class="muted" style="font-size:13px;padding:6px 0;line-height:1.5">No shop sells this as far as UEX knows. It comes as loot, from crafting, or fitted stock on a ship.</div>`}</div>
      <div class="vd-sec cp-fit" id="cpd-fit"><div class="mk-h">Fit to a ship in My Fleet</div><div class="muted" style="font-size:13px">Checking your ships…</div></div></div>
    <div class="uex-credit">${i.game?"Numbers from the game files; ":""}prices from UEX; picture from the Star Citizen Wiki; ship slots from the Star Citizen Wiki.</div>`;
  g.scrollTop=0; renderCpFit(i);
  const img=await api().wiki_image(i.wiki||i.name); if(String(S.cpDetail)!==String(id)) return;
  const box=$("cpd-img"); if(box) box.innerHTML=picShown(img||i.image||null,"component",i.wiki||i.name); }
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
$("cp-home").onclick=async e=>{ if(await tradeClick(e)) return; const pt=e.target.closest("[data-cppart]"); if(pt) return openCpPart(pt.dataset.cppart);
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
// My Fleet's slot groups: the game's icon for each kind of part (mining lasers get the drawn one)
const SLOT_OFF={MissileLauncher:"missiles",PowerPlant:"powerPlants",Cooler:"coolers",Shield:"shieldGenerator",QuantumDrive:"quantumDrives",JumpDrive:"jumpModules",Radar:"radar",WeaponGun:"weapons",Missile:"missiles"};
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
  const groups={}; for(const sl of r.slots) (groups[sl.label]=groups[sl.label]||[]).push(sl);
  const card=sl=>{ const k=KEY_FOR[sl.type], stats=sl.fitted?(sl.fitted_stats||{}):(sl.stock?.stats||{}), grade=sl.fitted?sl.fitted_grade:sl.stock?.grade,
      maker=sl.fitted?sl.fitted_maker:sl.stock?.maker, val=k&&stats[k], stockVal=k&&sl.stock?.stats?.[k], open=S.flSlot===sl.port;
    // One row per slot: size and grade, the part and its maker, its key number, and Change
    return `<div class="slot ${sl.fitted?"fit":""} ${open?"open":""}">
      <div class="top"><span class="sz" title="Size ${esc(sl.size??"?")}">S${esc(sl.size??"?")}</span><span class="gr" title="${grade?`Grade ${esc(grade)}`:"No grade"}">${esc(grade||"–")}</span>
        <div class="nm"><b title="${esc(sl.fitted||sl.stock?.name||"")}">${esc(sl.fitted||sl.stock?.name||"Empty")}</b><span>${esc(maker||"")}${sl.rack_name?` · on ${esc(sl.rack_name)}`:sl.where?` · ${esc(sl.where)}`:""}${stats.em!=null?` · EM ${fmtBig(stats.em)}`:""}${qdTimes(stats)}${sl.type==="Shield"?shRegen(stats):""}${sl.fitted?` · <em class="swap">swapped from ${esc(sl.stock?.name||"none")}</em>`:""}</span></div>
        ${val?`<div class="val"><b>${ITEM_STAT[k][1](val,stats)}${sl.fitted&&stockVal&&k!=="missiles"?deltaTxt(val-stockVal,ITEM_STAT[k][1]):""}</b><span>${ITEM_STAT[k][0]}</span></div>`:`<div class="val"></div>`}
        <div class="acts">${sl.fitted&&!String(sl.fitted).endsWith(" (stock)")?cartBtn({name:sl.fitted,kind:"component",source:r.ship.full}):""}${sl.fitted?`<button class="btn small ghost" data-flreset="${esc(sl.port)}" title="Put the stock part back">Stock</button>`:""}<button class="btn small ${open?"primary":"ghost"}" data-flswap="${esc(sl.port)}" data-type="${esc(sl.type)}" data-size="${esc(sl.size??"")}">${open?"Close":"Change"}</button></div></div>
      ${open?`<div class="opts" id="fl-opts">Loading what fits…</div>`:""}</div>`; };
  $("fl-panel").innerHTML=`<div class="mkp-head"><div class="mkp-img">${r.ship.photo?`<img src="${esc(r.ship.photo)}" alt="" referrerpolicy="no-referrer">`:picMissing("vehicle",r.ship.full||"")}</div>
      <div class="hd-main"><div class="hd-title"><div><h2>${r.ship.main?"★ ":""}${esc(r.ship.full)}</h2><div class="sub">${changed?`${changed} component${changed===1?"":"s"} changed from stock in this loadout · stats include your changes`:"Stock parts in this loadout"}</div></div>${titleLogo(r.ship.maker||ship?.maker,false)}</div>
        ${loadoutBar(r.loadouts)}
        <div id="fl-livery" class="lv-row">${liveryHtml(uid)}</div>
        ${r.modules?(()=>{ const m=r.modules.modules.find(x=>x.id===r.modules.current)||{};
          return `<div class="lv-row">${modPicker(r.modules,r.modules.current,"data-flmod")}<span class="muted" style="font-size:12px">${m.concept?`<span style="color:#f2c14e">Concept · not in game yet.</span> `:""}${esc(m.notes||"")}</span></div>`; })():""}
        ${changed?`<div class="row" style="gap:8px;margin:2px 0 8px"><button class="btn small ghost cart-all" data-flshop="1" title="Put every part you've swapped into this loadout in your cart">${CART_SVG}Add this loadout's ${plural(changed,"swapped part")} to cart</button></div>`:""}
        ${stats}
        ${r.power?.pips_gen?`<div class="pwr-row">
          <div class="seg-mini" title="What's powered: Combat = weapons and shields on, quantum drive off. Travel = quantum drive on, weapons and shields off."><button data-pmode="scm" class="${r.power.mode!=="nav"?"on":""}">Combat · SCM</button><button data-pmode="nav" class="${r.power.mode==="nav"?"on":""}">Travel · NAV</button></div>
          <button class="btn small ghost" data-ptoggle="1">${S.flPowerOpen?"Hide power ▴":"Power ▾"}</button>
          ${r.power.custom?`<span class="muted" style="font-size:12px">custom power</span>`:""}</div>`:""}</div></div>
    ${r.power?.pips_gen&&S.flPowerOpen?powerPanel(r):""}
    <div class="slot-groups">${Object.entries(groups).map(([label,list])=>{ const wide=list.some(sl=>sl.port===S.flSlot)?"open":list.length>2?"many":"";
      const ms=list[0].type==="Missile"&&r.missiles, msTxt=ms?` · ${Object.entries(ms.by_size).sort((a,b)=>b[0]-a[0]).map(([z,n])=>`${n} × S${z}`).join(", ")}${ms.loaded<ms.slots?` · ${ms.slots-ms.loaded} empty`:""}`:"";
      return `<div class="sg ${wide}"><div class="mk-h sg-h">${slotIcon(list[0].type)}${esc(label)}s <span class="muted" style="text-transform:none;letter-spacing:0">${list.length}${esc(msTxt)}</span></div><div class="slot-grid">${list.map(card).join("")}</div></div>`; }).join("")}</div>
    <div class="uex-credit">EM and IR are Quantum's estimates from each part's signature and how much power it gets. Data: game files${r.game_data?` (${esc(String(r.game_data).slice(0,10))})`:""}, Star Citizen Wiki, UEX.</div>`;
  if(S.flSlot){ const b=$("fl-panel").querySelector(`[data-flswap="${CSS.escape(S.flSlot)}"]`); if(b) loadSlotOptions(b.dataset.type,b.dataset.size);
    // Just opened with Change: bring the slot and its options/comparison into view instead of leaving them below the fold
    if(S.flScroll&&b){ S.flScroll=false; S.flScrollUntil=Date.now()+4000; flScrollToSlot(); } }
  watchPic($("fl-panel").querySelector(".mkp-img"));
  loadLiveries(uid); }
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
async function loadSlotOptions(type,size){
  const box=$("fl-opts"); if(!box) return; box.innerHTML=`<div class="muted" style="font-size:12px">Loading what fits, with each one's numbers…</div>`;
  const r=await api().fleet_options(type,size?+size:0,S.flSel); if(!$("fl-opts")) return;
  if(!r.ok){ $("fl-opts").innerHTML=`<div class="unknown">${esc(r.error)}</div>`; return; }
  S.flOpts=r; renderSlotOptions(); flScrollToSlot(); }
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
  const chip=x=>`<button class="lo-chip ${x.id===L.active?"on":""}" data-flload="${esc(x.id)}" title="${x.id===L.primary?"Primary loadout: used across Quantum for this ship":"Show this loadout"}${x.module?` · Module: ${esc(x.module)}`:""}${x.livery?` · Livery: ${esc(x.livery)}`:""}">${x.id===L.primary?`<span class="lo-star" aria-label="Primary">★</span>`:""}${esc(x.name)}${x.swaps?`<small>${x.swaps}</small>`:""}</button>`;
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
      <span class="lo-acts">${act&&act.id!==L.primary?`<button class="btn small ghost" data-lo="primary" title="Use this loadout across Quantum for this ship">★ Make primary</button>`:`<span class="lo-prim">★ Primary loadout</span>`}
      <button class="btn small ghost" data-lo="rename" title="Rename this loadout">Rename</button>${L.loadouts.length>1?`<button class="btn small ghost" data-lo="delete" title="Delete this loadout">Delete</button>`:""}</span></div>${form}`; }
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
function cmpDelta(k,a,b){ if(typeof a!=="number"||typeof b!=="number"||a===b) return ""; const d=b-a, good=LOWER_BETTER.has(k)?d<0:d>0, f=(CMP_STATS.find(x=>x[0]===k)||[0,0,n=>Math.round(n*10)/10])[2];
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
    ${keys.map(([x,lab,f])=>`<tr class="${x===k?"key":""}"><td>${esc(lab)}${LOWER_BETTER.has(x)?' <small class="muted">lower is better</small>':""}</td><td>${val(now.stats,x,f)}</td><td>${val(opt.stats,x,f)}</td><td>${cmpDelta(x,now.stats[x],opt.stats[x])}</td></tr>`).join("")
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
        ${k?`<td class="num">${v!=null?`<b>${esc(String(fmt(v,i.stats)))}</b><div class="bar"><i style="width:${Math.max(3,Math.round((+v||0)/top*100))}%"></i></div>`:"–"}</td><td class="num">${v!=null&&cur!=null&&!here?cmpDelta(k,+cur,+v)||'<span class="muted">same</span>':""}</td>`:""}
        ${sh?`<td class="num">${i.stats.shield_regen!=null?`${Math.round(i.stats.shield_regen).toLocaleString()}/s${now?.stats?.shield_regen!=null&&!here?`<div>${cmpDelta("shield_regen",+now.stats.shield_regen,+i.stats.shield_regen)}</div>`:""}`:"–"}</td>`:""}
        ${qd?`<td class="num">${i.stats.qt_spool!=null?`${nf(i.stats.qt_spool)} s${now?.stats?.qt_spool!=null&&!here?`<div>${cmpDelta("qt_spool",+now.stats.qt_spool,+i.stats.qt_spool)}</div>`:""}`:"–"}</td>
          <td class="num">${i.stats.qt_cooldown!=null?`${nf(i.stats.qt_cooldown)} s${now?.stats?.qt_cooldown!=null&&!here?`<div>${cmpDelta("qt_cooldown",+now.stats.qt_cooldown,+i.stats.qt_cooldown)}</div>`:""}`:"–"}</td>`:""}
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
    S.pfFleet=null; renderFleet(); }); }
$("fl-panel").onclick=async e=>{ if(await tradeClick(e)) return;
  const sw=e.target.closest("[data-flswap]"); if(sw){ S.flSlot=S.flSlot===sw.dataset.flswap?null:sw.dataset.flswap; S.flOpts=null; S.flQuery=""; S.flCmp=null; S.flScroll=!!S.flSlot; return renderShip(S.flSel); }
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
  const fit=e.target.closest("[data-flfit]"); if(fit){ await api().fleet_set_slot(S.flSel,S.flSlot,fit.dataset.flfit,fit.dataset.uuid||null); toast(`Fitted ${fit.dataset.flfit}`); S.flSlot=null; S.flOpts=null; S.flCmp=null; return renderFleet(); }
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
  const rs=e.target.closest("[data-flreset]"); if(rs){ await api().fleet_set_slot(S.flSel,rs.dataset.flreset,null); return renderFleet(); } };

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
        <div class="row" style="gap:6px;flex-wrap:wrap">${x.from_place&&x.to_place?`<button class="btn primary" data-act="trstart">Plan this route</button><button class="btn" data-act="tradd">Add stops to route</button>`:`<span class="muted" style="font-size:12px">${esc(!x.from_place?x.from:x.to)} isn't on the map yet</span>`}
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
$("tr-panel").onclick=async e=>{ if(await tradeClick(e)) return; const x=S.trRoutes?.[S.trOpen];
  if(e.target.closest("[data-act=trclose]")){ closeRunDetail(); setPreview(null); return; }
  if(e.target.closest("[data-act=tradd]")&&x){ await api().add_stops([x.from_place,x.to_place]); await poll(); return toast(`Added ${x.from_place} and ${x.to_place} to the route`); }
  if(e.target.closest("[data-act=trstart]")&&x){
    const r=await api().trade_run_save({commodity:x.commodity,units:x.units,from_place:x.from_place,to_place:x.to_place,from_terminal:x.from,to_terminal:x.to,plan_buy:x.buy,plan_sell:x.sell,url:x.url,boxes_from:x.boxes_from||null});
    if(!r.ok) return toast(r.error); await api().add_stops([x.from_place,x.to_place]); await poll();
    toast(`Route planned: ${x.commodity}. Track it under Planned Routes`); showTradeView("mine"); } };
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
  if(e.target.closest("[data-runroute]")){ await api().add_stops([x.from_place,x.to_place]); await poll(); return toast(`Added ${x.from_place} and ${x.to_place} to the route`); } };


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
  food:'<path d="M4 12h16a8 8 0 0 1-16 0z"/><path d="M8.5 8.5c0-1.5 1-1.5 1-3M12 8.5c0-1.5 1-1.5 1-3M15.5 8.5c0-1.5 1-1.5 1-3"/>',
  drink:'<path d="M9.5 3h5v3l1.5 2.5V20a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V8.5L9.5 6z"/><path d="M8 11h8M8 16h8"/>',
  medical:'<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"/>',
  gadget:'<path d="M14.5 5.5a4 4 0 0 0-5 5L3.5 16.5l3 3 6-6a4 4 0 0 0 5-5l-2.5 2.5-2.5-.5-.5-2.5z"/>',
  key:'<rect x="1.5" y="5" width="21" height="14" rx="2" transform="rotate(-14 12 12)" fill="currentColor" fill-opacity=".3"/>',
  component:'<rect x="6" y="6" width="12" height="12" rx="1.5"/><rect x="9.5" y="9.5" width="5" height="5"/><path d="M9 3v3M12 3v3M15 3v3M9 18v3M12 18v3M15 18v3M3 9h3M3 12h3M3 15h3M18 9h3M18 12h3M18 15h3"/>',
  vehicle:'<path d="M12 1 14.7 4 14.7 4.6 16.1 4.8 15.9 5.4 14.6 5.6 14.5 6.2 14.7 10.4 15 11.2 17.9 14.2 20.6 13.4 20.8 12.7 21.3 12.7 21.3 16.8 20.8 16.8 20.6 15.6 17.9 19.6 17.9 20.3 15.1 22.8 14.1 22.8 13.9 20.1 12.6 20.1 12.5 21.3 11.5 21.3 11.4 20.1 10.1 20.1 9.9 22.8 8.9 22.8 6.1 20.3 6.1 19.6 3.4 15.6 3.2 16.8 2.7 16.8 2.7 12.7 3.2 12.7 3.4 13.4 6.1 14.2 9 11.2 9.3 10.4 9.5 6.2 9.4 5.6 8.1 5.4 7.9 4.8 9.3 4.6 9.3 4z"/>',
  box:'<rect x="4" y="6" width="16" height="13" rx="1.5"/><path d="M4 10h16M10 13.5h4"/>'};
const PH_ART_OF={commodity:"commodity",vehicle:"vehicle",component:"component"};
const PH_LABEL={commodity:"Commodity",weapon:"Weapon",armor:"Armor",clothing:"Clothing",food:"Food",drink:"Drink",medical:"Medical",gadget:"Gadget",key:"Key",component:"Component",vehicle:"Ship",box:"Item"};
// CIG's own icons (from the Star Citizen Wiki) for weapons, armor and gadgets: filled, 50×50, in the theme's colour
const PH_CIG={weapon:{vb:"0 0 50 50",inner:'<path d="M50 9.5v-.9l-1.7-1.1h-2.2c0 .2-.2.4-.4.4h-2.5c-.2 0-.4-.2-.4-.4H31.1l.1.5h-8.5l-.6-.5H4.5L1.7 9.1c-.3.2-.5.4-.7.7l-.7 1.5V14l.7.8v1.1l5 2.3s1.2 2.5-.8 6-3.4 4.6-5 12.5c0 0-.8 3 1 3.7 0 0-.1.5.3.8l-.3.9s0 .3 1.5.4 7.8 0 7.8 0 2.7-.1 2.7-2.1l.5-2.2s-.7-.5-.2-2.5c.5-2 1.4-4.8 1.4-4.8s.2-1.2 1.3-1.7.4-1.1.4-1.1-.4-1.5.6-3.6l.4-.8s2.1-1.5 4.2.1h6.6l4.4-4.8 2.3-.7h11.4l.3-.4h.2l.5-.5h.7s.8-.1.8-1.1l-.1-2.3h.2l.5-1.3-.2-.2V12l-.2-.3s.5-.6.5-1.4l.3-.8zm-22.3 6.4 2.5 2.1-.2 2.4-1.8 2.1h-3.6l.1-.4-.1-.4s-2.5-1.1-1.9-5.8h5z"/>'},armor:{vb:"0 0 50 50",inner:'<path d="m43 32.1-8.3 5.4-6.1-2.6.1-5.4 12.5-2.9 2.1-.7-1.1-6.8-1.3-.1 1.6-10-.1-1.4c-2.6-2.8-5.5-5.1-8.4-6C30.1.3 25 0 25 0s-5.1.3-8.9 1.6c-2.9.9-5.7 3.2-8.4 6L7.6 9l1.6 10-1.5.1-1 6.8 2 .8 12.5 2.9.1 5.4-6.1 2.6L7 32.2l-1.4 4.9 6.1 6.8 4 1.1 3 4.9h12.6l3-4.9 4-1.1 6.1-6.8-1.4-5zM28.4 43h-6.9l-.8-1.8 2.3-3.9h4l2.3 3.9-.9 1.8z"/>'},
  gadget:{vb:"0 0 50 50",inner:'<path d="M24.8 16.2c-1.2.4-2.3 1-3.2 1.9-.8.8-1.4 1.7-1.8 2.7s-.5 2-.5 3.1c.1 1.2-.3 2.3-1.1 3.1L1 44.3c-.6.6-1 1.4-1 2.4 0 .9.3 1.7 1 2.3.6.6 1.4 1 2.4 1 .9 0 1.7-.3 2.3-1l16.6-16.6c1.2-1.2 2.3-1.6 3.4-1.5 1.2.2 2.4.1 3.5-.2 1.2-.4 2.2-1 3.1-1.9 1-1 1.6-2.1 2-3.5.3-1.3.3-2.6 0-3.9 0-.2-.1-.3-.2-.3-.1-.1-.3 0-.5.1L30.8 24c-.5.5-1.1.7-1.8.7s-1.3-.2-1.8-.7L26 23c-.5-.5-.7-1.1-.7-1.8s.2-1.3.7-1.8l2.7-2.7c.4-.4.3-.6-.3-.7-1.3-.2-2.5-.2-3.6.2m-4.5 12.3c.2-.2.5-.3.8-.3s.6.1.8.3c.2.2.3.5.3.8s-.1.6-.3.8L4.7 47.2c-.2.2-.5.3-.8.3s-.6-.1-.8-.3-.3-.5-.3-.8.1-.6.3-.8l17.2-17.1M45.4 9.2c0-.2-.1-.4-.2-.6l-3.8-3.8c-.1-.1-.3-.2-.5-.2s-.4.1-.6.2l-3 3c-2.1-1.4-4.4-2.3-6.9-2.8V.8c0-.2-.1-.4-.2-.5-.2-.2-.3-.2-.6-.2h-5.4c-.2 0-.4.1-.5.2-.2.1-.2.3-.2.5v4.3c-2.5.6-4.7 1.5-6.8 2.9l-3.1-3.1c-.1-.1-.3-.2-.5-.2s-.4.1-.6.2L8.7 8.7c-.1.1-.2.3-.2.5s.1.4.2.6l3.1 3.1C10.4 15 9.5 17.2 9 19.6H4.6c-.2 0-.4.1-.5.2-.1.2-.2.4-.2.6v5.4c0 .2.1.4.2.6.1.1.3.2.5.2h4.5c.3 1.5.8 3 1.4 4.3l3.9-3.9c-.7-2.3-.8-4.6-.2-7s1.7-4.5 3.5-6.2c2.6-2.6 5.7-3.8 9.3-3.8s6.7 1.3 9.3 3.8c2.6 2.6 3.9 5.7 3.9 9.3s-1.3 6.7-3.9 9.3c-1.8 1.8-3.9 2.9-6.3 3.5s-4.7.5-7-.3l-3.9 3.9c1.4.7 2.9 1.2 4.4 1.5v4.4c0 .2.1.4.2.6.2.1.3.2.5.2h5.4c.2 0 .4-.1.6-.2.1-.2.2-.3.2-.6V41c2.5-.5 4.8-1.4 6.8-2.8l3.1 3c.2.2.3.2.6.2s.4-.1.5-.2l3.8-3.8c.2-.2.2-.3.2-.6s-.1-.4-.2-.6l-3-3c1.4-2.1 2.4-4.3 2.9-6.9h4.2c.2 0 .4-.1.6-.2.2-.2.2-.3.2-.6v-5.4c0-.2-.1-.4-.2-.5-.2-.2-.3-.2-.6-.2H45c-.5-2.4-1.4-4.7-2.9-6.9l3-3c.2.1.3 0 .3-.3z"/>'}};
function phSvg(art){ const c=PH_CIG[art];
  if(c) return `<svg class="ph-art-ic ph-cig" viewBox="${esc(c.vb)}" aria-hidden="true">${c.inner}</svg>`;
  return `<svg class="ph-art-ic" viewBox="0 0 24 24" aria-hidden="true">${PH_ART[art]||PH_ART.box}</svg>`; }
// For a grid card: the drawing alone (the card says what it is)
function phCard(art){ return `<span class="ph-art">${phSvg(art)}</span>`; }
// The kind of drawing for a piece of gear, by its tab and what it is
function grArt(kind,i){ if(kind==="consumables") return i?.kind==="Drink"?"drink":i?.kind==="Medical"?"medical":"food";
  return {weapons:"weapon",armor:"armor",clothing:"clothing",gadgets:"gadget",utility:"key"}[kind]||"box"; }
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
