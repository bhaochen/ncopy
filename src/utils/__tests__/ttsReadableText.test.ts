import { describe, it, expect } from 'vitest';
import { ttsReadableText } from '../ttsReadableText';

describe('ttsReadableText', () => {
  it('passes plain prose through unchanged', () => {
    expect(ttsReadableText('Hello, this is plain text.')).toBe(
      'Hello, this is plain text.',
    );
  });

  it('drops fenced code blocks entirely', () => {
    const md = 'Before\n```ts\nconst x = 1;\n```\nAfter';
    expect(ttsReadableText(md)).toBe('Before After');
  });

  it('keeps inline code content and drops the backticks', () => {
    expect(ttsReadableText('run `npm install` to start')).toBe(
      'run npm install to start',
    );
  });

  it('keeps link labels and drops URLs', () => {
    expect(
      ttsReadableText('Read the [docs](https://example.com/page) today'),
    ).toBe('Read the docs today');
  });

  it('drops images wholesale (before link handling)', () => {
    expect(
      ttsReadableText('See ![diagram](https://example.com/d.png) for details'),
    ).toBe('See for details');
  });

  it('strips bold, italic, and strikethrough markers', () => {
    expect(ttsReadableText('**bold** and *italic* and ~~gone~~ text')).toBe(
      'bold and italic and gone text',
    );
  });

  it('strips heading markers', () => {
    expect(ttsReadableText('# Title\n\n## Subtitle')).toBe('Title Subtitle');
  });

  it('strips blockquote markers', () => {
    expect(ttsReadableText('> quoted line\n> second line')).toBe(
      'quoted line second line',
    );
  });

  it('strips bullet and numbered list markers', () => {
    expect(ttsReadableText('- one\n* two\n3. three')).toBe('one two three');
  });

  it('turns table pipes into spaces', () => {
    expect(ttsReadableText('a | b | c')).toBe('a b c');
  });

  it('collapses newlines and runs of whitespace to single spaces', () => {
    expect(ttsReadableText('Line one\n\n  Line two\t\tindented')).toBe(
      'Line one Line two indented',
    );
  });

  it('trims leading and trailing whitespace', () => {
    expect(ttsReadableText('   padded   ')).toBe('padded');
  });

  it('returns empty string for empty input', () => {
    expect(ttsReadableText('')).toBe('');
  });

  it('returns empty string for formatting-only input', () => {
    expect(ttsReadableText('```js\nconsole.log(1);\n```')).toBe('');
    expect(ttsReadableText('**  **')).toBe('');
  });

  it('handles a realistic mixed reply', () => {
    const md = [
      '# Summary',
      '',
      'The fix is in **App.tsx**. Run `bun run dev`, then check the [commit](https://github.com/x/y/commit/z).',
      '',
      '> Note: voice is on.',
      '',
      '- Step one',
      '- Step two',
    ].join('\n');
    expect(ttsReadableText(md)).toBe(
      'Summary The fix is in App.tsx. Run bun run dev, then check the commit. Note: voice is on. Step one Step two',
    );
  });
});
