import { Node } from 'cc';
import { BehaviorBase } from './BehaviorBase';

type BehaviorCtor = new () => BehaviorBase;

/**
 * 字串 id → 行為類別。
 * 每個具體行為在檔案底部呼叫 BehaviorRegistry.register。
 */
export class BehaviorRegistry {
    private static readonly _ctors = new Map<string, BehaviorCtor>();

    public static register(id: string, ctor: BehaviorCtor): void {
        BehaviorRegistry._ctors.set(id, ctor);
    }

    public static has(id: string): boolean {
        return BehaviorRegistry._ctors.has(id);
    }

    public static attach(node: Node, id: string): BehaviorBase | null {
        const Ctor = BehaviorRegistry._ctors.get(id);
        if (!Ctor) {
            console.warn(`[BehaviorRegistry] 找不到行為: ${id}`);
            return null;
        }
        const existing = node.getComponent(Ctor);
        if (existing) return existing;
        return node.addComponent(Ctor);
    }
}
