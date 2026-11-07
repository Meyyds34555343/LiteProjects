import { _decorator, Color, Component, Node, Sprite, SpriteFrame, resources, UITransform, Prefab, instantiate } from 'cc';
const { ccclass, property } = _decorator;

/** 单个缺口的定义 */
export interface GapInfo {
    side: number;  // 0=上 1=右 2=下 3=左
    center: number; // 沿墙方向的位置
}

@ccclass('TableController')
export class TableController extends Component {

    public tableWidth: number = 1280;

    public tableHeight: number = 720;

    @property(Prefab)
    public wallPrefab: Prefab | null = null;
    @property(Prefab)
    public cornerPrefab: Prefab | null = null;

    @property({ tooltip: "围墙厚度（像素）" })
    public wallThickness: number = 8;

    @property({ tooltip: "围墙颜色" })
    public wallColor: string = '#8B5A2B';

    @property({ tooltip: "缺口宽度基数（不含增量）" })
    public gapWidth: number = 80;

    @property({ tooltip: "缺口宽度每关增量" })
    public gapWidthIncrement: number = 10;

    /** 本局所有缺口 */
    public gaps: GapInfo[] = [];

    private _tableSprite: Sprite | null = null;
    private _wallNode: Node | null = null;
    private _wallSpriteFrame: SpriteFrame | null = null;

    protected start(): void {
        const parent = this.node.parent;
        if (!parent) return;

        // 绿色桌面（使用纹理）
        const tableNode = new Node('TableGreen');
        tableNode.layer = 1; // WORLD
        parent.addChild(tableNode);
        tableNode.setPosition(0, 0, 0);
        const tableTransform = tableNode.addComponent(UITransform);
        tableTransform.setContentSize(this.tableWidth, this.tableHeight);
        this._tableSprite = tableNode.addComponent(Sprite);
        this._tableSprite.sizeMode = Sprite.SizeMode.CUSTOM;
        this._tableSprite.type = Sprite.Type.TILED;

        // 加载桌面纹理
        resources.load('textures/table_1/spriteFrame', SpriteFrame, (err, sf) => {
            if (!err && sf && this._tableSprite) {
                this._tableSprite.spriteFrame = sf;
            } else {
                console.warn('[TableController] 加载桌面纹理失败:', err);
            }
        });

        // 围墙容器节点（子节点为各段围墙 Sprite）
        const wallNode = new Node('Walls');
        wallNode.layer = 1; // WORLD
        parent.addChild(wallNode);
        wallNode.setPosition(0, 0, 0);
        this._wallNode = wallNode;

        // 加载围墙纹理
        resources.load('textures/wall_1/spriteFrame', SpriteFrame, (err, sf) => {
            if (!err && sf) {
                this._wallSpriteFrame = sf;
                // 如果纹理加载时围墙已创建，刷新纹理
                this._assignWallTexture();
            } else {
                console.warn('[TableController] 加载围墙纹理失败:', err);
            }
        });

        // 渲染顺序：TableGreen → Walls → CoinGroup
        const coinGroup = parent.getChildByName('CoinGroup');
        if (coinGroup) {
            const idx = coinGroup.getSiblingIndex();
            tableNode.setSiblingIndex(idx);
            wallNode.setSiblingIndex(idx + 1);
        }
    }

    /** 将围墙纹理赋予所有已创建的围墙段 Sprite */
    private _assignWallTexture(): void {
        if (!this._wallNode || !this._wallSpriteFrame) return;
        for (const child of this._wallNode.children) {
            const sprite = child.getComponent(Sprite);
            if (sprite && !sprite.spriteFrame) {
                sprite.spriteFrame = this._wallSpriteFrame;
            }
        }
    }

    /** 生成 N 个缺口（每边最多一个，边不重复） */
    public generateRandomGaps(count: number): void {
        this.gaps = [];
        const sides = [0, 1, 2, 3];
        // Fisher-Yates 洗牌
        for (let i = sides.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [sides[i], sides[j]] = [sides[j], sides[i]];
        }

        const n = Math.min(count, 4);
        for (let i = 0; i < n; i++) {
            const side = sides[i];
            const halfSpanW = this.tableWidth / 2 - this.wallThickness - this.gapWidth / 2;
            const halfSpanH = this.tableHeight / 2 - this.wallThickness - this.gapWidth / 2;
            let center = 0;
            if (side === 0 || side === 2) {
                center = (Math.random() * 2 - 1) * halfSpanW;
            } else {
                center = (Math.random() * 2 - 1) * halfSpanH;
            }
            this.gaps.push({ side, center });
        }
    }

    /** 绘制桌面 + 围墙（含所有缺口） */
    public drawTable(): void {
        // 更新桌面尺寸（兼容后续尺寸变化）
        const ut = this._tableSprite?.node?.getComponent(UITransform);
        if (ut) {
            ut.setContentSize(this.tableWidth, this.tableHeight);
        }

        // 重建围墙段
        this._rebuildWalls();
    }

    /**
     * 熱換桌布（世界空間 TableGreen，不碰 Canvas HUD）。
     * frame 由 AssetSyncManager / DynamicAssetLoader 在 runtime 產生。
     */
    public applyFeltSkin(frame: SpriteFrame | null, tintHex?: string): void {
        if (!this._tableSprite || !frame) return;
        this._tableSprite.spriteFrame = frame;
        if (tintHex) this._tableSprite.color = this._parseHex(tintHex);
    }

