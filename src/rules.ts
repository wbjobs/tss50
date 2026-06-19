import { Rule, CommitType, GitDiff, AnalysisResult } from './types';

const fileExtensionRules: Array<{ ext: string; type: CommitType; scopeHint?: string }> = [
  { ext: '.ts', type: 'feat', scopeHint: 'core' },
  { ext: '.tsx', type: 'feat', scopeHint: 'ui' },
  { ext: '.js', type: 'feat', scopeHint: 'core' },
  { ext: '.jsx', type: 'feat', scopeHint: 'ui' },
  { ext: '.vue', type: 'feat', scopeHint: 'ui' },
  { ext: '.py', type: 'feat', scopeHint: 'backend' },
  { ext: '.go', type: 'feat', scopeHint: 'backend' },
  { ext: '.java', type: 'feat', scopeHint: 'backend' },
  { ext: '.cpp', type: 'feat', scopeHint: 'core' },
  { ext: '.c', type: 'feat', scopeHint: 'core' },
  { ext: '.rs', type: 'feat', scopeHint: 'core' },
  { ext: '.css', type: 'style', scopeHint: 'style' },
  { ext: '.scss', type: 'style', scopeHint: 'style' },
  { ext: '.less', type: 'style', scopeHint: 'style' },
  { ext: '.html', type: 'feat', scopeHint: 'ui' },
  { ext: '.md', type: 'docs', scopeHint: 'docs' },
  { ext: '.json', type: 'chore', scopeHint: 'config' },
  { ext: '.yaml', type: 'chore', scopeHint: 'config' },
  { ext: '.yml', type: 'chore', scopeHint: 'config' },
  { ext: '.toml', type: 'chore', scopeHint: 'config' },
];

export const defaultRules: Rule[] = [
  {
    id: 'interface-change',
    name: 'Interface Change',
    description: '检测到 interface 或 type 定义变更',
    type: 'feat',
    priority: 100,
    match: (_file: string, diff: string) => {
      const interfacePattern = /^[+\s]*(?:export\s+)?(?:interface|type)\s+\w+/m;
      return interfacePattern.test(diff);
    }
  },
  {
    id: 'readme-change',
    name: 'README Change',
    description: '检测到 README 文件变更',
    type: 'docs',
    priority: 90,
    match: (file: string, _diff: string) => {
      return /README(\.\w+)?$/i.test(file);
    }
  },
  {
    id: 'test-file',
    name: 'Test File',
    description: '检测到测试文件变更',
    type: 'test',
    priority: 85,
    match: (file: string, _diff: string) => {
      return /\.(test|spec)\.\w+$/i.test(file) || /\/__tests__\//.test(file) || /\/tests?\//.test(file);
    }
  },
  {
    id: 'bug-fix',
    name: 'Bug Fix',
    description: '检测到与修复 bug 相关的代码变更',
    type: 'fix',
    priority: 80,
    match: (_file: string, diff: string) => {
      const fixKeywords = /fix|bug|error|issue|correct|repair|resolve/i;
      return fixKeywords.test(diff);
    }
  },
  {
    id: 'performance',
    name: 'Performance',
    description: '检测到性能优化相关变更',
    type: 'perf',
    priority: 75,
    match: (_file: string, diff: string) => {
      const perfKeywords = /optimiz|perform|speed|efficient|cache|memoiz|lazy|debounce|throttl/i;
      return perfKeywords.test(diff);
    }
  },
  {
    id: 'refactor',
    name: 'Refactor',
    description: '检测到重构相关变更',
    type: 'refactor',
    priority: 70,
    match: (_file: string, diff: string) => {
      const refactorKeywords = /refactor|restruct|reorganiz|rename|move|extract|inline|simplif/i;
      return refactorKeywords.test(diff);
    }
  },
  {
    id: 'ci-config',
    name: 'CI Config',
    description: '检测到 CI/CD 配置变更',
    type: 'ci',
    priority: 65,
    match: (file: string, _diff: string) => {
      return /\.github\/workflows|\.gitlab-ci|azure-pipelines|travis|circleci/i.test(file);
    }
  },
  {
    id: 'build-config',
    name: 'Build Config',
    description: '检测到构建配置变更',
    type: 'build',
    priority: 60,
    match: (file: string, _diff: string) => {
      return /webpack|vite|rollup|babel|esbuild|package\.json|tsconfig|jest|vitest/i.test(file);
    }
  },
  {
    id: 'revert',
    name: 'Revert',
    description: '检测到 revert 相关变更',
    type: 'revert',
    priority: 95,
    match: (_file: string, diff: string) => {
      return /revert|this reverts commit/i.test(diff);
    }
  },
  {
    id: 'style-change',
    name: 'Style Change',
    description: '检测到样式相关变更',
    type: 'style',
    priority: 50,
    match: (file: string, _diff: string) => {
      return /\.(css|scss|less|styl|stylus)$/i.test(file);
    }
  },
  {
    id: 'docs-change',
    name: 'Docs Change',
    description: '检测到文档变更',
    type: 'docs',
    priority: 45,
    match: (file: string, _diff: string) => {
      return /\.(md|rst|txt)$/i.test(file) || /\/docs?\//i.test(file);
    }
  },
];

