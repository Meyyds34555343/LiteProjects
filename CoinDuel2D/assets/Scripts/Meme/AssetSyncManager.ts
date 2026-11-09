import {
    _decorator,
    AudioClip,
    Component,
    Node,
    Prefab,
    SpriteFrame,
    sys,
} from 'cc';
import { NetworkManager } from '../NetworkManager';
import { StorageManager } from '../StorageManager';
import { CoinController } from '../CoinController';
import {
    AssetManifest,
    CachedHashMap,
    CoinConfig,
    CoinSkinConfig,
    isCoinConfig,
    LevelConfig,
    ManifestItem,
    MemeConfig,
    MemeTextureSet,
    TableConfig,
} from './MemeSchema';
import { ModConfig } from '../Mod/ModConfigSchema';
import { GameLogicInterpreter } from '../Mod/GameLogicInterpreter';
import { DynamicAssetLoader, PRESET_COIN_SKINS } from './DynamicAssetLoader';
import { TableController } from '../TableController';
import { Sprite } from 'cc';
import { DEFAULT_CDN_MANIFEST_URL, resolveCdnManifestUrl } from './CdnConfig';

const { ccclass, property } = _decorator;

const HASH_KEY = 'AssetSync:hashes';
const CACHE_DIR = 'assetsync';

/** 避免與 GameLogic 循環引用；執行期傳入的就是 GameLogic。 */
export interface LevelSpawnHost {
    spawnCoinAt(prefab: Prefab, x: number, y: number, radius?: number, behaviorId?: string): Node;
    spawnBlockerAt(x: number, y: number, radius?: number): void;
    spawnMudAt(x: number, y: number, radius?: number): void;
    attachCoinBehavior(coin: Node, behaviorId: string): void;
}

interface TexturePack {
    default: SpriteFrame | null;
    idle: SpriteFrame | null;
    aim: SpriteFrame | null;
    shot: SpriteFrame | null;
    hitted: SpriteFrame | null;
}

/**
 * 熱更新與增量下載。
 * 流程：拉 AssetManifest → 比 localStorage hash → 只抓變更的 JSON／貼圖／音效 →
 * 用 LevelConfig 動態生成 Coin.prefab，再把 Meme 五態貼到 Sprite。
 */
@ccclass('AssetSyncManager')
export class AssetSyncManager extends Component {
    public static instance: AssetSyncManager | null = null;

    /**
     * Remote AssetManifest URL. Must be absolute https (jsDelivr).
     * Empty / relative / localhost is replaced by DEFAULT_CDN_MANIFEST_URL at sync time.
     */
    @property
    public manifestUrl: string = DEFAULT_CDN_MANIFEST_URL;

    private _running = false;
    private _memes = new Map<string, MemeConfig>();
    private _levels = new Map<number, LevelConfig>();
    private _mods = new Map<string, ModConfig>();
    private _frames = new Map<string, SpriteFrame>();
    private _clips = new Map<string, AudioClip>();
    private _hashes: CachedHashMap = { version: 0, hashes: {} };

    protected onLoad(): void {
        AssetSyncManager.instance = this;
        this._hashes = this._readHashes();
        StorageManager.createDir(CACHE_DIR);
        StorageManager.createDir(`${CACHE_DIR}/memes`);
        StorageManager.createDir(`${CACHE_DIR}/levels`);
        StorageManager.createDir(`${CACHE_DIR}/mods`);
        this._hydrateFromDisk();
    }

    protected onDestroy(): void {
        if (AssetSyncManager.instance === this) AssetSyncManager.instance = null;
    }

    public getMeme(id: string): MemeConfig | null {
        return this._memes.get(id) ?? null;
    }

    public getLevel(id: number): LevelConfig | null {
        return this._levels.get(id) ?? null;
    }

    public listLevels(): LevelConfig[] {
        return Array.from(this._levels.values()).sort((a, b) => a.id - b.id);
    }

    public getMod(id?: string): ModConfig | null {
        if (id) return this._mods.get(id) ?? null;
        const first = this._mods.values().next();
        return first.done ? null : first.value;
    }

