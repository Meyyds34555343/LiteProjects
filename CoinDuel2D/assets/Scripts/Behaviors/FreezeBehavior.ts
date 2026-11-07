import { _decorator, Color, Node, RigidBody2D, Vec2 } from 'cc';
import type { GameLogic } from '../GameLogic';
import { BehaviorBase, BehaviorMode } from './BehaviorBase';
import { BehaviorRegistry } from './BehaviorRegistry';
import { BehaviorVisual, BehaviorVisualConfig } from './BehaviorVisual';

const { ccclass, property } = _decorator;

/**
 * 冰凍（主動）。
 * 撞到這枚硬幣的另一方會被停住一小段時間。
 * 優先級 60，低於擊退（70），所以兩邊都有主動行為時擊退勝出。
 */
@ccclass('FreezeBehavior')
export class FreezeBehavior extends BehaviorBase {
    public priority = 90;
    public mode: BehaviorMode = 'dominant';
    public exclusive = true;

    @property({ tooltip: '冰凍持續秒數' })
    public freezeDuration = 1.2;

    @property({ tooltip: '冰凍期間的線性阻尼，越大越快停住' })
    public frozenDamping = 40;

    @property({ tooltip: '再次觸發前的冷卻（毫秒）' })
    public cooldownMs = 400;

    private _cooldownUntil = 0;
    private _generation = new Map<Node, number>();
    private _savedDamping = new Map<Node, number>();

    protected start(): void {
        BehaviorVisual.startIdle(this.node, this.getVisualConfig());
    }

    public getVisualConfig(): BehaviorVisualConfig {
        return {
            color: new Color(140, 210, 255, 255),
            label: 'FREEZE',
            idlePulse: true,
        };
    }

    public tryFire(self: Node, other: Node, _gl: GameLogic): boolean {
        if (other === self) return false;
        if (!other.getComponent('CoinController')) return false;

        const rb = other.getComponent(RigidBody2D);
        if (!rb) return false;

        // 冷卻中的第二次接觸仍算同一下冰凍，不要交回一般計分再算一次。
        if (Date.now() < this._cooldownUntil) {
            return this._generation.has(other);
        }

        if (!this._savedDamping.has(other)) {
            this._savedDamping.set(other, rb.linearDamping);
        }

        const gen = (this._generation.get(other) ?? 0) + 1;
        this._generation.set(other, gen);

        // 等這一下碰撞先結算，下一幀再停住，避免發射硬幣穿過去再撞到第二枚。
        this.scheduleOnce(() => {
            if (!rb.isValid || this._generation.get(other) !== gen) return;
            rb.linearVelocity = new Vec2(0, 0);
            rb.angularVelocity = 0;
            rb.linearDamping = this.frozenDamping;
        }, 0);

        this.scheduleOnce(() => {
            if (this._generation.get(other) !== gen) return;
            this._thaw(other);
        }, this.freezeDuration);

        this._fireVisual(self);
        this._cooldownUntil = Date.now() + this.cooldownMs;
        return true;
    }

    protected onDestroy(): void {
        const nodes = Array.from(this._savedDamping.keys());
        for (const node of nodes) this._thaw(node);
    }

    private _thaw(node: Node): void {
        const damping = this._savedDamping.get(node);
        this._savedDamping.delete(node);
        this._generation.delete(node);
        if (damping === undefined || !node.isValid) return;

        const rb = node.getComponent(RigidBody2D);
        if (rb && rb.isValid) rb.linearDamping = damping;
    }
}

BehaviorRegistry.register('FreezeBehavior', FreezeBehavior);
