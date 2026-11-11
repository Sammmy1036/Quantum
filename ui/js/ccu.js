// Quantum UI: Ship upgrades (CCUs).
// One of several classic scripts sharing one global scope; index.html loads them in order.
"use strict";
// =================================================================== Upgrades (CCUs)
// Pick the ship you have and the one you want: Quantum finds the cheapest chain of upgrades on sale now
// (RSI's own upgrade prices, via the Star Citizen Wiki). With none on sale, it points to The Impound.
const usd=n=>n==null?"–":`$${(+n).toLocaleString(undefined,{minimumFractionDigits:+n%1?2:0,maximumFractionDigits:2})}`;
const IC_ARROW='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h15M13 6l6 6-6 6"/></svg>';
S.cc=S.cc||{from:"",to:"",warbond:true,pics:{}};
async function openCcu(){
  if(!S.ccShips){ $("cc-panel").innerHTML=qLoader("Loading ship upgrade prices…"); $("cc-side").innerHTML="";
    const r=await api().ccu_ships(); if(S.tab!=="ccu"&&!r.ok) return;
    if(!r.ok){ $("cc-panel").innerHTML=`<div class="empty"><strong>Couldn't load upgrade prices</strong>${esc(r.error)}<div style="margin-top:12px"><button class="btn" data-cc="retry">Try again</button></div></div>`; return; }
    S.ccShips=r.ships; S.ccAt=r.at; S.ccSource=r.source;
    if(!S.cc.from){ const m=r.ships.filter(x=>x.mine); const main=S.fleet?.find(f=>f.main); 
      S.cc.from=(main&&m.find(x=>x.uex_id===main.vehicle_id)?.name)||m[0]?.name||""; } }
  renderCcu(); }
const ccShip=n=>S.ccShips?.find(x=>x.name===n);
function ccPic(x,who){
  if(!x) return `<div class="cc-pic">${who==="from"?"Pick the ship you have":"Pick the ship you want"}</div>`;
  const u=x.photo||S.cc.pics[x.name];
  if(u===undefined&&!x.photo){ S.cc.pics[x.name]=null; api().ccu_photo(x.name).then(r=>{ S.cc.pics[x.name]=r?.photo||""; if(S.tab==="ccu") renderCcu(); }); }
  return `<div class="cc-pic">${u?`<img src="${esc(u)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">`:u===null?qPic():`<div class="ph-art ph-grid-bg" style="position:absolute;inset:0">${phSvg("vehicle")}</div>`}
    <div class="cc-cap"><div><b>${esc(x.name)}</b><br><span>${esc(x.maker)}${x.status?` · ${esc(x.status)}`:""}</span></div><span class="v">${usd(x.value)}</span></div></div>`; }
function ccLinks(x){ if(!x) return "";
  const veh=x.uex_id&&!document.querySelector('.tab[data-tab="vehicles"]')?.hidden;
  return `<span class="row lk" style="gap:6px">${veh?`<button class="btn small ghost" data-ccveh="${x.uex_id}" title="Open it in the Vehicles tab">Ship info</button>`:""}${x.store?`<button class="btn small ghost" data-ext="${esc(x.store)}" title="Its page on the RSI pledge store">RSI page</button>`:""}</span>`; }
function renderCcuSide(){
  const mine=(S.ccShips||[]).filter(x=>x.mine);
  $("cc-side").innerHTML=`<div class="cc-side">
    <div class="note">Pick the ship you have and the one you want. Quantum finds the cheapest chain of upgrades (CCUs) on sale on the RSI store right now.</div>
    ${S.ccSource==="wiki"?`<div class="note cc-stale">Couldn't reach RSI's upgrade tool, so these are straight upgrades at each ship's current price, from the Star Citizen Wiki. Warbond and sale upgrades are left out: the wiki's list of those is out of date.</div>`
      :`<label class="chk"><input type="checkbox" id="cc-wb" ${S.cc.warbond?"checked":""}><span><b>Use Warbond upgrades</b><br><span class="muted">Cheaper, but paid with new money only (no store credit)</span></span></label>`}
    ${mine.length?`<div class="mk-h">Your ships</div><div class="cc-mine">${mine.map(x=>`<button data-ccfrom="${esc(x.name)}" class="${x.name===S.cc.from?"on":""}"><span>${esc(x.name)}</span><small>${usd(x.value)}</small></button>`).join("")}</div>`
      :`<div class="muted" style="font-size:12.5px;margin:10px 2px">Ships you add to My Fleet show up here, ready to pick.</div>`}
    <div class="cc-foot">${S.ccSource==="wiki"?"Prices from the Star Citizen Wiki":"Prices live from RSI's upgrade tool"}${S.ccAt?`, checked ${new Date(S.ccAt*1000).toLocaleString()}`:""}. Sales change daily: check the price on the RSI store before you buy.</div></div>`; }
