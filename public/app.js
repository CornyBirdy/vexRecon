'use strict';
// Invictus scouting – client.
// Data lives on the server (netlify/functions/api.mjs). Every change is applied locally straight away,
// queued in an outbox (kept in localStorage) and sent when there is a connection, so the app keeps
// working on bad venue wifi. The last downloaded state is cached so the app also opens offline.

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ls = (k, v) => { try { if (v === undefined) return localStorage.getItem(k) || ''; localStorage.setItem(k, v) } catch (e) { return '' } };
const lsJ = (k, v) => { try { if (v === undefined) return JSON.parse(localStorage.getItem(k) || 'null'); localStorage.setItem(k, JSON.stringify(v)) } catch (e) { return null } };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const norm = s => String(s || '').trim().toUpperCase().replace(/\s+/g, '');
const slug = x => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Defaults until the team saves its own in Settings (Event tab).
const DEFAULT_US = '52111A', DEFAULT_NAMES = ['Charlie', 'Oscar', 'Aidin', 'Seb', 'J-Pup'];
let US = DEFAULT_US, NAMES = DEFAULT_NAMES;
const COLS = ['events', 'teams', 'matches', 'notes', 'config', 'rankings', 'stats'];
let S = { events: [], teams: [], matches: [], notes: [], config: [], rankings: [], stats: [] };
let ev = ls('ev'), tab = ls('tab') || 'event', name = ls('name'), mf = ls('mf') || 'ours', tv = ls('tv') || 'list', rks = ls('rks') || 'rank', sks = ls('sks') || 'season', sko = ls('sko') || 'c';
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
const myScouts = t => { const b = scoutBase(t, name); return S.notes.filter(n => n.kind === 'scout' && (n.id === b || n.id.startsWith(b + '_'))) };

// ---------- sync ----------
const NOTE_MS = 3000, RE_MS = 15000; // how often to check for teammates' changes / VEX Events (milliseconds)
const API = '/api';
class NetErr extends Error {}
class AuthErr extends Error {}
let code = ls('code'), pollT, impT, lastV = -1, loginErr = false, online = true, lastSync = 0;
let outbox = lsJ('outbox') || [], inflight = null, flushing = false, polling = false, syncing = false, editSeq = 0;
const skuOf = e => (e && e.sku) || ((e && e.link || '').match(/RE-[A-Z0-9]+-\d+-\d+/) || [])[0] || '';

async function api(path, body) {
  let r;
  try { r = await fetch(API + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'x-code': code }, body: body ? JSON.stringify(body) : undefined }) }
  catch (e) { throw new NetErr('No connection') }
  if (r.status === 401) { code = ''; ls('code', ''); loginErr = true; render(); throw new AuthErr('Wrong code') }
  const j = await r.json().catch(() => ({}));
  if (r.status >= 500) throw new NetErr(j.error || ('Server error ' + r.status));
  if (!r.ok) throw new Error(j.error || ('Error ' + r.status));
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
function send(o, quiet) { editSeq++; applyOp(o); queue(o); cacheState(); setStatus(); flush(); if (!quiet) setTimeout(render, 0) }
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
  } finally { inflight = null; flushing = false; setStatus() }
}

async function pull() {
  const seq = editSeq;
  try {
    const d = await api('/state');
    for (const k of COLS) S[k] = d[k] || [];
    for (const o of outbox) applyOp(o); // keep changes that haven't reached the server yet
    lastV = seq === editSeq ? d.v : -1; // something changed while downloading: fetch again next poll
    online = true; loaded = true; lastSync = Date.now();
    if (!ev && S.events.length) ev = S.events[0].id;
    cacheState(); setStatus(); render();
  } catch (e) { if (e instanceof NetErr) { online = false; setStatus() } }
}

async function poll() {
  if (polling || document.hidden || !code) return; polling = true;
  try {
    if (outbox.length) await flush();
    const d = await api('/version'); online = true;
    if (d.v !== lastV) await pull(); else { lastSync = Date.now(); setStatus() }
  } catch (e) { if (e instanceof NetErr) { online = false; setStatus() } }
  finally { polling = false }
}
function syncRE() {
  const s = skuOf(evObj()); if (!s || syncing || document.hidden || !online) return;
  syncing = true; api('/import', { sku: s, light: true }).catch(() => {}).finally(() => { syncing = false });
  // season stats are heavy (a few requests per team): load once, then again only when they're 6 hours old
  if (evObj().reid && statsAge() > 6 * 3600e3 && Date.now() - statsFailAt > 5 * 60e3) refreshStats(false);
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
function schedule() { clearInterval(pollT); clearInterval(impT); if (code) { pollT = setInterval(poll, NOTE_MS); impT = setInterval(syncRE, RE_MS) } }

function setStatus() {
  const el = $('#sync'); if (!el) return;
  const n = outbox.length, unsaved = n + ' unsaved';
  el.textContent = !code ? '' : !online ? (n ? 'Offline · ' + unsaved : 'Offline') : n ? 'Saving…' : lastSync ? 'Synced ' + new Date(lastSync).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '…';
  el.className = !online ? 'off' : n ? 'busy' : '';
  el.title = !online ? 'No connection. Your changes are kept on this device and sent when you’re back online.' : '';
}
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 5000) }

