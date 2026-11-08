import { getStore } from "@netlify/blobs";

const COLS = ["events", "teams", "matches", "notes", "config", "rankings", "stats"];
const IDOK = /^[A-Za-z0-9_.\-]{1,200}$/;
const SKU = /^RE-[A-Z0-9]+-\d{2}-\d{4}$/;
const BASE = { 1: 0, 2: 1000, 6: 2000, 3: 3000, 4: 4000, 5: 5000 };
const PRE = { 1: "P", 2: "Q", 3: "QF", 4: "SF", 5: "F", 6: "R16-" };
const RE = "https://events.vex.com/api/v2";

const json = (o, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const same = (a, b) => {
  a = String(a || ""); b = String(b || "");
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function re(p, tries = 0) {
  const key = Netlify.env.get("ROBOTEVENTS_KEY");
  if (!key) throw new Error("ROBOTEVENTS_KEY is not set in Netlify");
  const r = await fetch(RE + p, { headers: { Authorization: "Bearer " + key, Accept: "application/json" } });
  // rate limited: wait a moment and try again (the season stats make a lot of requests)
  if (r.status === 429 && tries < 3) { await sleep(Math.min((+r.headers.get("retry-after") || tries + 1) * 1000, 3000)); return re(p, tries + 1); }
  if (!r.ok) throw new Error("RobotEvents said " + r.status);
  return r.json();
}
async function all(p) {
  const out = [];
  for (let page = 1; ; page++) {
    const j = await re(p + (p.includes("?") ? "&" : "?") + "per_page=250&page=" + page);
    out.push(...(j.data || []));
    if (!j.meta || page >= j.meta.last_page) break;
  }
  return out;
}

async function matchDocs(eid, reid, divs) {
  const docs = [];
  for (const d of divs) {
    const ms = await all(`/events/${reid}/divisions/${d}/matches`);
    for (const m of ms) {
      const al = (c) => (m.alliances || []).find((a) => a.color === c);
      const tm = (a) => ((a && a.teams) || []).map((t) => t.team && (t.team.name || t.team.code)).filter(Boolean);
      const r = m.round, n = m.matchnum;
      const label = r === 1 || r === 2 ? PRE[r] + n : r === 5 ? "F" + n : (PRE[r] || "M") + m.instance + "-" + n;
      docs.push([`matches/${eid}_${d}_${r}_${m.instance}_${n}`, {
        eventId: eid, label, round: r, order: (BASE[r] ?? 9000) + (m.instance || 0) * 100 + n,
        red: tm(al("red")), blue: tm(al("blue")),
        rs: m.scored && al("red") ? al("red").score : null, bs: m.scored && al("blue") ? al("blue").score : null,
      }]);
    }
  }
  return docs;
}

// official rankings for every division, one doc per event
async function rankDoc(eid, reid, divs) {
  const list = [];
  for (const d of divs) {
    for (const x of await all(`/events/${reid}/divisions/${d}/rankings`)) {
      const team = x.team && (x.team.name || x.team.code);
      if (team) list.push({ team, div: d, rank: x.rank, w: x.wins, l: x.losses, t: x.ties, wp: x.wp, ap: x.ap, sp: x.sp, high: x.high_score, avg: x.average_points });
    }
  }
  return ["rankings/" + eid, { eventId: eid, list, t: Date.now() }];
}

// ---------- season stats (skills, season record, awards) ----------
// Per team, from the whole season (not just this event): the best driver / programming skills score at each event,
// the ranking row at each event and the awards. Boiled down to a compact entry so the phones stay light.
const CHUNK = 6; // teams per request, keeps each call well inside the function time limit
const num = (v) => (v == null || v === "" || isNaN(+v) ? null : +v);
const avgOf = (a) => (a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10 : null);

function summarize(t, sk, rk, aw) {
  const byEv = new Map();
  for (const s of sk || []) {
    const id = s.event && s.event.id;
    const e = byEv.get(id) || { id, n: (s.event && s.event.name) || "Event", d: null, p: null, da: null, pa: null };
    const sc = num(s.score), at = num(s.attempts);
    if (s.type === "driver") { if (e.d == null || sc > e.d) { e.d = sc; e.da = at; } }
    else if (s.type === "programming") { if (e.p == null || sc > e.p) { e.p = sc; e.pa = at; } }
    byEv.set(id, e);
  }
  const sh = [...byEv.values()].filter((e) => e.d != null || e.p != null).sort((a, b) => a.id - b.id);
  const ds = sh.map((e) => e.d).filter((x) => x != null), ps = sh.map((e) => e.p).filter((x) => x != null);

  const ev = (rk || []).map((x) => ({
    id: x.event && x.event.id, n: (x.event && x.event.name) || "Event", rank: num(x.rank),
    w: x.wins || 0, l: x.losses || 0, t: x.ties || 0, wp: num(x.wp), ap: num(x.ap), sp: num(x.sp),
    hi: num(x.high_score), avg: num(x.average_points) == null ? null : Math.round(num(x.average_points) * 10) / 10,
  })).sort((a, b) => a.id - b.id);
  let w = 0, l = 0, ti = 0, pts = 0, ptsN = 0, hi = null;
  for (const e of ev) {
    const m = e.w + e.l + e.t;
    w += e.w; l += e.l; ti += e.t;
    if (e.avg != null && m) { pts += e.avg * m; ptsN += m; }
    if (e.hi != null && (hi == null || e.hi > hi)) hi = e.hi;
  }
  const seen = new Set();
  const awards = (aw || []).map((a) => [String(a.title || "Award").replace(/\s*\([^)]*\)\s*$/, ""), (a.event && a.event.name) || ""])
    .filter(([ti2, en]) => { const k = ti2 + "|" + en; if (seen.has(k)) return false; seen.add(k); return true; });

  return {
    n: t.number, loc: t.loc, gr: t.gr, rb: t.rb,
    d: ds.length ? Math.max(...ds) : null, p: ps.length ? Math.max(...ps) : null,
    dAvg: avgOf(ds), pAvg: avgOf(ps),
    sh, ev, aw: awards,
    w, l, t: ti, played: w + l + ti, avg: ptsN ? Math.round((pts / ptsN) * 10) / 10 : null, hi,
    cur: byEv.has(t.reid) ? { d: byEv.get(t.reid).d, p: byEv.get(t.reid).p, da: byEv.get(t.reid).da, pa: byEv.get(t.reid).pa } : null,
    // some of the three requests failed: the entry is incomplete (and gets retried on the next refresh)
    part: !sk || !rk || !aw ? 1 : 0,
  };
}

async function teamStats(t, season, reid) {
  const q = "?season%5B%5D=" + season;
  const [sk, rk, aw] = await Promise.all([
    all(`/teams/${t.id}/skills${q}`).catch(() => null),
    all(`/teams/${t.id}/rankings${q}`).catch(() => null),
    all(`/teams/${t.id}/awards${q}`).catch(() => null),
  ]);
  if (!sk && !rk && !aw) return { n: t.number, loc: t.loc, gr: t.gr, rb: t.rb, err: 1 };
  return summarize({ ...t, reid }, sk, rk, aw);
}

export default async (req) => {
  const CODE = Netlify.env.get("TEAM_CODE");
  if (!CODE || !same(req.headers.get("x-code"), CODE)) return json({ error: "Wrong code" }, 401);
  const store = getStore({ name: "scout", consistency: "strong" });
  const path = new URL(req.url).pathname.replace(/^\/api/, "");
  const bump = () => store.setJSON("_v", { v: Date.now() });

  try {
    if (path === "/login") return json({ ok: true });

    if (path === "/version") {
      const x = await store.get("_v", { type: "json" });
      return json({ v: x ? x.v : 0 });
    }

    if (path === "/state") {
      const out = {};
      for (const c of COLS) {
        const { blobs } = await store.list({ prefix: c + "/" });
        const docs = await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" })));
        out[c] = docs.map((d, i) => d && { id: blobs[i].key.slice(c.length + 1), ...d }).filter(Boolean);
      }
      const x = await store.get("_v", { type: "json" });
      out.v = x ? x.v : 0;
      return json(out);
    }

    const body = req.method === "POST" ? await req.json() : {};

    if (path === "/doc") {
      const { col, id, data, mode } = body;
      if (!COLS.includes(col) || !IDOK.test(id || "")) return json({ error: "Bad request" }, 400);
      const key = col + "/" + id;
      if (mode === "delete") await store.delete(key);
      else {
        if (JSON.stringify(data || {}).length > 100000) return json({ error: "Too big" }, 400);
        if (mode === "update") {
          const old = (await store.get(key, { type: "json" })) || {};
          await store.setJSON(key, { ...old, ...data });
        } else await store.setJSON(key, data || {});
      }
      await bump();
      return json({ ok: true });
    }

    // delete an event together with everything that belongs to it (teams, matches, notes)
    if (path === "/purge") {
      const eid = String(body.eventId || "");
      if (!IDOK.test(eid)) return json({ error: "Bad request" }, 400);
      const gone = ["events/" + eid];
      for (const c of ["teams", "matches", "notes", "rankings", "stats"]) {
        const { blobs } = await store.list({ prefix: c + "/" });
        const docs = await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" })));
        docs.forEach((d, i) => { if (d && d.eventId === eid) gone.push(blobs[i].key); });
      }
      for (let i = 0; i < gone.length; i += 20) await Promise.all(gone.slice(i, i + 20).map((k) => store.delete(k)));
      await Promise.all([store.delete("_mh_" + eid), store.delete("_imp_" + eid), store.delete("_rk_" + eid), store.delete("_stl_" + eid)]);
      await bump();
      return json({ ok: true, deleted: gone.length });
    }

    // Season stats for every team at the event, a few teams per request (the phone keeps calling with the next offset).
    // Nothing is announced to the other phones until the last chunk, so they don't re-download after every chunk.
    if (path === "/stats") {
      const eid = String(body.eventId || "");
      if (!IDOK.test(eid)) return json({ error: "Bad request" }, 400);
      const evDoc = await store.get("events/" + eid, { type: "json" });
      if (!evDoc || !evDoc.reid) return json({ error: "Season stats need an event imported from VEX Events" }, 404);
      const off = Math.max(0, +body.offset || 0), lockKey = "_stl_" + eid;
      let lock;
      if (off === 0) {
        const lk = await store.get(lockKey, { type: "json" });
        if (lk && Date.now() - lk.t < 90000) return json({ ok: true, busy: true });
        const cur = await store.get("stats/" + eid, { type: "json" });
        if (!body.force && cur && cur.t && Date.now() - cur.t < 600000) return json({ ok: true, fresh: true, done: true });
        const teams = await all(`/events/${evDoc.reid}/teams`);
        let season = evDoc.season;
        if (!season) { const one = await re("/events/" + evDoc.reid); season = one.season && one.season.id; }
        if (!season) return json({ error: "VEX Events didn't say which season this event is in" }, 502);
        lock = {
          t: Date.now(), season,
          roster: teams.map((t) => ({ id: t.id, number: t.number, rb: t.robot_name || "", gr: t.grade || "",
            loc: t.location ? [t.location.city, t.location.region].filter(Boolean).join(", ") : "" })),
        };
      } else {
        lock = await store.get(lockKey, { type: "json" });
        if (!lock || !lock.roster) return json({ error: "The refresh was interrupted. Tap Refresh to start again." }, 409);
      }
      const slice = lock.roster.slice(off, off + CHUNK);
      const res = await Promise.all(slice.map((t) => teamStats(t, lock.season, evDoc.reid)));
      const doc = (await store.get("stats/" + eid, { type: "json" })) || {};
      doc.eventId = eid; doc.season = lock.season; doc.teams = doc.teams || {};
      for (const r of res) doc.teams[r.n] = r;
      const next = off + CHUNK, done = next >= lock.roster.length;
      if (done) {
        const here = new Set(lock.roster.map((t) => t.number));
        for (const k of Object.keys(doc.teams)) if (!here.has(k)) delete doc.teams[k]; // team left the event
        doc.t = Date.now();
      }
      await store.setJSON("stats/" + eid, doc);
      if (done) { await store.delete(lockKey); await bump(); }
      else await store.setJSON(lockKey, { ...lock, t: Date.now() });
      return json({ ok: true, done, next, total: lock.roster.length });
    }

    if (path === "/import") {
      const sku = String(body.sku || "").toUpperCase().trim();
      if (!SKU.test(sku)) return json({ error: "That doesn't look like an event code (e.g. RE-V5RC-26-5068)" }, 400);
      const eid = sku.toLowerCase();
      const old = await store.get("events/" + eid, { type: "json" });
      const writeAll = async (docs) => {
        for (let i = 0; i < docs.length; i += 20)
          await Promise.all(docs.slice(i, i + 20).map(([k, d]) => store.setJSON(k, d)));
      };

      // quick refresh (every few seconds): matches and scores only, and only writes if something changed
      if (body.light && old && old.reid) {
        const last = await store.get("_imp_" + eid, { type: "json" });
        if (last && Date.now() - last.t < 4000) return json({ ok: true, cached: true, eventId: eid });
        await store.setJSON("_imp_" + eid, { t: Date.now() });
        const docs = await matchDocs(eid, old.reid, old.divs || []);
        const h = JSON.stringify(docs);
        const prev = await store.get("_mh_" + eid, { type: "json" });
        const changed = !prev || prev.h !== h;
        if (changed) {
          await writeAll(docs);
          await store.setJSON("_mh_" + eid, { h });
        }
        // Rankings: VEX Events updates them a little after the scores, so after any score change
        // keep checking them for 3 minutes (only writing when they actually change).
        const rk = (await store.get("_rk_" + eid, { type: "json" })) || {};
        let rkChanged = false;
        if (changed || !rk.h || Date.now() < (rk.until || 0)) {
          const rd = await rankDoc(eid, old.reid, old.divs || []);
          const rh = JSON.stringify(rd[1].list);
          if (rh !== rk.h) { await store.setJSON(rd[0], rd[1]); rkChanged = true; }
          await store.setJSON("_rk_" + eid, { h: rh, until: changed ? Date.now() + 180000 : rk.until || 0 });
        }
        if (changed || rkChanged) await bump();
        return json({ ok: true, changed: changed || rkChanged, eventId: eid });
      }

      // full import: event, teams, matches
      const found = await re("/events?sku%5B%5D=" + sku);
      const e = found.data && found.data[0];
      if (!e) return json({ error: "Event not found on RobotEvents" }, 404);
      const divs = (e.divisions || []).map((d) => d.id);
      const docs = [["events/" + eid, {
        picks: [], link: `https://events.vex.com/robot-competitions/vex-robotics-competition/${sku}.html`,
        ...(old || {}), name: e.name, sku, reid: e.id, divs, season: e.season && e.season.id,
      }]];
      const teams = await all(`/events/${e.id}/teams`);
      for (const t of teams)
        docs.push([`teams/${eid}_${t.number}`, { eventId: eid, number: t.number, name: t.team_name || "", school: t.organization || "" }]);
      const md = await matchDocs(eid, e.id, divs);
      const rd = await rankDoc(eid, e.id, divs);
      await writeAll([...docs, ...md, rd]);
      await store.setJSON("_mh_" + eid, { h: JSON.stringify(md) });
      await store.setJSON("_rk_" + eid, { h: JSON.stringify(rd[1].list), until: Date.now() + 180000 });
      await bump();
      return json({ ok: true, eventId: eid, teams: teams.length, matches: md.length });
    }

    return json({ error: "Not found" }, 404);
  } catch (err) {
    return json({ error: String(err.message || err) }, 500);
  }
};

export const config = { path: "/api/*" };
