import { _decorator, assetManager, AudioSource, Component, instantiate, Node, Prefab, Input, input, KeyCode, EventKeyboard, UITransform, CircleCollider2D, resources, SpriteFrame, AudioClip, Color, director, Label } from 'cc';
import { BombCoinMarker } from '../BombCoinMarker';
import { I18n } from '../I18n';
import { RoundManager } from '../RoundManager';
import { GameLogic } from '../GameLogic';
import { UIManager } from '../UIManager';
import { TableController } from '../TableController';
import { CoinController } from '../CoinController';
import { SoundManager } from '../SoundManager';
import { LevelManager } from '../LevelManager';
import { LevelData } from '../LevelData';
import { ConfigManager } from '../ConfigManager';
import { DataProvider } from '../DataProvider';
import { HitEffectManager } from '../HitEffectManager';
import { Leaderboard } from '../Leaderboard';
import { TutorialManager, TutorialStep } from '../TutorialManager';
import { AssetSyncManager } from '../Meme/AssetSyncManager';
import { ModAutoBoot } from '../Mod/ModAutoBoot';
import { DEFAULT_CDN_MANIFEST_URL } from '../Meme/CdnConfig';

const { ccclass, property } = _decorator;

export enum GameMode{
    Level = 0,
    Ladder, // 天梯模式（随机关卡）
}

/** 统一教程配置：key 为关卡索引（0-based），intro 和 drag 步骤可混排 */
const TUTORIAL_CONFIG: Record<number, TutorialStep[]> = {
    // 暂时关闭教程
    // 0: [
    //     { type: 'drag', hintKey: 'tutorial_step_1', sourceCoinIndex: 0, targetCoinIndex: 1 },
    //     { type: 'drag', hintKey: 'tutorial_step_2', sourceCoinIndex: 1, targetCoinIndex: 2, isFinal: true },
    // ],
    // 1: [
    //     // 第二关：block/mud 介绍由 _buildTutorialSteps 动态插入在拖拽步骤之前
    //     { type: 'drag', hintKey: 'tutorial_step_1', sourceCoinIndex: 0, targetCoinIndex: 1 },
    //     { type: 'drag', hintKey: 'tutorial_step_2', sourceCoinIndex: 1, targetCoinIndex: 2, isFinal: true },
    // ],
};

@ccclass('GameScene')
export class GameScene extends Component {
    @property(TableController)
    public tableController:TableController = null;
    @property(RoundManager)
    public roundManager:RoundManager = null;
    @property(GameLogic)
    public gameLogic:GameLogic = null;
    @property(Prefab)
    public coinPrefab:Prefab = null;
    @property({ type: Prefab, tooltip: "炸弹硬币 prefab（被撞击静止后触发爆炸）" })
    public bomberPrefab: Prefab = null;
    @property({ type: Prefab, tooltip: "障碍物 prefab（静态圆盘，硬币碰到会反弹）" })
    public blockerPrefab: Prefab = null;
    @property({ type: Prefab, tooltip: "陷阱 prefab（泥潭区域，硬币中心进入后改变摩擦力）" })
    public mudPrefab: Prefab = null;
    @property({ type: Prefab, tooltip: "爆炸特效 prefab（播放爆炸动画后自动销毁）" })
    public explosionPrefab: Prefab = null;
    @property(UIManager)
    public uiManager:UIManager = null;
    @property({ tooltip: "开局使用的硬币 id（memes.json 中 coins 的 key，默认为 1）" })
    public coinId: string = "1";
    @property(TutorialManager)
    public tutorialManager: TutorialManager = null;

    public static mode:GameMode = GameMode.Level;

    private _debugPanel: Node | null = null;
    /** 缺口宽度基数（从 TableController 面板值快照） */
    private _baseGapWidth: number = 80;
    /** 缓存的 config.json 数据（全局颜色/拖拽音效） */
    private _config: any = null;
    /** 缓存的 memes.json 数据（硬币外形/音效） */
    private _memesConfig: any = null;

