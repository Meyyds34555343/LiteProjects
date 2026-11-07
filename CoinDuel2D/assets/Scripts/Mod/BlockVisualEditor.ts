/**
 * Simplified in-game Mod panel (Scratch-lite).
 * Stable touch coords, compact palette, close button, no giant overflow.
 */
import {
    _decorator,
    Camera,
    Canvas,
    Color,
    Component,
    EventKeyboard,
    EventMouse,
    EventTouch,
    Graphics,
    input,
    Input,
    KeyCode,
    Label,
    Layers,
    Node,
    UITransform,
    Vec2,
    Vec3,
} from 'cc';
import { ModCompiler, starterGraph } from './ModCompiler';
import {
    canSnap,
    createModBlock,
    LoseConditionType,
    MOD_BLOCK_DEFS,
    ModBlockGraph,
    ModBlockKind,
    ModConfig,
    ModOpcode,
    ModVisualBlock,
    WinConditionType,
} from './ModConfigSchema';

const { ccclass, property } = _decorator;

const BLOCK_W = 200;
const BLOCK_H = 34;
const SNAP_PX = 22;
const STACK_GAP = 3;

/** Curated palette — keeps UI short and usable. */
const PALETTE_OPS: ModOpcode[] = [
    ModOpcode.WHEN_GAME_START,
    ModOpcode.WHEN_COIN_HIT,
    ModOpcode.WHEN_SHOT_FIRED,
    ModOpcode.IF_VELOCITY_GREATER_THAN,
    ModOpcode.IF_PROBABILITY,
    ModOpcode.APPLY_IMPULSE,
    ModOpcode.EXPLODE_RADIUS,
    ModOpcode.SET_COIN_POSITION,
    ModOpcode.SWAP_POSITIONS,
    ModOpcode.SPAWN_WORLD_TEXT,
    ModOpcode.SCREEN_SHAKE,
    ModOpcode.PLAY_MEME_SOUND,
    ModOpcode.DECLARE_WIN,
    ModOpcode.DECLARE_LOSE,
];

interface LiveBlock {
    data: ModVisualBlock;
    node: Node;
}

@ccclass('BlockVisualEditor')
export class BlockVisualEditor extends Component {
    @property
    public workspaceWidth = 720;

    @property
    public workspaceHeight = 480;

    @property
    public offsetX = 0;

    @property
    public offsetY = 20;

    private _root: Node | null = null;
    private _canvas: Node | null = null;
    private _trash: Node | null = null;
    private _snapHint: Node | null = null;
    private _hud: Label | null = null;
    private _live: LiveBlock[] = [];
    private _dragging: LiveBlock | null = null;
    private _dragOffset = new Vec3();
    private _panning = false;
    private _panLast = new Vec2();
    private _workspaceOpen = false;
    private readonly _local = new Vec3();
    private readonly _world = new Vec3();
    private _zoom = 1;
    private _lastShare = '';
    private _modName = 'Sandbox Mode';
    private _importedMod: ModConfig | null = null;
    private _camera: Camera | null = null;

    protected onLoad(): void {
        input.on(Input.EventType.KEY_DOWN, this._onKey, this);
        input.on(Input.EventType.MOUSE_WHEEL, this._onWheel, this);
        input.on(Input.EventType.MOUSE_DOWN, this._onMouseDown, this);
        input.on(Input.EventType.MOUSE_UP, this._onMouseUp, this);
        input.on(Input.EventType.MOUSE_MOVE, this._onMouseMove, this);
    }

    protected onDestroy(): void {
        input.off(Input.EventType.KEY_DOWN, this._onKey, this);
        input.off(Input.EventType.MOUSE_WHEEL, this._onWheel, this);
        input.off(Input.EventType.MOUSE_DOWN, this._onMouseDown, this);
        input.off(Input.EventType.MOUSE_UP, this._onMouseUp, this);
        input.off(Input.EventType.MOUSE_MOVE, this._onMouseMove, this);
        this._unbindDrag();
        if (this._root?.isValid) this._root.destroy();
    }

    public get enabledEditor(): boolean {
        return this._workspaceOpen;
    }

    public get lastShareCode(): string {
        return this._lastShare;
    }

    public get lastImportedMod(): ModConfig | null {
        return this._importedMod;
    }

    public toggle(): void {
        if (this._workspaceOpen) this.close();
        else this.open();
    }

    public open(): void {
        if (this._workspaceOpen) return;
        this._workspaceOpen = true;
        this._ensureUi();
        if (this._root) {
            this._root.active = true;
            this._root.setSiblingIndex(999);
        }
        this._bindDrag();
        this._refreshHud('open — drag blocks · Close / B to exit');
        console.log('[ModEditor] OPEN');
    }

