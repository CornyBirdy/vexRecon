# Changelog

All notable changes to Recon (made by Invictus 52111A). Newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The version shown on the About screen is `APP.version` in
`public/app.js`.

## [Unreleased]

## [1.4.0] - 2026-11-16: Skills runs, jump to matches, animated team names

### Added
- **Skills show how many runs each team did.** Under each driver and autonomous score on the Skills tab (This event) it says "2 runs", and a line under the table gives the totals so far, like the VEX Events app.
- **Tap a match on a team's page to see it in the match list.** The match chips on a team's page now open Matches → By team with that team already picked, scrolled to the match you tapped.

### Changed
- **The Team names button animates.** The names open downward under each team number (the chip keeps its width and only grows taller, over about a quarter of a second) and close the same way, instead of the chips jumping wider. Reduced-motion users get it instantly.
- **The winning alliance no longer glows.** Instead its box fades in its colour up from the bottom, so the teams and scores at the top stay easy to read, and the winner's score is bigger than the loser's.
- **Match times sit on two lines.** The scheduled time and field are on the first line; the second line says when the match started and how late (green, amber or red), or when to expect it if the event is running behind. Long lines no longer wrap awkwardly.

## [1.3.0] - 2026-11-16: Live skills, match delays, winner glow

### Added
- **Target and actual match times.** Each match shows when it was scheduled and, once VEX Events says it started, when it really started and how late: "10:00 am · started 10:14 am · +14 min". Green is on time (within 2 min), amber a few minutes late, red 10 or more. For matches still to come, if the event is running behind, they show "expect about 10:57 am · running 30 min behind" worked out from the latest match that started.
- **Winners glow.** In every match list, the winning alliance's box now has a gradient and a soft glow in its colour, replacing the W / L chip. A tie or an unplayed match has no glow.

### Changed
- **Scores sit in their own alliance box**, top right, instead of "32–28" in the header, so it's obvious whose score is whose.
- **Our team's highlight is softer.** Our team number is a soft teal ring and tint instead of a solid bright teal block.

### Fixed
- **Skills now show and update during the event.** They only came from a per-team season crawl that refreshes every 6 hours, so a skills run at the event didn't appear for hours. Recon now also reads the event's own live skills from VEX Events with every refresh (a single request), and these take over the season figures as soon as a team has a run. The Skills tab works even before the season stats are loaded.

## [1.2.1] - 2026-11-16: Scores and match times fixed

### Fixed
- **Scores now show, and "Next match" is right.** Some events (this one included) never tick VEX Events' "scored" flag even though the scores are there, so Recon hid every score and kept saying an old match was next. A match now counts as played when it has started and has points, so scores, W/L, rank, OPR and the Next match card all update as the matches finish.
- **Match times are right again.** VEX Events gives each time with a US time-zone label even for events elsewhere (Q1 at an Adelaide event arrives as "18:30" with a US offset, which is really 10:00 am local). Times are now converted to your device's own time zone, so they match the VEX Events app.

### Removed
- **The Agenda card is hidden for now.** VEX Events doesn't give us the agenda, so it had to be typed in by hand. Anything already typed in is kept and will show again if the card is turned back on.

## [1.2.0] - 2026-11-16: Robot photos, Agenda, team names

