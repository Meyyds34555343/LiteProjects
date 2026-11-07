import { _decorator, Component, Node, instantiate, Prefab, Label, Button, director } from 'cc';
import { LevelManager } from '../LevelManager';
import { LevelData, LevelState } from '../LevelData';
import { DataProvider } from '../DataProvider';
import { UILevelItem } from '../UI/UILevelItem';
import { SoundManager } from '../SoundManager';
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

    private _loadLevelAndGo(levelFile: string, index: number): void {
        // 只有 Unlocked 状态的关卡才能进入
        const state = LevelManager.getLevelState(index);
        if (state === LevelState.Locked) return;

        const path = 'levels/' + levelFile.replace('.json', '');
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
        DataProvider.loadJson('levels', (err, data) => {
            if (err) {
                console.error('Failed to load levels.json:', err);
                return;
            }
            const list = data as { levels: string[] };
            this._levelFiles = list.levels;

            // 初始化关卡状态（第一个自动解锁）
            LevelManager.setLevelList(this._levelFiles, 0);

            for (let i = 0; i < list.levels.length; i++) {
                const levelFile = list.levels[i];
                const btn = instantiate(this.levelButtonPrefab);
                btn.name = levelFile;
                this.levelsContainer.addChild(btn);

                const idx = i;

                // 使用 UILevelItem 设置关卡编号和状态
                const item = btn.getComponent(UILevelItem);
                if (item) {
                    const state = LevelManager.getLevelState(idx);
                    item.setLevel(idx + 1, state);
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
        });
    }

    /** 从 GameScene 返回时刷新关卡状态 */
    onEnable() {
        if (this.levelsContainer.children.length > 0) {
            this._refreshLevelStates();
        }
    }
}