export function getFileType(file: string): string {
  const ext = file.substring(file.lastIndexOf('.'));
  return ext || 'unknown';
}

export function getFileScope(file: string): string {
  const parts = file.split('/');
  
  if (parts.length > 1) {
    const firstDir = parts[0];
    if (!firstDir.startsWith('.') && firstDir !== 'src' && firstDir !== 'lib') {
      return firstDir;
    }
    if (parts.length > 2) {
      return parts[1];
    }
  }
  
  const ext = getFileType(file);
  const extRule = fileExtensionRules.find(r => r.ext === ext && r.scopeHint);
  if (extRule) {
    return extRule.scopeHint!;
  }
  
  return 'general';
}

export function analyzeByFileExtension(file: string): { type: CommitType; confidence: number } {
  const ext = getFileType(file);
  const extRule = fileExtensionRules.find(r => r.ext === ext);
  if (extRule) {
    return { type: extRule.type, confidence: 0.6 };
  }
  return { type: 'chore', confidence: 0.3 };
}

export function analyzeByRules(file: string, diff: string): Rule | null {
  const matchedRules = defaultRules
    .filter(rule => rule.match(file, diff))
    .sort((a, b) => b.priority - a.priority);
  
  return matchedRules.length > 0 ? matchedRules[0] : null;
}

export function analyzeChanges(stagedDiffs: GitDiff[]): AnalysisResult {
  if (stagedDiffs.length === 0) {
    return {
      suggestedType: 'chore',
      suggestedScope: 'general',
      suggestedSubject: 'empty commit',
      reasoning: 'No staged changes found'
    };
  }

  const fileAnalysis = stagedDiffs.map(diff => {
    const ruleMatch = analyzeByRules(diff.file, diff.diff);
    const extAnalysis = analyzeByFileExtension(diff.file);
    const scope = getFileScope(diff.file);
    
    return {
      file: diff.file,
      diff: diff.diff,
      ruleMatch,
      extAnalysis,
      scope,
      finalType: ruleMatch ? ruleMatch.type : extAnalysis.type,
      confidence: ruleMatch ? 0.9 : extAnalysis.confidence
    };
  });

  const typeCount: Record<string, number> = {};
  const scopeCount: Record<string, number> = {};
  
  fileAnalysis.forEach(analysis => {
    typeCount[analysis.finalType] = (typeCount[analysis.finalType] || 0) + analysis.confidence;
    scopeCount[analysis.scope] = (scopeCount[analysis.scope] || 0) + 1;
  });

  const suggestedType = Object.entries(typeCount)
    .sort(([, a], [, b]) => b - a)[0][0] as CommitType;

  const suggestedScope = Object.entries(scopeCount)
    .sort(([, a], [, b]) => b - a)[0][0];

  const subjectFiles = stagedDiffs.length <= 3
    ? stagedDiffs.map(d => d.file.substring(d.file.lastIndexOf('/') + 1)).join(', ')
    : `${stagedDiffs.length} files`;

  const topAnalysis = fileAnalysis.sort((a, b) => b.confidence - a.confidence)[0];
  let suggestedSubject = '';
  
  if (topAnalysis.ruleMatch) {
    const action = getActionForType(topAnalysis.finalType);
    suggestedSubject = `${action} ${subjectFiles}`;
  } else {
    const action = getActionForType(suggestedType);
    suggestedSubject = `${action} ${subjectFiles}`;
  }

  const reasoning = generateReasoning(fileAnalysis, suggestedType, suggestedScope);

  return {
    suggestedType,
    suggestedScope,
    suggestedSubject: capitalizeFirst(suggestedSubject),
    reasoning
  };
}

function getActionForType(type: CommitType): string {
  const actions: Record<CommitType, string> = {
    feat: 'add',
    fix: 'fix',
    docs: 'update',
    style: 'update',
    refactor: 'refactor',
    perf: 'optimize',
    test: 'add',
    build: 'update',
    ci: 'update',
    chore: 'update',
    revert: 'revert'
  };
  return actions[type] || 'update';
}

function generateReasoning(
  fileAnalysis: Array<{
    file: string;
    finalType: string;
    ruleMatch: Rule | null;
    scope: string;
  }>,
  suggestedType: string,
  suggestedScope: string
): string {
  const reasons: string[] = [];
  
  fileAnalysis.slice(0, 3).forEach(analysis => {
    const fileName = analysis.file.substring(analysis.file.lastIndexOf('/') + 1);
    if (analysis.ruleMatch) {
      reasons.push(`${fileName}: ${analysis.ruleMatch.description}`);
    } else {
      reasons.push(`${fileName}: 基于文件扩展名判断为 ${analysis.finalType}`);
    }
  });

  if (fileAnalysis.length > 3) {
    reasons.push(`... 以及其他 ${fileAnalysis.length - 3} 个文件`);
  }

  reasons.push(`推荐类型: ${suggestedType}, 推荐范围: ${suggestedScope}`);
  
  return reasons.join('\n');
}

function capitalizeFirst(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
