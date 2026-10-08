import type { EngineInterface, PluginOptions, Register } from 'claude-code'

// git 커밋 명령과, 메시지를 파일로 넘기는 -F/--file 인자
const COMMIT = /\bgit\b[^\n]*\bcommit\b/
const MESSAGE_FILE = /(?:^|\s)(?:-F|--file)(?:=|\s+)(["']?)([^\s"']+)\1/g
const CO_AUTHOR = /co-authored-by:/i
const NO_CO_AUTHOR = 'Co-Authored-By 줄이 든 커밋은 막아 두었다. 그 줄을 빼고 다시 커밋한다.'

type Rules = { pattern?: RegExp; reason: string; broken?: string }

function rulesOf(options: PluginOptions): Rules {
  const rules: Rules = { reason: String(options.blockedReason) }
  const source = String(options.blockedPattern).trim()
  if (source === '') return rules
  try {
    rules.pattern = new RegExp(source, 'i')
  } catch {
    rules.broken = source
  }
  return rules
}

async function denyOf($: EngineInterface, command: string, rules: Rules): Promise<string | undefined> {
  // 패턴이 정규식으로 읽히지 않으면 모든 명령을 막는다. 건너뛰면 막으려던 명령이 그냥 돈다
  if (rules.broken !== undefined) {
    return `${$.plugin.name}: 설정의 패턴 \`${rules.broken}\` 이 정규식으로 읽히지 않아 모든 명령을 막고 있다. 사용자에게 설정을 고쳐 달라고 알린다.`
  }
  const hit = rules.pattern?.exec(command)
  if (hit) return `${rules.reason} (${$.plugin.name}: \`${hit[0].trim()}\` 에 걸림)`

  if (!COMMIT.test(command)) return undefined
  if (CO_AUTHOR.test(command)) return NO_CO_AUTHOR
  for (const [, , path] of command.matchAll(MESSAGE_FILE)) {
    if (path === '-') continue
    // 못 읽는 파일은 git 도 못 읽어 커밋이 실패하므로 통과시킨다
    const text = await $.fs.read(path!).catch(() => '')
    if (CO_AUTHOR.test(String(text))) return NO_CO_AUTHOR
  }
  return undefined
}

export const register: Register = (on, options) => {
  const rules = rulesOf(options)

  on('tool.call', { tool: ['Bash', 'Monitor'] }, async ($, e, next) => {
    const command = e.tool === 'Bash' || e.tool === 'Monitor' ? (e.command ?? '') : ''
    const deny = await denyOf($, command, rules)
    return deny === undefined ? next(e) : { deny }
  }).catch(($, e, next) =>
    next.called ? next(e) : { deny: `${$.plugin.name}: 검사 중 오류가 나서 실행하지 않았다.` },
  )
}
