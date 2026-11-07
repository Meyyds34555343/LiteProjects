/**
 * Blockly → ModConfigSchema JSON generator.
 * Walks hat→stack chains + config/level blocks into pipelines / win / lose / physics / level.
 */

import { ModCompiler, ModRulePipelineEx } from '../ModCompiler';
import {
    DEFAULT_PHYSICS,
    GlobalPhysicsRules,
    LoseConditionType,
    LoseRule,
    ModBlockGraph,
    ModConfig,
    ModLevelLayout,
    ModPropValue,
    ModRulePipeline,
    ModVariableDef,
    ModVisualBlock,
    WinConditionType,
    WinRule,
} from '../ModConfigSchema';
import { BLOCKLY_TYPE_TO_OPCODE } from './BlocklyDefinitions';

export interface GenerateOptions {
    id?: string;
    name?: string;
    author?: string;
}

/** Field map: Blockly field name → ModConfig prop key */
const FIELD_MAP: Record<string, Record<string, string>> = {
    when_power_charged: { PERCENT: 'percent' },
    when_timer_tick: { INTERVAL: 'interval' },
    if_velocity_gt: { VALUE: 'value' },
    if_coin_tag: { TAG: 'tag' },
    if_probability: { PERCENT: 'percent' },
    if_coins_left_lt: { COUNT: 'count' },
    if_var_gt: { NAME: 'name', VALUE: 'value' },
    apply_impulse: { X: 'x', Y: 'y' },
    explode_radius: { FORCE: 'force', RADIUS: 'radius' },
    set_coin_position: { X: 'x', Y: 'y' },
    show_coin_position: { COLOR: 'color' },
    change_friction: { VALUE: 'value' },
    set_variable: { NAME: 'name', VALUE: 'value' },
    change_variable: { NAME: 'name', DELTA: 'delta' },
    tag_coin: { TAG: 'tag' },
    declare_win: { REASON: 'reason' },
    declare_lose: { REASON: 'reason' },
    play_meme_sound: { SFX: 'sfxId', PITCH: 'pitch' },
    spawn_world_text: { TEXT: 'text', COLOR: 'color' },
    apply_squash_stretch: { SX: 'sx', SY: 'sy' },
    screen_shake: { INTENSITY: 'intensity', DURATION: 'duration' },
    set_coin_skin: { PRESET: 'preset', URL: 'url' },
    set_table_skin: { FELT: 'felt', WALL: 'wall' },
    math_add: { NAME: 'name', VALUE: 'value' },
    math_sub: { NAME: 'name', VALUE: 'value' },
    math_random: { NAME: 'name', MIN: 'min', MAX: 'max' },
};

const EVENT_TYPES = new Set([
    'when_coin_hit',
    'when_cushion_bounce',
    'when_power_charged',
    'when_foul_triggered',
    'when_timer_tick',
    'when_game_start',
    'when_shot_fired',
]);

interface LevelDraft {
    id: number;
    width: number;
    height: number;
    wall: number;
    felt?: string;
    wallSkin?: string;
    coins: Array<Record<string, unknown>>;
}

