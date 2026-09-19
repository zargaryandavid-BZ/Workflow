export function FulfillmentOrderThumb({
  url,
  label,
}: {
  url?: string | null;
  label: string;
}) {
  return (
    <span className="inline-flex h-7 w-7 shrink-0 overflow-hidden rounded border border-slate-200 bg-slate-100">
      {url ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={url}
          alt=""
          title={label}
          className="h-full w-full object-cover"
        />
      ) : null}
    </span>
  );
}