const EYE = '<svg viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24"><path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.9 8.4 2 12 2 12s3.5 7 10 7c1.8 0 3.4-.5 4.7-1.3M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';
const loginHTML = () => `<div class="card login"><h2>Team code</h2><p class="mut">Enter the team code to open Invictus scouting.</p><div class="pw"><input id="codein" type="password" autocomplete="current-password" placeholder="Team code" aria-label="Team code"><button type="button" class="icon" data-act="peek" aria-label="Show code" aria-pressed="false">${EYE}</button></div>${loginErr ? '<p class="err">That code didn’t work.</p>' : ''}<button class="p wide" data-act="login">Open</button></div>`;

async function init() {
  const c = lsJ('cache');
  if (code && c && c.S) { for (const k of COLS) S[k] = c.S[k] || []; for (const o of outbox) applyOp(o); lastSync = c.t || 0; loaded = true; if (!ev && S.events.length) ev = S.events[0].id }
  render(); setStatus();
  if (code) { await flush(); await pull(); schedule(); syncRE() }
}

// ---------- views ----------
const SUN = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/></svg>', MOON = '<svg viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>';
function applyTheme() { const t = ls('theme') || 'light'; document.documentElement.dataset.theme = t; $('#theme').innerHTML = t === 'dark' ? SUN : MOON }
const TABS = [
  ['event', '<svg viewBox="0 0 24 24"><path d="M5 21V4M5 4h11l-2 4 2 4H5"/></svg>', 'Event'],
  ['matches', '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12" rx="3"/><path d="M12 6v12M8 12h.01M16 12h.01"/></svg>', 'Matches'],
  ['scout', '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l5 5"/></svg>', 'Scout'],
  ['pick', '<svg viewBox="0 0 24 24"><path d="M7 4h10v4a5 5 0 0 1-10 0zM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3M12 13v4M8 21h8M10 17h4"/></svg>', 'Picklist']];

