// Quantum UI: The shopping list (Cart).
// One of several classic scripts sharing one global scope; index.html loads them in order.
"use strict";
// =================================================================== Shopping list
// The parts and gear you want, then the trip: fewest stops (or cheapest), in order from where you are. Each stop
// lists what to buy there; buying it in game ticks it off (Game.log shows shop purchases), or tick it yourself.
const SH_KIND={component:"Ship part",weapon:"Weapon",armor:"Armor",gadget:"Gadget",clothing:"Clothing",consumable:"Consumable",utility:"Utility item"};
// Clicking something in the cart opens its own page: parts in Components, gear in its Gear tab
const GR_TAB_OF=Object.fromEntries(Object.entries(GR_CART).map(([t,k])=>[k,t]));
async function cartOpenItem(x){ if(!x) return;
  const waitFor=async(f,n=40)=>{ for(let k=0;k<n&&!f();k++) await new Promise(r=>setTimeout(r,200)); return f(); };
  if(x.kind==="component"){ const t=document.querySelector('.tab[data-tab="components"]'); if(!t||t.hidden) return toast("Components needs your UEX token in Settings");
    t.click(); await waitFor(()=>S.cpCats); const ix=await cpLoadIndex();
    const nm=(x.name||"").toLowerCase(), hit=ix?.items?.find(i=>(x.uex_id!=null&&String(i.id)===String(x.uex_id))||(x.uuid&&i.uuid&&String(i.uuid).toLowerCase()===String(x.uuid).toLowerCase()))||ix?.items?.find(i=>(i.name||"").toLowerCase()===nm);
    if(hit) return openCpPart(`${hit.cat}|${hit.id}`);
    renderCpHome(); const q=$("cp-home-q"); if(q){ q.value=x.name; renderCpHome(); } return; }
  const tab=GR_TAB_OF[x.kind]; const t=tab&&document.querySelector(`.tab[data-tab="${tab}"]`); if(!t) return toast("Couldn't find where that item lives");
  t.click(); const ok=await waitFor(()=>grState(tab).data?.items); if(!ok) return;
  const st=grState(tab); if(tab==="armor") st.view="items";
  const it=st.data.items.find(i=>x.uuid&&i.uuid&&String(i.uuid).toLowerCase()===String(x.uuid).toLowerCase())||st.data.items.find(i=>(i.name||"").toLowerCase()===(x.name||"").toLowerCase());
  if(!it) return toast(`${x.name} isn't in the list any more`);
  grOpenItem(tab,it.uuid||it.name,null); }
async function openShopping(){ $("sh-panel").classList.add("show"); await renderShopping(true); }
async function renderShopping(autoPlan){ let r=await api().shop_list(); S.slData=r; if(S.tab!=="shopping") return;
  // Opening the cart (or changing an amount) with things in it that aren't planned yet works out the route straight away
  if(autoPlan&&!r.plan&&r.left){ $("sh-panel").innerHTML=qLoader("Finding the shops and the quickest way round…"); const p=await api().shop_plan(null);
    if(p.ok){ r=await api().shop_list(); S.slData=r; } if(S.tab!=="shopping") return; }
  setCartCount(r.left);
  shRenderReceipt(r); shRenderPlan(r); }
