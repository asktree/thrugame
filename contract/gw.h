/*
 * GREAT WORK! — on-chain rules engine, C implementation.
 *
 * A transliteration of engine/engine.js's deterministic core. The JS engine is
 * the conformance oracle: every simulation decision here must reproduce it
 * bit-for-bit (see SPEC.md § deterministic arithmetic). Freestanding-friendly:
 * no libc beyond what tn_sdk provides (memset/memcpy), no malloc, no floats.
 *
 * Q16.16 fixed point throughout the sweep; all division FLOORS (C's `/`
 * truncates toward zero — use gw_fdiv, never a bare `/`, on signed Q values).
 */
#ifndef GW_H
#define GW_H

#include <stdint.h>
#include <stddef.h>

/* ---- capacity bounds (validated against caps at sim init) ---- */
#define GW_MAX_ARMS      32
#define GW_MAX_GRIPS     6
#define GW_MAX_TAPE      64
#define GW_MAX_ATOMS     160  /* caps.atoms (64) + one tick's spawn overshoot */
#define GW_MAX_BONDS     512
#define GW_MAX_CARRIERS  8
#define GW_MAX_SHAPES    8
#define GW_MAX_SHAPE_CELLS 16
#define GW_MAX_SHAPE_BONDS 32
#define GW_MAX_GLYPHS    8    /* per family */
#define GW_AREA_CAP      4096 /* linear-probe cell set; must exceed any real area */
#define GW_K_SAMPLES     12

/* ---- normative Q16.16 constants (SPEC.md; copy verbatim, never recompute) ---- */
#define GW_ONE        65536
#define GW_SQRT3      113512
#define GW_HALF_SQRT3 56756
#define GW_THRESH2    96338
#define GW_ANG_TURN   72
#define GW_ANG_DIR    12

/* ---- elements: indices into the normative roster (matches gen-vectors.js) ---- */
enum {
  GW_EL_SA, GW_EL_AI, GW_EL_EA, GW_EL_FI, GW_EL_WA, GW_EL_HG,
  GW_EL_PB, GW_EL_SN, GW_EL_FE, GW_EL_CU, GW_EL_AG, GW_EL_AU,
  GW_EL_VI, GW_EL_MO, GW_EL_COUNT
};

/* ---- faults / errors ---- */
enum {
  GW_STATUS_RUNNING = 0, GW_STATUS_VERIFIED = 1, GW_STATUS_FAULT = 2,
};
enum {
  GW_FAULT_NONE = 0, GW_FAULT_COLLISION, GW_FAULT_OVERCONSTRAINT,
  GW_FAULT_GRAB_CYCLE, GW_FAULT_EXHAUSTION,
};
enum {                              /* invalid-machine rejections (pre-run) */
  GW_OK = 0,
  GW_ERR_DECODE,                    /* malformed codec bytes */
  GW_ERR_PARTS, GW_ERR_GRIPPERS, GW_ERR_LENGTH, GW_ERR_TAPE, GW_ERR_OP,
  GW_ERR_ELBOW_PARENT, GW_ERR_ELBOW_AT, GW_ERR_ELBOW_DEPTH, GW_ERR_BASE_CLASH,
  GW_ERR_GLYPH_SHAPE, GW_ERR_GLYPH_OVERLAP, GW_ERR_BASE_ON_GLYPH,
  GW_ERR_CAPACITY,                  /* exceeds a GW_MAX_* build bound */
};

/* ---- opcodes: G D + - P Q W R -> 0..7 (codec order). R (repeat) survives
 * serialization for legibility; the sim runs the NORMATIVE expansion: each
 * marker copies the ops since the end of the previous repeat block,
 * consecutive markers copy that same segment, then the origin advances. ---- */
enum { GW_OP_G, GW_OP_D, GW_OP_CW, GW_OP_CCW, GW_OP_PIV_CW, GW_OP_PIV_CCW, GW_OP_WAIT, GW_OP_REPEAT };

