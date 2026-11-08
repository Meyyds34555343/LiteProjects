# CoinDuel n8n — Add Meme Pic pipeline

Webhook from the Blockly editor → commits a new meme PNG + JSON into the GitHub CDN (`cdn/`).

## 1. n8n Cloud

1. Open [n8n Cloud](https://app.n8n.cloud/) → **Workflows** → **…** → **Import from File**.
2. Import [`coinduel-add-meme.json`](coinduel-add-meme.json).
3. Open **Repo Config** → paste your GitHub PAT into **`githubToken`**  
   (fine-grained, Contents Read/Write on `LiteProjects`).  
   Optional: also set Global Variable `GITHUB_PAT` (read as `$vars.GITHUB_PAT`).  
   Do **not** rely on `$env` on n8n Cloud — it is often blocked and causes HTTP 500.
4. Optional: set `webhookSecret`. Defaults: `Meyyds34555343` / `LiteProjects` / `behavior-scratch`.
5. **Save** → **Active** (toggle on).
6. Open the **Webhook** node → copy the **Production** URL  
   (looks like `https://<your>.app.n8n.cloud/webhook/coinduel-add-meme`).

## 2. Blockly editor

1. Open the editor → **Meme** (or expand the meme bar).
2. Paste the Production webhook URL.
3. If you set `webhookSecret` in n8n, paste the same value in **Secret**.
4. Enter `memeId` (e.g. `cool_cat`), pick a behavior, choose a PNG → **Add Meme → n8n**.

On success the workflow commits:

- `cdn/textures/{memeId}.png`
- `cdn/memes/{memeId}.json`
- updates `cdn/memes/index.json`
- bumps hashes in `cdn/manifest.json`

jsDelivr may lag 1–5 minutes before the catalog refresh shows the new meme.

## POST body (editor → n8n)

```json
{
  "memeId": "cool_cat",
  "behavior": "FreezeBehavior",
  "mime": "image/png",
  "radius": 32,
  "imageBase64": "<raw base64, no data: prefix required but accepted>"
}
```

Optional header: `X-Coinduel-Secret: <webhookSecret>`.
