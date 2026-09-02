/* GREAT WORK! — rules engine, C implementation.
 *
 * A line-faithful transliteration of engine/engine.js (the conformance
 * oracle). ORDER MATTERS: arm iteration order, atom array order (append,
 * stable compaction on kill), and the glyph-family pass order all feed the
 * conformance digest — deviating from the oracle's order is a consensus bug
 * even when the final metrics agree. */
#include "gw.h"

void gw_panic(void); /* host: abort(); chain: tsdk_revert. capacity bugs only */

/* ---- constants mirroring the oracle ---- */
static const uint8_t GRIP_NGRIPS[7] = { 0, 1, 2, 3, 0, 0, 6 };
static const uint8_t OFFSETS1[1] = { 0 };
static const uint8_t OFFSETS2[2] = { 0, 3 };
static const uint8_t OFFSETS3[3] = { 0, 2, 4 };
static const uint8_t OFFSETS6[6] = { 0, 1, 2, 3, 4, 5 };
static const uint8_t *offsets_of(uint8_t grippers) {
  switch (grippers) {
    case 1: return OFFSETS1;
    case 2: return OFFSETS2;
    case 3: return OFFSETS3;
    default: return OFFSETS6;
  }
}
static int64_t price_of(uint8_t grippers) {
  switch (grippers) {
    case 1: return 20;
    case 2: return 24;
    case 3: return 26;
    default: return 30;
  }
}
#define ELBOW_COST   10  /* mounting an arm on an arm */
#define GRABBER_COST 5   /* the grabber head's share of an arm's price */

static int32_t mod6(int32_t n) { return ((n % 6) + 6) % 6; }
static int32_t hexicab(int32_t q, int32_t r) {
  int32_t a = q < 0 ? -q : q, b = r < 0 ? -r : r, c = q + r < 0 ? -(q + r) : q + r;
  return a > b ? (a > c ? a : c) : (b > c ? b : c);
}

static int is_metal(uint8_t e) { return e >= GW_EL_PB && e <= GW_EL_AU; }
static int is_cardinal(uint8_t e) { return e >= GW_EL_AI && e <= GW_EL_WA; }

/* ---- area set (linear probe; keys stored +1 so 0 = empty) ---- */
static uint32_t cell_pack(int32_t q, int32_t r) {
  if (q < -2048 || q >= 2048 || r < -2048 || r >= 2048) gw_panic();
  return (uint32_t)(q + 2048) * 4096u + (uint32_t)(r + 2048);
}
static void area_add(gw_sim_t *S, int32_t q, int32_t r) {
  uint32_t key = cell_pack(q, r) + 1;
  uint32_t i = (key * 2654435761u) % GW_AREA_CAP;
  for (uint32_t n = 0; n < GW_AREA_CAP; n++, i = (i + 1) % GW_AREA_CAP) {
    if (S->area_keys[i] == key) return;
    if (S->area_keys[i] == 0) { S->area_keys[i] = key; S->area_count++; return; }
  }
  gw_panic();
}

/* ---- atoms & bonds ---- */
static int atom_slot_at(const gw_sim_t *S, int32_t q, int32_t r) {
  for (int i = 0; i < S->natoms; i++)
    if (S->atoms[i].q == q && S->atoms[i].r == r) return i;
  return -1;
}
static int atom_slot_by_id(const gw_sim_t *S, uint32_t id) {
  for (int i = 0; i < S->natoms; i++)
    if (S->atoms[i].id == id) return i;
  return -1;
}
static int bond_exists(const gw_sim_t *S, uint32_t a, uint32_t b) {
  for (int i = 0; i < S->nbonds; i++)
    if ((S->bonds[i].a == a && S->bonds[i].b == b) || (S->bonds[i].a == b && S->bonds[i].b == a))
      return 1;
  return 0;
}
static void bond_add(gw_sim_t *S, uint32_t a, uint32_t b) {
  if (bond_exists(S, a, b)) return;
  if (S->nbonds >= GW_MAX_BONDS) gw_panic();
  S->bonds[S->nbonds].a = a; S->bonds[S->nbonds].b = b; S->nbonds++;
}
static void bond_remove(gw_sim_t *S, uint32_t a, uint32_t b) {
  for (int i = 0; i < S->nbonds; i++)
    if ((S->bonds[i].a == a && S->bonds[i].b == b) || (S->bonds[i].a == b && S->bonds[i].b == a)) {
      S->bonds[i] = S->bonds[S->nbonds - 1]; S->nbonds--; return;
    }
}
static int bond_count_of(const gw_sim_t *S, uint32_t id) {
  int n = 0;
  for (int i = 0; i < S->nbonds; i++)
    if (S->bonds[i].a == id || S->bonds[i].b == id) n++;
  return n;
}
/* flood-fill the molecule containing slot `anchor` into mask; return atom count */
static int molecule_mask(const gw_sim_t *S, int anchor, uint8_t mask[GW_MAX_ATOMS]) {
  for (int i = 0; i < S->natoms; i++) mask[i] = 0;
  mask[anchor] = 1;
  int count = 1, changed = 1;
  while (changed) {
    changed = 0;
    for (int i = 0; i < S->nbonds; i++) {
      int sa = atom_slot_by_id(S, S->bonds[i].a), sb = atom_slot_by_id(S, S->bonds[i].b);
      if (sa < 0 || sb < 0) continue;
      if (mask[sa] && !mask[sb]) { mask[sb] = 1; count++; changed = 1; }
      else if (mask[sb] && !mask[sa]) { mask[sa] = 1; count++; changed = 1; }
    }
  }
  return count;
}

/* ---- exact kinematics ---- */
typedef struct { int32_t q, r; uint8_t rot; } pose_t;

