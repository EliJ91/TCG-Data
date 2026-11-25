declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    CREDENTIAL_ENCRYPTION_KEY?: string;
    API_SH_API_KEY?: string;
    GITHUB_CLIENT_ID?: string;
    GITHUB_CLIENT_SECRET?: string;
    SESSION_SECRET?: string;
    OWNER_GITHUB_ID?: string;
    FRONTEND_URL?: string;
    FREE_ONLY?: string;
  }
}