export class BlocklyJsonGenerator {
    /** Primary entry: Blockly workspace → validated ModConfig (+ optional level). */
    public static workspaceToModConfig(
        workspace: Blockly.Workspace,
        opts: GenerateOptions = {},
    ): ModConfig {
        const tops = workspace.getTopBlocks(true);
        const pipelines: ModRulePipeline[] = [];
        const graphBlocks: ModVisualBlock[] = [];
        const win: WinRule[] = [];
        const lose: LoseRule[] = [];
        let physics: GlobalPhysicsRules = { ...DEFAULT_PHYSICS };
        const varNames = new Set<string>(['KarmaPoints', 'ExplosionPower']);
        const levelDraft: LevelDraft = {
            id: 1,
            width: 800,
            height: 600,
            wall: 64,
            coins: [],
        };
        let hasLevelBlocks = false;

        for (const top of tops) {
            if (top.type.startsWith('config_')) {
                this._ingestConfigBlock(top, win, lose, (p) => { physics = p; });
                continue;
            }
            if (top.type.startsWith('level_')) {
                hasLevelBlocks = true;
                this._ingestLevelBlock(top, levelDraft);
                continue;
            }
            if (!EVENT_TYPES.has(top.type)) continue;

            const chain = this._walkStack(top);
            const eventOp = BLOCKLY_TYPE_TO_OPCODE[top.type];
            if (!eventOp) continue;

            const eventProps = this._propsFromBlock(top);
            const steps: ModRulePipeline['steps'] = [];
            let prevId: string | null = null;
            let y = 120;

            for (let i = 0; i < chain.length; i++) {
                const b = chain[i];
                const opcode = BLOCKLY_TYPE_TO_OPCODE[b.type];
                if (!opcode) continue;
                const props = this._propsFromBlock(b);
                const id = b.id || `b_${i}_${Date.now().toString(36)}`;
                const visual: ModVisualBlock = {
                    id,
                    opcode,
                    nextId: null,
                    props: Object.keys(props).map((k) => ({
                        key: k,
                        label: k,
                        value: props[k],
                    })),
                    x: -40,
                    y: y - i * 40,
                };
                if (prevId) {
                    const prev = graphBlocks.find((g) => g.id === prevId);
                    if (prev) prev.nextId = id;
                }
                graphBlocks.push(visual);
                prevId = id;

                if (i === 0) continue;
                steps.push({ opcode, props });
                if (typeof props.name === 'string') varNames.add(props.name);
            }

            const pipe: ModRulePipelineEx = {
                id: top.id || `pipe_${pipelines.length}`,
                event: eventOp,
                steps,
            };
            if (Object.keys(eventProps).length) {
                pipe.eventProps = eventProps as Record<string, string | number | boolean>;
            }
            pipelines.push(pipe);
        }

        if (!win.length) win.push({ type: WinConditionType.CLEAR_ALL_COINS });
        if (!lose.length) lose.push({ type: LoseConditionType.STRIKER_FALLS_OFF_TABLE });

        const variables: ModVariableDef[] = Array.from(varNames).map((name) => ({
            name,
            initial: name === 'ExplosionPower' ? 50 : 0,
        }));

        const level = hasLevelBlocks ? this._finalizeLevel(levelDraft) : undefined;

        const graph: ModBlockGraph = { blocks: graphBlocks };
        const compiled = ModCompiler.compile({
            id: opts.id,
            name: opts.name ?? 'Blockly Mode',
            author: opts.author,
            graph,
            win,
            lose,
            physics,
            variables,
            level,
        });

        if (pipelines.length) compiled.mod.pipelines = pipelines;
        if (level) compiled.mod.level = level;
        return compiled.mod;
    }

    /** Export only the LevelData-compatible JSON (for levels/N.json). */
    public static workspaceToLevelJson(
        workspace: Blockly.Workspace,
        pretty = true,
    ): string {
        const mod = this.workspaceToModConfig(workspace);
        const level = mod.level ?? {
            id: 1,
            width: 800,
            height: 600,
            wall: { thickness: 64 },
            coins: [],
        };
        return pretty ? JSON.stringify(level, null, 2) : JSON.stringify(level);
    }

    public static workspaceToJson(
        workspace: Blockly.Workspace,
        opts: GenerateOptions = {},
    ): string {
        return JSON.stringify(this.workspaceToModConfig(workspace, opts), null, 2);
    }

    public static workspaceToShareCode(
        workspace: Blockly.Workspace,
        opts: GenerateOptions = {},
    ): string {
        const mod = this.workspaceToModConfig(workspace, opts);
        return ModCompiler.toShareCode(mod);
    }

    private static _finalizeLevel(draft: LevelDraft): ModLevelLayout {
        const level: ModLevelLayout = {
            id: draft.id,
            width: draft.width,
            height: draft.height,
            wall: { thickness: draft.wall },
            coins: draft.coins,
        };
        if (draft.felt || draft.wallSkin) {
            level.table = {};
            if (draft.felt) level.table.felt = draft.felt;
            if (draft.wallSkin) level.table.wall = draft.wallSkin;
        }
        return level;
    }

    private static _ingestLevelBlock(block: Blockly.Block, draft: LevelDraft): void {
        switch (block.type) {
            case 'level_setup':
                draft.id = Number(block.getFieldValue('ID') ?? 1);
                draft.width = Number(block.getFieldValue('WIDTH') ?? 800);
                draft.height = Number(block.getFieldValue('HEIGHT') ?? 600);
                draft.wall = Number(block.getFieldValue('WALL') ?? 64);
                break;
            case 'level_table_skin':
                draft.felt = String(block.getFieldValue('FELT') ?? 'table_1');
                draft.wallSkin = String(block.getFieldValue('WALL') ?? 'wall_1');
                break;
            case 'level_place': {
                const kind = String(block.getFieldValue('KIND') ?? 'target');
                const x = Number(block.getFieldValue('X') ?? 0);
                const y = Number(block.getFieldValue('Y') ?? 0);
                const radius = Number(block.getFieldValue('RADIUS') ?? 32);
                const classId = Number(block.getFieldValue('CLASS') ?? 1);
                const skin = String(block.getFieldValue('SKIN') ?? '');
                const url = String(block.getFieldValue('URL') ?? '');
                const meme = String(block.getFieldValue('MEME') ?? '');
                const friction = Number(block.getFieldValue('FRICTION') ?? 0.5);
                draft.coins.push(this._placeToLevelItem(kind, x, y, radius, {
                    classId, skin, url, meme, friction,
                }));
                break;
            }
            default:
                break;
        }
    }

