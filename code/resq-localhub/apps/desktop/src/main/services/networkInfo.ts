import os from 'os';

export function getNetworkInfo() {
  const interfaces = os.networkInterfaces();
  const addrs: string[] = [];
  for (const name in interfaces) {
    const list = interfaces[name];
    if (list) {
      for (const iface of list) {
        if (!iface.internal && iface.family === 'IPv4') {
          addrs.push(iface.address);
        }
      }
    }
  }
  // TODO: include ports and construct URLs
  return { addresses: addrs };
}
