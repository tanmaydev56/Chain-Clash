declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    // Optional Worker secret. When set, unknown words are judged by an AI model
    // and the verdict is cached in word_cache. Set with:
    //   wrangler secret put OPENAI_API_KEY
    OPENAI_API_KEY?: string;
    GUEST_SESSION_SECRET?: string;
    REALTIME_TICKET_SECRET?: string;
    REALTIME_ORIGIN?: string;
  }
}
