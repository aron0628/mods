import type { Register } from 'claude-code'
import { renderMermaidASCII } from './vendor/mermaid-ascii.js'

// 닫힌 ```mermaid 펜스만 잡는다. 스트리밍 중 아직 안 닫힌 펜스는 매치되지 않아 원문 그대로 남는다.
const FENCE = /^[ \t]*```mermaid[ \t]*\n([\s\S]*?)\n[ \t]*```[ \t]*$/gm

// 답변 앞 글머리(⏺)와 코드 블록 들여쓰기만큼 비워 둔다.
const GUTTER = 4
const FALLBACK_COLUMNS = 80

const GUIDE = {
  id: 'mermaid-box:guide',
  scope: 'session',
  text: [
    'Diagrams in this terminal: a ```mermaid code block in your reply is drawn on screen as a box diagram (the stored reply keeps the mermaid source).',
    'When a flow, sequence, or structure is clearer as a picture than as prose, you may use one. Supported: flowchart/graph, sequenceDiagram, stateDiagram-v2, classDiagram, erDiagram.',
    'Write node ids in ASCII (A, B, step1) and put Korean or other non-ASCII text only inside labels, e.g. A[요청 수신]. Keep a diagram to about 12 nodes with short one-line labels; one wider than the terminal stays shown as code.',
  ].join('\n'),
} as const

// 한글처럼 터미널에서 2칸을 차지하는 글자
const isWide = (cp: number): boolean =>
  (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) ||
  (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff) ||
  (cp >= 0xfe30 && cp <= 0xfe4f) || (cp >= 0xff00 && cp <= 0xff60) ||
  (cp >= 0xffe0 && cp <= 0xffe6)

const cellWidth = (line: string): number =>
  [...line].reduce((n, ch) => n + (isWide(ch.codePointAt(0)!) ? 2 : 1), 0)

// 렌더러는 글자 1개를 1칸으로 센다. 2칸 글자를 [고유 개인영역 문자 + 채움 문자] 2개로 바꿔
// 폭을 맞게 계산시킨 뒤, 그린 결과에서 원래 글자로 되돌린다.
const FILL = ''
function renderWide(source: string): string {
  const table: string[] = []
  const index = new Map<string, number>()
  const encoded = [...source].map((ch) => {
    if (!isWide(ch.codePointAt(0)!)) return ch
    if (!index.has(ch)) {
      index.set(ch, table.length)
      table.push(ch)
    }
    return String.fromCharCode(0xe000 + index.get(ch)!) + FILL
  }).join('')
  const art = renderMermaidASCII(encoded, { colorMode: 'none' })
  return art.replace(/([-])/g, (_, p: string) => table[p.charCodeAt(0) - 0xe000] ?? p)
}

// 그릴 수 없으면(모르는 종류, 빈 결과, 화면보다 넓음) undefined 를 돌려 원문 펜스를 남긴다.
function draw(source: string, maxColumns: number): string | undefined {
  let art: string
  try {
    art = renderWide(source)
  } catch {
    return undefined
  }
  const lines = art.replace(/\s+$/, '').split('\n').map((l) => l.replace(/\s+$/, ''))
  if (lines.every((l) => l === '')) return undefined
  if (Math.max(...lines.map(cellWidth)) > maxColumns) return undefined
  return lines.join('\n')
}

export const register: Register = (on) => {
  on('ui.render', { component: 'AssistantMessage' }, ($, e, next) => {
    if (e.surface !== 'terminal' || !e.props.text.includes('```mermaid')) return next(e)
    const maxColumns = (e.viewport?.columns ?? FALLBACK_COLUMNS) - GUTTER
    const text = e.props.text.replace(FENCE, (fence, source: string) => {
      const art = draw(source, maxColumns)
      return art === undefined ? fence : '```text\n' + art + '\n```'
    })
    return text === e.props.text ? next(e) : next({ ...e, props: { ...e.props, text } })
  })

  // mod 가 켜져 있고 터미널이 그릴 때만 Claude 에게 mermaid 를 써도 된다고 알린다.
  on('prompt.compose', async ($, e, next) => {
    const result = await next(e)
    if (!e.surfaces.includes('terminal')) return result
    return { sections: [...result.sections, GUIDE] }
  })
}
