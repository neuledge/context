# @neuledge/context Launch Plan

**Goal:** Take this package from zero to thousands of downloads per week

---

## Executive Summary

`@neuledge/context` is a **free, offline-first MCP documentation server** that directly competes with Context7 ($10/month) and Deepcon ($8/month). The key differentiators are:

| Advantage | Why It Matters |
|-----------|----------------|
| **Free forever** | Context7 just slashed their free tier by 92% (from ~6k to 1k req/month) |
| **<10ms latency** | Cloud competitors have 100-500ms latency |
| **Works offline** | Code on flights, coffee shops, anywhere |
| **100% private** | No queries sent to cloud - critical for proprietary codebases |
| **No rate limits** | Context7 has 60 req/hour limit, users report constant rate limiting |
| **Private repos free** | Context7 charges $15/1M tokens for private repos |

---

## Competitive Analysis

### Context7 (Primary Competitor)
- **Pricing:** $10/month, reduced free tier to 1,000 req/month (Jan 2026)
- **Pain Points (from GitHub Issues):**
  - Users report "Being rate limited on every request"
  - 60 req/hour limit frustrates heavy users
  - Cloud latency (100-500ms) adds friction
  - 65% accuracy on real-world tasks (per Deepcon benchmarks)
- **Recent Controversy:** [JP Caparas article](https://blog.devgenius.io/context7-quietly-slashed-its-free-tier-by-92-16fa05ddce03) documented 92% free tier reduction
- **Opportunity:** Many users upset about pricing changes - ripe for alternative

### Deepcon (Secondary Competitor)
- **Pricing:** $8/month, 100 req/month free tier
- **Strengths:** Claims 90% accuracy vs Context7's 65%
- **Weaknesses:** Still cloud-based, throttled, no offline mode
- **HN Launch:** Minimal traction - only one comment, asked for video demo

### Similar Success Story: Cupertino
- Offline Apple documentation MCP server
- HN reception: Overwhelmingly positive
- Key lesson: v0.3.0 added pre-built database downloads - setup went from 20 hours to 30 seconds
- **Your package already has this** (SQLite .db files)

---

## Target Audience

### Primary Personas

1. **The Privacy-Conscious Enterprise Dev**
   - Works with proprietary code
   - Can't send queries to cloud services
   - Willing to trade convenience for control
   - *Message: "Your questions about internal APIs stay internal"*

2. **The Rate-Limited Context7 User**
   - Hit the 1000 req/month wall
   - Frustrated by 60 req/hour throttling
   - Not willing to pay $10/month
   - *Message: "Unlimited requests. Free forever. No rate limits."*

3. **The Nomadic Developer**
   - Codes on flights, in coffee shops
   - Needs offline capability
   - Values reliability over features
   - *Message: "Code on flights. Query docs offline."*

4. **The Performance Obsessive**
   - 100ms latency is too slow
   - Wants instant responses
   - Cares about workflow efficiency
   - *Message: "<10ms. Not 100-500ms. Local is faster."*

---

## Launch Strategy

### Phase 1: Foundation (Week 1)

**Goal:** Establish credibility before promotion

1. **Polish the README** (already looks good)
   - Add GIF/video demo showing speed difference
   - Add "Migration from Context7" section
   - Add badges: downloads, stars, build status

2. **Create Demo Content**
   - Record 60-second terminal demo
   - Show: install, add docs, query, see speed
   - Host on YouTube, link from README

3. **Set Up Metrics**
   - Track npm downloads
   - GitHub stars
   - Create simple landing page (optional)

### Phase 2: Soft Launch (Week 2)

**Goal:** Get initial traction and feedback

**Channels (in order):**

#### 1. Dev.to Article
- **Title:** "I Built a Free, Offline Alternative to Context7 for AI Coding"
- **Format:** Problem → Solution → Tutorial
- **CTA:** Try it, star on GitHub

#### 2. r/ClaudeAI (386k members)
- **Approach:** Value-first, subtle promotion (see Composio strategy)
- **Post Type:** "Solved my Context7 rate limit issues with a local MCP"
- **Key:** Share journey, not just product

#### 3. r/cursor
- Post about MCP setup for Cursor
- Technical how-to format

#### 4. r/SideProject
- "Built this over the weekend" story format
- Focus on technical decisions

### Phase 3: Main Launch (Week 3)

**Goal:** Maximum visibility

#### Hacker News "Show HN"
**Critical: This is the most important launch**

**Title Options (pick one):**
```
Show HN: Context – Free, offline documentation for AI coding assistants
Show HN: Context – Local-first MCP server for up-to-date library docs
Show HN: Context – Stop paying for documentation queries (<10ms, offline, free)
```

**Intro Comment Template:**
```
Hi HN! I built Context because I was tired of:

1. Context7's rate limits (60 req/hour, 1k/month free tier)
2. 100-500ms cloud latency for every doc lookup
3. Sending my queries about internal APIs to third-party servers

Context runs 100% locally. Your docs are SQLite databases on your machine.
Queries take <10ms instead of 100-500ms. Works offline. Free forever.

How it works:
- `context add https://github.com/vercel/next.js` - builds local DB
- Configure MCP in Claude Desktop/Cursor/VS Code
- Ask your AI about Next.js - it queries local docs instantly

Built with SQLite FTS5 for fast full-text search. No embedding models,
no vector databases, no cloud dependencies.

Happy to answer questions. Repo: [link]
```

**Timing:** Tuesday-Thursday, 9-11 AM PT

**Preparation:**
- Have teammates/friends ready to engage (NOT to upvote - HN detects this)
- Be ready to respond to every comment within 30 minutes
- Prepare answers for likely questions:
  - "How does this compare to just using llms.txt?"
  - "Why SQLite instead of vector search?"
  - "How do you handle documentation updates?"

### Phase 4: Sustained Growth (Week 4+)

**Goal:** Build flywheel

1. **Stack Overflow**
   - Answer questions about AI hallucinations with docs
   - Mention as option alongside Context7

2. **YouTube**
   - Record "Setting up Context for [Framework]" tutorials
   - Target: Next.js, Prisma, Tailwind (popular stacks)

3. **Product Hunt**
   - Launch 1-2 weeks after HN
   - Different audience, lower developer concentration
   - Good for awareness, less for downloads

4. **Discord Communities**
   - Claude Discord
   - Cursor Discord
   - Framework-specific Discords

5. **Twitter/X**
   - Quote-tweet Context7 complaints with solution
   - Share speed comparisons
   - Build in public updates

---

## Suggested Copy

### One-liner (for social)
```
Free, offline documentation for AI coding. <10ms queries. No rate limits. No cloud.
```

### Tweet Thread
```
Thread: I was hitting Context7's rate limit every day.

60 requests/hour. 1,000/month free tier.

So I built a free alternative that runs entirely on my machine.

Here's why local beats cloud for documentation queries: 🧵

1/ Context7 takes 100-500ms per query.
   That's because your query goes:
   → To their server
   → Semantic search
   → Back to you

   Context: <10ms
   Your query never leaves your machine.

2/ Context7 has rate limits.
   Free tier: 1,000 req/month (they cut it 92% in January)
   Paid: $10/month

   Context: Unlimited. Forever. Free.

3/ Context7 sees your queries.
   Working on proprietary code? Internal APIs?
   Every query goes to their servers.

   Context: 100% local. Private by default.

4/ Context7 needs internet.
   Coding on a flight? Coffee shop with bad WiFi?

   Context: Works offline. Always.

Try it:
npm install -g @neuledge/context
context add https://github.com/vercel/next.js

GitHub: [link]
```

### Reddit Post (r/ClaudeAI)

**Title:** "How I solved Context7 rate limiting with a local MCP server"

**Body:**
```
I've been using Claude Code heavily for the past few months, and Context7 has
been essential for getting up-to-date documentation into context.

But lately I keep hitting rate limits:
- 60 requests per hour
- They cut the free tier from ~6000 to 1000 requests/month in January

I started looking for alternatives and ended up building one. It's called
Context (https://github.com/neuledge/context) and it works differently:

- Downloads docs to your machine as SQLite databases
- Queries happen locally (<10ms instead of 100-500ms)
- No rate limits because there's no server
- Works offline (I code on flights a lot)

Setup is pretty simple:
1. npm install -g @neuledge/context
2. context add https://github.com/vercel/next.js
3. Add to your Claude Desktop MCP config

The main tradeoff is you need to manually add the docs you want, whereas
Context7 has a huge library. But for my core stack (Next.js, Prisma, a few
others), it's been working great.

Anyone else running into Context7 rate limits? Curious what solutions
you've found.
```

### Hacker News (alternative intro)
```
Hi HN! Context is a local-first MCP server that gives AI coding assistants
access to library documentation.

Unlike cloud services (Context7, Deepcon), everything runs on your machine:
- Documentation stored as SQLite databases with FTS5 search
- <10ms query latency (vs 100-500ms for cloud)
- Works offline
- No rate limits
- Free forever

The workflow:
  context add https://github.com/vercel/next.js
  [builds local database from docs]

Then Claude/Cursor automatically queries it when you ask about Next.js.

I built this after hitting Context7's rate limits one too many times.
The 92% free tier reduction in January was the final push.

Technical choices:
- SQLite FTS5 over vector search (faster, no embedding model needed)
- Single MCP tool with dynamic schema (shows available libraries)
- Token-aware filtering (won't overwhelm context window)

Source: [link]
```

### Dev.to Article Outline
```
# I Built a Free, Offline Alternative to Context7

## The Problem

I love AI coding assistants. But they hallucinate outdated APIs constantly.

Context7 solved this by injecting live documentation. Great idea.

But then:
- January 2026: They cut the free tier by 92%
- 60 requests per hour rate limit
- Every query takes 100-500ms
- All my queries go to their servers

I work on proprietary code. I code on flights. I'm impatient.

## The Solution

I built Context. It's:
- 100% local (SQLite databases on your machine)
- <10ms queries
- No rate limits
- Works offline
- Free forever

## How It Works

[Technical explanation with diagrams]

## Getting Started

[Installation + MCP setup tutorial]

## Comparison

[Table comparing Context7 vs Deepcon vs Context]

## Try It

npm install -g @neuledge/context
context add https://github.com/vercel/next.js

GitHub: [link]
```

---

## Key Messages by Channel

| Channel | Primary Message | Tone |
|---------|-----------------|------|
| HN | Technical differentiation (SQLite FTS5, local-first architecture) | Technical, factual |
| Reddit | Rate limit frustration, cost savings | Conversational, relatable |
| Dev.to | Tutorial-first, problem-solution | Educational |
| Twitter | Speed comparison, privacy | Punchy, visual |
| Discord | Community helper, available for questions | Supportive |

---

## What NOT To Do

1. **Don't spam** - One post per community, then engage
2. **Don't ask for upvotes** - HN detects this, Reddit hates it
3. **Don't trash competitors** - State facts, let users conclude
4. **Don't launch everywhere at once** - Stagger for sustained visibility
5. **Don't ignore feedback** - Respond to every comment, especially criticism

---

## Success Metrics

| Milestone | Target | Timeline |
|-----------|--------|----------|
| GitHub stars | 100 | Week 2 |
| npm weekly downloads | 500 | Week 3 |
| GitHub stars | 500 | Week 4 |
| npm weekly downloads | 1,000 | Week 5 |
| GitHub stars | 1,000 | Week 6 |
| npm weekly downloads | 2,000+ | Week 8 |

---

## Progress Tracker

| Task | Status | Notes |
|------|--------|-------|
| Polish README with demo | Pending | Add GIF, migration guide |
| Record demo video | Pending | 60 seconds, terminal |
| Write Dev.to article | Pending | |
| Post to r/ClaudeAI | Pending | Use soft-sell approach |
| Post to r/cursor | Pending | |
| Post to r/SideProject | Pending | |
| Show HN launch | Pending | Tuesday-Thursday, 9-11 AM PT |
| Product Hunt launch | Pending | 1-2 weeks after HN |
| Create Twitter thread | Pending | |
| Answer Stack Overflow questions | Pending | Ongoing |

---

## Resources

### Competitor Research
- [Context7 GitHub](https://github.com/upstash/context7)
- [Context7 rate limit issues](https://github.com/upstash/context7/issues/808)
- [Deepcon](https://deepcon.ai/)
- [Deepcon HN discussion](https://news.ycombinator.com/item?id=45839378)

### Launch Guides
- [HN Show Guidelines](https://news.ycombinator.com/showhn.html)
- [How to crush your HN launch](https://dev.to/dfarrell/how-to-crush-your-hacker-news-launch-10jk)
- [6k GitHub stars in 6 months](https://dev.to/wasp/how-i-promoted-my-open-source-repo-to-6k-stars-in-6-months-3li9)

### Community Analysis
- [Composio Reddit strategy](https://startupspells.com/p/composio-reddit-ai-b2b-saas-content-marketing-strategy) - masterclass in subtle promotion
- [Cupertino HN success](https://news.ycombinator.com/item?id=46129111) - similar offline docs tool

---

*Last updated: 2026-02-03*
