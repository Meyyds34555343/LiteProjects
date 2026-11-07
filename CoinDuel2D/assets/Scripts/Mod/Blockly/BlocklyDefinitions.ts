/**
 * Google Blockly block definitions for CoinDuel2D mod scripting.
 * Color-coded toolbox: Events / Conditions / Actions / FX / Skins / Rules.
 * Shape: hat = events, stack = conditions/actions/fx, cap = win/lose.
 */

import { ModOpcode } from '../ModConfigSchema';

export const BLOCKLY_HUE = {
    event: 45,       // yellow
    condition: 195,  // cyan/blue
    action: 290,     // purple
    fx: 330,         // red/pink
    skin: 15,        // orange
    rules: 120,      // green
    level: 210,      // teal — table layout
} as const;

/** Maps Blockly block type → ModOpcode (runtime). */
export const BLOCKLY_TYPE_TO_OPCODE: Record<string, ModOpcode> = {
    when_coin_hit: ModOpcode.WHEN_COIN_HIT,
    when_cushion_bounce: ModOpcode.WHEN_CUSHION_BOUNCE,
    when_power_charged: ModOpcode.WHEN_POWER_CHARGED,
    when_foul_triggered: ModOpcode.WHEN_FOUL_TRIGGERED,
    when_timer_tick: ModOpcode.WHEN_TIMER_TICK,
    when_game_start: ModOpcode.WHEN_GAME_START,
    when_shot_fired: ModOpcode.WHEN_SHOT_FIRED,

    if_velocity_gt: ModOpcode.IF_VELOCITY_GREATER_THAN,
    if_coin_tag: ModOpcode.IF_COIN_TAG,
    if_probability: ModOpcode.IF_PROBABILITY,
    if_coins_left_lt: ModOpcode.IF_REMAINING_COINS_LESS_THAN,
    if_var_gt: ModOpcode.IF_VAR_GREATER_THAN,

    apply_impulse: ModOpcode.APPLY_IMPULSE,
    explode_radius: ModOpcode.EXPLODE_RADIUS,
    swap_positions: ModOpcode.SWAP_POSITIONS,
    set_coin_position: ModOpcode.SET_COIN_POSITION,
    show_coin_position: ModOpcode.SHOW_COIN_POSITION,
    change_friction: ModOpcode.CHANGE_FRICTION,
    trigger_time_reverse: ModOpcode.TRIGGER_TIME_REVERSE,
    set_variable: ModOpcode.SET_VARIABLE,
    change_variable: ModOpcode.CHANGE_VARIABLE,
    tag_coin: ModOpcode.TAG_COIN,
    declare_win: ModOpcode.DECLARE_WIN,
    declare_lose: ModOpcode.DECLARE_LOSE,

    play_meme_sound: ModOpcode.PLAY_MEME_SOUND,
    spawn_world_text: ModOpcode.SPAWN_WORLD_TEXT,
    apply_squash_stretch: ModOpcode.APPLY_SQUASH_STRETCH,
    screen_shake: ModOpcode.SCREEN_SHAKE,

    set_coin_skin: ModOpcode.SET_COIN_SKIN,
    set_table_skin: ModOpcode.SET_TABLE_SKIN,

    math_add: ModOpcode.MATH_ADD,
    math_sub: ModOpcode.MATH_SUBTRACT,
    math_random: ModOpcode.MATH_RANDOM_RANGE,
};

/** Reverse map for share-code → Blockly workspace rebuild. */
export const OPCODE_TO_BLOCKLY_TYPE: Partial<Record<ModOpcode, string>> = (() => {
    const out: Partial<Record<ModOpcode, string>> = {};
    for (const [type, op] of Object.entries(BLOCKLY_TYPE_TO_OPCODE)) {
        out[op] = type;
    }
    return out;
})();

