import { _decorator, AudioClip, AudioSource, Component, director, Node, resources } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('SoundManager')
export class SoundManager extends Component {
    public static instance: SoundManager = null;

    @property(AudioClip)
    public collisionWall: AudioClip = null;

    @property(AudioClip)
    public collisionCoin: AudioClip = null;

    @property(AudioClip)
    public shot: AudioClip = null;

    @property(AudioClip)
    public coinfall: AudioClip = null;

    @property(AudioClip)
    public coindrag: AudioClip = null;

    @property(AudioClip)
    public negative: AudioClip = null;

    @property(AudioClip)
    public dragIncrease: AudioClip = null;

    @property(AudioClip)
    public dragDecrease: AudioClip = null;

    @property(AudioClip)
    public dragRelease: AudioClip = null;

    @property(AudioClip)
    public explosion: AudioClip = null;
    @property(AudioClip)
    public secondaryCollision: AudioClip = null;

    @property({ tooltip: 'BGM 淡入淡出时长（秒）' })
    public bgmFadeDuration: number = 0.5;

    @property({ tooltip: 'BGM 目标音量 (0~1)', range: [0, 1, 0.01] })
    public bgmTargetVolume: number = 0.7;

    private audioSource: AudioSource = null;
    /** 专门用于拖拽方向循环音效的独立 AudioSource（避免与主音效冲突） */
    private _dirLoopSource: AudioSource = null;
    /** 当前循环播放的方向音效 clip */
    private _dirLoopClip: AudioClip = null;

    private _bgmSource: AudioSource = null;
    private _pitchCtx: any = null;
    private readonly _pitchBuffers = new Map<string, any>();
    private _currentBgmId: number = -1;
    /** 最近一次请求播放的 BGM id，关闭音乐后重新打开时恢复 */
    private _lastBgmId: number = 1;
    /** 音乐开关（用户可通过 UI 切换） */
    private _musicEnabled: boolean = true;
    private _bgmFadeTimer: number = 0;
    private _bgmFadingIn: boolean = false;
    private _bgmFadingOut: boolean = false;
    private _bgmFadeOutCallback: (() => void) | null = null;

    protected onLoad(): void {
        SoundManager.instance = this;
        // 跨场景持久化
        director.addPersistRootNode(this.node);
        this.audioSource = this.getComponent(AudioSource);
        // 动态创建独立的方向循环音源
        const node = this.node;
        let src = node.getComponent(AudioSource);
        if (src && src !== this.audioSource) {
            this._dirLoopSource = src;
        } else {
            this._dirLoopSource = node.addComponent(AudioSource);
        }
        // BGM 专用音源
        this._bgmSource = node.addComponent(AudioSource);
    }

    protected update(dt: number): void {
        this._updateBGMFade(dt);
    }

    /** 硬币与硬币碰撞 */
    public playCollisionWall() {
        if (this.collisionWall && this.audioSource) {
            this.audioSource.playOneShot(this.collisionWall);
        }
    }

    /**
     * 硬幣互撞。pitchMultiplier 依連鎖升高：
     * 1.0 → 1.08 → 1.16 → 1.24…
     */
    public playCollisionCoin(pitchMultiplier = 1): void {
        this._playPitched(this.collisionCoin, pitchMultiplier);
    }

    public playSecondaryCollision(pitchMultiplier = 1): void {
        this._playPitched(this.secondaryCollision, pitchMultiplier);
    }

    /** 硬币发射 */
    public playShot(pitchMultiplier = 1): void {
        this._playPitched(this.shot, pitchMultiplier);
    }

    /** 爆炸音效 */
    public playExplosion() {
        if (this.explosion && this.audioSource) {
            this.audioSource.playOneShot(this.explosion);
        }
    }

    public playCoinFall() {
        if (this.coinfall && this.audioSource) {
            this.audioSource.playOneShot(this.coinfall);
        }
    }

    /** 播放任意 AudioClip。第二個參數只在發射音要升調時使用。 */
    public playClip(clip: AudioClip, pitchMultiplier = 1): void {
        this._playPitched(clip, pitchMultiplier);
    }

