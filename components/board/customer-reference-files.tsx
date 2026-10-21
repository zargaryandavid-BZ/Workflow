"use client";

import { Download, FileText, ImageIcon } from "lucide-react";
import {
  groupReferenceFiles,
  isPreviewableReferenceImage,
  referenceDownloadUrl,
  referenceViewUrl,
  type CustomerReferenceFile,
} from "@/lib/customer-references";
import { cn } from "@/lib/utils";

/**
 * Staff view of reference images a customer attached when they did not
 * approve a proof. Thumbnail opens full size in a new tab; Download saves it.
 */
export function CustomerReferenceFiles({
  files,
  className,
  title = "Customer reference files",
}: {
  files: CustomerReferenceFile[] | null | undefined;
  className?: string;
  title?: string;
}) {
  if (!files || files.length === 0) return null;
  const groups = groupReferenceFiles(files);

  return (
    <div className={cn("space-y-2", className)}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {title} ({files.length})
      </p>
      {groups.map((group) => (
        <div key={group.label ?? "all"}>
          {group.label ? (
            <p className="mb-1 text-xs font-medium text-slate-600">
              {group.label}
            </p>
          ) : null}
          <ul className="flex flex-wrap gap-2">
            {group.files.map((file) => {
              const previewable = isPreviewableReferenceImage(
                file.file_name,
                file.mime_type
              );
              return (
                <li
                  key={file.id}
                  className="w-24 overflow-hidden rounded-md border border-slate-200 bg-white"
                >
                  <a
                    href={referenceViewUrl(file.id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={`Open ${file.file_name} full size`}
                    className="flex h-20 w-full items-center justify-center bg-slate-50"
                  >
                    {previewable ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={referenceViewUrl(file.id)}
                        alt={file.file_name}
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    ) : file.file_name.toLowerCase().endsWith(".pdf") ? (
                      <FileText className="h-7 w-7 text-red-500" />
                    ) : (
                      <ImageIcon className="h-7 w-7 text-slate-400" />
                    )}
                  </a>
                  <div className="flex items-center justify-between gap-1 border-t border-slate-100 px-1.5 py-1">
                    <span
                      className="min-w-0 truncate text-[10px] text-slate-600"
                      title={file.file_name}
                    >
                      {file.file_name}
                    </span>
                    <a
                      href={referenceDownloadUrl(file.id)}
                      className="shrink-0 rounded p-0.5 text-[var(--primary)] hover:bg-blue-50"
                      aria-label={`Download ${file.file_name}`}
                      title="Download"
                    >
                      <Download className="h-3.5 w-3.5" />
                    </a>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
