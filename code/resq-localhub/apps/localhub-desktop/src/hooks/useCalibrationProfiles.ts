import { useEffect, useState } from "react";
import { getCalibrationProfiles, getDefaultCalibrationProfile } from "../api/firmwareApi";
import type { CalibrationProfileResponse } from "../types/firmware";

export function useCalibrationProfiles() {
  const [profiles, setProfiles] = useState<CalibrationProfileResponse[]>([]);
  const [defaultProfile, setDefaultProfile] = useState<CalibrationProfileResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadProfiles = async () => {
    setLoading(true);
    try {
      const [list, def] = await Promise.all([
        getCalibrationProfiles(),
        getDefaultCalibrationProfile()
      ]);
      setProfiles(list);
      setDefaultProfile(def);
      setError(null);
    } catch (err) {
      setError("Failed to load calibration profiles.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProfiles();
  }, []);

  return { profiles, defaultProfile, loading, error, refetch: loadProfiles };
}