    /** 原調走原來的一次性播放。升調時用 Web Audio 改 playbackRate。 */
    private _playPitched(clip: AudioClip | null, pitchMultiplier: number): void {
        if (!clip || !this.audioSource) return;
        const pitch = Math.min(2.4, Math.max(0.5, pitchMultiplier));
        if (Math.abs(pitch - 1) <= 0.001) {
            this.audioSource.playOneShot(clip);
            return;
        }
        const cached = this._cachedPitchBuffer(clip);
        if (cached) {
            this._startPitched(cached, pitch);
            return;
        }
        const url = clip.nativeUrl;
        const ctx = this._pitchContext();
        if (!url || !ctx) {
            this.audioSource.playOneShot(clip);
            return;
        }
        fetch(url)
            .then((res) => res.arrayBuffer())
            .then((data) => ctx.decodeAudioData(data))
            .then((decoded: any) => {
                this._pitchBuffers.set(url, decoded);
                this._startPitched(decoded, pitch);
            })
            .catch(() => {
                this.audioSource?.playOneShot(clip);
            });
    }

    private _pitchContext(): any | null {
        const host: any = typeof window !== 'undefined' ? window : null;
        const Ctor = host?.AudioContext || host?.webkitAudioContext;
        if (!Ctor) return null;
        if (!this._pitchCtx) this._pitchCtx = new Ctor();
        if (this._pitchCtx.state === 'suspended') this._pitchCtx.resume();
        return this._pitchCtx;
    }

    private _cachedPitchBuffer(clip: AudioClip): any | null {
        const url = clip.nativeUrl;
        if (url && this._pitchBuffers.has(url)) return this._pitchBuffers.get(url);
        const embedded = (clip as any)?._nativeAsset?.player?._buffer;
        if (embedded && url) this._pitchBuffers.set(url, embedded);
        return embedded ?? null;
    }

    private _startPitched(buffer: any, pitch: number): void {
        const ctx = this._pitchContext();
        if (!ctx) return;
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.playbackRate.value = pitch;
        const gain = ctx.createGain();
        gain.gain.value = this.audioSource?.volume ?? 1;
        source.connect(gain);
        gain.connect(ctx.destination);
        source.start();
    }

    /** 游戏结束音效 */
    public playGameOver(): void {
        resources.load('sounds/gameover', AudioClip, (err: any, clip: AudioClip) => {
            if (!err && clip && this.audioSource) {
                this.audioSource.playOneShot(clip);
            }
        });
    }

    /** 播放一次拖拽音效（若已在播放则跳过） */
    public startCoinDrag(): void {
        if (!this.coindrag || !this.audioSource) return;
        if (this.audioSource.playing) return;
        this.audioSource.clip = this.coindrag;
        this.audioSource.play();
    }

    /** 播放一次拒绝音效（one-shot，可与拖拽音效叠加） */
    public startNegative(): void {
        if (!this.negative || !this.audioSource) return;
        this.audioSource.playOneShot(this.negative);
    }

    /** 开始循环播放拖拽增加音效（若已在循环则跳过，不刷屏） */
    public startDragIncreaseLoop(): void {
        if (this.dragIncrease && this._dirLoopSource) {
            if (this._dirLoopClip === this.dragIncrease && this._dirLoopSource.playing) return;
            this._dirLoopSource.stop();
            this._dirLoopSource.clip = this.dragIncrease;
            this._dirLoopSource.loop = true;
            this._dirLoopSource.play();
            this._dirLoopClip = this.dragIncrease;
        }
    }

    /** 开始循环播放拖拽减少音效（若已在循环则跳过，不刷屏） */
    public startDragDecreaseLoop(): void {
        if (this.dragDecrease && this._dirLoopSource) {
            if (this._dirLoopClip === this.dragDecrease && this._dirLoopSource.playing) return;
            this._dirLoopSource.stop();
            this._dirLoopSource.clip = this.dragDecrease;
            this._dirLoopSource.loop = true;
            this._dirLoopSource.play();
            this._dirLoopClip = this.dragDecrease;
        }
    }