    private level:number = 1;

    /** 当前关卡索引（配置模式），-1 表示随机模式 */
    private _levelIndex: number = -1;
    /** levels.json 中的关卡文件列表 */
    private _levelFiles: string[] = [];

    protected onLoad(): void {
        // Q 键开关 DebugPanel（提前注册，即使面板初始 inactive 也能生效）
        input.on(Input.EventType.KEY_DOWN, this._onKeyDown, this);
    }

    start() {
        // UI 在场景根级 UICanvas 下（不在 World 内），用场景根查找
        const uiRoot = director.getScene()?.getChildByName('UICanvas');
        const uiManager = uiRoot?.getChildByName('UIManager');
        if (uiManager) {
            this._debugPanel = uiManager.getChildByName('DebugPanel');

        }

        this.level = 1;
        this.uiManager.setLevel(this.level);
        this.gameLogic.coinPrefab = this.coinPrefab;
        this.gameLogic.score = 0;
        this.uiManager.setScore(0);

        // 同步围墙厚度到 GameLogic（反弹边界用）
        this.gameLogic.wallThickness = this.tableController.wallThickness;

        // 快照缺口宽度基数
        this._baseGapWidth = this.tableController.gapWidth;

        // 启动时读取全局 config.json 与硬币外形 config（memes.json）
        this._loadConfig();
        this._loadMemesConfig();

        // 注入 TutorialManager 到 GameLogic（闲置提示需要）
        if (this.tutorialManager) {
            this.tutorialManager.gameLogic = this.gameLogic;
            this.tutorialManager.uiManager = this.uiManager;
            this.gameLogic.tutorialManager = this.tutorialManager;
        }

        // 加载多语言翻译，完成后翻译场景 Label 并加载游戏配置
        I18n.init(() => {
            this._translateLabels();
            ConfigManager.load((err) => {
                if (!err) {
                    this._applyGameConfig();
                }

                // Ensure AssetSync exists early for ModAutoBoot CDN sync
                const sync = this.gameLogic.getComponent(AssetSyncManager)
                    ?? this.gameLogic.addComponent(AssetSyncManager);
                if (!sync.manifestUrl) {
                    sync.manifestUrl = DEFAULT_CDN_MANIFEST_URL;
                }

                // Zero-touch: ?mod= / ?modUrl= / localStorage → Scratch level + CDN
                ModAutoBoot.prepare(sync, (_bootErr, mod) => {
                    // Scratch / ModConfig level always wins when present
                    let levelData = LevelManager.getCurrent();
                    if (!levelData && mod?.level && Array.isArray(mod.level.coins)) {
                        LevelManager.setScratchLevel(mod.level as never);
                        levelData = LevelManager.getCurrent();
                    }
                    if (!levelData) {
                        try {
                            const cached = ModAutoBoot.readCachedMod();
                            if (cached?.level && Array.isArray(cached.level.coins)) {
                                LevelManager.setScratchLevel(cached.level as never);
                                levelData = LevelManager.getCurrent();
                            }
                        } catch { /* ignore */ }
                    }
                    if (levelData) {
                        this._levelFiles = LevelManager.getLevelFiles();
                        this._levelIndex = LevelManager.getLevelIndex();
                        this._initFromLevel(levelData);
                    } else {
                        LevelManager.clear();
                        this.startNewRound();
                    }
                });
            });
        });

        // this.uiManager.onRetry = ()=>{
        //     this.uiManager.showGameOver(false);
        //     this.uiManager.showVictory(false);
        //     this.gameLogic.score = 0;
        //     this.uiManager.setScore(0);
        //     if (this._levelIndex >= 0) {
        //         // 关卡模式：回到关卡选择
        //         LevelManager.clear();
        //         director.loadScene('levels');
        //     } else {
        //         this.level = 1;
        //         this.uiManager.setLevel(this.level);
        //         this.startNewRound();
        //     }
        // };

        // 绑定 Win 面板回调
        if (this.uiManager.uiWin) {
            // 下一关
            this.uiManager.uiWin.onBtnNextClick = () => {
                this.uiManager.uiWin.close();
                if (GameScene.mode === GameMode.Level) {
                    // 关卡模式：加载下一关
                    this._loadNextLevel();
                } else if (GameScene.mode === GameMode.Ladder){
                    // 随机模式：开始新的一轮
                    this.level++;
                    this.uiManager.setLevel(this.level);
                    this.startNewRound();
                }
            };
            // 返回首页
            this.uiManager.uiWin.onBtnHomeClick = () => {
                this.uiManager.uiWin.close();
                LevelManager.clear();
                director.loadScene('levels');
            };
        }

        // 绑定 Fail 面板回调
        if (this.uiManager.uiFail) {
            // 返回关卡选择
            this.uiManager.uiFail.onBtnHomeClick = () => {
                this.uiManager.uiFail.close();
                if (GameScene.mode === GameMode.Ladder) {
                    director.loadScene('main');
                }else if (GameScene.mode === GameMode.Level){
                    LevelManager.clear();
                    director.loadScene('levels');
                }
            };
            // 显示排行榜
            this.uiManager.uiFail.onBtnRankClick = () => {
                if (this.uiManager.uiRank) {
                    const entries = Leaderboard.getEntries();
                    this.uiManager.uiRank.show(entries);
                }
            };
            // 重试
            this.uiManager.uiFail.onBtnRetryClick = () => {
                const levelData = LevelManager.getCurrent();
                if (levelData) {
                    this._initFromLevel(levelData);
                    return;
                }
                this.uiManager.setScore(0);
                this.startNewRound();
            };
        }

        // 绑定 Rank 面板回调
        if (this.uiManager.uiRank) {
            this.uiManager.uiRank.onCloseClick = () => {
                // 关闭后回到 Fail 面板（Fail 面板仍然显示）
            };
        }

        this.uiManager.onBack = () => {
            this.uiManager.uiConfirm.open(I18n.t('confirm_quit'), (yes)=>{
                if (yes){
                    if (GameScene.mode === GameMode.Ladder) {
                        // 如果是天梯模式，退出后回到首页
                        director.loadScene('main');
                    }else if (GameScene.mode === GameMode.Level){
                        // 如果是关卡模式，退出后回到关卡选择
                        LevelManager.clear();
                        director.loadScene('levels');
                    }

                }
            });
        };

        // this.gameLogic.onGameStart = () => {
        //     this.uiManager.uiItemsPanel.active = true;
        //     this.uiManager.uiLevelPanel.active = true;
        //     this.uiManager.uiScorePanel.active = true;
        // }

        this.gameLogic.onGameOver = (duration: number) => {
            this.uiManager.uiLevelPanel.active = false;
            this.uiManager.uiScorePanel.active = false;
            this.uiManager.buttonBack.node.active = false;

            const uiFail = this.uiManager.uiFail;
            const currentLevel = this._levelIndex >= 0 ? this._levelIndex + 1 : this.level;
            if (uiFail) {
                uiFail.show(currentLevel, this.gameLogic.score, duration);
            }
        };

        this.gameLogic.onScoreUpdate = (score: number, multiplier: number) => {
            this.uiManager.setScore(score, multiplier);
        };
        this.gameLogic.onCoinsLeft = (count: number) => {
            this.uiManager.setCoinsLeft(count);
        };

        this.gameLogic.onGameWin = (duration: number) => {
            // 关卡模式：标记当前关卡 Passed，自动解锁下一关
            if (GameScene.mode == GameMode.Level && this._levelIndex >= 0) {
                LevelManager.markLevelPassed(this._levelIndex);
            }
            const uiWin = this.uiManager.uiWin;
            const currentLevel = this._levelIndex >= 0 ? this._levelIndex + 1 : this.level;
            if (uiWin) {
                uiWin.show(currentLevel, this.gameLogic.score, duration);
                // 最后一关时禁用下一关按钮
                const isLastLevel = this._levelIndex >= 0 && this._levelIndex >= this._levelFiles.length - 1;
                uiWin.setNextEnabled(!isLastLevel);
            }
        };

        this._ensureSoundManager(() => {
            SoundManager.instance?.playBGM(1);
        });
    }

