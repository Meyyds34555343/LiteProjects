/**
 * Scratch 風格積木資料。只給關卡／Meme 編輯器用。
 * 執行期場景只吃編譯後的 LevelConfig / MemeConfig JSON，不解析積木樹。
 */

export enum BlockKind {
    Hat = 'hat',
    Stack = 'stack',
}

export enum BlockCategory {
    Event = 'event',
    Action = 'action',
    Effect = 'effect',
}

/** Hat：事件觸發。Stack：動作／特效。 */
export enum BlockOpcode {
    // ── Yellow events ──
    WHEN_GAME_START = 'WHEN_GAME_START',
    WHEN_COIN_HIT = 'WHEN_COIN_HIT',
    WHEN_NEAR_TABLE_EDGE = 'WHEN_NEAR_TABLE_EDGE',
    WHEN_COLLIDE_WITH_PROPS = 'WHEN_COLLIDE_WITH_PROPS',
    // ── Blue actions ──
    EXPLODE_BARREL = 'EXPLODE_BARREL',
    TRIGGER_TIME_REVERSE = 'TRIGGER_TIME_REVERSE',
    SWAP_COIN_POSITIONS = 'SWAP_COIN_POSITIONS',
    APPLY_STICKY_GLUE = 'APPLY_STICKY_GLUE',
    // ── Purple effects ──
    PLAY_SOUND_EFFECT = 'PLAY_SOUND_EFFECT',
    SPAWN_PARTICLES = 'SPAWN_PARTICLES',
    WORLD_POPUP = 'WORLD_POPUP',
}

export interface BlockProperty {
    key: string;
    label: string;
    value: string | number | boolean;
}

export interface BlockDef {
    opcode: BlockOpcode;
    kind: BlockKind;
    category: BlockCategory;
    label: string;
    /** 編譯進 CoinConfig.behaviors 的執行期 id；特效類可為 null */
    behaviorId: string | null;
    /** #RRGGBB 顯示色 */
    color: string;
}

export interface VisualBlockData {
    id: string;
    opcode: BlockOpcode;
    /** 下一個串接的 stack（由上往下） */
    nextId: string | null;
    props: BlockProperty[];
    /** 編輯器座標（工作區本地） */
    x: number;
    y: number;
}

export interface BlockGraph {
    blocks: VisualBlockData[];
    /** 掛在哪個預覽硬幣上；空＝關卡全域／Meme 腳本 */
    bindCoinId?: string;
}

