import { Node } from 'cc';
import type { GameLogic } from '../GameLogic';
import { BehaviorBase } from './BehaviorBase';

/**
 * 碰撞時只讓優先級最高的主動行為開火。
 * 被動行為不參加這次裁決，改由 tick 每幀呼叫。
 */
export class BehaviorResolver {
    /** 回傳 true 代表某個主動行為已消費這次碰撞。 */
    public static resolveContact(nodeA: Node, nodeB: Node, gl: GameLogic): boolean {
        const pickA = BehaviorResolver._dominant(nodeA);
        const pickB = BehaviorResolver._dominant(nodeB);
        if (!pickA && !pickB) return false;

        let winner: BehaviorBase;
        let self: Node;
        let other: Node;

        if (pickA && pickB) {
            if (pickA.behavior.priority >= pickB.behavior.priority) {
                winner = pickA.behavior;
                self = nodeA;
                other = nodeB;
            } else {
                winner = pickB.behavior;
                self = nodeB;
                other = nodeA;
            }
        } else if (pickA) {
            winner = pickA.behavior;
            self = nodeA;
            other = nodeB;
        } else {
            winner = pickB!.behavior;
            self = nodeB;
            other = nodeA;
        }

        return winner.tryFire(self, other, gl);
    }

    public static tick(dt: number, gl: GameLogic): void {
        const coins = gl.coinGroup?.children;
        if (!coins) return;

        for (const coin of coins) {
            // 掉落后隐藏的硬币不参与被动行为 tick
            if (!coin.active) continue;
            const behaviors = coin.getComponents(BehaviorBase);
            for (const behavior of behaviors) {
                if (!behavior.enabled || behavior.mode !== 'passive') continue;
                behavior.onTick(dt, gl);
            }
        }
    }

    private static _dominant(node: Node): { behavior: BehaviorBase } | null {
        const behaviors = node.getComponents(BehaviorBase);
        let best: BehaviorBase | null = null;
        for (const behavior of behaviors) {
            if (!behavior.enabled || behavior.mode !== 'dominant') continue;
            if (!best || behavior.priority > best.priority) best = behavior;
        }
        return best ? { behavior: best } : null;
    }
}
