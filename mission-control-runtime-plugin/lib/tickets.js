import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const TICKET_VERSION = 1;
export const ACTIVE_STATUSES = new Set(["open", "active", "waiting"]);
export const TERMINAL_STATUSES = new Set(["succeeded", "failed", "timed_out", "cancelled"]);
export const ALLOWED_STATUSES = new Set([...ACTIVE_STATUSES, ...TERMINAL_STATUSES]);
export const ALLOWED_DELIVERY_STATES = new Set(["not_required", "pending", "in_progress", "verified", "blocked"]);

function isoNow() {
  return new Date().toISOString();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function ticketRoot(stateDir) {
  return path.join(stateDir, "mission-control-runtime");
}

function ticketsPath(stateDir) {
  return path.join(ticketRoot(stateDir), "tickets.json");
}

function lockPath(stateDir) {
  return path.join(ticketRoot(stateDir), "tickets.lock");
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function atomicWriteJson(filePath, payload) {
  ensureDir(path.dirname(filePath));
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
  fs.renameSync(tmpPath, filePath);
}

function defaultStore() {
  return {
    version: TICKET_VERSION,
    updatedAt: isoNow(),
    tickets: [],
  };
}

function withStoreLock(stateDir, callback, options = {}) {
  const timeoutMs = Number(options.timeoutMs ?? 2000);
  const retryDelayMs = Number(options.retryDelayMs ?? 25);
  const staleAfterMs = Number(options.staleAfterMs ?? 15000);
  const maxAttempts = Math.max(1, Math.ceil(timeoutMs / retryDelayMs));
  const ticketLockPath = lockPath(stateDir);
  ensureDir(path.dirname(ticketLockPath));

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      fs.writeFileSync(ticketLockPath, String(process.pid), { encoding: "utf8", flag: "wx" });
      try {
        return callback();
      } finally {
        fs.unlinkSync(ticketLockPath);
      }
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      try {
        const stat = fs.statSync(ticketLockPath);
        const ageMs = Date.now() - stat.mtimeMs;
        if (ageMs > staleAfterMs) {
          fs.unlinkSync(ticketLockPath);
          continue;
        }
      } catch (statError) {
        if (statError?.code !== "ENOENT") throw statError;
      }
      const waitUntil = Date.now() + retryDelayMs;
      while (Date.now() < waitUntil) {
        // busy-wait for a very short delay to avoid extra dependencies in sync code paths
      }
    }
  }
  throw new Error(`ticket store lock timeout after ${timeoutMs}ms: ${ticketLockPath}`);
}

