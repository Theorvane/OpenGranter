#!/usr/bin/env python3
"""Validate the planning harness without service dependencies."""

import json
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
errors = []


def fail(message):
    errors.append(message)


def load_contract(name):
    path = ROOT / 'contracts' / name
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError) as exc:
        fail(f'{path.relative_to(ROOT)}: {exc}')
        return []
    if data.get('version') != 1 or not isinstance(data.get('cases'), list) or not data['cases']:
        fail(f'{path.relative_to(ROOT)}: version=1 and nonempty cases required')
        return []
    ids = [case.get('id') for case in data['cases'] if isinstance(case, dict)]
    if len(ids) != len(data['cases']) or len(ids) != len(set(ids)) or not all(isinstance(i, str) and i for i in ids):
        fail(f'{path.relative_to(ROOT)}: case IDs must be unique nonempty strings')
    return data['cases']


def check_policy_cases(cases):
    for case in cases:
        name = case.get('id', '?')
        if not isinstance(case.get('principal_active'), bool):
            fail(f'policy {name}: principal_active must be boolean')
        if case.get('expected') not in {'Allow', 'Deny'}:
            fail(f'policy {name}: expected must be Allow or Deny')
        if not isinstance(case.get('action'), str) or ':' not in case['action']:
            fail(f'policy {name}: action required')
        if not isinstance(case.get('resource'), str) or ':' not in case['resource']:
            fail(f'policy {name}: resource required')
        if not isinstance(case.get('statements'), list):
            fail(f'policy {name}: statements must be a list')
            continue
        for statement in case['statements']:
            if statement.get('source') not in {'user', 'role'} or statement.get('effect') not in {'Allow', 'Deny'}:
                fail(f'policy {name}: invalid source/effect')
            for field in ('actions', 'resources'):
                values = statement.get(field)
                if not isinstance(values, list) or not values or not all(isinstance(v, str) and v for v in values):
                    fail(f'policy {name}: {field} must contain strings')
        if all(isinstance(s, dict) and s.get('effect') in {'Allow', 'Deny'} and
               isinstance(s.get('actions'), list) and isinstance(s.get('resources'), list)
               for s in case['statements']):
            matching = [s['effect'] for s in case['statements']
                        if any(pattern_matches(p, case['action']) for p in s['actions'])
                        and any(pattern_matches(p, case['resource']) for p in s['resources'])]
            decision = ('Deny' if not case['principal_active'] or 'Deny' in matching
                        else 'Allow' if 'Allow' in matching else 'Deny')
            if decision != case['expected']:
                fail(f'policy {name}: expected {case["expected"]}, rule yields {decision}')


def pattern_matches(pattern, value):
    if not isinstance(pattern, str) or not isinstance(value, str):
        return False
    return re.fullmatch(re.escape(pattern).replace(r'\*', '.*'), value) is not None


def check_gateway_cases(cases):
    for case in cases:
        name = case.get('id', '?')
        if case.get('request') not in {'GET /v1/models', 'GET /v1/usage', 'POST /v1/chat/completions'}:
            fail(f'gateway {name}: unsupported request')
        if not isinstance(case.get('expected_status'), int) or not 100 <= case['expected_status'] <= 599:
            fail(f'gateway {name}: invalid expected_status')
        if not isinstance(case.get('upstream_called'), bool):
            fail(f'gateway {name}: upstream_called must be boolean')
        if not isinstance(case.get('audit_action'), str) or not case['audit_action']:
            fail(f'gateway {name}: audit_action required')


