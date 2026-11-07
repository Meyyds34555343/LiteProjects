/**
 * Lightweight HTML5 canvas sandbox — visualizes ModConfig level + physics
 * for the Blockly live-preview sidebar (browser host only).
 * Mirrors GameLogicInterpreter.frictionToDamping for parity.
 */

import { ModConfig, ModOpcode, DEFAULT_PHYSICS } from '../ModConfigSchema';

export interface LivePreviewMarkers {
    coins: {
        x: number;
        y: number;
        label?: string;
        kind?: string;
        memeId?: string;
        radius?: number;
    }[];
    blasts: { x: number; y: number; radius: number }[];
    impulses: { x: number; y: number; ix: number; iy: number }[];
    tableW: number;
    tableH: number;
}

export interface LivePreviewInteraction {
    aimEnabled?: boolean;
    /** memeId → HTMLImageElement or ImageBitmap */
    memeAtlas?: Record<string, CanvasImageSource>;
    paused?: boolean;
}

interface SimBody {
    x: number;
    y: number;
    vx: number;
    vy: number;
    r: number;
    kind: string;
    label: string;
    memeId?: string;
    canshot: boolean;
}

/** Extract placement / physics markers from compiled ModConfig. */
export function extractPreviewMarkers(mod: ModConfig): LivePreviewMarkers {
    const coins: LivePreviewMarkers['coins'] = [];
    const blasts: LivePreviewMarkers['blasts'] = [];
    const impulses: LivePreviewMarkers['impulses'] = [];
    const tableW = mod.level?.width ?? 800;
    const tableH = mod.level?.height ?? 600;

    if (mod.level?.coins?.length) {
        for (const item of mod.level.coins) {
            const type = String(item.type ?? 'coin');
            const x = Number(item.x ?? 0);
            const y = Number(item.y ?? 0);
            const radius = Number(item.radius ?? 32);
            let label = type;
            let kind = type;
            if (type === 'coin') {
                const canshot = item.canshot !== false;
                const beh = Array.isArray(item.behaviors)
                    ? String(item.behaviors[0] ?? '')
                    : String(item.behavior ?? '');
                if (canshot) { label = 'striker'; kind = 'striker'; }
                else if (beh.includes('Knock')) { label = 'knock'; kind = 'knockback'; }
                else if (beh.includes('Freeze')) { label = 'ice'; kind = 'freeze'; }
                else if (beh.includes('Flash')) { label = 'flash'; kind = 'flash'; }
                else { label = 'target'; kind = 'target'; }
            }
            coins.push({
                x, y, label, kind, radius,
                memeId: item.memeId != null ? String(item.memeId) : undefined,
            });
        }
    }

    let coinIdx = 0;
    for (const pipe of mod.pipelines ?? []) {
        for (const step of pipe.steps ?? []) {
            const p = step.props ?? {};
            if (step.opcode === ModOpcode.SET_COIN_POSITION) {
                coins.push({
                    x: Number(p.x ?? 0),
                    y: Number(p.y ?? 0),
                    label: `P${++coinIdx}`,
                    kind: 'runtime',
                });
            }
            if (step.opcode === ModOpcode.EXPLODE_RADIUS) {
                const origin = coins[coins.length - 1] ?? { x: 0, y: 0 };
                blasts.push({
                    x: origin.x,
                    y: origin.y,
                    radius: Number(p.radius ?? 120),
                });
            }
            if (step.opcode === ModOpcode.APPLY_IMPULSE) {
                const origin = coins[coins.length - 1] ?? { x: 0, y: 0 };
                impulses.push({
                    x: origin.x,
                    y: origin.y,
                    ix: Number(p.x ?? 0),
                    iy: Number(p.y ?? 0),
                });
            }
        }
    }

    if (!coins.length) {
        coins.push({ x: -120, y: 0, label: 'striker', kind: 'striker', radius: 32 });
        coins.push({ x: 80, y: 40, label: 'target', kind: 'target', radius: 32 });
        coins.push({ x: 140, y: -30, label: 'target', kind: 'target', radius: 32 });
    }
    return { coins, blasts, impulses, tableW, tableH };
}

