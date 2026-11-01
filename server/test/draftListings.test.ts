import { describe, expect, it } from "vitest";
import { AiOutputError, draftListings, parseDraft } from "../src/ai/draftListings.js";
import { FIXTURE_DRAFT } from "../src/ai/fixtures.js";
import type { ImageInput, VisionModel } from "../src/ai/visionModel.js";
import { GeminiVisionModel } from "../src/ai/visionModel.js";

/** Returns the scripted responses in order and records the prompts it was given. */
class ScriptedModel implements VisionModel {
  readonly name = "scripted";
  prompts: { prompt: string; images: number }[] = [];
  constructor(private responses: string[]) {}
  async generateJson(prompt: string, images: ImageInput[]) {
    this.prompts.push({ prompt, images: images.length });
    const next = this.responses.shift();
    if (next === undefined) throw new Error("no more scripted responses");
    return next;
  }
}

const imgs: ImageInput[] = [0, 1, 2].map(() => ({ mime: "image/jpeg", data: Buffer.from("x") }));
const valid = JSON.stringify({ items: [structuredClone(FIXTURE_DRAFT.items[0])] });

describe("AI output schema validation", () => {
  it("accepts a valid draft on the first try (no repair)", async () => {
    const model = new ScriptedModel([valid]);
    const out = await draftListings(model, imgs, "Spanish");
    expect(out.repaired).toBe(false);
    expect(out.draft.items).toHaveLength(1);
    expect(model.prompts).toHaveLength(1);
    expect(model.prompts[0].images).toBe(3);
    expect(model.prompts[0].prompt).toContain("Spanish");
  });

  it("tolerates a ```json fenced response", () => {
    expect(parseDraft("```json\n" + valid + "\n```").ok).toBe(true);
  });

  it("rejects bad HS codes, unknown grades, missing confidence and negative prices", () => {
    const bad = structuredClone(FIXTURE_DRAFT.items[0]) as Record<string, any>;
    bad.hs.code = "62-14";
    bad.condition.grade = "mint";
    bad.price.usd = -5;
    delete bad.confidence;
    const r = parseDraft(JSON.stringify({ items: [bad] }));
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    const joined = r.issues.join("\n");
    expect(joined).toMatch(/items\.0\.hs\.code/);
    expect(joined).toMatch(/items\.0\.condition\.grade/);
    expect(joined).toMatch(/items\.0\.price\.usd/);
    expect(joined).toMatch(/items\.0\.confidence/);
  });

  it("repairs once: invalid first answer, valid second answer", async () => {
    const broken = JSON.parse(valid);
    broken.items[0].hs.code = "HS6214";
    const model = new ScriptedModel([JSON.stringify(broken), valid]);
    const out = await draftListings(model, imgs, "Spanish");
    expect(out.repaired).toBe(true);
    expect(model.prompts).toHaveLength(2);
    expect(model.prompts[1].prompt).toContain("items.0.hs.code");
    expect(model.prompts[1].images).toBe(0); // repair is text-only
  });

  it("repairs non-JSON output too", async () => {
    const model = new ScriptedModel(["Sure! Here are your listings: {items: oops", valid]);
    const out = await draftListings(model, imgs, "Spanish");
    expect(out.repaired).toBe(true);
    expect(model.prompts[1].prompt).toContain("not valid JSON");
  });

  it("gives up after exactly one repair attempt", async () => {
    const model = new ScriptedModel(["{}", '{"items": []}', valid]);
    await expect(draftListings(model, imgs, "Spanish")).rejects.toBeInstanceOf(AiOutputError);
    expect(model.prompts).toHaveLength(2);
  });

  it("clamps out-of-range frame indices", async () => {
    const d = JSON.parse(valid);
    d.items[0].frame_indices = [9, 2];
    const out = await draftListings(new ScriptedModel([JSON.stringify(d)]), imgs, "Spanish");
    expect(out.draft.items[0].frame_indices).toEqual([2]);
  });
});

