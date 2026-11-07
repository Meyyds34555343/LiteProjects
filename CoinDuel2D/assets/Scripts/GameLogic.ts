import { _decorator, Component, Node, Vec2, Vec3, Color, Sprite, SpriteFrame, Texture2D, RigidBody2D, ERigidBody2DType, PhysicsSystem2D, Contact2DType, Collider2D, UITransform, CircleCollider2D, AnimationComponent, Camera, EventMouse, EventTouch, Prefab, instantiate, Tween, tween, input, Input, AudioClip } from 'cc';
import { Bomb } from './Effects/Bomb';
import { BombCoinMarker } from './BombCoinMarker';
import { MudController } from './Effects/MudController';
import { CoinController } from './CoinController';
import { HitEffectManager } from './HitEffectManager';
import { Leaderboard } from './Leaderboard';
import { SoundManager } from './SoundManager';
import { TutorialManager } from './TutorialManager';
import { BehaviorRegistry } from './Behaviors/BehaviorRegistry';
import { BehaviorResolver } from './Behaviors/BehaviorResolver';
import { BehaviorBase } from './Behaviors/BehaviorBase';
import './Behaviors/FreezeBehavior';
import './Behaviors/FlashStepBehavior';
import './Behaviors/KnockbackBehavior';
import { MemeLoader } from './Meme/MemeLoader';
import { AssetSyncManager } from './Meme/AssetSyncManager';
import { RunProgressionManager } from './RunProgressionManager';
import { FailureAnalysisManager } from './FailureAnalysisManager';
import { WorldStatsDisplay } from './WorldStatsDisplay';
import { FakeCoinDecoy } from './FakeCoinDecoy';
import { GameLogicInterpreter, ModRuntimeHost } from './Mod/GameLogicInterpreter';
import { TableController } from './TableController';
const { ccclass, property } = _decorator;

enum GamePhase {
    WAITING_PLAYER, // 等待操作
    ANIMATING,      // 硬币飞行/物理运动中
    SETTLING,       // 物理已静止，进行结算
    TAP_RESTART,    // 失敗後等待點擊倒流
    REVERSING,      // 時光倒流 0.3 秒
}

@ccclass('GameLogic')
export class GameLogic extends Component {

    @property({ type: Node, tooltip: "所有硬币的父节点" })
    public coinGroup: Node = null!;

    public tableWidth: number = 1280;

    public tableHeight: number = 720;

    @property({ tooltip: "硬币半径" })
    public coinRadius: number = 32;

    @property({ tooltip: "判定静止的速度阈值" })
    public speedThreshold: number = 0.05;

    @property({ tooltip: "速度映射系数：拖拽距离 × 系数 = 发射初速度" })
    public velocityFactor: number = 0.5;

    @property({ tooltip: "硬币滑动阻尼（值越大摩擦越大，减速越快）" })
    public coinDamping: number = 2;

    @property({ type: HitEffectManager, tooltip: "击中特效管理器（控制拖拽拉近/发射追踪/暂停/震动/粒子/碰撞追踪/恢复）" })
    public hitEffectManager: HitEffectManager | null = null;

    /** 由 GameScene 在初始化时注入。Meme 硬幣也用這顆 prefab。 */
    public coinPrefab: Prefab | null = null;
    /** 由 GameScene 在初始化时注入 */
    public blockerPrefab: Prefab | null = null;
    /** 由 GameScene 在初始化时注入 */
    public mudPrefab: Prefab | null = null;
    /** 由 GameScene 在初始化时注入 */
    public explosionPrefab: Prefab | null = null;

    @property({ tooltip: "炸弹爆炸推力半径（硬币中心在此范围内会被推开）" })
    public bombPushRadius: number = 200;

    @property({ tooltip: "炸弹爆炸推力大小（越大推开越远）" })
    public bombPushForce: number = 500;

    @property({ tooltip: "炸弹对泥潭的推力系数（相对于硬币推力的比例，0.333 = 硬币的1/3）" })
    public bombMudPushFactor: number = 0.333;

    @property({ tooltip: "瞄准线长度系数（拖动距离 × 系数 = 瞄准线长度）" })
    public aimLineFactor: number = 2;

    @property({ tooltip: "泥潭内硬币滑动阻尼（越大减速越明显）" })
    public mudDamping: number = 8;

    // ── 围墙与缺口数据（每局由 GameScene 从 TableController 同步） ──
    /** 围墙厚度 */
    public wallThickness: number = 8;
    /** 本局所有缺口 */
    public gaps: { side: number; center: number }[] = [];
    /** 缺口宽度 */
    public gapWidth: number = 80;

    // @property({ type: Graphics, tooltip: "拖拽引导线绘制组件" })
    // public dragGraphics: Graphics = null!;

    private _currentPhase: GamePhase = GamePhase.WAITING_PLAYER;

    /** 当前游戏阶段，切换时重置闲置计时 */
    private set currentPhase(value: GamePhase) {
        this._currentPhase = value;
        this.tutorialManager?.resetIdleTimer();
    }

    private get currentPhase(): GamePhase {
        return this._currentPhase;
    }
    public coinHitCount: number = 0;
    public coinFallCount: number = 0;
    private _activeShotCoin: Node | null = null;
    private _lockedCoin: Node | null = null;
    private _lastHitCoin: Node | null = null;
    /** 這一發打到的第二枚硬幣，失敗回放時閃紅。 */
    private _foulCoin: Node | null = null;
    /** 這一發射已經計過分的硬幣。同一枚被碰到兩次只算 1 次。 */
    private _hitCoinsThisShot: Set<Node> = new Set();
    private _gameStartTime: number = 0;
    /** 出手前硬幣快照，時光倒流時還原。 */
    private _shotSnapshot: { node: Node; x: number; y: number; vx: number; vy: number; shooter: boolean }[] = [];
    private _rewindFrom: { node: Node; x: number; y: number; toX: number; toY: number; shooter: boolean }[] = [];
    private _rewindElapsed = 0;
    private readonly _rewindDuration = 0.3;
    private _fallen = new Set<Node>();
    private _awaitingTapRestart = false;
    private _tapArmedAt = 0;
    private _run: RunProgressionManager | null = null;
    private _failHints: FailureAnalysisManager | null = null;
    private _worldStats: WorldStatsDisplay | null = null;
    /** Geometry Dash 式節奏音高。只有完全沒打中才回到 1。 */
    private _rhythmPitch = 1;

    /** 场上所有道具节点（障碍物 + 陷阱），关卡开始时统一清理 */
    private _props: Node[] = [];

    /** 场上所有泥潭区域节点（硬币中心进入后提高摩擦阻尼） */
    private _muds: Node[] = [];

    /** 场上所有炸弹硬币节点（被撞击静止后触发爆炸） */
    private _bombCoins: Node[] = [];

    @property({ type: Node, tooltip: "所有瞄准线节点的父节点" })
    public aimGroup: Node = null!;
    /** 瞄准线圆点对象池 */
    private _aimDots: Node[] = [];
    private _aimDotIdx: number = 0;
    /** 圆点共用的白色 spriteFrame（启动时创建） */
    private _dotFrame: SpriteFrame | null = null;

    /** 场上泥潭区域列表 */
    public get muds(): Node[] {
        return this._muds;
    }

    // ── 摄像机追踪 ──
    private _mainCameraNode: Node | null = null;
    private _mainCameraComp: Camera | null = null;
    private _originalCamPos: Vec3 = new Vec3();
    private _defaultOrthoHeight: number = 0;

    /** 慢动作是否生效中 */
    private _isSlowMotion: boolean = false;

    /** 慢动作开始时间（毫秒） */
    private _slowMotionStartTime: number = 0;

    // ── 教程管理器 ──
    /** 教程管理器引用（由 GameScene 注入，可为 null） */
    public tutorialManager: TutorialManager | null = null;

    /** 教程模式下是否允许拖动这枚硬币 */
    public canLaunchCoin(coin: Node): boolean {
        if (this.tutorialManager?.isActive()) {
            return this.tutorialManager.onCoinDragStart(coin);
        }
        return true;
    }

    /** 慢动作最长持续毫秒数 */
    private readonly _slowMotionMaxDuration: number = 3000;

    /** 设置拖拽距离（由 CoinController 每帧更新），委托给 HitEffectManager */
    public setDragDistance(dist: number): void {
        this.hitEffectManager?.setDragDistance(dist);
    }

