declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    HELIUS_API_KEY?: string;
    JUPITER_API_KEY?: string;
    MAINNET_EXECUTION_ENABLED?: string;
  }
}
