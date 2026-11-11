// Quantum UI: Data sync, Add to cart, and weapons, armor and blueprints from the Star Citizen Wiki.
// One of several classic scripts sharing one global scope; index.html loads them in order.
"use strict";
// =================================================================== data sync
// A Lagrange point in the data is only the zone's centre (it has no QT marker); the place you actually
// quantum to is the station built there. Stanton's R&R stations sit 1,000-23,000 km off their L-point's
// centre, and most of Pyro's are pinned right on it, so the map showed two markers for one place.
// Each station gets its L-point (L.atLpoint) and the L-point is folded into it (L.mergedInto): its marker
// is hidden and searching "CRU-L1" finds the station. L-points with no station (CRU-L2, CRU-L3, ...) stay.
function linkLpoints(){
  const lps=S.locs.filter(L=>L.type==="lpoint"&&L.pos);
  const sts=S.locs.filter(L=>L.kind==="space"&&L.pos&&L.source==="db"&&L.type==="station");   // not clouds or mining claims
  for(const P of lps){ const code=P.name.toLowerCase(), word=new RegExp(`(^|[^a-z0-9])${code.replace(/[-]/g,"\\-")}([^a-z0-9]|$)`,"i");
    const at=sts.filter(T=>T.system===P.system&&(()=>{ const d=d3(T.pos,P.pos); return d<1e6||(word.test(T.name)&&d<5e7); })());
    if(!at.length) continue;
    at.sort((a,b)=>d3(a.pos,P.pos)-d3(b.pos,P.pos));
    P.mergedInto=at[0].name; for(const T of at) T.atLpoint=P.name; } }
async function loadStatic(){
  const st=await api().get_static(); S.staticVersion=st.version; S.systems=st.systems||S.systems; S.wiki=st.wiki;
  S.bodies=st.bodies; S.bodyMap=Object.fromEntries(st.bodies.map(b=>[b.name,b])); S.locs=st.locations; S.locMap=Object.fromEntries(st.locations.map(l=>[l.name,l])); linkLpoints(); S.svcCache={}; renderOffmap();
  $("places-dl").innerHTML=S.locs.filter(L=>L.source==="db"&&L.pos&&L.type!=="om"&&L.type!=="lpoint").map(L=>`<option value="${esc(L.name)}">${esc(L.body||L.system)}</option>`).join("");
  buildSystem(); renderResults(); renderWaypoints(true); renderSysSeg(); if(S.selected) renderDetail(); }
// The UEX tabs only appear once a UEX token is saved; removing it hides them again.
// =================================================================== Add to cart
// A cart button on any part, weapon or armor piece you can buy (Components, My Fleet, Weapons, Armor). What's in
// the cart becomes one shopping trip in the Cart tab: the fewest stops, in the shortest order from where you are.
const CART_SVG='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h2l2.2 10.2a1.5 1.5 0 0 0 1.5 1.2h8.6a1.5 1.5 0 0 0 1.5-1.1L20.5 8H6.2"/><circle cx="9.5" cy="19.5" r="1.4"/><circle cx="17" cy="19.5" r="1.4"/></svg>';
function cartBtn(x,label){ return `<button class="cart-btn ${label?"lab":""}" data-cart="${esc(JSON.stringify(x))}" title="Add ${esc(x.name)} to your cart">${CART_SVG}${label?`<span>${esc(label)}</span>`:""}</button>`; }
function setCartCount(n){ const c=$("c-cart"); if(!c) return; c.textContent=n||0; c.hidden=!n;
  const r=$("rail-cart-n"); if(r){ r.textContent=n||0; r.hidden=!n; } }
async function addToCart(items,what){ const r=await api().shop_add(items); if(!r.ok) return toast(r.error);
  setCartCount(r.left); S.cartToastN=(S.cartToastN||0)+1;
  toast(`${what||items[0].name} added to your cart · ${plural(r.left,"item")} in it. Open Cart to see the route`); return r; }
// Captured first, so a cart button inside a clickable card or table row doesn't also open it
document.addEventListener("click",async e=>{ const b=e.target.closest("[data-cart]"); if(!b) return; e.stopPropagation(); e.preventDefault();
  let x; try{ x=JSON.parse(b.dataset.cart); }catch(_){ return; }
  b.classList.add("added"); setTimeout(()=>b.classList.remove("added"),1200);
  await addToCart(Array.isArray(x)?x:[x],Array.isArray(x)?`${plural(x.length,"item")}`:null); },true);

