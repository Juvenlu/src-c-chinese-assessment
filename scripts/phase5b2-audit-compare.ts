// Phase 5B.2 - Audit comparison script (correct field names)
import { runAudit, AUDIT_ENGINE_VERSION } from '../src/lib/book-rewrite/audit/audit-engine.ts';
import { query } from '../src/storage/database/pg-client.ts';

const REWRITE_A = 21; // exp-A-action
const REWRITE_B = 22; // exp-B-object

async function getRewrite(id: number) {
  const rows = await query(
    `SELECT id, episode_id, target_level, pages_json, frontier_targets, status,
            generation_params, validation_result
     FROM book_rewrite_versions WHERE id = $1`,
    [id]
  );
  return (rows as any[])[0];
}

function summarize(label: string, audit: any) {
  console.log(`\n--- ${label} Summary ---`);
  const c = audit.character_audit;
  const lu = audit.language_unit_audit;
  const f = audit.frontier_audit;
  const r = audit.repetition_audit;
  
  console.log(`  总汉字数: ${c.total_chinese_chars}`);
  console.log(`  SRC内唯一字: ${c.src_in_unique_chars}, SRC外唯一字: ${c.src_out_unique_chars}`);
  console.log(`  SRC内出现: ${c.src_in_occurrences}`);
  console.log(`  SRC外出现率: ${c.external_char_occurrence_rate.toFixed(2)}%`);
  console.log(`  语言单位: 总${lu.total_occurrences}次, ${lu.unique_units}个去重`);
  console.log(`  四级分类(occurrence):`);
  console.log(`    I:     ${lu.i_occurrences} (${lu.i_rate.toFixed(1)}%)`);
  console.log(`    I+1A:  ${lu.i_plus_1a_occurrences} (${lu.i_plus_1a_rate.toFixed(1)}%)`);
  console.log(`    I+1B:  ${lu.i_plus_1b_occurrences} (${lu.i_plus_1b_rate.toFixed(1)}%)`);
  console.log(`    High-load: ${lu.high_load_occurrences} (${lu.high_load_rate.toFixed(1)}%)`);
  console.log(`  Frontiers: 总${f?.total_frontier_units ?? 0}, 有效${f?.valid_frontier_count ?? 0}, 无效${f?.invalid_frontier_count ?? 0}`);
  console.log(`  重复度: +1词${r.plus1_unique_total}个, 出现${r.plus1_total_occurrences}次`);
  console.log(`    1次词: ${r.one_time}, 2次词: ${r.two_time}, 3次+: ${r.three_time}`);
}

function compareAudits(auditA: any, auditB: any) {
  const cA = auditA.character_audit;
  const cB = auditB.character_audit;
  const luA = auditA.language_unit_audit;
  const luB = auditB.language_unit_audit;
  const fA = auditA.frontier_audit;
  const fB = auditB.frontier_audit;
  
  console.log('\n========== A vs B 定量对比 ==========');
  
  console.log(`\n[字符层]`);
  const deltaChar = cA.total_chinese_chars - cB.total_chinese_chars;
  console.log(`  总汉字数: A=${cA.total_chinese_chars}, B=${cB.total_chinese_chars}, Δ=${deltaChar >= 0 ? '+' : ''}${deltaChar}`);
  console.log(`  SRC外字率: A=${cA.external_char_occurrence_rate.toFixed(2)}%, B=${cB.external_char_occurrence_rate.toFixed(2)}%`);

  console.log(`\n[四级分类 (occurrence-based)]`);
  const levels: [string, keyof typeof luA, keyof typeof luA][] = [
    ['I', 'i_occurrences', 'i_rate'],
    ['I+1A', 'i_plus_1a_occurrences', 'i_plus_1a_rate'],
    ['I+1B', 'i_plus_1b_occurrences', 'i_plus_1b_rate'],
    ['High-load', 'high_load_occurrences', 'high_load_rate'],
  ];
  for (const [name, cntKey, rateKey] of levels) {
    const aCnt = luA[cntKey] as number;
    const bCnt = luB[cntKey] as number;
    const aRate = luA[rateKey] as number;
    const bRate = luB[rateKey] as number;
    const deltaCnt = aCnt - bCnt;
    const deltaRate = (aRate - bRate).toFixed(1);
    console.log(`  ${name}: A=${aCnt}(${aRate.toFixed(1)}%), B=${bCnt}(${bRate.toFixed(1)}%), Δ=${deltaCnt >= 0 ? '+' : ''}${deltaCnt}(${deltaRate >= 0 ? '+' : ''}${deltaRate}pp)`);
  }

  console.log(`\n[Frontier]`);
  console.log(`  目标: A=${fA?.total_frontier_units ?? 0}, B=${fB?.total_frontier_units ?? 0}`);
  console.log(`  有效: A=${fA?.valid_frontier_count ?? 0}, B=${fB?.valid_frontier_count ?? 0}`);
  
  console.log(`\n[重复度]`);
  const rA = auditA.repetition_audit;
  const rB = auditB.repetition_audit;
  console.log(`  +1词去重: A=${rA.plus1_unique_total}, B=${rB.plus1_unique_total}`);
  console.log(`  +1词总出现: A=${rA.plus1_total_occurrences}, B=${rB.plus1_total_occurrences}`);
}

