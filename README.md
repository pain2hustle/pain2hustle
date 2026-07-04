<h1 align="center">Austin Little · <code>Pain2HuStle</code></h1>
<p align="center"><b>Self-taught AI systems builder · multi-agent orchestration · I make complex systems legible.</b></p>
<p align="center">Frontline tech → taught myself to build and run fleets of AI agents in ~90 days → shipped live products the whole way.</p>

---

### The short version

No ML degree. No lab. I came off years of frontline technical work — AT&T field tech, wire rooms and internet-signal work, medical-equipment onboarding. Then in about 90 days I taught myself to build and run **coordinated fleets of AI agents**, hit the real coordination-and-legibility problems the field writes papers about, and **engineered the fixes into working code** across several live products.

I don't theorize. I build it, watch it break, and fix it. Everything below is verifiable in the repos.

---

### The thread I keep pulling on: *superposition*

When you run too many agents at once, the system goes **unpredictable** — overlapping states, individually unreadable, no way to tell what's happening until it collapses into a mess. Before I'd read the term, I described that to myself as the agents being in a kind of **superposition**.

I built superposition into my own systems **before I'd ever seen a single AI-lab job posting** — it's dated in my AMH repo (`swarm.mjs`, `index.html`), *"AMH SUPERPOSITION SWARM"*, **May 2026**. Not a word I borrowed to match a role. A problem I found on my own and started solving in code.

The fix was never *more* agents. It was making the fleet **legible and coordinated**:

- a **conductor** that collapses the chaos into ordered work
- **one clear lane per agent** — hard file-isolation so two agents can never corrupt the same file; they meet at a shared data contract
- **priority scheduling** under a fixed constraint so the limited resource never scatters
- a **shared board** agents read and write, so they collaborate instead of collide

Lane isolation, priority escalation, quality gating, dedup, autonomous cycling — the actual building blocks of a coordinated multi-agent system, arrived at by necessity, before I knew the textbook names for any of it.

I see **one pattern across three superpositions**: quantum (physics), features packed into neurons (interpretability), and my own agent fleets — *many overlapping states, made understandable by understanding the collapse.*

---

### What I've built (each one solved a real problem)

**🛰️ Multi-Agent Orchestration Fleet** — a **9-lane fleet** (6 cloud + 3 local LLM lanes) with a conductor that partitions work so agents can't collide, **free-first control flow** (cloud escalates only after local retries fail), a **"retry-till-real" quality gate** so it never ships a fake result, and a **self-refilling, deduped** queue for 24/7 autonomy. Runs **$0** on a rotating free-model pool.

**🚦 Roadscape** — a corridor-safety **screening engine**: free public data (federal crash records, state traffic counts) + AASHTO swept-path geometry → evidence packets, a real-scale collision-free 3D traffic sim, and an agent that ranks real cities in need. Honest guardrails throughout — *screening-grade, never PE-stamped; measured vs. estimated always labeled; never a fabricated number.*

**🔎 NeighborDoors** — a multi-source **search + investigation engine** with cross-source corroboration and cited AI briefs. Migrated off a capped host onto Cloudflare Workers; AI runs on a free-model pool ($0).

**🐝 Apiary** — an accessibility-first web experience for the tech-isolated (the *"damn, grandma, how'd you do that?"* moment as the actual KPI) with a self-evolving article fleet that compounds on its own past insights.

**⚙️ Service Pricer** — rescued a 144-route Next.js app off a capped host onto Cloudflare Workers, keeping locked payment code untouched and squeezing it under a hard size cap. No regression.

---

### How I work

- **Free-first / in-house.** Everything runs $0 on my own rotating pool of free models + local inference. I engineer around the constraint instead of buying past it.
- **Honest guardrails, always.** Screening-grade is never sold as certified. Accuracy is a measured band, never a marketed number. I don't fake results — it's in the code.
- **Ship and iterate.** Short scope, ship a chunk, watch real behavior, steer. A working thing to react to beats a frozen spec.
- **I translate complexity to plain English.** My single strongest gift — I can take something genuinely hard and make a regular person *get it.*

---

<p align="center"><i>The proof isn't a claim. It's the repos. 🐝</i></p>
