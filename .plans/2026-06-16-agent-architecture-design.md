# Agent Architecture: Reasoning from LLM Limits

Status: discussion / design exploration. Intended to be handed to a researcher for stress-testing.

## The question

We built a system + dashboard where multiple agents each have their own context,
environment, and capabilities, and pick up tasks based on their own priorities —
modeled closely on a human org (an "engineer agent", a "product agent", etc.).

Is that the right model? Or are agents fundamentally *not* humans, such that copying
human org structure imports costs without the benefits?

## First principles

Strip away "agent", "team", "free will". The irreducible unit is:

> a stateless function `f(context, tools, objective) -> actions`, wrapped in a loop,
> with memory bolted on.

Everything else — names, personas, "picking work they feel like" — is interface
decoration we added for our own comprehension. The test for each decoration:
is it load-bearing, or was it copied for free from how humans work?

An agent differs from another agent on exactly four axes, nothing else:
**context** (what it knows/sees), **capabilities** (tools/permissions),
**objective** (the goal it's pointed at now), **policy** (instructions + model).
Two agents identical on all four are interchangeable.

## LLM limits (the grounding findings)

These are the empirical constraints the architecture must respect. The design
follows *from* these, not from intuition about how teams work.

1. **Anthropomorphizing agents has measured costs.** Treating agents like employees
   reduced individual accountability, increased unnecessary escalation, and lowered
   review quality — without improving adoption (HBR, 2026). Human-like framing also
   drives inappropriate trust and overreliance (PNAS).
   - *Implication:* "free will" solves problems agents don't have (they don't get
     bored, don't resent instruction, can be specified arbitrarily tightly). It only
     buys unpredictability and drift. Want **bounded delegation**, not autonomy:
     wide latitude on *how*, zero latitude on *what*.

2. **Multi-agent failure rates are high and mostly structural.** A study of 1,600+
   multi-agent traces found 41–87% failure rates, with ~79% of failures structural
   (coordination breakdown), not reasoning errors (orq.ai).
   - *Implication:* the bottleneck is structure/contracts, not model quality.

3. **Information silos are the dominant failure mechanism.** When agent A discovers
   something relevant to agent B, it's trapped in A's context window; B acts on a
   stale view and they make conflicting or duplicated decisions (orq.ai; Ghosh/Medium).
   - *Implication:* differentiated context (the source of multi-agent value) is also
     the primary failure mode. Knowledge must be a **shared, versioned substrate**
     that agents *reference*, not private copies they hoard.

4. **Interface ambiguity, not intelligence, causes most failures.** ~80% of
   multi-agent failures vanished once interface ambiguity was removed: typed inputs,
   bounded context, machine-validated output schemas, fixed contracts per worker (orq.ai).
   - *Implication:* the value of any agent split is hostage to clean **typed contracts
     at the seams**.

5. **Context windows and tool sets are finite and degrade with breadth.** Narrow
   context + small toolset outperforms a kitchen-sink agent (less tool confusion,
   tighter retrieval). Multi-agent overhead is real: centralized setups ~285% extra
   tokens, so structure must earn its keep via specialization/parallelism/critique
   (Towards Data Science; SuperAnnotate).
   - *Implication:* specialization is justified by **reliability**, not org mimicry.

6. **Capability is general; only context is scarce.** The same model is genuinely
   good at code *and* product *and* writing. The industry shift is toward **vertical
   (domain-specialized) agents** chosen for depth over breadth — Gartner projects 80%
   enterprise adoption by 2026 (Lindy; Domo).
   - *Implication:* never partition by skill (a human scarcity). Partition by domain.

## Conclusions

1. **Agents are not humans — cut free will.** Replace "agents choose their work" with
   computed priorities + a scheduler. (Finding 1.)

2. **The wrong axis was capability/skill.** "Engineer agent" / "product agent" copies
   a human constraint that doesn't exist for LLMs, and forces handoffs at exactly the
   seams where multi-agent systems die. (Findings 2, 6.)

3. **The right axis is the domain — a bounded body of context.** "Owns product A" vs
   "owns product B." Domain depth = accumulated, curated context, which is
   path-dependent. *This* is the one thing that doesn't reduce to ephemeral config —
   so this is where persistent agent identity is genuinely justified.
   **The identity is the context, not the persona.** (Finding 6.)

4. **A two-axis model:**
   - **Vertical = domain ownership** (persistent, deep, bounded) → the identity axis.
   - **Horizontal = cognitive mode** (triage/plan, manage/coordinate, execute) → every
     domain agent runs all three *within* its domain.
   - **Skill/function is not an axis** — it only decides which tools load for the
     current task.

5. **Modes should be scheduler-driven, not a fixed round-robin.** A cheap, mostly
   deterministic dispatcher picks which mode runs on what, based on state. (Finding 5.)

6. **"Mission" is a different altitude from "domain."** A goal like "push the company
   forward" is unbounded and cross-cutting — it belongs at the orchestration/triage
   altitude (top of the horizontal axis), NOT as a peer domain agent. Making it a peer
   reinvents the unbounded, silo-crossing, quasi-free-will agent that fails.

## Failure modes and required mitigations

| Failure mode (from findings) | Mitigation |
|---|---|
| Information silos / stale cross-agent view (3) | Shared, versioned knowledge substrate; agents reference items, never copy them. Differentiation in *selection*, single source of truth in *substance*. |
| Interface ambiguity / spec violations (4) | Typed contracts at every domain seam: typed inputs, bounded context, validated output schema. |
| Drift / divergence / duplication of knowledge | Knowledge items first-class, versioned, deduplicated; staleness signals on referenced items. |
| Anthropomorphic accountability loss (1) | Tasks (not agents) are the durable, auditable entity. Computed priorities, not chosen. |
| Token overhead of coordination (5) | Multi-agent only where domain depth / parallelism / critique pays; otherwise scale one agent. |

## Open questions to validate with a researcher

1. Is depth-by-domain actually superior to one general agent with strong retrieval —
   or does good retrieval erase the gap? (Tests the core justification for splitting.)
2. Do shared knowledge + typed contracts genuinely defeat the silo failure mode, or
   only delay it at scale?
3. Where should domain boundaries be drawn? Hypothesis: around a cohesive body of
   knowledge that *changes together* (DDD bounded contexts), not around products or
   the org chart. How do we handle cross-domain work that falls in the seams?

## Progress

| Task | Status |
|---|---|
| Frame the question from first principles | Done |
| Gather LLM-limit findings + sources | Done |
| Derive the two-axis model | Done |
| Document failure modes + mitigations | Done |
| Validate open questions with a researcher | Todo |
| Translate model into concrete schema (task object, knowledge item, mode contracts, scheduler) | Todo |

## Sources

- HBR (2026) — Why You Shouldn't Treat AI Agents Like Employees:
  https://hbr.org/2026/05/research-why-you-shouldnt-treat-ai-agents-like-employees
- PNAS — Benefits and dangers of anthropomorphic conversational agents:
  https://www.pnas.org/doi/10.1073/pnas.2415898122
- orq.ai — Why Multi-Agent LLM Systems Fail:
  https://orq.ai/blog/why-do-multi-agent-llm-systems-fail
- Ghosh / Medium — Why Multi-Agent Systems Fail at Scale:
  https://medium.com/@bijit211987/why-multi-agent-systems-fail-at-scale-and-why-simplicity-always-wins-7490f9002a9b
- Towards Data Science — Single Agent vs Multi-Agent:
  https://towardsdatascience.com/single-agent-vs-multi-agent-when-to-build-a-multi-agent-system/
- SuperAnnotate — Multi-agent LLMs in 2026:
  https://www.superannotate.com/blog/multi-agent-llms
- Lindy — What are Vertical AI Agents:
  https://www.lindy.ai/blog/vertical-ai-agents
- Domo — Horizontal vs Vertical AI Agents:
  https://www.domo.com/learn/article/horizontal-vs-vertical-ai-agents
