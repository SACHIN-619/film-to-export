import { describe, expect, it } from "vitest";
import request from "supertest";
import { LiveTariffLookup, TableTariffLookup, parseGeneralRate, pickRate, toKeyword, type TariffLookup, type TariffResult } from "../src/broker/tariff.js";
import { checkRestricted } from "../src/broker/restricted.js";
import { matchLine, replayRun, runBroker, prepareBatch, type BrokerEvent } from "../src/broker/agent.js";
import { addFrames, getBatch, updateItem } from "../src/services/listings.js";
import { FIXTURE_DRAFT } from "../src/ai/fixtures.js";
import type { ImageInput, VisionModel } from "../src/ai/visionModel.js";
import { createApp } from "../src/app.js";
import { SimulatedPaymentProvider } from "../src/payments/simulated.js";
import { memoryDb, tempConfig } from "./helpers.js";

const ROWS = [
  { htsno: "9405.50", description: "Non-electrical luminaires:", general: "" },
  { htsno: "9405.50.20.00", description: "Incandescent luminaires operated by propane", general: "2.9%" },
  { htsno: "9405.50.30.00", description: "Of brass", general: "5.7%" },
  { htsno: "9405.50.40.00", description: "Other", general: "6%" },
  { htsno: "1207.21.00.00", description: "Seed", general: "0.47¢/kg" },
];

describe("tariff parsing", () => {
  it("parses % and Free, rejects specific/compound rates", () => {
    expect(parseGeneralRate("7%")).toBe(7);
    expect(parseGeneralRate("11.3%")).toBe(11.3);
    expect(parseGeneralRate("Free")).toBe(0);
    expect(parseGeneralRate("0.47¢/kg")).toBeNull();
    expect(parseGeneralRate("6% + 2¢/kg")).toBeNull();
  });
  it("builds the API keyword from any HS spelling", () => {
    expect(toKeyword("621490")).toBe("6214.90");
    expect(toKeyword("6214.90.00.10")).toBe("6214.90.00");
  });
  it("prefers the cited table's line (by digit prefix), else the residual 'Other' line", () => {
    expect(pickRate("9405.50", ROWS, "9405.50.30").picked?.htsno).toBe("9405.50.30.00");
    const r = pickRate("9405.50", ROWS, null);
    expect(r.picked?.htsno).toBe("9405.50.40.00");
    expect(r.range).toEqual([2.9, 6]);
    expect(r.lines).toHaveLength(3);
  });
});

describe("LiveTariffLookup", () => {
  const okFetch = (rows: unknown) => (async () => new Response(JSON.stringify(rows), { status: 200 })) as unknown as typeof fetch;

  it("returns a live USITC rate with its line and a clickable URL, and caches it", async () => {
    let calls = 0;
    const f = (async () => {
      calls++;
      return new Response(JSON.stringify([{ htsno: "6214.90.00", description: "Of other textile materials", general: "11.3%" }]), { status: 200 });
    }) as unknown as typeof fetch;
    const t = new LiveTariffLookup({ fetchFn: f });
    const r = await t.lookup("6214.90");
    expect(r).toMatchObject({ source: "live", mfnPct: 11.3, htsLine: "6214.90.00" });
    expect(r.url).toContain("hts.usitc.gov/reststop/search?keyword=6214.90");
    expect((await t.lookup("6214.90")).note).toMatch(/cached/);
    expect(calls).toBe(1);
  });

  it("falls back to the cited table (and says so) when the API fails", async () => {
    const t = new LiveTariffLookup({ fetchFn: (async () => { throw new Error("ETIMEDOUT"); }) as unknown as typeof fetch });
    const r = await t.lookup("6304.92");
    expect(r.source).toBe("table");
    expect(r.mfnPct).toBe(6.3);
    expect(r.note).toMatch(/USITC API unavailable.*local cited table/);
  });

  it("falls back when the official rate is not a plain percentage; 'none' when nothing is on file", async () => {
    const t = new LiveTariffLookup({ fetchFn: okFetch([ROWS[4]]) });
    const r = await t.lookup("1207.21");
    expect(r.source).toBe("none");
    expect(r.note).toMatch(/none has a plain % rate/);
  });
});

