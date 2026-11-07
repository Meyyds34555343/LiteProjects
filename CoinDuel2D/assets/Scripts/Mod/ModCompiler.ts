import { AssetManifest, ManifestItem } from '../Meme/MemeSchema';
import {
    DEFAULT_PHYSICS,
    findModHatRoots,
    GlobalPhysicsRules,
    LoseConditionType,
    LoseRule,
    ModBlockGraph,
    ModBlockKind,
    ModConfig,
    MOD_BLOCK_DEFS,
    ModOpcode,
    ModRulePipeline,
    ModVariableDef,
    ModVisualBlock,
    propsToMap,
    walkModStack,
    WinConditionType,
    WinRule,
} from './ModConfigSchema';
// ModConfig.level carries Scratch level layouts through share codes.

export interface CompileModOptions {
    id?: string;
    name?: string;
    author?: string;
    graph: ModBlockGraph;
    win?: WinRule[];
    lose?: LoseRule[];
    physics?: Partial<GlobalPhysicsRules>;
    variables?: ModVariableDef[];
    version?: number;
    level?: ModConfig['level'];
}

export interface CompileModResult {
    mod: ModConfig;
    modJson: string;
    hash: string;
    shareCode: string;
    manifestPatch: ManifestItem[];
    manifestJson: string;
}

const SHARE_PREFIX = 'COINMOD1:';

/**
 * Serializes visual block graphs into ModConfig + AssetSync manifest patch +
 * compressed base64 sandbox share string.
 */
export class ModCompiler {
    public static compile(opts: CompileModOptions): CompileModResult {
        const pipelines = this._pipelinesFromGraph(opts.graph);
        const variables = opts.variables ?? this._inferVariables(opts.graph);
        const win = opts.win ?? this._defaultWin();
        const lose = opts.lose ?? this._defaultLose();
        const physics: GlobalPhysicsRules = { ...DEFAULT_PHYSICS, ...(opts.physics ?? {}) };

        const mod: ModConfig = {
            schemaVersion: 1,
            id: opts.id ?? `mod_${Date.now().toString(36)}`,
            name: opts.name ?? 'Untitled Mode',
            author: opts.author,
            version: opts.version ?? Date.now(),
            graph: {
                blocks: opts.graph.blocks.map((b) => ({
                    ...b,
                    props: b.props.map((p) => ({ ...p })),
                })),
                bindCoinId: opts.graph.bindCoinId,
            },
            pipelines,
            win,
            lose,
            physics,
            variables,
            level: opts.level,
        };

        const modJson = JSON.stringify(mod);
        const hash = this.hashText(modJson);
        mod.hash = hash;
        const finalJson = JSON.stringify(mod, null, 2);
        const shareCode = this.toShareCode(mod);

        const filename = `mods/${mod.id}.json`;
        const manifestPatch: ManifestItem[] = [{ filename, hash, kind: 'mod' }];
        const manifest: AssetManifest = {
            version: mod.version,
            items: manifestPatch,
            modConfig: filename,
        };

        return {
            mod: JSON.parse(finalJson) as ModConfig,
            modJson: finalJson,
            hash,
            shareCode,
            manifestPatch,
            manifestJson: JSON.stringify(manifest, null, 2),
        };
    }

    /** 1-click sandbox export: COINMOD1:<base64(json)> */
    public static toShareCode(mod: ModConfig): string {
        const raw = JSON.stringify(mod);
        return SHARE_PREFIX + this._utf8ToBase64(raw);
    }

    public static fromShareCode(code: string): ModConfig | null {
        const trimmed = code.trim();
        if (!trimmed.startsWith(SHARE_PREFIX)) return null;
        try {
            const json = this._base64ToUtf8(trimmed.slice(SHARE_PREFIX.length));
            const data = JSON.parse(json) as ModConfig;
            if (data.schemaVersion !== 1 || !Array.isArray(data.pipelines)) return null;
            return data;
        } catch {
            return null;
        }
    }

    public static hashText(text: string): string {
        let h = 2166136261;
        for (let i = 0; i < text.length; i++) {
            h ^= text.charCodeAt(i);
            h = Math.imul(h, 16777619);
        }
        return (h >>> 0).toString(16).padStart(8, '0');
    }

