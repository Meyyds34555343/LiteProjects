import {
    Color,
    Label,
    Node,
    RigidBody2D,
    tween,
    UIOpacity,
    UITransform,
    Vec2,
    Vec3,
} from 'cc';
import { LevelManager } from '../LevelManager';
import { LevelData } from '../LevelData';
import { ModCompiler, getPipelineEventProps } from './ModCompiler';
import {
    DEFAULT_PHYSICS,
    LoseConditionType,
    ModConfig,
    ModOpcode,
    ModPropValue,
    ModRulePipeline,
    WinConditionType,
} from './ModConfigSchema';

const STORAGE_KEY = 'CoinDuel:activeMod';

/** Host bridge — GameLogic implements this; no Canvas HUD mutation. */
export interface ModRuntimeHost {
    coinGroup: Node | null;
    countCoins(): number;
    getShotCount(): number;
    getCombo(): number;
    getActiveShotCoin(): Node | null;
    getLastHitCoin(): Node | null;
    getCoinDamping(): number;
    setCoinDamping(value: number): void;
    triggerTimeReverse(): void;
    declareWin(reason: string): void;
    declareLose(reason: string): void;
    shakeCamera(intensity: number, dir?: Vec2): void;
    playClipById?(sfxId: string, pitch: number): void;
    getElapsedSeconds(): number;
    hasBossTagged?(): boolean;
    getScore?(): number;
    /** Hot-swap coin sprite (preset / URL / Base64) */
    applyCoinSkin?(coin: Node, preset: string, url: string): void;
    /** Hot-swap table felt + wall */
    applyTableSkin?(felt: string, wall: string): void;
}

export interface ModEventContext {
    coin?: Node | null;
    other?: Node | null;
    velocity?: number;
    powerPercent?: number;
    x?: number;
    y?: number;
    tag?: string;
}

/**
 * Parses ModConfig pipelines and executes Event➔Condition➔Action stacks at runtime.
 * All juice spawns as world-space nodes under coinGroup (zero gameplay Canvas change).
 */
export class GameLogicInterpreter {
    public static instance: GameLogicInterpreter | null = null;

    private _host: ModRuntimeHost | null = null;
    private _mod: ModConfig | null = null;
    private _vars = new Map<string, number>();
    private _tags = new WeakMap<Node, Set<string>>();
    private _timerAcc = 0;
    private _started = false;
    private _ended = false;
    private _shotCount = 0;

    public static getOrCreate(): GameLogicInterpreter {
        if (!this.instance) this.instance = new GameLogicInterpreter();
        return this.instance;
    }

    public bindHost(host: ModRuntimeHost): void {
        this._host = host;
    }

    public get mod(): ModConfig | null {
        return this._mod;
    }

    public get physics() {
        return this._mod?.physics ?? DEFAULT_PHYSICS;
    }

    public load(mod: ModConfig | null): void {
        this._mod = mod;
        this._vars.clear();
        this._started = false;
        this._ended = false;
        this._shotCount = 0;
        this._timerAcc = 0;
        if (!mod) return;
        for (const v of mod.variables) this._vars.set(v.name, v.initial);
        if (this._host) {
            this._host.setCoinDamping(this._frictionToDamping(mod.physics.tableFriction));
        }
        try {
            sysLocalSet(STORAGE_KEY, JSON.stringify(mod));
        } catch { /* ignore */ }
        if (mod.level) {
            try {
                LevelManager.setScratchLevel(mod.level as unknown as LevelData);
                console.log('[Mod] Scratch level applied', mod.level.id, 'objects=', mod.level.coins?.length ?? 0);
            } catch { /* ignore */ }
        }
        console.log('[Mod] loaded', mod.name, 'pipelines=', mod.pipelines.length, 'hash=', mod.hash);
    }

    public loadFromShareCode(code: string): boolean {
        const mod = ModCompiler.fromShareCode(code);
        if (!mod) return false;
        this.load(mod);
        return true;
    }

    public loadCached(): boolean {
        try {
            const raw = sysLocalGet(STORAGE_KEY);
            if (!raw) return false;
            const mod = JSON.parse(raw) as ModConfig;
            if (mod.schemaVersion !== 1) return false;
            this.load(mod);
            return true;
        } catch {
            return false;
        }
    }

