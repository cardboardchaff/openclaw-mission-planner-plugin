---
name: mission-control-runtime
description: Use when the Mission Control Runtime bundle is installed and the task may require a ticket, governed execution, bounded classification, ticket audit, workspace bootstrap, or executor selection for non-trivial work. Most relevant for detached work, cron, spawned subagents, operational host commands, and requests to bootstrap or inspect the ticket control plane.
---

# Mission Control Runtime

Mission Control Runtime is the ticket-governed control plane for non-trivial OpenClaw work. Use it to classify work through a bounded shape-based model, open and maintain tickets, choose the correct executor, and close the loop with evidence instead of narration.

## Workflow

### 1. Classify the task

Use `ticket_classify` or `openclaw tickets classify --task "..."` before opening a governed ticket when executor choice matters.

Use the bounded classification guidance in:
- `references/classification.md`
- `references/executor-routing.md`

### 2. Open a ticket before governed work

Use `ticket_open` before governed work starts.

Preferred pattern:
- pass `task`
- let the plugin derive task shape, classification, and executor rationale
- do not override the classification unless you have a concrete reason

### 3. Choose the executor

Use the plugin's executor recommendation as the default unless you have a specific environmental reason to deviate.

Tickets do not imply subagents. A subagent is only one possible executor.

### 4. Maintain the ticket during execution

Use:
- `ticket_show`
- `ticket_list`
- `ticket_update`
- `ticket_audit`

For heartbeat or operator-level combined inspection, use:
- `openclaw tickets heartbeat-audit`

Record evidence as it arrives. Do not call work complete just because a command finished.

For operational cutovers, installs, restarts, or other self-disruptive work, do not surface intermediate shell friction as status. Finish internally and return only on verified completion or a real blocker.

### 5. Close only on evidence

Use `ticket_close` only when the success measure is actually satisfied. If delivery is part of done, verify delivery before closure when possible.

## Workspace bootstrap

If asked to install or activate the control-plane overlays in the workspace, use:
- `ticket_bootstrap_workspace`

This installs:
- Mission Control Runtime docs
- a managed block in `AGENTS.md`
- a managed block in `HEARTBEAT.md`

## References

- `references/classification.md`
- `references/executor-routing.md`
- `references/delivery-and-closure.md`
