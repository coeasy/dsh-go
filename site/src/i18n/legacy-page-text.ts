import type { Lang } from './config';

type Entry = Record<Lang, string>;

// Compatibility bridge for older static pages that predate data-i18n attributes.
// Resource/package descriptions and code blocks are intentionally excluded: only UI chrome is translated.
const TEXT: Entry[] = [
  { en:'Combine multiple ecosystem packages into an auditable, preflighted, repeatable transaction plan. The full dependency graph is checked for Registry-pinned commits, compatibility, conflicts and permissions before one Runtime Registry commit.', 'zh-CN':'把多个生态包组合成可审计、可预检、可重复执行的事务计划。完整依赖图会先完成 Registry 固定 commit、兼容性、冲突和权限检查，再统一提交 Runtime Registry。', ja:'複数のエコシステムパッケージを、監査・事前検証・再実行可能なトランザクション計画にまとめます。依存グラフ全体で Registry 固定コミット、互換性、競合、権限を確認してから Runtime Registry に一括コミットします。', ko:'여러 생태계 패키지를 감사·사전검사·반복 실행 가능한 트랜잭션 계획으로 묶습니다. 전체 의존성 그래프에서 Registry 고정 커밋, 호환성, 충돌, 권한을 검사한 뒤 Runtime Registry에 한 번에 커밋합니다.', es:'Combina varios paquetes del ecosistema en un plan transaccional auditable, prevalidado y repetible. El grafo completo comprueba commits fijados por Registry, compatibilidad, conflictos y permisos antes de un único commit en Runtime Registry.' },
  { en:'Suitable for repeatable setups such as development environments, data analysis, and Agent workbenches.', 'zh-CN':'适合“开发环境 / 数据分析 / Agent 工作台”这类可重复配置。', ja:'開発環境、データ分析、Agent ワークベンチなどの再利用可能な構成に適しています。', ko:'개발 환경, 데이터 분석, Agent 워크벤치처럼 반복 가능한 구성에 적합합니다.', es:'Adecuado para configuraciones repetibles como entornos de desarrollo, análisis de datos y estaciones de trabajo de Agent.' },
  { en:'Suitable when a publisher provides a set of capabilities that must be installed together.', 'zh-CN':'适合发布者提供“一组必须一起安装”的能力集合。', ja:'公開者が「一緒にインストールすべき機能セット」を提供する場合に適しています。', ko:'게시자가 함께 설치해야 하는 기능 묶음을 제공할 때 적합합니다.', es:'Adecuado cuando un publicador ofrece un conjunto de capacidades que deben instalarse juntas.' },
  { en:'Transaction lifecycle', 'zh-CN':'事务执行规则', ja:'トランザクションのライフサイクル', ko:'트랜잭션 수명주기', es:'Ciclo de vida de la transacción' },
  { en:'Preflight the full dependency and permission set before committing; any pre-commit failure leaves no partial installation behind.', 'zh-CN':'先预检完整依赖和权限，再一次性提交；任何预提交失败都不会留下半安装状态。', ja:'完全な依存関係と権限を事前検証してから一括コミットし、コミット前の失敗では半端なインストールを残しません。', ko:'전체 의존성과 권한을 사전 검사한 뒤 한 번에 커밋하며, 사전 커밋 실패 시 부분 설치를 남기지 않습니다.', es:'Prevalida todas las dependencias y permisos antes de confirmar; cualquier fallo previo al commit no deja una instalación parcial.' },
  { en:'Browse Ecosystem →', 'zh-CN':'浏览 Ecosystem →', ja:'Ecosystem を見る →', ko:'Ecosystem 둘러보기 →', es:'Explorar Ecosystem →' },

  { en:'Trust Center', 'zh-CN':'信任中心', ja:'トラストセンター', ko:'신뢰 센터', es:'Centro de confianza' },
  { en:'Trust is computed from publisher ownership and supply-chain evidence. Popularity is shown separately and never makes a package trusted.', 'zh-CN':'信任度由发布者所有权和供应链证据计算。热度单独展示，绝不会因为热门就把包判定为可信。', ja:'信頼度は公開者の所有権とサプライチェーン証拠から算出されます。人気度は別表示で、人気だけで信頼済みにはなりません。', ko:'신뢰도는 게시자 소유권과 공급망 증거로 계산합니다. 인기도는 별도로 표시되며 인기만으로 신뢰 패키지가 되지 않습니다.', es:'La confianza se calcula a partir de la propiedad del publicador y de evidencias de la cadena de suministro. La popularidad se muestra por separado y nunca convierte un paquete en confiable.' },
  { en:'latest stable packages', 'zh-CN':'最新稳定包', ja:'最新安定版パッケージ', ko:'최신 안정 패키지', es:'paquetes estables más recientes' },
  { en:'trusted', 'zh-CN':'可信', ja:'信頼済み', ko:'신뢰됨', es:'confiables' },
  { en:'verified', 'zh-CN':'已验证', ja:'検証済み', ko:'검증됨', es:'verificados' },
  { en:'publisher ownership verified', 'zh-CN':'发布者所有权已验证', ja:'公開者所有権を検証済み', ko:'게시자 소유권 검증됨', es:'propiedad del publicador verificada' },
  { en:'revoked / critical advisory', 'zh-CN':'已撤销 / 严重安全通告', ja:'失効 / 重大アドバイザリ', ko:'철회 / 치명적 권고', es:'revocados / aviso crítico' },
  { en:'Publisher identity', 'zh-CN':'发布者身份', ja:'公開者 ID', ko:'게시자 신원', es:'Identidad del publicador' },
  { en:'Repository ownership is independent from stars, downloads or ranking. Cross-registry publisher identity conflicts fail closed.', 'zh-CN':'仓库所有权独立于 Stars、下载量和排名。跨 Registry 的发布者身份冲突会按失败关闭处理。', ja:'リポジトリ所有権は Stars、ダウンロード数、ランキングとは独立しています。Registry 間の公開者 ID 競合は fail-closed で処理します。', ko:'저장소 소유권은 Stars, 다운로드, 순위와 독립적입니다. Registry 간 게시자 신원 충돌은 fail-closed로 처리합니다.', es:'La propiedad del repositorio es independiente de Stars, descargas o ranking. Los conflictos de identidad entre registries fallan de forma cerrada.' },
  { en:'Supply chain', 'zh-CN':'供应链', ja:'サプライチェーン', ko:'공급망', es:'Cadena de suministro' },
  { en:'Provenance, signature, SBOM and license evidence increase trust. Runtime installation still verifies immutable commit/digest locally.', 'zh-CN':'来源证明、签名、SBOM 和许可证证据会提高信任度；Runtime 安装仍会在本地验证不可变 commit/digest。', ja:'来歴、署名、SBOM、ライセンス証拠は信頼度を高めます。Runtime インストールでも不変 commit/digest をローカル検証します。', ko:'출처, 서명, SBOM, 라이선스 증거가 신뢰도를 높입니다. Runtime 설치는 여전히 로컬에서 불변 commit/digest를 검증합니다.', es:'La procedencia, firma, SBOM y licencia aumentan la confianza. La instalación Runtime sigue verificando localmente el commit/digest inmutable.' },
  { en:'Security policy', 'zh-CN':'安全策略', ja:'セキュリティポリシー', ko:'보안 정책', es:'Política de seguridad' },
  { en:'Yanked versions are skipped. Revoked, critical-advisory and below-minimum-safe versions are blocked by both resolver and installer.', 'zh-CN':'已撤回版本会被跳过；已撤销、有严重安全通告或低于最低安全版本的包会同时被 resolver 和 installer 阻止。', ja:'Yank 済みバージョンはスキップされ、失効・重大アドバイザリ・最低安全版未満は resolver と installer の両方でブロックされます。', ko:'Yank된 버전은 건너뛰고, 철회·치명적 권고·최소 안전 버전 미만은 resolver와 installer 모두에서 차단합니다.', es:'Las versiones retiradas se omiten. Las revocadas, con avisos críticos o por debajo de la versión mínima segura se bloquean en resolver e installer.' },
  { en:'Local authority', 'zh-CN':'本地执行权威', ja:'ローカル権限', ko:'로컬 권한', es:'Autoridad local' },
  { en:'Marketplace APIs and MCP only discover and plan. Installation always runs through the local Runtime, approval gate and pending-restart lifecycle.', 'zh-CN':'Marketplace API 和 MCP 只负责发现与计划；安装始终通过本地 Runtime、审批门和待重启生命周期执行。', ja:'Marketplace API と MCP は発見と計画のみを行い、インストールは常にローカル Runtime、承認ゲート、再起動待ちライフサイクルを通ります。', ko:'Marketplace API와 MCP는 검색과 계획만 담당하며 설치는 항상 로컬 Runtime, 승인 게이트, 재시작 대기 수명주기를 거칩니다.', es:'Las API del Marketplace y MCP solo descubren y planifican. La instalación siempre pasa por Runtime local, la puerta de aprobación y el ciclo de reinicio pendiente.' },
  { en:'Evidence-backed packages', 'zh-CN':'有证据支持的包', ja:'証拠付きパッケージ', ko:'증거 기반 패키지', es:'Paquetes respaldados por evidencias' },
  { en:'Highest trust signals', 'zh-CN':'最高信任信号', ja:'最も高い信頼シグナル', ko:'가장 높은 신뢰 신호', es:'Señales de confianza más altas' },
  { en:'Marketplace →', 'zh-CN':'市场 →', ja:'マーケット →', ko:'마켓플레이스 →', es:'Marketplace →' },

  { en:'From categories, languages, licenses, and verification status, quickly understand the current plugin ecosystem.', 'zh-CN':'从分类、语言、许可证和验证状态快速了解当前插件生态结构。', ja:'カテゴリ、言語、ライセンス、検証状態から現在のプラグインエコシステムをすばやく把握できます。', ko:'카테고리, 언어, 라이선스, 검증 상태로 현재 플러그인 생태계를 빠르게 파악합니다.', es:'Comprende rápidamente el ecosistema actual de plugins por categorías, idiomas, licencias y estado de verificación.' },
  { en:'Marketplace analytics', 'zh-CN':'市场统计', ja:'マーケット分析', ko:'마켓 분석', es:'Analítica del Marketplace' },
  { en:'Marketplace signals', 'zh-CN':'市场趋势信号', ja:'マーケットシグナル', ko:'마켓 신호', es:'Señales del Marketplace' },
  { en:'Developer platform', 'zh-CN':'开发者平台', ja:'開発者プラットフォーム', ko:'개발자 플랫폼', es:'Plataforma para desarrolladores' },
];

const index = new Map<string, Entry>();
for (const entry of TEXT) for (const value of Object.values(entry)) index.set(value.trim(), entry);

export function applyLegacyPageText(lang: Lang) {
  if (typeof document === 'undefined') return;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!(node instanceof Text)) continue;
    const parent = node.parentElement;
    if (!parent || parent.closest('script,style,pre,code,[data-i18n],[data-detail-i18n],[data-pub-i18n]')) continue;
    nodes.push(node);
  }
  for (const node of nodes) {
    const raw = node.textContent || '';
    const trimmed = raw.trim();
    const entry = index.get(trimmed);
    if (!entry) continue;
    const leading = raw.match(/^\s*/)?.[0] || '';
    const trailing = raw.match(/\s*$/)?.[0] || '';
    node.textContent = `${leading}${entry[lang]}${trailing}`;
  }
}
