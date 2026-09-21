declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    HELIUS_API_KEY?: string;
    JUPITER_API_KEY?: string;
    MAINNET_EXECUTION_ENABLED?: string;
    SPORTPAD_PUBLICATION_MODE?: string;
    SPORTPAD_OPERATOR_USER_IDS?: string;
    SPORTPAD_ALLOW_SELF_REVIEW?: string;
  }
}