static pose_t pose_guarded(gw_sim_t *S, int ai, uint32_t *guard) {
  pose_t out = { 0, 0, 0 };
  if (*guard & (1u << ai)) {
    if (S->fault_kind == GW_FAULT_NONE) { S->fault_kind = GW_FAULT_GRAB_CYCLE; S->fault_tick = S->tick; }
    return out;
  }
  *guard |= 1u << ai;
  gw_arm_t *arm = &S->arms[ai];
  if (arm->is_elbow) {
    pose_t pp = pose_guarded(S, arm->parent, guard);
    gw_arm_t *p = &S->arms[arm->parent];
    int32_t pd = mod6(pp.rot + p->angle);
    out.q = pp.q + GW_DIRS[pd][0] * arm->at;
    out.r = pp.r + GW_DIRS[pd][1] * arm->at;
    out.rot = (uint8_t)pd;
    return out;
  }
  if (arm->ncarriers) {
    int hi = arm->carriers[0].arm, grip = arm->carriers[0].grip;
    pose_t hp = pose_guarded(S, hi, guard);
    gw_arm_t *h = &S->arms[hi];
    int32_t hd = mod6(hp.rot + h->angle + offsets_of(h->grippers)[grip]);
    out.q = hp.q + GW_DIRS[hd][0] * h->len;
    out.r = hp.r + GW_DIRS[hd][1] * h->len;
    out.rot = (uint8_t)mod6(hd + arm->carry_rel);
    return out;
  }
  out.q = arm->base_q; out.r = arm->base_r; out.rot = arm->base_rot;
  return out;
}
static pose_t pose_of(gw_sim_t *S, int ai) {
  uint32_t guard = 0;
  return pose_guarded(S, ai, &guard);
}
static void hand_cell(gw_sim_t *S, int ai, int gi, int32_t *q, int32_t *r, int32_t *dir) {
  gw_arm_t *arm = &S->arms[ai];
  pose_t p = pose_of(S, ai);
  int32_t hd = mod6(p.rot + arm->angle + offsets_of(arm->grippers)[gi]);
  *q = p.q + GW_DIRS[hd][0] * arm->len;
  *r = p.r + GW_DIRS[hd][1] * arm->len;
  *dir = hd;
}
/* first non-elbow arm posed at (q,r), else -1 */
static int ground_arm_at(gw_sim_t *S, int32_t q, int32_t r) {
  for (int i = 0; i < S->narms; i++) {
    if (S->arms[i].is_elbow) continue;
    pose_t p = pose_of(S, i);
    if (p.q == q && p.r == r) return i;
  }
  return -1;
}
/* every arm whose motion carries `ai`: elbow parents + carriers, transitively */
static uint32_t support_chain(gw_sim_t *S, int ai) {
  uint32_t out = 1u << ai;
  int changed = 1;
  while (changed) {
    changed = 0;
    for (int i = 0; i < S->narms; i++) {
      if (!(out & (1u << i))) continue;
      gw_arm_t *a = &S->arms[i];
      if (a->is_elbow && !(out & (1u << a->parent))) { out |= 1u << a->parent; changed = 1; }
      for (int c = 0; c < a->ncarriers; c++)
        if (!(out & (1u << a->carriers[c].arm))) { out |= 1u << a->carriers[c].arm; changed = 1; }
    }
  }
  return out;
}

/* ---- cached motion for the sweep ---- */
typedef struct {
  uint8_t angle0[GW_MAX_ARMS];
  int8_t  delta[GW_MAX_ARMS];
  int8_t  pivot[GW_MAX_ARMS];
  uint8_t carry_rel0[GW_MAX_ARMS];
  int32_t base_q0[GW_MAX_ARMS], base_r0[GW_MAX_ARMS];
  uint8_t base_rot0[GW_MAX_ARMS];
  uint8_t ncarriers0[GW_MAX_ARMS];
  struct { uint8_t arm, grip; } carriers0[GW_MAX_ARMS][GW_MAX_CARRIERS];
  uint16_t natoms;
  struct {
    uint32_t id; uint8_t elem;
    int32_t q0, r0;
    int8_t holder_arm;      /* -1 = free */
    int8_t holder_grip, s;
  } atoms[GW_MAX_ATOMS];
} motion_t;

/* step scratch, carved from S->scratch (see gw.h): never static, never on the stack */
typedef struct { uint8_t kind; uint32_t id; int64_t x, y; } obj_t;
typedef struct {
  uint32_t keys[GW_AREA_CAP];             /* init: layout claim set */
  motion_t M;
  obj_t    objs[GW_MAX_ATOMS + GW_MAX_ARMS];
  uint8_t  mol_mask_buf[GW_MAX_ATOMS];
  uint8_t  killed[GW_MAX_ATOMS];
} scratch_t;
_Static_assert(sizeof(scratch_t) <= sizeof(((gw_sim_t *)0)->scratch), "gw_sim_t.scratch too small");
static scratch_t *scratch_of(gw_sim_t *S) { uintptr_t p = (uintptr_t)S->scratch; return (scratch_t *)p; }

typedef struct { int64_t x, y; int32_t rot_u; } poseq_t;

/* deterministic fractional kinematics at sweep angle u (0..GW_ANG_DIR), Q16.16 px */
static poseq_t pose_q(gw_sim_t *S, int ai, int32_t u, const motion_t *M) {
  gw_arm_t *arm = &S->arms[ai];
  poseq_t out;
  if (arm->is_elbow) {
    poseq_t pp = pose_q(S, arm->parent, u, M);
    int32_t du = pp.rot_u + GW_ANG_DIR * M->angle0[arm->parent] + M->delta[arm->parent] * u;
    int64_t vx, vy;
    gw_step_q(arm->at, du, &vx, &vy);
    out.x = pp.x + vx; out.y = pp.y + vy; out.rot_u = du;
    return out;
  }
  if (M->ncarriers0[ai]) {
    int hi = M->carriers0[ai][0].arm, grip = M->carriers0[ai][0].grip;
    gw_arm_t *h = &S->arms[hi];
    poseq_t hp = pose_q(S, hi, u, M);
    int32_t hdu = hp.rot_u + GW_ANG_DIR * (M->angle0[hi] + offsets_of(h->grippers)[grip]) + M->delta[hi] * u;
    int64_t vx, vy;
    gw_step_q(h->len, hdu, &vx, &vy);
    out.x = hp.x + vx; out.y = hp.y + vy;
    out.rot_u = hdu + GW_ANG_DIR * M->carry_rel0[ai] + M->pivot[hi] * u;
    return out;
  }
  gw_to_px(M->base_q0[ai], M->base_r0[ai], &out.x, &out.y);
  out.rot_u = GW_ANG_DIR * M->base_rot0[ai];
  return out;
}
static void hand_q(gw_sim_t *S, int ai, int gi, int32_t u, const motion_t *M,
                   int64_t *x, int64_t *y, int32_t *du) {
  gw_arm_t *arm = &S->arms[ai];
  poseq_t p = pose_q(S, ai, u, M);
  int32_t d = p.rot_u + GW_ANG_DIR * (M->angle0[ai] + offsets_of(arm->grippers)[gi]) + M->delta[ai] * u;
  int64_t vx, vy;
  gw_step_q(arm->len, d, &vx, &vy);
  *x = p.x + vx; *y = p.y + vy; *du = d;
}

/* ---- tape ---- */
static uint8_t op_at(const gw_arm_t *arm, uint32_t tick) {   /* tick is 1-based */
  if (tick <= arm->delay) return GW_OP_WAIT;
  if (arm->ntape == 0) return GW_OP_WAIT;                    /* all-marker tape expands to nothing */
  return arm->ops[(tick - arm->delay - 1) % arm->ntape];
}
/* NORMATIVE repeat expansion (mirrors the oracle's expandTape): a marker copies
 * out[seg_start..len) as frozen at the FIRST marker of a consecutive run; each
 * marker in the run copies that same segment; then seg_start advances.
 * Returns expanded length, or -1 when it exceeds cap. */
