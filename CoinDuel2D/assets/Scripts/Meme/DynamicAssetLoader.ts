import { assetManager, AudioClip, ImageAsset, resources, SpriteFrame, Texture2D } from 'cc';

/**
 * Runtime hot-loader for skins / SFX.
 * Accepts preset keys, db://-style resource paths, http(s) URLs, or data: Base64.
 * Builds SpriteFrame / AudioClip without editor recompile or scene rebuild.
 */

export type AssetRef = string;

const frameCache = new Map<string, SpriteFrame>();
const clipCache = new Map<string, AudioClip>();

/** Built-in coin skin presets → Resources texture stems (no /spriteFrame suffix). */
export const PRESET_COIN_SKINS: Record<string, {
    default: string;
    idle?: string;
    aim?: string;
    shot?: string;
    hitted?: string;
}> = {
    coin_1: {
        default: 'textures/coin_1',
        idle: 'textures/coin_1',
        aim: 'textures/coin_1_aim',
        shot: 'textures/coin_1_shot',
        hitted: 'textures/coin_1_hitted',
    },
    coin: { default: 'textures/coin', idle: 'textures/coin' },
    gold: { default: 'textures/gold', idle: 'textures/gold' },
    silver: { default: 'textures/silver', idle: 'textures/silver' },
    copper: { default: 'textures/copper', idle: 'textures/copper' },
    ice: { default: 'textures/ice', idle: 'textures/ice' },
    coin_2: { default: 'textures/coin_2', idle: 'textures/coin_2' },
};

export const PRESET_TABLE_SKINS: Record<string, string> = {
    table_1: 'textures/table_1',
    board: 'textures/board',
    board1: 'textures/board1',
    board2: 'textures/board2',
    bg1: 'textures/bg1',
};

export const PRESET_WALL_SKINS: Record<string, string> = {
    wall_1: 'textures/wall_1',
    table_wall: 'textures/table_wall',
};

export const PRESET_SFX: Record<string, string> = {
    shot: 'sounds/shot',
    coinfall: 'sounds/coinfall',
    collision: 'sounds/collision',
};

export class DynamicAssetLoader {
    public static clearCache(): void {
        frameCache.clear();
        clipCache.clear();
    }

    public static resolveCoinPreset(key: string): {
        default: string;
        idle?: string;
        aim?: string;
        shot?: string;
        hitted?: string;
    } | null {
        return PRESET_COIN_SKINS[key] ?? null;
    }

    public static resolveTablePreset(key: string): string | null {
        return PRESET_TABLE_SKINS[key] ?? null;
    }

    public static resolveWallPreset(key: string): string | null {
        return PRESET_WALL_SKINS[key] ?? null;
    }

    /** Load a SpriteFrame from preset / resource path / URL / Base64. */
    public static loadSprite(ref: AssetRef, done: (frame: SpriteFrame | null) => void): void {
        if (!ref) {
            done(null);
            return;
        }
        const cached = frameCache.get(ref);
        if (cached) {
            done(cached);
            return;
        }

        if (this._isDataUri(ref)) {
            this._spriteFromDataUri(ref, (frame) => {
                if (frame) frameCache.set(ref, frame);
                done(frame);
            });
            return;
        }

        if (this._isHttp(ref)) {
            const ext = this._imageExt(ref);
            assetManager.loadRemote<ImageAsset>(ref, { ext }, (err, image) => {
                if (err || !image) {
                    console.warn('[DynamicAsset] remote sprite failed:', ref, err);
                    done(null);
                    return;
                }
                const frame = this._frameFromImage(image);
                frameCache.set(ref, frame);
                done(frame);
            });
            return;
        }

        // Preset key or resources path
        const path = this._toResourceSpritePath(ref);
        resources.load(path, SpriteFrame, (err, sf) => {
            if (!err && sf) {
                frameCache.set(ref, sf);
                done(sf);
                return;
            }
            // Fallback: treat as ImageAsset path without /spriteFrame
            const imgPath = path.replace(/\/spriteFrame$/, '');
            resources.load(imgPath, ImageAsset, (err2, image) => {
                if (err2 || !image) {
                    console.warn('[DynamicAsset] resources sprite failed:', ref, err || err2);
                    done(null);
                    return;
                }
                const frame = this._frameFromImage(image);
                frameCache.set(ref, frame);
                done(frame);
            });
        });
    }

