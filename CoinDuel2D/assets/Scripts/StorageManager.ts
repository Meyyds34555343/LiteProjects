import { native, sys } from 'cc';

/**
 * 本地存储管理器
 * - 原生平台：使用 native.fileUtils 读写可写路径下的文件
 * - Web/小游戏平台：文本走 sys.localStorage，二进制走 IndexedDB
 *
 * 资产缓存统一放在 `serverdata/` 下（原生为 可写路径/serverdata），
 * 由 AssetSyncManager 按 manifest 写入，DataProvider 读取。
 */
export class StorageManager {
    /** 虚拟文件系统在 localStorage 中的 key 前缀 */
    private static readonly _PREFIX: string = 'StorageManager:';
    /** 二进制回退（IndexedDB 不可用）时的 localStorage 前缀 */
    private static readonly _BIN_PREFIX: string = 'StorageManager:bin:';
    private static readonly _IDB_NAME: string = 'CoinDuelAssetCache';
    private static readonly _IDB_STORE: string = 'files';
    private static _idbPromise: Promise<IDBDatabase | null> | null = null;

    /** 资产缓存根目录：`可写路径/serverdata`（Web 为 `serverdata`） */
    public static getCacheRoot(): string {
        const writable = StorageManager.getWritablePath();
        if (!writable) return 'serverdata';
        return (writable.endsWith('/') ? writable : writable + '/') + 'serverdata';
    }

    /** 资产缓存内某相对路径的完整路径（rel 如 `levels/1.json`） */
    public static getCachePath(rel: string): string {
        return StorageManager.getCacheRoot() + '/' + rel.replace(/^[/\\]+/, '');
    }

    /** 确保文件所在目录存在（写入前调用） */
    public static ensureDirFor(path: string): void {
        const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
        if (slash <= 0) return;
        const dir = path.substring(0, slash);
        const fs = StorageManager._fs;
        if (fs) {
            try {
                fs.createDirectory(dir);
            } catch {
                // 已存在或平台不支持时忽略
            }
            return;
        }
        const parts = StorageManager._normalize(dir).split('/');
        let cur = '';
        for (const part of parts) {
            if (!part) continue;
            cur = cur ? cur + '/' + part : part;
            StorageManager.createDir(cur);
        }
    }

    /** 获取 fileUtils（非原生平台为 null） */
    private static get _fs(): any {
        return (native as any)?.fileUtils ?? null;
    }

    /** 获取存储根路径（Web 端为空串，路径按虚拟路径处理） */
    public static getWritablePath(): string {
        const fs = StorageManager._fs;
        return fs ? fs.getWritablePath() : '';
    }

    public static isFileExist(path: string): boolean {
        const fs = StorageManager._fs;
        if (fs) return fs.isFileExist(path);
        return sys.localStorage.getItem(StorageManager._fileKey(path)) != null;
    }

    public static isDirExist(path: string): boolean {
        const fs = StorageManager._fs;
        if (fs) return fs.isDirectoryExist(path);
        const dir = StorageManager._normalize(path);
        if (sys.localStorage.getItem(StorageManager._dirKey(dir)) != null) return true;
        // 目录下存在文件时也算目录存在
        const prefix = StorageManager._fileKey(dir + '/');
        for (let i = 0; i < sys.localStorage.length; i++) {
            const key = sys.localStorage.key(i);
            if (key && key.indexOf(prefix) === 0) return true;
        }
        return false;
    }

    public static createDir(path: string): any {
        const fs = StorageManager._fs;
        if (fs) return fs.createDirectory(path);
        sys.localStorage.setItem(StorageManager._dirKey(StorageManager._normalize(path)), '1');
        return true;
    }

    public static deleteFile(path: string): boolean {
        const fs = StorageManager._fs;
        if (fs) return fs.removeFile(path);
        const key = StorageManager._normalize(path);
        sys.localStorage.removeItem(StorageManager._fileKey(path));
        sys.localStorage.removeItem(StorageManager._BIN_PREFIX + key);
        StorageManager._idbDelete(key);
        return true;
    }

    public static deleteDir(path: string): boolean {
        const fs = StorageManager._fs;
        if (fs) return fs.removeDirectory(path);
        const dir = StorageManager._normalize(path);
        const dirPrefix = StorageManager._PREFIX + 'dir:' + dir;
        const filePrefix = StorageManager._PREFIX + 'file:' + dir;
        const binPrefix = StorageManager._BIN_PREFIX + dir;
        // 收集后再删除，避免遍历时修改 localStorage
        const toRemove: string[] = [];
        for (let i = 0; i < sys.localStorage.length; i++) {
            const key = sys.localStorage.key(i);
            if (key && (key === dirPrefix || key === filePrefix || key === binPrefix
                || key.indexOf(dirPrefix + '/') === 0
                || key.indexOf(filePrefix + '/') === 0
                || key.indexOf(binPrefix + '/') === 0)) {
                toRemove.push(key);
            }
        }
        for (const key of toRemove) {
            sys.localStorage.removeItem(key);
        }
        StorageManager._idbDeletePrefix(dir);
        return true;
    }