    /** 直接 Play game 場景時主選單不會建立 SoundManager，這裡補上。 */
    private _ensureSoundManager(onReady: () => void): void {
        if (SoundManager.instance?.isValid) {
            onReady();
            return;
        }
        const scene = director.getScene();
        if (!scene) return;

        const SOUND_MANAGER_PREFAB = '332b809b-073c-41f2-9935-3e8c002012fe';
        assetManager.loadAny({ uuid: SOUND_MANAGER_PREFAB }, (err: Error | null, asset: Prefab) => {
            if (!scene.isValid || SoundManager.instance?.isValid) {
                onReady();
                return;
            }
            if (!err && asset) {
                scene.addChild(instantiate(asset));
            } else {
                const node = new Node('SoundManager');
                node.addComponent(AudioSource);
                scene.addChild(node);
                node.addComponent(SoundManager);
            }
            onReady();
        });
    }

    private onGameStart(){
        this.uiManager.uiLevelPanel.active = true;
        this.uiManager.uiScorePanel.active = true;
        this.uiManager.buttonBack.node.active = true;
    }

    // 开始新的一局（天梯模式）
    private startNewRound(){
        // 删除现存硬币与场上道具（障碍物/陷阱）
        this.clearCoins();
        this.gameLogic.clearProps();

        // 注入 prefab 到 GameLogic
        this.gameLogic.blockerPrefab = this.blockerPrefab;
        this.gameLogic.mudPrefab = this.mudPrefab;
        this.gameLogic.explosionPrefab = this.explosionPrefab;

        // 关卡递增缺口宽度
        const inc = this.tableController.gapWidthIncrement;
        this.tableController.gapWidth = this._baseGapWidth + this.level * inc;
        // 缺口数量 = ((level - 1) % 4) + 1，每边最多一个
        const gapCount = ((this.level - 1) % 4) + 1;
        this.tableController.generateRandomGaps(gapCount);
        // 同步缺口数据到 GameLogic（反弹跳过 + 侧边反弹用）
        this.gameLogic.gaps = this.tableController.gaps.slice();
        this.gameLogic.gapWidth = this.tableController.gapWidth;

        // 绘制绿色桌面 + 围墙（含缺口）
        this.tableController.drawTable();
        let coinCount = 6;
        let coinPositions = this.roundManager.newRound(
            this.tableController.tableWidth,
            this.tableController.tableHeight,
            this.gameLogic.coinRadius,
            coinCount,
            this.gameLogic.wallThickness,
        );

        // 根据coin数量和位置生成coin
        const radius = this.gameLogic.coinRadius;
        for (let i=0; i<coinCount; i++){
            let coin = instantiate(this.coinPrefab);
            this.gameLogic.coinGroup.addChild(coin);
            coin.setPosition(coinPositions[i]);
            // 按 coinRadius 设置外观尺寸和碰撞器
            coin.setScale(1, 1, 1);
            const ut = coin.getComponent(UITransform);
            if (ut) ut.setContentSize(radius * 2, radius * 2);
            const cc = coin.getComponent(CircleCollider2D);
            if (cc) cc.radius = radius;
            // 注入 GameLogic 引用，用于弹射后通知状态切换
            let ctrl = coin.addComponent(CoinController);
            ctrl.setGameLogic(this.gameLogic);
            //if (i === 0) this.gameLogic.attachCoinBehavior(coin, 'FreezeBehavior');
        }

        // 生成随机道具（天梯模式，level >= 2 时）
        const props = this.roundManager.generateRandomProps(
            this.tableController.tableWidth,
            this.tableController.tableHeight,
            this.gameLogic.wallThickness,
            this.gameLogic.coinRadius,
            coinPositions,
            this.level,
        );
        for (const prop of props) {
            if (prop.type === 'blocker') {
                this.gameLogic.spawnBlockerAt(prop.x, prop.y, prop.radius);
            } else if (prop.type === 'mud') {
                this.gameLogic.spawnMudAt(prop.x, prop.y, prop.radius);
            } else if (prop.type === 'bomb') {
                this.gameLogic.spawnBombCoinAt(this.bomberPrefab, prop.x, prop.y, prop.radius);
            }
        }

        this.gameLogic.beginLevel();
        this.uiManager.setScore(0);
        this.gameLogic.waitingPlayerOperation();

        // 开局按指定 coin id 应用外观（配置已加载时）
        if (this._memesConfig) {
            this._applyCoinConfig(this.coinId);
        }
        this.onGameStart();
    }

