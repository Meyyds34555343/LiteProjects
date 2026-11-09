import { _decorator, Component, Node, Vec2, Vec3, tween, Tween, Button, RigidBody2D } from 'cc';
import { GameLogic } from './GameLogic';
import { UIManager } from './UIManager';
import { CoinController } from './CoinController';
import { I18n } from './I18n';
import { UITips } from './UI/UITips';
const { ccclass, property } = _decorator;

// ── 统一教程步骤定义 ──

/** 道具介绍步骤（展示指示器 + 文字，无需玩家操作） */
export interface IntroTutorialStep {
    type: 'intro';
    /** 提示文字的 i18n key */
    hintKey: string;
    /** 指示器目标位置 */
    x: number;
    y: number;
    /** 指示器半径（对应目标大小） */
    radius: number;
}

/** 硬币拖拽步骤（要求玩家拖动指定硬币击打目标） */
export interface DragTutorialStep {
    type: 'drag';
    /** 提示文字的 i18n key */
    hintKey: string;
    /** 要求拖动的硬币索引（coinGroup.children 中的序号，教程开始时解析为 Node 引用） */
    sourceCoinIndex: number;
    /** 要求击打的目标硬币索引 */
    targetCoinIndex: number;
    /** 是否为最后一步（完成后结束教程） */
    isFinal?: boolean;
}

/** 统一教程步骤：介绍或拖拽，可顺序混排 */
export type TutorialStep = IntroTutorialStep | DragTutorialStep;

/** 拖拽步骤（已解析为 Node 引用） */
interface ResolvedDragStep {
    type: 'drag';
    hintKey: string;
    sourceCoin: Node;
    targetCoin: Node;
    isFinal: boolean;
}

/** 介绍步骤（无需解析，直接使用坐标） */
interface IntroStep {
    type: 'intro';
    hintKey: string;
    x: number;
    y: number;
    radius: number;
}

/** 内部统一为解析后的步骤 */
type ResolvedStep = IntroStep | ResolvedDragStep;

@ccclass('TutorialManager')
export class TutorialManager extends Component {
    @property(UITips)
    public uiTips:UITips = null;
    @property(Button)
    public btnSkip:Button = null;

    // ── 引用（由 GameScene 注入）──
    public gameLogic: GameLogic | null = null;
    public uiManager: UIManager | null = null;

    // ── 教程状态 ──
    private _active: boolean = false;
    private _steps: ResolvedStep[] = [];
    private _currentStepIndex: number = 0;
    private _coinSnapshots: { node: Node; x: number; y: number }[] = [];
    private _hitTargetThisTurn: boolean = false;
    private _foulCount: number = 0;
    private _wasLastStep: boolean = false;
    /** 本次拖拽实际使用的硬币（可能不是教程指定的那枚）。 */
    private _draggedCoin: Node | null = null;

    // ── 介绍步骤自动推进延迟 ──
    private _introAutoDelay: number = 4;

    // ── 手势提示 ──
    private static readonly _tagGesture = 100;

    // ── 闲置提示（从 GameLogic 移入）──
    public idleShowDelay: number = 5;
    private _idleTimer: number = 0;
    private _isClickNodeShowing: boolean = false;
    public isDragging: boolean = false;
    /** 游戏已结束（失败/胜利弹窗显示中），抑制闲置提示 */
    public gameOver: boolean = false;

    // ── 教程生命周期 ──

