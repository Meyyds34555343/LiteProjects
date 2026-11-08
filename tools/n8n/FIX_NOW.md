# Fix n8n meme upload (do these in order)

## A. Update the workflow (required)

1. In n8n, open **CoinDuel — Add Meme Pic**.
2. Either:
   - **Delete** the old workflow and **Import** `tools/n8n/coinduel-add-meme.json` again, **or**
   - Open **Parse + Commit CDN** → replace all code with contents of `tools/n8n/parse-commit-cdn.js`.
3. Open **Repo Config** → set **`githubToken`** = your GitHub PAT (Contents Read/Write on LiteProjects).
4. Top right → **Publish ON**.
5. Webhook node → **Copy production url** (must contain `/webhook/`).

## B. Editor

Use: latest shipstatic editor from the chat (or local `blockly-public/index.html`).

1. **Meme** → paste Production `/webhook/` URL.
2. **memeId** = English only, e.g. `demo_firstmeme` (not Chinese).
3. Choose image → **Add Meme → n8n**.

## C. If it still fails

1. n8n → **Executions** tab → open the red run → read the error text.
2. Confirm Repo Config `githubToken` is not empty.
3. Confirm memeId is like `demo_firstmeme`.
