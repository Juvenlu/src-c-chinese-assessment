'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Level, LEVEL_CONFIG, RJBLevel } from '@/lib/types';
import type { GrowthMapData } from '@/lib/types';
import { getNextLevel, numToLevel, isValidLevel } from '@/lib/level-service';
import { calculateDualSystemResult } from '@/lib/dual-system';
import { getCharList, getWordList, getRJBCharList, getCorrespondingRJBLevel } from '@/lib/questions';
import { useAuth } from '@/lib/auth-context';

export default function GrowthMapPage() {
  const [data, setData] = useState<GrowthMapData | null>(null);
  const [loading, setLoading] = useState(true);

  const { user, activeChild, latestResult, authFetch, loading: authLoading } = useAuth();

  useEffect(() => {
    if (authLoading) return;
    const params = new URLSearchParams(window.location.search);
    const childId = params.get('child_id') || activeChild?.id || 'demo_child';
    const urlLevel = params.get('level') as Level | null;
    const testedChars = parseInt(params.get('testedChars') || '0');
    const correctChars = parseInt(params.get('correctChars') || '0');
    const testedVocab = parseInt(params.get('testedVocab') || '0');
    const correctVocab = parseInt(params.get('correctVocab') || '0');

    // 确定当前级别：URL 参数 > 最新快速测评结果（通过 level-service 统一转换）> 默认 SRC100
    let level: Level = urlLevel || 'SRC100';
    if (!urlLevel && latestResult?.reading_base) {
      level = numToLevel(latestResult.reading_base);
    }
    // 如果URL带了测试数据，直接计算显示（从结果页跳转过来）
    if (testedChars > 0 && correctChars > 0) {
      const config = LEVEL_CONFIG[level];
      const totalChars = config.charCount;
      const charMasteryRate = correctChars / testedChars;
      const estimatedMastered = Math.round(totalChars * charMasteryRate);
      const isFullTest = testedChars >= totalChars;

      // 人教版映射
      const srcChars = getCharList(level);
      const rjbLevel = getCorrespondingRJBLevel(level);
      const rjbChars = getRJBCharList(rjbLevel);
      const srcCharSet = new Set(srcChars);
      // 计算SRC字库中包含了多少人教版字（全集交集，作为字库规模对照参考）
      const pepInSrc = rjbChars.filter(c => srcCharSet.has(c));
      const pepTotal = rjbChars.length;
      const pepFullOverlap = pepInSrc.length;
      // 本次测试覆盖的教材字：按抽样比例估算（与 result 页口径一致）
      const sampleRatio = testedChars / srcChars.length;
      const pepCovered = Math.min(pepTotal, Math.round(pepFullOverlap * sampleRatio));
      // 按整体掌握率估算人教版掌握数（统一规则：最后只 round 一次）
      const pepMasteryRate = charMasteryRate;
      const pepEstimated = Math.round(pepTotal * pepMasteryRate);

      const vocabMasteryRate = testedVocab > 0 ? correctVocab / testedVocab : 0;
      const vocabEstimated = Math.round(config.vocabCount * vocabMasteryRate);

      const nextLv = getNextLevel(level);
      const nextLevelVal = nextLv ? (nextLv as Level) : undefined;

      setData({
        childId,
        // 核心架构字段：URL模式是正式测试结果跳转 → confirmed
        confirmed_level: level,
        estimated_level: null,
        recommended_test_level: level,
        current_level: level,
        next_level: nextLevelVal ?? null,
        assessment_status: 'confirmed',
        // 兼容旧字段
        currentLevel: level,
        assessmentType: 'formal',
        srcMastery: {
          level,
          mastered: estimatedMastered,
          learning: 0,
          untested: totalChars - estimatedMastered,
          masteryRate: charMasteryRate,
          total: totalChars,
          isFullTest,
        },
        pepMastery: {
          level: rjbLevel,
          mastered: pepEstimated,
          total: pepTotal,
          masteryRate: pepMasteryRate,
          covered: pepCovered,
          full_overlap: pepFullOverlap,
          coverageRate: pepCovered / pepTotal,
        },
        vocabMastery: {
          mastered: vocabEstimated,
          tested: testedVocab,
          correct: correctVocab,
          masteryRate: vocabMasteryRate,
          isFullTest,
        },
        nextLevel: nextLevelVal,
        trend: {
          charMastery: [
            { date: '本次', rate: charMasteryRate },
          ],
          vocabMastery: [
            { date: '本次', rate: vocabMasteryRate },
          ],
        },
        strengths: charMasteryRate >= 0.85
          ? ['单字掌握扎实，基础框架已建立', '识字量增长稳定']
          : charMasteryRate >= 0.7
            ? ['单字识别有一定基础', '对常用字的辨识能力良好']
            : ['已经开始建立中文识字基础'],
        areasToImprove: charMasteryRate < 0.8
          ? ['继续扩大识字量，建议多接触中文读物', '建议通过阅读在真实语境中加深印象']
          : vocabMasteryRate < 0.7
            ? ['词组应用需要加强，建议多阅读积累词语']
            : ['继续挑战更多字词，扩大阅读范围'],
        recommendations: [
          '每日15分钟中文绘本阅读',
          '每周1次测字，跟踪成长进度',
        ],
      });
      setLoading(false);
      return;
    }

    // 否则调用API获取历史数据（带鉴权）
    if (user && activeChild) {
      authFetch(`/api/growth-map?child_id=${activeChild.id}&level=${level}`)
        .then((res) => res.json())
        .then((json) => {
          if (json.success) {
          setData(json.data);
        }
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [user, activeChild, latestResult, authLoading, authFetch]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--color-src-bg)] flex items-center justify-center">
        <div className="text-xl text-[var(--color-src-primary)] animate-pulse">
          正在生成成长地图...
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-[var(--color-src-bg)] flex items-center justify-center">
        <div className="text-center">
          <p className="text-[var(--color-src-text-light)] mb-4">
            暂无数据
          </p>
          <Link
            href="/"
            className="text-[var(--color-src-primary)] underline"
          >
            返回首页
          </Link>
        </div>
      </div>
    );
  }

  const nextLevel = data.nextLevel;
  const isEstimated = data.assessment_status === 'estimated';
  const isConfirmed = data.assessment_status === 'confirmed';

  return (
    <div className="min-h-screen bg-[var(--color-src-bg)] py-8 px-4">
      <div className="max-w-3xl mx-auto">
        {/* 返回 Hub 入口 */}
        {user && (
          <div className="mb-6">
            <Link
              href="/hub"
              className="inline-flex items-center gap-2 text-sm text-[var(--color-src-text-light)] hover:text-[var(--color-src-primary)] transition-colors"
            >
              ← 返回我的中文世界
            </Link>
          </div>
        )}
        {/* 标题 */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-display text-[var(--color-src-text)] mb-2">
            🌱 我的中文成长地图
          </h1>
          <p className="text-[var(--color-src-text-light)]">
            {isConfirmed
              ? `当前等级：${data.current_level}`
              : isEstimated
                ? `估算等级：${data.estimated_level}（建议完成正式测试确认）`
                : '尚未开始正式测试'}
          </p>
          {isEstimated && (
            <p className="text-xs text-[var(--color-src-text-light)] mt-1">
              📊 基于 Quick Assessment 快速估算，正式等级以正式 SRC 测试结果为准
            </p>
          )}
        </div>

        {/* 第一阶段：教材基础识字 */}
        <div className="bg-white rounded-3xl p-6 shadow-lg mb-4 border-l-4 border-blue-400">
          <div className="flex items-start gap-4">
            <div className="text-4xl">📘</div>
            <div className="flex-1">
              <h2 className="text-xl font-display text-[var(--color-src-text)] mb-2">
                第一阶段：教材基础识字
              </h2>
              {isEstimated ? (
                <div className="py-4">
                  <div className="text-2xl font-display text-[var(--color-src-primary)] mb-2">
                    {data.current_level}
                    <span className="text-sm bg-[var(--color-src-accent)]/30 text-[var(--color-src-text)] px-2 py-0.5 rounded-full ml-2 font-sans">
                      估算
                    </span>
                  </div>
                  <p className="text-sm text-[var(--color-src-text-light)]">
                    快速估算达到 {data.current_level} 水平
                  </p>
                </div>
              ) : (
                <>
                  <div className="text-3xl font-display text-[var(--color-src-primary)] mb-2">
                    {data.pepMastery.mastered}
                    <span className="text-lg text-[var(--color-src-text-light)]">
                      {' '}
                      / {data.pepMastery.total}
                    </span>
                  </div>
                  <p className="text-sm text-[var(--color-src-text-light)] mb-3">
                    已掌握{data.pepMastery.level}中的{data.pepMastery.mastered}字
                  </p>
                  <div className="w-full bg-gray-100 rounded-full h-3">
                    <div
                      className="bg-blue-400 h-3 rounded-full transition-all duration-1000"
                      style={{
                        width: `${Math.min(100, (data.pepMastery.mastered / data.pepMastery.total) * 100)}%`,
                      }}
                    />
                  </div>
                  <p className="text-xs text-gray-400 mt-2">
                    本次测试覆盖 {data.pepMastery.covered} 个教材汉字（覆盖率{' '}
                    {Math.round(data.pepMastery.coverageRate * 100)}%）
                  </p>
                  {data.pepMastery.full_overlap !== undefined && (
                    <p className="text-xs text-gray-300">
                      {data.srcMastery.level} 字库包含 {data.pepMastery.full_overlap} 个
                      {data.pepMastery.level}教材基础汉字
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* 连线箭头 */}
        <div className="flex justify-center my-2">
          <div className="text-gray-300 text-2xl">↓</div>
        </div>

        {/* 第二阶段：阅读常用字 */}
        <div className="bg-white rounded-3xl p-6 shadow-lg mb-4 border-l-4 border-orange-400">
          <div className="flex items-start gap-4">
            <div className="text-4xl">📚</div>
            <div className="flex-1">
              <h2 className="text-xl font-display text-[var(--color-src-text)] mb-2">
                第二阶段：阅读常用字
              </h2>
              {isEstimated ? (
                <div className="py-4">
                  <div className="text-3xl font-display text-[var(--color-src-primary)] mb-2">
                    约 {data.current_level}
                    <span className="text-sm bg-[var(--color-src-accent)]/30 text-[var(--color-src-text)] px-2 py-0.5 rounded-full ml-2 font-sans">
                      估算
                    </span>
                  </div>
                  <p className="text-sm text-[var(--color-src-text-light)]">
                    估算阅读常用字达到 {data.srcMastery.level} 水平
                  </p>
                  <p className="text-xs text-gray-400 mt-2">
                    完成正式闯关测试可获得精确掌握数据
                  </p>
                </div>
              ) : (
                <>
                  <div className="text-3xl font-display text-[var(--color-src-primary)] mb-2">
                    {data.srcMastery.isFullTest ? '' : '约'}
                    {data.srcMastery.mastered}
                    <span className="text-lg text-[var(--color-src-text-light)]">
                      {' '}
                      / {data.srcMastery.total}
                    </span>
                  </div>
                  <p className="text-sm text-[var(--color-src-text-light)] mb-3">
                    已掌握{data.srcMastery.level}中的{data.srcMastery.mastered}字
                  </p>
                  <div className="w-full bg-gray-100 rounded-full h-3">
                    <div
                      className="bg-[var(--color-src-primary)] h-3 rounded-full transition-all duration-1000"
                      style={{
                        width: `${Math.min(100, data.srcMastery.masteryRate * 100)}%`,
                      }}
                    />
                  </div>
                  <p className="text-xs text-gray-400 mt-2">
                    {data.srcMastery.isFullTest
                      ? '全量测试'
                      : `抽测估算，掌握度 ${Math.round(data.srcMastery.masteryRate * 100)}%`}
                  </p>
                </>
              )}
            </div>
          </div>
        </div>

        {/* 连线箭头 */}
        <div className="flex justify-center my-2">
          <div className="text-gray-300 text-2xl">↓</div>
        </div>

        {/* 第三阶段：词组掌握 */}
        <div className="bg-white rounded-3xl p-6 shadow-lg mb-6 border-l-4 border-green-400">
          <div className="flex items-start gap-4">
            <div className="text-4xl">🔤</div>
            <div className="flex-1">
              <h2 className="text-xl font-display text-[var(--color-src-text)] mb-2">
                第三阶段：词语应用
              </h2>
              {isEstimated ? (
                <div className="py-4">
                  <div className="text-2xl font-display text-[var(--color-src-secondary)] mb-2">
                    估算词汇量：约 {Math.round(data.srcMastery.total * 2.86)} 个
                    <span className="text-sm bg-[var(--color-src-accent)]/30 text-[var(--color-src-text)] px-2 py-0.5 rounded-full ml-2 font-sans">
                      估算
                    </span>
                  </div>
                  <p className="text-sm text-[var(--color-src-text-light)]">
                    完成正式闯关测试可获得精确词语掌握数据
                  </p>
                </div>
              ) : (
                <>
                  <div className="text-3xl font-display text-[var(--color-src-secondary)] mb-2">
                    {Math.round(data.vocabMastery.masteryRate * 100)}%
                  </div>
                  <p className="text-sm text-[var(--color-src-text-light)] mb-3">
                    常用词组掌握情况
                  </p>
                  <div className="w-full bg-gray-100 rounded-full h-3">
                    <div
                      className="bg-[var(--color-src-secondary)] h-3 rounded-full transition-all duration-1000"
                      style={{
                        width: `${Math.min(100, data.vocabMastery.masteryRate * 100)}%`,
                      }}
                    />
                  </div>
                  <p className="text-xs text-gray-400 mt-2">
                    本次测试 {data.vocabMastery.tested} 个词组，答对{' '}
                    {data.vocabMastery.correct} 个
                    {data.vocabMastery.isFullTest ? '' : `（掌握率 ${Math.round(data.vocabMastery.masteryRate * 100)}%）`}
                  </p>
                </>
              )}
            </div>
          </div>
        </div>

        {/* 下一步 */}
        <div className="bg-gradient-to-r from-[var(--color-src-primary)] to-[var(--color-src-accent)] rounded-3xl p-6 shadow-lg text-white text-center mb-6">
          <h2 className="text-2xl font-display mb-2">🚀 下一步</h2>
          {nextLevel && isConfirmed ? (
            <>
              <p className="text-lg mb-4">下一阶段：{nextLevel}</p>
              <p className="text-sm opacity-90 mb-4">
                继续扩大阅读常用字，并通过词组和闯关进一步提升中文理解能力。
              </p>
              <Link
                href={`/profile?mode=full&level=${nextLevel}`}
                className="inline-block bg-white text-[var(--color-src-primary)] px-8 py-3 rounded-full font-bold hover:scale-105 transition-transform"
              >
                进入下一阶段 →
              </Link>
            </>
          ) : !nextLevel && isConfirmed ? (
            <>
              <p className="text-lg mb-4">🎉 恭喜你完成最高等级！</p>
              <p className="text-sm opacity-90">
                继续通过阅读和闯关保持你的中文能力。
              </p>
            </>
          ) : nextLevel && isEstimated ? (
            <>
              <p className="text-lg mb-4">估算等级：{data.current_level}</p>
              <p className="text-sm opacity-90 mb-4">
                建议完成正式 {data.recommended_test_level} 字词测试，
                以获得更准确的中文能力评估。
              </p>
              <Link
                href={`/fulltest?level=${data.recommended_test_level}`}
                className="inline-block bg-white text-[var(--color-src-primary)] px-8 py-3 rounded-full font-bold hover:scale-105 transition-transform"
              >
                开始正式测试 →
              </Link>
            </>
          ) : (
            <>
              <p className="text-lg mb-4">估算已达最高等级</p>
              <p className="text-sm opacity-90 mb-4">
                建议完成正式 SRC800 测试确认
              </p>
              <Link
                href={`/fulltest?level=SRC800`}
                className="inline-block bg-white text-[var(--color-src-primary)] px-8 py-3 rounded-full font-bold hover:scale-105 transition-transform"
              >
                开始正式测试 →
              </Link>
            </>
          )}
        </div>

        {/* 成长趋势 */}
        <div className="bg-white rounded-3xl p-6 shadow-lg mb-6">
          <h2 className="text-xl font-display text-[var(--color-src-text)] mb-4">
            📈 成长趋势
          </h2>
          {isEstimated ? (
            <p className="text-sm text-[var(--color-src-text-light)]">
              完成正式测试后可查看精确的成长趋势数据。
            </p>
          ) : (
            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-[var(--color-src-text-light)]">
                    阅读识字
                  </span>
                  <span className="text-[var(--color-src-primary)] font-bold">
                    {Math.round(data.trend.charMastery[data.trend.charMastery.length - 1]?.rate * 100 || 0)}%
                  </span>
                </div>
                <div className="flex gap-1 h-8">
                  {data.trend.charMastery.map((point, i) => (
                    <div
                      key={i}
                      className="flex-1 bg-[var(--color-src-primary)]/20 rounded-t relative"
                    >
                      <div
                        className="absolute bottom-0 left-0 right-0 bg-[var(--color-src-primary)] rounded-t"
                        style={{ height: `${point.rate * 100}%` }}
                      />
                    </div>
                  ))}
                </div>
                <div className="flex justify-between text-xs text-gray-400 mt-1">
                  {data.trend.charMastery.map((p, i) => (
                    <span key={i}>{p.date}</span>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 优势与弱项 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div className="bg-white rounded-2xl p-5 shadow-md">
            <h3 className="text-lg font-display text-green-500 mb-3">
              ⭐ 优势
            </h3>
            <ul className="space-y-2">
              {data.strengths.map((s, i) => (
                <li
                  key={i}
                  className="text-sm text-[var(--color-src-text)] flex items-start gap-2"
                >
                  <span className="text-green-400">✓</span>
                  {s}
                </li>
              ))}
            </ul>
          </div>
          <div className="bg-white rounded-2xl p-5 shadow-md">
            <h3 className="text-lg font-display text-[var(--color-src-primary)] mb-3">
              💪 继续努力
            </h3>
            <ul className="space-y-2">
              {data.areasToImprove.map((s, i) => (
                <li
                  key={i}
                  className="text-sm text-[var(--color-src-text)] flex items-start gap-2"
                >
                  <span className="text-[var(--color-src-primary)]">○</span>
                  {s}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* 建议 */}
        <div className="bg-white rounded-2xl p-5 shadow-md mb-6">
          <h3 className="text-lg font-display text-[var(--color-src-text)] mb-3">
            💡 学习建议
          </h3>
          <ul className="space-y-2">
            {data.recommendations.map((r, i) => (
              <li
                key={i}
                className="text-sm text-[var(--color-src-text)] flex items-center gap-3"
              >
                <span className="w-6 h-6 bg-[var(--color-src-accent)] rounded-full flex items-center justify-center text-xs font-bold text-white">
                  {i + 1}
                </span>
                {r}
              </li>
            ))}
          </ul>
        </div>

        {/* 未来模块预留 */}
        <div className="bg-white/50 rounded-3xl p-6 mb-6">
          <h3 className="text-lg font-display text-[var(--color-src-text-light)] mb-4 text-center">
            🔜 即将开放
          </h3>
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-white/80 rounded-2xl p-4 text-center border-2 border-dashed border-gray-200">
              <div className="text-3xl mb-2">🎮</div>
              <div className="text-sm text-[var(--color-src-text-light)]">
                中文闯关
              </div>
            </div>
            <div className="bg-white/80 rounded-2xl p-4 text-center border-2 border-dashed border-gray-200">
              <div className="text-3xl mb-2">📚</div>
              <div className="text-sm text-[var(--color-src-text-light)]">
                定制绘本
              </div>
            </div>
            <div className="bg-white/80 rounded-2xl p-4 text-center border-2 border-dashed border-gray-200">
              <div className="text-3xl mb-2">✍</div>
              <div className="text-sm text-[var(--color-src-text-light)]">
                中文输出
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
