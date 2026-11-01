import type { Confidence } from "../types";

export function ConfidenceChip({ level, label }: { level?: Confidence; label?: string }) {
  if (!level) return null;
  return (
    <span className={`conf conf-${level}`} title={`AI confidence: ${level}`}>
      {label ? `${label} · ` : ""}
      {level}
    </span>
  );
}

export function FixtureTag() {
  return <span className="tag tag-sim">Fixture · not AI output</span>;
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="spinner" role="status">
      <span className="spinner-dot" />
      {label}
    </span>
  );
}

export function StatusPill({ status }: { status: string }) {
  const label: Record<string, string> = {
    draft: "Needs review",
    confirmed: "Confirmed",
    published: "Live",
    sold_out: "Sold out",
    created: "Awaiting payment",
    payment_pending: "Payment pending",
    paid: "Paid · verified",
    failed: "Failed",
    cancelled: "Cancelled",
  };
  return <span className={`pill pill-${status}`}>{label[status] ?? status}</span>;
}
