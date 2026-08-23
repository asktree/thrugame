/*
 * GREAT WORK! — machine codec v1
 *
 * The canonical serialization of a submission: the exact bytes a player will
 * one day put in calldata, and the share-string the editor emits today.
 *
 * Layout (all integers are LEB128 varints unless noted):
 *   u8       version (1)
 *   varint   arm count
 *   per arm, in submission order (order is the tiebreak identity — it is preserved):
 *     u8     flags: bits 0-1 gripper code (0,1,2,3 -> 1,2,3,6 grippers)
 *                   bits 2-3 length-1 (0..2)
 *                   bit  4   mounted on an elbow
 *     mount: elbow -> varint parent index (must precede this arm), varint at (1..len of parent)
 *            ground -> zigzag varint q, zigzag varint r
 *     u8     initial angle (0..5)
 *     varint delay block count
 *     varint tape length
 *     tape   ops packed 3 bits each (G D ↻ ↺ ↷ ↶ · -> 0..6), little-endian within bytes
 *
 * Share strings are base64url of those bytes. Arm ids are not serialized —
 * they are labels, not identity; decode regenerates them as a0, a1, …
 *
 * Version 2 appends the rest of the board — the player places everything:
 *   varint  glyph count;   per glyph:   u8 type (see GLYPH_TYPES), zigzag q, zigzag r, u8 rot
 *   varint  reagent count; per reagent: varint shape index, zigzag q, zigzag r, u8 rot
 *   u8      product present (0/1);  if 1: zigzag q, zigzag r, u8 rot
 * Glyph shapes are canonical (see SPEC §3), so a placement is fully described
 * by its anchor cell and rotation. Reagent/product placements reference the
 * puzzle's molecule shapes by index — the shapes themselves are the puzzle's,
 * so a solution can never alter what is being asked for.
 */
