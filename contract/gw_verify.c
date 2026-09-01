/* Submission verifier — the on-chain entry's logic, kept SDK-free so the host
 * harness exercises the exact code that runs in ThruVM.
 *
 * A submission is a codec v2 machine: arms plus a board layout that places
 * every glyph, reagent and the product by anchor cell + rotation. The shapes
 * come from the puzzle catalog, so a solver can never alter what is asked for.
 * Materialization mirrors the editor's matPuzzle (lab/editor-template.html):
 * glyph families in placement order, reagents in catalog order, product last. */
#include "gw.h"

static void zero(void *p, uint32_t n) { for (uint32_t i = 0; i < n; i++) ((uint8_t *)p)[i] = 0; }

static gw_cell_t step(gw_cell_t a, int k) {
  k = ((k % 6) + 6) % 6;
  gw_cell_t c = { a.q + GW_DIRS[k][0], a.r + GW_DIRS[k][1] };
  return c;
}

static void place_shape(const gw_shape_t *rel, int32_t q, int32_t r, uint8_t rot, gw_shape_t *out) {
  out->ncells = rel->ncells;
  out->nbonds = rel->nbonds;
  for (int i = 0; i < rel->ncells; i++) {
    int32_t rq, rr;
    gw_rot_cell(rel->cells[i].q, rel->cells[i].r, rot, &rq, &rr);
    out->cells[i].q = q + rq; out->cells[i].r = r + rr;
    out->elems[i] = rel->elems[i];
  }
  for (int i = 0; i < rel->nbonds; i++) { out->bonds[i][0] = rel->bonds[i][0]; out->bonds[i][1] = rel->bonds[i][1]; }
}

int gw_materialize(const gw_puzzle_def_t *def, const gw_machine_t *m, gw_puzzle_t *out) {
  zero(out, sizeof(*out));
  out->caps = def->caps;

  /* fixed glyph shapes, placed by translation + rotation (codec GLYPH_TYPES order) */
  for (int i = 0; i < m->nglyphs; i++) {
    const gw_glyph_place_t *g = &m->glyphs[i];
    gw_cell_t a = { g->q, g->r };
    gw_cell_t b = step(a, g->rot);              /* second cell of every multi-cell glyph */
    gw_cell_t c = step(a, g->rot + 1);          /* purifier out / animismus vitae out */
    gw_cell_t d = step(a, g->rot + 5);          /* animismus mors out */
    switch (g->type) {
      case 0: if (out->nbonders >= GW_MAX_GLYPHS) return GW_ERR_CAPACITY;
        out->bonders[out->nbonders][0] = a; out->bonders[out->nbonders][1] = b; out->nbonders++; break;
      case 1: if (out->ndebonders >= GW_MAX_GLYPHS) return GW_ERR_CAPACITY;
        out->debonders[out->ndebonders][0] = a; out->debonders[out->ndebonders][1] = b; out->ndebonders++; break;
      case 2: if (out->ncalcifiers >= GW_MAX_GLYPHS) return GW_ERR_CAPACITY;
        out->calcifiers[out->ncalcifiers++] = a; break;
      case 3: if (out->nduplicators >= GW_MAX_GLYPHS) return GW_ERR_CAPACITY;
        out->duplicators[out->nduplicators][0] = a; out->duplicators[out->nduplicators][1] = b; out->nduplicators++; break;
      case 4: if (out->nprojectors >= GW_MAX_GLYPHS) return GW_ERR_CAPACITY;
        out->projectors[out->nprojectors][0] = a; out->projectors[out->nprojectors][1] = b; out->nprojectors++; break;
      case 5: if (out->npurifiers >= GW_MAX_GLYPHS) return GW_ERR_CAPACITY;
        out->purifiers[out->npurifiers][0] = a; out->purifiers[out->npurifiers][1] = b;
        out->purifiers[out->npurifiers][2] = c; out->npurifiers++; break;
      case 6: if (out->nanimismus >= GW_MAX_GLYPHS) return GW_ERR_CAPACITY;
        out->animismus[out->nanimismus][0] = a; out->animismus[out->nanimismus][1] = b;
        out->animismus[out->nanimismus][2] = c; out->animismus[out->nanimismus][3] = d; out->nanimismus++; break;
      case 7: if (out->ndisposals >= GW_MAX_GLYPHS) return GW_ERR_CAPACITY;
        out->disposals[out->ndisposals++] = a; break;
      default: return GW_ERR_DECODE;
    }
  }

  /* the reagent pool is fixed: exactly one placement per catalog reagent */
  if (m->ninputs != def->nreagents) return GW_ERR_REAGENTS;
  uint32_t seen = 0;
  for (int i = 0; i < m->ninputs; i++) {
    uint32_t ri = m->inputs[i].ri;
    if (ri >= def->nreagents || (seen & (1u << ri))) return GW_ERR_REAGENTS;
    seen |= 1u << ri;
    place_shape(&def->reagents[ri], m->inputs[i].q, m->inputs[i].r, m->inputs[i].rot, &out->inputs[ri]);
  }
  out->ninputs = def->nreagents;

  if (!m->has_output) return GW_ERR_OUTPUT;
  out->has_output = 1;
  place_shape(&def->product, m->out_q, m->out_r, m->out_rot, &out->output);
  return GW_OK;
}

void gw_verify(const gw_puzzle_def_t *def, const uint8_t *bytes, uint32_t len,
               gw_workspace_t *ws, gw_verdict_t *v) {
  zero(v, sizeof(*v));
  v->cycles = -1; v->sum = -1;
  int err = gw_decode_machine(bytes, len, &ws->m);
  if (err == GW_OK && ws->m.version < 2) err = GW_ERR_LAYOUT;
  if (err == GW_OK) err = gw_materialize(def, &ws->m, &ws->p);
  if (err == GW_OK) err = gw_sim_init(&ws->s, &ws->p, &ws->m);
  if (err != GW_OK) { v->err = err; return; }

  gw_sim_t *S = &ws->s;
  /* the engine faults with EXHAUSTION at the cycle cap; the guard only backs that up */
  int64_t guard = (int64_t)S->caps.cycles + 2;
  while (S->fault_kind == GW_FAULT_NONE && S->cycles < 0 && guard-- > 0) gw_sim_step(S);
  if (S->fault_kind == GW_FAULT_NONE && S->cycles < 0) { S->fault_kind = GW_FAULT_EXHAUSTION; S->fault_tick = S->tick; }

  v->status = S->fault_kind != GW_FAULT_NONE ? GW_STATUS_FAULT : GW_STATUS_VERIFIED;
  v->fault_kind = S->fault_kind;
  v->fault_tick = S->fault_tick;
  v->cost = S->cost; v->cycles = S->cycles; v->area = (int32_t)S->area_count;
  if (v->status == GW_STATUS_VERIFIED) v->sum = S->cost + S->cycles + (int64_t)S->area_count;
}
