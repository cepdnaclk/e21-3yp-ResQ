import { useCallback, useEffect, useState } from "react";
import { fetchCloudSessions, type CloudSessionRecord } from "../api/cloudApi";

export function useCloudSessions() {
  const [sessions, setSessions] = useState<CloudSessionRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setSessions(await fetchCloudSessions());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load cloud sessions.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { sessions, isLoading, error, reload: load };
}
