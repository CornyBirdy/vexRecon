// Recon API: a Cloudflare Pages Function that answers everything under /api/*.
// Data lives in one D1 table, docs(collection, id, json) (see schema.sql). Bindings: DB (D1), ROBOTEVENTS_KEY,
// TEAM_CODE, ADMIN_CODE, LEGACY_TEAM, LEGACY_TEAM_NAME.

const COLS = ["events", "teams", "matches", "notes", "config", "rankings", "stats"];
const IDOK = /^[A-Za-z0-9_.\-]{1,200}$/;
// Event codes: RE-V5RC-26-5068, VE-V5-26-66510 ... The box may also hold a pasted event page link, so pull the code out of it.
const SKU = /^[A-Z]{2,4}-[A-Z0-9]{2,8}-\d{2}-\d{3,7}$/;
const SKU_IN = /(?<![A-Z0-9])[A-Z]{2,4}-[A-Z0-9]{2,8}-\d{2}-\d{3,7}(?![0-9])/i;
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

// ---------- D1 storage ----------
// One table holds everything. `collection` is "<store>/<kind>" (store = "team-52111a", or "scout" for the original
// install; kind = events, teams, matches ...), so each team's rows are separate. Keys without a slash ("_v", "_mh_x")
// go in "<store>/_meta". The team registry lives in the collection "_registry".
class Store {
  constructor(db, ns, fixed) { this.db = db; this.ns = ns; this.fixed = fixed; }
  loc(key) {
    if (this.fixed) return [this.fixed, key];
    const i = key.indexOf("/");
    return i < 0 ? [this.ns + "/_meta", key] : [this.ns + "/" + key.slice(0, i), key.slice(i + 1)];
  }
  async get(key) {
    const [c, id] = this.loc(key);
    const j = await this.db.prepare("SELECT json FROM docs WHERE collection = ?1 AND id = ?2").bind(c, id).first("json");
    return j == null ? null : JSON.parse(j);
  }
  async getMany(keys) { // one query, results in the order asked (null where missing)
    const [c] = this.loc(keys[0]);
    const { results } = await this.db.prepare(`SELECT id, json FROM docs WHERE collection = ?1 AND id IN (${keys.map((_, i) => "?" + (i + 2)).join(",")})`).bind(c, ...keys.map((k) => this.loc(k)[1])).all();
    const m = new Map(results.map((r) => [r.id, JSON.parse(r.json)]));
    return keys.map((k) => m.get(this.loc(k)[1]) || null);
  }
  put(key, val) { // a statement, for batching
    const [c, id] = this.loc(key);
    return this.db.prepare("INSERT INTO docs (collection, id, json) VALUES (?1, ?2, ?3) ON CONFLICT (collection, id) DO UPDATE SET json = excluded.json").bind(c, id, JSON.stringify(val));
  }
  drop(key) { const [c, id] = this.loc(key); return this.db.prepare("DELETE FROM docs WHERE collection = ?1 AND id = ?2").bind(c, id); }
  set(key, val) { return this.put(key, val).run(); }
  delete(key) { return this.drop(key).run(); }
  async setMany(pairs) { // D1 batches are one round trip each; keep them modest
    for (let i = 0; i < pairs.length; i += 50) await this.db.batch(pairs.slice(i, i + 50).map(([k, v]) => this.put(k, v)));
  }
}

