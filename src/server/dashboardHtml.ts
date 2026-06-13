/** The live dashboard served by the LAN companion server at GET / .
 *  Talks to /api/* on the same origin (the phone), authenticated with the PIN. */
export const DASHBOARD_HTML = `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>LUCY — Live</title>
<style>
:root{--bg:#0F0E0B;--surface:#1A1813;--raised:#221F18;--border:#332E24;--text:#F5EFE6;--muted:#B8AD9C;--subtle:#8A7E6C;--primary:#FF8C42;--green:#2FBF71}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 -apple-system,Segoe UI,Roboto,sans-serif}
header{padding:18px 28px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:16px;position:sticky;top:0;background:var(--bg);z-index:5}
.brand{font-size:22px;font-weight:900;letter-spacing:1px}.brand .y{color:var(--primary)}
.dot{width:9px;height:9px;border-radius:5px;background:var(--green)}
main{max-width:1000px;margin:0 auto;padding:22px 28px 80px}
section{margin-top:30px}h2{font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:var(--primary);border-bottom:1px solid var(--border);padding-bottom:7px}
.card{background:var(--surface);border:1px solid var(--border);border-radius:11px;padding:12px 14px;margin-top:9px;display:flex;gap:10px;align-items:flex-start}
.title{font-weight:700}.sub{color:var(--muted);font-size:13px;margin-top:3px}.date{color:var(--subtle);font-size:12px;white-space:nowrap}
.pill{font-size:10px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;padding:2px 7px;border-radius:6px;border:1px solid var(--border);color:var(--muted)}
.pill.high{color:#ff6b6b;border-color:#ff6b6b55}
.facts{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}.fact{background:var(--raised);border:1px solid var(--border);border-radius:10px;padding:8px 12px;font-size:14px}
.fact .cat{color:var(--primary);font-size:10px;text-transform:uppercase;letter-spacing:1px;display:block}
.about{background:var(--raised);border-left:3px solid var(--primary);padding:12px 16px;border-radius:0 10px 10px 0;margin-top:10px}
input,button{font:inherit}input{flex:1;background:var(--raised);border:1px solid var(--border);border-radius:10px;padding:11px 14px;color:var(--text)}
button{background:var(--primary);color:#1a1206;border:0;border-radius:10px;padding:11px 16px;font-weight:800;cursor:pointer}
button.ghost{background:transparent;color:var(--subtle);border:1px solid var(--border);padding:6px 10px;font-size:12px}
.bar{display:flex;gap:8px;margin-top:10px}.gate{max-width:340px;margin:80px auto;text-align:center;display:flex;flex-direction:column;gap:12px}
.counts{margin-left:auto;display:flex;gap:14px}.count b{color:var(--primary)}.count{font-size:12px;color:var(--subtle)}
.empty{color:var(--subtle);font-style:italic}
</style></head><body>
<div id="app">
<header><div class="brand">LUC<span class="y">Y</span> · Live</div><div class="dot" title="connected"></div>
  <div class="counts" id="counts"></div></header>
<main>
  <section><h2>Add a thought (lands on the phone)</h2>
    <div class="bar"><input id="cap" placeholder="Type a thought, task, expense…"/><button onclick="addCapture()">Send</button></div></section>
  <div id="content"></div>
</main></div>
<script>
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const fmt=s=>{if(!s)return'';const d=new Date(String(s).includes('T')?s:String(s).replace(' ','T')+'Z');return isNaN(d)?s:d.toLocaleDateString(undefined,{month:'short',day:'numeric'})};
async function api(path,opts={}){opts.headers=Object.assign({'Content-Type':'application/json'},opts.headers||{});const r=await fetch(path,opts);return (r.headers.get('content-type')||'').includes('json')?r.json():r.text();}
async function load(){let d;try{d=await api('/api/memory');}catch(e){return;}render(d);}
load();
function render(d){
  const p=d.profile||{};
  $('counts').innerHTML=[['captures',d.captures],['tasks',d.todos],['learned',d.learned_profile]].filter(([,a])=>a).map(([k,a])=>'<span class="count"><b>'+a.length+'</b> '+k+'</span>').join('');
  let h='';
  if((d.learned_profile&&d.learned_profile.length)||p.about){h+='<section><h2>Who this person is</h2>';if(p.about)h+='<div class="about">'+esc(p.about)+'</div>';if(d.learned_profile)h+='<div class="facts">'+d.learned_profile.map(f=>'<div class="fact"><span class="cat">'+esc(f.category)+' · '+esc(f.confidence)+'</span>'+esc(f.statement)+' <button class="ghost" onclick="delFact('+f.id+')">✕</button></div>').join('')+'</div>';h+='</section>';}
  if(d.todos&&d.todos.length)h+='<section><h2>Tasks ('+d.todos.length+')</h2>'+d.todos.slice(0,60).map(t=>'<div class="card"><div style="flex:1"><span class="title">'+esc(t.task)+'</span><div class="sub">'+esc(t.context||'')+'</div></div><span class="pill '+(t.urgency==='high'?'high':'')+'">'+esc(t.urgency||'')+'</span><button class="ghost" onclick="task('+t.id+",'complete')\">done</button><button class=\"ghost\" onclick=\"task("+t.id+",'delete')\">✕</button></div>').join('')+'</section>';
  if(d.knowledge&&d.knowledge.insights&&d.knowledge.insights.length)h+='<section><h2>Insights</h2>'+d.knowledge.insights.slice(0,30).map(i=>'<div class="card"><div style="flex:1"><span class="title">'+esc(i.title)+'</span><div class="sub">'+esc(i.detail||'')+'</div></div></div>').join('')+'</section>';
  if(d.captures&&d.captures.length)h+='<section><h2>Timeline ('+d.captures.length+')</h2>'+d.captures.slice(0,50).map(c=>'<div class="card"><div style="flex:1"><span class="title">'+esc(c.extracted_title||(c.raw_transcript||'').slice(0,60))+'</span><div class="sub">'+esc((c.structured_text||c.raw_transcript||'').slice(0,180))+'</div></div><span class="date">'+fmt(c.created_at)+'</span></div>').join('')+'</section>';
  $('content').innerHTML=h;
}
async function addCapture(){const v=$('cap').value.trim();if(!v)return;$('cap').value='';await api('/api/capture',{method:'POST',body:JSON.stringify({text:v})});setTimeout(load,1500);}
async function task(id,action){await api('/api/task',{method:'POST',body:JSON.stringify({id,action})});load();}
async function delFact(id){await api('/api/fact/'+id,{method:'DELETE'});load();}
</script></body></html>`;
