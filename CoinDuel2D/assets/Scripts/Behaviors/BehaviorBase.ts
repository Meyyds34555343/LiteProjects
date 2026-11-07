import { _decorator, Component, Node } from 'cc';
import type { GameLogic } from '../GameLogic';
import { BehaviorVisual, BehaviorVisualConfig } from './BehaviorVisual';

const { ccclass, property } = _decorator;

/** 主動行為在碰撞時互斥；被動行為每幀疊加。 */
export type BehaviorMode = 'dominant' | 'passive';

/**
 * 硬幣行為基底。
 * 具體行為覆寫 tryFire（主動）或 onTick（被動）。
 * 生命週期只用 Cocos 的 onLoad / start，不要用 onStart。
 */
@ccclass('BehaviorBase')
export class BehaviorBase extends Component {
    /** 數字越大越優先。兩枚硬幣碰撞時，只讓優先級高的主動行為開火。 */
    @property
    public priority: number = 0;

    public mode: BehaviorMode = 'passive';

    /** 為 true 時，同一枚硬幣只保留這一個主動行為。 */
    public exclusive: boolean = false;

    protected onLoad(): void {
        if (this.mode !== 'dominant' || !this.exclusive) return;

        const behaviors = this.node.getComponents(BehaviorBase);
        for (const other of behaviors) {
            if (other !== this && other.mode === 'dominant') {
                other.destroy();
            }
        }
    }

    /** 碰撞裁決勝出後呼叫。回傳 true 代表已消費這次碰撞。 */
    public tryFire(_self: Node, _other: Node, _gl: GameLogic): boolean {
        return false;
    }

    /** 被動行為每幀呼叫。主動行為不要在這裡改物理。 */
    public onTick(_dt: number, _gl: GameLogic): void {}

    public getVisualConfig(): BehaviorVisualConfig {
        return {
            color: null,
            label: '',
            idlePulse: false,
        };
    }

    protected _fireVisual(node: Node): void {
        BehaviorVisual.playFire(node, this.getVisualConfig());
    }

    /** 重新套上行為顏色。硬幣指示器會把顏色刷回白色，所以操作開關後要再塗一次。 */
    public showIdleVisual(): void {
        const config = this.getVisualConfig();
        if (!config.color) return;
        BehaviorVisual.startIdle(this.node, config);
    }
}
