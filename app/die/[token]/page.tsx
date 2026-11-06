import { Printer } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { DieQuoteForm } from "@/components/die/die-quote-form";
import { diePortalFiles, parseDieRequestFiles } from "@/lib/die-request";
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
        <div className="mx-auto flex max-w-4xl items-center gap-2">
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
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6">{children}</main>
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

  const withDie =
    "status, width, height, depth, product_name, required_date, allow_own_date, file_name, file_path, file_mime, files, quoted_price, time_estimate, confirmed_due_date, client_note, comment, order:orders(title), tenant:tenants(name), die:dies(name, die_type, pacdora_template_name, pacdora_link, template_code, length, width, height, shape, rounded_corner, perforation, pdf_path, pdf_name)";
  const withDieBeforePdfMigration =
    "status, width, height, depth, product_name, required_date, allow_own_date, file_name, file_path, file_mime, files, quoted_price, time_estimate, confirmed_due_date, client_note, comment, order:orders(title), tenant:tenants(name), die:dies(name, die_type, pacdora_template_name, pacdora_link, template_code, length, width, height, shape, rounded_corner, perforation)";
  const withComment =
    "status, width, height, depth, product_name, required_date, allow_own_date, file_name, file_path, file_mime, files, quoted_price, time_estimate, confirmed_due_date, client_note, comment, order:orders(title), tenant:tenants(name)";
  const withoutComment =
    "status, width, height, required_date, file_name, file_path, file_mime, quoted_price, time_estimate, confirmed_due_date, client_note, order:orders(title), tenant:tenants(name)";

  let result = await admin
    .from("die_requests")
    .select(withDie)
    .eq("token", token)
    .maybeSingle();

  if (result.error && /pdf_path|pdf_name/i.test(result.error.message)) {
    result = await admin
      .from("die_requests")
      .select(withDieBeforePdfMigration)
      .eq("token", token)
      .maybeSingle();
  }
  if (result.error && /die_id|dies|relationship/i.test(result.error.message)) {
    result = await admin
      .from("die_requests")
      .select(withComment)
      .eq("token", token)
      .maybeSingle();
  }
  if (
    result.error &&
    /comment|files|allow_own_date|depth|product_name/i.test(result.error.message)
  ) {
    result = await admin
      .from("die_requests")
      .select(withoutComment)
      .eq("token", token)
      .maybeSingle();
  }

  const error = result.error;
  const data = result.data as Record<string, unknown> | null;

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

  const dieRelation = data.die as
    | Record<string, unknown>
    | Record<string, unknown>[]
    | null;
  const die = Array.isArray(dieRelation) ? dieRelation[0] ?? null : dieRelation;
  const parsedFiles = parseDieRequestFiles(data.files);
  const files = diePortalFiles(
    {
      files: parsedFiles,
      file_path: data.file_path ? String(data.file_path) : null,
      file_name: data.file_name ? String(data.file_name) : null,
      file_mime: data.file_mime ? String(data.file_mime) : null,
    },
    die
      ? {
          pdf_path: die.pdf_path ? String(die.pdf_path) : null,
          pdf_name: die.pdf_name ? String(die.pdf_name) : null,
        }
      : null
  );

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
          width:
            data.width == null
              ? die?.length == null
                ? null
                : Number(die.length)
              : Number(data.width),
          height:
            data.height == null
              ? die?.width == null
                ? null
                : Number(die.width)
              : Number(data.height),
          depth:
            data.depth == null
              ? die?.height == null
                ? null
                : Number(die.height)
              : Number(data.depth),
          productName:
            data.product_name
              ? String(data.product_name)
              : die?.name
                ? String(die.name)
                : null,
          dieName: die?.name ? String(die.name) : null,
          dieType: die?.die_type ? String(die.die_type) : null,
          templateCode: die?.template_code ? String(die.template_code) : null,
          shape: die?.shape ? String(die.shape) : null,
          roundedCorner:
            typeof die?.rounded_corner === "boolean"
              ? die.rounded_corner
              : null,
          perforation:
            typeof die?.perforation === "boolean" ? die.perforation : null,
          pacdoraTemplateName: die?.pacdora_template_name
            ? String(die.pacdora_template_name)
            : null,
          pacdoraLink: die?.pacdora_link ? String(die.pacdora_link) : null,
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
