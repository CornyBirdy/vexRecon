'use strict';
// Recon – client. Made by Invictus 52111A.
// Data lives on the server (functions/api/[[path]].js). Every change is applied locally straight away,
// queued in an outbox (kept in localStorage) and sent when there is a connection, so the app keeps
// working on bad venue wifi. The last downloaded state is cached so the app also opens offline.

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ls = (k, v) => { try { if (v === undefined) return localStorage.getItem(k) || ''; localStorage.setItem(k, v) } catch (e) { return '' } };
const lsJ = (k, v) => { try { if (v === undefined) return JSON.parse(localStorage.getItem(k) || 'null'); localStorage.setItem(k, JSON.stringify(v)) } catch (e) { return null } };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const norm = s => String(s || '').trim().toUpperCase().replace(/\s+/g, '');
const slug = x => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const APP = { name: 'Recon', version: '1.2.0' };
// Signed in as one team: its number is "us" everywhere. Scout names are the team's own list (Team settings).
let US = '', NAMES = [];
const COLS = ['events', 'teams', 'matches', 'notes', 'config', 'rankings', 'stats'];
let S = { events: [], teams: [], matches: [], notes: [], config: [], rankings: [], stats: [] };
let ev = ls('ev'), tab = ls('tab') || 'event', name = ls('name'), mf = ls('mf') || 'ours', mfT = ls('mft') || '', sf = ls('sf') || 'todo', tv = ls('tv') || 'list', rks = ls('rks') || 'rank', sks = ls('sks') || 'season', sko = ls('sko') || 'c';
if (tab === 'teams') tab = 'event'; // Teams and Event are one tab now
if (!['list', 'rank', 'skills', 'more'].includes(tv)) tv = 'list';
let mTeam = null, scTeam = '', draft = null, open = {}, dirty = false, loaded = false;

const cfg = () => S.config.find(c => c.id === 'main') || {};
const evObj = () => S.events.find(e => e.id === ev);
const teams = () => S.teams.filter(t => t.eventId === ev).sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
const matches = () => S.matches.filter(m => m.eventId === ev).sort((a, b) => (a.order || 0) - (b.order || 0));
const notes = (k, ref, sec) => S.notes.filter(n => n.eventId === ev && n.kind === k && (ref === undefined || n.ref === ref) && (sec === undefined || n.sec === sec)).sort((a, b) => b.ts - a.ts);
const tName = n => { const t = teams().find(t => t.number === n); return t ? t.name : '' };
const side = (m, n) => { const us = m.red.includes(US) ? 'red' : m.blue.includes(US) ? 'blue' : null; if (!us) return ''; if (!n) return us; const mine = m[us]; return mine.includes(n) ? 'ally' : (m.red.includes(n) || m.blue.includes(n)) ? 'opp' : '' };
const cls = (m, n) => { if (n === US) return ''; const s = side(m, n); return s === 'ally' ? 'gn' : s === 'opp' ? 'rd' : '' };
const scored = m => m.rs != null && (m.rs || m.bs);
// When and where a match is played: "Sat 9:30 am · Field 2". VEX Events gives the time as a real moment (with a UTC offset that is
// often not the venue's own, e.g. -05:00 for an Adelaide event), so it is converted to this device's own time zone, like every other
// time in the app. Never read the clock digits straight off the string: they can be hours out.
function whenOf(m) {
  const t = String(m.sched || m.ran || ''), d = t ? new Date(t) : null, e = evObj();
  let at = '';
  if (d && !isNaN(d)) {
    at = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (e && e.end && String(e.end).slice(0, 10) !== String(e.start || '').slice(0, 10)) at = d.toLocaleDateString([], { weekday: 'short' }) + ' ' + at; // a multi-day event: say which day
  }
  const f = String(m.field || '').trim();
  return [at, f ? (/^\d+$/.test(f) ? 'Field ' + f : f) : ''].filter(Boolean).join(' · ');
}
const whenRow = m => { const w = whenOf(m); return w ? `<div class="mwhen mut"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>${esc(w)}</div>` : '' };
// Scouting entries: one per scout per team ("general"), plus optionally one per scout per match watched.
const scoutBase = (t, who) => 's_' + ev + '_' + t + '_' + slug(who);
const scoutId = (t, who, matchId) => scoutBase(t, who) + (matchId ? '_' + matchId : '');
// ---------- stats: OPR / DPR / CCWM and standings ----------
// OPR: least-squares estimate of the points each team adds to its alliance, from qualification scores.
// DPR: the same for points the opposing alliance scores. CCWM = OPR − DPR (effect on the winning margin).
const isQual = m => m.round === 2 || (m.round == null && /^Q\d/i.test(m.label || ''));
function solve(M, b) { // Gaussian elimination with partial pivoting; M is modified
  const n = b.length;
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];[b[c], b[p]] = [b[p], b[c]];
    for (let r = c + 1; r < n; r++) { const f = M[r][c] / M[c][c]; if (!f) continue; for (let k = c; k < n; k++) M[r][k] -= f * M[c][k]; b[r] -= f * b[c] }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) { let v = b[r]; for (let k = r + 1; k < n; k++) v -= M[r][k] * x[k]; x[r] = v / M[r][r] }
  return x;
}
let statsMemo = { key: '', val: null };
function stats() {
  const qs = matches().filter(m => isQual(m) && m.rs != null && m.bs != null);
  const off = S.rankings.find(r => r.eventId === ev), offList = (off && off.list) || [];
  const key = ev + '|' + JSON.stringify(qs.map(m => [m.red, m.blue, m.rs, m.bs])) + '|' + (off ? off.t : '');
  if (statsMemo.key === key) return statsMemo.val;
  const nums = [...new Set(qs.flatMap(m => [...m.red, ...m.blue]))], idx = new Map(nums.map((n, i) => [n, i])), n = nums.length;
  const by = new Map(nums.map(t => [t, { w: 0, l: 0, t: 0, played: 0, opr: 0, dpr: 0, ccwm: 0, sum: 0, high: null }]));
  if (n) {
    const AtA = nums.map(() => new Array(n).fill(0)), bo = new Array(n).fill(0), bd = new Array(n).fill(0);
    for (const m of qs) for (const [mine, other, ms, os] of [[m.red, m.blue, m.rs, m.bs], [m.blue, m.red, m.bs, m.rs]]) {
      for (const a of mine) {
        for (const b of mine) AtA[idx.get(a)][idx.get(b)]++;
        bo[idx.get(a)] += ms; bd[idx.get(a)] += os;
        const r = by.get(a); r.played++; r.sum += ms; if (r.high == null || ms > r.high) r.high = ms; if (ms > os) r.w++; else if (ms < os) r.l++; else r.t++;
      }
    }
    const reg = () => AtA.map((row, i) => row.map((v, j) => v + (i === j ? 1e-3 : 0))); // tiny ridge keeps it solvable early on
    const opr = solve(reg(), bo), dpr = solve(reg(), bd);
    nums.forEach((t, i) => { const r = by.get(t); r.opr = opr[i]; r.dpr = dpr[i]; r.ccwm = opr[i] - dpr[i]; r.wp = 2 * r.w + r.t; r.avg = r.played ? r.sum / r.played : null });
  }
  // rank: official from VEX Events if we have it, otherwise calculated (win points, then OPR)
  const official = offList.length > 0;
  if (official) for (const o of offList) by.set(o.team, { ...(by.get(o.team) || { opr: null, dpr: null, ccwm: null, played: o.w + o.l + o.t }), rank: o.rank, w: o.w, l: o.l, t: o.t, wp: o.wp, ap: o.ap, sp: o.sp, avg: o.avg, high: o.high, div: o.div });
  else[...by.entries()].sort((a, b) => b[1].wp - a[1].wp || b[1].opr - a[1].opr).forEach(([, r], i) => { r.rank = i + 1 });
  const divs = new Set(offList.map(o => o.div));
  return (statsMemo = { key, val: { by, official, multiDiv: divs.size > 1, n: qs.length } }).val;
}
const f1 = v => v == null || isNaN(v) ? '–' : v.toFixed(1);
const sgn = v => v == null || isNaN(v) ? '–' : (v > 0 ? '+' : '') + v.toFixed(1);
const rec = r => r.w + '-' + r.l + '-' + r.t;
// ---------- season stats from VEX Events (skills, season record, awards) ----------
// Loaded by the server a few teams at a time and shared with everyone (collection 'stats', one doc per event).
const stDoc = () => S.stats.find(s => s.eventId === ev);
const stOf = n => { const d = stDoc(); return d && d.teams && d.teams[n] && !d.teams[n].err ? d.teams[n] : null };
const has = v => v != null;
const sumOf = (a, b) => has(a) || has(b) ? (a || 0) + (b || 0) : null;
// d = driver, p = programming (autonomous), c = the two added together, a = average of c across the events they've done
function skillOf(n, scope) {
  const s = stOf(n); if (!s) return null;
  if (scope === 'event') { const c = s.cur; return c ? { d: c.d, p: c.p, c: sumOf(c.d, c.p), a: null } : null }
  return { d: s.d, p: s.p, c: sumOf(s.d, s.p), a: sumOf(s.dAvg, s.pAvg) };
}
function skillRows(scope, by) {
  const rows = teams().map(t => ({ team: t.number, ...(skillOf(t.number, scope) || { d: null, p: null, c: null, a: null }) }));
  rows.sort((a, b) => (b[by] ?? -1) - (a[by] ?? -1) || (b.c ?? -1) - (a.c ?? -1) || a.team.localeCompare(b.team, undefined, { numeric: true }));
  return rows;
}
const fmt = v => has(v) ? (Math.round(v * 10) / 10).toString() : '–';
const pct = (w, n) => n ? Math.round(100 * w / n) + '%' : '–';
let statsBusy = false, statsFailAt = 0;
const statsAge = () => { const d = stDoc(); return d && d.t ? Date.now() - d.t : Infinity };
// Scouting is shared by the whole team: anyone's entry counts, and a claim says "I'm on it" so two people don't scout the same team.
const CLAIM_MS = 6 * 3600e3;
const scoutedBy = t => { const m = new Map(); notes('scout', t).forEach(n => { const w = n.by || 'Someone'; if (!m.has(w)) m.set(w, n.ts) }); return [...m.keys()] };
const claimOf = t => { const c = notes('claim', t)[0]; if (!c || Date.now() - c.ts > CLAIM_MS || notes('scout', t).some(n => n.by === c.by)) return null; return c };
const claimId = t => 'c_' + ev + '_' + t;
const myScouts = t => { const b = scoutBase(t, name); return S.notes.filter(n => n.kind === 'scout' && (n.id === b || n.id.startsWith(b + '_'))) };

// ---------- sync ----------
const NOTE_MS = 10000, RE_MS = 15000; // how often to check for teammates' changes / VEX Events (milliseconds)
const API = '/api';
// Signed in as a team member (team code) or watching as a spectator (team number only, read-only).
const signedIn = () => !!code || spec;
class NetErr extends Error {}
class AuthErr extends Error {}
let code = ls('code'), spec = ls('spec') === '1', team = ls('team'), teamInfo = lsJ('teamInfo') || {}, pollT, impT, lastV = -1, loginErr = false, online = true, lastSync = 0;
let SPEC_ON = true; // whether spectators may watch this team (from the server)
let RK = null, rkShown = ''; // whether the team has a recovery key (from the server); a key just made, shown until dismissed
let outbox = lsJ('outbox') || [], inflight = null, flushing = false, polling = false, syncing = false, editSeq = 0;
// Event codes look like RE-V5RC-26-5068 or VE-V5-26-66510. Pull one out of whatever was typed or pasted (a whole event page link is fine).
const SKU_RE = /(?<![A-Z0-9])[A-Z]{2,4}-[A-Z0-9]{2,8}-\d{2}-\d{3,7}(?![0-9])/i;
const parseSku = t => ((String(t || '').match(SKU_RE) || [])[0] || '').toUpperCase();
const skuOf = e => (e && e.sku) || parseSku(e && e.link);

async function api(path, body) {
  let r;
  try { r = await fetch(API + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'x-team': team, 'x-code': code, ...(spec ? { 'x-spec': '1' } : {}) }, body: body ? JSON.stringify(body) : undefined }) }
  catch (e) { throw new NetErr('No connection') }
  if (r.status === 401 || r.status === 429) {
    const j = await r.json().catch(() => ({}));
    if (code && path !== '/login') { code = ''; ls('code', ''); loginErr = 'That team code no longer works. Ask a teammate for the new one.'; schedule(); render(); setStatus() }
    else loginErr = j.error || 'That team number and code don’t match.';
    throw new AuthErr(loginErr);
  }
  const j = await r.json().catch(() => ({}));
  if (r.status >= 500) throw new NetErr(j.error || ('Server error ' + r.status));
  if (!r.ok) { const e = new Error(j.error || ('Error ' + r.status)); e.status = r.status; e.data = j; throw e }
  return j;
}

function applyOp(o) {
  if (o.purge) { // whole event deleted
    S.events = S.events.filter(x => x.id !== o.purge);
    for (const k of ['teams', 'matches', 'notes', 'rankings', 'stats']) S[k] = S[k].filter(x => x.eventId !== o.purge);
    return;
  }
  const arr = S[o.col]; if (!arr) return;
  if (o.mode === 'delete') S[o.col] = arr.filter(x => x.id !== o.id);
  else if (o.mode === 'update' && arr.some(x => x.id === o.id)) S[o.col] = arr.map(x => x.id === o.id ? { ...x, ...o.data } : x);
  else S[o.col] = [...arr.filter(x => x.id !== o.id), { id: o.id, ...o.data }];
}

// Merge with the last queued change to the same doc so autosave doesn't pile up requests.
function queue(o) {
  let i = -1;
  if (!o.purge) for (let j = outbox.length - 1; j >= 0; j--) if (outbox[j].col === o.col && outbox[j].id === o.id) { i = j; break }
  const prev = i >= 0 ? outbox[i] : null;
  if (!prev || prev === inflight || o.purge) outbox.push(o);
  else if (o.mode !== 'update') outbox[i] = o;
  else if (prev.mode === 'delete') outbox.push(o);
  else outbox[i] = { ...prev, data: { ...prev.data, ...o.data } };
  lsJ('outbox', outbox);
}

const cacheState = () => lsJ('cache', { S, v: lastV, t: lastSync });
function send(o, quiet) { if (spec) return; editSeq++; applyOp(o); queue(o); cacheState(); setStatus(); flush(); if (!quiet) setTimeout(render, 0) }
const put = (k, id, d) => send({ col: k, id, data: d, mode: 'set' });
const upd = (k, id, d) => send({ col: k, id, data: d, mode: 'update' });
const del = (k, id) => send({ col: k, id, mode: 'delete' });

async function flush() {
  if (flushing || !code) return; flushing = true;
  try {
    while (outbox.length) {
      const item = outbox[0]; inflight = item;
      try { await (item.purge ? api('/purge', { eventId: item.purge }) : api('/doc', item)); online = true }
      catch (e) {
        if (e instanceof NetErr || e instanceof AuthErr) { online = !(e instanceof NetErr) && online; break }
        toast('A change couldn’t be saved: ' + e.message); // rejected by the server – drop it
      }
      outbox = outbox.filter(x => x !== item); lsJ('outbox', outbox);
    }
    if (pq.length) phFlush();
  } finally { inflight = null; flushing = false; setStatus() }
}

async function pull() {
  const seq = editSeq;
  try {
    const d = await api('/state');
    for (const k of COLS) S[k] = d[k] || [];
    RK = !!d.rk; SPEC_ON = d.spec !== false;
    for (const o of outbox) applyOp(o); // keep changes that haven't reached the server yet
    lastV = seq === editSeq ? d.v : -1; // something changed while downloading: fetch again next poll
    online = true; loaded = true; lastSync = Date.now();
    if (!ev && S.events.length) ev = S.events[0].id;
    cacheState(); setStatus(); render();
  } catch (e) { if (e instanceof NetErr) { online = false; setStatus() } }
}

async function poll() {
  if (polling || document.hidden || !signedIn()) return; polling = true;
  try {
    if (outbox.length) await flush(); else if (pq.length) phFlush();
    const d = await api('/version'); online = true;
    if (d.v !== lastV) await pull(); else { lastSync = Date.now(); setStatus() }
  } catch (e) { if (e instanceof NetErr) { online = false; setStatus() } }
  finally { polling = false }
}
function syncRE() {
  const s = skuOf(evObj()); if (!s || syncing || document.hidden || !online) return;
  syncing = true; api('/import', { sku: s, light: true }).catch(() => {}).finally(() => { syncing = false });
  // season stats are heavy (a few requests per team): load once, then again only when they're 6 hours old
  if (!spec && evObj().reid && statsAge() > 6 * 3600e3 && Date.now() - statsFailAt > 5 * 60e3) refreshStats(false);
}
// Season stats come in chunks of a few teams. Progress is written straight into the page (.stmsg) so it doesn't
// fight with typing, and everyone else's phone only updates once the last chunk is in.
const statsMsg = t => document.querySelectorAll('.stmsg').forEach(el => { el.textContent = t });
async function refreshStats(force) {
  const e = evObj(); if (!e || !e.reid || statsBusy || !online) return;
  const id = ev; statsBusy = true; statsMsg('Loading season stats…');
  document.querySelectorAll('[data-act=refstats]').forEach(b => { b.disabled = true });
  try {
    for (let off = 0; ;) {
      const d = await api('/stats', { eventId: id, offset: off, force: !!force });
      if (d.busy) { statsMsg('Someone else is loading them…'); break }
      if (d.fresh) { statsMsg('Already up to date.'); break }
      if (d.done) { statsBusy = false; await pull(); break } // not busy any more, so the re-render shows 'Updated …'
      statsMsg(`Loading season stats… ${d.next} of ${d.total} teams`); off = d.next;
    }
  } catch (err) { statsFailAt = Date.now(); statsMsg('Couldn’t load season stats: ' + String(err.message || err).slice(0, 120)) }
  finally { statsBusy = false; document.querySelectorAll('[data-act=refstats]').forEach(b => { b.disabled = false }) }
}
function schedule() { clearInterval(pollT); clearInterval(impT); if (signedIn()) { pollT = setInterval(poll, NOTE_MS); impT = setInterval(syncRE, RE_MS) } }

function setStatus() {
  const el = $('#sync'); if (!el) return;
  const n = outbox.length, unsaved = n + ' unsaved';
  el.innerHTML = !signedIn() ? '' : !online ? (n ? 'Offline · ' + unsaved : 'Offline') : n ? 'Saving…' : lastSync ? '<span class="sl">Synced </span>' + new Date(lastSync).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '…';
  el.className = !online ? 'off' : n ? 'busy' : '';
  el.title = !online ? 'No connection. Your changes are kept on this device and sent when you’re back online.' : '';
}
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 5000) }

