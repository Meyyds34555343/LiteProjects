# CoinDuel2D remote CDN (free hot-update)

Drop assets here. The game pulls them through `AssetSyncManager` (hash-diff, cache locally).

## Web-first 80/20 checklist

| Work in Web Editor + `/cdn` (≈80%) | Work in Cocos Creator (≈20%) |
|------------------------------------|------------------------------|
| Level layouts, striker placement | New `BehaviorBase` subclasses |
| Rule graphs (events / conditions / actions) | New opcodes in `GameLogicInterpreter` |
| Win / lose rules, variables, tags | Core foul / settle / shot FSM |
| Meme pick + skin URLs + table felt/wall | RigidBody2D, colliders, camera |
| Physics knobs on ModConfig | Shaders, audio device quirks |
| `uiStrings` win/lose copy | Prefabs / scenes / build / itch |
| Bump CDN hashes & publish | Register new behaviors |

**Litmus test:** Can a designer ship it by editing blocks/JSON and bumping a hash? → Web. Needs a new `.ts` file? → Cocos.

### Creator loop (zero-touch)

1. Open Blockly: https://glitchy-veil-4s4chq7.shipstatic.com/
2. Design → **Copy COINMOD1** (or **Open in Runtime**).
3. Runtime auto-loads `?mod=` via `ModAutoBoot`, syncs this CDN, spawns Scratch level — no Creator rebuild.

## Folder rules

```text
cdn/
  manifest.json          # bump version + item.hash when a file changes
  memes/
    index.json           # meme list bundle
    <memeId>.json        # single meme (textures + behaviors[])
  levels/
    <id>.json
  mods/
    <id>.json
  textures/
  audio/
```

## How to update (no rebuild / no paid CDN)

1. Replace or add files under `cdn/` (PNG, JSON, …).
2. Change that file’s `hash` string in `manifest.json` (any new unique string).
3. Bump `manifest.version`.
4. Publish this folder (GitHub → jsDelivr, or re-deploy shipstatic).
5. Next launch: client downloads only changed hashes.

### Current default host (jsDelivr → GitHub fork)

Game default (`CdnConfig.DEFAULT_CDN_MANIFEST_URL`):

```text
https://cdn.jsdelivr.net/gh/Meyyds34555343/LiteProjects@behavior-scratch/cdn/manifest.json
```

After merging `behavior-scratch` → `main`, switch `@behavior-scratch` to `@main`.

Legacy shipstatic (optional claim): https://fractal-flow-va9gm22.shipstatic.com/manifest.json

### Behavior as meme example (Phase 3)

1. Level coin sets `"memeId": "demo_freeze"` (see `levels/demo_behavior.json`).
2. `AssetSyncManager.spawnConfiguredCoin` reads `MemeConfig.behaviors` → `BehaviorRegistry.attach`.
3. To hot-swap: edit `memes/demo_freeze.json` behaviors to `["FlashStepBehavior"]`, bump that item’s `hash` in `manifest.json`, republish CDN.
4. Next launch: same memeId, different behavior — no Cocos rebuild.

New *behavior logic* still needs a client ship + `BehaviorRegistry.register`.  
Which meme uses which behavior is data-only.

Play the demo level: set `LevelManager.setScratchLevel` from `levels/demo_behavior.json` (or paste as Scratch level), then enter Game.

## Offline

Empty `manifestUrl` or failed fetch → local Resources / last disk cache.
