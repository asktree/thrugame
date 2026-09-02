// local stand-in for Vercel: node dev.mjs → http://localhost:8791/gif/<puzzle>/<code>.gif
import http from 'node:http';
import handler from './api/gif.js';
const port = +(process.env.PORT || 8791);
http.createServer(async (req, res) => {
  const m = req.url.match(/^\/(gif|png)\/([^/]+)\/([^/.]+)\.(gif|png)$/);
  if (!m) { res.writeHead(404); res.end('expected /gif/<puzzle>/<code>.gif or /png/<puzzle>/<code>.png'); return; }
  req.url = '/api/gif?puzzle=' + m[2] + '&code=' + m[3] + (m[1] === 'png' ? '&kind=png' : '');
  const shim = {
    status(c) { res.statusCode = c; return shim; },
    setHeader(k, v) { res.setHeader(k, v); return shim; },
    send(b) { res.end(b); },
  };
  const t = Date.now();
  await handler(req, shim);
  console.log(res.statusCode, req.url.slice(0, 80), (Date.now() - t) + 'ms');
}).listen(port, () => console.log('gif service on http://localhost:' + port));
