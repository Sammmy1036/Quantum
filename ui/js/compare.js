// Quantum UI: Compare, under a vehicle's or a piece of gear's own page (design B: "what's different").
// One of several classic scripts sharing one global scope; index.html loads them in order.
//
// Pick another ship (or weapon, armor piece…) and Quantum lists only what differs: what each one is better at,
// biggest difference first, what's just different (maker, pad size…), and how much is the same. Swap sides
// with one click; the other one opens with one more. The choice is kept per page while Quantum is open.
"use strict";
S.cmp=S.cmp||{};            // page key ("veh:123", "gear:weapons:<uuid>") -> {other: id, q: search text}

// One row: label, both values as numbers (or text), which way is better (+1 more, -1 less, 0 neither) and how
// to write a value and a difference. A row both sides lack is left out.
function cmpRow(k,a,b,dir,fmt,unit,phrase){ return {k,a,b,dir,fmt:fmt||(n=>Math.round(n).toLocaleString()),unit:unit||"",phrase:phrase||k.toLowerCase()}; }
const cmpNum=v=>v==null||v===""||isNaN(+v)?null:+v;

// Sorts rows into A better / B better / just different / same, biggest relative difference first.
function cmpSplit(rows){ const a=[],b=[],diff=[],same=[];
  for(const r of rows){ const x=cmpNum(r.a), y=cmpNum(r.b);
    if(x==null&&y==null){ if(r.a==null&&r.b==null) continue;
      if(String(r.a??"–")===String(r.b??"–")) same.push(r); else diff.push(r); continue; }
    // Only one has a number: a plus for that one where having it is the point (sold in game), else just different
    if(x==null||y==null){ (r.onlyTxt?(x!=null?a:b):diff).push({...r,only:x!=null?"a":"b",rel:2}); continue; }
    if(Math.abs(x-y)<1e-9){ same.push(r); continue; }
    const rel=Math.abs(x-y)/Math.max(Math.abs(x),Math.abs(y),1e-9);
    if(!r.dir){ diff.push({...r,rel}); continue; }
    ((x>y)===(r.dir>0)?a:b).push({...r,rel}); }
  const by=(p,q)=>(q.rel??1)-(p.rel??1);
  return {a:a.sort(by),b:b.sort(by),diff,same}; }

// "+18 SCU" / "−4,200 aUEC" / "+35%": how much better, from that side
function cmpDelta(r,side){ const x=cmpNum(r.a), y=cmpNum(r.b);
  if(r.only) return r.only===side?(r.onlyTxt||"Has it"):"";
  const d=side==="a"?x-y:y-x, base=side==="a"?y:x;
  if(r.pct&&base) return `${d>0?"+":"−"}${Math.round(Math.abs(d)/Math.abs(base)*100)}%`;
  return `${d>0?"+":"−"}${r.fmt(Math.abs(d))}${r.unit?` ${r.unit}`:""}`; }

// The one-line verdict: "The Galaxy carries more and has tougher shields; the Cutlass Black is quicker and cheaper."
function cmpVerdict(nameA,nameB,s){ const top=L=>L.slice(0,3).map(r=>r.only?r.onlyTxt.toLowerCase():r.phrase);
  const list=L=>L.length<2?L[0]||"":`${L.slice(0,-1).join(", ")} and ${L.at(-1)}`;
  const A=top(s.a), B=top(s.b);
  if(!A.length&&!B.length) return `${esc(nameA)} and ${esc(nameB)} are the same on every number Quantum has${s.diff.length?"; they differ only in the details below":""}.`;
  if(!B.length) return `<b>${esc(nameA)}</b> is ahead on everything that differs: ${esc(list(A))}.`;
  if(!A.length) return `<b>${esc(nameB)}</b> is ahead on everything that differs: ${esc(list(B))}.`;
  return `<b>${esc(nameA)}</b>: ${esc(list(A))}. <b>${esc(nameB)}</b>: ${esc(list(B))}.`; }

