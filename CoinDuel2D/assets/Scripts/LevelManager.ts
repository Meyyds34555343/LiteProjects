import { LevelData, LevelState } from './LevelData';

/**
 * 跨场景传递关卡数据的静态管理器
 */
export class LevelManager {
    /** 關卡檔名 → DataProvider 路徑（兼容 `1.json` 與 `levels/1.json`）。 */
    static toDataPath(file: string): string {
        const clean = file.replace(/\.json$/i, '');
        return clean.indexOf('levels/') === 0 ? clean : 'levels/' + clean;
    }

    private static _current: LevelData | null = null;
    /** levels.json 中的文件列表 */
    private static _levelFiles: string[] = [];
    /** 当前关卡在 _levelFiles 中的索引 */
    private static _levelIndex: number = -1;
    /** 每关状态（开发阶段不存档，重进游戏自动重置） */
    private static _levelStates: LevelState[] = [];
    /** Scratch-imported pack — survives until a normal level pick overwrites it */
    private static _scratchPack = false;

    static setCurrent(data: LevelData): void {
        LevelManager._current = data;
    }

    /** Mark current level as coming from Scratch COINMOD1 (solo play). */
    static setScratchLevel(data: LevelData): void {
        LevelManager._current = data;
        LevelManager._scratchPack = true;
        LevelManager._levelFiles = ['scratch'];
        LevelManager._levelIndex = 0;
        LevelManager._levelStates = [LevelState.Unlocked];
    }

    static isScratchPack(): boolean {
        return LevelManager._scratchPack;
    }

    static getCurrent(): LevelData | null {
        return LevelManager._current;
    }

    /** 设置关卡文件列表和当前索引（由 LevelsScene 调用），同时初始化关卡状态 */
    static setLevelList(files: string[], index: number): void {
        LevelManager._scratchPack = false;
        LevelManager._levelFiles = files;
        LevelManager._levelIndex = index;
        // 首次初始化：全部 Locked，第一个自动 Unlocked
        if (LevelManager._levelStates.length !== files.length) {
            LevelManager._levelStates = files.map((_, i) =>
                i === 0 ? LevelState.Unlocked : LevelState.Locked
            );
        }
    }

    static getLevelFiles(): string[] {
        return LevelManager._levelFiles;
    }

    static getLevelIndex(): number {
        return LevelManager._levelIndex;
    }

    /** 获取每关状态数组 */
    static getLevelStates(): LevelState[] {
        return LevelManager._levelStates;
    }

    /** 获取指定关卡的状态 */
    static getLevelState(index: number): LevelState {
        return LevelManager._levelStates[index] ?? LevelState.Locked;
    }

    /** 直接设置指定关卡状态（供战役进度 / 存档恢复使用） */
    static setLevelState(index: number, state: LevelState): void {
        if (index >= 0 && index < LevelManager._levelStates.length) {
            LevelManager._levelStates[index] = state;
        }
    }

    /** 标记指定关卡为 Passed，并自动解锁下一关 */
    static markLevelPassed(index: number): void {
        if (index >= 0 && index < LevelManager._levelStates.length) {
            LevelManager._levelStates[index] = LevelState.Passed;
            // 自动解锁下一关
            const next = index + 1;
            if (next < LevelManager._levelStates.length
                && LevelManager._levelStates[next] === LevelState.Locked) {
                LevelManager._levelStates[next] = LevelState.Unlocked;
            }
        }
    }

    /** 是否还有下一关 */
    static hasNextLevel(): boolean {
        return LevelManager._levelIndex >= 0
            && LevelManager._levelIndex < LevelManager._levelFiles.length - 1;
    }

    static clear(): void {
        LevelManager._current = null;
        LevelManager._levelFiles = [];
        LevelManager._levelIndex = -1;
        LevelManager._scratchPack = false;
    }
}
