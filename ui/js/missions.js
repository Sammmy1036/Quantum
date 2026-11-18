// Quantum UI: Missions (Home > Missions): who hands out contracts, the factions behind them and what each offers.
// One of several classic scripts sharing one global scope; index.html loads them in order.
// Every top-level name here starts with "mi" so it can't clash with the other scripts.
"use strict";
// The list of employers comes from Quantum's own game data (contracts_data.json), or the Star Citizen Wiki's
// mission list until that's on this PC. A faction's overview (headquarters, leadership, reputation ranks) is
// looked up on the wiki when you open it. A contract opens in place: its briefing, then where it's offered.
S.mi=S.mi||{data:null,loading:null,q:"",law:"",type:"",sel:null,open:null,fac:{},page:{}};
const miN=x=>Number(x).toLocaleString();
const miPay=(a,b,cur)=>a==null&&b==null?"":`${a!=null&&b!=null&&a!==b?`${miN(a)}–${miN(b)}`:miN(b??a)} ${cur&&cur!=="UEC"?cur:"aUEC"}`;
const miKey=e=>e.name.toLowerCase();

function miLoad(){ if(S.mi.loading) return S.mi.loading;
  return S.mi.loading=api().missions_index().then(r=>{ S.mi.data=r; return r; })
    .catch(()=>{ S.mi.data={ok:false,error:"Couldn't load the missions"}; }).finally(()=>{ S.mi.loading=null; }); }

async function openMissions(){
  if(!S.mi.data){ $("mi-list").innerHTML=`<div class="muted" style="padding:10px 4px">Loading employers…</div>`;
    $("mi-panel").innerHTML=qLoader("Gathering every employer and their contracts…"); await miLoad(); if(S.tab!=="missions") return; }
  miFilters(); miRenderList(); miRender(); }

function miShown(){ const d=S.mi.data; if(!d?.ok) return [];
  const q=S.mi.q.trim().toLowerCase();
  return d.employers.filter(e=>(!S.mi.law||(S.mi.law==="lawful"?e.lawful:e.unlawful))
    &&(!S.mi.type||e.types.includes(S.mi.type))
    &&(!q||`${e.name} ${e.faction||""} ${e.types.join(" ")}`.toLowerCase().includes(q)||e.missions.some(m=>m.title.toLowerCase().includes(q)))); }

function miFilters(){ const d=S.mi.data, sel=$("mi-type"); if(!d?.ok||!sel||sel.dataset.done) return; sel.dataset.done=1;
  const types=[...new Set(d.employers.flatMap(e=>e.types))].sort();
  sel.innerHTML=`<option value="">All kinds of work</option>${types.map(t=>`<option>${esc(t)}</option>`).join("")}`; }

function miRenderList(){ const L=$("mi-list"), d=S.mi.data; if(!L) return;
  if(!d?.ok){ L.innerHTML=`<div class="empty"><strong>Couldn't load the missions</strong>${esc(d?.error||"")}<br><br><button class="btn small" id="mi-retry">Try again</button></div>`;
    $("mi-retry").onclick=()=>{ S.mi.data=null; openMissions(); }; return; }
  const rows=miShown();
  $("c-missions").textContent=d.employers.length;
  L.innerHTML=rows.length?rows.map(e=>`<button class="mi-emp${S.mi.sel===miKey(e)?" on":""}" data-mi="${esc(miKey(e))}">
      <span class="ic ${e.unlawful&&!e.lawful?"bad":e.unlawful?"mix":""}">${esc((e.name.match(/[A-Z0-9]/g)||[e.name[0]]).slice(0,2).join(""))}</span>
      <span class="t"><b>${esc(e.name)}</b><small>${esc([e.faction&&e.faction.toLowerCase()!==e.name.toLowerCase()?e.faction:"",`${e.count} contract${e.count>1?"s":""}`].filter(Boolean).join(" · "))}</small></span>
      <span class="law ${e.unlawful&&!e.lawful?"bad":e.unlawful?"mix":"ok"}" title="${e.lawful} lawful, ${e.unlawful} unlawful">${e.unlawful&&!e.lawful?"Unlawful":e.unlawful?"Mixed":"Lawful"}</span></button>`).join("")
    :`<div class="empty"><strong>No employers match</strong>Try another search or filter.</div>`;
  L.onclick=e=>{ const b=e.target.closest("[data-mi]"); if(!b) return; S.mi.sel=b.dataset.mi; S.mi.open=null; $("mi-panel").scrollTop=0; miRenderList(); miRender(); }; }

