import { describe, expect, it } from 'vitest';
import { explainLoginFailure } from '../src/util/start.js';

describe('uitleg bij een mislukte login', () => {
  it('wijst naar de token bij de fout die discord.js teruggeeft', () => {
    // Dit is letterlijk wat een verkeerde token oplevert: geen bruikbare tekst.
    const message = explainLoginFailure(new Error('No Description'));
    expect(message).toContain('DISCORD_TOKEN');
    expect(message).toContain('Reset Token');
  });

  it('herkent een 401', () => {
    expect(explainLoginFailure(new Error('401: Unauthorized'))).toContain('accepteert de token niet');
  });

  it('herkent geweigerde intents', () => {
    expect(explainLoginFailure(new Error('Used disallowed intents'))).toContain('intents');
  });

  it('herkent netwerkproblemen', () => {
    expect(explainLoginFailure(new Error('getaddrinfo ENOTFOUND discord.com'))).toContain('Geen verbinding');
  });

  it('geeft de oorspronkelijke tekst terug als er niets past', () => {
    expect(explainLoginFailure(new Error('iets heel anders'))).toContain('iets heel anders');
  });
});
