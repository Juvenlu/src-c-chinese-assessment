/**
 * P3-H-12F-4G-B BookWriter 批量导入与激活守卫纯函数测试（自包含，无外部服务）
 *
 * 覆盖任务要求的本地验证项：
 *  1. 正确导入 10 页（页码格式 + 分页符格式）
 *  2. 9 页 / 11 页 / 空页 / 重复页号均被拒绝
 *  3. 导入失败结果不携带 pages（不破坏已有文本的契约保证）
 *  4. 应用导入时保留原 image_url / original_text / frontier / 页序
 *  5. 切换孩子不出现跨孩子版本混淆（渲染守卫 + 列表过滤）
 *  6. review 状态不显示激活入口
 *  7. final 状态显示正确的激活入口
 *
 * 运行：npx tsx src/components/admin/book-writer-import.test.ts
 */

import {
  parseBulkPageText,
  applyBulkTextToPages,
  shouldShowVersionManager,
  filterVersionsForChild,
  countChars,
  countHanzi,
} from './book-writer';

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    passed++;
    console.log(`PASS: ${name}`);
  } else {
    failed++;
    console.log(`FAIL: ${name} ${detail}`);
  }
}

function makePageText(n: number): string {
  return `这是第${n}页的改写内容。小猴子很勇敢。`;
}

function makeMarkedText(pageCount: number): string {
  const parts: string[] = [];
  for (let i = 1; i <= pageCount; i++) {
    parts.push(`第${i}页\n${makePageText(i)}`);
  }
  return parts.join('\n');
}

function makeSeparatedText(pageCount: number): string {
  const parts: string[] = [];
  for (let i = 1; i <= pageCount; i++) {
    parts.push(makePageText(i));
  }
  return parts.join('\n---\n');
}