    /** Load AudioClip from preset / resource / URL / Base64 data URI. */
    public static loadAudio(ref: AssetRef, done: (clip: AudioClip | null) => void): void {
        if (!ref) {
            done(null);
            return;
        }
        const cached = clipCache.get(ref);
        if (cached) {
            done(cached);
            return;
        }

        const preset = PRESET_SFX[ref];
        const resolved = preset ?? ref;

        if (this._isDataUri(resolved)) {
            // Cocos remote loader accepts blob URLs better than raw data URIs for audio
            try {
                const blobUrl = this._dataUriToBlobUrl(resolved);
                assetManager.loadRemote<AudioClip>(blobUrl, { ext: this._audioExt(resolved) }, (err, clip) => {
                    if (err || !clip) {
                        console.warn('[DynamicAsset] base64 audio failed:', err);
                        done(null);
                        return;
                    }
                    clipCache.set(ref, clip);
                    done(clip);
                });
            } catch (e) {
                console.warn('[DynamicAsset] base64 audio decode failed', e);
                done(null);
            }
            return;
        }

        if (this._isHttp(resolved)) {
            assetManager.loadRemote<AudioClip>(resolved, { ext: this._audioExt(resolved) }, (err, clip) => {
                if (err || !clip) {
                    console.warn('[DynamicAsset] remote audio failed:', resolved, err);
                    done(null);
                    return;
                }
                clipCache.set(ref, clip);
                done(clip);
            });
            return;
        }

        resources.load(resolved, AudioClip, (err, clip) => {
            if (err || !clip) {
                console.warn('[DynamicAsset] resources audio failed:', resolved, err);
                done(null);
                return;
            }
            clipCache.set(ref, clip);
            done(clip);
        });
    }

    public static loadSpriteSet(
        refs: { default?: AssetRef; idle?: AssetRef; aim?: AssetRef; shot?: AssetRef; hitted?: AssetRef },
        done: (pack: {
            default: SpriteFrame | null;
            idle: SpriteFrame | null;
            aim: SpriteFrame | null;
            shot: SpriteFrame | null;
            hitted: SpriteFrame | null;
        }) => void,
    ): void {
        const keys = ['default', 'idle', 'aim', 'shot', 'hitted'] as const;
        const pack = { default: null, idle: null, aim: null, shot: null, hitted: null } as {
            default: SpriteFrame | null;
            idle: SpriteFrame | null;
            aim: SpriteFrame | null;
            shot: SpriteFrame | null;
            hitted: SpriteFrame | null;
        };
        let left = 0;
        for (const k of keys) if (refs[k]) left++;
        if (left === 0) {
            done(pack);
            return;
        }
        for (const k of keys) {
            const ref = refs[k];
            if (!ref) continue;
            this.loadSprite(ref, (frame) => {
                pack[k] = frame;
                left--;
                if (left <= 0) done(pack);
            });
        }
    }

    /**
     * 从本地缓存的字节解码 SpriteFrame。
     * Web 用 Blob URL + Image；原生用已落盘的文件路径。
     */
    public static loadSpriteFromBytes(
        cacheRef: string,
        bytes: ArrayBuffer,
        ext: string,
        done: (frame: SpriteFrame | null) => void,
    ): void {
        const ImageCtor = (globalThis as { Image?: new () => HTMLImageElement }).Image;
        const canBlob = typeof Blob !== 'undefined'
            && typeof URL !== 'undefined'
            && typeof URL.createObjectURL === 'function';
        if (ImageCtor && canBlob) {
            const blobUrl = URL.createObjectURL(
                new Blob([new Uint8Array(bytes)], { type: this._mimeForExt(ext) }),
            );
            const img = new ImageCtor();
            img.onload = () => {
                let frame: SpriteFrame | null = null;
                try {
                    frame = this._frameFromImage(new ImageAsset(img));
                } catch (e) {
                    console.warn('[DynamicAsset] 缓存图片解码失败', e);
                }
                URL.revokeObjectURL(blobUrl);
                done(frame);
            };
            img.onerror = () => {
                URL.revokeObjectURL(blobUrl);
                done(null);
            };
            img.src = blobUrl;
            return;
        }

        assetManager.loadRemote<ImageAsset>(cacheRef, { ext }, (err, image) => {
            if (err || !image) {
                console.warn('[DynamicAsset] 本地缓存图片加载失败:', cacheRef, err);
                done(null);
                return;
            }
            done(this._frameFromImage(image));
        });
    }

