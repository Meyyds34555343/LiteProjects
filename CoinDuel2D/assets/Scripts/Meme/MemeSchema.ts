/**
 * Asset / Meme 生產管線的資料契約。
 * 遠端 manifest、MemeConfig、LevelConfig 都依此解析，避免再送審才能換內容。
 */

/** manifest 單筆：filename + hash，可選絕對／相對 URL。 */
export interface ManifestItem {
    filename: string;
    hash: string;
    /** 缺省時依 filename 相對 manifest 目錄解析 */
    url?: string;
    /** 資源類型；缺省由副檔名推斷 */
    kind?: 'meme' | 'level' | 'texture' | 'audio' | 'json' | 'mod';
}

/** 遠端總清單。可掛 memeConfig / levelConfig / modConfig 入口，或把各檔列在 items。 */
export interface AssetManifest {
    version: number;
    baseUrl?: string;
    items: ManifestItem[];
    /** 指向 MemeConfig 陣列或 { memes: MemeConfig[] } 的 JSON */
    memeConfig?: string;
    /** 指向 LevelConfig 陣列或單一關卡 JSON */
    levelConfig?: string;
    /** 指向 ModConfig（視覺腳本／沙盒規則）JSON */
    modConfig?: string;
}

/** 五態貼圖路徑（遠端 URL 或相對 path）。 */
export interface MemeTextureSet {
    default?: string;
    idle?: string;
    aim?: string;
    shot?: string;
    hitted?: string;
}

/** 單一 Meme 的行為與外觀。 */
export interface MemeConfig {
    id: string;
    hash?: string;
    behavior?: string;
    behaviors?: string[];
    radius?: number;
    textures: MemeTextureSet;
    shotSfx?: string;
    hittedSfx?: string;
}

/**
 * Skin ref：preset key（coin_1 / gold）、Resources 路徑、http(s) URL、或 data:image Base64。
 * 執行期由 DynamicAssetLoader 熱載，不需重編場景。
 */
export type SkinRef = string;

/** 單幣／五態熱換皮。任一欄可為 preset / URL / Base64。 */
export interface CoinSkinConfig {
    /** 快捷：套用 PRESET_COIN_SKINS[key]；可再被下列欄位覆寫 */
    preset?: string;
    default?: SkinRef;
    idle?: SkinRef;
    aim?: SkinRef;
    shot?: SkinRef;
    hitted?: SkinRef;
    /** 發射／受擊音效：preset / URL / Base64 */
    shotSfx?: SkinRef;
    hittedSfx?: SkinRef;
}

/** 桌面／圍牆熱換皮（世界空間節點，不改 Canvas HUD）。 */
export interface TableConfig {
    /** 桌布 preset 或 URL / Base64 */
    felt?: SkinRef;
    /** 圍牆貼圖 */
    wall?: SkinRef;
    /** 角落貼圖（可選） */
    corner?: SkinRef;
    /** 桌面平鋪顏色乘算（#RRGGBB，可選） */
    tint?: string;
}

/** 關卡裡一枚可射／目標硬幣。 */
export interface CoinConfig {
    type?: 'coin';
    x: number;
    y: number;
    /** 是否允許本局作為出手幣；缺省 true */
    canshot?: boolean;
    /** 行為 id 陣列，例如 FreezeBehavior */
    behaviors?: string[];
    /** 綁定的 Meme id，用來套五態貼圖 */
    memeId?: string;
    /** 直接熱換皮（優先於／疊加 memeId） */
    skin?: CoinSkinConfig;
    /** 快捷：等同 skin.preset */
    skinKey?: string;
    class?: number;
    radius?: number;
}

export interface LevelBlockConfig {
    type: 'block';
    x: number;
    y: number;
    shape?: string;
    radius: number;
    path?: { x: number; y: number }[];
}

export interface LevelMudConfig {
    type: 'mud';
    x: number;
    y: number;
    shape?: string;
    radius: number;
    friction?: number;
}

export interface LevelBombConfig {
    type: 'bomb';
    class?: number;
    x: number;
    y: number;
    radius?: number;
    behaviors?: string[];
}

export type LevelItemConfig = CoinConfig | LevelBlockConfig | LevelMudConfig | LevelBombConfig;

/** 遠端／本地關卡。相容舊 LevelData，並支援 canshot / behaviors / skins。 */
export interface LevelConfig {
    id: number;
    width: number;
    height: number;
    wall: { thickness: number };
    /** 桌面熱換皮 */
    table?: TableConfig;
    coins: LevelItemConfig[];
}

/** localStorage 裡快取的 hash 對照表。 */
export interface CachedHashMap {
    version: number;
    hashes: Record<string, string>;
}

export function isCoinConfig(item: LevelItemConfig): item is CoinConfig {
    return !item.type || item.type === 'coin';
}
