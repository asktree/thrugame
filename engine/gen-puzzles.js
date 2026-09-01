/*
 * GREAT WORK! — on-chain puzzle catalog generator
 *
 * Emits contract/puzzles.h from engine/examples.js. A puzzle is a PRODUCT
 * (examples.js PRODUCTS, in order): its reagent shapes, product shape and caps
 * come from the first example that makes it; the index in that list is the
 * PUZZLE ID a submission names in instruction data (see contract/program).
 * The examples themselves are just solutions of their puzzle. Shapes are stored relative to
 * their first cell — the editor's normalizeMol — because a codec v2 machine
 * places each one by anchor + rotation. Regenerate after any change to
 * examples.js; the conformance generator (gen-vectors.js) imports this module
 * so the submission vectors and the catalog can never disagree.
 */
'use strict';
const path = require('path');
const fs = require('fs');
const GW = require(path.join(__dirname, 'engine.js'));
const CODEC = require(path.join(__dirname, 'codec.js'));
const EXAMPLES = require(path.join(__dirname, 'examples.js'));

const ELEMS = ['Sa', 'Ai', 'Ea', 'Fi', 'Wa', 'Hg', 'Pb', 'Sn', 'Fe', 'Cu', 'Ag', 'Au', 'Vi', 'Mo'];
const elemCode = (e) => {
  const i = ELEMS.indexOf(e);
  if (i < 0) throw new Error('unknown element ' + e);
  return i;
};
const SINGLE_CELL = { calcifiers: 1, disposals: 1 };
const eq = (a, b) => a[0] === b[0] && a[1] === b[1];
const addc = (a, b) => [a[0] + b[0], a[1] + b[1]];
const subc = (a, b) => [a[0] - b[0], a[1] - b[1]];
const mod6 = (n) => ((n % 6) + 6) % 6;

// -- the editor's derivations, verbatim in spirit (lab/editor-template.html) --
function normalizeMol(g) {
  const cells = g.cell ? [g.cell] : g.cells;
  const elems = g.cell ? [g.elem] : g.elems;
  return { rel: cells.map(c => subc(c, cells[0])), elems: elems.slice(), bonds: (g.bonds || []).map(b => b.slice()) };
}
function decomposeGlyphs(pz) {
  const out = [];
  for (const type of CODEC.GLYPH_TYPES) {
    for (const g of (pz[type] || [])) {
      const cells = Array.isArray(g[0]) ? g : [g];
      const rot = cells.length > 1 ? GW.DIRS.findIndex(d => eq(d, subc(cells[1], cells[0]))) : 0;
      out.push({ type, at: cells[0].slice(), rot: Math.max(0, rot) });
    }
  }
  return out;
}
function glyphCells(g) {
  const a = g.at, k = g.rot || 0;
  if (SINGLE_CELL[g.type]) return [a];
  const c = [a, addc(a, GW.DIRS[k])];
  if (g.type === 'purifiers' || g.type === 'animismus') c.push(addc(a, GW.DIRS[mod6(k + 1)]));
  if (g.type === 'animismus') c.push(addc(a, GW.DIRS[mod6(k + 5)]));
  return c;
}
const molCells = (shape, at, rot) => shape.rel.map(rc => addc(at, GW.rotK(rc, rot || 0)));

// the puzzle a layout describes — the editor's matPuzzle, on a catalog entry
function materialize(pz, machine) {
  const out = { caps: Object.assign({}, pz.caps) };
  for (const g of machine.glyphs) {
    const cells = glyphCells(g);
    (out[g.type] = out[g.type] || []).push(SINGLE_CELL[g.type] ? cells[0] : cells);
  }
  out.inputs = machine.inputs.map(g => {
    const sh = pz.reagents[g.ri];
    return { cells: molCells(sh, g.at, g.rot), elems: sh.elems.slice(), bonds: sh.bonds.map(b => b.slice()) };
  });
  out.output = { cells: molCells(pz.product, machine.output.at, machine.output.rot),
    elems: pz.product.elems.slice(), bonds: pz.product.bonds.map(b => b.slice()) };
  return out;
}

