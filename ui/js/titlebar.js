// =================================================================== Quantum's own title bar
// With Settings > Window > Title bar on "Quantum's own" the Windows frame is left off (desktop/frameless.py)
// and this bar takes its place: drag it to move the window (double-click to maximise), the window's edges
// resize it, and the buttons minimise, maximise and close. The Stanton / Pyro / Nyx switcher moves up here
// while the map is in view, and is hidden when a page covers the map. With the normal Windows bar picked,
// none of this shows and the switcher stays on the map.
"use strict";
(()=>{
const bar=$("tbar"), edges=$("tb-edges"), sys=$("tb-sys"), live=$("tb-live");
let on=false, maxed=false;
const MAX_ICON='<svg viewBox="0 0 12 12"><rect x="2" y="2" width="8" height="8" rx="1"/></svg>';
const RESTORE_ICON='<svg viewBox="0 0 12 12"><rect x="2" y="4" width="6" height="6" rx="1"/><path d="M4.5 4V2.8a.8.8 0 0 1 .8-.8H9.2a.8.8 0 0 1 .8.8v3.9a.8.8 0 0 1-.8.8H8"/></svg>';
function setMax(m){ maxed=!!m; const b=$("tb-max"); b.innerHTML=maxed?RESTORE_ICON:MAX_ICON; b.title=maxed?"Restore":"Maximise";
  b.setAttribute("aria-label",b.title); edges.hidden=!on||maxed; }        // no resize edges while maximised
// the switcher: only while the map itself is in view (no page over it)
function mapInView(){ return !document.querySelector("#mapwrap .pic-panel.show"); }
function syncSys(){ sys.hidden=true; }          // the switcher stays on the map itself (it looked off-centre up here)
// over the middle of the map, not the middle of the window (the rail and sidebar are on the left)
function placeSys(){ const r=$("mapwrap").getBoundingClientRect(); if(r.width) bar.style.setProperty("--tb-mid",Math.round(r.left+r.width/2)+"px"); }
function syncLive(){ if(on) live.hidden=!(S.live&&!S.live.game_off); }

async function init(){
  let r=null; try{ r=await api().window_style(); }catch(_){}
  S.winStyle=r;
  if(!r?.active) return;                                             // the normal Windows bar: nothing to do
  on=true; document.body.classList.add("tb-on"); bar.hidden=false; setMax(r.max);
  renderSysSeg(); syncSys(); syncLive();
  new MutationObserver(syncSys).observe($("mapwrap"),{subtree:true,attributes:true,attributeFilter:["class"]});
  setInterval(syncLive,2000);
  // Win+Up, dragging off a maximised window, a double-click: catch up with the window's state
  new ResizeObserver(placeSys).observe($("mapwrap"));
  let t=null; window.addEventListener("resize",()=>{ clearTimeout(t); t=setTimeout(async()=>{ try{ setMax((await api().window_style()).max); }catch(_){} },150); });
}
$("tb-min").onclick=()=>api().win_minimize();
$("tb-max").onclick=async()=>{ try{ setMax((await api().win_toggle_max()).max); }catch(_){} };
$("tb-close").onclick=()=>api().win_close();
// drag the bar to move the window (handed to Windows once the mouse has moved a little, so a click or a
// double-click stays one); double-click it to maximise / restore
let press=null;
bar.addEventListener("mousedown",e=>{ if(e.button!==0||e.target.closest("button")) return; e.preventDefault(); press={x:e.screenX,y:e.screenY}; });
window.addEventListener("mousemove",e=>{ if(!press) return;
  if(!(e.buttons&1)){ press=null; return; }
  if(Math.abs(e.screenX-press.x)+Math.abs(e.screenY-press.y)<4) return;
  press=null; api().win_drag("caption"); });
window.addEventListener("mouseup",()=>{ press=null; });
bar.addEventListener("dblclick",async e=>{ if(e.target.closest("button")) return; press=null;
  try{ setMax((await api().win_toggle_max()).max); }catch(_){} });
// the window's edges and corners resize it
edges.addEventListener("mousedown",e=>{ const k=e.target.dataset.e; if(e.button!==0||!k) return; e.preventDefault(); api().win_drag(k); });
// ---- the rail: every button in view at any window height. Its spacing (and below that, the icons) shrinks
// until it all fits, instead of the bottom buttons (Cart, Settings) going out of sight.
const rail=$("rail");
function railFit(){ let lo=0.25, hi=1, best=0.25; const set=k=>{ rail.style.setProperty("--rk",k.toFixed(3)); rail.style.setProperty("--rk2",Math.max(0.72,Math.min(1,0.55+k*0.45)).toFixed(3)); };
  set(1); if(rail.scrollHeight<=rail.clientHeight+1) return;
  for(let i=0;i<7;i++){ const k=(lo+hi)/2; set(k); if(rail.scrollHeight<=rail.clientHeight+1){ best=k; lo=k; } else hi=k; }
  set(best); }
new ResizeObserver(railFit).observe(rail); window.addEventListener("resize",railFit); railFit();
if(window.pywebview?.api?.window_style) init(); else window.addEventListener("pywebviewready",init,{once:true});
})();