    /** 构建当前关卡的统一教程步骤：静态配置 + 动态道具介绍 */
    private _buildTutorialSteps(data: LevelData): TutorialStep[] {
        const steps: TutorialStep[] = [];

        // 动态生成 block/mud 介绍步骤（从关卡数据提取位置和大小）
        for (const item of data.coins) {
            if (item.type === 'block') {
                steps.push({ type: 'intro', hintKey: 'tutorial_block_intro', x: item.x, y: item.y, radius: item.radius });
            } else if (item.type === 'mud') {
                steps.push({ type: 'intro', hintKey: 'tutorial_mud_intro', x: item.x, y: item.y, radius: item.radius });
            }
        }

        // 追加静态配置的拖拽步骤
        const staticSteps = TUTORIAL_CONFIG[this._levelIndex];
        if (staticSteps) {
            steps.push(...staticSteps);
        }

        return steps;
    }

    /** 按关卡 JSON 配置初始化桌面、硬币、障碍物、陷阱 */
    private _initFromLevel(data: LevelData | null): void {
        if (!data) {
            this.startNewRound();
            return;
        }
        this.clearCoins();
        this.gameLogic.clearProps();

        // 注入 prefab 到 GameLogic
        this.gameLogic.blockerPrefab = this.blockerPrefab;
        this.gameLogic.mudPrefab = this.mudPrefab;
        this.gameLogic.explosionPrefab = this.explosionPrefab;

        // 桌面尺寸
        this.tableController.tableWidth = data.width;
        this.tableController.tableHeight = data.height;
        this.gameLogic.tableWidth = data.width;
        this.gameLogic.tableHeight = data.height;

        // 围墙厚度
        const wallThickness = data.wall.thickness;
        this.tableController.wallThickness = wallThickness;
        this.gameLogic.wallThickness = wallThickness;
        this.tableController.gapWidth = 0;
        this.gameLogic.gaps = [];
        this.gameLogic.gapWidth = 0;

        this.tableController.drawTable();

        const sync = this.gameLogic.getComponent(AssetSyncManager)
            ?? this.gameLogic.addComponent(AssetSyncManager);
        // 桌面熱換皮（felt / wall URL、preset、Base64）
        if (data.table) sync.applyTableConfig(this.tableController, data.table);

        // 条目：按 type 字段区分硬币/障碍物/陷阱/炸弹硬币
        const spawnedCoins: Node[] = [];
        for (const item of data.coins) {
            if (item.type === 'block') {
                this.gameLogic.spawnBlockerAt(item.x, item.y, item.radius);
            } else if (item.type === 'mud') {
                this.gameLogic.spawnMudAt(item.x, item.y, item.radius);
            } else if (item.type === 'bomb') {
                this.gameLogic.spawnBombCoinAt(this.bomberPrefab, item.x, item.y, item.radius);
            } else if (item.type === 'coin') {
                const node = sync.spawnConfiguredCoin(this.gameLogic, this.coinPrefab, {
                    type: 'coin',
                    x: item.x,
                    y: item.y,
                    class: item.class,
                    canshot: item.canshot,
                    behaviors: item.behaviors,
                    memeId: item.memeId,
                    skin: item.skin,
                    skinKey: item.skinKey,
                    radius: item.radius,
                });
                spawnedCoins.push(node ?? this.gameLogic.spawnCoinAt(this.coinPrefab, item.x, item.y));
            }
        }
        if (this._levelIndex === 0 && spawnedCoins.length > 0) {
            this.gameLogic.attachCoinBehavior(spawnedCoins[spawnedCoins.length - 1], 'FreezeBehavior');
        }

        this.gameLogic.beginLevel();
        this.gameLogic.waitingPlayerOperation();

        // 更新 UI 关卡显示
        this.uiManager.setLevel(this._levelIndex + 1);
        this.uiManager.setScore(0);

        // 闯关模式 → 统一教程入口（intro 和 drag 步骤可混排）
        if (this._levelIndex >= 0 && this.tutorialManager) {
            this.tutorialManager.gameLogic = this.gameLogic;
            this.tutorialManager.uiManager = this.uiManager;
            this.gameLogic.tutorialManager = this.tutorialManager;

            const steps = this._buildTutorialSteps(data);
            if (steps.length > 0) {
                this.tutorialManager.startTutorial(steps);
            }
        }
    }

