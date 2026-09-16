/**
 * One-off Gmail send test.
 *   npx tsx --import ./scripts/fedex/register-server-only.mjs scripts/send-test-gmail.ts zargaryandavid@yahoo.com
 */
import { readFileSync } from "node:fs";
import { Module } from "node:module";

function loadEnvLocal() {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    const key = m[1].trim();
    if (process.env[key] !== undefined) continue;
    process.env[key] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const originalLoad = (Module as unknown as { _load: Function })._load;
(Module as unknown as { _load: Function })._load = function (
  request: string,
  parent: unknown,
  isMain: boolean
) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
};

async function main() {
  loadEnvLocal();
  const to = (process.argv[2] ?? "zargaryandavid@yahoo.com").trim();
  const { isGmailSendConfigured, gmailFromHeader } = await import(
    "../lib/gmail-send.ts"
  );
  const { sendTransactionalEmail } = await import("../lib/email.ts");

  console.log(`gmail_configured ${isGmailSendConfigured()}`);
  console.log(`from ${gmailFromHeader()}`);
  console.log(`to ${to}`);

  const result = await sendTransactionalEmail({
    to,
    subject: "Workflow test: noreply@bazaarprinting.com",
    html: "<p>This is a test from Workflow Gmail API.</p><p>If you received this, send-from noreply is working.</p>",
    text: "This is a test from Workflow Gmail API. If you received this, send-from noreply is working.",
  });
  if (!result.sent) {
    console.error("Failed:", result.error ?? "Unknown error");
    process.exit(1);
  }
  console.log("Sent.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
