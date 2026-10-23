import type { Root } from 'mdast';
import type { Plugin } from 'unified';
import type { Construct, State, Token } from 'micromark-util-types';
import { mathToMarkdown } from 'mdast-util-math';
import { visit } from 'unist-util-visit';
import 'remark-parse';
import 'remark-stringify';

declare module 'micromark-util-types' {
  interface TokenTypeMap {
    bracketMath: 'bracketMath';
    bracketMathMarker: 'bracketMathMarker';
    bracketMathData: 'bracketMathData';
  }
}

// Tokenize before Markdown escapes/emphasis can consume TeX. Code spans, fences,
// and dollar math keep their own tokenizer and are never rewritten by regex.
const bracketMath: Construct = {
  name: 'bracketMath',
  tokenize(effects, ok, nok) {
    let close: number;
    let slash: Token;
    const start: State = (code) => {
      effects.enter('bracketMath');
      effects.enter('bracketMathMarker');
      effects.consume(code);
      return opening;
    };
    const opening: State = (code) => {
      if (code !== 40 && code !== 91) return nok(code);
      close = code === 40 ? 41 : 93;
      effects.consume(code);
      effects.exit('bracketMathMarker');
      return inside;
    };
    const inside: State = (code) => {
      if (code === null) return nok(code);
      if (code === 92) {
        slash = effects.enter('bracketMathData');
        effects.consume(code);
        return afterSlash;
      }
      if (code < -2) {
        effects.enter('lineEnding');
        effects.consume(code);
        effects.exit('lineEnding');
        return inside;
      }
      effects.enter('bracketMathData');
      return data(code);
    };
    const data: State = (code) => {
      if (code === null || code === 92 || code < -2) {
        effects.exit('bracketMathData');
        return inside(code);
      }
      effects.consume(code);
      return data;
    };
    const afterSlash: State = (code) => {
      if (code === close) {
        slash.type = 'bracketMathMarker';
        effects.consume(code);
        effects.exit('bracketMathMarker');
        effects.exit('bracketMath');
        return ok;
      }
      if (code === 92) {
        effects.consume(code);
        effects.exit('bracketMathData');
        return inside;
      }
      effects.exit('bracketMathData');
      return inside(code);
    };
    return start;
  },
};

export const remarkBracketMath: Plugin<[], Root> = function () {
  const data = this.data();
  (data.micromarkExtensions ||= []).push({ text: { 92: bracketMath } });
  (data.fromMarkdownExtensions ||= []).push({
    enter: {
      bracketMath(token) {
        const display = this.sliceSerialize(token).startsWith('\\[');
        this.enter(
          {
            type: 'inlineMath',
            value: '',
            data: {
              hName: 'code',
              hProperties: {
                className: ['language-math', display ? 'math-display' : 'math-inline'],
              },
            },
          },
          token,
        );
        this.buffer();
      },
    },
    exit: {
      bracketMathData(token) {
        this.config.enter.data.call(this, token);
        this.config.exit.data.call(this, token);
      },
      bracketMath(token) {
        const value = this.resume();
        const node = this.stack[this.stack.length - 1];
        if (node.type !== 'inlineMath') throw new Error('Invalid math node');
        this.exit(token);
        node.value = value;
        node.data!.hChildren = [{ type: 'text', value }];
      },
    },
  });
  const inline = mathToMarkdown().handlers!.inlineMath!;
  (data.toMarkdownExtensions ||= []).push({
    handlers: {
      inlineMath(node, parent, state, info) {
        if (
          node.type === 'inlineMath' &&
          String(node.data?.hProperties?.className).includes('math-display')
        )
          return `\\[${node.value}\\]`;
        return inline(node, parent, state, info);
      },
    },
  });
  return (tree, file) => {
    const source = String(file);
    visit(tree, 'inlineMath', (node) => {
      const offset = node.position?.start.offset;
      if (offset !== undefined && source.slice(offset, offset + 2) === '$$') {
        node.data ||= {};
        node.data.hProperties = { className: ['language-math', 'math-display'] };
      }
    });
  };
};
