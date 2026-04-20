export class BrokerProcess {
  private running = false;

  async start(): Promise<void> {
    // TODO: spawn actual broker (e.g. mosquitto) and watch logs
    console.log('Starting broker (stub)');
    this.running = true;
  }

  async stop(): Promise<void> {
    console.log('Stopping broker (stub)');
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }
}
