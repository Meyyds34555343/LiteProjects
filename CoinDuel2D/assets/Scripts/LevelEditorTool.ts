import {
    _decorator, Component, Node, Vec2, Vec3, Color, Camera, Canvas, input, Input,
    EventTouch, EventMouse, EventKeyboard, KeyCode, Sprite, SpriteFrame,
    Texture2D, UITransform, Label, Graphics, resources, JsonAsset, Layers, director,
} from 'cc';
import { BlockVisualEditor } from './Mod/BlockVisualEditor';
import { LevelData, LevelItemData, LevelCoinData, LevelBombData } from './LevelData';
import { GameLogicInterpreter } from './Mod/GameLogicInterpreter';
import { ModCompiler } from './Mod/ModCompiler';
import { LevelManager } from './LevelManager';
import { PRESET_COIN_SKINS, PRESET_TABLE_SKINS, PRESET_WALL_SKINS, DynamicAssetLoader } from './Meme/DynamicAssetLoader';

const { ccclass, property } = _decorator;

type PlaceKind = 'coin' | 'bomb' | 'block' | 'mud';

interface Brush {
    label: string;
    kind: PlaceKind;
    /** 空字串＝無行為。 */
    behavior: string;
    /** 僅 coin 有效；true＝可出手。 */
    canshot: boolean;
    color: Color;
}

interface PlaceMark {
    kind: PlaceKind;
    behavior: string;
    canshot: boolean;
    classId: number;
    radius: number;
    friction: number;
    memeId: string;
    /** preset key / custom URL / Base64 */
    skinKey: string;
    skinUrl: string;
}

interface EditorSnapshot {
    levelId: number;
    tableWidth: number;
    tableHeight: number;
    wallThickness: number;
    items: {
        x: number;
        y: number;
        mark: PlaceMark;
    }[];
}

const BRUSHES: Brush[] = [
    { label: '1 出手幣', kind: 'coin', behavior: '', canshot: true, color: new Color(255, 230, 90, 255) },
    { label: '2 目標幣', kind: 'coin', behavior: '', canshot: false, color: new Color(240, 240, 240, 255) },
    { label: '3 擊退', kind: 'coin', behavior: 'KnockbackBehavior', canshot: false, color: new Color(255, 150, 0, 255) },
    { label: '4 冰凍', kind: 'coin', behavior: 'FreezeBehavior', canshot: false, color: new Color(140, 210, 255, 255) },
    { label: '5 閃身步', kind: 'coin', behavior: 'FlashStepBehavior', canshot: false, color: new Color(170, 255, 140, 255) },
    { label: '6 炸彈', kind: 'bomb', behavior: '', canshot: false, color: new Color(255, 80, 80, 255) },
    { label: '7 障礙', kind: 'block', behavior: '', canshot: false, color: new Color(120, 120, 140, 255) },
    { label: '8 泥地', kind: 'mud', behavior: '', canshot: false, color: new Color(160, 110, 60, 255) },
];

const RADIUS_STEPS = [16, 24, 32, 40, 48, 56, 64, 80];
const COIN_SKIN_KEYS = ['', ...Object.keys(PRESET_COIN_SKINS)];
const TABLE_FELT_KEYS = ['', ...Object.keys(PRESET_TABLE_SKINS)];
const TABLE_WALL_KEYS = ['', ...Object.keys(PRESET_WALL_SKINS)];
const HELP = [
    '[LevelEditor] 左鍵放置／拖曳｜右鍵刪除｜1-8 換筆刷｜底部按鈕開 Mod',
    '[LevelEditor] B=Mod  V=导入规则  S=导出  U=撤销  H=说明',
].join('\n');

interface ToolbarBtn {
    node: Node;
    id: string;
    x0: number;
    x1: number;
    y0: number;
    y1: number;
}

/**
 * 預覽用關卡編輯器。掛在 LevelEditorRoot，Play 後操作。
 */
@ccclass('LevelEditorTool')
export class LevelEditorTool extends Component {
    @property(Camera)
    public camera: Camera | null = null;

    @property
    public levelId = 1;

    @property
    public tableWidth = 800;

    @property
    public tableHeight = 600;

    @property
    public wallThickness = 64;

    @property
    public coinClass = 1;

    @property
    public coinRadius = 32;

    @property({ tooltip: '泥地預設摩擦力' })
    public mudFriction = 0.5;

    @property({ tooltip: '按 M 時寫入選取物的 memeId' })
    public defaultMemeId = '';

    @property({ tooltip: '按 P 時寫入選取物的自訂皮膚 URL 或 Base64 data URI' })
    public customSkinUrl = '';

    @property({ tooltip: '開啟格線吸附' })
    public snapEnabled = true;

    @property({ tooltip: '吸附格距（像素）' })
    public snapSize = 20;

    @property({ tooltip: '顯示桌面邊框與 HUD' })
    public showHud = true;

    private _brush = 0;
    private _selected: Node | null = null;
    private _dragging: Node | null = null;
    private _blockTouch = false;
    private _circle: SpriteFrame | null = null;
    private readonly _local = new Vec3();
    private readonly _marks = new Map<Node, PlaceMark>();
    private _modEditor: BlockVisualEditor | null = null;
    private _hud: Label | null = null;
    private _hint: Label | null = null;
    private _border: Graphics | null = null;
    private _toolbar: ToolbarBtn[] = [];
    private _toolbarRoot: Node | null = null;
    private _hintNode: Node | null = null;
    private _feltNode: Node | null = null;
    private _undo: EditorSnapshot[] = [];
    private _redo: EditorSnapshot[] = [];
    private _clearArmedUntil = 0;
    private _radiusIdx = 2;
    private _ctrl = false;
    private _shift = false;
    private _coinSkinIdx = 0;
    private _tableFeltKey = '';
    private _tableWallKey = '';