    /** 获取或创建瞄准线圆点 */
    private _getAimDot(): Node {
        if (this._aimDotIdx < this._aimDots.length) {
            const dot = this._aimDots[this._aimDotIdx++];
            dot.active = true;
            return dot;
        }
        const dot = new Node('AimDot');
        dot.layer = 1;
        this.aimGroup.addChild(dot);
        const ut = dot.addComponent(UITransform);
        ut.setContentSize(6, 6);
        ut.setAnchorPoint(0.5, 0.5);
        const sp = dot.addComponent(Sprite);
        sp.sizeMode = Sprite.SizeMode.CUSTOM;
        sp.color = new Color(255, 255, 100, 220);
        if (this._dotFrame) sp.spriteFrame = this._dotFrame;
        this._aimDots.push(dot);
        this._aimDotIdx++;
        return dot;
    }

    /** 绘制带墙壁反射的瞄准线（用圆点阵列代替 Graphics） */
    public drawAimLine(fromX: number, fromY: number, dirX: number, dirY: number): void {
        this._aimDotIdx = 0;

        const len = Math.hypot(dirX, dirY);
        if (len < 0.001) { this._hideAimDots(); return; }
        let dx = dirX / len;
        let dy = dirY / len;

        const aimLength = len * (this._run?.effectiveAim(this.aimLineFactor) ?? this.aimLineFactor);
        const limitX = this.tableWidth / 2 - this.wallThickness - this.coinRadius;
        const limitY = this.tableHeight / 2 - this.wallThickness - this.coinRadius;
        const gapHalf = this.gapWidth / 2;
        const eps = 0.25;

        let x = Math.max(-limitX, Math.min(limitX, fromX));
        let y = Math.max(-limitY, Math.min(limitY, fromY));
        const pts: { x: number; y: number }[] = [{ x, y }];
        let remaining = aimLength;

        for (let bounce = 0; bounce < 8 && remaining > eps; bounce++) {
            let tx = Number.POSITIVE_INFINITY;
            let ty = Number.POSITIVE_INFINITY;
            if (dx > 1e-6) tx = (limitX - x) / dx;
            else if (dx < -1e-6) tx = (-limitX - x) / dx;
            if (dy > 1e-6) ty = (limitY - y) / dy;
            else if (dy < -1e-6) ty = (-limitY - y) / dy;

            const hitX = tx > eps && tx <= remaining;
            const hitY = ty > eps && ty <= remaining;
            if (!hitX && !hitY) {
                pts.push({ x: x + dx * remaining, y: y + dy * remaining });
                break;
            }

            const nearCorner = hitX && hitY && Math.abs(tx - ty) <= 1;
            const t = nearCorner ? Math.min(tx, ty) : (hitX && (!hitY || tx <= ty) ? tx : ty);
            const bounceX = nearCorner || (hitX && t === tx);
            const bounceY = nearCorner || (hitY && t === ty);

            x += dx * t;
            y += dy * t;
            remaining -= t;
            pts.push({ x, y });

            const throughGap = (bounceX && this._aimHitsGap(dx > 0 ? 1 : 3, y, gapHalf))
                || (bounceY && this._aimHitsGap(dy > 0 ? 0 : 2, x, gapHalf));
            if (throughGap || remaining <= eps) break;

            if (bounceX) dx = -dx;
            if (bounceY) dy = -dy;
            x += dx * eps;
            y += dy * eps;
            remaining -= eps;
        }

        this._stampAimDots(pts, aimLength);
        this._hideAimDots();
    }

    /** 這一點是不是落在牆的缺口上。缺口不反彈，線停在這裡。 */
    private _aimHitsGap(side: number, along: number, gapHalf: number): boolean {
        if (gapHalf <= 0 || this.gaps.length === 0) return false;
        return this.gaps.some((gap) => gap.side === side && Math.abs(along - gap.center) < gapHalf);
    }

    /** 沿折線每 12px 放一個點，轉角把剩餘間距帶到下一段，避免斷開或重疊。 */
    private _stampAimDots(pts: { x: number; y: number }[], aimLength: number): void {
        const step = 12;
        let untilDot = step;
        let traveled = 0;
        for (let i = 0; i < pts.length - 1; i++) {
            const ax = pts[i].x;
            const ay = pts[i].y;
            const bx = pts[i + 1].x;
            const by = pts[i + 1].y;
            const segLen = Math.hypot(bx - ax, by - ay);
            if (segLen < 0.001) continue;

            let walked = 0;
            while (walked + untilDot <= segLen + 0.001) {
                walked += untilDot;
                traveled += untilDot;
                if (traveled > aimLength) return;
                const t = walked / segLen;
                const dot = this._getAimDot();
                dot.setPosition(ax + (bx - ax) * t, ay + (by - ay) * t, 0);
                const alpha = Math.round(220 * (1 - traveled / aimLength));
                dot.getComponent(Sprite)!.color = new Color(255, 255, 100, Math.max(0, alpha));
                untilDot = step;
            }
            const rest = segLen - walked;
            traveled += rest;
            untilDot -= rest;
            if (untilDot < 0.001) untilDot = step;
        }
    }

    /** 隐藏多余的圆点 */
    private _hideAimDots(): void {
        for (let i = this._aimDotIdx; i < this._aimDots.length; i++) {
            this._aimDots[i].active = false;
        }
    }

    /** 清除瞄准线 */
    public clearAimLine(): void {
        this._aimDotIdx = 0;
        this._hideAimDots();
    }

    /** 设置游戏物理速度倍率（只改 fixedTimeStep，不重置累积器） */
    private _setGameSpeed(speed: number): void {
        PhysicsSystem2D.instance.fixedTimeStep = (1 / 60) * speed;
        if (speed >= 1) {
            PhysicsSystem2D.instance.resetAccumulator(0);
        }
        this._isSlowMotion = speed < 1;
        if (this._isSlowMotion) {
            this._slowMotionStartTime = Date.now();
        }
    }

    /** 恢复速度到正常值（仅在慢动作时生效） */
    private _restoreSpeed(): void {
        if (!this._isSlowMotion) return;
        this._setGameSpeed(1);
    }

    public score: number = 0;
    /** 連續成功次數。失敗或開新關時歸零。 */
    private _combo = 0;
    private static readonly _COMBO_MULTIPLIERS = [1, 1.5, 2];
    public onCoinsLeft: ((count: number) => void) | null = null;
    private _coinsLeftShown = -1;
    public onGameOver: ((duration: number) => void) | null = null;
    public onScoreUpdate: ((score: number, multiplier: number) => void) | null = null;
    public onGameWin: ((duration: number) => void) | null = null;

    /** 当前活跃的弹射硬币（用于碰撞检测） */
    public get activeShotCoin(): Node | null {
        return this._activeShotCoin;
    }

    /** 新的一關開始。分數與過關時間都從這一關起算。 */
    public beginLevel(): void {
        this.score = 0;
        this._combo = 0;
        this._coinsLeftShown = -1;
        this._gameStartTime = Date.now();
        this._fallen.clear();
        this._awaitingTapRestart = false;
        this._rhythmPitch = 1;
        this._disarmTapRestart();
        this._ensureManagers();
        this._run?.beginRun(this.aimLineFactor);
        this._worldStats?.resetBest();
        this._worldStats?.ensure(this.coinGroup, this.tableHeight);
        this._worldStats?.sync(0, this.countCoins());
        this.onScoreUpdate?.(this.score, 1);
    }

    public countCoins(): number {
        if (!this.coinGroup) return 0;
        let count = 0;
        for (const child of this.coinGroup.children) {
            if (child.getComponent(CoinController)) count++;
        }
        return count;
    }

    /** 這一發成功。第 1 發 x1，第 2 發 x1.5，之後 x2；局內 buff 可再加一檔。 */
    private _awardSuccess(): void {
        const caps = GameLogic._COMBO_MULTIPLIERS.slice();
        const extra = this._run?.comboCapExtra ?? 0;
        for (let i = 0; i < extra; i++) caps.push(caps[caps.length - 1] + 1);
        const index = Math.min(this._combo, caps.length - 1);
        const multiplier = caps[index];
        this._combo++;
        this.score += multiplier;
        this.onScoreUpdate?.(this.score, multiplier);
        this._worldStats?.sync(this._combo, this.countCoins());
    }