// 独有词汇分析 (按 unique LU 计)
function uniqueWordAnalysis(auditA: any, auditB: any) {
  const unitsA = auditA.language_unit_audit.units || [];
  const unitsB = auditB.language_unit_audit.units || [];
  
  const mapA = new Map<string, { level: string; count: number }>();
  const mapB = new Map<string, { level: string; count: number }>();
  
  for (const u of unitsA) {
    mapA.set(u.unit, { level: u.level_class || u.level || '?', count: u.occurrences || u.count || 1 });
  }
  for (const u of unitsB) {
    mapB.set(u.unit, { level: u.level_class || u.level || '?', count: u.occurrences || u.count || 1 });
  }

  const onlyA = [...mapA.keys()].filter(w => !mapB.has(w));
  const onlyB = [...mapB.keys()].filter(w => !mapA.has(w));
  const shared = [...mapA.keys()].filter(w => mapB.has(w));
  
  console.log('\n========== 词汇差异 (unique LU) ==========');
  console.log(`  共享: ${shared.length} 个`);
  console.log(`  仅A有: ${onlyA.length} 个`);
  console.log(`  仅B有: ${onlyB.length} 个`);
  
  // 按等级拆分
  for (const lvl of ['I', 'I+1A', 'I+1B', 'High-load']) {
    const onlyALvl = onlyA.filter(w => mapA.get(w)?.level === lvl);
    const onlyBLvl = onlyB.filter(w => mapB.get(w)?.level === lvl);
    console.log(`\n  [${lvl}]`);
    console.log(`    仅A: ${onlyALvl.length}个 — ${onlyALvl.slice(0, 12).join(', ')}${onlyALvl.length > 12 ? '...' : ''}`);
    console.log(`    仅B: ${onlyBLvl.length}个 — ${onlyBLvl.slice(0, 12).join(', ')}${onlyBLvl.length > 12 ? '...' : ''}`);
  }
  
  // 共享但频次不同
  const freqDiff: { word: string; level: string; a: number; b: number; delta: number }[] = [];
  for (const w of shared) {
    const a = mapA.get(w)!.count;
    const b = mapB.get(w)!.count;
    if (a !== b) {
      freqDiff.push({ word: w, level: mapA.get(w)!.level, a, b, delta: a - b });
    }
  }
  freqDiff.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
  console.log(`\n  [频次差异 Top 15]`);
  for (const { word, level, a, b, delta } of freqDiff.slice(0, 15)) {
    const sign = delta > 0 ? 'A多' : 'B多';
    console.log(`    ${word}(${level}): A=${a}, B=${b}, ${sign}${Math.abs(delta)}次`);
  }
}

