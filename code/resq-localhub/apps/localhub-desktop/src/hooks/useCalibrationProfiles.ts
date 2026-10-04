import { useCallback, useEffect, useState } from "react";
import * as api from "../api/firmwareApi";
import type { CalibrationProfileRequest, CalibrationProfileResponse } from "../types/firmware";

export function useCalibrationProfiles() {
  const [profiles, setProfiles] = useState<CalibrationProfileResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadProfiles = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.getCalibrationProfiles();
      setProfiles(list);
      setError(null);
      return list;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load calibration profiles.");
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void loadProfiles().catch(() => {}); }, [loadProfiles]);

  async function mutate(operation: Promise<CalibrationProfileResponse>) {
    const saved = await operation;
    await loadProfiles();
    return saved;
  }
  const activeProfiles = profiles.filter(profile => profile.active);
  const defaultProfile = activeProfiles.find(profile => profile.defaultProfile) ?? null;
  return {
    profiles, activeProfiles, defaultProfile, loading, error, refetch: () => loadProfiles().catch(() => undefined),
    createProfile: (request: CalibrationProfileRequest) => mutate(api.createCalibrationProfile(request)),
    updateProfile: (id: string, request: CalibrationProfileRequest) => mutate(api.updateCalibrationProfile(id, request)),
    setDefaultProfile: (id: string) => mutate(api.setDefaultCalibrationProfile(id)),
    deactivateProfile: (id: string) => mutate(api.deactivateCalibrationProfile(id)),
  };
}
