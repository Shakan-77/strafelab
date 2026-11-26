# StrafeLab context

StrafeLab is a browser-based 3D aim and movement trainer for Valorant practice. The current use is local development and playtesting on Windows. The repository is [Shakan-77/strafelab](https://github.com/Shakan-77/strafelab). [Changes since `100862e`](#changes-since-100862e) records Shakan-77's gameplay changes through [`f641ec6`](https://github.com/Shakan-77/strafelab/commit/f641ec6). Every push should add its changes to that section.

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
| `public/data/scenarios.json` | Shared metadata for all 18 drills, including weapon, duration, difficulty options, and score bounds. |
| `public/js/main.js` and `public/js/settings.js` | Menus, settings, controls, the per-drill weapon picker, results, and per-drill practice history. Settings and history persist in the browser. |
| `public/js/game/game.js` | Pointer lock, fullscreen, mouse look, fire timing, camera, simulation loop, and hit registration. |
| `public/js/game/player.js` | Movement physics. All tuning constants are in the `MOVE` object at the top. Also handles jump and landing sound decisions and tagging. |
| `public/js/game/weapons.js` | Weapon profiles (rifle, sniper, knife), spread, and accuracy thresholds. |
| `public/js/game/botfire.js` | `BOT_SKILL` table (reaction, fire interval, hit chances) and the shared `BotGun` used by every drill where bots shoot back. |
| `public/js/game/targets.js`, `public/js/game/skins.js`, and `public/js/audio.js` | Original procedural bots and rifle models, plus synthesized sound. |
| `public/js/inputprobe.js` | `InputProbe`: measures mouse event delivery and frame pacing. Counts stalls, spikes, hitches, event delay, and (when fed `pointerrawupdate`) the polling rate. Never changes aim. |
| `public/js/syscheck.js` | The **System check** tab: an 8-second captured test that feeds `InputProbe` both `mousemove` and `pointerrawupdate`, then `assess()` turns the summary into rows and fixes. The last result persists in `strafelab.check.v1`. |
| `public/js/guide.js` | In-game guide text and the reference numbers table. Each number is labelled `wiki` (VALORANT wiki or Riot patch notes) or `est` (StrafeLab estimate). |
| `public/js/scenarios/tactics.js` | Pre-aim Route and Anti-flash drills. |
| `public/js/scenarios/*.js` | One module per drill, registered in `index.js`. |

## Gameplay baseline

- **Grid Taps** keeps four active targets on a five-by-three grid. **Multi-Target Switch** uses four lanes with targets at different depths and expiration penalties. **Strafe Transfers** measures the time to acquire a moving target and confirm a second tap. **Strafe Tracking** measures time on a moving humanoid bot, time on its head, and the longest uninterrupted hold. All four are under **Train → Precision**.
- **Settings → Mouse** has separate hipfire sensitivity, rifle ADS multiplier, and sniper scope multiplier. Hipfire uses `0.07° × sensitivity` per raw count. DPI affects the reported cm/360. The field of view is 103° horizontally at 16:9.
- Player physics run at 128 Hz. The rifle run speed is 5.4 m/s, and the movement accuracy cutoff is 27.5% of that speed. Braking, acceleration, and air steering are StrafeLab estimates. [Vandal stats](https://wiki.playvalorant.com/en-us/Vandal) · [Riot patch 3.0](https://playvalorant.com/en-us/news/game-updates/valorant-patch-notes-3-0/)
- Pointer lock supplies one `mousemove` stream. Raw input requests unadjusted movement when it acquires capture. Each event updates aim immediately, and the fixed-step simulation distributes camera yaw across the ticks in a frame for air steering. Losing capture pauses the run. Resume reacquires capture.
- The in-drill HUD keeps live readouts near the edges. Results compare available metrics with the last ranked run of the same drill and difficulty. [Aimlabs’ Valorant routine](https://aimlabs.com/articles/aimlabs/the-valorant-aim-basics-routine-your-new-favorite-playlist/) and its [target-switching fundamentals](https://aimlabs.com/articles/aimlabs/train-your-core-fundamentals-with-the-aimlabs-aim-basics-routine/) informed the drill and metrics.
- Precision taps use event timestamps for fire cadence. Grid Taps and Multi-Target Switch reuse four target meshes. Hitmarker feedback restarts its animation without a synchronous layout read.
- The rifle skins (Pulse Core, Verdant Bloom, Bastion Gilt, Wraithbound) and bot models are original, with synthesized kill sounds. The user asked for the RGX, Gaia, Primordium and Reaver skins and sounds from a third-party site. Those are Riot assets, so they were not copied. Any future official-skin integration requires authorized files and permission from Riot. [Riot fan-content policy](https://www.riotgames.com/en/legal)

## Changes since `100862e`

These commits follow the user's feedback from playing Valorant. Riot doesn't publish air-movement numbers, and the patch notes have nothing on air control or jump physics, so the air values below are calibrated to the user's descriptions of in-game behaviour.

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
- **When the reversal brake applies:** in this commit it needed W or S held (`fx !== 0`); `f641ec6` removed that restriction. It triggers when the input opposes the current path, or when the input points back toward the take-off direction while speed is still below take-off speed. A smooth 180° mouse turn now steers, while a flick or pressing S still brakes. Before this change, the brake compared the input with the take-off direction and stopped smooth turns at about 135°.
- **Silent ledge landing:** with Walk or Crouch held at landing, a landing that ends higher than the take-off is silent at any speed (`ledgeLand` on the land event). "Higher" means landing at least 0.02 m above `player.takeoffY`, which is the same as falling less than you rose. Flat-ground Walk jumps are still loud, unless the crouch-release rule above applies.

### `f641ec6`: A/D brakes mid-air (jump peek pull-back)

- **Change:** in `player.js` the air reversal brake (`airReverse` = 19 m/s²) no longer requires W or S. Any held key whose direction points against your current path brakes you and pushes you back. Example: you jump while moving right and press A. As before, it also keeps pushing back the way you came until you're back up to take-off speed.
- **Why:** the user supplied a Radiant movement guide video ("How to Get INSANE MOVEMENT in Valorant"). Its on-screen key overlay was read frame by frame. In the jump-peek clip (about 794.3 to 795.2 s) the player holds W+D toward a corner and releases D. He keeps drifting right with only W, presses A at about 794.8 s, and is back behind cover about 0.3 s later. The jump key isn't shown on the overlay (it is probably bound to the mouse wheel), so take-off couldn't be timed. The braking strength is therefore an inference that reuses the existing `airReverse` value.
- **Unchanged:** the brake compares input with the current path, so holding D (or W) while sweeping the mouse still steers. Smooth turns are never braked.
- **Simulated results (rifle, full-speed run to the right, then jump):**

  | Keys after take-off | Landing point |
  | --- | --- |
  | D held, or no keys | 3.63 m right of take-off |
  | A at take-off | 0.6 m on the other side of take-off |
  | A from 0.3 s | 2.26 m right, already moving back at 1.7 m/s |

  All the earlier checks in the verification table below still give the same results.
- **Guide:** the air-strafing text now describes pulling a jump peek back with the opposite strafe key.
- **Other findings from the same video, not yet applied:** dead-zoning clips in the Range showed 0.00° movement error on rifle shots fired 83 ms after pressing the opposite key from full speed. StrafeLab needed about 102 ms to reach the accuracy cutoff in the same situation. The user approved shortening it, which is done in the next section.

### `ec0b607`: System check and crosshair placement (branch `system-check-placement`)

Ideas taken from looking at other browser Valorant trainers (valox.gg has a performance check; both it and aimpro.world train crosshair placement). Nothing was copied from them: no code, assets or map layouts.

- **System check tab.** Captures the mouse (raw input if Settings > Mouse asks for it) and samples 8 s from the first movement. A **stall** is a `mousemove` gap longer than `max(2.5 frames, 20 ms)` while at least 3 `pointerrawupdate` events arrived in it, so the mouse was still reporting. A **spike** is one event over 400 counts and 10x both neighbours. The first event after a stall carries the piled-up movement and isn't counted as a spike. Polling is the median raw-event interval, snapped to 125–8000 Hz. **Movement values** flags fractional `movementX/Y`, which means something is rescaling counts. A **hitch** is a frame over `max(2 × median, median + 8 ms)`.
- **In drills,** `game.probe` samples `mousemove` and frames only while captured and unpaused, and resets on capture. Without raw events, a stall needs typical motion speed on both sides of the gap, so stopping the mouse isn't counted. The pause menu's **Input details** line shows the counts since capture. No `pointerrawupdate` listener runs in drills.
- **Crosshair placement.** `game.aimError(point)` returns the angle between the rendered camera direction (including recoil) and a point, with its vertical and horizontal parts. `Scenario.notePlacement(bot)` records it the first frame `botVisible(bot)` is true. Peek Duels and Angle Hold add **Crosshair placement**, **Pre-aimed (≤2°)** and **Height bias** to results. Movement Course adds **Room entry placement**. To avoid revealing an enemy, the HUD only updates after the enemy is dealt with (`revealPlacements()`): Angle Hold kill feedback shows it, and Peek Duels round banners show the round's average. Scores and leaderboards are unchanged.
- **Small fixes:** the HP readout no longer shows negative values after a death.
- **Verified** with a synthetic probe test in Node (clean input, a 120 ms stall, a 400 ms pause, a spike, 8000 Hz polling, scaled values, with and without raw events) and in headless Chrome: the System check end to end with faked pointer lock and a forced 150 ms stall, placement recording in all three drills, and no console errors. A physical-mouse run on the user's setup is still needed.

### `f66ab16`: Counter-strafe at ~80 ms (branch `system-check-placement`)

- **Change:** `MOVE.counterExtra` goes from 2.2 to 13 m/s². Pressing the opposite key from full rifle speed now crosses the 27.5% accuracy cutoff in about 78 ms of continuous time, which is 10 physics ticks. Before, it took about 100 ms (13 ticks). Releasing the key is unchanged at about 106 ms, and the full stop on release is still about 160 ms.
- **Why:** the Radiant video's Range clips showed 0.00° movement error on rifle shots fired 83 ms after the opposite key. A key press lands up to one tick before it takes effect, so a 10-tick crossing makes a typical counter-strafe accurate at 78 to 86 ms after the press.
- **Side effects:** an ADAD reversal reaches zero speed in about 117 ms instead of 156 ms, and the time spent under the accuracy cutoff during a reversal drops from about 125 ms to about 109 ms. Bots use the same `counterExtra` (`targets.js`), so strafing bots reverse faster too and their dead points are a little shorter. Counter-Strafe Drill times-to-kill get a little faster, so new scores can be slightly higher than older leaderboard entries.
- **Unchanged:** all air movement. The air checks give the same numbers before and after: W+D drift 0.30 m over 3.61 m, 180° flick or S lands 0.52 m behind take-off, A at take-off while flying right lands 0.52 m back, keys held lands 3.63 m out.
- **Guide:** the counter-strafing text and the Rifle stop time row now say about 80 ms counter-strafing and about 106 ms release.

### `b4952d8`: Pre-aim Route and Anti-flash (branch `system-check-placement`)

The user pointed at [valox.gg](https://valox.gg) as a reference. It has no public repository: it is a closed-source, ad-supported site whose bundled JavaScript isn't licensed for reuse, so no code or values were taken from it. Its catalogue was used only to find what StrafeLab lacked. ValoX groups its 114 exercises as Pre-aim (83), Angle holding (11), Anti-flash (5) and pro-clip Scenarios (15), and also has an Exercise Studio, a Skill check and a Performance check. StrafeLab already had angle holding and, on this branch, a System check. The two missing training types were built as original drills on original geometry. ValoX's recreations of real Valorant maps and pro clips were not copied (Riot and player content).

- **Pre-aim Route** (`pre-aim`, Simulation, time trial, `order: asc`, `unit: time`, `timeLimit` 180 s, score bounds 5000 to 600000 ms). The route runs through a corridor, a room, a second corridor and a site. It has 8 candidate angles in route order: a tight right corner out of the first corridor, a crouched enemy behind a crate, a deep angle behind a pillar, the end of the second corridor, the site's left wall edge, its right corner, a head over a 1.4 m box, and a 1.5 m platform. Easy holds 4 of them, Medium 6 and Hard all 8, chosen with the run's seeded RNG and kept in route order. Enemies are static `Bot`s using the shared `BotGun`: exposure builds while they can see you, and they fire after the reaction time. A death adds 5 s, restores 150 HP and respawns you at the `safe` point of the first living angle. The clock stops when the last enemy dies. Results: enemies cleared, deaths, damage taken, average seen-to-kill, headshot kills, accuracy, and crosshair placement (recorded on first sight, revealed after each kill). Corners you clear have head-height accent strips.
- **Anti-flash** (`anti-flash`, Reaction, 60 s, points). The layout is the Angle Hold gap. Each round, a white orb is lobbed from behind one wall (with a throw sound) and pops above the gap after `popTime` (0.95 / 0.75 / 0.6 s by difficulty). At the pop, the angle between the camera direction and the orb sets the blind, if there is line of sight: under 60° gives a full blind for 1.8 s, 60 to 100° a partial blind (strength 1 down to 0.25) for 0.9 s, and more than that, or behind cover, none (+50 points, "dodged"). A full-screen `.flashbang` overlay shows the blind and fades over the last 0.6 s. The scenario creates it and removes it in `dispose()`. After the pop, a `peek` swinger comes from the flash side after `swingDelay` (0.55 to 0.8 / 0.35 to 0.6 / 0.2 to 0.45 s) and fires like Angle Hold. Medium and Hard mix in fake flashes (no swing, 10% / 20%) and dry swings (no flash, 10% / 15%). Scoring follows Angle Hold: a kill is 100, plus a speed bonus, plus 25 for a headshot. A death is -50 and a miss -5. Results: kills, deaths, flashes dodged, fully or half flashed, time blinded, average time to kill, accuracy and placement. The blind thresholds and timings are StrafeLab estimates, not Riot numbers.
- **Guide:** new entries "Pre-aiming a route" and "Playing against flashes". README drill table updated. `scenarios.json` now lists 18 drills, so restart `server.py` after pulling.
- **Verified** in the debug page by driving the game loop from a script with the pane hidden:
  - **Pre-aim Route:** no enemy is visible from spawn, and each angle opens up from a point on the route. An exposed player is shot, takes the 5 s penalty and respawns. Killing all 8 on Hard stops the clock, and the score is time plus penalties.
  - **Anti-flash:** looking at the gap gives a full blind (overlay opacity 1, 1.73 s left). Turning 180° dodges the flash. At 75° off it gives a partial blind (0.65). Turning back after the pop killed three swingers in a row.
  - **Cleanup:** the overlay is gone after quitting.
  - **Not checked:** neither drill has been played by hand yet.

### Re-credit and force-push of `system-check-placement`

The System check and counter-strafe commits were first pushed as `9e6c008` and `37404d4`. They were authored by another Claude session and carried `Co-Authored-By: Claude …` and `Claude-Session:` lines, which `CLAUDE.md` doesn't allow. At the owner's request they were rewritten as `ec0b607` and `f66ab16`, with Shakan-77 as author and committer and those lines removed. The files and commit dates are identical (tree hashes checked). `origin/system-check-placement` was force-pushed with a lease on the old tip, so the old commits are gone from GitHub. Anyone who pulled the old branch should run `git fetch` and `git reset --hard origin/system-check-placement`, or re-create their local branch.

The local-only branch `outside-values-test` builds on these commits. It holds the AimPro-derived movement default, weapon-scaled acceleration and the knife in every run. It isn't pushed, because its movement values come from AimPro's unlicensed client and the owner hasn't decided to publish them. Its own CONTEXT.md and PLAN.md describe that work.

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
| Running right, jump, A at take-off | Lands 0.6 m past take-off on the other side |
| Walk jump onto a 0.5 m ledge | Silent |
| Crouch-jump onto a 0.8 m ledge | Silent |
| Walk jump on flat ground | Loud |

In game scripts, set `__sl.net.send = () => false` so test runs don't reach the leaderboard.

## Verification and open issues

Chrome automation verified mouse look while strafing and jumping in fullscreen, pause and resume after capture loss, the 360° turn calculation, separate ADS and scope settings, and 30 consecutive Grid Taps hits with four reused targets. Earlier browser checks also covered all 15 drill starts, the three new leaderboards, old local history entries, and a party start for Strafe Tracking.

After integrating the collaborator's commits, Chrome automation checked native capture and resume, 64 scripted Grid Taps hits, two-hit transfer scoring, last-run comparisons, and the selected weapon on restart. The physics checks covered steering at 30, 60 and 144 FPS, a reachable trajectory through each Air Strafe Course bend on every difficulty, mid-air reversal, tagging, and quiet landings.

- **Mouse sticking:** the user reported intermittent mouse sticking during rapid Grid Taps flicks and clicks, and earlier while strafing or airborne in Counter-Strafe. The exact freeze did not reproduce in automation. A physical-mouse playtest on the affected setup is still pending. Run **System check** first and use **Copy report**. If it recurs in a drill, pause and open **Input details** for the stall, spike and hitch counts since capture.
- **Air movement feel:** the air values are still estimates. The user has been tuning them against Valorant one behaviour at a time. Hand-playtesting of `976789f` and `f641ec6` is pending.

For browser input and hit-testing references, see the [MIT-licensed AimForge input code](https://github.com/Shiraikuroko123/aimforge/blob/main/js/game.js), [VANTA](https://github.com/aimtrainer-code/aim-trainer), and [Three.js PointerLockControls](https://github.com/mrdoob/three.js/blob/dev/examples/jsm/controls/PointerLockControls.js).
