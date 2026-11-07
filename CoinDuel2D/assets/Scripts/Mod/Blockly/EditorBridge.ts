/**
 * Lightweight Blockly host bridge for CoinDuel2D.
 * Handles inject, resize, ModConfig JSON export, live preview, and share strings.
 * Browser HTML tools load Blockly from CDN; Cocos game never injects Blockly.
 */

import { ModCompiler } from '../ModCompiler';
import {
    LoseConditionType,
    ModConfig,
    ModPropValue,
    ModVisualBlock,
    WinConditionType,
    findModHatRoots,
    walkModStack,
} from '../ModConfigSchema';
import {
    getBlocklyToolbox,
    OPCODE_TO_BLOCKLY_TYPE,
    registerCoinDuelBlocks,
} from './BlocklyDefinitions';
import { BlocklyJsonGenerator, GenerateOptions } from './BlocklyJsonGenerator';
import { LivePreviewSandbox } from './LivePreviewSandbox';

const WS_SHARE_PREFIX = 'COINWS1:';
const ACTIVE_MOD_KEY = 'CoinDuel:activeMod';
const POST_MSG_TYPE = 'CoinDuel:modConfig';

/** Prop key → Blockly field name (reverse of generator FIELD_MAP). */
const PROP_TO_FIELD: Record<string, Record<string, string>> = {
    when_power_charged: { percent: 'PERCENT' },
    when_timer_tick: { interval: 'INTERVAL' },
    if_velocity_gt: { value: 'VALUE' },
    if_coin_tag: { tag: 'TAG' },
    if_probability: { percent: 'PERCENT' },
    if_coins_left_lt: { count: 'COUNT' },
    if_var_gt: { name: 'NAME', value: 'VALUE' },
    apply_impulse: { x: 'X', y: 'Y' },
    explode_radius: { force: 'FORCE', radius: 'RADIUS' },
    set_coin_position: { x: 'X', y: 'Y' },
    show_coin_position: { color: 'COLOR' },
    change_friction: { value: 'VALUE' },
    set_variable: { name: 'NAME', value: 'VALUE' },
    change_variable: { name: 'NAME', delta: 'DELTA' },
    tag_coin: { tag: 'TAG' },
    declare_win: { reason: 'REASON' },
    declare_lose: { reason: 'REASON' },
    play_meme_sound: { sfxId: 'SFX', pitch: 'PITCH' },
    spawn_world_text: { text: 'TEXT', color: 'COLOR' },
    apply_squash_stretch: { sx: 'SX', sy: 'SY' },
    screen_shake: { intensity: 'INTENSITY', duration: 'DURATION' },
    set_coin_skin: { preset: 'PRESET', url: 'URL' },
    set_table_skin: { felt: 'FELT', wall: 'WALL' },
    math_add: { name: 'NAME', value: 'VALUE' },
    math_sub: { name: 'NAME', value: 'VALUE' },
    math_random: { name: 'NAME', min: 'MIN', max: 'MAX' },
};

/** Blockly structural / field events that should refresh ModConfig. */
const LIVE_EVENT_TYPES = new Set([
    'create',
    'delete',
    'change',
    'move',
    'BLOCK_CREATE',
    'BLOCK_DELETE',
    'BLOCK_CHANGE',
    'BLOCK_MOVE',
]);

export interface EditorBridgeOptions {
    mediaPath?: string;
    onChange?: (mod: ModConfig) => void;
    modMeta?: GenerateOptions;
    /** Optional LZString global (from CDN) for shorter workspace share codes. */
    lzString?: { compressToBase64(s: string): string; decompressFromBase64(s: string): string };
    /** Canvas element (or id) for right-sidebar live sandbox preview. */
    previewCanvas?: HTMLCanvasElement | string;
    /** Debounce ms for live JSON regen (default 80). */
    liveDebounceMs?: number;
    /** postMessage target; default window.parent when embedded. */
    postMessageTarget?: Window | null;
}

