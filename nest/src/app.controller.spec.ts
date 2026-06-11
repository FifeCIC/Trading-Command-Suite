import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ModeService } from './config/mode.service';
import { PrismaService } from './database/prisma.service';
import { ProvidersService } from './modules/providers/providers.service';

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
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });
  });

  describe('version', () => {
    it('should return version object with expected shape', () => {
      const result = appController.getVersion();
      expect(result).toHaveProperty('version', 'nest-0.1.0');
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
