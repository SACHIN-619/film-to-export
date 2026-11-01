import { Link } from "react-router-dom";

const STEPS = [
  {
    no: "01",
    title: "Film the table",
    body: "One short pan across everything you made, or a few photos. Gemini finds each separate piece.",
  },
  {
    no: "02",
    title: "Confirm what's true",
    body: "Bilingual listings with honest condition notes, a USD price and a suggested HS code. You confirm every number.",
  },
  {
    no: "03",
    title: "Get paid, ship with papers",
    body: "Buyers abroad pay with PayPal. Once the payment is verified, you get a commercial invoice ready for the parcel.",
  },
];

export default function Home() {
  return (
    <div className="page home">
      <section className="hero">
        <p className="kicker">For small makers · India → the world</p>
        <h1 className="display xl">
          Film your table.
          <br />
          <em>Ship to the world.</em>
        </h1>
        <p className="lede">
          Any small maker becomes an exporter in sixty seconds: AI-drafted export listings, PayPal checkout for foreign
          buyers, and the commercial invoice customs asks for.
        </p>
        <div className="hero-actions">
          <Link to="/studio" className="btn primary">
            Open the studio
          </Link>
          <Link to="/shop" className="btn ghost">
            See the storefront
          </Link>
        </div>
      </section>

      <section className="steps">
        {STEPS.map((s) => (
          <article key={s.no} className="step">
            <span className="step-no">No. {s.no}</span>
            <h2>{s.title}</h2>
            <p>{s.body}</p>
          </article>
        ))}
      </section>

      <section className="pullquote">
        <blockquote>
          “A block-printed scarf that sells for ₹600 in Jaipur sells for $45 in Brooklyn. The craft was never the hard part.”
        </blockquote>
        <p className="small muted">
          Why cross-border: PayPal India accounts take international payments only, so exporting is the honest way in.
        </p>
      </section>
    </div>
  );
}