static int expand_tape(const uint8_t *src, int n, uint8_t *out, int cap) {
  int len = 0, seg_start = 0, i = 0;
  while (i < n) {
    if (src[i] != GW_OP_REPEAT) {
      if (len >= cap) return -1;
      out[len++] = src[i++];
    } else {
      int s0 = seg_start, s1 = len;
      while (i < n && src[i] == GW_OP_REPEAT) {
        for (int k = s0; k < s1; k++) {
          if (len >= cap) return -1;
          out[len++] = out[k];
        }
        i++;
      }
      seg_start = len;
    }
  }
  return len;
}

/* ---- init ---- */
static int dir_index(int32_t dq, int32_t dr) {
  for (int d = 0; d < 6; d++)
    if (GW_DIRS[d][0] == dq && GW_DIRS[d][1] == dr) return d;
  return -1;
}
static int claim_cell(uint32_t *keys, uint32_t *count, int32_t q, int32_t r) {
  uint32_t key = cell_pack(q, r) + 1;
  uint32_t i = (key * 2654435761u) % GW_AREA_CAP;
  for (uint32_t n = 0; n < GW_AREA_CAP; n++, i = (i + 1) % GW_AREA_CAP) {
    if (keys[i] == key) return 0;               /* already claimed: overlap */
    if (keys[i] == 0) { keys[i] = key; (*count)++; return 1; }
  }
  gw_panic();
  return 0;
}

int gw_sim_init(gw_sim_t *S, const gw_puzzle_t *puzzle, const gw_machine_t *m) {
  for (uint32_t i = 0; i < sizeof(*S); i++) ((uint8_t *)S)[i] = 0;
  S->puzzle = puzzle;
  S->caps = puzzle->caps;
  S->next_atom = 1;
  S->cycles = -1;

  if (S->caps.parts > GW_MAX_ARMS || S->caps.tape_len > GW_MAX_TAPE) return GW_ERR_CAPACITY;
  if (m->narms > GW_MAX_ARMS) return GW_ERR_CAPACITY;
  S->narms = m->narms;
  if (S->narms > S->caps.parts) return GW_ERR_PARTS;

  for (int i = 0; i < S->narms; i++) {
    const gw_arm_def_t *d = &m->arms[i];
    gw_arm_t *a = &S->arms[i];
    if (d->grippers > 6 || GRIP_NGRIPS[d->grippers] == 0) return GW_ERR_GRIPPERS;
    a->grippers = d->grippers;
    a->ngrips = GRIP_NGRIPS[d->grippers];
    if (d->len < 1 || d->len > 3) return GW_ERR_LENGTH;
    a->len = d->len;
    /* the cap binds both the authored tape and its expansion — what runs must fit */
    if ((int64_t)d->ntape + d->delay > S->caps.tape_len) return GW_ERR_TAPE;
    for (int k = 0; k < d->ntape; k++) if (d->ops[k] > 7) return GW_ERR_OP;
    int xlen = expand_tape(d->ops, d->ntape, S->tapes[i], GW_MAX_TAPE);
    if (xlen < 0 || (int64_t)xlen + d->delay > S->caps.tape_len) return GW_ERR_TAPE;
    a->ntape = (uint8_t)xlen; a->ops = S->tapes[i]; a->delay = d->delay;
    a->angle = (uint8_t)mod6(d->angle);
    a->is_elbow = d->is_elbow;
    if (d->is_elbow) {
      if (d->parent >= i) return GW_ERR_ELBOW_PARENT;
      const gw_arm_def_t *p = &m->arms[d->parent];
      if (d->at < 1 || d->at > p->len) return GW_ERR_ELBOW_AT;
      a->parent = d->parent; a->at = d->at;
      int depth = 0, cur = i;
      while (m->arms[cur].is_elbow) {
        cur = m->arms[cur].parent;
        if (++depth > S->caps.elbow_depth) return GW_ERR_ELBOW_DEPTH;
      }
    } else {
      a->base_q = d->gq; a->base_r = d->gr;
      for (int j = 0; j < i; j++)
        if (!S->arms[j].is_elbow && S->arms[j].base_q == d->gq && S->arms[j].base_r == d->gr)
          return GW_ERR_BASE_CLASH;
    }
  }

  /* a child mounted at the parent's TIP replaces the parent's grabber head:
     the parent can no longer grab, release, or pivot (validated below on the
     expanded tape) and its GRABBER_COST is refunded. */
  uint32_t tip_parents = 0;
  for (int i = 0; i < S->narms; i++) {
    if (!S->arms[i].is_elbow) continue;
    if (S->arms[i].at == S->arms[S->arms[i].parent].len) tip_parents |= 1u << S->arms[i].parent;
  }
  for (int i = 0; i < S->narms; i++) {
    if (!(tip_parents & (1u << i))) continue;
    for (int k = 0; k < S->arms[i].ntape; k++) {
      uint8_t op = S->arms[i].ops[k];
      if (op == GW_OP_G || op == GW_OP_D || op == GW_OP_PIV_CW || op == GW_OP_PIV_CCW)
        return GW_ERR_GRABBERLESS;
    }
  }

  /* pricing: arm price + arm-on-arm surcharge - tip-replaced grabbers + glyphs */
  for (int i = 0; i < S->narms; i++) {
    S->cost += price_of(S->arms[i].grippers) + (S->arms[i].is_elbow ? ELBOW_COST : 0);
    if (tip_parents & (1u << i)) S->cost -= GRABBER_COST;
  }
  S->cost += (int64_t)puzzle->nbonders * 10 + (int64_t)puzzle->ndebonders * 15
    + (int64_t)puzzle->ncalcifiers * 10 + (int64_t)puzzle->nduplicators * 20
    + (int64_t)puzzle->nprojectors * 20 + (int64_t)puzzle->npurifiers * 20
    + (int64_t)puzzle->nanimismus * 20; /* disposals are free */

  /* fixed glyph shapes: adjacent pairs; purification a,a+d -> a+rot(d);
     animismus salts a,a+d, vitae a+rot(d), mors a+rot^-1(d) */
  const gw_cell_t (*pairs[4])[2] = { puzzle->bonders, puzzle->debonders,
    puzzle->duplicators, puzzle->projectors };
  const uint8_t npairs[4] = { puzzle->nbonders, puzzle->ndebonders,
    puzzle->nduplicators, puzzle->nprojectors };
  for (int f = 0; f < 4; f++)
    for (int g = 0; g < npairs[f]; g++)
      if (dir_index(pairs[f][g][1].q - pairs[f][g][0].q, pairs[f][g][1].r - pairs[f][g][0].r) < 0)
        return GW_ERR_GLYPH_SHAPE;
  for (int g = 0; g < puzzle->npurifiers; g++) {
    const gw_cell_t *c = puzzle->purifiers[g];
    int k = dir_index(c[1].q - c[0].q, c[1].r - c[0].r);
    if (k < 0 || dir_index(c[2].q - c[0].q, c[2].r - c[0].r) != mod6(k + 1))
      return GW_ERR_GLYPH_SHAPE;
  }
  for (int g = 0; g < puzzle->nanimismus; g++) {
    const gw_cell_t *c = puzzle->animismus[g];
    int k = dir_index(c[1].q - c[0].q, c[1].r - c[0].r);
    if (k < 0 || dir_index(c[2].q - c[0].q, c[2].r - c[0].r) != mod6(k + 1)
        || dir_index(c[3].q - c[0].q, c[3].r - c[0].r) != mod6(k + 5))
      return GW_ERR_GLYPH_SHAPE;
  }

  /* layout: glyphs (disposal = cell + full ring) and molecule shapes may not
     overlap; bases may not sit on any of those cells. claimed set doubles as
     the initial area seed. */
  {
    uint32_t *keys = scratch_of(S)->keys;   /* sized like the area set */
    uint32_t count = 0;
    for (uint32_t i = 0; i < GW_AREA_CAP; i++) keys[i] = 0;
    for (int f = 0; f < 4; f++)
      for (int g = 0; g < npairs[f]; g++)
        for (int c = 0; c < 2; c++)
          if (!claim_cell(keys, &count, pairs[f][g][c].q, pairs[f][g][c].r)) return GW_ERR_GLYPH_OVERLAP;
    for (int g = 0; g < puzzle->ncalcifiers; g++)
      if (!claim_cell(keys, &count, puzzle->calcifiers[g].q, puzzle->calcifiers[g].r)) return GW_ERR_GLYPH_OVERLAP;
    for (int g = 0; g < puzzle->npurifiers; g++)
      for (int c = 0; c < 3; c++)
        if (!claim_cell(keys, &count, puzzle->purifiers[g][c].q, puzzle->purifiers[g][c].r)) return GW_ERR_GLYPH_OVERLAP;
    for (int g = 0; g < puzzle->nanimismus; g++)
      for (int c = 0; c < 4; c++)
        if (!claim_cell(keys, &count, puzzle->animismus[g][c].q, puzzle->animismus[g][c].r)) return GW_ERR_GLYPH_OVERLAP;
    for (int g = 0; g < puzzle->ndisposals; g++) {
      if (!claim_cell(keys, &count, puzzle->disposals[g].q, puzzle->disposals[g].r)) return GW_ERR_GLYPH_OVERLAP;
      for (int d = 0; d < 6; d++)
        if (!claim_cell(keys, &count, puzzle->disposals[g].q + GW_DIRS[d][0],
                        puzzle->disposals[g].r + GW_DIRS[d][1])) return GW_ERR_GLYPH_OVERLAP;
    }
    for (int g = 0; g < puzzle->ninputs; g++)
      for (int c = 0; c < puzzle->inputs[g].ncells; c++)
        if (!claim_cell(keys, &count, puzzle->inputs[g].cells[c].q, puzzle->inputs[g].cells[c].r))
          return GW_ERR_GLYPH_OVERLAP;
    if (puzzle->has_output)
      for (int c = 0; c < puzzle->output.ncells; c++)
        if (!claim_cell(keys, &count, puzzle->output.cells[c].q, puzzle->output.cells[c].r))
          return GW_ERR_GLYPH_OVERLAP;
    for (int i = 0; i < S->narms; i++) {
      if (S->arms[i].is_elbow) continue;
      uint32_t key = cell_pack(S->arms[i].base_q, S->arms[i].base_r) + 1;
      uint32_t h = (key * 2654435761u) % GW_AREA_CAP;
      for (uint32_t n = 0; n < GW_AREA_CAP; n++, h = (h + 1) % GW_AREA_CAP) {
        if (keys[h] == key) return GW_ERR_BASE_ON_GLYPH;
        if (keys[h] == 0) break;
      }
    }
    /* seed the area with everything claimed */
    for (uint32_t i = 0; i < GW_AREA_CAP; i++) S->area_keys[i] = keys[i];
    S->area_count = count;
  }

  /* pre-placed atoms (test puzzles) */
  for (int i = 0; i < puzzle->natoms; i++) {
    if (S->natoms >= GW_MAX_ATOMS) return GW_ERR_CAPACITY;
    gw_atom_t *a = &S->atoms[S->natoms++];
    a->id = S->next_atom++;
    a->q = puzzle->atom_cells[i].q; a->r = puzzle->atom_cells[i].r;
    a->elem = puzzle->atom_elems[i];
  }
  return GW_OK;
}