    protected onLoad(): void {
        this._mountUnderCanvas();

        let ui = this.getComponent(UITransform);
        if (!ui) ui = this.addComponent(UITransform);
        ui.setAnchorPoint(0.5, 0.5);
        ui.setContentSize(this.tableWidth, this.tableHeight);

        this._circle = this._makeCircle();
        this._radiusIdx = Math.max(0, RADIUS_STEPS.indexOf(this.coinRadius));
        if (this._radiusIdx < 0) this._radiusIdx = 2;
        this.coinRadius = RADIUS_STEPS[this._radiusIdx];

        this._modEditor = this.getComponent(BlockVisualEditor) ?? this.addComponent(BlockVisualEditor);
        this._modEditor.offsetX = 0;
        this._modEditor.offsetY = 0;
        this._buildChrome();
        this._refreshTableFeltPreview();
        this._seedDemoIfEmpty();
        this._pushUndo();

        input.on(Input.EventType.TOUCH_START, this._onTouchStart, this);
        input.on(Input.EventType.TOUCH_MOVE, this._onTouchMove, this);
        input.on(Input.EventType.TOUCH_END, this._onTouchEnd, this);
        input.on(Input.EventType.TOUCH_CANCEL, this._onTouchEnd, this);
        input.on(Input.EventType.MOUSE_DOWN, this._onMouseDown, this);
        input.on(Input.EventType.KEY_DOWN, this._onKeyDown, this);
        input.on(Input.EventType.KEY_UP, this._onKeyUp, this);
    }

    protected start(): void {
        console.log(HELP);
        this._refreshHud();
    }

    protected update(): void {
        if (this.showHud) this._refreshHud();
    }

    protected onDestroy(): void {
        input.off(Input.EventType.TOUCH_START, this._onTouchStart, this);
        input.off(Input.EventType.TOUCH_MOVE, this._onTouchMove, this);
        input.off(Input.EventType.TOUCH_END, this._onTouchEnd, this);
        input.off(Input.EventType.TOUCH_CANCEL, this._onTouchEnd, this);
        input.off(Input.EventType.MOUSE_DOWN, this._onMouseDown, this);
        input.off(Input.EventType.KEY_DOWN, this._onKeyDown, this);
        input.off(Input.EventType.KEY_UP, this._onKeyUp, this);
    }

    private _onKeyUp(event: EventKeyboard): void {
        const code = event.keyCode;
        if (code === KeyCode.CTRL_LEFT || code === KeyCode.CTRL_RIGHT) this._ctrl = false;
        if (code === KeyCode.SHIFT_LEFT || code === KeyCode.SHIFT_RIGHT) this._shift = false;
    }

    // ── input ──

    private _onTouchStart(event: EventTouch): void {
        if (this._blockTouch) return;
        if (this._modEditor?.enabledEditor) return;
        this._toLocal(event.getLocation());
        if (this._hitToolbar(this._local.x, this._local.y)) return;
        const hit = this._pick(this._local);
        if (hit) {
            this._select(hit);
            this._dragging = hit;
            return;
        }
        this._pushUndo();
        const item = this._spawn(this._snap(this._local.x), this._snap(this._local.y), this._brush);
        this._select(item);
        this._dragging = item;
    }

    private _onTouchMove(event: EventTouch): void {
        if (!this._dragging?.isValid) return;
        this._toLocal(event.getLocation());
        const x = this.snapEnabled ? this._snap(this._local.x) : this._local.x;
        const y = this.snapEnabled ? this._snap(this._local.y) : this._local.y;
        this._dragging.setPosition(x, y, 0);
    }

    private _onTouchEnd(): void {
        if (this._dragging?.isValid && this.snapEnabled) {
            const p = this._dragging.position;
            this._dragging.setPosition(this._snap(p.x), this._snap(p.y), 0);
        }
        this._dragging = null;
    }

    private _onMouseDown(event: EventMouse): void {
        if (event.getButton() !== EventMouse.BUTTON_RIGHT) return;
        this._blockTouch = true;
        this.scheduleOnce(() => { this._blockTouch = false; }, 0);
        this._toLocal(event.getLocation());
        const hit = this._pick(this._local);
        if (hit) {
            this._pushUndo();
            this._deleteNode(hit);
        }
    }

