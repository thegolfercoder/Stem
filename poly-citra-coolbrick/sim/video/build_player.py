"""Build the interactive player page (coolbrick_player.html) from coolbrick_film.html."""
import re, pathlib
here = pathlib.Path(__file__).parent
film = (here/'coolbrick_film.html').read_text()
style = re.search(r'<style>(.*?)</style>', film, re.S).group(1)
style = style.replace('html,body{margin:0;background:#0d1310;overflow:hidden}', '')
stage = re.search(r'(<div id="stage">.*?</div>\n</div>)\n<script type="importmap">', film, re.S).group(1)
importmap = re.search(r'(<script type="importmap">.*?</script>)', film, re.S).group(1)
module = re.search(r'<script type="module">(.*?)</script>', film, re.S).group(1)
player_js = r"""
/* ================= PLAYER ================= */
const frame=document.getElementById('frame'),stageEl=document.getElementById('stage');
function fit(){const s=frame.clientWidth/1280;stageEl.style.transform=`scale(${s})`;}
new ResizeObserver(fit).observe(frame);fit();
let T=0,playing=!matchMedia('(prefers-reduced-motion: reduce)').matches,last=0,dirty=true;
const play=document.getElementById('pPlay'),scrub=document.getElementById('pScrub'),tl=document.getElementById('pTime');
scrub.max=DUR;
function setPlaying(v){playing=v;play.textContent=v?'Pause':'Play';play.setAttribute('aria-label',v?'Pause':'Play');}
play.onclick=()=>{if(!playing&&T>=DUR-.01)T=0;setPlaying(!playing);};
scrub.oninput=()=>{T=+scrub.value;dirty=true;};
const fmt=s=>Math.floor(s/60)+':'+String(Math.floor(s%60)).padStart(2,'0');
document.querySelectorAll('[data-ch]').forEach(b=>b.onclick=()=>{T=+b.dataset.ch;dirty=true;setPlaying(true);});
document.getElementById('pReset').onclick=()=>{VIEW.yaw=0;VIEW.pitch=0;VIEW.zoom=1;dirty=true;};
let drag=null;
frame.addEventListener('pointerdown',e=>{drag={x:e.clientX,y:e.clientY};frame.setPointerCapture(e.pointerId);});
frame.addEventListener('pointermove',e=>{if(!drag)return;VIEW.yaw-=(e.clientX-drag.x)*.006;VIEW.pitch=Math.max(-.9,Math.min(.9,VIEW.pitch+(e.clientY-drag.y)*.004));drag={x:e.clientX,y:e.clientY};dirty=true;});
frame.addEventListener('pointerup',()=>drag=null);frame.addEventListener('pointercancel',()=>drag=null);
frame.addEventListener('wheel',e=>{e.preventDefault();VIEW.zoom=Math.max(.45,Math.min(1.9,VIEW.zoom*Math.exp(e.deltaY*.001)));dirty=true;},{passive:false});
const chs=[...document.querySelectorAll('[data-ch]')];
function tick(ts){requestAnimationFrame(tick);const dt=Math.min(.1,(ts-last)/1000||0);last=ts;
  if(playing){T+=dt;if(T>=DUR){T=DUR;setPlaying(false);}dirty=true;}
  if(!dirty)return;dirty=false;renderAt(T);scrub.value=T;tl.textContent=fmt(T)+' / '+fmt(DUR);
  chs.forEach((b,i)=>b.setAttribute('aria-current',T>=+b.dataset.ch&&(i===chs.length-1||T<+chs[i+1].dataset.ch)?'true':'false'));}
window.ready.then(()=>{setPlaying(playing);requestAnimationFrame(tick);});
"""
page = f"""<title>CoolBrick Simulation</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;700;800;900&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@500&display=swap">
<style>
/* Layout: a cinema-style player: the 16:9 simulation, then a transport bar and chapter list. Single dark look on purpose. */
:root{{color-scheme:dark;--bg:#0b100d;--fg:#f3f1ea;--muted:#9aa49c;--rule:#26302a;--btn:#18201b;--accent:#ff8a3d}}
body{{background:var(--bg);color:var(--fg)}}
.page{{max-width:1180px;margin:0 auto;padding-block:20px 40px;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));display:grid;gap:14px;font-family:"IBM Plex Sans",system-ui,sans-serif}}
.top{{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:8px}}
.top h1{{margin:0;font:800 24px/1.1 "Archivo",sans-serif;text-wrap:balance}}
.top h1 span{{color:var(--accent)}}
.top p{{margin:0;color:var(--muted);font-size:13px}}
#frame{{position:relative;width:100%;aspect-ratio:16/9;max-width:100%;overflow:hidden;border-radius:12px;border:1px solid var(--rule);background:#0d1310;touch-action:none;cursor:grab}}
#frame:active{{cursor:grabbing}}
#stage{{transform-origin:0 0;position:absolute;top:0;left:0}}
.bar{{display:flex;align-items:center;gap:12px;flex-wrap:wrap}}
.bar button,.chapters button{{font:600 13px/1 "IBM Plex Sans",sans-serif;color:var(--fg);background:var(--btn);border:1px solid var(--rule);border-radius:7px;padding:9px 12px;cursor:pointer}}
.bar button:focus-visible,.chapters button:focus-visible,#pScrub:focus-visible{{outline:2px solid var(--accent);outline-offset:2px}}
#pPlay{{background:var(--accent);border-color:var(--accent);color:#1a0d03;min-width:70px}}
#pScrub{{flex:1;min-width:140px;accent-color:var(--accent)}}
#pTime{{font:500 13px/1 "IBM Plex Mono",monospace;color:var(--muted);font-variant-numeric:tabular-nums}}
.chapters{{display:flex;flex-wrap:wrap;gap:6px}}
.chapters button[aria-current="true"]{{border-color:var(--accent);color:var(--accent)}}
.hint{{color:var(--muted);font-size:12.5px}}
{style}
</style>
<div class="page">
  <div class="top"><h1>Cool<span>Brick</span> simulation</h1><p>Drag to rotate · scroll to zoom · Rian Sikka &amp; Daiwik Abroo</p></div>
  <div id="frame" aria-label="3D simulation of the CoolBrick. Drag to rotate, scroll to zoom.">
{stage}
  </div>
  <div class="bar">
    <button id="pPlay" aria-label="Play">Play</button>
    <input id="pScrub" type="range" min="0" max="86" step="0.01" value="0" aria-label="Timeline">
    <span id="pTime">0:00 / 1:26</span>
    <button id="pReset">Reset view</button>
  </div>
  <div class="chapters" role="group" aria-label="Chapters">
    <button data-ch="0">Title</button><button data-ch="4">1 · Made from waste</button><button data-ch="12">2 · Inside the brick</button>
    <button data-ch="30">3 · Sun test</button><button data-ch="46">4 · Data-centre shelter</button><button data-ch="62">5 · Cooling fails</button><button data-ch="74">Results</button>
  </div>
  <p class="hint">The heat numbers come from a computer model with assumed material values, not lab measurements.</p>
</div>
{importmap}
<script type="module">{module}{player_js}</script>
"""
(here/'coolbrick_player.html').write_text(page)
print('ok', len(page))
