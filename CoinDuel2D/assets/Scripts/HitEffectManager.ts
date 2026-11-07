import { _decorator, Component, Node, Vec2, Vec3, Prefab, instantiate, Camera, Sprite, SpriteFrame, RenderTexture, UITransform, Animation, Color, tween, RigidBody2D, ERigidBody2DType, ParticleSystem2D } from 'cc';
import { GameLogic } from './GameLogic';
import { CoinController } from './CoinController';
import { EffectGoHelper } from './EffectGoHelper';
import { HitLight2 } from './HitLight2';
import { ArmHit } from './Effects/ArmHit';
import { Tornado } from './Effects/Tornado';
const { ccclass, property } = _decorator;

/**
 * 击中特效管理器 — 可独立开关的模块化特效系统。
 * 每个特效由独立的布尔开关控制，可在编辑器面板中自由组装。
 */
@ccclass('HitEffectManager')
export class HitEffectManager extends Component {

    // ══════════════════════════════════════════
    //  特效开关（可在编辑器自由组合）
    // ══════════════════════════════════════════

    // ── 蓄力阶段 ──
    @property({ tooltip: "蓄力时镜头根据拖拽距离拉近" })
    public enableDragZoom: boolean = true;

    @property({ tooltip: "蓄力时预测目标硬币并高亮为红色" })
    public enableDragPrediction: boolean = true;

    // ── 发射阶段 ──
    @property({ tooltip: "发射时播放蓄力完毕特效（effect_launch）" })
    public enableLaunchEffect: boolean = true;

    @property({ tooltip: "发射后进入慢动作" })
    public enableSlowMotion: boolean = true;

    @property({ tooltip: "发射后主镜头追踪发射硬币" })
    public enableLaunchTracking: boolean = true;

    // ── 击中阶段 ──
    @property({ tooltip: "击中时物理暂停" })
    public enableHitPause: boolean = true;

    @property({ tooltip: "击中时屏幕震动" })
    public enableHitShake: boolean = true;

    @property({ tooltip: "击中时飞溅粒子特效" })
    public enableHitParticle: boolean = true;

    @property({ tooltip: "击中时子画面镜头（PIP 特写）" })
    public enableHitSubCamera: boolean = false;

    @property({ tooltip: "击中后主镜头追踪被撞硬币" })
    public enableHitTracking: boolean = true;

    // ══════════════════════════════════════════
    //  参数
    // ══════════════════════════════════════════

    // ── 摄像机过渡（通用） ──
    @property({ tooltip: "镜头拉近过渡时长（秒）" })
    public cameraZoomInDuration: number = 0.5;

    @property({ tooltip: "镜头恢复过渡时长（秒）" })
    public cameraZoomOutDuration: number = 0.5;

    // ── 发射特效 ──
    @property({ type: Prefab, tooltip: "发射特效预制体（effect_launch）" })
    public launchEffectPrefab: Prefab | null = null;

    @property({ tooltip: "发射特效动画播放速度倍率" })
    public launchAnimSpeed: number = 1;

    // ── 击中暂停 ──
    @property({ tooltip: "击中暂停时长（秒）" })
    public hitPauseDuration: number = 0.01;

    // ── 击中粒子 ──
    @property({ type: Prefab, tooltip: "击中飞溅粒子预制体（particle_hit）" })
    public hitParticlePrefab: Prefab | null = null;

    // ── 击中镜头追踪 ──
    @property({ tooltip: "击中后追踪被撞硬币的时长（秒）" })
    public cameraTrackDuration: number = 2.0;

    // ── 子画面 ──
    @property({ type: Node, tooltip: "子画面挂载节点（panel），特效开启时在此节点上显示特写画面" })
    public subViewNode: Node | null = null;

    @property({ tooltip: "子画面摄像机 orthoHeight（越小画面越放大）" })
    public subCameraOrthoHeight: number = 80;

    @property({ tooltip: "子画面宽度" })
    public subViewWidth: number = 256;

