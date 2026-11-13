import { _decorator, Component, Node, Vec2, Vec3, RigidBody2D, ERigidBody2DType, EventTouch, Color, Sprite, CircleCollider2D, SpriteFrame, AudioClip, resources, UITransform } from 'cc';
import { GameLogic } from './GameLogic';
import { SoundManager } from './SoundManager';
const { ccclass } = _decorator;

/** memes.json 中单个硬币的外观配置 */
export interface MemeCoinConfig {
    name?: string;
    texture?: string;
    idleTexture?: string;
    aimTexture?: string;
    shotTexture?: string;
    hittedTexture?: string;
    shotSfx?: string;
    hittedSfx?: string;
}

/** memes.json 的顶层结构 */
export interface MemeConfig {
    coins?: Record<string, MemeCoinConfig>;
}

/** 已加载到内存的硬币外观资源 */
interface CoinAppearanceAssets {
    defaultFrame: SpriteFrame | null;
    idleFrame: SpriteFrame | null;
    aimFrame: SpriteFrame | null;
    shotFrame: SpriteFrame | null;
    hittedFrame: SpriteFrame | null;
    shotSfxClip: AudioClip | null;
    hittedSfxClip: AudioClip | null;
}

@ccclass('CoinController')
export class CoinController extends Component {
    public static showArrow: boolean = false;
    private static _anyDragging: boolean = false;
    /** 所有存活实例，用来判断静态拖拽锁是否真的还有人在用。 */
    private static _live: Set<CoinController> = new Set();
    private static _lastWorldPos: Vec2 = new Vec2();
    /** 从 config.json 读取的 source_color */
    public static sourceColor: Color = Color.YELLOW;
    /** 从 config.json 读取的 target_color */
    public static targetColor: Color = Color.GREEN;

    /** memes.json 数据（由 GameScene 加载后注入） */
    private static _memesConfig: MemeConfig | null = null;
    /** 已加载的外观资源缓存，key 为 memes.json 中的 class */
    private static readonly _appearanceCache = new Map<string, CoinAppearanceAssets>();
    /** 正在加载中的外观资源，同一 key 的请求合并等待 */
    private static readonly _appearanceLoading = new Map<string, ((assets: CoinAppearanceAssets) => void)[]>();
    /** memes.json 尚未加载时暂存的硬币外观请求，配置就绪后补应用 */
    private static _pendingAppearances: { node: Node; key: string }[] = [];

    /**
     * 获取硬币的 Sprite 组件。
     * Coin.prefab 中 Sprite 已移到子节点 "Sprite" 上，优先从子节点查找，找不到时回退到节点自身。
     */
    public static getCoinSprite(node: Node): Sprite | null {
        const child = node.getChildByName('Sprite');
        if (child) {
            const s = child.getComponent(Sprite);
            if (s) return s;
        }
        return node.getComponent(Sprite);
    }

    /** 注入 memes.json 数据，并补应用初始化时配置尚未加载的硬币 */
    public static setMemesConfig(config: MemeConfig | null): void {
        CoinController._memesConfig = config ?? null;
        CoinController._appearanceCache.clear();

        const pending = CoinController._pendingAppearances;
        CoinController._pendingAppearances = [];
        for (const item of pending) {
            CoinController.applyMemeAppearance(item.node, item.key);
        }
    }

    /**
     * 根据关卡 class 查找 memes.json 中的配置并初始化硬币贴图/音效。
     * 配置尚未加载时先记下请求，待 setMemesConfig 后自动补应用。
     */
    public static applyMemeAppearance(node: Node, classKey: number | string | null | undefined): void {
        if (classKey === null || classKey === undefined || classKey === '') return;
        const key = String(classKey);
        const config = CoinController._memesConfig?.coins?.[key];
        if (!config) {
            if (!CoinController._memesConfig) {
                const index = CoinController._pendingAppearances.findIndex((item) => item.node === node);
                if (index >= 0) CoinController._pendingAppearances[index].key = key;
                else CoinController._pendingAppearances.push({ node, key });
            } else {
                console.log(`[CoinController] memes.json 中未找到 class "${key}" 的配置，保持默认外观`);
            }
            return;
        }

        CoinController._loadAppearance(key, config, (assets) => {
            if (!node.isValid) return;
            const ctrl = node.getComponent(CoinController);
            if (ctrl) {
                ctrl.setAppearance({
                    defaultFrame: assets.defaultFrame,
                    idleFrame: assets.idleFrame,
                    aimFrame: assets.aimFrame,
                    shotFrame: assets.shotFrame,
                    hittedFrame: assets.hittedFrame,
                    shotSfxClip: assets.shotSfxClip,
                    hittedSfxClip: assets.hittedSfxClip,
                    typeKey: key,
                });
            } else {
                // 环境硬币没有 CoinController，只需要静态贴图
                const sprite = CoinController.getCoinSprite(node);
                if (sprite && assets.defaultFrame) sprite.spriteFrame = assets.defaultFrame;
            }
        });
    }

