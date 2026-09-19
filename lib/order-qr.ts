import QRCode from "qrcode";

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

export function orderNumberQrPayload(orderNumber: string): string | null {
  const payload = orderNumber.trim();
  return payload || null;
}

/** PNG QR of the printed order number. Null when there is nothing to encode. */
export async function orderNumberQrPng(
  orderNumber: string
): Promise<Buffer | null> {
  const payload = orderNumberQrPayload(orderNumber);
  if (!payload) return null;
  try {
    return await QRCode.toBuffer(payload, {
      type: "png",
      errorCorrectionLevel: "H",
      margin: 1,
      width: 256,
      color: { dark: "#000000", light: "#ffffff" },
    });
  } catch {
    return null;
  }
}

export function isPngBuffer(buf: Buffer): boolean {
  return buf.length >= 4 && buf.subarray(0, 4).equals(PNG_MAGIC);
}