// Weak Signal 回避检测
function weakSignalAnalysis(rewA: any, rewB: any) {
  const weakWords = ['高兴', '跳来跳去', '金箍棒', '笑了', '跑一跑'];
  const weakChars = ['跳', '跑', '笑', '高', '兴'];
  
  const textA = rewA.pages_json.map((p: any) => p.text).join('\n');
  const textB = rewB.pages_json.map((p: any) => p.text).join('\n');
  
  console.log('\n========== Weak Signal 回避检测 ==========');
  console.log(`Profile B 声明需要回避的弱词：${weakWords.join(', ')}`);
  console.log('');
  
  let avoided = 0, same = 0, increased = 0;
  for (const w of weakWords) {
    const countA = (textA.match(new RegExp(w, 'g')) || []).length;
    const countB = (textB.match(new RegExp(w, 'g')) || []).length;
    let status = '';
    if (countB < countA) { status = '✓ 回避'; avoided++; }
    else if (countB === countA) { status = '— 相同'; same++; }
    else { status = '✗ 反增'; increased++; }
    console.log(`  ${w}: A=${countA}次, B=${countB}次 ${status}`);
  }
  
  console.log(`\n  弱词汇总: 回避${avoided}个, 相同${same}个, 反增${increased}个`);
  
  console.log('');
  let cAvoided = 0, cSame = 0, cIncreased = 0;
  for (const ch of weakChars) {
    const countA = (textA.match(new RegExp(ch, 'g')) || []).length;
    const countB = (textB.match(new RegExp(ch, 'g')) || []).length;
    let status = '';
    if (countB < countA) { status = '✓ 回避'; cAvoided++; }
    else if (countB === countA) { status = '— 相同'; cSame++; }
    else { status = '✗ 反增'; cIncreased++; }
    console.log(`  ${ch}: A=${countA}次, B=${countB}次 ${status}`);
  }
  console.log(`\n  弱字汇总: 回避${cAvoided}个, 相同${cSame}个, 反增${cIncreased}个`);
}

async function outputTextSamples() {
  const ra = await getRewrite(REWRITE_A);
  const rb = await getRewrite(REWRITE_B);
  const pagesA = ra.pages_json;
  const pagesB = rb.pages_json;
  
  console.log('\n\n========== 文本逐页对比 ==========');
  for (let i = 0; i < Math.min(pagesA.length, pagesB.length); i++) {
    const pA = pagesA[i];
    const pB = pagesB[i];
    console.log(`\n--- 第${pA.page}页 ---`);
    console.log(`A: ${pA.text}`);
    console.log(`B: ${pB.text}`);
    if (pA.frontier?.length || pB.frontier?.length) {
      console.log(`  A-Frontiers: [${pA.frontier?.join(', ') || ''}]`);
      console.log(`  B-Frontiers: [${pB.frontier?.join(', ') || ''}]`);
    }
  }
}

async function main() {
  console.log('Phase 5B.2 - Audit Comparison');
  console.log(`Audit Engine: v${AUDIT_ENGINE_VERSION}`);
  console.log(`exp-A (action-focused): rewrite_id=${REWRITE_A}`);
  console.log(`exp-B (object-focused + weak signals): rewrite_id=${REWRITE_B}`);

  console.log(`\n加载数据...`);
  const rewA = await getRewrite(REWRITE_A);
  const rewB = await getRewrite(REWRITE_B);

  console.log(`运行 audit exp-A...`);
  const auditA = runAudit({
    pages: rewA.pages_json,
    target_level: rewA.target_level,
    frontier_targets: rewA.frontier_targets || [],
    rewrite_id: REWRITE_A,
  });
  console.log(`运行 audit exp-B...`);
  const auditB = runAudit({
    pages: rewB.pages_json,
    target_level: rewB.target_level,
    frontier_targets: rewB.frontier_targets || [],
    rewrite_id: REWRITE_B,
  });

  summarize('exp-A (action)', auditA);
  summarize('exp-B (object)', auditB);
  
  compareAudits(auditA, auditB);
  uniqueWordAnalysis(auditA, auditB);
  weakSignalAnalysis(rewA, rewB);
  await outputTextSamples();

  console.log('\n\n✅ Comparison complete');
}

main().catch((e) => {
  console.error('Failed:', e);
  process.exit(1);
});
