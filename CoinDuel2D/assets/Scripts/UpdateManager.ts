import { _decorator, Component, sys } from 'cc';
import { EDITOR, PREVIEW } from 'cc/env';
import { NetworkManager } from './NetworkManager';
import { StorageManager } from './StorageManager';
const { ccclass } = _decorator;

/** 服务器文件清单中的一项 */
interface FileEntry {
    filename: string;
    timestamp: string;
}

/** index.json 结构 */
interface IndexData {
    filelist: FileEntry[];
}

/** 错误回调的 i18n 占位参数 */
type ErrParams = Record<string, string | number>;

/**
 * 资源更新管理器 — 启动时将本地 serverdata 目录与服务器文件清单同步
 *
 * 同步规则（见 Doc/在线更新关卡需求.md）：
 * - 对比服务器与本地 index.json 的 filelist：
 *   - 新增项：添加进本地 index.json（时间戳 0），下载文件后更新时间戳
 *   - 服务器时间戳更新的项：重新下载，成功后更新本地时间戳
 *   - 时间戳一致的项：跳过，不发请求
 * - 最后删除本地比服务器多的文件
 * - 所有数据存放在可写路径的 serverdata 目录下
 */
@ccclass('UpdateManager')
export class UpdateManager extends Component {
    /** 服务器根地址（结尾带 /），例如 https://cdn.example.com/ ，通过 http://url/index.json 获取文件清单 */
    public static serverUrl: string = 'http://127.0.0.1:8080/';

    /** 本地数据存放目录名（位于可写路径下） */
    private static readonly _LOCAL_DIR: string = 'serverdata';

    /** 是否正在更新 */
    private static _running: boolean = false;

    /**
     * 检查并同步服务器文件
     * @param progress 进度回调，0~1
     * @param completed 完成回调，err 为空串表示全部成功，否则为 i18n 错误 key，errParams 为翻译占位参数
     */
    public static checkUpdate(progress: (p: number) => void, completed: (err: string, errParams?: ErrParams) => void): void {
        if (UpdateManager._running) {
            completed('main_update_err_running');
            return;
        }
        // Creator preview / editor / localhost: never hit a missing update server (avoids 获取清单失败 (0)).
        const url = (UpdateManager.serverUrl || '').trim();
        const isLocalDevUrl = !url || /127\.0\.0\.1|localhost/i.test(url);
        if (EDITOR || PREVIEW || isLocalDevUrl || !sys.isNative) {
            // Web builds + Cocos preview also skip — itch/web use CDN, not this HTTP updater.
            console.log('[Update] skip checkUpdate (preview/web/local)', { EDITOR, PREVIEW, url });
            progress(1);
            completed('');
            return;
        }
        UpdateManager._running = true;
        const done = (err: string, errParams?: ErrParams) => {
            UpdateManager._running = false;
            completed(err, errParams);
        };

        console.log('[Update] 开始检查更新:', UpdateManager.serverUrl);
        progress(0);
        NetworkManager.HttpGet(UpdateManager.serverUrl + 'index.json', (code, content) => {
            if (code !== 200) {
                done('main_update_err_fetch_index', { code: code });
                return;
            }
            let serverIndex: IndexData;
            try {
                serverIndex = JSON.parse(content);
            } catch (e) {
                done('main_update_err_parse_index');
                return;
            }
            if (!serverIndex || !Array.isArray(serverIndex.filelist)) {
                done('main_update_err_bad_index');
                return;
            }
            UpdateManager._sync(serverIndex, progress, done);
        });
    }

    /** 本地 serverdata 根目录 */
    private static _baseDir(): string {
        return UpdateManager._joinPath(StorageManager.getWritablePath(), UpdateManager._LOCAL_DIR);
    }

    /** serverdata 内某文件的本地完整路径（rel 如 'levels/1.json'） */
    public static getDataPath(rel: string): string {
        return UpdateManager._joinPath(UpdateManager._baseDir(), rel);
    }

    private static _joinPath(dir: string, file: string): string {
        if (!dir) return file;
        return (dir.endsWith('/') ? dir : dir + '/') + file;
    }

