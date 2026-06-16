import { Controller, Get, Post, Param, Query, Logger } from '@nestjs/common';
import { ProcessManagerService } from './process-manager.service';

@Controller('processes')
export class ProcessManagerController {
  private readonly logger = new Logger(ProcessManagerController.name);

  constructor(private readonly pm: ProcessManagerService) {}

  /** GET /api/processes — list all tasks with live status */
  @Get()
  async list() {
    const tasks = await this.pm.listTasks();
    return { tasks };
  }

  /** GET /api/processes/:id — get single task status */
  @Get(':id')
  async status(@Param('id') id: string) {
    const tasks = await this.pm.listTasks();
    const task = tasks.find((t) => t.id === id);
    if (!task) return { error: 'Unknown task', id };
    return task;
  }

  /** POST /api/processes/:id/start — start a task */
  @Post(':id/start')
  async start(@Param('id') id: string) {
    this.logger.log(`Start requested for task: ${id}`);
    return this.pm.startTask(id);
  }

  /** POST /api/processes/:id/stop — stop a task */
  @Post(':id/stop')
  async stop(@Param('id') id: string) {
    this.logger.log(`Stop requested for task: ${id}`);
    return this.pm.stopTask(id);
  }
}