// The section itself. ctx: {key, a: {name, sub, pic}, b, rows, picker: html, swap: bool, open: fn-name}
function cmpHtml(ctx){ const s=cmpSplit(ctx.rows), A=ctx.a, B=ctx.b;
  const card=(x,side)=>`<div class="cmp-who ${side}"><div class="ph">${x.pic||""}</div><div class="nm"><b>${esc(x.name)}</b><small>${esc(x.sub||"")}</small></div>
    ${side==="b"?`<div class="acts"><button class="btn small ghost" data-cmpopen="1" title="Open its own page">Open</button><button class="btn small ghost" data-cmpclear="1">Change</button></div>`:""}</div>`;
  const line=(r,side)=>`<div class="cmp-d"><b class="${side}">${esc(cmpDelta(r,side))}</b><span>${esc(r.k)}<small>${esc(r.only?(r.only===side?"only this one":"—"):`${r.fmt(cmpNum(side==="a"?r.a:r.b))}${r.unit?` ${r.unit}`:""} vs ${r.fmt(cmpNum(side==="a"?r.b:r.a))}${r.unit?` ${r.unit}`:""}`)}</small></span></div>`;
  const col=(t,L,side,cls)=>`<div class="cmp-col"><div class="cmp-h ${cls}">${t}</div>${L.length?L.map(r=>line(r,side)).join(""):`<div class="muted cmp-none">Nothing</div>`}</div>`;
  const txt=v=>v==null||v===""?"–":typeof v==="number"?v.toLocaleString():String(v);
  const fmtOf=(r,v)=>cmpNum(v)!=null&&r.fmt?`${r.fmt(cmpNum(v))}${r.unit?` ${r.unit}`:""}`:txt(v);
  return `<div class="cmp">
    <div class="cmp-top"><div class="mk-h" style="margin:0">Compare</div><span class="mk-note">${s.a.length+s.b.length+s.diff.length} differences · ${s.same.length} the same</span><span class="spacer"></span>
      <button class="btn small ghost" data-cmpswap="1" title="Open the other one with this one to compare">Swap sides</button></div>
    <div class="cmp-pair">${card(A,"a")}<div class="cmp-vs">VS</div>${card(B,"b")}</div>
    <div class="cmp-verdict">${cmpVerdict(A.name,B.name,s)}</div>
    <div class="cmp-cols">${col(`${esc(A.name)} is better at`,s.a,"a","a")}${col(`${esc(B.name)} is better at`,s.b,"b","b")}
      <div class="cmp-col"><div class="cmp-h">Just different</div>${s.diff.length?s.diff.map(r=>`<div class="cmp-x"><span>${esc(r.k)}</span><div>${esc(fmtOf(r,r.a))} <i>vs</i> ${esc(fmtOf(r,r.b))}</div></div>`).join(""):`<div class="muted cmp-none">Nothing</div>`}
        ${s.same.length?`<details class="cmp-same"><summary>The same: ${s.same.length}</summary>${s.same.map(r=>`<div class="cmp-x"><span>${esc(r.k)}</span><div>${esc(fmtOf(r,r.a))}</div></div>`).join("")}</details>`:""}</div></div>
    <div class="muted" style="font-size:11.5px;margin-top:10px">${ctx.note||""}</div></div>`; }

// The picker, before anything is chosen: a search box and suggestions
function cmpPickHtml(title,sugg,listId,opts,q){
  return `<div class="cmp cmp-pick"><div class="cmp-top"><div class="mk-h" style="margin:0">Compare</div><span class="mk-note">${esc(title)}</span></div>
    <div class="row" style="gap:8px;flex-wrap:wrap;align-items:center"><input class="field" data-cmpq="1" list="${listId}" placeholder="Search to compare with…" value="${esc(q||"")}" autocomplete="off" style="flex:1 1 260px;max-width:420px">
      <datalist id="${listId}">${opts}</datalist>
      ${sugg.length?`<span class="muted" style="font-size:12px">or</span>${sugg.map(x=>`<button class="btn small ghost" data-cmppick="${esc(String(x.id))}" title="${esc(x.why||"")}">${esc(x.name)}</button>`).join("")}`:""}</div></div>`; }

