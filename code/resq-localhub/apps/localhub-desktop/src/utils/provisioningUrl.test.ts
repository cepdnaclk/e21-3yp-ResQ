import { describe, expect, it } from "vitest";

import { buildEspProvisioningUrl } from "../lib/browserManikinsProvisionApi";
import { buildProvisioningUrl } from "./provisioningUrl";

const passwordCases = [
  "simplePassword",
  "12345678",
  "p@ss&word=123",
  "space containing password",
  "percent%value",
  "plus+symbol",
  "",
];

describe.each([
  ["pairing page", (password: string) => buildProvisioningUrl({
    wifiSsid: "ResQ Lab & Training",
    wifiPassword: password,
    backendBaseUrl: "http://192.0.2.10:18080/base?x=1",
  })],
  ["instructor dashboard", (password: string) => buildEspProvisioningUrl({
    wifiSsid: " ResQ Lab & Training ",
    wifiPassword: password,
    backendBaseUrl: " http://192.0.2.10:18080 ",
  })],
])("%s provisioning QR", (_name, buildUrl) => {
  it.each(passwordCases)("round-trips password %j exactly once", (password) => {
    const url = new URL(buildUrl(password));

    expect(url.searchParams.get("wifi_ssid")).toBe("ResQ Lab & Training");
    expect(url.searchParams.get("wifi_pass")).toBe(password);
    expect(url.searchParams.get("backend_base_url")).toContain("192.0.2.10");
  });
});

it("preserves meaningful leading and trailing password spaces", () => {
  const url = new URL(buildEspProvisioningUrl({
    wifiSsid: "ResQ Lab",
    wifiPassword: "  secret value  ",
    backendBaseUrl: "http://192.0.2.10:18080",
  }));

  expect(url.searchParams.get("wifi_pass")).toBe("  secret value  ");
  expect(url.toString()).toContain("wifi_pass=++secret+value++");
});