    private clearCoins(){
        this.gameLogic.coinGroup.removeAllChildren();
    }

    /** 加载下一关，或显示最终胜利 */
    private _loadNextLevel(): void {
        // Scratch solo pack has no next file level
        if (LevelManager.isScratchPack()) {
            this.gameLogic.enabled = false;
            this.uiManager.uiWin.show(this.level, this.gameLogic.score, 0);
            this.uiManager.uiWin.setNextEnabled(false);
            return;
        }
        this._levelIndex++;
        if (this._levelIndex < this._levelFiles.length) {
            const levelFile = this._levelFiles[this._levelIndex];
            const path = LevelManager.toDataPath(levelFile);
            DataProvider.loadJson(path, (err, data) => {
                if (err) {
                    console.error(`Failed to load next level ${path}:`, err);
                    return;
                }
                const levelData = data as LevelData;
                LevelManager.setCurrent(levelData);
                this._initFromLevel(levelData);
            });
        } else {
            // 最后一关通关，显示最终胜利
            this.gameLogic.enabled = false;
            //this.uiManager.uiwin.show(this._levelFiles.length, this.gameLogic.score, 0);
            this.uiManager.uiWin.show(this.level, this.gameLogic.score, 0);
            this.uiManager.uiWin.setNextEnabled(false);
        }
    }