    /** 熱換圍牆貼圖並套到現有牆段。 */
    public applyWallSkin(frame: SpriteFrame | null): void {
        if (!frame) return;
        this._wallSpriteFrame = frame;
        if (!this._wallNode) return;
        for (const child of this._wallNode.children) {
            const sprite = child.getComponent(Sprite);
            if (sprite) sprite.spriteFrame = frame;
        }
    }

    private _parseHex(hex: string): Color {
        const h = hex.replace('#', '');
        const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
        if (Number.isNaN(n)) return Color.WHITE;
        return new Color((n >> 16) & 255, (n >> 8) & 255, n & 255, 255);
    }

    /** 根据当前缺口配置重建所有围墙段（实例化 wallPrefab / cornerPrefab，不旋转，仅调整 contentSize） */
    private _rebuildWalls(): void {
        if (!this._wallNode) return;
        this._wallNode.removeAllChildren();

        const segments = this._calcWallSegments();
        let lastChildIdx = 0;

        // 围墙段：实例化 wallPrefab，按段方向调整 contentSize
        if (this.wallPrefab) {
            for (const seg of segments) {
                if (seg.w <= 0 || seg.h <= 0) continue;

                const segNode = instantiate(this.wallPrefab);
                segNode.layer = 1;
                this._wallNode.addChild(segNode);
                segNode.setPosition(seg.x + seg.w / 2, seg.y + seg.h / 2, 0);

                const ut = segNode.getComponent(UITransform) || segNode.addComponent(UITransform);
                if (seg.side === 0 || seg.side === 2) {
                    // 上/下墙：水平段，宽度为段长，高度为墙厚
                    ut.setContentSize(seg.w, this.wallThickness);
                } else {
                    // 左/右墙：垂直段，宽度为墙厚，高度为段长
                    ut.setContentSize(this.wallThickness, seg.h);
                }
                lastChildIdx++;
            }
        }

        // 四角：实例化 cornerPrefab，放在桌面四角，尺寸为墙厚×墙厚
        if (this.cornerPrefab) {
            const hw = this.tableWidth / 2;
            const hh = this.tableHeight / 2;
            const wt = this.wallThickness;
            const halfWt = wt / 2;
            // 四角位置（桌面外边缘对齐墙内侧）
            const cornerPositions = [
                { x:  hw - halfWt, y:  hh - halfWt },  // 右上
                { x: -hw + halfWt, y:  hh - halfWt },  // 左上
                { x:  hw - halfWt, y: -hh + halfWt },  // 右下
                { x: -hw + halfWt, y: -hh + halfWt },  // 左下
            ];
            for (const pos of cornerPositions) {
                const cornerNode = instantiate(this.cornerPrefab);
                cornerNode.layer = 1;
                this._wallNode.addChild(cornerNode);
                cornerNode.setPosition(pos.x, pos.y, 0);

                const ut = cornerNode.getComponent(UITransform) || cornerNode.addComponent(UITransform);
                ut.setContentSize(wt, wt);
                // 渲染在围墙段之上
                cornerNode.setSiblingIndex(lastChildIdx++);
            }
        }
    }

    // ──────────────────────────────────────────
    //  围墙分段计算
    // ──────────────────────────────────────────

    /** 计算所有围墙段（含缺口切分），返回段坐标 + 所属墙面 side */
    private _calcWallSegments(): { x: number; y: number; w: number; h: number; side: number }[] {
        const wt = this.wallThickness;
        const hw = this.tableWidth / 2;
        const hh = this.tableHeight / 2;
        const ov = 2;
        const hg = this.gapWidth / 2;
        const results: { x: number; y: number; w: number; h: number; side: number }[] = [];

        // 四面墙的定义
        const walls = [
            { side: 0, x: -hw - ov, y: hh - wt, w: this.tableWidth + ov * 2, h: wt, horiz: true },
            { side: 2, x: -hw - ov, y: -hh,     w: this.tableWidth + ov * 2, h: wt, horiz: true },
            { side: 3, x: -hw,       y: -hh - ov, w: wt, h: this.tableHeight + ov * 2, horiz: false },
            { side: 1, x: hw - wt,   y: -hh - ov, w: wt, h: this.tableHeight + ov * 2, horiz: false },
        ];

        for (const wall of walls) {
            const wallGaps = this.gaps
                .filter(g => g.side === wall.side)
                .sort((a, b) => a.center - b.center);

            if (wallGaps.length === 0) {
                results.push({ x: wall.x, y: wall.y, w: wall.w, h: wall.h, side: wall.side });
                continue;
            }

            // 沿墙方向切割
            let cursor = wall.horiz ? wall.x : wall.y;
            const endPos = cursor + (wall.horiz ? wall.w : wall.h);
            const fixedPos = wall.horiz ? wall.y : wall.x;
            const fixedSize = wall.horiz ? wall.h : wall.w;

            for (const gap of wallGaps) {
                const gapL = gap.center - hg;
                const gapR = gap.center + hg;
                const segLen = gapL - cursor;
                if (segLen > 0) {
                    if (wall.horiz) {
                        results.push({ x: cursor, y: fixedPos, w: segLen, h: fixedSize, side: wall.side });
                    } else {
                        results.push({ x: fixedPos, y: cursor, w: fixedSize, h: segLen, side: wall.side });
                    }
                }
                cursor = Math.max(cursor, gapR);
            }
            const remLen = endPos - cursor;
            if (remLen > 0) {
                if (wall.horiz) {
                    results.push({ x: cursor, y: fixedPos, w: remLen, h: fixedSize, side: wall.side });
                } else {
                    results.push({ x: fixedPos, y: cursor, w: fixedSize, h: remLen, side: wall.side });
                }
            }
        }

        return results;
    }

}
