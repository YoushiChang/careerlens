const { buildQuery, searchSources } = require('./match.cjs');
const { createServer } = require('../server.cjs');
const sources = require('./sources.example.json');

async function main() {
  // Real HTTP request through the gateway; output only result metadata and public job links.
  const server = createServer(sources);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const profile = { target_role: '数据分析', skills: ['SQL', 'Python'], city: '', years: 5 };
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/jobs/search`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profile }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    const counts = Object.fromEntries(result.sources.map(source => [source.source, result.jobs.filter(job => job.source === source.source).length]));
    console.log(JSON.stringify({ total: result.total, sources: result.sources.map(source => ({ ...source, matched: counts[source.source] })), examples: result.jobs.slice(0, 3).map(job => ({ title: job.title, location: job.location, sourceUrl: job.sourceUrl })) }, null, 2));
    if (result.sources.filter(source => source.status === 'ok').length < 2 || !result.total) throw new Error('Need at least two successful real sources and nonempty results');
    const other = await searchSources(buildQuery({ skills: ['SQL'], city: '上海', years: 1 }), sources);
    console.log(JSON.stringify({ secondQuery: 'SQL / 上海 / 1年', total: other.total, sourceStatus: other.sources.map(source => [source.source, source.status]) }));
    if (other.jobs.some(job => !/上海|shanghai/i.test(job.location))) throw new Error('City filter failed');
  } finally { server.closeAllConnections(); server.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