    onDestroy() {
        input.off(Input.EventType.KEY_DOWN, this._onKeyDown, this);
    }

    private _onKeyDown(event: EventKeyboard) {
        if (event.keyCode === KeyCode.KEY_Q && this._debugPanel) {
            this._debugPanel.active = !this._debugPanel.active;
        }

        // 数字键 1-9：读取 memes.json 配置并切换所有硬币贴图/音效
        if (event.keyCode >= KeyCode.DIGIT_1 && event.keyCode <= KeyCode.DIGIT_9) {
            const keyIndex = event.keyCode - KeyCode.DIGIT_1 + 1;
            this._applyCoinConfig(keyIndex.toString());
        }
    }

    /** 启动时读取全局 config.json，缓存数据并应用全局颜色 */
    private _loadConfig(): void {
        DataProvider.loadJson('config', (err, data) => {
            if (err) {
                console.warn('[GameScene] 加载 config.json 失败:', err);
                return;
            }
            this._config = (data as any) ?? {};

            // 应用全局颜色配置
            const parseHex = (hex: string) => new Color(
                parseInt(hex.slice(1, 3), 16),
                parseInt(hex.slice(3, 5), 16),
                parseInt(hex.slice(5, 7), 16), 255,
            );
            const srcHex = this._config.sourceColor as string | undefined;
            if (srcHex?.length >= 7) CoinController.sourceColor = parseHex(srcHex);
            const tgtHex = this._config.targetColor as string | undefined;
            if (tgtHex?.length >= 7) CoinController.targetColor = parseHex(tgtHex);

            // 加载拖拽音效到 SoundManager
            const sm = SoundManager.instance;
            if (sm) {
                const loadSfx = (field: string) => {
                    const base = (this._config[field] as string)?.replace(/\.[^/.]+$/, '');
                    if (!base) return;
                    resources.load(base, AudioClip, (sfxErr: any, clip: AudioClip) => {
                        if (!sfxErr && clip) {
                            if (field === 'dragIncreaseSfx') sm.dragIncrease = clip;
                            else if (field === 'dragDecreaseSfx') sm.dragDecrease = clip;
                            else if (field === 'dragReleaseSfx') sm.dragRelease = clip;
                        }
                    });
                };
                loadSfx('dragIncreaseSfx');
                loadSfx('dragDecreaseSfx');
                loadSfx('dragReleaseSfx');
            }
        });
    }

