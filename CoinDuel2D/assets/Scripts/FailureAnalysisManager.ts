import { _decorator, Color, Component, Label, Node, tween, Tween, UIOpacity, UITransform, Vec3 } from 'cc';

const { ccclass } = _decorator;

/** 失誤時在撞點上方浮出可執行的提示，0.6 秒淡出。 */
@ccclass('FailureAnalysisManager')
export class FailureAnalysisManager extends Component {
    /** 目前仍在顯示中的提示節點。 */
    private _hints: Node[] = [];

    /** 立即清除所有失誤提示（例如玩家馬上點擊回退時）。 */
    public clear(): void {
        const hints = this._hints;
        this._hints = [];
        for (const node of hints) {
            if (!node || !node.isValid) continue;
            Tween.stopAllByTarget(node);
            const opacity = node.getComponent(UIOpacity);
            if (opacity) Tween.stopAllByTarget(opacity);
            node.destroy();
        }
    }

    public explain(
        parent: Node | null,
        x: number,
        y: number,
        hitCount: number,
        foul: Node | null,
        shot: Node | null,
    ): void {
        if (!parent) return;
        let line = 'Missed! Aim into another coin.';
        if (hitCount >= 2) {
            const side = this._sideHint(shot, foul);
            line = side
                ? `Hit 2 coins! Avoid the ${side} coin next time!`
                : 'Hit 2 coins! Only hit one next time!';
        } else if (hitCount === 0) {
            line = 'No contact! Pull farther and aim the tip into a coin.';
        }
        this._spawn(parent, x, y + 48, line);
    }

    public explainFall(parent: Node | null, x: number, y: number): void {
        this._spawn(parent, x, y + 48, 'Coin fell! Keep the shot inside the table.');
    }

    private _sideHint(shot: Node | null, foul: Node | null): string | null {
        if (!shot?.isValid || !foul?.isValid) return null;
        const dx = foul.position.x - shot.position.x;
        const dy = foul.position.y - shot.position.y;
        if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
        return dy >= 0 ? 'upper' : 'lower';
    }

    private _spawn(parent: Node, x: number, y: number, text: string): void {
        const node = new Node('FailHint');
        node.layer = parent.layer;
        parent.addChild(node);
        this._hints.push(node);
        node.setPosition(x, y, 0);
        node.setScale(0.4, 0.4, 1);
        const ui = node.addComponent(UITransform);
        ui.setContentSize(420, 56);
        const label = node.addComponent(Label);
        label.string = text;
        label.fontSize = 22;
        label.lineHeight = 26;
        label.useSystemFont = true;
        label.fontFamily = 'Arial';
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.overflow = Label.Overflow.RESIZE_HEIGHT;
        label.color = new Color(255, 240, 120, 255);
        label.enableOutline = true;
        label.outlineColor = new Color(0, 0, 0, 230);
        label.outlineWidth = 2;
        const opacity = node.addComponent(UIOpacity);
        tween(node).to(0.12, { scale: new Vec3(1.05, 1.05, 1) }).to(0.08, { scale: new Vec3(1, 1, 1) }).start();
        tween(opacity).delay(0.8).to(0.4, { opacity: 0 }).call(() => {
            const index = this._hints.indexOf(node);
            if (index >= 0) this._hints.splice(index, 1);
            if (node.isValid) node.destroy();
        }).start();
    }
}
