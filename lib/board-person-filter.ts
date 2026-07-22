/** Persist board person/owner filters across refreshes. */

export function boardPersonFilterStorageKey(tenantId: string): string {
  return `board-person-filter-${tenantId}`;
}

export function boardOwnerFilterStorageKey(tenantId: string): string {
  return `board-owner-filter-${tenantId}`;
}

export function loadPersonFilter(tenantId: string): string {
  if (typeof window === "undefined") return "";
  try {
    return localStorage.getItem(boardPersonFilterStorageKey(tenantId)) ?? "";
  } catch {
    return "";
  }
}

export function savePersonFilter(tenantId: string, designerId: string): void {
  if (typeof window === "undefined") return;
  try {
    const key = boardPersonFilterStorageKey(tenantId);
    if (!designerId) localStorage.removeItem(key);
    else localStorage.setItem(key, designerId);
  } catch {
    // ignore quota / private mode
  }
}

export function loadOwnerFilter(tenantId: string): string {
  if (typeof window === "undefined") return "";
  try {
    return localStorage.getItem(boardOwnerFilterStorageKey(tenantId)) ?? "";
  } catch {
    return "";
  }
}

export function saveOwnerFilter(tenantId: string, ownerId: string): void {
  if (typeof window === "undefined") return;
  try {
    const key = boardOwnerFilterStorageKey(tenantId);
    if (!ownerId) localStorage.removeItem(key);
    else localStorage.setItem(key, ownerId);
  } catch {
    // ignore quota / private mode
  }
}
