import { fileURLToPath } from "node:url";
import path from "node:path";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { classifyTask, parseShapeOverrides } from "./lib/classifier.js";
import { registerTicketsCli } from "./lib/cli.js";
import { buildPromptGuidance, normalizeToolName, resolvePluginPolicy, toolRequiresTicket } from "./lib/policy.js";
import { applyWorkspaceBootstrap } from "./lib/workspace-bootstrap.js";
import {
  ACTIVE_STATUSES,
  auditTickets,
  closeTicket,
  findActiveTicket,
  formatTicketText,
  getTicket,
  listTickets,
  openTicket,
  recordGovernedToolCall,
  recordTicketNote,
  renderAudit,
  setDeliveryState,
  setTicketStatus,
  summarizeTicket,
} from "./lib/tickets.js";

const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url));

const TicketClassifySchema = {
  type: "object",
  additionalProperties: false,
  required: ["task"],
  properties: {
    task: { type: "string" },
    shapeOverrides: { type: "object" },
    executorOverride: { type: "string" },
  },
};

const TicketOpenSchema = {
  type: "object",
  additionalProperties: false,
  required: ["successMeasure", "expectedDurationSeconds", "hardTimeoutSeconds"],
  properties: {
    task: { type: "string" },
    objective: { type: "string" },
    classification: { type: "string" },
    scope: { type: "string" },
    contextSummary: { type: "string" },
    successMeasure: { type: "string" },
    expectedDurationSeconds: { type: "integer", minimum: 1 },
    hardTimeoutSeconds: { type: "integer", minimum: 1 },
    deliveryRequired: { type: "boolean" },
    shapeOverrides: { type: "object" },
    executorOverride: { type: "string" },
  },
};

const TicketShowSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    ticketId: { type: "string" },
  },
};

const TicketListSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    currentSessionOnly: { type: "boolean" },
  },
};

const TicketUpdateSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    ticketId: { type: "string" },
    note: { type: "string" },
    status: { type: "string" },
    deliveryState: { type: "string" },
  },
};

const TicketCloseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["outcome", "summary"],
  properties: {
    ticketId: { type: "string" },
    outcome: { type: "string", enum: ["succeeded", "failed", "timed_out", "cancelled"] },
    summary: { type: "string" },
    deliveryVerified: { type: "boolean" },
  },
};

const EmptySchema = {
  type: "object",
  additionalProperties: false,
  properties: {},
};

function textResult(text) {
  return { content: [{ type: "text", text }] };
}

function registerFirstSupportedHook(api, names, handler) {
  const candidates = Array.isArray(names) ? names : [names];
  for (const hookName of candidates) {
    try {
      api.on(hookName, handler);
      api.logger.info?.(`registered hook ${hookName}`);
      return hookName;
    } catch (error) {
      api.logger.debug?.(`hook ${hookName} unavailable: ${String(error)}`);
    }
  }
  api.logger.warn?.(`unable to register hooks: ${candidates.join(", ")}`);
  return null;
}

function normalizeHookEvent(rawEvent = {}) {
  if (!rawEvent || typeof rawEvent !== "object") return {};
  return {
    ...rawEvent,
    toolName: normalizeToolName(rawEvent.toolName || rawEvent.name || rawEvent.tool || ""),
    params: rawEvent.params || rawEvent.arguments || rawEvent.input || {},
    result: rawEvent.result || rawEvent.output,
    error: rawEvent.error || rawEvent.failure || null,
    toolCallId: rawEvent.toolCallId || rawEvent.callId,
    runId: rawEvent.runId || rawEvent.traceId,
  };
}

function resolveTicketOrThrow(stateDir, sessionKey, ticketId) {
  if (ticketId) {
    const explicit = getTicket(stateDir, ticketId);
    if (!explicit) throw new Error(`ticket not found: ${ticketId}`);
    return explicit;
  }
  const active = findActiveTicket(stateDir, sessionKey);
  if (!active) throw new Error("no active ticket in this session");
  return active;
}

function policyBlockReason() {
  return [
    "Governed work requires an active ticket.",
    "Open one with ticket_open first, then continue using ticket_update and ticket_close as evidence accumulates.",
  ].join(" ");
}

function unclassifiedBlockReason() {
  return [
    "Governed work requires a bounded-classification ticket.",
    "Run ticket_classify or open the ticket with task text so the plugin can derive task shape, class, and executor rationale.",
  ].join(" ");
}

