/**
 * One-off: send the Google-review feedback email sample.
 * Usage: npx tsx scripts/send-test-feedback-email.ts <toEmail>
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

  const to = process.argv[2]?.trim();
  const orderNumber = process.argv[3]?.trim() || "Davit Box";
  if (!to) {
    console.error(
      "Usage: npx tsx scripts/send-test-feedback-email.ts <toEmail> [orderNumber]"
    );
    process.exit(1);
  }

  if (!process.env.INSTANTLY_API_KEY?.trim() || !process.env.INSTANTLY_FROM_EMAIL?.trim()) {
    console.error("Missing INSTANTLY_API_KEY or INSTANTLY_FROM_EMAIL in .env.local");
    process.exit(1);
  }

  const {
    buildNotificationRuleEmailHtml,
    normalizeFeedbackEmailPlainText,
    normalizeFeedbackEmailSubject,
  } = await import("../lib/notification-messages");
  const { sendTransactionalEmail } = await import("../lib/email");

  const rawBody = `Thank you for choosing BazaarPrinting! We hope we exceeded your expectations.

Your feedback helps us grow. We'd love your review: https://g.page/r/CX6v8SiBU70cEBM/review`;

  const subject = normalizeFeedbackEmailSubject(
    "Your feedback helps us grow- BazaarPrinting",
    orderNumber
  );
  const text = normalizeFeedbackEmailPlainText(rawBody);
  const html = buildNotificationRuleEmailHtml(rawBody, orderNumber);

  console.log(`Sending "${subject}" to ${to} from ${process.env.INSTANTLY_FROM_EMAIL}…`);

  const result = await sendTransactionalEmail({ to, subject, html, text });
  if (!result.sent) {
    console.error("Failed:", result.error ?? "Unknown error");
    process.exit(1);
  }

  console.log("Email sent successfully.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
