# Google Drive → permanent jsDelivr `cdn/manifest.json`

Game code keeps **one** URL forever:

`https://cdn.jsdelivr.net/gh/Meyyds34555343/LiteProjects@behavior-scratch/cdn/manifest.json`

This workflow only **overwrites** files under `cdn/` on branch `behavior-scratch`. The jsDelivr link never changes.

Import: [`coinduel-gdrive-cdn-sync.json`](coinduel-gdrive-cdn-sync.json)

## Architecture

```
Google Drive folder (new/updated PNG)
        ↓
n8n: download binary
        ↓
Code: texture path + manifest item + hash
        ↓
GitHub Contents API upsert
  PUT cdn/textures/{name}.png   (same path → overwrite)
  PUT cdn/manifest.json         (same path → overwrite)
        ↓
jsDelivr serves updated bytes at the SAME URL
```

## Credentials

1. **Google Drive OAuth2** — connect in n8n → Credentials.  
2. **GitHub** — fine-grained PAT with **Contents: Read and Write** on `Meyyds34555343/LiteProjects`.  
   Paste into **Repo Config → `githubToken`** (preferred on n8n Cloud).  
   Optional: Global Variable `GITHUB_PAT` / `githubToken` via `$vars`.

## Node setup

### 1) Google Drive Trigger

| Setting | Value |
|--------|--------|
| Credential | your Google Drive OAuth2 |
| Trigger On | Specific Folder |
| Event | **File Created** (add a 2nd trigger or duplicate workflow for **File Updated**) |
| Folder | pick your “CDN inbox” folder |
| Poll | every minute (Cloud default) |

Create a Drive folder e.g. `CoinDuel CDN Drop` and drop PNGs named like `meme_03.png` (filename becomes `cdn/textures/meme_03.png`).

### 2) Repo Config (Set)

Already filled for your repo:

- `owner` = `Meyyds34555343`
- `repo` = `LiteProjects`
- `branch` = `behavior-scratch`
- `cdnPrefix` = `cdn`
- `jsdelivrBase` = `https://cdn.jsdelivr.net/gh/Meyyds34555343/LiteProjects@behavior-scratch/cdn`
- **`githubToken`** = your PAT

### 3) Download File (Google Drive)

- Operation: **Download**
- File ID: `={{ $json.id }}` (from the trigger)
- Binary property: `data`

### 4) Code — Build CDN Paths + Manifest Item

Produces relative paths the game already understands (`AssetManifest.items[]`):

```js
{
  filename: "textures/meme_03.png",
  hash: "gdrive-meme_03-xxxx",
  kind: "texture",
  url: "https://cdn.jsdelivr.net/gh/.../cdn/textures/meme_03.png" // optional
}
```

`baseUrl` stays `""` in `manifest.json` so AssetSync resolves against the permanent manifest directory.

### 5) Upsert Texture + Manifest (Code + GitHub Contents API)

**Upsert pattern** (do not create unique paths):

1. `GET /repos/{owner}/{repo}/contents/{path}?ref=behavior-scratch` → read `sha` if file exists  
2. `PUT /repos/{owner}/{repo}/contents/{path}` with:
   - `branch`: `behavior-scratch`
   - `content`: base64
   - `sha`: previous sha **when overwriting** (omit only for brand-new files)
   - `message`: commit message

Always target:

- `cdn/textures/{stem}.png` ← overwrite same name  
- `cdn/manifest.json` ← **never** `manifest-v2.json` / dated names  

## Permanent link checklist

| What | Value |
|------|--------|
| Game `DEFAULT_CDN_MANIFEST_URL` | `...@behavior-scratch/cdn/manifest.json` |
| GitHub path | `cdn/manifest.json` |
| Branch | `behavior-scratch` |
| After commit | Wait 1–5 min for jsDelivr, or open `?t=` cache-bust in AssetSync |

## Relation to “Add Meme Pic”

| Workflow | Trigger | Writes |
|----------|---------|--------|
| `coinduel-add-meme.json` | Editor webhook | texture + meme JSON + index + manifest |
| `coinduel-gdrive-cdn-sync.json` | Drive **File Created** | texture + manifest merge |
| `coinduel-gdrive-cdn-delete.json` | Drive **File Deleted** | delete texture (+ meme json) + drop from manifest |

All target the **same** `cdn/manifest.json` so the game URL stays permanent.

### Delete path setup

1. Import `coinduel-gdrive-cdn-delete.json`.  
2. Same Google Drive folder + OAuth as the sync workflow.  
3. Paste `githubToken` in Repo Config.  
4. Activate. Delete a PNG from Drive → GitHub removes `cdn/textures/…` and updates manifest.

## Manual verify

1. Drop `test_skin.png` into the watched Drive folder.  
2. n8n Executions → green.  
3. GitHub → `cdn/textures/test_skin.png` + updated `cdn/manifest.json`.  
4. Open permanent manifest URL (hard refresh). Confirm new `items[]` entry.  
5. Play runtime with existing Open Runtime link — no URL change in code.
