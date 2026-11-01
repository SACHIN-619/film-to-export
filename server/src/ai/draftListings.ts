import { AiDraftSchema, type AiDraft } from "../domain/schemas.js";
import type { GenerateOptions, ImageInput, VisionModel } from "./visionModel.js";

export class AiOutputError extends Error {
  constructor(message: string, readonly issues: string[]) {
    super(message);
    this.name = "AiOutputError";
  }
}

export function buildDraftPrompt(frameCount: number, altLanguage: string, hasAudio = false): string {
  const audio = hasAudio
    ? `

After the images you also receive ONE audio recording: the maker describing the pieces, often in Hindi or another Indian language, possibly mixed with English.
- Transcribe it verbatim in its original language and NATIVE script ("transcript.original"): Hindi in Devanagari (e.g. "यह पीतल का लैंप है"), not romanised; English words the speaker uses may stay in Latin script. Name the language ("transcript.language") and translate it faithfully into English ("transcript.english").
- Treat what the maker says as strong evidence for material, technique, origin story and price, but NEVER invent claims the maker did not make. If they state a price in rupees, mention it in "seller_said" and still give a realistic USD retail price.
- Put a one-sentence English summary of what the maker said about each specific piece in that item's "seller_said" (null if nothing).`
    : "";
  return `You are an export-listing assistant for a small handicraft maker in India who sells to foreign buyers.

You receive ${frameCount} image(s), indexed 0..${frameCount - 1} in the order given. They are frames from one video or a set of photos of the maker's table.${audio}

Task: identify each DISTINCT physical item for sale (the same item seen in several frames is ONE item; a matching pair sold together is ONE item). For each item, draft an honest export listing.

Rules:
- Describe only what is visible. Do not invent provenance, awards, certifications, age, or brand names.
- Condition must be honest. List every visible defect (stains, colour bleed, chips, uneven stitching, tarnish). If none are visible, say so and use an empty defects array.
- price.usd: a realistic retail price for a US buyer on an artisan marketplace, before shipping. Give a one-sentence rationale.
- hs: suggest the most likely 6-digit Harmonized System code written as "NNNN.NN" with a short description and a rationale. This is only a suggestion the seller will confirm; never claim it is legally correct.
- title_alt and description_alt: the same listing written naturally in ${altLanguage}.
- confidence: "high", "medium" or "low" per field. Use "low" when the images do not really show it (e.g. material that could be cotton or viscose).
- dimensions_estimate: a rough estimate only if a reference object makes it possible, else null.

Return ONLY JSON matching exactly:
{
  "transcript": ${hasAudio ? `{ "language": string, "original": string, "english": string }` : "null"},
  "items": [
    {
      "frame_indices": [number, ...],        // frames showing this item, best frame first
      "title_en": string,                    // <= 80 chars, no ALL CAPS
      "description_en": string,              // 2-4 sentences
      "title_alt": string,
      "description_alt": string,
      "materials": string,
      "dimensions_estimate": string | null,
      "condition": { "grade": "new" | "like_new" | "good" | "fair", "notes": string, "defects": [string, ...] },
      "price": { "usd": number, "rationale": string },
      "hs": { "code": "NNNN.NN", "description": string, "rationale": string },
      "confidence": { "title": "high"|"medium"|"low", "materials": ..., "condition": ..., "price": ..., "hs_code": ... },
      "seller_said": string | null
    }
  ]
}`;
}

function buildRepairPrompt(badOutput: string, issues: string[]): string {
  return `Your previous answer did not match the required JSON schema.

Problems:
${issues.map((i) => `- ${i}`).join("\n")}

Previous answer:
${badOutput.slice(0, 12000)}

Return ONLY the corrected JSON object with the same content, fixing exactly these problems. Do not add commentary.`;
}

type ParseResult = { ok: true; draft: AiDraft } | { ok: false; issues: string[] };

export function parseDraft(raw: string): ParseResult {
  let data: unknown;
  try {
    // Tolerate a fenced block even though we ask for raw JSON.
    const unfenced = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "");
    data = JSON.parse(unfenced);
  } catch (err) {
    return { ok: false, issues: [`Output is not valid JSON: ${(err as Error).message}`] };
  }
  const parsed = AiDraftSchema.safeParse(data);
  if (parsed.success) return { ok: true, draft: parsed.data };
  return {
    ok: false,
    issues: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
  };
}

export interface DraftOutcome {
  draft: AiDraft;
  repaired: boolean;
}

/**
 * One generation, schema validation, and at most ONE repair retry.
 * Frame indices outside the given range are dropped (or the item falls back to frame 0).
 */
export async function draftListings(
  model: VisionModel,
  images: ImageInput[],
  altLanguage: string,
  audio: ImageInput | null = null,
  genOpts: GenerateOptions = {},
): Promise<DraftOutcome> {
  if (images.length === 0) throw new AiOutputError("No images to analyse", []);
  // One call: frames first (indexed), then the voice note, so transcription and extraction share context.
  const media = audio ? [...images, audio] : images;
  const first = await model.generateJson(buildDraftPrompt(images.length, altLanguage, !!audio), media, genOpts);
  let result = parseDraft(first);
  let repaired = false;
  if (!result.ok) {
    repaired = true;
    const second = await model.generateJson(buildRepairPrompt(first, result.issues), [], genOpts);
    result = parseDraft(second);
    if (!result.ok) throw new AiOutputError("AI output failed validation after one repair attempt", result.issues);
  }
  const draft = result.draft;
  for (const item of draft.items) {
    const inRange = item.frame_indices.filter((i) => i < images.length);
    item.frame_indices = inRange.length ? inRange : [0];
  }
  return { draft, repaired };
}