    @property({ tooltip: "子画面高度" })
    public subViewHeight: number = 256;

    @property({ tooltip: "子画面显示时长（秒）" })
    public subViewDuration: number = 2.0;

    // ── 被打飞特效（击中后，被撞硬币 B 旋转手臂将发射硬币 A 打飞出界） ──
    @property({ tooltip: "击中后由被撞硬币旋转手臂将发射硬币打飞出场外" })
    public enableKnockOut: boolean = true;

    @property({ type: Prefab, tooltip: "手臂旋转特效预制体（effect_arm_hit）" })
    public armHitPrefab: Prefab | null = null;

    @property({ tooltip: "手臂转动一圈的时长（秒）" })
    public armHitDuration: number = 0.8;

    @property({ tooltip: "被打击飞硬币飞出场外的时长（秒）" })
    public knockFlyDuration: number = 0.5;

    // ── 龙卷风特效（硬币被击打消失时，桌面中央播放） ──
    @property({ tooltip: "硬币被击打消失时在桌面中央播放龙卷风特效" })
    public enableTornado: boolean = true;

    @property({ type: Prefab, tooltip: "龙卷风特效预制体（Tornado）" })
    public tornadoPrefab: Prefab | null = null;

    @property({ tooltip: "龙卷风持续时长（秒）" })
    public tornadoDuration: number = 3;

    @property({ tooltip: "龙卷风整体缩放倍数" })
    public tornadoScale: number = 1.2;

    // ══════════════════════════════════════════
    //  运行时状态
    // ══════════════════════════════════════════

    /** 蓄力拖拽距离 */
    private _dragDistance: number = 0;
    /** 当前发射硬币 */
    private _activeShotCoin: Node | null = null;

    // ── 击中停顿用 ──
    public isHitPausing: boolean = false;

    // ── 击中震动用 ──
    public isShaking: boolean = false;
    public shakeStartTime: number = 0;
    public shakeEndTime: number = 0;
    public shakeDir: Vec2 = new Vec2(1, 0);
    /** 上一幀已經加到相機上的震動。下一幀先扣掉，避免一次次疊加。 */
    private _shakeOffset: Vec2 = new Vec2();

    // ── 碰撞后追踪用 ──
    public isTrackingHitCoin: boolean = false;
    public trackTargetNode: Node | null = null;
    public trackStartTime: number = 0;

    /** 摄像机是否在原始位置（无追踪、无恢复动作） */
    public isCameraAtRest: boolean = true;

    // ── 子画面预创建 ──
    private _subCamNode: Node | null = null;
    private _subCam: Camera | null = null;
    private _renderTex: RenderTexture | null = null;
    private _subViewContentSprite: Sprite | null = null;

    // ══════════════════════════════════════════
    //  生命周期
    // ══════════════════════════════════════════

    protected start(): void {
        if (this.enableHitSubCamera) {
            this._initSubViewResources();
        }
    }

    /** 预先创建子画面 Camera + RenderTexture */
    private _initSubViewResources(): void {
        if (!this.subViewNode) return;

        const subCamNode = new Node('_SubCamera');
        subCamNode.layer = 1;
        subCamNode.active = false;
        const parent = this.node.parent;
        if (parent) parent.addChild(subCamNode);
        else return;

        const subCam = subCamNode.addComponent(Camera);
        subCam.projection = Camera.ProjectionType.ORTHO;
        subCam.orthoHeight = this.subCameraOrthoHeight;
        subCam.clearFlags = 7;
        subCam.priority = 10;
        subCam.visibility = 1;

        const renderTex = new RenderTexture();
        renderTex.reset({ width: this.subViewWidth, height: this.subViewHeight });
        subCam.targetTexture = renderTex;

        const spriteNode = new Node('SubViewContent');
        spriteNode.layer = 33554432;
        spriteNode.active = true;

        const ut = spriteNode.addComponent(UITransform);
        ut.setContentSize(this.subViewWidth, this.subViewHeight);

        const sprite = spriteNode.addComponent(Sprite);
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        const sf = new SpriteFrame();
        sf.texture = renderTex;
        sprite.spriteFrame = sf;

        this.subViewNode.addChild(spriteNode);

        this._subCamNode = subCamNode;
        this._subCam = subCam;
        this._renderTex = renderTex;
        this._subViewContentSprite = sprite;
    }

