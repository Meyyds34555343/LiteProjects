import {
    _decorator,
    Color,
    Component,
    EventKeyboard,
    EventTouch,
    Graphics,
    input,
    Input,
    KeyCode,
    Label,
    Node,
    UITransform,
    Vec2,
    Vec3,
} from 'cc';
import { BlockCompiler, CompileCoinInput } from './BlockCompiler';
import {
    BLOCK_DEFS,
    BlockGraph,
    BlockKind,
    BlockOpcode,
    createBlockData,
    VisualBlockData,
} from './VisualBlockSchema';

const { ccclass, property } = _decorator;

const BLOCK_W = 200;
const BLOCK_H = 36;
const SNAP_PX = 15;
const STACK_GAP = 2;

interface LiveBlock {
    data: VisualBlockData;
    node: Node;
}

/**
 * Scratch 式積木工作區（僅編輯器）。
 * 拖曳吸附、垃圾桶刪除；匯出交給 BlockCompiler → LevelConfig JSON。
 */
@ccclass('BlockEditorManager')
export class BlockEditorManager extends Component {
    @property
    public workspaceWidth = 420;

    @property
    public workspaceHeight = 520;

    @property
    public offsetX = 420;

    @property
    public offsetY = 0;

    private _root: Node | null = null;
    private _palette: Node | null = null;
    private _trash: Node | null = null;
    private _live: LiveBlock[] = [];
    private _dragging: LiveBlock | null = null;
    private _dragOffset = new Vec3();
    private _snapHint: Node | null = null;
    /** 不可叫 _enabled：會撞到 Component 內建欄位。 */
    private _workspaceOpen = false;
    private readonly _local = new Vec3();

    protected onLoad(): void {
        input.on(Input.EventType.KEY_DOWN, this._onKey, this);
    }

    protected onDestroy(): void {
        input.off(Input.EventType.KEY_DOWN, this._onKey, this);
        this._unbindDrag();
        if (this._root?.isValid) this._root.destroy();
    }

    public get enabledEditor(): boolean {
        return this._workspaceOpen;
    }

    public toggle(): void {
        if (this._workspaceOpen) this.close();
        else this.open();
    }

    public open(): void {
        if (this._workspaceOpen) return;
        this._workspaceOpen = true;
        this._ensureUi();
        if (this._root) this._root.active = true;
        this._bindDrag();
        console.log('[BlockEditor] 開啟。左鍵拖積木，靠近可吸附。拖出工作區＝刪除。B 關閉，E 編譯匯出。');
    }

    public close(): void {
        this._workspaceOpen = false;
        this._unbindDrag();
        if (this._root) this._root.active = false;
        console.log('[BlockEditor] 關閉');
    }

    /** 給 LevelEditorTool：把積木編譯成 LevelConfig 並印出。 */
    public compileAndLog(level: {
        id: number;
        width: number;
        height: number;
        wallThickness: number;
        coins: CompileCoinInput[];
    }): void {
        const graph = this.toGraph();
        const result = BlockCompiler.compileLevel({
            id: level.id,
            width: level.width,
            height: level.height,
            wallThickness: level.wallThickness,
            coins: level.coins,
            graph,
        });
        console.log('[BlockEditor] LevelConfig JSON（可直接存 levels/*.json）:');
        console.log(result.levelJson);
        console.log('[BlockEditor] manifest patch:');
        console.log(result.manifestJson);
        console.log('[BlockEditor] behaviors:', result.behaviorsFlat.join(', ') || '(none)');
    }

    public toGraph(): BlockGraph {
        this._syncPositionsFromNodes();
        return { blocks: this._live.map((l) => ({ ...l.data, props: l.data.props.map((p) => ({ ...p })) })) };
    }

    // ── UI ──

