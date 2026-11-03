const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { buildQuery, searchSources } = require('./gateway/match.cjs');
const root = __dirname;
const config = path.join(root, 'gateway', 'sources.local.json');
const sources = JSON.parse(fs.readFileSync(fs.existsSync(config) ? config : path.join(root, 'gateway', 'sources.example.json'), 'utf8').replace(/^\uFEFF/, ''));
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg' };
function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}
function createServer(configuredSources = sources) {
  return http.createServer(async (req, res) => {
    if (req.url === '/api/jobs/search') {
      if (req.method !== 'POST') return json(res, 405, { error: '请使用 POST 请求' });
      // The local gateway is same-origin only; third-party pages cannot submit resume queries.
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return json(res, 403, { error: '不允许跨站请求' });
      let body = '';
      try {
        for await (const chunk of req) {
          body += chunk;
          if (Buffer.byteLength(body) > 32768) return json(res, 413, { error: '请求过大' });
        }
        const query = buildQuery(JSON.parse(body).profile || {});
        return json(res, 200, await searchSources(query, configuredSources));
      } catch { return json(res, 400, { error: '简历画像无效，需要求职方向或技能。' }); }
    }
    if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { error: '不支持的请求方法' });
    let relative;
    try { relative = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/+/, '') || 'index.html'; }
    catch { return json(res, 400, { error: '无效地址' }); }
    // Serve only public demo assets; never expose source configuration or server files.
    if (!/^(?:[a-zA-Z0-9-]+\.html|assets\/[a-zA-Z0-9_./-]+\.(?:js|css|png|jpg|svg))$/.test(relative) || relative.split('/').includes('..')) return json(res, 404, { error: '页面不存在' });
    try {
      const data = await fs.promises.readFile(path.join(root, relative));
      res.writeHead(200, { 'Content-Type': mime[path.extname(relative)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch { json(res, 404, { error: '页面不存在' }); }
  });
}
if (require.main === module) createServer().listen(Number(process.env.PORT || 8088), '127.0.0.1', () => console.log(`CareerLens: http://127.0.0.1:${process.env.PORT || 8088}/index.html`));
module.exports = { createServer };
