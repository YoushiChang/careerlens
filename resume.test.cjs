const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { fromText } = require('../assets/resume-profile.js');

test('local profile uses resume evidence and leaves unknown facts empty', () => {
  const profile = fromText('姓名：测试同学\n求职意向：数据分析师\n期望城市：上海\n工作经验：3年\n测试大学 本科\n熟悉 SQL、Python，曾开展需求分析和用户研究项目。');
  assert.equal(profile.name, '测试同学');
  assert.equal(profile.target_role, '数据分析师');
  assert.equal(profile.city, '上海');
  assert.equal(profile.years, 3);
  assert.ok(profile.skills.includes('SQL'));
  assert.ok(!profile.skills.includes('React'));
  const unknown = fromText('个人简历\n擅长 Python 和 SQL，负责数据分析以及自动化脚本开发，能够独立完成技术任务。');
  assert.equal(unknown.city, '');
  assert.equal(unknown.years, null);
  assert.equal(unknown.isSample, undefined);
  assert.throws(() => fromText(''), /文字过少/);
});

function pdfFixture() {
  const stream = 'BT /F1 12 Tf 72 720 Td (Python SQL data analysis resume with three years experience) Tj ET';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
  let body = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(body)); body += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n ').join('\n')}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Uint8Array(Buffer.from(body));
}

test('vendored PDF parser and configured worker extract an actual PDF text layer', async () => {
  const pdfjs = require('../assets/pdf.min.js');
  pdfjs.GlobalWorkerOptions.workerSrc = path.resolve(__dirname, '../assets/pdf.worker.min.js');
  const pdf = await pdfjs.getDocument({ data: pdfFixture(), isEvalSupported: false }).promise;
  try {
    const page = await pdf.getPage(1);
    const text = (await page.getTextContent()).items.map(item => item.str).join(' ');
    assert.ok(fromText(text).skills.includes('Python'));
    assert.ok(fromText(text).skills.includes('SQL'));
  } finally { await pdf.destroy(); }
});

function zip(files) {
  const local = [], central = []; let offset = 0;
  for (const [filename, content] of Object.entries(files)) {
    const name = Buffer.from(filename), data = Buffer.from(content);
    let crc = -1;
    for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    crc = (crc ^ -1) >>> 0;
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt32LE(crc, 14); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(name.length, 26);
    const directory = Buffer.alloc(46); directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6); directory.writeUInt32LE(crc, 16); directory.writeUInt32LE(data.length, 20); directory.writeUInt32LE(data.length, 24); directory.writeUInt16LE(name.length, 28); directory.writeUInt32LE(offset, 42);
    local.push(header, name, data); central.push(directory, name); offset += header.length + name.length + data.length;
  }
  const index = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(index.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, index, end]);
}

test('vendored DOCX parser extracts actual Word document XML without treating it as PDF', async () => {
  const mammoth = require('../assets/mammoth.browser.min.js');
  const bytes = zip({
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml': '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>求职意向：产品经理</w:t></w:r></w:p><w:p><w:r><w:t>熟悉 SQL、需求分析、用户研究，具有完整的产品设计与项目管理经验。</w:t></w:r></w:p></w:body></w:document>',
  });
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const result = await mammoth.extractRawText({ arrayBuffer });
  assert.equal(fromText(result.value).target_role, '产品经理');
  assert.ok(fromText(result.value).skills.includes('SQL'));
});
