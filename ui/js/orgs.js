// Quantum UI: Orgs.
// One of several classic scripts sharing one global scope; index.html loads them in order.
"use strict";
// =================================================================== Org: player organisations (server: orgs.py)
S.og={mine:null,cur:null,view:null,tab:"overview",data:null,browse:null,q:"",form:null,month:null,ev:null,evForm:null,rankEdit:null,inviteQ:"",inviteRes:null,arm:null,todo:0};
const OG_PERM={members:"Members: invite, accept, rank and remove members below them",events:"Events: add, change and delete events",ranks:"Ranks: add, edit and reorder ranks below them",org:"Org: change the name, tag, logo, slogan and description"};
async function ogCall(path,body){ let r; try{ r=await api().org(path,body===undefined?null:body); }catch(e){ r={ok:false,error:"Couldn't reach Quantum"}; } return r; }
// An org's About page: the server keeps only a safe subset of HTML (server richtext.py); it's cleaned again here
// before it's drawn, the same way, so nothing but formatting, links and pictures ever reaches the page.
const RICH_TAGS=new Set("b strong i em u s strike del br p div span h1 h2 h3 h4 ul ol li blockquote hr a img center small sub sup code pre table thead tbody tr td th".split(" "));
const RICH_DROP=new Set("script style iframe object embed noscript template svg math textarea select button form head title link meta base".split(" "));
const RICH_IMG_HOSTS=["i.imgur.com","imgur.com","cdn.discordapp.com","media.discordapp.net","robertsspaceindustries.com","media.robertsspaceindustries.com","starcitizen.tools","media.starcitizen.tools","quantumsc.org"];
function richUrl(u,img,verified){ u=String(u||"").trim().replace(/^http:\/\//i,"https://"); if(!/^https:\/\/[A-Za-z0-9.\-]+(:\d+)?([\/?#][^\s"'<>`]*)?$/.test(u)) return null;
  if(img&&!verified){ const h=u.match(/^https:\/\/([^\/:?#]+)/)[1].toLowerCase(); if(!RICH_IMG_HOSTS.some(x=>h===x||h.endsWith("."+x))) return null; } return u; }
function richStyle(v){ return String(v||"").split(";").map(x=>{ const i=x.indexOf(":"); if(i<0) return null; const k=x.slice(0,i).trim().toLowerCase(), val=x.slice(i+1).trim();
    if(!["color","background-color","text-align","font-weight","font-style","text-decoration","font-size"].includes(k)||!val||val.length>40||/url\s*\(|expression|javascript|@import|\\|\/\*|[<>{}]/i.test(val)) return null; return `${k}: ${val}`; }).filter(Boolean).join("; "); }
function richSafe(html,verified,raw){ if(!html) return ""; const doc=new DOMParser().parseFromString(`<div>${html}</div>`,"text/html"), out=document.createElement("div");
  const BLOCK=/^(H[1-4]|P|DIV|UL|OL|LI|BLOCKQUOTE|TABLE|PRE|CENTER|HR)$/;
  const walk=(src,dst,inPre)=>{ for(const n of [...src.childNodes]){
      if(n.nodeType===3){ let t=n.nodeValue;
        // what you typed: a line break is a line break (as the server stores it), except the layout between tags
        if(raw&&!inPre&&t.trim()){ if(BLOCK.test(dst.lastChild?.nodeName||"")) t=t.replace(/^\r?\n/,"");
          t.split(/\r?\n/).forEach((part,i)=>{ if(i) dst.appendChild(document.createElement("br")); if(part) dst.appendChild(document.createTextNode(part)); }); continue; }
        dst.appendChild(document.createTextNode(t)); continue; }
      if(n.nodeType!==1) continue; const t=n.tagName.toLowerCase();
      if(RICH_DROP.has(t)) continue;
      if(!RICH_TAGS.has(t)){ walk(n,dst); continue; }
      let el;
      if(t==="a"){ const u=richUrl(n.getAttribute("href"),false,verified); if(!u||!verified){ el=document.createElement("span"); } else { el=document.createElement("a"); el.dataset.ogurl=u; el.title=u; } }
      else if(t==="img"){ const u=richUrl(n.getAttribute("src"),true,verified); if(!u) continue; el=document.createElement("img"); el.src=u; el.loading="lazy"; el.referrerPolicy="no-referrer"; el.alt=(n.getAttribute("alt")||"").slice(0,200);
        for(const k of ["width","height"]){ const v=n.getAttribute(k); if(/^\d{1,4}$/.test(v||"")) el.setAttribute(k,v); } }
      else el=document.createElement(t);
      const al=(n.getAttribute("align")||"").toLowerCase(); if(["left","right","center","justify"].includes(al)) el.setAttribute("align",al);
      const st=richStyle(n.getAttribute("style")); if(st) el.setAttribute("style",st);
      for(const k of ["colspan","rowspan","start"]){ const v=n.getAttribute(k); if(/^\d{1,3}$/.test(v||"")) el.setAttribute(k,v); }
      if(t!=="img") walk(n,el,inPre||t==="pre"); dst.appendChild(el); } };
  walk(doc.body.firstChild||doc.body,out,false); return out.innerHTML; }
function ogAboutHtml(o){ return o.about_html?`<div class="og-desc og-rich">${richSafe(o.about_html,o.verified)}</div>`
  :`<div class="og-desc">${o.description?ogLinks(o.description,o.verified):"No description yet."}</div>`; }
// Links in a verified org's description open in the browser (only verified orgs, so nobody can pose as a real org with a bad link)
function ogLinks(text,verified){ const t=esc(text||""); if(!verified) return t;
  return t.replace(/(?<![@\w.\/-])((?:https?:\/\/|www\.)[^\s<]+|(?:discord\.gg|discord\.com\/invite)\/[A-Za-z0-9-]+|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|net|gg|io|co|us|uk|de|eu|tv|app|dev|space|xyz|info|me)(?:\/[^\s<]*)?)/gi,
    m=>{ const clean=m.replace(/[.,;:!?)\]]+$/,""), rest=m.slice(clean.length), url=/^https?:\/\//i.test(clean)?clean.replace(/^http:/i,"https:"):"https://"+clean;
      return `<a class="og-link" data-ogurl="${url}" title="${url}">${clean}</a>${rest}`; }); }
const ogRankIcon=(r,size=22)=>r?.icon?`<img class="og-ricon" src="${esc(r.icon)}" alt="" style="width:${size}px;height:${size}px" onerror="this.remove()">`:"";
function ogIconFile(file){ return new Promise((res,rej)=>{ const img=new Image(), u=URL.createObjectURL(file);
  img.onload=()=>{ const n=128, c=document.createElement("canvas"); c.width=c.height=n; const k=Math.min(n/img.width,n/img.height), w=img.width*k, h=img.height*k;
    c.getContext("2d").drawImage(img,(n-w)/2,(n-h)/2,w,h); URL.revokeObjectURL(u); res(c.toDataURL("image/png")); };
  img.onerror=()=>{ URL.revokeObjectURL(u); rej(); }; img.src=u; }); }
// RSI's own mark (from the Star Citizen Wiki), in the theme's colour: links an org to its page on RSI
const RSI_ICON='<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M8.64 14.35c-.14 0-.27-.11-.31-.23l-.36-1.5 1.62-.81c.39-.19.72-.58.84-1.06l.56-2.14c.14-.53-.2-.97-.77-.97h-6l-2.23 8.75H4.1l.55-2.12 1.42-.72.52 2.11c.09.39.5.72.91.72h1.69l.52-2.02H8.65Zm-3.33-2.64.02-.06.5-1.98h2.44c.19 0 .31.08.27.22-.03.12-.12.27-.36.38l-2.86 1.45Zm11.61.91-3.39-2.25c-.19-.12-.27-.27-.22-.45.05-.19.19-.27.38-.27h3.17l.52-2.03h-4.89c-.42 0-.83.33-.92.72l-.48 1.92c-.09.39.09.91.44 1.14l3.42 2.28c.19.13.22.25.17.41-.03.13-.17.25-.38.25h-2.55l-.53 2.05h4.27c.42 0 .86-.33.95-.72l.48-1.91c.09-.39-.09-.92-.44-1.14m2.97-4.99h-.01l-2.26 8.75h2.15L22 7.63zm-8.8 6.72h-.34l-.53 2.03h.36zm-.7 0h-.34l-.53 2.03h.36l.53-2.03z"/><path d="M11.47 14.35h-.03l-.52 2.03h.36l.53-2.03zM19 9.66l.52-2.03h-.35l-.51 2.03zm-.7 0 .51-2.03h-.34l-.52 2.03zm-.18-2.03h-.37l-.53 2.03h.37z"/></svg>';
const ogVer=o=>o?.verified?`<span class="og-ver" title="Verified with RSI: the owner proved it's their org on robertsspaceindustries.com">✓ RSI</span>`:"";
const ogLogo=(o,sm)=>`<div class="og-logo${sm?" sm":""}">${o?.logo?`<img src="${esc(o.logo)}" alt="" onerror="this.remove()">`:esc((o?.tag||"?").slice(0,4))}</div>`;
function ogTodo(n){ S.og.todo=n; const b=$("rail-og-n"); if(b){ b.textContent=n; b.hidden=!n; }
  if(S.ogTodoSeen!==undefined&&n>S.ogTodoSeen) toast("Org: you have a new invitation or join request"); S.ogTodoSeen=n; }
const ogTime=t=>new Date(t*1000).toLocaleString([], {weekday:"short",day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"});
const ogDur=m=>m>=60?`${Math.floor(m/60)} h${m%60?` ${m%60} min`:""}`:`${m} min`;
async function openOrg(){ ogPane(); ogRender(); await ogLoadMine();
  if(!S.og.view){ const first=S.og.mine?.orgs?.[0]; if(first){ S.og.view="org"; ogOpen(first.id); } else { S.og.view="home"; ogRender(); } } else if(S.og.view==="org"&&S.og.cur) ogOpen(S.og.cur,true); }
async function ogLoadMine(){ const r=await ogCall("mine"); S.og.mine=r.ok?r:{error:r.error,signed_in:r.signed_in}; if(S.tab==="orgs") ogPane(); return r; }
async function ogOpen(id,quiet){ S.og.cur=id; S.og.view="org"; if(!quiet||S.og.data?.org?.id!==id){ S.og.data=null; S.og.ev=null; S.og.evForm=null; S.og.rankEdit=null; S.og.form=null; } ogPane(); ogRender();
  const r=await ogCall(`org?id=${id}`); if(S.og.cur!==id) return; S.og.data=r.ok?r:{error:r.error}; if(!r.ok&&r.error) toast(r.error);
  if(r.ok&&!r.member) S.og.tab="overview"; ogRender(); }
function ogApply(r){ if(r.ok&&r.org){ S.og.data=r; ogRender(); ogLoadMine(); } else if(!r.ok) toast(r.error); return r; }

// ---- sidebar
function ogPane(){ const P=$("pane-orgs"); if(!P) return; const m=S.og.mine;
  if(m&&(m.signed_in===false||m.error==="Sign in to your Quantum account first.")){ P.innerHTML=`<div class="note"><b>Sign in to use orgs</b><div class="muted" style="font-size:12.5px;margin:6px 0 10px">Orgs go with your Quantum account.</div><button class="btn primary small" onclick="openProfileView('overview')">Sign in</button></div>`; return; }
  if(m?.error){ P.innerHTML=`<div class="note">${esc(m.error)}</div>`; return; }
  const orgs=m?.orgs||[], inv=m?.invites||[], req=m?.requests||[];
  P.innerHTML=`<div class="row" style="gap:8px;margin-bottom:10px"><button class="btn primary" style="flex:1" data-ognew="1">+ Create an org</button><button class="btn" style="flex:1" data-ogfind="1">Find orgs</button></div>
    ${inv.length?`<div class="so-h">Invitations <b>${inv.length}</b></div>${inv.map(i=>`<div class="so-row">${ogLogo(i.org,1)}<div class="who"><b>${esc(i.org.name)} <span class="muted" style="font-weight:400">[${esc(i.org.tag)}]</span></b><small>${i.by?`From ${esc(i.by.name)} · `:""}${i.org.members} member${i.org.members===1?"":"s"}</small></div>
      <div class="acts"><button class="btn small primary" data-oginv="${i.id}" data-yes="1">Join</button><button class="btn small ghost" data-oginv="${i.id}" data-yes="0">Decline</button></div></div>`).join("")}`:""}
    <div class="so-h">My orgs <b>${orgs.length}</b></div>
    ${m?orgs.length?orgs.map(o=>`<div class="so-row click ${S.og.view==="org"&&S.og.cur===o.id?"on":""}" data-ogopen="${o.id}">${ogLogo(o,1)}<div class="who"><b>${esc(o.name)}${o.verified?` <span style="color:#9fe0b4" title="Verified with RSI">✓</span>`:""}</b><small>[${esc(o.tag)}] · ${esc(o.my_rank||"")}</small></div></div>`).join("")
      :`<div class="so-empty">You're not in an org yet. Create one, or find one to join.</div>`:`<div class="so-empty">Loading…</div>`}
    ${req.length?`<div class="so-h">Waiting to join</div>${req.map(r=>`<div class="so-row click" data-ogopen="${r.org.id}">${ogLogo(r.org,1)}<div class="who"><b>${esc(r.org.name)}</b><small>Request sent ${soAgo(r.at)}</small></div></div>`).join("")}`:""}`;
  for(const b of P.querySelectorAll("[data-ogopen]")) b.onclick=()=>{ S.og.tab="overview"; ogOpen(+b.dataset.ogopen); };
  for(const b of P.querySelectorAll("[data-ognew]")) b.onclick=()=>{ S.og.view="create"; S.og.form={name:"",tag:"",slogan:"",about:"",recruiting:true}; ogPane(); ogRender(); };
  for(const b of P.querySelectorAll("[data-ogfind]")) b.onclick=()=>{ S.og.view="browse"; ogPane(); ogRender(); ogBrowse(); };
  for(const b of P.querySelectorAll("[data-oginv]")) b.onclick=async()=>{ b.disabled=true; const yes=b.dataset.yes==="1"; const r=await ogCall("invite/respond",{id:+b.dataset.oginv,accept:yes});
    if(!r.ok) return toast(r.error); toast(yes?"Welcome aboard!":"Invitation declined"); await ogLoadMine(); if(yes){ S.og.tab="overview"; ogOpen(r.org); } }; }
async function ogBrowse(){ const q=S.og.q; const r=await ogCall("browse"+(q.trim()?"?q="+encodeURIComponent(q.trim()):"")); if(S.og.q!==q) return; S.og.browse=r.ok?r.orgs:{error:r.error}; if(S.og.view==="browse") ogRender(); }

// ---- main area
function ogRender(){ const P=$("og-panel"); if(!P||S.tab!=="orgs") return; const v=S.og.view;
  P.innerHTML=v==="create"?ogFormHtml(true):v==="browse"?ogBrowseHtml():v==="org"?ogOrgHtml():ogHomeHtml(); ogWire(P); }
function ogHomeHtml(){ const m=S.og.mine;
  if(m&&(m.signed_in===false||m.error==="Sign in to your Quantum account first.")) return `<div class="so-land" style="margin-top:12vh"><svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="5" rx="1.2"/><rect x="3" y="16" width="6" height="5" rx="1.2"/><rect x="15" y="16" width="6" height="5" rx="1.2"/><path d="M12 8v4M6 16v-4h12v4"/></svg><h2>Sign in to use orgs</h2><div>Create your org, invite your crew, set ranks and plan events.</div><button class="btn primary" style="margin-top:14px" onclick="openProfileView('overview')">Sign in</button></div>`;
  return `<div class="so-land" style="margin-top:12vh"><svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="5" rx="1.2"/><rect x="3" y="16" width="6" height="5" rx="1.2"/><rect x="15" y="16" width="6" height="5" rx="1.2"/><path d="M12 8v4M6 16v-4h12v4"/></svg><h2>Orgs</h2><div>Create your org with its logo, slogan and ranks, invite people on Quantum, and plan your ops on a shared calendar.</div>
    <div class="row" style="gap:8px;justify-content:center;margin-top:14px"><button class="btn primary" data-ognew2="1">Create an org</button><button class="btn" data-ogfind2="1">Find orgs</button></div></div>`; }
function ogBrowseHtml(){ const b=S.og.browse;
  return `<div class="og-body"><div class="pm-top"><h2>Find orgs</h2><span class="muted">${S.og.q.trim()?"Search results":"Verified orgs recruiting now"}</span></div>
    <div class="muted" style="font-size:12.5px;margin:-6px 0 12px">Only orgs verified with RSI are listed here. Other orgs invite people directly.</div>
    <input class="search" id="og-q" placeholder="Search by name, tag or slogan" value="${esc(S.og.q)}" style="max-width:520px;margin-bottom:14px" autocomplete="off" spellcheck="false">
    ${!b?`<div class="so-empty">Loading…</div>`:b.error?`<div class="note">${esc(b.error)}</div>`:b.length?`<div class="og-cards">${b.map(o=>`<div class="og-card" data-ogopen2="${o.id}">${ogLogo(o)}<div class="who"><b>${esc(o.name)} <span class="og-tag">${esc(o.tag)}</span> ${ogVer(o)}</b>${o.slogan?`<div class="og-slogan" style="font-size:13px">${esc(o.slogan)}</div>`:""}<small>${o.members} member${o.members===1?"":"s"}${o.member?" · You're a member":o.recruiting?" · Recruiting":" · Not recruiting"}</small></div></div>`).join("")}</div>`
      :`<div class="so-empty">${S.og.q.trim()?"No verified orgs match that.":"No verified orgs are recruiting yet."}</div>`}</div>`; }
function ogFormHtml(isNew){ const f=S.og.form||{};
  return `<div class="og-body">${isNew?`<button class="btn small ghost" data-ogback="1" style="margin-bottom:14px">← Cancel</button><div class="pm-top"><h2>Create an org</h2></div>`:""}
    ${isNew?`<div class="pm-box og-howto"><b>Org creations require verification through RSI's website</b>
      <div class="muted" style="font-size:12.5px;margin:4px 0 8px">Only orgs verified with RSI are listed as searchable, valid orgs in Quantum. Until it's verified your org still works, but people can only join by invitation.</div>
      <ol class="og-steps"><li>Your org needs to exist on RSI. Find its <b>SID</b>: the short ID at the end of its RSI address, <span class="og-mono">robertsspaceindustries.com/orgs/<b>SID</b></span>. Enter it below as the <b>Tag</b>.</li>
        <li>Fill in the rest and press <b>Create org</b>. Quantum gives you a code like <span class="og-mono">QUANTUM-ABCD1234</span> under your org's <b>Settings</b>.</li>
        <li>On RSI, edit your org (you need to be an admin there). Paste the code anywhere in the <b>Headline</b> (or the history, manifesto or charter) and save.</li>
        <li>Back in Quantum, press <b>Check now</b> under Settings. Once it's verified your org gets the ✓ RSI badge, shows up in Find orgs, and its name and tag are locked to your RSI org so nobody else can use them. You can then take the code off RSI.</li></ol></div>`:""}
    <div class="og-form">
      <label class="wide">Name<input class="field" data-ogf="name" maxlength="48" value="${esc(f.name||"")}" placeholder="e.g. Blue Sun Industries" ${f.verified?"disabled":""}></label>
      <label>${isNew?"Tag (your org's SID on RSI)":"Tag"}<input class="field" data-ogf="tag" maxlength="10" value="${esc(f.tag||"")}" placeholder="e.g. BSI" style="text-transform:uppercase" ${f.verified?"disabled":""}></label>
      ${f.verified?`<div class="wide muted" style="font-size:12px;margin-top:-6px">The name and tag come from your verified RSI org.</div>`:""}
      <label>Recruiting<select class="field" data-ogf="recruiting"><option value="1" ${f.recruiting!==false?"selected":""}>Yes: anyone can ask to join</option><option value="0" ${f.recruiting===false?"selected":""}>No: invite only</option></select></label>
      <label class="wide">Visibility<select class="field" data-ogf="listed"><option value="1" ${f.listed!==false?"selected":""}>Listed: people can find it in Find orgs (once it's verified)</option><option value="0" ${f.listed===false?"selected":""}>Private: hidden from Find orgs, join by invitation only</option></select></label>
      <label class="wide">Slogan<input class="field" data-ogf="slogan" maxlength="120" value="${esc(f.slogan||"")}" placeholder="One line people remember"></label>
      <div class="wide"><b style="font-size:12.5px">About the org</b> <span class="muted" style="font-size:12px">Write it like a normal message, or use the buttons (or HTML) for headings, bold, lists, links and pictures${f.verified?"":" from Imgur, Discord, RSI or the Star Citizen Wiki. Links become clickable once your org is verified with RSI"}.</span>
        <div class="og-rtb">${[["b","<b>B</b>","Bold"],["i","<i>I</i>","Italic"],["u","<u>U</u>","Underline"],["s","<s>S</s>","Strikethrough"],["h2","H2","Heading"],["h3","H3","Smaller heading"],["center","Centre","Centre"],["ul","• List","Bullet list"],["ol","1. List","Numbered list"],["blockquote","❝","Quote"],["a","Link","Link"],["img","Picture","Picture from a link"],["hr","―","Divider"],["color","Colour","Coloured text"]].map(([k,l,t])=>`<button class="btn small ghost" type="button" data-ogrt="${k}" title="${t}">${l}</button>`).join("")}</div>
        <textarea class="field og-rich-edit" data-ogf="about" maxlength="20000" placeholder="What you do, when you play, what you expect from members…">${esc(f.about||"")}</textarea>
        <div class="muted" style="font-size:11.5px;margin:6px 0 4px">Preview</div><div class="og-rich-prev og-rich" id="og-rich-prev">${richSafe(f.about||"",f.verified,true)||'<span class="muted">Nothing yet.</span>'}</div></div>
      ${isNew?"":`<div class="wide"><b style="font-size:12.5px">Banner</b> <span class="muted" style="font-size:12px">One wide picture across the top of your org's page. Saved as soon as you pick it.</span>
        ${f.bannerPreview||f.banner?`<div class="og-banner og-banner-prev${S.og.banSaving?" saving":""}" style="background-image:url('${esc(f.bannerPreview||f.banner)}')"></div>`
          :`<div class="og-banner-empty" data-ogbanpick="1">No banner yet: click to choose a picture. Any picture works; it's cropped from the middle to banner shape.</div>`}
        <div class="pm-acts"><button class="btn small" type="button" data-ogbanpick="1" ${S.og.banSaving?"disabled":""}>${S.og.banSaving?`<span class="spin-sm"></span>Uploading…`:f.banner?"Change banner":"Upload a banner"}</button>${f.banner&&!S.og.banSaving?`<button class="btn small ghost" type="button" data-ognoban="1">Remove</button>`:""}
          ${S.og.banMsg?`<span style="font-size:12.5px;color:${S.og.banMsg.ok?"#9fe0b4":"#ffb3b3"}">${esc(S.og.banMsg.text)}</span>`:""}</div>
        <input type="file" accept="image/png,image/jpeg,image/webp" data-ogbanfile="1" hidden></div>`}
      <div class="wide"><div class="pm-photo">${ogLogo({logo:f.logoData||f.logo,tag:f.tag||"?"})}<div style="display:flex;flex-direction:column;gap:6px"><b style="font-size:12.5px">Logo</b><span class="muted" style="font-size:12px">A square picture works best.</span>
        <div class="pm-acts"><button class="btn small" type="button" data-ogpick="1">${f.logoData||f.logo?"Change logo":"Upload a logo"}</button>${f.logoData||f.logo?`<button class="btn small ghost" type="button" data-ognologo="1">Remove</button>`:""}</div>
        <input type="file" accept="image/png,image/jpeg,image/webp" data-ogfile="1" hidden></div></div></div>
      <div class="wide pm-acts"><button class="btn primary" data-ogsave="1" ${S.og.saving?"disabled":""}>${S.og.saving?"Saving…":isNew?"Create org":"Save changes"}</button>${S.og.formErr?`<span style="color:#ffb3b3;font-size:12.5px">${esc(S.og.formErr)}</span>`:""}</div></div></div>`; }
function ogOrgHtml(){ const d=S.og.data; if(!d) return `<div class="og-body"><div class="so-empty">Loading…</div></div>`;
  if(d.error) return `<div class="og-body"><div class="note">${esc(d.error)}</div></div>`;
  const o=d.org, perms=new Set(d.perms||[]), now=Date.now()/1000;
  const up=(d.events||[]).filter(e=>e.starts+(e.minutes||60)*60>now), online=(d.members||[]).filter(m=>m.online).length;
  const hero=`${o.banner?`<div class="og-banner" style="background-image:url('${esc(o.banner)}')"></div>`:""}<div class="og-hero">${ogLogo(o)}<div style="min-width:0"><h2>${esc(o.name)} <span class="og-tag">${esc(o.tag)}</span>${ogVer(o)}</h2>${o.slogan?`<div class="og-slogan">${esc(o.slogan)}</div>`:""}
    <div class="og-stats"><span><b>${o.members}</b> member${o.members===1?"":"s"}</span>${d.member?`<span><b>${online}</b> online</span><span>Your rank: ${ogRankIcon((d.ranks||[]).find(r=>r.id===d.my_rank),16)} <b>${esc(o.my_rank||"")}</b>${perms.has("owner")?" · Owner":""}</span>${up[0]?`<span>Next: <b>${esc(up[0].title)}</b> ${ogTime(up[0].starts)}</span>`:""}`:`<span>${o.recruiting?"Recruiting":"Invite only"}</span>`}</div></div>
    ${o.verified&&o.rsi_url?`<div class="og-rsi"><button class="btn og-rsi-btn" data-ogurl="${esc(o.rsi_url)}" title="View ${esc(o.tag)} on RSI" aria-label="View ${esc(o.tag)} on RSI">${RSI_ICON}</button>${!d.member&&o.recruiting?`<span class="muted">Apply on RSI too, so you show in their roster in game</span>`:""}</div>`:""}</div>`;
  if(!d.member) return hero+`<div class="og-body"><div class="og-grid2"><div><div class="pm-sec" style="margin-top:0">About</div>${ogAboutHtml(o)}
      ${d.ranks?.length?`<div class="pm-sec">Ranks</div>${d.ranks.map(r=>`<div class="og-rank"><div class="top">${ogRankIcon(r,28)}<b>${esc(r.name)}</b></div>${r.requirements?`<div class="req">${esc(r.requirements)}</div>`:""}</div>`).join("")}`:""}</div>
    <div><div class="pm-box">${d.pending==="invite"?`<div>You've been invited to join.</div><button class="btn primary" data-ogjoininv="1">Join ${esc(o.name)}</button>`
      :d.pending==="request"?`<div>Your request to join is waiting for an answer.</div>`
      :o.recruiting?`<div class="k">Ask to join</div>
        ${o.verified?`<div style="font-size:12.5px;line-height:1.5"><b>1. Apply on RSI too</b> <span class="muted">(recommended)</span><br><span class="muted">${esc(o.name)} is a verified RSI org. Joining on RSI shows your membership in game. RSI's Join button is on their org page; you'll need to be signed in to RSI.</span></div>
          <button class="btn small" data-ogurl="${esc(o.rsi_url)}">Open ${esc(o.tag)} on RSI</button>
          <div style="font-size:12.5px;margin-top:4px"><b>2. Ask to join on Quantum</b></div>`:""}
        <input class="field" data-ogreqhandle="1" maxlength="60" placeholder="Your RSI handle${o.verified?" (the name you applied with)":" (optional)"}">
        <textarea class="field" rows="4" maxlength="1000" data-ogreqmsg="1" placeholder="Say hi: what you play, when you're on, what you'd bring"></textarea><button class="btn primary" data-ogreq="1">Ask to join</button>`
      :`<div class="muted">${esc(o.name)} is invite only right now.</div>`}</div></div></div></div>`;
  const reqs=(d.pending||[]).filter(p=>p.kind==="request").length;
  const tabs=[["overview","Overview"],["members","Members"],["ranks","Ranks"],["calendar","Calendar"],["settings","Settings"]];
  const t=S.og.tab;
  const body=t==="members"?ogMembersHtml(d):t==="ranks"?ogRanksHtml(d):t==="calendar"?ogCalHtml(d):t==="settings"?ogSettingsHtml(d):ogOverviewHtml(d,up);
  return hero+`<div class="og-tabs">${tabs.map(([k,n])=>`<button data-ogtab="${k}" class="${t===k?"on":""}">${n}${k==="members"&&reqs?`<span class="so-n">${reqs}</span>`:""}</button>`).join("")}</div><div class="og-body">${body}</div>`; }
function ogOverviewHtml(d,up){ const on=d.members.filter(m=>m.online);
  return `<div class="og-grid2"><div><div class="pm-sec" style="margin-top:0">About</div>${ogAboutHtml(d.org)}
      <div class="pm-sec">Coming up</div>${up.length?up.slice(0,4).map(e=>ogEvCard(e,d)).join(""):`<div class="so-empty">Nothing planned yet.${new Set(d.perms).has("events")?" Add an event under Calendar.":""}</div>`}</div>
    <div><div class="pm-box"><div class="k">Online now · ${on.length}</div>${on.length?on.map(m=>{ const rk=d.ranks.find(r=>r.id===m.rank); return `<div class="pm-seller">${soAvDot(m)}<div class="who" style="flex:1;min-width:0"><b class="up-name" data-upid="${esc(m.id)}">${esc(m.name)}</b><small class="${m.playing?"playing":""}">${esc(soPresence(m))}</small></div>${rk?`<span class="row" style="gap:6px;font-size:12.5px;color:var(--ink-2);flex:none">${ogRankIcon(rk,22)}${esc(rk.name)}</span>`:""}</div>`; }).join(""):`<div class="muted" style="font-size:12.5px">Nobody's online right now.</div>`}</div></div></div>`; }
function ogEvCard(e,d){ const dt=new Date(e.starts*1000), perms=new Set(d.perms), past=e.starts+(e.minutes||60)*60<Date.now()/1000;
  return `<div class="og-evcard ${S.og.ev===e.id?"sel":""}" id="og-ev-${e.id}"><div class="og-date"><span>${dt.toLocaleDateString([], {month:"short"})}</span><b>${dt.getDate()}</b><span style="color:var(--dim)">${dt.toLocaleDateString([], {weekday:"short"})}</span></div>
    <div style="min-width:0"><h4>${esc(e.title)} <span class="pm-badge">${esc(e.kind||"Other")}</span>${past?`<span class="pm-badge">Past</span>`:""}</h4>
      <div class="meta">${dt.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})} · ${ogDur(e.minutes||60)}${e.location?` · ◆ ${esc(e.location)}`:""} · by ${esc(e.by)}</div>
      ${e.description?`<div class="og-desc" style="font-size:13px;margin-bottom:6px">${esc(e.description)}</div>`:""}
      ${ogSeatsHtml(e,d,past)}
      <div class="muted" style="font-size:12.5px;margin-bottom:8px">Going ${e.going.length}${e.max?` of ${e.max}`:""}${e.going.length?`: ${e.going.map(esc).join(", ")}`:""}${e.maybe.length?` · Maybe: ${e.maybe.map(esc).join(", ")}`:""}</div>
      <div class="pm-acts">${past?"":`<span class="og-rsvp pm-acts">${[["going","Going"],["maybe","Maybe"],["no","Can't make it"]].map(([k,n])=>`<button class="btn small ${e.mine===k?"on":""}" data-ogrsvp="${e.id}" data-st="${k}">${n}</button>`).join("")}</span>`}
        ${perms.has("events")?`<button class="btn small ghost" data-ogevedit="${e.id}">Edit</button><button class="btn small ghost" data-ogevdel="${e.id}">${S.og.arm==="ev"+e.id?"Delete? Click again":"Delete"}</button>`:""}</div></div></div>`; }
function ogSeatsHtml(e,d,past){ const sl=e.slots||[]; if(!sl.length) return "";
  const can=new Set(d.perms).has("events"), seated=new Set(sl.flatMap(s=>s.people.map(p=>p.id))), mineSeat=sl.find(s=>s.people.some(p=>p.id===d.me));
  const free=d.members.filter(m=>!seated.has(m.id));
  let h=`<div class="og-seats">`, last;
  for(const s of sl){ const ship=s.ship||"";
    if(ship!==last){ h+=`<div class="ship">${ship?esc(ship):"Other roles"}</div>`; last=ship; }
    const open=s.seats-s.people.length;
    h+=`<div class="og-seat"><span class="role">${esc(s.role)}</span><span class="ppl">${s.people.map(p=>`<span class="${p.id===d.me?"me":""}">${esc(p.name||"")}${can&&!past?` <a style="cursor:pointer" title="Take them off this seat" data-ogunseat="${s.id}" data-m="${p.id}">×</a>`:""}</span>`).join("")}${open>0?`<i>${open} open</i>`:""}</span>
      ${past?"":`${open>0&&!s.people.some(p=>p.id===d.me)?`<button class="btn small" data-ogseat="${s.id}">${mineSeat?"Switch here":"Take seat"}</button>`:""}${s.people.some(p=>p.id===d.me)?`<button class="btn small ghost" data-ogunseatme="${e.id}">Leave seat</button>`:""}
      ${can&&open>0&&free.length?`<select class="field" data-ogassign="${s.id}"><option value="">Assign…</option>${free.map(m=>`<option value="${m.id}">${esc(m.name)}</option>`).join("")}</select>`:""}`}</div>`; }
  return h+`</div>`; }
function ogMembersHtml(d){ const perms=new Set(d.perms), my=d.my_position, can=perms.has("members"), ranks=d.ranks;
  let h="";
  if(can){ const pend=d.pending||[];
    h+=`<div class="pm-box" style="margin-bottom:16px"><div class="k">Invite people on Quantum</div><div class="row" style="gap:8px"><input class="field" id="og-inv-q" placeholder="@username or name" value="${esc(S.og.inviteQ)}" style="flex:1" autocomplete="off"></div>
      ${S.og.inviteRes?S.og.inviteRes.error?`<div class="muted">${esc(S.og.inviteRes.error)}</div>`:S.og.inviteRes.length?S.og.inviteRes.map(p=>{ const inOrg=d.members.some(m=>m.id===p.id), sent=pend.some(x=>x.who?.id===p.id&&x.kind==="invite");
        return `<div class="so-row">${soAv(p)}<div class="who"><b>${esc(p.name)}</b><small>${p.uex?"UEX: "+esc(p.uex):"Quantum member"}</small></div><div class="acts">${inOrg?`<span class="muted" style="font-size:12px">Member</span>`:sent?`<span class="muted" style="font-size:12px">Invited</span>`:`<button class="btn small primary" data-oginvite="${p.id}">Invite</button>`}</div></div>`; }).join(""):`<div class="muted" style="font-size:12.5px">Nobody by that name on Quantum.</div>`:""}
      ${pend.length?`<div class="k" style="margin-top:6px">Waiting</div>${pend.map(p=>`<div class="so-row">${soAv(p.who)}<div class="who"><b>${esc(p.who?.name||"")}</b><small>${p.kind==="request"?`Asked to join ${soAgo(p.at)}${p.rsi_handle?` · RSI: <a style="cursor:pointer;text-decoration:underline" data-ogurl="https://robertsspaceindustries.com/citizens/${esc(p.rsi_handle)}">${esc(p.rsi_handle)}</a>`:""}${p.message?`: “${esc(p.message)}”`:""}`:`Invited ${soAgo(p.at)}${p.by?` by ${esc(p.by)}`:""}`}</small></div>
        <div class="acts">${p.kind==="request"?`<button class="btn small primary" data-ogreqok="${p.id}" data-yes="1">Accept</button><button class="btn small ghost" data-ogreqok="${p.id}" data-yes="0">Decline</button>`:`<button class="btn small ghost" data-ogcancel="${p.id}">Cancel</button>`}</div></div>`).join("")}`:""}</div>`; }
  for(const r of ranks){ const ms=d.members.filter(m=>m.rank===r.id); if(!ms.length) continue;
    h+=`<div class="og-rank-h">${ogRankIcon(r,18)}${esc(r.name)} <span class="muted">${ms.length}</span></div>`+ms.map(m=>{ const manage=can&&!m.owner&&m.id!==d.me&&(my<0||m.position>my);
      return `<div class="og-mem">${soAvDot(m)}<div class="who"><b><span class="up-name" data-upid="${esc(m.id)}">${esc(m.name)}</span>${m.owner?` <span class="pm-badge esc">Owner</span>`:""}</b><small class="${m.playing?"playing":""}">${esc(soPresence(m))} · joined ${new Date(m.joined*1000).toLocaleDateString([], {day:"numeric",month:"short",year:"numeric"})}</small></div>
        ${manage?`<select class="field" data-ogsetrank="${m.id}">${ranks.filter(x=>my<0||x.position>my).map(x=>`<option value="${x.id}" ${x.id===m.rank?"selected":""}>${esc(x.name)}</option>`).join("")}</select><button class="btn small ghost" data-ogkick="${m.id}">${S.og.arm==="kick"+m.id?"Remove? Click again":"Remove"}</button>`:""}
        ${m.id!==d.me?`<button class="btn small ghost" data-ogchat="${m.id}">Message</button>`:""}</div>`; }).join(""); }
  return h; }
function ogRanksHtml(d){ const perms=new Set(d.perms), can=perms.has("ranks"), my=d.my_position, re=S.og.rankEdit;
  const editor=r=>`<div class="og-rank"><div class="og-form" style="max-width:none"><label class="wide">Rank name<input class="field" data-ogr="name" maxlength="40" value="${esc(r.name||"")}"></label>
      <label class="wide">Requirements to reach this rank<textarea class="field" data-ogr="requirements" maxlength="1000" placeholder="e.g. Own a cargo ship of 96 SCU or more&#10;10 hauling contracts with the org">${esc(r.requirements||"")}</textarea></label>
      <div class="wide"><div class="muted" style="font-size:12px;margin-bottom:6px">This rank can manage:</div>${Object.entries(OG_PERM).filter(([k])=>perms.has(k)).map(([k,t])=>`<label class="og-perm"><input type="checkbox" data-ogrp="${k}" ${(r.perms||[]).includes(k)?"checked":""}> ${esc(t)}</label>`).join("")}</div>
      <div class="wide"><div class="pm-photo" style="gap:10px"><div class="og-logo sm" style="width:52px;height:52px">${r.iconData||r.icon?`<img src="${esc(r.iconData||r.icon)}" alt="" style="object-fit:contain">`:"—"}</div>
        <div style="display:flex;flex-direction:column;gap:5px"><b style="font-size:12.5px">Rank picture <span class="muted" style="font-weight:400">(optional: PNG, JPEG or ICO)</span></b>
        <div class="pm-acts"><button class="btn small" type="button" data-ogrpick="1">${r.iconData||r.icon?"Change":"Upload"}</button>${r.iconData||r.icon?`<button class="btn small ghost" type="button" data-ogrnoicon="1">Remove</button>`:""}</div>
        <input type="file" accept=".png,.jpg,.jpeg,.ico,image/png,image/jpeg,image/x-icon,image/vnd.microsoft.icon" data-ogrfile="1" hidden></div></div></div>
      ${S.og.rankErr?`<div class="wide" style="color:#ffb3b3;font-size:12.5px">${esc(S.og.rankErr)}</div>`:""}
      <div class="wide pm-acts"><button class="btn small primary" data-ogrsave="1">Save rank</button><button class="btn small ghost" data-ogrcancel="1">Cancel</button></div></div></div>`;
  const max=d.ranks_max||20, full=d.ranks.length>=max;
  let h=`<div class="pm-top"><h2>Ranks</h2><span class="muted">${d.ranks.length} of ${max} · top to bottom. New members start at the bottom rank.</span>${can?`<span class="spacer" style="flex:1"></span>${full?`<span class="muted" style="font-size:12.5px">The most ranks an org can have is ${max}</span>`:""}<button class="btn small primary" data-ogradd="1" ${full?`disabled title="The most ranks an org can have is ${max}"`:""}>+ Add rank</button>`:""}</div>`;
  if(re&&!re.id) h+=editor(re);
  h+=d.ranks.map((r,i)=>re&&re.id===r.id?editor(re):`<div class="og-rank"><div class="top">${ogRankIcon(r,30)}<b>${esc(r.name)}</b><span class="muted" style="font-size:12.5px">${r.count} member${r.count===1?"":"s"}</span><span class="spacer" style="flex:1"></span>
      ${can&&(my<0||r.position>my)?`${i>1?`<button class="btn small ghost" data-ogrmove="${r.id}" data-dir="up" title="Move up">↑</button>`:""}${i>0&&i<d.ranks.length-1?`<button class="btn small ghost" data-ogrmove="${r.id}" data-dir="down" title="Move down">↓</button>`:""}<button class="btn small ghost" data-ogredit="${r.id}">Edit</button>${i>0?`<button class="btn small ghost" data-ogrdel="${r.id}">${S.og.arm==="r"+r.id?"Delete? Click again":"Delete"}</button>`:""}`:""}</div>
      ${r.requirements?`<div class="req">${esc(r.requirements)}</div>`:`<div class="req muted">No requirements listed.</div>`}
      ${r.perms.length?`<div class="row" style="gap:6px;margin-top:8px;flex-wrap:wrap">${r.perms.map(p=>`<span class="pm-badge esc">Manages ${esc(p)}</span>`).join("")}</div>`:""}</div>`).join("");
  return h; }
function ogCalHtml(d){ const perms=new Set(d.perms), now=new Date(); S.og.month=S.og.month||new Date(now.getFullYear(),now.getMonth(),1);
  const m0=S.og.month, first=new Date(m0.getFullYear(),m0.getMonth(),1), start=new Date(first); start.setDate(1-((first.getDay()+6)%7));
  const days=[...Array(42)].map((_,i)=>{ const x=new Date(start); x.setDate(start.getDate()+i); return x; });
  const evs=d.events||[], key=x=>x.toDateString();
  const byDay={}; for(const e of evs){ const k=key(new Date(e.starts*1000)); (byDay[k]=byDay[k]||[]).push(e); }
  let h=`<div class="pm-top"><h2>${m0.toLocaleDateString([], {month:"long",year:"numeric"})}</h2><button class="btn small ghost" data-ogmon="-1">←</button><button class="btn small ghost" data-ogmon="0">Today</button><button class="btn small ghost" data-ogmon="1">→</button>
    <span class="spacer" style="flex:1"></span>${perms.has("events")?`<button class="btn small primary" data-ogevnew="1">+ New event</button>`:""}</div>`;
  if(S.og.evForm) h+=ogEvFormHtml(d);
  h+=`<div class="og-cal">${["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(x=>`<div class="dow">${x}</div>`).join("")}${days.map(x=>`<div class="og-day ${x.getMonth()!==m0.getMonth()?"out":""} ${key(x)===key(now)?"today":""}"><span class="n">${x.getDate()}</span>${(byDay[key(x)]||[]).map(e=>`<div class="og-ev ${e.mine==="going"?"go":""}" data-ogev="${e.id}" title="${esc(e.title)}">${new Date(e.starts*1000).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})} ${esc(e.title)}</div>`).join("")}</div>`).join("")}</div>`;
  const nowS=Date.now()/1000, up=evs.filter(e=>e.starts+(e.minutes||60)*60>nowS);
  h+=`<div class="pm-sec">Upcoming</div>`+(up.length?up.map(e=>ogEvCard(e,d)).join(""):`<div class="so-empty">Nothing planned yet.</div>`);
  return h; }
function ogEvFormHtml(d){ const f=S.og.evForm, pad=n=>String(n).padStart(2,"0"), dt=new Date((f.starts||Date.now()/1000+86400)*1000);
  const local=`${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
  return `<div class="pm-box" style="margin-bottom:16px;max-width:820px"><div class="k">${f.id?"Edit event":"New event"}</div><div class="og-form" style="max-width:none">
    <label class="wide">Title<input class="field" data-oge="title" maxlength="80" value="${esc(f.title||"")}" placeholder="e.g. Pyro convoy run"></label>
    <label>Type<select class="field" data-oge="kind">${(d.kinds||[]).map(k=>`<option ${f.kind===k?"selected":""}>${esc(k)}</option>`).join("")}</select></label>
    <label>Starts (your time)<input class="field" type="datetime-local" data-oge="when" value="${local}"></label>
    <label>Length<select class="field" data-oge="minutes">${[30,60,90,120,180,240,360,480].map(m=>`<option value="${m}" ${(f.minutes||60)===m?"selected":""}>${ogDur(m)}</option>`).join("")}</select></label>
    <label>Spots (optional)<input class="field" type="number" min="1" data-oge="max" value="${esc(f.max??"")}" placeholder="No limit"></label>
    <label class="wide">Where<input class="field" data-oge="location" maxlength="80" value="${esc(f.location||"")}" placeholder="e.g. Pyro Gateway, Area 18 hangar"></label>
    <label class="wide">Details<textarea class="field" data-oge="description" maxlength="3000" placeholder="What to bring, ships, roles…">${esc(f.description||"")}</textarea></label>
    <div class="wide"><div style="font:600 12.5px var(--text);color:var(--ink-2);margin-bottom:6px">Ships and roles <span class="muted" style="font-weight:400">(optional: seats people take, or you assign)</span></div>
      ${(f.slots||[]).length?`<div class="og-slotrow muted" style="font-size:11.5px;margin-bottom:2px"><span>Ship (leave empty for a role without a ship)</span><span>Role (pick one or type your own)</span><span>Seats</span><span></span><span></span></div>`:""}
      ${(f.slots||[]).map((x,i,a)=>{ const sub=x.g&&i>0&&a[i-1].g===x.g, last=x.g&&!(a[i+1]&&a[i+1].g===x.g);
        return `<div class="og-slotrow ${sub?"sub":""}"><input class="field" list="og-ships" data-ogs="${i}" data-k="ship" value="${esc(x.ship||"")}" placeholder="${sub?"":"e.g. C2 Hercules"}" ${sub?'tabindex="-1" title="Same ship as above"':""}><input class="field" list="og-roles" data-ogs="${i}" data-k="role" value="${esc(x.role||"")}" maxlength="30" placeholder="Pick or type a role"><input class="field" type="number" min="1" max="100" data-ogs="${i}" data-k="seats" value="${x.seats||1}"><button class="btn small ghost" data-ogsdel="${i}" title="Remove">×</button>${last?`<button class="btn small" type="button" data-ogsmore="${i}" title="Add another role on this ship">+</button>`:"<span></span>"}</div>`; }).join("")}
      <datalist id="og-roles">${(d.roles||[]).map(r=>`<option value="${esc(r)}">`).join("")}</datalist>
      <datalist id="og-ships">${[...new Set((S.veh||[]).filter(v=>!v.concept).map(v=>v.full||v.name).filter(Boolean))].sort().map(n=>`<option value="${esc(n)}">`).join("")}</datalist>
      <div class="pm-acts"><button class="btn small" type="button" data-ogsship="1">+ Add a ship</button><button class="btn small ghost" type="button" data-ogsadd="1">+ Add a role without a ship</button></div></div>
    <div class="wide pm-acts"><button class="btn small primary" data-ogesave="1">${f.id?"Save event":"Add to calendar"}</button><button class="btn small ghost" data-ogecancel="1">Cancel</button></div></div></div>`; }
function ogSettingsHtml(d){ const perms=new Set(d.perms), o=d.org;
  if(!S.og.form||S.og.form.id!==o.id) S.og.form={id:o.id,name:o.name,tag:o.tag,slogan:o.slogan||"",description:o.description||"",about:o.about_src??o.description??"",recruiting:o.recruiting,listed:o.listed!==false,logo:o.logo,banner:o.banner,verified:o.verified};
  let h="";
  if(perms.has("owner")){ const c=d.claim;
    h+=`<div class="pm-sec" style="margin-top:0">RSI verification</div><div class="pm-box" style="max-width:760px;margin-bottom:6px">`+(o.verified
      ?`<div class="row" style="gap:8px;flex-wrap:wrap">${ogVer(o)}<span>Verified as <b>${esc(o.rsi_sid)}</b> on RSI. Your name and tag are locked to your RSI org.</span><span class="spacer" style="flex:1"></span><button class="btn small ghost" data-ogurl="${esc(o.rsi_url)}">Open on RSI</button></div>`
      :c?`<div style="font-size:13px">Prove <b>${esc(c.sid)}</b> on RSI is yours: put this code on your RSI org page.</div>
        <input class="og-code" readonly value="${esc(c.code)}" onclick="this.select()" title="Click to select, then Ctrl+C">
        <ol class="og-steps"><li>Open your org on RSI and edit it (you need to be an admin there).</li><li>Paste the code anywhere in the <b>Headline</b> (or the history, manifesto or charter) and save.</li><li>Come back and press <b>Check now</b>. Once it's verified you can take the code off again.</li></ol>
        <div class="pm-acts"><button class="btn small" data-ogurl="${esc(c.rsi_url)}">Open ${esc(c.sid)} on RSI</button><button class="btn small primary" data-ogcheck="1" ${S.og.checking?"disabled":""}>${S.og.checking?"Checking RSI…":"Check now"}</button><button class="btn small ghost" data-ogclaimx="1">Cancel</button>${c.checked?`<span class="muted" style="font-size:12px">Last checked ${soAgo(c.checked)}</span>`:""}</div>`
      :`<div style="font-size:13px">Is this your org on RSI? Verify it to get the ✓ RSI badge, show up in Find orgs, make links in your description clickable, and lock your RSI name and SID to this org so nobody else can use them on Quantum.</div>
        <div class="row" style="gap:8px"><input class="field" id="og-claim-sid" maxlength="10" placeholder="Your org's SID on RSI" style="flex:1;text-transform:uppercase"><button class="btn small primary" data-ogclaim="1">Verify with RSI</button></div>`)+`</div>`; }
  if(perms.has("org")) h+=`<div class="pm-sec"${perms.has("owner")?"":' style="margin-top:0"'}>Org details</div>`+ogFormHtml(false).replace('<div class="og-body">','<div>');
  if(perms.has("owner")){ const others=d.members.filter(m=>m.id!==d.me);
    h+=`<div class="pm-sec">Owner</div><div class="pm-box" style="max-width:760px"><div class="k">Hand the org over</div><div class="row" style="gap:8px"><select class="field" id="og-xfer" style="flex:1">${others.map(m=>`<option value="${m.id}">${esc(m.name)}</option>`).join("")||"<option value=''>No other members yet</option>"}</select><button class="btn small" data-ogxfer="1" ${others.length?"":"disabled"}>${S.og.arm==="xfer"?"Sure? Click again":"Make owner"}</button></div>
      <div class="k" style="margin-top:8px">Delete the org</div><div class="row" style="gap:8px"><span class="muted" style="font-size:12.5px;flex:1">Removes the org, its ranks and its calendar for everyone. Members are told.</span><button class="btn small danger" data-ogdel="1">${S.og.arm==="del"?"Delete for good? Click again":"Delete org"}</button></div></div>`; }
  else h+=`<div class="pm-sec">Membership</div><div class="pm-box" style="max-width:760px"><div class="row" style="gap:8px"><span style="flex:1">Leave ${esc(o.name)}</span><button class="btn small danger" data-ogleave="1">${S.og.arm==="leave"?"Leave? Click again":"Leave org"}</button></div></div>`;
  return h; }

// ---- actions
function ogArm(key,fn){ if(S.og.arm===key){ S.og.arm=null; return fn(); } S.og.arm=key; ogRender(); setTimeout(()=>{ if(S.og.arm===key){ S.og.arm=null; ogRender(); } },3500); }
function ogWire(P){ const on=(sel,fn)=>{ for(const el of P.querySelectorAll(sel)) el.onclick=e=>fn(el,e); }, d=S.og.data, oid=d?.org?.id;
  on("[data-ognew2]",()=>{ S.og.view="create"; S.og.form={name:"",tag:"",slogan:"",about:"",recruiting:true}; ogPane(); ogRender(); });
  on("[data-ogfind2]",()=>{ S.og.view="browse"; ogPane(); ogRender(); ogBrowse(); });
  on("[data-ogback]",()=>{ S.og.view=S.og.cur?"org":"home"; S.og.formErr=null; ogPane(); ogRender(); });
  on("[data-ogopen2]",el=>{ S.og.tab="overview"; ogOpen(+el.dataset.ogopen2); });
  const q=P.querySelector("#og-q"); if(q){ let t; q.oninput=()=>{ S.og.q=q.value; clearTimeout(t); t=setTimeout(ogBrowse,350); }; }
  on("[data-ogtab]",el=>{ S.og.tab=el.dataset.ogtab; ogRender(); if(S.og.cur) ogOpen(S.og.cur,true); });
  on("[data-ogchat]",el=>soOpen(el.dataset.ogchat));
  // org form (create and settings)
  const f=S.og.form;
  for(const el of P.querySelectorAll("[data-ogf]")) el.oninput=el.onchange=()=>{ f[el.dataset.ogf]=["recruiting","listed"].includes(el.dataset.ogf)?el.value==="1":el.value; };
  on("[data-ogpick]",()=>P.querySelector("[data-ogfile]").click());
  const fi=P.querySelector("[data-ogfile]"); if(fi) fi.onchange=async()=>{ const file=fi.files[0]; if(!file) return; try{ f.logoData=await pmShrink(file); f.logoRemove=false; ogRender(); }catch(_){ toast("That file isn't a picture Quantum can read"); } };
  on("[data-ognologo]",()=>{ f.logoData=null; f.logo=null; f.logoRemove=true; ogRender(); });
  // About page editor: toolbar wraps the selection in tags; the preview follows as you type
  const ed=P.querySelector('[data-ogf="about"]'), pv=P.querySelector("#og-rich-prev");
  const prev=()=>{ if(pv) pv.innerHTML=richSafe(f.about||"",f.verified,true)||'<span class="muted">Nothing yet.</span>'; };
  if(ed) ed.addEventListener("input",()=>{ f.about=ed.value; prev(); });
  on("[data-ogrt]",el=>{ if(!ed) return; const k=el.dataset.ogrt, a=ed.selectionStart, b=ed.selectionEnd, sel=ed.value.slice(a,b);
    let ins;
    // Links and pictures go in with "https://" selected, ready to paste the address over
    if(k==="a"||k==="img"){ ins=k==="a"?`<a href="https://">${sel||"link text"}</a>`:`<img src="https://" alt="${sel.replace(/"/g,"")}">`;
      ed.setRangeText(ins,a,b,"start"); const at=a+ins.indexOf("https://"); ed.focus(); ed.setSelectionRange(at,at+8); f.about=ed.value; prev(); return; }
    else if(k==="color"){ ins=`<span style="color:#7fe7ff">${sel||"text"}</span>`; }
    else if(k==="hr"||k==="br") ins=`<${k}>`;
    else if(k==="ul"||k==="ol") ins=`<${k}>\n${(sel||"Item").split("\n").map(x=>`  <li>${x}</li>`).join("\n")}\n</${k}>`;
    else ins=`<${k}>${sel||""}</${k}>`;
    ed.setRangeText(ins,a,b,"end"); ed.focus(); f.about=ed.value; prev(); });
  on("[data-ogbanpick]",()=>P.querySelector("[data-ogbanfile]")?.click());
  const bf=P.querySelector("[data-ogbanfile]"); if(bf) bf.onchange=async()=>{ const file=bf.files[0]; bf.value=""; if(!file) return; let data;
    try{ data=await ogShrinkWide(file); }catch(_){ S.og.banMsg={ok:false,text:"That file isn't a picture Quantum can read (PNG, JPEG or WebP)."}; return ogRender(); }
    f.bannerPreview=data; S.og.banSaving=true; S.og.banMsg=null; ogRender();      // shown straight away, saved behind it
    let r; try{ r=await ogCall("banner",{org:f.id,banner:data}); }catch(e){ r={ok:false,error:"Couldn't reach Quantum"}; }
    S.og.banSaving=false;
    if(!r.ok){ f.bannerPreview=null; S.og.banMsg={ok:false,text:`Not saved: ${r.error||"the server didn't take it"}`}; return ogRender(); }
    f.banner=r.org?.banner||null; f.bannerPreview=null; S.og.data=r; S.og.banMsg={ok:true,text:"Banner saved: it's at the top of your org's page."}; ogRender(); };
  on("[data-ognoban]",async()=>{ const r=await ogCall("banner",{org:f.id,remove:true}); if(!r.ok){ S.og.banMsg={ok:false,text:r.error}; return ogRender(); }
    f.banner=null; f.bannerPreview=null; S.og.data=r; S.og.banMsg={ok:true,text:"Banner removed."}; ogRender(); });
  on("[data-ogsave]",async()=>{ S.og.saving=true; S.og.formErr=null; ogRender();
    // One About box: the server keeps what you typed, a cleaned page from it, and a plain-text copy for older apps
    const about=f.about||"", plain=about.replace(/<br\s*\/?>/gi,"\n").replace(/<[^>]+>/g,"").slice(0,4000);
    const body={name:f.name,tag:f.tag,slogan:f.slogan,description:plain,about,recruiting:f.recruiting!==false,listed:f.listed!==false,logo:f.logoData||null,logo_remove:!!f.logoRemove};
    const r=f.id?await ogCall("update",{...body,id:f.id}):await ogCall("create",body); S.og.saving=false;
    if(!r.ok){ S.og.formErr=r.error; return ogRender(); }
    toast(f.id?"Saved":r.claim?`${r.org.name} is created. Put the code on your RSI org page, then press Check now.`:r.rsi==="missing"?`${r.org.name} is created. ${r.org.tag} isn't an org on RSI, so it can't be verified yet: see Settings.`:r.rsi==="unreachable"?`${r.org.name} is created. RSI couldn't be reached to start verifying: try Verify with RSI under Settings.`:`${r.org.name} is created. Invite your crew under Members.`); S.og.form=null; S.og.view="org"; S.og.cur=r.org.id; S.og.data=r; S.og.tab=f.id||r.claim||r.rsi?"settings":"members"; await ogLoadMine(); ogRender(); });
  // joining
  on("[data-ogreq]",async el=>{ el.disabled=true; const r=await ogCall("request",{org:oid,message:P.querySelector("[data-ogreqmsg]").value,rsi_handle:P.querySelector("[data-ogreqhandle]")?.value||""}); if(!r.ok){ el.disabled=false; return toast(r.error); }
    toast(r.org?"Welcome aboard!":"Request sent. You'll get a message when they answer."); await ogLoadMine(); ogOpen(oid); });
  on("[data-ogjoininv]",async()=>{ const inv=(S.og.mine?.invites||[]).find(i=>i.org.id===oid); if(!inv) return; const r=await ogCall("invite/respond",{id:inv.id,accept:true}); if(!r.ok) return toast(r.error); toast("Welcome aboard!"); await ogLoadMine(); ogOpen(oid); });
  // members
  const iq=P.querySelector("#og-inv-q"); if(iq){ let t; iq.oninput=()=>{ S.og.inviteQ=iq.value; clearTimeout(t); t=setTimeout(async()=>{ const v=S.og.inviteQ.trim(); if(v.replace(/^@/,"").length<(v.startsWith("@")?2:3)){ S.og.inviteRes=null; return ogRender(); }
      const r=await api().social_search(v); if(S.og.inviteQ.trim()!==v) return; S.og.inviteRes=r.ok?r.people:{error:r.error}; ogRender(); const x=$("og-inv-q"); if(x){ x.focus(); x.setSelectionRange(x.value.length,x.value.length); } },350); }; }
  on("[data-oginvite]",async el=>{ el.disabled=true; const r=await ogCall("invite",{org:oid,member:el.dataset.oginvite}); if(!r.ok){ el.disabled=false; return toast(r.error); } toast(r.org?"They'd asked to join: they're in now":"Invitation sent"); ogOpen(oid,true); });
  on("[data-ogreqok]",async el=>{ const yes=el.dataset.yes==="1"; const r=await ogCall("request/respond",{id:+el.dataset.ogreqok,accept:yes}); if(!r.ok) return toast(r.error); toast(yes?"Accepted: they're in":"Declined"); ogOpen(oid,true); });
  on("[data-ogcancel]",async el=>{ const r=await ogCall("invite/cancel",{id:+el.dataset.ogcancel}); if(!r.ok) return toast(r.error); toast("Invitation cancelled"); ogOpen(oid,true); });
  for(const el of P.querySelectorAll("[data-ogsetrank]")) el.onchange=async()=>{ const r=await ogCall("member/rank",{org:oid,member:el.dataset.ogsetrank,rank:+el.value}); if(ogApply(r).ok) toast("Rank changed"); };
  on("[data-ogkick]",el=>ogArm("kick"+el.dataset.ogkick,async()=>{ const r=await ogCall("member/remove",{org:oid,member:el.dataset.ogkick}); if(ogApply(r).ok) toast("Removed from the org"); }));
  // ranks
  const re=S.og.rankEdit;
  const showEditor=()=>setTimeout(()=>P.querySelector('[data-ogr="name"]')?.closest(".og-rank")?.scrollIntoView({behavior:"smooth",block:"center"}),30);
  on("[data-ogradd]",()=>{ S.og.rankErr=null; S.og.rankEdit={name:"",requirements:"",perms:[]}; ogRender(); showEditor(); P.querySelector('[data-ogr="name"]')?.focus(); });
  on("[data-ogredit]",el=>{ S.og.rankErr=null; const r=d.ranks.find(x=>x.id===+el.dataset.ogredit); S.og.rankEdit={...r,perms:[...r.perms]}; ogRender(); showEditor(); });
  on("[data-ogrcancel]",()=>{ S.og.rankErr=null; S.og.rankEdit=null; ogRender(); });
  on("[data-ogrpick]",()=>P.querySelector("[data-ogrfile]").click());
  const rf=P.querySelector("[data-ogrfile]"); if(rf) rf.onchange=async()=>{ const file=rf.files[0]; if(!file) return;
    for(const k of ["name","requirements"]){ const el=P.querySelector(`[data-ogr="${k}"]`); if(el) re[k]=el.value; }
    try{ re.iconData=await ogIconFile(file); re.iconRemove=false; ogRender(); }catch(_){ toast("That file isn't a picture Quantum can read"); } };
  on("[data-ogrnoicon]",()=>{ for(const k of ["name","requirements"]){ const el=P.querySelector(`[data-ogr="${k}"]`); if(el) re[k]=el.value; } re.iconData=null; re.icon=null; re.iconRemove=true; ogRender(); });
  for(const el of P.querySelectorAll("[data-ogr]")) el.oninput=()=>{ re[el.dataset.ogr]=el.value; };
  for(const el of P.querySelectorAll("[data-ogrp]")) el.onchange=()=>{ const k=el.dataset.ogrp; re.perms=el.checked?[...new Set([...re.perms,k])]:re.perms.filter(x=>x!==k); };
  on("[data-ogrsave]",async el=>{ el.disabled=true; const r=await ogCall("rank/save",{org:oid,id:re.id||null,name:re.name,requirements:re.requirements,perms:re.perms,icon:re.iconData||null,icon_remove:!!re.iconRemove});
    if(r.ok){ S.og.rankErr=null; S.og.rankEdit=null; ogApply(r); toast("Rank saved"); } else { el.disabled=false; S.og.rankErr=r.error; toast(r.error); ogRender(); showEditor(); } });
  on("[data-ogrmove]",async el=>ogApply(await ogCall("rank/move",{org:oid,id:+el.dataset.ogrmove,dir:el.dataset.dir})));
  on("[data-ogrdel]",el=>ogArm("r"+el.dataset.ogrdel,async()=>{ if(ogApply(await ogCall("rank/delete",{org:oid,id:+el.dataset.ogrdel})).ok) toast("Rank deleted: its members moved down one rank"); }));
  // calendar
  on("[data-ogmon]",el=>{ const n=+el.dataset.ogmon, m=S.og.month; S.og.month=n?new Date(m.getFullYear(),m.getMonth()+n,1):null; ogRender(); });
  on("[data-ogev]",el=>{ S.og.ev=+el.dataset.ogev; ogRender(); document.getElementById("og-ev-"+el.dataset.ogev)?.scrollIntoView({behavior:"smooth",block:"center"}); });
  on("[data-ogevnew]",()=>{ S.og.evForm={kind:"Operation",minutes:60}; ogRender(); });
  on("[data-ogevedit]",el=>{ S.og.tab="calendar"; const e=d.events.find(x=>x.id===+el.dataset.ogevedit); S.og.evForm={...e,slots:(e.slots||[]).map(x=>({id:x.id,ship:x.ship||"",role:x.role,seats:x.seats,g:x.ship?"s:"+x.ship:null}))}; ogRender(); $("og-panel").scrollTop=0; });
  on("[data-ogecancel]",()=>{ S.og.evForm=null; ogRender(); });
  // seats builder: keep what's typed in the other fields across re-renders
  const evKeep=()=>{ const ef=S.og.evForm; if(!ef) return; for(const k of ["title","kind","minutes","max","location","description"]){ const el=P.querySelector(`[data-oge="${k}"]`); if(el) ef[k]=k==="minutes"?+el.value:el.value; }
    const w=P.querySelector('[data-oge="when"]'); if(w&&!isNaN(new Date(w.value))) ef.starts=Math.floor(new Date(w.value)/1000); };
  for(const el of P.querySelectorAll("[data-ogs]")) el.oninput=el.onchange=()=>{ const i=+el.dataset.ogs, sl=S.og.evForm.slots, x=sl[i], old=x.ship||"";
    x[el.dataset.k]=el.dataset.k==="seats"?+el.value||1:el.value;
    if(el.dataset.k==="ship"&&x.g){ sl.forEach((y,j)=>{ if(j!==i&&y.g===x.g){ y.ship=x.ship; const o=P.querySelector(`[data-ogs="${j}"][data-k="ship"]`); if(o) o.value=x.ship; } }); } };
  on("[data-ogsadd]",()=>{ evKeep(); (S.og.evForm.slots=S.og.evForm.slots||[]).push({ship:"",role:"",seats:1}); ogRender(); });
  // "+ Add a ship" starts with one Pilot seat; the + at the end of a ship's rows adds another role on that ship
  on("[data-ogsship]",()=>{ evKeep(); const sl=S.og.evForm.slots=S.og.evForm.slots||[]; sl.push({ship:"",role:"Pilot",seats:1,g:"g"+Date.now()}); ogRender();
    const ins=P.ownerDocument.querySelectorAll('#og-panel [data-k="ship"]'); ins[ins.length-1]?.focus(); });
  on("[data-ogsmore]",el=>{ evKeep(); const sl=S.og.evForm.slots, i=+el.dataset.ogsmore; sl.splice(i+1,0,{ship:sl[i].ship,role:"",seats:1,g:sl[i].g}); ogRender();
    P.ownerDocument.querySelector(`#og-panel [data-ogs="${i+1}"][data-k="role"]`)?.focus(); });
  on("[data-ogsdel]",el=>{ evKeep(); S.og.evForm.slots.splice(+el.dataset.ogsdel,1); ogRender(); });
  on("[data-ogesave]",async()=>{ const g=k=>P.querySelector(`[data-oge="${k}"]`).value, when=new Date(g("when"));
    if(isNaN(when)) return toast("Pick when it starts");
    const slots=(S.og.evForm.slots||[]).map(x=>({id:x.id||null,ship:(x.ship||"").trim()||null,role:(x.role||"").trim()||"Crew",seats:+x.seats||1}));
    const r=await ogCall("event/save",{org:oid,id:S.og.evForm.id||null,title:g("title"),kind:g("kind"),starts:Math.floor(when/1000),minutes:+g("minutes"),max:g("max")?+g("max"):null,location:g("location"),description:g("description"),slots});
    if(ogApply(r).ok){ toast(S.og.evForm.id?"Event saved":"Added to the calendar"); S.og.evForm=null; S.og.month=new Date(when.getFullYear(),when.getMonth(),1); ogRender(); } });
  on("[data-ogevdel]",el=>ogArm("ev"+el.dataset.ogevdel,async()=>{ if(ogApply(await ogCall("event/delete",{org:oid,id:+el.dataset.ogevdel})).ok) toast("Event deleted"); }));
  on("[data-ogrsvp]",async el=>{ const r=await ogCall("rsvp",{event:+el.dataset.ogrsvp,status:el.dataset.st}); ogApply(r); });
  on("[data-ogseat]",async el=>{ const r=await ogCall("slot/take",{slot:+el.dataset.ogseat}); if(ogApply(r).ok) toast("Seat taken: you're down as going"); });
  on("[data-ogunseatme]",async el=>{ if(ogApply(await ogCall("slot/leave",{event:+el.dataset.ogunseatme})).ok) toast("You left your seat"); });
  on("[data-ogunseat]",async el=>{ if(ogApply(await ogCall("slot/unassign",{slot:+el.dataset.ogunseat,member:el.dataset.m})).ok) toast("Taken off the seat"); });
  for(const el of P.querySelectorAll("[data-ogassign]")) el.onchange=async()=>{ if(!el.value) return; const r=await ogCall("slot/assign",{slot:+el.dataset.ogassign,member:el.value}); if(ogApply(r).ok) toast("Assigned: they've been told"); };
  // RSI verification
  on("[data-ogurl]",el=>api().open_url(el.dataset.ogurl));
  on("[data-ogclaim]",async el=>{ const sid=(P.querySelector("#og-claim-sid")?.value||"").trim(); if(!sid) return toast("Enter your org's SID from RSI");
    el.disabled=true; const r=await ogCall("claim",{org:oid,sid}); el.disabled=false; if(ogApply(r).ok) toast("Now put the code on your RSI org page"); });
  on("[data-ogcheck]",async()=>{ S.og.checking=true; ogRender(); const r=await ogCall("claim/check",{org:oid}); S.og.checking=false;
    if(r.ok){ S.og.form=null; ogApply(r); toast(`Verified! ${r.org.name} [${r.org.tag}] is official on Quantum.`); } else { toast(r.error); ogOpen(oid,true); } });
  on("[data-ogclaimx]",async()=>ogApply(await ogCall("claim/cancel",{org:oid})));
  // settings
  on("[data-ogxfer]",()=>ogArm("xfer",async()=>{ const to=P.querySelector("#og-xfer").value; if(!to) return; if(ogApply(await ogCall("transfer",{org:oid,member:to})).ok) toast("Ownership handed over"); }));
  on("[data-ogdel]",()=>ogArm("del",async()=>{ const r=await ogCall("delete",{id:oid}); if(!r.ok) return toast(r.error); toast("Org deleted"); S.og.cur=null; S.og.data=null; S.og.view=null; openOrg(); }));
  on("[data-ogleave]",()=>ogArm("leave",async()=>{ const r=await ogCall("leave",{org:oid}); if(!r.ok) return toast(r.error); toast("You left the org"); S.og.cur=null; S.og.data=null; S.og.view=null; openOrg(); }));
}
// The open org refreshes now and then (people come online, RSVP, join)
setInterval(()=>{ if(S.tab==="orgs"&&S.og.view==="org"&&S.og.cur&&!S.og.evForm&&!S.og.rankEdit&&S.og.tab!=="settings"&&!document.activeElement?.closest?.("#og-panel input,#og-panel textarea,#og-panel select")) ogOpen(S.og.cur,true); },20000);
