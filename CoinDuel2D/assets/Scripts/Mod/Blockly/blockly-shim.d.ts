/**
 * Minimal Blockly ambient types for editor tooling.
 * Runtime browser host loads Blockly from CDN; Cocos game never imports Blockly.
 */
declare namespace Blockly {
    interface Workspace {
        getTopBlocks(ordered?: boolean): Block[];
        clear(): void;
        addChangeListener(fn: (e: unknown) => void): void;
        resize(): void;
        dispose?(): void;
        newBlock?(type: string): Block;
    }

    interface Block {
        type: string;
        id: string;
        getNextBlock(): Block | null;
        getInputTargetBlock(name: string): Block | null;
        getFieldValue(name: string): string | number | boolean | null;
        setFieldValue?(value: string | number | boolean, name: string): void;
        dispose(healStack?: boolean): void;
        initSvg?(): void;
        render?(): void;
        moveBy?(dx: number, dy: number): void;
        previousConnection?: { connect(c: unknown): void } | null;
        nextConnection?: unknown;
    }

    interface BlocklyOptions {
        toolbox?: unknown;
        media?: string;
        trashcan?: boolean;
        scrollbars?: boolean;
        zoom?: {
            controls?: boolean;
            wheel?: boolean;
            startScale?: number;
            maxScale?: number;
            minScale?: number;
        };
        grid?: { spacing?: number; length?: number; colour?: string; snap?: boolean };
        move?: { scrollbars?: boolean; drag?: boolean; wheel?: boolean };
        renderer?: string;
    }

    function inject(container: Element | string, options?: BlocklyOptions): Workspace;
    function defineBlocksWithJsonArray(jsonArray: object[]): void;
    const Blocks: Record<string, unknown>;
    const Msg: Record<string, string>;

    namespace Events {
        const BLOCK_CHANGE: string;
        const BLOCK_CREATE: string;
        const BLOCK_DELETE: string;
        const BLOCK_MOVE: string;
        const CHANGE: string;
        const CREATE: string;
        const DELETE: string;
        const MOVE: string;
    }

    namespace Xml {
        function workspaceToDom(workspace: Workspace): Element;
        function domToWorkspace(xml: Element, workspace: Workspace): string[];
        function textToDom(text: string): Element;
        function domToText(dom: Element): string;
    }

    namespace serialization {
        namespace workspaces {
            function save(workspace: Workspace): object;
            function load(state: object, workspace: Workspace): void;
        }
    }
}

interface Window {
    Blockly?: typeof Blockly;
    LZString?: {
        compressToBase64(s: string): string;
        decompressFromBase64(s: string): string;
    };
}
