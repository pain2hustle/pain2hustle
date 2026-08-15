#!/usr/bin/env node
/**
 * assert-no-bundled-secrets.mjs — the last gate before bytes leave this machine.
 *
 * WHY THIS EXISTS
 *   On 2026-08-10 a Resend key was lifted off disk and mass-abused, and the first
 *   anyone knew of it was the phishing that went out under our own domain. Nothing
 *   here was looking at what we publish. This looks — at the exact moment it can
 *   still stop the publish.
 *
 * HOW IT'S WIRED
 *   package.json runs it in front of the deploy (an npm `predeploy` hook, or `&&`
 *   in front of wrangler). A finding exits 1, so the deploy never runs. Fail
 *   closed on purpose: a file we cannot read is a reason to stop, not to shrug.
 *
 * WHAT IT SCANS
 *   The roots given on argv — files or directories — or DEFAULT_ROOTS below.
 *   Roots are this project's REAL publish payload. For a Worker that is src/ plus
 *   wrangler.toml; for a Pages site it is the whole directory wrangler uploads;
 *   for a Next/OpenNext build it is the build output dirs. Missing roots are
 *   skipped quietly so a script can list a dir that only some builds produce.
 *
 * WHAT STOPS A DEPLOY
 *   1. A credential SHAPE inside a file that would ship.
 *   2. A .dev.vars / .env file sitting inside the publish payload. Those are
 *      local-only by definition — if one is in the upload set it is already a leak.
 *   3. The NAME of a secret env var serialized into a bundle, which is how a build
 *      leaks a value whose prefix we do not have a pattern for yet.
 *
 * WHAT IT WILL NOT DO
 *   Print a live credential. Output is masked. This text gets pasted into chats.
 *
 * No dependencies, no network, plain Node ESM — it runs anywhere wrangler does.
 */

import { existsSync, statSync, readFileSync, readdirSync } from 'node:fs'
import { join, basename, extname } from 'node:path'

// fieldscan-ai ships src/ plus the rubrics and plans it reads at runtime. .dev.vars sits
// in the repo root and is deliberately NOT a scan root — but if a copy ever lands inside
// one of these, the forbidden-filename rule below stops the deploy.
// Override by passing roots on argv.
const DEFAULT_ROOTS = ['src', 'rubrics', 'plans.json', 'wrangler.toml']

const roots = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_ROOTS

