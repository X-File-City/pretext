import { prepare, layout, clearCache } from '../src/layout.ts'

const TEXTS = [
  // Latin
  "Just tried the new update and it's so much better. The performance improvements are really noticeable, especially on older devices.",
  "Does anyone know if this works with the latest version? I've been having some issues since the upgrade.",
  "This is exactly what I was looking for. Simple, clean, and does exactly what it says on the tin.",
  "The key insight is that you can cache word measurements separately from layout results. This gives you the best of both worlds.",
  "Performance is critical for this kind of library. If you can't measure hundreds of text blocks per frame, it's not useful for real applications.",
  "One thing I noticed is that the line breaking algorithm doesn't handle hyphenation. Is that on the roadmap?",

  // Arabic
  "هذا النص باللغة العربية لاختبار دعم الاتجاه من اليمين إلى اليسار في مكتبة تخطيط النص",
  "مرحبا بالعالم، هذه تجربة لقياس النص العربي وكسر الأسطر بشكل صحيح",

  // Hebrew
  "זהו טקסט בעברית כדי לבדוק תמיכה בכיוון מימין לשמאל בספריית פריסת הטקסט",
  "שלום עולם, זוהי בדיקה למדידת טקסט עברי ושבירת שורות",

  // Mixed LTR + RTL
  "The meeting is scheduled for يوم الثلاثاء at the main office. Please bring your مستندات with you.",
  "According to the report by محمد الأحمد, the results show significant improvement in performance.",
  "The project name is פרויקט חדש and it was started last month by the research team.",
  "Version 3.2.1 של התוכנה was released on January 15th with many improvements.",

  // CJK — Chinese
  "这是一段中文文本，用于测试文本布局库对中日韩字符的支持。每个字符之间都可以断行。",
  "性能测试显示，新的文本测量方法比传统方法快了将近一千五百倍。",

  // CJK — Japanese
  "これはテキストレイアウトライブラリのテストです。日本語のテキストを正しく処理できるか確認します。",
  "パフォーマンスは非常に重要です。フレームごとに数百のテキストブロックを測定する必要があります。",

  // CJK — Korean
  "이것은 텍스트 레이아웃 라이브러리의 테스트입니다. 한국어 텍스트를 올바르게 처리할 수 있는지 확인합니다.",

  // Thai
  "นี่คือข้อความทดสอบสำหรับไลบรารีจัดวางข้อความ ทดสอบการตัดคำภาษาไทย",

  // Emoji
  "The quick 🦊 jumped over the lazy 🐕 and then went home 🏠 to rest 😴 for the night.",
  "Great work! 👏👏👏 This is exactly what we needed 🎯 for the project 🚀",

  // Mixed everything
  "Hello مرحبا שלום 你好 こんにちは 안녕하세요 สวัสดี — a greeting in seven scripts!",
  "The price is $42.99 (approximately ٤٢٫٩٩ ريال or ₪158.50) including tax.",

  // Edge cases
  "",
  "A",
  "   ",
  "Hello\nWorld\nMultiple\nLines",
  "Superlongwordwithoutanyspacesthatshouldjustoverflowthelineandkeepgoing",
  "In the heart of القاهرة القديمة, you can find ancient mosques alongside modern cafés. The city's history spans millennia, from the pharaohs to the present day. كل شارع يحكي قصة مختلفة about the rich cultural heritage of this remarkable place.",
]

const FONTS = [
  '"Helvetica Neue", Helvetica, Arial, sans-serif',
  'Georgia, "Times New Roman", serif',
]

const SIZES = [12, 14, 15, 16, 18, 20, 24, 28]
const WIDTHS = [150, 200, 250, 300, 350, 400, 500, 600]

type Mismatch = {
  font: string
  fontSize: number
  width: number
  actual: number
  predicted: number
  diff: number
  text: string
}

