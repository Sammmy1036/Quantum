// Map data (cities/, citylights/, planets/, terrain/) is hosted on the Quantum server. The app downloads
// each file when it's first needed, checks it against the server's manifest, caches it, and serves it to
// the map from a local address. qLoadAsset("terrain/Hurston.js") loads one; if that has nothing (no app
// side yet, offline without a cached copy), it falls back to the copy in this ui folder, if there is one.
(function(){
  let base=null;
  const getBase=()=>base||(base=new Promise(res=>{
    const go=()=>{ try{ window.pywebview.api.assets_base().then(b=>res(b||""),()=>res("")); }catch(e){ res(""); } };
    if(window.pywebview?.api?.assets_base) go(); else window.addEventListener("pywebviewready",go,{once:true});
    setTimeout(()=>res(""),10000); }));
  const tag=src=>new Promise(res=>{ const s=document.createElement("script"); s.src=src; s.async=true;
    s.onload=()=>res(true); s.onerror=()=>{ s.remove(); res(false); }; document.head.appendChild(s); });
  // Status pill while files download (the first visit to a city can be tens of MB): what it is and how far.
  const nice=p=>{ const m=p.match(/^(\w+)\/(.+?)(\.near)?\.js$/); if(!m||m[2]==="index") return "map data";
    const n=decodeURIComponent(m[2]).replace(/([a-z])([A-Z])/g,"$1 $2");
    return {cities:`${n} 3D city${m[3]?" (close-up detail)":""}`, terrain:`${n} terrain`, planets:`${n} surface map`, citylights:`${n} city lights`}[m[1]]||n; };
  const mb=b=>(b/1048576).toFixed(b<10485760?1:0);
  let pending=0, polling=false, pill=null, hideT=0;
  const showPill=html=>{ if(!pill){ pill=document.createElement("div"); pill.id="dl-pill";
      const host=document.getElementById("mapwrap"); pill.style.cssText=(host?"position:absolute;":"position:fixed;")+"left:50%;bottom:64px;transform:translateX(-50%);z-index:60;min-width:300px;max-width:min(520px,90vw);padding:10px 14px;border-radius:10px;background:rgba(10,18,32,.92);border:1px solid rgba(127,231,255,.35);box-shadow:0 10px 30px rgba(0,0,0,.45);color:#dbe8ff;font:13px Inter,'Segoe UI',sans-serif;pointer-events:none;transition:opacity .3s";
      (host||document.body).appendChild(pill); }   // centred on the map, not the whole window
    clearTimeout(hideT); holdUntil=0; pill.innerHTML=html; pill.style.opacity="1"; };
  let holdUntil=0;     // a "couldn't download" note stays up a while even after loading stops
  const hidePill=(ms=0)=>{ ms=Math.max(ms,holdUntil-Date.now()); clearTimeout(hideT); hideT=setTimeout(()=>{ if(pill) pill.style.opacity="0"; },ms); };
  const poll=async()=>{ if(polling) return; polling=true;
    try{ while(pending>0){ let st=null; try{ st=await window.pywebview.api.assets_progress(); }catch(e){}
        const a=st?.active||[];
        if(a.length){ const done=a.reduce((s,x)=>s+x.done,0), total=a.reduce((s,x)=>s+x.total,0), pct=total?Math.min(100,done/total*100):0;
          const big=a.slice().sort((x,y)=>y.total-x.total)[0];
          showPill(`<div style="display:flex;justify-content:space-between;gap:12px;margin-bottom:7px"><span>Downloading <b>${nice(big.path)}</b>${a.length>1?` <span style="opacity:.7">+${a.length-1} more</span>`:""}</span><span style="opacity:.8;font-variant-numeric:tabular-nums;white-space:nowrap">${mb(done)} / ${mb(total)} MB</span></div>
            <div style="height:5px;border-radius:3px;background:rgba(127,231,255,.15);overflow:hidden"><i style="display:block;height:100%;width:${pct.toFixed(1)}%;background:linear-gradient(90deg,#3ccf6e,#7fe7ff);transition:width .3s"></i></div>
            <div style="margin-top:6px;font-size:11.5px;opacity:.65">First time only: it's kept on this PC after this.</div>`); }
        else hidePill(400);
        await new Promise(r=>setTimeout(r,400)); }
    } finally { polling=false; hidePill(400); } };
  window.qLoadAsset=async path=>{ const b=await getBase(); if(!b) return tag(path);
    pending++; if(window.pywebview?.api?.assets_progress) poll();
    try{ if(await tag(b+path)) return true;
      if(await tag(path)) return true;        // a copy in the ui folder (development)
      showPill(`Couldn't download <b>${nice(path)}</b>. Check your connection; Quantum will try again next time it's needed.`); holdUntil=Date.now()+7000; hidePill(7000);
      return false; }
    finally{ pending--; } };
})();