/** JSON definitions passed to Blockly.defineBlocksWithJsonArray */
export function getBlocklyJsonDefinitions(): object[] {
    const H = BLOCKLY_HUE;
    return [
        // ── Events (hats) ──
        {
            type: 'when_coin_hit',
            message0: 'when coin is hit',
            nextStatement: null,
            colour: H.event,
            tooltip: 'Fires when the active shot hits another coin',
        },
        {
            type: 'when_cushion_bounce',
            message0: 'when cushion bounce',
            nextStatement: null,
            colour: H.event,
        },
        {
            type: 'when_power_charged',
            message0: 'when power charged > %1 %%',
            args0: [{ type: 'field_number', name: 'PERCENT', value: 70, min: 0, max: 100 }],
            nextStatement: null,
            colour: H.event,
        },
        {
            type: 'when_foul_triggered',
            message0: 'when foul triggered',
            nextStatement: null,
            colour: H.event,
        },
        {
            type: 'when_timer_tick',
            message0: 'when timer ticks every %1 sec',
            args0: [{ type: 'field_number', name: 'INTERVAL', value: 1, min: 0.1 }],
            nextStatement: null,
            colour: H.event,
        },
        {
            type: 'when_game_start',
            message0: 'when game starts',
            nextStatement: null,
            colour: H.event,
        },
        {
            type: 'when_shot_fired',
            message0: 'when shot fired',
            nextStatement: null,
            colour: H.event,
        },

        // ── Conditions ──
        {
            type: 'if_velocity_gt',
            message0: 'if velocity > %1',
            args0: [{ type: 'field_number', name: 'VALUE', value: 200 }],
            previousStatement: null,
            nextStatement: null,
            colour: H.condition,
        },
        {
            type: 'if_coin_tag',
            message0: 'if coin has tag %1',
            args0: [{ type: 'field_input', name: 'TAG', text: 'boss' }],
            previousStatement: null,
            nextStatement: null,
            colour: H.condition,
        },
        {
            type: 'if_probability',
            message0: 'if chance %1 %%',
            args0: [{ type: 'field_number', name: 'PERCENT', value: 50, min: 0, max: 100 }],
            previousStatement: null,
            nextStatement: null,
            colour: H.condition,
        },
        {
            type: 'if_coins_left_lt',
            message0: 'if coins left < %1',
            args0: [{ type: 'field_number', name: 'COUNT', value: 3, min: 0 }],
            previousStatement: null,
            nextStatement: null,
            colour: H.condition,
        },
        {
            type: 'if_var_gt',
            message0: 'if var %1 > %2',
            args0: [
                { type: 'field_input', name: 'NAME', text: 'KarmaPoints' },
                { type: 'field_number', name: 'VALUE', value: 10 },
            ],
            previousStatement: null,
            nextStatement: null,
            colour: H.condition,
        },

        // ── Actions ──
        {
            type: 'apply_impulse',
            message0: 'apply impulse x %1 y %2',
            args0: [
                { type: 'field_number', name: 'X', value: 0 },
                { type: 'field_number', name: 'Y', value: 400 },
            ],
            previousStatement: null,
            nextStatement: null,
            colour: H.action,
        },
        {
            type: 'explode_radius',
            message0: 'explode force %1 radius %2',
            args0: [
                { type: 'field_number', name: 'FORCE', value: 800 },
                { type: 'field_number', name: 'RADIUS', value: 120 },
            ],
            previousStatement: null,
            nextStatement: null,
            colour: H.action,
        },
        {
            type: 'swap_positions',
            message0: 'swap positions',
            previousStatement: null,
            nextStatement: null,
            colour: H.action,
        },
        {
            type: 'set_coin_position',
            message0: 'set coin position x %1 y %2',
            args0: [
                { type: 'field_number', name: 'X', value: 0 },
                { type: 'field_number', name: 'Y', value: 0 },
            ],
            previousStatement: null,
            nextStatement: null,
            colour: H.action,
            tooltip: 'Teleport the active/hit coin to world x,y and stop velocity',
        },
        {
            type: 'show_coin_position',
            message0: 'show coin position color %1',
            args0: [{ type: 'field_input', name: 'COLOR', text: '#80DEEA' }],
            previousStatement: null,
            nextStatement: null,
            colour: H.fx,
            tooltip: 'Spawn floating text with the coin world coordinates',
        },
        {
            type: 'change_friction',
            message0: 'change friction %1',
            args0: [{ type: 'field_number', name: 'VALUE', value: 0.1, min: 0, max: 1 }],
            previousStatement: null,
            nextStatement: null,
            colour: H.action,
        },
        {
            type: 'trigger_time_reverse',
            message0: 'trigger time reverse',
            previousStatement: null,
            nextStatement: null,
            colour: H.action,
        },
        {
            type: 'set_variable',
            message0: 'set %1 to %2',
            args0: [
                { type: 'field_input', name: 'NAME', text: 'KarmaPoints' },
                { type: 'field_number', name: 'VALUE', value: 0 },
            ],
            previousStatement: null,
            nextStatement: null,
            colour: H.action,
        },
        {
            type: 'change_variable',
            message0: 'change %1 by %2',
            args0: [
                { type: 'field_input', name: 'NAME', text: 'KarmaPoints' },
                { type: 'field_number', name: 'DELTA', value: 1 },
            ],
            previousStatement: null,
            nextStatement: null,
            colour: H.action,
        },
        {
            type: 'tag_coin',
            message0: 'tag coin %1',
            args0: [{ type: 'field_input', name: 'TAG', text: 'boss' }],
            previousStatement: null,
            nextStatement: null,
            colour: H.action,
        },
        {
            type: 'declare_win',
            message0: 'declare WIN %1',
            args0: [{ type: 'field_input', name: 'REASON', text: 'custom' }],
            previousStatement: null,
            colour: H.rules,
        },
        {
            type: 'declare_lose',
            message0: 'declare LOSE %1',
            args0: [{ type: 'field_input', name: 'REASON', text: 'custom' }],
            previousStatement: null,
            colour: 0,
        },

        // ── FX ──
        {
            type: 'play_meme_sound',
            message0: 'play sound %1 pitch %2',
            args0: [
                { type: 'field_input', name: 'SFX', text: 'shot' },
                { type: 'field_number', name: 'PITCH', value: 1, min: 0.5, max: 2.4 },
            ],
            previousStatement: null,
            nextStatement: null,
            colour: H.fx,
        },
        {
            type: 'spawn_world_text',
            message0: 'world text %1 color %2',
            args0: [
                { type: 'field_input', name: 'TEXT', text: 'BONK!' },
                { type: 'field_input', name: 'COLOR', text: '#FFE082' },
            ],
            previousStatement: null,
            nextStatement: null,
            colour: H.fx,
        },
        {
            type: 'apply_squash_stretch',
            message0: 'squash sx %1 sy %2',
            args0: [
                { type: 'field_number', name: 'SX', value: 1.35 },
                { type: 'field_number', name: 'SY', value: 0.7 },
            ],
            previousStatement: null,
            nextStatement: null,
            colour: H.fx,
        },
        {
            type: 'screen_shake',
            message0: 'screen shake %1 for %2 s',
            args0: [
                { type: 'field_number', name: 'INTENSITY', value: 0.12 },
                { type: 'field_number', name: 'DURATION', value: 0.2 },
            ],
            previousStatement: null,
            nextStatement: null,
            colour: H.fx,
        },

        // ── Skins ──
        {
            type: 'set_coin_skin',
            message0: 'set coin skin preset %1 url/base64 %2',
            args0: [
                {
                    type: 'field_dropdown',
                    name: 'PRESET',
                    options: [
                        ['gold', 'gold'],
                        ['silver', 'silver'],
                        ['copper', 'copper'],
                        ['ice', 'ice'],
                        ['coin_1', 'coin_1'],
                        ['coin_2', 'coin_2'],
                        ['(none)', ''],
                    ],
                },
                { type: 'field_input', name: 'URL', text: '' },
            ],
            previousStatement: null,
            nextStatement: null,
            colour: H.skin,
            tooltip: 'Hot-swap SpriteFrame via preset key, https URL, or data:image Base64',
        },
        {
            type: 'set_table_skin',
            message0: 'set table felt %1 wall %2',
            args0: [
                {
                    type: 'field_dropdown',
                    name: 'FELT',
                    options: [
                        ['table_1', 'table_1'],
                        ['board', 'board'],
                        ['board1', 'board1'],
                        ['board2', 'board2'],
                        ['bg1', 'bg1'],
                    ],
                },
                {
                    type: 'field_dropdown',
                    name: 'WALL',
                    options: [
                        ['wall_1', 'wall_1'],
                        ['table_wall', 'table_wall'],
                    ],
                },
            ],
            previousStatement: null,
            nextStatement: null,
            colour: H.skin,
        },

        // ── Math ──
        {
            type: 'math_add',
            message0: 'add %2 to %1',
            args0: [
                { type: 'field_input', name: 'NAME', text: 'KarmaPoints' },
                { type: 'field_number', name: 'VALUE', value: 1 },
            ],
            previousStatement: null,
            nextStatement: null,
            colour: H.rules,
        },
        {
            type: 'math_sub',
            message0: 'subtract %2 from %1',
            args0: [
                { type: 'field_input', name: 'NAME', text: 'KarmaPoints' },
                { type: 'field_number', name: 'VALUE', value: 1 },
            ],
            previousStatement: null,
            nextStatement: null,
            colour: H.rules,
        },
        {
            type: 'math_random',
            message0: 'random %2..%3 → %1',
            args0: [
                { type: 'field_input', name: 'NAME', text: 'ExplosionPower' },
                { type: 'field_number', name: 'MIN', value: 1 },
                { type: 'field_number', name: 'MAX', value: 100 },
            ],
            previousStatement: null,
            nextStatement: null,
            colour: H.rules,
        },

        // ── Global rules (config hats — compiled into ModConfig.win/lose/physics) ──
        {
            type: 'config_win_clear_all',
            message0: 'WIN rule: clear all coins',
            colour: H.rules,
            tooltip: 'Adds CLEAR_ALL_COINS win condition',
        },
        {
            type: 'config_win_score',
            message0: 'WIN rule: reach score %1',
            args0: [{ type: 'field_number', name: 'SCORE', value: 100 }],
            colour: H.rules,
        },
        {
            type: 'config_win_survive',
            message0: 'WIN rule: survive %1 sec',
            args0: [{ type: 'field_number', name: 'SEC', value: 60 }],
            colour: H.rules,
        },
        {
            type: 'config_lose_striker_fall',
            message0: 'LOSE rule: striker falls off table',
            colour: 0,
        },
        {
            type: 'config_lose_shot_limit',
            message0: 'LOSE rule: shot limit %1',
            args0: [{ type: 'field_number', name: 'COUNT', value: 10 }],
            colour: 0,
        },
        {
            type: 'config_physics',
            message0: 'physics friction %1 restitution %2 time-reverse %3',
            args0: [
                { type: 'field_number', name: 'FRICTION', value: 0.35, min: 0, max: 1 },
                { type: 'field_number', name: 'RESTITUTION', value: 1, min: 0, max: 2 },
                {
                    type: 'field_dropdown',
                    name: 'TIME_REVERSE',
                    options: [
                        ['ON', 'true'],
                        ['OFF', 'false'],
                    ],
                },
            ],
            colour: H.rules,
        },

        // ── Level layout (Scratch = Level Editor) ──
        {
            type: 'level_setup',
            message0: 'level id %1 size %2 x %3 wall %4',
            args0: [
                { type: 'field_number', name: 'ID', value: 1, min: 1 },
                { type: 'field_number', name: 'WIDTH', value: 800, min: 200 },
                { type: 'field_number', name: 'HEIGHT', value: 600, min: 200 },
                { type: 'field_number', name: 'WALL', value: 64, min: 8 },
            ],
            colour: H.level,
            tooltip: 'Table size — same as Cocos Level Editor',
        },
        {
            type: 'level_place',
            message0: 'place %1 at x %2 y %3 r %4 class %5 skin %6 url %7 meme %8 mudμ %9',
            args0: [
                {
                    type: 'field_dropdown',
                    name: 'KIND',
                    options: [
                        ['出手币 striker', 'striker'],
                        ['目标币 target', 'target'],
                        ['击退 knockback', 'knockback'],
                        ['冰冻 freeze', 'freeze'],
                        ['闪身 flash', 'flash'],
                        ['炸弹 bomb', 'bomb'],
                        ['障碍 block', 'block'],
                        ['泥地 mud', 'mud'],
                    ],
                },
                { type: 'field_number', name: 'X', value: 0 },
                { type: 'field_number', name: 'Y', value: 0 },
                { type: 'field_number', name: 'RADIUS', value: 32, min: 8 },
                { type: 'field_number', name: 'CLASS', value: 1, min: 1, max: 20 },
                {
                    type: 'field_dropdown',
                    name: 'SKIN',
                    options: [
                        ['(none)', ''],
                        ['gold', 'gold'],
                        ['silver', 'silver'],
                        ['copper', 'copper'],
                        ['ice', 'ice'],
                        ['coin_1', 'coin_1'],
                        ['coin_2', 'coin_2'],
                    ],
                },
                { type: 'field_input', name: 'URL', text: '' },
                { type: 'field_input', name: 'MEME', text: '' },
                { type: 'field_number', name: 'FRICTION', value: 0.5, min: 0, max: 1 },
            ],
            colour: H.level,
            tooltip: 'Full Level Editor place: kind, size, class, skin, meme, mud friction',
        },
        {
            type: 'level_table_skin',
            message0: 'level table felt %1 wall %2',
            args0: [
                {
                    type: 'field_dropdown',
                    name: 'FELT',
                    options: [
                        ['(default)', ''],
                        ['table_1', 'table_1'],
                        ['board', 'board'],
                        ['board1', 'board1'],
                        ['board2', 'board2'],
                        ['bg1', 'bg1'],
                    ],
                },
                {
                    type: 'field_dropdown',
                    name: 'WALL',
                    options: [
                        ['(default)', ''],
                        ['wall_1', 'wall_1'],
                        ['table_wall', 'table_wall'],
                    ],
                },
            ],
            colour: H.level,
        },
    ];
}