    public listMods(): ModConfig[] {
        return Array.from(this._mods.values());
    }

    /**
     * 對齊圖上的資產交互流程：
     * Manifest → 比 hash → 增量下載 MemeConfig / LevelConfig / 貼圖音效。
     * Always uses an absolute CDN URL (never relative / 127.0.0.1). Cache-busts with ?t=.
     */
    public sync(done?: (err: string | null) => void): void {
        const clean = resolveCdnManifestUrl(this.manifestUrl);
        this.manifestUrl = clean;
        if (this._running) {
            console.warn('[AssetSync] sync already running');
            done?.('busy');
            return;
        }
        this._running = true;
        const fetchUrl = AssetSyncManager._withCacheBust(clean);
        console.log('[AssetSync] fetching manifest:', fetchUrl);
        NetworkManager.HttpGet(fetchUrl, (code, body) => {
            console.log(
                '[AssetSync] manifest HTTP',
                code,
                'bytes=',
                body ? body.length : 0,
                'url=',
                fetchUrl,
            );
            if (code !== 200 || !body) {
                console.warn(
                    '[AssetSync] manifest fetch failed — check itch Network tab for',
                    fetchUrl,
                    '| code=',
                    code,
                    '| bodyPreview=',
                    (body || '').slice(0, 160),
                );
                this._finish('network', done);
                return;
            }
            const manifest = this._parseManifest(body);
            if (!manifest) {
                console.warn('[AssetSync] manifest JSON invalid. Preview:', body.slice(0, 200));
                this._finish('manifest', done);
                return;
            }
            console.log(
                '[AssetSync] manifest ok version=',
                manifest.version,
                'items=',
                manifest.items?.length ?? 0,
                'baseUrl=',
                manifest.baseUrl || '(from manifest path)',
            );
            this._syncManifest(manifest, (ok) => {
                if (ok) {
                    this._hashes.version = manifest.version;
                    this._writeHashes();
                }
                this._finish(ok ? null : 'download', done);
            });
        });
    }

    /** Append ?t=epoch (or &t=) so itch / CDN / browser do not serve a stale manifest. */
    private static _withCacheBust(url: string): string {
        const sep = url.indexOf('?') >= 0 ? '&' : '?';
        return `${url}${sep}t=${Date.now()}`;
    }

    /**
     * 依 LevelConfig.coins[] 動態生成硬幣，套 canshot / behaviors / meme 五態貼圖。
     */
    public spawnLevelCoins(gl: LevelSpawnHost, level: LevelConfig, coinPrefab: Prefab): Node[] {
        const spawned: Node[] = [];
        for (const item of level.coins) {
            if (!isCoinConfig(item)) {
                if (item.type === 'block') gl.spawnBlockerAt(item.x, item.y, item.radius);
                else if (item.type === 'mud') gl.spawnMudAt(item.x, item.y, item.radius);
                else if (item.type === 'bomb') {
                    // bomber prefab 由 GameScene 注入；此處只處理一般硬幣管線
                }
                continue;
            }
            const node = this.spawnConfiguredCoin(gl, coinPrefab, item);
            if (node) spawned.push(node);
        }
        return spawned;
    }

    /** 生成一枚並套 Meme／行為。 */
    public spawnConfiguredCoin(gl: LevelSpawnHost, prefab: Prefab, cfg: CoinConfig): Node | null {
        const meme = cfg.memeId ? this._memes.get(cfg.memeId) : null;
        const radius = cfg.radius ?? meme?.radius;
        const primary =
            cfg.behaviors?.[0] ||
            meme?.behaviors?.[0] ||
            meme?.behavior ||
            undefined;
        const node = gl.spawnCoinAt(prefab, cfg.x, cfg.y, radius, primary);
        const ctrl = node.getComponent(CoinController);
        if (ctrl && cfg.canshot === false) {
            ctrl.allowedOperation = false;
            ctrl.showIndicator(false);
        }
        const extras = [
            ...(cfg.behaviors ?? []).slice(1),
            ...(meme?.behaviors ?? []).slice(primary ? 1 : 0),
        ];
        for (const id of extras) {
            if (id && id !== primary) gl.attachCoinBehavior(node, id);
        }
        if (cfg.memeId) this.applyMemeToCoin(node, cfg.memeId);
        // skin / skinKey 可疊加或單獨使用（不需重編場景）
        if (cfg.skin || cfg.skinKey) this.applyCoinSkin(node, cfg);
        return node;
    }