    private _mod: GameLogicInterpreter | null = null;
    private _modShotCount = 0;

    private _ensureManagers(): void {
        this._run = this.getComponent(RunProgressionManager) ?? this.addComponent(RunProgressionManager);
        this._failHints = this.getComponent(FailureAnalysisManager) ?? this.addComponent(FailureAnalysisManager);
        this._worldStats = this.getComponent(WorldStatsDisplay) ?? this.addComponent(WorldStatsDisplay);
        this._bindModInterpreter();
    }

    private _bindModInterpreter(): void {
        this._mod = GameLogicInterpreter.getOrCreate();
        const host: ModRuntimeHost = {
            coinGroup: this.coinGroup,
            countCoins: () => this.countCoins(),
            getShotCount: () => this._modShotCount,
            getCombo: () => this._combo,
            getActiveShotCoin: () => this._activeShotCoin,
            getLastHitCoin: () => this._lastHitCoin,
            getCoinDamping: () => this.coinDamping,
            setCoinDamping: (v) => { this.coinDamping = v; },
            triggerTimeReverse: () => this.startTimeReverse(),
            declareWin: () => this._handleGameWin(),
            declareLose: () => this._handleGameOver(),
            shakeCamera: (intensity, dir) => {
                this.hitEffectManager?.shakeCamera(intensity, dir ?? new Vec2(1, 0));
            },
            playClipById: (_sfxId, pitch) => {
                SoundManager.instance?.playShot(typeof pitch === 'number' ? pitch : 1);
            },
            getElapsedSeconds: () => Math.floor((Date.now() - this._gameStartTime) / 1000),
            getScore: () => this.score,
            hasBossTagged: () => false,
            applyCoinSkin: (coin, preset, url) => {
                const sync = this.getComponent(AssetSyncManager) ?? AssetSyncManager.instance;
                if (!sync) return;
                sync.applyCoinSkin(coin, {
                    preset: preset || undefined,
                    default: url || undefined,
                    idle: url || undefined,
                });
            },
            applyTableSkin: (felt, wall) => {
                const sync = this.getComponent(AssetSyncManager) ?? AssetSyncManager.instance;
                const table = this.node.scene?.getComponentInChildren(TableController) ?? null;
                sync?.applyTableConfig(table, {
                    felt: felt || undefined,
                    wall: wall || undefined,
                });
            },
        };
        this._mod.bindHost(host);
        if (!this._mod.mod) this._mod.loadCached();
    }

    /** Load a community sandbox share code at runtime (no Canvas HUD change). */
    public loadModShareCode(code: string): boolean {
        this._bindModInterpreter();
        return this._mod?.loadFromShareCode(code) ?? false;
    }

    protected start(): void {
        this._gameStartTime = Date.now();
        this._ensureManagers();
        this._run?.beginRun(this.aimLineFactor);
        this._worldStats?.ensure(this.coinGroup, this.tableHeight);
        MemeLoader.checkAndDownload();
        const sync = this.getComponent(AssetSyncManager) ?? this.addComponent(AssetSyncManager);
        sync.sync(() => {
            const remoteMod = sync.getMod();
            if (remoteMod) this._mod?.load(remoteMod);
            this._mod?.onGameStart();
        });
        this._mod?.onGameStart();

        // 自动创建拖拽引导线 Graphics 节点（挂在 coinGroup 下，与硬币同坐标系）
        // if (!this.dragGraphics) {
        //     const gNode = new Node('DragLine');
        //     gNode.layer = 1; // WORLD
        //     this.coinGroup.addChild(gNode);
        //     this.dragGraphics = gNode.addComponent(Graphics);
        // }

        // 创建瞄准线圆点共用的白色 spriteFrame
        if (!this._dotFrame) {
            const tex = new Texture2D();
            tex.reset({ width: 1, height: 1, format: Texture2D.PixelFormat.RGBA8888 });
            const colors = new Uint8Array([255, 255, 255, 255]);
            tex.uploadData(colors);
            this._dotFrame = new SpriteFrame();
            this._dotFrame.texture = tex;
        }

        // 获取 MainCamera 并保存原始位置和默认 orthoHeight
        const camNode = this.node.parent?.getChildByName('MainCamera');
        if (camNode) {
            this._mainCameraNode = camNode;
            this._originalCamPos.set(camNode.position);
            this._mainCameraComp = camNode.getComponent(Camera);
            if (this._mainCameraComp) {
                this._defaultOrthoHeight = this._mainCameraComp.orthoHeight;
            }
        }

        // 注册全局碰撞回调
        if (PhysicsSystem2D.instance) {
            PhysicsSystem2D.instance.on(Contact2DType.BEGIN_CONTACT, this._onBeginContact, this);
        }

        // 收集场景中已放置的道具节点（如 Table/Mud），使其同样生效
        this._collectExistingProps();

        // 测试钩子：点击桌面空白处播放龙卷风
        //input.on(Input.EventType.MOUSE_DOWN, this._onTestClick, this);
    }

    protected onDestroy(): void {
        this._disarmTapRestart();
        if (PhysicsSystem2D.instance) {
            PhysicsSystem2D.instance.off(Contact2DType.BEGIN_CONTACT, this._onBeginContact, this);
        }
        //input.off(Input.EventType.MOUSE_DOWN, this._onTestClick, this);
    }

    /** PhysicsSystem2D 全局碰撞回调：活跃弹射硬币撞到其他硬币时计数 */
    private _onBeginContact(a: Collider2D, b: Collider2D): void {
        const nodeA = a.node;
        const nodeB = b.node;

        // 任意硬币碰撞：检查是否有炸弹硬币被撞击并激活
        const markerA = nodeA.getComponent(BombCoinMarker);
        const markerB = nodeB.getComponent(BombCoinMarker);
        if (markerA && !markerA.activated) markerA.activated = true;
        if (markerB && !markerB.activated) markerB.activated = true;

        const behaviorConsumed = BehaviorResolver.resolveContact(nodeA, nodeB, this);

        if (!this._activeShotCoin) return;

        // 只处理硬币-硬币碰撞，跳过围墙碰撞
        const otherNode = nodeA === this._activeShotCoin ? nodeB : nodeA;
        if (nodeA !== this._activeShotCoin && nodeB !== this._activeShotCoin) return;
        if (this._hitCoinsThisShot.has(otherNode)) return;

        // 假幣誘餌：高速穿過 + 紙屑，不算命中
        const decoy = otherNode.getComponent(FakeCoinDecoy);
        if (decoy?.tryGhost(this._activeShotCoin, this.coinGroup)) return;

        // 主動行為已消費碰撞：仍算一次命中，避免被判定成 miss，但不再播一般打擊特效。
        if (behaviorConsumed) {
            const hitCtrl = otherNode.getComponent(CoinController);
            const hitBomb = otherNode.getComponent(BombCoinMarker);
            if (hitCtrl || hitBomb) {
                this._hitCoinsThisShot.add(otherNode);
                this.coinHitCount++;
                if (this.coinHitCount === 2) this._foulCoin = otherNode;
                this.resetIdleTimer();
                this.onCoinHitByActiveShot(otherNode);
                this.tutorialManager?.onCoinHit(otherNode);
            }
            return;
        }

        // 撞到炸弹硬币：仅计数，不触发打击特效
        const hitBomb = otherNode.getComponent(BombCoinMarker);
        if (hitBomb) {
            this._hitCoinsThisShot.add(otherNode);
            this.coinHitCount++;
            if (this.coinHitCount === 2) this._foulCoin = otherNode;
            this.resetIdleTimer();
            this.tutorialManager?.onCoinHit(otherNode);
            return;
        }

        const hitCtrl = otherNode.getComponent(CoinController);
        if (!hitCtrl) return;

        // 首次碰撞：委托给 HitEffectManager 处理特效
        const hitPos = new Vec3(
            (nodeA.position.x + nodeB.position.x) / 2,
            (nodeA.position.y + nodeB.position.y) / 2,
            0,
        );
        if (this.coinHitCount === 0) {
            this.hitEffectManager?.onHit(hitPos, otherNode, this._activeShotCoin, this);
        } else {
            this._restoreSpeed();
        }
        this._impactJuice(otherNode, this._activeShotCoin);

        // 被打击硬币切换被打击贴图 + 連鎖節奏音（每下 +0.08）
        hitCtrl.showHit();
        this._playChainHitSfx(hitCtrl.hittedSfxClip);

        this._hitCoinsThisShot.add(otherNode);
        this.coinHitCount++;
        if (this.coinHitCount === 2) {
            this._foulCoin = otherNode;
            SoundManager.instance?.playSecondaryCollision(this._rhythmPitch);
        }

        this.onCoinHitByActiveShot(otherNode);
        this.tutorialManager?.onCoinHit(otherNode);
        this._mod?.onCoinHit({
            coin: otherNode,
            other: this._activeShotCoin,
            velocity: this._activeShotCoin?.getComponent(RigidBody2D)?.linearVelocity.length() ?? 0,
            x: hitPos.x,
            y: hitPos.y,
        });
    }

