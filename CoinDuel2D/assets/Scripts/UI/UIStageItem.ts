import { _decorator, Button, Color, Label, Node, Sprite, Component, tween, Vec3 } from 'cc';
import { LevelState } from '../LevelData';
import { CampaignProgress } from '../Campaign/CampaignProgress';
import { CAMPAIGN_STAGES } from '../Campaign/CampaignConfig';
import { I18n } from '../I18n';

const { ccclass, property } = _decorator;

const STAR_ON = new Color(255, 214, 90, 255);
const STAR_OFF = new Color(68, 72, 84, 170);

/**
 * Stage button for the level-select grid.
 *
 * Shows the stage number, a lock / passed overlay and three stars, and disables
 * the button while the stage is locked. It reuses the existing `UILevelItem`
 * prefab hierarchy (`Label`, `Locked`, `Passed`) and builds the star row at
 * runtime from text glyphs, so no new art or prefab edits are required.
 *
 *   UILevelItem (Sprite + Button + this component)
 *   ├── Label     (cc.Label)  -> stage number
 *   ├── Locked    (Node)      -> shown while locked
 *   ├── Passed    (Node)      -> shown when cleared
 *   └── Stars     (auto-created row of ★ labels)
 *
 * If the fields are left empty the component resolves them by node name, so
 * adding it to the existing prefab is enough.
 */
@ccclass('UIStageItem')
export class UIStageItem extends Component {
    @property(Label)
    public labelLevel: Label | null = null;

    @property(Node)
    public nodeLock: Node | null = null;

    @property(Node)
    public nodePassed: Node | null = null;

    @property(Label)
    public labelName: Label | null = null;

    @property(Sprite)
    public spriteBackground: Sprite | null = null;

    @property(Color)
    public colorLocked: Color = new Color(120, 124, 138, 255);

    @property(Color)
    public colorUnlocked: Color = new Color(255, 214, 90, 255);

    @property(Color)
    public colorPassed: Color = new Color(92, 214, 138, 255);

    /** Vertical offset of the star row inside the button. */
    @property
    public starRowY: number = -32;

    private _stars: Label[] = [];
    private _stageId = 0;
    private _resolved = false;

    onLoad(): void {
        this._resolveRefs();
    }

    /** Fill missing inspector references using the prefab node names. */
    private _resolveRefs(): void {
        if (this._resolved) return;
        this._resolved = true;
        if (!this.labelLevel) {
            this.labelLevel = this.node.getChildByName('Label')?.getComponent(Label) ?? null;
        }
        if (!this.nodeLock) {
            this.nodeLock = this.node.getChildByName('Locked');
        }
        if (!this.nodePassed) {
            this.nodePassed = this.node.getChildByName('Passed');
        }
        if (!this.labelName) {
            this.labelName = this.node.getChildByName('Name')?.getComponent(Label) ?? null;
        }
        if (!this.spriteBackground) {
            this.spriteBackground = this.getComponent(Sprite);
        }
    }

    /**
     * Bind a stage and refresh all visuals.
     * @param stageId 1-based campaign stage id
     */
    public setStage(stageId: number, state: LevelState): void {
        this._resolveRefs();
        this._stageId = stageId;

        if (this.labelLevel) {
            this.labelLevel.string = String(stageId);
        }

        const locked = state === LevelState.Locked;
        const cleared = CampaignProgress.getStars(stageId) > 0;

        if (this.nodeLock) this.nodeLock.active = locked;
        if (this.nodePassed) this.nodePassed.active = cleared && !locked;

        if (this.spriteBackground) {
            this.spriteBackground.color = locked
                ? this.colorLocked
                : (cleared ? this.colorPassed : this.colorUnlocked);
        }

        const button = this.getComponent(Button);
        if (button) button.interactable = !locked;

        this._refreshStars(stageId, locked);
        this._refreshName(stageId);
    }

    /** Optional stage title under the number (only when a `Name` label exists). */
    private _refreshName(stageId: number): void {
        if (!this.labelName) return;
        const stage = CAMPAIGN_STAGES[stageId - 1];
        if (!stage) {
            this.labelName.string = '';
            return;
        }
        const text = I18n.t(stage.nameKey);
        this.labelName.string = text === stage.nameKey ? '' : text;
    }

    /** Compact update used when returning from the game scene. */
    public refresh(): void {
        if (this._stageId <= 0) return;
        const unlocked = CampaignProgress.isUnlocked(this._stageId);
        const stars = CampaignProgress.getStars(this._stageId);
        const state = stars > 0
            ? LevelState.Passed
            : (unlocked ? LevelState.Unlocked : LevelState.Locked);
        this.setStage(this._stageId, state);
    }

    private _refreshStars(stageId: number, locked: boolean): void {
        const row = this._ensureStarRow();
        if (!row) return;
        row.active = !locked;
        const earned = locked ? 0 : CampaignProgress.getStars(stageId);
        for (let i = 0; i < this._stars.length; i++) {
            this._stars[i].color = i < earned ? STAR_ON : STAR_OFF;
        }
    }

    /** Builds (once) a centred row of three star labels. */
    private _ensureStarRow(): Node | null {
        if (this._stars.length === 3) {
            return this._stars[0]?.node?.parent ?? null;
        }
        let row = this.node.getChildByName('Stars');
        if (!row) {
            row = new Node('Stars');
            row.layer = this.node.layer;
            this.node.addChild(row);
            row.setPosition(0, this.starRowY, 0);
        }
        for (let i = 0; i < 3; i++) {
            const starNode = new Node(`Star${i + 1}`);
            starNode.layer = this.node.layer;
            row.addChild(starNode);
            starNode.setPosition((i - 1) * 20, 0, 0);
            const label = starNode.addComponent(Label);
            label.string = '★';
            label.fontSize = 22;
            label.lineHeight = 24;
            label.useSystemFont = true;
            label.color = STAR_OFF;
            this._stars.push(label);
        }
        return row;
    }

    /** Small pop used when a stage becomes unlocked. */
    public playUnlockPop(): void {
        if (!this.node?.isValid) return;
        this.node.setScale(0.9, 0.9, 1);
        tween(this.node)
            .to(0.16, { scale: new Vec3(1.06, 1.06, 1) })
            .to(0.12, { scale: new Vec3(1, 1, 1) })
            .start();
    }
}
