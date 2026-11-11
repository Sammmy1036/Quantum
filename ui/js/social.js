// Quantum UI: Friends and messages, and the player Market.
// One of several classic scripts sharing one global scope; index.html loads them in order.
"use strict";
// =================================================================== social: friends and messages
// The list lives in the sidebar (Friends tab), the conversation in the map area. Python checks in with the
// Quantum server in the background (every 4 s while this is open, 20 s otherwise); this reads what it has.
S.so={st:null,signed:null,open:null,conv:null,q:"",results:null,draft:{},ask:null,blocked:null,showBlocked:false,my:"online",err:null};
const SO_PRES={online:"Online",away:"Away",invisible:"Appear offline"};
function soAgo(t){ const d=Math.max(0,Date.now()/1000-t); return d<90?"just now":d<3600?`${Math.round(d/60)} min ago`:d<86400?`${Math.round(d/3600)} h ago`:`${Math.round(d/86400)} d ago`; }
function soInit(n){ return ((n||"?").match(/[A-Za-z0-9]+/g)||["?"]).slice(0,2).map(w=>w[0]).join("").toUpperCase(); }
function soAv(p,lg){ return `<span class="so-av${lg?" lg":""}">${esc(soInit(p?.name))}${p?.avatar?`<img src="${esc(p.avatar)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">`:""}</span>`; }
function soDotCls(f){ return f.playing?"playing":f.online?(f.status==="away"?"away":"online"):""; }
function soAvDot(f,lg){ return `<span class="so-wrap">${soAv(f,lg)}<i class="so-dot ${soDotCls(f)}"></i></span>`; }
function soPresence(f){ return f.playing?"In Star Citizen":f.online?(f.status==="away"?"Away":"Online"):f.seen?`Last seen ${soAgo(f.seen)}`:"Offline"; }
function soBadge(b){ const n=b?(b.unread||0)+(b.requests||0):0;
  const r=$("rail-so-n"); if(r){ r.textContent=n>99?"99+":n; r.hidden=!n; }
  const c=$("c-friends"); if(c){ c.textContent=b?b.online:0; c.hidden=!b||!b.online; c.title="Friends online"; }
}
async function soTick(){ const focus=S.tab==="friends"; let r; try{ r=await api().social_get(focus); }catch(_){ return; }
  soApply(r); if(focus&&S.so.open) soLoadConv(false); }
function soApply(r){ if(!r) return; const was=JSON.stringify([S.so.signed,S.so.st]);
  S.so.signed=!!r.signed_in; S.so.st=r.signed_in?(r.state||S.so.st):null; S.so.err=r.error||null; if(r.my_status) S.so.my=r.my_status;
  const st=S.so.st; soBadge(st?.status==="ok"?{unread:st.unread||0,requests:(st.incoming||[]).length,online:(st.friends||[]).filter(f=>f.online).length}:null);
  if(typeof pmTodo==="function") pmTodo(st?.status==="ok"?(st.market_todo||0):0);
  if(typeof ogTodo==="function") ogTodo(st?.status==="ok"?(st.org_todo||0):0);
  for(const n of r.notes||[]){
    if(n.request) toast(`${n.name} sent you a friend request`);
    else if(!(S.tab==="friends"&&S.so.open===n.from)) toast(`${n.name}: ${n.body}`); }
  if(S.tab==="friends"&&JSON.stringify([S.so.signed,S.so.st])!==was){ renderSocialLists(); if(!S.so.open||!S.so.conv) renderSocialPanel(); else soHead(); } }
async function openSocial(){ renderSocialPane(); renderSocialPanel(); soApply(await api().social_get(true));
  renderSocialPane(); if(S.so.open) soLoadConv(true); }
// Checks for new messages and requests every 4 s, whichever section is open (cheap: Python already has them)
if(!S.soWatch) S.soWatch=setInterval(soTick,4000);
function soFriend(id){ return (S.so.st?.friends||[]).find(f=>f.id===id); }
function soChat(id){ return (S.so.st?.chats||[]).find(f=>f.id===id); }

// ---- sidebar: you, search, requests, friends
function renderSocialPane(){ const P=$("pane-friends"); if(!P) return;
  if(S.so.signed===false){ P.innerHTML=`<div class="note" style="margin-top:4px"><b>Sign in to use friends and messages</b>
      <div class="muted" style="font-size:12.5px;margin:6px 0 10px">Friends and messages go with your Quantum account, so they follow you to any PC.</div>
      <button class="btn primary small" onclick="openProfileView('overview')">Sign in</button></div>`; P.dataset.built=""; return; }
  if(S.so.st?.status==="unavailable"){ P.innerHTML=`<div class="note">The Quantum server doesn't have friends and messages yet.</div>`; P.dataset.built=""; return; }
  if(!P.dataset.built){ P.dataset.built="1";
    P.innerHTML=`<div class="so-me" id="so-me"></div>
      <input class="search" id="so-q" placeholder="Find people by @username or name" autocomplete="off" spellcheck="false">
      <div id="so-results"></div><div id="so-lists"></div>`;
    let t; $("so-q").oninput=e=>{ S.so.q=e.target.value; clearTimeout(t); t=setTimeout(soSearch,350); };
    $("so-q").value=S.so.q||""; }
  renderSocialLists(); renderSocialResults(); }
function renderSocialLists(){ const L=$("so-lists"), M=$("so-me"); if(!L||!M) return; const st=S.so.st;
  if(!st||st.status!=="ok"){ L.innerHTML=`<div class="so-empty">${S.so.err?esc(S.so.err):"Loading…"}</div>`; return; }
  const me=st.me||{};
  M.innerHTML=`${soAvDot({name:me.name,avatar:(typeof pfPhoto==="function"?pfPhoto():null),online:S.so.my!=="invisible",status:S.so.my})}<span class="nm">${esc(me.name||"You")}${me.username_auto?`<small class="so-tag" title="Your username: people find you by it"><span>Your username</span><a style="cursor:pointer;text-decoration:underline" data-souname="1">Choose</a></small>`:""}</span>
    <select class="field" id="so-pres" title="What your friends see">${Object.entries(SO_PRES).map(([k,v])=>`<option value="${k}" ${S.so.my===k?"selected":""}>${v}</option>`).join("")}</select>`;
  // Your username: offered once to people who got one made for them, and any time from "Change"
  const un=$("so-uname"), showUn=me.username_auto&&(S.so.unameEdit||!S.so.unameDismissed);
  if(showUn&&!un) M.insertAdjacentHTML("afterend",`<div class="note" id="so-uname" style="margin:-4px 0 10px;font-size:12.5px">Your username is <b>${esc(me.tag)}</b>. We made it for you. It's your name everywhere in Quantum: how people find you, message you and see you in orgs and the marketplace. You can choose your own once. <b>After that it's permanent.</b>
    <div class="row" style="gap:6px;margin-top:8px"><span class="muted">@</span><input class="field" id="so-uname-in" maxlength="20" value="${esc(me.username||"")}" style="flex:1" autocomplete="off" spellcheck="false"><button class="btn small primary" id="so-uname-save">Save</button><button class="btn small ghost" id="so-uname-x">Keep it</button></div>
    <div class="muted" id="so-uname-err" style="font-size:12px;margin-top:6px">3 to 20 characters: letters, numbers, _ and .</div></div>`);
  else if(!showUn&&un) un.remove();
  if($("so-uname")){ const save=async keep=>{ const v=keep?me.username:$("so-uname-in").value.trim().replace(/^@/,""); const r=await api().social_username(v);
      if(!r.ok){ $("so-uname-err").textContent=r.error; $("so-uname-err").style.color="#ffb3b3"; return; }
      S.so.unameEdit=false; S.so.unameDismissed=true; $("so-uname")?.remove(); toast(keep?"Username kept":`You're @${r.username} now`); soApply(await api().social_refresh()); if(typeof pfRefreshAcct==="function") pfRefreshAcct(); };
    $("so-uname-save").onclick=()=>save(false); $("so-uname-x").onclick=()=>save(true);
    $("so-uname-in").onkeydown=e=>{ if(e.key==="Enter") save(false); }; }
  for(const a of M.querySelectorAll("[data-souname]")) a.onclick=()=>{ S.so.unameEdit=true; S.so.unameDismissed=false; $("so-uname")?.remove(); renderSocialLists(); setTimeout(()=>$("so-uname-in")?.select(),30); };
  if(me.findable===false&&!$("so-hint")) M.insertAdjacentHTML("afterend",`<div class="note" id="so-hint" style="margin:-4px 0 10px;font-size:12.5px">You have no display name yet, so people can only find you by your ID <b>${esc(me.tag)}</b>.
    <a data-url="${esc("https://quantumsc.org/account?tab=profile")}" style="cursor:pointer;text-decoration:underline">Set a display name</a> on your account page, or link your UEX name in your profile.</div>`);
  if(me.findable!==false) $("so-hint")?.remove();
  for(const u of document.querySelectorAll("#pane-friends [data-url]")) u.onclick=()=>api().open_url(u.dataset.url);
  $("so-pres").onchange=async e=>{ const r=await api().social_set_status(e.target.value); if(!r.ok) return toast(r.error); S.so.my=e.target.value; toast(e.target.value==="invisible"?"You appear offline to your friends":`You're ${SO_PRES[e.target.value].toLowerCase()}`); };
  const inc=st.incoming||[], out=st.outgoing||[], fr=st.friends||[], on=fr.filter(f=>f.online);
  let h="";
  if(inc.length) h+=`<div class="so-h">Friend requests <b>${inc.length}</b></div>`+inc.map(p=>`<div class="so-row">${soAv(p)}<div class="who"><b class="up-name" data-upid="${esc(p.id)}">${esc(p.name)}</b><small>${p.uex?"UEX: "+esc(p.uex):"Wants to be friends"}</small></div>
      <div class="acts"><button class="btn small primary" data-soacc="${p.id}">Accept</button><button class="btn small ghost" data-sodec="${p.id}">Decline</button></div></div>`).join("");
  h+=`<div class="so-h">Friends <b>${on.length?`${on.length} online · `:""}${fr.length}</b></div>`;
  h+=fr.length?fr.map(f=>`<div class="so-row click ${S.so.open===f.id?"on":""}" data-soopen="${f.id}">${soAvDot(f)}<div class="who"><b>${esc(f.name)}</b><small class="${f.playing?"playing":""}">${esc(soPresence(f))}</small></div>${f.unread?`<span class="so-n">${f.unread}</span>`:""}</div>`).join("")
    :`<div class="so-empty">No friends yet. Search for people above and send them a request.</div>`;
  const ch=st.chats||[];
  if(ch.length) h+=`<div class="so-h">Conversations <b>${ch.length}</b></div>`+ch.map(c=>`<div class="so-row click ${S.so.open===c.id?"on":""}" data-soopen="${c.id}">${soAv(c)}<div class="who"><b>${esc(c.name)}</b><small>${esc(c.why||"Marketplace")}</small></div>${c.unread?`<span class="so-n">${c.unread}</span>`:""}</div>`).join("");
  if(out.length) h+=`<div class="so-h">Sent requests</div>`+out.map(p=>`<div class="so-row">${soAv(p)}<div class="who"><b class="up-name" data-upid="${esc(p.id)}">${esc(p.name)}</b><small>Waiting · ${soAgo(p.at)}</small></div>
      <div class="acts"><button class="btn small ghost" data-sorm="${p.id}">Cancel</button></div></div>`).join("");
  h+=`<div style="margin:16px 2px 4px"><a class="muted" style="font-size:12px;cursor:pointer;text-decoration:underline" data-soblk="1">${S.so.showBlocked?"Hide blocked people":"Blocked people"}</a></div>`;
  if(S.so.showBlocked) h+=S.so.blocked==null?`<div class="so-empty">Loading…</div>`:S.so.blocked.length?S.so.blocked.map(p=>`<div class="so-row">${soAv(p)}<div class="who"><b>${esc(p.name)}</b></div>
      <div class="acts"><button class="btn small ghost" data-sounb="${p.id}">Unblock</button></div></div>`).join(""):`<div class="so-empty">Nobody blocked.</div>`;
  L.innerHTML=h; soWire(L); }
