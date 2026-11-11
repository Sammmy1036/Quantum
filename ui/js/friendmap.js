// Quantum UI: the Friend Map (Social › Friend Map): friends and org mates who share their location, on the map.
// One of several classic scripts sharing one global scope; index.html loads them in order.
"use strict";
// Python (api_friendmap.py) sends your own location when you share it and fetches everyone else's; their latest
// positions come with every poll() as live.friends. The map draws them in the Friend Map tab, and in every other
// tab too while "Also show them on the main map" is on. Someone on a planet is placed by their ground position,
// so they turn with the planet like your own marker does.
S.fm=S.fm||{data:null,sel:null,key:""};
const FM_COLORS=["#57e39b","#f2c14e","#ff5fa8","#c99bff","#ffb454","#8cc4ff","#9dff7a","#ff9b8a"];
function fmColor(id){ let h=0; for(const c of String(id||"")) h=(h*31+c.charCodeAt(0))>>>0; return FM_COLORS[h%FM_COLORS.length]; }
// Who to draw: everyone sharing with you, in the Friend Map tab or while they're on the main map
function fmPeople(){ const f=S.live?.friends; return f&&(S.tab==="friendmap"||f.on_map)?(f.people||[]):[]; }
const fmAll=()=>S.live?.friends?.people||[];
// Seconds since they last sent where they are: the server's age when Quantum fetched it, plus the time since
function fmAge(p){ const at=S.live?.friends?.at; return (p.age||0)+(at?Math.max(0,Date.now()/1000-at):0); }
function fmAgo(p){ const a=fmAge(p); return a<45?"just now":a<3600?`${Math.round(a/60)} min ago`:`${Math.round(a/3600)} h ago`; }
function fmG(p,t){ const B=p.body&&p.local&&S.bodyMap?.[p.body]; return B?toGlobal(B,p.local,t):p.pos; }
function fmWhere(p){ return [p.place||(p.body?`Near ${p.body}`:"In space"),p.system].filter(Boolean).join(" · "); }

