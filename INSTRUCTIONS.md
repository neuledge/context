# AI Development Guidelines

## Core Principles

### Minimalism
- Only write what's necessary, avoid over-engineering
- Less code = less maintenance

### Code Quality
- Prioritize clarity over cleverness
- Use meaningful names and simple logic

### No Duplicate Code
- Extract shared logic into reusable modules
- If you write the same code twice, refactor it

### Small Functions
- Under ~100 lines
- Single purpose

### Testing
- Focus on critical paths and edge cases, not the obvious
- Keep tests short and simple

### Documentation
- Document "why", not "what" (code shows what)
- Keep docs near the code
- Update docs when code changes

### DX First
When modifying interfaces or their usage:
1. Update documentation first
2. Ensure the design is clear and simple to use
3. Then implement the changes

Why: Writing docs first forces you to think through the API from the user's perspective before coding.

### Changesets

When modifying packages that are published (check for `"private": true` in package.json):
- Create a changeset file in `.changeset/` with a random filename (e.g., `happy-tiger-123.md`):
  ```markdown
  ---
  "package-name": patch
  ---

  Short summary of the change from user's perspective
  ```
- Bump types: `patch` (bug fixes), `minor` (new features), `major` (breaking changes)
- Skip changesets for: docs-only changes, test-only changes, internal tooling

Why: Changesets automate versioning and changelog generation, ensuring users know what changed between releases.

## Plans

Store in `/.plans/` with date prefix (e.g., `2026-01-27-feature-name.md`).
- Keep plans focused on one feature/system
- Include a Progress section with task status table
- Plans are temporary: delete when complete, preserve knowledge in code and docs

When starting a task, review existing plans in `/.plans/` to find relevant context.

### Task Management

Plans are **living documents** that evolve as understanding grows:
- Break work into concrete, actionable tasks
- Update task definitions as you learn more
- Add new tasks as complexity is discovered
- Remove or merge tasks that become unnecessary

If a task proves too complex:
- Pause to research and understand the problem deeper
- Break it into smaller tasks and update the plan
- This is valid progress - don't force completion of oversized tasks

### Risk-First Prioritization

Always pick the **highest-risk task first** - the one with most uncertainty:
- Unknown technical feasibility → tackle first
- Unclear requirements → clarify and implement early
- Complex integrations → prove them before building around them

Why: Early failures are cheap. Discovering a blocker after building dependent features is expensive.

### Keeping Plans Current

After completing any task:
- Mark it done in the Progress table
- Update remaining task definitions if understanding changed
- Add new tasks discovered during implementation
- Revise estimates/scope based on what you learned

### Completing Plans

When all tasks in a plan are done:

1. **Preserve knowledge before deleting:**
   - Add `TODO:` comments in code for future enhancements mentioned in the plan
   - Document architectural decisions with "why" comments where non-obvious
   - Update README or other docs if the plan contained user-facing information
   - Ensure any competitor analysis or research insights are captured where relevant

2. **Delete the plan file** - Plans are temporary; don't let them accumulate

Why: Plans contain valuable context (future ideas, design rationale, research). Embedding this in code/docs keeps it discoverable and maintained, while removing the stale plan file.

## Pre-PR Validation

All steps must pass before submitting:

```bash
pnpm install --frozen-lockfile
pnpm lint    # Run 'pnpm fix' to auto-fix
pnpm build
pnpm test
```

### Checklist
- [ ] Lint passes
- [ ] Build succeeds
- [ ] Tests pass
- [ ] README updated (if user-facing changes)
- [ ] Changeset added (if modifying published packages)
