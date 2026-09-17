/**
 * Growth Map — 成长地图计算（Worker 版本）
 *
 * 从 Vercel src/app/api/growth-map/route.ts 移植到 Worker。
 * 纯计算逻辑 + D1 查询。
 *
 * 数据来源优先级（正式测试为唯一参照指标）：
 * 1. test_results（正式字词库测试）→ 完整成长地图
 * 2. quick_assessment_results（快速测评 → 建议级别 + 引导做正式测试）
 * 3. 都没有 → 起点引导
 */

import type { Env, Level, RJBLevel } from './types';
import {
	getNextLevel,
	getRecommendedTestLevel,
	getConfirmedLevel,
	getEstimatedLevel,
	getDisplayLevel,
	deriveAssessmentStatus,
	isValidLevel,
} from './level-service';
import {
	getCharList,
	getWordList,
	getRJBCharList,
	getCorrespondingRJBLevel,
} from './lexicon';

// ===== 类型定义 =====

interface GrowthMapData {
	childId: string;
	confirmed_level: Level | null;
	estimated_level: Level | null;
	recommended_test_level: Level;
	current_level: Level | null;
	next_level: Level | null;
	assessment_status: 'not_started' | 'estimated' | 'confirmed';
	// 兼容旧字段
	currentLevel: Level;
	assessmentType: 'formal' | 'quick' | 'none';
	suggestedLevel?: Level;
	// 三维度掌握度
	srcMastery: {
		level: Level;
		mastered: number;
		learning: number;
		untested: number;
		masteryRate: number;
		total: number;
		isFullTest: boolean;
	};
	pepMastery: {
		level: RJBLevel;
		mastered: number;
		total: number;
		masteryRate: number;
		covered: number;
		full_overlap: number;
		coverageRate: number;
	};
	vocabMastery: {
		mastered: number;
		tested: number;
		correct: number;
		masteryRate: number;
		isFullTest: boolean;
	};
	nextLevel?: Level | null;
	quickConfidence?: 'high' | 'medium' | 'low';
	quick_word_level_l?: number;
	quick_word_level_u?: number;
	quick_char_level?: number;
	quick_char_level_u?: number;
	trend: {
		charMastery: { date: string; rate: number }[];
		vocabMastery: { date: string; rate: number }[];
	};
	strengths: string[];
	areasToImprove: string[];
	recommendations: string[];
}

interface FormalTestResult {
	id: string;
	session_id: string;
	child_id: string;
	level: Level;
	test_type: string;
	status: string;
	character_score: number;
	vocab_score: number;
	reading_score: number;
	comprehension_score: number;
	total_score: number;
	stable_char_count: number;
	stable_vocab_count: number;
	completion_time_seconds: number;
	total_questions: number;
	correct_count: number;
	known_characters_json: string | null;
	weak_characters_json: string | null;
	part_breakdown_json: string | null;
	character_mastery_rate?: number | null;
	vocab_mastery_rate?: number | null;
	completed_at: number; // unix seconds
	created_at: number; // unix seconds
}

interface QuickAssessmentResult {
	id: string;
	session_id: string | null;
	child_id: string | null;
	guest_session_id: string | null;
	character_level_l: number | null;
	character_level_u: number | null;
	word_level_l: number | null;
	word_level_u: number | null;
	reading_base: number | null;
	confidence: string;
	recommended_level: string;
	total_questions: number;
	correct_count: number;
	raw_result_json: string | null;
	completed_at: number;
	created_at: number;
}

// ===== Handler =====

/**
 * GET /v1/growth-map?child_id=xxx
 *
 * 需要：
 * - X-SRC-Service-Key：Vercel → Worker 服务端鉴权
 * - Cookie: src_auth_session：家长登录态
 */
