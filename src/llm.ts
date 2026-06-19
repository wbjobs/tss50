import axios from 'axios';
import { GitDiff, AnalysisResult, CommitType } from './types';

const OLLAMA_BASE_URL = 'http://localhost:11434';
const DEFAULT_MODEL = 'llama3.1:8b';
const DEFAULT_TIMEOUT = 30000;

const COMMIT_TYPES: CommitType[] = [
  'feat', 'fix', 'docs', 'style', 'refactor',
  'perf', 'test', 'build', 'ci', 'chore', 'revert'
];

export interface LLMOptions {
  baseUrl?: string;
  model?: string;
  timeout?: number;
}

export interface LLMResponse {
  type: CommitType;
  scope: string;
  subject: string;
  reasoning: string;
}

function buildPrompt(stagedDiffs: GitDiff[]): string {
  const diffSummary = stagedDiffs
    .slice(0, 10)
    .map(diff => {
      const truncatedDiff = diff.diff.length > 2000
        ? diff.diff.substring(0, 2000) + '...(truncated)'
        : diff.diff;
      return `File: ${diff.file} (Status: ${diff.status})\nDiff:\n${truncatedDiff}`;
    })
    .join('\n\n');

  const extraFiles = stagedDiffs.length > 10
    ? `\n\n... and ${stagedDiffs.length - 10} more files`
    : '';

  return `You are an expert at writing conventional commit messages. Analyze the following git diffs and generate a structured commit message.

Conventional Commit Format:
- type(scope): subject

Available types:
- feat: A new feature
- fix: A bug fix
- docs: Documentation only changes
- style: Changes that do not affect the meaning of the code (white-space, formatting, etc)
- refactor: A code change that neither fixes a bug nor adds a feature
- perf: A code change that improves performance
- test: Adding missing tests or correcting existing tests
- build: Changes that affect the build system or external dependencies
- ci: Changes to CI configuration files and scripts
- chore: Other changes that don't modify src or test files
- revert: Reverts a previous commit

Git diffs to analyze:
${diffSummary}${extraFiles}

Please respond with ONLY a JSON object in the following format (no markdown, no explanation text):
{
  "type": "feat",
  "scope": "core",
  "subject": "Brief description of the changes",
  "reasoning": "Why you chose this type and scope"
}

Rules:
1. Choose the most appropriate type from the list above
2. Scope should be a logical module name (e.g., "core", "ui", "backend", "config", or a specific component name)
3. Subject should be concise (under 50 characters), imperative, and lowercase except for proper nouns
4. Don't include a period at the end of the subject
`;
}

function parseLLMResponse(responseText: string): LLMResponse {
  try {
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }

    const parsed = JSON.parse(jsonMatch[0]);

    const type = COMMIT_TYPES.includes(parsed.type) ? parsed.type : 'chore';
    const scope = parsed.scope || 'general';
    const subject = (parsed.subject || 'update changes')
      .replace(/\.$/, '')
      .toLowerCase();
    const reasoning = parsed.reasoning || 'Based on LLM analysis';

    return { type, scope, subject, reasoning };
  } catch (error) {
    console.warn('Failed to parse LLM response, using fallback:', error);
    return {
      type: 'chore',
      scope: 'general',
      subject: 'update changes',
      reasoning: 'Fallback due to LLM response parsing error'
    };
  }
}

export async function isOllamaAvailable(options: LLMOptions = {}): Promise<boolean> {
  const baseUrl = options.baseUrl || OLLAMA_BASE_URL;
  const timeout = options.timeout || DEFAULT_TIMEOUT;

  try {
    const response = await axios.get(`${baseUrl}/api/tags`, { timeout });
    return response.status === 200;
  } catch {
    return false;
  }
}

export async function generateWithLLM(
  stagedDiffs: GitDiff[],
  options: LLMOptions = {}
): Promise<AnalysisResult | null> {
  const baseUrl = options.baseUrl || OLLAMA_BASE_URL;
  const model = options.model || DEFAULT_MODEL;
  const timeout = options.timeout || DEFAULT_TIMEOUT;

  try {
    const available = await isOllamaAvailable({ baseUrl, timeout });
    if (!available) {
      return null;
    }

    const prompt = buildPrompt(stagedDiffs);

    const response = await axios.post(
      `${baseUrl}/api/generate`,
      {
        model,
        prompt,
        stream: false,
        temperature: 0.2,
        top_p: 0.9
      },
      { timeout }
    );

    const responseText = response.data.response || response.data;
    const parsed = parseLLMResponse(responseText);

    return {
      suggestedType: parsed.type,
      suggestedScope: parsed.scope,
      suggestedSubject: parsed.subject.charAt(0).toUpperCase() + parsed.subject.slice(1),
      reasoning: `[LLM] ${parsed.reasoning}`
    };
  } catch (error) {
    console.warn('LLM generation failed:', (error as Error).message);
    return null;
  }
}
