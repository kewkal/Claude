import axios from 'axios';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

const client = axios.create({ baseURL: BASE_URL });

client.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

client.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 && typeof window !== 'undefined') {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export const api = {
  auth: {
    login: (email: string, password: string) =>
      client.post('/api/auth/login', { email, password }).then((r) => r.data),
    register: (name: string, email: string, password: string) =>
      client.post('/api/auth/register', { name, email, password }).then((r) => r.data),
  },
  contacts: {
    list: (search?: string) =>
      client.get('/api/contacts', { params: search ? { search } : {} }).then((r) => r.data),
    create: (data: Record<string, unknown>) =>
      client.post('/api/contacts', data).then((r) => r.data),
    update: (id: string, data: Record<string, unknown>) =>
      client.put(`/api/contacts/${id}`, data).then((r) => r.data),
    delete: (id: string) =>
      client.delete(`/api/contacts/${id}`).then((r) => r.data),
  },
  pipelines: {
    list: () => client.get('/api/pipelines').then((r) => r.data),
    create: (name: string) => client.post('/api/pipelines', { name }).then((r) => r.data),
    getStages: (id: string) => client.get(`/api/pipelines/${id}/stages`).then((r) => r.data),
    createStage: (id: string, data: Record<string, unknown>) =>
      client.post(`/api/pipelines/${id}/stages`, data).then((r) => r.data),
  },
  deals: {
    list: () => client.get('/api/deals').then((r) => r.data),
    create: (data: Record<string, unknown>) => client.post('/api/deals', data).then((r) => r.data),
    update: (id: string, data: Record<string, unknown>) =>
      client.put(`/api/deals/${id}`, data).then((r) => r.data),
    delete: (id: string) => client.delete(`/api/deals/${id}`).then((r) => r.data),
  },
  sequences: {
    list: () => client.get('/api/sequences').then((r) => r.data),
    create: (data: Record<string, unknown>) =>
      client.post('/api/sequences', data).then((r) => r.data),
    get: (id: string) => client.get(`/api/sequences/${id}`).then((r) => r.data),
    addStep: (id: string, data: Record<string, unknown>) =>
      client.post(`/api/sequences/${id}/steps`, data).then((r) => r.data),
    updateStep: (id: string, stepId: string, data: Record<string, unknown>) =>
      client.put(`/api/sequences/${id}/steps/${stepId}`, data).then((r) => r.data),
    deleteStep: (id: string, stepId: string) =>
      client.delete(`/api/sequences/${id}/steps/${stepId}`).then((r) => r.data),
    enroll: (id: string, contactIds: string[]) =>
      client.post(`/api/sequences/${id}/enroll`, { contactIds }).then((r) => r.data),
    getEnrollments: (id: string) =>
      client.get(`/api/sequences/${id}/enrollments`).then((r) => r.data),
  },
  landingPages: {
    list: () => client.get('/api/landing-pages').then((r) => r.data),
    create: (data: Record<string, unknown>) =>
      client.post('/api/landing-pages', data).then((r) => r.data),
    get: (id: string) => client.get(`/api/landing-pages/${id}`).then((r) => r.data),
    update: (id: string, data: Record<string, unknown>) =>
      client.put(`/api/landing-pages/${id}`, data).then((r) => r.data),
    publish: (id: string) =>
      client.post(`/api/landing-pages/${id}/publish`).then((r) => r.data),
  },
  accounts: {
    list: () => client.get('/api/accounts').then((r) => r.data),
    create: (data: Record<string, unknown>) =>
      client.post('/api/accounts', data).then((r) => r.data),
  },
};
