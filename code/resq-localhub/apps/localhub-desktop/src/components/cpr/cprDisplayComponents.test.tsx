import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MetricCard from "./MetricCard";
import SessionTimer from "./SessionTimer";
import CoachingCue from "./CoachingCue";
import LiveCoachingBanner from "./LiveCoachingBanner";
import LiveCprGraph from "./LiveCprGraph";
import SessionCard from "./SessionCard";
import { useRollingTelemetry } from "../../hooks/useRollingTelemetry";
import { normalizeTelemetry } from "../../utils/telemetryNormalization";

vi.mock("recharts", () => {
  const ChartPart = ({ children, ...props }: any) => <g data-chart-part={props.dataKey ?? props.name ?? "part"}>{children}</g>;
  return {
    AreaChart: ({ children }: any) => <svg data-chart-part="chart">{children}</svg>,
    LineChart: ({ children }: any) => <svg data-chart-part="chart">{children}</svg>,
    Area: ChartPart,
    Line: ChartPart,
    XAxis: ChartPart,
    YAxis: ChartPart,
    CartesianGrid: ChartPart,
    Tooltip: ChartPart,
    ResponsiveContainer: ({ children }: any) => <div data-testid="responsive-chart">{children}</div>,
    ReferenceArea: ChartPart,
    ReferenceLine: ChartPart,
  };
});

vi.mock("../../hooks/useRollingTelemetry", () => ({
  useRollingTelemetry: vi.fn(),
}));

const liveSession = {
  sessionId: "session-1",
  deviceId: "manikin-1",
  manikinId: "manikin-1",
  traineeId: "trainee-1",
  active: true,
  startedAt: "2026-07-28T08:00:00Z",
  profileId: "adult-basic",
  scenario: "Adult CPR",
  notes: null,
  lastSeen: "2026-07-28T08:01:00Z",
  state: "READY_FOR_SESSION",
  online: true,
  ip: null,
  fw: null,
  rssi: null,
  battery: null,
  sessionActive: true,
  latestDepthMm: 54,
  latestRateCpm: 108,
  latestRecoilOk: true,
  latestPauseS: null,
  latestFlags: "DEPTH_OK,RATE_OK,RECOIL_OK",
  lastEventType: "metric",
  latestForce1: null,
  latestForce2: null,
  pressureBalancePct: 50,
  pressureSkewed: false,
  latestMetric: {
    seq: 7,
    compressionCount: 18,
    depthMm: 54,
    rateCpm: 108,
    recoilPct: 96,
    handPlacement: "CENTER",
    flags: "DEPTH_OK,RATE_OK,RECOIL_OK",
  },
  seq: 7,
  connectionState: "ONLINE",
  stale: false,
  offline: false,
  lifecycleState: "ACTIVE",
  requestId: null,
  recoveryStatus: "NONE",
  recoveryReason: null,
};

beforeEach(() => {
  vi.useRealTimers();
  vi.mocked(useRollingTelemetry).mockReturnValue([
    { time: "08:01", depthMm: 54, rateCpm: 108, recoilPct: 96 },
  ]);
});