// =================================================================== Weapons, Armor, Blueprints (Star Citizen Wiki)
// One way of browsing for all three: the sidebar has search, filters and a list; the panel over the map has
// the pictures, and a page for whatever you click. Armor can also be looked at as whole sets.
const GR_PCT=n=>`${nf(n)}%`;
const GEAR={
  weapons:{title:"Personal weapons",noun:"weapon",ph:"Name, maker or kind, like “P4-AR” or “sniper”",
    cat:i=>i.kind||"Other",catLab:"Kind",sub:i=>i.cls||"",subLab:"Ammo",
    key:i=>[i.stats?.dps!=null?`${Math.round(i.stats.dps).toLocaleString()} DPS`:"",i.stats?.range?`${Math.round(i.stats.range).toLocaleString()} m`:"",i.stats?.mag?`${i.stats.mag} rounds`:""].filter(Boolean).join(" · "),
    sorts:[["name","A–Z"],["dps","Most DPS"],["alpha","Most damage per shot"],["range","Longest range"],["rpm","Fastest fire rate"],["price","Price: low to high"]],
    hero:i=>[{label:"DPS",value:i.stats?.dps!=null?Math.round(i.stats.dps).toLocaleString():null},{label:"Per shot",value:i.stats?.alpha!=null?nf(i.stats.alpha):null},
      {label:"Range",value:i.stats?.range?`${Math.round(i.stats.range).toLocaleString()} m`:null},{label:"Price",value:i.buy?.[0]?money(i.buy[0].price):"Not in shops"}],
    rows:[["rpm","Fire rate",n=>`${Math.round(n)} rpm`],["mag","Magazine",n=>`${n} rounds`],["speed","Projectile speed",n=>`${Math.round(n).toLocaleString()} m/s`],
      ["pellets","Pellets per shot",n=>n],["mass","Mass",n=>`${nf(n)} kg`]]},
  armor:{title:"Armor",noun:"piece",ph:"Name or maker, like “ADP”, “Pembroke” or “helmet”",
    cat:i=>i.slot||"Other",catLab:"Piece",sub:i=>i.weight||"",subLab:"Weight",
    key:i=>[i.stats?.dr!=null?`${nf(i.stats.dr)}% damage reduction`:"",i.stats?.temp_min!=null?`${i.stats.temp_min}° to ${i.stats.temp_max}°C`:""].filter(Boolean).join(" · "),
    sorts:[["name","A–Z"],["dr","Most damage reduction"],["carry","Most carrying space"],["cold","Handles the most cold"],["hot","Handles the most heat"],["price","Price: low to high"]],
    hero:i=>[{label:"Damage reduction",value:i.stats?.dr!=null?GR_PCT(i.stats.dr):null},{label:"Temperature",value:i.stats?.temp_min!=null?`${i.stats.temp_min}° to ${i.stats.temp_max}°C`:null},
      {label:"Carrying",value:i.stats?.carry?`${Math.round(i.stats.carry).toLocaleString()} µSCU`:null},{label:"Price",value:i.buy?.[0]?money(i.buy[0].price):"Not in shops"}],
    rows:[["rad","Radiation protection",n=>`${Math.round(n).toLocaleString()} REM`],["rad_rate","Radiation scrub rate",n=>`${nf(n)} REM/s`],
      ["em","EM signature",n=>nf(n)],["mass","Mass",n=>`${nf(n)} kg`]]},
  blueprints:{title:"Blueprints",noun:"blueprint",ph:"What it makes or needs, like “Omnisky” or “Agricium”",
    cat:i=>i.category||"Other",catLab:"Makes",sub:i=>i.default?"Known from the start":"Unlocked by missions",subLab:"How you get it",
    key:i=>[i.time_label||"",i.ingredients?.length?plural(i.ingredients.length,"ingredient"):""].filter(Boolean).join(" · "),
    sorts:[["name","A–Z"],["time","Quickest to craft"],["ings","Fewest ingredients"]],
    hero:i=>[{label:"Craft time",value:i.time_label||(i.time?`${Math.round(i.time/60)} min`:null)},{label:"Ingredients",value:i.ingredients?.length??null},
      {label:"Grade",value:i.grade||null},{label:"How you get it",value:i.default?"Known":"Missions"}],
    rows:[]},
  // The newer tabs: one way of showing them; what each has to say comes from the wiki's own numbers and rows
  gadgets:{title:"Gadgets",noun:"gadget",ph:"Name, maker or kind, like “multi-tool”, “cutter” or “Greycat”",
    cat:i=>i.kind||"Other",catLab:"Kind",
    key:i=>[i.paints?.length?plural(i.paints.length+1,"paint"):"",...(i.facts||[]).slice(0,2).map(([a,b])=>`${a}: ${b}`)].filter(Boolean).join(" · "),
    sorts:[["name","A–Z"],["price","Price: low to high"],["mass","Lightest"]],
    hero:i=>[{label:"Kind",value:i.kind},{label:"Maker",value:i.maker||null},{label:"Price",value:i.buy?.[0]?money(i.buy[0].price):"Not in shops"}],
    rows:[["carry","Carrying",n=>`${Math.round(n).toLocaleString()} µSCU`],["mass","Mass",n=>`${nf(n)} kg`]]},
  clothing:{title:"Clothing",noun:"piece",ph:"Name, maker or piece, like “jacket” or “Escar”",
    cat:i=>i.kind||"Other",catLab:"Piece",
    key:i=>[i.stats?.temp_min!=null?`${i.stats.temp_min}° to ${i.stats.temp_max}°C`:"",i.stats?.carry?`${Math.round(i.stats.carry).toLocaleString()} µSCU`:""].filter(Boolean).join(" · "),
    sorts:[["name","A–Z"],["carry","Most carrying space"],["cold","Handles the most cold"],["hot","Handles the most heat"],["price","Price: low to high"]],
    hero:i=>[{label:"Temperature",value:i.stats?.temp_min!=null?`${i.stats.temp_min}° to ${i.stats.temp_max}°C`:null},
      {label:"Carrying",value:i.stats?.carry?`${Math.round(i.stats.carry).toLocaleString()} µSCU`:null},{label:"Price",value:i.buy?.[0]?money(i.buy[0].price):"Not in shops"}],
    rows:[["dr","Damage reduction",n=>GR_PCT(n)],["rad","Radiation protection",n=>`${Math.round(n).toLocaleString()} REM`],["mass","Mass",n=>`${nf(n)} kg`]]},
  consumables:{title:"Consumables",noun:"item",ph:"Name or kind, like “MedPen”, “burrito” or “drink”",
    cat:i=>i.kind||"Other",catLab:"Kind",
    key:i=>[i.stats?.ndr!=null?`NDR ${nf(i.stats.ndr)}`:"",i.stats?.hei!=null?`HEI ${nf(i.stats.hei)}`:"",(i.buffs||i.effects||[]).slice(0,2).join(", ")].filter(Boolean).join(" · "),
    sorts:[["name","A–Z"],["ndr","Most nutrition (NDR)"],["hei","Most hydration (HEI)"],["price","Price: low to high"]],
    hero:i=>[{label:"Nutrition (NDR)",value:i.stats?.ndr!=null?nf(i.stats.ndr):null},{label:"Hydration (HEI)",value:i.stats?.hei!=null?nf(i.stats.hei):null},
      {label:"Kind",value:i.stats?.ndr==null&&i.stats?.hei==null?i.kind:null},{label:"Price",value:i.buy?.[0]?money(i.buy[0].price):"Not in shops"}],
    rows:[["mass","Mass",n=>`${nf(n)} kg`]]},
  utility:{title:"Keys",noun:"key",ph:"Name or kind, like “cryptokey”, “keycard” or “hacking chip”",
    cat:i=>i.kind||"Other",catLab:"Kind",
    key:i=>(i.facts||[]).slice(0,2).map(([a,b])=>`${a}: ${b}`).join(" · "),
    sorts:[["name","A–Z"],["price","Price: low to high"]],
    hero:i=>[{label:"Kind",value:i.kind},{label:"Maker",value:i.maker||null},{label:"Price",value:i.buy?.[0]?money(i.buy[0].price):"Not in shops"}],
    rows:[["mass","Mass",n=>`${nf(n)} kg`]]}};
// Tabs that list things you carry (not blueprints), and the kind a cart entry gets for each
const GR_ITEM={gadgets:1,clothing:1,consumables:1,utility:1};
const GR_CART={weapons:"weapon",armor:"armor",gadgets:"gadget",clothing:"clothing",consumables:"consumable",utility:"utility"};
S.gr=S.gr||{};
const grState=k=>S.gr[k]=S.gr[k]||{data:null,loading:false,error:null,sel:null,view:k==="armor"?"sets":"items"};
async function openGear(kind){ const st=grState(kind);
  $("gr-panel").classList.add("show"); grSide(kind);
  if(st.data&&!st.filled){ st.filled=1; grFillFilters(kind); grLogos(kind); }
  if(!st.data&&!st.loading) await grLoad(kind); else grRender(kind); }
async function grLoad(kind,fresh){ const st=grState(kind); st.loading=true; st.error=null;
  $("gr-panel").innerHTML=qLoader(`Loading ${GEAR[kind].title.toLowerCase()} from the Star Citizen Wiki…`);
  let r; try{ r=await api().gear_list(kind,!!fresh); }catch(e){ r={ok:false,error:String(e)}; }
  st.loading=false; if(r.ok){ st.data=r; grFillFilters(kind); grLogos(kind); } else st.error=r.error;
  if(S.tab===kind) grRender(kind); }
// Makers of personal gear (Clark Defense Systems, Kastak Arms, Gemini…) aren't in the ship or component logo
// lists: once the list is in, the ones without a logo are looked up on the wiki and the page redrawn.
async function grLogos(kind){ const st=grState(kind); if(kind==="blueprints"||!st.data) return;
  if(!S.brands||Object.keys(S.brands).length<=Object.keys(LOCAL_BRANDS).length){ loadBrands(()=>grLogos(kind)); if(S.brands===undefined) return; }
  const seen=new Set(), want=[];
  for(const i of st.data.items){ const m=(i.maker||"").trim(); if(!m||seen.has(m.toLowerCase())) continue; seen.add(m.toLowerCase());
    if(!makerLogo(m)) want.push({name:m,code:i.maker_code||""}); }
  if(!want.length) return;
  S.logoAsked=S.logoAsked||new Set(); const ask=want.filter(m=>!S.logoAsked.has(m.name)); if(!ask.length) return;
  for(const m of ask) S.logoAsked.add(m.name);
  for(let k=0;k<ask.length;k+=25){ let r; try{ r=await api().maker_logos(ask.slice(k,k+25)); }catch(e){ r=null; }
    const got=r?.logos||{}; if(Object.keys(got).length){ S.brands={...(S.brands||{}),...got}; if(S.tab===kind&&st.sel&&!st.mission) grDetail(kind); } } }
