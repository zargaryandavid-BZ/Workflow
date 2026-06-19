"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  ChevronDown,
  ChevronRight,
  Loader2,
} from "lucide-react";
import { ImageLightbox } from "@/components/ui/image-lightbox";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ApprovalTab } from "./approval-tab";
import { AssetsSection } from "./assets-section";
import { MissingInfoTab } from "./missing-info-tab";
import { OrderFormBody } from "./order-form-body";
import { mergeSkusWithAssets, normalizeSkus, prepareSkusForSave, validateSkus, type SkuItem } from "./sku-editor";
import {
  deleteAssetsById,
  uploadPendingSkuArtwork,
} from "@/lib/sku-assets";
import { PRIORITY_STYLES } from "@/lib/constants";
import { describeActivity, type ActivityLogEntry } from "@/lib/activity";
import { customerContactFromOrder } from "@/lib/notification-messages";
import {
  BUCKET as ORDER_ASSETS_BUCKET,
  serializeSkusForJobTicketLink,
  signedUrlsForAssets,
  SKU_LINK_SIGNED_URL_TTL_SEC,
} from "@/lib/sku-artwork-url";
import { createClient } from "@/lib/supabase/client";
import {
  buildCustomFieldPayload,
  findOrderFormField,
  resolveOrderFormFields,
  validateDueDate,
  validateOrderFormFields,
} from "@/lib/order-form";
import { cn, dateInputValue, formatDateTime } from "@/lib/utils";
import type {
  Approval,
  ApprovalNote,
  Asset,
  BoardColumn,
  Category,
  CustomField,
  CustomFieldValue,
  Designer,
  MissingInfoNote,
  OrderWithRelations,
  Role,
} from "@/lib/types";

interface CardDetailModalProps {
  orderId: string | null;
  open: boolean;
  onClose: () => void;
  customFields: CustomField[];
  categories: Category[];
  columns: BoardColumn[];
  designers: Designer[];
  role: Role;
  onChanged: () => void;
  /** When "view", all fields are read-only and save/upload actions are hidden. */
  mode?: "edit" | "view";
  onLinkCopied?: (message: string) => void;
  /** When false, hides the Copy Order Link header button. Defaults to true. */
  showCopyOrderLink?: boolean;
}

function addToSet(prev: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(prev);
  next.add(id);
  return next;
}

function removeFromSet(prev: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(prev);
  next.delete(id);
  return next;
}

interface DetailResponse {
  order: OrderWithRelations;
  assets: Asset[];
  values: CustomFieldValue[];
  activity: ActivityLogEntry[];
  approvals: Approval[];
  missingInfo: MissingInfoNote[];
  approvalNotes: ApprovalNote[];
}

