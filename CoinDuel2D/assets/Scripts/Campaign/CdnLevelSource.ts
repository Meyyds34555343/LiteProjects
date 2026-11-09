import { LevelData } from '../LevelData';
import { DEFAULT_CDN_MANIFEST_URL, resolveCdnManifestUrl } from '../Meme/CdnConfig';
import { NetworkManager } from '../NetworkManager';

/**
 * CDN-first campaign level source.
 *
 * The web Blockly editor writes `cdn/levels/{id}.json` to GitHub. This loader
 * lets the running game pick those files up **without a Cocos rebuild**, so
 * "Save Level → Git" in the editor changes Stage Mode on the next refresh.
 *
 * Behaviour:
 *  - fetch `{manifestBase}/levels/{id}.json` with a cache-busting query
 *  - validate it looks like a level (numeric id + coins array)
 *  - on any failure (offline, 404, bad JSON) return null so callers fall back
 *    to the bundled `resources/levels/{id}.json`
 *
 * Results (including misses) are memoised for the session so replaying a stage
 * does not refetch.
 */
export class CdnLevelSource {
    /** Set false to force bundled levels only. */
    public static enabled: boolean = true;

    /** Manifest URL whose folder holds `levels/*.json`. */
    public static manifestUrl: string = DEFAULT_CDN_MANIFEST_URL;

    private static _cache = new Map<number, LevelData | null>();

    /** Folder that contains `levels/`, always absolute. */
    private static _base(): string {
        const clean = resolveCdnManifestUrl(CdnLevelSource.manifestUrl);
        return clean.replace(/\/[^/]*$/, '/');
    }

    /**
     * Load level `id` from the CDN.
     * @param id 1-based stage id
     * @param cb receives the level, or null when unavailable
     */
    public static load(id: number, cb: (level: LevelData | null) => void): void {
        if (!CdnLevelSource.enabled || !Number.isFinite(id) || id < 1) {
            cb(null);
            return;
        }
        if (CdnLevelSource._cache.has(id)) {
            cb(CdnLevelSource._cache.get(id) ?? null);
            return;
        }

        const url = CdnLevelSource._base() + 'levels/' + id + '.json?t=' + Date.now();
        NetworkManager.HttpGet(url, (code, body) => {
            const level = (code === 200 && body) ? CdnLevelSource._parse(body, id) : null;
            CdnLevelSource._cache.set(id, level);
            if (!level) {
                console.log('[CdnLevel] level', id, 'not on CDN (code=' + code + ') — using bundled file');
            } else {
                console.log('[CdnLevel] level', id, 'from CDN, objects=' + level.coins.length);
            }
            cb(level);
        });
    }

    /** Drop memoised results (e.g. after the player pulls to refresh). */
    public static clearCache(): void {
        CdnLevelSource._cache.clear();
    }

    private static _parse(body: string, expectedId: number): LevelData | null {
        try {
            const data = JSON.parse(body) as LevelData & { schemaVersion?: number };
            if (!data || typeof data !== 'object') return null;
            // A ModConfig bundle is not a level.
            if (data.schemaVersion != null) return null;
            if (!Array.isArray(data.coins)) return null;
            if (typeof data.id !== 'number') data.id = expectedId;
            if (typeof data.width !== 'number' || typeof data.height !== 'number') return null;
            if (!data.wall || typeof data.wall.thickness !== 'number') {
                data.wall = { thickness: 64 };
            }
            return data;
        } catch {
            return null;
        }
    }
}