    /** 启动时读取 memes.json，缓存硬币外形/音效配置并按开局 coinId 应用 */
    private _loadMemesConfig(): void {
        DataProvider.loadJson('memes', (err, data) => {
            if (err) {
                console.warn('[GameScene] 加载 memes.json 失败:', err);
                return;
            }
            this._memesConfig = (data as any) ?? {};
            CoinController.setMemesConfig(this._memesConfig);
            // 关卡模式的硬币在生成时已按 class 应用；天梯模式硬币没有 class，统一使用开局 coinId
            if (!LevelManager.getCurrent() || GameScene.mode === GameMode.Ladder) {
                this._applyCoinConfig(this.coinId);
            }
        });
    }

    /**
     * 使用缓存的 memes.json 配置，根据 key 查找并应用到场上所有硬币
     * （天梯模式默认外观 / 调试数字键切换用；关卡模式的硬币按各自 class 应用）
     * @param key memes.json 中的硬币类型标识，如 "1", "2"
     */
    private _applyCoinConfig(key: string): void {
        const asset = this._memesConfig;
        if (!asset) {
            console.warn('[GameScene] memes.json 尚未加载完成');
            return;
        }

        const coinsData = asset.coins;
        if (!coinsData) {
            console.warn('[GameScene] memes.json 格式错误：缺少 coins 字段');
            return;
        }
        if (!coinsData[key]) {
            console.log(`[GameScene] memes.json 中未找到 key "${key}" 的配置，不做处理`);
            return;
        }

        console.log(`[GameScene] 切换硬币为 ${key} 号外观（默认/空闲/拖拽/发射/被打击 贴图 + 发射/被打击 音效）`);
        for (const coin of this.gameLogic.coinGroup.children) {
            // 跳过炸弹硬币（保留 prefab 自带贴图）
            if (coin.getComponent(BombCoinMarker)) continue;
            CoinController.applyMemeAppearance(coin, key);
        }
    }