// ---------- VEX Events (RobotEvents) client ----------
// Cloudflare's free plan allows 50 external subrequests (fetch calls) per request. Each request builds its own client
// that counts its fetches and stops with a clear message before the platform would cut it off with an opaque error.
const FETCH_MAX = 48;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function client(env) {
  let used = 0;
  async function re(p, tries = 0) {
    const key = env.ROBOTEVENTS_KEY;
    if (!key) throw new Error("ROBOTEVENTS_KEY is not set in Cloudflare");
    if (used >= FETCH_MAX) throw new Error("That needs more VEX Events requests than one call can make. Try again; if it keeps happening the event is too big for the free plan.");
    used++;
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
  return { re, all, left: () => FETCH_MAX - used, hasKey: !!env.ROBOTEVENTS_KEY };
}

// One request per division for matches (a division's matches fit in one page of 250).
async function matchDocs(x, eid, reid, divs) {
  const docs = [];
  for (const d of divs) {
    const ms = await x.all(`/events/${reid}/divisions/${d}/matches`);
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
async function rankDoc(x, eid, reid, divs) {
  const list = [];
  for (const d of divs) {
    for (const r of await x.all(`/events/${reid}/divisions/${d}/rankings`)) {
      const team = r.team && (r.team.name || r.team.code);
      if (team) list.push({ team, div: d, rank: r.rank, w: r.wins, l: r.losses, t: r.ties, wp: r.wp, ap: r.ap, sp: r.sp, high: r.high_score, avg: r.average_points });
    }
  }
  return ["rankings/" + eid, { eventId: eid, list, t: Date.now() }];
}

// ---------- teams ----------
// Every team gets its own private set of rows. The registry holds each team's number, name and a salted hash of its
// team code. Team codes are generated (XXXX-XXXX, no look-alike characters) and only ever shown once, to the person
// who set the team up, or when someone makes a new one in Team settings.
const TEAM_NUM = /^[0-9]{1,6}[A-Z]?$/;
const ALPHA = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const tid = (n) => String(n || "").trim().toUpperCase().replace(/\s+/g, "");
function rnd(n) { // unbiased random integer in [0, n)
  const lim = 256 - (256 % n), b = new Uint8Array(1);
  for (;;) { crypto.getRandomValues(b); if (b[0] < lim) return b[0] % n; }
}
const newCode = () => Array.from({ length: 8 }, (_, i) => ALPHA[rnd(ALPHA.length)] + (i === 3 ? "-" : "")).join("");
const normCode = (c) => String(c || "").toUpperCase().replace(/[^0-9A-Z]/g, "").replace(/^(.{4})(.{4})$/, "$1-$2");

// Codes are hashed with PBKDF2-SHA256 (Web Crypto). The free plan gives each request about 10 ms of CPU, so the cost is
// kept modest (the iteration count is stored with each hash, so it can be raised later) and a code that has just been
// checked is remembered by this server instance for a while, so the many requests a signed-in phone makes stay cheap.
const ITER = 10000;
const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
async function pbkdf2(code, salt, it) {
  const k = await crypto.subtle.importKey("raw", enc.encode(code), "PBKDF2", false, ["deriveBits"]);
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: enc.encode(salt), iterations: it }, k, 256));
}
async function hashCode(code) {
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  return { salt, hash: await pbkdf2(code, salt, ITER), it: ITER };
}
const VERIFIED = new Map();
async function checkCode(code, rec) {
  if (!rec.salt || !rec.hash || !rec.it) return false; // not one of ours (e.g. an old scrypt hash)
  const ck = rec.salt + rec.hash, quick = hex(await crypto.subtle.digest("SHA-256", enc.encode(rec.salt + "|" + code)));
  const hit = VERIFIED.get(ck);
  if (hit && hit.until > Date.now() && same(hit.quick, quick)) return true;
  if (!same(await pbkdf2(code, rec.salt, rec.it), rec.hash)) return false;
  if (VERIFIED.size > 200) VERIFIED.delete(VERIFIED.keys().next().value);
  VERIFIED.set(ck, { quick, until: Date.now() + 10 * 60000 });
  return true;
}
const pub = (rec) => ({ number: rec.number, name: rec.name || "", org: rec.org || "" });

// The original single-team install (Invictus 52111A, data in the "scout" store, code in TEAM_CODE) is adopted as a
// team the first time it signs in, so its data carries over untouched.
const LEGACY_TEAM = (env) => tid(env.LEGACY_TEAM || "52111A");

async function lookupTeam(x, number) {
  if (!x.hasKey) return null; // local preview without a key: skip the check
  const j = await x.re("/teams?number%5B%5D=" + encodeURIComponent(number));
  const list = (j.data || []).filter((t) => tid(t.number) === number);
  const t = list.find((y) => y.program && y.program.code === "V5RC") || list[0];
  return t ? { number, name: t.team_name || "", org: t.organization || "", program: (t.program && t.program.code) || "" } : false;
}

