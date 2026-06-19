import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

export interface WorkspacePackage {
  name: string;
  path: string;
  absPath: string;
}

export interface MonorepoInfo {
  type: 'pnpm' | 'lerna' | 'npm' | null;
  rootDir: string;
  packages: WorkspacePackage[];
}

export function toPosixPath(filePath: string): string {
  return filePath.split(path.sep).join('/');
}

export function normalizePath(filePath: string): string {
  return toPosixPath(path.normalize(filePath));
}

export function isPathInside(parent: string, child: string): boolean {
  const parentNorm = normalizePath(parent).replace(/\/$/, '');
  const childNorm = normalizePath(child).replace(/\/$/, '');
  if (parentNorm === childNorm) return true;
  return childNorm.startsWith(parentNorm + '/');
}

export function findMonorepoRoot(startDir: string): string | null {
  let currentDir = path.resolve(startDir);
  const maxDepth = 10;
  let depth = 0;

  while (depth < maxDepth) {
    const markers = [
      'pnpm-workspace.yaml',
      'lerna.json',
      'pnpm-workspace.yml'
    ];

    for (const marker of markers) {
      const markerPath = path.join(currentDir, marker);
      if (fs.existsSync(markerPath)) {
        return currentDir;
      }
    }

    const pkgJsonPath = path.join(currentDir, 'package.json');
    if (fs.existsSync(pkgJsonPath)) {
      try {
        const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
        if (pkgJson.workspaces && (Array.isArray(pkgJson.workspaces) || pkgJson.workspaces.packages)) {
          return currentDir;
        }
      } catch {
        // ignore parse error
      }
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
    depth++;
  }

  return null;
}

export function detectMonorepoType(rootDir: string): 'pnpm' | 'lerna' | 'npm' | null {
  const pnpmWorkspace = path.join(rootDir, 'pnpm-workspace.yaml');
  if (fs.existsSync(pnpmWorkspace) || fs.existsSync(path.join(rootDir, 'pnpm-workspace.yml'))) {
    return 'pnpm';
  }

  const lernaJson = path.join(rootDir, 'lerna.json');
  if (fs.existsSync(lernaJson)) {
    return 'lerna';
  }

  const pkgJsonPath = path.join(rootDir, 'package.json');
  if (fs.existsSync(pkgJsonPath)) {
    try {
      const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
      if (pkgJson.workspaces) {
        return 'npm';
      }
    } catch {
      // ignore
    }
  }

  return null;
}

function expandGlobPatterns(rootDir: string, patterns: string[]): string[] {
  const result: string[] = [];

  for (const pattern of patterns) {
    if (pattern.startsWith('!')) {
      continue;
    }

    if (pattern.indexOf('*') === -1) {
      const exactPath = path.join(rootDir, pattern);
      if (fs.existsSync(exactPath) && fs.statSync(exactPath).isDirectory()) {
        if (fs.existsSync(path.join(exactPath, 'package.json'))) {
          if (!result.includes(exactPath)) {
            result.push(exactPath);
          }
        }
      }
      continue;
    }

    if (pattern.endsWith('/*')) {
      const parentDir = pattern.slice(0, -2);
      const searchDir = path.join(rootDir, parentDir);

      if (fs.existsSync(searchDir) && fs.statSync(searchDir).isDirectory()) {
        const entries = fs.readdirSync(searchDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && entry.name !== 'node_modules') {
            const dirPath = path.join(searchDir, entry.name);
            if (fs.existsSync(path.join(dirPath, 'package.json'))) {
              if (!result.includes(dirPath)) {
                result.push(dirPath);
              }
            }
          }
        }
      }
      continue;
    }

    if (pattern.endsWith('/**')) {
      const baseDir = pattern.slice(0, -3);
      const searchDir = path.join(rootDir, baseDir);

      if (fs.existsSync(searchDir) && fs.statSync(searchDir).isDirectory()) {
        const walk = (dir: string) => {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isDirectory() && entry.name !== 'node_modules') {
              const dirPath = path.join(dir, entry.name);
              if (fs.existsSync(path.join(dirPath, 'package.json'))) {
                if (!result.includes(dirPath)) {
                  result.push(dirPath);
                }
              }
              walk(dirPath);
            }
          }
        };
        walk(searchDir);
      }
      continue;
    }

    const globStarIdx = pattern.indexOf('/**/*');
    if (globStarIdx !== -1) {
      const baseDir = pattern.slice(0, globStarIdx);
      const searchDir = path.join(rootDir, baseDir);

      if (fs.existsSync(searchDir) && fs.statSync(searchDir).isDirectory()) {
        const walk = (dir: string) => {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isDirectory() && entry.name !== 'node_modules') {
              const dirPath = path.join(dir, entry.name);
              if (fs.existsSync(path.join(dirPath, 'package.json'))) {
                if (!result.includes(dirPath)) {
                  result.push(dirPath);
                }
              }
              walk(dirPath);
            }
          }
        };
        walk(searchDir);
      }
      continue;
    }

    const lastSlashIdx = pattern.lastIndexOf('/');
    if (lastSlashIdx !== -1) {
      const parentDir = pattern.slice(0, lastSlashIdx);
      const filePattern = pattern.slice(lastSlashIdx + 1).replace(/\*/g, '');
      const searchDir = path.join(rootDir, parentDir);

      if (fs.existsSync(searchDir) && fs.statSync(searchDir).isDirectory()) {
        const entries = fs.readdirSync(searchDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && entry.name.startsWith(filePattern) && entry.name !== 'node_modules') {
            const dirPath = path.join(searchDir, entry.name);
            if (fs.existsSync(path.join(dirPath, 'package.json'))) {
              if (!result.includes(dirPath)) {
                result.push(dirPath);
              }
            }
          }
        }
      }
    }
  }

  return result;
}