    /** 从本地缓存的字节解码 AudioClip。 */
    public static loadAudioFromBytes(
        cacheRef: string,
        bytes: ArrayBuffer,
        ext: string,
        done: (clip: AudioClip | null) => void,
    ): void {
        const canBlob = typeof Blob !== 'undefined'
            && typeof URL !== 'undefined'
            && typeof URL.createObjectURL === 'function';
        if (canBlob) {
            const blobUrl = URL.createObjectURL(
                new Blob([new Uint8Array(bytes)], { type: this._mimeForExt(ext) }),
            );
            assetManager.loadRemote<AudioClip>(blobUrl, { ext }, (err, clip) => {
                URL.revokeObjectURL(blobUrl);
                if (err || !clip) {
                    console.warn('[DynamicAsset] 缓存音频解码失败:', err);
                    done(null);
                    return;
                }
                done(clip);
            });
            return;
        }

        assetManager.loadRemote<AudioClip>(cacheRef, { ext }, (err, clip) => {
            if (err || !clip) {
                console.warn('[DynamicAsset] 本地缓存音频加载失败:', cacheRef, err);
                done(null);
                return;
            }
            done(clip);
        });
    }

    private static _mimeForExt(ext: string): string {
        switch (ext.toLowerCase()) {
            case '.jpg':
            case '.jpeg':
                return 'image/jpeg';
            case '.png':
                return 'image/png';
            case '.webp':
                return 'image/webp';
            case '.gif':
                return 'image/gif';
            case '.mp3':
                return 'audio/mpeg';
            case '.ogg':
                return 'audio/ogg';
            case '.wav':
                return 'audio/wav';
            default:
                return 'application/octet-stream';
        }
    }

    private static _isHttp(ref: string): boolean {
        return /^https?:\/\//i.test(ref);
    }

    private static _isDataUri(ref: string): boolean {
        return /^data:/i.test(ref);
    }

    private static _toResourceSpritePath(ref: string): string {
        // "coin_1" → textures/coin_1/spriteFrame if preset, else append
        const preset = PRESET_COIN_SKINS[ref]?.default
            ?? PRESET_TABLE_SKINS[ref]
            ?? PRESET_WALL_SKINS[ref];
        const stem = preset ?? (ref.startsWith('textures/') ? ref : `textures/${ref}`);
        if (stem.endsWith('/spriteFrame')) return stem;
        return `${stem}/spriteFrame`;
    }

    private static _frameFromImage(image: ImageAsset): SpriteFrame {
        const tex = new Texture2D();
        tex.image = image;
        const frame = new SpriteFrame();
        frame.texture = tex;
        frame.packable = false;
        return frame;
    }

    private static _spriteFromDataUri(dataUri: string, done: (frame: SpriteFrame | null) => void): void {
        const ImageCtor = (globalThis as { Image?: new () => HTMLImageElement }).Image;
        if (!ImageCtor) {
            // Native: try loadRemote with data URI (supported on some platforms)
            assetManager.loadRemote<ImageAsset>(dataUri, { ext: '.png' }, (err, image) => {
                if (err || !image) {
                    console.warn('[DynamicAsset] dataURI sprite failed', err);
                    done(null);
                    return;
                }
                done(this._frameFromImage(image));
            });
            return;
        }
        const img = new ImageCtor();
        img.onload = () => {
            try {
                const asset = new ImageAsset(img);
                done(this._frameFromImage(asset));
            } catch (e) {
                console.warn('[DynamicAsset] dataURI decode failed', e);
                done(null);
            }
        };
        img.onerror = () => done(null);
        img.src = dataUri;
    }

    private static _dataUriToBlobUrl(dataUri: string): string {
        const match = /^data:([^;]+);base64,(.+)$/i.exec(dataUri);
        if (!match) return dataUri;
        const mime = match[1];
        const b64 = match[2];
        const binary = atob(b64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const blob = new Blob([bytes], { type: mime });
        return URL.createObjectURL(blob);
    }

    private static _imageExt(url: string): string {
        if (/\.jpe?g(\?|$)/i.test(url)) return '.jpg';
        if (/\.webp(\?|$)/i.test(url)) return '.webp';
        if (/\.gif(\?|$)/i.test(url)) return '.png';
        return '.png';
    }

    private static _audioExt(url: string): string {
        if (/\.mp3(\?|$|base64)/i.test(url)) return '.mp3';
        if (/\.ogg(\?|$|base64)/i.test(url)) return '.ogg';
        if (/audio\/mpeg/i.test(url)) return '.mp3';
        return '.wav';
    }
}
