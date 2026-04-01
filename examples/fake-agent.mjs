import fs from "node:fs/promises";
import path from "node:path";

const workspace = process.env.VCM_WORKSPACE;
const attempt = Number(process.env.VCM_ATTEMPT ?? "1");
const promptFile = process.env.VCM_PROMPT_FILE;

if (!workspace || !promptFile) {
  console.error("VCM_WORKSPACE and VCM_PROMPT_FILE are required.");
  process.exit(1);
}

const outputFile = path.join(workspace, "deliverable.txt");
const prompt = await fs.readFile(promptFile, "utf8");

if (attempt === 1) {
  await fs.writeFile(
    outputFile,
    `Attempt 1 partial output.\n\nPrompt excerpt:\n${prompt.slice(0, 120)}\n`,
    "utf8",
  );
  console.log("Created an initial draft deliverable.");
  process.exit(0);
}

await fs.writeFile(
  outputFile,
  "Final deliverable.\n\nThe autonomous loop persisted until completion.\n",
  "utf8",
);
console.log("Deliverable completed.");

