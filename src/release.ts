#!/usr/bin/env node

import { Command } from 'commander';
import * as inquirer from 'inquirer';
import { GitReleaseService } from './git-release';
import {
  getVersionFromPackageJson,
  parseCommitMessage,
  calculateNextVersion
} from './semver';
import {
  VersionBumpResult,
  BumpType,
  ParsedCommit,
  ReleaseOptions,
  PlatformConfig
} from './types';
import {
  generateChangelogEntry,
  formatEntryForMarkdown,
  readChangelogFile,
  prependChangelogEntry,
  writeChangelogFile,
  generateChangelogForRelease
} from './changelog';
import {
  createReleaseDraft,
  detectPlatformFromEnv
} from './platform';
import {
  runNpmVersion,
  runGitAdd,
  runGitCommit,
  runGitPushTags,
  runGitPush
} from './executor';

const program = new Command();

program
  .name('smart-release')
  .description('智能语义化版本发布工具 - 自动计算版本、生成 Changelog、创建 Release')
  .version('1.0.0');

program
  .option('--dry-run', '预览发布流程但不实际执行任何操作', false)
  .option('-b, --bump <type>', '指定版本升级类型: major|minor|patch|prerelease')
  .option('-p, --prerelease', '发布为预发布版本', false)
  .option('--preid <id>', '预发布版本标识符 (如 alpha, beta, rc)', 'alpha')
  .option('--skip-changelog', '跳过生成 CHANGELOG.md', false)
  .option('--skip-tags', '跳过推送 tag 到远程', false)
  .option('--skip-publish', '跳过创建平台 Release Draft', false)
  .option('--platform <type>', '指定发布平台: github|gitlab|none', 'github')
  .option('--token <token>', '平台 API Token (也可从环境变量 GITHUB_TOKEN / GITLAB_TOKEN 读取)')
  .option('--remote <name>', '远程仓库名称', 'origin')
  .option('--branch <name>', '要推送的分支名称 (默认当前分支)')
  .option('-y, --yes', '跳过确认直接执行', false)
  .option('-c, --cwd <path>', '工作目录', process.cwd())
  .parse(process.argv);

interface CLIOptions {
  dryRun?: boolean;
  bump?: string;
  prerelease?: boolean;
  preid?: string;
  skipChangelog?: boolean;
  skipTags?: boolean;
  skipPublish?: boolean;
  platform?: string;
  token?: string;
  remote?: string;
  branch?: string;
  yes?: boolean;
  cwd?: string;
}

interface ReleaseContext {
  cwd: string;
  gitService: GitReleaseService;
  currentVersion: string;
  commits: ParsedCommit[];
  latestTag?: { name: string; sha: string } | null;
  bumpResult: VersionBumpResult;
}

async function setupContext(options: CLIOptions): Promise<ReleaseContext> {
  const cwd = options.cwd || process.cwd();
  const gitService = new GitReleaseService(cwd);

  if (!gitService.checkGitRepo()) {
    console.error('❌ 错误：当前目录不是 Git 仓库');
    process.exit(1);
  }

  const currentVersion = getVersionFromPackageJson(cwd);
  if (!currentVersion) {
    console.error('❌ 错误：无法从 package.json 读取当前版本号');
    process.exit(1);
  }

  const latestTag = gitService.getLatestVersionTag();

  const commitLogs = latestTag
    ? gitService.getCommitLogs({ sinceTag: latestTag.name })
    : gitService.getCommitLogs({ maxCount: 100 });

  const commits = commitLogs.map(log =>
    parseCommitMessage(log.hash, log.date, log.message)
  );

  const bumpType = options.bump as BumpType | undefined;
  const bumpResult = calculateNextVersion(currentVersion, commits, {
    overrideBump: bumpType,
    isPrerelease: options.prerelease,
    prereleaseId: options.preid
  });

  return {
    cwd,
    gitService,
    currentVersion,
    commits,
    latestTag: latestTag ? { name: latestTag.name, sha: latestTag.sha } : null,
    bumpResult
  };
}

