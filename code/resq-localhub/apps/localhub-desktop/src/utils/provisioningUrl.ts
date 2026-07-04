export function buildProvisioningUrl(input: {
  wifiSsid: string;
  wifiPassword: string;
  backendBaseUrl: string;
}): string {
  const params = new URLSearchParams();
  params.set("wifi_ssid", input.wifiSsid);
  params.set("wifi_pass", input.wifiPassword);
  params.set("backend_base_url", input.backendBaseUrl);
  params.set("auto", "1");
  return `http://192.168.4.1/?${params.toString()}`;
}
