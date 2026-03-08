import { execFileSync, spawn } from 'node:child_process'

type GatsbyLineMismatch = {
  line: number
  ours: string
  browser: string
}

type GatsbyReport = {
  status: 'ready' | 'error'
  requestId?: string
  width?: number
  contentWidth?: number
  predictedHeight?: number
  actualHeight?: number
  diagnosticHeight?: number
  diffPx?: number
  predictedLineCount?: number
  browserLineCount?: number
  ourJoinedMatchesText?: boolean
  browserJoinedMatchesText?: boolean
  ourJoinedDiffOffset?: number | null
  browserJoinedDiffOffset?: number | null
  ourJoinedDiff?: JoinedTextDiff | null
  browserJoinedDiff?: JoinedTextDiff | null
  mismatchCount?: number
  firstMismatch?: GatsbyLineMismatch | null
  firstBreakMismatch?: GatsbyBreakMismatch | null
  message?: string
}

type GatsbyBreakMismatch = {
  line: number
  start: number
  oursEnd: number
  browserEnd: number
  oursRawEnd: number
  browserRawEnd: number
  deltaText: string
  oursContext: string
  browserContext: string
  contentWidth: number
  oursText: string
  browserText: string
  oursSumWidth: number
  oursFullWidth: number
  oursRawWidth: number
  browserDomWidth: number
  browserFullWidth: number
  browserRawDomWidth: number
  browserRawWidth: number
  reasonGuess: string
  oursBoundary: GatsbyBoundary
  browserBoundary: GatsbyBoundary
  segmentWindow: GatsbyBreakSegment[]
}

type GatsbyBoundary = {
  offset: number
  description: string
}

type GatsbyBreakSegment = {
  index: number
  start: number
  end: number
  text: string
  width: number
  isSpace: boolean
  breakable: boolean
  oursAtStart: boolean
  oursAtEnd: boolean
  oursInside: boolean
  browserAtStart: boolean
  browserAtEnd: boolean
  browserInside: boolean
}

type JoinedTextDiff = {
  offset: number
  expectedContext: string
  actualContext: string
}

const widths = process.argv.slice(2)
  .map(arg => Number.parseInt(arg, 10))
  .filter(width => Number.isFinite(width))

const targetWidths = widths.length > 0 ? widths : [300, 400, 600, 800]
const port = Number.parseInt(process.env['GATSBY_CHECK_PORT'] ?? '3210', 10)
const baseUrl = `http://localhost:${port}/gatsby`
const browser = (process.env['GATSBY_CHECK_BROWSER'] ?? 'chrome').toLowerCase()
const diagnosticMode = browser === 'safari' ? 'light' : 'full'

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function canReachServer(): Promise<boolean> {
  try {
    const response = await fetch(baseUrl)
    return response.ok
  } catch {
    return false
  }
}

async function waitForServer(): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (await canReachServer()) return
    await sleep(100)
  }
  throw new Error(`Timed out waiting for local Bun server on ${baseUrl}`)
}

function navigateBrowser(url: string): void {
  if (browser === 'safari') {
    execFileSync('osascript', [
      '-e',
      'tell application "Safari" to activate',
      '-e',
      'tell application "Safari" to if (count of windows) = 0 then make new document',
      '-e',
      `tell application "Safari" to set URL of current tab of front window to ${JSON.stringify(url)}`,
    ], { encoding: 'utf8' })
    return
  }

  execFileSync('osascript', [
    '-e',
    'tell application "Google Chrome" to activate',
    '-e',
    'tell application "Google Chrome" to if (count of windows) = 0 then make new window',
    '-e',
    `tell application "Google Chrome" to set URL of active tab of front window to ${JSON.stringify(url)}`,
  ], { encoding: 'utf8' })
}