async function renderCcu(){
  if(!S.ccShips) return; renderCcuSide();
  const ships=S.ccShips, a=ccShip(S.cc.from), b=ccShip(S.cc.to);
  const ups=a?ships.filter(x=>x.value>a.value):ships;
  $("cc-panel").innerHTML=`<div class="gh vh-head"><b>Ship upgrades</b><span>The cheapest way from the ship you have to the one you want</span></div>
    <div class="cc-pair"><div class="cc-col"><label for="cc-from">Your ship</label>${ccCombo("from",ships,a,"Type or pick your ship…")}${ccPic(a,"from")}<div style="margin-top:8px">${ccLinks(a)}</div></div>
      <div class="cc-arrow">${IC_ARROW}</div>
      <div class="cc-col"><label for="cc-to">Ship you want</label>${ccCombo("to",ups,b&&ups.includes(b)?b:null,a?`Type or pick a ship worth more than ${usd(a.value)}…`:"Type or pick the ship you want…")}${ccPic(b&&ups.includes(b)?b:null,"to")}<div style="margin-top:8px">${ccLinks(b&&ups.includes(b)?b:null)}</div></div></div>
    <div id="cc-out"></div>`;
  if(!a||!b||!ups.includes(b)) return;
  $("cc-out").innerHTML=qLoader("Checking upgrades with RSI…");
  const key=[a.name,b.name,S.cc.warbond].join("|"); S.ccKey=key;
  const r=await api().ccu_path(a.name,b.name,S.cc.warbond); if(S.ccKey!==key) return;
  $("cc-out").innerHTML=ccResult(r,a,b); }
function ccResult(r,a,b){
  const impound=`<div class="row" style="gap:8px;margin-top:12px;flex-wrap:wrap"><button class="btn go" data-ext="${esc(r.impound)}">Search The Impound for the ${esc(b.name)}</button>${b.store?`<button class="btn ghost" data-ext="${esc(b.store)}">RSI page</button>`:""}</div>
    <div class="cc-foot">The Impound is a grey-market store that sells ships and upgrades people bought earlier, including ones RSI doesn't sell now. It isn't run by RSI.</div>`;
  if(r.ok){ const st=r.steps, one=st.length===1;
    return `<div class="cc-res"><div class="cc-sum"><div><div class="n">${usd(r.total)}</div><div class="k">${one?"one upgrade":`${st.length} upgrades in a row`}</div></div>
      ${r.saved>0?`<div class="save"><div class="n">${usd(r.saved)}</div><div class="k">saved vs a straight upgrade (${usd(r.direct)})</div></div>`:`<div><div class="n" style="font-size:18px;color:var(--ink-2)">Straight upgrade is cheapest</div><div class="k">no chain beats it right now</div></div>`}</div>
      ${st.map((x,i)=>{ const to=ccShip(x.to); return `<div class="cc-step"><span class="i">${i+1}</span><div class="t"><div>${esc(x.from)} → <b>${esc(x.to)}</b></div>
        <div class="ed">${esc(x.edition)}${x.warbond?'<span class="wb">Warbond</span>':""}</div></div><span class="p" ${x.rsi_price||!r.checked?"":`title="RSI didn't confirm this price"`}>${usd(x.price)}${x.rsi_price||!r.checked?"":"*"}</span>${ccLinks(to)}</div>`; }).join("")}
      <div class="cc-foot">Buy them in order on the RSI store and apply each one to the ship from the step before.${st.some(x=>x.warbond)?" Warbond upgrades can only be paid with new money, not store credit.":""} ${r.checked?(r.prices_checked?" Every step and price checked with RSI's upgrade tool just now.":" Prices with * couldn't be confirmed with RSI: check them on the RSI store."):" These are straight upgrades only, from the Star Citizen Wiki: RSI couldn't be reached to check sale upgrades."} Prices can change.</div></div>`; }
  if(r.reason==="unavailable"||r.reason==="none") return `<div class="cc-res cc-warn"><h3>No upgrade to the ${esc(b.name)} is on sale right now</h3>
    <div class="muted" style="line-height:1.55">${r.reason==="unavailable"?(r.warbond_only?"There's a Warbond upgrade to it on sale: tick <b>Use Warbond upgrades</b> to see it.":`RSI isn't selling an upgrade to it at the moment. Ships like this often come back during sales (Invictus, IAE, anniversaries).`):`RSI's upgrade tool doesn't sell an upgrade to it from the ${esc(a.name)}, or from any ship you could upgrade it to first.`}</div>${r.warbond_only?"":impound}</div>`;
  if(r.reason==="unchecked") return `<div class="cc-res cc-warn"><h3>Couldn't check upgrades with RSI</h3><div class="muted">RSI's upgrade tool didn't answer, so Quantum can't tell which upgrades you can buy from your ship. Try again in a minute.</div><div style="margin-top:12px"><button class="btn" data-cc="again">Try again</button></div></div>`;
  if(r.reason==="downgrade") return `<div class="cc-res cc-warn"><h3>Upgrades only go up in value</h3><div class="muted">The ${esc(b.name)} (${usd(r.to_value)}) isn't worth more than your ${esc(a.name)} (${usd(r.from_value)}).</div></div>`;
  return `<div class="cc-res"><div class="muted">${r.reason==="same"?"That's the ship you already have.":"Couldn't find one of those ships."}</div></div>`; }
