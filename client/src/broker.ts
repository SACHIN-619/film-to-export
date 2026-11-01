import type { BrokerEvent } from "./types";

/**
 * Read a streamed broker run (Server-Sent Events over a POST) and call onEvent per step.
 * EventSource can't POST multipart, so we parse the "data: …\n\n" stream ourselves.
 */
export async function streamBroker(url: string, init: RequestInit, onEvent: (e: BrokerEvent) => void): Promise<void> {
  const res = await fetch(url, init);
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => null);
    throw new Error((body as { error?: string } | null)?.error ?? `Broker request failed (${res.status})`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      if (block.startsWith("data: ")) onEvent(JSON.parse(block.slice(6)) as BrokerEvent);
    }
  }
}

/** Tiny 8×8 luminance signature, enough to tell whether two frames differ. */
function fingerprint(ctx: CanvasRenderingContext2D, w: number, h: number): string {
  const out: number[] = [];
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const [r, g, b] = ctx.getImageData(Math.floor(((x + 0.5) * w) / 8), Math.floor(((y + 0.5) * h) / 8), 1, 1).data;
      out.push(Math.round((0.3 * r + 0.59 * g + 0.11 * b) / 16));
    }
  }
  return out.join(",");
}

const waitFor = (target: EventTarget, event: string, ms: number) =>
  new Promise<boolean>((resolve) => {
    const t = setTimeout(() => done(false), ms);
    const done = (ok: boolean) => {
      clearTimeout(t);
      target.removeEventListener(event, onEvent);
      resolve(ok);
    };
    const onEvent = () => done(true);
    target.addEventListener(event, onEvent);
  });

/**
 * Sample `count` evenly spaced JPEG frames from a video, in the browser (no ffmpeg needed).
 * Phone videos seek fine; browser-recorded WebM often has no duration or seek index, so we
 * fix the duration with the "seek to the end" trick, time out stuck seeks, and fall back to
 * grabbing frames while the video plays (muted, sped up).
 */
export async function videoToFrames(file: File, count = 6, maxSide = 1280): Promise<Blob[]> {
  const url = URL.createObjectURL(file);
  const v = document.createElement("video");
  try {
    v.src = url;
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    await new Promise<void>((resolve, reject) => {
      v.onloadeddata = () => resolve();
      v.onerror = () => reject(new Error("This browser can't read that video. Try photos instead."));
    });
    if (!Number.isFinite(v.duration)) {
      v.currentTime = 1e7; // forces Chrome to compute the real duration of streamed WebM
      await waitFor(v, "durationchange", 3000);
      v.currentTime = 0;
      await waitFor(v, "seeked", 2000);
    }
    const duration = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : null;
    const scale = Math.min(1, maxSide / Math.max(v.videoWidth, v.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(v.videoWidth * scale);
    canvas.height = Math.round(v.videoHeight * scale);
    const ctx = canvas.getContext("2d")!;
    const prints: string[] = [];
    const grab = () => {
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
      prints.push(fingerprint(ctx, canvas.width, canvas.height));
      return new Promise<Blob>((r, j) => canvas.toBlob((b) => (b ? r(b) : j(new Error("frame encode failed"))), "image/jpeg", 0.85));
    };
    // Wait until the frame for the new position is actually presented (when supported).
    const presented = () =>
      "requestVideoFrameCallback" in v
        ? new Promise<void>((r) => {
            const t = setTimeout(r, 600);
            (v as HTMLVideoElement & { requestVideoFrameCallback(cb: () => void): number }).requestVideoFrameCallback(() => {
              clearTimeout(t);
              r();
            });
          })
        : new Promise<void>((r) => setTimeout(r, 120));

    // 1) Seek to evenly spaced times.
    if (duration) {
      const frames: Blob[] = [];
      let ok = true;
      for (let i = 0; i < count && ok; i++) {
        v.currentTime = Math.min(duration - 0.05, (duration * (i + 0.5)) / count);
        ok = await waitFor(v, "seeked", 2500);
        if (ok) {
          await presented();
          frames.push(await grab());
        }
      }
      // Unindexed WebM can "seek" without moving: identical frames mean the seek didn't work.
      const distinct = new Set(prints).size;
      if (ok && (distinct > 1 || count === 1)) return frames;
      prints.length = 0;
    }

    // 2) Fallback: play it (muted, 4×) and grab frames at evenly spaced media times.
    const span = duration ?? 30;
    const targets = Array.from({ length: count }, (_, i) => (span * (i + 0.5)) / count);
    const frames: Blob[] = [];
    v.currentTime = 0;
    v.playbackRate = 4;
    await v.play();
    await new Promise<void>((resolve) => {
      const tick = async () => {
        while (frames.length < targets.length && v.currentTime >= targets[frames.length]) frames.push(await grab());
        if (frames.length >= targets.length || v.ended) return resolve();
        // A timer, not requestAnimationFrame: rAF pauses in background tabs.
        setTimeout(() => void tick(), 40);
      };
      v.onended = () => resolve();
      void tick();
    });
    v.pause();
    if (frames.length === 0) frames.push(await grab());
    return frames;
  } finally {
    v.removeAttribute("src");
    v.load();
    URL.revokeObjectURL(url);
  }
}

/**
 * Decode any audio (or a video's soundtrack) and re-encode as 16 kHz mono 16-bit WAV.
 * Gemini's documented audio formats are WAV/MP3/AAC/OGG/FLAC; Chrome records WebM/Opus,
 * so we normalise everything to WAV. Returns null when the file has no audio track.
 */
export async function toSpeechWav(file: Blob, maxSeconds = 90): Promise<Blob | null> {
  const ctx = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData(await file.arrayBuffer());
  } catch {
    return null;
  } finally {
    void ctx.close();
  }
  const rate = 16000;
  const seconds = Math.min(decoded.duration, maxSeconds);
  const offline = new OfflineAudioContext(1, Math.ceil(seconds * rate), rate);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start();
  const mono = (await offline.startRendering()).getChannelData(0);

  const bytes = new DataView(new ArrayBuffer(44 + mono.length * 2));
  const str = (o: number, s: string) => [...s].forEach((c, i) => bytes.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  bytes.setUint32(4, 36 + mono.length * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  bytes.setUint32(16, 16, true);
  bytes.setUint16(20, 1, true); // PCM
  bytes.setUint16(22, 1, true); // mono
  bytes.setUint32(24, rate, true);
  bytes.setUint32(28, rate * 2, true);
  bytes.setUint16(32, 2, true);
  bytes.setUint16(34, 16, true);
  str(36, "data");
  bytes.setUint32(40, mono.length * 2, true);
  for (let i = 0; i < mono.length; i++) {
    const s = Math.max(-1, Math.min(1, mono[i]));
    bytes.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([bytes], { type: "audio/wav" });
}
