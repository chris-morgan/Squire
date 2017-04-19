var Squire = (function () {
'use strict';

var DOCUMENT_POSITION_PRECEDING = 2; // Node.DOCUMENT_POSITION_PRECEDING
var ELEMENT_NODE = 1;                // Node.ELEMENT_NODE;
var TEXT_NODE = 3;                   // Node.TEXT_NODE;
var DOCUMENT_NODE = 9;               // Node.DOCUMENT_NODE;
var DOCUMENT_FRAGMENT_NODE = 11;     // Node.DOCUMENT_FRAGMENT_NODE;
var SHOW_ELEMENT = 1;                // NodeFilter.SHOW_ELEMENT;
var SHOW_TEXT = 4;                   // NodeFilter.SHOW_TEXT;

var START_TO_START = 0; // Range.START_TO_START
var START_TO_END = 1;   // Range.START_TO_END
var END_TO_END = 2;     // Range.END_TO_END
var END_TO_START = 3;   // Range.END_TO_START

var HIGHLIGHT_CLASS = 'highlight';
var COLOUR_CLASS = 'colour';
var FONT_FAMILY_CLASS = 'font';
var FONT_SIZE_CLASS = 'size';

var ZWS = '\u200B';

var win = document.defaultView;

var ua = navigator.userAgent;

var isAndroid = /Android/.test( ua );
var isIOS = /iP(?:ad|hone|od)/.test( ua );
var isMac = /Mac OS X/.test( ua );
var isWin = /Windows NT/.test( ua );

var isGecko = /Gecko\//.test( ua );
var isIElt11 = /Trident\/[456]\./.test( ua );
var isPresto = !!win.opera;
var isEdge = /Edge\//.test( ua );
var isWebKit = !isEdge && /WebKit\//.test( ua );
var isIE = /Trident\/[4567]\./.test( ua );

var ctrlKey = isMac ? 'meta-' : 'ctrl-';

var useTextFixer = isIElt11 || isPresto;
var cantFocusEmptyTextNodes = isIElt11 || isWebKit;
var losesSelectionOnBlur = isIElt11;

var canObserveMutations = typeof MutationObserver !== 'undefined';
var canWeakMap = typeof WeakMap !== 'undefined';

// Use [^ \t\r\n] instead of \S so that nbsp does not count as white-space
var notWS = /[^ \t\r\n]/;

var indexOf = Array.prototype.indexOf;

// Polyfill for FF3.5
if ( !Object.create ) {
    Object.create = function ( proto ) {
        var F = function () {};
        F.prototype = proto;
        return new F();
    };
}

/*
    Native TreeWalker is buggy in IE and Opera:
    * IE9/10 sometimes throw errors when calling TreeWalker#nextNode or
      TreeWalker#previousNode. No way to feature detect this.
    * Some versions of Opera have a bug in TreeWalker#previousNode which makes
      it skip to the wrong node.

    Rather than risk further bugs, it's easiest just to implement our own
    (subset) of the spec in all browsers.
*/

var typeToBitArray = {
    // ELEMENT_NODE
    1: 1,
    // ATTRIBUTE_NODE
    2: 2,
    // TEXT_NODE
    3: 4,
    // COMMENT_NODE
    8: 128,
    // DOCUMENT_NODE
    9: 256,
    // DOCUMENT_FRAGMENT_NODE
    11: 1024,
};

var TreeWalker = function TreeWalker( root, nodeType, filter ) {
    this.root = this.currentNode = root;
    this.nodeType = nodeType;
    this.filter = filter;
};

TreeWalker.prototype.nextNode = function nextNode () {
        var this$1 = this;

    var ref = this;
        var currentNode = ref.currentNode;
    var ref$1 = this;
        var root = ref$1.root;
        var nodeType = ref$1.nodeType;
        var filter = ref$1.filter;
    while ( true ) {
        var node = currentNode.firstChild;
        while ( !node && currentNode ) {
            if ( currentNode === root ) {
                break;
            }
            node = currentNode.nextSibling;
            if ( !node ) { currentNode = currentNode.parentNode; }
        }
        if ( !node ) {
            return null;
        }
        if ( ( typeToBitArray[ node.nodeType ] & nodeType ) &&
                filter( node ) ) {
            this$1.currentNode = node;
            return node;
        }
        currentNode = node;
    }
};

TreeWalker.prototype.previousNode = function previousNode () {
        var this$1 = this;

    var ref = this;
        var currentNode = ref.currentNode;
    var ref$1 = this;
        var root = ref$1.root;
        var nodeType = ref$1.nodeType;
        var filter = ref$1.filter;
    while ( true ) {
        if ( currentNode === root ) {
            return null;
        }
        var node = currentNode.previousSibling;
        if ( node ) {
            while ( currentNode = node.lastChild ) {
                node = currentNode;
            }
        } else {
            node = currentNode.parentNode;
        }
        if ( !node ) {
            return null;
        }
        if ( ( typeToBitArray[ node.nodeType ] & nodeType ) &&
                filter( node ) ) {
            this$1.currentNode = node;
            return node;
        }
        currentNode = node;
    }
};

// Previous node in post-order.
TreeWalker.prototype.previousPONode = function previousPONode () {
        var this$1 = this;

    var ref = this;
        var currentNode = ref.currentNode;
    var ref$1 = this;
        var root = ref$1.root;
        var nodeType = ref$1.nodeType;
        var filter = ref$1.filter;
    while ( true ) {
        var node = currentNode.lastChild;
        while ( !node && currentNode ) {
            if ( currentNode === root ) {
                break;
            }
            node = currentNode.previousSibling;
            if ( !node ) { currentNode = currentNode.parentNode; }
        }
        if ( !node ) {
            return null;
        }
        if ( ( typeToBitArray[ node.nodeType ] & nodeType ) &&
                filter( node ) ) {
            this$1.currentNode = node;
            return node;
        }
        currentNode = node;
    }
};

var inlineNodeNames  = /^(?:#text|A(?:BBR|CRONYM)?|B(?:R|D[IO])?|C(?:ITE|ODE)|D(?:ATA|EL|FN)|EM|FONT|HR|I(?:FRAME|MG|NPUT|NS)?|KBD|Q|R(?:P|T|UBY)|S(?:AMP|MALL|PAN|TR(?:IKE|ONG)|U[BP])?|TIME|U|VAR|WBR)$/;

var leafNodeNames = {
    BR: 1,
    HR: 1,
    IFRAME: 1,
    IMG: 1,
    INPUT: 1
};

function every ( nodeList, fn ) {
    var l = nodeList.length;
    while ( l-- ) {
        if ( !fn( nodeList[l] ) ) {
            return false;
        }
    }
    return true;
}

// ---

var UNKNOWN = 0;
var INLINE = 1;
var BLOCK = 2;
var CONTAINER = 3;

var nodeCategoryCache;

function clearNodeCategoryCache() {
    nodeCategoryCache = canWeakMap ? new WeakMap() : null;
}

clearNodeCategoryCache();

function isLeaf ( node ) {
    return node.nodeType === ELEMENT_NODE && !!leafNodeNames[ node.nodeName ];
}
function getNodeCategory ( node ) {
    switch ( node.nodeType ) {
    case TEXT_NODE:
        return INLINE;
    case ELEMENT_NODE:
    case DOCUMENT_FRAGMENT_NODE:
        if ( canWeakMap && nodeCategoryCache.has( node ) ) {
            return nodeCategoryCache.get( node );
        }
        break;
    default:
        return UNKNOWN;
    }

    var nodeCategory;
    if ( !every( node.childNodes, isInline ) ) {
        // Malformed HTML can have block tags inside inline tags. Need to treat
        // these as containers rather than inline. See #239.
        nodeCategory = CONTAINER;
    } else if ( inlineNodeNames.test( node.nodeName ) ) {
        nodeCategory = INLINE;
    } else {
        nodeCategory = BLOCK;
    }
    if ( canWeakMap ) {
        nodeCategoryCache.set( node, nodeCategory );
    }
    return nodeCategory;
}
function isInline ( node ) {
    return getNodeCategory( node ) === INLINE;
}
function isBlock ( node ) {
    return getNodeCategory( node ) === BLOCK;
}
function isContainer ( node ) {
    return getNodeCategory( node ) === CONTAINER;
}

function getBlockWalker ( node, root ) {
    var walker = new TreeWalker( root, SHOW_ELEMENT, isBlock );
    walker.currentNode = node;
    return walker;
}
function getPreviousBlock ( node, root ) {
    node = getBlockWalker( node, root ).previousNode();
    return node !== root ? node : null;
}
function getNextBlock ( node, root ) {
    node = getBlockWalker( node, root ).nextNode();
    return node !== root ? node : null;
}

function areAlike ( node, node2 ) {
    return !isLeaf( node ) && (
        node.nodeType === node2.nodeType &&
        node.nodeName === node2.nodeName &&
        node.nodeName !== 'A' &&
        node.className === node2.className &&
        ( ( !node.style && !node2.style ) ||
          node.style.cssText === node2.style.cssText )
    );
}
function hasTagAttributes ( node, tag, attributes ) {
    if ( node.nodeName !== tag ) {
        return false;
    }
    for ( var attr in attributes ) {
        if ( node.getAttribute( attr ) !== attributes[ attr ] ) {
            return false;
        }
    }
    return true;
}
function getNearest ( node, root, tag, attributes ) {
    while ( node && node !== root ) {
        if ( hasTagAttributes( node, tag, attributes ) ) {
            return node;
        }
        node = node.parentNode;
    }
    return null;
}
function isOrContains ( parent, node ) {
    while ( node ) {
        if ( node === parent ) {
            return true;
        }
        node = node.parentNode;
    }
    return false;
}

function getPath ( node, root ) {
    var path = '';
    if ( node && node !== root ) {
        path = getPath( node.parentNode, root );
        if ( node.nodeType === ELEMENT_NODE ) {
            path += ( path ? '>' : '' ) + node.nodeName;
            var id = node.id;
            if ( id ) {
                path += '#' + id;
            }
            var classNames;
            var className = node.className.trim();
            if ( className ) {
                classNames = className.split( /\s\s*/ );
                classNames.sort();
                path += '.';
                path += classNames.join( '.' );
            }
            var dir = node.dir;
            if ( dir ) {
                path += '[dir=' + dir + ']';
            }
            if ( classNames ) {
                if ( classNames.indexOf( HIGHLIGHT_CLASS ) > -1 ) {
                    path += '[backgroundColor=' +
                        node.style.backgroundColor.replace( / /g,'' ) + ']';
                }
                if ( classNames.indexOf( COLOUR_CLASS ) > -1 ) {
                    path += '[color=' +
                        node.style.color.replace( / /g,'' ) + ']';
                }
                if ( classNames.indexOf( FONT_FAMILY_CLASS ) > -1 ) {
                    path += '[fontFamily=' +
                        node.style.fontFamily.replace( / /g,'' ) + ']';
                }
                if ( classNames.indexOf( FONT_SIZE_CLASS ) > -1 ) {
                    path += '[fontSize=' + node.style.fontSize + ']';
                }
            }
        }
    }
    return path;
}

function getLength ( node ) {
    return node.nodeType === ELEMENT_NODE ?
        node.childNodes.length : node.length || 0;
}

function detach ( node ) {
    var parent = node.parentNode;
    if ( parent ) {
        parent.removeChild( node );
    }
    return node;
}
function replaceWith ( node, node2 ) {
    var parent = node.parentNode;
    if ( parent ) {
        parent.replaceChild( node2, node );
    }
}
function empty ( node ) {
    var frag = node.ownerDocument.createDocumentFragment();
    var childNodes = node.childNodes;
    var l = childNodes ? childNodes.length : 0;
    while ( l-- ) {
        frag.appendChild( node.firstChild );
    }
    return frag;
}

function createElement ( doc, tag, props, children ) {
    var el = doc.createElement( tag );
    if ( props instanceof Array ) {
        children = props;
        props = null;
    }
    if ( props ) {
        for ( var attr in props ) {
            var value = props[ attr ];
            if ( value !== undefined ) {
                el.setAttribute( attr, props[ attr ] );
            }
        }
    }
    if ( children ) {
        for ( var i = 0, l = children.length; i < l; i += 1 ) {
            el.appendChild( children[i] );
        }
    }
    return el;
}

function fixCursor ( node, root ) {
    // In Webkit and Gecko, block level elements are collapsed and
    // unfocussable if they have no content. To remedy this, a <BR> must be
    // inserted. In Opera and IE, we just need a textnode in order for the
    // cursor to appear.
    var self = root.__squire__;
    var doc = node.ownerDocument;
    var originalNode = node;
    var fixer, child;

    if ( node === root ) {
        if ( !( child = node.firstChild ) || child.nodeName === 'BR' ) {
            fixer = self.createDefaultBlock();
            if ( child ) {
                node.replaceChild( fixer, child );
            }
            else {
                node.appendChild( fixer );
            }
            node = fixer;
            fixer = null;
        }
    }

    if ( node.nodeType === TEXT_NODE ) {
        return originalNode;
    }

    if ( isInline( node ) ) {
        child = node.firstChild;
        while ( cantFocusEmptyTextNodes && child &&
                child.nodeType === TEXT_NODE && !child.data ) {
            node.removeChild( child );
            child = node.firstChild;
        }
        if ( !child ) {
            if ( cantFocusEmptyTextNodes ) {
                fixer = doc.createTextNode( ZWS );
                self._didAddZWS();
            } else {
                fixer = doc.createTextNode( '' );
            }
        }
    } else {
        if ( useTextFixer ) {
            while ( node.nodeType !== TEXT_NODE && !isLeaf( node ) ) {
                child = node.firstChild;
                if ( !child ) {
                    fixer = doc.createTextNode( '' );
                    break;
                }
                node = child;
            }
            if ( node.nodeType === TEXT_NODE ) {
                // Opera will collapse the block element if it contains
                // just spaces (but not if it contains no data at all).
                if ( /^ +$/.test( node.data ) ) {
                    node.data = '';
                }
            } else if ( isLeaf( node ) ) {
                node.parentNode.insertBefore( doc.createTextNode( '' ), node );
            }
        }
        else if ( !node.querySelector( 'BR' ) ) {
            fixer = createElement( doc, 'BR' );
            while ( ( child = node.lastElementChild ) && !isInline( child ) ) {
                node = child;
            }
        }
    }
    if ( fixer ) {
        try {
            node.appendChild( fixer );
        } catch ( error ) {
            self.didError({
                name: 'Squire: fixCursor – ' + error,
                message: 'Parent: ' + node.nodeName + '/' + node.innerHTML +
                    ' appendChild: ' + fixer.nodeName
            });
        }
    }

    return originalNode;
}

// Recursively examine container nodes and wrap any inline children.
function fixContainer ( container, root ) {
    var children = container.childNodes;
    var doc = container.ownerDocument;
    var wrapper = null;
    var config = root.__squire__._config;

    for ( var i = 0, l = children.length; i < l; i += 1 ) {
        var child = children[i];
        var isBR = child.nodeName === 'BR';
        if ( !isBR && isInline( child ) ) {
            if ( !wrapper ) {
                 wrapper = createElement( doc,
                    config.blockTag, config.blockAttributes );
            }
            wrapper.appendChild( child );
            i -= 1;
            l -= 1;
        } else if ( isBR || wrapper ) {
            if ( !wrapper ) {
                wrapper = createElement( doc,
                    config.blockTag, config.blockAttributes );
            }
            fixCursor( wrapper, root );
            if ( isBR ) {
                container.replaceChild( wrapper, child );
            } else {
                container.insertBefore( wrapper, child );
                i += 1;
                l += 1;
            }
            wrapper = null;
        }
        if ( isContainer( child ) ) {
            fixContainer( child, root );
        }
    }
    if ( wrapper ) {
        container.appendChild( fixCursor( wrapper, root ) );
    }
    return container;
}

function split ( node, offset, stopNode, root ) {
    var nodeType = node.nodeType;
    if ( nodeType === TEXT_NODE && node !== stopNode ) {
        return split(
            node.parentNode, node.splitText( offset ), stopNode, root );
    }
    if ( nodeType === ELEMENT_NODE ) {
        if ( typeof( offset ) === 'number' ) {
            offset = offset < node.childNodes.length ?
                node.childNodes[ offset ] : null;
        }
        if ( node === stopNode ) {
            return offset;
        }

        // Clone node without children
        var parent = node.parentNode;
        var clone = node.cloneNode( false );
        var next;

        // Add right-hand siblings to the clone
        while ( offset ) {
            next = offset.nextSibling;
            clone.appendChild( offset );
            offset = next;
        }

        // Maintain li numbering if inside a quote.
        if ( node.nodeName === 'OL' &&
                getNearest( node, root, 'BLOCKQUOTE' ) ) {
            clone.start = ( +node.start || 1 ) + node.childNodes.length - 1;
        }

        // DO NOT NORMALISE. This may undo the fixCursor() call
        // of a node lower down the tree!

        // We need something in the element in order for the cursor to appear.
        fixCursor( node, root );
        fixCursor( clone, root );

        // Inject clone after original node
        if ( next = node.nextSibling ) {
            parent.insertBefore( clone, next );
        } else {
            parent.appendChild( clone );
        }

        // Keep on splitting up the tree
        return split( parent, clone, stopNode, root );
    }
    return offset;
}

function _mergeInlines ( node, fakeRange ) {
    var children = node.childNodes;
    var l = children.length;
    var frags = [];
    while ( l-- ) {
        var child = children[l];
        var prev = l && children[ l - 1 ];
        if ( l && isInline( child ) && areAlike( child, prev ) &&
                !leafNodeNames[ child.nodeName ] ) {
            if ( fakeRange.startContainer === child ) {
                fakeRange.startContainer = prev;
                fakeRange.startOffset += getLength( prev );
            }
            if ( fakeRange.endContainer === child ) {
                fakeRange.endContainer = prev;
                fakeRange.endOffset += getLength( prev );
            }
            if ( fakeRange.startContainer === node ) {
                if ( fakeRange.startOffset > l ) {
                    fakeRange.startOffset -= 1;
                }
                else if ( fakeRange.startOffset === l ) {
                    fakeRange.startContainer = prev;
                    fakeRange.startOffset = getLength( prev );
                }
            }
            if ( fakeRange.endContainer === node ) {
                if ( fakeRange.endOffset > l ) {
                    fakeRange.endOffset -= 1;
                }
                else if ( fakeRange.endOffset === l ) {
                    fakeRange.endContainer = prev;
                    fakeRange.endOffset = getLength( prev );
                }
            }
            detach( child );
            if ( child.nodeType === TEXT_NODE ) {
                prev.appendData( child.data );
            }
            else {
                frags.push( empty( child ) );
            }
        }
        else if ( child.nodeType === ELEMENT_NODE ) {
            var len = frags.length;
            while ( len-- ) {
                child.appendChild( frags.pop() );
            }
            _mergeInlines( child, fakeRange );
        }
    }
}

function mergeInlines ( node, range ) {
    if ( node.nodeType === TEXT_NODE ) {
        node = node.parentNode;
    }
    if ( node.nodeType === ELEMENT_NODE ) {
        var startContainer = range.startContainer;
        var startOffset = range.startOffset;
        var endContainer = range.endContainer;
        var endOffset = range.endOffset;
        _mergeInlines( node, { startContainer: startContainer, startOffset: startOffset,
                               endContainer: endContainer, endOffset: endOffset } );
        range.setStart( startContainer, startOffset );
        range.setEnd( endContainer, endOffset );
    }
}

function mergeWithBlock ( block, next, range ) {
    var container = next;
    while ( container.parentNode.childNodes.length === 1 ) {
        container = container.parentNode;
    }
    detach( container );

    var offset = block.childNodes.length;

    // Remove extra <BR> fixer if present.
    var last = block.lastChild;
    if ( last && last.nodeName === 'BR' ) {
        block.removeChild( last );
        offset -= 1;
    }

    block.appendChild( empty( next ) );

    range.setStart( block, offset );
    range.collapse( true );
    mergeInlines( block, range );

    // Opera inserts a BR if you delete the last piece of text
    // in a block-level element. Unfortunately, it then gets
    // confused when setting the selection subsequently and
    // refuses to accept the range that finishes just before the
    // BR. Removing the BR fixes the bug.
    // Steps to reproduce bug: Type "a-b-c" (where - is return)
    // then backspace twice. The cursor goes to the top instead
    // of after "b".
    if ( isPresto && ( last = block.lastChild ) && last.nodeName === 'BR' ) {
        block.removeChild( last );
    }
}

function mergeContainers ( node, root ) {
    var prev = node.previousSibling;
    var first = node.firstChild;
    var doc = node.ownerDocument;
    var isListItem = ( node.nodeName === 'LI' );

    // Do not merge LIs, unless it only contains a UL
    if ( isListItem && ( !first || !/^[OU]L$/.test( first.nodeName ) ) ) {
        return;
    }

    if ( prev && areAlike( prev, node ) ) {
        if ( !isContainer( prev ) ) {
            if ( isListItem ) {
                var block = createElement( doc, 'DIV' );
                block.appendChild( empty( prev ) );
                prev.appendChild( block );
            } else {
                return;
            }
        }
        detach( node );
        var needsFix = !isContainer( node );
        prev.appendChild( empty( node ) );
        if ( needsFix ) {
            fixContainer( prev, root );
        }
        if ( first ) {
            mergeContainers( first, root );
        }
    } else if ( isListItem ) {
        prev = createElement( doc, 'DIV' );
        node.insertBefore( prev, first );
        fixCursor( prev, root );
    }
}

function getNodeBefore ( node, offset ) {
    var children = node.childNodes;
    while ( offset && node.nodeType === ELEMENT_NODE ) {
        node = children[ offset - 1 ];
        children = node.childNodes;
        offset = children.length;
    }
    return node;
}

function getNodeAfter ( node, offset ) {
    if ( node.nodeType === ELEMENT_NODE ) {
        var children = node.childNodes;
        if ( offset < children.length ) {
            node = children[ offset ];
        } else {
            while ( node && !node.nextSibling ) {
                node = node.parentNode;
            }
            if ( node ) { node = node.nextSibling; }
        }
    }
    return node;
}

// ---

function insertNodeInRange ( range, node ) {
    // Insert at start.
    var startContainer = range.startContainer;
    var startOffset = range.startOffset;
    var endContainer = range.endContainer;
    var endOffset = range.endOffset;
    var children;

    // If part way through a text node, split it.
    if ( startContainer.nodeType === TEXT_NODE ) {
        var parent = startContainer.parentNode;
        children = parent.childNodes;
        if ( startOffset === startContainer.length ) {
            startOffset = indexOf.call( children, startContainer ) + 1;
            if ( range.collapsed ) {
                endContainer = parent;
                endOffset = startOffset;
            }
        } else {
            if ( startOffset ) {
                var afterSplit = startContainer.splitText( startOffset );
                if ( endContainer === startContainer ) {
                    endOffset -= startOffset;
                    endContainer = afterSplit;
                }
                else if ( endContainer === parent ) {
                    endOffset += 1;
                }
                startContainer = afterSplit;
            }
            startOffset = indexOf.call( children, startContainer );
        }
        startContainer = parent;
    } else {
        children = startContainer.childNodes;
    }

    var childCount = children.length;

    if ( startOffset === childCount ) {
        startContainer.appendChild( node );
    } else {
        startContainer.insertBefore( node, children[ startOffset ] );
    }

    if ( startContainer === endContainer ) {
        endOffset += children.length - childCount;
    }

    range.setStart( startContainer, startOffset );
    range.setEnd( endContainer, endOffset );
}

function extractContentsOfRange ( range, common, root ) {
    var startContainer = range.startContainer;
    var startOffset = range.startOffset;
    var endContainer = range.endContainer;
    var endOffset = range.endOffset;

    if ( !common ) {
        common = range.commonAncestorContainer;
    }

    if ( common.nodeType === TEXT_NODE ) {
        common = common.parentNode;
    }

    var endNode = split( endContainer, endOffset, common, root );
    var startNode = split( startContainer, startOffset, common, root );
    var frag = common.ownerDocument.createDocumentFragment();

    // End node will be null if at end of child nodes list.
    while ( startNode !== endNode ) {
        var next = startNode.nextSibling;
        frag.appendChild( startNode );
        startNode = next;
    }

    startContainer = common;
    startOffset = endNode ?
        indexOf.call( common.childNodes, endNode ) :
        common.childNodes.length;

    // Merge text nodes if adjacent. IE10 in particular will not focus
    // between two text nodes
    var after = common.childNodes[ startOffset ];
    var before = after && after.previousSibling;
    if ( before &&
            before.nodeType === TEXT_NODE &&
            after.nodeType === TEXT_NODE ) {
        startContainer = before;
        startOffset = before.length;
        before.appendData( after.data );
        detach( after );
    }

    range.setStart( startContainer, startOffset );
    range.collapse( true );

    fixCursor( common, root );

    return frag;
}

function deleteContentsOfRange ( range, root ) {
    var startBlock = getStartBlockOfRange( range, root );
    var endBlock = getEndBlockOfRange( range, root );
    var needsMerge = ( startBlock !== endBlock );

    // Move boundaries up as much as possible without exiting block,
    // to reduce need to split.
    moveRangeBoundariesDownTree( range );
    moveRangeBoundariesUpTree( range, startBlock, endBlock, root );

    // Remove selected range
    var frag = extractContentsOfRange( range, null, root );

    // Move boundaries back down tree as far as possible.
    moveRangeBoundariesDownTree( range );

    // If we split into two different blocks, merge the blocks.
    if ( needsMerge ) {
        // endBlock will have been split, so need to refetch
        endBlock = getEndBlockOfRange( range, root );
        if ( startBlock && endBlock && startBlock !== endBlock ) {
            mergeWithBlock( startBlock, endBlock, range );
        }
    }

    // Ensure block has necessary children
    if ( startBlock ) {
        fixCursor( startBlock, root );
    }

    // Ensure root has a block-level element in it.
    var child = root.firstChild;
    if ( !child || child.nodeName === 'BR' ) {
        fixCursor( root, root );
        range.selectNodeContents( root.firstChild );
    } else {
        range.collapse( true );
    }
    return frag;
}

// ---

function insertTreeFragmentIntoRange ( range, frag, root ) {
    // Check if it's all inline content
    var allInline = true;
    var children = frag.childNodes;
    var l = children.length;
    while ( l-- ) {
        if ( !isInline( children[l] ) ) {
            allInline = false;
            break;
        }
    }

    // Delete any selected content
    if ( !range.collapsed ) {
        deleteContentsOfRange( range, root );
    }

    // Move range down into text nodes
    moveRangeBoundariesDownTree( range );

    if ( allInline ) {
        // If inline, just insert at the current position.
        insertNodeInRange( range, frag );
        if ( range.startContainer !== range.endContainer ) {
            mergeInlines( range.endContainer, range );
        }
        mergeInlines( range.startContainer, range );
        range.collapse( false );
    } else {
        // Otherwise...
        // 1. Split up to blockquote (if a parent) or root
        var splitPoint = range.startContainer;
        var nodeAfterSplit = split(
                splitPoint,
                range.startOffset,
                getNearest( splitPoint.parentNode, root, 'BLOCKQUOTE' ) || root,
                root
            );
        var nodeBeforeSplit = nodeAfterSplit.previousSibling;
        var startContainer = nodeBeforeSplit;
        var startOffset = startContainer.childNodes.length;
        var endContainer = nodeAfterSplit;
        var endOffset = 0;
        var parent = nodeAfterSplit.parentNode;
        var child;

        // 2. Move down into edge either side of split and insert any inline
        // nodes at the beginning/end of the fragment
        while ( ( child = startContainer.lastChild ) &&
                child.nodeType === ELEMENT_NODE ) {
            if ( child.nodeName === 'BR' ) {
                startOffset -= 1;
                break;
            }
            startContainer = child;
            startOffset = startContainer.childNodes.length;
        }
        while ( ( child = endContainer.firstChild ) &&
                child.nodeType === ELEMENT_NODE &&
                child.nodeName !== 'BR' ) {
            endContainer = child;
        }
        var startAnchor = startContainer.childNodes[ startOffset ] || null;
        while ( ( child = frag.firstChild ) && isInline( child ) ) {
            startContainer.insertBefore( child, startAnchor );
        }
        while ( ( child = frag.lastChild ) && isInline( child ) ) {
            endContainer.insertBefore( child, endContainer.firstChild );
            endOffset += 1;
        }

        // 3. Fix cursor then insert block(s) in the fragment
        var node = frag;
        while ( node = getNextBlock( node, root ) ) {
            fixCursor( node, root );
        }
        parent.insertBefore( frag, nodeAfterSplit );

        // 4. Remove empty nodes created either side of split, then
        // merge containers at the edges.
        var next = nodeBeforeSplit.nextSibling;
        node = getPreviousBlock( next, root );
        if ( node && !/\S/.test( node.textContent ) ) {
            do {
                parent = node.parentNode;
                parent.removeChild( node );
                node = parent;
            } while ( node && !node.lastChild && node !== root );
        }
        if ( !nodeBeforeSplit.parentNode ) {
            nodeBeforeSplit = next.previousSibling;
        }
        if ( !startContainer.parentNode ) {
            startContainer = nodeBeforeSplit || next.parentNode;
            startOffset = nodeBeforeSplit ?
                nodeBeforeSplit.childNodes.length : 0;
        }
        // Merge inserted containers with edges of split
        if ( isContainer( next ) ) {
            mergeContainers( next, root );
        }

        var prev = nodeAfterSplit.previousSibling;
        node = isBlock( nodeAfterSplit ) ?
            nodeAfterSplit : getNextBlock( nodeAfterSplit, root );
        if ( node && !/\S/.test( node.textContent ) ) {
            do {
                parent = node.parentNode;
                parent.removeChild( node );
                node = parent;
            } while ( node && !node.lastChild && node !== root );
        }
        if ( !nodeAfterSplit.parentNode ) {
            nodeAfterSplit = prev.nextSibling;
        }
        if ( !endOffset ) {
            endContainer = prev;
            endOffset = prev.childNodes.length;
        }
        // Merge inserted containers with edges of split
        if ( nodeAfterSplit && isContainer( nodeAfterSplit ) ) {
            mergeContainers( nodeAfterSplit, root );
        }

        range.setStart( startContainer, startOffset );
        range.setEnd( endContainer, endOffset );
        moveRangeBoundariesDownTree( range );
    }
}

// ---

function isNodeContainedInRange ( range, node, partial ) {
    var nodeRange = node.ownerDocument.createRange();

    nodeRange.selectNode( node );

    if ( partial ) {
        // Node must not finish before range starts or start after range
        // finishes.
        var nodeEndBeforeStart = ( range.compareBoundaryPoints(
                END_TO_START, nodeRange ) > -1 );
        var nodeStartAfterEnd = ( range.compareBoundaryPoints(
                START_TO_END, nodeRange ) < 1 );
        return ( !nodeEndBeforeStart && !nodeStartAfterEnd );
    }
    else {
        // Node must start after range starts and finish before range
        // finishes
        var nodeStartAfterStart = ( range.compareBoundaryPoints(
                START_TO_START, nodeRange ) < 1 );
        var nodeEndBeforeEnd = ( range.compareBoundaryPoints(
                END_TO_END, nodeRange ) > -1 );
        return ( nodeStartAfterStart && nodeEndBeforeEnd );
    }
}

function moveRangeBoundariesDownTree ( range ) {
    var startContainer = range.startContainer;
    var startOffset = range.startOffset;
    var endContainer = range.endContainer;
    var endOffset = range.endOffset;
    var maySkipBR = true;
    var child;

    while ( startContainer.nodeType !== TEXT_NODE ) {
        child = startContainer.childNodes[ startOffset ];
        if ( !child || isLeaf( child ) ) {
            break;
        }
        startContainer = child;
        startOffset = 0;
    }
    if ( endOffset ) {
        while ( endContainer.nodeType !== TEXT_NODE ) {
            child = endContainer.childNodes[ endOffset - 1 ];
            if ( !child || isLeaf( child ) ) {
                if ( maySkipBR && child && child.nodeName === 'BR' ) {
                    endOffset -= 1;
                    maySkipBR = false;
                    continue;
                }
                break;
            }
            endContainer = child;
            endOffset = getLength( endContainer );
        }
    } else {
        while ( endContainer.nodeType !== TEXT_NODE ) {
            child = endContainer.firstChild;
            if ( !child || isLeaf( child ) ) {
                break;
            }
            endContainer = child;
        }
    }

    // If collapsed, this algorithm finds the nearest text node positions
    // *outside* the range rather than inside, but also it flips which is
    // assigned to which.
    if ( range.collapsed ) {
        range.setStart( endContainer, endOffset );
        range.setEnd( startContainer, startOffset );
    } else {
        range.setStart( startContainer, startOffset );
        range.setEnd( endContainer, endOffset );
    }
}

function moveRangeBoundariesUpTree ( range, startMax, endMax, root ) {
    var startContainer = range.startContainer;
    var startOffset = range.startOffset;
    var endContainer = range.endContainer;
    var endOffset = range.endOffset;
    var maySkipBR = true;
    var parent;

    if ( !startMax ) {
        startMax = range.commonAncestorContainer;
    }
    if ( !endMax ) {
        endMax = startMax;
    }

    while ( !startOffset &&
            startContainer !== startMax &&
            startContainer !== root ) {
        parent = startContainer.parentNode;
        startOffset = indexOf.call( parent.childNodes, startContainer );
        startContainer = parent;
    }

    while ( true ) {
        if ( maySkipBR &&
                endContainer.nodeType !== TEXT_NODE &&
                endContainer.childNodes[ endOffset ] &&
                endContainer.childNodes[ endOffset ].nodeName === 'BR' ) {
            endOffset += 1;
            maySkipBR = false;
        }
        if ( endContainer === endMax ||
                endContainer === root ||
                endOffset !== getLength( endContainer ) ) {
            break;
        }
        parent = endContainer.parentNode;
        endOffset = indexOf.call( parent.childNodes, endContainer ) + 1;
        endContainer = parent;
    }

    range.setStart( startContainer, startOffset );
    range.setEnd( endContainer, endOffset );
}

// Returns the first block at least partially contained by the range,
// or null if no block is contained by the range.
function getStartBlockOfRange ( range, root ) {
    var container = range.startContainer;
    var block;

    // If inline, get the containing block.
    if ( isInline( container ) ) {
        block = getPreviousBlock( container, root );
    } else if ( container !== root && isBlock( container ) ) {
        block = container;
    } else {
        block = getNodeBefore( container, range.startOffset );
        block = getNextBlock( block, root );
    }
    // Check the block actually intersects the range
    return block && isNodeContainedInRange( range, block, true ) ? block : null;
}

// Returns the last block at least partially contained by the range,
// or null if no block is contained by the range.
function getEndBlockOfRange ( range, root ) {
    var container = range.endContainer;
    var block;

    // If inline, get the containing block.
    if ( isInline( container ) ) {
        block = getPreviousBlock( container, root );
    } else if ( container !== root && isBlock( container ) ) {
        block = container;
    } else {
        block = getNodeAfter( container, range.endOffset );
        if ( !block || !isOrContains( root, block ) ) {
            block = root;
            var child;
            while ( child = block.lastChild ) {
                block = child;
            }
        }
        block = getPreviousBlock( block, root );
    }
    // Check the block actually intersects the range
    return block && isNodeContainedInRange( range, block, true ) ? block : null;
}

var contentWalker = new TreeWalker( null,
    SHOW_TEXT|SHOW_ELEMENT,
    function (node) { return node.nodeType === TEXT_NODE ?
            notWS.test( node.data ) :
            node.nodeName === 'IMG'; }
);

function rangeDoesStartAtBlockBoundary ( range, root ) {
    var startContainer = range.startContainer;
    var startOffset = range.startOffset;
    var nodeAfterCursor;

    // If in the middle or end of a text node, we're not at the boundary.
    contentWalker.root = null;
    if ( startContainer.nodeType === TEXT_NODE ) {
        if ( startOffset ) {
            return false;
        }
        nodeAfterCursor = startContainer;
    } else {
        nodeAfterCursor = getNodeAfter( startContainer, startOffset );
        if ( nodeAfterCursor && !isOrContains( root, nodeAfterCursor ) ) {
            nodeAfterCursor = null;
        }
        // The cursor was right at the end of the document
        if ( !nodeAfterCursor ) {
            nodeAfterCursor = getNodeBefore( startContainer, startOffset );
            if ( nodeAfterCursor.nodeType === TEXT_NODE &&
                    nodeAfterCursor.length ) {
                return false;
            }
        }
    }

    // Otherwise, look for any previous content in the same block.
    contentWalker.currentNode = nodeAfterCursor;
    contentWalker.root = getStartBlockOfRange( range, root );

    return !contentWalker.previousNode();
}

function rangeDoesEndAtBlockBoundary ( range, root ) {
    var endContainer = range.endContainer;
    var endOffset = range.endOffset;

    // If in a text node with content, and not at the end, we're not
    // at the boundary
    contentWalker.root = null;
    if ( endContainer.nodeType === TEXT_NODE ) {
        var length = endContainer.data.length;
        if ( length && endOffset < length ) {
            return false;
        }
        contentWalker.currentNode = endContainer;
    } else {
        contentWalker.currentNode = getNodeBefore( endContainer, endOffset );
    }

    // Otherwise, look for any further content in the same block.
    contentWalker.root = getEndBlockOfRange( range, root );

    return !contentWalker.nextNode();
}

function expandRangeToBlockBoundaries ( range, root ) {
    var start = getStartBlockOfRange( range, root );
    var end = getEndBlockOfRange( range, root );

    if ( start && end ) {
        var parent = start.parentNode;
        range.setStart( parent, indexOf.call( parent.childNodes, start ) );
        parent = end.parentNode;
        range.setEnd( parent, indexOf.call( parent.childNodes, end ) + 1 );
    }
}

var fontSizes = {
    1: 10,
    2: 13,
    3: 16,
    4: 18,
    5: 24,
    6: 32,
    7: 48,
};

var styleToSemantic = {
    backgroundColor: {
        regexp: notWS,
        replace: function ( doc, colour ) { return createElement( doc, 'SPAN', {
                'class': HIGHLIGHT_CLASS,
                style: 'background-color:' + colour
            }); },
    },
    color: {
        regexp: notWS,
        replace: function ( doc, colour ) { return createElement( doc, 'SPAN', {
                'class': COLOUR_CLASS,
                style: 'color:' + colour
            }); },
    },
    fontWeight: {
        regexp: /^bold|^700/i,
        replace: function (doc) { return createElement( doc, 'B' ); },
    },
    fontStyle: {
        regexp: /^italic/i,
        replace: function (doc) { return createElement( doc, 'I' ); },
    },
    fontFamily: {
        regexp: notWS,
        replace: function ( doc, family ) { return createElement( doc, 'SPAN', {
                'class': FONT_FAMILY_CLASS,
                style: 'font-family:' + family
            }); },
    },
    fontSize: {
        regexp: notWS,
        replace: function ( doc, size ) { return createElement( doc, 'SPAN', {
                'class': FONT_SIZE_CLASS,
                style: 'font-size:' + size
            }); },
    },
    textDecoration: {
        regexp: /^underline/i,
        replace: function (doc) { return createElement( doc, 'U' ); },
    }
};

function replaceWithTag ( tag ) {
    return function ( node, parent ) {
        var el = createElement( node.ownerDocument, tag );
        parent.replaceChild( el, node );
        el.appendChild( empty( node ) );
        return el;
    };
}

function replaceStyles ( node, parent ) {
    var style = node.style;
    var doc = node.ownerDocument;
    var newTreeBottom, newTreeTop;

    for ( var attr in styleToSemantic ) {
        var converter = styleToSemantic[ attr ];
        var css = style[ attr ];
        if ( css && converter.regexp.test( css ) ) {
            var el = converter.replace( doc, css );
            if ( !newTreeTop ) {
                newTreeTop = el;
            }
            if ( newTreeBottom ) {
                newTreeBottom.appendChild( el );
            }
            newTreeBottom = el;
            node.style[ attr ] = '';
        }
    }

    if ( newTreeTop ) {
        newTreeBottom.appendChild( empty( node ) );
        if ( node.nodeName === 'SPAN' ) {
            parent.replaceChild( newTreeTop, node );
        } else {
            node.appendChild( newTreeTop );
        }
    }

    return newTreeBottom || node;
}

var stylesRewriters = {
    P: replaceStyles,
    SPAN: replaceStyles,
    STRONG: replaceWithTag( 'B' ),
    EM: replaceWithTag( 'I' ),
    INS: replaceWithTag( 'U' ),
    STRIKE: replaceWithTag( 'S' ),
    FONT: function FONT ( node, parent ) {
        var face = node.face;
        var size = node.size;
        var color = node.color;
        var doc = node.ownerDocument;
        var newTreeBottom, newTreeTop;
        if ( face ) {
            var fontSpan = createElement( doc, 'SPAN', {
                'class': FONT_FAMILY_CLASS,
                style: 'font-family:' + face
            });
            newTreeTop = fontSpan;
            newTreeBottom = fontSpan;
        }
        if ( size ) {
            var sizeSpan = createElement( doc, 'SPAN', {
                'class': FONT_SIZE_CLASS,
                style: 'font-size:' + fontSizes[ size ] + 'px'
            });
            if ( !newTreeTop ) {
                newTreeTop = sizeSpan;
            }
            if ( newTreeBottom ) {
                newTreeBottom.appendChild( sizeSpan );
            }
            newTreeBottom = sizeSpan;
        }
        if ( color && /^#?([\dA-F]{3}){1,2}$/i.test( color ) ) {
            if ( color.charAt( 0 ) !== '#' ) {
                color = '#' + color;
            }
            var colorSpan = createElement( doc, 'SPAN', {
                'class': COLOUR_CLASS,
                style: 'color:' + color
            });
            if ( !newTreeTop ) {
                newTreeTop = colorSpan;
            }
            if ( newTreeBottom ) {
                newTreeBottom.appendChild( colorSpan );
            }
            newTreeBottom = colorSpan;
        }
        if ( !newTreeTop ) {
            newTreeTop = newTreeBottom = createElement( doc, 'SPAN' );
        }
        parent.replaceChild( newTreeTop, node );
        newTreeBottom.appendChild( empty( node ) );
        return newTreeBottom;
    },
    TT: function TT ( node, parent ) {
        var el = createElement( node.ownerDocument, 'SPAN', {
            'class': FONT_FAMILY_CLASS,
            style: 'font-family:menlo,consolas,"courier new",monospace'
        });
        parent.replaceChild( el, node );
        el.appendChild( empty( node ) );
        return el;
    }
};

var allowedBlock = /^(?:A(?:DDRESS|RTICLE|SIDE|UDIO)|BLOCKQUOTE|CAPTION|D(?:[DLT]|IV)|F(?:IGURE|IGCAPTION|OOTER)|H[1-6]|HEADER|L(?:ABEL|EGEND|I)|O(?:L|UTPUT)|P(?:RE)?|SECTION|T(?:ABLE|BODY|D|FOOT|H|HEAD|R)|COL(?:GROUP)?|UL)$/;

var blacklist = /^(?:HEAD|META|STYLE)/;

var walker = new TreeWalker( null, SHOW_TEXT|SHOW_ELEMENT, function () { return true; } );

/*
    Two purposes:

    1. Remove nodes we don't want, such as weird <o:p> tags, comment nodes
       and whitespace nodes.
    2. Convert inline tags into our preferred format.
*/
function cleanTree ( node, preserveWS ) {
    var nonInlineParent = node;
    while ( isInline( nonInlineParent ) ) {
        nonInlineParent = nonInlineParent.parentNode;
    }
    walker.root = nonInlineParent;

    var children = node.childNodes;
    for ( var i = 0, l = children.length; i < l; i += 1 ) {
        var child = children[i];
        var nodeName = child.nodeName;
        var nodeType = child.nodeType;
        var rewriter = stylesRewriters[ nodeName ];
        if ( nodeType === ELEMENT_NODE ) {
            var childLength = child.childNodes.length;
            if ( rewriter ) {
                child = rewriter( child, node );
            } else if ( blacklist.test( nodeName ) ) {
                node.removeChild( child );
                i -= 1;
                l -= 1;
                continue;
            } else if ( !allowedBlock.test( nodeName ) && !isInline( child ) ) {
                i -= 1;
                l += childLength - 1;
                node.replaceChild( empty( child ), child );
                continue;
            }
            if ( childLength ) {
                cleanTree( child, preserveWS || ( nodeName === 'PRE' ) );
            }
        } else {
            if ( nodeType === TEXT_NODE ) {
                var data = child.data;
                var sibling = (void 0);
                var startsWithWS = !notWS.test( data.charAt( 0 ) );
                var endsWithWS = !notWS.test( data.charAt(
                        data.length - 1 ) );
                if ( preserveWS || ( !startsWithWS && !endsWithWS ) ) {
                    continue;
                }
                // Iterate through the nodes; if we hit some other content
                // before the start of a new block we don't trim
                if ( startsWithWS ) {
                    walker.currentNode = child;
                    while ( sibling = walker.previousPONode() ) {
                        nodeName = sibling.nodeName;
                        if ( nodeName === 'IMG' ||
                                ( nodeName === '#text' &&
                                    notWS.test( sibling.data ) ) ) {
                            break;
                        }
                        if ( !isInline( sibling ) ) {
                            sibling = null;
                            break;
                        }
                    }
                    data = data.replace( /^[ \t\r\n]+/g, sibling ? ' ' : '' );
                }
                if ( endsWithWS ) {
                    walker.currentNode = child;
                    while ( sibling = walker.nextNode() ) {
                        if ( nodeName === 'IMG' ||
                                ( nodeName === '#text' &&
                                    notWS.test( sibling.data ) ) ) {
                            break;
                        }
                        if ( !isInline( sibling ) ) {
                            sibling = null;
                            break;
                        }
                    }
                    data = data.replace( /[ \t\r\n]+$/g, sibling ? ' ' : '' );
                }
                if ( data ) {
                    child.data = data;
                    continue;
                }
            }
            node.removeChild( child );
            i -= 1;
            l -= 1;
        }
    }
    return node;
}

// ---

function removeEmptyInlines ( node ) {
    var children = node.childNodes;
    var l = children.length;
    while ( l-- ) {
        var child = children[l];
        if ( child.nodeType === ELEMENT_NODE && !isLeaf( child ) ) {
            removeEmptyInlines( child );
            if ( isInline( child ) && !child.firstChild ) {
                node.removeChild( child );
            }
        } else if ( child.nodeType === TEXT_NODE && !child.data ) {
            node.removeChild( child );
        }
    }
}

// ---

function notWSTextNode ( node ) {
    return node.nodeType === ELEMENT_NODE ?
        node.nodeName === 'BR' :
        notWS.test( node.data );
}
function isLineBreak ( br, isLBIfEmptyBlock ) {
    var block = br.parentNode;
    while ( isInline( block ) ) {
        block = block.parentNode;
    }
    var walker = new TreeWalker(
        block, SHOW_ELEMENT|SHOW_TEXT, notWSTextNode );
    walker.currentNode = br;
    return !!walker.nextNode() ||
        ( isLBIfEmptyBlock && !walker.previousNode() );
}

// <br> elements are treated specially, and differently depending on the
// browser, when in rich text editor mode. When adding HTML from external
// sources, we must remove them, replacing the ones that actually affect
// line breaks by wrapping the inline text in a <div>. Browsers that want <br>
// elements at the end of each block will then have them added back in a later
// fixCursor method call.
function cleanupBRs ( node, root, keepForBlankLine ) {
    var brs = node.querySelectorAll( 'BR' );
    var brBreaksLine = [];
    var l = brs.length;

    // Must calculate whether the <br> breaks a line first, because if we
    // have two <br>s next to each other, after the first one is converted
    // to a block split, the second will be at the end of a block and
    // therefore seem to not be a line break. But in its original context it
    // was, so we should also convert it to a block split.
    for ( var i = 0; i < l; i += 1 ) {
        brBreaksLine[i] = isLineBreak( brs[i], keepForBlankLine );
    }
    while ( l-- ) {
        var br = brs[l];
        // Cleanup may have removed it
        var parent = br.parentNode;
        if ( !parent ) { continue; }
        // If it doesn't break a line, just remove it; it's not doing
        // anything useful. We'll add it back later if required by the
        // browser. If it breaks a line, wrap the content in div tags
        // and replace the brs.
        if ( !brBreaksLine[l] ) {
            detach( br );
        } else if ( !isInline( parent ) ) {
            fixContainer( parent, root );
        }
    }
}

// The (non-standard but supported enough) innerText property is based on the
// render tree in Firefox and possibly other browsers, so we must insert the
// DOM node into the document to ensure the text part is correct.
function setClipboardData ( clipboardData, node, root ) {
    var body = node.ownerDocument.body;

    // Firefox will add an extra new line for BRs at the end of block when
    // calculating innerText, even though they don't actually affect display.
    // So we need to remove them first.
    cleanupBRs( node, root, true );

    node.setAttribute( 'style',
        'position:fixed;overflow:hidden;bottom:100%;right:100%;' );
    body.appendChild( node );
    var html = node.innerHTML;
    var text = node.innerText || node.textContent;

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

function onCut ( event ) {
    var clipboardData = event.clipboardData;
    var range = this.getSelection();
    var root = this._root;
    var self = this;

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
        var startBlock = getStartBlockOfRange( range, root );
        var endBlock = getEndBlockOfRange( range, root );
        var copyRoot = ( ( startBlock === endBlock ) && startBlock ) || root;
        // Extract the contents
        var contents = deleteContentsOfRange( range, root );
        // Add any other parents not in extracted content, up to copy root
        var parent = range.commonAncestorContainer;
        if ( parent.nodeType === TEXT_NODE ) {
            parent = parent.parentNode;
        }
        while ( parent && parent !== copyRoot ) {
            var newContents = parent.cloneNode( false );
            newContents.appendChild( contents );
            contents = newContents;
            parent = parent.parentNode;
        }
        // Set clipboard data
        var node = this.createElement( 'div' );
        node.appendChild( contents );
        setClipboardData( clipboardData, node, root );
        event.preventDefault();
    } else {
        setTimeout( function () {
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

function onCopy ( event ) {
    var clipboardData = event.clipboardData;
    var range = this.getSelection();
    var root = this._root;

    // Edge only seems to support setting plain text as of 2016-03-11.
    // Mobile Safari flat out doesn't work:
    // https://bugs.webkit.org/show_bug.cgi?id=143776
    if ( !isEdge && !isIOS && clipboardData ) {
        // Clipboard content should include all parents within block, or all
        // parents up to root if selection across blocks
        var startBlock = getStartBlockOfRange( range, root );
        var endBlock = getEndBlockOfRange( range, root );
        var copyRoot = ( ( startBlock === endBlock ) && startBlock ) || root;
        // Clone range to mutate, then move up as high as possible without
        // passing the copy root node.
        range = range.cloneRange();
        moveRangeBoundariesDownTree( range );
        moveRangeBoundariesUpTree( range, copyRoot, copyRoot, root );
        // Extract the contents
        var contents = range.cloneContents();
        // Add any other parents not in extracted content, up to copy root
        var parent = range.commonAncestorContainer;
        if ( parent.nodeType === TEXT_NODE ) {
            parent = parent.parentNode;
        }
        while ( parent && parent !== copyRoot ) {
            var newContents = parent.cloneNode( false );
            newContents.appendChild( contents );
            contents = newContents;
            parent = parent.parentNode;
        }
        // Set clipboard data
        var node = this.createElement( 'div' );
        node.appendChild( contents );
        setClipboardData( clipboardData, node, root );
        event.preventDefault();
    }
}

// Need to monitor for shift key like this, as event.shiftKey is not available
// in paste event.
function monitorShiftKey ( event ) {
    this.isShiftDown = event.shiftKey;
}

function onPaste ( event ) {
    var clipboardData = event.clipboardData;
    var items = clipboardData && clipboardData.items;
    var choosePlain = this.isShiftDown;
    var self = this;

    // Current HTML5 Clipboard interface
    // ---------------------------------
    // https://html.spec.whatwg.org/multipage/interaction.html

    // Edge only provides access to plain text as of 2016-03-11.
    if ( !isEdge && items ) {
        var hasImage = false;
        var plainItem = null;
        event.preventDefault();
        var l = items.length;
        while ( l-- ) {
            var item = items[l];
            var type = item.type;
            if ( !choosePlain && type === 'text/html' ) {
                /*jshint loopfunc: true */
                item.getAsString( function (html) { return self.insertHTML( html, true ); } );
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
            var fireDrop = false;
            this.fireEvent( 'dragover', {
                dataTransfer: clipboardData,
                /*jshint loopfunc: true */
                preventDefault: function () { fireDrop = true; }
                /*jshint loopfunc: false */
            });
            if ( fireDrop ) {
                this.fireEvent( 'drop', {
                    dataTransfer: clipboardData
                });
            }
        } else if ( plainItem ) {
            plainItem.getAsString( function (text) { return self.insertPlainText( text, true ); } );
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
    var types = clipboardData && clipboardData.types;
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
        var data = clipboardData.getData( 'text/html' );
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

    var body = this._doc.body;
    var range = this.getSelection();
    var startContainer = range.startContainer;
    var startOffset = range.startOffset;
    var endContainer = range.endContainer;
    var endOffset = range.endOffset;

    // We need to position the pasteArea in the visible portion of the screen
    // to stop the browser auto-scrolling.
    var pasteArea = this.createElement( 'DIV', {
        contenteditable: 'true',
        style: 'position:fixed; overflow:hidden; top:0; right:100%; width:1px; height:1px;'
    });
    body.appendChild( pasteArea );
    range.selectNodeContents( pasteArea );
    this.setSelection( range );

    // A setTimeout of 0 means this is added to the back of the
    // single javascript thread, so it will be executed after the
    // paste event.
    setTimeout( function () {
        try {
            // IE sometimes fires the beforepaste event twice; make sure it is
            // not run again before our after paste function is called.
            self._awaitingPaste = false;

            // Get the pasted content and clean
            var html = '';
            var next = pasteArea;

            // #88: Chrome can apparently split the paste area if certain
            // content is inserted; gather them all up.
            while ( pasteArea = next ) {
                next = pasteArea.nextSibling;
                detach( pasteArea );
                // Safari and IE like putting extra divs around things.
                var first = pasteArea.firstChild;
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
function onDrop ( event ) {
    var types = event.dataTransfer.types;
    var l = types.length;
    var hasPlain = false;
    var hasHTML = false;
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

// FIXME(modulify): cyclical dependencies here; not *necessarily* a problem,
// but we should prefer to remove it if we can. (And first verify that it’s not
// going to blow things up.)
var keys = {
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
function onKey ( event ) {
    if ( event.defaultPrevented ) {
        return;
    }

    var code = event.keyCode;
    var key = keys[ code ];
    var range = this.getSelection();

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
    var modifiers = '';
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
    return function ( self, event ) {
        event.preventDefault();
        self[ method ]();
    };
}

function mapKeyToFormat ( tag, remove ) {
    remove = remove || null;
    return function ( self, event ) {
        event.preventDefault();
        var range = self.getSelection();
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
        var node = range.startContainer;
        // Climb the tree from the focus point while we are inside an empty
        // inline element
        if ( node.nodeType === TEXT_NODE ) {
            node = node.parentNode;
        }
        var parent = node;
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

var keyHandlers = {
    enter: function enter( self, event, range ) {
        // We handle this ourselves
        event.preventDefault();

        // Save undo checkpoint and add any links in the preceding section.
        // Remove any zws so we don't think there's content in an empty
        // block.
        self._recordUndoState( range );
        var root = self._root;
        addLinks( range.startContainer, root, self );
        self._removeZWS();
        self._getRangeAndRemoveBookmark( range );

        // Selected text is overwritten, therefore delete the contents
        // to collapse selection.
        if ( !range.collapsed ) {
            deleteContentsOfRange( range, root );
        }

        var block = getStartBlockOfRange( range, root );

        // If this is a malformed bit of document or in a table;
        // just play it safe and insert a <br>.
        if ( !block || /^T[HD]$/.test( block.nodeName ) ) {
            // If inside an <a>, move focus out
            var parent$1 = getNearest( range.endContainer, root, 'A' );
            if ( parent$1 ) {
                parent$1 = parent$1.parentNode;
                moveRangeBoundariesUpTree( range, parent$1, parent$1, root );
                range.collapse( false );
            }
            insertNodeInRange( range, self.createElement( 'BR' ) );
            range.collapse( false );
            self.setSelection( range );
            self._updatePath( range, true );
            return;
        }

        // If in a list, we'll split the LI instead.
        var parent = getNearest( block, root, 'LI' );
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
        var nodeAfterSplit = splitBlock( self, block,
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
            var child = nodeAfterSplit.firstChild;

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
                var next = child.nextSibling;
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
    backspace: function backspace( self, event, range ) {
        var root = self._root;
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
            var current = getStartBlockOfRange( range, root );
            if ( !current ) {
                return;
            }
            // In case inline data has somehow got between blocks.
            fixContainer( current.parentNode, root );
            // Now get previous block
            var previous = getPreviousBlock( current, root );
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
            setTimeout( function () { return afterDelete( self ); }, 0 );
        }
    },
    'delete': function delete$1( self, event, range ) {
        var root = self._root;
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
            var current = getStartBlockOfRange( range, root );
            if ( !current ) {
                return;
            }
            // In case inline data has somehow got between blocks.
            fixContainer( current.parentNode, root );
            // Now get next block
            var next = getNextBlock( current, root );
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
            var originalRange = range.cloneRange();
            moveRangeBoundariesUpTree( range, root, root, root );
            var cursorContainer = range.endContainer;
            var cursorOffset = range.endOffset;
            if ( cursorContainer.nodeType === ELEMENT_NODE ) {
                var nodeAfterCursor = cursorContainer.childNodes[
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
            setTimeout( function () { return afterDelete( self ); }, 0 );
        }
    },
    tab: function tab( self, event, range ) {
        var root = self._root;
        self._removeZWS();
        // If no selection and at start of block
        if ( range.collapsed && rangeDoesStartAtBlockBoundary( range, root ) ) {
            var node = getStartBlockOfRange( range, root );
            // Iterate through the block's parents
            var parent;
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
    'shift-tab': function shift_tab( self, event, range ) {
        var root = self._root;
        self._removeZWS();
        // If no selection and at start of block
        if ( range.collapsed && rangeDoesStartAtBlockBoundary( range, root ) ) {
            // Break list
            var node = range.startContainer;
            if ( getNearest( node, root, 'UL' ) ||
                    getNearest( node, root, 'OL' ) ) {
                event.preventDefault();
                self.decreaseListLevel( range, false );
            }
        }
    },
    space: function space( self, _, range ) {
        self._recordUndoState( range );
        addLinks( range.startContainer, self._root, self );
        self._getRangeAndRemoveBookmark( range );

        // If the cursor is at the end of a link (<a>foo|</a>) then move it
        // outside of the link (<a>foo</a>|) so that the space is not part of
        // the link text.
        var node = range.endContainer;
        var parent = node.parentNode;
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
    left: function left( self ) {
        self._removeZWS();
    },
    right: function right( self ) {
        self._removeZWS();
    }
};

// Firefox pre v29 incorrectly handles Cmd-left/Cmd-right on Mac:
// it goes back/forward in history! Override to do the right
// thing.
// https://bugzilla.mozilla.org/show_bug.cgi?id=289384
if ( isMac && isGecko ) {
    keyHandlers[ 'meta-left' ] = function ( self, event ) {
        event.preventDefault();
        var sel = getWindowSelection( self );
        if ( sel && sel.modify ) {
            sel.modify( 'move', 'backward', 'lineboundary' );
        }
    };
    keyHandlers[ 'meta-right' ] = function ( self, event ) {
        event.preventDefault();
        var sel = getWindowSelection( self );
        if ( sel && sel.modify ) {
            sel.modify( 'move', 'forward', 'lineboundary' );
        }
    };
}

// System standard for page up/down on Mac is to just scroll, not move the
// cursor. On Linux/Windows, it should move the cursor, but some browsers don't
// implement this natively. Override to support it.
if ( !isMac ) {
    keyHandlers.pageup = function (self) { return self.moveCursorToStart(); };
    keyHandlers.pagedown = function (self) { return self.moveCursorToEnd(); };
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

/* global DOMPurify */
function mergeObjects ( base, extras, mayOverride ) {
    if ( !base ) {
        base = {};
    }
    if ( extras ) {
        for ( var prop in extras ) {
            if ( mayOverride || !( prop in base ) ) {
                var value = extras[ prop ];
                base[ prop ] = ( value && value.constructor === Object ) ?
                    mergeObjects( base[ prop ], value, mayOverride ) :
                    value;
            }
        }
    }
    return base;
}

function sanitizeToDOMFragment ( html, isPaste, self ) {
    var doc = self._doc;
    var frag = html ? DOMPurify.sanitize( html, {
        WHOLE_DOCUMENT: false,
        RETURN_DOM: true,
        RETURN_DOM_FRAGMENT: true
    }) : null;
    return frag ? doc.importNode( frag, true ) : doc.createDocumentFragment();
}

// Subscribing to these events won't automatically add a listener to the
// document node, since these events are fired in a custom manner by the
// editor code.
var customEvents = {
    pathChange: 1, select: 1, input: 1, undoStateChange: 1
};

function getWindowSelection ( self ) {
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
function removeZWS ( root, keepNode ) {
    var walker = new TreeWalker( root, SHOW_TEXT, function () { return true; }, false );
    var node, index;
    while ( node = walker.nextNode() ) {
        while ( ( index = node.data.indexOf( ZWS ) ) > -1  &&
                ( !keepNode || node.parentNode !== keepNode ) ) {
            if ( node.length === 1 ) {
                do {
                    var parent = node.parentNode;
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

var tagAfterSplit = {
    DT: 'DD',
    DD: 'DT',
    LI: 'LI',
};

function splitBlock ( self, block, node, offset ) {
    var splitTag = tagAfterSplit[ block.nodeName ];
    var splitProperties = null;
    var nodeAfterSplit = split( node, offset, block.parentNode, self._root );
    var config = self._config;

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

var startSelectionId = 'squire-selection-start';
var endSelectionId = 'squire-selection-end';

function removeBlockQuote (/* frag */) {
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
    var walker = getBlockWalker( frag, self._root );
    var tagAttributes = self._config.tagAttributes;
    var listAttrs = tagAttributes[ type.toLowerCase() ];
    var listItemAttrs = tagAttributes.li;

    var node;
    while ( node = walker.nextNode() ) {
        if ( node.parentNode.nodeName === 'LI' ) {
            node = node.parentNode;
            walker.currentNode = node.lastChild;
        }
        if ( node.nodeName !== 'LI' ) {
            var newLi = self.createElement( 'LI', listItemAttrs );
            if ( node.dir ) {
                newLi.dir = node.dir;
            }

            // Have we replaced the previous block with a new <ul>/<ol>?
            var prev = node.previousSibling;
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
            var tag = node.nodeName;
            if ( tag !== type && ( /^[OU]L$/.test( tag ) ) ) {
                replaceWith( node,
                    self.createElement( type, listAttrs, [ empty( node ) ] )
                );
            }
        }
    }
}

// --- Get/set data ---

var linkRegExp = /\b((?:(?:ht|f)tps?:\/\/|www\d{0,3}[.]|[a-z0-9.\-]+[.][a-z]{2,}\/)(?:[^\s()<>]+|\([^\s()<>]+\))+(?:\((?:[^\s()<>]+|(?:\([^\s()<>]+\)))*\)|[^\s`!()\[\]{};:'".,<>?«»“”‘’]))|([\w\-.%+]+@(?:[\w\-]+\.)+[A-Z]{2,}\b)/i;

function addLinks ( frag, root, self ) {
    var doc = frag.ownerDocument;
    var walker = new TreeWalker( frag, SHOW_TEXT,
            function (node) { return !getNearest( node, root, 'A' ); }, false );
    var defaultAttributes = self._config.tagAttributes.a;
    var node, match;
    while ( node = walker.nextNode() ) {
        var data = node.data;
        var parent = node.parentNode;
        while ( match = linkRegExp.exec( data ) ) {
            var index = match.index;
            var endIndex = index + match[0].length;
            if ( index ) {
                var child = doc.createTextNode( data.slice( 0, index ) );
                parent.insertBefore( child, node );
            }
            var child$1 = self.createElement( 'A', mergeObjects({
                href: match[1] ?
                    /^(?:ht|f)tps?:/.test( match[1] ) ?
                        match[1] :
                        'http://' + match[1] :
                    'mailto:' + match[2]
            }, defaultAttributes, false ));
            child$1.textContent = data.slice( index, endIndex );
            parent.insertBefore( child$1, node );
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
    for ( var node = root.firstChild, next = (void 0); node; node = next ) {
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

var Squire$1 = function Squire( root, config ) {
    if ( root.nodeType === DOCUMENT_NODE ) {
        root = root.body;
    }
    var doc = root.ownerDocument;
    var win$$1 = doc.defaultView;

    this._win = win$$1;
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
        var mutation = new MutationObserver(
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
        win$$1.Text.prototype.splitText = function ( offset ) {
            var afterSplit = this.ownerDocument.createTextNode(
                    this.data.slice( offset ) );
            var ref = this;
            var nextSibling = ref.nextSibling;
            var parentNode = ref.parentNode;
            var toDelete = this.length - offset;
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
};

Squire$1.prototype.setConfig = function setConfig ( config ) {
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
        leafNodeNames: leafNodeNames,
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
};

Squire$1.prototype.createElement = function createElement$1 ( tag, props, children ) {
    return createElement( this._doc, tag, props, children );
};

Squire$1.prototype.createDefaultBlock = function createDefaultBlock ( children ) {
    var config = this._config;
    return fixCursor(
        this.createElement( config.blockTag, config.blockAttributes,
            children ),
        this._root
    );
};

Squire$1.prototype.didError = function didError ( error ) {
    console.log( error );
};

Squire$1.prototype.getDocument = function getDocument () {
    return this._doc;
};
Squire$1.prototype.getRoot = function getRoot () {
    return this._root;
};

Squire$1.prototype.modifyDocument = function modifyDocument ( modificationCallback ) {
    var mutation = this._mutation;
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
};

// --- Events ---

Squire$1.prototype.fireEvent = function fireEvent ( type, event ) {
        var this$1 = this;

    var handlers = this._events[ type ];
    // UI code, especially modal views, may be monitoring for focus events and
    // immediately removing focus. In certain conditions, this can cause the
    // focus event to fire after the blur event, which can cause an infinite
    // loop. So we detect whether we're actually focused/blurred before firing.
    if ( /^(?:focus|blur)/.test( type ) ) {
        var isFocused = isOrContains(
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
        var l = handlers.length;
        while ( l-- ) {
            var obj = handlers[l];
            try {
                if ( obj.handleEvent ) {
                    obj.handleEvent( event );
                } else {
                    obj.call( this$1, event );
                }
            } catch ( error ) {
                error.details = 'Squire: fireEvent error. Event type: ' + type;
                this$1.didError( error );
            }
        }
    }
    return this;
};

Squire$1.prototype.destroy = function destroy () {
        var this$1 = this;

    for ( var type in this$1._events ) {
        this$1.removeEventListener( type );
    }
    if ( this._mutation ) {
        this._mutation.disconnect();
    }
    delete this._root.__squire__;

    // Destroy undo stack
    this._undoIndex = -1;
    this._undoStack = [];
    this._undoStackLength = 0;
};

Squire$1.prototype.handleEvent = function handleEvent ( event ) {
    this.fireEvent( event.type, event );
};

Squire$1.prototype.addEventListener = function addEventListener ( type, fn ) {
    if ( !fn ) {
        this.didError({
            name: 'Squire: addEventListener with null or undefined fn',
            message: 'Event type: ' + type
        });
        return this;
    }
    var handlers = this._events[ type ];
    if ( !handlers ) {
        handlers = this._events[ type ] = [];
        if ( !customEvents[ type ] ) {
            var target = this._root;
            if ( type === 'selectionchange' ) {
                target = this._doc;
            }
            target.addEventListener( type, this, true );
        }
    }
    handlers.push( fn );
    return this;
};

Squire$1.prototype.removeEventListener = function removeEventListener ( type, fn ) {
    var handlers = this._events[ type ];
    if ( handlers ) {
        if ( fn ) {
            var l = handlers.length;
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
                var target = this._root;
                if ( type === 'selectionchange' ) {
                    target = this._doc;
                }
                target.removeEventListener( type, this, true );
            }
        }
    }
    return this;
};

// --- Selection and Path ---

Squire$1.prototype._createRange = function _createRange ( range, startOffset, endContainer, endOffset ) {
    if ( range instanceof this._win.Range ) {
        return range.cloneRange();
    }
    var domRange = this._doc.createRange();
    domRange.setStart( range, startOffset );
    if ( endContainer ) {
        domRange.setEnd( endContainer, endOffset );
    } else {
        domRange.setEnd( range, startOffset );
    }
    return domRange;
};

Squire$1.prototype.getCursorPosition = function getCursorPosition ( range ) {
    if ( ( !range && !( range = this.getSelection() ) ) ||
            !range.getBoundingClientRect ) {
        return null;
    }
    // Get the bounding rect
    var rect = range.getBoundingClientRect();
    if ( rect && !rect.top ) {
        this._ignoreChange = true;
        var node = this._doc.createElement( 'SPAN' );
        node.textContent = ZWS;
        insertNodeInRange( range, node );
        rect = node.getBoundingClientRect();
        var parent = node.parentNode;
        parent.removeChild( node );
        mergeInlines( parent, range );
    }
    return rect;
};

Squire$1.prototype._moveCursorTo = function _moveCursorTo ( toStart ) {
    var root = this._root;
    var range = this._createRange(
            root, toStart ? 0 : root.childNodes.length );
    moveRangeBoundariesDownTree( range );
    this.setSelection( range );
    return this;
};
Squire$1.prototype.moveCursorToStart = function moveCursorToStart () {
    return this._moveCursorTo( true );
};
Squire$1.prototype.moveCursorToEnd = function moveCursorToEnd () {
    return this._moveCursorTo( false );
};

Squire$1.prototype.setSelection = function setSelection ( range ) {
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
            var sel = getWindowSelection( this );
            if ( sel ) {
                sel.removeAllRanges();
                sel.addRange( range );
            }
        }
    }
    return this;
};

Squire$1.prototype.getSelection = function getSelection () {
    var sel = getWindowSelection( this );
    var selection;
    // If not focused, always rely on cached selection; another function may
    // have set it but the DOM is not modified until focus again
    if ( this._isFocused && sel && sel.rangeCount ) {
        selection = sel.getRangeAt( 0 ).cloneRange();
        var startContainer = selection.startContainer;
        var endContainer = selection.endContainer;
        // FF can return the selection as being inside an <img>. WTF?
        if ( startContainer && isLeaf( startContainer ) ) {
            selection.setStartBefore( startContainer );
        }
        if ( endContainer && isLeaf( endContainer ) ) {
            selection.setEndBefore( endContainer );
        }
    }
    var root = this._root;
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
};

Squire$1.prototype.getSelectedText = function getSelectedText () {
    var range = this.getSelection();
    var walker = new TreeWalker(
            range.commonAncestorContainer,
            SHOW_TEXT|SHOW_ELEMENT,
            function (node) { return isNodeContainedInRange( range, node, true ); }
        );
    var startContainer = range.startContainer;
        var endContainer = range.endContainer;
    var node = walker.currentNode = startContainer;
    var textContent = '';
    var addedTextInBlock = false;

    if ( !walker.filter( node ) ) {
        node = walker.nextNode();
    }

    while ( node ) {
        if ( node.nodeType === TEXT_NODE ) {
            var value = node.data;
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
};

Squire$1.prototype.getPath = function getPath$$1 () {
    return this._path;
};

Squire$1.prototype._didAddZWS = function _didAddZWS () {
    this._hasZWS = true;
};
Squire$1.prototype._removeZWS = function _removeZWS () {
    if ( !this._hasZWS ) {
        return;
    }
    removeZWS( this._root );
    this._hasZWS = false;
};

// --- Path change events ---

Squire$1.prototype._updatePath = function _updatePath ( range, force ) {
    var anchor = range.startContainer;
    var focus = range.endContainer;
    if ( force || anchor !== this._lastAnchorNode ||
            focus !== this._lastFocusNode ) {
        this._lastAnchorNode = anchor;
        this._lastFocusNode = focus;
        var newPath = ( anchor && focus ) ? ( anchor === focus ) ?
            getPath( focus, this._root ) : '(selection)' : '';
        if ( this._path !== newPath ) {
            this._path = newPath;
            this.fireEvent( 'pathChange', { path: newPath } );
        }
    }
    if ( !range.collapsed ) {
        this.fireEvent( 'select' );
    }
};

// selectionchange is fired synchronously in IE when removing current
// selection and when setting new selection; keyup/mouseup may have
// processing we want to do first. Either way, send to next event loop.
Squire$1.prototype._updatePathOnEvent = function _updatePathOnEvent () {
        var this$1 = this;

    if ( !this._willUpdatePath ) {
        this._willUpdatePath = true;
        setTimeout( function () {
            this$1._willUpdatePath = false;
            this$1._updatePath( this$1.getSelection() );
        }, 0 );
    }
};

// --- Focus ---

Squire$1.prototype.focus = function focus () {
    this._root.focus();

    if ( isIE ) {
        this.fireEvent( 'focus' );
    }

    return this;
};

Squire$1.prototype.blur = function blur () {
    this._root.blur();

    if ( isIE ) {
        this.fireEvent( 'blur' );
    }

    return this;
};

Squire$1.prototype._saveRangeToBookmark = function _saveRangeToBookmark ( range ) {
    var startNode = this.createElement( 'INPUT', {
            id: startSelectionId,
            type: 'hidden'
        });
    var endNode = this.createElement( 'INPUT', {
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
        var temp = startNode;
        startNode = endNode;
        endNode = temp;
    }

    range.setStartAfter( startNode );
    range.setEndBefore( endNode );
};

Squire$1.prototype._getRangeAndRemoveBookmark = function _getRangeAndRemoveBookmark ( range ) {
    var root = this._root;
    var start = root.querySelector( '#' + startSelectionId );
    var end = root.querySelector( '#' + endSelectionId );

    if ( start && end ) {
        var startContainer = start.parentNode;
        var endContainer = end.parentNode;
        var startOffset = indexOf.call(
            startContainer.childNodes, start );
        var endOffset = indexOf.call( endContainer.childNodes, end );

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
};

// --- Undo ---

Squire$1.prototype._keyUpDetectChange = function _keyUpDetectChange ( event ) {
    var code = event.keyCode;
    // Presume document was changed if:
    // 1. A modifier key (other than shift) wasn't held down
    // 2. The key pressed is not in range 16<=x<=20 (control keys)
    // 3. The key pressed is not in range 33<=x<=45 (navigation keys)
    if ( !event.ctrlKey && !event.metaKey && !event.altKey &&
            ( code < 16 || code > 20 ) &&
            ( code < 33 || code > 45 ) ) {
        this._docWasChanged();
    }
};

Squire$1.prototype._docWasChanged = function _docWasChanged () {
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
};

// Leaves bookmark
Squire$1.prototype._recordUndoState = function _recordUndoState ( range ) {
    // Don't record if we're already in an undo state
    if ( !this._isInUndoState ) {
        // Advance pointer to new position
        var undoIndex = this._undoIndex += 1;
        var undoStack = this._undoStack;

        // Truncate stack if longer (i.e. if has been previously undone)
        if ( undoIndex < this._undoStackLength ) {
            undoStack.length = this._undoStackLength = undoIndex;
        }

        // Get data
        if ( range ) {
            this._saveRangeToBookmark( range );
        }
        var html = this._getHTML();

        // If this document is above the configured size threshold,
        // limit the number of saved undo states.
        // Threshold is in bytes, JS uses 2 bytes per character
        var ref = this._config.undo;
            var documentSizeThreshold = ref.documentSizeThreshold;
            var undoLimit = ref.undoLimit;
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
};

Squire$1.prototype.saveUndoState = function saveUndoState ( range ) {
    if ( range === undefined ) {
        range = this.getSelection();
    }
    if ( !this._isInUndoState ) {
        this._recordUndoState( range );
        this._getRangeAndRemoveBookmark( range );
    }
    return this;
};

Squire$1.prototype.undo = function undo () {
    // Sanity check: must not be at beginning of the history stack
    if ( this._undoIndex !== 0 || !this._isInUndoState ) {
        // Make sure any changes since last checkpoint are saved.
        this._recordUndoState( this.getSelection() );

        this._undoIndex -= 1;
        this._setHTML( this._undoStack[ this._undoIndex ] );
        var range = this._getRangeAndRemoveBookmark();
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
};

Squire$1.prototype.redo = function redo () {
    // Sanity check: must not be at end of stack and must be in an undo
    // state.
    var undoIndex = this._undoIndex;
    var undoStackLength = this._undoStackLength;
    if ( undoIndex + 1 < undoStackLength && this._isInUndoState ) {
        this._undoIndex += 1;
        this._setHTML( this._undoStack[ this._undoIndex ] );
        var range = this._getRangeAndRemoveBookmark();
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
};

// --- Inline formatting ---

// Looks for matching tag and attributes, so won't work
// if <strong> instead of <b> etc.
Squire$1.prototype.hasFormat = function hasFormat ( tag, attributes, range ) {
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
    var root = this._root;
    var common = range.commonAncestorContainer;
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
    var walker = new TreeWalker( common, SHOW_TEXT,
        function (node) { return isNodeContainedInRange( range, node, true ); },
        false );

    var seenNode = false;
    var node;
    while ( node = walker.nextNode() ) {
        if ( !getNearest( node, root, tag, attributes ) ) {
            return false;
        }
        seenNode = true;
    }

    return seenNode;
};

// Extracts the font-family and font-size (if any) of the element
// holding the cursor. If there's a selection, returns an empty object.
Squire$1.prototype.getFontInfo = function getFontInfo ( range ) {
    var fontInfo = {
        color: undefined,
        backgroundColor: undefined,
        family: undefined,
        size: undefined
    };

    if ( !range && !( range = this.getSelection() ) ) {
        return fontInfo;
    }

    var element = range.commonAncestorContainer;
    if ( range.collapsed || element.nodeType === TEXT_NODE ) {
        if ( element.nodeType === TEXT_NODE ) {
            element = element.parentNode;
        }
        var seenAttributes = 0;
        while ( seenAttributes < 4 && element ) {
            var style = element.style;
            if ( style ) {
                var attr = (void 0);
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
};

Squire$1.prototype._addFormat = function _addFormat ( tag, attributes, range ) {
        var this$1 = this;

    // If the range is collapsed we simply insert the node by wrapping
    // it round the range and focus it.
    var root = this._root;

    if ( range.collapsed ) {
        var el = fixCursor( this.createElement( tag, attributes ), root );
        insertNodeInRange( range, el );
        range.setStart( el.firstChild, el.firstChild.length );
        range.collapse( true );

        // Clean up any previous formats that may have been set on this block
        // that are unused.
        var block = el;
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
        var walker = new TreeWalker(
            range.commonAncestorContainer,
            SHOW_TEXT|SHOW_ELEMENT,
            function (node) { return ( node.nodeType === TEXT_NODE ||
                        node.nodeName === 'BR' ||
                        node.nodeName === 'IMG'
                    ) && isNodeContainedInRange( range, node, true ); },
            false
        );

        // Start at the beginning node of the range and iterate through
        // all the nodes in the range that need formatting.
        var startContainer = range.startContainer;
            var startOffset = range.startOffset;
            var endContainer = range.endContainer;
            var endOffset = range.endOffset;

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

        var node;
        do {
            node = walker.currentNode;
            var needsFormat = !getNearest( node, root, tag, attributes );
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
                var el$1 = this$1.createElement( tag, attributes );
                replaceWith( node, el$1 );
                el$1.appendChild( node );
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
};

Squire$1.prototype._removeFormat = function _removeFormat ( tag, attributes, range, partial ) {
    // Add bookmark
    this._saveRangeToBookmark( range );

    // We need a node in the selection to break the surrounding
    // formatted text.
    var doc = this._doc;
    var fixer;
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
    var root = range.commonAncestorContainer;
    while ( isInline( root ) ) {
        root = root.parentNode;
    }

    // Find text nodes inside formatTags that are not in selection and
    // add an extra tag with the same formatting.
    var startContainer = range.startContainer;
        var startOffset = range.startOffset;
        var endContainer = range.endContainer;
        var endOffset = range.endOffset;
    var toWrap = [];
    var formatTags = Array.prototype.filter.call(
            root.getElementsByTagName( tag ),
            function (el) { return isNodeContainedInRange( range, el, true ) &&
                    hasTagAttributes( el, tag, attributes ); }
        );

    function examineNode ( node, exemplar ) {
        // If the node is completely contained by the range then
        // we're going to remove all formatting so ignore it.
        if ( isNodeContainedInRange( range, node, false ) ) {
            return;
        }

        var isText = ( node.nodeType === TEXT_NODE );

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
            var child = node.firstChild;
            while ( child ) {
                var next = child.nextSibling;
                examineNode( child, exemplar );
                child = next;
            }
        }
    }

    if ( !partial ) {
        formatTags.forEach( function (node) { return examineNode( node, node ); } );
    }

    // Now wrap unselected nodes in the tag
    toWrap.forEach( function (ref) {
            var exemplar = ref[0];
            var node = ref[1];

        var el = exemplar.cloneNode( false );
        replaceWith( node, el );
        el.appendChild( node );
    });
    // and remove old formatting tags.
    formatTags.forEach( function (el) { return replaceWith( el, empty( el ) ); } );

    // Merge adjacent inlines:
    this._getRangeAndRemoveBookmark( range );
    if ( fixer ) {
        range.collapse( false );
    }
    mergeInlines( root, range );

    return range;
};

Squire$1.prototype.changeFormat = function changeFormat ( add, remove, range, partial ) {
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
};

// --- Block formatting ---

Squire$1.prototype.forEachBlock = function forEachBlock ( fn, mutates, range ) {
    if ( !range && !( range = this.getSelection() ) ) {
        return this;
    }

    // Save undo checkpoint
    if ( mutates ) {
        this.saveUndoState( range );
    }

    var root = this._root;
    var start = getStartBlockOfRange( range, root );
    var end = getEndBlockOfRange( range, root );
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
};

Squire$1.prototype.modifyBlocks = function modifyBlocks ( modify, range ) {
    if ( !range && !( range = this.getSelection() ) ) {
        return this;
    }

    // 1. Save undo checkpoint and bookmark selection
    if ( this._isInUndoState ) {
        this._saveRangeToBookmark( range );
    } else {
        this._recordUndoState( range );
    }

    var root = this._root;

    // 2. Expand range to block boundaries
    expandRangeToBlockBoundaries( range, root );

    // 3. Remove range.
    moveRangeBoundariesUpTree( range, root, root, root );
    var frag = extractContentsOfRange( range, root, root );

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
};

Squire$1.prototype._ensureBottomLine = function _ensureBottomLine () {
    var root = this._root;
    var last = root.lastElementChild;
    if ( !last ||
            last.nodeName !== this._config.blockTag || !isBlock( last ) ) {
        root.appendChild( this.createDefaultBlock() );
    }
};

// --- Keyboard interaction ---

Squire$1.prototype.setKeyHandler = function setKeyHandler ( key, fn ) {
    this._keyHandlers[ key ] = fn;
    return this;
};

// --- Get/Set data ---

Squire$1.prototype._getHTML = function _getHTML () {
    return this._root.innerHTML;
};

Squire$1.prototype._setHTML = function _setHTML ( html ) {
    var root = this._root;
    var node = root;
    node.innerHTML = html;
    do {
        fixCursor( node, root );
    } while ( node = getNextBlock( node, root ) );
    this._ignoreChange = true;
};

Squire$1.prototype.getHTML = function getHTML ( withBookMark ) {
        var this$1 = this;

    var brs = [];
    var range;
    if ( withBookMark && ( range = this.getSelection() ) ) {
        this._saveRangeToBookmark( range );
    }
    if ( useTextFixer ) {
        var root = this._root;
        var node = root;
        while ( node = getNextBlock( node, root ) ) {
            if ( !node.textContent && !node.querySelector( 'BR' ) ) {
                var fixer = this$1.createElement( 'BR' );
                node.appendChild( fixer );
                brs.push( fixer );
            }
        }
    }
    var html = this._getHTML().replace( /\u200B/g, '' );
    if ( useTextFixer ) {
        var l = brs.length;
        while ( l-- ) {
            detach( brs[l] );
        }
    }
    if ( range ) {
        this._getRangeAndRemoveBookmark( range );
    }
    return html;
};

Squire$1.prototype.setHTML = function setHTML ( html ) {
    var config = this._config;
    var sanitizeToDOMFragment = config.isSetHTMLSanitized ?
            config.sanitizeToDOMFragment : null;
    var root = this._root;

    // Parse HTML into DOM tree
    var frag;
    if ( typeof sanitizeToDOMFragment === 'function' ) {
        frag = sanitizeToDOMFragment( html, false, this );
    } else {
        var div = this.createElement( 'DIV' );
        div.innerHTML = html;
        frag = this._doc.createDocumentFragment();
        frag.appendChild( empty( div ) );
    }

    cleanTree( frag );
    cleanupBRs( frag, root, false );

    fixContainer( frag, root );

    // Fix cursor
    var node = frag;
    while ( node = getNextBlock( node, root ) ) {
        fixCursor( node, root );
    }

    // Don't fire an input event
    this._ignoreChange = true;

    // Remove existing root children
    var child;
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
    var range = this._getRangeAndRemoveBookmark() ||
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
};

Squire$1.prototype.insertElement = function insertElement ( el, range ) {
    if ( !range ) { range = this.getSelection(); }
    range.collapse( true );
    if ( isInline( el ) ) {
        insertNodeInRange( range, el );
        range.setStartAfter( el );
    } else {
        // Get containing block node.
        var root = this._root;
        var splitNode = getStartBlockOfRange( range, root ) || root;
        // While at end of container node, move up DOM tree.
        while ( splitNode !== root && !splitNode.nextSibling ) {
            splitNode = splitNode.parentNode;
        }
        // If in the middle of a container node, split up to root.
        var nodeAfterSplit;
        if ( splitNode !== root ) {
            var parent = splitNode.parentNode;
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
};

Squire$1.prototype.insertImage = function insertImage ( src, attributes ) {
    var img = this.createElement( 'IMG',
        mergeObjects( { src: src }, attributes, true ) );
    this.insertElement( img );
    return img;
};

// Insert HTML at the cursor location. If the selection is not collapsed
// insertTreeFragmentIntoRange will delete the selection so that it is
// replaced by the html being inserted.
Squire$1.prototype.insertHTML = function insertHTML ( html, isPaste ) {
    var config = this._config;
    var sanitizeToDOMFragment = config.isInsertedHTMLSanitized ?
            config.sanitizeToDOMFragment : null;
    var range = this.getSelection();
    var doc = this._doc;

    // Edge doesn't just copy the fragment, but includes the surrounding guff
    // including the full <head> of the page. Need to strip this out. If
    // available use DOMPurify to parse and sanitise.
    var frag;
    if ( typeof sanitizeToDOMFragment === 'function' ) {
        frag = sanitizeToDOMFragment( html, isPaste, this );
    } else {
        if ( isPaste ) {
            var startFragIndex = html.indexOf( '<!--StartFragment-->' );
            var endFragIndex = html.lastIndexOf( '<!--EndFragment-->' );
            if ( startFragIndex > -1 && endFragIndex > -1 ) {
                html = html.slice( startFragIndex + 20, endFragIndex );
            }
        }
        // Parse HTML into DOM tree
        var div = this.createElement( 'DIV' );
        div.innerHTML = html;
        frag = doc.createDocumentFragment();
        frag.appendChild( empty( div ) );
    }

    // Record undo checkpoint
    this.saveUndoState( range );

    try {
        var root = this._root;
        var node = frag;
        var event = {
            fragment: frag,
            preventDefault: function preventDefault () {
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
};

Squire$1.prototype.insertPlainText = function insertPlainText ( plainText, isPaste ) {
    var lines = plainText.split( '\n' );
    var config = this._config;
    var tag = config.blockTag;
    var attributes = config.blockAttributes;
    var closeBlock  = '</' + tag + '>';
    var openBlock = '<' + tag;

    for ( var attr in attributes ) {
        openBlock += ' ' + attr + '="' +
            escapeHTMLFragment( attributes[ attr ] ) +
        '"';
    }
    openBlock += '>';

    for ( var i = 0, l = lines.length; i < l; i += 1 ) {
        var line = lines[i];
        line = escapeHTMLFragment( line ).replace( / (?= )/g, '&nbsp;' );
        // Wrap all but first/last lines in <div></div>
        if ( i && i + 1 < l ) {
            line = openBlock + ( line || '<BR>' ) + closeBlock;
        }
        lines[i] = line;
    }
    return this.insertHTML( lines.join( '' ), isPaste );
};

// --- Formatting ---

Squire$1.prototype.addStyles = function addStyles ( styles ) {
    if ( styles ) {
        var head = this._doc.documentElement.firstChild;
        var style = this.createElement( 'STYLE', {
                type: 'text/css'
            });
        style.appendChild( this._doc.createTextNode( styles ) );
        head.appendChild( style );
    }
    return this;
};

Squire$1.prototype.bold = function bold () { return this.changeFormat({ tag: 'B' }).focus(); };
Squire$1.prototype.italic = function italic () { return this.changeFormat({ tag: 'I' }).focus(); };
Squire$1.prototype.underline = function underline () { return this.changeFormat({ tag: 'U' }).focus(); };
Squire$1.prototype.strikethrough = function strikethrough () { return this.changeFormat({ tag: 'S' }).focus(); };
Squire$1.prototype.subscript = function subscript () {
    return this.changeFormat( { tag: 'SUB' }, { tag: 'SUP' } ).focus();
};
Squire$1.prototype.superscript = function superscript () {
    return this.changeFormat( { tag: 'SUP' }, { tag: 'SUB' } ).focus();
};

Squire$1.prototype.removeBold = function removeBold () { return this.changeFormat( null, { tag: 'B' } ).focus(); };
Squire$1.prototype.removeItalic = function removeItalic () { return this.changeFormat( null, { tag: 'I' } ).focus(); };
Squire$1.prototype.removeUnderline = function removeUnderline () {
    return this.changeFormat( null, { tag: 'U' } ).focus();
};
Squire$1.prototype.removeStrikethrough = function removeStrikethrough () {
    return this.changeFormat( null, { tag: 'S' } ).focus();
};
Squire$1.prototype.removeSubscript = function removeSubscript () {
    return this.changeFormat( null, { tag: 'SUB' } ).focus();
};
Squire$1.prototype.removeSuperscript = function removeSuperscript () {
    return this.changeFormat( null, { tag: 'SUP' } ).focus();
};

Squire$1.prototype.makeLink = function makeLink ( url, attributes ) {
    var range = this.getSelection();
    if ( range.collapsed ) {
        var protocolEnd = url.indexOf( ':' ) + 1;
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
};
Squire$1.prototype.removeLink = function removeLink () {
    this.changeFormat( null, {
        tag: 'A'
    }, this.getSelection(), true );
    return this.focus();
};

Squire$1.prototype.setFontFace = function setFontFace ( name ) {
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
};
Squire$1.prototype.setFontSize = function setFontSize ( size ) {
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
};

Squire$1.prototype.setTextColour = function setTextColour ( colour ) {
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
};

Squire$1.prototype.setHighlightColour = function setHighlightColour ( colour ) {
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
};

Squire$1.prototype.setTextAlignment = function setTextAlignment ( alignment ) {
    this.forEachBlock( function (block) {
        var className = block.className
            .split( /\s+/ )
            .filter( function (klass) { return !!klass && !/^align/.test( klass ); } )
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
};

Squire$1.prototype.setTextDirection = function setTextDirection ( direction ) {
    this.forEachBlock( function (block) {
        if ( direction ) {
            block.dir = direction;
        } else {
            block.removeAttribute( 'dir' );
        }
    }, true );
    return this.focus();
};

Squire$1.prototype.removeAllFormatting = function removeAllFormatting ( range ) {
    if ( !range && !( range = this.getSelection() ) || range.collapsed ) {
        return this;
    }

    var root = this._root;
    var stopNode = range.commonAncestorContainer;
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
    var doc = stopNode.ownerDocument;
    var startContainer = range.startContainer;
        var startOffset = range.startOffset;
        var endContainer = range.endContainer;
        var endOffset = range.endOffset;

    // Split end point first to avoid problems when end and start
    // in same container.
    var formattedNodes = doc.createDocumentFragment();
    var cleanNodes = doc.createDocumentFragment();
    var nodeAfterSplit = split( endContainer, endOffset, stopNode, root );
    var nodeInSplit = split( startContainer, startOffset, stopNode, root );

    // Then replace contents in split with a cleaned version of the same:
    // blocks become default blocks, text and leaf nodes survive, everything
    // else is obliterated.
    while ( nodeInSplit !== nodeAfterSplit ) {
        var nextNode$1 = nodeInSplit.nextSibling;
        formattedNodes.appendChild( nodeInSplit );
        nodeInSplit = nextNode$1;
    }
    removeFormatting( this, formattedNodes, cleanNodes );
    cleanNodes.normalize();
    nodeInSplit = cleanNodes.firstChild;
    var nextNode = cleanNodes.lastChild;

    // Restore selection
    var childNodes = stopNode.childNodes;
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
};

// XXX(modulify): there are actual functional changes in here:
// Squire#increaseBlockQuoteLevel et al. now accept two optional parameters:
// range (default: all), and focus (default: true).
// Squire#increaseBlockQuoteLevel.modifier is also set to the modifier function.

function commandModifyBlocks ( modify ) {
    var out = function ( range, focus ) {
        this.modifyBlocks( modify, range );
        if ( typeof focus === 'undefined' || focus ) {
            this.focus();
        }
        return this;
    };
    out.modifier = modify;
    return out;
}

Object.assign( Squire$1.prototype, {

    increaseBlockQuoteLevel: commandModifyBlocks( function ( frag ) {
        return this.createElement( 'BLOCKQUOTE',
            this._config.tagAttributes.blockquote, [
                frag
            ]);
    }),

    decreaseBlockQuoteLevel: commandModifyBlocks( function ( frag ) {
        var root = this._root;
        var blockquotes = frag.querySelectorAll( 'blockquote' );
        Array.prototype.filter.call( blockquotes,
            function (el) { return !getNearest( el.parentNode, root, 'BLOCKQUOTE' ); }
        ).forEach( function (el) { return replaceWith( el, empty( el ) ); } );
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
        var this$1 = this;

        var lists = frag.querySelectorAll( 'UL, OL' );
        var items = frag.querySelectorAll( 'LI' );
        var root = this._root;
        for ( var i = 0, l = lists.length; i < l; i += 1 ) {
            var list = lists[i];
            var listFrag = empty( list );
            fixContainer( listFrag, root );
            replaceWith( list, listFrag );
        }

        for ( var i$1 = 0, l$1 = items.length; i$1 < l$1; i$1 += 1 ) {
            var item = items[i$1];
            if ( isBlock( item ) ) {
                replaceWith( item,
                    this$1.createDefaultBlock([ empty( item ) ])
                );
            } else {
                fixContainer( item, root );
                replaceWith( item, empty( item ) );
            }
        }
        return frag;
    }),

    increaseListLevel: commandModifyBlocks( function ( frag ) {
        var this$1 = this;

        var items = frag.querySelectorAll( 'LI' );
        var tagAttributes = this._config.tagAttributes;
        for ( var i = 0, l = items.length; i < l; i += 1 ) {
            var item = items[i];
            if ( !isContainer( item.firstChild ) ) {
                // type => 'UL' or 'OL'
                var type = item.parentNode.nodeName;
                var newParent = item.previousSibling;
                if ( !newParent || !( newParent = newParent.lastChild ) ||
                        newParent.nodeName !== type ) {
                    var listAttrs = tagAttributes[ type.toLowerCase() ];
                    newParent = this$1.createElement( type, listAttrs );

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
        var root = this._root;
        var items = frag.querySelectorAll( 'LI' );
        Array.prototype.filter.call( items,
            function (el) { return !isContainer( el.firstChild ); }
        ).forEach( function (item) {
            var parent = item.parentNode;
            var newParent = parent.parentNode;
            var first = item.firstChild;
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
                var node = first;
                while ( node ) {
                    var next = node.nextSibling;
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

/** Copyright © 2011-2015 by Neil Jenkins. MIT Licensed. */

// Now we put them as static methods/properties/whatever on the class
Object.assign( Squire$1, {
    isInline: isInline,
    isBlock: isBlock,
    isContainer: isContainer,
    getBlockWalker: getBlockWalker,
    getPreviousBlock: getPreviousBlock,
    getNextBlock: getNextBlock,
    areAlike: areAlike,
    hasTagAttributes: hasTagAttributes,
    getNearest: getNearest,
    isOrContains: isOrContains,
    detach: detach,
    replaceWith: replaceWith,
    empty: empty,

    getNodeBefore: getNodeBefore,
    getNodeAfter: getNodeAfter,
    insertNodeInRange: insertNodeInRange,
    extractContentsOfRange: extractContentsOfRange,
    deleteContentsOfRange: deleteContentsOfRange,
    insertTreeFragmentIntoRange: insertTreeFragmentIntoRange,
    isNodeContainedInRange: isNodeContainedInRange,
    moveRangeBoundariesDownTree: moveRangeBoundariesDownTree,
    moveRangeBoundariesUpTree: moveRangeBoundariesUpTree,
    getStartBlockOfRange: getStartBlockOfRange,
    getEndBlockOfRange: getEndBlockOfRange,
    contentWalker: contentWalker,
    rangeDoesStartAtBlockBoundary: rangeDoesStartAtBlockBoundary,
    rangeDoesEndAtBlockBoundary: rangeDoesEndAtBlockBoundary,
    expandRangeToBlockBoundaries: expandRangeToBlockBoundaries,

    onPaste: onPaste,

    addLinks: addLinks,
    splitBlock: splitBlock,
    startSelectionId: startSelectionId,
    endSelectionId: endSelectionId,
});

/* global define:1 */
if ( typeof exports !== 'object' &&
        ( typeof define !== 'function' || !define.amd ) ) {
    if ( top !== window && document.documentElement.getAttribute(
            'data-squireinit' ) === 'true' ) {
        window.editor = new Squire$1( document );
        if ( window.onEditorLoad ) {
            window.onEditorLoad( window.editor );
            window.onEditorLoad = null;
        }
    }
}

return Squire$1;

}());