// The sidebar: the receipt. Each stop and what you'll spend there, the total, how to plan, and what to do with it.
function shRenderReceipt(r){ const p=r.plan, cur=r.step, mode=r.mode||"fewest", el=$("sh-out");
  const total=p?p.total:r.items.reduce((t,x)=>t+(x.price!=null?x.price*Math.max(0,(x.qty||1)-(x.bought||0)):0),0);
  const bought=r.items.reduce((t,x)=>t+(x.bought||0),0), all=r.items.reduce((t,x)=>t+(x.qty||1),0);
  el.innerHTML=`<div class="shr">
    ${r.items.length?`<div class="shr-card">
      ${p?.steps?.length?`<span class="shr-k">Shopping route</span><ol class="shr-stops">${p.steps.map((st,i)=>{ const past=cur==null||i<cur;
          return `<li class="${past&&i!==cur?"past":""}"><span class="n">${past&&i!==cur?"✓":i+1}</span><span class="w">${st.place?`<a data-open="${esc(st.place)}">${esc(st.where)}</a>`:esc(st.where)}</span><span class="v">${money(st.subtotal)}</span></li>`; }).join("")}</ol><div class="shr-rule"></div>`:""}
      <div class="shr-total"><span class="shr-k">${p?"Total":"About"}</span><b>${Math.round(total).toLocaleString()}<small>aUEC</small></b></div>
      <div class="shr-meta">${plural(r.items.length,"item")} · ${Math.max(0,all-bought).toLocaleString()} still to buy${p?.steps?.length?` · ${plural(p.steps.length,"stop")}`:""}${bought?` · ${bought.toLocaleString()} already bought`:""}${p?.distance?` · ${fmtDist(p.distance)}${p.from_you?" from you":""}`:""}</div>
      <fieldset class="shr-mode"><legend class="shr-k">Plan for</legend>
        ${[["fewest","Fewest stops","Get it all in as few places as possible"],["cheapest","Lowest price","Each item where it's cheapest, more stops"]].map(([v,t,d])=>`<label class="${mode===v?"on":""}"><input type="radio" name="sh-mode" value="${v}" ${mode===v?"checked":""}><span><b>${t}</b><small>${d}</small></span></label>`).join("")}</fieldset>
      ${p?.steps?.length?`<button type="button" class="shr-go" data-shroute="add">Add the stops to my route</button>
        <div class="shr-two"><button type="button" class="btn small" data-shroute="replace">Replace my route</button><button type="button" class="btn small" data-shplan="1" title="${S.live?.player?"Work the trip out again from where you are":"Work the trip out again"}">Plan again</button></div>`
        :`<button type="button" class="shr-go" data-shplan="1">Plan the trip</button>`}
      <div class="shr-two"><button type="button" class="btn small ghost" data-shclear="bought">Remove bought</button><button type="button" class="btn small ghost" data-shclear="all">Empty cart</button></div></div>`
    :`<div class="shr-card"><span class="shr-k">Nothing in your cart yet</span><div style="font-size:13px;color:var(--ink-2);line-height:1.55">Look for the ${CART_SVG.replace('<svg','<svg class="inl"')} button on parts, weapons, armor and more. Quantum then plans the trip to buy it all.</div></div>`}</div>`; }
// An empty cart: how it works, and where to start filling it
const SH_START=[["components","Ship components","Coolers, shields, quantum drives, power plants","component"],["shipweapons","Ship weapons","Guns, cannons, repeaters and missiles","turret"],
  ["weapons","Weapons","Pistols, rifles and launchers","pistol"],["armor","Armor","Helmets, cores, arms, legs and undersuits","armor"],
  ["clothing","Clothing","Jackets, pants and footwear","shirt"],["consumables","Consumables","Food, drinks and MedPens","med"],["gearlo","Gear loadouts","Kit for a job: add every piece in one go","kit"]];
const SH_IC={component:'<rect x="6" y="6" width="12" height="12" rx="1.5"/><rect x="9.5" y="9.5" width="5" height="5"/><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"/>',
  armor:'<path d="M12 3l7 3v5c0 5-3 8.5-7 10-4-1.5-7-5-7-10V6z"/>',shirt:'<path d="M8 3l-5 3 2 4 3-1v12h8V9l3 1 2-4-5-3c-1 2-2.5 3-4 3s-3-1-4-3z"/>',
  med:'<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"/>',kit:'<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18"/>'};
function shEmptyHtml(){
  // Weapons and ship weapons use the same game-style icons as everywhere else in Quantum (the service tiles)
  const ic=k=>k==="pistol"||k==="turret"?`<svg class="solid" viewBox="${SVC_SOLID[k][0]}" aria-hidden="true"><path d="${SVC_SOLID[k][1]}"/></svg>`:`<svg viewBox="0 0 24 24" aria-hidden="true">${SH_IC[k]}</svg>`;
  return `<div class="she"><div class="she-hero"><div class="she-badge" aria-hidden="true">${CART_SVG}</div>
      <h2>Your cart is empty</h2><p>Select anything you want for a new ship, weapon or gear loadout, equipment, food or drinks, and add them to the cart. Quantum finds the shops which sell it and optimizes your route so you can purchase them efficiently.</p></div>
    <ol class="she-how">
      <li><span class="n">1</span><b>Add items to Cart</b><span>Click the ${CART_SVG.replace('<svg','<svg class="inl"')} button on any part, weapon, armor or consumable. Set how many you need.</span></li>
      <li><span class="n">2</span><b>Quantum plans the trip</b><span>Pick fewest stops or lowest price. You get each shop to visit, in order, and what to buy there.</span></li>
      <li><span class="n">3</span><b>Fly and buy</b><span>Add the stops to your route. What you buy in game is read from the game log and marked bought here.</span></li></ol>
    <div class="mk-h" style="margin:26px 2px 10px">Start shopping</div>
    <div class="she-go">${SH_START.map(([tab,t,d,k])=>`<button type="button" class="she-tile" data-shgo="${tab}">${ic(k)}<span><b>${esc(t)}</b><small>${esc(d)}</small></span></button>`).join("")}</div></div>`; }