async function soSearch(){ const q=(S.so.q||"").trim(); if(q.replace(/^@/,"").length<(q.startsWith("@")?2:3)){ S.so.results=null; return renderSocialResults(); }
  const r=await api().social_search(q); if((S.so.q||"").trim()!==q) return;
  S.so.results=r.ok?r.people:{error:r.error}; renderSocialResults(); }
function renderSocialResults(){ const R=$("so-results"); if(!R) return; const res=S.so.results;
  if(!res){ const v=(S.so.q||"").trim(); R.innerHTML=v.length&&v.replace(/^@/,"").length<(v.startsWith("@")?2:3)?`<div class="so-empty">Type at least 3 letters of a name, or @ and 2 letters of a username.</div>`:""; return; }
  if(res.error){ R.innerHTML=`<div class="so-empty">${esc(res.error)}</div>`; return; }
  R.innerHTML=`<div class="so-h">People</div>`+(res.length?res.map(p=>`<div class="so-row">${soAv(p)}<div class="who"><b class="up-name" data-upid="${esc(p.id)}">${esc(p.name)}</b><small>${[p.uex?"UEX: "+esc(p.uex):"",p.org?esc(p.org):""].filter(Boolean).join(" · ")||"Quantum member"}</small></div>
      <div class="acts">${p.relation==="friends"?`<button class="btn small" data-soopen="${p.id}">Message</button>`:p.relation==="sent"?`<span class="muted" style="font-size:12px">Requested</span>`
        :p.relation==="received"?`<button class="btn small primary" data-soacc="${p.id}">Accept</button>`:`<button class="btn small primary" data-soadd="${p.id}">Add friend</button>`}</div></div>`).join("")
    :`<div class="so-empty">Nobody by that name or username. They need a Quantum account. Ask them for their @username (it's under their name in Social).</div>`);
  soWire(R); }
function soWire(root){
  for(const b of root.querySelectorAll("[data-soopen]")) b.onclick=()=>soOpen(b.dataset.soopen);
  const act=(sel,fn,msg)=>{ for(const b of root.querySelectorAll(sel)) b.onclick=async e=>{ e.stopPropagation(); b.disabled=true;
    const r=await fn(Object.values(b.dataset)[0]); if(!r.ok){ b.disabled=false; return toast(r.error); } if(msg) toast(msg(r));
    if(S.so.results&&!S.so.results.error) soSearch(); soApply(await api().social_refresh()); }; };
  act("[data-soadd]",id=>api().social_request(id),r=>r.relation==="friends"?"You're friends now":"Friend request sent");
  act("[data-soacc]",id=>api().social_respond(id,true),()=>"You're friends now");
  act("[data-sodec]",id=>api().social_respond(id,false),()=>"Request declined");
  act("[data-sorm]",id=>api().social_remove(id),()=>"Request cancelled");
  act("[data-sounb]",async id=>{ const r=await api().social_block(id,false); if(r.ok) S.so.blocked=(S.so.blocked||[]).filter(p=>p.id!==id); return r; },()=>"Unblocked");
  for(const b of root.querySelectorAll("[data-soblk]")) b.onclick=async()=>{ S.so.showBlocked=!S.so.showBlocked; S.so.blocked=null; renderSocialLists();
    if(S.so.showBlocked){ const r=await api().social_blocked(); S.so.blocked=r.ok?r.people:[]; renderSocialLists(); } }; }

// ---- the conversation
function soOpen(id){ if(S.tab!=="friends"){ S.so.open=id; return document.querySelector('.tab[data-tab="friends"]').click(); }
  if(S.so.open!==id){ S.so.open=id; S.so.conv=null; S.so.ask=null; }
  renderSocialLists(); renderSocialPanel(); soLoadConv(true); }
async function soLoadConv(scroll){ const id=S.so.open; if(!id) return; const r=await api().social_messages(id); if(S.so.open!==id) return;
  if(!r.ok){ if(!S.so.conv){ S.so.conv={error:r.error}; renderSocialPanel(); } return; }
  const old=S.so.conv&&!S.so.conv.error?S.so.conv:null, byId=new Map((old?.messages||[]).map(m=>[m.id,m]));
  for(const m of r.messages) byId.set(m.id,m);
  S.so.conv={with:r.with,friends:r.friends,messages:[...byId.values()].sort((a,b)=>a.id-b.id),more:old?old.more:r.more};
  const f=soFriend(id)||soChat(id); if(f&&f.unread){ f.unread=0; renderSocialLists(); }
  if(!old) renderSocialPanel(); else { soHead(); soRenderMsgs(scroll); } }
function renderSocialPanel(){ const P=$("so-panel"); if(!P) return;
  const land=(t,x,btn)=>`<div class="so-land"><svg viewBox="0 0 24 24"><path d="M4 5h16v10H9l-5 4z"/><path d="M8 9h8M8 12h5"/></svg><h2>${t}</h2><div>${x}</div>${btn||""}</div>`;
  if(S.so.signed===false){ P.innerHTML=land("Friends and messages","Sign in to your Quantum account to add friends, see who's online and in game, and message them.",`<button class="btn primary" style="margin-top:14px" onclick="openProfileView('overview')">Sign in</button>`); return; }
  const id=S.so.open, c=S.so.conv;
  if(!id){ const fr=S.so.st?.friends||[], on=fr.filter(f=>f.online).length, play=fr.filter(f=>f.playing).length;
    P.innerHTML=land("Friends and messages",fr.length?`${on} of ${fr.length} friend${fr.length>1?"s":""} online${play?`, ${play} in Star Citizen`:""}. Pick someone on the left to message them.`
      :"Find people by @username on the left and send them a friend request. Once they accept, you can message each other."); return; }
  if(!c){ P.innerHTML=`<div class="so-chat-h" id="so-head"></div><div class="so-msgs"><div class="so-empty" style="margin:auto">Loading…</div></div>`; soHead(); return; }
  if(c.error){ P.innerHTML=land("Couldn't open this conversation",esc(c.error)); return; }
  P.innerHTML=`<div class="so-chat-h" id="so-head"></div><div id="so-askbox"></div><div class="so-msgs" id="so-msgs"></div>
    <div class="so-compose">${c.can_message??c.friends?`<textarea class="field" id="so-text" rows="1" maxlength="2000" placeholder="Message ${esc(c.with.name)}"></textarea><button class="btn primary" id="so-send">Send</button>`
      :`<div class="muted" style="font-size:12.5px">You can't message ${esc(c.with.name)}: you're not friends and have no marketplace trade together.</div>`}</div>`;
  soHead(); soRenderMsgs(true);
  const T=$("so-text"); if(T){ T.value=S.so.draft[id]||""; const fit=()=>{ T.style.height="auto"; T.style.height=Math.min(140,T.scrollHeight)+"px"; }; fit();
    T.oninput=()=>{ S.so.draft[id]=T.value; fit(); };
    T.onkeydown=e=>{ if(e.key==="Enter"&&!e.shiftKey){ e.preventDefault(); soSend(); } };
    $("so-send").onclick=soSend; setTimeout(()=>T.focus(),30); } }
function soHead(){ const H=$("so-head"); if(!H) return; const id=S.so.open, w=soFriend(id)||S.so.conv?.with; if(!w) return;
  const k=JSON.stringify([w,S.so.ask,S.so.conv?.friends]); if(H.dataset.k===k) return; H.dataset.k=k;
  const isF=!!soFriend(id);
  H.innerHTML=`${soAvDot(w,true)}<div class="who"><b class="up-name" data-upid="${esc(w.id)}" title="View profile">${esc(w.name)}</b><small class="${w.playing?"playing":""}">${isF?esc(soPresence(w)):esc(soChat(id)?.why||"Not friends")}${w.uex?` · UEX: ${esc(w.uex)}`:""}${w.org?` · ${esc(w.org)}`:""}</small></div>
    <span class="spacer" style="flex:1"></span>${isF?`<button class="btn small ghost" data-soask="remove">Remove friend</button>`:`<button class="btn small ghost" data-soadd="${id}">Add friend</button>`}<button class="btn small ghost" data-soask="block">Block</button>`;
  for(const b of H.querySelectorAll("[data-soask]")) b.onclick=()=>{ S.so.ask=b.dataset.soask; soAsk(); };
  for(const b of H.querySelectorAll("[data-soadd]")) b.onclick=async()=>{ b.disabled=true; const r=await api().social_request(b.dataset.soadd); toast(r.ok?(r.relation==="friends"?"You're friends now":"Friend request sent"):r.error); };
  soAsk(); }