function miRender(){ const P=$("mi-panel"), d=S.mi.data; if(!P||!d) return;
  if(!d.ok){ P.innerHTML=`<div class="empty" style="margin-top:60px"><strong>Missions</strong>${esc(d.error||"")}</div>`; return; }
  const e=d.employers.find(x=>miKey(x)===S.mi.sel);
  if(!e) return miOverview(P,d);
  const fname=e.faction||e.name, fac=S.mi.fac[fname];
  if(fac===undefined){ S.mi.fac[fname]=null; api().faction_info(fname).then(r=>{ S.mi.fac[fname]=r.ok?(r.found?r.faction:false):{error:r.error};
    if(S.tab==="missions"&&S.mi.sel===miKey(e)) miRender(); }).catch(()=>{ S.mi.fac[fname]={error:"Couldn't look it up"}; }); }
  const byType={}; for(const m of e.missions) (byType[m.type||"Other"]=byType[m.type||"Other"]||[]).push(m);
  const about=fac===null||fac===undefined?`<div class="muted" style="font-size:13px;padding:8px 0">Looking up ${esc(fname)} on the Star Citizen Wiki…</div>`
    :fac===false?`<div class="muted" style="font-size:13px;padding:8px 0">The Star Citizen Wiki has no page on ${esc(fname)} yet.</div>`
    :fac.error?`<div class="muted" style="font-size:13px;padding:8px 0">${esc(fac.error)} <a class="mi-link" data-mifretry="${esc(fname)}">Try again</a></div>`
    :`${fac.overview?.length?`<div class="mi-kv">${fac.overview.map(([k,v])=>`<span>${esc(k)}</span><b>${esc(v)}</b>`).join("")}</div>`:""}
      ${fac.description?`<p class="gr-desc mi-text" style="margin:10px 0 4px">${esc(fac.description)}</p>`:""}`;
  const ranks=fac&&!fac.error&&fac.ranks?.length?`<div class="vd-sec"><div class="mk-h">Reputation ranks</div><div class="mi-ranks">${fac.ranks.map(([n,x],i)=>`<div><span class="n">${i+1}</span><b>${esc(n)}</b><small>${x==null?"":x<0?"Hostile":miN(x)+" rep"}</small></div>`).join("")}</div></div>`:"";
  P.innerHTML=`<div class="mi-head"><div class="ic big ${e.unlawful&&!e.lawful?"bad":e.unlawful?"mix":""}">${esc((e.name.match(/[A-Z0-9]/g)||[e.name[0]]).slice(0,2).join(""))}</div>
      <div style="min-width:0"><h2>${esc(e.name)}</h2><div class="sub">${esc([e.faction&&e.faction.toLowerCase()!==e.name.toLowerCase()?e.faction:"Employer",...e.types.slice(0,4)].join(" · "))}</div></div>
      ${fac?.url?`<button class="btn ghost small" data-ext="${esc(fac.url)}" style="margin-left:auto">Wiki</button>`:""}</div>
    ${statBlock([{label:"Contracts",value:String(e.count)},{label:"Pays",value:e.reward[1]!=null?miPay(e.reward[0],e.reward[1]):null}],
      [{label:"Lawful",value:String(e.lawful)},{label:"Unlawful",value:String(e.unlawful)},{label:"Kinds of work",value:String(e.types.length||1)}])}
    <div class="vd-grid vd-flat bp-grid" style="margin-top:14px">
      <div class="vd-sec" style="grid-column:1/-1"><div class="mk-h">About ${esc(fname)}</div>${about}</div>${ranks}</div>
    ${Object.entries(byType).map(([t,L])=>`<div class="mk-h" style="margin-top:18px">${esc(t)} <span class="muted" style="letter-spacing:0">${L.length}</span></div>${L.map(m=>miRow(e,m)).join("")}`).join("")}
    <div class="uex-credit">${d.source==="game"?"Contracts from the game files (Quantum's game data); faction details from the Star Citizen Wiki.":"From the Star Citizen Wiki's mission data."}</div>`; }

