import { runAudit, pagesFromTexts } from '@/lib/book-rewrite/audit';

const pages = [
  "安静的冬天，我要讲一个好听的老故事。准备好啦吗？我们现在就开始。一片两片三四片，五片六片七八片。九片十片无数片，飞入水中都不见。",
  "有些故事一听见，人就会慢慢静下来。风轻轻吹，雪一片一片往下落。冷冷的冬天里，《西游记》的故事开始啦。",
  "很久很久以前，中国东边有一座山。这座山的名字叫花果山。那天山里很安静，雪慢慢地下着。",
  "忽然传来咔嚓一声响。一块又大又圆的石头，一下子裂开了。",
  "石头里跳出来一只小猴子。这只小猴子不哭也不怕，睁大眼睛看看世界。他跑一跑跳一跳，跑得特别快跳得特别高。别的猴子看见都觉得他好厉害。",
  "猴子们越来越喜欢这只小猴子。他们一起说：你最勇敢最聪明，当我们的大王好不好？这只小猴子就成了大王，大家叫他美猴王。",
  "猴子们每天都玩得很高兴，可美猴王不满足。他坐着想：遇到厉害的人怎么办？有人欺负猴子们怎么办？他下定决心要变得更厉害。",
  "后来美猴王拜了老师，学会了很多本领，有了新名字孙悟空。孙悟空会飞，一个筋斗能飞十万八千里，还会七十二变。可他没有厉害的武器，猴子们也没有。",
  "这时有只老猴悄悄告诉孙悟空：东边很远的地方有座京城，城里的兵器库有很多武器。孙悟空眼睛亮了，说要去看看。",
  "于是孙悟空跳到半空中，飞向东方的京城。京城里有什么？孙悟空能找到合适的武器吗？你猜后来发生了什么？",
];

const result = runAudit({
  pages: pagesFromTexts(pages),
  targetLevel: 'SRC300',
});

console.log('='.repeat(72));
console.log('  Emma Regression Test — Phase 3 vs Audit Engine V1');
console.log('='.repeat(72));

const expected = {
  char_total: 473,
  char_out_occur: 55,
  char_out_rate: 11.63,
  lu_occ_total: 103,
  I_occ: 66,
  I_occ_rate: 64.1,
  I1A_occ: 21,
  I1A_occ_rate: 20.4,
  I1B_occ: 4,
  I1B_occ_rate: 3.9,
  HL_occ: 12,
  HL_occ_rate: 11.7,
  p5_I: 7,
  p5_I1A: 5,
  p5_I1B: 2,
  p5_HL: 1,
  p5_total: 15,
};

const actual = {
  char_total: result.character_audit.total_characters,
  char_out_occur: result.character_audit.src_out_occurrences,
  char_out_rate: +result.character_audit.external_char_rate.toFixed(2),
  lu_occ_total: result.language_unit_audit.total_occurrences,
  I_occ: result.language_unit_audit.I_occurrences,
  I_occ_rate: +result.language_unit_audit.I_occurrence_rate.toFixed(1),
  I1A_occ: result.language_unit_audit.I1A_occurrences,
  I1A_occ_rate: +result.language_unit_audit.I1A_occurrence_rate.toFixed(1),
  I1B_occ: result.language_unit_audit.I1B_occurrences,
  I1B_occ_rate: +result.language_unit_audit.I1B_occurrence_rate.toFixed(1),
  HL_occ: result.language_unit_audit.high_load_occurrences,
  HL_occ_rate: +result.language_unit_audit.high_load_occurrence_rate.toFixed(1),
  p5_I: result.page_audit.pages[4].I,
  p5_I1A: result.page_audit.pages[4]['I+1A'],
  p5_I1B: result.page_audit.pages[4]['I+1B'],
  p5_HL: result.page_audit.pages[4]['high_load'],
  p5_total: result.page_audit.pages[4].lu_occurrences,
};

const checks: boolean[] = [];

console.log('\n【Character Layer】\n');
console.log('  ┌──────────────────────┬──────────────┬──────────┬────────┐');
console.log('  │ 指标                  │ 期望(Phase3) │ 实际(V1) │ 状态   │');
console.log('  ├──────────────────────┼──────────────┼──────────┼────────┤');

function row(label: string, exp: number, act: number, tol = 0.1) {
  const pass = Math.abs(act - exp) <= tol;
  checks.push(pass);
  console.log(`  │ ${label.padEnd(20)} │ ${String(exp).padStart(12)} │ ${String(act).padStart(8)} │ ${pass ? '✅ PASS' : '❌ FAIL'} │`);
}

row('Chinese Characters', expected.char_total, actual.char_total, 0);
row('External Occurrences', expected.char_out_occur, actual.char_out_occur, 0);
row('External Rate (%)', expected.char_out_rate, actual.char_out_rate, 0.5);
console.log('  └──────────────────────┴──────────────┴──────────┴────────┘');

console.log('\n【Language Unit Layer (Occurrence)】\n');
console.log('  ┌──────────────────────┬──────────────┬──────────┬────────┐');
console.log('  │ 指标                  │ 期望(Phase3) │ 实际(V1) │ 状态   │');
console.log('  ├──────────────────────┼──────────────┼──────────┼────────┤');

