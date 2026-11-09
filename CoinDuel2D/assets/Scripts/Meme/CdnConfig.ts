/**
 * Free remote CDN endpoints for AssetSync / MemeLoader.
 *
 * DEFAULT: jsDelivr from this GitHub fork (behavior-scratch branch until merged to main).
 * Always use an absolute https URL — never relative paths or 127.0.0.1 (breaks on itch.io).
 */

/** Live free CDN (jsDelivr → GitHub /cdn). */
export const DEFAULT_CDN_MANIFEST_URL =
    'https://cdn.jsdelivr.net/gh/Meyyds34555343/LiteProjects@behavior-scratch/cdn/manifest.json';

/** jsDelivr template (USER/REPO). */
export const JSDELIVR_MANIFEST_TEMPLATE =
    'https://cdn.jsdelivr.net/gh/<USER>/<REPO>@main/cdn/manifest.json';

/** Repo + branch that holds `/cdn`. Level files are read from raw GitHub (instant updates). */
export const CDN_REPO_OWNER = 'Meyyds34555343';
export const CDN_REPO_NAME = 'LiteProjects';
export const CDN_REPO_BRANCH = 'behavior-scratch';

/**
 * raw.githubusercontent base for a file in the repo.
 * Unlike jsDelivr, this reflects a fresh commit immediately and sends
 * `Access-Control-Allow-Origin: *`, so it is used for campaign levels where the
 * editor writes and the game reads back within seconds.
 */
export function githubRawUrl(path: string): string {
    const clean = String(path || '').replace(/^\/+/, '');
    return 'https://raw.githubusercontent.com/' + CDN_REPO_OWNER + '/' + CDN_REPO_NAME
        + '/' + CDN_REPO_BRANCH + '/' + clean;
}

/** True when url is a usable absolute http(s) remote (not localhost). */
export function isRemoteHttpsManifestUrl(url: string | null | undefined): boolean {
    const u = (url || '').trim();
    if (!/^https?:\/\//i.test(u)) return false;
    if (/^(https?:\/\/)?(127\.0\.0\.1|localhost)([:/]|$)/i.test(u)) return false;
    return true;
}

/** Prefer caller url; otherwise DEFAULT. Always returns absolute https CDN URL. */
export function resolveCdnManifestUrl(preferred?: string | null): string {
    const u = (preferred || '').trim().split(/[?#]/)[0];
    if (isRemoteHttpsManifestUrl(u)) return u;
    return DEFAULT_CDN_MANIFEST_URL;
}