describe("CPR display components", () => {
  it("renders metric cards with tone, target, unit, and optional subtitle", () => {
    render(
      <MetricCard
        label="Compression Depth"
        value="54"
        unit="mm"
        status="Good"
        tone="good"
        target="50-60 mm"
        subtitle="Derived from firmware progress."
        large
      />,
    );

    expect(screen.getByText("Compression Depth")).toBeInTheDocument();
    expect(screen.getByText("54")).toBeInTheDocument();
    expect(screen.getByText("mm")).toBeInTheDocument();
    expect(screen.getByText("Good")).toBeInTheDocument();
    expect(screen.getByText("50-60 mm")).toBeInTheDocument();
    expect(screen.getByText("Derived from firmware progress.")).toBeInTheDocument();
  });

  it("formats elapsed session time and advances while active", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-28T08:02:05Z"));

    render(<SessionTimer startedAt="2026-07-28T08:00:00Z" active />);
    expect(screen.getByText("02:05")).toBeInTheDocument();

    act(() => {
      vi.setSystemTime(new Date("2026-07-28T08:02:06Z"));
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText("02:07")).toBeInTheDocument();
  });

  it("maps coaching cue messages to friendly tone markers", () => {
    const { rerender } = render(<CoachingCue message="Good compressions, keep it up" />);
    expect(screen.getByRole("status")).toHaveTextContent("Good compressions");

    rerender(<CoachingCue message="Need support from sensor" size="md" />);
    expect(screen.getByRole("status")).toHaveTextContent("Need support");

    rerender(<CoachingCue message="Waiting for signal" tone="muted" size="xl" />);
    expect(screen.getByRole("status")).toHaveTextContent("Waiting for signal");
  });

  it("prioritizes live coaching banner guidance from connection, pause, quality, and success states", () => {
    const { rerender } = render(
      <LiveCoachingBanner
        coachingCue="Active"
        depthMm={54}
        rateCpm={108}
        recoilPct={96}
        flags="DEPTH_OK,RATE_OK,RECOIL_OK"
        handPlacement="CENTER"
        connectionState="ONLINE"
        sessionActive
        compressionCount={12}
      />,
    );
    expect(screen.getByText(/Good compressions/)).toBeInTheDocument();

    rerender(
      <LiveCoachingBanner
        coachingCue="Active"
        depthMm={42}
        rateCpm={90}
        recoilPct={96}
        flags="PAUSE_DETECTED"
        handPlacement="CENTER"
        connectionState="ONLINE"
        sessionActive
        compressionCount={12}
      />,
    );
    expect(screen.getByText(/avoid pauses/)).toBeInTheDocument();

    rerender(
      <LiveCoachingBanner
        coachingCue="Waiting"
        depthMm={null}
        rateCpm={null}
        recoilPct={null}
        flags={null}
        handPlacement={null}
        connectionState="STALE"
        sessionActive
        compressionCount={0}
      />,
    );
    expect(screen.getByText(/Waiting for signal/)).toBeInTheDocument();
  });

  it("renders graph empty, live, and stale states with current metrics", () => {
    vi.mocked(useRollingTelemetry).mockReturnValueOnce([]);
    const { rerender } = render(
      <LiveCprGraph
        session={liveSession as any}
        normalized={normalizeTelemetry(liveSession as any)}
      />,
    );
    expect(screen.getByText("Waiting for compression data...")).toBeInTheDocument();

    rerender(
      <LiveCprGraph
        session={liveSession as any}
        normalized={normalizeTelemetry(liveSession as any)}
      />,
    );
    expect(screen.getByText("Compression Depth Waveform")).toBeInTheDocument();
    expect(screen.getByText("Live Waveform")).toBeInTheDocument();
    expect(screen.getByText("108 CPM")).toBeInTheDocument();
    expect(screen.getByText("96%")).toBeInTheDocument();
    expect(screen.getByText("Centered")).toBeInTheDocument();

    const staleSession = { ...liveSession, online: false, offline: true };
    rerender(
      <LiveCprGraph
        session={staleSession as any}
        normalized={normalizeTelemetry(staleSession as any)}
      />,
    );
    expect(screen.getByText("Connection Stale")).toBeInTheDocument();
  });

  it("renders completed session summary cards and opens review details", () => {
    const onSelect = vi.fn();
    render(
      <SessionCard
        session={{
          sessionId: "session-1",
          deviceId: "manikin-1",
          traineeId: "trainee-1",
          startedAt: "2026-07-28T08:00:00Z",
          endedAt: "2026-07-28T08:02:00Z",
          ended: true,
          scenario: "Adult CPR",
          notes: null,
          summary: {
            sessionId: "session-1",
            deviceId: "manikin-1",
            traineeId: "trainee-1",
            startedAt: "2026-07-28T08:00:00Z",
            endedAt: "2026-07-28T08:02:00Z",
            durationSeconds: 120,
            sampleCount: 20,
            totalCompressions: 60,
            validCompressions: 55,
            avgDepthMm: 54,
            avgDepthProgress: 0.82,
            avgRateCpm: 108,
            recoilPct: 96,
            recoilOkCount: 55,
            incompleteRecoilCount: 2,
            pausesCount: 0,
            score: 92,
            latestFlags: null,
          },
        }}
        onSelect={onSelect}
      />,
    );

    expect(screen.getByText("trainee-1")).toBeInTheDocument();
    expect(screen.getByText("92% - Excellent")).toBeInTheDocument();
    expect(screen.getByText("02:00")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Review Details"));
    expect(onSelect).toHaveBeenCalledWith("session-1");
  });
});
