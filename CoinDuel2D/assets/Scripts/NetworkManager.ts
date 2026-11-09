/**
 * 网络管理器 — 封装 HTTP 访问
 */
export class NetworkManager {
    /** 请求超时时间（毫秒） */
    private static readonly TIMEOUT: number = 20000;

    /**
     * 发起 HTTP GET 请求
     * @param url 请求地址
     * @param cb 回调：code 为 HTTP 状态码（网络错误时为 0），content 为响应文本
     */
    public static HttpGet(url: string, cb: (code: number, content: string) => void): void {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.timeout = NetworkManager.TIMEOUT;
        xhr.onload = () => {
            cb(xhr.status, xhr.responseText);
        };
        xhr.onerror = () => {
            cb(0, '');
        };
        xhr.ontimeout = () => {
            cb(0, '');
        };
        xhr.send();
    }

    /**
     * 下载二进制资源（贴图 / 音效）。
     * @param url 请求地址
     * @param cb 回调：code 为 HTTP 状态码，data 为响应字节（失败时为 null）
     */
    public static HttpGetBinary(
        url: string,
        cb: (code: number, data: ArrayBuffer | null) => void,
    ): void {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.responseType = 'arraybuffer';
        xhr.timeout = NetworkManager.TIMEOUT;
        xhr.onload = () => {
            const data = xhr.response as ArrayBuffer | null;
            cb(xhr.status, data || null);
        };
        xhr.onerror = () => {
            cb(0, null);
        };
        xhr.ontimeout = () => {
            cb(0, null);
        };
        xhr.send();
    }
}
