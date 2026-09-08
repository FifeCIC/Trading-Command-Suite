import { StopGuardianService } from './stop-guardian.service';

describe('Automation StopGuardianService', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('keeps scheduling after a tick with no active strategies', async () => {
    const service = new StopGuardianService(
      { findAll: jest.fn().mockResolvedValue([]) } as any,
      {} as any,
      { getUrl: () => 'http://mt5.test' } as any,
      { recordAdjustment: jest.fn() } as any,
    );
    service.state.enabled = true;

    await service.tick();

    expect(service.state.nextTickAt).not.toBeNull();
    expect(jest.getTimerCount()).toBe(1);
    service.stop();
  });
});