// returns { rec, reg, store } or a Response to send back
async function auth(req, env, db) {
  const number = tid(req.headers.get("x-team")), code = req.headers.get("x-code") || "";
  if (!TEAM_NUM.test(number) || !code) return json({ error: "Wrong team or code" }, 401);
  const reg = new Store(db, "", "_registry");
  const [r0, f0] = await reg.getMany([number, "_fail_" + number]);
  const fails = f0 || { n: 0, t: 0 };
  let rec = r0;
  if (fails.n >= 10 && Date.now() - fails.t < 10 * 60000) return json({ error: "Too many wrong codes. Try again in a few minutes." }, 429);
  if (!rec && number === LEGACY_TEAM(env) && env.TEAM_CODE && same(code, env.TEAM_CODE)) {
    rec = { number, name: env.LEGACY_TEAM_NAME || "Invictus", org: "", store: "scout", norm: false, created: Date.now(), ...(await hashCode(code)) };
    await reg.set(number, rec);
  }
  if (!rec || !(await checkCode(rec.norm === false ? code : normCode(code), rec))) {
    await reg.set("_fail_" + number, { n: Date.now() - fails.t < 10 * 60000 ? fails.n + 1 : 1, t: Date.now() });
    return json({ error: "Wrong team or code" }, 401);
  }
  if (fails.n) await reg.delete("_fail_" + number);
  return { rec, reg, store: new Store(db, rec.store) };
}

// ---------- recovery key ----------
// A second secret, made when the team is set up (or later in Team settings) and kept by the coach or mentor, not shared
// with everyone like the team code. If every phone is logged out, it is the only thing that gets a new team code without
// the Recon owner: nobody can recover a team from its number alone. Stored hashed, like the team code.
const newKey = () => Array.from({ length: 16 }, (_, i) => ALPHA[rnd(ALPHA.length)] + (i % 4 === 3 && i < 15 ? "-" : "")).join("");
const normKey = (k) => String(k || "").toUpperCase().replace(/[^0-9A-Z]/g, "");
const withKey = async (rec) => { const key = newKey(); return { key, rec: { ...rec, rk: await hashCode(normKey(key)) } }; };
const keyOk = (key, rec) => !!rec.rk && normKey(key).length === 16 && checkCode(normKey(key), rec.rk);

