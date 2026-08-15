# AI coding frontier research — 2026-08-15

Only official specifications and first-party product documentation were used.

## What is table stakes

- [Tree-sitter](https://tree-sitter.github.io/tree-sitter/) provides fast,
  incremental concrete syntax trees and resilient parsing. Use it in a future
  repository-analysis service for symbols and edit boundaries, not in the
  FieldScan photo runtime.
- [MCP architecture](https://modelcontextprotocol.io/specification/2025-06-18/architecture)
  formalizes host/client/server isolation, capability negotiation, and focused
  tool servers. FieldScan's contracts are MCP-ready, but no server is added
  until a real CRM, manual store, rate book, or work-order tool exists.
- [Cloudflare AI Search hybrid retrieval](https://developers.cloudflare.com/ai-search/configuration/indexing/hybrid-search/)
  runs vector and BM25 keyword search together, supports reciprocal-rank fusion,
  and can rerank. This is the correct later RAG direction for exact part numbers
  plus semantic matches; vector-only retrieval is rejected.

## Current frontier

- [OpenAI model guidance](https://developers.openai.com/api/docs/guides/latest-model)
  recommends lean prompts, explicit tool return contracts, representative evals,
  and programmatic tool calling for bounded filtering, joining, ranking,
  deduplication, aggregation, and validation. That directly supports the
  context-maker to consolidator pattern.
- [Cloudflare Code Mode](https://developers.cloudflare.com/agents/tools/codemode/)
  treats generated code as a compact plan for composed or dependent tool calls,
  while direct calls remain preferable for small fixed tool sets. It is
  experimental, so FieldScan records it as a sandboxed future execution mode.
- [Cloudflare Agents](https://developers.cloudflare.com/agents/) provides
  durable state, scheduling, queues, MCP, and observability. The current
  request/response Worker remains simpler for scans; a durable Agent becomes
  useful for recurring research, long-running jobs, or approval workflows.
- [Gemini 3.6 Flash](https://ai.google.dev/gemini-api/docs/latest-model) is the
  current GA agentic/multimodal Flash model. The migration requires removing
  deprecated sampling parameters. FieldScan is pinned to gemini-3.6-flash,
  removes Gemini temperature, and uses
  [structured output](https://ai.google.dev/gemini-api/docs/generate-content/structured-output).

## Practical decisions

1. Keep one authenticated deterministic plan endpoint with 18 task keys.
2. Run cheap context makers in parallel, consolidate once, and reread only gaps.
3. Keep official grades independent from agent confidence.
4. Cache only with tenant, model, prompt, rubric, policy, and evidence versions.
5. Run daily deterministic regression/security checks and weekly source watch.
6. Defer LangChain. Its
   [multi-agent guidance](https://docs.langchain.com/oss/python/langchain/multi-agent)
   also says a single agent with the right context and tools can be enough.
7. Add Tree-sitter, hybrid RAG, dependency graphs, and Code Mode only to the
   developer/repository agent, not the safety-critical photo scan hot path.