// The sidebar's controls are made once per tab, so typing in the search box keeps its focus
function grSide(kind){ const p=$("pane-"+kind); if(p.dataset.built) return; p.dataset.built="1"; const G=GEAR[kind];
  p.innerHTML=`<input class="search" id="gr-q-${kind}" placeholder="${esc(G.ph)}" autocomplete="off">
    ${kind==="armor"?`<div class="seg-mini gr-view" id="gr-view-armor"><button data-grview="sets" class="on">Sets</button><button data-grview="items">Single pieces</button></div>`:""}
    <div class="cp-filters">
      <label${kind==="consumables"?" hidden":""}><span>${esc(G.catLab)}</span><select class="field" id="gr-cat-${kind}"><option value="">Any</option></select></label>
      ${G.subLab?`<label><span>${esc(G.subLab)}</span><select class="field" id="gr-sub-${kind}"><option value="">Any</option></select></label>`:""}
      ${kind!=="blueprints"?`<label id="gr-mkw-${kind}"${kind==="utility"?" hidden":""}><span>Maker</span><select class="field" id="gr-mk-${kind}"><option value="">Any</option></select></label>
      <label><span>Where</span><select class="field" id="gr-av-${kind}"><option value="">Anywhere</option><option value="buy">Sold in shops</option><option value="noshop">Not in shops</option></select></label>`:""}
      <label class="wide"><span>Sort</span><select class="field" id="gr-sort-${kind}">${G.sorts.map(([v,l])=>`<option value="${v}">${esc(l)}</option>`).join("")}</select></label>
    </div>
    <div class="row" style="justify-content:space-between;margin:2px 2px 0"><span class="muted" id="gr-count-${kind}" style="font-size:12px"></span>
      <button class="btn small ghost" id="gr-reset-${kind}" hidden>Clear filters</button></div>
    <div id="gr-list-${kind}"></div>
    <div class="uex-credit" id="gr-credit-${kind}"></div>`;
  const re=()=>{ grState(kind).sel=null; grState(kind).mission=null; grRender(kind); };
  grCkFilters();
  $(`gr-q-${kind}`).addEventListener("input",re);
  for(const id of ["cat","sub","mk","av","sort"]){ const el=$(`gr-${id}-${kind}`); if(el) el.addEventListener("change",re); }
  $(`gr-reset-${kind}`).onclick=()=>{ for(const id of ["q","cat","sub","mk","av"]){ const el=$(`gr-${id}-${kind}`); if(el) el.value=""; } re(); };
  p.addEventListener("click",e=>{ const v=e.target.closest("[data-grview]"); if(v){ const st=grState(kind); st.view=v.dataset.grview; st.sel=null;
      for(const b of p.querySelectorAll("[data-grview]")) b.classList.toggle("on",b===v); return grRender(kind); }
    const h=e.target.closest("[data-gi],[data-gset]"); if(h){ grOpenItem(kind,h.dataset.gi||null,h.dataset.gset||null); } }); }
// Consumables: no Kind filter (the Food / Drink / Medical tab is the kind), and Maker only on Medical (food and
// drinks don't say who makes them)
function grCkFilters(){ const w=$("gr-mkw-consumables"); if(w) w.hidden=grState("consumables").ckind!=="Medical"; }
// In Consumables the Food / Drink / Medical tab already picks the kind, so the lists only offer what's in that tab
const grCkOk=(kind,i)=>{ const ck=kind==="consumables"?grState(kind).ckind:null, c=GEAR[kind].cat(i);
  return !ck||(ck==="Food"?!["Drink","Medical"].includes(c):c===ck); };
function grFillFilters(kind){ const G=GEAR[kind], L=(grState(kind).data?.items||[]).filter(i=>grCkOk(kind,i));
  const fill=(id,vals)=>{ const el=$(`gr-${id}-${kind}`); if(!el) return; const cur=el.value;
    el.innerHTML=`<option value="">Any</option>`+[...new Set(vals.filter(Boolean))].sort((a,b)=>a.localeCompare(b)).map(v=>`<option value="${esc(v)}" ${v===cur?"selected":""}>${esc(v)}</option>`).join(""); };
  fill("cat",L.map(G.cat)); if(G.sub) fill("sub",L.map(G.sub)); fill("mk",L.map(i=>i.maker)); }
const grPrice=i=>i.buy?.[0]?.price??null;
function grFiltered(kind){ const G=GEAR[kind], st=grState(kind), L=st.data?.items||[], v=id=>$(`gr-${id}-${kind}`)?.value||"";
  const q=v("q").trim().toLowerCase(), words=q.split(/\s+/).filter(Boolean), cat=v("cat"), sub=v("sub"), mk=v("mk"), av=v("av"), sort=v("sort")||"name";
  const text=i=>kind==="blueprints"?`${i.name} ${i.category} ${(i.ingredients||[]).map(x=>x.name).join(" ")}`:`${i.name} ${i.maker} ${i.maker_code||""} ${makerAlias(i.maker)} ${G.cat(i)} ${G.sub?G.sub(i):""} ${i.set||""}`;
  // Consumables: the Food / Drink / Medical tab picks the kind (anything that isn't a drink or medical counts as food)
  const ckOk=i=>grCkOk(kind,i);
  const out=L.filter(i=>ckOk(i)&&(!cat||G.cat(i)===cat)&&(!sub||!G.sub||G.sub(i)===sub)&&(!mk||i.maker===mk)&&(!av||(av==="buy")===!!i.buy?.length)
    &&(!words.length||(t=>cpQueryHit(t,words.join(" ")))(text(i).toLowerCase())));
  const num=(i,k)=>i.stats?.[k]??-1e9, pr=i=>grPrice(i)??9e12;
  const by={name:(a,b)=>a.name.localeCompare(b.name),price:(a,b)=>pr(a)-pr(b)||a.name.localeCompare(b.name),
    time:(a,b)=>(a.time??9e9)-(b.time??9e9),ings:(a,b)=>(a.ingredients?.length??99)-(b.ingredients?.length??99),
    cold:(a,b)=>(a.stats?.temp_min??99)-(b.stats?.temp_min??99),hot:(a,b)=>(b.stats?.temp_max??-99)-(a.stats?.temp_max??-99),
    mass:(a,b)=>(a.stats?.mass??9e9)-(b.stats?.mass??9e9)||a.name.localeCompare(b.name)};
  out.sort(by[sort]||((a,b)=>num(b,sort)-num(a,sort)||a.name.localeCompare(b.name)));
  return out; }
// Armor pieces as sets: grouped by name ("ADP Core Woodland" is part of ADP Woodland); a set needs two pieces
const GR_SLOTS=["Helmet","Core","Arms","Legs","Backpack"];
function grSets(L){ const m=new Map();
  for(const p of L){ if(p.slot==="Undersuit") continue; const k=(p.set||p.name).toLowerCase();
    if(!m.has(k)) m.set(k,{name:p.set||p.name,weight:p.weight,maker:p.maker,pieces:[]}); m.get(k).pieces.push(p); }
  return [...m.values()].filter(s=>s.pieces.length>=2).map(s=>{ s.pieces.sort((a,b)=>GR_SLOTS.indexOf(a.slot)-GR_SLOTS.indexOf(b.slot));
    const priced=s.pieces.filter(p=>grPrice(p)!=null); s.price=priced.length===s.pieces.length?priced.reduce((t,p)=>t+grPrice(p),0):null;
    s.dr=Math.max(...s.pieces.map(p=>p.stats?.dr??0)); return s; }); }
