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
const COLS = ['events', 'teams', 'matches', 'notes', 'config', 'rankings'];
let S = { events: [], teams: [], matches: [], notes: [], config: [], rankings: [] };
let ev = ls('ev'), tab = ls('tab') || 'event', name = ls('name'), mf = ls('mf') || 'ours', tv = ls('tv') || 'list', rks = ls('rks') || 'rank';
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
  const by = new Map(nums.map(t => [t, { w: 0, l: 0, t: 0, played: 0, opr: 0, dpr: 0, ccwm: 0 }]));
  if (n) {
    const AtA = nums.map(() => new Array(n).fill(0)), bo = new Array(n).fill(0), bd = new Array(n).fill(0);
    for (const m of qs) for (const [mine, other, ms, os] of [[m.red, m.blue, m.rs, m.bs], [m.blue, m.red, m.bs, m.rs]]) {
      for (const a of mine) {
        for (const b of mine) AtA[idx.get(a)][idx.get(b)]++;
        bo[idx.get(a)] += ms; bd[idx.get(a)] += os;
        const r = by.get(a); r.played++; if (ms > os) r.w++; else if (ms < os) r.l++; else r.t++;
      }
    }
    const reg = () => AtA.map((row, i) => row.map((v, j) => v + (i === j ? 1e-3 : 0))); // tiny ridge keeps it solvable early on
    const opr = solve(reg(), bo), dpr = solve(reg(), bd);
    nums.forEach((t, i) => { const r = by.get(t); r.opr = opr[i]; r.dpr = dpr[i]; r.ccwm = opr[i] - dpr[i]; r.wp = 2 * r.w + r.t });
  }
  // rank: official from VEX Events if we have it, otherwise calculated (win points, then OPR)
  const official = offList.length > 0;
  if (official) for (const o of offList) by.set(o.team, { ...(by.get(o.team) || { opr: null, dpr: null, ccwm: null, played: o.w + o.l + o.t }), rank: o.rank, w: o.w, l: o.l, t: o.t, wp: o.wp, ap: o.ap, sp: o.sp, div: o.div });
  else[...by.entries()].sort((a, b) => b[1].wp - a[1].wp || b[1].opr - a[1].opr).forEach(([, r], i) => { r.rank = i + 1 });
  const divs = new Set(offList.map(o => o.div));
  return (statsMemo = { key, val: { by, official, multiDiv: divs.size > 1, n: qs.length } }).val;
}
const f1 = v => v == null || isNaN(v) ? '–' : v.toFixed(1);
const sgn = v => v == null || isNaN(v) ? '–' : (v > 0 ? '+' : '') + v.toFixed(1);
const rec = r => r.w + '-' + r.l + '-' + r.t;
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
    for (const k of ['teams', 'matches', 'notes']) S[k] = S[k].filter(x => x.eventId !== o.purge);
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
function send(o) { editSeq++; applyOp(o); queue(o); cacheState(); setStatus(); flush(); setTimeout(render, 0) }
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
function syncRE() { const s = skuOf(evObj()); if (!s || syncing || document.hidden || !online) return; syncing = true; api('/import', { sku: s, light: true }).catch(() => {}).finally(() => { syncing = false }) }
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

const loginHTML = () => `<div class="card"><h2>Team code</h2><p class="mut">Enter the team code to open Invictus scouting.</p><input id="codein" type="password" autocomplete="current-password" placeholder="Team code">${loginErr ? '<p style="color:var(--rd)">That code didn’t work.</p>' : ''}<button data-act="login">Open</button></div>`;

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
  ['teams', '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.5 2.7-6 6-6s6 2.5 6 6"/><circle cx="17" cy="9" r="2.5"/><path d="M17 14c2.5 0 4 2 4 5"/></svg>', 'Teams'],
  ['matches', '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12" rx="3"/><path d="M12 6v12M8 12h.01M16 12h.01"/></svg>', 'Matches'],
  ['scout', '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l5 5"/></svg>', 'Scout'],
  ['pick', '<svg viewBox="0 0 24 24"><path d="M7 4h10v4a5 5 0 0 1-10 0zM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3M12 13v4M8 21h8M10 17h4"/></svg>', 'Picklist']];

