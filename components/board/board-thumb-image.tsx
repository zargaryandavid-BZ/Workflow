"use client";

import { useState } from "react";
import Image from "next/image";
import { boardThumbSrc } from "@/lib/board-thumb-url";

/** Board picture: small server thumbnail first, the full image if that fails. */
export function BoardThumbImage({
  url,
  size,
  className,
}: {
  url: string;
  size: number;
  className?: string;
}) {
  const small = boardThumbSrc(url, size <= 56 ? 112 : 224);
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const src = failedFor === url ? url : small;
  return (
    <Image
      src={src}
      alt=""
      width={size}
      height={size}
      className={className}
      loading="lazy"
      decoding="async"
      onError={() => {
        if (src !== url) setFailedFor(url);
      }}
      unoptimized
    />
  );
}