// Where does a catalog shape sit on an example's board? Search anchor cell and
// rotation until the placed shape reproduces the example's molecule exactly —
// cells, elements and bonds — so examples that build the same product from a
// differently ordered or rotated molecule still resolve to one catalog entry.
function placeOn(shape, mol) {
  const cells = mol.cell ? [mol.cell] : mol.cells;
  const elems = mol.cell ? [mol.elem] : mol.elems;
  const bonds = (mol.bonds || []).map(b => b[0] < b[1] ? b[0] + ':' + b[1] : b[1] + ':' + b[0]);
  if (cells.length !== shape.rel.length || bonds.length !== shape.bonds.length) return null;
  const key = (c) => c[0] + ',' + c[1];
  const index = new Map(cells.map((c, i) => [key(c), i]));
  for (let k = 0; k < 6; k++) {
    for (const anchor of cells) {
      const placed = molCells(shape, anchor, k);
      const map = placed.map(c => index.get(key(c)));
      if (map.some(i => i === undefined) || new Set(map).size !== map.length) continue;
      if (shape.elems.some((e, i) => elems[map[i]] !== e)) continue;
      const mapped = shape.bonds.map(([a, b]) => { const x = map[a], y = map[b]; return x < y ? x + ':' + y : y + ':' + x; });
      if (mapped.sort().join('|') !== bonds.slice().sort().join('|')) continue;
      return { at: anchor.slice(), rot: k };
    }
  }
  return null;
}

function puzzles() {
  return EXAMPLES.catalog().map((c) => {
    const first = c.examples[0].puzzle;
    const reagents = (first.inputs || []).map(normalizeMol);
    const product = normalizeMol(first.output);
    return {
      id: c.id, key: c.key, name: c.name, blurb: c.blurb,
      caps: Object.assign({}, GW.DEFAULT_CAPS, first.caps || {}),
      reagents, product,
      // every example that makes this product, as a codec v2 layout: its board
      // decomposed into placements of the CATALOG shapes, its arms as authored
      examples: c.examples.map(ex => {
        const pz = ex.puzzle;
        const used = new Set();
        const inputs = (pz.inputs || []).map(mol => {
          for (let ri = 0; ri < reagents.length; ri++) {
            if (used.has(ri)) continue;
            const at = placeOn(reagents[ri], mol);
            if (at) { used.add(ri); return { ri, at: at.at, rot: at.rot }; }
          }
          throw new Error(ex.key + ': a reagent is not one of ' + c.key + "'s");
        });
        if (new Set(inputs.map(g => g.ri)).size !== reagents.length) throw new Error(ex.key + ': reagent set differs from ' + c.key);
        const output = placeOn(product, pz.output);
        if (!output) throw new Error(ex.key + ': product is not ' + c.name);
        return {
          key: ex.key, name: ex.name, blurb: ex.blurb, expect: ex.expect || {},
          layout: { glyphs: decomposeGlyphs(pz), inputs, output },
          arms: ex.machine.arms,
        };
      }),
    };
  });
}

// -- C emission --
const cell = (c) => `{${c[0]},${c[1]}}`;
function shapeLit(sh) {
  if (sh.rel.length > 16 || sh.bonds.length > 32) throw new Error('shape too big for gw_shape_t');
  return `{${sh.rel.length},{${sh.rel.map(cell).join(',')}},{${sh.elems.map(elemCode).join(',')}},` +
    `${sh.bonds.length},{${sh.bonds.map(b => `{${b[0]},${b[1]}}`).join(',') || '{0,0}'}}}`;
}
function header() {
  const list = puzzles();
  const out = [];
  out.push('/* GENERATED by engine/gen-puzzles.js — do not edit. Regenerate after any change to examples.js. */');
  out.push('#ifndef GW_PUZZLES_H');
  out.push('#define GW_PUZZLES_H');
  out.push('#include "gw.h"');
  out.push('');
  out.push(`#define GW_NPUZZLES ${list.length}`);
  out.push('');
  out.push('/* puzzle id = index; shapes relative to their first cell */');
  out.push(`static const gw_puzzle_def_t GW_PUZZLES[GW_NPUZZLES] = {`);
  for (const p of list) {
    if (p.reagents.length > 8) throw new Error(p.key + ': too many reagents for gw_puzzle_def_t');
    const c = p.caps;
    out.push(`  /* ${p.id}: ${p.name} */`);
    out.push(`  { "${p.key}", ${p.reagents.length},`);
    out.push(`    {${p.reagents.map(shapeLit).join(',\n     ')}},`);
    out.push(`    ${shapeLit(p.product)},`);
    out.push(`    {${c.parts},${c.elbowDepth},${c.tapeLen},${c.atoms},${c.cycles},${c.goal}} },`);
  }
  out.push('};');
  out.push('');
  out.push('#endif /* GW_PUZZLES_H */');
  return out.join('\n') + '\n';
}

module.exports = { ELEMS, elemCode, puzzles, materialize, normalizeMol, decomposeGlyphs, glyphCells, molCells, placeOn, header };

if (require.main === module) {
  const dest = path.join(__dirname, '..', 'contract', 'puzzles.h');
  const text = header();
  fs.writeFileSync(dest, text);
  console.log('wrote', dest, text.length, 'bytes;', puzzles().length, 'puzzles');
}
