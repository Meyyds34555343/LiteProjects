/**
 * GTA/JJS-style Mod package schema.
 * Visual blocks compile to this JSON; runtime GameLogicInterpreter executes it.
 * Compatible with AssetSyncManager hash manifests (kind: 'mod').
 */

export enum ModBlockCategory {
    Event = 'event',
    Condition = 'condition',
    Action = 'action',
    Fx = 'fx',
    Math = 'math',
}

export enum ModBlockKind {
    Hat = 'hat',
    Stack = 'stack',
    Cap = 'cap',
}

/** Event ➔ Condition ➔ Action / FX opcodes. */
export enum ModOpcode {
    // ── Yellow events ──
    WHEN_COIN_HIT = 'WHEN_COIN_HIT',
    WHEN_CUSHION_BOUNCE = 'WHEN_CUSHION_BOUNCE',
    WHEN_POWER_CHARGED = 'WHEN_POWER_CHARGED',
    WHEN_FOUL_TRIGGERED = 'WHEN_FOUL_TRIGGERED',
    WHEN_TIMER_TICK = 'WHEN_TIMER_TICK',
    WHEN_GAME_START = 'WHEN_GAME_START',
    WHEN_SHOT_FIRED = 'WHEN_SHOT_FIRED',
    WHEN_COIN_FALL = 'WHEN_COIN_FALL',

    // ── Blue conditions ──
    IF_VELOCITY_GREATER_THAN = 'IF_VELOCITY_GREATER_THAN',
    IF_COIN_TAG = 'IF_COIN_TAG',
    IF_PROBABILITY = 'IF_PROBABILITY',
    IF_REMAINING_COINS_LESS_THAN = 'IF_REMAINING_COINS_LESS_THAN',
    IF_VAR_GREATER_THAN = 'IF_VAR_GREATER_THAN',
    IF_SHOT_COUNT_LESS_THAN = 'IF_SHOT_COUNT_LESS_THAN',

    // ── Purple actions ──
    APPLY_IMPULSE = 'APPLY_IMPULSE',
    EXPLODE_RADIUS = 'EXPLODE_RADIUS',
    SWAP_POSITIONS = 'SWAP_POSITIONS',
    SET_COIN_POSITION = 'SET_COIN_POSITION',
    SHOW_COIN_POSITION = 'SHOW_COIN_POSITION',
    CHANGE_FRICTION = 'CHANGE_FRICTION',
    TRIGGER_TIME_REVERSE = 'TRIGGER_TIME_REVERSE',
    SET_VARIABLE = 'SET_VARIABLE',
    CHANGE_VARIABLE = 'CHANGE_VARIABLE',
    TAG_COIN = 'TAG_COIN',
    DECLARE_WIN = 'DECLARE_WIN',
    DECLARE_LOSE = 'DECLARE_LOSE',

    // ── Red juice FX (world-space only) ──
    PLAY_MEME_SOUND = 'PLAY_MEME_SOUND',
    SPAWN_WORLD_TEXT = 'SPAWN_WORLD_TEXT',
    APPLY_SQUASH_STRETCH = 'APPLY_SQUASH_STRETCH',
    SCREEN_SHAKE = 'SCREEN_SHAKE',

    // ── Skin hot-swap ──
    SET_COIN_SKIN = 'SET_COIN_SKIN',
    SET_TABLE_SKIN = 'SET_TABLE_SKIN',

    // ── Math ──
    MATH_ADD = 'MATH_ADD',
    MATH_SUBTRACT = 'MATH_SUBTRACT',
    MATH_RANDOM_RANGE = 'MATH_RANDOM_RANGE',
}

export type ModPropValue = string | number | boolean;

export interface ModBlockProp {
    key: string;
    label: string;
    value: ModPropValue;
}

export interface ModBlockDef {
    opcode: ModOpcode;
    kind: ModBlockKind;
    category: ModBlockCategory;
    label: string;
    /** #RRGGBB */
    color: string;
    icon: string;
    /** Allowed categories that may snap under this block. Empty = any stack. */
    accepts?: ModBlockCategory[];
    props?: { key: string; label: string; default: ModPropValue }[];
}

