import { describe, expect, mock, test, type TestBody } from 'claude-code/testing'

type Engine = Parameters<TestBody>[0]
type On = Parameters<TestBody>[1]

const PANE = {
  component: 'Pane',
  surface: 'terminal',
  requestId: 'omf-panel',
  viewport: { columns: 180, rows: 48, isFullscreen: true },
  props: { title: 'omf 진행', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 44 }, view: {} },
} as const
const RUN = { command: 'omf-panel', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 180 } } as const
const PLAN = (status: string) => `# plan\n\n## 태스크 목록\n\n## Status: ${status}\n`

describe('omf-panel', () => {
  // 엔진 자리에서 가짜 폴더를 보여 준다. 파일 목록에서 폴더를 추려 낸다
  function world(on: On, files: Record<string, string>, cwd: string) {
    const seen = { lists: 0, panes: [] as string[] }
    const isDir = (path: string) => Object.keys(files).some((file) => file.startsWith(`${path}/`))
    on('session.start', (_$, e) => ({ cwd: e.cwd }))
    on('session.cwd', () => ({ value: cwd }))
    on('fs.exists', (_$, e) => ({ value: e.path in files || isDir(e.path) }))
    on('fs.read', (_$, e) => {
      const text = files[e.path]
      return text === undefined ? { deny: `ENOENT: ${e.path}` } : { value: text }
    })
    on('fs.list', (_$, e) => {
      seen.lists += 1
      if (!isDir(e.path)) return { deny: `ENOENT: ${e.path}` }
      const kinds = new Map<string, 'file' | 'dir'>()
      for (const file of Object.keys(files).filter((f) => f.startsWith(`${e.path}/`))) {
        const rest = file.slice(e.path.length + 1)
        kinds.set(rest.split('/')[0]!, rest.includes('/') ? 'dir' : 'file')
      }
      return { value: [...kinds].map(([name, kind]) => ({ name, kind, size: 0, mtimeMs: 0, isLink: false })) }
    })
    on('command.register', (_$, e) => ({ value: { command: e.name } }))
    on('ui.open', (_$, e) => {
      seen.panes.push(e.id)
      return { value: { isPlaced: true } } as never
    })
    on('ui.panes', () => ({
      value: seen.panes.map((id) => ({ id, title: id, isShown: true, isFocused: false, isPlaced: true })),
    }) as never)
    on('ui.invalidate', () => ({ value: undefined }))
    return seen
  }

  const textOf = (node: unknown): string => {
    if (typeof node === 'string') return node
    if (Array.isArray(node)) return node.map(textOf).join('')
    if (node !== null && typeof node === 'object' && 'children' in node) {
      const children = textOf((node as { children: unknown }).children)
      return (node as { type?: string }).type === 'Text' ? `${children}\n` : children
    }
    return ''
  }

  async function opened($: Engine, cwd: string): Promise<string> {
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd })
    await $.command.run(RUN)
    return textOf(await $.ui.render(PANE))
  }

  test('worktree 의 진행 중 task 단계와 계획 승인 여부를 보여 준다', async ($, on) => {
    mock.clock(on)
    const t = '/w/.worktrees/20261008-a/docs/plans/active/20261008-a'
    world(on, {
      '/w/.harness/config.yaml': '',
      '/w/.harness/active-plans/20261008-a': '',
      [`${t}/01-plan.md`]: PLAN('APPROVED'),
      [`${t}/02-dev-log.md`]: '',
    }, '/w')
    const shown = await opened($, '/w')
    expect(shown).toContain('w\n')
    expect(shown).toContain('  20261008-a\n')
    expect(shown).toContain('01 계획  ✓ APPROVED')
    expect(shown).toContain('02 개발  ✓')
    expect(shown).toContain('03 리뷰  -')
    expect(shown).toContain('05 완료  -')
  })

  test('메인 체크아웃의 경량 task 는 리뷰·완료를 생략으로 표시한다', async ($, on) => {
    mock.clock(on)
    const t = '/w/docs/plans/active/20261008-b'
    world(on, { '/w/.harness/config.yaml': '', [`${t}/.light`]: '', [`${t}/01-plan.md`]: PLAN('DRAFT') }, '/w')
    const shown = await opened($, '/w')
    expect(shown).toContain('20261008-b (메인 체크아웃)')
    expect(shown).toContain('01 계획  ✓ DRAFT')
    expect(shown).toContain('03 리뷰  - 경량 생략')
    expect(shown).toContain('04 검증  -\n')
  })

  test('여러 레포를 담은 폴더에서 열면 두 단계 아래 레포까지 모두 보여 준다', async ($, on) => {
    mock.clock(on)
    world(on, {
      '/ws/ai/back/.harness/config.yaml': '',
      '/ws/ai/back/.harness/active-plans/20261008-c': '',
      '/ws/ai/back/docs/plans/active/20261008-c/01-plan.md': PLAN('DRAFT'),
      '/ws/erp/web/.harness/config.yaml': '',
      '/ws/docs/common/report.html': '',
    }, '/ws')
    const shown = await opened($, '/ws')
    expect(shown).toContain('back\n  20261008-c')
    expect(shown).toContain('web\n  진행 중인 task 없음')
  })

  test('worktree 안에서 연 세션은 원래 레포를 기준으로 읽는다', async ($, on) => {
    mock.clock(on)
    const t = '/w/.worktrees/20261008-a/docs/plans/active/20261008-a'
    world(on, { '/w/.harness/active-plans/20261008-a': '', [`${t}/01-plan.md`]: PLAN('APPROVED') }, '/w/.worktrees/20261008-a')
    expect(await opened($, '/w/.worktrees/20261008-a')).toContain('01 계획  ✓ APPROVED')
  })

  test('omf 레포가 없으면 그렇게 말한다', async ($, on) => {
    mock.clock(on)
    world(on, { '/x/README.md': '' }, '/x')
    expect(await opened($, '/x')).toContain('omf 레포를 찾지 못했다')
  })

  test('열려 있는 동안 5초마다 다시 읽고, 닫으면 멈춘다', async ($, on) => {
    const clock = mock.clock(on)
    const t = '/w/docs/plans/active/20261008-d'
    const files: Record<string, string> = { '/w/.harness/config.yaml': '', [`${t}/01-plan.md`]: PLAN('APPROVED') }
    const seen = world(on, files, '/w')
    expect(await opened($, '/w')).toContain('02 개발  -')

    files[`${t}/02-dev-log.md`] = ''
    await clock.advance(5000)
    expect(textOf(await $.ui.render(PANE))).toContain('02 개발  ✓')

    seen.panes = [] // 사람이 패널을 닫았다
    const before = seen.lists
    await clock.advance(15000)
    expect(seen.lists).toBe(before)
  })
})
