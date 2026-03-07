// defines IPC channel names shared between main and renderer
export const IPC_CHANNELS = {
  START_SERVICES: 'start-services',
  STOP_SERVICES: 'stop-services',
  SERVICE_STATUS: 'service-status',
  NETWORK_INFO: 'network-info',
  GENERATE_QR: 'generate-qr',
  QR_RESPONSE: 'qr-response',
  LOG_MESSAGE: 'log-message',
};
