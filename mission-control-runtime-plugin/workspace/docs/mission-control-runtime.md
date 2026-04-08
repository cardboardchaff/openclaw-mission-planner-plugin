# Mission Control Runtime

Mission Control Runtime installs a ticket-governed control plane for non-trivial OpenClaw work.

## Core rules

Open a ticket before governed work.

Classify by runtime shape, not by superficial task noun.

Governed work includes:
- cron jobs
- spawned subagents and ACP sessions
- host commands that are backgrounded, elevated, PTY-driven, long-running, or operationally risky

## Bounded classification

Use:
- `openclaw tickets classify --task "..."`
- `ticket_classify`

The classifier records:
- task shape
- derived classification
- executor recommendation
- anti-pattern warnings
- confidence

## Ticket lifecycle

1. classify the task when executor choice matters
2. `ticket_open`
3. governed execution
4. `ticket_update` as evidence arrives
5. `ticket_close` only after the success measure is actually met

## Operator surfaces

- `openclaw tickets list`
- `openclaw tickets show <ticket-id>`
- `openclaw tickets audit`
- `openclaw tickets heartbeat-audit`
- `openclaw tickets classify --task "..."`
- `openclaw tickets classify-test`
- `openclaw tickets bootstrap-workspace`

## Notes

- the bundle governs OpenClaw-mediated work; it does not prevent a human with shell access from bypassing it outside OpenClaw
- bounded classification is intended to reduce freeform substrate choice and make executor selection testable
