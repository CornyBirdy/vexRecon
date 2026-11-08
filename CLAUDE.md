# vexRecon (Invictus 52111A scouting)

Phone-first VEX scouting app on Netlify: static client in `public/` (`index.html`, `app.js`, `app.css`,
`tokens.css`, `sw.js`) and one serverless function, `netlify/functions/api.mjs`, that stores data in Netlify Blobs
and holds the RobotEvents key. Preview locally with `netlify dev` (see README).

## Branches
- **All work goes on `beta`.** Base your work on the latest `origin/beta` and push to `beta`, even if this session
  was started on another branch (for example a `claude/...` branch).
- **Only push or merge to `main` when the owner explicitly says so.**
- Don't open pull requests unless asked.

## How the app works
- Sync is offline-first: changes apply locally, queue in an outbox (localStorage) and send when online; the last
  state is cached. Don't make saves depend on being online.
- `render()` re-renders the current view from state. Animations only play on real changes (new view, moved rows,
  newly opened sections, new notes) and must respect `prefers-reduced-motion`.
- OPR / DPR / CCWM are computed on the client from scored qualification matches; official rankings come from
  VEX Events via the function.
- After changing files the service worker caches, bump `CACHE` in `public/sw.js`.

## Design
- Rack Suite design system: every colour, radius, space and font comes from `public/tokens.css`. No raw colours
  elsewhere. Accent is turquoise; status and VEX alliance colours never change with the accent.
- Buttons are secondary by default; `.p` (accent) is for the one main action on a screen.
- App icon: Rack Suite VEX "field grid" family (Recon's mark is a turquoise viewfinder). `public/icon.svg` is the
  source; PNGs, maskable icons and `favicon.ico` are rendered from it.

## Before you push
- Test in a real browser (Playwright is available) with the API mocked or the function run in-process, in both
  light and dark mode, and check text contrast stays at 4.5:1 or better.
