# Repository Guidelines

## Project Structure & Module Organization

This repository contains small game projects. `CoinDuel2D/` is a Cocos Creator 3.8.8 project; gameplay scripts live in `CoinDuel2D/assets/Scripts/`, scenes in `CoinDuel2D/assets/Levels/`, prefabs in `CoinDuel2D/assets/Prefabs/`, and imported art/audio resources in `CoinDuel2D/assets/Resources/`. Cocos-generated folders such as `CoinDuel2D/library/`, `temp/`, `profiles/`, `build/`, and `node_modules/` are ignored and should not be edited manually. `CoinPlay/` contains standalone HTML/JS experiments and assets such as `GameJamFinal.html`, `soundManager.js`, and `coin.wav`.

### Web-first Mod workflow (80/20)

- **Web editor (~80% of creation):** `CoinDuel2D/tools/blockly-public/` — live at https://glitchy-veil-4s4chq7.shipstatic.com/ . Authors `ModConfig` / `COINMOD1` packs: levels, rules, physics, memes, `uiStrings`. Live preview aims/bounces without opening Creator.
- **CDN data:** repo `/cdn` — memes, textures, levels; hash-diff via `AssetSyncManager`. See [cdn/README.md](cdn/README.md).
- **Cocos runtime (~20% engine):** executes packs via `GameLogicInterpreter` + `ModAutoBoot` (`?mod=` / `?modUrl=` / localStorage). Prefer Scratch level when present. New behaviors/opcodes still require TypeScript in Creator.
- **Share contract:** `COINMOD1:` + base64 JSON (`ModConfigSchema.ts`). Do not embed large PNGs in share codes — reference CDN `memeId`s.

## Build, Test, and Development Commands

Open `CoinDuel2D/` with Cocos Creator 3.8.8 for scene editing, preview, and builds. There are currently no npm scripts in `CoinDuel2D/package.json`; use the Cocos Creator UI for normal build and run workflows. For TypeScript validation, run from `CoinDuel2D/`:

```powershell
npx tsc --noEmit
```

For `CoinPlay/`, open the relevant HTML file directly in a browser, for example `CoinPlay/GameJamFinal.html`.

## Coding Style & Naming Conventions

Use TypeScript for Cocos gameplay code and follow the existing Cocos component pattern: `@ccclass('ClassName')`, exported PascalCase component classes, camelCase methods and fields, and `@property` for editor-exposed values. Keep source files under `assets/Scripts/` and name components after their primary behavior, such as `GameLogic.ts` or `TestImpulse.ts`. Preserve `.meta` files when moving or adding Cocos assets.

## Testing Guidelines

No automated test framework is configured yet. Verify Cocos changes by previewing the scene in Cocos Creator and checking relevant browser/console output. When adding automated tests later, place them near the code under test or in a clearly named test directory, and document the command in this file.

## Commit & Pull Request Guidelines

Git history is minimal, with short summary commits such as `Initial commit` and `PG/Lite Project Updates`. Use concise, imperative commit subjects that describe the changed area, for example `Update coin fall detection`. Pull requests should include a brief description, manual verification steps, linked issues when available, and screenshots or short recordings for gameplay or UI changes.

## Security & Configuration Tips

Do not commit generated Cocos cache/build output or local editor state. Keep large source assets intentional and avoid adding temporary exports, autosaves, or machine-specific workspace files.
