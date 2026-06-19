import simpleGit, { SimpleGit, StatusResult } from 'simple-git';
import { GitStatus, GitDiff } from './types';
import { toPosixPath } from './monorepo';

export class GitService {
  private git: SimpleGit;
  private cwd: string;

  constructor(cwd?: string) {
    this.cwd = cwd || process.cwd();
    this.git = simpleGit(this.cwd);
  }

  getCwd(): string {
    return this.cwd;
  }

  async checkGitRepo(): Promise<boolean> {
    try {
      const isRepo = await this.git.checkIsRepo();
      return isRepo;
    } catch {
      return false;
    }
  }

  async getStatus(): Promise<GitStatus> {
    const status: StatusResult = await this.git.status();

    const stagedFiles = status.staged;
    const unstagedFiles = status.modified
      .filter(f => !status.staged.includes(f))
      .map(toPosixPath);
    const untrackedFiles = status.not_added.map(toPosixPath);

    const stagedDiffs: GitDiff[] = [];

    for (const file of stagedFiles) {
      const posixFile = toPosixPath(file);
      const diff = await this.git.diff(['--staged', '--', file]);

      let fileStatus: GitDiff['status'] = 'modified';
      if (status.created.includes(file)) {
        fileStatus = 'added';
      } else if (status.deleted.includes(file)) {
        fileStatus = 'deleted';
      } else if (status.renamed.some(r => (typeof r === 'string' ? r : r.to) === file)) {
        fileStatus = 'renamed';
      }

      stagedDiffs.push({
        file: posixFile,
        diff,
        status: fileStatus
      });
    }

    return {
      staged: stagedDiffs,
      unstaged: unstagedFiles,
      untracked: untrackedFiles
    };
  }

  async hasStagedChanges(): Promise<boolean> {
    const status = await this.git.status();
    return status.staged.length > 0;
  }

  async commit(message: string): Promise<string> {
    const result = await this.git.commit(message);
    return result.commit;
  }

  async getLastCommit(): Promise<{ sha: string; message: string; date: string }> {
    const log = await this.git.log({ maxCount: 1 });
    const latest = log.latest;
    if (!latest) {
      throw new Error('No commits found');
    }
    return {
      sha: latest.hash,
      message: latest.message,
      date: latest.date
    };
  }
}

export const gitService = new GitService();