def check_route_cases(cases):
    for case in cases:
        name = case.get('id', '?')
        if not isinstance(case.get('principal_active'), bool):
            fail(f'route {name}: principal_active must be boolean')
        if not isinstance(case.get('model_alias'), str) or not case['model_alias']:
            fail(f'route {name}: model_alias required')
        if case.get('route_kind') not in {'delegated', 'managed'}:
            fail(f'route {name}: invalid route_kind')
        candidates = case.get('candidates')
        if not isinstance(candidates, list) or not candidates:
            fail(f'route {name}: nonempty candidates required')
            continue
        candidate_ids = []
        for candidate in candidates:
            if not isinstance(candidate, dict):
                fail(f'route {name}: candidate must be an object')
                continue
            if candidate.get('kind') not in {'delegated', 'managed'}:
                fail(f'route {name}: invalid candidate kind')
            for field in ('id', 'upstream_model_id', 'provider_id'):
                if not isinstance(candidate.get(field), str) or not candidate[field]:
                    fail(f'route {name}: candidate {field} required')
            candidate_ids.append(candidate.get('id'))
        if len(candidate_ids) != len(set(candidate_ids)):
            fail(f'route {name}: candidate IDs must be unique')
        if not isinstance(case.get('statements'), list):
            fail(f'route {name}: statements must be a list')
        if not isinstance(case.get('expected_candidate_ids'), list) or not all(
                isinstance(v, str) for v in case['expected_candidate_ids']):
            fail(f'route {name}: expected_candidate_ids must be a string list')
        providers_by_model = case.get('expected_provider_ids_by_model')
        if not isinstance(providers_by_model, dict) or not all(
                isinstance(model, str) and isinstance(providers, list) and
                all(isinstance(provider, str) for provider in providers)
                for model, providers in providers_by_model.items()):
            fail(f'route {name}: expected_provider_ids_by_model must map models to string lists')


def check_docs():
    required = ['README.md', 'AGENTS.md', 'CLAUDE.md', 'CONTRIBUTING.md', 'CONTEXT.md', 'docs/PRD.md', 'docs/architecture.md',
                'docs/acceptance.md', 'docs/roadmap.md', 'docs/naming.md', 'docs/harness.md', 'docs/coding.md',
                'docs/adr/0001-internal-iam-policy-engine.md', 'skills/LICENSE',
                'skills/grill-with-docs/SKILL.md', 'skills/grilling/SKILL.md',
                'skills/domain-modeling/SKILL.md']
    for relative in required:
        path = ROOT / relative
        if not path.is_file() or not path.read_text(encoding='utf-8').strip():
            fail(f'{relative}: missing or empty')
    claude = ROOT / 'CLAUDE.md'
    if not claude.is_symlink() or claude.readlink() != Path('AGENTS.md'):
        fail('CLAUDE.md: must be a symlink to AGENTS.md')
    for path in [ROOT / item for item in required if (ROOT / item).is_file()]:
        content = path.read_text(encoding='utf-8')
        for target in re.findall(r'(?<!!)\[[^]]+\]\(([^)]+)\)', content):
            if target.startswith(('https://', 'http://', '#')):
                continue
            local = (path.parent / target.split('#', 1)[0]).resolve()
            if not local.is_file() or not local.is_relative_to(ROOT):
                fail(f'{path.relative_to(ROOT)}: broken link {target}')


def check_english_documents():
    paths = [ROOT / name for name in ('AGENTS.md', 'README.md', 'CONTRIBUTING.md', 'CONTEXT.md')]
    paths += list((ROOT / 'docs').rglob('*.md'))
    paths += list((ROOT / 'contracts').glob('*.json'))
    for path in paths:
        if path.is_file() and re.search(r'[\uac00-\ud7a3]', path.read_text(encoding='utf-8')):
            fail(f'{path.relative_to(ROOT)}: Korean text found; repository documents must be English')


def check_example_secrets():
    for directory in ('docs', 'contracts'):
        for path in (ROOT / directory).rglob('*'):
            if not path.is_file():
                continue
            content = path.read_text(encoding='utf-8')
            if re.search(r'\b(?:sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16})\b', content):
                fail(f'{path.relative_to(ROOT)}: possible live credential')


check_docs()
check_english_documents()
check_policy_cases(load_contract('policy_cases.json'))
check_route_cases(load_contract('route_cases.json'))
check_gateway_cases(load_contract('gateway_cases.json'))
check_example_secrets()

if errors:
    for error in errors:
        print(f'FAIL {error}', file=sys.stderr)
    sys.exit(1)
print('PASS planning docs, links, contracts, and fixture secret scan')
