import {
    isWin, isEdge, isIOS, isGecko, indexOf, TEXT_NODE,
} from "./Constants.js";
import { detach } from "./Node.js";
import {
    deleteContentsOfRange,
    moveRangeBoundariesDownTree, moveRangeBoundariesUpTree,
    getStartBlockOfRange, getEndBlockOfRange,
} from "./Range.js";
import { cleanupBRs } from "./Clean.js";

// The (non-standard but supported enough) innerText property is based on the
// render tree in Firefox and possibly other browsers, so we must insert the
// DOM node into the document to ensure the text part is correct.
function setClipboardData ( clipboardData, node, root ) {
    const body = node.ownerDocument.body;

    // Firefox will add an extra new line for BRs at the end of block when
    // calculating innerText, even though they don't actually affect display.
    // So we need to remove them first.
    cleanupBRs( node, root, true );

    node.setAttribute( 'style',
        'position:fixed;overflow:hidden;bottom:100%;right:100%;' );
    body.appendChild( node );
    const html = node.innerHTML;
    let text = node.innerText || node.textContent;

    // Firefox (and others?) returns unix line endings (\n) even on Windows.
    // If on Windows, normalise to \r\n, since Notepad and some other crappy
    // apps do not understand just \n.
    if ( isWin ) {
        text = text.replace( /\r?\n/g, '\r\n' );
    }

    clipboardData.setData( 'text/html', html );
    clipboardData.setData( 'text/plain', text );

    body.removeChild( node );
}

export function onCut ( event ) {
    const { clipboardData } = event;
    const range = this.getSelection();
    const root = this._root;
    const self = this;

    // Nothing to do
    if ( range.collapsed ) {
        event.preventDefault();
        return;
    }

    // Save undo checkpoint
    this.saveUndoState( range );

    // Edge only seems to support setting plain text as of 2016-03-11.
    // Mobile Safari flat out doesn't work:
    // https://bugs.webkit.org/show_bug.cgi?id=143776
    if ( !isEdge && !isIOS && clipboardData ) {
        // Clipboard content should include all parents within block, or all
        // parents up to root if selection across blocks
        const startBlock = getStartBlockOfRange( range, root );
        const endBlock = getEndBlockOfRange( range, root );
        const copyRoot = ( ( startBlock === endBlock ) && startBlock ) || root;
        // Extract the contents
        let contents = deleteContentsOfRange( range, root );
        // Add any other parents not in extracted content, up to copy root
        let parent = range.commonAncestorContainer;
        if ( parent.nodeType === TEXT_NODE ) {
            parent = parent.parentNode;
        }
        while ( parent && parent !== copyRoot ) {
            const newContents = parent.cloneNode( false );
            newContents.appendChild( contents );
            contents = newContents;
            parent = parent.parentNode;
        }
        // Set clipboard data
        const node = this.createElement( 'div' );
        node.appendChild( contents );
        setClipboardData( clipboardData, node, root );
        event.preventDefault();
    } else {
        setTimeout( () => {
            try {
                // If all content removed, ensure div at start of root.
                self._ensureBottomLine();
            } catch ( error ) {
                self.didError( error );
            }
        }, 0 );
    }

    this.setSelection( range );
}

export function onCopy ( event ) {
    const { clipboardData } = event;
    let range = this.getSelection();
    const root = this._root;

    // Edge only seems to support setting plain text as of 2016-03-11.
    // Mobile Safari flat out doesn't work:
    // https://bugs.webkit.org/show_bug.cgi?id=143776
    if ( !isEdge && !isIOS && clipboardData ) {
        // Clipboard content should include all parents within block, or all
        // parents up to root if selection across blocks
        const startBlock = getStartBlockOfRange( range, root );
        const endBlock = getEndBlockOfRange( range, root );
        const copyRoot = ( ( startBlock === endBlock ) && startBlock ) || root;
        // Clone range to mutate, then move up as high as possible without
        // passing the copy root node.
        range = range.cloneRange();
        moveRangeBoundariesDownTree( range );
        moveRangeBoundariesUpTree( range, copyRoot, copyRoot, root );
        // Extract the contents
        let contents = range.cloneContents();
        // Add any other parents not in extracted content, up to copy root
        let parent = range.commonAncestorContainer;
        if ( parent.nodeType === TEXT_NODE ) {
            parent = parent.parentNode;
        }
        while ( parent && parent !== copyRoot ) {
            const newContents = parent.cloneNode( false );
            newContents.appendChild( contents );
            contents = newContents;
            parent = parent.parentNode;
        }
        // Set clipboard data
        const node = this.createElement( 'div' );
        node.appendChild( contents );
        setClipboardData( clipboardData, node, root );
        event.preventDefault();
    }
}

// Need to monitor for shift key like this, as event.shiftKey is not available
// in paste event.
export function monitorShiftKey ( event ) {
    this.isShiftDown = event.shiftKey;
}