function soAsk(){ const A=$("so-askbox"); if(!A) return; const w=S.so.conv?.with||soFriend(S.so.open); const a=S.so.ask;
  if(!a||!w){ A.innerHTML=""; return; }
  A.innerHTML=`<div class="so-ask"><span>${a==="block"?`Block <b>${esc(w.name)}</b>? You won't be friends any more, they can't find you or send you requests, and neither of you can message the other.`
      :`Remove <b>${esc(w.name)}</b> from your friends? You won't be able to message each other until one of you sends a new request.`}</span>
    <span class="spacer" style="flex:1"></span><button class="btn small" id="so-ask-no">Cancel</button><button class="btn small danger" id="so-ask-yes">${a==="block"?"Block":"Remove"}</button></div>`;
  $("so-ask-no").onclick=()=>{ S.so.ask=null; soAsk(); };
  $("so-ask-yes").onclick=async()=>{ const id=S.so.open; const r=a==="block"?await api().social_block(id,true):await api().social_remove(id);
    if(!r.ok) return toast(r.error); toast(a==="block"?`${w.name} is blocked`:`${w.name} removed from your friends`);
    S.so.ask=null; S.so.open=null; S.so.conv=null; soApply(await api().social_refresh()); renderSocialLists(); renderSocialPanel(); }; }
function soRenderMsgs(toBottom){ const M=$("so-msgs"); const c=S.so.conv; if(!M||!c||c.error) return;
  const k=JSON.stringify([c.messages.length,c.messages.at(-1)?.id,c.messages.at(-1)?.read,c.more]); if(M.dataset.k===k&&!toBottom) return; M.dataset.k=k;
  const near=M.scrollHeight-M.scrollTop-M.clientHeight<80;
  const day=t=>new Date(t*1000).toLocaleDateString([], {weekday:"short",day:"numeric",month:"short"});
  const tm=t=>new Date(t*1000).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"});
  let h=c.more?`<button class="btn small ghost" style="align-self:center;margin-bottom:8px" id="so-older">Older messages</button>`:"", last="";
  if(!c.messages.length) h+=`<div class="so-empty" style="margin:auto">No messages yet. Say hi to ${esc(c.with.name)}.</div>`;
  for(const m of c.messages){ const d=day(m.sent); if(d!==last){ h+=`<div class="so-day">${d===day(Date.now()/1000)?"Today":d}</div>`; last=d; }
    h+=`<div class="so-b ${m.mine?"mine":""}">${esc(m.body)}<time>${tm(m.sent)}</time></div>`; }
  const lm=[...c.messages].reverse().find(m=>m.mine); if(lm&&lm===c.messages.at(-1)&&lm.read) h+=`<div class="so-seen">Seen ${soAgo(lm.read)}</div>`;
  const prevH=M.scrollHeight, prevTop=M.scrollTop; M.innerHTML=h;
  if(toBottom||near) M.scrollTop=M.scrollHeight; else M.scrollTop=prevTop+(M.scrollHeight-prevH)*0;
  const o=$("so-older"); if(o) o.onclick=async()=>{ o.disabled=true; const id=S.so.open, first=c.messages[0]?.id; const r=await api().social_messages(id,first);
    if(S.so.open!==id||!r.ok) return; const h0=M.scrollHeight; c.messages=[...r.messages,...c.messages]; c.more=r.more; soRenderMsgs(false); M.scrollTop=M.scrollHeight-h0; }; }
async function soSend(){ const T=$("so-text"), id=S.so.open; if(!T||!id) return; const body=T.value.trim(); if(!body) return;
  $("so-send").disabled=true; const r=await api().social_send(id,body); const b=$("so-send"); if(b) b.disabled=false;
  if(!r.ok) return toast(r.error);
  S.so.draft[id]=""; if(S.so.open===id&&$("so-text")){ $("so-text").value=""; $("so-text").style.height="auto"; }
  if(S.so.conv&&!S.so.conv.error&&S.so.open===id){ S.so.conv.messages.push(r.message); soRenderMsgs(true); } }

// =================================================================== Market: players' items and services (aUEC only)
// Browsing works signed out; selling, buying, trades and escrow need a Quantum account. The server is market.py.
S.pm={kind:"item",q:"",cat:"",sort:"new",page:0,data:null,view:"browse",listing:null,form:null,mine:null,esc:null,todo:0,filter:"todo",arm:null};
const PM_TAB={"pm-items":"item","pm-services":"service"};
// The same lists as the server (market.py), so the form and filters never come up empty
const PM_CATS={item:["Armor","Clothing","Commodities and cargo","Crafting","Food and drink","Gadgets and tools","Medical","Mining and salvage","Ship components","Vehicle weapons","Weapons","Other"],
  service:["Bounty hunting","Escort","Hauling and delivery","Medical","Mining","Protection","Refuelling","Salvage","Towing and repair","Training","Transport","Other"]};
const pmA=n=>`${Number(n||0).toLocaleString()} aUEC`;
const pmPrice=l=>l.unit==="quote"?`<span class="pm-price">Ask for a quote</span>`:`<span class="pm-price">${pmA(l.price)}${l.unit&&l.unit!=="each"?` <small>${esc(l.unit)}</small>`:""}</span>`;
const pmStars=r=>r&&r.stars!=null?`<span class="pm-star" title="${r.count} rating${r.count>1?"s":""}">★ ${r.stars} <span class="muted">(${r.count})</span></span>`:`<span class="muted">New seller</span>`;
const PM_ICON=`<svg viewBox="0 0 24 24"><path d="M4 9l2-5h12l2 5M4 9h16v11H4zM9 13h6"/></svg>`;
const pmPh=(url,cat)=>`<div class="pm-ph">${url?`<img src="${esc(url)}" alt="" loading="lazy" onerror="this.remove()">`:PM_ICON}${cat?`<span class="cat">${esc(cat)}</span>`:""}</div>`;
async function pmCall(path,body){ let r; try{ r=await api().pm(path,body===undefined?null:body); }catch(e){ r={ok:false,error:"Couldn't reach Quantum"}; } return r; }
function pmTodo(n){ S.pm.todo=n; const b=$("rail-pm-n"); if(b){ b.textContent=n; b.hidden=!n; } const c=$("c-pm-mine"); if(c){ c.textContent=n; c.hidden=!n; }
  if(S.pmTodoSeen!==undefined&&n>S.pmTodoSeen) toast("Marketplace: new request (Market › Listings › Requests)"); S.pmTodoSeen=n; }
function openPm(tab){ if(PM_TAB[tab]){ if(S.pm.kind!==PM_TAB[tab]){ S.pm.kind=PM_TAB[tab]; S.pm.cat=""; S.pm.page=0; S.pm.data=null; } if(!["listing","form"].includes(S.pm.view)||S.pm.listing?.kind!==S.pm.kind) S.pm.view="browse"; pmPane(); pmLoad(); }
  else if(tab==="pm-mine"){ if(S.pm.filter==="standing") S.pm.filter="todo"; S.pm.view="mine"; pmPane(); pmLoadMine(); pmLoadEsc(); }
  else if(tab==="pm-standing"){ S.pm.filter="standing"; S.pm.view="mine"; pmPane(); pmLoadMine(); }
  pmRender(); }

// ---- sidebar
function pmPane(){ const tab=S.tab, P=$("pane-"+tab); if(!P) return;
  if(PM_TAB[tab]){ const svc=S.pm.kind==="service", cats=S.pm.data?.categories||PM_CATS[S.pm.kind].map(name=>({name,count:0}));
    P.innerHTML=`<button class="btn primary" style="width:100%;margin-bottom:10px" data-pmnew="1">${svc?"+ Offer a service":"+ Sell an item"}</button>
      <input class="search pm-q" placeholder="${svc?"Search services, e.g. escort":"Search items, e.g. Arclight"}" value="${esc(S.pm.q)}" autocomplete="off" spellcheck="false">
      <div class="row" style="gap:8px;margin-top:8px"><span class="muted" style="font-size:12.5px">Sort</span><select class="field pm-sort" style="flex:1">${[["new","Newest"],["cheap","Lowest price"],["dear","Highest price"]].map(([v,t])=>`<option value="${v}" ${S.pm.sort===v?"selected":""}>${t}</option>`).join("")}</select></div>
      ${S.pm.data?.error?`<div class="note" style="margin-top:10px;font-size:12.5px">${esc(S.pm.data.error)}</div>`:""}
      <div class="so-h">Categories</div><div class="pm-cats">
        <div class="so-row click ${!S.pm.cat?"on":""}" data-pmcat=""><div class="who"><b>All ${svc?"services":"items"}</b></div><span class="muted">${cats.reduce((a,c)=>a+c.count,0)||""}</span></div>
        ${cats.map(c=>`<div class="so-row click ${S.pm.cat===c.name?"on":""}" data-pmcat="${esc(c.name)}"><div class="who"><b>${esc(c.name)}</b></div><span class="muted">${c.count||""}</span></div>`).join("")}</div>
      <div class="pm-rule"><b>aUEC only.</b> Real money transactions are prohibited (dollars, PayPal, gift cards). These types of transactions break Star Citizen's Terms of Service. Listings which request this type of transaction will be taken down.</div>`;
    let t; P.querySelector(".pm-q").oninput=e=>{ S.pm.q=e.target.value; clearTimeout(t); t=setTimeout(()=>{ S.pm.page=0; S.pm.view="browse"; pmLoad(); },350); };
    P.querySelector(".pm-sort").onchange=e=>{ S.pm.sort=e.target.value; S.pm.page=0; S.pm.view="browse"; pmLoad(); };
    for(const r of P.querySelectorAll("[data-pmcat]")) r.onclick=()=>{ S.pm.cat=r.dataset.pmcat; S.pm.page=0; S.pm.view="browse"; pmPane(); pmLoad(); };
  } else if(tab==="pm-standing"){ const m=S.pm.mine, rt=m?.rating||{};
    // The sidebar: the short version, and what moves it
    P.innerHTML=m&&!m.error?`<div class="so-me"><div class="who" style="min-width:0"><b>${esc(m.me?.name||"You")}</b><div style="font-size:12.5px;margin-top:2px">${pmStars(m.rating)}</div></div>${m.agent?`<span class="pm-badge esc" style="margin-left:auto">Escrow agent</span>`:m.me?.trusted?`<span class="pm-badge ok" style="margin-left:auto">Trusted</span>`:""}</div>
      <div class="pm-cats"><div class="so-row"><div class="who"><b>Sold</b></div><span class="muted">${rt.sold||0}</span></div><div class="so-row"><div class="who"><b>Bought</b></div><span class="muted">${rt.bought||0}</span></div>
        <div class="so-row"><div class="who"><b>Ratings</b></div><span class="muted">${rt.count||0}</span></div></div>
      <div class="pm-rule">Your rating comes from the players you trade with: after a trade is finished, each side rates the other. It shows on your listings and your profile.</div>`
      :m?.error?`<div class="note" style="font-size:12.5px">${esc(m.error)}</div>`:`<div class="so-empty">Loading…</div>`;
  } else if(tab==="pm-mine"){ const m=S.pm.mine, ts=m?.trades||[];
    const n={todo:ts.filter(pmNeedsMe).length,open:ts.filter(t=>["requested","accepted","escrow"].includes(t.status)).length,done:ts.filter(t=>!["requested","accepted","escrow"].includes(t.status)).length,listings:(m?.listings||[]).length};
    P.innerHTML=`<div class="row" style="gap:8px;margin-bottom:10px"><button class="btn primary" style="flex:1" data-pmnewin="pm-items">+ Sell an item</button><button class="btn primary" style="flex:1" data-pmnewin="pm-services">+ Offer a service</button></div>
      <div class="pm-cats">${[["todo","Requests"],["open","Open trades"],["done","Finished trades"],["listings","My listings"],
        ...(S.pm.esc&&(S.pm.esc.is_agent||S.pm.esc.owner||S.pm.esc.trusted)?[["escrow",S.pm.esc.owner?"Escrow admin":S.pm.esc.is_agent?"Escrow agent":"Become an escrow agent"]]:[])].map(([k,t])=>`<div class="so-row click ${S.pm.filter===k?"on":""}" data-pmf="${k}"><div class="who"><b>${t}</b></div>${n[k]?`<span class="${k==="todo"?"so-n":"muted"}">${n[k]}</span>`:""}</div>`).join("")}</div>`;
    for(const r of P.querySelectorAll("[data-pmf]")) r.onclick=()=>{ S.pm.filter=r.dataset.pmf; S.pm.view="mine"; pmPane(); pmRender(); pmLoadMine(); };
  }
  for(const b of P.querySelectorAll("[data-pmnew]")) b.onclick=()=>pmNew();
  // From My Listings: open the right tab first, so an item is always listed under Items and a service under Services
  for(const b of P.querySelectorAll("[data-pmnewin]")) b.onclick=()=>{ document.querySelector(`.tab[data-tab="${b.dataset.pmnewin}"]`).click(); pmNew(); }; }
const pmNeedsMe=t=>["requested","accepted","escrow"].includes(t.status)&&t.actions.some(a=>a!=="cancel");

// ---- loading
async function pmLoad(){ const k=S.pm.kind, q=`browse?kind=${k}&sort=${S.pm.sort}&page=${S.pm.page}${S.pm.cat?"&cat="+encodeURIComponent(S.pm.cat):""}${S.pm.q.trim()?"&q="+encodeURIComponent(S.pm.q.trim()):""}`;
  S.pm.loading=true; if(S.pm.view==="browse") pmRender(); const r=await pmCall(q); S.pm.loading=false; if(S.pm.kind!==k) return;
  S.pm.data=r.ok?r:{error:r.error}; if(PM_TAB[S.tab]) pmPane(); if(S.pm.view==="browse") pmRender(); }