/* ---- kill helper: stable-compact atoms, scrub bonds and holds ---- */
static void apply_kills(gw_sim_t *S, const uint8_t killed[GW_MAX_ATOMS]) {
  /* bonds referencing killed ids go first (killed[] is slot-indexed pre-compaction) */
  for (int i = S->nbonds - 1; i >= 0; i--) {
    int sa = atom_slot_by_id(S, S->bonds[i].a), sb = atom_slot_by_id(S, S->bonds[i].b);
    if ((sa >= 0 && killed[sa]) || (sb >= 0 && killed[sb])) {
      S->bonds[i] = S->bonds[S->nbonds - 1]; S->nbonds--;
    }
  }
  for (int a = 0; a < S->narms; a++)
    for (int g = 0; g < S->arms[a].ngrips; g++)
      if (S->arms[a].hold_kind[g] == 1) {
        int slot = atom_slot_by_id(S, S->arms[a].hold_id[g]);
        if (slot >= 0 && killed[slot]) { S->arms[a].hold_kind[g] = 0; S->arms[a].hold_id[g] = 0; }
      }
  int w = 0;
  for (int i = 0; i < S->natoms; i++)
    if (!killed[i]) S->atoms[w++] = S->atoms[i];
  S->natoms = (uint16_t)w;
}

