import * as inquirer from 'inquirer';
import { CommitType, CommitMessage, AnalysisResult } from './types';

const COMMIT_TYPES: Array<{ value: CommitType; name: string }> = [
  { value: 'feat', name: 'feat:     ✨ 新功能' },
  { value: 'fix', name: 'fix:      🐛 修复 bug' },
  { value: 'docs', name: 'docs:     📝 文档变更' },
  { value: 'style', name: 'style:    💄 代码格式（不影响代码运行）' },
  { value: 'refactor', name: 'refactor: ♻️  重构（既不新增功能也不修复 bug）' },
  { value: 'perf', name: 'perf:     ⚡️ 性能优化' },
  { value: 'test', name: 'test:     ✅ 测试相关' },
  { value: 'build', name: 'build:    📦 构建系统或外部依赖' },
  { value: 'ci', name: 'ci:       👷 CI/CD 配置' },
  { value: 'chore', name: 'chore:    🔧 其他变更（不修改源码或测试）' },
  { value: 'revert', name: 'revert:   ⏪ 回滚之前的提交' }
];

export interface PromptOptions {
  useLLM?: boolean;
}

export async function promptCommitMessage(
  analysis: AnalysisResult,
  options: PromptOptions = {}
): Promise<CommitMessage> {
  console.log('\n📊 分析结果:');
  console.log('─'.repeat(60));
  console.log(analysis.reasoning);
  console.log('─'.repeat(60));

  if (options.useLLM) {
    console.log('\n🤖 以上分析由 LLM 生成');
  } else {
    console.log('\n📋 以上分析由规则引擎生成');
  }

  console.log('\n💡 请确认或修改提交信息:\n');

  const answers = await inquirer.prompt([
    {
      type: 'list',
      name: 'type',
      message: '选择提交类型 (type):',
      choices: COMMIT_TYPES,
      default: analysis.suggestedType
    },
    {
      type: 'input',
      name: 'scope',
      message: '输入影响范围 (scope):',
      default: analysis.suggestedScope,
      validate: (input: string) => {
        if (input.length > 50) {
          return 'Scope 太长，请保持在 50 字符以内';
        }
        return true;
      }
    },
    {
      type: 'input',
      name: 'subject',
      message: '输入简短描述 (subject):',
      default: analysis.suggestedSubject,
      validate: (input: string) => {
        if (!input || input.trim().length === 0) {
          return 'Subject 不能为空';
        }
        if (input.length > 100) {
          return 'Subject 太长，请保持在 100 字符以内';
        }
        return true;
      }
    },
    {
      type: 'input',
      name: 'body',
      message: '输入详细描述 (body，可选，按回车跳过):',
      default: ''
    }
  ]);

  return {
    type: answers.type,
    scope: answers.scope || 'general',
    subject: answers.subject.trim(),
    body: answers.body.trim() || undefined
  };
}

export async function promptConfirm(message: string): Promise<boolean> {
  const answer = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirm',
      message,
      default: true
    }
  ]);
  return answer.confirm;
}

export async function promptSelect<T extends string>(
  message: string,
  choices: Array<{ value: T; name: string }>,
  defaultValue?: T
): Promise<T> {
  const answer = await inquirer.prompt([
    {
      type: 'list',
      name: 'selection',
      message,
      choices,
      default: defaultValue
    }
  ]);
  return answer.selection;
}

export function formatCommitMessage(commit: CommitMessage): string {
  const scope = commit.scope ? `(${commit.scope})` : '';
  const header = `${commit.type}${scope}: ${commit.subject}`;
  
  if (commit.body) {
    return `${header}\n\n${commit.body}`;
  }
  
  return header;
}