    /** 统一教程入口：按顺序执行介绍/拖拽步骤，可混排 */
    public startTutorial(steps: TutorialStep[]): void {
        this._active = true;
        this._currentStepIndex = 0;

        // 解析拖拽步骤索引为 Node 引用（硬币销毁后索引会变，必须用引用）
        const coins = this.gameLogic?.coinGroup?.children ?? [];
        const lastIndex = Math.max(0, coins.length - 1);
        const resolved: ResolvedStep[] = [];
        for (const s of steps) {
            if (s.type === 'intro') {
                resolved.push({ type: 'intro', hintKey: s.hintKey, x: s.x, y: s.y, radius: s.radius });
                continue;
            }
            // 关卡硬币数量与配置不一致时，夹紧索引而不是让教程卡死
            const source = coins[Math.min(Math.max(0, s.sourceCoinIndex), lastIndex)];
            const target = coins[Math.min(Math.max(0, s.targetCoinIndex), lastIndex)];
            if (!source || !target || source === target) continue;
            resolved.push({
                type: 'drag',
                hintKey: s.hintKey,
                sourceCoin: source,
                targetCoin: target,
                isFinal: s.isFinal ?? false,
            });
        }
        this._steps = resolved;

        if (this._steps.length === 0) {
            this.skipTutorial();
            return;
        }

        this._bindSkipButton();
        this._showSkipButton();
        this._snapshotPositions();
        this._beginCurrentStep();
    }

    /** 跳过教程 */
    public skipTutorial(): void {
        this._active = false;
        this.unscheduleAllCallbacks();
        this._hideGestureHint();
        this._hideTargetIndicator();
        this._hideHint();
        this._hideSkipButton();
        this._clearCoinHighlight();
    }

    /** 教程是否激活 */
    public isActive(): boolean {
        return this._active;
    }

    /** 当前步骤是否为最后一步 */
    public isFinalStep(): boolean {
        const step = this._steps[this._currentStepIndex];
        return step && step.type === 'drag' ? step.isFinal : false;
    }

    /** 上一次成功命中时是否为最后一步（在 onTurnSettled 中推进索引前记录） */
    public wasLastStep(): boolean {
        return this._wasLastStep;
    }

    /** 点击屏幕推进介绍步骤 */
    public onIntroClick(): void {
        if (!this._active) return;
        const step = this._steps[this._currentStepIndex];
        if (!step || step.type !== 'intro') return;
        this.unscheduleAllCallbacks();
        this._advanceStep();
    }

    // ── 玩家操作钩子 ──

    /**
     * 玩家开始拖动硬币时调用。
     * 返回 false 表示不允许拖动这枚硬币（CoinController 不响应操作）。
     */
    public onCoinDragStart(coin: Node): boolean {
        if (!this._active) return true;

        // 玩家直接去拖硬币时，跳过剩下的介绍气泡——
        // 否则必须等每个 intro 的自动计时器跑完（4 个道具介绍 = 16 秒拖不动）。
        this._skipIntroSteps();
        if (!this._active) return false;

        const step = this._steps[this._currentStepIndex];
        if (!step || step.type !== 'drag') {
            // 走到这里说明还在介绍步骤且跳过失败——不要让玩家完全失去操作权。
            console.log('[Tutorial] allow drag during', step ? step.type : 'no-step');
        }

        // 关键：拖拽步骤一律允许上手（任何硬币），不再因为“拖错了硬币”而静默拒绝。
        // 教程仍会在结算时用 targetCoin 判定成功/失败，所以教学效果不变，
        // 但玩家永远不会遇到“怎么点都没反应”的情况。
        this._draggedCoin = coin;
        this._hideGestureHint();
        this._hitTargetThisTurn = false;
        this._snapshotPositions();
        if (step && step.type === 'drag' && coin !== step.sourceCoin) {
            console.log('[Tutorial] guiding toward', step.sourceCoin?.name, 'but player grabbed', coin.name);
        }
        return true;
    }

    /** 硬币发射前调用，记录快照 */
    public onCoinLaunched(coin: Node): void {
        // 快照已在 onCoinDragStart 中记录
    }

    /** 硬币碰撞时调用，验证是否击中目标 */
    public onCoinHit(hitCoin: Node): void {
        if (!this._active) return;
        const step = this._steps[this._currentStepIndex];
        if (!step || step.type !== 'drag') return;

        if (hitCoin === step.targetCoin) {
            this._hitTargetThisTurn = true;
        }
    }

