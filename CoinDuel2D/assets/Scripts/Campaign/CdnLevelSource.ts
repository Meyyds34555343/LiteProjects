import { LevelData } from '../LevelData';
import { githubRawUrl } from '../Meme/CdnConfig';
import { NetworkManager } from '../NetworkManager';

/**
 * CDN-first campaign level source.
 *
 * The web Blockly editor writes `cdn/levels/{id}.json` to GitHub. This loader
 * lets the running game read those files back **without a Cocos rebuild**, so
 * "Save Level → Git" changes Stage Mode on the next refresh.
 *
 * It reads from **raw.githubusercontent.com** rather than jsDelivr: jsDelivr
 * caches branch URLs for hours and ignored purge requests in testing, while raw
 * GitHub reflects a new commit within seconds and still sends
 * `Access-Control-Allow-Origin: *`.
 *
 * Behaviour:
 *  - GET `raw/{branch}/cdn/levels/{id}.json` with a cache-busting query
 *  - validate it is a level (numeric id + coins array, no schemaVersion)
 *  - on any failure (offline, 404, bad JSON) return null so callers fall back
 *    to the bundled `resources/levels/{id}.json`
 *
 * Results (including misses) are memoised for the session so replaying a stage
 * does not refetch.
 */
export class CdnLevelSource {
    /** Set false to force bundled levels only. */
    public static enabled: boolean = true;

    private static _cache = new Map<number, LevelData | null>();

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

        const url = githubRawUrl('cdn/levels/' + id + '.json')
            + '?t=' + Date.now().toString(36);
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

    /** True when a CDN copy was found for this stage this session. */
    public static isFromCdn(id: number): boolean {
        return (CdnLevelSource._cache.get(id) ?? null) !== null;
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