const EYE = '<svg viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24"><path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.9 8.4 2 12 2 12s3.5 7 10 7c1.8 0 3.4-.5 4.7-1.3M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';
// ---------- welcome: join a team or set a new one up ----------
let wmode = ls('code') ? 'join' : (ls('wmode') || 'join'), wlook = null, wcreated = null, wbusy = false;
const credit = () => `<div class="credit"><span>Made by</span><img class="on-light" src="logo.svg" alt="Invictus 52111A"><img class="on-dark" src="logo-light.svg" alt="Invictus 52111A"></div>`;
function loginHTML() {
  let h = `<div class="welcome"><div class="hero"><img class="heroicon" src="icon.svg" alt=""><h1>${$('.wordmark').innerHTML}</h1><p class="mut">Scouting for VEX V5 teams. Your whole team scouts together, live, even on bad venue wifi.</p></div>`;
  if (wcreated) {
    const w = wcreated, key = w.recoveryKey;
    return h + `<div class="card"><h2>${w.recovered ? 'Team ' + esc(w.team.number) + ' has a new code' : 'Team ' + esc(w.team.number) + ' is set up'}</h2><p class="mut">${esc(w.team.name)}${w.team.org ? ' · ' + esc(w.team.org) : ''}</p>
    <h3>Your team code</h3><div class="bigcode">${esc(w.code)}</div>
    <p class="mut">${w.recovered ? 'The old code no longer works on any phone. ' : ''}Share it with your team: they open Recon, tap <b>Join your team</b> and enter ${esc(w.team.number)} and this code. You can find it again in Team settings.</p>
    ${key ? `<h3>Your recovery key</h3><div class="bigcode key">${esc(key)}</div>
    <p class="mut"><b>Keep this one to yourself</b>, for example in the coach’s password manager or an email to yourself. Don’t post it in the team chat. If everyone ever gets logged out and nobody has the team code, this key is the only way to get a new one. It’s shown once.</p>
    <label class="chk"><input type="checkbox" id="w_saved"> I’ve saved the recovery key</label>` : ''}
    <div class="foot"><button data-act="wcopy">Copy code</button>${key ? '<button data-act="wcopykey">Copy key</button>' : ''}<button class="p" data-act="wdone" ${key ? 'disabled' : ''}>Start scouting</button></div></div>` + credit() + '</div>';
  }
  h += segBar([['join', 'Join your team'], ['create', 'New team'], ['spectate', 'Spectator']], wmode, 'wmode');
  const err = loginErr ? `<p class="err">${esc(loginErr)}</p>` : '';
  if (wmode === 'join') h += `<div class="card login"><h2>Join your team</h2><p class="mut">Enter your team number and the team code a teammate gave you.</p>
    <input id="w_team" value="${esc(team)}" placeholder="Team number, e.g. 52111A" autocapitalize="characters" autocomplete="organization" aria-label="Team number">
    <div class="pw"><input id="codein" type="password" autocomplete="current-password" placeholder="Team code" aria-label="Team code"><button type="button" class="icon" data-act="peek" aria-label="Show code" aria-pressed="false">${EYE}</button></div>${err}<button class="p wide" data-act="login" ${wbusy ? 'disabled' : ''}>${wbusy ? 'Opening…' : 'Open'}</button><div class="foot"><button class="link" data-act="wmode" data-v="recover">Lost the code?</button></div></div>`;
  else if (wmode === 'recover') h += recoverHTML(err);
  else if (wmode === 'spectate') h += `<div class="card login"><h2>Watch a team</h2><p class="mut">Just following along? Enter a team number to see its event: matches with times and fields, rankings, OPR and skills. No team code needed. It’s view-only, and the team’s scouting notes and picklist stay private.</p>
    <input id="w_spec" value="${esc(team)}" placeholder="Team number, e.g. 52111A" autocapitalize="characters" autocomplete="organization" aria-label="Team number">${err}
    <button class="p wide" data-act="spectate" ${wbusy ? 'disabled' : ''}>${wbusy ? 'Opening…' : 'Watch'}</button><p class="mut fine">The team has to be on Recon already.</p></div>`;
  else {
    h += `<div class="card login"><h2>Set up a new team</h2><p class="mut">One person sets the team up, then shares the team code with everyone else.</p>
    <div class="row"><input id="w_new" value="${esc(wlook ? wlook.team.number : '')}" placeholder="Team number, e.g. 52111A" autocapitalize="characters" aria-label="Team number"><button data-act="wlookup" ${wbusy ? 'disabled' : ''}>Find team</button></div>${err}`;
    if (wlook) h += wlook.taken
      ? `<div class="found"><b>${esc(wlook.team.number)}</b> ${esc(wlook.team.name)}<div class="mut">Already on Recon. Ask a teammate for your team code, then join.</div></div><button class="wide" data-act="wmode" data-v="join">Join ${esc(wlook.team.number)} instead</button>`
      : `<div class="found"><b>${esc(wlook.team.number)}</b> ${esc(wlook.team.name) || ''}<div class="mut">${esc(wlook.team.org) || (wlook.team.name ? '' : 'Couldn’t check VEX Events, so make sure the number is right.')}</div></div><button class="p wide" data-act="wregister" ${wbusy ? 'disabled' : ''}>Set up team ${esc(wlook.team.number)}</button>`;
    h += '</div>';
  }
  return h + credit() + '</div>';
}
// Nobody on the team has the code any more: the recovery key gets a new one.
function recoverHTML(err) {
  return `<div class="card login"><h2>Lost the team code?</h2>
    <p class="mut">If someone on your team is still signed in, they can see the code (or make a new one) in <b>Team settings</b>: Event tab → More. If nobody is, enter your team’s <b>recovery key</b> (made when the team was set up, usually kept by the coach) to get a new code. It stops the old one working.</p>
    <input id="w_rc" value="${esc(team)}" placeholder="Team number, e.g. 52111A" autocapitalize="characters" autocomplete="organization" aria-label="Team number">
    <input id="w_rk" placeholder="Recovery key" autocapitalize="characters" autocomplete="off" spellcheck="false" aria-label="Recovery key">${err}
    <button class="p wide" data-act="rcgo" ${wbusy ? 'disabled' : ''}>${wbusy ? 'Checking…' : 'Get a new team code'}</button>
    <p class="mut fine">No recovery key? Ask the Recon owner (Invictus 52111A) to reset your team’s code.</p>
    <div class="foot"><button class="link" data-act="wmode" data-v="join">Back</button></div></div>`;
}
// signing in as a different team than last time: drop that team's cached data and unsent changes
function useTeam(t, info) {
  if (ls('lastTeam') !== t) { outbox = []; lsJ('outbox', []); pq = []; savePq(); for (const k in PH) delete PH[k]; lsJ('cache', null); for (const k of COLS) S[k] = []; ev = ''; ls('ev', ''); name = ''; ls('name', ''); lastV = -1; loaded = false }
  team = t; teamInfo = info || {}; ls('team', t); ls('lastTeam', t); lsJ('teamInfo', teamInfo);
}

async function init() {
  // phones signed in to the original single-team app (before Recon had teams) were all Invictus 52111A
  if (code && !team) { team = '52111A'; ls('team', team); ls('lastTeam', team) }
  const c = lsJ('cache');
  if (signedIn() && c && c.S) { for (const k of COLS) S[k] = c.S[k] || []; for (const o of outbox) applyOp(o); lastSync = c.t || 0; loaded = true; if (!ev && S.events.length) ev = S.events[0].id }
  render(); setStatus();
  if (signedIn()) { await flush(); await pull(); schedule(); syncRE() }
}

// ---------- views ----------
const SUN = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/></svg>', MOON = '<svg viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>';
const osTheme = () => matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
function applyTheme() { const t = ls('theme'); if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme; $('#theme').innerHTML = (t || osTheme()) === 'dark' ? SUN : MOON }
matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { if (!ls('theme')) applyTheme() });
const TABS = [
  ['event', '<svg viewBox="0 0 24 24"><path d="M5 21V4M5 4h11l-2 4 2 4H5"/></svg>', 'Event'],
  ['matches', '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12" rx="3"/><path d="M12 6v12M8 12h.01M16 12h.01"/></svg>', 'Matches'],
  ['scout', '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l5 5"/></svg>', 'Scout'],
  ['pick', '<svg viewBox="0 0 24 24"><path d="M7 4h10v4a5 5 0 0 1-10 0zM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3M12 13v4M8 21h8M10 17h4"/></svg>', 'Picklist']];

const tabsFor = () => spec ? TABS.filter(t => t[0] === 'event' || t[0] === 'matches') : TABS; // a spectator has no scouting or picklist
let dragging = false;
// ---------- rendering + motion ----------
// The whole view is re-rendered from state. To keep motion calm, animations only play on real changes:
// a new view fades in, rows that moved glide to their new place (FLIP), a newly opened section slides open,
// notes that weren't on screen before fade in, and the team sheet slides up. Nothing moves with reduce-motion on.
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
let lastView = '', modalShown = false, justOpened = null, seenNotes = null, renderedAt = 0, tq = '';
const viewKey = () => [ev, tab, tab === 'event' ? tv : '', tab === 'matches' ? mf : '', tab === 'scout' ? sf : '', tab === 'scout' && draft ? draft.id : '', name ? 1 : 0].join('|');
function flipCapture() { const m = new Map(); document.querySelectorAll('#app [data-flip]').forEach(e => m.set(e.dataset.flip, e.getBoundingClientRect().top)); return m }
function flipPlay(m) {
  if (reduced()) return;
  document.querySelectorAll('#app [data-flip]').forEach(e => { const t = m.get(e.dataset.flip); if (t == null) return; const dy = t - e.getBoundingClientRect().top; if (Math.abs(dy) > 1) e.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.2,.7,.2,1)' }) });
}
let scrollAnim = 0;
function easeScroll(to) {
  const from = scrollY, t0 = performance.now(), id = ++scrollAnim, dur = 420;
  const step = t => { if (id !== scrollAnim) return; const p = Math.min(1, (t - t0) / dur); scrollTo({ top: from + (to - from) * (1 - Math.pow(1 - p, 3)), behavior: 'instant' }); if (p < 1) requestAnimationFrame(step); else document.body.style.minHeight = '' };
  requestAnimationFrame(step);
}
// the browser nudges the scroll position when a big card starts sliding, so hold it where it was for the length of the slide
function pinScroll(y) {
  const id = ++scrollAnim, t0 = performance.now();
  const f = t => { if (id !== scrollAnim) return; if (Math.abs(scrollY - y) > 1) scrollTo({ top: y, behavior: 'instant' }); if (t - t0 < SLIDE_MS + 80) requestAnimationFrame(f) };
  requestAnimationFrame(f);
}
const stopScroll = () => { scrollAnim++; document.body.style.minHeight = '' };
['wheel', 'touchstart', 'keydown', 'mousedown'].forEach(ev => addEventListener(ev, stopScroll, { passive: true }));
let enterT;
const ENTER = ['enter', 'enter-fwd', 'enter-back', 'enter-up'];
// the enter class is dropped once the page has arrived, so later redraws (a new note, a sync) don't replay it
function replay(el, c) { if (el.id === 'app') { ENTER.forEach(k => el.classList.remove(k)); clearTimeout(enterT); enterT = setTimeout(() => ENTER.forEach(k => el.classList.remove(k)), 1000) } el.classList.remove(c); void el.offsetWidth; el.classList.add(c) }
let navAnim = '';
const lastCounts = {};
function countUp() {
  document.querySelectorAll('#app [data-count]').forEach(el => {
    const to = +el.dataset.count, ck = el.dataset.ck, from = ck in lastCounts ? lastCounts[ck] : 0; lastCounts[ck] = to;
    if (reduced() || from === to) return;
    const t0 = performance.now(), d = 650, f = t => { const p = Math.min(1, (t - t0) / d); el.textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(f) };
    el.textContent = from; requestAnimationFrame(f);
  });
}
function flash(el) { if (!el || reduced()) return; el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash') }
const fresh = n => seenNotes && !seenNotes.has(n.id) ? 'fresh' : '';

// A real slide: the old content is kept as a ghost that travels out while the new content travels the whole way in.
let segClicked = null;
const SLIDE_MS = 440, SLIDE_EASE = 'cubic-bezier(0.32, 0.72, 0, 1)', SLIDE_GAP = 16;
// rect: where the old content sits; clip: the column it must stay inside while it slides (so nothing leaks into the side margins on a wide screen)
function ghostMake(els, rect, clip) {
  const g = document.createElement('div'); g.className = 'ghost'; g.setAttribute('aria-hidden', 'true');
  g.style.left = clip.left + 'px'; g.style.width = clip.width + 'px'; g.style.top = rect.top + 'px';
  const gin = document.createElement('div'); gin.className = 'gin'; gin.style.marginLeft = (rect.left - clip.left) + 'px'; gin.style.width = rect.width + 'px';
  els.forEach(e => gin.appendChild(e.cloneNode(true)));
  g.appendChild(gin);
  g.querySelectorAll('[id]').forEach(e => e.removeAttribute('id')); g.querySelectorAll('[data-act]').forEach(e => e.removeAttribute('data-act'));
  document.body.appendChild(g); setTimeout(() => g.remove(), SLIDE_MS + 400); return g;
}
const slideDist = w => w + SLIDE_GAP; // the pages sit side by side with a small gap, so they never overlap
function ghostGo(g, dir, d) {
  const a = g.firstChild.animate([{ transform: 'none' }, { transform: `translateX(${-dir * d}px)` }], { duration: SLIDE_MS, easing: SLIDE_EASE, fill: 'forwards' });
  a.onfinish = a.oncancel = () => g.remove();
}
const slideIn = (el, dir, d) => el.animate([{ transform: `translateX(${dir * d}px)` }, { transform: 'none' }], { duration: SLIDE_MS, easing: SLIDE_EASE, fill: 'backwards' });

// Segmented controls: one highlight that glides to the chosen item, and the content under it slides the way you went.
const SEG_SLIDE = new Set(['mfilter', 'sfilter', 'tview', 'sksope', 'ebscope', 'wmode']);
const segBtns = s => [...s.querySelectorAll(':scope > button')];
function segSnap() {
  const m = {};
  document.querySelectorAll('#app .seg[data-seg]').forEach(s => { const bs = segBtns(s), i = bs.findIndex(b => b.classList.contains('on')); if (i >= 0 && bs[i].offsetWidth) m[s.dataset.seg] = { i, l: bs[i].offsetLeft, w: bs[i].offsetWidth } });
  return m;
}
function segPlace(snap, ghost) {
  document.querySelectorAll('#app .seg[data-seg]').forEach(s => {
    const bs = segBtns(s), i = bs.findIndex(b => b.classList.contains('on')), b = bs[i];
    if (!b || !b.offsetWidth) return; // folded away: placed when it opens
    let p = s.querySelector(':scope > .segpill'); if (!p) { p = document.createElement('i'); p.className = 'segpill'; s.appendChild(p) }
    const l = b.offsetLeft, w = b.offsetWidth; p.style.width = w + 'px'; p.style.transform = `translateX(${l}px)`; s.classList.add('pilled');
    const from = snap && snap[s.dataset.seg]; if (!from || from.i === i || reduced()) return;
    p.animate([{ width: from.w + 'px', transform: `translateX(${from.l}px)` }, { width: w + 'px', transform: `translateX(${l}px)` }], { duration: 440, easing: 'cubic-bezier(0.34, 1.4, 0.64, 1)' });
    if (!SEG_SLIDE.has(s.dataset.seg)) return;
    const dir = i > from.i ? 1 : -1, d = slideDist(s.getBoundingClientRect().width); let n = s.nextElementSibling, k = 0;
    if (ghost && ghost.dataset.seg === s.dataset.seg) ghostGo(ghost, dir, d);
    while (n) { slideIn(n, dir, d); n = n.nextElementSibling; k++ }
  });
}
window.addEventListener('resize', () => segPlace());
function render() {
  if (dragging) { dirty = true; return }
  const out = !signedIn() || wbusy; // while a sign-in is being checked the code is already set, but we keep showing the welcome screen (drawing the app for a moment made the card blink)
  document.body.classList.toggle('out', out);
  // the welcome entrance animation only plays the first time it appears, not on every re-render (it made the card blink out and fade back in)
  if (out) { $('#nav').innerHTML = ''; const sb = segSnap(), shown = !!$('#app .welcome'); $('#app').innerHTML = loginHTML(); $('#evname').textContent = 'Welcome'; $('#evbar').innerHTML = ''; if (sb.wmode || shown) $('#app .welcome')?.classList.add('swap'); segPlace(sb); lastView = ''; return }
  if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) || menuFor) { dirty = true; return }
  dirty = false;
  US = norm(team);
  if (spec && tab !== 'event' && tab !== 'matches') tab = 'event';
  NAMES = Array.isArray(cfg().names) ? cfg().names : [];
  if (!spec && loaded && name && !NAMES.includes(name)) { name = ''; ls('name', '') }
  $('#evname').textContent = spec ? 'Watching ' + US : US + (teamInfo.name ? ' · ' + teamInfo.name : '');
  $('#evbar').innerHTML = evBar();
  // the tab bar is built once and only its classes change, so the selected tab can ease across
  const nav = $('#nav');
  if (!nav.children.length) nav.innerHTML = tabsFor().map(t => `<button data-act="tab" data-v="${t[0]}">${t[1]}<span>${t[2]}</span></button>`).join('');
  nav.querySelectorAll('button').forEach(b => { const on = b.dataset.v === tab; b.classList.toggle('on', on); b.setAttribute('aria-current', on ? 'page' : 'false') });
  let pill = nav.querySelector('.navpill'); if (!pill) { pill = document.createElement('i'); pill.className = 'navpill'; nav.prepend(pill) }
  const onb = nav.querySelector('button.on'); if (onb) { pill.style.width = onb.offsetWidth + 'px'; pill.style.transform = `translateX(${onb.offsetLeft}px)`; pill.style.opacity = 1 }
  const key = viewKey(), same = key === lastView, before = same ? flipCapture() : null, y = scrollY, sb = segSnap();
  const keepScroll = same || navAnim === 'seg' || (segClicked && SEG_SLIDE.has(segClicked)), oldH = document.documentElement.scrollHeight;
  if (keepScroll && !reduced()) document.body.style.minHeight = oldH + 'px'; // hold the old height so the scroll position survives the redraw
  let ghost = null; const appEl = $('#app'), appRect = appEl.getBoundingClientRect();
  if (!reduced() && lastView) {
    if (!same && (navAnim === 'fwd' || navAnim === 'back')) {
      const cs = getComputedStyle(appEl), pl = parseFloat(cs.paddingLeft) || 0, pr = parseFloat(cs.paddingRight) || 0, pt = parseFloat(cs.paddingTop) || 0;
      ghost = ghostMake([...appEl.children], { left: appRect.left + pl, top: appRect.top + pt, width: appRect.width - pl - pr }, appRect);
    }
    else if (segClicked && SEG_SLIDE.has(segClicked)) {
      const sg = appEl.querySelector(`.seg[data-seg="${segClicked}"]`), sibs = []; for (let n = sg && sg.nextElementSibling; n; n = n.nextElementSibling) sibs.push(n);
      if (sibs.length) { const r0 = sibs[0].getBoundingClientRect(); ghost = ghostMake(sibs, { left: r0.left, top: r0.top, width: r0.width }, appRect); ghost.dataset.seg = segClicked }
    }
  }
  $('#app').innerHTML = ({ event: vEvent, matches: vMatches, scout: vScout, pick: vPick })[tab]();
  scrollTo({ top: keepScroll ? y : 0, behavior: 'instant' });
  if (keepScroll && !reduced()) { // a shorter page: glide up to its bottom instead of snapping
    document.body.style.minHeight = ''; const max = Math.max(0, document.documentElement.scrollHeight - innerHeight);
    if (y > max + 2) { document.body.style.minHeight = oldH + 'px'; scrollTo({ top: y, behavior: 'instant' }); easeScroll(max) } else pinScroll(y);
  }
  if (same) flipPlay(before); else if (lastView && !reduced() && navAnim !== 'seg') replay($('#app'), 'enter' + (navAnim ? '-' + navAnim : ''));
  if (ghost && !ghost.dataset.seg) { const dir = navAnim === 'fwd' ? 1 : -1, d = slideDist(appRect.width); ghostGo(ghost, dir, d); slideIn($('#app'), dir, d) }
  navAnim = '';
  segPlace(sb, ghost); segClicked = null;
  if (keepScroll && !reduced()) { void document.documentElement.scrollHeight; if (Math.abs(scrollY - y) > 1) scrollTo({ top: y, behavior: 'instant' }) }
  if (ghost && ghost.dataset.seg && !ghost.getAnimations().length) ghost.remove();
  if (!same) for (const k in lastCounts) delete lastCounts[k];
  lastView = key; justOpened = null; countUp();
  const md = $('#modal');
  $('#mbody').innerHTML = mTeam === ':about' ? vAbout() : mTeam === ':changes' ? vChanges() : mTeam ? vTeam(mTeam) : '';
  if (mTeam && !modalShown) { md.style.display = 'block'; if (!reduced()) replay(md, 'opening') }
  else if (!mTeam) md.style.display = 'none';
  modalShown = !!mTeam;
  if (mTeam && mTeam[0] !== ':' && !spec && mTeam !== US && signedIn()) phLoad(mTeam);
  else if (tab === 'scout' && scTeam && draft && !spec && scTeam !== US && signedIn()) phLoad(scTeam);
  seenNotes = new Set(S.notes.map(n => n.id));
  renderedAt = performance.now();
  ebKick();
}
function closeModal() {
  const md = $('#modal');
  if (reduced()) { mTeam = null; render(); return }
  md.classList.remove('opening'); md.classList.add('closing');
  setTimeout(() => { md.classList.remove('closing'); mTeam = null; render() }, 180);
}

