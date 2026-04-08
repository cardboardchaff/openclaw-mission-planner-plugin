export const CLASSIFICATION_VERSION = 1;

export const CLASSIFICATIONS = [
  "inline-trivial",
  "deterministic-host-op",
  "bounded-agentic",
  "scheduled-local",
  "external-workflow",
  "continuous-capability",
];

export const EXECUTORS = [
  "inline",
  "bounded-command",
  "local-script",
  "cron",
  "systemd-timer",
  "workflow-engine",
  "container",
  "service",
  "subagent",
  "task-flow",
];

const KEYWORDS = {
  recurring: ["every ", "hourly", "daily", "weekly", "recurring", "on a schedule", "periodic", "cron", "monitor", "watch", "whenever", "every time"],
  residentCapability: ["watch", "monitor", "daemon", "service", "continuously", "always", "keep watching", "every time", "listen", "background worker"],
  stateful: ["hasn't been seen before", "first seen", "seen before", "keep state", "remember", "history", "track devices", "state file", "dedupe", "only once"],
  restartDurable: ["persist", "survive reboot", "always", "unattended", "keep running", "restart", "durable", "service", "container"],
  latencyHigh: ["immediately", "instantly", "real time", "realtime", "as soon as", "every time"],
  latencyMedium: ["soon", "quickly", "near real time", "watch"],
  hostLocal: ["local network", "lan", "this machine", "host", "local device", "nas", "filesystem", "network share", "docker", "container", "service"],
  externalIntegrations: ["message me", "telegram", "slack", "discord", "email", "webhook", "api", "notify", "post to"],
  packagedDependencies: ["container", "docker", "python", "dependencies", "library", "scanner", "worker"],
  agenticReasoning: ["research", "investigate", "compare", "brainstorm", "review", "plan options", "analyze code", "summarize repo", "figure out"],
  externalWorkflow: ["n8n", "zapier", "make.com", "workflow", "callback", "human in the loop", "approval queue"],
  destructive: ["delete", "destroy", "wipe", "reformat", "drop", "shutdown", "reboot", "remove"],
};

function asText(value) {
  return String(value ?? "").trim();
}

function containsAny(text, patterns) {
  return patterns.some((pattern) => text.includes(pattern));
}

function normalizeBool(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;
  const text = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "y"].includes(text)) return true;
  if (["false", "0", "no", "n"].includes(text)) return false;
  return fallback;
}

function normalizeLatency(value) {
  const text = asText(value).toLowerCase();
  if (["low", "medium", "high"].includes(text)) return text;
  return null;
}

export function parseShapeOverrides(input) {
  if (!input) return {};
  if (typeof input === "string") {
    const parsed = JSON.parse(input);
    return parseShapeOverrides(parsed);
  }
  if (typeof input !== "object") throw new Error("shape overrides must be an object");
  const overrides = {};
  for (const key of [
    "deterministic",
    "residentCapability",
    "recurring",
    "stateful",
    "restartDurable",
    "hostLocal",
    "externalIntegrations",
    "packagedDependencies",
    "agenticReasoning",
    "destructive",
    "externalWorkflowCandidate",
  ]) {
    if (input[key] !== undefined) overrides[key] = normalizeBool(input[key]);
  }
  if (input.latencySensitivity !== undefined) {
    const latency = normalizeLatency(input.latencySensitivity);
    if (!latency) throw new Error("latencySensitivity must be low, medium, or high");
    overrides.latencySensitivity = latency;
  }
  return overrides;
}

export function deriveTaskShape(taskText, overrides = {}) {
  const text = asText(taskText).toLowerCase();
  if (!text) throw new Error("task text is required for classification");
  const evidence = [];
  const shape = {
    deterministic: true,
    residentCapability: false,
    recurring: false,
    stateful: false,
    restartDurable: false,
    latencySensitivity: "low",
    hostLocal: false,
    externalIntegrations: false,
    packagedDependencies: false,
    agenticReasoning: false,
    destructive: false,
    externalWorkflowCandidate: false,
  };

  function setBool(key, patterns) {
    if (containsAny(text, patterns)) {
      shape[key] = true;
      evidence.push(`${key}<=keyword`);
    }
  }

  setBool("recurring", KEYWORDS.recurring);
  setBool("residentCapability", KEYWORDS.residentCapability);
  setBool("stateful", KEYWORDS.stateful);
  setBool("restartDurable", KEYWORDS.restartDurable);
  setBool("hostLocal", KEYWORDS.hostLocal);
  setBool("externalIntegrations", KEYWORDS.externalIntegrations);
  setBool("packagedDependencies", KEYWORDS.packagedDependencies);
  setBool("agenticReasoning", KEYWORDS.agenticReasoning);
  setBool("externalWorkflowCandidate", KEYWORDS.externalWorkflow);
  setBool("destructive", KEYWORDS.destructive);

  if (containsAny(text, KEYWORDS.latencyHigh)) {
    shape.latencySensitivity = "high";
    evidence.push("latencySensitivity<=high-keyword");
  } else if (containsAny(text, KEYWORDS.latencyMedium)) {
    shape.latencySensitivity = "medium";
    evidence.push("latencySensitivity<=medium-keyword");
  }

  if (shape.agenticReasoning) {
    shape.deterministic = false;
    evidence.push("deterministic<=false(agenticReasoning)");
  }

  for (const [key, value] of Object.entries(overrides || {})) {
    if (value === undefined || value === null) continue;
    shape[key] = value;
    evidence.push(`${key}<=override`);
  }

  if (shape.residentCapability && shape.recurring) {
    shape.restartDurable = shape.restartDurable || true;
  }
  if (shape.residentCapability && shape.stateful) {
    shape.packagedDependencies = shape.packagedDependencies || true;
  }

  return { shape, evidence };
}

