import { z } from "zod";

export const CONFIDENCE = z.enum(["high", "medium", "low"]);
export const CONDITION_GRADES = ["new", "like_new", "good", "fair"] as const;
export const ConditionGrade = z.enum(CONDITION_GRADES);

/** HS code: 4 digits, optionally .2 and .2-4 more ("6214", "6214.90", "6214.90.10"). */
export const HS_CODE = z
  .string()
  .trim()
  .regex(/^\d{4}(\.\d{2}(\.\d{2,4})?)?$/, "HS code must look like 6214.90");

/** What the vision model must return. Validated before anything touches the DB. */
export const AiItemSchema = z.object({
  frame_indices: z.array(z.number().int().min(0)).min(1),
  title_en: z.string().min(3).max(120),
  description_en: z.string().min(20).max(1200),
  title_alt: z.string().min(3).max(140),
  description_alt: z.string().min(20).max(1400),
  materials: z.string().min(2).max(200),
  dimensions_estimate: z.string().max(120).nullable(),
  condition: z.object({
    grade: ConditionGrade,
    notes: z.string().min(3).max(500),
    defects: z.array(z.string().min(2).max(200)).max(10),
  }),
  price: z.object({
    usd: z.number().positive().max(10000),
    rationale: z.string().min(5).max(500),
  }),
  hs: z.object({
    code: HS_CODE,
    description: z.string().min(3).max(200),
    rationale: z.string().min(5).max(600),
  }),
  confidence: z.object({
    title: CONFIDENCE,
    materials: CONFIDENCE,
    condition: CONFIDENCE,
    price: CONFIDENCE,
    hs_code: CONFIDENCE,
  }),
  /** What the seller said about this piece in the voice note (English), if anything. */
  seller_said: z.string().max(400).nullable().optional(),
});

export const TranscriptSchema = z.object({
  language: z.string().min(2).max(40),
  original: z.string().max(4000),
  english: z.string().max(4000),
});

export const AiDraftSchema = z.object({
  /** Present when a voice note / video audio was supplied. */
  transcript: TranscriptSchema.nullable().optional(),
  items: z.array(AiItemSchema).min(1).max(8),
});

export type AiItem = z.infer<typeof AiItemSchema>;
export type AiDraft = z.infer<typeof AiDraftSchema>;

/** Seller edits + confirmation of a draft item. Price is dollars from the form. */
export const ConfirmItemSchema = z.object({
  title_en: z.string().trim().min(3).max(120),
  description_en: z.string().trim().min(10).max(1200),
  title_alt: z.string().trim().min(1).max(140),
  description_alt: z.string().trim().min(1).max(1400),
  materials: z.string().trim().min(2).max(200),
  dimensions: z.string().trim().max(120).nullable().optional(),
  condition_grade: ConditionGrade,
  condition_notes: z.string().trim().min(3).max(500),
  price_usd: z.number().min(1).max(10000),
  quantity: z.number().int().min(1).max(99),
  hs_code: HS_CODE,
  confirm: z.boolean(),
});

/** The ONLY thing a browser may say when creating an order. Any amount it sends is dropped. */
export const CreateOrderSchema = z.object({
  itemId: z.string().min(1).max(64),
  quantity: z.number().int().min(1).max(10).default(1),
});

export const SellerSchema = z.object({
  name: z.string().trim().min(2).max(100),
  business_name: z.string().trim().min(2).max(140),
  address: z.string().trim().min(3).max(200),
  city: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(200),
  iec: z.string().trim().max(20),
});