// Folded sections remember whether you opened them, so a teammate's change doesn't snap them shut.
const dState = {};
const det = (id, def) => (id in dState ? dState[id] : def) ? 'open' : '';
document.addEventListener('toggle', e => {
  const d = e.target; if (d.tagName !== 'DETAILS' || !d.id) return;
  const was = d.id in dState ? dState[d.id] : null; dState[d.id] = d.open;
  if (d.open && was !== true && performance.now() - renderedAt > 60 && !reduced()) replay(d, 'reveal');
  if (d.open) { ebKick(); segPlace() }
}, true);

// Note boxes: one line until you tap in; "Add" lights up once there's text. Half-typed notes survive re-renders.
const drafts = {};
function noteBox(kind, ref, sec, ph) {
  const id = 'n' + uid(), k = kind + '|' + (ref || '') + '|' + (sec || ''), v = drafts[k] || '';
  return `<div class="composer ${v.trim() ? 'has' : ''}"><textarea id="${id}" rows="1" data-draft="${esc(k)}" placeholder="${esc(ph || 'Write a note…')}">${esc(v)}</textarea><button data-act="addnote" data-kind="${kind}" data-ref="${esc(ref || '')}" data-sec="${sec || ''}" data-in="${id}">Add note</button></div>` +
    notes(kind, ref || '', sec || '').map(noteRow).join('');
}
const when = ts => new Date(ts).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
const noteRow = n => `<div class="note ${fresh(n)}"><div class="ntext">${esc(n.text)}</div><small>${esc(n.by || '?')} · ${when(n.ts)}<button class="d" data-act="delnote" data-id="${n.id}">Delete</button></small></div>`;
const nameChips = () => NAMES.map(n => `<button class="chip ${name === n ? 'on' : ''}" data-act="setname" data-v="${esc(n)}" aria-pressed="${name === n}">${esc(n)}</button>`).join('');
const empty = msg => `<p class="mut empty">${msg}</p>`;

const IC_REFRESH = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 0 0-14.5-4.2L4 8.5M4 4v4.5h4.5M4 13a8 8 0 0 0 14.5 4.2l1.5-1.7M20 20v-4.5h-4.5"/></svg>';
const IC_OUT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>';
// the event picker lives in the header so it is there on every tab; Update and Event page sit beside it
function evBar() {
  if (!S.events.length) return '';
  const e = evObj(), sku = skuOf(e);
  return `<div class="evpick">${evSelect()}${sku ? `<button type="button" class="ib" data-act="reimport" aria-label="Update this event from VEX Events" title="${spec ? 'Check for new scores' : 'Update from VEX Events'}">${IC_REFRESH}</button>` : ''}${e && e.link ? `<a class="ib" href="${esc(e.link)}" target="_blank" rel="noopener" aria-label="Open the event page" title="Event page">${IC_OUT}</a>` : ''}</div><p class="mut evmsg" id="impmsg2" role="status"></p>`;
}
const evSelect = () => dd('evsel', ev, [['', '— choose event —'], ...S.events.map(x => [x.id, x.name]), ...(spec ? [] : [['+add', '＋ Add another event…']])], { label: 'Event' });
// install: Android / desktop Chrome offer a prompt we can trigger; iPhone needs Share → Add to Home Screen
let installEvt = null;
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; if (signedIn()) render() });
window.addEventListener('appinstalled', () => { installEvt = null; toast('Recon is installed'); if (signedIn()) render() });
const installRow = () => standalone() ? '' : installEvt ? `<h3>App</h3><button data-act="install">Install Recon on this device</button>`
  : isIOS ? `<h3>App</h3><p class="mut">To install: tap Share, then <b>Add to Home Screen</b>.</p>` : '';
// The recovery key: kept by the coach, used from the sign-in screen when nobody has the team code. Shown once when made.
const rkHTML = () => RK === null && !rkShown ? '<p class="mut">…</p>' : rkShown ? `<div class="bigcode key">${esc(rkShown)}</div><p class="mut"><b>Save it now, it won’t be shown again.</b> Keep it to yourself (a password manager or an email to yourself), not in the team chat. Any older key no longer works.</p><div class="foot"><button data-act="rkcopy">Copy key</button><button class="p" data-act="rkdone">I’ve saved it</button></div>`
  : RK === false ? `<p class="mut">This team has <b>no recovery key</b>. If everyone is logged out and nobody has the team code, only the Recon owner can get you back in. Make one and keep it somewhere safe.</p><div class="foot"><button class="p" data-act="rkmake">Make a recovery key</button></div>`
  : `<p class="mut">A recovery key is set. Whoever has it can get a new team code from the sign-in screen (<i>Lost the code?</i>) if everyone is logged out. We can’t show it again, but you can <button class="link" data-act="rkmake">make a new one</button> (the old key stops working).</p>`;
const settingsCard = () => `<details class="card" id="d-settings" ${det('d-settings', false)}><summary><h2>Team settings</h2></summary>
  <p class="mut meta"><b>${esc(US)}</b> ${esc(teamInfo.name || '')}${teamInfo.org ? ' · ' + esc(teamInfo.org) : ''}</p>
  <h3>Team code</h3><div class="row"><code id="codeval" class="codeval" data-shown="0">${'•'.repeat(Math.max(6, code.length))}</code><button data-act="showcode" aria-pressed="false">Show</button><button data-act="copycode">Copy</button></div>
  <p class="mut">Anyone with your team number and this code can see and edit your team’s scouting. <button class="link" data-act="rotate">Make a new code</button></p>
  <h3>Recovery key</h3>${rkHTML()}
  <h3>Spectators</h3><p class="mut">${SPEC_ON ? 'Anyone who knows your team number can watch your event (matches, rankings, skills) in view-only Spectator mode. They never see your scouting notes, scout names or picklist.' : 'Spectator mode is off: nobody can watch your team without the team code.'}</p><div class="foot"><span class="grow"></span><button data-act="specset" data-v="${SPEC_ON ? 0 : 1}">${SPEC_ON ? 'Turn spectators off' : 'Allow spectators'}</button></div>
  <h3>Scouts</h3><div class="scouts">${NAMES.map(n => `<div class="srow"><span class="avatar">${esc((n[0] || '?').toUpperCase())}</span><span class="grow">${esc(n)}${n === name ? ' <span class="mut">(you)</span>' : ''}</span><button class="d" data-act="delname" data-v="${esc(n)}">Remove</button></div>`).join('') || '<p class="mut">Names show up here as people join.</p>'}</div>
  <div class="row"><input id="newscout" placeholder="Add a scout" autocomplete="off" aria-label="Add a scout"><button data-act="addscout">Add</button></div>
  ${installRow()}
  <div class="foot"><span class="grow"></span><button class="d" data-act="logout">Log out</button></div></details>`;
// What's new, in plain words (the full history is CHANGELOG.md). Newest first; add a line here when something users will notice changes.
const CHANGES = [
  ['1.2.0', [
    'Robot photos: when you scout a team, add up to 3 photos of its robot from the camera or gallery. They’re shared with your team, show on the team’s page, and wait to send if you’re offline. Photos are kept for your 5 most recent events.',
    'Agenda: the Event home has a schedule timeline (registration, inspection, matches begin…) with a Now marker. Your team adds the items; spectators can read it.',
    'A Team names button on the Matches tab shows each team’s name under its number.',
    'The picklist’s Still to pick list shows team names too.',
    'Less empty space under the event bar on the Event home.']],
  ['1.1.0', [
    'Spectator mode: on the sign-in screen, choose Spectator and enter a team number (no code) to follow its matches, rankings, OPR and skills, view-only. Scouting notes and the picklist stay private, and a team can turn it off in Team settings.',
    'Matches show their scheduled time and which field they’re on, in the match list and on the Next match card.',
    'The bottom bar stays put on iPhone while you scroll.',
    'Matches has a new By team view: who a team plays with and against, and their record.',
    'Scouting is shared: the Scout list shows who scouted each team, and a Team activity list shows who did what and when.',
    'Dibs: tap Dibs on a team in the Scout list so two people don’t scout the same one. Teams go orange when partly scouted and green when fully scouted, and there’s a Scouted tab.',
    'Scouting has Scoring speed, cycle time, and a suggested overall rating averaged from your other ratings.',
    'Find an event with filters for country, state / region, city, level and date.',
    'Remove a scout from Team settings.',
    'A new Event Home: your rank, record and next match at a glance.',
    'Recovery key for teams, so a lost team code can be replaced.']],
  ['1.0.0', ['The first Recon release: match notes, scouting forms, rankings, OPR and a finals picklist, shared live and working offline.']]];
function vChanges() {
  return `<div class="sheethead"><div class="grow"><h2>What’s new</h2></div><button data-act="close">Close</button></div>` +
    CHANGES.map(([v, l]) => `<div class="card"><h2>${esc(v)}</h2><ul class="chg">${l.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>`).join('');
}
const whoCard = (title, text) => `<div class="card"><h2>${title}</h2><p class="mut">${text}</p>${nameChips()}<div class="row"><input id="myname" placeholder="${NAMES.length ? 'Not listed? Type your name' : 'Your name'}" autocomplete="given-name" aria-label="Your name"><button data-act="addname">That’s me</button></div></div>`;
function vAbout() {
  return `<div class="sheethead"><div class="grow"><h2>About Recon</h2></div><button data-act="close">Close</button></div>
  <div class="card about"><img class="heroicon" src="icon.svg" alt=""><div><b>Recon</b> <span class="mut">version ${APP.version}</span><p class="mut">Scouting for VEX V5 teams: match notes, scouting forms, rankings, OPR and a finals picklist, shared live with your team and working offline.</p></div></div>
  <div class="card"><h2>Made by Invictus 52111A</h2><div class="credit"><img class="on-light" src="logo.svg" alt="Invictus 52111A"><img class="on-dark" src="logo-light.svg" alt="Invictus 52111A"></div><p class="mut">Recon was designed and built by VEX team 52111A, Invictus.</p></div>
  <div class="card"><h2>Your data</h2><p class="mut">Each team’s scouting is private to that team: only people with your team number and team code can see or change it. Event lists, matches and rankings come from VEX Events, and anyone can watch them for your team in view-only Spectator mode (your team can turn that off).</p></div>
  <p class="mut fine">© 2026 Invictus 52111A. All rights reserved. Recon is not affiliated with or endorsed by VEX Robotics or the REC Foundation.</p>`;
}

// ---------- Event tab: one place for the event, its teams, rankings, skills and notes ----------
const segBar = (items, cur, act) => `<div class="seg" role="group" data-seg="${act}">${items.map(([k, l]) => `<button class="${cur === k ? 'on' : ''}" aria-pressed="${cur === k}" data-act="${act}" data-v="${k}">${l}</button>`).join('')}</div>`;
const tlist = () => '';
const tiles = a => `<div class="tiles">${a.map(([v, l, sub]) => `<div class="tile"><b>${v}</b><span>${l}</span>${sub ? `<small>${sub}</small>` : ''}</div>`).join('')}</div>`;