function backupCorruptStore(filePath, rawText) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${filePath}.corrupt-${stamp}`;
  fs.writeFileSync(backupPath, rawText, "utf8");
  return backupPath;
}

function sanitizeStore(parsed) {
  if (!parsed || typeof parsed !== "object") return defaultStore();
  if (!Array.isArray(parsed.tickets)) parsed.tickets = [];
  return parsed;
}

export function resolveTicketStatePaths(stateDir) {
  return {
    root: ticketRoot(stateDir),
    ticketsFile: ticketsPath(stateDir),
  };
}

export function loadStore(stateDir) {
  const filePath = ticketsPath(stateDir);
  if (!fs.existsSync(filePath)) return defaultStore();
  const raw = fs.readFileSync(filePath, "utf8");
  try {
    const parsed = JSON.parse(raw);
    return sanitizeStore(parsed);
  } catch {
    backupCorruptStore(filePath, raw);
    const fallback = defaultStore();
    atomicWriteJson(filePath, fallback);
    return fallback;
  }
}

export function saveStore(stateDir, store) {
  const nextStore = clone(store);
  nextStore.version = TICKET_VERSION;
  nextStore.updatedAt = isoNow();
  atomicWriteJson(ticketsPath(stateDir), nextStore);
  return nextStore;
}

export function createTicketId() {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `ticket-${stamp}-${crypto.randomUUID().slice(0, 8)}`;
}

function requireText(value, field) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`missing required field: ${field}`);
  return text;
}

function toPositiveInt(value, field) {
  const numeric = Number.parseInt(String(value), 10);
  if (!Number.isFinite(numeric) || numeric < 1) {
    throw new Error(`${field} must be an integer >= 1`);
  }
  return numeric;
}

function withEvent(ticket, kind, summary, data = undefined) {
  const event = {
    at: isoNow(),
    kind,
    summary,
  };
  if (data !== undefined) event.data = data;
  ticket.timeline.push(event);
  ticket.updatedAt = event.at;
  return ticket;
}

function summarizeResult(result) {
  if (result === undefined || result === null) return null;
  try {
    const text = typeof result === "string" ? result : JSON.stringify(result);
    return text.length > 4000 ? `${text.slice(0, 4000)}…` : text;
  } catch {
    return String(result);
  }
}

function findTicketIndex(store, ticketId) {
  return store.tickets.findIndex((ticket) => ticket.ticketId === ticketId);
}

function findActiveTicketInStore(store, sessionKey) {
  const tickets = [...store.tickets]
    .filter((ticket) => ticket.sessionKey === sessionKey && ACTIVE_STATUSES.has(ticket.status))
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  if (tickets.length === 0) return null;
  return tickets[tickets.length - 1];
}

function requireStatus(value, field) {
  const status = requireText(value, field);
  if (!ALLOWED_STATUSES.has(status)) {
    throw new Error(`invalid ${field}: ${status}. allowed=${Array.from(ALLOWED_STATUSES).join(",")}`);
  }
  return status;
}

function requireDeliveryState(value, field) {
  const deliveryState = requireText(value, field);
  if (!ALLOWED_DELIVERY_STATES.has(deliveryState)) {
    throw new Error(`invalid ${field}: ${deliveryState}. allowed=${Array.from(ALLOWED_DELIVERY_STATES).join(",")}`);
  }
  return deliveryState;
}

export function listTickets(stateDir, filters = {}) {
  const store = loadStore(stateDir);
  let tickets = [...store.tickets];
  if (filters.sessionKey) {
    tickets = tickets.filter((ticket) => ticket.sessionKey === filters.sessionKey);
  }
  if (filters.status) {
    const wanted = Array.isArray(filters.status) ? new Set(filters.status) : new Set([filters.status]);
    tickets = tickets.filter((ticket) => wanted.has(ticket.status));
  }
  return tickets.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

export function getTicket(stateDir, ticketId) {
  const store = loadStore(stateDir);
  return store.tickets.find((ticket) => ticket.ticketId === ticketId) ?? null;
}

export function findActiveTicket(stateDir, sessionKey) {
  const tickets = listTickets(stateDir, { sessionKey });
  const active = tickets.filter((ticket) => ACTIVE_STATUSES.has(ticket.status));
  if (active.length === 0) return null;
  return active[active.length - 1];
}

export function openTicket(stateDir, input, options = {}) {
  return withStoreLock(stateDir, () => {
    const store = loadStore(stateDir);
    const sessionKey = requireText(input.sessionKey, "sessionKey");
    if (options.singleActiveTicketPerSession !== false) {
      const existing = findActiveTicketInStore(store, sessionKey);
      if (existing) {
        throw new Error(`session already has active ticket ${existing.ticketId}`);
      }
    }
    const createdAt = isoNow();
    const expectedDurationSeconds = toPositiveInt(input.expectedDurationSeconds, "expectedDurationSeconds");
    const hardTimeoutSeconds = toPositiveInt(input.hardTimeoutSeconds, "hardTimeoutSeconds");
    if (hardTimeoutSeconds < expectedDurationSeconds) {
      throw new Error("hardTimeoutSeconds must be >= expectedDurationSeconds");
    }
    const hardTimeoutAt = new Date(Date.now() + hardTimeoutSeconds * 1000).toISOString();
    const ticket = {
      version: TICKET_VERSION,
      ticketId: createTicketId(),
      createdAt,
      updatedAt: createdAt,
      sessionKey,
      sessionId: String(input.sessionId ?? "").trim() || null,
      agentId: String(input.agentId ?? "").trim() || null,
      channel: String(input.channel ?? "").trim() || null,
      target: String(input.target ?? "").trim() || null,
      objective: requireText(input.objective, "objective"),
      classification: requireText(input.classification, "classification"),
      scope: requireText(input.scope, "scope"),
      taskText: String(input.taskText ?? "").trim() || null,
      contextSummary: String(input.contextSummary ?? "").trim() || null,
      successMeasure: requireText(input.successMeasure, "successMeasure"),
      expectedDurationSeconds,
      hardTimeoutSeconds,
      hardTimeoutAt,
      deliveryRequired: Boolean(input.deliveryRequired),
      deliveryState: input.deliveryRequired ? "pending" : "not_required",
      classificationData: input.classificationData ?? null,
      status: "open",
      timeline: [],
      governedToolCalls: 0,
      lastToolName: null,
    };
    withEvent(ticket, "opened", `ticket opened: ${ticket.objective}`, {
      classification: ticket.classification,
      scope: ticket.scope,
      executor: ticket.classificationData?.executorRecommendation?.chosen ?? null,
    });
    store.tickets.push(ticket);
    saveStore(stateDir, store);
    return ticket;
  });
}

export function updateTicket(stateDir, ticketId, mutation) {
  return withStoreLock(stateDir, () => {
    const store = loadStore(stateDir);
    const index = findTicketIndex(store, ticketId);
    if (index < 0) throw new Error(`ticket not found: ${ticketId}`);
    const ticket = store.tickets[index];
    const next = mutation(clone(ticket));
    next.updatedAt = isoNow();
    store.tickets[index] = next;
    saveStore(stateDir, store);
    return next;
  });
}

export function recordTicketNote(stateDir, ticketId, summary, data = undefined) {
  return updateTicket(stateDir, ticketId, (ticket) => withEvent(ticket, "note", requireText(summary, "summary"), data));
}

export function setTicketStatus(stateDir, ticketId, status, summary, data = undefined) {
  const wanted = requireStatus(status, "status");
  return updateTicket(stateDir, ticketId, (ticket) => {
    ticket.status = wanted;
    withEvent(ticket, "status", requireText(summary, "summary"), data);
    return ticket;
  });
}

export function setDeliveryState(stateDir, ticketId, deliveryState, summary) {
  const wanted = requireDeliveryState(deliveryState, "deliveryState");
  return updateTicket(stateDir, ticketId, (ticket) => {
    ticket.deliveryState = wanted;
    withEvent(ticket, "delivery", requireText(summary, "summary"), { deliveryState: wanted });
    return ticket;
  });
}

export function closeTicket(stateDir, ticketId, outcome, summary, options = {}) {
  const terminal = requireText(outcome, "outcome");
  if (!TERMINAL_STATUSES.has(terminal)) {
    throw new Error(`invalid terminal outcome: ${terminal}`);
  }
  return updateTicket(stateDir, ticketId, (ticket) => {
    ticket.status = terminal;
    if (ticket.deliveryRequired && options.deliveryVerified === true) {
      ticket.deliveryState = "verified";
    }
    withEvent(ticket, "closed", requireText(summary, "summary"), {
      outcome: terminal,
      deliveryState: ticket.deliveryState,
    });
    return ticket;
  });
}

export function recordGovernedToolCall(stateDir, sessionKey, event) {
  const active = findActiveTicket(stateDir, sessionKey);
  if (!active) return null;
  const ticketId = active.ticketId;
  return updateTicket(stateDir, ticketId, (ticket) => {
    if (ticket.status === "open") ticket.status = "active";
    ticket.governedToolCalls += 1;
    ticket.lastToolName = event.toolName;
    withEvent(ticket, "tool_call", `${event.toolName} ${event.error ? "failed" : "completed"}`, {
      toolName: event.toolName,
      toolCallId: event.toolCallId ?? null,
      runId: event.runId ?? null,
      params: event.params ?? {},
      error: event.error ?? null,
      result: summarizeResult(event.result),
    });
    return ticket;
  });
}

export function summarizeTicket(ticket) {
  return {
    ticketId: ticket.ticketId,
    objective: ticket.objective,
    classification: ticket.classification,
    executor: ticket.classificationData?.executorRecommendation?.chosen ?? null,
    confidence: ticket.classificationData?.confidence ?? null,
    status: ticket.status,
    sessionKey: ticket.sessionKey,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
    hardTimeoutAt: ticket.hardTimeoutAt,
    deliveryState: ticket.deliveryState,
    governedToolCalls: ticket.governedToolCalls,
    lastToolName: ticket.lastToolName,
  };
}

export function auditTickets(stateDir) {
  const tickets = listTickets(stateDir);
  const findings = [];
  const bySession = new Map();
  const now = Date.now();
  for (const ticket of tickets) {
    if (!bySession.has(ticket.sessionKey)) bySession.set(ticket.sessionKey, []);
    bySession.get(ticket.sessionKey).push(ticket);
    if (ACTIVE_STATUSES.has(ticket.status) && Date.parse(ticket.hardTimeoutAt) <= now) {
      findings.push({
        code: "ticket_overdue",
        severity: "warn",
        ticketId: ticket.ticketId,
        status: ticket.status,
        detail: `hard timeout passed at ${ticket.hardTimeoutAt}`,
      });
    }
    if (ACTIVE_STATUSES.has(ticket.status) && !ticket.classificationData) {
      findings.push({
        code: "unclassified_ticket",
        severity: "warn",
        ticketId: ticket.ticketId,
        status: ticket.status,
        detail: "ticket has no bounded classification data recorded",
      });
    }
    if (TERMINAL_STATUSES.has(ticket.status) && ticket.deliveryRequired && ticket.deliveryState !== "verified") {
      findings.push({
        code: "delivery_pending",
        severity: "warn",
        ticketId: ticket.ticketId,
        status: ticket.status,
        detail: `deliveryRequired=true but deliveryState=${ticket.deliveryState}`,
      });
    }
  }
  for (const [sessionKey, sessionTickets] of bySession.entries()) {
    const active = sessionTickets.filter((ticket) => ACTIVE_STATUSES.has(ticket.status));
    if (active.length > 1) {
      findings.push({
        code: "conflicting_active_tickets",
        severity: "warn",
        ticketId: active.map((ticket) => ticket.ticketId).join(","),
        status: "active",
        detail: `session ${sessionKey} has ${active.length} active tickets`,
      });
    }
  }
  return findings;
}

export function renderAudit(findings) {
  if (!findings.length) return "TICKET_AUDIT_OK";
  const lines = ["BACKGROUND_TICKET_AUDIT"];
  for (const finding of findings) {
    lines.push(`- ticket: ${finding.ticketId}`);
    lines.push(`  code: ${finding.code}`);
    lines.push(`  state: ${finding.status}`);
    lines.push(`  why: ${finding.detail}`);
    lines.push("  next: inspect the ticket, decide whether to close, update, or relaunch with a stronger executor");
  }
  return lines.join("\n");
}

export function formatTicketText(ticket) {
  const lines = [
    `ticketId: ${ticket.ticketId}`,
    `status: ${ticket.status}`,
    `objective: ${ticket.objective}`,
      `classification: ${ticket.classification}`,
    `executor: ${ticket.classificationData?.executorRecommendation?.chosen ?? "unknown"}`,
    `confidence: ${ticket.classificationData?.confidence ?? "unknown"}`,
    `scope: ${ticket.scope}`,
    `successMeasure: ${ticket.successMeasure}`,
    `sessionKey: ${ticket.sessionKey}`,
    `hardTimeoutAt: ${ticket.hardTimeoutAt}`,
    `deliveryState: ${ticket.deliveryState}`,
    `governedToolCalls: ${ticket.governedToolCalls}`,
  ];
  if (ticket.contextSummary) lines.push(`contextSummary: ${ticket.contextSummary}`);
  if (ticket.taskText) lines.push(`taskText: ${ticket.taskText}`);
  if (ticket.classificationData?.summary) lines.push(`classificationSummary: ${ticket.classificationData.summary}`);
  if (ticket.classificationData?.antiPatternWarnings?.length) {
    lines.push(`antiPatternWarnings: ${ticket.classificationData.antiPatternWarnings.join(" | ")}`);
  }
  lines.push("timeline:");
  for (const event of ticket.timeline.slice(-12)) {
    lines.push(`- ${event.at} ${event.kind}: ${event.summary}`);
  }
  return lines.join("\n");
}
