import { Color, Graphics, Label, Node, Sprite, Tween, tween, UIOpacity, UITransform, Vec3 } from 'cc';

export interface BehaviorVisualConfig {
    color: Color | null;
    label: string;
    idlePulse: boolean;
}

/** 行為的共用外觀：改硬幣顏色，開火時浮出 label。 */
export class BehaviorVisual {
    /** 在硬币中心绘制空心圆范围指示（白色描边）。重复调用会复用并重绘。 */
    public static showRangeRing(node: Node, radius: number, name: string = 'RangeRing'): Node {
        let ring = node.getChildByName(name);
        if (!ring) {
            ring = new Node(name);
            ring.layer = node.layer;
            ring.setParent(node);
            ring.setPosition(0, 0, 0);
            const ui = ring.addComponent(UITransform);
            ui.setContentSize(radius * 2, radius * 2);
            ui.setAnchorPoint(0.5, 0.5);
        }

        let graphics = ring.getComponent(Graphics);
        if (!graphics) graphics = ring.addComponent(Graphics);
        graphics.clear();
        graphics.lineWidth = 2;
        graphics.strokeColor = Color.WHITE;
        graphics.circle(0, 0, radius);
        graphics.stroke();
        return ring;
    }

    /** 移除范围指示器 */
    public static hideRangeRing(node: Node, name: string = 'RangeRing'): void {
        const ring = node.getChildByName(name);
        if (ring && ring.isValid) ring.destroy();
    }

    public static startIdle(node: Node, config: BehaviorVisualConfig): void {
        const sprite = BehaviorVisual._sprite(node);
        if (!sprite || !config.color) return;

        sprite.color = config.color;
        Tween.stopAllByTarget(sprite);
        if (!config.idlePulse) return;

        const bright = new Color(
            Math.min(255, config.color.r + 40),
            Math.min(255, config.color.g + 40),
            Math.min(255, config.color.b + 40),
            config.color.a,
        );
        tween(sprite)
            .to(0.45, { color: bright })
            .to(0.45, { color: config.color.clone() })
            .union()
            .repeatForever()
            .start();
    }

    public static playFire(node: Node, config: BehaviorVisualConfig): void {
        const sprite = BehaviorVisual._sprite(node);
        if (sprite) {
            const base = config.color ? config.color.clone() : sprite.color.clone();
            sprite.color = new Color(255, 255, 255, 255);
            tween(node)
                .to(0.08, { scale: new Vec3(1.15, 1.15, 1) })
                .to(0.12, { scale: new Vec3(1, 1, 1) })
                .start();
            tween(sprite)
                .to(0.2, { color: base })
                .start();
        }
        BehaviorVisual._floatLabel(node, config);
    }

    /** 在硬幣上方浮出 label，上移並淡出後銷毀。文字掛在父節點，硬幣瞬移不會把它帶走。 */
    private static _floatLabel(node: Node, config: BehaviorVisualConfig): void {
        if (!config.label || !node.parent) return;

        const text = new Node('BehaviorLabel');
        text.layer = node.layer;
        text.setParent(node.parent);
        text.setPosition(node.position.x, node.position.y + 48, node.position.z);

        const ui = text.addComponent(UITransform);
        ui.setContentSize(180, 48);
        ui.setAnchorPoint(0.5, 0.5);

        const label = text.addComponent(Label);
        label.string = config.label;
        label.fontSize = 28;
        label.lineHeight = 32;
        label.useSystemFont = true;
        label.fontFamily = 'Arial';
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        label.color = config.color ? config.color.clone() : new Color(255, 255, 255, 255);

        const opacity = text.addComponent(UIOpacity);
        opacity.opacity = 255;
        const rise = new Vec3(text.position.x, text.position.y + 40, text.position.z);
        tween(text).to(0.45, { position: rise }).start();
        tween(opacity)
            .delay(0.12)
            .to(0.33, { opacity: 0 })
            .call(() => {
                if (text.isValid) text.destroy();
            })
            .start();
    }

    private static _sprite(node: Node): Sprite | null {
        const child = node.getChildByName('Sprite');
        if (child) {
            const sprite = child.getComponent(Sprite);
            if (sprite) return sprite;
        }
        return node.getComponent(Sprite);
    }
}
