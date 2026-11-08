const wh = $('Webhook').first().json;
const cfg = $('Repo Config').first().json;

function parseMaybe(v) {
  if (v == null) return null;
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return null;
    try { return JSON.parse(s); } catch (e) { return null; }
  }
  if (typeof v === 'object') return v;
  return null;
}

function pickBody(root) {
  const candidates = [
    root,
    root && root.body,
    root && root.data,
    root && root.json,
    root && root.payload,
    root && root.rawBody,
  ];
  for (let i = 0; i < candidates.length; i++) {
    let cur = candidates[i];
    if (typeof cur === 'string') cur = parseMaybe(cur);
    if (!cur || typeof cur !== 'object') continue;
    if (cur.memeId != null || cur.id != null || cur.imageBase64 != null || cur.image != null) {
      return cur;
    }
    if (cur.body) {
      let nested = cur.body;
      if (typeof nested === 'string') nested = parseMaybe(nested);
      if (nested && typeof nested === 'object' && (nested.memeId != null || nested.imageBase64 != null)) {
        return nested;
      }
    }
  }
  return (parseMaybe(root && root.body) || {});
}

const body = pickBody(wh) || {};
const headers = wh.headers || {};

const secret = String(cfg.webhookSecret || '').trim();
if (secret) {
  const got = String(headers['x-coinduel-secret'] || headers['X-Coinduel-Secret'] || body.secret || '');
  if (got !== secret) {
    return [{ json: { ok: false, error: 'Unauthorized (bad secret)', statusCode: 401 } }];
  }
}

const memeId = String(body.memeId || body.id || '')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9_\-]/g, '_')
  .replace(/_+/g, '_')
  .replace(/^_|_$/g, '');

if (!memeId || memeId.length > 64) {
  const keys = body && typeof body === 'object' ? Object.keys(body).slice(0, 20).join(',') : String(typeof body);
  return [{
    json: {
      ok: false,
      statusCode: 400,
      error: 'memeId required (English a-z 0-9 _ -). Example: demo_firstmeme. Got keys: ' + keys,
    },
  }];
}

let imageBase64 = String(body.imageBase64 || body.image || '');
if (imageBase64.indexOf('base64,') >= 0) imageBase64 = imageBase64.split('base64,').pop();
imageBase64 = imageBase64.replace(/\s/g, '');
if (!imageBase64 || imageBase64.length < 32) {
  return [{ json: { ok: false, error: 'imageBase64 required', statusCode: 400 } }];
}

const mime = String(body.mime || 'image/png');
const ext = (mime.indexOf('jpeg') >= 0 || mime.indexOf('jpg') >= 0) ? 'jpg' : 'png';
const behavior = String(body.behavior || 'NoneBehavior').trim() || 'NoneBehavior';
const radius = Number(body.radius != null ? body.radius : 32) || 32;

let token = String(cfg.githubToken || '').trim();
if (!token) {
  try { token = String(($vars && $vars.GITHUB_PAT) || '').trim(); } catch (e) {}
}
if (!token) {
  return [{
    json: {
      ok: false,
      statusCode: 500,
      error: 'No GitHub token. Repo Config → set githubToken to your PAT (Contents Read/Write).',
    },
  }];
}

const owner = String(cfg.owner || 'Meyyds34555343');
const repo = String(cfg.repo || 'LiteProjects');
const branch = String(cfg.branch || 'behavior-scratch');
const texPath = 'cdn/textures/' + memeId + '.' + ext;
const memePath = 'cdn/memes/' + memeId + '.json';
const indexPath = 'cdn/memes/index.json';
const manifestPath = 'cdn/manifest.json';
const hashTag = 'n8n-' + memeId + '-' + Date.now().toString(36);
const texRel = 'textures/' + memeId + '.' + ext;

const memeJson = {
  id: memeId,
  behavior: behavior,
  behaviors: [behavior],
  radius: radius,
  textures: {
    default: texRel,
    idle: texRel,
    aim: texRel,
    shot: texRel,
    hitted: texRel,
  },
};

