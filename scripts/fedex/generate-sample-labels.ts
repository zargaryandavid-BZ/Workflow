/**
 * Generate FedEx sandbox sample labels via the same Ship API client used in production.
 *
 * Usage:
 *   npx tsx scripts/fedex/generate-sample-labels.ts
 *
 * Always hits https://apis-sandbox.fedex.com (never production).
 * See scripts/fedex/README.md for env vars.
 */

import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Module } from "node:module";

function loadEnvLocal() {
  try {
    const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  } catch {
    // .env.local optional when vars are already in the environment
  }
}

loadEnvLocal();

// Allow importing Next.js `server-only` modules from this Node script.
const originalLoad = (Module as unknown as { _load: Function })._load;
(Module as unknown as { _load: Function })._load = function (
  request: string,
  parent: unknown,
  isMain: boolean
) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
};

type LabelImageType = "PDF" | "PNG" | "ZPLII";

const OUTPUT_DIR = resolve(process.cwd(), "fedex-samples");

/** Edit these if you are not using FEDEX_SHIPPER_CONTACT_NAME / FEDEX_SHIPPER_PHONE. */
const DEFAULT_SHIPPER_CONTACT = {
  name: "Sample Shipper",
  phone: "2135550100",
};

/** Edit these if you are not using FEDEX_RECIPIENT_* env vars. */
const DEFAULT_RECIPIENT = {
  name: "Jane Recipient",
  phone: "9015551234",
  street: "3600 Hacks Cross Rd",
  city: "Memphis",
  state: "TN",
  zip: "38125",
  country: "US",
};

const DEFAULT_BOX = {
  length: 10,
  width: 8,
  height: 4,
  weight: 2,
  dimUnit: "in" as const,
  weightUnit: "lbs" as const,
};

function parseImageType(raw: string | undefined): LabelImageType {
  const value = (raw ?? "PDF").trim().toUpperCase();
  if (value === "PDF" || value === "PNG" || value === "ZPLII") return value;
  throw new Error(
    `Invalid FEDEX_IMAGE_TYPE="${raw}". Use PDF, PNG, or ZPLII.`
  );
}

function extensionFor(imageType: LabelImageType): string {
  if (imageType === "PNG") return "png";
  if (imageType === "ZPLII") return "zpl";
  return "pdf";
}

function fileSafeService(service: string): string {
  return service.replace(/[^A-Za-z0-9_-]+/g, "_");
}

