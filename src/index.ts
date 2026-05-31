/**
 * Vector Proxy - Cloudflare Worker
 *
 * API proxy for Cloudflare Vectorize, used by CSBot.
 * Binds to: vector.orcax.net
 *
 * Endpoints:
 *   POST /upsert     - Upsert vectors
 *   POST /search     - Search by vector
 *   POST /delete     - Delete by IDs
 *   GET  /describe   - Get index info
 *   GET  /health     - Health check
 */

interface Env {
  VECTORIZE: VectorizeIndex;
  API_KEY?: string;
}

interface VectorPoint {
  id: string;
  values: number[];
  metadata?: Record<string, unknown>;
}

interface UpsertRequest {
  vectors: VectorPoint[];
}

interface SearchRequest {
  vector: number[];
  topK?: number;
  filter?: Record<string, unknown>;
  returnMetadata?: boolean;
}

interface DeleteRequest {
  ids: string[];
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method;

    // CORS headers
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    // Handle preflight
    if (method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // API Key authentication (optional)
    if (env.API_KEY) {
      const authHeader = request.headers.get("Authorization");
      const token = authHeader?.replace("Bearer ", "");
      if (token !== env.API_KEY) {
        return Response.json(
          { error: "Unauthorized" },
          { status: 401, headers: corsHeaders }
        );
      }
    }

    try {
      // Route handling
      if (url.pathname === "/health") {
        return Response.json({ status: "ok", timestamp: new Date().toISOString() }, { headers: corsHeaders });
      }

      if (url.pathname === "/describe" && method === "GET") {
        const info = await env.VECTORIZE.describe();
        return Response.json(info, { headers: corsHeaders });
      }

      if (url.pathname === "/upsert" && method === "POST") {
        const body = await request.json() as UpsertRequest;

        if (!body.vectors || !Array.isArray(body.vectors)) {
          return Response.json(
            { error: "Missing or invalid 'vectors' array" },
            { status: 400, headers: corsHeaders }
          );
        }

        const result = await env.VECTORIZE.upsert(body.vectors);
        return Response.json(result, { headers: corsHeaders });
      }

      if (url.pathname === "/search" && method === "POST") {
        const body = await request.json() as SearchRequest;

        if (!body.vector || !Array.isArray(body.vector)) {
          return Response.json(
            { error: "Missing or invalid 'vector' array" },
            { status: 400, headers: corsHeaders }
          );
        }

        const topK = body.topK || 10;
        const returnMetadata = body.returnMetadata !== false;

        const results = await env.VECTORIZE.query(body.vector, {
          topK,
          returnMetadata: returnMetadata ? "all" : "none",
        });

        return Response.json(results, { headers: corsHeaders });
      }

      if (url.pathname === "/delete" && method === "POST") {
        const body = await request.json() as DeleteRequest;

        if (!body.ids || !Array.isArray(body.ids)) {
          return Response.json(
            { error: "Missing or invalid 'ids' array" },
            { status: 400, headers: corsHeaders }
          );
        }

        const result = await env.VECTORIZE.deleteByIds(body.ids);
        return Response.json(result, { headers: corsHeaders });
      }

      // 404 for unknown routes
      return Response.json(
        { error: "Not found", path: url.pathname },
        { status: 404, headers: corsHeaders }
      );
    } catch (error) {
      console.error("Error:", error);
      return Response.json(
        { error: "Internal server error", message: String(error) },
        { status: 500, headers: corsHeaders }
      );
    }
  },
};