    private _onKeyDown(event: EventKeyboard): void {
        const code = event.keyCode;
        if (code === KeyCode.CTRL_LEFT || code === KeyCode.CTRL_RIGHT) {
            this._ctrl = true;
            return;
        }
        if (code === KeyCode.SHIFT_LEFT || code === KeyCode.SHIFT_RIGHT) {
            this._shift = true;
            return;
        }

        if (this._modEditor?.enabledEditor && code !== KeyCode.KEY_B && code !== KeyCode.KEY_E && code !== KeyCode.KEY_X && code !== KeyCode.KEY_V) {
            return;
        }

        const ctrl = this._ctrl;
        const shift = this._shift;

        const digit = this._digitIndex(code);
        if (digit >= 0) {
            this._brush = digit;
            if (this._selected?.isValid) {
                this._pushUndo();
                this._applyBrush(this._selected, digit);
            }
            console.log('[LevelEditor] 筆刷:', BRUSHES[digit].label);
            return;
        }

        if (code === KeyCode.TAB) {
            this._brush = (this._brush + 1) % BRUSHES.length;
            console.log('[LevelEditor] 筆刷:', BRUSHES[this._brush].label);
            return;
        }

        if (code === KeyCode.KEY_G) {
            this.snapEnabled = !this.snapEnabled;
            console.log('[LevelEditor] 吸附:', this.snapEnabled ? `ON (${this.snapSize}px)` : 'OFF');
            return;
        }

        if (code === KeyCode.KEY_R) {
            this._pushUndo();
            this._radiusIdx = shift
                ? (this._radiusIdx - 1 + RADIUS_STEPS.length) % RADIUS_STEPS.length
                : (this._radiusIdx + 1) % RADIUS_STEPS.length;
            this.coinRadius = RADIUS_STEPS[this._radiusIdx];
            if (this._selected?.isValid) {
                const mark = this._marks.get(this._selected);
                if (mark) {
                    mark.radius = this.coinRadius;
                    this._applyVisual(this._selected, mark);
                }
            }
            console.log('[LevelEditor] 半徑:', this.coinRadius);
            return;
        }

        if (code === KeyCode.KEY_C && this._selected?.isValid) {
            const mark = this._marks.get(this._selected);
            if (mark && mark.kind === 'coin') {
                this._pushUndo();
                mark.canshot = !mark.canshot;
                this._applyVisual(this._selected, mark);
                console.log('[LevelEditor] canshot =', mark.canshot);
            }
            return;
        }

        if ((code === KeyCode.COMMA || code === KeyCode.PERIOD) && this._selected?.isValid) {
            const mark = this._marks.get(this._selected);
            if (mark && (mark.kind === 'coin' || mark.kind === 'bomb')) {
                this._pushUndo();
                mark.classId = Math.max(1, mark.classId + (code === KeyCode.PERIOD ? 1 : -1));
                this._applyVisual(this._selected, mark);
                console.log('[LevelEditor] class =', mark.classId);
            }
            return;
        }

        if (code === KeyCode.KEY_M && this._selected?.isValid) {
            const mark = this._marks.get(this._selected);
            if (mark && mark.kind === 'coin') {
                this._pushUndo();
                mark.memeId = this.defaultMemeId;
                console.log('[LevelEditor] memeId =', mark.memeId || '(empty)');
            }
            return;
        }

        if (code === KeyCode.KEY_K && this._selected?.isValid) {
            const mark = this._marks.get(this._selected);
            if (mark && (mark.kind === 'coin' || mark.kind === 'bomb')) {
                this._pushUndo();
                this._coinSkinIdx = (this._coinSkinIdx + 1) % COIN_SKIN_KEYS.length;
                mark.skinKey = COIN_SKIN_KEYS[this._coinSkinIdx];
                mark.skinUrl = '';
                this._previewCoinSkin(this._selected, mark);
                console.log('[LevelEditor] skinKey =', mark.skinKey || '(default)');
            }
            return;
        }

        if (code === KeyCode.KEY_P && this._selected?.isValid) {
            const mark = this._marks.get(this._selected);
            if (mark && (mark.kind === 'coin' || mark.kind === 'bomb') && this.customSkinUrl) {
                this._pushUndo();
                mark.skinUrl = this.customSkinUrl;
                mark.skinKey = '';
                this._previewCoinSkin(this._selected, mark);
                console.log('[LevelEditor] skinUrl set');
            }
            return;
        }

        if (code === KeyCode.KEY_J) {
            const keys = TABLE_FELT_KEYS;
            const at = Math.max(0, keys.indexOf(this._tableFeltKey));
            this._tableFeltKey = keys[(at + 1) % keys.length];
            console.log('[LevelEditor] table felt =', this._tableFeltKey || '(default)');
            this._refreshTableFeltPreview();
            this._refreshHud();
            return;
        }

        if (code === KeyCode.KEY_L && !this._ctrl) {
            const keys = TABLE_WALL_KEYS;
            const at = Math.max(0, keys.indexOf(this._tableWallKey));
            this._tableWallKey = keys[(at + 1) % keys.length];
            console.log('[LevelEditor] table wall =', this._tableWallKey || '(default)');
            this._refreshHud();
            return;
        }

        if ((code === KeyCode.KEY_D && ctrl) || code === KeyCode.KEY_F) {
            this._duplicateSelected();
            return;
        }

        if ((code === KeyCode.KEY_Z && ctrl) || code === KeyCode.KEY_U) {
            if (shift) this._redoOnce();
            else this._undoOnce();
            return;
        }

        if (code === KeyCode.KEY_Y || (code === KeyCode.KEY_Z && ctrl && shift)) {
            this._redoOnce();
            return;
        }

        if (code === KeyCode.ARROW_LEFT || code === KeyCode.ARROW_RIGHT
            || code === KeyCode.ARROW_UP || code === KeyCode.ARROW_DOWN) {
            this._nudgeSelected(code, shift ? 10 : 1);
            return;
        }

        if (code === KeyCode.DELETE || code === KeyCode.BACKSPACE) {
            if (this._selected) {
                this._pushUndo();
                this._deleteNode(this._selected);
            }
            return;
        }

        if (code === KeyCode.KEY_N) {
            this._requestClear();
            return;
        }

        if (code === KeyCode.KEY_O) {
            this._loadLevelById(this.levelId);
            return;
        }

        if (code === KeyCode.BRACKET_LEFT || code === KeyCode.BRACKET_RIGHT) {
            this.wallThickness = Math.max(8, this.wallThickness + (code === KeyCode.BRACKET_RIGHT ? 8 : -8));
            this._drawBorder();
            console.log('[LevelEditor] wall thickness =', this.wallThickness);
            return;
        }

        if (code === KeyCode.KEY_S) this._export();
        if (code === KeyCode.KEY_E || code === KeyCode.KEY_X) this._exportWithBlocks();
        if (code === KeyCode.KEY_V) this._importModShare();
        if (code === KeyCode.KEY_H) console.log(HELP);
    }

    private _digitIndex(code: number): number {
        if (code >= KeyCode.DIGIT_1 && code <= KeyCode.DIGIT_8) return code - KeyCode.DIGIT_1;
        if (code >= KeyCode.NUM_1 && code <= KeyCode.NUM_8) return code - KeyCode.NUM_1;
        return -1;
    }

    // ── place / edit ──

    private _spawn(x: number, y: number, brushIndex: number): Node {
        const brush = BRUSHES[brushIndex] ?? BRUSHES[0];
        const node = new Node(this._nameFor(brush));
        node.layer = Layers.Enum.UI_2D;
        node.setPosition(x, y, 0);
        this.node.addChild(node);

        const ui = node.addComponent(UITransform);
        ui.setAnchorPoint(0.5, 0.5);

        const sprite = node.addComponent(Sprite);
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        sprite.spriteFrame = this._circle;

        const mark: PlaceMark = {
            kind: brush.kind,
            behavior: brush.behavior,
            canshot: brush.canshot,
            classId: this.coinClass,
            radius: this.coinRadius,
            friction: this.mudFriction,
            memeId: '',
            skinKey: '',
            skinUrl: '',
        };
        this._marks.set(node, mark);
        this._applyBrush(node, brushIndex);
        return node;
    }