describe("restricted-materials screen", () => {
  it("flags ivory as blocked, peacock feathers as caution, and passes a cotton scarf", () => {
    expect(checkRestricted("Carved ivory elephant").level).toBe("blocked");
    const p = checkRestricted("Peacock feather fan");
    expect(p.level).toBe("caution");
    expect(p.hits.map((h) => h.term)).toEqual(["peacock feather"]);
    expect(checkRestricted("Hand block-printed cotton scarf").level).toBe("ok");
    expect(checkRestricted("x").disclaimer).toMatch(/not legal advice/);
  });
});

/** Scripted Gemini stand-in: first answer = the draft, later answers = HTS line choices. */
class ScriptedVision implements VisionModel {
  readonly name = "gemini:test";
  calls: { prompt: string; media: ImageInput[] }[] = [];
  constructor(private answers: string[]) {}
  async generateJson(prompt: string, media: ImageInput[]) {
    this.calls.push({ prompt, media });
    return this.answers.shift() ?? "{}";
  }
}

/** Offline tariff: 9405.50 comes back "live" with three lines so the refine step runs. */
class FakeTariff implements TariffLookup {
  async lookup(hs: string): Promise<TariffResult> {
    const base = { checkedAt: "2026-11-01T00:00:00Z", ms: 1, url: `https://hts.usitc.gov/reststop/search?keyword=${hs}` };
    if (hs.startsWith("9405")) {
      return { ...base, source: "live", mfnPct: 6, htsLine: "9405.50.40.00", description: "Other", note: "USITC HTS: 9405.50.40.00", lines: [
        { htsno: "9405.50.20.00", description: "Propane lamps", pct: 2.9 },
        { htsno: "9405.50.30.00", description: "Of brass", pct: 5.7 },
        { htsno: "9405.50.40.00", description: "Other", pct: 6 },
      ] };
    }
    return new TableTariffLookup().lookup(hs);
  }
}

const img = (n: number) => ({ mime: "image/jpeg", data: Buffer.from(`img${n}`), publicPath: `/media/x/photo_0${n}.jpg` });