/** Toolbox XML / JSON for Blockly inject. */
export function getBlocklyToolbox(): object {
    return {
        kind: 'categoryToolbox',
        contents: [
            {
                kind: 'category',
                name: '🟡 Events',
                colour: String(BLOCKLY_HUE.event),
                contents: [
                    { kind: 'block', type: 'when_game_start' },
                    { kind: 'block', type: 'when_coin_hit' },
                    { kind: 'block', type: 'when_cushion_bounce' },
                    { kind: 'block', type: 'when_power_charged' },
                    { kind: 'block', type: 'when_foul_triggered' },
                    { kind: 'block', type: 'when_timer_tick' },
                    { kind: 'block', type: 'when_shot_fired' },
                ],
            },
            {
                kind: 'category',
                name: '🔵 Conditions',
                colour: String(BLOCKLY_HUE.condition),
                contents: [
                    { kind: 'block', type: 'if_velocity_gt' },
                    { kind: 'block', type: 'if_coin_tag' },
                    { kind: 'block', type: 'if_probability' },
                    { kind: 'block', type: 'if_coins_left_lt' },
                    { kind: 'block', type: 'if_var_gt' },
                ],
            },
            {
                kind: 'category',
                name: '🟣 Actions',
                colour: String(BLOCKLY_HUE.action),
                contents: [
                    { kind: 'block', type: 'apply_impulse' },
                    { kind: 'block', type: 'explode_radius' },
                    { kind: 'block', type: 'swap_positions' },
                    { kind: 'block', type: 'set_coin_position' },
                    { kind: 'block', type: 'change_friction' },
                    { kind: 'block', type: 'trigger_time_reverse' },
                    { kind: 'block', type: 'set_variable' },
                    { kind: 'block', type: 'change_variable' },
                    { kind: 'block', type: 'tag_coin' },
                    { kind: 'block', type: 'declare_win' },
                    { kind: 'block', type: 'declare_lose' },
                ],
            },
            {
                kind: 'category',
                name: '🔴 Juice FX',
                colour: String(BLOCKLY_HUE.fx),
                contents: [
                    { kind: 'block', type: 'play_meme_sound' },
                    { kind: 'block', type: 'spawn_world_text' },
                    { kind: 'block', type: 'show_coin_position' },
                    { kind: 'block', type: 'apply_squash_stretch' },
                    { kind: 'block', type: 'screen_shake' },
                ],
            },
            {
                kind: 'category',
                name: '🎨 Skins',
                colour: String(BLOCKLY_HUE.skin),
                contents: [
                    { kind: 'block', type: 'set_coin_skin' },
                    { kind: 'block', type: 'set_table_skin' },
                ],
            },
            {
                kind: 'category',
                name: '🟢 Level',
                colour: String(BLOCKLY_HUE.level),
                contents: [
                    { kind: 'block', type: 'level_setup' },
                    { kind: 'block', type: 'level_place' },
                    { kind: 'block', type: 'level_table_skin' },
                ],
            },
            {
                kind: 'category',
                name: '⚙ Rules / Math',
                colour: String(BLOCKLY_HUE.rules),
                contents: [
                    { kind: 'block', type: 'config_win_clear_all' },
                    { kind: 'block', type: 'config_win_score' },
                    { kind: 'block', type: 'config_win_survive' },
                    { kind: 'block', type: 'config_lose_striker_fall' },
                    { kind: 'block', type: 'config_lose_shot_limit' },
                    { kind: 'block', type: 'config_physics' },
                    { kind: 'block', type: 'math_add' },
                    { kind: 'block', type: 'math_sub' },
                    { kind: 'block', type: 'math_random' },
                ],
            },
        ],
    };
}

/** Register all custom blocks on a Blockly global. */
export function registerCoinDuelBlocks(BlocklyNS: typeof Blockly): void {
    BlocklyNS.defineBlocksWithJsonArray(getBlocklyJsonDefinitions());
}
