/**
 * One-off FedEx rate quote (residential + own box + LIST preference).
 * Usage: node scripts/quote-fedex-rates.mjs [street] [city] [state] [zip]
 */
import { readFileSync } from "node:fs";

function loadEnv() {
  const envText = readFileSync(".env.local", "utf8");
  for (const line of envText.split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (process.env[m[1]] == null) process.env[m[1]] = v;
  }
}

loadEnv();

const street = process.argv[2] ?? "84-575 Kili Dr, apt 37";
const city = process.argv[3] ?? "Waianae";
const state = (process.argv[4] ?? "HI").toUpperCase();
const zip = process.argv[5] ?? "96792";

const apiKey = process.env.FEDEX_API_KEY?.trim();
const secretKey = process.env.FEDEX_SECRET_KEY?.trim();
const accountNumber = process.env.FEDEX_ACCOUNT_NUMBER?.trim();
const sandbox = process.env.FEDEX_SANDBOX !== "false";
const baseUrl = sandbox
  ? "https://apis-sandbox.fedex.com"
  : "https://apis.fedex.com";

const shipper = {
  streetLines: [process.env.FEDEX_SHIPPER_STREET?.trim() || "306 Boyd St"],
  city: process.env.FEDEX_SHIPPER_CITY?.trim() || "Los Angeles",
  stateOrProvinceCode: process.env.FEDEX_SHIPPER_STATE?.trim() || "CA",
  postalCode: process.env.FEDEX_SHIPPER_ZIP?.trim() || "90013",
  countryCode: process.env.FEDEX_SHIPPER_COUNTRY?.trim() || "US",
};

const MARKUP_PERCENT = 10;

function money(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  return `$${n.toFixed(2)}`;
}

function applyPercent(base, pct) {
  return Math.round((base + (base * pct) / 100) * 100) / 100;
}

function pickListDetail(details) {
  if (!details?.length) return undefined;
  const list = details.find((d) => {
    const t = `${d.rateType ?? ""} ${d.actualRateType ?? ""}`.toUpperCase();
    return t.includes("LIST");
  });
  return list ?? details[0];
}

function parseCharge(raw) {
  if (raw == null) return null;
  const n = typeof raw === "number" ? raw : Number.parseFloat(String(raw));
  return Number.isFinite(n) ? n : null;
}

async function getToken() {
  const res = await fetch(`${baseUrl}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: apiKey,
      client_secret: secretKey,
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    throw new Error(json.errors?.[0]?.message ?? "OAuth failed");
  }
  return json.access_token;
}

async function quote() {
  if (!apiKey || !secretKey || !accountNumber) {
    throw new Error("Missing FEDEX_API_KEY / SECRET / ACCOUNT_NUMBER");
  }

  console.log(
    JSON.stringify(
      {
        sandbox,
        baseUrl,
        shipper,
        destination: { street, city, state, zip },
        box: "14x14x14 in / 40 lbs",
        options: {
          residential: true,
          packagingType: "YOUR_PACKAGING",
          ratePreference: "LIST",
        },
        clientPrice: `FedEx LIST + ${MARKUP_PERCENT}%`,
      },
      null,
      2
    )
  );

  const token = await getToken();
  const payload = {
    accountNumber: { value: accountNumber },
    requestedShipment: {
      shipper: { address: shipper },
      recipient: {
        address: {
          streetLines: [street],
          city,
          stateOrProvinceCode: state,
          postalCode: zip,
          countryCode: "US",
          residential: true,
        },
      },
      pickupType: "DROPOFF_AT_FEDEX_LOCATION",
      packagingType: "YOUR_PACKAGING",
      rateRequestType: ["LIST", "ACCOUNT"],
      requestedPackageLineItems: [
        {
          sequenceNumber: 1,
          weight: { units: "LB", value: 40 },
          dimensions: {
            length: 14,
            width: 14,
            height: 14,
            units: "IN",
          },
        },
      ],
    },
  };

  const ratesRes = await fetch(`${baseUrl}/rate/v1/rates/quotes`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  const ratesData = await ratesRes.json().catch(() => ({}));
  if (!ratesRes.ok) {
    throw new Error(
      ratesData.errors?.[0]?.message ??
        `Rate request failed (${ratesRes.status})`
    );
  }

  const rows = (ratesData.output?.rateReplyDetails ?? [])
    .map((r) => {
      const detail = pickListDetail(r.ratedShipmentDetails);
      const account = r.ratedShipmentDetails?.find((d) =>
        `${d.rateType ?? ""}`.toUpperCase().includes("ACCOUNT")
      );
      const listCharge = parseCharge(detail?.totalNetCharge);
      const accountCharge = parseCharge(account?.totalNetCharge);
      const usedType = `${detail?.rateType ?? detail?.actualRateType ?? "?"}`;
      return {
        service: r.serviceName ?? r.serviceType,
        rateTypeUsed: usedType,
        listOrPicked: listCharge,
        account: accountCharge,
        clientPlus10:
          listCharge == null ? null : applyPercent(listCharge, MARKUP_PERCENT),
        delivery:
          r.operationalDetail?.deliveryDate ??
          r.commit?.dateDetail?.dayFormat ??
          r.operationalDetail?.transitTime ??
          "",
      };
    })
    .sort(
      (a, b) => (a.clientPlus10 ?? 1e9) - (b.clientPlus10 ?? 1e9)
    );

  console.log("\nResults:");
  for (const row of rows) {
    console.log(
      [
        row.service.padEnd(32),
        `API ${money(row.listOrPicked)}`.padEnd(14),
        `+10% ${money(row.clientPlus10)}`.padEnd(14),
        `acct ${money(row.account)}`.padEnd(14),
        row.rateTypeUsed,
        row.delivery,
      ].join("  ")
    );
  }
  return rows;
}

quote().catch((err) => {
  console.error("Quote failed:", err.message ?? err);
  process.exit(1);
});