    private _ensureUi(): void {
        if (this._root?.isValid) return;
        const root = new Node('BlockWorkspace');
        root.layer = this.node.layer;
        this.node.addChild(root);
        root.setPosition(this.offsetX, this.offsetY, 0);
        const ui = root.addComponent(UITransform);
        ui.setContentSize(this.workspaceWidth, this.workspaceHeight);
        ui.setAnchorPoint(0.5, 0.5);

        const bg = root.addComponent(Graphics);
        bg.fillColor = new Color(30, 34, 42, 230);
        bg.rect(-this.workspaceWidth / 2, -this.workspaceHeight / 2, this.workspaceWidth, this.workspaceHeight);
        bg.fill();
        bg.strokeColor = new Color(90, 100, 120, 255);
        bg.lineWidth = 2;
        bg.rect(-this.workspaceWidth / 2, -this.workspaceHeight / 2, this.workspaceWidth, this.workspaceHeight);
        bg.stroke();

        const title = new Node('Title');
        title.layer = root.layer;
        root.addChild(title);
        title.setPosition(0, this.workspaceHeight / 2 - 18, 0);
        title.addComponent(UITransform).setContentSize(200, 24);
        const titleLabel = title.addComponent(Label);
        titleLabel.string = 'Scratch Blocks';
        titleLabel.fontSize = 16;
        titleLabel.color = new Color(230, 230, 240, 255);
        titleLabel.horizontalAlign = Label.HorizontalAlign.CENTER;

        this._trash = this._makeTrash(root);
        this._palette = this._makePalette(root);
        this._snapHint = this._makeSnapHint(root);
        this._root = root;

        // 預置一條範例：when coin hit → sticky glue
        this._spawnPaletteBlock(BlockOpcode.WHEN_COIN_HIT, -60, 80);
        this._spawnPaletteBlock(BlockOpcode.APPLY_STICKY_GLUE, -60, 40);
    }

    private _makeTrash(parent: Node): Node {
        const node = new Node('Trash');
        node.layer = parent.layer;
        parent.addChild(node);
        node.setPosition(0, -this.workspaceHeight / 2 + 28, 0);
        node.addComponent(UITransform).setContentSize(this.workspaceWidth - 24, 40);
        const g = node.addComponent(Graphics);
        g.fillColor = new Color(120, 40, 40, 180);
        g.rect(-(this.workspaceWidth - 24) / 2, -20, this.workspaceWidth - 24, 40);
        g.fill();
        const labelNode = new Node('TrashLabel');
        labelNode.layer = parent.layer;
        node.addChild(labelNode);
        labelNode.addComponent(UITransform).setContentSize(200, 24);
        const label = labelNode.addComponent(Label);
        label.string = '🗑 drag here to delete';
        label.fontSize = 14;
        label.color = new Color(255, 200, 200, 255);
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        return node;
    }

    private _makePalette(parent: Node): Node {
        const node = new Node('Palette');
        node.layer = parent.layer;
        parent.addChild(node);
        node.setPosition(-this.workspaceWidth / 2 + 8, this.workspaceHeight / 2 - 48, 0);
        const opcodes = Object.keys(BLOCK_DEFS) as BlockOpcode[];
        let y = 0;
        for (const op of opcodes) {
            const chip = this._createBlockNode(createBlockData(op, 0, 0), true);
            node.addChild(chip);
            chip.setPosition(BLOCK_W / 2, -y, 0);
            y += BLOCK_H + 6;
            chip.on(Node.EventType.TOUCH_START, (e: EventTouch) => {
                e.propagationStopped = true;
                this._beginPaletteClone(op, e);
            }, this);
        }
        return node;
    }

    private _makeSnapHint(parent: Node): Node {
        const node = new Node('SnapHint');
        node.layer = parent.layer;
        parent.addChild(node);
        node.active = false;
        node.addComponent(UITransform).setContentSize(BLOCK_W, 6);
        const g = node.addComponent(Graphics);
        g.fillColor = new Color(255, 255, 120, 200);
        g.rect(-BLOCK_W / 2, -3, BLOCK_W, 6);
        g.fill();
        return node;
    }

