"use client";

import { createPortal } from "react-dom";
import { FileWarning } from "lucide-react";
import { Button } from "@/components/ui/button";

export const NO_PRODUCTION_PDF_TITLE = "No PDF file in production";

export function NoProductionPdfDialog({
  open,
  onClose,
  jobTitle,
}: {
  open: boolean;
  onClose: () => void;
  jobTitle?: string;
}) {
  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="no-production-pdf-title"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-red-200 bg-white p-5 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <FileWarning className="mt-0.5 h-7 w-7 shrink-0 text-red-600" />
          <div className="min-w-0">
            <h2
              id="no-production-pdf-title"
              className="text-lg font-semibold text-red-800"
            >
              {NO_PRODUCTION_PDF_TITLE}
            </h2>
            {jobTitle ? (
              <p className="mt-1 text-sm font-medium text-slate-700">{jobTitle}</p>
            ) : null}
            <p className="mt-2 text-sm text-slate-600">
              There is no PDF in this job&apos;s Final production Drive folder.
              Add the print PDF there before sending customer approval.
            </p>
          </div>
        </div>
        <div className="mt-5 flex justify-end">
          <Button onClick={onClose}>OK</Button>
        </div>
      </div>
    </div>,
    document.body
  );
}