export interface ModVisualBlock {
    id: string;
    opcode: ModOpcode;
    nextId: string | null;
    props: ModBlockProp[];
    x: number;
    y: number;
}

export interface ModBlockGraph {
    blocks: ModVisualBlock[];
    bindCoinId?: string;
}

export enum WinConditionType {
    CLEAR_ALL_COINS = 'CLEAR_ALL_COINS',
    KNOCK_OUT_BOSS_COIN = 'KNOCK_OUT_BOSS_COIN',
    SURVIVE_TIME_LIMIT = 'SURVIVE_TIME_LIMIT',
    REACH_TARGET_SCORE = 'REACH_TARGET_SCORE',
    CUSTOM_EVENT = 'CUSTOM_EVENT',
}

export enum LoseConditionType {
    STRIKER_FALLS_OFF_TABLE = 'STRIKER_FALLS_OFF_TABLE',
    SHOT_LIMIT = 'SHOT_LIMIT',
    TIMER_EXPIRED = 'TIMER_EXPIRED',
    CUSTOM_EVENT = 'CUSTOM_EVENT',
}

export interface WinRule {
    type: WinConditionType;
    /** SURVIVE_TIME_LIMIT seconds / REACH_TARGET_SCORE pts / boss tag */
    value?: number | string;
}

export interface LoseRule {
    type: LoseConditionType;
    value?: number | string;
}

export interface GlobalPhysicsRules {
    /** 0 = ice, ~0.8 sticky */
    tableFriction: number;
    restitutionScale: number;
    enableTimeReversePenalty: boolean;
    aimPowerScale: number;
}

export interface ModVariableDef {
    name: string;
    initial: number;
}

/** Compiled runtime rule: one event hat + linear stack. */
export interface ModRulePipeline {
    id: string;
    event: ModOpcode;
    /** Ordered opcodes after the hat (conditions short-circuit). */
    steps: {
        opcode: ModOpcode;
        props: Record<string, ModPropValue>;
    }[];
}

/** Level layout packed inside a mod (Scratch level editor → LevelData). */
export interface ModLevelLayout {
    id: number;
    width: number;
    height: number;
    wall: { thickness: number };
    table?: { felt?: string; wall?: string };
    coins: Array<Record<string, unknown>>;
}

/** Unified mod package — AssetSync / share-string payload. */
export interface ModConfig {
    schemaVersion: 1;
    id: string;
    name: string;
    author?: string;
    version: number;
    hash?: string;
    /** Visual graph kept for re-open in editor. */
    graph: ModBlockGraph;
    /** Flattened pipelines for interpreter. */
    pipelines: ModRulePipeline[];
    win: WinRule[];
    lose: LoseRule[];
    physics: GlobalPhysicsRules;
    variables: ModVariableDef[];
    /** Optional Scratch-authored table layout (same shape as LevelData). */
    level?: ModLevelLayout;
}

export const DEFAULT_PHYSICS: GlobalPhysicsRules = {
    tableFriction: 0.35,
    restitutionScale: 1,
    enableTimeReversePenalty: true,
    aimPowerScale: 1,
};