    private _createBlockNode(data: VisualBlockData, isPalette: boolean): Node {
        const def = BLOCK_DEFS[data.opcode];
        const node = new Node(isPalette ? `Pal_${def.opcode}` : data.id);
        node.layer = this.node.layer;
        const ui = node.addComponent(UITransform);
        ui.setContentSize(BLOCK_W, BLOCK_H);
        ui.setAnchorPoint(0.5, 0.5);
        const g = node.addComponent(Graphics);
        const color = this._hex(def.color);
        g.fillColor = color;
        if (def.kind === BlockKind.Hat) {
            g.roundRect(-BLOCK_W / 2, -BLOCK_H / 2, BLOCK_W, BLOCK_H, 10);
        } else {
            g.roundRect(-BLOCK_W / 2, -BLOCK_H / 2, BLOCK_W, BLOCK_H, 4);
        }
        g.fill();
        const labelNode = new Node('Label');
        labelNode.layer = node.layer;
        node.addChild(labelNode);
        labelNode.addComponent(UITransform).setContentSize(BLOCK_W - 12, BLOCK_H - 8);
        const label = labelNode.addComponent(Label);
        label.string = def.label;
        label.fontSize = 13;
        label.lineHeight = 16;
        label.overflow = Label.Overflow.SHRINK;
        label.color = new Color(20, 20, 30, 255);
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        return node;
    }

    private _spawnPaletteBlock(opcode: BlockOpcode, x: number, y: number): LiveBlock {
        const data = createBlockData(opcode, x, y);
        const node = this._createBlockNode(data, false);
        this._root!.addChild(node);
        node.setPosition(x, y, 0);
        const live: LiveBlock = { data, node };
        this._live.push(live);
        node.on(Node.EventType.TOUCH_START, (e: EventTouch) => {
            e.propagationStopped = true;
            this._beginDrag(live, e);
        }, this);
        return live;
    }

    private _beginPaletteClone(opcode: BlockOpcode, event: EventTouch): void {
        if (!this._root) return;
        this._toWorkspaceLocal(event.getUILocation());
        const live = this._spawnPaletteBlock(opcode, this._local.x, this._local.y);
        this._dragging = live;
        this._dragOffset.set(0, 0, 0);
    }

    private _beginDrag(live: LiveBlock, event: EventTouch): void {
        this._toWorkspaceLocal(event.getUILocation());
        this._dragging = live;
        this._dragOffset.set(
            live.node.position.x - this._local.x,
            live.node.position.y - this._local.y,
            0,
        );
        this._detachFromParents(live);
    }

    private _bindDrag(): void {
        input.on(Input.EventType.TOUCH_MOVE, this._onMove, this);
        input.on(Input.EventType.TOUCH_END, this._onEnd, this);
        input.on(Input.EventType.TOUCH_CANCEL, this._onEnd, this);
    }

    private _unbindDrag(): void {
        input.off(Input.EventType.TOUCH_MOVE, this._onMove, this);
        input.off(Input.EventType.TOUCH_END, this._onEnd, this);
        input.off(Input.EventType.TOUCH_CANCEL, this._onEnd, this);
    }

    private _onMove = (event: EventTouch): void => {
        if (!this._dragging || !this._workspaceOpen) return;
        this._toWorkspaceLocal(event.getUILocation());
        this._dragging.node.setPosition(
            this._local.x + this._dragOffset.x,
            this._local.y + this._dragOffset.y,
            0,
        );
        this._updateSnapHint(this._dragging);
    };

    private _onEnd = (): void => {
        if (!this._dragging || !this._workspaceOpen) return;
        const live = this._dragging;
        this._dragging = null;
        if (this._snapHint) this._snapHint.active = false;

        if (this._isInTrash(live.node.position)) {
            this._destroyLive(live);
            return;
        }
        if (!this._insideWorkspace(live.node.position)) {
            this._destroyLive(live);
            return;
        }

        const target = this._findSnapTarget(live);
        if (target) this._snapOnto(live, target);
        else {
            live.data.x = live.node.position.x;
            live.data.y = live.node.position.y;
        }
    };

    private _detachFromParents(live: LiveBlock): void {
        for (const other of this._live) {
            if (other.data.nextId === live.data.id) other.data.nextId = null;
        }
    }

