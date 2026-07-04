import { useEffect, useState } from "react";
import { fetchDeviceReadiness } from "../api/firmwareApi";
import type { FirmwareReadinessResponse } from "../types/firmware";

export function useDeviceReadiness(deviceId: string | null, isCalibrating: boolean) {
  const [readiness, setReadiness] = useState<FirmwareReadinessResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchReadiness = async (showLoading = false) => {
    if (!deviceId) return;
    if (showLoading) setLoading(true);
    try {
      const res = await fetchDeviceReadiness(deviceId);
      setReadiness(res);
      setError(null);
    } catch (err) {
      setError("Failed to fetch device readiness.");
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  useEffect(() => {
    fetchReadiness(true);
  }, [deviceId]);

  useEffect(() => {
    if (!deviceId) return;

    let intervalId: number | undefined;
    if (isCalibrating) {
      intervalId = window.setInterval(() => {
        fetchReadiness(false);
      }, 1500);
    }

    return () => {
      if (intervalId) window.clearInterval(intervalId);
    };
  }, [deviceId, isCalibrating]);

  return { readiness, loading, error, refetch: () => fetchReadiness(false) };
}
