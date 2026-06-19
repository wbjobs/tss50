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
