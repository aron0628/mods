import { describe, expect, test, type TestBody } from 'claude-code/testing'

type Engine = Parameters<TestBody>[0]
type On = Parameters<TestBody>[1]

const VIEW = { columns: 120, rows: 40 }
const fence = (src: string) => 'before\n\n```mermaid\n' + src + '\n```\n\nafter'
// 한글 1자 = 2칸
const cellWidth = (s: string) => [...s].reduce((n, c) => n + (/[ᄀ-ᅟ가-힣]/.test(c) ? 2 : 1), 0)

describe('register', () => {
  // 엔진 자리에서 mod 가 넘긴 text 를 받아 두고, 받은 그대로 그린다
  async function drawn(
    $: Engine,
    on: On,
    text: string,
    opts: { surface?: 'terminal' | 'desktop'; columns?: number } = {},
  ): Promise<string> {
    let seen = ''
    on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
      seen = e.props.text
      const { Text } = $.ui.resolve(e)
      return Text({ children: [e.props.text] })
    })
    const ui = await $.ui.mount({
      plugin: 'mermaid-box',
      surface: opts.surface ?? 'terminal',
      component: 'AssistantMessage',
      props: { text, isFirstOfReply: true },
      viewport: { ...VIEW, columns: opts.columns ?? VIEW.columns },
    })
    await ui.unmount()
    return seen
  }

  test('닫힌 mermaid 펜스는 한글 라벨이 맞게 정렬된 박스 그림으로 바뀐다', async ($, on) => {
    const seen = await drawn($, on, fence('graph LR\n  A[사용자] --> B[백엔드]'))
    expect(seen).not.toContain('```mermaid')
    expect(seen).toContain('```text\n')
    expect(seen.startsWith('before\n')).toBe(true)
    expect(seen.endsWith('\nafter')).toBe(true)
    const lines = seen.split('\n')
    const top = lines.find((l) => l.includes('┐'))
    const label = lines.find((l) => l.includes('사용자'))
    expect(top).toBeDefined()
    expect(label).toContain('백엔드')
    expect(cellWidth(label!)).toBe(cellWidth(top!))
  })

  test('스트리밍 중이라 아직 닫히지 않은 펜스는 그대로 둔다', async ($, on) => {
    const text = 'before\n\n```mermaid\ngraph LR\n  A --> B'
    expect(await drawn($, on, text)).toBe(text)
  })

  test('렌더러가 모르는 종류는 원문 펜스를 남긴다', async ($, on) => {
    const text = fence('gantt\n  title x\n  section a\n  t1 :a1, 2024-01-01, 3d')
    expect(await drawn($, on, text)).toBe(text)
  })

  test('화면보다 넓은 그림은 원문 펜스를 남긴다', async ($, on) => {
    const text = fence('graph LR\n  A[사용자] --> B[백엔드] --> C[데이터베이스]')
    expect(await drawn($, on, text, { columns: 30 })).toBe(text)
  })

  test('터미널이 아닌 곳에서는 손대지 않는다', async ($, on) => {
    const text = fence('graph LR\n  A --> B')
    expect(await drawn($, on, text, { surface: 'desktop' })).toBe(text)
  })

  test('터미널이 그릴 때만 시스템 프롬프트에 안내를 붙인다', async ($, on) => {
    on('prompt.compose', () => ({ sections: [{ id: 'base', text: 'base', scope: 'shared' }] }))
    const input = { model: 'm', promptModel: 'm', tools: [], outputStyle: null, traits: [] }
    const withTerminal = await $.prompt.compose({ ...input, surfaces: ['terminal'] })
    expect(withTerminal.sections.map((s) => s.id)).toEqual(['base', 'mermaid-box:guide'])
    const headless = await $.prompt.compose({ ...input, surfaces: [] })
    expect(headless.sections.map((s) => s.id)).toEqual(['base'])
  })
})
