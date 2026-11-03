const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { buildQuery, rankJobs, searchSources } = require('./match.cjs');
const { parseZhilian } = require('./providers.cjs');
const { createServer } = require('../server.cjs');
const fixture = { title: '数据分析师', company: '测试公司', location: '上海', description: 'SQL 数据分析', sourceUrl: 'https://example.com/jobs/1', sourceId: '1' };
async function listen(server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

test('unknown years stay unknown; empty skills are removed; missing query is rejected', () => {
  assert.equal(buildQuery({ skills: ['SQL'], years: null }).years, null);
  assert.deepEqual(buildQuery({ skills: [' SQL ', 'SQL', ''] }).skills, ['SQL']);
  assert.throws(() => buildQuery({ skills: ['', ' '] }));
});

test('query changes results; unrelated, expired, unsafe and ineligible jobs are excluded', () => {
  const rows = [fixture, { ...fixture }, { ...fixture, title: '护士', description: '护理', sourceUrl: 'https://example.com/2' },
    { ...fixture, title: '资深分析师', minYears: 8 }, { ...fixture, active: false }, { ...fixture, sourceUrl: 'javascript:alert(1)' }];
  const query = buildQuery({ target_role: '数据分析师', skills: ['SQL'], city: '上海', years: 2 });
  assert.equal(rankJobs(rows, query).length, 1);
  assert.equal(rankJobs(rows, { ...query, city: '深圳' }).length, 0);
  assert.equal(rankJobs([fixture], buildQuery({ target_role: '护士', skills: ['护理'] })).length, 0);
  const english = { ...fixture, title: 'Product Manager', location: 'Shanghai', description: 'SQL' };
  assert.equal(rankJobs([english], buildQuery({ target_role: '高级产品经理', skills: ['SQL'], city: '上海' }))[0].match, 100);
});

test('Zhilian embedded state is parsed as JSON, and missing state is rejected', () => {
  const data = { positionList: [{ positionName: 'SQL分析师', companyName: '公司', positionNumber: 'ABC', workCity: '上海', positionWorkingExp: '3-5年', jobDetailData: { position: { desc: { description: '<p>SQL</p>', labels: ['SQL'] } } } }], pages: 3 };
  const parsed = parseZhilian(`<script>__INITIAL_STATE__=${JSON.stringify(data)};</script>`);
  assert.equal(parsed.jobs[0].minYears, 3);
  assert.equal(parsed.jobs[0].description, 'SQL');
  assert.equal(parsed.truncated, true);
  const nested = { ...data, positionList: [{ workCity: '上海', workingExp: '1-3年', companyName: '测试公司', positionURL: 'https://example.com/jobs/1', jobDetailData: { position: { base: { positionName: '数据分析师', positionNumber: 'XYZ' }, desc: { description: 'SQL' } } } }] };
  const nestedJob = parseZhilian(`<script>__INITIAL_STATE__=${JSON.stringify(nested)}</script>`).jobs[0];
  assert.equal(nestedJob.title, '数据分析师');
  assert.equal(nestedJob.sourceId, 'XYZ');
  assert.equal(nestedJob.minYears, 1);
  assert.throws(() => parseZhilian('<html>login required</html>'));
});

test('a failed or timed-out source does not discard successful source results', async t => {
  const upstream = http.createServer(async (req, res) => {
    if (req.url === '/slow') return; // Closed by cleanup after the gateway aborts.
    if (req.url === '/bad') { res.writeHead(503); return res.end(); }
    let body = '';
    for await (const chunk of req) body += chunk;
    const data = JSON.parse(body);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ jobs: data.query.skills.includes('SQL') ? [fixture] : [] }));
  });
  const base = await listen(upstream);
  t.after(() => { upstream.closeAllConnections(); upstream.close(); });
  const result = await searchSources(buildQuery({ skills: ['SQL'] }), [
    { name: 'ok', endpoint: base + '/ok' }, { name: 'bad', endpoint: base + '/bad' },
    { name: 'slow', endpoint: base + '/slow' }, { name: 'not configured' },
  ], 150);
  assert.equal(result.total, 1);
  assert.deepEqual(result.sources.map(s => s.status), ['ok', 'failed', 'timeout', 'unconfigured']);
  const next = await searchSources(buildQuery({ skills: ['Python'] }), [{ name: 'ok', endpoint: base + '/ok' }]);
  assert.equal(next.total, 0);
});

test('HTTP gateway serves public pages, rejects invalid requests and hides configuration', async t => {
  const upstream = http.createServer((req, res) => res.end(JSON.stringify({ jobs: [fixture] })));
  const upstreamUrl = await listen(upstream);
  const gateway = createServer([{ name: 'fixture source', endpoint: upstreamUrl }]);
  const base = await listen(gateway);
  t.after(() => { gateway.closeAllConnections(); gateway.close(); upstream.closeAllConnections(); upstream.close(); });
  assert.equal((await fetch(base + '/index.html')).status, 200);
  assert.equal((await fetch(base + '/gateway/sources.local.json')).status, 404);
  assert.equal((await fetch(base + '/server.cjs')).status, 404);
  assert.equal((await fetch(base + '/api/jobs/search')).status, 405);
  const send = (profile, origin) => fetch(base + '/api/jobs/search', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify({ profile }) });
  assert.equal((await send({})).status, 400);
  assert.equal((await send({ skills: ['SQL'] }, 'https://unrelated.example')).status, 403);
  const result = await (await send({ skills: ['SQL'], city: '上海' })).json();
  assert.equal(result.total, result.jobs.length);
  assert.equal(result.total, 1);
  assert.equal(result.jobs[0].source, 'fixture source');
});
