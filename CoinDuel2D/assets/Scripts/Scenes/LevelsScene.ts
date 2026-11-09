import { _decorator, Component, Node, instantiate, Prefab, Label, Button, director } from 'cc';
import { LevelManager } from '../LevelManager';
import { LevelData, LevelState } from '../LevelData';
import { DataProvider } from '../DataProvider';
import { UILevelItem } from '../UI/UILevelItem';
import { SoundManager } from '../SoundManager';
import { AssetSyncManager } from '../Meme/AssetSyncManager';
const { ccclass, property } = _decorator;

@ccclass('LevelsScene')
export class LevelsScene extends Component {
    @property(Prefab)
    levelButtonPrefab: Prefab = null!;
    @property(Button)
    backButton: Button = null!;

    @property(Node)
    levelsContainer: Node = null!;

    private _levelFiles: string[] = [];
    private _sync: AssetSyncManager | null = null;

    private _loadLevelAndGo(levelFile: string, index: number): void {
        // 只有 Unlocked 状态的关卡才能进入
        const state = LevelManager.getLevelState(index);
        if (state === LevelState.Locked) return;

        const path = LevelManager.toDataPath(levelFile);
        DataProvider.loadJson(path, (err, data) => {
            if (err) {
                console.error(`Failed to load ${path}:`, err);
                return;
            }
            const levelData = data as LevelData;
            LevelManager.setLevelList(this._levelFiles, index);
            LevelManager.setCurrent(levelData);
            director.loadScene('game');
        });
    }

    onLoad(){
        this.backButton.node.on(Button.EventType.CLICK, () => {
            director.loadScene('main');
        });
    }

    start() {
        this.loadLevels();
        SoundManager.instance?.stopBGM();
    }

    /** 刷新所有关卡项的显示状态 */
    private _refreshLevelStates(): void {
        const states = LevelManager.getLevelStates();
        for (let i = 0; i < this.levelsContainer.children.length; i++) {
            const child = this.levelsContainer.children[i];
            const item = child.getComponent(UILevelItem);
            if (item) {
                item.setLevel(i + 1, states[i] ?? LevelState.Locked);
            }
        }
    }

    loadLevels() {
        // 優先從本地資產庫（manifest 同步結果）讀取關卡目錄
        let manager = AssetSyncManager.instance;
        if (!manager || !manager.isValid) {
            manager = this.node.getComponent(AssetSyncManager)
                ?? this.node.addComponent(AssetSyncManager);
        }
        const sync: AssetSyncManager = manager;
        this._sync = sync;

        sync.whenReady(() => {
            const cached = sync.listCachedLevelFiles();
            if (cached.length > 0) {
                console.log('[Levels] 使用本地資產庫關卡:', cached.length);
                this._renderLevels(cached);
                return;
            }
            console.log('[Levels] 本地資產庫沒有關卡，回退 levels.json');
            DataProvider.loadJson('levels', (err, data) => {
                if (err) {
                    console.error('Failed to load levels.json:', err);
                    return;
                }
                const list = data as { levels: string[] };
                this._renderLevels(list.levels ?? []);
            });
        });
    }

    private _renderLevels(files: string[]): void {
        this._levelFiles = files;

        // 初始化关卡状态（第一个自动解锁）
        LevelManager.setLevelList(files, 0);

        for (let i = 0; i < files.length; i++) {
            const levelFile = files[i];
            const btn = instantiate(this.levelButtonPrefab);
            // 顯示關卡 JSON 裡的 id；回退 levels.json 時用檔名（去掉路徑與 .json）
            const levelId = this._sync?.getLevelIdForFile(levelFile) ?? null;
            const name = levelId != null
                ? String(levelId)
                : levelFile.replace(/^.*[\\/]/, '').replace(/\.json$/i, '');
            // Node 名稱不能包含 '/'，保險再清理一次
            btn.name = name.replace(/[\\/]/g, '_');
            this.levelsContainer.addChild(btn);

            const idx = i;

            // 使用 UILevelItem 设置关卡编号和状态
            const item = btn.getComponent(UILevelItem);
            if (item) {
                item.setLevel(idx + 1, LevelManager.getLevelState(idx));
            } else {
                // 兼容：没有 UILevelItem 时回退到 Label 设置
                const labelNode = btn.getChildByName('Label');
                if (labelNode) {
                    const label = labelNode.getComponent(Label);
                    if (label) label.string = `${i + 1}`;
                }
            }

            const button = btn.getComponent(Button);
            if (button) {
                btn.on(Button.EventType.CLICK, () => {
                    this._loadLevelAndGo(levelFile, idx);
                }, this);
            }
        }
    }

    /** 从 GameScene 返回时刷新关卡状态 */
    onEnable() {
        if (this.levelsContainer.children.length > 0) {
            this._refreshLevelStates();
        }
    }
}
