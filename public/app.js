'use strict';
// Recon – client. Made by Invictus 52111A.
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

const APP = { name: 'Recon', version: '1.0.0' };
// Signed in as one team: its number is "us" everywhere. Scout names are the team's own list (Team settings).
let US = '', NAMES = [];
const COLS = ['events', 'teams', 'matches', 'notes', 'config', 'rankings', 'stats'];
let S = { events: [], teams: [], matches: [], notes: [], config: [], rankings: [], stats: [] };
let ev = ls('ev'), tab = ls('tab') || 'event', name = ls('name'), mf = ls('mf') || 'ours', sf = ls('sf') || 'todo', tv = ls('tv') || 'list', rks = ls('rks') || 'rank', sks = ls('sks') || 'season', sko = ls('sko') || 'c';
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
let code = ls('code'), team = ls('team'), teamInfo = lsJ('teamInfo') || {}, pollT, impT, lastV = -1, loginErr = false, online = true, lastSync = 0;
let RK = null, rkShown = ''; // whether the team has a recovery key (from the server); a key just made, shown until dismissed
let outbox = lsJ('outbox') || [], inflight = null, flushing = false, polling = false, syncing = false, editSeq = 0;
// Event codes look like RE-V5RC-26-5068 or VE-V5-26-66510. Pull one out of whatever was typed or pasted (a whole event page link is fine).
const SKU_RE = /(?<![A-Z0-9])[A-Z]{2,4}-[A-Z0-9]{2,8}-\d{2}-\d{3,7}(?![0-9])/i;
const parseSku = t => ((String(t || '').match(SKU_RE) || [])[0] || '').toUpperCase();
const skuOf = e => (e && e.sku) || parseSku(e && e.link);

async function api(path, body) {
  let r;
  try { r = await fetch(API + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'x-team': team, 'x-code': code }, body: body ? JSON.stringify(body) : undefined }) }
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
    RK = !!d.rk;
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
  h += segBar([['join', 'Join your team'], ['create', 'Set up a new team']], wmode, 'wmode');
  const err = loginErr ? `<p class="err">${esc(loginErr)}</p>` : '';
  if (wmode === 'join') h += `<div class="card login"><h2>Join your team</h2><p class="mut">Enter your team number and the team code a teammate gave you.</p>
    <input id="w_team" value="${esc(team)}" placeholder="Team number, e.g. 52111A" autocapitalize="characters" autocomplete="organization" aria-label="Team number">
    <div class="pw"><input id="codein" type="password" autocomplete="current-password" placeholder="Team code" aria-label="Team code"><button type="button" class="icon" data-act="peek" aria-label="Show code" aria-pressed="false">${EYE}</button></div>${err}<button class="p wide" data-act="login" ${wbusy ? 'disabled' : ''}>${wbusy ? 'Opening…' : 'Open'}</button><div class="foot"><button class="link" data-act="wmode" data-v="recover">Lost the code?</button></div></div>`;
  else if (wmode === 'recover') h += recoverHTML(err);
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
  if (ls('lastTeam') !== t) { outbox = []; lsJ('outbox', []); lsJ('cache', null); for (const k of COLS) S[k] = []; ev = ''; ls('ev', ''); name = ''; ls('name', ''); lastV = -1; loaded = false }
  team = t; teamInfo = info || {}; ls('team', t); ls('lastTeam', t); lsJ('teamInfo', teamInfo);
}