export interface EditorBridgeApi {
    workspace: Blockly.Workspace;
    resize(): void;
    exportModJson(pretty?: boolean): string;
    exportShareCode(): string;
    importShareCode(code: string): boolean;
    exportWorkspaceCode(): string;
    importWorkspaceCode(code: string): boolean;
    loadModConfig(mod: ModConfig): boolean;
    clear(): void;
    dispose(): void;
    getModConfig(): ModConfig;
    /** Force live JSON + preview refresh. */
    refreshLivePreview(): void;
    getLastLiveMod(): ModConfig | null;
}

type BlocklyWorkspaceEx = Blockly.Workspace & {
    newBlock?(type: string): BlocklyBlockEx;
    dispose?(): void;
};

interface BlocklyBlockEx extends Blockly.Block {
    initSvg?(): void;
    render?(): void;
    setFieldValue?(value: string | number | boolean, name: string): void;
    previousConnection?: { connect(c: unknown): void } | null;
    nextConnection?: unknown;
    moveBy?(dx: number, dy: number): void;
}

interface BlocklyChangeEvent {
    type?: string;
    isUiEvent?: boolean;
    recordUndo?: boolean;
}

/**
 * Inject Scratch-like Blockly into a DOM host and bridge to ModConfigSchema.
 */
export class EditorBridge {
    private _ws: BlocklyWorkspaceEx | null = null;
    private _ro: ResizeObserver | null = null;
    private _previewRo: ResizeObserver | null = null;
    private _opts: EditorBridgeOptions = {};
    private _container: HTMLElement | null = null;
    private _changeAttached = false;
    private _preview: LivePreviewSandbox | null = null;
    private _previewCanvas: HTMLCanvasElement | null = null;
    private _liveTimer: ReturnType<typeof setTimeout> | null = null;
    private _lastLiveMod: ModConfig | null = null;
    private _suppressLive = false;
    private _blocklyNS: typeof Blockly | null = null;

    public init(
        container: HTMLElement | string,
        BlocklyNS: typeof Blockly,
        opts: EditorBridgeOptions = {},
    ): EditorBridgeApi {
        this.dispose();
        this._opts = opts;
        this._blocklyNS = BlocklyNS;
        registerCoinDuelBlocks(BlocklyNS);

        const el = typeof container === 'string'
            ? document.getElementById(container)
            : container;
        if (!el) throw new Error('[EditorBridge] container not found');
        this._container = el;

        const ws = BlocklyNS.inject(el, {
            toolbox: getBlocklyToolbox(),
            media: opts.mediaPath ?? 'https://unpkg.com/blockly/media/',
            trashcan: true,
            scrollbars: true,
            zoom: { controls: true, wheel: true, startScale: 0.9, maxScale: 2, minScale: 0.4 },
            grid: { spacing: 24, length: 3, colour: '#333', snap: true },
            move: { scrollbars: true, drag: true, wheel: true },
            renderer: 'zelos',
        }) as BlocklyWorkspaceEx;
        this._ws = ws;

        this._attachLiveListener(ws, BlocklyNS);
        this._initPreview(opts.previewCanvas);

        if (typeof ResizeObserver !== 'undefined') {
            this._ro = new ResizeObserver(() => this.resize());
            this._ro.observe(el);
        }
        window.addEventListener('resize', this._onWinResize);

        // Initial snapshot
        this.refreshLivePreview();

        return this._api();
    }

    public resize(): void {
        this._ws?.resize();
        this._resizePreview();
    }

    public getModConfig(): ModConfig {
        if (!this._ws) throw new Error('[EditorBridge] not initialized');
        return BlocklyJsonGenerator.workspaceToModConfig(this._ws, this._opts.modMeta);
    }

    public getLastLiveMod(): ModConfig | null {
        return this._lastLiveMod;
    }

    public exportModJson(pretty = true): string {
        const mod = this.getModConfig();
        return pretty ? JSON.stringify(mod, null, 2) : JSON.stringify(mod);
    }

    /** JJS-style 1-click export: COINMOD1:<base64 json> */
    public exportShareCode(): string {
        const code = BlocklyJsonGenerator.workspaceToShareCode(this._ws!, this._opts.modMeta);
        this._persistActiveMod(this.getModConfig());
        return code;
    }

    /** Import COINMOD1 share string → workspace + localStorage for GameLogicInterpreter. */
    public importShareCode(code: string): boolean {
        const mod = ModCompiler.fromShareCode(code.trim());
        if (!mod) return false;
        const ok = this.loadModConfig(mod);
        if (ok) this._persistActiveMod(mod);
        return ok;
    }