    /** 加载（并缓存）某个 class 的外观资源；同一 key 并发请求共用一次加载 */
    private static _loadAppearance(
        key: string,
        config: MemeCoinConfig,
        cb: (assets: CoinAppearanceAssets) => void,
    ): void {
        const cached = CoinController._appearanceCache.get(key);
        if (cached) {
            cb(cached);
            return;
        }
        const waiters = CoinController._appearanceLoading.get(key);
        if (waiters) {
            waiters.push(cb);
            return;
        }

        const callbacks: ((assets: CoinAppearanceAssets) => void)[] = [cb];
        CoinController._appearanceLoading.set(key, callbacks);

        const assets: CoinAppearanceAssets = {
            defaultFrame: null,
            idleFrame: null,
            aimFrame: null,
            shotFrame: null,
            hittedFrame: null,
            shotSfxClip: null,
            hittedSfxClip: null,
        };

        let remaining = 0;
        let finished = false;
        const finish = () => {
            if (finished) return;
            finished = true;
            CoinController._appearanceLoading.delete(key);
            CoinController._appearanceCache.set(key, assets);
            for (const callback of callbacks) callback(assets);
        };
        const onAssetDone = () => {
            remaining--;
            if (remaining <= 0) finish();
        };

        // 图片资源需指定 SpriteFrame 子资源路径
        const loadFrame = (file: string | undefined, assign: (frame: SpriteFrame) => void) => {
            if (!file) return;
            remaining++;
            const base = file.replace(/\.[^/.]+$/, '');
            resources.load(base + '/spriteFrame', SpriteFrame, (err, frame) => {
                if (!err && frame) assign(frame);
                else console.warn(`[CoinController] 加载贴图 ${file} 失败:`, err);
                onAssetDone();
            });
        };
        const loadClip = (file: string | undefined, assign: (clip: AudioClip) => void) => {
            if (!file) return;
            remaining++;
            const base = file.replace(/\.[^/.]+$/, '');
            resources.load(base, AudioClip, (err, clip) => {
                if (!err && clip) assign(clip);
                else console.warn(`[CoinController] 加载音效 ${file} 失败:`, err);
                onAssetDone();
            });
        };

        loadFrame(config.texture, (frame) => { assets.defaultFrame = frame; });
        loadFrame(config.idleTexture, (frame) => { assets.idleFrame = frame; });
        loadFrame(config.aimTexture, (frame) => { assets.aimFrame = frame; });
        loadFrame(config.shotTexture, (frame) => { assets.shotFrame = frame; });
        loadFrame(config.hittedTexture, (frame) => { assets.hittedFrame = frame; });
        loadClip(config.shotSfx, (clip) => { assets.shotSfxClip = clip; });
        loadClip(config.hittedSfx, (clip) => { assets.hittedSfxClip = clip; });

        if (remaining === 0) finish();
    }

    private _allowedOperation: boolean = false;
    private _rigidBody: RigidBody2D | null = null;
    private _isDragging: boolean = false;
    private _dragStartPos: Vec2 = new Vec2();
    private _gameLogic: GameLogic | null = null;
    private _eventRegistered: boolean = false;
    private _indicatorActive: boolean = false;
    private _indicatorTime: number = 0;
    /** 其他硬币拖拽时，本硬币高亮为绿色（表示可被打击） */
    private _targetableActive: boolean = false;
    /** 本硬币正在被打飞出场外（掉落检测应跳过，避免误判为掉进缺口） */
    public isKnockingOut: boolean = false;

