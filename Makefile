.PHONY: all clean

all: node_modules build build/squire.js build/document.html

node_modules: package.json yarn.lock
	yarn
	touch -c node_modules

clean:
	rm -rf build

build:
	mkdir -p build

build/squire-raw.js: node_modules source/squire.js source/Constants.js source/TreeWalker.js source/Node.js source/Range.js source/KeyHandlers.js source/Clean.js source/Clipboard.js source/Editor.js rollup.config.js | build
	yarn run rollup

build/squire.js: build/squire-raw.js
	yarn run uglify

build/document.html: source/document.html | build
	cp $^ $@
