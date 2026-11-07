import type { CoinSkinConfig, TableConfig } from './Meme/MemeSchema';

/** 关卡配置数据接口（对应 LevelEditor 导出的 JSON 格式） */
export interface LevelCoinData {
    type: 'coin';
    /** 硬币类型（对应 memes.json 中 coins 的 key） */
    class: number;
    x: number;
    y: number;
    /** 是否可作為出手幣；缺省 true */
    canshot?: boolean;
    /** 行為 id 列表，例如 FreezeBehavior */
    behaviors?: string[];
    /** 遠端 Meme id，由 AssetSyncManager 套五態貼圖 */
    memeId?: string;
    /** 熱換皮：preset / URL / Base64 */
    skin?: CoinSkinConfig;
    skinKey?: string;
    radius?: number;
}

export interface LevelBlockData {
    type: 'block';
    x: number;
    y: number;
    shape: string;
    radius: number;
    /** 移动路径（可选），每帧沿路径循环移动 */
    path?: { x: number; y: number }[];
}

export interface LevelMudData {
    type: 'mud';
    x: number;
    y: number;
    shape: string;
    radius: number;
    friction: number;
}

export interface LevelBombData {
    type: 'bomb';
    /** 硬币外观类型（对应 memes.json 中 coins 的 key） */
    class: number;
    x: number;
    y: number;
    radius: number;
}

/** 关卡条目：通过 type 字段区分硬币/障碍物/陷阱/炸弹硬币 */
export type LevelItemData = LevelCoinData | LevelBlockData | LevelMudData | LevelBombData;

export interface LevelData {
    id: number;
    width: number;
    height: number;
    wall: { thickness: number };
    /** 桌面／圍牆熱換皮 */
    table?: TableConfig;
    /** 所有条目（硬币/障碍物/陷阱），按 type 字段区分 */
    coins: LevelItemData[];
}

export enum LevelState {
    Locked = 1,
    Unlocked = 2,
    Passed = 3,
}
