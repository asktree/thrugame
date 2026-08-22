/* Builds demo/lab.html: inlines the reference engine + examples into the lab template. */
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

const engine = fs.readFileSync(path.join(root, 'engine/engine.js'), 'utf8');
const examples = fs.readFileSync(path.join(root, 'engine/examples.js'), 'utf8');
let tpl = fs.readFileSync(path.join(__dirname, 'template.html'), 'utf8');

tpl = tpl.replace('/*__ENGINE__*/', () => engine);
tpl = tpl.replace('/*__EXAMPLES__*/', () => examples);

fs.writeFileSync(path.join(root, 'demo/lab.html'), tpl);
console.log('built demo/lab.html (' + tpl.length + ' bytes)');