    /**
     * 熱換單幣外觀：preset key、自訂 URL、或 Base64。
     * 直接寫入世界空間 Coin Sprite，不改 Canvas HUD。
     */
    public applyCoinSkin(coin: Node, cfg: CoinConfig | CoinSkinConfig, done?: () => void): void {
        const skin: CoinSkinConfig = 'skin' in cfg || 'skinKey' in cfg
            ? {
                ...(((cfg as CoinConfig).skin) ?? {}),
                preset: (cfg as CoinConfig).skin?.preset ?? (cfg as CoinConfig).skinKey,
            }
            : (cfg as CoinSkinConfig);

        const preset = skin.preset ? PRESET_COIN_SKINS[skin.preset] : null;
        const refs = {
            default: skin.default ?? preset?.default,
            idle: skin.idle ?? preset?.idle ?? skin.default ?? preset?.default,
            aim: skin.aim ?? preset?.aim,
            shot: skin.shot ?? preset?.shot,
            hitted: skin.hitted ?? preset?.hitted,
        };
        DynamicAssetLoader.loadSpriteSet(refs, (pack) => {
            const ctrl = coin.getComponent(CoinController);
            if (!ctrl?.isValid) {
                // 無 CoinController 時直接套到 Sprite
                const sprite = CoinController.getCoinSprite(coin) ?? coin.getComponent(Sprite);
                if (sprite && pack.default) sprite.spriteFrame = pack.default;
                done?.();
                return;
            }
            const typeKey = skin.preset
                ?? (('memeId' in cfg && (cfg as CoinConfig).memeId) ? String((cfg as CoinConfig).memeId) : 'skin');
            ctrl.setAppearance({
                typeKey,
                defaultFrame: pack.default,
                idleFrame: pack.idle ?? pack.default,
                aimFrame: pack.aim ?? pack.default,
                shotFrame: pack.shot ?? pack.default,
                hittedFrame: pack.hitted ?? pack.default,
            });
            const finish = () => done?.();
            if (!skin.shotSfx && !skin.hittedSfx) {
                finish();
                return;
            }
            DynamicAssetLoader.loadAudio(skin.shotSfx ?? '', (shot) => {
                DynamicAssetLoader.loadAudio(skin.hittedSfx ?? '', (hit) => {
                    if (!ctrl.isValid) {
                        finish();
                        return;
                    }
                    ctrl.setAppearance({
                        typeKey: skin.preset ?? 'skin',
                        shotSfxClip: shot,
                        hittedSfxClip: hit,
                    });
                    finish();
                });
            });
        });
    }

    /** 熱換桌布／圍牆（TableController 世界節點）。 */
    public applyTableConfig(table: TableController | null, cfg: TableConfig | undefined, done?: () => void): void {
        if (!table || !cfg) {
            done?.();
            return;
        }
        let pending = 0;
        const tick = () => {
            pending--;
            if (pending <= 0) done?.();
        };
        if (cfg.felt) {
            pending++;
            DynamicAssetLoader.loadSprite(cfg.felt, (frame) => {
                table.applyFeltSkin(frame, cfg.tint);
                tick();
            });
        }
        if (cfg.wall) {
            pending++;
            DynamicAssetLoader.loadSprite(cfg.wall, (frame) => {
                table.applyWallSkin(frame);
                tick();
            });
        }
        if (pending === 0) done?.();
    }

    /** 公開：依 hash URL / Base64 / preset 取 SpriteFrame。 */
    public loadSpriteHot(ref: string, done: (frame: SpriteFrame | null) => void): void {
        DynamicAssetLoader.loadSprite(ref, (frame) => {
            if (frame) this._frames.set(ref, frame);
            done(frame);
        });
    }

