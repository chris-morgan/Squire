/*
    Native TreeWalker is buggy in IE and Opera:
    * IE9/10 sometimes throw errors when calling TreeWalker#nextNode or
      TreeWalker#previousNode. No way to feature detect this.
    * Some versions of Opera have a bug in TreeWalker#previousNode which makes
      it skip to the wrong node.

    Rather than risk further bugs, it's easiest just to implement our own
    (subset) of the spec in all browsers.
*/

const typeToBitArray = {
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

export default class TreeWalker {
    constructor( root, nodeType, filter ) {
        this.root = this.currentNode = root;
        this.nodeType = nodeType;
        this.filter = filter;
    }

    nextNode() {
        let { currentNode } = this;
        const { root, nodeType, filter } = this;
        while ( true ) {
            let node = currentNode.firstChild;
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
                this.currentNode = node;
                return node;
            }
            currentNode = node;
        }
    }

    previousNode() {
        let { currentNode } = this;
        const { root, nodeType, filter } = this;
        while ( true ) {
            if ( currentNode === root ) {
                return null;
            }
            let node = currentNode.previousSibling;
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
                this.currentNode = node;
                return node;
            }
            currentNode = node;
        }
    }

    // Previous node in post-order.
    previousPONode() {
        let { currentNode } = this;
        const { root, nodeType, filter } = this;
        while ( true ) {
            let node = currentNode.lastChild;
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
                this.currentNode = node;
                return node;
            }
            currentNode = node;
        }
    }
}