### Added
- **Team names on the match lists.** A new **Team names** button on the Matches tab shows each team's name under its number on every match card (and on the Next match card). It remembers your choice.
- **Agenda.** The Event home now has an **Agenda** card: the day's schedule as a timeline (registration, inspection, opening ceremony, matches begin, lunch, awards...) with a **Now** marker on whatever is happening, and finished items dimmed. Tap **Add** (or **Edit**) to fill it in: pick the day and time, then type what happens or choose a suggestion, with an optional note. It's shared live with your whole team, works offline, and spectators can see it too (they can't change it). Multi-day events list each day. VEX Events doesn't give us the agenda, so your team types it in once.
- **Robot photos.** When you scout a team, the **Robot** section of the scouting form has **Take photo** and **From gallery** buttons, so you can add a picture of their robot as you scout. The same photos also show on the team's page, in a new **Robot photos** card. Up to 3 photos per team per event, shared with your whole team. Tap a photo to see it full size; the × deletes it (needs a connection). Photos are shrunk on the phone first (a 5 MB picture becomes about 180 KB), so they use very little of the free database space. With no signal a photo waits on the phone ("Waiting to send") and uploads when you're back online. Spectators never see them.
- **Photos clear themselves.** A team keeps photos for its **5 most recent events**; when a sixth event is added, the oldest event's photos are removed. Deleting an event removes its photos too.

### Changed
- **The awkward gap under the event bar on the Event home is gone.** The greeting ("Live now", your name) now sits snug under it, about the same spacing as the other tabs.
- **The picklist's "Still to pick" teams now show their team name under the number**, so you can tell who's who without opening each team.

## [1.1.0] - 2026-11-15: Spectator mode, match times and fields

### Fixed
- **The bottom bar no longer wanders around the screen on iPhone while you scroll.** The page itself was set to clip sideways overflow, which iPhone Safari applies to the whole screen and which made the fixed tab bar drift. The clipping now happens on the app column only (the page-to-page slide looks the same), and the bar sits on its own layer pinned to the bottom. This was found from a screen recording and fixed without an iPhone to test on, so it needs checking on one.

### Added
- **Spectator mode.** On the sign-in screen there is a new **Spectator** tab: enter a team number (no team code) to follow that team's event. Spectators see matches (with times and fields), rankings, OPR / DPR / CCWM, skills and each team's season stats, view-only, with only the Event and Matches tabs. They never see scouting notes, scout names, the picklist or Team settings, can't change anything, and **Stop watching** (Event → More) takes them back to sign-in. The team has to be on Recon already. A team can switch spectators off in **Team settings → Spectators**.
- **Match times and fields.** Every match shows when it's scheduled and which field it's on (like "Sat 9:30 am · Field 2") under its number in the match list, and on the Next match card. The time is the venue's own, taken from VEX Events. Existing events fill them in on the next automatic refresh.

### Changed
- **The header no longer overlaps the logo on narrower or busier screens.** The logo keeps its space, and on screens under about 480 px wide the status pill shows just the time ("5:38 pm") instead of "Synced 5:38 pm". The time no longer has a leading zero.
- Closing the filter panel no longer snaps back for a moment at the end, and the sign-in card no longer fades in at all (it just appears with the logo animating in), so it can't blink.
- **The filter panel eases open and closed** instead of snapping.
- **Event filters no longer cut off their text.** The row of small dropdowns is now one **Filters** button that opens a panel with each filter full-width and labelled. Active filters show as chips you can tap to remove.
- **Fixed the sign-in card blinking.** On the welcome screen the card (team number, code, Open) could vanish for a moment and fade back in while you were typing. It now only animates in the first time, and tapping **Open** with a wrong code no longer redraws the screen behind it.
- **Better event filters.** The event finder now filters by **country**, then **state / region** (only the ones in that country, so South Australia no longer sits next to Thailand), then **city**. Picking a state fills in its country, and each box only appears when there's something to choose.
- **About Recon moved out of Team settings** to a quiet link at the bottom of the More page, next to a new **What’s new** link that lists recent changes in plain words.
- The sign-in screen no longer shows an empty status dot next to the light/dark button.
- **Moved from Netlify to Cloudflare Pages + D1** (vexrecon.pages.dev). The app looks and works the same. Data now lives in a D1 database, so teams on the old site need to set up again and re-import their events (52111A can still sign in with its old code). Team codes are now stored with PBKDF2 instead of scrypt, and a full event import is kept under Cloudflare's free-plan limit of 50 requests.
- Phones now check for teammates' changes every 10 seconds instead of every 3.

### Added
- **Dibs.** Each team on the Scout list has a **Dibs** button (replacing "I'll scout this" in the form): tap it and everyone sees "Alex has dibs". **Release** gives it up, **Take** takes it from someone else. It clears when the person saves an entry, or after 6 hours.
- **Scouted tab.** The Scout list now has **To scout**, **Scouted** and **All**.
- **Team box colours.** On the Scout list the team number box goes **orange** when a team is partly scouted and **green** when it's fully scouted (every rating and choice on the form filled in, across all scouts' entries; the free-text boxes are optional).
- **Scoring speed and cycle time.** The Scoring section has a new **Scoring speed** rating and **Approximate cycle time (seconds)**: how long to score one load, from the loader. Both show in saved entries and as averages on the team page.
- **Suggested overall rating.** The Overall section shows the average of your other ratings, with a **Use 4** button to apply it. The team page shows the average suggested overall next to the scouts' overall.
- **Matches by team.** The Matches tab has a third option, **By team**: pick any team and see every match they play, who they play **with** and who **against**, their score and win/loss, and their record so far.
- **Shared scouting.** The Scout list now shows who on your team has scouted each team ("Scouted by Sam, you"). **To scout** is the teams nobody has scouted yet, not just you, and the count is the whole team's. The scouting form tells you if teammates already scouted that team, and a new **Team activity** list shows who scouted or claimed what, and when.
- **Claim a team.** In a team's scouting form, **I'll scout this** tells everyone you're on it ("Alex is scouting" on the list). **Release** gives it up, **Take over** takes it from someone else, and a claim clears itself once the claimer saves an entry (or after 6 hours).
- **Event finder filters and a faster finder.** Under the search box you can now narrow events by **region**, **level** and **date** (next 7 / 30 days, this month, or last 7 / 30 days on the Earlier tab), and **Hide added** hides events already in Recon. Event lists are now remembered for 10 minutes, so switching between Our events, Coming up and Earlier is instant, and searching a list you already loaded no longer asks the server again. While it loads you see a spinner and placeholder rows.
- **Remove a scout.** Team settings now lists the team's scouts with a **Remove** button (tap twice to confirm), and an **Add a scout** box. Their saved notes stay.
- **Home tells you what's happening.** The greeting is now a status line: **Live now · Day 2 of 3**, **Starts in 3 days · Sat 15 Nov**, or **Ended 2 days ago**. (Your next match has its own card, so it isn't repeated in the status.) **Change** (the scout name) is next to your name at the top. The rank card jumps to the Rankings tab and highlights your team, and the next-match card jumps to that match.
- **A new Home on the Event tab.** The Event tab now opens on a greeting, your team's rank as one big number (with your record, OPR and CCWM, and how your last few matches went), the next match you play with your alliance on the left. Team rows are now soft tiles with the team number as a badge, match scores are bigger, and the selected tab and switch buttons are raised pills.
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
- **Pages slide like a carousel.** Changing tab or switching (Teams / Rankings / Skills / More, Our matches / All matches, To scout / All teams and so on) now moves the old page out and the new page in side by side at the same speed, with no fading, while the header and tab bar stay put. Going the other way slides the other way.
- **Slides stay inside the app column on wide screens.** On a computer the old and new page no longer travel across the empty margins beside the app; they slide within the column. Matches' single stat card also spans the full width on a computer instead of leaving half of it empty.
- **Alliance blocks read red and blue.** Your own alliance's block is a clear red or blue (it had a green cast), with the coloured top bar on both.
- **Old wordmark back, green tint gone.** The italic RECON lettering is back next to the new viewfinder mark. The alliance blocks and your match cards no longer have a greenish tint: red alliance is red, blue is blue, and cards are neutral.
- **Glassy controls.** Buttons, pills, round icon buttons, the chosen item in switches and tabs, and floating bars now look like frosted acrylic: a translucent sheen, a lit top edge and a soft blur over whatever is behind them, in both dark and light. The main action is a glassy accent button.
- **New logo and no outlines.** The Recon mark is now a bare turquoise viewfinder (corner brackets and a centre dot) next to a plain **Recon** wordmark in the app's own font, and the app icon, favicon and install icons match it. Outlines are gone from cards, chips, buttons and fields: shapes are told apart by soft fills instead (your own match cards and your alliance get a light tint). Keyboard focus rings stay.
- **New look, modelled on a fleet-dashboard design.** Near-black surfaces with a soft sheen, one big **Event overview** panel with nested stat cards, light-weight type (Inter) with big numbers like **2/8**, small delta chips (**↑ CCWM +3.0**, **↑ 50% won**), and **dot-matrix charts**: OPR of the top teams with yours lit, and your score in each match (green win, red loss, amber tie). The header has a status pill and round buttons, switches are pill tracks, the tab bar is one big floating pill where the current tab is simply brighter, and team rows are a tile on the left with a coloured dot and OPR on the right. Corners are bigger. Everything works the same.
- **A flatter, quieter look.** The frosted glass, colour glows and gradients are gone. Surfaces are plain neutral greys (dark) or soft whites (light) in steps with thin outlines, the accent colour is used only for the main action and the current selection, buttons are a solid accent, and nothing bounces or lifts on hover any more. The rank card gets small viewfinder corners (from the Recon icon). Layout, text and what each button does are unchanged.
- **The event picker moved up into the header.** It is on every tab now, with **Update** and **Event page** buttons beside it, and the team line under the wordmark is one short line. A long event name is cut off with "…" instead of running over the logo, on phones as well as desktop. The event card on the Event tab and the three shortcut tiles on Home are gone (the tab bar does that).
- **Toggles now move with you.** Switching **Our matches / All matches**, **To scout / All teams**, **Teams / Rankings / Skills / More**, **Season best / This event** and the finder's **Our events / Coming up / Earlier** glides the highlight across and slides the list under it in the direction you went (to the right item, the list comes in from the right), instead of fading the whole page. The Join / Set up switch on the welcome screen does the same without replaying the logo.
- **Picklist dragging is live.** While you drag a team by its ≡ handle the other teams slide out of the way to open the gap where it will land, the dragged row lifts, and on drop it settles into place with no second jump.
- **Smoother, more specific animations.** Pages now slide the way you are going (forward to the right, back to the left), lists arrive one row after another, the selected tab's highlight glides between tabs, the big numbers count up, and tapping a card gives a press effect. Everything is switched off if your device asks for reduced motion.
- **Better welcome screen.** One brand bar instead of two, a glowing icon, and the sign-in card in glass.
- **Recon now follows your phone's light/dark setting** until you press the sun/moon button (it used to start in light). This also fixes dark logos on a dark page in browsers that force dark mode.
- **Softer corners, and heroes on Matches and Scout.** Matches now opens on your record (with rank and OPR), and Scout opens on how many teams you've scouted with a progress bar, matching the new Home. Corners are softer everywhere: cards are less round, buttons are rounded rectangles instead of pills, chips and tabs are small rounded tags. Everything works the same as before.
- **New look: Rack Glass.** Recon now sits on a soft turquoise colour background with frosted header, cards and tab bar, much rounder corners and pill-shaped buttons. The main button uses a very light turquoise gradient. Text is now Plus Jakarta Sans (team numbers and scores stay in a code font), and both fonts are bundled so Recon still opens offline. Light and dark match, and the red and blue alliance colours are unchanged. Menus, pop-ups and the team sheet stay solid so they are always easy to read.
- **Colour instead of words on the Scout and Matches tabs.** The Scout list shows each team's matches as small coloured
  tags (green = plays with us, red = plays against us, with a one-line key) instead of "With us Q13 / Against Q5". On
  Matches the "We're red / We're blue" badge is gone. **Our matches** always puts our alliance in the left column (still
  coloured red or blue) with the other alliance on the right, and shows the score as us–them. **All matches** keeps red
  on the left and frames our alliance in its colour. Team chips on that tab have solid backgrounds so they stay easy to read.
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
- Switching between Teams, Rankings, Skills, More (and Our matches / All matches, To scout / All teams) no longer jumps back to the top of the page. It stays where you were. Changing the main tab still starts at the top.
- When the page you switch to is shorter than how far you had scrolled, the page now glides up to its bottom instead of snapping.
- The tab bar's sliding highlight no longer shows a second, overlapping shape behind it while you hover the tab you are switching to (the same for the switches).
- The page's entrance animation no longer replays on every redraw (a new note or a sync used to make the team list's rows re-appear).
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
