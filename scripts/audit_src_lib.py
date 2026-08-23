#!/usr/bin/env python3
"""
SRC字词库审计脚本
扫描SRC100/300/500/800的单字库和词库，生成审计报告
"""
import re
import json
from pathlib import Path
from collections import OrderedDict

LEVELS = ['SRC100', 'SRC300', 'SRC500', 'SRC800']
LEVEL_INDEX = {lv: i for i, lv in enumerate(LEVELS)}

# 从 questions.ts 中提取各等级的字和词
QUESTIONS_FILE = Path('/workspace/projects/src/lib/questions.ts')

def extract_array(content: str, name: str) -> list[str]:
    """从TS文件中提取一个字符串数组"""
    pattern = rf'export const {name}:\s*string\[\]\s*=\s*\[(.*?)\];'
    m = re.search(pattern, content, re.DOTALL)
    if not m:
        return []
    arr_content = m.group(1)
    # 提取所有中文字符串
    items = re.findall(r"'([^']+)'", arr_content)
    return [item.strip() for item in items if item.strip()]

def normalize(s: str) -> str:
    return s.strip()

def audit_library(libs: dict) -> dict:
    """审计一个字库（单字或词语）"""
    items = OrderedDict()
    chain_anomalies = []
    intra_dup = []
    unicode_issues = []

    # 第一步：收集所有出现
    for level in LEVELS:
        lib = libs.get(level, [])
        seen_in_level = {}
        
        for raw in lib:
            content = normalize(raw)
            
            # Unicode异常检测
            if raw != content:
                unicode_issues.append({'level': level, 'content': repr(raw), 'issue': '前后空格'})
            
            # 零宽字符
            for ch in raw:
                if '\u200b' <= ch <= '\u200f' or '\u202a' <= ch <= '\u202e' or ch == '\ufeff':
                    unicode_issues.append({'level': level, 'content': repr(raw), 'issue': '零宽/控制字符'})
                    break
            
            # 本级查重
            seen_in_level[content] = seen_in_level.get(content, 0) + 1
            
            if content not in items:
                items[content] = {
                    'content': content,
                    'appears_in': {lv: False for lv in LEVELS},
                    'minimum_src_level': 'SRC800',
                    'occurrence_count': 0,
                    'source_levels': [],
                    'issues': [],
                }
            
            item = items[content]
            if not item['appears_in'][level]:
                item['appears_in'][level] = True
                item['occurrence_count'] += 1
                item['source_levels'].append(int(level.replace('SRC', '')))
        
        # 同级重复
        for c, count in seen_in_level.items():
            if count > 1:
                intra_dup.append({'level': level, 'content': c, 'count': count})
    
    # 第二步：计算minimum_src_level
    for item in items.values():
        for lv in LEVELS:
            if item['appears_in'][lv]:
                item['minimum_src_level'] = lv
                break
        item['source_levels'].sort()
    
    # 第三步：累积链异常
    for item in items.values():
        min_idx = LEVEL_INDEX[item['minimum_src_level']]
        for i in range(min_idx + 1, len(LEVELS)):
            higher_lv = LEVELS[i]
            if not item['appears_in'][higher_lv]:
                chain_anomalies.append({
                    'content': item['content'],
                    'from_level': item['minimum_src_level'],
                    'missing_level': higher_lv,
                })
                item['issues'].append(f'累积断裂: {item["minimum_src_level"]}有/{higher_lv}无')
    
    # 第四步：统计
    per_level_new = {lv: 0 for lv in LEVELS}
    per_level_cumulative = {lv: len(libs.get(lv, [])) for lv in LEVELS}
    per_level_dup = {lv: 0 for lv in LEVELS}
    
    for item in items.values():
        per_level_new[item['minimum_src_level']] += 1
    
    for level in LEVELS:
        min_idx = LEVEL_INDEX[level]
        count = 0
        for item in items.values():
            if item['appears_in'][level] and LEVEL_INDEX[item['minimum_src_level']] < min_idx:
                count += 1
        per_level_dup[level] = count
    
    return {
        'items': items,
        'total_unique': len(items),
        'per_level_new': per_level_new,
        'per_level_cumulative': per_level_cumulative,
        'per_level_dup': per_level_dup,
        'chain_anomalies': chain_anomalies,
        'intra_dup': intra_dup,
        'unicode_issues': unicode_issues,
    }