    /**
     * Workspace visual state share (not runtime mod).
     * Uses LZ-String when available, else Base64 → COINWS1:…
     */
    public exportWorkspaceCode(): string {
        if (!this._ws) return '';
        const BlocklyNS = this._blocklyNS ?? window.Blockly;
        if (!BlocklyNS?.serialization?.workspaces) {
            if (BlocklyNS?.Xml) {
                const dom = BlocklyNS.Xml.workspaceToDom(this._ws);
                const xml = BlocklyNS.Xml.domToText(dom);
                return WS_SHARE_PREFIX + this._compress(xml);
            }
            return '';
        }
        const state = JSON.stringify(BlocklyNS.serialization.workspaces.save(this._ws));
        return WS_SHARE_PREFIX + this._compress(state);
    }

    public importWorkspaceCode(code: string): boolean {
        const trimmed = code.trim();
        if (!trimmed.startsWith(WS_SHARE_PREFIX) || !this._ws) return false;
        const payload = this._decompress(trimmed.slice(WS_SHARE_PREFIX.length));
        if (!payload) return false;
        const BlocklyNS = this._blocklyNS ?? window.Blockly;
        if (!BlocklyNS) return false;
        try {
            this._suppressLive = true;
            this._ws.clear();
            if (payload.trim().startsWith('<')) {
                const dom = BlocklyNS.Xml.textToDom(payload);
                BlocklyNS.Xml.domToWorkspace(dom, this._ws);
            } else if (BlocklyNS.serialization?.workspaces) {
                BlocklyNS.serialization.workspaces.load(JSON.parse(payload), this._ws);
            } else {
                return false;
            }
            this.resize();
            return true;
        } catch {
            return false;
        } finally {
            this._suppressLive = false;
            this.refreshLivePreview();
        }
    }

    /** Rebuild Blockly stacks from a ModConfig graph (+ config rule blocks). */
    public loadModConfig(mod: ModConfig): boolean {
        if (!this._ws) return false;
        const BlocklyNS = this._blocklyNS ?? window.Blockly;
        if (!BlocklyNS) return false;
        this._suppressLive = true;
        this._ws.clear();

        let cursorY = 40;
        for (const hat of findModHatRoots(mod.graph)) {
            const chain = walkModStack(mod.graph, hat.id);
            let prev: BlocklyBlockEx | null = null;
            for (let i = 0; i < chain.length; i++) {
                const visual = chain[i];
                const created = this._spawnFromVisual(visual, 40, cursorY + i * 48);
                if (!created) continue;
                if (prev?.nextConnection && created.previousConnection) {
                    created.previousConnection.connect(prev.nextConnection);
                }
                prev = created;
            }
            cursorY += Math.max(chain.length, 1) * 48 + 40;
        }

        let cfgX = 420;
        let cfgY = 40;
        for (const w of mod.win ?? []) {
            const b = this._spawnConfigWin(w.type, w.value, cfgX, cfgY);
            if (b) cfgY += 56;
        }
        for (const l of mod.lose ?? []) {
            const b = this._spawnConfigLose(l.type, l.value, cfgX, cfgY);
            if (b) cfgY += 56;
        }
        if (mod.physics) {
            const b = this._newBlock('config_physics', cfgX, cfgY);
            if (b) {
                b.setFieldValue?.(mod.physics.tableFriction, 'FRICTION');
                b.setFieldValue?.(mod.physics.restitutionScale, 'RESTITUTION');
                b.setFieldValue?.(
                    mod.physics.enableTimeReversePenalty ? 'true' : 'false',
                    'TIME_REVERSE',
                );
            }
        }

        this._suppressLive = false;
        this.resize();
        this.refreshLivePreview();
        return true;
    }

    public clear(): void {
        this._ws?.clear();
        this.refreshLivePreview();
    }

    /** Immediate lightweight JSON regen + preview + postMessage. */
    public refreshLivePreview(): void {
        if (!this._ws) return;
        try {
            const mod = BlocklyJsonGenerator.workspaceToModConfig(this._ws, this._opts.modMeta);
            this._lastLiveMod = mod;
            this._preview?.setMod(mod);
            this._dispatchLive(mod);
            this._opts.onChange?.(mod);
        } catch {
            /* ignore transient graph errors while dragging */
        }
    }

