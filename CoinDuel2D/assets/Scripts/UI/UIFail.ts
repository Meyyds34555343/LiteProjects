import { _decorator, Button, Component, Label, Node } from 'cc';
import { I18n } from '../I18n';
const { ccclass, property } = _decorator;

@ccclass('UIFail')
export class UIFail extends Component {
    @property(Label)
    public level:Label = null;
    @property(Label)
    public score:Label = null;
    @property(Label)
    public time:Label = null;
    @property(Node)
    public btnHome:Node = null;
    @property(Node)
    public btnRank:Node = null;
    @property(Node)
    public btnRetry:Node = null;

    public onBtnHomeClick:()=>void = null;
    public onBtnRankClick:()=>void = null;
    public onBtnRetryClick:()=>void = null;

    onLoad() {
        // 绑定按钮点击事件
        if (this.btnHome) {
            this.btnHome.on(Button.EventType.CLICK, () => {
                this.close();
                if (this.onBtnHomeClick) this.onBtnHomeClick();
            }, this);
        }
        if (this.btnRank) {
            this.btnRank.on(Button.EventType.CLICK, () => {
                if (this.onBtnRankClick) this.onBtnRankClick();
            }, this);
        }
        if (this.btnRetry) {
            const retryLabel = this.btnRetry.getComponentInChildren(Label);
            if (retryLabel) retryLabel.string = I18n.t('fail_retry_level');
            this.btnRetry.on(Button.EventType.CLICK, () => {
                this.close();
                if (this.onBtnRetryClick) this.onBtnRetryClick();
            }, this);
        }
    }

    /** 修改重试按钮文字（天梯模式显示“重新开始”）。 */
    public setRetryText(text: string): void {
        const retryLabel = this.btnRetry?.getComponentInChildren(Label);
        if (retryLabel) retryLabel.string = text;
    }

    public show(level:number, score:number, time:number, retryText?: string){
        if (this.level) this.level.string = level.toString();
        if (this.score) this.score.string = score.toString();
        if (this.time) {
            const h = Math.floor(time / 3600);
            const m = Math.floor((time % 3600) / 60);
            const s = time % 60;
            const pad = (n: number) => n < 10 ? '0' + n : '' + n;
            this.time.string = `${pad(h)}:${pad(m)}:${pad(s)}`;
        }
        if (this.btnRetry) this.btnRetry.active = true;
        this.node.active = true;
        // 首次弹出时 node.active=true 才触发 onLoad，必须在激活后再覆盖默认按钮文案
        if (retryText) this.setRetryText(retryText);
    }

    public close(){
        this.node.active = false;
    }
}

