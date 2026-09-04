"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type TextareaHTMLAttributes,
} from "react";
import { Textarea } from "@/components/ui/input";
import { mentionQueryAtCursor } from "@/lib/note-mentions";
import { cn } from "@/lib/utils";

type Member = { id: string; fullName: string };

let cachedMembers: Member[] | null = null;
let membersLoad: Promise<Member[]> | null = null;

function loadMentionableMembers(): Promise<Member[]> {
  if (cachedMembers) return Promise.resolve(cachedMembers);
  if (!membersLoad) {
    membersLoad = fetch("/api/members/mentionable", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) return [];
        const json = (await res.json()) as { members?: Member[] };
        const list = Array.isArray(json.members) ? json.members : [];
        cachedMembers = list;
        return list;
      })
      .catch(() => [])
      .finally(() => {
        membersLoad = null;
      });
  }
  return membersLoad;
}

type Props = Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  "onChange" | "value"
> & {
  value: string;
  onChange: (value: string) => void;
};

export function NoteMentionTextarea({
  value,
  onChange,
  className,
  onKeyDown,
  ...props
}: Props) {
  const listId = useId();
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [members, setMembers] = useState<Member[]>(cachedMembers ?? []);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [start, setStart] = useState<number | null>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    void loadMentionableMembers().then(setMembers);
  }, []);

  const filtered = members.filter((m) =>
    m.fullName.toLowerCase().includes(query.trim().toLowerCase())
  );
  const show = open && start != null && filtered.length > 0;

  const refreshMention = useCallback((next: string, cursor: number) => {
    const hit = mentionQueryAtCursor(next, cursor);
    if (!hit) {
      setOpen(false);
      setStart(null);
      setQuery("");
      return;
    }
    setStart(hit.start);
    setQuery(hit.query);
    setOpen(true);
    setActive(0);
  }, []);

  function insertMember(member: Member) {
    if (start == null) return;
    const el = taRef.current;
    const cursor = el?.selectionStart ?? value.length;
    const before = value.slice(0, start);
    const after = value.slice(cursor);
    const next = `${before}@${member.fullName} ${after}`;
    const caret = before.length + member.fullName.length + 2;
    onChange(next);
    setOpen(false);
    setStart(null);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(caret, caret);
    });
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    onKeyDown?.(e);
    if (e.defaultPrevented || !show) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % filtered.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + filtered.length) % filtered.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      const pick = filtered[active];
      if (pick) {
        e.preventDefault();
        insertMember(pick);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  }

  return (
    <div className="relative">
      <Textarea
        {...props}
        ref={taRef}
        value={value}
        className={className}
        role="combobox"
        aria-expanded={show}
        aria-controls={show ? listId : undefined}
        aria-autocomplete="list"
        onChange={(e) => {
          const next = e.target.value;
          onChange(next);
          refreshMention(next, e.target.selectionStart);
        }}
        onKeyDown={handleKeyDown}
        onClick={(e) => {
          props.onClick?.(e);
          refreshMention(value, e.currentTarget.selectionStart);
        }}
        onBlur={() => {
          window.setTimeout(() => setOpen(false), 150);
        }}
      />
      {show ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg"
        >
          {filtered.map((m, i) => (
            <li key={m.id} role="option" aria-selected={i === active}>
              <button
                type="button"
                className={cn(
                  "w-full px-3 py-1.5 text-left text-sm",
                  i === active ? "bg-slate-100 text-slate-900" : "text-slate-700 hover:bg-slate-50"
                )}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => insertMember(m)}
              >
                {m.fullName}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
