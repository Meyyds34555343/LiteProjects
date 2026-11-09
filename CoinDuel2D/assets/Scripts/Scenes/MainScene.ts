import { _decorator, Button, Component, director, Node, Label, resources, instantiate, Prefab } from 'cc';
import { LevelManager } from '../LevelManager';
import { SoundManager } from '../SoundManager';
import { I18n } from '../I18n';
import { MainMenuLayout } from '../UI/MainMenuLayout';
import { AssetSyncManager } from '../Meme/AssetSyncManager';
import { DEFAULT_CDN_MANIFEST_URL } from '../Meme/CdnConfig';
import { GameMode, GameScene } from './GameScene';
const { ccclass, property } = _decorator;

@ccclass('MainScene')
export class MainScene extends Component {
    @property(Button)
    public btnLevels: Button | null = null;
    @property(Button)
    public btnLadder: Button | null = null;
    @property(Button)
    public btnPVP: Button | null = null;
    @property(Label)
    public labelUpdateMessage: Label | null = null;
    @property(Prefab)
    public soundManagerPrefab: Prefab | null = null;

    @property(MainMenuLayout)
    public menuLayout: MainMenuLayout | null = null;

    onLoad() {
        // Always start on CoinDuel main with a clean mode; wipe leftover Scratch so Ladder/campaign stay clean.
        GameScene.mode = GameMode.Level;
        LevelManager.clear();

        // Self-attach the responsive layout so no Inspector wiring is required.
        if (!this.menuLayout) {
            this.menuLayout = this.getComponent(MainMenuLayout) ?? this.addComponent(MainMenuLayout);
        }
        if (this.menuLayout) {
            // Auto-wire the stack when the designer did not drag optional refs in.
            if (!this.menuLayout.logo) {
                this.menuLayout.logo = this.node.getChildByName('Logo');
            }
            if (!this.menuLayout.buttons || this.menuLayout.buttons.length === 0) {
                const stack = [this.btnLevels?.node, this.btnLadder?.node, this.btnPVP?.node]
                    .filter((n): n is Node => !!n);
                if (stack.length) this.menuLayout.buttons = stack;
            }
            this.menuLayout.apply();
        }

        if (this.btnLevels?.node) {
            this.btnLevels.node.on(Button.EventType.CLICK, () => {
                GameScene.mode = GameMode.Level;
                // Explicit ?mod= share: play the Scratch pack immediately from CoinDuel main.
                try {
                    const q = typeof location !== 'undefined' ? new URLSearchParams(location.search || '') : null;
                    const hasMod = !!(q && (q.get('mod') || q.get('modUrl')));
                    if (hasMod) {
                        const raw = localStorage.getItem('CoinDuel:activeMod');
                        if (raw) {
                            const mod = JSON.parse(raw);
                            if (mod?.level && Array.isArray(mod.level.coins)) {
                                LevelManager.setScratchLevel(mod.level);
                                director.loadScene('game');
                                return;
                            }
                        }
                    }
                } catch { /* fall through to levels */ }
                director.loadScene('levels');
            }, this);
        }
        if (this.btnLadder?.node) {
            this.btnLadder.node.on(Button.EventType.CLICK, () => {
                GameScene.mode = GameMode.Ladder;
                LevelManager.clear();
                director.loadScene('game');
            }, this);
        }
        if (this.btnPVP?.node) {
            this.btnPVP.node.on(Button.EventType.CLICK, () => {
                director.loadScene('pvp');
            }, this);
        }
        if (SoundManager.instance == null) {
            let sm = instantiate(this.soundManagerPrefab);
            director.getScene()?.addChild(sm);
        }
        if (SoundManager.instance != null) {
            SoundManager.instance.stopBGM();
        }
    }

    start(){
        I18n.init(() => {
            this._translateLabels();

            // Menus must stay usable even when the CDN is slow / unreachable (preview, web, itch).
            this.showMenus(true);
            if (this.labelUpdateMessage) {
                this.labelUpdateMessage.string = I18n.t('main_check_update');
            }

            // 游戏启动时按 manifest.json 更新本地资产缓存（后台进行，不阻塞界面）
            const sync = this.node.getComponent(AssetSyncManager)
                ?? this.node.addComponent(AssetSyncManager);
            if (!sync.manifestUrl) {
                sync.manifestUrl = DEFAULT_CDN_MANIFEST_URL;
            }
            sync.sync(
                (err) => {
                    if (err) {
                        const errKey = err === 'network'
                            ? 'main_update_err_fetch_index'
                            : err === 'manifest'
                                ? 'main_update_err_parse_index'
                                : err === 'busy'
                                    ? 'main_update_err_running'
                                    : 'main_update_err_download';
                        console.warn('[Update] 更新失败:', err);
                        if (this.labelUpdateMessage) {
                            this.labelUpdateMessage.string = I18n.t('main_update_error')
                                + I18n.t(errKey, { code: 0, file: '' });
                        }
                    } else {
                        console.log('[Update] 更新完成 / skipped');
                        if (this.labelUpdateMessage) {
                            this.labelUpdateMessage.string = '';
                        }
                    }
                    this.showMenus(true);
                },
                (completed, total) => {
                    if (!this.labelUpdateMessage) return;
                    const pct = total > 0 ? (completed / total) * 100 : 0;
                    console.log(`[Update] 更新进度 ${pct.toFixed(0)}%`);
                    this.labelUpdateMessage.string =
                        I18n.t('main_update_progress') + pct.toFixed(0) + '%';
                },
            );

        });

    }

    /** 翻译主菜单场景中的 Label */
    private _translateLabels(): void {
        const scene = director.getScene();
        if (!scene) return;

        const textMap: Record<string, string> = {
            '闯关模式': 'main_level_mode',
            '天梯模式': 'main_ladder_mode',
            '对战模式': 'main_pvp_mode',
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

    private showMenus(e:boolean){
        if (this.btnLevels?.node) this.btnLevels.node.active = e;
        if (this.btnLadder?.node) this.btnLadder.node.active = e;
        // Keep PVP hidden until ready — never leave a half-visible wrong menu.
        if (this.btnPVP?.node) this.btnPVP.node.active = false;
        // Re-flow after visibility changes so gaps never leave a hole.
        this.menuLayout?.apply();
    }

}