/** Same formula as GameLogicInterpreter.frictionToDamping */
export function frictionToDamping(friction: number): number {
    return Math.max(0.05, friction * 6);
}

export class LivePreviewSandbox {
    private _canvas: HTMLCanvasElement;
    private _ctx: CanvasRenderingContext2D;
    private _mod: ModConfig | null = null;
    private _raf = 0;
    private _t0 = performance.now();
    private _bodies: SimBody[] = [];
    private _playing = true;
    private _aimEnabled = true;
    private _memeAtlas: Record<string, CanvasImageSource> = {};
    private _dragging = false;
    private _dragFrom: { x: number; y: number } | null = null;
    private _dragTo: { x: number; y: number } | null = null;
    private _view = { cx: 0, cy: 0, scale: 1 };
    private _ghostBlasts: LivePreviewMarkers['blasts'] = [];
    private _lastDt = 1 / 60;

    constructor(canvas: HTMLCanvasElement) {
        this._canvas = canvas;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('[LivePreview] 2d context unavailable');
        this._ctx = ctx;
        this._loop = this._loop.bind(this);
        this._onPointerDown = this._onPointerDown.bind(this);
        this._onPointerMove = this._onPointerMove.bind(this);
        this._onPointerUp = this._onPointerUp.bind(this);
        canvas.addEventListener('pointerdown', this._onPointerDown);
        window.addEventListener('pointermove', this._onPointerMove);
        window.addEventListener('pointerup', this._onPointerUp);
        this._raf = requestAnimationFrame(this._loop);
    }

    public setMod(mod: ModConfig | null): void {
        this._mod = mod;
        this.resetSim();
        this.draw();
    }

    public setInteraction(opts: LivePreviewInteraction): void {
        if (opts.aimEnabled != null) this._aimEnabled = opts.aimEnabled;
        if (opts.memeAtlas) this._memeAtlas = opts.memeAtlas;
        if (opts.paused != null) this._playing = !opts.paused;
    }

    public play(): void { this._playing = true; }
    public pause(): void { this._playing = false; }
    public resetSim(): void {
        const empty: ModConfig = {
            schemaVersion: 1, id: '', name: '', version: 0,
            graph: { blocks: [] }, pipelines: [], win: [], lose: [],
            physics: { ...DEFAULT_PHYSICS },
            variables: [],
        };
        const markers = extractPreviewMarkers(this._mod ?? empty);
        this._ghostBlasts = markers.blasts;
        this._bodies = markers.coins.map((c) => ({
            x: c.x,
            y: c.y,
            vx: 0,
            vy: 0,
            r: c.radius ?? 32,
            kind: c.kind ?? 'target',
            label: c.label ?? '',
            memeId: c.memeId,
            canshot: c.kind === 'striker',
        }));
        this._dragging = false;
        this._dragFrom = null;
        this._dragTo = null;
    }

    public resize(cssW: number, cssH: number): void {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        this._canvas.width = Math.max(1, Math.floor(cssW * dpr));
        this._canvas.height = Math.max(1, Math.floor(cssH * dpr));
        this._canvas.style.width = `${cssW}px`;
        this._canvas.style.height = `${cssH}px`;
        this._ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.draw();
    }

    public dispose(): void {
        cancelAnimationFrame(this._raf);
        this._canvas.removeEventListener('pointerdown', this._onPointerDown);
        window.removeEventListener('pointermove', this._onPointerMove);
        window.removeEventListener('pointerup', this._onPointerUp);
        this._mod = null;
    }