    /**
     * 回合结束时调用，验证结果。
     * 返回 true 表示继续执行正常结算（硬币被打飞消失），false 表示教程已处理（重置位置）。
     */
    public onTurnSettled(): boolean {
        if (!this._active) return true;
        const step = this._steps[this._currentStepIndex];
        if (!step || step.type !== 'drag') return true;

        const hitCount = this.gameLogic?.coinHitCount ?? 0;
        const fallCount = this.gameLogic?.coinFallCount ?? 0;

        if (this._hitTargetThisTurn && fallCount == 0 && hitCount == 1) {
            // ✅ 正确击中目标 → 继续正常结算（a 硬币被打飞消失）
            this._foulCount = 0;
            // 在推进索引之前，记录当前步是否为最终步
            this._wasLastStep = step.isFinal;
            if (step.isFinal) {
                // 最后一步完成 → 显示完成提示，打飞特效结束后由 processResult 调用 skipTutorial
                this._showHint('tutorial_complete');
            } else {
                // 立即推进步骤索引（让 onCoinDragStart 马上用新步骤的 sourceCoin）
                this._currentStepIndex++;
                // 延迟到打飞动画结束后更新 UI
                this.scheduleOnce(() => {
                    if (this._active) {
                        this._beginCurrentStep();
                    }
                }, 1.0);
            }
            return true;
        } else {
            // ❌ 失败 → 判断失败原因，提示用户，重置位置
            this._restorePositions();
            this._foulCount++;

            // 关键：出手时 GameLogic 已把所有硬币锁住（_setCoinsInteraction(false)）。
            // 教程接管了本回合的结算，必须自己把操作权还回去，否则玩家再也拖不动任何硬币。
            this.gameLogic?.waitingPlayerOperation();

            if (fallCount > 0) {
                this._showHint('tutorial_foul_fall');
            } else if (hitCount >= 2) {
                this._showHint('tutorial_foul_multi_hit');
            } else {
                this._showHint('tutorial_miss');
            }

            // 2秒后重新显示原始提示和手势
            this.scheduleOnce(() => {
                if (this._active) {
                    this._beginCurrentStep();
                }
            }, 2.0);
            return false;
        }
    }

    // ── 步骤管理 ──

    /** 推进到下一步 */
    private _advanceStep(): void {
        this._currentStepIndex++;
        if (this._currentStepIndex >= this._steps.length) {
            this.skipTutorial();
        } else {
            this._beginCurrentStep();
        }
    }

    /**
     * 跳过所有连续的介绍步骤，直接进入第一个拖拽步骤。
     * 玩家主动拖硬币时调用，避免被介绍气泡的自动计时器卡住。
     */
    private _skipIntroSteps(): void {
        let moved = false;
        while (this._currentStepIndex < this._steps.length
            && this._steps[this._currentStepIndex].type === 'intro') {
            this._currentStepIndex++;
            moved = true;
        }
        if (!moved) return;

        this.unscheduleAllCallbacks();
        this._hideTargetIndicator();
        if (this._currentStepIndex >= this._steps.length) {
            this.skipTutorial();
            return;
        }
        this._beginCurrentStep();
    }

    /** 开始当前步骤：根据类型展示介绍或拖拽 */
    private _beginCurrentStep(): void {
        const step = this._steps[this._currentStepIndex];
        if (!step) return;

        if (step.type === 'intro') {
            this._beginIntroStep(step);
        } else {
            this._beginDragStep(step);
        }
    }

    /** 开始介绍步骤：显示指示器 + 文字，自动/点击推进 */
    private _beginIntroStep(step: IntroStep): void {
        // 显示目标指示器（radius <= 0 表示纯文字目标说明，不显示指示器）
        const indicator = this.uiManager?.targetIndicator;
        if (indicator) {
            if (step.radius > 0) {
                indicator.node.setPosition(step.x, step.y, 0);
                indicator.open(step.radius);
            } else {
                indicator.close();
            }
        }

        // 显示提示文字
        this._showHint(step.hintKey);

        // 自动推进到下一步
        this.scheduleOnce(() => {
            if (this._active) {
                this._advanceStep();
            }
        }, this._introAutoDelay);
    }

