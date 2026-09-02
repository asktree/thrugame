# GIF service

Renders a solution code to an animated GIF on demand, so every leaderboard entry
has a stable image link and nothing is ever uploaded.

    GET /gif/<puzzle>/<code>.gif   the run, 480px wide, at the game's 1x speed, 33 fps
    GET /png/<puzzle>/<code>.png   the last frame

The renderer is the editor page itself (`page/editor.html`, written by
`node lab/build.js` alongside `demo/editor.html`). It runs under jsdom with
`@napi-rs/canvas` behind every `<canvas>`, and the page's `window.__gwRenderGif`
records the machine exactly the way the Export GIF button does. Fonts are
vendored in `fonts/` (Courier Prime and EB Garamond, both OFL).

## Deploy (Vercel)

1. Import the repository into a Vercel project; set **Root Directory** to `gifsvc`.
   No framework, no build command.
2. Deploy. The function answers at `https://<project>.vercel.app/gif/...`.
3. Optional: add the domain `gif.greatwork.quest` to the project and a CNAME for
   it at the registrar; the editor links there (`GIF_SERVICE` in
   `lab/editor-template.html`).

Responses are immutable per code and cached at the CDN for a year, so a solution
is rendered once. A render takes a few seconds for a typical run; the function
allows 60. Frames after the first store only the pixels that changed, so a
whole run stays small (courier 1.6 MB, goldladder 3.7 MB for 39 seconds), and
the body is streamed so the platform's response cap does not apply.

## Local

    cd gifsvc && npm install && npm run dev
    curl -o run.gif http://localhost:8791/gif/amalgam/<code>.gif