// ---- Vehicles
const CMP_VEH_ROWS=(v,d)=>{ const n=cmpNum, buy=v.buy?.[0]?.price, rent=v.rent?.[0]?.price;
  return [
    {...cmpRow("Buy price in game",buy??null,null,-1,x=>Math.round(x).toLocaleString(),"aUEC","cheaper in game"),onlyTxt:"Sold in game"},
    {...cmpRow("Rent per day",rent??null,null,-1,x=>Math.round(x).toLocaleString(),"aUEC","cheaper to rent"),onlyTxt:"Rentable"},
    cmpRow("Cargo grid",n(d.scu??v.scu),null,1,null,"SCU","more cargo"),
    cmpRow("Crew (most)",n(d.crew_max||d.crew_min),null,0,null,"","crew"),
    cmpRow("Seats",n(d.seats),null,0),
    cmpRow("Beds",n(d.beds),null,1,null,"","more beds"),
    cmpRow("Medical beds",n(d.medical_beds),null,1,null,"","more medical beds"),
    cmpRow("Personal storage",n(d.storage_scu),null,1,x=>(+x).toLocaleString(),"SCU","more personal storage"),
    cmpRow("SCM speed",n(d.scm),null,1,null,"m/s","faster in SCM"),
    cmpRow("Boost speed",n(d.boost),null,1,null,"m/s","faster on boost"),
    cmpRow("Top speed",n(d.max),null,1,null,"m/s","a higher top speed"),
    cmpRow("Pitch",n(d.pitch),null,1,null,"°/s","more agile"),
    cmpRow("Hydrogen fuel",n(d.h_fuel),null,1,x=>(+x).toLocaleString(),"SCU","more hydrogen fuel"),
    cmpRow("Quantum fuel",n(d.q_fuel),null,1,x=>(+x).toLocaleString(),"SCU","more quantum fuel"),
    {...cmpRow("Quantum speed",n(d.qt_speed),null,1,x=>fmtBig(x)+"/s","","faster in quantum"),pct:true},
    {...cmpRow("Quantum range",n(d.qt_range),null,1,x=>fmtBig(x),"","a longer quantum range"),pct:true},
    cmpRow("Quantum spool",n(d.qt_spool),null,-1,x=>(+x).toLocaleString(),"s","spools quicker"),
    {...cmpRow("Shield HP",n(d.shield),null,1,null,"","stronger shields"),pct:true},
    {...cmpRow("Hull HP",n(d.hull),null,1,null,"","a tougher hull"),pct:true},
    {...cmpRow("Armor HP",n(d.armor),null,1,null,"","more armor"),pct:true},
    cmpRow("Countermeasures",n(d.countermeasures),null,1,null,"","more countermeasures"),
    {...cmpRow("IR signature",n(d.ir),null,-1,x=>fmtBig(x),"","a lower IR signature"),pct:true},
    {...cmpRow("EM signature",n(d.em),null,-1,x=>fmtBig(x),"","a lower EM signature"),pct:true},
    {...cmpRow("Cross-section",n(d.cs),null,-1,null,"","a smaller cross-section"),pct:true},
    {...cmpRow("Pilot DPS",n(d.dps),null,1,null,"","more pilot firepower"),pct:true},
    cmpRow("Missiles",n(d.missiles),null,1,null,"","more missiles"),
    cmpRow("Turrets",n(d.turrets),null,1,null,"","more turrets"),
    cmpRow("Insurance claim",n(d.claim),null,-1,null,"min","a quicker claim"),
    cmpRow("Length",n(d.length),null,0,x=>(+x).toLocaleString(),"m"),cmpRow("Mass",n(d.mass),null,0,null,"kg"),
    cmpRow("Manufacturer",v.maker||null,null,0,null,"","maker"),cmpRow("Career",d.career||null,null,0),
    cmpRow("Landing pad",d.pad||null,null,0),cmpRow("Size class",d.size_class??null,null,0),
    cmpRow("Roles",(v.roles||[]).join(", ")||null,null,0)]; };
function cmpVehRows(va,da,vb,db){ const A=CMP_VEH_ROWS(va,da), B=CMP_VEH_ROWS(vb,db);
  return A.map((r,i)=>({...r,b:B[i].a})).filter(r=>!(r.a==null&&r.b==null)); }
function cmpVehSugg(v){ const L=(S.veh||[]).filter(x=>x.id!==v.id), out=[], seen=new Set(), add=(x,why)=>{ if(x&&!seen.has(x.id)&&out.length<5){ seen.add(x.id); out.push({id:x.id,name:x.full,why}); } };
  const role=(v.roles||[])[0], sameRole=L.filter(x=>role&&(x.roles||[]).includes(role));
  sameRole.filter(x=>x.maker!==v.maker).sort((a,b)=>Math.abs((a.scu||0)-(v.scu||0))-Math.abs((b.scu||0)-(v.scu||0))).slice(0,3).forEach(x=>add(x,`Also ${role}`));
  L.filter(x=>x.maker===v.maker&&String(x.full).split(" ")[1]===String(v.full).split(" ")[1]).slice(0,2).forEach(x=>add(x,"A variant"));
  sameRole.slice(0,5).forEach(x=>add(x,`Also ${role}`));
  return out; }
