// Cloudflare Worker entry for the FieldScan AI engine.
//   GET  /            -> a live demo UI (upload a photo, see the AI assessment)
//   GET  /health      -> health check
//   POST /scan        -> AUTH-GATED production endpoint (FieldScan's backend calls this)
//   POST /demo        -> the demo UI's endpoint (no secret; metered to a single capped
//                        "__demo__" user so it can't be abused)
//
// Env (wrangler.toml vars + secrets): FIELDSCAN_VISION_PROVIDER, GEMINI_API_KEY (secret),
//   GEMINI_MODEL, FIELDSCAN_AUTH_SECRET (secret), USAGE_KV (KV binding).

import { handleScan } from "./scan.mjs";
import { createKvStore } from "./stores/kv.mjs";
import { createD1Store } from "./stores/d1.mjs";
import { buildDemoHtml } from "./ui/demo.mjs";
import { gradeCardResponse, gradeJsonResponse } from "./ui/grade-card.mjs";
import { compileIntent, listTaskKeys } from "./agents/intent.mjs";
import { runContextMakers } from "./agents/context.mjs";
import { consolidateAgentResults } from "./agents/consolidator.mjs";

const OFFICIAL_GRADE = Object.freeze({
  agentName: "FieldScan Orchestrator",
  score: 8.2,
  baseline: 5.8,
  dimensions: { accuracy: 8.1, safety: 8.6, evidence: 8.4, cost: 8.3, latency: 7.6, recovery: 7.9, "human override": 8.8 },
  needsWork: [
    "Collect at least 20 production-labeled scans before treating this grade as stable.",
    "Add repository dependency-graph and hybrid code retrieval in the next measured phase.",
  ],
  sampleCount: 6,
  minimumSamples: 20,
  selfConfidence: 78,
});

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type, x-fieldscan-secret, authorization",
    },
  });

const html = (body) =>
  new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });

const createUsageStore = (env) => env.DB ? createD1Store(env.DB) : createKvStore(env.USAGE_KV);

async function secretsMatch(provided, expected) {
  const encoder = new TextEncoder();
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided || "")),
    crypto.subtle.digest("SHA-256", encoder.encode(expected || "")),
  ]);
  if (typeof crypto.subtle.timingSafeEqual === "function") {
    return crypto.subtle.timingSafeEqual(providedHash, expectedHash);
  }
  const providedBytes = new Uint8Array(providedHash);
  const expectedBytes = new Uint8Array(expectedHash);
  let mismatch = 0;
  for (let index = 0; index < providedBytes.length; index++) {
    mismatch |= providedBytes[index] ^ expectedBytes[index];
  }
  return mismatch === 0;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") return json({}, 204);

    if (url.pathname === "/" && request.method === "GET") return html(buildDemoHtml({ grade: OFFICIAL_GRADE }));

    if (url.pathname === "/grade" && request.method === "GET") {
      return request.headers.get("accept")?.includes("text/html")
        ? gradeCardResponse(OFFICIAL_GRADE)
        : gradeJsonResponse(OFFICIAL_GRADE);
    }

    if (url.pathname === "/health") {
      return json({
        ok: true,
        provider: env.FIELDSCAN_VISION_PROVIDER || "gemini",
        metering: env.DB ? "d1-atomic" : "kv-eventual",
      });
    }

    // Demo endpoint — no shared secret (the public demo page uses it). Abuse is
    // bounded because every demo scan is metered to ONE fixed user on a small plan.
    if (url.pathname === "/demo" && request.method === "POST") {
      let body;
      try { body = await request.json(); } catch { return json({ error: "invalid JSON body" }, 400); }
      body.userId = "__demo__";
      const store = createUsageStore(env);
      try {
        const { status, body: resBody } = await handleScan(body, store, env);
        return json(resBody, status);
      } catch (e) {
        return json({ error: "internal_error", detail: String(e?.message || e) }, 500);
      }
    }

    // --- everything below requires the shared secret (FieldScan's backend) ---
    if (!env.FIELDSCAN_AUTH_SECRET) return json({ error: "auth_not_configured" }, 503);
    const got =
      request.headers.get("x-fieldscan-secret") ||
      (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!(await secretsMatch(got, env.FIELDSCAN_AUTH_SECRET))) return json({ error: "unauthorized" }, 401);

    if (url.pathname === "/tasks" && request.method === "GET") {
      return json({ taskKeys: listTaskKeys() });
    }

    if (url.pathname === "/plan" && request.method === "POST") {
      let body;
      try { body = await request.json(); } catch { return json({ error: "invalid JSON body" }, 400); }
      try {
        const plan = compileIntent(body.request);
        const results = runContextMakers({
          request: body.request,
          assets: body.assets || [],
          observations: body.observations || [],
        });
        const context = consolidateAgentResults({ results, requiredEvidence: plan.requiredEvidence });
        return json({ plan, context });
      } catch (error) {
        return json({ error: "invalid_plan_request", detail: String(error?.message || error) }, 400);
      }
    }

    if (url.pathname === "/scan" && request.method === "POST") {
      let body;
      try { body = await request.json(); } catch { return json({ error: "invalid JSON body" }, 400); }
      const store = createUsageStore(env);
      try {
        const { status, body: resBody } = await handleScan(body, store, env);
        return json(resBody, status);
      } catch (e) {
        return json({ error: "internal_error", detail: String(e?.message || e) }, 500);
      }
    }

    return json({ error: "not_found", try: "POST /scan" }, 404);
  },
};