let dragging = false;
function render() {
  if (dragging) { dirty = true; return }
  if (!code) { $('#nav').innerHTML = ''; $('#app').innerHTML = loginHTML(); $('#evname').textContent = 'Team login'; return }
  if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { dirty = true; return }
  dirty = false;
  US = norm(cfg().us) || DEFAULT_US;
  NAMES = Array.isArray(cfg().names) && cfg().names.length ? cfg().names : DEFAULT_NAMES;
  if (loaded && name && !NAMES.includes(name)) { name = ''; ls('name', '') }
  $('#evname').textContent = evObj() ? evObj().name : 'Choose an event to start';
  $('#nav').innerHTML = TABS.map(t => `<button class="${tab === t[0] ? 'on' : ''}" data-act="tab" data-v="${t[0]}">${t[1]}<span>${t[2]}</span></button>`).join('');
  const y = scrollY;
  $('#app').innerHTML = ({ event: vEvent, teams: vTeams, matches: vMatches, scout: vScout, pick: vPick })[tab]();
  scrollTo(0, y);
  $('#mbody').innerHTML = mTeam ? vTeam(mTeam) : ''; $('#modal').style.display = mTeam ? 'block' : 'none';
}
function noteBox(kind, ref, sec, ph) {
  const id = 'n' + uid();
  return `<textarea id="${id}" placeholder="${esc(ph || 'Write a note…')}"></textarea><button data-act="addnote" data-kind="${kind}" data-ref="${esc(ref || '')}" data-sec="${sec || ''}" data-in="${id}">Add note</button>` +
    notes(kind, ref || '', sec || '').map(noteRow).join('');
}
const when = ts => new Date(ts).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
const noteRow = n => `<div class="note">${esc(n.text)}<small>${esc(n.by || '?')} · ${when(n.ts)} <button class="d" data-act="delnote" data-id="${n.id}">delete</button></small></div>`;
const nameChips = () => NAMES.map(n => `<button class="chip ${name === n ? 'me' : ''}" data-act="setname" data-v="${esc(n)}">${esc(n)}</button>`).join('');

