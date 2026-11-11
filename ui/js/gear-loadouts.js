// Quantum UI: Your gear loadouts.
// One of several classic scripts sharing one global scope; index.html loads them in order.
"use strict";
// =================================================================== Gear loadouts
// Your own sets of personal gear for a kind of job ("Bunker run", "Cave mining"): armor by slot, weapons, gadgets,
// utility items, clothing and consumables with how many. The picker uses the Weapons/Armor/… tabs' wiki lists.
const glCk=i=>`${i.kind||""} ${i.type||""} ${i.sub||""}`;
const GL_GROUPS=[
  ["Armor",[["helmet","Helmet","armor",i=>i.slot==="Helmet"],["core","Core","armor",i=>i.slot==="Core"],["arms","Arms","armor",i=>i.slot==="Arms"],
    ["legs","Legs","armor",i=>i.slot==="Legs"],["backpack","Backpack","armor",i=>i.slot==="Backpack"],["undersuit","Undersuit","armor",i=>i.slot==="Undersuit"]]],
  ["Weapons",[["primary","Primary","weapons",i=>!/pistol|knife|grenade/i.test(i.kind||"")],["secondary","Secondary","weapons",i=>!/knife|grenade/i.test(i.kind||"")],
    ["sidearm","Sidearm","weapons",i=>/pistol/i.test(i.kind||"")],["melee","Melee","weapons",i=>/knife|melee/i.test(i.kind||"")]]],
  ["Gadgets and keys",[["gadget1","Gadget","gadgets",()=>true],["gadget2","Gadget","gadgets",()=>true],["utility1","Key","utility",()=>true],["utility2","Key","utility",()=>true]]],
  // Clothing slots read the wiki's label and its item type (Char_Clothing_Hat, _Torso_0 = shirt, _Torso_1 = jacket, _Legs, _Feet, _Hands, _Backpack)
  ["Clothing",[["hat","Hat","clothing",i=>/hat|head/i.test(glCk(i))],["torso","Shirt","clothing",i=>/shirt|torso.?0|t-?shirt|top\b/i.test(glCk(i))],["jacket","Jacket","clothing",i=>/jacket|coat|outer|torso.?1/i.test(glCk(i))],
    ["pants","Pants","clothing",i=>/legs|pants|trousers/i.test(glCk(i))],["shoes","Shoes","clothing",i=>/shoe|feet|foot|boot/i.test(glCk(i))],["gloves","Gloves","clothing",i=>/glove|hand/i.test(glCk(i))],
    ["bag","Bag","clothing",i=>/backpack|bag/i.test(glCk(i))]]]];
const GL_SLOT=Object.fromEntries(GL_GROUPS.flatMap(([,L])=>L.map(x=>[x[0],x])));
const GL_SCENARIOS=["Bunker run","Cave mining","EVA salvage","Bounty hunting","Medical rescue","Cargo hauling","Exploration","PvP","Prison break","Racing"];
S.gl=S.gl||{list:null,sel:null,pick:null,q:"",all:false};
// A gear list loaded quietly for the picker (the tab draws it when you open it)
async function glData(kind){ const st=grState(kind); if(st.data) return st.data.items;
  if(!st.glP) st.glP=api().gear_list(kind,false).then(r=>{ if(r?.ok&&!st.data) st.data=r; st.glP=null; return r; }).catch(()=>{ st.glP=null; });
  await st.glP; return st.data?.items||[]; }
const glFind=(kind,x)=>{ if(!x) return null; const L=grState(kind).data?.items||[]; return L.find(i=>x.uuid&&i.uuid===x.uuid)||L.find(i=>i.name===x.name)||null; };
const glCur=()=>(S.gl.list||[]).find(x=>x.id===S.gl.sel)||null;
const glItems=lo=>[...Object.entries(lo.slots||{}).map(([k,v])=>({...v,slot:k})),...(lo.consumables||[]).map(c=>({...c,slot:"cons"}))];
async function glLoad(){ const r=await api().gear_loadouts(); S.gl.list=r?.loadouts||[]; return S.gl.list; }
async function glSave(lo,quiet){ const r=await api().gear_loadout_save(lo); if(!r.ok){ toast(r.error); return null; }
  S.gl.list=r.loadouts; if(!quiet) renderGearLoadouts(); return r.loadout; }
