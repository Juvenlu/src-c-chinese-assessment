import json
import re

with open('v1.1_question_bank_final.json', 'r', encoding='utf-8') as f:
    all_q = json.load(f)

def escape_ts(s):
    """转义单引号和反斜杠，用于TypeScript字符串"""
    s = s.replace('\\', '\\\\')
    s = s.replace("'", "\\'")
    return s

lines = []
lines.append('import { Level, QuestionItem } from "@/lib/types";')
lines.append('')
lines.append('// SRC-C v1.1 题库 - 基于西游记前20集 + 哈利波特1前14集')
lines.append('// 四个等级: SRC100(入门) / SRC300 / SRC500 / SRC800')
lines.append('// 每道题包含：字形识别(character)、词汇识别(word+meaning)、句子识别(sentence)、理解测试(story)')
lines.append('')

for level in ['SRC100', 'SRC300', 'SRC500', 'SRC800']:
    questions = all_q[level]
    var_name = f'questions{level}'
    lines.append(f'const {var_name}: Omit<QuestionItem, "id" | "created_at" | "updated_at">[] = [')
    
    for q in questions:
        lines.append('  {')
        lines.append(f"    level: '{q['level']}',")
        lines.append(f"    character: '{q['character']}',")
        lines.append(f"    word: '{q['word']}',")
        lines.append(f"    sentence: '{escape_ts(q['sentence'])}',")
        lines.append(f"    meaning_question: '{escape_ts(q['meaning_question'])}',")
        opts = ', '.join([f"'{escape_ts(o)}'" for o in q['options']])
        lines.append(f"    options: [{opts}],")
        lines.append(f"    answer: '{escape_ts(q['answer'])}',")
        lines.append(f"    story_text: '{escape_ts(q['story_text'])}',")
        lines.append(f"    story_question: '{escape_ts(q['story_question'])}',")
        story_opts = ', '.join([f"'{escape_ts(o)}'" for o in q['story_options']])
        lines.append(f"    story_options: [{story_opts}],")
        lines.append(f"    story_answer: '{escape_ts(q['story_answer'])}',")
        lines.append('  },')
    
    lines.append('];')
    lines.append('')

lines.append('export function getAllQuestions(): Omit<QuestionItem, "id" | "created_at" | "updated_at">[] {')
lines.append('  return [...questionsSRC100, ...questionsSRC300, ...questionsSRC500, ...questionsSRC800];')
lines.append('}')
lines.append('')

lines.append('export function getQuestionsByLevel(level: Level): Omit<QuestionItem, "id" | "created_at" | "updated_at">[] {')
lines.append('  switch (level) {')
lines.append("    case 'SRC100':")
lines.append('      return questionsSRC100;')
lines.append("    case 'SRC300':")
lines.append('      return [...questionsSRC100, ...questionsSRC300];')
lines.append("    case 'SRC500':")
lines.append('      return [...questionsSRC100, ...questionsSRC300, ...questionsSRC500];')
lines.append("    case 'SRC800':")
lines.append('      return [...questionsSRC100, ...questionsSRC300, ...questionsSRC500, ...questionsSRC800];')
lines.append('    default:')
lines.append('      return [];')
lines.append('  }')
lines.append('}')
lines.append('')

lines.append('''
export function getCharList(level: Level): string[] {
  const questions = getQuestionsByLevel(level);
  return questions.map(q => q.character);
}

export function getWordList(level: Level): string[] {
  const questions = getQuestionsByLevel(level);
  return questions.map(q => q.word).filter(w => w.length > 1);
}
''')

content = '\n'.join(lines)
with open('src/lib/questions.ts', 'w', encoding='utf-8') as f:
    f.write(content)

print(f'已更新 src/lib/questions.ts')
print(f'总行数: {len(lines)}')
total = 0
for level in ['SRC100', 'SRC300', 'SRC500', 'SRC800']:
    cnt = len(all_q[level])
    total += cnt
    print(f'  {level}: {cnt} 题')
print(f'总计: {total} 题')