(function (root) {
  'use strict';

  const OPS = 'GD+-PQW';                       // 3-bit opcodes, in this order
  const GRIPS = [1, 2, 3, 6];
  const GLYPH_TYPES = ['bonders', 'debonders', 'calcifiers', 'duplicators',
    'projectors', 'purifiers', 'animismus', 'disposals'];
  const VERSION = 2;

  function zigzag(n) { return n < 0 ? -2 * n - 1 : 2 * n; }
  function unzigzag(n) { return n & 1 ? -(n + 1) / 2 : n / 2; }

  function encodeMachine(machine) {
    const out = [];
    const push = (b) => out.push(b & 0xff);
    const varint = (n) => { do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; push(b); } while (n); };
    const arms = machine.arms;
    const index = new Map(arms.map((a, i) => [a.id, i]));
    const hasLayout = machine.glyphs || machine.inputs || machine.output;

    push(hasLayout ? VERSION : 1);
    varint(arms.length);
    arms.forEach((a, i) => {
      const grip = GRIPS.indexOf(a.grippers || 1);
      const len = (a.len || 1) - 1;
      if (grip < 0) throw new Error('codec: bad gripper count');
      if (len < 0 || len > 2) throw new Error('codec: bad length');
      const elbow = a.mount.elbow;
      push(grip | (len << 2) | (elbow ? 16 : 0));
      if (elbow) {
        const p = index.get(elbow.parent);
        if (p === undefined || p >= i) throw new Error('codec: elbow parent must precede its child');
        varint(p); varint(elbow.at);
      } else {
        varint(zigzag(a.mount.ground[0])); varint(zigzag(a.mount.ground[1]));
      }
      push(((a.angle || 0) % 6 + 6) % 6);
      const tape = a.tape || {};
      const ops = tape.ops || ['W'];
      varint(tape.delay || 0);
      varint(ops.length);
      let acc = 0, bits = 0;
      for (const op of ops) {
        const code = OPS.indexOf(op);
        if (code < 0) throw new Error('codec: bad op ' + op);
        acc |= code << bits; bits += 3;
        while (bits >= 8) { push(acc); acc >>>= 8; bits -= 8; }
      }
      if (bits) push(acc);
    });
    if (hasLayout) {
      const glyphs = machine.glyphs || [];
      varint(glyphs.length);
      for (const g of glyphs) {
        const t = GLYPH_TYPES.indexOf(g.type);
        if (t < 0) throw new Error('codec: bad glyph type ' + g.type);
        push(t); varint(zigzag(g.at[0])); varint(zigzag(g.at[1])); push(((g.rot || 0) % 6 + 6) % 6);
      }
      const inputs = machine.inputs || [];
      varint(inputs.length);
      for (const g of inputs) {
        varint(g.ri || 0); varint(zigzag(g.at[0])); varint(zigzag(g.at[1])); push(((g.rot || 0) % 6 + 6) % 6);
      }
      if (machine.output) {
        push(1); varint(zigzag(machine.output.at[0])); varint(zigzag(machine.output.at[1]));
        push(((machine.output.rot || 0) % 6 + 6) % 6);
      } else push(0);
    }
    return Uint8Array.from(out);
  }

  function decodeMachine(bytes) {
    let p = 0;
    const u8 = () => { if (p >= bytes.length) throw new Error('codec: truncated'); return bytes[p++]; };
    const varint = () => {
      let n = 0, shift = 0, b;
      do { b = u8(); n |= (b & 0x7f) << shift; shift += 7; } while (b & 0x80);
      return n >>> 0;
    };
    const version = u8();
    if (version !== 1 && version !== VERSION) throw new Error('codec: unknown version');
    const count = varint();
    const arms = [];
    for (let i = 0; i < count; i++) {
      const flags = u8();
      const grippers = GRIPS[flags & 3];
      const len = ((flags >> 2) & 3) + 1;
      if (len > 3) throw new Error('codec: bad length');
      let mount;
      if (flags & 16) {
        const parent = varint(), at = varint();
        if (parent >= i) throw new Error('codec: elbow parent must precede its child');
        mount = { elbow: { parent: 'a' + parent, at } };
      } else {
        const q = unzigzag(varint()), r = unzigzag(varint());
        mount = { ground: [q, r] };
      }
      const angle = u8();
      if (angle > 5) throw new Error('codec: bad angle');
      const delay = varint();
      const opsLen = varint();
      const ops = [];
      let acc = 0, bits = 0;
      for (let k = 0; k < opsLen; k++) {
        if (bits < 3) { acc |= u8() << bits; bits += 8; }
        const code = acc & 7; acc >>>= 3; bits -= 3;
        if (code > 6) throw new Error('codec: bad opcode');
        ops.push(OPS[code]);
      }
      arms.push({ id: 'a' + i, grippers, len, mount, angle, tape: { delay, ops } });
    }
    const out = { arms };
    if (version >= 2) {
      const zz = () => unzigzag(varint());
      const rot = () => { const r = u8(); if (r > 5) throw new Error('codec: bad rotation'); return r; };
      out.glyphs = [];
      for (let n = varint(); n > 0; n--) {
        const t = u8();
        if (t >= GLYPH_TYPES.length) throw new Error('codec: bad glyph type');
        out.glyphs.push({ type: GLYPH_TYPES[t], at: [zz(), zz()], rot: rot() });
      }
      out.inputs = [];
      for (let n = varint(); n > 0; n--) out.inputs.push({ ri: varint(), at: [zz(), zz()], rot: rot() });
      if (u8()) out.output = { at: [zz(), zz()], rot: rot() };
    }
    if (p !== bytes.length) throw new Error('codec: trailing bytes');
    return out;
  }

  // -- base64url share strings --
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  function toString(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 3) {
      const a = bytes[i], b = i + 1 < bytes.length ? bytes[i + 1] : 0, c = i + 2 < bytes.length ? bytes[i + 2] : 0;
      s += B64[a >> 2] + B64[((a & 3) << 4) | (b >> 4)];
      if (i + 1 < bytes.length) s += B64[((b & 15) << 2) | (c >> 6)];
      if (i + 2 < bytes.length) s += B64[c & 63];
    }
    return s;
  }
  function fromString(s) {
    const val = (ch) => { const v = B64.indexOf(ch); if (v < 0) throw new Error('codec: bad character'); return v; };
    const out = [];
    for (let i = 0; i < s.length; i += 4) {
      const chunk = s.slice(i, i + 4);
      if (chunk.length === 1) throw new Error('codec: bad string length');
      const a = val(chunk[0]), b = val(chunk[1]);
      out.push((a << 2) | (b >> 4));
      if (chunk.length > 2) { const c = val(chunk[2]); out.push(((b & 15) << 4) | (c >> 2));
        if (chunk.length > 3) { const d = val(chunk[3]); out.push(((c & 3) << 6) | d); } }
    }
    return Uint8Array.from(out);
  }

  const encodeString = (machine) => toString(encodeMachine(machine));
  const decodeString = (s) => decodeMachine(fromString(s));

  const CODEC = { encodeMachine, decodeMachine, toString, fromString, encodeString, decodeString, VERSION, GLYPH_TYPES };
  if (typeof module !== 'undefined' && module.exports) module.exports = CODEC;
  else root.GWCodec = CODEC;
})(typeof self !== 'undefined' ? self : this);