    private _applyBrush(node: Node, brushIndex: number): void {
        const brush = BRUSHES[brushIndex] ?? BRUSHES[0];
        const mark = this._marks.get(node);
        if (!mark) return;
        mark.kind = brush.kind;
        mark.behavior = brush.behavior;
        mark.canshot = brush.canshot;
        if (brush.kind === 'mud') mark.friction = this.mudFriction;
        node.name = this._nameFor(brush);
        this._applyVisual(node, mark);
    }

    private _applyVisual(node: Node, mark: PlaceMark): void {
        const ui = node.getComponent(UITransform);
        if (ui) ui.setContentSize(mark.radius * 2, mark.radius * 2);
        const sprite = node.getComponent(Sprite);
        if (!sprite) return;
        const brush = BRUSHES.find((b) => b.kind === mark.kind && b.behavior === mark.behavior && b.canshot === mark.canshot)
            ?? BRUSHES.find((b) => b.kind === mark.kind)
            ?? BRUSHES[0];
        let color = brush.color.clone();
        if (mark.kind === 'coin' && mark.canshot) {
            color = new Color(255, 230, 90, 255);
        } else if (mark.kind === 'coin' && !mark.canshot && !mark.behavior) {
            color = new Color(240, 240, 240, 255);
        }
        sprite.color = color;
    }

    private _nameFor(brush: Brush): string {
        if (brush.kind === 'bomb') return 'BombPreview';
        if (brush.kind === 'block') return 'BlockPreview';
        if (brush.kind === 'mud') return 'MudPreview';
        return `Coin_${brush.label.replace(/^\d+\s*/, '')}`;
    }

    private _select(node: Node | null): void {
        if (this._selected?.isValid) this._selected.setScale(1, 1, 1);
        this._selected = node;
        if (node?.isValid) node.setScale(1.12, 1.12, 1);
    }

    private _deleteNode(node: Node | null): void {
        if (!node?.isValid) return;
        if (this._selected === node) this._selected = null;
        if (this._dragging === node) this._dragging = null;
        this._marks.delete(node);
        node.destroy();
    }

    private _duplicateSelected(): void {
        if (!this._selected?.isValid) return;
        const src = this._marks.get(this._selected);
        if (!src) return;
        this._pushUndo();
        const offset = this.snapEnabled ? this.snapSize : 24;
        const node = this._spawn(this._selected.position.x + offset, this._selected.position.y + offset, this._brush);
        const mark = this._marks.get(node);
        if (mark) {
            Object.assign(mark, { ...src });
            this._applyVisual(node, mark);
        }
        this._select(node);
    }

    private _nudgeSelected(code: number, step: number): void {
        if (!this._selected?.isValid) return;
        const p = this._selected.position;
        let x = p.x;
        let y = p.y;
        if (code === KeyCode.ARROW_LEFT) x -= step;
        if (code === KeyCode.ARROW_RIGHT) x += step;
        if (code === KeyCode.ARROW_UP) y += step;
        if (code === KeyCode.ARROW_DOWN) y -= step;
        if (this.snapEnabled && step >= this.snapSize) {
            x = this._snap(x);
            y = this._snap(y);
        }
        this._selected.setPosition(x, y, 0);
    }

    private _pick(local: Vec3): Node | null {
        const children = this.node.children;
        for (let i = children.length - 1; i >= 0; i--) {
            const child = children[i];
            const mark = this._marks.get(child);
            if (!mark) continue;
            const r = mark.radius;
            const dx = child.position.x - local.x;
            const dy = child.position.y - local.y;
            if (dx * dx + dy * dy <= r * r) return child;
        }
        return null;
    }

    private _snap(v: number): number {
        if (!this.snapEnabled || this.snapSize <= 0) return Math.round(v);
        return Math.round(v / this.snapSize) * this.snapSize;
    }

    private _requestClear(): void {
        const now = Date.now();
        if (now > this._clearArmedUntil) {
            this._clearArmedUntil = now + 1500;
            console.log('[LevelEditor] 再按一次 N 清空全部物件');
            return;
        }
        this._clearArmedUntil = 0;
        this._pushUndo();
        for (const child of [...this.node.children]) {
            if (this._marks.has(child)) this._deleteNode(child);
        }
        console.log('[LevelEditor] 已清空');
    }

    // ── undo ──

    private _capture(): EditorSnapshot {
        const items: EditorSnapshot['items'] = [];
        for (const child of this.node.children) {
            const mark = this._marks.get(child);
            if (!mark) continue;
            items.push({
                x: child.position.x,
                y: child.position.y,
                mark: { ...mark },
            });
        }
        return {
            levelId: this.levelId,
            tableWidth: this.tableWidth,
            tableHeight: this.tableHeight,
            wallThickness: this.wallThickness,
            items,
        };
    }

    private _pushUndo(): void {
        this._undo.push(this._capture());
        if (this._undo.length > 40) this._undo.shift();
        this._redo.length = 0;
    }

    private _undoOnce(): void {
        if (this._undo.length <= 1) {
            console.log('[LevelEditor] 沒有可復原的步驟');
            return;
        }
        this._redo.push(this._capture());
        this._undo.pop();
        const snap = this._undo[this._undo.length - 1];
        this._restore(snap);
        console.log('[LevelEditor] 復原');
    }

    private _redoOnce(): void {
        const snap = this._redo.pop();
        if (!snap) {
            console.log('[LevelEditor] 沒有可重做的步驟');
            return;
        }
        this._undo.push(this._capture());
        this._restore(snap);
        console.log('[LevelEditor] 重做');
    }

    private _restore(snap: EditorSnapshot): void {
        for (const child of [...this.node.children]) {
            if (this._marks.has(child)) {
                this._marks.delete(child);
                child.destroy();
            }
        }
        this._selected = null;
        this._dragging = null;
        this.levelId = snap.levelId;
        this.tableWidth = snap.tableWidth;
        this.tableHeight = snap.tableHeight;
        this.wallThickness = snap.wallThickness;
        this._drawBorder();
        for (const item of snap.items) {
            const brushIndex = this._brushIndexFor(item.mark);
            const node = this._spawn(item.x, item.y, brushIndex);
            const mark = this._marks.get(node);
            if (mark) {
                Object.assign(mark, item.mark);
                this._applyVisual(node, mark);
            }
        }
    }

