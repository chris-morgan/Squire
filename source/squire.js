/** Copyright © 2011-2015 by Neil Jenkins. MIT Licensed. */

import {
    isInline,
    isBlock,
    isContainer,
    getBlockWalker,
    getPreviousBlock,
    getNextBlock,
    areAlike,
    hasTagAttributes,
    getNearest,
    isOrContains,
    detach,
    replaceWith,
    empty,
} from "./Node.js";

import {
    getNodeBefore,
    getNodeAfter,
    insertNodeInRange,
    extractContentsOfRange,
    deleteContentsOfRange,
    insertTreeFragmentIntoRange,
    isNodeContainedInRange,
    moveRangeBoundariesDownTree,
    moveRangeBoundariesUpTree,
    getStartBlockOfRange,
    getEndBlockOfRange,
    contentWalker,
    rangeDoesStartAtBlockBoundary,
    rangeDoesEndAtBlockBoundary,
    expandRangeToBlockBoundaries,
} from "./Range.js";

import { onPaste } from "./Clipboard.js";

import {
    Squire,
    addLinks,
    splitBlock,
    startSelectionId,
    endSelectionId,
} from "./Editor.js";

// Now we put them as static methods/properties/whatever on the class
Object.assign( Squire, {
    isInline,
    isBlock,
    isContainer,
    getBlockWalker,
    getPreviousBlock,
    getNextBlock,
    areAlike,
    hasTagAttributes,
    getNearest,
    isOrContains,
    detach,
    replaceWith,
    empty,

    getNodeBefore,
    getNodeAfter,
    insertNodeInRange,
    extractContentsOfRange,
    deleteContentsOfRange,
    insertTreeFragmentIntoRange,
    isNodeContainedInRange,
    moveRangeBoundariesDownTree,
    moveRangeBoundariesUpTree,
    getStartBlockOfRange,
    getEndBlockOfRange,
    contentWalker,
    rangeDoesStartAtBlockBoundary,
    rangeDoesEndAtBlockBoundary,
    expandRangeToBlockBoundaries,

    onPaste,

    addLinks,
    splitBlock,
    startSelectionId,
    endSelectionId,
});

export default Squire;

/* global define:1 */
if ( typeof exports !== 'object' &&
        ( typeof define !== 'function' || !define.amd ) ) {
    if ( top !== window && document.documentElement.getAttribute(
            'data-squireinit' ) === 'true' ) {
        window.editor = new Squire( document );
        if ( window.onEditorLoad ) {
            window.onEditorLoad( window.editor );
            window.onEditorLoad = null;
        }
    }
}
