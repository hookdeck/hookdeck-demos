/**
 * Lightweight GitHub API helpers.
 *
 * Uses raw fetch to keep dependencies minimal. The GITHUB_TOKEN environment
 * variable must be set in Trigger.dev's environment variables (dashboard or
 * syncEnvVars). It needs repo scope for posting comments and applying labels.
 */

const GITHUB_API = "https://api.github.com";

function headers(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error("GITHUB_TOKEN environment variable is not set");
  }
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github.v3+json",
    "Content-Type": "application/json",
  };
}

/** Fetch the diff for a pull request. */
export async function getPRDiff(
  owner: string,
  repo: string,
  prNumber: number
): Promise<string> {
  const response = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/pulls/${prNumber}`,
    {
      headers: {
        ...headers(),
        Accept: "application/vnd.github.v3.diff",
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch PR diff: ${response.status} ${response.statusText}`);
  }

  return response.text();
}

/** Post a comment on a pull request or issue. */
export async function postComment(
  owner: string,
  repo: string,
  issueNumber: number,
  body: string
): Promise<void> {
  const response = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/issues/${issueNumber}/comments`,
    {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ body }),
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to post comment: ${response.status} ${response.statusText}`);
  }
}

/** Apply labels to an issue. */
export async function addLabels(
  owner: string,
  repo: string,
  issueNumber: number,
  labels: string[]
): Promise<void> {
  const response = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/issues/${issueNumber}/labels`,
    {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ labels }),
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to add labels: ${response.status} ${response.statusText}`);
  }
}

/** Parse owner and repo from a repository full_name (e.g., "hookdeck/hookdeck-demos"). */
export function parseRepo(fullName: string): { owner: string; repo: string } {
  const [owner, repo] = fullName.split("/");
  return { owner, repo };
}
