import { execSync } from 'child_process';
import { GitCommitLog, GitTagInfo } from './types';
import { parseSemVer, getValidTags } from './semver';
import { toPosixPath } from './monorepo';
import * as path from 'path';

export class GitReleaseService {
  private cwd: string;

  constructor(cwd: string = process.cwd()) {
    this.cwd = cwd;
  }

  private execGit(args: string[]): string {
    const quotedArgs = args.map(arg => {
      if (/[\s|;`$&<>()[\]{}]/.test(arg)) {
        return `"${arg.replace(/"/g, '\\"')}"`;
      }
      return arg;
    });
    return execSync(`git ${quotedArgs.join(' ')}`, {
      cwd: this.cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
  }

  checkGitRepo(): boolean {
    try {
      this.execGit(['rev-parse', '--is-inside-work-tree']);
      return true;
    } catch {
      return false;
    }
  }

  isCleanWorkingTree(): boolean {
    try {
      const output = this.execGit(['status', '--porcelain']);
      return output.length === 0;
    } catch {
      return false;
    }
  }

  getCurrentBranch(): string {
    try {
      return this.execGit(['rev-parse', '--abbrev-ref', 'HEAD']);
    } catch {
      return '';
    }
  }

  getCommitLogs(options: {
    sinceTag?: string;
    sinceSha?: string;
    maxCount?: number;
    fromHead?: boolean;
  } = {}): GitCommitLog[] {
    const args: string[] = ['log', `--pretty=format:%H|%aI|%s|%an|%ae|%d|||%b||ENDCOMMIT`];

    if (options.maxCount) {
      args.push(`-n`, options.maxCount.toString());
    }

    if (options.sinceTag) {
      args.push(`${options.sinceTag}..HEAD`);
    } else if (options.sinceSha) {
      args.push(`${options.sinceSha}..HEAD`);
    }

    try {
      const output = this.execGit(args);
      if (!output) return [];

      const results: GitCommitLog[] = [];
      const entries = output.split('||ENDCOMMIT');
      
      for (const entry of entries) {
        const trimmed = entry.trim();
        if (!trimmed) continue;

        const sepIdx = trimmed.indexOf('|||');
        const headerPart = sepIdx >= 0 ? trimmed.substring(0, sepIdx) : trimmed;
        const bodyPart = sepIdx >= 0 ? trimmed.substring(sepIdx + 3) : '';

        const headerFields = headerPart.split('|');
        if (headerFields.length < 5) continue;

        const [hashPart, datePart, subjectPart, authorNamePart, authorEmailPart, ...restHeader] = headerFields;
        if (!hashPart || !datePart || !subjectPart) continue;

        const refsPart = restHeader.join('|');
        const tags = this.extractTagsFromRefs(refsPart);
        const message = bodyPart && bodyPart.trim() ? `${subjectPart}\n${bodyPart}` : subjectPart;

        results.push({
          hash: hashPart.trim(),
          date: datePart.trim(),
          message: message.trim(),
          authorName: authorNamePart ? authorNamePart.trim() : '',
          authorEmail: authorEmailPart ? authorEmailPart.trim() : '',
          tags
        });
      }
      return results;
    } catch (error) {
      console.warn('获取 commit 日志失败:', (error as Error).message);
      return [];
    }
  }

  private extractTagsFromRefs(refs: string): string[] {
    if (!refs) return [];
    const tagRegex = /tag:\s*([^,)]+)/g;
    const tags: string[] = [];
    let match;
    while ((match = tagRegex.exec(refs)) !== null) {
      tags.push(match[1].trim());
    }
    return tags;
  }

  getAllTags(): GitTagInfo[] {
    try {
      const output = this.execGit([
        'for-each-ref',
        '--sort=-creatordate',
        '--format=%(refname:short)|%(objectname)|%(creatordate:iso8601)',
        'refs/tags'
      ]);

      if (!output) return [];

      const results: GitTagInfo[] = [];
      for (const line of output.split('\n')) {
        const trimmedLine = line.trim();
        if (!trimmedLine) continue;
        const parts = trimmedLine.split('|');
        if (parts.length < 3) continue;
        const [namePart, shaPart, datePart] = parts;
        if (!namePart || !shaPart || !datePart) continue;
        const parsedVersion = parseSemVer(namePart.trim().replace(/^v/, ''));
        results.push({
          name: namePart.trim(),
          sha: shaPart.trim(),
          date: datePart.trim(),
          version: parsedVersion || undefined
        });
      }
      return results;
    } catch (error) {
      console.warn('获取 tags 失败:', (error as Error).message);
      return [];
    }
  }

  getLatestVersionTag(): GitTagInfo | null {
    const allTags = this.getAllTags();
    const versionedTags = getValidTags(allTags.map(t => t.name));

    if (versionedTags.length === 0) return null;

    const latestVersionTag = versionedTags[0];
    return allTags.find(t => t.name === latestVersionTag.tag) || null;
  }

  getRemoteUrl(remote: string = 'origin'): string | null {
    try {
      return this.execGit(['remote', 'get-url', remote]);
    } catch {
      return null;
    }
  }

  inferPlatformInfo(): { type: 'github' | 'gitlab' | 'none'; owner?: string; repo?: string; projectId?: string } {
    const remoteUrl = this.getRemoteUrl();
    if (!remoteUrl) return { type: 'none' };

    const httpsMatch = remoteUrl.match(/https?:\/\/(github|gitlab)\.com[:/]+([^/]+)\/([^/]+?)(?:\.git)?$/);
    if (httpsMatch) {
      const [, platform, owner, repo] = httpsMatch;
      return {
        type: platform as 'github' | 'gitlab',
        owner,
        repo: repo.replace(/\.git$/, '')
      };
    }

    const sshMatch = remoteUrl.match(/@(github|gitlab)\.com:([^/]+)\/([^/]+?)(?:\.git)?$/);
    if (sshMatch) {
      const [, platform, owner, repo] = sshMatch;
      return {
        type: platform as 'github' | 'gitlab',
        owner,
        repo: repo.replace(/\.git$/, '')
      };
    }

    return { type: 'none' };
  }

  createAnnotatedTag(tagName: string, message: string): boolean {
    try {
      this.execGit(['tag', '-a', tagName, '-m', `"${message.replace(/"/g, '\\"')}"`]);
      return true;
    } catch (error) {
      console.warn(`创建 tag ${tagName} 失败:`, (error as Error).message);
      return false;
    }
  }

  pushTags(remote: string = 'origin'): boolean {
    try {
      this.execGit(['push', remote, '--tags']);
      return true;
    } catch (error) {
      console.warn('推送 tags 失败:', (error as Error).message);
      return false;
    }
  }

  push(remote: string = 'origin', branch?: string): boolean {
    try {
      const targetBranch = branch || this.getCurrentBranch();
      if (targetBranch) {
        this.execGit(['push', remote, targetBranch]);
      } else {
        this.execGit(['push', remote]);
      }
      return true;
    } catch (error) {
      console.warn('推送失败:', (error as Error).message);
      return false;
    }
  }
}
