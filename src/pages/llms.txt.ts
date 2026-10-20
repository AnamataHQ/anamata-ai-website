/**
 * /llms.txt (llmstxt.org) — generated at build time, never hand-maintained.
 *
 * Pages: every source page under src/pages (dynamic routes expanded through
 * their own getStaticPaths), rendered with the Astro container so the title
 * and meta description are exactly what the built HTML carries. Config
 * redirects (/approach, /anna) are not source pages, so their stubs never
 * appear. Insights: the `insights` collection, from frontmatter.
 */
import type { APIRoute } from 'astro';
import { experimental_AstroContainer } from 'astro/container';
import { getCollection } from 'astro:content';
import { llmsTxt, pageMeta } from '../lib/structured-data.mjs';

type PageModule = {
  default: any;
  getStaticPaths?: () => Promise<{ params: Record<string, string | undefined>; props?: Record<string, unknown> }[]>;
};

const modules = import.meta.glob<PageModule>('./**/*.astro');

const isErrorPage = (route: string) => route === '/404/' || route === '/500/';

/** './insights/[...slug].astro' → ['insights', '[...slug]'] (index dropped). */
function segments(file: string): string[] | null {
  const parts = file.replace(/^\.\//, '').replace(/\.astro$/, '').split('/');
  if (parts.some((p) => p.startsWith('_'))) return null; // Astro ignores _-prefixed routes
  if (parts[parts.length - 1] === 'index') parts.pop();
  return parts;
}

function toRoute(parts: string[], params: Record<string, string | undefined> = {}): string {
  const path = parts
    .map((part) => part.replace(/\[(?:\.\.\.)?([^\]]+)\]/g, (_, name) => params[name] ?? ''))
    .filter(Boolean)
    .join('/');
  return path ? `/${path}/` : '/';
}

export const GET: APIRoute = async ({ site }) => {
  if (!site) throw new Error('llms.txt needs `site` in astro.config.mjs');
  const container = await experimental_AstroContainer.create({ astroConfig: { site: site.href } });

  const pages: { title: string; url: string; description: string }[] = [];
  let summary: string | undefined;
  for (const [file, load] of Object.entries(modules)) {
    const parts = segments(file);
    if (!parts) continue;
    const mod = await load();
    const instances = parts.some((p) => p.startsWith('['))
      ? await mod.getStaticPaths!()
      : [{ params: {}, props: {} }];
    for (const { params, props } of instances) {
      const route = toRoute(parts, params);
      if (isErrorPage(route)) continue;
      const url = new URL(route, site).href;
      const html = await container.renderToString(mod.default, {
        params,
        props,
        request: new Request(url),
      });
      if (/http-equiv=["']?refresh/i.test(html)) continue;
      const meta = pageMeta(html);
      if (!meta) throw new Error(`llms.txt: ${file} (${route}) has no <title> or meta description`);
      pages.push({ ...meta, url });
      if (route === '/') summary = meta.description;
    }
  }
  if (!summary) throw new Error('llms.txt: home page meta description not found');

  const insights = (await getCollection('insights')).map((post) => ({
    title: post.data.title,
    url: new URL(`/insights/${post.id}/`, site).href,
    description: post.data.description,
  }));

  return new Response(llmsTxt({ summary, pages, insights }), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