function miRow(e,m){ const id=`${miKey(e)}|${m.code||m.ref||m.title}`, open=S.mi.open===id;
  const meta=[m.rank!=null&&m.rank!==""?(typeof m.rank==="number"?`Rank ${m.rank}`:m.rank):"",m.rep?`+${miN(m.rep)} rep`:"",m.lawful===false?"Unlawful":"",m.max_players>1?`Up to ${m.max_players} players`:""].filter(Boolean);
  return `<div class="mi-row${open?" open":""}" data-mirow="${esc(id)}"><button class="h" data-mitoggle="${esc(id)}"><span class="w"><b>${esc(m.title)}</b>${meta.length?`<small>${esc(meta.join(" · "))}</small>`:""}</span>
      <span class="p">${esc(miPay(m.reward,m.reward_max,m.currency))}</span><span class="chev">${open?"▾":"▸"}</span></button>
    ${open?`<div class="b">${m.desc?`<p class="mi-text">${esc(m.desc)}</p>`:""}${m.cargo?.length?`<div class="muted" style="font-size:12.5px;margin:4px 0">Cargo: ${esc(m.cargo.join(", "))}</div>`:""}
      <div>${miPageHtml(id,!!m.desc)}</div></div>`:""}</div>`; }

// The wiki's page for a contract, opened under its row: where it's offered (one click to the route), the briefing
function miPageHtml(id,hasDesc){ const p=S.mi.page[id];
  if(p===undefined) return `<button class="btn small" data-mipage="${esc(id)}">Where it's offered and more</button>`;
  if(p===null) return `<div class="muted" style="font-size:12.5px">Looking it up on the Star Citizen Wiki…</div>`;
  if(p.error) return `<div class="muted" style="font-size:12.5px">${esc(p.error)} <a class="mi-link" data-mipage="${esc(id)}">Try again</a></div>`;
  if(p.missing) return `<div class="muted" style="font-size:12.5px">The Star Citizen Wiki doesn't have this one yet.</div>`;
  const rows=p.offered_at_rows||[], there=[...(p.pickups_rows||[]),...(p.destinations_rows||[])];
  const place=x=>`<div class="mk-row"><div class="w">${x.place?`<a data-open="${esc(x.place)}">${esc(x.name)}</a>`:esc(x.name)}</div><div class="p"></div>
      ${x.place?`<button class="iconbtn${S.live?.route?.includes(x.place)?" added":""}" data-miadd="${esc(x.place)}" title="Add ${esc(x.place)} to your route">${S.live?.route?.includes(x.place)?"✓":"+"}</button>`:"<span></span>"}
      <div class="m">${x.body?esc(x.body):x.place?"":"Not on Quantum's map yet"}</div></div>`;
  return `${!rows.length&&!there.length&&!p.description?`<div class="muted" style="font-size:12.5px">The wiki doesn't say where it's offered.</div>`:""}
    ${p.description&&!hasDesc?`<p class="mi-text" style="opacity:.85">${esc(p.description)}</p>`:""}
    <div class="vd-grid bp-grid" style="margin-top:6px">${rows.length?`<div><div class="mk-h">Where it's offered</div>${rows.map(place).join("")}${p.offered_at?.more?`<div class="muted" style="font-size:12px">+${p.offered_at.more} more</div>`:""}</div>`:""}
      ${there.length?`<div><div class="mk-h">Where it sends you</div>${there.map(place).join("")}</div>`:""}</div>
    ${p.url?`<button class="btn ghost small" data-ext="${esc(p.url)}" style="margin-top:6px">Open on the wiki</button>`:""}`; }

// No employer picked: the biggest ones, and how the work splits up
function miOverview(P,d){ const E=d.employers, law=E.reduce((a,e)=>a+e.lawful,0), un=E.reduce((a,e)=>a+e.unlawful,0);
  const types={}; for(const e of E) for(const m of e.missions) types[m.type||"Other"]=(types[m.type||"Other"]||0)+1;
  const top=Object.entries(types).sort((a,b)=>b[1]-a[1]).slice(0,10), max=top[0]?.[1]||1;
  P.innerHTML=`<div class="mi-head"><div style="min-width:0"><h2>Missions</h2><div class="sub">Every employer handing out contracts, the faction behind them and what they pay. Pick one on the left.</div></div></div>
    ${statBlock([{label:"Employers",value:String(E.length)},{label:"Contracts",value:miN(law+un)}],[{label:"Lawful",value:miN(law)},{label:"Unlawful",value:miN(un)}])}
    <div class="vd-grid vd-flat bp-grid" style="margin-top:14px">
      <div class="vd-sec"><div class="mk-h">Kinds of work</div>${top.map(([t,n])=>`<div class="mi-bar"><span>${esc(t)}</span><i><b style="width:${Math.round(n/max*100)}%"></b></i><small>${n}</small></div>`).join("")}</div>
      <div class="vd-sec"><div class="mk-h">Most contracts</div>${E.slice(0,8).map(e=>`<div class="mk-row"><div class="w"><a data-mi="${esc(miKey(e))}">${esc(e.name)}</a></div><div class="p">${e.count}</div><span></span>
        <div class="m">${esc(e.faction&&e.faction.toLowerCase()!==e.name.toLowerCase()?e.faction:e.types.slice(0,3).join(", "))}</div></div>`).join("")}</div></div>
    <div class="uex-credit">${d.source==="game"?"From the game files (Quantum's game data).":"From the Star Citizen Wiki's mission data."}</div>`; }

$("mi-q").oninput=e=>{ S.mi.q=e.target.value; miRenderList(); };
$("mi-law").onchange=e=>{ S.mi.law=e.target.value; miRenderList(); };
$("mi-type").onchange=e=>{ S.mi.type=e.target.value; miRenderList(); };
$("mi-panel").addEventListener("click",async ev=>{ const t=ev.target;
  const pick=t.closest("[data-mi]"); if(pick){ S.mi.sel=pick.dataset.mi; S.mi.open=null; $("mi-panel").scrollTop=0; miRenderList(); return miRender(); }
  const ext=t.closest("[data-ext]"); if(ext){ api().open_url?.(ext.dataset.ext); return; }
  const tg=t.closest("[data-mitoggle]"); if(tg){ S.mi.open=S.mi.open===tg.dataset.mitoggle?null:tg.dataset.mitoggle; return miRender(); }
  const fr=t.closest("[data-mifretry]"); if(fr){ delete S.mi.fac[fr.dataset.mifretry]; return miRender(); }
  const op=t.closest("[data-open]"); if(op){ const n=op.dataset.open; if(S.locMap?.[n]){ select({kind:"loc",name:n}); focusLoc(n,true); } return; }
  const ad=t.closest("[data-miadd]"); if(ad){ await addStops([ad.dataset.miadd]); return miRender(); }
  const pg=t.closest("[data-mipage]"); if(pg){ const id=pg.dataset.mipage, [ek]=id.split("|"), e=S.mi.data.employers.find(x=>miKey(x)===ek);
    const m=e?.missions.find(x=>`${ek}|${x.code||x.ref||x.title}`===id); if(!m) return;
    S.mi.page[id]=null; miRender();
    let r; try{ r=await api().mission_page(m.ref||null,m.code||null,m.title); }catch(_){ r={ok:false,error:"Couldn't look it up"}; }
    S.mi.page[id]=r.ok?(r.found?r.info:{missing:true}):{error:r.error}; if(S.tab==="missions") miRender(); } });
