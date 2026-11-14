import { _decorator, CircleCollider2D, Component, Node, Vec2, Vec3, AnimationComponent, RigidBody2D, UITransform, tween } from 'cc';
import { MudController } from './MudController';
import { SoundManager } from '../SoundManager';
const { ccclass } = _decorator;

/** 爆炸参数（供静态方法和外部调用使用） */
export interface ExplosionParams {
    pushRadius: number;
    pushForce: number;
    coinGroup: Node;
    props: Node[];
    muds: Node[];
    mudPushFactor: number;
    tableWidth: number;
    tableHeight: number;
    wallThickness: number;
    /** 这次爆炸的炸弹节点本身，不参与洗牌 */
    exclude?: Node | null;
}

@ccclass('Bomb')
export class Bomb extends Component {
    /** 爆炸推力半径 */
    public pushRadius: number = 200;
    /** 爆炸推力大小 */
    public pushForce: number = 500;
    /** 硬币父节点（用于遍历） */
    public coinGroup: Node | null = null;
    /** 场上道具列表（爆炸时销毁范围内的障碍物） */
    public props: Node[] | null = null;
    /** 泥潭列表（爆炸时推开） */
    public muds: Node[] | null = null;
    /** 泥潭推力系数（相对于硬币推力的比例） */
    public mudPushFactor: number = 0.333;
    /** 桌面尺寸（用于泥潭推开后墙壁碰撞检测） */
    public tableWidth: number = 1280;
    public tableHeight: number = 720;
    public wallThickness: number = 64;
    /** 爆炸完成回调 */
    public onExplode: (() => void) | null = null;

    private _played = false;

    start() {
        const anim = this.node.getComponent(AnimationComponent);
        if (anim) {
            anim.on(AnimationComponent.EventType.FINISHED, () => {
                if (this.node.isValid) this.node.destroy();
            });
        }
    }

    /** 落地后由 _flyBomb 调用，播放爆炸动画 */
    public play() {
        if (this._played) return;
        this._played = true;
        const anim = this.node.getComponent(AnimationComponent);
        if (anim) {
            anim.play();
        }

        // 延迟 1 秒后释放推力
        tween(this.node).delay(1).call(() => {
            this._applyExplosion();
        }).start();
    }

    /** 爆炸时对范围内硬币施加径向推力，并销毁范围内的障碍物 */
    private _applyExplosion(): void {
        SoundManager.instance?.playExplosion();
        Bomb.applyExplosionAt(this.node.worldPosition, {
            pushRadius: this.pushRadius,
            pushForce: this.pushForce,
            coinGroup: this.coinGroup!,
            props: this.props || [],
            muds: this.muds || [],
            mudPushFactor: this.mudPushFactor,
            tableWidth: this.tableWidth,
            tableHeight: this.tableHeight,
            wallThickness: this.wallThickness,
        });
        if (this.onExplode) this.onExplode();
    }

    /**
     * 在指定位置执行爆炸效果（静态方法，供炸弹硬币等外部调用）
     * - 打乱场上硬币的位置（洗牌，代替原来的径向冲量）
     * - 销毁范围内障碍物（Blocker）
     * - 推开范围内泥潭（通过 MudController 设置速度）
     */
    public static applyExplosionAt(bombPos: Vec3, params: ExplosionParams): void {
        const { pushRadius, pushForce, coinGroup, props, muds, mudPushFactor } = params;
        const r2 = pushRadius * pushRadius;

        // 爆炸洗牌：随机重排所有硬币位置，不重叠、不出界
        if (coinGroup) {
            Bomb._shuffleCoins(coinGroup, props || [], params);
        }

        // 销毁范围内的障碍物（Blocker），陷阱（Mud）不受影响
        if (props) {
            for (let i = props.length - 1; i >= 0; i--) {
                const prop = props[i];
                if (!prop || !prop.isValid) continue;
                if (prop.name !== 'Blocker') continue;
                const propPos = prop.worldPosition;
                const dx = propPos.x - bombPos.x;
                const dy = propPos.y - bombPos.y;
                if (dx * dx + dy * dy > r2) continue;
                prop.destroy();
                props.splice(i, 1);
            }
        }

        // 推开范围内的泥潭（通过 MudController 设置速度，物理引擎处理墙壁碰撞）
        const VELOCITY_DIVISOR = 3000;
        if (muds) {
            for (const mud of muds) {
                if (!mud || !mud.isValid) continue;
                const mudPos = mud.worldPosition;
                const dx = mudPos.x - bombPos.x;
                const dy = mudPos.y - bombPos.y;
                const dist2 = dx * dx + dy * dy;
                if (dist2 > r2 || dist2 < 0.001) continue;

                const dist = Math.sqrt(dist2);
                const strength = 1 - dist / pushRadius;
                const nx = dx / dist;
                const ny = dy / dist;
                const velocity = (pushForce / VELOCITY_DIVISOR) * mudPushFactor * strength;

                const mc = mud.getComponent(MudController);
                if (mc) {
                    mc.setVelocity(nx * velocity, ny * velocity);
                }
            }
        }
    }

