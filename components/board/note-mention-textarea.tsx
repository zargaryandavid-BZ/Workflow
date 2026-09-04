"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type TextareaHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import { Textarea } from "@/components/ui/input";
import { filterMentionMembers, mentionQueryAtCursor } from "@/lib/note-mentions";
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

type ListBox = {
  left: number;
  width: number;
  maxHeight: number;
  top?: number;
  bottom?: number;
};

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
  const [box, setBox] = useState<ListBox | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    void loadMentionableMembers().then(setMembers);
  }, []);

  const filtered = filterMentionMembers(members, query);
  const show = open && start != null && filtered.length > 0;

  const placeList = useCallback(() => {
    const el = taRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const gap = 4;
    const spaceBelow = window.innerHeight - r.bottom - gap - 8;
    const spaceAbove = r.top - gap - 8;
    const openUp = spaceBelow < 140 && spaceAbove > spaceBelow;
    const maxHeight = Math.min(240, Math.max(96, openUp ? spaceAbove : spaceBelow));
    setBox({
      left: r.left,
      width: r.width,
      maxHeight,
      ...(openUp
        ? { bottom: window.innerHeight - r.top + gap }
        : { top: r.bottom + gap }),
    });
  }, []);

  useLayoutEffect(() => {
    if (!show) {
      setBox(null);
      return;
    }
    placeList();
    window.addEventListener("resize", placeList);
    window.addEventListener("scroll", placeList, true);
    return () => {
      window.removeEventListener("resize", placeList);
      window.removeEventListener("scroll", placeList, true);
    };
  }, [show, filtered.length, placeList]);

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

  const list =
    show && mounted && box
      ? createPortal(
          <ul
            id={listId}
            role="listbox"
            className="overflow-y-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg"
            style={{
              position: "fixed",
              zIndex: 220,
              left: box.left,
              width: box.width,
              maxHeight: box.maxHeight,
              top: box.top,
              bottom: box.bottom,
            }}
          >
            {filtered.map((m, i) => (
              <li key={m.id} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  className={cn(
                    "w-full px-3 py-1.5 text-left text-sm leading-snug text-slate-700",
                    i === active ? "bg-slate-100 text-slate-900" : "hover:bg-slate-50"
                  )}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => insertMember(m)}
                >
                  {m.fullName}
                </button>
              </li>
            ))}
          </ul>,
          document.body
        )
      : null;

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
      {list}
    </div>
  );
}
