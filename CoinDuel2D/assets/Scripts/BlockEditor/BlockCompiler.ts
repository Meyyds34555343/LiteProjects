import {
    AssetManifest,
    CoinConfig,
    LevelConfig,
    ManifestItem,
    MemeConfig,
} from '../Meme/MemeSchema';
import {
    BLOCK_DEFS,
    BlockGraph,
    BlockKind,
    BlockOpcode,
    findHatRoots,
    walkStack,
} from './VisualBlockSchema';

export interface CompileCoinInput {
    x: number;
    y: number;
    canshot?: boolean;
    class?: number;
    radius?: number;
    memeId?: string;
    type?: 'coin' | 'bomb';
    /** 對應積木圖的 bindCoinId；缺省套用全部 hat 腳本 */
    coinId?: string;
}

export interface CompileLevelOptions {
    id: number;
    width: number;
    height: number;
    wallThickness: number;
    coins: CompileCoinInput[];
    graph: BlockGraph;
}

export interface CompileMemeOptions {
    id: string;
    radius?: number;
    graph: BlockGraph;
    textures?: MemeConfig['textures'];
}

export interface CompileResult {
    level: LevelConfig;
    meme: MemeConfig | null;
    behaviorsFlat: string[];
    manifestPatch: ManifestItem[];
    levelJson: string;
    memeJson: string | null;
    manifestJson: string;
    levelHash: string;
}

/**
 * 把 Scratch 積木樹編譯成執行期可吃的 LevelConfig / MemeConfig。
 * 遊戲場景只讀 JSON，不依賴積木節點。
 */
export class BlockCompiler {
    public static compileLevel(opts: CompileLevelOptions): CompileResult {
        const shared = this._behaviorsFromGraph(opts.graph);
        const coins: LevelConfig['coins'] = opts.coins.map((c) => {
            const fromBlocks = c.coinId
                ? this._behaviorsForCoin(opts.graph, c.coinId)
                : shared;
            if (c.type === 'bomb') {
                return {
                    type: 'bomb' as const,
                    class: c.class ?? 1,
                    x: Math.round(c.x),
                    y: Math.round(c.y),
                    radius: c.radius ?? 32,
                    behaviors: fromBlocks.length ? fromBlocks : undefined,
                };
            }
            const coin: CoinConfig = {
                type: 'coin',
                x: Math.round(c.x),
                y: Math.round(c.y),
                class: c.class ?? 1,
                canshot: c.canshot !== false,
                memeId: c.memeId,
                radius: c.radius,
            };
            if (fromBlocks.length) coin.behaviors = fromBlocks;
            return coin;
        });

        const level: LevelConfig = {
            id: opts.id,
            width: opts.width,
            height: opts.height,
            wall: { thickness: opts.wallThickness },
            coins,
        };

        const levelJson = JSON.stringify(level, null, 4);
        const levelHash = this.hashText(levelJson);
        const filename = `levels/${opts.id}.json`;
        const manifestPatch: ManifestItem[] = [{ filename, hash: levelHash }];

        const manifest: AssetManifest = {
            version: Date.now(),
            items: manifestPatch,
            levelConfig: filename,
        };

        return {
            level,
            meme: null,
            behaviorsFlat: shared,
            manifestPatch,
            levelJson,
            memeJson: null,
            manifestJson: JSON.stringify(manifest, null, 4),
            levelHash,
        };
    }

    public static compileMeme(opts: CompileMemeOptions): CompileResult {
        const behaviors = this._behaviorsFromGraph(opts.graph);
        const sfx = this._firstProp(opts.graph, BlockOpcode.PLAY_SOUND_EFFECT, 'clip');
        const meme: MemeConfig = {
            id: opts.id,
            behaviors: behaviors.length ? behaviors : undefined,
            behavior: behaviors[0],
            radius: opts.radius,
            textures: opts.textures ?? {},
            hittedSfx: typeof sfx === 'string' ? sfx : undefined,
        };
        const memeJson = JSON.stringify(meme, null, 4);
        const memeHash = this.hashText(memeJson);
        const filename = `memes/${opts.id}.json`;
        const emptyLevel: LevelConfig = {
            id: 0,
            width: 0,
            height: 0,
            wall: { thickness: 0 },
            coins: [],
        };
        return {
            level: emptyLevel,
            meme,
            behaviorsFlat: behaviors,
            manifestPatch: [{ filename, hash: memeHash, kind: 'meme' }],
            levelJson: JSON.stringify(emptyLevel),
            memeJson,
            manifestJson: JSON.stringify(
                { version: Date.now(), items: [{ filename, hash: memeHash }], memeConfig: filename } satisfies AssetManifest,
                null,
                4,
            ),
            levelHash: memeHash,
        };
    }

    /** 簡易字串 hash（FNV-1a 變體），給 manifest 增量用。 */
    public static hashText(text: string): string {
        let h = 2166136261;
        for (let i = 0; i < text.length; i++) {
            h ^= text.charCodeAt(i);
            h = Math.imul(h, 16777619);
        }
        return (h >>> 0).toString(16).padStart(8, '0');
    }

    private static _behaviorsFromGraph(graph: BlockGraph): string[] {
        const out: string[] = [];
        const seen = new Set<string>();
        for (const hat of findHatRoots(graph)) {
            for (const id of this._stackBehaviors(graph, hat.id)) {
                if (seen.has(id)) continue;
                seen.add(id);
                out.push(id);
            }
        }
        return out;
    }

    private static _behaviorsForCoin(graph: BlockGraph, coinId: string): string[] {
        if (graph.bindCoinId && graph.bindCoinId !== coinId) {
            return this._behaviorsFromGraph({ ...graph, blocks: graph.blocks });
        }
        return this._behaviorsFromGraph(graph);
    }

    private static _stackBehaviors(graph: BlockGraph, rootId: string): string[] {
        const chain = walkStack(graph, rootId);
        const out: string[] = [];
        for (const block of chain) {
            const def = BLOCK_DEFS[block.opcode];
            if (def.kind === BlockKind.Hat) continue;
            if (def.behaviorId) out.push(def.behaviorId);
        }
        return out;
    }

    private static _firstProp(graph: BlockGraph, opcode: BlockOpcode, key: string): string | number | boolean | null {
        for (const block of graph.blocks) {
            if (block.opcode !== opcode) continue;
            const prop = block.props.find((p) => p.key === key);
            if (prop) return prop.value;
        }
        return null;
    }
}
