import { resources, JsonAsset } from 'cc';
import { StorageManager } from './StorageManager';

/**
 * 游戏数据读取器 — 优先读取 AssetSyncManager 写入的 serverdata 缓存，失败时回退到内置 Resources
 *
 * 路径规则与 resources.load 一致（可省略 .json）：
 * - 'levels'   → 关卡列表
 * - 'levels/1' → 单个关卡数据
 * - 'config'   → 游戏配置
 */
export class DataProvider {
    /**
     * 加载 JSON 数据
     * @param path 数据路径（与 resources.load 路径一致，可省略 .json）
     * @param cb 回调：err 为 null 表示成功，data 为解析后的对象
     */
    public static loadJson(path: string, cb: (err: Error | null, data: object | null) => void): void {
        const rel = path.endsWith('.json') ? path : path + '.json';
        const filePath = StorageManager.getCachePath(rel);
        StorageManager.readJsonFile(filePath, (err, data) => {
            if (!err && data) {
                cb(null, data);
                return;
            }
            // serverdata 中没有或读取失败，回退到内置 Resources
            resources.load(path.replace(/\.json$/, ''), JsonAsset, (loadErr, asset) => {
                if (loadErr || !asset) {
                    cb(loadErr ?? new Error('加载数据失败: ' + path), null);
                    return;
                }
                cb(null, asset.json as object);
            });
        });
    }
}
