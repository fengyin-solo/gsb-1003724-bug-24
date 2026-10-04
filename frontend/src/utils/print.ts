// 打印报表与屏幕列表共用同一组列与取值（调用方传入已格式化好的字符串），
// 从数据口径上保证「列表与打印报表一致」。新窗口承载，点击触发，不引入额外依赖。

export type PrintSection = {
  heading?: string
  columns: string[]
  rows: string[][]
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export function printReport(title: string, sections: PrintSection[]): boolean {
  const win = window.open('', '_blank', 'noopener')
  if (!win) {
    return false
  }
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  const printedAt = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} `
    + `${pad(now.getHours())}:${pad(now.getMinutes())}`

  const sectionHtml = sections.map((section) => {
    const head = section.heading ? `<h2>${escapeHtml(section.heading)}</h2>` : ''
    const header = section.columns
      .map((column) => `<th>${escapeHtml(column)}</th>`)
      .join('')
    const body = section.rows
      .map((cells) => `<tr>${cells.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`)
      .join('')
    return `${head}<table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table>`
  }).join('<div class="gap"></div>')

  win.document.write(`<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: 'PingFang SC', 'Microsoft YaHei', sans-serif; color: #1f2937; padding: 24px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  h2 { font-size: 15px; margin: 18px 0 8px; }
  .meta { color: #64748b; font-size: 12px; margin-bottom: 12px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #94a3b8; padding: 6px 8px; font-size: 12px; text-align: left; }
  th { background: #eef2f7; }
  .gap { height: 8px; }
</style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <div class="meta">打印时间：${escapeHtml(printedAt)} · 水文监测站网管理系统</div>
  ${sectionHtml}
  <script>window.onload = function () { window.print(); }<\/script>
</body>
</html>`)
  win.document.close()
  return true
}