function readBrowserReportText(): string {
  try {
    if (browser === 'safari') {
      const url = execFileSync('osascript', [
        '-e',
        'tell application "Safari" to get URL of current tab of front window',
      ], { encoding: 'utf8' }).trim()
      const hashIndex = url.indexOf('#report=')
      if (hashIndex === -1) return ''
      return decodeURIComponent(url.slice(hashIndex + '#report='.length))
    }

    return execFileSync('osascript', [
      '-e',
      'tell application "Google Chrome" to execute active tab of front window javascript "(() => { const el = document.getElementById(\'gatsby-report\'); return el && el.dataset.ready === \'1\' && el.textContent ? el.textContent : \'\'; })()"',
    ], { encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

async function loadBrowserReport(url: string, expectedRequestId: string): Promise<GatsbyReport> {
  navigateBrowser(url)

  for (let i = 0; i < 600; i++) {
    await sleep(100)
    const reportJson = readBrowserReportText()
    if (reportJson === '' || reportJson === 'null') continue

    const report = JSON.parse(reportJson) as GatsbyReport
    if (report.requestId === expectedRequestId) {
      return report
    }
  }

  throw new Error(`Timed out waiting for Gatsby report from ${browser}`)
}

function formatWidth(width: number): string {
  return width.toFixed(3).replace(/\.?0+$/, '')
}

function formatSegmentMarkers(segment: GatsbyBreakSegment): string {
  const markers: string[] = []
  if (segment.oursAtStart) markers.push('ours@start')
  if (segment.oursInside) markers.push('ours@inside')
  if (segment.oursAtEnd) markers.push('ours@end')
  if (segment.browserAtStart) markers.push('browser@start')
  if (segment.browserInside) markers.push('browser@inside')
  if (segment.browserAtEnd) markers.push('browser@end')
  return markers.length > 0 ? ` [${markers.join(', ')}]` : ''
}

function printReport(report: GatsbyReport): void {
  if (report.status === 'error') {
    console.log(`error: ${report.message ?? 'unknown error'}`)
    return
  }

  const width = report.width ?? 0
  const diff = report.diffPx ?? 0
  const predicted = Math.round(report.predictedHeight ?? 0)
  const actual = Math.round(report.actualHeight ?? 0)
  const lines = report.predictedLineCount !== undefined && report.browserLineCount !== undefined
    ? `${report.predictedLineCount}/${report.browserLineCount}`
    : '-'

  console.log(`width ${width}: diff ${diff > 0 ? '+' : ''}${Math.round(diff)}px | height ${predicted}/${actual} | lines ${lines}`)
  if (report.ourJoinedMatchesText === false || report.browserJoinedMatchesText === false) {
    console.log(
      `  joined text: ours ${report.ourJoinedMatchesText ? 'ok' : `drift@${report.ourJoinedDiffOffset ?? '?'}`} | browser ${report.browserJoinedMatchesText ? 'ok' : `drift@${report.browserJoinedDiffOffset ?? '?'}`}`,
    )
    if (report.ourJoinedDiff !== null && report.ourJoinedDiff !== undefined) {
      console.log(`  ours joined expected: ${report.ourJoinedDiff.expectedContext}`)
      console.log(`  ours joined actual:   ${report.ourJoinedDiff.actualContext}`)
    }
    if (report.browserJoinedDiff !== null && report.browserJoinedDiff !== undefined) {
      console.log(`  browser joined expected: ${report.browserJoinedDiff.expectedContext}`)
      console.log(`  browser joined actual:   ${report.browserJoinedDiff.actualContext}`)
    }
  }
  if (report.firstBreakMismatch !== null && report.firstBreakMismatch !== undefined) {
    const mismatch = report.firstBreakMismatch
    console.log(`  break L${mismatch.line} | ours ${mismatch.oursEnd} | browser ${mismatch.browserEnd}`)
    console.log(`  reason: ${mismatch.reasonGuess}`)
    console.log(`  delta:  ${JSON.stringify(mismatch.deltaText)}`)
    console.log(
      `  widths: max ${formatWidth(mismatch.contentWidth)} | ours sum/content/raw ${formatWidth(mismatch.oursSumWidth)}/${formatWidth(mismatch.oursFullWidth)}/${formatWidth(mismatch.oursRawWidth)} | browser content-dom/content/raw-dom/raw ${formatWidth(mismatch.browserDomWidth)}/${formatWidth(mismatch.browserFullWidth)}/${formatWidth(mismatch.browserRawDomWidth)}/${formatWidth(mismatch.browserRawWidth)}`,
    )
    console.log(`  ours boundary:    ${mismatch.oursBoundary.description}`)
    console.log(`  browser boundary: ${mismatch.browserBoundary.description}`)
    console.log(`  ours:    ${mismatch.oursContext}`)
    console.log(`  browser: ${mismatch.browserContext}`)
    if (mismatch.segmentWindow.length > 0) {
      console.log('  segments:')
      for (const segment of mismatch.segmentWindow) {
        const kind = [
          segment.isSpace ? 'space' : 'text',
          segment.breakable ? 'breakable' : 'fixed',
        ].join(', ')
        console.log(
          `    #${segment.index} ${segment.start}-${segment.end} w=${formatWidth(segment.width)} ${kind}${formatSegmentMarkers(segment)} ${JSON.stringify(segment.text)}`,
        )
      }
    }
  } else if (report.firstMismatch !== null && report.firstMismatch !== undefined) {
    console.log(`  first mismatch L${report.firstMismatch.line}`)
    console.log(`  ours:    ${JSON.stringify(report.firstMismatch.ours.slice(0, 120))}`)
    console.log(`  browser: ${JSON.stringify(report.firstMismatch.browser.slice(0, 120))}`)
  }
}

let serverProcess: ReturnType<typeof spawn> | null = null

try {
  if (!(await canReachServer())) {
    serverProcess = spawn('/bin/zsh', ['-lc', `bun --port=${port} --no-hmr pages/*.html`], {
      cwd: process.cwd(),
      stdio: 'ignore',
    })
    await waitForServer()
  }

  for (const width of targetWidths) {
    const requestId = `${Date.now()}-${width}-${Math.random().toString(36).slice(2, 8)}`
    const url = `${baseUrl}?report=1&diagnostic=${diagnosticMode}&width=${width}&requestId=${requestId}`
    const report = await loadBrowserReport(url, requestId)
    printReport(report)
  }
} finally {
  if (serverProcess !== null) {
    serverProcess.kill('SIGTERM')
  }
}