    /** 开始拖拽步骤：高亮硬币 + 显示手势提示 + 目标指示器 */
    private _beginDragStep(step: ResolvedDragStep): void {
        const { sourceCoin, targetCoin } = step;
        // 硬币已在上一击被打飞（例如教程中途状态丢失）→ 跳过该步，避免教程卡死
        if (!sourceCoin || !sourceCoin.isValid || !targetCoin || !targetCoin.isValid) {
            if (this._currentStepIndex < this._steps.length - 1) {
                this._currentStepIndex++;
                this._beginCurrentStep();
            } else {
                this.skipTutorial();
            }
            return;
        }

        // 高亮源硬币
        this._clearCoinHighlight();
        this._highlightCoin(sourceCoin);

        // 显示手势提示
        this._showGestureHint(sourceCoin, targetCoin);

        // 显示目标指示器
        this._showTargetIndicator(targetCoin);

        // 显示提示文字
        this._showHint(step.hintKey);
    }

    // ── 手势提示 ──

    /** 显示手指手势提示：从源硬币指向目标反方向，循环动画 */
    private _showGestureHint(sourceCoin: Node, targetCoin: Node): void {
        const clickNode = this.uiManager?.clickNode;
        if (!clickNode || !clickNode.isValid) return;

        // 计算拖拽方向（远离目标硬币）
        const dir = new Vec3();
        Vec3.subtract(dir, sourceCoin.position, targetCoin.position);
        dir.normalize();

        const startPos = new Vec3(sourceCoin.position.x, sourceCoin.position.y, 0);
        const endPos = new Vec3(
            startPos.x + dir.x * 80,
            startPos.y + dir.y * 80,
            0,
        );

        clickNode.setPosition(startPos);
        clickNode.active = true;

        Tween.stopAllByTag(TutorialManager._tagGesture);
        tween(clickNode)
            .tag(TutorialManager._tagGesture)
            .call(() => {
                clickNode.setPosition(startPos);
            })
            .to(0.5, { position: endPos }, { easing: 'linear' })
            .delay(0.5)
            .union()
            .repeatForever()
            .start();
    }

    /** 隐藏手势提示 */
    private _hideGestureHint(): void {
        const clickNode = this.uiManager?.clickNode;
        if (clickNode && clickNode.isValid) {
            Tween.stopAllByTag(TutorialManager._tagGesture);
            clickNode.active = false;
        }
    }

    // ── 目标指示器 ──

    /** 显示目标指示器，对准目标 */
    private _showTargetIndicator(targetCoin: Node): void {
        const indicator = this.uiManager?.targetIndicator;
        if (!indicator) return;
        indicator.node.setPosition(targetCoin.position);
        indicator.open(this.gameLogic?.coinRadius ?? 32);
    }

    /** 隐藏目标指示器 */
    private _hideTargetIndicator(): void {
        this.uiManager?.targetIndicator?.close();
    }

    // ── 硬币高亮 ──

    /** 高亮指定硬币（脉冲绿色） */
    private _highlightCoin(coin: Node): void {
        const ctrl = coin.getComponent(CoinController);
        if (ctrl) {
            ctrl.showIndicator(true);
        }
    }

    /** 清除所有硬币高亮 */
    private _clearCoinHighlight(): void {
        const coins = this.gameLogic?.coinGroup?.children ?? [];
        for (const coin of coins) {
            const ctrl = coin.getComponent(CoinController);
            if (ctrl) {
                ctrl.showIndicator(false);
            }
        }
    }

    // ── 位置快照与重置 ──

    /** 记录所有硬币位置快照 */
    private _snapshotPositions(): void {
        this._coinSnapshots = [];
        const coins = this.gameLogic?.coinGroup?.children ?? [];
        for (const coin of coins) {
            this._coinSnapshots.push({
                node: coin,
                x: coin.position.x,
                y: coin.position.y,
            });
        }
    }

    /** 恢复硬币位置到快照 */
    private _restorePositions(): void {
        for (const snap of this._coinSnapshots) {
            if (snap.node && snap.node.isValid) {
                snap.node.setPosition(snap.x, snap.y, 0);
                // 清除速度
                const rb = snap.node.getComponent(RigidBody2D);
                if (rb) {
                    rb.linearVelocity = new Vec2(0, 0);
                    rb.angularVelocity = 0;
                }
            }
        }
        // 重置游戏状态
        this.gameLogic?.waitingPlayerOperation();
    }