export const MOD_BLOCK_DEFS: Record<ModOpcode, ModBlockDef> = {
    [ModOpcode.WHEN_COIN_HIT]: {
        opcode: ModOpcode.WHEN_COIN_HIT, kind: ModBlockKind.Hat, category: ModBlockCategory.Event,
        label: 'when coin is hit', color: '#F5D76E', icon: '⚡',
        accepts: [ModBlockCategory.Condition, ModBlockCategory.Action, ModBlockCategory.Fx, ModBlockCategory.Math],
    },
    [ModOpcode.WHEN_CUSHION_BOUNCE]: {
        opcode: ModOpcode.WHEN_CUSHION_BOUNCE, kind: ModBlockKind.Hat, category: ModBlockCategory.Event,
        label: 'when cushion bounce', color: '#F5D76E', icon: '⚡',
        accepts: [ModBlockCategory.Condition, ModBlockCategory.Action, ModBlockCategory.Fx, ModBlockCategory.Math],
    },
    [ModOpcode.WHEN_POWER_CHARGED]: {
        opcode: ModOpcode.WHEN_POWER_CHARGED, kind: ModBlockKind.Hat, category: ModBlockCategory.Event,
        label: 'when power charged > X%', color: '#F5D76E', icon: '⚡',
        props: [{ key: 'percent', label: '%', default: 70 }],
        accepts: [ModBlockCategory.Condition, ModBlockCategory.Action, ModBlockCategory.Fx, ModBlockCategory.Math],
    },
    [ModOpcode.WHEN_FOUL_TRIGGERED]: {
        opcode: ModOpcode.WHEN_FOUL_TRIGGERED, kind: ModBlockKind.Hat, category: ModBlockCategory.Event,
        label: 'when foul triggered', color: '#F5D76E', icon: '⚡',
        accepts: [ModBlockCategory.Condition, ModBlockCategory.Action, ModBlockCategory.Fx, ModBlockCategory.Math],
    },
    [ModOpcode.WHEN_TIMER_TICK]: {
        opcode: ModOpcode.WHEN_TIMER_TICK, kind: ModBlockKind.Hat, category: ModBlockCategory.Event,
        label: 'when timer ticks', color: '#F5D76E', icon: '⏱',
        props: [{ key: 'interval', label: 'sec', default: 1 }],
        accepts: [ModBlockCategory.Condition, ModBlockCategory.Action, ModBlockCategory.Fx, ModBlockCategory.Math],
    },
    [ModOpcode.WHEN_GAME_START]: {
        opcode: ModOpcode.WHEN_GAME_START, kind: ModBlockKind.Hat, category: ModBlockCategory.Event,
        label: 'when game starts', color: '#F5D76E', icon: '▶',
        accepts: [ModBlockCategory.Condition, ModBlockCategory.Action, ModBlockCategory.Fx, ModBlockCategory.Math],
    },
    [ModOpcode.WHEN_SHOT_FIRED]: {
        opcode: ModOpcode.WHEN_SHOT_FIRED, kind: ModBlockKind.Hat, category: ModBlockCategory.Event,
        label: 'when shot fired', color: '#F5D76E', icon: '🎯',
        accepts: [ModBlockCategory.Condition, ModBlockCategory.Action, ModBlockCategory.Fx, ModBlockCategory.Math],
    },
    [ModOpcode.WHEN_COIN_FALL]: {
        opcode: ModOpcode.WHEN_COIN_FALL, kind: ModBlockKind.Hat, category: ModBlockCategory.Event,
        label: 'when coin falls', color: '#F5D76E', icon: '⬇',
        accepts: [ModBlockCategory.Condition, ModBlockCategory.Action, ModBlockCategory.Fx, ModBlockCategory.Math],
    },

    [ModOpcode.IF_VELOCITY_GREATER_THAN]: {
        opcode: ModOpcode.IF_VELOCITY_GREATER_THAN, kind: ModBlockKind.Stack, category: ModBlockCategory.Condition,
        label: 'if velocity >', color: '#4FC3F7', icon: '◆',
        props: [{ key: 'value', label: 'vel', default: 200 }],
        accepts: [ModBlockCategory.Condition, ModBlockCategory.Action, ModBlockCategory.Fx, ModBlockCategory.Math],
    },
    [ModOpcode.IF_COIN_TAG]: {
        opcode: ModOpcode.IF_COIN_TAG, kind: ModBlockKind.Stack, category: ModBlockCategory.Condition,
        label: 'if coin has tag', color: '#4FC3F7', icon: '◆',
        props: [{ key: 'tag', label: 'tag', default: 'boss' }],
        accepts: [ModBlockCategory.Condition, ModBlockCategory.Action, ModBlockCategory.Fx, ModBlockCategory.Math],
    },
    [ModOpcode.IF_PROBABILITY]: {
        opcode: ModOpcode.IF_PROBABILITY, kind: ModBlockKind.Stack, category: ModBlockCategory.Condition,
        label: 'if chance %', color: '#4FC3F7', icon: '◆',
        props: [{ key: 'percent', label: '%', default: 50 }],
        accepts: [ModBlockCategory.Condition, ModBlockCategory.Action, ModBlockCategory.Fx, ModBlockCategory.Math],
    },
    [ModOpcode.IF_REMAINING_COINS_LESS_THAN]: {
        opcode: ModOpcode.IF_REMAINING_COINS_LESS_THAN, kind: ModBlockKind.Stack, category: ModBlockCategory.Condition,
        label: 'if coins left <', color: '#4FC3F7', icon: '◆',
        props: [{ key: 'count', label: 'n', default: 3 }],
        accepts: [ModBlockCategory.Condition, ModBlockCategory.Action, ModBlockCategory.Fx, ModBlockCategory.Math],
    },
    [ModOpcode.IF_VAR_GREATER_THAN]: {
        opcode: ModOpcode.IF_VAR_GREATER_THAN, kind: ModBlockKind.Stack, category: ModBlockCategory.Condition,
        label: 'if var >', color: '#4FC3F7', icon: '◆',
        props: [
            { key: 'name', label: 'var', default: 'KarmaPoints' },
            { key: 'value', label: 'val', default: 10 },
        ],
        accepts: [ModBlockCategory.Condition, ModBlockCategory.Action, ModBlockCategory.Fx, ModBlockCategory.Math],
    },
    [ModOpcode.IF_SHOT_COUNT_LESS_THAN]: {
        opcode: ModOpcode.IF_SHOT_COUNT_LESS_THAN, kind: ModBlockKind.Stack, category: ModBlockCategory.Condition,
        label: 'if shots <', color: '#4FC3F7', icon: '◆',
        props: [{ key: 'count', label: 'n', default: 5 }],
        accepts: [ModBlockCategory.Condition, ModBlockCategory.Action, ModBlockCategory.Fx, ModBlockCategory.Math],
    },

    [ModOpcode.APPLY_IMPULSE]: {
        opcode: ModOpcode.APPLY_IMPULSE, kind: ModBlockKind.Stack, category: ModBlockCategory.Action,
        label: 'apply impulse', color: '#AB47BC', icon: '➤',
        props: [
            { key: 'x', label: 'x', default: 0 },
            { key: 'y', label: 'y', default: 400 },
        ],
    },
    [ModOpcode.EXPLODE_RADIUS]: {
        opcode: ModOpcode.EXPLODE_RADIUS, kind: ModBlockKind.Stack, category: ModBlockCategory.Action,
        label: 'explode radius', color: '#AB47BC', icon: '💥',
        props: [
            { key: 'force', label: 'force', default: 800 },
            { key: 'radius', label: 'r', default: 120 },
        ],
    },
    [ModOpcode.SWAP_POSITIONS]: {
        opcode: ModOpcode.SWAP_POSITIONS, kind: ModBlockKind.Stack, category: ModBlockCategory.Action,
        label: 'swap positions', color: '#AB47BC', icon: '⇄',
    },
    [ModOpcode.SET_COIN_POSITION]: {
        opcode: ModOpcode.SET_COIN_POSITION, kind: ModBlockKind.Stack, category: ModBlockCategory.Action,
        label: 'set coin position', color: '#AB47BC', icon: '📍',
        props: [
            { key: 'x', label: 'x', default: 0 },
            { key: 'y', label: 'y', default: 0 },
        ],
    },
    [ModOpcode.SHOW_COIN_POSITION]: {
        opcode: ModOpcode.SHOW_COIN_POSITION, kind: ModBlockKind.Stack, category: ModBlockCategory.Fx,
        label: 'show coin position', color: '#EC407A', icon: '💬',
        props: [{ key: 'color', label: 'color', default: '#80DEEA' }],
    },
    [ModOpcode.CHANGE_FRICTION]: {
        opcode: ModOpcode.CHANGE_FRICTION, kind: ModBlockKind.Stack, category: ModBlockCategory.Action,
        label: 'change friction', color: '#AB47BC', icon: '🧊',
        props: [{ key: 'value', label: 'μ', default: 0.1 }],
    },
    [ModOpcode.TRIGGER_TIME_REVERSE]: {
        opcode: ModOpcode.TRIGGER_TIME_REVERSE, kind: ModBlockKind.Stack, category: ModBlockCategory.Action,
        label: 'trigger time reverse', color: '#AB47BC', icon: '⏪',
    },
    [ModOpcode.SET_VARIABLE]: {
        opcode: ModOpcode.SET_VARIABLE, kind: ModBlockKind.Stack, category: ModBlockCategory.Action,
        label: 'set variable', color: '#AB47BC', icon: '=',
        props: [
            { key: 'name', label: 'var', default: 'KarmaPoints' },
            { key: 'value', label: 'val', default: 0 },
        ],
    },
    [ModOpcode.CHANGE_VARIABLE]: {
        opcode: ModOpcode.CHANGE_VARIABLE, kind: ModBlockKind.Stack, category: ModBlockCategory.Action,
        label: 'change variable by', color: '#AB47BC', icon: '±',
        props: [
            { key: 'name', label: 'var', default: 'KarmaPoints' },
            { key: 'delta', label: 'Δ', default: 1 },
        ],
    },
    [ModOpcode.TAG_COIN]: {
        opcode: ModOpcode.TAG_COIN, kind: ModBlockKind.Stack, category: ModBlockCategory.Action,
        label: 'tag coin', color: '#AB47BC', icon: '🏷',
        props: [{ key: 'tag', label: 'tag', default: 'boss' }],
    },
    [ModOpcode.DECLARE_WIN]: {
        opcode: ModOpcode.DECLARE_WIN, kind: ModBlockKind.Cap, category: ModBlockCategory.Action,
        label: 'declare WIN', color: '#66BB6A', icon: '🏆',
        props: [{ key: 'reason', label: 'why', default: 'custom' }],
        accepts: [],
    },
    [ModOpcode.DECLARE_LOSE]: {
        opcode: ModOpcode.DECLARE_LOSE, kind: ModBlockKind.Cap, category: ModBlockCategory.Action,
        label: 'declare LOSE', color: '#EF5350', icon: '💀',
        props: [{ key: 'reason', label: 'why', default: 'custom' }],
        accepts: [],
    },

    [ModOpcode.PLAY_MEME_SOUND]: {
        opcode: ModOpcode.PLAY_MEME_SOUND, kind: ModBlockKind.Stack, category: ModBlockCategory.Fx,
        label: 'play meme sound', color: '#EC407A', icon: '🔊',
        props: [
            { key: 'sfxId', label: 'id', default: 'shot' },
            { key: 'pitch', label: 'pitch', default: 1 },
        ],
    },
    [ModOpcode.SPAWN_WORLD_TEXT]: {
        opcode: ModOpcode.SPAWN_WORLD_TEXT, kind: ModBlockKind.Stack, category: ModBlockCategory.Fx,
        label: 'spawn world text', color: '#EC407A', icon: '💬',
        props: [
            { key: 'text', label: 'text', default: 'BONK!' },
            { key: 'color', label: 'color', default: '#FFE082' },
        ],
    },
    [ModOpcode.APPLY_SQUASH_STRETCH]: {
        opcode: ModOpcode.APPLY_SQUASH_STRETCH, kind: ModBlockKind.Stack, category: ModBlockCategory.Fx,
        label: 'squash / stretch', color: '#EC407A', icon: '🫧',
        props: [
            { key: 'sx', label: 'sx', default: 1.35 },
            { key: 'sy', label: 'sy', default: 0.7 },
        ],
    },
    [ModOpcode.SCREEN_SHAKE]: {
        opcode: ModOpcode.SCREEN_SHAKE, kind: ModBlockKind.Stack, category: ModBlockCategory.Fx,
        label: 'screen shake', color: '#EC407A', icon: '📳',
        props: [
            { key: 'intensity', label: 'amp', default: 0.12 },
            { key: 'duration', label: 'sec', default: 0.2 },
        ],
    },
    [ModOpcode.SET_COIN_SKIN]: {
        opcode: ModOpcode.SET_COIN_SKIN, kind: ModBlockKind.Stack, category: ModBlockCategory.Fx,
        label: 'set coin skin', color: '#EC407A', icon: '🎨',
        props: [
            { key: 'preset', label: 'preset', default: 'gold' },
            { key: 'url', label: 'url/base64', default: '' },
        ],
    },
    [ModOpcode.SET_TABLE_SKIN]: {
        opcode: ModOpcode.SET_TABLE_SKIN, kind: ModBlockKind.Stack, category: ModBlockCategory.Fx,
        label: 'set table skin', color: '#EC407A', icon: '🪵',
        props: [
            { key: 'felt', label: 'felt', default: 'table_1' },
            { key: 'wall', label: 'wall', default: 'wall_1' },
        ],
    },

    [ModOpcode.MATH_ADD]: {
        opcode: ModOpcode.MATH_ADD, kind: ModBlockKind.Stack, category: ModBlockCategory.Math,
        label: 'add to var', color: '#26A69A', icon: '+',
        props: [
            { key: 'name', label: 'var', default: 'KarmaPoints' },
            { key: 'value', label: 'val', default: 1 },
        ],
    },
    [ModOpcode.MATH_SUBTRACT]: {
        opcode: ModOpcode.MATH_SUBTRACT, kind: ModBlockKind.Stack, category: ModBlockCategory.Math,
        label: 'subtract from var', color: '#26A69A', icon: '−',
        props: [
            { key: 'name', label: 'var', default: 'KarmaPoints' },
            { key: 'value', label: 'val', default: 1 },
        ],
    },
    [ModOpcode.MATH_RANDOM_RANGE]: {
        opcode: ModOpcode.MATH_RANDOM_RANGE, kind: ModBlockKind.Stack, category: ModBlockCategory.Math,
        label: 'random → var', color: '#26A69A', icon: '🎲',
        props: [
            { key: 'name', label: 'var', default: 'ExplosionPower' },
            { key: 'min', label: 'min', default: 1 },
            { key: 'max', label: 'max', default: 100 },
        ],
    },
};

