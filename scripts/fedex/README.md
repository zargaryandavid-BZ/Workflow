# FedEx sandbox sample labels

Generates **sandbox** shipping labels through the same Ship API client the app uses in production (`lib/fedex.ts` → `POST /ship/v1/shipments`). Use these files for FedEx production Label Validation (`label@fedex.com` / Bar Code Analysis).

This script **always** calls `https://apis-sandbox.fedex.com`. It never uses `apis.fedex.com`.

## Run

From the repo root, with sandbox credentials in `.env.local` or the environment:

```bash
npx tsx --import ./scripts/fedex/register-server-only.mjs scripts/fedex/generate-sample-labels.ts
```

Or:

```bash
npm run fedex:sample-labels
```

Output (gitignored):

- `fedex-samples/label-<SERVICE>.pdf` (or `.png` / `.zpl`)
- `fedex-samples/label-<SERVICE>-pkgN.*` when `FEDEX_PACKAGES` > 1
- `fedex-samples/response-<SERVICE>.json` — full API JSON (success or failure)

On any service failure the process exits **non-zero** and prints the path to that service’s `response-*.json`. The secret is never logged.

## FedEx Developer Portal → Test Key tab

| Env var | Portal field |
| --- | --- |
| `FEDEX_API_TEST_KEY` (or `FEDEX_TEST_API_KEY`) | Test **API Key** |
| `FEDEX_TEST_SECRET_KEY` | Test **Secret Key** |
| `FEDEX_TEST_ACCOUNT_NUMBER` | Test **account number** (pinned to the project) |

If those are unset, the script falls back to `FEDEX_API_KEY` / `FEDEX_SECRET_KEY` / `FEDEX_ACCOUNT_NUMBER` — those must be **test** keys, not production. You can keep production keys in the unprefixed vars for the app.

Also set shipper contact (required by Ship API):

| Env var | Notes |
| --- | --- |
| `FEDEX_SHIPPER_CONTACT_NAME` | From address contact |
| `FEDEX_SHIPPER_PHONE` | 10+ digit US phone |
| `FEDEX_SHIPPER_STREET` / `_CITY` / `_STATE` / `_ZIP` / `_COUNTRY` | Defaults match Settings → Shipping env fallbacks (LA warehouse) |

`FEDEX_SANDBOX` is ignored: this script forces sandbox even if that flag is `false`.

## Label format (match the FedEx Label Cover Sheet)

| Env var | Default | Values |
| --- | --- | --- |
| `FEDEX_IMAGE_TYPE` | `PDF` | `PDF` (laser), `PNG` (laser), `ZPLII` (thermal) |
| `FEDEX_LABEL_STOCK` | `STOCK_4X6` | e.g. `STOCK_4X6`, `PAPER_4X6` |
| `FEDEX_SERVICES` | `FEDEX_GROUND,FEDEX_EXPRESS_SAVER` | Comma-separated Ship `serviceType` codes |
| `FEDEX_PACKAGES` | `1` | Piece count (one label file per package) |

Production labels in the app currently request `PDF` + `PAPER_4X6`. For validation samples that must match live output:

```bash
FEDEX_IMAGE_TYPE=PDF FEDEX_LABEL_STOCK=PAPER_4X6 npm run fedex:sample-labels
```

Thermal / 4×6 stock samples (script defaults):

```bash
FEDEX_IMAGE_TYPE=ZPLII FEDEX_LABEL_STOCK=STOCK_4X6 npm run fedex:sample-labels
```

## Recipient and international

Domestic US defaults are a Memphis test address (edit in the script or override with env):

`FEDEX_RECIPIENT_NAME`, `FEDEX_RECIPIENT_PHONE`, `FEDEX_RECIPIENT_STREET`, `FEDEX_RECIPIENT_CITY`, `FEDEX_RECIPIENT_STATE`, `FEDEX_RECIPIENT_ZIP`, `FEDEX_RECIPIENT_COUNTRY`.

For `INTERNATIONAL_ECONOMY` / `INTERNATIONAL_PRIORITY`, set a non-US recipient (`FEDEX_RECIPIENT_COUNTRY` and a valid foreign postal code). The Ship client does not add customs documents; international sandbox calls may still fail until commercial-invoice fields are added.

## Troubleshooting

**`Live credentials not allowed in this environment`** — the keys in `.env.local` are **production** keys. This script only talks to sandbox. Use the project’s **Test Key** tab (`API Key`, `Secret Key`, test account number).

**`FORBIDDEN.ERROR`** — enable the **Ship API** on the FedEx project and pin the same test account number.

## Multi-piece

```bash
FEDEX_PACKAGES=2 npm run fedex:sample-labels
```
