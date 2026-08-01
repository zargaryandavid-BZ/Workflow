/**
 * One-off: send the Google-review feedback SMS sample.
 * Usage: npx tsx scripts/send-test-feedback-sms.ts <phone> [orderNumber]
 */
import { readFileSync } from "fs";
import { Module } from "module";

function loadEnvLocal() {
  try {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (m) {
        process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    // ignore
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

  const phone = process.argv[2]?.trim();
  const orderNumber = process.argv[3]?.trim() || "ORD:451";
  if (!phone) {
    console.error(
      "Usage: npx tsx scripts/send-test-feedback-sms.ts <phone> [orderNumber]"
    );
    process.exit(1);
  }

  const { normalizeFeedbackSmsText } = await import(
    "../lib/notification-messages"
  );
  const { sendSms, normalizeSmsPhone, validateSmsRecipient } = await import(
    "../lib/sms"
  );

  // Legacy rule SMS body (what used to send as-is) — now normalized.
  const rawBody = `Thank you for choosing BazaarPrinting! We hope we exceeded your expectations. Your feedback helps us grow. We'd love your review: https://g.page/r/CX6v8SiBU70cEBM/review`;

  const body = normalizeFeedbackSmsText(rawBody, orderNumber);

  const validationError = validateSmsRecipient(phone);
  if (validationError) {
    console.error(validationError);
    process.exit(1);
  }

  const to = normalizeSmsPhone(phone);

  console.log(`Sending feedback SMS to ${to}…`);
  console.log("---");
  console.log(body);
  console.log("---");

  const result = await sendSms({ to, body });
  if (!result.sent) {
    console.error("Failed:", result.error ?? "Unknown error");
    process.exit(1);
  }

  console.log("SMS sent successfully.", result.sid ? `sid=${result.sid}` : "");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