    private static _placeToLevelItem(
        kind: string,
        x: number,
        y: number,
        radius: number,
        extra: { classId: number; skin: string; url: string; meme: string; friction: number },
    ): Record<string, unknown> {
        const cls = extra.classId || 1;
        const skinBits: Record<string, unknown> = {};
        if (extra.skin) skinBits.skinKey = extra.skin;
        if (extra.url) skinBits.skin = { default: extra.url, idle: extra.url };
        if (extra.meme) skinBits.memeId = extra.meme;

        switch (kind) {
            case 'striker':
                return { type: 'coin', class: cls, x, y, canshot: true, radius, ...skinBits };
            case 'target':
                return { type: 'coin', class: cls, x, y, canshot: false, radius, ...skinBits };
            case 'knockback':
                return {
                    type: 'coin', class: cls, x, y, canshot: false, radius,
                    behavior: 'KnockbackBehavior',
                    behaviors: ['KnockbackBehavior'],
                    ...skinBits,
                };
            case 'freeze':
                return {
                    type: 'coin', class: cls, x, y, canshot: false, radius,
                    behavior: 'FreezeBehavior',
                    behaviors: ['FreezeBehavior'],
                    ...skinBits,
                };
            case 'flash':
                return {
                    type: 'coin', class: cls, x, y, canshot: false, radius,
                    behavior: 'FlashStepBehavior',
                    behaviors: ['FlashStepBehavior'],
                    ...skinBits,
                };
            case 'bomb':
                return { type: 'bomb', class: cls, x, y, radius, ...skinBits };
            case 'block':
                return { type: 'block', x, y, shape: 'circle', radius };
            case 'mud':
                return { type: 'mud', x, y, shape: 'circle', radius, friction: extra.friction };
            default:
                return { type: 'coin', class: cls, x, y, canshot: false, radius, ...skinBits };
        }
    }

    private static _walkStack(hat: Blockly.Block): Blockly.Block[] {
        const out: Blockly.Block[] = [hat];
        let cur = hat.getNextBlock();
        let guard = 0;
        while (cur && guard++ < 128) {
            out.push(cur);
            cur = cur.getNextBlock();
        }
        return out;
    }

    private static _propsFromBlock(block: Blockly.Block): Record<string, ModPropValue> {
        const map = FIELD_MAP[block.type] ?? {};
        const out: Record<string, ModPropValue> = {};
        for (const [field, key] of Object.entries(map)) {
            const raw = block.getFieldValue(field);
            if (raw === null || raw === undefined) continue;
            if (typeof raw === 'string' && raw !== '' && !Number.isNaN(Number(raw)) && /^-?\d+(\.\d+)?$/.test(raw)) {
                out[key] = Number(raw);
            } else if (raw === 'true') out[key] = true;
            else if (raw === 'false') out[key] = false;
            else out[key] = raw as ModPropValue;
        }
        return out;
    }

    private static _ingestConfigBlock(
        block: Blockly.Block,
        win: WinRule[],
        lose: LoseRule[],
        setPhysics: (p: GlobalPhysicsRules) => void,
    ): void {
        switch (block.type) {
            case 'config_win_clear_all':
                win.push({ type: WinConditionType.CLEAR_ALL_COINS });
                break;
            case 'config_win_score':
                win.push({
                    type: WinConditionType.REACH_TARGET_SCORE,
                    value: Number(block.getFieldValue('SCORE') ?? 100),
                });
                break;
            case 'config_win_survive':
                win.push({
                    type: WinConditionType.SURVIVE_TIME_LIMIT,
                    value: Number(block.getFieldValue('SEC') ?? 60),
                });
                break;
            case 'config_lose_striker_fall':
                lose.push({ type: LoseConditionType.STRIKER_FALLS_OFF_TABLE });
                break;
            case 'config_lose_shot_limit':
                lose.push({
                    type: LoseConditionType.SHOT_LIMIT,
                    value: Number(block.getFieldValue('COUNT') ?? 10),
                });
                break;
            case 'config_physics':
                setPhysics({
                    tableFriction: Number(block.getFieldValue('FRICTION') ?? 0.35),
                    restitutionScale: Number(block.getFieldValue('RESTITUTION') ?? 1),
                    enableTimeReversePenalty: String(block.getFieldValue('TIME_REVERSE')) !== 'false',
                    aimPowerScale: 1,
                });
                break;
            default:
                break;
        }
    }
}
