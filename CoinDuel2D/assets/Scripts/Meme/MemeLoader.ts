import { ImageAsset, SpriteFrame, Texture2D, sys } from 'cc';
import { NetworkManager } from '../NetworkManager';
import { StorageManager } from '../StorageManager';

const VERSION_KEY = 'MemeLoader:version';
const INDEX_PATH = 'memes/index.json';

interface ManifestProp {
    id: string;
    hash: string;
    image: string;
    config: string;
}

interface Manifest {
    version: number;
    props: ManifestProp[];
}

interface MemeFile {
    id: string;
    hash: string;
    behavior?: string;
    radius?: number;
    imageBase64?: string;
}

interface MemeIndex {
    props: { id: string; hash: string }[];
}

/** 已經下載、可以拿來生成硬幣的 Meme。 */
export interface LoadedMeme {
    id: string;
    hash: string;
    behavior: string;
    radius: number;
    imageBase64: string;
}

/**
 * 從遠端 manifest 下載 Meme 圖片與設定，並依 hash 做快取。
 * manifestUrl 留空時不連線，只使用上次存下來的資料。
 */
export class MemeLoader {
    public static manifestUrl = '';

    private static _memes: LoadedMeme[] = [];
    private static _frames = new Map<string, SpriteFrame>();
    private static _cacheReady = false;
    private static _running = false;

    public static getLoadedMemes(): LoadedMeme[] {
        return this._memes.slice();
    }

    /** 先讀本地快取，再視版本決定要不要下載。失敗時保留舊資料。 */
    public static checkAndDownload(done?: (err: string | null) => void): void {
        this.loadCache(() => {
            if (!this.manifestUrl) {
                done?.(null);
                return;
            }
            if (this._running) {
                done?.('busy');
                return;
            }
            this._running = true;
            NetworkManager.HttpGet(this.manifestUrl, (code, content) => {
                if (code !== 200 || !content) {
                    this._finish('network', done);
                    return;
                }
                const manifest = this._parseManifest(content);
                if (!manifest) {
                    this._finish('manifest', done);
                    return;
                }
                const localVersion = this._readVersion();
                if (!(manifest.version > localVersion)) {
                    this._finish(null, done);
                    return;
                }
                this._downloadChanged(manifest, 0, true, (ok) => {
                    if (ok) this._writeVersion(manifest.version);
                    this._finish(ok ? null : 'download', done);
                });
            });
        });
    }

    public static loadCache(done?: () => void): void {
        if (this._cacheReady) {
            done?.();
            return;
        }
        StorageManager.readJsonFile(INDEX_PATH, (err, data) => {
            const index = this._asIndex(err ? null : data);
            this._memes = [];
            this._readCached(index.props, 0, () => {
                this._cacheReady = true;
                done?.();
            });
        });
    }

    /** 把已下載的圖做成 SpriteFrame。失敗時回傳 null，呼叫端沿用預設硬幣圖。 */
    public static applySprite(id: string, cb: (frame: SpriteFrame | null) => void): void {
        const cached = this._frames.get(id);
        if (cached) {
            cb(cached);
            return;
        }
        const meme = this._memes.find((item) => item.id === id);
        const ImageCtor = (globalThis as { Image?: new () => HTMLImageElement }).Image;
        if (!meme?.imageBase64 || !ImageCtor) {
            cb(null);
            return;
        }
        const img = new ImageCtor();
        img.onload = () => {
            try {
                const asset = new ImageAsset(img);
                const tex = new Texture2D();
                tex.image = asset;
                const frame = new SpriteFrame();
                frame.texture = tex;
                frame.packable = false;
                this._frames.set(id, frame);
                cb(frame);
            } catch (e) {
                console.warn('[Meme] 圖片解碼失敗:', id, e);
                cb(null);
            }
        };
        img.onerror = () => {
            console.warn('[Meme] 圖片無法顯示:', id);
            cb(null);
        };
        const raw = meme.imageBase64.trim();
        img.src = raw.startsWith('data:') ? raw : `data:image/png;base64,${raw}`;
    }

    private static _downloadChanged(
        manifest: Manifest,
        index: number,
        ok: boolean,
        done: (ok: boolean) => void,
    ): void {
        if (index >= manifest.props.length) {
            done(ok);
            return;
        }
        const prop = manifest.props[index];
        const current = this._memes.find((item) => item.id === prop.id);
        if (current && current.hash === prop.hash) {
            this._downloadChanged(manifest, index + 1, ok, done);
            return;
        }
        this._fetchProp(prop, (file) => {
            if (!file) {
                console.warn('[Meme] 下載失敗:', prop.id);
                this._downloadChanged(manifest, index + 1, false, done);
                return;
            }
            const saved = this._saveProp(file);
            if (!saved) {
                this._downloadChanged(manifest, index + 1, false, done);
                return;
            }
            this._upsert(saved);
            this._downloadChanged(manifest, index + 1, ok, done);
        });
    }

