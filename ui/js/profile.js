// Quantum UI: Your profile: account, linked keys, backups, submissions, fleet, privacy.
// One of several classic scripts sharing one global scope; index.html loads them in order.
"use strict";
// =================================================================== Profile
// Behind your picture at the top of the rail: who you are (photo, UEX name, rank, trusted status), your Quantum
// account and UEX keys, backups, what you've sent in, and your fleet. Signed out, it's where you sign in.
const PF_PERSON='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-7 8-7s8 3 8 7"/></svg>';
const PF_VIEWS=[["overview","Overview",'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'],
  ["accounts","Linked accounts",'<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/>'],
  ["backup","Backup",'<path d="M7 18a5 5 0 010-10 6 6 0 0111 2 4 4 0 010 8z"/><path d="M12 11v6M9 14l3-3 3 3"/>'],
  ["submissions","Submissions",'<path d="M5 4h14v16H5zM9 9h6M9 13h6M9 17h3"/>'],
  ["fleet","My fleet",'<path d="M12 1 14.7 4 14.7 4.6 16.1 4.8 15.9 5.4 14.6 5.6 14.5 6.2 14.7 10.4 15 11.2 17.9 14.2 20.6 13.4 20.8 12.7 21.3 12.7 21.3 16.8 20.8 16.8 20.6 15.6 17.9 19.6 17.9 20.3 15.1 22.8 14.1 22.8 13.9 20.1 12.6 20.1 12.5 21.3 11.5 21.3 11.4 20.1 10.1 20.1 9.9 22.8 8.9 22.8 6.1 20.3 6.1 19.6 3.4 15.6 3.2 16.8 2.7 16.8 2.7 12.7 3.2 12.7 3.4 13.4 6.1 14.2 9 11.2 9.3 10.4 9.5 6.2 9.4 5.6 8.1 5.4 7.9 4.8 9.3 4.6 9.3 4z"/>'],
  ["gearlo","Gear loadouts",'<path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z"/>'],
  ["orgs","My orgs",'<rect x="9" y="3" width="6" height="5" rx="1.2"/><rect x="3" y="16" width="6" height="5" rx="1.2"/><rect x="15" y="16" width="6" height="5" rx="1.2"/><path d="M12 8v4M6 16v-4h12v4"/>'],
  ["listings","My listings",'<path d="M4 7h16l-1.5 12h-13zM8 7V5a4 4 0 018 0v2"/>'],
  ["privacy","Profile privacy",'<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>']];
S.pfView=S.pfView||"overview";
const pfSignedIn=()=>!!(S.acct?.signed_in||S.drProf?.username||S.drHasSecret);
const pfPhoto=()=>pfSignedIn()?(S.pfPhoto||S.drProf?.avatar||S.drProf?.avatar_url||null):null;
// Your one name in Quantum: your username (made from your UEX name until you choose your own)
const pfName=()=>S.so?.st?.me?.username||S.acct?.username||S.drProf?.username||S.acct?.uex||"";
function pfAvatar(){ const u=pfPhoto(), n=pfName();
  return u?`<img src="${esc(u)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">`:n?`<span>${esc(n[0].toUpperCase())}</span>`:PF_PERSON; }
const pfDate=x=>{ if(!x) return null; const d=typeof x==="number"?new Date(x<1e12?x*1000:x):new Date(x); return isNaN(d)?null:d.toLocaleDateString([], {year:"numeric",month:"short",day:"numeric"}); };
function syncRailMe(){ const b=$("rail-me"); if(!b) return; const on=pfSignedIn();
  const html=pfAvatar(); if($("rail-av").dataset.h!==html){ $("rail-av").innerHTML=html; $("rail-av").dataset.h=html; }
  b.classList.toggle("out",!on); $("rail-dot").hidden=!on; b.title=on?(pfName()?`${pfName()}: your profile`:"Your profile"):"Sign in";
  if(S.pfReady) try{ localStorage.setItem("q-me",JSON.stringify({on,html})); }catch(_){} }
// The picture from last time, drawn before anything's asked of the app, so the rail is never blank at start
try{ const m=JSON.parse(localStorage.getItem("q-me")||"null"); if(m&&typeof m.html==="string"){ $("rail-av").innerHTML=m.html; $("rail-av").dataset.h=m.html;
  $("rail-me").classList.toggle("out",!m.on); $("rail-dot").hidden=!m.on; } }catch(_){}
// Everything the profile shows: asked for at start (for the picture on the rail), and again when it opens
async function pfPrime(force){ S.pfAt=Date.now(); const jobs=[];
  if(force||S.acct===undefined||S.acct===null) jobs.push(api().account_status().then(x=>{ S.acct=x; S.acctAt=Date.now(); }).catch(()=>{}));
  if(force||S.pfPhoto===undefined) jobs.push(api().profile_photo().then(x=>{ S.pfPhoto=x?.photo||null; }).catch(()=>{ S.pfPhoto=null; }));
  if(S.drHasSecret&&(force||!S.drProf)) jobs.push(drProfLoad(force).catch(()=>{}));
  if(S.drHasSecret) jobs.push(drTrustLoad(force).catch(()=>{}));
  if(force||S.bk===undefined||S.bk===null) jobs.push(api().backup_status().then(x=>{ S.bk=x; }).catch(()=>{}));
  if(S.live?.log?.uex_token&&(force||!S.pfFleet)) jobs.push(api().fleet_list().then(x=>{ if(x?.ok) S.pfFleet=x.ships; }).catch(()=>{}));
  if(force||!S.gl.list) jobs.push(glLoad().catch(()=>{}));
  if(force||!S.pfPrefs) jobs.push(api().profile_prefs().then(x=>{ S.pfPrefs=x?.prefs||{}; }).catch(()=>{ S.pfPrefs=S.pfPrefs||{}; }));
  await Promise.allSettled(jobs); S.pfReady=true; syncRailMe(); if(S.tab==="profile") renderProfile(true); pfPublish(); }
