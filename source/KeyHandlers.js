import {
    isPresto, isMac, isGecko, ctrlKey, ZWS, indexOf, ELEMENT_NODE, TEXT_NODE,
} from "./Constants.js";
import {
    getPreviousBlock, getNextBlock, getNearest, getLength, detach, replaceWith,
    fixCursor, fixContainer, mergeWithBlock, mergeContainers,
    isInline, isBlock,
} from "./Node.js";
import {
    insertNodeInRange, deleteContentsOfRange,
    moveRangeBoundariesDownTree, moveRangeBoundariesUpTree,
    getStartBlockOfRange,
    rangeDoesStartAtBlockBoundary, rangeDoesEndAtBlockBoundary,
} from "./Range.js";
import { removeEmptyInlines } from "./Clean.js";
// FIXME(modulify): cyclical dependencies here; not *necessarily* a problem,
// but we should prefer to remove it if we can. (And first verify that it’s not
// going to blow things up.)
import {
    getWindowSelection, removeZWS, splitBlock, removeBlockQuote, addLinks,
} from "./Editor.js";

const keys = {
    8: 'backspace',
    9: 'tab',
    13: 'enter',
    32: 'space',
    33: 'pageup',
    34: 'pagedown',
    37: 'left',
    39: 'right',
    46: 'delete',
    219: '[',
    221: ']',
};

// Ref: http://unixpapa.com/js/key.html
export function onKey ( event ) {
    if ( event.defaultPrevented ) {
        return;
    }

    const code = event.keyCode;
    let key = keys[ code ];
    const range = this.getSelection();

    if ( !key ) {
        key = String.fromCharCode( code ).toLowerCase();
        // Only reliable for letters and numbers
        if ( !/^[A-Za-z0-9]$/.test( key ) ) {
            key = '';
        }
    }

    // On keypress, delete and '.' both have event.keyCode 46
    // Must check event.which to differentiate.
    if ( isPresto && event.which === 46 ) {
        key = '.';
    }

    // Function keys
    if ( 111 < code && code < 124 ) {
        key = 'f' + ( code - 111 );
    }

    // We need to apply the backspace/delete handlers regardless of
    // control key modifiers.
    let modifiers = '';
    if ( key !== 'backspace' && key !== 'delete' ) {
        if ( event.altKey  ) { modifiers += 'alt-'; }
        if ( event.ctrlKey ) { modifiers += 'ctrl-'; }
        if ( event.metaKey ) { modifiers += 'meta-'; }
    }
    // However, on Windows, shift-delete is apparently "cut" (WTF right?), so
    // we want to let the browser handle shift-delete.
    if ( event.shiftKey ) { modifiers += 'shift-'; }

    key = modifiers + key;

    if ( this._keyHandlers[ key ] ) {
        this._keyHandlers[ key ]( this, event, range );
    } else if ( key.length === 1 && !range.collapsed ) {
        // Record undo checkpoint.
        this.saveUndoState( range );
        // Delete the selection
        deleteContentsOfRange( range, this._root );
        this._ensureBottomLine();
        this.setSelection( range );
        this._updatePath( range, true );
    }
}

function mapKeyTo ( method ) {
    return ( self, event ) => {
        event.preventDefault();
        self[ method ]();
    };
}

function mapKeyToFormat ( tag, remove ) {
    remove = remove || null;
    return ( self, event ) => {
        event.preventDefault();
        const range = self.getSelection();
        if ( self.hasFormat( tag, null, range ) ) {
            self.changeFormat( null, { tag: tag }, range );
        } else {
            self.changeFormat( { tag: tag }, remove, range );
        }
    };
}

