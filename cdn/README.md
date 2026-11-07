# CoinDuel2D remote CDN (free hot-update)

Drop assets here. The game pulls them through `AssetSyncManager` (hash-diff, cache locally).

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

### Current free host (shipstatic)

Game default (`CdnConfig.DEFAULT_CDN_MANIFEST_URL`):

```text
https://fractal-flow-va9gm22.shipstatic.com/manifest.json
```

Claim for longer life: https://my.shipstatic.com/claim/f8ad06672d8b3f42c74871bd56eed7b4

### Preferred long-term host

Push this repo to GitHub, then set game `manifestUrl` to:

```text
https://cdn.jsdelivr.net/gh/<USER>/<REPO>@main/cdn/manifest.json
```

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
