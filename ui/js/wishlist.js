// Quantum UI: Your wish list.
// One of several classic scripts sharing one global scope; index.html loads them in order.
"use strict";
// =================================================================== Wish list
// Ships, parts and gear you want, to come back to: a heart on any ship, part or piece of gear adds it. Each entry
// keeps how much you want it (1-3 stars), and goes into the Cart in one click when you're ready to buy
// in game. Signed in to your Quantum account, the list is kept with the account too, so every PC has the same one.
S.wl=S.wl||{items:null,kind:"all",sort:"added"};
const WL_KIND={ship:"Ship",component:"Ship part",weapon:"Weapon",armor:"Armor",gadget:"Gadget",clothing:"Clothing",consumable:"Consumable",utility:"Key",other:"Other"};
const WL_ART={ship:"vehicle",component:"component",weapon:"weapon",armor:"armor",gadget:"gadget",clothing:"clothing",consumable:"food",utility:"key",attachment:"weapon"};
const WL_FILTERS=[["all","Everything"],["ship","Ships"],["component","Ship parts"],["gear","Gear"]];
const WL_GEAR=new Set(["weapon","armor","gadget","clothing","consumable","utility","attachment"]);
const WISH_SVG='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5s-7.5-4.6-9.2-9.6C1.7 7.6 3.9 4.5 7.2 4.5c2 0 3.6 1.1 4.8 2.8 1.2-1.7 2.8-2.8 4.8-2.8 3.3 0 5.5 3.1 4.4 6.4-1.7 5-9.2 9.6-9.2 9.6z"/></svg>';
// Is it on the list? (by uuid, a ship's id, else kind and name: the same rule as the app's)
function wlFind(x){ const L=S.wl.items||[];
  return L.find(w=>w.kind===x.kind&&((x.uuid&&w.uuid&&String(w.uuid).toLowerCase()===String(x.uuid).toLowerCase())
    ||(x.kind==="ship"&&x.uex_id!=null&&w.uex_id!=null&&String(w.uex_id)===String(x.uex_id))
    ||(!(x.uuid&&w.uuid)&&(w.name||"").toLowerCase()===(x.name||"").toLowerCase())))||null; }
// The heart: on any ship, part or piece of gear. Filled when it's on your list; clicking again takes it off.
function wishBtn(x,label){ const on=!!wlFind(x);
  return `<button class="wish-btn ${label?"lab":""} ${on?"on":""}" data-wish="${esc(JSON.stringify(x))}" title="${on?`On your wish list: click to take it off`:`Add ${esc(x.name)} to your wish list`}" aria-pressed="${on}">${WISH_SVG}${label?`<span>${on?"On your wish list":esc(label)}</span>`:""}</button>`; }
function wlPaintHearts(){ for(const b of document.querySelectorAll("[data-wish]")){ let x; try{ x=JSON.parse(b.dataset.wish); }catch(_){ continue; }
  const on=!!wlFind(x); b.classList.toggle("on",on); b.setAttribute("aria-pressed",String(on));
  b.title=on?"On your wish list: click to take it off":`Add ${x.name} to your wish list`;
  const s=b.querySelector("span"); if(s) s.textContent=on?"On your wish list":"Add to wish list"; } }
function setWishCount(n){ const c=$("c-wish"); if(c){ c.textContent=n||0; c.hidden=!n; } }
async function wlLoad(){ let r; try{ r=await api().wish_list(); }catch(e){ r=null; } if(!r?.ok) return S.wl.items||[];
  S.wl.items=r.items; S.wl.sync=r.sync; S.wl.alerts=r.alerts!==false; S.wl.ver=r.ver; setWishCount(r.items.length); wlPaintHearts();
  // a sync with the account is on its way: look again in a moment, so changes from other PCs show up by themselves
  if(r.sync?.busy&&!S.wl.again){ S.wl.again=setTimeout(async()=>{ S.wl.again=null; const v=S.wl.ver; await wlLoad(); if(S.tab==="wishlist"&&S.wl.ver!==v) renderWishlist(); else if(S.tab==="wishlist") wlSide(); },2000); }
  return r.items; }