export function onPaste ( event ) {
    const { clipboardData } = event;
    const items = clipboardData && clipboardData.items;
    const choosePlain = this.isShiftDown;
    let self = this;

    // Current HTML5 Clipboard interface
    // ---------------------------------
    // https://html.spec.whatwg.org/multipage/interaction.html

    // Edge only provides access to plain text as of 2016-03-11.
    if ( !isEdge && items ) {
        let hasImage = false;
        let plainItem = null;
        event.preventDefault();
        let l = items.length;
        while ( l-- ) {
            const item = items[l];
            const type = item.type;
            if ( !choosePlain && type === 'text/html' ) {
                /*jshint loopfunc: true */
                item.getAsString( html => self.insertHTML( html, true ) );
                /*jshint loopfunc: false */
                return;
            }
            if ( type === 'text/plain' ) {
                plainItem = item;
            }
            if ( !choosePlain && /^image\/.*/.test( type ) ) {
                hasImage = true;
            }
        }
        // Treat image paste as a drop of an image file.
        if ( hasImage ) {
            let fireDrop = false;
            this.fireEvent( 'dragover', {
                dataTransfer: clipboardData,
                /*jshint loopfunc: true */
                preventDefault: () => { fireDrop = true; }
                /*jshint loopfunc: false */
            });
            if ( fireDrop ) {
                this.fireEvent( 'drop', {
                    dataTransfer: clipboardData
                });
            }
        } else if ( plainItem ) {
            plainItem.getAsString( text => self.insertPlainText( text, true ) );
        }
        return;
    }

    // Old interface
    // -------------

    // Safari (and indeed many other OS X apps) copies stuff as text/rtf
    // rather than text/html; even from a webpage in Safari. The only way
    // to get an HTML version is to fallback to letting the browser insert
    // the content. Same for getting image data. *Sigh*.
    //
    // Firefox is even worse: it doesn't even let you know that there might be
    // an RTF version on the clipboard, but it will also convert to HTML if you
    // let the browser insert the content. I've filed
    // https://bugzilla.mozilla.org/show_bug.cgi?id=1254028
    const types = clipboardData && clipboardData.types;
    if ( !isEdge && types && (
            indexOf.call( types, 'text/html' ) > -1 || (
                !isGecko &&
                indexOf.call( types, 'text/plain' ) > -1 &&
                indexOf.call( types, 'text/rtf' ) < 0 )
            )) {
        event.preventDefault();
        // Abiword on Linux copies a plain text and html version, but the HTML
        // version is the empty string! So always try to get HTML, but if none,
        // insert plain text instead. On iOS, Facebook (and possibly other
        // apps?) copy links as type text/uri-list, but also insert a **blank**
        // text/plain item onto the clipboard. Why? Who knows.
        let data = clipboardData.getData( 'text/html' );
        if ( !choosePlain && data ) {
            this.insertHTML( data, true );
        } else if (
                ( data = clipboardData.getData( 'text/plain' ) ) ||
                ( data = clipboardData.getData( 'text/uri-list' ) ) ) {
            this.insertPlainText( data, true );
        }
        return;
    }

    // No interface. Includes all versions of IE :(
    // --------------------------------------------

    this._awaitingPaste = true;

    const body = this._doc.body;
    const range = this.getSelection();
    const { startContainer, startOffset, endContainer, endOffset } = range;

    // We need to position the pasteArea in the visible portion of the screen
    // to stop the browser auto-scrolling.
    let pasteArea = this.createElement( 'DIV', {
        contenteditable: 'true',
        style: 'position:fixed; overflow:hidden; top:0; right:100%; width:1px; height:1px;'
    });
    body.appendChild( pasteArea );
    range.selectNodeContents( pasteArea );
    this.setSelection( range );

    // A setTimeout of 0 means this is added to the back of the
    // single javascript thread, so it will be executed after the
    // paste event.
    setTimeout( () => {
        try {
            // IE sometimes fires the beforepaste event twice; make sure it is
            // not run again before our after paste function is called.
            self._awaitingPaste = false;

            // Get the pasted content and clean
            let html = '';
            let next = pasteArea;

            // #88: Chrome can apparently split the paste area if certain
            // content is inserted; gather them all up.
            while ( pasteArea = next ) {
                next = pasteArea.nextSibling;
                detach( pasteArea );
                // Safari and IE like putting extra divs around things.
                const first = pasteArea.firstChild;
                if ( first && first === pasteArea.lastChild &&
                        first.nodeName === 'DIV' ) {
                    pasteArea = first;
                }
                html += pasteArea.innerHTML;
            }

            self.setSelection( self._createRange(
                startContainer, startOffset, endContainer, endOffset ) );

            if ( html ) {
                self.insertHTML( html, true );
            }
        } catch ( error ) {
            self.didError( error );
        }
    }, 0 );
}

// On Windows you can drag an drop text. We can't handle this ourselves, because
// as far as I can see, there's no way to get the drop insertion point. So just
// save an undo state and hope for the best.
export function onDrop ( event ) {
    const types = event.dataTransfer.types;
    let l = types.length;
    let hasPlain = false;
    let hasHTML = false;
    while ( l-- ) {
        switch ( types[l] ) {
        case 'text/plain':
            hasPlain = true;
            break;
        case 'text/html':
            hasHTML = true;
            break;
        default:
            return;
        }
    }
    if ( hasHTML || hasPlain ) {
        this.saveUndoState();
    }
}
