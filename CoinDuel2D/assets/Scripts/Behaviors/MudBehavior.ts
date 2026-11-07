import { _decorator, Color, ERigidBody2DType, Node, RigidBody2D } from 'cc';
import type { GameLogic } from '../GameLogic';
import { BehaviorBase, BehaviorMode } from './BehaviorBase';
import { BehaviorRegistry } from './BehaviorRegistry';
import { BehaviorVisual, BehaviorVisualConfig } from './BehaviorVisual';

const { ccclass, property } = _decorator;

/**
 * 泥潭（被動）。
 * 範圍內的其他硬幣會被加大線性阻尼，也就是變得更黏、更快停下來。
 * 離開範圍（或行為被移除）後恢復原本的阻尼。
 */
@ccclass('MudBehavior')
export class MudBehavior extends BehaviorBase {
    public priority = 0;
    public mode: BehaviorMode = 'passive';
    public exclusive = false;

    /**
     * 摩擦力 → 線性阻尼的換算係數。
     * 預設摩擦力 60 換算為額外 6 的阻尼，與場景泥潭手感一致（coinDamping 2、mudDamping 8）。
     */
    private static readonly DAMPING_PER_FRICTION = 0.1;

    @property({ tooltip: '泥潭範圍（像素，從硬幣中心算起）' })
    public range = 128;

    @property({ tooltip: '摩擦力（60 ≈ 額外 6 的線性阻尼）' })
    public friction = 60;

    /** 進入範圍前各硬幣的線性阻尼，離開時用來還原。 */
    private _savedDamping = new Map<Node, number>();

    protected start(): void {
        //BehaviorVisual.startIdle(this.node, this.getVisualConfig());
        // 白色空心圆标出泥潭范围
        BehaviorVisual.showRangeRing(this.node, this.range, 'MudRange');
    }

    public getVisualConfig(): BehaviorVisualConfig {
        return {
            color: new Color(150, 110, 70, 255),
            label: 'MUD',
            idlePulse: false,
        };
    }

    public onTick(_dt: number, gl: GameLogic): void {
        const coins = gl.coinGroup?.children;
        if (!coins || coins.length === 0) return;

        const dampingDelta = this.friction * MudBehavior.DAMPING_PER_FRICTION;
        const center = this.node.worldPosition;
        const rangeSq = this.range * this.range;
        const inside = new Set<Node>();

        for (const coin of coins) {
            if (coin === this.node) continue;

            const rb = coin.getComponent(RigidBody2D);
            if (!rb || rb.type !== ERigidBody2DType.Dynamic) continue;

            const pos = coin.worldPosition;
            const dx = pos.x - center.x;
            const dy = pos.y - center.y;
            if (dx * dx + dy * dy > rangeSq) continue;

            inside.add(coin);
            if (!this._savedDamping.has(coin)) {
                this._savedDamping.set(coin, rb.linearDamping);
            }
            // GameLogic 每幀會把阻尼刷回基礎值，所以這裡要持續寫入
            rb.linearDamping = this._savedDamping.get(coin)! + dampingDelta;
        }

        // 離開範圍（或已銷毀）的硬幣還原阻尼
        for (const [coin, base] of this._savedDamping) {
            if (inside.has(coin)) continue;
            this._savedDamping.delete(coin);
            if (!coin.isValid) continue;
            const rb = coin.getComponent(RigidBody2D);
            if (rb) rb.linearDamping = base;
        }
    }

    protected onDisable(): void {
        this._restoreAll();
    }

    protected onDestroy(): void {
        BehaviorVisual.hideRangeRing(this.node, 'MudRange');
        this._restoreAll();
    }

    private _restoreAll(): void {
        for (const [coin, base] of this._savedDamping) {
            if (!coin.isValid) continue;
            const rb = coin.getComponent(RigidBody2D);
            if (rb) rb.linearDamping = base;
        }
        this._savedDamping.clear();
    }
}

BehaviorRegistry.register('MudBehavior', MudBehavior);
