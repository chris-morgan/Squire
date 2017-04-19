import buble from 'rollup-plugin-buble';

export default {
    format: 'iife',
    moduleName: 'Squire',
    plugins: [buble()],
    entry: 'source/squire.js',
    dest: 'build/squire-raw.js',
};