// ---------- event browser ----------
// VEX Events can't search by name, so we fetch a date window (or one team's season) and filter here.
// The fetched lists are kept in memory for a few minutes so a burst of searches costs one set of requests.
const EV_CACHE = new Map(), EV_TTL = 10 * 60000, EV_PAGES = 12, EV_MAX = 120;
const day = (d) => new Date(d).toISOString().slice(0, 10);
async function allPages(x, p) { // first page tells us how many there are; fetch the rest a few at a time
  const first = await x.re(p + "&per_page=250&page=1"), out = [...(first.data || [])], last = Math.min((first.meta && first.meta.last_page) || 1, EV_PAGES);
  for (let pg = 2; pg <= last; pg += 4) {
    const got = await Promise.all(Array.from({ length: Math.min(4, last - pg + 1) }, (_, i) => x.re(p + "&per_page=250&page=" + (pg + i))));
    for (const g of got) out.push(...(g.data || []));
  }
  return out;
}
let progId; // VEX V5 Robotics Competition's id on VEX Events, found once
async function v5Program(x) {
  if (progId !== undefined) return progId;
  try {
    const list = await x.all("/programs");
    const hit = list.find((p) => /^(V5RC|VRC)$/i.test(p.abbr || p.code || ""));
    progId = hit ? hit.id : null;
  } catch (e) { return null; }
  return progId;
}
const notV5 = (e) => /^[A-Z]{2,4}-(VIQ|VAI)/i.test(e.sku || "") || /^(VIQ|VAI|ADC)/i.test((e.program && e.program.code) || "");
function evRow(e) {
  const l = e.location || {};
  return { sku: e.sku, name: e.name, start: e.start, end: e.end, city: l.city || "", region: l.region || "", country: l.country || "", venue: l.venue || "", level: e.level || "", divs: (e.divisions || []).length };
}
async function browseEvents(x, scope, rec) {
  const key = scope + "|" + (scope === "mine" ? rec.number : "");
  const hit = EV_CACHE.get(key);
  if (hit && Date.now() - hit.t < EV_TTL) return hit.list;
  const now = Date.now(), d = new Date(now), yr = d.getUTCMonth() >= 4 ? d.getUTCFullYear() : d.getUTCFullYear() - 1, seasonStart = yr + "-05-01";
  let q = "/events?_=1", sort = 1;
  if (scope === "mine") {
    const j = await x.re("/teams?number%5B%5D=" + encodeURIComponent(rec.number));
    const t = (j.data || []).filter((y) => tid(y.number) === rec.number).sort((a, b) => ((b.program && b.program.code === "V5RC") ? 1 : 0) - ((a.program && a.program.code === "V5RC") ? 1 : 0))[0];
    if (!t) return [];
    q += "&team%5B%5D=" + t.id + "&start=" + seasonStart;
  } else {
    const pid = await v5Program(x);
    if (pid) q += "&program%5B%5D=" + pid;
    if (scope === "soon") q += "&start=" + day(now - 3 * 86400000) + "&end=" + day(now + 60 * 86400000);
    else { q += "&start=" + seasonStart + "&end=" + day(now - 3 * 86400000); sort = -1; }
  }
  const list = (await allPages(x, q)).filter((e) => e.sku && !notV5(e)).map(evRow).sort((a, b) => sort * (new Date(a.start) - new Date(b.start)));
  EV_CACHE.set(key, { t: Date.now(), list });
  if (EV_CACHE.size > 40) EV_CACHE.delete(EV_CACHE.keys().next().value);
  return list;
}

// ---------- season stats (skills, season record, awards) ----------
// Per team, from the whole season (not just this event): the best driver / programming skills score at each event,
// the ranking row at each event and the awards. Boiled down to a compact entry so the phones stay light.
// 6 teams x 3 requests = 18 fetches (plus the roster on the first chunk), well inside the 50-per-request limit.
const CHUNK = 6;
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

async function teamStats(x, t, season, reid) {
  const q = "?season%5B%5D=" + season;
  const [sk, rk, aw] = await Promise.all([
    x.all(`/teams/${t.id}/skills${q}`).catch(() => null),
    x.all(`/teams/${t.id}/rankings${q}`).catch(() => null),
    x.all(`/teams/${t.id}/awards${q}`).catch(() => null),
  ]);
  if (!sk && !rk && !aw) return { n: t.number, loc: t.loc, gr: t.gr, rb: t.rb, err: 1 };
  return summarize({ ...t, reid }, sk, rk, aw);
}