function displaySummary(ctx: ReleaseContext, options: CLIOptions): void {
  const { bumpResult, commits, latestTag } = ctx;

  console.log('\n📋 发布信息摘要');
  console.log('─'.repeat(60));

  console.log(`📦 当前版本:      ${bumpResult.currentVersion}`);
  console.log(`🚀 下一个版本:    ${bumpResult.nextVersion}`);
  console.log(`📈 升级类型:      ${bumpResult.bumpType}`);
  console.log(`📝 变更原因:      ${bumpResult.reason}`);
  console.log(`📝 待发布 Commits: ${commits.length} 个`);
  if (latestTag) {
    console.log(`🏷️  上一个 Tag:    ${latestTag.name}`);
  } else {
    console.log(`🏷️  上一个 Tag:    (首次发布)`);
  }
  console.log(`🌐 工作目录:      ${ctx.cwd}`);
  console.log();

  if (commits.length > 0) {
    console.log('📊 Commit 类型分布:');
    const typeCount: Record<string, number> = {};
    let breakingCount = 0;

    for (const c of commits) {
      const key = c.isBreakingChange ? 'BREAKING' : c.type;
      typeCount[key] = (typeCount[key] || 0) + 1;
      if (c.isBreakingChange) breakingCount++;
    }

    Object.entries(typeCount)
      .sort(([, a], [, b]) => b - a)
      .forEach(([type, count]) => {
        console.log(`   ${type.padEnd(12)} ${count}`);
      });
    console.log();
  }

  if (options.dryRun) {
    console.log('🔍 模式:          DRY RUN (不会实际执行)');
  }
  console.log('─'.repeat(60));
  console.log();
}

async function confirmRelease(message: string = '确认执行发布?'): Promise<boolean> {
  const answer = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirm',
      message,
      default: false
    }
  ]);
  return answer.confirm;
}

async function promptBumpType(currentBump: BumpType): Promise<BumpType> {
  const choices = [
    { value: 'major', name: 'major:     ⚠️  重大版本 (不兼容变更)' },
    { value: 'minor', name: 'minor:     ✨ 次要版本 (新功能)' },
    { value: 'patch', name: 'patch:     🐛 补丁版本 (修复/优化)' },
    { value: 'prerelease', name: 'prerelease: 🧪 预发布版本' },
    { value: 'none', name: 'none:      ❌ 取消发布' }
  ];

  const answer = await inquirer.prompt([
    {
      type: 'list',
      name: 'bump',
      message: '选择版本升级类型:',
      choices,
      default: currentBump
    }
  ]);

  return answer.bump as BumpType;
}

async function generateChangelog(
  ctx: ReleaseContext,
  options: CLIOptions
): Promise<{ changelogMarkdown: string; changelogEntry: string }> {
  const { bumpResult, commits, cwd } = ctx;
  const today = new Date().toISOString().split('T')[0];
  const entry = generateChangelogEntry(bumpResult.nextVersion, commits, today);
  const entryMarkdown = formatEntryForMarkdown(entry);

  console.log('📝 本次版本 Changelog:');
  console.log(entryMarkdown);

  let changelogMarkdown = entryMarkdown;
  if (!options.skipChangelog) {
    const existing = readChangelogFile(require('path').join(cwd, 'CHANGELOG.md'));
    const changelog = prependChangelogEntry(existing, entry);
    changelogMarkdown = changelog.raw;

    if (options.dryRun) {
      console.log(`ℹ️  [DRY RUN] 将写入 CHANGELOG.md (${changelog.raw.length} 字符)`);
    } else {
      writeChangelogFile(changelog, require('path').join(cwd, 'CHANGELOG.md'));
      console.log('✅ CHANGELOG.md 已更新');
    }
  } else {
    console.log('⏭️  已跳过生成 CHANGELOG.md');
  }

  return { changelogMarkdown, changelogEntry: entryMarkdown };
}