    /** 拖拽箭头 Sprite 节点与组件 */
    private _dragArrowNode: Node | null = null;
    private _dragArrowSprite: Sprite | null = null;

    /** 经墙面限位后的拖拽向量（箭头尾部不进入墙内） */
    private _clampedDragVec: Vec2 = new Vec2();
    /** 上一次拖拽距离（用于判断增加/减少音效） */
    private _lastDragDist: number = 0;
    /** 当前拖拽方向音效状态：'increase' | 'decrease' | null */
    private _dragSoundDir: 'increase' | 'decrease' | null = null;

    /** 当前硬币类型（memes.json 中的 key，如 "1", "2"） */
    private _coinTypeKey: string = '';
    /** 当前贴图状态：默认/空闲/拖拽/发射/被打击 */
    private _textureState: 'default' | 'idle' | 'aim' | 'shot' | 'hit' = 'default';

    /** 默认贴图（基础/回退外观） */
    private _defaultFrame: SpriteFrame | null = null;
    /** 空闲时贴图 */
    private _idleFrame: SpriteFrame | null = null;
    /** 拖拽时贴图 */
    private _aimFrame: SpriteFrame | null = null;
    /** 发射时贴图 */
    private _shotFrame: SpriteFrame | null = null;
    /** 被打击时贴图 */
    private _hittedFrame: SpriteFrame | null = null;
    /** 发射音效 */
    private _shotSfxClip: AudioClip | null = null;
    /** 被打击音效 */
    private _hittedSfxClip: AudioClip | null = null;

    public get allowedOperation(): boolean {
        return this._allowedOperation;
    }

    public set allowedOperation(allowed: boolean) {
        this._allowedOperation = allowed;
    }

    /** 外部注入 GameLogic 引用 */
    public setGameLogic(gl: GameLogic): void {
        this._gameLogic = gl;
    }

    /** 获取当前硬币类型 key */
    public get coinTypeKey(): string {
        return this._coinTypeKey;
    }

    /** 获取发射音效 */
    public get shotSfxClip(): AudioClip | null {
        return this._shotSfxClip;
    }

    /** 获取被打击音效 */
    public get hittedSfxClip(): AudioClip | null {
        return this._hittedSfxClip;
    }

    /** 获取 memes.json 中配置的默认贴图（texture 字段） */
    public get defaultFrame(): SpriteFrame | null {
        return this._defaultFrame;
    }

    /**
     * 设置硬币各状态的贴图与音效（资源由 GameScene 预先加载好传入）。
     * 传入 null / 缺省字段表示不改变对应资源。
     */
    public setAppearance(config: {
        defaultFrame?: SpriteFrame | null;
        idleFrame?: SpriteFrame | null;
        aimFrame?: SpriteFrame | null;
        shotFrame?: SpriteFrame | null;
        hittedFrame?: SpriteFrame | null;
        shotSfxClip?: AudioClip | null;
        hittedSfxClip?: AudioClip | null;
        typeKey: string;
    }): void {
        this._coinTypeKey = config.typeKey;
        if (config.defaultFrame) this._defaultFrame = config.defaultFrame;
        if (config.idleFrame) this._idleFrame = config.idleFrame;
        if (config.aimFrame) this._aimFrame = config.aimFrame;
        if (config.shotFrame) this._shotFrame = config.shotFrame;
        if (config.hittedFrame) this._hittedFrame = config.hittedFrame;
        if (config.shotSfxClip) this._shotSfxClip = config.shotSfxClip;
        if (config.hittedSfxClip) this._hittedSfxClip = config.hittedSfxClip;
        // 重新应用当前状态的贴图
        this._applyTexture();
    }

    /** 切换为默认贴图（基础/回退外观） */
    public showDefault(): void {
        this._textureState = 'default';
        this._applyTexture();
    }

    /** 切换为空闲贴图（等待操作时） */
    public showIdle(): void {
        this._textureState = 'idle';
        this._applyTexture();
    }

    /** 切换为拖拽贴图（瞄准中） */
    public showAim(): void {
        this._textureState = 'aim';
        this._applyTexture();
    }

