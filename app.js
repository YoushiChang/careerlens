'use strict';

(() => {
  let jobs = Array.isArray(window.CAREERLENS_JOBS) ? window.CAREERLENS_JOBS : [];
  const bySlug = new Map(jobs.map((job) => [job.slug, job]));
  const byId = new Map(jobs.map((job) => [job.id, job]));
  const params = new URLSearchParams(window.location.search);
  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));

  const WEIGHT_KEYS = ['growth', 'outlook', 'balance', 'stability'];
  const WEIGHT_LABELS = {
    growth: '成长空间',
    outlook: '业务前景',
    balance: '工作生活平衡',
    stability: '业务稳定性',
  };
  const STORE_APPLIED = 'careerlens-demo-applied';
  const STORE_SAVED = 'careerlens-demo-saved';

  /* ---------- Storage helpers (safe on file://) ---------- */

  function readStore(key) {
    try {
      const value = JSON.parse(window.localStorage.getItem(key) || '[]');
      return Array.isArray(value) ? value : [];
    } catch (error) {
      return [];
    }
  }

  function writeStore(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      // localStorage can be restricted for file:// pages; query-string fallback still works.
    }
  }

  function addToStore(key, slug) {
    if (!bySlug.has(slug)) return;
    const current = readStore(key);
    if (!current.includes(slug)) {
      current.push(slug);
      writeStore(key, current);
    }
  }

  function removeFromStore(key, slug) {
    const current = readStore(key).filter((item) => item !== slug);
    writeStore(key, current);
  }

  /* ---------- Toast ---------- */

  let toastStack = null;

  function showToast(title, message = '') {
    if (!toastStack) {
      toastStack = document.createElement('div');
      toastStack.className = 'toast-stack';
      toastStack.setAttribute('aria-live', 'polite');
      document.body.appendChild(toastStack);
    }

    const toast = document.createElement('div');
    toast.className = 'demo-toast';
    toast.innerHTML = `<span class="toast-spark">✦</span><div><strong>${escapeHtml(title)}</strong>${message ? `<p>${escapeHtml(message)}</p>` : ''}</div>`;
    toastStack.appendChild(toast);

    window.setTimeout(() => {
      toast.classList.add('is-leaving');
      window.setTimeout(() => toast.remove(), 240);
    }, 3200);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[character]));
  }

  /* ---------- Jobs page: filter, sort, personalized scores ---------- */

  function readWeights() {
    if (!WEIGHT_KEYS.some((key) => params.has(key))) return null;
    const weights = {};
    WEIGHT_KEYS.forEach((key) => {
      weights[key] = Math.max(0, Math.min(60, Number(params.get(key) || 0)));
    });
    const total = WEIGHT_KEYS.reduce((sum, key) => sum + weights[key], 0);
    return total > 0 ? weights : null;
  }

  function weightedScore(job, weights) {
    const total = WEIGHT_KEYS.reduce((sum, key) => sum + weights[key], 0);
    const fit =
      (job.fit.growth * weights.growth +
        job.fit.outlook * weights.outlook +
        job.fit.balance * weights.balance +
        job.fit.stability * weights.stability) /
      total;
    return Math.max(60, Math.min(99, Math.round(job.match * 0.78 + fit * 0.22)));
  }

  async function initJobsPage() {
    const feed = $('#jobFeed');
    if (!feed) return;

    let profile = null;
    try { profile = JSON.parse(localStorage.getItem('careerlens-profile') || 'null'); } catch {}
    const demo = params.get('demo') === '1';
    if (profile && !demo) {
      const keyword = profile.target_role || (Array.isArray(profile.skills) ? profile.skills[0] : '') || '';
      const links = {
        bossSearch: 'https://www.zhipin.com/web/geek/job?query=' + encodeURIComponent(keyword),
        linkedinSearch: 'https://www.linkedin.com/jobs/search/?keywords=' + encodeURIComponent(keyword) + '&location=' + encodeURIComponent(profile.city || ''),
        job51Search: 'https://we.51job.com/pc/search?keyword=' + encodeURIComponent(keyword),
      };
      Object.entries(links).forEach(([id, href]) => { const link = $('#' + id); if (link) link.href = href; });
    }
    if (!profile && !demo) {
      const name = $('.side-person div strong');
      const role = $('.side-person div span');
      if (name) name.textContent = '尚未解析简历';
      if (role) role.textContent = '上传后开始查询';
      $$('.side-tags span').forEach(tag => { tag.hidden = true; });
    }
    const status = $('#gatewayStatus');
    const setStatus = (message) => { if (status) status.textContent = message; };
    const sourceDialog = $('#sourceDialog');
    const sourceBadge = $('#sourceBadge');
    if (sourceBadge && sourceDialog) sourceBadge.addEventListener('click', () => sourceDialog.showModal());
    const closeSourceDialog = $('#closeSourceDialog');
    if (closeSourceDialog && sourceDialog) closeSourceDialog.addEventListener('click', () => sourceDialog.close());
    if (sourceDialog) sourceDialog.addEventListener('click', event => { if (event.target === sourceDialog) { const rect = sourceDialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) sourceDialog.close(); } });
    let sourceResults = [];
    jobs = [];
    if (demo) {
      jobs = window.CAREERLENS_JOBS || [];
      setStatus('本地样例库预览：未查询招聘网站，数量和评分仅供演示。');
    } else if (!profile) {
      setStatus('请先上传并解析简历，再根据你的方向和技能查询岗位。');
    } else {
      setStatus('正在根据简历查询可用招聘来源，请稍候…');
      if ($('#sourceBadgeText')) $('#sourceBadgeText').textContent = '来源 · 查询中';
      try {
        const apiBase = String(window.CAREERLENS_API_BASE || '').replace(/\/$/, '');
        const response = await fetch(apiBase + '/api/jobs/search', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ profile: { target_role: profile.target_role, skills: profile.skills, city: profile.city, years: profile.years } }),
          signal: AbortSignal.timeout(45000),
        });
        if (!response.ok) throw new Error('gateway');
        const result = await response.json();
        if (!Array.isArray(result.jobs) || !Array.isArray(result.sources)) throw new Error('schema');
        jobs = result.jobs;
        sourceResults = result.sources;
        const labels = { ok: '查询成功', unconfigured: '未接入', timeout: '超时，已跳过', failed: '不可用，已跳过' };
        const available = sourceResults.filter(s => s.status === 'ok').length;
        setStatus(`本次匹配 ${jobs.length} 个岗位 · ${available} 个来源查询成功。点击右上角“来源”查看详情。`);
        if ($('#sourceBadgeText')) $('#sourceBadgeText').textContent = `来源 ${available}/${sourceResults.length}`;
        if ($('#sourceDialogSummary')) $('#sourceDialogSummary').textContent = `${available} / ${sourceResults.length} 个来源查询成功 · 本次匹配 ${jobs.length} 个岗位`;
        const sourceList = $('#sourceStatusList');
        if (sourceList) {
          sourceList.replaceChildren();
          sourceResults.forEach(source => {
            const row = document.createElement('article');
            row.className = 'source-status-row';
            row.dataset.status = source.status;
            const title = document.createElement('strong'); title.textContent = source.source;
            const state = document.createElement('span'); state.className = 'source-state'; state.textContent = labels[source.status] || '查询失败';
            const note = document.createElement('p');
            note.textContent = source.status === 'ok' ? `读取 ${source.retrieved ?? '—'} 个 · 匹配 ${source.matched || 0} 个${source.truncated ? ' · 部分结果' : ''}` : source.note || '本次未返回可用岗位';
            row.append(title, state, note);
            if (source.homepage) { try { const url = new URL(source.homepage); if (url.protocol === 'https:') { const link = document.createElement('a'); link.href = url.href; link.textContent = '前往招聘原站 ↗'; link.target = '_blank'; link.rel = 'noopener noreferrer'; row.appendChild(link); } } catch {} }
            sourceList.appendChild(row);
          });
        }
      } catch {
        if ($('#sourceBadgeText')) $('#sourceBadgeText').textContent = '来源 · 查询失败';
        setStatus('岗位查询服务暂不可用，请稍后重试。未加载历史样例充当推荐结果。');
      }
    }
    feed.replaceChildren();
    jobs.forEach(job => { byId.set(job.id, job); bySlug.set(job.slug, job); });
    const stats = $$('.engine-stat strong');
    if (stats[0]) stats[0].textContent = jobs.length;
    if (stats[1]) stats[1].textContent = demo ? '0' : sourceResults.filter(s => s.status === 'ok').length;
    if (stats[2]) stats[2].textContent = profile && Array.isArray(profile.skills) ? profile.skills.length : '0';
    const sourceStrip = $('.source-strip');
    if (sourceStrip) sourceStrip.textContent = demo ? '本地历史样例 · 未实时核验在招状态' : '根据本次简历查询 · 合并去重后展示 · 来源状态见上方';
    const engineTitle = $('.engine-side h3');
    if (engineTitle) engineTitle.textContent = demo ? '样例库预览' : '简历驱动的岗位查询';
    const insightTitle = $('.side-tip h3');
    const insightText = $('.side-tip p');
    if (insightTitle) insightTitle.textContent = '按求职方向、技能和城市寻找机会';
    if (insightText) insightText.textContent = '本次结果数量取决于可用来源返回的岗位；没有合适岗位时显示 0。';

    // Render this query's results; static data is used only in explicit demo mode.
    const detailPages = {
      "xhs-ecommerce-growth-pm":"job-xhs-growth.html",
      "xhs-ai-data-pm":"job-xhs-ai-data.html",
      "bytedance-ai-data-pm":"job-bd-ai-data.html",
      "bytedance-merchant-ai-pm":"job-bd-merchant-ai.html",
      "dewu-cps-growth-pm":"job-dewu-cps.html",
      "dewu-life-service-pm":"job-dewu-trade.html",
    };
    jobs.forEach((job) => {
      const a = document.createElement('a');
      a.className = 'job-card';
      let sourceUrl = '#';
      try { const url = new URL(job.sourceUrl); if (['http:', 'https:'].includes(url.protocol)) sourceUrl = url.href; } catch {}
      a.href = detailPages[job.id] || sourceUrl;
      if (!detailPages[job.id]) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
      a.dataset.jobId = job.id;
      a.dataset.category = job.category || 'data';
      a.dataset.score = String(job.match ?? 0);
      a.dataset.days = String(job.days ?? 9999);
      const tags = (job.tags || []).slice(0,4).map((t)=>`<span>${escapeHtml(t)}</span>`).join('');
      // All upstream strings are untrusted, including titles and match explanations.
      const display = Object.fromEntries(Object.entries(job).map(([key, value]) => [key, typeof value === 'string' ? escapeHtml(value) : value]));
      a.innerHTML = `
        <div class="job-card-top">
          <span class="company-logo">${escapeHtml(job.logo || String(job.company || '?')[0])}</span>
          <div class="job-card-main">
            <div class="job-title-row"><h2>${display.title}</h2><span class="job-score"><span class="job-score-number">${Number(job.match) || 0}</span><small>%</small></span></div>
            <p class="company-line"><strong>${display.company}</strong><span> · </span>${display.industry || ''}</p>
            <div class="job-meta"><span>${display.location || '地点未提供'}</span><span class="salary">${display.salary || '薪资未公开'}</span><span>${display.exp || ''}</span></div>
            <div class="job-tags">${tags}</div>
          </div>
        </div>
        <div class="job-reason"><span class="spark">✦</span><span>${display.reason || '请查看岗位要求'}</span></div>
        <div class="job-card-footer"><span class="source-line">${display.source || ''} · ${display.sourceId || ''}</span><span class="detail-link">${detailPages[job.id] ? '查看匹配报告' : '查看来源岗位'} →</span></div>`;
      feed.appendChild(a);
    });

    const cards = $$('.job-card', feed);
    const n = jobs.length;
    const hc = $('#heroCount'); if (hc) hc.textContent = n + (demo ? ' 个样例岗位' : ' 个匹配岗位');
    const rc = $('#resultCount'); if (rc) rc.textContent = '共 ' + n + ' 个真实岗位';
    const sc = $('#srcCount'); if (sc) sc.textContent = n;
    // update filter chip counts
    const byCat = {};
    jobs.forEach((j) => { byCat[j.category||'data'] = (byCat[j.category||'data']||0)+1; });
    $$('#filterChips .filter-chip').forEach((chip) => {
      const cat = chip.dataset.filter;
      const cnt = cat === 'all' ? n : (byCat[cat] || 0);
      const span = chip.querySelector('span');
      if (span) span.textContent = cnt;
    });
    const filterChips = $$('.filter-chip', $('#filterChips'));
    const sortButton = $('#sortButton');
    const sortLabel = $('#sortLabel');
    const resultSummary = $('#resultSummary');
    const filterEmpty = $('#filterEmpty');
    const resetFilter = $('#resetFilter');
    const personalizedBanner = $('#personalizedBanner');
    const personalizedText = $('#personalizedText');

    let activeFilter = 'all';
    let sortMode = 'score';
    const weights = readWeights();

    // Show the active profile. Scores are already calculated by the gateway.
    let savedProfile = null;
    try { savedProfile = JSON.parse(localStorage.getItem('careerlens-profile') || 'null'); } catch (e) {}
    if (!demo && savedProfile && Array.isArray(savedProfile.skills) && savedProfile.skills.length) {
      const skills = savedProfile.skills.map((s) => String(s).toLowerCase());
      // update sidebar profile
      const sideName = document.querySelector('.side-person div strong');
      const sideRole = document.querySelector('.side-person div span');
      const sideAvatar = document.querySelector('.avatar-small');
      const headerAvatar = document.querySelector('.avatar-link');
      if (sideName) sideName.textContent = savedProfile.name || '求职者';
      if (sideRole) sideRole.textContent = (savedProfile.target_role || '') + ' · ' + (savedProfile.city || '');
      if (sideAvatar) sideAvatar.textContent = (savedProfile.name || '求')[0];
      if (headerAvatar) headerAvatar.textContent = (savedProfile.name || '求')[0];
      // update sidebar tags
      const sideTags = document.querySelectorAll('.side-tags span');
      const sk = savedProfile.skills || [];
      sideTags.forEach((el, i) => { el.textContent = sk[i] || ''; el.style.display = sk[i] ? '' : 'none'; });
      if (personalizedBanner) personalizedBanner.hidden = false;
      if (personalizedText) {
        personalizedText.textContent = '当前画像：' + (savedProfile.target_role || '未填写方向') + ' · ' + skills.length + ' 项技能；查询状态见上方。';
      }
      sortMode = 'score';
      sortCards();
    }

    if (weights && demo) {
      const priority = [...WEIGHT_KEYS].sort((a, b) => weights[b] - weights[a])[0];
      cards.forEach((card) => {
        const job = byId.get(card.dataset.jobId);
        if (!job) return;
        const score = weightedScore(job, weights);
        card.dataset.score = String(score);
        const scoreNumber = $('.job-score-number', card);
        if (scoreNumber) scoreNumber.textContent = score;
      });
      if (personalizedBanner) personalizedBanner.hidden = false;
      if (personalizedText) {
        personalizedText.textContent = `已按「${WEIGHT_LABELS[priority]}」优先重新计算匹配分与排序。`;
      }
      sortMode = 'score';
      sortCards();
    }

    if (weights && !demo && personalizedBanner && personalizedText) {
      personalizedBanner.hidden = false;
      personalizedText.textContent += ' 实时岗位暂按方向与技能评分；来源未提供成长空间等维度，四项偏好权重暂未应用。';
    }

    function sortCards() {
      const sorted = cards.slice().sort((left, right) => {
        if (sortMode === 'newest') {
          return Number(left.dataset.days) - Number(right.dataset.days);
        }
        return Number(right.dataset.score) - Number(left.dataset.score);
      });
      sorted.forEach((card) => feed.appendChild(card));
    }

    function updateResults() {
      let visibleCount = 0;
      cards.forEach((card) => {
        const matches = activeFilter === 'all' || card.dataset.category === activeFilter;
        card.hidden = !matches;
        if (matches) visibleCount += 1;
      });
      if (resultSummary) {
        resultSummary.textContent =
          activeFilter === 'all' && visibleCount === cards.length
            ? `共 ${visibleCount} 个岗位`
            : `显示 ${visibleCount} / ${cards.length} 个岗位`;
      }
      if (filterEmpty) filterEmpty.hidden = visibleCount !== 0;
    }

    filterChips.forEach((chip) => {
      chip.addEventListener('click', () => {
        activeFilter = chip.dataset.filter || 'all';
        filterChips.forEach((item) => item.classList.toggle('is-active', item === chip));
        updateResults();
      });
    });

    if (resetFilter) {
      resetFilter.addEventListener('click', () => {
        activeFilter = 'all';
        filterChips.forEach((chip) => chip.classList.toggle('is-active', chip.dataset.filter === 'all'));
        updateResults();
      });
    }

    if (sortButton) {
      sortButton.addEventListener('click', () => {
        sortMode = sortMode === 'score' ? 'newest' : 'score';
        if (sortLabel) sortLabel.textContent = sortMode === 'score' ? '匹配度优先' : '最新发布';
        sortCards();
        updateResults();
      });
    }

    sortCards();
    updateResults();

    if (params.get('parsed') === '1') {
      window.setTimeout(() => showToast('简历画像已更新', '已按新的候选人画像刷新推荐结果。'), 450);
    }
  }

  /* ---------- Upload page ---------- */

  function initUploadPage() {
    const form = $('#uploadForm');
    if (!form) return;

    const scanPanel = $('#scanPanel');
    const successPanel = $('#uploadSuccess');
    const dropzone = $('#dropzone');
    const input = $('#resumeInput');
    const sample = $('#sampleResume');
    const scanFileName = $('#scanFileName');
    const scanBar = $('#scanBar');
    const tasks = $$('#scanTasks li');
    const profileFileName = $('#profileFileName');
    const keyInput = $('#deepseekKey');
    const uploadError = $('#uploadError');
    let activeProfile = null;

    function showUploadError(message) {
      if (uploadError) { uploadError.hidden = !message; uploadError.textContent = message; }
    }

    function withTimeout(promise, milliseconds, message) {
      let timer;
      return Promise.race([promise, new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); })]).finally(() => clearTimeout(timer));
    }

    let timers = [];
    let scanToken = 0;

    function clearTimers() {
      timers.forEach((timer) => window.clearTimeout(timer));
      timers = [];
    }

    function schedule(delay, callback, token) {
      timers.push(
        window.setTimeout(() => {
          if (token === scanToken) callback();
        }, delay),
      );
    }

    function setTask(index, state) {
      const task = tasks[index];
      if (!task) return;
      task.classList.toggle('is-active', state === 'active');
      task.classList.toggle('is-done', state === 'done');
      const status = $('b', task);
      if (status) status.textContent = state === 'done' ? '完成' : state === 'active' ? '解析中' : '待处理';
    }

    async function extractPdfText(file) {
      if (!window.pdfjsLib) throw new Error('PDF 解析组件加载失败，请刷新页面后重试。');
      const buf = await file.arrayBuffer();
      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.js', document.baseURI).href;
      const pdf = await pdfjsLib.getDocument({ data: buf, isEvalSupported: false }).promise;
      let text = '';
      try {
        for (let i = 1; i <= Math.min(pdf.numPages, 12); i++) {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          text += content.items.map((it) => it.str + (it.hasEOL ? '\n' : ' ')).join('') + '\n';
        }
      } finally { await pdf.destroy(); }
      return text;
    }

    async function extractResumeText(file) {
      if (/\.docx$/i.test(file.name)) {
        if (!window.mammoth) throw new Error('DOCX 解析组件加载失败，请刷新后重试。');
        return (await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value;
      }
      return extractPdfText(file);
    }

    async function askDeepSeek(key, resumeText) {
      const sys = '你是简历解析引擎。从用户简历中提取结构化信息，只返回 JSON，不要解释。字段：name(姓名), target_role(意向岗位方向), skills(数组，最多10个核心技能), years(工作年限数字), city(期望城市), education(学校+学历+专业), summary(一句话优势). 只依据简历提取，不推测评分；缺失字段返回空字符串、空数组或 null。';
      const res = await fetch('https://api.deepseek.com/chat/completions', {
        signal: AbortSignal.timeout(60000),
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [
            { role: 'system', content: sys },
            { role: 'user', content: resumeText.slice(0, 6000) },
          ],
          temperature: 0.2,
          response_format: { type: 'json_object' },
        }),
      });
      if (!res.ok) throw new Error('DeepSeek API HTTP ' + res.status);
      const d = await res.json();
      const raw = d.choices[0].message.content;
      return JSON.parse(raw);
    }

    function showSuccess(profile, fileName) {
      if (!profile) {
        form.hidden = false; scanPanel.hidden = true; successPanel.hidden = true;
        return;
      }
      profile = { ...profile, skills: Array.isArray(profile.skills) ? profile.skills.filter(skill => typeof skill === 'string') : [] };
      activeProfile = profile;
      if ($('#editRole')) $('#editRole').value = profile.target_role || '';
      if ($('#editSkills')) $('#editSkills').value = profile.skills.join(', ');
      if ($('#editCity')) $('#editCity').value = profile.city || '';
      if ($('#editYears')) $('#editYears').value = profile.years ?? '';
      form.hidden = true;
      scanPanel.hidden = true;
      successPanel.hidden = false;
      if (profileFileName) profileFileName.textContent = fileName;
      const summary = $('.success-summary');
      if (summary && profile) {
        summary.innerHTML =
          '<div><span>核心方向</span><strong>' + escapeHtml(profile.target_role || '未知') + '</strong></div>' +
          '<div><span>识别技能</span><strong>' + ((profile.skills || []).length + ' 项') + '</strong></div>' +
          '<div><span>候选人</span><strong>' + escapeHtml(profile.name || '求职者') + '</strong></div>';
      }
      const successNote = $('p', successPanel);
      if (successNote) successNote.textContent = (profile.parseMethod === 'local' ? '已从你的简历生成基础画像（本地规则提取），请核对并修正后开始查询。' : '简历画像已就绪。') + '岗位数量以工作台实际匹配结果为准。';
      if (!profile.target_role && !profile.skills.length) { const editor = $('.profile-edit'); if (editor) editor.open = true; }
      // update the visible profile board below
      if (profile) {
        const skillLabel = $('.skill-panel .panel-label small');
        if (skillLabel) skillLabel.textContent = '简历提取';
        const personName = document.querySelector('.profile-person h3');
        const personRole = document.querySelector('.profile-person p');
        const personMeta = document.querySelector('.profile-person div span');
        const avatar = document.querySelector('.avatar-large');
        if (personName) personName.textContent = profile.name || '求职者';
        if (avatar) avatar.textContent = (profile.name || '求')[0];
        if (personRole) personRole.textContent = profile.target_role || '';
        if (personMeta) personMeta.textContent = (profile.city || '') + ' · ' + (profile.years ? profile.years + ' 年经验' : '经验未填');
        const darkTags = document.querySelector('.dark-tags');
        if (darkTags && Array.isArray(profile.skills)) {
          darkTags.innerHTML = '';
          [profile.target_role, '互联网/AI', profile.city].filter(Boolean).forEach((t) => {
            const s = document.createElement('span'); s.textContent = t; darkTags.appendChild(s);
          });
        }
        const fields = document.querySelectorAll('.parsed-field');
        if (fields[0]) fields[0].querySelector('p').textContent = profile.education || '简历未提供';
        if (fields[1]) fields[1].querySelector('p').textContent = (profile.target_role || '') + ' · ' + (profile.summary || '');
        if (fields[2]) fields[2].querySelector('p').textContent = (profile.name || '求职者') + ' · ' + (profile.years != null ? profile.years + ' 年经验' : '年限未提供');
        if (fields[3]) fields[3].querySelector('p').textContent = (profile.city || '城市未提供') + ' · 求职方向：' + (profile.target_role || '');
        // skill bars: top 4 skills
        const skillRows = document.querySelectorAll('.skill-row');
        const skills = (profile.skills || []).slice(0, 4);
        skillRows.forEach((row, i) => {
          if (skills[i]) {
            row.querySelector('span').textContent = skills[i];
            row.querySelector('b').textContent = '已识别';
            row.querySelector('i').style.width = '100%';
          }
          row.hidden = !skills[i];
        });
        // AI summary box
        const aiBox = document.querySelector('.profile-ai');
        if (aiBox && profile.summary) {
          aiBox.querySelector('p').textContent = '优势：' + profile.summary;
          const secondP = aiBox.querySelectorAll('p')[1];
          if (secondP) secondP.textContent = '方向：期望从事 ' + (profile.target_role || '相关岗位') + '，' + (profile.city || '') + '。';
        }
        // section heading description
        const sectionNote = document.querySelector('.section-heading.split p');
        if (sectionNote) sectionNote.textContent = (profile.isSample ? '当前为示例画像。' : '以上为本次简历解析画像。') + '进入工作台后按画像查询可用招聘来源。';
        const eyebrow = document.querySelector('.section-heading.split .eyebrow');
        if (eyebrow) eyebrow.textContent = 'CANDIDATE PROFILE · 已解析';
      }
      try { localStorage.setItem('careerlens-profile', JSON.stringify(profile)); } catch (e) {}
    }

    function startFakeScan(fileName) {
      clearTimers(); scanToken += 1;
      const token = scanToken;
      const safeName = String(fileName || '简历.pdf').slice(0, 120);
      form.hidden = true; successPanel.hidden = true; scanPanel.hidden = false;
      scanFileName.textContent = safeName; scanBar.style.width = '8%';
      tasks.forEach((t) => { t.classList.remove('is-active','is-done'); const b=$('b',t); if(b)b.textContent='待处理'; });
      setTask(0,'active');
      schedule(620, () => { setTask(0,'done'); setTask(1,'active'); scanBar.style.width='34%'; }, token);
      schedule(1360, () => { setTask(1,'done'); setTask(2,'active'); scanBar.style.width='62%'; }, token);
      schedule(2080, () => { setTask(2,'done'); setTask(3,'active'); scanBar.style.width='86%'; }, token);
      schedule(2740, () => { setTask(3,'done'); scanBar.style.width='100%'; }, token);
      schedule(3220, () => showSuccess({ name: '林知夏', target_role: '产品经理', skills: ['产品策略', '用户增长', 'SQL', '数据分析'], years: 3.5, city: '上海', education: '复旦大学 · 硕士', summary: '产品与增长经验', isSample: true }, safeName), token);
    }

    async function handleFile(file) {
      if (!/\.(pdf|docx)$/i.test(file.name || '') || file.size > 10 * 1024 * 1024) {
        showUploadError('请选择 10MB 以内的 PDF 或 DOCX 文件；旧版 .doc 请另存为 DOCX。');
        return;
      }
      clearTimers(); scanToken += 1;
      showUploadError('');
      try { localStorage.removeItem('careerlens-profile'); } catch {}
      const safeName = String(file.name || '简历.pdf').slice(0, 120);
      form.hidden = true; successPanel.hidden = true; scanPanel.hidden = false;
      scanFileName.textContent = safeName; scanBar.style.width = '8%';
      tasks.forEach((t) => { t.classList.remove('is-active','is-done'); const b=$('b',t); if(b)b.textContent='待处理'; });
      setTask(0,'active');
      const keyInput = $('#deepseekKey');
      let key = (keyInput && keyInput.value.trim()) || '';
      try { key = key || localStorage.getItem('deepseek-key') || ''; if (keyInput) localStorage.setItem('deepseek-key', keyInput.value.trim()); } catch {}

      try {
        setTask(1,'active'); scanBar.style.width='30%';
        const text = await withTimeout(extractResumeText(file), 30000, '文档读取超时，请重新上传文字版 PDF 或 DOCX。');
        setTask(0,'done');
        scanBar.style.width='55%';
        if (!key) {
          const profile = window.CareerLensResume.fromText(text);
          tasks.forEach((task, index) => setTask(index, 'done')); scanBar.style.width = '100%';
          showSuccess(profile, safeName);
          return;
        }
        if (text.replace(/\s/g, '').length < 30) throw new Error('文档未包含足够文字。扫描版 PDF 暂不支持，请改用文字版 PDF 或 DOCX。');
        setTask(2,'active');
        const profile = await askDeepSeek(key, text);
        setTask(1,'done'); setTask(2,'done'); setTask(3,'active');
        scanBar.style.width='90%';
        await new Promise((r) => setTimeout(r, 400));
        setTask(3,'done'); scanBar.style.width='100%';
        showSuccess(profile, safeName);
      } catch (err) {
        console.error(err);
        const message = ['AbortError', 'TimeoutError'].includes(err.name) ? '解析请求超时。请稍后重试；清空 Key 后也可使用本地基础解析。' : (err && err.message) || String(err);
        showUploadError(message);
        showToast('解析失败', message);
        showSuccess(null, safeName);
      } finally { if (input) input.value = ''; }
    }

    const profileEditForm = $('#profileEditForm');
    if (profileEditForm) profileEditForm.addEventListener('submit', event => {
      event.preventDefault();
      const target_role = $('#editRole').value.trim();
      const skills = $('#editSkills').value.split(/[,，、;；]+/).map(skill => skill.trim()).filter(Boolean);
      if (!target_role && !skills.length) { showToast('请补充求职方向或技能', '至少填写一项后才能查询岗位。'); return; }
      showSuccess({ ...activeProfile, target_role, skills, city: $('#editCity').value.trim(), years: $('#editYears').value === '' ? null : Number($('#editYears').value) }, profileFileName?.textContent || '简历');
      showToast('画像已保存', '现在可以开始查询匹配岗位。');
    });

    const queryLink = $('a[href="jobs.html?parsed=1"]', successPanel);
    if (queryLink) queryLink.addEventListener('click', event => {
      if (!activeProfile?.target_role && !activeProfile?.skills?.length) { event.preventDefault(); const editor = $('.profile-edit'); if (editor) editor.open = true; showToast('请先补充方向或技能'); }
    });

    if (sample) {
      sample.addEventListener('click', (event) => {
        event.preventDefault();
        startFakeScan('林知夏_产品经理_2026.pdf');
      });
    }

    if (dropzone && input) {
      dropzone.addEventListener('click', () => input.click());
    }

    if (input) {
      input.addEventListener('change', () => {
        const file = input.files && input.files[0];
        if (!file) return;
        if (file.size > 10 * 1024 * 1024) {
          showToast('文件过大', '请选择 10MB 以内的 PDF 或 DOCX 文件。');
          input.value = '';
          return;
        }
        handleFile(file);
      });
    }

    if (dropzone) {
      ['dragenter', 'dragover'].forEach((eventName) => {
        dropzone.addEventListener(eventName, (event) => {
          event.preventDefault();
          dropzone.classList.add('is-dragging');
        });
      });
      ['dragleave', 'drop'].forEach((eventName) => {
        dropzone.addEventListener(eventName, (event) => {
          event.preventDefault();
          dropzone.classList.remove('is-dragging');
        });
      });
      dropzone.addEventListener('drop', (event) => {
        const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
        if (file) handleFile(file);
      });
    }

    // restore saved key
    let savedKey = ''; try { savedKey = localStorage.getItem('deepseek-key') || ''; } catch {}
    if (savedKey && keyInput) keyInput.value = savedKey;
  }

  /* ---------- Preferences ---------- */

  function initPreferences() {
    const form = $('#prefForm');
    if (!form) return;

    const inputs = $$('input[type="range"]', form);
    const reset = $('#resetWeights');
    const defaults = { growth: 30, outlook: 25, balance: 20, stability: 25 };

    function paint(input) {
      const min = Number(input.min);
      const max = Number(input.max);
      const progress = ((Number(input.value) - min) / (max - min)) * 100;
      input.style.setProperty('--range-progress', `${progress}%`);
      const output = input.closest('.weight-row')?.querySelector('output');
      if (output) output.textContent = input.value;
    }

    inputs.forEach((input) => {
      paint(input);
      input.addEventListener('input', () => paint(input));
    });

    if (reset) {
      reset.addEventListener('click', () => {
        inputs.forEach((input) => {
          input.value = defaults[input.dataset.weight] ?? input.value;
          paint(input);
        });
        showToast('已恢复默认权重', '你还可以继续拖动滑块调整。');
      });
    }

    form.addEventListener('submit', (event) => {
      const total = inputs.reduce((sum, input) => sum + Number(input.value), 0);
      if (!total) {
        event.preventDefault();
        showToast('至少保留一个偏好权重', '拖动任意滑块，为你的求职优先级赋权。');
        return;
      }
      showToast('正在重新计算匹配结果', '将根据你的优先级更新推荐分数与排序。');
    });
  }

  /* ---------- Job detail save action ---------- */

  function initSaveButtons() {
    $$('[data-save-job]').forEach((button) => {
      const slug = button.dataset.saveJob;
      const saved = readStore(STORE_SAVED);
      const label = $('.save-icon', button);

      function paint(isSaved) {
        button.classList.toggle('is-saved', isSaved);
        if (label) label.textContent = isSaved ? '♥' : '♡';
        button.setAttribute('aria-pressed', String(isSaved));
        button.innerHTML = `<span class="save-icon">${isSaved ? '♥' : '♡'}</span> ${isSaved ? '已收藏' : '收藏职位'}`;
      }

      paint(saved.includes(slug));
      button.addEventListener('click', () => {
        const current = readStore(STORE_SAVED);
        const isSaved = current.includes(slug);
        if (isSaved) {
          removeFromStore(STORE_SAVED, slug);
          paint(false);
          showToast('已取消收藏');
        } else {
          addToStore(STORE_SAVED, slug);
          paint(true);
          showToast('已收藏职位', '可以在投递追踪页查看收藏数量。');
        }
      });
    });
  }

  /* ---------- Apply page actions ---------- */

  function initApplyPage() {
    $$('[data-mark-applied]').forEach((link) => {
      link.addEventListener('click', () => {
        addToStore(STORE_APPLIED, link.dataset.markApplied);
      });
    });

    $$('[data-copy-url]').forEach((button) => {
      button.addEventListener('click', async () => {
        const url = button.dataset.copyUrl;
        if (!url) return;
        const copied = await copyText(url);
        if (copied) {
          const previous = button.textContent;
          button.textContent = '已复制';
          window.setTimeout(() => {
            button.textContent = previous;
          }, 1400);
          showToast('链接已复制', '可粘贴到浏览器中打开。');
        } else {
          showToast('复制失败', '请手动复制页面中的申请链接。');
        }
      });
    });
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (error) {
      // Fall through.
    }
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand('copy');
      textarea.remove();
      return copied;
    } catch (error) {
      return false;
    }
  }

  /* ---------- Tracker ---------- */

  function initTracker() {
    const root = $('#trackerRoot');
    if (!root) return;

    const queryApplied = params.get('applied');
    if (queryApplied && bySlug.has(queryApplied)) {
      addToStore(STORE_APPLIED, queryApplied);
    }

    const applied = Array.from(
      new Set([
        ...(queryApplied && bySlug.has(queryApplied) ? [queryApplied] : []),
        ...readStore(STORE_APPLIED),
      ]),
    ).filter((slug) => bySlug.has(slug));
    const saved = readStore(STORE_SAVED).filter((slug) => bySlug.has(slug));

    const appliedCount = $('#appliedCount');
    const followCount = $('#followCount');
    const savedCount = $('#savedCount');
    if (appliedCount) appliedCount.textContent = String(applied.length);
    if (followCount) followCount.textContent = String(applied.length);
    if (savedCount) savedCount.textContent = String(saved.length);

    if (!applied.length) return;

    root.innerHTML = `<div class="tracker-list">${applied
      .map((slug) => {
        const job = bySlug.get(slug);
        return `
          <article class="tracker-card">
            <div class="tracker-card-head">
              <span class="company-logo" style="--logo-bg:${job.logoBg};--logo-fg:${job.logoFg}">${job.logo}</span>
              <div class="tracker-job">
                <h3>${escapeHtml(job.title)}</h3>
                <p>${escapeHtml(job.company)} · ${escapeHtml(job.location)} · ${escapeHtml(job.source)}</p>
              </div>
              <span class="tracker-status">已前往原站</span>
            </div>
            <div class="tracker-steps">
              <span class="tracker-step is-done">已标记投递</span>
              <span class="tracker-step is-done">已打开原站</span>
              <span class="tracker-step">等待 HR 反馈</span>
            </div>
            <div class="tracker-actions">
              <span class="tracker-meta">刚刚 · DEMO RECORD</span>
              <div>
                <a class="btn btn-secondary" href="job-${job.slug}.html">查看职位</a>
                <a class="btn btn-primary" href="apply-${job.slug}.html">再次打开申请页 <span class="btn-arrow">→</span></a>
              </div>
            </div>
          </article>`;
      })
      .join('')}</div>`;
  }

  /* ---------- Boot ---------- */

  initJobsPage();
  initUploadPage();
  initPreferences();
  initSaveButtons();
  initApplyPage();
  initTracker();
})();
