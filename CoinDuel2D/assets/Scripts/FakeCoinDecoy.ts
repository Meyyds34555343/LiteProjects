import { _decorator, CircleCollider2D, Color, Component, Graphics, Node, RigidBody2D, tween, UIOpacity, UITransform, Vec3 } from 'cc';

const { ccclass, property } = _decorator;

/**
 * 假幣誘餌：高速發射幣會穿過去並噴紙屑，不計命中。
 * 低速仍會撞到（實體碰撞）。
 */
@ccclass('FakeCoinDecoy')
export class FakeCoinDecoy extends Component {
    @property({ tooltip: '超過此速度才穿過去（世界單位／秒）' })
    public ghostSpeed = 380;

    /** 若穿過去回傳 true，呼叫端應略過命中計數。 */
    public tryGhost(shot: Node | null, parent: Node | null): boolean {
        if (!shot?.isValid) return false;
        const body = shot.getComponent(RigidBody2D);
        const speed = body?.linearVelocity.length() ?? 0;
        if (speed < this.ghostSpeed) return false;

        const col = this.getComponent(CircleCollider2D);
        if (col) {
            col.sensor = true;
            this.unschedule(this._restoreSolid);
            this.scheduleOnce(this._restoreSolid, 0.22);
        }
        this._burstConfetti(parent ?? this.node.parent, this.node.position.x, this.node.position.y);
        console.log('[Prank] Fake coin! Confetti!');
        return true;
    }

    private _restoreSolid = (): void => {
        const col = this.getComponent(CircleCollider2D);
        if (col?.isValid) col.sensor = false;
    };

    private _burstConfetti(parent: Node | null, x: number, y: number): void {
        if (!parent) return;
        for (let i = 0; i < 12; i++) {
            const bit = new Node('Confetti');
            bit.layer = parent.layer;
            parent.addChild(bit);
            bit.setPosition(x, y, 0);
            const ui = bit.addComponent(UITransform);
            ui.setContentSize(8, 8);
            const gfx = bit.addComponent(Graphics);
            const colors = [
                new Color(255, 80, 120, 255),
                new Color(80, 220, 255, 255),
                new Color(255, 220, 60, 255),
                new Color(120, 255, 140, 255),
            ];
            gfx.fillColor = colors[i % colors.length];
            gfx.rect(-4, -4, 8, 8);
            gfx.fill();
            const opacity = bit.addComponent(UIOpacity);
            const ang = (i / 12) * Math.PI * 2;
            const dest = new Vec3(x + Math.cos(ang) * 70, y + Math.sin(ang) * 70, 0);
            tween(bit).to(0.35, { position: dest }, { easing: 'quadOut' }).start();
            tween(opacity).to(0.35, { opacity: 0 }).call(() => {
                if (bit.isValid) bit.destroy();
            }).start();
        }
    }
}
