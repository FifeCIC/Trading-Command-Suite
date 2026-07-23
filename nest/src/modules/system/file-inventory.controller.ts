import { Controller, Get } from '@nestjs/common';
import { FileInventoryService } from './file-inventory.service';

@Controller('system/file-inventory')
export class FileInventoryController {
  constructor(private readonly fileInventory: FileInventoryService) {}

  @Get()
  getInventory() {
    const projectRoot = process.cwd().replace(/\\/g, '/').replace(/\/nest$/, '');
    return this.fileInventory.scan(projectRoot);
  }
}
