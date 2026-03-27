/**
 * Lightweight GitHub API helpers.
 *
 * Uses raw fetch to keep dependencies minimal. Set `GITHUB_ACCESS_TOKEN` in Trigger.dev
 * Production (synced from `.env` on deploy). Legacy `GITHUB_TOKEN` is still accepted.
 * Needs repo scope for posting comments and applying labels.
 */

const GITHUB_API = "https://api.github.com";

function githubToken(): string | undefined {
  const t =
    process.env.GITHUB_ACCESS_TOKEN?.trim() || process.env.GITHUB_TOKEN?.trim();
  return t || undefined;
}

function headers(): Record<string, string> {
  const token = githubToken();
  if (!token) {
    throw new Error(
      "GITHUB_ACCESS_TOKEN is not set in this Trigger.dev environment (Production). Add it in the dashboard or in .env and redeploy."
    );
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

/** Find an existing comment on a PR/issue that contains a given marker string. */
export async function findExistingComment(
  owner: string,
  repo: string,
  issueNumber: number,
  marker: string
): Promise<{ id: number } | null> {
  const response = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/issues/${issueNumber}/comments?per_page=100`,
    { headers: headers() }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch comments: ${response.status} ${response.statusText}`);
  }

  const comments = await response.json() as Array<{ id: number; body: string }>;
  const found = comments.find((c) => c.body.includes(marker));
  return found ? { id: found.id } : null;
}

/** Update an existing comment by ID. */
export async function updateComment(
  owner: string,
  repo: string,
  commentId: number,
  body: string
): Promise<void> {
  const response = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/issues/comments/${commentId}`,
    {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({ body }),
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to update comment: ${response.status} ${response.statusText}`);
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