// What's happening now: live (and which day), starts in N days, or ended. Our next match has its own card, so it isn't repeated here.
function evStatus(e, started, hasNext, played) {
  const today = new Date(new Date().toDateString() + ' 12:00:00');
  const at = d => new Date(String(d).slice(0, 10) + 'T12:00:00'), day = d => d ? Math.round((at(d) - today) / 864e5) : null;
  const ds = day(e.start), de = day(e.end || e.start);
  if (ds != null && ds > 0) return { cls: 'soon', html: `Starts ${ds === 1 ? 'tomorrow' : 'in ' + ds + ' days'} · ${at(e.start).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}` };
  if (ds != null && de >= 0) return { cls: 'now', html: `<span class="livedot"></span>Live now${de > ds ? ` · Day ${1 - ds} of ${de - ds + 1}` : ''}` };
  if (ds != null) return { cls: 'done', html: `Ended ${de === 0 ? 'today' : -de + (de === -1 ? ' day' : ' days') + ' ago'}` };
  return started && hasNext ? { cls: 'now', html: '<span class="livedot"></span>Event in progress' } : { cls: 'soon', html: played ? (spec ? 'All of ' + US + '’s matches are played' : 'All our matches are played') : hasNext ? 'Matches are scheduled' : 'Waiting for the match schedule' };
}
// Stat cards in the instrument-panel style: icon + label, a big light number with a muted denominator, a delta chip, and a dot-matrix chart.
const IC_RANK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h10v4a5 5 0 0 1-10 0zM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3M12 13v4M8 21h8M10 17h4"/></svg>';
const IC_REC = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="3"/><path d="M12 6v12M8 12h.01M16 12h.01"/></svg>';
const delta = (txt, up) => `<span class="delta ${up ? 'up' : 'dn'}"><svg viewBox="0 0 12 12" aria-hidden="true">${up ? '<path d="M6 10V2M2.5 5.5L6 2l3.5 3.5"/>' : '<path d="M6 2v8M2.5 6.5L6 10l3.5-3.5"/>'}</svg>${txt}</span>`;
// columns: [{ h: lit dots from the bottom, cls }]
const dotMatrix = (cols, rows, label) => `<div class="dm" role="img" aria-label="${esc(label)}">${cols.map((c, i) => `<div class="dc ${c.cls || ''}" style="--c:${i}">${Array.from({ length: rows }, (_, r) => `<i${rows - r <= c.h ? ' class="on"' : ''}></i>`).join('')}</div>`).join('')}</div>`;
const stat = o => `<article class="stat ${o.attrs ? 'tap' : ''}" ${o.attrs ? o.attrs + ' role="button" tabindex="0"' : ''}><div class="shead">${o.icon}<span>${o.label}</span></div><div class="sbody"><div class="sl"><div class="sbig">${o.big}${o.den ? `<small>/${o.den}</small>` : ''}${o.chip || ''}</div><div class="scap">${o.cap}</div></div>${o.viz || ''}</div></article>`;
function rankStat(st, me, ts) {
  const arr = [...st.by.entries()].filter(([, r]) => r && r.opr != null && isFinite(r.opr)).sort((a, b) => b[1].opr - a[1].opr);
  let viz = '';
  if (arr.length >= 3 && me && me.opr != null) {
    let top = arr.slice(0, 12); if (!top.some(([n]) => n === US)) top = [...top.slice(0, 11), [US, me]];
    const max = Math.max(...top.map(([, r]) => r.opr), 1);
    viz = dotMatrix(top.map(([n, r]) => ({ h: Math.max(1, Math.round(Math.max(0, r.opr) / max * 7)), cls: n === US ? 'me' : '' })), 7, `OPR of the top ${top.length} teams, ours highlighted`);
  }
  const ranked = me && me.rank != null;
  return stat({ icon: IC_RANK, label: (spec ? US + ' rank' : 'Our rank') + (st.official ? '' : ' (calculated)'), attrs: 'data-act="gorank"',
    big: ranked ? `<span data-count="${me.rank}" data-ck="rank">${me.rank}</span>` : '–', den: ranked ? ts.length : '',
    chip: me && me.ccwm != null ? delta('CCWM ' + sgn(me.ccwm), me.ccwm >= 0) : '',
    cap: me && (me.w + me.l + me.t) ? `Record ${rec(me)}${me.opr != null ? ' · OPR ' + f1(me.opr) : ''}` : (spec ? 'The ranking' : 'Your ranking') + ' shows up once qualification matches are scored.', viz });
}
function recStat(ours) {
  const done = ours.filter(scored), sc = m => { const s = side(m); return s === 'red' ? [m.rs, m.bs] : [m.bs, m.rs] };
  const w = done.filter(m => { const [a, b] = sc(m); return a > b }).length;
  const cols = done.slice(-12).map(m => { const [a, b] = sc(m); return { a, cls: a > b ? 'w' : a < b ? 'l' : 't' } }), max = Math.max(...cols.map(c => c.a), 1);
  return stat({ icon: IC_REC, label: spec ? US + ' matches' : 'Our matches', attrs: 'data-act="tab" data-v="matches"',
    big: done.length ? `<span data-count="${w}" data-ck="w">${w}</span>` : '–', den: done.length || '',
    chip: done.length ? delta(Math.round(w / done.length * 100) + '% won', w * 2 >= done.length) : '', cap: done.length ? 'matches won so far' : (spec ? 'Matches show up' : 'Your matches show up') + ' once scoring starts',
    viz: cols.length ? dotMatrix(cols.map(c => ({ h: Math.max(1, Math.round(c.a / max * 7)), cls: c.cls })), 7, 'Our score in each match: green for a win, red for a loss, amber for a tie') : '' });
}
// ---------- Agenda ----------
// The day's schedule (registration, inspection, matches begin ...), typed in by the team and shared with it (and with spectators).
// Kept on the event as e.agenda = [{ id, d: 'YYYY-MM-DD', t: 'HH:MM', x: title, n: note }]; times are the clock times as typed, shown in the device's format.
// The agenda is switched off for now (VEX Events doesn't give us the agenda, so it has to be typed in). All of the code below is kept;
// set AGENDA_ON to true to show the Agenda card on the Event home again.
const AGENDA_ON = false;
let agEdit = false;
const dayKey = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const agDate = (d, t) => { const [y, m, dd] = d.split('-').map(Number), [h, mi] = String(t || '0:0').split(':').map(Number); return new Date(y, m - 1, dd, h || 0, mi || 0) };
const agTime = (d, t) => agDate(d, t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
function agDayName(d, today) {
  const diff = Math.round((agDate(d, '12:00') - agDate(today, '12:00')) / 864e5);
  return diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff === -1 ? 'Yesterday' : agDate(d, '12:00').toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' });
}
const AG_IDEAS = ['Registration opens', 'Robot inspection', 'Drivers meeting', 'Opening ceremony', 'Matches begin', 'Lunch break', 'Alliance selection', 'Finals', 'Awards ceremony', 'Close'];
function agendaCard(e) {
  const list = (Array.isArray(e.agenda) ? e.agenda : []).slice().sort((a, b) => (a.d + a.t).localeCompare(b.d + b.t)), edit = agEdit && !spec;
  if (!list.length && !edit && spec) return '';
  const now = new Date(), today = dayKey(now), days = [...new Set(list.map(i => i.d))];
  const shown = edit ? days : (days.filter(d => d >= today).length ? days.filter(d => d >= today) : days.slice(-1)); // upcoming days; if it's all over, the last day
  const cur = list.filter(i => i.d === today && agDate(i.d, i.t) <= now).pop(); // the latest item that has started today
  const rows = shown.map(d => `<div class="agday">${esc(agDayName(d, today))}</div><ul class="ag">${list.filter(i => i.d === d).map(i => {
    const past = agDate(i.d, i.t) < now && i !== cur;
    return `<li class="${i === cur ? 'now' : past ? 'past' : ''}"><span class="agt">${esc(agTime(i.d, i.t))}</span><span class="agc"><span class="agd"></span></span><div class="agb">${esc(i.x)}${i === cur ? ' <span class="pill">Now</span>' : ''}${i.n ? `<span class="mut">${esc(i.n)}</span>` : ''}</div>${edit ? `<button type="button" class="x" data-act="agdel" data-id="${esc(i.id)}" aria-label="Delete ${esc(i.x)}">×</button>` : '<span></span>'}</li>`;
  }).join('')}</ul>`).join('');
  const defDay = e.start && e.end && today >= String(e.start).slice(0, 10) && today <= String(e.end).slice(0, 10) ? today : (String(e.start || '').slice(0, 10) || today);
  const form = edit ? `<div class="agadd"><div class="row"><input id="ag_d" type="date" value="${esc(defDay)}" aria-label="Day"><input id="ag_t" type="time" aria-label="Time"></div>
    <input id="ag_x" list="ag_ideas" placeholder="What happens, e.g. Matches begin" maxlength="80" aria-label="What happens" autocomplete="off"><datalist id="ag_ideas">${AG_IDEAS.map(x => `<option value="${esc(x)}">`).join('')}</datalist>
    <input id="ag_n" placeholder="Note (optional)" maxlength="160" aria-label="Note">
    <div class="foot"><button class="p" data-act="agadd">Add to agenda</button></div></div>` : '';
  const head = `<div class="nhead"><h2>Agenda</h2>${spec ? '' : `<button class="link" data-act="agedit">${edit ? 'Done' : list.length ? 'Edit' : 'Add'}</button>`}</div>`;
  const empty_ = !list.length && !edit ? '<p class="mut">Add the day’s schedule, like when registration opens, inspection and matches begin, and everyone on the team can see it here.</p>' : '';
  return `<div class="card agenda">${head}${rows}${empty_}${form}</div>`;
}
// Home: a status line, our rank as the big number and the next match we play (the tab bar does the navigating).
function vHome() {
  const e = evObj(); if (!e) return '';
  const st = stats(), me = st.by.get(US), ts = teams(), all = matches();
  const ours = all.filter(m => side(m)), next = ours.find(m => !scored(m));
  const away = next ? all.filter(m => !scored(m)).indexOf(next) : -1, stat = evStatus(e, all.some(scored), !!next, ours.length && ours.every(scored));
  let nx = '';
  if (next) {
    const s = side(next), sides = [['r', 'Red alliance', next.red, 'red'], ['b', 'Blue alliance', next.blue, 'blue']]; if (s === 'blue') sides.reverse();
    nx = `<div class="card next tap" data-act="gomatch" data-id="${esc(next.id)}" role="button" tabindex="0" aria-label="Open ${esc(next.label)}"><div class="nhead"><h2>Next match</h2><span class="chip warn">${esc(next.label)} · ${away <= 0 ? 'up next' : 'in ' + away + (away === 1 ? ' match' : ' matches')}</span></div>
    ${whenRow(next)}<div class="vs">${sides.map(([c, l, arr, col]) => `<div class="side ${c} ${s === col ? 'mine' : ''}"><span>${l}</span>${chips(next, arr)}</div>`).join('')}</div></div>`;
  }
  return `<div class="home"><div class="greet"><div><p class="live ${stat.cls}">${stat.html}</p><h1>${spec ? esc(teamInfo.name || US) : esc(name || US)}${!spec && name ? ' <button class="link namechg" data-act="setname" data-v="">Change</button>' : ''}</h1></div></div>
  <section class="panel"><div class="phead"><h2>Event overview</h2></div>${rankStat(st, me, ts)}${recStat(ours)}</section>
  ${nx}${AGENDA_ON ? agendaCard(e) : ''}</div>`;
}

function vEvent() {
  const e = evObj();
  let h = name || spec ? '' : whoCard('Who are you?', 'Your name goes on your notes and scouting.');
  if (e) h += vHome();
  const me = name ? `<p class="mut meta">Scouting as <b>${esc(name)}</b> · <button class="link" data-act="setname" data-v="">Change</button></p>` : '';
  if (!e && spec) return h + `<div class="card"><h2>No event yet</h2><p class="mut">Team ${esc(US)} hasn’t added an event to Recon yet. It shows up here as soon as they do.</p></div>` + vWatch();
  if (!e) return h + `<div class="card"><h2>Pick your event</h2>${me}${S.events.length ? '<p class="mut">Choose one of your events from the bar at the top, or add another here.</p>' : ''}<h3>Find your event</h3><p class="mut">Pulls in the teams, matches and rankings, and keeps them up to date.</p>${ebHTML()}<h3>Or paste an event code or link</h3>${importForm('')}<h3>Or create one by hand</h3>${manualForm()}</div>` + settingsCard();
  h += segBar([['list', 'Teams'], ['rank', 'Rankings'], ['skills', 'Skills'], ['more', 'More']], tv, 'tview');
  return h + ({ list: vTeamList, rank: vRank, skills: vSkills, more: vMore })[tv]();
}
const importForm = sku => `<div class="row"><input id="sku" value="${esc(sku)}" placeholder="Event code or link, e.g. RE-V5RC-26-5068" aria-label="Event code or link" autocapitalize="characters" autocomplete="off" spellcheck="false"><button class="p" data-act="import">Import</button></div><p class="mut" id="impmsg"></p>`;
const manualForm = () => `<div class="row"><input id="newev" placeholder="Event name" aria-label="Event name"><button data-act="addev">Create</button></div>`;

// More: everything that isn't a table – alliance requests, event notes, other events, settings.
const vWatch = () => `<div class="card"><h2>Spectator mode</h2><p class="mut meta">You’re watching <b>${esc(US)}</b> ${esc(teamInfo.name || '')}. It’s view-only: matches, rankings, OPR and skills from VEX Events. The team’s scouting notes and picklist aren’t shared.</p>${installRow()}<div class="foot"><span class="grow"></span><button data-act="unwatch">Stop watching</button></div></div>
  <p class="mut fine quiet"><button class="link" data-act="about">About Recon</button> · <button class="link" data-act="changes">What’s new</button></p>`;
function vMore() {
  const e = evObj(), sku = skuOf(e);
  if (spec) return vWatch();
  return `<div class="card"><h2>Event notes</h2>${noteBox('event', '', '', 'Anything about this event…')}</div>
  <details class="card" id="d-more" ${det('d-more', false)}><summary><h2>Add another event</h2></summary><h3>Find an event</h3>${ebHTML()}<h3>Or paste an event code or link</h3>${importForm('')}<h3>Or create one by hand</h3>${manualForm()}</details>
  ${sku ? '' : `<details class="card" id="d-link" ${det('d-link', false)}><summary><h2>Event link</h2></summary><input id="evlink" value="${esc(e.link || '')}" placeholder="Paste the VEX event link here" aria-label="Event link"></details>`}
  ${settingsCard()}
  <p class="mut fine quiet"><button class="link" data-act="about">About Recon</button> · <button class="link" data-act="changes">What’s new</button></p>
  <div class="foot"><button class="d" data-act="delev">Delete this event and all its notes</button></div>`;
}

// Teams: search + one row per team with the numbers people ask about most (rank, skills, OPR).
function vTeamList() {
  const ts = teams(), q = tq.toLowerCase(), st = stats();
  return `<input id="tsearch" type="search" value="${esc(tq)}" placeholder="Search teams by number, name or school…" aria-label="Search teams">
  <div class="card list" id="tl2">${ts.map(t => {
    const n = notes('scout', t.number).length + notes('team', t.number).length, hay = (t.number + t.name + t.school).toLowerCase();
    const r = st.by.get(t.number), k = skillOf(t.number, 'season');
    const bits = [r && r.rank != null ? 'Rank ' + r.rank : '', k && k.c != null ? 'Skills ' + fmt(k.c) + ' (D ' + fmt(k.d) + ' · A ' + fmt(k.p) + ')' : '', r && r.opr != null ? 'OPR ' + f1(r.opr) : ''].filter(Boolean);
    return `<div class="trow ${t.number === US ? 'us' : ''}" data-act="team" data-t="${t.number}" data-q="${esc(hay)}" ${q && !hay.includes(q) ? 'style="display:none"' : ''}><span class="num">${t.number}</span><div class="grow"><div>${esc(t.name)}</div><div class="mut">${esc(t.school)}${n ? ' · ' + n + (n === 1 ? ' note' : ' notes') : ''}</div>${bits.length ? `<div class="mut tstat">${bits.join(' · ')}</div>` : ''}</div>${r && (r.opr != null || r.rank != null) ? `<span class="rv"><i class="rdot ${r.rank == null ? '' : r.rank / ts.length <= .34 ? 'g' : r.rank / ts.length <= .67 ? 'y' : 'r'}"></i>${r.opr != null ? f1(r.opr) : '#' + r.rank}</span>` : '<span class="chev" aria-hidden="true">›</span>'}</div>` }).join('') || empty('No teams yet.')}</div>
  ${spec ? '' : `<details class="card" id="d-addteam" ${det('d-addteam', !ts.length)}><summary><h2>Add a team manually</h2></summary><div class="row"><input id="t_n" placeholder="Number e.g. 52111A" aria-label="Team number"><input id="t_name" placeholder="Team name" aria-label="Team name"><input id="t_s" placeholder="School" aria-label="School"><button class="p" data-act="addteam">Add</button></div></details>`}`;
}

function vRank() {
  const st = stats(), rows = [...st.by.entries()].map(([team, r]) => ({ ...r, team }));
  if (!rows.length) return '<div class="card"><h2>Rankings</h2><p class="mut">No qualification matches have been scored yet. Rankings and OPR show up here once they are.</p></div>';
  const key = { rank: (a, b) => (a.div || 0) - (b.div || 0) || a.rank - b.rank, opr: (a, b) => (b.opr ?? -1e9) - (a.opr ?? -1e9), ccwm: (a, b) => (b.ccwm ?? -1e9) - (a.ccwm ?? -1e9), avg: (a, b) => (b.avg ?? -1e9) - (a.avg ?? -1e9) }[rks] || (() => 0);
  rows.sort(key);
  return `<div class="card"><h2>Rankings</h2><p class="mut">${st.official ? 'Official rankings from VEX Events.' : 'Calculated from qualification scores (win points, then OPR). Official rankings replace these once VEX Events has them.'} OPR uses ${st.n} scored qualification ${st.n === 1 ? 'match' : 'matches'}.</p>
  ${segBar([['rank', 'Rank'], ['opr', 'OPR'], ['ccwm', 'CCWM'], ['avg', 'Avg score']].map(([k, l]) => [k, 'Sort: ' + l]), rks, 'rksort')}
  <div class="tblwrap"><table class="rk"><thead><tr><th>#</th><th>Team</th><th>W-L-T</th><th>WP</th><th class="wide">AP</th><th class="wide">SP</th><th>Avg</th><th class="wide">High</th><th>OPR</th><th class="wide">DPR</th><th>CCWM</th></tr></thead><tbody>
  ${rows.map(r => `<tr class="${r.team === US ? 'us' : ''}" data-act="team" data-t="${esc(r.team)}" data-flip="${esc(r.team)}"><td>${st.multiDiv ? 'D' + r.div + '·' : ''}${r.rank ?? '–'}</td><td><b>${esc(r.team)}</b></td><td>${rec(r)}</td><td>${r.wp ?? '–'}</td><td class="wide">${r.ap ?? '–'}</td><td class="wide">${r.sp ?? '–'}</td><td>${f1(r.avg)}</td><td class="wide">${r.high ?? '–'}</td><td>${f1(r.opr)}</td><td class="wide">${f1(r.dpr)}</td><td>${sgn(r.ccwm)}</td></tr>`).join('')}
  </tbody></table></div>
  <p class="mut">Avg = average points per match. OPR ≈ points a team adds to its alliance. DPR ≈ points the other alliance scores against it. CCWM = OPR − DPR, its effect on the winning margin. Tap a team for details.</p></div>`;
}

// Skills: highest / average driver and autonomous (programming) scores for every team, like the VEX app.
function vSkills() {
  const e = evObj(), d = stDoc();
  const upd = e.reid ? `<span class="stmsg mut">${statsBusy ? 'Loading season stats…' : ''}</span>` : '';
  const refresh = e.reid && !spec ? `<button data-act="refstats" ${statsBusy ? 'disabled' : ''}>${d ? 'Refresh' : 'Load season stats'}</button>` : '';
  if (!e.reid) return '<div class="card"><h2>Skills</h2><p class="mut">Skills scores and season records come from VEX Events, so they need an event imported with its event code (Event tab → More → Import).</p></div>';
  if (!d) return `<div class="card"><h2>Skills</h2><p class="mut">Season stats (skills scores, season record, awards) aren’t loaded yet. They cover each team’s whole season, not only this event, so they work even when no matches are being played. ${spec ? 'A teammate’s Recon loads them.' : 'This takes about a minute.'}</p><div class="foot">${upd}<span class="grow"></span>${refresh}</div></div>`;
  const rows = skillRows(sks, sko), got = rows.filter(r => r.c != null);
  const best = f => got.filter(r => has(r[f])).sort((a, b) => b[f] - a[f])[0];
  const mean = f => { const v = got.map(r => r[f]).filter(has); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null };
  const bc = best('c'), bd = best('d'), bp = best('p');
  const scopeName = sks === 'event' ? 'at this event' : 'this season';
  const sortName = { c: 'combined', d: 'driver', p: 'autonomous' }[sko];
  return `<div class="card"><h2>Skills</h2>
  <p class="mut">Combined = driver skills + autonomous (programming) skills. Each team’s best at any event ${sks === 'event' ? 'is replaced by their scores at this event only' : 'this season'}. Teams with no skills run are listed last.</p>
  ${segBar([['season', 'Season best'], ['event', 'This event']], sks, 'sksope')}
  ${got.length ? tiles([
    [bc ? fmt(bc.c) : '–', 'Highest combined', bc ? bc.team : ''],
    [bd ? fmt(bd.d) : '–', 'Highest driver', bd ? bd.team : ''],
    [bp ? fmt(bp.p) : '–', 'Highest auton', bp ? bp.team : ''],
    [fmt(mean('c')), 'Average combined', got.length + ' of ' + rows.length + ' teams'],
    [fmt(mean('d')), 'Average driver', ''], [fmt(mean('p')), 'Average auton', ''],
  ]) : `<p class="mut">${sks === 'event' ? 'Nobody has a skills run at this event yet.' : 'No skills scores found for these teams this season.'}</p>`}
  ${segBar([['c', 'Sort: Combined'], ['d', 'Sort: Driver'], ['p', 'Sort: Auton']], sko, 'sksort')}
  <div class="tblwrap"><table class="rk"><thead><tr><th>#</th><th>Team</th><th>Combined</th><th>Driver</th><th>Auton</th>${sks === 'season' ? '<th>Avg</th>' : ''}</tr></thead><tbody>
  ${rows.map((r, i) => `<tr class="${r.team === US ? 'us' : ''}" data-act="team" data-t="${esc(r.team)}" data-flip="${esc(r.team)}"><td>${r[sko] != null ? i + 1 : '–'}</td><td><b>${esc(r.team)}</b></td><td class="${sko === 'c' ? 'hi' : ''}">${fmt(r.c)}</td><td class="${sko === 'd' ? 'hi' : ''}">${fmt(r.d)}</td><td class="${sko === 'p' ? 'hi' : ''}">${fmt(r.p)}</td>${sks === 'season' ? `<td>${fmt(r.a)}</td>` : ''}</tr>`).join('')}
  </tbody></table></div>
  <p class="mut">Ranked by ${sortName} score ${scopeName}, among the teams at this event. ${sks === 'season' ? 'Avg = average combined score across the events they’ve done skills at. ' : ''}Tap a team for its full season.</p>
  <div class="foot"><span class="stmsg mut">${statsBusy ? 'Loading season stats…' : 'Updated ' + new Date(d.t).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</span><span class="grow"></span>${refresh}</div></div>`;
}
// ---------- event browser: find an event on VEX Events instead of typing its code ----------
// Results come from the server (/api/events). Typing filters them there (after a short pause); the list is painted
// straight into #ebres so typing in the search box never fights with a full re-render.
let EB = { scope: ls('ebs') || 'mine', q: '', list: null, total: 0, busy: false, err: '', msg: '', f: { country: '', region: '', city: '', level: '', when: '', hide: false } }, ebT, ebSeq = 0;
// Event lists are remembered for 10 minutes (per tab and search), so switching tabs or coming back is instant.
const EBC = lsJ('ebc') || {}, EB_TTL = 10 * 60000;
const ebKey = () => EB.scope + '|' + EB.q.trim().toLowerCase(), ebFresh = k => EBC[k] && Date.now() - EBC[k].t < EB_TTL;
function ebStore(k, list, total) { EBC[k] = { t: Date.now(), list, total }; const ks = Object.keys(EBC); if (ks.length > 8) { ks.sort((a, b) => EBC[a].t - EBC[b].t); delete EBC[ks[0]] } lsJ('ebc', EBC) }
const ebMatchQ = (list, q) => { const w = q.toLowerCase().split(/\s+/).filter(Boolean); return w.length ? list.filter(e => { const hay = [e.name, e.sku, e.city, e.region, e.country, e.venue].join(' ').toLowerCase(); return w.every(x => hay.includes(x)) }) : list };
const ebDaysTo = d => d ? Math.round((new Date(String(d).slice(0, 10) + 'T12:00:00') - new Date(new Date().toDateString() + ' 12:00:00')) / 864e5) : null;
function ebVisible() {
  const f = EB.f, have = new Set(S.events.map(e => skuOf(e)));
  return (EB.list || []).filter(e => {
    if (f.country && e.country !== f.country) return false;
    if (f.region && ebReg(e) !== f.region) return false;
    if (f.city && e.city !== f.city) return false;
    if (f.level && e.level !== f.level) return false;
    if (f.hide && have.has(e.sku.toUpperCase())) return false;
    if (f.when) { const d = ebDaysTo(e.start), tm = new Date(), sd = e.start ? new Date(String(e.start).slice(0, 10) + 'T12:00:00') : null;
      if (d == null) return false;
      if (f.when === 'n7' && !(d >= 0 && d <= 7)) return false;
      if (f.when === 'n30' && !(d >= 0 && d <= 30)) return false;
      if (f.when === 'l7' && !(d <= 0 && d >= -7)) return false;
      if (f.when === 'l30' && !(d <= 0 && d >= -30)) return false;
      if (f.when === 'tm' && !(sd && sd.getMonth() === tm.getMonth() && sd.getFullYear() === tm.getFullYear())) return false }
    return true;
  });
}
const ebReg = e => e.country + '\u0001' + e.region; // a state/region is only unique within its country (there's a Georgia in two)
const ebFiltersOn = () => !!(EB.f.country || EB.f.region || EB.f.city || EB.f.level || EB.f.when || EB.f.hide);
function ebFilters() {
  const L = EB.list || [], uniq = fn => [...new Set(L.map(fn).filter(Boolean))].sort(), f = EB.f;
  const when = EB.scope === 'past' ? [['', 'Any date'], ['l7', 'Last 7 days'], ['l30', 'Last 30 days'], ['tm', 'This month']] : [['', 'Any date'], ['n7', 'Next 7 days'], ['n30', 'Next 30 days'], ['tm', 'This month']];
  const inC = L.filter(e => !f.country || e.country === f.country), countries = uniq(e => e.country);
  const regs = [...new Map(inC.filter(e => e.region).map(e => [ebReg(e), f.country || !e.country ? e.region : e.region + ', ' + e.country])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const cities = uniq(e => e.city && (!f.country || e.country === f.country) && (!f.region || ebReg(e) === f.region) ? e.city : '');
  const lvl = uniq(e => e.level), nm = EB.f;
  const sel = (id, label, cur, options) => `<div class="ebf"><label for="${id}" id="l_${id}">${label}</label>${dd(id, cur, options, { label, value: cur })}</div>`;
  const show = {
    country: countries.length > 1 || f.country, region: regs.length > 1 || f.region, city: cities.length > 1 || f.city, level: lvl.length > 1 || f.level
  };
  const chipTxt = { country: f.country, region: (regs.find(r => r[0] === f.region) || [0, ''])[1], city: f.city, level: f.level, when: (when.find(w => w[0] === f.when) || [0, ''])[1] };
  const active = ['country', 'region', 'city', 'level', 'when'].filter(k => f[k]);
  const n = active.length;
  return `<div class="ebfilters"><button type="button" class="chip ${EB.fo ? 'on' : ''}" data-act="ebfopen" aria-expanded="${!!EB.fo}">Filters${n ? ' · ' + n : ''} <span class="chev ${EB.fo ? 'up' : ''}" aria-hidden="true">›</span></button>` +
    `<button type="button" class="chip ${f.hide ? 'on' : ''}" data-act="ebhide" aria-pressed="${f.hide}">Hide added</button>` +
    active.map(k => `<button type="button" class="chip on ebx" data-act="ebclr" data-k="${k}" aria-label="Remove filter ${esc(chipTxt[k])}">${esc(chipTxt[k])} <span aria-hidden="true">×</span></button>`).join('') +
    (ebFiltersOn() ? '<button type="button" class="link" data-act="ebreset">Clear all</button>' : '') +
    (EB.fo ? `<div class="ebpanel">${show.country ? sel('ebcty', 'Country', f.country, [['', 'Any country'], ...countries.map(x => [x, x])]) : ''}${show.region ? sel('ebreg', 'State / region', f.region, [['', 'Any state / region'], ...regs]) : ''}${show.city ? sel('ebcity', 'City', f.city, [['', 'Any city'], ...cities.map(x => [x, x])]) : ''}${show.level ? sel('eblvl', 'Level', f.level, [['', 'Any level'], ...lvl.map(x => [x, x])]) : ''}${sel('ebwhen', 'Date', f.when, when)}</div>` : '') + `</div>`;
}
if (!['mine', 'soon', 'past'].includes(EB.scope)) EB.scope = 'mine';
const ebDay = d => new Date(String(d).slice(0, 10) + 'T12:00:00');
const ebDates = (a, b) => { if (!a) return ''; const f = d => ebDay(d).toLocaleDateString([], { day: 'numeric', month: 'short' }), x = f(a), y = b ? f(b) : x; return x === y ? x : x + ' – ' + y };
function ebRows() {
  if (EB.err) return `<p class="err">${esc(EB.err)}</p>`;
  if (!EB.list) return EB.busy ? `<div class="card list evlist skel" aria-hidden="true">${[0, 1, 2, 3].map(() => '<div class="trow evrow"><div class="grow"><div class="sk sk1"></div><div class="sk sk2"></div></div></div>').join('')}</div>` : '';
  const vis = ebVisible();
  if (!EB.list.length || !vis.length) return empty(ebFiltersOn() ? 'No events match those filters.' : EB.q ? 'No events match that.' : EB.scope === 'mine' ? 'No events found for your team this season yet. Try Coming up, or paste an event code below.' : 'No events found.');
  const have = new Map(S.events.map(e => [skuOf(e), e.id]));
  return `<div class="card list evlist">${vis.map(e => {
    const place = [e.city, e.region, e.country].filter(Boolean).join(', '), got = have.has(e.sku.toUpperCase());
    return `<div class="trow evrow"><div class="grow"><div class="evn">${esc(e.name)}</div><div class="mut">${esc([ebDates(e.start, e.end), place, e.level].filter(Boolean).join(' · '))}</div><div class="mut evsku">${esc(e.sku)}</div></div>${got ? `<button data-act="evopen" data-sku="${esc(e.sku)}" aria-label="Open ${esc(e.name)}">Open</button>` : `<button data-act="evadd" data-sku="${esc(e.sku)}" aria-label="Add ${esc(e.name)}">Add</button>`}</div>`;
  }).join('')}</div>${vis.length !== EB.list.length ? `<p class="mut">${vis.length} of ${EB.list.length} match your filters.</p>` : ''}${EB.total > EB.list.length ? `<p class="mut">Showing ${EB.list.length} of ${EB.total}. Type in the box to narrow it down.</p>` : ''}`;
}
const ebMsgText = () => EB.msg || (EB.busy ? 'Searching VEX Events…' : '');
const ebMsgCls = () => 'mut ebmsg' + (EB.busy ? ' busy' : '');
const ebHTML = () => `<div id="eb">${segBar([['mine', 'Our events'], ['soon', 'Coming up'], ['past', 'Earlier']], EB.scope, 'ebscope')}
  <input id="ebq" type="search" value="${esc(EB.q)}" placeholder="Search by name, city, state, country or code…" aria-label="Search events" autocomplete="off" spellcheck="false">
  <div id="ebf">${ebFilters()}</div>
  <p class="${ebMsgCls()}" id="ebmsg" role="status">${esc(ebMsgText())}</p><div id="ebres">${ebRows()}</div></div>`;
function ebPaint() { const r = $('#ebres'), m = $('#ebmsg'), f = $('#ebf'); if (f) f.innerHTML = ebFilters(); if (r) r.innerHTML = ebRows(); if (m) { m.textContent = ebMsgText(); m.className = ebMsgCls() } }
async function ebLoad(force) {
  const k = ebKey(), baseK = EB.scope + '|', base = EBC[baseK];
  // a whole list for this tab is already here: search it locally, no need to ask again
  if (!force && EB.q.trim() && base && ebFresh(baseK) && base.total <= base.list.length) { ++ebSeq; EB.list = ebMatchQ(base.list, EB.q); EB.total = EB.list.length; EB.err = ''; EB.busy = false; ebPaint(); return }
  if (!force && ebFresh(k)) { ++ebSeq; EB.list = EBC[k].list; EB.total = EBC[k].total; EB.err = ''; EB.busy = false; ebPaint(); return }
  const seq = ++ebSeq; EB.busy = true; EB.err = ''; EB.list = null; ebPaint();
  try { const d = await api('/events', { scope: EB.scope, q: EB.q }); if (seq !== ebSeq) return; EB.list = d.events || []; EB.total = d.total || EB.list.length; ebStore(k, EB.list, EB.total) }
  catch (e) { if (seq !== ebSeq) return; EB.list = []; EB.total = 0; EB.err = e instanceof NetErr ? 'Finding events needs a connection. You can still paste an event code below.' : e instanceof AuthErr ? '' : 'Couldn’t load events: ' + String(e.message || e).slice(0, 140) }
  EB.busy = false; ebPaint();
}
// load the first time the browser is actually on screen (not while its folded section is closed)
function ebKick() { const el = $('#eb'); if (el && !el.closest('details:not([open])') && EB.list === null && !EB.busy && code && !spec) ebLoad() }
function filt(q) { q = q.toLowerCase(); document.querySelectorAll('#tl2 .trow').forEach(c => c.style.display = c.dataset.q.includes(q) ? '' : 'none') }

let mnames = ls('mnames') === '1'; // show each team's name under its number on match cards
const chips = (m, arr) => arr.map(n => { const nm = mnames ? tName(n) : ''; return `<button class="chip ${nm ? 'nm ' : ''}${n === US ? 'me' : cls(m, n)}" data-act="team" data-t="${n}">${n}${nm ? `<small>${esc(nm)}</small>` : ''}</button>` }).join('');
function vMatches() {
  if (!evObj()) return empty('Pick an event first.');
  const all = matches(), inT = m => m.red.includes(mfT) || m.blue.includes(mfT), list = mf === 'all' ? all : mf === 'team' ? (mfT ? all.filter(inT) : []) : all.filter(m => side(m));
  const st = stats(), me = st.by.get(US), playedN = all.filter(m => side(m) && scored(m)).length;
  const rankChip = me && me.rank != null ? `<span class="hchip">Rank ${me.rank} of ${teams().length}</span>` : '';
  let h = `<section class="panel">${recStat(all.filter(m => side(m)))}</section>` +
    segBar([['ours', spec ? US : 'Our matches'], ['all', 'All matches'], ['team', 'By team']], mf, 'mfilter') +
    `<div class="mtools"><button class="chip ${mnames ? 'on' : ''}" data-act="mnames" aria-pressed="${mnames}">Team names</button></div>`;
  let tw = 0, tl = 0, tt = 0;
  if (mf === 'team') {
    h += `<div class="card mteam">${dd('mft', mfT, [['', 'Pick a team…'], ...teams().map(t => [t.number, t.number + ' · ' + t.name])], { value: mfT, label: 'Team to show matches for' })}</div>`;
    list.forEach(m => { if (!scored(m)) return; const red = m.red.includes(mfT), a = red ? m.rs : m.bs, b = red ? m.bs : m.rs; a > b ? tw++ : a < b ? tl++ : tt++ });
    if (mfT) h += `<p class="mut meta">${list.length} ${list.length === 1 ? 'match' : 'matches'} for <b>${esc(mfT)}</b>${tw + tl + tt ? ` · ${tw}W ${tl}L${tt ? ' ' + tt + 'T' : ''} so far` : ''}</p>`;
  }
  h += list.map(m => {
    const s = side(m), o = !spec && open[m.id], ps = mf === 'team' ? (m.red.includes(mfT) ? 'red' : 'blue') : s, ours = mf !== 'all' && !!ps; // Our matches: our alliance is always the left column, and the score reads us–them
    const sides = [['r', 'Red alliance', m.red, 'red'], ['b', 'Blue alliance', m.blue, 'blue']]; if (ours && ps === 'blue') sides.reverse();
    let res = '';
    const rel = mf === 'team' ? `<div class="mrel mut"><b>${esc(mfT)}</b> with ${m[ps].filter(x => x !== mfT).map(esc).join(', ') || '–'} <span aria-hidden="true">·</span> against ${m[ps === 'red' ? 'blue' : 'red'].map(esc).join(', ')}</div>` : '';
    if (ps && scored(m)) { const a = ps === 'red' ? m.rs : m.bs, b = ps === 'red' ? m.bs : m.rs; res = a > b ? '<span class="res w">W</span>' : a < b ? '<span class="res l">L</span>' : '<span class="res">T</span>' }
    return `<div class="card ${s ? 'us' : ''}"><div class="mhead" ${spec ? '' : 'data-act="mopen" role="button" aria-expanded="' + !!o + '"'} data-id="${m.id}"><span class="num">${esc(m.label)}</span>${scored(m) ? `<span class="score">${ours && ps === 'blue' ? m.bs + '–' + m.rs : m.rs + '–' + m.bs}</span>` : ''}${res}<span class="grow"></span>${spec ? '' : `<span class="chev ${o ? 'up' : ''}" aria-hidden="true">›</span>`}</div>
    ${whenRow(m)}${rel}<div class="vs">${sides.map(([c, l, arr, col]) => `<div class="side ${c} ${!ours && s === col ? 'mine' : ''}"><span>${l}</span>${chips(m, arr)}</div>`).join('')}</div>
    ${o ? `<div class="mx ${justOpened === m.id ? 'reveal' : ''}">` + (s ? `<h3>Strategy</h3>${noteBox('match', m.id, 'strat', 'Our strategy for this match…')}<h3>Our alliance</h3>${noteBox('match', m.id, 'ally', 'What our partner said / their plan…')}<h3>Opposition</h3>${noteBox('match', m.id, 'opp', 'Weaknesses, tendencies…')}`
        : `<h3>Notes</h3>${noteBox('match', m.id, 'gen', 'What happened in this match…')}`) + `<div class="foot"><button class="d" data-act="clearmatch" data-id="${m.id}">Clear all notes for this match</button><button class="d" data-act="delmatch" data-id="${m.id}">Delete match</button></div></div>` : ''}</div>`
  }).join('') || empty(mf === 'all' ? 'No matches yet.' : mf === 'team' ? (mfT ? 'No matches for ' + mfT + ' yet.' : 'Pick a team to see who they play with and against.') : (spec ? 'No matches for ' + US + ' yet.' : 'No matches with us yet.'));
  if (spec) return h;
  h += `<details class="card" id="d-addmatch" ${det('d-addmatch', !all.length)}><summary><h2>Add a match manually</h2></summary><div class="row"><input id="m_l" placeholder="Label e.g. Q12"><input id="m_o" type="number" inputmode="numeric" placeholder="Match number (for sorting)"></div>
  <h3>Red alliance</h3><div class="row"><input id="m_r1" data-combo="teams" autocomplete="off" placeholder="Team"><input id="m_r2" data-combo="teams" autocomplete="off" placeholder="Team"></div>
  <h3>Blue alliance</h3><div class="row"><input id="m_b1" data-combo="teams" autocomplete="off" placeholder="Team"><input id="m_b2" data-combo="teams" autocomplete="off" placeholder="Team"></div>
  <div class="foot"><button class="p" data-act="addmatch">Add match</button></div>${tlist()}</details>`;
  return h;
}

// What 1 and 5 mean for each rating, shown under the buttons so a bare "3" always has a meaning.
const SCALE = { autoCons: ['Rarely works', 'Works every time'], driver: ['Beginner', 'Excellent'], driverCons: ['Many mistakes', 'Very steady'], speed: ['Slow', 'Very fast'], durability: ['Breaks easily', 'Very tough'], scoring: ['Poor', 'Excellent'], scoreCons: ['Hit or miss', 'Every time'], overall: ['Weak', 'Top pick'], scoreSpeed: ['Very slow', 'Very fast'] };
// The ratings that feed the suggested overall rating (their average).
const RATE_F = ['autoCons', 'driver', 'driverCons', 'speed', 'durability', 'scoring', 'scoreSpeed', 'scoreCons'];
const suggest = o => { const v = RATE_F.map(f => +o[f]).filter(x => x > 0); return v.length ? { avg: v.reduce((a, b) => a + b, 0) / v.length, n: v.length } : null };
const suggestHTML = d => { const g = suggest(d); if (!g) return '<span class="mut">Rate a few things above and Recon suggests an overall rating from their average.</span>'; const r = Math.round(g.avg); return `Suggested overall: <b>${g.avg.toFixed(1)}</b> / 5 <span class="mut">(average of ${g.n} rating${g.n === 1 ? '' : 's'})</span> ` + (+d.overall === r ? '<span class="mut">· matches your rating</span>' : `<button type="button" data-act="usesuggest">Use ${r}</button>`) };
// What a team needs before it counts as fully scouted (free-text boxes are optional). Entries from all scouts are combined.
const REQ_F = ['autoPts', 'autoCons', 'driver', 'driverCons', 'robotType', 'speed', 'durability', 'scoring', 'scoreSpeed', 'cycleTime', 'reliable', 'scoreCons', 'toggle', 'overall', 'good'];
const scoutState = t => { const sc = notes('scout', t); if (!sc.length) return ''; return REQ_F.every(f => sc.some(e => e[f] !== undefined && e[f] !== null && e[f] !== '' && e[f] !== 0)) ? 'full' : 'part' };
const R = (f, v) => `<div class="rate" role="group" aria-labelledby="l_${f}">${[1, 2, 3, 4, 5].map(i => `<button data-act="rate" data-f="${f}" data-v="${i}" class="${v === i ? 'on' : ''}" aria-pressed="${v === i}">${i}</button>`).join('')}</div>${SCALE[f] ? `<div class="scale"><span>1 = ${SCALE[f][0]}</span><span>5 = ${SCALE[f][1]}</span></div>` : ''}`;
// A labelled field: the label stays visible after something is typed, with an optional hint under it.
const fld = (id, label, body, hint) => `<div class="ff"><label id="l_${id}" for="${id}">${label}</label>${hint ? `<div class="mut hint">${hint}</div>` : ''}${body}</div>`;
const fldR = (f, label, v, hint) => `<div class="ff"><div class="lbl" id="l_${f}">${label}</div>${hint ? `<div class="mut hint">${hint}</div>` : ''}${R(f, v)}</div>`;
const sect = (title, sub, body) => `<div class="card sect"><div class="sech"><h2>${title}</h2><p class="mut">${sub}</p></div>${body}</div>`;
const opts = (list, blank) => [['', blank], ...list.map(o => [o, o])];
function vScout() {
  if (!evObj()) return empty('Pick an event first.');
  if (!name) return whoCard('Who’s scouting?', 'You can scout each team once overall, plus once per match you watch, and come back to edit.');
  const ms = matches();
  if (scTeam && draft) {
    const d = draft, tms = ms.filter(m => m.red.includes(scTeam) || m.blue.includes(scTeam));
    const rel = m => { const s = side(m, scTeam); return s === 'ally' ? ' · with us' : s === 'opp' ? ' · against us' : '' };
    return `<button class="link back" data-act="donescout">‹ All teams</button>
    <div class="card"><h2><span class="num">${scTeam}</span> ${esc(tName(scTeam))}</h2>
    ${fld('scm', 'What are you scouting?', dd('scm', d.match, [['', 'Overall / pit scouting (not one match)'], ...tms.map(m => [m.id, 'Match ' + m.label + rel(m) + (scored(m) ? ' · played' : '')])]), 'Overall = your general read of the team. Pick a match to record what you saw in that one match.')}
    ${claimBar(scTeam)}
    <p class="mut hint">Ratings go from 1 (weakest) to 5 (best); the words under each row say what that means. Tap the same number again to clear it.</p></div>
    ${sect('Autonomous', 'What the robot does on its own, before the drivers take over.',
      fld('f_autoPts', 'Auto points scored', `<input id="f_autoPts" data-f="autoPts" inputmode="decimal" value="${esc(d.autoPts)}" placeholder="e.g. 12">`, 'Roughly how many points their autonomous scores in a match.') +
      fldR('autoCons', 'Auto consistency', d.autoCons, 'Does it work every match?') +
      fld('f_autoNotes', 'What does their auto do?', `<textarea id="f_autoNotes" data-f="autoNotes" placeholder="e.g. Scores 2 preloads then drives to the wall">${esc(d.autoNotes)}</textarea>`))}
    ${sect('Driver', 'How well the person driving plays the match.',
      fldR('driver', 'Driver skill', d.driver) + fldR('driverCons', 'Driver consistency', d.driverCons, 'Steady every match, or up and down?') +
      fld('f_driveNotes', 'Driving notes', `<textarea id="f_driveNotes" data-f="driveNotes" placeholder="e.g. Plays good defence, but slow to get back to the scoring zone">${esc(d.driveNotes)}</textarea>`, 'How they drive, their strategy, mistakes, how well they play defence.'))}
    ${sect('Robot', 'The build itself.',
      fld('f_robotType', 'Robot type & design', `<input id="f_robotType" data-f="robotType" value="${esc(d.robotType)}" placeholder="e.g. 6-motor tank drive, roller intake, arm scorer">`, 'Drivetrain, intake and scoring mechanism.') +
      fldR('speed', 'Speed', d.speed) + fldR('durability', 'Durability', d.durability, 'Will it survive a hard match?') + photosField(scTeam))}
    ${sect('Scoring', 'How well they score during a match.',
      fldR('scoring', 'Scoring ability', d.scoring) +
      fldR('scoreSpeed', 'Scoring speed', d.scoreSpeed, 'How fast do they score during a match?') +
      fld('f_cycleTime', 'Approximate cycle time (seconds)', `<input id="f_cycleTime" data-f="cycleTime" inputmode="decimal" value="${esc(d.cycleTime)}" placeholder="e.g. 8">`, 'Roughly how many seconds it takes them to score one load, from picking it up at the loader to scoring it.') +
      fld('f_reliable', 'Can they score reliably?', dd('f_reliable', d.reliable, opts(['Yes, reliable', 'Sometimes', 'No, bad at scoring'], 'Not sure yet'), { f: 'reliable' })) +
      fldR('scoreCons', 'Scoring consistency', d.scoreCons, 'Do they score about the same every match?'))}
    ${sect('Toggle', 'Whether they can hold a toggle, and how they do it.',
      fld('f_toggle', 'How well can they hold a toggle?', dd('f_toggle', d.toggle, opts(['Very well', 'Well', 'Decent', 'Not well', 'Not at all'], 'Not sure yet'), { f: 'toggle' })) +
      fld('f_toggleMech', 'Toggle mechanism', `<textarea id="f_toggleMech" data-f="toggleMech" placeholder="e.g. Pneumatic hook on the arm that clamps the top bar">${esc(d.toggleMech)}</textarea>`, 'Describe what they use to do the toggle (not a score).'))}
    ${sect('Overall', 'Your final read on this team.',
      `<div class="suggest" id="sugg" aria-live="polite">${suggestHTML(d)}</div>` +
      fldR('overall', 'Overall rating', d.overall) +
      fld('f_good', 'Are they a good team?', dd('f_good', d.good, opts(['Yes', 'Decent', 'No'], 'Not sure yet'), { f: 'good' })) +
      fld('f_comments', 'Other comments & weaknesses', `<textarea id="f_comments" data-f="comments" placeholder="Anything else we should know…">${esc(d.comments)}</textarea>`))}
    <div class="card"><div class="foot"><span class="mut grow">✔ Autosaves as you go${online ? '' : ' (kept on this phone until you’re back online)'}.</span><button class="d" data-act="resetdraft">Reset</button><button class="p" data-act="donescout">Done</button></div></div>`;
  }
  const rel = n => { const a = [], o = []; ms.forEach(x => { const s = side(x, n); if (n === US || !s) return; (s === 'ally' ? a : o).push(x.label.replace(/^Mock /, '')) }); return { a, o } };
  const all = teams().filter(t => t.number !== US), mine = t => myScouts(t.number).length, left = all.filter(t => !scoutedBy(t.number).length), show = sf === 'todo' ? left : sf === 'done' ? all.filter(t => scoutedBy(t.number).length) : all;
  const doneN = all.length - left.length;
  return `<div class="homehero scouthero"><span class="hl">Teams scouted</span><div class="hbig"><span data-count="${doneN}" data-ck="done">${doneN}</span><small>of ${all.length}</small></div><div class="sbar" role="progressbar" aria-valuenow="${doneN}" aria-valuemin="0" aria-valuemax="${all.length}"><i style="width:${all.length ? Math.round(100 * doneN / all.length) : 0}%"></i></div></div>
  <div class="scouthead"><span class="mut">Scouting as <b>${esc(name)}</b> · <button class="link" data-act="setname" data-v="">Change</button></span><span class="mut">${all.length - left.length} of ${all.length} done by the team</span></div>
  ${segBar([['todo', 'To scout (' + left.length + ')'], ['done', 'Scouted (' + (all.length - left.length) + ')'], ['all', 'All (' + all.length + ')']], sf, 'sfilter')}
  <p class="mut legend"><span class="mtag g">Q</span> plays with us <span class="mtag r">Q</span> plays against us</p>
  <div class="card list">${show.map(t => {
    const r = rel(t.number), n = mine(t), by = scoutedBy(t.number), cl = claimOf(t.number), st = scoutState(t.number);
    return `<div class="trow ${st}" data-act="startscout" data-t="${t.number}"><span class="num">${t.number}</span><div class="grow"><div>${esc(t.name)}</div>${r.a.length || r.o.length ? `<div class="rels">${r.a.map(l => `<span class="mtag g" title="With us in ${esc(l)}" aria-label="With us in ${esc(l)}">${esc(l)}</span>`).join('')}${r.o.map(l => `<span class="mtag r" title="Against us in ${esc(l)}" aria-label="Against us in ${esc(l)}">${esc(l)}</span>`).join('')}</div>` : ''}${by.length || cl ? `<div class="who mut">${by.length ? 'Scouted by ' + by.map(w => w === name ? 'you' : esc(w)).join(', ') : ''}${by.length && cl ? ' · ' : ''}${cl ? `<span class="claim">${cl.by === name ? 'You have' : esc(cl.by) + ' has'} dibs</span>` : ''}</div>` : ''}</div>${st === 'full' ? '' : cl && cl.by === name ? `<button type="button" class="dibs on" data-act="unclaim" data-t="${t.number}">Release</button>` : `<button type="button" class="dibs" data-act="claim" data-t="${t.number}">${cl ? 'Take' : 'Dibs'}</button>`}${by.length ? `<span class="tick" title="Scouted by ${esc(by.join(', '))}">✓${by.length > 1 ? ' ' + by.length : ''}</span>` : ''}<span class="chev" aria-hidden="true">›</span></div>`
  }).join('') || empty(!all.length ? 'Add teams first.' : sf === 'done' ? 'Nothing scouted yet.' : 'Your team has scouted every team. Open Scouted to edit an entry.')}</div>${activityCard()}`;
}
// Who did what, newest first: scouting entries and claims from the whole team.
function activityCard() {
  const items = S.notes.filter(n => n.eventId === ev && (n.kind === 'scout' || (n.kind === 'claim' && claimOf(n.ref) === n))).sort((a, b) => b.ts - a.ts).slice(0, 10);
  if (!items.length) return '';
  return `<div class="card"><h2>Team activity</h2><div class="list">${items.map(n => `<div class="trow" data-act="startscout" data-t="${esc(n.ref)}"><span class="avatar">${esc(((n.by || '?')[0] || '?').toUpperCase())}</span><div class="grow"><div><b>${esc(n.by || 'Someone')}</b> ${n.kind === 'claim' ? 'called dibs on' : 'scouted'} <b>${esc(n.ref)}</b></div><div class="mut">${n.kind === 'claim' ? 'Dibs' : n.matchLabel ? 'Match ' + esc(n.matchLabel) : 'Overall'} · ${when(n.ts)}</div></div><span class="chev" aria-hidden="true">›</span></div>`).join('')}</div></div>`;
}
function claimBar(t) {
  const by = scoutedBy(t).filter(w => w !== name), cl = claimOf(t);
  return (by.length ? `<p class="mut hint">Also scouted by <b>${by.map(esc).join(', ')}</b>.</p>` : '') + (cl && cl.by !== name ? `<p class="mut hint"><b>${esc(cl.by)}</b> has dibs on this team.</p>` : '');
}
function newDraft(t, matchId) {
  const m = matchId && S.matches.find(x => x.id === matchId);
  return { id: scoutId(t, name, matchId), eventId: ev, kind: 'scout', ref: t, by: name, ts: Date.now(), text: '', match: matchId || '', matchLabel: m ? m.label : '' };
}
function loadDraft(t, matchId) { const id = scoutId(t, name, matchId), ex = S.notes.find(n => n.id === id); draft = ex ? { ...ex } : newDraft(t, matchId) }
let saveT = null;
function saveDraft(ms = 600) { clearTimeout(saveT); saveT = setTimeout(flushDraft, ms) }
// Write the draft now if an autosave is pending (called before leaving the form so the last edits aren't lost).
// It's sent quietly: the form already shows what was typed, so there's nothing to re-render.
function flushDraft() { if (saveT === null) return; clearTimeout(saveT); saveT = null; if (draft) { draft.by = name; send({ col: 'notes', id: draft.id, data: { ...draft }, mode: 'set' }, true) } }
// One saved scouting entry, as teammates read it: grouped, every value labelled, empty fields left out.
const sum = n => {
  const r5 = v => v ? v + ' / 5' : '', pts = v => v ? esc(v) + ' pts' : '';
  const kv = (l, v) => v ? `<div class="kv"><span>${l}</span><b>${v}</b></div>` : '';
  const tx = (l, v) => v ? `<div class="kv txt"><span>${l}</span><div>${esc(v)}</div></div>` : '';
  const grp = (t, ...rows) => { const h = rows.join(''); return h ? `<div class="sg"><h4>${t}</h4>${h}</div>` : '' };
  return `<div class="note entry"><div class="ehead"><b>${n.matchLabel ? 'Match ' + esc(n.matchLabel) : 'Overall scouting'}</b><span class="mut">${esc(n.by || '')} · ${when(n.ts)}</span></div>` +
    grp('Autonomous', kv('Auto points', pts(n.autoPts)), kv('Auto consistency', r5(n.autoCons)), tx('What their auto does', n.autoNotes)) +
    grp('Driver', kv('Driver skill', r5(n.driver)), kv('Driver consistency', r5(n.driverCons)), tx('Driving notes', n.driveNotes)) +
    grp('Robot', tx('Type & design', n.robotType), kv('Speed', r5(n.speed)), kv('Durability', r5(n.durability))) +
    grp('Scoring', kv('Scoring ability', r5(n.scoring)), kv('Scores reliably?', esc(n.reliable || '')), kv('Scoring speed', r5(n.scoreSpeed)), kv('Cycle time', n.cycleTime ? esc(n.cycleTime) + ' s' : ''), kv('Scoring consistency', r5(n.scoreCons))) +
    grp('Toggle', kv('Holds a toggle', esc(n.toggle || '')), tx('Toggle mechanism', n.toggleMech), !n.toggleMech && n.toggleQ ? kv('Mechanism rating (old form)', r5(n.toggleQ)) : '') +
    grp('Overall', kv('Overall rating', r5(n.overall)), (g => g ? kv('Suggested overall', g.avg.toFixed(1) + ' / 5') : '')(suggest(n)), kv('Good team?', esc(n.good || '')), tx('Comments', n.comments)) + `</div>`;
};

// ---------- Robot photos ----------
// Photos are shrunk on the phone (about 1000 px, 100-150 KB) and kept in D1 beside the team's other data, but not in the synced
// state: a team's photos are fetched when its page opens. New ones wait in a queue (localStorage) until there is a connection.
// The server keeps photos for the team's 5 most recent events only, so older ones vanish by themselves.
const PH = {}; // `${event}|${team}` -> photos from the server
let pq = lsJ('pq') || [], phBusy = false, phFor = null;
const phKey = (e, t) => e + '|' + t;
const savePq = () => { try { localStorage.setItem('pq', JSON.stringify(pq)); return true } catch (e) { return false } };
const phList = num => [...((PH[phKey(ev, num)] || {}).list || []), ...pq.filter(q => q.eventId === ev && q.team === num).map(q => ({ ...q, wait: true }))];
async function phLoad(num) {
  const k = phKey(ev, num), cur = PH[k]; if (cur && (cur.busy || Date.now() - cur.at < 30000)) return;
  PH[k] = { list: cur ? cur.list : [], at: 0, busy: true };
  try { const d = await api('/photos', { eventId: ev, team: num }); PH[k] = { list: d.photos || [], at: Date.now() } }
  catch (e) { PH[k] = { list: cur ? cur.list : [], at: Date.now() - 20000 } }
  if (mTeam === num || (tab === 'scout' && scTeam === num)) render();
}
async function phFlush() {
  if (phBusy || !code || spec) return; phBusy = true;
  try {
    while (pq.length) {
      const q = pq[0];
      try {
        const d = await api('/photo', { mode: 'add', id: q.id, eventId: q.eventId, team: q.team, img: q.img, by: q.by });
        const e = PH[phKey(q.eventId, q.team)]; if (e) e.list = [...e.list.filter(x => x.id !== q.id), d.photo];
      } catch (e) {
        if (e instanceof NetErr || e instanceof AuthErr) break;
        toast('A photo couldn’t be saved: ' + e.message); // rejected by the server: drop it
      }
      pq.shift(); savePq();
    }
  } finally { phBusy = false; if (mTeam || (tab === 'scout' && scTeam)) render(); setStatus() }
}
// Read the picture, turn it upright, scale it down and compress until it is small enough.
async function phShrink(file) {
  let src, w, h, done = () => { };
  if (window.createImageBitmap) { try { src = await createImageBitmap(file, { imageOrientation: 'from-image' }); w = src.width; h = src.height; done = () => src.close && src.close() } catch (e) { src = null } }
  if (!src) {
    const u = URL.createObjectURL(file); src = new Image(); src.src = u; await src.decode(); w = src.naturalWidth; h = src.naturalHeight; done = () => URL.revokeObjectURL(u);
  }
  try {
    let side = 1000;
    for (let tries = 0; tries < 6; tries++) {
      const k = Math.min(1, side / Math.max(w, h)), c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
      c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
      for (const q of [0.72, 0.6, 0.5]) { const u = c.toDataURL('image/jpeg', q); if (u.length <= 190000) return u }
      side = Math.round(side * 0.8);
    }
    throw new Error('too big');
  } finally { done() }
}
async function phAdd(files, num) {
  if (spec || !num) return;
  const have = phList(num).length, room = 3 - have;
  if (room <= 0) { toast('That team already has 3 photos. Delete one first.'); return }
  const list = [...files].filter(f => /^image\//.test(f.type) || !f.type).slice(0, room);
  if (files.length > room) toast('Only ' + room + ' more photo' + (room === 1 ? '' : 's') + ' fit for this team.');
  for (const f of list) {
    try {
      const img = await phShrink(f);
      pq.push({ id: 'ph_' + uid(), eventId: ev, team: num, img, by: name || '', t: Date.now() });
      if (!savePq()) { pq.pop(); toast('Your phone has no room to keep that photo. Connect and send the waiting ones first.'); break }
    } catch (e) { toast('That photo couldn’t be read. Try another.') }
  }
  render(); phFlush();
}
const phInput = (() => { // lives outside the page so a refresh can't drop it while the camera is open
  const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*'; i.multiple = true; i.hidden = true; i.setAttribute('aria-hidden', 'true');
  i.addEventListener('change', () => { const f = [...i.files], t = phFor; i.value = ''; if (f.length) phAdd(f, t) });
  document.addEventListener('DOMContentLoaded', () => document.body.appendChild(i)); if (document.body) document.body.appendChild(i);
  return i;
})();
function phPick(num, cam) { phFor = num; if (cam) phInput.setAttribute('capture', 'environment'); else phInput.removeAttribute('capture'); phInput.multiple = !cam; phInput.click() }
function phView(id, num) {
  const p = phList(num).find(x => x.id === id); if (!p) return;
  const d = document.createElement('div'); d.id = 'phv'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-label', 'Robot photo'); d.tabIndex = -1;
  d.innerHTML = `<img src="${p.img}" alt="Robot photo of team ${esc(p.team)}"><button class="p" type="button">Close</button>`;
  const end = () => { document.removeEventListener('keydown', key, true); d.remove() }, key = e => { if (e.key === 'Escape') { e.stopPropagation(); end() } };
  d.addEventListener('click', end); document.addEventListener('keydown', key, true); document.body.appendChild(d); d.querySelector('button').focus();
}
function photosInner(num) {
  const ph = phList(num), cur = PH[phKey(ev, num)], full = ph.length >= 3, t = esc(num);
  return `${ph.length ? `<div class="phgrid">${ph.map(p => `<div class="pht"><button type="button" class="phimg" data-act="phview" data-id="${esc(p.id)}" data-t="${t}" aria-label="View photo"><img src="${p.img}" alt="Robot photo of team ${t}" loading="lazy"></button>${p.wait ? '<span class="phwait">Waiting to send</span>' : `<button type="button" class="x" data-act="phdel" data-id="${esc(p.id)}" data-t="${t}" aria-label="Delete photo">×</button>`}</div>`).join('')}</div>` : `<p class="mut">${cur && cur.busy ? 'Loading photos…' : 'No photos yet.'}</p>`}
  <div class="foot"><button data-act="phgal" data-t="${t}" ${full ? 'disabled' : ''}>From gallery</button><button data-act="phcam" data-t="${t}" ${full ? 'disabled' : ''}>Take photo</button></div>`;
}
const photosNote = 'Up to 3 per team. Photos are kept for your 5 most recent events, then removed.';
// On a team's page: its own card. In the scouting form: a block inside the Robot section.
const photosCard = num => `<div class="card"><h2>Robot photos</h2><p class="mut">${photosNote}</p>${photosInner(num)}</div>`;
const photosField = num => `<div class="ff"><div class="lbl">Robot photos</div><div class="mut hint">Take a picture of their robot. ${photosNote}</div>${photosInner(num)}</div>`;

// Everything the VEX app shows for a team, for the whole season: skills, record, event history, awards.
function seasonCard(num) {
  const e = evObj(), d = stDoc(), s = d && d.teams && d.teams[num];
  if (!e || !e.reid) return `<div class="card"><h2>Season stats</h2><p class="mut">Skills scores, season record and awards come from VEX Events, so they need an event imported with its event code.</p></div>`;
  if (!d) return `<div class="card"><h2>Season stats</h2><p class="mut">${spec ? 'Not loaded yet.' : 'Not loaded yet. Open Event → Skills and tap <b>Load season stats</b>.'}</p></div>`;
  if (!s || s.err) return `<div class="card"><h2>Season stats</h2><p class="mut">${s ? 'VEX Events didn’t give us this team’s season. Try Refresh on the Skills page.' : 'No season data for this team (added by hand, or new this event).'}</p></div>`;
  const all = skillRows('season', 'c'), idx = all.findIndex(r => r.team === num), c = sumOf(s.d, s.p), got = all.filter(r => r.c != null).length;
  const hist = (s.ev || []).slice().reverse(), sh = (s.sh || []).slice().reverse();
  const here = id => id === e.reid ? ' <span class="pill">this event</span>' : '';
  return `<div class="card"><h2>Season stats</h2><p class="mut">${esc([s.loc, s.gr, s.rb ? 'Robot: ' + s.rb : ''].filter(Boolean).join(' · '))}${s.part ? ' · some data is missing, Refresh on the Skills page to retry' : ''}</p>
  <h3>Skills</h3>
  ${tiles([[fmt(c), 'Combined', c != null && idx >= 0 ? 'Rank ' + (idx + 1) + ' of ' + got + ' here' : ''], [fmt(s.d), 'Best driver', s.dAvg != null ? 'avg ' + fmt(s.dAvg) : ''], [fmt(s.p), 'Best auton', s.pAvg != null ? 'avg ' + fmt(s.pAvg) : '']])}
  ${sh.length ? `<div class="tblwrap"><table class="rk sm"><thead><tr><th>Event</th><th>Driver</th><th>Auton</th><th>Total</th></tr></thead><tbody>${sh.map(x => `<tr><td>${esc(x.n)}${here(x.id)}</td><td>${fmt(x.d)}${x.da ? ` <small>(${x.da} tries)</small>` : ''}</td><td>${fmt(x.p)}${x.pa ? ` <small>(${x.pa} tries)</small>` : ''}</td><td><b>${fmt(sumOf(x.d, x.p))}</b></td></tr>`).join('')}</tbody></table></div>` : '<p class="mut">No skills runs this season.</p>'}
  <h3>Season record</h3>
  ${s.played ? tiles([[s.w + '-' + s.l + '-' + s.t, 'W-L-T', pct(s.w, s.played) + ' wins'], [fmt(s.avg), 'Avg score', 'per match'], [fmt(s.hi), 'High score', ''], [(s.ev || []).length, 'Events', s.played + ' matches']]) : '<p class="mut">No qualification matches played this season.</p>'}
  ${hist.length ? `<div class="tblwrap"><table class="rk sm"><thead><tr><th>Event</th><th>Rank</th><th>W-L-T</th><th>Avg</th></tr></thead><tbody>${hist.map(x => `<tr><td>${esc(x.n)}${here(x.id)}</td><td>${x.rank ?? '–'}</td><td>${x.w}-${x.l}-${x.t}</td><td>${fmt(x.avg)}</td></tr>`).join('')}</tbody></table></div>` : ''}
  <h3>Awards</h3>${(s.aw || []).map(a => `<div class="award"><b>${esc(a[0])}</b>${a[1] ? `<div class="mut">${esc(a[1])}</div>` : ''}</div>`).join('') || '<p class="mut">No awards this season.</p>'}</div>`;
}

function vTeam(num) {
  const head = (title, sub, act) => `<div class="sheethead"><div class="grow"><h2>${title}</h2>${sub ? `<div class="mut">${sub}</div>` : ''}</div>${act || ''}<button data-act="close">Close</button></div>`;
  if (spec) { // spectators get the public side only: rank, season stats and matches. No scouting, notes or picklist.
    const t = teams().find(x => x.number === num) || { number: num, name: '', school: '' }, st = stats(), r = st.by.get(num), ms = matches().filter(m => m.red.includes(num) || m.blue.includes(num));
    return head(`<span class="num">${esc(num)}</span> ${esc(t.name)}`, esc(t.school)) +
      (r ? `<div class="card"><b>${st.official ? 'Rank' : 'Calculated rank'} ${r.rank ?? '–'}</b> · ${rec(r)} · WP ${r.wp ?? '–'}<div class="mut">OPR ${f1(r.opr)} · DPR ${f1(r.dpr)} · CCWM ${sgn(r.ccwm)}</div></div>` : '') + seasonCard(num) +
      `<div class="card"><h2>Matches</h2>${ms.map(m => `<span class="chip ${side(m, num) === 'ally' ? 'gn' : side(m, num) === 'opp' ? 'rd' : ''}">${esc(m.label)}</span>`).join('') || '<span class="mut">None</span>'}</div>`;
  }
  if (num === US) return head(`<span class="num">${esc(num)}</span> ${esc(tName(num) || 'Us')}`) + `<div class="card">That’s us. Scouting and team notes are turned off for our own team.</div>` + seasonCard(num);
  const t = teams().find(x => x.number === num) || { number: num, name: '', school: '' };
  const ms = matches().filter(m => m.red.includes(num) || m.blue.includes(num));
  const sc = notes('scout', num);
  const avg = f => { const v = sc.map(s => parseFloat(s[f])).filter(x => x > 0); return v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(1) : '-' };
  return head(`<span class="num">${esc(num)}</span> ${esc(t.name)}`, esc(t.school)) + `<button class="p wide" data-act="scoutfrom" data-t="${esc(num)}">Scout this team</button>
  ${(() => { const st = stats(), r = st.by.get(num); return r ? `<div class="card"><b>${st.official ? 'Rank' : 'Calculated rank'} ${r.rank ?? '–'}</b> · ${rec(r)} · WP ${r.wp ?? '–'}<div class="mut">OPR ${f1(r.opr)} · DPR ${f1(r.dpr)} · CCWM ${sgn(r.ccwm)}</div></div>` : '' })()}
  ${photosCard(num)}
  ${seasonCard(num)}
  <div class="card"><h2>Scouting averages</h2><p class="mut">From ${sc.length} ${sc.length === 1 ? 'entry' : 'entries'}. Ratings are out of 5.</p>${sc.length ? tiles([[avg('autoPts'), 'Auto points'], [avg('driver'), 'Driver skill'], [avg('speed'), 'Speed'], [avg('scoring'), 'Scoring'], [avg('scoreSpeed'), 'Scoring speed'], [(c => c === '-' ? c : c + ' s')(avg('cycleTime')), 'Cycle time'], [avg('durability'), 'Durability'], [avg('overall'), 'Overall'], [(v => v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(1) : '-')(sc.map(x => suggest(x)).filter(Boolean).map(g => g.avg)), 'Suggested overall', 'average of the ratings']]) : ''}</div>
  <div class="card"><h2>Matches</h2>${ms.map(m => `<span class="chip ${side(m, num) === 'ally' ? 'gn' : side(m, num) === 'opp' ? 'rd' : ''}">${esc(m.label)}</span>`).join('') || '<span class="mut">None</span>'}</div>
  <div class="card"><h2>Scouting entries</h2>${sc.map(s => sum(s)).join('') || '<span class="mut">None yet</span>'}${notes('team', num).length ? `<h3>Older quick notes</h3>${notes('team', num).map(noteRow).join('')}` : ''}<div class="foot">${sc.length ? `<button class="d" data-act="clearscout" data-t="${num}">Clear all scouting entries</button>` : ''}${notes('team', num).length ? `<button class="d" data-act="clearnotes" data-t="${num}">Clear older quick notes</button>` : ''}</div></div>
  <div class="card"><h2>Alliance requests</h2>${notes('req', num).map(n => `<div class="note">${esc(n.text)}</div>`).join('') || '<span class="mut">None</span>'}</div>
  ${t.id ? `<div class="foot"><button class="d" data-act="delteam" data-id="${t.id}">Remove team from this event</button></div>` : ''}`;
}

function vPick() {
  const e = evObj(); if (!e) return empty('Pick an event first.');
  const p = e.picks || [], avail = teams().filter(t => t.number !== US && !p.includes(t.number));
  return `<div class="card"><h2>Finals picklist</h2><p class="mut">Hold the ≡ handle and drag to reorder, or use the arrows. #1 is who we want most.</p><div id="pklist">${p.map((n, i) => `<div class="pk" data-i="${i}" data-flip="${esc(n)}"><span class="grip" title="Drag to reorder">≡</span><span class="num" style="width:34px;color:var(--accent-text)">${i + 1}</span><div style="flex:1;cursor:pointer" data-act="team" data-t="${n}"><span class="num">${n}</span>${esc(tName(n))}<div class="mut">${(r => r ? 'Rank ' + (r.rank ?? '–') + ' · OPR ' + f1(r.opr) + ' · ' : '')(stats().by.get(n))}${notes('req', n).length ? 'Asked to ally · ' : ''}${notes('scout', n).length} scouting entries</div></div><span class="arrows"><button data-act="pup" data-i="${i}" aria-label="Move up" ${i ? '' : 'disabled'}>▲</button><button data-act="pdn" data-i="${i}" aria-label="Move down" ${i < p.length - 1 ? '' : 'disabled'}>▼</button></span><button class="d x" data-act="prm" data-i="${i}" aria-label="Remove ${esc(n)}">×</button></div>`).join('') || empty('Nothing yet. Tap a team below to add it.')}</div></div>
  <div class="card"><h2>Alliance requests</h2><p class="mut">Teams that asked to ally with us, and what they say they’re good at.</p>
    <div class="row"><input id="rq_t" data-combo="teams" autocomplete="off" placeholder="Team #" class="narrow"><input id="rq_x" placeholder="Their strengths"><button data-act="addreq">Add</button></div>
    ${notes('req').map(n => `<div class="note ${fresh(n)}"><div class="ntext"><b>${esc(n.ref)}</b> ${esc(tName(n.ref))} — ${esc(n.text)}</div><small>${esc(n.by || '')}${p.includes(n.ref) ? '<span>· On the picklist</span>' : `<button class="link" data-act="addpick" data-t="${esc(n.ref)}">Add to picklist</button>`}<button class="d" data-act="delnote" data-id="${n.id}">Delete</button></small></div>`).join('')}</div>
  <div class="card"><h2>Still to pick</h2><p class="mut">Tap a team to add it to the list.</p>${avail.map(t => `<button class="chip pkc" data-act="addpick" data-t="${t.number}">${t.number}${t.name ? `<small>${esc(t.name)}</small>` : ''}</button>`).join('') || '<span class="mut">Every team is on the list.</span>'}</div>${tlist()}`;
}
const setPicks = p => upd('events', ev, { picks: p });

// ---------- our own pop-ups (instead of the browser's) ----------
// dd(): a button that looks like a dropdown and opens our menu. Team-number boxes get the same menu as suggestions.
// ask(): a confirm box. Both follow the theme, work with the keyboard and respect reduce-motion.
const DDS = {};
function dd(id, cur, options, o = {}) {
  DDS[id] = { options, f: o.f, value: o.value };
  const hit = options.find(x => x[0] === (cur || '')) || options[0], ph = !(cur || ''); 
  return `<button type="button" class="sel" id="${id}" data-act="dd" aria-haspopup="listbox" aria-expanded="false"${o.label ? ` aria-label="${esc(o.label)}"` : ''}><span class="sv ${ph && id !== 'evsel' ? 'ph' : ''}">${esc(hit ? hit[1] : '')}</span><span class="chev" aria-hidden="true">›</span></button>`;
}
let menuEl = null, menuFor = null, menuItems = [], menuAct = -1, menuPick = null, menuCombo = false;
function placeMenu() {
  if (!menuEl || !menuFor || !menuFor.isConnected) return closeMenu();
  const r = menuFor.getBoundingClientRect(), vh = innerHeight, below = vh - r.bottom - 12, above = r.top - 12, up = below < 180 && above > below;
  const mw = Math.min(innerWidth - 16, Math.max(r.width, menuCombo ? 220 : 0));
  menuEl.style.width = mw + 'px'; menuEl.style.left = Math.max(8, Math.min(r.left, innerWidth - mw - 8)) + 'px';
  menuEl.style.maxHeight = Math.max(120, Math.min(340, up ? above : below)) + 'px';
  if (up) { menuEl.style.top = ''; menuEl.style.bottom = (vh - r.top + 4) + 'px' } else { menuEl.style.bottom = ''; menuEl.style.top = (r.bottom + 4) + 'px' }
}
function showMenu(anchor, items, onPick, combo) {
  closeMenu(true);
  menuFor = anchor; menuItems = items; menuPick = onPick; menuCombo = combo; menuAct = Math.max(0, items.findIndex(x => x.sel));
  menuEl = document.createElement('div'); menuEl.id = 'menu'; menuEl.setAttribute('role', 'listbox');
  menuEl.innerHTML = items.map((x, i) => `<button type="button" role="option" tabindex="-1" class="mi ${x.sel ? 'on' : ''} ${x.dim ? 'dim' : ''}" data-act="mpick" data-i="${i}" aria-selected="${!!x.sel}">${x.html}</button>`).join('') || '<div class="mi none">No matches</div>';
  menuEl.addEventListener('mousedown', e => e.preventDefault()); // keep focus where it is (the text box, while typing)
  document.body.appendChild(menuEl); anchor.setAttribute('aria-expanded', 'true'); placeMenu(); markMenu(!combo);
}
function markMenu(focus) {
  if (!menuEl) return;
  menuEl.querySelectorAll('.mi[data-i]').forEach((b, i) => { b.classList.toggle('act', i === menuAct); if (i === menuAct) { b.scrollIntoView({ block: 'nearest' }); if (focus) b.focus({ preventScroll: true }) } });
}
function closeMenu(keepFocus) {
  if (!menuEl) return;
  const a = menuFor; menuEl.remove(); menuEl = menuFor = menuPick = null; menuItems = [];
  if (a) { a.setAttribute('aria-expanded', 'false'); if (!keepFocus && a.isConnected && a.tagName === 'BUTTON') a.focus({ preventScroll: true }) }
  if (!keepFocus && dirty) setTimeout(() => { if (dirty) render() }, 0);
}
function pickMenu(i) { const f = menuPick, x = menuItems[i]; if (!f || !x) return; closeMenu(); f(x.v, x) }
function openDd(b) {
  const d = DDS[b.id]; if (!d) return;
  const cur = d.value !== undefined ? d.value : (d.f ? (draft && draft[d.f]) : b.id === 'evsel' ? ev : b.id === 'scm' ? (draft && draft.match) : '') || '';
  showMenu(b, d.options.map(([v, l]) => ({ v, html: esc(l), sel: v === cur, dim: v === '' })), v => ddPick(b.id, v, d), false);
}
function ddPick(id, v, d) {
  d.value = v;
  if (id === 'evsel' && v === '+add') { tv = 'more'; ls('tv', tv); dState['d-more'] = true; render(); const el = $('#d-more'); if (el) el.scrollIntoView({ block: 'start' }) }
  else if (id === 'evsel') { ev = v; ls('ev', ev); render() }
  else if (id === 'mft') { mfT = v; ls('mft', mfT); render() }
  else if (id === 'scm') { flushDraft(); loadDraft(scTeam, v); render() }
  else if (id === 'ebcty') { EB.f.country = v; EB.f.region = ''; EB.f.city = ''; ebPaint() }
  else if (id === 'ebreg') { EB.f.region = v; EB.f.city = ''; if (v && !EB.f.country) EB.f.country = v.split('\u0001')[0]; ebPaint() }
  else if (id === 'ebcity' || id === 'eblvl' || id === 'ebwhen') { EB.f[{ ebcity: 'city', eblvl: 'level', ebwhen: 'when' }[id]] = v; ebPaint() }
  else if (d.f && draft && tab === 'scout') { draft[d.f] = v; saveDraft(0); const el = $('#' + id); if (el) { const hit = d.options.find(x => x[0] === v) || d.options[0]; el.querySelector('.sv').textContent = hit[1]; el.querySelector('.sv').classList.toggle('ph', !v) } }
}
// team suggestions for the number boxes in the manual forms
function comboOpen(inp) {
  const q = inp.value.trim().toLowerCase(), list = teams().filter(t => !q || (t.number + ' ' + t.name).toLowerCase().includes(q)).slice(0, 30);
  if (!list.length || (list.length === 1 && list[0].number.toLowerCase() === q)) return closeMenu(true);
  showMenu(inp, list.map(t => ({ v: t.number, html: `<b>${esc(t.number)}</b> <span class="mut">${esc(t.name)}</span>` })), v => { inp.value = v }, true);
}
document.addEventListener('pointerdown', e => { if (menuEl && !menuEl.contains(e.target) && e.target !== menuFor && !(menuFor && menuFor.contains(e.target))) closeMenu(true) }, true);
addEventListener('resize', placeMenu); addEventListener('scroll', () => { if (menuEl) placeMenu() }, true);
document.addEventListener('focusin', e => { if (e.target.dataset && e.target.dataset.combo) comboOpen(e.target) });
document.addEventListener('focusout', e => { if (menuCombo && e.target === menuFor) setTimeout(() => { if (menuFor === e.target && document.activeElement !== e.target) closeMenu(true) }, 120) });
document.addEventListener('keydown', e => {
  if (!menuEl) return;
  const n = menuItems.length;
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(menuCombo) }
  else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (n) { menuAct = (menuAct + (e.key === 'ArrowDown' ? 1 : -1) + n) % n; markMenu(!menuCombo) } }
  else if (e.key === 'Home' || e.key === 'End') { if (!menuCombo) { e.preventDefault(); menuAct = e.key === 'Home' ? 0 : n - 1; markMenu(true) } }
  else if (e.key === 'Enter') { if (n && (!menuCombo || menuAct >= 0)) { e.preventDefault(); pickMenu(menuAct) } }
  else if (e.key === 'Tab') closeMenu(true);
}, true);
document.addEventListener('input', e => { if (e.target.dataset && e.target.dataset.combo) { menuAct = 0; comboOpen(e.target) } });

function ask(title, msg, ok) {
  return new Promise(done => {
    const prev = document.activeElement, d = document.createElement('div'); d.id = 'dlg';
    d.innerHTML = `<div class="dbox" role="alertdialog" aria-modal="true" aria-labelledby="dlg_t" aria-describedby="dlg_m"><h2 id="dlg_t">${esc(title)}</h2><p class="mut" id="dlg_m">${esc(msg)}</p><div class="foot"><button type="button" data-r="0">Cancel</button><button type="button" class="dng" data-r="1">${esc(ok || 'Confirm')}</button></div></div>`;
    const end = r => { document.removeEventListener('keydown', key, true); const fin = () => { d.remove(); if (prev && prev.isConnected) prev.focus({ preventScroll: true }); done(r) }; if (reduced()) fin(); else { d.classList.add('closing'); setTimeout(fin, 160) } };
    const key = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); end(false) }
      else if (e.key === 'Tab') { const bs = [...d.querySelectorAll('button')], i = bs.indexOf(document.activeElement); e.preventDefault(); bs[(i + (e.shiftKey ? -1 : 1) + bs.length) % bs.length].focus() }
    };
    d.addEventListener('click', e => { if (e.target === d) end(false); else { const r = e.target.closest('[data-r]'); if (r) end(r.dataset.r === '1') } });
    document.addEventListener('keydown', key, true);
    document.body.appendChild(d); d.querySelector('[data-r="0"]').focus();
  });
}