// Over the map: everything in the cart as one table, grouped by stop (or by kind of item, or what it's for)
const SH_GEAR_KINDS=new Set(["weapon","armor","gadget","clothing","consumable","utility"]);
function shRenderPlan(r){ const p=r.plan, g=$("sh-panel");
  if(!r.items.length){ g.innerHTML=shEmptyHtml(); return; }
  const byid=Object.fromEntries(r.items.map(x=>[x.id,x])), cur=r.step, done=cur==null&&p?.steps?.length;
  const by=S.shGroup==="type"||S.shGroup==="for"?S.shGroup:p?.steps?.length?"stop":"type";
  const row=(x,{shop=null,cost=null,qty=null}={})=>{ if(!x) return ""; const left=Math.max(0,(x.qty||1)-(x.bought||0)), got=!left, n=qty??x.qty;
    const each=cost!=null&&n?cost/n:x.price, sum=cost!=null?cost:(x.price!=null?x.price*(x.qty||1):null);
    const pic=SH_GEAR_KINDS.has(x.kind)?`data-gpic="${esc(x.name)}"`:`data-pic="${esc(x.name)}"`;
    return `<tr class="${got?"got":""}"><td class="ck"><input type="checkbox" aria-label="Bought ${esc(x.name)}" data-shbought="${esc(x.id)}" ${got?"checked":""}></td>
      <td><div class="sht-it"><div class="sht-ph" ${pic}>${phCard(x.kind==="component"?"component":"commodity")}</div><div class="t"><a class="cart-open" data-shopen="${esc(x.id)}" title="Open ${esc(x.name)}">${esc(x.name)}</a>
        <small>${esc([SH_KIND[x.kind]||x.kind,x.source?`for ${x.source}`:"",shop||(!p&&x.where?x.where:"")].filter(Boolean).join(" · "))}</small></div></div></td>
      <td><div class="sht-q"><button type="button" data-shq="${esc(x.id)}" data-d="-1" aria-label="One fewer ${esc(x.name)}">−</button><input type="number" min="1" max="100000" step="1" inputmode="numeric" data-shqin="${esc(x.id)}" value="${x.qty||1}" aria-label="How many ${esc(x.name)}"><button type="button" data-shq="${esc(x.id)}" data-d="1" aria-label="One more ${esc(x.name)}">+</button>${x.bought&&!got?`<span class="got">${x.bought.toLocaleString()} bought</span>`:""}</div></td>
      <td class="r each">${each!=null?money(each):'<span class="muted">–</span>'}</td><td class="r sum">${sum!=null?money(sum):'<span class="muted">not in shops</span>'}</td>
      <td class="x"><button type="button" data-shdel="${esc(x.id)}" aria-label="Take ${esc(x.name)} out of the cart" title="Take it out of the cart">✕</button></td></tr>`; };
  const group=(head,rows,cls="")=>`<tbody><tr class="grp ${cls}"><th colspan="6" scope="colgroup"><div class="gi">${head}</div></th></tr>${rows}</tbody>`;
  let body="";
  if(by==="stop"){ const seen=new Set();
    body=p.steps.map((st,i)=>{ const isCur=i===cur, past=cur==null||i<cur, here=r.here&&st.place===r.here;
      for(const it of st.items) seen.add(it.id);
      return group(`<span class="dot">${past&&!isCur?"✓":i+1}</span>${st.place?`<a data-open="${esc(st.place)}">${esc(st.where)}</a>`:esc(st.where)}<span class="m">${esc(st.system||"")}${isCur?(here?" · <b>You're here</b>":" · next stop"):past?" · bought":""}</span>
          <span class="s">${money(st.subtotal)}</span>${isCur?`${st.place&&!S.live?.route?.includes(st.place)?`<button class="btn small ghost" data-add="${esc(st.place)}">Add to route</button>`:""}<button class="btn small primary" data-shstep="${i}">Bought everything here · next stop</button>`:""}`,
        st.items.map(it=>row(byid[it.id],{shop:it.shop,cost:it.cost,qty:it.qty})).join(""),isCur?"cur":past?"past":""); }).join("");
    for(const s2 of p.offmap||[]){ for(const it of s2.items) seen.add(it.id);
      body+=group(`<span class="dot">·</span>${esc(s2.where)}<span class="m">${esc(s2.system||"")} · not on Quantum's map</span><span class="s">${money(s2.subtotal)}</span>`,s2.items.map(it=>row(byid[it.id],{shop:it.shop,cost:it.cost,qty:it.qty})).join("")); }
    const un=(p.unavailable||[]).filter(id=>byid[id]&&!seen.has(id)); for(const id of un) seen.add(id);
    if(un.length) body+=group(`<span class="dot">?</span>Not sold in any shop<span class="m">loot, rewards, crafting or stock on a ship: open one to see how to get it</span>`,un.map(id=>row(byid[id])).join(""));
    const rest=r.items.filter(x=>!seen.has(x.id));
    if(rest.length) body+=group(`<span class="dot">+</span>Not planned yet<span class="m">plan again to fit them into the route</span>`,rest.map(x=>row(x)).join("")); }
  else { const key=by==="for"?(x=>x.source||"Yourself"):(x=>SH_KIND[x.kind]||x.kind||"Other"), groups=new Map();
    for(const x of r.items){ const k=key(x); if(!groups.has(k)) groups.set(k,[]); groups.get(k).push(x); }
    body=[...groups].sort((a,b)=>a[0].localeCompare(b[0])).map(([k,L])=>{ const sub=L.reduce((t,x)=>t+(x.price!=null?x.price*(x.qty||1):0),0);
      return group(`<span class="dot">${L.length}</span>${esc(k)}<span class="s">${sub?money(sub):""}</span>`,L.map(x=>row(x)).join("")); }).join(""); }
  g.innerHTML=`<div class="sht-top"><div style="flex:1 1 280px"><h2>${p?.steps?.length?"Your shopping list":"Your cart"}</h2>
      <div class="muted">${plural(r.items.length,"item")} · ${r.left.toLocaleString()} still to buy${by==="stop"?" · grouped by where you'll buy them":""}</div></div>
    <label>Group by <select class="field" data-shgroup="1">${[...(p?.steps?.length?[["stop","Stop"]]:[]),["type","Kind of item"],["for","What it's for"]].map(([v,t])=>`<option value="${v}" ${by===v?"selected":""}>${t}</option>`).join("")}</select></label></div>
    ${done?`<div class="sh-done">✓ All bought. Enjoy the new kit.</div>`:""}
    <div class="sht-wrap"><table class="sht"><thead><tr><th class="ck"><span class="sr-only">Bought</span></th><th>Item</th><th>How many</th><th class="r">Each</th><th class="r">Subtotal</th><th><span class="sr-only">Remove</span></th></tr></thead>${body}</table></div>
    <div class="uex-credit" style="margin-top:12px">${p?.mode==="cheapest"?"Each item where it's cheapest.":p?"As few stops as possible; each item at the cheapest of them.":""} Prices from UEX, reported by players, so check the terminal before you buy. Purchases you make in game tick themselves off. Type an amount to buy lots at once.</div>`;
  fillGearPictures(g); fillPictures(g); }