    // ── 供 HitEffectManager 调用的公开桥接方法 ──

    /** 设置物理速度（公开桥接） */
    public setGameSpeed(speed: number): void {
        this._setGameSpeed(speed);
    }

    /** 恢复物理速度（公开桥接） */
    public restoreSpeed(): void {
        this._restoreSpeed();
    }

    /** 向世界根节点添加子节点（公开桥接，用于特效） */
    public addChildToWorld(node: Node): void {
        this.node.parent?.addChild(node);
    }

    // ── 道具：障碍物（Blocker）与陷阱（Mud） ──

    /** 在指定位置放置障碍物（关卡配置用，无飞入动画），radius 缺省时使用 prefab 默认尺寸 */
    public spawnBlockerAt(x: number, y: number, radius?: number): void {
        if (!this.blockerPrefab) return;
        const node = instantiate(this.blockerPrefab);
        this.addChildToWorld(node);
        node.setPosition(x, y, 0);
        if (radius && radius > 0) {
            const ut = node.getComponent(UITransform);
            if (ut) ut.setContentSize(radius * 2, radius * 2);
            const cc = node.getComponent(CircleCollider2D);
            if (cc) cc.radius = radius;
        }
        this._props.push(node);
    }

    /** 在指定位置放置陷阱（关卡配置用，无飞入动画），radius 缺省时使用 prefab 默认尺寸 */
    public spawnMudAt(x: number, y: number, radius?: number): void {
        if (!this.mudPrefab) return;
        const node = instantiate(this.mudPrefab);
        this.addChildToWorld(node);
        node.setPosition(x, y, 0);
        let mudRadius = 64;
        if (radius && radius > 0) {
            const ut = node.getComponent(UITransform);
            if (ut) { ut.setContentSize(radius * 2, radius * 2); mudRadius = radius; }
        }
        // 添加物理组件：Kinematic 刚体 + 传感器碰撞体（不与硬币产生物理碰撞）
        const rb = node.addComponent(RigidBody2D);
        rb.type = ERigidBody2DType.Kinematic;
        rb.enabledContactListener = true;
        const cc = node.addComponent(CircleCollider2D);
        cc.sensor = true;
        cc.radius = mudRadius;
        // MudController 管理速度和墙壁碰撞
        const mc = node.addComponent(MudController);
        mc.tableWidth = this.tableWidth;
        mc.tableHeight = this.tableHeight;
        mc.wallThickness = this.wallThickness;
        mc.mudRadius = mudRadius;
        this._props.push(node);
        this._muds.push(node);
    }

    /** 在指定位置生成普通硬币（关卡配置用），radius 缺省时使用 coinRadius */
    public spawnCoinAt(prefab: Prefab, x: number, y: number, radius?: number, behaviorId?: string): Node {
        const node = instantiate(prefab);
        this.coinGroup.addChild(node);
        node.setPosition(x, y, 0);
        node.setScale(1, 1, 1);
        const r = radius ?? this.coinRadius;
        const ut = node.getComponent(UITransform);
        if (ut) ut.setContentSize(r * 2, r * 2);
        const cc = node.getComponent(CircleCollider2D);
        if (cc) cc.radius = r;
        const ctrl = node.addComponent(CoinController);
        ctrl.setGameLogic(this);
        if (behaviorId) this.attachCoinBehavior(node, behaviorId);
        return node;
    }

    /**
     * 依註冊 id 把行為掛到硬幣上。
     * 例：this.attachCoinBehavior(coin, 'FreezeBehavior')
     */
    public attachCoinBehavior(coin: Node, behaviorId: string): void {
        BehaviorRegistry.attach(coin, behaviorId);
    }

    /**
     * 用已下載的 Meme 生成硬幣。
     * 找不到資料或圖片解不開時，仍生成一枚預設外觀的硬幣。
     */
    public spawnMemeCoinAt(memeId: string, x: number, y: number): Node | null {
        if (!this.coinPrefab) {
            console.warn('[Meme] 尚未設定 coinPrefab');
            return null;
        }
        const meme = MemeLoader.getLoadedMemes().find((item) => item.id === memeId);
        if (!meme) {
            console.warn('[Meme] 找不到，改用預設硬幣:', memeId);
            return this.spawnCoinAt(this.coinPrefab, x, y);
        }
        const node = this.spawnCoinAt(
            this.coinPrefab,
            x,
            y,
            meme.radius > 0 ? meme.radius : undefined,
            meme.behavior || undefined,
        );
        MemeLoader.applySprite(memeId, (frame) => {
            if (!frame || !node.isValid) return;
            const sprite = CoinController.getCoinSprite(node);
            if (sprite) sprite.spriteFrame = frame;
        });
        return node;
    }

    /** 在指定位置生成炸弹硬币（关卡配置用），被撞击静止后触发爆炸 */
    public spawnBombCoinAt(prefab: Prefab, x: number, y: number, radius?: number): void {
        const node = instantiate(prefab);
        this.coinGroup.addChild(node);
        node.setPosition(x, y, 0);
        node.setScale(1, 1, 1);
        const r = radius ?? this.coinRadius;
        const ut = node.getComponent(UITransform);
        if (ut) ut.setContentSize(r * 2, r * 2);
        const cc = node.getComponent(CircleCollider2D);
        if (cc) cc.radius = r;
        this.markBombCoin(node);
    }

    /** 为泥潭节点添加物理组件（Kinematic 刚体 + 传感器碰撞体 + MudController） */
    private _addMudPhysics(node: Node): void {
        const ut = node.getComponent(UITransform);
        const mudRadius = ut ? ut.width / 2 : 64;
        if (!node.getComponent(RigidBody2D)) {
            const rb = node.addComponent(RigidBody2D);
            rb.type = ERigidBody2DType.Kinematic;
            rb.enabledContactListener = true;
        }
        if (!node.getComponent(CircleCollider2D)) {
            const cc = node.addComponent(CircleCollider2D);
            cc.sensor = true;
            cc.radius = mudRadius;
        }
        if (!node.getComponent(MudController)) {
            const mc = node.addComponent(MudController);
            mc.tableWidth = this.tableWidth;
            mc.tableHeight = this.tableHeight;
            mc.wallThickness = this.wallThickness;
            mc.mudRadius = mudRadius;
        }
    }

    /** 收集场景中已放置的道具节点（如 Table/Mud 占位），使其同样生效 */
    private _collectExistingProps(): void {
        const world = this.node.parent;
        if (!world) return;
        const stack: Node[] = [world];
        while (stack.length > 0) {
            const n = stack.pop()!;
            if (n !== world && n.isValid && (n.name === 'Mud' || n.name === 'Blocker')) {
                if (!this._props.includes(n)) {
                    this._props.push(n);
                    if (n.name === 'Mud') {
                        this._muds.push(n);
                        this._addMudPhysics(n);
                    }
                }
            }
            for (const c of n.children) stack.push(c);
        }
    }

    /** 关卡开始时清理场上所有道具（障碍物与陷阱），并重置追踪列表 */
    public clearProps(): void {
        // 兜底收集（避免与 GameLogic.start 的执行顺序无关地漏掉场景预放的道具）
        this._collectExistingProps();
        for (const p of this._props) {
            if (p && p.isValid) p.destroy();
        }
        this._props.length = 0;
        this._muds.length = 0;
        this._bombCoins.length = 0;
    }

