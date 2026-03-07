import React from 'react';

export const QrPanel: React.FC = () => {
  const [qr, setQr] = React.useState<string | null>(null);

  const fetchQr = async () => {
    if (window.electronAPI && window.electronAPI.generateQr) {
      const data = await window.electronAPI.generateQr('sample');
      setQr(data);
    }
  };

  return (
    <div style={{ border: '1px dashed #aaa', padding: 12, width: 200, textAlign: 'center' }}>
      {qr ? <img src={qr} alt="QR" style={{ maxWidth: '100%' }} /> : <div>QR Code Placeholder</div>}
      <button onClick={fetchQr} style={{ marginTop: 8 }}>
        Generate
      </button>
    </div>
  );
};
