declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    HELIUS_API_KEY?: string;
    JUPITER_API_KEY?: string;
    MAINNET_EXECUTION_ENABLED?: string;
    SOLANA_REWARD_TREASURY_ADDRESS?: string;
    SOLANA_BUYBACK_TREASURY_ADDRESS?: string;
    SPORTPAD_MINT_ADDRESS?: string;
    SPORTPAD_PUBLICATION_MODE?: string;
    SPORTPAD_OPERATOR_USER_IDS?: string;
    SPORTPAD_ALLOW_SELF_REVIEW?: string;
  }
}
