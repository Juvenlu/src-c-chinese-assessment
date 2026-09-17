/**
 * Worker 共享类型定义
 */

export interface Env {
	DB: D1Database;
	SRC_WORKER_SERVICE_KEY: string;
	SESSION_SECRET: string;
}

export type Level = 'SRC100' | 'SRC300' | 'SRC500' | 'SRC800';
export type RJBLevel = 'RJB100' | 'RJB300' | 'RJB500' | 'RJB800';