    /** 切换为发射贴图 */
    public showShot(): void {
        this._textureState = 'shot';
        this._applyTexture();
    }

    /** 切换为被打击贴图 */
    public showHit(): void {
        this._textureState = 'hit';
        this._applyTexture();
    }

    /** 按当前状态应用贴图（对应帧缺失时保持不变） */
    private _applyTexture(): void {
        const sprite = CoinController.getCoinSprite(this.node);
        if (!sprite) return;
        let frame: SpriteFrame | null = null;
        switch (this._textureState) {
            case 'default': frame = this._defaultFrame; break;
            // 状态贴图未配置时回退到默认贴图（如行为硬币只配置了 texture）
            case 'idle':    frame = this._idleFrame ?? this._defaultFrame; break;
            case 'aim':     frame = this._aimFrame ?? this._defaultFrame; break;
            case 'shot':    frame = this._shotFrame ?? this._defaultFrame; break;
            case 'hit':     frame = this._hittedFrame ?? this._defaultFrame; break;
        }
        if (frame) sprite.spriteFrame = frame;
    }

    start() {
        this._rigidBody = this.node.getComponent(RigidBody2D);
        if (!this._rigidBody) {
            console.warn('[CoinController] 找不到 RigidBody2D 组件');
            return;
        }

        // 禁止硬币自转（只平移不旋转）
        this._rigidBody.fixedRotation = true;

        // 设置物理属性：质量、摩擦力、弹性
        const collider = this.node.getComponent(CircleCollider2D);
        if (collider) {
            collider.friction = 1;
            collider.restitution = 0.6;
            collider.density = 2 / Math.PI * Math.pow(collider.radius, 2)
        }

        // 节点触摸事件（TOUCH_START/MOVE/END 在同一节点上，Touch 会 capture 后续事件到同一节点）
        this.node.on(Node.EventType.TOUCH_START, this._onPointerDown, this);
        CoinController._live.add(this);
    }

    onDestroy() {
        CoinController._live.delete(this);
        // 若销毁时正在拖拽，释放全局锁，避免下一关所有硬币都拖不动
        if (this._isDragging) {
            this._isDragging = false;
            CoinController._anyDragging = false;
        }
        this.node.off(Node.EventType.TOUCH_START, this._onPointerDown, this);
        this._unregisterGlobalEvents();
    }

    /** 是否真的还有实例处在拖拽状态（用于校验静态锁）。 */
    private static _anyInstanceDragging(): boolean {
        for (const ctrl of CoinController._live) {
            if (ctrl?.isValid && ctrl._isDragging) return true;
        }
        return false;
    }

    public showIndicator(show: boolean): void {
        this._indicatorActive = show;
        this._indicatorTime = 0;

        if (!show) {
            const sprite = CoinController.getCoinSprite(this.node);
            if (sprite) {
                sprite.color = Color.WHITE;
            }
        } else {
            // 进入等待操作状态 → 空闲贴图
            this.showIdle();
        }
    }

    update(dt: number) {
        // 拖拽中每帧更新箭头（Sprite 方式，由 _drawDragLineFromPos 处理）
        if (this._isDragging) {
            this._drawDragLineFromPos(CoinController._lastWorldPos);
        }

        if (!this._indicatorActive && !this._targetableActive) return;

        this._indicatorTime += dt;
        const t = (Math.sin(this._indicatorTime * Math.PI * 2) + 1) / 2;
        const sprite = CoinController.getCoinSprite(this.node);
        if (!sprite) return;

        if (this._targetableActive) {
            // 目标颜色脉冲：t=0 → targetColor，t=1 → 白色(255,255,255)
            sprite.color = new Color(
                Math.floor(CoinController.targetColor.r + (255 - CoinController.targetColor.r) * t),
                Math.floor(CoinController.targetColor.g + (255 - CoinController.targetColor.g) * t),
                Math.floor(CoinController.targetColor.b + (255 - CoinController.targetColor.b) * t),
            );
        } else {
            // 选中颜色脉冲：t=0 → sourceColor，t=1 → 白色(255,255,255)
            sprite.color = new Color(
                Math.floor(CoinController.sourceColor.r + (255 - CoinController.sourceColor.r) * t),
                Math.floor(CoinController.sourceColor.g + (255 - CoinController.sourceColor.g) * t),
                Math.floor(CoinController.sourceColor.b + (255 - CoinController.sourceColor.b) * t),
            );
        }
    }