// ---- The two ship pickers: type to filter (name or maker, any order), or open the full list with the arrow.
// Up/Down move, Enter picks, Esc closes. Ships in My Fleet come first, then each maker's, by value.
S.ccLists=S.ccLists||{};
const ccKey=t=>String(t||"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
function ccCombo(which,list,cur,ph){ S.ccLists[which]=list;
  return `<div class="cc-combo" data-ccw="${which}"><input class="field" id="cc-${which}" value="${cur?esc(cur.name):""}" placeholder="${esc(ph)}" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="false" aria-controls="cc-${which}-list">
    <button type="button" class="cc-caret" tabindex="-1" aria-label="Show every ship"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button>
    <div class="cc-list" id="cc-${which}-list" role="listbox" hidden></div></div>`; }
function ccMatches(which,q){ const words=ccKey(q).split(" ").filter(Boolean), list=S.ccLists[which]||[];
  const hit=words.length?list.filter(x=>{ const k=` ${ccKey(x.name+" "+x.maker)} `; return words.every(w=>k.includes(" "+w)||k.includes(w)); }):list;
  const by=(a,b)=>a.value-b.value||a.name.localeCompare(b.name), mine=hit.filter(x=>x.mine).sort(by), makers={};
  for(const x of hit) (makers[x.maker||"Other"]=makers[x.maker||"Other"]||[]).push(x);
  return [...(mine.length?[["In My Fleet",mine]]:[]),...Object.keys(makers).sort().map(m=>[m,makers[m].sort(by)])]; }
function ccOpen(which,q){ const box=document.querySelector(`.cc-combo[data-ccw="${which}"]`); if(!box) return;
  const L=box.querySelector(".cc-list"), inp=box.querySelector("input"), groups=ccMatches(which,q), flat=groups.flatMap(g=>g[1]);
  S.ccOpen={which,flat,act:Math.min(S.ccOpen?.which===which?S.ccOpen.act:0,Math.max(0,flat.length-1))};
  let i=0;
  L.innerHTML=flat.length?groups.map(([g,xs])=>`<div class="cc-grp">${esc(g)}</div>${xs.map(x=>`<div class="cc-opt ${i===S.ccOpen.act?"act":""}" role="option" data-ccpick="${esc(x.name)}" data-i="${i++}"><span>${esc(x.name)}</span><small>${usd(x.value)}${x.on_sale?"":" · no upgrade on sale"}</small></div>`).join("")}`).join("")
    :`<div class="cc-none">No ship matches “${esc(q)}”</div>`;
  L.hidden=false; inp.setAttribute("aria-expanded","true"); L.querySelector(".cc-opt.act")?.scrollIntoView({block:"nearest"}); }
function ccClose(which){ const box=document.querySelector(`.cc-combo[data-ccw="${which}"]`); if(!box) return;
  box.querySelector(".cc-list").hidden=true; box.querySelector("input").setAttribute("aria-expanded","false"); if(S.ccOpen?.which===which) S.ccOpen=null; }
function ccPick(which,name){ S.cc[which]=name; S.ccOpen=null; renderCcu(); }
const ccWhich=e=>e.target.closest(".cc-combo")?.dataset.ccw;
$("cc-panel").addEventListener("focusin",e=>{ const w=ccWhich(e); if(!w||e.target.tagName!=="INPUT") return;
  e.target.select(); ccOpen(w,""); });
$("cc-panel").addEventListener("input",e=>{ const w=ccWhich(e); if(!w) return; S.ccOpen=null; ccOpen(w,e.target.value); });
$("cc-panel").addEventListener("mousedown",e=>{ const w=ccWhich(e); if(!w) return;
  const o=e.target.closest("[data-ccpick]"); if(o){ e.preventDefault(); return ccPick(w,o.dataset.ccpick); }
  if(e.target.closest(".cc-caret")){ e.preventDefault(); const inp=e.target.closest(".cc-combo").querySelector("input");
    if(document.activeElement===inp&&!e.target.closest(".cc-combo").querySelector(".cc-list").hidden) return ccClose(w);
    inp.focus(); ccOpen(w,""); } });
$("cc-panel").addEventListener("keydown",e=>{ const w=ccWhich(e); if(!w||e.target.tagName!=="INPUT") return; const o=S.ccOpen;
  if(e.key==="ArrowDown"||e.key==="ArrowUp"){ e.preventDefault(); if(!o||o.which!==w) return ccOpen(w,e.target.value);
    o.act=Math.max(0,Math.min(o.flat.length-1,o.act+(e.key==="ArrowDown"?1:-1))); ccOpen(w,e.target.value); }
  else if(e.key==="Enter"){ e.preventDefault(); const x=o?.which===w?o.flat[o.act]:null; if(x) ccPick(w,x.name); }
  else if(e.key==="Escape"){ e.preventDefault(); ccClose(w); e.target.value=S.cc[w]||""; e.target.blur(); } });
$("cc-panel").addEventListener("focusout",e=>{ const w=ccWhich(e); if(!w||e.target.tagName!=="INPUT") return;
  // A pick redraws the pickers, which takes the focus off this (now old) box: that's no reason to pick again
  // from what was left in it (it still held the ship picked before, which undid the pick)
  setTimeout(()=>{ if(document.activeElement===e.target||!e.target.isConnected) return; ccClose(w);
    // typed a ship's exact name and left the box: that's a pick; anything else goes back to the ship picked before
    const exact=(S.ccLists[w]||[]).find(x=>ccKey(x.name)===ccKey(e.target.value));
    if(exact&&exact.name!==S.cc[w]) return ccPick(w,exact.name);
    e.target.value=S.cc[w]&&(S.ccLists[w]||[]).some(x=>x.name===S.cc[w])?S.cc[w]:""; },120); });
$("cc-side").onchange=e=>{ if(e.target.id==="cc-wb"){ S.cc.warbond=e.target.checked; renderCcu(); } };
$("cc-side").onclick=e=>{ const f=e.target.closest("[data-ccfrom]"); if(f){ S.cc.from=f.dataset.ccfrom; renderCcu(); } };
$("cc-panel").onclick=e=>{
  const x=e.target.closest("[data-ext]"); if(x) return api().open_url(x.dataset.ext);
  if(e.target.closest("[data-cc=retry]")){ S.ccShips=null; return openCcu(); }
  if(e.target.closest("[data-cc=again]")) return renderCcu();
  const v=e.target.closest("[data-ccveh]"); if(v){ S.vehDetail=String(v.dataset.ccveh); S.vehGalKey=null; document.querySelector('.tab[data-tab="vehicles"]')?.click(); } };