// If you delete the content inside a span with a font styling, Webkit will
// replace it with a <font> tag (!). If you delete all the text inside a
// link in Opera, it won't delete the link. Let's make things consistent. If
// you delete all text inside an inline tag, remove the inline tag.
function afterDelete ( self, range ) {
    try {
        if ( !range ) { range = self.getSelection(); }
        let node = range.startContainer;
        // Climb the tree from the focus point while we are inside an empty
        // inline element
        if ( node.nodeType === TEXT_NODE ) {
            node = node.parentNode;
        }
        let parent = node;
        while ( isInline( parent ) &&
                ( !parent.textContent || parent.textContent === ZWS ) ) {
            node = parent;
            parent = node.parentNode;
        }
        // If focused in empty inline element
        if ( node !== parent ) {
            // Move focus to just before empty inline(s)
            range.setStart( parent,
                indexOf.call( parent.childNodes, node ) );
            range.collapse( true );
            // Remove empty inline(s)
            parent.removeChild( node );
            // Fix cursor in block
            if ( !isBlock( parent ) ) {
                parent = getPreviousBlock( parent, self._root );
            }
            fixCursor( parent, self._root );
            // Move cursor into text node
            moveRangeBoundariesDownTree( range );
        }
        // If you delete the last character in the sole <div> in Chrome,
        // it removes the div and replaces it with just a <br> inside the
        // root. Detach the <br>; the _ensureBottomLine call will insert a new
        // block.
        if ( node === self._root &&
                ( node = node.firstChild ) && node.nodeName === 'BR' ) {
            detach( node );
        }
        self._ensureBottomLine();
        self.setSelection( range );
        self._updatePath( range, true );
    } catch ( error ) {
        self.didError( error );
    }
}