function grRender(kind){ const st=grState(kind), G=GEAR[kind], list=$(`gr-list-${kind}`);
  if(st.error){ $("gr-panel").innerHTML=`<div class="empty" style="margin-top:60px"><strong>${esc(G.title)}</strong>${esc(st.error)}<br><br><button class="btn small" data-grretry="1">Try again</button></div>`; if(list) list.innerHTML=""; return; }
  if(!st.data){ return; }
  const L=grFiltered(kind), sets=kind==="armor"&&st.view==="sets"?grSets(L):null;
  if(sets){ const s=$(`gr-sort-armor`).value; if(s==="price") sets.sort((a,b)=>(a.price??9e12)-(b.price??9e12)); else if(s==="dr") sets.sort((a,b)=>b.dr-a.dr); else sets.sort((a,b)=>a.name.localeCompare(b.name)); }
  const any=["q","cat","sub","mk","av"].some(id=>$(`gr-${id}-${kind}`)?.value);
  $(`gr-reset-${kind}`).hidden=!any;
  const n=sets?sets.length:L.length, all=sets?null:st.data.items.length;
  $(`gr-count-${kind}`).textContent=sets?`${plural(n,"set")} · ${plural(L.length,"piece")} match`:`${n.toLocaleString()} of ${all.toLocaleString()} ${G.noun}s · click one for its page`;
  $(`gr-credit-${kind}`).innerHTML=`From the <a data-ext="https://api.star-citizen.wiki">Star Citizen Wiki</a>${kind!=="blueprints"?", prices from UEX":""}.${st.data.at?` Fetched ${agoTs(st.data.at)}.`:""}${st.data.stale?" Couldn't refresh: showing the last copy.":""} <a data-grfresh="1" style="cursor:pointer;text-decoration:underline">Refresh</a>`;
  const row=(i,attr)=>`<div class="vh ${st.sel===(i.uuid||i.name)?"hl":""}"><div class="hd" ${attr}><div><div class="nm">${esc(i.name)}</div>
      <div class="mk">${esc([kind==="blueprints"?i.category:i.maker,kind==="armor"&&!sets?i.slot:"",kind==="weapons"||GR_ITEM[kind]?i.kind:"",GR_ITEM[kind]?"":i.weight||""].filter(Boolean).join(" · "))}</div></div>
      <div class="pr">${kind==="blueprints"?esc(i.time_label||""):grPrice(i)!=null?money(grPrice(i)):`<span class="noshop">Not in shops</span>`}</div></div></div>`;
  if(list) list.innerHTML=sets?sets.slice(0,150).map(s=>`<div class="vh ${st.sel==="set:"+s.name?"hl":""}"><div class="hd" data-gset="${esc(s.name)}"><div><div class="nm">${esc(s.name)}</div>
        <div class="mk">${esc([s.maker,s.weight,s.pieces.map(p=>p.slot).join(", ")].filter(Boolean).join(" · "))}</div></div>
        <div class="pr">${s.price!=null?money(s.price):`<span class="noshop">Not all in shops</span>`}</div></div></div>`).join("")+(sets.length>150?`<div class="muted" style="font-size:12px;margin:6px 2px">${sets.length-150} more on the right</div>`:"")
    :L.slice(0,150).map(i=>row(i,`data-gi="${esc(i.uuid||i.name)}"`)).join("")+(L.length>150?`<div class="muted" style="font-size:12px;margin:6px 2px">${L.length-150} more on the right</div>`:"")
      ||`<div class="empty">Nothing matches.</div>`;
  if(st.sel) return grDetail(kind);
  // the picture grid
  const shown=sets?sets.slice(0,240):L.slice(0,240);
  st.gridKey=JSON.stringify([st.view,...["q","cat","sub","mk","av","sort"].map(id=>$(`gr-${id}-${kind}`)?.value||"")]);
  $("gr-panel").innerHTML=`<div class="gh"><b>${esc(G.title)}</b>${sets?`${plural(sets.length,"armor set")}`:`${n.toLocaleString()} shown`} · click one for its page</div>
    ${shown.length?`<div class="grid">${shown.map(i=>sets?`<div class="vg" data-gset="${esc(i.name)}">${grSetCartPieces(i).length?cartBtn(grSetCartPieces(i).map(p=>({name:p.name,kind:"armor",uuid:p.uuid,class_name:p.class_name,source:i.name}))):""}<div class="ph ph-g" data-gpic="${esc(i.pieces.find(p=>p.slot==="Core")?.name||i.pieces[0].name)}">${phCard("armor")}</div>
        <div class="tx"><b>${esc(i.name)}</b><span>${esc([i.maker,i.weight].filter(Boolean).join(" · "))}${i.price!=null?` · ${money(i.price)}`:""}</span><span class="kt">${esc(i.pieces.map(p=>p.slot).join(" · "))}${i.dr?` · up to ${nf(i.dr)}% DR`:""}</span></div></div>`
      :`<div class="vg" data-gi="${esc(i.uuid||i.name)}">${kind!=="blueprints"&&i.buy?.length?cartBtn({name:i.name,kind:GR_CART[kind],uuid:i.uuid,class_name:i.class_name}):""}<div class="ph${kind==="blueprints"?" bp":" ph-g"}" data-gpic="${esc(i.name)}">${i.image?`<img src="${esc(i.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">`:kind==="blueprints"?BP_PLACEHOLDER:phCard(grArt(kind,i))}</div>
        <div class="tx"><b>${esc(i.name)}</b><span>${esc([kind==="blueprints"?i.category:i.maker,kind==="armor"?i.slot:kind==="weapons"||GR_ITEM[kind]?i.kind:i.grade?`grade ${i.grade}`:""].filter(Boolean).join(" · "))}${kind!=="blueprints"?(grPrice(i)!=null?` · ${money(grPrice(i))}`:" · not in shops"):""}</span>${G.key(i)?`<span class="kt">${esc(G.key(i))}</span>`:""}</div></div>`).join("")}</div>`
      :`<div class="empty">Nothing matches these filters.</div>`}`;
  fillGearPictures($("gr-panel"));
  if(st.back){ if(st.back.key===st.gridKey) $("gr-panel").scrollTop=st.back.top; st.back=null; } }
// Weapon and armor pictures: their wiki pages are looked up apart from ship parts' (see gear_images)
async function fillGearPictures(root){ const els=[...root.querySelectorAll("[data-gpic]")]; if(!els.length) return;
  S.gpics=S.gpics||{}; const need=[...new Set(els.map(e=>e.dataset.gpic))].filter(r=>!(r in S.gpics));
  const paint=()=>{ for(const e of els){ const u=S.gpics[e.dataset.gpic]; if(u&&!e.querySelector("img")) e.innerHTML=`<img src="${esc(u)}" alt="" loading="lazy" referrerpolicy="no-referrer">`; } };
  paint();
  for(let i=0;i<need.length;i+=24){ const batch=need.slice(i,i+24); let got={}; try{ got=await api().gear_images(batch); }catch(e){}
    for(const r of batch) S.gpics[r]=got[r]||null; paint(); if(!root.isConnected) return; } }
// The pieces of a set it makes sense to put in the cart: ones a shop sells, or that drop as loot
function grSetCartPieces(s){ return s.pieces.filter(p=>p.buy?.length||p.lootable); }
function grOpenItem(kind,id,set){ const st=grState(kind);
  if(!st.sel) st.back={key:st.gridKey,top:$("gr-panel").scrollTop};          // opened from the grid: Back returns to this spot
  st.sel=set?"set:"+set:id; st.mission=null; grRender(kind); $("gr-panel").scrollTop=0; }