function runSweep(): { total: number, mismatches: Mismatch[] } {
  const container = document.createElement('div')
  container.style.cssText = 'position:absolute;top:-9999px;left:-9999px;visibility:hidden'
  document.body.appendChild(container)

  const mismatches: Mismatch[] = []
  let total = 0

  for (const fontFamily of FONTS) {
    for (const fontSize of SIZES) {
      const font = `${fontSize}px ${fontFamily}`
      const lineHeight = Math.round(fontSize * 1.2)
      clearCache()

      for (const maxWidth of WIDTHS) {
        const divs: HTMLDivElement[] = []
        const prepared: ReturnType<typeof prepare>[] = []

        for (const text of TEXTS) {
          const div = document.createElement('div')
          div.style.font = font
          div.style.lineHeight = `${lineHeight}px`
          div.style.width = `${maxWidth}px`
          div.style.wordWrap = 'break-word'
          div.style.overflowWrap = 'break-word'
          div.textContent = text
          container.appendChild(div)
          divs.push(div)
          prepared.push(prepare(text, font, lineHeight))
        }

        for (let i = 0; i < TEXTS.length; i++) {
          const actual = divs[i]!.getBoundingClientRect().height
          const predicted = layout(prepared[i]!, maxWidth).height
          total++
          if (Math.abs(actual - predicted) >= 1) {
            mismatches.push({
              font: fontFamily,
              fontSize,
              width: maxWidth,
              actual,
              predicted,
              diff: predicted - actual,
              text: TEXTS[i]!,
            })
          }
        }
        container.innerHTML = ''
      }
    }
  }

  document.body.removeChild(container)
  return { total, mismatches }
}

// --- Render ---

function render() {
  const root = document.getElementById('root')!
  root.innerHTML = '<p>Running sweep...</p>'

  requestAnimationFrame(() => {
    const { total, mismatches } = runSweep()
    const matchCount = total - mismatches.length
    const pct = ((matchCount / total) * 100).toFixed(1)

    let html = `
      <div class="summary">
        <span class="big">${matchCount}/${total}</span> match (${pct}%)
        <span class="sep">|</span>
        ${mismatches.length} mismatches
        <span class="sep">|</span>
        ${FONTS.length} fonts × ${SIZES.length} sizes × ${WIDTHS.length} widths × ${TEXTS.length} texts
      </div>
    `

    // Group mismatches by font
    const byFont = new Map<string, Mismatch[]>()
    for (const m of mismatches) {
      const key = m.font
      let arr = byFont.get(key)
      if (!arr) { arr = []; byFont.set(key, arr) }
      arr.push(m)
    }

    // Group within font by size
    for (const [font, ms] of byFont) {
      html += `<h2>${font}</h2>`

      const bySize = new Map<number, Mismatch[]>()
      for (const m of ms) {
        let arr = bySize.get(m.fontSize)
        if (!arr) { arr = []; bySize.set(m.fontSize, arr) }
        arr.push(m)
      }

      for (const [size, sizeMs] of bySize) {
        html += `<h3>${size}px (${sizeMs.length} mismatches)</h3>`
        html += '<table><tr><th>Width</th><th>Actual</th><th>Predicted</th><th>Diff</th><th>Text</th></tr>'
        for (const m of sizeMs) {
          const cls = m.diff > 0 ? 'over' : 'under'
          const snippet = m.text.length > 50 ? m.text.slice(0, 50) + '...' : m.text
          html += `<tr class="${cls}">
            <td>${m.width}px</td>
            <td>${m.actual}px</td>
            <td>${m.predicted}px</td>
            <td>${m.diff > 0 ? '+' : ''}${m.diff}px</td>
            <td class="text">${escapeHtml(snippet)}</td>
          </tr>`
        }
        html += '</table>'
      }
    }

    if (mismatches.length === 0) {
      html += '<p class="perfect">All tests pass.</p>'
    }

    root.innerHTML = html
  })
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

render()
