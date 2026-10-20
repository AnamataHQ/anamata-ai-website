import { describe, it, expect } from 'vitest';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import fg from 'fast-glob';
import { parseHTML } from 'linkedom';
import YAML from 'yaml';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIST = path.join(ROOT, 'dist');
const read = (file) => readFileSync(file, 'utf8');
const ORIGIN = 'https://anamata.ai';

function contentPages(dist = DIST) {
  return fg.sync('**/*.html', { cwd: dist }).flatMap((file) => {
    const html = read(path.join(dist, file));
    if (file === '404.html' || /http-equiv=["']?refresh/i.test(html)) return [];
    const { document } = parseHTML(html);
    return [{
      file, document,
      title: document.querySelector('title').textContent,
      description: document.querySelector('meta[name="description"]').getAttribute('content'),
      url: `${ORIGIN}/${file.replace(/index\.html$/, '')}`,
    }];
  });
}

const byUrl = (a, b) => a.url < b.url ? -1 : a.url > b.url ? 1 : 0;
const entry = ({ title, url, description }) => `- [${title}](${url}): ${description}`;
function section(text, name) {
  expect(text.match(new RegExp(`^## ${name}$`, 'gm'))).toHaveLength(1);
  return text.split(`## ${name}\n`)[1].split('\n## ')[0].trim().split('\n');
}
function posts() {
  return fg.sync('**/*.md', { cwd: path.join(ROOT, 'src/content/insights') }).map((file) => {
    const raw = read(path.join(ROOT, 'src/content/insights', file));
    const data = YAML.parse(raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)[1]);
    return { ...data, url: `${ORIGIN}/insights/${file.replace(/\.md$/, '').toLowerCase().replace(/ /g, '-')}/` };
  });
}

describe('GEO build output', () => {
  it('publishes the home summary and every content page, sorted, without redirect stubs', () => {
    const text = read(path.join(DIST, 'llms.txt'));
    const pages = contentPages();
    expect(text.startsWith('# Anamata\n\n> ')).toBe(true);
    expect(text.split('\n')[2]).toBe(`> ${pages.find((p) => p.file === 'index.html').description}`);
    expect(section(text, 'Pages')).toEqual(pages.sort(byUrl).map(entry));
    expect(text).not.toMatch(/https:\/\/anamata\.ai\/(anna|approach|404)(?:\/|\.html|\))/);
    expect(section(text, 'Insights')).toEqual(posts().sort(byUrl).map(entry));
  });

  it('has one safe, exact JSON-LD graph per content page using existing metadata', () => {
    const articles = new Map(posts().map((post) => [post.url, post]));
    const pages = contentPages();
    expect(pages.length).toBeGreaterThan(0);
    for (const page of pages) {
      const blocks = page.document.querySelectorAll('script[type="application/ld+json"]');
      expect(blocks, page.url).toHaveLength(1);
      expect(blocks[0].textContent).not.toContain('<');
      const json = JSON.parse(blocks[0].textContent);
      expect(json['@context']).toBe('https://schema.org');
      const expected = [{ '@type': 'Organization', name: 'Anamata', url: `${ORIGIN}/`, logo: `${ORIGIN}/anamata-ai-logo.svg` }];
      if (page.file === 'index.html') {
        expected.push({ '@type': 'WebSite', name: 'Anamata', url: `${ORIGIN}/` });
      }
      const post = articles.get(page.url);
      if (post) expected.push({
        '@type': 'Article', headline: post.title, description: post.description,
        datePublished: new Date(post.published).toISOString(),
        author: { name: post.draftedBy },
      });
      expect(json['@graph'], page.url).toEqual(expected);
    }
  });

  it('explicitly allows the seven named crawlers and preserves the wildcard and sitemap', () => {
    const robots = read(path.join(DIST, 'robots.txt'));
    expect(robots).toBe(read(path.join(ROOT, 'public/robots.txt')));
    for (const agent of ['*', 'GPTBot', 'OAI-SearchBot', 'ClaudeBot', 'Claude-SearchBot', 'PerplexityBot', 'Google-Extended', 'Applebot-Extended']) {
      expect(robots).toContain(`User-agent: ${agent}\nAllow: /`);
    }
    expect(robots).toMatch(/^Sitemap: https:\/\/anamata\.ai\/sitemap-index\.xml$/m);
  });

  it('serializes script-closing strings as data without changing their values', async () => {
    const { serializeJsonLd } = await import('../src/lib/structured-data.mjs');
    const data = { title: '</script><script>alert("test")</script>', nested: { value: '<!-- & > \u2028' } };
    const serialized = serializeJsonLd(data);
    expect(serialized).not.toContain('<');
    expect(serialized).toContain('\\u003c/script>');
    const { document } = parseHTML(`<html><head><script type="application/ld+json">${serialized}</script></head></html>`);
    expect(document.querySelectorAll('script')).toHaveLength(1);
    expect(JSON.parse(document.querySelector('script').textContent)).toEqual(data);
  });

  it('discovers an added page and nested insight on a clean build and safely emits its author', () => {
    // An isolated project exercises the real collection loader without editing
    // source fixtures into the working tree or depending on pre-existing dist/.
    const fixture = mkdtempSync(path.join(tmpdir(), 'anamata-geo-'));
    try {
      for (const file of ['src', 'public', 'scripts', 'package.json', 'astro.config.mjs', 'design-tokens.json']) {
        cpSync(path.join(ROOT, file), path.join(fixture, file), { recursive: true });
      }
      symlinkSync(path.join(ROOT, 'node_modules'), path.join(fixture, 'node_modules'), 'dir');
      const gitDir = execFileSync('git', ['rev-parse', '--absolute-git-dir'], { cwd: ROOT, encoding: 'utf8' }).trim();
      writeFileSync(path.join(fixture, '.git'), `gitdir: ${gitDir}\n`);
      mkdirSync(path.join(fixture, 'src/content/insights/nested'), { recursive: true });
      const author = 'site agent </script><script>untrusted()</script>';
      writeFileSync(path.join(fixture, 'src/content/insights/nested/added-note.md'), `---\ntitle: Added field note\ndescription: Added collection description.\npublished: 2026-10-20\ndraftedBy: '${author}'\napprovedBy: E. Hulsman\nrecord: I999\n---\n\nFixture body.\n`);
      writeFileSync(path.join(fixture, 'src/pages/added-page.astro'), `---\nimport Base from '../layouts/Base.astro';\n---\n<Base title="Added &amp; discovered" description="A new &amp; existing-source description."><main><h1>Added page</h1></main></Base>\n`);
      execFileSync('npm', ['run', 'build'], { cwd: fixture, stdio: 'pipe', timeout: 60000 });
      const dist = path.join(fixture, 'dist');
      const text = read(path.join(dist, 'llms.txt'));
      expect(section(text, 'Pages')).toEqual(contentPages(dist).sort(byUrl).map(entry));
      expect(section(text, 'Insights')).toContain('- [Added field note](https://anamata.ai/insights/nested/added-note/): Added collection description.');
      const article = contentPages(dist).find((p) => p.url.endsWith('/nested/added-note/'));
      const blocks = article.document.querySelectorAll('script[type="application/ld+json"]');
      expect(blocks).toHaveLength(1);
      expect(blocks[0].textContent).not.toContain('<');
      expect(JSON.parse(blocks[0].textContent)['@graph'].find((node) => node['@type'] === 'Article').author.name).toBe(author);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  }, 90000);
});
