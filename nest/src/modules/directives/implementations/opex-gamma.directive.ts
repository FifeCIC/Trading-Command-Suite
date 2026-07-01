import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';

/**
 * OpEx Gamma Directive
 * Monthly options expiration (3rd Friday) — gamma pinning suppresses directional bets.
 */
@Injectable()
export class OpexGammaDirective implements IDirective {
  readonly id = 'opex-gamma';
  readonly name = 'OpEx Gamma Pinning';
  readonly description = 'Monthly options expiration (3rd Friday) — gamma pinning suppresses directional movement. NEUTRAL bias.';
  readonly priority = 25;
  readonly maxScore = 10;
  readonly version = '1.0.0';

  calculate(input: DirectiveInput): DirectiveResult {
    const now = new Date();
    const dayOfWeek = now.getUTCDay(); // 5=Fri
    const day = now.getUTCDate();

    // 3rd Friday of the month = day between 15 and 21
    const isThirdFriday = dayOfWeek === 5 && day >= 15 && day <= 21;

    return {
      signalClass: 'neutral',
      score: isThirdFriday ? 5 : 2,
      confidence: isThirdFriday ? 0.55 : 0.3,
      reason: isThirdFriday
        ? 'OpEx Friday — gamma pinning may suppress directional movement'
        : 'Not OpEx Friday',
    };
  }
}