    /** 公開：依 hash URL / Base64 / preset 取 AudioClip。 */
    public loadAudioHot(ref: string, done: (clip: AudioClip | null) => void): void {
        DynamicAssetLoader.loadAudio(ref, (clip) => {
            if (clip) this._clips.set(ref, clip);
            done(clip);
        });
    }

    /**
     * 把 Meme 的 default/idle/aim/shot/hitted 套到 CoinController，
     * 之後 showIdle / showAim / showShot / showHit 會自動換圖。
     */
    public applyMemeToCoin(coin: Node, memeId: string, done?: () => void): void {
        const meme = this._memes.get(memeId);
        const ctrl = coin.getComponent(CoinController);
        if (!meme || !ctrl) {
            done?.();
            return;
        }
        this._loadTextureSet(meme.textures, (pack) => {
            if (!ctrl.isValid) {
                done?.();
                return;
            }
            ctrl.setAppearance({
                typeKey: memeId,
                defaultFrame: pack.default,
                idleFrame: pack.idle ?? pack.default,
                aimFrame: pack.aim ?? pack.default,
                shotFrame: pack.shot ?? pack.default,
                hittedFrame: pack.hitted ?? pack.default,
            });
            this._loadOptionalClip(meme.shotSfx, (shot) => {
                this._loadOptionalClip(meme.hittedSfx, (hit) => {
                    if (!ctrl.isValid) {
                        done?.();
                        return;
                    }
                    ctrl.setAppearance({
                        typeKey: memeId,
                        shotSfxClip: shot,
                        hittedSfxClip: hit,
                    });
                    done?.();
                });
            });
        });
    }

    // ── sync internals ──

    private _syncManifest(manifest: AssetManifest, done: (ok: boolean) => void): void {
        const queue: ManifestItem[] = manifest.items.slice();
        if (manifest.memeConfig) {
            queue.push({ filename: manifest.memeConfig, hash: `meme-cfg-${manifest.version}`, kind: 'json' });
        }
        if (manifest.levelConfig) {
            queue.push({ filename: manifest.levelConfig, hash: `level-cfg-${manifest.version}`, kind: 'json' });
        }
        if (manifest.modConfig) {
            queue.push({ filename: manifest.modConfig, hash: `mod-cfg-${manifest.version}`, kind: 'mod' });
        }
        this._downloadQueue(manifest, queue, 0, true, done);
    }

    private _downloadQueue(
        manifest: AssetManifest,
        queue: ManifestItem[],
        index: number,
        ok: boolean,
        done: (ok: boolean) => void,
    ): void {
        if (index >= queue.length) {
            done(ok);
            return;
        }
        const item = queue[index];
        const key = item.filename;
        if (this._hashes.hashes[key] === item.hash && this._isCached(item)) {
            this._ingestCached(item);
            this._downloadQueue(manifest, queue, index + 1, ok, done);
            return;
        }
        const url = this._resolve(manifest, item);
        const kind = item.kind ?? this._guessKind(item.filename);
        if (kind === 'texture') {
            this._fetchTexture(url, (frame) => {
                if (!frame) {
                    this._downloadQueue(manifest, queue, index + 1, false, done);
                    return;
                }
                this._frames.set(key, frame);
                this._hashes.hashes[key] = item.hash;
                this._downloadQueue(manifest, queue, index + 1, ok, done);
            });
            return;
        }
        if (kind === 'audio') {
            this._fetchAudio(url, (clip) => {
                if (!clip) {
                    this._downloadQueue(manifest, queue, index + 1, false, done);
                    return;
                }
                this._clips.set(key, clip);
                this._hashes.hashes[key] = item.hash;
                this._downloadQueue(manifest, queue, index + 1, ok, done);
            });
            return;
        }
        NetworkManager.HttpGet(url, (code, body) => {
            if (code !== 200 || !body) {
                console.warn('[AssetSync] 下載失敗:', key);
                this._downloadQueue(manifest, queue, index + 1, false, done);
                return;
            }
            if (!this._ingestJson(item, body)) {
                this._downloadQueue(manifest, queue, index + 1, false, done);
                return;
            }
            this._hashes.hashes[key] = item.hash;
            this._downloadQueue(manifest, queue, index + 1, ok, done);
        });
    }

