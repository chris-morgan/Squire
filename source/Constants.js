export const DOCUMENT_POSITION_PRECEDING = 2; // Node.DOCUMENT_POSITION_PRECEDING
export const ELEMENT_NODE = 1;                // Node.ELEMENT_NODE;
export const TEXT_NODE = 3;                   // Node.TEXT_NODE;
export const DOCUMENT_NODE = 9;               // Node.DOCUMENT_NODE;
export const DOCUMENT_FRAGMENT_NODE = 11;     // Node.DOCUMENT_FRAGMENT_NODE;
export const SHOW_ELEMENT = 1;                // NodeFilter.SHOW_ELEMENT;
export const SHOW_TEXT = 4;                   // NodeFilter.SHOW_TEXT;

export const START_TO_START = 0; // Range.START_TO_START
export const START_TO_END = 1;   // Range.START_TO_END
export const END_TO_END = 2;     // Range.END_TO_END
export const END_TO_START = 3;   // Range.END_TO_START

export const HIGHLIGHT_CLASS = 'highlight';
export const COLOUR_CLASS = 'colour';
export const FONT_FAMILY_CLASS = 'font';
export const FONT_SIZE_CLASS = 'size';

export const ZWS = '\u200B';

export const win = document.defaultView;

export const ua = navigator.userAgent;

export const isAndroid = /Android/.test( ua );
export const isIOS = /iP(?:ad|hone|od)/.test( ua );
export const isMac = /Mac OS X/.test( ua );
export const isWin = /Windows NT/.test( ua );

export const isGecko = /Gecko\//.test( ua );
export const isIElt11 = /Trident\/[456]\./.test( ua );
export const isPresto = !!win.opera;
export const isEdge = /Edge\//.test( ua );
export const isWebKit = !isEdge && /WebKit\//.test( ua );
export const isIE = /Trident\/[4567]\./.test( ua );

export const ctrlKey = isMac ? 'meta-' : 'ctrl-';

export const useTextFixer = isIElt11 || isPresto;
export const cantFocusEmptyTextNodes = isIElt11 || isWebKit;
export const losesSelectionOnBlur = isIElt11;

export const canObserveMutations = typeof MutationObserver !== 'undefined';
export const canWeakMap = typeof WeakMap !== 'undefined';

// Use [^ \t\r\n] instead of \S so that nbsp does not count as white-space
export const notWS = /[^ \t\r\n]/;

export const indexOf = Array.prototype.indexOf;

// Polyfill for FF3.5
if ( !Object.create ) {
    Object.create = function ( proto ) {
        const F = function () {};
        F.prototype = proto;
        return new F();
    };
}