    private _onPointerDown(event: EventTouch): void {
        if (!this._allowedOperation) {
            // 出手后 GameLogic 会锁住全部硬币，只解锁「被击中的下一枚」。
            // 只有尚未指定下一枚时，才允许在 WAITING_PLAYER 阶段自救解锁；
            // 否则玩家可以绕过锁定，拖动其他硬币。
            const gl = this._gameLogic;
            const waiting = gl?.isWaitingPlayer === true;
            const hasNextShooter = gl?.hasPendingShooter === true;
            if (waiting && !hasNextShooter) {
                console.warn('[CoinController] allowedOperation=false while waiting — unlocking', this.node.name);
                this._allowedOperation = true;
            } else {
                console.log(
                    '[CoinController] tap ignored, allowedOperation=false, waiting=',
                    waiting,
                    'hasNextShooter=',
                    hasNextShooter,
                );
                return;
            }
        }
        // 教程模式：验证是否允许拖动这枚硬币
        if (!this._gameLogic?.canLaunchCoin(this.node)) {
            console.log('[Coin] drag blocked by tutorial:', this.node.name);
            return;
        }
        // 已经有硬币在拖拽中，不再响应（防止 Cocos Creator 在鼠标经过其他节点时误触 MOUSE_DOWN）
        if (CoinController._anyDragging) {
            // 防御：static 标志可能因窗口失焦 / 场景切换而永久残留，
            // 导致所有硬币再也拖不动。没有任何实例在拖拽时自动恢复。
            if (!CoinController._anyInstanceDragging()) {
                console.warn('[CoinController] 清理残留的全局拖拽锁');
                CoinController._anyDragging = false;
            } else {
                return;
            }
        }

        // 防御：如果之前拖拽未正常结束（如鼠标移出窗口），先清理
        if (this._isDragging) {
            console.warn('[CoinController] 修复残留拖拽状态');
            this._isDragging = false;
            CoinController._anyDragging = false;
            this._unregisterGlobalEvents();
            if (this._rigidBody) {
                this._rigidBody.type = ERigidBody2DType.Dynamic;
                this._rigidBody.gravityScale = 1;
            }
            this._hideDragArrow();
            this._clearTargetableAll();
        }

        // 复位拖拽距离
        this._gameLogic?.setDragDistance(0);
        this._hideDragArrow();

        this._lastDragDist = 0;
        this._dragSoundDir = null;
        this._isDragging = true;
        // 重置空闲计时器
        this._gameLogic?.resetIdleTimer();
        if (this._gameLogic?.tutorialManager) this._gameLogic.tutorialManager.isDragging = true;
        // 拖拽瞄准中 → 拖拽贴图
        this.showAim();
        event.getLocation(this._dragStartPos);
        // 同步更新缓存位置，防止 update() 轮询时读到未初始化的 (0,0)
        event.getLocation(CoinController._lastWorldPos);

        // 开始循环播放拖拽音效
        SoundManager.instance?.startCoinDrag();

        // 其他硬币高亮为绿色（表示可被打击）
        const coinGroup = this._gameLogic?.coinGroup;
        if (coinGroup) {
            for (const child of coinGroup.children) {
                if (child === this.node) continue;
                const ctrl = child.getComponent(CoinController);
                if (ctrl) ctrl.showTargetable(true);
            }
        }

        // 拖拽一开始就隐藏目标箭头：玩家已经出手，箭头会干扰瞄准。
        // （失败后由 TutorialManager 重新指回目标）
        this._gameLogic?.tutorialManager?.hideTargetGuide();

        // 冻结物理，防止拖拽期间受物理影响
        if (this._rigidBody) {
            this._rigidBody.type = ERigidBody2DType.Static;
        }

        // 标记全局拖拽锁定（防止其他硬币同时进入拖拽状态）
        CoinController._anyDragging = true;

        // 在当前硬币节点注册 Touch 事件（Cocos Creator 保证 TOUCH_MOVE/END 始终派发给同一节点）
        this.node.on(Node.EventType.TOUCH_MOVE, this._onTouchMove, this);
        this.node.on(Node.EventType.TOUCH_END, this._onPointerUp, this);
        this.node.on(Node.EventType.TOUCH_CANCEL, this._onPointerUp, this);
        this._eventRegistered = true;
    }

