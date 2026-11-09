# Park It 3D

A small browser car-parking game built with [three.js](https://threejs.org/), TypeScript and Vite.
Each lot has one glowing target bay. Drive in, line up with the bay and hold still for a
moment to park. Every level has a time limit, and touching anything (a car, wall, pillar or cone) fails the level at once. You earn up to three
stars per level from your time: finishing in time is one star, and each level sets the times for two and three stars. Progress is saved in `localStorage`, keyed by each level's permanent `id` (see `LevelDef`), so levels can be added or reordered without losing stars.

No asset files are loaded at runtime. The cars, the lots and the sound effects are all generated in code.

## Controls

| Action                 | Keyboard          | Touch     |
| ---------------------- | ----------------- | --------- |
| Accelerate             | `W` / `↑`         | ▲         |
| Brake / reverse        | `S` / `↓`         | ▼         |
| Steer                  | `A` `D` / `←` `→` | ◀ ▶       |
| Handbrake              | `Space`           | P         |
| Toggle chase / top cam | `C`               | 🎥 button |
| Restart level          | `R`               |           |
| Pause / resume         | `Esc` / `P`       | ⏸ button  |
| Mute                   | `M`               |           |

### Admin mode (testing)

Open the game with `?admin=1` (remembered for the session; `?admin=0` turns it off) to unlock every level, show an `ADMIN` badge, and skip levels with `]` (next) / `[` (back) or the pause menu's **Skip level** button. Saved progress is never written while it is on. Code: `src/admin.ts`.

### Gamepad

| Action                       | Button                                     |
| ---------------------------- | ------------------------------------------ |
| Accelerate / brake / reverse | `RT` / `LT`                                |
| Steer                        | Left stick                                 |
| Handbrake                    | `A` / `RB`                                 |
| Pause / resume               | `Start`                                    |
| Toggle camera                | `Y` / `Back`                               |
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
```

CI (`.github/workflows/ci.yml`) runs typecheck, lint, validate and build on every push to `main` and on pull requests.

The build uses `base: './'`, so `dist/` can be served from any sub-path.

### URL parameters

These parameters help with testing:

- `?level=N` starts level `N` straight away (1-based, or a level id such as `?level=cone-gates`) and skips the menu, e.g. `http://localhost:5173/?level=3`.
- `?cam=top` starts in the top-down camera instead of the chase camera.

You can combine them: `?level=6&cam=top`.

## Project structure

```
index.html           page shell: canvas, HUD, touch controls, menu and modal markup
public/              favicon, apple-touch-icon and web app manifest (copied as-is)
scripts/validate.ts  headless sanity checks for every level and the car physics
src/main.ts          entry point: renderer, scene, game state machine, main loop, URL params
src/config.ts        shared tuning constants (car size, speeds, steering, tolerances)
src/physics.ts       kinematic bicycle-model car physics and collision response
src/collision.ts     2D oriented bounding boxes (OBB) and SAT overlap tests
src/parking.ts       decides whether the car is parked correctly inside the target bay
src/layout.ts        level data types (LevelDef, BayDef, ObstacleDef) and obstacle geometry helpers
src/floors.ts        floors and ramps: surface height, layer hand-over, which obstacles the car can reach, generated kerbs
src/levels.ts        the level definitions
src/level.ts         builds the three.js scene for a level (ground, lines, bays, obstacles)
src/car.ts           car mesh construction and the player car (physics + model)
src/camera.ts        chase and top-down camera rig
src/input.ts         keyboard and touch input mapped to driving controls
src/hud.ts           DOM HUD, menu, level grid and modal dialogs
src/audio.ts         tiny WebAudio synth for beeps, bumps and win/fail jingles
src/rules.ts         star thresholds and the touch rule (pure, tested by validate)
src/progress.ts      unlocked levels and best stars saved to localStorage
src/style.css        all page styles
src/vite-env.d.ts    Vite client type references
```

## Adding a level

1. Add a `LevelDef` object to the `LEVELS` array in `src/levels.ts`. Its fields are defined in `src/layout.ts`:
   - `name`, `hint`: the title and the one-line tip shown to the player.
   - `lot`: lot size `{ w, l }` in metres. The lot is centred on the origin, and boundary walls are added automatically.
   - `spawn`: start pose `{ x, z, rot }`. `rot` is a heading in radians, and `0` faces +z.
   - `target`: the bay to park in, `{ x, z, rot, w, l }`.
   - `bothWays`: set it to `true` if the car may face either way in the bay. When it is `false`, the car must face `target.rot`.
   - `time`: the time limit in seconds. `stars: { three, two }`: seconds to finish in for three and two stars (`0 < three < two < time`).
   - `obstacles`: cars, walls, cones and pillars. Use the helpers `car()`, `carRow()` and `coneLine()` at the top of the file.
   - `bays` (optional): painted bay markings, for decoration only. `bayRow()` builds a row of them.
2. Add a scripted solution for it to `src/levels.solutions.ts`, keyed by the level `name`: a list of
   `S(seconds, throttle, steer, handbrake?)` control segments that parks the car within `par` seconds without a bump.
3. Run `npm run validate`. It checks that the spawn does not overlap anything, that the bay is inside the lot and fits
   the car, that the target pose is a valid park, that the car has at least 0.3 m of side clearance in the bay, and that
   the orientation rule behaves as set. It also replays the scripted solution through the game physics and fails if it
   does not park within `par` without a bump, or if the level has no solution.
4. Play it with `npm run dev`, then open `?level=N` to jump straight to the new level.

The menu grid, unlocking and saved progress all follow `LEVELS.length`, so nothing else needs to change.

## Credits

Car models: [Car Kit](https://kenney.nl/assets/car-kit) by Kenney (CC0), see `public/models/cars/License.txt`.
