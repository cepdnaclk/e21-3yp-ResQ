export class BackendProcess {
  private running = false;

  async start(): Promise<void> {
    // TODO: spawn node process to run services/api
    console.log('Starting backend (stub)');
    this.running = true;
  }

  async stop(): Promise<void> {
    console.log('Stopping backend (stub)');
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }
}
