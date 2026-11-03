const crypto = require('node:crypto');
const { providers, expand, ROLE_ALIASES, CITY_ALIASES, category } = require('./providers.cjs');

function buildQuery(profile) {
  const skills = Array.isArray(profile.skills) ? [...new Set(profile.skills.filter(s => typeof s === 'string').map(s => s.trim().slice(0, 100)).filter(Boolean))].slice(0, 20) : [];
  const role = String(profile.target_role || '').trim().slice(0, 100);
  if (!role && !skills.length) throw new Error('简历画像缺少求职方向或技能，请重新解析。');
  return { role, skills, city: String(profile.city || '').slice(0, 100),
    years: profile.years !== null && profile.years !== '' && profile.years !== undefined && Number.isFinite(Number(profile.years)) ? Math.max(0, Number(profile.years)) : null };
}

function safeUrl(value) {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : null; }
  catch { return null; }
}

function rankJobs(rows, query) {
  const unique = new Map();
  for (const row of rows) {
    const url = safeUrl(row.sourceUrl);
    if (!url || typeof row.title !== 'string' || !row.title.trim() || !row.company) continue;
    if (row.active === false) continue;
    const text = [row.title, row.description, row.requirements, ...(Array.isArray(row.tags) ? row.tags : [])].join(' ').toLowerCase();
    const roles = expand(query.role, ROLE_ALIASES);
    const hits = query.skills.filter(skill => text.includes(skill.toLowerCase()));
    const roleHit = roles.some(role => row.title.toLowerCase().includes(role));
    // Require relevant retrieval evidence; an unrelated job never gets a default high score.
    if (!roleHit && !hits.length) continue;
    const cityHit = query.city && row.location && expand(query.city, CITY_ALIASES).some(city => String(row.location).toLowerCase().includes(city));
    if (query.city && !cityHit) continue;
    if (query.years !== null && Number.isFinite(row.minYears) && row.minYears > query.years) continue;
    const match = Math.round((roleHit ? 50 : 0) + 40 * hits.length / Math.max(query.skills.length, 1) + (cityHit ? 10 : 0));
    const key = [String(row.company).trim().toLowerCase(), row.title.trim().toLowerCase(), String(row.location || '').trim()].join('|');
    const id = crypto.createHash('sha256').update(key).digest('hex').slice(0, 20);
    const job = { ...row, id: `live-${id}`, slug: `live-${id}`, sourceUrl: url, match,
      tags: Array.isArray(row.tags) ? row.tags : [],
      category: ['data', 'product', 'tech', 'growth'].includes(row.category) ? row.category : category(row.title),
      days: row.posted && Number.isFinite(Date.parse(row.posted)) ? Math.max(0, Math.floor((Date.now() - Date.parse(row.posted)) / 86400000)) : 9999,
      reason: `方向${roleHit ? '符合' : '待核对'}；命中技能：${hits.join('、') || '未命中'}。匹配分为站内规则评分。` };
    if (!unique.has(key) || unique.get(key).match < match) unique.set(key, job);
  }
  return [...unique.values()].sort((a, b) => b.match - a.match);
}

async function searchSources(query, sources, timeoutMs = 8000) {
  async function querySource(source) {
    if (!source.endpoint && !providers[source.type]) return { source: source.name, status: 'unconfigured', note: source.note || '尚未配置可用数据通路', homepage: source.homepage || '', jobs: [], retrieved: 0 };
    try {
      if (providers[source.type]) {
        const data = await providers[source.type](query, source, AbortSignal.timeout(timeoutMs));
        return { source: source.name, homepage: source.homepage || '', status: 'ok', truncated: data.truncated, retrieved: data.jobs.length, jobs: data.jobs.map(job => ({ ...job, source: source.name })) };
      }
      const headers = { 'Content-Type': 'application/json' };
      if (source.tokenEnv) {
        if (!process.env[source.tokenEnv]) return { source: source.name, status: 'unconfigured', jobs: [] };
        headers.Authorization = `Bearer ${process.env[source.tokenEnv]}`;
      }
      const response = await fetch(source.endpoint, { method: 'POST', headers,
        body: JSON.stringify({ query }), signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) throw new Error('upstream');
      const data = await response.json();
      if (!Array.isArray(data.jobs)) throw new Error('schema');
      return { source: source.name, homepage: source.homepage || '', status: 'ok', retrieved: data.jobs.length, jobs: data.jobs.filter(j => j && typeof j === 'object').map(j => ({ ...j, source: source.name })) };
    } catch (error) {
      const timedOut = ['TimeoutError', 'AbortError'].includes(error.name);
      const http = String(error.message || '').match(/^HTTP \d{3}$/)?.[0];
      const note = timedOut ? '来源响应超时，已跳过' : http ? `招聘来源返回 ${http}` : error.message === 'schema' ? '来源返回登录页、验证页或数据格式已变化' : '无法连接该招聘来源，稍后可重试';
      return { source: source.name, homepage: source.homepage || '', status: timedOut ? 'timeout' : 'failed', note, jobs: [], retrieved: 0 };
    }
  }
  // Bound active sources so one provider cannot exhaust Worker outbound connections.
  const results = new Array(sources.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(3, sources.length) }, async () => {
    while (cursor < sources.length) { const index = cursor++; results[index] = await querySource(sources[index]); }
  }));
  const jobs = rankJobs(results.flatMap(result => result.jobs), query);
  return { jobs, total: jobs.length, sources: results.map(({ jobs: sourceJobs, ...source }) => ({ ...source, matched: jobs.filter(job => job.source === source.source).length })), searchedAt: new Date().toISOString() };
}

module.exports = { buildQuery, rankJobs, searchSources };