    /** 泥潭摩擦：硬币中心在泥潭区域内时提高线性阻尼，离开后恢复 */
    private _applyMudFriction(): void {
        if (this._muds.length === 0) return;
        for (const coin of this.coinGroup.children) {
            const rb = coin.getComponent(RigidBody2D);
            if (!rb) continue;
            const pos = coin.worldPosition;
            let inMud = false;
            for (const mud of this._muds) {
                if (!mud.isValid) continue;
                const ut = mud.getComponent(UITransform);
                const radius = (ut ? ut.width / 2 : 64) * mud.worldScale.x;
                const mpos = mud.worldPosition;
                const dx = pos.x - mpos.x;
                const dy = pos.y - mpos.y;
                if (dx * dx + dy * dy <= radius * radius) {
                    inMud = true;
                    break;
                }
            }
            const target = inMud ? this.mudDamping : this.coinDamping;
            if (rb.linearDamping !== target) rb.linearDamping = target;
        }
    }

    // ── 测试辅助：点击桌面空白处播放龙卷风 ──

    /** 点击空白处（不在任何硬币上）时，在该处播放龙卷风，方便测试 */
    private _onTestClick(event: EventMouse | EventTouch): void {
        if (!this.hitEffectManager) return;

        const wp = this._screenToTablePos(event.getLocation());
        if (!wp) return;

        // 点击到硬币上（会触发拖拽），不触发测试龙卷风
        if (this._hitTestCoin(wp)) return;

        this.hitEffectManager.playTestTornado(Vec3.ZERO, 5);
    }

    /** 屏幕坐标 → 桌面平面（z=0）上的世界坐标 */
    private _screenToTablePos(loc: Vec2): Vec3 | null {
        const camNode = this._mainCameraNode;
        const cam = this._mainCameraComp;
        if (!camNode || !cam) return null;
        // screenToWorld 的 z 参数为沿相机前方向的距离；相机在 z=1000，桌面在 z=0
        const wp = cam.screenToWorld(new Vec3(loc.x, loc.y, camNode.position.z));
        return new Vec3(wp.x, wp.y, 0);
    }

    /** 点击位置是否落在某枚硬币上 */
    private _hitTestCoin(worldPos: Vec3): boolean {
        if (!this.coinGroup) return false;
        const r = this.coinRadius;
        for (const coin of this.coinGroup.children) {
            const dx = coin.position.x - worldPos.x;
            const dy = coin.position.y - worldPos.y;
            if (dx * dx + dy * dy <= r * r) {
                return true;
            }
        }
        return false;
    }

    update(deltaTime: number) {
        if (this.currentPhase === GamePhase.REVERSING) {
            this._tickTimeReverse(deltaTime);
            return;
        }

        this._mod?.tick(deltaTime);

        // 1. 持续监测坠落（在任意状态下均可坠落）
        this.checkCoinFalls();

        // 2. 桌面边界反弹（含缺口侧边）
        this._applyWallBounce();

        // 2.5 泥潭摩擦：硬币中心在泥潭区域内时提高阻尼
        this._applyMudFriction();

        // 2.6 被動行為（磁鐵、持續減速等）
        BehaviorResolver.tick(deltaTime, this);

        // 3. 慢动作超时保护：3秒后自动恢复
        if (this._isSlowMotion && Date.now() - this._slowMotionStartTime >= this._slowMotionMaxDuration) {
            this._restoreSpeed();
        }

        // 4. 摄像机跟踪：发射中跟随硬币，否则平滑回到原始位置
        this._updateCamera(deltaTime);

        // 5. 空闲提示：由 TutorialManager 处理

        // 5. 摄像机还原后，启用待命的下一次击打
        if (this._pendingLockedCoin && this.hitEffectManager?.isCameraAtRest) {
            console.log('[Game] enabling pending locked coin:', this._pendingLockedCoin.name);
            const ctrl = this._pendingLockedCoin.getComponent(CoinController);
            if (ctrl) {
                ctrl.allowedOperation = true;
                ctrl.showIndicator(true);
            }
            this._run?.attachAura(this.coinGroup, this._pendingLockedCoin);
            this._captureShot();
            this._pendingLockedCoin = null;
        }

        const shooter = this._run?.findShooter(this.coinGroup) ?? null;
        this._run?.followShooter(shooter);

        const coinsLeft = this.countCoins();
        if (coinsLeft !== this._coinsLeftShown) {
            this._coinsLeftShown = coinsLeft;
            this.onCoinsLeft?.(coinsLeft);
            this._worldStats?.sync(this._combo, coinsLeft);
        }

        // 6. 物理模拟中：检查是否静止
        if (this.currentPhase === GamePhase.ANIMATING) {
            if (this.isAllCoinsStopped()) {
                // 先检查是否有已激活的炸弹硬币需要爆炸
                const activatedBomb = this._findActivatedBombCoin();
                if (activatedBomb) {
                    this.triggerBombCoinExplosion(activatedBomb);
                    // 爆炸后硬币继续运动，保持 ANIMATING 状态等待再次静止
                } else {
                    this.currentPhase = GamePhase.SETTLING;
                    this.processResult();
                }
            }
        }
    }

    /** 摄像机跟随逻辑，委托给 HitEffectManager */
    private _updateCamera(dt: number): void {
        if (!this._mainCameraNode || !this._mainCameraComp) return;
        this.hitEffectManager?.updateCamera(
            dt,
            this._mainCameraNode,
            this._mainCameraComp,
            this._originalCamPos,
            this._defaultOrthoHeight,
            this._isSlowMotion,
        );
    }

    // 检查所有硬币是否都停下了
    private isAllCoinsStopped(): boolean {
        for (let coin of this.coinGroup.children) {
            let rb = coin.getComponent(RigidBody2D);
            if (rb && rb.linearVelocity.length() > this.speedThreshold) {
                return false; // 只要有一个还在动，就不算静止
            }
        }
        return true;
    }

    /** 硬币在桌面边界反弹（考虑围墙厚度与所有缺口） */
    private _applyWallBounce(): void {
        const halfW = this.tableWidth / 2 - this.wallThickness - this.coinRadius;
        const halfH = this.tableHeight / 2 - this.wallThickness - this.coinRadius;
        const hw = this.tableWidth / 2;
        const hh = this.tableHeight / 2;
        const hg = this.gapWidth / 2;

        for (const coin of this.coinGroup.children) {
            const rb = coin.getComponent(RigidBody2D);
            if (!rb) continue;

            const pos = coin.position;
            const vel = rb.linearVelocity;
            let newX = pos.x;
            let newY = pos.y;
            let newVx = vel.x;
            let newVy = vel.y;
            let bounced = false;

            // 检查硬币当前是否处于某面墙的缺口范围内
            const inGap = (wallSide: number, alongPos: number): boolean =>
                this.gaps.some(g => g.side === wallSide && Math.abs(alongPos - g.center) < hg);

            // 右墙反弹（缺口处跳过）
            if (pos.x > halfW && vel.x > 0) {
                if (!inGap(1, pos.y)) {
                    newX = halfW;
                    newVx = -vel.x * 0.7;
                    bounced = true;
                }
            } else if (pos.x < -halfW && vel.x < 0) {
                if (!inGap(3, pos.y)) {
                    newX = -halfW;
                    newVx = -vel.x * 0.7;
                    bounced = true;
                }
            }

            // 上墙反弹（缺口处跳过）
            if (pos.y > halfH && vel.y > 0) {
                if (!inGap(0, pos.x)) {
                    newY = halfH;
                    newVy = -vel.y * 0.7;
                    bounced = true;
                }
            } else if (pos.y < -halfH && vel.y < 0) {
                if (!inGap(2, pos.x)) {
                    newY = -halfH;
                    newVy = -vel.y * 0.7;
                    bounced = true;
                }
            }

            // 缺口侧边反弹（遍历所有缺口）
            if (this.gaps.length > 0) {
                const out = { x: newX, y: newY, vx: newVx, vy: newVy };
                if (this._checkGapSideBounce(pos, vel, hw, hh, hg, out)) {
                    newX = out.x; newY = out.y;
                    newVx = out.vx; newVy = out.vy;
                    bounced = true;
                }
            }

            if (bounced) {
                // 撞到墙 → 恢复速度
                this._restoreSpeed();
                coin.setPosition(newX, newY, 0);
                rb.linearVelocity = new Vec2(newVx, newVy);
                // 硬币与墙碰撞音效
                SoundManager.instance?.playCollisionWall();
                this._mod?.onCushionBounce({
                    coin,
                    velocity: Math.hypot(newVx, newVy),
                    x: newX,
                    y: newY,
                });
            }
        }
    }