async function openGearLoadouts(){ if(!S.gl.list) await glLoad(); renderGearLoadouts();
  const lo=glCur(); if(lo){ const kinds=[...new Set(glItems(lo).map(i=>i.kind))]; await Promise.all(kinds.map(glData)); if(S.tab==="gearlo") renderGearLoadouts(); } }
function glStats(lo){ const it=glItems(lo).map(x=>({x,g:glFind(x.kind,x)})); let price=0, priced=0, carry=0, mass=0;
  for(const {x,g} of it){ const q=x.qty||1, pr=g?grPrice(g):null; if(pr!=null){ price+=pr*q; priced++; } if(g?.stats?.carry) carry+=g.stats.carry; if(g?.stats?.mass) mass+=g.stats.mass*q; }
  const core=glFind("armor",lo.slots?.core), prim=glFind("weapons",lo.slots?.primary);
  return {n:it.length, price, priced, missing:it.length-priced, carry, mass, dr:core?.stats?.dr, dps:prim?.stats?.dps, weight:core?.weight}; }
function renderGearLoadouts(){ if(S.tab!=="gearlo") return; glSide(); if(S.gl.pick) return glPicker(); glMain(); }
function glSide(){ const L=S.gl.list||[], P=$("pane-gearlo");
  const a=document.activeElement; if(a&&P.contains(a)&&a.id==="gl-new") return;   // typing a new name
  P.innerHTML=`<div class="row" style="gap:6px"><input class="field" id="gl-new" placeholder="New loadout, like “Bunker run”" autocomplete="off" style="flex:1" list="gl-scn-dl">
      <button class="btn primary" data-gl="new">Create</button></div>
    <datalist id="gl-scn-dl">${GL_SCENARIOS.map(x=>`<option value="${esc(x)}">`).join("")}</datalist>
    <div class="muted" style="font-size:12px;margin:8px 2px 12px">What you wear and carry for each kind of job. Pick pieces from the wiki's lists; prices are UEX's.</div>
    ${L.length?L.map(lo=>{ const st=glStats(lo); return `<div class="vh ${lo.id===S.gl.sel?"hl":""}"><div class="hd" data-glsel="${esc(lo.id)}"><div><div class="nm">${lo.main?"★ ":""}${esc(lo.name)}</div>
        <div class="mk">${esc([lo.scenario,plural(st.n,"item")].filter(Boolean).join(" · "))}</div></div><div class="pr">${st.priced?money(st.price):""}</div></div></div>`; }).join("")
      :`<div class="empty">No loadouts yet. Name one above to start.</div>`}`; }
