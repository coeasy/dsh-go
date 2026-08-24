// 数字紧凑格式化：12345 → "12.3k"
// 注意：不要在含 export 的 .astro frontmatter 里内联正则字面量（如 /\.0$/）——
// Astro 编译器对「正则 + hoisted export（如 getStaticPaths）」组合存在编译 bug，
// 会产出非法代码（esbuild: Unexpected "export"）。统一下沉到本模块规避。
export function fmtK(n: number): string {
  if (n >= 10000) return (n / 1000).toFixed(0) + 'k';
  if (n >= 1000) {
    const s = (n / 1000).toFixed(1);
    return (s.endsWith('.0') ? s.slice(0, -2) : s) + 'k';
  }
  return String(n || 0);
}