    /** 停止拖拽方向循环音效 */
    public stopDragDirectionLoop(): void {
        if (this._dirLoopSource && this._dirLoopClip) {
            this._dirLoopSource.stop();
            this._dirLoopSource.clip = null;
            this._dirLoopClip = null;
        }
    }

    /** 松开音效 */
    public playDragRelease(): void {
        if (this.dragRelease && this.audioSource) this.audioSource.playOneShot(this.dragRelease);
    }

    /** 音乐开关是否开启 */
    public get musicEnabled(): boolean {
        return this._musicEnabled;
    }

    /** 设置音乐开关；开启时恢复最近一首 BGM */
    public setMusicEnabled(enabled: boolean): boolean {
        this._musicEnabled = enabled;
        if (enabled) {
            this.playBGM(this._lastBgmId);
        } else {
            this.stopBGM();
        }
        return this._musicEnabled;
    }

    /** 切换音乐开关，返回切换后的状态 */
    public toggleMusic(): boolean {
        return this.setMusicEnabled(!this._musicEnabled);
    }

    public playBGM(id: number): void {
        this._lastBgmId = id;
        // 用户关闭了音乐：只记录 id，不实际播放
        if (!this._musicEnabled) return;

        // 同一首 BGM 正在播放且未在淡出，跳过
        if (id === this._currentBgmId && this._bgmSource && this._bgmSource.playing && !this._bgmFadingOut) {
            return;
        }
        // 取消正在进行的淡入淡出
        this._bgmFadingIn = false;
        this._bgmFadingOut = false;
        this._bgmFadeOutCallback = null;

        const doLoad = () => { this._loadAndPlayBGM(id); };

        // 当前有 BGM 在播，先淡出再切换
        if (this._bgmSource && this._bgmSource.playing) {
            this._startFadeOut(doLoad);
        } else {
            doLoad();
        }
    }

    public stopBGM(): void {
        if (!this._bgmSource || !this._bgmSource.playing) return;
        this._startFadeOut(() => {
            if (this._bgmSource) {
                this._bgmSource.stop();
                this._bgmSource.clip = null;
            }
            this._currentBgmId = -1;
        });
    }

    private _loadAndPlayBGM(id: number): void {
        resources.load(`bgm/${id}`, AudioClip, (err: any, clip: AudioClip) => {
            if (err || !clip) {
                console.warn(`[SoundManager] 加载 BGM 失败: bgm/${id}`, err);
                return;
            }
            if (!this._bgmSource) return;
            // 加载期间用户可能已关闭音乐
            if (!this._musicEnabled) return;
            this._bgmSource.stop();
            this._bgmSource.clip = clip;
            this._bgmSource.loop = true;
            this._bgmSource.volume = 0;
            this._bgmSource.play();
            this._currentBgmId = id;
            this._startFadeIn();
        });
    }

    private _startFadeIn(): void {
        this._bgmFadingIn = true;
        this._bgmFadingOut = false;
        this._bgmFadeTimer = 0;
    }

    private _startFadeOut(callback: (() => void) | null = null): void {
        this._bgmFadingIn = false;
        this._bgmFadingOut = true;
        this._bgmFadeTimer = 0;
        this._bgmFadeOutCallback = callback;
    }

    private _updateBGMFade(dt: number): void {
        if (!this._bgmSource) return;
        if (this._bgmFadingIn) {
            this._bgmFadeTimer += dt;
            const t = Math.min(this._bgmFadeTimer / this.bgmFadeDuration, 1);
            this._bgmSource.volume = t * this.bgmTargetVolume;
            if (t >= 1) this._bgmFadingIn = false;
        } else if (this._bgmFadingOut) {
            this._bgmFadeTimer += dt;
            const t = Math.min(this._bgmFadeTimer / this.bgmFadeDuration, 1);
            this._bgmSource.volume = (1 - t) * this.bgmTargetVolume;
            if (t >= 1) {
                this._bgmFadingOut = false;
                const cb = this._bgmFadeOutCallback;
                this._bgmFadeOutCallback = null;
                if (cb) cb();
            }
        }
    }
}


