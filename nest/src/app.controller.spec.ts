import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
// Read the version from package.json — a hardcoded string here went stale on
// every release (it still asserted 0.4.0 while the app was 0.5.4).
import * as packageJson from '../package.json';
import { ModeService } from './config/mode.service';
import { PrismaService } from './database/prisma.service';
import { ProvidersService } from './modules/providers/providers.service';
import { Mt5ConnectionManager } from './modules/providers/mt5/mt5-connection-manager.service';
import { StopGuardianService } from './modules/automation/stop-guardian.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        {
          provide: ModeService,
          useValue: {
            getModeInfo: () => ({ mode: 'test', database: false, queue: false, redis: false }),
          },
        },
        {
          provide: PrismaService,
          useValue: { isAvailable: false, $queryRaw: jest.fn() },
        },
        {
          provide: ProvidersService,
          useValue: { getHealth: jest.fn().mockResolvedValue({ providers: [] }) },
        },
        // AppController gained Mt5ConnectionManager + StopGuardianService deps;
        // provide minimal mocks matching what getServerInfo() reads.
        {
          provide: Mt5ConnectionManager,
          useValue: { getAllBrokerHealths: jest.fn().mockResolvedValue([]) },
        },
        {
          provide: StopGuardianService,
          useValue: { state: { enabled: false, guardedPositions: [], lastTickAt: null, tickCount: 0 } },
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return server info with expected shape', async () => {
      // getHello() was replaced by getServerInfo() (see app.controller.ts).
      const result = await appController.getServerInfo();
      expect(result).toHaveProperty('server');
      expect(result).toHaveProperty('uptime');
      expect(result).toHaveProperty('database');
      expect(result).toHaveProperty('mt5Bridge');
      expect(result).toHaveProperty('stopGuardian');
    });
  });

  describe('version', () => {
    it('should return version object with expected shape', () => {
      const result = appController.getVersion();
      expect(result).toHaveProperty('version', packageJson.version);
      expect(result).toHaveProperty('status', 'ok');
      expect(result).toHaveProperty('timestamp');
      expect(result).toHaveProperty('mode', 'test');
      expect(result).toHaveProperty('services');
      expect(result.services).toHaveProperty('database');
      expect(result.services).toHaveProperty('queue');
    });
  });

  describe('health', () => {
    it('should return health object with subsystems', async () => {
      const result = await appController.getHealth();
      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('uptime');
      expect(result).toHaveProperty('mode', 'test');
      expect(result).toHaveProperty('subsystems');
      expect(result.subsystems).toHaveProperty('database');
      expect(result.subsystems.database).toHaveProperty('status');
      expect(result.subsystems).toHaveProperty('providers');
      expect(result.subsystems).toHaveProperty('queue');
    });
  });
});