describe("GeminiVisionModel adapter", () => {
  it("sends the key in a header (not the URL), asks for JSON, and returns the text", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const fakeFetch = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: valid }] } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const m = new GeminiVisionModel("test-key-123", "gemini-test", fakeFetch);
    const text = await m.generateJson("hello", imgs.slice(0, 1));
    expect(text).toBe(valid);
    expect(seen!.url).not.toContain("test-key-123");
    expect((seen!.init.headers as Record<string, string>)["x-goog-api-key"]).toBe("test-key-123");
    const body = JSON.parse(String(seen!.init.body));
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.contents[0].parts[1].inline_data.mime_type).toBe("image/jpeg");
  });
});

describe("GeminiVisionModel resilience", () => {
  const ok = JSON.stringify({ candidates: [{ content: { parts: [{ text: "{}" }] } }] });
  const busy = JSON.stringify({ error: { message: "This model is currently experiencing high demand." } });

  it("retries 503 'high demand' with visible retry callbacks, then succeeds", async () => {
    const statuses = [503, 503, 200];
    const urls: string[] = [];
    const f = (async (url: string) => {
      urls.push(url);
      const s = statuses.shift()!;
      return new Response(s === 200 ? ok : busy, { status: s });
    }) as unknown as typeof fetch;
    const m = new GeminiVisionModel("k", "gemini-main", f, { backoffMs: [0, 0, 0] });
    const retries: number[] = [];
    expect(await m.generateJson("p", [], { onRetry: (r) => retries.push(r.status!) })).toBe("{}");
    expect(retries).toEqual([503, 503]);
    expect(urls.every((u) => u.includes("gemini-main"))).toBe(true);
  });

  it("falls back to the secondary model after retries are exhausted", async () => {
    const urls: string[] = [];
    const f = (async (url: string) => {
      urls.push(url);
      return url.includes("gemini-lite") ? new Response(ok, { status: 200 }) : new Response(busy, { status: 503 });
    }) as unknown as typeof fetch;
    const m = new GeminiVisionModel("k", "gemini-main", f, { fallbackModel: "gemini-lite", retries: 1, backoffMs: [0] });
    expect(await m.generateJson("p", [])).toBe("{}");
    expect(urls.filter((u) => u.includes("gemini-main"))).toHaveLength(2);
    expect(urls.at(-1)).toContain("gemini-lite");
  });

  it("does not retry a 400 (bad request)", async () => {
    let calls = 0;
    const f = (async () => {
      calls++;
      return new Response(JSON.stringify({ error: { message: "bad" } }), { status: 400 });
    }) as unknown as typeof fetch;
    const m = new GeminiVisionModel("k", "gemini-main", f, { backoffMs: [0, 0] });
    await expect(m.generateJson("p", [])).rejects.toThrow(/400/);
    expect(calls).toBe(1);
  });
});

describe("daily quota", () => {
  it("does not retry a per-day 429; switches to the fallback model at once and says why", async () => {
    const urls: string[] = [];
    const daily = JSON.stringify({ error: { message: "You exceeded your current quota... Generate content requests per day limit exceeded on Free Tier.\nPlease retry in 5h26m33s." } });
    const f = (async (url: string) => {
      urls.push(url);
      return url.includes("lite") ? new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "{}" }] } }] }), { status: 200 }) : new Response(daily, { status: 429 });
    }) as unknown as typeof fetch;
    const m = new GeminiVisionModel("k", "gemini-main", f, { fallbackModel: "gemini-lite", backoffMs: [0, 0, 0] });
    const notes: string[] = [];
    expect(await m.generateJson("p", [], { onRetry: (r) => notes.push(r.reason ?? "retry") })).toBe("{}");
    expect(urls.filter((u) => u.includes("gemini-main"))).toHaveLength(1);
    expect(notes).toEqual(["Daily quota for gemini-main is used up; switching to gemini-lite"]);
  });
});
