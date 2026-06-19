import { SemVer, BumpType, ParsedCommit, VersionBumpResult, CommitType } from './types';
import * as fs from 'fs';
import * as path from 'path';

const SEMVER_REGEX = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

const CONVENTIONAL_COMMIT_REGEX = /^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/;
const BREAKING_CHANGE_IN_TITLE = /^(\w+)(?:\(([^)]+)\))?!:\s*(.+)$/;
const BREAKING_CHANGE_FOOTER = /^BREAKING[-\s]CHANGE:\s*(.+)$/m;
const BREAKING_CHANGE_ALT = /^BREAKING:\s*(.+)$/m;

const VALID_TYPES: CommitType[] = [
  'feat', 'fix', 'perf', 'refactor', 'style',
  'docs', 'test', 'build', 'ci', 'chore', 'revert'
];

export function parseSemVer(version: string): SemVer | null {
  const match = version.trim().match(SEMVER_REGEX);
  if (!match) return null;

  const [, major, minor, patch, prerelease, build] = match;
  return {
    major: parseInt(major, 10),
    minor: parseInt(minor, 10),
    patch: parseInt(patch, 10),
    prerelease,
    build
  };
}

export function semVerToString(v: SemVer): string {
  let result = `${v.major}.${v.minor}.${v.patch}`;
  if (v.prerelease) {
    result += `-${v.prerelease}`;
  }
  if (v.build) {
    result += `+${v.build}`;
  }
  return result;
}

export function compareSemVer(a: SemVer, b: SemVer): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  if (a.prerelease && !b.prerelease) return -1;
  if (!a.prerelease && b.prerelease) return 1;
  if (a.prerelease && b.prerelease) {
    return a.prerelease.localeCompare(b.prerelease);
  }
  return 0;
}

export function bumpVersion(current: SemVer, type: BumpType, prereleaseId: string = 'alpha'): SemVer {
  const result: SemVer = {
    major: current.major,
    minor: current.minor,
    patch: current.patch,
    prerelease: current.prerelease,
    build: current.build
  };

  switch (type) {
    case 'major':
      result.major += 1;
      result.minor = 0;
      result.patch = 0;
      result.prerelease = undefined;
      result.build = undefined;
      break;
    case 'minor':
      result.minor += 1;
      result.patch = 0;
      result.prerelease = undefined;
      result.build = undefined;
      break;
    case 'patch':
      result.patch += 1;
      result.prerelease = undefined;
      result.build = undefined;
      break;
    case 'prerelease':
      result.patch += 1;
      const existingNum = current.prerelease
        ? parseInt(current.prerelease.split('.').pop() || '0', 10)
        : 0;
      const nextNum = isNaN(existingNum) ? 0 : existingNum + 1;
      const basePrerelease = current.prerelease
        ? current.prerelease.split('.').slice(0, -1).join('.')
        : prereleaseId;
      result.prerelease = nextNum > 0
        ? `${basePrerelease || prereleaseId}.${nextNum}`
        : `${basePrerelease || prereleaseId}.0`;
      result.build = undefined;
      break;
    case 'none':
    default:
      break;
  }

  return result;
}

export function parseCommitMessage(
  sha: string, date: string, rawMessage: string): ParsedCommit {
  const lines = rawMessage.split('\n');
  const firstLine = lines[0] || '';
  const body = lines.slice(1).join('\n');

  let type: CommitType | 'unknown' = 'unknown';
  let scope = '';
  let subject = firstLine;
  let isBreakingChange = false;
  let breakingChangeDescription: string | undefined;

  const breakingTitleMatch = firstLine.match(BREAKING_CHANGE_IN_TITLE);
  if (breakingTitleMatch) {
    const [, rawType, rawScope, rawSubject] = breakingTitleMatch;
    type = VALID_TYPES.includes(rawType as CommitType) ? (rawType as CommitType) : 'unknown';
    scope = rawScope || '';
    subject = rawSubject;
    isBreakingChange = true;
  } else {
    const conventionalMatch = firstLine.match(CONVENTIONAL_COMMIT_REGEX);
    if (conventionalMatch) {
      const [, rawType, rawScope, bang, rawSubject] = conventionalMatch;
      type = VALID_TYPES.includes(rawType as CommitType) ? (rawType as CommitType) : 'unknown';
      scope = rawScope || '';
      subject = rawSubject;
      if (bang === '!') {
        isBreakingChange = true;
      }
    }
  }

  const breakingFooterMatch = body.match(BREAKING_CHANGE_FOOTER) || body.match(BREAKING_CHANGE_ALT);
  if (breakingFooterMatch) {
    isBreakingChange = true;
    breakingChangeDescription = breakingFooterMatch[1].trim();
  }

  return {
    sha,
    date,
    type,
    scope,
    subject: subject.trim(),
    body: body.trim(),
    isBreakingChange,
    breakingChangeDescription,
    rawMessage
  };
}

