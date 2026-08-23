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
 */
(function (root) {
  'use strict';

  const OPS = 'GD+-PQW';                       // 3-bit opcodes, in this order
  const GRIPS = [1, 2, 3, 6];
  const VERSION = 1;

  function zigzag(n) { return n < 0 ? -2 * n - 1 : 2 * n; }
  function unzigzag(n) { return n & 1 ? -(n + 1) / 2 : n / 2; }

  function encodeMachine(machine) {
    const out = [];
    const push = (b) => out.push(b & 0xff);
    const varint = (n) => { do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; push(b); } while (n); };
    const arms = machine.arms;
    const index = new Map(arms.map((a, i) => [a.id, i]));

    push(VERSION);
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
    if (u8() !== VERSION) throw new Error('codec: unknown version');
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
    if (p !== bytes.length) throw new Error('codec: trailing bytes');
    return { arms };
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

  const CODEC = { encodeMachine, decodeMachine, toString, fromString, encodeString, decodeString, VERSION };
  if (typeof module !== 'undefined' && module.exports) module.exports = CODEC;
  else root.GWCodec = CODEC;
})(typeof self !== 'undefined' ? self : this);
