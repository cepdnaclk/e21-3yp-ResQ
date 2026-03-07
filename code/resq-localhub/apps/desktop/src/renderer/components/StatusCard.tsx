import React from 'react';

interface Props {
  label: string;
  status: string;
}

export const StatusCard: React.FC<Props> = ({ label, status }) => {
  return (
    <div
      style={{
        border: '1px solid #ccc',
        padding: 12,
        marginRight: 8,
        minWidth: 120,
      }}
    >
      <strong>{label}</strong>
      <div>{status}</div>
    </div>
  );
};
