/**
 * Worker 共享类型定义
 */

export interface Env {
	DB: D1Database;
	SRC_WORKER_SERVICE_KEY: string;
	SESSION_SECRET: string;
	ADMIN_PASSWORD: string;
	/** Cloudflare 原生 Rate Limiting binding（wrangler.toml [[ratelimits]]），join 接口跨实例频控 */
	JOIN_RATE_LIMITER: RateLimit;
	/**
	 * 教师注册白名单（P4-T9-1C-S5F）：逗号分隔邮箱，比较忽略大小写与首尾空格。
	 * 缺失或为空 = fail-closed，拒绝一切新教师身份开通；不影响家长注册登录与已有教师登录。
	 */
	/**
	 * 课堂推送管理操作总开关（P4-T9-1C-S5F）：仅明确为 'true' 时放行
	 * Claim / Activate / Complete / 课堂渠道写入等实际处理操作；缺失或其他值一律 fail-closed。
	 * 不影响：教师申请创建与查看、只读队列/详情、家庭绘本（channel=home）全部流程。
	 */
	CLASS_PUSH_ADMIN_ENABLED?: string;
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
