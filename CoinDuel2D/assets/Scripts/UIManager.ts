import { _decorator, Button, Color, Component, EventHandler, Label, Node, Sprite, SpriteFrame, Tween, UIOpacity, UITransform, Vec3, director, resources, tween } from 'cc';
import { Leaderboard } from './Leaderboard';
import { I18n } from './I18n';
import { SoundManager } from './SoundManager';
import { UIWin } from './UI/UIWin';
import { UIFail } from './UI/UIFail';
import { UIRank } from './UI/UIRank';
import { UIConfirm } from './UI/UIConfirm';
import { UITips } from './UI/UITips';
import { TargetIndicator } from './Effects/TargetIndicator';
const { ccclass, property } = _decorator;

@ccclass('UIManager')
export class UIManager extends Component {
    @property(Label)
    public labelScore:Label = null;
    @property(Label)
    public labelLevel:Label = null;
    @property(Label)
    public labelCoinsLeft: Label = null;
    @property(Node)
    public clickNode:Node = null;
    @property(Button)
    public buttonBack:Button = null;
    @property(Button)
    public buttonMusicSwith:Button = null;
    @property(UIWin)
    public uiWin:UIWin = null;
    @property(UIFail)
    public uiFail:UIFail = null;
    @property(UIRank)
    public uiRank:UIRank = null;

    @property(Node)
    public uiLevelPanel:Node = null;
    @property(Node)
    public uiScorePanel:Node = null;

    @property(UIConfirm)
    public uiConfirm:UIConfirm = null;

    @property(TargetIndicator)
    public targetIndicator:TargetIndicator = null;

    public onBack:()=>void;
    private _shownScore = 0;

    /** 音乐开关图标（Resources 下的 SpriteFrame 子资源路径） */
    private static readonly MUSIC_ON_ICON = 'textures/btn_music_on/spriteFrame';
    private static readonly MUSIC_OFF_ICON = 'textures/btn_music_off/spriteFrame';
    private _musicOn: boolean = true;

    start() {
        if (this.buttonBack) {
            this.buttonBack.node.on(Button.EventType.CLICK, () => {
                if (this.onBack)this.onBack();
            }, this);
        }
        // 兼容场景中尚未绑定 buttonMusicSwith 属性：按节点名自动查找
        if (!this.buttonMusicSwith) {
            const musicNode = this.node.getChildByName('BtnMusicSwith');
            if (musicNode) this.buttonMusicSwith = musicNode.getComponent(Button);
        }
        if (this.buttonMusicSwith){
            // 与 SoundManager 的持久开关保持同步（跨场景不丢失状态）
            this._musicOn = SoundManager.instance?.musicEnabled ?? true;
            this._updateMusicIcon();
            this.buttonMusicSwith.node.on(Button.EventType.CLICK, this._onMusicClick, this);
        }
    }

    /** 点击音乐按钮：开/关 BGM 并切换图标 */
    private _onMusicClick(): void {
        const sm = SoundManager.instance;
        if (!sm) return;
        this._musicOn = sm.toggleMusic();
        this._updateMusicIcon();
    }

    /** 根据当前开关状态刷新按钮图片 */
    private _updateMusicIcon(): void {
        if (!this.buttonMusicSwith) return;

        const buttonNode = this.buttonMusicSwith.node;
        const sprite = buttonNode.getComponent(Sprite) ?? buttonNode.getComponentInChildren(Sprite);
        if (!sprite) {
            console.warn('[UIManager] BtnMusicSwith 上找不到 Sprite 组件');
            return;
        }

        const path = this._musicOn
            ? UIManager.MUSIC_ON_ICON
            : UIManager.MUSIC_OFF_ICON;
        resources.load(path, SpriteFrame, (err: any, frame: SpriteFrame) => {
            if (err || !frame) {
                console.warn(`[UIManager] 加载音乐按钮图标失败: ${path}`, err);
                return;
            }
            if (sprite.isValid) sprite.spriteFrame = frame;
        });
    }