    public close(): void {
        this._workspaceOpen = false;
        this._dragging = null;
        this._panning = false;
        this._unbindDrag();
        if (this._root) this._root.active = false;
        console.log('[ModEditor] closed');
    }

    public toGraph(): ModBlockGraph {
        this._syncPositions();
        return {
            blocks: this._live.map((l) => ({
                ...l.data,
                props: l.data.props.map((p) => ({ ...p })),
            })),
        };
    }

    public loadGraph(graph: ModBlockGraph): void {
        this._ensureUi();
        for (const live of [...this._live]) this._destroyLive(live);
        for (const data of graph.blocks) {
            this._spawnBlock({ ...data, props: data.props.map((p) => ({ ...p })) }, data.x, data.y);
        }
        this._layoutAllChains();
        this._refreshHud('graph loaded');
    }

    public compileAndLog(meta?: { id?: string; name?: string }): ModConfig {
        const prev = this._importedMod;
        const result = ModCompiler.compile({
            id: meta?.id ?? prev?.id,
            name: meta?.name ?? this._modName,
            graph: this.toGraph(),
            win: prev?.win ?? [{ type: WinConditionType.CLEAR_ALL_COINS }],
            lose: prev?.lose ?? [{ type: LoseConditionType.STRIKER_FALLS_OFF_TABLE }],
            physics: prev?.physics,
            variables: prev?.variables,
            level: prev?.level,
        });
        this._lastShare = result.shareCode;
        this._importedMod = result.mod;
        console.log('[ModEditor] SHARE:', result.shareCode);
        if (result.mod.level) console.log('[ModEditor] LEVEL:', JSON.stringify(result.mod.level, null, 2));
        this._refreshHud(`exported ${result.hash}`);
        return result.mod;
    }

    public exportShareCode(): string {
        return ModCompiler.toShareCode(this.compileAndLog());
    }

    public importShareCode(code: string): boolean {
        const mod = ModCompiler.fromShareCode(code.trim());
        if (!mod) {
            this._refreshHud('invalid share code');
            return false;
        }
        this._modName = mod.name;
        this._importedMod = mod;
        this.loadGraph(mod.graph);
        this._lastShare = code.trim();
        this._refreshHud(mod.level ? `imported ${mod.name} + level` : `imported ${mod.name}`);
        return true;
    }

    // ── UI ──

    private _ensureUi(): void {
        if (this._root?.isValid) return;

        // Fit inside level table when possible
        const parentUi = this.node.getComponent(UITransform);
        if (parentUi) {
            this.workspaceWidth = Math.min(720, Math.max(520, parentUi.contentSize.width - 80));
            this.workspaceHeight = Math.min(460, Math.max(360, parentUi.contentSize.height - 120));
        }

        const root = new Node('ModWorkspace');
        root.layer = Layers.Enum.UI_2D;
        // Parent under Canvas so the panel always renders above the table
        const canvas = this.node.scene?.getComponentInChildren(Canvas);
        if (canvas) canvas.node.addChild(root);
        else this.node.addChild(root);
        root.setPosition(this.offsetX, this.offsetY, 0);
        const ui = root.addComponent(UITransform);
        ui.setContentSize(this.workspaceWidth, this.workspaceHeight);
        ui.setAnchorPoint(0.5, 0.5);

        const bg = root.addComponent(Graphics);
        bg.fillColor = new Color(32, 42, 58, 250);
        bg.roundRect(-this.workspaceWidth / 2, -this.workspaceHeight / 2, this.workspaceWidth, this.workspaceHeight, 12);
        bg.fill();
        bg.strokeColor = new Color(120, 200, 255, 255);
        bg.lineWidth = 3;
        bg.roundRect(-this.workspaceWidth / 2, -this.workspaceHeight / 2, this.workspaceWidth, this.workspaceHeight, 12);
        bg.stroke();

        // Header bar
        const header = new Node('Header');
        header.layer = root.layer;
        root.addChild(header);
        header.setPosition(0, this.workspaceHeight / 2 - 22, 0);
        const hg = header.addComponent(Graphics);
        hg.fillColor = new Color(30, 40, 55, 255);
        hg.rect(-this.workspaceWidth / 2, -18, this.workspaceWidth, 36);
        hg.fill();
        this._label(header, 'Mod Rules', -this.workspaceWidth / 2 + 70, 0, 15, new Color(230, 240, 255));

        this._makeHeaderBtn(header, 'Close', this.workspaceWidth / 2 - 50, () => this.close());
        this._makeHeaderBtn(header, 'Export', this.workspaceWidth / 2 - 130, () => this.compileAndLog());
        this._makeHeaderBtn(header, 'Import', this.workspaceWidth / 2 - 210, () => this._tryPasteImport());

        this._hud = this._label(
            root,
            '',
            0,
            -this.workspaceHeight / 2 + 16,
            12,
            new Color(160, 180, 210),
        ).getComponent(Label);

        this._canvas = new Node('BlockCanvas');
        this._canvas.layer = root.layer;
        root.addChild(this._canvas);
        this._canvas.setPosition(40, -10, 0);
        this._canvas.addComponent(UITransform).setContentSize(2000, 2000);

        this._trash = this._makeTrash(root);
        this._makePalette(root);
        this._snapHint = this._makeSnapHint(this._canvas);
        this._root = root;

        this.loadGraph(starterGraph());
        this._refreshHud('ready');
    }

