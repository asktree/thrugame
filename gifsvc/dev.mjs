// local stand-in for Vercel: node dev.mjs → http://localhost:8791/gif/<puzzle>/<code>.gif
import http from 'node:http';
import handler from './api/gif.js';
const port = +(process.env.PORT || 8791);
http.createServer(async (req, res) => {
  const m = req.url.match(/^\/(gif|png)\/([^/]+)\/([^/.]+)\.(gif|png)$/);
  if (req.url === '/health') req.url = '/api/gif?kind=health';
  else if (!m) { res.writeHead(404); res.end('expected /gif/<puzzle>/<code>.gif or /png/<puzzle>/<code>.png'); return; }
  else req.url = '/api/gif?puzzle=' + m[2] + '&code=' + m[3] + (m[1] === 'png' ? '&kind=png' : '');
  const t = Date.now();
  await handler(req, res);
  console.log(res.statusCode, req.url.slice(0, 80), (Date.now() - t) + 'ms');
}).listen(port, () => console.log('gif service on http://localhost:' + port));
