import { sys } from 'cc';
import { LevelState } from '../LevelData';
import { LevelManager } from '../LevelManager';
import { DEFAULT_STAGE_STARS, getStage, starsFor } from './CampaignConfig';

const STORAGE_KEY = 'coinduel_campaign_v1';

interface CampaignSave {
    version: 1;
    /** stageId -> stars (0..3). Present only after a clear. */
    stars: Record<string, number>;
    /** stageId -> best score. */
    best: Record<string, number>;
}

function emptySave(): CampaignSave {
    return { version: 1, stars: {}, best: {} };
}

/**
 * Persistent campaign progress (stars, best score, unlocking).
 *
 * Unlock rule: stage 1 is always open; stage N opens once stage N-1 has at
 * least one star. This applies to the whole campaign; stages without an
 * explicit CampaignStageConfig use DEFAULT_STAGE_STARS so clears are still saved.
 */
export class CampaignProgress {
    private static _data: CampaignSave | null = null;

    private static get data(): CampaignSave {
        if (!CampaignProgress._data) {
            CampaignProgress._data = CampaignProgress._read();
        }
        return CampaignProgress._data;
    }

    private static _read(): CampaignSave {
        try {
            const raw = sys.localStorage.getItem(STORAGE_KEY);
            if (!raw) return emptySave();
            const parsed = JSON.parse(raw) as CampaignSave;
            if (!parsed || parsed.version !== 1) return emptySave();
            return {
                version: 1,
                stars: parsed.stars && typeof parsed.stars === 'object' ? parsed.stars : {},
                best: parsed.best && typeof parsed.best === 'object' ? parsed.best : {},
            };
        } catch {
            return emptySave();
        }
    }

    private static _write(): void {
        try {
            sys.localStorage.setItem(STORAGE_KEY, JSON.stringify(CampaignProgress.data));
        } catch {
            // Storage can be disabled in private browsing; progress is best-effort.
        }
    }

    /** Stars earned on a stage (0 = never cleared). */
    public static getStars(stageId: number): number {
        const value = Number(CampaignProgress.data.stars[String(stageId)] ?? 0);
        return Number.isFinite(value) ? Math.max(0, Math.min(3, value)) : 0;
    }

    /** Best score recorded on a stage. */
    public static getBest(stageId: number): number {
        const value = Number(CampaignProgress.data.best[String(stageId)] ?? 0);
        return Number.isFinite(value) ? value : 0;
    }

    /** Whether the stage can be entered. */
    public static isUnlocked(stageId: number): boolean {
        if (stageId <= 1) return true;
        // Sequential unlocking for the whole campaign: clear N-1 to open N.
        return CampaignProgress.getStars(stageId - 1) > 0;
    }

    /** True once the player has cleared any stage. */
    public static hasProgress(): boolean {
        return Object.keys(CampaignProgress.data.stars).length > 0;
    }

    /**
     * Record a cleared stage. Stars only ever increase, and the best score is
     * kept across replays so the level select screen stays stable.
     */
    public static recordClear(stageId: number, score: number): number {
        // 只有教程段有完整 stage 配置；後續關卡用預設門檻，
        // 但仍必須記錄星星，否則永遠無法解鎖下一關。
        const stage = getStage(stageId);
        const earned = starsFor(stage?.stars ?? DEFAULT_STAGE_STARS, score, true);
        const key = String(stageId);
        const previous = CampaignProgress.getStars(stageId);
        CampaignProgress.data.stars[key] = Math.max(previous, earned);
        CampaignProgress.data.best[key] = Math.max(CampaignProgress.getBest(stageId), score);
        CampaignProgress._write();
        return earned;
    }

    /** Map campaign progress onto LevelManager's state array (all stages, not just the tutorial block). */
    public static applyToLevelManager(): void {
        const count = LevelManager.getLevelFiles().length;
        for (let stageId = 1; stageId <= count; stageId++) {
            const stars = CampaignProgress.getStars(stageId);
            let state: LevelState;
            if (stars > 0) state = LevelState.Passed;
            else if (CampaignProgress.isUnlocked(stageId)) state = LevelState.Unlocked;
            else state = LevelState.Locked;
            // setLevelState clamps to the existing array length.
            LevelManager.setLevelState(stageId - 1, state);
        }
    }

    /** Wipe campaign progress (debug / options screen). */
    public static reset(): void {
        CampaignProgress._data = emptySave();
        CampaignProgress._write();
    }
}
