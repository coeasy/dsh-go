const API_BASE = 'https://api.github.com';
const GRAPHQL_URL = 'https://api.github.com/graphql';
const SEARCH_DELAY = Number(process.env.REGISTRY_SEARCH_DELAY || (process.env.GITHUB_TOKEN ? 2200 : 6200));
const GRAPHQL_DELAY = Number(process.env.REGISTRY_GRAPHQL_DELAY || 100);
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

async function graphqlJson(query, variables, token, retries = 5) {
  if (!token) throw new Error('GITHUB_TOKEN is required for complete topic pagination');
  for (let attempt = 0; attempt < retries; attempt++) {
    let response;
    try {
      response = await fetch(GRAPHQL_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'User-Agent': 'dsh-go-complete-discovery',
        },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(30000),
      });
    } catch (error) {
      if (attempt === retries - 1) throw error;
      await sleep(1000 * (attempt + 1));
      continue;
    }

    if ([403, 429, 500, 502, 503, 504].includes(response.status) && attempt < retries - 1) {
      const retryAfter = Number(response.headers.get('retry-after') || 0);
      await sleep(Math.max(retryAfter * 1000, 1500 * (attempt + 1)));
      continue;
    }
    if (!response.ok) throw new Error(`GitHub GraphQL HTTP ${response.status}`);

    const payload = await response.json();
    if (payload.errors?.length) {
      const rateLimited = payload.errors.some((error) => /rate limit|secondary rate/i.test(error.message || ''));
      if (rateLimited && attempt < retries - 1) {
        await sleep(3000 * (attempt + 1));
        continue;
      }
      throw new Error(`GitHub GraphQL error: ${payload.errors.map((error) => error.message).join('; ')}`);
    }
    if (!payload.data) throw new Error('GitHub GraphQL returned no data');
    return payload.data;
  }
  throw new Error('GitHub GraphQL retries exhausted');
}

const TOPIC_QUERY = `
query TopicRepositories($name: String!, $after: String) {
  topic(name: $name) {
    name
    repositories(first: 100, after: $after) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes {
        name
        nameWithOwner
        description
        stargazerCount
        forkCount
        createdAt
        updatedAt
        pushedAt
        url
        homepageUrl
        primaryLanguage { name }
        licenseInfo { spdxId }
        defaultBranchRef {
          name
          target { ... on Commit { oid } }
        }
      }
    }
  }
  rateLimit { remaining resetAt cost }
}`;

export async function discoverTopicRepositories(topicName = 'dsh-plugin', options = {}) {
  const token = options.token || process.env.GITHUB_TOKEN || '';
  if (!token) return null;

  const repositories = new Map();
  let cursor = null;
  let totalCount = null;
  let page = 0;

  while (true) {
    const data = await graphqlJson(TOPIC_QUERY, { name: topicName, after: cursor }, token);
    const connection = data.topic?.repositories;
    if (!connection) throw new Error(`GitHub topic not found or has no repository connection: ${topicName}`);
    if (totalCount === null) totalCount = Number(connection.totalCount || 0);

    for (const repo of connection.nodes || []) {
      if (repo?.nameWithOwner) repositories.set(repo.nameWithOwner, repo);
    }

    page += 1;
    if (page % 25 === 0 || !connection.pageInfo?.hasNextPage) {
      console.log(`[discovery] topic:${topicName} page=${page} unique=${repositories.size}/${totalCount} rate_remaining=${data.rateLimit?.remaining ?? 'n/a'}`);
    }

    if (!connection.pageInfo?.hasNextPage) break;
    const nextCursor = connection.pageInfo.endCursor;
    if (!nextCursor || nextCursor === cursor) throw new Error(`GitHub topic pagination cursor did not advance at page ${page}`);
    cursor = nextCursor;
    if (GRAPHQL_DELAY > 0) await sleep(GRAPHQL_DELAY);
  }

  const deficit = Math.max(0, Number(totalCount || 0) - repositories.size);
  const tolerance = Math.max(5, Math.ceil(Number(totalCount || 0) * 0.005));
  if (deficit > tolerance) {
    throw new Error(`Complete topic pagination deficit too large: reported=${totalCount}, unique=${repositories.size}`);
  }

  return { repositories: [...repositories.values()], reported_total: Number(totalCount || repositories.size), transport: 'graphql-topic' };
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
    throw new Error(`REST fallback cannot enumerate complete GitHub search range without truncation: ${query} total=${first.total}; use GITHUB_TOKEN for GraphQL topic pagination`);
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
  const topicMatch = /^topic:([A-Za-z0-9_.-]+)$/.exec(baseQuery.trim());
  if (topicMatch && token) {
    const graph = await discoverTopicRepositories(topicMatch[1], { token });
    if (graph) return graph;
  }

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
  for (const repo of items) if (repo?.full_name) unique.set(repo.full_name, repo);
  const deficit = first.total - unique.size;
  const tolerance = Math.max(5, Math.ceil(first.total * 0.005));
  if (deficit > tolerance) throw new Error(`Complete discovery deficit too large: expected about ${first.total}, got ${unique.size}`);
  return { repositories: [...unique.values()], reported_total: first.total, transport: 'rest-search' };
}

export function discoveryRepoToLegacy(repo) {
  const fullName = repo.nameWithOwner || repo.full_name || '';
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

  const defaultBranch = repo.defaultBranchRef?.name || repo.default_branch || 'HEAD';
  const discoveredCommit = repo.defaultBranchRef?.target?.oid || '';
  return {
    slug: fullName.replace('/', '-'),
    name: repo.name,
    full_name: fullName,
    description: repo.description || '',
    category,
    topics,
    tags: topics,
    stars: Number(repo.stargazerCount ?? repo.stargazers_count ?? 0),
    forks: Number(repo.forkCount ?? repo.forks_count ?? 0),
    watchers: Number(repo.watchers_count || 0),
    open_issues: Number(repo.open_issues_count || 0),
    created_at: repo.createdAt || repo.created_at || '',
    updated_at: repo.pushedAt || repo.pushed_at || repo.updatedAt || repo.updated_at || '',
    first_seen: new Date().toISOString(),
    trend_score: Number(repo.stargazerCount ?? repo.stargazers_count ?? 0),
    language: repo.primaryLanguage?.name || repo.language || '',
    license: repo.licenseInfo?.spdxId || repo.license?.spdx_id || '',
    install_cmd: `dsh plugin --profile tools add github:${fullName}`,
    repo_url: repo.url || repo.html_url || `https://github.com/${fullName}`,
    homepage: repo.homepageUrl || repo.homepage || null,
    verified: false,
    manifest_file: null,
    has_readme: false,
    readme_excerpt: '',
    snapshot_commit: discoveredCommit || defaultBranch,
    snapshot_ref: defaultBranch,
    rank: 0,
  };
}