    private _brushIndexFor(mark: PlaceMark): number {
        const exact = BRUSHES.findIndex((b) =>
            b.kind === mark.kind && b.behavior === mark.behavior && b.canshot === mark.canshot);
        if (exact >= 0) return exact;
        const kind = BRUSHES.findIndex((b) => b.kind === mark.kind);
        return kind >= 0 ? kind : 0;
    }

    // ── load / export ──

    private _loadLevelById(id: number): void {
        resources.load(`levels/${id}`, JsonAsset, (err, asset) => {
            if (err || !asset) {
                console.warn('[LevelEditor] 載入失敗 levels/' + id, err);
                return;
            }
            const data = asset.json as LevelData;
            this._pushUndo();
            this._applyLevelData(data);
            console.log('[LevelEditor] 已載入 levels/' + id + '.json ，共', data.coins?.length ?? 0, '物件');
        });
    }

    private _applyLevelData(data: LevelData): void {
        for (const child of [...this.node.children]) {
            if (this._marks.has(child)) this._deleteNode(child);
        }
        this.levelId = data.id ?? this.levelId;
        this.tableWidth = data.width ?? this.tableWidth;
        this.tableHeight = data.height ?? this.tableHeight;
        this.wallThickness = data.wall?.thickness ?? this.wallThickness;
        this._tableFeltKey = data.table?.felt ?? '';
        this._tableWallKey = data.table?.wall ?? '';

        const ui = this.getComponent(UITransform);
        if (ui) ui.setContentSize(this.tableWidth, this.tableHeight);
        this._drawBorder();
        this._refreshTableFeltPreview();
        // Rebuild bottom toolbar positions for new table size
        if (this.showHud) this._buildToolbar();

        for (const item of data.coins ?? []) {
            this._spawnFromLevelItem(item);
        }
        this._refreshHud();
    }

    private _spawnFromLevelItem(item: LevelItemData): void {
        let brush = 1;
        const emptySkin = { skinKey: '', skinUrl: '' };
        let mark: PlaceMark = {
            kind: 'coin',
            behavior: '',
            canshot: true,
            classId: this.coinClass,
            radius: this.coinRadius,
            friction: this.mudFriction,
            memeId: '',
            ...emptySkin,
        };

        if (item.type === 'bomb') {
            brush = 5;
            mark = {
                kind: 'bomb',
                behavior: '',
                canshot: false,
                classId: item.class ?? 1,
                radius: item.radius ?? this.coinRadius,
                friction: this.mudFriction,
                memeId: '',
                ...emptySkin,
            };
        } else if (item.type === 'block') {
            brush = 6;
            mark = {
                kind: 'block',
                behavior: '',
                canshot: false,
                classId: 1,
                radius: item.radius ?? this.coinRadius,
                friction: this.mudFriction,
                memeId: '',
                ...emptySkin,
            };
        } else if (item.type === 'mud') {
            brush = 7;
            mark = {
                kind: 'mud',
                behavior: '',
                canshot: false,
                classId: 1,
                radius: item.radius ?? this.coinRadius,
                friction: item.friction ?? this.mudFriction,
                memeId: '',
                ...emptySkin,
            };
        } else {
            const behaviors = item.behaviors ?? [];
            const behavior = behaviors[0] ?? '';
            const canshot = item.canshot !== false;
            const skinKey = item.skinKey ?? item.skin?.preset ?? '';
            // URL wins when present (Scratch may set both preset + url)
            const skinUrl = item.skin?.default ? String(item.skin.default) : '';
            brush = this._brushIndexFor({
                kind: 'coin',
                behavior,
                canshot,
                classId: item.class ?? 1,
                radius: item.radius ?? this.coinRadius,
                friction: this.mudFriction,
                memeId: item.memeId ?? '',
                skinKey,
                skinUrl,
            });
            mark = {
                kind: 'coin',
                behavior,
                canshot,
                classId: item.class ?? 1,
                radius: item.radius ?? this.coinRadius,
                friction: this.mudFriction,
                memeId: item.memeId ?? '',
                skinKey,
                skinUrl,
            };
        }

        // Carry skin/meme onto bomb too
        if (item.type === 'bomb' || item.type === 'coin') {
            const skinItem = item as LevelCoinData | LevelBombData;
            const skinObj = (skinItem as LevelCoinData).skin;
            const skinKeyField = (skinItem as LevelCoinData).skinKey;
            if (!mark.skinKey && skinKeyField) mark.skinKey = skinKeyField;
            if (!mark.skinUrl && skinObj?.default) mark.skinUrl = String(skinObj.default);
            if (!mark.memeId && (skinItem as LevelCoinData).memeId) {
                mark.memeId = String((skinItem as LevelCoinData).memeId);
            }
        }

        const node = this._spawn(item.x, item.y, brush);
        const live = this._marks.get(node);
        if (live) {
            Object.assign(live, mark);
            this._applyVisual(node, live);
            if (mark.skinKey || mark.skinUrl) this._previewCoinSkin(node, mark);
        }
    }

