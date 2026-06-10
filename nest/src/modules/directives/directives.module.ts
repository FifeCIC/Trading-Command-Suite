import { Module } from '@nestjs/common';
import { DirectivesService } from './directives.service';
import { RsiOversoldDirective } from './implementations/rsi-oversold.directive';
import { MacdCrossoverDirective } from './implementations/macd-crossover.directive';
import { EmaStructureDirective } from './implementations/ema-structure.directive';
import { AtrDipDirective } from './implementations/atr-dip.directive';
import { VolumeConfirmationDirective } from './implementations/volume-confirmation.directive';

@Module({
  providers: [
    DirectivesService,
    RsiOversoldDirective,
    MacdCrossoverDirective,
    EmaStructureDirective,
    AtrDipDirective,
    VolumeConfirmationDirective,
  ],
  exports: [DirectivesService],
})
export class DirectivesModule {}