export const BLOCK_DEFS: Record<BlockOpcode, BlockDef> = {
    [BlockOpcode.WHEN_GAME_START]: {
        opcode: BlockOpcode.WHEN_GAME_START,
        kind: BlockKind.Hat,
        category: BlockCategory.Event,
        label: 'when game starts',
        behaviorId: null,
        color: '#F5D76E',
    },
    [BlockOpcode.WHEN_COIN_HIT]: {
        opcode: BlockOpcode.WHEN_COIN_HIT,
        kind: BlockKind.Hat,
        category: BlockCategory.Event,
        label: 'when coin is hit',
        behaviorId: null,
        color: '#F5D76E',
    },
    [BlockOpcode.WHEN_NEAR_TABLE_EDGE]: {
        opcode: BlockOpcode.WHEN_NEAR_TABLE_EDGE,
        kind: BlockKind.Hat,
        category: BlockCategory.Event,
        label: 'when near table edge',
        behaviorId: null,
        color: '#F5D76E',
    },
    [BlockOpcode.WHEN_COLLIDE_WITH_PROPS]: {
        opcode: BlockOpcode.WHEN_COLLIDE_WITH_PROPS,
        kind: BlockKind.Hat,
        category: BlockCategory.Event,
        label: 'when collide with props',
        behaviorId: null,
        color: '#F5D76E',
    },
    [BlockOpcode.EXPLODE_BARREL]: {
        opcode: BlockOpcode.EXPLODE_BARREL,
        kind: BlockKind.Stack,
        category: BlockCategory.Action,
        label: 'explode barrel',
        behaviorId: 'BombBehavior',
        color: '#4FC3F7',
    },
    [BlockOpcode.TRIGGER_TIME_REVERSE]: {
        opcode: BlockOpcode.TRIGGER_TIME_REVERSE,
        kind: BlockKind.Stack,
        category: BlockCategory.Action,
        label: 'trigger time reverse',
        behaviorId: 'TimeReverse',
        color: '#4FC3F7',
    },
    [BlockOpcode.SWAP_COIN_POSITIONS]: {
        opcode: BlockOpcode.SWAP_COIN_POSITIONS,
        kind: BlockKind.Stack,
        category: BlockCategory.Action,
        label: 'swap coin positions',
        behaviorId: 'SwapPositions',
        color: '#4FC3F7',
    },
    [BlockOpcode.APPLY_STICKY_GLUE]: {
        opcode: BlockOpcode.APPLY_STICKY_GLUE,
        kind: BlockKind.Stack,
        category: BlockCategory.Action,
        label: 'apply sticky glue',
        behaviorId: 'FreezeBehavior',
        color: '#4FC3F7',
    },
    [BlockOpcode.PLAY_SOUND_EFFECT]: {
        opcode: BlockOpcode.PLAY_SOUND_EFFECT,
        kind: BlockKind.Stack,
        category: BlockCategory.Effect,
        label: 'play sound effect',
        behaviorId: null,
        color: '#BA68C8',
    },
    [BlockOpcode.SPAWN_PARTICLES]: {
        opcode: BlockOpcode.SPAWN_PARTICLES,
        kind: BlockKind.Stack,
        category: BlockCategory.Effect,
        label: 'spawn particles',
        behaviorId: null,
        color: '#BA68C8',
    },
    [BlockOpcode.WORLD_POPUP]: {
        opcode: BlockOpcode.WORLD_POPUP,
        kind: BlockKind.Stack,
        category: BlockCategory.Effect,
        label: 'world popup text',
        behaviorId: null,
        color: '#BA68C8',
    },
};

export function createBlockData(opcode: BlockOpcode, x: number, y: number): VisualBlockData {
    return {
        id: `blk_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e5).toString(36)}`,
        opcode,
        nextId: null,
        props: defaultProps(opcode),
        x,
        y,
    };
}

function defaultProps(opcode: BlockOpcode): BlockProperty[] {
    if (opcode === BlockOpcode.PLAY_SOUND_EFFECT) {
        return [{ key: 'clip', label: 'clip', value: 'sounds/coin_1_hitted.wav' }];
    }
    if (opcode === BlockOpcode.WORLD_POPUP) {
        return [{ key: 'text', label: 'text', value: 'BONK!' }];
    }
    return [];
}

/** 由上往下走 nextId，回傳 stack 上的 opcode 列表（含 hat）。 */
export function walkStack(graph: BlockGraph, rootId: string): VisualBlockData[] {
    const byId = new Map(graph.blocks.map((b) => [b.id, b]));
    const out: VisualBlockData[] = [];
    let cur = byId.get(rootId) ?? null;
    const seen = new Set<string>();
    while (cur && !seen.has(cur.id)) {
        seen.add(cur.id);
        out.push(cur);
        cur = cur.nextId ? byId.get(cur.nextId) ?? null : null;
    }
    return out;
}

/** 所有沒被別人 next 指到的 hat，視為腳本起點。 */
export function findHatRoots(graph: BlockGraph): VisualBlockData[] {
    const pointed = new Set(graph.blocks.map((b) => b.nextId).filter(Boolean) as string[]);
    return graph.blocks.filter((b) => BLOCK_DEFS[b.opcode].kind === BlockKind.Hat && !pointed.has(b.id));
}