/* ---------- step ---------- */
void gw_sim_step(gw_sim_t *S) {
  if (S->fault_kind != GW_FAULT_NONE || S->cycles >= 0) return;
  const gw_puzzle_t *P = S->puzzle;
  S->tick++;

  /* 1. spawn — a reagent refills only when its whole footprint is empty */
  for (int g = 0; g < P->ninputs; g++) {
    const gw_shape_t *sh = &P->inputs[g];
    int empty = 1;
    for (int c = 0; c < sh->ncells; c++)
      if (atom_slot_at(S, sh->cells[c].q, sh->cells[c].r) >= 0) { empty = 0; break; }
    if (!empty) continue;
    uint32_t born[GW_MAX_SHAPE_CELLS];
    for (int c = 0; c < sh->ncells; c++) {
      if (S->natoms >= GW_MAX_ATOMS) gw_panic();
      gw_atom_t *a = &S->atoms[S->natoms++];
      a->id = S->next_atom++; a->q = sh->cells[c].q; a->r = sh->cells[c].r; a->elem = sh->elems[c];
      born[c] = a->id;
    }
    for (int b = 0; b < sh->nbonds; b++)
      bond_add(S, born[sh->bonds[b][0]], born[sh->bonds[b][1]]);
  }
  if (S->natoms > S->caps.atoms) {
    S->fault_kind = GW_FAULT_EXHAUSTION; S->fault_tick = S->tick; return;
  }

  uint8_t ops[GW_MAX_ARMS];
  for (int i = 0; i < S->narms; i++) ops[i] = op_at(&S->arms[i], S->tick);

  /* 2a. releases */
  for (int i = 0; i < S->narms; i++) {
    if (ops[i] != GW_OP_D) continue;
    gw_arm_t *arm = &S->arms[i];
    for (int gi = 0; gi < arm->ngrips; gi++) {
      if (arm->hold_kind[gi] == 2) {
        int ti = (int)arm->hold_id[gi];
        gw_arm_t *t = &S->arms[ti];
        pose_t p = pose_of(S, ti);      /* BEFORE detaching, while still carried */
        int w = 0;
        for (int c = 0; c < t->ncarriers; c++)
          if (!(t->carriers[c].arm == i && t->carriers[c].grip == gi))
            t->carriers[w++] = t->carriers[c];
        t->ncarriers = (uint8_t)w;
        if (t->ncarriers == 0) {        /* re-anchor exactly where it stands */
          t->base_q = p.q; t->base_r = p.r; t->base_rot = p.rot;
        }
      }
      arm->hold_kind[gi] = 0; arm->hold_id[gi] = 0;
    }
  }
  /* 2b. grabs (evaluated against post-release state) */
  for (int i = 0; i < S->narms; i++) {
    if (ops[i] != GW_OP_G) continue;
    gw_arm_t *arm = &S->arms[i];
    for (int gi = 0; gi < arm->ngrips; gi++) {
      if (arm->hold_kind[gi]) continue;
      int32_t cq, cr, cd;
      hand_cell(S, i, gi, &cq, &cr, &cd);
      int slot = atom_slot_at(S, cq, cr);
      if (slot >= 0) { arm->hold_kind[gi] = 1; arm->hold_id[gi] = S->atoms[slot].id; continue; }
      int ti = ground_arm_at(S, cq, cr);
      if (ti >= 0 && ti != i) {
        /* the oracle keeps iterating remaining grips/arms after this fault —
           their grabs mutate digest-visible state, so no early return here */
        if (support_chain(S, i) & (1u << ti)) {
          S->fault_kind = GW_FAULT_GRAB_CYCLE; S->fault_tick = S->tick;
          continue;
        }
        gw_arm_t *t = &S->arms[ti];
        uint8_t pre_rot = pose_of(S, ti).rot;     /* before this carrier attaches */
        arm->hold_kind[gi] = 2; arm->hold_id[gi] = (uint32_t)ti;
        if (t->ncarriers >= GW_MAX_CARRIERS) gw_panic();
        t->carriers[t->ncarriers].arm = (uint8_t)i;
        t->carriers[t->ncarriers].grip = (uint8_t)gi;
        t->ncarriers++;
        if (t->ncarriers == 1) t->carry_rel = (uint8_t)mod6(pre_rot - cd);
      }
    }
  }
  if (S->fault_kind != GW_FAULT_NONE) return;

  /* 3. motion — capture start, apply deltas, verify constraints, commit */
  motion_t *M = &scratch_of(S)->M;
  for (int i = 0; i < S->narms; i++) {
    gw_arm_t *arm = &S->arms[i];
    M->angle0[i] = arm->angle;
    M->delta[i] = ops[i] == GW_OP_CW ? 1 : ops[i] == GW_OP_CCW ? -1 : 0;
    M->pivot[i] = ops[i] == GW_OP_PIV_CW ? 1 : ops[i] == GW_OP_PIV_CCW ? -1 : 0;
    M->carry_rel0[i] = arm->carry_rel;
    M->ncarriers0[i] = arm->ncarriers;
    for (int c = 0; c < arm->ncarriers; c++) {
      M->carriers0[i][c].arm = arm->carriers[c].arm;
      M->carriers0[i][c].grip = arm->carriers[c].grip;
    }
    if (!arm->is_elbow && arm->ncarriers == 0) {
      M->base_q0[i] = arm->base_q; M->base_r0[i] = arm->base_r; M->base_rot0[i] = arm->base_rot;
    }
  }
  /* hand states before... */
  int32_t hb_q[GW_MAX_ARMS][GW_MAX_GRIPS], hb_r[GW_MAX_ARMS][GW_MAX_GRIPS], hb_d[GW_MAX_ARMS][GW_MAX_GRIPS];
  int32_t ha_q[GW_MAX_ARMS][GW_MAX_GRIPS], ha_r[GW_MAX_ARMS][GW_MAX_GRIPS], ha_d[GW_MAX_ARMS][GW_MAX_GRIPS];
  for (int i = 0; i < S->narms; i++)
    for (int gi = 0; gi < S->arms[i].ngrips; gi++)
      hand_cell(S, i, gi, &hb_q[i][gi], &hb_r[i][gi], &hb_d[i][gi]);
  /* ...apply joint deltas + pivots-on-towers... */
  for (int i = 0; i < S->narms; i++) {
    gw_arm_t *arm = &S->arms[i];
    arm->angle = (uint8_t)mod6(arm->angle + M->delta[i]);
    if (M->pivot[i])
      for (int gi = 0; gi < arm->ngrips; gi++)
        if (arm->hold_kind[gi] == 2) {
          gw_arm_t *t = &S->arms[arm->hold_id[gi]];
          t->carry_rel = (uint8_t)mod6(t->carry_rel + M->pivot[i]);
        }
  }
  /* ...hand states after */
  for (int i = 0; i < S->narms; i++)
    for (int gi = 0; gi < S->arms[i].ngrips; gi++)
      hand_cell(S, i, gi, &ha_q[i][gi], &ha_r[i][gi], &ha_d[i][gi]);

  /* molecule transforms with agreement checking */
  struct { uint32_t root_id; uint8_t k; int32_t bq, br; int8_t holder_arm, holder_grip, s; } xfs[GW_MAX_ATOMS];
  int nxfs = 0;
  int16_t mol_of[GW_MAX_ATOMS];             /* slot -> xfs index, -1 free */
  uint8_t *mol_mask_buf = scratch_of(S)->mol_mask_buf;
  for (int i = 0; i < S->natoms; i++) mol_of[i] = -1;
  /* like the oracle, keep scanning after an overconstraint fault (later grips
     still register transforms; only local state changes, but exactness first) */
  for (int i = 0; i < S->narms; i++) {
    gw_arm_t *arm = &S->arms[i];
    for (int gi = 0; gi < arm->ngrips; gi++) {
      if (arm->hold_kind[gi] != 1) continue;
      int anchor = atom_slot_by_id(S, arm->hold_id[gi]);
      if (anchor < 0) { arm->hold_kind[gi] = 0; arm->hold_id[gi] = 0; continue; }
      molecule_mask(S, anchor, mol_mask_buf);
      uint32_t root_id = 0xffffffffu;
      for (int a = 0; a < S->natoms; a++)
        if (mol_mask_buf[a] && S->atoms[a].id < root_id) root_id = S->atoms[a].id;
      int8_t s = M->pivot[i];
      int32_t k = mod6(ha_d[i][gi] - hb_d[i][gi] + s);
      int32_t rq, rr;
      gw_rot_cell(hb_q[i][gi], hb_r[i][gi], k, &rq, &rr);
      int32_t bq = ha_q[i][gi] - rq, br = ha_r[i][gi] - rr;
      int prev = -1;
      for (int x = 0; x < nxfs; x++) if (xfs[x].root_id == root_id) prev = x;
      if (prev >= 0) {
        if (xfs[prev].k != k || xfs[prev].bq != bq || xfs[prev].br != br) {
          S->fault_kind = GW_FAULT_OVERCONSTRAINT; S->fault_tick = S->tick;
        }
      } else {
        xfs[nxfs].root_id = root_id; xfs[nxfs].k = (uint8_t)k;
        xfs[nxfs].bq = bq; xfs[nxfs].br = br;
        xfs[nxfs].holder_arm = (int8_t)i; xfs[nxfs].holder_grip = (int8_t)gi; xfs[nxfs].s = s;
        for (int a = 0; a < S->natoms; a++)
          if (mol_mask_buf[a]) mol_of[a] = (int16_t)nxfs;
        nxfs++;
      }
    }
  }
  if (S->fault_kind != GW_FAULT_NONE) return;
  /* multi-carrier tower agreement: poses from each carrier must match */
  for (int i = 0; i < S->narms; i++) {
    gw_arm_t *arm = &S->arms[i];
    if (arm->ncarriers < 2) continue;
    pose_t p0 = pose_of(S, i);
    for (int c = 1; c < arm->ncarriers; c++) {
      int hi = arm->carriers[c].arm, grip = arm->carriers[c].grip;
      gw_arm_t *h = &S->arms[hi];
      pose_t hp = pose_of(S, hi);
      int32_t hd = mod6(hp.rot + h->angle + offsets_of(h->grippers)[grip]);
      int32_t aq = hp.q + GW_DIRS[hd][0] * h->len, ar = hp.r + GW_DIRS[hd][1] * h->len;
      int32_t arot = mod6(hd + arm->carry_rel);
      if (aq != p0.q || ar != p0.r || arot != p0.rot) {
        S->fault_kind = GW_FAULT_OVERCONSTRAINT; S->fault_tick = S->tick;
      }
    }
  }
  if (S->fault_kind != GW_FAULT_NONE) return;

  /* snapshot atoms + commit molecule motion (exact) */
  M->natoms = S->natoms;
  for (int a = 0; a < S->natoms; a++) {
    M->atoms[a].id = S->atoms[a].id; M->atoms[a].elem = S->atoms[a].elem;
    M->atoms[a].q0 = S->atoms[a].q; M->atoms[a].r0 = S->atoms[a].r;
    if (mol_of[a] >= 0) {
      M->atoms[a].holder_arm = xfs[mol_of[a]].holder_arm;
      M->atoms[a].holder_grip = xfs[mol_of[a]].holder_grip;
      M->atoms[a].s = xfs[mol_of[a]].s;
    } else M->atoms[a].holder_arm = -1;
  }
  for (int a = 0; a < S->natoms; a++) {
    if (mol_of[a] < 0) continue;
    int32_t rq, rr;
    gw_rot_cell(S->atoms[a].q, S->atoms[a].r, xfs[mol_of[a]].k, &rq, &rr);
    S->atoms[a].q = rq + xfs[mol_of[a]].bq;
    S->atoms[a].r = rr + xfs[mol_of[a]].br;
  }

  /* 3b. sweep — N sample instants (Opus Magnum's rule on the tick's rotation
     radius, extended to nested motion: for every held atom, the SUM of its final
     distances from every joint that turns it — see the oracle), full pair check +
     area accumulation */
  int32_t max_dist = 1;
  for (int a = 0; a < M->natoms; a++) {
    if (M->atoms[a].holder_arm < 0) continue;
    int slot = atom_slot_by_id(S, M->atoms[a].id);
    if (slot < 0) continue;
    int x = M->atoms[a].holder_arm, via_grip = M->atoms[a].holder_grip;
    int32_t d = 0;
    for (;;) {
      if (M->delta[x]) {
        pose_t p = pose_of(S, x);
        d += hexicab(S->atoms[slot].q - p.q, S->atoms[slot].r - p.r);
      }
      if (M->pivot[x] && via_grip >= 0) {
        int32_t hq, hr, hd;
        hand_cell(S, x, via_grip, &hq, &hr, &hd);
        d += hexicab(S->atoms[slot].q - hq, S->atoms[slot].r - hr);
      }
      if (S->arms[x].is_elbow) { x = S->arms[x].parent; via_grip = -1; }
      else if (M->ncarriers0[x]) { via_grip = M->carriers0[x][0].grip; x = M->carriers0[x][0].arm; }
      else break;
    }
    if (d > max_dist) max_dist = d;
  }
  const int32_t nsamp = gw_samples_for(max_dist), ustep = GW_ANG_DIR / nsamp;
  obj_t *objs = scratch_of(S)->objs;
  for (int k = 1; k <= nsamp && S->fault_kind == GW_FAULT_NONE; k++) {
    const int32_t u = k * ustep;
    int nobjs = 0;
    for (int a = 0; a < M->natoms; a++) {
      int64_t x, y;
      if (M->atoms[a].holder_arm >= 0) {
        int ai = M->atoms[a].holder_arm, gi = M->atoms[a].holder_grip;
        int64_t hkx, hky, h0x, h0y; int32_t hkd, h0d;
        hand_q(S, ai, gi, u, M, &hkx, &hky, &hkd);
        hand_q(S, ai, gi, 0, M, &h0x, &h0y, &h0d);
        int64_t p0x, p0y;
        gw_to_px(M->atoms[a].q0, M->atoms[a].r0, &p0x, &p0y);
        int32_t du = hkd - h0d + M->atoms[a].s * u;
        int64_t relx, rely;
        gw_rot_q(p0x - h0x, p0y - h0y, du, &relx, &rely);
        x = hkx + relx; y = hky + rely;
      } else {
        gw_to_px(M->atoms[a].q0, M->atoms[a].r0, &x, &y);
      }
      objs[nobjs].kind = 0; objs[nobjs].id = M->atoms[a].id;
      objs[nobjs].x = x; objs[nobjs].y = y; nobjs++;
    }
    for (int i = 0; i < S->narms; i++) {
      if (S->arms[i].is_elbow) continue;    /* elbows don't collide */
      poseq_t p = pose_q(S, i, u, M);
      objs[nobjs].kind = 1; objs[nobjs].id = (uint32_t)i;
      objs[nobjs].x = p.x; objs[nobjs].y = p.y; nobjs++;
    }
    for (int o = 0; o < nobjs; o++) {
      int32_t cq, cr;
      gw_axial_round(objs[o].x, objs[o].y, &cq, &cr);
      area_add(S, cq, cr);
    }
    for (int i = 0; i < S->narms; i++)
      for (int gi = 0; gi < S->arms[i].ngrips; gi++) {
        int64_t hx, hy; int32_t hd;
        hand_q(S, i, gi, u, M, &hx, &hy, &hd);
        int32_t cq, cr;
        gw_axial_round(hx, hy, &cq, &cr);
        area_add(S, cq, cr);
      }
    for (int o = 0; o < nobjs && S->fault_kind == GW_FAULT_NONE; o++)
      for (int p = o + 1; p < nobjs; p++) {
        int64_t t2 = objs[o].kind == 0 ? (objs[p].kind == 0 ? GW_THRESH2_AA : GW_THRESH2_AB)
                                       : (objs[p].kind == 0 ? GW_THRESH2_AB : GW_THRESH2_BB);
        if (gw_too_close(objs[o].x, objs[o].y, objs[p].x, objs[p].y, t2)) {
          S->fault_kind = GW_FAULT_COLLISION; S->fault_tick = S->tick;
          break;
        }
      }
  }
  if (S->fault_kind != GW_FAULT_NONE) return;

  /* 4. glyphs — transmutations act on whatever rests on their cells */
  for (int g = 0; g < P->nbonders; g++) {
    int s1 = atom_slot_at(S, P->bonders[g][0].q, P->bonders[g][0].r);
    int s2 = atom_slot_at(S, P->bonders[g][1].q, P->bonders[g][1].r);
    if (s1 >= 0 && s2 >= 0 && !bond_exists(S, S->atoms[s1].id, S->atoms[s2].id))
      bond_add(S, S->atoms[s1].id, S->atoms[s2].id);
  }
  for (int g = 0; g < P->ndebonders; g++) {
    int s1 = atom_slot_at(S, P->debonders[g][0].q, P->debonders[g][0].r);
    int s2 = atom_slot_at(S, P->debonders[g][1].q, P->debonders[g][1].r);
    if (s1 >= 0 && s2 >= 0 && bond_exists(S, S->atoms[s1].id, S->atoms[s2].id))
      bond_remove(S, S->atoms[s1].id, S->atoms[s2].id);
  }
  for (int g = 0; g < P->ncalcifiers; g++) {
    int s = atom_slot_at(S, P->calcifiers[g].q, P->calcifiers[g].r);
    if (s >= 0 && is_cardinal(S->atoms[s].elem)) S->atoms[s].elem = GW_EL_SA;
  }
  for (int g = 0; g < P->nduplicators; g++) {
    int se = atom_slot_at(S, P->duplicators[g][0].q, P->duplicators[g][0].r);
    int sd = atom_slot_at(S, P->duplicators[g][1].q, P->duplicators[g][1].r);
    if (se >= 0 && sd >= 0 && is_cardinal(S->atoms[se].elem) && S->atoms[sd].elem == GW_EL_SA)
      S->atoms[sd].elem = S->atoms[se].elem;
  }
  /* conversion glyphs can't see bonded or held atoms */
  uint8_t *killed = scratch_of(S)->killed;
  for (int i = 0; i < GW_MAX_ATOMS; i++) killed[i] = 0;
  int any_kill = 0;
  uint8_t gripped[GW_MAX_ATOMS];
  for (int i = 0; i < S->natoms; i++) gripped[i] = 0;
  for (int i = 0; i < S->narms; i++)
    for (int gi = 0; gi < S->arms[i].ngrips; gi++)
      if (S->arms[i].hold_kind[gi] == 1) {
        int slot = atom_slot_by_id(S, S->arms[i].hold_id[gi]);
        if (slot >= 0) gripped[slot] = 1;
      }
#define LOOSE(slot) ((slot) >= 0 && bond_count_of(S, S->atoms[slot].id) == 0 && !gripped[slot])
  for (int g = 0; g < P->nprojectors; g++) {
    int sm = atom_slot_at(S, P->projectors[g][0].q, P->projectors[g][0].r);
    int sq0 = atom_slot_at(S, P->projectors[g][1].q, P->projectors[g][1].r);
    int sq = LOOSE(sq0) ? sq0 : -1;
    if (sm >= 0 && sq >= 0 && S->atoms[sq].elem == GW_EL_HG
        && is_metal(S->atoms[sm].elem) && S->atoms[sm].elem < GW_EL_AU && !killed[sq]) {
      killed[sq] = 1; any_kill = 1;
      S->atoms[sm].elem++;
    }
  }
  for (int g = 0; g < P->npurifiers; g++) {
    int sa0 = atom_slot_at(S, P->purifiers[g][0].q, P->purifiers[g][0].r);
    int sb0 = atom_slot_at(S, P->purifiers[g][1].q, P->purifiers[g][1].r);
    int sa = LOOSE(sa0) ? sa0 : -1, sb = LOOSE(sb0) ? sb0 : -1;
    if (sa >= 0 && sb >= 0 && sa != sb && S->atoms[sa].elem == S->atoms[sb].elem
        && is_metal(S->atoms[sa].elem) && S->atoms[sa].elem < GW_EL_AU
        && atom_slot_at(S, P->purifiers[g][2].q, P->purifiers[g][2].r) < 0
        && !killed[sa] && !killed[sb]) {
      uint8_t next = S->atoms[sa].elem + 1;
      killed[sa] = 1; killed[sb] = 1; any_kill = 1;
      if (S->natoms >= GW_MAX_ATOMS) gw_panic();
      gw_atom_t *n = &S->atoms[S->natoms++];
      n->id = S->next_atom++; n->q = P->purifiers[g][2].q; n->r = P->purifiers[g][2].r; n->elem = next;
    }
  }
  for (int g = 0; g < P->nanimismus; g++) {
    int sa0 = atom_slot_at(S, P->animismus[g][0].q, P->animismus[g][0].r);
    int sb0 = atom_slot_at(S, P->animismus[g][1].q, P->animismus[g][1].r);
    int sa = LOOSE(sa0) ? sa0 : -1, sb = LOOSE(sb0) ? sb0 : -1;
    if (sa >= 0 && sb >= 0 && sa != sb
        && S->atoms[sa].elem == GW_EL_SA && S->atoms[sb].elem == GW_EL_SA
        && atom_slot_at(S, P->animismus[g][2].q, P->animismus[g][2].r) < 0
        && atom_slot_at(S, P->animismus[g][3].q, P->animismus[g][3].r) < 0
        && !killed[sa] && !killed[sb]) {
      killed[sa] = 1; killed[sb] = 1; any_kill = 1;
      if (S->natoms + 2 > GW_MAX_ATOMS) gw_panic();
      gw_atom_t *v = &S->atoms[S->natoms++];
      v->id = S->next_atom++; v->q = P->animismus[g][2].q; v->r = P->animismus[g][2].r; v->elem = GW_EL_VI;
      gw_atom_t *m = &S->atoms[S->natoms++];
      m->id = S->next_atom++; m->q = P->animismus[g][3].q; m->r = P->animismus[g][3].r; m->elem = GW_EL_MO;
    }
  }
  for (int g = 0; g < P->ndisposals; g++) {
    int s = atom_slot_at(S, P->disposals[g].q, P->disposals[g].r);
    if (LOOSE(s) && !killed[s]) { killed[s] = 1; any_kill = 1; }
  }
#undef LOOSE
  if (any_kill) apply_kills(S, killed);

  /* 5. output */
  if (P->has_output) {
    const gw_shape_t *out = &P->output;
    uint8_t held[GW_MAX_ATOMS];
    for (int i = 0; i < S->natoms; i++) held[i] = 0;
    for (int i = 0; i < S->narms; i++)
      for (int gi = 0; gi < S->arms[i].ngrips; gi++)
        if (S->arms[i].hold_kind[gi] == 1) {
          int anchor = atom_slot_by_id(S, S->arms[i].hold_id[gi]);
          if (anchor < 0) continue;
          molecule_mask(S, anchor, mol_mask_buf);
          for (int a = 0; a < S->natoms; a++) if (mol_mask_buf[a]) held[a] = 1;
        }
    int got[GW_MAX_SHAPE_CELLS], all = 1;
    for (int c = 0; c < out->ncells; c++) {
      int s = atom_slot_at(S, out->cells[c].q, out->cells[c].r);
      got[c] = (s >= 0 && S->atoms[s].elem == out->elems[c] && !held[s]) ? s : -1;
      if (got[c] < 0) all = 0;
    }
    if (all) {
      for (int b = 0; b < out->nbonds && all; b++)
        if (!bond_exists(S, S->atoms[got[out->bonds[b][0]]].id, S->atoms[got[out->bonds[b][1]]].id))
          all = 0;
      if (all && molecule_mask(S, got[0], mol_mask_buf) != out->ncells) all = 0;
      if (all) {
        uint8_t take[GW_MAX_ATOMS];
        for (int i = 0; i < S->natoms; i++) take[i] = 0;
        for (int c = 0; c < out->ncells; c++) take[got[c]] = 1;
        apply_kills(S, take);
        S->products++;
        if ((int32_t)S->products >= S->caps.goal) S->cycles = (int32_t)S->tick;
      }
    }
  }

  if (S->cycles < 0 && (int32_t)S->tick >= S->caps.cycles) {
    S->fault_kind = GW_FAULT_EXHAUSTION; S->fault_tick = S->tick;
  }
}

