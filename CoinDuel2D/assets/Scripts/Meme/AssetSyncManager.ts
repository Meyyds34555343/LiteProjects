import {
    _decorator,
    AudioClip,
    Component,
    Node,
    Prefab,
    Sprite,
    SpriteFrame,
} from 'cc';
import { NetworkManager } from '../NetworkManager';
import { StorageManager } from '../StorageManager';
import { CoinController } from '../CoinController';
import {
    AssetManifest,
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
import { DynamicAssetLoader, PRESET_COIN_SKINS, PRESET_SFX } from './DynamicAssetLoader';
import { TableController } from '../TableController';

const { ccclass, property } = _decorator;

/** 本地缓存索引（相对 serverdata/），记录已下载文件的 filename + hash + kind。 */
const CACHE_INDEX = 'asset-index.json';

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

interface CacheIndex {
    version: number;
    items: ManifestItem[];
}

/** 某個快取 JSON 檔載入過的內容 id，用於刪檔時同步清理記憶體。 */
interface FileEntries {
    memes: string[];
    levels: number[];
    mods: string[];
}

/**
 * 資產熱更新與本地快取（專案唯一的遠端資產更新器）。
 *
 * 流程：拉 manifest.json → 逐項比對本地索引 hash → 只下載變更項 →
 * JSON 寫入 serverdata/、貼圖音效寫入 IndexedDB（原生為檔案）→
 * 移除伺服器已下架的本機檔案。
 *
 * 啟動時先從 serverdata/asset-index.json 還原快取，離線也能使用上次內容。
 */
@ccclass('AssetSyncManager')
export class AssetSyncManager extends Component {
    public static instance: AssetSyncManager | null = null;

    /**
     * 除錯開關：true 時打印 manifest 比對、下載、快取與清理的完整過程。
     * 發佈前可改為 false，或於 Console 執行 `AssetSyncManager.verbose = false`。
     */
    public static verbose = true;

    /** 遠端 manifest URL。空字串＝只吃本地快取，不上網。 */
    @property
    public manifestUrl = '';

    private _running = false;
    private _ready = false;
    private _readyCallbacks: (() => void)[] = [];

    private _memes = new Map<string, MemeConfig>();
    private _levels = new Map<number, LevelConfig>();
    private _mods = new Map<string, ModConfig>();
    private _frames = new Map<string, SpriteFrame>();
    private _clips = new Map<string, AudioClip>();

    /** 已落盤的項目（key = 相對 filename）。 */
    private _cacheItems = new Map<string, ManifestItem>();
    /** 已落盤的貼圖 / 音效 filename。 */
    private _cachedBinary = new Set<string>();
    /** 已解析並載入記憶體的 JSON filename。 */
    private _ingested = new Set<string>();
    /** JSON filename → 該檔載入過的 meme / level / mod id。 */
    private _fileEntries = new Map<string, FileEntries>();
    /** meme 資料尚未載入時，暫存等待套用外觀的硬幣。 */
    private _pendingMemeCoins: { node: Node; memeId: string; done?: () => void }[] = [];
    private _cacheVersion = 0;

    protected onLoad(): void {
        AssetSyncManager.instance = this;
        StorageManager.createDir(StorageManager.getCacheRoot());
        this._log('onLoad: cache root =', StorageManager.getCacheRoot());
        this._hydrateFromDisk(() => {
            this._ready = true;
            const callbacks = this._readyCallbacks;
            this._readyCallbacks = [];
            for (const cb of callbacks) cb();
        });
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

    /** 某個關卡檔載入的第一個 LevelConfig.id；找不到時回傳 null。 */
    public getLevelIdForFile(filename: string): number | null {
        // levels.json 用的是 `1.json`，資產庫索引用的是 `levels/1.json`，兩者都接受
        const normalized = filename.indexOf('levels/') === 0
            ? filename
            : 'levels/' + filename.replace(/^\/+/, '');
        for (const key of [filename, normalized]) {
            const entries = this._fileEntries.get(key);
            if (entries && entries.levels.length > 0) return entries.levels[0];
        }
        return null;
    }

    /** 等本地快取還原完成後再讀取資料。 */
    public whenReady(cb: () => void): void {
        this._whenReady(cb);
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
     * Manifest → 比 hash → 增量下載 Meme / Level / Mod / 貼圖 / 音效。
     * @param done 完成回調；err 為 null / 'network' / 'manifest' / 'download' / 'busy'
     * @param progress 進度回調（已處理項數 / 總項數）
     */
    public sync(
        done?: (err: string | null) => void,
        progress?: (completed: number, total: number) => void,
    ): void {
        this._whenReady(() => {
            if (!this.manifestUrl) {
                this._log('sync skipped: manifestUrl is empty (offline cache only)');
                done?.(null);
                return;
            }
            if (this._running) {
                this._log('sync skipped: another sync is already running');
                done?.('busy');
                return;
            }
            this._running = true;
            this._log('sync start:', this.manifestUrl);
            NetworkManager.HttpGet(this.manifestUrl, (code, body) => {
                if (code !== 200 || !body) {
                    console.warn('[AssetSync] manifest 請求失敗:', code, this.manifestUrl);
                    this._finish('network', done);
                    return;
                }
                const manifest = this._parseManifest(body);
                if (!manifest) {
                    this._finish('manifest', done);
                    return;
                }
                this._log(`manifest v${manifest.version}: ${manifest.items.length} item(s)`);
                this._syncManifest(manifest, (ok) => {
                    this._finish(ok ? null : 'download', done);
                }, progress);
            });
        });
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
        const memeId = cfg.memeId != null ? String(cfg.memeId) : '';
        const meme = memeId ? this._memes.get(memeId) : null;
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
        if (memeId) this.applyMemeToCoin(node, memeId);
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
        this._loadTextureSet(refs, (pack) => {
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
            this._fetchAudio(skin.shotSfx ?? '', (shot) => {
                this._fetchAudio(skin.hittedSfx ?? '', (hit) => {
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
            this._fetchTexture(cfg.felt, (frame) => {
                table.applyFeltSkin(frame, cfg.tint);
                tick();
            });
        }
        if (cfg.wall) {
            pending++;
            this._fetchTexture(cfg.wall, (frame) => {
                table.applyWallSkin(frame);
                tick();
            });
        }
        if (pending === 0) done?.();
    }

    /** 公開：依 URL / 相對路徑 / Base64 / preset 取 SpriteFrame。 */
    public loadSpriteHot(ref: string, done: (frame: SpriteFrame | null) => void): void {
        this._fetchTexture(ref, done);
    }

    /** 公開：依 URL / 相對路徑 / Base64 / preset 取 AudioClip。 */
    public loadAudioHot(ref: string, done: (clip: AudioClip | null) => void): void {
        this._fetchAudio(ref, done);
    }

    /**
     * 把 Meme 的 default/idle/aim/shot/hitted 套到 CoinController，
     * 之後 showIdle / showAim / showShot / showHit 會自動換圖。
     */
    public applyMemeToCoin(coin: Node, memeId: string, done?: () => void): void {
        const ctrl = coin.getComponent(CoinController);
        if (!ctrl) {
            done?.();
            return;
        }
        const meme = this._memes.get(memeId);
        if (!meme) {
            // meme 可能還沒同步完成；先排隊，資產載入後再套用
            if (coin.isValid) {
                const existing = this._pendingMemeCoins.find(
                    (item) => item.node === coin && item.memeId === memeId,
                );
                if (existing) {
                    if (done) existing.done = done;
                } else {
                    this._pendingMemeCoins.push({ node: coin, memeId, done });
                }
                this._log('[meme:pending]', memeId, '(not loaded yet)');
            } else {
                done?.();
            }
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
            this._fetchAudioOptional(meme.shotSfx ?? '', (shot) => {
                this._fetchAudioOptional(meme.hittedSfx ?? '', (hit) => {
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

    private _whenReady(cb: () => void): void {
        if (this._ready) {
            cb();
            return;
        }
        this._readyCallbacks.push(cb);
    }

    private _syncManifest(
        manifest: AssetManifest,
        done: (ok: boolean) => void,
        progress?: (completed: number, total: number) => void,
    ): void {
        const items = manifest.items.slice();
        const oldItems = new Map(this._cacheItems);
        const nextItems: ManifestItem[] = [];
        const total = items.length;
        let completed = 0;

        this._log('compare: manifest =', total, ', local cache =', oldItems.size);

        const report = () => progress?.(completed, total);
        report();

        const step = (index: number, ok: boolean) => {
            if (index >= items.length) {
                const keep = new Set<string>();
                for (const item of items) keep.add(item.filename);

                // 先移除索引中已知、但 manifest 已不存在的項目
                let removed = 0;
                for (const name of Array.from(oldItems.keys())) {
                    if (!keep.has(name)) {
                        this._deleteCached(name);
                        removed++;
                    }
                }

                this._cacheItems = new Map();
                for (const item of nextItems) this._cacheItems.set(item.filename, item);
                this._cacheVersion = manifest.version;

                // 再掃描本地快取（IndexedDB / localStorage / 原生檔案），清掉索引外的孤兒條目
                this._reconcileCache(keep, (extraRemoved) => {
                    removed += extraRemoved;
                    this._writeCacheIndex();
                    this._log(
                        `compare done: ${completed}/${total} processed,`,
                        'removed=' + removed + ',',
                        'cache=' + this._cacheItems.size,
                    );
                    done(ok);
                });
                return;
            }

            const item = items[index];
            if (this._hashMatches(item) && this._isCached(item)) {
                this._log('[skip]', item.filename, 'hash=' + item.hash, '(unchanged)');
                nextItems.push(item);
                this._ingestCached(item, () => {
                    completed++;
                    report();
                    step(index + 1, ok);
                });
                return;
            }

            const cached = this._cacheItems.get(item.filename);
            const reason = !cached ? 'new' : (!item.hash ? 'no-hash' : 'changed');
            this._log(
                `[download:${reason}]`,
                item.filename,
                'kind=' + (item.kind ?? this._guessKind(item.filename)),
                'hash=' + item.hash,
            );
            this._downloadItem(manifest, item, (success) => {
                if (success) {
                    this._log('[ok]', item.filename);
                    nextItems.push(item);
                } else {
                    // 下載失敗時保留舊快取，離線仍可玩；下次啟動會再試
                    console.warn('[AssetSync] 下載失敗，保留舊快取:', item.filename);
                    const old = oldItems.get(item.filename);
                    if (old) nextItems.push(old);
                }
                completed++;
                report();
                step(index + 1, ok && success);
            });
        };

        step(0, true);
    }

    private _downloadItem(
        manifest: AssetManifest,
        item: ManifestItem,
        done: (ok: boolean) => void,
    ): void {
        const url = this._resolve(manifest, item);
        const kind = item.kind ?? this._guessKind(item.filename);
        this._log('[url]', item.filename, '→', url);
        if (kind === 'texture' || kind === 'audio') {
            this._downloadBinary(url, item, kind, done);
            return;
        }
        NetworkManager.HttpGet(url, (code, body) => {
            if (code !== 200 || !body) {
                console.warn('[AssetSync] 下載失敗:', item.filename, code);
                done(false);
                return;
            }
            done(this._ingestJson(item, body));
        });
    }

    private _downloadBinary(
        url: string,
        item: ManifestItem,
        kind: 'texture' | 'audio',
        done: (ok: boolean) => void,
    ): void {
        NetworkManager.HttpGetBinary(url, (code, bytes) => {
            if (code !== 200 || !bytes) {
                console.warn('[AssetSync] 下載失敗:', item.filename, code);
                done(false);
                return;
            }
            const cachePath = this._cachePath(item.filename);
            this._log('[bytes]', item.filename, bytes.byteLength + 'B →', cachePath);
            StorageManager.writeBinaryFile(cachePath, bytes, (saved) => {
                if (!saved) {
                    console.warn('[AssetSync] 寫入快取失敗:', item.filename);
                    done(false);
                    return;
                }
                this._cachedBinary.add(item.filename);
                const ext = kind === 'texture'
                    ? this._imageExt(url || item.filename)
                    : this._audioExt(url || item.filename);
                const finish = (asset: SpriteFrame | AudioClip | null) => {
                    if (!asset) {
                        done(false);
                        return;
                    }
                    if (kind === 'texture') this._frames.set(item.filename, asset as SpriteFrame);
                    else this._clips.set(item.filename, asset as AudioClip);
                    done(true);
                };
                if (kind === 'texture') {
                    DynamicAssetLoader.loadSpriteFromBytes(cachePath, bytes, ext, finish);
                } else {
                    DynamicAssetLoader.loadAudioFromBytes(cachePath, bytes, ext, finish);
                }
            });
        });
    }

    private _ingestJson(item: ManifestItem, body: string): boolean {
        let data: unknown;
        try {
            data = JSON.parse(body);
        } catch (e) {
            console.warn('[AssetSync] JSON 解析失敗:', item.filename, e);
            return false;
        }
        const cachePath = this._cachePath(item.filename);
        StorageManager.ensureDirFor(cachePath);
        if (!StorageManager.writeTextFile(cachePath, body)) {
            console.warn('[AssetSync] 寫入失敗:', item.filename);
            return false;
        }
        const entries = this._ingestPayload(item, data);
        this._recordFileEntries(item.filename, entries);
        this._ingested.add(item.filename);
        this._log('[ingest]', item.filename, body.length + 'B');
        return true;
    }

    private _ingestPayload(item: ManifestItem, data: unknown): FileEntries {
        const kind = item.kind ?? this._guessKind(item.filename);
        if (kind === 'meme') {
            return { memes: this._ingestMemePayload(data), levels: [], mods: [] };
        }
        if (kind === 'level') {
            return { memes: [], levels: this._ingestLevelPayload(data), mods: [] };
        }
        if (kind === 'mod' || this._looksLikeMod(data)) {
            const id = this._ingestMod(data);
            return { memes: [], levels: [], mods: id ? [id] : [] };
        }
        // kind === 'json'：依內容嗅探（例如 levels.json / config.json / memes.json）
        if (this._looksLikeMemePayload(data)) {
            return { memes: this._ingestMemePayload(data), levels: [], mods: [] };
        }
        if (this._looksLikeLevelPayload(data)) {
            return { memes: [], levels: this._ingestLevelPayload(data), mods: [] };
        }
        if (this._looksLikeMod(data)) {
            const id = this._ingestMod(data);
            return { memes: [], levels: [], mods: id ? [id] : [] };
        }
        return { memes: [], levels: [], mods: [] };
    }

    private _ingestCached(item: ManifestItem, done: () => void): void {
        if (this._ingested.has(item.filename)) {
            done();
            return;
        }
        const kind = item.kind ?? this._guessKind(item.filename);
        if (kind === 'texture' || kind === 'audio') {
            done();
            return;
        }
        StorageManager.readJsonFile(this._cachePath(item.filename), (err, data) => {
            if (!err && data) {
                const entries = this._ingestPayload(item, data);
                this._recordFileEntries(item.filename, entries);
                this._ingested.add(item.filename);
                this._log('[restore]', item.filename);
            } else {
                this._log('[restore:miss]', item.filename, err ?? 'empty');
            }
            done();
        });
    }

    private _ingestMemePayload(data: unknown): string[] {
        const ids: string[] = [];
        const add = (raw: unknown) => {
            if (raw && typeof (raw as MemeConfig).id === 'string') {
                const cfg = raw as MemeConfig;
                this._upsertMeme(cfg);
                ids.push(cfg.id);
            }
        };
        if (Array.isArray(data)) {
            for (const raw of data) add(raw);
            return ids;
        }
        const list = (data as { memes?: unknown } | null)?.memes;
        if (Array.isArray(list)) {
            for (const raw of list) add(raw);
            return ids;
        }
        const single = data as MemeConfig | null;
        if (single && typeof single.id === 'string' && single.textures) add(single);
        return ids;
    }

    private _ingestLevelPayload(data: unknown): number[] {
        const ids: number[] = [];
        const add = (raw: unknown) => {
            if (this._looksLikeLevel(raw)) {
                const level = raw as LevelConfig;
                if (this._upsertLevel(level)) ids.push(level.id);
            }
        };
        if (this._looksLikeLevel(data)) {
            add(data);
            return ids;
        }
        if (Array.isArray(data)) {
            for (const raw of data) add(raw);
            return ids;
        }
        const list = (data as { levels?: unknown } | null)?.levels;
        if (Array.isArray(list)) {
            for (const raw of list) add(raw);
        }
        return ids;
    }

    private _ingestMod(data: unknown): string | null {
        if (!this._looksLikeMod(data)) return null;
        const cfg = data as ModConfig;
        const id = cfg.id || 'default';
        this._mods.set(id, cfg);
        GameLogicInterpreter.getOrCreate().load(cfg);
        return id;
    }

    private _upsertMeme(cfg: MemeConfig): void {
        if (!cfg.textures) cfg.textures = {};
        this._memes.set(cfg.id, cfg);
    }

    private _upsertLevel(cfg: LevelConfig): boolean {
        if (typeof cfg.id !== 'number' || !Array.isArray(cfg.coins)) return false;
        this._levels.set(cfg.id, cfg);
        return true;
    }

    /** 記錄某個 JSON 檔載入過的 id；同一檔案更新時合併，刪檔時才能完整清理。 */
    private _recordFileEntries(filename: string, entries: FileEntries): void {
        const prev = this._fileEntries.get(filename);
        if (!prev) {
            this._fileEntries.set(filename, entries);
            return;
        }
        this._fileEntries.set(filename, {
            memes: Array.from(new Set(prev.memes.concat(entries.memes))),
            levels: Array.from(new Set(prev.levels.concat(entries.levels))),
            mods: Array.from(new Set(prev.mods.concat(entries.mods))),
        });
    }

    /** 從記憶體移除某檔案載入過的 meme / level / mod。 */
    private _purgeFileEntries(filename: string): void {
        const entries = this._fileEntries.get(filename);
        if (!entries) return;
        for (const id of entries.memes) this._memes.delete(id);
        for (const id of entries.levels) this._levels.delete(id);
        for (const id of entries.mods) {
            this._mods.delete(id);
            const interp = GameLogicInterpreter.getOrCreate();
            if (interp.mod && (interp.mod.id || 'default') === id) interp.clear();
        }
        this._fileEntries.delete(filename);
    }

    /**
     * 從 serverdata/asset-index.json 還原快取；JSON 立即載入記憶體，
     * 貼圖 / 音效按需從 IndexedDB（原生為檔案）讀取。
     */
    private _hydrateFromDisk(done: () => void): void {
        StorageManager.readJsonFile(this._cachePath(CACHE_INDEX), (err, data) => {
            const index = (!err && data) ? data as unknown as CacheIndex : null;
            const items = index && Array.isArray(index.items) ? index.items : [];
            this._cacheVersion = index && typeof index.version === 'number' ? index.version : 0;
            this._cacheItems.clear();
            this._cachedBinary.clear();
            this._ingested.clear();
            this._fileEntries.clear();
            this._log(
                'hydrate: index =',
                index ? `${items.length} item(s), v${this._cacheVersion}` : 'none',
            );

            const toIngest: ManifestItem[] = [];
            for (const raw of items) {
                const item = this._normalizeItem(raw);
                if (!item) continue;
                this._cacheItems.set(item.filename, item);
                const kind = item.kind ?? this._guessKind(item.filename);
                if (kind === 'texture' || kind === 'audio') {
                    this._cachedBinary.add(item.filename);
                    continue;
                }
                toIngest.push(item);
            }

            this._log(
                'hydrate: json =', toIngest.length,
                ', binary =', this._cachedBinary.size,
            );

            // pending 必須先設好，避免同步回調在第一項就提前完成
            let pending = toIngest.length;
            if (pending === 0) {
                this._log('hydrate done (nothing to restore)');
                done();
                return;
            }
            const tick = () => {
                pending--;
                if (pending <= 0) {
                    this._log(
                        'hydrate done: memes=' + this._memes.size,
                        'levels=' + this._levels.size,
                        'mods=' + this._mods.size,
                    );
                    done();
                }
            };
            for (const item of toIngest) {
                this._ingestCached(item, tick);
            }
        });
    }

    private _deleteCached(filename: string, extra = false): void {
        this._purgeFileEntries(filename);
        this._cacheItems.delete(filename);
        this._cachedBinary.delete(filename);
        this._ingested.delete(filename);
        StorageManager.deleteFile(this._cachePath(filename));
        this._log(extra ? '[remove:extra]' : '[remove]', filename, '(not in manifest)');
    }

    /**
     * 掃描本地快取（IndexedDB 二進位、localStorage JSON、原生 serverdata/），
     * 刪除 manifest 中已不存在的條目，包含索引外的孤兒資料。
     */
    private _reconcileCache(keep: Set<string>, done: (removed: number) => void): void {
        StorageManager.listCacheFiles((files) => {
            this._log('reconcile: local files =', files.length, ', manifest keep =', keep.size);
            let removed = 0;
            for (const raw of files) {
                const name = raw.replace(/\\/g, '/').replace(/^\/+/, '');
                if (!name || name === CACHE_INDEX) continue;
                if (keep.has(name)) continue;

                this._deleteCached(name, true);
                removed++;
            }
            done(removed);
        });
    }

    private _writeCacheIndex(): void {
        const path = this._cachePath(CACHE_INDEX);
        StorageManager.ensureDirFor(path);
        const index: CacheIndex = {
            version: this._cacheVersion,
            items: Array.from(this._cacheItems.values()),
        };
        if (!StorageManager.writeJsonFile(path, index)) {
            console.warn('[AssetSync] 快取索引寫入失敗:', path);
        } else {
            this._log('[index] saved', index.items.length, 'item(s), v' + index.version + ' →', path);
        }
    }

    private _hashMatches(item: ManifestItem): boolean {
        const cached = this._cacheItems.get(item.filename);
        return !!cached && !!item.hash && cached.hash === item.hash;
    }

    private _isCached(item: ManifestItem): boolean {
        const kind = item.kind ?? this._guessKind(item.filename);
        if (kind === 'texture' || kind === 'audio') return this._cachedBinary.has(item.filename);
        return StorageManager.isFileExist(this._cachePath(item.filename));
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

    private _fetchAudioOptional(path: string, done: (clip: AudioClip | null) => void): void {
        if (!path) {
            done(null);
            return;
        }
        this._fetchAudio(path, done);
    }

    /** 先查記憶體 → 本地二進位快取 → 遠端 / Resources / Base64。 */
    private _fetchTexture(urlOrPath: string, done: (frame: SpriteFrame | null) => void): void {
        const cached = this._frames.get(urlOrPath);
        if (cached) {
            done(cached);
            return;
        }

        const rel = this._cacheRel(urlOrPath);
        if (!rel) {
            this._fetchTextureRemote(urlOrPath, done);
            return;
        }

        const cachePath = this._cachePath(rel);
        StorageManager.readBinaryFile(cachePath, (err, bytes) => {
            if (err || !bytes) {
                this._fetchTextureRemote(urlOrPath, done);
                return;
            }
            DynamicAssetLoader.loadSpriteFromBytes(
                cachePath,
                bytes,
                this._imageExt(rel),
                (frame) => {
                    if (!frame) {
                        this._fetchTextureRemote(urlOrPath, done);
                        return;
                    }
                    this._frames.set(urlOrPath, frame);
                    this._frames.set(rel, frame);
                    done(frame);
                },
            );
        });
    }

    private _fetchTextureRemote(urlOrPath: string, done: (frame: SpriteFrame | null) => void): void {
        const ref = this._remoteRef(urlOrPath);
        DynamicAssetLoader.loadSprite(ref, (frame) => {
            if (frame) {
                this._frames.set(urlOrPath, frame);
                if (ref !== urlOrPath) this._frames.set(ref, frame);
            } else {
                console.warn('[AssetSync] 貼圖失敗:', urlOrPath);
            }
            done(frame);
        });
    }

    /** 先查記憶體 → 本地二進位快取 → 遠端 / Resources / Base64 / preset。 */
    private _fetchAudio(urlOrPath: string, done: (clip: AudioClip | null) => void): void {
        if (!urlOrPath) {
            done(null);
            return;
        }
        const cached = this._clips.get(urlOrPath);
        if (cached) {
            done(cached);
            return;
        }

        const rel = this._cacheRel(urlOrPath);
        if (!rel) {
            this._fetchAudioRemote(urlOrPath, done);
            return;
        }

        const cachePath = this._cachePath(rel);
        StorageManager.readBinaryFile(cachePath, (err, bytes) => {
            if (err || !bytes) {
                this._fetchAudioRemote(urlOrPath, done);
                return;
            }
            DynamicAssetLoader.loadAudioFromBytes(
                cachePath,
                bytes,
                this._audioExt(rel),
                (clip) => {
                    if (!clip) {
                        this._fetchAudioRemote(urlOrPath, done);
                        return;
                    }
                    this._clips.set(urlOrPath, clip);
                    this._clips.set(rel, clip);
                    done(clip);
                },
            );
        });
    }

    private _fetchAudioRemote(urlOrPath: string, done: (clip: AudioClip | null) => void): void {
        const ref = this._remoteRef(urlOrPath);
        DynamicAssetLoader.loadAudio(ref, (clip) => {
            if (clip) {
                this._clips.set(urlOrPath, clip);
                if (ref !== urlOrPath) this._clips.set(ref, clip);
            }
            done(clip);
        });
    }

    private _parseManifest(content: string): AssetManifest | null {
        let data: unknown;
        try {
            data = JSON.parse(content);
        } catch (e) {
            console.warn('[AssetSync] manifest 解析失敗', e);
            return null;
        }
        if (!data || typeof data !== 'object') return null;

        const raw = data as {
            version?: unknown;
            baseUrl?: unknown;
            items?: unknown;
            memeConfig?: unknown;
            levelConfig?: unknown;
            modConfig?: unknown;
        };
        const version = typeof raw.version === 'number' ? raw.version : 0;
        const items: ManifestItem[] = [];
        const seen = new Set<string>();

        const push = (candidate: unknown) => {
            const item = this._normalizeItem(candidate);
            if (!item || seen.has(item.filename)) return;
            seen.add(item.filename);
            items.push(item);
        };

        if (Array.isArray(raw.items)) {
            for (const candidate of raw.items) push(candidate);
        }

        // 兼容舊清單欄位：僅在 items 未列出同名檔案時補入
        const aliases: [string, ManifestItem['kind']][] = [
            ['memeConfig', 'meme'],
            ['levelConfig', 'level'],
            ['modConfig', 'mod'],
        ];
        for (const [field, kind] of aliases) {
            const file = raw[field as 'memeConfig' | 'levelConfig' | 'modConfig'];
            if (typeof file !== 'string' || !file.trim()) continue;
            push({ filename: file, hash: `${field}-${version}`, kind });
        }

        return {
            version,
            baseUrl: typeof raw.baseUrl === 'string' ? raw.baseUrl : undefined,
            items,
        };
    }

    private _normalizeItem(raw: unknown): ManifestItem | null {
        if (!raw || typeof raw !== 'object') return null;
        const value = raw as {
            filename?: unknown;
            hash?: unknown;
            kind?: unknown;
            url?: unknown;
        };
        if (typeof value.filename !== 'string') return null;
        const filename = value.filename.replace(/\\/g, '/').replace(/^\.?\//, '');
        if (!filename || filename.indexOf('..') >= 0 || filename === CACHE_INDEX) return null;

        const allowed: ManifestItem['kind'][] = ['meme', 'level', 'texture', 'audio', 'json', 'mod'];
        const kind = typeof value.kind === 'string'
            && allowed.indexOf(value.kind as ManifestItem['kind']) >= 0
            ? value.kind as ManifestItem['kind']
            : this._guessKind(filename);

        return {
            filename,
            hash: value.hash == null ? '' : String(value.hash),
            kind,
            url: typeof value.url === 'string' ? value.url : undefined,
        };
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

    /** 相對檔名 → 本地快取相對路徑；URL / Base64 / preset 不落盤。 */
    private _cacheRel(ref: string): string | null {
        if (!ref) return null;
        if (/^https?:\/\//i.test(ref) || /^data:/i.test(ref)) return null;
        if (PRESET_COIN_SKINS[ref] || PRESET_SFX[ref]) return null;
        const rel = ref.replace(/\\/g, '/').replace(/^\.?\//, '');
        if (!rel || rel.indexOf('..') >= 0) return null;
        return rel;
    }

    /** 遠端加載時把「帶副檔名的相對路徑」拼到 manifest 目錄。 */
    private _remoteRef(ref: string): string {
        if (!ref) return ref;
        if (/^https?:\/\//i.test(ref) || /^data:/i.test(ref)) return ref;
        if (PRESET_COIN_SKINS[ref] || PRESET_SFX[ref]) return ref;
        if (this.manifestUrl && this._looksLikeFile(ref)) {
            return this._join(this.manifestUrl, ref);
        }
        return ref;
    }

    private _looksLikeFile(ref: string): boolean {
        const path = ref.split('?')[0].split('#')[0];
        return /\.(png|jpe?g|webp|gif|wav|mp3|ogg)$/i.test(path);
    }

    private _guessKind(filename: string): ManifestItem['kind'] {
        const lower = filename.toLowerCase();
        if (/\.(png|jpg|jpeg|webp|gif)$/.test(lower)) return 'texture';
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

    private _looksLikeMemePayload(data: unknown): boolean {
        if (Array.isArray(data)) {
            return data.length > 0 && !!(data[0] as MemeConfig)?.textures;
        }
        const list = (data as { memes?: unknown } | null)?.memes;
        if (Array.isArray(list)) return true;
        const single = data as MemeConfig | null;
        return !!single && typeof single.id === 'string' && !!single.textures;
    }

    private _looksLikeLevelPayload(data: unknown): boolean {
        return this._looksLikeLevel(data)
            || Array.isArray((data as { levels?: unknown } | null)?.levels);
    }

    private _looksLikeLevel(data: unknown): boolean {
        const level = data as LevelConfig;
        return !!level && typeof level.id === 'number' && Array.isArray(level.coins);
    }

    private _cachePath(rel: string): string {
        return StorageManager.getCachePath(rel);
    }

    private _imageExt(url: string): string {
        if (/\.jpe?g(\?|$)/i.test(url)) return '.jpg';
        if (/\.webp(\?|$)/i.test(url)) return '.webp';
        if (/\.gif(\?|$)/i.test(url)) return '.gif';
        return '.png';
    }

    private _audioExt(url: string): string {
        if (/\.mp3(\?|$)/i.test(url)) return '.mp3';
        if (/\.ogg(\?|$)/i.test(url)) return '.ogg';
        return '.wav';
    }

    /** meme 資料載入後，補套用先前排隊的硬幣外觀。 */
    private _flushPendingMemes(): void {
        if (this._pendingMemeCoins.length === 0) return;
        const pending = this._pendingMemeCoins;
        this._pendingMemeCoins = [];
        this._log('[meme] flush pending =', pending.length);
        for (const item of pending) {
            if (!item.node || !item.node.isValid) continue;
            if (!this._memes.has(item.memeId)) {
                this._log('[meme:missing]', item.memeId, '(not in manifest)');
                item.done?.();
                continue;
            }
            this.applyMemeToCoin(item.node, item.memeId, item.done);
        }
    }

    /** 除錯輸出，由 `AssetSyncManager.verbose` 開關控制。 */
    private _log(...args: unknown[]): void {
        if (AssetSyncManager.verbose) console.log('[AssetSync]', ...args);
    }

    private _finish(err: string | null, done?: (err: string | null) => void): void {
        this._running = false;
        this._flushPendingMemes();
        if (err) {
            console.warn('[AssetSync] 使用已快取內容:', err);
        } else {
            this._log(
                'sync done: memes=' + this._memes.size,
                'levels=' + this._levels.size,
                'mods=' + this._mods.size,
                'frames=' + this._frames.size,
                'clips=' + this._clips.size,
            );
        }
        done?.(err);
    }
}