// ---- on the map (called by drawOverlay, after your own marker)
function drawFriends(t){ const L=fmPeople(); if(!L.length) return;
  for(const p of L){ if(p.system!==S.system||!p.pos) continue;
    const g=fmG(p,t), q=g&&proj(g); if(!q||!visible(g,p.body)) continue;
    const col=fmColor(p.id), stale=fmAge(p)>120, sel=S.tab==="friendmap"&&S.fm.sel===p.id;
    ctx.save(); ctx.globalAlpha=stale?.6:1;
    if(sel){ ctx.strokeStyle=col; ctx.lineWidth=2; ctx.beginPath(); ctx.arc(q[0],q[1],13,0,7); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(q[0],q[1]-7); ctx.lineTo(q[0]+7,q[1]); ctx.lineTo(q[0],q[1]+7); ctx.lineTo(q[0]-7,q[1]); ctx.closePath();   // a diamond: not you, not a place
    ctx.fillStyle=col; ctx.fill(); ctx.strokeStyle="#05080f"; ctx.lineWidth=2; ctx.stroke(); ctx.restore();
    labelBoxes.push([q[0]-9,q[1]-9,q[0]+9,q[1]+9]);
    label(stale?`${p.name} · ${fmAgo(p)}`:p.name,q[0]+11,q[1]+4,{color:col,font:"700 12px 'Exo 2',sans-serif",force:sel||S.tab==="friendmap"});
    S.picks.push({kind:"friend",id:p.id,name:p.name,x:q[0],y:q[1],r:11,depth:q[2]}); } }
function fmTip(hit){ const p=fmAll().find(x=>x.id===hit.id); if(!p) return null;
  return {t:p.name, s:`${p.why==="org"?"Org mate":"Friend"} · ${fmWhere(p)} · ${fmAgo(p)}. Double-click to fly there`}; }
// A click on someone on the map: open them in the Friend Map. A double-click: fly to them.
function fmPickFriend(id){ S.fm.sel=id; if(S.tab!=="friendmap") document.querySelector('.tab[data-tab="friendmap"]')?.click(); else renderFriendMap(); }
function fmFlyTo(id){ const p=fmAll().find(x=>x.id===id); if(!p) return;
  if(p.system&&p.system!==S.system&&S.systems?.includes(p.system)) setSystem(p.system,false);
  setFollow(false);
  if(p.body&&p.local&&S.bodyMap[p.body]) flyTo({kind:"local",body:p.body,pos:p.local}, Math.max(30000,S.bodyMap[p.body].radius*0.08), {...TOPDOWN,key:"friend:"+id});
  else flyTo({kind:"point",pos:p.pos},5e6,{key:"friend:"+id}); }

// ---- the tab
async function openFriendMap(){ renderFriendMap(); await fmLoad(); renderFriendMap(); }
async function fmLoad(){ try{ const r=await api().friendmap_get(true); if(r?.ok) S.fm.data=r; }catch(_){} }
// Every poll: the tab's count, and the list while it's open (only redrawn when something in it changed)
function fmSync(live){ const n=(live.friends?.people||[]).length, c=$("c-fmap"); if(c){ c.hidden=!n; c.textContent=n||""; }
  if(S.tab!=="friendmap") return;
  if(Date.now()-(S.fm.loadedAt||0)>3000){ S.fm.loadedAt=Date.now(); fmLoad().then(()=>renderFriendMap()); }
  else renderFriendMap(); }
function renderFriendMap(){ const P=$("pane-friendmap"); if(!P||S.tab!=="friendmap") return;
  const d=S.fm.data, people=fmAll(), sel=S.fm.sel;
  const key=JSON.stringify([d&&[d.signed_in,d.share,d.on_map,d.game_on,d.me,d.error,d.sharing],people.map(p=>[p.id,p.place,p.system,Math.round(fmAge(p)/30)]),sel,S.so?.st?.friends?.length]);
  if(P.dataset.k===key) return; P.dataset.k=key;
  if(d&&!d.signed_in){ P.innerHTML=`<div class="note" style="margin-top:4px"><b>Sign in to use the Friend Map</b>
      <div class="muted" style="font-size:12.5px;margin:6px 0 10px">Friends who share their location show on your map. It goes with your Quantum account.</div>
      <button class="btn primary small" onclick="openProfileView('overview')">Sign in</button></div>`; return; }
  const share=d?.share||"off", opt=(v,t)=>`<option value="${v}" ${share===v?"selected":""}>${t}</option>`;
  const status=share==="off"?`<span class="muted">Nobody sees where you are.</span>`
    :!d?.game_on?`<span class="muted">You'll show once Star Citizen is running and Quantum knows where you are.</span>`
    :!d?.me?`<span class="muted">Type <b>/showlocation</b> in game chat (or press F10) so Quantum knows where you are.</span>`
    :d.sharing?`<span style="color:#57e39b">Sharing: you show ${esc(d.me.place?(d.me.place.startsWith("Near ")?d.me.place.toLowerCase():"at "+d.me.place):"on the map")}${d.me.system?` in ${esc(d.me.system)}`:""}.</span>`
    :`<span class="muted">Starting to share…</span>`;
  const row=p=>{ const col=fmColor(p.id), stale=fmAge(p)>120, canRoute=!!(p.place&&S.locMap?.[p.place]&&!String(p.place).startsWith("Near "));
    return `<div class="fm-row ${sel===p.id?"on":""}" data-fmid="${esc(p.id)}">
      <span class="fm-av" style="border-color:${col};color:${col}">${esc(soInit(p.name))}</span>
      <div class="fm-who"><b>${esc(p.name)}</b> <span class="fm-why ${p.why==="org"?"org":""}">${p.why==="org"?"Org":"Friend"}</span>
        <div class="muted" style="font-size:12px">${esc(fmWhere(p))} · <span style="color:${stale?"#ffb454":"inherit"}">${fmAgo(p)}</span></div></div>
      <div class="fm-acts"><button class="btn small" data-fm="show" title="Fly the map to ${esc(p.name)}">Show</button>
        ${canRoute?`<button class="btn small ghost" data-fm="route" title="Add ${esc(p.place)} to your route">Route there</button>`:""}
        <button class="btn small ghost" data-fm="msg" title="Message ${esc(p.name)}">Message</button></div></div>`; };
  const here=people.filter(p=>p.system===S.system), elsewhere=people.filter(p=>p.system!==S.system);
  P.innerHTML=`<div class="fm-box">
      <label class="fm-k" for="fm-share">Share my location</label>
      <select class="field" id="fm-share" style="width:100%">${opt("off","Off")}${opt("friends","With my friends")}${opt("friends_orgs","With my friends and my orgs' members")}</select>
      <div style="font-size:12.5px;margin-top:6px;line-height:1.45">${status}</div>
      <label class="fm-check"><input type="checkbox" id="fm-onmap" ${d?.on_map!==false?"checked":""}> Also show friends on the main map (Route, Trade and the rest)</label></div>
    ${d?.error?`<div class="note" style="margin-top:10px;color:#ffb454">${esc(d.error)}</div>`:""}
    <div class="mk-h" style="margin-top:16px">On the map${people.length?` <span class="mk-note">${people.length} sharing</span>`:""}</div>
    ${people.length?`${here.map(row).join("")}${elsewhere.length?`<div class="mk-h" style="margin-top:12px">Other systems</div>${elsewhere.map(row).join("")}`:""}`
      :`<div class="empty" style="padding:16px 6px"><strong>Nobody's sharing right now</strong>Friends show here (and on the map) while they share their location and Star Citizen is running.${S.so?.st&&!S.so.st.friends?.length?` <a data-fm="friends" style="cursor:pointer">Add friends</a>`:""}</div>`}
    <div class="muted" style="font-size:11.5px;margin-top:14px;line-height:1.5">Only the people you pick see you, only while Star Citizen and Quantum are running. The server keeps your last position in memory for 5 minutes, never on disk. Appear offline (Friends) hides you too.</div>`;
  $("fm-share").onchange=async e=>{ const r=await api().friendmap_set(e.target.value,null); if(r?.ok===false) return toast(r.error); S.fm.data=r; renderFriendMap();
    toast(e.target.value==="off"?"You're off the Friend Map":e.target.value==="friends"?"Your friends can see where you are":"Your friends and org members can see where you are"); };
  $("fm-onmap").onchange=async e=>{ const r=await api().friendmap_set(null,e.target.checked); if(r?.ok) S.fm.data=r; await poll(); renderFriendMap(); }; }
$("pane-friendmap")?.addEventListener("click",async e=>{ const a=e.target.closest("[data-fm]")?.dataset.fm; if(!a) { const r=e.target.closest("[data-fmid]"); if(r){ S.fm.sel=r.dataset.fmid; renderFriendMap(); } return; }
  if(a==="friends") return document.querySelector('.tab[data-tab="friends"]').click();
  const id=e.target.closest("[data-fmid]")?.dataset.fmid, p=fmAll().find(x=>x.id===id); if(!p) return; S.fm.sel=id;
  if(a==="show"){ fmFlyTo(id); return renderFriendMap(); }
  if(a==="msg") return soOpen(id);
  if(a==="route"){ const r=await api().add_stops([p.place],true); await poll(); markAdded(p.place);
    toast(r?.added?.length?`Added ${p.place} to your route`:`${p.place} is already the last stop`); } });