    public clear(): void {
        this._mod = null;
        this._vars.clear();
        this._ended = false;
        try { sysLocalRemove(STORAGE_KEY); } catch { /* ignore */ }
    }

    public onGameStart(): void {
        if (!this._mod || this._started) return;
        this._started = true;
        this.emit(ModOpcode.WHEN_GAME_START, {});
    }

    public onShotFired(ctx: ModEventContext = {}): void {
        this._shotCount++;
        this.emit(ModOpcode.WHEN_SHOT_FIRED, ctx);
    }

    public onCoinHit(ctx: ModEventContext): void {
        this.emit(ModOpcode.WHEN_COIN_HIT, ctx);
    }

    public onCushionBounce(ctx: ModEventContext): void {
        this.emit(ModOpcode.WHEN_CUSHION_BOUNCE, ctx);
    }

    public onFoul(ctx: ModEventContext): void {
        this.emit(ModOpcode.WHEN_FOUL_TRIGGERED, ctx);
    }

    public onCoinFall(ctx: ModEventContext): void {
        this.emit(ModOpcode.WHEN_COIN_FALL, ctx);
    }

    public onPowerCharged(percent: number, ctx: ModEventContext = {}): void {
        this.emit(ModOpcode.WHEN_POWER_CHARGED, { ...ctx, powerPercent: percent });
    }

    public tick(dt: number): void {
        if (!this._mod || this._ended || !this._host) return;
        this._timerAcc += dt;
        for (const pipe of this._mod.pipelines) {
            if (pipe.event !== ModOpcode.WHEN_TIMER_TICK) continue;
            const interval = num(getPipelineEventProps(pipe).interval, 1);
            if (this._timerAcc >= interval) {
                this._runPipeline(pipe, {});
            }
        }
        if (this._timerAcc >= 1) this._timerAcc = 0;
        this._evaluateRules();
    }

    /** Called after native settle; returns true if mod handled win/lose. */
    public evaluateAfterSettle(opts: {
        fallenStriker: boolean;
        coinsLeft: number;
    }): 'win' | 'lose' | null {
        if (!this._mod || this._ended || !this._host) return null;
        for (const rule of this._mod.lose) {
            if (rule.type === LoseConditionType.STRIKER_FALLS_OFF_TABLE && opts.fallenStriker) {
                this._endLose('striker_fall');
                return 'lose';
            }
            if (rule.type === LoseConditionType.SHOT_LIMIT) {
                const limit = typeof rule.value === 'number' ? rule.value : Number(rule.value);
                if (this._shotCount >= limit) {
                    this._endLose('shot_limit');
                    return 'lose';
                }
            }
            if (rule.type === LoseConditionType.TIMER_EXPIRED) {
                const limit = typeof rule.value === 'number' ? rule.value : Number(rule.value);
                if (this._host.getElapsedSeconds() >= limit) {
                    this._endLose('timer');
                    return 'lose';
                }
            }
        }
        for (const rule of this._mod.win) {
            if (rule.type === WinConditionType.CLEAR_ALL_COINS && opts.coinsLeft <= 1) {
                this._endWin('clear_all');
                return 'win';
            }
            if (rule.type === WinConditionType.KNOCK_OUT_BOSS_COIN && this._host.hasBossTagged?.() === false) {
                // boss gone → win when tag no longer present and at least one shot happened
                if (this._shotCount > 0 && !this._anyTagged('boss')) {
                    this._endWin('boss');
                    return 'win';
                }
            }
            if (rule.type === WinConditionType.REACH_TARGET_SCORE) {
                const need = typeof rule.value === 'number' ? rule.value : Number(rule.value);
                if ((this._host.getScore?.() ?? this._vars.get('KarmaPoints') ?? 0) >= need) {
                    this._endWin('score');
                    return 'win';
                }
            }
            if (rule.type === WinConditionType.SURVIVE_TIME_LIMIT) {
                const need = typeof rule.value === 'number' ? rule.value : Number(rule.value);
                if (this._host.getElapsedSeconds() >= need) {
                    this._endWin('survive');
                    return 'win';
                }
            }
        }
        return null;
    }