function classifyFromShape(shape) {
  if (!shape.deterministic || shape.agenticReasoning) {
    return "bounded-agentic";
  }
  if (shape.externalWorkflowCandidate && shape.externalIntegrations && !shape.hostLocal) {
    return "external-workflow";
  }
  if (shape.residentCapability || (shape.recurring && shape.stateful && shape.restartDurable)) {
    return "continuous-capability";
  }
  if (shape.recurring) {
    return "scheduled-local";
  }
  return "deterministic-host-op";
}

function executorPlanForClass(classification) {
  switch (classification) {
    case "continuous-capability":
      return {
        preferred: ["container", "service"],
        rejected: {
          cron: "weaker fit for resident monitoring or stateful ongoing capability",
          subagent: "no reasoning benefit for deterministic persistent work",
          "bounded-command": "not durable enough for continuous capability",
        },
      };
    case "scheduled-local":
      return {
        preferred: ["cron", "systemd-timer"],
        rejected: {
          container: "not the default unless the task behaves like a resident capability or needs packaged runtime state",
          subagent: "no reasoning benefit for deterministic scheduled execution",
        },
      };
    case "bounded-agentic":
      return {
        preferred: ["subagent", "task-flow"],
        rejected: {
          cron: "not suitable for exploratory or reasoning-heavy work",
          container: "not the default for bounded research/coding/synthesis work",
        },
      };
    case "external-workflow":
      return {
        preferred: ["workflow-engine", "task-flow"],
        rejected: {
          cron: "insufficient for branching integration-heavy workflows",
          subagent: "not the default for deterministic external automation routing",
        },
      };
    case "deterministic-host-op":
    default:
      return {
        preferred: ["local-script", "bounded-command"],
        rejected: {
          subagent: "no reasoning benefit for deterministic host work",
          cron: "not required unless the task is actually scheduled or recurring",
        },
      };
  }
}

function antiPatternWarnings(shape, classification, chosenExecutor) {
  const warnings = [];
  if (classification === "continuous-capability" && chosenExecutor === "cron") {
    warnings.push("continuous-capability should not default to cron");
  }
  if (shape.deterministic && !shape.agenticReasoning && chosenExecutor === "subagent") {
    warnings.push("deterministic non-agentic work should not default to a subagent");
  }
  if (shape.restartDurable && chosenExecutor === "bounded-command") {
    warnings.push("restart-durable work should not rely on a bounded foreground command");
  }
  return warnings;
}

export function classifyTask(taskText, options = {}) {
  const overrides = parseShapeOverrides(options.shapeOverrides || {});
  const { shape, evidence } = deriveTaskShape(taskText, overrides);
  const classification = classifyFromShape(shape);
  const executorPlan = executorPlanForClass(classification);
  const chosenExecutor = asText(options.executorOverride) || executorPlan.preferred[0];
  const warnings = antiPatternWarnings(shape, classification, chosenExecutor);
  const confidence =
    classification === "continuous-capability" && shape.residentCapability ? "high"
      : classification === "scheduled-local" && shape.recurring ? "high"
      : classification === "bounded-agentic" && shape.agenticReasoning ? "high"
      : warnings.length ? "low"
      : "medium";

  return {
    version: CLASSIFICATION_VERSION,
    taskText: asText(taskText),
    taskShape: shape,
    evidence,
    classification,
    executorRecommendation: {
      chosen: chosenExecutor,
      preferred: executorPlan.preferred,
      rejectedAlternatives: executorPlan.rejected,
    },
    antiPatternWarnings: warnings,
    confidence,
    summary: classificationSummary(classification, chosenExecutor, shape),
  };
}

export function classificationSummary(classification, chosenExecutor, shape) {
  switch (classification) {
    case "continuous-capability":
      return `continuous-capability -> ${chosenExecutor}; resident=${shape.residentCapability} stateful=${shape.stateful} restartDurable=${shape.restartDurable}`;
    case "scheduled-local":
      return `scheduled-local -> ${chosenExecutor}; recurring=${shape.recurring} resident=${shape.residentCapability}`;
    case "bounded-agentic":
      return `bounded-agentic -> ${chosenExecutor}; deterministic=${shape.deterministic} agentic=${shape.agenticReasoning}`;
    case "external-workflow":
      return `external-workflow -> ${chosenExecutor}; externalIntegrations=${shape.externalIntegrations}`;
    default:
      return `deterministic-host-op -> ${chosenExecutor}; hostLocal=${shape.hostLocal}`;
  }
}