    private _unregisterGlobalEvents(): void {
        if (!this._eventRegistered) return;
        this._eventRegistered = false;
        CoinController._anyDragging = false;

        this.node.off(Node.EventType.TOUCH_MOVE, this._onTouchMove, this);
        this.node.off(Node.EventType.TOUCH_END, this._onPointerUp, this);
        this.node.off(Node.EventType.TOUCH_CANCEL, this._onPointerUp, this);
    }

    private _onTouchMove(event: EventTouch): void {
        // 持续缓存鼠标位置，供 update 轮询兜底
        event.getLocation(CoinController._lastWorldPos);
        if (!this._isDragging) return;
        // 播放一次拖拽音效（若已在播放则跳过）
        SoundManager.instance?.startCoinDrag();
        // 先绘制箭头（计算墙面限位后的拖拽向量）
        this._drawDragLine(event);
        // 距离增加/减少音效
        //this._checkDragDistSound();
        // 使用限位后的拖拽距离
        const dx = this._clampedDragVec.x;
        const dy = this._clampedDragVec.y;
        if (this._gameLogic) {
            this._gameLogic.setDragDistance(Math.sqrt(dx * dx + dy * dy));
        }
    }

    /** 设置本硬币的可被打击高亮状态（绿色脉冲） */
    public showTargetable(show: boolean): void {
        this._targetableActive = show;
        this._indicatorTime = 0;
        if (!show) {
            const sprite = CoinController.getCoinSprite(this.node);
            if (sprite) sprite.color = Color.WHITE;
        }
    }

    /** 清除所有硬币的可被打击高亮 */
    private _clearTargetableAll(): void {
        const coinGroup = this._gameLogic?.coinGroup;
        if (!coinGroup) return;
        for (const child of coinGroup.children) {
            const ctrl = child.getComponent(CoinController);
            if (ctrl) ctrl.showTargetable(false);
        }
    }

    /** 根据拖拽距离增减切换循环音效（仅在方向变化时切换，不刷屏） */
    private _checkDragDistSound(): void {
        const dist = this._clampedDragVec.length();
        const threshold = 1;
        let dir: 'increase' | 'decrease' | null = null;
        if (dist > this._lastDragDist + threshold) {
            dir = 'increase';
        } else if (dist < this._lastDragDist - threshold) {
            dir = 'decrease';
        }
        this._lastDragDist = dist;

        if (dir === this._dragSoundDir) return; // 方向未变，不切换
        this._dragSoundDir = dir;

        if (dir === 'increase') {
            SoundManager.instance?.startDragIncreaseLoop();
        } else if (dir === 'decrease') {
            SoundManager.instance?.startDragDecreaseLoop();
        } else {
            SoundManager.instance?.stopDragDirectionLoop();
        }
    }

    /**
     * 拖曳向量就是手指拉離的距離。
     * 發射和瞄準線都往反方向，所以拉出桌邊不該把力道截短。
     */
    private _calcClampedDrag(rawDx: number, rawDy: number): Vec2 {
        return new Vec2(rawDx, rawDy);
    }

    /** 创建或获取拖拽箭头 Sprite */
    private _getDragArrow(): { node: Node; sprite: Sprite } | null {
        if (this._dragArrowSprite) return { node: this._dragArrowNode!, sprite: this._dragArrowSprite };

        const gl = this._gameLogic;
        if (!gl?.coinGroup) return null;

        const node = new Node('DragArrow');
        node.layer = 1; // WORLD
        gl.coinGroup.addChild(node);

        const ut = node.addComponent(UITransform);
        ut.setContentSize(32, 32);
        ut.setAnchorPoint(0.5, 0.5);

        const sprite = node.addComponent(Sprite);
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        sprite.color = new Color(255, 100, 100);

        // 异步加载箭头贴图
        resources.load('textures/arraw/spriteFrame', SpriteFrame, (err, sf) => {
            if (!err && sf && this._dragArrowSprite) {
                this._dragArrowSprite.spriteFrame = sf;
            }
        });

        this._dragArrowNode = node;
        this._dragArrowSprite = sprite;
        return { node, sprite };
    }