    public emit(event: ModOpcode, ctx: ModEventContext): void {
        if (!this._mod || this._ended) return;
        for (const pipe of this._mod.pipelines) {
            if (pipe.event !== event) continue;
            if (event === ModOpcode.WHEN_POWER_CHARGED) {
                const need = num(getPipelineEventProps(pipe).percent, 70);
                if ((ctx.powerPercent ?? 0) < need) continue;
            }
            this._runPipeline(pipe, ctx);
        }
    }

    public getVar(name: string): number {
        return this._vars.get(name) ?? 0;
    }

    public tagCoin(coin: Node, tag: string): void {
        let set = this._tags.get(coin);
        if (!set) {
            set = new Set();
            this._tags.set(coin, set);
        }
        set.add(tag);
    }

    public coinHasTag(coin: Node | null | undefined, tag: string): boolean {
        if (!coin) return false;
        return this._tags.get(coin)?.has(tag) ?? false;
    }

    // ── pipeline exec ──

    private _runPipeline(pipe: ModRulePipeline, ctx: ModEventContext): void {
        for (const step of pipe.steps) {
            if (!this._execStep(step.opcode, step.props, ctx)) break;
        }
    }

    /** @returns false = condition failed / stop chain */
    private _execStep(
        opcode: ModOpcode,
        props: Record<string, ModPropValue>,
        ctx: ModEventContext,
    ): boolean {
        const host = this._host;
        if (!host) return false;

        switch (opcode) {
            case ModOpcode.IF_VELOCITY_GREATER_THAN:
                return (ctx.velocity ?? this._nodeSpeed(ctx.coin)) > num(props.value, 0);
            case ModOpcode.IF_COIN_TAG:
                return this.coinHasTag(ctx.coin ?? host.getLastHitCoin(), String(props.tag ?? ''));
            case ModOpcode.IF_PROBABILITY:
                return Math.random() * 100 < num(props.percent, 50);
            case ModOpcode.IF_REMAINING_COINS_LESS_THAN:
                return host.countCoins() < num(props.count, 3);
            case ModOpcode.IF_VAR_GREATER_THAN:
                return this.getVar(String(props.name ?? '')) > num(props.value, 0);
            case ModOpcode.IF_SHOT_COUNT_LESS_THAN:
                return this._shotCount < num(props.count, 5);

            case ModOpcode.APPLY_IMPULSE: {
                const coin = ctx.coin ?? host.getActiveShotCoin() ?? host.getLastHitCoin();
                if (coin) this._impulse(coin, num(props.x, 0), num(props.y, 0));
                return true;
            }
            case ModOpcode.EXPLODE_RADIUS: {
                const origin = ctx.coin ?? host.getLastHitCoin() ?? host.getActiveShotCoin();
                const ox = origin?.position.x ?? ctx.x ?? 0;
                const oy = origin?.position.y ?? ctx.y ?? 0;
                this._explode(ox, oy, num(props.force, 800), num(props.radius, 120));
                return true;
            }
            case ModOpcode.SWAP_POSITIONS: {
                const a = host.getActiveShotCoin();
                const b = host.getLastHitCoin();
                if (a && b) {
                    const ax = a.position.x;
                    const ay = a.position.y;
                    a.setPosition(b.position.x, b.position.y, 0);
                    b.setPosition(ax, ay, 0);
                }
                return true;
            }
            case ModOpcode.SET_COIN_POSITION: {
                const coin = ctx.coin ?? host.getLastHitCoin() ?? host.getActiveShotCoin();
                if (coin) {
                    const x = num(props.x, 0);
                    const y = num(props.y, 0);
                    coin.setPosition(x, y, 0);
                    const rb = coin.getComponent(RigidBody2D);
                    if (rb) {
                        rb.linearVelocity = new Vec2(0, 0);
                        rb.angularVelocity = 0;
                    }
                }
                return true;
            }
            case ModOpcode.SHOW_COIN_POSITION: {
                const coin = ctx.coin ?? host.getLastHitCoin() ?? host.getActiveShotCoin();
                if (coin) {
                    const px = Math.round(coin.position.x);
                    const py = Math.round(coin.position.y);
                    this._spawnWorldText(
                        `(${px}, ${py})`,
                        String(props.color ?? '#80DEEA'),
                        coin.position.x,
                        coin.position.y + 48,
                    );
                }
                return true;
            }
            case ModOpcode.CHANGE_FRICTION:
                host.setCoinDamping(this._frictionToDamping(num(props.value, 0.35)));
                return true;
            case ModOpcode.TRIGGER_TIME_REVERSE:
                if (this.physics.enableTimeReversePenalty || true) host.triggerTimeReverse();
                return true;
            case ModOpcode.SET_VARIABLE:
                this._vars.set(String(props.name ?? 'x'), num(props.value, 0));
                return true;
            case ModOpcode.CHANGE_VARIABLE:
            case ModOpcode.MATH_ADD: {
                const name = String(props.name ?? 'x');
                const delta = num(props.delta ?? props.value, 1);
                this._vars.set(name, this.getVar(name) + delta);
                return true;
            }
            case ModOpcode.MATH_SUBTRACT: {
                const name = String(props.name ?? 'x');
                this._vars.set(name, this.getVar(name) - num(props.value, 1));
                return true;
            }
            case ModOpcode.MATH_RANDOM_RANGE: {
                const name = String(props.name ?? 'x');
                const min = num(props.min, 0);
                const max = num(props.max, 1);
                this._vars.set(name, min + Math.random() * (max - min));
                return true;
            }
            case ModOpcode.TAG_COIN: {
                const coin = ctx.coin ?? host.getLastHitCoin();
                if (coin) this.tagCoin(coin, String(props.tag ?? 'boss'));
                return true;
            }
            case ModOpcode.DECLARE_WIN:
                this._endWin(String(props.reason ?? 'custom'));
                return false;
            case ModOpcode.DECLARE_LOSE:
                this._endLose(String(props.reason ?? 'custom'));
                return false;

            case ModOpcode.PLAY_MEME_SOUND:
                host.playClipById?.(String(props.sfxId ?? 'shot'), num(props.pitch, 1));
                return true;
            case ModOpcode.SPAWN_WORLD_TEXT:
                this._spawnWorldText(
                    String(props.text ?? '!'),
                    String(props.color ?? '#FFE082'),
                    ctx.coin?.position.x ?? ctx.x ?? 0,
                    (ctx.coin?.position.y ?? ctx.y ?? 0) + 48,
                );
                return true;
            case ModOpcode.APPLY_SQUASH_STRETCH: {
                const coin = ctx.coin ?? host.getLastHitCoin() ?? host.getActiveShotCoin();
                if (coin) this._squash(coin, num(props.sx, 1.3), num(props.sy, 0.7));
                return true;
            }
            case ModOpcode.SCREEN_SHAKE:
                host.shakeCamera(num(props.intensity, 0.1));
                return true;
            case ModOpcode.SET_COIN_SKIN: {
                const coin = ctx.coin ?? host.getLastHitCoin() ?? host.getActiveShotCoin();
                if (coin) {
                    host.applyCoinSkin?.(
                        coin,
                        String(props.preset ?? ''),
                        String(props.url ?? ''),
                    );
                }
                return true;
            }
            case ModOpcode.SET_TABLE_SKIN:
                host.applyTableSkin?.(
                    String(props.felt ?? 'table_1'),
                    String(props.wall ?? 'wall_1'),
                );
                return true;
            default:
                return true;
        }
    }