// ---------- events ----------
function sure(b) {
  if (b.dataset.armed) return true;
  const t = b.textContent; b.dataset.armed = 1; b.classList.add('armed'); b.textContent = 'Tap again to confirm';
  setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.classList.remove('armed'); b.textContent = t } }, 3000);
  return false;
}
// Clipboard API needs https; on a plain-http preview (phone on the same wifi) fall back to the old copy command.
function copyText(t) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(t);
  return new Promise((ok, fail) => { const ta = document.createElement('textarea'); ta.value = t; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(ta); ta.select(); let done = false; try { done = document.execCommand('copy') } catch (e) {} ta.remove(); done ? ok() : fail() });
}
function doImport(text, say, after) {
  const sku = parseSku(text);
  if (!sku) { say('No event code found. Paste the code (like RE-V5RC-26-5068) or the event page link.'); return }
  say('Importing…');
  api('/import', { sku }).then(d => { ev = d.eventId; ls('ev', ev); if (after) after(); say(''); toast(`Imported ${d.teams} teams and ${d.matches} matches`); return pull() })
    .catch(e => say('Failed: ' + String(e.message || e).slice(0, 140)));
}
const sayIn = id => t => { const el = $('#' + id); if (el) el.textContent = t };
document.addEventListener('click', e => {
  if (e.target.id === 'modal') { closeModal(); return } // tap outside the team sheet
  const b = e.target.closest('[data-act]'); if (!b) return;
  if (b.dataset.act === 'dd') { if (menuFor === b) closeMenu(); else openDd(b); return }
  if (b.dataset.act === 'mpick') { pickMenu(+b.dataset.i); return }
  const a = b.dataset.act, v = id => $('#' + id)?.value?.trim() || '';
  const me = name || 'Someone';
  segClicked = b.closest('.seg[data-seg]') ? b.closest('.seg[data-seg]').dataset.seg : null;
  if (a === 'tab') { flushDraft(); const o = TABS.findIndex(t => t[0] === tab), n = TABS.findIndex(t => t[0] === b.dataset.v); navAnim = n > o ? 'fwd' : n < o ? 'back' : ''; tab = b.dataset.v; ls('tab', tab); render(); scrollTo({ top: 0, behavior: 'instant' }) }
  else if (a === 'login') {
    const t = norm(v('w_team')), c = $('#codein').value.trim();
    if (!t || !c) { loginErr = 'Enter your team number and team code.'; render(); return }
    const prevTeam = team, prevCode = code; team = t; code = c; spec = false; loginErr = false; wbusy = true; render();
    api('/login', {}).then(d => { wbusy = false; useTeam(t, d.team); ls('code', c); ls('spec', ''); online = true; render(); return flush().then(pull) }).then(schedule)
      .catch(e => { wbusy = false; code = ''; team = prevTeam; if (e instanceof NetErr) loginErr = 'Can’t reach Recon. Check your connection.'; else if (!(e instanceof AuthErr)) loginErr = e.message; render() });
  }
  else if (a === 'spectate') {
    const t = norm(v('w_spec')); if (!t) { loginErr = 'Enter the team number you want to watch.'; render(); return }
    const prevTeam = team; team = t; spec = true; code = ''; loginErr = false; wbusy = true; render();
    api('/login', {}).then(d => { wbusy = false; useTeam(t, d.team); ls('spec', '1'); ls('code', ''); online = true; render(); return pull() }).then(schedule)
      .catch(e => { wbusy = false; spec = false; team = prevTeam; loginErr = e instanceof NetErr ? 'Can’t reach Recon. Check your connection.' : e.message; render() });
  }
  else if (a === 'unwatch') { spec = false; ls('spec', ''); lsJ('cache', null); for (const k of COLS) S[k] = []; ev = ''; ls('ev', ''); lastV = -1; loaded = false; EB.list = null; mTeam = null; wmode = 'spectate'; schedule(); render(); setStatus() }
  else if (a === 'specset') { const on = b.dataset.v === '1'; SPEC_ON = on; render(); api('/spectators', { on }).then(() => toast(on ? 'Spectators can watch your team again' : 'Spectator mode is off for your team')).catch(e => { SPEC_ON = !on; render(); toast('Couldn’t change that: ' + e.message) }) }
  else if (a === 'wmode') { wmode = b.dataset.v; ls('wmode', wmode); loginErr = false; render() }
  else if (a === 'wlookup') {
    const t = norm(v('w_new')); if (!t) return; wbusy = true; loginErr = false; render();
    api('/lookup', { team: t }).then(d => { wlook = d; }).catch(e => { wlook = null; loginErr = e instanceof NetErr ? 'Can’t reach Recon. Check your connection.' : e.message }).finally(() => { wbusy = false; render() });
  }
  else if (a === 'wregister') {
    wbusy = true; loginErr = false; render();
    api('/register', { team: wlook.team.number }).then(d => { wcreated = d; wlook = null }).catch(e => { loginErr = e instanceof NetErr ? 'Can’t reach Recon. Check your connection.' : e.message }).finally(() => { wbusy = false; render() });
  }
  else if (a === 'wcopy') copyText(wcreated.code).then(() => toast('Team code copied'), () => toast('Couldn’t copy – write it down'));
  else if (a === 'wdone') { const w = wcreated; wcreated = null; useTeam(w.team.number, w.team); code = w.code; ls('code', code); wmode = 'join'; online = true; render(); flush().then(pull).then(schedule) }
  else if (a === 'rotate') { if (sure(b)) api('/rotate', {}).then(d => { code = d.code; ls('code', code); render(); const c = $('#codeval'); if (c) { c.textContent = code; c.dataset.shown = '1' } toast('New team code: ' + code + '. The old one no longer works, so share this one.') }).catch(e => toast('Couldn’t make a new code: ' + e.message)) }
  else if (a === 'install') { if (installEvt) { installEvt.prompt(); installEvt.userChoice.finally(() => { installEvt = null; render() }) } }
  else if (a === 'about') { mTeam = ':about'; render() }
  else if (a === 'changes') { mTeam = ':changes'; render() }
  else if (a === 'addname') {
    const n = v('myname').replace(/\s+/g, ' ').slice(0, 30); if (!n) return;
    if (!NAMES.includes(n)) put('config', 'main', { ...cfg(), names: [...NAMES, n] });
    name = n; ls('name', name); $('#myname').value = ''; $('#myname').blur(); render();
  }
  else if (a === 'peek') { const i = $('#codein'), show = i.type === 'password'; i.type = show ? 'text' : 'password'; b.setAttribute('aria-pressed', show); b.setAttribute('aria-label', show ? 'Hide code' : 'Show code'); b.innerHTML = show ? EYE_OFF : EYE; i.focus() }
  else if (a === 'showcode') { const c = $('#codeval'), show = c.dataset.shown !== '1'; c.dataset.shown = show ? '1' : '0'; c.textContent = show ? code : '•'.repeat(Math.max(6, code.length)); b.textContent = show ? 'Hide' : 'Show'; b.setAttribute('aria-pressed', show) }
  else if (a === 'copycode') copyText(code).then(() => toast('Team code copied'), () => toast('Couldn’t copy – tap Show and copy it by hand'));
  else if (a === 'logout') {
    const n = outbox.length, unsent = n ? n + (n === 1 ? ' change hasn’t' : ' changes haven’t') + ' been sent yet and will be lost. ' : '';
    ask('Log out of this device?', unsent + 'To get back in you need the team number and the team code (' + code + '). Make sure you have the code saved before you log out.', 'Log out').then(ok => { if (!ok) return; code = ''; ls('code', ''); spec = false; ls('spec', ''); outbox = []; lsJ('outbox', []); lsJ('cache', null); for (const k of COLS) S[k] = []; lastV = -1; loaded = false; rkShown = ''; RK = null; EB.list = null; schedule(); render(); setStatus() })
  }
  else if (a === 'ebscope') { EB.scope = b.dataset.v; ls('ebs', EB.scope); EB.msg = ''; EB.f.when = ''; clearTimeout(ebT); ebLoad(); render() }
  else if (a === 'ebfopen') {
    // the panel eases open and closed (height + fade); with reduce-motion it just appears. Closing keeps its end state ('forwards') so it doesn't spring back to full height for a frame before it's removed.
    const cur = $('.ebpanel'), go = (el, from, to, done) => { const cs = getComputedStyle(el), h = el.offsetHeight, pt = cs.paddingTop, pb = cs.paddingBottom, k = { height: h + 'px', paddingTop: pt, paddingBottom: pb, opacity: 1 }, z = { height: '0px', paddingTop: '0px', paddingBottom: '0px', opacity: 0 };
      el.style.overflow = 'hidden'; const an = el.animate(from ? [z, k] : [k, z], { duration: 260, easing: 'cubic-bezier(.2,.7,.2,1)', fill: from ? 'none' : 'forwards' }); an.onfinish = () => { el.style.overflow = ''; if (done) done() } };
    if (EB.fo && cur && !reduced()) { EB.fo = false; go(cur, false, 0, ebPaint) }
    else { EB.fo = !EB.fo; ebPaint(); const el = $('.ebpanel'); if (el && !reduced()) go(el, true) }
  }
  else if (a === 'ebclr') { const k = b.dataset.k; EB.f[k] = ''; if (k === 'country') { EB.f.region = ''; EB.f.city = '' } if (k === 'region') EB.f.city = ''; ebPaint() }
  else if (a === 'ebhide') { EB.f.hide = !EB.f.hide; ebPaint() }
  else if (a === 'ebreset') { EB.f = { country: '', region: '', city: '', level: '', when: '', hide: false }; ebPaint() }
  else if (a === 'evadd') { b.disabled = true; doImport(b.dataset.sku, t => { EB.msg = t === 'Importing…' ? 'Adding ' + b.dataset.sku + '…' : t; ebPaint() }, () => { tv = 'list'; ls('tv', tv) }) }
  else if (a === 'evopen') { const id = String(b.dataset.sku).toLowerCase(); if (S.events.some(x => x.id === id)) { ev = id; ls('ev', ev); tv = 'list'; ls('tv', tv); render() } }
  else if (a === 'rcgo') {
    const t = norm(v('w_rc')), k = v('w_rk'); if (!t || !k) { loginErr = 'Enter your team number and recovery key.'; render(); return }
    wbusy = true; loginErr = false; render();
    api('/recover', { team: t, key: k }).then(d => { wcreated = { team: d.team, code: d.code, recovered: true } })
      .catch(e => { loginErr = e instanceof NetErr ? 'Can’t reach Recon. Check your connection.' : e.message }).finally(() => { wbusy = false; render() });
  }
  else if (a === 'rkmake') { if (RK === false || sure(b)) api('/recovery-key', {}).then(d => { RK = true; rkShown = d.key; render() }).catch(e => toast('Couldn’t make a recovery key: ' + e.message)) }
  else if (a === 'rkcopy') copyText(rkShown).then(() => toast('Recovery key copied'), () => toast('Couldn’t copy – write it down'));
  else if (a === 'rkdone') { rkShown = ''; render() }
  else if (a === 'wcopykey') copyText(wcreated.recoveryKey).then(() => toast('Recovery key copied'), () => toast('Couldn’t copy – write it down'));
  else if (a === 'import') doImport(v('sku'), sayIn('impmsg'));
  else if (a === 'reimport') { if (spec) { const s = skuOf(evObj()), say = sayIn('impmsg2'); say('Checking…'); api('/import', { sku: s, light: true }).then(() => pull()).then(() => say('')).catch(e => say('Couldn’t check: ' + String(e.message || e).slice(0, 100))) } else doImport(skuOf(evObj()), sayIn('impmsg2')) }
  else if (a === 'team') { mTeam = b.dataset.t; render() }
  else if (a === 'mnames') { mnames = !mnames; ls('mnames', mnames ? '1' : '0'); render() }
  else if (a === 'agedit') { agEdit = !agEdit; render() }
  else if (a === 'agadd') {
    const d = v('ag_d'), t = v('ag_t'), x = v('ag_x'), n = v('ag_n'), e = evObj(), cur = Array.isArray(e.agenda) ? e.agenda : [];
    if (!d || !t || !x) { toast('Add a day, a time and what happens.'); return }
    if (cur.length >= 60) { toast('The agenda is full. Delete something first.'); return }
    upd('events', ev, { agenda: [...cur, { id: uid(), d, t, x, ...(n ? { n } : {}) }] });
  }
  else if (a === 'agdel') { const e = evObj(); upd('events', ev, { agenda: (e.agenda || []).filter(i => i.id !== b.dataset.id) }) }
  else if (a === 'phcam') phPick(b.dataset.t, true)
  else if (a === 'phgal') phPick(b.dataset.t, false)
  else if (a === 'phview') phView(b.dataset.id, b.dataset.t)
  else if (a === 'phdel') {
    const id = b.dataset.id, t = b.dataset.t;
    ask('Delete this photo?', 'It is removed for everyone on your team.', 'Delete').then(async ok => {
      if (!ok) return;
      try { await api('/photo', { mode: 'delete', id }); const e = PH[phKey(ev, t)]; if (e) e.list = e.list.filter(x => x.id !== id); render() }
      catch (err) { toast(err instanceof NetErr ? 'You need a connection to delete a photo.' : 'Couldn’t delete: ' + err.message) }
    });
  }
  else if (a === 'close') closeModal();
  else if (a === 'addev') { const n = v('newev'); if (n) { const id = uid(); put('events', id, { name: n, link: '', picks: [] }); ev = id; ls('ev', id) } }
  else if (a === 'delev') { if (sure(b)) { send({ purge: ev }); ev = S.events[0] ? S.events[0].id : ''; ls('ev', ev) } }
  else if (a === 'delname') {
    if (!sure(b)) return; const n = b.dataset.v;
    put('config', 'main', { ...cfg(), names: NAMES.filter(x => x !== n) });
    if (name === n) { flushDraft(); scTeam = ''; draft = null; name = ''; ls('name', '') }
    toast(n + ' was removed from the team'); render();
  }
  else if (a === 'addscout') { const n = v('newscout').replace(/\s+/g, ' ').slice(0, 30); if (!n) return; if (!NAMES.includes(n)) put('config', 'main', { ...cfg(), names: [...NAMES, n] }); toast(n + ' was added'); const i = $('#newscout'); i.value = ''; i.blur(); render() }
  else if (a === 'savecfg') { const names = [...new Set(v('cfg_names').split(',').map(s => s.trim()).filter(Boolean))]; put('config', 'main', { ...cfg(), names }); toast('Names saved') }
  else if (a === 'addteam') { const n = norm(v('t_n')); if (n) put('teams', ev + '_' + n, { eventId: ev, number: n, name: v('t_name'), school: v('t_s') }) }
  else if (a === 'delteam') { if (sure(b)) { del('teams', b.dataset.id); closeModal() } }
  else if (a === 'addmatch') {
    const r = ['m_r1', 'm_r2'].map(i => norm(v(i))).filter(Boolean), bl = ['m_b1', 'm_b2'].map(i => norm(v(i))).filter(Boolean);
    if (v('m_l') && (r.length || bl.length)) put('matches', uid(), { eventId: ev, label: v('m_l'), order: +v('m_o') || matches().length + 1, red: r, blue: bl })
  }
  else if (a === 'delmatch') { if (sure(b)) del('matches', b.dataset.id) }
  else if (a === 'mopen') { const id = b.dataset.id; open[id] = !open[id]; justOpened = open[id] ? id : null; render() }
  else if (a === 'sfilter') { sf = b.dataset.v; ls('sf', sf); navAnim = 'seg'; render() }
  else if (a === 'mfilter') { mf = b.dataset.v; ls('mf', mf); navAnim = 'seg'; render() }
  else if (a === 'gorank') { tab = 'event'; ls('tab', tab); tv = 'rank'; ls('tv', tv); navAnim = 'fwd'; render(); const r = document.querySelector('#app tr.us'); if (r) setTimeout(() => { r.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'center' }); flash(r) }, 120) }
  else if (a === 'gomatch') { const id = b.dataset.id; tab = 'matches'; ls('tab', tab); mf = 'ours'; ls('mf', mf); open[id] = true; justOpened = id; navAnim = 'fwd'; render(); const c = document.querySelector(`#app .mhead[data-id="${id}"]`); if (c) setTimeout(() => { c.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' }); flash(c.closest('.card')) }, 120) }
  else if (a === 'tview') { tv = b.dataset.v; ls('tv', tv); navAnim = 'seg'; render() }
  else if (a === 'rksort') { rks = b.dataset.v; ls('rks', rks); render() }
  else if (a === 'sksope') { sks = b.dataset.v; ls('sks', sks); render() }
  else if (a === 'sksort') { sko = b.dataset.v; ls('sko', sko); render() }
  else if (a === 'refstats') refreshStats(true);
  else if (a === 'addnote') {
    const ta = $('#' + b.dataset.in), t = ta.value.trim();
    if (t && !(b.dataset.kind === 'team' && b.dataset.ref === US)) put('notes', uid(), { eventId: ev, kind: b.dataset.kind, ref: b.dataset.ref, sec: b.dataset.sec, text: t, by: me, ts: Date.now() });
    delete drafts[ta.dataset.draft]; ta.value = ''; ta.closest('.composer').classList.remove('has');
  }
  else if (a === 'delnote') { if (sure(b)) del('notes', b.dataset.id) }
  else if (a === 'addreq') { const t = norm(v('rq_t')); if (t && t !== US && v('rq_x')) put('notes', uid(), { eventId: ev, kind: 'req', ref: t, text: v('rq_x'), by: me, ts: Date.now() }) }
  else if (a === 'clearnotes') { if (sure(b)) notes('team', b.dataset.t).forEach(n => del('notes', n.id)) }
  else if (a === 'clearscout') { if (sure(b)) { notes('scout', b.dataset.t).forEach(n => del('notes', n.id)); if (scTeam === b.dataset.t) { saveT = null; draft = null; scTeam = '' } } }
  else if (a === 'clearmatch') { if (sure(b)) notes('match', b.dataset.id).forEach(n => del('notes', n.id)) }
  else if (a === 'claim') { const t = b.dataset.t; if (name && t) put('notes', claimId(t), { eventId: ev, kind: 'claim', ref: t, by: name, ts: Date.now() }) }
  else if (a === 'unclaim') { del('notes', claimId(b.dataset.t)) }
  else if (a === 'startscout') { if (!name || b.dataset.t === US) return; flushDraft(); scTeam = b.dataset.t; loadDraft(scTeam, ''); navAnim = 'fwd'; render() }
  else if (a === 'scoutfrom') { const t = b.dataset.t; flushDraft(); mTeam = null; tab = 'scout'; ls('tab', tab); if (name && t !== US) { scTeam = t; loadDraft(t, '') } else { scTeam = ''; draft = null } render() }
  else if (a === 'donescout') { flushDraft(); scTeam = ''; draft = null; navAnim = 'back'; render() }
  else if (a === 'resetdraft') { if (sure(b)) { draft = { ...newDraft(scTeam, draft.match), id: draft.id }; saveDraft(0); lastView = ''; render() } }
  else if (a === 'setname') { flushDraft(); scTeam = ''; draft = null; name = b.dataset.v; ls('name', name); render() }
  else if (a === 'theme') { ls('theme', (ls('theme') || osTheme()) === 'dark' ? 'light' : 'dark'); applyTheme() }
  else if (a === 'rate') { // update in place so the choice eases across instead of the whole form redrawing
    const f = b.dataset.f; draft[f] = draft[f] == +b.dataset.v ? 0 : +b.dataset.v;
    b.parentElement.querySelectorAll('button').forEach(x => { const on = +x.dataset.v === draft[f]; x.classList.toggle('on', on); x.setAttribute('aria-pressed', on) });
    saveDraft(0); const sg = $('#sugg'); if (sg) sg.innerHTML = suggestHTML(draft);
  }
  else if (a === 'usesuggest') {
    const g = suggest(draft); if (!g) return; draft.overall = Math.round(g.avg);
    document.querySelectorAll('#app [data-act="rate"][data-f="overall"]').forEach(x => { const on = +x.dataset.v === draft.overall; x.classList.toggle('on', on); x.setAttribute('aria-pressed', on) });
    saveDraft(0); $('#sugg').innerHTML = suggestHTML(draft);
  }
  else if (a === 'addpick') { const n = b.dataset.t; const p = evObj().picks || []; if (n && !p.includes(n)) setPicks([...p, n]) }
  else if (a === 'pup' || a === 'pdn') { const p = [...evObj().picks], i = +b.dataset.i, j = a === 'pup' ? i - 1 : i + 1; if (j >= 0 && j < p.length) { [p[i], p[j]] = [p[j], p[i]]; setPicks(p) } }
  else if (a === 'prm') { const p = [...evObj().picks]; p.splice(+b.dataset.i, 1); setPicks(p) }
});
let linkT;
document.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.f && draft && tab === 'scout') { draft[t.dataset.f] = t.value; saveDraft() }
  else if (t.dataset.draft) { drafts[t.dataset.draft] = t.value; t.closest('.composer').classList.toggle('has', !!t.value.trim()) }
  else if (t.id === 'tsearch') { tq = t.value; filt(tq) }
  else if (t.id === 'ebq') { EB.q = t.value; clearTimeout(ebT); ebT = setTimeout(ebLoad, 350) }
  else if (t.id === 'evlink') { const id = ev, val = t.value.trim(); clearTimeout(linkT); linkT = setTimeout(() => upd('events', id, { link: val }), 600) }
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'w_saved') { const b = document.querySelector('[data-act=wdone]'); if (b) b.disabled = !t.checked; return }
  if (t.dataset.f && draft && tab === 'scout') { draft[t.dataset.f] = t.value; saveDraft(0) }
});
document.addEventListener('focusout', () => setTimeout(() => { if (dirty) render() }, 150));