    // ══════════════════════════════════════════
    //  公开 API（由 GameLogic / CoinController 调用）
    // ══════════════════════════════════════════

    /** 设置蓄力拖拽距离 */
    public setDragDistance(dist: number): void {
        if (!this.enableDragZoom) return;
        this._dragDistance = dist;
    }

    /** 硬币发射时调用，触发发射阶段特效 */
    public onLaunch(coin: Node, gl: GameLogic): void {
        this._activeShotCoin = coin;

        if (this.enableLaunchEffect && this.launchEffectPrefab) {
            this._playLaunchEffect(coin, gl);
        }

        if (this.enableSlowMotion) {
            gl.setGameSpeed(0.3);
        } else {
            gl.setGameSpeed(1);
        }
        // 发射追踪由 updateCamera 根据 enableLaunchTracking 控制
    }

    /** 首次击中时调用，触发击中阶段特效 */
    public onHit(hitPos: Vec3, hitCoin: Node, shotCoin: Node | null, gl: GameLogic): void {
        if (this.isHitPausing) return;

        if (this.enableHitPause) {
            this._doHitPause(hitPos, hitCoin, shotCoin, gl);
        } else {
            // 无暂停，直接触发其他特效
            const dir = this._calcShakeDir(hitCoin, shotCoin);
            if (this.enableHitParticle && this.hitParticlePrefab) {
                this._spawnParticle(hitPos, dir, gl);
            }
            if (this.enableHitShake) {
                this._startShake(0.05, dir);
            }
            if (this.enableHitSubCamera) {
                this._showSubCamera(hitPos);
            }
            if (this.enableHitTracking) {
                this._startTrackHitCoin(hitCoin);
            }
        }
    }

    /**
     * 预测发射硬币将会撞击的第一个硬币基于圆扫掠检测。
     * 从发射硬币位置沿方向步进，检查移动圆是否与目标圆相交。
     * @param fromPos 发射硬币世界坐标
     * @param direction 发射方向（归一化向量）
     * @param radius 硬币半径
     * @param maxDistance 最大搜索距离
     */
    public predictHitCoin(fromPos: Vec3, direction: Vec2, radius: number = 32, maxDistance: number = 2000): Node | null {
        const minDist = radius * 2;
        const stepSize = radius; // 每一步约一个半径，不漏检

        // 收集所有硬币（排除自身用 fromPos 近似判断）
        const targets: { pos: Vec2; node: Node }[] = [];
        const gl = this.node.parent?.getComponent(GameLogic)
                  ?? this.getComponent(GameLogic);
        if (gl?.coinGroup) {
            for (const child of gl.coinGroup.children) {
                const ddx = child.position.x - fromPos.x;
                const ddy = child.position.y - fromPos.y;
                if (ddx * ddx + ddy * ddy > 10) { // 排除自身
                    targets.push({ pos: new Vec2(child.position.x, child.position.y), node: child });
                }
            }
        }

        let px = fromPos.x + direction.x * (radius + 1);
        let py = fromPos.y + direction.y * (radius + 1);
        let dist = 0;

        while (dist < maxDistance) {
            for (const t of targets) {
                const dx = px - t.pos.x;
                const dy = py - t.pos.y;
                if (dx * dx + dy * dy < minDist * minDist) {
                    return t.node;
                }
            }
            px += direction.x * stepSize;
            py += direction.y * stepSize;
            dist += stepSize;
        }
        return null;
    }

    private _foulActive = false;
    private _foulDone: (() => void) | null = null;