async function gh(method, path, putBody) {
  const url = 'https://api.github.com/repos/' + owner + '/' + repo + path;
  const opts = {
    method: method,
    url: url,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: 'Bearer ' + token,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'CoinDuel-n8n-meme-pipeline',
    },
    json: true,
  };
  if (putBody != null) opts.body = putBody;
  try {
    return await this.helpers.httpRequest(opts);
  } catch (e) {
    const status = e.statusCode || e.httpCode || (e.response && e.response.statusCode);
    if (method === 'GET' && (status === 404 || String(e.message || '').indexOf('404') >= 0)) return null;
    throw new Error((e.message || String(e)) + ' [' + method + ' ' + path + ']');
  }
}

async function upsertFile(filePath, contentBase64, message) {
  const encPath = filePath.split('/').map(encodeURIComponent).join('/');
  const existing = await gh.call(this, 'GET', '/contents/' + encPath + '?ref=' + encodeURIComponent(branch));
  const payload = {
    message: message,
    content: contentBase64,
    branch: branch,
  };
  if (existing && existing.sha) payload.sha = existing.sha;
  return gh.call(this, 'PUT', '/contents/' + encPath, payload);
}

function utf8ToBase64(str) {
  return Buffer.from(str, 'utf8').toString('base64');
}

try {
  await upsertFile.call(this, texPath, imageBase64, 'n8n: add texture ' + memeId);
  await upsertFile.call(this, memePath, utf8ToBase64(JSON.stringify(memeJson, null, 2) + '\n'), 'n8n: add meme ' + memeId);

  let indexObj = { memes: [] };
  const indexFile = await gh.call(this, 'GET', '/contents/' + indexPath.split('/').map(encodeURIComponent).join('/') + '?ref=' + encodeURIComponent(branch));
  if (indexFile && indexFile.content) {
    const raw = Buffer.from(String(indexFile.content).replace(/\n/g, ''), 'base64').toString('utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) indexObj = { memes: parsed };
    else indexObj = parsed && typeof parsed === 'object' ? parsed : { memes: [] };
    if (!Array.isArray(indexObj.memes)) indexObj.memes = [];
  }
  const brief = {
    id: memeId,
    behavior: behavior,
    behaviors: [behavior],
    radius: radius,
    textures: { default: texRel, idle: texRel },
  };
  const mi = indexObj.memes.findIndex(function (m) { return m && m.id === memeId; });
  if (mi >= 0) indexObj.memes[mi] = brief;
  else indexObj.memes.push(brief);
  await upsertFile.call(this, indexPath, utf8ToBase64(JSON.stringify(indexObj, null, 2) + '\n'), 'n8n: update meme index (' + memeId + ')');

  let manifest = { version: 1, baseUrl: '', memeConfig: 'memes/index.json', items: [] };
  const manFile = await gh.call(this, 'GET', '/contents/' + manifestPath.split('/').map(encodeURIComponent).join('/') + '?ref=' + encodeURIComponent(branch));
  if (manFile && manFile.content) {
    const raw = Buffer.from(String(manFile.content).replace(/\n/g, ''), 'base64').toString('utf8');
    manifest = JSON.parse(raw);
    if (!Array.isArray(manifest.items)) manifest.items = [];
  }
  function upsertItem(filename, kind) {
    const i = manifest.items.findIndex(function (it) { return it && it.filename === filename; });
    const row = { filename: filename, hash: hashTag, kind: kind };
    if (i >= 0) manifest.items[i] = Object.assign({}, manifest.items[i], row);
    else manifest.items.push(row);
  }
  upsertItem('memes/index.json', 'meme');
  upsertItem('memes/' + memeId + '.json', 'meme');
  upsertItem(texRel, 'texture');
  manifest.version = Number(manifest.version || 0) + 1;
  if (!manifest.memeConfig) manifest.memeConfig = 'memes/index.json';
  await upsertFile.call(this, manifestPath, utf8ToBase64(JSON.stringify(manifest, null, 2) + '\n'), 'n8n: bump CDN manifest for ' + memeId);

  return [{
    json: {
      ok: true,
      statusCode: 200,
      memeId: memeId,
      behavior: behavior,
      paths: { texture: texPath, meme: memePath, index: indexPath, manifest: manifestPath },
      branch: branch,
      hash: hashTag,
      cdnHint: 'https://cdn.jsdelivr.net/gh/' + owner + '/' + repo + '@' + branch + '/cdn/memes/' + memeId + '.json',
    },
  }];
} catch (e) {
  return [{
    json: {
      ok: false,
      statusCode: 500,
      error: e.message || String(e),
    },
  }];
}
