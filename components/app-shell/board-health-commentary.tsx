"use client";

/** Split AI briefing so Top 3 bottlenecks + Next actions render highlighted. */
export function AnalyzeCommentary({ text }: { text: string }) {
  const parts = splitAnalyzeSections(text);

  return (
    <div className="space-y-2">
      {parts.before ? (
        <div className="whitespace-pre-wrap">{parts.before}</div>
      ) : null}
      {parts.bottlenecks.length > 0 ? (
        <div className="rounded-md border border-orange-200 bg-orange-50 px-2.5 py-2">
          <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-orange-900">
            Top 3 bottlenecks
          </p>
          <ol className="space-y-1.5">
            {parts.bottlenecks.map((item, i) => (
              <li
                key={i}
                className="flex gap-2 text-xs leading-snug text-orange-950"
              >
                <span className="mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-orange-200 text-[10px] font-bold text-orange-900">
                  {i + 1}
                </span>
                <span className="font-semibold">{item}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      {parts.middle ? (
        <div className="whitespace-pre-wrap">{parts.middle}</div>
      ) : null}
      {parts.actions.length > 0 ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2">
          <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-amber-900">
            Next actions
          </p>
          <ol className="space-y-1.5">
            {parts.actions.map((item, i) => (
              <li
                key={i}
                className="flex gap-2 text-xs leading-snug text-amber-950"
              >
                <span className="mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-amber-200 text-[10px] font-bold text-amber-900">
                  {i + 1}
                </span>
                <span className="font-semibold">{item}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}

function parseNumberedBlock(after: string): string[] {
  const items: string[] = [];
  for (const raw of after.split(/\n+/)) {
    const line = raw.trim();
    if (!line) continue;
    if (
      /^(?:Next actions?|Next steps?|Top\s*3\s*bottlenecks)\s*:?\s*$/i.test(
        line
      )
    ) {
      break;
    }
    if (
      items.length > 0 &&
      !/^[•\-\*]/.test(line) &&
      !/^\d+[.)]/.test(line)
    ) {
      break;
    }
    const cleaned = line
      .replace(/^[•\-\*]\s*/, "")
      .replace(/^\d+[.)]\s*/, "")
      .trim();
    if (cleaned) items.push(cleaned);
    if (items.length >= 3) break;
  }
  return items;
}

/** Bytes from start of `body` through the end of `count` numbered/bullet lines. */
function consumeListedItems(body: string, count: number): number {
  const trimmed = body.trimStart();
  let consumed = body.length - trimmed.length;
  let found = 0;
  for (const raw of trimmed.split(/(\n+)/)) {
    consumed += raw.length;
    const line = raw.trim();
    if (!line) continue;
    if (/^\d+[.)]/.test(line) || /^[•\-\*]/.test(line)) {
      found += 1;
      if (found >= count) break;
    } else if (found > 0) {
      consumed -= raw.length;
      break;
    }
  }
  return consumed;
}

function splitAnalyzeSections(text: string): {
  before: string;
  bottlenecks: string[];
  middle: string;
  actions: string[];
} {
  const bnMatch = text.match(/(?:^|\n)\s*Top\s*3\s*bottlenecks\s*:?\s*\n?/i);
  const actMatch = text.match(
    /(?:^|\n)\s*(?:Next actions?|Next steps?)\s*:?\s*\n?/i
  );

  const bnIdx = bnMatch?.index ?? -1;
  const actIdx = actMatch?.index ?? -1;

  if (bnIdx < 0 && actIdx < 0) {
    return {
      before: text.trim(),
      bottlenecks: [],
      middle: "",
      actions: [],
    };
  }

  if (bnIdx >= 0) {
    const bnBodyStart = bnIdx + bnMatch![0].length;
    const bnBodyEnd = actIdx > bnIdx ? actIdx : text.length;
    const bnBody = text.slice(bnBodyStart, bnBodyEnd);
    const bottlenecks = parseNumberedBlock(bnBody);
    const afterList = bnBodyStart + consumeListedItems(bnBody, bottlenecks.length);

    const before = text.slice(0, bnIdx).trim();
    if (actIdx > bnIdx) {
      return {
        before,
        bottlenecks,
        middle: text.slice(afterList, actIdx).trim(),
        actions: parseNumberedBlock(
          text.slice(actIdx + actMatch![0].length)
        ),
      };
    }
    return {
      before,
      bottlenecks,
      middle: text.slice(afterList).trim(),
      actions: [],
    };
  }

  return {
    before: text.slice(0, actIdx).trim(),
    bottlenecks: [],
    middle: "",
    actions: parseNumberedBlock(text.slice(actIdx + actMatch![0].length)),
  };
}
