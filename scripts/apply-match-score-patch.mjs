import fs from "node:fs";

const path = "src/lib/recommendation/engine.ts";
let source = fs.readFileSync(path, "utf8");
const before = `  return selected;\n}`;
const after = `  // Displayed confidence must not contradict the ranked order. The underlying\n  // raw score remains available for analysis; this only calibrates the user-facing\n  // percentage so a lower-ranked recommendation cannot claim higher confidence.\n  for (let index = 1; index < selected.length; index += 1) {\n    selected[index].matchScore = Math.min(selected[index].matchScore, selected[index - 1].matchScore);\n  }\n\n  return selected;\n}`;
const count = source.split(before).length - 1;
if (count !== 1) throw new Error(`match-score patch: expected exactly one return block, found ${count}`);
source = source.replace(before, after);
fs.writeFileSync(path, source);
console.log("Applied monotonic match-score patch to", path);
