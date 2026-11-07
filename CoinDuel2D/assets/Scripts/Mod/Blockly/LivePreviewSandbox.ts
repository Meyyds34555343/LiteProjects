/**
 * Lightweight HTML5 canvas sandbox — visualizes ModConfig level + physics
 * for the Blockly live-preview sidebar (browser host only).
 */

import { ModConfig, ModOpcode } from '../ModConfigSchema';

export interface LivePreviewMarkers {
    coins: { x: number; y: number; label?: string; kind?: string }[];
    blasts: { x: number; y: number; radius: number }[];
    impulses: { x: number; y: number; ix: number; iy: number }[];
    tableW: number;
    tableH: number;
}

/** Extract placement / physics markers from compiled ModConfig. */
export function extractPreviewMarkers(mod: ModConfig): LivePreviewMarkers {
    const coins: LivePreviewMarkers['coins'] = [];
    const blasts: LivePreviewMarkers['blasts'] = [];
    const impulses: LivePreviewMarkers['impulses'] = [];
    const tableW = mod.level?.width ?? 800;
    const tableH = mod.level?.height ?? 600;

    // Prefer Scratch level layout blocks
    if (mod.level?.coins?.length) {
        for (const item of mod.level.coins) {
            const type = String(item.type ?? 'coin');
            const x = Number(item.x ?? 0);
            const y = Number(item.y ?? 0);
            let label = type;
            let kind = type;
            if (type === 'coin') {
                const canshot = item.canshot !== false;
                const beh = Array.isArray(item.behaviors) ? String(item.behaviors[0] ?? '') : String(item.behavior ?? '');
                if (canshot) { label = 'striker'; kind = 'striker'; }
                else if (beh.includes('Knock')) { label = 'knock'; kind = 'knockback'; }
                else if (beh.includes('Freeze')) { label = 'ice'; kind = 'freeze'; }
                else if (beh.includes('Flash')) { label = 'flash'; kind = 'flash'; }
                else { label = 'target'; kind = 'target'; }
            }
            coins.push({ x, y, label, kind });
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
        coins.push({ x: -120, y: 0, label: 'striker', kind: 'striker' });
        coins.push({ x: 80, y: 40, label: 'target', kind: 'target' });
        coins.push({ x: 140, y: -30, label: 'target', kind: 'target' });
    }
    return { coins, blasts, impulses, tableW, tableH };
}

export class LivePreviewSandbox {
    private _canvas: HTMLCanvasElement;
    private _ctx: CanvasRenderingContext2D;
    private _mod: ModConfig | null = null;
    private _raf = 0;
    private _t0 = performance.now();

    constructor(canvas: HTMLCanvasElement) {
        this._canvas = canvas;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('[LivePreview] 2d context unavailable');
        this._ctx = ctx;
        this._loop = this._loop.bind(this);
        this._raf = requestAnimationFrame(this._loop);
    }

    public setMod(mod: ModConfig | null): void {
        this._mod = mod;
        this.draw();
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
        this._mod = null;
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
            physics: { tableFriction: 0.35, restitutionScale: 1, enableTimeReversePenalty: true, aimPowerScale: 1 },
            variables: [],
        };
        const markers = extractPreviewMarkers(this._mod ?? empty);
        const tableW = markers.tableW;
        const tableH = markers.tableH;
        const cx = w / 2;
        const cy = h * 0.42;
        const scale = Math.min((w - 32) / tableW, (h * 0.55) / tableH);

        const phys = this._mod?.physics;
        const friction = phys?.tableFriction ?? 0.35;
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

        for (const b of markers.blasts) {
            ctx.beginPath();
            ctx.arc(b.x, -b.y, b.radius, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(255, 112, 67, ${0.25 + 0.35 * pulse})`;
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.fillStyle = `rgba(255, 112, 67, ${0.08 + 0.06 * pulse})`;
            ctx.fill();
        }

        for (const imp of markers.impulses) {
            const len = Math.min(80, Math.hypot(imp.ix, imp.iy) * 0.05 + 20);
            const ang = Math.atan2(-imp.iy, imp.ix);
            ctx.strokeStyle = '#ce93d8';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(imp.x, -imp.y);
            ctx.lineTo(imp.x + Math.cos(ang) * len, -imp.y + Math.sin(ang) * len);
            ctx.stroke();
        }

        for (const c of markers.coins) {
            ctx.beginPath();
            const r = c.kind === 'block' || c.kind === 'mud' ? 18 : 14;
            if (c.kind === 'block') {
                ctx.rect(c.x - r, -c.y - r, r * 2, r * 2);
            } else {
                ctx.arc(c.x, -c.y, r, 0, Math.PI * 2);
            }
            ctx.fillStyle = coinColor(c.kind);
            ctx.fill();
            ctx.strokeStyle = '#263238';
            ctx.lineWidth = 2;
            ctx.stroke();
            if (c.label) {
                ctx.fillStyle = '#fffde7';
                ctx.font = '10px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(c.label, c.x, -c.y - 20);
            }
        }

        ctx.restore();

        ctx.fillStyle = '#9aa8bd';
        ctx.font = '12px Segoe UI, sans-serif';
        ctx.textAlign = 'left';
        const lines = [
            `table      ${tableW}×${tableH}`,
            `objects   ${markers.coins.length}`,
            `μ friction  ${friction.toFixed(2)}`,
            `pipelines   ${this._mod?.pipelines?.length ?? 0}`,
            `win         ${(this._mod?.win ?? []).map((w) => w.type.replace(/_/g, ' ')).join(', ') || '—'}`,
        ];
        let ty = h - 16 - lines.length * 16;
        ctx.fillStyle = 'rgba(15, 19, 26, 0.72)';
        roundRect(ctx, 8, ty - 12, w - 16, lines.length * 16 + 20, 8);
        ctx.fill();
        ctx.fillStyle = '#c5d0e0';
        for (const line of lines) {
            ctx.fillText(line, 16, ty + 4);
            ty += 16;
        }

        ctx.fillStyle = '#5ec8ff';
        ctx.font = 'bold 12px Segoe UI, sans-serif';
        ctx.fillText('LIVE PREVIEW', 14, 22);
        if (this._mod?.name) {
            ctx.fillStyle = '#e8eef8';
            ctx.font = '11px Segoe UI, sans-serif';
            ctx.fillText(this._mod.name, 14, 38);
        }
    }

    private _loop(): void {
        this.draw();
        this._raf = requestAnimationFrame(this._loop);
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