async function pmLoadMine(){ const r=await pmCall("mine"); S.pm.mine=r.ok?r:{error:r.error,signed_in:r.signed_in}; if(r.ok) pmTodo(r.todo);
  if(S.tab==="pm-mine"||S.tab==="pm-standing"){ pmPane(); if(S.pm.view==="mine") pmRender(); } return r; }
async function pmLoadEsc(){ const r=await pmCall("escrow"); S.pm.esc=r.ok?r:{error:r.error,signed_in:r.signed_in}; if(S.tab==="pm-mine"){ pmPane(); if(S.pm.filter==="escrow") pmRender(); } }
async function pmOpen(id){ S.pm.view="listing"; S.pm.listing={loading:true,id}; pmRender(); const r=await pmCall(`listing?id=${id}`);
  S.pm.listing=r.ok?{...r.listing,_min:r.escrow_min,_fee:r.escrow_fee}:{error:r.error}; S.pm.buy={qty:1,escrow:false,agent:"",note:""};
  S.pm.reporting=!!S.pmReportNext&&r.ok&&!r.listing.mine; S.pmReportNext=false;
  if(r.ok&&r.listing.escrow_ok&&!S.pm.esc) pmCall("escrow").then(x=>{ if(x.ok){ S.pm.esc=x; if(S.pm.view==="listing") pmRender(); } });
  pmRender(); }

// ---- main area
function pmRender(){ const P=$("pm-panel"); if(!P||!S.tab?.startsWith("pm-")) return;
  const v=S.pm.view; P.innerHTML=v==="listing"?pmListingHtml():v==="form"?pmFormHtml():v==="mine"?pmMineHtml():v==="escrow"?pmEscHtml():pmBrowseHtml();
  pmWire(P);
  if(v==="listing"&&S.pm.listing&&!S.pm.listing.loading&&!S.pm.listing.error) pmFillSpecs(S.pm.listing); }
const pmSignIn=what=>`<div class="so-land"><svg viewBox="0 0 24 24"><path d="M4 9l2-5h12l2 5M4 9h16v11H4zM9 13h6"/></svg><h2>Sign in to ${what}</h2><div>The marketplace goes with your Quantum account.</div><button class="btn primary" style="margin-top:14px" onclick="openProfileView('overview')">Sign in</button></div>`;
function pmBrowseHtml(){ const d=S.pm.data, svc=S.pm.kind==="service";
  const head=`<div class="pm-top"><h2>${S.pm.cat?esc(S.pm.cat):svc?"Services":"Items for sale"}</h2><span class="muted">${d&&!d.error?`${d.total} listing${d.total===1?"":"s"}`:""}${S.pm.q.trim()?` matching “${esc(S.pm.q.trim())}”`:""}</span></div>`;
  if(!d) return head+`<div class="so-empty">Loading…</div>`;
  if(d.error) return head+`<div class="note">${esc(d.error)}</div>`;
  if(!d.listings.length) return head+`<div class="so-land"><svg viewBox="0 0 24 24"><path d="M4 9l2-5h12l2 5M4 9h16v11H4zM9 13h6"/></svg><h2>Nothing here yet</h2><div>${svc?"Offer your crew's services: protection, hauling, mining, towing…":"Be the first to list something for sale."}</div><button class="btn primary" style="margin-top:14px" data-pmnew="1">${svc?"Offer a service":"Sell an item"}</button></div>`;
  return head+`<div class="pm-grid">${d.listings.map(l=>`<div class="pm-card" data-pmopen="${l.id}">${l.mine?"":`<button class="pm-flag" data-pmflag="${l.id}" title="Report this ${l.kind==="service"?"service":"listing"}" aria-label="Report">⚑</button>`}${pmPh(l.photo,l.category)}<div class="pm-cb"><b>${esc(l.title)}</b>${pmPrice(l)}
      ${(l.kind==="item"&&l.qty>1)||l.location?`<span class="muted" style="font-size:12px">${[l.location?"◆ "+esc(l.location):"",l.kind==="item"&&l.qty>1?`${l.qty.toLocaleString()} available`:""].filter(Boolean).join(" · ")}</span>`:""}
      <div class="pm-meta">${soAv(l.seller)}<span>${esc(l.seller.name)}</span>${pmStars(l.seller.rating)}</div></div></div>`).join("")}</div>
    ${d.pages>1?`<div class="row" style="justify-content:center;gap:8px;margin-top:16px"><button class="btn small" data-pmpage="-1" ${d.page<1?"disabled":""}>Previous</button><span class="muted">Page ${d.page+1} of ${d.pages}</span><button class="btn small" data-pmpage="1" ${d.page+1>=d.pages?"disabled":""}>Next</button></div>`:""}`; }
function pmListingHtml(){ const l=S.pm.listing, back=`<button class="btn small ghost" data-pmback="1" style="margin-bottom:14px">← Back to ${l?.kind==="service"?"services":"items"}</button>`;
  if(!l||l.loading) return back+`<div class="so-empty">Loading…</div>`; if(l.error) return back+`<div class="note">${esc(l.error)}</div>`;
  const s=l.seller, b=S.pm.buy||{}, qty=Math.max(1,Math.min(l.qty||1,+b.qty||1)), total=l.price*(l.kind==="item"?qty:1), escOk=l.unit!=="quote"&&total>=l._min;
  const agents=(S.pm.esc?.agents||[]).filter(a=>a.id!==s.id);
  let side;
  if(l.mine) side=`<div class="pm-box"><div class="k">Your listing</div><div>${l.status==="active"?`Up until ${new Date(l.expires*1000).toLocaleDateString([], {day:"numeric",month:"short"})}`:`<span class="pm-badge warn">${esc(l.status)}</span>`}${l.open_trades?` · <a data-pmgo="pm-mine" style="cursor:pointer;text-decoration:underline">${l.open_trades} open trade${l.open_trades>1?"s":""}</a>`:""}</div>
      <div class="pm-acts"><button class="btn small" data-pmedit="1">Edit</button>${l.status==="active"?`<button class="btn small ghost" data-pmclose="1">${S.pm.arm==="close"?"Sure? Click again":"Close listing"}</button>`:`<button class="btn small primary" data-pmrenew="1">Re-list</button>`}
        <button class="btn small danger" data-pmdel="1" ${l.open_trades?`disabled title="Finish or cancel its open trades first"`:""}>${S.pm.arm==="del"?"Delete for good? Click again":"Delete"}</button></div>
        ${l.delErr?`<div style="color:#ffb3b3;font-size:12.5px">Couldn't delete it: ${esc(l.delErr)}</div>`:""}</div>`;
  else if(l.status!=="active") side=`<div class="pm-box"><span class="pm-badge warn">This listing is ${esc(l.status)}</span></div>`;
  else side=`<div class="pm-box"><div class="k">${l.kind==="service"?"Request this service":"Buy"}</div>
      ${l.kind==="item"?`<label class="row" style="gap:8px;font-size:13px">Amount <input class="field" type="number" min="1" max="${l.qty}" value="${qty}" data-pmqty="1" style="width:110px"> <span class="muted">of ${l.qty.toLocaleString()}</span></label>`:""}
      ${l.unit!=="quote"?`<div class="pm-total"><span>Total</span><b>${pmA(total+(b.escrow&&escOk?l._fee:0))}</b></div>`:`<div class="muted" style="font-size:12.5px">The seller quotes a price for your job. Say what you need below.</div>`}
      ${escOk?`<label class="pm-chk"><input type="checkbox" data-pmesc="1" ${b.escrow?"checked":""}><span>Add escrow <span class="muted">(optional, +${pmA(l._fee)} paid by you)</span><br><span class="muted" style="font-size:12px">The agent holds the item and your aUEC until both of you have what you agreed.</span></span></label>
        ${b.escrow?`<select class="field" data-pmagent="1"><option value="">Any available agent</option>${agents.map(a=>`<option value="${a.id}" ${String(b.agent)===String(a.id)?"selected":""}>${esc(a.name)} · ${a.completed} completed</option>`).join("")}</select>`:""}`:""}
      <textarea class="field" rows="3" maxlength="500" data-pmnote="1" placeholder="${l.kind==="service"?"What you need, where and when":"Message to the seller (optional): where to meet, when…"}">${esc(b.note||"")}</textarea>
      <button class="btn primary" data-pmbuy="1">${l.kind==="service"?"Send request":"Ask to buy"}</button>
      <button class="btn" data-pmmsg="1">Message ${esc(s.name)}</button>
      <div class="muted" style="font-size:11.5px;line-height:1.45">Nothing is paid through Quantum: you meet in game and trade there. The seller accepts or declines first.</div></div>`;
  return back+`<div class="pm-detail"><div>${pmPh(l.photo,l.category)}<h2>${esc(l.title)}</h2><div>${pmPrice(l)}${l.kind==="item"?` <span class="muted" style="font-size:13px">· ${l.qty.toLocaleString()} available</span>`:""}</div>
      <div class="row" style="gap:6px;margin-top:8px;flex-wrap:wrap">${l.location?`<span class="pm-badge">◆ ${esc(l.location)}</span>`:""}<span class="pm-badge">${esc(l.category)}</span>${l.escrow_ok&&l.unit!=="quote"?`<span class="pm-badge esc">Escrow available</span>`:""}<span class="pm-badge">Listed ${soAgo(l.created)}</span></div>
      <div class="pm-desc">${esc(l.description||"No description.")}</div>
      ${l.kind==="item"?`<div id="pm-specs"></div>`:""}
      ${!l.mine?`<button class="btn small ghost" data-pmreport="1">⚑ Report this ${l.kind==="service"?"service":"listing"}</button>`:""}
      ${S.pm.reporting?`<div class="pm-box" style="margin-top:10px"><div class="k">Report</div><select class="field" data-pmrr="1">${[["real_money","Real-money trade"],["scam","Scam or fraud"],["offensive","Offensive"],["wrong_category","Wrong category"],["other","Something else"]].map(([v,t])=>`<option value="${v}">${t}</option>`).join("")}</select>
        <textarea class="field" rows="2" maxlength="500" data-pmrn="1" placeholder="Anything we should know (optional)"></textarea><div class="pm-acts"><button class="btn small danger" data-pmrsend="1">Send report</button><button class="btn small ghost" data-pmreport="1">Cancel</button></div></div>`:""}
      ${S.pm.esc?.owner&&!l.mine?`<div style="margin-top:10px"><button class="btn small danger" data-pmtake="1">${S.pm.arm==="take"?"Sure? Click again":"Take down (owner)"}</button></div>`:""}</div>
    <div style="display:flex;flex-direction:column;gap:12px">${side}
      <div class="pm-box"><div class="k">${l.kind==="service"?"Provider":"Seller"}</div><div class="pm-seller">${soAv(s,true)}<div class="who"><b class="up-name" data-upid="${esc(s.id||"")}" title="View profile">${esc(s.name)}</b><small>${pmStars(s.rating)} · ${s.rating?.sold||0} sold</small></div></div>
        <div class="row" style="gap:6px;flex-wrap:wrap">${s.trusted?`<span class="pm-badge ok">Trusted datarunner</span>`:""}${s.agent?`<span class="pm-badge esc">Escrow agent</span>`:""}${s.uex?`<span class="pm-badge">UEX: ${esc(s.uex)}</span>`:""}${s.org?`<span class="pm-badge">${esc(s.org)}</span>`:""}</div></div></div></div>`; }
