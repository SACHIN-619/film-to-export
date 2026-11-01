import { randomBytes } from "node:crypto";
import PDFDocument from "pdfkit";
import { nowIso, type Db } from "../db.js";
import { centsToValue } from "../domain/money.js";
import { notFound } from "./errors.js";

const COUNTRY: Record<string, string> = { IN: "India", US: "United States", GB: "United Kingdom", CA: "Canada", AU: "Australia", DE: "Germany", FR: "France", ES: "Spain" };
export const countryName = (code: string | null | undefined) => (code ? (COUNTRY[code] ?? code) : "—");

export interface InvoiceSnapshot {
  number: string;
  issuedAt: string;
  orderId: string;
  simulation: boolean;
  seller: { name: string; businessName: string; address: string; city: string; country: string; email: string; iec: string };
  buyer: { name: string; email: string; address: string; country: string };
  lines: {
    description: string;
    materials: string;
    hsCode: string;
    origin: string;
    quantity: number;
    unitCents: number;
    totalCents: number;
  }[];
  currency: string;
  /** Customs value of the goods (what's declared). */
  goodsTotalCents?: number;
  /** Estimated US import duty prepaid by the seller (DDP), collected from the buyer at checkout. */
  dutyTotalCents?: number;
  dutyBasis?: string | null;
  incoterm?: "DDP" | "DAP";
  /** Amount the buyer paid: goods + duty. */
  totalCents: number;
  payment: { provider: string; paypalOrderId: string; captureId: string };
  terms: string;
  declarations: string[];
}

interface OrderJoin {
  id: string;
  quantity: number;
  amount_cents: number;
  goods_cents: number;
  duty_cents: number;
  duty_basis: string | null;
  currency: string;
  payments_mode: string;
  paypal_order_id: string;
  capture_id: string;
  buyer_name: string | null;
  buyer_email: string | null;
  buyer_address: string | null;
  buyer_country: string | null;
  title_en: string;
  materials: string;
  hs_code: string;
  country_of_origin: string;
  price_cents: number;
}

async function nextNumber(db: Db): Promise<string> {
  const year = new Date().getUTCFullYear();
  const row = await db.get<{ n: number }>("SELECT COUNT(*)::int AS n FROM invoices WHERE inv_number LIKE $1", [`CI-${year}-%`]);
  return `CI-${year}-${String((row?.n ?? 0) + 1).padStart(4, "0")}`;
}

