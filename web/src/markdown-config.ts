import type { PluggableList } from 'unified';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import remarkFlexibleMarkers from 'remark-flexible-markers';
import { remarkBracketMath } from '../../shared/markdown';
import { remarkToc } from './markdown-toc';
import { remarkAlerts } from './markdown-alerts';

export const markdownPlugins: PluggableList = [
  remarkGfm,
  remarkMath,
  remarkBracketMath,
  remarkFlexibleMarkers,
  remarkAlerts,
  remarkToc,
];
export const htmlPlugins: PluggableList = [
  [rehypeKatex, { trust: false, maxExpand: 1000, maxSize: 20 }],
];