    private _export(): void {
        const coins: object[] = [];
        for (const child of this.node.children) {
            const mark = this._marks.get(child);
            if (!mark) continue;
            const x = Math.round(child.position.x);
            const y = Math.round(child.position.y);

            if (mark.kind === 'block') {
                coins.push({ type: 'block', x, y, shape: 'circle', radius: mark.radius });
                continue;
            }
            if (mark.kind === 'mud') {
                coins.push({
                    type: 'mud', x, y, shape: 'circle',
                    radius: mark.radius, friction: mark.friction,
                });
                continue;
            }
            if (mark.kind === 'bomb') {
                coins.push({
                    type: 'bomb', class: mark.classId, x, y, radius: mark.radius,
                });
                continue;
            }

            const item: Record<string, unknown> = {
                type: 'coin',
                class: mark.classId,
                x,
                y,
            };
            if (!mark.canshot) item.canshot = false;
            if (mark.behavior) {
                item.behavior = mark.behavior;
                item.behaviors = [mark.behavior];
            }
            if (mark.memeId) item.memeId = mark.memeId;
            if (mark.skinKey) item.skinKey = mark.skinKey;
            if (mark.skinUrl) item.skin = { default: mark.skinUrl, idle: mark.skinUrl };
            if (mark.radius !== 32) item.radius = mark.radius;
            coins.push(item);
        }

        const table: Record<string, string> = {};
        if (this._tableFeltKey) table.felt = this._tableFeltKey;
        if (this._tableWallKey) table.wall = this._tableWallKey;

        const data: Record<string, unknown> = {
            id: this.levelId,
            width: this.tableWidth,
            height: this.tableHeight,
            wall: { thickness: this.wallThickness },
            coins,
        };
        if (Object.keys(table).length) data.table = table;
        console.log('[LevelEditor] 複製下面這段到 levels/' + this.levelId + '.json');
        console.log(JSON.stringify(data, null, 4));
    }

    private _previewCoinSkin(node: Node, mark: PlaceMark): void {
        // Prefer explicit URL / Base64 over preset key
        const preset = (!mark.skinUrl && mark.skinKey)
            ? DynamicAssetLoader.resolveCoinPreset(mark.skinKey)
            : null;
        const ref = mark.skinUrl || preset?.default || mark.skinKey;
        if (!ref) return;
        DynamicAssetLoader.loadSprite(ref, (frame) => {
            if (!node.isValid || !frame) return;
            const sprite = node.getComponent(Sprite);
            if (sprite) sprite.spriteFrame = frame;
        });
    }

    private _exportWithBlocks(): void {
        if (!this._modEditor) {
            this._export();
            return;
        }
        const mod = this._modEditor.compileAndLog({
            id: `level_${this.levelId}_mod`,
            name: `Level ${this.levelId} Sandbox`,
        });
        GameLogicInterpreter.getOrCreate().load(mod);
        this._export();
    }

    /**
     * One-paste Scratch workflow: clipboard COINMOD1 → full level + rules + physics.
     * Does not require opening the Mod panel.
     */
    private _importModShare(): void {
        const nav: any = typeof navigator !== 'undefined' ? navigator : null;
        if (nav?.clipboard?.readText) {
            nav.clipboard.readText().then((text: string) => {
                this._applyScratchShare(String(text ?? ''));
            }).catch(() => this._promptScratchPaste());
            return;
        }
        this._promptScratchPaste();
    }

    private _promptScratchPaste(): void {
        const pasted = typeof window !== 'undefined'
            ? window.prompt('Paste COINMOD1:… share code from Scratch')
            : null;
        if (pasted) this._applyScratchShare(pasted);
        else if (this._hint) this._hint.string = '未粘贴代码 — 复制 COINMOD1 后再试';
    }

    private _applyScratchShare(raw: string): void {
        const text = raw.trim();
        if (!text.includes('COINMOD1:')) {
            if (this._hint) this._hint.string = '剪贴板没有 COINMOD1 代码 — 先在 Scratch 点 Export Share Code';
            console.warn('[LevelEditor] clipboard missing COINMOD1 share code');
            return;
        }
        // Prefer ModCompiler so we don't depend on Mod panel UI
        let mod = ModCompiler.fromShareCode(text);
        if (!mod) {
            const idx = text.indexOf('COINMOD1:');
            if (idx >= 0) mod = ModCompiler.fromShareCode(text.slice(idx));
        }
        if (!mod) {
            if (this._hint) this._hint.string = 'COINMOD1 无效';
            console.warn('[LevelEditor] invalid share code');
            return;
        }

        if (this._modEditor) {
            this._modEditor.importShareCode(ModCompiler.toShareCode(mod));
        }

        // 1) Level layout (objects, table size, skins keys)
        if (mod.level) {
            this._applyLevelData(mod.level as unknown as LevelData);
            LevelManager.setScratchLevel(mod.level as unknown as LevelData);
        }

        // 2) Rules + physics runtime (+ persists CoinDuel:activeMod)
        GameLogicInterpreter.getOrCreate().load(mod);

        const n = mod.level?.coins?.length ?? 0;
        const pipes = mod.pipelines?.length ?? 0;
        if (this._hint) {
            this._hint.string = `已导入 ${n} 物件 / ${pipes} 规则 — 点「试玩」进 Game`;
        }
        console.log('[LevelEditor] Scratch pack applied', {
            name: mod.name,
            objects: n,
            pipelines: pipes,
            physics: mod.physics,
            win: mod.win,
            lose: mod.lose,
        });
    }

    private _playScratchInGame(): void {
        const mod = GameLogicInterpreter.getOrCreate().mod;
        if (mod?.level) {
            LevelManager.setScratchLevel(mod.level as unknown as LevelData);
        } else if (this._marks.size > 0) {
            // Build level from current editor objects
            const exported = this._captureLevelData();
            LevelManager.setScratchLevel(exported);
        } else {
            if (this._hint) this._hint.string = '先粘贴 Scratch 或放置物件，再试玩';
            return;
        }
        director.loadScene('game');
    }

    private _captureLevelData(): LevelData {
        // Reuse export path shape without console spam
        const coins: LevelItemData[] = [];
        for (const child of this.node.children) {
            const mark = this._marks.get(child);
            if (!mark) continue;
            const x = Math.round(child.position.x);
            const y = Math.round(child.position.y);
            if (mark.kind === 'block') {
                coins.push({ type: 'block', x, y, shape: 'circle', radius: mark.radius });
            } else if (mark.kind === 'mud') {
                coins.push({ type: 'mud', x, y, shape: 'circle', radius: mark.radius, friction: mark.friction });
            } else if (mark.kind === 'bomb') {
                coins.push({ type: 'bomb', class: mark.classId, x, y, radius: mark.radius });
            } else {
                const item: LevelCoinData = { type: 'coin', class: mark.classId, x, y };
                if (!mark.canshot) item.canshot = false;
                if (mark.behavior) {
                    item.behaviors = [mark.behavior];
                }
                if (mark.memeId) item.memeId = mark.memeId;
                if (mark.skinKey) item.skinKey = mark.skinKey;
                if (mark.skinUrl) item.skin = { default: mark.skinUrl, idle: mark.skinUrl };
                if (mark.radius !== 32) item.radius = mark.radius;
                coins.push(item);
            }
        }
        const data: LevelData = {
            id: this.levelId,
            width: this.tableWidth,
            height: this.tableHeight,
            wall: { thickness: this.wallThickness },
            coins,
        };
        if (this._tableFeltKey || this._tableWallKey) {
            data.table = {};
            if (this._tableFeltKey) data.table.felt = this._tableFeltKey;
            if (this._tableWallKey) data.table.wall = this._tableWallKey;
        }
        return data;
    }

