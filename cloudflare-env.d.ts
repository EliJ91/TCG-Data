declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    CREDENTIAL_ENCRYPTION_KEY?: string;
    TCGAPIS_API_KEY?: string;
  }
}
