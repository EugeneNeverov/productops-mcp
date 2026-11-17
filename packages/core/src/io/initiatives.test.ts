import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Warning } from '../schemas/meta.js';
import { loadInitiatives, MAX_FILE_BYTES } from './initiatives.js';

let root: string;
let outside: string;
let warnings: Warning[];
const ctx = () => ({ allowedRoots: [root], warn: (w: Warning) => warnings.push(w) });
const file = (path: string, format?: 'csv' | 'json') => ({
  kind: 'file' as const,
  path,
  ...(format ? { format } : {}),
});

beforeAll(() => {
  const base = mkdtempSync(join(tmpdir(), 'po-io-'));
  root = join(base, 'data');
  outside = join(base, 'outside');
  mkdirSync(root);
  mkdirSync(outside);
  writeFileSync(join(outside, 'secret.csv'), 'id,title\nx,leak\n');
  writeFileSync(
    join(root, 'ok.csv'),
    '﻿id,title,team,reach,impact,confidence,effort,dependsOn,tags,mandatory,notes\n' +
      'a,"Alpha, with comma",Growth,1000,2,0.8,"1,5",b;c,x; y,yes,ignored\n' +
      'b,Beta,,10,1,1,1,,,0,\n' +
      'c,Gamma,,,,,,,,,\n',
  );
  writeFileSync(join(root, 'ok.json'), JSON.stringify({ items: [{ id: 'j', title: 'J', reach: 1 }] }));
  writeFileSync(join(root, 'bad.csv'), 'id,title,impact\na,A,7\nb,,1\n');
  writeFileSync(
    join(root, 'dupe.json'),
    JSON.stringify([
      { id: 'a', title: 'A' },
      { id: 'a', title: 'B' },
    ]),
  );
  writeFileSync(join(root, 'notes.txt'), 'id,title\na,A\n');
  writeFileSync(join(root, 'big.csv'), 'id,title\n' + 'x'.repeat(MAX_FILE_BYTES));
  writeFileSync(join(root, 'long.csv'), `id,title\na,${'t'.repeat(300)}\n`);
  try {
    symlinkSync(join(outside, 'secret.csv'), join(root, 'link.csv'));
  } catch {
    // Windows without symlink privilege: link.csv is then simply missing, which is refused too.
  }
});

describe('loadInitiatives from files', () => {
  it('parses CSV with BOM, quotes, lists, booleans, decimal commas and warns about unknown columns', () => {
    warnings = [];
    const items = loadInitiatives(file('ok.csv'), ctx());
    expect(items[0]).toMatchObject({
      id: 'a',
      title: 'Alpha, with comma',
      team: 'Growth',
      reach: 1000,
      impact: 2,
      effort: 1.5,
      dependsOn: ['b', 'c'],
      tags: ['x', 'y'],
      mandatory: true,
    });
    expect(items[1]).toMatchObject({ id: 'b', mandatory: false, dependsOn: [] });
    expect(items[2]).toEqual({ id: 'c', title: 'Gamma', tags: [], dependsOn: [], mandatory: false });
    expect(warnings).toEqual([{ code: 'UNKNOWN_COLUMNS', message: 'Ignored columns: notes' }]);
  });

  it('parses JSON as an array or {items}', () => {
    expect(loadInitiatives(file('ok.json'), ctx())[0]).toMatchObject({ id: 'j', reach: 1 });
  });

  it('reports every invalid row with its line number', () => {
    expect(() => loadInitiatives(file('bad.csv'), ctx())).toThrow(
      expect.objectContaining({
        code: 'FILE_PARSE_ERROR',
        details: {
          issues: [
            expect.objectContaining({ line: 2, path: 'impact' }),
            expect.objectContaining({ line: 3, path: 'title' }),
          ],
        },
      }),
    );
  });

  it('rejects duplicate ids', () => {
    expect(() => loadInitiatives(file('dupe.json'), ctx())).toThrow(
      expect.objectContaining({ code: 'VALIDATION_ERROR', details: { duplicateIds: ['a'] } }),
    );
  });

  it('truncates long titles with a warning', () => {
    warnings = [];
    const [item] = loadInitiatives(file('long.csv'), ctx());
    expect(item!.title).toHaveLength(200);
    expect(warnings[0]).toMatchObject({ code: 'TITLE_TRUNCATED', itemIds: ['a'] });
  });

  it.each([
    ['../outside/secret.csv', 'FILE_NOT_ALLOWED'],
    ['link.csv', 'FILE_NOT_ALLOWED'],
    ['notes.txt', 'FILE_NOT_ALLOWED'],
    ['missing.csv', 'FILE_NOT_ALLOWED'],
    ['.', 'FILE_NOT_ALLOWED'],
    ['big.csv', 'INPUT_TOO_LARGE'],
    ['ok.csv\0.json', 'FILE_NOT_ALLOWED'],
  ])('refuses %s with %s', (path, code) => {
    expect(() => loadInitiatives(file(path), ctx())).toThrow(expect.objectContaining({ code }));
  });

  it('refuses absolute paths outside the roots but accepts absolute paths inside', () => {
    expect(() => loadInitiatives(file(resolve(outside, 'secret.csv')), ctx())).toThrow(
      expect.objectContaining({ code: 'FILE_NOT_ALLOWED' }),
    );
    expect(loadInitiatives(file(resolve(root, 'ok.json')), ctx())).toHaveLength(1);
  });

  it('refuses everything when no roots are configured', () => {
    expect(() => loadInitiatives(file('ok.csv'), { allowedRoots: [], warn: () => {} })).toThrow(
      expect.objectContaining({ code: 'FILE_NOT_ALLOWED' }),
    );
  });

  it('reports an unknown demo dataset', () => {
    expect(() => loadInitiatives({ kind: 'demo', name: 'saas-roadmap' }, ctx())).toThrow(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    );
  });
});
