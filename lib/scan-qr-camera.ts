/**
 * Start a QR/barcode scanner on a video element with a requested camera.
 * Falls back to the other camera if the requested camera is unavailable.
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

export type QrCameraFacing = "user" | "environment";

export interface QrScannerController {
  stop: () => void;
  destroy: () => void;
  setCamera: (facing: QrCameraFacing) => Promise<void>;
}

export async function startQrScanner(
  video: HTMLVideoElement,
  onCode: (code: string) => void,
  preferredCamera: QrCameraFacing = "user"
): Promise<QrScannerController> {
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
      preferredCamera,
    }
  );
  try {
    await scanner.start();
  } catch {
    try {
      await scanner.setCamera(
        preferredCamera === "user" ? "environment" : "user"
      );
    } catch {
      scanner.stop();
      scanner.destroy();
      throw new Error("Could not start camera");
    }
  }

  async function setCamera(facing: QrCameraFacing) {
    const cameras = await QrScanner.listCameras(true).catch(() => []);
    let selected: { id: string; label: string } | undefined;
    if (cameras.length === 1) {
      // Desktop device emulation exposes one webcam, not separate phone
      // cameras. Keep that stream instead of selecting a nonexistent camera.
      selected = cameras[0];
    } else if (cameras.length > 1) {
      const pattern =
        facing === "environment"
          ? /\b(back|rear|environment|world|outward)\b/i
          : /\b(front|user|face|facetime|selfie)\b/i;
      selected = cameras.find((camera) => pattern.test(camera.label));
      selected ??=
        facing === "environment"
          ? cameras[cameras.length - 1]
          : cameras[0];
    }
    await scanner.setCamera(selected?.id ?? facing);
    try {
      await video.play();
    } catch {
      // QrScanner owns the stream; a subsequent user gesture can resume it.
    }
  }

  return {
    stop: () => scanner.stop(),
    destroy: () => scanner.destroy(),
    setCamera,
  };
}

/** Backwards-compatible front-camera entry point. */
export async function startFrontQrScanner(
  video: HTMLVideoElement,
  onCode: (code: string) => void
): Promise<QrScannerController> {
  return startQrScanner(video, onCode, "user");
}
