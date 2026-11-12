import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseReviewReport } from '../../js/utils/auth/review-report.js';
import { esc } from '../../js/utils/auth/security.js';

test('report import rejects malformed structures, unknown icons and excessive input', () => {
  const icons = new Set(['HAZARD']);
  for (const text of ['null', '{"cataReviews":[]}', '{"cataReviews":{"id":null}}', '{"cataReviews":{"id":{"suggestedIconId":"<img>"}}}']) {
    assert.throws(() => parseReviewReport(text, icons));
  }
  assert.throws(() => parseReviewReport(' '.repeat(2 * 1024 * 1024 + 1), icons));
  const report = parseReviewReport('{"reviewer":"User","cataReviews":{"__proto__":{"note":"text"},"id":{"status":"changed","suggestedIconId":"HAZARD"}}}', icons);
  assert.equal(Object.getPrototypeOf(report.cataReviews), null);
  assert.equal(report.cataReviews.id.suggestedIconId, 'HAZARD');
});

test('curator matrix treats imported names, notes, icon IDs and pack card titles as text', async () => {
  const html = await readFile(new URL('../../cataclysm-icon-curator.html', import.meta.url), 'utf8');
  const start = html.indexOf('function renderMultiReviewerMatrix()');
  let depth = 1, i = html.indexOf('{',start) + 1;
  for (; depth; i++) { if (html[i] === '{') depth++; if (html[i] === '}') depth--; }
  const nodes = [];
  const node = () => {
    const n = { innerHTML: '', appendChild() {}, querySelector: () => ({ addEventListener() {} }) };
    nodes.push(n); return n;
  };
  const byId = new Map();
  const document = { createElement: node, getElementById(id) { if (!byId.has(id)) byId.set(id,node()); return byId.get(id); } };
  const attack = '<img src=x onerror=alert(1)>';
  const imported = [{ reviewer: attack, cataReviews: { key: { status: 'changed', suggestedIconId: attack, note: attack } } }];
  const render = new Function('document','importedReports','reviewerName','cataReviews','packCataclysms','evaluateCataclysmCandidates','reviewKeyOf','esc',
    html.slice(start,i) + ';return renderMultiReviewerMatrix;')(
    document, imported, attack, {}, [{ value: attack, meta: {} }], () => ({ best: { icon: { id: 'HAZARD' } } }), () => 'key', esc
  );
  render();
  const markup = nodes.map(n => n.innerHTML).join('');
  assert.equal(markup.includes('<img'), false);
  assert.equal(markup.includes('&lt;img'), true);
});
