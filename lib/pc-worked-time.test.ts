import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pcWorkedSeconds, pcWorkedSecondsByLocalDay } from "./pc-worked-time.ts";

describe("pcWorkedSeconds", () => {
  it("counts overlapping jobs for one person once", () => {
    const seconds = pcWorkedSeconds([
      {
        user_id: "a",
        started_at: "2026-09-15T10:00:00.000Z",
        ended_at: "2026-09-15T12:00:00.000Z",
      },
      {
        user_id: "a",
        started_at: "2026-09-15T11:00:00.000Z",
        ended_at: "2026-09-15T13:00:00.000Z",
      },
    ]);
    assert.equal(seconds, 3 * 3600);
  });

  it("adds separate people instead of merging their clocks", () => {
    const seconds = pcWorkedSeconds([
      {
        user_id: "a",
        started_at: "2026-09-15T10:00:00.000Z",
        ended_at: "2026-09-15T11:00:00.000Z",
      },
      {
        user_id: "b",
        started_at: "2026-09-15T10:00:00.000Z",
        ended_at: "2026-09-15T11:00:00.000Z",
      },
    ]);
    assert.equal(seconds, 2 * 3600);
  });

  it("clips a paused timer at paused_at", () => {
    const seconds = pcWorkedSeconds([
      {
        user_id: "a",
        started_at: "2026-09-15T10:00:00.000Z",
        ended_at: null,
        paused_at: "2026-09-15T10:30:00.000Z",
      },
    ]);
    assert.equal(seconds, 30 * 60);
  });

  it("does not count pause gaps as PC time", () => {
    const seconds = pcWorkedSeconds([
      {
        user_id: "a",
        started_at: "2026-09-14T10:00:00.000Z",
        ended_at: "2026-09-15T16:00:00.000Z",
        paused_seconds: 24 * 3600,
      },
    ]);
    // 30h wall − 24h paused = 6h worked, not 30h at the desk
    assert.equal(seconds, 6 * 3600);
  });
});

describe("pcWorkedSecondsByLocalDay", () => {
  it("puts overlapping same-day jobs on one calendar day", () => {
    const start = new Date(2026, 8, 15, 10, 0, 0).toISOString();
    const mid = new Date(2026, 8, 15, 11, 0, 0).toISOString();
    const endA = new Date(2026, 8, 15, 12, 0, 0).toISOString();
    const endB = new Date(2026, 8, 15, 13, 0, 0).toISOString();
    const byDay = pcWorkedSecondsByLocalDay([
      { user_id: "a", started_at: start, ended_at: endA },
      { user_id: "a", started_at: mid, ended_at: endB },
    ]);
    assert.equal(byDay.get("2026-09-15"), 3 * 3600);
    assert.equal(byDay.size, 1);
  });

  it("splits a session that crosses local midnight", () => {
    const start = new Date(2026, 8, 15, 23, 0, 0).toISOString();
    const end = new Date(2026, 8, 16, 1, 0, 0).toISOString();
    const byDay = pcWorkedSecondsByLocalDay([
      { user_id: "a", started_at: start, ended_at: end },
    ]);
    assert.equal(byDay.get("2026-09-15"), 3600);
    assert.equal(byDay.get("2026-09-16"), 3600);
  });

  it("does not spread paused overnight time across chart days", () => {
    const start = new Date(2026, 8, 14, 8, 0, 0).toISOString();
    const pausedAt = new Date(2026, 8, 15, 15, 0, 0).toISOString();
    const wallSec = Math.floor(
      (new Date(pausedAt).getTime() - new Date(start).getTime()) / 1000
    );
    const workedSec = 6 * 3600;
    const byDay = pcWorkedSecondsByLocalDay([
      {
        user_id: "a",
        started_at: start,
        ended_at: null,
        paused_at: pausedAt,
        paused_seconds: wallSec - workedSec,
      },
    ]);
    const total = [...byDay.values()].reduce((s, n) => s + n, 0);
    assert.equal(total, workedSec);
    assert.ok((byDay.get("2026-09-14") ?? 0) < 8 * 3600);
  });
});
