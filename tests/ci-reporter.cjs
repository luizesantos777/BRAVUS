'use strict';

// Reporter auxiliar de CI: sem alterar a saída principal, emite anotações GitHub
// (::error file=...) para cada teste e2e que falhar, com título + 3 primeiras linhas
// do erro. As anotações ficam visíveis na check-run mesmo sem abrir o log.
// Uso (CI): npx playwright test --reporter=line,./tests/ci-reporter.cjs

const MAX_ANNOTATIONS = 20;

function esc(s) {
  return String(s)
    .replace(/%/g, '%25')
    .replace(/\r/g, '')
    .replace(/\n/g, ' %0A ')
    .replace(/[\u0000-\u001f]/g, ' ')
    .trim();
}

function stripAnsi(s) {
  return String(s).replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');
}

function titleOf(test, project) {
  const tp = typeof test.titlePath === 'function' ? test.titlePath() : test.titlePath;
  const arr = (Array.isArray(tp) ? tp.slice() : [test.title || '']).filter(Boolean);
  if (project && arr.length > 1 && arr[0] === project) arr.shift(); // título já embute o projeto
  return arr.join(' › ');
}

function projectNameOf(test) {
  let s = test.parent;
  while (s) {
    if (s.type === 'project') return s.title || '';
    s = s.parent;
  }
  return '';
}

class CiAnnotationsReporter {
  constructor() {
    this.failed = [];
  }

  onTestEnd(test, result) {
    if (result.status === 'passed') return;
    const loc = test.location || {};
    const project = projectNameOf(test);
    const title = titleOf(test, project);
    let first = '';
    if (result.errors && result.errors[0]) {
      first = stripAnsi(result.errors[0].message || '')
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .slice(0, 3)
        .join(' | ');
    }
    const kind = result.status === 'timedOut' ? 'timeout' : result.status;
    this.failed.push({
      file: loc.file || '',
      line: loc.line || 1,
      msg: `E2E ${kind}${project ? ' [' + project + ']' : ''} ${title}${first ? ' — ' + first : ''}`,
    });
  }

  onEnd() {
    if (!process.env.GITHUB_ACTIONS) return; // silencioso fora da CI
    const cwd = process.cwd().replace(/\\/g, '/') + '/';
    const write = (line, file, msg) => {
      process.stdout.write(`::error file=${file},line=${line},col=1 title=E2E falhou::${esc(msg)}\n`);
    };
    const shown = Math.min(this.failed.length, MAX_ANNOTATIONS);
    for (let i = 0; i < shown; i++) {
      const f = this.failed[i];
      const rel = f.file.replace(/\\/g, '/');
      const path = rel.startsWith(cwd) ? rel.slice(cwd.length) : rel;
      write(f.line, path || 'tests', f.msg.slice(0, 500));
    }
    if (this.failed.length > MAX_ANNOTATIONS) {
      write(1, 'playwright.config.ts', `${this.failed.length} testes e2e falharam (mostrando ${MAX_ANNOTATIONS}); veja o log completo do job.`);
    }
  }
}

module.exports = CiAnnotationsReporter;
module.exports.default = CiAnnotationsReporter;