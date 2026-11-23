# StrafeLab context

StrafeLab is a browser-based 3D aim and movement trainer for Valorant practice. The current use is local development and playtesting on Windows. The repository is [Shakan-77/strafelab](https://github.com/Shakan-77/strafelab). The most recent gameplay baseline is [commit `976789f`](https://github.com/Shakan-77/strafelab/commit/976789f). [Changes since `100862e`](#changes-since-100862e) explains the last three commits.

## Run locally

From the repo root, use Python 3.8+ to start the standard-library HTTP and WebSocket server.

```powershell
python server.py --host 127.0.0.1 --port 8787
```

Open [StrafeLab](http://localhost:8787/) in desktop Chrome or Edge. Three.js loads from a CDN. Reload the browser after JavaScript or CSS edits. Restart the server when `public/data/scenarios.json` changes, because the backend loads drill metadata at startup.

The regular URL uses real browser mouse capture. Add `?debug=1` to bypass capture and expose `window.__sl` for scripted tests. Use `/api/health` to check backend availability.

## Code map

| Path | Responsibility |
| --- | --- |
| `server.py` | Static files, WebSockets, parties, score validation, and leaderboards. Scores persist in `data/leaderboard.json`. |
| `public/data/scenarios.json` | Shared metadata for all 15 drills, including weapon, duration, difficulty options, and score bounds. |
| `public/js/main.js` and `public/js/settings.js` | Menus, settings, controls, the per-drill weapon picker, results, and per-drill practice history. Settings and history persist in the browser. |
| `public/js/game/game.js` | Pointer lock, fullscreen, mouse look, fire timing, camera, simulation loop, and hit registration. |
| `public/js/game/player.js` | Movement physics. All tuning constants are in the `MOVE` object at the top. Also handles jump and landing sound decisions and tagging. |
| `public/js/game/weapons.js` | Weapon profiles (rifle, sniper, knife), spread, and accuracy thresholds. |
| `public/js/game/botfire.js` | `BOT_SKILL` table (reaction, fire interval, hit chances) and the shared `BotGun` used by every drill where bots shoot back. |
| `public/js/game/targets.js`, `public/js/game/skins.js`, and `public/js/audio.js` | Original procedural bots and rifle models, plus synthesized sound. |
| `public/js/guide.js` | In-game guide text and the reference numbers table. Each number is labelled `wiki` (VALORANT wiki or Riot patch notes) or `est` (StrafeLab estimate). |
| `public/js/scenarios/*.js` | One module per drill, registered in `index.js`. |

## Gameplay baseline

- **Grid Taps** keeps four active targets on a five-by-three grid. **Multi-Target Switch** uses four lanes with targets at different depths and expiration penalties. **Strafe Tracking** measures time on a moving humanoid bot and time on its head. All three are under **Train → Precision**.
- **Settings → Mouse** has separate hipfire sensitivity, rifle ADS multiplier, and sniper scope multiplier. Hipfire uses `0.07° × sensitivity` per raw count. DPI affects the reported cm/360. The field of view is 103° horizontally at 16:9.
- Player physics run at 128 Hz. The rifle run speed is 5.4 m/s, and the movement accuracy cutoff is 27.5% of that speed. Braking, acceleration, and air steering are StrafeLab estimates. [Vandal stats](https://wiki.playvalorant.com/en-us/Vandal) · [Riot patch 3.0](https://playvalorant.com/en-us/news/game-updates/valorant-patch-notes-3-0/)
- The input code requests pointer lock before entering fullscreen. It collects early raw movement where available, ignores corresponding `mousemove` deltas, and applies pending motion before physics, aiming down sights, and firing. Losing capture pauses the run. Resume reacquires capture.
- Precision taps use event timestamps for fire cadence. Grid Taps and Multi-Target Switch reuse four target meshes. Hitmarker feedback restarts its animation without a synchronous layout read.
- The rifle skins (Pulse Core, Verdant Bloom, Bastion Gilt, Wraithbound) and bot models are original, with synthesized kill sounds. The user asked for the RGX, Gaia, Primordium and Reaver skins and sounds from a third-party site. Those are Riot assets, so they were not copied. Any future official-skin integration requires authorized files and permission from Riot. [Riot fan-content policy](https://www.riotgames.com/en/legal)

## Changes since `100862e`

Shakan-77 made three commits. All of them follow the user's feedback from playing Valorant. Riot doesn't publish air-movement numbers, and the patch notes have nothing on air control or jump physics, so the air values below are calibrated to the user's descriptions of in-game behaviour.

### `e27e658`: tougher bots, crouch-release landing, weapon picker

- **Bots:** reaction time and accuracy go up one step on every difficulty. The current `BOT_SKILL` values are below.

  | Difficulty | Reaction (s) | Fire interval (s) | Hit chance still / moving / airborne | Headshot chance |
  | --- | --- | --- | --- | --- |
  | Easy | 0.45 | 0.15 | 0.75 / 0.35 / 0.18 | 0.30 |
  | Medium | 0.34 | 0.12 | 0.85 / 0.45 / 0.23 | 0.40 |
  | Hard | 0.25 | 0.105 | 0.92 / 0.55 / 0.28 | 0.50 |

- **Silent crouch-release landing:** after a crouch-jump, releasing crouch mid-air makes the landing silent at walking speed or slower, even on flat ground. In the code, the `uncrouchedMidAir` flag sets `crouchRelease` on the land event.
- **Weapon picker:** each drill can be played with the rifle, the sniper, or a knife. The knife (6.75 m/s run speed) is only offered for Air Course and Silent Jump. A weapon other than the drill's default makes the run unranked practice, so it is never sent to the leaderboard.

### `9ece9c7`: mid-air reversal and player tagging

- **Mid-air reversal:** this braking branch uses `airReverse` = 19 m/s². It is calibrated so that a full-speed jump followed by an immediate 180° lands about 0.5 m behind the take-off point. The simulation gives about 0.6 m.
- **Tagging:** a bot hit slows the player by 72.5%, which drops a running rifle user to the accuracy cutoff (patches 3.0 and 9.10). The slow eases off over `tagTime` = 0.5 s. That duration is an estimate.

### `976789f`: camera-based air steering and silent ledge landings

- **Camera steering:** while W, A or D is held in the air, the velocity rotates by the same amount as the camera's yaw change. The rotation is capped at `airFollow` = 240°/s, and speed is unchanged. With no key held, the mouse doesn't steer. The yaw from the previous tick is stored in `player.airYaw`.
- **Key-only drift:** keys alone nudge the path toward the input direction at `accel × airControl / speed`. With `airControl` = 0.0645 this is about 1.34 m/s² sideways. As a result, a full-speed W jump with D held drifts about 0.31 m over a 3.61 m jump. The user's Valorant reference is 1/12 of the jump.
- **No strafe push on running jumps:** the Source-style strafe acceleration now only runs while a jump started from rest is still building speed (up to `airStartCap` = 1.8 m/s). Before this change, D plus a mouse sweep overshot the camera by about 50°.
- **When the reversal brake applies:** it now needs W or S held (`fx !== 0`). It triggers when the input opposes the current path, or when the input points back toward the take-off direction while speed is still below take-off speed. A smooth 180° mouse turn now steers, while a flick or pressing S still brakes. Before this change, the brake compared the input with the take-off direction and stopped smooth turns at about 135°.
- **Silent ledge landing:** with Walk or Crouch held at landing, a landing that ends higher than the take-off is silent at any speed (`ledgeLand` on the land event). "Higher" means landing at least 0.02 m above `player.takeoffY`, which is the same as falling less than you rose. Flat-ground Walk jumps are still loud, unless the crouch-release rule above applies.

### Sound rules in force (`player.js`)

| Event | Silent when | Loud when |
| --- | --- | --- |
| Take-off | Walk or Crouch held, at any speed (`isLoudJump`) | Neither is held, even from a standstill |
| Landing | `crouchRelease` (crouch-jump, crouch released mid-air, at walking speed or slower), or `ledgeLand`, or an impact of 3.2 m/s or less (about 0.3 m of fall) at the quiet speed or slower | Anything else |
| Footsteps | Ground speed at or below the quiet speed (108% of walk speed, 3.27 m/s with a rifle) | Faster |

### Verifying physics changes

Open `http://localhost:8787/?debug=1` and run a script in the console. Import `Player` from `/js/game/player.js` with a cache-busting query string, build a world of AABB colliders, and step the player at `1/128` s with chosen `input` and `yaw`. Read `pos`, `vel`, and the `jump` and `land` events from `onEvent`. Before the most recent commit, these results were checked:

| Scenario | Result |
| --- | --- |
| W+D, or D alone, from a full-speed jump | 0.31 m sideways over 3.61 m |
| W or D with a 90° mouse turn | The path ends up at about 90° to 98° |
| W with a 180° flick, or S | Lands 0.6 m behind take-off |
| Walk jump onto a 0.5 m ledge | Silent |
| Crouch-jump onto a 0.8 m ledge | Silent |
| Walk jump on flat ground | Loud |

In game scripts, set `__sl.net.send = () => false` so test runs don't reach the leaderboard.

## Verification and open issues

Chrome automation verified mouse look while strafing and jumping in fullscreen, pause and resume after capture loss, the 360° turn calculation, separate ADS and scope settings, and 30 consecutive Grid Taps hits with four reused targets. Earlier browser checks also covered all 15 drill starts, the three new leaderboards, old local history entries, and a party start for Strafe Tracking.

- **Mouse sticking:** the user reported intermittent mouse sticking during rapid Grid Taps flicks and clicks, and earlier while strafing or airborne in Counter-Strafe. The exact freeze did not reproduce in automation. A physical-mouse playtest on the affected setup is still pending.
- **Air movement feel:** the air values are still estimates. The user has been tuning them against Valorant one behaviour at a time. Hand-playtesting of `976789f` is pending.

For browser input and hit-testing references, see the [MIT-licensed AimForge input code](https://github.com/Shiraikuroko123/aimforge/blob/main/js/game.js), [VANTA](https://github.com/aimtrainer-code/aim-trainer), and [Three.js PointerLockControls](https://github.com/mrdoob/three.js/blob/dev/examples/jsm/controls/PointerLockControls.js).
