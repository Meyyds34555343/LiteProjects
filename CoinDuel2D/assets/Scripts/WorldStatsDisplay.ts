import { _decorator, Color, Component, Label, Node, tween, UITransform, Vec3 } from 'cc';
import { SoundManager } from './SoundManager';

const { ccclass } = _decorator;

/** 木桌上的即時數字：連擊、最高連擊、剩餘目標。 */
@ccclass('WorldStatsDisplay')
export class WorldStatsDisplay extends Component {
    private _root: Node | null = null;
    private _streak: Label | null = null;
    private _best: Label | null = null;
    private _left: Label | null = null;
    private _streakNode: Node | null = null;
    private _bestNode: Node | null = null;
    private _leftNode: Node | null = null;
    private _lastStreak = -1;
    private _lastBest = -1;
    private _lastLeft = -1;
    private _bestValue = 0;

    public ensure(parent: Node | null, tableHeight: number): void {
        if (!parent) return;
        if (this._root?.isValid) return;
        const root = new Node('WorldStats');
        root.layer = parent.layer;
        parent.addChild(root);
        root.setPosition(0, -tableHeight / 2 + 56, 0);
        this._root = root;
        this._streakNode = this._makeLine(root, -180, 'Streak 0');
        this._bestNode = this._makeLine(root, 0, 'Best 0');
        this._leftNode = this._makeLine(root, 180, 'Left 0');
        this._streak = this._streakNode.getComponent(Label);
        this._best = this._bestNode.getComponent(Label);
        this._left = this._leftNode.getComponent(Label);
    }

    public sync(streak: number, remaining: number): void {
        if (streak > this._bestValue) this._bestValue = streak;
        if (this._streak && streak !== this._lastStreak) {
            this._streak.string = `Streak ${streak}`;
            this._pulse(this._streakNode);
            this._lastStreak = streak;
            if (streak > 0 && streak % 3 === 0) SoundManager.instance?.playShot(1.2);
        }
        if (this._best && this._bestValue !== this._lastBest) {
            this._best.string = `Best ${this._bestValue}`;
            this._pulse(this._bestNode);
            this._lastBest = this._bestValue;
        }
        if (this._left && remaining !== this._lastLeft) {
            this._left.string = `Left ${Math.max(0, remaining - 1)}`;
            this._pulse(this._leftNode);
            this._lastLeft = remaining;
        }
    }

    public resetBest(): void {
        this._bestValue = 0;
        this._lastStreak = -1;
        this._lastBest = -1;
        this._lastLeft = -1;
    }

    private _makeLine(parent: Node, x: number, text: string): Node {
        const node = new Node('Stat');
        node.layer = parent.layer;
        parent.addChild(node);
        node.setPosition(x, 0, 0);
        const ui = node.addComponent(UITransform);
        ui.setContentSize(160, 36);
        const label = node.addComponent(Label);
        label.string = text;
        label.fontSize = 22;
        label.lineHeight = 26;
        label.useSystemFont = true;
        label.fontFamily = 'Arial';
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.color = new Color(255, 236, 180, 255);
        label.enableOutline = true;
        label.outlineColor = new Color(40, 20, 0, 220);
        label.outlineWidth = 2;
        return node;
    }

    private _pulse(node: Node | null): void {
        if (!node?.isValid) return;
        node.setScale(1, 1, 1);
        tween(node)
            .to(0.08, { scale: new Vec3(1.25, 1.25, 1) })
            .to(0.12, { scale: new Vec3(1, 1, 1) })
            .start();
    }
}