describe("broker agent", () => {
  it("streams perceive → classify → live tariff → refine → duty → restricted → price, persists rates, records the run", async () => {
    const db = await memoryDb();
    const draft = structuredClone(FIXTURE_DRAFT);
    draft.items = [draft.items[1]]; // the brass diya, HS 9405.50
    draft.transcript = { language: "Hindi", original: "यह पीतल का दीया है", english: "This is a brass diya" };
    const vision = new ScriptedVision([JSON.stringify(draft), JSON.stringify({ choices: [{ piece: 1, htsno: "9405.50.30.00", reason: "Solid brass lamp." }] })]);
    const batchId = await prepareBatch(db, vision.name, true);
    await addFrames(db, batchId, [{ path: img(0).publicPath, mime: "image/jpeg" }]);
    const events: BrokerEvent[] = [];
    await runBroker(
      { db, vision, tariff: new FakeTariff(), altLanguage: { code: "es", name: "Spanish" } },
      { images: [img(0)], audio: { mime: "audio/webm", data: Buffer.from("voice") }, batchId },
      (e) => events.push(e),
    );

    const finals = events.filter((e) => e.status !== "running");
    expect(finals.map((e) => e.kind)).toEqual(["run", "perceive", "transcript", "classify", "tariff_lookup", "hts_refine", "duty", "restricted_check", "price", "done"]);
    // The voice note went into the SAME model call as the images.
    expect(vision.calls[0].media.map((m) => m.mime)).toEqual(["image/jpeg", "audio/webm"]);
    expect(vision.calls[0].prompt).toMatch(/Transcribe it verbatim/);
    expect(finals.find((e) => e.kind === "hts_refine")!.title).toMatch(/9405\.50\.30\.00 → 5\.7%/);
    // 5.7% (refined, live) + 10% India = 15.7% of $29 = $4.55
    expect(finals.find((e) => e.kind === "price")!.data).toMatchObject({ priceCents: 2900, dutyCents: 455, totalCents: 3355 });

    const batch = await getBatch(db, batchId);
    expect(batch.transcript?.english).toBe("This is a brass diya");
    expect(batch.items[0].duty).toMatchObject({ status: "estimated", mfnPct: 5.7, rateSource: "live", unitDutyCents: 455 });
    const runs = await db.all<{ id: string }>("SELECT id FROM broker_runs");
    expect(runs).toHaveLength(1);

    // Replay re-emits the recorded steps, each labelled as a replay.
    const replayed: BrokerEvent[] = [];
    expect(await replayRun(db, null, (e) => replayed.push(e), { maxGapMs: 0 })).toBe(true);
    expect(replayed.length).toBe(events.length);
    expect(replayed.every((e) => e.replay?.runId === runs[0].id)).toBe(true);
  });

  it("rejects a model-picked line that is not on the official list", async () => {
    const db = await memoryDb();
    const draft = structuredClone(FIXTURE_DRAFT);
    draft.items = [draft.items[1]];
    const vision = new ScriptedVision([JSON.stringify(draft), JSON.stringify({ choices: [{ piece: 1, htsno: "9999.99.99", reason: "made up" }] })]);
    const batchId = await prepareBatch(db, vision.name, true);
    const events: BrokerEvent[] = [];
    await runBroker({ db, vision, tariff: new FakeTariff(), altLanguage: { code: "es", name: "Spanish" } }, { images: [img(0)], audio: null, batchId }, (e) => events.push(e));
    const refine = events.filter((e) => e.kind === "hts_refine" && e.status !== "running")[0];
    expect(refine.status).toBe("warn");
    expect((await getBatch(db, batchId)).items[0].duty).toMatchObject({ mfnPct: 6 });
  });

  it("SIMULATION mode (no Gemini) runs on labelled fixtures", async () => {
    const db = await memoryDb();
    const batchId = await prepareBatch(db, null, false);
    const events: BrokerEvent[] = [];
    await runBroker({ db, vision: null, tariff: new TableTariffLookup(), altLanguage: { code: "es", name: "Spanish" } }, { images: [img(0)], audio: null, batchId }, (e) => events.push(e));
    expect(events.find((e) => e.kind === "perceive")!.title).toMatch(/SIMULATION/);
    expect(events.at(-1)!.kind).toBe("done");
    expect((await getBatch(db, batchId)).items.every((i) => i.origin === "fixture")).toBe(true);
  });

  it("changing the HS code on confirm re-resolves the rate", async () => {
    const db = await memoryDb();
    const batchId = await prepareBatch(db, null, false);
    await runBroker({ db, vision: null, tariff: new TableTariffLookup(), altLanguage: { code: "es", name: "Spanish" } }, { images: [img(0)], audio: null, batchId }, () => {});
    const it0 = (await getBatch(db, batchId)).items[0];
    const asked: string[] = [];
    const updated = await updateItem(
      db,
      it0.id,
      { title_en: it0.titleEn, description_en: it0.descriptionEn, title_alt: it0.titleAlt, description_alt: it0.descriptionAlt, materials: it0.materials, dimensions: null, condition_grade: "new", condition_notes: "ok ok", price_usd: 38, quantity: 1, hs_code: "6307.90", confirm: true },
      async (hs) => {
        asked.push(hs);
        return { source: "live", mfnPct: 7, htsLine: "6307.90.98", note: "USITC HTS: 6307.90.98" };
      },
    );
    expect(asked).toEqual(["6307.90"]);
    expect(updated.duty).toMatchObject({ mfnPct: 7, rateSource: "live" });
  });
});

describe("broker HTTP routes", () => {
  const app = async () => {
    const db = await memoryDb();
    return { db, app: createApp({ db, config: tempConfig(), payments: new SimulatedPaymentProvider(), vision: null, tariff: new TableTariffLookup(), log: () => {} }) };
  };
  const parseSse = (text: string) =>
    text
      .split("\n\n")
      .filter((b) => b.startsWith("data: "))
      .map((b) => JSON.parse(b.slice(6)) as BrokerEvent);

  it("POST /api/broker/run streams SSE events ending in done; replay then works", async () => {
    const { app: a } = await app();
    await request(a).post("/api/broker/replay").send({}).expect(404);
    const res = await request(a)
      .post("/api/broker/run")
      .attach("media", Buffer.from([0xff, 0xd8, 0xff]), { filename: "a.jpg", contentType: "image/jpeg" })
      .buffer(true)
      .parse((r, cb) => {
        let s = "";
        r.on("data", (c: Buffer) => (s += c.toString()));
        r.on("end", () => cb(null, s));
      })
      .expect(200);
    expect(res.headers["content-type"]).toMatch(/text\/event-stream/);
    const events = parseSse(res.body as string);
    expect(events.at(-1)!.kind).toBe("done");
    expect(events.some((e) => e.kind === "tariff_lookup")).toBe(true);

    const rep = await request(a)
      .post("/api/broker/replay")
      .send({})
      .buffer(true)
      .parse((r, cb) => {
        let s = "";
        r.on("data", (c: Buffer) => (s += c.toString()));
        r.on("end", () => cb(null, s));
      })
      .expect(200);
    const replayed = parseSse(rep.body as string);
    expect(replayed.length).toBe(events.length);
    expect(replayed[0].replay?.runId).toBeTruthy();
  }, 30_000);

  it("rejects a run with no photos", async () => {
    const { app: a } = await app();
    await request(a).post("/api/broker/run").expect(400);
  });
});

