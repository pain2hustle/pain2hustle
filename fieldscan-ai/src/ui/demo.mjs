import { AGENT_GRADE_CARD_STYLES, renderAgentGradeCard } from "./grade-card.mjs";

const DEFAULT_GRADE = {
  agentName: "Field Inspector",
  score: 0,
  baseline: 0,
  dimensions: {},
  needsWork: ["Complete evaluated runs to establish a reliable grade."],
  sampleCount: 0,
  selfConfidence: 0,
};

export function buildDemoHtml({ grade = DEFAULT_GRADE } = {}) {
  const gradeCard = renderAgentGradeCard(grade);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>FieldScan AI — live demo</title>
<style>
:root{--bg:#0b1220;--card:#131c2e;--line:#243147;--ink:#eaf1ff;--mut:#8ea3c4;--acc:#2b8fff;--red:#ff4d5e;--amber:#ffb020;--green:#31d67a}
*{box-sizing:border-box}body{background:radial-gradient(1000px 500px at 50% -10%,#12203a,var(--bg));color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;min-height:100vh;margin:0;padding:24px}.wrap{max-width:820px;margin:0 auto}h1{font-size:26px;letter-spacing:-.02em;margin:0}.sub{color:var(--mut);margin:4px 0 20px}.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px;margin-bottom:16px}.field-label{display:block;font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:var(--mut);margin:0 0 6px}select,input[type=file]{width:100%;background:#0c1424;border:1px solid var(--line);color:var(--ink);border-radius:9px;padding:10px}.row{display:flex;gap:12px;flex-wrap:wrap}.row>div{flex:1;min-width:160px}button{margin-top:14px;width:100%;background:linear-gradient(135deg,#2b8fff,#0b4da8);color:#fff;border:0;border-radius:11px;padding:13px;font-weight:700;font-size:15px;cursor:pointer}button:focus-visible,select:focus-visible,input:focus-visible{outline:3px solid #85bcff;outline-offset:2px}button:disabled{opacity:.6;cursor:wait}.prev{margin-top:12px;display:flex;gap:8px;flex-wrap:wrap}.prev img{width:88px;height:88px;object-fit:cover;border-radius:8px;border:1px solid var(--line)}#out[hidden]{display:none}.score{font-size:40px;font-weight:800}.pill{display:inline-block;padding:4px 12px;border-radius:999px;font-weight:700;font-size:13px}.pass{background:rgba(49,214,122,.15);color:var(--green)}.fail{background:rgba(255,77,94,.15);color:var(--red)}.rev{background:rgba(255,176,32,.15);color:var(--amber)}.flag{border-left:3px solid var(--red);background:rgba(255,77,94,.07);padding:8px 12px;border-radius:8px;margin:8px 0;font-size:14px}.flag.med{border-color:var(--amber);background:rgba(255,176,32,.07)}.flag.low{border-color:var(--mut);background:rgba(142,163,196,.07)}.k{color:var(--mut);font-size:12px;text-transform:uppercase;letter-spacing:.08em;margin:14px 0 6px}.tags span{display:inline-block;background:#0c1424;border:1px solid var(--line);border-radius:7px;padding:3px 9px;margin:0 6px 6px 0;font-size:13px}.miss span{color:var(--amber)}.bid{font-size:20px;font-weight:700}.mut{color:var(--mut)}.err{color:var(--red)}.foot{color:var(--mut);font-size:12px;text-align:center;margin-top:12px}.grade-shell{margin-bottom:16px}${AGENT_GRADE_CARD_STYLES}
</style></head><body><main class="wrap">
<h1>FieldScan AI <span class="mut" style="font-size:14px">· live demo</span></h1>
<p class="sub">Upload field photos to identify visible equipment, check evidence, flag safety issues, and route manager review.</p>
<section class="grade-shell" aria-label="Current agent grade">${gradeCard}</section>
<section class="card" aria-labelledby="scan-title"><h2 id="scan-title" style="font-size:18px;margin-top:0">Run a field scan</h2>
  <div class="row"><div><label class="field-label" for="trade">Trade</label><select id="trade"><option value="garage-doors">Garage doors</option><option value="hvac">HVAC / commercial refrigeration</option></select></div><div><label class="field-label" for="phase">Phase</label><select id="phase"><option value="after">After</option><option value="before">Before</option><option value="during">During</option></select></div></div>
  <div style="margin-top:12px"><label class="field-label" for="file">Job photos</label><input id="file" type="file" accept="image/*" multiple capture="environment"></div>
  <div class="prev" id="prev" aria-live="polite"></div><button id="go" type="button">Scan</button>
</section>
<section class="card" id="out" aria-live="polite" aria-atomic="true" hidden></section>
<footer class="foot">AI-generated assessment · The owner confirms every bid and safety decision.</footer>
</main><script>
const $=s=>document.querySelector(s);let imgs=[];
$('#file').addEventListener('change',async e=>{imgs=[];$('#prev').replaceChildren();for(const f of e.target.files){const d=await toData(f);imgs.push(d);const i=new Image();i.src=d;i.alt='Selected field photo preview';$('#prev').appendChild(i);}});
function toData(f){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(f);});}
$('#go').addEventListener('click',async()=>{if(!imgs.length){$('#out').hidden=false;$('#out').textContent='Add at least one photo.';return;}const button=$('#go');const out=$('#out');button.disabled=true;button.textContent='Scanning…';out.hidden=false;out.innerHTML='<div class="mut">Reading the photos…</div>';try{const response=await fetch('/demo',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({trade:$('#trade').value,phase:$('#phase').value,images:imgs})});const result=await response.json();out.replaceChildren(renderResult(result));}catch(error){const message=document.createElement('div');message.className='err';message.textContent=error instanceof Error?error.message:'Scan failed';out.replaceChildren(message);}finally{button.disabled=false;button.textContent='Scan';}});
function node(tag,text,className){const element=document.createElement(tag);if(text!==undefined)element.textContent=String(text);if(className)element.className=className;return element;}
function renderResult(result){const root=document.createElement('div');if(result.error){root.append(node('div',result.error==='quota_exceeded'?'Demo scan limit reached for this month.':result.error,'err'));return root;}const heading=node('div');heading.style.display='flex';heading.style.alignItems='center';heading.style.gap='16px';heading.append(node('strong',(result.quality_score??0)+'/100','score'),node('span',result.overall??'review','pill '+(result.overall==='pass'?'pass':result.overall==='fail'?'fail':'rev')));root.append(heading,node('p',result.score_rationale??'','mut'));if(Array.isArray(result.safety_flags)&&result.safety_flags.length){root.append(node('div','Safety flags','k'));for(const flag of result.safety_flags)root.append(node('div',(flag.issue??'Issue')+' — '+(flag.evidence??'No evidence supplied'),'flag '+(flag.severity==='medium'?'med':flag.severity==='low'?'low':'')));}return root;}
</script></body></html>`;
}