    public setScore(score: number, multiplier: number = 1): void {
        const gain = score - this._shownScore;
        this._shownScore = score;
        const shown = Number.isInteger(score) ? String(score) : score.toFixed(1);
        const rate = Number.isInteger(multiplier) ? String(multiplier) : multiplier.toFixed(1);
        if (!this.labelScore) return;
        this.labelScore.string = multiplier > 1 ? `${shown}  x${rate}` : shown;
        this.labelScore.color = multiplier > 1
            ? new Color(255, 214, 90, 255)
            : new Color(255, 255, 255, 255);
        if (gain > 0) this._popScore(gain);
    }

    public setLevel(level:number){
        this.labelLevel.string = level.toString();
    }

    public setCoinsLeft(count: number): void {
        const label = this.labelCoinsLeft;
        if (!label) return;
        label.string = `剩餘: ${count}`;
        const lastTwo = count > 0 && count <= 2;
        label.color = lastTwo ? new Color(255, 214, 90, 255) : new Color(255, 255, 255, 255);
        label.fontSize = lastTwo ? 28 : 24;
    }

    /** Close win / fail / rank / confirm so only one overlay can be visible. */
    public closeAllOverlays(): void {
        this.uiWin?.close();
        this.uiFail?.close();
        this.uiRank?.close();
        this.uiConfirm?.close();
    }

    /** In-round HUD (level / score / back). Hides end-game overlays. */
    public showPlayingHUD(): void {
        this.closeAllOverlays();
        if (this.uiLevelPanel) this.uiLevelPanel.active = true;
        if (this.uiScorePanel) this.uiScorePanel.active = true;
        if (this.buttonBack?.node) this.buttonBack.node.active = true;
    }

    /** Hide in-round HUD before showing win or fail (never leave both overlays up). */
    public prepareEndGameOverlay(kind: 'win' | 'fail'): void {
        if (this.uiLevelPanel) this.uiLevelPanel.active = false;
        if (this.uiScorePanel) this.uiScorePanel.active = false;
        if (this.buttonBack?.node) this.buttonBack.node.active = false;
        if (kind === 'win') {
            this.uiFail?.close();
            this.uiRank?.close();
        } else {
            this.uiWin?.close();
        }
    }

    /** 加分時分數彈一下，並浮出這次拿到的點數。 */
    private _popScore(gain: number): void {
        const scoreNode = this.labelScore?.node;
        if (!scoreNode) return;
        Tween.stopAllByTarget(scoreNode);
        scoreNode.setScale(1.22, 1.22, 1);
        tween(scoreNode).to(0.16, { scale: new Vec3(1, 1, 1) }).start();

        const host = scoreNode.parent;
        if (!host) return;
        const floater = new Node('ScoreGain');
        floater.layer = host.layer;
        host.addChild(floater);
        floater.setPosition(scoreNode.position.x + 36, scoreNode.position.y, 0);
        const ui = floater.addComponent(UITransform);
        ui.setContentSize(90, 32);
        const label = floater.addComponent(Label);
        label.string = Number.isInteger(gain) ? `+${gain}` : `+${gain.toFixed(1)}`;
        label.fontSize = 22;
        label.lineHeight = 24;
        label.useSystemFont = true;
        label.fontFamily = 'Arial';
        label.color = gain > 1 ? new Color(255, 214, 90, 255) : new Color(255, 255, 255, 255);
        label.enableOutline = true;
        label.outlineColor = new Color(0, 0, 0, 200);
        label.outlineWidth = 2;
        const opacity = floater.addComponent(UIOpacity);
        const rise = new Vec3(floater.position.x, floater.position.y + 26, 0);
        tween(floater).to(0.42, { position: rise }).start();
        tween(opacity)
            .delay(0.12)
            .to(0.3, { opacity: 0 })
            .call(() => { if (floater.isValid) floater.destroy(); })
            .start();
    }

}
