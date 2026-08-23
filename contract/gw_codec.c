/* Machine codec — transliterated from engine/codec.js (FORMAT.md).
 * v1: arms only. v2: arms + glyph/reagent/product placements. */
#include "gw.h"

static const uint8_t GRIPS[4] = { 1, 2, 3, 6 };

typedef struct { const uint8_t *p; uint32_t len, pos; int err; } rd_t;

static uint8_t rd_u8(rd_t *r) {
  if (r->pos >= r->len) { r->err = 1; return 0; }
  return r->p[r->pos++];
}
static uint32_t rd_varint(rd_t *r) {
  uint32_t n = 0; int shift = 0; uint8_t b;
  do {
    b = rd_u8(r);
    if (r->err || shift > 28) { r->err = 1; return 0; }
    n |= (uint32_t)(b & 0x7f) << shift; shift += 7;
  } while (b & 0x80);
  return n;
}
static int32_t unzigzag(uint32_t n) {
  return (n & 1) ? -(int32_t)((n + 1) / 2) : (int32_t)(n / 2);
}

int gw_decode_machine(const uint8_t *bytes, uint32_t len, gw_machine_t *out) {
  rd_t r = { bytes, len, 0, 0 };
  for (uint32_t i = 0; i < sizeof(*out); i++) ((uint8_t *)out)[i] = 0;

  uint8_t version = rd_u8(&r);
  if (r.err || (version != 1 && version != 2)) return GW_ERR_DECODE;
  out->version = version;

  uint32_t count = rd_varint(&r);
  if (r.err) return GW_ERR_DECODE;
  if (count > GW_MAX_ARMS) return GW_ERR_CAPACITY;
  out->narms = (uint8_t)count;

  for (uint32_t i = 0; i < count; i++) {
    gw_arm_def_t *a = &out->arms[i];
    uint8_t flags = rd_u8(&r);
    if (r.err) return GW_ERR_DECODE;
    a->grippers = GRIPS[flags & 3];
    a->len = (uint8_t)(((flags >> 2) & 3) + 1);
    if (a->len > 3) return GW_ERR_DECODE;
    if (flags & 16) {
      uint32_t parent = rd_varint(&r), at = rd_varint(&r);
      if (r.err || parent >= i) return GW_ERR_DECODE;
      a->is_elbow = 1; a->parent = (uint8_t)parent;
      if (at > 255) return GW_ERR_DECODE;
      a->at = (uint8_t)at;
    } else {
      a->gq = unzigzag(rd_varint(&r));
      a->gr = unzigzag(rd_varint(&r));
      if (r.err) return GW_ERR_DECODE;
    }
    uint8_t angle = rd_u8(&r);
    if (r.err || angle > 5) return GW_ERR_DECODE;
    a->angle = angle;
    a->delay = rd_varint(&r);
    uint32_t ops_len = rd_varint(&r);
    if (r.err) return GW_ERR_DECODE;
    if (ops_len > GW_MAX_TAPE) return GW_ERR_CAPACITY;
    a->ntape = (uint8_t)ops_len;
    uint32_t acc = 0; int bits = 0;
    for (uint32_t k = 0; k < ops_len; k++) {
      if (bits < 3) { acc |= (uint32_t)rd_u8(&r) << bits; bits += 8; }
      if (r.err) return GW_ERR_DECODE;
      uint8_t code = acc & 7; acc >>= 3; bits -= 3;
      if (code > 6) return GW_ERR_DECODE;
      a->ops[k] = code;
    }
  }

  if (version >= 2) {
    uint32_t n = rd_varint(&r);
    if (r.err || n > 16) return r.err ? GW_ERR_DECODE : GW_ERR_CAPACITY;
    out->nglyphs = (uint8_t)n;
    for (uint32_t i = 0; i < n; i++) {
      uint8_t t = rd_u8(&r);
      if (r.err || t >= 8) return GW_ERR_DECODE;
      out->glyphs[i].type = t;
      out->glyphs[i].q = unzigzag(rd_varint(&r));
      out->glyphs[i].r = unzigzag(rd_varint(&r));
      uint8_t rot = rd_u8(&r);
      if (r.err || rot > 5) return GW_ERR_DECODE;
      out->glyphs[i].rot = rot;
    }
    n = rd_varint(&r);
    if (r.err || n > GW_MAX_SHAPES) return r.err ? GW_ERR_DECODE : GW_ERR_CAPACITY;
    out->ninputs = (uint8_t)n;
    for (uint32_t i = 0; i < n; i++) {
      out->inputs[i].ri = rd_varint(&r);
      out->inputs[i].q = unzigzag(rd_varint(&r));
      out->inputs[i].r = unzigzag(rd_varint(&r));
      uint8_t rot = rd_u8(&r);
      if (r.err || rot > 5) return GW_ERR_DECODE;
      out->inputs[i].rot = rot;
    }
    uint8_t present = rd_u8(&r);
    if (r.err) return GW_ERR_DECODE;
    if (present) {
      out->has_output = 1;
      out->out_q = unzigzag(rd_varint(&r));
      out->out_r = unzigzag(rd_varint(&r));
      uint8_t rot = rd_u8(&r);
      if (r.err || rot > 5) return GW_ERR_DECODE;
      out->out_rot = rot;
    }
  }

  if (r.err || r.pos != r.len) return GW_ERR_DECODE;  /* trailing bytes */
  return GW_OK;
}