typedef struct { int32_t q, r; } gw_cell_t;

typedef struct {
  uint8_t  ncells;
  gw_cell_t cells[GW_MAX_SHAPE_CELLS];
  uint8_t  elems[GW_MAX_SHAPE_CELLS];
  uint8_t  nbonds;
  uint8_t  bonds[GW_MAX_SHAPE_BONDS][2];
} gw_shape_t;

typedef struct {
  int32_t parts, elbow_depth, tape_len, atoms, cycles, goal;
} gw_caps_t;

typedef struct {
  uint8_t   ninputs;
  gw_shape_t inputs[GW_MAX_SHAPES];
  uint8_t   has_output;
  gw_shape_t output;
  uint8_t   natoms;                       /* pre-placed atoms (test puzzles) */
  gw_cell_t atom_cells[GW_MAX_SHAPES];
  uint8_t   atom_elems[GW_MAX_SHAPES];
  uint8_t   nbonders;    gw_cell_t bonders[GW_MAX_GLYPHS][2];
  uint8_t   ndebonders;  gw_cell_t debonders[GW_MAX_GLYPHS][2];
  uint8_t   ncalcifiers; gw_cell_t calcifiers[GW_MAX_GLYPHS];
  uint8_t   nduplicators; gw_cell_t duplicators[GW_MAX_GLYPHS][2];
  uint8_t   nprojectors; gw_cell_t projectors[GW_MAX_GLYPHS][2];
  uint8_t   npurifiers;  gw_cell_t purifiers[GW_MAX_GLYPHS][3];
  uint8_t   nanimismus;  gw_cell_t animismus[GW_MAX_GLYPHS][4];
  uint8_t   ndisposals;  gw_cell_t disposals[GW_MAX_GLYPHS];
  gw_caps_t caps;                         /* fully resolved (defaults merged) */
} gw_puzzle_t;

/* ---- decoded machine (codec v1/v2) ---- */
typedef struct {
  uint8_t  grippers;                      /* 1, 2, 3, 6 */
  uint8_t  len;                           /* 1..3 */
  uint8_t  is_elbow;
  uint8_t  parent;                        /* arm index, < own index */
  uint8_t  at;                            /* 1..parent len */
  int32_t  gq, gr;                        /* ground mount */
  uint8_t  angle;                         /* 0..5 */
  uint32_t delay;
  uint8_t  ntape;
  uint8_t  ops[GW_MAX_TAPE];              /* GW_OP_* */
} gw_arm_def_t;

typedef struct { uint8_t type; int32_t q, r; uint8_t rot; } gw_glyph_place_t;
typedef struct { uint32_t ri; int32_t q, r; uint8_t rot; } gw_input_place_t;

typedef struct {
  uint8_t version;
  uint8_t narms;
  gw_arm_def_t arms[GW_MAX_ARMS];
  /* v2 board layout (placement references; not consumed by the sim core) */
  uint8_t nglyphs;  gw_glyph_place_t glyphs[16];
  uint8_t ninputs;  gw_input_place_t inputs[GW_MAX_SHAPES];
  uint8_t has_output; int32_t out_q, out_r; uint8_t out_rot;
} gw_machine_t;

/* ---- runtime state ---- */
typedef struct {
  uint32_t id;
  int32_t  q, r;
  uint8_t  elem;
} gw_atom_t;

typedef struct {
  /* definition */
  uint8_t  grippers, ngrips, len, is_elbow, parent, at;
  uint8_t  angle;
  uint32_t delay;
  uint8_t  ntape;
  const uint8_t *ops;
  /* dynamic */
  int32_t  base_q, base_r;
  uint8_t  base_rot;
  uint8_t  carry_rel;
  uint8_t  ncarriers;
  struct { uint8_t arm, grip; } carriers[GW_MAX_CARRIERS];
  uint8_t  hold_kind[GW_MAX_GRIPS];       /* 0 none, 1 atom, 2 tower */
  uint32_t hold_id[GW_MAX_GRIPS];         /* atom id, or tower arm index */
} gw_arm_t;