    /**
     * 打到兩枚以上：先以 0.3 倍速看 0.3 秒，第二枚硬幣閃紅，
     * 滿 1 秒才通知結算。點擊重開時可 cancelFoulReplay。
     */
    public playFoulReplay(coin: Node | null, onDone: () => void): void {
        this.cancelFoulReplay();
        this._foulActive = true;
        this._foulDone = onDone;
        const gl = this.node.parent?.getComponent(GameLogic) ?? this.getComponent(GameLogic);
        gl?.setGameSpeed(0.3);
        this.scheduleOnce(this._endFoulSlow, 0.3);
        this._flashFoulCoin(coin);
        this.scheduleOnce(this._finishFoulReplay, 1);
    }

    public cancelFoulReplay(): void {
        if (!this._foulActive) return;
        this.unschedule(this._endFoulSlow);
        this.unschedule(this._finishFoulReplay);
        this._foulActive = false;
        this._foulDone = null;
        const gl = this.node.parent?.getComponent(GameLogic) ?? this.getComponent(GameLogic);
        gl?.restoreSpeed();
    }

    private _endFoulSlow = (): void => {
        const gl = this.node.parent?.getComponent(GameLogic) ?? this.getComponent(GameLogic);
        gl?.restoreSpeed();
    };

    private _finishFoulReplay = (): void => {
        this._foulActive = false;
        const done = this._foulDone;
        this._foulDone = null;
        done?.();
    };

    private _flashFoulCoin(coin: Node | null): void {
        const sprite = coin?.isValid ? CoinController.getCoinSprite(coin) : null;
        if (!sprite) return;
        const base = sprite.color.clone();
        tween(sprite)
            .to(0.12, { color: new Color(255, 30, 30, 255) })
            .to(0.12, { color: new Color(255, 255, 255, 255) })
            .union()
            .repeat(3)
            .call(() => {
                if (sprite.isValid) sprite.color = base;
            })
            .start();
    }

    /** 停止追踪 */
    public stopTracking(): void {
        this.isTrackingHitCoin = false;
        this.trackTargetNode = null;
        this._activeShotCoin = null;
    }

    /**
     * 被打飞特效：由被撞硬币 B 加载手臂特效旋转一圈，将发射硬币 A 打飞出界。
     * @param shotCoin  发射硬币（A，被打飞）
     * @param hitCoin   被撞硬币（B，加载手臂特效）
     * @param onDone    特效结束后回调（用于后续结算）
     */
    public playKnockOut(shotCoin: Node, hitCoin: Node, onDone: () => void): void {
        // 硬币被击打消失时，在消失硬币（发射硬币 A）所在位置播放龙卷风特效（不依赖打飞开关）。
        // 龙卷风粒子 texture 使用当前消失硬币（发射硬币 A）配置文件中的默认贴图。
        const coinFrame = shotCoin.getComponent(CoinController)?.defaultFrame ?? null;
        this._spawnTornado(shotCoin.position, undefined, coinFrame);

        if (this.enableKnockOut && this.armHitPrefab) {
            const armNode = instantiate(this.armHitPrefab);
            hitCoin.addChild(armNode);
            armNode.setPosition(0, 0, 0); // 手臂绕 B 中心旋转

            const arm = armNode.getComponent(ArmHit);
            if (arm) {
                arm.duration = this.armHitDuration;
                arm.play(shotCoin, onDone, this.knockFlyDuration);
            } else {
                this._fadeOutCoin(shotCoin, onDone);
            }
        } else {
            // 无手臂特效（临时屏蔽时）：让发射硬币在龙卷风期间逐渐透明后删除
            this._fadeOutCoin(shotCoin, onDone);
        }
    }

