import { describe, expect, it } from "vitest";
import { resolveLocalHubApiBase } from "./hubApiUrl";

describe("resolveLocalHubApiBase", () => {
  it("uses the tablet page hostname for LAN REST and SSE clients", () => {
    expect(resolveLocalHubApiBase({ protocol: "http:", hostname: "192.168.8.100" })).toBe(
      "http://192.168.8.100:18080",
    );
  });

  it("preserves localhost development behaviour", () => {
    expect(resolveLocalHubApiBase({ protocol: "http:", hostname: "localhost" })).toBe(
      "http://localhost:18080",
    );
  });

  it("uses loopback for Tauri custom-protocol and file locations", () => {
    expect(resolveLocalHubApiBase({ protocol: "tauri:", hostname: "localhost" })).toBe(
      "http://127.0.0.1:18080",
    );
    expect(resolveLocalHubApiBase({ protocol: "https:", hostname: "tauri.localhost" })).toBe(
      "http://127.0.0.1:18080",
    );
    expect(resolveLocalHubApiBase({ protocol: "file:", hostname: "" })).toBe(
      "http://127.0.0.1:18080",
    );
  });

  it("uses and normalizes an explicit build-time override", () => {
    expect(
      resolveLocalHubApiBase(
        { protocol: "http:", hostname: "192.168.8.100" },
        " http://10.0.0.5:19000/// ",
      ),
    ).toBe("http://10.0.0.5:19000");
  });
});
