import { describe, it, expect } from 'vitest';
import { removeComments } from '../../src/ui/codeEditor.js';

describe('removeComments', () => {
  it('removes full-line // comments', () => {
    expect(removeComments('// hello\nbox(1,1,1);')).toBe('box(1,1,1);');
  });

  it('removes trailing // comments but keeps strings', () => {
    expect(removeComments('param x = 5; // width\ns = "a//b";')).toBe('param x = 5;\ns = "a//b";');
  });

  it('drops blank lines left after stripping', () => {
    expect(removeComments('a;\n\n// gone\nb;')).toBe('a;\nb;');
  });

  it('returns unchanged text when there are no comments', () => {
    const src = 'param phoneT = 8.9;\nbox(1,2,3);';
    expect(removeComments(src)).toBe(src);
  });
});