    private _ingestJson(item: ManifestItem, body: string): boolean {
        try {
            const data = JSON.parse(body);
            const name = item.filename.toLowerCase();
            if (name.includes('meme') || Array.isArray((data as { memes?: unknown }).memes) || this._looksLikeMemeList(data)) {
                this._ingestMemePayload(data);
                StorageManager.writeTextFile(`${CACHE_DIR}/memes/_bundle_${this._safe(item.filename)}.json`, body);
                return true;
            }
            if (name.includes('level') || this._looksLikeLevel(data) || Array.isArray((data as { levels?: unknown }).levels)) {
                this._ingestLevelPayload(data);
                StorageManager.writeTextFile(`${CACHE_DIR}/levels/_bundle_${this._safe(item.filename)}.json`, body);
                return true;
            }
            // 單一 meme
            if ((data as MemeConfig).id && (data as MemeConfig).textures) {
                this._upsertMeme(data as MemeConfig);
                StorageManager.writeJsonFile(`${CACHE_DIR}/memes/${this._safe((data as MemeConfig).id)}.json`, data);
                return true;
            }
            if (this._looksLikeLevel(data)) {
                this._upsertLevel(data as LevelConfig);
                StorageManager.writeJsonFile(`${CACHE_DIR}/levels/${(data as LevelConfig).id}.json`, data);
                return true;
            }
            if (this._looksLikeMod(data) || name.includes('mod') || item.kind === 'mod') {
                this._upsertMod(data as ModConfig);
                StorageManager.writeTextFile(`${CACHE_DIR}/mods/_bundle_${this._safe(item.filename)}.json`, body);
                // CDN mod packs: pipelines only — never stamp Scratch over Ladder/campaign
                GameLogicInterpreter.getOrCreate().load(data as ModConfig, false);
                return true;
            }
            StorageManager.writeTextFile(`${CACHE_DIR}/${this._safe(item.filename)}`, body);
            return true;
        } catch (e) {
            console.warn('[AssetSync] JSON 解析失敗:', item.filename, e);
            return false;
        }
    }

    private _ingestMemePayload(data: unknown): void {
        const list = Array.isArray(data)
            ? data
            : Array.isArray((data as { memes?: unknown }).memes)
                ? (data as { memes: MemeConfig[] }).memes
                : null;
        if (!list) return;
        for (const raw of list) {
            if (raw && typeof (raw as MemeConfig).id === 'string') this._upsertMeme(raw as MemeConfig);
        }
    }

    private _ingestLevelPayload(data: unknown): void {
        if (this._looksLikeLevel(data)) {
            this._upsertLevel(data as LevelConfig);
            return;
        }
        const list = (data as { levels?: LevelConfig[] }).levels;
        if (!Array.isArray(list)) return;
        for (const raw of list) {
            if (this._looksLikeLevel(raw)) this._upsertLevel(raw);
        }
    }

    private _upsertMeme(cfg: MemeConfig): void {
        if (!cfg.textures) cfg.textures = {};
        this._memes.set(cfg.id, cfg);
    }

    private _upsertLevel(cfg: LevelConfig): void {
        if (typeof cfg.id !== 'number' || !Array.isArray(cfg.coins)) return;
        this._levels.set(cfg.id, cfg);
    }

    private _hydrateFromDisk(): void {
        // 目錄列舉在 Web localStorage 上不可靠；依已存 hash 鍵還原已知 bundle 名稱困難。
        // 啟動時仍以 sync() 為主；此處讀單一常見快取檔若存在。
        StorageManager.readJsonFile(`${CACHE_DIR}/memes/index.json`, (err, data) => {
            if (!err && data) this._ingestMemePayload(data);
        });
        StorageManager.readJsonFile(`${CACHE_DIR}/levels/index.json`, (err, data) => {
            if (!err && data) this._ingestLevelPayload(data);
        });
    }

