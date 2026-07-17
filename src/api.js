// Use the Nginx same-origin proxy for every deployment.
const API_URL = "";
const request = async (path, options = {}) => {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "No se pudo conectar con la API");
  return data;
};
export const publishPlan = (plan) => request("/api/plans", { method: "POST", body: JSON.stringify(plan) });
export const updatePrescription = (id, token, plan) => request(`/api/plans/${id}/prescription`, { method: "PUT", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(plan) });
export const getStudentPlan = (token) => request(`/api/student/plans/${encodeURIComponent(token)}`);
export const getPrescriberPlan = (token) => request(`/api/prescriber/plans/${encodeURIComponent(token)}`);
export const saveExecution = (token, payload) => request(`/api/student/plans/${encodeURIComponent(token)}/execution`, { method: "PATCH", body: JSON.stringify(payload) });
export const saveSessionDate = (token, payload) => request(`/api/student/plans/${encodeURIComponent(token)}/session-date`, { method: "PATCH", body: JSON.stringify(payload) });
export const resetExecution = (token, payload) => request(`/api/student/plans/${encodeURIComponent(token)}/execution/reset`, { method: "POST", body: JSON.stringify(payload) });
export const resetPrescriberExecution = (id, token, payload) => request(`/api/plans/${id}/execution/reset`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(payload) });
