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
  AI: Ai;
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
  // Option 1: provide pre-computed vector
  vector?: number[];
  // Option 2: provide text (Worker will embed it)
  text?: string;
  topK?: number;
  filter?: Record<string, unknown>;
  returnMetadata?: boolean;
}

interface EmbedRequest {
  text: string | string[];
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

      if (url.pathname === "/embed" && method === "POST") {
        const body = await request.json() as EmbedRequest;

        if (!body.text) {
          return Response.json(
            { error: "Missing 'text' field" },
            { status: 400, headers: corsHeaders }
          );
        }

        const texts = Array.isArray(body.text) ? body.text : [body.text];
        const result = await env.AI.run("@cf/qwen/qwen3-embedding-0.6b", { text: texts });
        return Response.json(result, { headers: corsHeaders });
      }

      if (url.pathname === "/search" && method === "POST") {
        const body = await request.json() as SearchRequest;

        let vector = body.vector;

        // If text is provided, embed it first
        if (!vector && body.text) {
          const embedResult = await env.AI.run("@cf/qwen/qwen3-embedding-0.6b", { text: [body.text] });
          vector = embedResult.data[0];
        }

        if (!vector || !Array.isArray(vector)) {
          return Response.json(
            { error: "Provide either 'vector' or 'text'" },
            { status: 400, headers: corsHeaders }
          );
        }

        const topK = body.topK || 10;
        const returnMetadata = body.returnMetadata !== false;

        const results = await env.VECTORIZE.query(vector, {
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
