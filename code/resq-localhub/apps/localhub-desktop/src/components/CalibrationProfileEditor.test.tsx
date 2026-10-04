import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import CalibrationProfileEditor from "./CalibrationProfileEditor";
const profile = { profileId: "p", name: "Adult", hallDelta: 240, refPressure: 1320000, bladder1Pressure: 4150000, bladder2Pressure: 4151822, active: true, defaultProfile: true, description: null, createdAt: "", updatedAt: "" };
describe("CalibrationProfileEditor validation", () => {
  it.each([49, 4096, 210.5, 0])("rejects invalid Hall delta %s", async value => {
    const save = vi.fn();
    render(<CalibrationProfileEditor profile={profile} disabled={false} saving={false} onSave={save} onCancel={vi.fn()} />);
    await userEvent.clear(screen.getByLabelText("Hall Delta"));
    await userEvent.type(screen.getByLabelText("Hall Delta"), String(value));
    await userEvent.click(screen.getByRole("button", { name: "Save Profile" }));
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("between 50 and 4095");
  });
  it.each([50, 210, 240, 4095])("accepts Hall delta %s and raw pressure counts in millions", async value => {
    const save = vi.fn();
    render(<CalibrationProfileEditor profile={{ ...profile, hallDelta: value }} disabled={false} saving={false} onSave={save} onCancel={vi.fn()} />);
    expect(screen.getByLabelText("Reference Pressure")).not.toHaveAttribute("max");
    await userEvent.click(screen.getByRole("button", { name: "Save Profile" }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ hallDelta: value, refPressure: 1320000, bladder1Pressure: 4150000, bladder2Pressure: 4151822 }));
  });
  it.each([0, -1, 1.5])("rejects invalid pressure %s", async value => {
    const save = vi.fn();
    render(<CalibrationProfileEditor profile={{ ...profile, refPressure: value }} disabled={false} saving={false} onSave={save} onCancel={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Save Profile" }));
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("integer greater than 0");
  });
});
