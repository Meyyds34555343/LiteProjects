import { _decorator, Color, ERigidBody2DType, RigidBody2D, Vec2 } from 'cc';
import type { GameLogic } from '../GameLogic';
import { CoinController } from '../CoinController';
import { BehaviorBase, BehaviorMode } from './BehaviorBase';
import { BehaviorRegistry } from './BehaviorRegistry';
import { BehaviorVisual, BehaviorVisualConfig } from './BehaviorVisual';

const { ccclass } = _decorator;

/**
 * 障礙物（被動）。
 * 硬幣固定在原地，不會被任何碰撞或爆炸推走；其他硬幣撞上時由物理引擎自然反彈。
 * 掛上後會移除 CoinController：不可拖拽/發射，也不計入剩餘硬幣與命中判定。
 */
@ccclass('BlockerBehavior')
export class BlockerBehavior extends BehaviorBase {
    public priority = 0;
    public mode: BehaviorMode = 'passive';
    public exclusive = false;

    protected start(): void {
        // 先移除玩家操作（拖拽會把剛體切成 Static 並改變位置）
        const ctrl = this.node.getComponent(CoinController);
        if (ctrl) this.node.removeComponent(ctrl);

        const rb = this.node.getComponent(RigidBody2D);
        if (rb) {
            rb.type = ERigidBody2DType.Static;
            rb.linearVelocity = new Vec2(0, 0);
            rb.angularVelocity = 0;
            rb.fixedRotation = true;
        }

        //BehaviorVisual.startIdle(this.node, this.getVisualConfig());
    }

    public getVisualConfig(): BehaviorVisualConfig {
        return {
            color: new Color(170, 170, 180, 255),
            label: 'BLOCK',
            idlePulse: false,
        };
    }
}

BehaviorRegistry.register('BlockerBehavior', BlockerBehavior);
