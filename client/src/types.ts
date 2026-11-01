export type Confidence = "high" | "medium" | "low";

export interface AppConfig {
  aiMode: "live" | "simulation";
  aiModel: string | null;
  paymentsMode: "sandbox" | "simulation";
  paypalClientId: string | null;
  paypalInvoicing: boolean;
  ffmpeg: boolean;
  buyerLanguage: string;
  buyerLanguageName: string;
}

export interface Item {
  id: string;
  batchId: string;
  status: "draft" | "confirmed" | "published" | "sold_out";
  origin: "ai" | "fixture";
  titleEn: string;
  descriptionEn: string;
  altLang: string;
  titleAlt: string;
  descriptionAlt: string;
  materials: string;
  dimensions: string | null;
  conditionGrade: "new" | "like_new" | "good" | "fair";
  conditionNotes: string;
  defects: string[];
  suggestedPriceUsd: number;
  priceRationale: string;
  priceUsd: number;
  priceCents: number;
  quantity: number;
  hsSuggested: string;
  hsDescription: string;
  hsRationale: string;
  hsCode: string;
  confidence: Partial<Record<"title" | "materials" | "condition" | "price" | "hs_code", Confidence>>;
  imageUrl: string | null;
  countryOfOrigin: string;
  confirmedAt: string | null;
  duty: DutyEstimate;
  rateNote: string | null;
  restricted: { level: "ok" | "caution" | "blocked"; hits: { term: string; level: string; reason: string }[]; disclaimer: string } | null;
}

export interface BrokerEvent {
  id: string;
  kind: "run" | "perceive" | "transcript" | "classify" | "tariff_lookup" | "hts_refine" | "duty" | "restricted_check" | "price" | "done" | "error";
  status: "running" | "done" | "warn" | "error";
  tool?: string;
  item?: number;
  title: string;
  detail?: string;
  data?: Record<string, unknown>;
  ms?: number;
  replay?: { runId: string; recordedAt: string };
}

/** Server-computed US import duty estimate for ONE unit. */
export type DutyEstimate =
  | {
      status: "estimated";
      unitDutyCents: number;
      totalPct: number;
      mfnPct: number;
      surchargePct: number;
      matchedHs: string;
      htsLine: string;
      description: string;
      mfnVerified: boolean;
      surchargeLabel: string | null;
      surchargeStatus: "confirmed" | "uncertain" | null;
      sources: string[];
      rateSource: "live" | "table";
      checkedOn: string;
      disclaimer: string;
      basis: string;
    }
  | { status: "unknown"; unitDutyCents: 0; reason: string; checkedOn: string; disclaimer: string; basis: string };

export interface Batch {
  id: string;
  source: "video" | "photos" | "fixture";
  aiMode: "live" | "simulation";
  model: string | null;
  status: "drafting" | "ready" | "failed" | "published";
  frameCount: number;
  repaired: boolean;
  error: string | null;
  createdAt: string;
  transcript: { language: string; original: string; english: string } | null;
  frames: { idx: number; path: string; mime: string }[];
  items: Item[];
}

export interface Seller {
  name: string;
  business_name: string;
  address: string;
  city: string;
  country: string;
  email: string;
  iec: string;
}

export type OrderStatus = "created" | "payment_pending" | "paid" | "failed" | "cancelled";

export interface Order {
  id: string;
  status: OrderStatus;
  quantity: number;
  amountCents: number;
  goodsCents: number;
  dutyCents: number;
  dutyBasis: string | null;
  currency: string;
  paymentsMode: "sandbox" | "simulation";
  paypalOrderId: string | null;
  captureId: string | null;
  captureStatus: string | null;
  buyer: { name: string | null; email: string | null; address: string | null; country: string | null };
  createdAt: string;
  paidAt: string | null;
  item: { id: string; title: string; imageUrl: string | null; origin: string };
  invoice: { id: string; number: string; paypalInvoiceId: string | null } | null;
  events: { fromStatus: string | null; toStatus: string; note: string | null; at: string }[];
}

export interface InvoiceSnapshot {
  number: string;
  issuedAt: string;
  orderId: string;
  simulation: boolean;
  seller: { name: string; businessName: string; address: string; city: string; country: string; email: string; iec: string };
  buyer: { name: string; email: string; address: string; country: string };
  lines: { description: string; materials: string; hsCode: string; origin: string; quantity: number; unitCents: number; totalCents: number }[];
  currency: string;
  goodsTotalCents?: number;
  dutyTotalCents?: number;
  dutyBasis?: string | null;
  incoterm?: "DDP" | "DAP";
  totalCents: number;
  payment: { provider: string; paypalOrderId: string; captureId: string };
  terms: string;
  declarations: string[];
}

export interface Invoice {
  id: string;
  number: string;
  orderId: string;
  paypalInvoiceId: string | null;
  snapshot: InvoiceSnapshot;
}