// Credential shapes worth stopping the world for. Every one has a distinctive
// prefix — matching on entropy alone drowns you in minified variable names, and a
// scanner nobody reads is the same as no scanner.
const SECRET_PATTERNS = [
  ['Stripe live secret key', /\bsk_live_[A-Za-z0-9_]{16,}/g],
  ['Stripe test secret key', /\bsk_test_[A-Za-z0-9_]{16,}/g],
  ['Stripe restricted key', /\brk_live_[A-Za-z0-9]{16,}/g],
  ['Stripe webhook signing secret', /\bwhsec_[A-Za-z0-9_]{16,}/g],
  ['Anthropic API key', /\bsk-ant-[A-Za-z0-9_-]{16,}/g],
  ['Resend API key', /\bre_[A-Za-z0-9_-]{16,}/g],
  ['Google / Gemini API key', /\bAIza[0-9A-Za-z_-]{35}/g],
  ['Cloudflare API token', /\bcfat_[A-Za-z0-9_-]{20,}/g],
  ['Postgres URI with inline password', /\bpostgres(?:ql)?:\/\/[^"'`\s]+:[^"'`\s]+@[^"'`\s]+/gi],
  // Supabase keys are JWTs, so the literal string "service_role" never appears in
  // the key itself — it is inside the base64 payload. Shape alone cannot tell the
  // public anon key (meant to ship, guarded by RLS) from the service_role key
  // (bypasses RLS entirely = full database). Match the shape, then read the claim.
  ['Supabase JWT', /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g],
]

// A build that inlines the whole env object leaks values we have no prefix for.
// The serialized NAME is the tell. Only applied to bundled/served artifacts —
// hand-written source legitimately mentions these names.
const SECRET_ENV_NAMES = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'STRIPE_SECRET_KEY',
  'STRIPE_TEST_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'ANTHROPIC_API_KEY',
  'RESEND_API_KEY',
  'GEMINI_API_KEY',
  'DATABASE_URL',
]

// Local-only files. Their whole purpose is to hold plaintext secrets on this box;
// none of them has any business inside an upload set.
const FORBIDDEN_FILENAMES = [/^\.dev\.vars(\..+)?$/i, /^\.env(\..+)?$/i]

// Text we can meaningfully grep. wrangler.toml and *.toml.bak are in here because
// a stale backup config is exactly where an old plaintext [vars] value hides.
const TEXT_EXTENSIONS = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.json', '.html', '.htm', '.txt',
  '.map', '.css', '.svg', '.toml', '.yml', '.yaml', '.sql', '.md', '.sh', '.ps1',
  '.bak', '.vars', '.env', '.xml', '.webmanifest',
])

// A public/publishable key is MEANT to ship. Flagging it every run is how a
// scanner earns being ignored.
const BENIGN_CONTEXT = [/"?anon"?\s*[:=]/i, /publishable/i, /\bpk_live_/, /\bpk_test_/]

const SKIP_DIRS = new Set(['node_modules', '.git', '.wrangler', '.vercel', '.cache', 'coverage'])

const MAX_BYTES = 15 * 1024 * 1024

const findings = []

// Never print a whole live credential, even to a local terminal.
function mask(value) {
  const s = String(value)
  return s.length <= 12 ? s.slice(0, 4) + '…' : s.slice(0, 6) + '…' + s.slice(-4)
}

function readRole(token) {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const claims = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'))
    return String(claims.role || claims.typ || 'unknown')
  } catch {
    return 'unparseable'
  }
}

// An inlined image is a wall of base64, and base64's alphabet throws off things
// that look like key prefixes purely by chance. A scanner that confidently names a
// JPEG as a stolen credential does not get believed the day it is right.
function inBase64Blob(text, at) {
  if (/data:[a-z]+\/[a-z0-9.+-]+;base64,/i.test(text.slice(Math.max(0, at - 400), at))) return true
  const isB64 = (c) =>
    (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') ||
    c === '+' || c === '/' || c === '='
  let i = at
  while (i > 0 && isB64(text[i - 1])) i--
  let j = at
  while (j < text.length && isB64(text[j])) j++
  return j - i >= 600
}

// The serialized-env-NAME check only makes sense on machine-generated output.
// Applying it to src/ would flag every honest `env["RESEND_API_KEY"]` lookup.
function looksBundled(file) {
  return /(^|[\\/])(\.open-next|\.next|dist|out|build|_cf-edge-deferred|[\w.-]*-dist)([\\/]|$)/.test(file)
}

function walk(target, out = []) {
  if (!existsSync(target)) return out
  let stat
  try {
    stat = statSync(target)
  } catch {
    return out
  }
  if (!stat.isDirectory()) {
    out.push(target)
    return out
  }
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    const path = join(target, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      walk(path, out)
    } else {
      out.push(path)
    }
  }
  return out
}

function scanFile(file, explicit) {
  const name = basename(file)

  // Rule 2 first — a .dev.vars in the payload is a finding whatever is inside it.
  if (FORBIDDEN_FILENAMES.some((re) => re.test(name))) {
    findings.push({ file, what: 'local-only secrets file inside the publish payload', value: name })
    return
  }

  const ext = extname(file).toLowerCase()
  const scannable = explicit || TEXT_EXTENSIONS.has(ext) || /worker\.js$/.test(file) || /\.toml\./.test(name)
  if (!scannable) return

  let size = 0
  try {
    size = statSync(file).size
  } catch {
    findings.push({ file, what: 'unreadable file in the publish payload (fail closed)', value: name })
    return
  }
  if (size > MAX_BYTES) return

  let body
  try {
    body = readFileSync(file, 'utf8')
  } catch {
    findings.push({ file, what: 'unreadable file in the publish payload (fail closed)', value: name })
    return
  }

  const seen = new Set()
  for (const [label, re] of SECRET_PATTERNS) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(body))) {
      const hit = m[0]
      const context = body.slice(Math.max(0, m.index - 60), m.index + 60)
      if (BENIGN_CONTEXT.some((b) => b.test(context))) continue
      if (inBase64Blob(body, m.index)) continue

      let what = label
      if (label === 'Supabase JWT') {
        const role = readRole(hit)
        if (role === 'anon') continue // public by design, protected by RLS
        what =
          role === 'service_role'
            ? 'Supabase service_role JWT (bypasses RLS — full database)'
            : `JWT with role=${role} (not an anon key — check what this is)`
      }

      // The same key repeated 40 times in one minified bundle is one finding.
      const key = what + '|' + hit
      if (seen.has(key)) continue
      seen.add(key)
      findings.push({ file, what, value: hit })
      if (findings.length > 200) return
    }
  }

  if (looksBundled(file)) {
    for (const envName of SECRET_ENV_NAMES) {
      if (body.includes(`"${envName}"`) || body.includes(`'${envName}'`)) {
        findings.push({ file, what: `secret env name "${envName}" serialized into build output`, value: envName })
      }
    }
  }
}

let scanned = 0
for (const root of roots) {
  const explicit = existsSync(root) && !statSync(root).isDirectory()
  for (const file of walk(root)) {
    scanned++
    scanFile(file, explicit)
  }
}

if (findings.length) {
  console.error(`\n${findings.length} secret-like finding(s) in the publish payload:\n`)
  for (const f of findings) {
    console.error(`  ${f.what}`)
    console.error(`    file  : ${f.file}`)
    console.error(`    value : ${mask(f.value)}`)
  }
  console.error('\nDo not deploy this. Rotate any value that has already shipped —')
  console.error('a key that is still valid is still a key, wherever it lives.\n')
  process.exit(1)
}

console.log(`No secret-like values found in ${scanned} file(s) across: ${roots.join(', ')}`)
