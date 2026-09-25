/**
 * Worker 共享类型定义
 */

export interface Env {
	DB: D1Database;
	SRC_WORKER_SERVICE_KEY: string;
	SESSION_SECRET: string;
	ADMIN_PASSWORD: string;
}

export type Level = 'SRC100' | 'SRC300' | 'SRC500' | 'SRC800';
export type RJBLevel = 'RJB100' | 'RJB300' | 'RJB500' | 'RJB800';

/** 等级配置（与 src/lib/types.ts LEVEL_CONFIG 一致） */
export const LEVEL_CONFIG: Record<Level, {
	timeLimitSeconds: number;
	charCount: number;
	vocabMultiplier: number;
	label: string;
	vocabCount: number;
}> = {
	SRC100: { timeLimitSeconds: 300, charCount: 114, vocabMultiplier: 2.86, label: '入门级', vocabCount: 128 },
	SRC300: { timeLimitSeconds: 480, charCount: 317, vocabMultiplier: 2.86, label: '基础级', vocabCount: 346 },
	SRC500: { timeLimitSeconds: 720, charCount: 528, vocabMultiplier: 2.86, label: '进阶级', vocabCount: 558 },
	SRC800: { timeLimitSeconds: 900, charCount: 813, vocabMultiplier: 2.86, label: '高级', vocabCount: 820 },
};
