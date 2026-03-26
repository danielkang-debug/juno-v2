/**
 * api.js — Fetch wrapper with auth handling
 */

async function request(path, options = {}) {
    const { method = 'GET', body, params } = options;

    let url = path;
    if (params) {
        const qs = new URLSearchParams(params).toString();
        url += '?' + qs;
    }

    const fetchOpts = {
        method,
        headers: {},
        credentials: 'same-origin',
    };

    if (body) {
        fetchOpts.headers['Content-Type'] = 'application/json';
        fetchOpts.body = JSON.stringify(body);
    }

    const response = await fetch(url, fetchOpts);

    if (response.status === 401) {
        window.dispatchEvent(new CustomEvent('juno:unauthorized'));
        throw new Error('Unauthorized');
    }

    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.error || `Request failed (${response.status})`);
    }

    return data;
}

export const api = {
    // Auth
    register: (data) => request('/api/auth/register', { method: 'POST', body: data }),
    login: (data) => request('/api/auth/login', { method: 'POST', body: data }),
    logout: () => request('/api/auth/logout', { method: 'POST' }),
    me: () => request('/api/auth/me'),
    updateMe: (data) => request('/api/auth/me', { method: 'PUT', body: data }),

    // Patients
    getPatients: (opts) => request('/api/patients', { params: opts }),
    createPatient: (data) => request('/api/patients', { method: 'POST', body: data }),
    updatePatient: (id, data) => request(`/api/patients/${id}`, { method: 'PUT', body: data }),
    deletePatient: (id) => request(`/api/patients/${id}`, { method: 'DELETE' }),

    // Appointments
    getAppointments: (params) => request('/api/appointments', { params }),
    createAppointment: (data) => request('/api/appointments', { method: 'POST', body: data }),
    updateAppointment: (id, data) => request(`/api/appointments/${id}`, { method: 'PUT', body: data }),
    cancelAppointment: (id) => request(`/api/appointments/${id}`, { method: 'DELETE' }),
    importAppointments: (items) => request('/api/appointments/import', { method: 'POST', body: { items } }),

    // Routes
    optimizeRoute: (data) => request('/api/routes/optimize', { method: 'POST', body: data }),
    recalculateRoute: (data) => request('/api/routes/recalculate', { method: 'POST', body: data }),
    getRoute: (date) => request(`/api/routes/${date}`),

    // Geocoding
    geocode: (address) => request('/api/geocode', { params: { address } }),
};
