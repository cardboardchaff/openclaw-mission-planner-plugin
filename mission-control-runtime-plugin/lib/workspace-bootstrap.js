import fs from "node:fs";
import path from "node:path";

const AGENTS_MARKER_START = "<!-- mission-control-runtime:agents:start -->";
const AGENTS_MARKER_END = "<!-- mission-control-runtime:agents:end -->";
const HEARTBEAT_MARKER_START = "<!-- mission-control-runtime:heartbeat:start -->";
const HEARTBEAT_MARKER_END = "<!-- mission-control-runtime:heartbeat:end -->";

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readText(filePath) {
  if (!fs.existsSync(filePath)) return "";
  return fs.readFileSync(filePath, "utf8");
}

function writeText(filePath, text) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, text, "utf8");
}

function upsertManagedBlock(filePath, startMarker, endMarker, blockText) {
  const current = readText(filePath);
  const block = `${startMarker}\n${blockText.trim()}\n${endMarker}`;
  if (!current.trim()) {
    writeText(filePath, block + "\n");
    return;
  }
  if (current.includes(startMarker) && current.includes(endMarker)) {
    const pattern = new RegExp(`${escapeRegExp(startMarker)}[\\s\\S]*?${escapeRegExp(endMarker)}`);
    writeText(filePath, current.replace(pattern, block));
    return;
  }
  const next = current.endsWith("\n") ? `${current}\n${block}\n` : `${current}\n\n${block}\n`;
  writeText(filePath, next);
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function applyWorkspaceBootstrap({ workspaceDir, pluginDir, bootstrapPolicy }) {
  const result = {
    workspaceDir,
    wroteDocs: false,
    managedAgentsBlock: false,
    managedHeartbeatBlock: false,
    files: [],
  };

  if (bootstrapPolicy.installDocs) {
    const sourceDoc = path.join(pluginDir, "workspace", "docs", "mission-control-runtime.md");
    const destDoc = path.join(workspaceDir, "docs", "mission-control-runtime.md");
    ensureDir(path.dirname(destDoc));
    fs.copyFileSync(sourceDoc, destDoc);
    result.wroteDocs = true;
    result.files.push(destDoc);
  }

  if (bootstrapPolicy.manageAgentsBlock) {
    const agentsPath = path.join(workspaceDir, "AGENTS.md");
    upsertManagedBlock(
      agentsPath,
      AGENTS_MARKER_START,
      AGENTS_MARKER_END,
      [
        "## Mission Control Runtime",
        "",
        "- Use ticket_open before governed work.",
        "- Governed work includes cron, sessions_spawn, and exec calls that are backgrounded, elevated, PTY-driven, long-running, or operationally risky.",
        "- Maintain one active ticket per mission unless you deliberately split work.",
        "- Do not call governed work complete until the ticket contains evidence and, when required, verified delivery.",
        "- Use `openclaw tickets audit` during operational review and heartbeat-style maintenance.",
      ].join("\n"),
    );
    result.managedAgentsBlock = true;
    result.files.push(agentsPath);
  }

  if (bootstrapPolicy.manageHeartbeatBlock) {
    const heartbeatPath = path.join(workspaceDir, "HEARTBEAT.md");
    upsertManagedBlock(
      heartbeatPath,
      HEARTBEAT_MARKER_START,
      HEARTBEAT_MARKER_END,
      [
        "## Mission Control Runtime",
        "",
        "Run `openclaw tickets heartbeat-audit`.",
        "- If it reports `HEARTBEAT_OK`, continue normally.",
        "- If it reports findings, surface only actionable task or ticket issues.",
        "- For each issue, include the lookup, current state, why it is at risk, and the next intervention action.",
      ].join("\n"),
    );
    result.managedHeartbeatBlock = true;
    result.files.push(heartbeatPath);
  }

  const markerPath = path.join(workspaceDir, ".mission-control-runtime.json");
  writeText(markerPath, JSON.stringify({ installedAt: new Date().toISOString() }, null, 2) + "\n");
  result.files.push(markerPath);
  return result;
}