async function init() {
  // phones signed in to the original single-team app (before Recon had teams) were all Invictus 52111A
  if (code && !team) { team = '52111A'; ls('team', team); ls('lastTeam', team) }
  const c = lsJ('cache');
  if (code && c && c.S) { for (const k of COLS) S[k] = c.S[k] || []; for (const o of outbox) applyOp(o); lastSync = c.t || 0; loaded = true; if (!ev && S.events.length) ev = S.events[0].id }
  render(); setStatus();
  if (code) { await flush(); await pull(); schedule(); syncRE() }
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

// Segmented controls: one highlight that glides to the chosen item, and the content under it slides the way you went.
const SEG_SLIDE = new Set(['mfilter', 'sfilter', 'tview', 'sksope', 'ebscope', 'wmode']);
const segBtns = s => [...s.querySelectorAll(':scope > button')];
function segSnap() {
  const m = {};
  document.querySelectorAll('#app .seg[data-seg]').forEach(s => { const bs = segBtns(s), i = bs.findIndex(b => b.classList.contains('on')); if (i >= 0 && bs[i].offsetWidth) m[s.dataset.seg] = { i, l: bs[i].offsetLeft, w: bs[i].offsetWidth } });
  return m;
}
function segPlace(snap) {
  document.querySelectorAll('#app .seg[data-seg]').forEach(s => {
    const bs = segBtns(s), i = bs.findIndex(b => b.classList.contains('on')), b = bs[i];
    if (!b || !b.offsetWidth) return; // folded away: placed when it opens
    let p = s.querySelector(':scope > .segpill'); if (!p) { p = document.createElement('i'); p.className = 'segpill'; s.appendChild(p) }
    const l = b.offsetLeft, w = b.offsetWidth; p.style.width = w + 'px'; p.style.transform = `translateX(${l}px)`; s.classList.add('pilled');
    const from = snap && snap[s.dataset.seg]; if (!from || from.i === i || reduced()) return;
    p.animate([{ width: from.w + 'px', transform: `translateX(${from.l}px)` }, { width: w + 'px', transform: `translateX(${l}px)` }], { duration: 440, easing: 'cubic-bezier(0.34, 1.4, 0.64, 1)' });
    if (!SEG_SLIDE.has(s.dataset.seg)) return;
    const dir = i > from.i ? 1 : -1; let n = s.nextElementSibling, k = 0;
    while (n) { n.animate([{ opacity: 0, transform: `translateX(${dir * 36}px)` }, { opacity: 1, transform: 'none' }], { duration: 380, delay: Math.min(k, 5) * 40, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'backwards' }); n = n.nextElementSibling; k++ }
  });
}
window.addEventListener('resize', () => segPlace());
function render() {
  if (dragging) { dirty = true; return }
  document.body.classList.toggle('out', !code);
  if (!code) { $('#nav').innerHTML = ''; const sb = segSnap(); $('#app').innerHTML = loginHTML(); $('#evname').textContent = 'Welcome'; $('#evbar').innerHTML = ''; if (sb.wmode) $('#app .welcome')?.classList.add('swap'); segPlace(sb); lastView = ''; return }
  if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) || menuFor) { dirty = true; return }
  dirty = false;
  US = norm(team);
  NAMES = Array.isArray(cfg().names) ? cfg().names : [];
  if (loaded && name && !NAMES.includes(name)) { name = ''; ls('name', '') }
  $('#evname').textContent = US + (teamInfo.name ? ' · ' + teamInfo.name : '');
  $('#evbar').innerHTML = evBar();
  // the tab bar is built once and only its classes change, so the selected tab can ease across
  const nav = $('#nav');
  if (!nav.children.length) nav.innerHTML = TABS.map(t => `<button data-act="tab" data-v="${t[0]}">${t[1]}<span>${t[2]}</span></button>`).join('');
  nav.querySelectorAll('button').forEach(b => { const on = b.dataset.v === tab; b.classList.toggle('on', on); b.setAttribute('aria-current', on ? 'page' : 'false') });
  let pill = nav.querySelector('.navpill'); if (!pill) { pill = document.createElement('i'); pill.className = 'navpill'; nav.prepend(pill) }
  const onb = nav.querySelector('button.on'); if (onb) { pill.style.width = onb.offsetWidth + 'px'; pill.style.transform = `translateX(${onb.offsetLeft}px)`; pill.style.opacity = 1 }
  const key = viewKey(), same = key === lastView, before = same ? flipCapture() : null, y = scrollY, sb = segSnap();
  $('#app').innerHTML = ({ event: vEvent, matches: vMatches, scout: vScout, pick: vPick })[tab]();
  scrollTo({ top: same ? y : 0, behavior: 'instant' });
  if (same) flipPlay(before); else if (lastView && !reduced() && navAnim !== 'seg') replay($('#app'), 'enter' + (navAnim ? '-' + navAnim : '')); navAnim = '';
  segPlace(sb);
  if (!same) for (const k in lastCounts) delete lastCounts[k];
  lastView = key; justOpened = null; countUp();
  const md = $('#modal');
  $('#mbody').innerHTML = mTeam === ':about' ? vAbout() : mTeam ? vTeam(mTeam) : '';
  if (mTeam && !modalShown) { md.style.display = 'block'; if (!reduced()) replay(md, 'opening') }
  else if (!mTeam) md.style.display = 'none';
  modalShown = !!mTeam;
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
  return `<div class="evpick">${evSelect()}${sku ? `<button type="button" class="ib" data-act="reimport" aria-label="Update this event from VEX Events" title="Update from VEX Events">${IC_REFRESH}</button>` : ''}${e && e.link ? `<a class="ib" href="${esc(e.link)}" target="_blank" rel="noopener" aria-label="Open the event page" title="Event page">${IC_OUT}</a>` : ''}</div><p class="mut evmsg" id="impmsg2" role="status"></p>`;
}
const evSelect = () => dd('evsel', ev, [['', '— choose event —'], ...S.events.map(x => [x.id, x.name]), ['+add', '＋ Add another event…']], { label: 'Event' });
// install: Android / desktop Chrome offer a prompt we can trigger; iPhone needs Share → Add to Home Screen
let installEvt = null;
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; if (code) render() });
window.addEventListener('appinstalled', () => { installEvt = null; toast('Recon is installed'); if (code) render() });
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
  <h3>Scouts</h3><div class="scouts">${NAMES.map(n => `<div class="srow"><span class="avatar">${esc((n[0] || '?').toUpperCase())}</span><span class="grow">${esc(n)}${n === name ? ' <span class="mut">(you)</span>' : ''}</span><button class="d" data-act="delname" data-v="${esc(n)}">Remove</button></div>`).join('') || '<p class="mut">Names show up here as people join.</p>'}</div>
  <div class="row"><input id="newscout" placeholder="Add a scout" autocomplete="off" aria-label="Add a scout"><button data-act="addscout">Add</button></div>
  ${installRow()}
  <div class="foot"><button class="link" data-act="about">About Recon</button><span class="grow"></span><button class="d" data-act="logout">Log out</button></div></details>`;
const whoCard = (title, text) => `<div class="card"><h2>${title}</h2><p class="mut">${text}</p>${nameChips()}<div class="row"><input id="myname" placeholder="${NAMES.length ? 'Not listed? Type your name' : 'Your name'}" autocomplete="given-name" aria-label="Your name"><button data-act="addname">That’s me</button></div></div>`;
function vAbout() {
  return `<div class="sheethead"><div class="grow"><h2>About Recon</h2></div><button data-act="close">Close</button></div>
  <div class="card about"><img class="heroicon" src="icon.svg" alt=""><div><b>Recon</b> <span class="mut">version ${APP.version}</span><p class="mut">Scouting for VEX V5 teams: match notes, scouting forms, rankings, OPR and a finals picklist, shared live with your team and working offline.</p></div></div>
  <div class="card"><h2>Made by Invictus 52111A</h2><div class="credit"><img class="on-light" src="logo.svg" alt="Invictus 52111A"><img class="on-dark" src="logo-light.svg" alt="Invictus 52111A"></div><p class="mut">Recon was designed and built by VEX team 52111A, Invictus.</p></div>
  <div class="card"><h2>Your data</h2><p class="mut">Each team’s scouting is private to that team: only people with your team number and team code can see or change it. Event lists, matches and rankings come from VEX Events.</p></div>
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
  return started && hasNext ? { cls: 'now', html: '<span class="livedot"></span>Event in progress' } : { cls: 'soon', html: played ? 'All our matches are played' : hasNext ? 'Matches are scheduled' : 'Waiting for the match schedule' };
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
  return stat({ icon: IC_RANK, label: 'Our rank' + (st.official ? '' : ' (calculated)'), attrs: 'data-act="gorank"',
    big: ranked ? `<span data-count="${me.rank}" data-ck="rank">${me.rank}</span>` : '–', den: ranked ? ts.length : '',
    chip: me && me.ccwm != null ? delta('CCWM ' + sgn(me.ccwm), me.ccwm >= 0) : '',
    cap: me && (me.w + me.l + me.t) ? `Record ${rec(me)}${me.opr != null ? ' · OPR ' + f1(me.opr) : ''}` : 'Your ranking shows up once qualification matches are scored.', viz });
}
function recStat(ours) {
  const done = ours.filter(scored), sc = m => { const s = side(m); return s === 'red' ? [m.rs, m.bs] : [m.bs, m.rs] };
  const w = done.filter(m => { const [a, b] = sc(m); return a > b }).length;
  const cols = done.slice(-12).map(m => { const [a, b] = sc(m); return { a, cls: a > b ? 'w' : a < b ? 'l' : 't' } }), max = Math.max(...cols.map(c => c.a), 1);
  return stat({ icon: IC_REC, label: 'Our matches', attrs: 'data-act="tab" data-v="matches"',
    big: done.length ? `<span data-count="${w}" data-ck="w">${w}</span>` : '–', den: done.length || '',
    chip: done.length ? delta(Math.round(w / done.length * 100) + '% won', w * 2 >= done.length) : '', cap: done.length ? 'matches won so far' : 'Your matches show up once scoring starts',
    viz: cols.length ? dotMatrix(cols.map(c => ({ h: Math.max(1, Math.round(c.a / max * 7)), cls: c.cls })), 7, 'Our score in each match: green for a win, red for a loss, amber for a tie') : '' });
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
    <div class="vs">${sides.map(([c, l, arr, col]) => `<div class="side ${c} ${s === col ? 'mine' : ''}"><span>${l}</span>${chips(next, arr)}</div>`).join('')}</div></div>`;
  }
  return `<div class="home"><div class="greet"><div><p class="live ${stat.cls}">${stat.html}</p><h1>${esc(name || US)}${name ? ' <button class="link namechg" data-act="setname" data-v="">Change</button>' : ''}</h1></div></div>
  <section class="panel"><div class="phead"><h2>Event overview</h2></div>${rankStat(st, me, ts)}${recStat(ours)}</section>
  ${nx}</div>`;
}

function vEvent() {
  const e = evObj();
  let h = name ? '' : whoCard('Who are you?', 'Your name goes on your notes and scouting.');
  if (e) h += vHome();
  const me = name ? `<p class="mut meta">Scouting as <b>${esc(name)}</b> · <button class="link" data-act="setname" data-v="">Change</button></p>` : '';
  if (!e) return h + `<div class="card"><h2>Pick your event</h2>${me}${S.events.length ? '<p class="mut">Choose one of your events from the bar at the top, or add another here.</p>' : ''}<h3>Find your event</h3><p class="mut">Pulls in the teams, matches and rankings, and keeps them up to date.</p>${ebHTML()}<h3>Or paste an event code or link</h3>${importForm('')}<h3>Or create one by hand</h3>${manualForm()}</div>` + settingsCard();
  h += segBar([['list', 'Teams'], ['rank', 'Rankings'], ['skills', 'Skills'], ['more', 'More']], tv, 'tview');
  return h + ({ list: vTeamList, rank: vRank, skills: vSkills, more: vMore })[tv]();
}
const importForm = sku => `<div class="row"><input id="sku" value="${esc(sku)}" placeholder="Event code or link, e.g. RE-V5RC-26-5068" aria-label="Event code or link" autocapitalize="characters" autocomplete="off" spellcheck="false"><button class="p" data-act="import">Import</button></div><p class="mut" id="impmsg"></p>`;
const manualForm = () => `<div class="row"><input id="newev" placeholder="Event name" aria-label="Event name"><button data-act="addev">Create</button></div>`;

// More: everything that isn't a table – alliance requests, event notes, other events, settings.
function vMore() {
  const e = evObj(), sku = skuOf(e);
  return `<div class="card"><h2>Event notes</h2>${noteBox('event', '', '', 'Anything about this event…')}</div>
  <details class="card" id="d-more" ${det('d-more', false)}><summary><h2>Add another event</h2></summary><h3>Find an event</h3>${ebHTML()}<h3>Or paste an event code or link</h3>${importForm('')}<h3>Or create one by hand</h3>${manualForm()}</details>
  ${sku ? '' : `<details class="card" id="d-link" ${det('d-link', false)}><summary><h2>Event link</h2></summary><input id="evlink" value="${esc(e.link || '')}" placeholder="Paste the VEX event link here" aria-label="Event link"></details>`}
  ${settingsCard()}
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
// ---------- event browser: find an event on VEX Events instead of typing its code ----------
// Results come from the server (/api/events). Typing filters them there (after a short pause); the list is painted
// straight into #ebres so typing in the search box never fights with a full re-render.
let EB = { scope: ls('ebs') || 'mine', q: '', list: null, total: 0, busy: false, err: '', msg: '', f: { region: '', level: '', when: '', hide: false } }, ebT, ebSeq = 0;
// Event lists are remembered for 10 minutes (per tab and search), so switching tabs or coming back is instant.
const EBC = lsJ('ebc') || {}, EB_TTL = 10 * 60000;
const ebKey = () => EB.scope + '|' + EB.q.trim().toLowerCase(), ebFresh = k => EBC[k] && Date.now() - EBC[k].t < EB_TTL;
function ebStore(k, list, total) { EBC[k] = { t: Date.now(), list, total }; const ks = Object.keys(EBC); if (ks.length > 8) { ks.sort((a, b) => EBC[a].t - EBC[b].t); delete EBC[ks[0]] } lsJ('ebc', EBC) }
const ebMatchQ = (list, q) => { const w = q.toLowerCase().split(/\s+/).filter(Boolean); return w.length ? list.filter(e => { const hay = [e.name, e.sku, e.city, e.region, e.country, e.venue].join(' ').toLowerCase(); return w.every(x => hay.includes(x)) }) : list };
const ebDaysTo = d => d ? Math.round((new Date(String(d).slice(0, 10) + 'T12:00:00') - new Date(new Date().toDateString() + ' 12:00:00')) / 864e5) : null;
function ebVisible() {
  const f = EB.f, have = new Set(S.events.map(e => skuOf(e)));
  return (EB.list || []).filter(e => {
    if (f.region && e.region !== f.region) return false;
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
const ebFiltersOn = () => !!(EB.f.region || EB.f.level || EB.f.when || EB.f.hide);
function ebFilters() {
  const L = EB.list || [], uniq = fn => [...new Set(L.map(fn).filter(Boolean))].sort(), f = EB.f;
  const when = EB.scope === 'past' ? [['', 'Any date'], ['l7', 'Last 7 days'], ['l30', 'Last 30 days'], ['tm', 'This month']] : [['', 'Any date'], ['n7', 'Next 7 days'], ['n30', 'Next 30 days'], ['tm', 'This month']];
  return `<div class="ebfilters">${dd('ebreg', f.region, [['', 'Any region'], ...uniq(e => e.region).map(x => [x, x])], { label: 'Region', value: f.region })}${dd('eblvl', f.level, [['', 'Any level'], ...uniq(e => e.level).map(x => [x, x])], { label: 'Level', value: f.level })}${dd('ebwhen', f.when, when, { label: 'Date', value: f.when })}<button type="button" class="chip ${f.hide ? 'on' : ''}" data-act="ebhide" aria-pressed="${f.hide}">Hide added</button>${ebFiltersOn() ? '<button type="button" class="link" data-act="ebreset">Clear</button>' : ''}</div>`;
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
  <input id="ebq" type="search" value="${esc(EB.q)}" placeholder="Search by name, city, region or code…" aria-label="Search events" autocomplete="off" spellcheck="false">
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
function ebKick() { const el = $('#eb'); if (el && !el.closest('details:not([open])') && EB.list === null && !EB.busy && code) ebLoad() }
function filt(q) { q = q.toLowerCase(); document.querySelectorAll('#tl2 .trow').forEach(c => c.style.display = c.dataset.q.includes(q) ? '' : 'none') }

const chips = (m, arr) => arr.map(n => `<button class="chip ${n === US ? 'me' : cls(m, n)}" data-act="team" data-t="${n}">${n}</button>`).join('');
function vMatches() {
  if (!evObj()) return empty('Pick an event first.');
  const all = matches(), list = mf === 'all' ? all : all.filter(m => side(m));
  const st = stats(), me = st.by.get(US), playedN = all.filter(m => side(m) && scored(m)).length;
  const rankChip = me && me.rank != null ? `<span class="hchip">Rank ${me.rank} of ${teams().length}</span>` : '';
  let h = `<section class="panel">${recStat(all.filter(m => side(m)))}</section>` +
    segBar([['ours', 'Our matches'], ['all', 'All matches']], mf, 'mfilter');
  h += list.map(m => {
    const s = side(m), o = open[m.id], ours = mf !== 'all' && !!s; // Our matches: our alliance is always the left column, and the score reads us–them
    const sides = [['r', 'Red alliance', m.red, 'red'], ['b', 'Blue alliance', m.blue, 'blue']]; if (ours && s === 'blue') sides.reverse();
    let res = '';
    if (s && scored(m)) { const a = s === 'red' ? m.rs : m.bs, b = s === 'red' ? m.bs : m.rs; res = a > b ? '<span class="res w">W</span>' : a < b ? '<span class="res l">L</span>' : '<span class="res">T</span>' }
    return `<div class="card ${s ? 'us' : ''}"><div class="mhead" data-act="mopen" data-id="${m.id}" role="button" aria-expanded="${!!o}"><span class="num">${esc(m.label)}</span>${scored(m) ? `<span class="score">${ours && s === 'blue' ? m.bs + '–' + m.rs : m.rs + '–' + m.bs}</span>` : ''}${res}<span class="grow"></span><span class="chev ${o ? 'up' : ''}" aria-hidden="true">›</span></div>
    <div class="vs">${sides.map(([c, l, arr, col]) => `<div class="side ${c} ${!ours && s === col ? 'mine' : ''}"><span>${l}</span>${chips(m, arr)}</div>`).join('')}</div>
    ${o ? `<div class="mx ${justOpened === m.id ? 'reveal' : ''}">` + (s ? `<h3>Strategy</h3>${noteBox('match', m.id, 'strat', 'Our strategy for this match…')}<h3>Our alliance</h3>${noteBox('match', m.id, 'ally', 'What our partner said / their plan…')}<h3>Opposition</h3>${noteBox('match', m.id, 'opp', 'Weaknesses, tendencies…')}`
        : `<h3>Notes</h3>${noteBox('match', m.id, 'gen', 'What happened in this match…')}`) + `<div class="foot"><button class="d" data-act="clearmatch" data-id="${m.id}">Clear all notes for this match</button><button class="d" data-act="delmatch" data-id="${m.id}">Delete match</button></div></div>` : ''}</div>`
  }).join('') || empty(mf === 'all' ? 'No matches yet.' : 'No matches with us yet.');
  h += `<details class="card" id="d-addmatch" ${det('d-addmatch', !all.length)}><summary><h2>Add a match manually</h2></summary><div class="row"><input id="m_l" placeholder="Label e.g. Q12"><input id="m_o" type="number" inputmode="numeric" placeholder="Match number (for sorting)"></div>
  <h3>Red alliance</h3><div class="row"><input id="m_r1" data-combo="teams" autocomplete="off" placeholder="Team"><input id="m_r2" data-combo="teams" autocomplete="off" placeholder="Team"></div>
  <h3>Blue alliance</h3><div class="row"><input id="m_b1" data-combo="teams" autocomplete="off" placeholder="Team"><input id="m_b2" data-combo="teams" autocomplete="off" placeholder="Team"></div>
  <div class="foot"><button class="p" data-act="addmatch">Add match</button></div>${tlist()}</details>`;
  return h;
}

// What 1 and 5 mean for each rating, shown under the buttons so a bare "3" always has a meaning.
const SCALE = { autoCons: ['Rarely works', 'Works every time'], driver: ['Beginner', 'Excellent'], driverCons: ['Many mistakes', 'Very steady'], speed: ['Slow', 'Very fast'], durability: ['Breaks easily', 'Very tough'], scoring: ['Poor', 'Excellent'], scoreCons: ['Hit or miss', 'Every time'], overall: ['Weak', 'Top pick'] };
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
      fld('f_reliable', 'Can they score reliably?', dd('f_reliable', d.reliable, opts(['Yes, reliable', 'Sometimes', 'No, bad at scoring'], 'Not sure yet'), { f: 'reliable' })) +
      fldR('scoreCons', 'Scoring consistency', d.scoreCons, 'Do they score about the same every match?'))}
    ${sect('Toggle', 'Whether they can hold a toggle, and how they do it.',
      fld('f_toggle', 'How well can they hold a toggle?', dd('f_toggle', d.toggle, opts(['Very well', 'Well', 'Decent', 'Not well', 'Not at all'], 'Not sure yet'), { f: 'toggle' })) +
      fld('f_toggleMech', 'Toggle mechanism', `<textarea id="f_toggleMech" data-f="toggleMech" placeholder="e.g. Pneumatic hook on the arm that clamps the top bar">${esc(d.toggleMech)}</textarea>`, 'Describe what they use to do the toggle (not a score).'))}
    ${sect('Overall', 'Your final read on this team.',
      fldR('overall', 'Overall rating', d.overall) +
      fld('f_good', 'Are they a good team?', dd('f_good', d.good, opts(['Yes', 'Decent', 'No'], 'Not sure yet'), { f: 'good' })) +
      fld('f_comments', 'Other comments & weaknesses', `<textarea id="f_comments" data-f="comments" placeholder="Anything else we should know…">${esc(d.comments)}</textarea>`))}
    <div class="card"><div class="foot"><span class="mut grow">✔ Autosaves as you go${online ? '' : ' (kept on this phone until you’re back online)'}.</span><button class="d" data-act="resetdraft">Reset</button><button class="p" data-act="donescout">Done</button></div></div>`;
  }
  const rel = n => { const a = [], o = []; ms.forEach(x => { const s = side(x, n); if (n === US || !s) return; (s === 'ally' ? a : o).push(x.label.replace(/^Mock /, '')) }); return { a, o } };
  const all = teams().filter(t => t.number !== US), mine = t => myScouts(t.number).length, left = all.filter(t => !mine(t)), show = sf === 'todo' ? left : all;
  const doneN = all.length - left.length;
  return `<div class="homehero scouthero"><span class="hl">Teams scouted</span><div class="hbig"><span data-count="${doneN}" data-ck="done">${doneN}</span><small>of ${all.length}</small></div><div class="sbar" role="progressbar" aria-valuenow="${doneN}" aria-valuemin="0" aria-valuemax="${all.length}"><i style="width:${all.length ? Math.round(100 * doneN / all.length) : 0}%"></i></div></div>
  <div class="scouthead"><span class="mut">Scouting as <b>${esc(name)}</b> · <button class="link" data-act="setname" data-v="">Change</button></span><span class="mut">${all.length - left.length} of ${all.length} done</span></div>
  ${segBar([['todo', 'To scout (' + left.length + ')'], ['all', 'All teams (' + all.length + ')']], sf, 'sfilter')}
  <p class="mut legend"><span class="mtag g">Q</span> plays with us <span class="mtag r">Q</span> plays against us</p>
  <div class="card list">${show.map(t => {
    const r = rel(t.number), n = mine(t);
    return `<div class="trow" data-act="startscout" data-t="${t.number}"><span class="num">${t.number}</span><div class="grow"><div>${esc(t.name)}</div>${r.a.length || r.o.length ? `<div class="rels">${r.a.map(l => `<span class="mtag g" title="With us in ${esc(l)}" aria-label="With us in ${esc(l)}">${esc(l)}</span>`).join('')}${r.o.map(l => `<span class="mtag r" title="Against us in ${esc(l)}" aria-label="Against us in ${esc(l)}">${esc(l)}</span>`).join('')}</div>` : ''}</div>${n ? `<span class="tick" title="You’ve scouted this${n > 1 ? ' (' + n + ' entries)' : ''}">✓${n > 1 ? ' ' + n : ''}</span>` : ''}<span class="chev" aria-hidden="true">›</span></div>`
  }).join('') || empty(all.length ? 'You’ve scouted every team. Switch to All teams to edit an entry.' : 'Add teams first.')}</div>`;
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
  const head = (title, sub, act) => `<div class="sheethead"><div class="grow"><h2>${title}</h2>${sub ? `<div class="mut">${sub}</div>` : ''}</div>${act || ''}<button data-act="close">Close</button></div>`;
  if (num === US) return head(`<span class="num">${esc(num)}</span> ${esc(tName(num) || 'Us')}`) + `<div class="card">That’s us. Scouting and team notes are turned off for our own team.</div>` + seasonCard(num);
  const t = teams().find(x => x.number === num) || { number: num, name: '', school: '' };
  const ms = matches().filter(m => m.red.includes(num) || m.blue.includes(num));
  const sc = notes('scout', num);
  const avg = f => { const v = sc.map(s => parseFloat(s[f])).filter(x => x > 0); return v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(1) : '-' };
  return head(`<span class="num">${esc(num)}</span> ${esc(t.name)}`, esc(t.school)) + `<button class="p wide" data-act="scoutfrom" data-t="${esc(num)}">Scout this team</button>
  ${(() => { const st = stats(), r = st.by.get(num); return r ? `<div class="card"><b>${st.official ? 'Rank' : 'Calculated rank'} ${r.rank ?? '–'}</b> · ${rec(r)} · WP ${r.wp ?? '–'}<div class="mut">OPR ${f1(r.opr)} · DPR ${f1(r.dpr)} · CCWM ${sgn(r.ccwm)}</div></div>` : '' })()}
  ${seasonCard(num)}
  <div class="card"><h2>Scouting averages</h2><p class="mut">From ${sc.length} ${sc.length === 1 ? 'entry' : 'entries'}. Ratings are out of 5.</p>${sc.length ? tiles([[avg('autoPts'), 'Auto points'], [avg('driver'), 'Driver skill'], [avg('speed'), 'Speed'], [avg('scoring'), 'Scoring'], [avg('durability'), 'Durability'], [avg('overall'), 'Overall']]) : ''}</div>
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
  <div class="card"><h2>Still to pick</h2><p class="mut">Tap a team to add it to the list.</p>${avail.map(t => `<button class="chip" data-act="addpick" data-t="${t.number}">${t.number}</button>`).join('') || '<span class="mut">Every team is on the list.</span>'}</div>${tlist()}`;
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
  else if (id === 'scm') { flushDraft(); loadDraft(scTeam, v); render() }
  else if (id === 'ebreg' || id === 'eblvl' || id === 'ebwhen') { EB.f[{ ebreg: 'region', eblvl: 'level', ebwhen: 'when' }[id]] = v; ebPaint() }
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
  if (a === 'tab') { flushDraft(); const o = TABS.findIndex(t => t[0] === tab), n = TABS.findIndex(t => t[0] === b.dataset.v); navAnim = n > o ? 'fwd' : n < o ? 'back' : ''; tab = b.dataset.v; ls('tab', tab); render(); scrollTo({ top: 0, behavior: 'instant' }) }
  else if (a === 'login') {
    const t = norm(v('w_team')), c = $('#codein').value.trim();
    if (!t || !c) { loginErr = 'Enter your team number and team code.'; render(); return }
    const prevTeam = team, prevCode = code; team = t; code = c; loginErr = false; wbusy = true; render();
    api('/login', {}).then(d => { wbusy = false; useTeam(t, d.team); ls('code', c); online = true; render(); return flush().then(pull) }).then(schedule)
      .catch(e => { wbusy = false; code = ''; team = prevTeam; if (e instanceof NetErr) loginErr = 'Can’t reach Recon. Check your connection.'; else if (!(e instanceof AuthErr)) loginErr = e.message; render() });
  }
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
    ask('Log out of this device?', unsent + 'To get back in you need the team number and the team code (' + code + '). Make sure you have the code saved before you log out.', 'Log out').then(ok => { if (!ok) return; code = ''; ls('code', ''); outbox = []; lsJ('outbox', []); lsJ('cache', null); for (const k of COLS) S[k] = []; lastV = -1; loaded = false; rkShown = ''; RK = null; EB.list = null; schedule(); render(); setStatus() })
  }
  else if (a === 'ebscope') { EB.scope = b.dataset.v; ls('ebs', EB.scope); EB.msg = ''; EB.f.when = ''; clearTimeout(ebT); ebLoad(); render() }
  else if (a === 'ebhide') { EB.f.hide = !EB.f.hide; ebPaint() }
  else if (a === 'ebreset') { EB.f = { region: '', level: '', when: '', hide: false }; ebPaint() }
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
  else if (a === 'reimport') doImport(skuOf(evObj()), sayIn('impmsg2'));
  else if (a === 'team') { mTeam = b.dataset.t; render() }
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
  else if (a === 'gomatch') { const id = b.dataset.id; tab = 'matches'; ls('tab', tab); mf = 'ours'; ls('mf', mf); open[id] = true; justOpened = id; navAnim = 'fwd'; render(); const c = document.querySelector(`#app [data-act="mopen"][data-id="${id}"]`); if (c) setTimeout(() => { c.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' }); flash(c.closest('.card')) }, 120) }
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
  else if (a === 'startscout') { if (!name || b.dataset.t === US) return; flushDraft(); scTeam = b.dataset.t; loadDraft(scTeam, ''); navAnim = 'fwd'; render() }
  else if (a === 'scoutfrom') { const t = b.dataset.t; flushDraft(); mTeam = null; tab = 'scout'; ls('tab', tab); if (name && t !== US) { scTeam = t; loadDraft(t, '') } else { scTeam = ''; draft = null } render() }
  else if (a === 'donescout') { flushDraft(); scTeam = ''; draft = null; navAnim = 'back'; render() }
  else if (a === 'resetdraft') { if (sure(b)) { draft = { ...newDraft(scTeam, draft.match), id: draft.id }; saveDraft(0); lastView = ''; render() } }
  else if (a === 'setname') { flushDraft(); scTeam = ''; draft = null; name = b.dataset.v; ls('name', name); render() }
  else if (a === 'theme') { ls('theme', (ls('theme') || osTheme()) === 'dark' ? 'light' : 'dark'); applyTheme() }
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
  const go = { codein: 'login', w_team: 'login', w_new: 'wlookup', w_rc: 'rcgo', w_rk: 'rcgo', myname: 'addname', newscout: 'addscout' }[e.target.id];
  if (go) { e.preventDefault(); document.querySelector(`[data-act=${go}]`)?.click() }
});
document.addEventListener('visibilitychange', () => { if (document.hidden) flushDraft(); else if (code) { flush(); pull() } });
window.addEventListener('online', () => { if (code) { online = true; flush().then(pull) } });
window.addEventListener('offline', () => { online = false; setStatus() });
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('/sw.js').catch(() => {});
applyTheme(); init();
