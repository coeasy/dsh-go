import { canonicalRepoKey, canonicalRepoUrl, discoveryRepoId, discoveryTopics, makeInstallCmd, normalizeHttpUrl } from './repository-identity.mjs';

const API_BASE = 'https://api.github.com';
const GRAPHQL_URL = 'https://api.github.com/graphql';
const SEARCH_DELAY = Number(process.env.REGISTRY_SEARCH_DELAY || (process.env.GITHUB_TOKEN ? 2200 : 6200));
const GRAPHQL_DELAY = Number(process.env.REGISTRY_GRAPHQL_DELAY || 100);
const GRAPHQL_PAGE_SIZE = Math.min(100, Math.max(10, Number(process.env.REGISTRY_GRAPHQL_PAGE_SIZE || 50)));
const MAX_TOPIC_PAGES = 1_000;
const EARLIEST = new Date('2008-01-01T00:00:00Z');
const MAX_REPOSITORY_SIZE_KB = 2147483647;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const dayString = (date) => date.toISOString().slice(0, 10);

export function nextGraphqlPageSize(size) {
  const current = Math.min(100, Math.max(10, Number(size || 10)));
  if (current <= 10) return 10;
  return Math.max(10, Math.floor(current / 2));
}

async function apiJson(path, token, retries = 4) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'dsh-go-complete-discovery',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  for (let attempt = 0; attempt < retries; attempt++) {
    let response;
    try {
      response = await fetch(`${API_BASE}${path}`, { headers, signal: AbortSignal.timeout(20000) });
    } catch (error) {
      if (attempt === retries - 1) throw error;
      await sleep(1000 * (attempt + 1));
      continue;
    }
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
        signal: AbortSignal.timeout(60000),
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

    let payload;
    try {
      payload = await response.json();
    } catch (error) {
      if (attempt === retries - 1) throw error;
      await sleep(1000 * (attempt + 1));
      continue;
    }
    if (payload.errors?.length) {
      const retryable = payload.errors.some((error) => /rate limit|secondary rate|timeout|temporar|server|terminated/i.test(error.message || ''));
      if (retryable && attempt < retries - 1) {
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

// Keep complete-discovery payload focused on identity and classification fields.
// Legacy sync already enriches the observed subset with subscriber/open-issue counts.
const TOPIC_QUERY = `
query TopicRepositories($name: String!, $after: String, $pageSize: Int!) {
  topic(name: $name) {
    name
    repositories(first: $pageSize, after: $after) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes {
        databaseId
        name
        nameWithOwner
        description
        isArchived
        isDisabled
        stargazerCount
        forkCount
        repositoryTopics(first: 20) { nodes { topic { name } } }
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
  let pageSize = Math.min(100, Math.max(10, Number(options.pageSize || GRAPHQL_PAGE_SIZE)));

  const repositories = new Map();
  let cursor = null;
  let totalCount = null;
  let page = 0;

  while (true) {
    let data;
    try {
      data = await graphqlJson(TOPIC_QUERY, { name: topicName, after: cursor, pageSize }, token);
    } catch (error) {
      const smaller = nextGraphqlPageSize(pageSize);
      if (smaller < pageSize) {
        console.warn(`[discovery] topic:${topicName} page=${page + 1} failed at page_size=${pageSize} (${error.message}); retrying same cursor with page_size=${smaller}`);
        pageSize = smaller;
        await sleep(Math.max(GRAPHQL_DELAY, 250));
        continue;
      }
      throw error;
    }

    const connection = data.topic?.repositories;
    if (!connection) throw new Error(`GitHub topic not found or has no repository connection: ${topicName}`);
    if (totalCount === null) totalCount = Number(connection.totalCount || 0);

    for (const repo of connection.nodes || []) {
      if (repo?.nameWithOwner) repositories.set(String(discoveryRepoId(repo) || canonicalRepoKey(repo.nameWithOwner)), repo);
    }

    page += 1;
    if (page >= MAX_TOPIC_PAGES && connection.pageInfo?.hasNextPage) {
      throw new Error(`GitHub topic pagination exceeded safety limit of ${MAX_TOPIC_PAGES} pages`);
    }
    if (page % 25 === 0 || !connection.pageInfo?.hasNextPage) {
      console.log(`[discovery] topic:${topicName} page=${page} page_size=${pageSize} unique=${repositories.size}/${totalCount} rate_remaining=${data.rateLimit?.remaining ?? 'n/a'}`);
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

async function searchPage(query, page, token, sort = 'stars') {
  const path = `/search/repositories?q=${encodeURIComponent(query)}&per_page=100&page=${page}&sort=${encodeURIComponent(sort)}&order=desc`;
  const data = await apiJson(path, token);
  return { total: Number(data.total_count || 0), items: data.items || [] };
}

async function collectSearchPages(query, first, token, sort = 'stars') {
  const items = [...first.items];
  const pages = Math.min(10, Math.ceil(first.total / 100));
  for (let page = 2; page <= pages; page++) {
    await sleep(SEARCH_DELAY);
    const result = await searchPage(query, page, token, sort);
    items.push(...result.items);
    if (!result.items.length) break;
  }
  return items;
}

async function fetchCappedQuery(query, total, token, sort = 'stars') {
  const first = await searchPage(query, 1, token, sort);
  if (total > 1000 || first.total > 1000) throw new Error(`fetchCappedQuery received uncapped query: ${query}`);
  return collectSearchPages(query, first, token, sort);
}

async function fetchNumericPartition(baseQuery, qualifier, min, max, token, sort, nextDimension, depth = 0) {
  const query = `${baseQuery} ${qualifier}:${min}..${max}`;
  const first = await searchPage(query, 1, token, sort);
  if (first.total <= 1000) return collectSearchPages(query, first, token, sort);
  if (depth >= 48) throw new Error(`REST fallback numeric partition exceeded recursion limit: ${query} total=${first.total}`);

  if (min < max) {
    const mid = min + Math.floor((max - min) / 2);
    const left = await fetchNumericPartition(baseQuery, qualifier, min, mid, token, sort, nextDimension, depth + 1);
    await sleep(SEARCH_DELAY);
    const right = await fetchNumericPartition(baseQuery, qualifier, mid + 1, max, token, sort, nextDimension, depth + 1);
    return [...left, ...right];
  }

  if (nextDimension === 'forks') return fetchDenseForkPartition(`${baseQuery} ${qualifier}:${min}`, token, depth + 1);
  if (nextDimension === 'size') return fetchDenseSizePartition(`${baseQuery} ${qualifier}:${min}`, token, depth + 1);
  throw new Error(`REST fallback cannot enumerate exact dense bucket without truncation: ${query} total=${first.total}`);
}

async function fetchDenseSizePartition(baseQuery, token, depth = 0) {
  return fetchNumericPartition(baseQuery, 'size', 0, MAX_REPOSITORY_SIZE_KB, token, 'stars', null, depth);
}

async function fetchDenseForkPartition(baseQuery, token, depth = 0) {
  const first = await searchPage(baseQuery, 1, token, 'forks');
  if (first.total <= 1000) return collectSearchPages(baseQuery, first, token, 'forks');
  const maxForks = Math.max(0, Number(first.items?.[0]?.forks_count || 0));
  return fetchNumericPartition(baseQuery, 'forks', 0, maxForks, token, 'forks', 'size', depth);
}

async function fetchDenseDay(baseQuery, day, token, depth = 0) {
  const dayQuery = `${baseQuery} created:${day}`;
  const first = await searchPage(dayQuery, 1, token, 'stars');
  if (first.total <= 1000) return collectSearchPages(dayQuery, first, token, 'stars');
  const maxStars = Math.max(0, Number(first.items?.[0]?.stargazers_count || 0));
  console.warn(`[discovery] dense single-day search bucket ${dayQuery} total=${first.total}; partitioning by stars/forks/size`);
  return fetchNumericPartition(dayQuery, 'stars', 0, maxStars, token, 'stars', 'forks', depth);
}

async function fetchCreatedRange(baseQuery, start, end, token, depth = 0) {
  const qualifier = `created:${dayString(start)}..${dayString(end)}`;
  const query = `${baseQuery} ${qualifier}`;
  const first = await searchPage(query, 1, token);
  if (first.total <= 1000) return collectSearchPages(query, first, token);

  const days = Math.floor((end.getTime() - start.getTime()) / 86400000);
  if (days <= 0) return fetchDenseDay(baseQuery, dayString(start), token, depth + 1);
  if (depth >= 32) throw new Error(`REST fallback date partition exceeded recursion limit: ${query} total=${first.total}`);

  const leftDays = Math.floor(days / 2);
  const mid = new Date(start.getTime() + leftDays * 86400000);
  const rightStart = new Date(mid.getTime() + 86400000);
  const left = await fetchCreatedRange(baseQuery, start, mid, token, depth + 1);
  await sleep(SEARCH_DELAY);
  const right = rightStart <= end ? await fetchCreatedRange(baseQuery, rightStart, end, token, depth + 1) : [];
  return [...left, ...right];
}

async function discoverViaRest(baseQuery, token) {
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
  for (const repo of items) if (repo?.full_name) unique.set(String(discoveryRepoId(repo) || canonicalRepoKey(repo.full_name)), repo);
  const deficit = first.total - unique.size;
  const tolerance = Math.max(5, Math.ceil(first.total * 0.005));
  if (deficit > tolerance) throw new Error(`Complete discovery deficit too large: expected about ${first.total}, got ${unique.size}`);
  return { repositories: [...unique.values()], reported_total: first.total, transport: 'rest-created-dense-range' };
}

export async function discoverAllRepositories(baseQuery = 'topic:dsh-plugin', options = {}) {
  const token = options.token || process.env.GITHUB_TOKEN || '';
  const topicMatch = /^topic:([A-Za-z0-9_.-]+)$/.exec(baseQuery.trim());
  if (topicMatch && token) {
    try {
      const graph = await discoverTopicRepositories(topicMatch[1], { token, pageSize: options.pageSize });
      if (graph) return graph;
    } catch (error) {
      console.warn(`[discovery] GraphQL complete discovery failed (${error.message}); falling back to REST dense-range enumeration`);
    }
  }
  return discoverViaRest(baseQuery, token);
}

export function discoveryRepoToLegacy(repo) {
  const fullName = repo.nameWithOwner || repo.full_name || '';
  const topics = discoveryTopics(repo);
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
    repo_id: discoveryRepoId(repo),
    name: repo.name,
    repo_name: repo.name,
    metadata_source: 'github',
    full_name: fullName,
    description: repo.description || '',
    category,
    topics,
    tags: topics,
    stars: Number(repo.stargazerCount ?? repo.stargazers_count ?? 0),
    forks: Number(repo.forkCount ?? repo.forks_count ?? 0),
    watchers: Number(repo.watchers?.totalCount ?? repo.subscribers_count ?? 0),
    open_issues: Number(repo.issues?.totalCount ?? repo.open_issues_count ?? 0),
    created_at: repo.createdAt || repo.created_at || '',
    updated_at: repo.pushedAt || repo.pushed_at || repo.updatedAt || repo.updated_at || '',
    first_seen: new Date().toISOString(),
    trend_score: Number(repo.stargazerCount ?? repo.stargazers_count ?? 0),
    language: repo.primaryLanguage?.name || repo.language || '',
    license: repo.licenseInfo?.spdxId || repo.license?.spdx_id || '',
    install_cmd: makeInstallCmd(fullName, category),
    repo_url: canonicalRepoUrl(fullName),
    homepage: normalizeHttpUrl(repo.homepageUrl || repo.homepage || null),
    deprecated: Boolean(repo.isArchived ?? repo.archived),
    disabled: Boolean(repo.isDisabled ?? repo.disabled),
    verified: false,
    manifest_file: null,
    has_readme: false,
    readme_excerpt: '',
    snapshot_commit: discoveredCommit || defaultBranch,
    snapshot_ref: defaultBranch,
    rank: 0,
  };
}
