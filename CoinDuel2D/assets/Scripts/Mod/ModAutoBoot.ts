/**
 * Zero-touch ModConfig ingest for web-first workflow.
 * Priority: ?mod=COINMOD1 → ?modUrl= → localStorage cache.
 * Then CDN sync (mod.assetManifestUrl or DEFAULT), Scratch level wins.
 */
import { sys } from 'cc';
import { DEFAULT_CDN_MANIFEST_URL, resolveCdnManifestUrl } from '../Meme/CdnConfig';
import { AssetSyncManager } from '../Meme/AssetSyncManager';
import { LevelManager } from '../LevelManager';
import { ModConfig } from './ModConfigSchema';
import { ModCompiler } from './ModCompiler';
import { GameLogicInterpreter } from './GameLogicInterpreter';

const STORAGE_KEY = 'CoinDuel:activeMod';

export type ModAutoBootDone = (err: string | null, mod: ModConfig | null) => void;

export class ModAutoBoot {
    /** Resolve share code / JSON from URL query or storage (sync part). */
    public static peekShareCode(): string | null {
        try {
            if (typeof location !== 'undefined' && location.search) {
                const q = new URLSearchParams(location.search);
                const mod = q.get('mod');
                if (mod && mod.trim()) return decodeURIComponent(mod.trim());
            }
        } catch { /* ignore */ }
        return null;
    }

    public static peekModUrl(): string | null {
        try {
            if (typeof location !== 'undefined' && location.search) {
                const q = new URLSearchParams(location.search);
                const url = q.get('modUrl');
                if (url && url.trim()) return decodeURIComponent(url.trim());
            }
        } catch { /* ignore */ }
        return null;
    }

    public static readCachedMod(): ModConfig | null {
        try {
            const raw =
                sys.localStorage?.getItem(STORAGE_KEY)
                ?? (typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null);
            if (!raw) return null;
            const mod = JSON.parse(raw) as ModConfig;
            if (mod?.schemaVersion !== 1 || !Array.isArray(mod.pipelines)) return null;
            return mod;
        } catch {
            return null;
        }
    }

    /** Apply mod pipelines; only stamp Scratch level when applyLevel is true (explicit ?mod= / ?modUrl=). */
    public static applyMod(mod: ModConfig | null, applyLevel: boolean = true): ModConfig | null {
        if (!mod) return null;
        const interp = GameLogicInterpreter.getOrCreate();
        interp.load(mod, applyLevel);
        if (applyLevel && mod.level) {
            LevelManager.setScratchLevel(mod.level as never);
        }
        return mod;
    }

    /** True when the page was opened with an explicit share/mod URL. */
    public static hasExplicitModQuery(): boolean {
        return !!(this.peekShareCode() || this.peekModUrl());
    }

    public static applyShareCode(code: string): ModConfig | null {
        const trimmed = code.trim();
        if (trimmed.startsWith('COINMOD1:')) {
            const mod = ModCompiler.fromShareCode(trimmed);
            return this.applyMod(mod);
        }
        try {
            const mod = JSON.parse(trimmed) as ModConfig;
            if (mod.schemaVersion === 1 && Array.isArray(mod.pipelines)) {
                return this.applyMod(mod);
            }
        } catch { /* ignore */ }
        return null;
    }

    /**
     * Hands-free prepare: ingest pack, sync CDN, then callback.
     * Scratch level always takes precedence over campaign picks.
     */
    public static prepare(sync: AssetSyncManager | null, done: ModAutoBootDone): void {
        const finish = (err: string | null, mod: ModConfig | null) => {
            try {
                done(err, mod);
            } catch (e) {
                console.warn('[ModAutoBoot] done threw', e);
            }
        };

        const afterIngest = (mod: ModConfig | null) => {
            if (!mod) {
                // Cache: pipelines/CDN only — never overwrite Ladder/campaign with Scratch level
                const cached = this.readCachedMod();
                if (cached) {
                    this.applyMod(cached, false);
                    this._syncCdn(sync, cached, (e) => finish(e, cached));
                    return;
                }
                finish(null, null);
                return;
            }
            this._syncCdn(sync, mod, (e) => finish(e, mod));
        };

        const fromQuery = this.peekShareCode();
        if (fromQuery) {
            const mod = this.applyShareCode(fromQuery);
            if (mod) {
                afterIngest(mod);
                return;
            }
            console.warn('[ModAutoBoot] ?mod= parse failed');
        }

        const modUrl = this.peekModUrl();
        if (modUrl) {
            this._fetchJson(modUrl, (err, data) => {
                if (err || !data) {
                    afterIngest(null);
                    return;
                }
                const mod = this.applyMod(data as ModConfig, true);
                afterIngest(mod);
            });
            return;
        }

        // Prefer interpreter cache / localStorage when no URL (no Scratch level stamp)
        const interp = GameLogicInterpreter.getOrCreate();
        if (interp.mod) {
            afterIngest(interp.mod);
            return;
        }
        if (interp.loadCached()) {
            afterIngest(interp.mod);
            return;
        }
        afterIngest(null);
    }

    private static _syncCdn(
        sync: AssetSyncManager | null,
        mod: ModConfig | null,
        done: (err: string | null) => void,
    ): void {
        if (!sync) {
            done(null);
            return;
        }
        // Always absolute jsDelivr (or mod override); never empty / localhost / relative.
        const url = resolveCdnManifestUrl(mod?.assetManifestUrl || DEFAULT_CDN_MANIFEST_URL);
        sync.manifestUrl = url;
        console.log('[ModAutoBoot] CDN sync →', url);
        sync.sync((err) => done(err));
    }

    private static _fetchJson(url: string, done: (err: string | null, data: unknown) => void): void {
        try {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', url, true);
            xhr.onload = () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    try {
                        done(null, JSON.parse(xhr.responseText));
                    } catch (e) {
                        done(String(e), null);
                    }
                } else {
                    done(`http ${xhr.status}`, null);
                }
            };
            xhr.onerror = () => done('network', null);
            xhr.send();
        } catch (e) {
            done(String(e), null);
        }
    }
}