export function CardDetailModal({
  orderId,
  open,
  onClose,
  customFields,
  categories,
  columns,
  designers,
  role,
  onChanged,
  mode = "edit",
  onLinkCopied,
  showCopyOrderLink = true,
}: CardDetailModalProps) {
  const isViewOnly = mode === "view";
  const resolved = useMemo(
    () => resolveOrderFormFields(customFields),
    [customFields]
  );
  const [data, setData] = useState<DetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("normal");
  const [categoryId, setCategoryId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerContact, setCustomerContact] = useState("");
  const [fieldValues, setFieldValues] = useState<Record<string, unknown>>({});
  const [skus, setSkus] = useState<SkuItem[]>([]);
  const [designerId, setDesignerId] = useState("");
  const [designTask, setDesignTask] = useState("");
  const [tab, setTab] = useState<"details" | "missing-info" | "approval">(
    "details"
  );
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pendingSkuArtwork, setPendingSkuArtwork] = useState<
    Record<string, File>
  >({});
  const [removedSkuArtworkIds, setRemovedSkuArtworkIds] = useState<
    Set<string>
  >(new Set());
  const [previewAsset, setPreviewAsset] = useState<Asset | null>(null);

  function resetPendingFiles() {
    setPendingSkuArtwork({});
    setRemovedSkuArtworkIds(new Set());
  }

  const hasPendingFileChanges =
    Object.keys(pendingSkuArtwork).length > 0 ||
    removedSkuArtworkIds.size > 0;

  const applyDetail = useCallback(
    (json: DetailResponse) => {
      setData(json);
      setTitle(json.order.title);
      setDescription(json.order.description ?? "");
      setPriority(json.order.priority);
      setCategoryId(json.order.category_id ?? "");
      setDueDate(dateInputValue(json.order.due_date));
      setSkus(mergeSkusWithAssets(normalizeSkus(json.order.specs?.skus), json.assets));
      setDesignerId((json.order.specs?.designer_id as string) ?? "");
      setDesignTask((json.order.specs?.design_task as string) ?? "");
      const map: Record<string, unknown> = {};
      for (const v of json.values) map[v.custom_field_id] = v.value;

      let name = "";
      let contact = "";
      if (resolved.customerNameField) {
        name = String(map[resolved.customerNameField.id] ?? "").trim();
      }
      if (resolved.customerContactField) {
        contact = String(map[resolved.customerContactField.id] ?? "").trim();
      }
      if (json.order.customer) {
        if (!name) name = json.order.customer.name;
        if (!contact) {
          contact =
            json.order.customer.email ?? json.order.customer.phone ?? "";
        }
      }
      setCustomerName(name);
      setCustomerContact(contact);
      setFieldValues(map);
    },
    [resolved.customerNameField, resolved.customerContactField]
  );

  const load = useCallback(async () => {
    if (!orderId) return;
    setLoading(true);
    const res = await fetch(`/api/orders/${orderId}`);
    const json: DetailResponse = await res.json();
    setLoading(false);
    if (!res.ok) return;
    applyDetail(json);
  }, [orderId, applyDetail]);

  useEffect(() => {
    if (open && orderId) {
      setActivityOpen(false);
      resetPendingFiles();
      load();
    }
    if (!open) {
      setData(null);
      setTab("details");
      setActivityOpen(false);
      resetPendingFiles();
    }
  }, [open, orderId, load]);

  async function save() {
    if (!orderId) return;

    if (!title.trim()) {
      setSaveError("Order Number is required");
      return;
    }

    const validationError = validateOrderFormFields(
      resolved,
      fieldValues,
      customerName,
      customerContact,
      skus,
      designerId
    );
    if (validationError) {
      setSaveError(validationError);
      return;
    }

    const dueDateError = validateDueDate(dueDate, data?.order.due_date);
    if (dueDateError) {
      setSaveError(dueDateError);
      return;
    }

    const skuError = validateSkus(skus, Object.keys(pendingSkuArtwork));
    if (skuError) {
      setSaveError(skuError);
      return;
    }

    setSaveError(null);
    setSaving(true);
    const res = await fetch(`/api/orders/${orderId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        description,
        priority,
        categoryId: categoryId || null,
        dueDate: dateInputValue(dueDate) || null,
        specs: {
          ...(data?.order.specs ?? {}),
          skus: prepareSkusForSave(skus, {
            pendingArtworkIds: Object.keys(pendingSkuArtwork),
          }),
          designer_id: designerId || null,
          designer_name:
            designers.find((d) => d.id === designerId)?.name ?? null,
          design_task: designTask || null,
        },
        customFieldValues: buildCustomFieldPayload(
          resolved,
          fieldValues,
          skus,
          customerName,
          customerContact
        ),
      }),
    });
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      setSaveError(json.error ?? "Failed to save order");
      setSaving(false);
      return;
    }

    const skuKeysWithPendingUpload = new Set(Object.keys(pendingSkuArtwork));
    const skuAssetIdsToDelete = [...removedSkuArtworkIds].filter((assetId) => {
      const asset = data?.assets.find((a) => a.id === assetId);
      return !(
        asset?.sku_key && skuKeysWithPendingUpload.has(asset.sku_key)
      );
    });
    if (skuAssetIdsToDelete.length > 0) {
      await deleteAssetsById(skuAssetIdsToDelete);
    }
    if (Object.keys(pendingSkuArtwork).length > 0) {
      await uploadPendingSkuArtwork(orderId, pendingSkuArtwork);
    }

    setSaving(false);
    resetPendingFiles();
    onChanged();
    onClose();
  }

  function setFieldValue(fieldId: string, value: unknown) {
    setFieldValues((prev) => ({ ...prev, [fieldId]: value }));
  }

  function markSkuArtworkForRemoval(assetId: string) {
    setRemovedSkuArtworkIds((prev) => addToSet(prev, assetId));
  }

  function unmarkSkuArtworkForRemoval(assetId: string) {
    setRemovedSkuArtworkIds((prev) => removeFromSet(prev, assetId));
  }

  const orderLevelAssets = useMemo(
    () =>
      data?.assets.filter(
        (a) => !a.sku_key && !a.notification_id
      ) ?? [],
    [data?.assets]
  );

  const pendingApproval = data?.approvals.find((a) => a.status === "pending");
  const hasMissingInfo = (data?.missingInfo.length ?? 0) > 0;
  const hasApproval = (data?.approvalNotes.length ?? 0) > 0;
  const hasExtraTabs = !isViewOnly && (hasMissingInfo || hasApproval);
  const orderContact = data
    ? customerContactFromOrder(data.order, fieldValues, customFields)
    : { email: null, phone: null };

  function handleClose() {
    if (
      hasPendingFileChanges &&
      !window.confirm(
        "You have unsaved file changes. Close without saving?"
      )
    ) {
      return;
    }
    onClose();
  }

  async function copyOrderLink() {
    const getField = (name: string) => {
      const field = findOrderFormField(customFields, name);
      return field ? String(fieldValues[field.id] ?? "") : "";
    };

    // Require GDrive artwork link before allowing copy
    const artworkUrl = getField("Artwork (GDrive link)");
    if (!artworkUrl.trim()) {
      window.alert(
        "⚠️ Please add an Artwork GDrive link to this order before copying the job ticket link.\n\nEdit the order → fill in \"Artwork GDrive link\" → then copy."
      );
      return;
    }

    const finishedSize = getField("Finished Size");
    const sizeMatch = finishedSize.match(/([\d.]+)\s*[xX×]\s*([\d.]+)/);
    const width = sizeMatch ? sizeMatch[1] : "";
    const height = sizeMatch ? sizeMatch[2] : "";

    const sidesRaw = getField("Sides").toLowerCase();
    const sides = sidesRaw.includes("2")
      ? "2-sided"
      : sidesRaw.includes("1")
        ? "1-sided"
        : "";

    const assetsBySkuKey = new Map<string, Asset>();
    for (const asset of data?.assets ?? []) {
      if (asset.sku_key && !removedSkuArtworkIds.has(asset.id)) {
        assetsBySkuKey.set(asset.sku_key, asset);
      }
    }

    const supabase = createClient();
    const signedUrlByPath = await signedUrlsForAssets(
      [...assetsBySkuKey.values()],
      async (paths) => {
        const { data, error } = await supabase.storage
          .from(ORDER_ASSETS_BUCKET)
          .createSignedUrls(paths, SKU_LINK_SIGNED_URL_TTL_SEC);
        if (error || !data) return new Map();
        return new Map(
          data
            .filter((row) => row.path && row.signedUrl)
            .map((row) => [row.path as string, row.signedUrl as string])
        );
      }
    );

    const skusStr = serializeSkusForJobTicketLink(
      skus,
      assetsBySkuKey,
      signedUrlByPath
    );

    const orderQtyField = resolved.orderQtyField;
    const qty = orderQtyField
      ? String(fieldValues[orderQtyField.id] ?? "")
      : skus.length > 0
        ? String(skus.reduce((sum, s) => sum + (s.qty ?? 0), 0))
        : "";

    const params = new URLSearchParams({
      from: "workflow",
      order_ref: title,
      customer: customerName,
      contact: customerContact,
      priority: priority.toLowerCase(),
      due: dueDate,
      product: getField("Product"),
      product_type: getField("Product Type"),
      width,
      height,
      material: getField("Materials"),
      finishing: getField("Finishing"),
      sides,
      color: getField("Color"),
      qty,
      notes: description,
      artwork: artworkUrl,
      skus: skusStr,
    });

    const link = `https://pulse-jade-five.vercel.app/pages/job-ticket.html?${params.toString()}`;

    navigator.clipboard
      .writeText(link)
      .then(() => {
        onLinkCopied?.(
          "✅ Order link copied — paste it in Pulse to create a job ticket"
        );
      })
      .catch(() => {});
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={isViewOnly ? "View order" : "Order Details"}
      className="max-w-3xl"
      headerAction={
        showCopyOrderLink ? (
          <button
            type="button"
            onClick={copyOrderLink}
            disabled={loading || !data || !customerName}
            className="flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            title="Copy pre-filled job ticket link"
          >
            📋 Copy Order Link
          </button>
        ) : undefined
      }
      footer={
        isViewOnly ? (
          <Button variant="ghost" onClick={handleClose} type="button">
            Close
          </Button>
        ) : tab === "details" ? (
          <>
            {hasPendingFileChanges ? (
              <span className="mr-auto text-xs text-amber-600">
                Unsaved file changes
              </span>
            ) : null}
            <Button variant="ghost" onClick={handleClose} type="button">
              Close
            </Button>
            <Button onClick={save} disabled={saving || loading}>
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </>
        ) : (
          <Button variant="ghost" onClick={handleClose} type="button">
            Close
          </Button>
        )
      }
    >
      {loading || !data ? (
        <div className="flex h-40 items-center justify-center text-slate-400">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : (
        <>
          {hasExtraTabs ? (
            <div className="mb-4 flex gap-1 border-b border-slate-200">
              <button
                type="button"
                onClick={() => setTab("details")}
                className={cn(
                  "border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                  tab === "details"
                    ? "border-[var(--primary)] text-[var(--primary)]"
                    : "border-transparent text-slate-500 hover:text-slate-700"
                )}
              >
                Order Details
              </button>
              {hasMissingInfo ? (
                <button
                  type="button"
                  onClick={() => setTab("missing-info")}
                  className={cn(
                    "flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                    tab === "missing-info"
                      ? "border-[var(--primary)] text-[var(--primary)]"
                      : "border-transparent text-slate-500 hover:text-slate-700"
                  )}
                >
                  Missing Info
                  <span className="h-2 w-2 rounded-full bg-amber-500" />
                </button>
              ) : null}
              {hasApproval ? (
                <button
                  type="button"
                  onClick={() => setTab("approval")}
                  className={cn(
                    "flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                    tab === "approval"
                      ? "border-[var(--primary)] text-[var(--primary)]"
                      : "border-transparent text-slate-500 hover:text-slate-700"
                  )}
                >
                  Approval
                  <span className="h-2 w-2 rounded-full bg-violet-500" />
                </button>
              ) : null}
            </div>
          ) : null}

          {tab === "missing-info" && hasMissingInfo ? (
            <MissingInfoTab
              notes={data.missingInfo}
              customer={data.order.customer}
              orderId={data.order.id}
              sourceColumnId={data.order.column_id}
              columns={columns}
              contactEmail={orderContact.email}
              contactPhone={orderContact.phone}
              onSent={() => {
                load();
                onChanged();
              }}
            />
          ) : tab === "approval" && hasApproval ? (
            <ApprovalTab
              notes={data.approvalNotes}
              customer={data.order.customer}
              orderId={data.order.id}
              sourceColumnId={data.order.column_id}
              columns={columns}
              contactEmail={orderContact.email}
              contactPhone={orderContact.phone}
              onChanged={() => {
                load();
                onChanged();
              }}
            />
          ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <div className="space-y-4 md:col-span-2">
            <OrderFormBody
              idPrefix="edit"
              customFields={customFields}
              categories={categories}
              designers={designers}
              title={title}
              onTitleChange={setTitle}
              priority={priority}
              onPriorityChange={setPriority}
              categoryId={categoryId}
              onCategoryIdChange={setCategoryId}
              description={description}
              onDescriptionChange={setDescription}
              customerName={customerName}
              onCustomerNameChange={setCustomerName}
              customerContact={customerContact}
              onCustomerContactChange={setCustomerContact}
              designerId={designerId}
              onDesignerIdChange={setDesignerId}
              designTask={designTask}
              onDesignTaskChange={setDesignTask}
              fieldValues={fieldValues}
              onFieldValueChange={setFieldValue}
              skus={skus}
              onSkusChange={setSkus}
              dueDate={dueDate}
              onDueDateChange={(value) => {
                setDueDate(value);
                setSaveError(null);
              }}
              previousDueDate={data.order.due_date}
              orderId={orderId ?? undefined}
              skuAssets={data.assets}
              deferSkuArtworkUpload
              pendingSkuArtwork={pendingSkuArtwork}
              onPendingSkuArtworkChange={setPendingSkuArtwork}
              removedSkuArtworkIds={removedSkuArtworkIds}
              onMarkSkuArtworkForRemoval={markSkuArtworkForRemoval}
              onUnmarkSkuArtworkForRemoval={unmarkSkuArtworkForRemoval}
              readOnly={isViewOnly}
            />

            {saveError ? (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
                {saveError}
              </p>
            ) : null}

            {orderId ? (
              <AssetsSection
                orderId={orderId}
                initialAssets={orderLevelAssets}
                readOnly={isViewOnly}
                onPreviewImage={setPreviewAsset}
                onChanged={() => {
                  onChanged();
                  void load();
                }}
              />
            ) : null}
          </div>

          <div className="space-y-4">
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="mb-2 text-sm font-semibold text-slate-700">
                Approval
              </p>
              {data.approvals.length === 0 ? (
                <p className="text-sm text-slate-400">
                  Move this job to Customer Approval to request sign-off.
                </p>
              ) : (
                <div className="space-y-2">
                  {data.approvals.map((a) => (
                    <div key={a.id} className="text-sm">
                      <Badge
                        className={cn(
                          a.status === "approved" &&
                            "bg-emerald-100 text-emerald-700",
                          a.status === "rejected" && "bg-red-100 text-red-700",
                          a.status === "pending" &&
                            "bg-amber-100 text-amber-700"
                        )}
                      >
                        {a.status}
                      </Badge>
                      {a.comment ? (
                        <p className="mt-1 text-slate-500">“{a.comment}”</p>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
              {pendingApproval ? (
                <a
                  href={`/approve/${pendingApproval.token}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 block break-all text-xs text-[var(--primary)] hover:underline"
                >
                  Open approval link
                </a>
              ) : null}
            </div>

            <div className="rounded-lg border border-slate-200">
              <button
                type="button"
                onClick={() => setActivityOpen((o) => !o)}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50"
                aria-expanded={activityOpen}
              >
                {activityOpen ? (
                  <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
                ) : (
                  <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
                )}
                <Activity className="h-4 w-4 shrink-0" />
                <span>Activity</span>
                {!activityOpen && data.activity.length > 0 ? (
                  <span className="ml-auto text-xs font-normal text-slate-400">
                    {data.activity.length}{" "}
                    {data.activity.length === 1 ? "entry" : "entries"}
                  </span>
                ) : null}
              </button>
              {activityOpen ? (
                <ul className="space-y-2 border-t border-slate-100 px-3 py-2">
                  {data.activity.map((log) => (
                    <li key={log.id} className="text-xs text-slate-500">
                      <span className="font-medium text-slate-700">
                        {describeActivity(log)}
                      </span>
                      <span className="block text-slate-400">
                        {formatDateTime(log.created_at)}
                        {log.actor_name ? ` · ${log.actor_name}` : ""}
                      </span>
                    </li>
                  ))}
                  {data.activity.length === 0 ? (
                    <li className="text-xs text-slate-400">No activity yet.</li>
                  ) : null}
                </ul>
              ) : null}
            </div>
          </div>
        </div>
          )}
        </>
      )}
      {previewAsset ? (
        <ImageLightbox
          src={`/api/assets/${previewAsset.id}`}
          label={previewAsset.file_name}
          onClose={() => setPreviewAsset(null)}
        />
      ) : null}
    </Modal>
  );
}
