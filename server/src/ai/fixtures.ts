import type { AiDraft } from "../domain/schemas.js";

/**
 * SIMULATION fixtures. These are hand-written examples, NOT AI output, and every
 * item created from them is stored with origin = 'fixture' and labelled in the UI.
 * The image for each item is an illustration under server/fixtures/.
 */
export const FIXTURE_IMAGES = ["scarf.svg", "diya.svg", "bowl.svg", "cushion.svg"];

export const FIXTURE_ALT_LANG = "es";

export const FIXTURE_DRAFT: AiDraft = {
  items: [
    {
      frame_indices: [0],
      title_en: "Hand block-printed cotton scarf, indigo and madder buta",
      description_en:
        "A lightweight cotton scarf printed by hand with carved wooden blocks in an indigo and madder-red buta motif. The fabric is soft and slightly textured, with a hand-rolled hem. Each print is a little different from the next, which is the nature of block printing.",
      title_alt: "Pañuelo de algodón estampado a mano con bloques, buta añil y rubia",
      description_alt:
        "Un pañuelo ligero de algodón estampado a mano con bloques de madera tallada, con un motivo buta en añil y rojo rubia. La tela es suave y ligeramente texturizada, con dobladillo enrollado a mano. Cada estampado es un poco distinto, como es propio de esta técnica.",
      materials: "Cotton, natural-dye block print",
      dimensions_estimate: "approx. 180 × 70 cm",
      condition: {
        grade: "new",
        notes: "New and unworn. One small area of colour bleed on the left border, typical of hand printing.",
        defects: ["Small colour bleed (about 1 cm) on the left border"],
      },
      price: { usd: 38, rationale: "Comparable hand block-printed cotton scarves list at $32–48 on US artisan marketplaces." },
      hs: {
        code: "6214.90",
        description: "Shawls, scarves, mufflers, veils — of other textile materials (cotton)",
        rationale: "A woven (not knitted) scarf; heading 6214 covers scarves, and cotton falls under 'other textile materials' (.90).",
      },
      confidence: { title: "high", materials: "medium", condition: "high", price: "medium", hs_code: "medium" },
    },
    {
      frame_indices: [1],
      title_en: "Hand-cast brass diya oil lamp with lotus base",
      description_en:
        "A small solid brass oil lamp (diya) with a lotus-petal base, cast and finished by hand. It has a warm golden tone with a brushed finish. It holds a cotton wick and a little ghee or oil.",
      title_alt: "Lámpara de aceite diya de latón fundido a mano con base de loto",
      description_alt:
        "Pequeña lámpara de aceite (diya) de latón macizo con base de pétalos de loto, fundida y acabada a mano. Tiene un tono dorado cálido con acabado cepillado. Admite una mecha de algodón y un poco de aceite.",
      materials: "Brass",
      dimensions_estimate: "approx. 9 cm tall",
      condition: {
        grade: "like_new",
        notes: "Very light surface tarnish near the base; polishes off with lemon and salt.",
        defects: ["Light tarnish near the base"],
      },
      price: { usd: 29, rationale: "Solid brass diyas of this size sell for $22–35 in US home-decor and Diwali gift listings." },
      hs: {
        code: "9405.50",
        description: "Non-electrical luminaires and lighting fittings",
        rationale: "An oil lamp is a non-electrical lighting fitting; 9405.50 is usually preferred over 7419 (articles of copper alloy) for lamps.",
      },
      confidence: { title: "high", materials: "medium", condition: "medium", price: "medium", hs_code: "medium" },
    },
    {
      frame_indices: [2],
      title_en: "Jaipur blue pottery bowl, hand-painted floral",
      description_en:
        "A hand-painted bowl in the Jaipur blue pottery tradition, with cobalt and turquoise floral work on a white glaze. It is good for serving dry snacks or as a decorative piece.",
      title_alt: "Cuenco de cerámica azul de Jaipur, pintado a mano con flores",
      description_alt:
        "Cuenco pintado a mano en la tradición de la cerámica azul de Jaipur, con flores en cobalto y turquesa sobre esmalte blanco. Ideal para servir aperitivos secos o como pieza decorativa.",
      materials: "Quartz-based ceramic, glaze",
      dimensions_estimate: "approx. 15 cm diameter",
      condition: {
        grade: "good",
        notes: "A small glaze chip on the rim (about 2 mm). Otherwise sound, with no cracks visible.",
        defects: ["Glaze chip on rim, about 2 mm"],
      },
      price: { usd: 34, rationale: "Discounted from the usual $40–55 range because of the rim chip." },
      hs: {
        code: "6912.00",
        description: "Ceramic tableware and kitchenware, other than porcelain",
        rationale: "Blue pottery is a non-porcelain ceramic used as tableware. If sold as purely decorative, 6913.90 might apply instead.",
      },
      confidence: { title: "high", materials: "low", condition: "high", price: "medium", hs_code: "low" },
    },
    {
      frame_indices: [3],
      title_en: "Kantha-stitched cotton cushion cover, 16 × 16 in",
      description_en:
        "A cushion cover made from layered vintage cotton, hand-stitched with rows of kantha running stitch. Envelope back, no insert. The colours are softly faded from the original fabric.",
      title_alt: "Funda de cojín de algodón con bordado kantha, 40 × 40 cm",
      description_alt:
        "Funda de cojín de algodón vintage en capas, cosida a mano con filas de puntada kantha. Cierre de sobre, sin relleno. Colores suavemente desvaídos de la tela original.",
      materials: "Cotton (upcycled), cotton thread",
      dimensions_estimate: "approx. 40 × 40 cm",
      condition: {
        grade: "good",
        notes: "Upcycled fabric with gentle fading. Stitch spacing varies, as is normal for hand kantha.",
        defects: ["Uneven fading across one panel"],
      },
      price: { usd: 26, rationale: "Kantha cushion covers list at $20–35 on US marketplaces." },
      hs: {
        code: "6304.92",
        description: "Other furnishing articles, not knitted or crocheted, of cotton",
        rationale: "Cushion covers are furnishing articles under 6304; cotton and not knitted give .92.",
      },
      confidence: { title: "high", materials: "medium", condition: "medium", price: "medium", hs_code: "high" },
    },
  ],
};