function readPackageName(packageDir: string): string | null {
  const pkgJsonPath = path.join(packageDir, 'package.json');
  if (!fs.existsSync(pkgJsonPath)) {
    return null;
  }
  try {
    const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
    return pkgJson.name || null;
  } catch {
    return null;
  }
}

function parsePnpmWorkspaces(rootDir: string): string[] {
  const yamlPath = path.join(rootDir, 'pnpm-workspace.yaml');
  const ymlPath = path.join(rootDir, 'pnpm-workspace.yml');
  const filePath = fs.existsSync(yamlPath) ? yamlPath : (fs.existsSync(ymlPath) ? ymlPath : null);
  
  if (!filePath) return [];

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const config = yaml.load(content) as { packages?: string[] };
    
    if (config && config.packages && Array.isArray(config.packages)) {
      return expandGlobPatterns(rootDir, config.packages);
    }
    return [];
  } catch (error) {
    console.warn('Failed to parse pnpm-workspace.yaml:', error);
    return [];
  }
}

function parseLernaWorkspaces(rootDir: string): string[] {
  const lernaJsonPath = path.join(rootDir, 'lerna.json');
  if (!fs.existsSync(lernaJsonPath)) return [];

  try {
    const content = fs.readFileSync(lernaJsonPath, 'utf-8');
    const config = JSON.parse(content);
    
    if (config.packages && Array.isArray(config.packages)) {
      return expandGlobPatterns(rootDir, config.packages);
    }
    return [];
  } catch (error) {
    console.warn('Failed to parse lerna.json:', error);
    return [];
  }
}

function parseNpmWorkspaces(rootDir: string): string[] {
  const pkgJsonPath = path.join(rootDir, 'package.json');
  if (!fs.existsSync(pkgJsonPath)) return [];

  try {
    const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
    let packages: string[] = [];

    if (Array.isArray(pkgJson.workspaces)) {
      packages = pkgJson.workspaces;
    } else if (pkgJson.workspaces && Array.isArray(pkgJson.workspaces.packages)) {
      packages = pkgJson.workspaces.packages;
    }

    return expandGlobPatterns(rootDir, packages);
  } catch (error) {
    console.warn('Failed to parse npm workspaces:', error);
    return [];
  }
}

export function discoverPackages(rootDir: string, type: 'pnpm' | 'lerna' | 'npm'): WorkspacePackage[] {
  let packageDirs: string[] = [];

  switch (type) {
    case 'pnpm':
      packageDirs = parsePnpmWorkspaces(rootDir);
      break;
    case 'lerna':
      packageDirs = parseLernaWorkspaces(rootDir);
      break;
    case 'npm':
      packageDirs = parseNpmWorkspaces(rootDir);
      break;
  }

  const packages: WorkspacePackage[] = [];

  for (const dir of packageDirs) {
    const absPath = path.resolve(dir);
    const name = readPackageName(absPath);
    
    if (name) {
      packages.push({
        name,
        path: toPosixPath(path.relative(rootDir, absPath)),
        absPath: toPosixPath(absPath)
      });
    }
  }

  packages.sort((a, b) => b.path.length - a.path.length);

  return packages;
}

let cachedMonorepoInfo: MonorepoInfo | null = null;
let cachedCheckDir: string | null = null;

export function getMonorepoInfo(cwd: string = process.cwd()): MonorepoInfo | null {
  const checkDir = path.resolve(cwd);
  
  if (cachedCheckDir === checkDir && cachedMonorepoInfo) {
    return cachedMonorepoInfo;
  }

  cachedCheckDir = checkDir;
  const rootDir = findMonorepoRoot(checkDir);

  if (!rootDir) {
    cachedMonorepoInfo = null;
    return null;
  }

  const type = detectMonorepoType(rootDir);
  if (!type) {
    cachedMonorepoInfo = null;
    return null;
  }

  const packages = discoverPackages(rootDir, type);

  cachedMonorepoInfo = {
    type,
    rootDir: toPosixPath(rootDir),
    packages
  };

  return cachedMonorepoInfo;
}

export function matchPackageForFile(
  filePath: string,
  monorepoInfo: MonorepoInfo
): WorkspacePackage | null {
  const absFilePath = toPosixPath(path.resolve(filePath));
  
  for (const pkg of monorepoInfo.packages) {
    if (isPathInside(pkg.absPath, absFilePath)) {
      return pkg;
    }
  }

  return null;
}

export function getPackageScope(filePath: string, cwd: string = process.cwd()): string | null {
  const monorepoInfo = getMonorepoInfo(cwd);
  if (!monorepoInfo || monorepoInfo.packages.length === 0) {
    return null;
  }

  const absFilePath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(cwd, filePath);

  const matchedPkg = matchPackageForFile(absFilePath, monorepoInfo);

  if (matchedPkg) {
    return matchedPkg.name;
  }

  return null;
}
