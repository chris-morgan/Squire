/* global DOMPurify */
import {
    DOCUMENT_NODE, TEXT_NODE, ZWS, SHOW_TEXT, SHOW_ELEMENT,
    DOCUMENT_POSITION_PRECEDING,
    FONT_FAMILY_CLASS, FONT_SIZE_CLASS, COLOUR_CLASS, HIGHLIGHT_CLASS,
    isIElt11, isPresto, isAndroid, isIOS, isIE, canObserveMutations,
    cantFocusEmptyTextNodes, losesSelectionOnBlur, useTextFixer, indexOf,
} from "./Constants.js";
import TreeWalker from "./TreeWalker.js";
import {
    leafNodeNames, clearNodeCategoryCache, getBlockWalker, getNextBlock,
    hasTagAttributes, getNearest, isOrContains, getPath, getLength,
    detach, replaceWith, empty, createElement, fixCursor, fixContainer,
    split, mergeInlines, mergeContainers,
    isLeaf, isInline, isBlock, isContainer,
} from "./Node.js";
import {
    insertNodeInRange, extractContentsOfRange,
    insertTreeFragmentIntoRange, isNodeContainedInRange,
    moveRangeBoundariesDownTree, moveRangeBoundariesUpTree,
    getStartBlockOfRange, getEndBlockOfRange,
    expandRangeToBlockBoundaries,
} from "./Range.js";
import { onKey, keyHandlers } from "./KeyHandlers.js";
import { cleanTree, removeEmptyInlines, cleanupBRs } from "./Clean.js";
import {
    onCut, onCopy, monitorShiftKey, onPaste, onDrop
} from "./Clipboard.js";

function mergeObjects ( base, extras, mayOverride ) {
    if ( !base ) {
        base = {};
    }
    if ( extras ) {
        for ( const prop in extras ) {
            if ( mayOverride || !( prop in base ) ) {
                const value = extras[ prop ];
                base[ prop ] = ( value && value.constructor === Object ) ?
                    mergeObjects( base[ prop ], value, mayOverride ) :
                    value;
            }
        }
    }
    return base;
}

function sanitizeToDOMFragment ( html, isPaste, self ) {
    const doc = self._doc;
    const frag = html ? DOMPurify.sanitize( html, {
        WHOLE_DOCUMENT: false,
        RETURN_DOM: true,
        RETURN_DOM_FRAGMENT: true
    }) : null;
    return frag ? doc.importNode( frag, true ) : doc.createDocumentFragment();
}

// Subscribing to these events won't automatically add a listener to the
// document node, since these events are fired in a custom manner by the
// editor code.
const customEvents = {
    pathChange: 1, select: 1, input: 1, undoStateChange: 1
};

export function getWindowSelection ( self ) {
    return self._win.getSelection() || null;
}

function enableRestoreSelection () {
    this._restoreSelection = true;
}
function disableRestoreSelection () {
    this._restoreSelection = false;
}
function restoreSelection () {
    if ( this._restoreSelection ) {
        this.setSelection( this._lastSelection );
    }
}

// --- Workaround for browsers that can't focus empty text nodes ---

// WebKit bug: https://bugs.webkit.org/show_bug.cgi?id=15256

// Walk down the tree starting at the root and remove any ZWS. If the node only
// contained ZWS space then remove it too. We may want to keep one ZWS node at
// the bottom of the tree so the block can be selected. Define that node as the
// keepNode.
export function removeZWS ( root, keepNode ) {
    const walker = new TreeWalker( root, SHOW_TEXT, () => true, false );
    let node, index;
    while ( node = walker.nextNode() ) {
        while ( ( index = node.data.indexOf( ZWS ) ) > -1  &&
                ( !keepNode || node.parentNode !== keepNode ) ) {
            if ( node.length === 1 ) {
                do {
                    const parent = node.parentNode;
                    parent.removeChild( node );
                    node = parent;
                    walker.currentNode = parent;
                } while ( isInline( node ) && !getLength( node ) );
                break;
            } else {
                node.deleteData( index, 1 );
            }
        }
    }
}

// --- Block formatting ---

const tagAfterSplit = {
    DT: 'DD',
    DD: 'DT',
    LI: 'LI',
};

export function splitBlock ( self, block, node, offset ) {
    let splitTag = tagAfterSplit[ block.nodeName ];
    let splitProperties = null;
    let nodeAfterSplit = split( node, offset, block.parentNode, self._root );
    const config = self._config;

    if ( !splitTag ) {
        splitTag = config.blockTag;
        splitProperties = config.blockAttributes;
    }

    // Make sure the new node is the correct type.
    if ( !hasTagAttributes( nodeAfterSplit, splitTag, splitProperties ) ) {
        block = createElement( nodeAfterSplit.ownerDocument,
            splitTag, splitProperties );
        if ( nodeAfterSplit.dir ) {
            block.dir = nodeAfterSplit.dir;
        }
        replaceWith( nodeAfterSplit, block );
        block.appendChild( empty( nodeAfterSplit ) );
        nodeAfterSplit = block;
    }
    return nodeAfterSplit;
}

// --- Bookmarking ---

export const startSelectionId = 'squire-selection-start';
export const endSelectionId = 'squire-selection-end';

export function removeBlockQuote (/* frag */) {
    return this.createDefaultBlock([
        this.createElement( 'INPUT', {
            id: startSelectionId,
            type: 'hidden'
        }),
        this.createElement( 'INPUT', {
            id: endSelectionId,
            type: 'hidden'
        })
    ]);
}

function makeList ( self, frag, type ) {
    const walker = getBlockWalker( frag, self._root );
    const tagAttributes = self._config.tagAttributes;
    const listAttrs = tagAttributes[ type.toLowerCase() ];
    const listItemAttrs = tagAttributes.li;

    let node;
    while ( node = walker.nextNode() ) {
        if ( node.parentNode.nodeName === 'LI' ) {
            node = node.parentNode;
            walker.currentNode = node.lastChild;
        }
        if ( node.nodeName !== 'LI' ) {
            const newLi = self.createElement( 'LI', listItemAttrs );
            if ( node.dir ) {
                newLi.dir = node.dir;
            }

            // Have we replaced the previous block with a new <ul>/<ol>?
            const prev = node.previousSibling;
            if ( prev && prev.nodeName === type ) {
                prev.appendChild( newLi );
                detach( node );
            }
            // Otherwise, replace this block with the <ul>/<ol>
            else {
                replaceWith(
                    node,
                    self.createElement( type, listAttrs, [
                        newLi
                    ])
                );
            }
            newLi.appendChild( empty( node ) );
            walker.currentNode = newLi;
        } else {
            node = node.parentNode;
            const tag = node.nodeName;
            if ( tag !== type && ( /^[OU]L$/.test( tag ) ) ) {
                replaceWith( node,
                    self.createElement( type, listAttrs, [ empty( node ) ] )
                );
            }
        }
    }
}

// --- Get/set data ---

