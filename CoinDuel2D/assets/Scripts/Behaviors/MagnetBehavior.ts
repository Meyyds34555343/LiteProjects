import { _decorator, Color, ERigidBody2DType, RigidBody2D, Vec2 } from 'cc';
import type { GameLogic } from '../GameLogic';
import { BehaviorBase, BehaviorMode } from './BehaviorBase';
import { BehaviorRegistry } from './BehaviorRegistry';
import { BehaviorVisual, BehaviorVisualConfig } from './BehaviorVisual';

const { ccclass, property } = _decorator;

/**
 * 磁鐵（被動）。
 * 每幀對範圍內的其他硬幣施加一個指向本硬幣的力，把它們慢慢吸過來。
 * 只影響動態剛體；靜止的環境硬幣與正在拖拽（Static）的硬幣不受影響。
 */
@ccclass('MagnetBehavior')
export class MagnetBehavior extends BehaviorBase {
    public priority = 70;
    public mode: BehaviorMode = 'passive';
    public exclusive = false;

    @property({ tooltip: '吸引範圍（像素，從硬幣中心算起）' })
    public range = 128;

    @property({ tooltip: '吸引力大小' })
    public force = 2000;

    protected start(): void {
        //BehaviorVisual.startIdle(this.node, this.getVisualConfig());
        // 白色空心圆标出吸引范围
        BehaviorVisual.showRangeRing(this.node, this.range, 'MagnetRange');
    }

    protected onDestroy(): void {
        BehaviorVisual.hideRangeRing(this.node, 'MagnetRange');
    }

    public getVisualConfig(): BehaviorVisualConfig {
        return {
            color: new Color(200, 120, 255, 255),
            label: 'MAGNET',
            idlePulse: false,
        };
    }

    public onTick(dt: number, gl: GameLogic): void {
        const coins = gl.coinGroup?.children;
        if (!coins || coins.length === 0) return;

        const center = this.node.worldPosition;
        const rangeSq = this.range * this.range;
        // 力 × dt = 這一幀的衝量，不同幀率下總推力一致
        const impulse = this.force * dt;

        for (const coin of coins) {
            if (coin === this.node) continue;

            const rb = coin.getComponent(RigidBody2D);
            if (!rb || rb.type !== ERigidBody2DType.Dynamic) continue;

            const pos = coin.worldPosition;
            const dx = center.x - pos.x;
            const dy = center.y - pos.y;
            const distSq = dx * dx + dy * dy;
            if (distSq > rangeSq || distSq < 0.0001) continue;

            const dist = Math.sqrt(distSq);
            rb.applyLinearImpulseToCenter(
                new Vec2((dx / dist) * impulse, (dy / dist) * impulse),
                true,
            );
        }
    }
}

BehaviorRegistry.register('MagnetBehavior', MagnetBehavior);