/** Build and store the commercial invoice snapshot for a PAID order. Idempotent per order. */
export async function issueInvoice(db: Db, orderId: string): Promise<{ id: string; snapshot: InvoiceSnapshot }> {
  const existing = await db.get<{ id: string; snapshot: string }>("SELECT id, snapshot FROM invoices WHERE order_id = $1", [orderId]);
  if (existing) return { id: existing.id, snapshot: JSON.parse(existing.snapshot) };

  const o = await db.get<OrderJoin>(
    `SELECT o.*, i.title_en, i.materials, i.hs_code, i.country_of_origin, i.price_cents
     FROM orders o JOIN items i ON i.id = o.item_id WHERE o.id = $1 AND o.status = 'paid'`,
    [orderId],
  );
  if (!o) throw new Error(`Invoice requires a paid order (${orderId})`);
  const s = (await db.get<Record<string, string>>("SELECT * FROM seller WHERE id = 1"))!;

  const simulation = o.payments_mode === "simulation";
  const goods = o.goods_cents || o.amount_cents - o.duty_cents;
  const ddp = o.duty_cents > 0;
  const snapshot: InvoiceSnapshot = {
    number: await nextNumber(db),
    issuedAt: nowIso(),
    orderId: o.id,
    simulation,
    seller: {
      name: s.name,
      businessName: s.business_name,
      address: s.address,
      city: s.city,
      country: countryName(s.country),
      email: s.email,
      iec: s.iec,
    },
    buyer: {
      name: o.buyer_name ?? "—",
      email: o.buyer_email ?? "—",
      address: o.buyer_address ?? "—",
      country: countryName(o.buyer_country),
    },
    lines: [
      {
        description: o.title_en,
        materials: o.materials,
        hsCode: o.hs_code,
        origin: countryName(o.country_of_origin),
        quantity: o.quantity,
        unitCents: o.price_cents,
        totalCents: goods,
      },
    ],
    currency: o.currency,
    goodsTotalCents: goods,
    dutyTotalCents: o.duty_cents,
    dutyBasis: o.duty_basis ? (JSON.parse(o.duty_basis) as { text: string }).text : null,
    incoterm: ddp ? "DDP" : "DAP",
    totalCents: o.amount_cents,
    payment: {
      provider: simulation ? "SIMULATION (no real payment)" : "PayPal Sandbox",
      paypalOrderId: o.paypal_order_id,
      captureId: o.capture_id,
    },
    terms: ddp
      ? "Incoterms® 2020: DDP (Delivered Duty Paid). Estimated US import duty was collected from the buyer at checkout and is prepaid by the seller; the buyer should not be billed duty on delivery. Paid in full before shipment."
      : "Incoterms® 2020: DAP (Delivered At Place). No duty was collected at checkout; import duty, if any, is payable by the consignee on delivery. Paid in full before shipment.",
    declarations: [
      "We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct. The declared customs value is the goods value, excluding the duty line.",
      "HS codes were suggested by software and confirmed by the seller. They are not a customs ruling; the importer of record is responsible for final classification.",
      ...(ddp ? ["The duty amount is an estimate, not customs advice. It excludes carrier brokerage/clearance fees and state sales tax."] : []),
      "Country of origin: India.",
    ],
  };
  const id = `inv_${randomBytes(6).toString("base64url")}`;
  await db.run("INSERT INTO invoices (id, inv_number, order_id, issued_at, snapshot) VALUES ($1, $2, $3, $4, $5)", [
    id,
    snapshot.number,
    orderId,
    snapshot.issuedAt,
    JSON.stringify(snapshot),
  ]);
  return { id, snapshot };
}

export async function getInvoice(db: Db, id: string) {
  const row = await db.get<{ id: string; inv_number: string; order_id: string; snapshot: string; paypal_invoice_id: string | null }>(
    "SELECT * FROM invoices WHERE id = $1",
    [id],
  );
  if (!row) throw notFound("Invoice");
  return { id: row.id, number: row.inv_number, orderId: row.order_id, paypalInvoiceId: row.paypal_invoice_id, snapshot: JSON.parse(row.snapshot) as InvoiceSnapshot };
}

const money = (cents: number, cur: string) => `${cur} ${centsToValue(cents)}`;