row('Total LU Occurrences', expected.lu_occ_total, actual.lu_occ_total, 0);
row('I Occurrences', expected.I_occ, actual.I_occ, 0);
row('I Rate (%)', expected.I_occ_rate, actual.I_occ_rate, 1.0);
row('I+1A Occurrences', expected.I1A_occ, actual.I1A_occ, 0);
row('I+1A Rate (%)', expected.I1A_occ_rate, actual.I1A_occ_rate, 1.0);
row('I+1B Occurrences', expected.I1B_occ, actual.I1B_occ, 0);
row('I+1B Rate (%)', expected.I1B_occ_rate, actual.I1B_occ_rate, 0.5);
row('High-load Occurrences', expected.HL_occ, actual.HL_occ, 0);
row('High-load Rate (%)', expected.HL_occ_rate, actual.HL_occ_rate, 1.0);
console.log('  └──────────────────────┴──────────────┴──────────┴────────┘');

console.log('\n【Page 5 明细】\n');
console.log('  ┌──────────┬──────┬──────┬──────┐');
console.log('  │          │ 期望 │ 实际 │ 状态 │');
console.log('  ├──────────┼──────┼──────┼──────┤');

function row2(label: string, exp: number, act: number) {
  const pass = exp === act;
  checks.push(pass);
  console.log(`  │ ${label.padEnd(8)} │ ${String(exp).padStart(4)} │ ${String(act).padStart(4)} │ ${pass ? '✅ PASS' : '❌ FAIL'} │`);
}
row2('I', expected.p5_I, actual.p5_I);
row2('I+1A', expected.p5_I1A, actual.p5_I1A);
row2('I+1B', expected.p5_I1B, actual.p5_I1B);
row2('High-load', expected.p5_HL, actual.p5_HL);
row2('Total LU', expected.p5_total, actual.p5_total);
console.log('  └──────────┴──────┴──────┴──────┘');

console.log('\n【专项检查】\n');

const paoyipao = result.language_unit_audit.units.find(u => u.unit === '跑一跑');
if (paoyipao) {
  const pass = paoyipao.level === 'I';
  checks.push(pass);
  console.log(`  跑一跑 = ${paoyipao.level} ${pass ? '✅ PASS' : '❌ FAIL'} (外字=${paoyipao.external_char_count})`);
} else { checks.push(false); console.log('  跑一跑 = 未匹配到 ❌ FAIL'); }

const tebie = result.language_unit_audit.units.find(u => u.unit === '特别');
if (tebie) {
  const pass = tebie.level === 'I+1B';
  checks.push(pass);
  console.log(`  特别 = ${tebie.level} ${pass ? '✅ PASS' : '❌ FAIL'} (外字=${tebie.external_char_count})`);
} else { checks.push(false); console.log('  特别 = 未匹配到 ❌ FAIL'); }

const yonggan = result.language_unit_audit.units.find(u => u.unit === '勇敢');
if (yonggan) {
  const pass = yonggan.level === 'High-load';
  checks.push(pass);
  console.log(`  勇敢 = ${yonggan.level} ${pass ? '✅ PASS' : '❌ FAIL'} (外字=${yonggan.external_char_count})`);
} else { checks.push(false); console.log('  勇敢 = 未匹配到 ❌ FAIL'); }

const hlUnits = result.language_unit_audit.units.filter(u => u.level === 'High-load').map(u => u.unit);
console.log(`\n  High-load = ${hlUnits.length} 个: ${hlUnits.sort().join('、')}`);
const expectedHL = ['西游记','下定决心','勇敢','欺负','聪明','满足','世界','准备','告诉','合适','悄悄','冷冷'];
const hlMatch = hlUnits.length === expectedHL.length && expectedHL.every(w => hlUnits.includes(w));
checks.push(hlMatch);
console.log(`  High-load 名单 ${hlMatch ? '✅ PASS' : '❌ FAIL'}`);
if (!hlMatch) {
  const missing = expectedHL.filter(w => !hlUnits.includes(w));
  const extra = hlUnits.filter(w => !expectedHL.includes(w));
  if (missing.length) console.log(`    缺失: ${missing.join('、')}`);
  if (extra.length) console.log(`    多余: ${extra.join('、')}`);
}

// 汇总
console.log('\n' + '='.repeat(72));
const total = checks.length;
const passed = checks.filter(Boolean).length;
const failed = total - passed;
console.log(`  Regression Test: ${passed}/${total} PASS${failed > 0 ? `, ${failed} FAIL` : ''}`);
console.log(`  Status: ${failed === 0 ? '✅ ALL PASS' : '❌ FAILED'}`);
console.log('='.repeat(72));

if (failed > 0) {
  console.log('\n【调试：所有LU】\n');
  result.language_unit_audit.units.sort((a,b) => a.unit.localeCompare(b.unit)).forEach(u => {
    console.log(`  ${u.unit.padEnd(10)} ${u.level.padEnd(10)} 外=${u.external_char_count}  次=${u.occurrence_count}  attr=${u.attributes.join(',')}`);
  });
}