export const keyHandlers = {
    enter( self, event, range ) {
        // We handle this ourselves
        event.preventDefault();

        // Save undo checkpoint and add any links in the preceding section.
        // Remove any zws so we don't think there's content in an empty
        // block.
        self._recordUndoState( range );
        const root = self._root;
        addLinks( range.startContainer, root, self );
        self._removeZWS();
        self._getRangeAndRemoveBookmark( range );

        // Selected text is overwritten, therefore delete the contents
        // to collapse selection.
        if ( !range.collapsed ) {
            deleteContentsOfRange( range, root );
        }

        let block = getStartBlockOfRange( range, root );

        // If this is a malformed bit of document or in a table;
        // just play it safe and insert a <br>.
        if ( !block || /^T[HD]$/.test( block.nodeName ) ) {
            // If inside an <a>, move focus out
            let parent = getNearest( range.endContainer, root, 'A' );
            if ( parent ) {
                parent = parent.parentNode;
                moveRangeBoundariesUpTree( range, parent, parent, root );
                range.collapse( false );
            }
            insertNodeInRange( range, self.createElement( 'BR' ) );
            range.collapse( false );
            self.setSelection( range );
            self._updatePath( range, true );
            return;
        }

        // If in a list, we'll split the LI instead.
        const parent = getNearest( block, root, 'LI' );
        if ( parent ) {
            block = parent;
        }

        if ( !block.textContent ) {
            // Break list
            if ( getNearest( block, root, 'UL' ) ||
                    getNearest( block, root, 'OL' ) ) {
                return self.decreaseListLevel( range, false );
            }
            // Break blockquote
            else if ( getNearest( block, root, 'BLOCKQUOTE' ) ) {
                return self.modifyBlocks( removeBlockQuote, range );
            }
        }

        // Otherwise, split at cursor point.
        let nodeAfterSplit = splitBlock( self, block,
            range.startContainer, range.startOffset );

        // Clean up any empty inlines if we hit enter at the beginning of the
        // block
        removeZWS( block );
        removeEmptyInlines( block );
        fixCursor( block, root );

        // Focus cursor
        // If there's a <b>/<i> etc. at the beginning of the split
        // make sure we focus inside it.
        while ( nodeAfterSplit.nodeType === ELEMENT_NODE ) {
            let child = nodeAfterSplit.firstChild;

            // Don't continue links over a block break; unlikely to be the
            // desired outcome.
            if ( nodeAfterSplit.nodeName === 'A' &&
                    ( !nodeAfterSplit.textContent ||
                        nodeAfterSplit.textContent === ZWS ) ) {
                child = self._doc.createTextNode( '' );
                replaceWith( nodeAfterSplit, child );
                nodeAfterSplit = child;
                break;
            }

            while ( child && child.nodeType === TEXT_NODE && !child.data ) {
                const next = child.nextSibling;
                if ( !next || next.nodeName === 'BR' ) {
                    break;
                }
                detach( child );
                child = next;
            }

            // 'BR's essentially don't count; they're a browser hack.
            // If you try to select the contents of a 'BR', FF will not let
            // you type anything!
            if ( !child || child.nodeName === 'BR' ||
                    ( child.nodeType === TEXT_NODE && !isPresto ) ) {
                break;
            }
            nodeAfterSplit = child;
        }
        range = self._createRange( nodeAfterSplit, 0 );
        self.setSelection( range );
        self._updatePath( range, true );
    },
    backspace( self, event, range ) {
        const root = self._root;
        self._removeZWS();
        // Record undo checkpoint.
        self.saveUndoState( range );
        // If not collapsed, delete contents
        if ( !range.collapsed ) {
            event.preventDefault();
            deleteContentsOfRange( range, root );
            afterDelete( self, range );
        }
        // If at beginning of block, merge with previous
        else if ( rangeDoesStartAtBlockBoundary( range, root ) ) {
            event.preventDefault();
            let current = getStartBlockOfRange( range, root );
            if ( !current ) {
                return;
            }
            // In case inline data has somehow got between blocks.
            fixContainer( current.parentNode, root );
            // Now get previous block
            const previous = getPreviousBlock( current, root );
            // Must not be at the very beginning of the text area.
            if ( previous ) {
                // If not editable, just delete whole block.
                if ( !previous.isContentEditable ) {
                    detach( previous );
                    return;
                }
                // Otherwise merge.
                mergeWithBlock( previous, current, range );
                // If deleted line between containers, merge newly adjacent
                // containers.
                current = previous.parentNode;
                while ( current !== root && !current.nextSibling ) {
                    current = current.parentNode;
                }
                if ( current !== root && ( current = current.nextSibling ) ) {
                    mergeContainers( current, root );
                }
                self.setSelection( range );
            }
            // If at very beginning of text area, allow backspace
            // to break lists/blockquote.
            else if ( current ) {
                // Break list
                if ( getNearest( current, root, 'UL' ) ||
                        getNearest( current, root, 'OL' ) ) {
                    return self.decreaseListLevel( range, false );
                }
                // Break blockquote
                else if ( getNearest( current, root, 'BLOCKQUOTE' ) ) {
                    return self.decreaseBlockQuoteLevel( range, false );
                }
                self.setSelection( range );
                self._updatePath( range, true );
            }
        }
        // Otherwise, leave to browser but check afterwards whether it has
        // left behind an empty inline tag.
        else {
            self.setSelection( range );
            setTimeout( () => afterDelete( self ), 0 );
        }
    },
    'delete'( self, event, range ) {
        const root = self._root;
        self._removeZWS();
        // Record undo checkpoint.
        self.saveUndoState( range );
        // If not collapsed, delete contents
        if ( !range.collapsed ) {
            event.preventDefault();
            deleteContentsOfRange( range, root );
            afterDelete( self, range );
        }
        // If at end of block, merge next into this block
        else if ( rangeDoesEndAtBlockBoundary( range, root ) ) {
            event.preventDefault();
            const current = getStartBlockOfRange( range, root );
            if ( !current ) {
                return;
            }
            // In case inline data has somehow got between blocks.
            fixContainer( current.parentNode, root );
            // Now get next block
            let next = getNextBlock( current, root );
            // Must not be at the very end of the text area.
            if ( next ) {
                // If not editable, just delete whole block.
                if ( !next.isContentEditable ) {
                    detach( next );
                    return;
                }
                // Otherwise merge.
                mergeWithBlock( current, next, range );
                // If deleted line between containers, merge newly adjacent
                // containers.
                next = current.parentNode;
                while ( next !== root && !next.nextSibling ) {
                    next = next.parentNode;
                }
                if ( next !== root && ( next = next.nextSibling ) ) {
                    mergeContainers( next, root );
                }
                self.setSelection( range );
                self._updatePath( range, true );
            }
        }
        // Otherwise, leave to browser but check afterwards whether it has
        // left behind an empty inline tag.
        else {
            // But first check if the cursor is just before an IMG tag. If so,
            // delete it ourselves, because the browser won't if it is not
            // inline.
            const originalRange = range.cloneRange();
            moveRangeBoundariesUpTree( range, root, root, root );
            const cursorContainer = range.endContainer;
            const cursorOffset = range.endOffset;
            if ( cursorContainer.nodeType === ELEMENT_NODE ) {
                const nodeAfterCursor = cursorContainer.childNodes[
                    cursorOffset ];
                if ( nodeAfterCursor && nodeAfterCursor.nodeName === 'IMG' ) {
                    event.preventDefault();
                    detach( nodeAfterCursor );
                    moveRangeBoundariesDownTree( range );
                    afterDelete( self, range );
                    return;
                }
            }
            self.setSelection( originalRange );
            setTimeout( () => afterDelete( self ), 0 );
        }
    },
    tab( self, event, range ) {
        const root = self._root;
        self._removeZWS();
        // If no selection and at start of block
        if ( range.collapsed && rangeDoesStartAtBlockBoundary( range, root ) ) {
            let node = getStartBlockOfRange( range, root );
            // Iterate through the block's parents
            let parent;
            while ( parent = node.parentNode ) {
                // If we find a UL or OL (so are in a list, node must be an LI)
                if ( parent.nodeName === 'UL' || parent.nodeName === 'OL' ) {
                    // Then increase the list level
                    event.preventDefault();
                    self.increaseListLevel( range, false );
                    break;
                }
                node = parent;
            }
        }
    },
    'shift-tab'( self, event, range ) {
        const root = self._root;
        self._removeZWS();
        // If no selection and at start of block
        if ( range.collapsed && rangeDoesStartAtBlockBoundary( range, root ) ) {
            // Break list
            const node = range.startContainer;
            if ( getNearest( node, root, 'UL' ) ||
                    getNearest( node, root, 'OL' ) ) {
                event.preventDefault();
                self.decreaseListLevel( range, false );
            }
        }
    },
    space( self, _, range ) {
        self._recordUndoState( range );
        addLinks( range.startContainer, self._root, self );
        self._getRangeAndRemoveBookmark( range );

        // If the cursor is at the end of a link (<a>foo|</a>) then move it
        // outside of the link (<a>foo</a>|) so that the space is not part of
        // the link text.
        const node = range.endContainer;
        const parent = node.parentNode;
        if ( range.collapsed && parent.nodeName === 'A' &&
                !node.nextSibling && range.endOffset === getLength( node ) ) {
            range.setStartAfter( parent );
        }
        // Delete the selection if not collapsed
        else if ( !range.collapsed ) {
            deleteContentsOfRange( range, self._root );
            self._ensureBottomLine();
            self.setSelection( range );
            self._updatePath( range, true );
        }

        self.setSelection( range );
    },
    left( self ) {
        self._removeZWS();
    },
    right( self ) {
        self._removeZWS();
    }
};

