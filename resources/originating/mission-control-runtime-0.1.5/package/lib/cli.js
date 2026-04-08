import fs from "node:fs";
import path from "node:path";
import {
  classifyTask,
  classificationSummary,
  parseShapeOverrides,
} from "./classifier.js";
import {
  auditTickets,
  closeTicket,
  formatTicketText,
  getTicket,
  listTickets,
  openTicket,
  recordTicketNote,
  renderAudit,
  resolveTicketStatePaths,
  setDeliveryState,
  setTicketStatus,
  summarizeTicket,
} from "./tickets.js";
import { applyWorkspaceBootstrap } from "./workspace-bootstrap.js";

function pick(record, keys, fallback = "unknown") {
  for (const key of keys) {
    const value = record?.[key];
    if (value === undefined || value === null) continue;
    if (typeof value === "object") continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return fallback;
}

function pickNested(record, keys, fallback = "unknown") {
  const direct = pick(record, keys, "");
  if (direct) return direct;
  for (const nestedKey of ["task", "taskFlow", "flow"]) {
    const nested = record?.[nestedKey];
    if (nested && typeof nested === "object") {
      const value = pick(nested, keys, "");
      if (value) return value;
    }
  }
  return fallback;
}

function formatTaskAudit(findings) {
  if (!Array.isArray(findings) || findings.length === 0) return "HEARTBEAT_OK";
  const lines = ["BACKGROUND_TASK_AUDIT"];
  for (const finding of findings) {
    const code = pick(finding, ["code"]);
    const runtime = pickNested(finding, ["runtime", "kind"]);
    const state = pickNested(finding, ["status", "state"]);
    const lookup = pickNested(finding, [
      "token",
      "taskId",
      "task_id",
      "flowId",
      "flow_id",
      "runId",
      "run_id",
      "childSessionKey",
      "child_session_key",
      "label",
    ]);
    const detail = pickNested(finding, ["detail", "message", "summary"], "no detail provided");
    lines.push(`- lookup: ${lookup}`);
    lines.push(`  code: ${code}`);
    lines.push(`  runtime: ${runtime}`);
    lines.push(`  state: ${state}`);
    lines.push(`  why: ${detail}`);
    lines.push("  next: inspect the task or flow directly and verify the real execution state before trusting bookkeeping");
  }
  return lines.join("\n");
}

function resolveTaskAuditFindings(parsed) {
  if (!parsed || typeof parsed !== "object") return [];
  if (Array.isArray(parsed.findings)) return parsed.findings;
  if (Array.isArray(parsed.audit?.findings)) return parsed.audit.findings;
  if (Array.isArray(parsed.result?.findings)) return parsed.result.findings;
  if (Array.isArray(parsed.issues)) return parsed.issues;
  return [];
}

async function runCombinedHeartbeatAudit(runtime) {
  const taskResult = await runtime.system.runCommandWithTimeout(
    ["openclaw", "tasks", "audit", "--json"],
    { timeoutMs: 15000 },
  );
  let taskText = "HEARTBEAT_OK";
  if (taskResult.code !== 0) {
    taskText = `BACKGROUND_TASK_AUDIT_FAILED\n- error: ${(taskResult.stderr || taskResult.stdout || "tasks audit failed").trim()}`;
  } else {
    try {
      const parsed = JSON.parse(taskResult.stdout || "{}");
      taskText = formatTaskAudit(resolveTaskAuditFindings(parsed));
    } catch (error) {
      taskText = `BACKGROUND_TASK_AUDIT_FAILED\n- error: unable to parse tasks audit JSON: ${String(error)}`;
    }
  }
  const ticketText = renderAudit(auditTickets(runtime.state.resolveStateDir()));
  const taskOk = taskText.trim() === "HEARTBEAT_OK";
  const ticketOk = ticketText.trim() === "TICKET_AUDIT_OK";
  if (taskOk && ticketOk) return "HEARTBEAT_OK";
  const sections = [];
  if (!taskOk) sections.push(taskText);
  if (!ticketOk) sections.push(ticketText);
  return sections.join("\n\n");
}

function printJson(value) {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}

function parseJsonOption(text, label) {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`invalid JSON for ${label}: ${String(error)}`);
  }
}

