import { _decorator, Color, Node } from 'cc';
import type { GameLogic } from '../GameLogic';
import { BombCoinMarker } from '../BombCoinMarker';
import { BehaviorBase, BehaviorMode } from './BehaviorBase';
import { BehaviorRegistry } from './BehaviorRegistry';
import { BehaviorVisual, BehaviorVisualConfig } from './BehaviorVisual';

const { ccclass, property } = _decorator;

/**
 * 炸彈（主動）。
 * 被其他硬幣撞到時爆炸：對範圍內的其他硬幣施加向外的推力，越近推力越大。
 * 優先級 90，高於閃身步（80），確保被撞到時一定引爆。
 */
@ccclass('BombBehavior')
export class BombBehavior extends BehaviorBase {
    public priority = 100;
    public mode: BehaviorMode = 'dominant';
    public exclusive = true;

    @property({ tooltip: '爆炸推力半徑（像素；0 = 使用 config.json 的 bombPushRadius）' })
    public range = 0;

    @property({ tooltip: '爆炸推力大小（0 = 使用 config.json 的 bombPushForce）' })
    public force = 0;

    /** 同一次撞擊可能回報多次接觸，短時間內只炸一次。 */
    private static readonly COOLDOWN_MS = 250;
    private _cooldownUntil = 0;

    protected start(): void {
        //BehaviorVisual.startIdle(this.node, this.getVisualConfig());
    }

    public getVisualConfig(): BehaviorVisualConfig {
        return {
            color: new Color(255, 90, 60, 255),
            label: 'BOOM!',
            idlePulse: false,
        };
    }

    public tryFire(self: Node, other: Node, gl: GameLogic): boolean {
        if (Date.now() < this._cooldownUntil) return false;
        // 只有被硬幣撞到才引爆，撞牆不算
        if (!other.getComponent('CoinController') && !other.getComponent(BombCoinMarker)) {
            return false;
        }

        this._explode(self, gl);
        this._cooldownUntil = Date.now() + BombBehavior.COOLDOWN_MS;
        this._fireVisual(self);
        return true;
    }

    /**
     * 執行與 Effects/Bomb 相同的爆炸效果：
     * 爆炸動畫 + 音效 + 徑向推力（推開硬幣、推開泥潭、炸毀範圍內的 blocker）。
     * 爆炸 2 秒後提示遊戲失敗。
     */
    private _explode(self: Node, gl: GameLogic): void {
        // 0 表示沿用 config.json 裡道具炸彈的參數，保證能推開硬幣
        const radius = this.range > 0 ? this.range : gl.bombPushRadius;
        const force = this.force > 0 ? this.force : gl.bombPushForce;

        gl.explodeAt(self.worldPosition, radius, force);
        gl.requestGameOver(2);
    }
}

BehaviorRegistry.register('BombBehavior', BombBehavior);