const DEMO_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>FieldScan AI — live demo</title>
<style>
:root{--bg:#0b1220;--card:#131c2e;--line:#243147;--ink:#eaf1ff;--mut:#8ea3c4;--acc:#2b8fff;--red:#ff4d5e;--amber:#ffb020;--green:#31d67a}
*{box-sizing:border-box;margin:0;padding:0}body{background:radial-gradient(1000px 500px at 50% -10%,#12203a,var(--bg));color:var(--ink);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;min-height:100vh;padding:24px}
.wrap{max-width:760px;margin:0 auto}
h1{font-size:24px;letter-spacing:-.02em}.sub{color:var(--mut);margin:4px 0 20px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px;margin-bottom:16px}
label{display:block;font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:var(--mut);margin:0 0 6px}
select,input[type=file]{width:100%;background:#0c1424;border:1px solid var(--line);color:var(--ink);border-radius:9px;padding:10px}
.row{display:flex;gap:12px;flex-wrap:wrap}.row>div{flex:1;min-width:160px}
button{margin-top:14px;width:100%;background:linear-gradient(135deg,#2b8fff,#0b4da8);color:#fff;border:0;border-radius:11px;padding:13px;font-weight:700;font-size:15px;cursor:pointer}
button:disabled{opacity:.6;cursor:wait}
.prev{margin-top:12px;display:flex;gap:8px;flex-wrap:wrap}.prev img{width:88px;height:88px;object-fit:cover;border-radius:8px;border:1px solid var(--line)}
#out{display:none}
.score{font-size:40px;font-weight:800}.pill{display:inline-block;padding:4px 12px;border-radius:999px;font-weight:700;font-size:13px}
.pass{background:rgba(49,214,122,.15);color:var(--green)}.fail{background:rgba(255,77,94,.15);color:var(--red)}.rev{background:rgba(255,176,32,.15);color:var(--amber)}
.flag{border-left:3px solid var(--red);background:rgba(255,77,94,.07);padding:8px 12px;border-radius:8px;margin:8px 0;font-size:14px}
.flag.med{border-color:var(--amber);background:rgba(255,176,32,.07)}.flag.low{border-color:var(--mut);background:rgba(142,163,196,.07)}
.k{color:var(--mut);font-size:12px;text-transform:uppercase;letter-spacing:.08em;margin:14px 0 6px}
.tags span{display:inline-block;background:#0c1424;border:1px solid var(--line);border-radius:7px;padding:3px 9px;margin:0 6px 6px 0;font-size:13px}
.miss span{color:var(--amber)}
.bid{font-size:20px;font-weight:700}.mut{color:var(--mut)}.err{color:var(--red)}
.foot{color:var(--mut);font-size:12px;text-align:center;margin-top:8px}
</style></head><body><div class="wrap">
<h1>FieldScan AI <span class="mut" style="font-size:14px">· live demo</span></h1>
<div class="sub">Upload field photos. The AI identifies visible equipment, checks required evidence, flags safety issues, and routes manager review. Real Gemini vision, per-scan metered.</div>
<div class="card">
  <div class="row">
    <div><label>Trade</label><select id="trade"><option value="garage-doors">Garage doors</option><option value="hvac">HVAC / commercial refrigeration</option></select></div>
    <div><label>Phase</label><select id="phase"><option value="after">After</option><option value="before">Before</option><option value="during">During</option></select></div>
  </div>
  <div style="margin-top:12px"><label>Job photos</label><input id="file" type="file" accept="image/*" multiple capture="environment"></div>
  <div class="prev" id="prev"></div>
  <button id="go">Scan</button>
</div>
<div class="card" id="out"></div>
<div class="foot">Powered by FieldScan AI · assessments are AI-generated and the owner confirms all bids.</div>
</div>
<script>
const $=s=>document.querySelector(s);let imgs=[];
$('#file').onchange=async e=>{imgs=[];$('#prev').innerHTML='';for(const f of e.target.files){const d=await toData(f);imgs.push(d);const i=new Image();i.src=d;$('#prev').appendChild(i);}};
function toData(f){return new Promise(r=>{const R=new FileReader();R.onload=()=>r(R.result);R.readAsDataURL(f);});}
$('#go').onclick=async()=>{
  if(!imgs.length){alert('Add at least one photo');return;}
  const b=$('#go');b.disabled=true;b.textContent='Scanning…';
  const out=$('#out');out.style.display='block';out.innerHTML='<div class="mut">Reading the photos…</div>';
  try{
    const r=await fetch('/demo',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({trade:$('#trade').value,phase:$('#phase').value,images:imgs})});
    const j=await r.json();
    if(j.error){out.innerHTML='<div class="err">'+(j.error==='quota_exceeded'?'Demo scan limit reached for this month — the real app meters this per user.':j.error)+'</div>';}
    else out.innerHTML=render(j);
  }catch(e){out.innerHTML='<div class="err">'+e.message+'</div>';}
  b.disabled=false;b.textContent='Scan';
};
function esc(s){return String(s||'').replace(/[<>&]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));}
function render(j){
  const cls=j.overall==='pass'?'pass':j.overall==='fail'?'fail':'rev';
  let h='<div style="display:flex;align-items:center;gap:16px"><div class="score">'+j.quality_score+'<span class="mut" style="font-size:18px">/100</span></div><span class="pill '+cls+'">'+esc(j.overall)+'</span></div>';
  h+='<div class="mut" style="margin-top:6px">'+esc(j.score_rationale)+'</div>';
  if(j.safety_flags&&j.safety_flags.length){h+='<div class="k">Safety flags</div>';for(const f of j.safety_flags)h+='<div class="flag '+esc(f.severity)+'"><b>'+esc(f.issue)+'</b> — '+esc(f.evidence)+'</div>';}
  else h+='<div class="k">Safety flags</div><div class="mut">None detected.</div>';
  h+='<div class="k">Views present</div><div class="tags">'+((j.views_present||[]).map(v=>'<span>'+esc(v)+'</span>').join('')||'<span class="mut">none</span>')+'</div>';
  if(j.missing_views&&j.missing_views.length)h+='<div class="k">Missing views</div><div class="tags miss">'+j.missing_views.map(v=>'<span>'+esc(v)+'</span>').join('')+'</div>';
  if(j.bid_range)h+='<div class="k">Suggested bid <span class="mut">(owner confirms)</span></div><div class="bid">$'+j.bid_range.low+' – $'+j.bid_range.high+'</div><div class="mut">'+esc(j.bid_range.basis)+'</div>';
  if(j.metering)h+='<div class="foot" style="margin-top:16px">demo scans used '+j.metering.used+' / '+j.metering.quota+' this month</div>';
  return h;
}
</script></body></html>`;
