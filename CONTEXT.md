# StrafeLab context

StrafeLab is a browser-based 3D aim and movement trainer for Valorant practice. The current use is local development and playtesting on Windows. The repository is [Shakan-77/strafelab](https://github.com/Shakan-77/strafelab). The most recent gameplay baseline is [commit `100862e`](https://github.com/Shakan-77/strafelab/commit/100862e21e73ed342eceb9f7678fa11cc291830a).

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
| `public/js/main.js` and `public/js/settings.js` | Menus, settings, controls, results, and per-drill practice history. Settings and history persist in the browser. |
| `public/js/game/game.js` | Pointer lock, fullscreen, mouse look, fire timing, camera, simulation loop, and hit registration. |
| `public/js/game/player.js` and `public/js/game/weapons.js` | Movement physics, weapon profiles, spread, and accuracy thresholds. |
| `public/js/game/targets.js`, `public/js/game/skins.js`, and `public/js/audio.js` | Original procedural bots and rifle models, plus synthesized sound. |
| `public/js/scenarios/target-practice.js` and `public/js/scenarios/index.js` | Grid Taps, Multi-Target Switch, Strafe Tracking, and drill registration. |

## Gameplay baseline

- **Grid Taps** keeps four active targets on a five-by-three grid. **Multi-Target Switch** uses four lanes with targets at different depths and expiration penalties. **Strafe Tracking** measures time on a moving humanoid bot and time on its head. All three are under **Train → Precision**.
- **Settings → Mouse** has separate hipfire sensitivity, rifle ADS multiplier, and sniper scope multiplier. Hipfire uses `0.07° × sensitivity` per raw count. DPI affects the reported cm/360. The field of view is 103° horizontally at 16:9.
- Player physics run at 128 Hz. The rifle run speed is 5.4 m/s, and the movement accuracy cutoff is 27.5% of that speed. Braking, acceleration, and air steering are StrafeLab estimates. Running jumps preserve take-off momentum, and jumps from rest have up to 1.8 m/s of directional control. [Vandal stats](https://wiki.playvalorant.com/en-us/Vandal) · [Riot patch 3.0](https://playvalorant.com/en-us/news/game-updates/valorant-patch-notes-3-0/)
- The input code requests pointer lock before entering fullscreen. It collects early raw movement where available, ignores corresponding `mousemove` deltas, and applies pending motion before physics, aiming down sights, and firing. Losing capture pauses the run. Resume reacquires capture.
- Precision taps use event timestamps for fire cadence. Grid Taps and Multi-Target Switch reuse four target meshes. Hitmarker feedback restarts its animation without a synchronous layout read.
- The user wants the exact RGX 11z Pro skin and audio if authorized and declined substitute RGB designs. The current rifle assets and bot models are original. Any future RGX integration requires authorized files and permission from Riot. [Riot fan-content policy](https://www.riotgames.com/en/legal)

## Verification and open issue

Chrome automation verified mouse look while strafing and jumping in fullscreen, pause and resume after capture loss, the 360° turn calculation, separate ADS and scope settings, and 30 consecutive Grid Taps hits with four reused targets. Earlier browser checks also covered all 15 drill starts, the three new leaderboards, old local history entries, and a party start for Strafe Tracking.

The user reported intermittent mouse sticking during rapid Grid Taps flicks and clicks, and earlier while strafing or airborne in Counter-Strafe. The exact freeze did not reproduce in automation. A physical-mouse playtest on the affected setup is still pending.

For browser input and hit-testing references, see the [MIT-licensed AimForge input code](https://github.com/Shiraikuroko123/aimforge/blob/main/js/game.js), [VANTA](https://github.com/aimtrainer-code/aim-trainer), and [Three.js PointerLockControls](https://github.com/mrdoob/three.js/blob/dev/examples/jsm/controls/PointerLockControls.js).
