/**
 * Campaign stage configuration for the beginner tutorial (Stage Mode / 闖關模式).
 *
 * Single source of truth for:
 *  - which level file a stage loads
 *  - the win condition shown to the player
 *  - star thresholds used by the level-select screen
 *  - the guided tutorial shown the first time the stage is played
 *
 * Keeping this as data (instead of hard-coded tutorial indices inside GameScene)
 * means adding / reordering stages cannot silently break the tutorial.
 */

/** Win condition kinds. The built-in runner currently settles on CLEAR_ALL. */
export type StageWinType =
    /** Clear every coin you can (classic CoinDuel rule: one coin must remain). */
    | 'CLEAR_ALL'
    /** Reach a score before the board is cleared (used by scoring stages). */
    | 'REACH_SCORE'
    /** Finale: clear a board that mixes hazards, mud and bombs. */
    | 'CHECKLIST';

export interface StageStarRule {
    /** Score required for 2 stars. 1 star is granted on clear. */
    two: number;
    /** Score required for 3 stars. */
    three: number;
}

export interface StageDragStep {
    /** i18n key for the drag hint. */
    hintKey: string;
    /** Index into `coinGroup.children` (coins only). */
    source: number;
    /** Index into `coinGroup.children` (coins only). */
    target: number;
    /** Marks the last guided drag so the tutorial ends on success. */
    final?: boolean;
}

export interface StageTutorial {
    /** i18n key for the goal banner shown before the drag steps. */
    introKey: string;
    /** Guided drags, executed in order. */
    drags: StageDragStep[];
}

export interface CampaignStageConfig {
    /** 1-based stage id; also the level file number (`levels/{id}.json`). */
    id: number;
    /** File name inside `resources/levels`. */
    file: string;
    /** i18n key for the stage title. */
    nameKey: string;
    /** Win condition. */
    win: { type: StageWinType; value?: number };
    /** Star thresholds. */
    stars: StageStarRule;
    /** Beginner tutorial; only present on the first four stages. */
    tutorial?: StageTutorial;
}

/** Number of stages that carry the beginner tutorial. */
export const TUTORIAL_STAGE_COUNT = 4;

export const CAMPAIGN_STAGES: CampaignStageConfig[] = [
    {
        id: 1,
        file: '1.json',
        nameKey: 'stage_1_name',
        win: { type: 'CLEAR_ALL' },
        stars: { two: 2, three: 3 },
        tutorial: {
            introKey: 'tutorial_l1_intro',
            drags: [
                // After a successful hit the struck coin becomes the next shooter,
                // so guided drags always chain target -> next target.
                { hintKey: 'tutorial_l1_drag_a', source: 0, target: 1 },
                { hintKey: 'tutorial_l1_drag_b', source: 1, target: 2, final: true },
            ],
        },
    },
    {
        id: 2,
        file: '2.json',
        nameKey: 'stage_2_name',
        win: { type: 'CLEAR_ALL' },
        stars: { two: 2, three: 4 },
        tutorial: {
            introKey: 'tutorial_l2_intro',
            drags: [
                // Top lane stays clear of the centre blocker and the mud patch.
                { hintKey: 'tutorial_l2_drag_a', source: 0, target: 1 },
                // Down the right side, then across the bottom to the last coin.
                { hintKey: 'tutorial_l2_drag_b', source: 1, target: 3 },
                { hintKey: 'tutorial_l2_drag_c', source: 3, target: 2, final: true },
            ],
        },
    },
    {
        id: 3,
        file: '3.json',
        nameKey: 'stage_3_name',
        win: { type: 'CLEAR_ALL' },
        stars: { two: 4, three: 7 },
        tutorial: {
            introKey: 'tutorial_l3_intro',
            drags: [
                { hintKey: 'tutorial_l3_drag_a', source: 0, target: 2 },
                { hintKey: 'tutorial_l3_drag_b', source: 2, target: 3 },
                { hintKey: 'tutorial_l3_drag_c', source: 3, target: 4 },
                { hintKey: 'tutorial_l3_drag_d', source: 4, target: 1, final: true },
            ],
        },
    },
    {
        id: 4,
        file: '4.json',
        nameKey: 'stage_4_name',
        // The runner wins when one coin remains, so the finale is a clear-all
        // over a hazard-heavy board rather than a new rule.
        win: { type: 'CLEAR_ALL', value: 4 },
        stars: { two: 5, three: 9 },
        tutorial: {
            introKey: 'tutorial_l4_intro',
            drags: [
                // Perimeter route: BL -> TL -> TR -> BR. It stays clear of both
                // blockers and both mud patches, and covers every real coin.
                { hintKey: 'tutorial_l4_drag_a', source: 2, target: 0 },
                { hintKey: 'tutorial_l4_drag_b', source: 0, target: 1 },
                { hintKey: 'tutorial_l4_drag_c', source: 1, target: 3, final: true },
            ],
        },
    },
];

const STAGE_MAP: Record<number, CampaignStageConfig> = (() => {
    const map: Record<number, CampaignStageConfig> = {};
    for (const stage of CAMPAIGN_STAGES) map[stage.id] = stage;
    return map;
})();

/** Stage config by 1-based id, or null for non-campaign stages. */
export function getStage(id: number): CampaignStageConfig | null {
    return STAGE_MAP[id] ?? null;
}

/** True when this stage is part of the beginner tutorial block. */
export function isTutorialStage(id: number): boolean {
    return id >= 1 && id <= TUTORIAL_STAGE_COUNT;
}

/** Stars earned for a cleared stage. */
export function starsFor(rule: StageStarRule, score: number, cleared: boolean): number {
    if (!cleared) return 0;
    if (score >= rule.three) return 3;
    if (score >= rule.two) return 2;
    return 1;
}
