// Quantum UI: Patch Hub (events, new ships, LIVE and PTU patch notes, RSI store, upcoming ships).
// One of several classic scripts sharing one global scope; index.html loads them in order.
// Every top-level name here starts with "ph"/"hub" or "PatchHub": other scripts already use names like phCard.
"use strict";
// =================================================================== Patch Hub
// The Quantum server builds it (patchhub.py) and the app shows it; without the server the app builds its own copy.
// The sidebar has the versions, a jump list and the sources (each opens where its data came from); the page sits
// over the map. Ship names open the ship's page in Vehicles, which then offers "Back to Patch Hub".
S.ph=S.ph||{data:null,build:"live",full:true,pics:{},loading:null};
const PH_IC={refresh:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/></svg>',
  ext:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5H5V6h5"/></svg>'};
const phAgo=t=>{ if(!t) return ""; const a=Math.max(0,Date.now()/1000-t);
  return a<90?"just now":a<3600?`${Math.round(a/60)} min ago`:a<86400?`${Math.round(a/3600)} h ago`:`${Math.round(a/86400)} d ago`; };
const phIn=t=>{ const a=Math.max(0,t-Date.now()/1000), d=Math.floor(a/86400), h=Math.floor(a%86400/3600);
  return d?`${d}d ${h}h`:h?`${h}h ${Math.floor(a%3600/60)}m`:`${Math.max(1,Math.floor(a/60))}m`; };
const phVer=v=>v?.version?`${v.version}${v.letter||""}`:"–";
// a date in the reader's own time: "Fri 13 Nov, 08:00" (the time left out when it's midnight or 23:59 UTC: a whole day)
function phWhen(t){ if(!t) return ""; const d=new Date(t*1000), whole=[0,1439].includes(d.getUTCHours()*60+d.getUTCMinutes());
  return d.toLocaleDateString(undefined,{weekday:"short",day:"numeric",month:"short"})+(whole?"":", "+d.toLocaleTimeString(undefined,{hour:"2-digit",minute:"2-digit"})); }
// Every item has a key, so the rail can count what's new to you since you last opened the page
function phKeys(h){ if(!h) return []; const k=[];
  if(h.live?.version) k.push(`live:${h.live.version}:${h.live.build||""}`);
  if(h.ptu?.version) k.push(`ptu:${h.ptu.version}:${h.ptu.build||""}`);
  for(const s of h.ships?.list||[]) k.push(`ship:${s.name}`);
  for(const e of h.events?.list||[]) k.push(`event:${e.name}:${e.state}`);
  for(const e of h.events?.announced||[]) k.push(`ann:${e.url||e.name}`);
  for(const x of h.store?.new||[]) k.push(`store:${x.name}:${x.kind}`);
  return k; }
function phBadge(){ const b=$("rail-ph-n"); if(!b) return; const seen=new Set(S.ph.seen||[]);
  const n=phKeys(S.ph.data).filter(k=>!seen.has(k)).length; b.textContent=n>99?"99+":String(n); b.hidden=!n||S.tab==="patchhub"; }
// one load at a time: a second caller (opening the page while the start-up load runs) waits for the same one
function phLoad(refresh){ if(S.ph.loading) return S.ph.loading; return S.ph.loading=phLoad1(refresh); }
async function phLoad1(refresh){
  try{ const r=await api().patchhub_get(!!refresh);
    if(r.ok){ if(r.hub||!r.building) S.ph.data=r.hub;
      // new ships UEX doesn't list join the Vehicles list (qbase.auto_extra_vehicles): reload it when they change
      if(r.hub&&!r.building&&S.veh&&S.tab!=="vehicles"&&(r.hub.ships?.list||[]).some(s=>!phUexExact(s.name))){ S.veh=null; S.vehGalKey=null; } S.ph.source=r.source; S.ph.game=r.game||{}; S.ph.seen=r.seen||[]; S.ph.claimed=r.claimed||[]; S.ph.error=null;
      S.ph.building=!!r.building; S.ph.progress=r.progress||{}; }
    else S.ph.error=r.error||"Couldn't load the Patch Hub"; }
  catch(e){ S.ph.error=String(e); }
  finally{ S.ph.loading=null; }
  phBadge(); }
// the steps of a build, in the words the page uses
const PH_STEPS=[["versions","Game versions"],["comm_links","RSI news"],["notes","Patch notes"],["events","Events"],["ships","New ships"],["pipeline","Ship pipeline"],["store","RSI store"]];
function phSteps(){ const P=S.ph.progress||{};
  return `<div class="ph-steps">${PH_STEPS.map(([k,t])=>{ const st=P[k]||"waiting";
    return `<div class="${st}"><span class="dot"></span><span>${t}</span><small>${st==="done"?"ready":st==="failed"?"couldn't load":st==="running"?"loading…":"waiting"}</small></div>`; }).join("")}</div>`; }
async function openPatchHub(refresh){
  if(!S.ph.data||refresh||S.ph.building){
    if(!S.ph.data) phLoadingView();
    else if(refresh){ const b=$("ph-refresh"); if(b){ b.disabled=true; b.lastChild.textContent=" Refreshing…"; } }
    await phLoad(refresh); if(S.tab!=="patchhub") return; }
  if(S.ph.data) phRerender(); else if(S.ph.building) phLoadingView(); else renderPatchHub();      // the last: "couldn't load"
  if(S.ph.building){ clearTimeout(S.ph.pollT); S.ph.pollT=setTimeout(()=>{ if(S.tab==="patchhub") openPatchHub(); else phLoad(false); },2500); return; }
  const keys=phKeys(S.ph.data), seen=new Set(S.ph.seen||[]), fresh=keys.filter(k=>!seen.has(k));
  if(fresh.length){ S.ph.seen=[...(S.ph.seen||[]),...fresh]; api().patchhub_seen(fresh); }
  phBadge(); }
function phLoadingView(){
  $("ph-panel").innerHTML=`<div class="ph-loading">${qLoader("Gathering the latest from RSI and the Star Citizen Wiki…")}
    <div class="ph-sub" style="text-align:center">The first time takes a minute or two. Each section shows up as soon as it’s ready.</div>${S.ph.building?phSteps():""}</div>`;
  $("pane-patchhub").innerHTML=S.ph.building?`<div class="ph-side"><div class="mk-h">Loading</div>${phSteps()}</div>`:""; }

// ---- a ship's page in Vehicles, with a way back
function phFindVeh(name){ const L=S.veh||[]; if(!name) return null;
  const strip=t=>String(t||"").replace(/\bmk\s*[ivx]+\b/ig," ");
  const k=squash(name), kk=squash(strip(name)), keys=v=>[v.full,v.name,v.aka].filter(Boolean).map(squash), keys2=v=>[v.full,v.name,v.aka].filter(Boolean).map(x=>squash(strip(x)));
  return L.find(v=>keys(v).includes(k))||L.find(v=>keys(v).some(x=>x.endsWith(k)&&k.length>=5))
    ||L.find(v=>keys2(v).includes(kk))||L.find(v=>keys2(v).some(x=>x.endsWith(kk)&&kk.length>=5))
    ||L.filter(v=>vhMatch(`${v.full} ${v.aka||""}`,strip(name).toLowerCase().replace(/\s+/g," ").trim())).sort((a,b)=>a.full.length-b.full.length)[0]||null; }
// the hub's record of a ship (new ships, the pipeline), by name
function phShipData(name){ const h=S.ph.data||{}, k=squash(name);
  const all=[...(h.ships?.list||[]),...["concept","ptu","new"].flatMap(c=>h.pipeline?.[c]?.ships||[])];
  return all.find(s=>squash(s.name)===k)||{name}; }
// a UEX vehicle with this exact name (maker prefix and "Mk" spelling forgiven); no guessing at a near one
function phUexExact(name){ const L=S.veh||[]; const strip=t=>String(t||"").replace(/\bmk\s*[ivx]+\b/ig," ");
  const k=squash(name), kk=squash(strip(name)), keys=v=>[v.full,v.name,v.aka].filter(Boolean).map(squash), keys2=v=>[v.full,v.name,v.aka].filter(Boolean).map(x=>squash(strip(x)));
  return L.find(v=>keys(v).includes(k))||L.find(v=>keys(v).some(x=>x.endsWith(k)&&k.length>=5))
    ||L.find(v=>keys2(v).includes(kk))||L.find(v=>keys2(v).some(x=>x.endsWith(kk)&&kk.length>=5))||null; }
async function phOpenShip(name){
  const tab=document.querySelector('.tab[data-tab="vehicles"]');
  if(tab&&!tab.hidden){
    if(!S.veh) await (typeof trLoadVehicles==="function"?trLoadVehicles().catch(()=>{}):null);
    const v=phUexExact(name);
    if(v){ S.vehFrom={tab:"patchhub",top:$("ph-panel").scrollTop,searched:false};
      S.vehDetail=null; tab.click();
      for(let i=0;i<40&&!S.veh;i++) await new Promise(r=>setTimeout(r,250));
      if(S.tab!=="vehicles") return;
      S.vehDetail=String(v.id); S.vehGalKey=null; renderVehicles(); return; } }
  // not in UEX's list (a pledge-only variant like the ATLS IKTI Akuma, a concept ship): its own page here
  S.ph.shipTop=$("ph-panel").scrollTop; S.ph.ship=phShipData(name); renderPatchHub(); $("ph-panel").scrollTop=0; }
function phShipBack(){ const top=S.ph.shipTop||0; S.ph.ship=null; renderPatchHub(); $("ph-panel").scrollTop=top; }
function phShipPage(s){
  const fmt=(n,u,d=0)=>n==null?null:`${Number(n).toLocaleString(undefined,{maximumFractionDigits:d})}${u}`;
  const specs=[["Maker",s.maker],["Role",s.role],["Size",s.size],["Crew",s.crew],["Length",fmt(s.length," m",1)],["Beam",fmt(s.beam," m",1)],
    ["Height",fmt(s.height," m",1)],["Mass",fmt(s.mass," kg")],["Cargo",s.cargo!=null?fmt(s.cargo," SCU"):null],["Status",s.status?s.status.replace(/-/g," "):null]].filter(([,v])=>v);
  const pic=s.image?`<img src="${esc(s.image)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">`:phPic(s.name);
  return `<div class="ph-wrap ph-shippage">
    <div><button class="btn primary" data-phshipback="1">← Back to What’s New</button></div>
    <section class="ph-card ph-sp"><div class="art">${pic}</div>
      <div class="body"><div class="ph-lbl">${esc(s.maker||"Ship")}</div><h2>${esc(s.name)}</h2>
        ${s.msrp?`<div class="price">${typeof usd==="function"?usd(s.msrp):"$"+s.msrp}<small> on the RSI store</small></div>`:""}
        ${s.desc?`<p>${esc(s.desc)}</p>`:`<p class="ph-sub">RSI hasn’t published a description for this one that Quantum could read.</p>`}
        ${specs.length?`<div class="ph-specs">${specs.map(([k,v])=>`<div><small>${k}</small><b>${esc(v)}</b></div>`).join("")}</div>`:""}
        <div class="ph-acts">${s.store?`<button class="btn" data-ext="${esc(s.store)}">View on the RSI store ${PH_IC.ext}</button>`:""}${s.url?`<button class="btn ghost" data-ext="${esc(s.url)}">Star Citizen Wiki ${PH_IC.ext}</button>`:""}</div>
        <div class="ph-sub">UEX doesn’t list this one, so in-game prices and where to buy it aren’t known yet. Details come from RSI and the Star Citizen Wiki.</div></div></section></div>`; }
// called by the Vehicles page's "Back to Patch Hub" button (trade.js)
function phBackFromVehicles(){ const f=S.vehFrom; S.vehFrom=null; S.vehDetail=null; S.vehGalKey=null;
  if(f?.searched) $("vh-search").value="";
  document.querySelector('.tab[data-tab="patchhub"]')?.click();
  setTimeout(()=>{ if(f) $("ph-panel").scrollTop=f.top; },60); }
const phShipName=(s,cls)=>`<button class="ph-name ${cls||""}" data-phveh="${esc(s.name)}" data-phwiki="${esc(s.url||"")}" title="Open the ${esc(s.name)}'s page">${esc(s.name)}</button>`;

function phPic(name,img){
  if(img) return `<img src="${esc(img)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">`;
  const v=S.veh&&phUexExact(name); if(v?.photo) return `<img src="${esc(typeof imgSrc==="function"?imgSrc(v.photo):v.photo)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">`;
  if(!(name in S.ph.pics)){ S.ph.pics[name]=null;
    const tryNames=[name,name.split(/\s+/).slice(1).join(" ")].filter(n=>n&&n.length>2);
    (async()=>{ for(const n of tryNames){ try{ const r=await api().ccu_photo(n); if(r?.photo){ S.ph.pics[name]=r.photo; break; } }catch(_){} }
      if(!S.ph.pics[name]) S.ph.pics[name]=""; if(S.tab==="patchhub") phRerender(); })(); }
  const u=S.ph.pics[name];
  return u?`<img src="${esc(u)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">`:`<div class="ph-art ph-grid-bg">${typeof phSvg==="function"?phSvg("vehicle"):""}</div>`; }
const phSrc=url=>url?`<button class="ph-src" data-ext="${esc(url)}" title="Open the source">Source ${PH_IC.ext}</button>`:"";
const hubCard=(id,num,label,title,body,cls,right)=>`<section class="ph-card ${cls||""}" id="ph-${id}" aria-labelledby="ph-${id}-h">
  <div class="ph-hd"><div><div class="ph-lbl">${num} · ${label}</div><h3 id="ph-${id}-h">${title}</h3></div><div class="ph-hd-r">${right||""}</div></div>${body}</section>`;
const phEmpty=t=>`<div class="ph-none">${t}</div>`;
const phLink=(url,t)=>url?`<button class="ph-link" data-ext="${esc(url)}">${t}${PH_IC.ext}</button>`:"";

// ---- events: what's on now and what's coming, with pictures and live countdowns
// a countdown in parts: [["17","days"],["4","hrs"]] (minutes once it's under a day)
function phParts(t){ const a=Math.max(0,t-Date.now()/1000), d=Math.floor(a/86400), h=Math.floor(a%86400/3600), m=Math.floor(a%3600/60);
  return d?[[d,d===1?"day":"days"],[h,"hrs"]]:[[h,"hrs"],[m,"min"]]; }
const phCount=(t,label)=>`<div class="ph-count" aria-label="${esc(label)}">${phParts(t).map(([n,u])=>`<span><b>${n}</b><small>${u}</small></span>`).join("")}<em>${esc(label)}</em></div>`;
function phEvents(h){ const L=h.events?.list||[], A=h.events?.announced||[], links=h.links||{};
  const now=L.filter(e=>e.state==="live"), soon=L.filter(e=>e.state==="soon");
  const tags=e=>[e.free_fly&&"Free Fly",e.kind,e.where,e.from==="wiki"&&!e.kind&&"In-game event"].filter(Boolean).slice(0,3)
    .map(t=>`<span class="ph-tag">${esc(t)}</span>`).join("");
  // an event's own schedule (IAE: free rentals by manufacturer, stock-limited sales, concept reveals)
  const sched=e=>{ const S2=e.schedule||{}, now=Date.now()/1000, R=S2.rentals||[], Lm=S2.limited||[], C=S2.concepts||[];
    if(!R.length&&!Lm.length&&!C.length&&!e.schedule_image) return "";
    const on=R.filter(r=>r.starts&&r.starts<=now&&now<r.ends), next=R.find(r=>r.starts&&r.starts>now);
    const dayDate=d=>{ const n=parseInt(d,10); return e.starts&&n?phWhen(e.starts+(n-1)*86400).replace(/,.*$/,""):""; };
    return `<div class="ph-sched">
      ${R.length?`<div class="ph-now">${on.length?`<span class="ph-lbl" style="color:#8ff0b1">Free rentals now</span>${on.map(r=>`<div><b>${esc(r.makers)}</b>${r.vehicles?`<small>${esc(r.vehicles)}</small>`:""}</div>`).join("")}`
          :next?`<span class="ph-lbl" style="color:#f6cf6d">First up</span><div><b>${esc(next.makers)}</b><small>from ${esc(phWhen(next.starts))}${next.vehicles?` · ${esc(next.vehicles)}`:""}</small></div>`:""}</div>
        <details class="ph-sec" ${e.rentals?"open":""}><summary>Free rental &amp; pledge schedule <span class="ph-chip">${R.length}</span></summary>
          <div class="ph-rent">${R.map(r=>{ const cur=r.starts&&r.starts<=now&&now<r.ends, past=r.ends&&r.ends<=now;
            return `<div class="${cur?"cur":past?"past":""}"><span class="d">${esc(r.date||"")}<small>Day ${esc(r.day||"")}</small></span><span class="m"><b>${esc(r.makers||"")}</b>${r.vehicles?`<small title="${esc(r.vehicles)}">${esc(r.vehicles)}</small>`:""}</span>${cur?`<span class="ph-pill live">NOW</span>`:""}</div>`; }).join("")}</div></details>`:""}
      ${Lm.length?`<details class="ph-sec"><summary>Stock-limited ship sales <span class="ph-chip">${Lm.length}</span></summary><div class="ph-rent">${Lm.map(r=>`<div class="${r.starts&&r.starts+86400<now?"past":""}"><span class="d">${esc(r.date||"")}<small>Day ${esc(r.day||"")}</small></span><span class="m"><b>${esc(r.ships||"")}</b><small>Waves from ${r.starts?esc(phWhen(r.starts)):"16:00 UTC"}</small></span></div>`).join("")}</div></details>`:""}
      ${C.length?`<details class="ph-sec"><summary>Concept reveals <span class="ph-chip">${C.length}</span></summary><div class="ph-rent">${C.map(c=>`<div><span class="d">Day ${esc(c.day||"")}<small>${esc(dayDate(c.day))}</small></span><span class="m">${phShipName({name:c.name})}${c.desc?`<small>${esc(c.desc)}</small>`:""}</span></div>`).join("")}</div></details>`:""}
      ${e.schedule_image?`<button class="ph-schedimg" data-ext="${esc(e.schedule_image.full||e.schedule_image.thumb)}" title="Open the official schedule full size"><img src="${esc(e.schedule_image.thumb||e.schedule_image.full)}" alt="The official schedule" referrerpolicy="no-referrer" onerror="this.parentNode.remove()"><span>Official schedule ${PH_IC.ext}</span></button>`:""}
    </div>`; };
  // a Twitch drops campaign's rewards: each item and the total watch time that unlocks it
  // Each reward has a tick box: mark the ones you've claimed on Twitch (kept in your settings)
  const drops=e=>{ const R=e.rewards||[]; if(!R.length) return "";
    const hrs=h=>h==null?"?":String(h), got=new Set(S.ph.claimed||[]), key=r=>phDropKey(e,r), n=R.filter(r=>got.has(key(r))).length;
    return `<div class="ph-drops"><div class="ph-lbl">Rewards${e.campaign?` · ${esc(e.campaign)}`:""}${n?` · <span class="ph-got">${n===R.length?"all claimed ✓":`${n} of ${R.length} claimed`}</span>`:""}</div>
      <ol>${R.map(r=>{ const c=got.has(key(r)); return `<li class="${c?"claimed":""}">${r.image?`<img src="${esc(r.image)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">`:""}<span class="h"><b>${esc(hrs(r.hours))}</b><small>${r.hours===1?"hr":"hrs"}</small></span><span class="n">${esc(r.name)}<small>${c?"Claimed":`Watch ${esc(hrs(r.hours))} ${r.hours===1?"hour":"hours"} in total, then claim it on Twitch`}</small></span>
        <button class="ph-claim ${c?"on":""}" data-phclaim="${esc(key(r))}" role="checkbox" aria-checked="${c}" title="${c?"Claimed. Click to unmark it":"Mark as claimed"}" aria-label="${esc(r.name)}: ${c?"claimed":"not claimed"}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></button></li>`; }).join("")}</ol>
      <div class="ph-sub">Any Drops-enabled Star Citizen stream counts, one stream at a time. Your RSI and Twitch accounts need to be linked.</div></div>`; };
  const card=(e,hero)=>{ const live=e.state==="live";
    const R=(e.schedule?.rentals||[]).filter(r=>r.starts), nowS=Date.now()/1000;
    const nextR=e.rentals&&live?R.find(r=>r.starts>nowS):null;
    const clock=e.rentals&&live&&nextR?`<div class="ph-clocks">${phCount(nextR.starts,`until ${nextR.makers}`)}${e.ends?phCount(e.ends,"until the schedule ends"):""}</div>`
      :live?(e.ends?phCount(e.ends,"left"):`<div class="ph-count one"><span><b>${e.day?`Day ${e.day}`:"On now"}</b><small>${e.day?"of the event":""}</small></span><em>no end date announced</em></div>`)
      :(e.starts?phCount(e.starts,"until it starts"):`<div class="ph-count one"><span><b>Soon</b><small></small></span><em>date to be announced</em></div>`);
    const dates=e.starts||e.ends?`${e.approx?"≈ ":""}${e.starts?esc(phWhen(e.starts)):"–"} → ${e.ends?esc(phWhen(e.ends)):"ongoing"}`:"";
    const sc=sched(e);
    return `<article class="ph-evc ${live?"live":"soon"} ${hero?"hero":""} ${e.rentals?"wide":""}">
      <div class="art">${e.image?`<img src="${esc(e.image)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">`:""}<span class="ph-pill ${live?"live":"soon"}">${live?"HAPPENING NOW":"COMING UP"}</span></div>
      <div class="body"><div class="row1"><div><h4>${esc(e.name)}</h4>${dates?`<div class="dates">${dates}</div>`:""}</div>${clock}</div>
        ${tags(e)?`<div class="tags">${tags(e)}</div>`:""}
        ${e.note?`<p>${esc(e.note)}</p>`:""}
        ${live&&e.ends&&e.starts?`<div class="ph-bar" role="progressbar" aria-valuenow="${e.pct||0}" aria-valuemin="0" aria-valuemax="100" aria-label="How far through ${esc(e.name)}"><i style="width:${e.pct||0}%"></i></div>`:""}
        ${sc}${drops(e)}
        <div class="acts">${e.twitch?phLink(e.twitch.streams,"Find a Drops stream")+phLink(e.twitch.inventory,"Drops inventory"):""}${e.url&&!(e.twitch&&e.url===e.twitch.streams)?phLink(e.url,e.from==="wiki"?"Read about it on the wiki":"Details on RSI"):""}${(e.wiki||e.twitch)&&e.url&&e.rsi&&e.rsi!==e.url?phLink(e.rsi,"RSI post"):""}</div></div></article>`; };
  const all=[...now,...soon].sort((a,b)=>(a.rentals?1:0)-(b.rentals?1:0));     // the rental schedule: a full-width row of its own, last
  const body=all.length?`<div class="ph-evs n${Math.min(all.length,3)}">${all.slice(0,6).map((e,i)=>card(e,i===0&&all.length<3)).join("")}</div>`
      :phEmpty("No events running or announced for the next few weeks.");
  const more=A.length?`<div class="ph-ann-row"><span class="ph-lbl">More from RSI</span>${A.slice(0,4).map(a=>`<button class="ph-ann" data-ext="${esc(a.url||"")}">${esc(a.name)}${a.date?` <small>${esc(phAgo(a.date))}</small>`:""}</button>`).join("")}</div>`:"";
  const nx=h.events?.next, head=now.length?`${now.length} on now${nx?` · next: ${esc(nx.name)} in ${esc(phIn(nx.starts))}`:""}`:nx?`Next: ${esc(nx.name)} in ${esc(phIn(nx.starts))}`:"";
  return `<section class="ph-card ph-events" id="ph-events" aria-labelledby="ph-events-h"><div class="ph-hd"><div><div class="ph-lbl">Events</div><h3 id="ph-events-h">Ongoing and Upcoming Events</h3>${head?`<div class="ph-sub">${head}</div>`:""}</div><div class="ph-hd-r">${phSrc(links.events)}</div></div>${body}${more}</section>`; }

// ---- 1. new ships
const phUniq=L=>{ const seen=new Set(); return (L||[]).filter(s=>{ const k=squash(s.name); return seen.has(k)?false:(seen.add(k),true); }); };
function phShips(h){ const L=phUniq(h.ships?.list), sh=h.ships||{};
  const body=L.length?`<div class="ph-ships">${L.slice(0,12).map(s=>`<div class="ph-ship"><button class="pic" data-phveh="${esc(s.name)}" data-phwiki="${esc(s.url||"")}" aria-label="Open the ${esc(s.name)}'s page" tabindex="-1">${phPic(s.name,s.image)}</button>
      <div class="t">${phShipName(s)}<span>${esc([s.maker,s.role].filter(Boolean).join(" · "))}</span>
      <div class="chips">${s.size?`<span class="ph-chip">${esc(s.size)}</span>`:""}${s.vehicle&&!/vehicle/i.test(s.size||"")?`<span class="ph-chip">Ground vehicle</span>`:""}</div></div></div>`).join("")}</div>
      ${L.length>12?`<div class="ph-more">+ ${L.length-12} more</div>`:""}`
    :phEmpty(sh.how==="none"?"Couldn't compare this version with the one before yet.":`No new ships or vehicles in ${esc(sh.release?`Alpha ${sh.release}`:sh.version||"this patch")}.`);
  const how=sh.compared_with?`<span class="ph-sub" title="Every ship in the game files of ${esc(sh.version||"")} that wasn't in ${esc(sh.compared_with)}, the release before. Renamed ships are left out.">added across ${esc(sh.release||"")}.x · since ${esc(sh.compared_with)}</span>`:"";
  return hubCard("ships","1","New in this release",`Ships &amp; vehicles new in Alpha ${esc(sh.version||sh.release||"")}`,body,"span2",how+phSrc(h.links?.ships)); }

// ---- 2 & 3. patch notes
function phNotes(h){ const N=h.notes||{}, hasPtu=!!N.ptu, side=S.ph.build==="ptu"&&hasPtu?"ptu":"live", n=N[side];
  const seg=`<div class="ph-seg" role="group" aria-label="Which build's notes"><button data-phb="live" aria-pressed="${side==="live"}" class="${side==="live"?"on live":""}">LIVE</button>
    <button data-phb="ptu" aria-pressed="${side==="ptu"}" class="${side==="ptu"?"on ptu":""}" ${hasPtu?"":"disabled title=\"No PTU notes right now\""}>PTU</button></div>`;
  if(!n) return hubCard("notes","2 & 3","Patch notes","Patch notes",phEmpty("Couldn't get the patch notes this time. Try Refresh in a little while."),"span2",seg);
  const info=Object.entries(n.info||{}); const stale=side==="ptu"&&!n.active;
  const title=`${side.toUpperCase()} · ${esc(phVer(n))}${n.build?` <span class="ph-sub">build ${esc(n.build)}</span>`:""}${side==="ptu"&&n.wave?` <span class="ph-sub">· ${esc(n.wave)}</span>`:""}`;
  const none=!(n.sections||[]).length;
  const list=none?phEmpty(n.from==="wiki"?"This PTU build is out, but its patch notes aren't posted on Spectrum yet.":"No notes found for this build.")
    :S.ph.full?(n.sections||[]).map(s=>`<details class="ph-sec" open><summary>${esc(s.name)} <span class="ph-chip">${s.items.length}</span></summary>
        <ul>${s.items.map(t=>`<li>${esc(t)}</li>`).join("")}</ul></details>`).join("")
    :`<div class="ph-hl">${(n.highlights||[]).map(x=>`<div class="r"><span class="c">${esc(x.cat)}</span><span>${esc(x.text)}</span></div>`).join("")}</div>`;
  const body=`${stale?`<div class="note">This PTU build has already gone LIVE: these are its last PTU notes.</div>`:""}
    ${(n.cats||[]).length?`<div class="ph-cats">${n.cats.map(c=>`<span class="ph-chip">${esc(c.name)} <b>${c.n}</b></span>`).join("")}</div>`:""}
    ${list}
    <div class="ph-acts">${none?"":`<button class="btn" data-phfull="1">${S.ph.full?"Show highlights only":"Read full notes"}</button>`}${n.url?`<button class="btn ghost" data-ext="${esc(n.url)}">${/comm-link/i.test(n.url)?"Full notes on RSI":"Open on RSI"} ${PH_IC.ext}</button>`:""}${n.spectrum_url&&n.spectrum_url!==n.url?`<button class="btn ghost" data-ext="${esc(n.spectrum_url)}">Spectrum thread ${PH_IC.ext}</button>`:""}
      <span class="ph-sub">${n.date?`Posted ${esc(phAgo(n.date))}`:""}</span></div>`;
  return hubCard("notes","2 & 3","Patch notes",title,body,"span2",seg); }

// ---- 4. store: what RSI added lately, and special editions on sale now
function phStore(h){ const st=h.store||{}, N=st.new||[], SP=st.special||[], LT=st.latest||[];
  const row=(x,tag)=>`<button class="ph-item" ${x.url?`data-ext="${esc(x.url)}"`:""}><span class="pic">${phPic(x.name)}</span>
    <span class="t"><b>${esc(x.name)}</b><small>${esc(x.kind)}${tag?` · ${esc(tag)}`:""}</small></span><span class="p">${typeof usd==="function"?usd(x.price):"$"+x.price}</span></button>`;
  const fresh=N.slice(0,6).map(x=>row(x,`added ${phAgo(x.added)}`)).join("");
  const body=(fresh?`<div class="ph-lbl">Just added</div>${fresh}`:"")
    +(LT.length?`<div class="ph-lbl" ${fresh?'style="margin-top:14px"':""}>Newest ships in the store</div>${LT.slice(0,fresh?3:5).map(x=>row({...x,kind:"Standalone ship"})).join("")}`:"")
    +(SP.length?`<div class="ph-lbl" style="margin-top:14px">Special editions on sale</div>${SP.slice(0,4).map(x=>row(x)).join("")}`:"")
    +(!fresh&&!LT.length&&!SP.length?phEmpty("Couldn't read the RSI store this time."):"")
    +`<div class="ph-sub" style="margin-top:6px">Ships and ship editions only. Quantum checks the store every 30 minutes and lists anything RSI adds here.</div>`;
  return hubCard("store","4","RSI Store","Pledge Store",body,"",phSrc(h.links?.store)); }

// ---- 5. up and coming: on the PTU now, in concept, new this patch
function phPipe(h){ const P=h.pipeline||{};
  const col=(k,name,cls,empty)=>{ const c0=P[k]||{n:0,ships:[]}, sh=phUniq(c0.ships), c={...c0,ships:sh,n:k==="new"?sh.length:c0.n};
    return `<div class="ph-col ${cls}"><div class="hd"><span>${name}</span><span class="ph-chip">${c.n||0}</span></div>
      ${(c.ships||[]).slice(0,8).map(s=>`<div class="ph-pship">${phShipName(s)}<small>${esc(s.maker||"")}</small></div>`).join("")||`<div class="ph-none" style="padding:4px 2px">${empty}</div>`}
      ${(c.n||0)>8?`<div class="ph-more">+ ${c.n-8} more</div>`:""}</div>`; };
  return hubCard("pipe","5","Up and coming","Ship pipeline",`<div class="ph-pipe">${col("concept","In concept","c1","None listed")}${col("new","New this patch","c4","None this patch")}</div>`,
    "span3",phSrc(h.links?.pipeline)); }

function phRerender(){ const P=$("ph-panel"), top=P?.scrollTop||0; renderPatchHub(); if(P) P.scrollTop=top; }
function renderPatchHub(){
  const P=$("ph-panel"); if(!P) return;
  const h=S.ph.data;
  if(h&&S.ph.ship){ P.innerHTML=phShipPage(S.ph.ship); renderPhSide(); return; }
  if(!h){ P.innerHTML=`<div class="empty"><strong>Couldn't load the Patch Hub</strong>${esc(S.ph.error||"")}<div style="margin-top:12px"><button class="btn" data-phrefresh="1">Try again</button></div></div>`; renderPhSide(); return; }
  const g=S.ph.game||{}, live=h.live||{}, ptu=h.ptu;
  const W=k=>S.ph.building&&!h[k];                                  // a section the build hasn't reached yet
  const wait=(id,label,title,cls)=>`<section class="ph-card ${cls} ph-waiting" id="ph-${id}"><div class="ph-hd"><div><div class="ph-lbl">${label}</div><h3>${title}</h3></div></div><div class="ph-none"><span class="ph-spin" aria-hidden="true"></span> Loading…</div></section>`;
  const bad=Object.entries(h.sources||{}).filter(([k,v])=>v&&!v.ok&&k!=="versions");
  const names={comm_links:"RSI news",notes:"patch notes",ships:"new ships",pipeline:"ship pipeline",events:"events",store:"RSI store"};
  P.innerHTML=`<div class="ph-wrap">
    <header class="ph-head"><div><div class="ph-lbl">Patch Hub · Briefing</div><h2>What’s New</h2>
        <div class="ph-sub">From RSI and the Star Citizen Wiki${S.ph.source==="server"?", gathered by the Quantum server":""} · ${S.ph.building?"still loading…":`updated ${esc(phAgo(h.at))}`}</div></div>
      <div class="ph-vers">
        <button class="ph-ver live" ${live.url?`data-ext="${esc(live.url)}"`:""} title="LIVE patch notes"><i></i><span><small>LIVE</small><b>${esc(phVer(live))}</b></span></button>
        ${ptu?`<button class="ph-ver ptu" ${ptu.url?`data-ext="${esc(ptu.url)}"`:""} title="PTU patch notes"><i></i><span><small>${esc(ptu.channel||"PTU")}${ptu.wave?` · ${esc(ptu.wave)}`:""}</small><b>${esc(phVer(ptu))}</b></span></button>`
          :`<div class="ph-ver off"><i></i><span><small>PTU</small><b>None running</b></span></div>`}
        ${g.version?`<div class="ph-ver you"><span><small>Your game</small><b>${esc(g.version)}${g.env?` ${esc(g.env)}`:""}</b></span></div>`:""}
        <button class="btn" id="ph-refresh" data-phrefresh="1">${PH_IC.refresh}<span> Refresh</span></button></div></header>
    ${bad.length?`<div class="note ph-warn">Couldn't update ${bad.map(([k,v])=>`${esc(names[k]||k)}${v.last_ok?` (showing the copy from ${esc(phAgo(v.last_ok))})`:""}`).join(", ")} this time.</div>`:""}
    ${W("events")?wait("events","Events","What’s on in the ’verse",""):phEvents(h)}
    <div class="ph-grid">${W("ships")?wait("ships","1 · New in this patch","Ships &amp; vehicles added","span2"):phShips(h)}${W("store")?wait("store","4 · RSI Store","New in the Pledge Store",""):phStore(h)}${W("notes")?wait("notes","2 & 3 · Patch notes","Patch notes","span2"):phNotes(h)}${W("pipeline")?wait("pipe","5 · Up and coming","Ship pipeline","span3"):phPipe(h)}</div>
    <div class="uex-credit ph-credit">Game data from the <a data-ext="https://api.star-citizen.wiki">Star Citizen Wiki API</a> (api.star-citizen.wiki) and RSI. Event dates are read from RSI’s posts: check the post for exact times. Store prices are in USD and change with sales.</div>
  </div>`;
  renderPhSide(); }

function renderPhSide(){
  const h=S.ph.data, el=$("pane-patchhub"); if(!el) return;
  if(!h){ el.innerHTML=""; return; }
  const src=h.sources||{}, L=h.links||{}, ok=k=>src[k]?.ok!==false;
  const nEv=(h.events?.list||[]).filter(e=>e.state==="live").length;
  const jump=[["events","Events",nEv?`${nEv} on now`:""],["ships","New ships",(h.ships?.list||[]).length],["store","RSI Store",(h.store?.new||[]).length],["notes","Patch notes",""],["pipe","Upcoming ships",""]];
  const srcs=[["notes","LIVE patch notes",/comm-link/i.test(L.notes||"")?"RSI Comm-Link":"RSI Spectrum",L.notes],...(L.notes_ptu?[["notes","PTU patch notes","RSI Spectrum",L.notes_ptu]]:[]),
    ["ships","New ships","Star Citizen Wiki",L.ships],["events","Events","RSI Comm-Links",L.events],["store","Store","RSI upgrade tool",L.store],["pipeline","In concept","RSI Ship Matrix",L.pipeline]];
  el.innerHTML=`<div class="ph-side">${S.ph.building?`<div class="mk-h" style="margin-top:0">Loading</div>${phSteps()}`:""}
    <div class="ph-sv"><button ${h.live?.url?`data-ext="${esc(h.live.url)}"`:""}><small>LIVE</small><b>${esc(phVer(h.live))}</b>${h.live?.build?`<span>build ${esc(h.live.build)}</span>`:""}</button>
      <button class="${h.ptu?"":"off"}" ${h.ptu?.url?`data-ext="${esc(h.ptu.url)}"`:""}><small>PTU</small><b>${h.ptu?esc(phVer(h.ptu)):"–"}</b><span>${h.ptu?esc(h.ptu.wave||(h.ptu.build?`build ${h.ptu.build}`:"")||h.ptu.channel||""):"None running"}</span></button></div>
    <div class="mk-h">On this page</div>
    <div class="ph-jump">${jump.map(([id,t,n])=>`<button data-phjump="${id}"><span>${t}</span>${n?`<b>${n}</b>`:""}</button>`).join("")}</div>
    <div class="mk-h">Sources</div>
    <div class="ph-srcs">${srcs.map(([k,t,s,u])=>`<button ${u?`data-ext="${esc(u)}"`:"disabled"} title="${u?"Open where this came from":""}"><span class="dot ${ok(k)?"on":"bad"}"></span><span>${t}</span><small>${s}${u?" ↗":""}</small></button>`).join("")}</div>
    <div class="cc-foot">Quantum gathers this from publicly available sources (RSI and the Star Citizen Wiki). It may not always be 100% accurate and can change, so please check the sources above before relying on it. Updated ${esc(phAgo(h.at))}.</div></div>`; }

// a drop reward's key for the "claimed" tick: its campaign (or event) and its name
const phDropKey=(e,r)=>`${e.campaign||e.name||""}|${r.name||""}`.slice(0,200);
// one click handler for the page and the sidebar
for(const id of ["ph-panel","pane-patchhub"]){ const el=$(id); if(!el) continue;
  el.addEventListener("click",e=>{ const t=e.target.closest("button,a"); if(!t||t.disabled) return;
    if(t.dataset.phveh!==undefined) return phOpenShip(t.dataset.phveh);
    if(t.dataset.phshipback) return phShipBack();
    if(t.dataset.ext) return api().open_url(t.dataset.ext);
    if(t.dataset.phrefresh) return openPatchHub(true);
    if(t.dataset.phclaim!==undefined){ const k=t.dataset.phclaim, on=!(S.ph.claimed||[]).includes(k);
      S.ph.claimed=on?[...(S.ph.claimed||[]),k]:(S.ph.claimed||[]).filter(x=>x!==k); phRerender();     // ticked straight away
      api().patchhub_claim(k,on).then(r=>{ if(r?.ok) S.ph.claimed=r.claimed; else toast(r?.error||"Couldn't save that"); }).catch(()=>{});
      return; }
    if(t.dataset.phb){ S.ph.build=t.dataset.phb; return phRerender(); }
    if(t.dataset.phfull){ S.ph.full=!S.ph.full; renderPatchHub(); return $("ph-notes")?.scrollIntoView({block:"start",behavior:"smooth"}); }
    if(t.dataset.phjump){ if(S.ph.ship){ S.ph.ship=null; renderPatchHub(); } return $(`ph-${t.dataset.phjump}`)?.scrollIntoView({block:"start",behavior:"smooth"}); } }); }
// leaving Vehicles for anywhere but Patch Hub: no "Back to Patch Hub" any more
for(const t of document.querySelectorAll(".tab")) t.addEventListener("click",()=>{ if(t.dataset.tab!=="vehicles"&&S.vehFrom){ S.vehFrom=null; S.vehGalKey=null; } });

// a little after start-up: fetch it in the background so the rail can show how many things are new
setTimeout(()=>{ if(!S.ph.data&&window.pywebview?.api?.patchhub_get) phLoad(false).catch(()=>{}); },9000);
setInterval(()=>{ if(window.pywebview?.api?.patchhub_get&&S.tab!=="patchhub") phLoad(false).catch(()=>{}); },20*60*1000);
// the countdowns tick while the page is open
setInterval(()=>{ if(S.tab==="patchhub"&&S.ph.data&&!document.querySelector("#ph-panel :focus")) phRerender(); },60*1000);