    public static readJsonFile(path: string, cb: (err: string | null, data: object | null) => void): any {
        const fs = StorageManager._fs;
        if (fs) return fs.readJsonFile(path, cb);
        const text = sys.localStorage.getItem(StorageManager._fileKey(path));
        if (text == null) {
            cb('file not found: ' + path, null);
            return;
        }
        try {
            cb(null, JSON.parse(text));
        } catch (e) {
            cb('json parse error: ' + path, null);
        }
    }

    public static writeJsonFile(path: string, data: object): boolean {
        return StorageManager.writeTextFile(path, JSON.stringify(data));
    }

    /** 写入文本文件（目录不存在时返回 false） */
    public static writeTextFile(path: string, text: string): boolean {
        const fs = StorageManager._fs;
        // 注意 fileUtils.writeStringToFile 参数顺序：先数据后路径
        if (fs) {
            StorageManager.ensureDirFor(path);
            return fs.writeStringToFile(text, path);
        }
        sys.localStorage.setItem(StorageManager._fileKey(path), text);
        return true;
    }

    /**
     * 写入二进制文件。
     * - 原生：fileUtils.writeDataToFile
     * - Web：IndexedDB（不可用时回退 localStorage + Base64）
     */
    public static writeBinaryFile(path: string, data: ArrayBuffer, cb?: (ok: boolean) => void): void {
        const fs = StorageManager._fs;
        if (fs) {
            let ok = false;
            try {
                StorageManager.ensureDirFor(path);
                const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
                ok = !!fs.writeDataToFile(bytes, path);
            } catch (e) {
                console.warn('[Storage] 二进制写入失败:', path, e);
            }
            cb?.(ok);
            return;
        }

        const key = StorageManager._normalize(path);
        StorageManager._openIdb().then((db) => {
            if (!db) {
                try {
                    sys.localStorage.setItem(
                        StorageManager._BIN_PREFIX + key,
                        StorageManager._bufferToBase64(data),
                    );
                    cb?.(true);
                } catch (e) {
                    console.warn('[Storage] localStorage 二进制写入失败:', path, e);
                    cb?.(false);
                }
                return;
            }
            try {
                const tx = db.transaction(StorageManager._IDB_STORE, 'readwrite');
                tx.objectStore(StorageManager._IDB_STORE).put(data, key);
                tx.oncomplete = () => cb?.(true);
                tx.onerror = () => {
                    console.warn('[Storage] IndexedDB 写入失败:', path);
                    cb?.(false);
                };
                tx.onabort = () => cb?.(false);
            } catch (e) {
                console.warn('[Storage] IndexedDB 写入异常:', path, e);
                cb?.(false);
            }
        });
    }

    /** 读取二进制文件。找不到时 err 非空。 */
    public static readBinaryFile(
        path: string,
        cb: (err: string | null, data: ArrayBuffer | null) => void,
    ): void {
        const fs = StorageManager._fs;
        if (fs) {
            try {
                const raw = fs.readDataFromFile
                    ? fs.readDataFromFile(path)
                    : (fs.getBytesFromFile ? fs.getBytesFromFile(path) : null);
                if (!raw) {
                    cb('file not found: ' + path, null);
                    return;
                }
                cb(null, StorageManager._toArrayBuffer(raw));
            } catch (e) {
                cb(String(e), null);
            }
            return;
        }

        const key = StorageManager._normalize(path);
        StorageManager._openIdb().then((db) => {
            if (!db) {
                const b64 = sys.localStorage.getItem(StorageManager._BIN_PREFIX + key);
                if (!b64) {
                    cb('file not found: ' + path, null);
                    return;
                }
                try {
                    cb(null, StorageManager._base64ToBuffer(b64));
                } catch (e) {
                    cb(String(e), null);
                }
                return;
            }
            try {
                const tx = db.transaction(StorageManager._IDB_STORE, 'readonly');
                const req = tx.objectStore(StorageManager._IDB_STORE).get(key);
                req.onsuccess = () => {
                    const value = req.result;
                    if (value == null) {
                        cb('file not found: ' + path, null);
                        return;
                    }
                    cb(null, StorageManager._toArrayBuffer(value));
                };
                req.onerror = () => cb('IndexedDB read error: ' + path, null);
            } catch (e) {
                cb(String(e), null);
            }
        });
    }

