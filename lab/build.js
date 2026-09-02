/* Builds demo/editor.html: inlines engine + codec + examples + fx + the GIF encoder into the template. */
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

const engine = fs.readFileSync(path.join(root, 'engine/engine.js'), 'utf8');
const codec = fs.readFileSync(path.join(root, 'engine/codec.js'), 'utf8');
const examples = fs.readFileSync(path.join(root, 'engine/examples.js'), 'utf8');
const fx = fs.readFileSync(path.join(__dirname, 'fx.js'), 'utf8');
const gifenc = fs.readFileSync(path.join(__dirname, 'vendor', 'gifenc.js'), 'utf8');   // client/gif-entry.js via `npm run bundle:gif`

for (const [tplName, outName] of [['editor-template.html', 'editor.html']]) {
  let tpl = fs.readFileSync(path.join(__dirname, tplName), 'utf8');
  tpl = tpl.replace('/*__ENGINE__*/', () => engine);
  tpl = tpl.replace('/*__CODEC__*/', () => codec);
  tpl = tpl.replace('/*__EXAMPLES__*/', () => examples);
  tpl = tpl.replace('/*__FX__*/', () => fx);
  tpl = tpl.replace('/*__GIFENC__*/', () => gifenc);
  fs.writeFileSync(path.join(root, 'demo', outName), tpl);
  console.log('built demo/' + outName + ' (' + tpl.length + ' bytes)');
}
