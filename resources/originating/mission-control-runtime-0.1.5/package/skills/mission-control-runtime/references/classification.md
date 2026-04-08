# Classification

Mission Control Runtime uses a bounded classification model.

## Task-shape fields

Classify by runtime shape, not by task noun.

Fields:
- `deterministic`
- `residentCapability`
- `recurring`
- `stateful`
- `restartDurable`
- `latencySensitivity` (`low|medium|high`)
- `hostLocal`
- `externalIntegrations`
- `packagedDependencies`
- `agenticReasoning`
- `destructive`
- `externalWorkflowCandidate`

## Classes

- `inline-trivial`
  - stays in the current turn
  - no waiting, polling, retry, callback, or scheduling

- `deterministic-host-op`
  - exact operational work on the host
  - restart, mount check, network change, service verification, similar bounded tasks

- `bounded-agentic`
  - research, synthesis, coding, review, comparison branches
  - usually maps to `sessions_spawn` or another child runtime

- `scheduled-local`
  - cron, reminders, post-boot checks, recurring local tasks without resident capability semantics

- `external-workflow`
  - n8n or other external automations with callbacks, approvals, or branching

- `continuous-capability`
  - a service, daemon, container, or always-on capability

## Tie-break rules

- If `residentCapability=true`, do not default to cron.
- If `stateful=true` and `restartDurable=true` for ongoing watch/monitor work, prefer `continuous-capability`.
- If `agenticReasoning=false` and `deterministic=true`, do not default to a subagent.
- If `restartDurable=true`, do not default to a bounded foreground command.

## Example

Task:
- "create a log file on nas, every time a new device appears on the local network that hasn't been seen before log its details and message me here"

Expected shape:
- deterministic=true
- residentCapability=true
- recurring=true
- stateful=true
- restartDurable=true
- hostLocal=true
- externalIntegrations=true
- packagedDependencies=true
- agenticReasoning=false

Expected class:
- `continuous-capability`
