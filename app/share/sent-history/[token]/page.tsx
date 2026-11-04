import type { Metadata } from "next";
import { SentHistoryPanel } from "@/components/fulfillment/ScanDeliveryHistory";
import { verifySentHistoryShareToken } from "@/lib/sent-history-share";
import { sentHistoryShareSecret } from "@/lib/sent-history-share.server";

export const metadata: Metadata = {
  title: "Sent history",
  robots: { index: false, follow: false },
};

/** Public, read-only Sent history opened from a share link. */
export default async function SharedSentHistoryPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const valid = Boolean(
    verifySentHistoryShareToken(token, sentHistoryShareSecret())
  );
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 sm:py-10">
      <div className="mx-auto w-full max-w-4xl rounded-xl border border-slate-200 bg-white shadow-sm">
        <h1 className="border-b border-slate-200 px-4 py-4 text-lg font-semibold text-slate-900 sm:px-6">
          Sent history
        </h1>
        {valid ? (
          <SentHistoryPanel
            apiUrl={`/api/public/share/sent-history/${encodeURIComponent(token)}`}
          />
        ) : (
          <p className="px-6 py-16 text-center text-sm text-slate-500">
            This link is invalid or has expired. Ask for a new share link.
          </p>
        )}
      </div>
    </main>
  );
}