    private _makeHeaderBtn(parent: Node, text: string, x: number, onClick: () => void): void {
        const btn = new Node(`Btn_${text}`);
        btn.layer = parent.layer;
        parent.addChild(btn);
        btn.setPosition(x, 0, 0);
        const w = 70;
        const h = 26;
        btn.addComponent(UITransform).setContentSize(w, h);
        const g = btn.addComponent(Graphics);
        g.fillColor = new Color(45, 70, 100, 255);
        g.roundRect(-w / 2, -h / 2, w, h, 6);
        g.fill();
        this._label(btn, text, 0, 0, 12, new Color(200, 230, 255));
        btn.on(Node.EventType.TOUCH_END, (e: EventTouch) => {
            e.propagationStopped = true;
            onClick();
        }, this);
    }

    private _makePalette(parent: Node): void {
        const node = new Node('Palette');
        node.layer = parent.layer;
        parent.addChild(node);
        const left = -this.workspaceWidth / 2 + 8;
        const top = this.workspaceHeight / 2 - 48;
        node.setPosition(left, top, 0);

        const bg = node.addComponent(Graphics);
        const panelH = Math.min(this.workspaceHeight - 70, PALETTE_OPS.length * 30 + 28);
        bg.fillColor = new Color(28, 34, 46, 230);
        bg.roundRect(0, -panelH, 168, panelH, 8);
        bg.fill();

        this._label(node, 'Blocks', 84, -12, 12, new Color(140, 200, 255));

        let y = 28;
        for (const op of PALETTE_OPS) {
            const def = MOD_BLOCK_DEFS[op];
            const chip = new Node(`Pal_${op}`);
            chip.layer = node.layer;
            node.addChild(chip);
            chip.setPosition(84, -y, 0);
            chip.addComponent(UITransform).setContentSize(152, 26);
            const g = chip.addComponent(Graphics);
            g.fillColor = this._hex(def.color);
            g.roundRect(-76, -13, 152, 26, 5);
            g.fill();
            this._label(chip, `${def.icon} ${def.label}`, 0, 0, 11, new Color(20, 20, 28));
            chip.on(Node.EventType.TOUCH_START, (e: EventTouch) => {
                e.propagationStopped = true;
                this._beginPaletteClone(op, e);
            }, this);
            y += 30;
        }
    }

    private _makeTrash(parent: Node): Node {
        const node = new Node('Trash');
        node.layer = parent.layer;
        parent.addChild(node);
        node.setPosition(this.workspaceWidth / 2 - 70, -this.workspaceHeight / 2 + 48, 0);
        node.addComponent(UITransform).setContentSize(120, 36);
        const g = node.addComponent(Graphics);
        g.fillColor = new Color(110, 45, 45, 220);
        g.roundRect(-60, -18, 120, 36, 8);
        g.fill();
        this._label(node, '🗑 Delete', 0, 0, 12, new Color(255, 210, 210));
        return node;
    }

    private _makeSnapHint(parent: Node): Node {
        const node = new Node('SnapHint');
        node.layer = parent.layer;
        parent.addChild(node);
        node.active = false;
        node.addComponent(UITransform).setContentSize(BLOCK_W, 6);
        const g = node.addComponent(Graphics);
        g.fillColor = new Color(255, 230, 80, 230);
        g.rect(-BLOCK_W / 2, -3, BLOCK_W, 6);
        g.fill();
        return node;
    }