function glMain(){ const P=$("gl-panel"), lo=glCur();
  if(!lo){ const L=S.gl.list||[];
    P.innerHTML=`<div class="gh"><b>Your gear loadouts</b>${L.length?`${plural(L.length,"loadout")} · click one to change it`:"Make one on the left"}</div>
      ${L.length?`<div class="grid">${L.map(glCard).join("")}</div>`:`<div class="empty" style="margin-top:40px"><strong>Gear for every kind of job</strong>Make a loadout for bunkers, caves, salvage or rescues: armor, weapons, gadgets, clothing and the MedPens and food you take.
        It keeps the total price, and the whole set goes in your cart in one click.</div>`}`;
    fillGearPictures(P); return; }
  const st=glStats(lo), buyable=glItems(lo).filter(x=>glFind(x.kind,x)?.buy?.length);
  const slotRow=([k,label,kind])=>{ const x=lo.slots?.[k], g=glFind(kind,x), G=GEAR[kind];
    return `<div class="mk-row gl-row"><div class="w"><small>${esc(label)}</small>${x?`<a data-glview="${esc(kind)}|${esc(x.uuid||x.name)}">${esc(x.name)}</a>`:`<span class="empty-slot">Empty</span>`}
        ${x?`<div class="m">${esc([g?.maker,G?.key?.(g||{}),g?grPrice(g)!=null?money(grPrice(g)):"Not in shops":""].filter(Boolean).join(" · "))}</div>`:""}</div>
      <div class="p"></div><div class="acts"><button class="btn small" data-glpick="${k}">${x?"Change":"Choose"}</button>${x?`<button class="btn small ghost" data-glclear="${k}" aria-label="Take ${esc(x.name)} out">✕</button>`:""}</div></div>`; };
  const cons=lo.consumables||[];
  P.innerHTML=`<button class="btn" data-gl="all" style="margin-bottom:14px">← All loadouts</button>
    <div class="mkp-head" style="grid-template-columns:1fr;margin-bottom:18px"><div class="hd-main">
      <input class="gl-name" id="gl-name" value="${esc(lo.name)}" maxlength="60" aria-label="Loadout name">
      <input class="gl-scn" id="gl-scn" value="${esc(lo.scenario||"")}" maxlength="60" placeholder="What it's for, like “Cave mining”" aria-label="What it's for" list="gl-scn-dl">
      ${statBlock([{label:"Items",value:st.n},{label:"Whole loadout",value:st.priced?money(st.price):"–"},{label:"Core protection",value:st.dr!=null?GR_PCT(st.dr):null}],
        [{label:"Not in shops",value:st.missing?plural(st.missing,"item"):null},{label:"Carrying space",value:st.carry?`${Math.round(st.carry).toLocaleString()} µSCU`:null},
         {label:"Mass",value:st.mass?`${nf(st.mass)} kg`:null},{label:"Primary DPS",value:st.dps!=null?Math.round(st.dps).toLocaleString():null},{label:"Armor weight",value:st.weight||null}])}
      <div class="row" style="gap:8px;margin-top:12px;flex-wrap:wrap">
        <button class="btn primary gl-cart" data-gl="cart" ${buyable.length?"":"disabled"}>${CART_SVG}Add ${buyable.length?plural(buyable.length,"item"):"it"} to cart</button>
        ${lo.main?`<span class="muted" style="font-size:12.5px;align-self:center">★ Your main loadout</span>`:`<button class="btn ghost" data-gl="main">★ Make main</button>`}
        <button class="btn ghost" data-gl="dup">Duplicate</button>
        <button class="btn ghost" data-gl="del" style="color:#ff9b8a">${S.gl.delAsk===lo.id?"Click again to delete":"Delete"}</button></div></div></div>
    <div class="vd-grid vd-flat bp-grid">
      ${GL_GROUPS.map(([g,L])=>`<div class="vd-sec"><div class="mk-h">${esc(g)}<span class="mk-note">${L.filter(x=>lo.slots?.[x[0]]).length} of ${L.length}</span></div>${L.map(slotRow).join("")}</div>`).join("")}
      <div class="vd-sec"><div class="mk-h">Consumables<span class="mk-note">${cons.reduce((t,c)=>t+(c.qty||1),0)} carried</span></div>
        ${cons.map((c,i)=>{ const g=glFind("consumables",c); return `<div class="mk-row gl-row"><div class="w">${esc(c.name)}<div class="m">${esc([g?.kind,g&&grPrice(g)!=null?`${money(grPrice(g))} each`:""].filter(Boolean).join(" · "))}</div></div><div class="p"></div>
          <div class="acts"><span class="gl-qty"><button class="btn small ghost" data-glqty="${i}|-1" aria-label="One fewer">−</button><b>${c.qty||1}</b><button class="btn small ghost" data-glqty="${i}|1" aria-label="One more">+</button></span>
          <button class="btn small ghost" data-glqty="${i}|0" aria-label="Take ${esc(c.name)} out">✕</button></div></div>`; }).join("")}
        <div class="row" style="margin-top:8px"><button class="btn small" data-glpick="cons">Add a consumable</button></div></div>
      <div class="vd-sec"><div class="mk-h">Notes</div><textarea class="field gl-notes" id="gl-notes" maxlength="500" placeholder="Anything to remember: ammo to bring, where to buy, which ship it goes with…">${esc(lo.notes||"")}</textarea></div>
    </div>
    <div class="uex-credit">Items from the Star Citizen Wiki; prices from UEX, reported by players.</div>`; }
function glCard(lo){ const st=glStats(lo), pic=lo.slots?.core||lo.slots?.helmet||lo.slots?.primary||lo.slots?.jacket||Object.values(lo.slots||{})[0];
  return `<div class="vg" data-glopen="${esc(lo.id)}"><div class="ph" ${pic?`data-gpic="${esc(pic.name)}"`:""}>${pic?"":"Empty loadout"}</div>
    <div class="tx"><b>${lo.main?"★ ":""}${esc(lo.name)}</b><span>${esc([lo.scenario,plural(st.n,"item")].filter(Boolean).join(" · "))}${st.priced?` · ${money(st.price)}`:""}</span></div></div>`; }
