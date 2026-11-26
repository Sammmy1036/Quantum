"use strict";
// =================================================================== every icon in the app, in one list
// For a waypoint's own icon (picked when you save it, or changed later from its menu) and for the navigation
// guide over the game (the place you're flying to drawn on its tape or ring). The list is gathered from the app's
// own icon sets as they are, nothing copied: the game's map symbols (gameicons.js), the ship icons
// (shipicons.js), the place-card service icons, mission kinds, gear sources, fuel, and the side rail's section
// icons. Quantum's own logo is left out. An icon's id is "<set>:<key>" (e.g. "game:cave", "ship:orig_300i").
const ICON_SETS=[
  ["game","Map symbols"],["ship","Ships"],["svc","Services"],["solid","Game glyphs"],["mission","Mission kinds"],
  ["where","Gear sources"],["fuel","Fuel"],["rail","App sections"]];
let _iconLib=null;
function iconLib(){ if(_iconLib) return _iconLib; const out=[];
  const add=(set,key,label,vb,inner,mode)=>out.push({id:set+":"+key,set,label,vb,inner,mode});
  const nice=k=>String(k).replace(/[_-]+/g," ").replace(/\b\w/g,c=>c.toUpperCase());
  try{ for(const [k,g] of Object.entries(GAME_ICONS)) add("game",k,nice(k),g[0],g[1],"fill");
       for(const [k,g] of Object.entries(GAME_COLOR)) add("game",k,nice(k),g[0],g[1],"own"); }catch(_){}
  try{ for(const [k,g] of Object.entries(SHIP_ICONS)) add("ship",k,nice(k.replace(/^[a-z]+_/,"")),g[0],g[1],"fill"); }catch(_){}
  try{ for(const [k,v] of Object.entries(SVC_ICONS)) add("svc",k,nice(k),"0 0 24 24",v,"stroke"); }catch(_){}
  try{ for(const [k,g] of Object.entries(SVC_SOLID)) add("solid",k,nice(k),g[0],`<path d="${g[1]}"/>`,"fill"); }catch(_){}
  try{ for(const [k,u] of Object.entries(MI_KIND_ICON)) add("mission",k,nice(k),null,u,"url"); }catch(_){}
  try{ for(const [k,v] of Object.entries(GR_WHERE_IC)) add("where",k.replace(/\s+/g,"_"),k,"0 0 24 24",v,"stroke"); }catch(_){}
  try{ for(const [k,v] of Object.entries(FUEL_ICON)) add("fuel",k,k==="q"?"Quantum fuel":k==="h"?"Hydrogen fuel":nice(k),null,v,"svg"); }catch(_){}
  // the side rail's section icons, as the page has them (not the logo: it's in the title bar and brand, not the rail)
  for(const b of document.querySelectorAll(".rail-btn[data-group], #rail-settings")){ const sv=b.querySelector("svg"); if(!sv) continue;
    const key=b.dataset.group||"settings", lab=(b.textContent||key).trim()||nice(key);
    add("rail",key,lab,sv.getAttribute("viewBox")||"0 0 24 24",sv.innerHTML,sv.classList.contains("ofc")?"fill":"stroke"); }
  return (_iconLib=out); }
