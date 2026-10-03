#!/usr/bin/env python3
"""Five paired repeats through the installed local gateway; no credentials in results."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parent.parent
GATEWAY = Path.home() / '.config/megacode-gateway'
TASKS = ['range-parser', 'inventory-transaction', 'log-recovery']
MODEL = 'gpt-6-astra'
REPEATS = 5


def read_json(path):
    return json.loads(path.read_text())


def source_hashes():
    paths = [ROOT / 'bench/megacode.ts', ROOT / 'bench/run.ts', ROOT / 'bench/tasks.ts', ROOT / 'src/composition.ts']
    paths += list((ROOT / 'src/core').glob('*.ts'))
    paths += [p for p in (ROOT / 'src/adapters').rglob('*.ts') if p.name != 'update.ts']
    return {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(paths)}


def gateway_policy():
    config = read_json(GATEWAY / 'config.yaml')
    assert config['server']['host'] == '127.0.0.1' and config['server']['port'] == 8317
    assert len(list((GATEWAY / 'auth').glob('*.json'))) == 1, 'Use exactly one upstream account'
    assert config['routing']['retry']['request-retry'] == 0
    rules = config['requests']['payload']['override']
    assert len(rules) == 1 and rules[0]['models'] == [{'name': MODEL, 'protocol': 'codex'}]
    assert rules[0]['params']['reasoning.effort'] == 'medium'
    # Deliberately omit keys, OAuth data, account identity and machine-specific credential paths.
    return {k: config[k] for k in ('config-version', 'server', 'routing', 'requests', 'upstream', 'observability')}


def normalized_claude(transcript):
    events = []
    for line in transcript.read_text().splitlines():
        try:
            events.append(json.loads(line))
        except ValueError:
            pass
    result = next((e for e in reversed(events) if e.get('type') == 'result'), None)
    calls = {}
    for event in events:
        if event.get('type') == 'assistant':
            for block in event.get('message', {}).get('content', []):
                if block.get('type') == 'tool_use':
                    calls[block['id']] = block['name']
    if result is None:
        return {'nativeResultMissing': True, 'normalizedUsage': None, 'toolCalls': len(calls)}
    usage = result.get('usage', {})
    breakdown = {name: usage.get(key, 0) for name, key in [
        ('uncached', 'input_tokens'), ('cacheRead', 'cache_read_input_tokens'), ('cacheCreation', 'cache_creation_input_tokens')]}
    return {
        'nativeError': result.get('is_error'), 'nativeTerminalReason': result.get('terminal_reason'),
        'normalizedUsage': {'input': sum(breakdown.values()), 'output': usage.get('output_tokens', 0), 'inputBreakdown': breakdown},
        'reportedModels': list(result.get('modelUsage', {})),
        'nativeApiMs': result.get('duration_api_ms'), 'nativeDurationMs': result.get('duration_ms'),
        'nativeTurns': result.get('num_turns'), 'toolCalls': len(calls), 'tools': list(calls.values()),
    }


def main():
    os.umask(0o077)
    subprocess.run([str(Path.home() / '.local/bin/megacode-gateway'), 'status'], check=True)
    policy = gateway_policy()
    hashes = source_hashes()
    stamp = datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z').replace(':', '-')
    directory = ROOT / '.bench' / (stamp + '-gateway-comparison')
    directory.mkdir(parents=True)
    node = shutil.which('node')
    assert node
    claude = str(Path.home() / '.local/bin/claude-astra')
    command = [claude, '--print', '--dangerously-skip-permissions', '--no-session-persistence', '--output-format', 'stream-json', '--verbose']
    manifest = {
        'startedAt': stamp, 'model': MODEL, 'effort': 'medium', 'repeats': REPEATS,
        'gatewayVersion': '8.0.13', 'gatewayPolicy': policy, 'sourceHashes': hashes,
        'claudeVersion': subprocess.check_output([str(Path.home() / '.local/bin/claude'), '--version'], text=True).strip(),
        'nodeVersion': subprocess.check_output([node, '--version'], text=True).strip(),
        'gatewayConfigHash': hashlib.sha256(json.dumps(policy, sort_keys=True).encode()).hexdigest(),
        'processDeadlineMs': 300_000, 'megacodeAgentDeadlineMs': 300_000,
        'order': 'Per task: megacode then Claude in odd repeats, reversed in even repeats',
        'results': [], 'finished': False,
    }
    target = directory / 'results.json'

    def checkpoint():
        temporary = directory / 'results.tmp'
        temporary.write_text(json.dumps(manifest, indent=2) + '\n')
        temporary.replace(target)

    checkpoint()
    print('Comparison results: ' + str(target), flush=True)
    key = (GATEWAY / 'client-key').read_text().strip()
    for repeat in range(1, REPEATS + 1):
        for task in TASKS:
            harnesses = ['megacode', 'claude-code'] if repeat % 2 else ['claude-code', 'megacode']
            for harness in harnesses:
                assert gateway_policy() == policy, 'Gateway policy changed during experiment'
                assert source_hashes() == hashes, 'Measured source changed during experiment'
                trial = directory / f'{repeat}-{task}-{harness}'
                trial.mkdir()
                config = trial / 'megacode-config'
                config.mkdir()
                (config / 'settings.json').write_text(json.dumps({
                    'projectInstructions': False, 'promptAutocomplete': False, 'saveHistory': False,
                    'effort': 'medium', 'maxSteps': 50, 'permissionMode': 'yolo',
                    'bashTimeoutMs': 120_000, 'maxToolOutput': 12_000,
                }))
                env = dict(os.environ)
                env.update({'MEGACODE_CONFIG_DIR': str(config), 'BENCH_AGENT_TIMEOUT_MS': '300000',
                            'ANTHROPIC_BASE_URL': 'http://127.0.0.1:8317', 'ANTHROPIC_API_KEY': key,
                            'NO_PROXY': '127.0.0.1,localhost', 'no_proxy': '127.0.0.1,localhost'})
                for name in ['ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_CUSTOM_HEADERS']:
                    env.pop(name, None)
                args = [node, '--import', 'tsx', str(ROOT / 'bench/run.ts'), '--model',
                        'anthropic:' + MODEL if harness == 'megacode' else MODEL,
                        '--task', task, '--label', f'gateway-{harness}-r{repeat}']
                args += ['--effort', 'medium'] if harness == 'megacode' else ['--command', json.dumps(command)]
                print(f'Running {repeat}/{REPEATS} {task} {harness}', flush=True)
                with (trial / 'runner.log').open('w') as output:
                    run = subprocess.run(args, cwd=ROOT, env=env, stdout=output, stderr=subprocess.STDOUT, timeout=360)
                log = (trial / 'runner.log').read_text()
                run_dir = next((Path(line.removeprefix('Results: ')) for line in log.splitlines() if line.startswith('Results: ')), None)
                if run.returncode or run_dir is None or not (run_dir / 'results.json').exists():
                    manifest['results'].append({'repeat': repeat, 'task': task, 'harness': harness,
                                                'runnerFailure': True, 'runnerExit': run.returncode})
                    checkpoint()
                    raise RuntimeError('Runner infrastructure failure; see ' + str(trial / 'runner.log'))
                result = read_json(run_dir / 'results.json')['results'][0]
                result.update({'repeat': repeat, 'harness': harness, 'effort': 'medium',
                               'artifactDirectory': str(run_dir.relative_to(ROOT))})
                if harness == 'claude-code':
                    result['diagnostics'] = normalized_claude(run_dir / (task + '-1') / 'transcript.txt')
                else:
                    metrics = result.get('metrics')
                    result['diagnostics'] = {
                        'normalizedUsage': metrics.get('usage') if metrics else None,
                        'reportedModels': sorted({t['responseModel'] for t in metrics['modelTimings'] if t.get('responseModel')}) if metrics else [],
                    }
                manifest['results'].append(result)
                checkpoint()
                print(f"  passed={result['passed']} checks={result['checksPassed']} wall={result['elapsedMs']/1000:.3f}s exit={result['agentExit']}", flush=True)
    manifest['finished'] = True
    manifest['completedAt'] = datetime.now(timezone.utc).isoformat()
    checkpoint()
    print('Finished all 30 attempts: ' + str(target), flush=True)


if __name__ == '__main__':
    main()