function pmFormHtml(){ const f=S.pm.form, svc=f.kind==="service", cats=(svc?S.pm.mine?.service_cats:S.pm.mine?.item_cats)||PM_CATS[f.kind];
  if(S.pm.mine&&S.pm.mine.signed_in===false) return pmSignIn("sell on the marketplace");
  const units=svc?[["per job","Per job"],["per hour","Per hour"],["per SCU","Per SCU"],["per trip","Per trip"],["quote","Ask for a quote"]]:[];
  return `<button class="btn small ghost" data-pmback="1" style="margin-bottom:14px">← Cancel</button><div class="pm-top"><h2>${f.id?"Edit listing":svc?"Offer a service":"Sell an item"}</h2></div>
    <div class="pm-form">
      ${svc?"":pmLinkHtml(f)}
      <label class="wide">Title<input class="field" data-pmf="title" maxlength="80" value="${esc(f.title||"")}" placeholder="${svc?"e.g. Armed escort through Pyro":"e.g. Arclight pistol, Grade A quantum drive"}"></label>
      <label>Category<select class="field" data-pmf="category">${cats.map(c=>`<option ${f.category===c?"selected":""}>${esc(c)}</option>`).join("")}</select></label>
      <label>Location<input class="field" data-pmf="location" maxlength="80" value="${esc(f.location||"")}" placeholder="${svc?"e.g. Stanton, Pyro":"e.g. Area 18"}"></label>
      <label>Price in aUEC<input class="field" data-pmf="price" inputmode="numeric" value="${f.unit==="quote"?"":esc(f.price??"")}" ${f.unit==="quote"?"disabled placeholder='Quoted per job'":"placeholder='e.g. 45000'"}></label>
      ${svc?`<label>Priced<select class="field" data-pmf="unit">${units.map(([v,t])=>`<option value="${v}" ${f.unit===v?"selected":""}>${t}</option>`).join("")}</select></label>`
        :`<label>Amount for sale<input class="field" data-pmf="qty" type="number" min="1" value="${esc(f.qty??1)}"></label>`}
      <label class="wide">Description<textarea class="field" data-pmf="description" maxlength="3000" placeholder="${svc?"What you offer, your ships and crew, when you're available…":"Condition, grade, where to pick it up…"}">${esc(f.description||"")}</textarea></label>
      <div class="wide"><div class="pm-photo">${pmPh(f.photoData||f.photo)}<div style="display:flex;flex-direction:column;gap:6px"><b style="font-size:12.5px">Photo</b><span class="muted" style="font-size:12px">One picture. A screenshot from the game works best.</span>
        <div class="pm-acts"><button class="btn small" type="button" data-pmpick="1">${f.photoData||f.photo?"Change photo":"Add a photo"}</button>${f.photoData||f.photo?`<button class="btn small ghost" type="button" data-pmnophoto="1">Remove</button>`:""}</div>
        <input type="file" accept="image/png,image/jpeg,image/webp" data-pmfile="1" hidden></div></div></div>
      <div class="wide pm-rule" style="margin:0"><b>aUEC only.</b> Real money transactions are prohibited (dollars, PayPal, gift cards). These types of transactions break Star Citizen's Terms of Service. Listings which request this type of transaction will be taken down.</div>
      <div class="wide pm-acts"><button class="btn primary" data-pmsave="1" ${S.pm.saving?"disabled":""}>${S.pm.saving?"Saving…":f.id?"Save changes":"Publish listing"}</button>${S.pm.formErr?`<span style="color:#ffb3b3;font-size:12.5px">${esc(S.pm.formErr)}</span>`:""}</div></div>`; }
const PM_ACT={accept:["Accept","primary"],decline:["Decline","ghost"],cancel:["Cancel trade","ghost"],done:["Mark as done","primary"],
  item_in:["Item received from seller","primary"],pay_in:["Payment received from buyer","primary"],release:["Hand over and complete","primary"],refund:["Cancel and return everything","danger"]};
const PM_ARM=new Set(["decline","cancel","release","refund"]);
// After the stars: quick tags and a short review (like OfferUp). Shown on their profile with who left it.
function pmReviewForm(t,other){ const r=S.pm.rev?.[t.id]||{tags:[...(t.my_review?.tags||[])],note:t.my_review?.note||"",open:!(t.my_review?.note||t.my_review?.tags?.length)};
  (S.pm.rev=S.pm.rev||{})[t.id]=r;
  if(!r.open) return `<div class="pm-review-done"><span class="muted" style="font-size:12px">Your review${r.tags.length?`: ${r.tags.map(esc).join(" · ")}`:""}${r.note?` · “${esc(r.note)}”`:""}</span> <a data-pmrevedit="${t.id}" style="cursor:pointer;font-size:12px;text-decoration:underline">Change</a></div>`;
  return `<div class="pm-review"><div class="pm-tags">${(t.review_tags||[]).map(x=>`<button type="button" class="chip ${r.tags.includes(x)?"on":""}" data-pmrevtag="${esc(x)}" data-pmt="${t.id}">${esc(x)}</button>`).join("")}</div>
    <textarea class="field" rows="2" maxlength="300" data-pmrevnote="${t.id}" placeholder="A few words about trading with ${esc(other?.name||"them")} (optional)">${esc(r.note)}</textarea>
    <div class="pm-acts"><button class="btn small primary" data-pmrevsave="${t.id}">Post review</button><span class="muted" style="font-size:11.5px">Shown on ${esc(other?.name||"their")}'s profile with your name.</span></div></div>`; }
function pmStarsLine(rt){ if(!rt||rt.stars==null) return `<span class="muted">No ratings yet</span>`;
  return `${pmStars(rt)}${rt.as_seller?` <span class="muted" style="font-size:12px">· as seller ★ ${rt.as_seller.stars} (${rt.as_seller.count})</span>`:""}${rt.as_buyer?` <span class="muted" style="font-size:12px">· as buyer ★ ${rt.as_buyer.stars} (${rt.as_buyer.count})</span>`:""}`; }
function pmReviewsHtml(rt,list){ return `<div style="margin-bottom:8px">${pmStarsLine(rt)}${rt?.sold||rt?.bought?` <span class="muted" style="font-size:12px">· ${rt.sold||0} sold, ${rt.bought||0} bought</span>`:""}</div>
  ${rt?.tags?.length?`<div class="pm-tags" style="margin-bottom:8px">${rt.tags.map(([x,n])=>`<span class="chip">${esc(x)} <b>${n}</b></span>`).join("")}</div>`:""}
  ${(list||[]).map(v=>`<div class="pm-rev"><div class="row" style="gap:8px;align-items:center">${soAv(v.by)}<b class="up-name" data-upid="${esc(v.by?.id||"")}">${esc(v.by?.name||"")}</b><span style="color:#f2c14e">${"★".repeat(v.stars)}<span style="color:var(--line-2)">${"★".repeat(5-v.stars)}</span></span><span class="muted" style="font-size:12px;margin-left:auto">${v.as==="seller"?"Sold":"Bought"}: ${esc(v.title||"")} · ${soAgo(v.at)}</span></div>
    ${v.tags.length?`<div class="pm-tags" style="margin:4px 0 0 34px">${v.tags.map(x=>`<span class="chip">${esc(x)}</span>`).join("")}</div>`:""}${v.note?`<div style="margin:4px 0 0 34px;font-size:13px">“${esc(v.note)}”</div>`:""}</div>`).join("")||`<div class="muted" style="font-size:13px">No reviews yet.</div>`}`; }
function pmTradeHtml(t){ const other=t.role==="buyer"?t.seller:t.role==="seller"?t.buyer:null;
  const who=t.role==="buyer"?`Buying from <b>${esc(t.seller.name)}</b>`:t.role==="seller"?`Selling to <b>${esc(t.buyer.name)}</b>`:`Escrow for <b>${esc(t.seller.name)}</b> → <b>${esc(t.buyer.name)}</b>`;
  const stLabel={requested:["Waiting for the seller",""],accepted:["Meet in game","esc"],escrow:["In escrow","esc"],completed:["Complete","ok"],declined:["Declined","bad"],cancelled:["Cancelled","bad"],expired:["Expired","warn"]}[t.status]||[t.status,""];
  const steps=t.escrow?[["Requested",1],["Accepted",t.status!=="requested"],[`Item with ${t.agent?.name||"agent"}`,t.item_in],[`aUEC with ${t.agent?.name||"agent"}`,t.pay_in],["Complete",t.status==="completed"]]
    :[["Requested",1],["Accepted",t.status!=="requested"],["Buyer done",t.buyer_done],["Seller done",t.seller_done],["Complete",t.status==="completed"]];
  const live=["requested","accepted","escrow"].includes(t.status), cur=live?steps.findIndex(s=>!s[1]):-1;
  const msg=[other,...(t.role!=="agent"&&t.agent?[t.agent]:[]),...(t.role==="agent"?[t.buyer,t.seller]:[])].filter(Boolean);
  const hint=t.status==="requested"&&t.role==="seller"?"They're asking to buy. Accept to arrange the trade in game.":
    t.status==="accepted"?"Meet in game and trade. Each of you marks it done afterwards.":
    t.status==="escrow"&&t.role==="seller"&&!t.item_in?`Hand the item to ${esc(t.agent?.name)} in game.`:
    t.status==="escrow"&&t.role==="buyer"&&!t.pay_in?`Pay ${esc(t.agent?.name)} ${pmA(t.total+t.fee)} in game (price + escrow fee).`:
    t.status==="escrow"&&t.role==="agent"?(t.item_in&&t.pay_in?`Give the item to ${esc(t.buyer.name)} and ${pmA(t.total)} to ${esc(t.seller.name)}, then complete it.`:"Collect the item from the seller and the payment from the buyer."):"";
  return `<div class="pm-trade ${pmNeedsMe(t)?"todo":""}">${pmPh(t.photo)}<div style="min-width:0">
    <h3>${esc(t.title)}<span class="pm-badge ${stLabel[1]}">${stLabel[0]}</span>${t.escrow?`<span class="pm-badge esc">Escrow</span>`:""}</h3>
    <div class="sub">${who} · ${t.kind==="item"?`${t.qty} × `:""}${t.total?pmA(t.total):"Price to agree"}${t.fee?` + ${pmA(t.fee)} escrow fee`:""} · ${soAgo(t.updated)}</div>
    ${t.note?`<div class="muted" style="font-size:12.5px;margin-bottom:6px">“${esc(t.note)}”</div>`:""}
    ${live||t.status==="completed"?`<div class="pm-steps">${steps.map((s,i)=>`<span class="${s[1]?"on":i===cur?"cur":""}">${s[1]?"✓ ":""}${esc(s[0])}</span>`).join("")}</div>`:""}
    ${hint?`<div style="font-size:12.5px;margin-bottom:8px">${hint}</div>`:""}
    <div class="pm-acts">${t.actions.filter(a=>a!=="rate").map(a=>`<button class="btn small ${PM_ACT[a][1]}" data-pmact="${a}" data-pmt="${t.id}">${S.pm.arm===a+t.id?"Sure? Click again":PM_ACT[a][0]}</button>`).join("")}
      ${msg.map(p=>`<button class="btn small ghost" data-pmchat="${p.id}">Message ${esc(p.name)}</button>`).join("")}
      ${t.actions.includes("rate")?`<span class="pm-rate" title="Rate ${esc(other?.name||"")}">${[1,2,3,4,5].map(n=>`<button data-pmrate="${n}" data-pmt="${t.id}" class="${(t.my_rating||0)>=n?"on":""}">★</button>`).join("")}</span><span class="muted" style="font-size:12px">${t.my_rating?(t.my_review?.note||t.my_review?.tags?.length?"Thanks for your review":"Thanks for rating"):"Rate "+esc(other?.name||"them")}</span>`:""}</div>
    ${t.actions.includes("rate")&&t.my_rating?pmReviewForm(t,other):t.actions.includes("rate")&&t.status==="completed"?`<div class="pm-review-ask">How did it go with <b>${esc(other?.name||"them")}</b>? Your stars and a few words help other players know who to trade with.</div>`:""}
    <details class="pm-log"><summary>History</summary>${t.log.map(x=>`<div>${new Date(x.at*1000).toLocaleString([], {day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})} · ${esc([t.buyer,t.seller,t.agent].find(p=>p&&p.id===x.who)?.name||"")}: ${esc(x.text)}</div>`).join("")}</details></div></div>`; }