function buildClassificationPayload(options) {
  const taskText = options.task || [options.objective, options.scope].filter(Boolean).join(". ");
  if (!taskText.trim()) return null;
  const classification = classifyTask(taskText, {
    shapeOverrides: parseShapeOverrides(parseJsonOption(options.shapeJson, "shape-json") || {}),
    executorOverride: options.executor,
  });
  if (options.classification && options.classification !== classification.classification) {
    throw new Error(
      `explicit classification ${options.classification} conflicts with bounded classification ${classification.classification}`,
    );
  }
  return classification;
}

function loadClassificationCases(pluginDir) {
  const filePath = path.join(pluginDir, "lib", "classification-cases.json");
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function runClassificationRegression(pluginDir) {
  const cases = loadClassificationCases(pluginDir);
  const results = [];
  let failed = 0;
  for (const item of cases) {
    const classification = classifyTask(item.task, { executorOverride: item.expectedExecutor });
    const problems = [];
    if (classification.classification !== item.expectedClassification) {
      problems.push(`expected classification ${item.expectedClassification} but got ${classification.classification}`);
    }
    if (classification.executorRecommendation.chosen !== item.expectedExecutor) {
      problems.push(`expected executor ${item.expectedExecutor} but got ${classification.executorRecommendation.chosen}`);
    }
    for (const forbidden of item.forbiddenExecutors || []) {
      if (classification.executorRecommendation.chosen === forbidden) {
        problems.push(`forbidden executor chosen: ${forbidden}`);
      }
    }
    if (problems.length) failed += 1;
    results.push({
      name: item.name,
      ok: problems.length === 0,
      classification: classification.classification,
      executor: classification.executorRecommendation.chosen,
      problems,
    });
  }
  return {
    total: results.length,
    failed,
    passed: results.length - failed,
    results,
  };
}

export function registerTicketsCli({ program, runtime, config, pluginDir, policy }) {
  const stateDir = runtime.state.resolveStateDir();
  const fallbackWorkspaceDir = runtime.agent.resolveAgentWorkspaceDir(config);
  const workspaceDir = fs.existsSync(`${process.cwd()}/AGENTS.md`) ? process.cwd() : fallbackWorkspaceDir;

  const tickets = program.command("tickets").description("Mission Control Runtime ticket operations");

  tickets
    .command("path")
    .description("Show ticket state paths")
    .action(() => {
      printJson(resolveTicketStatePaths(stateDir));
    });

  tickets
    .command("list")
    .description("List tickets")
    .option("--status <status>", "Filter by status (repeatable)", collect, [])
    .option("--full", "Show full ticket payloads")
    .action((options) => {
      const records = listTickets(stateDir, options.status?.length ? { status: options.status } : {});
      printJson({
        count: records.length,
        tickets: options.full ? records : records.map((ticket) => summarizeTicket(ticket)),
      });
    });

  tickets
    .command("show <ticketId>")
    .description("Show a ticket")
    .action((ticketId) => {
      const ticket = getTicket(stateDir, ticketId);
      if (!ticket) {
        process.stderr.write(`ticket not found: ${ticketId}\n`);
        process.exitCode = 1;
        return;
      }
      process.stdout.write(formatTicketText(ticket) + "\n");
    });

  tickets
    .command("audit")
    .description("Audit ticket state for overdue or delivery-pending work")
    .action(() => {
      process.stdout.write(renderAudit(auditTickets(stateDir)) + "\n");
    });

  tickets
    .command("heartbeat-audit")
    .description("Run combined OpenClaw task audit plus Mission Control Runtime ticket audit")
    .action(async () => {
      process.stdout.write((await runCombinedHeartbeatAudit(runtime)) + "\n");
    });

  tickets
    .command("classify")
    .description("Run the bounded classifier for a task")
    .requiredOption("--task <task>")
    .option("--shape-json <json>", "Optional shape overrides as JSON")
    .option("--executor <executor>", "Optional executor override to evaluate")
    .action((options) => {
      const result = classifyTask(options.task, {
        shapeOverrides: parseShapeOverrides(parseJsonOption(options.shapeJson, "shape-json") || {}),
        executorOverride: options.executor,
      });
      printJson(result);
    });

  tickets
    .command("classify-test")
    .description("Run bounded classification regression cases")
    .action(() => {
      const result = runClassificationRegression(pluginDir);
      printJson(result);
      if (result.failed > 0) process.exitCode = 1;
    });

  tickets
    .command("open")
    .description("Open a ticket from the CLI")
    .requiredOption("--session-key <sessionKey>")
    .requiredOption("--success-measure <successMeasure>")
    .requiredOption("--expected-duration-seconds <seconds>")
    .requiredOption("--hard-timeout-seconds <seconds>")
    .option("--task <task>", "Task text to classify and store with the ticket")
    .option("--objective <objective>")
    .option("--classification <classification>")
    .option("--scope <scope>")
    .option("--context-summary <summary>")
    .option("--delivery-required", "Require verified delivery")
    .option("--shape-json <json>", "Optional shape overrides as JSON")
    .option("--executor <executor>", "Optional executor override for bounded classification")
    .action((options) => {
      const classificationData = buildClassificationPayload(options);
      const objective = options.objective || options.task;
      const classification = options.classification || classificationData?.classification;
      const scope = options.scope || options.task || classificationSummary(classificationData?.classification || "deterministic-host-op", classificationData?.executorRecommendation?.chosen || "local-script", classificationData?.taskShape || { hostLocal: false });
      if (!objective || !classification || !scope) {
        throw new Error("ticket open requires either --task or the explicit trio --objective, --classification, and --scope");
      }
      const ticket = openTicket(
        stateDir,
        {
          sessionKey: options.sessionKey,
          objective,
          classification,
          scope,
          taskText: options.task,
          contextSummary: options.contextSummary,
          successMeasure: options.successMeasure,
          expectedDurationSeconds: Number(options.expectedDurationSeconds),
          hardTimeoutSeconds: Number(options.hardTimeoutSeconds),
          deliveryRequired: Boolean(options.deliveryRequired),
          classificationData,
        },
        { singleActiveTicketPerSession: policy.singleActiveTicketPerSession },
      );
      printJson(ticket);
    });

  tickets
    .command("note <ticketId>")
    .description("Append a note to a ticket")
    .requiredOption("--summary <summary>")
    .action((ticketId, options) => {
      printJson(recordTicketNote(stateDir, ticketId, options.summary));
    });

  tickets
    .command("status <ticketId>")
    .description("Set ticket status")
    .requiredOption("--set <status>")
    .requiredOption("--summary <summary>")
    .action((ticketId, options) => {
      printJson(setTicketStatus(stateDir, ticketId, options.set, options.summary));
    });

  tickets
    .command("delivery <ticketId>")
    .description("Set delivery state")
    .requiredOption("--state <state>")
    .requiredOption("--summary <summary>")
    .action((ticketId, options) => {
      printJson(setDeliveryState(stateDir, ticketId, options.state, options.summary));
    });

  tickets
    .command("close <ticketId>")
    .description("Close a ticket")
    .requiredOption("--outcome <outcome>")
    .requiredOption("--summary <summary>")
    .option("--delivery-verified", "Mark delivery verified when closing")
    .action((ticketId, options) => {
      printJson(closeTicket(stateDir, ticketId, options.outcome, options.summary, { deliveryVerified: Boolean(options.deliveryVerified) }));
    });

  tickets
    .command("bootstrap-workspace")
    .description("Apply workspace overlays and docs for Mission Control Runtime")
    .action(() => {
      const result = applyWorkspaceBootstrap({
        workspaceDir,
        pluginDir,
        bootstrapPolicy: policy.bootstrap,
      });
      printJson(result);
    });

  tickets
    .command("bootstrap-status")
    .description("Show whether workspace bootstrap files exist")
    .action(() => {
      const markerPath = `${workspaceDir}/.mission-control-runtime.json`;
      printJson({
        workspaceDir,
        markerPath,
        markerExists: fs.existsSync(markerPath),
      });
    });
}

function collect(value, previous) {
  previous.push(value);
  return previous;
}
