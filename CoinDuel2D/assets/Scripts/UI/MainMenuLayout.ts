import { _decorator, Component, Node, UITransform, screen } from 'cc';

const { ccclass, property } = _decorator;

/**
 * Responsive main-menu layout for CoinDuel2D.
 *
 * Why this exists: the menu uses `cc.Widget` for the background + update label,
 * but the logo and the mode buttons are plain nodes with absolute positions
 * tuned for 1280x720. On wide / short browser windows that either overlaps the
 * logo or pushes buttons off-screen.
 *
 * This component re-flows those nodes in `onLoad` and on every canvas resize,
 * so the layout is correct on the first frame (no visible shift) and stays
 * correct on itch.io iframes, 16:10 laptops and phone landscape.
 *
 * Scene setup (attach to Canvas, then drag nodes into the slots):
 *   Canvas
 *   ├── Background   (Widget: stretch all)
 *   ├── Logo         -> logo
 *   ├── ButtonLevels -> buttons[0]
 *   ├── ButtonLadder -> buttons[1]
 *   ├── ButtonPVP    -> buttons[2] (hidden)
 *   ├── UpdateMessage(Widget: bottom)
 *   └── MainMenuLayout (this component)
 *
 * Reference resolution is 1280x720; all values below are design pixels.
 */
@ccclass('MainMenuLayout')
export class MainMenuLayout extends Component {
    @property(Node)
    public logo: Node | null = null;

    @property([Node])
    public buttons: Node[] = [];

    /** Vertical distance between two buttons. */
    @property
    public buttonGap: number = 118;

    /** Distance from the logo baseline down to the first button. */
    @property
    public logoGap: number = 96;

    /** Nudges the whole stack up/down to balance the bottom update label. */
    @property
    public stackOffsetY: number = -30;

    /** Minimum uniform scale applied to buttons on short screens. */
    @property
    public minScale: number = 0.78;

    onLoad(): void {
        this.apply();
    }

    onEnable(): void {
        // `window-resize` fires for browser window + itch iframe resizes.
        screen.on('window-resize', this.apply, this);
        this.apply();
    }

    onDisable(): void {
        screen.off('window-resize', this.apply, this);
    }

    /** Re-layout now. Safe to call any time (editor, rotate, iframe resize). */
    public apply(): void {
        // Only visible buttons participate, otherwise a hidden PVP button would
        // leave a hole in the stack.
        const active = (this.buttons ?? []).filter((b) => !!b && b.activeInHierarchy);
        if (active.length === 0 && !this.logo) return;

        const host = this.node.getComponent(UITransform);
        const width = host?.width ?? 1280;
        const height = host?.height ?? 720;

        // Shrink as the viewport gets shorter than the 720 design height.
        const fit = this._clamp(height / 720, this.minScale, 1);

        const gap = this.buttonGap * fit;
        const firstOffset = this.logoGap * fit;
        const stackHeight = firstOffset + gap * Math.max(0, active.length - 1);
        const topY = stackHeight / 2 + this.stackOffsetY;

        for (let i = 0; i < active.length; i++) {
            const node = active[i];
            node.setPosition(0, topY - firstOffset - gap * i, 0);
            node.setScale(fit, fit, 1);
        }

        if (this.logo) {
            const logoHeight = this.logo.getComponent(UITransform)?.height ?? 176;
            this.logo.setPosition(0, topY + (logoHeight * 0.5 + 24) * fit, 0);

            // Never let the wordmark overflow horizontally in narrow windows.
            const logoWidth = this.logo.getComponent(UITransform)?.width ?? 640;
            const widthFit = this._clamp((width * 0.88) / Math.max(1, logoWidth), this.minScale, 1);
            const s = Math.min(widthFit, fit);
            this.logo.setScale(s, s, 1);
        }
    }

    private _clamp(value: number, min: number, max: number): number {
        if (!Number.isFinite(value)) return max;
        return Math.min(max, Math.max(min, value));
    }
}
