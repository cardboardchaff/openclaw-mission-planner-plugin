import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classifyTask } from "../lib/classifier.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cases = JSON.parse(fs.readFileSync(path.join(ROOT, "lib", "classification-cases.json"), "utf8"));

const failures = [];
for (const item of cases) {
  const result = classifyTask(item.task, { executorOverride: item.expectedExecutor });
  if (result.classification !== item.expectedClassification) {
    failures.push(`${item.name}: expected classification ${item.expectedClassification} got ${result.classification}`);
  }
  if (result.executorRecommendation.chosen !== item.expectedExecutor) {
    failures.push(`${item.name}: expected executor ${item.expectedExecutor} got ${result.executorRecommendation.chosen}`);
  }
  for (const forbidden of item.forbiddenExecutors || []) {
    if (result.executorRecommendation.chosen === forbidden) {
      failures.push(`${item.name}: forbidden executor chosen ${forbidden}`);
    }
  }
}

if (failures.length) {
  console.error(JSON.stringify({ ok: false, failures }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, total: cases.length }, null, 2));
