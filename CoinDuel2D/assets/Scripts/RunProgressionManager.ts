import { _decorator, Color, Component, Graphics, Node, UIOpacity, UITransform } from 'cc';
import { CoinController } from './CoinController';

const { ccclass } = _decorator;

export type RunBuffKind = 'aim' | 'combo' | 'mulligan';

/** 局內強化：每清掉 3 枚給一項 buff，並在出手硬幣底下畫光環。 */
@ccclass('RunProgressionManager')
export class RunProgressionManager extends Component {
    public cleared = 0;
    public aimBoost = 1;
    public comboCapExtra = 0;
    public mulligan = 0;
    public lastBuff: RunBuffKind | null = null;

    private _aura: Node | null = null;

    public beginRun(_baseAim: number): void {
        this.cleared = 0;
        this.aimBoost = 1;
        this.comboCapExtra = 0;
        this.mulligan = 0;
        this.lastBuff = null;
        this.hideAura();
    }

    /** 成功清掉一枚（發射硬幣離場）。每滿 3 枚隨機給一項。 */
    public onCoinCleared(): RunBuffKind | null {
        this.cleared++;
        if (this.cleared % 3 !== 0) return null;
        const roll = Math.floor(Math.random() * 3);
        if (roll === 0) {
            this.aimBoost *= 1.15;
            this.lastBuff = 'aim';
        } else if (roll === 1) {
            this.comboCapExtra++;
            this.lastBuff = 'combo';
        } else {
            this.mulligan++;
            this.lastBuff = 'mulligan';
        }
        console.log(`[Run] buff ${this.lastBuff} aim=${this.aimBoost.toFixed(2)} combo+${this.comboCapExtra} mulligan=${this.mulligan}`);
        return this.lastBuff;
    }

    public effectiveAim(base: number): number {
        return base * this.aimBoost;
    }

    public trySpendMulligan(): boolean {
        if (this.mulligan <= 0) return false;
        this.mulligan--;
        return true;
    }

    public attachAura(parent: Node | null, shooter: Node | null): void {
        if (!parent || !shooter?.isValid) {
            this.hideAura();
            return;
        }
        const aura = this._ensureAura(parent);
        aura.active = true;
        aura.setPosition(shooter.position.x, shooter.position.y - 2, 0);
        aura.setSiblingIndex(0);
    }

    public followShooter(shooter: Node | null): void {
        if (!this._aura?.isValid || !this._aura.active || !shooter?.isValid) return;
        this._aura.setPosition(shooter.position.x, shooter.position.y - 2, 0);
    }

    public hideAura(): void {
        if (this._aura?.isValid) this._aura.active = false;
    }

    public findShooter(coinGroup: Node | null): Node | null {
        if (!coinGroup) return null;
        for (const child of coinGroup.children) {
            if (!child.active) continue;
            const ctrl = child.getComponent(CoinController);
            if (ctrl?.allowedOperation) return child;
        }
        return null;
    }

    private _ensureAura(parent: Node): Node {
        if (this._aura?.isValid) return this._aura;
        const node = new Node('RunAura');
        node.layer = parent.layer;
        parent.addChild(node);
        node.setSiblingIndex(0);
        const ui = node.addComponent(UITransform);
        ui.setContentSize(96, 40);
        const gfx = node.addComponent(Graphics);
        gfx.fillColor = new Color(80, 255, 160, 110);
        gfx.ellipse(0, 0, 42, 16);
        gfx.fill();
        gfx.strokeColor = new Color(180, 255, 210, 200);
        gfx.lineWidth = 3;
        gfx.ellipse(0, 0, 42, 16);
        gfx.stroke();
        node.addComponent(UIOpacity).opacity = 200;
        this._aura = node;
        return node;
    }
}
