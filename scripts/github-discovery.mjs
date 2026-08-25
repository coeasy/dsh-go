const API_BASE = 'https://api.github.com';
const SEARCH_DELAY = Number(process.env.REGISTRY_SEARCH_DELAY || (process.env.GITHUB_TOKEN ? 2200 : 6200));
const EARLIEST = new Date('2008-01-01T00:00:00Z');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const dayString = (date) => date.toISOString().slice(0, 10);

async function apiJson(path, token, retries = 4) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'dsh-go-complete-discovery',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  for (let attempt = 0; attempt < retries; attempt++) {
    const response = await fetch(`${API_BASE}${path}`, { headers, signal: AbortSignal.timeout(20000) });
    if (response.ok) return response.json();
    if ([403, 429, 500, 502, 503, 504].includes(response.status) && attempt < retries - 1) {
      const retryAfter = Number(response.headers.get('retry-after') || (response.status === 403 ? 60 : 3));
      await sleep(retryAfter * 1000);
      continue;
    }
    throw new Error(`GitHub Search API ${response.status}: ${path}`);
  }
  throw new Error(`GitHub Search API retries exhausted: ${path}`);
}

async function searchPage(query, page, token) {
  const path = `/search/repositories?q=${encodeURIComponent(query)}&per_page=100&page=${page}&sort=stars&order=desc`;
  const data = await apiJson(path, token);
  return { total: Number(data.total_count || 0), items: data.items || [] };
}

async function fetchCappedQuery(query, total, token) {
  const pages = Math.min(10, Math.ceil(total / 100));
  const items = [];
  for (let page = 1; page <= pages; page++) {
    if (page > 1) await sleep(SEARCH_DELAY);
    const result = await searchPage(query, page, token);
    items.push(...result.items);
    if (!result.items.length) break;
  }
  return items;
}

async function fetchCreatedRange(baseQuery, start, end, token, depth = 0) {
  const qualifier = `created:${dayString(start)}..${dayString(end)}`;
  const query = `${baseQuery} ${qualifier}`;
  const first = await searchPage(query, 1, token);
  if (first.total <= 1000) {
    const items = [...first.items];
    const pages = Math.min(10, Math.ceil(first.total / 100));
    for (let page = 2; page <= pages; page++) {
      await sleep(SEARCH_DELAY);
      const result = await searchPage(query, page, token);
      items.push(...result.items);
      if (!result.items.length) break;
    }
    return items;
  }

  const days = Math.floor((end.getTime() - start.getTime()) / 86400000);
  if (days <= 0 || depth >= 24) {
    throw new Error(`Cannot enumerate complete GitHub search range without truncation: ${query} total=${first.total}`);
  }

  const leftDays = Math.floor(days / 2);
  const mid = new Date(start.getTime() + leftDays * 86400000);
  const rightStart = new Date(mid.getTime() + 86400000);
  const left = await fetchCreatedRange(baseQuery, start, mid, token, depth + 1);
  await sleep(SEARCH_DELAY);
  const right = rightStart <= end ? await fetchCreatedRange(baseQuery, rightStart, end, token, depth + 1) : [];
  return [...left, ...right];
}

export async function discoverAllRepositories(baseQuery = 'topic:dsh-plugin', options = {}) {
  const token = options.token || process.env.GITHUB_TOKEN || '';
  const first = await searchPage(baseQuery, 1, token);
  let items;
  if (first.total <= 1000) {
    items = await fetchCappedQuery(baseQuery, first.total, token);
  } else {
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    items = await fetchCreatedRange(baseQuery, EARLIEST, tomorrow, token);
  }

  const unique = new Map();
  for (const repo of items) {
    if (repo?.full_name) unique.set(repo.full_name, repo);
  }
  if (unique.size < first.total) {
    const deficit = first.total - unique.size;
    const tolerance = Math.max(5, Math.ceil(first.total * 0.005));
    if (deficit > tolerance) {
      throw new Error(`Complete discovery deficit too large: expected about ${first.total}, got ${unique.size}`);
    }
  }
  return { repositories: [...unique.values()], reported_total: first.total };
}

export function discoveryRepoToLegacy(repo) {
  const topics = repo.topics || [];
  const topicSet = new Set(topics.map((topic) => String(topic).toLowerCase()));
  let category = 'other';
  if (topicSet.has('mcp') || topicSet.has('model-context-protocol')) category = 'mcp';
  else if (topicSet.has('skills') || topicSet.has('skill') || topicSet.has('dsh-skill')) category = 'skills';
  else if (topicSet.has('agent') || topicSet.has('multi-agent')) category = 'agent';
  else if (topicSet.has('desktop') || topicSet.has('tauri') || topicSet.has('electron')) category = 'desktop';
  else if (topicSet.has('web-ui') || topicSet.has('frontend') || topicSet.has('dashboard')) category = 'web-ui';
  else if (topicSet.has('terminal') || topicSet.has('cli')) category = 'terminal';
  else if (topicSet.has('theme')) category = 'theme';
  else if (topicSet.has('tool') || topicSet.has('tools')) category = 'tool';

  return {
    slug: repo.full_name.replace('/', '-'),
    name: repo.name,
    full_name: repo.full_name,
    description: repo.description || '',
    category,
    topics,
    tags: topics,
    stars: Number(repo.stargazers_count || 0),
    forks: Number(repo.forks_count || 0),
    watchers: Number(repo.watchers_count || 0),
    open_issues: Number(repo.open_issues_count || 0),
    created_at: repo.created_at || '',
    updated_at: repo.pushed_at || repo.updated_at || '',
    first_seen: new Date().toISOString(),
    trend_score: Number(repo.stargazers_count || 0),
    language: repo.language || '',
    license: repo.license?.spdx_id || '',
    install_cmd: `dsh plugin --profile tools add github:${repo.full_name}`,
    repo_url: repo.html_url || `https://github.com/${repo.full_name}`,
    homepage: repo.homepage || null,
    verified: true,
    manifest_file: null,
    has_readme: false,
    readme_excerpt: '',
    snapshot_commit: repo.default_branch || 'HEAD',
    rank: 0,
  };
}
