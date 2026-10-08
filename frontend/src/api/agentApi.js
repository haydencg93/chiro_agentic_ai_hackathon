const USE_MOCK_API = import.meta.env.VITE_USE_MOCK_API !== 'false';

// Relative '/api' in production (same origin / reverse proxy); localhost only in dev.
// Override with VITE_API_BASE_URL. Never put tokens or secrets in VITE_* variables:
// they are bundled into the browser and visible to everyone.
const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  (import.meta.env.DEV ? 'http://localhost:8000/api' : '/api');

const DEFAULT_TIMEOUT_MS = 15000;
const RUN_TIMEOUT_MS = 90000;

// Loaded lazily so the mock layer is not part of the bundle when running LIVE.
const loadMock = () => import('./mockApi.js');

async function request(path, { timeoutMs = DEFAULT_TIMEOUT_MS, headers, ...options } = {}) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      let message = `Request failed with status ${response.status}.`;
      try {
        const body = await response.json();
        const detail = body?.message || body?.detail;
        if (typeof detail === 'string') message = detail;
      } catch {
        // The response did not contain JSON. Keep the generic message.
      }
      throw new Error(message);
    }

    if (response.status === 204) return null;
    return await response.json();
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('The request timed out. Please try again.');
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

const caseUrl = (caseId) => `/cases/${encodeURIComponent(caseId)}`;

export const agentApi = {
  async getSummary() {
    return USE_MOCK_API ? (await loadMock()).getMockSummary() : request('/summary');
  },

  async getCases() {
    return USE_MOCK_API ? (await loadMock()).getMockCases() : request('/cases');
  },

  async getCase(caseId) {
    return USE_MOCK_API ? (await loadMock()).getMockCase(caseId) : request(caseUrl(caseId));
  },

  async runCase(caseId) {
    return USE_MOCK_API
      ? (await loadMock()).runMockCase(caseId)
      : request(`${caseUrl(caseId)}/run`, { method: 'POST', timeoutMs: RUN_TIMEOUT_MS });
  },

  async approveCase(caseId) {
    return USE_MOCK_API
      ? (await loadMock()).approveMockCase(caseId)
      : request(`${caseUrl(caseId)}/approve`, { method: 'POST' });
  },

  async rejectCase(caseId) {
    return USE_MOCK_API
      ? (await loadMock()).rejectMockCase(caseId)
      : request(`${caseUrl(caseId)}/reject`, { method: 'POST' });
  },
};

export const apiMode = USE_MOCK_API ? 'MOCK' : 'LIVE';
