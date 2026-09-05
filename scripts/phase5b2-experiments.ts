/**
 * Phase 5B.2 Experiment A — 生成两个实验 Profile 的对比版本
 * 
 * Profile A: Action-Focused (动作主导型)
 * Profile B: Object-Focused (物件/抽象主导型 + weak signals)
 * 
 * 相同 Master Story (西游记第1集) + target_level=SRC300
 * 标记 experimental_profile=true
 */

const EPISODE_ID = 2;
const TARGET_LEVEL = 'SRC300';
const BASE_URL = 'http://localhost:5000';
const ADMIN_PASSWORD = 'srcc2026';

const profileA = {
  label: 'exp-A-action',
  stable_char_count: 250,
  stable_vocab_count: 300,
  character_mastery_rate: 85,
  vocab_mastery_rate: 80,
  known_characters: [
    '看', '走', '跑', '跳', '飞', '来', '出', '笑', '打', '拿',
    '找', '变', '吃', '喝', '坐', '站', '开', '睡', '见', '听',
    '说', '叫', '起', '跟', '抓', '放', '翻', '转', '住', '回',
    '上', '下', '快', '慢', '高', '低', '大', '小', '很', '都',
    '又', '再', '就', '还', '也', '要', '在', '是', '的', '了',
    '一', '个', '人', '他', '你', '我', '们', '不', '有', '这',
    '那', '里', '中', '天', '地', '时', '候', '好', '像', '去',
    '后', '面', '从', '把', '用', '少', '多', '其', '它', '美',
    '片', '可', '玩', '生', '长', '起', '老', '师', '学', '本',
    '事', '没', '武', '器', '远', '方', '吗', '为', '什', '么',
    '只', '兴', '喜', '欢', '东', '西', '过', '能', '始', '以',
  ],
  known_vocabulary: [
    '看见', '走路', '跑步', '跳来跳去', '飞来飞去', '出来',
    '笑了', '打开', '拿走', '找到', '变化', '吃东西', '喝水',
    '坐下', '站好', '开始', '睡觉', '听见', '说道', '叫着',
    '起来', '跟着', '抓住', '放开', '翻身', '转动', '住在',
    '回来', '高兴', '喜欢', '好玩', '玩一玩', '看看', '走走',
    '跑跑', '跳跳', '飞飞', '听听', '说说', '笑笑', '打打',
    '拿拿',
  ],
  weak_char_signals: [],
  weak_word_signals: [],
};

