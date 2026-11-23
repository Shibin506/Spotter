import { describe, expect, it } from 'vitest';
import { parseCommand } from '../src/ui/voiceCommands';

describe('voice commands', () => {
  it.each([
    ['End set', 'end'], ['stop the set', 'end'], ['done', 'end'], ['Finish my set.', 'end'],
    ['next set', 'next'], ['another set', 'next'], ['Next', 'next'],
    ['start', 'start'], ['start the camera', 'start'], ['go', 'start'],
    ['mute', 'mute'], ['voice off', 'mute'], ['unmute', 'unmute'], ['voice on', 'unmute'],
    ['show history', 'history'],
  ])('%s → %s', (heard, cmd) => expect(parseCommand(heard)).toBe(cmd));

  it('ignores ordinary talk and Spotter’s own cues', () => {
    for (const s of ['Deeper', 'Chest up', 'Speed down 22 percent. About 2 left', 'three', 'I think I can go for a long time today']) {
      expect(parseCommand(s)).toBeNull();
    }
  });
});