    private static _fetchProp(prop: ManifestProp, done: (file: MemeFile | null) => void): void {
        NetworkManager.HttpGet(this._resolve(prop.image), (imageCode, imageBody) => {
            if (imageCode !== 200 || !imageBody) {
                done(null);
                return;
            }
            NetworkManager.HttpGet(this._resolve(prop.config), (configCode, configBody) => {
                if (configCode !== 200 || !configBody) {
                    done(null);
                    return;
                }
                try {
                    const config = JSON.parse(configBody) as { behavior?: unknown; radius?: unknown };
                    done({
                        id: prop.id,
                        hash: prop.hash,
                        behavior: typeof config.behavior === 'string' ? config.behavior : '',
                        radius: typeof config.radius === 'number' ? config.radius : 0,
                        imageBase64: imageBody.trim(),
                    });
                } catch (e) {
                    console.warn('[Meme] 設定不是 JSON:', prop.id, e);
                    done(null);
                }
            });
        });
    }

    private static _saveProp(file: MemeFile): LoadedMeme | null {
        try {
            StorageManager.createDir('memes');
            const written = StorageManager.writeJsonFile(this._filePath(file.id), file);
            if (!written) return null;
            const index = this._indexFromMemory(file);
            if (!StorageManager.writeJsonFile(INDEX_PATH, index)) return null;
            return this._toLoaded(file);
        } catch (e) {
            console.warn('[Meme] 寫入失敗:', file.id, e);
            return null;
        }
    }

    private static _readCached(props: { id: string; hash: string }[], index: number, done: () => void): void {
        if (index >= props.length) {
            done();
            return;
        }
        StorageManager.readJsonFile(this._filePath(props[index].id), (err, data) => {
            const file = !err && data ? data as MemeFile : null;
            const loaded = file ? this._toLoaded(file) : null;
            if (loaded && loaded.hash === props[index].hash) this._memes.push(loaded);
            this._readCached(props, index + 1, done);
        });
    }

    private static _upsert(meme: LoadedMeme): void {
        const at = this._memes.findIndex((item) => item.id === meme.id);
        if (at >= 0) this._memes[at] = meme;
        else this._memes.push(meme);
        this._frames.delete(meme.id);
    }

    private static _indexFromMemory(latest: MemeFile): MemeIndex {
        const props = this._memes
            .filter((item) => item.id !== latest.id)
            .map((item) => ({ id: item.id, hash: item.hash }));
        props.push({ id: latest.id, hash: latest.hash });
        return { props };
    }

    private static _toLoaded(file: MemeFile): LoadedMeme | null {
        if (!file.id || !file.hash || !file.imageBase64) return null;
        return {
            id: file.id,
            hash: file.hash,
            behavior: file.behavior ?? '',
            radius: file.radius && file.radius > 0 ? file.radius : 0,
            imageBase64: file.imageBase64,
        };
    }

    private static _parseManifest(content: string): Manifest | null {
        try {
            const data = JSON.parse(content) as { version?: unknown; props?: unknown };
            if (typeof data.version !== 'number' || !Array.isArray(data.props)) return null;
            const props: ManifestProp[] = [];
            for (const item of data.props) {
                const prop = item as ManifestProp;
                if (!prop || typeof prop.id !== 'string' || typeof prop.hash !== 'string') continue;
                if (typeof prop.image !== 'string' || typeof prop.config !== 'string') continue;
                props.push(prop);
            }
            return { version: data.version, props };
        } catch (e) {
            console.warn('[Meme] manifest 解析失敗', e);
            return null;
        }
    }

    private static _asIndex(data: object | null): MemeIndex {
        const props = (data as MemeIndex | null)?.props;
        if (!Array.isArray(props)) return { props: [] };
        return {
            props: props.filter((item) => item && typeof item.id === 'string' && typeof item.hash === 'string'),
        };
    }

    private static _resolve(path: string): string {
        if (/^https?:\/\//i.test(path)) return path;
        const base = this.manifestUrl.replace(/\/[^/]*$/, '/');
        return base + path.replace(/^\//, '');
    }

    private static _filePath(id: string): string {
        const safe = id.replace(/[^a-zA-Z0-9_-]/g, '_');
        return `memes/${safe}.json`;
    }

    private static _readVersion(): number {
        const value = Number(sys.localStorage.getItem(VERSION_KEY));
        return Number.isFinite(value) ? value : 0;
    }

    private static _writeVersion(version: number): void {
        sys.localStorage.setItem(VERSION_KEY, String(version));
    }

    private static _finish(err: string | null, done?: (err: string | null) => void): void {
        this._running = false;
        if (err) console.warn('[Meme] 使用已快取的資料:', err);
        done?.(err);
    }
}
