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