# Invictus 52111A Scouting

Phone-first scouting app for VEX V5RC events: import an event from VEX Events (RobotEvents), scout teams,
keep match strategy notes and build the finals picklist together, live, across everyone's phones.

Runs on Netlify: a static page in `public/` and one serverless function (`netlify/functions/api.mjs`)
that stores everything in Netlify Blobs and keeps the RobotEvents API key off the phones.

## Put it online (about 10 minutes)
1. Push this repo to GitHub (keep the folders as they are: `public/`, `netlify/functions/`, `netlify.toml`, `package.json`).
2. On netlify.com: **Add new site → Import an existing project → GitHub**, pick the repo, and press Deploy. The settings come from `netlify.toml`.
3. In Netlify: **Site configuration → Environment variables**, add two:
   - `TEAM_CODE` = a code your team will type to get in (pick something not guessable)
   - `ROBOTEVENTS_KEY` = your VEX Events API key (mark it as secret)
4. **Deploys → Trigger deploy** so the variables take effect.
5. Open your Netlify link on your phone, enter the team code, then on the Event tab type your event code (e.g. RE-V5RC-26-5068) and press **Import / update now**.
6. Optional: use the browser's **Add to Home screen** to install it like an app.

## Try it on your PC without deploying
Needs Node.js. Create a file called `.env` in this folder:
```
TEAM_CODE=test123
ROBOTEVENTS_KEY=your-key-or-anything
```
Then run:
```
npm install
npm install -g netlify-cli
netlify dev
```
Open http://localhost:8888 (or `http://<your PC's IP>:8888` on a phone on the same wifi). Without a real API key everything
works except the VEX Events import – add an event, teams and matches by hand instead.

## How it works
- **Live updates.** While the page is open it checks for teammates' changes every 3 seconds and VEX Events scores every
  15 seconds (`NOTE_MS` / `RE_MS` at the top of `public/app.js`). Nothing runs when nobody has the page open.
- **Works with bad wifi.** Every change shows up on your phone straight away and is queued until it reaches the server.
  The header says `Offline · 3 unsaved` while you have no signal and goes back to `Synced` once everything is sent.
  The app and the last downloaded data are saved on the phone, so it still opens with no signal.
- **Team settings** (bottom of the Event tab): our team number and the list of scout names, shared with everyone.
- **Rankings & OPR** (Teams tab → Rankings). Official rankings (W-L-T, WP, AP, SP) come from VEX Events and refresh
  with the scores. OPR, DPR and CCWM are worked out on the phone from the scored qualification matches. Before VEX Events
  has rankings, the table shows standings calculated from the scores instead (labelled as such). Rank and OPR also show on
  each team's page and on the picklist.
- **Scouting.** Each scout has one overall entry per team, and can add one per match they watched
  ("What are you scouting?" at the top of the form). The team page averages all of them.

## Changes from the first version
- Matches: score no longer wraps onto two lines; W/L badge; **Our matches / All matches** switch; non-our matches get a notes box;
  the manual "Add match" form is folded away at the bottom.
- Scouting per match (the unfinished match picker is now finished); the last edit before tapping **Done** is no longer lost.
- Offline queue + offline start-up (service worker, installable); failed saves no longer pop up alerts.
- Picklist: ▲/▼ buttons as well as dragging.
- Team number and scout names are settings instead of being hard-coded.
- Deleting an event now also deletes its teams, matches and notes on the server (it used to leave them behind forever).
- VEX Events refresh tracking is kept per event; the event link no longer saves on every keystroke.
- Polling slowed from 1s/5s to 3s/15s – with 5 phones open all day, 1-second polling burns through Netlify's free function allowance.
- Code split out of one big `index.html` into `app.js`, `app.css` and SVG logos.
