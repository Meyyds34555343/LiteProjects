/**
 * Free remote CDN endpoints for AssetSyncManager.
 *
 * DEFAULT: jsDelivr from this GitHub fork (behavior-scratch branch until merged to main).
 */

/** Live free CDN (jsDelivr → GitHub /cdn). Clear in editor to force offline-only. */
export const DEFAULT_CDN_MANIFEST_URL =
    'https://cdn.jsdelivr.net/gh/Meyyds34555343/LiteProjects@behavior-scratch/cdn/manifest.json';

/** jsDelivr template (USER/REPO). */
export const JSDELIVR_MANIFEST_TEMPLATE =
    'https://cdn.jsdelivr.net/gh/<USER>/<REPO>@main/cdn/manifest.json';
