export type CommitType =
  | 'feat'
  | 'fix'
  | 'docs'
  | 'style'
  | 'refactor'
  | 'perf'
  | 'test'
  | 'build'
  | 'ci'
  | 'chore'
  | 'revert';

export interface CommitMessage {
  type: CommitType;
  scope: string;
  subject: string;
  body?: string;
}

export interface GitDiff {
  file: string;
  diff: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
}

export interface GitStatus {
  staged: GitDiff[];
  unstaged: string[];
  untracked: string[];
}

export interface AnalysisResult {
  suggestedType: CommitType;
  suggestedScope: string;
  suggestedSubject: string;
  reasoning: string;
}

export interface Rule {
  id: string;
  name: string;
  description: string;
  type: CommitType;
  match: (file: string, diff: string) => boolean;
  priority: number;
}

export interface StorageData {
  lastCommitSha: string;
  lastCommitDate: string;
  lastCommitMessage: string;
}

export interface LLMConfig {
  enabled: boolean;
  baseUrl: string;
  model: string;
  timeout: number;
}

export interface AppConfig {
  llm: LLMConfig;
  defaultScope: string;
  rules: Rule[];
}

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string;
  build?: string;
}

export type BumpType = 'major' | 'minor' | 'patch' | 'prerelease' | 'none';

export interface ParsedCommit {
  sha: string;
  date: string;
  type: CommitType | 'unknown';
  scope: string;
  subject: string;
  body: string;
  isBreakingChange: boolean;
  breakingChangeDescription?: string;
  rawMessage: string;
}

export interface VersionBumpResult {
  currentVersion: string;
  nextVersion: string;
  bumpType: BumpType;
  reason: string;
  commits: ParsedCommit[];
}

export interface ChangelogSection {
  title: string;
  type: CommitType | 'breaking';
  commits: ParsedCommit[];
}

export interface ChangelogEntry {
  version: string;
  date: string;
  sections: ChangelogSection[];
  url?: string;
}

export interface Changelog {
  entries: ChangelogEntry[];
  raw: string;
}

export type PlatformType = 'github' | 'gitlab' | 'none';

export interface PlatformConfig {
  type: PlatformType;
  token?: string;
  apiBaseUrl?: string;
  owner?: string;
  repo?: string;
  projectId?: string;
}

export interface ReleaseDraft {
  tagName: string;
  name: string;
  body: string;
  draft: boolean;
  prerelease: boolean;
}

export interface ReleaseResult {
  success: boolean;
  url?: string;
  id?: string | number;
  error?: string;
}

export interface ReleaseOptions {
  dryRun?: boolean;
  bumpType?: BumpType;
  prerelease?: boolean;
  prereleaseId?: string;
  skipChangelog?: boolean;
  skipTags?: boolean;
  skipPublish?: boolean;
  platform?: PlatformConfig;
  remote?: string;
  branch?: string;
}

export interface GitCommitLog {
  hash: string;
  date: string;
  message: string;
  authorName: string;
  authorEmail: string;
  tags: string[];
}

export interface GitTagInfo {
  name: string;
  sha: string;
  date: string;
  version?: SemVer;
}