    public parityBadge(): string {
        const mod = this._mod;
        if (!mod) return 'schema — · physics —';
        const p = mod.physics ?? DEFAULT_PHYSICS;
        const ph = `${Number(p.tableFriction).toFixed(2)}/${Number(p.restitutionScale).toFixed(2)}`;
        return `v${mod.schemaVersion} · μ ${ph} · #${(mod.hash || '—').slice(0, 8)}`;
    }

    public draw(): void {
        const w = this._canvas.clientWidth || 280;
        const h = this._canvas.clientHeight || 360;
        const ctx = this._ctx;
        ctx.clearRect(0, 0, w, h);

        const bg = ctx.createLinearGradient(0, 0, 0, h);
        bg.addColorStop(0, '#1a2433');
        bg.addColorStop(1, '#10161f');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, w, h);

        const empty: ModConfig = {
            schemaVersion: 1, id: '', name: '', version: 0,
            graph: { blocks: [] }, pipelines: [], win: [], lose: [],
            physics: { ...DEFAULT_PHYSICS },
            variables: [],
        };
        const markers = extractPreviewMarkers(this._mod ?? empty);
        const tableW = markers.tableW;
        const tableH = markers.tableH;
        const cx = w / 2;
        const cy = h * 0.42;
        const scale = Math.min((w - 32) / tableW, (h * 0.55) / tableH);
        this._view = { cx, cy, scale };

        const phys = this._mod?.physics ?? DEFAULT_PHYSICS;
        const friction = phys.tableFriction ?? 0.35;
        const felt = this._feltColor(this._mod);

        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(scale, scale);
        ctx.fillStyle = felt;
        roundRect(ctx, -tableW / 2, -tableH / 2, tableW, tableH, 18);
        ctx.fill();

        const wall = this._mod?.level?.wall?.thickness ?? 14;
        ctx.strokeStyle = '#6d4c2f';
        ctx.lineWidth = Math.max(8, wall * 0.25);
        roundRect(ctx, -tableW / 2, -tableH / 2, tableW, tableH, 18);
        ctx.stroke();

        if (friction < 0.2) {
            ctx.fillStyle = 'rgba(180, 230, 255, 0.18)';
            roundRect(ctx, -tableW / 2, -tableH / 2, tableW, tableH, 18);
            ctx.fill();
        } else if (friction > 0.55) {
            ctx.fillStyle = 'rgba(90, 60, 30, 0.22)';
            roundRect(ctx, -tableW / 2, -tableH / 2, tableW, tableH, 18);
            ctx.fill();
        }

