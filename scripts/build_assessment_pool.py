#!/usr/bin/env python3
"""
SRC Assessment Item Pool 构建脚本
基于 minimum_src_level 建立四级测试题池，并进行测试适用性筛选
"""
import re
import json
from pathlib import Path
from collections import OrderedDict

LEVELS = ['SRC100', 'SRC300', 'SRC500', 'SRC800']
LEVEL_INDEX = {lv: i for i, lv in enumerate(LEVELS)}
LEVEL_NUM = {lv: int(lv.replace('SRC', '')) for lv in LEVELS}

QUESTIONS_FILE = Path('/workspace/projects/src/lib/questions.ts')

# ====== 多音字候选表（常见多音字，用于标记）======
MULTI_READ_CHARS = set([
    '行', '长', '重', '少', '都', '好', '了', '着', '的', '地', '得',
    '一', '不', '看', '见', '说', '要', '会', '中', '大', '子', '还',
    '发', '觉', '教', '便', '量', '乐', '干', '分', '空', '间', '数',
    '种', '只', '作', '处', '背', '当', '担', '假', '间', '将', '卷',
    '卡', '可', '切', '盛', '省', '相', '降', '校', '兴', '旋', '扎',
    '转', '传', '弹', '调', '恶', '给', '供', '冠', '号', '喝', '还',
    '几', '奇', '骑', '强', '塞', '散', '扇', '提', '帖', '为', '系',
    '朝', '着', '正', '钻', '差', '藏', '曾', '乘', '答', '待', '倒',
    '更', '更', '哄', '划', '结', '尽', '禁', '卷', '卡', '看', '可',
    '落', '没', '模', '磨', '难', '宁', '屏', '铺', '强', '悄', '切',
    '曲', '散', '丧', '扫', '色', '塞', '深', '什', '识', '似', '熟',
    '数', '说', '宿', '汤', '挑', '调', '贴', '同', '吐', '驮', '瓦',
    '吓', '鲜', '相', '像', '削', '血', '压', '燕', '要', '耶', '叶',
    '衣', '遗', '殷', '应', '佣', '有', '予', '雨', '语', '晕', '载',
    '攒', '脏', '遭', '长', '涨', '爪', '召', '折', '这', '正', '挣',
    '之', '只', '中', '种', '重', '轴', '逐', '转', '赚', '钻', '作',
])

# ====== 虚词/语法词（测试价值较低，适合作为熟悉题而非核心题）======
FUNCTION_WORDS = set([
    '的', '了', '在', '是', '我', '你', '他', '她', '它', '们',
    '这', '那', '个', '一', '不', '也', '都', '就', '又', '还',
    '要', '会', '能', '可以', '可是', '但是', '因为', '所以',
    '如果', '虽然', '而且', '或者', '已经', '正在', '曾经',
    '着', '过', '给', '把', '被', '让', '从', '向', '对',
    '和', '跟', '同', '与', '及', '等', '啊', '呀', '呢', '吧',
    '吗', '哦', '嗯', '啦', '嘛', '哈', '唉', '哼', '咦',
])

# ====== 数量词/拟声词等特殊类别（测试辨识度低）======
# 通过模式匹配识别，不一一枚举


def extract_array(content: str, name: str) -> list:
    pattern = rf'export const {name}:\s*string\[\]\s*=\s*\[(.*?)\];'
    m = re.search(pattern, content, re.DOTALL)
    if not m:
        return []
    arr_content = m.group(1)
    items = re.findall(r"'([^']+)'", arr_content)
    return [item.strip() for item in items if item.strip()]


