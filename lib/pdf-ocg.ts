/** Parse Acrobat Optional Content Groups (layers) from raw PDF bytes. */

function unescapePdfLiteral(raw: string): string {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    const n = raw[i + 1];
    if (n === undefined) break;
    if (n >= "0" && n <= "7") {
      let oct = n;
      i += 1;
      for (let k = 0; k < 2; k++) {
        const d = raw[i + 1];
        if (d >= "0" && d <= "7") {
          oct += d;
          i += 1;
        } else break;
      }
      out += String.fromCharCode(parseInt(oct, 8));
      continue;
    }
    const map: Record<string, string> = {
      n: "\n",
      r: "\r",
      t: "\t",
      b: "\b",
      f: "\f",
      "(": "(",
      ")": ")",
      "\\": "\\",
    };
    out += map[n] ?? n;
    i += 1;
  }
  return out.replace(/\r\n?/g, "\n").trim();
}

function decodePdfHexName(hex: string): string {
  const clean = hex.replace(/\s+/g, "");
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    const codes: number[] = [];
    for (let i = 2; i + 1 < bytes.length; i += 2) {
      codes.push((bytes[i] << 8) | bytes[i + 1]);
    }
    return String.fromCharCode(...codes).trim();
  }
  return new TextDecoder("latin1").decode(bytes).trim();
}

function nameFromOcgDict(dict: string): string | null {
  const lit = dict.match(/\/Name\s*\(((?:\\.|[^\\)])*)\)/);
  if (lit) return unescapePdfLiteral(lit[1]);
  const hex = dict.match(/\/Name\s*<([0-9A-Fa-f\s]+)>/);
  if (hex) return decodePdfHexName(hex[1]);
  const token = dict.match(/\/Name\s*\/([^\s/[\]<>()]+)/);
  if (token) return token[1].replace(/#([0-9A-Fa-f]{2})/g, (_, h) =>
    String.fromCharCode(parseInt(h, 16))
  );
  return null;
}

export function parsePdfOcgs(data: ArrayBuffer): { id: string; name: string }[] {
  const text = new TextDecoder("latin1").decode(data);
  const layers: { id: string; name: string }[] = [];
  const seen = new Set<string>();

  const objRe = /(\d+)\s+\d+\s+obj\b([\s\S]*?)endobj/gi;
  let m: RegExpExecArray | null;
  while ((m = objRe.exec(text))) {
    const body = m[2];
    if (!/\/Type\s*\/OCG\b/.test(body)) continue;
    const dictMatch = body.match(/<<([\s\S]*?)>>/);
    const dict = dictMatch ? dictMatch[1] : body;
    const id = `${m[1]}R`;
    if (seen.has(id)) continue;
    seen.add(id);
    const name = nameFromOcgDict(dict);
    layers.push({
      id,
      name: name || `Layer ${layers.length + 1}`,
    });
  }

  if (layers.length === 0) {
    const loose =
      /\/Type\s*\/OCG\b[\s\S]{0,400}?\/Name\s*(?:\(((?:\\.|[^\\)])*)\)|<([0-9A-Fa-f\s]+)>|\/([^\s/[\]<>()]+))/g;
    let lm: RegExpExecArray | null;
    let i = 0;
    while ((lm = loose.exec(text))) {
      const name = lm[1]
        ? unescapePdfLiteral(lm[1])
        : lm[2]
          ? decodePdfHexName(lm[2])
          : (lm[3] ?? "").replace(/#([0-9A-Fa-f]{2})/g, (_, h) =>
              String.fromCharCode(parseInt(h, 16))
            );
      const label = name.trim() || `Layer ${i + 1}`;
      const id = `ocg-${i}`;
      i += 1;
      if (seen.has(label)) continue;
      seen.add(label);
      layers.push({ id, name: label });
    }
  }

  return layers;
}

export type PdfLayer = { id: string; name: string };

/** Fallback names from Acrobat OCGs with no title (`Layer 1`, `Layer 2`, …). */
export function isUnnamedPdfLayer(name: string): boolean {
  return /^layer\s+\d+$/i.test(name.trim());
}