def generate_report(char_r: dict, word_r: dict) -> str:
    lines = []
    
    lines.append('# SRC字词库审计报告\n')
    lines.append('> 生成时间：' + __import__('datetime').datetime.now().strftime('%Y-%m-%d %H:%M:%S') + '\n')
    
    # === 一、统计摘要 ===
    lines.append('## 一、统计摘要\n')
    
    lines.append('### 单字统计\n')
    lines.append('| 指标 | SRC100 | SRC300 | SRC500 | SRC800 |')
    lines.append('|------|-------:|-------:|-------:|-------:|')
    lines.append(f'| 字库总字数 | {char_r["per_level_cumulative"]["SRC100"]} | {char_r["per_level_cumulative"]["SRC300"]} | {char_r["per_level_cumulative"]["SRC500"]} | {char_r["per_level_cumulative"]["SRC800"]} |')
    lines.append(f'| 本级真正新增 | {char_r["per_level_new"]["SRC100"]} | {char_r["per_level_new"]["SRC300"]} | {char_r["per_level_new"]["SRC500"]} | {char_r["per_level_new"]["SRC800"]} |')
    lines.append(f'| 本级来自低等级重复 | 0 | {char_r["per_level_dup"]["SRC300"]} | {char_r["per_level_dup"]["SRC500"]} | {char_r["per_level_dup"]["SRC800"]} |')
    pct300 = char_r["per_level_dup"]["SRC300"] / char_r["per_level_cumulative"]["SRC300"] * 100 if char_r["per_level_cumulative"]["SRC300"] else 0
    pct500 = char_r["per_level_dup"]["SRC500"] / char_r["per_level_cumulative"]["SRC500"] * 100 if char_r["per_level_cumulative"]["SRC500"] else 0
    pct800 = char_r["per_level_dup"]["SRC800"] / char_r["per_level_cumulative"]["SRC800"] * 100 if char_r["per_level_cumulative"]["SRC800"] else 0
    lines.append(f'| 重复率 | 0% | {pct300:.1f}% | {pct500:.1f}% | {pct800:.1f}% |')
    lines.append('')
    lines.append(f'**唯一单字总数**：{char_r["total_unique"]}\n')
    
    lines.append('### 单字 minimum_src_level 分布\n')
    lines.append('| 等级 | 数量 | 占唯一总数比例 |')
    lines.append('|------|-----:|--------------:|')
    for lv in LEVELS:
        c = char_r['per_level_new'][lv]
        pct = c / char_r['total_unique'] * 100 if char_r['total_unique'] else 0
        lines.append(f'| {lv} | {c} | {pct:.1f}% |')
    lines.append('')
    
    lines.append('### 词语统计\n')
    lines.append('| 指标 | SRC100 | SRC300 | SRC500 | SRC800 |')
    lines.append('|------|-------:|-------:|-------:|-------:|')
    lines.append(f'| 字库总词数 | {word_r["per_level_cumulative"]["SRC100"]} | {word_r["per_level_cumulative"]["SRC300"]} | {word_r["per_level_cumulative"]["SRC500"]} | {word_r["per_level_cumulative"]["SRC800"]} |')
    lines.append(f'| 本级真正新增 | {word_r["per_level_new"]["SRC100"]} | {word_r["per_level_new"]["SRC300"]} | {word_r["per_level_new"]["SRC500"]} | {word_r["per_level_new"]["SRC800"]} |')
    lines.append(f'| 本级来自低等级重复 | 0 | {word_r["per_level_dup"]["SRC300"]} | {word_r["per_level_dup"]["SRC500"]} | {word_r["per_level_dup"]["SRC800"]} |')
    wpct300 = word_r["per_level_dup"]["SRC300"] / word_r["per_level_cumulative"]["SRC300"] * 100 if word_r["per_level_cumulative"]["SRC300"] else 0
    wpct500 = word_r["per_level_dup"]["SRC500"] / word_r["per_level_cumulative"]["SRC500"] * 100 if word_r["per_level_cumulative"]["SRC500"] else 0
    wpct800 = word_r["per_level_dup"]["SRC800"] / word_r["per_level_cumulative"]["SRC800"] * 100 if word_r["per_level_cumulative"]["SRC800"] else 0
    lines.append(f'| 重复率 | 0% | {wpct300:.1f}% | {wpct500:.1f}% | {wpct800:.1f}% |')
    lines.append('')
    lines.append(f'**唯一词语总数**：{word_r["total_unique"]}\n')
    
    lines.append('### 词语 minimum_src_level 分布\n')
    lines.append('| 等级 | 数量 | 占唯一总数比例 |')
    lines.append('|------|-----:|--------------:|')
    for lv in LEVELS:
        c = word_r['per_level_new'][lv]
        pct = c / word_r['total_unique'] * 100 if word_r['total_unique'] else 0
        lines.append(f'| {lv} | {c} | {pct:.1f}% |')
    lines.append('')
    
    # === Report A：正常字词 ===
    lines.append('## 二、Report A：正常字词（无异常）\n')
    
    normal_chars = [it for it in char_r['items'].values() if not it['issues']]
    normal_words = [it for it in word_r['items'].values() if not it['issues']]
    lines.append(f'- 正常单字：{len(normal_chars)} 个')
    lines.append(f'- 正常词语：{len(normal_words)} 个\n')
    
    lines.append('### 正常单字清单（按minimum_src_level分组）\n')
    for lv in LEVELS:
        chars = sorted([it['content'] for it in normal_chars if it['minimum_src_level'] == lv])
        if chars:
            lines.append(f'**{lv}（{len(chars)}个）**\n')
            lines.append('、'.join(chars) + '\n')
    
    lines.append('### 正常词语清单（按minimum_src_level分组）\n')
    for lv in LEVELS:
        words = sorted([it['content'] for it in normal_words if it['minimum_src_level'] == lv])
        if words:
            lines.append(f'**{lv}（{len(words)}个）**\n')
            lines.append('、'.join(words) + '\n')
    
    # === Report B：跨等级重复 ===
    lines.append('## 三、Report B：跨等级重复（累积结构验证）\n')
    
    dup_chars = [it for it in char_r['items'].values() if it['occurrence_count'] > 1 and not it['issues']]
    dup_words = [it for it in word_r['items'].values() if it['occurrence_count'] > 1 and not it['issues']]
    
    lines.append(f'- 跨等级重复单字（无累积断裂）：{len(dup_chars)} 个')
    lines.append(f'- 跨等级重复词语（无累积断裂）：{len(dup_words)} 个\n')
    
    lines.append('### 单字跨等级出现分布\n')
    lines.append('| 出现等级数 | 单字数量 | 示例 |')
    lines.append('|----------:|--------:|------|')
    all_dup_chars = [it for it in char_r['items'].values() if it['occurrence_count'] > 1]
    for n in range(2, 5):
        chars_n = [it for it in all_dup_chars if it['occurrence_count'] == n]
        sample = '、'.join([it['content'] for it in chars_n[:5]]) or '-'
        lines.append(f'| {n} 级 | {len(chars_n)} | {sample} |')
    lines.append('')
    
    lines.append('### 词语跨等级出现分布\n')
    lines.append('| 出现等级数 | 词语数量 | 示例 |')
    lines.append('|----------:|--------:|------|')
    all_dup_words = [it for it in word_r['items'].values() if it['occurrence_count'] > 1]
    for n in range(2, 5):
        words_n = [it for it in all_dup_words if it['occurrence_count'] == n]
        sample = '、'.join([it['content'] for it in words_n[:5]]) or '-'
        lines.append(f'| {n} 级 | {len(words_n)} | {sample} |')
    lines.append('')
    
    all4_chars = [it['content'] for it in char_r['items'].values() if it['occurrence_count'] == 4]
    all4_words = [it['content'] for it in word_r['items'].values() if it['occurrence_count'] == 4]
    lines.append(f'### 出现在全部4个等级的单字（{len(all4_chars)}个）\n')
    lines.append('、'.join(sorted(all4_chars)) + '\n')
    lines.append(f'### 出现在全部4个等级的词语（{len(all4_words)}个）\n')
    lines.append('、'.join(sorted(all4_words)) + '\n')
    
    # === Report C：异常 ===
    lines.append('## 四、Report C：需要人工确认的异常\n')
    
    lines.append('### C1. 累积链异常（低等级存在、高等级缺失）\n')
    lines.append(f'- 单字累积链异常：{len(char_r["chain_anomalies"])} 条')
    lines.append(f'- 词语累积链异常：{len(word_r["chain_anomalies"])} 条\n')
    
    if char_r['chain_anomalies']:
        lines.append('#### 单字累积链异常明细\n')
        lines.append('| 单字 | 最低存在等级 | 缺失等级 |')
        lines.append('|------|------------|----------|')
        for a in char_r['chain_anomalies'][:80]:
            lines.append(f'| {a["content"]} | {a["from_level"]} | {a["missing_level"]} |')
        if len(char_r['chain_anomalies']) > 80:
            lines.append(f'| ... 共 {len(char_r["chain_anomalies"])} 条 | | |')
        lines.append('')
    
    if word_r['chain_anomalies']:
        lines.append('#### 词语累积链异常明细\n')
        lines.append('| 词语 | 最低存在等级 | 缺失等级 |')
        lines.append('|------|------------|----------|')
        for a in word_r['chain_anomalies'][:80]:
            lines.append(f'| {a["content"]} | {a["from_level"]} | {a["missing_level"]} |')
        if len(word_r['chain_anomalies']) > 80:
            lines.append(f'| ... 共 {len(word_r["chain_anomalies"])} 条 | | |')
        lines.append('')
    
    # 按断裂位置分类
    lines.append('#### 累积链异常按断裂点统计（单字）\n')
    break_points_c = {}
    for a in char_r['chain_anomalies']:
        key = f'{a["from_level"]}→{a["missing_level"]}'
        break_points_c[key] = break_points_c.get(key, 0) + 1
    for k, v in sorted(break_points_c.items()):
        lines.append(f'- {k} 断裂：{v} 字')
    lines.append('')
    
    lines.append('#### 累积链异常按断裂点统计（词语）\n')
    break_points_w = {}
    for a in word_r['chain_anomalies']:
        key = f'{a["from_level"]}→{a["missing_level"]}'
        break_points_w[key] = break_points_w.get(key, 0) + 1
    for k, v in sorted(break_points_w.items()):
        lines.append(f'- {k} 断裂：{v} 词')
    lines.append('')
    
    # C2 同级重复
    lines.append('### C2. 同级内重复记录\n')
    lines.append(f'- 单字同级重复：{len(char_r["intra_dup"])} 条')
    lines.append(f'- 词语同级重复：{len(word_r["intra_dup"])} 条\n')
    if char_r['intra_dup']:
        lines.append('| 等级 | 单字 | 重复次数 |')
        lines.append('|------|------|--------:|')
        for d in char_r['intra_dup']:
            lines.append(f'| {d["level"]} | {d["content"]} | {d["count"]} |')
        lines.append('')
    if word_r['intra_dup']:
        lines.append('| 等级 | 词语 | 重复次数 |')
        lines.append('|------|------|--------:|')
        for d in word_r['intra_dup']:
            lines.append(f'| {d["level"]} | {d["content"]} | {d["count"]} |')
        lines.append('')
    
    # C3 Unicode
    lines.append('### C3. Unicode/格式异常\n')
    lines.append(f'- 单字Unicode异常：{len(char_r["unicode_issues"])} 条')
    lines.append(f'- 词语Unicode异常：{len(word_r["unicode_issues"])} 条\n')
    
    # 汇总
    total_char_issues = len(char_r['chain_anomalies']) + len(char_r['intra_dup']) + len(char_r['unicode_issues'])
    total_word_issues = len(word_r['chain_anomalies']) + len(word_r['intra_dup']) + len(word_r['unicode_issues'])
    lines.append('### 异常汇总\n')
    lines.append('| 类别 | 单字 | 词语 |')
    lines.append('|------|-----:|-----:|')
    lines.append(f'| 累积链断裂 | {len(char_r["chain_anomalies"])} | {len(word_r["chain_anomalies"])} |')
    lines.append(f'| 同级重复 | {len(char_r["intra_dup"])} | {len(word_r["intra_dup"])} |')
    lines.append(f'| Unicode异常 | {len(char_r["unicode_issues"])} | {len(word_r["unicode_issues"])} |')
    lines.append(f'| **合计需人工确认** | **{total_char_issues}** | **{total_word_issues}** |')
    lines.append('')
    
    # === 五、23个问题 ===
    lines.append('## 五、23个问题回答\n')
    lines.append(f'1. **SRC100到底有多少个唯一单字？** {char_r["per_level_new"]["SRC100"]} 个（全部都是本级新增）')
    lines.append(f'2. **SRC300新增了多少个真正的新单字？** {char_r["per_level_new"]["SRC300"]} 个')
    lines.append(f'3. **SRC500新增了多少？** {char_r["per_level_new"]["SRC500"]} 个')
    lines.append(f'4. **SRC800新增了多少？** {char_r["per_level_new"]["SRC800"]} 个')
    lines.append(f'5. **SRC1200新增了多少？** 字库中暂无SRC1200等级')
    lines.append(f'6. **每一级有多少重复字？** SRC300: {char_r["per_level_dup"]["SRC300"]}个({pct300:.1f}%) / SRC500: {char_r["per_level_dup"]["SRC500"]}个({pct500:.1f}%) / SRC800: {char_r["per_level_dup"]["SRC800"]}个({pct800:.1f}%)')
    lines.append(f'7. **每一级有多少重复词？** SRC300: {word_r["per_level_dup"]["SRC300"]}个 / SRC500: {word_r["per_level_dup"]["SRC500"]}个 / SRC800: {word_r["per_level_dup"]["SRC800"]}个')
    lines.append(f'8. **是否存在低等级存在、高等级缺失？** 存在，单字 {len(char_r["chain_anomalies"])} 条，词语 {len(word_r["chain_anomalies"])} 条')
    lines.append(f'9. **是否存在同字不同拼音？** 当前字库为纯string数组（只有字符本身），无拼音字段，暂无法检测。数据库化并添加拼音字段后可检测。')
    lines.append(f'10. **是否存在同词不同释义？** 同上，无释义字段，暂无法检测。')
    lines.append(f'11. **是否存在重复记录？** 同级内单字重复 {len(char_r["intra_dup"])} 条，词语 {len(word_r["intra_dup"])} 条')
    lines.append(f'12. **每个字最终minimum_src_level是什么？** 见 Report A + B 完整清单')
    lines.append(f'13. **每个词最终minimum_src_level是什么？** 见 Report A + B 完整清单')
    lines.append(f'14. **有多少数据需要人工确认？** 单字 {total_char_issues} 条，词语 {total_word_issues} 条（主要为累积链断裂）')
    lines.append('')
    
    # === 六、核心原则 ===
    lines.append('## 六、核心原则（存档）\n')
    lines.append('> **SRC字词库采用累积式体系。原始SRC等级可以保留多个，但每个单字和词语必须有唯一的minimum_src_level，代表其首次进入SRC体系的最低等级。**\n')
    lines.append('> **直接测试使用minimum_src_level进行题目分层，而不是使用字词所在的最高SRC等级或当前数据表等级。**\n')
    lines.append('> **单字与词语必须分别计算minimum_src_level。词语等级不能由组成汉字的等级简单推导。**\n')
    lines.append('> **本次审计第一阶段只读取和分析数据，不自动修改原始SRC字词库。所有结构性异常先输出报告，人工确认后再修复。**\n')
    
    return '\n'.join(lines)

