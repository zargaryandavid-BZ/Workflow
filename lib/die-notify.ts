import { sendTransactionalEmail } from "@/lib/email";
import {
  dieManufacturerContacts,
  isValidEmail,
  mapDieManufacturerRow,
  type DieManufacturer,
} from "@/lib/die-manufacturers";
import { sendSms, validateSmsRecipient } from "@/lib/sms";

export async function notifyDieManufacturer(params: {
  manufacturer: DieManufacturer | Record<string, unknown>;
  email: {
    subject: string;
    html: (contactName: string | null) => string;
    text: (contactName: string | null) => string;
  };
  smsBody: string;
}): Promise<{ warning: string | null }> {
  const mfg =
    "full_name" in params.manufacturer && "email" in params.manufacturer
      ? (params.manufacturer as DieManufacturer)
      : mapDieManufacturerRow(params.manufacturer as Record<string, unknown>);
  const contacts = dieManufacturerContacts(mfg);
  const warnings: string[] = [];
  const tasks: Promise<void>[] = [];
  const emailed = new Set<string>();
  const texted = new Set<string>();

  for (const contact of contacts) {
    if (contact.email && isValidEmail(contact.email)) {
      const to = contact.email;
      if (!emailed.has(to)) {
        emailed.add(to);
        const name = contact.name;
        tasks.push(
          sendTransactionalEmail({
            to,
            subject: params.email.subject,
            html: params.email.html(name),
            text: params.email.text(name),
          }).then((result) => {
            if (!result.sent) {
              warnings.push(
                `Email to ${to} failed: ${result.error ?? "unknown"}`
              );
            }
          })
        );
      }
    }
    if (contact.phone) {
      const invalid = validateSmsRecipient(contact.phone);
      if (invalid) {
        warnings.push(`SMS skipped — ${invalid} (${contact.phone})`);
        continue;
      }
      if (!texted.has(contact.phone)) {
        texted.add(contact.phone);
        const to = contact.phone;
        tasks.push(
          sendSms({ to, body: params.smsBody }).then((result) => {
            if (!result.sent) {
              warnings.push(`SMS to ${to} failed: ${result.error ?? "unknown"}`);
            }
          })
        );
      }
    }
  }

  if (tasks.length === 0) {
    return { warning: "No manufacturer email or phone to send to." };
  }

  await Promise.all(tasks);
  return { warning: warnings.length ? warnings.join(" ") : null };
}
