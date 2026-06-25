/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {JSDOM} from 'jsdom';
import {Readability} from '@mozilla/readability';
import TurndownService from 'turndown';

import type {Page} from '../third_party/index.js';
import {zod} from '../third_party/index.js';

import {ToolCategory} from './categories.js';
import {definePageTool, defineTool, type SupportedExtensions} from './ToolDefinition.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

interface MarkdownResult {
  markdown: string;
  title: string;
}

/**
 * Extract the main content from a page and convert it to Markdown.
 * Uses Mozilla Readability to identify the primary content,
 * then Turndown to convert HTML → Markdown.
 * Falls back to full-page conversion if Readability fails.
 */
async function generateMarkdown(page: Page): Promise<MarkdownResult> {
  const html = await page.evaluate(
    () => document.documentElement.outerHTML,
  );

  const dom = new JSDOM(html, {url: page.url()});
  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  const turndownService = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
  });

  let markdownBody: string;
  if (article?.content) {
    const articleDom = new JSDOM(article.content);
    markdownBody = turndownService.turndown(
      articleDom.window.document.body,
    );
  } else {
    markdownBody = turndownService.turndown(dom.window.document.body);
  }

  const title =
    article?.title ?? (await page.title())?.trim() ?? '';
  const markdown = title
    ? `# ${title}\n\n${markdownBody}`
    : markdownBody;

  return {markdown, title};
}

// ---------------------------------------------------------------------------
// get_page_markdown  (single page, page-scoped)
// ---------------------------------------------------------------------------

export const getPageMarkdown = definePageTool({
  name: 'get_page_markdown',
  description: `Extract the main content of the currently selected page as clean Markdown text, suitable for LLM reading.

This tool retrieves the full DOM from the page, uses Mozilla's Readability algorithm to identify and extract the primary content (article body, main text), and converts it to well-formatted Markdown.

The resulting Markdown is optimized for LLM consumption — it focuses on the meaningful textual content of the page, stripping away navigation, sidebars, footers, ads, and other non-essential elements.

If Readability cannot identify a clear "article" on the page (e.g., for SPAs, dashboards, or image-heavy pages), the tool falls back to converting the entire page body to Markdown.

Use this tool when you need to read and understand the text content of a web page.`,
  annotations: {
    category: ToolCategory.DEBUGGING,
    readOnlyHint: true,
  },
  schema: {
    filePath: zod
      .string()
      .optional()
      .describe(
        'The absolute or relative path to a file to save the markdown output to. If omitted, the markdown is returned inline in the response.',
      ),
  },
  blockedByDialog: false,
  verifyFilesSchema: ['filePath'],
  handler: async (request, response, context) => {
    const {filePath} = request.params;
    const page = request.page.pptrPage;

    const {markdown, title} = await generateMarkdown(page);

    const resultText = title
      ? `Extracted "${title}" as Markdown.`
      : 'Extracted page content as Markdown.';

    if (filePath) {
      const data = new TextEncoder().encode(markdown);
      const {filename} = await context.saveFile(
        data,
        filePath,
        '.md' as SupportedExtensions,
      );
      response.appendResponseLine(`${resultText} Saved to ${filename}.`);
    } else {
      response.appendResponseLine(resultText);
      response.appendResponseLine(markdown);
    }
  },
});

// ---------------------------------------------------------------------------
// get_page_markdown_batch  (multi-page, not page-scoped)
// ---------------------------------------------------------------------------

export const getPageMarkdownBatch = defineTool({
  name: 'get_page_markdown_batch',
  description: `Extract the main content of multiple pages as Markdown and save each to a file.

This tool iterates over a list of page IDs, selects each page in turn, extracts its main content as clean Markdown (using Mozilla's Readability algorithm + Turndown conversion), and saves each to the corresponding file path.

Use this tool when you need to download the content of multiple open pages at once. Each page is saved to its own Markdown file.`,
  annotations: {
    category: ToolCategory.DEBUGGING,
    readOnlyHint: true,
  },
  schema: {
    pageIdList: zod
      .array(zod.number().int().min(0))
      .describe(
        'List of page IDs to extract markdown from. Use list_pages to get available page IDs.',
      ),
    filePathList: zod
      .array(zod.string())
      .describe(
        'List of file paths to save each page\'s markdown to. Must have the same length as pageIdList. Each path corresponds to the page ID at the same index.',
      ),
  },
  blockedByDialog: false,
  verifyFilesSchema: [],
  handler: async (request, response, context) => {
    const {pageIdList, filePathList} = request.params;

    // Validate lengths match
    if (pageIdList.length !== filePathList.length) {
      response.appendResponseLine(
        `Error: pageIdList has ${pageIdList.length} items but filePathList has ${filePathList.length} items. The lengths must be equal so each page ID maps to exactly one file path.`,
      );
      return;
    }

    const results: Array<{pageId: number; filePath: string}> = [];

    for (let i = 0; i < pageIdList.length; i++) {
      const pageId = pageIdList[i];
      const filePath = filePathList[i];

      const mcpPage = context.getPageById(pageId);
      context.selectPage(mcpPage);

      const {markdown} = await generateMarkdown(mcpPage.pptrPage);

      const data = new TextEncoder().encode(markdown);
      const {filename} = await context.saveFile(
        data,
        filePath,
        '.md' as SupportedExtensions,
      );

      results.push({pageId, filePath: filename});
    }

    response.appendResponseLine(JSON.stringify(results, null, 2));
  },
});
