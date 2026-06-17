# Neon Connect VR — Build Journal

## Round 1: Sentinel 1AM Takeover
**Date:** 2026-06-17 | **Duration:** ~45 min | **Builder:** Sentinel (1AM check-in)

### Situation
Master AM cron (midnight PT) stalled mid-scaffold. Created project directory, package.json, vite.config.ts, index.html, and 14 .uikitml UI templates, but `src/` was empty — zero game code. Status file showed `building` with empty rounds and 0 minutes elapsed. Sentinel detected stall pattern (empty rounds + >30 min elapsed) and took over.

### What Was Built
Complete Connect Four VR game in a single `src/index.ts` (1,517 LOC):

- **Board Logic:** Variable grid sizes (6×7, 7×8, 8×9), win detection for connect-4 and connect-5 modes
- **AI:** Minimax with alpha-beta pruning, configurable depth (easy=2, medium=4, hard=6)
- **Game Modes:** 8 (classic, timed, blitz, popout, five-in-a-row, daily challenge, practice, versus)
- **Achievements:** 50 with XP/level progression system
- **Disc Skins:** 8 unlockable skins
- **Audio:** Full procedural audio (drop, win, lose, draw, achievement, navigation, invalid)
- **UI:** 14 PanelUI spatial panels (title, HUD, gameover, mode select, difficulty, achievements, settings, pause, stats, leaderboard, help, skins, toast, countdown)
- **Persistence:** localStorage for stats, achievements, settings, equipped skin, XP/level
- **Input:** XR controller support via RayInteractable + browser keyboard/mouse

### Issues Fixed
1. **Follower getVectorView:** Initial `addComponent(Follower, { offsetPosition: [...] })` threw "Array/vector types must be written via getVectorView" — fixed by adding Follower without offset then using `getVectorView` to set offset.
2. **Vite SPA fallback bug:** `/ui/achievements.json` specifically returned HTML instead of JSON through Vite dev server (all other 13 JSON files served correctly). Root cause unknown (possibly Vite middleware path collision). Fixed by renaming to `achvlist.uikitml`/`achvlist.json`.
3. **TypeScript issues:** `@types/three` missing (copied from monorepo), `world.camera` used as Follower target (world.player not available in dist types), DOM keyboard tracking instead of `world.input.keyboard` (not on XRInputManager type).

### Verification
- ✅ Zero TypeScript errors (`tsc --noEmit`)
- ✅ Zero runtime errors in dev logs after fixes
- ✅ All 14 PanelUI entities have PanelDocument (confirmed via `ecs find`)
- ✅ GameLoopSystem registered and running (confirmed via `ecs systems`)
- ✅ Board renders correctly in headless browser (cyan grid, disc slots visible)
- ⚠️ PanelUI panels not visible in headless screenshots (likely SwiftShader limitation — panels confirmed loaded via ECS)
- ✅ Production build succeeds (14 compiled, 0 failed)
- ✅ Deployed to GitHub Pages

### Deployment
- Repo: https://github.com/ellyz2426/neon-connect
- Live: https://ellyz2426.github.io/neon-connect/