let dragging = false;
// ---------- rendering + motion ----------
// The whole view is re-rendered from state. To keep motion calm, animations only play on real changes:
// a new view fades in, rows that moved glide to their new place (FLIP), a newly opened section slides open,
// notes that weren't on screen before fade in, and the team sheet slides up. Nothing moves with reduce-motion on.
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
let lastView = '', modalShown = false, justOpened = null, seenNotes = null, renderedAt = 0, tq = '';
const viewKey = () => [ev, tab, tab === 'event' ? tv : '', tab === 'matches' ? mf : '', tab === 'scout' && draft ? draft.id : '', name ? 1 : 0].join('|');
function flipCapture() { const m = new Map(); document.querySelectorAll('#app [data-flip]').forEach(e => m.set(e.dataset.flip, e.getBoundingClientRect().top)); return m }
function flipPlay(m) {
  if (reduced()) return;
  document.querySelectorAll('#app [data-flip]').forEach(e => { const t = m.get(e.dataset.flip); if (t == null) return; const dy = t - e.getBoundingClientRect().top; if (Math.abs(dy) > 1) e.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.2,.7,.2,1)' }) });
}
function replay(el, c) { el.classList.remove(c); void el.offsetWidth; el.classList.add(c) }
const fresh = n => seenNotes && !seenNotes.has(n.id) ? 'fresh' : '';

function render() {
  if (dragging) { dirty = true; return }
  if (!code) { $('#nav').innerHTML = ''; $('#app').innerHTML = loginHTML(); $('#evname').textContent = 'Team login'; lastView = ''; return }
  if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { dirty = true; return }
  dirty = false;
  US = norm(cfg().us) || DEFAULT_US;
  NAMES = Array.isArray(cfg().names) && cfg().names.length ? cfg().names : DEFAULT_NAMES;
  if (loaded && name && !NAMES.includes(name)) { name = ''; ls('name', '') }
  $('#evname').textContent = evObj() ? evObj().name : 'Choose an event to start';
  // the tab bar is built once and only its classes change, so the selected tab can ease across
  const nav = $('#nav');
  if (!nav.children.length) nav.innerHTML = TABS.map(t => `<button data-act="tab" data-v="${t[0]}">${t[1]}<span>${t[2]}</span></button>`).join('');
  nav.querySelectorAll('button').forEach(b => { const on = b.dataset.v === tab; b.classList.toggle('on', on); b.setAttribute('aria-current', on ? 'page' : 'false') });
  const key = viewKey(), same = key === lastView, before = same ? flipCapture() : null, y = scrollY;
  $('#app').innerHTML = ({ event: vEvent, matches: vMatches, scout: vScout, pick: vPick })[tab]();
  scrollTo(0, same ? y : 0);
  if (same) flipPlay(before); else if (lastView && !reduced()) replay($('#app'), 'enter');
  lastView = key; justOpened = null;
  const md = $('#modal');
  $('#mbody').innerHTML = mTeam ? vTeam(mTeam) : '';
  if (mTeam && !modalShown) { md.style.display = 'block'; if (!reduced()) replay(md, 'opening') }
  else if (!mTeam) md.style.display = 'none';
  modalShown = !!mTeam;
  seenNotes = new Set(S.notes.map(n => n.id));
  renderedAt = performance.now();
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

const evSelect = () => `<select id="evsel" aria-label="Event"><option value="">— choose event —</option>${S.events.map(x => `<option value="${x.id}" ${x.id === ev ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>`;
const settingsCard = () => `<details class="card" id="d-settings" ${det('d-settings', false)}><summary><h2>Team settings</h2></summary>
  <h3>Team code</h3><div class="row"><code id="codeval" class="codeval" data-shown="0">${'•'.repeat(Math.max(6, code.length))}</code><button data-act="showcode" aria-pressed="false">Show</button><button data-act="copycode">Copy</button></div>
  <h3>Our team number</h3><input id="cfg_us" value="${esc(cfg().us || DEFAULT_US)}" placeholder="e.g. 52111A">
  <h3>Scout names (comma separated)</h3><input id="cfg_names" value="${esc(NAMES.join(', '))}">
  <div class="foot"><button class="d" data-act="logout">Log out</button><span class="grow"></span><button class="p" data-act="savecfg">Save settings</button></div>
  <p class="mut">Settings are shared with everyone on the team.</p></details>`;

// ---------- Event tab: one place for the event, its teams, rankings, skills and notes ----------
const segBar = (items, cur, act) => `<div class="seg" role="group">${items.map(([k, l]) => `<button class="${cur === k ? 'on' : ''}" aria-pressed="${cur === k}" data-act="${act}" data-v="${k}">${l}</button>`).join('')}</div>`;
const tlist = () => `<datalist id="tl">${teams().map(t => `<option value="${t.number}">${esc(t.name)}</option>`).join('')}</datalist>`;
const tiles = a => `<div class="tiles">${a.map(([v, l, sub]) => `<div class="tile"><b>${v}</b><span>${l}</span>${sub ? `<small>${sub}</small>` : ''}</div>`).join('')}</div>`;

function vEvent() {
  const e = evObj(), sku = skuOf(e);
  let h = name ? '' : `<div class="card"><h2>Who are you?</h2><p class="mut">Pick your name. It goes on your notes and scouting.</p>${nameChips()}</div>`;
  if (!e) return h + `<div class="card"><h2>Pick your event</h2>${S.events.length ? evSelect() : ''}<h3>Import from VEX Events</h3><p class="mut">Pulls in the teams, matches and rankings, and keeps them up to date.</p>${importForm('')}<h3>Or create one by hand</h3>${manualForm()}</div>` + settingsCard();
  h += `<div class="card">${evSelect()}
    <p class="mut meta">${sku ? 'From VEX Events · ' + esc(sku) + ' · <button class="link" data-act="reimport">Update now</button>' : 'Created by hand'}${e.link ? ` · <a href="${esc(e.link)}" target="_blank" rel="noopener">Event page ↗</a>` : ''} <span id="impmsg2"></span></p>
    ${name ? `<p class="mut meta">Scouting as <b>${esc(name)}</b> · <button class="link" data-act="setname" data-v="">Change</button></p>` : ''}</div>`;
  h += segBar([['list', 'Teams'], ['rank', 'Rankings'], ['skills', 'Skills'], ['more', 'More']], tv, 'tview');
  return h + ({ list: vTeamList, rank: vRank, skills: vSkills, more: vMore })[tv]();
}
const importForm = sku => `<div class="row"><input id="sku" value="${esc(sku || 'RE-V5RC-26-5068')}" placeholder="Event code e.g. RE-V5RC-26-5068" aria-label="Event code"><button class="p" data-act="import">Import</button></div><p class="mut" id="impmsg"></p>`;
const manualForm = () => `<div class="row"><input id="newev" placeholder="Event name" aria-label="Event name"><button data-act="addev">Create</button></div>`;

// More: everything that isn't a table – alliance requests, event notes, other events, settings.
function vMore() {
  const e = evObj(), sku = skuOf(e);
  return `<div class="card"><h2>Alliance requests</h2><p class="mut">Teams that asked to ally with us, and what they say they’re good at.</p>
    <div class="row"><input id="rq_t" list="tl" placeholder="Team #" aria-label="Team number" class="narrow"><input id="rq_x" placeholder="Their strengths" aria-label="Their strengths"><button data-act="addreq">Add</button></div>
    ${notes('req').map(n => `<div class="note ${fresh(n)}"><div class="ntext"><b>${esc(n.ref)}</b> ${esc(tName(n.ref))} — ${esc(n.text)}</div><small>${esc(n.by || '')}<button class="d" data-act="delnote" data-id="${n.id}">Delete</button></small></div>`).join('')}</div>
  <div class="card"><h2>Event notes</h2>${noteBox('event', '', '', 'Anything about this event…')}</div>
  <details class="card" id="d-more" ${det('d-more', false)}><summary><h2>Import or add another event</h2></summary>${importForm(sku)}${manualForm()}</details>
  ${sku ? '' : `<details class="card" id="d-link" ${det('d-link', false)}><summary><h2>Event link</h2></summary><input id="evlink" value="${esc(e.link || '')}" placeholder="Paste the VEX event link here" aria-label="Event link"></details>`}
  ${settingsCard()}
  <div class="foot"><button class="d" data-act="delev">Delete this event and all its notes</button></div>${tlist()}`;
}

// Teams: search + one row per team with the numbers people ask about most (rank, skills, OPR).
function vTeamList() {
  const ts = teams(), q = tq.toLowerCase(), st = stats();
  return `<input id="tsearch" type="search" value="${esc(tq)}" placeholder="Search teams by number, name or school…" aria-label="Search teams">
  <div class="card list" id="tl2">${ts.map(t => {
    const n = notes('scout', t.number).length + notes('team', t.number).length, hay = (t.number + t.name + t.school).toLowerCase();
    const r = st.by.get(t.number), k = skillOf(t.number, 'season');
    const bits = [r && r.rank != null ? 'Rank ' + r.rank : '', k && k.c != null ? 'Skills ' + fmt(k.c) + ' (D ' + fmt(k.d) + ' · A ' + fmt(k.p) + ')' : '', r && r.opr != null ? 'OPR ' + f1(r.opr) : ''].filter(Boolean);
    return `<div class="trow ${t.number === US ? 'us' : ''}" data-act="team" data-t="${t.number}" data-q="${esc(hay)}" ${q && !hay.includes(q) ? 'style="display:none"' : ''}><span class="num">${t.number}</span><div class="grow"><div>${esc(t.name)}</div><div class="mut">${esc(t.school)}${n ? ' · ' + n + (n === 1 ? ' note' : ' notes') : ''}</div>${bits.length ? `<div class="mut tstat">${bits.join(' · ')}</div>` : ''}</div><span class="chev" aria-hidden="true">›</span></div>` }).join('') || empty('No teams yet.')}</div>
  <details class="card" id="d-addteam" ${det('d-addteam', !ts.length)}><summary><h2>Add a team manually</h2></summary><div class="row"><input id="t_n" placeholder="Number e.g. 52111A" aria-label="Team number"><input id="t_name" placeholder="Team name" aria-label="Team name"><input id="t_s" placeholder="School" aria-label="School"><button class="p" data-act="addteam">Add</button></div></details>`;
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
  const refresh = e.reid ? `<button data-act="refstats" ${statsBusy ? 'disabled' : ''}>${d ? 'Refresh' : 'Load season stats'}</button>` : '';
  if (!e.reid) return '<div class="card"><h2>Skills</h2><p class="mut">Skills scores and season records come from VEX Events, so they need an event imported with its event code (Event tab → More → Import).</p></div>';
  if (!d) return `<div class="card"><h2>Skills</h2><p class="mut">Season stats (skills scores, season record, awards) aren’t loaded yet. They cover each team’s whole season, not only this event, so they work even when no matches are being played. This takes about a minute.</p><div class="foot">${upd}<span class="grow"></span>${refresh}</div></div>`;
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
function filt(q) { q = q.toLowerCase(); document.querySelectorAll('#tl2 .trow').forEach(c => c.style.display = c.dataset.q.includes(q) ? '' : 'none') }

const chips = (m, arr) => arr.map(n => `<button class="chip ${n === US ? 'me' : cls(m, n)}" data-act="team" data-t="${n}">${n}</button>`).join('');
function vMatches() {
  if (!evObj()) return empty('Pick an event first.');
  const all = matches(), list = mf === 'all' ? all : all.filter(m => side(m));
  let h = segBar([['ours', 'Our matches'], ['all', 'All matches']], mf, 'mfilter');
  h += list.map(m => {
    const s = side(m), o = open[m.id];
    let res = '';
    if (s && scored(m)) { const a = s === 'red' ? m.rs : m.bs, b = s === 'red' ? m.bs : m.rs; res = a > b ? '<span class="res w">W</span>' : a < b ? '<span class="res l">L</span>' : '<span class="res">T</span>' }
    return `<div class="card ${s ? 'us' : ''}"><div class="mhead" data-act="mopen" data-id="${m.id}" role="button" aria-expanded="${!!o}"><span class="num">${esc(m.label)}</span>${scored(m) ? `<span class="score">${m.rs}–${m.bs}</span>` : ''}${res}<span class="grow"></span>${s ? `<span class="tag ${s}">We’re ${s}</span>` : ''}<span class="chev ${o ? 'up' : ''}" aria-hidden="true">›</span></div>
    <div class="vs"><div class="side r"><span>Red alliance</span>${chips(m, m.red)}</div><div class="side b"><span>Blue alliance</span>${chips(m, m.blue)}</div></div>
    ${o ? `<div class="mx ${justOpened === m.id ? 'reveal' : ''}">` + (s ? `<h3>Strategy</h3>${noteBox('match', m.id, 'strat', 'Our strategy for this match…')}<h3>Our alliance</h3>${noteBox('match', m.id, 'ally', 'What our partner said / their plan…')}<h3>Opposition</h3>${noteBox('match', m.id, 'opp', 'Weaknesses, tendencies…')}`
        : `<h3>Notes</h3>${noteBox('match', m.id, 'gen', 'What happened in this match…')}`) + `<div class="foot"><button class="d" data-act="clearmatch" data-id="${m.id}">Clear all notes for this match</button><button class="d" data-act="delmatch" data-id="${m.id}">Delete match</button></div></div>` : ''}</div>`
  }).join('') || empty(mf === 'all' ? 'No matches yet.' : 'No matches with us yet.');
  h += `<details class="card" id="d-addmatch" ${det('d-addmatch', !all.length)}><summary><h2>Add a match manually</h2></summary><div class="row"><input id="m_l" placeholder="Label e.g. Q12"><input id="m_o" type="number" inputmode="numeric" placeholder="Match number (for sorting)"></div>
  <h3>Red alliance</h3><div class="row"><input id="m_r1" list="tl" placeholder="Team"><input id="m_r2" list="tl" placeholder="Team"></div>
  <h3>Blue alliance</h3><div class="row"><input id="m_b1" list="tl" placeholder="Team"><input id="m_b2" list="tl" placeholder="Team"></div>
  <div class="foot"><button class="p" data-act="addmatch">Add match</button></div>${tlist()}</details>`;
  return h;
}

// What 1 and 5 mean for each rating, shown under the buttons so a bare "3" always has a meaning.
const SCALE = { autoCons: ['Rarely works', 'Works every time'], driver: ['Beginner', 'Excellent'], driverCons: ['Many mistakes', 'Very steady'], speed: ['Slow', 'Very fast'], durability: ['Breaks easily', 'Very tough'], scoring: ['Poor', 'Excellent'], scoreCons: ['Hit or miss', 'Every time'], overall: ['Weak', 'Top pick'] };
const R = (f, v) => `<div class="rate" role="group" aria-labelledby="l_${f}">${[1, 2, 3, 4, 5].map(i => `<button data-act="rate" data-f="${f}" data-v="${i}" class="${v === i ? 'on' : ''}" aria-pressed="${v === i}">${i}</button>`).join('')}</div>${SCALE[f] ? `<div class="scale"><span>1 = ${SCALE[f][0]}</span><span>5 = ${SCALE[f][1]}</span></div>` : ''}`;
// A labelled field: the label stays visible after something is typed, with an optional hint under it.
const fld = (id, label, body, hint) => `<div class="fld"><label id="l_${id}" for="${id}">${label}</label>${hint ? `<div class="mut hint">${hint}</div>` : ''}${body}</div>`;
const fldR = (f, label, v, hint) => `<div class="fld"><div class="lbl" id="l_${f}">${label}</div>${hint ? `<div class="mut hint">${hint}</div>` : ''}${R(f, v)}</div>`;
const sect = (title, sub, body) => `<div class="card sect"><div class="sech"><h2>${title}</h2><p class="mut">${sub}</p></div>${body}</div>`;
const opts = (list, cur, blank) => `<option value="">${blank}</option>` + list.map(o => `<option ${cur === o ? 'selected' : ''}>${o}</option>`).join('');
function vScout() {
  if (!evObj()) return empty('Pick an event first.');
  if (!name) return `<div class="card"><h2>Who’s scouting?</h2><p class="mut">Pick your name. You can scout each team once overall, plus once per match you watch, and come back to edit.</p>${nameChips()}</div>`;
  const ms = matches();
  if (scTeam && draft) {
    const d = draft, tms = ms.filter(m => m.red.includes(scTeam) || m.blue.includes(scTeam));
    const rel = m => { const s = side(m, scTeam); return s === 'ally' ? ' · with us' : s === 'opp' ? ' · against us' : '' };
    return `<button class="link back" data-act="donescout">‹ Back to teams</button>
    <div class="card"><h2><span class="num">${scTeam}</span> ${esc(tName(scTeam))}</h2>
    ${fld('scm', 'What are you scouting?', `<select id="scm"><option value="">Overall / pit scouting (not one match)</option>${tms.map(m => `<option value="${esc(m.id)}" ${d.match === m.id ? 'selected' : ''}>Match ${esc(m.label)}${rel(m)}${scored(m) ? ' · played' : ''}</option>`).join('')}</select>`, 'Overall = your general read of the team. Pick a match to record what you saw in that one match.')}
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
      fldR('speed', 'Speed', d.speed) + fldR('durability', 'Durability', d.durability, 'Will it survive a hard match?'))}
    ${sect('Scoring', 'How well they score during a match.',
      fldR('scoring', 'Scoring ability', d.scoring) +
      fld('f_reliable', 'Can they score reliably?', `<select id="f_reliable" data-f="reliable">${opts(['Yes, reliable', 'Sometimes', 'No, bad at scoring'], d.reliable, 'Not sure yet')}</select>`) +
      fldR('scoreCons', 'Scoring consistency', d.scoreCons, 'Do they score about the same every match?'))}
    ${sect('Toggle', 'Whether they can hold a toggle, and how they do it.',
      fld('f_toggle', 'How well can they hold a toggle?', `<select id="f_toggle" data-f="toggle">${opts(['Very well', 'Well', 'Decent', 'Not well', 'Not at all'], d.toggle, 'Not sure yet')}</select>`) +
      fld('f_toggleMech', 'Toggle mechanism', `<textarea id="f_toggleMech" data-f="toggleMech" placeholder="e.g. Pneumatic hook on the arm that clamps the top bar">${esc(d.toggleMech)}</textarea>`, 'Describe what they use to do the toggle (not a score).'))}
    ${sect('Overall', 'Your final read on this team.',
      fldR('overall', 'Overall rating', d.overall) +
      fld('f_good', 'Are they a good team?', `<select id="f_good" data-f="good">${opts(['Yes', 'Decent', 'No'], d.good, 'Not sure yet')}</select>`) +
      fld('f_comments', 'Other comments & weaknesses', `<textarea id="f_comments" data-f="comments" placeholder="Anything else we should know…">${esc(d.comments)}</textarea>`))}
    <div class="card"><div class="foot"><span class="mut grow">✔ Autosaves as you go${online ? '' : ' (kept on this phone until you’re back online)'}.</span><button class="d" data-act="resetdraft">Reset</button><button class="p" data-act="donescout">Done</button></div></div>`;
  }
  const rel = n => { const a = [], o = []; ms.forEach(x => { const s = side(x, n); if (n === US || !s) return; (s === 'ally' ? a : o).push(x.label.replace(/^Mock /, '')) }); return { a, o } };
  const list = teams().filter(t => t.number !== US);
  const row = t => {
    const r = rel(t.number), c = r.a.length && !r.o.length ? 'gn' : r.o.length && !r.a.length ? 'rd' : r.a.length && r.o.length ? 'both' : '', mine = myScouts(t.number).length;
    return `<div class="trow ${scTeam === t.number ? 'sel' : ''}" data-act="startscout" data-t="${t.number}"><span class="chip ${c}">${t.number}</span><div style="flex:1"><div>${esc(t.name)}</div>${mine ? `<div class="lab" style="color:var(--accent-text)">✓ You’ve scouted this${mine > 1 ? ' (' + mine + ' entries)' : ''}</div>` : ''}${r.a.length ? `<div class="lab g">With us: ${r.a.join(', ')}</div>` : ''}${r.o.length ? `<div class="lab r">Against us: ${r.o.join(', ')}</div>` : ''}</div><span class="chev" aria-hidden="true">›</span></div>`;
  };
  const kind = t => { const r = rel(t.number); return r.a.length && r.o.length ? 'both' : r.a.length ? 'with' : r.o.length ? 'against' : 'other' };
  const groups = [['with', 'Playing with us', 'gn'], ['against', 'Playing against us', 'rd'], ['both', 'Both with and against us', 'both'], ['other', 'Not in a match with us', '']];
  const done = list.filter(t => myScouts(t.number).length).length;
  return `<div class="card"><h2>Pick a team to scout</h2><p class="mut">Scouting as <b>${esc(name)}</b> · <button class="link" data-act="setname" data-v="">Change</button></p>
  ${list.length ? `<p class="mut">You’ve scouted ${done} of ${list.length} teams. Teams are grouped by whether we play with or against them.</p>` : ''}</div>` +
  (groups.map(([k, title, c]) => { const g = list.filter(t => kind(t) === k); return g.length ? `<div class="card list"><div class="ghead"><span class="chip ${c}" aria-hidden="true"></span><h3>${title}</h3><span class="mut">${g.length}</span></div>${g.map(row).join('')}</div>` : '' }).join('') || '<div class="card"><span class="mut">Add teams first.</span></div>');
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
    grp('Scoring', kv('Scoring ability', r5(n.scoring)), kv('Scores reliably?', esc(n.reliable || '')), kv('Scoring consistency', r5(n.scoreCons))) +
    grp('Toggle', kv('Holds a toggle', esc(n.toggle || '')), tx('Toggle mechanism', n.toggleMech), !n.toggleMech && n.toggleQ ? kv('Mechanism rating (old form)', r5(n.toggleQ)) : '') +
    grp('Overall', kv('Overall rating', r5(n.overall)), kv('Good team?', esc(n.good || '')), tx('Comments', n.comments)) + `</div>`;
};

// Everything the VEX app shows for a team, for the whole season: skills, record, event history, awards.
function seasonCard(num) {
  const e = evObj(), d = stDoc(), s = d && d.teams && d.teams[num];
  if (!e || !e.reid) return `<div class="card"><h2>Season stats</h2><p class="mut">Skills scores, season record and awards come from VEX Events, so they need an event imported with its event code.</p></div>`;
  if (!d) return `<div class="card"><h2>Season stats</h2><p class="mut">Not loaded yet. Open Event → Skills and tap <b>Load season stats</b>.</p></div>`;
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
  const head = (title, sub) => `<div class="sheethead"><div class="grow"><h2>${title}</h2>${sub ? `<div class="mut">${sub}</div>` : ''}</div><button data-act="close">Close</button></div>`;
  if (num === US) return head(`<span class="num">${esc(num)}</span> ${esc(tName(num) || 'Us')}`) + `<div class="card">That’s us. Scouting and team notes are turned off for our own team.</div>` + seasonCard(num);
  const t = teams().find(x => x.number === num) || { number: num, name: '', school: '' };
  const ms = matches().filter(m => m.red.includes(num) || m.blue.includes(num));
  const sc = notes('scout', num);
  const avg = f => { const v = sc.map(s => parseFloat(s[f])).filter(x => x > 0); return v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(1) : '-' };
  return head(`<span class="num">${esc(num)}</span> ${esc(t.name)}`, esc(t.school)) + `
  ${(() => { const st = stats(), r = st.by.get(num); return r ? `<div class="card"><b>${st.official ? 'Rank' : 'Calculated rank'} ${r.rank ?? '–'}</b> · ${rec(r)} · WP ${r.wp ?? '–'}<div class="mut">OPR ${f1(r.opr)} · DPR ${f1(r.dpr)} · CCWM ${sgn(r.ccwm)}</div></div>` : '' })()}
  ${seasonCard(num)}
  <div class="card"><h2>Scouting averages</h2><p class="mut">From ${sc.length} ${sc.length === 1 ? 'entry' : 'entries'}. Ratings are out of 5.</p>${sc.length ? tiles([[avg('autoPts'), 'Auto points'], [avg('driver'), 'Driver skill'], [avg('speed'), 'Speed'], [avg('scoring'), 'Scoring'], [avg('durability'), 'Durability'], [avg('overall'), 'Overall']]) : ''}</div>
  <div class="card"><h2>Matches</h2>${ms.map(m => `<span class="chip ${side(m, num) === 'ally' ? 'gn' : side(m, num) === 'opp' ? 'rd' : ''}">${esc(m.label)}</span>`).join('') || '<span class="mut">None</span>'}</div>
  <div class="card"><h2>Notes on this team</h2>${noteBox('team', num, '', 'Add a note about ' + num + '…')}${notes('team', num).length ? `<div class="foot"><button class="d" data-act="clearnotes" data-t="${num}">Clear all notes on this team</button></div>` : ''}</div>
  <div class="card"><h2>Scouting entries</h2>${sc.map(s => sum(s)).join('') || '<span class="mut">None yet</span>'}${sc.length ? `<div class="foot"><button class="d" data-act="clearscout" data-t="${num}">Clear all scouting entries</button></div>` : ''}</div>
  <div class="card"><h2>Alliance requests</h2>${notes('req', num).map(n => `<div class="note">${esc(n.text)}</div>`).join('') || '<span class="mut">None</span>'}</div>
  ${t.id ? `<div class="foot"><button class="d" data-act="delteam" data-id="${t.id}">Remove team from this event</button></div>` : ''}`;
}

function vPick() {
  const e = evObj(); if (!e) return empty('Pick an event first.');
  const p = e.picks || [], avail = teams().filter(t => t.number !== US && !p.includes(t.number));
  return `<div class="card"><h2>Finals picklist</h2><p class="mut">Hold the ≡ handle and drag to reorder, or use the arrows. #1 is who we want most.</p><div id="pklist">${p.map((n, i) => `<div class="pk" data-i="${i}" data-flip="${esc(n)}"><span class="grip" title="Drag to reorder">≡</span><span class="num" style="width:34px;color:var(--accent-text)">${i + 1}</span><div style="flex:1;cursor:pointer" data-act="team" data-t="${n}"><span class="num">${n}</span>${esc(tName(n))}<div class="mut">${(r => r ? 'Rank ' + (r.rank ?? '–') + ' · OPR ' + f1(r.opr) + ' · ' : '')(stats().by.get(n))}${notes('req', n).length ? 'Asked to ally · ' : ''}${notes('scout', n).length} scouting entries</div></div><span class="arrows"><button data-act="pup" data-i="${i}" aria-label="Move up" ${i ? '' : 'disabled'}>▲</button><button data-act="pdn" data-i="${i}" aria-label="Move down" ${i < p.length - 1 ? '' : 'disabled'}>▼</button></span><button class="d x" data-act="prm" data-i="${i}" aria-label="Remove ${esc(n)}">×</button></div>`).join('') || empty('Nothing yet. Tap a team below to add it.')}</div></div>
  <div class="card"><h2>Still to pick</h2><p class="mut">Tap a team to add it to the list.</p>${avail.map(t => `<button class="chip" data-act="addpick" data-t="${t.number}">${t.number}</button>`).join('') || '<span class="mut">Every team is on the list.</span>'}</div>`;
}
const setPicks = p => upd('events', ev, { picks: p });

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
function doImport(sku, msgEl) {
  if (msgEl) msgEl.textContent = 'Importing…';
  api('/import', { sku: norm(sku) }).then(d => { ev = d.eventId; ls('ev', ev); if (msgEl) msgEl.textContent = ''; toast(`Imported ${d.teams} teams and ${d.matches} matches`); return pull() })
    .catch(e => { if (msgEl) msgEl.textContent = 'Failed: ' + String(e.message || e).slice(0, 140) });
}
document.addEventListener('click', e => {
  if (e.target.id === 'modal') { closeModal(); return } // tap outside the team sheet
  const b = e.target.closest('[data-act]'); if (!b) return; const a = b.dataset.act, v = id => $('#' + id)?.value?.trim() || '';
  const me = name || 'Someone';
  if (a === 'tab') { flushDraft(); tab = b.dataset.v; ls('tab', tab); render() }
  else if (a === 'login') { code = $('#codein').value.trim(); loginErr = false; api('/login', {}).then(() => { ls('code', code); online = true; return flush().then(pull) }).then(schedule).catch(e => { if (e instanceof NetErr) toast('Can’t reach the server. Check your connection.') }) }
  else if (a === 'peek') { const i = $('#codein'), show = i.type === 'password'; i.type = show ? 'text' : 'password'; b.setAttribute('aria-pressed', show); b.setAttribute('aria-label', show ? 'Hide code' : 'Show code'); b.innerHTML = show ? EYE_OFF : EYE; i.focus() }
  else if (a === 'showcode') { const c = $('#codeval'), show = c.dataset.shown !== '1'; c.dataset.shown = show ? '1' : '0'; c.textContent = show ? code : '•'.repeat(Math.max(6, code.length)); b.textContent = show ? 'Hide' : 'Show'; b.setAttribute('aria-pressed', show) }
  else if (a === 'copycode') copyText(code).then(() => toast('Team code copied'), () => toast('Couldn’t copy – tap Show and copy it by hand'));
  else if (a === 'logout') { if (sure(b)) { if (outbox.length && !confirm(outbox.length + ' changes haven’t been sent yet and will be lost. Log out anyway?')) return; code = ''; ls('code', ''); outbox = []; lsJ('outbox', []); lsJ('cache', null); schedule(); render(); setStatus() } }
  else if (a === 'import') doImport(v('sku'), $('#impmsg'));
  else if (a === 'reimport') doImport(skuOf(evObj()), $('#impmsg2'));
  else if (a === 'team') { mTeam = b.dataset.t; render() }
  else if (a === 'close') closeModal();
  else if (a === 'addev') { const n = v('newev'); if (n) { const id = uid(); put('events', id, { name: n, link: '', picks: [] }); ev = id; ls('ev', id) } }
  else if (a === 'delev') { if (sure(b)) { send({ purge: ev }); ev = S.events[0] ? S.events[0].id : ''; ls('ev', ev) } }
  else if (a === 'savecfg') { const us = norm(v('cfg_us')) || DEFAULT_US, names = [...new Set(v('cfg_names').split(',').map(s => s.trim()).filter(Boolean))]; put('config', 'main', { us, names: names.length ? names : DEFAULT_NAMES }); toast('Settings saved') }
  else if (a === 'addteam') { const n = norm(v('t_n')); if (n) put('teams', ev + '_' + n, { eventId: ev, number: n, name: v('t_name'), school: v('t_s') }) }
  else if (a === 'delteam') { if (sure(b)) { del('teams', b.dataset.id); closeModal() } }
  else if (a === 'addmatch') {
    const r = ['m_r1', 'm_r2'].map(i => norm(v(i))).filter(Boolean), bl = ['m_b1', 'm_b2'].map(i => norm(v(i))).filter(Boolean);
    if (v('m_l') && (r.length || bl.length)) put('matches', uid(), { eventId: ev, label: v('m_l'), order: +v('m_o') || matches().length + 1, red: r, blue: bl })
  }
  else if (a === 'delmatch') { if (sure(b)) del('matches', b.dataset.id) }
  else if (a === 'mopen') { const id = b.dataset.id; open[id] = !open[id]; justOpened = open[id] ? id : null; render() }
  else if (a === 'mfilter') { mf = b.dataset.v; ls('mf', mf); render() }
  else if (a === 'tview') { tv = b.dataset.v; ls('tv', tv); render() }
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
  else if (a === 'startscout') { if (!name || b.dataset.t === US) return; flushDraft(); scTeam = b.dataset.t; loadDraft(scTeam, ''); render() }
  else if (a === 'donescout') { flushDraft(); scTeam = ''; draft = null; render() }
  else if (a === 'resetdraft') { if (sure(b)) { draft = { ...newDraft(scTeam, draft.match), id: draft.id }; saveDraft(0); lastView = ''; render() } }
  else if (a === 'setname') { flushDraft(); scTeam = ''; draft = null; name = b.dataset.v; ls('name', name); render() }
  else if (a === 'theme') { ls('theme', (ls('theme') || 'light') === 'dark' ? 'light' : 'dark'); applyTheme() }
  else if (a === 'rate') { // update in place so the choice eases across instead of the whole form redrawing
    const f = b.dataset.f; draft[f] = draft[f] == +b.dataset.v ? 0 : +b.dataset.v;
    b.parentElement.querySelectorAll('button').forEach(x => { const on = +x.dataset.v === draft[f]; x.classList.toggle('on', on); x.setAttribute('aria-pressed', on) });
    saveDraft(0);
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
  else if (t.id === 'evlink') { const id = ev, val = t.value.trim(); clearTimeout(linkT); linkT = setTimeout(() => upd('events', id, { link: val }), 600) }
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'evsel') { ev = t.value; ls('ev', ev); t.blur(); render() }
  else if (t.id === 'scm') { flushDraft(); loadDraft(scTeam, t.value); t.blur(); render() }
  else if (t.dataset.f && draft && tab === 'scout') { draft[t.dataset.f] = t.value; saveDraft(0) }
});
document.addEventListener('focusout', () => setTimeout(() => { if (dirty) render() }, 150));

document.addEventListener('pointerdown', e => {
  const g = e.target.closest('.grip'); if (!g) return; e.preventDefault();
  const row = g.closest('.pk'), rows = [...document.querySelectorAll('#pklist .pk')], from = +row.dataset.i, y0 = e.clientY;
  const mids = rows.map(r => { const b = r.getBoundingClientRect(); return b.top + b.height / 2 });
  dragging = true; row.classList.add('drag'); try { g.setPointerCapture(e.pointerId) } catch (_) {}
  const mv = m => { row.style.transform = 'translateY(' + (m.clientY - y0) + 'px)' };
  const up = u => {
    g.removeEventListener('pointermove', mv); g.removeEventListener('pointerup', up); g.removeEventListener('pointercancel', up);
    dragging = false; row.classList.remove('drag'); row.style.transform = '';
    const y = mids[from] + (u.clientY - y0); let to = 0; mids.forEach((m, i) => { if (i !== from && m < y) to++ });
    if (u.type !== 'pointercancel' && to !== from) { const p = [...evObj().picks]; p.splice(to, 0, p.splice(from, 1)[0]); setPicks(p) }
    if (dirty) render()
  };
  g.addEventListener('pointermove', mv); g.addEventListener('pointerup', up); g.addEventListener('pointercancel', up)
});
document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'codein') document.querySelector('[data-act=login]').click() });
document.addEventListener('visibilitychange', () => { if (document.hidden) flushDraft(); else if (code) { flush(); pull() } });
window.addEventListener('online', () => { if (code) { online = true; flush().then(pull) } });
window.addEventListener('offline', () => { online = false; setStatus() });
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('/sw.js').catch(() => {});
applyTheme(); init();
