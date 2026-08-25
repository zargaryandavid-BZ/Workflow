import { Printer } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { DieQuoteForm } from "@/components/die/die-quote-form";
import { parseDieRequestFiles, type DieRequestFile } from "@/lib/die-request";
import {
  PORTAL_FOOTER,
  PORTAL_PRODUCT_NAME,
} from "@/lib/portal-branding";

export const metadata = { title: "Die request" };

function Shell({
  title,
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <header className="border-b border-slate-200 bg-white px-4 py-3">
        <div className="mx-auto flex max-w-lg items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#2563EB] text-white">
            <Printer className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-800">
              {PORTAL_PRODUCT_NAME}
            </p>
            {title ? (
              <p className="truncate text-xs text-slate-500">{title}</p>
            ) : null}
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-lg flex-1 px-4 py-6">{children}</main>
      <footer className="px-4 py-4 text-center text-[11px] text-slate-400">
        {PORTAL_FOOTER}
      </footer>
    </div>
  );
}

export default async function DiePortalPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return (
      <Shell>
        <p className="text-sm text-slate-600">This link is not available.</p>
      </Shell>
    );
  }

  const withComment =
    "status, width, height, required_date, allow_own_date, file_name, file_path, file_mime, files, quoted_price, time_estimate, confirmed_due_date, client_note, comment, order:orders(title), tenant:tenants(name)";
  const withoutComment =
    "status, width, height, required_date, file_name, file_path, file_mime, quoted_price, time_estimate, confirmed_due_date, client_note, order:orders(title), tenant:tenants(name)";

  const first = await admin
    .from("die_requests")
    .select(withComment)
    .eq("token", token)
    .maybeSingle();

  const retry =
    first.error && /comment|files|allow_own_date/i.test(first.error.message)
      ? await admin
          .from("die_requests")
          .select(withoutComment)
          .eq("token", token)
          .maybeSingle()
      : first;

  const error = retry.error;
  const data = retry.data as Record<string, unknown> | null;

  if (error || !data) {
    return (
      <Shell>
        <div className="text-center">
          <h1 className="text-lg font-semibold text-slate-800">Link not found</h1>
          <p className="mt-2 text-sm text-slate-500">
            This die request link is invalid or no longer available.
          </p>
        </div>
      </Shell>
    );
  }

  const order = data.order as { title?: string } | { title?: string }[] | null;
  const tenant = data.tenant as { name?: string } | { name?: string }[] | null;
  const orderTitle = (Array.isArray(order) ? order[0]?.title : order?.title) ??
    "Die request";
  const tenantName =
    (Array.isArray(tenant) ? tenant[0]?.name : tenant?.name) ?? "BazaarPrinting";

  const parsedFiles = parseDieRequestFiles(data.files);
  const files: DieRequestFile[] =
    parsedFiles.length > 0
      ? parsedFiles
      : data.file_name
        ? [
            {
              path: data.file_path ? String(data.file_path) : "",
              name: String(data.file_name),
              mime: data.file_mime ? String(data.file_mime) : null,
            },
          ]
        : [];

  return (
    <Shell title={orderTitle}>
      <h1 className="mb-4 text-lg font-semibold text-slate-800">
        Die request — {orderTitle}
      </h1>
      <DieQuoteForm
        data={{
          token,
          status: String(data.status),
          orderTitle,
          tenantName,
          width: data.width == null ? null : Number(data.width),
          height: data.height == null ? null : Number(data.height),
          requiredDate: String(data.required_date).slice(0, 10),
          fileName: files[0]?.name ?? null,
          files: files.map((file, i) => ({
            name: file.name,
            index: i,
            isImage: Boolean(
              file.mime?.toLowerCase().startsWith("image/") ||
                /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(file.name)
            ),
          })),
          quotedPrice:
            data.quoted_price == null ? null : Number(data.quoted_price),
          timeEstimate: data.time_estimate
            ? String(data.time_estimate)
            : null,
          confirmedDueDate: data.confirmed_due_date
            ? String(data.confirmed_due_date).slice(0, 10)
            : null,
          clientNote: data.client_note ? String(data.client_note) : null,
          comment:
            "comment" in data && data.comment
              ? String(data.comment)
              : null,
          allowOwnDate: Boolean(data.allow_own_date),
        }}
      />
    </Shell>
  );
}