    private _refreshTableFeltPreview(): void {
        if (!this._feltNode?.isValid) {
            const node = new Node('FeltPreview');
            node.layer = Layers.Enum.UI_2D;
            this.node.addChild(node);
            node.setSiblingIndex(0);
            node.addComponent(UITransform).setContentSize(this.tableWidth - this.wallThickness * 2, this.tableHeight - this.wallThickness * 2);
            const sp = node.addComponent(Sprite);
            sp.sizeMode = Sprite.SizeMode.CUSTOM;
            sp.color = new Color(30, 90, 40, 220);
            this._feltNode = node;
        }
        const ui = this._feltNode.getComponent(UITransform);
        if (ui) ui.setContentSize(Math.max(40, this.tableWidth - this.wallThickness * 2), Math.max(40, this.tableHeight - this.wallThickness * 2));
        const key = this._tableFeltKey;
        if (!key) {
            const sp = this._feltNode.getComponent(Sprite);
            if (sp) {
                sp.spriteFrame = null;
                sp.color = new Color(30, 90, 40, 180);
            }
            return;
        }
        const ref = DynamicAssetLoader.resolveTablePreset(key) ?? key;
        DynamicAssetLoader.loadSprite(ref, (frame) => {
            if (!this._feltNode?.isValid || !frame) return;
            const sp = this._feltNode.getComponent(Sprite);
            if (sp) {
                sp.spriteFrame = frame;
                sp.color = Color.WHITE;
            }
        });
    }

    // ── chrome / hud ──

    private _buildChrome(): void {
        const borderNode = new Node('TableBorder');
        borderNode.layer = this.node.layer;
        this.node.addChild(borderNode);
        borderNode.setSiblingIndex(0);
        this._border = borderNode.addComponent(Graphics);
        this._drawBorder();

        if (!this.showHud) return;

        // Compact top status (2 lines)
        const hudNode = new Node('EditorHud');
        hudNode.layer = this.node.layer;
        this.node.addChild(hudNode);
        hudNode.setPosition(-this.tableWidth / 2 + 12, this.tableHeight / 2 - 10, 0);
        const hudUi = hudNode.addComponent(UITransform);
        hudUi.setAnchorPoint(0, 1);
        hudUi.setContentSize(520, 48);
        const hud = hudNode.addComponent(Label);
        hud.fontSize = 15;
        hud.lineHeight = 20;
        hud.horizontalAlign = Label.HorizontalAlign.LEFT;
        hud.verticalAlign = Label.VerticalAlign.TOP;
        hud.overflow = Label.Overflow.NONE;
        hud.color = new Color(235, 240, 255, 235);
        hud.useSystemFont = true;
        hud.fontFamily = 'Arial';
        this._hud = hud;

        // Bottom action bar — big obvious buttons
        this._buildToolbar();
    }

    private _buildToolbar(): void {
        if (this._toolbarRoot?.isValid) this._toolbarRoot.destroy();
        this._toolbar = [];

        const root = new Node('EditorToolbar');
        root.layer = this.node.layer;
        this.node.addChild(root);
        root.setPosition(0, -this.tableHeight / 2 + 36, 0);
        this._toolbarRoot = root;

        const barW = Math.min(560, this.tableWidth - 40);
        const barH = 44;
        const bg = root.addComponent(Graphics);
        bg.fillColor = new Color(18, 24, 34, 210);
        bg.roundRect(-barW / 2, -barH / 2, barW, barH, 10);
        bg.fill();
        bg.strokeColor = new Color(90, 130, 180, 160);
        bg.lineWidth = 1.5;
        bg.roundRect(-barW / 2, -barH / 2, barW, barH, 10);
        bg.stroke();

        const defs: { id: string; label: string; tint: Color }[] = [
            { id: 'import', label: '粘贴 Scratch', tint: new Color(120, 220, 150, 255) },
            { id: 'play', label: '试玩 Game', tint: new Color(255, 180, 80, 255) },
            { id: 'mod', label: 'Mod 规则', tint: new Color(94, 200, 255, 255) },
            { id: 'export', label: '导出 S', tint: new Color(255, 210, 120, 255) },
            { id: 'help', label: '说明 H', tint: new Color(200, 210, 230, 255) },
        ];
        const gap = 8;
        const btnW = (barW - gap * (defs.length + 1)) / defs.length;
        const btnH = 30;
        let x = -barW / 2 + gap;

        for (const d of defs) {
            const btn = new Node(`Btn_${d.id}`);
            btn.layer = root.layer;
            root.addChild(btn);
            const cx = x + btnW / 2;
            btn.setPosition(cx, 0, 0);
            const g = btn.addComponent(Graphics);
            g.fillColor = new Color(36, 48, 68, 240);
            g.roundRect(-btnW / 2, -btnH / 2, btnW, btnH, 8);
            g.fill();
            const labNode = new Node('Label');
            labNode.layer = btn.layer;
            btn.addChild(labNode);
            const lui = labNode.addComponent(UITransform);
            lui.setContentSize(btnW, btnH);
            const lab = labNode.addComponent(Label);
            lab.string = d.label;
            lab.fontSize = 14;
            lab.lineHeight = 16;
            lab.horizontalAlign = Label.HorizontalAlign.CENTER;
            lab.verticalAlign = Label.VerticalAlign.CENTER;
            lab.color = d.tint;
            lab.useSystemFont = true;
            lab.fontFamily = 'Arial';
            this._toolbar.push({
                node: btn,
                id: d.id,
                x0: cx - btnW / 2,
                x1: cx + btnW / 2,
                y0: -this.tableHeight / 2 + 36 - btnH / 2,
                y1: -this.tableHeight / 2 + 36 + btnH / 2,
            });
            x += btnW + gap;
        }

        if (this._hintNode?.isValid) this._hintNode.destroy();
        const hintNode = new Node('ToolbarHint');
        hintNode.layer = this.node.layer;
        this.node.addChild(hintNode);
        hintNode.setPosition(0, -this.tableHeight / 2 + 68, 0);
        this._hintNode = hintNode;
        const hui = hintNode.addComponent(UITransform);
        hui.setContentSize(520, 18);
        const hint = hintNode.addComponent(Label);
        hint.string = 'Scratch Export → 粘贴 → 试玩 Game';
        hint.fontSize = 12;
        hint.lineHeight = 14;
        hint.horizontalAlign = Label.HorizontalAlign.CENTER;
        hint.verticalAlign = Label.VerticalAlign.CENTER;
        hint.color = new Color(150, 170, 200, 200);
        hint.useSystemFont = true;
        hint.fontFamily = 'Arial';
        this._hint = hint;
    }

