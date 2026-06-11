import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/ (GET) — returns Hello World', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  it('/version (GET) — returns version with expected shape', () => {
    return request(app.getHttpServer())
      .get('/version')
      .expect(200)
      .expect((res) => {
        expect(res.body).toHaveProperty('version', 'nest-0.1.0');
        expect(res.body).toHaveProperty('status', 'ok');
        expect(res.body).toHaveProperty('timestamp');
        expect(res.body).toHaveProperty('mode');
        expect(res.body).toHaveProperty('services');
        expect(res.body.services).toHaveProperty('database');
        expect(res.body.services).toHaveProperty('databaseConnected');
      });
  });

  it('/health (GET) — returns health with subsystems', () => {
    return request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect((res) => {
        expect(res.body).toHaveProperty('status');
        expect(res.body).toHaveProperty('uptime');
        expect(res.body).toHaveProperty('mode');
        expect(res.body).toHaveProperty('subsystems');
        expect(res.body.subsystems).toHaveProperty('database');
        expect(res.body.subsystems.database).toHaveProperty('status');
        expect(res.body.subsystems).toHaveProperty('providers');
        expect(res.body.subsystems).toHaveProperty('queue');
      });
  });

  afterEach(async () => {
    await app.close();
  });
});
