/**
 * GEO helpers (Taiga #343): the machine-legible half of the site.
 *
 * Every value here comes from data already in the repo (page props, insight
 * frontmatter, public/ assets). No new marketing claims: no aggregateRating,
 * no offers, no invented human identity. docs/geo-policy.md has the policy.
 */

export const SITE_NAME = 'Anamata';

/**
 * JSON for a <script type="application/ld+json"> body. `<` becomes < so
 * no source string (title, author, ...) can close the script element; the
 * parsed value is unchanged.
 */
export function serializeJsonLd(data) {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

/**
 * schema.org graph for one page: Organization everywhere, WebSite on home,
 * Article on insight routes (fields straight from the collection entry).
 */
export function buildGraph({ site, isHome = false, post = null }) {
  const origin = new URL('/', site).href;
  const graph = [
    {
      '@type': 'Organization',
      name: SITE_NAME,
      url: origin,
      logo: new URL('/anamata-ai-logo.svg', origin).href,
    },
  ];
  if (isHome) graph.push({ '@type': 'WebSite', name: SITE_NAME, url: origin });
  if (post) {
    graph.push({
      '@type': 'Article',
      headline: post.title,
      description: post.description,
      datePublished: post.published.toISOString(),
      // draftedBy names the AI drafter; no Person type, no invented human.
      author: { name: post.draftedBy },
    });
  }
  return { '@context': 'https://schema.org', '@graph': graph };
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** Single-pass decode of the entities Astro's escaping emits. */
export function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (match, ref) => {
    if (ref[0] === '#') {
      const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return String.fromCodePoint(code);
    }
    return ENTITIES[ref.toLowerCase()] ?? match;
  });
}

/** <title> text and meta description of a rendered page. */
export function pageMeta(html) {
  const title = html.match(/<title>([\s\S]*?)<\/title>/i);
  const meta = html.match(/<meta\b[^>]*\bname=["']?description["']?[^>]*>/i);
  const content = meta && meta[0].match(/\bcontent=(?:"([^"]*)"|'([^']*)')/i);
  if (!title || !content) return null;
  return {
    title: decodeEntities(title[1]),
    description: decodeEntities(content[1] ?? content[2]),
  };
}

const byUrl = (a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0);
const line = ({ title, url, description }) => `- [${title}](${url}): ${description}`;

/** llmstxt.org shape: H1, one summary line, then Pages and Insights, each sorted by URL. */
export function llmsTxt({ summary, pages, insights }) {
  return [
    `# ${SITE_NAME}`,
    '',
    `> ${summary}`,
    '',
    '## Pages',
    '',
    ...[...pages].sort(byUrl).map(line),
    '',
    '## Insights',
    '',
    ...[...insights].sort(byUrl).map(line),
    '',
  ].join('\n');
}