// Planning (Plan for, Plan again): works the trip out again and redraws
async function shPlan(mode){ $("sh-panel").innerHTML=qLoader("Finding the shops and the shortest way round…"); const r=await api().shop_plan(mode||S.slData?.mode||null); if(!r.ok) toast(r.error); renderShopping(); }
// A new amount: saved, then the trip is worked out again for it
async function shSetQty(id,n){ const x=S.slData?.items.find(i=>i.id===id); if(!x) return;
  n=Math.floor(+n); if(!isFinite(n)) return renderShopping();
  if(n<1){ await api().shop_remove(x.id); toast(`${x.name} taken out of the cart`); }
  else { n=Math.min(100000,n); if(n===x.qty) return; await api().shop_set(x.id,n,null); }
  renderShopping(true); }
async function shClick(e){
  const go=e.target.closest("[data-shgo]"); if(go){
    // Ship weapons: the Components tab, opened on its ship guns
    if(go.dataset.shgo==="shipweapons"){ document.querySelector('.tab[data-tab="components"]')?.click();
      for(let k=0;k<40&&!S.cpCats;k++) await new Promise(r=>setTimeout(r,250));
      const c=(S.cpCats||[]).find(x=>x.slot==="WeaponGun"); if(c) openCpCat(c.id); return; }
    document.querySelector(`.tab[data-tab="${go.dataset.shgo}"]`)?.click(); return; }
  const so=e.target.closest("[data-shopen]"); if(so){ e.preventDefault(); e.stopPropagation(); return cartOpenItem(S.slData?.items.find(i=>i.id===so.dataset.shopen)); }
  const q=e.target.closest("[data-shq]"); if(q){ const x=S.slData?.items.find(i=>i.id===q.dataset.shq); if(!x) return; return shSetQty(x.id,(x.qty||1)+(+q.dataset.d)); }
  const d=e.target.closest("[data-shdel]"); if(d){ await api().shop_remove(d.dataset.shdel); return renderShopping(true); }
  const c=e.target.closest("[data-shclear]"); if(c){ if(c.dataset.shclear==="all"&&!S.shClearAsk){ S.shClearAsk=true; c.textContent="Sure? Click again"; setTimeout(()=>{ S.shClearAsk=false; if(c.isConnected) c.textContent="Empty cart"; },3000); return; }
    S.shClearAsk=false; await api().shop_remove(null,c.dataset.shclear==="bought",c.dataset.shclear==="all"); return renderShopping(); }
  if(await tradeClick(e)) return;
  if(e.target.closest("[data-shplan]")) return shPlan();
  const st=e.target.closest("[data-shstep]"); if(st){ await api().shop_step_done(+st.dataset.shstep); toast("Purchased"); return renderShopping(); }
  const ro=e.target.closest("[data-shroute]"); if(ro){ const r=await api().shop_to_route(ro.dataset.shroute==="replace"); await poll(); toast(r.ok?(ro.dataset.shroute==="replace"?"Your route is now the shopping trip":`Added ${plural(r.added?.length||0,"stop")} to your route`):r.error); return; } }