function pmMineHtml(){ const m=S.pm.mine; if(!m) return `<div class="so-empty">Loading…</div>`;
  if(m.signed_in===false||m.error==="Sign in to your Quantum account first.") return pmSignIn("trade on the marketplace");
  if(m.error) return `<div class="note">${esc(m.error)}</div>`;
  const f=S.pm.filter, open=t=>["requested","accepted","escrow"].includes(t.status);
  if(f==="escrow") return pmEscHtml();
  if(f==="standing") return pmStandingHtml(m);
  if(f==="listings") return `<div class="pm-top"><h2>My listings</h2><span class="muted">${m.listings.length}</span></div>`+(m.listings.length?`<div class="pm-mylist">${m.listings.map(l=>`<div class="pm-mini" data-pmopen="${l.id}">${pmPh(l.photo)}<div class="who"><b>${esc(l.title)}</b><small>${l.unit==="quote"?"Quote":pmA(l.price)} · ${l.status==="active"?`${l.kind==="item"?l.qty+" left · ":""}up`:esc(l.status)}</small></div></div>`).join("")}</div>`:`<div class="so-empty">You haven't listed anything yet.</div>`);
  const ts=m.trades.filter(f==="todo"?pmNeedsMe:f==="open"?open:t=>!open(t));
  const title={todo:"Requests",open:"Open trades",done:"Finished trades"}[f];
  return `<div class="pm-top"><h2>${title}</h2><span class="muted">${ts.length}</span></div>`+(ts.length?ts.map(pmTradeHtml).join(""):`<div class="so-empty">${f==="todo"?"No requests right now. Trades waiting on you (to accept, confirm or hand over) show up here.":"No trades here yet."}</div>`); }
// Your standing as a trader: what other players see when they decide whether to trade with you
function pmStandingHtml(m){ const rt=m.rating||{}, me=m.me||{};
  const badge=(ok,label,why)=>`<div class="pm-trust ${ok?"on":""}"><span>${ok?"✓":"·"}</span><div><b>${label}</b><small>${why}</small></div></div>`;
  const done=(m.trades||[]).filter(t=>t.status==="completed"&&t.actions.includes("rate")&&!t.my_rating).length;
  return `<div class="pm-top"><h2>Your standing</h2><span class="muted">What other players see on your listings and profile</span></div>
    <div class="pm-standing">
      <div class="pm-box"><div class="k">Rating</div><div class="pm-big">${rt.stars!=null?`<b>${rt.stars}</b><span style="color:#f2c14e">★</span><span class="muted">from ${plural(rt.count,"rating")}</span>`:`<span class="muted">No ratings yet: finish a trade and ask them to rate you.</span>`}</div>
        <div class="pm-split"><div><span>As a seller</span><b>${rt.as_seller?`★ ${rt.as_seller.stars} <small class="muted">(${rt.as_seller.count})</small>`:"–"}</b></div><div><span>As a buyer</span><b>${rt.as_buyer?`★ ${rt.as_buyer.stars} <small class="muted">(${rt.as_buyer.count})</small>`:"–"}</b></div>
          <div><span>Sold</span><b>${rt.sold||0}</b></div><div><span>Bought</span><b>${rt.bought||0}</b></div></div>
        ${rt.tags?.length?`<div class="pm-tags" style="margin-top:10px">${rt.tags.map(([x,n])=>`<span class="chip">${esc(x)} <b>${n}</b></span>`).join("")}</div>`:""}</div>
      <div class="pm-box"><div class="k">Trust</div>
        ${badge(true,"Quantum account","Signed in: every trade and review is tied to your account")}
        ${badge(!!me.trusted,"Trusted datarunner",me.trusted?"Earned by accurate price reports through Quantum":"Earned by sending accurate prices to UEX through Quantum")}
        ${badge(!!m.agent,"Escrow agent",m.agent?"You can hold items and aUEC for big trades":"Trusted datarunners can apply under Escrow")}
        ${badge((rt.count||0)>=5&&(rt.stars||0)>=4.5,"Well rated","5 or more ratings averaging 4.5 stars or better")}</div>
    </div>
    ${done?`<div class="note" style="margin:12px 0">You have ${plural(done,"finished trade")} to rate. <a data-pmf2="done" style="cursor:pointer;text-decoration:underline">Rate them</a></div>`:""}
    <div class="pm-sec">Latest reviews</div><div class="pm-box">${pmReviewsHtml(null,m.reviews).replace(/^<div style="margin-bottom:8px">[\s\S]*?<\/div>/,"")}</div>
    ${me.id?`<div style="margin-top:10px"><button class="btn small ghost" data-upid="${esc(me.id)}">See your profile as others do</button></div>`:""}`; }
function pmEscHtml(){ const e=S.pm.esc; if(!e) return `<div class="so-empty">Loading…</div>`;
  if(e.signed_in===false||e.error==="Sign in to your Quantum account first.") return pmSignIn("use escrow");
  if(e.error) return `<div class="note">${esc(e.error)}</div>`;
  let h=`<div class="pm-top"><h2>Escrow</h2><span class="muted">An optional add-on for trades of ${pmA(e.min)} or more</span></div>
    <div class="pm-esc-how"><div><b><i>1</i>Ask with escrow</b>Tick “Add escrow” when you ask to buy. The fee is ${pmA(e.fee)}, paid by the buyer.</div>
      <div><b><i>2</i>Seller → agent</b>Once the seller accepts, they hand the item to the agent in game.</div>
      <div><b><i>3</i>Buyer → agent</b>The buyer pays the agent the price plus the fee.</div>
      <div><b><i>4</i>Agent hands over</b>The agent gives the buyer the item and the seller the aUEC, and completes the trade.</div></div>`;
  const mine=(S.pm.mine?.trades||[]).filter(t=>t.role==="agent");
  if(e.is_agent){ h+=`<div class="pm-sec">Trades you're handling<span class="pm-badge esc">You're an escrow agent</span></div>`+(mine.filter(t=>["requested","accepted","escrow"].includes(t.status)).map(pmTradeHtml).join("")||`<div class="so-empty">No escrow trades right now.</div>`); }
  else { const a=e.application;
    h+=`<div class="pm-sec">Become an escrow agent</div><div class="pm-box" style="max-width:640px">`+(a&&a.status==="pending"?`<div>Your application is <span class="pm-badge warn">waiting for review</span> (sent ${soAgo(a.at)}).</div>`
      :e.trusted?`${a&&a.status==="declined"?`<div class="muted" style="font-size:12.5px">Your last application was declined. You can apply again.</div>`:""}<div style="font-size:13px">Trusted datarunners can apply. Tell us about yourself: your experience trading, when you play, your org.</div>
        <textarea class="field" rows="4" maxlength="1000" data-pmapply="1" placeholder="Why you'd make a good escrow agent"></textarea><div><button class="btn primary small" data-pmapplysend="1">Apply</button></div>`
      :`<div style="font-size:13px">Escrow agents are trusted datarunners. ${e.linked?"Keep sending accurate prices to UEX through Quantum to earn trusted status, then apply here.":"Link your UEX name in your profile and earn trusted status by datarunning through Quantum, then apply here."}</div>`)+`</div>`; }
  if(e.owner){ h+=`<div class="pm-sec">Owner: applications <span class="muted">${e.queue.length}</span></div>`+(e.queue.length?e.queue.map(q=>`<div class="pm-box" style="max-width:760px;margin-bottom:10px"><div class="pm-seller">${soAv(q.who)}<div class="who"><b>${esc(q.who.name)}</b><small>${pmStars(q.who.rating)} · applied ${soAgo(q.at)}${q.who.uex?` · UEX: ${esc(q.who.uex)}`:""}</small></div></div>
        ${q.message?`<div style="white-space:pre-wrap;font-size:13px">${esc(q.message)}</div>`:""}<div class="pm-acts"><button class="btn small primary" data-pmdecide="1" data-id="${q.id}">Approve</button><button class="btn small ghost" data-pmdecide="0" data-id="${q.id}">Decline</button><button class="btn small ghost" data-pmchat="${q.who.id}">Message</button></div></div>`).join(""):`<div class="so-empty">No applications waiting.</div>`);
    h+=`<div class="pm-sec">Owner: agents</div><div class="pm-box" style="max-width:760px">${e.agents.map(a=>`<div class="pm-seller">${soAv(a)}<div class="who" style="flex:1"><b>${esc(a.name)}</b><small>${a.completed} completed · ${a.open} open</small></div>${a.id!==S.so.st?.me?.id?`<button class="btn small ghost" data-pmunagent="${a.id}">${S.pm.arm==="un"+a.id?"Sure? Click again":"Remove"}</button>`:`<span class="muted" style="font-size:12px">You</span>`}</div>`).join("")}
      <div class="row" style="gap:8px"><input class="field" data-pmappoint="1" placeholder="@username of someone to appoint" style="flex:1"><button class="btn small primary" data-pmappointgo="1">Appoint</button></div></div>`;
    h+=`<div class="pm-sec">Owner: reported listings <span class="muted">${e.reports.length}</span></div>`+(e.reports.length?`<div class="pm-box" style="max-width:760px">${e.reports.map(r=>`<div class="row" style="gap:8px;flex-wrap:wrap"><span class="pm-badge ${r.reason==="real_money"||r.reason==="scam"?"bad":"warn"}">${esc(r.reason.replace("_"," "))}</span><a style="cursor:pointer;text-decoration:underline" data-pmopen="${r.listing}">${esc(r.title)}</a><span class="muted" style="font-size:12px">${esc(r.status)} · ${soAgo(r.at)}${r.note?` · “${esc(r.note)}”`:""}</span></div>`).join("")}</div>`:`<div class="so-empty">No reports.</div>`); }
  return h; }

// ---- Items linked to Gear: a seller picks what they're selling from the Gear tabs, and its picture and stats
// go on the listing (their title, price, description and meeting place stay their own). The link is sent as
// item_ref {tab, uuid, name}; listings without one (older ones) are matched by the Gear name in their title.
const PM_GEAR_TABS=["weapons","armor","gadgets","clothing","consumables","utility"];
// The marketplace category a Gear tab's items go under
const pmGearCat=(tab,i)=>tab==="consumables"?(i?.kind==="Medical"?"Medical":"Food and drink")
  :({weapons:"Weapons",armor:"Armor",clothing:"Clothing",gadgets:"Gadgets and tools",utility:"Other"})[tab]||"Other";
// And back: the Gear tabs to look in for a listing of a category that has no link
const PM_CAT_GEAR={Weapons:["weapons"],Armor:["armor"],Clothing:["clothing"],"Gadgets and tools":["gadgets"],Medical:["consumables"],"Food and drink":["consumables"]};
const pmGearImg=(i,name)=>i?.image?`<img src="${esc(i.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">`:PM_ICON;
function pmGearSearch(q){ const words=q.toLowerCase().split(/\s+/).filter(Boolean), ql=q.trim().toLowerCase(); if(!words.length) return [];
  const out=[];
  for(const tab of PM_GEAR_TABS) for(const i of grState(tab).data?.items||[]){
    const t=`${i.name} ${i.maker||""} ${i.maker_code||""} ${GEAR[tab].cat(i)}`.toLowerCase(); if(words.every(w=>t.includes(w))) out.push({tab,i}); }
  const n=x=>x.i.name.toLowerCase();
  out.sort((a,b)=>(n(b).startsWith(ql))-(n(a).startsWith(ql))||(b.i.base?1:0)-(a.i.base?1:0)||n(a).length-n(b).length||n(a).localeCompare(n(b)));
  return out.slice(0,14); }