// ---------- the API ----------
export async function onRequest({ request: req, env }) {
  const path = new URL(req.url).pathname.replace(/^\/api/, "");
  const db = env.DB;
  if (!db) return json({ error: "The D1 database isn't connected. Add a D1 binding named DB to the Pages project." }, 500);
  const x = client(env);

  // ---- open endpoints: look a team up, set a new team up, admin ----
  if (path === "/lookup" || path === "/register" || path === "/admin" || path === "/recover") {
    try {
      const body = req.method === "POST" ? await req.json() : {};
      const reg = new Store(db, "", "_registry");
      if (path === "/admin") { // owner-only: reset a team's code or remove it (for squatted team numbers)
        const ADMIN = env.ADMIN_CODE;
        if (!ADMIN || !same(body.adminCode, ADMIN)) return json({ error: "Wrong admin code" }, 401);
        const number = tid(body.team), rec = await reg.get(number);
        if (!rec) return json({ error: "No such team" }, 404);
        if (body.action === "reset") { const code = newCode(); await reg.set(number, { ...rec, norm: true, ...(await hashCode(code)) }); return json({ ok: true, code }); }
        if (body.action === "remove") { await reg.delete(number); return json({ ok: true }); } // the team's data is left in place
        return json({ error: "Unknown action" }, 400);
      }
      if (path === "/recover") { // lost team code: the recovery key gets a new one
        const number = tid(body.team), rec = TEAM_NUM.test(number) && (await reg.get(number));
        if (!rec) return json({ error: "Team " + number + " isn’t set up on Recon yet, so there’s no code to recover. Set it up as a new team." }, 404);
        const fk = "_rfail_" + number, fails = (await reg.get(fk)) || { n: 0, t: 0 };
        if (fails.n >= 10 && Date.now() - fails.t < 10 * 60000) return json({ error: "Too many wrong keys. Try again in a few minutes." }, 429);
        if (!rec.rk) return json({ error: "Team " + number + " doesn’t have a recovery key, so Recon can’t tell it’s you. Ask the Recon owner to reset the code.", nokey: true }, 403);
        if (!(await keyOk(body.key, rec))) {
          await reg.set(fk, { n: Date.now() - fails.t < 10 * 60000 ? fails.n + 1 : 1, t: Date.now() });
          return json({ error: "That recovery key doesn’t match team " + number + "." }, 403);
        }
        const code = newCode();
        await reg.set(number, { ...rec, norm: true, ...(await hashCode(code)) });
        await reg.delete(fk); await reg.delete("_fail_" + number);
        return json({ ok: true, team: pub(rec), code });
      }
      const number = tid(body.team);
      if (!TEAM_NUM.test(number)) return json({ error: "That doesn't look like a VEX team number (e.g. 52111A)" }, 400);
      const taken = !!(await reg.get(number)) || (number === LEGACY_TEAM(env) && !!env.TEAM_CODE);
      const info = await lookupTeam(x, number);
      if (info === false) return json({ error: "No VEX team " + number + " on VEX Events" }, 404);
      if (path === "/lookup") return json({ team: info || { number, name: "", org: "" }, taken });
      if (taken) return json({ error: "Team " + number + " is already set up on Recon. Ask a teammate for your team code." }, 409);
      const code = newCode();
      const made = await withKey({ number, name: (info && info.name) || String(body.name || "").slice(0, 60), org: (info && info.org) || "", store: "team-" + number.toLowerCase(), norm: true, created: Date.now(), ...(await hashCode(code)) });
      await reg.set(number, made.rec);
      return json({ ok: true, team: pub(made.rec), code, recoveryKey: made.key });
    } catch (err) {
      return json({ error: String(err.message || err) }, 500);
    }
  }

  const a = await auth(req, env, db);
  if (a instanceof Response) return a;
  const { rec, reg, store } = a;
  const bump = () => store.set("_v", { v: Date.now() });

  try {
    if (path === "/login") return json({ ok: true, team: pub(rec) });

    if (path === "/rotate") { // make a new team code; the old one stops working
      const code = newCode();
      await reg.set(rec.number, { ...rec, norm: true, ...(await hashCode(code)) });
      return json({ ok: true, code });
    }

    if (path === "/recovery-key") { // make (or replace) the recovery key; shown once, the old one stops working
      const made = await withKey(rec);
      await reg.set(rec.number, made.rec);
      return json({ ok: true, key: made.key });
    }

    if (path === "/events") { // browse VEX Events: this team's events, coming up, or earlier this season
      const body = req.method === "POST" ? await req.json() : {}, scope = ["mine", "soon", "past"].includes(body.scope) ? body.scope : "mine";
      if (!x.hasKey) return json({ error: "Event search needs the VEX Events key on the server." }, 503);
      const all2 = await browseEvents(x, scope, rec), q = String(body.q || "").toLowerCase().split(/\s+/).filter(Boolean);
      const hit = q.length ? all2.filter((e) => { const hay = [e.name, e.sku, e.city, e.region, e.country, e.venue].join(" ").toLowerCase(); return q.every((w) => hay.includes(w)); }) : all2;
      return json({ ok: true, total: hit.length, events: hit.slice(0, EV_MAX) });
    }

    if (path === "/version") {
      const v = await store.get("_v");
      return json({ v: v ? v.v : 0 });
    }

    if (path === "/state") {
      const sel = db.prepare("SELECT id, json FROM docs WHERE collection = ?1 ORDER BY id");
      const res = await db.batch([...COLS.map((c) => sel.bind(rec.store + "/" + c)), sel.bind(rec.store + "/_meta")]);
      const out = {};
      COLS.forEach((c, i) => { out[c] = res[i].results.map((r) => ({ id: r.id, ...JSON.parse(r.json) })); });
      const v = res[COLS.length].results.find((r) => r.id === "_v");
      out.v = v ? JSON.parse(v.json).v : 0;
      out.rk = !!rec.rk; // whether the team has a recovery key
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
          const old = (await store.get(key)) || {};
          await store.set(key, { ...old, ...data });
        } else await store.set(key, data || {});
      }
      await bump();
      return json({ ok: true });
    }

    // delete an event together with everything that belongs to it (teams, matches, notes)
    if (path === "/purge") {
      const eid = String(body.eventId || "");
      if (!IDOK.test(eid)) return json({ error: "Bad request" }, 400);
      const del = db.prepare("DELETE FROM docs WHERE collection = ?1 AND json_extract(json, '$.eventId') = ?2");
      const res = await db.batch([
        store.drop("events/" + eid),
        ...["teams", "matches", "notes", "rankings", "stats"].map((c) => del.bind(rec.store + "/" + c, eid)),
        ...["_mh_", "_imp_", "_rk_", "_stl_"].map((p) => store.drop(p + eid)),
      ]);
      const deleted = res.slice(0, 6).reduce((n, r) => n + ((r.meta && r.meta.changes) || 0), 0);
      await bump();
      return json({ ok: true, deleted });
    }

    // Season stats for every team at the event, a few teams per request (the phone keeps calling with the next offset).
    // Nothing is announced to the other phones until the last chunk, so they don't re-download after every chunk.
    if (path === "/stats") {
      const eid = String(body.eventId || "");
      if (!IDOK.test(eid)) return json({ error: "Bad request" }, 400);
      const evDoc = await store.get("events/" + eid);
      if (!evDoc || !evDoc.reid) return json({ error: "Season stats need an event imported from VEX Events" }, 404);
      const off = Math.max(0, +body.offset || 0), lockKey = "_stl_" + eid;
      let lock;
      if (off === 0) {
        const lk = await store.get(lockKey);
        if (lk && Date.now() - lk.t < 90000) return json({ ok: true, busy: true });
        const cur = await store.get("stats/" + eid);
        if (!body.force && cur && cur.t && Date.now() - cur.t < 600000) return json({ ok: true, fresh: true, done: true });
        const teams = await x.all(`/events/${evDoc.reid}/teams`);
        let season = evDoc.season;
        if (!season) { const one = await x.re("/events/" + evDoc.reid); season = one.season && one.season.id; }
        if (!season) return json({ error: "VEX Events didn't say which season this event is in" }, 502);
        lock = {
          t: Date.now(), season,
          roster: teams.map((t) => ({ id: t.id, number: t.number, rb: t.robot_name || "", gr: t.grade || "",
            loc: t.location ? [t.location.city, t.location.region].filter(Boolean).join(", ") : "" })),
        };
      } else {
        lock = await store.get(lockKey);
        if (!lock || !lock.roster) return json({ error: "The refresh was interrupted. Tap Refresh to start again." }, 409);
      }
      const slice = lock.roster.slice(off, off + CHUNK);
      const res = await Promise.all(slice.map((t) => teamStats(x, t, lock.season, evDoc.reid)));
      const doc = (await store.get("stats/" + eid)) || {};
      doc.eventId = eid; doc.season = lock.season; doc.teams = doc.teams || {};
      for (const r of res) doc.teams[r.n] = r;
      const next = off + CHUNK, done = next >= lock.roster.length;
      if (done) {
        const here = new Set(lock.roster.map((t) => t.number));
        for (const k of Object.keys(doc.teams)) if (!here.has(k)) delete doc.teams[k]; // team left the event
        doc.t = Date.now();
      }
      await store.set("stats/" + eid, doc);
      if (done) { await store.delete(lockKey); await bump(); }
      else await store.set(lockKey, { ...lock, t: Date.now() });
      return json({ ok: true, done, next, total: lock.roster.length });
    }

    if (path === "/import") {
      const sku = ((String(body.sku || "").match(SKU_IN) || [])[0] || "").toUpperCase();
      if (!SKU.test(sku)) return json({ error: "That doesn't look like an event code (e.g. RE-V5RC-26-5068 or VE-V5-26-66510). You can also paste the event page link." }, 400);
      const eid = sku.toLowerCase();
      const old = await store.get("events/" + eid);

      // quick refresh (every few seconds): matches and scores only, and only writes if something changed
      if (body.light && old && old.reid) {
        const last = await store.get("_imp_" + eid);
        if (last && Date.now() - last.t < 4000) return json({ ok: true, cached: true, eventId: eid });
        await store.set("_imp_" + eid, { t: Date.now() });
        const docs = await matchDocs(x, eid, old.reid, old.divs || []);
        const h = JSON.stringify(docs);
        const prev = await store.get("_mh_" + eid);
        const changed = !prev || prev.h !== h;
        if (changed) {
          await store.setMany(docs);
          await store.set("_mh_" + eid, { h });
        }
        // Rankings: VEX Events updates them a little after the scores, so after any score change
        // keep checking them for 3 minutes (only writing when they actually change).
        const rk = (await store.get("_rk_" + eid)) || {};
        let rkChanged = false;
        if (changed || !rk.h || Date.now() < (rk.until || 0)) {
          const rd = await rankDoc(x, eid, old.reid, old.divs || []);
          const rh = JSON.stringify(rd[1].list);
          if (rh !== rk.h) { await store.set(rd[0], rd[1]); rkChanged = true; }
          await store.set("_rk_" + eid, { h: rh, until: changed ? Date.now() + 180000 : rk.until || 0 });
        }
        if (changed || rkChanged) await bump();
        return json({ ok: true, changed: changed || rkChanged, eventId: eid });
      }

      // full import: event, teams, matches. Fetches: 1 (event) + team pages + 1 per division (matches), well under 50 for
      // any normal event. The rankings are best effort: if the budget is short or they fail, the quick refresh (which runs
      // every few seconds from the phones) fetches them straight afterwards.
      const found = await x.re("/events?sku%5B%5D=" + sku);
      const e = found.data && found.data[0];
      if (!e) return json({ error: "Event " + sku + " wasn't found on VEX Events. Check the code on the event page." }, 404);
      const divs = (e.divisions || []).map((d) => d.id);
      const docs = [["events/" + eid, {
        picks: [], link: `https://events.vex.com/robot-competitions/vex-robotics-competition/${sku}.html`,
        ...(old || {}), name: e.name, sku, reid: e.id, divs, season: e.season && e.season.id, start: e.start, end: e.end,
      }]];
      const teams = await x.all(`/events/${e.id}/teams`);
      for (const t of teams)
        docs.push([`teams/${eid}_${t.number}`, { eventId: eid, number: t.number, name: t.team_name || "", school: t.organization || "" }]);
      const md = await matchDocs(x, eid, e.id, divs);
      let rd = null;
      if (x.left() > divs.length) { try { rd = await rankDoc(x, eid, e.id, divs); } catch (err) { rd = null; } }
      await store.setMany(rd ? [...docs, ...md, rd] : [...docs, ...md]);
      await store.set("_mh_" + eid, { h: JSON.stringify(md) });
      await store.set("_rk_" + eid, { h: rd ? JSON.stringify(rd[1].list) : "", until: Date.now() + 180000 });
      await bump();
      return json({ ok: true, eventId: eid, teams: teams.length, matches: md.length });
    }

    return json({ error: "Not found" }, 404);
  } catch (err) {
    return json({ error: String(err.message || err) }, 500);
  }
}
