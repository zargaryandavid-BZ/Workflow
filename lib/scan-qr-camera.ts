/**
 * Start a QR/barcode scanner on a video element, preferring the front (user)
 * camera for tablets. Falls back to the rear camera if the front is unavailable.
 */

let beepCtx: AudioContext | null = null;

function ensureBeepCtx(): AudioContext | null {
  try {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AC) return null;
    if (!beepCtx) beepCtx = new AC();
    void beepCtx.resume();
    return beepCtx;
  } catch {
    return null;
  }
}

function playScanBeep() {
  try {
    const ctx = ensureBeepCtx();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = 1800;
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(0.18, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.14);
  } catch {
    // Autoplay / AudioContext restrictions — scan still succeeds.
  }
}

export async function startFrontQrScanner(
  video: HTMLVideoElement,
  onCode: (code: string) => void
): Promise<{ stop: () => void; destroy: () => void }> {
  ensureBeepCtx();
  const { default: QrScanner } = await import("qr-scanner");
  let handled = false;
  const scanner = new QrScanner(
    video,
    (result: { data: string }) => {
      const code = result.data.trim();
      if (!code || handled) return;
      handled = true;
      playScanBeep();
      onCode(code);
    },
    {
      returnDetailedScanResult: true,
      highlightScanRegion: true,
      highlightCodeOutline: true,
      preferredCamera: "user",
    }
  );
  try {
    await scanner.start();
  } catch {
    try {
      await scanner.setCamera("environment");
    } catch {
      scanner.stop();
      scanner.destroy();
      throw new Error("Could not start camera");
    }
  }
  return scanner;
}