async function main() {
  const { requestFedExShipment } = await import("../../lib/fedex");
  const { resolveFedExConfig } = await import("../../lib/shipping-settings");

  const imageType = parseImageType(process.env.FEDEX_IMAGE_TYPE);
  const labelStock = (process.env.FEDEX_LABEL_STOCK ?? "STOCK_4X6").trim();
  const services = (process.env.FEDEX_SERVICES ?? "FEDEX_GROUND,FEDEX_EXPRESS_SAVER")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const packageCount = Math.max(
    1,
    Number.parseInt(process.env.FEDEX_PACKAGES ?? "1", 10) || 1
  );

  if (services.length === 0) {
    throw new Error("FEDEX_SERVICES is empty.");
  }

  const envConfig = resolveFedExConfig(null);
  const testApiKey =
    process.env.FEDEX_API_TEST_KEY?.trim() ||
    process.env.FEDEX_TEST_API_KEY?.trim() ||
    null;
  const testSecret =
    process.env.FEDEX_TEST_SECRET_KEY?.trim() ||
    process.env.FEDEX_SECRET_TEST_KEY?.trim() ||
    null;
  const testAccount =
    process.env.FEDEX_TEST_ACCOUNT_NUMBER?.trim() || null;

  const config = {
    ...envConfig,
    sandbox: true,
    apiKey: testApiKey || envConfig.apiKey,
    secretKey: testSecret || envConfig.secretKey,
    accountNumber: testAccount || envConfig.accountNumber,
  };

  if (!config.apiKey || !config.secretKey || !config.accountNumber) {
    throw new Error(
      "Missing sandbox credentials. Set FEDEX_API_TEST_KEY / FEDEX_TEST_SECRET_KEY / FEDEX_TEST_ACCOUNT_NUMBER (or FEDEX_API_KEY / FEDEX_SECRET_KEY / FEDEX_ACCOUNT_NUMBER from the Test Key tab)."
    );
  }

  const shipperName =
    config.shipperContactName?.trim() || DEFAULT_SHIPPER_CONTACT.name;
  const shipperPhone =
    config.shipperPhone?.trim() || DEFAULT_SHIPPER_CONTACT.phone;

  const recipient = {
    name: process.env.FEDEX_RECIPIENT_NAME?.trim() || DEFAULT_RECIPIENT.name,
    phone: process.env.FEDEX_RECIPIENT_PHONE?.trim() || DEFAULT_RECIPIENT.phone,
    street: process.env.FEDEX_RECIPIENT_STREET?.trim() || DEFAULT_RECIPIENT.street,
    city: process.env.FEDEX_RECIPIENT_CITY?.trim() || DEFAULT_RECIPIENT.city,
    state: (process.env.FEDEX_RECIPIENT_STATE?.trim() || DEFAULT_RECIPIENT.state).toUpperCase(),
    zip: process.env.FEDEX_RECIPIENT_ZIP?.trim() || DEFAULT_RECIPIENT.zip,
    country: (process.env.FEDEX_RECIPIENT_COUNTRY?.trim() || DEFAULT_RECIPIENT.country).toUpperCase(),
  };

  const boxes = Array.from({ length: packageCount }, () => ({ ...DEFAULT_BOX }));
  const ext = extensionFor(imageType);

  mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log(
    [
      "FedEx sandbox sample labels",
      `  host:     apis-sandbox.fedex.com (forced)`,
      `  creds:    ${testApiKey ? "FEDEX_API_TEST_KEY" : "FEDEX_API_KEY"} / ${testAccount ? "FEDEX_TEST_ACCOUNT_NUMBER" : "FEDEX_ACCOUNT_NUMBER"}`,
      `  account:  ****${config.accountNumber.slice(-4)}`,
      `  shipper:  ${config.shipper.street}, ${config.shipper.city}, ${config.shipper.state} ${config.shipper.zip}`,
      `  recipient:${recipient.street}, ${recipient.city}, ${recipient.state} ${recipient.zip} ${recipient.country}`,
      `  services: ${services.join(", ")}`,
      `  packages: ${packageCount}`,
      `  image:    ${imageType}`,
      `  stock:    ${labelStock}`,
      `  out:      ${OUTPUT_DIR}`,
    ].join("\n")
  );

  let failed = 0;

  for (const serviceType of services) {
    const safe = fileSafeService(serviceType);
    const responsePath = resolve(OUTPUT_DIR, `response-${safe}.json`);

    try {
      const result = await requestFedExShipment({
        config,
        serviceType,
        boxes,
        deliveryAddress: {
          name: recipient.name,
          phone: recipient.phone,
          street: recipient.street,
          city: recipient.city,
          state: recipient.state,
          zip: recipient.zip,
          country: recipient.country,
          residential: true,
          usingOwnBox: true,
        },
        shipperContact: {
          personName: shipperName,
          phoneNumber: shipperPhone,
          companyName: process.env.FEDEX_SHIPPER_COMPANY?.trim() || null,
        },
        recipientContact: {
          personName: recipient.name,
          phoneNumber: recipient.phone,
        },
        labelSpecification: {
          imageType,
          labelStockType: labelStock,
        },
      });

      writeFileSync(responsePath, JSON.stringify(result.json, null, 2));

      if (!result.ok) {
        failed += 1;
        console.error(
          `✗ ${serviceType}  HTTP ${result.httpStatus}  ${result.errorMessage ?? "failed"}`
        );
        console.error(`  see ${responsePath}`);
        continue;
      }

      if (result.labels.length === 1) {
        const labelPath = resolve(OUTPUT_DIR, `label-${safe}.${ext}`);
        writeFileSync(labelPath, result.labels[0]!);
        console.log(
          `✓ ${serviceType}  tracking ${result.trackingNumber}  ${labelPath}`
        );
      } else {
        result.labels.forEach((buf, i) => {
          const labelPath = resolve(
            OUTPUT_DIR,
            `label-${safe}-pkg${i + 1}.${ext}`
          );
          writeFileSync(labelPath, buf);
        });
        console.log(
          `✓ ${serviceType}  tracking ${result.trackingNumber}  ${result.labels.length} packages`
        );
      }
    } catch (err) {
      failed += 1;
      const message = err instanceof Error ? err.message : String(err);
      writeFileSync(
        responsePath,
        JSON.stringify({ scriptError: message }, null, 2)
      );
      console.error(`✗ ${serviceType}  ${message}`);
      console.error(`  see ${responsePath}`);
    }
  }

  if (failed > 0) {
    console.error(
      `\n${failed} service(s) failed. Inspect response-*.json under ${OUTPUT_DIR}.`
    );
    process.exit(1);
  }

  console.log("\nAll sample labels generated.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