/** Render a one-page A4 commercial invoice. */
export function renderInvoicePdf(inv: InvoiceSnapshot): PDFKit.PDFDocument {
  const doc = new PDFDocument({ size: "A4", margin: 48, info: { Title: `Commercial invoice ${inv.number}` } });
  const ink = "#1b1a17";
  const muted = "#6b665c";
  const accent = "#2a3a6b";
  const W = doc.page.width - 96;

  if (inv.simulation) {
    doc.save().rotate(-30, { origin: [300, 420] }).fontSize(38).fillColor("#b4432e").opacity(0.12)
      .text("SIMULATION · NOT A REAL SALE", -80, 400, { width: 760, align: "center", lineBreak: false }).restore();
    doc.opacity(1);
  }

  doc.fillColor(accent).font("Times-Bold").fontSize(26).text("Commercial Invoice", 48, 48);
  doc.font("Helvetica").fontSize(9).fillColor(muted).text(`No. ${inv.number}   ·   Issued ${inv.issuedAt.slice(0, 10)}   ·   Order ${inv.orderId}`);
  doc.moveDown(0.5).moveTo(48, doc.y).lineTo(48 + W, doc.y).strokeColor(ink).lineWidth(1.2).stroke();

  const top = doc.y + 14;
  const col = (x: number, label: string, lines: string[]) => {
    doc.font("Helvetica-Bold").fontSize(8).fillColor(muted).text(label.toUpperCase(), x, top, { width: W / 2 - 10, characterSpacing: 1 });
    doc.font("Helvetica").fontSize(10).fillColor(ink);
    lines.filter(Boolean).forEach((l) => doc.text(l, x, undefined, { width: W / 2 - 10 }));
    return doc.y;
  };
  const s = inv.seller;
  const b = inv.buyer;
  const y1 = col(48, "Exporter / Seller", [s.businessName, s.name, s.address, `${s.city}, ${s.country}`, s.email, s.iec ? `IEC: ${s.iec}` : "IEC: to be provided by seller"]);
  const y2 = col(48 + W / 2 + 10, "Consignee / Buyer", [b.name, b.address, b.country, b.email]);
  doc.y = Math.max(y1, y2) + 18;

  // Table
  const cols = [
    { h: "Description", w: 0.36 },
    { h: "HS code", w: 0.12 },
    { h: "Origin", w: 0.11 },
    { h: "Qty", w: 0.07 },
    { h: "Unit", w: 0.15 },
    { h: "Total", w: 0.19 },
  ];
  let x = 48;
  const headY = doc.y;
  doc.rect(48, headY - 4, W, 18).fill("#efe8da");
  doc.fillColor(ink).font("Helvetica-Bold").fontSize(8);
  cols.forEach((c) => {
    doc.text(c.h.toUpperCase(), x + 4, headY, { width: c.w * W - 8 });
    x += c.w * W;
  });
  doc.y = headY + 20;
  doc.font("Helvetica").fontSize(9.5);
  for (const l of inv.lines) {
    const rowY = doc.y;
    const cells = [`${l.description}\n${l.materials}`, l.hsCode, l.origin, String(l.quantity), money(l.unitCents, inv.currency), money(l.totalCents, inv.currency)];
    let cx = 48;
    let maxY = rowY;
    cells.forEach((cell, i) => {
      doc.text(cell, cx + 4, rowY, { width: cols[i].w * W - 8 });
      maxY = Math.max(maxY, doc.y);
      cx += cols[i].w * W;
    });
    doc.y = maxY + 8;
    doc.moveTo(48, doc.y).lineTo(48 + W, doc.y).strokeColor("#d8ccb5").lineWidth(0.6).stroke();
    doc.y += 6;
  }
  if (inv.dutyTotalCents) {
    doc.font("Helvetica").fontSize(9.5).fillColor(ink)
      .text(`Goods (declared customs value)  ${money(inv.goodsTotalCents ?? inv.totalCents - inv.dutyTotalCents, inv.currency)}`, 48, doc.y + 4, { width: W, align: "right" })
      .text(`Est. US import duty, prepaid (DDP)  ${money(inv.dutyTotalCents, inv.currency)}`, 48, undefined, { width: W, align: "right" });
    if (inv.dutyBasis) doc.fontSize(8).fillColor(muted).text(`Duty basis: ${inv.dutyBasis} Estimate, not customs advice.`, 48, undefined, { width: W, align: "right" });
  }
  doc.font("Times-Bold").fontSize(14).fillColor(ink).text(`Total paid  ${money(inv.totalCents, inv.currency)}`, 48, doc.y + 4, { width: W, align: "right" });
  if (inv.incoterm) doc.font("Helvetica-Bold").fontSize(9).fillColor(accent).text(`Incoterm: ${inv.incoterm}`, 48, undefined, { width: W, align: "right" });

  doc.moveDown(1.2).font("Helvetica-Bold").fontSize(8).fillColor(muted).text("PAYMENT", 48, undefined, { characterSpacing: 1 });
  doc.font("Helvetica").fontSize(9.5).fillColor(ink)
    .text(`${inv.payment.provider}  ·  PayPal order ${inv.payment.paypalOrderId}  ·  Capture ${inv.payment.captureId}`)
    .text(inv.terms);

  doc.moveDown(1).font("Helvetica-Bold").fontSize(8).fillColor(muted).text("DECLARATION", 48, undefined, { characterSpacing: 1 });
  doc.font("Helvetica").fontSize(8.5).fillColor(ink);
  inv.declarations.forEach((d) => doc.text(d, { width: W }).moveDown(0.3));

  doc.moveDown(2).font("Helvetica").fontSize(9).fillColor(muted).text("Authorised signature", 48 + W - 180, undefined, { width: 180 });
  doc.moveTo(48 + W - 180, doc.y - 14).lineTo(48 + W, doc.y - 14).strokeColor(ink).lineWidth(0.6).stroke();

  doc.end();
  return doc;
}