    private _hitToolbar(localX: number, localY: number): boolean {
        // Toolbar lives in root local space at (0, -tableH/2+36); buttons store absolute local coords
        for (const b of this._toolbar) {
            if (localX >= b.x0 && localX <= b.x1 && localY >= b.y0 && localY <= b.y1) {
                this._onToolbar(b.id);
                return true;
            }
        }
        return false;
    }

    private _onToolbar(id: string): void {
        switch (id) {
            case 'mod':
                this._modEditor?.toggle();
                if (this._hint) {
                    this._hint.string = this._modEditor?.enabledEditor
                        ? 'Mod 已打开 · 用面板 Close / 按 B 关闭'
                        : '点「Mod 规则」打开面板 · Close / B 关闭';
                }
                break;
            case 'import':
                this._importModShare();
                break;
            case 'play':
                this._playScratchInGame();
                break;
            case 'export':
                this._exportWithBlocks();
                break;
            case 'help':
                console.log(HELP);
                if (this._hint) this._hint.string = '说明已打印到 Console（F12 / Creator 控制台）';
                break;
            default:
                break;
        }
    }

    private _drawBorder(): void {
        const g = this._border;
        if (!g) return;
        g.clear();
        const hw = this.tableWidth / 2;
        const hh = this.tableHeight / 2;
        // Bright table outline so it's obvious on black preview
        g.strokeColor = new Color(100, 190, 255, 230);
        g.lineWidth = 3;
        g.roundRect(-hw, -hh, this.tableWidth, this.tableHeight, 6);
        g.stroke();
        g.strokeColor = new Color(100, 190, 255, 60);
        g.lineWidth = 1;
        g.roundRect(-hw + 8, -hh + 8, this.tableWidth - 16, this.tableHeight - 16, 4);
        g.stroke();
    }

    private _refreshHud(): void {
        if (!this._hud) return;
        const brush = BRUSHES[this._brush];
        const sel = this._selected?.isValid ? this._marks.get(this._selected) : null;
        const selText = sel
            ? `${sel.kind}${sel.skinKey ? '/' + sel.skinKey : ''}`
            : '无';
        this._hud.string =
            `${brush.label}  ·  ${this._marks.size} 物件  ·  选中 ${selText}\n`
            + `1-8 换笔刷   右键删除   底部按钮打开 Mod`;
    }

    private _mountUnderCanvas(): void {
        const canvas = this.node.scene?.getComponentInChildren(Canvas);
        if (!canvas || canvas.node === this.node) return;
        if (this.node.parent !== canvas.node) {
            this.node.setParent(canvas.node);
            this.node.setPosition(0, 0, 0);
        }
        // Force UI_2D so Graphics / Labels / Sprites render under Canvas camera
        const uiLayer = Layers.Enum.UI_2D;
        this.node.layer = uiLayer;
        this._setLayerRecursive(this.node, uiLayer);
    }

    private _setLayerRecursive(node: Node, layer: number): void {
        node.layer = layer;
        for (const child of node.children) this._setLayerRecursive(child, layer);
    }

    /** Empty table looks "broken" — seed a few coins so something is visible. */
    private _seedDemoIfEmpty(): void {
        if (this._marks.size > 0) return;
        this._spawn(-160, 0, 0);  // striker
        this._spawn(80, 40, 1);   // target
        this._spawn(140, -50, 1); // target
        this._spawn(0, 120, 5);   // bomb
        this._refreshHud();
    }

    private _toLocal(screen: Vec2): Vec3 {
        const cam = this._resolveCamera();
        const world = new Vec3(screen.x, screen.y, 0);
        if (cam) cam.screenToWorld(world, world);
        world.z = 0;
        const ui = this.getComponent(UITransform);
        if (ui) ui.convertToNodeSpaceAR(world, this._local);
        else this._local.set(world);
        return this._local;
    }

    private _resolveCamera(): Camera | null {
        if (this.camera?.isValid) return this.camera;
        const cams = this.node.scene?.getComponentsInChildren(Camera) ?? [];
        return cams.find((cam) => cam.enabledInHierarchy) ?? null;
    }

    private _makeCircle(): SpriteFrame {
        const size = 48;
        const tex = new Texture2D();
        tex.reset({ width: size, height: size, format: Texture2D.PixelFormat.RGBA8888 });
        const pixels = new Uint8Array(size * size * 4);
        const cx = (size - 1) / 2;
        const radius = size / 2 - 1;
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const dx = x - cx;
                const dy = y - cx;
                const inside = dx * dx + dy * dy <= radius * radius;
                const i = (y * size + x) * 4;
                pixels[i] = 255;
                pixels[i + 1] = 255;
                pixels[i + 2] = 255;
                pixels[i + 3] = inside ? 255 : 0;
            }
        }
        tex.uploadData(pixels);
        const frame = new SpriteFrame();
        frame.texture = tex;
        frame.packable = false;
        return frame;
    }
}