async function cmpVeh(v){ const box=()=>S.vehDetail===String(v.id)?$("vd-compare"):null; if(!box()) return;
  const key="veh:"+v.id, st=S.cmp[key]=S.cmp[key]||{};
  if(!st.other){ const opts=(S.veh||[]).filter(x=>x.id!==v.id).map(x=>`<option value="${esc(x.full)}">${esc(x.maker||"")}</option>`).join("");
    box().innerHTML=cmpPickHtml(`See how the ${v.full} stacks up against another ship or vehicle`,cmpVehSugg(v),"cmp-veh-dl",opts,st.q);
    return cmpWire(box(),key,q=>(S.veh||[]).find(x=>x.full.toLowerCase()===q.toLowerCase())?.id,()=>cmpVeh(v)); }
  const w=(S.veh||[]).find(x=>String(x.id)===String(st.other)); if(!w){ st.other=null; return cmpVeh(v); }
  box().innerHTML=`<div class="cmp">${qLoader(`Comparing with ${w.full}…`)}</div>`;
  S.vdCache=S.vdCache||{}; let da,db;
  try{ [da,db]=await Promise.all([S.vdCache[v.id]||api().vehicle_detail(v.id),S.vdCache[w.id]||api().vehicle_detail(w.id)]); }catch(_){}
  if(!box()) return; if(!da||!db){ box().innerHTML=`<div class="cmp"><div class="muted">Couldn't load ${esc(w.full)}'s details.</div></div>`; return; }
  S.vdCache[v.id]=da; S.vdCache[w.id]=db;
  const pic=x=>x.photo?`<img src="${esc(x.photo)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">`:phCard("vehicle");
  box().innerHTML=cmpHtml({a:{name:v.full,sub:[v.maker,da.career].filter(Boolean).join(" · "),pic:pic(v)},b:{name:w.full,sub:[w.maker,db.career].filter(Boolean).join(" · "),pic:pic(w)},
    rows:cmpVehRows(v,da,w,db),note:"Specs from the Star Citizen Wiki; prices from UEX. A modular ship is compared with its base module."});
  cmpWire(box(),key,null,()=>cmpVeh(v),()=>{ S.vehDetail=String(w.id); S.cmp["veh:"+w.id]={other:v.id}; renderVehicles(); }); }

// ---- Gear: weapons, armor, clothing, gadgets, attachments, consumables, keys
const CMP_GEAR_STATS=[["dps","DPS",1,null,"","more DPS"],["alpha","Damage per shot",1,x=>nf(x),"","more damage per shot"],["range","Range",1,null,"m","longer range"],
  ["rpm","Fire rate",1,null,"rpm","a faster fire rate"],["mag","Magazine",1,null,"rounds","a bigger magazine"],["speed","Projectile speed",1,null,"m/s","faster projectiles"],
  ["pellets","Pellets per shot",0],["zoom","Zoom",0,x=>nf(x)+"x"],["dr","Damage reduction",1,x=>nf(x),"%","more damage reduction"],
  ["temp_min","Coldest temperature",-1,null,"°C","handles more cold"],["temp_max","Hottest temperature",1,null,"°C","handles more heat"],
  ["carry","Carrying space",1,null,"µSCU","more carrying space"],["rad","Radiation protection",1,null,"REM","more radiation protection"],
  ["rad_rate","Radiation scrub rate",1,x=>nf(x),"REM/s","scrubs radiation quicker"],["em","EM signature",-1,x=>nf(x),"","a lower EM signature"],
  ["ndr","Nutrition (NDR)",1,x=>nf(x),"","more nutrition"],["hei","Hydration (HEI)",1,x=>nf(x),"","more hydration"],["mass","Mass",-1,x=>nf(x),"kg","lighter"]];
