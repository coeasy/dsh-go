from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected exactly one match, got {count}')
    p.write_text(text.replace(old, new, 1))


# main now contains Registry V3 ecosystem MCP tools. Preserve them and apply the same
# active-catalog semantics to the legacy catalog tools instead of restoring the old endpoint.
replace_once(
    'functions/api/v1/mcp.ts',
    "        case 'get_plugin': {\n          const { data } = await loadCatalog(env);\n          result = data.plugins.find((plugin) => plugin.slug === args?.slug) || null;\n          break;\n        }",
    "        case 'get_plugin': {\n          const { data } = await loadCatalog(env);\n          const requestedSlug = String(args?.slug || '').toLowerCase();\n          result = filterPlugins(data.plugins, {}).find((plugin) => plugin.slug.toLowerCase() === requestedSlug) || null;\n          break;\n        }",
)
replace_once(
    'functions/api/v1/mcp.ts',
    "        case 'list_categories': {\n          const { data } = await loadCatalog(env);\n          result = data.meta.stats.by_category;\n          break;\n        }",
    "        case 'list_categories': {\n          const { data } = await loadCatalog(env);\n          const counts: Record<string, number> = {};\n          for (const plugin of filterPlugins(data.plugins, {})) counts[plugin.category || 'other'] = (counts[plugin.category || 'other'] || 0) + 1;\n          result = counts;\n          break;\n        }",
)
replace_once(
    'functions/api/v1/mcp.ts',
    "        case 'search_plugins': {\n          const { data } = await loadCatalog(env);\n          const keyword = (args?.q || '').toLowerCase();\n          const limit = Math.max(1, Math.min(Number(args?.limit) || 10, 100));\n          result = data.plugins\n            .filter((plugin) =>\n              plugin.name.toLowerCase().includes(keyword)\n              || plugin.description.toLowerCase().includes(keyword)\n              || plugin.topics.some((topic) => topic.includes(keyword))\n              || plugin.full_name.toLowerCase().includes(keyword))\n            .sort((left, right) => right.stars - left.stars)\n            .slice(0, limit)\n            .map((plugin) => ({ slug: plugin.slug, name: plugin.name, stars: plugin.stars, description: plugin.description }));\n          break;\n        }",
    "        case 'search_plugins': {\n          const { data } = await loadCatalog(env);\n          const keyword = (args?.q || '').toLowerCase();\n          const limit = Math.max(1, Math.min(Number(args?.limit) || 10, 100));\n          result = filterPlugins(data.plugins, { search: keyword, sort: 'stars' })\n            .slice(0, limit)\n            .map((plugin) => ({ slug: plugin.slug, name: plugin.name, stars: plugin.stars, description: plugin.description }));\n          break;\n        }",
)

package = Path('package.json')
text = package.read_text()
if '"audit:identity"' not in text:
    old = '    "validate": "node scripts/validate.mjs",\n'
    if old not in text:
        raise SystemExit('package.json: validate script anchor missing')
    text = text.replace(old, old + '    "audit:identity": "node scripts/audit-catalog-identity.mjs",\n', 1)
    package.write_text(text)