    private _evaluateRules(): void {
        if (!this._host || !this._mod || this._ended) return;
        this.evaluateAfterSettle({
            fallenStriker: false,
            coinsLeft: this._host.countCoins(),
        });
    }

    private _endWin(reason: string): void {
        if (this._ended || !this._host) return;
        this._ended = true;
        const label = this._mod?.uiStrings?.win || 'WIN!';
        this._spawnWorldText(label, '#66BB6A', 0, 80);
        this._host.declareWin(reason);
    }

    private _endLose(reason: string): void {
        if (this._ended || !this._host) return;
        this._ended = true;
        const label = this._mod?.uiStrings?.lose || 'LOSE';
        this._spawnWorldText(label, '#EF5350', 0, 80);
        this._host.declareLose(reason);
    }

    /** Shared with web LivePreview — keep damping math identical. */
    public static frictionToDamping(friction: number): number {
        return Math.max(0.05, friction * 6);
    }

    private _frictionToDamping(friction: number): number {
        return GameLogicInterpreter.frictionToDamping(friction);
    }

    private _nodeSpeed(node: Node | null | undefined): number {
        if (!node) return 0;
        const rb = node.getComponent(RigidBody2D);
        if (!rb) return 0;
        const v = rb.linearVelocity;
        return Math.hypot(v.x, v.y);
    }

