/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert';
import {rm, stat, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe, it} from 'node:test';

import {
  getPageMarkdown,
  getPageMarkdownBatch,
} from '../../src/tools/markdown.js';
import {html, withMcpContext} from '../utils.js';

describe('markdown', () => {
  describe('get_page_markdown', () => {
    it('extracts article content as markdown', async () => {
      await withMcpContext(async (response, context) => {
        const page = context.getSelectedPptrPage();
        await page.setContent(
          html`<html>
            <head><title>Test Article</title></head>
            <body>
              <article>
                <h1>Hello World</h1>
                <p>This is a <strong>test</strong> paragraph with a <a href="https://example.com">link</a>.</p>
                <ul>
                  <li>Item one</li>
                  <li>Item two</li>
                </ul>
              </article>
            </body>
          </html>`,
        );
        await getPageMarkdown.handler(
          {params: {}, page: context.getSelectedMcpPage()},
          response,
          context,
        );

        const text = response.responseLines.join('\n');
        // Readability downgrades h1→h2, adds its own page title as # heading
        assert.ok(text.includes('Hello World'));
        assert.ok(text.includes('**test**'));
        assert.ok(text.includes('[link](https://example.com/)'));
        assert.ok(text.includes('*   Item one'));
        assert.ok(text.includes('*   Item two'));
      });
    });

    it('falls back to full page when no article content found', async () => {
      await withMcpContext(async (response, context) => {
        const page = context.getSelectedPptrPage();
        await page.setContent(
          html`<html>
            <head><title>Fallback Page</title></head>
            <body><div>Just a simple non-article page.</div></body>
          </html>`,
        );
        await getPageMarkdown.handler(
          {params: {}, page: context.getSelectedMcpPage()},
          response,
          context,
        );

        const text = response.responseLines.join('\n');
        assert.ok(text.includes('Just a simple non-article page'));
      });
    });

    it('saves markdown to file when filePath is provided', async () => {
      await withMcpContext(async (response, context) => {
        const filePath = join(tmpdir(), 'test-page-markdown.md');
        try {
          const page = context.getSelectedPptrPage();
          await page.setContent(
            html`<html>
              <head><title>Save Test</title></head>
              <body><article><h1>Saved Content</h1><p>File output test.</p></article></body>
            </html>`,
          );
          await getPageMarkdown.handler(
            {params: {filePath}, page: context.getSelectedMcpPage()},
            response,
            context,
          );

          const text = response.responseLines.join('\n');
          assert.ok(text.includes('Saved to'));

          const fstat = await stat(filePath);
          assert.ok(fstat.isFile());
          assert.ok(fstat.size > 0);
        } finally {
          await rm(filePath, {force: true});
        }
      });
    });
  });

  describe('get_page_markdown_batch', () => {
    it('extracts multiple pages and saves to files', async () => {
      await withMcpContext(async (response, context) => {
        const page1 = context.getSelectedPptrPage();
        await page1.setContent(
          html`<html>
            <head><title>Page One</title></head>
            <body><article><h1>First</h1><p>Content of first page.</p></article></body>
          </html>`,
        );
        const page1Id = context.getSelectedMcpPage().id;

        const page2Mcp = await context.newPage();
        await page2Mcp.pptrPage.setContent(
          html`<html>
            <head><title>Page Two</title></head>
            <body><article><h1>Second</h1><p>Content of second page.</p></article></body>
          </html>`,
        );
        const page2Id = page2Mcp.id;

        const file1 = join(tmpdir(), 'batch-test-1.md');
        const file2 = join(tmpdir(), 'batch-test-2.md');
        try {
          await getPageMarkdownBatch.handler(
            {
              params: {
                pageIdList: [page1Id, page2Id],
                filePathList: [file1, file2],
              },
            },
            response,
            context,
          );

          // Check response contains JSON result
          const text = response.responseLines.join('\n');
          const parsed = JSON.parse(text);
          assert.equal(parsed.length, 2);
          assert.equal(parsed[0].pageId, page1Id);
          assert.equal(parsed[1].pageId, page2Id);

          // Check files exist and have content
          const content1 = await readFile(file1, 'utf-8');
          assert.ok(content1.includes('First'));
          assert.ok(content1.includes('Content of first page'));

          const content2 = await readFile(file2, 'utf-8');
          assert.ok(content2.includes('Second'));
          assert.ok(content2.includes('Content of second page'));
        } finally {
          await rm(file1, {force: true});
          await rm(file2, {force: true});
        }
      });
    });

    it('returns error when lengths do not match', async () => {
      await withMcpContext(async (response, context) => {
        await getPageMarkdownBatch.handler(
          {
            params: {
              pageIdList: [1, 2, 3],
              filePathList: ['single-file.md'],
            },
          },
          response,
          context,
        );

        const text = response.responseLines.join('\n');
        assert.ok(text.includes('Error'));
        assert.ok(text.includes('3'));
        assert.ok(text.includes('1'));
      });
    });
  });
});