export async function handleGetGrowthMap(
	request: Request,
	env: Env,
	parentId: string,
): Promise<Response> {
	const url = new URL(request.url);
	const childId = url.searchParams.get('child_id');

	if (!childId) {
		return new Response(JSON.stringify({ error: '缺少child_id参数' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	// 验证 child 归属
	const childRow = await env.DB.prepare(
		`SELECT id, parent_id, nickname FROM children WHERE id = ? AND status = 'active'`
	).bind(childId).first() as { id: string; parent_id: string; nickname: string } | null;

	if (!childRow) {
		return new Response(JSON.stringify({ error: '孩子不存在' }), {
			status: 404,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	if (childRow.parent_id !== parentId) {
		return new Response(JSON.stringify({ error: '无权限访问该孩子数据' }), {
			status: 403,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	try {
		const growthMap = await calculateGrowthMap(childId, env);
		return new Response(
			JSON.stringify({ success: true, data: growthMap }),
			{ status: 200, headers: { 'Content-Type': 'application/json' } },
		);
	} catch (error) {
		console.error('[growth-map] error:', error);
		return new Response(
			JSON.stringify({ error: '生成成长地图失败' }),
			{ status: 500, headers: { 'Content-Type': 'application/json' } },
		);
	}
}

// ===== 核心计算 =====

async function calculateGrowthMap(childId: string, env: Env): Promise<GrowthMapData> {
	// ===== 1. 查询正式测试结果（test_results，仅 test_type = 'formal'）
	// 不把 sampling 趣味闯关当作正式 confirmed test
	const formalResultsResp = await env.DB.prepare(
		`SELECT * FROM test_results
		 WHERE child_id = ? AND test_type = 'formal' AND status = 'completed'
		 ORDER BY completed_at DESC
		 LIMIT 10`
	).bind(childId).all();

	const formalResults = (formalResultsResp.results || []) as unknown as FormalTestResult[];
	const latestFormal = formalResults[0];
	const hasFormalTest = !!latestFormal;

	// ===== 2. 查询快速测评结果
	const quickResultsResp = await env.DB.prepare(
		`SELECT * FROM quick_assessment_results
		 WHERE child_id = ?
		 ORDER BY completed_at DESC
		 LIMIT 10`
	).bind(childId).all();

	const quickResults = (quickResultsResp.results || []) as unknown as QuickAssessmentResult[];
	const latestQuick = quickResults[0];
	const allQuickResults = quickResults;

	// 从 raw_result_json 中提取 Quick Assessment 主估算等级（characterLevel）
	const raw = latestQuick?.raw_result_json ? safeJsonParse(latestQuick.raw_result_json) : null;
	const quickCharacterLevel = extractLevelNum(raw?.characterLevel);

	// ===== 3. 确定级别与状态（统一使用 Level Service）
	const confirmedLevel = getConfirmedLevel(latestFormal
		? { stable_char_count: latestFormal.stable_char_count, level: latestFormal.level }
		: null);

	const estimatedLevel = getEstimatedLevel({
		reading_base: latestQuick?.reading_base ?? undefined,
		character_level_u: latestQuick?.character_level_u ?? undefined,
		character_level: quickCharacterLevel,
	});

	const recommendedTestLevel = getRecommendedTestLevel({
		reading_base: latestQuick?.reading_base ?? undefined,
		character_level_u: latestQuick?.character_level_u ?? undefined,
		word_level_u: latestQuick?.word_level_u ?? undefined,
	});

	const assessmentStatus = deriveAssessmentStatus({
		hasFormalTest: !!latestFormal,
		hasQuickResult: !!latestQuick,
	});

	// current_level：正式测试优先用 confirmed_level；只有快速测评时用 estimated_level
	const currentLevel = confirmedLevel ?? estimatedLevel;
	// 展示用级别：优先 confirmed，其次 estimated，最低 SRC100
	const displayLevel = getDisplayLevel({ confirmedLevel, estimatedLevel });
	// assessment_type（兼容旧字段 assessmentType）
	const assessmentType: 'formal' | 'quick' | 'none' =
		latestFormal ? 'formal' : latestQuick ? 'quick' : 'none';

	// ===== 4. 获取字库数据（有正式测试用测试等级，否则用展示级别）
	const libraryLevel = (latestFormal?.level && isValidLevel(latestFormal.level))
		? latestFormal.level
		: displayLevel;
	const allSrcChars = getCharList(libraryLevel);
	const allWords = getWordList(libraryLevel);
	const rjbLevel = getCorrespondingRJBLevel(libraryLevel);
	const allRJBChars = getRJBCharList(rjbLevel);

	// ===== 5. 计算掌握度
	let charMasteryRate: number;
	let vocabMasteryRate: number;
	let masteredCount: number;
	let vocabMastered: number;
	let testedCount: number;
	let vocabTested: number;
	let learningCount: number;
	let untestedCount: number;

	if (latestFormal) {
		// === 正式测试：精确数据
		charMasteryRate = (latestFormal.character_score ?? 0) / 100 || 0;
		vocabMasteryRate = (latestFormal.vocab_score ?? 0) / 100 || 0;
		masteredCount = latestFormal.stable_char_count || Math.floor(allSrcChars.length * charMasteryRate);
		vocabMastered = latestFormal.stable_vocab_count || Math.floor(allWords.length * vocabMasteryRate);
		// 确保 mastered 不超过对应等级 total
		masteredCount = Math.min(masteredCount, allSrcChars.length);
		vocabMastered = Math.min(vocabMastered, allWords.length);
		testedCount = allSrcChars.length;
		vocabTested = allWords.length;
		learningCount = Math.floor(testedCount * 0.1);
		untestedCount = 0;
	} else if (latestQuick) {
		// === 快速测评：不输出精确掌握数，避免"100%正式掌握"错觉
		charMasteryRate = 0;
		vocabMasteryRate = 0;
		masteredCount = 0;
		vocabMastered = 0;
		testedCount = 0;
		vocabTested = 0;
		learningCount = 0;
		untestedCount = 0;
	} else {
		// === 无测试数据
		charMasteryRate = 0;
		vocabMasteryRate = 0;
		masteredCount = 0;
		vocabMastered = 0;
		testedCount = 0;
		vocabTested = 0;
		learningCount = 0;
		untestedCount = allSrcChars.length;
	}

	// ===== 6. 人教版交叉计算
	const rjbSet = new Set(allRJBChars);
	const overlapChars = allSrcChars.filter(c => rjbSet.has(c));
	const rjbTotal = allRJBChars.length;
	// 全集交集：SRC 字库与教材字库的公共字（字库规模对照，非本次测试覆盖）
	const pepFullOverlap = overlapChars.length;
	// 本次测试实际覆盖的教材字（按抽样比例 × 全集交集估算，正式测试同样适用，因为正式测试也是抽样）
	const totalSrcChars = allSrcChars.length;
	const testSamplingRatio = totalSrcChars > 0 ? testedCount / totalSrcChars : 0;
	const rjbCovered = hasFormalTest || testSamplingRatio > 0
		? Math.min(pepFullOverlap, Math.round(pepFullOverlap * testSamplingRatio))
		: Math.round(pepFullOverlap * 0.3); // 无测试数据时按30%粗略估算
	// 人教版掌握数：基于 SRC∩RJB 全集交集 × 单字掌握率
	const rjbMastered = Math.round(pepFullOverlap * charMasteryRate);
	const rjbMasteryRate = pepFullOverlap > 0 ? rjbMastered / pepFullOverlap : 0;

	// ===== 7. 成长趋势
	const trend = buildTrend(
		hasFormalTest ? formalResults : allQuickResults,
		hasFormalTest,
		allSrcChars.length,
		allWords.length,
	);

	// ===== 8. 下一等级（由 Level Service 统一计算，基于 confirmed_level）
	const nextLevel = currentLevel ? getNextLevel(currentLevel) ?? undefined : undefined;

	// ===== 9. 优势/弱项/建议
	const strengths = hasFormalTest
		? generateStrengths(charMasteryRate, vocabMasteryRate)
		: [];
	const areasToImprove = hasFormalTest
		? generateAreasToImprove(charMasteryRate, vocabMasteryRate)
		: [];
	const recommendations = generateRecommendations(
		recommendedTestLevel,
		hasFormalTest,
		charMasteryRate,
		vocabMasteryRate,
		(latestQuick?.confidence as 'high' | 'medium' | 'low') || 'low',
	);

	return {
		childId,
		// ===== 核心架构字段 =====
		confirmed_level: confirmedLevel,
		estimated_level: estimatedLevel,
		recommended_test_level: recommendedTestLevel,
		current_level: confirmedLevel ?? estimatedLevel ?? null,
		next_level: nextLevel ?? null,
		assessment_status: assessmentStatus,
		// ===== 兼容旧字段 =====
		currentLevel: displayLevel,
		assessmentType,
		suggestedLevel: estimatedLevel ?? undefined,
		// ===== 掌握度数据 =====
		srcMastery: {
			level: libraryLevel,
			mastered: masteredCount,
			learning: learningCount,
			untested: untestedCount,
			masteryRate: charMasteryRate,
			total: allSrcChars.length,
			isFullTest: hasFormalTest,
		},
		pepMastery: {
			level: rjbLevel,
			mastered: rjbMastered,
			total: rjbTotal,
			masteryRate: rjbMasteryRate,
			covered: rjbCovered,
			full_overlap: pepFullOverlap,
			coverageRate: rjbTotal > 0 ? rjbCovered / rjbTotal : 0,
		},
		vocabMastery: {
			mastered: vocabMastered,
			tested: vocabTested,
			correct: vocabMastered,
			masteryRate: vocabMasteryRate,
			isFullTest: hasFormalTest,
		},
		nextLevel,
		quickConfidence: (latestQuick?.confidence as 'high' | 'medium' | 'low' | undefined),
		quick_word_level_l: latestQuick?.word_level_l ?? undefined,
		quick_word_level_u: latestQuick?.word_level_u ?? undefined,
		quick_char_level: latestQuick?.character_level_l ?? undefined,
		quick_char_level_u: latestQuick?.character_level_u ?? undefined,
		trend,
		strengths,
		areasToImprove,
		recommendations,
	};
}

// ===== 工具函数 =====

function safeJsonParse(str: string | null): Record<string, unknown> | null {
	if (!str) return null;
	try {
		return JSON.parse(str) as Record<string, unknown>;
	} catch {
		return null;
	}
}

function extractLevelNum(val: unknown): number | undefined {
	if (!val) return undefined;
	if (typeof val === 'number') return val;
	const m = String(val).match(/(\d+)/);
	return m ? parseInt(m[1], 10) : undefined;
}

/**
 * 构建成长趋势数据
 * D1 中 completed_at / created_at 为 unix seconds（数字）
 */
function buildTrend(
	results: FormalTestResult[] | QuickAssessmentResult[],
	isFormal: boolean,
	totalChars: number,
	totalWords: number,
): {
	charMastery: { date: string; rate: number }[];
	vocabMastery: { date: string; rate: number }[];
} {
	if (!results || results.length === 0) {
		return {
			charMastery: [],
			vocabMastery: [],
		};
	}

	const sorted = [...results].sort((a, b) => {
		const aTime = a.completed_at || a.created_at || 0;
		const bTime = b.completed_at || b.created_at || 0;
		return aTime - bTime;
	});

	const charTrend = sorted.map(r => {
		const time = r.completed_at || r.created_at || 0;
		const date = unixToDateStr(time);
		let rate = 0;
		if (isFormal) {
			const f = r as FormalTestResult;
			rate = (f.character_score ?? 0) / 100;
		} else {
			const q = r as QuickAssessmentResult;
			if (q.character_level_u) {
				const midpoint = ((q.character_level_l || 0) + q.character_level_u) / 2;
				rate = midpoint / totalChars;
			}
		}
		return { date, rate };
	});

	const vocabTrend = sorted.map(r => {
		const time = r.completed_at || r.created_at || 0;
		const date = unixToDateStr(time);
		let rate = 0;
		if (isFormal) {
			const f = r as FormalTestResult;
			rate = (f.vocab_score ?? 0) / 100;
		} else {
			const q = r as QuickAssessmentResult;
			if (q.word_level_u) {
				const midpoint = ((q.word_level_l || 0) + q.word_level_u) / 2;
				rate = midpoint / totalWords;
			}
		}
		return { date, rate };
	});

	return {
		charMastery: charTrend,
		vocabMastery: vocabTrend,
	};
}

function unixToDateStr(unixSeconds: number): string {
	const d = new Date(unixSeconds * 1000);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function generateStrengths(charRate: number, vocabRate: number): string[] {
	const strengths: string[] = [];
	if (charRate >= 0.8) {
		strengths.push('单字掌握扎实，基础框架已建立');
	} else if (charRate >= 0.5) {
		strengths.push('单字掌握稳步提升中，基础框架已建立');
	}
	if (vocabRate >= 0.7) {
		strengths.push('词汇量增长较快，阅读接触广泛');
	} else if (vocabRate >= 0.4) {
		strengths.push('词汇识别能力持续进步中，具备基本阅读词汇量');
	}
	if (strengths.length === 0) {
		strengths.push('正在起步阶段，潜力巨大');
	}
	return strengths;
}

function generateAreasToImprove(charRate: number, vocabRate: number): string[] {
	const areas: string[] = [];
	if (vocabRate < charRate - 0.1) {
		areas.push('词组应用需要加强，建议多阅读加强词语积累');
	}
	if (charRate < 0.5) {
		areas.push('建议通过阅读在真实语境中加深对汉字的理解');
	}
	if (areas.length === 0 && charRate < 0.9) {
		areas.push('继续巩固已学字词，向更高阶迈进');
	}
	return areas;
}

function generateRecommendations(
	level: Level,
	hasFormalTest: boolean,
	charRate: number,
	vocabRate: number,
	confidence: string,
): string[] {
	// 如果只有快速测评时，重点引导做正式测试
	if (!hasFormalTest && confidence !== 'none') {
		return [
			`建议从${level}级别正式字词库测试开始，获取更精准的识字量评估`,
			'每日15分钟中文绘本阅读，在语境中巩固识字',
			'每周1次正式测字，持续跟踪成长进度',
		];
	}

	const recs: string[] = [];

	if (charRate < 0.6) {
		recs.push('每日15分钟中文绘本阅读');
		recs.push('每周1次完整测字，跟踪成长进度');
	} else if (charRate < 0.85) {
		recs.push('继续扩大阅读常用字');
		recs.push('通过词组和闯关进一步提升中文理解能力');
	} else {
		recs.push('向更高一级字词库挑战');
		recs.push('增加四字词和简单句式练习');
	}

	if (vocabRate < charRate - 0.1) {
		recs.splice(1, 0, '词语识别是当前阅读提升的关键，建议通过分级绘本在语境中积累常用词语');
	}

	return recs.slice(0, 3);
}