    public dispose(): void {
        window.removeEventListener('resize', this._onWinResize);
        this._ro?.disconnect();
        this._ro = null;
        this._previewRo?.disconnect();
        this._previewRo = null;
        if (this._liveTimer) clearTimeout(this._liveTimer);
        this._liveTimer = null;
        this._preview?.dispose();
        this._preview = null;
        this._previewCanvas = null;
        if (this._ws?.dispose) this._ws.dispose();
        this._ws = null;
        this._container = null;
        this._changeAttached = false;
        this._blocklyNS = null;
        this._lastLiveMod = null;
    }

    private _attachLiveListener(ws: BlocklyWorkspaceEx, BlocklyNS: typeof Blockly): void {
        if (this._changeAttached) return;
        this._changeAttached = true;

        const changeConst =
            (BlocklyNS as typeof Blockly & { Events?: { BLOCK_CHANGE?: string; CHANGE?: string } })
                .Events?.BLOCK_CHANGE
            ?? (BlocklyNS as typeof Blockly & { Events?: { CHANGE?: string } }).Events?.CHANGE
            ?? 'change';

        ws.addChangeListener((raw: unknown) => {
            if (this._suppressLive) return;
            const e = (raw ?? {}) as BlocklyChangeEvent;
            if (e.isUiEvent) return;

            const type = String(e.type ?? '');
            const relevant =
                LIVE_EVENT_TYPES.has(type)
                || type === changeConst
                || type.toLowerCase().includes('change')
                || type.toLowerCase().includes('create')
                || type.toLowerCase().includes('delete')
                || type.toLowerCase().includes('move');

            if (!relevant && type !== '') return;
            this._scheduleLiveRefresh();
        });
    }

    private _scheduleLiveRefresh(): void {
        const ms = this._opts.liveDebounceMs ?? 80;
        if (this._liveTimer) clearTimeout(this._liveTimer);
        this._liveTimer = setTimeout(() => {
            this._liveTimer = null;
            this.refreshLivePreview();
        }, ms);
    }

    private _dispatchLive(mod: ModConfig): void {
        const payload = {
            type: POST_MSG_TYPE,
            mod,
            modJson: JSON.stringify(mod),
            hash: mod.hash ?? null,
            at: Date.now(),
        };
        try {
            const target = this._opts.postMessageTarget !== undefined
                ? this._opts.postMessageTarget
                : (window.parent !== window ? window.parent : null);
            target?.postMessage(payload, '*');
            window.dispatchEvent(new CustomEvent(POST_MSG_TYPE, { detail: payload }));
        } catch { /* ignore cross-origin */ }
    }

    private _initPreview(canvasOpt?: HTMLCanvasElement | string): void {
        if (!canvasOpt || typeof document === 'undefined') return;
        const canvas = typeof canvasOpt === 'string'
            ? document.getElementById(canvasOpt) as HTMLCanvasElement | null
            : canvasOpt;
        if (!canvas || !('getContext' in canvas)) return;
        this._previewCanvas = canvas;
        this._preview = new LivePreviewSandbox(canvas);
        this._resizePreview();
        if (typeof ResizeObserver !== 'undefined' && canvas.parentElement) {
            this._previewRo = new ResizeObserver(() => this._resizePreview());
            this._previewRo.observe(canvas.parentElement);
        }
    }

    private _resizePreview(): void {
        if (!this._preview || !this._previewCanvas) return;
        const parent = this._previewCanvas.parentElement;
        const w = parent?.clientWidth || this._previewCanvas.clientWidth || 280;
        const h = parent?.clientHeight || this._previewCanvas.clientHeight || 360;
        this._preview.resize(w, h);
    }