    /**
     * 列出资产缓存根目录下所有已存在的文件（相对路径，如 `textures/a.png`）。
     * Web：localStorage 文本 + IndexedDB 二进制；原生：递归遍历 serverdata/。
     */
    public static listCacheFiles(cb: (relPaths: string[]) => void): void {
        const root = StorageManager.getCacheRoot();
        const fs = StorageManager._fs;

        if (fs) {
            const out: string[] = [];
            StorageManager._walkNative(root, root, out);
            cb(out);
            return;
        }

        const out: string[] = [];
        const rootPrefix = StorageManager._normalize(root) + '/';

        // localStorage 中的文本文件
        const prefix = StorageManager._PREFIX + 'file:';
        for (let i = 0; i < sys.localStorage.length; i++) {
            const key = sys.localStorage.key(i);
            if (!key || key.indexOf(prefix) !== 0) continue;
            const full = key.substring(prefix.length);
            if (full.indexOf(rootPrefix) === 0) out.push(full.substring(rootPrefix.length));
        }

        // IndexedDB 中的二进制文件
        StorageManager._openIdb().then((db) => {
            if (!db) {
                cb(out);
                return;
            }
            try {
                const tx = db.transaction(StorageManager._IDB_STORE, 'readonly');
                const req = tx.objectStore(StorageManager._IDB_STORE).getAllKeys();
                req.onsuccess = () => {
                    const keys = (req.result ?? []) as IDBValidKey[];
                    for (const raw of keys) {
                        const key = String(raw);
                        if (key.indexOf(rootPrefix) === 0) out.push(key.substring(rootPrefix.length));
                    }
                    cb(out);
                };
                req.onerror = () => cb(out);
            } catch {
                cb(out);
            }
        });
    }

    private static _walkNative(root: string, dir: string, out: string[]): void {
        const fs = StorageManager._fs;
        if (!fs) return;
        let entries: string[] = [];
        try {
            entries = fs.listFiles(dir) ?? [];
        } catch {
            return;
        }
        const rootWithSlash = root.endsWith('/') ? root : root + '/';
        for (const raw of entries) {
            if (!raw || raw === '.' || raw === '..') continue;
            const hasSep = raw.indexOf('/') >= 0 || raw.indexOf('\\') >= 0;
            const full = hasSep ? raw : (dir.endsWith('/') ? dir + raw : dir + '/' + raw);
            try {
                if (fs.isDirectoryExist && fs.isDirectoryExist(full)) {
                    StorageManager._walkNative(root, full, out);
                } else {
                    const rel = full.indexOf(rootWithSlash) === 0
                        ? full.substring(rootWithSlash.length)
                        : full.replace(/^\.?\//, '');
                    out.push(rel.replace(/\\/g, '/'));
                }
            } catch {
                // 忽略無法存取的項目
            }
        }
    }

    /** 规范化路径：统一为 / 分隔，去掉开头的 ./ 和 / */
    private static _normalize(path: string): string {
        return path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '').replace(/\/{2,}/g, '/');
    }

    private static _fileKey(path: string): string {
        return StorageManager._PREFIX + 'file:' + StorageManager._normalize(path);
    }

    private static _dirKey(path: string): string {
        return StorageManager._PREFIX + 'dir:' + StorageManager._normalize(path);
    }

    // ── IndexedDB helpers ──

    private static _openIdb(): Promise<IDBDatabase | null> {
        if (StorageManager._idbPromise) return StorageManager._idbPromise;
        if (typeof indexedDB === 'undefined') {
            StorageManager._idbPromise = Promise.resolve(null);
            return StorageManager._idbPromise;
        }
        StorageManager._idbPromise = new Promise((resolve) => {
            try {
                const req = indexedDB.open(StorageManager._IDB_NAME, 1);
                req.onupgradeneeded = () => {
                    const db = req.result;
                    if (!db.objectStoreNames.contains(StorageManager._IDB_STORE)) {
                        db.createObjectStore(StorageManager._IDB_STORE);
                    }
                };
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => resolve(null);
                req.onblocked = () => resolve(null);
            } catch {
                resolve(null);
            }
        });
        return StorageManager._idbPromise;
    }

    private static _idbDelete(key: string): void {
        if (typeof indexedDB === 'undefined') return;
        StorageManager._openIdb().then((db) => {
            if (!db) return;
            try {
                const tx = db.transaction(StorageManager._IDB_STORE, 'readwrite');
                tx.objectStore(StorageManager._IDB_STORE).delete(key);
            } catch {
                // 忽略
            }
        });
    }

    private static _idbDeletePrefix(prefix: string): void {
        if (typeof indexedDB === 'undefined') return;
        StorageManager._openIdb().then((db) => {
            if (!db) return;
            try {
                const tx = db.transaction(StorageManager._IDB_STORE, 'readwrite');
                const req = tx.objectStore(StorageManager._IDB_STORE).openCursor();
                req.onsuccess = () => {
                    const cursor = req.result;
                    if (!cursor) return;
                    const key = String(cursor.key);
                    if (key === prefix || key.indexOf(prefix + '/') === 0) cursor.delete();
                    cursor.continue();
                };
            } catch {
                // 忽略
            }
        });
    }

    private static _toArrayBuffer(value: ArrayBuffer | ArrayBufferView): ArrayBuffer {
        if (value instanceof ArrayBuffer) return value;
        const view = value as ArrayBufferView;
        return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
    }

    private static _bufferToBase64(data: ArrayBuffer): string {
        const bytes = new Uint8Array(data);
        const chunk = 0x8000;
        let binary = '';
        for (let i = 0; i < bytes.length; i += chunk) {
            binary += String.fromCharCode.apply(
                null,
                Array.from(bytes.subarray(i, i + chunk)) as unknown as number[],
            );
        }
        return btoa(binary);
    }

    private static _base64ToBuffer(text: string): ArrayBuffer {
        const binary = atob(text);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes.buffer;
    }
}
