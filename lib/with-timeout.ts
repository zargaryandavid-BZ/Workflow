export function rejectAfter(
  ms: number,
  message: string
): { promise: Promise<never>; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return {
    promise,
    cancel: () => {
      if (timer !== undefined) clearTimeout(timer);
    },
  };
}
