'use strict';
(function (root) {
  function fromText(value) {
    const text = String(value || '').replace(/\r/g, '\n');
    if (text.replace(/\s/g, '').length < 30) throw new Error('提取到的简历文字过少。扫描版 PDF 暂不支持，请使用文字版 PDF 或 DOCX。');
    const targetLine = text.match(/(?:求职意向|意向岗位|目标岗位|应聘职位|期望职位)\s*[:：]?\s*([^\n]{2,60})/);
    const roles = ['数据产品经理', '产品经理', '数据分析师', '数据分析', '数据工程师', '算法工程师', '前端工程师', '后端工程师', '软件工程师', '产品运营', '用户运营', '用户增长', '测试工程师', '设计师', '项目经理', '财务', '销售'];
    const role = targetLine ? targetLine[1].trim() : roles.find(role => text.includes(role)) || '';
    const knownSkills = ['SQL', 'Python', 'JavaScript', 'TypeScript', 'Java', 'C++', 'React', 'Vue', 'Excel', 'Tableau', 'Power BI', 'Figma', 'Axure', 'Linux', 'Spark', 'Flink', 'MySQL', '数据分析', '产品设计', '需求分析', '项目管理', '用户研究', '用户增长', '机器学习', '深度学习', '大模型', 'A/B 测试'];
    const skills = knownSkills.filter(skill => text.toLowerCase().includes(skill.toLowerCase()));
    const years = text.match(/(?:工作年限|工作经验)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*年/) || text.match(/(\d+(?:\.\d+)?)\s*年(?:以上)?(?:工作|相关|产品|开发)?经验/);
    const city = text.match(/(?:期望城市|意向城市|工作城市|求职城市)\s*[:：]\s*([^\n,，、|]{2,20})/);
    const name = text.match(/姓名\s*[:：]\s*([^\s|]{2,20})/);
    const education = text.match(/[^\n]{0,20}(?:大学|学院)[^\n]{0,45}/);
    return { name: name ? name[1] : '求职者', target_role: role, skills, years: years ? Number(years[1]) : null,
      city: city ? city[1].trim() : '', education: education ? education[0].trim() : '',
      summary: '已从简历原文提取可识别字段，请核对求职方向、技能和城市。', parseMethod: 'local' };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { fromText };
  else root.CareerLensResume = { fromText };
})(typeof window !== 'undefined' ? window : globalThis);
