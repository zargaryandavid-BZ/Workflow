"use client";

import { Delete, X } from "lucide-react";
import { cn } from "@/lib/utils";

const KEYS: { label: string; value: string }[][] = [
  [
    { label: "1", value: "1" },
    { label: "2", value: "2" },
    { label: "3", value: "3" },
  ],
  [
    { label: "4", value: "4" },
    { label: "5", value: "5" },
    { label: "6", value: "6" },
  ],
  [
    { label: "7", value: "7" },
    { label: "8", value: "8" },
    { label: "9", value: "9" },
  ],
  [
    { label: "(", value: "(" },
    { label: "0", value: "0" },
    { label: ")", value: ")" },
  ],
  [{ label: "W", value: "W" }],
];

const DECIMAL_KEYS: { label: string; value: string }[][] = [
  [
    { label: "1", value: "1" },
    { label: "2", value: "2" },
    { label: "3", value: "3" },
  ],
  [
    { label: "4", value: "4" },
    { label: "5", value: "5" },
    { label: "6", value: "6" },
  ],
  [
    { label: "7", value: "7" },
    { label: "8", value: "8" },
    { label: "9", value: "9" },
  ],
  [
    { label: ".", value: "." },
    { label: "0", value: "0" },
    { label: "00", value: "00" },
  ],
];

/** Integer-only keypad — no decimal point, 0 spans full width. */
const INTEGER_KEYS: { label: string; value: string }[][] = [
  [
    { label: "1", value: "1" },
    { label: "2", value: "2" },
    { label: "3", value: "3" },
  ],
  [
    { label: "4", value: "4" },
    { label: "5", value: "5" },
    { label: "6", value: "6" },
  ],
  [
    { label: "7", value: "7" },
    { label: "8", value: "8" },
    { label: "9", value: "9" },
  ],
  [{ label: "0", value: "0" }], // col-span-3 via row.length === 1
];

const keyClass =
  "flex min-h-14 items-center justify-center rounded-xl bg-slate-100 text-2xl font-semibold text-slate-900 touch-manipulation active:bg-slate-200 md:min-h-20 md:text-3xl landscape:min-h-12 landscape:md:min-h-16";

export function ScanNumberKeypad({
  value,
  onInsert,
  onBackspace,
  onSubmit,
  onClose,
  extraKeys = [],
  variant = "scan",
  zIndex = 50,
}: {
  value: string;
  onInsert: (ch: string) => void;
  onBackspace: () => void;
  onSubmit: () => void;
  onClose: () => void;
  extraKeys?: string[];
  variant?: "scan" | "decimal" | "integer";
  zIndex?: number;
}) {
  const keys =
    variant === "decimal" ? DECIMAL_KEYS : variant === "integer" ? INTEGER_KEYS : KEYS;
  return (
    <div className="fixed inset-0 flex items-center justify-center p-4 md:p-8" style={{ zIndex }}>
      <button
        type="button"
        tabIndex={-1}
        aria-label="Close number pad"
        className="absolute inset-0 bg-slate-900/40"
        onPointerDown={(e) => e.preventDefault()}
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-label="Number pad"
        className="relative z-10 w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl md:max-w-lg md:p-6 landscape:max-w-xl"
        onPointerDown={(e) => e.preventDefault()}
      >
        <div className="mb-3 flex items-center justify-between gap-2 md:mb-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 md:text-xs">
            Number pad
          </p>
          <button
            type="button"
            tabIndex={-1}
            onClick={onClose}
            aria-label="Close"
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 md:h-11 md:w-11"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="mb-3 min-h-12 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-center text-2xl font-semibold tracking-wide text-slate-900 md:mb-4 md:min-h-14 md:text-3xl">
          {value || (
            <span className="font-medium text-slate-400">
              {variant === "decimal" ? "e.g. 12.5" : variant === "integer" ? "e.g. 100" : "e.g. 15118-1"}
            </span>
          )}
        </div>
        <div className="grid gap-2 md:gap-2.5">
          {keys.map((row, i) => (
            <div key={i} className="grid grid-cols-3 gap-2 md:gap-2.5">
              {row.map((key) => (
                <button
                  key={key.value}
                  type="button"
                  onClick={() => onInsert(key.value)}
                  className={cn(keyClass, row.length === 1 && "col-span-3")}
                  tabIndex={-1}
                >
                  {key.label}
                </button>
              ))}
            </div>
          ))}
          {variant === "scan" && extraKeys.length > 0 ? (
            <div
              className="grid gap-2 md:gap-2.5"
              style={{
                gridTemplateColumns: `repeat(${Math.min(
                  extraKeys.length,
                  3
                )}, minmax(0, 1fr))`,
              }}
            >
              {extraKeys.slice(0, 3).map((key) => (
                <button
                  key={key}
                  type="button"
                  tabIndex={-1}
                  onClick={() => onInsert(key)}
                  className={keyClass}
                >
                  {key}
                </button>
              ))}
            </div>
          ) : null}
          <div
            className={cn(
              "grid gap-2 md:gap-2.5",
              variant === "decimal" || variant === "integer" ? "grid-cols-2" : "grid-cols-3"
            )}
          >
            {variant === "scan" ? (
              <button
                type="button"
                tabIndex={-1}
                onClick={() => onInsert("-")}
                className={keyClass}
              >
                -
              </button>
            ) : null}
            <button
              type="button"
              tabIndex={-1}
              onClick={onBackspace}
              aria-label="Backspace"
              className={keyClass}
            >
              <Delete className="h-6 w-6 md:h-7 md:w-7" />
            </button>
            <button
              type="button"
              tabIndex={-1}
              onClick={onSubmit}
              className={cn(
                keyClass,
                "bg-slate-900 text-base font-semibold text-white active:bg-slate-700 md:text-lg"
              )}
            >
              {variant === "scan" ? "Scan" : "Done"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