function pmLinkHtml(f){ const r=f.item_ref;
  if(r&&GEAR[r.tab]){ const g=glFind(r.tab,r), G=GEAR[r.tab], own=(f.photoData||f.photo)&&!f.photoFromGear;
    return `<div class="wide pm-link on"><div class="pm-link-ph" data-gpic="${esc(r.name)}">${pmGearImg(g)}</div>
      <div class="who"><span class="k">Linked from Gear</span><b>${esc(r.name)}</b><small>${esc([g?.maker,g?G.cat(g):G.title,g&&G.key(g)].filter(Boolean).join(" · "))}</small>
        <small style="display:block;margin-top:2px">Its picture and stats show on your listing. Selling a custom or modified one? Say how in the description.</small></div>
      <div class="pm-acts">${own?`<button class="btn small" type="button" data-pmgearpic="1">Use its picture</button>`:""}<button class="btn small ghost" type="button" data-pmunlink="1">Unlink</button></div></div>`; }
  return `<div class="wide pm-link"><label>What are you selling? <span class="muted" style="font-weight:400;font-size:12px">Optional. Pick it from Gear and its picture and stats go on your listing; the title, price, description and where to meet stay yours.</span>
      <input class="field" data-pmlinkq="1" placeholder="Search Gear, e.g. Arclight, ADP core, MedPen" value="${esc(S.pm.linkQ||"")}" autocomplete="off" spellcheck="false"></label>
    <div class="pm-link-res" data-pmlinkres="1"></div></div>`; }
async function pmLinkResults(P){ const box=P.querySelector("[data-pmlinkres]"); if(!box) return; const q=(S.pm.linkQ||"").trim();
  if(q.length<2){ box.innerHTML=""; return; }
  if(PM_GEAR_TABS.some(t=>!grState(t).data)){ box.innerHTML=`<div class="muted" style="font-size:12.5px;padding:6px 2px">Loading Gear…</div>`;
    await Promise.all(PM_GEAR_TABS.map(t=>glData(t).catch(()=>[]))); if(!box.isConnected||(S.pm.linkQ||"").trim()!==q) return; }
  const hits=pmGearSearch(q);
  box.innerHTML=hits.length?hits.map(({tab,i})=>`<div class="pm-link-row" data-pmlinktab="${esc(tab)}" data-pmlinkid="${esc(i.uuid||i.name)}"><div class="pm-link-ph" data-gpic="${esc(i.name)}">${pmGearImg(i)}</div>
      <div class="who"><b>${esc(i.name)}</b><small>${esc([GEAR[tab].title,i.maker,GEAR[tab].cat(i),GEAR[tab].key(i)].filter(Boolean).join(" · "))}</small></div></div>`).join("")
    :`<div class="muted" style="font-size:12.5px;padding:6px 2px">Nothing in Gear matches “${esc(q)}”. You can still list it without linking.</div>`;
  for(const r of box.querySelectorAll("[data-pmlinktab]")) r.onclick=()=>pmLinkPick(r.dataset.pmlinktab,r.dataset.pmlinkid);
  fillGearPictures(box); }
function pmLinkPick(tab,id){ const f=S.pm.form; if(!f) return; const i=(grState(tab).data?.items||[]).find(x=>(x.uuid||x.name)===id); if(!i) return;
  f.item_ref={tab,uuid:i.uuid||null,name:i.name}; S.pm.linkQ="";
  if(!String(f.title||"").trim()) f.title=i.name;
  const cat=pmGearCat(tab,i), cats=S.pm.mine?.item_cats||PM_CATS.item; if(cats.includes(cat)) f.category=cat;
  pmRender();
  if(!f.photoData&&!f.photo) pmGearPic(f,i); }
// The item's Gear picture as the listing's photo (downloaded by the app and sent like an uploaded one)
async function pmGearPic(f,i){ const url=i.image||S.gpics?.[i.name]||null; let r; try{ r=await api().gear_photo(i.name,url); }catch(e){ r=null; }
  if(S.pm.form!==f||f.item_ref?.name!==i.name) return;
  if(!r?.ok) return toast(r?.error?`No picture added: ${r.error}. You can add your own.`:"Couldn't get its picture. You can add your own.");
  try{ f.photoData=await pmShrink(r.data); f.photoFromGear=true; f.photoRemove=false; if(S.pm.view==="form"&&S.pm.form===f) pmRender(); }catch(_){} }
// The Gear item a listing is about: the one its seller linked, else the longest Gear name in its title
async function pmGearFor(l){ const ref=l.item_ref;
  if(ref?.tab&&GEAR[ref.tab]){ await glData(ref.tab); const i=glFind(ref.tab,ref); return i?{tab:ref.tab,i,linked:true}:null; }
  const tabs=l.kind==="item"?PM_CAT_GEAR[l.category]:null; if(!tabs) return null;
  await Promise.all(tabs.map(glData));
  const t=` ${String(l.title||"").toLowerCase().replace(/[^a-z0-9"'-]+/g," ")} `; let best=null;
  for(const tab of tabs) for(const i of grState(tab).data?.items||[]){
    // "Arclight Pistol" is found in "Custom Arclight" too: the kind word at the end is optional
    const full=i.name.toLowerCase(), core=full.replace(/\s+(pistol|rifle|sniper rifle|smg|shotgun|lmg|launcher|railgun|helmet|core|arms|legs|backpack)$/,"");
    const hit=[full,core].find(n=>n.length>=4&&t.includes(` ${n} `)); if(!hit) continue;
    if(!best||hit.length>best.len||(hit.length===best.len&&i.base&&!best.i.base)) best={tab,i,linked:false,len:hit.length}; }
  return best; }
async function pmFillSpecs(l){ if(l.kind!=="item") return;
  if(l._gear===undefined){ l._gear=false; let g=null; try{ g=await pmGearFor(l); }catch(e){} l._gear=g; if(S.pm.listing!==l) return; }
  else if(l._gear===false) return;                     // still looking: painted when it's found
  const box=$("pm-specs"), g=l._gear; if(!box) return; if(!g){ box.innerHTML=""; return; }
  const rows=grSpecPairs(g.tab,g.i), price=grPrice(g.i);
  box.innerHTML=`<div class="pm-box pm-specs"><div class="row" style="gap:8px;align-items:center"><span class="k">${g.linked?"Specs":"Specs (matched by title)"}</span><span class="spacer"></span><button class="btn small ghost" data-pmgear="1">Open in Gear</button></div>
    <div class="pm-spec-name"><b>${esc(g.i.name)}</b><small>${esc([g.i.maker,GEAR[g.tab].cat(g.i)].filter(Boolean).join(" · "))}</small></div>
    ${rows.length?`<div class="pm-spec-grid">${rows.map(([a,b])=>`<div><span>${esc(a)}</span><b>${esc(String(b))}</b></div>`).join("")}</div>`:`<div class="muted" style="font-size:12.5px">No numbers on the wiki for this one.</div>`}
    <div class="muted" style="font-size:11.5px;line-height:1.45">${price!=null?`Sold in shops from ${money(price)}. `:"Not sold in shops. "}Stock stats from the Star Citizen Wiki${g.linked?"":`, for the item named in the title`}: a custom or modified one can differ, so ask the seller.</div></div>`;
  box.querySelector("[data-pmgear]").onclick=()=>{ const t=document.querySelector(`.tab[data-tab="${g.tab}"]`); if(!t) return; t.click();
    setTimeout(()=>{ const st=grState(g.tab); if(g.tab==="armor") st.view="items"; if(st.data) grOpenItem(g.tab,g.i.uuid||g.i.name,null); },250); };
  // No photo of the seller's own: the item's picture
  const ph=document.querySelector("#pm-panel .pm-detail .pm-ph");
  if(!l.photo&&ph&&!ph.querySelector("img")){ let u=g.i.image||S.gpics?.[g.i.name]; if(!u){ try{ u=await api().gear_image(g.i.name); }catch(e){} }
    if(u&&S.pm.listing===l&&ph.isConnected&&!ph.querySelector("img")){ ph.querySelector("svg")?.remove(); ph.insertAdjacentHTML("afterbegin",`<img src="${esc(u)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">`); } } }

// ---- actions
function pmNew(){ const kind=S.tab==="pm-services"?"service":"item";
  S.pm.form={kind,title:"",category:"",description:"",price:"",unit:kind==="service"?"per job":"each",qty:1,location:"",item_ref:null}; S.pm.formErr=null; S.pm.view="form"; S.pm.linkQ="";
  if(!S.pm.mine) pmLoadMine().then(()=>{ if(S.pm.view==="form") pmRender(); }); pmRender(); }
function pmArm(key,fn){ if(S.pm.arm===key){ S.pm.arm=null; return fn(); } S.pm.arm=key; pmRender(); setTimeout(()=>{ if(S.pm.arm===key){ S.pm.arm=null; pmRender(); } },3500); }
// A banner: any picture, cropped from its middle to the banner's shape (15:4, like 1500 × 400) and sized 600 to
// 1800 pixels across, so the server never turns one down for its shape
const OG_BANNER_RATIO=3.75;
function ogShrinkWide(file){ return new Promise((res,rej)=>{ const img=new Image(), u=URL.createObjectURL(file);
  img.onload=()=>{ let sw=img.width, sh=Math.round(img.width/OG_BANNER_RATIO);
    if(sh>img.height){ sh=img.height; sw=Math.round(img.height*OG_BANNER_RATIO); }
    const sx=Math.round((img.width-sw)/2), sy=Math.round((img.height-sh)/2);
    const W=Math.max(600,Math.min(1800,sw)), c=document.createElement("canvas"); c.width=W; c.height=Math.round(W/OG_BANNER_RATIO);
    c.getContext("2d").drawImage(img,sx,sy,sw,sh,0,0,c.width,c.height); URL.revokeObjectURL(u); res(c.toDataURL("image/jpeg",0.88)); };
  img.onerror=()=>{ URL.revokeObjectURL(u); rej(); }; img.src=u; }); }
// A picture for a listing, sized down to 1280 pixels at most. file: a picked file, or a data: URL (a Gear picture)
function pmShrink(file){ return new Promise((res,rej)=>{ const img=new Image(), own=typeof file!=="string", u=own?URL.createObjectURL(file):file;
  img.onload=()=>{ const k=Math.min(1,1280/Math.max(img.width,img.height)), c=document.createElement("canvas"); c.width=Math.round(img.width*k); c.height=Math.round(img.height*k);
    const g=c.getContext("2d"); if(!own){ g.fillStyle="#0c1629"; g.fillRect(0,0,c.width,c.height); }      // see-through wiki pictures: no black background
    g.drawImage(img,0,0,c.width,c.height); if(own) URL.revokeObjectURL(u); res(c.toDataURL("image/jpeg",0.86)); };
  img.onerror=()=>{ if(own) URL.revokeObjectURL(u); rej(); }; img.src=u; }); }