    private _createBlockNode(data: ModVisualBlock): Node {
        const def = MOD_BLOCK_DEFS[data.opcode];
        const node = new Node(data.id);
        node.layer = Layers.Enum.UI_2D;
        const ui = node.addComponent(UITransform);
        ui.setContentSize(BLOCK_W, BLOCK_H);
        const g = node.addComponent(Graphics);
        g.fillColor = this._hex(def.color);
        const r = def.kind === ModBlockKind.Hat ? 10 : def.kind === ModBlockKind.Cap ? 8 : 4;
        g.roundRect(-BLOCK_W / 2, -BLOCK_H / 2, BLOCK_W, BLOCK_H, r);
        g.fill();
        const label = this._label(node, `${def.icon} ${def.label}`, 0, 0, 12, new Color(20, 20, 30));
        label.getComponent(UITransform)!.setContentSize(BLOCK_W - 12, BLOCK_H - 4);
        const lab = label.getComponent(Label)!;
        lab.overflow = Label.Overflow.SHRINK;
        return node;
    }

    private _spawnBlock(data: ModVisualBlock, x: number, y: number): LiveBlock {
        const node = this._createBlockNode(data);
        this._canvas!.addChild(node);
        node.setPosition(x, y, 0);
        data.x = x;
        data.y = y;
        const live: LiveBlock = { data, node };
        this._live.push(live);
        node.on(Node.EventType.TOUCH_START, (e: EventTouch) => {
            e.propagationStopped = true;
            this._beginDrag(live, e);
        }, this);
        return live;
    }

    private _beginPaletteClone(opcode: ModOpcode, event: EventTouch): void {
        if (!this._canvas || !this._workspaceOpen) return;
        this._screenToCanvas(event.getLocation());
        const data = createModBlock(opcode, this._local.x, this._local.y);
        const live = this._spawnBlock(data, this._local.x, this._local.y);
        this._dragging = live;
        this._dragOffset.set(0, 0, 0);
    }

    private _beginDrag(live: LiveBlock, event: EventTouch): void {
        this._screenToCanvas(event.getLocation());
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
        this._screenToCanvas(event.getLocation());
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

        const rootPos = this._toRootFromCanvas(live.node.position);
        if (this._isInTrash(rootPos)) {
            this._destroyLive(live);
            this._refreshHud('deleted');
            return;
        }

        const target = this._findSnapTarget(live);
        if (target) this._snapOnto(live, target);
        else {
            live.data.x = live.node.position.x;
            live.data.y = live.node.position.y;
        }
        this._refreshHud(`${this._live.length} blocks`);
    };