function overdueBlockReason(ticket) {
  return `Active ticket ${ticket.ticketId} is past hard timeout ${ticket.hardTimeoutAt}. Reconcile or close it before more governed work.`;
}

function buildClassificationFromParams(params) {
  const taskText = String(params.task ?? "").trim() || [params.objective, params.scope].filter(Boolean).join(". ");
  if (!taskText.trim()) return null;
  const classification = classifyTask(taskText, {
    shapeOverrides: parseShapeOverrides(params.shapeOverrides || {}),
    executorOverride: params.executorOverride,
  });
  if (params.classification && params.classification !== classification.classification) {
    throw new Error(
      `explicit classification ${params.classification} conflicts with bounded classification ${classification.classification}`,
    );
  }
  return classification;
}

export default definePluginEntry({
  id: "mission-control-runtime",
  name: "Mission Control Runtime",
  description: "Portable ticketed control-plane bundle for non-trivial OpenClaw work.",
  register(api) {
    const policy = resolvePluginPolicy(api.pluginConfig ?? {});
    const stateDir = api.runtime.state.resolveStateDir();
    const pluginDir = api.rootDir ?? PLUGIN_DIR;

    api.registerCli(
      ({ program }) => {
        registerTicketsCli({
          program,
          runtime: api.runtime,
          config: api.config,
          pluginDir,
          policy,
        });
      },
      {
        descriptors: [
          {
            name: "tickets",
            description: "Ticket control-plane, audit, classification, and workspace bootstrap",
            hasSubcommands: true,
          },
        ],
      },
    );

    api.registerTool(
      () => ({
        name: "ticket_classify",
        description: "Run the bounded classifier to derive task shape, class, executor preference, and anti-pattern warnings.",
        parameters: TicketClassifySchema,
        async execute(_id, params) {
          const result = classifyTask(params.task, {
            shapeOverrides: params.shapeOverrides || {},
            executorOverride: params.executorOverride,
          });
          return textResult(JSON.stringify(result, null, 2));
        },
      }),
      { names: ["ticket_classify"] },
    );

    api.registerTool(
      (ctx) => ({
        name: "ticket_open",
        description: "Open a bounded-classification control-plane ticket for governed or non-trivial work in this session.",
        parameters: TicketOpenSchema,
        async execute(_id, params) {
          const classificationData = buildClassificationFromParams(params);
          const objective = params.objective || params.task;
          const classification = params.classification || classificationData?.classification;
          const scope = params.scope || params.task || classificationData?.summary;
          if (!objective || !classification || !scope) {
            throw new Error("ticket_open requires task text or the explicit trio objective/classification/scope");
          }
          const ticket = openTicket(
            stateDir,
            {
              sessionKey: ctx.sessionKey ?? "unknown-session",
              sessionId: ctx.sessionId,
              agentId: ctx.agentId,
              objective,
              classification,
              scope,
              taskText: params.task,
              contextSummary: params.contextSummary,
              successMeasure: params.successMeasure,
              expectedDurationSeconds: params.expectedDurationSeconds,
              hardTimeoutSeconds: params.hardTimeoutSeconds,
              deliveryRequired: params.deliveryRequired === true,
              classificationData,
            },
            { singleActiveTicketPerSession: policy.singleActiveTicketPerSession },
          );
          return textResult(formatTicketText(ticket));
        },
      }),
      { names: ["ticket_open"] },
    );

    api.registerTool(
      (ctx) => ({
        name: "ticket_show",
        description: "Show the active ticket in this session or a specific ticket by id.",
        parameters: TicketShowSchema,
        async execute(_id, params) {
          const ticket = resolveTicketOrThrow(stateDir, ctx.sessionKey ?? "", params.ticketId);
          return textResult(formatTicketText(ticket));
        },
      }),
      { names: ["ticket_show"] },
    );

    api.registerTool(
      (ctx) => ({
        name: "ticket_list",
        description: "List current tickets, optionally filtered to the current session.",
        parameters: TicketListSchema,
        async execute(_id, params) {
          const tickets = listTickets(stateDir, params.currentSessionOnly ? { sessionKey: ctx.sessionKey ?? "" } : {});
          const lines = tickets.length
            ? tickets.map((ticket) => JSON.stringify(summarizeTicket(ticket)))
            : ["no tickets"];
          return textResult(lines.join("\n"));
        },
      }),
      { names: ["ticket_list"] },
    );

    api.registerTool(
      (ctx) => ({
        name: "ticket_update",
        description: "Add a note to a ticket, change its status, or update delivery state.",
        parameters: TicketUpdateSchema,
        async execute(_id, params) {
          const ticket = resolveTicketOrThrow(stateDir, ctx.sessionKey ?? "", params.ticketId);
          let current = ticket;
          if (!params.note && !params.status && !params.deliveryState) {
            throw new Error("ticket_update requires note, status, or deliveryState");
          }
          if (params.note) current = recordTicketNote(stateDir, current.ticketId, params.note);
          if (params.status) current = setTicketStatus(stateDir, current.ticketId, params.status, `status changed to ${params.status}`);
          if (params.deliveryState) current = setDeliveryState(stateDir, current.ticketId, params.deliveryState, `delivery state changed to ${params.deliveryState}`);
          return textResult(formatTicketText(current));
        },
      }),
      { names: ["ticket_update"] },
    );

    api.registerTool(
      (ctx) => ({
        name: "ticket_close",
        description: "Close a ticket with a terminal outcome after evidence exists.",
        parameters: TicketCloseSchema,
        async execute(_id, params) {
          const ticket = resolveTicketOrThrow(stateDir, ctx.sessionKey ?? "", params.ticketId);
          const closed = closeTicket(stateDir, ticket.ticketId, params.outcome, params.summary, {
            deliveryVerified: params.deliveryVerified === true,
          });
          return textResult(formatTicketText(closed));
        },
      }),
      { names: ["ticket_close"] },
    );

    api.registerTool(
      () => ({
        name: "ticket_audit",
        description: "Audit tickets for overdue, delivery-pending, or unclassified work.",
        parameters: EmptySchema,
        async execute() {
          return textResult(renderAudit(auditTickets(stateDir)));
        },
      }),
      { names: ["ticket_audit"] },
    );

    api.registerTool(
      () => ({
        name: "ticket_bootstrap_workspace",
        description: "Apply Mission Control Runtime docs and managed workspace overlay blocks.",
        parameters: EmptySchema,
        async execute() {
          const workspaceDir = api.runtime.agent.resolveAgentWorkspaceDir(api.config);
          const result = applyWorkspaceBootstrap({
            workspaceDir,
            pluginDir,
            bootstrapPolicy: policy.bootstrap,
          });
          return textResult(JSON.stringify(result, null, 2));
        },
      }),
      { names: ["ticket_bootstrap_workspace"] },
    );

    if (policy.injectPromptGuidance) {
      registerFirstSupportedHook(api, ["before_prompt_build", "prompt:before_build", "before_prompt"], async () => ({
        prependSystemContext: buildPromptGuidance(),
      }));
    }

    const beforeToolGuard = async (event, ctx) => {
      const normalized = normalizeHookEvent(event);
      if (!normalized.toolName) return;
      const sessionKey = ctx?.sessionKey ?? ctx?.session?.key ?? "";
      if (!toolRequiresTicket(normalized.toolName, normalized.params, policy)) return;
      const active = findActiveTicket(stateDir, sessionKey);
      if (!active) {
        api.logger.info?.(`blocked governed tool without ticket: ${normalized.toolName} session=${sessionKey}`);
        return { block: true, blockReason: policyBlockReason() };
      }
      if (policy.requireBoundedClassification && !active.classificationData) {
        return { block: true, blockReason: unclassifiedBlockReason() };
      }
      if (ACTIVE_STATUSES.has(active.status) && Date.parse(active.hardTimeoutAt) <= Date.now()) {
        return { block: true, blockReason: overdueBlockReason(active) };
      }
      return;
    };
    registerFirstSupportedHook(api, ["before_tool_call", "tool:before_call", "before_tool_execute"], beforeToolGuard);

    const afterToolAudit = async (event, ctx) => {
      const normalized = normalizeHookEvent(event);
      if (!normalized.toolName) return;
      if (!toolRequiresTicket(normalized.toolName, normalized.params, policy)) return;
      const sessionKey = ctx?.sessionKey ?? ctx?.session?.key ?? "";
      const updated = recordGovernedToolCall(stateDir, sessionKey, {
        toolName: normalized.toolName,
        toolCallId: normalized.toolCallId,
        runId: normalized.runId,
        params: normalized.params,
        result: normalized.result,
        error: normalized.error,
      });
      if (updated) {
        api.logger.info?.(`recorded governed tool call on ${updated.ticketId}: ${normalized.toolName}`);
      }
    };
    registerFirstSupportedHook(api, ["after_tool_call", "tool:after_call", "after_tool_execute"], afterToolAudit);
  },
});