    private _impulse(coin: Node, x: number, y: number): void {
        const rb = coin.getComponent(RigidBody2D);
        if (!rb) return;
        rb.applyLinearImpulse(new Vec2(x, y), rb.getWorldCenter(new Vec2()), true);
    }

    private _explode(ox: number, oy: number, force: number, radius: number): void {
        const group = this._host?.coinGroup;
        if (!group) return;
        const r2 = radius * radius;
        for (const child of group.children) {
            const rb = child.getComponent(RigidBody2D);
            if (!rb) continue;
            const dx = child.position.x - ox;
            const dy = child.position.y - oy;
            const d2 = dx * dx + dy * dy;
            if (d2 > r2 || d2 < 1) continue;
            const d = Math.sqrt(d2);
            const s = (force * (1 - d / radius)) / d;
            rb.applyLinearImpulse(new Vec2(dx * s, dy * s), rb.getWorldCenter(new Vec2()), true);
        }
        this._spawnWorldText('BOOM', '#FF7043', ox, oy + 40);
    }

    private _squash(coin: Node, sx: number, sy: number): void {
        const original = coin.scale.clone();
        coin.setScale(sx, sy, 1);
        tween(coin)
            .to(0.12, { scale: original })
            .start();
    }

    private _spawnWorldText(text: string, colorHex: string, x: number, y: number): void {
        const parent = this._host?.coinGroup;
        if (!parent) return;
        const node = new Node('ModWorldText');
        node.layer = parent.layer;
        parent.addChild(node);
        node.setPosition(x, y, 0);
        const ui = node.addComponent(UITransform);
        ui.setContentSize(220, 40);
        const label = node.addComponent(Label);
        label.string = text;
        label.fontSize = 28;
        label.lineHeight = 32;
        label.useSystemFont = true;
        label.fontFamily = 'Arial';
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.color = this._hex(colorHex);
        const opacity = node.addComponent(UIOpacity);
        opacity.opacity = 255;
        tween(node)
            .by(0.55, { position: new Vec3(0, 60, 0) })
            .start();
        tween(opacity)
            .delay(0.2)
            .to(0.45, { opacity: 0 })
            .call(() => { if (node.isValid) node.destroy(); })
            .start();
    }

    private _anyTagged(tag: string): boolean {
        const group = this._host?.coinGroup;
        if (!group) return false;
        for (const child of group.children) {
            if (this.coinHasTag(child, tag)) return true;
        }
        return false;
    }

    private _hex(hex: string): Color {
        const h = hex.replace('#', '');
        const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
        if (Number.isNaN(n)) return Color.WHITE;
        return new Color((n >> 16) & 255, (n >> 8) & 255, n & 255, 255);
    }
}

function num(v: ModPropValue | undefined, fallback: number): number {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string') {
        const n = Number(v);
        return Number.isFinite(n) ? n : fallback;
    }
    return fallback;
}

function sysLocalGet(key: string): string | null {
    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sys = (globalThis as any).cc?.sys ?? null;
        if (sys?.localStorage) return sys.localStorage.getItem(key);
        if (typeof localStorage !== 'undefined') return localStorage.getItem(key);
    } catch { /* ignore */ }
    return null;
}

function sysLocalSet(key: string, value: string): void {
    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sys = (globalThis as any).cc?.sys ?? null;
        if (sys?.localStorage) {
            sys.localStorage.setItem(key, value);
            return;
        }
        if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
    } catch { /* ignore */ }
}

function sysLocalRemove(key: string): void {
    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sys = (globalThis as any).cc?.sys ?? null;
        if (sys?.localStorage) {
            sys.localStorage.removeItem(key);
            return;
        }
        if (typeof localStorage !== 'undefined') localStorage.removeItem(key);
    } catch { /* ignore */ }
}