        const pulse = 0.5 + 0.5 * Math.sin((performance.now() - this._t0) / 400);
        for (const b of this._ghostBlasts) {
            ctx.beginPath();
            ctx.arc(b.x, -b.y, b.radius, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(255, 112, 67, ${0.25 + 0.35 * pulse})`;
            ctx.lineWidth = 2;
            ctx.stroke();
        }

        for (const body of this._bodies) {
            this._drawBody(ctx, body);
        }

        if (this._dragging && this._dragFrom && this._dragTo) {
            ctx.strokeStyle = '#5ec8ff';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(this._dragFrom.x, -this._dragFrom.y);
            ctx.lineTo(this._dragTo.x, -this._dragTo.y);
            ctx.stroke();
        }

        ctx.restore();

        ctx.fillStyle = '#5ec8ff';
        ctx.font = 'bold 12px Segoe UI, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(this._playing ? 'LIVE PREVIEW' : 'PAUSED', 14, 22);
        if (this._mod?.name) {
            ctx.fillStyle = '#e8eef8';
            ctx.font = '11px Segoe UI, sans-serif';
            ctx.fillText(this._mod.name, 14, 38);
        }
        ctx.fillStyle = '#9aa8bd';
        ctx.font = '10px Consolas, monospace';
        ctx.fillText(this.parityBadge(), 14, 54);
        ctx.fillStyle = '#6bcf7f';
        ctx.font = '10px Segoe UI, sans-serif';
        ctx.fillText(this._aimEnabled ? 'Drag striker to aim · Play/Reset below' : '', 14, h - 10);
    }

    private _drawBody(ctx: CanvasRenderingContext2D, body: SimBody): void {
        const img = body.memeId ? this._memeAtlas[body.memeId] : null;
        if (img) {
            const s = body.r * 2;
            ctx.drawImage(img, body.x - body.r, -body.y - body.r, s, s);
        } else {
            ctx.beginPath();
            if (body.kind === 'block' || body.kind === 'mud') {
                ctx.rect(body.x - body.r, -body.y - body.r, body.r * 2, body.r * 2);
            } else {
                ctx.arc(body.x, -body.y, body.r * 0.45, 0, Math.PI * 2);
            }
            ctx.fillStyle = coinColor(body.kind);
            ctx.fill();
            ctx.strokeStyle = '#263238';
            ctx.lineWidth = 2;
            ctx.stroke();
        }
        if (body.label) {
            ctx.fillStyle = '#fffde7';
            ctx.font = '10px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(body.label, body.x, -body.y - body.r * 0.45 - 8);
        }
    }

    private _loop(): void {
        const now = performance.now();
        const dt = Math.min(0.033, (now - this._t0) / 1000 || this._lastDt);
        this._lastDt = dt;
        this._t0 = now;
        if (this._playing) this._step(dt);
        this.draw();
        this._raf = requestAnimationFrame(this._loop);
    }

    private _step(dt: number): void {
        const phys = this._mod?.physics ?? DEFAULT_PHYSICS;
        const damping = frictionToDamping(phys.tableFriction ?? 0.35);
        const rest = phys.restitutionScale ?? 1;
        const markers = extractPreviewMarkers(this._mod ?? {
            schemaVersion: 1, id: '', name: '', version: 0,
            graph: { blocks: [] }, pipelines: [], win: [], lose: [],
            physics: { ...DEFAULT_PHYSICS }, variables: [],
        });
        const hw = markers.tableW / 2;
        const hh = markers.tableH / 2;
        const wall = (this._mod?.level?.wall?.thickness ?? 64) * 0.5;

        for (const b of this._bodies) {
            if (b.kind === 'block' || b.kind === 'mud') continue;
            // linearDamping-ish: v *= exp(-damping * dt) ~ 1 - damping*dt for small
            const decay = Math.max(0, 1 - damping * dt * 0.35);
            b.vx *= decay;
            b.vy *= decay;
            b.x += b.vx * dt;
            b.y += b.vy * dt;

            const minX = -hw + wall + b.r * 0.45;
            const maxX = hw - wall - b.r * 0.45;
            const minY = -hh + wall + b.r * 0.45;
            const maxY = hh - wall - b.r * 0.45;
            if (b.x < minX) { b.x = minX; b.vx = Math.abs(b.vx) * rest; }
            if (b.x > maxX) { b.x = maxX; b.vx = -Math.abs(b.vx) * rest; }
            if (b.y < minY) { b.y = minY; b.vy = Math.abs(b.vy) * rest; }
            if (b.y > maxY) { b.y = maxY; b.vy = -Math.abs(b.vy) * rest; }
        }

        for (let i = 0; i < this._bodies.length; i++) {
            for (let j = i + 1; j < this._bodies.length; j++) {
                const a = this._bodies[i];
                const b = this._bodies[j];
                if (a.kind === 'mud' || b.kind === 'mud') continue;
                const ra = a.r * 0.45;
                const rb = b.r * 0.45;
                const dx = b.x - a.x;
                const dy = b.y - a.y;
                const dist = Math.hypot(dx, dy) || 0.0001;
                const minD = ra + rb;
                if (dist >= minD) continue;
                const nx = dx / dist;
                const ny = dy / dist;
                const overlap = minD - dist;
                const aStatic = a.kind === 'block';
                const bStatic = b.kind === 'block';
                if (!aStatic && !bStatic) {
                    a.x -= nx * overlap * 0.5;
                    a.y -= ny * overlap * 0.5;
                    b.x += nx * overlap * 0.5;
                    b.y += ny * overlap * 0.5;
                } else if (!aStatic) {
                    a.x -= nx * overlap;
                    a.y -= ny * overlap;
                } else if (!bStatic) {
                    b.x += nx * overlap;
                    b.y += ny * overlap;
                }
                const rvx = b.vx - a.vx;
                const rvy = b.vy - a.vy;
                const vn = rvx * nx + rvy * ny;
                if (vn > 0) continue;
                const jImp = -(1 + rest) * vn / ((aStatic ? 0 : 1) + (bStatic ? 0 : 1) || 1);
                if (!aStatic) { a.vx -= jImp * nx; a.vy -= jImp * ny; }
                if (!bStatic) { b.vx += jImp * nx; b.vy += jImp * ny; }
            }
        }
    }

    private _screenToWorld(clientX: number, clientY: number): { x: number; y: number } {
        const rect = this._canvas.getBoundingClientRect();
        const sx = clientX - rect.left;
        const sy = clientY - rect.top;
        const { cx, cy, scale } = this._view;
        return {
            x: (sx - cx) / scale,
            y: -((sy - cy) / scale),
        };
    }

    private _onPointerDown(e: PointerEvent): void {
        if (!this._aimEnabled) return;
        const w = this._screenToWorld(e.clientX, e.clientY);
        const striker = this._bodies.find((b) => b.canshot || b.kind === 'striker');
        if (!striker) return;
        const d = Math.hypot(w.x - striker.x, w.y - striker.y);
        if (d > striker.r) return;
        this._dragging = true;
        this._dragFrom = { x: striker.x, y: striker.y };
        this._dragTo = { ...w };
        this._canvas.setPointerCapture?.(e.pointerId);
    }

    private _onPointerMove(e: PointerEvent): void {
        if (!this._dragging) return;
        this._dragTo = this._screenToWorld(e.clientX, e.clientY);
    }

    private _onPointerUp(e: PointerEvent): void {
        if (!this._dragging || !this._dragFrom || !this._dragTo) {
            this._dragging = false;
            return;
        }
        const striker = this._bodies.find((b) => b.canshot || b.kind === 'striker');
        if (striker) {
            const aim = this._mod?.physics?.aimPowerScale ?? 1;
            const dx = this._dragFrom.x - this._dragTo.x;
            const dy = this._dragFrom.y - this._dragTo.y;
            striker.vx += dx * 8 * aim;
            striker.vy += dy * 8 * aim;
            this._playing = true;
        }
        this._dragging = false;
        this._dragFrom = null;
        this._dragTo = null;
        try { this._canvas.releasePointerCapture?.(e.pointerId); } catch { /* ignore */ }
    }

    private _feltColor(mod: ModConfig | null): string {
        const fromLevel = mod?.level?.table?.felt;
        const skin = mod?.pipelines
            ?.flatMap((p) => p.steps)
            ?.find((s) => s.opcode === ModOpcode.SET_TABLE_SKIN);
        const felt = String(fromLevel ?? skin?.props?.felt ?? 'table_1');
        const map: Record<string, string> = {
            table_1: '#1b5e20',
            board: '#2e7d32',
            board1: '#33691e',
            board2: '#1b5e4a',
            bg1: '#37474f',
        };
        return map[felt] ?? '#1b5e20';
    }
}

function coinColor(kind?: string): string {
    switch (kind) {
        case 'striker': return '#ffe082';
        case 'knockback': return '#ff9800';
        case 'freeze': return '#81d4fa';
        case 'flash': return '#aed581';
        case 'bomb': return '#ef5350';
        case 'block': return '#78909c';
        case 'mud': return '#a1887f';
        default: return '#eceff1';
    }
}

function roundRect(
    ctx: CanvasRenderingContext2D,
    x: number, y: number, w: number, h: number, r: number,
): void {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
}
