import Inventory from "./Inventory";
import { getChatGPTUser, chatGPTSignInPath } from "./chatgpt-auth";
export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getChatGPTUser();
  if (user) return <Inventory />;
  return (
    <main className="signin">
      <div className="signin-card">
        <div className="wordmark">
          SortSwift <span>Market</span>
        </div>
        <h1>Your inventory. A clearer next move.</h1>
        <p>
          Import your SortSwift CSV, research sales, and find the cards worth
          listing. Your inventory and API credentials stay private.
        </p>
        <a
          className="button primary"
          href={chatGPTSignInPath("/")}
          target="_top"
        >
          Sign in with ChatGPT
        </a>
      </div>
    </main>
  );
}
