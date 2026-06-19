import axios from 'axios';
import { PlatformConfig, ReleaseDraft, ReleaseResult } from './types';

const GITHUB_API_BASE = 'https://api.github.com';
const GITLAB_API_BASE = 'https://gitlab.com/api/v4';

export function detectPlatformFromEnv(): PlatformConfig {
  const githubToken = process.env.GITHUB_TOKEN;
  const gitlabToken = process.env.GITLAB_TOKEN || process.env.GITLAB_PERSONAL_ACCESS_TOKEN;

  if (githubToken) {
    return {
      type: 'github',
      token: githubToken,
      apiBaseUrl: process.env.GITHUB_API_URL || GITHUB_API_BASE,
      owner: process.env.GITHUB_REPOSITORY_OWNER,
      repo: process.env.GITHUB_REPOSITORY?.split('/')[1]
    };
  }

  if (gitlabToken) {
    return {
      type: 'gitlab',
      token: gitlabToken,
      apiBaseUrl: process.env.GITLAB_API_URL || GITLAB_API_BASE,
      projectId: process.env.CI_PROJECT_ID
    };
  }

  return { type: 'none' };
}

function extractOwnerRepoFromUrl(url: string): { owner?: string; repo?: string } {
  const httpsMatch = url.match(/https?:\/\/(github|gitlab)\.com[:/]+([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (httpsMatch) {
    return { owner: httpsMatch[2], repo: httpsMatch[3].replace(/\.git$/, '') };
  }

  const sshMatch = url.match(/@(github|gitlab)\.com:([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (sshMatch) {
    return { owner: sshMatch[2], repo: sshMatch[3].replace(/\.git$/, '') };
  }

  return {};
}

export async function createGitHubRelease(
  draft: ReleaseDraft,
  config: PlatformConfig
): Promise<ReleaseResult> {
  try {
    if (!config.token) {
      return {
        success: false,
        error: '缺少 GITHUB_TOKEN 环境变量'
      };
    }

    if (!config.owner || !config.repo) {
      return {
        success: false,
        error: '缺少 GitHub owner/repo 配置'
      };
    }

    const apiBase = config.apiBaseUrl || GITHUB_API_BASE;
    const url = `${apiBase}/repos/${config.owner}/${config.repo}/releases`;

    const response = await axios.post(
      url,
      {
        tag_name: draft.tagName,
        name: draft.name,
        body: draft.body,
        draft: draft.draft,
        prerelease: draft.prerelease
      },
      {
        headers: {
          'Authorization': `Bearer ${config.token}`,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28'
        }
      }
    );

    return {
      success: true,
      url: response.data.html_url,
      id: response.data.id
    };
  } catch (error: any) {
    const errMsg = error.response?.data?.message || error.message;
    console.error(`创建 GitHub Release 失败: ${errMsg}`);
    if (error.response?.data?.errors) {
      console.error('详细错误:', JSON.stringify(error.response.data.errors, null, 2));
    }
    return {
      success: false,
      error: errMsg
    };
  }
}

export async function createGitLabRelease(
  draft: ReleaseDraft,
  config: PlatformConfig
): Promise<ReleaseResult> {
  try {
    if (!config.token) {
      return {
        success: false,
        error: '缺少 GITLAB_TOKEN 环境变量'
      };
    }

    if (!config.projectId) {
      return {
        success: false,
        error: '缺少 GitLab projectId 配置'
      };
    }

    const apiBase = config.apiBaseUrl || GITLAB_API_BASE;
    const url = `${apiBase}/projects/${encodeURIComponent(config.projectId)}/releases`;

    const response = await axios.post(
      url,
      {
        name: draft.name,
        tag_name: draft.tagName,
        description: draft.body,
        released_at: new Date().toISOString()
      },
      {
        headers: {
          'PRIVATE-TOKEN': config.token,
          'Content-Type': 'application/json'
        }
      }
    );

    return {
      success: true,
      url: response.data._links?.self,
      id: response.data.id
    };
  } catch (error: any) {
    const errMsg = error.response?.data?.message || error.message;
    console.error(`创建 GitLab Release 失败: ${errMsg}`);
    return {
      success: false,
      error: errMsg
    };
  }
}

export async function createReleaseDraft(
  draft: ReleaseDraft,
  config: PlatformConfig
): Promise<ReleaseResult> {
  switch (config.type) {
    case 'github':
      return createGitHubRelease({ ...draft, draft: true }, config);
    case 'gitlab':
      return createGitLabRelease(draft, config);
    case 'none':
    default:
      return {
        success: false,
        error: '未配置发布平台 (GitHub/GitLab)'
      };
  }
}
