const DANGEROUS_EXEC_REGEX = /\b(reboot|shutdown|poweroff|halt|systemctl|service|mount|umount|netplan|ifconfig|ip\s+link|iptables|ufw|passwd|useradd|userdel|groupadd|groupdel|chown|chmod|mkfs|fdisk|parted|docker|kubectl|rm\s+-rf|openclaw\s+gateway\s+(restart|stop|start))\b/i;
const TOOL_ALIASES = new Map([
  ["sessions.spawn", "sessions_spawn"],
  ["session_spawn", "sessions_spawn"],
  ["scheduler_run", "cron"],
  ["tasks_spawn", "sessions_spawn"],
  ["host_exec", "exec"],
  ["command_exec", "exec"],
]);

function truthyFlag(value) {
  if (value === true) return true;
  if (typeof value === "string") {
    const lowered = value.trim().toLowerCase();
    return lowered === "true" || lowered === "1" || lowered === "yes";
  }
  return false;
}

function firstDefined(params, keys, fallback) {
  for (const key of keys) {
    if (params?.[key] !== undefined && params?.[key] !== null) return params[key];
  }
  return fallback;
}

export function normalizeToolName(toolName) {
  const normalized = String(toolName ?? "").trim();
  return TOOL_ALIASES.get(normalized) || normalized;
}

export function resolvePluginPolicy(pluginConfig = {}) {
  const configuredTools = Array.isArray(pluginConfig.governedTools)
    ? pluginConfig.governedTools.filter((value) => typeof value === "string" && value.trim())
    : ["cron", "sessions_spawn"];
  const governedTools = Array.from(new Set(configuredTools.map((tool) => normalizeToolName(tool))));
  return {
    governedTools,
    execPolicy: {
      governBackground: pluginConfig.execPolicy?.governBackground !== false,
      governElevated: pluginConfig.execPolicy?.governElevated !== false,
      governPty: pluginConfig.execPolicy?.governPty !== false,
      governTimeoutOverSeconds: Number.isFinite(pluginConfig.execPolicy?.governTimeoutOverSeconds)
        ? Number(pluginConfig.execPolicy.governTimeoutOverSeconds)
        : 60,
      governDangerousCommands: pluginConfig.execPolicy?.governDangerousCommands !== false,
    },
    singleActiveTicketPerSession: pluginConfig.singleActiveTicketPerSession !== false,
    requireBoundedClassification: pluginConfig.requireBoundedClassification !== false,
    injectPromptGuidance: pluginConfig.injectPromptGuidance !== false,
    bootstrap: {
      manageAgentsBlock: pluginConfig.bootstrap?.manageAgentsBlock !== false,
      manageHeartbeatBlock: pluginConfig.bootstrap?.manageHeartbeatBlock !== false,
      installDocs: pluginConfig.bootstrap?.installDocs !== false,
    },
  };
}

export function toolRequiresTicket(toolName, params = {}, policy = resolvePluginPolicy()) {
  const normalizedToolName = normalizeToolName(toolName);
  if (normalizedToolName.startsWith("ticket_")) return false;
  if (policy.governedTools.includes(normalizedToolName)) return true;
  if (normalizedToolName !== "exec") return false;

  if (policy.execPolicy.governBackground && truthyFlag(firstDefined(params, ["background", "isBackground", "detach"], false))) return true;
  if (policy.execPolicy.governElevated && truthyFlag(firstDefined(params, ["elevated", "sudo", "runAsRoot"], false))) return true;
  if (policy.execPolicy.governPty && truthyFlag(firstDefined(params, ["pty", "interactiveTty", "tty"], false))) return true;

  const timeoutRaw = firstDefined(params, ["timeout", "timeoutSeconds", "timeoutMs"], 0);
  let timeout = Number(timeoutRaw);
  if (params?.timeoutMs !== undefined && params?.timeoutMs !== null) timeout = timeout / 1000;
  if (Number.isFinite(timeout) && timeout > policy.execPolicy.governTimeoutOverSeconds) return true;

  const command = String(firstDefined(params, ["command", "cmd", "shellCommand"], ""));
  if (policy.execPolicy.governDangerousCommands && DANGEROUS_EXEC_REGEX.test(command)) return true;

  return false;
}

export function buildPromptGuidance() {
  return [
    "Mission Control Runtime is active.",
    "Before governed work, classify the task with ticket_classify and open a classified ticket with ticket_open.",
    "Governed work includes cron/scheduler runs, session spawn calls, and exec calls that are backgrounded, elevated, PTY-driven, long-running, or operationally risky.",
    "Use one active ticket per mission, record progress with ticket_update, and close it with ticket_close only after evidence exists.",
    "For operational cutovers, installs, restarts, and other self-disruptive changes: do not surface intermediate shell friction as progress.",
    "Drive the task to verified completion internally and reply only with DONE plus evidence or BLOCKED plus the exact blocker.",
  ].join(" ");
}
