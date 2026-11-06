import assert from "node:assert/strict";
import test from "node:test";
import {
  dieBoardStatusLabel,
  diePortalFiles,
  dieRequestAlert,
  dieTodayYmd,
  dieReminderDue,
  dieReminderLabel,
  isDieDatePast,
  parseDieRequestStatus,
  pickDieBoardStatus,
} from "./die-request.ts";

test("parseDieRequestStatus reads received", () => {
  assert.equal(parseDieRequestStatus("received"), "received");
  assert.equal(parseDieRequestStatus("ordered"), "ordered");
  assert.equal(parseDieRequestStatus("weird"), "sent");
});

test("a received die never shows an overdue alarm", () => {
  const late = { required_date: "2026-10-01", confirmed_due_date: "2026-10-02" };
  assert.equal(
    dieRequestAlert({ ...late, status: "ordered" }, "2026-11-05")?.level,
    "overdue"
  );
  assert.equal(dieRequestAlert({ ...late, status: "received" }, "2026-11-05"), null);
});

test("board label shows the received day; a die still on order wins", () => {
  assert.equal(
    dieBoardStatusLabel({
      status: "received",
      confirmed_due_date: "2026-10-02",
      received_at: "2026-10-03T18:00:00.000Z",
    }),
    "Die received - 03.10"
  );
  const picked = pickDieBoardStatus([
    { status: "ordered", confirmed_due_date: "2026-10-02", created_at: "2026-10-05" },
    {
      status: "received",
      confirmed_due_date: "2026-10-02",
      created_at: "2026-09-01",
      received_at: "2026-10-03T18:00:00.000Z",
    },
  ]);
  assert.equal(picked?.status, "ordered");
  assert.equal(
    pickDieBoardStatus([
      {
        status: "received",
        confirmed_due_date: "2026-10-02",
        created_at: "2026-09-01",
        received_at: "2026-10-03T18:00:00.000Z",
      },
    ])?.label,
    "Die received - 03.10"
  );
});

test("public request files include a linked die PDF without duplicating it", () => {
  const request = {
    files: [
      {
        path: "tenant/order/reference.png",
        name: "reference.png",
        mime: "image/png",
      },
    ],
    file_path: null,
    file_name: null,
    file_mime: null,
  };
  const die = {
    pdf_path: "tenant/dies/die-1/cut.pdf",
    pdf_name: "cut.pdf",
  };

  const files = diePortalFiles(request, die);
  assert.deepEqual(
    files.map((file) => file.name),
    ["cut.pdf", "reference.png"]
  );
  assert.equal(diePortalFiles({ ...request, files }, die).length, 2);
});

test("die dates: today is in shop time and past dates are refused", () => {
  // 2026-11-06 03:00 UTC is still Nov 5 in Los Angeles.
  assert.equal(dieTodayYmd(new Date("2026-11-06T03:00:00Z")), "2026-11-05");
  assert.equal(dieTodayYmd(new Date("2026-11-06T09:00:00Z")), "2026-11-06");
  assert.equal(isDieDatePast("2026-10-29", "2026-11-05"), true);
  assert.equal(isDieDatePast("2026-11-05", "2026-11-05"), false);
  assert.equal(isDieDatePast("2026-11-20", "2026-11-05"), false);
  assert.equal(isDieDatePast("garbage", "2026-11-05"), false);
});

test("manufacturer reminders: after 2 days, then every 2 days, 3 at most, only while waiting", () => {
  const sent = { status: "sent" as const, sent_at: "2026-11-01T17:00:00Z", reminder_count: 0, last_reminder_at: null };
  assert.equal(dieReminderDue(sent, new Date("2026-11-02T17:00:00Z")), false); // 1 day
  assert.equal(dieReminderDue(sent, new Date("2026-11-03T17:00:00Z")), true); // 2 days
  const once = { ...sent, reminder_count: 1, last_reminder_at: "2026-11-03T17:00:00Z" };
  assert.equal(dieReminderDue(once, new Date("2026-11-04T17:00:00Z")), false);
  assert.equal(dieReminderDue(once, new Date("2026-11-05T17:00:00Z")), true);
  assert.equal(dieReminderDue({ ...once, reminder_count: 3 }, new Date("2026-12-01T17:00:00Z")), false);
  assert.equal(dieReminderDue({ ...sent, status: "quoted" }, new Date("2026-12-01T17:00:00Z")), false);
  assert.equal(dieReminderLabel({ reminder_count: 0, last_reminder_at: null }), null);
  assert.equal(dieReminderLabel({ reminder_count: 2, last_reminder_at: null }), "Reminded 2×");
});