const profileB = {
  label: 'exp-B-object',
  stable_char_count: 250,
  stable_vocab_count: 300,
  character_mastery_rate: 85,
  vocab_mastery_rate: 80,
  known_characters: [
    '石', '山', '水', '火', '云', '雨', '风', '花', '果', '树',
    '草', '木', '海', '天', '日', '月', '光', '星', '金', '玉',
    '宝', '贝', '神', '仙', '心', '想', '知', '意', '情', '法',
    '眼', '睛', '真', '声', '音', '前', '太', '手', '皇', '帝',
    '筋', '斗', '箍', '棒', '殿', '兵', '将', '胜', '齐', '圣',
    '白', '吹', '马', '校', '朋', '友', '动', '字', '给', '做',
    '官', '让', '妖', '怪', '魔', '得', '新', '觉', '毫', '毛',
    '细', '孙', '悟', '空', '左', '右', '亮', '年', '阳', '百',
    '千', '万', '进', '铁', '桥', '通', '向', '宫', '件', '刀',
    '次', '更', '传', '京', '城', '如', '重', '夜', '叉', '间',
    '衣', '服', '盔', '甲', '黑', '帘', '洞', '故', '急', '安',
    '静', '分', '您', '怎', '办', '样', '原', '厉', '害', '怕',
    '请', '忽', '然', '刚', '同', '关', '门', '土', '和', '谁',
    '哪', '呢', '吧', '儿', '底', '问', '抓', '气', '已', '经',
    '针', '连', '吓', '完', '成', '房', '许', '斤', '色', '轻',
    '点', '啊', '越', '几', '些', '处', '久', '酒', '根', '庭',
    '边', '乎', '最', '口', '哈', '现', '带', '正', '接', '别',
    '直', '于', '被', '话', '而', '名', '放', '继', '续',
  ],
  known_vocabulary: [
    '石头', '大山', '海水', '大火', '白云', '下雨', '大风',
    '花儿', '果子', '树木', '花草', '东海', '天空', '太阳',
    '月亮', '阳光', '星星', '金色', '白玉', '宝贝', '神仙',
    '心里', '想法', '知道', '如意', '心情', '方法', '眼睛',
    '真的', '声音', '前面', '玉皇大帝', '筋斗云', '金箍棒',
    '宫殿', '兵将', '变化', '齐天大圣', '白色', '吹来', '天马',
    '学校', '好朋友', '名字', '给你', '做事', '做官', '让开',
    '妖怪', '怪人', '魔法', '得到', '新年', '觉得', '毫毛',
    '细心', '孙悟空', '左手', '右手', '千万', '进来', '铁桥',
    '通向', '方向', '龙宫', '一件', '大刀', '更好', '传说',
    '京城', '如意', '如果', '重大', '夜里', '夜叉', '时间',
    '衣服', '盔甲', '黑色', '水帘洞', '故事', '着急', '安静',
    '分开', '怎么办', '办法', '原来', '厉害', '害怕', '请问',
    '忽然', '然后', '刚刚', '同学', '关门', '土地', '和好',
    '谁的', '在哪里', '好吧', '底下', '问好', '请坐', '抓住',
    '生气', '已经', '经过', '转动', '吓坏', '完成', '成为',
    '许多', '也许', '点头', '是啊', '又是', '越来越好', '几个',
    '一些', '好处', '长久', '根本', '天庭', '家庭', '最好',
    '哈哈大笑', '现在', '带来', '正在', '接着', '别人', '直接',
    '于是', '远处', '阳光', '说话', '然而', '翻身', '放开', '继续',
  ],
  weak_char_signals: ['跳', '跑', '笑', '高', '兴'],
  weak_word_signals: ['高兴', '跳来跳去', '金箍棒', '笑了', '跑一跑'],
};

async function generate(label: string, profile: any) {
  console.log(`[${label}] 开始生成...`);
  const start = Date.now();
  const res = await fetch(`${BASE_URL}/api/books/rewrite`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-password': ADMIN_PASSWORD,
    },
    body: JSON.stringify({
      episode_id: EPISODE_ID,
      target_level: TARGET_LEVEL,
      generation_mode: 'experimental',
      experimental_profile: profile,
    }),
  });
  const data = await res.json();
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[${label}] 完成 (${elapsed}s) — rewrite_id=${data.rewrite_id}, status=${data.status}, success=${data.success}`);
  if (!data.success) {
    console.log(`[${label}] 失败原因: ${data.error || data.failure_reason || '未知'}`);
  }
  if (data.validation) {
    console.log(`[${label}] 验证: overall_pass=${data.validation.overall_pass}, summary=${data.validation.summary?.slice(0, 200)}`);
  }
  if (data.frontiers) {
    console.log(`[${label}] Frontiers: [${data.frontiers.join(', ')}]`);
  }
  return data;
}

async function main() {
  console.log('Phase 5B.2 Experiment A — 生成两个对比版本');
  console.log(`Episode: ${EPISODE_ID}, Level: ${TARGET_LEVEL}`);
  console.log('');

  const [resultA, resultB] = await Promise.all([
    generate('exp-A', profileA),
    generate('exp-B', profileB),
  ]);

  console.log('');
  console.log('=== 结果汇总 ===');
  console.log(`exp-A rewrite_id: ${resultA.rewrite_id}, status: ${resultA.status}`);
  console.log(`exp-B rewrite_id: ${resultB.rewrite_id}, status: ${resultB.status}`);

  // 输出页数和阅读量
  if (resultA.child_profile) {
    console.log(`\nexp-A profile: known_chars=${resultA.child_profile.observed_known_chars}, weak_words=${resultA.child_profile.weak_word_signals?.length || 0}`);
  }
  if (resultB.child_profile) {
    console.log(`exp-B profile: known_chars=${resultB.child_profile.observed_known_chars}, weak_words=${resultB.child_profile.weak_word_signals?.length || 0}`);
  }
}

main().catch((e) => {
  console.error('生成失败:', e.message);
  process.exit(1);
});
