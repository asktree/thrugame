// GET /gif/<puzzle>/<code>.gif  → the solution's run as an animated GIF
// GET /png/<puzzle>/<code>.png  → its last frame as a PNG
//
// The renderer is the editor itself: page/editor.html (a copy of the built page)
// runs under jsdom with a native canvas behind every <canvas>, and its
// window.__gwRenderGif records the machine exactly as the Export button does.
// A solution code is deterministic, so the response is cached for good.
import { JSDOM, VirtualConsole } from 'jsdom';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import fs from 'node:fs';
import path from 'node:path';

// the page and the fonts are looked up next to this file's package, wherever the
// platform unpacked it; both are read lazily so a missing file is a reported
// error, not a crash at load
const HERE = path.dirname(new URL(import.meta.url).pathname);
const CANDIDATES = [process.cwd(), path.join(HERE, '..'), '/var/task'];
function locate(rel) {
  for (const base of CANDIDATES) { const p = path.join(base, rel); if (fs.existsSync(p)) return p; }
  throw new Error(rel + ' not found under ' + CANDIDATES.join(', '));
}
let PAGE = null, FONTS = null;
function init() {
  if (PAGE === null) PAGE = fs.readFileSync(locate('page/editor.html'), 'utf8');
  if (FONTS === null) {
    const dir = locate('fonts');
    FONTS = fs.readdirSync(dir).filter(f => /\.(ttf|otf)$/.test(f));
    for (const f of FONTS) GlobalFonts.registerFromPath(path.join(dir, f));
  }
}

// the service's own pacing: the game's 1x tick, 33 frames a second, a whole run
const PACE = { tickMs: 140, frameMs: 30, maxFrames: 1500 };

export async function render(code, pace) {
  init();
  const canvases = new WeakMap();
  const vc = new VirtualConsole();
  const errors = [];
  vc.on('jsdomError', (e) => errors.push(e.message));
  const dom = new JSDOM(PAGE, {
    url: 'http://localhost/', runScripts: 'dangerously', virtualConsole: vc,
    beforeParse(window) {
      window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
      window.requestAnimationFrame = () => 0; window.cancelAnimationFrame = () => {};
      window.TextEncoder = TextEncoder; window.TextDecoder = TextDecoder;
      const HC = window.HTMLCanvasElement.prototype;
      const backing = (el) => {
        const w = el.width || 300, h = el.height || 150;
        let c = canvases.get(el);
        if (!c || c.width !== w || c.height !== h) { c = createCanvas(w, h); canvases.set(el, c); }
        return c;
      };
      // pixels cross from the Node realm into the page's: hand them over as the
      // page's own typed array, or the encoder's instanceof checks refuse them
      HC.getContext = function () {
        const ctx = backing(this).getContext('2d');
        if (!ctx.__gwWrapped) {
          const orig = ctx.getImageData.bind(ctx);
          ctx.getImageData = (...a) => {
            const d = orig(...a);
            return { width: d.width, height: d.height, data: new window.Uint8ClampedArray(d.data.buffer, d.data.byteOffset, d.data.length) };
          };
          ctx.__gwWrapped = true;
        }
        return ctx;
      };
      HC.toDataURL = function (type) { return backing(this).toDataURL(type || 'image/png'); };
    },
  });
  try {
    const w = dom.window;
    if (typeof w.__gwRenderGif !== 'function') throw new Error('the page did not boot: ' + errors.join('; '));
    const out = await w.__gwRenderGif(code, pace || PACE);
    return {
      gif: Buffer.from(out.bytes.buffer, out.bytes.byteOffset, out.bytes.length),
      png: Buffer.from(String(out.still).split(',')[1] || '', 'base64'),
      w: out.w, h: out.h, sum: out.sum, cycles: out.cycles, fault: out.fault,
    };
  } finally {
    dom.window.close();
  }
}

const PUZZLE_RE = /^[a-z][a-z0-9]{0,31}$/, CODE_RE = /^[A-Za-z0-9_-]{1,4000}$/;

// GET /health → what this deployment is running, and whether it can render at all
function health() {
  const h = { ok: true, node: process.version, commit: process.env.VERCEL_GIT_COMMIT_SHA || null, region: process.env.VERCEL_REGION || null, cwd: process.cwd() };
  try { init(); h.page = PAGE.length; h.fonts = FONTS; } catch (e) { h.ok = false; h.error = String(e.message || e); }
  try { createCanvas(2, 2).getContext('2d').fillRect(0, 0, 1, 1); h.canvas = true; } catch (e) { h.ok = false; h.canvas = String(e.message || e); }
  return h;
}

export default async function handler(req, res) {
  try {
    await serve(req, res);
  } catch (e) {
    console.error('gif service failed:', e && e.stack || e);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('gif service failed: ' + String((e && e.message) || e));
  }
}

async function serve(req, res) {
  const url = new URL(req.url, 'http://localhost');
  if (url.searchParams.get('kind') === 'health' || url.pathname.endsWith('/health')) {
    const h = health();
    res.statusCode = h.ok ? 200 : 500;
    res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(h, null, 2));
    return;
  }
  const puzzle = url.searchParams.get('puzzle') || '', code = url.searchParams.get('code') || '';
  const kind = url.searchParams.get('kind') === 'png' ? 'png' : 'gif';
  if (!PUZZLE_RE.test(puzzle) || !CODE_RE.test(code)) { res.statusCode = 400; res.end('expected /gif/<puzzle>/<code>.gif'); return; }
  let out;
  try { out = await render(puzzle + '.' + code); }
  catch (e) {
    console.error('render failed for', puzzle, code.slice(0, 40), e && e.stack || e);
    res.statusCode = 422; res.setHeader('Cache-Control', 'public, max-age=300');
    res.end('cannot render: ' + String((e && e.message) || e)); return;
  }
  res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=31536000, immutable');
  res.setHeader('X-GW-Verdict', out.fault ? 'rejected:' + out.fault.kind : out.sum !== null ? 'sum:' + out.sum : 'unfinished');
  res.setHeader('Content-Type', kind === 'png' ? 'image/png' : 'image/gif');
  const body = kind === 'png' ? out.png : out.gif;
  res.setHeader('Content-Length', String(body.length));
  // streamed, so a long run's GIF is not subject to the platform's response cap
  for (let i = 0; i < body.length; i += 65536) res.write(body.subarray(i, i + 65536));
  res.end();
}

export const config = { supportsResponseStreaming: true, maxDuration: 60 };
