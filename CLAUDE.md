# Recon (made by Invictus 52111A)

Recon is a proprietary, multi-team VEX scouting app on Netlify: static client in `public/` (`index.html`, `app.js`,
`app.css`, `tokens.css`, `sw.js`) and one serverless function, `netlify/functions/api.mjs`. Any team signs up with its
VEX team number and shares a generated team code; each team's data lives in its own Netlify Blobs store. The
function also holds the RobotEvents key. Preview locally with `netlify dev` (see README).

## Product rules
- The product is called **Recon**. Invictus 52111A must always stay credited (welcome screen, About, README,
  LICENSE). Don't remove the credit.
- Licence is proprietary (`LICENSE`, `"license": "UNLICENSED"`). Don't add open-source code or assets whose licence
  would conflict with that.
- Team data must stay isolated per team. Team codes are only ever stored hashed. The original Invictus install
  (store `scout`, env `TEAM_CODE`) is adopted as team 52111A on first sign-in; keep that path working.

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
  source (it switches light/dark with the browser, for the tab icon); `icon-light.svg` / `icon-dark.svg` are static copies the header swaps with the app's own theme; PNGs, maskable icons and `favicon.ico` are rendered from it (`icon-32-light.png` is the light-tab favicon).

## Before you push
- Test in a real browser (Playwright is available) with the API mocked or the function run in-process, in both
  light and dark mode, and check text contrast stays at 4.5:1 or better.