    private _findSnapTarget(moving: LiveBlock): LiveBlock | null {
        const def = BLOCK_DEFS[moving.data.opcode];
        if (def.kind !== BlockKind.Stack) return null;
        const mx = moving.node.position.x;
        const my = moving.node.position.y;
        let best: LiveBlock | null = null;
        let bestDist = SNAP_PX;
        for (const other of this._live) {
            if (other === moving) continue;
            if (other.data.nextId) continue;
            const anchorX = other.node.position.x;
            const anchorY = other.node.position.y - BLOCK_H / 2 - STACK_GAP - BLOCK_H / 2;
            const dx = mx - anchorX;
            const dy = my - anchorY;
            const d = Math.hypot(dx, dy);
            if (d <= bestDist) {
                bestDist = d;
                best = other;
            }
        }
        return best;
    }

    private _updateSnapHint(moving: LiveBlock): void {
        if (!this._snapHint) return;
        const target = this._findSnapTarget(moving);
        if (!target) {
            this._snapHint.active = false;
            return;
        }
        this._snapHint.active = true;
        this._snapHint.setPosition(
            target.node.position.x,
            target.node.position.y - BLOCK_H / 2 - STACK_GAP,
            0,
        );
    }

    private _snapOnto(child: LiveBlock, parent: LiveBlock): void {
        parent.data.nextId = child.data.id;
        const x = parent.node.position.x;
        const y = parent.node.position.y - BLOCK_H - STACK_GAP;
        child.node.setPosition(x, y, 0);
        child.data.x = x;
        child.data.y = y;
        parent.data.x = parent.node.position.x;
        parent.data.y = parent.node.position.y;
        // 若 parent 也在鏈上，排整條
        this._layoutChainFromRoot(this._findChainRoot(parent));
    }

    private _findChainRoot(live: LiveBlock): LiveBlock {
        let cur = live;
        let guard = 0;
        while (guard++ < 64) {
            const parent = this._live.find((l) => l.data.nextId === cur.data.id);
            if (!parent) return cur;
            cur = parent;
        }
        return live;
    }

    private _layoutChainFromRoot(root: LiveBlock): void {
        let cur: LiveBlock | null = root;
        let y = root.node.position.y;
        const x = root.node.position.x;
        const seen = new Set<string>();
        while (cur && !seen.has(cur.data.id)) {
            seen.add(cur.data.id);
            cur.node.setPosition(x, y, 0);
            cur.data.x = x;
            cur.data.y = y;
            y -= BLOCK_H + STACK_GAP;
            const nextId = cur.data.nextId;
            cur = nextId ? this._live.find((l) => l.data.id === nextId) ?? null : null;
        }
    }

    private _destroyLive(live: LiveBlock): void {
        this._detachFromParents(live);
        // 斷開它指向的下一個，保留下方積木為自由塊
        live.data.nextId = null;
        const idx = this._live.indexOf(live);
        if (idx >= 0) this._live.splice(idx, 1);
        if (live.node.isValid) live.node.destroy();
    }

    private _isInTrash(pos: Vec3): boolean {
        if (!this._trash) return false;
        const t = this._trash.position;
        const halfW = (this.workspaceWidth - 24) / 2;
        return Math.abs(pos.x - t.x) <= halfW && Math.abs(pos.y - t.y) <= 24;
    }

    private _insideWorkspace(pos: Vec3): boolean {
        const hw = this.workspaceWidth / 2;
        const hh = this.workspaceHeight / 2;
        return Math.abs(pos.x) <= hw && Math.abs(pos.y) <= hh;
    }

    private _syncPositionsFromNodes(): void {
        for (const live of this._live) {
            live.data.x = live.node.position.x;
            live.data.y = live.node.position.y;
        }
    }

    private _toWorkspaceLocal(screen: Vec2): void {
        if (!this._root) {
            this._local.set(screen.x, screen.y, 0);
            return;
        }
        const ui = this._root.getComponent(UITransform);
        const world = new Vec3(screen.x, screen.y, 0);
        if (ui) ui.convertToNodeSpaceAR(world, this._local);
        else this._local.set(world);
    }

    private _onKey = (event: EventKeyboard): void => {
        if (event.keyCode === KeyCode.KEY_B) this.toggle();
    };

    private _hex(hex: string): Color {
        const h = hex.replace('#', '');
        const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
        return new Color((n >> 16) & 255, (n >> 8) & 255, n & 255, 255);
    }
}