/* ---- encode ---- */
typedef struct { uint8_t *p; uint32_t cap, pos; int err; } wr_t;

static void wr_u8(wr_t *w, uint8_t b) {
  if (w->pos >= w->cap) { w->err = 1; return; }
  w->p[w->pos++] = b;
}
static void wr_varint(wr_t *w, uint32_t n) {
  do {
    uint8_t b = n & 0x7f; n >>= 7;
    if (n) b |= 0x80;
    wr_u8(w, b);
  } while (n && !w->err);
}
static uint32_t zigzag(int32_t n) {
  return n < 0 ? (uint32_t)(-2 * (int64_t)n - 1) : (uint32_t)(2 * (int64_t)n);
}

int32_t gw_encode_machine(const gw_machine_t *m, uint8_t *buf, uint32_t cap) {
  wr_t w = { buf, cap, 0, 0 };
  wr_u8(&w, m->version);
  wr_varint(&w, m->narms);
  for (uint32_t i = 0; i < m->narms; i++) {
    const gw_arm_def_t *a = &m->arms[i];
    int grip = -1;
    for (int g = 0; g < 4; g++) if (GRIPS[g] == a->grippers) grip = g;
    if (grip < 0 || a->len < 1 || a->len > 3) return -1;
    wr_u8(&w, (uint8_t)(grip | ((a->len - 1) << 2) | (a->is_elbow ? 16 : 0)));
    if (a->is_elbow) {
      if (a->parent >= i) return -1;
      wr_varint(&w, a->parent); wr_varint(&w, a->at);
    } else {
      wr_varint(&w, zigzag(a->gq)); wr_varint(&w, zigzag(a->gr));
    }
    wr_u8(&w, a->angle % 6);
    wr_varint(&w, a->delay);
    wr_varint(&w, a->ntape);
    uint32_t acc = 0; int bits = 0;
    for (uint32_t k = 0; k < a->ntape; k++) {
      if (a->ops[k] > 6) return -1;
      acc |= (uint32_t)a->ops[k] << bits; bits += 3;
      while (bits >= 8) { wr_u8(&w, acc & 0xff); acc >>= 8; bits -= 8; }
    }
    if (bits) wr_u8(&w, acc & 0xff);
  }
  if (m->version >= 2) {
    wr_varint(&w, m->nglyphs);
    for (uint32_t i = 0; i < m->nglyphs; i++) {
      wr_u8(&w, m->glyphs[i].type);
      wr_varint(&w, zigzag(m->glyphs[i].q)); wr_varint(&w, zigzag(m->glyphs[i].r));
      wr_u8(&w, m->glyphs[i].rot % 6);
    }
    wr_varint(&w, m->ninputs);
    for (uint32_t i = 0; i < m->ninputs; i++) {
      wr_varint(&w, m->inputs[i].ri);
      wr_varint(&w, zigzag(m->inputs[i].q)); wr_varint(&w, zigzag(m->inputs[i].r));
      wr_u8(&w, m->inputs[i].rot % 6);
    }
    if (m->has_output) {
      wr_u8(&w, 1);
      wr_varint(&w, zigzag(m->out_q)); wr_varint(&w, zigzag(m->out_r));
      wr_u8(&w, m->out_rot % 6);
    } else {
      wr_u8(&w, 0);
    }
  }
  return w.err ? -1 : (int32_t)w.pos;
}