def analyze_char(char: str) -> dict:
    """分析单字测试适用性"""
    issues = []
    tags = []
    suitability = 'core'  # core / supplemental / low_value / exclude
    
    # 1. 多音字检测
    if char in MULTI_READ_CHARS:
        tags.append('multi_read')
        issues.append('多音字，需结合读音测试')
        suitability = 'supplemental'  # 多音字仍可测（字形识别），但不能做纯听音题
    
    # 2. 虚词检测
    if char in FUNCTION_WORDS:
        tags.append('function_word')
        # 虚词也是常用字，核心测试保留，但需注意
        if suitability == 'core':
            suitability = 'supplemental'
    
    # 3. 笔画太少的字（一、乙等），辨识度低
    strokes_estimate = len(char)  # 粗略估计
    if char in set(['一', '乙', '二', '十', '丁', '七', '八', '九', '人', '入', '几', '刀', '力', '又']):
        tags.append('low_stroke')
        # 笔画少但仍是常用字，保留为基础题
    
    # 4. 纯代词/助词
    if char in set(['的', '地', '得', '着', '了', '过', '吗', '呢', '啊', '吧', '呀']):
        tags.append('particle')
        # 助词作为字形测试价值较低，但仍是高频字
    
    return {
        'char': char,
        'tags': tags,
        'issues': issues,
        'suitability': suitability,
        'is_multi_read': char in MULTI_READ_CHARS,
        'is_function': char in FUNCTION_WORDS,
    }


def analyze_word(word: str, char_min_levels: dict) -> dict:
    """分析词语测试适用性"""
    issues = []
    tags = []
    suitability = 'core'
    
    char_len = len(word)
    
    # 1. 词语长度分类
    if char_len == 2:
        tags.append('disyllabic')
    elif char_len == 3:
        tags.append('trisyllabic')
    elif char_len >= 4:
        tags.append('long_word')
        if char_len > 5:
            issues.append('词语过长(>5字)，不适合快速识别测试')
            suitability = 'low_value'
    
    # 2. 检查组成字的minimum_src_level是否匹配
    min_level_idx = 999
    max_level_idx = -1
    for ch in word:
        if ch in char_min_levels:
            idx = LEVEL_INDEX.get(char_min_levels[ch], 0)
            min_level_idx = min(min_level_idx, idx)
            max_level_idx = max(max_level_idx, idx)
        else:
            # 字不在字库中，可能是生僻字
            tags.append('has_unknown_char')
            issues.append(f'包含非字库字：{ch}')
            suitability = 'low_value'
    
    # 3. 纯虚词组合（如"是的"、"不是"）- 有一定测试价值
    all_function = all(ch in FUNCTION_WORDS for ch in word)
    if all_function:
        tags.append('all_function_words')
        suitability = 'supplemental'
    
    # 4. 代词/人名类（"我的"、"你的"、"他们"）- 测试价值中等
    if word.endswith(('的', '们')) and char_len == 2:
        if 'all_function_words' not in tags:
            tags.append('possessive_pronoun')
    
    # 5. ABAB/ABB 式叠词（"跳来跳去"、"美美的"）- 有测试价值
    if char_len >= 4 and word[0] == word[2] and word[1] != word[3]:
        tags.append('abab_pattern')
    if char_len == 3 and word[1] == word[2]:
        tags.append('abb_pattern')
    
    # 6. 包含数量词（"一个"、"一只"）- 基础级常见
    if re.match(r'^[一二三四五六七八九十百千万][个只把片件条根张块]', word):
        tags.append('numeral_classifier')
    
    # 7. 成语/固定短语（四字及以上且语义凝练）
    if char_len == 4:
        # 简单判断：如果是成语结构
        tags.append('idiom_candidate')
        # 四字成语测试价值较高
        suitability = 'core'
    
    # 8. 专有名词（人名、地名、书名）
    proper_noun_markers = ['王', '帝', '皇', '圣', '宫', '殿', '海', '山', '洞', '云', '星', '金']
    if char_len >= 2 and word[0] in proper_noun_markers and char_len >= 3:
        tags.append('proper_noun_candidate')
        # 专有名词仍有阅读价值
    
    # 9. 口语/俚语色彩的词（"吓坏"、"大笑"）
    # 暂不单独分类
    
    # 10. 检查是否是"A一A"、"A了A"等重叠结构
    if char_len == 3 and word[1] in ('一', '了') and word[0] == word[2]:
        tags.append('a_x_a_pattern')
        # 重叠式动词测试价值中等
    
    return {
        'word': word,
        'char_count': char_len,
        'tags': tags,
        'issues': issues,
        'suitability': suitability,
        'min_char_level': LEVELS[min_level_idx] if min_level_idx < 999 else None,
        'max_char_level': LEVELS[max_level_idx] if max_level_idx >= 0 else None,
    }