// Firefox pre v29 incorrectly handles Cmd-left/Cmd-right on Mac:
// it goes back/forward in history! Override to do the right
// thing.
// https://bugzilla.mozilla.org/show_bug.cgi?id=289384
if ( isMac && isGecko ) {
    keyHandlers[ 'meta-left' ] = ( self, event ) => {
        event.preventDefault();
        const sel = getWindowSelection( self );
        if ( sel && sel.modify ) {
            sel.modify( 'move', 'backward', 'lineboundary' );
        }
    };
    keyHandlers[ 'meta-right' ] = ( self, event ) => {
        event.preventDefault();
        const sel = getWindowSelection( self );
        if ( sel && sel.modify ) {
            sel.modify( 'move', 'forward', 'lineboundary' );
        }
    };
}

// System standard for page up/down on Mac is to just scroll, not move the
// cursor. On Linux/Windows, it should move the cursor, but some browsers don't
// implement this natively. Override to support it.
if ( !isMac ) {
    keyHandlers.pageup = self => self.moveCursorToStart();
    keyHandlers.pagedown = self => self.moveCursorToEnd();
}

keyHandlers[ ctrlKey + 'b' ] = mapKeyToFormat( 'B' );
keyHandlers[ ctrlKey + 'i' ] = mapKeyToFormat( 'I' );
keyHandlers[ ctrlKey + 'u' ] = mapKeyToFormat( 'U' );
keyHandlers[ ctrlKey + 'shift-7' ] = mapKeyToFormat( 'S' );
keyHandlers[ ctrlKey + 'shift-5' ] = mapKeyToFormat( 'SUB', { tag: 'SUP' } );
keyHandlers[ ctrlKey + 'shift-6' ] = mapKeyToFormat( 'SUP', { tag: 'SUB' } );
keyHandlers[ ctrlKey + 'shift-8' ] = mapKeyTo( 'makeUnorderedList' );
keyHandlers[ ctrlKey + 'shift-9' ] = mapKeyTo( 'makeOrderedList' );
keyHandlers[ ctrlKey + '[' ] = mapKeyTo( 'decreaseQuoteLevel' );
keyHandlers[ ctrlKey + ']' ] = mapKeyTo( 'increaseQuoteLevel' );
keyHandlers[ ctrlKey + 'y' ] = mapKeyTo( 'redo' );
keyHandlers[ ctrlKey + 'z' ] = mapKeyTo( 'undo' );
keyHandlers[ ctrlKey + 'shift-z' ] = mapKeyTo( 'redo' );
