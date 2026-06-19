#!/usr/bin/env node

import { Command } from 'commander';
import { gitService } from './git';
import { analyzeChanges } from './rules';
import { generateWithLLM, isOllamaAvailable, LLMOptions } from './llm';
import { promptCommitMessage, promptConfirm, formatCommitMessage } from './prompts';
import { updateLastCommit, readStorage } from './storage';
import { CommitMessage, AnalysisResult, GitDiff } from './types';

const program = new Command();

program
  .name('smart-commit')
  .description('智能 Git 提交信息生成工具')
  .version('1.0.0');

program
  .option('--llm', '使用本地 LLM (Ollama) 生成提交信息')
  .option('--llm-model <model>', '指定 LLM 模型名称', 'llama3.1:8b')
  .option('--llm-url <url>', '指定 Ollama API 地址', 'http://localhost:11434')
  .option('--llm-timeout <ms>', 'LLM 请求超时时间（毫秒）', '30000')
  .option('--dry-run', '预览提交信息但不实际执行 commit')
  .option('--force', '跳过确认直接提交')
  .option('--last', '显示上次成功提交的信息')
  .parse(process.argv);

interface CLIOptions {
  llm?: boolean;
  llmModel?: string;
  llmUrl?: string;
  llmTimeout?: string;
  dryRun?: boolean;
  force?: boolean;
  last?: boolean;
}

async function showLastCommit(): Promise<void> {
  const storage = await readStorage();
  if (!storage.lastCommitSha) {
    console.log('ℹ️  暂无上次提交记录');
    return;
  }

  console.log('\n📋 上次成功提交记录:');
  console.log('─'.repeat(60));
  console.log(`SHA:     ${storage.lastCommitSha}`);
  console.log(`日期:    ${storage.lastCommitDate}`);
  console.log(`信息:    ${storage.lastCommitMessage}`);
  console.log('─'.repeat(60));
}

async function getAnalysis(stagedDiffs: GitDiff[], options: CLIOptions, cwd: string): Promise<{ analysis: AnalysisResult; usedLLM: boolean }> {
  if (options.llm) {
    const llmOptions: LLMOptions = {
      baseUrl: options.llmUrl,
      model: options.llmModel,
      timeout: parseInt(options.llmTimeout || '30000', 10)
    };

    const available = await isOllamaAvailable(llmOptions);
    if (!available) {
      console.log('⚠️  Ollama 不可用，将使用规则引擎分析');
      const analysis = analyzeChanges(stagedDiffs, cwd);
      return { analysis, usedLLM: false };
    }

    console.log('🤖 正在使用 LLM 分析变更...');
    const llmAnalysis = await generateWithLLM(stagedDiffs, llmOptions);
    
    if (llmAnalysis) {
      return { analysis: llmAnalysis, usedLLM: true };
    } else {
      console.log('⚠️  LLM 分析失败，将使用规则引擎分析');
      const analysis = analyzeChanges(stagedDiffs, cwd);
      return { analysis, usedLLM: false };
    }
  }

  console.log('📋 正在使用规则引擎分析变更...');
  const analysis = analyzeChanges(stagedDiffs, cwd);
  return { analysis, usedLLM: false };
}

async function displayStagedChanges(stagedDiffs: GitDiff[]): Promise<void> {
  console.log('\n📁 暂存区变更文件:');
  console.log('─'.repeat(60));

  const statusIcons: Record<string, string> = {
    added: '➕',
    modified: '✏️',
    deleted: '🗑️',
    renamed: '📝'
  };

  stagedDiffs.forEach(diff => {
    const icon = statusIcons[diff.status] || '📄';
    console.log(`  ${icon} ${diff.status.padEnd(8)} ${diff.file}`);
  });

  console.log('─'.repeat(60));
}

async function main(): Promise<void> {
  const options = program.opts<CLIOptions>();

  if (options.last) {
    await showLastCommit();
    return;
  }

  const isRepo = await gitService.checkGitRepo();
  if (!isRepo) {
    console.error('❌ 错误：当前目录不是 Git 仓库');
    process.exit(1);
  }

  const hasStaged = await gitService.hasStagedChanges();
  if (!hasStaged) {
    console.error('❌ 错误：暂存区没有文件，请先使用 git add 添加文件');
    console.log('💡 提示：运行 "git add <file>" 添加文件到暂存区');
    process.exit(1);
  }

  const gitStatus = await gitService.getStatus();
  await displayStagedChanges(gitStatus.staged);

  if (gitStatus.unstaged.length > 0 || gitStatus.untracked.length > 0) {
    console.log('ℹ️  注意: 存在未暂存或未跟踪的文件，这些文件不会被提交');
    if (gitStatus.unstaged.length > 0) {
      console.log(`   未暂存: ${gitStatus.unstaged.join(', ')}`);
    }
    if (gitStatus.untracked.length > 0) {
      console.log(`   未跟踪: ${gitStatus.untracked.join(', ')}`);
    }
    console.log();
  }

  const { analysis, usedLLM } = await getAnalysis(gitStatus.staged, options, gitService.getCwd());

  let commitMessage: CommitMessage;
  try {
    commitMessage = await promptCommitMessage(analysis, { useLLM: usedLLM });
  } catch (error) {
    console.error('❌ 用户取消了操作');
    process.exit(1);
  }

  const formattedMessage = formatCommitMessage(commitMessage);

  console.log('\n📝 生成的提交信息:');
  console.log('─'.repeat(60));
  console.log(formattedMessage);
  console.log('─'.repeat(60));

  if (options.dryRun) {
    console.log('\n🔍 预览模式：不会实际执行提交');
    return;
  }

  if (!options.force) {
    const confirmed = await promptConfirm('确认执行提交？');
    if (!confirmed) {
      console.log('❌ 已取消提交');
      return;
    }
  }

  try {
    console.log('\n⏳ 正在执行提交...');
    const commitSha = await gitService.commit(formattedMessage);
    
    console.log(`\n✅ 提交成功！`);
    console.log(`📌 SHA: ${commitSha}`);
    console.log(`📝 信息: ${formattedMessage.split('\n')[0]}`);

    const storage = await updateLastCommit(commitSha, formattedMessage);
    console.log(`\n💾 已保存提交记录到 .smart-commit.json`);
    console.log(`   下次使用 "smart-commit --last" 查看上次提交信息`);
  } catch (error) {
    console.error(`❌ 提交失败: ${(error as Error).message}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('❌ 发生错误:', error);
  process.exit(1);
});
