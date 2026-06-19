import * as fs from 'fs';
import * as path from 'path';
import { StorageData } from './types';

const STORAGE_FILE = '.smart-commit.json';

function getStoragePath(cwd: string = process.cwd()): string {
  return path.join(cwd, STORAGE_FILE);
}

function createDefaultData(): StorageData {
  return {
    lastCommitSha: '',
    lastCommitDate: '',
    lastCommitMessage: ''
  };
}

export async function readStorage(cwd?: string): Promise<StorageData> {
  const storagePath = getStoragePath(cwd);
  
  return new Promise((resolve) => {
    fs.readFile(storagePath, 'utf-8', (err, data) => {
      if (err) {
        if (err.code === 'ENOENT') {
          resolve(createDefaultData());
        } else {
          console.warn('Failed to read storage file:', err);
          resolve(createDefaultData());
        }
        return;
      }

      try {
        const parsed = JSON.parse(data);
        resolve({
          ...createDefaultData(),
          ...parsed
        });
      } catch (parseErr) {
        console.warn('Failed to parse storage file, using defaults:', parseErr);
        resolve(createDefaultData());
      }
    });
  });
}

export async function writeStorage(data: StorageData, cwd?: string): Promise<void> {
  const storagePath = getStoragePath(cwd);
  
  return new Promise((resolve, reject) => {
    const jsonData = JSON.stringify(data, null, 2);
    
    fs.writeFile(storagePath, jsonData, 'utf-8', (err) => {
      if (err) {
        console.warn('Failed to write storage file:', err);
        reject(err);
        return;
      }
      resolve();
    });
  });
}

export async function updateLastCommit(
  sha: string,
  message: string,
  date: string = new Date().toISOString(),
  cwd?: string
): Promise<StorageData> {
  const existing = await readStorage(cwd);
  const updated: StorageData = {
    ...existing,
    lastCommitSha: sha,
    lastCommitDate: date,
    lastCommitMessage: message
  };
  
  await writeStorage(updated, cwd);
  return updated;
}

export function getLastCommitSync(cwd?: string): StorageData {
  const storagePath = getStoragePath(cwd);
  
  try {
    const data = fs.readFileSync(storagePath, 'utf-8');
    const parsed = JSON.parse(data);
    return {
      ...createDefaultData(),
      ...parsed
    };
  } catch {
    return createDefaultData();
  }
}
