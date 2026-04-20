import React, { useEffect, useState } from 'react';
import { StatusCard } from '../components/StatusCard';
import { QrPanel } from '../components/QrPanel';

declare global {
  interface Window {
    electronAPI: any;
  }
}

export const HomePage = () => {
  const [status, setStatus] = useState<{ broker: string; backend: string }>({ broker: 'stopped', backend: 'stopped' });
  const [network, setNetwork] = useState<{ addresses?: string[] }>({});

  useEffect(() => {
    window.electronAPI.onServiceStatus((s: any) => setStatus(s));
    // fetch network info on mount
    window.electronAPI.getNetworkInfo().then((info: any) => setNetwork(info));
  }, []);

  const start = async () => {
    const res = await window.electronAPI.startServices();
    setStatus(res);
  };

  const stop = async () => {
    const res = await window.electronAPI.stopServices();
    setStatus(res);
  };

  return (
    <div style={{ padding: 20 }}>
      {network.addresses && (
        <div style={{ marginBottom: 16 }}>
          <strong>Network:</strong> {network.addresses.join(', ')}
        </div>
      )}
      <h1>ResQ Local Hub</h1>
      <div>
        <button onClick={start}>Start Services</button>
        <button onClick={stop} style={{ marginLeft: 8 }}>
          Stop Services
        </button>
      </div>
      <div style={{ display: 'flex', marginTop: 16 }}>
        <StatusCard label="Broker" status={status.broker} />
        <StatusCard label="Backend" status={status.backend} />
      </div>
      <div style={{ marginTop: 24 }}>
        <QrPanel />
      </div>
    </div>
  );
};