    // ── UI 管理 ──

    /** 绑定跳过按钮点击事件 */
    private _bindSkipButton(): void {
        if (this.btnSkip) {
            this.btnSkip.node.on(Button.EventType.CLICK, () => {
                this.skipTutorial();
            }, this);
        }
    }

    /** 显示提示文字（传入 i18n key） */
    private _showHint(key: string): void {
        const text = I18n.t(key);
        this.uiTips?.open(text);
    }

    /** 隐藏提示文字 */
    private _hideHint(): void {
        this.uiTips?.close();
    }

    /** 显示跳过按钮 */
    private _showSkipButton(): void {
        if (this.btnSkip) {
            this.btnSkip.node.active = true;
        }
    }

    /** 隐藏跳过按钮 */
    private _hideSkipButton(): void {
        if (this.btnSkip) {
            this.btnSkip.node.active = false;
        }
    }

    // ── 闲置提示（从 GameLogic 移入）──

    /** 重置空闲计时器（玩家有任何操作时调用） */
    public resetIdleTimer(): void {
        this._idleTimer = 0;
        this._hideClickNode();
    }

    /** 获取手势提示方向（闲置时自动查找最近目标） */
    private _getGestureHint(): { source: Node; direction: Vec3 } | null {
        const coins = this.gameLogic?.coinGroup?.children ?? [];
        if (coins.length < 2) return null;

        const source = coins[0];
        if (!source || !source.isValid) return null;

        let closestTarget: Node | null = null;
        let minDist = Infinity;
        for (const coin of coins) {
            if (!coin || !coin.isValid || coin === source) continue;
            const dist = Vec3.distance(source.position, coin.position);
            if (dist < minDist) {
                minDist = dist;
                closestTarget = coin;
            }
        }
        if (!closestTarget) return null;

        const dir = new Vec3();
        Vec3.subtract(dir, source.position, closestTarget.position);
        dir.normalize();
        return { source, direction: dir };
    }

    /** 显示闲置手势提示 */
    private _showClickNode(): void {
        const clickNode = this.uiManager?.clickNode;
        if (!clickNode || !clickNode.isValid) return;

        const hint = this._getGestureHint();
        if (!hint) {
            clickNode.active = false;
            return;
        }

        const { source, direction } = hint;
        const startPos = new Vec3(source.position.x, source.position.y, 0);
        const endPos = new Vec3(
            startPos.x + direction.x * 80,
            startPos.y + direction.y * 80,
            0,
        );

        clickNode.setPosition(startPos);
        clickNode.active = true;
        this._isClickNodeShowing = true;

        Tween.stopAllByTag(TutorialManager._tagGesture);
        tween(clickNode)
            .tag(TutorialManager._tagGesture)
            .call(() => {
                clickNode.setPosition(startPos);
            })
            .to(0.5, { position: endPos }, { easing: 'linear' })
            .delay(0.5)
            .union()
            .repeatForever()
            .start();
    }

    /** 隐藏闲置手势提示 */
    private _hideClickNode(): void {
        const clickNode = this.uiManager?.clickNode;
        if (clickNode && clickNode.isValid) {
            Tween.stopAllByTag(TutorialManager._tagGesture);
            clickNode.active = false;
        }
        this._isClickNodeShowing = false;
        this._hideTargetIndicator();
    }

    // ── 帧更新 ──

    update(deltaTime: number) {
        // 闲置提示：玩家长时间无操作时显示 clickNode（教程模式下由手势提示接管）
        if (this._active) return;
        if (this.gameOver) return;
        if (this.isDragging || this._isClickNodeShowing) return;

        // 只在等待操作阶段显示闲置提示
        this._idleTimer += deltaTime;
        if (this._idleTimer >= this.idleShowDelay) {
            this._showClickNode();
        }
    }
}
