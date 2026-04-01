import fs from "node:fs/promises";

const packetFile = process.env.VCM_AUDIT_PACKET_FILE;

if (!packetFile) {
  console.error("VCM_AUDIT_PACKET_FILE is required.");
  process.exit(1);
}

const packet = JSON.parse(await fs.readFile(packetFile, "utf8"));
const deliverableExists = packet.requiredFiles.every((entry) => entry.exists);
const failedVerification = packet.verificationResults.some((entry) => entry.exitCode !== 0);

if (packet.attempt >= 2 && deliverableExists && !failedVerification) {
  console.log(
    JSON.stringify({
      decision: "complete",
      summary: "Required file exists and verification passed.",
    }),
  );
  process.exit(0);
}

console.log(
  JSON.stringify({
    decision: "continue",
    summary: "The result is not complete yet.",
    nextPrompt: "Finish the deliverable and make the verification command pass.",
  }),
);