    /** 让目标硬币关闭物理后逐渐透明，最后删除并触发结算回调 */
    private _fadeOutCoin(target: Node, onDone: () => void): void {
        // 关闭物理（只保留视觉，位置保持不变）
        const rb = target.getComponent(RigidBody2D);
        if (rb) rb.type = ERigidBody2DType.Static;

        // 标记为"正在被打飞"，避免被 checkCoinFalls 误判为掉进缺口
        const ctrl = target.getComponent(CoinController);
        if (ctrl) ctrl.isKnockingOut = true;

        const dur = Math.max(0.05, this.knockFlyDuration);
        const sprite = CoinController.getCoinSprite(target);
        if (sprite) {
            tween(sprite)
                .to(dur, { color: new Color(255, 255, 255, 0) }, { easing: 'quadOut' })
                .call(() => {
                    target.removeFromParent();
                    target.destroy();
                    onDone();
                })
                .start();
        } else {
            target.removeFromParent();
            target.destroy();
            onDone();
        }
    }

    /**
     * 在指定位置播放龙卷风特效（一次性，持续 tornadoDuration 秒后自动销毁）。
     * @param pos         世界坐标；缺省时使用桌面中央（CoinGroup 原点）。
     * @param scale       整体缩放倍数；缺省时使用组件上的 tornadoScale。
     * @param spriteFrame 粒子 texture；缺省时使用 Tornado 预制体自带的贴图。
     * Tornado.release() 会按传入的 duration 自动播放、淡出并销毁自身。
     */
    private _spawnTornado(pos?: Vec3, scale?: number, spriteFrame?: SpriteFrame | null): void {
        if (!this.enableTornado || !this.tornadoPrefab) return;

        const gl = this.node.parent?.getComponent(GameLogic)
                   ?? this.getComponent(GameLogic);
        if (!gl) return;

        const node = instantiate(this.tornadoPrefab);
        gl.addChildToWorld(node);

        // billboard 着色器采样的是材质的 mainTexture，而不是粒子系统 spriteFrame 的纹理，
        // 所以换贴图必须改材质。这里对每个粒子系统取材质实例（继承共享材质、不影响共享资产，
        // 也不会影响 particle_hit / hit_light_2 等共用同一材质的特效），单独设置主纹理为当前硬币贴图。
        if (spriteFrame) {
            const texture = spriteFrame.texture;
            if (texture) {
                for (const ps of node.getComponentsInChildren(ParticleSystem2D)) {
                    const mat = ps.getMaterialInstance(0);
                    if (mat) mat.setProperty('mainTexture', texture);
                }
            }
        }

        const center = pos ?? (gl.coinGroup ? gl.coinGroup.position : new Vec3(0, 0, 0));

        const tornado = node.getComponent(Tornado);
        if (tornado) {
            tornado.release(new Vec3(center.x, center.y, 0), scale ?? this.tornadoScale, this.tornadoDuration);
        } else {
            node.setPosition(center);
        }
    }

    /** 测试钩子：在指定世界坐标以指定缩放播放龙卷风（点击桌面空白处时由 GameLogic 调用） */
    public playTestTornado(pos: Vec3, scale?: number): void {
        this._spawnTornado(pos, scale);
    }