// Picklist drag: the row follows your finger and the others slide aside live to open the gap where it would land.
document.addEventListener('pointerdown', e => {
  const g = e.target.closest('.grip'); if (!g) return; e.preventDefault();
  const row = g.closest('.pk'), rows = [...document.querySelectorAll('#pklist .pk')], from = +row.dataset.i, y0 = e.clientY;
  const rc = rows.map(r => r.getBoundingClientRect()), mids = rc.map(b => b.top + b.height / 2), gap = rows.length > 1 ? rc[1].top - rc[0].bottom : 0;
  // how far each row has to travel for the dragged one to sit at index `to`
  const slots = to => { const order = rows.map((_, i) => i).filter(i => i !== from); order.splice(to, 0, from); const o = []; let y = rc[0].top; order.forEach(i => { o[i] = y - rc[i].top; y += rc[i].height + gap }); return o };
  const idx = y => { let to = 0; mids.forEach((m, i) => { if (i !== from && m < y) to++ }); return to };
  let cur = from; dragging = true; row.classList.add('drag'); rows.forEach((r, i) => { if (i !== from) r.classList.add('shift') });
  try { g.setPointerCapture(e.pointerId) } catch (_) {}
  const shift = to => { const o = slots(to); rows.forEach((r, i) => { if (i !== from) r.style.transform = o[i] ? `translateY(${o[i]}px)` : '' }) };
  const mv = m => { const dy = m.clientY - y0; row.style.transform = `translateY(${dy}px) scale(1.02)`; const to = idx(mids[from] + dy); if (to !== cur) { cur = to; shift(to); if (navigator.vibrate) try { navigator.vibrate(6) } catch (_) {} } };
  const up = u => {
    g.removeEventListener('pointermove', mv); g.removeEventListener('pointerup', up); g.removeEventListener('pointercancel', up);
    const to = u.type === 'pointercancel' ? from : idx(mids[from] + (u.clientY - y0)), o = slots(to);
    shift(to); row.classList.add('settle'); row.style.transform = `translateY(${o[from]}px)`; // the dragged row glides into its slot
    // everything already sits where the new order puts it, so the redraw after the save doesn't move anything again
    setTimeout(() => {
      dragging = false;
      if (to !== from) { const p = [...evObj().picks]; p.splice(to, 0, p.splice(from, 1)[0]); setPicks(p) }
      else rows.forEach(r => { r.classList.remove('drag', 'shift', 'settle'); r.style.transform = '' });
      if (dirty) render()
    }, reduced() ? 0 : 210);
  };
  g.addEventListener('pointermove', mv); g.addEventListener('pointerup', up); g.addEventListener('pointercancel', up)
});
document.addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('.tap[role=button]')) { e.preventDefault(); e.target.click(); return }
  if (e.key !== 'Enter') return;
  const go = { codein: 'login', w_team: 'login', w_spec: 'spectate', w_new: 'wlookup', w_rc: 'rcgo', w_rk: 'rcgo', myname: 'addname', newscout: 'addscout' }[e.target.id];
  if (go) { e.preventDefault(); document.querySelector(`[data-act=${go}]`)?.click() }
});
document.addEventListener('visibilitychange', () => { if (document.hidden) flushDraft(); else if (signedIn()) { flush(); pull() } });
window.addEventListener('online', () => { if (signedIn()) { online = true; flush().then(pull) } });
window.addEventListener('offline', () => { online = false; setStatus() });
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('/sw.js').catch(() => {});
applyTheme(); init();