    private _api(): EditorBridgeApi {
        return {
            workspace: this._ws!,
            resize: () => this.resize(),
            exportModJson: (p) => this.exportModJson(p),
            exportShareCode: () => this.exportShareCode(),
            importShareCode: (c) => this.importShareCode(c),
            exportWorkspaceCode: () => this.exportWorkspaceCode(),
            importWorkspaceCode: (c) => this.importWorkspaceCode(c),
            loadModConfig: (m) => this.loadModConfig(m),
            clear: () => this.clear(),
            dispose: () => this.dispose(),
            getModConfig: () => this.getModConfig(),
            refreshLivePreview: () => this.refreshLivePreview(),
            getLastLiveMod: () => this.getLastLiveMod(),
        };
    }

    private _onWinResize = (): void => {
        this.resize();
    };

    private _persistActiveMod(mod: ModConfig): void {
        try {
            if (typeof localStorage !== 'undefined') {
                localStorage.setItem(ACTIVE_MOD_KEY, JSON.stringify(mod));
            }
        } catch { /* ignore */ }
    }

    private _compress(text: string): string {
        const lz = this._opts.lzString
            ?? (typeof window !== 'undefined'
                ? (window as Window & { LZString?: EditorBridgeOptions['lzString'] }).LZString
                : undefined);
        if (lz?.compressToBase64) {
            return 'lz:' + lz.compressToBase64(text);
        }
        return 'b64:' + this._utf8ToBase64(text);
    }

    private _decompress(payload: string): string | null {
        try {
            if (payload.startsWith('lz:')) {
                const lz = this._opts.lzString
                    ?? (window as Window & { LZString?: EditorBridgeOptions['lzString'] }).LZString;
                return lz?.decompressFromBase64(payload.slice(3)) ?? null;
            }
            if (payload.startsWith('b64:')) {
                return this._base64ToUtf8(payload.slice(4));
            }
            return this._base64ToUtf8(payload);
        } catch {
            return null;
        }
    }

    private _utf8ToBase64(text: string): string {
        return btoa(unescape(encodeURIComponent(text)));
    }

    private _base64ToUtf8(b64: string): string {
        return decodeURIComponent(escape(atob(b64)));
    }

    private _spawnFromVisual(visual: ModVisualBlock, x: number, y: number): BlocklyBlockEx | null {
        const type = OPCODE_TO_BLOCKLY_TYPE[visual.opcode];
        if (!type) return null;
        const block = this._newBlock(type, x, y);
        if (!block) return null;
        const fieldMap = PROP_TO_FIELD[type] ?? {};
        for (const p of visual.props) {
            const field = fieldMap[p.key];
            if (field) block.setFieldValue?.(p.value, field);
        }
        return block;
    }

    private _spawnConfigWin(type: WinConditionType, value: ModPropValue | undefined, x: number, y: number): BlocklyBlockEx | null {
        if (type === WinConditionType.CLEAR_ALL_COINS) {
            return this._newBlock('config_win_clear_all', x, y);
        }
        if (type === WinConditionType.REACH_TARGET_SCORE) {
            const b = this._newBlock('config_win_score', x, y);
            b?.setFieldValue?.(Number(value ?? 100), 'SCORE');
            return b;
        }
        if (type === WinConditionType.SURVIVE_TIME_LIMIT) {
            const b = this._newBlock('config_win_survive', x, y);
            b?.setFieldValue?.(Number(value ?? 60), 'SEC');
            return b;
        }
        return null;
    }

    private _spawnConfigLose(type: LoseConditionType, value: ModPropValue | undefined, x: number, y: number): BlocklyBlockEx | null {
        if (type === LoseConditionType.STRIKER_FALLS_OFF_TABLE) {
            return this._newBlock('config_lose_striker_fall', x, y);
        }
        if (type === LoseConditionType.SHOT_LIMIT) {
            const b = this._newBlock('config_lose_shot_limit', x, y);
            b?.setFieldValue?.(Number(value ?? 10), 'COUNT');
            return b;
        }
        return null;
    }

    private _newBlock(type: string, x: number, y: number): BlocklyBlockEx | null {
        if (!this._ws?.newBlock) return null;
        try {
            const block = this._ws.newBlock(type) as BlocklyBlockEx;
            block.initSvg?.();
            block.render?.();
            block.moveBy?.(x, y);
            return block;
        } catch {
            return null;
        }
    }
}

/** Convenience singleton for HTML hosts. */
export const coinDuelBlockly = new EditorBridge();