function cmpGearRows(kind,a,b){ const rows=[];
  for(const [k,lab,dir,fmt,unit,ph] of CMP_GEAR_STATS){ const x=a.stats?.[k], y=b.stats?.[k]; if(x==null&&y==null) continue; rows.push({...cmpRow(lab,x??null,y??null,dir,fmt,unit,ph),pct:k==="dps"||k==="alpha"}); }
  rows.push({...cmpRow("Shop price",grPrice(a),grPrice(b),-1,null,"aUEC","cheaper in shops"),onlyTxt:"Sold in shops"});
  // Everything else the pages show (fire modes, slots, set, rarity…) as text
  const have=new Set(rows.map(r=>r.k)), pa=new Map(grSpecPairs(kind,a)), pb=new Map(grSpecPairs(kind,b));
  for(const lab of new Set([...pa.keys(),...pb.keys()])){ if(have.has(lab)||/^(DPS|Per shot|Range|Price|Damage reduction|Temperature|Carrying)$/.test(lab)) continue;
    rows.push(cmpRow(lab,pa.get(lab)??null,pb.get(lab)??null,0)); }
  if(a.maker||b.maker) rows.push(cmpRow("Maker",a.maker||null,b.maker||null,0));
  return rows.map(r=>typeof r.a==="string"||typeof r.b==="string"?{...r,fmt:x=>String(x)}:r); }
function cmpGearSugg(kind,i){ const L=(grState(kind).data?.items||[]).filter(x=>x!==i), G=GEAR[kind], cat=G.cat(i), out=[];
  const same=L.filter(x=>G.cat(x)===cat);
  for(const x of same.filter(x=>x.maker!==i.maker).sort((p,q)=>Math.abs((p.stats?.dps??p.stats?.dr??0)-(i.stats?.dps??i.stats?.dr??0))-Math.abs((q.stats?.dps??q.stats?.dr??0)-(i.stats?.dps??i.stats?.dr??0))).slice(0,4))
    out.push({id:x.uuid||x.name,name:x.name,why:`Also ${cat}`});
  return out; }
function cmpGear(kind,i){ const id=i.uuid||i.name, st0=grState(kind), box=()=>S.tab===kind&&st0.sel===id?$("grd-compare"):null; if(!box()) return;
  const key=`gear:${kind}:${id}`, st=S.cmp[key]=S.cmp[key]||{}, G=GEAR[kind], L=st0.data?.items||[];
  if(!st.other){ const opts=L.filter(x=>x!==i).map(x=>`<option value="${esc(x.name)}">${esc([x.maker,G.cat(x)].filter(Boolean).join(" · "))}</option>`).join("");
    box().innerHTML=cmpPickHtml(`See how it stacks up against another ${G.noun}`,cmpGearSugg(kind,i),"cmp-gear-dl",opts,st.q);
    return cmpWire(box(),key,q=>{ const x=L.find(y=>y.name.toLowerCase()===q.toLowerCase()); return x?(x.uuid||x.name):null; },()=>cmpGear(kind,i)); }
  const w=L.find(x=>(x.uuid||x.name)===st.other); if(!w){ st.other=null; return cmpGear(kind,i); }
  const pic=x=>x.image?`<img src="${esc(x.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">`:`<span data-gpic="${esc(x.name)}"></span>`;
  box().innerHTML=cmpHtml({a:{name:i.name,sub:[i.maker,G.cat(i)].filter(Boolean).join(" · "),pic:pic(i)},b:{name:w.name,sub:[w.maker,G.cat(w)].filter(Boolean).join(" · "),pic:pic(w)},
    rows:cmpGearRows(kind,i,w),note:"From the Star Citizen Wiki; shop prices from UEX."});
  fillGearPictures(box());
  cmpWire(box(),key,null,()=>cmpGear(kind,i),()=>{ S.cmp[`gear:${kind}:${st.other}`]={other:id}; grOpenItem(kind,st.other,null); }); }

// Shared clicks: pick from the search or a suggestion, change, swap sides (opens the other one, comparing back)
function cmpWire(root,key,find,again,swap){ const st=S.cmp[key];
  const q=root.querySelector("[data-cmpq]");
  if(q){ const go=()=>{ const id=find?.(q.value.trim()); if(id!=null){ st.other=id; st.q=""; again(); } };
    q.oninput=()=>{ st.q=q.value; }; q.onchange=go; q.onkeydown=e=>{ if(e.key==="Enter") go(); }; }
  for(const b of root.querySelectorAll("[data-cmppick]")) b.onclick=()=>{ st.other=b.dataset.cmppick; again(); };
  for(const b of root.querySelectorAll("[data-cmpclear]")) b.onclick=()=>{ st.other=null; again(); setTimeout(()=>root.querySelector("[data-cmpq]")?.focus(),30); };
  for(const b of root.querySelectorAll("[data-cmpswap],[data-cmpopen]")) b.onclick=()=>{ if(!swap) return; if(b.dataset.cmpopen) st.other&&swap(); else swap(); }; }
