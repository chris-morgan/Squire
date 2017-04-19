import {
    ELEMENT_NODE,
    TEXT_NODE,
    indexOf,
    END_TO_START,
    START_TO_END,
    START_TO_START,
    END_TO_END,
    SHOW_TEXT,
    SHOW_ELEMENT,
    notWS,
} from "./Constants.js";
import TreeWalker from "./TreeWalker.js";
import {
    getPreviousBlock, getNextBlock,
    getNearest,
    isOrContains,
    getLength,
    detach,
    fixCursor,
    split,
    mergeInlines,
    mergeWithBlock,
    mergeContainers,
    isInline, isContainer, isBlock, isLeaf,
} from "./Node.js";

export function getNodeBefore ( node, offset ) {
    let children = node.childNodes;
    while ( offset && node.nodeType === ELEMENT_NODE ) {
        node = children[ offset - 1 ];
        children = node.childNodes;
        offset = children.length;
    }
    return node;
}

export function getNodeAfter ( node, offset ) {
    if ( node.nodeType === ELEMENT_NODE ) {
        const children = node.childNodes;
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

export function insertNodeInRange ( range, node ) {
    // Insert at start.
    let { startContainer, startOffset, endContainer, endOffset } = range;
    let children;

    // If part way through a text node, split it.
    if ( startContainer.nodeType === TEXT_NODE ) {
        const parent = startContainer.parentNode;
        children = parent.childNodes;
        if ( startOffset === startContainer.length ) {
            startOffset = indexOf.call( children, startContainer ) + 1;
            if ( range.collapsed ) {
                endContainer = parent;
                endOffset = startOffset;
            }
        } else {
            if ( startOffset ) {
                const afterSplit = startContainer.splitText( startOffset );
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

    const childCount = children.length;

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

export function extractContentsOfRange ( range, common, root ) {
    let { startContainer, startOffset, endContainer, endOffset } = range;

    if ( !common ) {
        common = range.commonAncestorContainer;
    }

    if ( common.nodeType === TEXT_NODE ) {
        common = common.parentNode;
    }

    const endNode = split( endContainer, endOffset, common, root );
    let startNode = split( startContainer, startOffset, common, root );
    const frag = common.ownerDocument.createDocumentFragment();

    // End node will be null if at end of child nodes list.
    while ( startNode !== endNode ) {
        const next = startNode.nextSibling;
        frag.appendChild( startNode );
        startNode = next;
    }

    startContainer = common;
    startOffset = endNode ?
        indexOf.call( common.childNodes, endNode ) :
        common.childNodes.length;

    // Merge text nodes if adjacent. IE10 in particular will not focus
    // between two text nodes
    const after = common.childNodes[ startOffset ];
    const before = after && after.previousSibling;
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

export function deleteContentsOfRange ( range, root ) {
    const startBlock = getStartBlockOfRange( range, root );
    let endBlock = getEndBlockOfRange( range, root );
    let needsMerge = ( startBlock !== endBlock );

    // Move boundaries up as much as possible without exiting block,
    // to reduce need to split.
    moveRangeBoundariesDownTree( range );
    moveRangeBoundariesUpTree( range, startBlock, endBlock, root );

    // Remove selected range
    const frag = extractContentsOfRange( range, null, root );

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
    const child = root.firstChild;
    if ( !child || child.nodeName === 'BR' ) {
        fixCursor( root, root );
        range.selectNodeContents( root.firstChild );
    } else {
        range.collapse( true );
    }
    return frag;
}

// ---

export function insertTreeFragmentIntoRange ( range, frag, root ) {
    // Check if it's all inline content
    let allInline = true;
    const children = frag.childNodes;
    let l = children.length;
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
        const splitPoint = range.startContainer;
        let nodeAfterSplit = split(
                splitPoint,
                range.startOffset,
                getNearest( splitPoint.parentNode, root, 'BLOCKQUOTE' ) || root,
                root
            );
        let nodeBeforeSplit = nodeAfterSplit.previousSibling;
        let startContainer = nodeBeforeSplit;
        let startOffset = startContainer.childNodes.length;
        let endContainer = nodeAfterSplit;
        let endOffset = 0;
        let parent = nodeAfterSplit.parentNode;
        let child;

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
        const startAnchor = startContainer.childNodes[ startOffset ] || null;
        while ( ( child = frag.firstChild ) && isInline( child ) ) {
            startContainer.insertBefore( child, startAnchor );
        }
        while ( ( child = frag.lastChild ) && isInline( child ) ) {
            endContainer.insertBefore( child, endContainer.firstChild );
            endOffset += 1;
        }

        // 3. Fix cursor then insert block(s) in the fragment
        let node = frag;
        while ( node = getNextBlock( node, root ) ) {
            fixCursor( node, root );
        }
        parent.insertBefore( frag, nodeAfterSplit );

        // 4. Remove empty nodes created either side of split, then
        // merge containers at the edges.
        const next = nodeBeforeSplit.nextSibling;
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

        const prev = nodeAfterSplit.previousSibling;
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

export function isNodeContainedInRange ( range, node, partial ) {
    const nodeRange = node.ownerDocument.createRange();

    nodeRange.selectNode( node );

    if ( partial ) {
        // Node must not finish before range starts or start after range
        // finishes.
        const nodeEndBeforeStart = ( range.compareBoundaryPoints(
                END_TO_START, nodeRange ) > -1 );
        const nodeStartAfterEnd = ( range.compareBoundaryPoints(
                START_TO_END, nodeRange ) < 1 );
        return ( !nodeEndBeforeStart && !nodeStartAfterEnd );
    }
    else {
        // Node must start after range starts and finish before range
        // finishes
        const nodeStartAfterStart = ( range.compareBoundaryPoints(
                START_TO_START, nodeRange ) < 1 );
        const nodeEndBeforeEnd = ( range.compareBoundaryPoints(
                END_TO_END, nodeRange ) > -1 );
        return ( nodeStartAfterStart && nodeEndBeforeEnd );
    }
}

export function moveRangeBoundariesDownTree ( range ) {
    let { startContainer, startOffset, endContainer, endOffset } = range;
    let maySkipBR = true;
    let child;

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

export function moveRangeBoundariesUpTree ( range, startMax, endMax, root ) {
    let { startContainer, startOffset, endContainer, endOffset } = range;
    let maySkipBR = true;
    let parent;

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
export function getStartBlockOfRange ( range, root ) {
    const container = range.startContainer;
    let block;

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
export function getEndBlockOfRange ( range, root ) {
    const container = range.endContainer;
    let block;

    // If inline, get the containing block.
    if ( isInline( container ) ) {
        block = getPreviousBlock( container, root );
    } else if ( container !== root && isBlock( container ) ) {
        block = container;
    } else {
        block = getNodeAfter( container, range.endOffset );
        if ( !block || !isOrContains( root, block ) ) {
            block = root;
            let child;
            while ( child = block.lastChild ) {
                block = child;
            }
        }
        block = getPreviousBlock( block, root );
    }
    // Check the block actually intersects the range
    return block && isNodeContainedInRange( range, block, true ) ? block : null;
}

export const contentWalker = new TreeWalker( null,
    SHOW_TEXT|SHOW_ELEMENT,
    node => node.nodeType === TEXT_NODE ?
            notWS.test( node.data ) :
            node.nodeName === 'IMG'
);

export function rangeDoesStartAtBlockBoundary ( range, root ) {
    const { startContainer, startOffset } = range;
    let nodeAfterCursor;

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

export function rangeDoesEndAtBlockBoundary ( range, root ) {
    const { endContainer, endOffset } = range;

    // If in a text node with content, and not at the end, we're not
    // at the boundary
    contentWalker.root = null;
    if ( endContainer.nodeType === TEXT_NODE ) {
        const length = endContainer.data.length;
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

export function expandRangeToBlockBoundaries ( range, root ) {
    const start = getStartBlockOfRange( range, root );
    const end = getEndBlockOfRange( range, root );

    if ( start && end ) {
        let parent = start.parentNode;
        range.setStart( parent, indexOf.call( parent.childNodes, start ) );
        parent = end.parentNode;
        range.setEnd( parent, indexOf.call( parent.childNodes, end ) + 1 );
    }
}
