import { _decorator, Node, RigidBody2D, Vec2, Color } from 'cc';
import type { GameLogic } from '../GameLogic';
import { BehaviorBase, BehaviorMode } from './BehaviorBase';
import { BehaviorVisual, BehaviorVisualConfig } from './BehaviorVisual';
import { BehaviorRegistry } from './BehaviorRegistry';

const { ccclass, property } = _decorator;

@ccclass('KnockbackBehavior')
export class KnockbackBehavior extends BehaviorBase {
    public priority = 70;
    public mode: BehaviorMode = 'dominant';
    public exclusive = true;

    @property public pushForce: number = 300000;
    @property public cooldownMs: number = 300;

    private _cooldownUntil = 0;

    protected start(): void {
        BehaviorVisual.startIdle(this.node, this.getVisualConfig());
    }

    public getVisualConfig(): BehaviorVisualConfig {
        return {
            color: new Color(255, 150, 0, 255),
            label: 'KNOCK!',
            idlePulse: true,
        };
    }

    public tryFire(self: Node, other: Node, _gl: GameLogic): boolean {
        if (Date.now() < this._cooldownUntil) return false;

        const rb = other.getComponent(RigidBody2D);
        if (!rb) return false;

        const dx = other.position.x - self.position.x;
        const dy = other.position.y - self.position.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len < 0.001) return false;

        rb.applyLinearImpulseToCenter(
            new Vec2((dx / len) * this.pushForce, (dy / len) * this.pushForce),
            true,
        );

        this._fireVisual(self);
        this._cooldownUntil = Date.now() + this.cooldownMs;
        return true;
    }
}

BehaviorRegistry.register('KnockbackBehavior', KnockbackBehavior);
