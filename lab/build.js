/* Builds demo/lab.html and demo/editor.html: inlines engine + codec + examples into the templates. */
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

const engine = fs.readFileSync(path.join(root, 'engine/engine.js'), 'utf8');
const codec = fs.readFileSync(path.join(root, 'engine/codec.js'), 'utf8');
const examples = fs.readFileSync(path.join(root, 'engine/examples.js'), 'utf8');

for (const [tplName, outName] of [['template.html', 'lab.html'], ['editor-template.html', 'editor.html']]) {
  let tpl = fs.readFileSync(path.join(__dirname, tplName), 'utf8');
  tpl = tpl.replace('/*__ENGINE__*/', () => engine);
  tpl = tpl.replace('/*__CODEC__*/', () => codec);
  tpl = tpl.replace('/*__EXAMPLES__*/', () => examples);
  fs.writeFileSync(path.join(root, 'demo', outName), tpl);
  console.log('built demo/' + outName + ' (' + tpl.length + ' bytes)');
}