    /**
     * 爆炸洗牌：把所有仍在场上的硬币随机放到桌面内的空位。
     * - 不与其它硬币 / 障碍物 / 泥潭重叠
     * - 不超出围墙边界
     * - 清零速度，避免洗牌后继续运动
     */
    private static _shuffleCoins(coinGroup: Node, props: Node[], params: ExplosionParams): void {
        const candidates = coinGroup.children.filter((coin) =>
            !!coin && coin.isValid && coin.active
            && coin !== params.exclude
            && !!coin.getComponent(RigidBody2D),
        );
        if (candidates.length === 0) return;

        const halfW = params.tableWidth / 2;
        const halfH = params.tableHeight / 2;
        const wall = params.wallThickness;
        const gap = 8;
        const groupWorld = coinGroup.worldPosition;

        // 场上固定道具占用的位置（转换到 coinGroup 的局部坐标）
        const occupied: { x: number; y: number; r: number }[] = [];
        for (const prop of props) {
            if (!prop || !prop.isValid || !prop.active) continue;
            const p = prop.worldPosition;
            occupied.push({
                x: p.x - groupWorld.x,
                y: p.y - groupWorld.y,
                r: Bomb._nodeRadius(prop, 48),
            });
        }

        for (const coin of candidates) {
            const r = Bomb._nodeRadius(coin, 32);
            const minX = -halfW + wall + r;
            const maxX = halfW - wall - r;
            const minY = -halfH + wall + r;
            const maxY = halfH - wall - r;
            if (minX > maxX || minY > maxY) continue;

            let spot: { x: number; y: number } | null = null;

            // 随机尝试
            for (let attempt = 0; attempt < 300; attempt++) {
                const x = minX + Math.random() * (maxX - minX);
                const y = minY + Math.random() * (maxY - minY);
                if (Bomb._isFree(x, y, r, occupied, gap)) {
                    spot = { x, y };
                    break;
                }
            }

            // 随机失败时用网格兜底
            if (!spot) {
                const step = Math.max(8, r);
                outer:
                for (let y = minY; y <= maxY; y += step) {
                    for (let x = minX; x <= maxX; x += step) {
                        if (Bomb._isFree(x, y, r, occupied, gap)) {
                            spot = { x, y };
                            break outer;
                        }
                    }
                }
            }

            // 实在找不到就保留原位，避免把硬币挤出桌面
            if (!spot) {
                spot = { x: coin.position.x, y: coin.position.y };
            }

            coin.setPosition(spot.x, spot.y, 0);
            const rb = coin.getComponent(RigidBody2D);
            if (rb) {
                rb.linearVelocity = new Vec2(0, 0);
                rb.angularVelocity = 0;
            }
            occupied.push({ x: spot.x, y: spot.y, r });
        }
    }

    private static _isFree(
        x: number,
        y: number,
        r: number,
        occupied: { x: number; y: number; r: number }[],
        gap: number,
    ): boolean {
        for (const o of occupied) {
            const dx = x - o.x;
            const dy = y - o.y;
            if (dx * dx + dy * dy < (r + o.r + gap) * (r + o.r + gap)) return false;
        }
        return true;
    }

    private static _nodeRadius(node: Node, fallback: number): number {
        const collider = node.getComponent(CircleCollider2D);
        if (collider && collider.radius > 0) return collider.radius;
        const ui = node.getComponent(UITransform);
        if (ui && ui.width > 0) return ui.width / 2;
        return fallback;
    }
}