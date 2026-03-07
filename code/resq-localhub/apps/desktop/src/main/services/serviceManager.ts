import { BrokerProcess } from './brokerProcess';
import { BackendProcess } from './backendProcess';

export type ServiceStatus = 'stopped' | 'starting' | 'running' | 'error';

export class ServiceManager {
  private broker = new BrokerProcess();
  private backend = new BackendProcess();

  async startAll(): Promise<Record<string, ServiceStatus>> {
    // TODO: add error handling and emit status events
    await this.broker.start();
    await this.backend.start();
    return { broker: 'running', backend: 'running' };
  }

  async stopAll(): Promise<Record<string, ServiceStatus>> {
    await this.broker.stop();
    await this.backend.stop();
    return { broker: 'stopped', backend: 'stopped' };
  }
}
