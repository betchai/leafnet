// Thin typed wrapper around the Node API. The frontend never talks to the
// Python ML service directly — always through the API.
const BASE = "/api";

// ---- authentication state (kept in sync with AuthContext) ----
let authToken: string | null = null;

export function getAuthToken(): string | null {
  return authToken;
}
export function setAuthToken(t: string | null): void {
  authToken = t;
}

export function authHeaders(): Record<string, string> {
  return authToken ? { Authorization: `Bearer ${authToken}` } : {};
}

/**
 * fetch() with the bearer token attached and centralized 401 handling.
 * When a session expires the app navigates to /login.
 */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (authToken && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${authToken}`);
  }
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  if (res.status === 401 && !path.startsWith("/auth/")) {
    window.dispatchEvent(new Event("leafnet:unauthorized"));
  }
  return res;
}

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: "FARMER" | "RESEARCHER" | "EXPERT";
}

export const authApi = {
  login: async (email: string, password: string) => {
    const res = await fetch(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) return { ok: false as const, error: data.error ?? "Login failed." };
    return { ok: true as const, token: data.token as string, user: data.user as AuthUser };
  },
  me: async () => {
    const res = await apiFetch("/auth/me");
    if (!res.ok) return null;
    const data = await res.json();
    return data.user as AuthUser;
  },
  logout: async () => {
    await apiFetch("/auth/logout", { method: "POST" }).catch(() => {});
  },
};

export interface ManagedUser {
  id: string;
  name: string;
  email: string;
  role: "FARMER" | "RESEARCHER" | "EXPERT";
  status: "ACTIVE" | "DISABLED";
  createdAt: string | null;
  lastLoginAt: string | null;
}

export const userApi = {
  list: async () => {
    const res = await apiFetch("/users");
    if (!res.ok) throw new Error((await res.json()).error ?? "Could not load users");
    return (await res.json()) as { items: ManagedUser[]; count: number };
  },
  create: async (body: { name: string; email: string; password: string; role: string }) => {
    const res = await apiFetch("/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Could not create user");
    return data.user as ManagedUser;
  },
  update: async (id: string, body: { name?: string; role?: string; status?: string }) => {
    const res = await apiFetch(`/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Could not update user");
    return data.user as ManagedUser;
  },
  resetPassword: async (id: string, password: string) => {
    const res = await apiFetch(`/users/${id}/password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Could not reset password");
    return data;
  },
};

export interface ExplanationCriterion {
  key: string;
  label: string;
  description: string;
  value: string | number | boolean;
  unit: string;
  supports: "top" | "second" | "inconclusive";
  supports_class?: string | null;
}

async function get<T>(path: string): Promise<T> {
  const res = await apiFetch(path);
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return res.json();
}

export interface ClassDef {
  key: string;
  id: number;
  label: string;
  description?: string;
  display_name?: string;
  category?: string;
  enabled?: boolean;
  visual_indicators?: string[];
  annotation_guidance?: string;
  confounding_conditions?: string[];
  definition_confidence?: string;
  evidence_sources?: string[];
}

export interface ClassConfig {
  datasetVersion: string | null;
  classes: ClassDef[];
}

export interface ImageRow {
  id: string;
  filename: string;
  storagePath: string;
  annotationStatus: string;
  isDevFixture: boolean;
  source?: string | null;
  classifications: { classKey: string }[];
  annotations?: {
    preliminaryLabel: string | null;
    annotator: string | null;
    annotatedAt: string | null;
    reviewNotes: string | null;
  }[];
  predictions?: {
    predictedClass: string;
    confidence: number | null;
    createdAt: string;
    modelVersion?: { version: string } | null;
  }[];
}

export type Verdict = "agree" | "disagree" | "unsure";

export interface FeedbackRow {
  verdict?: Verdict | null;
  isCorrect?: boolean | null;
  correctedClass?: string | null;
  comment?: string | null;
}

export interface PredictionHistoryRow {
  predictionId: string;
  imageId: string;
  filename: string;
  predictedClass: string;
  confidence: number | null;
  modelVersion: string | null;
  createdAt: string;
}

export interface AuthUserPayload extends AuthUser {}

export const api = {
  health: () =>
    get<{ status: string; mlServiceConnected: boolean }>("/health"),
  classes: () => get<ClassConfig>("/classes"),
  images: (params = "") => get<{ items: unknown[]; count: number }>(`/images${params}`),
  datasets: () => get<{ items: unknown[]; count: number }>("/datasets"),
  models: () =>
    get<{
      items: {
        version: string;
        architecture?: string;
        datasetVersion?: string;
        trainingDate?: string | null;
        accuracy?: number | null;
        f1Score?: number | null;
        isActive: boolean;
      }[];
      count: number;
      note?: string;
    }>("/models"),

  // ---- Phase 8 application surface ----
  predictionHistory: (limit = 20) =>
    get<{ items: PredictionHistoryRow[]; count: number }>(`/predictions?limit=${limit}`),

  uploadAndPredict: async (
    file: File,
    meta: Record<string, string>
  ): Promise<
    | { ok: true; predictionId: string; predictedClass: string; confidence: number;
        probabilities: Record<string, number>; reviewRecommended: boolean;
        modelVersion: string | null; disclaimer: string }
    | { ok: false; error: string }
  > => {
    const fd = new FormData();
    fd.append("image", file);
    Object.entries(meta).forEach(([k, v]) => v && fd.append(k, v));
    try {
      const up = await apiFetch("/images", { method: "POST", body: fd });
      if (!up.ok) return { ok: false, error: `Upload failed (${up.status})` };
      const { image } = await up.json();
      const pr = await apiFetch("/predictions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageId: image.id }),
        signal: AbortSignal.timeout(30_000),
      });
      const data = await pr.json();
      if (!pr.ok) return { ok: false, error: data.error ?? `Analysis failed (${pr.status})` };
      return { ok: true, ...data };
    } catch (e) {
      const msg = (e as Error).name === "TimeoutError"
        ? "Analysis timed out. Please try again."
        : "We couldn't analyze the image right now. Please try again.";
      return { ok: false, error: msg };
    }
  },

  sendFeedback: async (
    predictionId: string,
    body: { verdict: Verdict; correctedClass?: string; comment?: string }
  ) => {
    try {
      const res = await apiFetch(`/predictions/${predictionId}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return { ok: res.ok, data: await res.json() };
    } catch {
      return { ok: false, data: { error: "network error" } };
    }
  },

  explainPrediction: async (
    predictionId: string
  ): Promise<
    | {
        ok: true;
        predictedClass: string;
        secondClass: string | null;
        saliencyBase64: string;
        criteria: ExplanationCriterion[];
      }
    | { ok: false; error: string }
  > => {
    try {
      const res = await apiFetch(`/predictions/${predictionId}/explain`, {
        method: "POST",
        signal: AbortSignal.timeout(30_000),
      });
      const data = await res.json();
      if (!res.ok) return { ok: false, error: data.error ?? `Explanation failed (${res.status})` };
      return { ok: true, ...data };
    } catch (e) {
      const msg = (e as Error).name === "TimeoutError"
        ? "Explanation timed out. Please try again."
        : "Explanation could not be generated. Please try again.";
      return { ok: false, error: msg };
    }
  },
};

// TOOLS: extended API surface used only by the Tools section
export const toolsApi = {
  ...api,
  imagesByStatus: (status: string) =>
    get<{ items: ImageRow[]; count: number }>(
      `/images?annotationStatus=${encodeURIComponent(status)}`
    ),
  imageUrl: (id: string) => `${BASE}/images/${id}/file`,
  upload: async (
    file: File,
    meta: Record<string, string>
  ): Promise<{ ok: boolean; data: Record<string, unknown> }> => {
    const fd = new FormData();
    fd.append("image", file);
    Object.entries(meta).forEach(([k, v]) => v && fd.append(k, v));
    const res = await apiFetch("/images", { method: "POST", body: fd });
    return { ok: res.ok, data: await res.json() };
  },
  annotate: async (
    id: string,
    body: { label: string; confidence?: number }
  ) => {
    const res = await apiFetch(`/images/${id}/annotations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { ok: res.ok, data: await res.json() };
  },
  review: async (id: string, body: { action: string; label?: string; reason?: string }) => {
    const res = await apiFetch(`/images/${id}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { ok: res.ok, data: await res.json() };
  },
};