async function glPicker(){ const P=$("gl-panel"), lo=glCur(), k=S.gl.pick; if(!lo){ S.gl.pick=null; return glMain(); }
  const def=k==="cons"?["cons","Consumable","consumables",()=>true]:GL_SLOT[k], [,label,kind,fits]=def, G=GEAR[kind];
  const draw=()=>{ const L=grState(kind).data?.items;
    if(!L){ P.innerHTML=`<button class="btn" data-glback="1" style="margin-bottom:14px">← ${esc(lo.name)}</button>${qLoader(`Loading ${G.title.toLowerCase()} from the Star Citizen Wiki…`)}`; return; }
    const q=S.gl.q.trim().toLowerCase(), words=q.split(/\s+/).filter(Boolean);
    const fit=L.filter(fits), base=S.gl.all||!fit.length?L:fit;
    const shown=base.filter(i=>!words.length||words.every(w=>`${i.name} ${i.maker} ${i.kind||""} ${i.slot||""}`.toLowerCase().includes(w))).sort((a,b)=>a.name.localeCompare(b.name)).slice(0,200);
    const box=$("gl-pick-grid");
    const grid=shown.length?`<div class="grid">${shown.map(i=>`<div class="vg" data-glchoose="${esc(i.uuid||i.name)}"><div class="ph ph-g" data-gpic="${esc(i.name)}">${i.image?`<img src="${esc(i.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">`:phCard(grArt(kind,i))}</div>
        <div class="tx"><b>${esc(i.name)}</b><span>${esc([i.maker,i.slot||i.kind].filter(Boolean).join(" · "))}${grPrice(i)!=null?` · ${money(grPrice(i))}`:" · not in shops"}</span>${G.key(i)?`<span class="kt">${esc(G.key(i))}</span>`:""}</div></div>`).join("")}</div>`
      :`<div class="empty">Nothing matches.</div>`;
    if(box){ box.innerHTML=grid; $("gl-pick-n").textContent=`${shown.length}${base.length>shown.length?` of ${base.length}`:""} shown`; fillGearPictures(box); return; }
    P.innerHTML=`<button class="btn" data-glback="1" style="margin-bottom:14px">← ${esc(lo.name)}</button>
      <div class="gh"><b>Choose ${k==="cons"?"a consumable":`a ${esc(label.toLowerCase())}`}</b><span id="gl-pick-n">${shown.length} shown</span></div>
      <div class="row gl-pick" style="gap:8px;margin:0 2px 14px;flex-wrap:wrap"><input class="field" id="gl-q" placeholder="${esc(G.ph)}" value="${esc(S.gl.q)}" autocomplete="off" style="flex:1;min-width:220px">
        ${fit.length&&fit.length<L.length?`<label class="row" style="gap:6px;font-size:13px;cursor:pointer"><input type="checkbox" id="gl-all" ${S.gl.all?"checked":""}> Show every ${esc(G.noun)}, not just ${esc(label.toLowerCase())}s</label>`:""}</div>
      <div id="gl-pick-grid" class="gl-pick">${grid}</div>`;
    fillGearPictures(P); $("gl-q")?.focus(); };
  draw(); if(!grState(kind).data){ await glData(kind); if(S.gl.pick===k&&S.tab==="gearlo") draw(); } }
$("gl-panel").addEventListener("input",e=>{ if(e.target.id==="gl-q"){ S.gl.q=e.target.value; glPicker(); } });
$("gl-panel").addEventListener("change",async e=>{ const lo=glCur(); if(!lo) return;
  if(e.target.id==="gl-all"){ S.gl.all=e.target.checked; $("gl-pick-grid").innerHTML=""; $("gl-pick-grid").removeAttribute("id"); return glPicker(); }
  if(e.target.id==="gl-name"){ const v=e.target.value.trim(); if(!v){ e.target.value=lo.name; return toast("A loadout needs a name"); } lo.name=v; await glSave(lo,true); glSide(); }
  if(e.target.id==="gl-scn"){ lo.scenario=e.target.value.trim(); await glSave(lo,true); glSide(); }
  if(e.target.id==="gl-notes"){ lo.notes=e.target.value; await glSave(lo,true); toast("Notes saved"); } });