async function shChange(e){
  const b=e.target.closest("[data-shbought]"); if(b){ const x=S.slData?.items.find(i=>i.id===b.dataset.shbought); if(!x) return; await api().shop_set(x.id,null,b.checked?x.qty:0); return renderShopping(); }
  const qi=e.target.closest("[data-shqin]"); if(qi) return shSetQty(qi.dataset.shqin,qi.value);
  const m=e.target.closest('input[name="sh-mode"]'); if(m) return shPlan(m.value);
  const gr=e.target.closest("[data-shgroup]"); if(gr){ S.shGroup=gr.value; return shRenderPlan(S.slData); } }
for(const id of ["sh-out","sh-panel"]){ $(id).addEventListener("click",shClick); $(id).addEventListener("change",shChange);
  // Enter in an amount box saves it straight away; Esc puts the old amount back
  $(id).addEventListener("keydown",e=>{ const qi=e.target.closest?.("[data-shqin]"); if(!qi) return;
    if(e.key==="Enter"){ e.preventDefault(); qi.blur(); }
    else if(e.key==="Escape"){ const x=S.slData?.items.find(i=>i.id===qi.dataset.shqin); if(x) qi.value=x.qty; qi.blur(); } }); }

function syncUexTabs(on){ if(S.uexTabs===on) return; S.uexTabs=on;
  for(const t of document.querySelectorAll(".uex-tab")) t.hidden=!on;
  if(!on&&["market","trade","datarunner","vehicles","components","fleet"].includes(S.tab)) document.querySelector('.tab[data-tab="route"]').click();
  syncRail(); }
