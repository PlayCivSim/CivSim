# CivSim – working notes

- Static site, no build step. `index.html` = landing page, `game.html` = the game, `play.html` = the Claude artifact entry page (same game, no doctype/head).
- Pushing to `main` deploys GitHub Pages (https://playcivsim.github.io/CivSim/).
- After every change to the game, republish the artifact (publish `play.html` with all of `src/`, `styles/`, `fonts/` as `files`) so it stays at https://claude.ai/artifact/16hMMWxjFtAzmNeQZFpKA2, and **end every response to the user with that link** so they can test the update.
- The simulation runs in a Web Worker (`src/sim/host.js`); UI mutations go through `sim.call(...)` commands, never by editing the mirror.
- Input modes: `settings.inputMode` is `touch` or `keyboard` (`body.touch`, `app.touch`). Keep both working.
- Dev tools: `node tools/balance.mjs`, `node tools/aggression.mjs`, `node tools/profile.mjs [size] [days] [hard|open]`.
- Shared event record: log through `game.log(tribe, type, text, imp, { with, cat, alert, at })` (see `src/sim/records.js`); notices, inbox, chronicle and timeline read it.
- Systems: intel/fog/missions `src/sim/intel.js`, trade `src/sim/trade.js`, AI memory/personality/coalitions `src/sim/aimind.js`, supply/specialisation/eras `src/sim/logistics.js`. New save fields must be optional; bump `SAVE_VERSION`.
- Visibility by difficulty: `game.vis` = open (Easy) / explore (Medium) / los (Hard) in `src/sim/vision.js`; `game.hardIntel` gates reliability levels. AI uses the same per-tribe explored/sight maps.
- All diplomacy travels: use `dip.dispatch(a, b, p)` (envoy mission), never `dip.propose` directly, except in the tutorial.
- Campaigns: `estimateCampaign` / `routeProfile` in logistics.js are shared by the planner UI, AI, envoys and caravans.
- Content packs: `src/data/registry.js` (docs/MODDING.md). New UI text goes in `src/i18n.js`.
- Commit authorship: always commit as `dashcodes <338724043+dashryerson-design@users.noreply.github.com>` (e.g. `git -c user.name=dashcodes -c user.email=338724043+dashryerson-design@users.noreply.github.com commit ...`) and never add Co-Authored-By / Claude-Session lines. The owner does not want Claude listed as a contributor.
- The repo now lives at github.com/PlayCivSim/CivSim; the site is https://playcivsim.github.io/CivSim/.
