# QA Session State

**Started:** 2026-06-27  
**Ends (~):** +5 hours from start  
**Policy:** fix-as-you-go  
**Loop:** every 20m  

## Progress

| Metric | Value |
|--------|-------|
| Workflows pass | 0 |
| Workflows fail | 0 |
| Workflows pending | 28 |
| Findings open | 0 |
| Findings fixed | 0 |

## Last iteration

- **Workflow:** — (starting W01)
- **Result:** —
- **Next:** W01

## Loop prompt (for agent ticks)

```
QA iteration — forge-cad human testing (fix-as-you-go)

1. Read tests/qa/PLAYBOOK.md, tests/qa/FINDINGS.md, tests/qa/SESSION.md
2. Dev server: http://localhost:5173/ (start npm run dev if down)
3. Pick oldest pending workflow in PLAYBOOK (or retry fail if all pending done)
4. Execute via browser MCP like a human: snapshot, click, type, wait for compile
5. Update PLAYBOOK status + SESSION.md + append FINDINGS on failure
6. P0/P1: fix, npm test targeted, commit with clear message
7. If session elapsed >= 5h: run npm test, summarize, stop loop
8. Brief summary: workflow id, pass/fail, bugs, next id
```