function vEvent() {
  const e = evObj(), c = cfg();
  let h = `<div class="card"><h2>Import from VEX Events</h2><p class="mut">Pulls the event, teams and matches. Press it again any time to update.</p><input id="sku" value="${esc(skuOf(e) || 'RE-V5RC-26-5068')}" placeholder="Event code e.g. RE-V5RC-26-5068"><button data-act="import">Import / update now</button> <span class="mut" id="impmsg"></span></div><div class="card"><h2>Who are you?</h2><p class="mut">Your name goes on your notes and scouting.</p>${nameChips()}</div>
  <div class="card"><h2>Event</h2>
  <select id="evsel"><option value="">— choose event —</option>${S.events.map(x => `<option value="${x.id}" ${x.id === ev ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
  <div class="row"><input id="newev" placeholder="New event name"><button data-act="addev">Add event</button></div></div>`;
  if (e) {
    h += `<div class="card"><h2>${esc(e.name)}</h2><h3>RobotEvents link</h3>
    <input id="evlink" value="${esc(e.link || '')}" placeholder="Paste the VEX event link here">
    ${e.link ? `<p><a href="${esc(e.link)}" target="_blank" rel="noopener"><button type="button">Open event page ↗</button></a></p>` : ''}
    <button class="d" data-act="delev">Delete event and all its notes</button></div>
    <div class="card"><h2>Alliance requests</h2><p class="mut">Teams that asked to ally with us & what they told us they’re good at.</p>
    <div class="row"><input id="rq_t" list="tl" placeholder="Team #"><input id="rq_x" placeholder="Their strengths"><button data-act="addreq">Add</button></div>
    ${notes('req').map(n => `<div class="note"><b>${esc(n.ref)}</b> ${esc(tName(n.ref))} — ${esc(n.text)}<small>${esc(n.by || '')} <button class="d" data-act="delnote" data-id="${n.id}">delete</button></small></div>`).join('')}</div>
    <div class="card"><h2>Event notes</h2>${noteBox('event', '', '', 'Anything about this event…')}</div>`;
  } else h += '<p class="mut">Create or pick an event to start.</p>';
  h += `<details class="card"><summary><h2>Team settings</h2></summary>
    <h3>Our team number</h3><input id="cfg_us" value="${esc(c.us || DEFAULT_US)}" placeholder="e.g. 52111A">
    <h3>Scout names (comma separated)</h3><input id="cfg_names" value="${esc(NAMES.join(', '))}">
    <p class="row"><button data-act="savecfg">Save settings</button><button class="g" data-act="logout">Log out</button></p>
    <p class="mut">Settings are shared with everyone on the team.</p></details>`;
  return h + tlist();
}
const tlist = () => `<datalist id="tl">${teams().map(t => `<option value="${t.number}">${esc(t.name)}</option>`).join('')}</datalist>`;

function vTeams() {
  if (!evObj()) return '<p class="mut">Pick an event first.</p>';
  const seg = `<div class="seg">${[['list', 'All teams'], ['rank', 'Rankings']].map(([k, l]) => `<button class="${tv === k ? 'on' : ''}" data-act="tview" data-v="${k}">${l}</button>`).join('')}</div>`;
  if (tv === 'rank') return seg + vRank();
  return seg + `<div class="card"><h2>Add team</h2><div class="row"><input id="t_n" placeholder="Number e.g. 52111A"><input id="t_name" placeholder="Team name"><input id="t_s" placeholder="School"><button data-act="addteam">Add</button></div></div>
  <input id="tsearch" placeholder="Search teams…" oninput="filt(this.value)">
  <div id="tl2">${teams().map(t => `<div class="card ${t.number === US ? 'us' : ''}" data-q="${esc((t.number + t.name + t.school).toLowerCase())}"><div class="row" style="flex-wrap:nowrap"><div style="flex:1;cursor:pointer" data-act="team" data-t="${t.number}"><span class="num">${t.number}</span>${esc(t.name)}<div class="mut">${esc(t.school)} · ${notes('scout', t.number).length + notes('team', t.number).length} notes</div></div><button class="d" data-act="delteam" data-id="${t.id}">✕</button></div></div>`).join('') || '<p class="mut">No teams yet.</p>'}</div>`;
}
function vRank() {
  const st = stats(), rows = [...st.by.entries()].map(([team, r]) => ({ ...r, team }));
  if (!rows.length) return '<div class="card"><h2>Rankings</h2><p class="mut">No qualification matches have been scored yet. Rankings and OPR show up here once they are.</p></div>';
  const key = { rank: (a, b) => (a.div || 0) - (b.div || 0) || a.rank - b.rank, opr: (a, b) => (b.opr ?? -1e9) - (a.opr ?? -1e9), ccwm: (a, b) => (b.ccwm ?? -1e9) - (a.ccwm ?? -1e9) }[rks];
  rows.sort(key);
  return `<div class="card"><h2>Rankings</h2><p class="mut">${st.official ? 'Official rankings from VEX Events.' : 'Calculated from qualification scores (win points, then OPR). Official rankings replace these once VEX Events has them.'} OPR uses ${st.n} scored qualification ${st.n === 1 ? 'match' : 'matches'}.</p>
  <div class="seg">${[['rank', 'Rank'], ['opr', 'OPR'], ['ccwm', 'CCWM']].map(([k, l]) => `<button class="${rks === k ? 'on' : ''}" data-act="rksort" data-v="${k}">Sort by ${l}</button>`).join('')}</div>
  <div class="tblwrap"><table class="rk"><thead><tr><th>#</th><th>Team</th><th>W-L-T</th><th>WP</th><th class="wide">AP</th><th class="wide">SP</th><th>OPR</th><th class="wide">DPR</th><th>CCWM</th></tr></thead><tbody>
  ${rows.map(r => `<tr class="${r.team === US ? 'us' : ''}" data-act="team" data-t="${esc(r.team)}"><td>${st.multiDiv ? 'D' + r.div + '·' : ''}${r.rank ?? '–'}</td><td><b>${esc(r.team)}</b></td><td>${rec(r)}</td><td>${r.wp ?? '–'}</td><td class="wide">${r.ap ?? '–'}</td><td class="wide">${r.sp ?? '–'}</td><td>${f1(r.opr)}</td><td class="wide">${f1(r.dpr)}</td><td>${sgn(r.ccwm)}</td></tr>`).join('')}
  </tbody></table></div>
  <p class="mut">OPR ≈ points a team adds to its alliance. DPR ≈ points the other alliance scores against it. CCWM = OPR − DPR, its effect on the winning margin. Tap a team for details.</p></div>`;
}
function filt(q) { q = q.toLowerCase(); document.querySelectorAll('#tl2 .card').forEach(c => c.style.display = c.dataset.q.includes(q) ? '' : 'none') }

const chips = (m, arr) => arr.map(n => `<button class="chip ${n === US ? 'me' : cls(m, n)}" data-act="team" data-t="${n}">${n}</button>`).join('');
function vMatches() {
  if (!evObj()) return '<p class="mut">Pick an event first.</p>';
  const all = matches(), list = mf === 'all' ? all : all.filter(m => side(m));
  let h = `<div class="seg">${[['ours', 'Our matches'], ['all', 'All matches']].map(([k, l]) => `<button class="${mf === k ? 'on' : ''}" data-act="mfilter" data-v="${k}">${l}</button>`).join('')}</div>`;
  h += list.map(m => {
    const s = side(m), o = open[m.id];
    let res = '';
    if (s && scored(m)) { const a = s === 'red' ? m.rs : m.bs, b = s === 'red' ? m.bs : m.rs; res = a > b ? '<span class="res w">W</span>' : a < b ? '<span class="res l">L</span>' : '<span class="res">T</span>' }
    return `<div class="card ${s ? 'us' : ''}"><div class="mhead" data-act="mopen" data-id="${m.id}"><span class="num">${esc(m.label)}</span>${scored(m) ? `<span class="score">${m.rs}–${m.bs}</span>` : ''}${res}<span class="grow"></span>${s ? `<span class="tag" style="background:${s === 'red' ? 'var(--rd)' : 'var(--ac)'}">We’re ${s}</span>` : ''}<span aria-hidden="true">${o ? '▲' : '▼'}</span></div>
    <div class="vs"><div class="side r"><span>Red alliance</span>${chips(m, m.red)}</div><div class="side b"><span>Blue alliance</span>${chips(m, m.blue)}</div></div>
    ${o ? (s ? `<h3>Strategy</h3>${noteBox('match', m.id, 'strat', 'Our strategy for this match…')}<h3>Our alliance</h3>${noteBox('match', m.id, 'ally', 'What our partner said / their plan…')}<h3>Opposition</h3>${noteBox('match', m.id, 'opp', 'Weaknesses, tendencies…')}`
        : `<h3>Notes</h3>${noteBox('match', m.id, 'gen', 'What happened in this match…')}`) + `<button class="d" data-act="clearmatch" data-id="${m.id}">Clear all notes for this match</button> <button class="d" data-act="delmatch" data-id="${m.id}">Delete match</button>` : ''}</div>`
  }).join('') || `<p class="mut">${mf === 'all' ? 'No matches yet.' : 'No matches with us yet.'}</p>`;
  h += `<details class="card" ${all.length ? '' : 'open'}><summary><h2>Add a match manually</h2></summary><div class="row"><input id="m_l" placeholder="Label e.g. Q12"><input id="m_o" type="number" inputmode="numeric" placeholder="Match number (for sorting)"></div>
  <h3>Red alliance</h3><div class="row"><input id="m_r1" list="tl" placeholder="Team"><input id="m_r2" list="tl" placeholder="Team"></div>
  <h3>Blue alliance</h3><div class="row"><input id="m_b1" list="tl" placeholder="Team"><input id="m_b2" list="tl" placeholder="Team"></div>
  <p><button data-act="addmatch">Add match</button></p>${tlist()}</details>`;
  return h;
}

const R = (f, v) => `<div class="rate">${[1, 2, 3, 4, 5].map(i => `<button data-act="rate" data-f="${f}" data-v="${i}" class="${v === i ? 'on' : ''}">${i}</button>`).join('')}</div>`;
function vScout() {
  if (!evObj()) return '<p class="mut">Pick an event first.</p>';
  if (!name) return `<div class="card"><h2>Who’s scouting?</h2><p class="mut">Pick your name. You can scout each team once overall, plus once per match you watch, and come back to edit.</p>${nameChips()}</div>`;
  const ms = matches();
  if (scTeam && draft) {
    const d = draft, tms = ms.filter(m => m.red.includes(scTeam) || m.blue.includes(scTeam));
    const rel = m => { const s = side(m, scTeam); return s === 'ally' ? ' · with us' : s === 'opp' ? ' · against us' : '' };
    return `<p><button class="g" data-act="donescout">‹ Back to teams</button></p>
    <div class="card" style="border:2px solid var(--ac)"><h2><span class="num">${scTeam}</span> ${esc(tName(scTeam))}</h2>
    <h3>What are you scouting?</h3><select id="scm"><option value="">Overall / pit scouting (not one match)</option>${tms.map(m => `<option value="${esc(m.id)}" ${d.match === m.id ? 'selected' : ''}>Match ${esc(m.label)}${rel(m)}${scored(m) ? ' · played' : ''}</option>`).join('')}</select>
    <div class="rem">Remember to note: autonomous points & consistency · driver skill & consistency · robot type & design · speed · scoring · consistency · durability · overall.</div>
    <h3>Autonomous</h3><input data-f="autoPts" value="${esc(d.autoPts)}" placeholder="Auto points they score"><div class="mut">Auto consistency</div>${R('autoCons', d.autoCons)}<textarea data-f="autoNotes" placeholder="What does their auto do?">${esc(d.autoNotes)}</textarea>
    <h3>Driver</h3><div class="mut">Driver skill</div>${R('driver', d.driver)}<div class="mut">Driver consistency</div>${R('driverCons', d.driverCons)}<textarea data-f="driveNotes" placeholder="Driving notes (how they drive, strategy, mistakes, how well they play defence, etc.)">${esc(d.driveNotes)}</textarea>
    <h3>Robot</h3><input data-f="robotType" value="${esc(d.robotType)}" placeholder="Robot type & design (drivetrain, intake, scorer…)">
    <div class="mut">Speed</div>${R('speed', d.speed)}<div class="mut">Durability</div>${R('durability', d.durability)}
    <h3>Scoring</h3><div class="mut">Scoring ability</div>${R('scoring', d.scoring)}<div class="mut">Can they score reliably?</div>
    <select data-f="reliable"><option value="">—</option>${['Yes, reliable', 'Sometimes', 'No, bad at scoring'].map(o => `<option ${d.reliable === o ? 'selected' : ''}>${o}</option>`).join('')}</select>
    <div class="mut">Scoring consistency</div>${R('scoreCons', d.scoreCons)}
    <h3>Toggle</h3><div class="mut">How well can they hold a toggle?</div>
    <select data-f="toggle"><option value="">—</option>${['Very well', 'Well', 'Decent', 'Not well', 'Not at all'].map(o => `<option ${d.toggle === o ? 'selected' : ''}>${o}</option>`).join('')}</select>
    <div class="mut">How good is their toggle mechanism?</div>${R('toggleQ', d.toggleQ)}
    <h3>Overall</h3><div class="mut">Overall rating</div>${R('overall', d.overall)}
    <select data-f="good"><option value="">Are they good?</option>${['Yes', 'Decent', 'No'].map(o => `<option ${d.good === o ? 'selected' : ''}>${o}</option>`).join('')}</select>
    <textarea data-f="comments" placeholder="Other comments, weaknesses…">${esc(d.comments)}</textarea>
    <p class="mut">✔ Autosaves as you go${online ? '' : ' (kept on this phone until you’re back online)'}.</p><div class="row"><button data-act="resetdraft" class="g">Reset</button><button data-act="donescout">Done – back to teams</button></div></div>`;
  }
  const rel = n => { const a = [], o = []; ms.forEach(x => { const s = side(x, n); if (n === US || !s) return; (s === 'ally' ? a : o).push(x.label.replace(/^Mock /, '')) }); return { a, o } };
  return `<div class="card"><h2>Pick a team to scout</h2><p class="mut">Scouting as <b>${esc(name)}</b> <button class="d" data-act="setname" data-v="">change</button></p><p class="mut">Green = we play with them · Red = we play against them · Half and half = both</p>${teams().filter(t => t.number !== US).map(t => {
    const r = rel(t.number), c = r.a.length && !r.o.length ? 'gn' : r.o.length && !r.a.length ? 'rd' : r.a.length && r.o.length ? 'both' : '', mine = myScouts(t.number).length;
    return `<div class="trow ${scTeam === t.number ? 'sel' : ''}" data-act="startscout" data-t="${t.number}"><span class="chip ${c}">${t.number}</span><div style="flex:1"><div>${esc(t.name)}</div>${mine ? `<div class="lab" style="color:var(--ac)">✓ You’ve scouted this${mine > 1 ? ' (' + mine + ' entries)' : ''}</div>` : ''}${r.a.length ? `<div class="lab g">With us: ${r.a.join(', ')}</div>` : ''}${r.o.length ? `<div class="lab r">Against us: ${r.o.join(', ')}</div>` : ''}${!r.a.length && !r.o.length ? '<span class="mut">Not in a match with us</span>' : ''}</div></div>`
  }).join('') || '<span class="mut">Add teams first.</span>'}</div>`;
}
function newDraft(t, matchId) {
  const m = matchId && S.matches.find(x => x.id === matchId);
  return { id: scoutId(t, name, matchId), eventId: ev, kind: 'scout', ref: t, by: name, ts: Date.now(), text: '', match: matchId || '', matchLabel: m ? m.label : '' };
}
function loadDraft(t, matchId) { const id = scoutId(t, name, matchId), ex = S.notes.find(n => n.id === id); draft = ex ? { ...ex } : newDraft(t, matchId) }
let saveT = null;
function saveDraft(ms = 600) { clearTimeout(saveT); saveT = setTimeout(flushDraft, ms) }
// Write the draft now if an autosave is pending (called before leaving the form so the last edits aren't lost).
function flushDraft() { if (saveT === null) return; clearTimeout(saveT); saveT = null; if (draft) { draft.by = name; put('notes', draft.id, { ...draft }) } }
const sum = n => `<div class="note"><b>${n.matchLabel ? 'Match ' + esc(n.matchLabel) : 'Overall'}</b> <small>${esc(n.by || '')} · ${when(n.ts)}</small>
 Auto: ${esc(n.autoPts || '-')} pts, consistency ${n.autoCons || '-'}/5 ${esc(n.autoNotes || '')}
 Driver ${n.driver || '-'}/5 (consistency ${n.driverCons || '-'}/5) ${esc(n.driveNotes || '')}
 Speed ${n.speed || '-'}/5 · Durability ${n.durability || '-'}/5
 Robot: ${esc(n.robotType || '-')}
 Scoring ${n.scoring || '-'}/5 (consistency ${n.scoreCons || '-'}/5) · ${esc(n.reliable || '-')}
 Toggle: ${esc(n.toggle || '-')} (mech ${n.toggleQ || '-'}/5)
 Overall ${n.overall || '-'}/5 · ${esc(n.good || '-')}
 ${esc(n.comments || '')}</div>`;

function vTeam(num) {
  if (num === US) return `<div class="row" style="flex-wrap:nowrap"><h2 style="flex:1"><span class="num" style="font-size:34px">${esc(num)}</span> ${esc(tName(num) || 'Us')}</h2><button class="g" data-act="close">Close</button></div><div class="card">That’s us. Scouting and team notes are turned off for our own team.</div>`;
  const t = teams().find(x => x.number === num) || { number: num, name: '', school: '' };
  const ms = matches().filter(m => m.red.includes(num) || m.blue.includes(num));
  const sc = notes('scout', num);
  const avg = f => { const v = sc.map(s => parseFloat(s[f])).filter(x => x > 0); return v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(1) : '-' };
  return `<div class="row" style="flex-wrap:nowrap"><h2 style="flex:1">${esc(num)} ${esc(t.name)}</h2><button class="g" data-act="close">Close</button></div><div class="mut">${esc(t.school)}</div>
  ${(() => { const st = stats(), r = st.by.get(num); return r ? `<div class="card"><b>${st.official ? 'Rank' : 'Calculated rank'} ${r.rank ?? '–'}</b> · ${rec(r)} · WP ${r.wp ?? '–'}<div class="mut">OPR ${f1(r.opr)} · DPR ${f1(r.dpr)} · CCWM ${sgn(r.ccwm)}</div></div>` : '' })()}
  <div class="card"><b>Averages</b> (${sc.length} ${sc.length === 1 ? 'entry' : 'entries'})<div class="mut">Auto ${avg('autoPts')} pts · Driver ${avg('driver')} · Speed ${avg('speed')} · Scoring ${avg('scoring')} · Durability ${avg('durability')} · Overall ${avg('overall')}</div></div>
  <div class="card"><h2>Matches</h2>${ms.map(m => `<span class="chip ${side(m, num) === 'ally' ? 'gn' : side(m, num) === 'opp' ? 'rd' : ''}">${esc(m.label)}</span>`).join('') || '<span class="mut">None</span>'}</div>
  <div class="card"><h2>Notes on this team</h2>${noteBox('team', num, '', 'Add a note about ' + num + '…')}${notes('team', num).length ? `<button class="d" data-act="clearnotes" data-t="${num}">Clear all notes on this team</button>` : ''}</div>
  <div class="card"><h2>Scouting entries</h2>${sc.map(s => sum(s)).join('') || '<span class="mut">None yet</span>'}${sc.length ? `<button class="d" data-act="clearscout" data-t="${num}">Clear all scouting entries</button>` : ''}</div>
  <div class="card"><h2>Alliance requests</h2>${notes('req', num).map(n => `<div class="note">${esc(n.text)}</div>`).join('') || '<span class="mut">None</span>'}</div>`;
}

function vPick() {
  const e = evObj(); if (!e) return '<p class="mut">Pick an event first.</p>';
  const p = e.picks || [], avail = teams().filter(t => t.number !== US && !p.includes(t.number));
  return `<div class="card"><h2>Finals picklist</h2><p class="mut">Hold the ≡ handle and drag to reorder, or use the arrows. #1 is who we want most.</p><div id="pklist">${p.map((n, i) => `<div class="pk" data-i="${i}"><span class="grip" title="Drag to reorder">≡</span><span class="num" style="width:34px;color:var(--ac)">${i + 1}</span><div style="flex:1;cursor:pointer" data-act="team" data-t="${n}"><span class="num">${n}</span>${esc(tName(n))}<div class="mut">${(r => r ? 'Rank ' + (r.rank ?? '–') + ' · OPR ' + f1(r.opr) + ' · ' : '')(stats().by.get(n))}${notes('req', n).length ? 'Asked to ally · ' : ''}${notes('scout', n).length} scouting entries</div></div><span class="arrows"><button class="g" data-act="pup" data-i="${i}" aria-label="Move up" ${i ? '' : 'disabled'}>▲</button><button class="g" data-act="pdn" data-i="${i}" aria-label="Move down" ${i < p.length - 1 ? '' : 'disabled'}>▼</button></span><button class="d" data-act="prm" data-i="${i}">Remove</button></div>`).join('') || '<p class="mut">Nothing yet. Tap a team below to add it.</p>'}</div></div>
  <div class="card"><h2>Still to pick</h2><p class="mut">Tap a team to add it to the list.</p>${avail.map(t => `<button class="chip" data-act="addpick" data-t="${t.number}">${t.number}</button>`).join('') || '<span class="mut">Every team is on the list.</span>'}</div>`;
}
const setPicks = p => upd('events', ev, { picks: p });

// ---------- events ----------
function sure(b) { if (b.dataset.armed) return true; const t = b.textContent; b.dataset.armed = 1; b.textContent = 'Tap again to confirm'; b.style.fontWeight = 700; setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = t; b.style.fontWeight = '' } }, 3000); return false }
document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return; const a = b.dataset.act, v = id => $('#' + id)?.value?.trim() || '';
  const me = name || 'Someone';
  if (a === 'tab') { flushDraft(); tab = b.dataset.v; ls('tab', tab); render() }
  else if (a === 'login') { code = $('#codein').value.trim(); loginErr = false; api('/login', {}).then(() => { ls('code', code); online = true; return flush().then(pull) }).then(schedule).catch(e => { if (e instanceof NetErr) toast('Can’t reach the server. Check your connection.') }) }
  else if (a === 'logout') { if (sure(b)) { if (outbox.length && !confirm(outbox.length + ' changes haven’t been sent yet and will be lost. Log out anyway?')) return; code = ''; ls('code', ''); outbox = []; lsJ('outbox', []); lsJ('cache', null); schedule(); render(); setStatus() } }
  else if (a === 'import') { const m = $('#impmsg'); m.textContent = 'Importing…'; api('/import', { sku: norm(v('sku')) }).then(d => { ev = d.eventId; ls('ev', ev); return pull() }).catch(e => { m.textContent = 'Failed: ' + String(e.message || e).slice(0, 140) }) }
  else if (a === 'team') { mTeam = b.dataset.t; render() }
  else if (a === 'close') { mTeam = null; render() }
  else if (a === 'addev') { const n = v('newev'); if (n) { const id = uid(); put('events', id, { name: n, link: '', picks: [] }); ev = id; ls('ev', id) } }
  else if (a === 'delev') { if (sure(b)) { send({ purge: ev }); ev = S.events[0] ? S.events[0].id : ''; ls('ev', ev) } }
  else if (a === 'savecfg') { const us = norm(v('cfg_us')) || DEFAULT_US, names = [...new Set(v('cfg_names').split(',').map(s => s.trim()).filter(Boolean))]; put('config', 'main', { us, names: names.length ? names : DEFAULT_NAMES }); toast('Settings saved') }
  else if (a === 'addteam') { const n = norm(v('t_n')); if (n) put('teams', ev + '_' + n, { eventId: ev, number: n, name: v('t_name'), school: v('t_s') }) }
  else if (a === 'delteam') { if (sure(b)) del('teams', b.dataset.id) }
  else if (a === 'addmatch') {
    const r = ['m_r1', 'm_r2'].map(i => norm(v(i))).filter(Boolean), bl = ['m_b1', 'm_b2'].map(i => norm(v(i))).filter(Boolean);
    if (v('m_l') && (r.length || bl.length)) put('matches', uid(), { eventId: ev, label: v('m_l'), order: +v('m_o') || matches().length + 1, red: r, blue: bl })
  }
  else if (a === 'delmatch') { if (sure(b)) del('matches', b.dataset.id) }
  else if (a === 'mopen') { open[b.dataset.id] = !open[b.dataset.id]; render() }
  else if (a === 'tview') { tv = b.dataset.v; ls('tv', tv); render() }
  else if (a === 'rksort') { rks = b.dataset.v; ls('rks', rks); render() }
  else if (a === 'mfilter') { mf = b.dataset.v; ls('mf', mf); render() }
  else if (a === 'addnote') { const t = $('#' + b.dataset.in).value.trim(); if (t && !(b.dataset.kind === 'team' && b.dataset.ref === US)) put('notes', uid(), { eventId: ev, kind: b.dataset.kind, ref: b.dataset.ref, sec: b.dataset.sec, text: t, by: me, ts: Date.now() }); $('#' + b.dataset.in).value = '' }
  else if (a === 'delnote') { if (sure(b)) del('notes', b.dataset.id) }
  else if (a === 'addreq') { const t = norm(v('rq_t')); if (t && t !== US && v('rq_x')) put('notes', uid(), { eventId: ev, kind: 'req', ref: t, text: v('rq_x'), by: me, ts: Date.now() }) }
  else if (a === 'clearnotes') { if (sure(b)) notes('team', b.dataset.t).forEach(n => del('notes', n.id)) }
  else if (a === 'clearscout') { if (sure(b)) { notes('scout', b.dataset.t).forEach(n => del('notes', n.id)); if (scTeam === b.dataset.t) { saveT = null; draft = null; scTeam = '' } } }
  else if (a === 'clearmatch') { if (sure(b)) notes('match', b.dataset.id).forEach(n => del('notes', n.id)) }
  else if (a === 'startscout') { if (!name || b.dataset.t === US) return; flushDraft(); scTeam = b.dataset.t; loadDraft(scTeam, ''); render(); scrollTo(0, 0) }
  else if (a === 'donescout') { flushDraft(); scTeam = ''; draft = null; render(); scrollTo(0, 0) }
  else if (a === 'resetdraft') { if (sure(b)) { draft = { ...newDraft(scTeam, draft.match), id: draft.id }; saveDraft(0); render() } }
  else if (a === 'setname') { flushDraft(); scTeam = ''; draft = null; name = b.dataset.v; ls('name', name); render() }
  else if (a === 'theme') { ls('theme', (ls('theme') || 'light') === 'dark' ? 'light' : 'dark'); applyTheme() }
  else if (a === 'rate') { draft[b.dataset.f] = draft[b.dataset.f] == +b.dataset.v ? 0 : +b.dataset.v; saveDraft(0); render() }
  else if (a === 'addpick') { const n = b.dataset.t; const p = evObj().picks || []; if (n && !p.includes(n)) setPicks([...p, n]) }
  else if (a === 'pup' || a === 'pdn') { const p = [...evObj().picks], i = +b.dataset.i, j = a === 'pup' ? i - 1 : i + 1; if (j >= 0 && j < p.length) { [p[i], p[j]] = [p[j], p[i]]; setPicks(p) } }
  else if (a === 'prm') { const p = [...evObj().picks]; p.splice(+b.dataset.i, 1); setPicks(p) }
});
let linkT;
document.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.f && draft && tab === 'scout') { draft[t.dataset.f] = t.value; saveDraft() }
  else if (t.id === 'evlink') { const id = ev, val = t.value.trim(); clearTimeout(linkT); linkT = setTimeout(() => upd('events', id, { link: val }), 600) }
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'evsel') { ev = t.value; ls('ev', ev); render() }
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