    public static emptyGraph(): ModBlockGraph {
        return { blocks: [] };
    }

    private static _pipelinesFromGraph(graph: ModBlockGraph): ModRulePipeline[] {
        const out: ModRulePipeline[] = [];
        for (const hat of findModHatRoots(graph)) {
            const chain = walkModStack(graph, hat.id);
            const steps: ModRulePipeline['steps'] = [];
            for (const block of chain) {
                const def = MOD_BLOCK_DEFS[block.opcode];
                if (def.kind === ModBlockKind.Hat) continue;
                steps.push({ opcode: block.opcode, props: propsToMap(block.props) });
            }
            out.push({
                id: hat.id,
                event: hat.opcode,
                steps,
            });
            // Attach hat props onto first synthetic step for event filters (e.g. power %)
            const hatProps = propsToMap(hat.props);
            if (Object.keys(hatProps).length) {
                (out[out.length - 1] as ModRulePipeline & { eventProps?: Record<string, unknown> }).eventProps = hatProps;
            }
        }
        return out;
    }

    private static _inferVariables(graph: ModBlockGraph): ModVariableDef[] {
        const names = new Set<string>();
        for (const b of graph.blocks) {
            for (const p of b.props) {
                if (p.key === 'name' && typeof p.value === 'string' && p.value) names.add(p.value);
            }
        }
        // Sensible defaults always present for JJS-style sandbox modes
        names.add('KarmaPoints');
        names.add('ExplosionPower');
        return Array.from(names).map((name) => ({
            name,
            initial: name === 'ExplosionPower' ? 50 : 0,
        }));
    }

    private static _defaultWin(): WinRule[] {
        return [{ type: WinConditionType.CLEAR_ALL_COINS }];
    }

    private static _defaultLose(): LoseRule[] {
        return [{ type: LoseConditionType.STRIKER_FALLS_OFF_TABLE }];
    }

    private static _utf8ToBase64(text: string): string {
        if (typeof btoa === 'function') {
            return btoa(unescape(encodeURIComponent(text)));
        }
        // Node / editor fallback
        const buf = typeof Buffer !== 'undefined' ? Buffer.from(text, 'utf8') : null;
        return buf ? buf.toString('base64') : text;
    }

    private static _base64ToUtf8(b64: string): string {
        if (typeof atob === 'function') {
            return decodeURIComponent(escape(atob(b64)));
        }
        const buf = typeof Buffer !== 'undefined' ? Buffer.from(b64, 'base64') : null;
        return buf ? buf.toString('utf8') : b64;
    }
}

/** Event props live beside pipeline for interpreter filters. */
export type ModRulePipelineEx = ModRulePipeline & {
    eventProps?: Record<string, string | number | boolean>;
};

export function getPipelineEventProps(p: ModRulePipeline): Record<string, string | number | boolean> {
    return (p as ModRulePipelineEx).eventProps ?? {};
}

/** Re-export helpers for editor bootstrap. */
export function starterGraph(): ModBlockGraph {
    const hit: ModVisualBlock = {
        id: 'hat_hit',
        opcode: ModOpcode.WHEN_COIN_HIT,
        nextId: 'fx_text',
        props: [],
        x: 80,
        y: 100,
    };
    const text: ModVisualBlock = {
        id: 'fx_text',
        opcode: ModOpcode.SPAWN_WORLD_TEXT,
        nextId: 'fx_shake',
        props: [
            { key: 'text', label: 'text', value: 'BONK!' },
            { key: 'color', label: 'color', value: '#FFE082' },
        ],
        x: 80,
        y: 60,
    };
    const shake: ModVisualBlock = {
        id: 'fx_shake',
        opcode: ModOpcode.SCREEN_SHAKE,
        nextId: null,
        props: [
            { key: 'intensity', label: 'amp', value: 0.1 },
            { key: 'duration', label: 'sec', value: 0.15 },
        ],
        x: 80,
        y: 20,
    };
    return { blocks: [hit, text, shake] };
}
