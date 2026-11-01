import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

let cached: boolean | null = null;

export async function ffmpegAvailable(): Promise<boolean> {
  if (cached !== null) return cached;
  try {
    await run("ffmpeg", ["-version"], { timeout: 5000, windowsHide: true });
    cached = true;
  } catch {
    cached = false;
  }
  return cached;
}

async function durationSeconds(file: string): Promise<number | null> {
  try {
    const { stdout } = await run(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file],
      { timeout: 15000, windowsHide: true },
    );
    const d = Number(stdout.trim());
    return Number.isFinite(d) && d > 0 ? d : null;
  } catch {
    return null;
  }
}

/** Sample up to `max` evenly spaced JPEG frames (768px wide) from a video. */
export async function extractFrames(videoPath: string, outDir: string, max = 8): Promise<string[]> {
  fs.mkdirSync(outDir, { recursive: true });
  const dur = await durationSeconds(videoPath);
  const fps = dur ? Math.min(2, max / dur) : 1;
  await run(
    "ffmpeg",
    ["-hide_banner", "-loglevel", "error", "-y", "-i", videoPath, "-vf", `fps=${fps.toFixed(4)},scale=768:-2`, "-frames:v", String(max), "-q:v", "3", path.join(outDir, "frame_%02d.jpg")],
    { timeout: 120000, windowsHide: true },
  );
  return fs
    .readdirSync(outDir)
    .filter((f) => /^frame_\d+\.jpg$/.test(f))
    .sort()
    .map((f) => path.join(outDir, f));
}