$("gl-panel").addEventListener("click",async e=>{ if(await tradeClick(e)) return; const lo=glCur();
  const op=e.target.closest("[data-glopen]"); if(op){ S.gl.sel=op.dataset.glopen; S.gl.pick=null; return openGearLoadouts(); }
  if(e.target.closest("[data-gl=all]")){ S.gl.sel=null; return renderGearLoadouts(); }
  if(e.target.closest("[data-glback]")){ S.gl.pick=null; S.gl.q=""; return renderGearLoadouts(); }
  if(!lo) return;
  const pk=e.target.closest("[data-glpick]"); if(pk){ S.gl.pick=pk.dataset.glpick; S.gl.q=""; S.gl.all=false; $("gl-panel").scrollTop=0; return glPicker(); }
  const ch=e.target.closest("[data-glchoose]"); if(ch){ const k=S.gl.pick, kind=k==="cons"?"consumables":GL_SLOT[k][2];
    const i=(grState(kind).data?.items||[]).find(x=>(x.uuid||x.name)===ch.dataset.glchoose); if(!i) return;
    const it={name:i.name,uuid:i.uuid,class_name:i.class_name,kind};
    if(k==="cons"){ lo.consumables=lo.consumables||[]; const have=lo.consumables.find(c=>(c.uuid&&c.uuid===i.uuid)||c.name===i.name); if(have) have.qty=(have.qty||1)+1; else lo.consumables.push({...it,qty:1}); }
    else { lo.slots=lo.slots||{}; lo.slots[k]=it; }
    S.gl.pick=null; S.gl.q=""; await glSave(lo); toast(`${i.name} added to ${lo.name}`); return; }
  const cl=e.target.closest("[data-glclear]"); if(cl){ delete lo.slots[cl.dataset.glclear]; return glSave(lo); }
  const qt=e.target.closest("[data-glqty]"); if(qt){ const [i,d]=qt.dataset.glqty.split("|").map(Number), c=lo.consumables[i]; if(!c) return;
    if(d===0) lo.consumables.splice(i,1); else c.qty=Math.max(1,Math.min(99,(c.qty||1)+d)); return glSave(lo); }
  const vw=e.target.closest("[data-glview]"); if(vw){ const [kind,id]=vw.dataset.glview.split("|"); const t=document.querySelector(`.tab[data-tab="${kind}"]`); if(!t) return;
    t.click(); setTimeout(()=>{ const st=grState(kind); if(kind==="armor"){ st.view="items"; } if(st.data) grOpenItem(kind,id,null); },250); return; }
  const b=e.target.closest("[data-gl]")?.dataset.gl;
  if(b==="main"){ lo.main=true; return glSave(lo); }
  if(b==="dup"){ const c=await glSave({...JSON.parse(JSON.stringify(lo)),id:null,main:false,name:`${lo.name} (copy)`.slice(0,60)}); if(c){ S.gl.sel=c.id; renderGearLoadouts(); toast("Copied"); } return; }
  if(b==="del"){ if(S.gl.delAsk!==lo.id){ S.gl.delAsk=lo.id; glMain(); setTimeout(()=>{ if(S.gl.delAsk===lo.id){ S.gl.delAsk=null; if(S.tab==="gearlo"&&!S.gl.pick) glMain(); } },4000); return; }
    const r=await api().gear_loadout_delete(lo.id); S.gl.list=r.loadouts; S.gl.sel=null; S.gl.delAsk=null; toast(`${lo.name} deleted`); return renderGearLoadouts(); }
  if(b==="cart"){ const items=glItems(lo).map(x=>({x,g:glFind(x.kind,x)})).filter(({g})=>g?.buy?.length)
      .map(({x,g})=>({name:g.name,kind:GR_CART[x.kind],uuid:g.uuid,class_name:g.class_name,qty:x.qty||1,source:lo.name}));
    if(items.length) return addToCart(items,`${lo.name} (${plural(items.length,"item")})`); } });
$("pane-gearlo").addEventListener("click",async e=>{
  const sl=e.target.closest("[data-glsel]"); if(sl){ S.gl.sel=sl.dataset.glsel; S.gl.pick=null; $("gl-panel").scrollTop=0; return openGearLoadouts(); }
  if(e.target.closest("[data-gl=new]")){ const v=($("gl-new")?.value||"").trim(); if(!v) return toast("Name the loadout first, like “Bunker run”");
    const c=await glSave({name:v,scenario:GL_SCENARIOS.includes(v)?v:"",slots:{},consumables:[]},true); if(c){ $("gl-new").value=""; $("gl-new").blur(); S.gl.sel=c.id; S.gl.pick=null; renderGearLoadouts(); } } });
$("pane-gearlo").addEventListener("keydown",e=>{ if(e.target.id==="gl-new"&&e.key==="Enter"){ e.preventDefault(); document.querySelector('[data-gl=new]')?.click(); } });
