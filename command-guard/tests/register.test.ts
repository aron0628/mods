import { describe, expect, test, type TestBody } from 'claude-code/testing'

type Engine = Parameters<TestBody>[0]
type On = Parameters<TestBody>[1]

const PATTERN = String.raw`(^|[\s;&|(])ENV=["']?prod\b|SECRET_DB`
const REASON = '운영 DB 금지. SQL 을 사용자에게 준다.'
const options = { blockedPattern: PATTERN, blockedReason: REASON }

describe('command-guard', () => {
  // 엔진 자리에서 실제로 실행된 명령을 받아 둔다. 막힌 명령은 여기까지 오지 않는다
  function engine(on: On, files: Record<string, string> = {}): string[] {
    const ran: string[] = []
    on('tool.call', (_$, e) => {
      if (e.tool === 'Bash' || e.tool === 'Monitor') ran.push(e.command ?? '')
      return { result: { stdout: '', stderr: '', interrupted: false } }
    })
    on('fs.read', (_$, e) => {
      const text = files[e.path]
      return text === undefined ? { deny: `ENOENT: ${e.path}` } : { value: text }
    })
    return ran
  }
  const bash = ($: Engine, command: string) => $.tool.call({ tool: 'Bash', command })

  test('패턴에 맞는 명령은 막고, 설정의 사유와 걸린 부분을 Claude 에게 준다', { options }, async ($, on) => {
    const ran = engine(on)
    const r = await bash($, 'ENV=prod uv run python scripts/check.py')
    expect(r.deny).toContain(REASON)
    expect(r.deny).toContain('`ENV=prod` 에 걸림')
    expect(ran).toEqual([])
  })

  test('대소문자를 가리지 않는다', { options }, async ($, on) => {
    const ran = engine(on)
    expect((await bash($, 'uv run python -c "q(\'select 1 from secret_db.t\')"')).deny).toContain(REASON)
    expect(ran).toEqual([])
  })

  test('패턴에 안 맞는 명령은 그대로 실행한다', { options }, async ($, on) => {
    const ran = engine(on)
    await bash($, 'uv run pytest -q')
    await bash($, 'grep -n "ENV=prod" Makefile')
    expect(ran).toEqual(['uv run pytest -q', 'grep -n "ENV=prod" Makefile'])
  })

  test('Monitor 의 명령도 같은 검사를 받는다', { options }, async ($, on) => {
    const ran = engine(on)
    const r = await $.tool.call({ tool: 'Monitor', description: 'd', timeout_ms: 1000, command: 'ENV=prod tail -f x' })
    expect(r.deny).toContain(REASON)
    expect(ran).toEqual([])
  })

  test('Co-Authored-By 가 든 커밋은 막고, 없는 커밋은 통과시킨다', async ($, on) => {
    const ran = engine(on)
    const r = await bash($, 'git commit -m "feat: x\n\nco-authored-by: Claude <noreply@anthropic.com>"')
    expect(r.deny).toContain('Co-Authored-By')
    await bash($, 'git commit -m "feat: x"')
    expect(ran).toEqual(['git commit -m "feat: x"'])
  })

  test('메시지 파일(-F)에 Co-Authored-By 가 있어도 막는다', async ($, on) => {
    const ran = engine(on, {
      '/tmp/bad.txt': 'feat: x\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n',
      '/tmp/ok.txt': 'feat: x\n',
    })
    expect((await bash($, 'git -C /repo commit -F /tmp/bad.txt')).deny).toContain('Co-Authored-By')
    expect((await bash($, 'git commit --file=/tmp/bad.txt')).deny).toContain('Co-Authored-By')
    await bash($, 'git commit -F /tmp/ok.txt')
    expect(ran).toEqual(['git commit -F /tmp/ok.txt'])
  })

  test('패턴이 정규식으로 읽히지 않으면 모든 명령을 막는다', { options: { blockedPattern: 'ok|(broken' } }, async ($, on) => {
    const ran = engine(on)
    expect((await bash($, 'ls')).deny).toContain('(broken')
    expect(ran).toEqual([])
  })

  test('패턴을 비워 두면 커밋 검사만 한다', async ($, on) => {
    const ran = engine(on)
    await bash($, 'ENV=prod make prod')
    expect(ran).toEqual(['ENV=prod make prod'])
  })
})
