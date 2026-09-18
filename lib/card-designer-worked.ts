/** Seconds shown on a board card for designer time on that job. */
export function designerWorkedDisplaySeconds(parts: {
  boardTotal: number;
  myTotal: number;
  liveElapsed: number;
}): number {
  return Math.max(
    0,
    Math.floor(parts.boardTotal),
    Math.floor(parts.myTotal),
    Math.floor(parts.liveElapsed)
  );
}
