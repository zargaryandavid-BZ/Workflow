/**
 * pdf.js 6 uses Map.getOrInsert / getOrInsertComputed (very new JS).
 * iOS Safari and many phones do not implement them yet — the worker then throws
 * `this.#ne.getOrInsertComputed is not a function`.
 */
export const PDFJS_MAP_POLYFILL_SOURCE = `"use strict";
(function(){
  var p = typeof Map !== "undefined" ? Map.prototype : null;
  if (!p) return;
  if (typeof p.getOrInsert !== "function") {
    p.getOrInsert = function (key, value) {
      if (!this.has(key)) this.set(key, value);
      return this.get(key);
    };
  }
  if (typeof p.getOrInsertComputed !== "function") {
    p.getOrInsertComputed = function (key, callback) {
      if (!this.has(key)) this.set(key, callback(key));
      return this.get(key);
    };
  }
})();`;

export function installPdfJsMapPolyfills(target: {
  Map?: typeof Map;
} = globalThis): void {
  const proto = target.Map?.prototype as
    | (Map<unknown, unknown> & {
        getOrInsert?: (key: unknown, value: unknown) => unknown;
        getOrInsertComputed?: (
          key: unknown,
          callback: (key: unknown) => unknown
        ) => unknown;
      })
    | undefined;
  if (!proto) return;
  if (typeof proto.getOrInsert !== "function") {
    proto.getOrInsert = function (this: Map<unknown, unknown>, key, value) {
      if (!this.has(key)) this.set(key, value);
      return this.get(key);
    };
  }
  if (typeof proto.getOrInsertComputed !== "function") {
    proto.getOrInsertComputed = function (
      this: Map<unknown, unknown>,
      key,
      callback
    ) {
      if (!this.has(key)) this.set(key, callback(key));
      return this.get(key);
    };
  }
}

if (typeof globalThis !== "undefined") {
  installPdfJsMapPolyfills();
}

/** Bump when the worker file/polyfill changes so phones drop a cached worker. */
export const PDFJS_WORKER_SRC = "/api/pdf-worker?v=map-polyfill-2";