    private _findSnapTarget(moving: LiveBlock): LiveBlock | null {
        const mx = moving.node.position.x;
        const my = moving.node.position.y;
        let best: LiveBlock | null = null;
        let bestDist = SNAP_PX;
        for (const other of this._live) {
            if (other === moving) continue;
            if (other.data.nextId) continue;
            if (!canSnap(other.data.opcode, moving.data.opcode)) continue;
            const anchorX = other.node.position.x;
            const anchorY = other.node.position.y - BLOCK_H / 2 - STACK_GAP - BLOCK_H / 2;
            const d = Math.hypot(mx - anchorX, my - anchorY);
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
        this._layoutChainFromRoot(this._findChainRoot(parent));
    }

    private _detachFromParents(live: LiveBlock): void {
        for (const other of this._live) {
            if (other.data.nextId === live.data.id) other.data.nextId = null;
        }
    }

    private _findChainRoot(live: LiveBlock): LiveBlock {
        let cur = live;
        for (let i = 0; i < 64; i++) {
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

    private _layoutAllChains(): void {
        const roots = this._live.filter((l) => !this._live.some((o) => o.data.nextId === l.data.id));
        for (const root of roots) this._layoutChainFromRoot(root);
    }

    private _destroyLive(live: LiveBlock): void {
        this._detachFromParents(live);
        live.data.nextId = null;
        const idx = this._live.indexOf(live);
        if (idx >= 0) this._live.splice(idx, 1);
        if (live.node.isValid) live.node.destroy();
    }

    private _onMouseDown = (event: EventMouse): void => {
        if (!this._workspaceOpen) return;
        if (event.getButton() === EventMouse.BUTTON_MIDDLE
            || (event.getButton() === EventMouse.BUTTON_RIGHT)) {
            this._panning = true;
            this._panLast.set(event.getLocationX(), event.getLocationY());
        }
    };

    private _onMouseUp = (): void => {
        this._panning = false;
    };

    private _onMouseMove = (event: EventMouse): void => {
        if (!this._workspaceOpen || !this._panning || !this._canvas) return;
        const x = event.getLocationX();
        const y = event.getLocationY();
        const dx = x - this._panLast.x;
        const dy = y - this._panLast.y;
        this._panLast.set(x, y);
        const p = this._canvas.position;
        this._canvas.setPosition(p.x + dx, p.y + dy, 0);
    };

    private _onWheel = (event: EventMouse): void => {
        if (!this._workspaceOpen || !this._canvas) return;
        const scroll = event.getScrollY();
        if (!scroll) return;
        const factor = scroll > 0 ? 1.08 : 0.92;
        this._zoom = Math.min(1.8, Math.max(0.55, this._zoom * factor));
        this._canvas.setScale(this._zoom, this._zoom, 1);
        this._refreshHud(`zoom ${this._zoom.toFixed(2)}`);
    };

    private _onKey = (event: EventKeyboard): void => {
        const code = event.keyCode;
        if (code === KeyCode.KEY_B || code === KeyCode.ESCAPE) {
            this.toggle();
            return;
        }
        if (!this._workspaceOpen) return;
        if (code === KeyCode.KEY_X || code === KeyCode.KEY_E) {
            this.compileAndLog();
            return;
        }
        if (code === KeyCode.KEY_V) {
            this._tryPasteImport();
        }
    };

    private _tryPasteImport(): void {
        const nav: any = typeof navigator !== 'undefined' ? navigator : null;
        if (nav?.clipboard?.readText) {
            nav.clipboard.readText().then((text: string) => {
                if (typeof text === 'string' && text.includes('COINMOD1:')) {
                    this.importShareCode(text);
                } else {
                    this._refreshHud('clipboard missing COINMOD1');
                }
            }).catch(() => {
                if (this._lastShare) this.importShareCode(this._lastShare);
                else this._refreshHud('clipboard blocked');
            });
            return;
        }
        if (this._lastShare) this.importShareCode(this._lastShare);
        else this._refreshHud('no clipboard');
    }

    private _syncPositions(): void {
        for (const live of this._live) {
            live.data.x = live.node.position.x;
            live.data.y = live.node.position.y;
        }
    }

    private _isInTrash(rootLocal: Vec3): boolean {
        if (!this._trash) return false;
        const t = this._trash.position;
        return Math.abs(rootLocal.x - t.x) <= 70 && Math.abs(rootLocal.y - t.y) <= 24;
    }

    private _toRootFromCanvas(canvasLocal: Vec3): Vec3 {
        if (!this._canvas) return canvasLocal.clone();
        return new Vec3(
            canvasLocal.x * this._zoom + this._canvas.position.x,
            canvasLocal.y * this._zoom + this._canvas.position.y,
            0,
        );
    }

    /** Screen/pixel → canvas local (fixes previous UILocation misuse). */
    private _screenToCanvas(screen: Vec2): void {
        if (!this._canvas) {
            this._local.set(screen.x, screen.y, 0);
            return;
        }
        const cam = this._resolveCamera();
        this._world.set(screen.x, screen.y, 0);
        if (cam) cam.screenToWorld(this._world, this._world);
        this._world.z = 0;
        const ui = this._canvas.getComponent(UITransform);
        if (ui) ui.convertToNodeSpaceAR(this._world, this._local);
        else this._local.set(this._world);
    }

    private _resolveCamera(): Camera | null {
        if (this._camera?.isValid) return this._camera;
        const canvas = this.node.scene?.getComponentInChildren(Canvas);
        const cams = this.node.scene?.getComponentsInChildren(Camera) ?? [];
        this._camera = cams.find((c) => c.enabledInHierarchy) ?? null;
        if (!this._camera && canvas) {
            this._camera = canvas.node.getComponent(Camera) ?? canvas.node.getComponentInChildren(Camera);
        }
        return this._camera;
    }

    private _refreshHud(extra = ''): void {
        if (!this._hud) return;
        this._hud.string = `${this._live.length} blocks  ·  ${extra}`;
    }

    private _label(parent: Node, text: string, x: number, y: number, size: number, color: Color): Node {
        const node = new Node('L');
        node.layer = Layers.Enum.UI_2D;
        parent.addChild(node);
        node.setPosition(x, y, 0);
        node.addComponent(UITransform).setContentSize(280, 22);
        const label = node.addComponent(Label);
        label.string = text;
        label.fontSize = size;
        label.lineHeight = size + 2;
        label.color = color;
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        label.useSystemFont = true;
        label.fontFamily = 'Arial';
        return node;
    }

    private _hex(hex: string): Color {
        const h = hex.replace('#', '');
        const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
        return new Color((n >> 16) & 255, (n >> 8) & 255, n & 255, 255);
    }
}
