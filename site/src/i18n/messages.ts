import { DEFAULT_LANG, type Lang } from './config';

export const MESSAGES = {
  en: {
    marketplace: 'Marketplace', trust: 'Trust Center', publishers: 'Publishers', profiles: 'Profiles', trending: 'Trending', stats: 'Stats', docs: 'API Docs',
    hero_title: 'DeepSeek Harness Ecosystem', hero_sub: 'Discover Plugin, MCP, Skill and Agent packages from Registry V4.',
    search_placeholder: 'Search packages, repositories, publishers…', filter_all: 'All', filter_plugin: 'Plugins', filter_mcp: 'MCP', filter_skill: 'Skills', filter_agent: 'Agents',
    sort_stars: 'Most Stars', sort_updated: 'Recently Updated', results: '{n} packages', no_results: 'No packages match this filter.', load_more: 'Load more', loading: 'Loading Registry V4 discovery index…', load_failed: 'Discovery index is temporarily unavailable.',
    source: 'Source ↗', detail: 'Details', install: 'Copy install', copied: 'Copied ✓', open_dsh: 'Open in DSH', verified: 'Verified', community: 'Community', installable: 'Installable', discovery_only: 'Discovery only',
    package_overview: 'Package overview', releases: 'Releases', security: 'Security', permissions: 'Permissions', dependencies: 'Dependencies', compatibility: 'Compatibility', publisher: 'Publisher', repository: 'Repository', latest_release: 'Latest safe release',
    local_install_notice: 'Installation is executed only by the local DSH runtime after explicit confirmation.', stars: 'Stars', updated: 'Updated', back_marketplace: '← Marketplace',
    footer_summary: 'DSH Marketplace · Registry V4 · local package execution only', registry_revision: 'Registry revision', last_sync: 'Last sync',
  },
  'zh-CN': {
    marketplace: '生态市场', trust: '信任中心', publishers: '发布者', profiles: '配置组合', trending: '趋势', stats: '统计', docs: 'API 文档',
    hero_title: 'DeepSeek Harness 生态市场', hero_sub: '基于 Registry V4 发现 Plugin、MCP、Skill 与 Agent 包。',
    search_placeholder: '搜索包、仓库、发布者…', filter_all: '全部', filter_plugin: '插件', filter_mcp: 'MCP', filter_skill: '技能', filter_agent: 'Agent',
    sort_stars: '最多 Stars', sort_updated: '最近更新', results: '{n} 个包', no_results: '没有符合当前筛选条件的包。', load_more: '加载更多', loading: '正在加载 Registry V4 发现索引…', load_failed: '发现索引暂时不可用。',
    source: '源码 ↗', detail: '详情', install: '复制安装命令', copied: '已复制 ✓', open_dsh: '在 DSH 中打开', verified: '已验证', community: '社区', installable: '可安装', discovery_only: '仅发现',
    package_overview: '包概览', releases: '版本', security: '安全', permissions: '权限', dependencies: '依赖', compatibility: '兼容性', publisher: '发布者', repository: '仓库', latest_release: '最新安全版本',
    local_install_notice: '安装只能在本地 DSH Runtime 中经用户明确确认后执行。', stars: 'Stars', updated: '最近更新', back_marketplace: '← 返回生态市场',
    footer_summary: 'DSH 生态市场 · Registry V4 · 仅本地执行包操作', registry_revision: 'Registry 版本', last_sync: '最近同步',
  },
  ja: {
    marketplace: 'マーケット', trust: 'トラストセンター', publishers: '公開者', profiles: 'プロファイル', trending: 'トレンド', stats: '統計', docs: 'API ドキュメント',
    hero_title: 'DeepSeek Harness エコシステム', hero_sub: 'Registry V4 から Plugin、MCP、Skill、Agent を検索します。',
    search_placeholder: 'パッケージ、リポジトリ、公開者を検索…', filter_all: 'すべて', filter_plugin: 'Plugin', filter_mcp: 'MCP', filter_skill: 'Skill', filter_agent: 'Agent',
    sort_stars: 'Stars 順', sort_updated: '最近更新', results: '{n} パッケージ', no_results: '一致するパッケージはありません。', load_more: 'さらに読み込む', loading: 'Registry V4 インデックスを読み込み中…', load_failed: '検索インデックスは一時的に利用できません。',
    source: 'ソース ↗', detail: '詳細', install: 'インストールをコピー', copied: 'コピー済み ✓', open_dsh: 'DSH で開く', verified: '検証済み', community: 'コミュニティ', installable: 'インストール可能', discovery_only: '検索のみ',
    package_overview: '概要', releases: 'リリース', security: 'セキュリティ', permissions: '権限', dependencies: '依存関係', compatibility: '互換性', publisher: '公開者', repository: 'リポジトリ', latest_release: '最新の安全なリリース',
    local_install_notice: 'インストールは明示的な確認後にローカル DSH Runtime のみで実行されます。', stars: 'Stars', updated: '更新', back_marketplace: '← マーケット', footer_summary: 'DSH Marketplace · Registry V4 · ローカル実行のみ', registry_revision: 'Registry revision', last_sync: '最終同期',
  },
  ko: {
    marketplace: '마켓플레이스', trust: '신뢰 센터', publishers: '게시자', profiles: '프로필', trending: '트렌드', stats: '통계', docs: 'API 문서',
    hero_title: 'DeepSeek Harness 생태계', hero_sub: 'Registry V4에서 Plugin, MCP, Skill, Agent 패키지를 탐색합니다.',
    search_placeholder: '패키지, 저장소, 게시자 검색…', filter_all: '전체', filter_plugin: 'Plugin', filter_mcp: 'MCP', filter_skill: 'Skill', filter_agent: 'Agent',
    sort_stars: 'Stars 순', sort_updated: '최근 업데이트', results: '{n}개 패키지', no_results: '일치하는 패키지가 없습니다.', load_more: '더 보기', loading: 'Registry V4 검색 인덱스를 불러오는 중…', load_failed: '검색 인덱스를 일시적으로 사용할 수 없습니다.',
    source: '소스 ↗', detail: '상세', install: '설치 명령 복사', copied: '복사됨 ✓', open_dsh: 'DSH에서 열기', verified: '검증됨', community: '커뮤니티', installable: '설치 가능', discovery_only: '검색 전용',
    package_overview: '패키지 개요', releases: '릴리스', security: '보안', permissions: '권한', dependencies: '의존성', compatibility: '호환성', publisher: '게시자', repository: '저장소', latest_release: '최신 안전 릴리스',
    local_install_notice: '설치는 명시적 확인 후 로컬 DSH Runtime에서만 실행됩니다.', stars: 'Stars', updated: '업데이트', back_marketplace: '← 마켓플레이스', footer_summary: 'DSH Marketplace · Registry V4 · 로컬 실행 전용', registry_revision: 'Registry revision', last_sync: '최근 동기화',
  },
  es: {
    marketplace: 'Marketplace', trust: 'Centro de confianza', publishers: 'Publicadores', profiles: 'Perfiles', trending: 'Tendencias', stats: 'Estadísticas', docs: 'Docs API',
    hero_title: 'Ecosistema DeepSeek Harness', hero_sub: 'Descubre paquetes Plugin, MCP, Skill y Agent desde Registry V4.',
    search_placeholder: 'Buscar paquetes, repositorios, publicadores…', filter_all: 'Todos', filter_plugin: 'Plugins', filter_mcp: 'MCP', filter_skill: 'Skills', filter_agent: 'Agents',
    sort_stars: 'Más Stars', sort_updated: 'Actualizados recientemente', results: '{n} paquetes', no_results: 'Ningún paquete coincide con el filtro.', load_more: 'Cargar más', loading: 'Cargando el índice de Registry V4…', load_failed: 'El índice no está disponible temporalmente.',
    source: 'Fuente ↗', detail: 'Detalles', install: 'Copiar instalación', copied: 'Copiado ✓', open_dsh: 'Abrir en DSH', verified: 'Verificado', community: 'Comunidad', installable: 'Instalable', discovery_only: 'Solo descubrimiento',
    package_overview: 'Resumen del paquete', releases: 'Versiones', security: 'Seguridad', permissions: 'Permisos', dependencies: 'Dependencias', compatibility: 'Compatibilidad', publisher: 'Publicador', repository: 'Repositorio', latest_release: 'Última versión segura',
    local_install_notice: 'La instalación solo se ejecuta en el Runtime DSH local después de una confirmación explícita.', stars: 'Stars', updated: 'Actualizado', back_marketplace: '← Marketplace', footer_summary: 'DSH Marketplace · Registry V4 · ejecución local únicamente', registry_revision: 'Revisión del Registry', last_sync: 'Última sincronización',
  },
} as const satisfies Record<Lang, Record<string, string>>;

export type MessageKey = keyof typeof MESSAGES.en;

export function message(key: MessageKey, lang: Lang = DEFAULT_LANG, vars: Record<string, string | number> = {}): string {
  let value = (MESSAGES[lang] as Record<string, string>)[key] || MESSAGES[DEFAULT_LANG][key] || key;
  for (const [name, replacement] of Object.entries(vars)) value = value.replaceAll(`{${name}}`, String(replacement));
  return value;
}