const linkRegExp = /\b((?:(?:ht|f)tps?:\/\/|www\d{0,3}[.]|[a-z0-9.\-]+[.][a-z]{2,}\/)(?:[^\s()<>]+|\([^\s()<>]+\))+(?:\((?:[^\s()<>]+|(?:\([^\s()<>]+\)))*\)|[^\s`!()\[\]{};:'".,<>?«»“”‘’]))|([\w\-.%+]+@(?:[\w\-]+\.)+[A-Z]{2,}\b)/i;

export function addLinks ( frag, root, self ) {
    const doc = frag.ownerDocument;
    const walker = new TreeWalker( frag, SHOW_TEXT,
            node => !getNearest( node, root, 'A' ), false );
    const defaultAttributes = self._config.tagAttributes.a;
    let node, match;
    while ( node = walker.nextNode() ) {
        let data = node.data;
        const parent = node.parentNode;
        while ( match = linkRegExp.exec( data ) ) {
            const index = match.index;
            const endIndex = index + match[0].length;
            if ( index ) {
                const child = doc.createTextNode( data.slice( 0, index ) );
                parent.insertBefore( child, node );
            }
            const child = self.createElement( 'A', mergeObjects({
                href: match[1] ?
                    /^(?:ht|f)tps?:/.test( match[1] ) ?
                        match[1] :
                        'http://' + match[1] :
                    'mailto:' + match[2]
            }, defaultAttributes, false ));
            child.textContent = data.slice( index, endIndex );
            parent.insertBefore( child, node );
            node.data = data = data.slice( endIndex );
        }
    }
}

function escapeHTMLFragment ( text ) {
    return text.split( '&' ).join( '&amp;' )
               .split( '<' ).join( '&lt;'  )
               .split( '>' ).join( '&gt;'  )
               .split( '"' ).join( '&quot;'  );
}

// --- Formatting ---

function removeFormatting ( self, root, clean ) {
    for ( let node = root.firstChild, next; node; node = next ) {
        next = node.nextSibling;
        if ( isInline( node ) ) {
            if ( node.nodeType === TEXT_NODE || node.nodeName === 'BR' || node.nodeName === 'IMG' ) {
                clean.appendChild( node );
                continue;
            }
        } else if ( isBlock( node ) ) {
            clean.appendChild( self.createDefaultBlock([
                removeFormatting(
                    self, node, self._doc.createDocumentFragment() )
            ]));
            continue;
        }
        removeFormatting( self, node, clean );
    }

    return clean;
}

// --- Miscellaneous ---

// --- The actual class (viz. the public interface) ---

export class Squire {
    constructor( root, config ) {
        if ( root.nodeType === DOCUMENT_NODE ) {
            root = root.body;
        }
        const doc = root.ownerDocument;
        const win = doc.defaultView;

        this._win = win;
        this._doc = doc;
        this._root = root;

        this._events = {};

        this._isFocused = false;
        this._lastSelection = null;

        // IE loses selection state of iframe on blur, so make sure we
        // cache it just before it loses focus.
        if ( losesSelectionOnBlur ) {
            this.addEventListener( 'beforedeactivate', this.getSelection );
        }

        this._hasZWS = false;

        this._lastAnchorNode = null;
        this._lastFocusNode = null;
        this._path = '';
        this._willUpdatePath = false;

        if ( 'onselectionchange' in doc ) {
            this.addEventListener( 'selectionchange', this._updatePathOnEvent );
        } else {
            this.addEventListener( 'keyup', this._updatePathOnEvent );
            this.addEventListener( 'mouseup', this._updatePathOnEvent );
        }

        this._undoIndex = -1;
        this._undoStack = [];
        this._undoStackLength = 0;
        this._isInUndoState = false;
        this._ignoreChange = false;
        this._ignoreAllChanges = false;

        if ( canObserveMutations ) {
            const mutation = new MutationObserver(
                this._docWasChanged.bind( this ) );
            mutation.observe( root, {
                childList: true,
                attributes: true,
                characterData: true,
                subtree: true
            });
            this._mutation = mutation;
        } else {
            this.addEventListener( 'keyup', this._keyUpDetectChange );
        }

        // On blur, restore focus except if the user taps or clicks to focus a
        // specific point. Can't actually use click event because focus happens
        // before click, so use mousedown/touchstart
        this._restoreSelection = false;
        this.addEventListener( 'blur', enableRestoreSelection );
        this.addEventListener( 'mousedown', disableRestoreSelection );
        this.addEventListener( 'touchstart', disableRestoreSelection );
        this.addEventListener( 'focus', restoreSelection );

        // IE sometimes fires the beforepaste event twice; make sure it is not run
        // again before our after paste function is called.
        this._awaitingPaste = false;
        this.addEventListener( isIElt11 ? 'beforecut' : 'cut', onCut );
        this.addEventListener( 'copy', onCopy );
        this.addEventListener( 'keydown', monitorShiftKey );
        this.addEventListener( 'keyup', monitorShiftKey );
        this.addEventListener( isIElt11 ? 'beforepaste' : 'paste', onPaste );
        this.addEventListener( 'drop', onDrop );

        // Opera does not fire keydown repeatedly.
        this.addEventListener( isPresto ? 'keypress' : 'keydown', onKey );

        // Add key handlers
        this._keyHandlers = Object.create( keyHandlers );

        // Override default properties
        this.setConfig( config );

        // Fix IE<10's buggy implementation of Text#splitText.
        // If the split is at the end of the node, it doesn't insert the newly
        // split node into the document, and sets its value to undefined rather
        // than ''. And even if the split is not at the end, the original node
        // is removed from the document and replaced by another, rather than
        // just having its data shortened.
        // We used to feature test for this, but then found the feature test
        // would sometimes pass, but later on the buggy behaviour would still
        // appear. I think IE10 does not have the same bug, but it doesn't hurt
        // to replace its native fn too and then we don't need yet another UA
        // category.
        if ( isIElt11 ) {
            win.Text.prototype.splitText = function ( offset ) {
                const afterSplit = this.ownerDocument.createTextNode(
                        this.data.slice( offset ) );
                const { nextSibling, parentNode } = this;
                const toDelete = this.length - offset;
                if ( nextSibling ) {
                    parentNode.insertBefore( afterSplit, nextSibling );
                } else {
                    parentNode.appendChild( afterSplit );
                }
                if ( toDelete ) {
                    this.deleteData( offset, toDelete );
                }
                return afterSplit;
            };
        }

        root.setAttribute( 'contenteditable', 'true' );

        // Remove Firefox's built-in controls
        try {
            doc.execCommand( 'enableObjectResizing', false, 'false' );
            doc.execCommand( 'enableInlineTableEditing', false, 'false' );
        } catch ( error ) {}

        root.__squire__ = this;

        // Need to register instance before calling setHTML, so that the
        // fixCursor function can lookup any default block tag options set.
        this.setHTML( '' );
    }

    setConfig( config ) {
        config = mergeObjects({
            blockTag: 'DIV',
            blockAttributes: null,
            tagAttributes: {
                blockquote: null,
                ul: null,
                ol: null,
                li: null,
                a: null
            },
            leafNodeNames,
            undo: {
                documentSizeThreshold: -1, // -1 means no threshold
                undoLimit: -1 // -1 means no limit
            },
            isInsertedHTMLSanitized: true,
            isSetHTMLSanitized: true,
            sanitizeToDOMFragment:
                typeof DOMPurify !== 'undefined' && DOMPurify.isSupported ?
                sanitizeToDOMFragment : null

        }, config, true );

        // Users may specify block tag in lower case
        config.blockTag = config.blockTag.toUpperCase();

        this._config = config;

        return this;
    }

    createElement( tag, props, children ) {
        return createElement( this._doc, tag, props, children );
    }

    createDefaultBlock( children ) {
        const config = this._config;
        return fixCursor(
            this.createElement( config.blockTag, config.blockAttributes,
                children ),
            this._root
        );
    }

    didError( error ) {
        console.log( error );
    }

    getDocument() {
        return this._doc;
    }
    getRoot() {
        return this._root;
    }

    modifyDocument( modificationCallback ) {
        const mutation = this._mutation;
        if ( mutation ) {
            if ( mutation.takeRecords().length ) {
                this._docWasChanged();
            }
            mutation.disconnect();
        }

        this._ignoreAllChanges = true;
        modificationCallback();
        this._ignoreAllChanges = false;

        if ( mutation ) {
            mutation.observe( this._root, {
                childList: true,
                attributes: true,
                characterData: true,
                subtree: true
            });
            this._ignoreChange = false;
        }
    }

    // --- Events ---

    fireEvent( type, event ) {
        let handlers = this._events[ type ];
        // UI code, especially modal views, may be monitoring for focus events and
        // immediately removing focus. In certain conditions, this can cause the
        // focus event to fire after the blur event, which can cause an infinite
        // loop. So we detect whether we're actually focused/blurred before firing.
        if ( /^(?:focus|blur)/.test( type ) ) {
            const isFocused = isOrContains(
                this._root, this._doc.activeElement );
            if ( type === 'focus' ) {
                if ( !isFocused || this._isFocused ) {
                    return this;
                }
                this._isFocused = true;
            } else {
                if ( isFocused || !this._isFocused ) {
                    return this;
                }
                this._isFocused = false;
            }
        }
        if ( handlers ) {
            if ( !event ) {
                event = {};
            }
            if ( event.type !== type ) {
                event.type = type;
            }
            // Clone handlers array, so any handlers added/removed do not affect it.
            handlers = handlers.slice();
            let l = handlers.length;
            while ( l-- ) {
                const obj = handlers[l];
                try {
                    if ( obj.handleEvent ) {
                        obj.handleEvent( event );
                    } else {
                        obj.call( this, event );
                    }
                } catch ( error ) {
                    error.details = 'Squire: fireEvent error. Event type: ' + type;
                    this.didError( error );
                }
            }
        }
        return this;
    }

    destroy() {
        for ( const type in this._events ) {
            this.removeEventListener( type );
        }
        if ( this._mutation ) {
            this._mutation.disconnect();
        }
        delete this._root.__squire__;

        // Destroy undo stack
        this._undoIndex = -1;
        this._undoStack = [];
        this._undoStackLength = 0;
    }

    handleEvent( event ) {
        this.fireEvent( event.type, event );
    }

    addEventListener( type, fn ) {
        if ( !fn ) {
            this.didError({
                name: 'Squire: addEventListener with null or undefined fn',
                message: 'Event type: ' + type
            });
            return this;
        }
        let handlers = this._events[ type ];
        if ( !handlers ) {
            handlers = this._events[ type ] = [];
            if ( !customEvents[ type ] ) {
                let target = this._root;
                if ( type === 'selectionchange' ) {
                    target = this._doc;
                }
                target.addEventListener( type, this, true );
            }
        }
        handlers.push( fn );
        return this;
    }

    removeEventListener( type, fn ) {
        const handlers = this._events[ type ];
        if ( handlers ) {
            if ( fn ) {
                let l = handlers.length;
                while ( l-- ) {
                    if ( handlers[l] === fn ) {
                        handlers.splice( l, 1 );
                    }
                }
            } else {
                handlers.length = 0;
            }
            if ( !handlers.length ) {
                delete this._events[ type ];
                if ( !customEvents[ type ] ) {
                    let target = this._root;
                    if ( type === 'selectionchange' ) {
                        target = this._doc;
                    }
                    target.removeEventListener( type, this, true );
                }
            }
        }
        return this;
    }

    // --- Selection and Path ---

    _createRange( range, startOffset, endContainer, endOffset ) {
        if ( range instanceof this._win.Range ) {
            return range.cloneRange();
        }
        const domRange = this._doc.createRange();
        domRange.setStart( range, startOffset );
        if ( endContainer ) {
            domRange.setEnd( endContainer, endOffset );
        } else {
            domRange.setEnd( range, startOffset );
        }
        return domRange;
    }

    getCursorPosition( range ) {
        if ( ( !range && !( range = this.getSelection() ) ) ||
                !range.getBoundingClientRect ) {
            return null;
        }
        // Get the bounding rect
        let rect = range.getBoundingClientRect();
        if ( rect && !rect.top ) {
            this._ignoreChange = true;
            const node = this._doc.createElement( 'SPAN' );
            node.textContent = ZWS;
            insertNodeInRange( range, node );
            rect = node.getBoundingClientRect();
            const parent = node.parentNode;
            parent.removeChild( node );
            mergeInlines( parent, range );
        }
        return rect;
    }

    _moveCursorTo( toStart ) {
        const root = this._root;
        const range = this._createRange(
                root, toStart ? 0 : root.childNodes.length );
        moveRangeBoundariesDownTree( range );
        this.setSelection( range );
        return this;
    }
    moveCursorToStart() {
        return this._moveCursorTo( true );
    }
    moveCursorToEnd() {
        return this._moveCursorTo( false );
    }

    setSelection( range ) {
        if ( range ) {
            this._lastSelection = range;
            // If we're setting selection, that automatically, and synchronously, // triggers a focus event. So just store the selection and mark it as
            // needing restore on focus.
            if ( !this._isFocused ) {
                enableRestoreSelection.call( this );
            } else if ( isAndroid && !this._restoreSelection ) {
                // Android closes the keyboard on removeAllRanges() and doesn't
                // open it again when addRange() is called, sigh.
                // Since Android doesn't trigger a focus event in setSelection(),
                // use a blur/focus dance to work around this by letting the
                // selection be restored on focus.
                // Need to check for !this._restoreSelection to avoid infinite loop
                enableRestoreSelection.call( this );
                this.blur();
                this.focus();
            } else {
                // iOS bug: if you don't focus the iframe before setting the
                // selection, you can end up in a state where you type but the input
                // doesn't get directed into the contenteditable area but is instead
                // lost in a black hole. Very strange.
                if ( isIOS ) {
                    this._win.focus();
                }
                const sel = getWindowSelection( this );
                if ( sel ) {
                    sel.removeAllRanges();
                    sel.addRange( range );
                }
            }
        }
        return this;
    }

    getSelection() {
        const sel = getWindowSelection( this );
        let selection;
        // If not focused, always rely on cached selection; another function may
        // have set it but the DOM is not modified until focus again
        if ( this._isFocused && sel && sel.rangeCount ) {
            selection = sel.getRangeAt( 0 ).cloneRange();
            const startContainer = selection.startContainer;
            const endContainer = selection.endContainer;
            // FF can return the selection as being inside an <img>. WTF?
            if ( startContainer && isLeaf( startContainer ) ) {
                selection.setStartBefore( startContainer );
            }
            if ( endContainer && isLeaf( endContainer ) ) {
                selection.setEndBefore( endContainer );
            }
        }
        const root = this._root;
        if ( selection &&
                isOrContains( root, selection.commonAncestorContainer ) ) {
            this._lastSelection = selection;
        } else {
            selection = this._lastSelection;
        }
        if ( !selection ) {
            selection = this._createRange( root.firstChild, 0 );
        }
        return selection;
    }

    getSelectedText() {
        const range = this.getSelection();
        const walker = new TreeWalker(
                range.commonAncestorContainer,
                SHOW_TEXT|SHOW_ELEMENT,
                node => isNodeContainedInRange( range, node, true )
            );
        const { startContainer, endContainer } = range;
        let node = walker.currentNode = startContainer;
        let textContent = '';
        let addedTextInBlock = false;

        if ( !walker.filter( node ) ) {
            node = walker.nextNode();
        }

        while ( node ) {
            if ( node.nodeType === TEXT_NODE ) {
                let value = node.data;
                if ( value && ( /\S/.test( value ) ) ) {
                    if ( node === endContainer ) {
                        value = value.slice( 0, range.endOffset );
                    }
                    if ( node === startContainer ) {
                        value = value.slice( range.startOffset );
                    }
                    textContent += value;
                    addedTextInBlock = true;
                }
            } else if ( node.nodeName === 'BR' ||
                    addedTextInBlock && !isInline( node ) ) {
                textContent += '\n';
                addedTextInBlock = false;
            }
            node = walker.nextNode();
        }

        return textContent;
    }

    getPath() {
        return this._path;
    }

    _didAddZWS() {
        this._hasZWS = true;
    }
    _removeZWS() {
        if ( !this._hasZWS ) {
            return;
        }
        removeZWS( this._root );
        this._hasZWS = false;
    }

    // --- Path change events ---

    _updatePath( range, force ) {
        const anchor = range.startContainer;
        const focus = range.endContainer;
        if ( force || anchor !== this._lastAnchorNode ||
                focus !== this._lastFocusNode ) {
            this._lastAnchorNode = anchor;
            this._lastFocusNode = focus;
            const newPath = ( anchor && focus ) ? ( anchor === focus ) ?
                getPath( focus, this._root ) : '(selection)' : '';
            if ( this._path !== newPath ) {
                this._path = newPath;
                this.fireEvent( 'pathChange', { path: newPath } );
            }
        }
        if ( !range.collapsed ) {
            this.fireEvent( 'select' );
        }
    }

    // selectionchange is fired synchronously in IE when removing current
    // selection and when setting new selection; keyup/mouseup may have
    // processing we want to do first. Either way, send to next event loop.
    _updatePathOnEvent() {
        if ( !this._willUpdatePath ) {
            this._willUpdatePath = true;
            setTimeout( () => {
                this._willUpdatePath = false;
                this._updatePath( this.getSelection() );
            }, 0 );
        }
    }

    // --- Focus ---

    focus() {
        this._root.focus();

        if ( isIE ) {
            this.fireEvent( 'focus' );
        }

        return this;
    }

    blur() {
        this._root.blur();

        if ( isIE ) {
            this.fireEvent( 'blur' );
        }

        return this;
    }

    _saveRangeToBookmark( range ) {
        let startNode = this.createElement( 'INPUT', {
                id: startSelectionId,
                type: 'hidden'
            });
        let endNode = this.createElement( 'INPUT', {
                id: endSelectionId,
                type: 'hidden'
            });

        insertNodeInRange( range, startNode );
        range.collapse( false );
        insertNodeInRange( range, endNode );

        // In a collapsed range, the start is sometimes inserted after the end!
        if ( startNode.compareDocumentPosition( endNode ) &
                DOCUMENT_POSITION_PRECEDING ) {
            startNode.id = endSelectionId;
            endNode.id = startSelectionId;
            const temp = startNode;
            startNode = endNode;
            endNode = temp;
        }

        range.setStartAfter( startNode );
        range.setEndBefore( endNode );
    }

    _getRangeAndRemoveBookmark( range ) {
        const root = this._root;
        const start = root.querySelector( '#' + startSelectionId );
        const end = root.querySelector( '#' + endSelectionId );

        if ( start && end ) {
            let startContainer = start.parentNode;
            let endContainer = end.parentNode;
            const startOffset = indexOf.call(
                startContainer.childNodes, start );
            let endOffset = indexOf.call( endContainer.childNodes, end );

            if ( startContainer === endContainer ) {
                endOffset -= 1;
            }

            detach( start );
            detach( end );

            if ( !range ) {
                range = this._doc.createRange();
            }
            range.setStart( startContainer, startOffset );
            range.setEnd( endContainer, endOffset );

            // Merge any text nodes we split
            mergeInlines( startContainer, range );
            if ( startContainer !== endContainer ) {
                mergeInlines( endContainer, range );
            }

            // If we didn't split a text node, we should move into any adjacent
            // text node to current selection point
            if ( range.collapsed ) {
                startContainer = range.startContainer;
                if ( startContainer.nodeType === TEXT_NODE ) {
                    endContainer = startContainer.childNodes[ range.startOffset ];
                    if ( !endContainer || endContainer.nodeType !== TEXT_NODE ) {
                        endContainer =
                            startContainer.childNodes[ range.startOffset - 1 ];
                    }
                    if ( endContainer && endContainer.nodeType === TEXT_NODE ) {
                        range.setStart( endContainer, 0 );
                        range.collapse( true );
                    }
                }
            }
        }
        return range || null;
    }

    // --- Undo ---

    _keyUpDetectChange( event ) {
        const code = event.keyCode;
        // Presume document was changed if:
        // 1. A modifier key (other than shift) wasn't held down
        // 2. The key pressed is not in range 16<=x<=20 (control keys)
        // 3. The key pressed is not in range 33<=x<=45 (navigation keys)
        if ( !event.ctrlKey && !event.metaKey && !event.altKey &&
                ( code < 16 || code > 20 ) &&
                ( code < 33 || code > 45 ) ) {
            this._docWasChanged();
        }
    }

    _docWasChanged() {
        clearNodeCategoryCache();
        if ( this._ignoreAllChanges ) {
            return;
        }

        if ( canObserveMutations && this._ignoreChange ) {
            this._ignoreChange = false;
            return;
        }
        if ( this._isInUndoState ) {
            this._isInUndoState = false;
            this.fireEvent( 'undoStateChange', {
                canUndo: true,
                canRedo: false
            });
        }
        this.fireEvent( 'input' );
    }

    // Leaves bookmark
    _recordUndoState( range ) {
        // Don't record if we're already in an undo state
        if ( !this._isInUndoState ) {
            // Advance pointer to new position
            let undoIndex = this._undoIndex += 1;
            const undoStack = this._undoStack;

            // Truncate stack if longer (i.e. if has been previously undone)
            if ( undoIndex < this._undoStackLength ) {
                undoStack.length = this._undoStackLength = undoIndex;
            }

            // Get data
            if ( range ) {
                this._saveRangeToBookmark( range );
            }
            const html = this._getHTML();

            // If this document is above the configured size threshold,
            // limit the number of saved undo states.
            // Threshold is in bytes, JS uses 2 bytes per character
            const { documentSizeThreshold, undoLimit } = this._config.undo;
            if ( documentSizeThreshold > -1 &&
                    html.length * 2 > documentSizeThreshold ) {
                if ( undoLimit > -1 && undoIndex > undoLimit ) {
                    undoStack.splice( 0, undoIndex - undoLimit );
                    undoIndex = this._undoIndex = undoLimit;
                    this._undoStackLength = undoLimit;
                }
            }

            // Save data
            undoStack[ undoIndex ] = html;
            this._undoStackLength += 1;
            this._isInUndoState = true;
        }
    }

    saveUndoState( range ) {
        if ( range === undefined ) {
            range = this.getSelection();
        }
        if ( !this._isInUndoState ) {
            this._recordUndoState( range );
            this._getRangeAndRemoveBookmark( range );
        }
        return this;
    }

    undo() {
        // Sanity check: must not be at beginning of the history stack
        if ( this._undoIndex !== 0 || !this._isInUndoState ) {
            // Make sure any changes since last checkpoint are saved.
            this._recordUndoState( this.getSelection() );

            this._undoIndex -= 1;
            this._setHTML( this._undoStack[ this._undoIndex ] );
            const range = this._getRangeAndRemoveBookmark();
            if ( range ) {
                this.setSelection( range );
            }
            this._isInUndoState = true;
            this.fireEvent( 'undoStateChange', {
                canUndo: this._undoIndex !== 0,
                canRedo: true
            });
            this.fireEvent( 'input' );
        }
        return this;
    }

    redo() {
        // Sanity check: must not be at end of stack and must be in an undo
        // state.
        const undoIndex = this._undoIndex;
        const undoStackLength = this._undoStackLength;
        if ( undoIndex + 1 < undoStackLength && this._isInUndoState ) {
            this._undoIndex += 1;
            this._setHTML( this._undoStack[ this._undoIndex ] );
            const range = this._getRangeAndRemoveBookmark();
            if ( range ) {
                this.setSelection( range );
            }
            this.fireEvent( 'undoStateChange', {
                canUndo: true,
                canRedo: undoIndex + 2 < undoStackLength
            });
            this.fireEvent( 'input' );
        }
        return this;
    }

    // --- Inline formatting ---

    // Looks for matching tag and attributes, so won't work
    // if <strong> instead of <b> etc.
    hasFormat( tag, attributes, range ) {
        // 1. Normalise the arguments and get selection
        tag = tag.toUpperCase();
        if ( !attributes ) { attributes = {}; }
        if ( !range && !( range = this.getSelection() ) ) {
            return false;
        }

        // Sanitize range to prevent weird IE artifacts
        if ( !range.collapsed &&
                range.startContainer.nodeType === TEXT_NODE &&
                range.startOffset === range.startContainer.length &&
                range.startContainer.nextSibling ) {
            range.setStartBefore( range.startContainer.nextSibling );
        }
        if ( !range.collapsed &&
                range.endContainer.nodeType === TEXT_NODE &&
                range.endOffset === 0 &&
                range.endContainer.previousSibling ) {
            range.setEndAfter( range.endContainer.previousSibling );
        }

        // If the common ancestor is inside the tag we require, we definitely
        // have the format.
        const root = this._root;
        const common = range.commonAncestorContainer;
        if ( getNearest( common, root, tag, attributes ) ) {
            return true;
        }

        // If common ancestor is a text node and doesn't have the format, we
        // definitely don't have it.
        if ( common.nodeType === TEXT_NODE ) {
            return false;
        }

        // Otherwise, check each text node at least partially contained within
        // the selection and make sure all of them have the format we want.
        const walker = new TreeWalker( common, SHOW_TEXT,
            node => isNodeContainedInRange( range, node, true ),
            false );

        let seenNode = false;
        let node;
        while ( node = walker.nextNode() ) {
            if ( !getNearest( node, root, tag, attributes ) ) {
                return false;
            }
            seenNode = true;
        }

        return seenNode;
    }

    // Extracts the font-family and font-size (if any) of the element
    // holding the cursor. If there's a selection, returns an empty object.
    getFontInfo( range ) {
        const fontInfo = {
            color: undefined,
            backgroundColor: undefined,
            family: undefined,
            size: undefined
        };

        if ( !range && !( range = this.getSelection() ) ) {
            return fontInfo;
        }

        let element = range.commonAncestorContainer;
        if ( range.collapsed || element.nodeType === TEXT_NODE ) {
            if ( element.nodeType === TEXT_NODE ) {
                element = element.parentNode;
            }
            let seenAttributes = 0;
            while ( seenAttributes < 4 && element ) {
                const style = element.style;
                if ( style ) {
                    let attr;
                    if ( !fontInfo.color && ( attr = style.color ) ) {
                        fontInfo.color = attr;
                        seenAttributes += 1;
                    }
                    if ( !fontInfo.backgroundColor &&
                            ( attr = style.backgroundColor ) ) {
                        fontInfo.backgroundColor = attr;
                        seenAttributes += 1;
                    }
                    if ( !fontInfo.family && ( attr = style.fontFamily ) ) {
                        fontInfo.family = attr;
                        seenAttributes += 1;
                    }
                    if ( !fontInfo.size && ( attr = style.fontSize ) ) {
                        fontInfo.size = attr;
                        seenAttributes += 1;
                    }
                }
                element = element.parentNode;
            }
        }
        return fontInfo;
    }

    _addFormat( tag, attributes, range ) {
        // If the range is collapsed we simply insert the node by wrapping
        // it round the range and focus it.
        const root = this._root;

        if ( range.collapsed ) {
            const el = fixCursor( this.createElement( tag, attributes ), root );
            insertNodeInRange( range, el );
            range.setStart( el.firstChild, el.firstChild.length );
            range.collapse( true );

            // Clean up any previous formats that may have been set on this block
            // that are unused.
            let block = el;
            while ( isInline( block ) ) {
                block = block.parentNode;
            }
            removeZWS( block, el );
        }
        // Otherwise we find all the textnodes in the range (splitting
        // partially selected nodes) and if they're not already formatted
        // correctly we wrap them in the appropriate tag.
        else {
            // Create an iterator to walk over all the text nodes under this
            // ancestor which are in the range and not already formatted
            // correctly.
            //
            // In Blink/WebKit, empty blocks may have no text nodes, just a <br>.
            // Therefore we wrap this in the tag as well, as this will then cause it
            // to apply when the user types something in the block, which is
            // presumably what was intended.
            //
            // IMG tags are included because we may want to create a link around
            // them, and adding other styles is harmless.
            const walker = new TreeWalker(
                range.commonAncestorContainer,
                SHOW_TEXT|SHOW_ELEMENT,
                node => ( node.nodeType === TEXT_NODE ||
                            node.nodeName === 'BR' ||
                            node.nodeName === 'IMG'
                        ) && isNodeContainedInRange( range, node, true ),
                false
            );

            // Start at the beginning node of the range and iterate through
            // all the nodes in the range that need formatting.
            let {
                startContainer, startOffset, endContainer, endOffset
            } = range;

            // Make sure we start with a valid node.
            walker.currentNode = startContainer;
            if ( !walker.filter( startContainer ) ) {
                startContainer = walker.nextNode();
                startOffset = 0;
            }

            // If there are no interesting nodes in the selection, abort
            if ( !startContainer ) {
                return range;
            }

            let node;
            do {
                node = walker.currentNode;
                const needsFormat = !getNearest( node, root, tag, attributes );
                if ( needsFormat ) {
                    // <br> can never be a container node, so must have a text node
                    // if node == (end|start)Container
                    if ( node === endContainer && node.length > endOffset ) {
                        node.splitText( endOffset );
                    }
                    if ( node === startContainer && startOffset ) {
                        node = node.splitText( startOffset );
                        if ( endContainer === startContainer ) {
                            endContainer = node;
                            endOffset -= startOffset;
                        }
                        startContainer = node;
                        startOffset = 0;
                    }
                    const el = this.createElement( tag, attributes );
                    replaceWith( node, el );
                    el.appendChild( node );
                }
            } while ( walker.nextNode() );

            // If we don't finish inside a text node, offset may have changed.
            if ( endContainer.nodeType !== TEXT_NODE ) {
                if ( node.nodeType === TEXT_NODE ) {
                    endContainer = node;
                    endOffset = node.length;
                } else {
                    // If <br>, we must have just wrapped it, so it must have only
                    // one child
                    endContainer = node.parentNode;
                    endOffset = 1;
                }
            }

            // Now set the selection to as it was before
            range = this._createRange(
                startContainer, startOffset, endContainer, endOffset );
        }
        return range;
    }

    _removeFormat( tag, attributes, range, partial ) {
        // Add bookmark
        this._saveRangeToBookmark( range );

        // We need a node in the selection to break the surrounding
        // formatted text.
        const doc = this._doc;
        let fixer;
        if ( range.collapsed ) {
            if ( cantFocusEmptyTextNodes ) {
                fixer = doc.createTextNode( ZWS );
                this._didAddZWS();
            } else {
                fixer = doc.createTextNode( '' );
            }
            insertNodeInRange( range, fixer );
        }

        // Find block-level ancestor of selection
        let root = range.commonAncestorContainer;
        while ( isInline( root ) ) {
            root = root.parentNode;
        }

        // Find text nodes inside formatTags that are not in selection and
        // add an extra tag with the same formatting.
        const { startContainer, startOffset, endContainer, endOffset } = range;
        const toWrap = [];
        const formatTags = Array.prototype.filter.call(
                root.getElementsByTagName( tag ),
                el => isNodeContainedInRange( range, el, true ) &&
                        hasTagAttributes( el, tag, attributes )
            );

        function examineNode ( node, exemplar ) {
            // If the node is completely contained by the range then
            // we're going to remove all formatting so ignore it.
            if ( isNodeContainedInRange( range, node, false ) ) {
                return;
            }

            const isText = ( node.nodeType === TEXT_NODE );

            // If not at least partially contained, wrap entire contents
            // in a clone of the tag we're removing and we're done.
            if ( !isNodeContainedInRange( range, node, true ) ) {
                // Ignore bookmarks and empty text nodes
                if ( node.nodeName !== 'INPUT' &&
                        ( !isText || node.data ) ) {
                    toWrap.push([ exemplar, node ]);
                }
                return;
            }

            // Split any partially selected text nodes.
            if ( isText ) {
                if ( node === endContainer && endOffset !== node.length ) {
                    toWrap.push([ exemplar, node.splitText( endOffset ) ]);
                }
                if ( node === startContainer && startOffset ) {
                    node.splitText( startOffset );
                    toWrap.push([ exemplar, node ]);
                }
            }
            // If not a text node, recurse onto all children.
            // Beware, the tree may be rewritten with each call
            // to examineNode, hence find the next sibling first.
            else {
                let child = node.firstChild;
                while ( child ) {
                    const next = child.nextSibling;
                    examineNode( child, exemplar );
                    child = next;
                }
            }
        }

        if ( !partial ) {
            formatTags.forEach( node => examineNode( node, node ) );
        }

        // Now wrap unselected nodes in the tag
        toWrap.forEach( ([ exemplar, node ]) => {
            const el = exemplar.cloneNode( false );
            replaceWith( node, el );
            el.appendChild( node );
        });
        // and remove old formatting tags.
        formatTags.forEach( el => replaceWith( el, empty( el ) ) );

        // Merge adjacent inlines:
        this._getRangeAndRemoveBookmark( range );
        if ( fixer ) {
            range.collapse( false );
        }
        mergeInlines( root, range );

        return range;
    }

    changeFormat( add, remove, range, partial ) {
        // Normalise the arguments and get selection
        if ( !range && !( range = this.getSelection() ) ) {
            return this;
        }

        // Save undo checkpoint
        this.saveUndoState( range );

        if ( remove ) {
            range = this._removeFormat( remove.tag.toUpperCase(),
                remove.attributes || {}, range, partial );
        }
        if ( add ) {
            range = this._addFormat( add.tag.toUpperCase(),
                add.attributes || {}, range );
        }

        this.setSelection( range );
        this._updatePath( range, true );

        // We're not still in an undo state
        if ( !canObserveMutations ) {
            this._docWasChanged();
        }

        return this;
    }

    // --- Block formatting ---

    forEachBlock( fn, mutates, range ) {
        if ( !range && !( range = this.getSelection() ) ) {
            return this;
        }

        // Save undo checkpoint
        if ( mutates ) {
            this.saveUndoState( range );
        }

        const root = this._root;
        let start = getStartBlockOfRange( range, root );
        const end = getEndBlockOfRange( range, root );
        if ( start && end ) {
            do {
                if ( fn( start ) || start === end ) { break; }
            } while ( start = getNextBlock( start, root ) );
        }

        if ( mutates ) {
            this.setSelection( range );

            // Path may have changed
            this._updatePath( range, true );

            // We're not still in an undo state
            if ( !canObserveMutations ) {
                this._docWasChanged();
            }
        }
        return this;
    }

    modifyBlocks( modify, range ) {
        if ( !range && !( range = this.getSelection() ) ) {
            return this;
        }

        // 1. Save undo checkpoint and bookmark selection
        if ( this._isInUndoState ) {
            this._saveRangeToBookmark( range );
        } else {
            this._recordUndoState( range );
        }

        const root = this._root;

        // 2. Expand range to block boundaries
        expandRangeToBlockBoundaries( range, root );

        // 3. Remove range.
        moveRangeBoundariesUpTree( range, root, root, root );
        const frag = extractContentsOfRange( range, root, root );

        // 4. Modify tree of fragment and reinsert.
        insertNodeInRange( range, modify.call( this, frag ) );

        // 5. Merge containers at edges
        if ( range.endOffset < range.endContainer.childNodes.length ) {
            mergeContainers( range.endContainer.childNodes[ range.endOffset ], root );
        }
        mergeContainers( range.startContainer.childNodes[ range.startOffset ], root );

        // 6. Restore selection
        this._getRangeAndRemoveBookmark( range );
        this.setSelection( range );
        this._updatePath( range, true );

        // 7. We're not still in an undo state
        if ( !canObserveMutations ) {
            this._docWasChanged();
        }

        return this;
    }

    _ensureBottomLine() {
        const root = this._root;
        const last = root.lastElementChild;
        if ( !last ||
                last.nodeName !== this._config.blockTag || !isBlock( last ) ) {
            root.appendChild( this.createDefaultBlock() );
        }
    }

    // --- Keyboard interaction ---

    setKeyHandler( key, fn ) {
        this._keyHandlers[ key ] = fn;
        return this;
    }

    // --- Get/Set data ---

    _getHTML() {
        return this._root.innerHTML;
    }

    _setHTML( html ) {
        const root = this._root;
        let node = root;
        node.innerHTML = html;
        do {
            fixCursor( node, root );
        } while ( node = getNextBlock( node, root ) );
        this._ignoreChange = true;
    }

    getHTML( withBookMark ) {
        const brs = [];
        let range;
        if ( withBookMark && ( range = this.getSelection() ) ) {
            this._saveRangeToBookmark( range );
        }
        if ( useTextFixer ) {
            const root = this._root;
            let node = root;
            while ( node = getNextBlock( node, root ) ) {
                if ( !node.textContent && !node.querySelector( 'BR' ) ) {
                    const fixer = this.createElement( 'BR' );
                    node.appendChild( fixer );
                    brs.push( fixer );
                }
            }
        }
        const html = this._getHTML().replace( /\u200B/g, '' );
        if ( useTextFixer ) {
            let l = brs.length;
            while ( l-- ) {
                detach( brs[l] );
            }
        }
        if ( range ) {
            this._getRangeAndRemoveBookmark( range );
        }
        return html;
    }

    setHTML( html ) {
        const config = this._config;
        const sanitizeToDOMFragment = config.isSetHTMLSanitized ?
                config.sanitizeToDOMFragment : null;
        const root = this._root;

        // Parse HTML into DOM tree
        let frag;
        if ( typeof sanitizeToDOMFragment === 'function' ) {
            frag = sanitizeToDOMFragment( html, false, this );
        } else {
            const div = this.createElement( 'DIV' );
            div.innerHTML = html;
            frag = this._doc.createDocumentFragment();
            frag.appendChild( empty( div ) );
        }

        cleanTree( frag );
        cleanupBRs( frag, root, false );

        fixContainer( frag, root );

        // Fix cursor
        let node = frag;
        while ( node = getNextBlock( node, root ) ) {
            fixCursor( node, root );
        }

        // Don't fire an input event
        this._ignoreChange = true;

        // Remove existing root children
        let child;
        while ( child = root.lastChild ) {
            root.removeChild( child );
        }

        // And insert new content
        root.appendChild( frag );
        fixCursor( root, root );

        // Reset the undo stack
        this._undoIndex = -1;
        this._undoStack.length = 0;
        this._undoStackLength = 0;
        this._isInUndoState = false;

        // Record undo state
        const range = this._getRangeAndRemoveBookmark() ||
            this._createRange( root.firstChild, 0 );
        this.saveUndoState( range );
        // IE will also set focus when selecting text so don't use
        // setSelection. Instead, just store it in lastSelection, so if
        // anything calls getSelection before first focus, we have a range
        // to return.
        this._lastSelection = range;
        enableRestoreSelection.call( this );
        this._updatePath( range, true );

        return this;
    }

    insertElement( el, range ) {
        if ( !range ) { range = this.getSelection(); }
        range.collapse( true );
        if ( isInline( el ) ) {
            insertNodeInRange( range, el );
            range.setStartAfter( el );
        } else {
            // Get containing block node.
            const root = this._root;
            let splitNode = getStartBlockOfRange( range, root ) || root;
            // While at end of container node, move up DOM tree.
            while ( splitNode !== root && !splitNode.nextSibling ) {
                splitNode = splitNode.parentNode;
            }
            // If in the middle of a container node, split up to root.
            let nodeAfterSplit;
            if ( splitNode !== root ) {
                const parent = splitNode.parentNode;
                nodeAfterSplit = split( parent, splitNode.nextSibling, root, root );
            }
            if ( nodeAfterSplit ) {
                root.insertBefore( el, nodeAfterSplit );
            } else {
                root.appendChild( el );
                // Insert blank line below block.
                nodeAfterSplit = this.createDefaultBlock();
                root.appendChild( nodeAfterSplit );
            }
            range.setStart( nodeAfterSplit, 0 );
            range.setEnd( nodeAfterSplit, 0 );
            moveRangeBoundariesDownTree( range );
        }
        this.focus();
        this.setSelection( range );
        this._updatePath( range );

        if ( !canObserveMutations ) {
            this._docWasChanged();
        }

        return this;
    }

    insertImage( src, attributes ) {
        const img = this.createElement( 'IMG',
            mergeObjects( { src }, attributes, true ) );
        this.insertElement( img );
        return img;
    }

    // Insert HTML at the cursor location. If the selection is not collapsed
    // insertTreeFragmentIntoRange will delete the selection so that it is
    // replaced by the html being inserted.
    insertHTML( html, isPaste ) {
        const config = this._config;
        const sanitizeToDOMFragment = config.isInsertedHTMLSanitized ?
                config.sanitizeToDOMFragment : null;
        const range = this.getSelection();
        const doc = this._doc;

        // Edge doesn't just copy the fragment, but includes the surrounding guff
        // including the full <head> of the page. Need to strip this out. If
        // available use DOMPurify to parse and sanitise.
        let frag;
        if ( typeof sanitizeToDOMFragment === 'function' ) {
            frag = sanitizeToDOMFragment( html, isPaste, this );
        } else {
            if ( isPaste ) {
                const startFragIndex = html.indexOf( '<!--StartFragment-->' );
                const endFragIndex = html.lastIndexOf( '<!--EndFragment-->' );
                if ( startFragIndex > -1 && endFragIndex > -1 ) {
                    html = html.slice( startFragIndex + 20, endFragIndex );
                }
            }
            // Parse HTML into DOM tree
            const div = this.createElement( 'DIV' );
            div.innerHTML = html;
            frag = doc.createDocumentFragment();
            frag.appendChild( empty( div ) );
        }

        // Record undo checkpoint
        this.saveUndoState( range );

        try {
            const root = this._root;
            let node = frag;
            const event = {
                fragment: frag,
                preventDefault () {
                    this.defaultPrevented = true;
                },
                defaultPrevented: false
            };

            addLinks( frag, frag, this );
            cleanTree( frag );
            cleanupBRs( frag, root, false );
            removeEmptyInlines( frag );
            frag.normalize();

            while ( node = getNextBlock( node, frag ) ) {
                fixCursor( node, root );
            }

            if ( isPaste ) {
                this.fireEvent( 'willPaste', event );
            }

            if ( !event.defaultPrevented ) {
                insertTreeFragmentIntoRange( range, event.fragment, root );
                if ( !canObserveMutations ) {
                    this._docWasChanged();
                }
                range.collapse( false );
                this._ensureBottomLine();
            }

            this.setSelection( range );
            this._updatePath( range, true );
            // Safari sometimes loses focus after paste. Weird.
            if ( isPaste ) {
                this.focus();
            }
        } catch ( error ) {
            this.didError( error );
        }
        return this;
    }

    insertPlainText( plainText, isPaste ) {
        const lines = plainText.split( '\n' );
        const config = this._config;
        const tag = config.blockTag;
        const attributes = config.blockAttributes;
        const closeBlock  = '</' + tag + '>';
        let openBlock = '<' + tag;

        for ( const attr in attributes ) {
            openBlock += ' ' + attr + '="' +
                escapeHTMLFragment( attributes[ attr ] ) +
            '"';
        }
        openBlock += '>';

        for ( let i = 0, l = lines.length; i < l; i += 1 ) {
            let line = lines[i];
            line = escapeHTMLFragment( line ).replace( / (?= )/g, '&nbsp;' );
            // Wrap all but first/last lines in <div></div>
            if ( i && i + 1 < l ) {
                line = openBlock + ( line || '<BR>' ) + closeBlock;
            }
            lines[i] = line;
        }
        return this.insertHTML( lines.join( '' ), isPaste );
    }

    // --- Formatting ---

    addStyles( styles ) {
        if ( styles ) {
            const head = this._doc.documentElement.firstChild;
            const style = this.createElement( 'STYLE', {
                    type: 'text/css'
                });
            style.appendChild( this._doc.createTextNode( styles ) );
            head.appendChild( style );
        }
        return this;
    }

    bold() { return this.changeFormat({ tag: 'B' }).focus(); }
    italic() { return this.changeFormat({ tag: 'I' }).focus(); }
    underline() { return this.changeFormat({ tag: 'U' }).focus(); }
    strikethrough() { return this.changeFormat({ tag: 'S' }).focus(); }
    subscript() {
        return this.changeFormat( { tag: 'SUB' }, { tag: 'SUP' } ).focus();
    }
    superscript() {
        return this.changeFormat( { tag: 'SUP' }, { tag: 'SUB' } ).focus();
    }

    removeBold() { return this.changeFormat( null, { tag: 'B' } ).focus(); }
    removeItalic() { return this.changeFormat( null, { tag: 'I' } ).focus(); }
    removeUnderline() {
        return this.changeFormat( null, { tag: 'U' } ).focus();
    }
    removeStrikethrough() {
        return this.changeFormat( null, { tag: 'S' } ).focus();
    }
    removeSubscript() {
        return this.changeFormat( null, { tag: 'SUB' } ).focus();
    }
    removeSuperscript() {
        return this.changeFormat( null, { tag: 'SUP' } ).focus();
    }

    makeLink( url, attributes ) {
        const range = this.getSelection();
        if ( range.collapsed ) {
            let protocolEnd = url.indexOf( ':' ) + 1;
            if ( protocolEnd ) {
                while ( url[ protocolEnd ] === '/' ) { protocolEnd += 1; }
            }
            insertNodeInRange(
                range,
                this._doc.createTextNode( url.slice( protocolEnd ) )
            );
        }
        attributes = mergeObjects(
            mergeObjects({
                href: url
            }, attributes, true ),
            this._config.tagAttributes.a,
            false
        );

        this.changeFormat({
            tag: 'A',
            attributes: attributes
        }, {
            tag: 'A'
        }, range );
        return this.focus();
    }
    removeLink() {
        this.changeFormat( null, {
            tag: 'A'
        }, this.getSelection(), true );
        return this.focus();
    }

    setFontFace( name ) {
        this.changeFormat( name ? {
            tag: 'SPAN',
            attributes: {
                'class': FONT_FAMILY_CLASS,
                style: 'font-family: ' + name + ', sans-serif;'
            }
        } : null, {
            tag: 'SPAN',
            attributes: { 'class': FONT_FAMILY_CLASS }
        });
        return this.focus();
    }
    setFontSize( size ) {
        this.changeFormat( size ? {
            tag: 'SPAN',
            attributes: {
                'class': FONT_SIZE_CLASS,
                style: 'font-size: ' +
                    ( typeof size === 'number' ? size + 'px' : size )
            }
        } : null, {
            tag: 'SPAN',
            attributes: { 'class': FONT_SIZE_CLASS }
        });
        return this.focus();
    }

    setTextColour( colour ) {
        this.changeFormat( colour ? {
            tag: 'SPAN',
            attributes: {
                'class': COLOUR_CLASS,
                style: 'color:' + colour
            }
        } : null, {
            tag: 'SPAN',
            attributes: { 'class': COLOUR_CLASS }
        });
        return this.focus();
    }

    setHighlightColour( colour ) {
        this.changeFormat( colour ? {
            tag: 'SPAN',
            attributes: {
                'class': HIGHLIGHT_CLASS,
                style: 'background-color:' + colour
            }
        } : colour, {
            tag: 'SPAN',
            attributes: { 'class': HIGHLIGHT_CLASS }
        });
        return this.focus();
    }

    setTextAlignment( alignment ) {
        this.forEachBlock( block => {
            const className = block.className
                .split( /\s+/ )
                .filter( klass => !!klass && !/^align/.test( klass ) )
                .join( ' ' );
            if ( alignment ) {
                block.className = className + ' align-' + alignment;
                block.style.textAlign = alignment;
            } else {
                block.className = className;
                block.style.textAlign = '';
            }
        }, true );
        return this.focus();
    }

    setTextDirection( direction ) {
        this.forEachBlock( block => {
            if ( direction ) {
                block.dir = direction;
            } else {
                block.removeAttribute( 'dir' );
            }
        }, true );
        return this.focus();
    }

    removeAllFormatting( range ) {
        if ( !range && !( range = this.getSelection() ) || range.collapsed ) {
            return this;
        }

        const root = this._root;
        let stopNode = range.commonAncestorContainer;
        while ( stopNode && !isBlock( stopNode ) ) {
            stopNode = stopNode.parentNode;
        }
        if ( !stopNode ) {
            expandRangeToBlockBoundaries( range, root );
            stopNode = root;
        }
        if ( stopNode.nodeType === TEXT_NODE ) {
            return this;
        }

        // Record undo point
        this.saveUndoState( range );

        // Avoid splitting where we're already at edges.
        moveRangeBoundariesUpTree( range, stopNode, stopNode, root );

        // Split the selection up to the block, or if whole selection in same
        // block, expand range boundaries to ends of block and split up to root.
        const doc = stopNode.ownerDocument;
        let { startContainer, startOffset, endContainer, endOffset } = range;

        // Split end point first to avoid problems when end and start
        // in same container.
        const formattedNodes = doc.createDocumentFragment();
        const cleanNodes = doc.createDocumentFragment();
        const nodeAfterSplit = split( endContainer, endOffset, stopNode, root );
        let nodeInSplit = split( startContainer, startOffset, stopNode, root );

        // Then replace contents in split with a cleaned version of the same:
        // blocks become default blocks, text and leaf nodes survive, everything
        // else is obliterated.
        while ( nodeInSplit !== nodeAfterSplit ) {
            const nextNode = nodeInSplit.nextSibling;
            formattedNodes.appendChild( nodeInSplit );
            nodeInSplit = nextNode;
        }
        removeFormatting( this, formattedNodes, cleanNodes );
        cleanNodes.normalize();
        nodeInSplit = cleanNodes.firstChild;
        const nextNode = cleanNodes.lastChild;

        // Restore selection
        const childNodes = stopNode.childNodes;
        if ( nodeInSplit ) {
            stopNode.insertBefore( cleanNodes, nodeAfterSplit );
            startOffset = indexOf.call( childNodes, nodeInSplit );
            endOffset = indexOf.call( childNodes, nextNode ) + 1;
        } else {
            startOffset = indexOf.call( childNodes, nodeAfterSplit );
            endOffset = startOffset;
        }

        // Merge text nodes at edges, if possible
        range.setStart( stopNode, startOffset );
        range.setEnd( stopNode, endOffset );
        mergeInlines( stopNode, range );

        // And move back down the tree
        moveRangeBoundariesDownTree( range );

        this.setSelection( range );
        this._updatePath( range, true );

        return this.focus();
    }
}

// XXX(modulify): there are actual functional changes in here:
// Squire#increaseBlockQuoteLevel et al. now accept two optional parameters:
// range (default: all), and focus (default: true).
// Squire#increaseBlockQuoteLevel.modifier is also set to the modifier function.

function commandModifyBlocks ( modify ) {
    const out = function ( range, focus ) {
        this.modifyBlocks( modify, range );
        if ( typeof focus === 'undefined' || focus ) {
            this.focus();
        }
        return this;
    };
    out.modifier = modify;
    return out;
}

Object.assign( Squire.prototype, {

    increaseBlockQuoteLevel: commandModifyBlocks( function ( frag ) {
        return this.createElement( 'BLOCKQUOTE',
            this._config.tagAttributes.blockquote, [
                frag
            ]);
    }),

    decreaseBlockQuoteLevel: commandModifyBlocks( function ( frag ) {
        const root = this._root;
        const blockquotes = frag.querySelectorAll( 'blockquote' );
        Array.prototype.filter.call( blockquotes,
            el => !getNearest( el.parentNode, root, 'BLOCKQUOTE' )
        ).forEach( el => replaceWith( el, empty( el ) ) );
        return frag;
    }),

    makeUnorderedList: commandModifyBlocks( function ( frag ) {
        makeList( this, frag, 'UL' );
        return frag;
    }),

    makeOrderedList: commandModifyBlocks( function ( frag ) {
        makeList( this, frag, 'OL' );
        return frag;
    }),

    removeList: commandModifyBlocks( function ( frag ) {
        const lists = frag.querySelectorAll( 'UL, OL' );
        const items = frag.querySelectorAll( 'LI' );
        const root = this._root;
        for ( let i = 0, l = lists.length; i < l; i += 1 ) {
            const list = lists[i];
            const listFrag = empty( list );
            fixContainer( listFrag, root );
            replaceWith( list, listFrag );
        }

        for ( let i = 0, l = items.length; i < l; i += 1 ) {
            const item = items[i];
            if ( isBlock( item ) ) {
                replaceWith( item,
                    this.createDefaultBlock([ empty( item ) ])
                );
            } else {
                fixContainer( item, root );
                replaceWith( item, empty( item ) );
            }
        }
        return frag;
    }),

    increaseListLevel: commandModifyBlocks( function ( frag ) {
        const items = frag.querySelectorAll( 'LI' );
        const tagAttributes = this._config.tagAttributes;
        for ( let i = 0, l = items.length; i < l; i += 1 ) {
            const item = items[i];
            if ( !isContainer( item.firstChild ) ) {
                // type => 'UL' or 'OL'
                const type = item.parentNode.nodeName;
                let newParent = item.previousSibling;
                if ( !newParent || !( newParent = newParent.lastChild ) ||
                        newParent.nodeName !== type ) {
                    const listAttrs = tagAttributes[ type.toLowerCase() ];
                    newParent = this.createElement( type, listAttrs );

                    replaceWith(
                        item,
                        newParent
                    );
                }
                newParent.appendChild( item );
            }
        }
        return frag;
    }),

    decreaseListLevel: commandModifyBlocks( function ( frag ) {
        const root = this._root;
        const items = frag.querySelectorAll( 'LI' );
        Array.prototype.filter.call( items,
            el => !isContainer( el.firstChild )
        ).forEach( item => {
            let parent = item.parentNode;
            const newParent = parent.parentNode;
            const first = item.firstChild;
            if ( item.previousSibling ) {
                parent = split( parent, item, newParent, root );
            }

            // if the new parent is another list then we simply move the node
            // e.g. `ul > ul > li` becomes `ul > li`
            if ( /^[OU]L$/.test( newParent.nodeName ) ) {
                newParent.insertBefore( item, parent );
                if ( !parent.firstChild ) {
                    newParent.removeChild( parent );
                }
            } else {
                let node = first;
                while ( node ) {
                    const next = node.nextSibling;
                    if ( isContainer( node ) ) {
                        break;
                    }
                    newParent.insertBefore( node, parent );
                    node = next;
                }
            }
            if ( newParent.nodeName === 'LI' && first.previousSibling ) {
                split( newParent, first, newParent.parentNode, root );
            }
            while ( item !== frag && !item.childNodes.length ) {
                parent = item.parentNode;
                parent.removeChild( item );
                item = parent;
            }
        } );
        fixContainer( frag, root );
        return frag;
    }),
});