    /** 同步服务器文件清单到本地 */
    private static _sync(serverIndex: IndexData, progress: (p: number) => void, completed: (err: string, errParams?: ErrParams) => void): void {
        const baseDir = UpdateManager._baseDir();
        StorageManager.createDir(baseDir);

        // 规范化服务器清单，过滤非法项（空文件名、路径穿越）
        const serverList: FileEntry[] = [];
        for (const entry of serverIndex.filelist) {
            if (!entry || !entry.filename) continue;
            const filename = String(entry.filename).replace(/\\/g, '/').replace(/^\/+/, '');
            if (filename.indexOf('..') >= 0) continue;
            serverList.push({
                filename: filename,
                timestamp: String(entry.timestamp ?? '0'),
            });
        }
        console.log('[Update] 服务器清单:', serverList.length, '个文件');

        // 读取本地 index.json；不存在时以时间戳 0 新建（与服务器清单一致）
        const indexPath = UpdateManager._joinPath(baseDir, 'index.json');
        StorageManager.readJsonFile(indexPath, (err, data) => {
            const localMap: Record<string, string> = {};
            if (!err && data && Array.isArray((data as IndexData).filelist)) {
                for (const entry of (data as IndexData).filelist) {
                    if (entry && entry.filename) {
                        localMap[String(entry.filename)] = String(entry.timestamp ?? '0');
                    }
                }
                console.log('[Update] 本地清单:', Object.keys(localMap).length, '个文件');
            } else {
                console.log('[Update] 本地清单不存在，按服务器清单新建（时间戳 0）');
            }

            // 需要下载的项：本地缺失（时间戳 0），或服务器时间戳更新
            const pending: FileEntry[] = [];
            const localList: FileEntry[] = [];
            const serverNames: Record<string, boolean> = {};
            let newCount = 0;
            let updateCount = 0;
            let skipCount = 0;
            for (const entry of serverList) {
                serverNames[entry.filename] = true;
                const localTs = localMap[entry.filename];
                const item: FileEntry = {
                    filename: entry.filename,
                    timestamp: localTs !== undefined ? localTs : '0',
                };
                localList.push(item);
                if (localTs === undefined) {
                    pending.push(entry);
                    newCount++;
                    console.log('[Update] 比对 新增:', entry.filename);
                } else if (UpdateManager._isNewer(entry.timestamp, localTs)) {
                    pending.push(entry);
                    updateCount++;
                    console.log('[Update] 比对 更新:', entry.filename, localTs, '->', entry.timestamp);
                } else {
                    skipCount++;
                    console.log('[Update] 比对 跳过:', entry.filename, '(时间戳 ' + localTs + ')');
                }
            }

            // 本地比服务器多的文件，最后移除
            const extraFiles: string[] = [];
            for (const name of Object.keys(localMap)) {
                if (!serverNames[name]) extraFiles.push(name);
            }
            for (const name of extraFiles) {
                console.log('[Update] 比对 删除:', name, '(服务器已不存在)');
            }
            console.log(`[Update] 比对完成: 新增 ${newCount}, 更新 ${updateCount}, 跳过 ${skipCount}, 删除 ${extraFiles.length}`);

            // 先落盘本地 index.json（新增项以时间戳 0 记录，下载成功后再更新）
            StorageManager.writeJsonFile(indexPath, { filelist: localList });

            // 逐个下载更新的文件，成功后立即更新本地 index.json 时间戳
            let firstErr = '';
            let firstErrParams: ErrParams | undefined;
            let index = 0;
            const step = () => {
                if (index >= pending.length) {
                    // 最后移除本地比服务器多的文件
                    for (const name of extraFiles) {
                        if (StorageManager.deleteFile(UpdateManager._joinPath(baseDir, name))) {
                            console.log('[Update] 已删除:', name);
                        } else {
                            console.warn('[Update] 删除失败:', name);
                        }
                    }
                    // 最终写一次 index.json（localList 只含服务器清单内容，多余项已移除）
                    StorageManager.writeJsonFile(indexPath, { filelist: localList });
                    console.log('[Update] 检查更新结束');
                    progress(1);
                    completed(firstErr, firstErrParams);
                    return;
                }
                const entry = pending[index];
                const fileUrl = UpdateManager.serverUrl + entry.filename;
                console.log('[Update] 下载中:', entry.filename);
                NetworkManager.HttpGet(fileUrl, (code, content) => {
                    if (code !== 200) {
                        console.warn('[Update] 下载失败:', entry.filename, '状态码:', code);
                        if (!firstErr) {
                            firstErr = 'main_update_err_download';
                            firstErrParams = { file: entry.filename, code: code };
                        }
                    } else {
                        const filePath = UpdateManager._joinPath(baseDir, entry.filename);
                        // 确保子目录存在（如 levels/xxx.json）
                        const dir = filePath.substring(0, filePath.lastIndexOf('/'));
                        if (dir) StorageManager.createDir(dir);
                        if (StorageManager.writeTextFile(filePath, content)) {
                            console.log('[Update] 下载成功:', entry.filename);
                            // 下载成功，更新本地 index.json 对应时间戳
                            const item = localList.find((it) => it.filename === entry.filename);
                            if (item) item.timestamp = entry.timestamp;
                            StorageManager.writeJsonFile(indexPath, { filelist: localList });
                        } else {
                            console.warn('[Update] 保存失败:', entry.filename);
                            if (!firstErr) {
                                firstErr = 'main_update_err_save';
                                firstErrParams = { file: entry.filename };
                            }
                        }
                    }
                    index++;
                    progress(pending.length > 0 ? index / pending.length : 1);
                    step();
                });
            };
            step();
        });
    }

    /** 服务器时间戳是否比本地更新（非数字时间戳退化为不相等即更新） */
    private static _isNewer(serverTs: string, localTs: string): boolean {
        const s = Number(serverTs);
        const l = Number(localTs);
        if (isNaN(s) || isNaN(l)) return String(serverTs) !== String(localTs);
        return s > l;
    }
}