const iconById=id=>iconLib().find(i=>i.id===id)||null;
// a picture of icon `id` in one colour (or its own colours), as a data URL
function iconUrl(id,color="#fff"){ const i=iconById(id); if(!i) return null;
  if(i.mode==="url"){ const m=/^data:image\/svg\+xml;base64,(.*)$/.exec(i.inner); if(!m) return i.inner;   // a picture already: its colour set
    try{ return "data:image/svg+xml,"+encodeURIComponent(atob(m[1]).replace(/currentColor/g,color).replace(/fill="(?!none)[^"]*"/g,`fill="${color}"`).replace(/fill:\s*#[0-9a-f]{3,8}/gi,"fill:"+color).replace(/<svg\b[^>]*>/,t=>/\sfill=/.test(t)?t:t.replace(/<svg\b/,`<svg fill="${color}"`))); }catch(_){ return i.inner; } }
  let svg;
  if(i.mode==="svg") svg=i.inner.replace(/<svg\b/,'<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"').replace(/currentColor/g,color);
  else { const paint=i.mode==="own"?"":i.mode==="stroke"?` fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"`:` fill="${color}"`;
    svg=`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="${i.vb}"${paint}>${i.inner.replace(/currentColor/g,color)}</svg>`; }
  return "data:image/svg+xml,"+encodeURIComponent(svg); }
// for the page: a small <img> of it (pages show icons in one colour; CSS can't recolour an <img>)
function iconImg(id,color="#9dff7a",cls="ic-img"){ const u=iconUrl(id,color); return u?`<img class="${cls}" src="${u}" alt="" aria-hidden="true">`:""; }
// icon `id` drawn white on a canvas, px across (the map tints it; the guide over the game gets it as a PNG)
function iconCanvas(id,px,color="#fff"){ return new Promise(res=>{ const u=iconUrl(id,color); if(!u) return res(null);
  const im=new Image(); im.onload=()=>{ const cv=document.createElement("canvas"); cv.width=cv.height=px; const c=cv.getContext("2d");
    c.drawImage(im,0,0,px,px); const i=iconById(id); if(i&&i.mode!=="own"){ c.globalCompositeOperation="source-in"; c.fillStyle=color; c.fillRect(0,0,px,px); }
    res(cv); }; im.onerror=()=>res(null); im.src=u; }); }

// ---- the icon picker: a grid of every icon, by set, with a search; resolves with the id picked, "" for the
// standard pin, or null if closed
function pickIcon(current){ return new Promise(res=>{ document.querySelector(".icp-wrap")?.remove();
  const w=document.createElement("div"); w.className="icp-wrap"; w.setAttribute("role","dialog"); w.setAttribute("aria-label","Choose an icon");
  const lib=iconLib();
  const grid=q=>ICON_SETS.map(([set,title])=>{ const items=lib.filter(i=>i.set===set&&(!q||i.label.toLowerCase().includes(q)||i.id.includes(q)));
      return items.length?`<div class="icp-set">${esc(title)} <span>${items.length}</span></div><div class="icp-grid">${items.map(i=>
        `<button type="button" class="icp-i${i.id===current?" on":""}" data-id="${esc(i.id)}" title="${esc(i.label)}" aria-label="${esc(i.label)}">${iconImg(i.id,"#cfe0f5","")}</button>`).join("")}</div>`:""; }).join("")
    ||`<div class="muted" style="padding:20px;text-align:center">No icons match</div>`;
  w.innerHTML=`<div class="icp"><div class="icp-top"><b>Choose an icon</b><input class="field" placeholder="Search icons, like “cave”, “ship”, “fuel”" aria-label="Search icons">
      <button type="button" class="btn small ghost" data-std>Standard pin</button><button type="button" class="close" aria-label="Close">×</button></div>
    <div class="icp-body">${grid("")}</div></div>`;
  document.body.appendChild(w);
  const done=v=>{ w.remove(); res(v); };
  const inp=w.querySelector("input"); inp.focus();
  inp.oninput=()=>{ w.querySelector(".icp-body").innerHTML=grid(inp.value.trim().toLowerCase()); };
  w.onclick=e=>{ if(e.target===w||e.target.closest(".close")) return done(null);
    if(e.target.closest("[data-std]")) return done("");
    const b=e.target.closest(".icp-i"); if(b) done(b.dataset.id); };
  w.onkeydown=e=>{ if(e.key==="Escape") done(null); }; }); }

// ---- the navigation guide's icon: the place it points to, drawn here and handed to the app (nav_overlay_icon)
function navIconFor(L){ if(!L) return null;
  if(L.source==="user") return L.icon||"game:nav_destination";
  if(L.source==="mission") return "game:objective";
  const k=locIcon(L); return k?"game:"+k:"game:generic_marker"; }
async function navIconSync(live){ const nv=live?.nav_overlay; if(!nv?.on||!nv.target) return;
  const L=S.locMap?.[nv.target], id=navIconFor(L), key=nv.target+"|"+id;
  if(nv.has_icon&&S.navIconKey===key) return; if(S.navIconBusy===key) return; S.navIconBusy=key;
  try{ const cv=await iconCanvas(id,96); if(cv){ await api().nav_overlay_icon(nv.target,cv.toDataURL("image/png")); S.navIconKey=key; } }
  catch(_){} finally{ S.navIconBusy=null; } }