/** True for Acrobat layers like `ART WORK` / `Artwork` (not dieline / effects). */
export function isPdfArtworkLayer(name: string): boolean {
  const n = name.trim().toLowerCase().replace(/\s+/g, " ");
  if (!n) return false;
  if (
    /\bdie\s*line\b|\bdieline\b|\bcut\s*line\b|\bwhite\b|\buv\b|\bfoil\b|\bsafe\b|\bperf/.test(
      n
    )
  ) {
    return false;
  }
  return /\bart\s*work\b|\bartwork\b/.test(n);
}

export type OcLike = {
  getOrder?: () => unknown;
  getGroup?: (id: string) => { name?: unknown } | null | undefined;
  serializable?: {
    data?: { groups?: Record<string, { name?: unknown }> };
    groupState?: Map<string, unknown>;
  };
  [Symbol.iterator]?: () => Iterator<[string, unknown]>;
};

/** Acrobat refs often show up as "12R", "12 0 R", or "12". */
export function normalizeOcgId(raw: unknown): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  const m = s.match(/^(\d+)(?:\s+\d+\s+R|R)?$/i);
  return m ? `${m[1]}R` : s;
}

/** Keep first occurrence of each layer name (case-insensitive). */
export function dedupePdfLayersByName(layers: PdfLayer[]): PdfLayer[] {
  const seen = new Set<string>();
  const out: PdfLayer[] = [];
  for (const layer of layers) {
    const key = layer.name.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(layer);
  }
  return out;
}

function layerNameForId(oc: OcLike, id: string, index: number): string {
  const groups = oc.serializable?.data?.groups;
  const g = oc.getGroup?.(id);
  const fromGroup = typeof g?.name === "string" ? g.name.trim() : "";
  const fromData =
    typeof groups?.[id]?.name === "string" ? String(groups[id].name).trim() : "";
  if (fromGroup || fromData) return fromGroup || fromData;
  for (const [gid, meta] of Object.entries(groups ?? {})) {
    if (normalizeOcgId(gid) !== normalizeOcgId(id)) continue;
    const n = typeof meta?.name === "string" ? meta.name.trim() : "";
    if (n) return n;
  }
  return `Layer ${index + 1}`;
}

export function layersFromOptionalContent(oc: OcLike): PdfLayer[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const push = (id: unknown) => {
    const s = normalizeOcgId(id);
    if (!s || seen.has(s)) return;
    seen.add(s);
    ids.push(s);
  };

  try {
    for (const id of collectLayerIds(oc.getOrder?.() ?? [])) push(id);
  } catch {
    /* ignore */
  }

  // Order is the Layers-panel list. Iterator / group maps often re-list the
  // same OCGs with different id strings, frequently in reverse — that produced
  // Dieline…ART WORK then ART WORK…Dieline. Only use them when Order is empty.
  if (ids.length === 0) {
    try {
      if (typeof oc[Symbol.iterator] === "function") {
        for (const [id] of oc as unknown as Iterable<[string, unknown]>) {
          push(id);
        }
      }
    } catch {
      /* ignore */
    }
    const groups = oc.serializable?.data?.groups;
    if (groups && typeof groups === "object") {
      for (const id of Object.keys(groups)) push(id);
    }
    const state = oc.serializable?.groupState;
    if (state && typeof state.keys === "function") {
      for (const id of state.keys()) push(id);
    }
  }

  return dedupePdfLayersByName(
    ids.map((id, i) => ({ id, name: layerNameForId(oc, id, i) }))
  );
}

export function mergePdfLayers(
  primary: PdfLayer[],
  fallback: PdfLayer[]
): PdfLayer[] {
  if (primary.length > 0) return dedupePdfLayersByName(primary);
  return dedupePdfLayersByName(fallback);
}

export function collectLayerIds(order: unknown): string[] {
  const ids: string[] = [];
  const walk = (node: unknown) => {
    if (typeof node === "string" || typeof node === "number") {
      const s = String(node).trim();
      if (!s) return;
      if (/^\d+(\s+\d+\s+R|R)?$/i.test(s)) {
        ids.push(s);
        return;
      }
      // Nested Order groups often start with a layer-folder label.
      if (/\s/.test(s)) return;
      ids.push(s);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node && typeof node === "object") {
      const o = node as Record<string, unknown>;
      if (o.id != null) ids.push(String(o.id));
      if (Array.isArray(o.order)) o.order.forEach(walk);
    }
  };
  walk(order);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    const n = normalizeOcgId(id);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}
