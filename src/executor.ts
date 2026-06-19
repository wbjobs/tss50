import { exec, execSync, spawn } from 'child_process';

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
  success: boolean;
}

export function executeCommand(
  command: string,
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    timeout?: number;
  } = {}
): ExecResult {
  try {
    const stdout = execSync(command, {
      cwd: options.cwd || process.cwd(),
      env: options.env || process.env,
      encoding: 'utf-8',
      timeout: options.timeout || 60000,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    return {
      stdout: stdout.trim(),
      stderr: '',
      code: 0,
      success: true
    };
  } catch (error: any) {
    return {
      stdout: error.stdout?.toString?.().trim() || '',
      stderr: error.stderr?.toString?.().trim() || error.message,
      code: error.status || 1,
      success: false
    };
  }
}

export function executeCommandAsync(
  command: string,
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    timeout?: number;
  } = {}
): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = exec(
      command,
      {
        cwd: options.cwd || process.cwd(),
        env: options.env || process.env,
        timeout: options.timeout || 60000
      },
      (error, stdout, stderr) => {
        resolve({
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          code: error?.code || 0,
          success: !error
        });
      }
    );
  });
}

export function runNpmVersion(
  version: string,
  options: {
    cwd?: string;
    noGitTagVersion?: boolean;
    message?: string;
  } = {}
): ExecResult {
  const args: string[] = ['version', version];

  if (options.noGitTagVersion) {
    args.push('--no-git-tag-version');
  }

  if (options.message) {
    args.push('-m', `"${options.message.replace(/"/g, '\\"')}"`);
  }

  return executeCommand(`npm ${args.join(' ')}`, {
    cwd: options.cwd
  });
}

export function runGitAdd(
  files: string[],
  options: {
    cwd?: string;
  } = {}
): ExecResult {
  const fileArgs = files.map(f => `"${f}"`).join(' ');
  return executeCommand(`git add ${fileArgs}`, {
    cwd: options.cwd
  });
}

export function runGitCommit(
  message: string,
  options: {
    cwd?: string;
    noVerify?: boolean;
  } = {}
): ExecResult {
  const args = ['commit', '-m', `"${message.replace(/"/g, '\\"')}"`];
  if (options.noVerify) {
    args.push('--no-verify');
  }
  return executeCommand(`git ${args.join(' ')}`, {
    cwd: options.cwd
  });
}

export function runGitPushTags(
  options: {
    cwd?: string;
    remote?: string;
  } = {}
): ExecResult {
  const remote = options.remote || 'origin';
  return executeCommand(`git push ${remote} --tags`, {
    cwd: options.cwd
  });
}

export function runGitPush(
  options: {
    cwd?: string;
    remote?: string;
    branch?: string;
  } = {}
): ExecResult {
  const remote = options.remote || 'origin';
  const args = ['push'];
  args.push(remote);
  if (options.branch) {
    args.push(options.branch);
  }
  return executeCommand(`git ${args.join(' ')}`, {
    cwd: options.cwd
  });
}