// Captured first, so a heart inside a clickable card doesn't also open the card
document.addEventListener("click",async e=>{ const b=e.target.closest("[data-wish]"); if(!b) return; e.stopPropagation(); e.preventDefault();
  let x; try{ x=JSON.parse(b.dataset.wish); }catch(_){ return; }
  if(!S.wl.items) await wlLoad();
  const have=wlFind(x);
  if(have){ const r=await api().wish_remove(have.id); if(!r.ok) return toast(r.error); S.wl.items=S.wl.items.filter(w=>w.id!==have.id); toast(`${x.name} taken off your wish list`); }
  else { const r=await api().wish_add(x); if(!r.ok) return toast(r.error); if(r.added) S.wl.items=[r.item,...S.wl.items]; toast(`${x.name} added to your wish list · ${plural(r.count,"item")} on it`); }
  setWishCount(S.wl.items.length); wlPaintHearts(); if(S.tab==="wishlist") renderWishlist(); },true);

async function openWishlist(){ $("wi-panel").classList.add("show"); if(!S.wl.items) $("wi-panel").innerHTML=qLoader("Opening your wish list…");
  await wlLoad(); renderWishlist(); }
function wlShown(){ const L=S.wl.items||[], k=S.wl.kind;
  const f=k==="all"?L:k==="gear"?L.filter(x=>WL_GEAR.has(x.kind)):L.filter(x=>x.kind===k);
  const by=S.wl.sort;
  return f.slice().sort((a,b)=>by==="priority"?(b.priority||0)-(a.priority||0)||(b.added||0)-(a.added||0)
    :by==="price"?(a.price??9e15)-(b.price??9e15):by==="name"?(a.name||"").localeCompare(b.name||""):(b.added||0)-(a.added||0)); }
function renderWishlist(){ if(S.tab!=="wishlist") return; wlSide(); wlMain(); }
function wlSyncLine(){ const s=S.wl.sync||{};
  if(!s.signed_in) return `<span class="wl-sync off">On this PC only · <a data-wla="signin">sign in</a> to keep it with your Quantum account</span>`;
  if(s.busy) return `<span class="wl-sync">Syncing…</span>`;
  if(s.error) return `<span class="wl-sync err">${esc(s.error)}</span>`;
  return `<span class="wl-sync ok">Synced with your Quantum account automatically${s.at?` · last ${agoTs(s.at)}`:""}</span>`; }
function wlSide(){ const P=$("pane-wishlist"), L=S.wl.items||[];
  const buyable=L.filter(x=>x.price!=null), total=buyable.reduce((a,x)=>a+x.price*(x.qty||1),0);
  const n=k=>k==="all"?L.length:k==="gear"?L.filter(x=>WL_GEAR.has(x.kind)).length:L.filter(x=>x.kind===k).length;
  P.innerHTML=`<div class="wl-sum"><div><div class="big">${L.length}</div><div class="muted">${L.length===1?"thing":"things"} you want</div></div>
      <div><div class="big">${buyable.length?money(total):"–"}</div><div class="muted">${buyable.length?`for the ${plural(buyable.length,"one")} sold in game`:"nothing on it is sold in game"}</div></div></div>
    <div class="wl-filters">${WL_FILTERS.map(([k,lab])=>`<button class="chip ${S.wl.kind===k?"on":""}" data-wlk="${k}">${esc(lab)}<small>${n(k)}</small></button>`).join("")}</div>
    <label class="muted" style="font-size:12px;display:flex;gap:8px;align-items:center;margin:10px 2px">Sort by
      <select class="field" id="wl-sort" style="flex:1">${[["added","Newest first"],["priority","Most wanted"],["price","Cheapest in game"],["name","Name"]].map(([v,l])=>`<option value="${v}" ${S.wl.sort===v?"selected":""}>${l}</option>`).join("")}</select></label>
    <button class="btn primary wl-cartall" data-wla="cartall" ${buyable.length?"":"disabled"} title="Put everything on the list that's sold in game in your cart">${CART_SVG}<span>Add all to cart</span></button>
    <label class="wl-alert"><input type="checkbox" id="wl-alerts" ${S.wl.alerts!==false?"checked":""} ${S.wl.sync?.signed_in?"":"disabled"}>
      <span><b>Tell me when a player sells one</b>A notification when someone lists something on your wish list in the Market${S.wl.sync?.signed_in?"":" (needs your Quantum account)"}</span></label>
    <div class="muted" style="font-size:12px;margin:12px 2px 0;line-height:1.5">${wlSyncLine()}</div>
    <div class="muted" style="font-size:12px;margin:10px 2px 0;line-height:1.5">Add to it with the heart on any ship, ship part or piece of gear.</div>`; }