    /**
     * 每帧更新摄像机行为
     */
    public updateCamera(
        dt: number,
        camNode: Node,
        camComp: Camera,
        origPos: Vec3,
        defaultOrthoHeight: number,
        isSlowMotion: boolean,
    ): void {
        this._clearShakeOffset(camNode);

        // ── 发射追踪 ──
        if (this.enableLaunchTracking && isSlowMotion && this._activeShotCoin?.isValid) {
            this._trackTarget(dt, camNode, this._activeShotCoin.position, this.cameraZoomInDuration);
        }
        // ── 碰撞后追踪 ──
        else if (this.enableHitTracking && this.isTrackingHitCoin && this.trackTargetNode?.isValid) {
            this._trackTarget(dt, camNode, this.trackTargetNode.position, this.cameraZoomOutDuration);
            if (Date.now() - this.trackStartTime >= this.cameraTrackDuration * 1000) {
                this.stopTracking();
            }
        }
        // ── 蓄力拉近 ──
        else if (this.enableDragZoom && this._dragDistance > 0) {
            this._restorePosition(dt, camNode, origPos, this.cameraZoomOutDuration);
            this._applyDragZoom(dt, camComp, defaultOrthoHeight);
        }
        // ── 空闲恢复 ──
        else {
            this._restorePosition(dt, camNode, origPos, this.cameraZoomOutDuration);
            this._restoreOrthoHeight(dt, camComp, defaultOrthoHeight, this.cameraZoomOutDuration);
        }

        // ── 判断摄像机是否回到原始位置（无追踪、无拖拽、位置/缩放已稳定） ──
        if (!isSlowMotion && !this.isTrackingHitCoin && this._dragDistance === 0) {
            const pos = camNode.position;
            const dx = origPos.x - pos.x;
            const dy = origPos.y - pos.y;
            const dh = defaultOrthoHeight - camComp.orthoHeight;
            this.isCameraAtRest = (dx * dx + dy * dy <= 0.1 && Math.abs(dh) <= 0.1);
        } else {
            this.isCameraAtRest = false;
        }

        // ── 屏幕震动：加在這一幀的乾淨位置上，結束時偏移為 0 ──
        if (this.isShaking) {
            const elapsed = Date.now() - this.shakeStartTime;
            const duration = this.shakeEndTime - this.shakeStartTime;
            if (elapsed < duration && duration > 0) {
                const progress = elapsed / duration;
                const amplitude = Math.sin(progress * Math.PI * 2) * 4 * (1 - progress);
                this._shakeOffset.set(this.shakeDir.x * amplitude, this.shakeDir.y * amplitude);
                const pos = camNode.position;
                camNode.setPosition(pos.x + this._shakeOffset.x, pos.y + this._shakeOffset.y, pos.z);
            } else {
                this.isShaking = false;
                this._shakeOffset.set(0, 0);
            }
        }
    }

    /** 追蹤和回位都看不含震動的位置。 */
    private _clearShakeOffset(camNode: Node): void {
        if (this._shakeOffset.x === 0 && this._shakeOffset.y === 0) return;
        const pos = camNode.position;
        camNode.setPosition(pos.x - this._shakeOffset.x, pos.y - this._shakeOffset.y, pos.z);
        this._shakeOffset.set(0, 0);
    }

    // ══════════════════════════════════════════
    //  发射阶段特效
    // ══════════════════════════════════════════

    /** 播放蓄力完毕特效 */
    private _playLaunchEffect(coin: Node, gl: GameLogic): void {
        const effectNode = instantiate(this.launchEffectPrefab!);
        effectNode.setPosition(coin.position);
        gl.addChildToWorld(effectNode);

        const anim = effectNode.getComponent(Animation);
        if (anim) {
            const helper = effectNode.addComponent(EffectGoHelper);
            helper.onGo = () => {
                this._dragDistance = 0;
            };
            const animState = anim.getState(anim.defaultClip?.name ?? '');
            if (animState) animState.speed = this.launchAnimSpeed;
            anim.play();
        }
    }

    // ══════════════════════════════════════════
    //  击中阶段特效
    // ══════════════════════════════════════════

    /** 击中停顿 + 连锁特效 */
    private _doHitPause(hitPos: Vec3, hitCoin: Node, shotCoin: Node | null, gl: GameLogic): void {
        this.isHitPausing = true;

        // 先播放撞击效果（按冲击方向旋转）
        if (this.enableHitParticle && this.hitParticlePrefab) {
            this._spawnParticle(hitPos, this._calcShakeDir(hitCoin, shotCoin), gl);
        }

        // 再暂停物理
        gl.setGameSpeed(0);

        if (this.enableHitShake) {
            this._startShake(this.hitPauseDuration, this._calcShakeDir(hitCoin, shotCoin));
        }
        if (this.enableHitSubCamera) {
            this._showSubCamera(hitPos);
        }

        this.scheduleOnce(() => {
            this.isHitPausing = false;
            gl.restoreSpeed();

            if (this.enableHitTracking) {
                this._startTrackHitCoin(hitCoin);
            }
        }, this.hitPauseDuration);
    }