function pmWire(P){
  const on=(sel,fn)=>{ for(const el of P.querySelectorAll(sel)) el.onclick=e=>fn(el,e); };
  on("[data-pmopen]",el=>pmOpen(+el.dataset.pmopen));
  on("[data-pmflag]",(el,e)=>{ e.stopPropagation(); S.pmReportNext=true; pmOpen(+el.dataset.pmflag); }); on("[data-pmnew]",()=>pmNew());
  on("[data-pmback]",()=>{ S.pm.view=PM_TAB[S.tab]?"browse":"mine"; S.pm.reporting=false; pmRender(); });
  on("[data-pmpage]",el=>{ S.pm.page=Math.max(0,S.pm.page+ +el.dataset.pmpage); pmLoad(); $("pm-panel").scrollTop=0; });
  on("[data-pmgo]",el=>document.querySelector(`.tab[data-tab="${el.dataset.pmgo}"]`)?.click());
  on("[data-pmchat]",el=>soOpen(el.dataset.pmchat));
  // listing page
  const qtyIn=P.querySelector("[data-pmqty]"); if(qtyIn) qtyIn.onchange=()=>{ S.pm.buy.qty=+qtyIn.value||1; pmRender(); };
  const escIn=P.querySelector("[data-pmesc]"); if(escIn) escIn.onchange=()=>{ S.pm.buy.escrow=escIn.checked; pmRender(); };
  const agIn=P.querySelector("[data-pmagent]"); if(agIn) agIn.onchange=()=>{ S.pm.buy.agent=agIn.value; };
  const noteIn=P.querySelector("[data-pmnote]"); if(noteIn) noteIn.oninput=()=>{ S.pm.buy.note=noteIn.value; };
  on("[data-pmbuy]",async el=>{ const l=S.pm.listing, b=S.pm.buy; el.disabled=true;
    const r=await pmCall("buy",{listing:l.id,qty:+b.qty||1,escrow:!!b.escrow,agent:b.agent||null,note:b.note||""}); el.disabled=false;
    if(!r.ok) return toast(r.signed_in===false?"Sign in to your Quantum account to buy":r.error);
    toast(r.trade.escrow?`Request sent. ${r.trade.agent.name} will handle the escrow once ${r.trade.seller.name} accepts.`:`Request sent to ${r.trade.seller.name}`);
    S.pm.filter="open"; await pmLoadMine(); document.querySelector('.tab[data-tab="pm-mine"]').click(); });
  on("[data-pmmsg]",async el=>{ el.disabled=true; const r=await pmCall("contact",{listing:S.pm.listing.id}); el.disabled=false;
    if(!r.ok) return toast(r.signed_in===false?"Sign in to your Quantum account to message sellers":r.error); soOpen(r.with); });
  on("[data-pmreport]",()=>{ S.pm.reporting=!S.pm.reporting; pmRender(); });
  on("[data-pmrsend]",async()=>{ const r=await pmCall("report",{listing:S.pm.listing.id,reason:P.querySelector("[data-pmrr]").value,note:P.querySelector("[data-pmrn]").value});
    toast(r.ok?"Thanks. The Quantum team will take a look.":r.error); if(r.ok){ S.pm.reporting=false; pmRender(); } });
  on("[data-pmtake]",()=>pmArm("take",async()=>{ const r=await pmCall("remove",{id:S.pm.listing.id,reason:"Taken down by Quantum"}); toast(r.ok?"Listing taken down":r.error); if(r.ok){ S.pm.view="browse"; pmLoad(); pmLoadEsc(); } }));
  on("[data-pmedit]",()=>{ const l=S.pm.listing; S.pm.form={...l,photoData:null,_gear:undefined}; S.pm.linkQ=""; S.pm.formErr=null; S.pm.view="form"; if(!S.pm.mine) pmLoadMine().then(()=>pmRender()); pmRender(); });
  on("[data-pmclose]",()=>pmArm("close",async()=>{ const r=await pmCall("close",{id:S.pm.listing.id}); toast(r.ok?"Listing closed":r.error); if(r.ok){ pmOpen(S.pm.listing.id); pmLoad(); } }));
  on("[data-pmdel]",()=>pmArm("del",async()=>{ const r=await pmCall("delete",{id:S.pm.listing.id});
    if(!r.ok){ S.pm.listing.delErr=r.error==="Unknown request"?"This copy of Quantum can't delete listings yet: update app.py too (or rebuild the exe).":r.error; toast(S.pm.listing.delErr); return pmRender(); }
    toast("Listing deleted"); S.pm.data=null; pmLoad(); await pmLoadMine(); if(S.tab==="pm-mine"){ S.pm.filter="listings"; S.pm.view="mine"; pmPane(); pmRender(); } else { S.pm.view="browse"; pmRender(); } }));
  on("[data-pmrenew]",async()=>{ const r=await pmCall("renew",{id:S.pm.listing.id}); toast(r.ok?"Re-listed for 30 days":r.error); if(r.ok){ pmOpen(S.pm.listing.id); pmLoad(); } });
  // form
  const f=S.pm.form;
  for(const el of P.querySelectorAll("[data-pmf]")) el.oninput=el.onchange=()=>{ f[el.dataset.pmf]=el.value; if(el.dataset.pmf==="unit") pmRender(); };
  on("[data-pmpick]",()=>P.querySelector("[data-pmfile]").click());
  const fileIn=P.querySelector("[data-pmfile]"); if(fileIn) fileIn.onchange=async()=>{ const file=fileIn.files[0]; if(!file) return;
    try{ f.photoData=await pmShrink(file); f.photoFromGear=false; f.photoRemove=false; pmRender(); }catch(_){ toast("That file isn't a picture Quantum can read"); } };
  on("[data-pmnophoto]",()=>{ f.photoData=null; f.photo=null; f.photoFromGear=false; f.photoRemove=true; pmRender(); });
  // Linking the item from Gear
  const lq=P.querySelector("[data-pmlinkq]"); if(lq){ let t; lq.oninput=()=>{ S.pm.linkQ=lq.value; clearTimeout(t); t=setTimeout(()=>pmLinkResults(P),200); }; if(S.pm.linkQ) pmLinkResults(P); }
  on("[data-pmunlink]",()=>{ f.item_ref=null; if(f.photoFromGear){ f.photoData=null; f.photoFromGear=false; } pmRender(); });
  on("[data-pmgearpic]",()=>{ const r=f.item_ref, i=r&&glFind(r.tab,r); if(i) pmGearPic(f,i); });
  if(f?.item_ref&&GEAR[f.item_ref.tab]&&!grState(f.item_ref.tab).data&&!f._refLoad){ f._refLoad=1; glData(f.item_ref.tab).then(()=>{ if(S.pm.view==="form"&&S.pm.form===f) pmRender(); }); }
  on("[data-pmsave]",async()=>{ const cat=f.category||P.querySelector('[data-pmf="category"]')?.value;
    const body={kind:f.kind,title:f.title,category:cat,description:f.description,price:f.unit==="quote"?0:String(f.price||"").replace(/[^\d]/g,""),unit:f.kind==="service"?f.unit:"each",qty:f.qty,location:f.location,photo:f.photoData||null,photo_remove:!!f.photoRemove,
      item_ref:f.kind==="item"&&f.item_ref?{tab:f.item_ref.tab,uuid:f.item_ref.uuid||null,name:f.item_ref.name}:null};
    if(f.id) body.id=f.id; S.pm.saving=true; S.pm.formErr=null; pmRender();
    const r=await pmCall(f.id?"update":"create",body); S.pm.saving=false;
    if(!r.ok){ S.pm.formErr=r.signed_in===false?"Sign in to your Quantum account first.":r.error; return pmRender(); }
    toast(f.id?"Listing saved":"Your listing is up"); S.pm.kind=r.listing.kind; S.pm.data=null; pmLoad(); pmLoadMine(); pmOpen(r.listing.id); });
  // trades
  on("[data-pmact]",el=>{ const a=el.dataset.pmact, id=+el.dataset.pmt;
    const go=async()=>{ el.disabled=true; const r=await pmCall("trade",{id,action:a}); if(!r.ok){ el.disabled=false; return toast(r.error); }
      toast({accept:"Accepted",decline:"Declined",cancel:"Trade cancelled",done:"Marked as done",item_in:"Noted: item received",pay_in:"Noted: payment received",release:"Trade complete",refund:"Trade cancelled and returned"}[a]);
      await pmLoadMine(); };
    PM_ARM.has(a)?pmArm(a+id,go):go(); });
  on("[data-pmf2]",el=>{ S.pm.filter=el.dataset.pmf2; S.pm.view="mine"; if(S.tab!=="pm-mine") return document.querySelector('.tab[data-tab="pm-mine"]').click(); pmPane(); pmRender(); });
  on("[data-pmrate]",async el=>{ const r=await pmCall("rate",{trade:+el.dataset.pmt,stars:+el.dataset.pmrate}); if(!r.ok) return toast(r.error); toast("Thanks for rating. Add a few words if you like"); const rv=S.pm.rev?.[+el.dataset.pmt]; if(rv) rv.open=true; pmLoadMine(); });
  on("[data-pmrevtag]",el=>{ const r=S.pm.rev?.[+el.dataset.pmt]; if(!r) return; const x=el.dataset.pmrevtag; r.tags=r.tags.includes(x)?r.tags.filter(y=>y!==x):[...r.tags,x].slice(0,4); el.classList.toggle("on",r.tags.includes(x)); });
  for(const ta of P.querySelectorAll("[data-pmrevnote]")) ta.oninput=()=>{ const r=S.pm.rev?.[+ta.dataset.pmrevnote]; if(r) r.note=ta.value; };
  on("[data-pmrevedit]",el=>{ const r=S.pm.rev?.[+el.dataset.pmrevedit]; if(r){ r.open=true; pmRender(); } });
  on("[data-pmrevsave]",async el=>{ const id=+el.dataset.pmrevsave, r=S.pm.rev?.[id], t=(S.pm.mine?.trades||[]).find(x=>x.id===id); if(!r||!t) return;
    const res=await pmCall("rate",{trade:id,stars:t.my_rating||5,note:r.note.trim(),tags:r.tags}); if(!res.ok) return toast(res.error); r.open=false; toast("Review posted"); pmLoadMine(); });
  // escrow
  on("[data-pmapplysend]",async el=>{ el.disabled=true; const r=await pmCall("escrow/apply",{message:P.querySelector("[data-pmapply]").value}); el.disabled=false; toast(r.ok?"Application sent":r.error); if(r.ok) pmLoadEsc(); });
  on("[data-pmdecide]",async el=>{ const r=await pmCall("escrow/decide",{id:+el.dataset.id,approve:el.dataset.pmdecide==="1"}); toast(r.ok?(el.dataset.pmdecide==="1"?"Approved: they're an escrow agent now":"Declined"):r.error); pmLoadEsc(); });
  on("[data-pmappointgo]",async()=>{ const v=P.querySelector("[data-pmappoint]").value.trim(); if(!v) return; const r=await pmCall("escrow/appoint",{member:v}); toast(r.ok?"Appointed":r.error); if(r.ok) pmLoadEsc(); });
  on("[data-pmunagent]",el=>pmArm("un"+el.dataset.pmunagent,async()=>{ const r=await pmCall("escrow/remove",{member:el.dataset.pmunagent}); toast(r.ok?"No longer an escrow agent":r.error); pmLoadEsc(); }));
}
// The open trades refresh while Mine or Escrow is open (the other side may have moved them on)
setInterval(()=>{ if((S.tab==="pm-mine"||S.tab==="pm-standing")&&S.pm.view==="mine") pmLoadMine(); },10000);