function wlStars(x){ const p=x.priority||0;
  return `<span class="wl-stars" title="How much you want it">${[1,2,3].map(i=>`<button class="${i<=p?"on":""}" data-wlstar="${esc(x.id)}|${i===p?0:i}" aria-label="${i} star${i>1?"s":""}">★</button>`).join("")}</span>`; }
function wlCard(x){ const art=WL_ART[x.kind]||"box", cartable=x.kind!=="other";
  const pic=x.photo?`<img src="${esc(x.photo)}" alt="" loading="lazy" referrerpolicy="no-referrer">`:phCard(art);
  const gpic=!x.photo&&WL_GEAR.has(x.kind)?`data-gpic="${esc(x.name)}"`:"";
  const sold=x.price!=null;
  return `<div class="wl-card" data-wlid="${esc(x.id)}">
    <div class="ph ph-g" ${gpic} data-wlopen="${esc(x.id)}" title="Open ${esc(x.name)}">${pic}</div>
    <div class="bd"><div class="hd"><div><a data-wlopen="${esc(x.id)}" class="nm">${esc(x.name)}</a>
        <div class="m">${esc([WL_KIND[x.kind]||"Item",x.maker].filter(Boolean).join(" · "))}</div></div>${wlStars(x)}</div>
      <div class="wl-price ${sold?"":"no"}">${sold?`<b>${money(x.price)}</b><span>${x.where?`cheapest at ${esc(x.where)}`:""}${x.shops>1?` · ${plural(x.shops,"shop")}`:""}</span>`
        :`<b>Not sold in game</b><span>${x.kind==="ship"?"Pledge store, or wait for it to reach the ship shops":"Loot, crafting, a reward or the pledge store: open it to see how to get it"}</span>`}</div>
      ${wlMarketLine(x)}
      <div class="wl-btns">${cartable&&sold?`<button class="btn small primary" data-wlcart="${esc(x.id)}">${CART_SVG} Add to cart</button>`:""}
        <button class="btn small ghost wl-rm" data-wlrm="${esc(x.id)}" aria-label="Take ${esc(x.name)} off your wish list">Remove</button></div></div></div>`; }
// Players selling it in the Market right now: the cheapest, and a link to it
function wlMarketLine(x){ const L=x.market||[]; if(!L.length) return "";
  const c=L.slice().sort((a,b)=>(a.price||0)-(b.price||0))[0];
  return `<div class="wl-market"><span class="dot"></span><span>${L.length===1?"A player is selling it":`${L.length} players are selling it`}${c.price?` · from ${money(c.price)}`:""}</span>
    <button class="btn small" data-wlpm="${c.id}" title="${esc(c.title)}">See it in Market</button></div>`; }
function wlMain(){ const P=$("wi-panel"), L=wlShown();
  if(!(S.wl.items||[]).length){ P.innerHTML=`<div class="gh"><b>Your wish list</b>Nothing on it yet</div>
      <div class="empty" style="margin-top:40px"><strong>Keep track of what you want</strong>Press the heart on any ship in Vehicles, any part in Components, or any weapon, armor or other gear.
      It's all kept here with its price in game, and goes in your cart in one click when you're ready.${S.wl.sync?.signed_in?"":" Sign in to your Quantum account and the list follows you to every PC."}</div>`; return; }
  P.innerHTML=`<div class="gh"><b>Your wish list</b>${plural(L.length,"item")}${S.wl.kind!=="all"?` · ${esc((WL_FILTERS.find(f=>f[0]===S.wl.kind)||[])[1]||"")}`:""}</div>
    ${L.length?`<div class="wl-grid">${L.map(wlCard).join("")}</div>`:`<div class="empty">Nothing of this kind on your list.</div>`}
    <div class="uex-credit">Prices in game from UEX, reported by players: check the terminal before you buy. Pledge store prices are real money.</div>`;
  fillGearPictures(P); }
// Opening an entry: its own page (a ship in Vehicles, a part in Components, gear in its tab)
async function wlOpen(x){ if(!x) return;
  S.wlFrom={tab:x.kind==="ship"?"vehicles":x.kind==="component"?"components":GR_TAB_OF[x.kind]};
  if(x.kind==="ship"){ const t=document.querySelector('.tab[data-tab="vehicles"]'); if(!t||t.hidden) return toast("Vehicles needs your UEX token in Settings");
    S.vehDetail=x.uex_id!=null?String(x.uex_id):null; S.vehGalKey=null; t.click();
    if(x.uex_id==null){ const q=$("vh-search"); if(q){ q.value=x.name; q.dispatchEvent(new Event("input",{bubbles:true})); } } return; }
  return cartOpenItem(x); }
