const ROLE_ALIASES = {
  '产品经理': ['product manager'], '数据分析': ['data analyst', 'data analytics'],
  '数据科学': ['data scientist'], '算法': ['machine learning', 'research engineer'],
  '前端': ['frontend', 'front end'], '后端': ['backend', 'back end'],
  '用户增长': ['growth'], '软件工程师': ['software engineer'],
};
const CITY_ALIASES = { '上海': ['shanghai'], '北京': ['beijing'], '深圳': ['shenzhen'], '广州': ['guangzhou'], '杭州': ['hangzhou'], '香港': ['hong kong'], '新加坡': ['singapore'], '伦敦': ['london'], '旧金山': ['san francisco'], '纽约': ['new york'] };
function expand(value, aliases) {
  const original = String(value || '').toLowerCase().split(/[,，、/|;；]+/).map(v => v.trim()).filter(Boolean);
  return [...new Set([...original, ...Object.entries(aliases).filter(([key]) => original.some(v => v.includes(key))).flatMap(([, list]) => list)])];
}
function plain(value) {
  return String(value || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
}
function category(title) {
  return /增长|growth/i.test(title) ? 'growth' : /产品|product/i.test(title) ? 'product' : /数据|分析|data|analytics/i.test(title) ? 'data' : /工程|算法|开发|技术|engineer|developer|research/i.test(title) ? 'tech' : 'other';
}
function minYears(value) {
  const match = String(value || '').match(/(\d+|[一二两三四五六七八九十])(?:\s*[-–至]\s*\d+)?\s*年/);
  const digits = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  return match ? (digits[match[1]] || Number(match[1])) : undefined;
}
function keywords(query) { return [...new Set([...expand(query.role, ROLE_ALIASES), ...query.skills])].slice(0, 3); }
async function getJson(url, signal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}
async function searchTencent(query, source, signal) {
  const batches = await Promise.allSettled(keywords(query).map(async keyword => {
    const jobs = [];
    let truncated = false;
    for (let page = 1; page <= 3; page++) {
      const url = new URL('https://careers.tencent.com/tencentcareer/api/post/Query');
      url.search = new URLSearchParams({ keyword, pageIndex: String(page), pageSize: '30', language: 'zh-cn', area: 'cn' });
      const data = await getJson(url, signal);
      if (data.Code !== 200 || !Array.isArray(data.Data?.Posts)) throw new Error('schema');
      jobs.push(...data.Data.Posts.map(post => ({ sourceId: String(post.PostId), title: post.RecruitPostName,
        company: post.ComName || '腾讯', location: post.LocationName, description: post.Responsibility,
        exp: post.RequireWorkYearsName, minYears: minYears(post.RequireWorkYearsName),
        sourceUrl: post.PostURL, active: post.IsValid !== false, posted: post.LastUpdateTime })));
      if (page * 30 >= data.Data.Count || !data.Data.Posts.length) break;
      truncated = page === 3;
    }
    return { jobs, truncated };
  }));
  return mergeBatches(batches);
}
function mergeBatches(batches) {
  const successful = batches.filter(batch => batch.status === 'fulfilled');
  if (!successful.length) throw batches[0].reason;
  return { jobs: successful.flatMap(batch => batch.value.jobs), truncated: successful.length < batches.length || successful.some(batch => batch.value.truncated) };
}
function parseZhilian(html) {
  const raw = html.match(/__INITIAL_STATE__\s*=\s*([\s\S]*?)<\/script>/)?.[1]?.trim().replace(/;$/, '');
  if (!raw) throw new Error('schema');
  const data = JSON.parse(raw); // Never execute a remote script.
  if (data.isVerification || !Array.isArray(data.positionList)) throw new Error('schema');
  const jobs = data.positionList.map(post => {
    const position = post.jobDetailData?.position;
    const base = position?.base || {};
    const location = post.workCity || post.cityName || position?.workLocation?.city || '';
    return { sourceId: post.positionNumber || base.positionNumber, title: post.positionName || base.positionName, company: post.companyName,
      location: typeof location === 'string' ? location : '',
      sourceUrl: post.positionUrl || post.positionURL || (post.positionNumber ? `https://jobs.zhaopin.com/${encodeURIComponent(post.positionNumber)}.htm` : ''),
      salary: post.salary || base.salary || post.salary60, industry: post.industryName,
      exp: post.positionWorkingExp || post.workingExp || base.positionWorkingExp, minYears: minYears(post.positionWorkingExp || post.workingExp || base.positionWorkingExp),
      description: plain(position?.desc?.description), tags: position?.desc?.labels || [],
      posted: position?.date?.positionUpdateTimeText };
  });
  return { jobs, truncated: Number(data.positionCount) > jobs.length || Number(data.pages) > 1 };
}
async function searchZhilian(query, source, signal) {
  return mergeBatches(await Promise.allSettled(keywords(query).slice(0, 2).map(async keyword => {
    const url = new URL('https://sou.zhaopin.com/');
    url.searchParams.set('kw', keyword);
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();
    try { return parseZhilian(html); }
    catch {
      // Follow the current canonical public search URL if the legacy host is blocked.
      const fallback = new URL('https://www.zhaopin.com/sou/');
      fallback.searchParams.set('kw', keyword);
      const retry = await fetch(fallback, { signal });
      if (!retry.ok) throw new Error(`HTTP ${retry.status}`);
      return parseZhilian(await retry.text());
    }
  })));
}

async function searchCompany(query, source, signal) {
  const batches = [];
  // Keep each source to one in-flight request for the hosted runtime connection limit.
  for (const keyword of keywords(query).slice(0, 2)) {
    try {
      const jobs = [];
      let truncated = false;
      for (let page = 1; page <= 2; page++) {
        let data;
        if (source.type === 'xiaomi') {
          const url = new URL('https://hr.xiaomi.com/website/api/agent/searchJobPage');
          url.search = new URLSearchParams({ keyword, pageNum: String(page), pageSize: '30', cityZhNames: query.city || '' });
          const response = await getJson(url, signal);
          if (response.code !== 0 || !Array.isArray(response.data?.list)) throw new Error('schema');
          data = response.data;
          jobs.push(...data.list.map(post => ({ sourceId: String(post.jobPostId || post.id), title: post.title,
            company: '小米', location: (post.cityZhNames || []).join(' / '), description: post.description,
            requirements: post.requirement, sourceUrl: post.url, posted: post.publishTime,
            employmentType: post.type === 3 ? 'internship' : post.type === 2 ? 'campus' : 'experienced' })));
        } else if (source.type === 'netease') {
          const response = await fetch('https://hr.163.com/api/hr163/position/queryPage', { method: 'POST',
            headers: { 'Content-Type': 'application/json' }, signal,
            body: JSON.stringify({ currentPage: page, pageSize: 30, keyword }) });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const result = await response.json();
          if (result.code !== 200 || !Array.isArray(result.data?.list)) throw new Error('schema');
          data = result.data;
          jobs.push(...data.list.map(post => ({ sourceId: String(post.id), title: post.name, company: '网易',
            location: (post.workPlaceNameList || []).join(' / '), description: post.description, requirements: post.requirement,
            exp: post.reqWorkYearsName, minYears: minYears(post.reqWorkYearsName),
            sourceUrl: `https://hr.163.com/job-detail.html?id=${encodeURIComponent(post.id)}`,
            posted: post.updateTime ? new Date(post.updateTime).toISOString() : '' })));
        } else {
          const response = await fetch('https://career.meituan.com/api/official/job/getJobList', { method: 'POST',
            headers: { 'Content-Type': 'application/json' }, signal,
            body: JSON.stringify({ page: { pageNo: page, pageSize: 30 }, keywords: keyword, jobShareType: '1' }) });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const result = await response.json();
          if (!Array.isArray(result.data?.list)) throw new Error('schema');
          data = { list: result.data.list, total: result.data.page?.totalCount || result.data.totalCount || 0 };
          jobs.push(...data.list.map(post => ({ sourceId: post.jobUnionId, title: post.name,
            company: '美团', location: (post.cityList || []).map(city => city.name).join(' / '),
            description: post.jobDuty, requirements: post.jobRequirement,
            sourceUrl: `https://career.meituan.com/web/position/detail?jobUnionId=${encodeURIComponent(post.jobUnionId)}` })));
        }
        if (page * 30 >= Number(data.total) || !data.list.length) break;
        truncated = page === 2;
      }
      batches.push({ status: 'fulfilled', value: { jobs, truncated } });
    } catch (reason) { batches.push({ status: 'rejected', reason }); }
  }
  return mergeBatches(batches);
}
async function searchBoard(query, source, signal) {
  const board = encodeURIComponent(source.board);
  let jobs;
  let truncated = false;
  if (source.type === 'greenhouse') {
    const data = await getJson(`https://boards-api.greenhouse.io/v1/boards/${board}/jobs?content=true`, signal);
    if (!Array.isArray(data.jobs)) throw new Error('schema');
    jobs = data.jobs.map(job => ({ sourceId: String(job.id), title: job.title, company: source.company,
      location: job.location?.name, description: plain(job.content), sourceUrl: job.absolute_url, posted: job.updated_at }));
  } else if (source.type === 'ashby') {
    const data = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${board}`, signal);
    if (!Array.isArray(data.jobs)) throw new Error('schema');
    jobs = data.jobs.filter(job => job.isListed !== false).map(job => ({ sourceId: job.id, title: job.title,
      company: source.company, location: [job.location, ...(job.secondaryLocations || []).map(l => l.location)].filter(Boolean).join(' / '),
      description: job.descriptionPlain || plain(job.descriptionHtml), sourceUrl: job.jobUrl,
      posted: job.publishedAt, remote: job.isRemote === true }));
  } else {
    jobs = [];
    for (let page = 0; page < 3; page++) {
      const data = await getJson(`https://api.lever.co/v0/postings/${board}?mode=json&skip=${page * 100}&limit=100`, signal);
      if (!Array.isArray(data)) throw new Error('schema');
      jobs.push(...data.map(job => ({ sourceId: job.id, title: job.text, company: source.company,
        location: job.categories?.allLocations?.join(' / ') || job.categories?.location,
        description: [job.descriptionPlain || plain(job.description), ...(job.lists || []).map(list => plain(list.content))].join(' '),
        sourceUrl: job.hostedUrl, posted: job.createdAt ? new Date(job.createdAt).toISOString() : '', remote: job.workplaceType === 'remote' })));
      if (data.length < 100) break;
      truncated = page === 2;
    }
  }
  // These board APIs expose one company's published roles, with no full-text search parameter.
  // Read on demand, then filter before returning to the gateway; never use the static demo catalog.
  const roles = expand(query.role, ROLE_ALIASES);
  jobs = jobs.filter(job => {
    const text = `${job.title} ${job.description}`.toLowerCase();
    return roles.some(role => String(job.title).toLowerCase().includes(role)) || query.skills.some(skill => text.includes(skill.toLowerCase()));
  });
  return { jobs, truncated };
}
const providers = { tencent: searchTencent, zhilian: searchZhilian, greenhouse: searchBoard, lever: searchBoard, ashby: searchBoard, xiaomi: searchCompany, netease: searchCompany, meituan: searchCompany };
module.exports = { providers, expand, ROLE_ALIASES, CITY_ALIASES, plain, parseZhilian, category };
