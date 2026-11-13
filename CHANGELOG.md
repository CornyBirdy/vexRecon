# Changelog

All notable changes to Recon (made by Invictus 52111A). Newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The version shown on the About screen is `APP.version` in
`public/app.js`.

## [Unreleased]

### Added
- **Event browser.** You no longer need an event link to add an event. On the Event tab, the event picker's last option
  (**＋ Add another event…**), **More → Add another event** and the first-time "Pick your event" screen now have **Find an
  event**: **Our events** (everything your team is signed up for this season), **Coming up** (the next two months) and
  **Earlier** (this season, already played). Search by name, city, region or code, then tap **Add** (or **Open** if it's already in Recon).
  Pasting a code or link still works.
- **Recovery key.** Setting up a team now also gives a **recovery key**, a second secret for the coach or mentor to keep
  (not for the team chat). If everyone is logged out and nobody has the team code, **Lost the code?** on the sign-in
  screen takes the team number and recovery key and gives a new team code straight away; the old code stops working.
  Nobody can get in from a team number alone. The key is shown once, and you tick "I've saved the recovery key" before
  you can start. Teams set up earlier (including Invictus) make one in **Team settings → Recovery key**, where you can also
  make a new one (the old key stops working). Until now only the app's owner could fix a lost code.
- Logging out now reminds you that you need the team code to get back in, and shows it.
- **Recon's own pop-ups.** Dropdowns (event picker, "What are you scouting?", and the scouting form's answers), the team
  suggestions in the manual match and alliance-request forms, and the "log out with unsent changes" question now use
  menus and dialogs that match the app, in light and dark, with keyboard support, instead of the browser's.
- **Skills & season stats.** Event tab → **Skills** shows every team's highest and average driver and autonomous
  (programming) skills scores and the combined score, for the whole season or just this event, sortable, with the
  field's highest and average at the top. It works with no matches being played.
- **Season card on each team's page**: combined / driver / auton skills (with its rank among the teams at the event),
  skills by event, season W-L-T and win rate, average and high score, every event the team has played, and its awards.
- Rankings table: **average score** and **high score** per match, and a sort by average score.
- Server: new `/api/stats` endpoint. It loads each team's season skills, rankings and awards from VEX Events a few teams
  at a time (3 requests per team), retries when rate limited, and tells the other phones only once the last teams are in.
  The stats load the first time an event is opened and again once they are 6 hours old; **Refresh** loads them now.

### Changed
- **The Event and Teams tabs are now one Event tab.** The event picker stays on top, then **Teams** (search, with rank,
  skills and OPR on each row), **Rankings**, **Skills** and **More** (event notes, import or add another event, event link,
  team settings, delete event).
- **Scout form.** Every field keeps a visible label and a hint after you type in it, so a bare "20" is now "Auto points
  scored". Ratings say what 1 and 5 mean (for example "1 = Slow, 5 = Very fast"). The form is split into titled sections:
  Autonomous, Driver, Robot, Scoring, Toggle, Overall.
- **Toggle mechanism is now a text box** where scouts describe how a team does the toggle, instead of a 1-5 score.
  Entries saved with the old rating still show it, labelled "Mechanism rating (old form)".
- **Saved scouting entries** (on a team's page) are shown grouped by section with every value labelled; empty fields are
  left out. The averages are shown as labelled tiles.

### Fixed
- **Importing newer event codes.** Codes like `VE-V5-26-66510` (not just `RE-V5RC-26-5068`) are now accepted, and you
  can paste the whole event page link (even with `#general-info` on the end); the code is picked out of it. If there's
  no code in what you typed, the box now says so.
- **Long event names no longer run off the header card.** They wrap onto a second line instead.
- Deleting an event now also removes its rankings from the phones straight away (they were only removed after the next
  sync).

## [1.0.0] - 2026-11-08: Recon

### Added
- **Recon: one site for every team.** A team signs up with its VEX team number (checked on VEX Events) and gets a
  generated team code to share. Each team's data lives in its own private store; codes are stored only as salted hashes
  and a team is locked for 10 minutes after 10 wrong codes. The original Invictus 52111A install is adopted as team
  52111A on first sign-in.
- Welcome screen with **Set up a new team** / **Join your team**, an About screen crediting Invictus 52111A, and a
  proprietary licence.
- New Recon wordmark and icon (light and dark versions) and an owner-only `/api/admin` endpoint to reset or remove a team.

### Changed
- The red / blue alliance stripe in the header is softer and blends through purple.
- **One way to scout**: the Scout tab is the one place to write scouting (a team's page has a **Scout this team**
  button). The list opens on **To scout** with an "X of Y done" count.
- Alliance requests moved to the Picklist, with an **Add to picklist** button.

## Before Recon: the Invictus 52111A scouting app

### Added
- Rankings with OPR, DPR and CCWM, worked out on the phone from scored qualification matches, plus official rankings
  from VEX Events.
- Offline mode: changes are queued on the phone and sent when back online, and the app and last data open with no
  signal (installable as an app).
- Match scouting per match, **Our matches / All matches** switch, notes on every match, and ▲/▼ buttons on the picklist.
- Rack Suite design system with a turquoise accent, light and dark mode, calmer animations that respect "reduce motion",
  team code preview, and a field-grid app icon.

### Changed
- Team number and scout names are settings instead of being hard-coded.
- Polling slowed from 1 s / 5 s to 3 s / 15 s to stay inside Netlify's free allowance.
- The code is split into `app.js`, `app.css` and SVG logos instead of one big `index.html`.

### Fixed
- The last edit before tapping **Done** on a scouting form is no longer lost.
- Deleting an event now deletes its teams, matches and notes on the server.
- Failed saves no longer pop up alerts, and the match score no longer wraps onto two lines.
