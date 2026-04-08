# mission-control-runtime

A portable OpenClaw control-plane bundle that brings a fresh install into a ticket-governed operating mode for non-trivial work.

## What it ships

- native OpenClaw plugin
- bundled skill content
- ticket state store
- ticket tools for agent use
- ticket CLI for operators
- bounded classification engine
- executor routing table
- anti-pattern warnings
- classification regression corpus
- before-tool-call governance hooks
- workspace bootstrap overlays for `AGENTS.md`, `HEARTBEAT.md`, and docs

## Install on a fresh machine

```bash
openclaw plugins install ./mission-control-runtime-0.1.6.tgz
openclaw gateway restart
openclaw tickets bootstrap-workspace
```

## Operator CLI

```bash
openclaw tickets list
openclaw tickets show <ticket-id>
openclaw tickets audit
openclaw tickets heartbeat-audit
openclaw tickets classify --task "..."
openclaw tickets classify-test
openclaw tickets bootstrap-workspace
```

## Agent tools

- `ticket_classify`
- `ticket_open`
- `ticket_show`
- `ticket_list`
- `ticket_update`
- `ticket_close`
- `ticket_audit`
- `ticket_bootstrap_workspace`

## Governance behavior

The plugin blocks governed work when there is no active ticket.
By default it also requires the active ticket to contain bounded classification data.
For operational cutovers and installs, the injected guidance now pushes a DONE-or-BLOCKED completion discipline instead of surfacing intermediate shell friction.

Governed by default:
- `cron`
- `sessions_spawn`
- `exec` when backgrounded, elevated, PTY-driven, long-running, or operationally risky

Compatibility notes for OpenClaw 2026.4.5+:
- hook registration now targets current and fallback hook names (`before_tool_call`, `tool:before_call`, `before_tool_execute`, plus matching after-hook variants)
- governance also normalizes tool aliases (`sessions.spawn`, `host_exec`, `command_exec`) and exec parameter aliases (`detach`, `sudo`, `interactiveTty`, `timeoutMs`, `cmd`)

## State location

Ticket state is stored under the OpenClaw state directory in:

```text
mission-control-runtime/tickets.json
```
