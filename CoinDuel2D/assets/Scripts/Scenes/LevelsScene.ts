import { _decorator, Component, Node, instantiate, Prefab, Label, Button, director, UITransform } from 'cc';
import { LevelManager } from '../LevelManager';
import { LevelData, LevelState } from '../LevelData';
import { DataProvider } from '../DataProvider';
import { UIStageItem } from '../UI/UIStageItem';
import { SoundManager } from '../SoundManager';
import { CampaignProgress } from '../Campaign/CampaignProgress';
import { CdnLevelSource } from '../Campaign/CdnLevelSource';

const { ccclass, property } = _decorator;

/**
 * Stage select (闖關模式).
 *
 * Responsibilities:
 *  - build the grid from `levels.json`
 *  - translate campaign progress (stars / best score) into lock states
 *  - reload states every time the scene is re-enabled (after a win / retry)
 *
 * Uses `UIStageItem` when present on the prefab, otherwise falls back to the
 * legacy `UILevelItem` / plain Label so old prefabs keep working.
 */
@ccclass('LevelsScene')
export class LevelsScene extends Component {
    @property(Prefab)
    levelButtonPrefab: Prefab = null!;

    @property(Button)
    backButton: Button = null!;

    @property(Node)
    levelsContainer: Node = null!;

    /**
     * Columns in the grid. The scroll content is 640px wide and each cell is
     * 160px, so 4 columns fill it exactly without horizontal scrolling.
     */
    @property
    public columns: number = 4;

    /** Horizontal / vertical spacing between stage buttons (prefab is 128x128). */
    @property
    public cellSpacingX: number = 160;
    @property
    public cellSpacingY: number = 168;

    private _levelFiles: string[] = [];
    private _items: Node[] = [];
    private _built = false;

    private _loadLevelAndGo(levelFile: string, index: number): void {
        // Campaign stages: unlock rule comes from saved stars, not raw index.
        const stageId = index + 1;
        if (!CampaignProgress.isUnlocked(stageId)) {
            return;
        }

        const go = (levelData: LevelData) => {
            LevelManager.setLevelList(this._levelFiles, index);
            LevelManager.setCurrent(levelData);
            director.loadScene('game');
        };

        // CDN wins when the web editor has saved this stage (no rebuild needed).
        CdnLevelSource.load(stageId, (remote) => {
            if (remote) {
                go(remote);
                return;
            }
            const path = 'levels/' + levelFile.replace('.json', '');
            DataProvider.loadJson(path, (err, data) => {
                if (err) {
                    console.error(`Failed to load ${path}:`, err);
                    return;
                }
                go(data as LevelData);
            });
        });
    }

    onLoad(): void {
        if (this.backButton?.node) {
            this.backButton.node.on(Button.EventType.CLICK, () => {
                director.loadScene('main');
            });
        }
    }

    start(): void {
        this.loadLevels();
        SoundManager.instance?.stopBGM();
    }

    /** Re-apply lock / star visuals (cheap; no re-instantiation). */
    private _refreshLevelStates(): void {
        for (let i = 0; i < this._items.length; i++) {
            const node = this._items[i];
            if (!node?.isValid) continue;
            const stageId = i + 1;
            const state = CampaignProgress.getStars(stageId) > 0
                ? LevelState.Passed
                : (CampaignProgress.isUnlocked(stageId) ? LevelState.Unlocked : LevelState.Locked);

            const stageItem = node.getComponent(UIStageItem) ?? node.addComponent(UIStageItem);
            stageItem.setStage(stageId, state);
        }
    }

    loadLevels(): void {
        if (this._built) {
            this._refreshLevelStates();
            return;
        }
        DataProvider.loadJson('levels', (err, data) => {
            if (err) {
                console.error('Failed to load levels.json:', err);
                return;
            }
            const list = data as { levels: string[] };
            this._levelFiles = list.levels;

            // Initialize LevelManager states, then overlay campaign progress.
            LevelManager.setLevelList(this._levelFiles, 0);
            CampaignProgress.applyToLevelManager();

            // Clear any previous instances (scene reload safety).
            this.levelsContainer.removeAllChildren();
            this._items = [];

            const total = list.levels.length;
            const cols = Math.max(1, this.columns);
            const rows = Math.ceil(total / cols);
            const contentHeight = Math.max(0, (rows - 1) * this.cellSpacingY);
            const startY = contentHeight / 2;

            for (let i = 0; i < total; i++) {
                const levelFile = list.levels[i];
                const btn = instantiate(this.levelButtonPrefab);
                btn.name = levelFile;
                this.levelsContainer.addChild(btn);

                // Grid placement keeps the scroll content vertically centred.
                const col = i % cols;
                const row = Math.floor(i / cols);
                const rowCount = (row === rows - 1) ? (total - row * cols) : cols;
                const x = (col - (rowCount - 1) / 2) * this.cellSpacingX;
                const y = startY - row * this.cellSpacingY;
                btn.setPosition(x, y, 0);

                const stageId = i + 1;
                const state = CampaignProgress.getStars(stageId) > 0
                    ? LevelState.Passed
                    : (CampaignProgress.isUnlocked(stageId) ? LevelState.Unlocked : LevelState.Locked);

                // Self-attach on the instantiated button: no prefab editing needed.
                const stageItem = btn.getComponent(UIStageItem) ?? btn.addComponent(UIStageItem);
                stageItem.setStage(stageId, state);

                const button = btn.getComponent(Button);
                if (button) {
                    const idx = i;
                    btn.on(Button.EventType.CLICK, () => {
                        this._loadLevelAndGo(levelFile, idx);
                    }, this);
                }

                this._items.push(btn);
            }

            // Scroll content must grow to fit the new rows.
            const contentTransform = this.levelsContainer.getComponent(UITransform);
            if (contentTransform) {
                const colsWidth = cols * this.cellSpacingX;
                contentTransform.setContentSize(
                    Math.max(contentTransform.width, colsWidth),
                    Math.max(contentTransform.height, contentHeight + this.cellSpacingY),
                );
            }

            this._built = true;
        });
    }

    /** Returning from GameScene: refresh locks + stars immediately. */
    onEnable(): void {
        if (this._built) {
            CampaignProgress.applyToLevelManager();
            this._refreshLevelStates();
        }
    }
}