def main():
    print('开始SRC字词库审计...\n')
    
    content = QUESTIONS_FILE.read_text(encoding='utf-8')
    
    char_libs = {}
    word_libs = {}
    for lv in LEVELS:
        char_libs[lv] = extract_array(content, f'{lv}_CHARS')
        word_libs[lv] = extract_array(content, f'{lv}_WORDS')
        print(f'{lv}: {len(char_libs[lv])} 字 / {len(word_libs[lv])} 词')
    
    print()
    char_result = audit_library(char_libs)
    word_result = audit_library(word_libs)
    
    print(f'唯一单字总数: {char_result["total_unique"]}')
    print(f'唯一词语总数: {word_result["total_unique"]}')
    print(f'单字累积链异常: {len(char_result["chain_anomalies"])}')
    print(f'词语累积链异常: {len(word_result["chain_anomalies"])}')
    print(f'单字同级重复: {len(char_result["intra_dup"])}')
    print(f'词语同级重复: {len(word_result["intra_dup"])}\n')
    
    # 生成报告
    report = generate_report(char_result, word_result)
    out_path = Path('/workspace/projects/SRC_AUDIT_REPORT.md')
    out_path.write_text(report, encoding='utf-8')
    print(f'✅ 审计报告已生成: {out_path}')
    
    # JSON数据
    json_data = {
        'audit_date': __import__('datetime').datetime.now().isoformat(),
        'characters': {
            'total_unique': char_result['total_unique'],
            'per_level_new': char_result['per_level_new'],
            'per_level_cumulative': char_result['per_level_cumulative'],
            'per_level_duplicate': char_result['per_level_dup'],
            'chain_anomalies_count': len(char_result['chain_anomalies']),
            'intra_dup_count': len(char_result['intra_dup']),
            'items': {k: v for k, v in char_result['items'].items()},
        },
        'words': {
            'total_unique': word_result['total_unique'],
            'per_level_new': word_result['per_level_new'],
            'per_level_cumulative': word_result['per_level_cumulative'],
            'per_level_duplicate': word_result['per_level_dup'],
            'chain_anomalies_count': len(word_result['chain_anomalies']),
            'intra_dup_count': len(word_result['intra_dup']),
            'items': {k: v for k, v in word_result['items'].items()},
        },
    }
    json_path = Path('/workspace/projects/SRC_AUDIT_DATA.json')
    json_path.write_text(json.dumps(json_data, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'✅ 审计JSON数据已生成: {json_path}')
    
    # 打印新增表
    print('\n=== 单字：累积 vs 真正新增 ===')
    print(f'{"等级":<8} {"累积字数":>10} {"本级新增":>10}')
    for lv in LEVELS:
        print(f'{lv:<8} {char_result["per_level_cumulative"][lv]:>10} {char_result["per_level_new"][lv]:>10}')
    
    print('\n=== 词语：累积 vs 真正新增 ===')
    print(f'{"等级":<8} {"累积词数":>10} {"本级新增":>10}')
    for lv in LEVELS:
        print(f'{lv:<8} {word_result["per_level_cumulative"][lv]:>10} {word_result["per_level_new"][lv]:>10}')

if __name__ == '__main__':
    main()
