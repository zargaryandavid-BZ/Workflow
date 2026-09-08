"use client";

import { useEffect, useState } from "react";
import type { StaffPickupLocation } from "@/lib/pickup-locations";

export function useStaffPickupLocations() {
  const [locations, setLocations] = useState<StaffPickupLocation[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/shipping/pickup-locations")
      .then((r) => r.json())
      .then((json: { locations?: StaffPickupLocation[] }) => {
        if (cancelled) return;
        const list = Array.isArray(json.locations) ? json.locations : [];
        setLocations(list);
        setSelectedId((current) => {
          if (current && list.some((l) => l.id === current)) return current;
          return list.find((l) => l.useForFedex)?.id ?? list[0]?.id ?? "";
        });
      })
      .catch(() => {
        if (!cancelled) setLocations([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selected =
    locations.find((l) => l.id === selectedId) ?? locations[0] ?? null;

  return { locations, selectedId, setSelectedId, selected };
}

export function PickupLocationPicker({
  locations,
  selectedId,
  onChange,
}: {
  locations: StaffPickupLocation[];
  selectedId: string;
  onChange: (id: string) => void;
}) {
  if (locations.length === 0) {
    return (
      <p className="text-xs text-slate-500">
        No pickup addresses yet. Add them under Settings → Shipping.
      </p>
    );
  }

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-slate-800">
        Where should the customer pick up?
      </legend>
      {locations.map((loc) => (
        <label
          key={loc.id}
          className={`flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 text-sm ${
            selectedId === loc.id
              ? "border-emerald-500 bg-emerald-50"
              : "border-slate-200 hover:border-slate-300"
          }`}
        >
          <input
            type="radio"
            className="mt-0.5"
            checked={selectedId === loc.id}
            onChange={() => onChange(loc.id)}
          />
          <span>
            <span className="block font-medium text-slate-800">
              {loc.name}
              {loc.useForFedex ? (
                <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  FedEx origin
                </span>
              ) : null}
            </span>
            <span className="block text-xs text-slate-500">
              {loc.addressLine || "Address not set"}
            </span>
            {loc.hoursNote ? (
              <span className="mt-0.5 block text-xs text-slate-500">
                {loc.hoursNote}
              </span>
            ) : null}
          </span>
        </label>
      ))}
    </fieldset>
  );
}
