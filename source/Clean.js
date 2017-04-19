import {
    HIGHLIGHT_CLASS, COLOUR_CLASS, FONT_FAMILY_CLASS, FONT_SIZE_CLASS,
    SHOW_TEXT, SHOW_ELEMENT, ELEMENT_NODE, TEXT_NODE, notWS,
} from "./Constants.js";
import TreeWalker from "./TreeWalker.js";
import {
    detach, empty, createElement, fixContainer, isLeaf, isInline,
} from "./Node.js";

const fontSizes = {
    1: 10,
    2: 13,
    3: 16,
    4: 18,
    5: 24,
    6: 32,
    7: 48,
};

const styleToSemantic = {
    backgroundColor: {
        regexp: notWS,
        replace: ( doc, colour ) => createElement( doc, 'SPAN', {
                'class': HIGHLIGHT_CLASS,
                style: 'background-color:' + colour
            }),
    },
    color: {
        regexp: notWS,
        replace: ( doc, colour ) => createElement( doc, 'SPAN', {
                'class': COLOUR_CLASS,
                style: 'color:' + colour
            }),
    },
    fontWeight: {
        regexp: /^bold|^700/i,
        replace: doc => createElement( doc, 'B' ),
    },
    fontStyle: {
        regexp: /^italic/i,
        replace: doc => createElement( doc, 'I' ),
    },
    fontFamily: {
        regexp: notWS,
        replace: ( doc, family ) => createElement( doc, 'SPAN', {
                'class': FONT_FAMILY_CLASS,
                style: 'font-family:' + family
            }),
    },
    fontSize: {
        regexp: notWS,
        replace: ( doc, size ) => createElement( doc, 'SPAN', {
                'class': FONT_SIZE_CLASS,
                style: 'font-size:' + size
            }),
    },
    textDecoration: {
        regexp: /^underline/i,
        replace: doc => createElement( doc, 'U' ),
    }
};

function replaceWithTag ( tag ) {
    return ( node, parent ) => {
        const el = createElement( node.ownerDocument, tag );
        parent.replaceChild( el, node );
        el.appendChild( empty( node ) );
        return el;
    };
}

function replaceStyles ( node, parent ) {
    const style = node.style;
    const doc = node.ownerDocument;
    let newTreeBottom, newTreeTop;

    for ( const attr in styleToSemantic ) {
        const converter = styleToSemantic[ attr ];
        const css = style[ attr ];
        if ( css && converter.regexp.test( css ) ) {
            const el = converter.replace( doc, css );
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

const stylesRewriters = {
    P: replaceStyles,
    SPAN: replaceStyles,
    STRONG: replaceWithTag( 'B' ),
    EM: replaceWithTag( 'I' ),
    INS: replaceWithTag( 'U' ),
    STRIKE: replaceWithTag( 'S' ),
    FONT ( node, parent ) {
        let { face, size, color } = node;
        const doc = node.ownerDocument;
        let newTreeBottom, newTreeTop;
        if ( face ) {
            const fontSpan = createElement( doc, 'SPAN', {
                'class': FONT_FAMILY_CLASS,
                style: 'font-family:' + face
            });
            newTreeTop = fontSpan;
            newTreeBottom = fontSpan;
        }
        if ( size ) {
            const sizeSpan = createElement( doc, 'SPAN', {
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
            const colorSpan = createElement( doc, 'SPAN', {
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
    TT ( node, parent ) {
        const el = createElement( node.ownerDocument, 'SPAN', {
            'class': FONT_FAMILY_CLASS,
            style: 'font-family:menlo,consolas,"courier new",monospace'
        });
        parent.replaceChild( el, node );
        el.appendChild( empty( node ) );
        return el;
    }
};

const allowedBlock = /^(?:A(?:DDRESS|RTICLE|SIDE|UDIO)|BLOCKQUOTE|CAPTION|D(?:[DLT]|IV)|F(?:IGURE|IGCAPTION|OOTER)|H[1-6]|HEADER|L(?:ABEL|EGEND|I)|O(?:L|UTPUT)|P(?:RE)?|SECTION|T(?:ABLE|BODY|D|FOOT|H|HEAD|R)|COL(?:GROUP)?|UL)$/;

const blacklist = /^(?:HEAD|META|STYLE)/;

const walker = new TreeWalker( null, SHOW_TEXT|SHOW_ELEMENT, () => true );

/*
    Two purposes:

    1. Remove nodes we don't want, such as weird <o:p> tags, comment nodes
       and whitespace nodes.
    2. Convert inline tags into our preferred format.
*/
export function cleanTree ( node, preserveWS ) {
    let nonInlineParent = node;
    while ( isInline( nonInlineParent ) ) {
        nonInlineParent = nonInlineParent.parentNode;
    }
    walker.root = nonInlineParent;

    const children = node.childNodes;
    for ( let i = 0, l = children.length; i < l; i += 1 ) {
        let child = children[i];
        let { nodeName, nodeType } = child;
        const rewriter = stylesRewriters[ nodeName ];
        if ( nodeType === ELEMENT_NODE ) {
            const childLength = child.childNodes.length;
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
                let data = child.data;
                let sibling;
                const startsWithWS = !notWS.test( data.charAt( 0 ) );
                const endsWithWS = !notWS.test( data.charAt(
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

export function removeEmptyInlines ( node ) {
    const children = node.childNodes;
    let l = children.length;
    while ( l-- ) {
        const child = children[l];
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
    let block = br.parentNode;
    while ( isInline( block ) ) {
        block = block.parentNode;
    }
    const walker = new TreeWalker(
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
export function cleanupBRs ( node, root, keepForBlankLine ) {
    const brs = node.querySelectorAll( 'BR' );
    const brBreaksLine = [];
    let l = brs.length;

    // Must calculate whether the <br> breaks a line first, because if we
    // have two <br>s next to each other, after the first one is converted
    // to a block split, the second will be at the end of a block and
    // therefore seem to not be a line break. But in its original context it
    // was, so we should also convert it to a block split.
    for ( let i = 0; i < l; i += 1 ) {
        brBreaksLine[i] = isLineBreak( brs[i], keepForBlankLine );
    }
    while ( l-- ) {
        const br = brs[l];
        // Cleanup may have removed it
        const parent = br.parentNode;
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