    /** 生成飞溅粒子（按冲击方向旋转，默认朝上） */
    private _spawnParticle(pos: Vec3, dir: Vec2, gl: GameLogic): void {
        const node = instantiate(this.hitParticlePrefab!);
        gl.addChildToWorld(node);
        node.setPosition(pos);
        // 方向朝上 (0,1)，旋转到冲击方向
        const angle = Math.atan2(dir.y, dir.x) * 180 / Math.PI - 90;
        node.eulerAngles = new Vec3(0, 0, angle);

        let hitlight:HitLight2 = node.getComponent(HitLight2);
        if (hitlight){
            hitlight.play(0.2);
        }
    }

    /** 开启子画面摄像机 */
    private _showSubCamera(hitPos: Vec3): void {
        if (this._subCamNode && this._subCam) {
            this._subCamNode.setPosition(hitPos.x, hitPos.y, 300);
            this._subCamNode.active = true;
        }
        if (this.subViewNode) {
            this.subViewNode.active = true;
        }
        // 子画面延时关闭
        this.scheduleOnce(() => {
            if (this._subCamNode) this._subCamNode.active = false;
            if (this.subViewNode) this.subViewNode.active = false;
        }, this.subViewDuration);
    }

    // ══════════════════════════════════════════
    //  原子工具方法
    // ══════════════════════════════════════════

    private _calcShakeDir(hitCoin: Node, shotCoin: Node | null): Vec2 {
        const dir = new Vec2(
            hitCoin.position.x - (shotCoin?.position.x ?? 0),
            hitCoin.position.y - (shotCoin?.position.y ?? 0),
        );
        const len = dir.length();
        if (len > 0.001) { dir.x /= len; dir.y /= len; }
        return dir;
    }

    /** 公开：触发一次方向性摄像机震动 */
    public shakeCamera(duration: number, dir: Vec2): void {
        this._startShake(duration, dir);
    }

    private _startShake(duration: number, dir: Vec2): void {
        this.isShaking = true;
        this.shakeStartTime = Date.now();
        this.shakeEndTime = this.shakeStartTime + duration * 1000;
        this.shakeDir.set(dir);
    }

    private _startTrackHitCoin(coin: Node): void {
        this.isTrackingHitCoin = true;
        this.trackTargetNode = coin;
        this.trackStartTime = Date.now();
    }

    private _trackTarget(dt: number, camNode: Node, targetPos: Vec3, duration: number): void {
        const factor = 3 / Math.max(duration, 0.001);
        const t = Math.min(1, dt * factor);
        const pos = camNode.position;
        camNode.setPosition(
            pos.x + (targetPos.x - pos.x) * t,
            pos.y + (targetPos.y - pos.y) * t,
            camNode.position.z,
        );
    }

    private _restorePosition(dt: number, camNode: Node, origPos: Vec3, duration: number): void {
        const factor = 3 / Math.max(duration, 0.001);
        const t = Math.min(1, dt * factor);
        const pos = camNode.position;
        const dx = origPos.x - pos.x;
        const dy = origPos.y - pos.y;
        const distSq = dx * dx + dy * dy;
        if (distSq > 0.1) {
            camNode.setPosition(pos.x + dx * t, pos.y + dy * t, origPos.z);
        } else {
            camNode.setPosition(origPos);
        }
    }

    private _restoreOrthoHeight(dt: number, camComp: Camera, targetH: number, duration: number): void {
        const curH = camComp.orthoHeight;
        const diff = targetH - curH;
        if (Math.abs(diff) > 0.1) {
            const t = Math.min(1, dt * 3 / Math.max(duration, 0.001));
            camComp.orthoHeight = curH + diff * t;
        } else {
            camComp.orthoHeight = targetH;
        }
    }

    private _applyDragZoom(dt: number, camComp: Camera, defaultOrthoHeight: number): void {
        const targetH = Math.max(50, defaultOrthoHeight - this._dragDistance * 0.1);
        this._restoreOrthoHeight(dt, camComp, targetH, this.cameraZoomInDuration);
    }
}