    /** 更新拖拽箭头（Sprite 方式：根据拖拽方向旋转 + 根据距离拉长） */
    private _updateDragArrow(dx: number, dy: number): void {
        if (!CoinController.showArrow) { this._hideDragArrow(); return; }
        const arrow = this._getDragArrow();
        if (!arrow) return;

        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 5) { arrow.node.active = false; return; }

        arrow.node.active = true;
        arrow.node.setPosition(this.node.position);

        // 箭头默认朝上 (0,1)，旋转到发射方向 (-dx, -dy)
        const angle = Math.atan2(-dy, -dx) * 180 / Math.PI - 90;
        arrow.node.eulerAngles = new Vec3(0, 0, angle);

        // 根据拖拽距离拉长（单位高度 1px，最小 10）
        const height = Math.max(10, dist * 2);
        arrow.node.getComponent(UITransform)!.setContentSize(32, height);
    }

    /** 隐藏拖拽箭头 */
    private _hideDragArrow(): void {
        if (this._dragArrowNode) this._dragArrowNode.active = false;
    }

    /** 根据鼠标位置绘制拖拽引导线（经墙面限位后更新箭头） */
    private _drawDragLineFromPos(mousePos: Vec2): void {
        const rawDx = mousePos.x - this._dragStartPos.x;
        const rawDy = mousePos.y - this._dragStartPos.y;
        this._clampedDragVec = this._calcClampedDrag(rawDx, rawDy);
        this._updateDragArrow(this._clampedDragVec.x, this._clampedDragVec.y);
        // 瞄准线：发射方向与拖拽方向相反（使用限位后的向量，与发射力量一致）
        this._gameLogic?.drawAimLine(this.node.position.x, this.node.position.y, -this._clampedDragVec.x, -this._clampedDragVec.y);
    }

    /** 绘制拖拽引导线（经墙面限位后更新箭头） */
    private _drawDragLine(event: EventTouch): void {
        const cur = event.getLocation();
        const rawDx = cur.x - this._dragStartPos.x;
        const rawDy = cur.y - this._dragStartPos.y;
        this._clampedDragVec = this._calcClampedDrag(rawDx, rawDy);
        this._updateDragArrow(this._clampedDragVec.x, this._clampedDragVec.y);
        // 瞄准线：发射方向与拖拽方向相反（使用限位后的向量，与发射力量一致）
        this._gameLogic?.drawAimLine(this.node.position.x, this.node.position.y, -this._clampedDragVec.x, -this._clampedDragVec.y);
    }

    private _onPointerUp(_event: EventTouch): void {
        if (!this._isDragging) return;
        this._isDragging = false;
        if (this._gameLogic?.tutorialManager) this._gameLogic.tutorialManager.isDragging = false;
        this._unregisterGlobalEvents();

        // 复位拖拽距离
        this._gameLogic?.setDragDistance(0);
        this._hideDragArrow();
        this._clearTargetableAll();
        this._gameLogic?.clearAimLine();
        SoundManager.instance?.stopDragDirectionLoop();
        SoundManager.instance?.playDragRelease();

        if (!this._rigidBody) return;

        // 还原物理属性
        this._rigidBody.type = ERigidBody2DType.Dynamic;
        this._rigidBody.gravityScale = 1;

        // 使用墙面限位后的拖拽向量计算速度（与箭头视觉一致）
        const dx = this._clampedDragVec.x;
        const dy = this._clampedDragVec.y;

        // 拖拽距离太短则忽略（防误触）
        if (dx * dx + dy * dy < 25) return;

        // 反方向发射 - 速度与拖拽距离成正比（系数从 GameLogic 读取）
        const factor = this._gameLogic?.velocityFactor ?? 5;
        const velocity = new Vec2(-dx * factor, -dy * factor);

        // 通知 GameLogic 执行带特效的发射流程
        if (this._gameLogic) {
            this._gameLogic.launchCoin(this.node, velocity);
        } else {
            // fallback：直接发射
            this._rigidBody.linearVelocity = velocity;
            SoundManager.instance?.playShot();
        }
    }
}