function main(): void {
  // ---- 1. 正确导入 10 页 ----
  const ok1 = parseBulkPageText(makeMarkedText(10), 10);
  check('页码格式正确解析 10 页', ok1.ok === true && ok1.pages?.size === 10);
  check('页码格式第 3 页文本正确', ok1.pages?.get(3) === makePageText(3));

  const okSep = parseBulkPageText(makeSeparatedText(10), 10);
  check('分页符格式正确解析 10 页', okSep.ok === true && okSep.pages?.size === 10);
  check('分页符格式第 7 页文本正确', okSep.pages?.get(7) === makePageText(7));

  const okBracket = parseBulkPageText('【第1页】：标题\n内容一\n第2页\n内容二', 2);
  check('【第N页】带冒号标题可解析', okBracket.ok === true && okBracket.pages?.get(2) === '内容二');

  const okZero = parseBulkPageText('第01页\n甲\n第02页\n乙', 2);
  check('前导零页号归一化（第01页→1）', okZero.ok === true && okZero.pages?.get(1) === '甲');

  // 字数统计口径：总字符=全部字符（与 Worker PATCH 一致），汉字另计
  const stat = parseBulkPageText('第1页\n一二三四五。', 1);
  check(
    '总字符与汉字数统计正确',
    stat.ok === true && stat.totalChars === 6 && stat.hanziChars === 5,
    `got total=${stat.totalChars} hanzi=${stat.hanziChars}`,
  );
  check('countChars/countHanzi 空串安全', countChars('') === 0 && countHanzi('') === 0);

  // ---- 2. 9 页 / 11 页 / 空页 / 重复页号均被拒绝 ----
  const miss = parseBulkPageText(makeMarkedText(9), 10);
  check('9 页被拒绝', miss.ok === false);
  check('9 页报错指出缺第 10 页', (miss.errors || []).some((e) => e.includes('缺少页面') && e.includes('10')));

  const over = parseBulkPageText(`${makeMarkedText(10)}\n第11页\n多出来的一页`, 10);
  check('11 页被拒绝', over.ok === false);
  check('11 页报错指出页号超范围', (over.errors || []).some((e) => e.includes('超出范围')));

  const dup = parseBulkPageText('第1页\n甲\n第2页\n乙\n第2页\n丙', 2);
  check('重复页号被拒绝', dup.ok === false);
  check('重复页号报错指出第 2 页', (dup.errors || []).some((e) => e.includes('页号重复') && e.includes('2')));

  const empty = parseBulkPageText('第1页\n甲\n第2页\n\n第3页\n丙', 3);
  check('空页被拒绝', empty.ok === false);
  check('空页报错指出第 2 页', (empty.errors || []).some((e) => e.includes('内容为空') && e.includes('2')));

  const sepWrong = parseBulkPageText(makeSeparatedText(9), 10);
  check('分页符 9 段被拒绝', sepWrong.ok === false && (sepWrong.errors || []).some((e) => e.includes('9 页')));

  const emptyInput = parseBulkPageText('   \n  ', 10);
  check('空输入被拒绝', emptyInput.ok === false);

  const noMark = parseBulkPageText('没有页码也没有分页符的一段文字', 10);
  check('无标记文本被拒绝并提示格式', noMark.ok === false && (noMark.errors || []).some((e) => e.includes('未识别')));

  const preamble = parseBulkPageText('多余的说明文字\n第1页\n甲\n第2页\n乙', 2);
  check('首个页码前存在文字被拒绝', preamble.ok === false && (preamble.errors || []).some((e) => e.includes('无法归属')));

  // ---- 3. 导入失败不携带 pages（调用方无法部分应用，已有文本不会被破坏） ----
  check('9 页失败结果不含 pages', miss.pages === undefined);
  check('重复页号失败结果不含 pages', dup.pages === undefined);
  check('空页失败结果不含 pages', empty.pages === undefined);
  check('11 页失败结果不含 pages', over.pages === undefined);

  // ---- 4. 应用导入保留原图片 / 原文 / frontier / 页序 ----
  const existing = [
    { page: 1, text: '旧文一', frontier: ['山'], image_url: 'https://img/1.png', original_text: '原文一' },
    { page: 2, text: '旧文二', frontier: ['水'], image_url: 'https://img/2.png', original_text: '原文二' },
  ];
  const imported = new Map<number, string>([
    [1, '新文一'],
    [2, '新文二'],
  ]);
  const merged = applyBulkTextToPages(existing, imported);
  check('应用后 text 被替换', merged[0].text === '新文一' && merged[1].text === '新文二');
  check(
    '应用后保留 image_url / original_text / frontier / page',
    merged[0].image_url === 'https://img/1.png' &&
      merged[0].original_text === '原文一' &&
      merged[0].frontier === existing[0].frontier &&
      merged[0].page === 1 &&
      merged[1].page === 2,
  );
  check('应用不修改原数组（不可变）', existing[0].text === '旧文一' && merged !== existing);

  const partialKept = applyBulkTextToPages(existing, new Map([[1, '新文一']]));
  check('未导入的页保持原对象引用', partialKept[1] === existing[1]);

  // ---- 5/6/7. 激活入口渲染守卫 ----
  const finalDetail = { status: 'final', child_id: 'child-sean', episode_id: 2 };
  check('final + 孩子/故事匹配 → 显示激活入口', shouldShowVersionManager(finalDetail, 'child-sean', 2) === true);
  check('review → 不显示激活入口', shouldShowVersionManager({ ...finalDetail, status: 'review' }, 'child-sean', 2) === false);
  check('ai_draft → 不显示激活入口', shouldShowVersionManager({ ...finalDetail, status: 'ai_draft' }, 'child-sean', 2) === false);
  check('final 但无 child_id → 不显示', shouldShowVersionManager({ status: 'final', child_id: null, episode_id: 2 }, 'child-sean', 2) === false);
  check('final 但孩子不匹配 → 不显示（防跨孩子串扰）', shouldShowVersionManager(finalDetail, 'child-ted', 2) === false);
  check('final 但故事不匹配 → 不显示（防跨故事串扰）', shouldShowVersionManager(finalDetail, 'child-sean', 3) === false);
  check('detail 为空 → 不显示', shouldShowVersionManager(null, 'child-sean', 2) === false);
  check('未选孩子 → 不显示', shouldShowVersionManager(finalDetail, '', 2) === false);

  // ---- 5. 版本列表按孩子过滤 ----
  const versions = [
    { id: 24, child_id: 'child-ted' },
    { id: 25, child_id: 'child-ted' },
    { id: 28, child_id: 'child-sean' },
    { id: 29, child_id: null },
  ] as any[];
  const seanOnly = filterVersionsForChild(versions, 'child-sean');
  check('版本列表只含当前孩子的 rewrite', seanOnly.length === 1 && seanOnly[0].id === 28);
  check('未选孩子时列表为空', filterVersionsForChild(versions, '').length === 0);
  check('无归属版本不混入孩子列表', filterVersionsForChild(versions, 'child-ted').every((v) => v.child_id === 'child-ted'));

  console.log(`\n结果: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
