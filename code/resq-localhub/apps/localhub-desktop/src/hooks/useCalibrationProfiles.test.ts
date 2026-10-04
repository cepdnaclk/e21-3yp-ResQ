import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCalibrationProfiles } from "./useCalibrationProfiles";
import * as api from "../api/firmwareApi";
vi.mock("../api/firmwareApi", () => ({ getCalibrationProfiles: vi.fn(), createCalibrationProfile: vi.fn(), updateCalibrationProfile: vi.fn(), setDefaultCalibrationProfile: vi.fn(), deactivateCalibrationProfile: vi.fn() }));
const profile = { profileId: "p", name: "Adult", hallDelta: 240, refPressure: 1320000, bladder1Pressure: 4150000, bladder2Pressure: 4150000, active: true, defaultProfile: true, description: null, createdAt: "", updatedAt: "" };
beforeEach(() => { vi.resetAllMocks(); vi.mocked(api.getCalibrationProfiles).mockResolvedValue([profile]); });
describe("useCalibrationProfiles", () => {
  it("loads active profiles and derives the default from the same snapshot", async () => {
    vi.mocked(api.getCalibrationProfiles).mockResolvedValue([profile, { ...profile, profileId: "inactive", active: false, defaultProfile: false }]);
    const { result } = renderHook(useCalibrationProfiles);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.profiles).toHaveLength(2);
    expect(result.current.activeProfiles).toEqual([profile]);
    expect(result.current.defaultProfile).toEqual(profile);
  });
  it("reloads after every successful mutation", async () => {
    for (const fn of [api.createCalibrationProfile, api.updateCalibrationProfile, api.setDefaultCalibrationProfile, api.deactivateCalibrationProfile]) vi.mocked(fn).mockResolvedValue(profile);
    const { result } = renderHook(useCalibrationProfiles);
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.createProfile(profile); });
    await act(async () => { await result.current.updateProfile("p", profile); });
    await act(async () => { await result.current.setDefaultProfile("p"); });
    await act(async () => { await result.current.deactivateProfile("p"); });
    expect(api.getCalibrationProfiles).toHaveBeenCalledTimes(5);
  });
  it.each(["Select another default profile before deactivating the current default profile", "At least one active calibration profile must remain available"])("preserves backend mutation errors: %s", async message => {
    vi.mocked(api.deactivateCalibrationProfile).mockRejectedValue(new Error(message));
    const { result } = renderHook(useCalibrationProfiles);
    await waitFor(() => expect(result.current.loading).toBe(false));
    await expect(result.current.deactivateProfile("p")).rejects.toThrow(message);
    expect(result.current.profiles).toEqual([profile]);
  });
  it("blocks stale profiles after reload failure and permits retry", async () => {
    const { result } = renderHook(useCalibrationProfiles);
    await waitFor(() => expect(result.current.loading).toBe(false));
    vi.mocked(api.getCalibrationProfiles).mockRejectedValueOnce(new Error("Hub unavailable"));
    await act(async () => { await result.current.refetch().catch(() => {}); });
    expect(result.current.error).toBe("Hub unavailable");
    await act(async () => { await result.current.refetch(); });
    expect(result.current.error).toBeNull();
  });
});