describe("pay links", () => {
  async function confirmedApp() {
    const db = await memoryDb();
    const a = createApp({ db, config: tempConfig(), payments: new SimulatedPaymentProvider(), vision: null, tariff: new TableTariffLookup(), log: () => {} });
    const batchId = await prepareBatch(db, null, false);
    await runBroker({ db, vision: null, tariff: new TableTariffLookup(), altLanguage: { code: "es", name: "Spanish" } }, { images: [img(0)], audio: null, batchId }, () => {});
    return { db, a, items: (await getBatch(db, batchId)).items };
  }

  it("refuses a draft, publishes a confirmed piece, and shares a duty-included message + QR", async () => {
    const { db, a, items } = await confirmedApp();
    const scarf = items[0];
    await request(a).post(`/api/items/${scarf.id}/publish`).expect(409);
    await db.run("UPDATE items SET status = 'confirmed' WHERE id = $1", [scarf.id]);
    const pub = await request(a).post(`/api/items/${scarf.id}/publish`).expect(200);
    expect(pub.body.status).toBe("published");
    const share = (await request(a).get(`/api/items/${scarf.id}/share`).expect(200)).body;
    expect(share.url).toMatch(new RegExp(`/pay/${scarf.id}$`));
    expect(share.totalCents).toBe(3800 + 809);
    expect(share.text).toMatch(/\$46\.09 total, including \$8\.09 estimated US import duty/);
    expect(share.qrSvg).toMatch(/^<svg/);
    // The pay page's data source is the same server-priced item.
    expect((await request(a).get(`/api/shop/${scarf.id}`).expect(200)).body.duty.unitDutyCents).toBe(809);
  });

  it("refuses a pay link for a piece screened as likely prohibited", async () => {
    const { db, a, items } = await confirmedApp();
    await db.run("UPDATE items SET status = 'confirmed', restricted = $1 WHERE id = $2", [
      JSON.stringify({ level: "blocked", hits: [{ term: "ivory", level: "blocked", reason: "x" }], disclaimer: "d" }),
      items[1].id,
    ]);
    const res = await request(a).post(`/api/items/${items[1].id}/publish`).expect(409);
    expect(res.body.error).toMatch(/prohibited material \(ivory\)/);
  });
});