function openProfile(){ renderProfile(true); pfPrime(Date.now()-(S.pfAt||0)>60000); }
function openProfileView(v){ S.pfView=v||"overview"; if(S.tab==="profile") return renderProfile(true); document.querySelector('.tab[data-tab="profile"]').click(); }
function renderProfile(force){ if(S.tab!=="profile") return;
  const a=document.activeElement;
  if(!force&&a&&($("pf-panel").contains(a)||$("pane-profile").contains(a))&&/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;   // don't redraw under typing
  pfSide(); pfMain(); syncRailMe(); }
function pfSide(){ const on=pfSignedIn(), p=S.drProf, t=S.drTrust, nm=pfName();
  const trusted=!!(p?.trust?.trusted||t?.trusted), rankI=p?.ranks?p.ranks.findIndex(x=>x[1]===p.rank?.name):-1;
  const counts={fleet:S.pfFleet?.length||"",gearlo:S.gl.list?.length||"",orgs:S.og.mine?.orgs?.length||"",listings:(S.pm.mine?.listings||[]).filter(l=>l.status==="active").length||""};
  $("pane-profile").innerHTML=`<div class="pf-me">
      <div class="pf-av-wrap"><div class="pf-av ${on?"":"out"}">${pfAvatar()}</div>
        <button class="pf-cam" data-pf="photo" aria-label="Change your profile photo" title="Change your profile photo">${IC_CAM}</button></div>
      <b class="pf-name">${esc(on?(nm||"Your profile"):"Not signed in")}</b>
      ${S.acct?.email?`<div class="muted pf-mail">${esc(S.acct.email)}</div>`:""}
      ${on?`<div class="pf-badges">${trusted?`<span class="pf-trust">✓ Trusted datarunner</span>`:p?.username?`<span class="pf-trust no">Not trusted yet</span>`:""}
        ${p?.rank?`<span class="rank-badge r${Math.max(0,rankI)}">${esc(p.rank.name)}</span>`:""}</div>`:""}
      ${S.pfPhoto?`<button class="btn small ghost" data-pf="photo-remove">Remove photo</button>`:""}
    </div>
    <nav class="pf-nav" aria-label="Profile">${PF_VIEWS.map(([k,l,ic])=>`<button data-pfv="${k}" class="${S.pfView===k?"on":""}" ${S.pfView===k?'aria-current="page"':""}><svg viewBox="0 0 24 24" aria-hidden="true">${ic}</svg><span>${l}</span>${counts[k]?`<span class="n">${counts[k]}</span>`:""}</button>`).join("")}</nav>
    ${on?`<div class="pf-foot" style="flex-direction:column;align-items:center">${S.pfOutAsk?`<div class="muted" style="font-size:12px;text-align:center;line-height:1.45;margin:0 6px 10px"><b style="color:var(--ink)">Sign out of Quantum?</b><br>You'll be signed out of your Quantum account and the Quantum server, and your UEX keys come off this PC, so nothing stays connected. Your ships, waypoints, routes and loadouts stay here.</div>
        <div class="row" style="gap:8px"><button class="btn small danger" data-pf="signout-yes">Confirm sign out</button><button class="btn small ghost" data-pf="signout-no">Cancel</button></div>`
      :`<button class="btn small ghost" data-pf="signout" style="color:#ff9b8a">Sign out</button>`}</div>`:""}
    <input type="file" id="pf-file" accept="image/png,image/jpeg,image/webp" hidden>`; }
function pfMain(){ const P=$("pf-panel"), v=S.pfView, on=pfSignedIn(), p=S.drProf, lg=S.live?.log||{};
  // Laid out like the ship and item pages: a title with headline numbers, then flat sections with thin rules
  const head=(t,sub,hero,rest)=>`<div class="mkp-head" style="grid-template-columns:1fr;margin-bottom:8px"><div class="hd-main"><div class="hd-title"><div><h2>${esc(t)}</h2>${sub?`<div class="sub">${sub}</div>`:""}</div></div>${hero?statBlock(hero,rest||[]):""}</div></div>`;
  const sec=(h,body,note,wide)=>`<div class="vd-sec"${wide?' style="grid-column:1/-1"':""}><div class="mk-h">${h}${note?`<span class="mk-note">${note}</span>`:""}</div>${body}</div>`;
  const row=(k,val)=>`<div class="vd-row"><span>${k}</span><b>${val}</b></div>`;
  const grid=(x,cls="")=>`<div class="vd-grid vd-flat bp-grid pf-flat ${cls}">${x}</div>`;
  const acct=acctHtml();
  if(v==="accounts"){
    P.innerHTML=`${head("Linked accounts","Your Quantum account and your UEX keys")}${grid(
      (acct?sec("Quantum account",`<div class="note">${acct}</div>`,"one account for Quantum and quantumsc.org"):"")
      +sec("UEX",`<div class="note">${uexSectionInner()}</div>`,"prices, fleet, vehicles, components and datarunning"),"pf-one")}`;
    fillUexStatus(false); return; }
  if(v==="backup"){ const bk=S.bk;
    P.innerHTML=`${head("Backup","Encrypted on this PC, kept on the Quantum server",
        [{label:"Last backup",value:bk?.at?fmtAgo(bk.at):bk?.off?"Off":"Not yet"},{label:"Status",value:!bk?"Checking":!bk.on?"Off":!bk.has_key?"Needs UEX":bk.off?"Off":"On"}])}
      ${grid(sec("Your backup",`<div class="note">${backupInner()}</div>`),"pf-one")}`; return; }
  if(v==="submissions"){
    const c=(p?.contrib||[]).slice().sort((x,y)=>(y.at||0)-(x.at||0));
    P.innerHTML=`${head("Submissions","Prices, pictures, station positions and alignments you've sent",
        p?.ok?[{label:"Approved",value:(p.accepted||0).toLocaleString()},{label:"Sent",value:(p.reports||0).toLocaleString()},{label:"Rating",value:p.rated?`${p.stars.toFixed(1)} ★`:"–"}]:null)}
      ${p?.ok?drProfileCard(p):`<div class="empty">${S.drHasSecret?"Loading your datarunner profile…":"Add your UEX Secret Key under Linked accounts to see your submissions, rank and rating."}</div>`}
      ${S.drHasSecret&&lg.uex_token?`<div class="row" style="margin:12px 2px"><button class="btn small" data-pf="mine">Open all my price reports</button></div>`:""}
      ${c.length?grid(sec("Pictures, stations and alignments",c.slice(0,40).map(drContribCard).join(""),plural(c.length,"item"),true)):""}`; return; }
  if(v==="fleet"||v==="gearlo"||v==="orgs"||v==="listings") return pfArrangeView(v);
  if(v==="privacy") return pfPrivacyView();
  // Overview
  if(!on){
    P.innerHTML=`${head("Sign in","Everything in Quantum works without an account")}${grid(
      (acct?sec("Quantum account",`<div class="note">${acct}</div>`):sec("Connect with UEX",`<div class="note">${uexSectionInner()}</div>`))
      +sec("What you get",[["Backups","Your fleet, loadouts, waypoints, trade runs and mapped stations, encrypted, back on any PC"],
          ["Your name on what you find","Price reports, pictures, station positions and planet alignments count toward your rank"],
          ["Trusted status","Once you're trusted, what you send goes live for everyone straight away"],
          ["A profile photo","On the rail here, and kept with your Quantum account on any PC"]]
        .map(([a,b])=>`<div class="mk-row"><div class="w">${a}<div class="m">${b}</div></div><div class="p"></div><span></span></div>`).join("")))}`;
    if(!acct) fillUexStatus(false); return; }
  const bk=S.bk, T=drTrustNow(), trusted=!!(p?.trust?.trusted||T?.trusted);
  const c=(p?.contrib||[]).slice().sort((x,y)=>(y.at||0)-(x.at||0)).slice(0,6);
  const what={photo:"Picture",alignment:"Alignment",pad:"Landing pad",missing:"Doesn't exist",place:"Station position"};
  const ships=S.pfFleet||[], los=(S.gl.list||[]).slice().sort((a,b)=>(b.main?1:0)-(a.main?1:0));
  const shipsOn=pfOrdered(ships,x=>x.uid,"ships",true), losOn=pfOrdered(los,x=>x.id,"gearlo",true);
  const link=(k,t)=>`<a data-pfv="${k}" style="cursor:pointer;color:var(--route-2);margin-left:auto;text-transform:none;letter-spacing:0;font-weight:500;font-size:12px">${t}</a>`;
  // The trusted-contributor checklist, met or not, from the server's own criteria
  const ck=T?.info?.checks, tick=(ok,label,val)=>`<div class="vd-row"><span><i class="pf-ck ${ok?"ok":""}" aria-label="${ok?"Met":"Not met yet"}">${ok?"✓":""}</i>${label}</span><b>${val}</b></div>`;
  const trustBody=`<div style="font-size:13px;line-height:1.55;color:var(--ink-2);padding:6px 0 8px">${T?.info?.revoked?"Trust was turned off for your account by the server owner."
      :trusted?`As a trusted contributor your pictures and station positions go live straight away. Failing to maintain the below criteria can result in losing your trusted contributor status.`
      :"Meet all of these and you're trusted: your pictures and station positions go live without waiting for review."}</div>
    ${ck?[tick(ck.reports.ok,`${ck.reports.need} approved price reports`,`${ck.reports.have} / ${ck.reports.need}`),
          tick(ck.days.ok,`${ck.days.need} days since your first approved report`,`${ck.days.have} / ${ck.days.need}`),
          tick(ck.clean.ok,`No rejections in the last ${ck.clean.days} days`,ck.clean.have?`${ck.clean.have} rejected`:"None"),
          tick(ck.approval.ok,`${ck.approval.need}% approval or better`,ck.approval.have!=null?`${ck.approval.have}%`:"–")].join("")
      :`<div class="muted" style="font-size:12.5px">${!S.drHasSecret?"Add your UEX Secret Key to start."
          :!T?"Checking your progress…"
          :!T.ok?(T.sign_in_status==="invalid_secret_key"?"UEX didn't accept your secret key: copy it again from your UEX profile into Linked accounts."
                 :`Couldn't check your progress with the Quantum server just now. <a data-pf="trust-retry" style="cursor:pointer;color:var(--route-2)">Try again</a>`)
          :T.info?.owner?"You're the server owner, so there's no checklist to meet."
          :trusted?"You meet every criterion.":"The Quantum server didn't send your progress."}</div>`}`;
  const uexName=S.drProf?.username||S.acct?.uex;
  const keys=`<div class="vd-row"><span>Quantum account</span>${connPill(S.acct?.signed_in?"ok":"none",S.acct?.signed_in?"Connected":null)}</div>
    <div class="vd-row"><span>UEX Bearer Token</span>${connPill(lg.uex_token?"ok":"none",lg.uex_token?"Connected":null)}</div>
    <div class="vd-row"><span>UEX Secret Key</span>${connPill(S.drHasSecret?"ok":"none",S.drHasSecret?"Connected":null)}</div>
    ${uexName?`<div class="vd-row"><span>UEX name</span><b>${esc(uexName)}</b></div>`:""}`;
  const backupBody=`${row("Status",esc(!bk?"Checking…":!bk.on?"Off":!bk.has_key?"Needs your UEX Bearer Token":bk.off?"Off for this PC":"On"))}${row("Last backup",esc(bk?.at?fmtAgo(bk.at):"Not yet"))}
    ${bk?.on&&bk?.has_key&&!bk.off?`<div class="row" style="gap:6px;margin-top:10px"><button class="btn small" data-a="bknow" ${S.bkBusy?"disabled":""}>${S.bkBusy==="save"?"Backing up…":"Back up now"}</button></div>`:""}`;
  const subs=c.length?c.map(x=>{ const [l,col]=CB_ST[x.status]||[x.status||"",var_dim];
      return `<div class="mk-row"><div class="w">${esc(what[x.type]||"Station position")}<div class="m">${esc(x.name||"")}${x.at?` · ${fmtAgo(x.at)}`:""}</div></div><div class="p" style="color:${col};font-size:12px;white-space:nowrap">${esc(l)}</div><span></span></div>`; }).join("")
    :`<div class="muted" style="font-size:13px;padding:6px 0">${S.drHasSecret?"Nothing sent yet. Pictures, station positions and alignments you send show up here.":"Add your UEX Secret Key under Linked accounts to send reports."}</div>`;
  const fleet=!lg.uex_token?`<div class="muted" style="font-size:13px;padding:6px 0">Add your UEX Bearer Token to keep your fleet here.</div>`
    :ships.length?!shipsOn.shown.length?`<div class="muted" style="font-size:13px;padding:6px 0">No ships chosen to show. <a data-pfv="fleet" style="cursor:pointer;color:var(--route-2)">Choose some</a></div>`:`<div class="grid" style="margin-top:8px">${shipsOn.shown.map(x=>`<div class="vg" data-pfship="${esc(x.uid||"")}"><div class="ph ph-g">${x.photo?`<img src="${esc(x.photo)}" alt="" loading="lazy" referrerpolicy="no-referrer">`:phCard("vehicle")}</div>
        <div class="tx"><b>${x.main?"★ ":""}${esc(x.full||x.name||"")}</b><span>${esc([x.maker,x.scu?`${x.scu} SCU`:"",x.loadouts>1?plural(x.loadouts,"loadout"):""].filter(Boolean).join(" · "))}</span></div></div>`).join("")}</div>
`
    :`<div class="muted" style="font-size:13px;padding:6px 0">No ships yet.</div>`;
  const gear=los.length?!losOn.shown.length?`<div class="muted" style="font-size:13px;padding:6px 0">No loadouts chosen to show. <a data-pfv="gearlo" style="cursor:pointer;color:var(--route-2)">Choose some</a></div>`
      :`<div class="grid" style="margin-top:8px">${losOn.shown.map(glCard).join("")}</div>`
    :`<div class="muted" style="font-size:13px;padding:6px 0">No gear loadouts yet. Make one for each kind of job in Gear › Loadouts. <a data-pfv="opengearlo" style="cursor:pointer;color:var(--route-2)">Make one</a></div>`;
  P.innerHTML=`${p?.ok&&p.username?drProfileCard(p,pfName()):head(pfName()||"Your profile",S.acct?.email?esc(S.acct.email):"")}
    ${statBlock([{label:"Joined",value:pfDate(S.acct?.joined||p?.first_seen)||"–"},{label:"Last online",value:!S.acct?.signed_in?"–":S.so?.my==="invisible"?"Invisible":S.so?.my==="away"?"Away":"Online now"},
      {label:"Ships",value:lg.uex_token?String(ships.length):"–"},{label:"Gear loadouts",value:String(los.length)}],[])}
    <div class="pf-ov vd-flat">
      ${sec(`Trusted contributor`,trustBody,trusted?`<span style="color:#57e39b">✓ trusted</span>`:"")}
      <div>${sec(`Linked accounts${link("accounts","Manage")}`,keys)}${sec(`Backup${link("backup","More")}`,backupBody)}</div>
      ${sec(`Recent submissions${link("submissions","See all")}`,subs)}
      ${pfCommunityHtml()}
      ${shipsOn.off?"":`<div class="vd-sec vd-full"><div class="mk-h">My fleet<span class="mk-note">${ships.length?plural(ships.length,"ship"):""}</span>${lg.uex_token&&ships.length?link("fleet","Arrange"):""}</div>${fleet}</div>`}
      ${losOn.off?"":`<div class="vd-sec vd-full"><div class="mk-h">My personal loadouts<span class="mk-note">${los.length?plural(los.length,"loadout"):""}</span>${los.length?link("gearlo","Arrange"):""}</div>${gear}</div>`}
    </div>`;
  fillGearPictures(P); }
const var_dim="var(--dim)";
// ---- Profile overview: your orgs and what you have up on the marketplace (loaded once, when the overview opens)
// Asked again when the last answer was an error (signed out at the time, the server was busy): the overview
// used to keep that first answer, so your orgs never showed after signing in.
function pfStale(m,at){ return m===null||((m?.error||m?.signed_in===false)&&Date.now()-(at||0)>10000); }
function pfLoadOrgs(){ if(S.pfOgBusy||!pfStale(S.og.mine,S.pfOgAt)) return; S.pfOgBusy=true; S.pfOgAt=Date.now();
  ogLoadMine().finally(()=>{ S.pfOgBusy=false; renderProfile(true); }); }
function pfCommunityHtml(){ if(!S.acct?.signed_in) return "";
  pfLoadOrgs();
  if(pfStale(S.pm.mine,S.pfPmAt)&&!S.pfPmBusy){ S.pfPmBusy=true; S.pfPmAt=Date.now(); pmLoadMine().finally(()=>{ S.pfPmBusy=false; renderProfile(true); }); }
  const go=(attr,t)=>`<a ${attr} style="cursor:pointer;color:var(--route-2);margin-left:auto;text-transform:none;letter-spacing:0;font-weight:500;font-size:12px">${t}</a>`;
  const om=S.og.mine, pm=S.pm.mine, oO=pfOrdered(om?.orgs||[],x=>x.id,"orgs",true), oL=pfOrdered((pm?.listings||[]).filter(l=>l.status==="active"),x=>x.id,"listings",true);
  const orgs=oO.shown, ls=oL.shown;
  const items=ls.filter(l=>l.kind!=="service"), svcs=ls.filter(l=>l.kind==="service");
  const orgBody=!om?`<div class="muted" style="font-size:13px;padding:6px 0">Loading…</div>`:om.error?`<div class="muted" style="font-size:13px;padding:6px 0">${esc(om.error)}</div>`
    :(om.orgs||[]).length&&!orgs.length?`<div class="muted" style="font-size:13px;padding:6px 0">No orgs chosen to show. <a data-pfv="orgs" style="cursor:pointer;color:var(--route-2)">Choose some</a></div>`
    :orgs.length?orgs.map(o=>`<div class="pf-org" data-pforg="${esc(String(o.id))}">${ogLogo(o,1)}<div class="who"><b>${esc(o.name)}${o.verified?` <span style="color:#9fe0b4" title="Verified with RSI">✓</span>`:""}</b><small>[${esc(o.tag)}]${o.my_rank?` · ${esc(o.my_rank)}`:""}${o.owner?" · Owner":""}</small></div></div>`).join("")
    :`<div class="muted" style="font-size:13px;padding:6px 0">You're not in an org yet. <a data-pftab="orgs" style="cursor:pointer;color:var(--route-2)">Find or create one</a></div>`;
  const mini=l=>`<div class="pm-mini" data-pflisting="${esc(String(l.id))}" data-pfkind="${l.kind==="service"?"pm-services":"pm-items"}">${pmPh(l.photo)}<div class="who"><b>${esc(l.title)}</b><small>${l.unit==="quote"?"Quote":pmA(l.price)}${l.kind==="item"?` · ${l.qty} left`:""}</small></div></div>`;
  const grp=(t,list)=>list.length?`<div class="pf-subh">${t} <span class="muted">${list.length}</span></div><div class="pm-mylist">${list.slice(0,6).map(mini).join("")}</div>`:"";
  const lsBody=!pm?`<div class="muted" style="font-size:13px;padding:6px 0">Loading…</div>`:pm.error?`<div class="muted" style="font-size:13px;padding:6px 0">${esc(pm.error)}</div>`
    :oL.all.length&&!ls.length?`<div class="muted" style="font-size:13px;padding:6px 0">No listings chosen to show. <a data-pfv="listings" style="cursor:pointer;color:var(--route-2)">Choose some</a></div>`
    :ls.length?grp("Items for sale",items)+grp("Services",svcs)
    :`<div class="muted" style="font-size:13px;padding:6px 0">Nothing up for sale. <a data-pftab="pm-items" style="cursor:pointer;color:var(--route-2)">Sell an item</a> or <a data-pftab="pm-services" style="cursor:pointer;color:var(--route-2)">offer a service</a>.</div>`;
  return `${oO.off?"":`<div class="vd-sec"${oL.off?' style="grid-column:span 3"':""}><div class="mk-h">My orgs${om&&!om.error?`<span class="mk-note">${orgs.length||""}</span>`:""}${go('data-pfv="orgs"',"Arrange")}</div>${orgBody}</div>`}
    ${oL.off?"":`<div class="vd-sec" style="grid-column:span ${oO.off?3:2}"><div class="mk-h">My listings${ls.length?`<span class="mk-note">${ls.length} shown</span>`:""}${go('data-pfv="listings"',"Arrange")}</div>${lsBody}</div>`}`; }
// ---- What your profile shows of your fleet and gear loadouts: which ones, in what order, and how many.
const PF_COUNTS=[1,2,3,4,5,6,7,8,9,10];
// The saved choices, or the draft being changed on the Arrange page (saved with Save)
const pfPref=key=>S.pfDraft?.[key]||S.pfPrefs?.[key]||{};
function pfOrdered(list,idOf,key,saved){ const dflt=key==="orgs"?10:8; const pr=(saved?S.pfPrefs?.[key]:pfPref(key))||{}, ord=pr.order||[], hid=new Set(pr.hidden||[]), pos=new Map(ord.map((id,i)=>[String(id),i]));
  const all=list.map((x,i)=>[x,i]).sort((a,b)=>(pos.get(String(idOf(a[0])))??1e6+a[1])-(pos.get(String(idOf(b[0])))??1e6+b[1])).map(([x])=>x);
  const count=Math.max(1,Math.min(10,pr.count??dflt)); return {all, shown:all.filter(x=>!hid.has(String(idOf(x)))).slice(0,count), count, hidden:hid, off:!!pr.off}; }
const pfDirty=key=>!!S.pfDraft?.[key]&&JSON.stringify(S.pfDraft[key])!==JSON.stringify(S.pfPrefs?.[key]||{});
// ---- Anti-AFK (Settings > Hotkeys): a harmless input every 1 to 4 minutes, at random, so the game doesn't log you out
function afkHtml(a){ const f=a.afk||{}, keys=["","F5","F6","F7","F8","F9","F10","F11","F12"], used=[a.hotkey,a.loc_hotkey,a.shot_hotkey,a.chat_key].filter(Boolean);
  const nx=f.on&&f.next?Math.max(0,Math.round(f.next-Date.now()/1000)):null;
  return `<div class="afk-box"><div class="row" style="gap:10px"><span class="dot ${f.on?"on":""}"></span><div style="flex:1;min-width:0"><b>Anti-AFK</b>
      <div class="muted" style="font-size:12px">${f.on?`On${nx!=null?` · next in ${nx>=60?Math.round(nx/60)+" min":nx+" s"}`:""}${f.last?` · last ${new Date(f.last*1000).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}`:""}`:"Off. Keeps the game from logging you out"}</div></div>
      <button class="btn small ${f.on?"":"primary"}" id="s-afktoggle">${f.on?"Turn off":"Turn on"}</button></div>
    <div class="setgrid" style="margin-top:8px">
      <span class="k">On / off key</span><select class="field" id="s-afkkey">${keys.map(k=>`<option value="${k}" ${k===(f.hotkey||"")?"selected":""} ${k&&used.includes(k)?"disabled":""}>${k||"Off "}${k&&used.includes(k)?" (used)":""}</option>`).join("")}</select>
      <span class="k" title="What Quantum sends every 1 to 4 minutes">It sends</span><select class="field" id="s-afkact">
        <option value="nudge" ${f.action!=="f13"&&f.action!=="mobiglas"?"selected":""}>Tiny mouse nudge</option>
        <option value="f13" ${f.action==="f13"?"selected":""}>F13 (unused key)</option>
        <option value="mobiglas" ${f.action==="mobiglas"?"selected":""}>mobiGlas open/close</option></select></div>
    <label class="row" style="gap:8px;margin-top:6px;cursor:pointer;font-size:12.5px"><input type="checkbox" id="s-afkfocus" ${f.focus?"checked":""}> Switch to Star Citizen if not in focus.</label>
    <div class="muted" style="font-size:11.5px;margin-top:4px">Use Anti-AFK feature at your own risk.</div></div>`; }
// ---- Location clock: drag it to a custom spot on a picture of the game window (saved as fractions of it)
async function ccPlacer(){ const box=$("cc-scr"), img=$("cc-drag"), cc=S.live?.city_clock; if(!box||!img||!cc) return;
  const key=`${cc.size}|${cc.h24}`;
  if(!S.ccImg||S.ccImg.key!==key){ const r=await api().city_clock_image(cc.in_city||"New Babbage").catch(()=>null); if(!r?.ok) return; S.ccImg={...r,key}; }
  if(!$("cc-drag")||$("cc-drag")!==img) return;
  const im=S.ccImg, W=()=>box.clientWidth, H=()=>box.clientHeight, w=()=>im.w*W()/1920, h=()=>im.h*W()/1920;
  // where it is: what you last dropped it at (kept even if the screen redraws before the save comes back), else what's saved
  // a preset: worked out the same way as the overlay (city_clock.py) does, for a 16:9 window
  const preset=()=>{ const ww=w(), hh=h(), Wd=W(), Hd=H(), m=Hd*0.03, cx=x=>(x+ww/2)/Wd;
    switch(cc.position){
      case "upper": return {x:0.5,y:0.20}; case "bottom": return {x:0.5,y:0.72};
      case "center": return {x:0.5,y:(Hd-hh)/2/Hd};
      case "top-right": return {x:cx(Wd-ww-m),y:0.07};
      case "bottom-right": return {x:cx(Wd-ww-m),y:(Hd-hh-Hd*0.12)/Hd};
      default: return {x:0.5,y:0.07}; } };
  let pos=cc.position==="custom"?(S.ccPos||{x:cc.x??0.5,y:cc.y??0.07}):preset();
  const place=()=>{ const ww=w(), hh=h();
    img.style.width=ww+"px"; img.style.left=Math.max(0,Math.min(W()-ww,pos.x*W()-ww/2))+"px"; img.style.top=Math.max(0,Math.min(H()-hh,pos.y*H()))+"px"; };
  img.src=im.image; img.hidden=false; place();
  img.onpointerdown=e=>{ e.preventDefault(); S.ccDrag=true; box.classList.add("drag");
    const r=box.getBoundingClientRect(), ox=e.clientX-(r.left+parseFloat(img.style.left)+w()/2), oy=e.clientY-(r.top+parseFloat(img.style.top));
    const move=ev=>{ pos={x:Math.min(1,Math.max(0,(ev.clientX-ox-r.left)/r.width)),y:Math.min(1,Math.max(0,(ev.clientY-oy-r.top)/r.height))}; place(); };
    const up=async()=>{ window.removeEventListener("pointermove",move); window.removeEventListener("pointerup",up);
      box.classList.remove("drag");
      // keep it to where the whole clock fits, and save that
      pos={x:(parseFloat(img.style.left)+w()/2)/W(), y:parseFloat(img.style.top)/H()};
      S.ccPos=pos; S.ccDrag=false;
      const wasPreset=cc.position!=="custom";
      await api().set_city_clock(null,"custom",null,null,null,+pos.x.toFixed(4),+pos.y.toFixed(4));
      if(S.live?.city_clock) Object.assign(S.live.city_clock,pos,{position:"custom"});
      toast(wasPreset?"Clock position saved: Position is now Custom":"Clock position saved");
      if(wasPreset){ if($("s-ccpos")) $("s-ccpos").value="custom"; renderDetail(); } };
    window.addEventListener("pointermove",move); window.addEventListener("pointerup",up); };
  img.ondragstart=e=>e.preventDefault(); }
// ---- Profile privacy: who can open your profile, and whether it shows your datarunner stats
function pfPrivacyView(){ const P=$("pf-panel"), saved=S.pfPrefs||{}, dr=S.pfPrivDraft||{}, sees=dr.sees||saved.sees||"everyone";
  const statsOff=dr.stats_off??!!saved.stats_off, dirty=(dr.sees&&dr.sees!==(saved.sees||"everyone"))||(dr.stats_off!=null&&dr.stats_off!==!!saved.stats_off);
  const opt=(v,t,d)=>`<label class="pf-priv ${sees===v?"on":""}"><input type="radio" name="pf-sees" value="${v}" ${sees===v?"checked":""}><span><b>${t}</b><small>${d}</small></span></label>`;
  P.innerHTML=`<div class="mkp-head" style="grid-template-columns:1fr;margin-bottom:8px"><div class="hd-main"><div class="hd-title"><div><h2>Profile privacy</h2>
    <div class="sub">People open your profile by clicking your name in Social, the marketplace and orgs.</div></div></div></div></div>
    <div class="vd-flat" style="max-width:760px"><div class="vd-sec"><div class="mk-h">Who can see your profile</div>
      <div class="pf-privs">${opt("everyone","Everyone on Quantum","Anyone signed in to Quantum can see what your profile shows.")}
        ${opt("friends","Friends only","Others see your name and picture, and that your profile is for friends.")}
        ${opt("nobody","Only me","Others see your name and picture only.")}</div></div>
      <div class="vd-sec"><div class="mk-h">What it shows</div>
        <div class="vd-row"><span>Your datarunner rank, rating and approved reports</span><label class="row" style="gap:6px;cursor:pointer;font-size:13px"><input type="checkbox" id="pf-stats" ${statsOff?"":"checked"}> ${statsOff?"Hidden":"Shown"}</label></div>
        ${Object.entries(PF_ARR).map(([v,A])=>{ const off=!!saved[A.key]?.off; return `<div class="vd-row"><span>${A.sec}</span><a data-pfv="${v}" style="cursor:pointer;color:var(--route-2);font-size:13px">${off?"Hidden":"Shown"} · Arrange</a></div>`; }).join("")}</div>
      <div class="row" style="gap:8px;margin:4px 2px;align-items:center;flex-wrap:wrap"><button class="btn primary" id="pf-privsave" ${dirty?"":"disabled"}>Save Settings</button>
        ${dirty?`<button class="btn ghost" id="pf-privx">Discard changes</button><span style="font-size:12.5px;color:#ffd38a">Unsaved changes</span>`:`<span class="muted" style="font-size:12.5px">${S.pfPubAt?`Saved · profile updated ${fmtAgo(S.pfPubAt)}`:"No changes"}</span>`}
        <span class="spacer"></span><a data-pfv="preview" style="cursor:pointer;color:var(--route-2);font-size:13px">See your profile as others do</a></div></div>`;
  for(const r of P.querySelectorAll('input[name="pf-sees"]')) r.onchange=()=>{ S.pfPrivDraft={...(S.pfPrivDraft||{}),sees:r.value}; renderProfile(true); };
  $("pf-stats").onchange=e=>{ S.pfPrivDraft={...(S.pfPrivDraft||{}),stats_off:!e.target.checked}; renderProfile(true); };
  if($("pf-privx")) $("pf-privx").onclick=()=>{ S.pfPrivDraft=null; renderProfile(true); };
  $("pf-privsave").onclick=async()=>{ const r=await api().profile_prefs_set({...(S.pfPrefs||{}),...(S.pfPrivDraft||{})}).catch(()=>null); if(!r?.ok) return toast("Couldn't save. Try again");
    S.pfPrefs=r.prefs; S.pfPrivDraft=null; await pfPublish(true); toast("Settings saved"); renderProfile(true); }; }
// ---- What other people see: published to the Quantum server (your ships and loadouts live on this PC).
// Sent when the profile has loaded and whenever you change what it shows; skipped when nothing changed.
async function pfPublish(force){ if(!S.acct?.signed_in||!S.pfPrefs||!S.live?.log) return;
  const lg=S.live.log, pr=S.pfPrefs;
  if(lg.uex_token&&!S.pfFleet) return;                       // not loaded yet: don't publish an empty fleet
  if(!S.gl.list) return;
  const sh=pfOrdered(S.pfFleet||[],x=>x.uid,"ships",true), gl=pfOrdered((S.gl.list||[]).slice().sort((a,b)=>(b.main?1:0)-(a.main?1:0)),x=>x.id,"gearlo",true);
  const body={sees:pr.sees||"everyone", stats_off:!!pr.stats_off, prefs:{orgs:pr.orgs||{}, listings:pr.listings||{}},
    ships:!lg.uex_token||sh.off?null:sh.shown.map(x=>({name:x.full||x.name||"", maker:x.maker||"", scu:x.scu||null, photo:x.photo||null, main:!!x.main})),
    gear:gl.off?null:gl.shown.map(lo=>({name:lo.name, scenario:lo.scenario||"", main:!!lo.main, items:glItems(lo).filter(i=>i.name).map(i=>({slot:i.slot, name:i.name, qty:i.qty||1}))}))};
  const key=JSON.stringify(body); let last=null; try{ last=localStorage.getItem("q-pub"); }catch(_){}
  if(!force&&last===key&&S.pfPubAt) return;
  const r=await api().social_profile_publish(body).catch(()=>null);
  if(r?.ok){ S.pfPubAt=Date.now()/1000; try{ localStorage.setItem("q-pub",key); }catch(_){} } }
// ---- Someone's profile, opened from their name anywhere in Social, the marketplace and orgs
async function upOpen(who){ if(!who) return; S.up={who,loading:true}; upRender();
  const r=await api().social_profile(who).catch(()=>null); if(S.up?.who!==who) return;
  S.up=r?.ok?{who,d:r}:{who,err:r?.error||"Couldn't load this profile."}; upRender(); }
function upClose(){ S.up=null; $("up-view")?.remove(); }
function upRender(){ let V=$("up-view"); if(!S.up) return upClose();
  if(!V){ V=document.createElement("div"); V.id="up-view"; V.className="up-back"; document.body.appendChild(V);
    V.onclick=e=>{ if(e.target===V) upClose(); }; }
  const u=S.up, d=u.d;
  if(!d){ V.innerHTML=`<div class="up-card"><button class="up-x" data-upx="1" aria-label="Close">×</button><div class="so-empty" style="padding:40px">${u.loading?"Loading…":esc(u.err)}</div></div>`; return upWire(V); }
  const p=d.person, st=d.stats, lists=d.listings, rt=d.rating;
  const since=pfDate(d.joined);
  const rel=d.relation, acts=rel==="me"?`<span class="muted" style="font-size:12.5px">This is how others see your profile</span>`
    :`${rel==="friends"?`<span class="pm-badge ok">✓ Friends</span>`:rel==="requested"?`<span class="muted" style="font-size:12.5px">Friend request sent</span>`
      :rel==="incoming"?`<button class="btn small primary" data-upacc="1">Accept friend request</button>`:`<button class="btn small primary" data-upadd="1">Add friend</button>`}
      ${d.can_message?`<button class="btn small" data-upmsg="1">Message</button>`:""}`;
  const sec=(t,body,note)=>`<div class="vd-sec vd-full"><div class="mk-h">${t}${note?`<span class="mk-note">${note}</span>`:""}</div>${body}</div>`;
  let body="";
  if(d.private){ body=`<div class="empty" style="margin-top:14px"><strong>${d.sees==="friends"?"This profile is for friends":"This profile is private"}</strong>${d.sees==="friends"?`Only ${esc(p.name)}'s friends can see their fleet, loadouts, orgs and listings.`:`${esc(p.name)} keeps their profile to themselves.`}</div>`; }
  else{
    if(st) body+=sec("Datarunner",`<div class="up-stats">${[["Rank",esc(st.rank||"–")],["Rating",st.rated?`${(+st.stars).toFixed(1)} ★`:"–"],["Approved reports",(st.approved||0).toLocaleString()],["Trusted",st.trusted?`<span style="color:#57e39b">✓ Trusted datarunner</span>`:"Not yet"]].map(([k,v])=>`<div><span>${k}</span><b>${v}</b></div>`).join("")}</div>`);
    if(d.orgs) body+=sec("Orgs",d.orgs.length?`<div class="og-cards">${d.orgs.map(o=>`<div class="og-card" data-upog="${o.id}">${ogLogo(o)}<div class="who"><b>${esc(o.name)} <span class="og-tag">${esc(o.tag)}</span> ${ogVer(o)}</b>${o.slogan?`<div class="og-slogan" style="font-size:13px">${esc(o.slogan)}</div>`:""}<small>${esc(o.their_rank||"Member")}${o.owner?" · Owner":""} · ${o.members} member${o.members===1?"":"s"}</small></div></div>`).join("")}</div>`:`<div class="muted" style="font-size:13px;padding:6px 0">Not in an org.</div>`,d.orgs.length||"");
    if(lists){ const items=lists.filter(l=>l.kind!=="service"), svcs=lists.filter(l=>l.kind==="service");
      const mini=l=>`<div class="pm-mini" data-uplist="${l.id}" data-upkind="${l.kind==="service"?"pm-services":"pm-items"}">${pmPh(l.photo)}<div class="who"><b>${esc(l.title)}</b><small>${l.unit==="quote"?"Quote":pmA(l.price)}${l.kind==="item"?` · ${l.qty} left`:""}</small></div></div>`;
      body+=sec("Listings",lists.length?(items.length?`<div class="pf-subh">Items for sale <span class="muted">${items.length}</span></div><div class="pm-mylist">${items.map(mini).join("")}</div>`:"")+(svcs.length?`<div class="pf-subh">Services <span class="muted">${svcs.length}</span></div><div class="pm-mylist">${svcs.map(mini).join("")}</div>`:"")
        :`<div class="muted" style="font-size:13px;padding:6px 0">Nothing for sale right now.</div>`,rt?.count?`${pmStars(rt)} · ${rt.sold} sold`:rt?.sold?`${rt.sold} sold`:""); }
    // Trade reviews: what buyers and sellers said after trading with them (marketplace ratings)
    if(rt&&(rt.count||d.reviews?.length)) body+=sec("Trade reviews",pmReviewsHtml(rt,d.reviews),rt.count?`${rt.count} rating${rt.count===1?"":"s"}`:"");
    const vphoto=x=>x.photo||(S.veh||[]).find(v=>(v.full||v.name)===x.name)?.photo;
    if(d.ships) body+=sec("Fleet",d.ships.length?`<div class="grid" style="margin-top:8px">${d.ships.map(x=>{ const ph=vphoto(x); return `<div class="vg"><div class="ph ph-g">${ph?`<img src="${esc(ph)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">`:phCard("vehicle")}</div><div class="tx"><b>${x.main?"★ ":""}${esc(x.name)}</b><span>${esc([x.maker,x.scu?`${x.scu} SCU`:""].filter(Boolean).join(" · "))}</span></div></div>`; }).join("")}</div>`:`<div class="muted" style="font-size:13px;padding:6px 0">No ships to show.</div>`,d.ships.length||"");
    if(d.gear) body+=sec("Gear loadouts",d.gear.length?`<div class="grid" style="margin-top:8px">${d.gear.map(lo=>{ const pic=["core","helmet","primary","jacket"].map(k=>lo.items.find(i=>i.slot===k)).find(Boolean)||lo.items[0];
        return `<div class="vg up-lo"><div class="ph" ${pic?`data-gpic="${esc(pic.name)}"`:""}>${pic?"":"Empty loadout"}</div><div class="tx"><b>${lo.main?"★ ":""}${esc(lo.name)}</b><span>${esc([lo.scenario,plural(lo.items.length,"item")].filter(Boolean).join(" · "))}</span>
          ${lo.items.length?`<div class="up-items">${lo.items.slice(0,12).map(i=>`<span>${esc(i.name)}${i.qty>1?` ×${i.qty}`:""}</span>`).join("")}</div>`:""}</div></div>`; }).join("")}</div>`:`<div class="muted" style="font-size:13px;padding:6px 0">No loadouts to show.</div>`,d.gear.length||"");
    if(!body) body=`<div class="empty" style="margin-top:14px"><strong>Nothing to show yet</strong>${rel==="me"?"Choose what your profile shows under Profile.":`${esc(p.name)} hasn't chosen anything to show.`}</div>`;
  }
  V.innerHTML=`<div class="up-card"><button class="up-x" data-upx="1" aria-label="Close">×</button>
    <div class="up-head">${(p.online!=null&&d.relation!=="me"?soAvDot(p,true):soAv(p,true)).replace('so-av lg','so-av lg xl')}<div class="who"><h2>${esc(p.name)}</h2>
      <div class="up-meta">${p.online!=null&&rel!=="me"?`<span class="${p.playing?"playing":""}">${esc(soPresence(p))}</span>`:d.online_now&&rel!=="me"?`<span>Online now</span>`:d.last_online&&rel!=="me"?`<span>Last online ${esc(fmtAgo(d.last_online))}</span>`:""}${since?`<span>Member since ${since}</span>`:""}${st?.trusted&&!d.private?`<span class="pf-trust">✓ Trusted datarunner</span>`:""}${st?.rank&&!d.private?`<span class="rank-badge">${esc(st.rank)}</span>`:""}</div>
      <div class="up-acts">${acts}</div></div></div>
    <div class="vd-flat pf-ov up-body">${body}</div></div>`;
  fillGearPictures(V); upWire(V); }
function upWire(V){ const on=(sel,fn)=>{ for(const el of V.querySelectorAll(sel)) el.onclick=e=>{ e.stopPropagation(); fn(el); }; };
  on("[data-upx]",upClose);
  const who=()=>S.up?.d?.person?.id;
  on("[data-upadd]",async el=>{ el.disabled=true; const r=await api().social_request(who()); toast(r.ok?(r.relation==="friends"?"You're friends now":"Friend request sent"):r.error); upOpen(who()); });
  on("[data-upacc]",async el=>{ el.disabled=true; const r=await api().social_respond(who(),true); toast(r.ok?"You're friends now":r.error); upOpen(who()); });
  on("[data-upmsg]",()=>{ const id=who(); upClose(); soOpen(id); });
  on("[data-upog]",el=>{ upClose(); S.og.view="org"; S.og.tab="overview"; S.og.cur=+el.dataset.upog; const t=document.querySelector('.tab[data-tab="orgs"]'); if(S.tab==="orgs") ogOpen(S.og.cur); else t?.click(); });
  on("[data-uplist]",el=>{ upClose(); document.querySelector(`.tab[data-tab="${el.dataset.upkind}"]`)?.click(); pmOpen(+el.dataset.uplist); }); }
document.addEventListener("click",e=>{ const n=e.target.closest?.("[data-upid]"); if(!n||!n.dataset.upid) return; e.stopPropagation(); e.preventDefault(); upOpen(n.dataset.upid); },true);
document.addEventListener("keydown",e=>{ if(e.key==="Escape"&&S.up) upClose(); });
// The four profile sections you can arrange: what they list, and what they're called
const PF_ARR={fleet:{key:"ships",noun:"ship",sec:"My fleet",title:"My fleet on your profile",open:["openfleet","Open My Fleet"],empty:"No ships in My Fleet yet."},
  gearlo:{key:"gearlo",noun:"loadout",sec:"My personal loadouts",title:"Gear loadouts on your profile",open:["opengearlo","Open Gear › Loadouts"],empty:"No gear loadouts yet."},
  orgs:{key:"orgs",noun:"org",sec:"My orgs",title:"My orgs on your profile",open:["openorgs","Open Org"],empty:"You're not in an org yet."},
  listings:{key:"listings",noun:"listing",sec:"My listings",title:"My listings on your profile",open:["openmarket","Open your listings"],empty:"Nothing up for sale right now."}};
const PF_KEYV={ships:"fleet",gearlo:"gearlo",orgs:"orgs",listings:"listings"};
function pfArrList(key){
  if(key==="ships") return {list:S.pfFleet||[],idOf:x=>x.uid};
  if(key==="gearlo") return {list:(S.gl.list||[]).slice().sort((a,b)=>(b.main?1:0)-(a.main?1:0)),idOf:x=>x.id};
  if(key==="orgs") return {list:S.og.mine?.orgs||[],idOf:x=>x.id};
  return {list:(S.pm.mine?.listings||[]).filter(l=>l.status==="active"),idOf:x=>x.id}; }
function pfArrangeView(v){ const P=$("pf-panel"), lg=S.live?.log||{}, A=PF_ARR[v], key=A.key, ships=v==="fleet";
  if(key==="orgs") pfLoadOrgs();
  if(key==="listings"&&S.pm.mine===null&&!S.pfPmAsk){ S.pfPmAsk=true; pmLoadMine().then(()=>renderProfile(true)); }
  const {list,idOf}=pfArrList(key);
  const o=pfOrdered(list,idOf,key), noun=A.noun, dirty=pfDirty(key), sec=A.sec;
  const head=`<div class="mkp-head" style="grid-template-columns:1fr;margin-bottom:8px"><div class="hd-main"><div class="hd-title"><div><h2>${A.title}</h2>
    <div class="sub">Choose which ${noun}s your profile shows and in what order. Drag a row, or use the arrows, then Save.</div></div></div>
    ${statBlock([{label:"Section",value:o.off?"Hidden":"Shown"},{label:"Shown",value:o.off?"–":`${o.shown.length} of ${list.length}`},{label:"Most at once",value:String(o.count)}],[])}</div></div>`;
  if(ships&&!lg.uex_token){ P.innerHTML=`${head}<div class="empty">Add your UEX Bearer Token under Linked accounts to keep your fleet here.</div>`; return; }
  if((key==="orgs"||key==="listings")&&!S.acct?.signed_in){ P.innerHTML=`${head}<div class="empty">Sign in to your Quantum account to use orgs and the marketplace.</div>`; return; }
  if((key==="orgs"&&!S.og.mine)||(key==="listings"&&!S.pm.mine)){ P.innerHTML=`${head}<div class="empty">Loading…</div>`; return; }
  const shownIds=new Set(o.shown.map(x=>String(idOf(x))));
  const row=(x,i)=>{ const id=String(idOf(x)), hid=o.hidden.has(id), on=shownIds.has(id)&&!o.off;
    const name=ships?(x.full||x.name||""):key==="orgs"?`${x.name} [${x.tag}]`:key==="listings"?x.title:x.name;
    const sub=ships?[x.maker,x.scu?`${x.scu} SCU`:""].filter(Boolean).join(" · ")
      :key==="orgs"?[x.my_rank,x.verified?"Verified with RSI":"Not verified",x.listed===false?"Private org: only its members see it on your profile":""].filter(Boolean).join(" · ")
      :key==="listings"?[x.kind==="service"?"Service":"Item",x.unit==="quote"?"Quote":pmA(x.price),x.category].filter(Boolean).join(" · ")
      :[x.scenario,plural(glItems(x).length,"item")].filter(Boolean).join(" · ");
    const pic=ships?(x.photo?`<img src="${esc(x.photo)}" alt="" loading="lazy" referrerpolicy="no-referrer">`:"")
      :key==="orgs"?ogLogo(x,1):key==="listings"?(x.photo?`<img src="${esc(x.photo)}" alt="" loading="lazy">`:"")
      :(()=>{ const p=x.slots?.core||x.slots?.helmet||x.slots?.primary||Object.values(x.slots||{})[0]; return p?`<span data-gpic="${esc(p.name)}"></span>`:""; })();
    return `<div class="pf-arr ${on?"":"off"}" draggable="true" data-pfdrag="${esc(key)}|${esc(id)}">
      <span class="h" aria-hidden="true">⋮⋮</span><span class="th">${pic}</span>
      <div class="w"><b>${x.main?"★ ":""}${esc(name)}</b><small>${esc(sub)}${o.off?"":hid?" · hidden":on?"":" · over the limit"}</small></div>
      <label class="row" style="gap:6px;font-size:12.5px;cursor:pointer"><input type="checkbox" data-pfarr="${key}|show|${esc(id)}" ${hid?"":"checked"}> Show</label>
      <span class="row" style="gap:4px"><button class="btn small ghost" data-pfarr="${key}|up|${esc(id)}" ${i?"":"disabled"} aria-label="Move ${esc(name)} up">↑</button><button class="btn small ghost" data-pfarr="${key}|down|${esc(id)}" ${i<o.all.length-1?"":"disabled"} aria-label="Move ${esc(name)} down">↓</button></span></div>`; };
  P.innerHTML=`${head}
    <div class="vd-flat"><div class="vd-sec"><div class="mk-h">On your profile</div>
      <div class="vd-row"><span>Show the “${sec}” section</span><label class="row" style="gap:6px;cursor:pointer;font-size:13px"><input type="checkbox" data-pfarr="${key}|section|" ${o.off?"":"checked"}> ${o.off?"Hidden":"Shown"}</label></div>
      <div class="vd-row"><span>${noun[0].toUpperCase()+noun.slice(1)}s to show, at most</span><select class="field" data-pfarr="${key}|count|" style="width:auto" ${o.off?"disabled":""}>${PF_COUNTS.map(n=>`<option value="${n}" ${n===o.count?"selected":""}>${n}</option>`).join("")}</select></div></div></div>
    <div class="row" style="gap:8px;margin:4px 2px 14px;flex-wrap:wrap;align-items:center">
      <button class="btn primary" data-pfarr="${key}|save|" ${dirty?"":"disabled"}>Save</button>
      <button class="btn ghost" data-pfarr="${key}|discard|" ${dirty?"":"disabled"}>Discard changes</button>
      ${dirty?`<span style="font-size:12.5px;color:#ffd38a">Unsaved changes</span>`:`<span class="muted" style="font-size:12.5px">${S.pfSavedAt?.[key]?"Saved":"No changes"}</span>`}
      <span class="spacer"></span><button class="btn small ghost" data-pfarr="${key}|reset|">Back to default</button>
      <button class="btn small" data-pfv="${A.open[0]}">${A.open[1]}</button></div>
    ${list.length?`<div class="vd-flat" style="${o.off?"opacity:.55":""}"><div class="vd-sec"><div class="mk-h">Your ${noun}s<span class="mk-note">top to bottom is ${key==="orgs"?"top to bottom":"left to right"} on your profile</span></div>${o.all.map(row).join("")}</div></div>`
      :`<div class="empty">${A.empty}</div>`}`;
  if(key==="gearlo") fillGearPictures(P); }
async function pfArrange(key,act,id,el){ const v=PF_KEYV[key];
  const {list,idOf}=pfArrList(key);
  if(act==="save"){ if(!pfDirty(key)) return; const next={...(S.pfPrefs||{}),[key]:S.pfDraft[key]};
    const r=await api().profile_prefs_set(next).catch(()=>null); if(!r?.ok) return toast("Couldn't save. Try again");
    S.pfPrefs=r.prefs; delete S.pfDraft[key]; S.pfSavedAt={...(S.pfSavedAt||{}),[key]:Date.now()};
    const o=pfOrdered(list,idOf,key,true);
    toast(o.off?`Saved: the ${PF_ARR[v].sec} section is hidden on your profile`:`Saved: your profile shows ${plural(o.shown.length,PF_ARR[v].noun)}`);
    pfPublish(true); return renderProfile(true); }
  if(act==="discard"){ if(S.pfDraft) delete S.pfDraft[key]; toast("Changes discarded"); return renderProfile(true); }
  const o=pfOrdered(list,idOf,key); let order=o.all.map(x=>String(idOf(x))), hidden=new Set(o.hidden), count=o.count, off=o.off;
  const i=order.indexOf(id);
  if(act==="up"&&i>0) [order[i-1],order[i]]=[order[i],order[i-1]];
  else if(act==="down"&&i>=0&&i<order.length-1) [order[i+1],order[i]]=[order[i],order[i+1]];
  else if(act==="show"){ if(el.checked) hidden.delete(id); else hidden.add(id); }
  else if(act==="section") off=!el.checked;
  else if(act==="count") count=+el.value;
  else if(act==="move"){ const [from,to]=id.split(">"); const a=order.indexOf(from), b=order.indexOf(to); if(a<0||b<0||a===b) return; order.splice(a,1); order.splice(order.indexOf(to)+(a<b?1:0),0,from); }
  else if(act==="reset"){ order=[]; hidden=new Set(); count=key==="orgs"?10:8; off=false; }
  else return;
  S.pfDraft={...(S.pfDraft||{}),[key]:{order,hidden:[...hidden],count,off}};
  if(S.tab==="profile"&&S.pfView===v) renderProfile(true); }
// Drag a row to its new place
document.addEventListener("dragstart",e=>{ const r=e.target.closest?.("[data-pfdrag]"); if(!r) return; S.pfDrag=r.dataset.pfdrag; e.dataTransfer.effectAllowed="move"; r.classList.add("drag"); });
document.addEventListener("dragend",e=>{ e.target.closest?.("[data-pfdrag]")?.classList.remove("drag"); for(const x of document.querySelectorAll(".pf-arr.over")) x.classList.remove("over"); });
document.addEventListener("dragover",e=>{ const r=e.target.closest?.("[data-pfdrag]"); if(!r||!S.pfDrag||r.dataset.pfdrag.split("|")[0]!==S.pfDrag.split("|")[0]) return; e.preventDefault();
  for(const x of document.querySelectorAll(".pf-arr.over")) if(x!==r) x.classList.remove("over"); r.classList.add("over"); });
document.addEventListener("drop",e=>{ const r=e.target.closest?.("[data-pfdrag]"); if(!r||!S.pfDrag) return; e.preventDefault();
  const [key,from]=S.pfDrag.split("|"), [k2,to]=r.dataset.pfdrag.split("|"); S.pfDrag=null; if(key!==k2||from===to) return; pfArrange(key,"move",`${from}>${to}`); });
// Your photo: any picture, cropped to the middle square and shrunk to 256 px here, so it's small to keep and send
function pfShrink(file){ return new Promise((res,rej)=>{ const img=new Image(), u=URL.createObjectURL(file);
  img.onload=()=>{ const sz=Math.min(img.naturalWidth,img.naturalHeight), c=document.createElement("canvas"); c.width=c.height=256;
    const g=c.getContext("2d"); g.imageSmoothingQuality="high"; g.drawImage(img,(img.naturalWidth-sz)/2,(img.naturalHeight-sz)/2,sz,sz,0,0,256,256);
    URL.revokeObjectURL(u); res(c.toDataURL("image/jpeg",0.88)); };
  img.onerror=()=>{ URL.revokeObjectURL(u); rej(new Error("unreadable")); }; img.src=u; }); }
// Another Quantum account signed in on this PC (or signed out): forget the last one's picture, name, friends,
// orgs and listings, and fetch this one's, so nothing of the old account shows until you click around.
function acctChanged(){
  S.pfPhoto=undefined; S.so.st=null; S.so.open=null; S.so.conv=null; S.so.results=null;
  S.og.mine=null; S.og.data=null; S.og.view=null; S.og.cur=null; S.pm.mine=null; S.pm.esc=null; S.pfOgAsk=S.pfPmAsk=false; S.pfPubAt=0;
  try{ localStorage.removeItem("q-pub"); localStorage.removeItem("q-me"); }catch(_){}
  pfPrime(true);
  if(S.acct?.signed_in) api().social_refresh().then(r=>{ if(typeof soApply==="function") soApply(r); renderProfile(true); syncRailMe(); }).catch(()=>{});
  else { syncRailMe(); renderProfile(true); } }
setInterval(()=>{ const who=S.acct===undefined?undefined:(S.acct?.signed_in?(S.acct.email||"?"):null);
  if(who===undefined) return;
  if(S.acctWho!==undefined&&who!==S.acctWho){ S.acctWho=who; acctChanged(); } else S.acctWho=who; },800);
async function pfSignOut(){ S.pfOutAsk=false;
  const r=await api().sign_out_all().catch(()=>null); if(!r?.ok) return toast("Couldn't sign out. Try again");
  qForget(); Object.assign(S,{acct:undefined,drProf:null,drProfAt:0,drTrust:null,pfFleet:null,bk:undefined,keyStat:undefined,uexStat:null,uexDraft:"",drSecretDraft:"",drHasSecret:false,
    mk:null,veh:null,cpCats:null,cpItems:null,owner:false,ownerAsked:false});
  S.pfView="overview"; await poll(); await pfPrime(true); renderProfile(true); toast("Signed out. Nothing is connected now"); }
async function pfClick(e){
  const u=e.target.closest("[data-url]"); if(u){ api().open_url(u.dataset.url); return; }
  if(await tradeClick(e)) return;
  const v=e.target.closest("[data-pfv]"); if(v){ const k=v.dataset.pfv;
    if(k==="openfleet"){ const t=document.querySelector('.tab[data-tab="fleet"]'); if(t&&!t.hidden) return t.click(); toast("Add your UEX Bearer Token first: My Fleet uses it"); S.pfView="accounts"; return renderProfile(true); }
    if(k==="opengearlo"){ S.gl.sel=null; S.gl.pick=null; return document.querySelector('.tab[data-tab="gearlo"]').click(); }
    if(k==="openorgs") return document.querySelector('.tab[data-tab="orgs"]').click();
    if(k==="openmarket"){ S.pm.filter="listings"; S.pm.view="mine"; return document.querySelector('.tab[data-tab="pm-mine"]').click(); }
    if(k==="preview"){ const me=S.so?.st?.me?.id; return me?upOpen(me):toast("Sign in to your Quantum account first"); }
    if(PF_ARR[S.pfView]&&pfDirty(PF_ARR[S.pfView].key)) toast("Your changes aren't saved yet: they're kept until you Save or discard them");
    S.pfView=k; $("pf-panel").scrollTop=0; return renderProfile(true); }
  const pt=e.target.closest("[data-pftab],[data-pforg],[data-pflisting]"); if(pt){ const tab=t=>document.querySelector(`.tab[data-tab="${t}"]`)?.click();
    if(pt.dataset.pforg){ S.og.view="org"; S.og.tab="overview"; S.og.cur=isNaN(+pt.dataset.pforg)?pt.dataset.pforg:+pt.dataset.pforg; return tab("orgs"); }
    if(pt.dataset.pflisting){ tab(pt.dataset.pfkind); return pmOpen(isNaN(+pt.dataset.pflisting)?pt.dataset.pflisting:+pt.dataset.pflisting); }
    if(pt.dataset.pfmine){ S.pm.filter=pt.dataset.pfmine; S.pm.view="mine"; }
    return tab(pt.dataset.pftab); }
  const go=e.target.closest("[data-glopen]"); if(go){ S.gl.sel=go.dataset.glopen; S.gl.pick=null; return document.querySelector('.tab[data-tab="gearlo"]').click(); }
  const fs=e.target.closest("[data-pfship]"); if(fs){ const t=document.querySelector('.tab[data-tab="fleet"]'); if(t&&!t.hidden) t.click(); return; }
  const ar=e.target.closest("[data-pfarr]"); if(ar&&ar.tagName!=="SELECT"){ const [key,act,id]=ar.dataset.pfarr.split("|"); return pfArrange(key,act,id,ar); }
  const pf=e.target.closest("[data-pf]"); if(pf){ const k=pf.dataset.pf;
    if(k==="photo") return $("pf-file")?.click();
    if(k==="photo-remove"){ const r=await api().profile_photo_set(null); S.pfPhoto=r.photo||null; toast("Photo removed"); return renderProfile(true); }
    if(k==="signout"){ S.pfOutAsk=true; renderProfile(true); return setTimeout(()=>document.querySelector('[data-pf="signout-yes"]')?.scrollIntoView({block:"nearest",behavior:"smooth"}),30); }
    if(k==="signout-no"){ S.pfOutAsk=false; return renderProfile(true); }
    if(k==="signout-yes") return pfSignOut();
    if(k==="trust-retry"){ S.drTrust=null; renderProfile(true); await Promise.allSettled([drTrustLoad(true).catch(()=>{ S.drTrust={ok:false}; }),drProfLoad(true)]); return renderProfile(true); }
    if(k==="mine"){ S.drNextView="mine"; const t=document.querySelector('.tab[data-tab="datarunner"]'); if(t) t.click(); return; } }
  const a=e.target.dataset?.a||e.target.closest("[data-a]")?.dataset.a; if(!a) return;
  if(a==="acctsignout"){ S.pfOutAsk=true; renderProfile(true); return toast("Confirm signing out under your picture on the left"); }   // signing out means everything
  await settingsAction(a,e);
  if(a==="acctsignout"||a==="drsecret"||a==="drsecretclear"||a==="uexsave"||a==="uexclear"){ S.drProf=a==="drsecretclear"?null:S.drProf; setTimeout(()=>pfPrime(true),800); } }
$("pf-panel").addEventListener("click",pfClick);
$("pane-profile").addEventListener("click",pfClick);
$("pf-panel").addEventListener("change",e=>{ const ar=e.target.closest("select[data-pfarr]"); if(!ar) return; const [key,act,id]=ar.dataset.pfarr.split("|"); pfArrange(key,act,id,ar); });
document.addEventListener("change",async e=>{ if(e.target.id!=="pf-file") return; const f=e.target.files?.[0]; e.target.value=""; if(!f) return;
  if(f.size>25e6) return toast("That picture is too big (25 MB at most)");
  let url; try{ url=await pfShrink(f); }catch(_){ return toast("Couldn't read that picture"); }
  const r=await api().profile_photo_set(url); if(!r.ok) return toast(r.error);
  S.pfPhoto=r.photo; toast(r.signed_in?"Photo updated, and saved to your Quantum account":"Photo updated on this PC. Sign in to your Quantum account to keep it there too"); renderProfile(true); syncRailMe(); });
// Account and key changes made anywhere redraw the profile too
{ const rd=renderDetail; renderDetail=function(){ rd(); if(S.tab==="profile") renderProfile(); syncRailMe(); }; }

// ---- route
// Adding one place by hand may repeat a stop already in the route (A > B > C > B); a stop straight after
// itself is the same stop, so the server skips that.
async function addStops(names,repeat=true){ const had=new Set(S.live?.route||[]); const r=await api().add_stops(names,repeat); await poll();
  const added=r?.added||names;
  if(!added.length) toast(names.length===1?`${names[0]} is already the last stop`:"Those are already in your route");
  else toast(added.length===1?`Added ${added[0]} to route${had.has(added[0])?" again":""}`:`Added ${added.length} stops to route`); renderDetail(); }
function roleTags(roles){ return (roles||[]).map(r=>r.kind==="gate"?`<span class="role gate">Gateway${r.to?" · jump to "+esc(r.to):""}</span>`
  :r.kind==="gate-in"?`<span class="role gate">Gateway${r.from?" · arrive from "+esc(r.from):""}</span>`
  :`<span class="role ${r.kind}">${r.kind==="pickup"?"Pickup":r.kind==="dropoff"?"Drop-off":"Objective"}${r.cargo?" · "+esc(r.cargo):""}</span>`).join(""); }
const isGateStop=roles=>(roles||[]).some(r=>r.kind==="gate"||r.kind==="gate-in");
function renderRoute(){
  const live=S.live, route=live.route, el=$("stops"); $("c-route").textContent=route.length;
  $("route-summary").style.display=route.length?"":"none";      // nothing to total up without stops $("btn-arrived").style.display=route.length?"block":"none";
  $("route-total").textContent=route.length?fmtDist(live.total):"–";
  const jumps=route.filter((n,i)=>i>0&&S.locMap[n]?.system!==S.locMap[route[i-1]]?.system).length;
  const again=route.length-new Set(route).size;
  $("route-sub").textContent=!route.length?"No stops yet":`${route.length} stop${route.length>1?"s":""}${again?`, ${again} return visit${again>1?"s":""}`:""}${jumps?`, ${jumps} jump${jumps>1?"s":""}`:""}${live.player?" from your position":""}`;
  $("route-warn").style.display=live.route_warning?"block":"none"; $("route-warn").textContent=live.route_warning||"";
  el.innerHTML=route.map((n,i)=>{ const L=S.locMap[n]||{}; const leg=live.legs[i]; const jump=i>0&&L.system!==S.locMap[route[i-1]]?.system;
    const back=route.indexOf(n)<i?'<span class="role back">Return visit</span>':"";
    return `<li class="stop" draggable="true" data-i="${i}"><div class="num">${i+1}</div>
      <div style="min-width:0"><div class="name" title="${esc(n)}">${esc(n)}</div><div class="meta"><span>${back}${roleTags(live.stop_roles?.[i])}${esc(L.body||L.system||"")}</span>${padOf(L)!=="unknown"?`<span>pad: ${esc(padLabel(padOf(L)))}</span>`:""}</div></div>
      <div class="row"><div class="leg ${jump?"jump":""}">${jump?"jump to "+esc(L.system)+(leg!=null?" · "+fmtDist(leg):""):leg!=null?fmtDist(leg):""}</div>${isGateStop(live.stop_roles?.[i])?`<span class="x" title="Added by Quantum: the route jumps to another system here" style="opacity:.35;cursor:default">⇄</span>`:`<button class="x" aria-label="Remove stop ${i+1}">×</button>`}</div></li>`; }).join("");
  for(const li of el.children){ const i=+li.dataset.i, n=route[i];
    li.querySelector(".name").onclick=()=>{ select({kind:"loc",name:n}); focusLoc(n); };
    const xb=li.querySelector("button.x"); if(xb) xb.onclick=async()=>{ const r=await api().remove_stop(i); if(r&&r.ok===false) toast(r.error); await poll(); };
    li.ondragstart=e=>{ li.classList.add("dragging"); e.dataTransfer.setData("text/plain",String(i)); };
    li.ondragend=()=>li.classList.remove("dragging");
    li.ondragover=e=>{ e.preventDefault(); for(const o of el.children) o.classList.remove("drop-before"); li.classList.add("drop-before"); };
    li.ondrop=async e=>{ e.preventDefault(); const from=+e.dataTransfer.getData("text/plain"); if(from===i) return;
      await api().move_stop(from, from<i?i-1:i); await poll(); }; }
}
$("btn-optimize").onclick=async()=>{ const r=await api().optimize_route(); await poll(); if(!r.ok) return toast(r.error); toast(r.saved>1?`Shorter by ${fmtDist(r.saved)}`:"Already the shortest order"); };
$("btn-clear").onclick=async()=>{ await api().clear_route(); S.overview=null; await poll(); };
$("btn-view").onclick=()=>fitRoute();
async function openAlign(){ S.alignStatus=await api().calibration_status(); S.selected={kind:"align"}; renderDetail(); }

$("btn-settings").onclick=()=>{ if(S.selected?.kind==="settings") return select(null);     // a second click closes it
  S.uexStat=null; S.selected={kind:"settings"}; renderDetail(); };
$("btn-plan").onclick=()=>planRoute(false); $("btn-plan-all").onclick=()=>planRoute(true);
async function planRoute(withContracts){
  const btns=[...document.querySelectorAll(".btn.plan")]; const labels=btns.map(b=>b.innerHTML);
  btns.forEach(b=>{ b.disabled=true; b.innerHTML='<span class="spin"></span>Planning route…'; });
  const t0=performance.now(); let r;
  try{ r=await api().plan_route(withContracts); await poll(); } finally {
    await new Promise(res=>setTimeout(res,Math.max(0,900-(performance.now()-t0))));
    btns.forEach((b,i)=>{ b.disabled=false; b.innerHTML=labels[i]; }); }
  if(!r.ok) return toast(r.error);
  S.overview=r; renderContracts(true);   // stay on whichever tab you planned from
  fitRoute(); S.reveal=performance.now(); renderHud();
}
// Frame the whole route. The camera pivots on a planet (yours, or the next stop's), so dragging
// afterwards spins that globe instead of swinging around an empty point in space.
// How much of the view a framed route may use, as tan(half-angle): the narrower of height and the free
// width beside the cards on the left (the view's centre is shifted right by half their width).
// How far right the view's centre moves so things aren't hidden: half the cards on the left, or half
// the trade-route detail panel when it's open.
// With a trade route open, the map shows through a window in its page: the view centres on that
// window and frames the route to its size.
function tradePanelOpen(){ return !!$("tr-panel")?.classList.contains("show"); }
function mapWindow(){ if(!tradePanelOpen()) return null; const f=$("trd-map"), base=$("gl"); if(!f||!base) return null;
  const a=f.getBoundingClientRect(), b=base.getBoundingClientRect(); if(!a.width||!a.height) return null;
  return {x:a.left-b.left, y:a.top-b.top, w:a.width, h:a.height}; }
function viewShift(){ const fr=mapWindow(); if(fr) return fr.x+fr.w/2-W/2;
  // The place card open on the left: centre what you're looking at in the map that's left beside it
  // (only when the card reaches up past the middle of the map, where it would cover it)
  const d=$("detail"), base=$("gl");
  if(d?.classList.contains("show")&&base){ const a=d.getBoundingClientRect(), b=base.getBoundingClientRect();
    const right=a.right-b.left, top=a.top-b.top;
    if(a.width&&right<W*0.6&&top<H*0.62) return right/2; }
  return 0; }   // the next-stop card only covers the top corner: centre the view in the middle of the map
function fitHalf(){ const half=Math.tan(camera.fov*Math.PI/360);
  const fr=mapWindow(); if(fr) return Math.min(half*fr.h/H, half*fr.w/H)*0.82;
  const shift=viewShift();
  return Math.min(half, half*(W/H)*Math.max(0.25,(W/2-shift)/(W/2)))*0.88; }
function fitRoute(reveal=true, only=null){
  const route=only||S.live?.route||[]; if(!route.length){ if(!only) toast("The route is empty"); return; }
  const ps=S.live.player?.system; const sys=ps&&route.some(n=>S.locMap[n]?.system===ps)?ps:S.locMap[route[0]]?.system;
  if(sys&&sys!==S.system) setSystem(sys,false);
  const t=now(); const nodes=route.map(n=>nodeOf(n,t)).filter(Boolean); const pn=playerNode(); if(pn) nodes.push(pn);
  if(!nodes.length) return;
  const pivotName=(pn&&pn.body)||nodes.find(n=>n.body)?.body;
  const B=pivotName&&S.bodyMap[pivotName];
  const half=Math.tan(camera.fov*Math.PI/360);
  if(B){ const bodies=new Set(nodes.map(n=>n.body));
    let dist, pitch, yaw;
    if(bodies.size===1){ // all on this globe: turn it so the route faces you
      const c=norm3(nodes.reduce((a,n)=>{ const u=norm3(n.local); return [a[0]+u[0],a[1]+u[1],a[2]+u[2]]; },[0,0,0]));
      const spread=Math.max(...nodes.map(n=>{ const u=norm3(n.local); return Math.acos(Math.max(-1,Math.min(1,u[0]*c[0]+u[1]*c[1]+u[2]*c[2]))); }));
      dist=B.radius*(1.45+2.0*Math.min(spread,1.3)); pitch=Math.asin(c[2]); yaw=Math.atan2(c[1],c[0]);
      flyTo({kind:"body",name:B.name}, dist, {pitch, yaw});
      if(reveal) S.reveal=performance.now(); return; }
  }
  // Stops spread over space or several planets: centre on the middle of them all and back off until
  // every one fits beside the cards (it used to stay centred on your planet, pushing stops off screen).
  const lo=[0,1,2].map(i=>Math.min(...nodes.map(n=>n.g[i]))), hi=[0,1,2].map(i=>Math.max(...nodes.map(n=>n.g[i])));
  const cen=[0,1,2].map(i=>(lo[i]+hi[i])/2); const rad=Math.max(...nodes.map(n=>d3(n.g,cen)),B?B.radius*1.5:1e5);
  const h=fitHalf(); flyTo({kind:"point",pos:cen}, rad*Math.sqrt(1+h*h)/h, {pitch:0.95, key:"fit:"+(only||[]).join("|")});
  if(reveal) S.reveal=performance.now();
}
$("btn-optimize").onclick=async()=>{ const r=await api().optimize_route(); await poll(); if(!r.ok) return toast(r.error); toast(r.saved>1?`Shorter by ${fmtDist(r.saved)}`:"Already the shortest order"); };
$("btn-clear").onclick=async()=>{ await api().clear_route(); S.overview=null; await poll(); };
$("btn-view").onclick=()=>fitRoute();
$("btn-plan").onclick=()=>planRoute(false); $("btn-plan-all").onclick=()=>planRoute(true);
async function planRoute(withContracts){
  const btns=[...document.querySelectorAll(".btn.plan")]; const labels=btns.map(b=>b.innerHTML);
  btns.forEach(b=>{ b.disabled=true; b.innerHTML='<span class="spin"></span>Planning route…'; });
  const t0=performance.now(); let r;
  try{ r=await api().plan_route(withContracts); await poll(); } finally {
    await new Promise(res=>setTimeout(res,Math.max(0,900-(performance.now()-t0))));
    btns.forEach((b,i)=>{ b.disabled=false; b.innerHTML=labels[i]; }); }
  if(!r.ok) return toast(r.error);
  S.overview=r; renderContracts(true);   // stay on whichever tab you planned from
  fitRoute(); S.reveal=performance.now(); renderHud();
}
$("btn-arrived").onclick=async()=>{ await api().arrived(); await poll(); };

// ---- route search: find anything and add it as a stop (or fly to planets and moons). Under the route there's
// always a list of every place in this system (with type chips) to add from; typing swaps the route and that
// list for search results, and clearing the search or Esc brings them back. The old POI tab's list lives here.
const RS={items:[],on:0,type:null,more:0};
// Roman numerals after a name read as numbers ("nyx iii" -> "nyx 3"), for search only
const ROMAN={i:1,ii:2,iii:3,iv:4,v:5,vi:6,vii:7,viii:8,ix:9,x:10};
const numerals=s=>s.replace(/([a-z]) (viii|vii|iii|ii|iv|vi|ix|i|v|x)(?![a-z0-9])/g,(m,a,r)=>`${a} ${ROMAN[r]}`);
const rsMode=()=>$("rsearch").value.trim()?"search":"browse";
const RS_RANK={city:0,station:1,outpost:2,jump:2,cave:3,wreck:3,poi:4,comm:4,field:5,lpoint:5,om:6};
function rsLocItem(L,sc,{via=null,lp=null,onBody=false}={}){
  return {kind:"loc",name:L.name,via,sc,r:L.source==="user"?-0.5:(RS_RANK[L.type]??4),sys:L.system,
    type:L.source==="user"?"wp":L.source==="mission"?"mission":L.type,
    sub:`${L.unplaced?"Position not known yet · ":""}${lp?"At "+lp+" · ":""}${via?"Has "+via+" · ":""}${L.source==="user"?"Your waypoint":L.source==="mission"?"Contract stop":TYPES[L.type]?.one||"Place"} · ${L.body||"Space"}${L.system!==S.system?", "+L.system:""}${padOf(L)!=="unknown"?" · pad: "+padLabel(padOf(L)):""}`}; }
function rsCandidates(q){
  q=q.trim().toLowerCase(); if(!q) return [];
  const score0=(x,q)=>{ if(x===q) return 0; if(x.startsWith(q)) return 1;
    if(x.split(/[^a-z0-9&']+/).some(w=>w.startsWith(q))) return 2; if(x.includes(q)) return 3;
    const z=squash(q); return z.length>=4&&squash(x).includes(z)?3:9; };
  // "Nyx 1" finds Nyx I (and "Nyx I" still finds Nyx II and III as you type): numbered names are matched
  // both as written and with their roman numerals read as numbers
  const qn=numerals(q);
  const score=n=>{ const x=n.toLowerCase(); return Math.min(score0(x,q), qn!==q||/\d/.test(q)?score0(numerals(x),qn):9); };
  const out=[];
  if(!RS.type) for(const b of S.bodies){ if(b.kind==="star") continue; const sc=score(b.name); if(sc<9) out.push({kind:"body",name:b.name,sub:`${kindLabel(b)} · ${b.system}`,sc,r:-1,sys:b.system}); }
  for(const L of S.locs){ if(L.mergedInto) continue;                                  // found as its station
    if(RS.type&&L.type!==RS.type) continue; if(L.type==="om"&&!q.startsWith("om")&&RS.type!=="om") continue;
    let sc=score(L.name), lp=null, onBody=false; if(L.atLpoint){ const s2=score(L.atLpoint); if(s2<sc){ sc=s2; lp=L.atLpoint; } }
    // "commodity"/"trading" still finds places whose freight elevator or loading dock is their trade point
    let via=null; if(sc>=9&&q.length>=3&&L.amen){ via=L.amen.find(a=>a.toLowerCase().includes(q))
      ||("commodity trading".includes(q)||q.startsWith("commod")?L.amen.find(a=>/freight elevator|loading dock/i.test(a)):null); if(via) sc=4; }
    // Everything on a planet or moon by its name ("hurston" lists Hurston's places after Hurston itself)
    if(sc>=9&&L.body&&L.source==="db"&&score(L.body)<=1){ sc=5; onBody=true; }
    if(sc<9) out.push(rsLocItem(L,sc,{via,lp,onBody})); }
  out.sort((a,b)=>a.sc-b.sc||(a.sys!==S.system)-(b.sys!==S.system)||a.r-b.r||a.name.localeCompare(b.name));
  return out;
}
// Browse: every place in the system you're looking at (orbital markers only under their own chip)
function rsBrowse(){
  return S.locs.filter(L=>L.source==="db"&&!L.mergedInto&&L.system===S.system&&(RS.type?L.type===RS.type:L.type!=="om"))
    .map(L=>rsLocItem(L,0)).sort((a,b)=>a.r-b.r||a.name.localeCompare(b.name)); }
// ---- Search by what you need: "refinery", "clinic", "hungry", "rent", "armor", "missiles", "fuel", "hydrogen"…
// lists the places that have it, nearest to you first, above the usual name matches. What a place has comes
// from its services (the wiki) and from UEX: its shops, commodity terminals and fuel.
const amenHas=(L,rx)=>(L.amen||[]).some(a=>rx.test(a));
const shopHas=(L,g)=>!!S.shopPlaces?.[L.name]?.includes(g);
const fuelHas=(L,k)=>!!S.fuelPlaces?.[L.name]?.includes(k);
const RS_NEEDS=[
  {k:"refinery",label:"refinery",words:["refinery","refineries","refine","refining","refine ore"],has:L=>amenHas(L,/refinery/i)},
  {k:"rent",label:"vehicle rental",words:["vehicle rental","vehicle rentals","rental","rentals","rent","rent vehicle","rent vehicles","rent a ship","rent ship","rent a vehicle","hire"],
    has:L=>amenHas(L,/rent/i)||shopHas(L,"rentals")},
  {k:"showroom",label:"vehicle showroom",words:["vehicle showroom","showroom","ship showroom","buy ship","buy ships","buy vehicle","buy vehicles","ship dealer","dealership","ship shop"],
    has:L=>amenHas(L,/buy vehicles|buy and rent vehicles/i)},
  {k:"medical",label:"clinic or hospital",words:["clinic","hospital","medical","health","healthcare","heal","healing","doctor","medic","med bay","medbay","injured","injury","hurt","medpen","medpens"],
    has:L=>amenHas(L,/clinic|hospital/i)||shopHas(L,"medical")},
  {k:"food",label:"food and drink",words:["food","drink","drinks","food and drink","food court","hungry","thirsty","eat","restaurant","snack","water","burrito"],
    has:L=>amenHas(L,/food/i)||shopHas(L,"food")},
  {k:"armor",label:"armor shop",words:["armor","armour","buy armor","armor shop","helmet","undersuit"],has:L=>amenHas(L,/buy armor/i)||shopHas(L,"armor")},
  {k:"clothing",label:"clothing shop",words:["clothing","clothes","outfit","jacket","fashion","apparel","buy clothing"],has:L=>amenHas(L,/buy clothing/i)||shopHas(L,"clothing")},
  {k:"weapons",label:"weapon shop",words:["weapons","weapon","guns","gun","pistol","pistols","rifle","rifles","sniper","shotgun","smg","ammo","fps weapons","personal weapons","buy weapons"],
    has:L=>amenHas(L,/buy weapons/i)||shopHas(L,"weapons")},
  {k:"shipweapons",label:"ship weapons",words:["ship weapons","ship weapon","missiles","missile","torpedo","torpedoes","ship guns","ship gun","guns","gun","cannon","cannons","repeater","repeaters","turret","bombs"],
    has:L=>S.shopPlaces?.[L.name]?shopHas(L,"shipweapons"):amenHas(L,/ship items and weapons/i)},
  {k:"components",label:"ship components",words:["ship components","ship component","components","component","ship parts","ship items","quantum drive","quantum drives","cooler","coolers","power plant","shield generator","shields"],
    has:L=>S.shopPlaces?.[L.name]?shopHas(L,"components"):amenHas(L,/ship items and weapons/i)},
  {k:"hydrogen",label:"hydrogen fuel",words:["hydrogen","hydrogen fuel","h2"],has:L=>S.fuelPlaces&&Object.keys(S.fuelPlaces).length?fuelHas(L,"hydrogen"):amenHas(L,/vehicle services/i)},
  {k:"quantum",label:"quantum fuel",words:["quantum","quantum fuel","qt fuel"],has:L=>S.fuelPlaces&&Object.keys(S.fuelPlaces).length?fuelHas(L,"quantum"):amenHas(L,/vehicle services/i)},
  {k:"fuel",label:"refuelling",words:["fuel","refuel","refueling","refuelling","gas","fuel up","out of fuel"],has:L=>fuelHas(L,"hydrogen")||fuelHas(L,"quantum")||amenHas(L,/vehicle services/i)},
  {k:"repair",label:"repair and rearm",words:["repair","repairs","rearm","restock","fix ship","vehicle services","ship repair"],has:L=>amenHas(L,/vehicle services/i)},
  {k:"trade",label:"commodity trading",words:["commodities","commodity","trade","trading","sell cargo","buy cargo","trade terminal","tdd"],has:L=>!!S.tradePlaces?.has(L.name)||amenHas(L,/commodity trading/i)}];
// The needs a search is about: the whole search is one of their words, a word or phrase in it is
// ("closest refinery", "where to eat"), or it's the start of one while you type ("refin", "hospi")
function rsNeeds(q){ q=q.trim().toLowerCase().replace(/\s+/g," "); if(q.length<3) return [];
  const pad=` ${q.replace(/[^a-z0-9 ]/g," ")} `;
  const hit=RS_NEEDS.filter(n=>n.words.some(w=>w===q||pad.includes(` ${w} `)));
  if(hit.some(n=>n.k==="hydrogen"||n.k==="quantum")) return hit.filter(n=>n.k!=="fuel");   // "hydrogen fuel": just hydrogen
  if(hit.length) return hit;
  return q.length>=4?RS_NEEDS.filter(n=>n.words.some(w=>w.startsWith(q))):[]; }
const RS_NEED_MAX=8;
function rsNeedItems(q){ const needs=rsNeeds(q); if(!needs.length) return [];
  if(S.live?.log?.uex_token){ loadShopPlaces(); loadTradePlaces(); }          // UEX's shops, terminals and fuel, once
  const t=now(), me=playerG(t), mySys=S.live?.player?.system, out=[];
  for(const n of needs){
    const L=S.locs.filter(L=>L.source==="db"&&!L.mergedInto&&!L.unplaced&&n.has(L)).map(L=>{ const g=globalPos(L,t);
      return {L,d:me&&g&&L.system===mySys?d3(g,me):null}; });
    if(!L.length) continue;
    // Nearest first in your system; then the system you're looking at, then the rest
    L.sort((a,b)=>(a.d==null)-(b.d==null)||(a.d??0)-(b.d??0)||(a.L.system!==S.system)-(b.L.system!==S.system)||a.L.name.localeCompare(b.L.name));
    L.slice(0,RS_NEED_MAX).forEach((x,i)=>{ const it=rsLocItem(x.L,-1);
      it.sub=`${i===0&&x.d!=null?"Closest · ":""}${x.d!=null?fmtDist(x.d)+" away · ":""}${TYPES[x.L.type]?.one||"Place"} · ${x.L.body||"Space"}${x.L.system!==S.system?", "+x.L.system:""}`;
      it.need=n.k; it.closest=i===0&&x.d!=null;
      if(i===0) it.head=`${me?"Nearest":"Places with"} ${n.label}${L.length>RS_NEED_MAX?` · ${RS_NEED_MAX} of ${L.length}`:""}${me?"":" · set your position (/showlocation) to sort by distance"}`;
      out.push(it); }); }
  if(out.length) out[out.length-1].tail=true;
  return out; }
const RS_MAX=250;
function rsRender(){
  const mode=rsMode(), list=$("rs-list"), route=S.live?.route||[], q=$("rsearch").value.trim();
  $("rs-panel").hidden=false; $("route-body").hidden=mode==="search";
  $("rsearch").setAttribute("aria-expanded",String(mode==="search"));
  // While searching, the route is hidden under the results: a bar says it's there and brings it back.
  const rb=$("rs-routebar"); if(rb){ rb.hidden=!(mode==="search"&&route.length);
    if(!rb.hidden) rb.textContent=`Your route · ${route.length} stop${route.length>1?"s":""} · Plan / Optimize ›`; }
  let all=mode==="search"?rsCandidates(q):rsBrowse();
  if(mode==="search"){ const needs=rsNeedItems(q); if(needs.length){ const seen=new Set(needs.map(x=>x.name)), rest=all.filter(x=>!seen.has(x.name));
    if(rest.length) rest[0].head="Names matching your search"; all=[...needs,...rest]; } }
  RS.items=all.slice(0,RS_MAX); RS.more=all.length-RS.items.length; RS.on=Math.min(RS.on,Math.max(0,RS.items.length-1));
  const hl=n=>{ if(!q) return esc(n); const i=n.toLowerCase().indexOf(q.toLowerCase()); return i<0?esc(n):esc(n.slice(0,i))+"<mark>"+esc(n.slice(i,i+q.length))+"</mark>"+esc(n.slice(i+q.length)); };
  const kb=mode==="search";                       // the keyboard pick is shown while typing
  list.innerHTML=RS.items.length?RS.items.map((it,i)=>`${it.head?`<li class="rs-head" role="presentation">${esc(it.head)}</li>`:""}<li role="option" data-i="${i}" data-name="${esc(it.name)}" class="${kb&&i===RS.on?"on":""}${S.selected?.name===it.name?" sel":""}"><span class="ty ${it.kind==="body"?"body":it.type}"></span>
      <div style="min-width:0"><div class="n">${hl(it.name)}</div><div class="b">${esc(it.sub)}</div></div>
      ${it.closest?`<button class="btn small go" data-act="guide" title="Guide me to ${esc(it.name)}">Go</button>`:""}${it.kind==="body"?`<button class="btn small ghost" data-act="fly">Fly to</button>`:S.locMap[it.name]?.unplaced?`<button class="iconbtn" data-act="fly" title="Position not known yet: open it to set it">?</button>`:route.includes(it.name)?`<button class="iconbtn in" data-act="add" title="In your route: click to add it again">✓</button>`:`<button class="iconbtn" data-act="add" title="Add to route">+</button>`}</li>`).join("")
      +(RS.more>0?`<li class="empty">${RS.more} more. ${mode==="search"?"Type more of the name":"Pick a type above or search"} to narrow it down.</li>`:"")
    :`<li class="empty">${mode==="search"?`No match for “${esc(q)}”${RS.type?` in ${esc(TYPES[RS.type]?.label||"")}`:""}`:`No ${RS.type?esc((TYPES[RS.type]?.label||"places").toLowerCase()):"places"} in ${esc(S.system)}`}</li>`;
}
// Back to the route. The type chip goes back to All too, so the next search isn't quietly filtered.
// showRoute(): the same, used after adding or guiding from a place card or the map, so the stop you just
// added shows in the route list with Plan route / Optimize (the search kept it hidden before).
function showRoute(){ if(rsMode()==="search") rsClose(); else rsRender(); }
function rsClose(){ $("rsearch").value=""; RS.on=0; RS.type=null;
  for(const x of $("filters").children) x.setAttribute("aria-pressed",String(!x.dataset.t)); rsRender(); $("rsearch").blur(); }
async function rsPick(i,act,{fromKeys=false}={}){
  const it=RS.items[i]; if(!it) return;
  if(it.kind==="body"){ focusBody(it.name); select({kind:"body",name:it.name}); }
  else if(act==="add"){ await addStops([it.name]);
    // From the keyboard: add, show it and go back to the route. A click on + keeps the list, to add more.
    if(fromKeys){ select({kind:"loc",name:it.name}); focusLoc(it.name,true); rsClose(); return; } }
  else if(act==="guide"){ await api().set_guide(it.name); await poll(); select({kind:"loc",name:it.name}); focusLoc(it.name,true); showRoute(); setFollow(true); followNow(); toast(`Guiding you to ${it.name}`); return; }
  else { select({kind:"loc",name:it.name}); focusLoc(it.name,true); }
  rsRender();
}
$("rsearch").oninput=()=>{ RS.on=0; rsRender(); };
$("rs-routebar").onclick=()=>rsClose();
$("rsearch").onkeydown=e=>{
  const move=d=>{ RS.on=Math.max(0,Math.min(RS.on+d,RS.items.length-1)); rsRender(); $("rs-list").querySelector("li.on")?.scrollIntoView({block:"nearest"}); e.preventDefault(); };
  if(e.key==="ArrowDown") move(1); else if(e.key==="ArrowUp") move(-1);
  else if(e.key==="Enter"){ const it=RS.items[RS.on]; if(it&&$("rsearch").value.trim()) rsPick(RS.on, it.kind==="body"?"fly":"add", {fromKeys:true}); e.preventDefault(); }
  else if(e.key==="Escape"){ rsClose(); e.preventDefault(); } };
$("rs-list").onclick=e=>{ const li=e.target.closest("li[data-i]"); if(!li) return;
  const b=e.target.closest("[data-act]"); rsPick(+li.dataset.i, b?b.dataset.act:(RS.items[+li.dataset.i]?.kind==="body"?"fly":"view")); };

// ---- contracts
// A contract you're already on gets a new objective with a place (a patrol's next waypoint, the next leg of a
// mission): the map follows along. If that contract already has stops in your route, or you have no route,
// the new objective becomes a stop and the map shows the way there from you; with someone else's route
// planned it only flies the map to the objective and leaves your route alone. Brand-new contracts aren't
// touched: their stops go in when you press "Add to route".
async function watchNewObjectives(live){
  const keyOf=(c,o)=>`${c.id}|${o.id}|${o.location||(o.marker?.pos||[]).map(v=>Math.round(v)).join(",")}`;
  const act=(live.contracts||[]).filter(c=>c.status==="active");
  const keys=new Set(), fresh=[], known=S.objContracts;
  for(const c of act) for(const o of c.objectives||[]){ if(o.status!=="active"||!(o.location||o.marker)) continue;
    const k=keyOf(c,o); keys.add(k); if(S.objSeen&&!S.objSeen.has(k)&&known?.has(c.id)) fresh.push({c,o}); }
  S.objSeen=keys; S.objContracts=new Set(act.map(c=>c.id));
  if(!fresh.length||S.objBusy) return;
  const {c,o}=fresh.find(x=>!x.o.in_route)||fresh[0]; S.objBusy=true;
  try{
    const ours=(c.objectives||[]).some(x=>x.in_route)||!(live.route||[]).length;
    if(ours&&!o.in_route){ const r=await api().add_contract_stops(c.id,o.id); await poll();
      if(r.ok){ toast(`New objective: ${o.label}. Added to your route`); fitRoute(false); return; } }
    else if(o.in_route){ fitRoute(false); toast(`New objective: ${o.label}`); return; }
    // Not routing it: just show where it is
    if(o.location&&S.locMap[o.location]){ focusLoc(o.location,true); }
    else if(o.marker&&(!o.marker.body||S.bodyMap[o.marker.body])){ if(o.marker.system&&o.marker.system!==S.system) setSystem(o.marker.system,false);
      if(!o.marker.body) flyTo({kind:"point",pos:o.marker.pos},60000); else flyTo({kind:"local",body:o.marker.body,pos:o.marker.pos},Math.max(15000,S.bodyMap[o.marker.body].radius*0.06),TOPDOWN); }
    toast(`New objective: ${o.label}. Add it to your route from the Contracts tab`);
  } finally { S.objBusy=false; } }
function renderContracts(force){
  const typing=$("contracts").contains(document.activeElement)&&document.activeElement.tagName==="INPUT";
  if(typing&&!force) return;
  const live=S.live, cs=live.contracts, delivered=c=>c.status==="complete"&&!c.acked, active=cs.filter(c=>c.status==="active"||delivered(c)), done=cs.filter(c=>c.status!=="active"&&!delivered(c));
  const cnt=$("c-contracts"); cnt.textContent=active.length; cnt.classList.toggle("hot",active.length>0);
  $("plan-all-bar").style.display=active.length?"flex":"none";
  const lg=live.log, ok=lg.status==="watching";
  $("logbar").style.display = ok ? "none" : "";       // all good: it lives in Settings
  $("logbar").innerHTML = ok
    ? `<div class="row"><span class="dot on"></span><b>Reading Game.log</b><span class="spacer"></span><button class="btn small ghost" id="lb-change">Change</button></div><div class="path">${esc(lg.path)}</div>`
    : `<div class="row"><span class="dot warn"></span><b>${lg.game_running?"Waiting for Game.log":"Looking for Game.log"}</b></div>
       <div class="muted" style="margin:4px 0 8px">${lg.game_running?"Star Citizen is running; its log will be picked up in a moment.":"It's picked up automatically when Star Citizen starts. You can also point Quantum at it: it's usually <span style=\"color:var(--ink-2)\">…\\StarCitizen\\LIVE\\Game.log</span>"}</div>
       <div class="row"><input class="field" id="lb-path" placeholder="Paste the full path" style="flex:1"><button class="btn small" id="lb-set">Use</button><button class="btn small" id="lb-browse">Browse</button></div>`;
  const on=(id,f)=>{ const x=$(id); if(x) x.onclick=f; };
  on("lb-change",async()=>{ const r=await api().browse_log(); if(r.ok) toast("Now reading the selected Game.log"); });
  on("lb-set",async()=>{ const r=await api().set_log_path($("lb-path").value); toast(r.ok?"Now reading Game.log":r.error); });
  on("lb-browse",async()=>{ const r=await api().browse_log(); if(r.ok) toast("Now reading Game.log"); });
  const route=live.route||[];
  const hhmm=x=>{ if(!x) return ""; const d=new Date(x*1000), today=new Date().toDateString()===d.toDateString();
    return (today?"":d.toLocaleDateString([], {day:"numeric",month:"short"})+" ")+d.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}); };
  const tracker=c=>{ const tr=c.tracking; if(!tr) return "";
    const st=tr.stage, cancel=tr.cancelled, multi=tr.dropoffs>1;
    // With several drop-offs the last segment fills one delivery at a time.
    const part=st===2&&multi?tr.delivered/tr.dropoffs:0, pct=Math.min(100,(st+part)/3*100);
    const pickupAt=(c.objectives.find(o=>o.kind==="pickup")||{}).location;
    const coll=tr.collection;   // Wikelo: gather items anywhere, hand them in at an emporium
    const heads=coll?["Gathering items","Items in hand","On the way","Turned in"]:["Waiting for pickup","Collected","Out for delivery","Delivered"];
    const head=cancel?(tr.status==="failed"?"Failed":"Abandoned"):heads[st];
    let eta="";
    if(cancel) eta=hhmm(c.updated_at);
    else if(st===0&&coll) eta=c.turn_in?`Hand in at ${esc(c.turn_in.replace("Wikelo Emporium ",""))}`:"";
    else if(st===0) eta=pickupAt?`Collect at ${esc(pickupAt)}`:(tr.pickups?"Pickup location not in the log yet":"");
    else if(st===3) eta=`Delivered ${hhmm(tr.times[3])}`;
    else if(multi&&st>=1){ const next=tr.drops.find(d=>d.status==="active");
      eta=`${tr.delivered} of ${tr.dropoffs} delivered${next?` · next: ${esc(next.where||"a drop-off")}${tr.to_go!=null&&!tr.other_system?` (<b>${fmtDist(tr.to_go)}</b>)`:""}`:""}`; }
    else if(tr.to_go!=null&&!tr.other_system) eta=`<b>${fmtDist(tr.to_go)}</b> to ${esc(tr.dest||"the drop-off")}`;
    else if(tr.dest) eta=`Deliver to ${esc(tr.dest)}`;
    const names=coll?["Accepted",tr.pickups&&st===0&&tr.picked?`Got ${tr.picked}/${tr.pickups}`:"Items in hand","On the way",
      multi&&st<3?`Handed in ${tr.delivered}/${tr.dropoffs}`:"Turned in"]
      :["Accepted",tr.pickups>1&&st===0&&tr.picked?`Collected ${tr.picked}/${tr.pickups}`:"Collected","Out for delivery",
      multi&&st<3?`Delivered ${tr.delivered}/${tr.dropoffs}`:"Delivered"];
    const nodes=[0,1,2,3].map(i=>`<span class="node ${i<st||(i===st&&st===3)?"done":i===st?"cur":""}" style="left:${i/3*100}%"></span>`).join("");
    const labels=names.map((n,i)=>`<div class="${i<=st||(i===3&&tr.delivered)?"on":""}"><b>${n}</b>${i<=st?hhmm(tr.times[i]):i===3&&tr.last_drop?hhmm(tr.last_drop):""}</div>`).join("");
    // What you're hauling: SCU per commodity (from the delivery objectives), delivered so far, and the total.
    const unit=coll?"×":"SCU";
    const cargoRow=tr.scu_total&&!coll?`<div class="cargo"><span class="k">Cargo</span>${tr.cargo.map(g=>`<span><b>${g.total} ${unit}</b> ${esc(g.what)}${st>=1&&g.done?` <span class="muted">(${g.done} delivered)</span>`:""}</span>`).join("")}${tr.cargo.length>1?`<span class="muted">${tr.scu_total} SCU total</span>`:""}</div>`:"";
    const dropRows=multi?`<div class="drops">${tr.drops.map(d=>`<div class="${d.status}"><span class="ck">${d.status==="done"?"✓":""}</span>${esc(d.where||"Drop-off")}${d.scu?` <span class="muted">${d.scu[0]}/${d.scu[1]} SCU</span>`:""}${d.at?` <span class="muted">· ${hhmm(d.at)}</span>`:""}</div>`).join("")}</div>`:"";
    const outBtn=c.status==="active"&&!cancel&&!coll&&st===1?`<div class="row" style="margin-top:8px"><span class="muted" style="font-size:12px">Goes out for delivery when you set your in-game route to the drop-off.</span><span class="spacer"></span>
      <button class="btn small primary" data-act="outdeliv" title="Mark it out for delivery now">Out for delivery</button></div>`
      :c.status==="active"&&!cancel&&st===2&&tr.departed_how?`<div class="row" style="margin-top:6px"><span class="muted" style="font-size:12px">${tr.departed_how==="route"?"You set your route to the drop-off":"Marked by you"}</span><span class="spacer"></span>
      <button class="btn small ghost" data-act="outundo" title="Back to Collected">Undo</button></div>`:"";
    const openPicks=c.status==="active"&&!cancel&&st===0?c.objectives.filter(o=>o.kind==="pickup"&&o.status==="active").length:0;
    const markBtn=openPicks?`<div class="row" style="margin-top:8px"><span class="muted" style="font-size:12px">Picked up but not showing?</span><span class="spacer"></span>
      <button class="btn small" data-act="collectall" title="Marks ${openPicks>1?"every open pickup":"the pickup"} as collected, then types /showlocation in game for your position">Mark picked up</button></div>`:"";
    return `<div class="track ${cancel?"cancel":""}"><div class="head"><span class="st">${head}</span><span class="eta">${eta}</span></div>
      <div class="bar"><div class="fill" style="width:${pct}%"></div>${nodes}</div><div class="labels">${labels}</div>${cargoRow}${dropRows}${markBtn}${outBtn}</div>`; };
  // Contract details from the Star Citizen Wiki (the mission's template: payout range, rep, cargo, the places it can use).
  S.cw=S.cw||{}; S.cwOpen=S.cwOpen||new Set();
  const n0=x=>Number(x).toLocaleString();
  const rng=(a,b,u="")=>a!=null&&b!=null&&a!==b?`${n0(a)}–${n0(b)}${u}`:`${n0(b??a)}${u}`;
  const cwiki=c=>{ const st=S.cw[c.id];
    if(!st) return c.status==="active"?`<div class="cwiki-line muted">Looking up contract details…</div>`:"";
    if(st.loading) return `<div class="cwiki-line muted">Looking up contract details…</div>`;
    if(st.error) return `<div class="cwiki-line muted">${esc(st.error)} <a data-cwretry="${esc(c.id)}" style="cursor:pointer;text-decoration:underline">Retry</a></div>`;
    const w=st.info; if(!w) return `<div class="cwiki-line muted">No details for this contract on the Star Citizen Wiki yet.</div>`;
    const bits=[w.reward?`<b>${rng(w.reward[0],w.reward[1])} ${esc(w.currency)}</b>`:"",
      ...(w.rep||[]).slice(0,1).map(r=>`+${n0(r.amount)} rep`), w.minutes?`~${w.minutes} min`:"", w.illegal?`<span style="color:#ff9b8a">Illegal</span>`:""].filter(Boolean);
    const row=(k,v)=>v?`<div class="cw-row"><span class="k">${k}</span><span>${v}</span></div>`:"";
    const plist=g=>g&&g.names.length?g.names.map(esc).join(", ")+(g.more?` <span class="muted">+${g.more} more</span>`:""):"";
    const cargo=(w.cargo||[]).map(o=>`${esc(o.what)}${o.scu?` <span class="muted">${rng(o.scu[0],o.scu[1]," SCU")}${o.box?`, ≤${o.box} SCU boxes`:""}</span>`:o.amount?` <span class="muted">×${rng(o.amount[0],o.amount[1])}</span>`:""}`).join("<br>");
    return `<details class="cwiki" data-cw="${esc(c.id)}" ${S.cwOpen.has(c.id)?"open":""}><summary>Contract details${bits.length?` <span class="cw-sum">${bits.join(" · ")}</span>`:""}</summary>
      <div class="cw-body">
        ${row("Payout",w.reward?`${rng(w.reward[0],w.reward[1])} ${esc(w.currency)}${w.reward[0]!==w.reward[1]?` <span class="muted">(depends on the contract you got)</span>`:""}`:"")}
        ${row("Reputation",(w.rep||[]).map(r=>`+${n0(r.amount)}${r.faction?" "+esc(r.faction):""}`).join(", "))}
        ${row("Given by",esc(w.giver||w.faction||""))}
        ${row("Time",w.minutes?`About ${w.minutes} minutes`:"")}
        ${row("Rank",w.rank!=null&&w.rank>0?`Rank ${w.rank}`:"")}
        ${row("Combat",w.combat?(w.enemies?`Yes, ${rng(w.enemies[0],w.enemies[1])} enemies`:"Yes"):"")}
        ${row("Players",w.max_players>1?`Up to ${w.max_players}${w.shareable?", shareable":""}`:"")}
        ${row("Cargo",cargo)}
        ${row("Pickups at",plist(w.pickups))}
        ${row("Deliver to",plist(w.destinations))}
        ${row("Rewards",(w.reward_items||[]).map(esc).join(", "))}
        ${row("Blueprints",(w.blueprints||[]).map(esc).join(", "))}
        <div class="muted" style="font-size:11.5px;margin-top:6px">Ranges and possible places for this kind of contract, from the game files. Your own pickup and drop-off are the objectives above.
          ${w.url?`<a data-url="${esc(w.url)}" style="cursor:pointer;text-decoration:underline">Open on api.star-citizen.wiki</a>`:""}</div></div></details>`; };
  const cwFetch=async id=>{ S.cw[id]={loading:true}; let r; try{ r=await api().contract_wiki(id); }catch(e){ r={ok:false,error:"Couldn't look it up"}; }
    S.cw[id]=r.ok?{info:r.info}:{error:r.error}; renderContracts(); };
  const foundNote={visited:"from where you collected it",station:"from station traffic data",zone:"same building as another contract",manual:"set by you",coords:"from the coordinates in the contract",learned:"where you set it on a contract like this before",contract:"from the contract's details in the log",wiki:"from the Star Citizen Wiki's list for this contract (the only one in that system)"};
  const card=c=>{ const age=Math.max(0,live.now-c.accepted_at); const ago=age<3600?`${Math.max(1,Math.round(age/60))} min ago`:age<86400?`${(age/3600).toFixed(1)} h ago`:`${Math.round(age/86400)} d ago`;
    const active=c.status==="active", isDelivered=c.status==="complete"&&!c.acked;
    const objs=c.objectives.map(o=>{ const where=o.location||(o.marker?(o.marker.body?(o.marker.near_place?`${o.marker.near_km} km from ${o.marker.near_place} (${o.marker.body}${o.marker.system&&o.marker.system!==S.system?", "+o.marker.system:""})`:`Marker on ${o.marker.body}`):o.marker.from_text?`Contract coordinates${o.marker.near?` near ${o.marker.near}`:""}`:`Marker near ${o.marker.lpoint||o.marker.near||"a Lagrange point"}`):null); const live_=o.status==="active"&&active;
      const inR=o.in_route;
      // Pickups don't state the amount; it's what the delivery objectives add up to for that cargo.
      const cg=c.tracking?.cargo||[], nm=x=>(x||"").toLowerCase().replace("aluminium","aluminum");
      const pick=/^(pick up|collect)\b/i.test(o.label||"") && !/SCU/.test(o.label||"") && cg.length
        ? (cg.length===1 ? cg[0] : cg.find(g=>nm(o.label).includes(nm(g.what)))) : null;
      const need=o.need, getter=need&&c.objectives.find(g=>g.item_for===o.id);
      const unknown = live_ && need ? (getter ? "" : `<div class="unknown">Where will you get it? It can come from any shop, loot or mining. Add the place and it becomes a stop before the hand-in.
          <div class="row"><input class="field" list="places-dl" placeholder="A shop, station or city" data-pick="${esc(o.id)}" style="flex:1;padding:4px 8px">
          <button class="btn small" data-act="setsrc" data-oid="${esc(o.id)}">Set</button></div></div>`)
        : live_ && !where ? `<div class="unknown">The log only says it's inside a station or building${o.suggest?.length?`. The Star Citizen Wiki says this contract uses one of these. Pick the one in your mobiGlas:
          <div class="row" style="flex-wrap:wrap;gap:6px;margin:6px 0">${o.suggest.map(p=>`<button class="btn small" data-act="setsug" data-oid="${esc(o.id)}" data-place="${esc(p)}">${esc(p)}</button>`).join("")}</div>`:"."}
          <div class="row"><input class="field" list="places-dl" placeholder="Type the place from your mobiGlas" data-pick="${esc(o.id)}" style="flex:1;padding:4px 8px">
          <button class="btn small" data-act="setplace" data-oid="${esc(o.id)}">Set</button><button class="btn small ghost" data-act="here" data-oid="${esc(o.id)}" title="Use the nearest place to your last /showlocation">I'm here</button></div></div>` : "";
      return `<div class="obj ${o.status}"><div class="tick"></div><div><div class="txt">${esc(o.label)}${pick?` <span class="muted">· ${pick.total} SCU</span>`:""}</div>
        ${where&&live_?`<div><span class="where" data-cid="${c.id}" data-oid="${esc(o.id)}">◆ ${esc(where)}</span>${inR?'<span class="tag-in">✓ in route</span>':""}</div>${o.found==="turnin"?`<div class="found">Hand-in: ${c.turn_in_how==="manual"?"chosen by you":"the Wikelo Emporium nearest to you"}</div>`:foundNote[o.found]?`<div class="found">Location ${foundNote[o.found]}</div>`:""}`:""}${need&&live_&&!where?`<div class="found">Hand in at ${esc(c.turn_in||"a Wikelo Emporium")}</div>`:""}${unknown}</div>
        <div class="obj-acts">${live_&&o.item_for?`<button class="btn small ghost" data-act="clearsrc" data-oid="${esc(o.item_for)}" title="Remove this stop">Remove</button>`:""}${live_&&o.kind==="pickup"?`<button class="btn small ghost" data-act="collect" data-oid="${esc(o.id)}" title="The game didn't report this pickup: mark it collected. Quantum also types /showlocation in game for your position">Collected</button>`:""}${where&&live_?`<button class="btn small go" data-act="guide" data-oid="${esc(o.id)}">Guide</button>`:""}</div></div>`; }).join("")
      || `<div class="muted" style="font-size:13px">Objectives appear as the game reports them.</div>`;
    const placeable=c.objectives.filter(o=>o.status==="active"&&(o.location||o.marker));
    const pending=placeable.filter(o=>!o.in_route).length;
    const status={active:"Accepted "+ago, complete:"Completed", failed:"Failed", abandoned:"Abandoned"}[c.status]||c.status;
    const routeBtn = !active||!placeable.length ? "" : pending
      ? `<button class="btn small primary" data-act="route">Add ${pending} stop${pending>1?"s":""} to route</button>`
      : `<span class="inroute" data-act="showroute" title="Open the route"><span class="ck">✓</span>In route</span>`;
    const emps=S.locs.filter(L=>L.name.startsWith("Wikelo Emporium")).map(L=>L.name).sort();
    const tin=c.turn_in&&S.locMap[c.turn_in];
    const turnIn = c.collection&&active ? `<div class="turnin"><span class="k">Hand in at</span>
        <select class="field" data-act="turnin">${c.turn_in?"":`<option value="">Nearest (needs your position)</option>`}${emps.map(n=>`<option value="${esc(n)}" ${n===c.turn_in?"selected":""}>${esc(n.replace("Wikelo Emporium ",""))}${n===c.turn_in&&c.turn_in_how==="nearest"?" (nearest)":""}</option>`).join("")}</select>
        ${tin?.unplaced?`<div class="unknown">Quantum doesn't know where ${esc(c.turn_in)} is yet, so it can't be a route stop. Fly there, type /showlocation, and press <b>I'm here: set position</b> on <a data-open="${esc(c.turn_in)}">its card</a>. Once is enough.</div>`:""}</div>` : "";
    return `<div class="contract ${active?"":isDelivered?"delivered":"done"}" data-id="${c.id}"><h3>${esc(c.subtitle?c.subtitle+": ":"")}${esc(c.name)}</h3>
      <div class="sub">${isDelivered?`<span class="dlv-pill">✓ Delivered</span>`:status}${c.system?" · "+esc(c.system):""}</div>
      ${c.tracking_no||c.job_id?`<div class="trackids">${c.tracking_no?`<div class="trackno" title="Click to copy">Tracking <b>${esc(c.tracking_no)}</b></div>`:""}${c.job_id?`<div class="trackno" title="The game's own id for this contract (from Game.log). Click to copy">Job ID <b>${esc(c.job_id)}</b></div>`:""}</div>`:""}${tracker(c)}${cwiki(c)}${turnIn}${objs}
      <div class="row" style="margin-top:10px">${routeBtn}<span class="spacer"></span>${isDelivered?`<button class="btn small primary" data-act="closeout" title="Move it to Finished">Close out job</button>`:`<button class="btn small ghost" data-act="dismiss">Dismiss</button>`}</div></div>`; };
  $("contracts").innerHTML=(active.length?active.map(card).join(""):`<div class="empty"><strong>No active contracts</strong>${ok?"Objectives will show up on the map once a contract has been accepted.":"Point the app at Game.log to track contracts."}</div>`)
    +(done.length?`<details class="finished" ${S.finishedOpen?"open":""}><summary>Finished (${done.length})</summary>${done.map(card).join("")}<button class="btn small ghost" id="btn-clear-finished">Clear finished</button></details>`:"");
  const fin=$("contracts").querySelector("details.finished"); if(fin) fin.ontoggle=()=>{ S.finishedOpen=fin.open; };
  $("contracts").querySelectorAll("details.cwiki").forEach(d=>d.ontoggle=()=>{ d.open?S.cwOpen.add(d.dataset.cw):S.cwOpen.delete(d.dataset.cw); });
  active.filter(c=>!S.cw[c.id]).forEach(c=>cwFetch(c.id));      // once per contract; cached on disk too
  on("btn-clear-finished",async()=>{ await api().clear_finished_contracts(); await poll(); });
  $("contracts").onchange=async e=>{ if(e.target.dataset?.act!=="turnin") return; const cardEl=e.target.closest(".contract"); const v=e.target.value; if(!v) return;
    const r=await api().set_turn_in(cardEl.dataset.id,v); await poll(); renderContracts(true); toast(r.ok?`Handing in at ${v}`:r.error); };
  $("contracts").onclick=async e=>{
    const w=e.target.closest(".where"); if(w){ const c=cs.find(x=>x.id===w.dataset.cid), o=c.objectives.find(o=>o.id===w.dataset.oid);
      if(o.location){ select({kind:"loc",name:o.location}); focusLoc(o.location,true); } else if(o.marker){ if(o.marker.system!==S.system) setSystem(o.marker.system,false);
        if(!o.marker.body) flyTo({kind:"point",pos:o.marker.pos},60000); else flyTo({kind:"local",body:o.marker.body,pos:o.marker.pos},Math.max(15000,S.bodyMap[o.marker.body].radius*0.06),TOPDOWN); } return; }
    const cu=e.target.closest("[data-url]"); if(cu){ api().open_url(cu.dataset.url); return; }
    const cr=e.target.closest("[data-cwretry]"); if(cr){ cwFetch(cr.dataset.cwretry); return; }
    const tn=e.target.closest(".trackno"); if(tn){ const n=tn.querySelector("b").textContent; try{ await navigator.clipboard.writeText(n); toast(`Copied ${n}`); }catch{ toast(n); } return; }
    const op=e.target.closest("[data-open]"); if(op){ select({kind:"loc",name:op.dataset.open}); focusLoc(op.dataset.open,true); return; }
    const act=e.target.dataset?.act, cardEl=e.target.closest(".contract"); if(!act||!cardEl) return; const c=cs.find(x=>x.id===cardEl.dataset.id);
    if(act==="turnin") return;   // handled on change
    if(act==="setsrc"){ const inp=cardEl.querySelector(`input[data-pick="${CSS.escape(e.target.dataset.oid)}"]`); const v=(inp?.value||"").trim();
      if(!S.locMap[v]||S.locMap[v].unplaced) return toast("Pick a place from the suggestions"); const r=await api().set_item_source(c.id,e.target.dataset.oid,v); await poll(); renderContracts(true); toast(r.ok?`Get it at ${v}`:r.error); return; }
    if(act==="clearsrc"){ const r=await api().set_item_source(c.id,e.target.dataset.oid,null); await poll(); renderContracts(true); if(!r.ok) toast(r.error); return; }
    if(act==="dismiss"){ await api().dismiss_contract(c.id); await poll(); }
    if(act==="closeout"){ await api().close_out_contract(c.id); await poll(); }
    if(act==="outdeliv"||act==="outundo"){ const r=await api().contract_out_for_delivery(c.id,act==="outdeliv"); if(!r.ok) return toast(r.error); await poll(); renderContracts(true);
      return toast(act==="outdeliv"?"Out for delivery":"Back to Collected"); }
    if(act==="collectall"){ const r=await api().mark_collected(c.id,null); if(!r.ok) return toast(r.error); await poll(); renderContracts(true);
      return toast(r.sending?"Marked picked up. Sending /showlocation to Star Citizen":`Marked picked up. ${r.note||""}`); }
    if(act==="collect"){ const r=await api().mark_collected(c.id,e.target.dataset.oid); if(!r.ok) return toast(r.error); await poll(); renderContracts(true);
      toast(r.sending?"Marked collected. Sending /showlocation to Star Citizen":`Marked collected. ${r.note||""}`); }
    // The reply carries how many stops it added ("added"), not their names: r.names threw here, so the toast never
    // showed and nothing moved. Now the map also swings to the route so you can see the way to the new stops.
    if(act==="route"){ const r=await api().add_contract_stops(c.id,null); await poll(); renderContracts(true); if(!r.ok) return toast(r.error);
      toast(r.added?`Added ${r.added} stop${r.added>1?"s":""} to route`:"Already in your route"); fitRoute(false); }
    if(act==="showroute"){ fitRoute(); }
    if(act==="setplace"){ const inp=cardEl.querySelector(`input[data-pick="${CSS.escape(e.target.dataset.oid)}"]`); const v=(inp?.value||"").trim();
      if(!S.locMap[v]) return toast("Pick a place from the suggestions"); const r=await api().set_objective_place(c.id,e.target.dataset.oid,v); await poll(); renderContracts(true); toast(r.ok?`Set to ${v}`:r.error); }
    if(act==="setsug"){ const v=e.target.dataset.place; const r=await api().set_objective_place(c.id,e.target.dataset.oid,v); await poll(); renderContracts(true); toast(r.ok?`Set to ${v}. Contracts like this one will use it too`:r.error); }
    if(act==="here"){ const r=await api().objective_place_here(c.id,e.target.dataset.oid); await poll(); renderContracts(true); toast(r.ok?`Set to ${r.name}`:r.error); }
    if(act==="guide"){ const r=await api().guide_objective(c.id,e.target.dataset.oid); if(!r.ok) return toast(r.error); await poll(); focusLoc(r.name,true); toast(`Guiding you to ${r.name}`); } };
}

// ---- waypoints
function renderCapture(){ const p=S.live?.player, el=$("cap-pos");
  if(!p){ el.innerHTML="Type <b>/showlocation</b> in game chat, then save."; return; }
  const age=p.age<60?`${Math.round(p.age)} s ago`:`${Math.round(p.age/60)} min ago`;
  el.innerHTML = p.body ? `On <b>${esc(p.body)}</b> at ${p.lat.toFixed(3)}°, ${p.lon.toFixed(3)}°, altitude ${fmtDist(p.alt)} <span class="muted">(${age})</span>`
                        : `In space in <b>${esc(p.system)}</b> <span class="muted">(${age})</span>`; }
function renderWaypoints(force){
  const t=now(); const wps=S.locs.filter(L=>L.source==="user").sort((a,b)=>(b.pinned-a.pinned)||(b.created-a.created));
  $("c-wp").textContent=wps.length;
  const key=JSON.stringify([wps.map(w=>[w.name,w.pinned,w.body]),S.live?.guide?.name,S.editing,Math.round((S.live?.player?.t||0))]);
  if(!force && key===S.wpKey) return; S.wpKey=key;
  const guide=S.live?.guide?.name;
  $("wp-list").innerHTML = wps.length ? wps.map(L=>{ const from=distFromYou(globalPos(L,t),L.system);
    const where=L.body?`${L.body}${L.system!==S.system?" · "+L.system:""}`:`Space, ${L.system}`;
    const nameHtml = S.editing===L.name ? `<input class="field rename" value="${esc(L.name)}" data-old="${esc(L.name)}">` : `<div class="n" title="${esc(L.name)}">${esc(L.name)}</div>`;
    return `<div class="wp" data-name="${esc(L.name)}"><button class="star ${L.pinned?"on":""}" title="${L.pinned?"Unpin from map":"Pin on map"}" aria-label="Pin">${L.pinned?"★":"☆"}</button>
      <div style="min-width:0">${nameHtml}<div class="m">${esc(where)}${from!=null?` · ${fmtDist(from)} away`:""}${L.notes?` · ${esc(L.notes)}`:""}</div></div>
      <div class="acts">${guide===L.name?`<button class="btn small" data-a="unguide">Stop</button>`:`<button class="btn small go" data-a="guide">Guide</button>`}
        <button class="iconbtn" data-a="route" title="Add to route">+</button><button class="iconbtn" data-a="rename" title="Rename" style="color:var(--ink-2)">✎</button></div></div>`; }).join("")
    : `<div class="empty"><strong>No waypoints yet</strong>Found something worth coming back to? Type /showlocation in game chat and save it here. The app can then guide you back to it.</div>`;
  const inp=$("wp-list").querySelector("input.rename"); if(inp){ inp.focus(); inp.select();
    const done=async commit=>{ const old=inp.dataset.old; S.editing=null; if(commit&&inp.value.trim()&&inp.value.trim()!==old){ const r=await api().rename_location(old,inp.value); if(!r.ok) toast(r.error); await poll(); } renderWaypoints(true); };
    inp.onkeydown=e=>{ if(e.key==="Enter") done(true); if(e.key==="Escape") done(false); }; inp.onblur=()=>done(true); }
}
$("wp-list").onclick=async e=>{ const row=e.target.closest(".wp"); if(!row) return; const n=row.dataset.name, L=S.locMap[n];
  if(e.target.classList.contains("star")){ await api().set_pinned(n,!L.pinned); await poll(); return; }
  if(e.target.classList.contains("n")){ select({kind:"loc",name:n}); focusLoc(n,true); return; }
  const a=e.target.dataset?.a; if(!a) return;
  if(a==="guide"){ await api().set_guide(n); await poll(); select({kind:"loc",name:n}); setFollow(true); followNow(); toast(`Guiding you to ${n}`); }
  if(a==="unguide"){ await api().set_guide(null); await poll(); }
  if(a==="route") addStops([n]);
  if(a==="rename"){ S.editing=n; renderWaypoints(true); } };
// Right-click a waypoint: a small menu with Delete (asks once), Rename and Add to route
function wpMenu(e,n){ e.preventDefault(); document.querySelector(".wp-ctx")?.remove();
  const m=document.createElement("div"); m.className="wp-ctx"; m.setAttribute("role","menu");
  m.innerHTML=`<div class="h">${esc(n)}</div><button data-m="route">Add to route</button><button data-m="rename">Rename</button><button data-m="delete" class="danger">Delete waypoint</button>`;
  document.body.appendChild(m); const r=m.getBoundingClientRect();
  m.style.left=Math.min(e.clientX,innerWidth-r.width-6)+"px"; m.style.top=Math.min(e.clientY,innerHeight-r.height-6)+"px";
  const close=()=>{ m.remove(); removeEventListener("mousedown",away,true); removeEventListener("keydown",esc_,true); };
  const away=ev=>{ if(!m.contains(ev.target)) close(); }, esc_=ev=>{ if(ev.key==="Escape") close(); };
  setTimeout(()=>{ addEventListener("mousedown",away,true); addEventListener("keydown",esc_,true); },0);
  m.onclick=async ev=>{ const b=ev.target.closest("button"); if(!b) return; const k=b.dataset.m;
    if(k==="route"){ close(); addStops([n]); }
    if(k==="rename"){ close(); S.editing=n; renderWaypoints(true); }
    if(k==="delete"){ if(b.dataset.arm!=="1"){ b.dataset.arm="1"; b.textContent="Sure? Click again to delete"; return; }
      close(); const r=await api().delete_location(n); if(r&&r.ok===false) return toast(r.error||"Couldn't delete it");
      if(S.selected?.kind==="loc"&&S.selected.name===n) select(null); await poll(); renderWaypoints(true); toast(`Deleted ${n}`); } }; }
$("wp-list").addEventListener("contextmenu",e=>{ const row=e.target.closest(".wp"); if(!row||e.target.closest("input")) return; wpMenu(e,row.dataset.name); });
$("btn-wp-save").onclick=async()=>{ const r=await api().save_waypoint($("wp-name").value,$("wp-notes").value,true);
  if(!r.ok) return toast(r.error); toast(`Saved ${r.name}${r.body?" on "+r.body:""}`); $("wp-name").value=""; $("wp-notes").value=""; await poll(); renderWaypoints(true); };
$("wp-name").onkeydown=e=>{ if(e.key==="Enter") $("btn-wp-save").click(); };

// ---- place type chips (under the route search, while searching or browsing)
function buildFilters(){ const types=["city","station","outpost","cave","wreck","jump","field","comm","poi","om"];
  $("filters").innerHTML=`<button class="fchip" data-t="" aria-pressed="true">All</button>`+types.map(t=>`<button class="fchip" data-t="${t}" aria-pressed="false"><span class="ty ${t}"></span>${TYPES[t].label}</button>`).join("");
  $("filters").onclick=e=>{ const b=e.target.closest(".fchip"); if(!b) return; RS.type=b.dataset.t||null; RS.on=0;
    for(const x of $("filters").children) x.setAttribute("aria-pressed",String(x===b)); rsRender(); }; }
// Kept under their old names: they're called when the route, the system or the selection changes.
function renderResults(){ rsRender(); }
function highlightResult(){ for(const li of $("rs-list").children) li.classList?.toggle("sel",!!li.dataset?.name&&li.dataset.name===S.selected?.name); }

// ---- status & toast
// The system you're in, with where Quantum got it from. Click to correct it: the log says nothing
// when you go through a wormhole, so it can keep naming the system you left.
function sysPick(p){ const src={log:p.sys_from?`Game.log: ${p.sys_from}`:"Game.log",you:"set by you",wormhole:`went through ${p.sys_from}`,planet:"from the planet you're near"}[p.sys_how]||"Game.log";
  return `<select class="sys-pick" title="System from ${esc(src)}. Wrong? Pick the right one">${(S.systems||["Stanton","Pyro","Nyx"]).map(s=>`<option ${s===p.system?"selected":""}>${esc(s)}</option>`).join("")}</select>`; }
// ---- Play time: how long this game session has been running and tracked by Quantum
const fmtSpan=s=>{ s=Math.max(0,Math.floor(s)); const h=Math.floor(s/3600), m=Math.floor(s%3600/60), x=s%60;
  return h?`${h}h ${String(m).padStart(2,"0")}m`:`${m}m ${String(x).padStart(2,"0")}s`; };
function renderPlayTime(){ const pl=S.live?.play||{}, row=$("play-row"); if(!row) return;
  if(!pl.since||S.live.game_off){ row.style.display="none"; return; }
  const now=S.live.now+((performance.now()-(S.liveAt||performance.now()))/1000);
  row.style.display=""; $("play-text").innerHTML=`Playing <b>${fmtSpan(now-pl.since)}</b>${pl.today>(now-pl.since)+60?` <span class="muted">· ${fmtSpan(pl.today)} today</span>`:""}`; }
setInterval(()=>{ if(S.live) renderPlayTime(); },1000);
function renderStatus(){ const p=S.live.player, pd=$("pos-dot"), pt=$("pos-text"), tv=S.live.travel||{};
  if(!pt.dataset.sysBound){ pt.dataset.sysBound=1; pt.addEventListener("change",async e=>{ if(!e.target.classList.contains("sys-pick")) return;
    const v=e.target.value, r=await api().set_my_system(v); if(!r.ok) return toast(r.error); await poll(); toast(`Got it: you're in ${v}`); }); }
  if(pt.querySelector("select.sys-pick:focus")) return;     // don't redraw under an open picker
  const ago=x=>{ const a=Math.max(0,S.live.now-x); return a<60?`${Math.round(a)} s ago`:a<3600?`${Math.round(a/60)} min ago`:`${(a/3600).toFixed(1)} h ago`; };
  renderPlayTime();
  if(S.live.game_off){ pd.className="dot"; pt.innerHTML=`<b>Star Citizen isn't running</b>`; }
  else if(tv.state==="dead"){ pd.className="dot warn"; pt.innerHTML=`<b>Died</b>${tv.near?` near ${esc(tv.near)}`:""} <span class="muted">(${ago(tv.at)})</span>`; }
  else if(tv.state==="respawned"){ pd.className="dot on"; pt.innerHTML=`<b>Respawned</b>${tv.place?` at ${esc(tv.place)}`:""} <span class="muted">(${ago(tv.at)})</span>`; }
  else if(tv.state==="jumping"){ pd.className="dot on"; pt.innerHTML=`<b>Quantum jump</b>${tv.from?` from ${esc(tv.from)}`:""}${tv.to?` to <b>${esc(tv.to)}</b>`:""} <span class="muted">(${ago(tv.at)})</span>`; }
  else if(tv.state==="arrived" && (!p || p.approx || (p.t||0) < tv.at)){ pd.className="dot on";
    pt.innerHTML=tv.place?`Arrived near <b>${esc(tv.place)}</b> <span class="muted">(jump, ${ago(tv.at)})</span>`:`Arrived at an unknown spot <span class="muted">(${ago(tv.at)}). A /showlocation here teaches it to Quantum</span>`; }
  else if(tv.state==="flying" && (!p || (p.t||0) < tv.at)){ pd.className="dot on"; pt.innerHTML=`<b>In flight</b>${tv.left?`, left ${esc(tv.left)}`:""} <span class="muted">(${ago(tv.at)})</span>`; }
  else if(p&&p.approx){ pd.className="dot on"; const how={left:"took off",log:"from the game log",landed:"from the game log",jump:"quantum arrival"}[p.approx_how]||"from the game log";
    pt.innerHTML=`${p.approx_how==="left"||p.approx_how==="log"?"Near":"At"} <b>${esc(p.approx)}</b> <span class="muted">(${how}, ${ago(S.live.now-p.age)})</span>`; }
  else
  if(!p){ pd.className="dot"; pt.innerHTML="Type <b>/showlocation</b> in game chat to share your position"; }
  else { const age=p.age<60?`${Math.round(p.age)} s ago`:`${Math.round(p.age/60)} min ago`; pd.className="dot"+(p.age<120?" on":"");
    pt.innerHTML=p.body?`At <b>${esc(p.body)}</b> <span class="muted">(/showlocation, ${age})</span>`:`<b>In space</b>, ${sysPick(p)} <span class="muted">(${age})</span>`; }
  // What you're up to, from lines that name you: traffic control you hailed, vehicle deliveries, shops,
  // your own ship or vehicle, and the armistice zone.
  const bits=[];
  // The log only says what you last did, not where you are now, so word it as a report.
  if(tv.activity) bits.push(`Last report: ${esc(tv.activity.text.charAt(0).toLowerCase()+tv.activity.text.slice(1))} <span class="muted">(${ago(tv.activity.at)})</span>`);
  if(tv.vehicle) bits.push(`Ship: <b>${esc(tv.vehicle.name)}</b>`);
  if(tv.armistice===false) bits.push(`<span style="color:#ffb454">Outside the armistice zone</span>`);
  if(bits.length) pt.innerHTML+=`<div class="muted" style="font-size:12px;margin-top:2px;line-height:1.35">${bits.join("<br>")}</div>`;
  const lg=S.live.log; $("log-dot").className="dot"+(lg.status==="watching"?" on":lg.status==="idle"?"":" warn");
  // Only worth a line when something's wrong: tracking contracts is the normal state.
  $("log-row").style.display=lg.status==="watching"||lg.status==="idle"?"none":"";
  $("log-text").innerHTML=lg.status==="error"?"Can't read Game.log right now":"Contract tracking off: Game.log not found";
  const al=S.live.autoloc||{}; const parts=[]; if(al.hotkey) parts.push(`<b>${esc(al.hotkey)}</b> shows / hides`); if(al.loc_hotkey) parts.push(`<b>${esc(al.loc_hotkey)}</b> /showlocation`); 
  $("key-dot").className="dot"+(al.available&&parts.length?" on":""); $("key-text").innerHTML=al.available===false?"Hotkey: Windows only":parts.length?parts.join(" · "):"Hotkey off";

  const cal=S.live.calibration; if(cal&&cal.at!==S.calSeen){ if(S.calSeen!==undefined&&Math.abs(cal.correction)>0.05) toast(`Lined up ${cal.body} using your reading at ${cal.place} (${cal.correction>0?"+":""}${cal.correction.toFixed(1)}°)`); S.calSeen=cal.at; } }
let toastT; function toast(msg,ms){ const t=$("toast"); t.textContent=msg; t.classList.add("show"); clearTimeout(toastT); toastT=setTimeout(()=>t.classList.remove("show"),ms||2600); }
// A longer note that stays up long enough to read (price alerts)
const toastLong=msg=>toast(msg,Math.min(12000,2600+String(msg||"").length*45));
