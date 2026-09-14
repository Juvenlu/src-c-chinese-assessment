/**
 * SRC Primary Database - Cloudflare Worker
 *
 * 最小 D1 数据访问通道（P0-11）
 * 当前仅提供只读健康检查端点。
 *
 * 目标架构：
 *   Vercel Production → Cloudflare Worker → D1「SRC Primary Database」
 */

export interface Env {
  DB: D1Database;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS headers（最小配置，Vercel → Worker 跨域调用用）
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    // ========== 路由 ==========

    // GET /health — 只读健康检查（SELECT 1）
    if (path === "/health" && request.method === "GET") {
      try {
        const result = await env.DB.prepare("SELECT 1 as ok").run();
        const row = result.results?.[0] as { ok: number } | undefined;

        return new Response(
          JSON.stringify({
            status: "ok",
            database: "src-primary-database",
            query: row?.ok === 1 ? "verified" : "unknown",
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              ...corsHeaders,
            },
          }
        );
      } catch (error) {
        return new Response(
          JSON.stringify({
            status: "error",
            database: "src-primary-database",
            message: error instanceof Error ? error.message : "Unknown error",
          }),
          {
            status: 500,
            headers: {
              "Content-Type": "application/json",
              ...corsHeaders,
            },
          }
        );
      }
    }

    // 404
    return new Response(
      JSON.stringify({
        status: "not_found",
        path,
      }),
      {
        status: 404,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      }
    );
  },
};
