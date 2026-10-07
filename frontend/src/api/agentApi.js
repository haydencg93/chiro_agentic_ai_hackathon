import {
  approveMockCase, getMockCase, getMockCases,
  getMockSummary, rejectMockCase, runMockCase,
} from './mockApi.js';

const USE_MOCK_API = import.meta.env.VITE_USE_MOCK_API !== 'false';
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api';

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  });

  if (!response.ok) {
    let message = `Request failed with status ${response.status}.`;
    try {
      const body = await response.json();
      message = body?.message || body?.detail || message;
    } catch {
      // The response did not contain JSON. Keep the generic message.
    }
    throw new Error(message);
  }

  return response.json();
}

export const agentApi = {
  getSummary() {
    return USE_MOCK_API ? getMockSummary() : request('/summary');
  },

  getCases() {
    return USE_MOCK_API ? getMockCases() : request('/cases');
  },

  getCase(caseId) {
    return USE_MOCK_API ? getMockCase(caseId) : request(`/cases/${caseId}`);
  },

  runCase(caseId) {
    return USE_MOCK_API
      ? runMockCase(caseId)
      : request(`/cases/${caseId}/run`, { method: 'POST' });
  },

  approveCase(caseId) {
    return USE_MOCK_API
      ? approveMockCase(caseId)
      : request(`/cases/${caseId}/approve`, { method: 'POST' });
  },

  rejectCase(caseId) {
    return USE_MOCK_API
      ? rejectMockCase(caseId)
      : request(`/cases/${caseId}/reject`, { method: 'POST' });
  },
};

export const apiMode = USE_MOCK_API ? 'MOCK' : 'LIVE';
