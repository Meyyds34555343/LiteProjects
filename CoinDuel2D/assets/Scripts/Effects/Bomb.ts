import { _decorator, Component, Node, Vec2, Vec3, AnimationComponent, RigidBody2D, tween } from 'cc';
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
     * - 推开范围内硬币（径向冲量，线性衰减）
     * - 销毁范围内障碍物（Blocker）
     * - 推开范围内泥潭（通过 MudController 设置速度）
     */
    public static applyExplosionAt(bombPos: Vec3, params: ExplosionParams): void {
        const { pushRadius, pushForce, coinGroup, props, muds, mudPushFactor } = params;
        const r2 = pushRadius * pushRadius;

        // 对范围内硬币施加推力
        if (coinGroup) {
            for (const coin of coinGroup.children) {
                // 已掉出桌面并隐藏的硬币不再接受爆炸推力
                if (!coin.active) continue;
                const rb = coin.getComponent(RigidBody2D);
                if (!rb) continue;
                const coinPos = coin.worldPosition;
                const dx = coinPos.x - bombPos.x;
                const dy = coinPos.y - bombPos.y;
                const dist2 = dx * dx + dy * dy;
                if (dist2 > r2 || dist2 < 0.001) continue;

                const dist = Math.sqrt(dist2);
                const strength = 1 - dist / pushRadius;
                const nx = dx / dist;
                const ny = dy / dist;
                rb.applyLinearImpulseToCenter(
                    new Vec2(nx * pushForce * strength, ny * pushForce * strength),
                    true,
                );
            }
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
}