    private _isCached(item: ManifestItem): boolean {
        const kind = item.kind ?? this._guessKind(item.filename);
        if (kind === 'texture') return this._frames.has(item.filename);
        if (kind === 'audio') return this._clips.has(item.filename);
        return StorageManager.isFileExist(`${CACHE_DIR}/memes/_bundle_${this._safe(item.filename)}.json`)
            || StorageManager.isFileExist(`${CACHE_DIR}/levels/_bundle_${this._safe(item.filename)}.json`)
            || StorageManager.isFileExist(`${CACHE_DIR}/${this._safe(item.filename)}`);
    }

    private _ingestCached(item: ManifestItem): void {
        const memePath = `${CACHE_DIR}/memes/_bundle_${this._safe(item.filename)}.json`;
        const levelPath = `${CACHE_DIR}/levels/_bundle_${this._safe(item.filename)}.json`;
        if (StorageManager.isFileExist(memePath)) {
            StorageManager.readJsonFile(memePath, (err, data) => {
                if (!err && data) this._ingestMemePayload(data);
            });
        }
        if (StorageManager.isFileExist(levelPath)) {
            StorageManager.readJsonFile(levelPath, (err, data) => {
                if (!err && data) this._ingestLevelPayload(data);
            });
        }
    }

    private _loadTextureSet(set: MemeTextureSet, done: (pack: TexturePack) => void): void {
        const keys: (keyof MemeTextureSet)[] = ['default', 'idle', 'aim', 'shot', 'hitted'];
        const pack: TexturePack = { default: null, idle: null, aim: null, shot: null, hitted: null };
        let left = 0;
        for (const key of keys) {
            if (set[key]) left++;
        }
        if (left === 0) {
            done(pack);
            return;
        }
        for (const key of keys) {
            const path = set[key];
            if (!path) continue;
            this._fetchTexture(path, (frame) => {
                pack[key] = frame;
                left--;
                if (left <= 0) done(pack);
            });
        }
    }

    private _loadOptionalClip(path: string | undefined, done: (clip: AudioClip | null) => void): void {
        if (!path) {
            done(null);
            return;
        }
        this._fetchAudio(path, done);
    }

    private _fetchTexture(urlOrPath: string, done: (frame: SpriteFrame | null) => void): void {
        const cached = this._frames.get(urlOrPath);
        if (cached) {
            done(cached);
            return;
        }
        // Absolute remote / Base64 → as-is.
        // CDN files (…/textures/meme_01.png) must join manifest base — preview already uses full URLs.
        // Local Resources presets stay bare stems like textures/coin_1 (no file extension).
        let ref = urlOrPath;
        const isRemote = /^https?:\/\//i.test(urlOrPath) || /^data:/i.test(urlOrPath);
        const looksLikeCdnFile = /\.(png|jpe?g|webp|gif)(\?|$)/i.test(urlOrPath);
        if (
            this.manifestUrl
            && !isRemote
            && !PRESET_COIN_SKINS[urlOrPath]
            && (looksLikeCdnFile || !urlOrPath.startsWith('textures/'))
        ) {
            ref = this._join(this.manifestUrl, urlOrPath);
        }
        DynamicAssetLoader.loadSprite(ref, (frame) => {
            if (frame) this._frames.set(urlOrPath, frame);
            else console.warn('[AssetSync] 貼圖失敗:', urlOrPath);
            done(frame);
        });
    }

    private _fetchAudio(urlOrPath: string, done: (clip: AudioClip | null) => void): void {
        const cached = this._clips.get(urlOrPath);
        if (cached) {
            done(cached);
            return;
        }
        const ref = /^https?:\/\//i.test(urlOrPath) || /^data:/i.test(urlOrPath)
            ? urlOrPath
            : (this.manifestUrl && urlOrPath.includes('.')
                ? this._join(this.manifestUrl, urlOrPath)
                : urlOrPath);
        DynamicAssetLoader.loadAudio(ref, (clip) => {
            if (clip) this._clips.set(urlOrPath, clip);
            done(clip);
        });
    }

