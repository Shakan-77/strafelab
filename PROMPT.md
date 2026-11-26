# StrafeLab development handoff prompt

You are continuing work in the `Shakan-77/strafelab` repository. Read `CONTEXT.md` and `README.md`, then inspect the current branch and working tree. StrafeLab is a local browser-based trainer for Valorant aim and movement practice. Keep this session focused on local development and playtesting.

## Priority

Investigate any remaining mouse sticking while a player flicks and clicks quickly in **Grid Taps** or looks around while moving and jumping in **Counter-Strafe Drill**. The current build improved input handling and frame performance, and Chrome automation passed the known regression checks. The reported freeze still needs a physical-mouse reproduction on the affected setup.

## Reproduce and diagnose

1. Run `python server.py --host 127.0.0.1 --port 8787` and open `http://localhost:8787/` in desktop Chrome or Edge. Test the normal URL for real pointer lock. Use `?debug=1` for scripting and inspecting game state.
2. In **Grid Taps**, alternate short and long flicks while tapping multiple targets. In **Counter-Strafe Drill**, alternate A and D, jump, and move the mouse on both axes. Test both fullscreen and windowed play, then release capture and use **Resume**.
3. Run the **System check** tab and press **Copy report**. It measures polling rate and separates input stalls (mouse still reporting, no `mousemove` reaching the page), movement spikes and frame hitches. If the issue reproduces in a drill, pause right away and open **Input details** for the stall, spike and hitch counts since capture. Use both alongside a physical reproduction to distinguish interrupted capture, missing movement events, and slow rendering.
4. Fix the confirmed cause, then rerun the failing sequence. Check that the mouse rotates by the expected angle, clicks use the latest aim, capture and resume work, and the three newer drills still score correctly. Report which checks used automation and which used a physical mouse.

## Constraints and references

- Preserve the `0.07° × sensitivity` raw-input turn rate, the separate ADS and sniper scope multipliers, and the user's existing bindings and browser data. Keep the pointer input path independent of ground and air movement. Treat undocumented Valorant movement numbers as estimates.
- Use original or properly licensed assets. The user wants the exact RGX 11z Pro model and audio only if authorized. Add them only when Riot has authorized the files for use in StrafeLab.
- Use [AimForge](https://github.com/Shiraikuroko123/aimforge/blob/main/js/game.js), [VANTA](https://github.com/aimtrainer-code/aim-trainer), or [Three.js PointerLockControls](https://github.com/mrdoob/three.js/blob/dev/examples/jsm/controls/PointerLockControls.js) as references for input handling and hit registration. Consult Riot's published material for game-specific tuning and document assumptions in the Guide.
- Keep the diff focused on the current request. At handoff, summarize changes, verification, and anything that still needs the user's setup. Commit and push follow-up work when requested.