typedef struct gw_sim {
  const gw_puzzle_t *puzzle;
  gw_caps_t caps;
  uint32_t tick;
  uint32_t next_atom;
  uint32_t products;
  uint8_t  fault_kind;                    /* GW_FAULT_* */
  uint32_t fault_tick;
  int32_t  cycles;                        /* -1 until verified */
  int64_t  cost;
  /* atoms: append-ordered, compacted on kill (order preserved) */
  uint16_t natoms;
  gw_atom_t atoms[GW_MAX_ATOMS];
  /* bonds: unordered pair list of atom ids */
  uint16_t nbonds;
  struct { uint32_t a, b; } bonds[GW_MAX_BONDS];
  uint8_t  narms;
  gw_arm_t arms[GW_MAX_ARMS];
  /* expanded tapes (repeat markers resolved); arms[i].ops points here */
  uint8_t  tapes[GW_MAX_ARMS][GW_MAX_TAPE];
  /* area: linear-probe set of packed cells */
  uint32_t area_count;
  uint32_t area_keys[GW_AREA_CAP];        /* 0 = empty; keys are packed+1 */
} gw_sim_t;

/* ---- expected-result record used by the conformance vectors ---- */
typedef struct {
  int32_t ticks, status, fault_kind, fault_tick;
  int64_t cost; int32_t cycles, area; int64_t sum;
} gw_expect_t;
typedef struct {
  const char *name;
  const gw_puzzle_t *puzzle;
  const uint8_t *machine_bytes; uint32_t machine_len;
  const uint64_t *digests;
  const gw_expect_t *expect;
} gw_vector_case_t;

/* ---- API ---- */

/* floored division: the ONLY division allowed on signed Q values */
static inline int64_t gw_fdiv(int64_t a, int64_t b) {
  int64_t q = a / b;
  if ((a % b) != 0 && ((a < 0) != (b < 0))) q--;
  return q;
}
static inline int64_t gw_fmul(int64_t a, int64_t b) { return gw_fdiv(a * b, GW_ONE); }

/* hex directions E SE SW W NW NE (matches the oracle's DIRS) */
extern const int32_t GW_DIRS[6][2];

/* deterministic geometry core (gw_q.c) — mirrors GW.Q in the JS oracle */
void    gw_trig(int32_t u, int64_t *c, int64_t *s);       /* angle in 5° units */
void    gw_to_px(int32_t q, int32_t r, int64_t *x, int64_t *y);
void    gw_step_q(int32_t n, int32_t u, int64_t *x, int64_t *y);
void    gw_rot_q(int64_t dx, int64_t dy, int32_t u, int64_t *ox, int64_t *oy);
int     gw_too_close(int64_t ax, int64_t ay, int64_t bx, int64_t by);
void    gw_axial_round(int64_t x, int64_t y, int32_t *q, int32_t *r);
void    gw_rot_cell(int32_t q, int32_t r, int32_t k, int32_t *oq, int32_t *orr);

/* codec (gw_codec.c) */
int gw_decode_machine(const uint8_t *bytes, uint32_t len, gw_machine_t *out);
/* encode into buf (cap bytes); returns encoded length or -1 on error/overflow */
int32_t gw_encode_machine(const gw_machine_t *m, uint8_t *buf, uint32_t cap);

/* engine (gw_engine.c) */
int  gw_sim_init(gw_sim_t *S, const gw_puzzle_t *puzzle, const gw_machine_t *m);
void gw_sim_step(gw_sim_t *S);
/* digest of the committed state — must match gen-vectors.js digestState exactly */
uint64_t gw_sim_digest(const gw_sim_t *S);

#endif /* GW_H */