    private _parseManifest(content: string): AssetManifest | null {
        try {
            const data = JSON.parse(content) as AssetManifest;
            if (typeof data.version !== 'number') return null;
            if (!Array.isArray(data.items)) data.items = [];
            data.items = data.items.filter(
                (item) => item && typeof item.filename === 'string' && typeof item.hash === 'string',
            );
            return data;
        } catch (e) {
            console.warn('[AssetSync] manifest 解析失敗', e);
            return null;
        }
    }

    private _resolve(manifest: AssetManifest, item: ManifestItem): string {
        if (item.url && /^https?:\/\//i.test(item.url)) return item.url;
        const path = item.url || item.filename;
        if (/^https?:\/\//i.test(path)) return path;
        const base = manifest.baseUrl || this.manifestUrl.replace(/\/[^/]*$/, '/');
        return base.replace(/\/?$/, '/') + path.replace(/^\//, '');
    }

    private _join(manifestUrl: string, path: string): string {
        if (/^https?:\/\//i.test(path)) return path;
        if (!manifestUrl) return path;
        const base = manifestUrl.replace(/\/[^/]*$/, '/');
        return base + path.replace(/^\//, '');
    }

    private _guessKind(filename: string): ManifestItem['kind'] {
        const lower = filename.toLowerCase();
        if (/\.(png|jpg|jpeg|webp)$/.test(lower)) return 'texture';
        if (/\.(wav|mp3|ogg)$/.test(lower)) return 'audio';
        if (lower.includes('meme')) return 'meme';
        if (lower.includes('level')) return 'level';
        if (lower.includes('mod')) return 'mod';
        return 'json';
    }

    private _looksLikeMod(data: unknown): boolean {
        const mod = data as ModConfig;
        return !!mod && mod.schemaVersion === 1 && Array.isArray(mod.pipelines) && !!mod.graph;
    }

    private _upsertMod(cfg: ModConfig): void {
        if (!this._looksLikeMod(cfg)) return;
        this._mods.set(cfg.id || 'default', cfg);
    }

    private _imageExt(url: string): string {
        if (/\.jpe?g(\?|$)/i.test(url)) return '.jpg';
        if (/\.webp(\?|$)/i.test(url)) return '.webp';
        return '.png';
    }

    private _audioExt(url: string): string {
        if (/\.mp3(\?|$)/i.test(url)) return '.mp3';
        if (/\.ogg(\?|$)/i.test(url)) return '.ogg';
        return '.wav';
    }

    private _looksLikeMemeList(data: unknown): boolean {
        return Array.isArray(data) && data.length > 0 && !!(data[0] as MemeConfig)?.textures;
    }

    private _looksLikeLevel(data: unknown): boolean {
        const level = data as LevelConfig;
        return !!level && typeof level.id === 'number' && Array.isArray(level.coins);
    }

    private _safe(name: string): string {
        return name.replace(/[^a-zA-Z0-9._-]/g, '_');
    }

    private _readHashes(): CachedHashMap {
        try {
            const raw = sys.localStorage.getItem(HASH_KEY);
            if (!raw) return { version: 0, hashes: {} };
            const parsed = JSON.parse(raw) as CachedHashMap;
            if (typeof parsed.version !== 'number' || !parsed.hashes) return { version: 0, hashes: {} };
            return parsed;
        } catch {
            return { version: 0, hashes: {} };
        }
    }

    private _writeHashes(): void {
        sys.localStorage.setItem(HASH_KEY, JSON.stringify(this._hashes));
    }

    private _finish(err: string | null, done?: (err: string | null) => void): void {
        this._running = false;
        if (err) console.warn('[AssetSync] 使用已快取內容:', err);
        else console.log('[AssetSync] sync ok, memes=', this._memes.size, 'levels=', this._levels.size);
        done?.(err);
    }
}
