import { _decorator, Color, Node, RigidBody2D, Sprite, tween, UITransform, Vec2, Vec3 } from 'cc';
import type { GameLogic } from '../GameLogic';
import { BehaviorBase, BehaviorMode } from './BehaviorBase';
import { BehaviorRegistry } from './BehaviorRegistry';
import { BehaviorVisual, BehaviorVisualConfig } from './BehaviorVisual';

const { ccclass, property } = _decorator;

/**
 * 閃身步（主動）。
 * 被撞時往撞擊方向的側邊瞬移，並在原點留下淡出殘影。
 * 優先級 80，高於擊退（70）與冰凍（60）。
 */
@ccclass('FlashStepBehavior')
export class FlashStepBehavior extends BehaviorBase {
    public priority = 80;
    public mode: BehaviorMode = 'dominant';
    public exclusive = true;

    @property({ tooltip: '側向閃避距離' })
    public dodgeDistance = 80;

    @property({ tooltip: '整場可閃避次數' })
    public maxUses = 2;

    @property({ tooltip: '再次觸發前的冷卻（毫秒）' })
    public cooldownMs = 500;

    private _usesLeft = -1;
    private _cooldownUntil = 0;
    private _lastOther: Node | null = null;

    protected start(): void {
        this._usesLeft = this.maxUses;
        BehaviorVisual.startIdle(this.node, this.getVisualConfig());
    }

    public getVisualConfig(): BehaviorVisualConfig {
        return {
            color: new Color(255, 255, 100, 255),
            label: 'DODGE!',
            idlePulse: true,
        };
    }

    public tryFire(self: Node, other: Node, gl: GameLogic): boolean {
        if (other === self) return false;
        if (!other.getComponent('CoinController')) return false;

        const otherRb = other.getComponent(RigidBody2D);
        const selfRb = self.getComponent(RigidBody2D);
        if (!otherRb || !selfRb) return false;

        if (this._usesLeft < 0) this._usesLeft = this.maxUses;

        // 同一次撞擊可能回報兩次。冷卻中的同一枚對方仍算這次閃避。
        if (Date.now() < this._cooldownUntil) {
            return other === this._lastOther;
        }
        if (this._usesLeft <= 0) return false;

        const side = this._sideDirection(self, other, selfRb, otherRb);
        this._spawnAfterimage(self);

        const next = this._clampToTable(
            self.position.x + side.x * this.dodgeDistance,
            self.position.y + side.y * this.dodgeDistance,
            gl,
        );
        // tryFire 在物理 step（BEGIN_CONTACT）里被调用。step 期间改节点位置不会同步到刚体，
        // 而 step 结束后 syncPhysicsToScene 又会用刚体位置覆盖节点，瞬移会被吃掉；
        // 所以延迟到下一帧 update（物理 step 之前）再设置位置。
        this.scheduleOnce(() => {
            if (!self.isValid) return;
            self.setPosition(next.x, next.y, self.position.z);
            if (selfRb.isValid) {
                selfRb.linearVelocity = new Vec2(0, 0);
                selfRb.angularVelocity = 0;
            }
        }, 0);

        this._fireVisual(self);
        this._usesLeft -= 1;
        this._lastOther = other;
        this._cooldownUntil = Date.now() + this.cooldownMs;
        return true;
    }

    /** 撞擊者速度的垂直方向。速度太小時改看自己的速度，再不行就用兩枚硬幣的位置差。 */
    private _sideDirection(self: Node, other: Node, selfRb: RigidBody2D, otherRb: RigidBody2D): Vec2 {
        let vx = otherRb.linearVelocity.x;
        let vy = otherRb.linearVelocity.y;
        if (vx * vx + vy * vy < 1) {
            vx = selfRb.linearVelocity.x;
            vy = selfRb.linearVelocity.y;
        }
        if (vx * vx + vy * vy < 1) {
            vx = self.position.x - other.position.x;
            vy = self.position.y - other.position.y;
        }
        const len = Math.sqrt(vx * vx + vy * vy);
        if (len < 0.001) {
            vx = 1;
            vy = 0;
        } else {
            vx /= len;
            vy /= len;
        }

        const goLeft = Math.random() < 0.5;
        return goLeft ? new Vec2(-vy, vx) : new Vec2(vy, -vx);
    }

    private _clampToTable(x: number, y: number, gl: GameLogic): Vec2 {
        const limitX = gl.tableWidth / 2 - gl.wallThickness - gl.coinRadius;
        const limitY = gl.tableHeight / 2 - gl.wallThickness - gl.coinRadius;
        return new Vec2(
            Math.max(-limitX, Math.min(limitX, x)),
            Math.max(-limitY, Math.min(limitY, y)),
        );
    }

    /** 殘影是純顯示節點，不複製剛體與行為，所以傳送不會把影子一起帶走。 */
    private _spawnAfterimage(self: Node): void {
        if (!self.parent) return;

        const source = this._sprite(self);
        const ghost = new Node('FlashAfterimage');
        ghost.layer = self.layer;
        ghost.setParent(self.parent);
        ghost.setPosition(self.position);
        ghost.setScale(self.scale);

        const ui = ghost.addComponent(UITransform);
        const srcUi = source?.node.getComponent(UITransform) ?? self.getComponent(UITransform);
        const width = srcUi ? srcUi.contentSize.width : 64;
        const height = srcUi ? srcUi.contentSize.height : 64;
        ui.setContentSize(width, height);
        ui.setAnchorPoint(0.5, 0.5);

        const sprite = ghost.addComponent(Sprite);
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        if (source?.spriteFrame) sprite.spriteFrame = source.spriteFrame;
        sprite.color = new Color(255, 255, 100, 160);

        const grown = new Vec3(ghost.scale.x * 1.6, ghost.scale.y * 1.6, 1);
        tween(ghost).to(0.4, { scale: grown }).start();
        tween(sprite)
            .to(0.4, { color: new Color(255, 255, 100, 0) })
            .call(() => {
                if (ghost.isValid) ghost.destroy();
            })
            .start();
    }

    private _sprite(node: Node): Sprite | null {
        const child = node.getChildByName('Sprite');
        if (child) {
            const sprite = child.getComponent(Sprite);
            if (sprite) return sprite;
        }
        return node.getComponent(Sprite);
    }
}

BehaviorRegistry.register('FlashStepBehavior', FlashStepBehavior);