    /** 缺口侧边反弹检测（遍历所有缺口） */
    private _checkGapSideBounce(
        pos: Vec3, vel: Vec2,
        hw: number, hh: number, hg: number,
        out: { x: number; y: number; vx: number; vy: number },
    ): boolean {
        const cr = this.coinRadius;
        for (const gap of this.gaps) {
            if (gap.side === 0 || gap.side === 2) {
                // 上/下墙缺口：侧边为竖直面
                const wallBot = gap.side === 0 ? hh - this.wallThickness : -(hh - this.wallThickness);
                const wallTop = gap.side === 0 ? hh : -hh;
                const overlapsY = pos.y + cr > Math.min(wallBot, wallTop) && pos.y - cr < Math.max(wallBot, wallTop);
                if (!overlapsY) continue;

                const rEdge = gap.center + hg;
                if (pos.x + cr > rEdge && pos.x < rEdge + cr && vel.x >= 0) {
                    out.x = rEdge - cr; out.vx = -vel.x * 0.7; return true;
                }
                const lEdge = gap.center - hg;
                if (pos.x - cr < lEdge && pos.x > lEdge - cr && vel.x <= 0) {
                    out.x = lEdge + cr; out.vx = -vel.x * 0.7; return true;
                }
            } else {
                // 左/右墙缺口：侧边为水平面
                const wallL = gap.side === 3 ? -(hw - this.wallThickness) : hw - this.wallThickness;
                const wallR = gap.side === 3 ? -hw : hw;
                const overlapsX = pos.x + cr > Math.min(wallL, wallR) && pos.x - cr < Math.max(wallL, wallR);
                if (!overlapsX) continue;

                const tEdge = gap.center + hg;
                if (pos.y + cr > tEdge && pos.y < tEdge + cr && vel.y >= 0) {
                    out.y = tEdge - cr; out.vy = -vel.y * 0.7; return true;
                }
                const bEdge = gap.center - hg;
                if (pos.y - cr < bEdge && pos.y > bEdge - cr && vel.y <= 0) {
                    out.y = bEdge + cr; out.vy = -vel.y * 0.7; return true;
                }
            }
        }
        return false;
    }

    private checkCoinFalls() {
        const hw = this.tableWidth / 2;
        const hh = this.tableHeight / 2;

        for (let i = this.coinGroup.children.length - 1; i >= 0; i--) {
            const coin = this.coinGroup.children[i];
            const pos = coin.position;

            // 正在被打飞出界的硬币不判为掉落（由打飞特效自行处理）
            const ctrl = coin.getComponent(CoinController);
            if (ctrl && ctrl.isKnockingOut) continue;

            // 硬币中点离开桌面范围 → 掉落
            if (Math.abs(pos.x) > hw || Math.abs(pos.y) > hh) {
                this.onCoinFall(coin);
            }
        }
    }

    private onCoinFall(coin: Node) {
        if (this._fallen.has(coin)) return;
        this._fallen.add(coin);
        this._restoreSpeed();
        SoundManager.instance?.playCoinFall();
        this.coinFallCount++;
        const body = coin.getComponent(RigidBody2D);
        if (body) {
            body.linearVelocity = new Vec2(0, 0);
            body.angularVelocity = 0;
        }
        this._mod?.onCoinFall({ coin, x: coin.position.x, y: coin.position.y });
    }

    /** 被 CoinController 调用：记录当前弹射的硬币 */
    public setActiveShotCoin(coin: Node): void {
        this._activeShotCoin = coin;
    }

    /** 活跃弹射的硬币撞到了另一枚 */
    public onCoinHitByActiveShot(hitCoin: Node): void {
        if (!this._activeShotCoin) return;
        if (hitCoin === this._activeShotCoin) return;


        // 记录第一枚被撞的硬币（case 1 时锁定为下一发起手子弹）
        if (!this._lastHitCoin) {
            this._lastHitCoin = hitCoin;
        }
    }

    /** 标记一个硬币为炸弹硬币（由 GameScene._initFromLevel 调用） */
    public markBombCoin(node: Node): void {
        if (!node.getComponent(BombCoinMarker)) {
            node.addComponent(BombCoinMarker);
        }
        this._bombCoins.push(node);
    }

    /** 查找已激活（被撞击过）的炸弹硬币 */
    private _findActivatedBombCoin(): Node | null {
        for (const coin of this._bombCoins) {
            if (!coin || !coin.isValid) continue;
            const marker = coin.getComponent(BombCoinMarker);
            if (marker && marker.activated) return coin;
        }
        return null;
    }

    /** 触发炸弹硬币爆炸：在硬币位置执行与道具炸弹一致的爆炸效果 */
    public triggerBombCoinExplosion(bombCoin: Node): void {
        const pos = bombCoin.worldPosition;

        // 在炸弹硬币位置实例化爆炸动画（仅视觉，禁用 Bomb 组件避免重复爆炸）
        if (this.explosionPrefab) {
            const fxNode = instantiate(this.explosionPrefab);
            this.addChildToWorld(fxNode);
            fxNode.setWorldPosition(pos);
            const bombComp = fxNode.getComponent(Bomb);
            if (bombComp) {
                bombComp.enabled = false; // 禁用逻辑，仅播放动画
                // 手动播放动画，动画结束后自动销毁节点
                const anim = fxNode.getComponent(AnimationComponent);
                if (anim) {
                    anim.on(AnimationComponent.EventType.FINISHED, () => {
                        if (fxNode.isValid) fxNode.destroy();
                    });
                    anim.play();
                }
            }
        }

        // 执行爆炸物理效果
        SoundManager.instance?.playExplosion();
        Bomb.applyExplosionAt(pos, {
            pushRadius: this.bombPushRadius,
            pushForce: this.bombPushForce,
            coinGroup: this.coinGroup,
            props: this._props,
            muds: this._muds,
            mudPushFactor: this.bombMudPushFactor,
            tableWidth: this.tableWidth,
            tableHeight: this.tableHeight,
            wallThickness: this.wallThickness,
        });

        // 移除炸弹硬币。若下一發鎖的就是這顆炸彈，先解開，避免鎖到已銷毀的節點。
        const idx = this._bombCoins.indexOf(bombCoin);
        if (idx >= 0) this._bombCoins.splice(idx, 1);
        const lastHitWasBomb = this._lastHitCoin === bombCoin;
        bombCoin.removeFromParent();
        bombCoin.destroy();

        // 保留這次合法命中，回到 ANIMATING 等被推開的硬幣再次靜止。
        this.coinFallCount = 0;
        this._activeShotCoin = null;
        if (lastHitWasBomb) this._lastHitCoin = null;
        this.currentPhase = GamePhase.ANIMATING;

        this.resetIdleTimer();
    }

