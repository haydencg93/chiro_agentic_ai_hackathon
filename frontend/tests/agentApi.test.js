import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const jsonResponse = (body, init = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });

async function loadLive() {
  vi.stubEnv('VITE_USE_MOCK_API', 'false');
  vi.stubEnv('VITE_API_BASE_URL', 'http://api.test/api');
  vi.resetModules();
  return import('../src/api/agentApi.js');
}

describe('explicit mock mode', () => {
  beforeEach(() => { vi.stubEnv('VITE_USE_MOCK_API', 'true'); vi.resetModules(); });

  it('reports MOCK and never calls fetch', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { agentApi, apiMode } = await import('../src/api/agentApi.js');
    expect(apiMode).toBe('MOCK');
    const { cases } = await agentApi.getCases();
    expect(cases.length).toBeGreaterThan(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('live mode', () => {
  let fetchSpy;
  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });
  afterEach(() => vi.useRealTimers());

  it('reports LIVE when VITE_USE_MOCK_API is "false"', async () => {
    const { apiMode } = await loadLive();
    expect(apiMode).toBe('LIVE');
  });

  it('GETs the configured base URL and returns parsed JSON', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ cases: [] }));
    const { agentApi } = await loadLive();
    await expect(agentApi.getCases()).resolves.toEqual({ cases: [] });
    const [url, options] = fetchSpy.mock.calls[0];
    expect(url).toBe('http://api.test/api/cases');
    expect(options.headers['Content-Type']).toBe('application/json');
  });

  it('URL-encodes case ids so they cannot alter the path', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({}));
    const { agentApi } = await loadLive();
    await agentApi.getCase('a/b?c=1');
    expect(fetchSpy.mock.calls[0][0]).toBe('http://api.test/api/cases/a%2Fb%3Fc%3D1');
  });

  it.each([
    ['runCase', '/run'],
    ['approveCase', '/approve'],
    ['rejectCase', '/reject'],
  ])('%s sends a POST to %s', async (method, suffix) => {
    fetchSpy.mockResolvedValue(jsonResponse({ success: true }));
    const { agentApi } = await loadLive();
    await agentApi[method]('CASE-1');
    const [url, options] = fetchSpy.mock.calls[0];
    expect(url).toBe(`http://api.test/api/cases/CASE-1${suffix}`);
    expect(options.method).toBe('POST');
  });

  it('uses the server message when a request fails', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ detail: 'Case is locked.' }, { status: 409 }));
    const { agentApi } = await loadLive();
    await expect(agentApi.getCase('CASE-1')).rejects.toThrow('Case is locked.');
  });

  it('falls back to a generic message when the error body is not JSON', async () => {
    fetchSpy.mockResolvedValue(new Response('<html>boom</html>', { status: 502 }));
    const { agentApi } = await loadLive();
    await expect(agentApi.getSummary()).rejects.toThrow(/status 502/);
  });

  it('returns null for 204 responses', async () => {
    fetchSpy.mockResolvedValue(new Response(null, { status: 204 }));
    const { agentApi } = await loadLive();
    await expect(agentApi.approveCase('CASE-1')).resolves.toBeNull();
  });

  it('aborts and reports a timeout when the backend hangs', async () => {
    vi.useFakeTimers();
    fetchSpy.mockImplementation(
      (_url, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
          );
        }),
    );
    const { agentApi } = await loadLive();
    const outcome = expect(agentApi.getSummary()).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(90001);
    await outcome;
  });
});