    /** 从 ConfigManager 读取配置并应用到各组件 */
    private _applyGameConfig(): void {
        const gameConfig = ConfigManager.getGameLogicConfig();
        if (gameConfig && this.gameLogic) {
            this.gameLogic.coinRadius = gameConfig.coinRadius;
            this.gameLogic.speedThreshold = gameConfig.speedThreshold;
            this.gameLogic.velocityFactor = gameConfig.velocityFactor;
            this.gameLogic.coinDamping = gameConfig.coinDamping;
            this.gameLogic.mudDamping = gameConfig.mudDamping;
            this.gameLogic.bombPushRadius = gameConfig.bombPushRadius;
            this.gameLogic.bombPushForce = gameConfig.bombPushForce;
            this.gameLogic.bombMudPushFactor = gameConfig.bombMudPushFactor;
            this.gameLogic.aimLineFactor = gameConfig.aimLineFactor;
            if (this.tutorialManager) {
                this.tutorialManager.idleShowDelay = gameConfig.idleShowDelay;
            }
        }

        const tableConfig = ConfigManager.getTableControllerConfig();
        if (tableConfig && this.tableController) {
            this.tableController.wallThickness = tableConfig.wallThickness;
            this.tableController.gapWidth = tableConfig.gapWidth;
            this.tableController.gapWidthIncrement = tableConfig.gapWidthIncrement;
            this._baseGapWidth = tableConfig.gapWidth;
            this.gameLogic.wallThickness = tableConfig.wallThickness;
        }

        const hitConfig = ConfigManager.getHitEffectManagerConfig();
        const hitEffectManager = this.gameLogic?.hitEffectManager;
        if (hitConfig && hitEffectManager) {
            // Boolean 开关
            hitEffectManager.enableDragZoom = hitConfig.enableDragZoom;
            hitEffectManager.enableDragPrediction = hitConfig.enableDragPrediction;
            hitEffectManager.enableLaunchEffect = hitConfig.enableLaunchEffect;
            hitEffectManager.enableSlowMotion = hitConfig.enableSlowMotion;
            hitEffectManager.enableLaunchTracking = hitConfig.enableLaunchTracking;
            hitEffectManager.enableHitPause = hitConfig.enableHitPause;
            hitEffectManager.enableHitShake = hitConfig.enableHitShake;
            hitEffectManager.enableHitParticle = hitConfig.enableHitParticle;
            hitEffectManager.enableHitSubCamera = hitConfig.enableHitSubCamera;
            hitEffectManager.enableHitTracking = hitConfig.enableHitTracking;
            hitEffectManager.enableKnockOut = hitConfig.enableKnockOut;
            hitEffectManager.enableTornado = hitConfig.enableTornado;
            // 数值参数
            hitEffectManager.cameraZoomInDuration = hitConfig.cameraZoomInDuration;
            hitEffectManager.cameraZoomOutDuration = hitConfig.cameraZoomOutDuration;
            hitEffectManager.launchAnimSpeed = hitConfig.launchAnimSpeed;
            hitEffectManager.hitPauseDuration = hitConfig.hitPauseDuration;
            hitEffectManager.cameraTrackDuration = hitConfig.cameraTrackDuration;
            hitEffectManager.subCameraOrthoHeight = hitConfig.subCameraOrthoHeight;
            hitEffectManager.subViewWidth = hitConfig.subViewWidth;
            hitEffectManager.subViewHeight = hitConfig.subViewHeight;
            hitEffectManager.subViewDuration = hitConfig.subViewDuration;
        }

        console.log('[GameScene] 游戏配置已应用');
    }

    /** 翻译场景中所有硬编码中文 Label */
    private _translateLabels(): void {
        const scene = director.getScene();
        if (!scene) return;

        // 中文 → i18n key 的映射表
        const textMap: Record<string, string> = {
            '闯关模式': 'main_level_mode',
            '天梯模式': 'main_ladder_mode',
            '对战模式': 'main_pvp_mode',
            '关卡': 'game_level',
            '得分': 'game_score',
            '耗时': 'game_time',
            '退出': 'game_exit',
            '重试': 'game_retry',
            '下一关': 'game_next_level',
            '恭喜过关！': 'game_level_complete',
            '恭喜过关': 'game_level_complete',
            '排行榜': 'game_leaderboard',
            '排名': 'game_rank',
            '按Q键打开和关闭调试面板': 'game_debug_hint',
            '确定要退出吗？': 'ui_confirm_quit',
            '确定': 'ui_confirm',
            '取消': 'ui_cancel',
        };

        const walk = (node: Node) => {
            const label = node.getComponent(Label);
            if (label) {
                const key = textMap[label.string];
                if (key) {
                    label.string = I18n.t(key);
                }
            }
            for (const child of node.children) {
                walk(child);
            }
        };
        walk(scene);
    }
}


