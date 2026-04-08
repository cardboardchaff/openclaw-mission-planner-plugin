# Executor Routing

A ticket is a control-plane object, not an executor.

Choose the executor that makes the work most reliable.

## Preferred routing

- `deterministic-host-op`
  - `local-script`
  - `bounded-command`

- `bounded-agentic`
  - `subagent`
  - `task-flow`

- `scheduled-local`
  - `cron`
  - `systemd-timer`

- `external-workflow`
  - `workflow-engine`
  - `task-flow`

- `continuous-capability`
  - `container`
  - `service`

## Anti-patterns

Do not default to:

- `cron` for resident monitors, ongoing watchers, or stateful continuous capability
- `subagent` for deterministic host work with no reasoning benefit
- `bounded-command` for restart-durable unattended work

## Why-not check

For non-trivial work, be able to answer:
- why not cron?
- why not subagent?
- why not workflow-engine?
- why not container/service?

If the answer exposes a better substrate, switch to it.
