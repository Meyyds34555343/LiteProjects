import { _decorator, Color, Node, RigidBody2D, Vec2 } from 'cc';
import type { GameLogic } from '../GameLogic';
import { BehaviorBase, BehaviorMode } from './BehaviorBase';
import { BehaviorRegistry } from './BehaviorRegistry';
import { BehaviorVisual, BehaviorVisualConfig } from './BehaviorVisual';

const { ccclass, property } = _decorator;

/**
 * 无动作（主動）。
 */
@ccclass('NoneBehavior')
export class NoneBehavior extends BehaviorBase {
    public priority = 0;
    public mode: BehaviorMode = 'dominant';
    public exclusive = false;

    protected start(): void {
        //BehaviorVisual.startIdle(this.node, this.getVisualConfig());
    }

    public getVisualConfig(): BehaviorVisualConfig {
        return {
            color: new Color(255, 255, 255, 255),
            label: 'NONE',
            idlePulse: false,
        };
    }

    public tryFire(self: Node, other: Node, _gl: GameLogic): boolean {
        return false;
    }
}

BehaviorRegistry.register('NoneBehavior', NoneBehavior);