document.addEventListener("click",async e=>{ if(!e.target.closest("#wi-panel,#pane-wishlist")) return;
  const L=S.wl.items||[], byId=id=>L.find(x=>x.id===id);
  const k=e.target.closest("[data-wlk]"); if(k){ S.wl.kind=k.dataset.wlk; return renderWishlist(); }
  const o=e.target.closest("[data-wlopen]"); if(o) return wlOpen(byId(o.dataset.wlopen));
  const rm=e.target.closest("[data-wlrm]"); if(rm){ const x=byId(rm.dataset.wlrm); const r=await api().wish_remove(rm.dataset.wlrm); if(!r.ok) return toast(r.error);
    S.wl.items=L.filter(w=>w.id!==rm.dataset.wlrm); setWishCount(S.wl.items.length); toast(`${x?.name||"It"} taken off your wish list`); return renderWishlist(); }
  const st=e.target.closest("[data-wlstar]"); if(st){ const [id,p]=st.dataset.wlstar.split("|"); const r=await api().wish_set(id,null,Number(p),null); if(!r.ok) return toast(r.error);
    const x=byId(id); if(x) x.priority=Number(p); return renderWishlist(); }
  const pm=e.target.closest("[data-wlpm]"); if(pm) return wlOpenListing(+pm.dataset.wlpm);
  const c=e.target.closest("[data-wlcart]"); if(c){ const r=await api().wish_to_cart([c.dataset.wlcart],false); return wlCartDone(r); }
  const a=e.target.closest("[data-wla]"); if(!a) return;
  if(a.dataset.wla==="cartall"){ const r=await api().wish_to_cart(null,false); return wlCartDone(r); }
  if(a.dataset.wla==="signin") return openProfileView("accounts"); });
function wlCartDone(r){ if(!r?.ok) return toast(r?.error||"Couldn't add to the cart");
  if(r.left!=null) setCartCount(r.left);
  const sk=r.skipped||[];
  toast(r.added?`${plural(r.added,"item")} added to your cart${sk.length?` · ${sk.length} not sold in game`:""}. Open Cart to see the route`
    :sk.length?`${sk[0].name}: ${sk[0].why}`:"Nothing to add", 3600); }
document.addEventListener("change",async e=>{
  if(e.target.id==="wl-sort"){ S.wl.sort=e.target.value; return renderWishlist(); }
  if(e.target.id==="wl-alerts"){ const r=await api().wish_alerts_set(e.target.checked); S.wl.alerts=!!r?.on;
    toast(S.wl.alerts?"You'll be told when a player lists something on your wish list":"Market alerts for your wish list are off"); } });
// A player's listing of something on your list, in the Market
async function wlOpenListing(id){ S.wlFrom={tab:"pm-items"}; const t=document.querySelector('.tab[data-tab="pm-items"]'); if(!t) return; t.click(); pmOpen(id); }
// "← Back to wish list" on the page you opened from it (a ship, part, piece of gear or Market listing)
function wlBackBtn(tab,small){ return (S.wlFrom&&S.wlFrom.tab===tab?`<button class="btn ${small?"small ":""}primary" data-wlback="1">← Back to wish list</button>`:"")
  +(typeof upBackBtn==="function"?upBackBtn(tab,small):"")          // (and back to someone's profile card)
  +(typeof bpBackBtn==="function"?bpBackBtn(tab,small):""); }        // (and back to the blueprint that needs it)
document.addEventListener("click",e=>{ const b=e.target.closest("[data-wlback]"); if(!b) return; e.stopPropagation(); e.preventDefault();
  S.wlFrom=null; document.querySelector('.tab[data-tab="wishlist"]')?.click(); },true);
// Going somewhere yourself (a tab or the rail) forgets it; Quantum's own clicks (opening from the list) don't
document.addEventListener("click",e=>{ if(e.isTrusted&&e.target.closest("#tabs .tab,#rail [data-group]")&&S.wlFrom) S.wlFrom=null; },true);
// Another PC's changes come in with the account: the list is asked for again now and then while it's open
setInterval(async()=>{ const before=S.wl.ver; await wlLoad(); if(S.tab==="wishlist"&&S.wl.ver!==before) renderWishlist(); },60000);
// Loaded once at start, so hearts show filled everywhere and the tab has its count
if(window.pywebview?.api?.wish_list) setTimeout(wlLoad,1500); else window.addEventListener("pywebviewready",()=>setTimeout(wlLoad,2500),{once:true});