export function createModBlock(opcode: ModOpcode, x: number, y: number): ModVisualBlock {
    const def = MOD_BLOCK_DEFS[opcode];
    return {
        id: `b_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`,
        opcode,
        nextId: null,
        props: (def.props ?? []).map((p) => ({ key: p.key, label: p.label, value: p.default })),
        x,
        y,
    };
}

export function canSnap(parentOp: ModOpcode, childOp: ModOpcode): boolean {
    const parent = MOD_BLOCK_DEFS[parentOp];
    const child = MOD_BLOCK_DEFS[childOp];
    if (child.kind === ModBlockKind.Hat) return false;
    if (parent.kind === ModBlockKind.Cap) return false;
    if (parent.accepts && parent.accepts.length === 0) return false;
    if (parent.accepts && parent.accepts.length > 0 && !parent.accepts.includes(child.category)) {
        return false;
    }
    return true;
}

export function walkModStack(graph: ModBlockGraph, rootId: string): ModVisualBlock[] {
    const byId = new Map(graph.blocks.map((b) => [b.id, b]));
    const out: ModVisualBlock[] = [];
    let cur = byId.get(rootId);
    const seen = new Set<string>();
    while (cur && !seen.has(cur.id)) {
        seen.add(cur.id);
        out.push(cur);
        cur = cur.nextId ? byId.get(cur.nextId) : undefined;
    }
    return out;
}

export function findModHatRoots(graph: ModBlockGraph): ModVisualBlock[] {
    const pointed = new Set<string>();
    for (const b of graph.blocks) {
        if (b.nextId) pointed.add(b.nextId);
    }
    return graph.blocks.filter((b) => MOD_BLOCK_DEFS[b.opcode].kind === ModBlockKind.Hat && !pointed.has(b.id));
}

export function propsToMap(props: ModBlockProp[]): Record<string, ModPropValue> {
    const out: Record<string, ModPropValue> = {};
    for (const p of props) out[p.key] = p.value;
    return out;
}
