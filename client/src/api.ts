export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(`/api${path}`, {
    ...rest,
    headers: json !== undefined ? { "Content-Type": "application/json", ...rest.headers } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const issues = (body as { issues?: { path: string; message: string }[] } | null)?.issues;
    const msg = (body as { error?: string } | null)?.error ?? `Request failed (${res.status})`;
    throw new ApiError(issues?.length ? `${msg}: ${issues.map((i) => `${i.path} ${i.message}`).join("; ")}` : msg, res.status, body);
  }
  return body as T;
}

export const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export const GRADE_LABEL: Record<string, string> = { new: "New", like_new: "Like new", good: "Good", fair: "Fair" };

/** Downscale a photo in the browser so uploads stay small (≤1600px, JPEG). */
export async function resizeImage(file: File, max = 1600): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not encode image"))), "image/jpeg", 0.86),
  );
}
