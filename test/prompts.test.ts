import * as fs from 'fs';
import * as path from 'path';
import { globSync } from 'glob';

import {
  loadPromptContents,
  maybeFilepath,
  readPrompts,
  readProviderPromptMap,
} from '../src/prompts';

import type { Prompt, UnifiedConfig } from '../src/types';

jest.mock('../src/esm');

jest.mock('proxy-agent', () => ({
  ProxyAgent: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('glob', () => ({
  globSync: jest.fn(),
}));

jest.mock('fs', () => ({
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  statSync: jest.fn(),
  readdirSync: jest.fn(),
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
}));
jest.mock('path', () => {
  const actual = jest.requireActual('path');
  return {
    ...actual,
    parse: jest.fn(actual.parse),
    join: jest.fn(actual.join),
  };
});

jest.mock('../src/database');

function toPrompt(text: string): Prompt {
  return { raw: text, label: text };
}

describe('prompts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('readPrompts', () => {
    it('with single prompt file', async () => {
      jest.mocked(fs.readFileSync).mockReturnValue('Test prompt 1\n---\nTest prompt 2');
      jest.mocked(fs.statSync).mockReturnValue({ isDirectory: () => false });
      const promptPaths = ['prompts.txt'];
      jest.mocked(globSync).mockImplementation((pathOrGlob) => [pathOrGlob]);

      const result = await readPrompts(promptPaths);

      expect(fs.readFileSync).toHaveBeenCalledTimes(1);
      expect(result).toEqual([toPrompt('Test prompt 1'), toPrompt('Test prompt 2')]);
    });

    it('with multiple prompt files', async () => {
      jest
        .mocked(fs.readFileSync)
        .mockReturnValueOnce('Test prompt 1')
        .mockReturnValueOnce('Test prompt 2');
      jest.mocked(fs.statSync).mockReturnValue({ isDirectory: () => false });
      const promptPaths = ['prompt1.txt', 'prompt2.txt'];
      jest.mocked(globSync).mockImplementation((pathOrGlob) => [pathOrGlob]);

      const result = await readPrompts(promptPaths);

      expect(fs.readFileSync).toHaveBeenCalledTimes(2);
      expect(result).toEqual([toPrompt('Test prompt 1'), toPrompt('Test prompt 2')]);
    });

    it('with directory', async () => {
      jest.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true });
      jest.mocked(globSync).mockImplementation((pathOrGlob) => [pathOrGlob]);
      jest.mocked(fs.readdirSync).mockReturnValue(['prompt1.txt', 'prompt2.txt']);
      jest.mocked(fs.readFileSync).mockImplementation((filePath) => {
        if (filePath.endsWith(path.join('prompts', 'prompt1.txt'))) {
          return 'Test prompt 1';
        } else if (filePath.endsWith(path.join('prompts', 'prompt2.txt'))) {
          return 'Test prompt 2';
        }
      });
      const promptPaths = ['prompts'];

      const result = await readPrompts(promptPaths);

      expect(fs.statSync).toHaveBeenCalledTimes(1);
      expect(fs.readdirSync).toHaveBeenCalledTimes(1);
      expect(fs.readFileSync).toHaveBeenCalledTimes(2);
      expect(result).toEqual([toPrompt('Test prompt 1'), toPrompt('Test prompt 2')]);
    });

    it('with empty input', async () => {
      jest.mocked(fs.readFileSync).mockReturnValue('');
      jest.mocked(fs.statSync).mockReturnValue({ isDirectory: () => false });
      const promptPaths = ['prompts.txt'];

      const result = await readPrompts(promptPaths);

      expect(fs.readFileSync).toHaveBeenCalledTimes(1);
      expect(result).toEqual([toPrompt('')]);
    });

    it('with map input', async () => {
      jest.mocked(fs.readFileSync).mockReturnValue('some raw text');
      jest.mocked(fs.statSync).mockReturnValue({ isDirectory: () => false });

      const result = await readPrompts({
        'prompts.txt': 'foo1',
        'prompts.py': 'foo2',
      });

      expect(fs.readFileSync).toHaveBeenCalledTimes(2);
      expect(result).toHaveLength(2);

      expect(result).toEqual([
        { raw: 'some raw text', label: 'foo1' },
        expect.objectContaining({ raw: 'some raw text', label: 'foo2' }),
      ]);
    });

    it('with JSONL file', async () => {
      const data = [
        [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: 'Who won the world series in {{ year }}?' },
        ],
        [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: 'Who won the superbowl in {{ year }}?' },
        ],
      ];

      jest.mocked(fs.readFileSync).mockReturnValue(data.map((o) => JSON.stringify(o)).join('\n'));
      jest.mocked(fs.statSync).mockReturnValue({ isDirectory: () => false });
      const promptPaths = ['prompts.jsonl'];

      const result = await readPrompts(promptPaths);

      expect(fs.readFileSync).toHaveBeenCalledTimes(1);
      expect(result).toEqual([
        toPrompt(JSON.stringify(data[0])),
        toPrompt(JSON.stringify(data[1])),
      ]);
    });

    it('with .py file', async () => {
      const code = `print('dummy prompt')`;
      jest.mocked(fs.readFileSync).mockReturnValue(code);
      const result = await readPrompts('prompt.py');
      expect(fs.readFileSync).toHaveBeenCalledTimes(1);
      expect(result[0].raw).toEqual(code);
      expect(result[0].label).toEqual(code);
      expect(result[0].function).toBeDefined();
    });

    it('with Prompt object array', async () => {
      const prompts = [
        { id: 'prompts.py:prompt1', label: 'First prompt' },
        { id: 'prompts.py:prompt2', label: 'Second prompt' },
      ];

      const code = `
def prompt1:
  return 'First prompt'
def prompt2:
  return 'Second prompt'
`;
      jest.mocked(fs.readFileSync).mockReturnValue(code);

      const result = await readPrompts(prompts);

      expect(fs.readFileSync).toHaveBeenCalledTimes(2);
      expect(result).toHaveLength(2);
      expect(result).toEqual([
        {
          raw: code,
          label: 'First prompt',
          function: expect.any(Function),
        },
        {
          raw: code,
          label: 'Second prompt',
          function: expect.any(Function),
        },
      ]);
    });

    it('readPrompts with .js file', async () => {
      jest.doMock(
        path.resolve('prompt.js'),
        () => {
          return jest.fn(() => console.log('dummy prompt'));
        },
        { virtual: true },
      );
      const result = await readPrompts('prompt.js');
      expect(result[0].function).toBeDefined();
    });

    it('readPrompts with glob pattern for .txt files', async () => {
      const fileContents: Record<string, string> = {
        '1.txt': 'First text file content',
        '2.txt': 'Second text file content',
      };

      jest.mocked(fs.readFileSync).mockImplementation((path: string) => {
        if (path.includes('1.txt')) {
          return fileContents['1.txt'];
        } else if (path.includes('2.txt')) {
          return fileContents['2.txt'];
        }
        throw new Error('Unexpected file path in test');
      });
      jest.mocked(fs.statSync).mockImplementation((path: string) => ({
        isDirectory: () => path.includes('prompts'),
      }));
      jest.mocked(fs.readdirSync).mockImplementation((path: string) => {
        if (path.includes('prompts')) {
          return ['prompt1.txt', 'prompt2.txt'];
        }
        throw new Error('Unexpected directory path in test');
      });

      const promptPaths = ['file://./prompts/*.txt'];

      const result = await readPrompts(promptPaths);

      expect(fs.readdirSync).toHaveBeenCalledTimes(1);
      expect(fs.readFileSync).toHaveBeenCalledTimes(2);
      expect(fs.statSync).toHaveBeenCalledTimes(1);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ raw: fileContents['1.txt'], label: fileContents['1.txt'] });
      expect(result[1]).toEqual({ raw: fileContents['2.txt'], label: fileContents['2.txt'] });
    });
  });

  describe('loadPromptContents', () => {
    const basePath = '/base/path';
    const promptPathInfo = { raw: 'rawPrompt', resolved: '/resolved/path/prompt.txt' };
    const forceLoadFromFile = new Set<string>();
    const resolvedPathToDisplay = new Map<string, string>();

    const mockedFs = fs as jest.Mocked<typeof fs>;
    const mockedPath = path as jest.Mocked<typeof path>;

    it('should load raw prompt if the path does not exist', async () => {
      mockedFs.statSync.mockImplementation(() => {
        throw new Error('File not found');
      });
      const result = await loadPromptContents(
        promptPathInfo,
        forceLoadFromFile,
        resolvedPathToDisplay,
        basePath,
      );
      expect(result).toEqual([{ raw: 'rawPrompt', label: 'rawPrompt' }]);
    });

    it('should handle directory prompts', async () => {
      mockedFs.statSync.mockReturnValue({ isDirectory: () => true } as fs.Stats);
      mockedFs.readdirSync.mockReturnValue(['file1.txt', 'file2.txt']);
      mockedFs.readFileSync.mockImplementation((filePath) => {
        if (filePath.includes('file1.txt')) return 'Content of file1';
        if (filePath.includes('file2.txt')) return 'Content of file2';
        return '';
      });
      mockedPath.join.mockImplementation((...args) => args.join('/'));

      const result = await loadPromptContents(
        promptPathInfo,
        forceLoadFromFile,
        resolvedPathToDisplay,
        basePath,
      );
      expect(result).toEqual([
        { raw: 'Content of file1', label: 'Content of file1' },
        { raw: 'Content of file2', label: 'Content of file2' },
      ]);
    });

    it('should handle JavaScript prompt files', async () => {
      mockedFs.statSync.mockReturnValue({ isDirectory: () => false } as fs.Stats);
      mockedPath.parse.mockReturnValue({
        base: 'prompt.js',
        dir: '/resolved/path',
        ext: '.js',
        name: 'prompt',
        root: '/',
      });
      jest.mock('/resolved/path/prompt.js', () => jest.fn(() => 'JS Prompt Content'), {
        virtual: true,
      });

      const result = await loadPromptContents(
        promptPathInfo,
        forceLoadFromFile,
        resolvedPathToDisplay,
        basePath,
      );
      expect(result[0].raw).toContain('JS Prompt Content');
      expect(result[0].function).toBeInstanceOf(Function);
    });

    it('should handle Python prompt files', async () => {
      mockedFs.statSync.mockReturnValue({ isDirectory: () => false } as fs.Stats);
      mockedFs.readFileSync.mockReturnValue('Python file content');
      mockedPath.parse.mockReturnValue({
        base: 'prompt.py',
        dir: '/resolved/path',
        ext: '.py',
        name: 'prompt',
        root: '/',
      });

      const result = await loadPromptContents(
        promptPathInfo,
        forceLoadFromFile,
        resolvedPathToDisplay,
        basePath,
      );
      expect(result[0].raw).toBe('Python file content');
      expect(result[0].function).toBeInstanceOf(Function);
    });

    it('should handle JSONL prompt files', async () => {
      mockedFs.statSync.mockReturnValue({ isDirectory: () => false } as fs.Stats);
      mockedFs.readFileSync.mockReturnValue('{"key1": "value1"}\n{"key2": "value2"}');
      mockedPath.parse.mockReturnValue({
        base: 'prompt.jsonl',
        dir: '/resolved/path',
        ext: '.jsonl',
        name: 'prompt',
        root: '/',
      });

      const result = await loadPromptContents(
        promptPathInfo,
        forceLoadFromFile,
        resolvedPathToDisplay,
        basePath,
      );
      expect(result).toEqual([
        { raw: '{"key1": "value1"}', label: '{"key1": "value1"}' },
        { raw: '{"key2": "value2"}', label: '{"key2": "value2"}' },
      ]);
    });

    it('should handle text prompt files', async () => {
      mockedFs.statSync.mockReturnValue({ isDirectory: () => false } as fs.Stats);
      mockedFs.readFileSync.mockReturnValue('Text file content');
      mockedPath.parse.mockReturnValue({
        base: 'prompt.txt',
        dir: '/resolved/path',
        ext: '.txt',
        name: 'prompt',
        root: '/',
      });

      const result = await loadPromptContents(
        promptPathInfo,
        forceLoadFromFile,
        resolvedPathToDisplay,
        basePath,
      );
      expect(result).toEqual([{ raw: 'Text file content', label: 'Text file content' }]);
    });

    it('should throw an error if no prompts are found in JSONL files', async () => {
      mockedFs.statSync.mockReturnValue({ isDirectory: () => false } as fs.Stats);
      mockedFs.readFileSync.mockReturnValue('');
      mockedPath.parse.mockReturnValue({
        base: 'prompt.jsonl',
        dir: '/resolved/path',
        ext: '.jsonl',
        name: 'prompt',
        root: '/',
      });

      await expect(
        loadPromptContents(promptPathInfo, forceLoadFromFile, resolvedPathToDisplay, basePath),
      ).rejects.toThrow(`There are no prompts in ${JSON.stringify(promptPathInfo)}`);
    });

    it('should throw an error if PROMPTFOO_STRICT_FILES is set and statSync throws an error', async () => {
      process.env.PROMPTFOO_STRICT_FILES = 'true';
      mockedFs.statSync.mockImplementation(() => {
        throw new Error('File not found');
      });

      await expect(
        loadPromptContents(promptPathInfo, forceLoadFromFile, resolvedPathToDisplay, basePath),
      ).rejects.toThrow('File not found');

      delete process.env.PROMPTFOO_STRICT_FILES;
    });
  });

  describe('readProviderPromptMap', () => {
    const samplePrompts: Prompt[] = [
      { raw: 'Raw content for Prompt 1', label: 'Prompt 1' },
      { raw: 'Raw content for Prompt 2', label: 'Prompt 2' },
    ];

    it('should return an empty map if config.providers is undefined', () => {
      const config: Partial<UnifiedConfig> = {};
      const result = readProviderPromptMap(config, samplePrompts);
      expect(result).toEqual({});
    });

    it('should return a map with provider string as key', () => {
      const config: Partial<UnifiedConfig> = { providers: 'provider1' };
      const result = readProviderPromptMap(config, samplePrompts);
      expect(result).toEqual({
        provider1: ['Prompt 1', 'Prompt 2'],
      });
    });

    it('should return a map with "Custom function" as key when providers is a function', () => {
      const config: Partial<UnifiedConfig> = {
        providers: () => Promise.resolve({ data: [] }),
      };
      const result = readProviderPromptMap(config, samplePrompts);
      expect(result).toEqual({
        'Custom function': ['Prompt 1', 'Prompt 2'],
      });
    });

    it('should return a map with provider objects as keys', () => {
      const config: Partial<UnifiedConfig> = {
        providers: [{ id: 'provider1', prompts: ['Custom Prompt 1'] }, { id: 'provider2' }],
      };
      const result = readProviderPromptMap(config, samplePrompts);
      expect(result).toEqual({
        provider1: ['Custom Prompt 1'],
        provider2: ['Prompt 1', 'Prompt 2'],
      });
    });

    it('should return a map with provider label if it exists', () => {
      const config: Partial<UnifiedConfig> = {
        providers: [{ id: 'provider1', label: 'label1', prompts: ['Custom Prompt 1'] }],
      };
      const result = readProviderPromptMap(config, samplePrompts);
      expect(result).toEqual({
        provider1: ['Custom Prompt 1'],
        label1: ['Custom Prompt 1'],
      });
    });

    it('should return a map with ProviderOptionsMap', () => {
      const config: Partial<UnifiedConfig> = {
        providers: [
          {
            provider1: { id: 'provider1', prompts: ['Custom Prompt 1'] },
          },
        ],
      };
      const result = readProviderPromptMap(config, samplePrompts);
      expect(result).toEqual({
        provider1: ['Custom Prompt 1'],
      });
    });

    it('should use allPrompts if provider prompts are not defined', () => {
      const config: Partial<UnifiedConfig> = {
        providers: [
          { id: 'provider1' },
          {
            provider2: { id: 'provider2' },
          },
        ],
      };
      const result = readProviderPromptMap(config, samplePrompts);
      expect(result).toEqual({
        provider1: ['Prompt 1', 'Prompt 2'],
        provider2: ['Prompt 1', 'Prompt 2'],
      });
    });
  });

  describe('maybeFilepath', () => {
    it('should return true for valid file paths', () => {
      expect(maybeFilepath('path/to/file.txt')).toBe(true);
      expect(maybeFilepath('C:\\path\\to\\file.txt')).toBe(true);
      expect(maybeFilepath('file.*')).toBe(true);
      expect(maybeFilepath('filename.ext')).toBe(true);
    });

    it('should return false for strings with new lines', () => {
      expect(maybeFilepath('path/to\nfile.txt')).toBe(false);
    });

    it('should return false for strings with "portkey://"', () => {
      expect(maybeFilepath('portkey://path/to/file.txt')).toBe(false);
    });

    it('should return false for strings with "langfuse://"', () => {
      expect(maybeFilepath('langfuse://path/to/file.txt')).toBe(false);
    });

    it('should return false for strings without file path indicators', () => {
      expect(maybeFilepath('justastring')).toBe(false);
      expect(maybeFilepath('anotherstring')).toBe(false);
      expect(maybeFilepath('stringwith.dotbutnotfile')).toBe(false);
    });

    it('should return true for strings with wildcard character', () => {
      expect(maybeFilepath('*.txt')).toBe(true);
      expect(maybeFilepath('path/to/*.txt')).toBe(true);
    });

    it('should return true for strings with file extension at the third or fourth last position', () => {
      expect(maybeFilepath('filename.e')).toBe(false);
      expect(maybeFilepath('file.ext')).toBe(true);
      expect(maybeFilepath('filename.ex')).toBe(true);
      expect(maybeFilepath('file.name.ext')).toBe(true);
    });
  });
});
