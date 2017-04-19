import {
    ELEMENT_NODE, TEXT_NODE, DOCUMENT_FRAGMENT_NODE, SHOW_ELEMENT,
    HIGHLIGHT_CLASS, COLOUR_CLASS, FONT_FAMILY_CLASS, FONT_SIZE_CLASS,
    cantFocusEmptyTextNodes, useTextFixer, isPresto, ZWS, canWeakMap,
} from "./Constants.js";
import TreeWalker from "./TreeWalker.js";

const inlineNodeNames  = /^(?:#text|A(?:BBR|CRONYM)?|B(?:R|D[IO])?|C(?:ITE|ODE)|D(?:ATA|EL|FN)|EM|FONT|HR|I(?:FRAME|MG|NPUT|NS)?|KBD|Q|R(?:P|T|UBY)|S(?:AMP|MALL|PAN|TR(?:IKE|ONG)|U[BP])?|TIME|U|VAR|WBR)$/;

export const leafNodeNames = {
    BR: 1,
    HR: 1,
    IFRAME: 1,
    IMG: 1,
    INPUT: 1
};

function every ( nodeList, fn ) {
    let l = nodeList.length;
    while ( l-- ) {
        if ( !fn( nodeList[l] ) ) {
            return false;
        }
    }
    return true;
}

// ---

const UNKNOWN = 0;
const INLINE = 1;
const BLOCK = 2;
const CONTAINER = 3;

let nodeCategoryCache;

export function clearNodeCategoryCache() {
    nodeCategoryCache = canWeakMap ? new WeakMap() : null;
}

clearNodeCategoryCache();

export function isLeaf ( node ) {
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

    let nodeCategory;
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
export function isInline ( node ) {
    return getNodeCategory( node ) === INLINE;
}
export function isBlock ( node ) {
    return getNodeCategory( node ) === BLOCK;
}
export function isContainer ( node ) {
    return getNodeCategory( node ) === CONTAINER;
}

export function getBlockWalker ( node, root ) {
    const walker = new TreeWalker( root, SHOW_ELEMENT, isBlock );
    walker.currentNode = node;
    return walker;
}
export function getPreviousBlock ( node, root ) {
    node = getBlockWalker( node, root ).previousNode();
    return node !== root ? node : null;
}
export function getNextBlock ( node, root ) {
    node = getBlockWalker( node, root ).nextNode();
    return node !== root ? node : null;
}

export function areAlike ( node, node2 ) {
    return !isLeaf( node ) && (
        node.nodeType === node2.nodeType &&
        node.nodeName === node2.nodeName &&
        node.nodeName !== 'A' &&
        node.className === node2.className &&
        ( ( !node.style && !node2.style ) ||
          node.style.cssText === node2.style.cssText )
    );
}
export function hasTagAttributes ( node, tag, attributes ) {
    if ( node.nodeName !== tag ) {
        return false;
    }
    for ( const attr in attributes ) {
        if ( node.getAttribute( attr ) !== attributes[ attr ] ) {
            return false;
        }
    }
    return true;
}
export function getNearest ( node, root, tag, attributes ) {
    while ( node && node !== root ) {
        if ( hasTagAttributes( node, tag, attributes ) ) {
            return node;
        }
        node = node.parentNode;
    }
    return null;
}
export function isOrContains ( parent, node ) {
    while ( node ) {
        if ( node === parent ) {
            return true;
        }
        node = node.parentNode;
    }
    return false;
}

export function getPath ( node, root ) {
    let path = '';
    if ( node && node !== root ) {
        path = getPath( node.parentNode, root );
        if ( node.nodeType === ELEMENT_NODE ) {
            path += ( path ? '>' : '' ) + node.nodeName;
            const id = node.id;
            if ( id ) {
                path += '#' + id;
            }
            let classNames;
            const className = node.className.trim();
            if ( className ) {
                classNames = className.split( /\s\s*/ );
                classNames.sort();
                path += '.';
                path += classNames.join( '.' );
            }
            const dir = node.dir;
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

export function getLength ( node ) {
    return node.nodeType === ELEMENT_NODE ?
        node.childNodes.length : node.length || 0;
}

export function detach ( node ) {
    const parent = node.parentNode;
    if ( parent ) {
        parent.removeChild( node );
    }
    return node;
}
export function replaceWith ( node, node2 ) {
    const parent = node.parentNode;
    if ( parent ) {
        parent.replaceChild( node2, node );
    }
}
export function empty ( node ) {
    const frag = node.ownerDocument.createDocumentFragment();
    const childNodes = node.childNodes;
    let l = childNodes ? childNodes.length : 0;
    while ( l-- ) {
        frag.appendChild( node.firstChild );
    }
    return frag;
}

export function createElement ( doc, tag, props, children ) {
    const el = doc.createElement( tag );
    if ( props instanceof Array ) {
        children = props;
        props = null;
    }
    if ( props ) {
        for ( const attr in props ) {
            const value = props[ attr ];
            if ( value !== undefined ) {
                el.setAttribute( attr, props[ attr ] );
            }
        }
    }
    if ( children ) {
        for ( let i = 0, l = children.length; i < l; i += 1 ) {
            el.appendChild( children[i] );
        }
    }
    return el;
}

export function fixCursor ( node, root ) {
    // In Webkit and Gecko, block level elements are collapsed and
    // unfocussable if they have no content. To remedy this, a <BR> must be
    // inserted. In Opera and IE, we just need a textnode in order for the
    // cursor to appear.
    const self = root.__squire__;
    const doc = node.ownerDocument;
    const originalNode = node;
    let fixer, child;

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
export function fixContainer ( container, root ) {
    const children = container.childNodes;
    const doc = container.ownerDocument;
    let wrapper = null;
    const config = root.__squire__._config;

    for ( let i = 0, l = children.length; i < l; i += 1 ) {
        const child = children[i];
        const isBR = child.nodeName === 'BR';
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

export function split ( node, offset, stopNode, root ) {
    const nodeType = node.nodeType;
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
        const parent = node.parentNode;
        const clone = node.cloneNode( false );
        let next;

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
    const children = node.childNodes;
    let l = children.length;
    const frags = [];
    while ( l-- ) {
        const child = children[l];
        const prev = l && children[ l - 1 ];
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
            let len = frags.length;
            while ( len-- ) {
                child.appendChild( frags.pop() );
            }
            _mergeInlines( child, fakeRange );
        }
    }
}

export function mergeInlines ( node, range ) {
    if ( node.nodeType === TEXT_NODE ) {
        node = node.parentNode;
    }
    if ( node.nodeType === ELEMENT_NODE ) {
        const { startContainer, startOffset, endContainer, endOffset } = range;
        _mergeInlines( node, { startContainer, startOffset,
                               endContainer, endOffset } );
        range.setStart( startContainer, startOffset );
        range.setEnd( endContainer, endOffset );
    }
}

export function mergeWithBlock ( block, next, range ) {
    let container = next;
    while ( container.parentNode.childNodes.length === 1 ) {
        container = container.parentNode;
    }
    detach( container );

    let offset = block.childNodes.length;

    // Remove extra <BR> fixer if present.
    let last = block.lastChild;
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

export function mergeContainers ( node, root ) {
    let prev = node.previousSibling;
    const first = node.firstChild;
    const doc = node.ownerDocument;
    const isListItem = ( node.nodeName === 'LI' );

    // Do not merge LIs, unless it only contains a UL
    if ( isListItem && ( !first || !/^[OU]L$/.test( first.nodeName ) ) ) {
        return;
    }

    if ( prev && areAlike( prev, node ) ) {
        if ( !isContainer( prev ) ) {
            if ( isListItem ) {
                const block = createElement( doc, 'DIV' );
                block.appendChild( empty( prev ) );
                prev.appendChild( block );
            } else {
                return;
            }
        }
        detach( node );
        const needsFix = !isContainer( node );
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