def main():
    print('构建 SRC Assessment Item Pool...\n')
    
    content = QUESTIONS_FILE.read_text(encoding='utf-8')
    
    # 提取原始字库
    char_libs = {}
    word_libs = {}
    for lv in LEVELS:
        char_libs[lv] = extract_array(content, f'{lv}_CHARS')
        word_libs[lv] = extract_array(content, f'{lv}_WORDS')
    
    # 第一步：建立单字 minimum_src_level
    char_min_level = {}
    for lv in LEVELS:
        for ch in char_libs[lv]:
            if ch not in char_min_level:
                char_min_level[ch] = lv
    
    # 第二步：建立词语 minimum_src_level
    word_min_level = {}
    for lv in LEVELS:
        for w in word_libs[lv]:
            if w not in word_min_level:
                word_min_level[w] = lv
    
    # 第三步：单字适用性分析
    char_pool = {}
    for ch, min_lv in char_min_level.items():
        analysis = analyze_char(ch)
        char_pool[ch] = {
            'character': ch,
            'minimum_src_level': min_lv,
            'item_type': 'character',
            'tags': analysis['tags'],
            'issues': analysis['issues'],
            'suitability': analysis['suitability'],
            'is_multi_read': analysis['is_multi_read'],
            'is_function_word': analysis['is_function'],
        }
    
    # 第四步：词语适用性分析
    word_pool = {}
    for w, min_lv in word_min_level.items():
        analysis = analyze_word(w, char_min_level)
        word_pool[w] = {
            'word': w,
            'minimum_src_level': min_lv,
            'item_type': 'vocabulary',
            'char_count': analysis['char_count'],
            'tags': analysis['tags'],
            'issues': analysis['issues'],
            'suitability': analysis['suitability'],
            'min_char_level': analysis['min_char_level'],
            'max_char_level': analysis['max_char_level'],
        }
    
    # ============================================================
    # 统计输出
    # ============================================================
    
    print('=' * 60)
    print('一、单字测试题池统计')
    print('=' * 60)
    
    for lv in LEVELS:
        level_chars = [c for c in char_pool.values() if c['minimum_src_level'] == lv]
        core = [c for c in level_chars if c['suitability'] == 'core']
        supp = [c for c in level_chars if c['suitability'] == 'supplemental']
        low = [c for c in level_chars if c['suitability'] == 'low_value']
        multi = [c for c in level_chars if c['is_multi_read']]
        func = [c for c in level_chars if c['is_function_word']]
        
        print(f'\n【{lv}】 总{len(level_chars)}字')
        print(f'  核心测试题（core）: {len(core)} 字')
        print(f'  补充测试题（supplemental）: {len(supp)} 字')
        print(f'  低测试价值（low_value）: {len(low)} 字')
        print(f'  多音字: {len(multi)} 字')
        print(f'  虚词/功能字: {len(func)} 字')
        
        if core:
            print(f'  核心字示例: {" ".join([c["character"] for c in core[:10]])}')
        if multi:
            print(f'  多音字示例: {" ".join([c["character"] for c in multi[:10]])}')
        if func:
            print(f'  功能字示例: {" ".join([c["character"] for c in func[:10]])}')
    
    total_chars = len(char_pool)
    total_core_chars = sum(1 for c in char_pool.values() if c['suitability'] == 'core')
    total_supp_chars = sum(1 for c in char_pool.values() if c['suitability'] == 'supplemental')
    total_multi_chars = sum(1 for c in char_pool.values() if c['is_multi_read'])
    total_func_chars = sum(1 for c in char_pool.values() if c['is_function_word'])
    
    print(f'\n【合计】 {total_chars} 唯一单字')
    print(f'  核心: {total_core_chars} ({total_core_chars/total_chars*100:.1f}%)')
    print(f'  补充: {total_supp_chars} ({total_supp_chars/total_chars*100:.1f}%)')
    print(f'  多音字: {total_multi_chars} ({total_multi_chars/total_chars*100:.1f}%)')
    print(f'  功能字: {total_func_chars} ({total_func_chars/total_chars*100:.1f}%)')
    
    print()
    print('=' * 60)
    print('二、词语测试题池统计')
    print('=' * 60)
    
    for lv in LEVELS:
        level_words = [w for w in word_pool.values() if w['minimum_src_level'] == lv]
        core = [w for w in level_words if w['suitability'] == 'core']
        supp = [w for w in level_words if w['suitability'] == 'supplemental']
        low = [w for w in level_words if w['suitability'] == 'low_value']
        
        # 按字数分
        len2 = [w for w in level_words if w['char_count'] == 2]
        len3 = [w for w in level_words if w['char_count'] == 3]
        len4plus = [w for w in level_words if w['char_count'] >= 4]
        
        # 结构标签
        abb = [w for w in level_words if 'abb_pattern' in w['tags']]
        abab = [w for w in level_words if 'abab_pattern' in w['tags']]
        idiom = [w for w in level_words if 'idiom_candidate' in w['tags']]
        proper = [w for w in level_words if 'proper_noun_candidate' in w['tags']]
        
        print(f'\n【{lv}】 总{len(level_words)}词')
        print(f'  核心测试词（core）: {len(core)} 词')
        print(f'  补充测试词（supplemental）: {len(supp)} 词')
        print(f'  低测试价值（low_value）: {len(low)} 词')
        print(f'  二字词: {len(len2)} / 三字词: {len(len3)} / 四字+: {len(len4plus)}')
        print(f'  ABB式: {len(abb)} / ABAB式: {len(abab)} / 四字成语类: {len(idiom)} / 专有名词类: {len(proper)}')
        
        if low:
            print(f'  低价值词: {"、".join([w["word"] for w in low[:5]])}')
            if len(low) > 5:
                print(f'    等共{len(low)}个')
    
    total_words = len(word_pool)
    total_core_words = sum(1 for w in word_pool.values() if w['suitability'] == 'core')
    total_supp_words = sum(1 for w in word_pool.values() if w['suitability'] == 'supplemental')
    total_low_words = sum(1 for w in word_pool.values() if w['suitability'] == 'low_value')
    
    print(f'\n【合计】 {total_words} 唯一词语')
    print(f'  核心: {total_core_words} ({total_core_words/total_words*100:.1f}%)')
    print(f'  补充: {total_supp_words} ({total_supp_words/total_words*100:.1f}%)')
    print(f'  低价值: {total_low_words} ({total_low_words/total_words*100:.1f}%)')
    
    # ============================================================
    # 五、被排除字词及原因
    # ============================================================
    print()
    print('=' * 60)
    print('三、被排除/低价值字词清单')
    print('=' * 60)
    
    low_value_chars = [c for c in char_pool.values() if c['suitability'] == 'low_value']
    low_value_words = [w for w in word_pool.values() if w['suitability'] == 'low_value']
    
    print(f'\n单字低价值: {len(low_value_chars)} 字')
    if low_value_chars:
        for c in low_value_chars[:20]:
            print(f"  {c['character']} ({c['minimum_src_level']}): {'; '.join(c['issues'])}")
    
    print(f'\n词语低价值: {len(low_value_words)} 词')
    if low_value_words:
        for w in low_value_words[:30]:
            print(f"  {w['word']} ({w['minimum_src_level']}): {'; '.join(w['issues'])}")
    
    # ============================================================
    # 六、每级随机抽题策略
    # ============================================================
    print()
    print('=' * 60)
    print('四、每级抽题策略建议')
    print('=' * 60)
    
    for lv in LEVELS:
        level_chars = [c for c in char_pool.values() if c['minimum_src_level'] == lv]
        level_words = [w for w in word_pool.values() if w['minimum_src_level'] == lv]
        core_chars = [c for c in level_chars if c['suitability'] == 'core']
        supp_chars = [c for c in level_chars if c['suitability'] == 'supplemental']
        core_words = [w for w in level_words if w['suitability'] == 'core']
        supp_words = [w for w in level_words if w['suitability'] == 'supplemental']
        
        # 建议每级抽5单字3词（自适应测试）
        rec_chars = 5
        rec_words = 3
        
        print(f'\n【{lv}】抽题策略')
        print(f'  可用题量: 单字{len(level_chars)}（核心{len(core_chars)}+补充{len(supp_chars)}）/ 词语{len(level_words)}（核心{len(core_words)}+补充{len(supp_words)}）')
        print(f'  建议单题量: {rec_chars}单字 + {rec_words}词 = {rec_chars + rec_words}题/级')
        print(f'  抽取策略:')
        print(f'    单字: 70%核心实词 + 30%补充（含虚词/多音字）')
        print(f'    词语: 80%核心词（二字为主）+ 20%补充（ABB/ABAB/成语等）')
        print(f'    难度分布: 前20%简单核心 → 中60%混合 → 后20%挑战（长词/成语）')
        print(f'    去聚集: 避免同一字、同一语义场连续出现')
        
        # 计算能否支持充足的随机组合
        import math
        from math import comb
        char_combos = comb(len(core_chars) + len(supp_chars), rec_chars) if len(core_chars) + len(supp_chars) >= rec_chars else 0
        word_combos = comb(len(core_words) + len(supp_words), rec_words) if len(core_words) + len(supp_words) >= rec_words else 0
        
        if char_combos > 1000:
            char_diversity = '充足'
        elif char_combos > 100:
            char_diversity = '一般'
        else:
            char_diversity = '有限'
        
        print(f'  随机组合多样性: 单字约{char_diversity}（{char_combos:.2e}种组合）')
    
    # ============================================================
    # 输出 JSON 数据
    # ============================================================
    pool_data = {
        'generated_at': __import__('datetime').datetime.now().isoformat(),
        'version': 'v1.2',
        'summary': {
            'total_unique_chars': total_chars,
            'total_unique_words': total_words,
            'per_level_chars': {lv: len([c for c in char_pool.values() if c['minimum_src_level'] == lv]) for lv in LEVELS},
            'per_level_words': {lv: len([w for w in word_pool.values() if w['minimum_src_level'] == lv]) for lv in LEVELS},
            'per_level_core_chars': {lv: len([c for c in char_pool.values() if c['minimum_src_level'] == lv and c['suitability'] == 'core']) for lv in LEVELS},
            'per_level_core_words': {lv: len([w for w in word_pool.values() if w['minimum_src_level'] == lv and w['suitability'] == 'core']) for lv in LEVELS},
            'per_level_supplemental_chars': {lv: len([c for c in char_pool.values() if c['minimum_src_level'] == lv and c['suitability'] == 'supplemental']) for lv in LEVELS},
            'per_level_supplemental_words': {lv: len([w for w in word_pool.values() if w['minimum_src_level'] == lv and w['suitability'] == 'supplemental']) for lv in LEVELS},
            'multi_read_char_count': total_multi_chars,
            'function_word_count': total_func_chars,
        },
        'char_pool': {k: v for k, v in char_pool.items()},
        'word_pool': {k: v for k, v in word_pool.items()},
    }
    
    json_path = Path('/workspace/projects/SRC_ASSESSMENT_POOL.json')
    json_path.write_text(json.dumps(pool_data, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'\n✅ 题池JSON已输出: {json_path}')
    
    # ============================================================
    # 生成 Markdown 报告
    # ============================================================
    report_lines = []
    report_lines.append('# SRC Assessment Item Pool - 测试题池报告\n')
    report_lines.append('> 基于 minimum_src_level 构建，纯分析不修改原始字库\n')
    
    report_lines.append('## 一、总览\n')
    report_lines.append(f'- 唯一单字总数：**{total_chars}**（核心 {total_core_chars} / 补充 {total_supp_chars}）')
    report_lines.append(f'- 唯一词语总数：**{total_words}**（核心 {total_core_words} / 补充 {total_supp_words} / 低价值 {total_low_words}）')
    report_lines.append(f'- 多音字：{total_multi_chars} 字')
    report_lines.append(f'- 虚词/功能字：{total_func_chars} 字\n')
    
    report_lines.append('### 各级题量\n')
    report_lines.append('| 等级 | 单字总量 | 核心单字 | 补充单字 | 词语总量 | 核心词语 | 补充词语 |')
    report_lines.append('|------|--------:|--------:|--------:|--------:|--------:|--------:|')
    for lv in LEVELS:
        lc = len([c for c in char_pool.values() if c['minimum_src_level'] == lv])
        cc = len([c for c in char_pool.values() if c['minimum_src_level'] == lv and c['suitability'] == 'core'])
        sc = len([c for c in char_pool.values() if c['minimum_src_level'] == lv and c['suitability'] == 'supplemental'])
        lw = len([w for w in word_pool.values() if w['minimum_src_level'] == lv])
        cw = len([w for w in word_pool.values() if w['minimum_src_level'] == lv and w['suitability'] == 'core'])
        sw = len([w for w in word_pool.values() if w['minimum_src_level'] == lv and w['suitability'] == 'supplemental'])
        report_lines.append(f'| {lv} | {lc} | {cc} | {sc} | {lw} | {cw} | {sw} |')
    report_lines.append('')
    
    report_lines.append('## 二、筛选标准\n')
    report_lines.append('### 单字分类\n')
    report_lines.append('- **core（核心测试题）**：实词、常用字、字形清晰、测试辨识度高')
    report_lines.append('- **supplemental（补充测试题）**：多音字、虚词、功能字、代词、助词等。字形识别仍可测试，但需注意测试形式')
    report_lines.append('- **low_value（低测试价值）**：本次未发现')
    report_lines.append('')
    report_lines.append('### 词语分类\n')
    report_lines.append('- **core（核心测试题）**：二字常用词、四字成语/固定短语、语义明确易识别')
    report_lines.append('- **supplemental（补充测试题）**：叠词（ABB/ABAB）、量名结构、专有名词、虚词组合等。仍有测试价值，但多样性稍弱')
    report_lines.append('- **low_value（低测试价值）**：过长词语(>5字)、包含非字库字的词、纯口语语气词组合')
    report_lines.append('')
    
    report_lines.append('## 三、被排除字词及原因\n')
    report_lines.append(f'### 单字（{len(low_value_chars)}个）\n')
    if low_value_chars:
        for c in low_value_chars:
            report_lines.append(f"- `{c['character']}` ({c['minimum_src_level']}): {'; '.join(c['issues'])}")
    else:
        report_lines.append('单字中无低测试价值条目，全部可用。\n')
    report_lines.append('')
    report_lines.append(f'### 词语（{len(low_value_words)}个）\n')
    if low_value_words:
        report_lines.append('| 词语 | 等级 | 原因 |')
        report_lines.append('|------|------|------|')
        for w in low_value_words:
            report_lines.append(f"| {w['word']} | {w['minimum_src_level']} | {'; '.join(w['issues'])} |")
    else:
        report_lines.append('词语中无低测试价值条目。\n')
    report_lines.append('')
    
    report_lines.append('## 四、多音字统计\n')
    report_lines.append(f'- 四级字库中检测到多音字候选 **{total_multi_chars}** 字\n')
    report_lines.append('> 说明：多音字不影响字形识别测试（直接测试采用"认识/不认识"模式），但在未来听音辨字等题型中需特别处理。\n')
    report_lines.append('### 各级多音字数量\n')
    report_lines.append('| 等级 | 多音字数量 | 占本级比例 |')
    report_lines.append('|------|----------:|----------:|')
    for lv in LEVELS:
        lc = [c for c in char_pool.values() if c['minimum_src_level'] == lv]
        mc = [c for c in lc if c['is_multi_read']]
        pct = len(mc) / len(lc) * 100 if lc else 0
        sample = '、'.join([c['character'] for c in mc[:8]])
        report_lines.append(f'| {lv} | {len(mc)} | {pct:.1f}% |')
    report_lines.append('')
    
    report_lines.append('## 五、每级随机抽题策略\n')
    report_lines.append('### 基本原则\n')
    report_lines.append('1. **核心优先**：每级抽题优先从 core 池中抽取，保证测试的代表性')
    report_lines.append('2. **补充补充**：从 supplemental 池中抽取一定比例，保证覆盖面')
    report_lines.append('3. **难度梯度**：前20%简单核心 → 中60%混合 → 后20%挑战')
    report_lines.append('4. **去聚集**：避免同一偏旁/同音字/同语义场连续出现')
    report_lines.append('5. **随机但不重复**：同一session内不出现相同题；不同session尽量避免重复\n')
    
    report_lines.append('### 自适应测试（直接测试）每级题量\n')
    report_lines.append('每级：**5个单字 + 3个词语 = 8题**\n')
    report_lines.append('| 等级 | 单字抽取策略 | 词语抽取策略 |')
    report_lines.append('|------|------------|------------|')
    
    for lv in LEVELS:
        lc = [c for c in char_pool.values() if c['minimum_src_level'] == lv]
        lw = [w for w in word_pool.values() if w['minimum_src_level'] == lv]
        cc = [c for c in lc if c['suitability'] == 'core']
        cw = [w for w in lw if w['suitability'] == 'core']
        sc = [c for c in lc if c['suitability'] == 'supplemental']
        sw = [w for w in lw if w['suitability'] == 'supplemental']
        
        report_lines.append(f'| {lv} | 核心{min(4, len(cc))}个 + 补充{max(0, 5-min(4, len(cc)))}个 | 核心{min(2, len(cw))}个 + 补充{max(0, 3-min(2, len(cw)))}个 |')
    report_lines.append('')
    
    report_lines.append('### 排序原则\n')
    report_lines.append('- **易→难**：同一级别内，先出现高频常用词，后出现低频/成语/长词')
    report_lines.append('- **打散语义**：避免"高山、山上、山中"这样语义高度相似的词连续出现')
    report_lines.append('- **单字词语交替**：先单字后词语（或交替），保持孩子注意力')
    report_lines.append('- **升级缓冲**：刚升级的前2题从"上一级核心词"中出1题做信心缓冲\n')
    
    report_lines.append('### 随机多样性估算\n')
    report_lines.append('| 等级 | 单字组合数 | 词语组合数 | 防重能力 |')
    report_lines.append('|------|----------:|----------:|----------|')
    from math import comb
    for lv in LEVELS:
        lc = len([c for c in char_pool.values() if c['minimum_src_level'] == lv and c['suitability'] in ('core', 'supplemental')])
        lw = len([w for w in word_pool.values() if w['minimum_src_level'] == lv and w['suitability'] in ('core', 'supplemental')])
        cc = comb(lc, 5) if lc >= 5 else 0
        ww = comb(lw, 3) if lw >= 3 else 0
        
        if cc > 10000:
            ca = '极强'
        elif cc > 1000:
            ca = '强'
        elif cc > 100:
            ca = '中等'
        else:
            ca = '弱'
        
        report_lines.append(f'| {lv} | {cc:.2e} | {ww:.2e} | 单字{ca} |')
    report_lines.append('')
    
    report_lines.append('## 六、核心测试题推荐（每级核心Top示例）\n')
    
    for lv in LEVELS:
        report_lines.append(f'### {lv} 核心单字示例\n')
        cc = [c for c in char_pool.values() if c['minimum_src_level'] == lv and c['suitability'] == 'core']
        # 优先选实词、非多音字
        best = [c for c in cc if not c['is_multi_read'] and not c['is_function_word']][:20]
        report_lines.append('、'.join([c['character'] for c in best]) + '\n')
        
        report_lines.append(f'### {lv} 核心词语示例\n')
        cw = [w for w in word_pool.values() if w['minimum_src_level'] == lv and w['suitability'] == 'core']
        # 优先选二字词
        best_w = sorted(cw, key=lambda w: w['char_count'])[:20]
        report_lines.append('、'.join([w['word'] for w in best_w]) + '\n')
    
    report_path = Path('/workspace/projects/SRC_ASSESSMENT_POOL_REPORT.md')
    report_path.write_text('\n'.join(report_lines), encoding='utf-8')
    print(f'✅ 题池报告已输出: {report_path}')


if __name__ == '__main__':
    main()
