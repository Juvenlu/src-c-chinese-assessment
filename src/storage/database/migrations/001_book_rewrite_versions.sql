-- Migration: 001_book_rewrite_versions
-- Purpose: 绘本AI改写版本表（旁路模块，不侵入SRC核心架构）
-- Created: POC phase

CREATE TABLE IF NOT EXISTS book_rewrite_versions (
  id SERIAL PRIMARY KEY,
  episode_id INTEGER NOT NULL REFERENCES book_episodes(id) ON DELETE CASCADE,
  target_level VARCHAR(20) NOT NULL,
  pages_json JSONB NOT NULL,
  frontier_targets TEXT[] DEFAULT '{}',
  status VARCHAR(20) NOT NULL DEFAULT 'ai_draft',
  generation_params JSONB,
  validation_result JSONB,
  version INTEGER NOT NULL DEFAULT 1,
  retry_count INTEGER NOT NULL DEFAULT 0,
  failure_reason TEXT,
  child_id VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finalized_at TIMESTAMPTZ,
  finalized_by VARCHAR(255)
);

CREATE INDEX IF NOT EXISTS idx_book_rewrite_versions_episode_id ON book_rewrite_versions(episode_id);
CREATE INDEX IF NOT EXISTS idx_book_rewrite_versions_status ON book_rewrite_versions(status);
CREATE INDEX IF NOT EXISTS idx_book_rewrite_versions_target_level ON book_rewrite_versions(target_level);
