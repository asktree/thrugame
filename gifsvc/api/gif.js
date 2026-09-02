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

const ROOT = process.cwd();
const PAGE = fs.readFileSync(path.join(ROOT, 'page', 'editor.html'), 'utf8');
for (const f of fs.readdirSync(path.join(ROOT, 'fonts'))) {
  if (/\.(ttf|otf)$/.test(f)) GlobalFonts.registerFromPath(path.join(ROOT, 'fonts', f));
}

// the service's own pacing: a whole run, not the editor's 12-second clip
const PACE = { tickMs: 100, frameMs: 80, maxFrames: 600 };

export async function render(code, pace) {
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

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const puzzle = url.searchParams.get('puzzle') || '', code = url.searchParams.get('code') || '';
  const kind = url.searchParams.get('kind') === 'png' ? 'png' : 'gif';
  if (!PUZZLE_RE.test(puzzle) || !CODE_RE.test(code)) { res.status(400).send('expected /gif/<puzzle>/<code>.gif'); return; }
  let out;
  try { out = await render(puzzle + '.' + code); }
  catch (e) { res.status(422).setHeader('Cache-Control', 'public, max-age=300').send('cannot render: ' + String((e && e.message) || e)); return; }
  res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=31536000, immutable');
  res.setHeader('X-GW-Verdict', out.fault ? 'rejected:' + out.fault.kind : out.sum !== null ? 'sum:' + out.sum : 'unfinished');
  res.setHeader('Content-Type', kind === 'png' ? 'image/png' : 'image/gif');
  const body = kind === 'png' ? out.png : out.gif;
  res.setHeader('Content-Length', String(body.length));
  // streamed, so a long run's GIF is not subject to the platform's response cap
  if (typeof res.write === 'function') {
    for (let i = 0; i < body.length; i += 65536) res.write(body.subarray(i, i + 65536));
    res.end();
  } else res.send(body);
}

export const config = { supportsResponseStreaming: true, maxDuration: 60 };
