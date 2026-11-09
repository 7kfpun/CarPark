# Park It 3D

A small browser car-parking game built with [three.js](https://threejs.org/), TypeScript and Vite.
Each lot has one glowing target bay. Drive in, line up with the bay and hold still for a
moment to park. Every level has a time limit, and touching anything (a car, wall, pillar or cone) fails the level at once. You earn up to three
stars per level from your time: finishing in time is one star, and each level sets the times for two and three stars. Progress is saved in `localStorage`, keyed by each level's permanent `id` (see `LevelDef`), so levels can be added or reordered without losing stars.

Levels are grouped into themed locations (worlds): Open-Air Lots, Multi-Storey, Industrial Yard and Twilight District. The menu shows the worlds with a star total each; finish a world (at least one star on every level) to open the next. Each level's `location` field (`LevelDef`) and the world order live in `src/layout.ts`, `src/levels.ts` and `src/worlds.ts`.

The lots, the sound effects (an engine hum that follows your speed, crash and fail stings, a win jingle that grows with stars) and the background music are generated in code. Settings has separate effects and music volumes and a music toggle. The only assets fetched at runtime are seven CC0 Kenney car models (`public/models/cars/*.glb`, about 1.3 MB). If a model is slow or fails to load, a box car is used instead.

## Controls

| Action                | Keyboard          | Touch                                 |
| --------------------- | ----------------- | ------------------------------------- |
| Accelerate            | `W` / `↑`         | Accelerator pedal                     |
| Brake / reverse       | `S` / `↓`         | Brake pedal; R / D toggle for reverse |
| Steer                 | `A` `D` / `←` `→` | Drag the steering wheel round         |
| Handbrake             | `Space`           | Brake pedal                           |
| Cycle camera view     | `C`               | 🎥 button                             |
| Look around (driving) | Left / right drag | Drag the empty game area; pinch zooms |
| Reset view            | `V`               | Reset view button, or double-tap      |
| Look around (paused)  | Drag              | Drag the backdrop                     |
| Restart level         | `R`               |                                       |
| Pause / resume        | `Esc` / `P`       | ⏸ button                              |
| Mute                  | `M`               |                                       |

### Admin mode (testing)

Open the game with `?admin=1` (remembered for the session; `?admin=0` turns it off) to unlock every level, show an `ADMIN` badge, and skip levels with `]` (next) / `[` (back) the pause menu's **Skip level** button, or the **Prev** / **Next** touch buttons beside the `ADMIN` badge (tap the badge to hide or show them). Saved progress is never written while it is on. Code: `src/admin.ts`.

### Accessibility

Every menu and modal is keyboard-operable with a focus trap, buttons carry labels, and status changes are announced through a live region. Settings > **Text size** (Normal / Large / Extra large) scales panels, pills and HUD text. While parking, a ✓/✗ checklist (facing, stopped) sits under the meter, so the bay colour is never the only signal. Reduced motion stops the bay marker's spin and bob, makes camera switches instant and replaces the hit flash with a static one.

### Gamepad

| Action                       | Button                                     |
| ---------------------------- | ------------------------------------------ |
| Accelerate / brake / reverse | `RT` / `LT`                                |
| Steer                        | Left stick                                 |
| Handbrake                    | `A` / `RB`                                 |
| Pause / resume               | `Start`                                    |
| Cycle camera view            | `Y` / `Back`                               |
| Restart level                | `X`                                        |
| Menus and modals             | D-pad or left stick to move, `A` to select |

## Development

Requires Node.js (current LTS) and npm.

```sh
npm install
npm run dev          # start the Vite dev server
npm run build        # type-check and build to dist/
npm run preview      # serve the production build
npm run typecheck    # tsc --noEmit
npm run lint         # ESLint (typescript-eslint)
npm run format       # Prettier, rewrite files
npm run format:check # Prettier, check only
npm run validate     # level geometry and car physics checks (scripts/validate.ts)
npm run test:e2e     # Playwright browser tests against the production build (see Testing)
npm run test:e2e:ui  # the same in Playwright's interactive UI
npm run maps         # regenerate docs/LEVELS.md and docs/maps/*.svg from src/levels.ts
```

CI (`.github/workflows/ci.yml`) runs typecheck, lint, validate, build and format:check on every push to `main` and on ready (non-draft) pull requests. A second workflow (`lgtm.yml`, see `tools/lgtm_gate.py`) sets an `LGTM` status that stays pending until a reviewer's LGTM covers the PR head. Every push to `main` is deployed to GitHub Pages by `deploy.yml`, after the same checks; it also runs daily and can be started by hand. A separate `e2e` job runs the browser tests and uploads the Playwright report and failure screenshots as an artifact; it is not required for deploy.

### Testing

- `npm run validate` is the fast logic suite: level geometry, car physics and the recorded solutions, with no browser.
- `npm run test:e2e` is the end-to-end suite in `e2e/` (Playwright, Chromium only). It builds the game, serves it with `vite preview` on port 4173 and plays it in a real browser: the menu, level 1 driven by its recorded solution through the keyboard, collisions, pause and Settings, the touch layout at 390x844 and 844x390, admin mode, and saved progress across a reload. The tests drive the game on a fake clock (one frame per 1/60 s), so the results do not depend on how fast the machine renders.
- First run: `npx playwright install chromium` (add `--with-deps` on a fresh Linux box). Failures leave screenshots and traces in `test-results/`; the HTML report is in `playwright-report/`. Both are gitignored.

Each level can name the vehicle it is driven with (`vehicle` in `src/levels.ts`, an id from `src/vehicles.ts`; the hatchback when omitted). Physics, collision, the parking check, the cameras and the rear mirror all read that vehicle's dimensions, and `npm run validate` replays each level's recorded solution with its own vehicle. The hatchback, sedan, SUV and van use the CC0 Kenney models; the minibus, city bus and box truck are simple coloured bodies built in code.

Every level's layout is documented, with a top-down map, in [docs/LEVELS.md](docs/LEVELS.md). It is generated: after changing `src/levels.ts` run `npm run maps` and commit the result (`npm run validate` fails when it is out of date).

The build uses `base: './'`, so `dist/` can be served from any sub-path.

### URL parameters

These parameters help with testing:

- `?level=N` starts level `N` straight away (1-based, or a level id such as `?level=cone-gates`) and skips the menu, e.g. `http://localhost:5173/?level=3`.
- `?cam=VIEW` starts in that camera view (`chase`, `cockpit`, `hood`, `top` or `corner`) for this visit; it is not saved.

You can combine them: `?level=6&cam=top`.

### Camera views

`C` (or the 🎥 button) cycles chase, cockpit, hood, top-down and corner views, blending over 0.3 s (instantly with reduced motion); the choice is saved, and Settings shows it too. Cockpit hides the body and draws a dashboard, steering wheel (turns with the steering) and pillars in code; the rear mirror stays on in chase, cockpit and hood (High quality only: it is hidden on Low, including after the slow-frame auto downgrade). Top-down and corner hide decks above the car. The corner view is a close view of the front corner on the side the wheel is turned to, or a rear camera while reversing; Settings > Rear view when reversing (off by default) switches to it automatically when reversing in chase, cockpit or hood. While paused or after a level, drag the backdrop to orbit the car (mouse wheel zooms); resuming returns to the chosen view. While driving, drag the empty game area (mouse: left or right drag; touch: one finger, never on the wheel, pedals, gear lever or buttons) to orbit and tilt the camera, and scroll or pinch to zoom; cockpit and hood turn the head within about ±100° / ±35°. The offset rides on top of the view, so the camera keeps following the car. `V`, the target-icon Reset view button (highlighted only when off-centre) or a double-tap eases back to the centre (instantly with reduced motion); a level start, restart or view switch resets it too. Pure logic: `src/orbit.ts`. Cameras never affect physics, collisions or star times. Pure view logic: `src/views.ts`; the interior: `src/cockpit.ts`.

## Project structure

```
index.html              page shell: canvas, HUD, touch controls, menu and modal markup
public/                 copied as-is: favicon, apple-touch-icon, og-image, web app manifest,
                        CNAME (custom domain) and models/cars (CC0 Kenney .glb car models)
docs/                   LEVELS.md and maps/*.svg, generated by `npm run maps`
screenshots/            PR screenshots
tools/lgtm_gate.py      the LGTM commit-status gate used by the lgtm workflow
version-policy.json     minimum build version allowed to keep running (see src/update.ts)
scripts/validate.ts     headless sanity checks for every level, the car physics and the pure helpers
scripts/maps.ts         regenerates docs/LEVELS.md and the map SVGs (with mapsRender.ts)
scripts/version.ts      build version string shared by vite.config.ts and validate
src/main.ts             entry point: renderer, scene, game state machine, main loop, URL params
src/config.ts           shared tuning constants (car size, speeds, steering, tolerances)
src/vehicles.ts         the vehicle table: size, wheelbase, steering lock, speeds, camera and mirror eye point of each vehicle
src/physics.ts          kinematic bicycle-model car physics and collision response
src/collision.ts        2D oriented bounding boxes (OBB) and SAT overlap tests
src/parking.ts          decides whether the car is parked correctly inside the target bay
src/layout.ts           level data types (LevelDef, BayDef, ObstacleDef) and obstacle geometry helpers
src/floors.ts           floors and ramps: surface height, layer hand-over, which obstacles the car can reach, generated kerbs
src/storey.ts           pure helpers for multi-storey levels: floor names, hints, ceilings, camera clearance, lighting
src/levels.ts           the level definitions
src/levels.solutions.ts one scripted solution per level, keyed by level id, replayed by validate
src/solution.ts         the control-segment type and replay of a scripted solution
src/level.ts            builds the three.js scene for a level (ground, lines, bays, obstacles)
src/car.ts              car mesh construction and the player car (physics + model)
src/carModels.ts        loads and places the Kenney car models
src/loading.ts          loading-screen text and the model-load timeout
src/orbit.ts            pure drag-to-orbit offset: clamps, zoom, reset easing
src/camera.ts           chase and top-down camera rig
src/mirror.ts           rear-view mirror rendered to an offscreen target
src/graphics.ts         low/high quality presets (pixel ratio, shadows)
src/input.ts            keyboard, touch and gamepad input mapped to driving controls
src/hud.ts              DOM HUD, menu, level grid and modal dialogs
src/settings.ts         the Settings panel: sound, quality, camera
src/focus.ts            keyboard and gamepad focus cycling for menus and modals
src/a11y.ts             reduced-motion media query
src/audio.ts            tiny WebAudio synth for beeps, bumps and win/fail jingles
src/rules.ts            star thresholds and the touch rule (pure, tested by validate)
src/progress.ts         unlocked levels and best stars saved to localStorage
src/admin.ts            admin mode (`?admin=1`): unlock and skip levels for testing
src/update.ts           version check: blocks or offers to replace an outdated build
src/version.ts          build version attached to gameplay events
src/guards.ts           whether the game may run (not under Settings or a graphics-reset overlay)
src/style.css           all page styles
src/vite-env.d.ts       Vite client type references
```

## Adding a level

1. Add a `LevelDef` object to the `LEVELS` array in `src/levels.ts`. Its fields are defined in `src/layout.ts`:
   - `id`, `name`, `hint`: `id` is the permanent key for saved stars and solutions (never change it); the other two are the title and the one-line tip shown to the player.
   - `lot`: lot size `{ w, l }` in metres. The lot is centred on the origin, and boundary walls are added automatically.
   - `spawn`: start pose `{ x, z, rot }`. `rot` is a heading in radians, and `0` faces +z.
   - `target`: the bay to park in, `{ x, z, rot, w, l }`.
   - `bothWays`: set it to `true` if the car may face either way in the bay. When it is `false`, the car must face `target.rot`.
   - `time`: the time limit in seconds. `stars: { three, two }`: seconds to finish in for three and two stars (`0 < three < two < time`).
   - `obstacles`: cars, walls, cones and pillars. Use the helpers `car()`, `carRow()` and `coneLine()` at the top of the file.
   - `bays` (optional): painted bay markings, for decoration only. `bayRow()` builds a row of them.
2. Add a scripted solution for it to `src/levels.solutions.ts`, keyed by the level `id`: a list of
   `S(seconds, throttle, steer, handbrake?)` control segments that parks the car within the level's 3-star time (`stars.three`) without touching anything.
3. Run `npm run validate`. It checks that the spawn does not overlap anything, that the bay is inside the lot and fits
   the car, that the target pose is a valid park, that the car has at least 0.3 m of side clearance in the bay, and that
   the orientation rule behaves as set. It also replays the scripted solution through the game physics and fails if it
   does not park within the 3-star time, if it touches anything, or if the level has no solution.
4. Play it with `npm run dev`, then open `?level=N` to jump straight to the new level.

The menu grid, unlocking and saved progress all follow `LEVELS.length`, so nothing else needs to change.

## Credits

Car models: [Car Kit](https://kenney.nl/assets/car-kit) by Kenney (CC0), see `public/models/cars/License.txt`.
