# CivSim – working notes

- Static site, no build step. `index.html` = landing page, `game.html` = the game, `play.html` = the Claude artifact entry page (same game, no doctype/head).
- Pushing to `main` deploys GitHub Pages (https://dashryerson-design.github.io/CivSim/).
- After every change to the game, republish the artifact (publish `play.html` with all of `src/`, `styles/`, `fonts/` as `files`) so it stays at https://claude.ai/artifact/16hMMWxjFtAzmNeQZFpKA2, and **end every response to the user with that link** so they can test the update.
- The simulation runs in a Web Worker (`src/sim/host.js`); UI mutations go through `sim.call(...)` commands, never by editing the mirror.
- Input modes: `settings.inputMode` is `touch` or `keyboard` (`body.touch`, `app.touch`). Keep both working.
- Dev tools: `node tools/balance.mjs`, `node tools/aggression.mjs`, `node tools/profile.mjs [size] [days] [hard|open]`.
- Shared event record: log through `game.log(tribe, type, text, imp, { with, cat, alert, at })` (see `src/sim/records.js`); notices, inbox, chronicle and timeline read it.
- Systems: intel/fog/missions `src/sim/intel.js`, trade `src/sim/trade.js`, AI memory/personality/coalitions `src/sim/aimind.js`, supply/specialisation/eras `src/sim/logistics.js`. New save fields must be optional; bump `SAVE_VERSION`.
- Content packs: `src/data/registry.js` (docs/MODDING.md). New UI text goes in `src/i18n.js`.
