export type BackendHealth = {
  status: string;
};

export type BackendSimSummary = {
  steps_run: number;
  total_agents: number;
  exited_agents: number;
  remaining_agents: number;
  position_history: Record<string, [number, number] | 'exited'>[];
  speech_history: Record<string, string | null>[];
};

export type BackendDefaultConfig = {
  environment: {
    width: number;
    height: number;
    deadline: number;
    llm_model: string;
    door: [number, number];
    obstacles: [number, number][];
  };
  agents: {
    name: string;
    role: string;
    personality: string;
    position: [number, number];
  }[];
};

async function parseJSON<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const raw = await response.text();
    throw new Error(raw || `Request failed with ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export async function getBackendHealth(): Promise<BackendHealth> {
  const res = await fetch('/api/health');
  return parseJSON<BackendHealth>(res);
}

export async function runDefaultBackendSimulation(): Promise<BackendSimSummary> {
  const res = await fetch('/api/simulate/default', { method: 'POST' });
  return parseJSON<BackendSimSummary>(res);
}

export async function getDefaultBackendConfig(): Promise<BackendDefaultConfig> {
  const res = await fetch('/api/config/default');
  return parseJSON<BackendDefaultConfig>(res);
}