    private processResult() {
        console.log(">>> 物理静止，开始结算逻辑 <<<");

        // ── 教程模式 ──
        if (this.tutorialManager?.isActive()) {
            if (!this.tutorialManager.onTurnSettled()) {
                return; // 教程已处理失败（重置位置）
            }
            // 教程成功 → 播放打飞特效，跳过游戏结束/胜利判定
            this._awardSuccess();

            const afterKnockOut = () => {
                this._activeShotCoin = null;

                // 教程最后一步完成 → 结束教程，弹出胜利窗口
                if (this.tutorialManager?.wasLastStep()) {
                    this.tutorialManager.skipTutorial();
                    this._handleGameWin();
                    return;
                }

                // 锁定被撞硬币为下一发起手子弹
                this._lockedCoin = this._lastHitCoin;
                this._continueWithLockedCoin();
            };

            const shotCoin = this._activeShotCoin;
            const hitCoin = this._lastHitCoin;
            if (shotCoin && hitCoin && this.hitEffectManager) {
                this.hitEffectManager.playKnockOut(shotCoin, hitCoin, afterKnockOut);
            } else {
                if (shotCoin) {
                    shotCoin.removeFromParent();
                    shotCoin.destroy();
                }
                afterKnockOut();
            }
            return;
        }

        // ── 正常模式 ──
        const modResult = this._mod?.evaluateAfterSettle({
            fallenStriker: this.coinFallCount > 0 && !!this._activeShotCoin && this._fallen.has(this._activeShotCoin),
            coinsLeft: this.countCoins(),
        });
        if (modResult === 'win' || modResult === 'lose') return;

        // 失敗不開結算面板：點一下就把這一拍還原。
        if (this.coinFallCount > 0) {
            const fallen = this._foulCoin ?? this._activeShotCoin;
            this._failHints?.explainFall(
                this.coinGroup,
                fallen?.position.x ?? 0,
                fallen?.position.y ?? 0,
            );
            if (this.coinHitCount >= 2) this._mod?.onFoul({ coin: fallen });
            this._armTapRestart();
            return;
        }

        switch (this.coinHitCount) {
            case 0: {
                const shot = this._activeShotCoin;
                this._failHints?.explain(this.coinGroup, shot?.position.x ?? 0, shot?.position.y ?? 0, 0, null, shot);
                this._armTapRestart();
                return;
            }

            case 1: {
                this._awardSuccess();

                const afterKnockOut = () => {
                    this._activeShotCoin = null;
                    this._run?.onCoinCleared();

                    let coinCount = 0;
                    for (const child of this.coinGroup.children) {
                        if (child.getComponent(CoinController)) coinCount++;
                    }
                    if (coinCount <= 1) {
                        this._handleGameWin();
                        return;
                    }

                    this._lockedCoin = this._lastHitCoin;
                    this._continueWithLockedCoin();
                };

                const shotCoin = this._activeShotCoin;
                const hitCoin = this._lastHitCoin;
                if (shotCoin && hitCoin && this.hitEffectManager) {
                    this.hitEffectManager.playKnockOut(shotCoin, hitCoin, afterKnockOut);
                } else {
                    if (shotCoin) {
                        shotCoin.removeFromParent();
                        shotCoin.destroy();
                    }
                    afterKnockOut();
                }
                return;
            }

            default: {
                const hem = this.hitEffectManager;
                const coin = this._foulCoin;
                const shot = this._activeShotCoin;
                this._failHints?.explain(
                    this.coinGroup,
                    coin?.position.x ?? shot?.position.x ?? 0,
                    coin?.position.y ?? shot?.position.y ?? 0,
                    this.coinHitCount,
                    coin,
                    shot,
                );
                if (hem) hem.playFoulReplay(coin, () => {});
                this._armTapRestart();
                return;
            }
        }
    }

    /** 連鎖撞擊：當下音高播放，然後再升 0.08。 */
    private _playChainHitSfx(clip: AudioClip | null): void {
        const pitch = this._rhythmPitch;
        if (clip) SoundManager.instance?.playClip(clip, pitch);
        else SoundManager.instance?.playCollisionCoin(pitch);
        this._rhythmPitch = Math.min(2.4, this._rhythmPitch + 0.08);
    }

    /** 微震 + 被撞硬幣 squash / stretch。 */
    private _impactJuice(hit: Node, shot: Node | null): void {
        const dx = hit.position.x - (shot?.position.x ?? hit.position.x);
        const dy = hit.position.y - (shot?.position.y ?? hit.position.y);
        const dir = new Vec2(dx, dy);
        if (dir.length() > 0.001) dir.normalize();
        else dir.set(1, 0);
        this.hitEffectManager?.shakeCamera(0.09, dir);

        const visual = hit.getChildByName('Sprite') ?? hit;
        Tween.stopAllByTarget(visual);
        visual.setScale(1, 1, 1);
        tween(visual)
            .to(0.05, { scale: new Vec3(1.35, 0.62, 1) })
            .to(0.07, { scale: new Vec3(0.82, 1.22, 1) })
            .to(0.1, { scale: new Vec3(1, 1, 1) })
            .start();
    }

    /** 失敗後等玩家點一下倒流。有 mulligan 時自動倒流。 */
    private _armTapRestart(): void {
        this._combo = 0;
        if (this.coinHitCount === 0) this._rhythmPitch = 1;
        this._freezeAllCoins();
        this._restoreSpeed();
        this.hitEffectManager?.stopTracking();
        this._pendingLockedCoin = null;
        this._setCoinsInteraction(false);
        this.currentPhase = GamePhase.TAP_RESTART;
        this._worldStats?.sync(0, this.countCoins());
        if (this._run?.trySpendMulligan()) {
            this.scheduleOnce(() => this.startTimeReverse(), 0.08);
            return;
        }
        this._awaitingTapRestart = true;
        this._tapArmedAt = Date.now();
        input.on(Input.EventType.TOUCH_END, this._onTapRestart, this);
        input.on(Input.EventType.MOUSE_UP, this._onTapRestart, this);
    }

    private _disarmTapRestart(): void {
        input.off(Input.EventType.TOUCH_END, this._onTapRestart, this);
        input.off(Input.EventType.MOUSE_UP, this._onTapRestart, this);
        this._awaitingTapRestart = false;
    }

    private _onTapRestart = (_e?: EventTouch | EventMouse): void => {
        if (!this._awaitingTapRestart) return;
        if (Date.now() - this._tapArmedAt < 80) return;
        this.startTimeReverse();
    };

    private _freezeAllCoins(): void {
        if (!this.coinGroup) return;
        for (const coin of this.coinGroup.children) {
            const body = coin.getComponent(RigidBody2D);
            if (!body) continue;
            body.linearVelocity = new Vec2(0, 0);
            body.angularVelocity = 0;
        }
    }

    /** 相容舊呼叫：改走時光倒流。 */
    public instantRestart(): void {
        this.startTimeReverse();
    }

    /**
     * 時光倒流：停 tween、凍結物理，0.3 秒 lerp 回出手前位置，然後可射。
     */
    public startTimeReverse(): void {
        if (this.currentPhase === GamePhase.REVERSING) return;
        Tween.stopAll();
        this.hitEffectManager?.cancelFoulReplay();
        this._disarmTapRestart();
        this._restoreSpeed();
        this._freezeAllCoins();
        if (PhysicsSystem2D.instance) PhysicsSystem2D.instance.enable = false;

        this._rewindFrom = [];
        for (const snap of this._shotSnapshot) {
            if (!snap.node.isValid) continue;
            this._rewindFrom.push({
                node: snap.node,
                x: snap.node.position.x,
                y: snap.node.position.y,
                toX: snap.x,
                toY: snap.y,
                shooter: snap.shooter,
            });
        }
        this._rewindElapsed = 0;
        this.currentPhase = GamePhase.REVERSING;
        this.hitEffectManager?.stopTracking();
    }

    private _tickTimeReverse(dt: number): void {
        this._rewindElapsed += dt;
        const t = Math.min(1, this._rewindElapsed / this._rewindDuration);
        const e = t * t * (3 - 2 * t);
        for (const item of this._rewindFrom) {
            if (!item.node.isValid) continue;
            item.node.setPosition(
                item.x + (item.toX - item.x) * e,
                item.y + (item.toY - item.y) * e,
                0,
            );
        }
        if (t < 1) return;
        this._finishTimeReverse();
    }

    private _finishTimeReverse(): void {
        if (PhysicsSystem2D.instance) PhysicsSystem2D.instance.enable = true;
        for (const item of this._rewindFrom) {
            if (!item.node.isValid) continue;
            item.node.setPosition(item.toX, item.toY, 0);
            const body = item.node.getComponent(RigidBody2D);
            if (body) {
                if (body.type !== ERigidBody2DType.Dynamic) body.type = ERigidBody2DType.Dynamic;
                body.linearVelocity = new Vec2(0, 0);
                body.angularVelocity = 0;
                body.linearDamping = this.coinDamping;
            }
            const ctrl = item.node.getComponent(CoinController);
            if (!ctrl) continue;
            ctrl.isKnockingOut = false;
            ctrl.allowedOperation = item.shooter;
            ctrl.showIndicator(item.shooter);
            ctrl.showIdle();
            const visual = item.node.getChildByName('Sprite') ?? item.node;
            visual.setScale(1, 1, 1);
        }
        this._rewindFrom = [];
        this._fallen.clear();
        this._activeShotCoin = null;
        this._pendingLockedCoin = null;
        this._lastHitCoin = null;
        this._foulCoin = null;
        this.coinHitCount = 0;
        this.coinFallCount = 0;
        this._hitCoinsThisShot.clear();
        this.currentPhase = GamePhase.WAITING_PLAYER;
        this.tutorialManager?.resetIdleTimer();
        const shooter = this._run?.findShooter(this.coinGroup) ?? null;
        this._run?.attachAura(this.coinGroup, shooter);
        this._worldStats?.sync(this._combo, this.countCoins());
    }

