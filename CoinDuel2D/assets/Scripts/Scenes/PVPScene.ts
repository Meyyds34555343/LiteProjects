import { _decorator, Button, Component, director, Node, Label } from 'cc';
import { UIMessageBox } from '../UI/UIMessageBox';
import { SoundManager } from '../SoundManager';
import { I18n } from '../I18n';
const { ccclass, property } = _decorator;

@ccclass('PVPScene')
export class PVPScene extends Component {
    @property(Button)
    public btnMatch: Button | null = null;
    @property(Button)
    public btnCreate: Button | null = null;
    @property(Button)
    public btnJoin: Button | null = null;
    @property(UIMessageBox)
    public messageBox: UIMessageBox | null = null;

    onLoad() {
        this.btnMatch.node.on(Button.EventType.CLICK, () => {
            console.log('Match button clicked');
        }, this);
        this.btnCreate.node.on(Button.EventType.CLICK, () => {
            console.log('Create button clicked');
        }, this);
        this.btnJoin.node.on(Button.EventType.CLICK, () => {
            console.log('Join button clicked');
        }, this);
    }

    start(){
        I18n.init(() => {
            this._translateLabels();
            this.messageBox.open(I18n.t('pvp_not_supported'), () => {
                director.loadScene('main');
            });
        });
        SoundManager.instance?.stopBGM();
    }

    /** 翻译 PVP 场景中的 Label */
    private _translateLabels(): void {
        const scene = director.getScene();
        if (!scene) return;

        const textMap: Record<string, string> = {
            '开始匹配': 'pvp_start_match',
            '创建房间': 'pvp_create_room',
            '加入房间': 'pvp_join_room',
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

