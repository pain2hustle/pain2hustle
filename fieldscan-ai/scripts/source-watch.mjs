#!/usr/bin/env node
import { createHash } from "node:crypto";

const sources = [
  ["openai-model-guidance", "https://developers.openai.com/api/docs/guides/latest-model"],
  ["cloudflare-agents", "https://developers.cloudflare.com/agents/"],
  ["cloudflare-code-mode", "https://developers.cloudflare.com/agents/tools/codemode/"],
  ["gemini-latest", "https://ai.google.dev/gemini-api/docs/latest-model"],
  ["mcp-architecture", "https://modelcontextprotocol.io/specification/latest/architecture"],
  ["tree-sitter", "https://tree-sitter.github.io/tree-sitter/"],
  ["langchain-multi-agent", "https://docs.langchain.com/oss/python/langchain/multi-agent"],
];

const results = [];
for (const [id, url] of sources) {
  try {
    const response = await fetch(url, {
      headers: { "user-agent": "fieldscan-official-source-watch/1.0" },
      redirect: "follow",
      signal: AbortSignal.timeout(30_000),
    });
    const body = await response.text();
    results.push({
      id,
      url: response.url,
      ok: response.ok,
      status: response.status,
      etag: response.headers.get("etag"),
      lastModified: response.headers.get("last-modified"),
      sha256: createHash("sha256").update(body).digest("hex"),
      bytes: Buffer.byteLength(body),
    });
  } catch (error) {
    results.push({ id, url, ok: false, error: String(error?.message || error) });
  }
}

console.log(JSON.stringify({
  checkedAt: new Date().toISOString(),
  policy: "official sources only; changes require human review",
  results,
}, null, 2));

if (results.every((result) => !result.ok)) process.exitCode = 1;