    private _captureShot(): void {
        this._shotSnapshot = [];
        if (!this.coinGroup) return;
        for (const coin of this.coinGroup.children) {
            const ctrl = coin.getComponent(CoinController);
            if (!ctrl) continue;
            const body = coin.getComponent(RigidBody2D);
            this._shotSnapshot.push({
                node: coin,
                x: coin.position.x,
                y: coin.position.y,
                vx: body?.linearVelocity.x ?? 0,
                vy: body?.linearVelocity.y ?? 0,
                shooter: ctrl.allowedOperation,
            });
        }
    }

    /** 游戏结束处理（整關放棄才走這裡；一般失誤改走 instantRestart） */
    private _handleGameOver(): void {
        console.log(">>> 游戏结束 <<<");
        this._disarmTapRestart();
        this._combo = 0;
        this._restoreSpeed();
        this.hitEffectManager?.stopTracking();
        this._pendingLockedCoin = null;
        this.tutorialManager && (this.tutorialManager.gameOver = true);
        SoundManager.instance?.stopDragDirectionLoop();
        SoundManager.instance?.playGameOver();
        const duration = Math.floor((Date.now() - this._gameStartTime) / 1000);
        if (this.score > 0) {
            Leaderboard.addEntry(this.score, duration);
        }
        this._setCoinsInteraction(false);
        this.onGameOver?.(duration);
    }

    /** 游戏胜利（桌面仅剩 1 枚硬币） */
    private _handleGameWin(): void {
        console.log(">>> 游戏胜利 <<<");
        this._restoreSpeed();
        this.hitEffectManager?.stopTracking();
        this._pendingLockedCoin = null;
        this.tutorialManager && (this.tutorialManager.gameOver = true);
        SoundManager.instance?.stopDragDirectionLoop();
        this._setCoinsInteraction(false);
        const duration = Math.floor((Date.now() - this._gameStartTime) / 1000);
        if (this.score > 0) {
            Leaderboard.addEntry(this.score, duration);
        }
        this.onGameWin?.(duration);
    }

    /** 命中 1 枚硬币后的连击延续流程（延迟到摄像机还原后才启用操作） */
    private _continueWithLockedCoin(): void {
        this._restoreSpeed();

        // 先禁用所有硬币
        for (const coin of this.coinGroup.children) {
            const ctrl = coin.getComponent(CoinController);
            if (ctrl) {
                ctrl.allowedOperation = false;
                ctrl.showIndicator(false);
            }
        }

        // 等待摄像机还原后启用操作
        this._pendingLockedCoin = this._lockedCoin;
        console.log('[Game] _continueWithLockedCoin, pending:', this._pendingLockedCoin?.name, 'cameraAtRest:', this.hitEffectManager?.isCameraAtRest);
        this.currentPhase = GamePhase.WAITING_PLAYER;
    }

    /** 待摄像机还原后启用的锁定硬币 */
    private _pendingLockedCoin: Node | null = null;

    /** 发射硬币：委托 HitEffectManager 处理发射特效，然后进入物理模拟 */
    public launchCoin(coin: Node, velocity: Vec2): void {
        this.setActiveShotCoin(coin);
        this._doLaunch(coin, velocity);
    }

    /** 實際發射：出手前再快取一次，用衝量推出，再進物理模擬。 */
    private _doLaunch(coin: Node, velocity: Vec2): void {
        const rb = coin.getComponent(RigidBody2D);
        if (!rb) return;

        this._captureShot();
        rb.linearVelocity = new Vec2(0, 0);
        rb.angularVelocity = 0;
        // impulse = mass × Δv，出手前速度為 0，等價於設成目標初速
        const mass = Math.max(0.01, rb.getMass());
        rb.applyLinearImpulseToCenter(new Vec2(velocity.x * mass, velocity.y * mass), true);

        // 連擊 0 = 原調，每多一次連擊高 0.1，最高 1.5。
        const pitch = Math.min(1.5, 1 + this._combo * 0.1);
        const ctrl = coin.getComponent(CoinController);
        if (ctrl) {
            ctrl.showShot();
            if (ctrl.shotSfxClip) {
                SoundManager.instance?.playClip(ctrl.shotSfxClip, pitch);
            } else {
                SoundManager.instance?.playShot(pitch);
            }
        } else {
            SoundManager.instance?.playShot(pitch);
        }

        this.hitEffectManager?.onLaunch(coin, this);
        this._modShotCount++;
        this._mod?.onShotFired({
            coin,
            velocity: velocity.length(),
            powerPercent: Math.min(100, (velocity.length() / Math.max(1, this.velocityFactor * 400)) * 100),
            x: coin.position.x,
            y: coin.position.y,
        });
        if (velocity.length() > 0) {
            const pct = Math.min(100, (velocity.length() / Math.max(1, this.velocityFactor * 400)) * 100);
            this._mod?.onPowerCharged(pct, { coin });
        }
        this.startSimulation();
    }

    /**
     * 關卡用：生成假幣誘餌。高速會穿過並噴紙屑。
     */
    public spawnDecoyCoinAt(prefab: Prefab, x: number, y: number, radius?: number): Node {
        const node = this.spawnCoinAt(prefab, x, y, radius);
        if (!node.getComponent(FakeCoinDecoy)) node.addComponent(FakeCoinDecoy);
        const sprite = CoinController.getCoinSprite(node);
        if (sprite) sprite.color = new Color(200, 200, 220, 200);
        return node;
    }

    /** 进入物理模拟阶段 */
    public startSimulation() {
        this.currentPhase = GamePhase.ANIMATING;
        this.coinHitCount = 0;
        this.coinFallCount = 0;
        this._lastHitCoin = null;
        this._foulCoin = null;
        this._fallen.clear();
        this._hitCoinsThisShot.clear();
        this._run?.hideAura();
        this._setCoinsInteraction(false);
        // 游戏速度由 HitEffectManager.onLaunch 控制
    }

    // 允许用户操作状态
    public waitingPlayerOperation(){
        this._disarmTapRestart();
        this._restoreSpeed();
        this.hitEffectManager?.stopTracking();
        this._pendingLockedCoin = null;
        if (this.tutorialManager) this.tutorialManager.gameOver = false;
        this.currentPhase = GamePhase.WAITING_PLAYER;
        this._activeShotCoin = null;
        this._lockedCoin = null;
        this._lastHitCoin = null;
        this.coinHitCount = 0;
        this.coinFallCount = 0;
        this._fallen.clear();
        this._hitCoinsThisShot.clear();
        this._setCoinsInteraction(true);
        this._captureShot();
        const shooter = this._run?.findShooter(this.coinGroup) ?? null;
        this._run?.attachAura(this.coinGroup, shooter);
        this._worldStats?.ensure(this.coinGroup, this.tableHeight);
        this._worldStats?.sync(this._combo, this.countCoins());
        this.tutorialManager?.resetIdleTimer();
    }

    /** 重置空闲计时器（由 TutorialManager 代理） */
    public resetIdleTimer(): void {
        this.tutorialManager?.resetIdleTimer();
    }

    /** 启用/禁用所有硬币的交互 */
    private _setCoinsInteraction(allowed: boolean): void {
        for (const coin of this.coinGroup.children) {
            const ctrl = coin.getComponent(CoinController);
            if (ctrl) {
                ctrl.allowedOperation = allowed;
                ctrl.showIndicator(allowed);
            }
            for (const behavior of coin.getComponents(BehaviorBase)) {
                behavior.showIdleVisual();
            }

            // 每次启用时同步滑动阻力（持久设置，设一次即可）
            if (allowed) {
                const rb = coin.getComponent(RigidBody2D);
                if (rb) {
                    rb.linearDamping = this.coinDamping;
                }
            }
        }
    }

    /** 将当前 coinRadius 同步到所有已有硬币（尺寸 + 碰撞器） */
    public syncCoinRadius(): void {
        const r = this.coinRadius;
        for (const coin of this.coinGroup.children) {
            coin.setScale(1, 1, 1);
            const ut = coin.getComponent(UITransform);
            if (ut) ut.setContentSize(r * 2, r * 2);
            const cc = coin.getComponent(CircleCollider2D);
            if (cc) cc.radius = r;
        }
    }
}