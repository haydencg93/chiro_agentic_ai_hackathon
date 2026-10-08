"""Deployment routing tests; no workspace queries or model calls."""
import importlib.util
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

entry_path = Path(__file__).resolve().parents[2] / 'app.py'
spec = importlib.util.spec_from_file_location('deployed_entry', entry_path)
entry = importlib.util.module_from_spec(spec)
spec.loader.exec_module(entry)


@pytest.fixture
def client(tmp_path):
    (tmp_path / 'assets').mkdir()
    (tmp_path / 'assets' / 'app.js').write_text('console.log("REALIGN")')
    (tmp_path / 'index.html').write_text('<title>REALIGN</title>')
    (tmp_path / 'realign-favicon.png').write_bytes(b'favicon')
    return TestClient(entry.create_deployed_app(tmp_path))


def test_spa_routes_refresh_and_assets(client):
    for route in ['/', '/cases/CASE-PT0027050']:
        response = client.get(route)
        assert response.status_code == 200
        assert '<title>REALIGN</title>' in response.text
    assert client.get('/assets/app.js').status_code == 200
    assert client.get('/realign-favicon.png').status_code == 200
    assert client.get('/assets/missing.js').status_code == 404
    assert client.get('/missing.png').status_code == 404


def test_api_and_health_are_not_spa_fallback(client):
    response = client.get('/health')
    assert response.status_code == 200
    assert response.json()['orchestration_mode'] == 'llm'
    assert client.get('/api/nonexistent').status_code == 404
    assert client.post('/api/agent/run', json={'message': 'Who won the Super Bowl?'}).status_code == 403


def test_apps_runtime_does_not_select_local_profile(monkeypatch, tmp_path):
    (tmp_path / 'index.html').write_text('REALIGN')
    (tmp_path / 'assets').mkdir()
    settings_seen = []
    monkeypatch.setattr(entry, 'create_app', lambda settings: settings_seen.append(settings) or FastAPI())
    entry.create_deployed_app(tmp_path)
    assert settings_seen[0].profile is None
    assert settings_seen[0].model_endpoint == 'databricks-gpt-oss-120b'
    assert settings_seen[0].persistence_mode == 'delta'


def test_missing_build_fails_before_startup(tmp_path):
    with pytest.raises(RuntimeError, match='Production frontend missing'):
        entry.create_deployed_app(tmp_path)