async function updateVersionAndCommit(
  ctx: ReleaseContext,
  changelogEntry: string,
  options: CLIOptions
): Promise<boolean> {
  const { bumpResult, cwd } = ctx;
  const tagVersion = `v${bumpResult.nextVersion}`;
  const commitMsg = `chore(release): ${tagVersion}\n\n${changelogEntry}`;

  if (options.dryRun) {
    console.log(`ℹ️  [DRY RUN] 将执行: npm version ${bumpResult.bumpType} (或 patch)`);
    console.log(`ℹ️  [DRY RUN] 将执行: git add CHANGELOG.md package.json package-lock.json`);
    console.log(`ℹ️  [DRY RUN] 将执行: git commit -m "chore(release): ${tagVersion}"`);
    return true;
  }

  if (!options.skipChangelog) {
    const addResult = runGitAdd(['CHANGELOG.md'], { cwd });
    if (!addResult.success) {
      console.warn(`⚠️  添加 CHANGELOG.md 到暂存区失败: ${addResult.stderr}`);
    }
  }

  const npmVersionResult = runNpmVersion(bumpResult.nextVersion, {
    cwd,
    message: commitMsg
  });

  if (!npmVersionResult.success) {
    console.error(`❌ npm version 执行失败: ${npmVersionResult.stderr}`);
    return false;
  }

  console.log(`✅ 版本已更新到 ${bumpResult.nextVersion}`);
  console.log(`✅ 已创建提交和标签: ${tagVersion}`);
  return true;
}

async function pushToRemote(
  ctx: ReleaseContext,
  options: CLIOptions
): Promise<boolean> {
  const { gitService, bumpResult } = ctx;
  const remote = options.remote || 'origin';
  const branch = options.branch || gitService.getCurrentBranch();

  if (options.skipTags) {
    console.log('⏭️  已跳过推送 tags');
    return true;
  }

  if (options.dryRun) {
    console.log(`ℹ️  [DRY RUN] 将执行: git push ${remote} ${branch}`);
    console.log(`ℹ️  [DRY RUN] 将执行: git push ${remote} --tags`);
    return true;
  }

  console.log(`⏳ 正在推送 ${branch} 到 ${remote}...`);
  const pushResult = runGitPush({ cwd: ctx.cwd, remote, branch });
  if (!pushResult.success) {
    console.error(`❌ 推送分支失败: ${pushResult.stderr}`);
    return false;
  }
  console.log('✅ 分支推送成功');

  console.log(`⏳ 正在推送 tags 到 ${remote}...`);
  const tagsResult = runGitPushTags({ cwd: ctx.cwd, remote });
  if (!tagsResult.success) {
    console.error(`❌ 推送 tags 失败: ${tagsResult.stderr}`);
    return false;
  }
  console.log('✅ Tags 推送成功');

  return true;
}

async function createPlatformRelease(
  ctx: ReleaseContext,
  changelogEntry: string,
  options: CLIOptions
): Promise<void> {
  const { bumpResult } = ctx;

  if (options.skipPublish) {
    console.log('⏭️  已跳过创建平台 Release');
    return;
  }

  const platformConfig: PlatformConfig = detectPlatformFromEnv();

  if (options.token) {
    platformConfig.token = options.token;
  }

  if (options.platform === 'none' || platformConfig.type === 'none') {
    console.log('ℹ️  未配置发布平台，跳过 Release 创建');
    return;
  }

  if (options.platform && options.platform !== 'none') {
    platformConfig.type = options.platform as any;
  }

  if (!platformConfig.token) {
    const envHint = platformConfig.type === 'github'
      ? 'GITHUB_TOKEN'
      : 'GITLAB_TOKEN';
    console.warn(`⚠️  未检测到 ${envHint}，跳过 Release 创建`);
    console.log(`   提示: 可通过 --token 参数或环境变量 ${envHint} 设置`);
    return;
  }

  const inferredInfo = ctx.gitService.inferPlatformInfo();
  if (inferredInfo.type !== 'none') {
    if (!platformConfig.owner) platformConfig.owner = inferredInfo.owner;
    if (!platformConfig.repo) platformConfig.repo = inferredInfo.repo;
  }

  const tagName = `v${bumpResult.nextVersion}`;
  const draft = {
    tagName,
    name: `Release ${tagName}`,
    body: changelogEntry,
    draft: true,
    prerelease: bumpResult.bumpType === 'prerelease' || !!options.prerelease
  };

  console.log(`\n🚀 正在创建 ${platformConfig.type} Release Draft...`);
  console.log(`   Tag: ${tagName}`);

  if (options.dryRun) {
    console.log(`ℹ️  [DRY RUN] 将创建 ${platformConfig.type} Release Draft`);
    return;
  }

  const result = await createReleaseDraft(draft, platformConfig);

  if (result.success && result.url) {
    console.log(`✅ Release Draft 创建成功: ${result.url}`);
  } else {
    console.error(`❌ Release Draft 创建失败: ${result.error}`);
  }
}