describe("broker corrects a wrong subheading using the official heading", () => {
  const SCARF_ROWS = [
    { htsno: "6214", description: "Shawls, scarves, mufflers, mantillas, veils and the like:", general: "", indent: "0" },
    { htsno: "6214.10", description: "Of silk or silk waste:", general: "", indent: "1" },
    { htsno: "6214.10.10.00", description: "Containing 70 percent or more by weight of silk", general: "1.2%", indent: "2" },
    { htsno: "6214.20.00.00", description: "Of wool or fine animal hair (459)", general: "6.7%", indent: "1" },
    { htsno: "6214.90.00", description: "Of other textile materials", general: "11.3%", indent: "1" },
  ];

  it("pickRate with heading scope builds full paths and keeps the proposed subheading as the default", () => {
    const r = pickRate("6214.20", SCARF_ROWS, null, 4);
    expect(r.picked?.htsno).toBe("6214.20.00.00");
    expect(r.lines.map((l) => l.htsno)).toEqual(["6214.10.10.00", "6214.20.00.00", "6214.90.00"]);
    expect(r.lines[0].description).toMatch(/Shawls, scarves.* › Of silk or silk waste › Containing 70 percent/);
  });

  it("cotton scarf proposed as 6214.20 (wool) is corrected to 6214.90.00 and the item's HS code follows", async () => {
    const db = await memoryDb();
    const draft = structuredClone(FIXTURE_DRAFT);
    draft.items = [{ ...draft.items[0], hs: { ...draft.items[0].hs, code: "6214.20" } }];
    const vision = new ScriptedVision([JSON.stringify(draft), JSON.stringify({ choices: [{ piece: 1, htsno: "6214.90.00", reason: "Cotton is an 'other textile material', not wool." }] })]);
    const tariff: TariffLookup = {
      async lookup(hs, opts) {
        const r = pickRate(hs, SCARF_ROWS, null, opts?.scope === "heading" ? 4 : undefined);
        return { source: "live", mfnPct: r.picked!.pct, htsLine: r.picked!.htsno, description: r.picked!.path, note: "USITC", url: "u", checkedAt: "t", ms: 1, lines: r.lines };
      },
    };
    const batchId = await prepareBatch(db, vision.name, true);
    const events: BrokerEvent[] = [];
    await runBroker({ db, vision, tariff, altLanguage: { code: "es", name: "Spanish" } }, { images: [img(0)], audio: null, batchId }, (e) => events.push(e));
    const refine = events.filter((e) => e.kind === "hts_refine" && e.status !== "running")[0];
    expect(refine.title).toBe("Corrected 6214.20 → 6214.90.00 (11.3%)");
    expect(vision.calls[1].prompt).toMatch(/cotton is NOT "wool/);
    const item = (await getBatch(db, batchId)).items[0];
    expect(item.hsCode).toBe("6214.90.00");
    expect(item.hsSuggested).toBe("6214.90.00");
    expect(item.hsRationale).toMatch(/moved 6214\.20 → 6214\.90\.00/);
    expect(item.duty).toMatchObject({ mfnPct: 11.3, unitDutyCents: 809 }); // $38 × 21.3%
  });
});

describe("restricted screen: Kashmiri textiles", () => {
  it("blocks shahtoosh in every common spelling, but allows pashmina and 'Kashmiri'", () => {
    for (const s of ["Shahtoosh shawl", "shatoosh wrap", "Kashmiri shatush stole"]) expect(checkRestricted(s).level, s).toBe("blocked");
    expect(checkRestricted("Hand-knotted Kashmiri pashmina carpet, wool and silk").level).toBe("ok");
    expect(checkRestricted("Kashmiri carpet").hits).toEqual([]);
  });
});

describe("batched line refinement", () => {
  it("refines several pieces with ONE model call and validates each answer against its own list", async () => {
    const db = await memoryDb();
    const draft = structuredClone(FIXTURE_DRAFT);
    draft.items = [draft.items[1], { ...draft.items[1], title_en: "Second brass lamp" }, draft.items[3]]; // two lamps (refine) + cushion (table, no refine)
    const vision = new ScriptedVision([
      JSON.stringify(draft),
      JSON.stringify({ choices: [
        { piece: 1, htsno: "9405.50.30.00", reason: "Brass." },
        { piece: 2, htsno: "6214.90.00", reason: "Not on this piece's list." },
      ] }),
    ]);
    const batchId = await prepareBatch(db, vision.name, true);
    const events: BrokerEvent[] = [];
    await runBroker({ db, vision, tariff: new FakeTariff(), altLanguage: { code: "es", name: "Spanish" } }, { images: [img(0)], audio: null, batchId }, (e) => events.push(e));
    expect(vision.calls).toHaveLength(2); // perceive + ONE refine for both lamps
    expect(vision.calls[1].prompt).toMatch(/### Piece 1[\s\S]*### Piece 2/);
    const refines = events.filter((e) => e.kind === "hts_refine" && e.status !== "running");
    expect(refines.map((e) => e.status).sort()).toEqual(["done", "warn"]);
    expect(events.at(-1)!.kind).toBe("done");
  });
});

describe("matchLine (model answer → official line)", () => {
  const lines = [
    { htsno: "7419.80.06", description: "Other", pct: 3 },
    { htsno: "7419.80.09.00", description: "Other", pct: 3 },
    { htsno: "7419.80.50", description: "Chain › Other", pct: 0 },
  ];
  it("accepts formatting variants of a listed line, rejects ambiguous or invented ones", () => {
    expect(matchLine(lines, "7419.80.09")?.htsno).toBe("7419.80.09.00");
    expect(matchLine(lines, "7419800900")?.htsno).toBe("7419.80.09.00");
    expect(matchLine(lines, "7419.80.06")?.htsno).toBe("7419.80.06");
    expect(matchLine(lines, "7419.80")).toBeUndefined(); // ambiguous
    expect(matchLine(lines, "9405.50.40")).toBeUndefined(); // not on the list
  });
});