export function determineBumpType(commits: ParsedCommit[]): { bumpType: BumpType; reason: string } {
  if (commits.length === 0) {
    return { bumpType: 'none', reason: '没有找到新的 commit' };
  }

  const hasBreakingChange = commits.some(c => c.isBreakingChange);
  if (hasBreakingChange) {
    const breakingCommits = commits.filter(c => c.isBreakingChange).length;
    return {
      bumpType: 'major',
      reason: `检测到 ${breakingCommits} 个 BREAKING CHANGE`
    };
  }

  const hasFeat = commits.some(c => c.type === 'feat');
  if (hasFeat) {
    const featCount = commits.filter(c => c.type === 'feat').length;
    return {
      bumpType: 'minor',
      reason: `检测到 ${featCount} 个 feat 提交`
    };
  }

  const hasFixOrPerf = commits.some(c => c.type === 'fix' || c.type === 'perf');
  if (hasFixOrPerf) {
    const fixCount = commits.filter(c => c.type === 'fix').length;
    const perfCount = commits.filter(c => c.type === 'perf').length;
    const parts = [];
    if (fixCount > 0) parts.push(`${fixCount} 个 fix`);
    if (perfCount > 0) parts.push(`${perfCount} 个 perf`);
    return {
      bumpType: 'patch',
      reason: `检测到 ${parts.join('、')}`
    };
  }

  const otherCount = commits.filter(c => c.type !== 'unknown').length;
  if (otherCount > 0) {
    return {
      bumpType: 'patch',
      reason: `检测到 ${otherCount} 个其他类型的提交`
    };
  }

  return {
    bumpType: 'none',
    reason: '没有找到符合 Conventional Commits 规范的提交'
  };
}

export function calculateNextVersion(
  currentVersion: string,
  commits: ParsedCommit[],
  options: {
    overrideBump?: BumpType;
    isPrerelease?: boolean;
    prereleaseId?: string;
  } = {}
): VersionBumpResult {
  const current = parseSemVer(currentVersion);
  if (!current) {
    throw new Error(`当前版本号格式无效: ${currentVersion}`);
  }

  let { bumpType, reason } = determineBumpType(commits);

  if (options.overrideBump && options.overrideBump !== 'none') {
    bumpType = options.overrideBump;
    reason = `用户指定 bump 类型: ${bumpType}`;
  }

  if (options.isPrerelease && bumpType !== 'major' && bumpType !== 'none') {
    bumpType = 'prerelease';
  }

  if (bumpType === 'none') {
    return {
      currentVersion,
      nextVersion: currentVersion,
      bumpType: 'none',
      reason,
      commits
    };
  }

  const nextSemVer = bumpVersion(current, bumpType, options.prereleaseId || 'alpha');
  const nextVersion = semVerToString(nextSemVer);

  return {
    currentVersion,
    nextVersion,
    bumpType,
    reason,
    commits
  };
}

export function getVersionFromPackageJson(cwd: string = process.cwd()): string | null {
  const pkgPath = path.join(cwd, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    return null;
  }
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    return pkg.version || null;
  } catch {
    return null;
  }
}

export function isValidTag(tagName: string): SemVer | null {
  return parseSemVer(tagName.replace(/^v/, ''));
}

export function getValidTags(tags: string[]): Array<{ tag: string; version: SemVer }> {
  return tags
    .map(tag => {
      const version = isValidTag(tag);
      return version ? { tag, version } : null;
    })
    .filter((v): v is { tag: string; version: SemVer } => v !== null)
    .sort((a, b) => compareSemVer(b.version, a.version));
}