// A gear page's extra rows (damage type, fire modes, armor resistances, effects…) as [label, value]: the Gear
// page and a marketplace listing linked to the item show the same ones
function grExtraPairs(kind,i){
  if(kind==="weapons") return [i.damage_type&&["Damage type",i.damage_type],i.cls&&["Ammo",i.cls],i.modes?.length&&["Fire modes",i.modes.join(", ")],i.size!=null&&["Size",i.size],i.rarity&&["Rarity",i.rarity]].filter(Boolean);
  if(kind==="armor") return [["Piece",i.slot],i.weight&&["Weight",i.weight],i.set&&["Set",i.set],...Object.entries(i.res||{}).map(([t,m])=>[`${t[0].toUpperCase()+t.slice(1)} damage taken`,`${Math.round(m*100)}%`])].filter(Boolean);
  if(GR_ITEM[kind]) return [...(i.effects?.length?[["Effects",i.effects.join(", ")]]:[]),...(i.buffs?.length?[["Buffs",i.buffs.join(", ")]]:[]),
      ...(i.facts||[]).filter(([a])=>!/^(effects?|buffs?)$/i.test(a)),i.sub&&i.sub!==i.kind?["Type",i.sub]:null,
      i.paints?.length?["Also comes in",i.paints.map(p=>(p.name.match(/["“”]([^"“”]+)["“”]/)||[,p.name])[1]).join(", ")]:null,i.size!=null&&i.size!==0?["Size",i.size]:null].filter(Boolean);
  return []; }
// Everything worth knowing about a piece of gear, as [label, value] rows: the headline numbers, the stat rows
// and the extras. For marketplace listings linked to the item (the shop price is kept apart, as "In shops").
function grSpecPairs(kind,i){ const G=GEAR[kind]; if(!G||!i) return [];
  const st=i.stats||{}, out=[];
  for(const h of G.hero(i)) if(h.value!=null&&h.value!==""&&h.label!=="Price") out.push([h.label,h.value]);
  for(const [k,lab,f] of G.rows) if(st[k]!=null&&!out.some(([l])=>l===lab)) out.push([lab,f(st[k])]);
  for(const p of grExtraPairs(kind,i)) if(!out.some(([l])=>l===p[0])) out.push(p);
  if(i.maker&&!out.some(([l])=>l==="Maker")) out.unshift(["Maker",i.maker]);
  return out; }
async function grDetail(kind){ const st=grState(kind), G=GEAR[kind], L=st.data.items, g=$("gr-panel");
  if(st.mission) return grMission(kind);
  const back=`<button class="btn" data-grback="1" style="margin-bottom:14px">← All ${esc(st.view==="sets"&&kind==="armor"?"armor sets":G.title.toLowerCase())}</button>`;
  if(String(st.sel).startsWith("set:")){ const name=st.sel.slice(4), s=grSets(L).find(x=>x.name===name); if(!s){ st.sel=null; return grRender(kind); }
    g.innerHTML=`${back}<div class="mkp-head"><div class="mkp-img" id="grd-img">${qPic()}</div>
      <div class="hd-main"><div class="hd-title"><div><h2>${esc(s.name)}</h2><div class="sub">${esc([s.maker,s.weight&&`${s.weight} armor`].filter(Boolean).join(" · "))}</div></div>${titleLogo(s.maker,false,true)}</div>
        ${statBlock([{label:"Pieces",value:s.pieces.length},{label:"Best damage reduction",value:s.dr?GR_PCT(s.dr):null},{label:"Whole set",value:s.price!=null?money(s.price):"Not all in shops"}],[])}
        <div class="row" style="gap:8px;margin-top:12px">${(()=>{ const n=grSetCartPieces(s).length; return !n?`<span class="muted" style="font-size:12.5px">No piece of this set is sold or known to drop, so there's nothing to put in the cart.</span>`
          :`<button class="btn primary" data-grshopset="1">${CART_SVG}${n===s.pieces.length?"Add the whole set to cart":`Add the ${n} pieces you can get to cart`}</button>`; })()}</div></div></div>
      <div class="vd-grid vd-flat"><div class="vd-sec" style="grid-column:1/-1"><div class="mk-h">The pieces</div>
        ${s.pieces.map(p=>`<div class="mk-row gr-piece"><div class="w"><a data-gi="${esc(p.uuid)}">${esc(p.name)}</a><div class="m">${esc(p.slot)}${p.stats?.dr!=null?` · ${nf(p.stats.dr)}% damage reduction`:""}${p.stats?.carry?` · ${Math.round(p.stats.carry).toLocaleString()} µSCU`:""}</div></div>
          <div class="p">${grPrice(p)!=null?money(grPrice(p)):'<span class="noshop">Not in shops</span>'}</div><span></span>
          <div class="m">${p.buy?.[0]?`${p.buy[0].place?`<a data-open="${esc(p.buy[0].place)}">${esc(p.buy[0].where)}</a>`:esc(p.buy[0].where)}${p.buy[0].shop?` · ${esc(p.buy[0].shop)}`:""}`:"Loot, rewards or crafting"}</div></div>`).join("")}</div></div>
      <div class="uex-credit">From the Star Citizen Wiki; prices from UEX. Sets are put together from the pieces' names.</div>`;
    const img=await api().gear_image(s.pieces.find(p=>p.slot==="Core")?.name||s.pieces[0].name); if(st.sel!=="set:"+name) return;
    const box=$("grd-img"); if(box) box.innerHTML=picShown(img,"component",s.name,"armor"); return; }
  const i=L.find(x=>(x.uuid||x.name)===st.sel); if(!i){ st.sel=null; return grRender(kind); }
  const st_=i.stats||{}, rows=G.rows.filter(([k])=>st_[k]!=null).map(([k,lab,f])=>`<div class="vd-row"><span>${esc(lab)}</span><b>${esc(String(f(st_[k])))}</b></div>`).join("");
  const extra=grExtraPairs(kind,i).map(([a,b])=>`<div class="vd-row"><span>${esc(a)}</span><b>${esc(String(b))}</b></div>`).join("");
  if(kind==="blueprints") return grBlueprint(i,back);
  g.innerHTML=`${back}<div class="mkp-head"><div class="mkp-img" id="grd-img">${qPic()}</div>
    <div class="hd-main"><div class="hd-title"><div><h2>${esc(i.name)}</h2><div class="sub">${esc([i.maker,kind==="weapons"?[i.cls,i.kind].filter(Boolean).join(" "):GR_ITEM[kind]?i.kind:`${i.weight?i.weight+" ":""}${i.slot}`].filter(Boolean).join(" · "))}</div></div>${titleLogo(i.maker,false,true)}</div>
      ${statBlock(G.hero(i),[{label:"Sold at",value:i.buy?.length?plural(i.buy.length,"shop"):null}])}
      <div class="row" style="gap:8px;margin-top:12px">${i.buy?.length?cartBtn({name:i.name,kind:GR_CART[kind],uuid:i.uuid,class_name:i.class_name},"Add to cart"):""}${glKinds.has(kind)?`<button class="btn ghost" data-gladd="${esc(i.uuid||i.name)}">Add to loadout</button>`:""}${i.web_url?`<button class="btn ghost" data-ext="${esc(i.web_url)}">Wiki</button>`:""}</div></div></div>
    ${grDesc(i.desc)?`<p class="gr-desc">${esc(grDesc(i.desc))}</p>`:""}
    <div class="vd-grid vd-flat"><div class="vd-sec"><div class="mk-h">Stats</div>${rows+extra||`<div class="muted" style="font-size:13px;padding:6px 0">No numbers on the wiki for this one.</div>`}</div>
      <div class="vd-sec"><div class="mk-h">${i.buy?.length?"Where to buy":"How to get it"}</div>${i.buy?.length?vehSpots(i.buy,"buy")+`<div id="grd-get"></div>`:`<div id="grd-get"><div class="muted" style="font-size:13px;padding:6px 0">Looking up how to get it…</div></div>`}</div></div>
    <div id="grd-where"></div>
    <div class="uex-credit">From the Star Citizen Wiki; prices from UEX, reported by players, so check the terminal before you buy.</div>`;
  grObtain(i,kind);
  if(!i.image){ const img=await api().gear_image(i.name); if(st.sel!==(i.uuid||i.name)) return; const box=$("grd-img"); if(box) box.innerHTML=picShown(img,"component",i.name,grArt(kind,i)); }
  else { const box=$("grd-img"); if(box) box.innerHTML=picShown(i.image,"component",i.name,grArt(kind,i)); } }
// How to get gear no shop sells: where players have found it, the blueprint that makes it (and the missions
// that unlock that blueprint, each opening its own page), and whether the wiki marks it as loot.
function knownSourcesHtml(notes){ return notes?.length?`<div class="mk-h" style="margin-top:4px">Found at</div>${notes.map(n=>`<div class="mk-row"><div class="w">${esc(n.text)}</div><div class="p"></div>${n.search?`<button class="btn small ghost" data-mapsearch="${esc(n.search)}" title="Find them on the map">Map</button>`:"<span></span>"}</div>`).join("")}`:""; }
async function grObtain(i,kind){ const st=grState(kind); let r; try{ r=await api().gear_obtain(i.uuid||null,i.name); }catch(e){ r=null; }
  if(st.sel!==(i.uuid||i.name)) return; const box=$("grd-get"); if(!box) return;
  const sold=!!i.buy?.length, bp=r?.blueprint, notes=r?.notes||[], out=[];
  out.push(knownSourcesHtml(notes));
  if(bp){ out.push(`<div class="mk-h" style="margin-top:${out.join("")?12:4}px">Craft it</div>
      <div class="mk-row"><div class="w"><a data-grbpopen="${esc(bp.uuid)}" title="Open the blueprint">${esc(bp.name)} blueprint</a><div class="m">${bp.default?"Every player knows it from the start":bp.unlocks?.length?`Unlocked by ${plural(bp.unlocks.length,"mission")}`:bp.missions?`${plural(bp.missions,"mission")} unlock it`:"How to unlock it isn't on the wiki yet"}${bp.time_label?` · ${esc(bp.time_label)} to craft`:""}</div></div><div class="p"></div><span></span></div>
      ${(bp.unlocks||[]).slice(0,6).map(m=>`<div class="mk-row"><div class="w"><a data-grmission="${esc(JSON.stringify({ref:m.ref||null,code:m.code||null,title:m.raw_title||m.title}))}" title="Where it's offered and what it pays">${esc(m.title)}</a><div class="m">${esc(m.scope||"Mission")}</div></div><div class="p">${m.chance!=null&&m.chance<1?`${Math.round(m.chance*100)}% chance`:""}</div><span></span></div>
        ${(m.places||[]).length?`<div class="gr-places">${m.places.map(grPlaceRow).join("")}${m.places_more?`<div class="muted" style="font-size:12px;padding:2px 0 6px 14px">+${m.places_more} more places: open the mission to see them all</div>`:""}</div>`:""}`).join("")}`); }
  // Loot: a short note here, and the places to search as their own section under the page ("Where to find it")
  const where=$("grd-where"); if(where) where.innerHTML=!sold&&i.lootable&&(r?.loot||[]).length?grWhereHtml(r.loot):"";
  if(!sold&&i.lootable) out.push(`<div class="mk-h" style="margin-top:${out.join("")?12:4}px">Loot</div><div class="muted" style="font-size:13px;line-height:1.5;padding:4px 0">The wiki marks it as lootable: it drops from loot crates and enemies${notes.length?", like at the places above":""}. Where exactly isn't fixed, so <b>Where to find it</b> below lists the kinds of place worth searching${S.live?.player?", nearest to you first":""}.</div>`);
  // Not in any shop, but there is a way to get it (loot, a blueprint or a known spot): it can go in the cart too,
  // where it's listed with how to get it rather than a shop stop
  if(!sold&&(i.lootable||bp||notes.length)) out.push(`<div class="row" style="margin-top:10px">${cartBtn({name:i.name,kind:GR_CART[kind],uuid:i.uuid,class_name:i.class_name},"Add to cart to find")}</div>`);
  if(!sold&&!out.join("")) out.push(`<div class="muted" style="font-size:13px;padding:6px 0;line-height:1.5">No shop sells this as far as UEX knows, and the wiki doesn't list a blueprint or mark it as loot. Items like this are usually pledge, event, subscriber or reward items.</div>`);
  box.innerHTML=out.join(""); }
// Where loot turns up, one card per kind of place: what drops there, how many are on the map, the nearest few
const GR_WHERE_IC={"Contested Zones":'<path d="M12 3l8 4v5c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V7z"/><path d="M9 12l2 2 4-4"/>',
  "Bunkers and security posts":'<path d="M3 20h18M5 20V10l7-5 7 5v10"/><path d="M10 20v-5h4v5"/>',
  "Distribution Centres":'<path d="M3 9l9-5 9 5v11H3z"/><path d="M7 20v-6h10v6M7 17h10"/>',
  "Derelict outposts and wrecks":'<path d="M4 18l5-9 3 4 3-6 5 11z"/><path d="M3 21h18"/>'};
function grWhereHtml(groups){
  return `<div class="gr-where"><div class="mk-h">Where to find it<span class="mk-note">${S.live?.player?"nearest to you first":"type /showlocation to sort by distance"}</span></div>
    <div class="gr-where-grid">${groups.map(gp=>`<div class="gr-wcard">
      <div class="hd"><svg viewBox="0 0 24 24" aria-hidden="true">${GR_WHERE_IC[gp.label]||'<circle cx="12" cy="12" r="8"/>'}</svg>
        <div class="t"><b>${esc(gp.label)}</b><span>${esc(gp.why)}</span></div>
        <button class="btn small ghost" data-mapsearch="${esc(gp.search)}" title="Show all ${gp.count} on the map">Map · ${gp.count}</button></div>
      <table class="gr-wt">${gp.places.map(x=>{ const p=x.place||x.name, ok=!!S.locMap?.[p], inR=S.live?.route?.includes(p);
        return `<tr><td>${ok?`<a data-open="${esc(p)}">${esc(x.name)}</a>`:esc(x.name)}<small>${esc([x.body,x.system].filter(Boolean).join(" · "))}</small></td>
          <td class="d">${x.dist!=null?fmtDist(x.dist):""}</td>
          <td class="a">${ok?`<button class="iconbtn ${inR?"added":""}" data-add="${esc(p)}" title="${inR?"In your route":`Add ${esc(p)} to your route`}">${inR?"✓":"+"}</button>`:""}</td></tr>`; }).join("")}</table></div>`).join("")}</div></div>`; }
// A place a mission or loot can send you: open it, or add it to the route
function grPlaceRow(x){ const p=x.place||x.name; const ok=!!S.locMap?.[p];
  return `<div class="mk-row gr-place"><div class="w">${ok?`<a data-open="${esc(p)}">${esc(x.name)}</a>`:esc(x.name)}<div class="m">${esc([x.body,x.system].filter(Boolean).join(" · "))}${x.dist!=null?` · ${fmtDist(x.dist)} away`:""}${!ok&&x.body?` · reached at its orbital marker`:""}</div></div><div class="p"></div>
    ${ok?(S.live?.route?.includes(p)?`<button class="iconbtn added" data-add="${esc(p)}" title="In your route">✓</button>`:`<button class="iconbtn" data-add="${esc(p)}" title="Add ${esc(p)} to your route">+</button>`):"<span></span>"}</div>`; }
// "Map" on a place type (PAF sites, Distribution Centres...): search the map for them
document.addEventListener("click",e=>{ const m=e.target.closest("[data-mapsearch]"); if(!m) return;
  document.querySelector('.tab[data-tab="route"]')?.click();
  setTimeout(()=>{ const q=$("rsearch"); if(!q) return; q.value=m.dataset.mapsearch; q.dispatchEvent(new Event("input",{bubbles:true})); q.focus(); },60); });
// The wiki's descriptions start with "Manufacturer: …", "Item Type: …" lines (shown as stats already): just the prose
function grDesc(d){ if(!d) return ""; const parts=String(d).replace(/\\n/g,"\n").split(/\n\s*\n/).map(x=>x.trim()).filter(Boolean);
  const prose=parts.filter(x=>!/^[A-Za-z ]{2,30}:\s/.test(x)); return (prose.length?prose.join(" "):"").replace(/\s+/g," ").trim(); }
async function grBlueprint(i,back){ const g=$("gr-panel"), st=grState("blueprints");
  const ing=x=>`<div class="mk-row"><div class="w">${esc(x.name)}<div class="m">${x.kind==="resource"||(!x.kind&&x.scu!=null)?"Resource":"Item"}</div></div><div class="p">${x.scu!=null?`${nf(x.scu)} SCU`:x.qty!=null?`× ${x.qty}`:""}</div><span></span></div>`;
  const draw=d=>{ const og=d?.out_game;
    g.innerHTML=`${back}<div class="mkp-head"><div class="mkp-img" id="grd-img">${qPic()}</div>
      <div class="hd-main"><div class="hd-title"><div><h2>${esc(i.name)}</h2><div class="sub">Blueprint · ${esc(i.category)}${i.version?` · ${esc(i.version)}`:""}</div></div></div>
        ${statBlock(GEAR.blueprints.hero(i),[])}
        <div class="row" style="gap:8px;margin-top:12px">${i.web_url?`<button class="btn ghost" data-ext="${esc(i.web_url)}">Wiki</button>`:""}${i.out_tab==="components"?`<button class="btn ghost" data-grcomp="${esc(i.name)}">Find in Components</button>`:""}</div></div></div>
      <div class="vd-grid vd-flat bp-grid">
        <div class="vd-sec"><div class="mk-h">Ingredients</div>${i.ingredients.length?i.ingredients.map(ing).join(""):`<div class="muted" style="font-size:13px">None listed.</div>`}
          ${i.returns?.length?`<div class="mk-h" style="margin-top:14px">Dismantling gives back</div>${i.returns.map(ing).join("")}`:""}</div>
        <div class="vd-sec"><div class="mk-h">How you get it</div>
          ${i.default?`<div class="muted" style="font-size:13px;line-height:1.5;padding:4px 0">Every player knows this blueprint from the start.</div>`:""}
          ${!d?`<div class="muted" style="font-size:13px">Looking up the missions…</div>`:d.unlocks?.length?d.unlocks.map(m=>`<div class="mk-row"><div class="w"><a data-grmission="${esc(JSON.stringify({ref:m.ref||null,code:m.code||null,title:m.raw_title||m.title}))}" title="What this mission is, where it's offered and what it pays">${esc(m.title)}</a><div class="m">${esc(m.scope||"")}</div></div><div class="p">${m.chance!=null&&m.chance<1?`${Math.round(m.chance*100)}% chance`:""}</div><span></span></div>
            ${(m.places||[]).length?`<div class="gr-places">${m.places.map(grPlaceRow).join("")}${m.places_more?`<div class="muted" style="font-size:12px;padding:2px 0 6px 14px">+${m.places_more} more: open the mission to see them all</div>`:""}</div>`:""}`).join("")
            :!i.default?`<div class="muted" style="font-size:13px;line-height:1.5">${i.missions?`${plural(i.missions,"mission")} unlock it, but the wiki doesn't list which yet.`:"The wiki doesn't say how to unlock it yet."}</div>`:""}</div>
          ${og?.stats&&rows0(og.stats)?`<div class="vd-sec"><div class="mk-h">What it makes</div>${CP_STATS.filter(([k])=>og.stats[k]!=null&&og.stats[k]!==0&&og.stats[k]!=="").map(([k,lab,f])=>`<div class="vd-row"><span>${lab}</span><b>${esc(f(og.stats[k]))}</b></div>`).join("")}</div>`:""}</div>
      <div class="uex-credit">From the Star Citizen Wiki's crafting data.</div>`;
    api().gear_image(i.name).then(img=>{ if(st.sel!==(i.uuid||i.name)) return; const box=$("grd-img"); if(box) box.innerHTML=picShown(img,"component",i.name,true); }); };
  draw(null);
  const r=await api().blueprint_detail(i.uuid); if(st.sel!==(i.uuid||i.name)) return;
  draw(r.ok?r.blueprint:{unlocks:[]}); }
// A mission's own page (from a blueprint's How you get it): what it pays, the briefing, where it's offered and
// where it sends you (each place one click from the route), what it needs first and the blueprints it can give.
// Back goes to the mission before it, then to the blueprint.
async function grMission(kind){ const st=grState(kind), g=$("gr-panel"), m=st.mission, from=m.from;
  const back=`<button class="btn" data-grmback="1" style="margin-bottom:14px">← ${esc(m.prev?m.prev.title:from)}</button>`;
  if(!m.data){ g.innerHTML=`${back}${qLoader(`Looking up ${esc(m.title||"the mission")} on the Star Citizen Wiki…`)}`;
    let r; try{ r=await api().mission_page(m.ref,m.code,m.title); }catch(e){ r={ok:false,error:"Couldn't look it up"}; }
    if(st.mission!==m) return; m.data=r.ok?(r.found?r.info:{missing:true}):{error:r.error}; }
  const w=m.data, n0=x=>Number(x).toLocaleString(), rng=(a,b,u="")=>a!=null&&b!=null&&a!==b?`${n0(a)}–${n0(b)}${u}`:`${n0(b??a)}${u}`;
  if(w.error||w.missing){ g.innerHTML=`${back}<div class="empty" style="margin-top:40px"><strong>${esc(m.title||"Mission")}</strong>${w.error?esc(w.error):"The Star Citizen Wiki doesn't have the details of this mission yet."}
      ${w.error?`<br><br><button class="btn small" data-grmretry="1">Try again</button>`:""}</div>`; return; }
  const place=x=>`<div class="mk-row"><div class="w">${x.place?`<a data-open="${esc(x.place)}">${esc(x.name)}</a>`:esc(x.name)}</div><div class="p"></div>
      ${x.place?(S.live?.route?.includes(x.place)?`<button class="iconbtn added" data-add="${esc(x.place)}" title="In your route">✓</button>`:`<button class="iconbtn" data-add="${esc(x.place)}" title="Add ${esc(x.place)} to your route">+</button>`):`<span></span>`}
      <div class="m">${x.body?`${esc(x.body)} · reached at ${esc(x.place||"its orbital marker")}`:x.place?"":"Not on Quantum's map yet"}</div></div>`;
  const places=(rows,g0)=>rows?.length?rows.map(place).join("")+(g0?.more?`<div class="muted" style="font-size:12px;padding:6px 0">+${g0.more} more</div>`:""):"";
  const chain=L=>L.map(x=>`<div class="mk-row"><div class="w">${x.uuid?`<a data-grmission="${esc(JSON.stringify({ref:x.uuid,title:x.title}))}">${esc(x.title)}</a>`:esc(x.title)}</div><div class="p"></div><span></span></div>`).join("");
  const offered=places(w.offered_at_rows,w.offered_at), there=places([...(w.pickups_rows||[]),...(w.destinations_rows||[])]);
  const bps=(w.blueprint_items||[]).map(b=>`<div class="mk-row"><div class="w">${b.bp?`<a data-grbp="${esc(b.bp)}">${esc(b.name)}</a>`:esc(b.name)}<div class="m">Blueprint</div></div><div class="p">${b.chance!=null&&b.chance<1?`${Math.round(b.chance*100)}% chance`:""}</div><span></span></div>`).join("");
  const items=(w.reward_items||[]).map(x=>`<div class="mk-row"><div class="w">${esc(x)}<div class="m">Item</div></div><div class="p"></div><span></span></div>`).join("");
  const sec=(h,body)=>body?`<div class="vd-sec"><div class="mk-h">${h}</div>${body}</div>`:"";
  const tags=[w.type,w.illegal?"Illegal":"Legal",w.combat?"Combat":"",w.shareable?"Shareable":"",w.once_only?"Once only":"",w.prison?"Offered in prison":"",...(w.systems||[])].filter(Boolean);
  g.innerHTML=`${back}<div class="mkp-head" style="grid-template-columns:1fr"><div class="hd-main"><div class="hd-title"><div><h2>${esc(w.title||m.title)}</h2>
      <div class="sub">${esc(["Mission",w.giver||w.faction].filter(Boolean).join(" · "))}${w.faction&&w.giver&&w.faction!==w.giver?` · ${esc(w.faction)}`:""}</div></div></div>
      ${statBlock([{label:"Payout",value:w.reward?`${rng(w.reward[0],w.reward[1])} ${w.currency||"aUEC"}`:null},
          {label:"Reputation",value:(w.rep||[]).length?`+${n0(w.rep[0].amount)}`:null},{label:"Time",value:w.minutes?`${w.minutes} min`:null},{label:"Rank",value:w.rank>0?`Rank ${w.rank}`:null}],
        [{label:"Enemies",value:w.enemies?rng(w.enemies[0],w.enemies[1]):null},{label:"Players",value:w.max_players>1?`Up to ${w.max_players}`:null},
         {label:"Cooldown",value:w.cooldown||null},{label:"Reputation with",value:(w.rep||[]).map(r=>r.faction).filter(Boolean).join(", ")||null}])}
      <div class="row" style="gap:8px;margin-top:12px">${w.url?`<button class="btn ghost" data-ext="${esc(w.url)}">Wiki</button>`:""}</div></div></div>
    ${tags.length?`<div class="gr-tags">${tags.map(t=>`<span>${esc(t)}</span>`).join("")}</div>`:""}
    ${w.description?`<p class="gr-desc mi-text">${esc(w.description)}</p>`:""}
    <div class="vd-grid vd-flat bp-grid">
      ${sec("Where it's offered",offered||`<div class="muted" style="font-size:13px;padding:6px 0">The wiki doesn't say where.</div>`)}
      ${sec("Where it sends you",there)}
      ${sec("Cargo",(w.cargo||[]).map(o=>`<div class="mk-row"><div class="w">${esc(o.what)}</div><div class="p">${o.scu?rng(o.scu[0],o.scu[1]," SCU"):o.amount?`× ${rng(o.amount[0],o.amount[1])}`:""}</div><span></span>${o.box?`<div class="m">Boxes up to ${o.box} SCU</div>`:""}</div>`).join(""))}
      ${sec("Rewards",bps+items)}
      ${sec("Do these first",chain(w.needs_first||[]))}
      ${sec("Leads to",chain(w.leads_to||[]))}</div>
    <div class="uex-credit">From the Star Citizen Wiki's mission data (the game files): ranges and possible places for this kind of contract. The one you're offered in game picks from these.</div>`; }
function grOpenMission(kind,x){ const st=grState(kind), i=st.data?.items.find(y=>(y.uuid||y.name)===st.sel);
  st.mission={...x,from:st.mission?.from||i?.name||"Back",prev:st.mission||null}; $("gr-panel").scrollTop=0; grMission(kind); }
// ---- "Add to loadout" on a weapon, armor piece, clothing, gadget, key or consumable page: pick one of your gear
// loadouts (or make one) and it goes in the slot it fits: the first empty one, else it replaces that slot's item.
const glKinds=new Set(["weapons","armor","clothing","gadgets","utility","consumables"]);
function glSlotsFor(kind,i){ if(kind==="consumables") return ["cons"];
  const all=Object.values(GL_SLOT).filter(x=>x[2]===kind), fit=all.filter(x=>x[3](i)); return (fit.length?fit:all).map(x=>x[0]); }
async function glAddMenu(e,kind,i){ if(!S.gl.list) await glLoad().catch(()=>{}); const L=S.gl.list||[], slots=glSlotsFor(kind,i);
  document.querySelector(".wp-ctx")?.remove(); const m=document.createElement("div"); m.className="wp-ctx"; m.style.maxHeight="60vh"; m.style.overflow="auto";
  const where=lo=>{ if(slots[0]==="cons") return "Consumables"; const k=slots.find(k=>!lo.slots?.[k])||slots[0]; return `${GL_SLOT[k][1]}${lo.slots?.[k]?` (replaces ${lo.slots[k].name})`:""}`; };
  m.innerHTML=`<div class="h">Add ${esc(i.name)} to…</div>${L.map(lo=>`<button data-lo="${esc(lo.id)}">${lo.main?"★ ":""}${esc(lo.name)}<div class="muted" style="font-size:11.5px">${esc(where(lo))}</div></button>`).join("")}
    <button data-lo="" style="color:var(--route-2)">+ New loadout with it</button>`;
  document.body.appendChild(m); const r=m.getBoundingClientRect();
  m.style.left=Math.min(e.clientX,innerWidth-r.width-6)+"px"; m.style.top=Math.min(e.clientY+8,innerHeight-r.height-6)+"px";
  const close=()=>{ m.remove(); removeEventListener("mousedown",away,true); }, away=ev=>{ if(!m.contains(ev.target)) close(); };
  setTimeout(()=>addEventListener("mousedown",away,true),0);
  m.onclick=async ev=>{ const b=ev.target.closest("button"); if(!b) return; close();
    const item={name:i.name,uuid:i.uuid||null,class_name:i.class_name||null};
    let lo=b.dataset.lo?JSON.parse(JSON.stringify(L.find(x=>x.id===b.dataset.lo)||null)):{name:`${i.name} loadout`.slice(0,60),slots:{},consumables:[]};
    if(!lo) return;
    if(slots[0]==="cons"){ const c=(lo.consumables||(lo.consumables=[])).find(c=>(c.uuid&&c.uuid===item.uuid)||c.name===item.name); if(c) c.qty=Math.min(99,(c.qty||1)+1); else lo.consumables.push({...item,qty:1}); }
    else { const k=slots.find(k=>!lo.slots?.[k])||slots[0]; lo.slots={...(lo.slots||{}),[k]:item}; }
    const c=await glSave(lo,true); if(c) toast(`${i.name} added to ${c.name}`); }; }

$("gr-panel").addEventListener("click",async e=>{ if(await tradeClick(e)) return; const kind=S.tab; if(!GEAR[kind]) return; const st=grState(kind);
  const ga=e.target.closest("[data-gladd]"); if(ga){ const it=(st.data?.items||[]).find(x=>(x.uuid||x.name)===ga.dataset.gladd); if(it) glAddMenu(e,kind,it); return; }
  if(e.target.closest("[data-grretry]")) return grLoad(kind);
  const gm=e.target.closest("[data-grmission]"); if(gm){ let x; try{ x=JSON.parse(gm.dataset.grmission); }catch(_){ return; } return grOpenMission(kind,x); }
  if(e.target.closest("[data-grmback]")){ st.mission=st.mission?.prev||null; $("gr-panel").scrollTop=0; return st.mission?grMission(kind):grDetail(kind); }
  if(e.target.closest("[data-grmretry]")){ if(st.mission) st.mission.data=null; return grMission(kind); }
  const go=e.target.closest("[data-grbpopen]"); if(go){ const id=go.dataset.grbpopen; document.querySelector('.tab[data-tab="blueprints"]')?.click();
    for(let k=0;k<40&&!grState("blueprints").data?.items;k++) await new Promise(r=>setTimeout(r,250));
    const bs=grState("blueprints"); bs.mission=null; bs.sel=id; grRender("blueprints"); $("gr-panel").scrollTop=0; return; }
  const gb=e.target.closest("[data-grbp]"); if(gb&&kind==="blueprints"){ st.mission=null; st.sel=gb.dataset.grbp; grRender(kind); $("gr-panel").scrollTop=0; return; }
  if(e.target.closest("[data-grback]")){ st.sel=null; st.mission=null; grRender(kind); return; }
  const gc=e.target.closest("[data-grcomp]"); if(gc){ document.querySelector('.tab[data-tab="components"]')?.click(); setTimeout(()=>{ renderCpHome(); const q=$("cp-home-q"); if(q){ q.value=gc.dataset.grcomp; renderCpHome(); } },300); return; }
  if(e.target.closest("[data-grshop]")){ const i=st.data.items.find(x=>(x.uuid||x.name)===st.sel); if(!i) return;
    const r=await api().shop_add([{name:i.name,kind:GR_CART[kind],uuid:i.uuid,class_name:i.class_name}]); toast(r.ok?`${i.name} added to your shopping list`:r.error); return; }
  if(e.target.closest("[data-grshopset]")){ const s=grSets(st.data.items).find(x=>"set:"+x.name===st.sel); if(!s) return;
    const got=grSetCartPieces(s); if(!got.length) return toast("None of these pieces is sold or known to drop");
    return addToCart(got.map(p=>({name:p.name,kind:"armor",uuid:p.uuid,class_name:p.class_name,source:s.name})),`${s.name} (${plural(got.length,"piece")})`); }
  const h=e.target.closest("[data-gi],[data-gset]"); if(h) grOpenItem(kind,h.dataset.gi||null,h.dataset.gset||null); });
document.addEventListener("click",e=>{ const f=e.target.closest("[data-grfresh]"); if(f&&GEAR[S.tab]) grLoad(S.tab,true); });
