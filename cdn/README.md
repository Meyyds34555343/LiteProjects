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

1. Open Blockly on a **real HTML host** (shipstatic / GitHub Pages).  
   jsDelivr of `index.html` only shows source text — it is not a page host.  
   Permanent option: GitHub Pages → `https://meyyds34555343.github.io/LiteProjects/`
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

`manifest.json` 的 `items` 是唯一資料來源；不要再依賴舊的 `memeConfig` / `levelConfig` 欄位（仍向後相容）。

1. Replace or add files under `cdn/` (PNG, JSON, …).
2. Change that file’s `hash` string in `manifest.json` (any new unique string).
3. Bump `manifest.version`.
4. Publish this folder (GitHub → jsDelivr, or re-deploy shipstatic).
5. Next launch: client downloads only changed hashes, rewrites `serverdata/`, and removes files no longer listed.

`kind` 可省略，會依副檔名／檔名推斷；支援 `meme | level | mod | json | texture | audio`。

### 本地快取

| 內容 | 位置 |
|------|------|
| 所有 JSON（含 `levels/*.json`、`config.json`） | `serverdata/<filename>` |
| 貼圖 / 音效 | Web：IndexedDB；原生：`serverdata/<filename>` |
| 快取索引（filename + hash + kind） | `serverdata/asset-index.json` |

啟動時先讀 `asset-index.json` 還原 JSON 與二進位索引，離線可用；`DataProvider` 會優先讀 `serverdata/`，沒有才回退 `Resources/`。

### 關卡目錄

關卡選擇畫面現在優先使用本地資產庫：`items` 中 `kind: "level"` 的條目會按 manifest 順序成為關卡列表，關卡資料也從 `serverdata/` 讀取。
本地資產庫沒有任何關卡時，才回退到內建 `Resources/levels.json`。

> 若希望 20 個闖關關卡繼續可玩，需要把 `levels/1.json` … `levels/20.json` 也加入 `manifest.json` 的 `items`。

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

Empty `manifestUrl` or failed fetch → last `serverdata/` cache（JSON + IndexedDB 二進位）→ built-in `Resources/`。