async function checkPrerequisites(ctx: ReleaseContext, options: CLIOptions): Promise<boolean> {
  const { gitService, bumpResult } = ctx;

  if (!gitService.isCleanWorkingTree()) {
    console.error('❌ 工作区有未提交的变更，请先 commit 或 stash');
    const answer = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'continue',
        message: '工作区不洁净，是否继续?',
        default: false
      }
    ]);
    if (!answer.continue) return false;
  }

  if (bumpResult.bumpType === 'none') {
    console.warn('⚠️  检测到无需升级版本 (bump type = none)');
    const answer = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'continue',
        message: '是否继续手动选择版本类型?',
        default: true
      }
    ]);
    if (!answer.continue) return false;

    const newBump = await promptBumpType('patch');
    if (newBump === 'none') return false;

    ctx.bumpResult = calculateNextVersion(ctx.currentVersion, ctx.commits, {
      overrideBump: newBump,
      isPrerelease: options.prerelease,
      prereleaseId: options.preid
    });
  }

  return true;
}

async function main(): Promise<void> {
  const options = program.opts<CLIOptions>();

  console.log('🚀 Smart Release - 智能发布工具');
  console.log(`   Node.js ${process.version}`);
  console.log();

  let ctx = await setupContext(options);

  if (!await checkPrerequisites(ctx, options)) {
    console.log('❌ 发布已取消');
    return;
  }

  if (options.bump && options.bump !== ctx.bumpResult.bumpType) {
    const newBump = options.bump as BumpType;
    ctx.bumpResult = calculateNextVersion(ctx.currentVersion, ctx.commits, {
      overrideBump: newBump,
      isPrerelease: options.prerelease,
      prereleaseId: options.preid
    });
  }

  displaySummary(ctx, options);

  if (!options.yes) {
    const confirmed = await confirmRelease(
      `确认从 ${ctx.bumpResult.currentVersion} 升级到 ${ctx.bumpResult.nextVersion}?`
    );
    if (!confirmed) {
      console.log('❌ 发布已取消');
      return;
    }
  }

  console.log('\n📦 === 步骤 1: 生成 Changelog ===');
  const { changelogEntry } = await generateChangelog(ctx, options);

  console.log('\n📝 === 步骤 2: 更新版本并提交 ===');
  const versionUpdated = await updateVersionAndCommit(ctx, changelogEntry, options);
  if (!versionUpdated) {
    console.error('❌ 版本更新失败，终止发布');
    process.exit(1);
  }

  console.log('\n🔼 === 步骤 3: 推送到远程 ===');
  const pushed = await pushToRemote(ctx, options);
  if (!pushed) {
    console.error('❌ 推送失败，请手动完成后续操作');
    process.exit(1);
  }

  if (!options.skipPublish) {
    console.log('\n🌐 === 步骤 4: 创建平台 Release ===');
    await createPlatformRelease(ctx, changelogEntry, options);
  }

  console.log('\n🎉 === 发布完成 ===');
  console.log(`✅ 版本: ${ctx.bumpResult.currentVersion} → ${ctx.bumpResult.nextVersion}`);
  console.log(`✅ 标签: v${ctx.bumpResult.nextVersion}`);
  if (!options.dryRun) {
    console.log(`✅ 包含 ${ctx.commits.length} 个提交`);
  } else {
    console.log(`ℹ️  以上为预览，未实际执行任何操作`);
  }
  console.log();
}

main().catch((error) => {
  console.error('\n❌ 发布过程中发生错误:', error.message || error);
  if (error.stack) {
    console.error(error.stack);
  }
  process.exit(1);
});