/* ---- conformance digest: must mirror gen-vectors.js digestState exactly ---- */
#define FNV_OFFSET 0xcbf29ce484222325ULL
#define FNV_PRIME  0x100000001b3ULL
typedef struct { uint64_t h; } dg_t;
static void dg_u8(dg_t *d, uint8_t b) { d->h = (d->h ^ b) * FNV_PRIME; }
static void dg_u32(dg_t *d, uint32_t v) {
  dg_u8(d, (uint8_t)(v & 0xff)); dg_u8(d, (uint8_t)((v >> 8) & 0xff));
  dg_u8(d, (uint8_t)((v >> 16) & 0xff)); dg_u8(d, (uint8_t)((v >> 24) & 0xff));
}
static void dg_i32(dg_t *d, int32_t v) { dg_u32(d, (uint32_t)v); }

uint64_t gw_sim_digest(const gw_sim_t *S) {
  dg_t d = { FNV_OFFSET };
  dg_u32(&d, S->tick);
  dg_u8(&d, S->fault_kind != GW_FAULT_NONE ? 2 : S->cycles >= 0 ? 1 : 0);
  dg_u8(&d, S->fault_kind);
  dg_u32(&d, S->products);
  dg_u32(&d, S->area_count);
  dg_u32(&d, S->natoms);
  for (int i = 0; i < S->natoms; i++) {
    const gw_atom_t *a = &S->atoms[i];
    dg_u32(&d, a->id); dg_i32(&d, a->q); dg_i32(&d, a->r); dg_u8(&d, a->elem);
    uint32_t nb[8]; int n = 0;
    for (int b = 0; b < S->nbonds; b++) {
      uint32_t other = 0; int hit = 0;
      if (S->bonds[b].a == a->id) { other = S->bonds[b].b; hit = 1; }
      else if (S->bonds[b].b == a->id) { other = S->bonds[b].a; hit = 1; }
      if (hit) { if (n >= 8) gw_panic(); nb[n++] = other; }
    }
    for (int x = 0; x < n; x++)                          /* insertion sort, ascending */
      for (int y = x + 1; y < n; y++)
        if (nb[y] < nb[x]) { uint32_t t = nb[x]; nb[x] = nb[y]; nb[y] = t; }
    dg_u8(&d, (uint8_t)n);
    for (int x = 0; x < n; x++) dg_u32(&d, nb[x]);
  }
  dg_u32(&d, S->narms);
  for (int i = 0; i < S->narms; i++) {
    const gw_arm_t *a = &S->arms[i];
    dg_u8(&d, a->angle); dg_u8(&d, a->carry_rel); dg_u8(&d, a->ncarriers);
    for (int c = 0; c < a->ncarriers; c++) { dg_u8(&d, a->carriers[c].arm); dg_u8(&d, a->carriers[c].grip); }
    dg_u8(&d, a->is_elbow);
    if (!a->is_elbow) { dg_i32(&d, a->base_q); dg_i32(&d, a->base_r); dg_u8(&d, a->base_rot); }
    for (int g = 0; g < a->ngrips; g++) { dg_u8(&d, a->hold_kind[g]); dg_u32(&d, a->hold_id[g]); }
  }
  return d.h;
}
