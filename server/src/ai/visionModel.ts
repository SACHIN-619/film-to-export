export interface ImageInput {
  mime: string;
  data: Buffer;
}

export interface GenerateOptions {
  /** Called before each retry / model switch, so callers can show "model busy, retrying…". */
  onRetry?: (info: { attempt: number; status: number | undefined; waitMs: number; model: string; reason?: string }) => void;
}

/** A 429 that won't clear in seconds (daily free-tier quota, "retry in 5h…"): retrying the same model is pointless. */
export function isLongQuotaError(err: unknown): boolean {
  if (!(err instanceof AiProviderError) || err.status !== 429) return false;
  return /per day|perday|retry in \d+h|retry in \d{3,}(\.\d+)?s/i.test(err.message);
}

/** Provider-neutral adapter. Implementations return the model's raw text (expected JSON). */
export interface VisionModel {
  readonly name: string;
  /** The model that actually answered the last call (may be the fallback). */
  readonly lastModelUsed?: string;
  generateJson(prompt: string, images: ImageInput[], opts?: GenerateOptions): Promise<string>;
}

export class AiProviderError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "AiProviderError";
  }
}

type FetchFn = typeof fetch;

/** Google Gemini via REST generateContent. The key goes in a header, never the URL. */
export class GeminiVisionModel implements VisionModel {
  readonly name: string;
  lastModelUsed?: string;

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly fetchFn: FetchFn = fetch,
    private readonly opts: { fallbackModel?: string | null; retries?: number; backoffMs?: number[] } = {},
  ) {
    this.name = `gemini:${model}`;
  }

  /**
   * Retries 429/5xx ("model is experiencing high demand") with backoff, then tries the
   * optional fallback model once through the same retry loop.
   */
  async generateJson(prompt: string, images: ImageInput[], opts: GenerateOptions = {}): Promise<string> {
    const backoff = this.opts.backoffMs ?? [2000, 5000, 9000];
    const retries = this.opts.retries ?? backoff.length;
    const models = [this.model, ...(this.opts.fallbackModel && this.opts.fallbackModel !== this.model ? [this.opts.fallbackModel] : [])];
    let firstErr: unknown;
    for (const [mi, model] of models.entries()) {
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          const text = await this.callOnce(model, prompt, images);
          this.lastModelUsed = model;
          return text;
        } catch (err) {
          firstErr ??= err;
          const status = err instanceof AiProviderError ? err.status : undefined;
          const transient = status === undefined || status === 429 || status >= 500;
          const longQuota = isLongQuotaError(err);
          if (!transient || longQuota || attempt === retries) {
            const next = models[mi + 1];
            if (next) {
              opts.onRetry?.({
                attempt: attempt + 1,
                status,
                waitMs: 0,
                model: next,
                reason: longQuota ? `Daily quota for ${model} is used up; switching to ${next}` : `${model} unavailable; switching to ${next}`,
              });
            }
            break;
          }
          const waitMs = backoff[Math.min(attempt, backoff.length - 1)];
          opts.onRetry?.({ attempt: attempt + 1, status, waitMs, model });
          await new Promise((r) => setTimeout(r, waitMs));
        }
      }
    }
    // Report the primary model's error: it's the one the operator needs to see.
    throw firstErr;
  }

  private async callOnce(model: string, prompt: string, images: ImageInput[]): Promise<string> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const parts = [
      { text: prompt },
      ...images.map((img) => ({ inline_data: { mime_type: img.mime, data: img.data.toString("base64") } })),
    ];
    const res = await this.fetchFn(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.3 },
      }),
    });
    if (!res.ok) {
      let detail = "";
      try {
        detail = ((await res.json()) as { error?: { message?: string } }).error?.message ?? "";
      } catch {
        /* ignore */
      }
      throw new AiProviderError(`Gemini request failed (${res.status}) ${detail}`.trim(), res.status);
    }
    const json = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
    };
    const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    if (!text) throw new AiProviderError(`Gemini returned no text (${json.candidates?.[0]?.finishReason ?? "no candidates"})`);
    return text;
  }
}
