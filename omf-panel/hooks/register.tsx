import type { EngineInterface, Register } from 'claude-code'

const PANE = 'omf-panel'
const POLL_MS = 5000
const STAGES = [
  { no: '01', label: '계획', file: '01-plan.md' },
  { no: '02', label: '개발', file: '02-dev-log.md' },
  { no: '03', label: '리뷰', file: '03-review.md' },
  { no: '04', label: '검증', file: '04-verify.md' },
  { no: '05', label: '완료', file: '05-complete.md' },
] as const
// 경량 경로(.light 마커)는 리뷰·완료 산출물을 만들지 않는다
const LIGHT_SKIPS: ReadonlySet<string> = new Set(['03', '05'])

type Stage = { no: string; label: string; has: boolean; note?: string }
type Task = { id: string; place: 'worktree' | 'main' | 'none'; stages: Stage[] }
type Repo = { name: string; tasks: Task[] }
type State = { repos?: Repo[]; shown: string }

/** `## Status: APPROVED` 의 값. 없으면 undefined. */
const planStatus = (text: string): string | undefined => /^#{1,6}\s*Status:\s*\**\s*([A-Za-z]+)/m.exec(text)?.[1]

const baseName = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

async function namesIn($: EngineInterface, path: string, kind?: 'dir'): Promise<string[]> {
  const entries = await $.fs.list(path).catch(() => [])
  return entries
    .filter((entry) => !entry.name.startsWith('.') && entry.name !== 'node_modules')
    .filter((entry) => kind === undefined || entry.kind === kind)
    .map((entry) => entry.name)
}

/** 세션 폴더의 레포. 여러 레포를 담은 작업 폴더면 두 단계 아래까지 `.harness` 가 있는 폴더를 찾는다. */
async function repoRootsOf($: EngineInterface, cwd: string): Promise<string[]> {
  // worktree 안에서 연 세션이면 그 worktree 를 품은 원래 레포가 기준이다
  const at = cwd.indexOf('/.worktrees/')
  const root = at < 0 ? cwd : cwd.slice(0, at)
  if (await $.fs.exists(`${root}/.harness`)) return [root]

  const found: string[] = []
  for (const a of await namesIn($, root, 'dir')) {
    const child = `${root}/${a}`
    if (await $.fs.exists(`${child}/.harness`)) {
      found.push(child)
      continue
    }
    for (const b of await namesIn($, child, 'dir')) {
      if (await $.fs.exists(`${child}/${b}/.harness`)) found.push(`${child}/${b}`)
    }
  }
  return found
}

async function taskOf($: EngineInterface, root: string, id: string): Promise<Task> {
  const inWorktree = `${root}/.worktrees/${id}/docs/plans/active/${id}`
  const inMain = `${root}/docs/plans/active/${id}`
  const dir = (await $.fs.exists(inWorktree)) ? inWorktree : (await $.fs.exists(inMain)) ? inMain : undefined
  if (dir === undefined) return { id, place: 'none', stages: [] }

  const isLight = await $.fs.exists(`${dir}/.light`)
  const stages: Stage[] = []
  for (const { no, label, file } of STAGES) {
    const has = await $.fs.exists(`${dir}/${file}`)
    const status = no === '01' && has ? planStatus(String(await $.fs.read(`${dir}/${file}`).catch(() => ''))) : undefined
    const note = status ?? (isLight && LIGHT_SKIPS.has(no) ? '경량 생략' : undefined)
    stages.push({ no, label, has, ...(note !== undefined && { note }) })
  }
  return { id, place: dir === inWorktree ? 'worktree' : 'main', stages }
}

async function reposOf($: EngineInterface): Promise<Repo[]> {
  const repos: Repo[] = []
  for (const root of await repoRootsOf($, await $.session.cwd())) {
    // 진행 중 task = active-plans 마커 + 메인 체크아웃의 docs/plans/active 폴더
    const ids = new Set([
      ...(await namesIn($, `${root}/.harness/active-plans`)),
      ...(await namesIn($, `${root}/docs/plans/active`, 'dir')),
    ])
    const tasks: Task[] = []
    for (const id of [...ids].sort().reverse()) tasks.push(await taskOf($, root, id))
    repos.push({ name: baseName(root), tasks })
  }
  return repos
}

/** 다시 읽어서 달라졌을 때만 패널을 다시 그린다. */
async function refresh($: EngineInterface, state: State): Promise<void> {
  const repos = await reposOf($)
  const shown = JSON.stringify(repos)
  if (shown === state.shown) return
  state.repos = repos
  state.shown = shown
  $.ui.invalidate('ui.render')
}

const PLACE_NOTE = { worktree: '', main: ' (메인 체크아웃)', none: ' (산출물 폴더 없음)' } as const

export const register: Register = (on) => {
  const state: State = { shown: '' }

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'omf-panel',
      description: 'omf 진행 중 task 의 단계를 옆 패널에 보여 준다',
    })
    // 열림 여부는 엔진 기록으로 본다. mod 를 다시 불러와도 떠 있는 패널을 계속 갱신한다
    $.clock.every(POLL_MS, async () => {
      if ((await $.ui.panes()).some((pane) => pane.id === PANE)) await refresh($, state)
    })
    return next(e)
  })

  on('command.run', { command: 'omf-panel' }, async ($) => {
    await refresh($, state)
    await $.ui.open({ id: PANE, title: 'omf 진행' })
    return { text: 'omf 진행 패널을 열었다. 5초마다 다시 읽는다.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const repos = state.repos
    if (repos === undefined) return <Text dimColor>읽는 중…</Text>
    if (repos.length === 0) return <Text dimColor>omf 레포를 찾지 못했다 (.harness 없음)</Text>

    return (
      <Box flexDirection="column">
        {repos.map((repo) => (
          <Box flexDirection="column">
            <Text bold>{repo.name}</Text>
            {repo.tasks.length === 0 && <Text dimColor>  진행 중인 task 없음</Text>}
            {repo.tasks.map((task) => (
              <Box flexDirection="column">
                <Text>
                  {'  '}
                  {task.id}
                  {PLACE_NOTE[task.place]}
                </Text>
                {task.stages.map((stage) => (
                  <Text dimColor={!stage.has}>
                    {`    ${stage.no} ${stage.label}  ${stage.has ? '✓' : '-'}${stage.note ? ` ${stage.note}` : ''}`}
                  </Text>
                ))}
              </Box>
            ))}
            <Text> </Text>
          </Box>
        ))}
      </Box>
    )
  })
}
